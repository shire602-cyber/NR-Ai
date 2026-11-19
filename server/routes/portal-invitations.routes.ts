/**
 * Customer-portal invitations (STEP5).
 *
 * Staff (cookie or Bearer; under /api/companies/:companyId so the central role policy, CSRF, plan
 * gate and tenancy checks all apply):
 *   GET    /api/companies/:companyId/portal-access/summary
 *   GET    /api/companies/:companyId/customer-contacts/:id/portal-access
 *   POST   /api/companies/:companyId/customer-contacts/:id/portal-invitations
 *   POST   /api/companies/:companyId/portal-invitations/bulk
 *   POST   /api/companies/:companyId/portal-invitations/:portalInvitationId/resend | revoke
 *   DELETE /api/companies/:companyId/portal-accounts/:portalAccountId
 *
 * Customer (public, throttled, logged; CSRF-protected, not exempt):
 *   GET  /api/portal-invitations/:token           the invitation as the join page needs it
 *   POST /api/portal-invitations/:token/accept    consumes the invitation (never the GET)
 */
import type { Express, Request, RequestHandler, Response } from "express";
import { storage } from "../storage";
import { authMiddleware, optionalAuthUser } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { scopedGet } from "../tenancy";
import { customerContacts } from "../../shared/schema";
import {
  portalAcceptBody,
  portalBulkInviteBody,
  portalInviteBody,
  type PortalAcceptBody,
  type PortalBulkInviteBody,
  type PortalInviteBody,
  type PortalInviteLanguage,
} from "../../shared/validators/portal-invitations";
import {
  acceptInvitation,
  accountCaseFor,
  createInvitation,
  inviteStateError,
  logInviteEvent,
  portalAccessForContact,
  portalSummary,
  resendInvitation,
  resolveInvitation,
  revokeInvitation,
  revokePortalAccount,
} from "../services/portal-invitations.service";
import { portalGuard, notePortalFailure } from "./portal.public.routes";
import { paymentsAvailability } from "../services/payments";
import { issueAuthTokens } from "./auth.routes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const userId = (req: Request) => (req.user as { id: string }).id;

/**
 * The path company must be one the caller can reach. The central role policy lets platform admins
 * and NR firm staff through without a membership check, so it is confirmed here (an NR staffer
 * reaches only the clients they are linked to).
 */
async function companyParam(req: Request): Promise<string> {
  const companyId = req.params.companyId;
  if (!UUID_RE.test(companyId) || !(await storage.hasCompanyAccess(userId(req), companyId))) {
    throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied to this company");
  }
  return companyId.toLowerCase();
}

/** An ar/en contact preference becomes that language; no preference sends both. */
function languageForContact(pref: string | null | undefined): PortalInviteLanguage {
  return pref === "ar" ? "ar" : pref === "en" ? "en" : "bilingual";
}

