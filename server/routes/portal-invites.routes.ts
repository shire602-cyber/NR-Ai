import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { getAccessibleCompanyIds, requireNraAccess } from "../middleware/rbac";
import { asyncHandler } from "../middleware/errorHandler";
import { getEnv } from "../config/env";
import { createLogger } from "../config/logger";
import { recordAudit } from "../services/audit.service";
import { escapeHtml, sendEmail, type SendEmailResult } from "../services/email.service";
import {
  PORTAL_COMPANY_ROLE,
  PORTAL_USER_TYPE,
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiry,
  isUserDeactivated,
  sanitizeInvitation,
  PORTAL_INVITE_TTL_DAYS,
} from "../services/portal-invitations";
import type { Invitation } from "../../shared/schema";

const log = createLogger("portal-invites");

const inviteBodySchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required").max(254),
});

/**
 * Firm-side guard: the caller must be NRA firm staff (route middleware) AND
 * be allowed to see this specific client company. firm_admin is limited to
 * assigned clients; platform admin / firm_owner see all clients.
 */
async function loadAccessibleClientCompany(req: Request, res: Response, companyId: string) {
  const company = await storage.getCompany(companyId);
  if (!company || company.companyType !== "client" || (company as any).deletedAt) {
    res.status(404).json({ message: "Client company not found" });
    return null;
  }
  const user = req.user as any;
  const accessible = await getAccessibleCompanyIds(user.id, user.firmRole ?? "", user.isAdmin === true);
  if (accessible !== null && !accessible.includes(companyId)) {
    res.status(403).json({ message: "You are not assigned to this client company" });
    return null;
  }
  return company;
}

function acceptUrlFor(rawToken: string): string {
  const env = getEnv();
  const base = (env.FRONTEND_URL || env.AUTH_PUBLIC_URL || "").replace(/\/+$/, "");
  return `${base}/accept-invite/${rawToken}`;
}

/** The accept link may only be echoed to the caller outside production (for testing). */
function devAcceptUrl(rawToken: string): { acceptUrl?: string } {
  return process.env.NODE_ENV === "production" ? {} : { acceptUrl: acceptUrlFor(rawToken) };
}

