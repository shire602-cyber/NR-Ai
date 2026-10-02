import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { storage } from "../storage";
import { calendarDaySchema } from "../utils/calendar-day-schema";
import { recordAudit } from "../services/audit.service";
import { createRefund, getRefundSummary, listRefunds, voidRefund } from "../services/customer-refund.service";
import {
  getCustomerCreditBalance,
  listCustomerCreditRefunds,
  refundCustomerCredit,
  voidCustomerCreditRefundAny,
} from "../services/customer-credit-refund.service";
import { listInvoiceRefunds, refundableCreditNotes, refundInvoicePayment, voidInvoiceRefund } from "../services/payment-refund.service";

const MAX_REFUND_AMOUNT = 999_999_999.99;

const refundInputSchema = z.object({
  amount: z.coerce.number().finite().positive().max(MAX_REFUND_AMOUNT),
  date: calendarDaySchema.optional(),
  bankAccountId: z.string().uuid(),
  exchangeRate: z.coerce.number().finite().positive().max(1_000_000).optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export function registerCustomerRefundRoutes(app: Express) {
  const guards = [authMiddleware, requireCustomer, requireFeature("creditNotes")];

  // Refund (part of) a payment of a settled invoice that was paid back outside the app (bank transfer, card or gateway
  // refund): a credit note on the invoice plus the refund of it, so the statement and the ageing show it.
  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/payment-refunds",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const input = refundInputSchema.parse(req.body ?? {});
      const result = await refundInvoicePayment({ companyId, invoiceId, userId, ...input });
      await recordAudit({
        userId,
        companyId,
        action: "invoice.payment_refund",
        entityType: "invoice",
        entityId: invoiceId,
        before: null,
        after: { refundIds: result.refunds.map((r) => r.id), amount: input.amount, remaining: result.remaining },
        req,
      });
      res.status(201).json({ refund: result.refund, refunds: result.refunds, remaining: result.remaining });
    })
  );

  // The refunds paid on an invoice (live and void) and what can still be refunded: the payments list shows them with a Void action.
  app.get(
    "/api/companies/:companyId/invoices/:invoiceId/payment-refunds",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId } = req.params;
      if (!(await storage.hasCompanyAccess((req as any).user.id, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!(await storage.getInvoice(invoiceId, companyId))) return res.status(404).json({ message: "Invoice not found" });
      const [refunds, available] = await Promise.all([listInvoiceRefunds(companyId, invoiceId), refundableCreditNotes(companyId, invoiceId)]);
      res.json({ refunds, refundable: Math.round(available.reduce((s, c) => s + c.refundable, 0) * 100) / 100 });
    })
  );

  // Void a refund from the invoice's payments list: reverses its journal and restores the credit balance.
  app.post(
    "/api/companies/:companyId/invoices/:invoiceId/payment-refunds/:refundId/void",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, invoiceId, refundId } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const result = await voidInvoiceRefund({ companyId, invoiceId, refundId, userId });
      await recordAudit({
        userId,
        companyId,
        action: "invoice.payment_refund_void",
        entityType: "invoice",
        entityId: invoiceId,
        before: { refundId },
        after: { voidedAt: result.refund.voidedAt },
        req,
        extra: { reversalEntryId: result.reversalEntryId },
      });
      res.json({ refund: result.refund });
    })
  );

  // The customer's credit balance (overpayments held in 2050) and the refunds paid out of it.
  app.get(
    "/api/companies/:companyId/customers/:contactId/credit",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, contactId } = req.params;
      if (!(await storage.hasCompanyAccess((req as any).user.id, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const [balance, refunds] = await Promise.all([getCustomerCreditBalance(companyId, contactId), listCustomerCreditRefunds(companyId, contactId)]);
      res.json({ balance, refunds });
    })
  );

  // Pay (part of) the customer's credit balance back.
  app.post(
    "/api/companies/:companyId/customers/:contactId/credit-refunds",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, contactId } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const input = refundInputSchema.omit({ exchangeRate: true }).parse(req.body ?? {});
      const result = await refundCustomerCredit({ companyId, contactId, userId, ...input });
      await recordAudit({
        userId,
        companyId,
        action: "customer_credit.refund",
        entityType: "customer",
        entityId: contactId,
        before: null,
        after: { refundIds: result.refunds.map((r: any) => r.id), amount: input.amount, remaining: result.remaining },
        req,
      });
      res.status(201).json({ refund: result.refund, refunds: result.refunds, remaining: result.remaining });
    })
  );

  app.post(
    "/api/companies/:companyId/customers/:contactId/credit-refunds/:refundId/void",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, contactId, refundId } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const result = await voidCustomerCreditRefundAny({ companyId, contactId, refundId, userId });
      await recordAudit({
        userId,
        companyId,
        action: "customer_credit.refund_void",
        entityType: "customer",
        entityId: contactId,
        before: { refundId },
        after: { voidedAt: result.refund.voidedAt },
        req,
        extra: { reversalEntryId: result.reversalEntryId },
      });
      res.json({ refund: result.refund, balance: await getCustomerCreditBalance(companyId, contactId) });
    })
  );

  // The credit note's refunds and what is still refundable.
  app.get(
    "/api/companies/:companyId/credit-notes/:id/refunds",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      if (!(await storage.hasCompanyAccess((req as any).user.id, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const [refunds, summary] = await Promise.all([listRefunds(companyId, id), getRefundSummary(companyId, id)]);
      res.json({ refunds, summary });
    })
  );

  // Pay cash back to the customer against an issued credit note.
  app.post(
    "/api/companies/:companyId/credit-notes/:id/refunds",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const input = refundInputSchema.parse(req.body ?? {});
      const result = await createRefund({
        companyId,
        creditNoteId: id,
        userId,
        amount: input.amount,
        date: input.date,
        bankAccountId: input.bankAccountId,
        exchangeRate: input.exchangeRate,
        reference: input.reference,
        notes: input.notes,
      });
      await recordAudit({
        userId,
        companyId,
        action: "credit_note.refund",
        entityType: "invoice",
        entityId: id,
        before: null,
        after: { refundId: result.refund.id, amount: result.refund.amount, remaining: result.remaining },
        req,
        extra: { journalEntryId: result.journalEntryId },
      });
      res.status(201).json({ refund: result.refund, remaining: result.remaining });
    })
  );

  // Void a refund: reverses its journal entry and gives the amount back to the credit note.
  app.post(
    "/api/companies/:companyId/credit-notes/:id/refunds/:refundId/void",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id, refundId } = req.params;
      const userId = (req as any).user.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const result = await voidRefund({ companyId, creditNoteId: id, refundId, userId });
      await recordAudit({
        userId,
        companyId,
        action: "credit_note.refund_void",
        entityType: "invoice",
        entityId: id,
        before: { refundId },
        after: { voidedAt: result.refund.voidedAt },
        req,
        extra: { reversalEntryId: result.reversalEntryId },
      });
      const summary = await getRefundSummary(companyId, id);
      res.json({ refund: result.refund, summary });
    })
  );
}