export function registerPortalInvitationRoutes(app: Express): void {
  const staff: RequestHandler = authMiddleware as RequestHandler;
  const canRead = requirePermission("reports.read");
  const canWrite = requirePermission("documents.write");

  app.get(
    "/api/companies/:companyId/portal-access/summary",
    staff,
    canRead,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await portalSummary(await companyParam(req)));
    })
  );

  app.get(
    "/api/companies/:companyId/customer-contacts/:id/portal-access",
    staff,
    canRead,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await companyParam(req);
      res.json(await portalAccessForContact(companyId, req.params.id));
    })
  );

  app.post(
    "/api/companies/:companyId/customer-contacts/:id/portal-invitations",
    staff,
    canWrite,
    strictBody(portalInviteBody),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await companyParam(req);
      const result = await createInvitation({
        companyId,
        contactId: req.params.id,
        body: parsedBody<PortalInviteBody>(req),
        invitedBy: userId(req),
        req,
      });
      res.status(201).json(result);
    })
  );

  app.post(
    "/api/companies/:companyId/portal-invitations/bulk",
    staff,
    canWrite,
    strictBody(portalBulkInviteBody),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await companyParam(req);
      const body = parsedBody<PortalBulkInviteBody>(req);
      const ids = [...new Set(body.contactIds)];
      const results: Array<{
        contactId: string;
        outcome: string;
        delivery?: string;
        inviteUrl?: string;
      }> = [];
      let limited = false;
      for (const contactId of ids) {
        if (limited) {
          results.push({ contactId, outcome: "rate_limited" });
          continue;
        }
        try {
          const contact = await scopedGet(customerContacts, companyId, contactId);
          if (!contact) {
            results.push({ contactId, outcome: "not_found" });
            continue;
          }
          const created = await createInvitation({
            companyId,
            contactId,
            body: {
              language:
                body.language === "contact"
                  ? languageForContact(contact.preferredLanguage)
                  : body.language,
            },
            invitedBy: userId(req),
            req,
          });
          // With no email provider nothing is sent: the inviter gets each link to share, exactly as
          // a single invite does (the staff user already owns the invitation they just created).
          results.push({
            contactId,
            outcome: "invited",
            delivery: created.delivery,
            ...(created.inviteUrl ? { inviteUrl: created.inviteUrl } : {}),
          });
        } catch (err) {
          const code = (err as { code?: string }).code;
          const outcome =
            code === "CONTACT_EMAIL_REQUIRED"
              ? "skipped_no_email"
              : code === "PORTAL_ALREADY_ACTIVE"
                ? "already_active"
                : code === "INVITATION_PENDING"
                  ? "pending"
                  : code === "CONTACT_NOT_FOUND"
                    ? "not_found"
                    : code === "PORTAL_INVITE_RATE_LIMITED"
                      ? "rate_limited"
                      : null;
          if (!outcome) throw err;
          if (outcome === "rate_limited") limited = true;
          results.push({ contactId, outcome });
        }
      }
      res.json({ results });
    })
  );

  app.post(
    "/api/companies/:companyId/portal-invitations/:portalInvitationId/resend",
    staff,
    canWrite,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await companyParam(req);
      const result = await resendInvitation({
        companyId,
        invitationId: req.params.portalInvitationId,
        actorId: userId(req),
        req,
      });
      res.json(result);
    })
  );

  app.post(
    "/api/companies/:companyId/portal-invitations/:portalInvitationId/revoke",
    staff,
    canWrite,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await companyParam(req);
      res.json({
        invitation: await revokeInvitation({
          companyId,
          invitationId: req.params.portalInvitationId,
          actorId: userId(req),
          req,
        }),
      });
    })
  );

  app.delete(
    "/api/companies/:companyId/portal-accounts/:portalAccountId",
    staff,
    canWrite,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await companyParam(req);
      await revokePortalAccount({
        companyId,
        accountId: req.params.portalAccountId,
        actorId: userId(req),
        req,
      });
      res.json({ revoked: true });
    })
  );

  // ─── Customer: the join page ──────────────────────────────────────────────

  const invalidBody = {
    code: "PORTAL_INVITE_INVALID",
    message: "This link is not valid",
  };

  app.get(
    "/api/portal-invitations/:token",
    portalGuard("invite"),
    asyncHandler(async (req: Request, res: Response) => {
      const r = await resolveInvitation(req.params.token);
      if (r.status === "invalid") {
        // Malformed and unknown tokens are answered identically and count against the IP.
        notePortalFailure(req);
        await logInviteEvent(req, "invite_invalid");
        return res.status(404).json(invalidBody);
      }
      if (r.status !== "ok") {
        await logInviteEvent(req, `invite_${r.status}`, r.invitation);
        const err = inviteStateError(r.status);
        return res.status(410).json({
          code: err.code,
          message: err.message,
          supplier: r.company
            ? { name: r.company.name, contactEmail: r.company.contactEmail ?? null }
            : null,
          expiresAt: r.invitation.expiresAt.toISOString(),
        });
      }
      const signedIn = await optionalAuthUser(req);
      const account = await accountCaseFor(
        r.invitation,
        signedIn ? { id: signedIn.id, email: signedIn.email } : null
      );
      await logInviteEvent(req, "invite_view", r.invitation);
      res.set("Cache-Control", "no-store");
      res.json({
        status: "pending",
        supplier: {
          name: r.company.name,
          logoUrl: r.company.logoUrl ?? null,
          contactEmail: r.company.contactEmail ?? null,
        },
        customerName: r.contact.name,
        customerNameAr: r.contact.nameAr ?? null,
        email: r.invitation.email,
        name: r.invitation.name ?? r.contact.contactPerson ?? "",
        language: r.invitation.language,
        // The supplier's personal note, plain text (the page renders it as text, never as markup).
        note: r.invitation.message?.trim() || null,
        expiresAt: r.invitation.expiresAt.toISOString(),
        account,
        signedInAs: signedIn && account === "signed_in_other" ? signedIn.email : null,
        onlinePayment: { available: paymentsAvailability().available },
      });
    })
  );

  app.post(
    "/api/portal-invitations/:token/accept",
    portalGuard("invite"),
    strictBody(portalAcceptBody),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<PortalAcceptBody>(req);
      const signedIn = await optionalAuthUser(req);
      let outcome;
      try {
        outcome = await acceptInvitation({
          rawToken: req.params.token,
          signedIn: signedIn ? { id: signedIn.id, email: signedIn.email } : null,
          name: body.name,
          password: body.password,
          req,
          res,
        });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "PORTAL_INVITE_INVALID") notePortalFailure(req);
        await logInviteEvent(req, `invite_accept_${(code ?? "error").toLowerCase()}`);
        throw err;
      }
      await logInviteEvent(req, "invite_accept", outcome.invitation);
      const payload: Record<string, unknown> = {
        redirectTo: "/client-portal/dashboard",
        portalAccountId: outcome.portalAccountId,
        language: outcome.invitation.language,
      };
      if (outcome.createdUser) {
        const user = (await storage.getUser(outcome.userId))!;
        await issueAuthTokens(req, res, user);
        payload.user = {
          id: user.id,
          email: user.email,
          name: user.name,
          userType: user.userType,
        };
      }
      res.set("Cache-Control", "no-store");
      res.json(payload);
    })
  );
}