function renderInviteEmail(params: { companyName: string; inviterName: string; url: string }) {
  const company = escapeHtml(params.companyName);
  const inviter = escapeHtml(params.inviterName);
  const url = escapeHtml(params.url);
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#374151">
<p>${inviter} at NR Accounting has invited you to the client portal for <strong>${company}</strong>.</p>
<p>The portal lets you view invoices and statements, upload documents and message your accountant.</p>
<p><a href="${url}" style="display:inline-block;background:#1E40AF;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold">Accept invitation</a></p>
<p style="font-size:12px;color:#6B7280">This link works once and expires in ${PORTAL_INVITE_TTL_DAYS} days. If the button does not work, copy this address into your browser:<br>${url}</p>
</div>`;
  const text = `${params.inviterName} at NR Accounting has invited you to the client portal for ${params.companyName}.\n\nAccept the invitation (works once, expires in ${PORTAL_INVITE_TTL_DAYS} days):\n${params.url}`;
  return { html, text };
}

/**
 * Sends the invitation email and shapes the HTTP response. Never claims the
 * email was sent when it was not: a failed send returns the email service's
 * own error (status + code) together with the invitation id so the firm can
 * resend once email works.
 */
async function sendInviteAndRespond(
  res: Response,
  params: {
    invitation: Invitation;
    rawToken: string;
    companyName: string;
    inviterName: string;
    successStatus: number;
  }
) {
  const url = acceptUrlFor(params.rawToken);
  const { html, text } = renderInviteEmail({
    companyName: params.companyName,
    inviterName: params.inviterName,
    url,
  });

  let result: SendEmailResult;
  try {
    result = await sendEmail(
      params.invitation.email,
      `You are invited to the ${params.companyName} client portal`,
      text,
      { fromName: "NR Accounting", html }
    );
  } catch (err: any) {
    result = { sent: false, code: "EMAIL_SEND_FAILED", error: err?.message };
  }

  const invitation = sanitizeInvitation(params.invitation);
  if (result.sent) {
    return res
      .status(params.successStatus)
      .json({ invitation, emailSent: true, ...devAcceptUrl(params.rawToken) });
  }

  const notConfigured = result.code === "EMAIL_NOT_CONFIGURED";
  log.warn({ invitationId: params.invitation.id, code: result.code }, "Portal invite email not sent");
  return res.status(notConfigured ? 503 : 502).json({
    message: result.error || "The invitation email could not be sent.",
    code: result.code ?? "EMAIL_SEND_FAILED",
    emailSent: false,
    invitation,
    ...devAcceptUrl(params.rawToken),
  });
}

async function loadPortalInvitation(req: Request, res: Response) {
  const invitation = (await storage.getInvitationById(req.params.invitationId)) ?? null;
  if (!invitation || invitation.userType !== PORTAL_USER_TYPE || !invitation.companyId) {
    res.status(404).json({ message: "Invitation not found" });
    return null;
  }
  const company = await loadAccessibleClientCompany(req, res, invitation.companyId);
  if (!company) return null;
  return { invitation, company };
}

export function registerPortalInviteRoutes(app: Express): void {
  const firmChain = [authMiddleware as any, requireNraAccess()];

  // Pending invitations + portal users for one client company.
  app.get(
    "/api/firm/clients/:companyId/portal",
    ...firmChain,
    asyncHandler(async (req: Request, res: Response) => {
      const company = await loadAccessibleClientCompany(req, res, req.params.companyId);
      if (!company) return;

      const [allInvitations, members] = await Promise.all([
        storage.getInvitationsByCompany(company.id),
        storage.getCompanyUserWithUser(company.id),
      ]);

      const pending = allInvitations
        .filter((i) => i.userType === PORTAL_USER_TYPE && i.status === "pending")
        .map((i) => sanitizeInvitation(i));

      const portalUsers = members
        .filter((m) => m.user.userType === PORTAL_USER_TYPE)
        .map((m) => ({
          id: m.user.id,
          email: m.user.email,
          name: m.user.name,
          active: !isUserDeactivated(m.user),
          lastLoginAt: m.user.lastLoginAt ?? null,
          createdAt: m.user.createdAt,
        }));

      res.json({ invitations: pending, users: portalUsers });
    })
  );

  // Invite a person to the client's portal.
  app.post(
    "/api/firm/clients/:companyId/portal-invitations",
    ...firmChain,
    asyncHandler(async (req: Request, res: Response) => {
      const company = await loadAccessibleClientCompany(req, res, req.params.companyId);
      if (!company) return;
      const { email } = inviteBodySchema.parse(req.body);
      const inviter = req.user as any;

      // Never convert or grant access to an account that already exists.
      const existing = (await storage.getUserByEmail(email)) ?? (await storage.getUserByEmail(String(req.body.email).trim()));
      if (existing) {
        return res.status(409).json({
          message:
            "An account with this email already exists, so it cannot be invited to the portal. Use a different email address.",
          code: "EMAIL_ALREADY_REGISTERED",
        });
      }

      // A new invite supersedes any earlier pending one for the same person.
      const previous = await storage.getInvitationsByCompany(company.id);
      for (const old of previous) {
        if (old.userType === PORTAL_USER_TYPE && old.status === "pending" && old.email === email) {
          await storage.updateInvitation(old.id, { status: "revoked" });
        }
      }

      const rawToken = generateInvitationToken();
      const invitation = await storage.createInvitation({
        email,
        companyId: company.id,
        role: PORTAL_COMPANY_ROLE,
        userType: PORTAL_USER_TYPE,
        token: hashInvitationToken(rawToken),
        invitedBy: inviter.id,
        status: "pending",
        expiresAt: invitationExpiry(),
      });

      await recordAudit({
        userId: inviter.id,
        companyId: company.id,
        action: "portal.invite",
        entityType: "invitation",
        entityId: invitation.id,
        after: { email, companyId: company.id },
        req,
      });

      const inviterRecord = await storage.getUser(inviter.id);
      return sendInviteAndRespond(res, {
        invitation,
        rawToken,
        companyName: company.name,
        inviterName: inviterRecord?.name || "Your accountant",
        successStatus: 201,
      });
    })
  );

  // Resend: fresh token and a fresh 7-day window; the old link stops working.
  app.post(
    "/api/firm/portal-invitations/:invitationId/resend",
    ...firmChain,
    asyncHandler(async (req: Request, res: Response) => {
      const loaded = await loadPortalInvitation(req, res);
      if (!loaded) return;
      const { invitation, company } = loaded;

      if (invitation.status === "accepted") {
        return res.status(409).json({ message: "This invitation was already accepted." });
      }
      const existing = await storage.getUserByEmail(invitation.email);
      if (existing) {
        return res.status(409).json({
          message: "An account with this email already exists.",
          code: "EMAIL_ALREADY_REGISTERED",
        });
      }

      const rawToken = generateInvitationToken();
      const updated = await storage.updateInvitation(invitation.id, {
        token: hashInvitationToken(rawToken),
        expiresAt: invitationExpiry(),
        status: "pending",
      });

      await recordAudit({
        userId: (req.user as any).id,
        companyId: company.id,
        action: "portal.invite_resend",
        entityType: "invitation",
        entityId: invitation.id,
        after: { email: invitation.email },
        req,
      });

      const inviterRecord = await storage.getUser((req.user as any).id);
      return sendInviteAndRespond(res, {
        invitation: updated,
        rawToken,
        companyName: company.name,
        inviterName: inviterRecord?.name || "Your accountant",
        successStatus: 200,
      });
    })
  );

  // Revoke a pending invitation.
  app.post(
    "/api/firm/portal-invitations/:invitationId/revoke",
    ...firmChain,
    asyncHandler(async (req: Request, res: Response) => {
      const loaded = await loadPortalInvitation(req, res);
      if (!loaded) return;
      const { invitation, company } = loaded;

      if (invitation.status === "accepted") {
        return res.status(409).json({
          message: "This invitation was already accepted. Deactivate the portal user instead.",
        });
      }

      const updated = await storage.updateInvitation(invitation.id, { status: "revoked" });
      await recordAudit({
        userId: (req.user as any).id,
        companyId: company.id,
        action: "portal.invite_revoke",
        entityType: "invitation",
        entityId: invitation.id,
        after: { email: invitation.email },
        req,
      });
      res.json({ invitation: sanitizeInvitation(updated) });
    })
  );

  // Deactivate / reactivate a portal user of this client company.
  for (const action of ["deactivate", "reactivate"] as const) {
    app.post(
      `/api/firm/clients/:companyId/portal-users/:userId/${action}`,
      ...firmChain,
      asyncHandler(async (req: Request, res: Response) => {
        const company = await loadAccessibleClientCompany(req, res, req.params.companyId);
        if (!company) return;

        const members = await storage.getCompanyUserWithUser(company.id);
        const member = members.find(
          (m) => m.userId === req.params.userId && m.user.userType === PORTAL_USER_TYPE
        );
        if (!member) {
          return res.status(404).json({ message: "Portal user not found for this client" });
        }

        await storage.setUserActive(member.user.id, action === "reactivate");
        if (action === "deactivate") {
          // Outstanding reset links must not survive deactivation.
          await storage.deletePasswordResetTokensForUser(member.user.id);
        }

        await recordAudit({
          userId: (req.user as any).id,
          companyId: company.id,
          action: `portal.user_${action}`,
          entityType: "user",
          entityId: member.user.id,
          after: { email: member.user.email },
          req,
        });
        res.json({ id: member.user.id, active: action === "reactivate" });
      })
    );
  }
}
