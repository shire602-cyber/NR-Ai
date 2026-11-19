/**
 * Expense claims (W3-B: R04-03, R04-06, R04-11, R04-12, R04-20).
 *
 * draft → submitted → approved → paid (or rejected). Approval posts Dr expense / Dr recoverable
 * input VAT / Cr 2045 through the ledger kernel; mark-paid posts Dr 2045 / Cr the chosen cash or
 * bank account. The submitter cannot approve their own claim (maker-checker; single-member
 * companies may, configurable). Claim numbers come from a sequence, never COUNT(*)+1.
 */
import { journalMemo } from "@shared/journal-memo";
import type { Express, Request, Response } from "express";
import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { requirePermission } from "../middleware/companyRolePolicy";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { storage } from "../storage";
import { pool } from "../db";
import { createLogger } from "../config/logger";
import { DomainError } from "../errors";
import { ACCOUNT_CODES } from "../constants";
import { recordAudit } from "../services/audit.service";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import {
  buildExpenseClaimApprovalLines,
  buildExpenseClaimFxPaymentLines,
  buildExpenseClaimPaymentLines,
} from "../services/expense-claim-posting";
import {
  defineMachine,
  documentCurrency,
  loadBaseCurrency,
  postJournal,
  transitionRow,
  withLedgerTx,
  type LedgerTx,
} from "../ledger";
import { resolve } from "../platform/service-registry";
import type { FxConvert } from "../services/fx";
import { getFxAccounts } from "../services/invoice-posting.service";
import { txRows } from "../services/bill-posting.service";
import {
  nextDocNumber,
  resolveDocRate,
  resolvePaymentAccount,
} from "../services/bill-payment.service";
import {
  actorFromRequest,
  assertCompanyPermission,
  evaluateApproval,
} from "../services/approval-rules.service";
import {
  expenseCategoryPolicySchema,
  expenseClaimCreateSchema,
  expenseClaimMarkPaidSchema,
  expenseClaimPayrollSchema,
  expenseClaimRejectSchema,
  expenseClaimReviewSchema,
  expenseClaimSettingsSchema,
  expenseClaimUpdateSchema,
  type ExpenseClaimCreateInput,
  type ExpenseClaimItemInput,
  type ExpenseClaimMarkPaidInput,
  type ExpenseClaimPayrollInput,
  type ExpenseClaimUpdateInput,
} from "../../shared/validators/expense-claims";
import { assertClaimNotOnPayroll, setClaimPayrollReimbursement } from "../services/payroll/claims";
import { zUuid } from "../../shared/validators/primitives";
import { fromFils, mulRate, sumFils, toFils } from "../../shared/money";
import { companyIsVatRegistered } from "../tax/vat-registration";
import {
  signReceiptRef,
  storePurchaseFile,
  verifyReceiptRef,
} from "../services/bill-capture.service";
import { readReceiptImage } from "../services/fileStorage";
import { billAttachmentSchema } from "../../shared/validators/bills";

const log = createLogger("expense-claims");

const CLAIM_STATES = ["draft", "submitted", "approved", "rejected", "paid"] as const;
type ClaimState = (typeof CLAIM_STATES)[number];
const claimMachine = defineMachine<ClaimState>({
  states: CLAIM_STATES,
  transitions: {
    draft: ["submitted"],
    submitted: ["approved", "rejected"],
    approved: ["paid"],
  },
});

