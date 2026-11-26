// Client-facing e-invoicing partner setup (reseller model).
//
// GET  /api/companies/:companyId/einvoice/partner             current partner + appointment state
// POST /api/companies/:companyId/einvoice/partner/accept-terms  owner/CFO accepts partner terms
// POST /api/companies/:companyId/einvoice/partner/confirm-emaratax  owner/CFO confirms EmaraTax appointment
// POST /api/companies/:companyId/einvoice/partner/revoke      owner/CFO switches e-invoicing off

import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { assertDirectCompanyPermission } from "../middleware/companyRolePolicy";
import { DomainError } from "../errors";
import { strictBody } from "../http/strict-body";
import { recordAudit } from "../services/audit.service";
import { z } from "zod";
import {
  acceptPartnerTerms,
  eInvoicePartner,
  appointmentState,
  confirmEmaraTaxAppointment,
  getAppointment,
  revokeAppointment,
} from "../services/einvoice-appointment.service";
import type { EInvoiceAspAppointment } from "../../shared/schema";

// Shared validators — used by strictBody middleware.
const acceptSchema = z.object({ termsVersion: z.string().min(1), accepted: z.literal(true) });
const confirmSchema = z.object({ confirmed: z.literal(true) });

function serialize(appointment: EInvoiceAspAppointment | null) {
  if (!appointment) return null;
  return {
    provider: appointment.provider,
    termsVersion: appointment.termsVersion,
    termsAcceptedAt: appointment.termsAcceptedAt,
    emarataxConfirmedAt: appointment.emarataxConfirmedAt,
    revokedAt: appointment.revokedAt,
  };
}

async function loadPartner(companyId: string) {
  const company = await storage.getCompany(companyId);
  if (!company) throw new DomainError("NOT_FOUND", 404, undefined, "Company not found");
  return eInvoicePartner(company.einvoicePartner ?? undefined);
}

const requireAppointmentAuthority = asyncHandler(async (req, _res, next) => {
  await assertDirectCompanyPermission(req.user!, req.params.companyId, "settings.company");
  next();
});

export function registerEInvoicePartnerRoutes(app: Express) {
  // Read: any authenticated user who can access the company.
  app.get(
    "/api/companies/:companyId/einvoice/partner",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      // 404 (not 403) for another tenant's company — platform rule.
      if (!(await storage.hasCompanyAccess(req.user!.id, companyId, req.user!.firmRole))) {
        return res.status(404).json({ message: "Company not found" });
      }
      const partner = await loadPartner(companyId);
      const appointment = await getAppointment(companyId, partner.provider);
      res.json({
        partner,
        appointment: serialize(appointment),
        state: appointmentState(appointment, partner),
      });
    })
  );

  // Write: requires settings.company (owner + admin; former CFOs mapped to admin by 0092).
  app.post(
    "/api/companies/:companyId/einvoice/partner/accept-terms",
    authMiddleware,
    requireCustomer,
    requireAppointmentAuthority,
    strictBody(acceptSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const partner = await loadPartner(companyId);
      if (!partner.requiresAppointment) {
        return res.status(409).json({
          message: "No accredited e-invoicing partner is configured.",
          code: "EINVOICE_PROVIDER_NOT_CONFIGURED",
        });
      }
      if (!partner.termsUrl) {
        return res.status(409).json({
          message: "The partner's terms are not published yet, so they cannot be accepted.",
          code: "EINVOICE_TERMS_NOT_CONFIGURED",
        });
      }
      // Guard against accepting a version the user never saw.
      if (req.body.termsVersion !== partner.termsVersion) {
        return res.status(409).json({
          message: "The partner's terms changed while you were reading. Reload and review them.",
          code: "EINVOICE_TERMS_VERSION_MISMATCH",
        });
      }
      const userId = req.user!.id;
      const appointment = await acceptPartnerTerms({ companyId, partner, userId });
      await recordAudit({
        userId,
        companyId,
        action: "einvoice.partner_terms_accepted",
        entityType: "einvoice_asp_appointment",
        entityId: appointment.id,
        after: {
          provider: partner.provider,
          termsVersion: partner.termsVersion,
          termsUrl: partner.termsUrl,
        },
        req,
      });
      res.json({
        appointment: serialize(appointment),
        state: appointmentState(appointment, partner),
      });
    })
  );

  app.post(
    "/api/companies/:companyId/einvoice/partner/confirm-emaratax",
    authMiddleware,
    requireCustomer,
    requireAppointmentAuthority,
    strictBody(confirmSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const partner = await loadPartner(companyId);
      const existing = await getAppointment(companyId, partner.provider);
      const state = appointmentState(existing, partner);
      if (!existing || (state !== "awaiting_emaratax" && state !== "active")) {
        return res.status(409).json({
          message: "Accept the partner's current terms first.",
          code: "EINVOICE_TERMS_REQUIRED",
          state,
        });
      }
      const userId = req.user!.id;
      const appointment = await confirmEmaraTaxAppointment({
        accepted: existing,
        userId,
      });
      if (!appointment) {
        return res.status(409).json({
          message: "The e-invoicing appointment changed. Reload and review it before confirming.",
          code: "EINVOICE_APPOINTMENT_REQUIRED",
        });
      }
      await recordAudit({
        userId,
        companyId,
        action: "einvoice.partner_emaratax_confirmed",
        entityType: "einvoice_asp_appointment",
        entityId: appointment.id,
        after: { provider: partner.provider },
        req,
      });
      res.json({
        appointment: serialize(appointment),
        state: appointmentState(appointment, partner),
      });
    })
  );

  app.post(
    "/api/companies/:companyId/einvoice/partner/revoke",
    authMiddleware,
    requireCustomer,
    requireAppointmentAuthority,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const partner = await loadPartner(companyId);
      const userId = req.user!.id;
      const appointment = await revokeAppointment({
        companyId,
        provider: partner.provider,
        userId,
      });
      if (!appointment) {
        return res.status(404).json({ message: "E-invoicing is not set up for this company." });
      }
      await recordAudit({
        userId,
        companyId,
        action: "einvoice.partner_revoked",
        entityType: "einvoice_asp_appointment",
        entityId: appointment.id,
        after: { provider: partner.provider },
        req,
      });
      res.json({
        appointment: serialize(appointment),
        state: appointmentState(appointment, partner),
      });
    })
  );
}
