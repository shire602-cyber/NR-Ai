// Client-facing e-invoicing partner setup (reseller model).
//
// GET  /api/companies/:companyId/einvoice/partner             current partner + appointment state
// POST /api/companies/:companyId/einvoice/partner/accept-terms  owner/CFO accepts partner terms
// POST /api/companies/:companyId/einvoice/partner/confirm-emaratax  owner/CFO confirms EmaraTax appointment
// POST /api/companies/:companyId/einvoice/partner/revoke      owner/CFO switches e-invoicing off

import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { assertDirectCompanyPermission } from "../middleware/companyRolePolicy";
import { DomainError } from "../errors";
import { strictBody } from "../http/strict-body";
import { recordAudit } from "../services/audit.service";
import {
  acceptPartnerTermsBody,
  confirmEmaraTaxAppointmentBody,
  type AcceptPartnerTermsBody,
  type ConfirmEmaraTaxAppointmentBody,
} from "../../shared/validators/einvoice-partner";
import { lockOnboardingCompany } from "../services/einvoice/legal-entities";
import {
  acceptPartnerTerms,
  eInvoicePartner,
  appointmentState,
  confirmEmaraTaxAppointment,
  getAppointment,
  revokeAppointment,
} from "../services/einvoice-appointment.service";
import type { EInvoiceAspAppointment } from "../../shared/schema";

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

async function lockExpectedPartner(
  companyId: string,
  expectedProvider: string,
  tx: Pick<typeof db, "select">
) {
  const company = await lockOnboardingCompany(companyId, tx);
  if (!company || company.deletedAt) {
    throw new DomainError("NOT_FOUND", 404, undefined, "Company not found");
  }
  const partner = eInvoicePartner(company.einvoicePartner ?? undefined);
  if (partner.provider !== expectedProvider) {
    throw new DomainError(
      "EINVOICE_PROVIDER_MISMATCH",
      409,
      undefined,
      "The e-invoicing provider changed. Reload and review the current provider."
    );
  }
  return partner;
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
    strictBody(acceptPartnerTermsBody),
    asyncHandler(async (req, res) => {
      const { companyId } = req.params;
      const { expectedProvider, termsVersion }: AcceptPartnerTermsBody = req.body;
      const userId = req.user!.id;
      const response = await db.transaction(async (tx) => {
        const partner = await lockExpectedPartner(companyId, expectedProvider, tx);
        if (!partner.requiresAppointment) {
          throw new DomainError(
            "EINVOICE_PROVIDER_NOT_CONFIGURED",
            409,
            undefined,
            "No accredited e-invoicing partner is configured."
          );
        }
        if (!partner.termsUrl) {
          throw new DomainError(
            "EINVOICE_TERMS_NOT_CONFIGURED",
            409,
            undefined,
            "The partner's terms are not published yet, so they cannot be accepted."
          );
        }
        if (termsVersion !== partner.termsVersion) {
          throw new DomainError(
            "EINVOICE_TERMS_VERSION_MISMATCH",
            409,
            undefined,
            "The partner's terms changed while you were reading. Reload and review them."
          );
        }
        const appointment = await acceptPartnerTerms({ companyId, partner, userId }, tx);
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
          tx,
        });
        return {
          appointment: serialize(appointment),
          state: appointmentState(appointment, partner),
        };
      });
      res.json(response);
    })
  );

  app.post(
    "/api/companies/:companyId/einvoice/partner/confirm-emaratax",
    authMiddleware,
    requireCustomer,
    requireAppointmentAuthority,
    strictBody(confirmEmaraTaxAppointmentBody),
    asyncHandler(async (req, res) => {
      const { companyId } = req.params;
      const { expectedProvider, expectedAcceptanceRevision }: ConfirmEmaraTaxAppointmentBody =
        req.body;
      const userId = req.user!.id;
      const response = await db.transaction(async (tx) => {
        const partner = await lockExpectedPartner(companyId, expectedProvider, tx);
        const existing = await getAppointment(companyId, partner.provider, tx, "update");
        // Each acceptance advances termsAcceptedAt, including a re-acceptance of the same version.
        if (!existing || existing.termsAcceptedAt.toISOString() !== expectedAcceptanceRevision) {
          throw new DomainError(
            "EINVOICE_ACCEPTANCE_REVISION_MISMATCH",
            409,
            undefined,
            "The terms acceptance changed. Reload and review the appointment before confirming."
          );
        }
        const state = appointmentState(existing, partner);
        if (state !== "awaiting_emaratax" && state !== "active") {
          return {
            message: "Accept the partner's current terms first.",
            code: "EINVOICE_TERMS_REQUIRED",
            state,
          };
        }
        const appointment = await confirmEmaraTaxAppointment({ accepted: existing, userId }, tx);
        if (!appointment) {
          throw new DomainError(
            "EINVOICE_APPOINTMENT_REQUIRED",
            409,
            undefined,
            "The e-invoicing appointment changed. Reload and review it before confirming."
          );
        }
        await recordAudit({
          userId,
          companyId,
          action: "einvoice.partner_emaratax_confirmed",
          entityType: "einvoice_asp_appointment",
          entityId: appointment.id,
          after: { provider: partner.provider },
          req,
          tx,
        });
        return {
          appointment: serialize(appointment),
          state: appointmentState(appointment, partner),
        };
      });
      if ("code" in response) {
        return res.status(409).json(response);
      }
      res.json(response);
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
