import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { storage } from "../storage";
import { db, pool } from "../db";
import Decimal from "decimal.js";
import { billQuantitySchema, billUnitPriceSchema, computeBillLines } from "../services/bill-line-math";
import { createLogger } from "../config/logger";
import { assertRetentionExpired } from "../services/retention.service";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import { recordBillPayment } from "../services/bill-payment.service";
import { resolveSettlementDate } from "../services/payment-date-guard.service";
import { normalizeCalendarColumns, toCalendarYmd } from "../utils/date";
import { recordAudit } from "../services/audit.service";
import { asOfParams, billAgingBucketsAsOfSql, parseAgingAsOf } from "../services/aging-as-of.service";
import { postBillApprovalJournal, postBillPaymentJournal } from "../services/bill-posting.service";
import { applyBillStockInTx, assertProductsOfCompany } from "../services/purchase-stock.service";
import { resolveVendor } from "../services/vendor-contact.service";
import { assertProjectsOfCompany, recordProjectExpensesForBill } from "../services/project.service";
import { LOCK_NS, withDocumentLock } from "../services/document-lock";
import { loadApprovalDocument } from "../services/approval-queue.service";
import {
  auditApprovalStep,
  assertNotRejected,
  beginApprovalStep,
  notifyApprovalProgress,
  pendingApprovalBody,
  recordApprovalStep,
  resolveActor,
} from "../services/approval-gate.service";

const log = createLogger("bill-pay");

// =====================================
// Zod schemas
// =====================================

const billIsoDate = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Must be a valid ISO date" });

const billLineItemSchema = z.object({
  description: z.string().min(1, "Line description is required").max(500),
  quantity: billQuantitySchema.optional(),
  unit_price: billUnitPriceSchema,
  // UAE VAT: only 0% and 5% exist. Accept percent (5) or decimal (0.05) form.
  vat_rate: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .refine(
      (v) => {
        if (v === null || v === undefined || v === "") return true;
        const n = Number(v);
        return n === 0 || n === 5 || n === 0.05;
      },
      { message: "VAT rate must be 0% or 5% (UAE)" }
    ),
  account_id: z.string().uuid().optional().nullable(),
  // Phase 8 D2: a cost tagged with a project, optionally billable to the project's customer.
  project_id: z.string().uuid().optional().nullable(),
  is_billable: z.boolean().optional(),
  // A stock item bought on this line (0127): approving the bill brings it into stock at the line's cost.
  product_id: z.string().uuid().optional().nullable(),
});

const billCreateSchema = z
  .object({
  vendor_id: z.string().uuid().optional().nullable(),
  vendor_name: z.string().min(1, "Vendor name is required").max(255).optional(),
  vendor_trn: z.string().max(20).optional().nullable(),
  bill_number: z.string().max(64).optional().nullable(),
  bill_date: billIsoDate,
  due_date: billIsoDate.optional().nullable(),
  currency: z.string().length(3).optional(),
  category: z.string().max(64).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  attachment_url: z.string().url().optional().nullable(),
  reverse_charge: z.boolean().optional(),
  // The purchase order this bill bills: goods already received on it clear GRNI instead of being counted twice.
  purchase_order_id: z.string().uuid().optional().nullable(),
  exchange_rate: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .refine((v) => v === null || v === undefined || v === "" || Number(v) > 0, {
      message: "exchange_rate must be positive",
    }),
  line_items: z.array(billLineItemSchema).min(1, "At least one line item is required"),
  })
  .refine((b) => !!b.vendor_id || !!b.vendor_name, { message: "Vendor name is required", path: ["vendor_name"] });

const billUpdateSchema = z.object({
  vendor_id: z.string().uuid().optional().nullable(),
  vendor_name: z.string().min(1).max(255).optional(),
  vendor_trn: z.string().max(20).optional().nullable(),
  bill_number: z.string().max(64).optional().nullable(),
  bill_date: billIsoDate.optional(),
  due_date: billIsoDate.optional().nullable(),
  currency: z.string().length(3).optional(),
  category: z.string().max(64).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  attachment_url: z.string().url().optional().nullable(),
  line_items: z.array(billLineItemSchema).min(1).optional(),
});

const billPaymentSchema = z.object({
  // Optional: defaults to today. Validated against the bill date, the future
  // and period locks in the handler.
  payment_date: billIsoDate.optional().nullable(),
  amount: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "string" ? Number(v) : v))
    .pipe(z.number().positive("Payment amount must be positive")),
  payment_method: z.enum(["bank_transfer", "cash", "cheque", "credit_card", "other"]).optional(),
  reference: z.string().max(255).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  // The bank or cash GL account the money leaves (default 1020 / 1010).
  payment_account_id: z.string().uuid().optional().nullable(),
});

