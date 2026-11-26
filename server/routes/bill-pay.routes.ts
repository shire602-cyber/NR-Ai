/**
 * Vendor bills (W3-B). State machine draft → pending → approved → partial → paid, plus rejected
 * and void; every transition is one conditional update in the same ledger transaction as its
 * journal. Payments only on approved / partial bills (R04-01); approved bills are corrected by
 * POST /bills/:id/revise (kernel reversal + repost, R04-02) or voided (R04-08).
 */
import { journalMemo } from "@shared/journal-memo";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { requirePermission } from "../middleware/companyRolePolicy";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { storage } from "../storage";
import { pool } from "../db";
import { createLogger } from "../config/logger";
import { DomainError } from "../errors";
import { assertRetentionExpired } from "../services/retention.service";
import { recordAudit } from "../services/audit.service";
import { emitDomainEventInTx } from "../platform/event-outbox";
import {
  assertTransition,
  loadBaseCurrency,
  postJournal,
  transitionRow,
  withLedgerTx,
} from "../ledger";
import {
  BILL_PAYMENT_JE_SOURCE,
  billHasPostedJournal,
  billMachine,
  filsOf,
  isForeign,
  planBillJournal,
  postBillJournal,
  rateTextOf,
  requireApAccount,
  reverseBillJournal,
  toBase,
  txRows,
  vendorBillsTable,
  type BillRow,
} from "../services/bill-posting.service";
import {
  applyBillRevision,
  applyDebitNote,
  applyPrepayment,
  batchPaymentCsv,
  createBill,
  createDebitNote,
  createDraftFromParsedInbound,
  createVendorCreditFromInbound,
  createPrepayment,
  createRecurringBill,
  prepareBillRevision,
  recordBillPayment,
  registerBillServices,
  resolvePaymentAccount,
  runRecurringBill,
  updateBillInPlace,
  voidBillPayment,
} from "../services/bill-payment.service";
import {
  actorFromRequest,
  assertCompanyPermission,
  clearApprovalDecisions,
  evaluateApproval,
} from "../services/approval-rules.service";
import { payablesAging } from "../services/vendor.service";
import {
  applyCreditSchema,
  batchPaymentExportSchema,
  billAttachmentSchema,
  billCaptureSchema,
  billCreateSchema,
  billOptionalReasonSchema,
  billPaymentSchema,
  billReasonSchema,
  billReviseSchema,
  billUpdateSchema,
  debitNoteCreateSchema,
  inboundBillSchema,
  inboundVendorCreditSchema,
  prepaymentCreateSchema,
  recurringBillCreateSchema,
  type BillCreateInput,
  type BillPaymentInput,
  type BillReviseInput,
  type BillUpdateInput,
  type InboundVendorCreditInput,
} from "../../shared/validators/bills";
import { zUuid } from "../../shared/validators/primitives";
import { fromFils, toFils } from "../../shared/money";
import { receipts } from "../../shared/schema";
import { scopedGet } from "../tenancy";
import { parseReportDate, uaeToday } from "../reporting";
import { readReceiptImage } from "../services/fileStorage";
import { captureBillFromDocument, storePurchaseFile } from "../services/bill-capture.service";
import { withOcrDeadline } from "../http/ocr-deadline";
import { billApprovalQueue } from "../services/bill-approval-queue";
import { docRateSql, payableOpenSql, payableSettledSql } from "../reporting/settlement";

const log = createLogger("bill-pay");

/** Load a bill the caller may act on; another tenant's bill is a 404 (never 403). */
async function loadBill(req: Request): Promise<BillRow & Record<string, unknown>> {
  const { id } = req.params;
  if (!zUuid.safeParse(id).success)
    throw new DomainError("BILL_NOT_FOUND", 404, undefined, "Bill not found");
  const r = await pool.query("SELECT * FROM vendor_bills WHERE id = $1", [id]);
  const bill = r.rows[0];
  if (!bill) throw new DomainError("BILL_NOT_FOUND", 404, undefined, "Bill not found");
  const ok = await storage.hasCompanyAccess(req.user!.id, bill.company_id);
  if (!ok) throw new DomainError("BILL_NOT_FOUND", 404, undefined, "Bill not found");
  return bill;
}

async function assertCompanyAccess(req: Request, companyId: string) {
  const ok = await storage.hasCompanyAccess(req.user!.id, companyId);
  if (!ok) throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
}

const todayIso = () => uaeToday();

function displayStatus(bill: Record<string, unknown>): {
  is_overdue: boolean;
  display_status: string;
} {
  const status = String(bill.status ?? "pending");
  const open = filsOf(bill.total_amount as string) - filsOf(bill.amount_paid as string);
  const due = bill.due_date ? new Date(bill.due_date as string).toISOString().slice(0, 10) : null;
  const isOverdue =
    ["approved", "partial", "overdue"].includes(status) && open > 0 && !!due && due < todayIso();
  return {
    is_overdue: isOverdue,
    display_status: isOverdue ? "overdue" : status === "overdue" ? "approved" : status,
  };
}

async function billWithLines(billId: string) {
  const [b, l, p] = await Promise.all([
    pool.query("SELECT * FROM vendor_bills WHERE id = $1", [billId]),
    pool.query("SELECT * FROM bill_line_items WHERE bill_id = $1 ORDER BY created_at ASC", [
      billId,
    ]),
    pool.query(
      "SELECT * FROM bill_payments WHERE bill_id = $1 ORDER BY payment_date DESC, created_at DESC",
      [billId]
    ),
  ]);
  const bill = b.rows[0];
  return {
    ...bill,
    ...displayStatus(bill),
    has_attachment: !!bill.attachment_path,
    line_items: l.rows,
    payments: p.rows,
  };
}

