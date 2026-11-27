/**
 * WQ7: Assistant › Automations switches and document numbering settings.
 *
 *   GET  /api/companies/:companyId/automations            each automation: on/off, last run,
 *                                                         last result, next run
 *   PUT  /api/companies/:companyId/automations/:key       { enabled } (settings.company)
 *   GET  /api/companies/:companyId/numbering              prefix, padding, yearly reset, next
 *   PUT  /api/companies/:companyId/numbering/:docType     save (settings.company); next number
 *                                                         only moves forward (409 otherwise)
 */
import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { storage } from "../storage";
import { DomainError } from "../errors";
import { recordAudit } from "../services/audit.service";
import { zUuid } from "../../shared/validators/primitives";
import {
  automationSwitchBody,
  numberingSettingsBody,
  type NumberingSettingsBody,
} from "../../shared/validators/plans";
import {
  isCompanyAutomationKey,
  listCompanyAutomations,
  registerAutomationServices,
  setAutomationEnabled,
} from "../platform/company-automations";
import {
  NUMBERED_DOC_TYPES,
  numberingView,
  saveNumberingSettings,
  type InvoiceDocType,
} from "../services/invoice-numbering.service";

/** Another tenant's company (or an unknown id) is a 404, never a 403. */
async function requireMember(req: Request): Promise<string> {
  const { companyId } = req.params;
  if (!zUuid.safeParse(companyId).success) throw new DomainError("NOT_FOUND", 404);
  if (!(await storage.hasCompanyAccess(req.user!.id, companyId))) {
    throw new DomainError("NOT_FOUND", 404);
  }
  return companyId;
}

export function registerCompanyAutomationRoutes(app: Express) {
  // automations.isEnabled / automations.recordRun for jobs owned elsewhere (WQ3 depreciation).
  registerAutomationServices();
  app.get(
    "/api/companies/:companyId/automations",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await requireMember(req);
      res.json({ automations: await listCompanyAutomations(companyId) });
    })
  );

  app.put(
    "/api/companies/:companyId/automations/:key",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    strictBody(automationSwitchBody),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await requireMember(req);
      const { key } = req.params;
      if (!isCompanyAutomationKey(key)) {
        throw new DomainError("AUTOMATION_NOT_FOUND", 404, { key }, "Unknown automation");
      }
      const { enabled } = parsedBody<{ enabled: boolean }>(req);
      await setAutomationEnabled(companyId, key, enabled, req.user!.id);
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: enabled ? "automation.enable" : "automation.disable",
        entityType: "company_automation",
        entityId: companyId,
        after: { key, enabled },
        req,
      });
      const all = await listCompanyAutomations(companyId);
      res.json(all.find((a) => a.key === key));
    })
  );

  app.get(
    "/api/companies/:companyId/numbering",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await requireMember(req);
      res.json({
        numbering: await Promise.all(NUMBERED_DOC_TYPES.map((d) => numberingView(companyId, d))),
      });
    })
  );

  app.put(
    "/api/companies/:companyId/numbering/:docType",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    strictBody(numberingSettingsBody),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = await requireMember(req);
      const docType = req.params.docType as InvoiceDocType;
      if (!NUMBERED_DOC_TYPES.includes(docType)) {
        throw new DomainError("DOC_TYPE_NOT_FOUND", 404, { docType }, "Unknown document type");
      }
      const body = parsedBody<NumberingSettingsBody>(req);
      const before = await numberingView(companyId, docType);
      const after = await saveNumberingSettings(companyId, docType, body, req.user!.id);
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "numbering.update",
        entityType: "document_numbering",
        entityId: companyId,
        before,
        after,
        req,
      });
      res.json(after);
    })
  );
}