/** Drizzle mirror of the raw-SQL expense_claims table (columns transitions touch). */
const expenseClaimsTable = pgTable("expense_claims", {
  id: uuid("id").primaryKey(),
  companyId: uuid("company_id").notNull(),
  status: text("status"),
  submittedAt: timestamp("submitted_at"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  paidAt: timestamp("paid_at"),
  paidBy: uuid("paid_by"),
  paymentReference: text("payment_reference"),
  paymentAccountId: uuid("payment_account_id"),
});

interface ClaimRow {
  id: string;
  company_id: string;
  submitted_by: string;
  claim_number: string | null;
  status: ClaimState;
  total_amount: string;
  currency: string;
}

async function loadClaim(req: Request): Promise<ClaimRow> {
  const { id } = req.params;
  if (!zUuid.safeParse(id).success)
    throw new DomainError("EXPENSE_CLAIM_NOT_FOUND", 404, undefined, "Expense claim not found");
  const r = await pool.query("SELECT * FROM expense_claims WHERE id = $1", [id]);
  const claim = r.rows[0];
  if (!claim || !(await storage.hasCompanyAccess(req.user!.id, claim.company_id))) {
    throw new DomainError("EXPENSE_CLAIM_NOT_FOUND", 404, undefined, "Expense claim not found");
  }
  return claim;
}

/**
 * WQ2 (8.7): items leave the API with a signed receipt_ref (sent back unchanged on an edit) and
 * has_receipt; the storage key itself never reaches the client.
 */
function withReceiptRefs(companyId: string, rows: Array<Record<string, unknown>>) {
  return rows.map(({ receipt_path, ...item }) => ({
    ...item,
    has_receipt: !!receipt_path,
    receipt_ref: receipt_path ? signReceiptRef(companyId, String(receipt_path)) : null,
  }));
}

async function assertCompanyAccess(req: Request, companyId: string) {
  if (!(await storage.hasCompanyAccess(req.user!.id, companyId))) {
    throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
  }
}

interface PreparedItem {
  expense_date: string;
  category: string;
  description: string;
  item_type: string;
  quantity: number | null;
  unit_rate: string | null;
  amount: string;
  vat_amount: string;
  original_currency: string | null;
  original_amount: string | null;
  exchange_rate: string | null;
  supplier_trn: string | null;
  has_tax_invoice: boolean;
  vat_recoverable: boolean;
  receipt_url: string | null;
  receipt_path: string | null;
  receipt_name: string | null;
  merchant_name: string | null;
  grossFils: number;
}

async function claimSettings(companyId: string) {
  const r = await pool.query(`SELECT * FROM expense_claim_settings WHERE company_id = $1`, [
    companyId,
  ]);
  return {
    mileageRate: String(r.rows[0]?.mileage_rate ?? "0"),
    perDiemRate: String(r.rows[0]?.per_diem_rate ?? "0"),
  };
}

/** Normalise items: mileage / per-diem, FX conversion to the base currency, VAT recoverability. */
async function prepareItems(
  companyId: string,
  items: ExpenseClaimItemInput[]
): Promise<PreparedItem[]> {
  const settings = await claimSettings(companyId);
  const base = await loadBaseCurrency(companyId);
  const out: PreparedItem[] = [];
  for (const [i, item] of items.entries()) {
    const type = item.item_type ?? "expense";
    let netFils: number;
    let unitRate: string | null = null;
    if (type === "expense") {
      netFils = item.amount ?? 0;
    } else {
      unitRate = type === "mileage" ? settings.mileageRate : settings.perDiemRate;
      if (!(Number(unitRate) > 0)) {
        throw new DomainError(
          type === "mileage" ? "MILEAGE_RATE_NOT_SET" : "PER_DIEM_RATE_NOT_SET",
          422,
          { item: i },
          type === "mileage"
            ? "Set the company mileage rate before claiming mileage"
            : "Set the company per-diem rate before claiming per diem"
        );
      }
      netFils = toFils(
        new Decimal(item.quantity ?? 0).times(unitRate).toDecimalPlaces(2).toFixed(2)
      );
    }
    const vatFils = type === "expense" ? (item.vat_amount ?? 0) : 0;
    const currency = documentCurrency(item.currency, base);
    let rate: string | null = null;
    let netAed = netFils;
    let vatAed = vatFils;
    if (currency !== base) {
      rate = await resolveDocRate(
        companyId,
        currency,
        item.expense_date,
        item.exchange_rate ?? null
      );
      netAed = netFils === 0 ? 0 : mulRate(netFils, rate);
      vatAed = vatFils === 0 ? 0 : mulRate(vatFils, rate);
    }
    const hasTaxInvoice = item.has_tax_invoice === true;
    out.push({
      expense_date: item.expense_date,
      category: item.category,
      description: item.description,
      item_type: type,
      quantity: item.quantity ?? null,
      unit_rate: unitRate,
      amount: fromFils(netAed),
      vat_amount: fromFils(vatAed),
      original_currency: currency !== base ? currency : null,
      original_amount: currency !== base ? fromFils(netFils + vatFils) : null,
      exchange_rate: rate,
      supplier_trn: item.supplier_trn ?? null,
      has_tax_invoice: hasTaxInvoice,
      vat_recoverable: hasTaxInvoice && vatAed > 0,
      receipt_url: item.receipt_url ?? null,
      // WQ2 (8.7): an uploaded receipt is referenced by a ref signed for this company only.
      receipt_path: item.receipt_ref ? verifyReceiptRef(companyId, item.receipt_ref) : null,
      receipt_name: item.receipt_ref ? (item.receipt_name ?? null) : null,
      merchant_name: item.merchant_name ?? null,
      grossFils: netAed + vatAed,
    });
  }
  return out;
}

async function insertItems(tx: LedgerTx, claimId: string, items: PreparedItem[]) {
  for (const it of items) {
    await txRows(
      tx,
      `INSERT INTO expense_claim_items (claim_id, expense_date, category, description, amount, vat_amount,
          receipt_url, merchant_name, item_type, quantity, unit_rate, supplier_trn, has_tax_invoice,
          vat_recoverable, original_currency, original_amount, exchange_rate, receipt_path, receipt_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        claimId,
        it.expense_date,
        it.category,
        it.description,
        it.amount,
        it.vat_amount,
        it.receipt_url,
        it.merchant_name,
        it.item_type,
        it.quantity,
        it.unit_rate,
        it.supplier_trn,
        it.has_tax_invoice,
        it.vat_recoverable,
        it.original_currency,
        it.original_amount,
        it.exchange_rate,
        it.receipt_path,
        it.receipt_name,
      ]
    );
  }
}

async function allocateClaimNumber(tx: LedgerTx, companyId: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const n = await nextDocNumber(tx, companyId, "expense_claim", async () => {
      const c = await pool.query(
        `SELECT COUNT(*)::int AS n FROM expense_claims WHERE company_id = $1`,
        [companyId]
      );
      return Number(c.rows[0]?.n ?? 0) + 1;
    });
    const number = `EXP-${String(n).padStart(4, "0")}`;
    const clash = await txRows(
      tx,
      `SELECT 1 FROM expense_claims WHERE company_id = $1 AND claim_number = $2`,
      [companyId, number]
    );
    if (clash.length === 0) return number;
  }
  throw new DomainError("CLAIM_NUMBER_EXHAUSTED", 409);
}

export function registerExpenseClaimRoutes(app: Express) {
  // ── List ────────────────────────────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/expense-claims",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const { status, submitted_by } = req.query;
      let query = "SELECT * FROM expense_claims WHERE company_id = $1";
      const params: unknown[] = [companyId];
      if (typeof status === "string" && status) {
        params.push(status);
        query += ` AND status = $${params.length}`;
      }
      if (typeof submitted_by === "string" && zUuid.safeParse(submitted_by).success) {
        params.push(submitted_by);
        query += ` AND submitted_by = $${params.length}`;
      }
      query += " ORDER BY created_at DESC";
      res.json((await pool.query(query, params)).rows);
    })
  );

  // ── Settings: mileage / per-diem rates ──────────────────────────────────
  app.get(
    "/api/companies/:companyId/expense-claims/settings",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const s = await claimSettings(companyId);
      res.json({ mileage_rate: Number(s.mileageRate), per_diem_rate: Number(s.perDiemRate) });
    })
  );

  app.put(
    "/api/companies/:companyId/expense-claims/settings",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    strictBody(expenseClaimSettingsSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const body = parsedBody<{ mileage_rate?: number; per_diem_rate?: string }>(req);
      const r = await pool.query(
        `INSERT INTO expense_claim_settings (company_id, mileage_rate, per_diem_rate, updated_at)
         VALUES ($1, COALESCE($2::numeric, 0), COALESCE($3::numeric, 0), now())
         ON CONFLICT (company_id) DO UPDATE
           SET mileage_rate = COALESCE($2::numeric, expense_claim_settings.mileage_rate),
               per_diem_rate = COALESCE($3::numeric, expense_claim_settings.per_diem_rate),
               updated_at = now()
         RETURNING *`,
        [companyId, body.mileage_rate ?? null, body.per_diem_rate ?? null]
      );
      res.json({
        mileage_rate: Number(r.rows[0].mileage_rate),
        per_diem_rate: Number(r.rows[0].per_diem_rate),
      });
    })
  );

  // ── Category policies (receipt required) ────────────────────────────────
  app.get(
    "/api/companies/:companyId/expense-claims/policies",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const r = await pool.query(
        `SELECT * FROM expense_category_policies WHERE company_id = $1 ORDER BY category`,
        [companyId]
      );
      res.json(r.rows);
    })
  );

  app.post(
    "/api/companies/:companyId/expense-claims/policies",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    strictBody(expenseCategoryPolicySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const body = parsedBody<{
        category: string;
        receipt_required: boolean;
        receipt_threshold?: string;
      }>(req);
      const r = await pool.query(
        `INSERT INTO expense_category_policies (company_id, category, receipt_required, receipt_threshold)
         VALUES ($1, $2, $3, COALESCE($4::numeric, 0))
         ON CONFLICT (company_id, lower(category)) DO UPDATE
           SET receipt_required = EXCLUDED.receipt_required, receipt_threshold = EXCLUDED.receipt_threshold
         RETURNING *`,
        [companyId, body.category, body.receipt_required, body.receipt_threshold ?? null]
      );
      res.status(201).json(r.rows[0]);
    })
  );

  app.delete(
    "/api/companies/:companyId/expense-claims/policies/:policyId",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, policyId } = req.params;
      if (!zUuid.safeParse(policyId).success) throw new DomainError("POLICY_NOT_FOUND", 404);
      const r = await pool.query(
        `DELETE FROM expense_category_policies WHERE id = $1 AND company_id = $2`,
        [policyId, companyId]
      );
      if (!r.rowCount) throw new DomainError("POLICY_NOT_FOUND", 404);
      res.json({ deleted: true });
    })
  );

  // ── Read one ────────────────────────────────────────────────────────────
  app.get(
    "/api/expense-claims/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const claim = await loadClaim(req);
      const items = await pool.query(
        "SELECT * FROM expense_claim_items WHERE claim_id = $1 ORDER BY expense_date ASC, created_at ASC",
        [claim.id]
      );
      res.json({ ...claim, items: withReceiptRefs(claim.company_id, items.rows) });
    })
  );

  // ── WQ2 (8.7): receipt files ────────────────────────────────────────────
  // Upload first (the upload guard checks the magic number, size and malware), then save the
  // claim with the returned receipt_ref on the item.
  app.post(
    "/api/companies/:companyId/expense-claims/receipts",
    authMiddleware,
    requireCustomer,
    strictBody(billAttachmentSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const { file, filename } = parsedBody<{ file: string; filename?: string | null }>(req);
      const path = await storePurchaseFile(file);
      res.status(201).json({
        receipt_ref: signReceiptRef(companyId, path),
        receipt_name: filename ?? null,
      });
    })
  );

  app.get(
    "/api/expense-claims/:id/items/:itemId/receipt",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const claim = await loadClaim(req);
      const { itemId } = req.params;
      if (!zUuid.safeParse(itemId).success) throw new DomainError("RECEIPT_NOT_FOUND", 404);
      const r = await pool.query(
        `SELECT receipt_path FROM expense_claim_items WHERE id = $1 AND claim_id = $2`,
        [itemId, claim.id]
      );
      const path = r.rows[0]?.receipt_path as string | undefined;
      if (!path) throw new DomainError("RECEIPT_NOT_FOUND", 404);
      const file = await readReceiptImage(path);
      if (!file) throw new DomainError("RECEIPT_NOT_FOUND", 404);
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      res.send(file.buffer);
    })
  );

  // ── Create ──────────────────────────────────────────────────────────────
  app.post(
    "/api/companies/:companyId/expense-claims",
    authMiddleware,
    requireCustomer,
    strictBody(expenseClaimCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const body = parsedBody<ExpenseClaimCreateInput>(req);
      const items = await prepareItems(companyId, body.items ?? []);
      const total = sumFils(items.map((i) => i.grossFils));
      const out = await withLedgerTx(async (tx) => {
        const claimNumber = await allocateClaimNumber(tx, companyId);
        const rows = await txRows<ClaimRow>(
          tx,
          `INSERT INTO expense_claims (company_id, submitted_by, claim_number, title, description, total_amount, currency, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft') RETURNING *`,
          [
            companyId,
            req.user!.id,
            claimNumber,
            body.title,
            body.description ?? null,
            fromFils(total),
            await loadBaseCurrency(companyId),
          ]
        );
        await insertItems(tx, rows[0].id, items);
        const inserted = await txRows(
          tx,
          `SELECT * FROM expense_claim_items WHERE claim_id = $1 ORDER BY expense_date`,
          [rows[0].id]
        );
        return { ...rows[0], items: withReceiptRefs(companyId, inserted) };
      });
      log.info(
        { claimId: out.id, companyId, claimNumber: out.claim_number },
        "Expense claim created"
      );
      res.json(out);
    })
  );

  // ── Update (draft only) ─────────────────────────────────────────────────
  app.patch(
    "/api/expense-claims/:id",
    authMiddleware,
    requireCustomer,
    strictBody(expenseClaimUpdateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const claim = await loadClaim(req);
      if (claim.status !== "draft") {
        throw new DomainError(
          "CLAIM_NOT_DRAFT",
          409,
          { status: claim.status },
          "Only draft claims can be updated"
        );
      }
      const body = parsedBody<ExpenseClaimUpdateInput>(req);
      const items = body.items ? await prepareItems(claim.company_id, body.items) : null;
      const out = await withLedgerTx(async (tx) => {
        const rows = await txRows<ClaimRow>(
          tx,
          `UPDATE expense_claims SET title = COALESCE($2, title),
              description = CASE WHEN $3::boolean THEN $4 ELSE description END,
              total_amount = COALESCE($5, total_amount)
            WHERE id = $1 AND status = 'draft' RETURNING *`,
          [
            claim.id,
            body.title ?? null,
            body.description !== undefined,
            body.description ?? null,
            items ? fromFils(sumFils(items.map((i) => i.grossFils))) : null,
          ]
        );
        if (!rows[0]) throw new DomainError("CLAIM_NOT_DRAFT", 409);
        if (items) {
          await txRows(tx, `DELETE FROM expense_claim_items WHERE claim_id = $1`, [claim.id]);
          await insertItems(tx, claim.id, items);
        }
        const all = await txRows(
          tx,
          `SELECT * FROM expense_claim_items WHERE claim_id = $1 ORDER BY expense_date`,
          [claim.id]
        );
        return { ...rows[0], items: withReceiptRefs(claim.company_id, all) };
      });
      res.json(out);
    })
  );

  // ── Delete (draft only) ─────────────────────────────────────────────────
  app.delete(
    "/api/expense-claims/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const claim = await loadClaim(req);
      if (claim.status !== "draft") {
        throw new DomainError(
          "CLAIM_NOT_DRAFT",
          409,
          { status: claim.status },
          "Only draft claims can be deleted"
        );
      }
      await pool.query("DELETE FROM expense_claims WHERE id = $1 AND status = 'draft'", [claim.id]);
      res.json({ message: "Expense claim deleted successfully" });
    })
  );

  // ── Submit (receipt policy enforced) ────────────────────────────────────
  app.post(
    "/api/expense-claims/:id/submit",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const claim = await loadClaim(req);
      const items = (
        await pool.query(`SELECT * FROM expense_claim_items WHERE claim_id = $1`, [claim.id])
      ).rows as Array<Record<string, string | null>>;
      if (items.length === 0) {
        throw new DomainError(
          "NO_ITEMS",
          400,
          undefined,
          "Cannot submit a claim with no expense items"
        );
      }
      const policies = (
        await pool.query(
          `SELECT * FROM expense_category_policies WHERE company_id = $1 AND receipt_required = true`,
          [claim.company_id]
        )
      ).rows as Array<Record<string, string | null>>;
      const missing = items.filter((it) => {
        const p = policies.find(
          (x) => String(x.category).toLowerCase() === String(it.category).toLowerCase()
        );
        if (!p || it.receipt_url || it.receipt_path) return false;
        return (
          toFils(String(it.amount)) + toFils(String(it.vat_amount ?? 0)) >=
          toFils(String(p.receipt_threshold ?? 0))
        );
      });
      if (missing.length) {
        throw new DomainError(
          "RECEIPT_REQUIRED",
          422,
          { items: missing.map((m) => ({ id: m.id, category: m.category })) },
          "A receipt is required for these expense categories"
        );
      }
      const row = await withLedgerTx((tx) =>
        transitionRow(
          tx,
          expenseClaimsTable,
          claim.id,
          "draft",
          "submitted",
          { submittedAt: new Date() },
          {
            machine: claimMachine,
            where: eq(expenseClaimsTable.companyId, claim.company_id),
          }
        )
      );
      if (!row)
        throw new DomainError(
          "CLAIM_NOT_DRAFT",
          409,
          { status: claim.status },
          "Only draft claims can be submitted"
        );
      log.info({ claimId: claim.id }, "Expense claim submitted");
      res.json(
        (await pool.query(`SELECT * FROM expense_claims WHERE id = $1`, [claim.id])).rows[0]
      );
    })
  );

  // ── Approve (maker-checker, approval rules, posts the accrual) ──────────
  app.post(
    "/api/expense-claims/:id/approve",
    authMiddleware,
    requireCustomer,
    strictBody(expenseClaimReviewSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const claim = await loadClaim(req);
      if (claim.status !== "submitted") {
        throw new DomainError(
          "CLAIM_NOT_SUBMITTED",
          409,
          { status: claim.status },
          "Only submitted claims can be approved"
        );
      }
      const actor = actorFromRequest(req);
      await assertCompanyPermission(actor, claim.company_id, ["documents.approve"]);
      const items = (
        await pool.query(
          `SELECT category, amount, vat_amount, vat_recoverable, expense_date FROM expense_claim_items WHERE claim_id = $1`,
          [claim.id]
        )
      ).rows as Array<{
        category: string;
        amount: string;
        vat_amount: string | null;
        vat_recoverable: boolean;
        expense_date: string;
      }>;
      // E3 (J2-r3): a company that is not VAT registered recovers no input VAT on claims.
      const vatRegistered = await companyIsVatRegistered(claim.company_id);
      const accounts = await storage.getAccountsByCompanyId(claim.company_id);
      const codeToId = new Map(
        accounts.filter((a) => a.isActive !== false).map((a) => [a.code, a.id])
      );
      const built = buildExpenseClaimApprovalLines({
        items: items.map((r) => ({
          category: r.category,
          amountFils: toFils(String(r.amount), { rounding: "halfUp" }),
          vatFils: toFils(String(r.vat_amount ?? 0), { rounding: "halfUp" }),
          vatRecoverable: vatRegistered && r.vat_recoverable === true,
        })),
        resolveByCode: (code) => codeToId.get(code) ?? null,
      });
      if (!built.ok) throw new DomainError(built.code, built.status, undefined, built.message);
      const latest = items
        .map((r) => new Date(r.expense_date).toISOString().slice(0, 10))
        .sort()
        .pop()!;
      const notes = (req.body as { review_notes?: string | null }).review_notes ?? null;
      const out = await withLedgerTx(async (tx) => {
        const gate = await evaluateApproval(tx, {
          companyId: claim.company_id,
          documentType: "expense_claim",
          documentId: claim.id,
          amountFils: built.grossFils,
          makerId: claim.submitted_by,
          actor,
          comment: notes,
        });
        if (!gate.final) return { gate, entryId: null as string | null };
        const { entry } = await postJournal(
          {
            companyId: claim.company_id,
            date: latest,
            ...journalMemo("expenseClaimApproved", { ref: claim.claim_number || claim.id }),
            status: "posted",
            source: "expense_claim",
            sourceId: claim.id,
            idempotencyKey: `expense_claim:${claim.id}:approve`,
            reference: claim.claim_number,
            allowFutureDate: true,
            lines: built.lines,
          },
          { actorId: actor.id, tx }
        );
        const row = await transitionRow(
          tx,
          expenseClaimsTable,
          claim.id,
          "submitted",
          "approved",
          { reviewedBy: actor.id, reviewedAt: new Date(), reviewNotes: notes },
          { machine: claimMachine, where: eq(expenseClaimsTable.companyId, claim.company_id) }
        );
        if (!row) throw new DomainError("CLAIM_STATE_CHANGED", 409);
        return { gate, entryId: entry.id };
      });
      await recordAudit({
        userId: actor.id,
        companyId: claim.company_id,
        action: out.gate.final ? "expense_claim.approve" : "expense_claim.approve_step",
        entityType: "expense_claim",
        entityId: claim.id,
        after: {
          journalEntryId: out.entryId,
          totalFils: built.grossFils,
          step: out.gate.stepOrder,
        },
        req,
      });
      const fresh = (await pool.query(`SELECT * FROM expense_claims WHERE id = $1`, [claim.id]))
        .rows[0];
      res.json({
        ...fresh,
        approval: {
          final: out.gate.final,
          step: out.gate.stepOrder,
          remainingSteps: out.gate.remainingSteps,
        },
        journal_entry_id: out.entryId,
      });
    })
  );

  // ── Reject ──────────────────────────────────────────────────────────────
  app.post(
    "/api/expense-claims/:id/reject",
    authMiddleware,
    requireCustomer,
    strictBody(expenseClaimRejectSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const claim = await loadClaim(req);
      const actor = actorFromRequest(req);
      await assertCompanyPermission(actor, claim.company_id, ["documents.approve"]);
      const notes = (req.body as { review_notes: string }).review_notes;
      const row = await withLedgerTx((tx) =>
        transitionRow(
          tx,
          expenseClaimsTable,
          claim.id,
          "submitted",
          "rejected",
          { reviewedBy: actor.id, reviewedAt: new Date(), reviewNotes: notes },
          { machine: claimMachine, where: eq(expenseClaimsTable.companyId, claim.company_id) }
        )
      );
      if (!row)
        throw new DomainError(
          "CLAIM_NOT_SUBMITTED",
          409,
          { status: claim.status },
          "Only submitted claims can be rejected"
        );
      res.json(
        (await pool.query(`SELECT * FROM expense_claims WHERE id = $1`, [claim.id])).rows[0]
      );
    })
  );

  // ── Mark paid (posts Dr 2045 / Cr cash or bank) ─────────────────────────
  app.post(
    "/api/expense-claims/:id/mark-paid",
    authMiddleware,
    requireCustomer,
    strictBody(expenseClaimMarkPaidSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const claim = await loadClaim(req);
      if (claim.status !== "approved") {
        throw new DomainError(
          "CLAIM_NOT_APPROVED",
          409,
          { status: claim.status },
          "Only approved claims can be marked as paid"
        );
      }
      const body = parsedBody<ExpenseClaimMarkPaidInput>(req);
      const paymentDate = body.payment_date ?? new Date().toISOString().slice(0, 10);
      await assertPeriodNotLocked(claim.company_id, paymentDate);
      const cash = await resolvePaymentAccount(claim.company_id, body.payment_account_id ?? null);
      const accounts = await storage.getAccountsByCompanyId(claim.company_id);
      const payable = accounts.find((a) => a.code === ACCOUNT_CODES.EMP_REIMBURSEMENT_PAYABLE);
      if (!payable) throw new DomainError("REIMBURSEMENT_ACCOUNT_MISSING", 422);
      const out = await withLedgerTx(async (tx) => {
        const owed = await txRows<{ fils: string }>(
          tx,
          `SELECT COALESCE(SUM(ROUND(jl.credit*100) - ROUND(jl.debit*100)), 0)::bigint AS fils
             FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
            WHERE je.company_id = $1 AND je.source = 'expense_claim' AND je.source_id = $2
              AND je.status = 'posted' AND je.reversed_by_entry_id IS NULL AND jl.account_id = $3`,
          [claim.company_id, claim.id, payable.id]
        );
        // S2 (R04-20): a claim on a live payroll run is paid by the salary payment.
        await assertClaimNotOnPayroll(tx, claim.company_id, claim.id);
        const amountFils = Number(owed[0]?.fils ?? 0);
        if (amountFils <= 0) {
          throw new DomainError(
            "CLAIM_NOT_POSTED",
            409,
            undefined,
            "The approved claim has no posted accrual to settle"
          );
        }
        const row = await transitionRow(
          tx,
          expenseClaimsTable,
          claim.id,
          "approved",
          "paid",
          {
            paidAt: new Date(`${paymentDate}T00:00:00.000Z`),
            paidBy: req.user!.id,
            paymentReference: body.payment_reference ?? null,
            paymentAccountId: cash.id,
          },
          { machine: claimMachine, where: eq(expenseClaimsTable.companyId, claim.company_id) }
        );
        if (!row) throw new DomainError("CLAIM_NOT_APPROVED", 409);
        const claimNumber = claim.claim_number || claim.id.slice(0, 8);
        // W5-C (R14-16): a single-currency foreign claim paid from a bank account in that
        // currency settles at the payment-date rate (fx) with realised FX.
        const fxItems = await txRows<{
          original_currency: string | null;
          original_amount: string | null;
        }>(
          tx,
          `SELECT original_currency, original_amount FROM expense_claim_items WHERE claim_id = $1`,
          [claim.id]
        );
        const claimCurrencies = new Set(fxItems.map((i) => i.original_currency));
        const foreignCur =
          fxItems.length > 0 && claimCurrencies.size === 1 ? [...claimCurrencies][0] : null;
        const bankCur = foreignCur
          ? (
              await txRows<{ currency: string }>(
                tx,
                `SELECT UPPER(currency) AS currency FROM bank_accounts
                  WHERE company_id = $1 AND gl_account_id = $2 AND is_active = true LIMIT 1`,
                [claim.company_id, cash.id]
              )
            )[0]?.currency
          : null;
        let paymentLines: ReturnType<typeof buildExpenseClaimPaymentLines> =
          buildExpenseClaimPaymentLines({
            payableAccountId: payable.id,
            paymentAccountId: cash.id,
            amountFils,
            claimNumber,
          });
        if (foreignCur && bankCur === foreignCur.toUpperCase()) {
          const foreignFils = sumFils(
            fxItems.map((i) => toFils(String(i.original_amount ?? 0), { rounding: "halfUp" }))
          );
          const base = await loadBaseCurrency(claim.company_id, tx);
          const conv = await resolve<FxConvert>("fx.convert")(
            claim.company_id,
            foreignFils,
            foreignCur,
            base,
            paymentDate
          );
          const fxAcc = await getFxAccounts(tx, claim.company_id);
          paymentLines = buildExpenseClaimFxPaymentLines({
            payableAccountId: payable.id,
            paymentAccountId: cash.id,
            accruedFils: amountFils,
            foreignCurrency: foreignCur.toUpperCase(),
            foreignFils,
            paymentRate: conv.rateText,
            cashBaseFils: conv.convertedFils,
            fxGainAccountId: fxAcc.gain,
            fxLossAccountId: fxAcc.loss,
            claimNumber,
          });
        }
        const { entry } = await postJournal(
          {
            companyId: claim.company_id,
            date: paymentDate,
            ...journalMemo("expenseClaimReimbursed", { ref: claim.claim_number || claim.id }),
            status: "posted",
            source: "expense_claim_payment",
            sourceId: claim.id,
            idempotencyKey: `expense_claim:${claim.id}:paid`,
            reference: body.payment_reference ?? claim.claim_number,
            allowFutureDate: true,
            lines: paymentLines,
          },
          { actorId: req.user!.id, tx }
        );
        return { entryId: entry.id, amountFils };
      });
      await recordAudit({
        userId: req.user!.id,
        companyId: claim.company_id,
        action: "expense_claim.paid",
        entityType: "expense_claim",
        entityId: claim.id,
        after: {
          journalEntryId: out.entryId,
          amount: fromFils(out.amountFils),
          paymentAccountId: cash.id,
        },
        req,
      });
      const fresh = (await pool.query(`SELECT * FROM expense_claims WHERE id = $1`, [claim.id]))
        .rows[0];
      res.json({ ...fresh, journal_entry_id: out.entryId });
    })
  );

  // ── Reimburse through payroll (S2, R04-20) ──────────────────────────────
  // Approved claims queued here are added to the employee's next payroll run (payslip line) and
  // 2045 is cleared by that run's salary payment journal.
  app.post(
    "/api/expense-claims/:id/payroll-reimbursement",
    authMiddleware,
    requireCustomer,
    strictBody(expenseClaimPayrollSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const claim = await loadClaim(req);
      const actor = actorFromRequest(req);
      await assertCompanyPermission(actor, claim.company_id, ["documents.approve"]);
      const body = parsedBody<ExpenseClaimPayrollInput>(req);
      const row = await withLedgerTx((tx) =>
        setClaimPayrollReimbursement(tx, {
          companyId: claim.company_id,
          claimId: claim.id,
          submittedBy: claim.submitted_by,
          enabled: body.enabled,
          employeeId: body.employee_id ?? null,
        })
      );
      await recordAudit({
        userId: actor.id,
        companyId: claim.company_id,
        action: body.enabled ? "expense_claim.payroll_queue" : "expense_claim.payroll_unqueue",
        entityType: "expense_claim",
        entityId: claim.id,
        after: { employeeId: row.employee_id ?? null, enabled: body.enabled },
        req,
      });
      res.json(row);
    })
  );

  // ── Summary ─────────────────────────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/expense-claims/summary",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertCompanyAccess(req, companyId);
      const q = (extra: string) =>
        pool.query(
          `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(total_amount), 0) AS total
             FROM expense_claims WHERE company_id = $1 ${extra} GROUP BY status`,
          [companyId]
        );
      const [all, month] = await Promise.all([
        q(""),
        q("AND created_at >= date_trunc('month', CURRENT_DATE)"),
      ]);
      const shape = (rows: Array<{ status: string; count: number; total: string }>) =>
        Object.fromEntries(
          rows.map((r) => [r.status, { count: Number(r.count), total: Number(r.total) }])
        );
      res.json({ all: shape(all.rows), thisMonth: shape(month.rows) });
    })
  );
}