export function registerBillPayRoutes(app: Express) {
  registerBillServices();

  // ── List ────────────────────────────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/bills",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const { status, vendor, vendor_id, dateFrom, dateTo } = req.query;
      // Open balance from the one settlement rule (server/reporting/settlement.ts): total less
      // Σ bill_payments (payments, prepayments, vendor-credit applications, reversals).
      let query = `SELECT vendor_bills.*,
                          ${payableOpenSql("vendor_bills")}::float8 AS open_balance,
                          (ROUND(${payableOpenSql("vendor_bills")} * ${docRateSql("vendor_bills")} * 100)::bigint / 100.0)::float8 AS open_balance_base
                     FROM vendor_bills WHERE company_id = $1`;
      const params: unknown[] = [companyId];
      const add = (cond: string, v: unknown) => {
        params.push(v);
        query += ` AND ${cond.replace("?", `$${params.length}`)}`;
      };
      if (typeof status === "string" && status && status !== "all") {
        if (status === "overdue") {
          add("status = ANY(?)", ["approved", "partial", "overdue"]);
          add("due_date::date < ?::date", todayIso());
          query += " AND total_amount > amount_paid";
        } else add("status = ?", status);
      }
      if (typeof vendor === "string" && vendor) add("vendor_name ILIKE ?", `%${vendor}%`);
      if (typeof vendor_id === "string" && zUuid.safeParse(vendor_id).success)
        add("vendor_id = ?", vendor_id);
      const from = parseReportDate(dateFrom, "dateFrom");
      const to = parseReportDate(dateTo, "dateTo");
      if (from) add("bill_date::date >= ?::date", from);
      if (to) add("bill_date::date <= ?::date", to);
      query += ` ORDER BY bill_date DESC, created_at DESC`;
      const result = await pool.query(query, params);
      res.json(
        (result.rows as Array<Record<string, unknown>>).map((b) => ({
          ...b,
          ...displayStatus(b),
          has_attachment: !!b.attachment_path,
        }))
      );
    })
  );

  app.get(
    "/api/companies/:companyId/bills/all-payments",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const { cursor, limit } = z
        .object({
          cursor: zUuid.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .parse(req.query);
      const { rows } = await pool.query(
        `SELECT p.id, p.bill_id, p.payment_date::date::text AS payment_date, p.amount,
                p.payment_method, p.reference, p.kind, p.status,
                b.vendor_name, b.bill_number, b.currency
           FROM bill_payments p JOIN vendor_bills b ON b.id = p.bill_id
          WHERE b.company_id = $1
            AND ($2::uuid IS NULL OR (p.payment_date, p.id) < (
              SELECT pivot.payment_date, pivot.id
                FROM bill_payments pivot JOIN vendor_bills owner ON owner.id = pivot.bill_id
               WHERE pivot.id = $2 AND owner.company_id = $1
            ))
          ORDER BY p.payment_date DESC, p.id DESC LIMIT $3`,
        [companyId, cursor ?? null, limit + 1]
      );
      const items = rows.slice(0, limit);
      res.json({ items, nextCursor: rows.length > limit ? items[items.length - 1].id : null });
    })
  );

  // ── Read one ────────────────────────────────────────────────────────────
  app.get(
    "/api/bills/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const bill = await loadBill(req);
      res.json(await billWithLines(bill.id));
    })
  );

  // ── Create ──────────────────────────────────────────────────────────────
  app.post(
    "/api/companies/:companyId/bills",
    authMiddleware,
    requireCustomer,
    strictBody(billCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const body = parsedBody<BillCreateInput>(req);
      const result = await createBill({ companyId, actorId: req.user!.id, input: body });
      log.info({ billId: result.bill.id, companyId }, "Vendor bill created");
      res.json({
        ...result.bill,
        ...displayStatus(result.bill),
        line_items: result.lines,
        ...(result.warnings.length ? { warnings: result.warnings } : {}),
      });
    })
  );

  // ── Edit in place (draft / pending / rejected only) ─────────────────────
  app.patch(
    "/api/bills/:id",
    authMiddleware,
    requireCustomer,
    strictBody(billUpdateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const bill = await loadBill(req);
      const result = await updateBillInPlace({
        companyId: bill.company_id,
        billId: bill.id,
        input: req.body as BillUpdateInput,
      });
      log.info({ billId: bill.id }, "Vendor bill updated");
      res.json({
        ...result.bill,
        ...displayStatus(result.bill),
        line_items: result.lines,
        ...(result.warnings.length ? { warnings: result.warnings } : {}),
      });
    })
  );

  // ── Submit for approval (draft / rejected → pending) ────────────────────
  app.post(
    "/api/bills/:id/submit",
    authMiddleware,
    requireCustomer,
    strictBody(z.object({})),
    asyncHandler(async (req: Request, res: Response) => {
      const bill = await loadBill(req);
      assertTransition(billMachine, String(bill.status), "pending");
      const row = await withLedgerTx((tx) =>
        transitionRow(
          tx,
          vendorBillsTable,
          bill.id,
          ["draft", "rejected"],
          "pending",
          {},
          {
            machine: billMachine,
            where: eq(vendorBillsTable.companyId, bill.company_id),
          }
        )
      );
      if (!row) throw new DomainError("BILL_STATE_CHANGED", 409);
      res.json(await billWithLines(bill.id));
    })
  );

  // ── Approve (maker-checker + approval rules; posts the A/P journal) ────
  app.post(
    "/api/bills/:id/approve",
    authMiddleware,
    requireCustomer,
    strictBody(z.object({ comment: z.string().max(500).optional().nullable() })),
    asyncHandler(async (req: Request, res: Response) => {
      const bill = await loadBill(req);
      if (bill.status !== "pending") {
        throw new DomainError(
          "BILL_NOT_PENDING",
          409,
          { status: bill.status },
          "Only pending bills can be approved"
        );
      }
      const actor = actorFromRequest(req);
      await assertCompanyPermission(actor, bill.company_id, ["documents.approve"]);
      const lines = (
        await pool.query(
          `SELECT description, amount, vat_amount, account_id, reverse_charge FROM bill_line_items WHERE bill_id = $1 ORDER BY created_at`,
          [bill.id]
        )
      ).rows;
      const vendorDefault = bill.vendor_id
        ? ((
            await pool.query(`SELECT default_expense_account_id FROM vendors WHERE id = $1`, [
              bill.vendor_id,
            ])
          ).rows[0]?.default_expense_account_id ?? null)
        : null;
      const plan = await planBillJournal(bill, lines, { vendorDefaultAccountId: vendorDefault });
      const billBase = await loadBaseCurrency(String(bill.company_id));
      const amountFils = toBase(
        filsOf(bill.total_amount),
        rateTextOf(bill, billBase),
        isForeign(bill, billBase)
      );
      const outcome = await withLedgerTx(async (tx) => {
        const locked = (
          await txRows<BillRow>(tx, `SELECT * FROM vendor_bills WHERE id = $1 FOR UPDATE`, [
            bill.id,
          ])
        )[0];
        if (locked.status !== "pending")
          throw new DomainError("BILL_NOT_PENDING", 409, { status: locked.status });
        const gate = await evaluateApproval(tx, {
          companyId: bill.company_id,
          documentType: "bill",
          documentId: bill.id,
          amountFils,
          makerId: bill.created_by ?? null,
          actor,
          comment: (req.body as { comment?: string | null }).comment ?? null,
        });
        if (!gate.final) return { gate, entryId: null as string | null };
        const posted = await postBillJournal(tx, locked, plan, actor.id);
        const row = await transitionRow(
          tx,
          vendorBillsTable,
          bill.id,
          "pending",
          "approved",
          { approvedBy: actor.id, approvedAt: new Date() },
          { machine: billMachine, where: eq(vendorBillsTable.companyId, bill.company_id) }
        );
        if (!row) throw new DomainError("BILL_STATE_CHANGED", 409);
        // F8: durable event, written in the approval transaction.
        await emitDomainEventInTx(tx, "bill.approved", {
          companyId: bill.company_id,
          entityId: bill.id,
          actorUserId: actor.id,
          totalFils: amountFils,
        });
        return { gate, entryId: posted.entry.id };
      });
      await recordAudit({
        userId: actor.id,
        companyId: bill.company_id,
        action: outcome.gate.final ? "bill.approve" : "bill.approve_step",
        entityType: "vendor_bill",
        entityId: bill.id,
        after: {
          journalEntryId: outcome.entryId,
          step: outcome.gate.stepOrder,
          remaining: outcome.gate.remainingSteps,
        },
        req,
      });
      res.json({
        ...(await billWithLines(bill.id)),
        approval: {
          final: outcome.gate.final,
          step: outcome.gate.stepOrder,
          remainingSteps: outcome.gate.remainingSteps,
        },
        journal_entry_id: outcome.entryId,
      });
    })
  );

  // ── Reject (pending → rejected) ─────────────────────────────────────────
  app.post(
    "/api/bills/:id/reject",
    authMiddleware,
    requireCustomer,
    strictBody(billReasonSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const bill = await loadBill(req);
      const actor = actorFromRequest(req);
      await assertCompanyPermission(actor, bill.company_id, ["documents.approve"]);
      assertTransition(billMachine, String(bill.status), "rejected");
      const reason = (req.body as { reason: string }).reason;
      await withLedgerTx(async (tx) => {
        const row = await transitionRow(
          tx,
          vendorBillsTable,
          bill.id,
          "pending",
          "rejected",
          { rejectedBy: actor.id, rejectedAt: new Date(), statusReason: reason },
          { machine: billMachine, where: eq(vendorBillsTable.companyId, bill.company_id) }
        );
        if (!row) throw new DomainError("BILL_STATE_CHANGED", 409);
        await clearApprovalDecisions(tx, bill.company_id, "bill", bill.id);
      });
      await recordAudit({
        userId: actor.id,
        companyId: bill.company_id,
        action: "bill.reject",
        entityType: "vendor_bill",
        entityId: bill.id,
        after: { reason },
        req,
      });
      res.json(await billWithLines(bill.id));
    })
  );

  // ── Revise an approved, unpaid bill (reverse + repost, audited) ─────────
  app.post(
    "/api/bills/:id/revise",
    authMiddleware,
    requireCustomer,
    strictBody(billReviseSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const bill = await loadBill(req);
      const actor = actorFromRequest(req);
      await assertCompanyPermission(actor, bill.company_id, ["documents.approve", "ledger.post"]);
      if (!["approved", "overdue"].includes(String(bill.status))) {
        throw new DomainError(
          "BILL_NOT_APPROVED",
          409,
          { status: bill.status },
          bill.status === "partial" || bill.status === "paid"
            ? "A bill with payments cannot be revised; void the payments first"
            : "Only approved bills are revised; edit pending bills directly"
        );
      }
      const { reason, ...changes } = parsedBody<BillReviseInput>(req);
      const prepared = await prepareBillRevision(bill.company_id, bill, changes as BillUpdateInput);
      const vendorDefault = bill.vendor_id
        ? ((
            await pool.query(`SELECT default_expense_account_id FROM vendors WHERE id = $1`, [
              bill.vendor_id,
            ])
          ).rows[0]?.default_expense_account_id ?? null)
        : null;
      const before = {
        subtotal: bill.subtotal,
        vat_amount: bill.vat_amount,
        total_amount: bill.total_amount,
      };
      const out = await withLedgerTx(async (tx) => {
        const locked = (
          await txRows<BillRow>(tx, `SELECT * FROM vendor_bills WHERE id = $1 FOR UPDATE`, [
            bill.id,
          ])
        )[0];
        if (!["approved", "overdue"].includes(String(locked.status))) {
          throw new DomainError("BILL_NOT_APPROVED", 409, { status: locked.status });
        }
        const pays = await txRows(tx, `SELECT 1 FROM bill_payments WHERE bill_id = $1 LIMIT 1`, [
          bill.id,
        ]);
        if (pays.length)
          throw new DomainError(
            "BILL_HAS_PAYMENTS",
            409,
            undefined,
            "Void the bill's payments first"
          );
        // Lock old movements' products and the new lines' products together, before the reversal.
        const reversals = await reverseBillJournal(tx, locked, actor.id, {
          reason,
          revisionProductIds:
            prepared.lines
              ?.map((l) => l.product_id)
              .filter((id): id is string => typeof id === "string") ?? null,
        });
        const updated = await applyBillRevision(tx, bill.id, prepared);
        const lines = await txRows<{
          description: string;
          amount: string;
          vat_amount: string;
          account_id: string | null;
          reverse_charge: boolean;
        }>(
          tx,
          `SELECT description, amount, vat_amount, account_id, reverse_charge FROM bill_line_items WHERE bill_id = $1 ORDER BY created_at`,
          [bill.id]
        );
        const plan = await planBillJournal(updated, lines, {
          vendorDefaultAccountId: vendorDefault,
        });
        const posted = await postBillJournal(tx, updated, plan, actor.id);
        return {
          reversalIds: reversals.map((r) => r.reversal.id),
          entryId: posted.entry.id,
          updated,
        };
      });
      await recordAudit({
        userId: actor.id,
        companyId: bill.company_id,
        action: "bill.revise",
        entityType: "vendor_bill",
        entityId: bill.id,
        before,
        after: {
          subtotal: out.updated.subtotal,
          vat_amount: out.updated.vat_amount,
          total_amount: out.updated.total_amount,
          reason,
          reversalEntryIds: out.reversalIds,
          journalEntryId: out.entryId,
        },
        req,
      });
      res.json({
        ...(await billWithLines(bill.id)),
        journal_entry_id: out.entryId,
        reversal_entry_ids: out.reversalIds,
      });
    })
  );

  // ── Void (pending, or approved with no payments; reverses the journal) ─
  app.post(
    "/api/bills/:id/void",
    authMiddleware,
    requireCustomer,
    strictBody(billOptionalReasonSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const bill = await loadBill(req);
      const actor = actorFromRequest(req);
      await assertCompanyPermission(actor, bill.company_id, ["documents.approve", "ledger.post"]);
      assertTransition(billMachine, String(bill.status), "void");
      const reason = (req.body as { reason?: string | null }).reason ?? null;
      const out = await withLedgerTx(async (tx) => {
        const locked = (
          await txRows<BillRow>(tx, `SELECT * FROM vendor_bills WHERE id = $1 FOR UPDATE`, [
            bill.id,
          ])
        )[0];
        const pays = await txRows<{ fils: string }>(
          tx,
          `SELECT COALESCE(SUM(ROUND(amount*100)),0)::bigint AS fils FROM bill_payments WHERE bill_id = $1`,
          [bill.id]
        );
        if (Number(pays[0]?.fils ?? 0) !== 0) {
          throw new DomainError(
            "BILL_HAS_PAYMENTS",
            409,
            undefined,
            "Void the bill's payments first"
          );
        }
        const reversals = await reverseBillJournal(tx, locked, actor.id, { void: true, reason });
        const row = await transitionRow(
          tx,
          vendorBillsTable,
          bill.id,
          String(locked.status) as never,
          "void",
          { voidedBy: actor.id, voidedAt: new Date(), statusReason: reason },
          { machine: billMachine, where: eq(vendorBillsTable.companyId, bill.company_id) }
        );
        if (!row) throw new DomainError("BILL_STATE_CHANGED", 409);
        await clearApprovalDecisions(tx, bill.company_id, "bill", bill.id);
        return reversals.map((r) => r.reversal.id);
      });
      await recordAudit({
        userId: actor.id,
        companyId: bill.company_id,
        action: "bill.void",
        entityType: "vendor_bill",
        entityId: bill.id,
        after: { reason, reversalEntryIds: out },
        req,
      });
      res.json({ ...(await billWithLines(bill.id)), reversal_entry_ids: out });
    })
  );

  // ── Delete (never-posted bills; posted bills keep the 5-year retention) ─
  app.delete(
    "/api/bills/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const bill = await loadBill(req);
      const everPosted =
        (
          await pool.query(
            `SELECT 1 FROM journal_entries WHERE company_id = $1 AND source = 'bill' AND source_id = $2 LIMIT 1`,
            [bill.company_id, bill.id]
          )
        ).rows.length > 0;
      const payments =
        (await pool.query(`SELECT 1 FROM bill_payments WHERE bill_id = $1 LIMIT 1`, [bill.id])).rows
          .length > 0;
      if (everPosted || payments || bill.approved_at) {
        if (!["void"].includes(String(bill.status))) {
          throw new DomainError(
            "BILL_POSTED",
            409,
            { status: bill.status },
            "This bill was posted to the ledger; void it instead of deleting it"
          );
        }
        // FTA 5-year retention applies to posted documents.
        assertRetentionExpired(
          {
            createdAt: bill.created_at as string,
            retentionExpiresAt: bill.retention_expires_at as string | null,
          },
          "Vendor bill"
        );
      }
      await pool.query("DELETE FROM vendor_bills WHERE id = $1 AND company_id = $2", [
        bill.id,
        bill.company_id,
      ]);
      await recordAudit({
        userId: req.user!.id,
        companyId: bill.company_id,
        action: "bill.delete",
        entityType: "vendor_bill",
        entityId: bill.id,
        before: { status: bill.status, total_amount: bill.total_amount },
        req,
      });
      res.json({ message: "Bill deleted successfully" });
    })
  );

  // ── Payments ────────────────────────────────────────────────────────────
  app.post(
    "/api/bills/:id/payments",
    authMiddleware,
    requireCustomer,
    strictBody(billPaymentSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const bill = await loadBill(req);
      const body = parsedBody<BillPaymentInput>(req);
      const result = await recordBillPayment({
        billId: bill.id,
        companyId: bill.company_id,
        amountFils: body.amount,
        date: body.payment_date,
        paymentAccountId: body.payment_account_id ?? null,
        exchangeRate: body.exchange_rate ?? null,
        bankAmountFils: body.bank_amount ?? null,
        bankExchangeRate: body.bank_exchange_rate ?? null,
        method: body.payment_method ?? null,
        reference: body.reference ?? null,
        notes: body.notes ?? null,
        actorId: req.user!.id,
        req,
      });
      res.json({
        payment: result.payment,
        bill_status: result.billStatus,
        amount_paid: result.amountPaid,
        remaining: result.remaining,
        journal_entry_id: result.journalEntryId,
        fx_difference: result.fxDifference,
      });
    })
  );

  app.post(
    "/api/bills/:id/payments/:paymentId/void",
    authMiddleware,
    requireCustomer,
    strictBody(billOptionalReasonSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const bill = await loadBill(req);
      const actor = actorFromRequest(req);
      await assertCompanyPermission(actor, bill.company_id, ["payments.release"]);
      if (!zUuid.safeParse(req.params.paymentId).success)
        throw new DomainError("PAYMENT_NOT_FOUND", 404);
      const result = await voidBillPayment({
        billId: bill.id,
        paymentId: req.params.paymentId,
        companyId: bill.company_id,
        actorId: actor.id,
        reason: (req.body as { reason?: string | null }).reason ?? null,
        req,
      });
      res.json({ bill_status: result.billStatus, amount_paid: result.amountPaid });
    })
  );

  // ── Attachments (stored through fileStorage, not URL-only) ──────────────
  app.post(
    "/api/bills/:id/attachment",
    authMiddleware,
    requireCustomer,
    strictBody(billAttachmentSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const bill = await loadBill(req);
      const { file, filename } = req.body as { file: string; filename?: string | null };
      // WQ2: the upload guard checks the bytes; a rejected file is a 4xx, never a 500.
      const path = await storePurchaseFile(file);
      await pool.query(
        `UPDATE vendor_bills SET attachment_path = $2, attachment_name = $3 WHERE id = $1 AND company_id = $4`,
        [bill.id, path, filename ?? null, bill.company_id]
      );
      res.json({ attachment_name: filename ?? null, has_attachment: true });
    })
  );

  app.get(
    "/api/bills/:id/attachment",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const bill = await loadBill(req);
      if (!bill.attachment_path) throw new DomainError("ATTACHMENT_NOT_FOUND", 404);
      const file = await readReceiptImage(String(bill.attachment_path));
      if (!file) throw new DomainError("ATTACHMENT_NOT_FOUND", 404);
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      res.send(file.buffer);
    })
  );

  // ── WQ2 (8.2): read a supplier invoice into a bill draft (writes nothing) ──
  app.post(
    "/api/companies/:companyId/bills/capture",
    authMiddleware,
    requireCustomer,
    strictBody(billCaptureSchema),
    withOcrDeadline(async (req, res, signal, waitForStep) => {
      const { companyId } = req.params;
      await waitForStep(assertCompanyAccess(req, companyId));
      const { file } = parsedBody<{ file: string }>(req);
      const result = await waitForStep(
        captureBillFromDocument({ companyId, userId: req.user!.id, file, signal })
      );
      res.json(result);
    })
  );

  // ── WQ2 (8.15): pending bills and whether the caller may sign the next step ──
  app.get(
    "/api/companies/:companyId/bills/approval-queue",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      res.json(await billApprovalQueue(companyId, actorFromRequest(req)));
    })
  );

  // ── GL backfill for legacy approved bills / payments (kernel, idempotent) ─
  app.post(
    "/api/companies/:companyId/bills/backfill-gl",
    authMiddleware,
    requireCustomer,
    strictBody(z.object({})),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const userId = req.user!.id;
      const billsRes = await pool.query(
        `SELECT * FROM vendor_bills WHERE company_id = $1 AND status IN ('approved','paid','partial','overdue')`,
        [companyId]
      );
      let billsPosted = 0;
      let paymentsPosted = 0;
      const errors: Array<{ billId: string; error: string }> = [];
      const ap = await requireApAccount(companyId);
      for (const bill of billsRes.rows as BillRow[]) {
        try {
          const lines = (
            await pool.query(
              `SELECT description, amount, vat_amount, account_id, reverse_charge FROM bill_line_items WHERE bill_id = $1`,
              [bill.id]
            )
          ).rows;
          const plan = await planBillJournal(bill, lines);
          await withLedgerTx(async (tx) => {
            if (!(await billHasPostedJournal(tx, companyId, bill.id))) {
              const anyEntry = await txRows(
                tx,
                `SELECT 1 FROM journal_entries WHERE company_id = $1 AND source = 'bill' AND source_id = $2 LIMIT 1`,
                [companyId, bill.id]
              );
              if (anyEntry.length === 0) {
                await postBillJournal(tx, bill, plan, userId);
                billsPosted++;
              }
            }
          });
          const pays = (
            await pool.query(
              `SELECT * FROM bill_payments WHERE bill_id = $1 AND kind = 'payment'`,
              [bill.id]
            )
          ).rows;
          for (const p of pays) {
            const has = await pool.query(
              `SELECT 1 FROM journal_entries WHERE company_id = $1 AND source = $2 AND source_id = $3 LIMIT 1`,
              [companyId, BILL_PAYMENT_JE_SOURCE, p.id]
            );
            if (has.rows.length) continue;
            const cash = await resolvePaymentAccount(
              companyId,
              p.payment_account_id,
              p.payment_method
            );
            const billBase = await loadBaseCurrency(companyId);
            const amount = toBase(
              filsOf(p.amount),
              rateTextOf(bill, billBase),
              isForeign(bill, billBase)
            );
            await postJournal(
              {
                companyId,
                date: new Date(p.payment_date).toISOString().slice(0, 10),
                ...journalMemo("billPaymentBackfill", {
                  ref: bill.bill_number || bill.id.slice(0, 8),
                }),
                status: "posted",
                source: BILL_PAYMENT_JE_SOURCE,
                sourceId: p.id,
                idempotencyKey: `bill_payment:${p.id}`,
                allowFutureDate: true,
                lines: [
                  { accountId: ap.id, debitFils: amount, controlLeg: "payables" },
                  { accountId: cash.id, creditFils: amount },
                ],
              },
              { actorId: userId }
            );
            paymentsPosted++;
          }
        } catch (err) {
          errors.push({ billId: bill.id, error: (err as Error)?.message || String(err) });
        }
      }
      log.info({ companyId, billsPosted, paymentsPosted }, "Bill GL backfill complete");
      res.json({ billsScanned: billsRes.rows.length, billsPosted, paymentsPosted, errors });
    })
  );

  // ── Summary (AED; remaining balances; approved-only payables; pending shown separately) ────
  app.get(
    "/api/companies/:companyId/bills/summary",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const today = todayIso();
      const fx = `COALESCE(NULLIF(b.exchange_rate, 0), 1)`;
      // Payables are remaining balances under the one settlement rule (server/reporting/
      // settlement.ts, D5c) that agedPayables / the dashboard outstandingPayables use,
      // approved-and-later bills only.
      const rem = payableOpenSql("b");
      const r = await pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE b.status IN ('draft','pending'))::int AS pending_count,
          COALESCE(SUM(ROUND(b.total_amount * ${fx} * 100)) FILTER (WHERE b.status IN ('draft','pending')), 0)::bigint AS pending_total,
          COUNT(*) FILTER (WHERE b.status IN ('approved','overdue'))::int AS approved_count,
          COALESCE(SUM(ROUND(${rem} * ${fx} * 100)) FILTER (WHERE b.status IN ('approved','overdue')), 0)::bigint AS approved_total,
          COUNT(*) FILTER (WHERE b.status = 'partial')::int AS partial_count,
          COALESCE(SUM(ROUND(${rem} * ${fx} * 100)) FILTER (WHERE b.status = 'partial'), 0)::bigint AS partial_total,
          COALESCE(SUM(ROUND(${payableSettledSql("b")} * ${fx} * 100)) FILTER (WHERE b.status = 'partial'), 0)::bigint AS partial_paid,
          COUNT(*) FILTER (WHERE b.status = 'paid')::int AS paid_count,
          COALESCE(SUM(ROUND(b.total_amount * ${fx} * 100)) FILTER (WHERE b.status = 'paid'), 0)::bigint AS paid_total,
          COUNT(*) FILTER (WHERE b.status IN ('approved','partial','overdue') AND b.due_date::date < $2::date AND ${rem} > 0)::int AS overdue_count,
          COALESCE(SUM(ROUND(${rem} * ${fx} * 100)) FILTER (WHERE b.status IN ('approved','partial','overdue') AND b.due_date::date < $2::date), 0)::bigint AS overdue_total,
          COUNT(*) FILTER (WHERE b.status IN ('approved','partial','overdue') AND ${rem} > 0)::int AS open_count,
          COALESCE(SUM(ROUND(${rem} * ${fx} * 100)) FILTER (WHERE b.status IN ('approved','partial','overdue')), 0)::bigint AS open_total
        FROM vendor_bills b
        WHERE b.company_id = $1`,
        [companyId, today]
      );
      const s = r.rows[0];
      const aed = (v: string) => Number(fromFils(Number(v)));
      res.json({
        currency: "AED",
        pending: { count: Number(s.pending_count), total: aed(s.pending_total), inPayables: false },
        approved: { count: Number(s.approved_count), total: aed(s.approved_total) },
        partial: {
          count: Number(s.partial_count),
          total: aed(s.partial_total),
          paid: aed(s.partial_paid),
        },
        paid: { count: Number(s.paid_count), total: aed(s.paid_total) },
        overdue: { count: Number(s.overdue_count), total: aed(s.overdue_total) },
        open: { count: Number(s.open_count), total: aed(s.open_total) },
      });
    })
  );

  // ── Aging (as-of, AED, approved only, by vendor, reconciled to 2010) ────
  app.get(
    "/api/companies/:companyId/bills/aging",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (req.companyRoleCompanyId !== companyId.toLowerCase()) {
        await assertCompanyAccess(req, companyId);
      }
      const asOf = parseReportDate(req.query.as_of ?? req.query.asOf, "as_of") ?? todayIso();
      const report = await payablesAging(companyId, asOf);
      const count = (b: string) => report.documents.filter((d) => d.bucket === b).length;
      res.json({
        as_of: asOf,
        currency: "AED",
        current: { amount: report.totals.current, count: count("current") },
        days_1_30: { amount: report.totals.days30, count: count("days30") },
        days_31_60: { amount: report.totals.days60, count: count("days60") },
        days_61_90: { amount: report.totals.days90, count: count("days90") },
        days_90_plus: { amount: report.totals.over90, count: count("over90") },
        unapplied_credits: report.unappliedCredits,
        by_vendor: report.vendors,
        documents: report.documents,
        reconciliation: report.reconciliation,
      });
    })
  );

  // ── Batch payment export (CSV for the bank portal; pays nothing) ────────
  app.post(
    "/api/companies/:companyId/bills/payment-batch",
    authMiddleware,
    requireCustomer,
    requirePermission("payments.release"),
    strictBody(batchPaymentExportSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { bill_ids } = parsedBody<{ bill_ids: string[] }>(req);
      const out = await batchPaymentCsv(companyId, bill_ids);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="bill-payment-batch-${todayIso()}.csv"`
      );
      res.setHeader("X-Batch-Rows", String(out.rows));
      res.setHeader("X-Batch-Skipped", String(out.skipped.length));
      res.send(out.csv);
    })
  );

  // ── Create a draft bill from a receipt / OCR result ─────────────────────
  app.post(
    "/api/companies/:companyId/bills/from-receipt",
    authMiddleware,
    requireCustomer,
    strictBody(z.object({ receipt_id: zUuid })),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const receipt = await scopedGet(
        receipts,
        companyId,
        (req.body as { receipt_id: string }).receipt_id
      );
      if (!receipt) throw new DomainError("RECEIPT_NOT_FOUND", 404);
      if (receipt.posted) {
        throw new DomainError(
          "RECEIPT_POSTED",
          409,
          undefined,
          "A posted receipt is already in the ledger"
        );
      }
      const existing = await pool.query(
        `SELECT id FROM vendor_bills WHERE company_id = $1 AND origin = 'receipt' AND origin_ref = $2 LIMIT 1`,
        [companyId, receipt.id]
      );
      if (existing.rows[0]) {
        throw new DomainError("BILL_ALREADY_CREATED", 409, { billId: existing.rows[0].id });
      }
      const netFils = toFils(String(receipt.amount ?? 0), { rounding: "halfUp" });
      if (netFils <= 0) throw new DomainError("RECEIPT_AMOUNT_INVALID", 422);
      const vatFils = toFils(String(receipt.vatAmount ?? 0), { rounding: "halfUp" });
      const date = (receipt.date ?? new Date()).toISOString().slice(0, 10);
      const result = await createDraftFromParsedInbound(companyId, req.user!.id, {
        vendorName: receipt.merchant || "Unknown vendor",
        vendorTrn:
          receipt.supplierTrn && /^\d{15}$/.test(receipt.supplierTrn) ? receipt.supplierTrn : null,
        billDate: date,
        currency: receipt.currency || "AED",
        exchangeRate:
          receipt.currency && receipt.currency !== "AED" ? String(receipt.exchangeRate) : null,
        reverseCharge: receipt.reverseCharge,
        category: receipt.category ?? null,
        origin: "receipt",
        originRef: receipt.id,
        lines: [
          {
            description: receipt.category || receipt.merchant || "Receipt",
            unitPrice: netFils,
            vatRate: vatFils > 0 ? 5 : 0,
            accountId: receipt.accountId ?? null,
          },
        ],
      });
      res.status(201).json({ ...result.bill, line_items: result.lines, warnings: result.warnings });
    })
  );

  // ── Inbound structured document → draft bill ────────────────────────────
  app.post(
    "/api/companies/:companyId/bills/inbound",
    authMiddleware,
    requireCustomer,
    strictBody(inboundBillSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const result = await createDraftFromParsedInbound(companyId, req.user!.id, req.body);
      res.status(201).json({ ...result.bill, line_items: result.lines, warnings: result.warnings });
    })
  );

  // ── Reviewed inbound supplier credit note → vendor debit note (W4-C residual) ─
  app.post(
    "/api/companies/:companyId/bills/inbound/:inboundId/vendor-credit",
    authMiddleware,
    requireCustomer,
    requirePermission("ledger.post", "documents.approve"),
    strictBody(inboundVendorCreditSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, inboundId } = req.params;
      await assertCompanyAccess(req, companyId);
      if (!zUuid.safeParse(inboundId).success) {
        throw new DomainError("INBOUND_DOCUMENT_NOT_FOUND", 404);
      }
      const out = await createVendorCreditFromInbound({
        companyId,
        actorId: req.user!.id,
        inboundId,
        input: parsedBody<InboundVendorCreditInput>(req),
        req,
      });
      res.status(201).json(out);
    })
  );

  // ── Debit notes / vendor credits ────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/debit-notes",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const r = await pool.query(
        `SELECT * FROM vendor_debit_notes WHERE company_id = $1 ORDER BY note_date DESC, created_at DESC`,
        [companyId]
      );
      res.json(r.rows);
    })
  );

  app.post(
    "/api/companies/:companyId/debit-notes",
    authMiddleware,
    requireCustomer,
    requirePermission("ledger.post", "documents.approve"),
    strictBody(debitNoteCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const out = await createDebitNote({ companyId, actorId: req.user!.id, input: req.body, req });
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "debit_note.create",
        entityType: "vendor_debit_note",
        entityId: String(out.debitNote.id),
        after: { ...out.debitNote, journalEntryId: out.journalEntryId },
        req,
      });
      res.status(201).json({ ...out.debitNote, journal_entry_id: out.journalEntryId });
    })
  );

  app.post(
    "/api/companies/:companyId/debit-notes/:debitNoteId/apply",
    authMiddleware,
    requireCustomer,
    requirePermission("ledger.post", "documents.approve", "payments.release"),
    strictBody(applyCreditSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, debitNoteId } = req.params;
      if (!zUuid.safeParse(debitNoteId).success) throw new DomainError("DEBIT_NOTE_NOT_FOUND", 404);
      const out = await applyDebitNote({
        companyId,
        debitNoteId,
        actorId: req.user!.id,
        input: req.body,
      });
      res.json({
        application_id: out.applicationId,
        bill_status: out.billStatus,
        amount_paid: out.amountPaid,
      });
    })
  );

  // ── Vendor prepayments / advances ───────────────────────────────────────
  app.get(
    "/api/companies/:companyId/vendor-prepayments",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const r = await pool.query(
        `SELECT * FROM vendor_prepayments WHERE company_id = $1 ORDER BY payment_date DESC, created_at DESC`,
        [companyId]
      );
      res.json(r.rows);
    })
  );

  app.post(
    "/api/companies/:companyId/vendor-prepayments",
    authMiddleware,
    requireCustomer,
    requirePermission("payments.release"),
    strictBody(prepaymentCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const out = await createPrepayment({
        companyId,
        actorId: req.user!.id,
        input: req.body,
        req,
      });
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: "vendor_prepayment.create",
        entityType: "vendor_prepayment",
        entityId: String(out.prepayment.id),
        after: { ...out.prepayment, journalEntryId: out.journalEntryId },
        req,
      });
      res.status(201).json({ ...out.prepayment, journal_entry_id: out.journalEntryId });
    })
  );

  app.post(
    "/api/companies/:companyId/vendor-prepayments/:prepaymentId/apply",
    authMiddleware,
    requireCustomer,
    requirePermission("payments.release"),
    strictBody(applyCreditSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, prepaymentId } = req.params;
      if (!zUuid.safeParse(prepaymentId).success)
        throw new DomainError("PREPAYMENT_NOT_FOUND", 404);
      const out = await applyPrepayment({
        companyId,
        prepaymentId,
        actorId: req.user!.id,
        input: req.body,
      });
      res.json({
        application_id: out.applicationId,
        bill_status: out.billStatus,
        amount_paid: out.amountPaid,
      });
    })
  );

  // ── Recurring bills (job bills.recurring) ───────────────────────────────
  app.get(
    "/api/companies/:companyId/recurring-bills",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const r = await pool.query(
        `SELECT * FROM recurring_bills WHERE company_id = $1 ORDER BY next_run_on`,
        [companyId]
      );
      res.json(r.rows);
    })
  );

  app.post(
    "/api/companies/:companyId/recurring-bills",
    authMiddleware,
    requireCustomer,
    strictBody(recurringBillCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      res.status(201).json(await createRecurringBill(companyId, req.user!.id, req.body));
    })
  );

  app.post(
    "/api/companies/:companyId/recurring-bills/:recurringId/run",
    authMiddleware,
    requireCustomer,
    strictBody(z.object({})),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, recurringId } = req.params;
      await assertCompanyAccess(req, companyId);
      if (!zUuid.safeParse(recurringId).success)
        throw new DomainError("RECURRING_BILL_NOT_FOUND", 404);
      const out = await runRecurringBill(recurringId, companyId);
      res.json(out ? { created: true, bill: out.bill } : { created: false });
    })
  );

  app.delete(
    "/api/companies/:companyId/recurring-bills/:recurringId",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, recurringId } = req.params;
      await assertCompanyAccess(req, companyId);
      if (!zUuid.safeParse(recurringId).success)
        throw new DomainError("RECURRING_BILL_NOT_FOUND", 404);
      const r = await pool.query(
        `UPDATE recurring_bills SET is_active = false WHERE id = $1 AND company_id = $2 RETURNING id`,
        [recurringId, companyId]
      );
      if (!r.rowCount) throw new DomainError("RECURRING_BILL_NOT_FOUND", 404);
      res.json({ deactivated: true });
    })
  );
}
