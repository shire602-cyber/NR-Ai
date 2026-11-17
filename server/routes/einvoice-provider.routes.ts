/**
 * Which accredited e-invoicing provider this deployment uses (E2), for the provider-aware
 * Settings → E-invoicing card.
 *
 *   GET /api/companies/:companyId/einvoicing/provider
 *
 * Answers `provider: null` unless EINVOICE_PROVIDER names a registered provider AND its
 * credentials are configured, so the UI never names or claims a provider that is not connected.
 * The card then loads that provider's own connection endpoint (…/einvoicing/<id>).
 */
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requirePermission } from "../middleware/companyRolePolicy";
import { DomainError } from "../errors";
import type { Company } from "../../shared/schema";
import { publicProviderInfo } from "../services/einvoice/providers/registry";
import { MOF_ASP_REGISTER_URL } from "../services/einvoice/providers/types";
import { companyTin } from "../services/einvoice/legal-entities";
import { EINVOICE_TIMELINE, einvoicingScope } from "../services/einvoice/scope";
import { reportWindowDays } from "../services/einvoice/tracks";

export function registerEInvoiceProviderRoutes(app: Express) {
  app.get(
    "/api/companies/:companyId/einvoicing/provider",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const company = (await storage.getCompany(req.params.companyId)) as
        | (Company & Record<string, unknown>)
        | undefined;
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const scope = einvoicingScope({
        einvoiceScope: (company.einvoiceScope as string | null) ?? null,
        einvoiceTurnoverBand: (company.einvoiceTurnoverBand as string | null) ?? null,
        einvoiceGoLiveDate: (company.einvoiceGoLiveDate as string | null) ?? null,
      });
      res.json({
        provider: publicProviderInfo(),
        registerUrl: MOF_ASP_REGISTER_URL,
        tin: companyTin(company as Company & { peppolParticipantId?: string | null }),
        goLive: { ...scope, timeline: EINVOICE_TIMELINE, reportWindowDays: reportWindowDays() },
      });
    })
  );
}
