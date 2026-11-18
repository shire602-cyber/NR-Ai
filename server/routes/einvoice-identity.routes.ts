/**
 * WQ5: e-invoicing identity, partner choice, the tax-ready prompt and approver links.
 *
 *   GET  /api/companies/:companyId/einvoicing/identity          tax identity block (+ missing)
 *   PUT  /api/companies/:companyId/einvoicing/identity          save (TIN / seller ID validated)
 *   GET  /api/companies/:companyId/einvoicing/tax-ready         should the first-invoice prompt show
 *   POST /api/companies/:companyId/einvoicing/tax-ready/shown   Skip / Continue: never show again
 *   GET  /api/companies/:companyId/einvoicing/partner           both partners + live one + state
 *   PUT  /api/companies/:companyId/einvoicing/partner           choose (no default)
 *   POST /api/companies/:companyId/einvoicing/partner/self-confirm
 *   GET  /api/companies/:companyId/einvoicing/approver-links
 *   POST /api/companies/:companyId/einvoicing/approver-links    create (URL returned once)
 *   POST /api/companies/:companyId/einvoicing/approver-links/:linkId/revoke
 *
 * No login (signed, expiring, single-purpose link; /api/portal/* is CSRF- and RBAC-exempt):
 *   GET  /api/portal/einvoicing-approve/:token        display name + EmaraTax steps
 *   POST /api/portal/einvoicing-approve/:token/done   mark done, tell the owner (outbox)
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { recordAudit } from "../services/audit.service";
import { enqueueEmail } from "../outbox";
import { escapeHtml } from "../services/email.service";
import { getEnv } from "../config/env";
import { createLogger } from "../config/logger";
import { portalGuard, notePortalFailure } from "./portal.public.routes";
import type { Company } from "../../shared/schema";
import {
  approverLinkCreateBody,
  companyTaxIdentityBody,
  emptyBody,
  partnerChoiceBody,
  type CompanyTaxIdentityBody,
} from "../../shared/validators/einvoice-identity";
import {
  approverLinkState,
  approverLinkView,
  approverNotifyRecipients,
  choosePartner,
  completeApproverLink,
  createApproverLink,
  findApproverLinkByToken,
  listApproverLinks,
  markTaxReadyPrompted,
  partnerView,
  publicApproverView,
  revokeApproverLink,
  saveTaxIdentity,
  selfConfirmAppointment,
  taxIdentityView,
  taxReadyState,
  touchApproverLink,
} from "../services/einvoice/identity";

const log = createLogger("einvoice-identity");

const selfConfirmBody = z.object({ confirmed: z.boolean() }).strict();

function appBaseUrl(): string {
  const env = getEnv();
  return (env.FRONTEND_URL || env.AUTH_PUBLIC_URL || "").replace(/\/+$/, "");
}

export function approverPageUrl(token: string): string {
  return `${appBaseUrl()}/portal/einvoicing-approve/${token}`;
}

async function loadCompany(companyId: string): Promise<Company> {
  const company = await storage.getCompany(companyId);
  if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404, undefined, "Company not found");
  return company;
}

const userOf = (req: Request): string => req.user!.id;

export function registerEInvoiceIdentityRoutes(app: Express) {
  // ─── Identity ────────────────────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/einvoicing/identity",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(taxIdentityView(await loadCompany(req.params.companyId)));
    })
  );

  app.put(
    "/api/companies/:companyId/einvoicing/identity",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(companyTaxIdentityBody),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await loadCompany(req.params.companyId);
      const body = parsedBody<CompanyTaxIdentityBody>(req);
      const saved = await saveTaxIdentity(company, body);
      await recordAudit({
        userId: userOf(req),
        companyId: company.id,
        action: "company.einvoicing_identity_update",
        entityType: "company",
        entityId: company.id,
        after: { fields: Object.keys(body) },
        req,
      });
      res.json(taxIdentityView(saved));
    })
  );

  // ─── Tax-ready prompt (mounted by the invoice editor) ─────────────────
  app.get(
    "/api/companies/:companyId/einvoicing/tax-ready",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(taxReadyState(await loadCompany(req.params.companyId)));
    })
  );

  app.post(
    "/api/companies/:companyId/einvoicing/tax-ready/shown",
    authMiddleware,
    requirePermission("documents.write"),
    strictBody(emptyBody),
    asyncHandler(async (req: Request, res: Response) => {
      await markTaxReadyPrompted(req.params.companyId);
      res.json(taxReadyState(await loadCompany(req.params.companyId)));
    })
  );

  // ─── Partner ─────────────────────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/einvoicing/partner",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await partnerView(await loadCompany(req.params.companyId)));
    })
  );

  app.put(
    "/api/companies/:companyId/einvoicing/partner",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(partnerChoiceBody),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await loadCompany(req.params.companyId);
      const { partner } = parsedBody<{ partner: string | null }>(req);
      await choosePartner(company.id, partner);
      await recordAudit({
        userId: userOf(req),
        companyId: company.id,
        action: "company.einvoicing_partner_choose",
        entityType: "company",
        entityId: company.id,
        before: { partner: company.einvoicePartner ?? null },
        after: { partner },
        req,
      });
      res.json(await partnerView(await loadCompany(company.id)));
    })
  );

  app.post(
    "/api/companies/:companyId/einvoicing/partner/self-confirm",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(selfConfirmBody),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await loadCompany(req.params.companyId);
      const { confirmed } = parsedBody<{ confirmed: boolean }>(req);
      await selfConfirmAppointment(company, userOf(req), confirmed);
      await recordAudit({
        userId: userOf(req),
        companyId: company.id,
        action: "company.einvoicing_appointment_self_confirm",
        entityType: "company",
        entityId: company.id,
        after: { confirmed, partner: company.einvoicePartner ?? null },
        req,
      });
      res.json(await partnerView(await loadCompany(company.id)));
    })
  );

  // ─── Approver links ──────────────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/einvoicing/approver-links",
    authMiddleware,
    requirePermission("settings.company"),
    asyncHandler(async (req: Request, res: Response) => {
      const rows = await listApproverLinks(req.params.companyId);
      res.json(rows.map(approverLinkView));
    })
  );

  app.post(
    "/api/companies/:companyId/einvoicing/approver-links",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(approverLinkCreateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await loadCompany(req.params.companyId);
      const body = parsedBody<{ approverName?: string | null; approverEmail?: string | null }>(req);
      const { link, token } = await createApproverLink({
        company,
        userId: userOf(req),
        approverName: body.approverName ?? null,
        approverEmail: body.approverEmail ?? null,
      });
      const url = approverPageUrl(token);
      let emailQueued = false;
      if (link.approverEmail) {
        try {
          await enqueueEmail({
            to: link.approverEmail,
            subject: `${company.name}: approve the e-invoicing partner in EmaraTax`,
            html: `<p>${escapeHtml(company.name)} asked you to approve its e-invoicing partner in EmaraTax.</p><p><a href="${escapeHtml(url)}">Open the steps</a> (the link expires in 14 days).</p>`,
            text: `${company.name} asked you to approve its e-invoicing partner in EmaraTax. Steps: ${url} (expires in 14 days).`,
            companyId: company.id,
            category: "einvoice_approver_link",
            relatedEntityType: "einvoice_approver_link",
            relatedEntityId: link.id,
            sensitive: true,
            idempotencyKey: `einvoice-approver-link:${link.id}`,
          });
          emailQueued = true;
        } catch (err) {
          log.warn({ err, companyId: company.id }, "Could not queue the approver email");
        }
      }
      await recordAudit({
        userId: userOf(req),
        companyId: company.id,
        action: "company.einvoicing_approver_link_create",
        entityType: "einvoice_approver_link",
        entityId: link.id,
        after: { expiresAt: link.expiresAt, emailed: emailQueued },
        req,
      });
      // The raw URL is returned once; only its hash is stored.
      res.status(201).json({ ...approverLinkView(link), url, emailQueued });
    })
  );

  app.post(
    "/api/companies/:companyId/einvoicing/approver-links/:linkId/revoke",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(emptyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const linkId = z.string().uuid().safeParse(req.params.linkId);
      if (!linkId.success) throw new DomainError("NOT_FOUND", 404, undefined, "Link not found");
      const row = await revokeApproverLink(req.params.companyId, linkId.data);
      await recordAudit({
        userId: userOf(req),
        companyId: req.params.companyId,
        action: "company.einvoicing_approver_link_revoke",
        entityType: "einvoice_approver_link",
        entityId: row.id,
        req,
      });
      res.json(approverLinkView(row));
    })
  );

  // ─── No-login approver page ──────────────────────────────────────────
  const resolveToken = async (req: Request, res: Response) => {
    const link = await findApproverLinkByToken(String(req.params.token ?? ""));
    if (!link) {
      notePortalFailure(req);
      res.status(404).json({ code: "NOT_FOUND", message: "This link is not valid." });
      return null;
    }
    return link;
  };

  app.get(
    "/api/portal/einvoicing-approve/:token",
    portalGuard("einvoice_approve"),
    asyncHandler(async (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      const link = await resolveToken(req, res);
      if (!link) return;
      const state = approverLinkState(link);
      if (state === "expired" || state === "revoked") {
        return res.status(410).json({ code: `LINK_${state.toUpperCase()}`, state });
      }
      if (state === "active") await touchApproverLink(link.id);
      res.json(await publicApproverView(link));
    })
  );

  app.post(
    "/api/portal/einvoicing-approve/:token/done",
    portalGuard("einvoice_approve"),
    strictBody(emptyBody),
    asyncHandler(async (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      const link = await resolveToken(req, res);
      if (!link) return;
      const state = approverLinkState(link);
      if (state === "expired" || state === "revoked") {
        return res.status(410).json({ code: `LINK_${state.toUpperCase()}`, state });
      }
      const done = state === "completed" ? link : await completeApproverLink(link);
      if (state === "active") {
        const view = await publicApproverView(done);
        const who = done.approverName || done.approverEmail || "Your approver";
        for (const to of await approverNotifyRecipients(done)) {
          try {
            await enqueueEmail({
              to,
              subject: `${view.companyName}: the e-invoicing partner approval is marked done`,
              html: `<p>${escapeHtml(who)} marked the EmaraTax approval step as done for ${escapeHtml(view.companyName)}.</p><p>Open Settings, E-invoicing to verify it with your partner.</p>`,
              text: `${who} marked the EmaraTax approval step as done for ${view.companyName}. Open Settings, E-invoicing to verify it with your partner.`,
              companyId: done.companyId,
              category: "einvoice_approver_done",
              relatedEntityType: "einvoice_approver_link",
              relatedEntityId: done.id,
              idempotencyKey: `einvoice-approver-done:${done.id}:${to}`,
            });
          } catch (err) {
            log.warn({ err, linkId: done.id }, "Could not queue the approver-done email");
          }
        }
        await recordAudit({
          userId: null,
          companyId: done.companyId,
          action: "company.einvoicing_approver_done",
          entityType: "einvoice_approver_link",
          entityId: done.id,
          req,
        });
      }
      res.json(await publicApproverView(done));
    })
  );
}
