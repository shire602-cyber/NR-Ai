import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { storage } from "../storage";
import { recordAudit } from "../services/audit.service";
import { createRefund, getRefundSummary, listRefunds, voidRefund } from "../services/customer-refund.service";

const MAX_REFUND_AMOUNT = 999_999_999.99;

const refundInputSchema = z.object({
  amount: z.coerce.number().finite().positive().max(MAX_REFUND_AMOUNT),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .optional(),
  bankAccountId: z.string().uuid(),
  exchangeRate: z.coerce.number().finite().positive().max(1_000_000).optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export function registerCustomerRefundRoutes(app: Express) {
  const guards = [authMiddleware, requireCustomer, requireFeature("creditNotes")];

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
