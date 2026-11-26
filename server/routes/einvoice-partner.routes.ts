// Client-facing e-invoicing partner setup (reseller model).
//
// GET  /api/companies/:companyId/einvoice/partner             current partner + appointment state
// POST /api/companies/:companyId/einvoice/partner/accept-terms  owner/CFO accepts partner terms
// POST /api/companies/:companyId/einvoice/partner/confirm-emaratax  owner/CFO confirms EmaraTax appointment
// POST /api/companies/:companyId/einvoice/partner/revoke      owner/CFO switches e-invoicing off

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { recordAudit } from "../services/audit.service";
import {
  APPOINTMENT_ROLES,
  acceptPartnerTerms,
  activeEInvoicePartner,
  appointmentState,
  confirmEmaraTaxAppointment,
  getAppointment,
  revokeAppointment,
} from "../services/einvoice-appointment.service";
import type { EInvoiceAspAppointment } from "../../shared/schema";

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

/** 403 unless the user can open the company; with `manage`, also requires owner/CFO. */
async function checkAccess(
  req: Request,
  res: Response,
  companyId: string,
  manage: boolean
): Promise<boolean> {
  const { id: userId, firmRole } = req.user!;
  if (!(await storage.hasCompanyAccess(userId, companyId, firmRole))) {
    res.status(403).json({ message: "Access denied" });
    return false;
  }
  if (!manage) return true;
  // Consent binds the client company to a third-party contract, so it must come
  // from the company's own owner or CFO — not firm staff or platform admins.
  const members = await storage.getCompanyUsersByCompanyId(companyId);
  const role = members.find((m) => m.userId === userId)?.role;
  if (!role || !APPOINTMENT_ROLES.has(role)) {
    res.status(403).json({
      message: "Only the company owner or CFO can set up e-invoicing.",
      code: "EINVOICE_APPOINTMENT_ROLE",
    });
    return false;
  }
  return true;
}

export function registerEInvoicePartnerRoutes(app: Express) {
  app.get(
    "/api/companies/:companyId/einvoice/partner",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await checkAccess(req, res, companyId, false))) return;
      const partner = activeEInvoicePartner();
      const appointment = await getAppointment(companyId, partner.provider);
      res.json({
        partner,
        appointment: serialize(appointment),
        state: appointmentState(appointment, partner),
      });
    })
  );

  app.post(
    "/api/companies/:companyId/einvoice/partner/accept-terms",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await checkAccess(req, res, companyId, true))) return;
      const parsed = acceptSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Tick the box to accept the partner's terms." });
      }
      const partner = activeEInvoicePartner();
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
      if (parsed.data.termsVersion !== partner.termsVersion) {
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
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await checkAccess(req, res, companyId, true))) return;
      if (!confirmSchema.safeParse(req.body).success) {
        return res
          .status(400)
          .json({ message: "Confirm that you appointed the partner in EmaraTax." });
      }
      const partner = activeEInvoicePartner();
      const existing = await getAppointment(companyId, partner.provider);
      const state = appointmentState(existing, partner);
      if (state === "not_started" || state === "revoked" || state === "terms_outdated") {
        return res.status(409).json({
          message: "Accept the partner's current terms first.",
          code: "EINVOICE_TERMS_REQUIRED",
          state,
        });
      }
      const userId = req.user!.id;
      const appointment = await confirmEmaraTaxAppointment({
        companyId,
        provider: partner.provider,
        userId,
      });
      await recordAudit({
        userId,
        companyId,
        action: "einvoice.partner_emaratax_confirmed",
        entityType: "einvoice_asp_appointment",
        entityId: appointment?.id,
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
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await checkAccess(req, res, companyId, true))) return;
      const partner = activeEInvoicePartner();
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
