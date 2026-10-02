import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { recordAudit } from "../services/audit.service";
import {
  applyAdvance,
  createAdvance,
  getAdvance,
  listAdvances,
  refundAdvance,
  removeApplication,
} from "../services/customer-advance.service";

const MAX_AMOUNT = 9_000_000_000_000;
const money = z.coerce.number().finite().positive().max(MAX_AMOUNT);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const createSchema = z.object({
  contactId: z.string().uuid(),
  date: ymd,
  /** Gross, VAT included. */
  amount: money,
  vatRate: z.coerce.number().finite().default(0.05),
  kind: z.enum(["advance", "deposit"]).default("advance"),
  // Advances are AED only (an advance must post at its own rate, an invoice posts at one rate).
  currency: z.string().trim().optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  salesOrderId: z.string().uuid().optional().nullable(),
  receive: z
    .object({
      paymentAccountId: z.string().uuid(),
      method: z.string().trim().max(40).optional().nullable(),
      reference: z.string().trim().max(120).optional().nullable(),
    })
    .optional()
    .nullable(),
});

const refundSchema = z.object({ amount: money, date: ymd, bankAccountId: z.string().uuid() });
const applySchema = z.object({ advanceId: z.string().uuid(), amount: money });

export function registerCustomerAdvanceRoutes(app: Express) {
  const guards = [authMiddleware, requireCustomer, requireCompanyAccess("params")];

  app.get(
    "/api/companies/:companyId/customer-advances",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const contactId = typeof req.query.contactId === "string" ? req.query.contactId : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      res.json(await listAdvances(companyId, { contactId, status }));
    })
  );

  app.get(
    "/api/companies/:companyId/customer-advances/:id",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const advance = await getAdvance(req.params.companyId, req.params.id);
      if (!advance) return res.status(404).json({ message: "Advance not found", code: "ADVANCE_NOT_FOUND" });
      res.json(advance);
    })
  );

  app.post(
    "/api/companies/:companyId/customer-advances",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { currency, ...input } = createSchema.parse(req.body ?? {});
      if (currency && currency.toUpperCase() !== "AED") {
        return res.status(422).json({ message: "Advances are AED only.", code: "ADVANCE_CURRENCY_UNSUPPORTED" });
      }
      const result = await createAdvance({ companyId, userId, ...input, vatRate: input.vatRate });
      await recordAudit({
        userId,
        companyId,
        action: "customer_advance.create",
        entityType: "customer_advance",
        entityId: result.advance.id,
        before: null,
        after: { number: result.advance.number, gross: result.advance.grossAmount, kind: result.advance.kind },
        req,
      });
      res.status(201).json(result);
    })
  );

  app.post(
    "/api/companies/:companyId/customer-advances/:id/refund",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = (req as any).user.id;
      const input = refundSchema.parse(req.body ?? {});
      const result = await refundAdvance({ companyId, advanceId: id, userId, ...input });
      await recordAudit({
        userId,
        companyId,
        action: "customer_advance.refund",
        entityType: "customer_advance",
        entityId: id,
        before: null,
        after: { creditNoteId: result.creditNote.id, amount: input.amount },
        req,
      });
      res.status(201).json(result);
    })
  );

  // Apply an advance to a DRAFT invoice (the invoice is resolved first, then authorised like its neighbours).
  app.post(
    "/api/invoices/:id/advance-applications",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const invoice = await storage.getInvoiceById(req.params.id);
      if (!invoice || !(await storage.hasCompanyAccess(userId, invoice.companyId))) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const input = applySchema.parse(req.body ?? {});
      const result = await applyAdvance({ companyId: invoice.companyId, invoiceId: invoice.id, userId, ...input });
      res.status(201).json(result);
    })
  );

  app.delete(
    "/api/invoices/:id/advance-applications/:applicationId",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const invoice = await storage.getInvoiceById(req.params.id);
      if (!invoice || !(await storage.hasCompanyAccess(userId, invoice.companyId))) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const result = await removeApplication({
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        applicationId: req.params.applicationId,
      });
      res.json(result);
    })
  );
}