// bill_date / due_date / payment_date are date-only values held in
// `timestamp without time zone` columns. node-pg reads those in server-local
// time, which on a UAE host turns 2026-09-29 into 2026-09-28T20:00Z — a
// month-boundary trap for period locks and journal dates. Normalise every raw
// read to UTC midnight of the calendar day, the convention invoices use.
const BILL_DATE_COLUMNS = ["bill_date", "due_date"] as const;
const PAYMENT_DATE_COLUMNS = ["payment_date"] as const;
/** The stored calendar day (UAE) as a UTC-midnight Date, for period-lock checks. */
const calendarDayToDate = (value: string | Date): Date => new Date(`${toCalendarYmd(value)}T00:00:00Z`);
const normalizeBill = <R extends Record<string, any>>(row: R): R =>
  normalizeCalendarColumns(row, BILL_DATE_COLUMNS);
const normalizePayment = <R extends Record<string, any>>(row: R): R =>
  normalizeCalendarColumns(row, PAYMENT_DATE_COLUMNS);

/** What an auditor needs to see about a bill, before and after: who, when, how much. */
function billAuditView(bill: any) {
  const day = (v: unknown) => (v ? toCalendarYmd(v as string | Date) : null);
  return {
    number: bill.bill_number ?? null,
    vendor: bill.vendor_name ?? null,
    billDate: day(bill.bill_date),
    dueDate: day(bill.due_date),
    currency: bill.currency ?? null,
    subtotal: bill.subtotal == null ? null : Number(bill.subtotal),
    vat: bill.vat_amount == null ? null : Number(bill.vat_amount),
    total: bill.total_amount == null ? null : Number(bill.total_amount),
    status: bill.status ?? null,
  };
}

/** Every line account must be an account of THIS company; a foreign id would post to another tenant's chart. */
async function foreignLineAccounts(companyId: string, lines: Array<{ account_id?: string | null }> | undefined): Promise<string[]> {
  const ids = Array.from(new Set((lines ?? []).map((l) => l.account_id).filter((x): x is string => !!x)));
  if (ids.length === 0) return [];
  const { rows } = await pool.query(`SELECT id FROM accounts WHERE company_id = $1 AND id = ANY($2::uuid[])`, [companyId, ids]);
  const ok = new Set(rows.map((r: any) => r.id));
  return ids.filter((id) => !ok.has(id));
}

