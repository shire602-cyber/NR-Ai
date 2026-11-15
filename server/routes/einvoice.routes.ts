import { type Express, type Request, type Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { generateEInvoiceXML, validateForEInvoicing } from "../services/einvoice.service";
import { getEInvoiceProvider } from "../services/einvoice-provider";
import { submitEInvoice, refreshEInvoiceStatus } from "../services/einvoice-submit.service";
import { recordAudit } from "../services/audit.service";
import { createLogger } from "../config/logger";
import { findInvoiceForUser } from "./invoices.routes";

const log = createLogger("invoices");

// E-invoice endpoints moved verbatim from invoices.routes.ts (W3-A structure
// split, no behaviour change).
export function registerEInvoiceRoutes(app: Express) {
  // =====================================
  // E-Invoicing (PINT AE / UBL 2.1)
  // =====================================

  // Customer-only: Generate e-invoice XML for an invoice
  // Pre-submission validation: returns the fix-it list without generating.
  app.get(
    "/api/invoices/:id/einvoice/validate",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const lines = await storage.getInvoiceLinesByInvoiceId(id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      const issues = validateForEInvoicing(invoice, lines, company);
      res.json({ valid: issues.length === 0, issues });
    })
  );

  app.post(
    "/api/invoices/:id/generate-einvoice",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const lines = await storage.getInvoiceLinesByInvoiceId(id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      // A payload an ASP/FTA would reject must never be generated and stored.
      const issues = validateForEInvoicing(invoice, lines, company);
      if (issues.length > 0) {
        return res.status(422).json({
          message: "Invoice is not e-invoicing ready",
          code: "EINVOICE_VALIDATION_FAILED",
          issues,
        });
      }

      const customer = invoice.customerName
        ? { name: invoice.customerName, trn: invoice.customerTrn || undefined }
        : undefined;

      const { xml, uuid, hash } = generateEInvoiceXML(invoice, lines, company, customer);

      // Save e-invoice data to the invoice record
      await storage.updateInvoice(id, invoice.companyId, {
        einvoiceUuid: uuid,
        einvoiceXml: xml,
        einvoiceHash: hash,
        einvoiceStatus: "generated",
      });

      log.info({ id, uuid }, "Generated e-invoice");

      res.json({ uuid, hash, status: "generated" });
    })
  );

  // Customer-only: Get e-invoice XML for an invoice
  app.get(
    "/api/invoices/:id/einvoice-xml",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      if (!invoice.einvoiceXml) {
        return res
          .status(404)
          .json({ message: "E-invoice has not been generated for this invoice" });
      }

      res.set("Content-Type", "application/xml");
      res.set("Content-Disposition", `attachment; filename="einvoice-${invoice.number}.xml"`);
      res.send(invoice.einvoiceXml);
    })
  );

  // Customer-only: submit the e-invoice to the active ASP (provider-agnostic).
  app.post(
    "/api/invoices/:id/einvoice/submit",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      const lines = await storage.getInvoiceLinesByInvoiceId(id);
      const company = await storage.getCompany(invoice.companyId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      let provider;
      try {
        provider = getEInvoiceProvider();
      } catch (err: any) {
        // No accredited provider configured. Report this honestly as
        // "not available" rather than letting a mock fabricate an acceptance.
        return res.status(503).json({
          message: err?.message || "E-invoicing is not configured.",
          code: "EINVOICE_PROVIDER_NOT_CONFIGURED",
        });
      }
      const result = await submitEInvoice({ invoice, lines, company, provider });
      if (!result.ok) {
        return res
          .status(result.status)
          .json({ message: result.message, code: result.code, issues: result.issues });
      }

      await storage.updateInvoice(id, invoice.companyId, result.update as any);
      await recordAudit({
        userId,
        companyId: invoice.companyId,
        action: "invoice.einvoice_submit",
        entityType: "invoice",
        entityId: id,
        after: {
          provider: provider.name,
          providerMessageId: result.providerMessageId,
          status: result.update.einvoiceStatus,
        },
        req,
      });
      res.json({
        status: result.update.einvoiceStatus,
        provider: provider.name,
        providerMessageId: result.providerMessageId,
      });
    })
  );

  // Customer-only: poll the ASP for the latest clearance status.
  app.post(
    "/api/invoices/:id/einvoice/refresh-status",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const invoice = await findInvoiceForUser(userId, id);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      let provider;
      try {
        provider = getEInvoiceProvider();
      } catch (err: any) {
        // No accredited provider configured. Report this honestly as
        // "not available" rather than letting a mock fabricate an acceptance.
        return res.status(503).json({
          message: err?.message || "E-invoicing is not configured.",
          code: "EINVOICE_PROVIDER_NOT_CONFIGURED",
        });
      }
      const result = await refreshEInvoiceStatus({ invoice, provider });
      if (!result.ok) {
        return res.status(result.status).json({ message: result.message, code: result.code });
      }

      await storage.updateInvoice(id, invoice.companyId, result.update as any);
      res.json({
        status: result.update.einvoiceStatus,
        detail: result.update.einvoiceStatusDetail ?? null,
      });
    })
  );
}
