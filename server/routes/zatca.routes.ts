/**
 * ZATCA (KSA) Phase 2 e-invoicing routes (R07-14). Built to the Fatoora
 * boundary: with no ZATCA_ENV every endpoint answers 503 ZATCA_NOT_CONFIGURED,
 * and nothing is ever reported as cleared or reported unless ZATCA said so.
 */
import { type Express, type Request, type Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { storage } from "../storage";
import { getCapability } from "../../shared/capabilities";
import { zText, zUuid } from "../../shared/validators/primitives";
import { recordAudit } from "../services/audit.service";
import { ZatcaClient, requireZatcaConfig, zatcaConfig } from "../services/zatca/client";
import {
  createEgsUnit,
  listEgsUnits,
  listZatcaDocuments,
  onboardEgsUnit,
  submitInvoiceToZatca,
  transmitDocument,
} from "../services/zatca/service";

const userOf = (req: Request): string => (req as Request & { user: { id: string } }).user.id;

/** The body after `strictBody(schema)` replaced it with the parsed, canonical value. */
function validated<T>(req: Request): T {
  return req.body as T;
}

const addressSchema = z
  .object({
    street: zText(127, { min: 1 }),
    buildingNumber: z.string().regex(/^\d{4}$/, "Building number is 4 digits"),
    district: zText(127, { min: 1 }),
    city: zText(127, { min: 1 }),
    postalZone: z.string().regex(/^\d{5}$/, "Postal code is 5 digits"),
  })
  .strict();

const createEgsBody = z
  .object({
    name: zText(60, { min: 1 }),
    vatNumber: z
      .string()
      .regex(/^3\d{13}3$/, "KSA VAT number: 15 digits starting and ending with 3"),
    organizationName: zText(200, { min: 1 }),
    organizationUnit: zText(200, { min: 1 }),
    invoiceTypes: z.enum(["1000", "0100", "1100"]),
    locationAddress: zText(200, { min: 1 }),
    industry: zText(100, { min: 1 }),
    seller: z
      .object({
        nameAr: zText(200, { min: 1 }).refine((v) => /[؀-ۿ]/.test(v), "Arabic name required"),
        nameEn: zText(200).nullable().optional(),
        crn: z
          .string()
          .regex(/^\d{10}$/, "Commercial registration number is 10 digits")
          .nullable()
          .optional(),
        address: addressSchema,
      })
      .strict(),
  })
  .strict();

const onboardBody = z.object({ otp: z.string().regex(/^\d{6}$/, "OTP is 6 digits") }).strict();
const submitBody = z.object({ egsUnitId: zUuid }).strict();

function client(): ZatcaClient {
  return new ZatcaClient(requireZatcaConfig());
}

export function registerZatcaRoutes(app: Express) {
  app.get(
    "/api/companies/:companyId/zatca/status",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const cfg = zatcaConfig();
      const capability = getCapability("zatca");
      if (!cfg) {
        return res.status(503).json({
          code: "ZATCA_NOT_CONFIGURED",
          message: "ZATCA e-invoicing is not configured. Not onboarded — requires a Fatoora OTP.",
          capability,
          onboarded: false,
        });
      }
      const units = await listEgsUnits(req.params.companyId);
      res.json({
        configured: true,
        environment: cfg.environment,
        capability,
        onboarded: units.some((u) => u.status === "production"),
        egsUnits: units,
      });
    })
  );

  app.post(
    "/api/companies/:companyId/zatca/egs-units",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(createEgsBody),
    asyncHandler(async (req: Request, res: Response) => {
      const cfg = requireZatcaConfig();
      const body = validated<z.output<typeof createEgsBody>>(req);
      const egs = await createEgsUnit(req.params.companyId, body, cfg.environment);
      await recordAudit({
        userId: userOf(req),
        companyId: req.params.companyId,
        action: "zatca.egs_created",
        entityType: "zatca_egs_unit",
        entityId: egs.id,
        after: { name: egs.name, environment: egs.environment },
        req,
      });
      res.status(201).json(egs);
    })
  );

  app.post(
    "/api/companies/:companyId/zatca/egs-units/:egsUnitId/onboard",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(onboardBody),
    asyncHandler(async (req: Request, res: Response) => {
      const zc = client();
      const { otp } = validated<z.output<typeof onboardBody>>(req);
      const result = await onboardEgsUnit(req.params.companyId, req.params.egsUnitId, otp, zc);
      await recordAudit({
        userId: userOf(req),
        companyId: req.params.companyId,
        action: "zatca.egs_onboarded",
        entityType: "zatca_egs_unit",
        entityId: req.params.egsUnitId,
        after: { environment: zc.environment, status: result.egs.status },
        req,
      });
      res.json(result);
    })
  );

  app.get(
    "/api/companies/:companyId/zatca/documents",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      requireZatcaConfig();
      res.json({ items: await listZatcaDocuments(req.params.companyId) });
    })
  );

  app.post(
    "/api/companies/:companyId/zatca/invoices/:invoiceId/submit",
    authMiddleware,
    requirePermission("tax.submit"),
    strictBody(submitBody),
    asyncHandler(async (req: Request, res: Response) => {
      const zc = client();
      const company = await storage.getCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const { egsUnitId } = validated<z.output<typeof submitBody>>(req);
      const doc = await submitInvoiceToZatca({
        company,
        invoiceId: req.params.invoiceId,
        egsId: egsUnitId,
        client: zc,
      });
      await recordAudit({
        userId: userOf(req),
        companyId: company.id,
        action: "zatca.invoice_submitted",
        entityType: "invoice",
        entityId: req.params.invoiceId,
        after: { status: doc.status, icv: doc.icv, environment: zc.environment },
        req,
      });
      const { signed_xml: _xml, ...rest } = doc;
      res.status(doc.status === "rejected" ? 422 : 200).json(rest);
    })
  );

  app.post(
    "/api/companies/:companyId/zatca/documents/:zatcaDocumentId/retry",
    authMiddleware,
    requirePermission("tax.submit"),
    asyncHandler(async (req: Request, res: Response) => {
      const zc = client();
      const doc = await transmitDocument(req.params.companyId, req.params.zatcaDocumentId, zc);
      const { signed_xml: _xml, ...rest } = doc;
      res.json(rest);
    })
  );
}