export function registerBillPayRoutes(app: Express) {
  // =====================================
  // Vendor Bill Routes
  // =====================================

  // List all bills for a company (with filters)
  app.get(
    "/api/companies/:companyId/bills",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { status, vendor, dateFrom, dateTo } = req.query;

      // A bill sent back by an approver is a draft: carry the rejection (reason and who) so the list can show it.
      let query = `
      SELECT vendor_bills.*, rj.comment AS rejection_reason, rj.name AS rejected_by_name
      FROM vendor_bills
      LEFT JOIN LATERAL (
        SELECT s.comment, u.name FROM approval_requests r
          JOIN approval_steps s ON s.request_id = r.id AND s.decision = 'rejected'
          LEFT JOIN users u ON u.id = s.decided_by
         WHERE r.document_type = 'bill' AND r.document_id = vendor_bills.id AND r.status = 'rejected'
         ORDER BY r.created_at DESC LIMIT 1
      ) rj ON vendor_bills.status = 'draft'
      WHERE vendor_bills.company_id = $1
    `;
      const params: any[] = [companyId];
      let paramIndex = 2;

      if (status && status !== "all") {
        query += ` AND status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (vendor) {
        query += ` AND vendor_name ILIKE $${paramIndex}`;
        params.push(`%${vendor}%`);
        paramIndex++;
      }

      if (dateFrom) {
        query += ` AND bill_date >= $${paramIndex}`;
        params.push(dateFrom);
        paramIndex++;
      }

      if (dateTo) {
        query += ` AND bill_date <= $${paramIndex}`;
        params.push(dateTo);
        paramIndex++;
      }

      query += ` ORDER BY bill_date DESC`;

      const result = await pool.query(query, params);

      // Mark overdue bills
      const now = new Date();
      const bills = result.rows.map(normalizeBill).map((bill: any) => {
        if (
          bill.due_date &&
          new Date(bill.due_date) < now &&
          // only a bill that is on the ledger and still owes money is overdue (never pending, waiting, void or paid)
          (bill.status === "approved" || bill.status === "partial")
        ) {
          return { ...bill, status: "overdue" };
        }
        return bill;
      });

      res.json(bills);
    })
  );

  // Get single bill with line items and payments
  app.get(
    "/api/bills/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;

      const billResult = await pool.query("SELECT * FROM vendor_bills WHERE id = $1", [id]);

      if (billResult.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const bill = normalizeBill(billResult.rows[0]);

      const hasAccess = await storage.hasCompanyAccess(userId, bill.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const linesResult = await pool.query(
        "SELECT * FROM bill_line_items WHERE bill_id = $1 ORDER BY created_at ASC",
        [id]
      );

      const paymentsResult = await pool.query(
        "SELECT * FROM bill_payments WHERE bill_id = $1 ORDER BY payment_date DESC",
        [id]
      );

      res.json({
        ...bill,
        line_items: linesResult.rows,
        payments: paymentsResult.rows.map(normalizePayment),
      });
    })
  );

  // Create bill with line items
  app.post(
    "/api/companies/:companyId/bills",
    authMiddleware,
    requireCustomer,
    validate({ body: billCreateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const foreign = await foreignLineAccounts(companyId, req.body.line_items);
      if (foreign.length > 0) {
        return res.status(400).json({ message: "A line account does not belong to this company", code: "INVALID_ACCOUNT", details: { accountIds: foreign } });
      }

      const {
        vendor_id,
        vendor_name: requestedVendorName,
        vendor_trn: requestedVendorTrn,
        bill_number,
        bill_date,
        due_date,
        currency,
        category,
        notes,
        attachment_url,
        line_items,
        reverse_charge,
        exchange_rate,
      } = req.body;

      // Foreign-currency bills must carry a rate to AED — the GL and VAT 201
      // are AED. AED bills default to 1.
      const docCurrency = (currency || "AED").toUpperCase();
      const fxRate = Number(exchange_rate) > 0 ? Number(exchange_rate) : 1;
      if (docCurrency !== "AED" && fxRate === 1 && !(Number(exchange_rate) > 0)) {
        return res.status(422).json({
          message: `Foreign-currency bills require exchange_rate (${docCurrency}→AED).`,
          code: "NO_EXCHANGE_RATE",
        });
      }

      // Bills post a JE on the bill_date once approved — refuse to even draft
      // one inside a closed period. Check the calendar day that is STORED
      // (UAE day), not the raw instant, which can fall on the previous UTC day.
      const billCalendarDate = calendarDayToDate(bill_date);
      await assertPeriodNotLocked(companyId, billCalendarDate);

      // Reverse charge is a specific legal treatment (imports of goods and
      // services, designated zones) — it must be chosen, never guessed.
      //
      // This used to default to `!vendor_trn`, i.e. ON whenever the vendor's TRN
      // field was blank. A blank TRN overwhelmingly means "not typed in yet",
      // not "foreign supplier". The consequences were severe and silent:
      //   * the bill self-assessed output VAT into Box 3 and claimed input VAT
      //     in Box 10, instead of ordinary recoverable input VAT in Box 9 —
      //     materially changing the VAT return in both directions;
      //   * total_amount excluded the VAT (correct FOR reverse charge), so the
      //     payable to the vendor was understated by the VAT and A/P was wrong.
      //
      // Default is now OFF. A missing TRN raises an advisory flag on the
      // response so an accountant can review it, rather than silently changing
      // the tax treatment.
      const billReverseCharge = reverse_charge === true;

      // One contacts table: link the bill to the vendor contact (validated, found by name, or created).
      const vendor = await resolveVendor(companyId, {
        vendorId: vendor_id,
        vendorName: requestedVendorName,
        vendorTrn: requestedVendorTrn,
      });
      const vendor_name = vendor.vendorName;
      const vendor_trn = vendor.vendorTrn;
      const missingVendorTrn = !vendor_trn;

      await assertProjectsOfCompany(companyId, line_items.map((l: any) => l.project_id));
      await assertProductsOfCompany(companyId, line_items.map((l: any) => l.product_id));
      const purchaseOrderId: string | null = req.body.purchase_order_id || null;
      if (purchaseOrderId) {
        const po = await pool.query(`SELECT 1 FROM purchase_orders WHERE id = $1 AND company_id = $2`, [purchaseOrderId, companyId]);
        if (po.rows.length === 0) return res.status(422).json({ message: "The purchase order does not belong to this company.", code: "INVALID_PURCHASE_ORDER" });
      }

      // Totals from exact-decimal line maths (unit price rounded to 6dp and
      // quantity to 4dp before each line amount is computed).
      const computed = computeBillLines(line_items);
      const subtotal = new Decimal(computed.subtotal);
      const vatAmount = new Decimal(computed.vatAmount);

      // For reverse-charge bills the vendor does not charge VAT — the cash payable
      // is just the subtotal. The VAT is still tracked for the VAT return (input
      // and output legs net to zero).
      const totalAmount = billReverseCharge ? subtotal : subtotal.plus(vatAmount);

      const billResult = await pool.query(
        `INSERT INTO vendor_bills (
        company_id, vendor_name, vendor_trn, bill_number, bill_date, due_date,
        currency, subtotal, vat_amount, total_amount, amount_paid, status,
        category, notes, attachment_url, reverse_charge, exchange_rate, vendor_id, created_by, purchase_order_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *`,
        [
          companyId,
          vendor_name,
          vendor_trn || null,
          bill_number || null,
          toCalendarYmd(bill_date),
          due_date ? toCalendarYmd(due_date) : null,
          docCurrency,
          subtotal.toFixed(2),
          vatAmount.toFixed(2),
          totalAmount.toFixed(2),
          "0.00",
          "pending",
          category || null,
          notes || null,
          attachment_url || null,
          billReverseCharge,
          fxRate,
          vendor.vendorId,
          userId,
          purchaseOrderId,
        ]
      );

      const bill = normalizeBill(billResult.rows[0]);

      // Create line items
      for (const [i, line] of line_items.entries()) {
        const computedLine = computed.lines[i];
        await pool.query(
          `INSERT INTO bill_line_items (bill_id, description, quantity, unit_price, vat_rate, amount, account_id, reverse_charge, project_id, is_billable, product_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            bill.id,
            line.description,
            computedLine.quantity,
            computedLine.unitPrice,
            computedLine.vatRatePercent,
            computedLine.amount,
            line.account_id || null,
            billReverseCharge,
            line.project_id || null,
            line.project_id ? line.is_billable === true : false,
            line.product_id || null,
          ]
        );
      }

      log.info({ billId: bill.id, companyId, reverseCharge: billReverseCharge }, "Vendor bill created");
      await recordAudit({
        userId,
        companyId,
        action: "bill.create",
        entityType: "vendor_bill",
        entityId: bill.id,
        before: null,
        after: { ...billAuditView(bill), lines: line_items.length },
        req,
      });
      const billWarnings: Array<{ code: string; message: string }> = [...vendor.warnings];
      // Advisory only — never a silent change of tax treatment.
      if (missingVendorTrn && !billReverseCharge) {
        billWarnings.push({
          code: "VENDOR_TRN_MISSING",
          message:
            "No vendor TRN recorded. This bill is treated as an ordinary domestic purchase " +
            "(input VAT recoverable in Box 9). If this supply is subject to the reverse charge " +
            "(imports, designated zones), set reverse_charge explicitly.",
        });
      }
      res.json({ ...bill, ...(billWarnings.length > 0 ? { warnings: billWarnings } : {}) });
    })
  );

  // Update bill
  app.patch(
    "/api/bills/:id",
    authMiddleware,
    requireCustomer,
    validate({ body: billUpdateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;

      const billResult = await pool.query("SELECT * FROM vendor_bills WHERE id = $1", [id]);

      if (billResult.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const bill = normalizeBill(billResult.rows[0]);

      const hasAccess = await storage.hasCompanyAccess(userId, bill.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // An opening-balance bill is inside the opening balances: editing it would break the tie to Accounts Payable.
      if (billResult.rows[0].is_opening_balance === true) {
        return res.status(409).json({
          message: "This bill was entered as an opening balance and cannot be edited. Reverse the opening balances to change it.",
          code: "OPENING_BALANCE_BILL",
        });
      }

      const foreignOnEdit = await foreignLineAccounts(bill.company_id, req.body.line_items);
      if (foreignOnEdit.length > 0) {
        return res.status(400).json({ message: "A line account does not belong to this company", code: "INVALID_ACCOUNT", details: { accountIds: foreignOnEdit } });
      }

      if (bill.status === "pending_approval") {
        return res.status(409).json({
          message: "This bill is waiting for approval and cannot be edited. Reject it first.",
          code: "APPROVAL_IN_PROGRESS",
        });
      }

      // Only a bill that has not hit the books can be edited. An approved bill has its payable posted;
      // payments and applied credits settle it. Editing amounts or the vendor underneath those would
      // leave the ledger, the payments and the credits describing different bills.
      const settlement = await pool.query(
        `SELECT (SELECT COUNT(*)::int FROM bill_payments WHERE bill_id = $1)
              + (SELECT COUNT(*)::int FROM vendor_credit_applications WHERE bill_id = $1) AS n`,
        [id]
      );
      if (!["pending", "draft"].includes(String(bill.status)) || Number(settlement.rows[0]?.n) > 0 || Number(bill.amount_paid) > 0) {
        return res.status(409).json({
          message:
            "This bill has been approved, paid or credited and can no longer be edited. Void it, or record a supplier credit note, and enter a corrected bill.",
          code: "BILL_NOT_EDITABLE",
        });
      }

      const {
        vendor_id,
        vendor_name,
        vendor_trn,
        bill_number,
        bill_date,
        due_date,
        currency,
        category,
        notes,
        attachment_url,
        line_items,
      } = req.body;

      // Block edits that touch a locked period — the existing bill_date and any
      // requested new bill_date must both be outside any closed period.
      await assertPeriodNotLocked(bill.company_id, bill.bill_date);
      if (bill_date) {
        await assertPeriodNotLocked(bill.company_id, calendarDayToDate(bill_date));
      }

      // Build dynamic update
      const updates: string[] = [];
      const values: any[] = [];
      let paramIdx = 1;

      const addUpdate = (field: string, value: any) => {
        if (value !== undefined) {
          updates.push(`${field} = $${paramIdx}`);
          values.push(value);
          paramIdx++;
        }
      };

      // A changed vendor (by id or by name) is re-resolved against the contacts table; a name-only edit
      // that matches nothing creates the vendor, so the bill never keeps a stale link.
      let patchWarnings: Array<{ code: string; message: string }> = [];
      if (vendor_id !== undefined || vendor_name !== undefined) {
        const vendor = await resolveVendor(bill.company_id, {
          vendorId: vendor_id,
          vendorName: vendor_id ? undefined : vendor_name ?? bill.vendor_name,
          vendorTrn: vendor_trn ?? undefined,
        });
        patchWarnings = vendor.warnings;
        addUpdate("vendor_id", vendor.vendorId);
        addUpdate("vendor_name", vendor.vendorName);
        addUpdate("vendor_trn", vendor_trn === undefined ? vendor.vendorTrn : vendor_trn);
      } else {
        addUpdate("vendor_trn", vendor_trn);
      }
      addUpdate("bill_number", bill_number);
      addUpdate("bill_date", bill_date ? toCalendarYmd(bill_date) : bill_date);
      addUpdate("due_date", due_date ? toCalendarYmd(due_date) : due_date);
      addUpdate("currency", currency);
      addUpdate("category", category);
      addUpdate("notes", notes);
      addUpdate("attachment_url", attachment_url);

      if (Array.isArray(line_items)) await assertProjectsOfCompany(bill.company_id, line_items.map((l: any) => l.project_id));
      if (Array.isArray(line_items)) await assertProductsOfCompany(bill.company_id, line_items.map((l: any) => l.product_id));

      // If line_items provided, recalculate totals
      const hasNewLines = Array.isArray(line_items) && line_items.length > 0;
      const computed = hasNewLines ? computeBillLines(line_items) : null;
      if (computed) {
        const subtotal = new Decimal(computed.subtotal);
        const vatAmount = new Decimal(computed.vatAmount);
        addUpdate("subtotal", subtotal.toFixed(2));
        addUpdate("vat_amount", vatAmount.toFixed(2));
        addUpdate("total_amount", subtotal.plus(vatAmount).toFixed(2));
      }

      if (updates.length === 0 && !line_items) {
        return res.status(400).json({ message: "No fields to update" });
      }

      let updatedBill = bill;
      if (updates.length > 0) {
        values.push(id);
        const updateResult = await pool.query(
          `UPDATE vendor_bills SET ${updates.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
          values
        );
        updatedBill = normalizeBill(updateResult.rows[0]);
      }

      // Replace line items if provided
      if (computed) {
        await pool.query("DELETE FROM bill_line_items WHERE bill_id = $1", [id]);

        for (const [i, line] of line_items.entries()) {
          const computedLine = computed.lines[i];
          await pool.query(
            `INSERT INTO bill_line_items (bill_id, description, quantity, unit_price, vat_rate, amount, account_id, project_id, is_billable, product_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              id,
              line.description,
              computedLine.quantity,
              computedLine.unitPrice,
              computedLine.vatRatePercent,
              computedLine.amount,
              line.account_id || null,
              line.project_id || null,
              line.project_id ? line.is_billable === true : false,
              line.product_id || null,
            ]
          );
        }
      }

      const after = (await pool.query("SELECT * FROM vendor_bills WHERE id = $1", [id])).rows[0];
      await recordAudit({
        userId,
        companyId: bill.company_id,
        action: "bill.update",
        entityType: "vendor_bill",
        entityId: id,
        before: billAuditView(bill),
        after: after ? { ...billAuditView(normalizeBill(after)), ...(computed ? { linesReplaced: true } : {}) } : null,
        req,
      });
      log.info({ billId: id }, "Vendor bill updated");
      res.json(patchWarnings.length > 0 ? { ...updatedBill, warnings: patchWarnings } : updatedBill);
    })
  );

  // Delete bill
  app.delete(
    "/api/bills/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;

      const billResult = await pool.query("SELECT * FROM vendor_bills WHERE id = $1", [id]);

      if (billResult.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const bill = billResult.rows[0];

      const hasAccess = await storage.hasCompanyAccess(userId, bill.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (bill.status === "pending_approval") {
        return res.status(409).json({
          message: "This bill is waiting for approval and cannot be deleted. Reject it first.",
          code: "APPROVAL_IN_PROGRESS",
        });
      }

      // FTA 5-year retention.
      assertRetentionExpired(
        { createdAt: bill.created_at, retentionExpiresAt: bill.retention_expires_at },
        "Vendor bill"
      );

      // A bill a vendor credit note has been applied to cannot disappear: the
      // application (and the credit's remaining balance) would silently vanish.
      const applied = await pool.query(
        "SELECT 1 FROM vendor_credit_applications WHERE bill_id = $1 LIMIT 1",
        [id]
      );
      if (applied.rows.length > 0) {
        return res.status(409).json({
          message: "A vendor credit note has been applied to this bill and it cannot be deleted.",
          code: "BILL_HAS_CREDIT_APPLICATIONS",
        });
      }

      // Cascade delete will handle line_items and payments
      await pool.query("DELETE FROM vendor_bills WHERE id = $1", [id]);
      await recordAudit({
        userId,
        companyId: bill.company_id,
        action: "bill.delete",
        entityType: "vendor_bill",
        entityId: id,
        before: billAuditView(normalizeBill(bill)),
        after: null,
        req,
      });

      log.info({ billId: id }, "Vendor bill deleted");
      res.json({ message: "Bill deleted successfully" });
    })
  );

  // Approve bill
  app.post(
    "/api/bills/:id/approve",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;

      const billResult = await pool.query("SELECT * FROM vendor_bills WHERE id = $1", [id]);

      if (billResult.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const companyId: string = billResult.rows[0].company_id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Everything from the status check to the posting runs under the document's approval lock with the
      // bill re-read inside it, so ten parallel approvals post once (and a second signer waits for the first).
      const outcome = await withDocumentLock(id, LOCK_NS.APPROVAL, async (tx) => {
        const fresh = await pool.query("SELECT * FROM vendor_bills WHERE id = $1", [id]);
        const bill = normalizeBill(fresh.rows[0]);
        if (!bill) return { status: 404, body: { message: "Bill not found" } };

        await assertNotRejected("bill", id);
        if (bill.status !== "pending" && bill.status !== "pending_approval") {
          return { status: 400, body: { message: "Only pending bills can be approved" } };
        }

        // Approval triggers the AP journal entry on bill_date — block if locked.
        await assertPeriodNotLocked(bill.company_id, bill.bill_date);

        // Approval rules (amount and role): none = the single-step approval this route always had.
        const doc = await loadApprovalDocument("bill", id);
        const actor = await resolveActor(req.user!, bill.company_id);
        const step = doc ? await beginApprovalStep(tx, doc, actor, { previousStatus: bill.status, acknowledgeSoleApprover: req.body?.acknowledgeSoleApprover === true }) : ({ kind: "none" } as const);

        if (step.kind === "step" && !step.isFinal) {
          const request = await recordApprovalStep(tx, step, actor);
          const updated = await pool.query(`UPDATE vendor_bills SET status = 'pending_approval' WHERE id = $1 RETURNING *`, [id]);
          await auditApprovalStep({ req, actor, doc: doc!, request, stepNumber: step.stepNumber, decision: "approved" });
          void notifyApprovalProgress({ doc: doc!, request, actor, outcome: "needs_next_step" });
          return { status: 200, body: { ...normalizeBill(updated.rows[0]), ...pendingApprovalBody(step) } };
        }

        // Post the AP journal entry BEFORE flipping status — if posting fails the
        // bill stays pending and the books never diverge from the subledger.
        const linesResult = await pool.query(
          `SELECT id, description, amount, account_id, project_id, product_id, quantity FROM bill_line_items WHERE bill_id = $1`,
          [id]
        );
        if (linesResult.rows.some((r: any) => r.product_id)) {
          // Stock bought on the bill: the movements and the entry commit together (purchase-stock.service).
          await db.transaction(async (stockTx: any) => {
            const legs = await applyBillStockInTx(stockTx, bill, linesResult.rows, userId);
            await postBillApprovalJournal(bill, linesResult.rows, bill.category ?? null, userId, { tx: stockTx, legs });
          });
        } else {
          await postBillApprovalJournal(bill, linesResult.rows, bill.category ?? null, userId);
        }

        const updateResult = await pool.query(
          `UPDATE vendor_bills
       SET status = 'approved', approved_by = $1, approved_at = NOW()
       WHERE id = $2 RETURNING *`,
          [userId, id]
        );

        // Lines tagged with a project become billable project costs once the bill is on the ledger.
        await recordProjectExpensesForBill(id);

        if (step.kind === "step") {
          const request = await recordApprovalStep(tx, step, actor);
          await auditApprovalStep({ req, actor, doc: doc!, request, stepNumber: step.stepNumber, decision: "approved" });
          void notifyApprovalProgress({ doc: doc!, request, actor, outcome: "approved" });
        }

        log.info({ billId: id, approvedBy: userId }, "Vendor bill approved");
        await recordAudit({
          userId,
          companyId: bill.company_id,
          action: "bill.approve",
          entityType: "vendor_bill",
          entityId: id,
          before: { status: bill.status },
          after: {
            status: "approved",
            number: bill.bill_number,
            total: bill.total_amount,
            currency: bill.currency,
          },
          req,
        });
        return { status: 200, body: normalizeBill(updateResult.rows[0]) };
      });
      res.status(outcome.status).json(outcome.body);
    })
  );

  // Record payment against bill
  app.post(
    "/api/bills/:id/payments",
    authMiddleware,
    requireCustomer,
    validate({ body: billPaymentSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;

      const billResult = await pool.query("SELECT * FROM vendor_bills WHERE id = $1", [id]);

      if (billResult.rows.length === 0) {
        return res.status(404).json({ message: "Bill not found" });
      }

      const bill = normalizeBill(billResult.rows[0]);

      const hasAccess = await storage.hasCompanyAccess(userId, bill.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // A bill that has not been approved has no payable on the ledger: a payment would debit A/P with nothing
      // to settle and push the bill into 'partial', after which it could never be approved.
      if (bill.status === "pending_approval") {
        return res.status(409).json({
          message: "This bill is waiting for approval and cannot be paid yet.",
          code: "APPROVAL_IN_PROGRESS",
        });
      }
      if (["pending", "draft", "void", "cancelled"].includes(String(bill.status))) {
        return res.status(409).json({
          message: "Approve the bill before recording a payment.",
          code: "BILL_NOT_APPROVED",
        });
      }

      const { payment_date: requestedPaymentDate, amount, payment_method, reference, notes, payment_account_id } = req.body;

      const paymentAmount = amount;

      // Recording a payment posts a cash JE on the payment date. It defaults to
      // today and is rejected if in the future or inside a locked period (a
      // payment before the bill date is a legitimate prepayment).
      const { ymd: payment_date } = await resolveSettlementDate(bill.company_id, {
        requested: requestedPaymentDate,
      });

      // The payment row, the bill's paid total and the cash journal commit together (bill-payment.service):
      // the bill row is locked, the paid total recomputed under the lock, and the journal posted in the same
      // transaction, so a failed posting can no longer leave a payment without its ledger entry. The bank GL
      // account may be chosen (payment_account_id); the default stays 1020 (1010 for cash).
      const paid = await recordBillPayment({
        billId: id,
        companyId: bill.company_id,
        amount: paymentAmount,
        paymentDate: payment_date,
        paymentMethod: payment_method,
        reference,
        notes,
        paymentAccountId: payment_account_id,
        userId,
        requirePayableStatus: false,
      });
      const payment = normalizePayment(paid.payment);
      const newStatus = paid.billStatus;
      const newAmountPaid = paid.amountPaid;
      const totalAmount = paid.totalAmount;

      log.info(
        { billId: id, paymentId: payment.id, amount: paymentAmount, newStatus },
        "Bill payment recorded"
      );
      // S-H4: audit every money movement.
      await recordAudit({
        userId,
        companyId: bill.company_id,
        action: "bill.payment",
        entityType: "vendor_bill",
        entityId: id,
        after: { paymentId: payment.id, amount: Number(paymentAmount), status: newStatus },
        req,
      });
      res.json({
        payment,
        bill_status: newStatus,
        amount_paid: newAmountPaid,
        remaining: totalAmount - newAmountPaid,
      });
    })
  );

  // Backfill GL postings for bills approved/paid before bill→GL posting
  // existed. Idempotent: bills/payments that already carry a journal entry
  // are skipped, so this is safe to run repeatedly.
  app.post(
    "/api/companies/:companyId/bills/backfill-gl",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const billsRes = await pool.query(
        `SELECT * FROM vendor_bills
         WHERE company_id = $1 AND status IN ('approved','paid','partial','overdue')`,
        [companyId]
      );

      let billsPosted = 0;
      let paymentsPosted = 0;
      const errors: Array<{ billId: string; error: string }> = [];

      for (const bill of billsRes.rows.map(normalizeBill)) {
        try {
          await assertPeriodNotLocked(companyId, bill.bill_date);
          const before = await storage.getJournalEntriesBySource(companyId, "bill", bill.id);
          if (!before.some((e) => e.status === "posted")) {
            const linesRes = await pool.query(
              `SELECT description, amount, account_id, project_id FROM bill_line_items WHERE bill_id = $1`,
              [bill.id]
            );
            await postBillApprovalJournal(bill, linesRes.rows, bill.category ?? null, userId);
            billsPosted++;
          }

          const paymentsRes = await pool.query(`SELECT * FROM bill_payments WHERE bill_id = $1`, [
            bill.id,
          ]);
          for (const payment of paymentsRes.rows.map(normalizePayment)) {
            const existing = await storage.getJournalEntriesBySource(
              companyId,
              "bill_payment",
              payment.id
            );
            if (!existing.some((e) => e.status === "posted")) {
              await assertPeriodNotLocked(companyId, payment.payment_date);
              await postBillPaymentJournal(bill, payment, userId);
              paymentsPosted++;
            }
          }
        } catch (err: any) {
          errors.push({ billId: bill.id, error: err?.message || String(err) });
        }
      }

      log.info({ companyId, billsPosted, paymentsPosted }, "Bill GL backfill complete");
      res.json({ billsScanned: billsRes.rows.length, billsPosted, paymentsPosted, errors });
    })
  );

  // =====================================
  // Summary & Reports
  // =====================================

  // Bills summary (totals by status)
  app.get(
    "/api/companies/:companyId/bills/summary",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const result = await pool.query(
        `SELECT
        COUNT(*) FILTER (WHERE status IN ('pending', 'pending_approval')) AS pending_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status IN ('pending', 'pending_approval')), 0) AS pending_total,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'approved'), 0) AS approved_total,
        COUNT(*) FILTER (WHERE status = 'partial') AS partial_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'partial'), 0) AS partial_total,
        COALESCE(SUM(amount_paid) FILTER (WHERE status = 'partial'), 0) AS partial_paid,
        COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0) AS paid_total,
        COUNT(*) FILTER (WHERE due_date < NOW() AND status NOT IN ('paid')) AS overdue_count,
        COALESCE(SUM(total_amount - amount_paid) FILTER (WHERE due_date < NOW() AND status NOT IN ('paid')), 0) AS overdue_total
      FROM vendor_bills
      WHERE company_id = $1`,
        [companyId]
      );

      const summary = result.rows[0];

      res.json({
        pending: { count: Number(summary.pending_count), total: Number(summary.pending_total) },
        approved: { count: Number(summary.approved_count), total: Number(summary.approved_total) },
        partial: {
          count: Number(summary.partial_count),
          total: Number(summary.partial_total),
          paid: Number(summary.partial_paid),
        },
        paid: { count: Number(summary.paid_count), total: Number(summary.paid_total) },
        overdue: { count: Number(summary.overdue_count), total: Number(summary.overdue_total) },
      });
    })
  );

  // Aging report
  app.get(
    "/api/companies/:companyId/bills/aging",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Optional as-of day (aging-as-of.service.ts); without it the card is up to the moment.
      const parsedAsOf = parseAgingAsOf(req.query.asOf);
      if (!parsedAsOf.ok) {
        return res.status(400).json({ message: parsedAsOf.message, code: parsedAsOf.code });
      }

      const result = await pool.query(
        parsedAsOf.asOf
          ? billAgingBucketsAsOfSql()
          : `SELECT
        COALESCE(SUM(total_amount - amount_paid) FILTER (
          WHERE due_date >= NOW() OR due_date IS NULL
        ), 0)
          -- approved, unapplied vendor credits reduce what is owed (A/P holds them from their date)
          - COALESCE((SELECT SUM(remaining_amount) FROM vendor_credit_notes
                       WHERE company_id = $1 AND status = 'approved' AND remaining_amount > 0 AND "date" <= NOW()), 0)
          AS current_amount,
        COUNT(*) FILTER (
          WHERE due_date >= NOW() OR due_date IS NULL
        ) AS current_count,
        COALESCE(SUM(total_amount - amount_paid) FILTER (
          WHERE due_date < NOW() AND due_date >= NOW() - INTERVAL '30 days'
        ), 0) AS days_1_30_amount,
        COUNT(*) FILTER (
          WHERE due_date < NOW() AND due_date >= NOW() - INTERVAL '30 days'
        ) AS days_1_30_count,
        COALESCE(SUM(total_amount - amount_paid) FILTER (
          WHERE due_date < NOW() - INTERVAL '30 days' AND due_date >= NOW() - INTERVAL '60 days'
        ), 0) AS days_31_60_amount,
        COUNT(*) FILTER (
          WHERE due_date < NOW() - INTERVAL '30 days' AND due_date >= NOW() - INTERVAL '60 days'
        ) AS days_31_60_count,
        COALESCE(SUM(total_amount - amount_paid) FILTER (
          WHERE due_date < NOW() - INTERVAL '60 days' AND due_date >= NOW() - INTERVAL '90 days'
        ), 0) AS days_61_90_amount,
        COUNT(*) FILTER (
          WHERE due_date < NOW() - INTERVAL '60 days' AND due_date >= NOW() - INTERVAL '90 days'
        ) AS days_61_90_count,
        COALESCE(SUM(total_amount - amount_paid) FILTER (
          WHERE due_date < NOW() - INTERVAL '90 days'
        ), 0) AS days_90_plus_amount,
        COUNT(*) FILTER (
          WHERE due_date < NOW() - INTERVAL '90 days'
        ) AS days_90_plus_count
      FROM vendor_bills
      WHERE company_id = $1 AND status NOT IN ('paid')`,
        parsedAsOf.asOf ? asOfParams(companyId, parsedAsOf.asOf) : [companyId]
      );

      const aging = result.rows[0];

      res.json({
        current: { amount: Number(aging.current_amount), count: Number(aging.current_count) },
        days_1_30: { amount: Number(aging.days_1_30_amount), count: Number(aging.days_1_30_count) },
        days_31_60: {
          amount: Number(aging.days_31_60_amount),
          count: Number(aging.days_31_60_count),
        },
        days_61_90: {
          amount: Number(aging.days_61_90_amount),
          count: Number(aging.days_61_90_count),
        },
        days_90_plus: {
          amount: Number(aging.days_90_plus_amount),
          count: Number(aging.days_90_plus_count),
        },
      });
    })
  );
}
