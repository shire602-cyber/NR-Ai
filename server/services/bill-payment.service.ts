/**
 * Vendor bill lifecycle services (W3-B): create / edit / revise bills, payments with
 * payment-date FX and realised gain/loss (R14-05), payment void, vendor prepayments, debit notes
 * (vendor credits), batch payment export, recurring bills, inbound drafts.
 *
 * Every write that has a ledger effect runs in ONE withLedgerTx transaction: the sub-ledger rows
 * and the kernel journal commit together, so a journal failure rolls the payment back (R04-13).
 * Amounts are integer fils; comparisons are exact (no tolerance, R04-14).
 *
 * Registered services (server/platform/service-registry):
 *   "bills.recordPayment"        → recordBillPayment
 *   "bills.createDraftFromInbound" → createDraftFromInbound
 */
import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { DomainError } from "../errors";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { ACCOUNT_CODES } from "../constants";
import { fromFils, mulRate, sumFils } from "../../shared/money";
import {
  postJournal,
  reverseBySource,
  transitionRow,
  withLedgerTx,
  type LedgerTx,
} from "../ledger";
import { emitDomainEventInTx } from "../platform/event-outbox";
import { has, provide, resolve } from "../platform/service-registry";
import { registerJob, listJobs } from "../platform/job-registry";
import type { FxGetRate } from "./fx";
import { recordAudit } from "./audit.service";
import { assertPeriodNotLocked } from "./period-lock.service";
import { documentCurrency, isForeignCurrency, loadBaseCurrency } from "../ledger";
import {
  BILL_PAYMENT_JE_SOURCE,
  PAYABLE_BILL_STATES,
  VENDOR_ADVANCES_CODE,
  billMachine,
  computeBillTotals,
  currentBillApCreditFils,
  ensureAccountByCode,
  filsOf,
  isForeign,
  isoDateOf,
  rateTextOf,
  requireApAccount,
  toBase,
  txRows,
  vendorBillsTable,
  type BillRow,
  type BillState,
} from "./bill-posting.service";
import { resolveVendor } from "./vendor.service";
import { debitNoteCreateSchema, inboundBillSchema } from "../../shared/validators/bills";
import { parseStrict } from "../http/strict-body";
import type {
  ApplyCreditInput,
  BillCreateInput,
  BillUpdateInput,
  DebitNoteCreateInput,
  InboundBillInput,
  InboundVendorCreditInput,
  PrepaymentCreateInput,
  RecurringBillCreateInput,
} from "../../shared/validators/bills";
import type { Account } from "../../shared/schema";

const log = createLogger("bill-payment");

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Rate (document currency → company base currency) as a 6dp-safe string: "1" in the base
 * currency (W5-C), else given, else fx.getRate (tenant-scoped).
 */
export async function resolveDocRate(
  companyId: string,
  currency: string | null | undefined,
  dateIso: string,
  given?: string | null
): Promise<string> {
  const base = await loadBaseCurrency(companyId);
  const cur = documentCurrency(currency, base);
  if (cur === base) return "1";
  if (given) return given;
  const getRate = resolve<FxGetRate>("fx.getRate");
  const r = await getRate(companyId, cur, base, dateIso);
  return r.rateText;
}

/** Next number for a purchases document type (atomic upsert, R04-12: never COUNT(*)+1). */
export async function nextDocNumber(
  tx: LedgerTx,
  companyId: string,
  docType: string,
  seed?: () => Promise<number>
): Promise<number> {
  const existing = await txRows<{ next_value: number }>(
    tx,
    `SELECT next_value FROM purchase_doc_sequences WHERE company_id = $1 AND doc_type = $2`,
    [companyId, docType]
  );
  if (existing.length === 0 && seed) {
    const start = await seed();
    await txRows(
      tx,
      `INSERT INTO purchase_doc_sequences (company_id, doc_type, next_value) VALUES ($1, $2, $3)
       ON CONFLICT (company_id, doc_type) DO NOTHING`,
      [companyId, docType, Math.max(1, start)]
    );
  }
  const rows = await txRows<{ n: number }>(
    tx,
    `INSERT INTO purchase_doc_sequences (company_id, doc_type, next_value) VALUES ($1, $2, 2)
     ON CONFLICT (company_id, doc_type)
       DO UPDATE SET next_value = purchase_doc_sequences.next_value + 1
     RETURNING next_value - 1 AS n`,
    [companyId, docType]
  );
  return Number(rows[0].n);
}

const usable = (a: Account | undefined): a is Account =>
  !!a && a.isActive !== false && a.isArchived !== true;

const CASH_SUBTYPES = new Set(["cash", "bank"]);
const CASH_CODES = new Set(["1010", "1020", "1030"]);

/** The cash/bank account a payment credits (R04-14): chosen, else 1020 (1010 for cash). */
export async function resolvePaymentAccount(
  companyId: string,
  paymentAccountId: string | null | undefined,
  method?: string | null
): Promise<Account> {
  const accounts = await storage.getAccountsByCompanyId(companyId);
  if (paymentAccountId) {
    const a = accounts.find((x) => x.id === paymentAccountId);
    if (!a) throw new DomainError("ACCOUNT_NOT_FOUND", 404, { paymentAccountId });
    if (!usable(a)) throw new DomainError("ACCOUNT_INACTIVE", 409, { paymentAccountId });
    if (a.type !== "asset" || !(CASH_SUBTYPES.has(a.subType ?? "") || CASH_CODES.has(a.code))) {
      throw new DomainError(
        "PAYMENT_ACCOUNT_REQUIRED",
        400,
        { paymentAccountId },
        "Payment account must be a cash or bank account"
      );
    }
    return a;
  }
  const code = method === "cash" ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK;
  const a =
    accounts.find((x) => x.code === code && x.type === "asset" && usable(x)) ??
    accounts.find((x) => x.code === ACCOUNT_CODES.BANK && x.type === "asset" && usable(x));
  if (!a)
    throw new DomainError("PAYMENT_ACCOUNT_REQUIRED", 422, undefined, "No bank account found");
  return a;
}

async function lockBill(tx: LedgerTx, billId: string, companyId?: string): Promise<BillRow> {
  const rows = await txRows<BillRow>(
    tx,
    `SELECT * FROM vendor_bills WHERE id = $1 AND ($2::uuid IS NULL OR company_id = $2) FOR UPDATE`,
    [billId, companyId ?? null]
  );
  if (!rows[0]) throw new DomainError("BILL_NOT_FOUND", 404, undefined, "Bill not found");
  return rows[0];
}

async function paidFils(tx: LedgerTx, billId: string): Promise<number> {
  const rows = await txRows<{ fils: string }>(
    tx,
    `SELECT COALESCE(SUM(ROUND(amount * 100)), 0)::bigint AS fils FROM bill_payments WHERE bill_id = $1`,
    [billId]
  );
  return Number(rows[0]?.fils ?? 0);
}

/** A/P base (fils) already settled by active payment-like rows (net of reversals). */
async function settledApBaseFils(tx: LedgerTx, bill: BillRow): Promise<number> {
  const rows = await txRows<{ amount: string; ap_amount_base: string | null }>(
    tx,
    `SELECT amount, ap_amount_base FROM bill_payments WHERE bill_id = $1`,
    [bill.id]
  );
  const base = await loadBaseCurrency(String(bill.company_id), tx);
  const rate = rateTextOf(bill, base);
  const foreign = isForeign(bill, base);
  return sumFils(
    rows.map((r) => {
      if (r.ap_amount_base !== null && r.ap_amount_base !== undefined)
        return filsOf(r.ap_amount_base);
      const f = filsOf(r.amount);
      return f < 0 ? -toBase(-f, rate, foreign) : toBase(f, rate, foreign);
    })
  );
}

/**
 * Move the bill to the status its settlements imply (approved / partial / paid) with one
 * conditional update, and set amount_paid from the payment rows.
 */
async function settleStatus(
  tx: LedgerTx,
  bill: BillRow
): Promise<{ status: BillState; paidFils: number }> {
  const paid = await paidFils(tx, bill.id);
  const total = filsOf(bill.total_amount);
  const target: BillState = paid <= 0 ? "approved" : paid >= total ? "paid" : "partial";
  const current = (bill.status ?? "approved") as BillState;
  const amountPaid = fromFils(Math.max(0, paid));
  if (current === target || (current === "overdue" && target === "approved")) {
    await txRows(tx, `UPDATE vendor_bills SET amount_paid = $1 WHERE id = $2 AND status = $3`, [
      amountPaid,
      bill.id,
      current,
    ]);
    return { status: current, paidFils: paid };
  }
  const row = await transitionRow(
    tx,
    vendorBillsTable,
    bill.id,
    current,
    target,
    { amountPaid, paidAt: target === "paid" ? new Date() : null },
    { machine: billMachine, where: eq(vendorBillsTable.companyId, bill.company_id) }
  );
  if (!row) throw new DomainError("BILL_STATE_CHANGED", 409, undefined, "The bill changed; retry");
  return { status: target, paidFils: paid };
}

// ─── Bills: create / edit ───────────────────────────────────────────────────

export interface BillWriteResult {
  bill: BillRow & Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
  warnings: Array<{ code: string; message: string }>;
}

type BillFieldsInput = Partial<BillCreateInput> & Pick<BillUpdateInput, "line_items">;

interface PreparedBill {
  header: Record<string, unknown>;
  lines: Array<Record<string, unknown>> | null;
  warnings: Array<{ code: string; message: string }>;
}

/** Validate + compute everything for a bill create/update; no writes. */
async function prepareBill(
  companyId: string,
  input: BillFieldsInput,
  existing: BillRow | null
): Promise<PreparedBill> {
  const warnings: Array<{ code: string; message: string }> = [];
  const header: Record<string, unknown> = {};
  const get = <K extends keyof BillFieldsInput>(k: K, fallback: unknown) =>
    input[k] !== undefined ? input[k] : fallback;

  // Vendor master link (R04-16).
  if (
    input.vendor_id !== undefined ||
    input.vendor_name !== undefined ||
    input.vendor_trn !== undefined
  ) {
    const v = await resolveVendor(companyId, {
      vendor_id: input.vendor_id ?? null,
      vendor_name: input.vendor_name ?? (existing?.vendor_name || null),
      vendor_trn: input.vendor_trn ?? null,
    });
    if (v) {
      header.vendor_id = v.vendorId;
      header.vendor_name = v.vendorName;
      header.vendor_trn = v.vendorTrn;
    }
  }
  const billDate =
    (get("bill_date", existing ? isoDateOf(existing.bill_date) : undefined) as string) ?? null;
  if (!billDate) throw new DomainError("BILL_DATE_REQUIRED", 400);
  if (input.bill_date !== undefined) header.bill_date = input.bill_date;
  for (const k of [
    "bill_number",
    "due_date",
    "category",
    "notes",
    "attachment_url",
    "place_of_supply",
    "customs_declaration_no",
  ] as const) {
    if (input[k] !== undefined) header[k] = input[k] ?? null;
  }
  if (input.designated_zone !== undefined) header.designated_zone = input.designated_zone;
  if (input.recoverable_vat_percent !== undefined)
    header.recoverable_vat_percent = input.recoverable_vat_percent;

  const companyBase = await loadBaseCurrency(companyId);
  const currency = documentCurrency(
    String(get("currency", existing?.currency ?? companyBase)),
    companyBase
  );
  const reverseCharge = get("reverse_charge", existing?.reverse_charge ?? false) === true;
  const isImport = get("is_import", existing?.is_import ?? false) === true;
  if (
    input.currency !== undefined ||
    input.exchange_rate !== undefined ||
    input.bill_date !== undefined ||
    !existing
  ) {
    const given =
      input.exchange_rate ??
      (input.currency === undefined && existing && isForeign(existing, companyBase)
        ? String(existing.exchange_rate)
        : null);
    header.currency = currency;
    header.exchange_rate = await resolveDocRate(companyId, currency, billDate, given);
  }
  header.reverse_charge = reverseCharge || isImport;
  header.is_import = isImport;

  let lines: Array<Record<string, unknown>> | null = null;
  const recomputeNeeded =
    !!input.line_items ||
    input.reverse_charge !== undefined ||
    input.is_import !== undefined ||
    input.import_vat_amount !== undefined ||
    input.withholding_amount !== undefined;
  if (recomputeNeeded) {
    interface SrcLine {
      description: string;
      quantity: number;
      unitPriceFils: number;
      vatRate: number | null;
      supplyType: string | null;
      accountId: string | null;
      productId: string | null;
      poLineId: string | null;
      costCenterId: string | null;
    }
    let src: SrcLine[] | undefined = input.line_items?.map((l) => ({
      description: l.description,
      quantity: l.quantity ?? 1,
      unitPriceFils: l.unit_price,
      vatRate: l.vat_rate ?? null,
      supplyType: l.vat_supply_type ?? null,
      accountId: l.account_id ?? null,
      productId: l.product_id ?? null,
      poLineId: null as string | null,
      costCenterId: l.cost_center_id ?? null,
    }));
    if (!src && existing) {
      const r = await pool.query(
        `SELECT * FROM bill_line_items WHERE bill_id = $1 ORDER BY created_at`,
        [existing.id]
      );
      src = (r.rows as Array<Record<string, string | null>>).map((l) => ({
        description: String(l.description ?? ""),
        quantity: Number(l.quantity) || 1,
        unitPriceFils: filsOf(l.unit_price),
        vatRate: Number(l.vat_rate) === 0 ? 0 : 5,
        supplyType:
          l.vat_supply_type === "reverse_charge" && !reverseCharge && !isImport
            ? "standard_rated"
            : (l.vat_supply_type ?? null),
        accountId: l.account_id ?? null,
        productId: l.product_id ?? null,
        poLineId: l.purchase_order_line_id ?? null,
        costCenterId: l.cost_center_id ?? null,
      }));
    }
    if (src)
      await assertCostCenters(
        companyId,
        src.map((l) => l.costCenterId)
      );
    const totals = computeBillTotals({
      lines: src ?? [],
      reverseCharge,
      isImport,
      importVatFils:
        (get(
          "import_vat_amount",
          existing
            ? filsOf((existing as unknown as { import_vat_amount?: string }).import_vat_amount)
            : 0
        ) as number) ?? 0,
      withholdingFils:
        (get("withholding_amount", existing ? filsOf(existing.withholding_amount) : 0) as number) ??
        0,
    });
    header.subtotal = fromFils(totals.subtotalFils);
    header.vat_amount = fromFils(totals.vatFils);
    header.total_amount = fromFils(totals.totalFils);
    header.withholding_amount = fromFils(totals.withholdingFils);
    header.import_vat_amount = fromFils(
      isImport ? ((get("import_vat_amount", 0) as number | null) ?? 0) : 0
    );
    if (src) {
      lines = src.map((l, i) => ({
        description: l.description,
        quantity: String(totals.lines[i].quantity),
        unit_price: fromFils(l.unitPriceFils),
        vat_rate: totals.lines[i].vatRate,
        amount: fromFils(totals.lines[i].amountFils),
        vat_amount: fromFils(totals.lines[i].vatFils),
        vat_supply_type: totals.lines[i].supplyType,
        account_id: l.accountId,
        product_id: l.productId,
        purchase_order_line_id: l.poLineId,
        cost_center_id: l.costCenterId,
        reverse_charge: totals.lines[i].reverseCharge,
      }));
    }
  }
  const trn = (header.vendor_trn ?? existing?.["vendor_trn" as keyof BillRow]) as
    | string
    | null
    | undefined;
  if (!trn && !(header.reverse_charge as boolean)) {
    warnings.push({
      code: "VENDOR_TRN_MISSING",
      message:
        "No vendor TRN recorded. This bill is treated as an ordinary domestic purchase (input VAT " +
        "recoverable in Box 9). If this supply is subject to the reverse charge (imports, designated " +
        "zones), set reverse_charge explicitly.",
    });
  }
  return { header, lines, warnings };
}

async function writeLines(tx: LedgerTx, billId: string, lines: Array<Record<string, unknown>>) {
  await txRows(tx, `DELETE FROM bill_line_items WHERE bill_id = $1`, [billId]);
  for (const l of lines) {
    await txRows(
      tx,
      `INSERT INTO bill_line_items (bill_id, description, quantity, unit_price, vat_rate, amount, vat_amount,
          account_id, reverse_charge, vat_supply_type, product_id, purchase_order_line_id, cost_center_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        billId,
        l.description,
        l.quantity,
        l.unit_price,
        l.vat_rate,
        l.amount,
        l.vat_amount,
        l.account_id ?? null,
        l.reverse_charge === true,
        l.vat_supply_type,
        l.product_id ?? null,
        l.purchase_order_line_id ?? null,
        l.cost_center_id ?? null,
      ]
    );
  }
}

/** R10-11: every bill line cost centre must exist in the company (404 otherwise). */
async function assertCostCenters(companyId: string, ids: Array<string | null>): Promise<void> {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (wanted.length === 0) return;
  const { rows } = await pool.query(
    `SELECT id FROM cost_centers WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, wanted]
  );
  const found = new Set(rows.map((r: { id: string }) => r.id));
  const missing = wanted.filter((id) => !found.has(id));
  if (missing.length) {
    throw new DomainError(
      "COST_CENTER_NOT_FOUND",
      404,
      { costCenterId: missing[0] },
      "Cost centre not found"
    );
  }
}

const HEADER_COLUMNS = new Set([
  "vendor_id",
  "vendor_name",
  "vendor_trn",
  "bill_number",
  "bill_date",
  "due_date",
  "currency",
  "exchange_rate",
  "subtotal",
  "vat_amount",
  "total_amount",
  "category",
  "notes",
  "attachment_url",
  "reverse_charge",
  "place_of_supply",
  "is_import",
  "customs_declaration_no",
  "import_vat_amount",
  "designated_zone",
  "recoverable_vat_percent",
  "withholding_amount",
]);

async function updateHeader(
  tx: LedgerTx,
  billId: string,
  header: Record<string, unknown>,
  extra = ""
) {
  const keys = Object.keys(header).filter((k) => HEADER_COLUMNS.has(k));
  if (keys.length === 0 && !extra) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  if (extra) sets.push(extra);
  await txRows(tx, `UPDATE vendor_bills SET ${sets.join(", ")} WHERE id = $1`, [
    billId,
    ...keys.map((k) => header[k]),
  ]);
}

export async function createBill(args: {
  companyId: string;
  actorId: string;
  input: BillCreateInput;
  status?: "draft" | "pending";
  origin?: string;
  originRef?: string | null;
  purchaseOrderId?: string | null;
  poLineIds?: Array<string | null>;
  tx?: LedgerTx;
}): Promise<BillWriteResult> {
  const { companyId, actorId, input } = args;
  await assertPeriodNotLocked(companyId, input.bill_date);
  const prepared = await prepareBill(companyId, input as BillFieldsInput, null);
  if (args.poLineIds && prepared.lines) {
    prepared.lines.forEach((l, i) => (l.purchase_order_line_id = args.poLineIds![i] ?? null));
  }
  const status = args.status ?? (input.save_as_draft ? "draft" : "pending");
  if (!prepared.header.due_date && prepared.header.vendor_id) {
    const v = await pool.query(`SELECT payment_terms_days FROM vendors WHERE id = $1`, [
      prepared.header.vendor_id,
    ]);
    const days = Number(v.rows[0]?.payment_terms_days ?? 0);
    if (days > 0) {
      const d = new Date(`${input.bill_date}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + days);
      prepared.header.due_date = d.toISOString().slice(0, 10);
    }
  }
  return withLedgerTx(async (tx) => {
    const h = prepared.header;
    const rows = await txRows<BillRow & Record<string, unknown>>(
      tx,
      `INSERT INTO vendor_bills (company_id, vendor_id, vendor_name, vendor_trn, bill_number, bill_date, due_date,
          currency, exchange_rate, subtotal, vat_amount, total_amount, amount_paid, status, category, notes,
          attachment_url, reverse_charge, place_of_supply, is_import, customs_declaration_no, import_vat_amount,
          designated_zone, recoverable_vat_percent, withholding_amount, created_by, origin, origin_ref,
          purchase_order_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'0.00',$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       RETURNING *`,
      [
        companyId,
        h.vendor_id ?? null,
        h.vendor_name ?? input.vendor_name,
        h.vendor_trn ?? input.vendor_trn ?? null,
        input.bill_number ?? null,
        input.bill_date,
        h.due_date ?? null,
        h.currency,
        h.exchange_rate,
        h.subtotal,
        h.vat_amount,
        h.total_amount,
        status,
        input.category ?? null,
        input.notes ?? null,
        input.attachment_url ?? null,
        h.reverse_charge === true,
        input.place_of_supply ?? null,
        h.is_import === true,
        input.customs_declaration_no ?? null,
        h.import_vat_amount ?? "0.00",
        input.designated_zone === true,
        input.recoverable_vat_percent ?? 100,
        h.withholding_amount ?? "0.00",
        actorId,
        args.origin ?? "manual",
        args.originRef ?? null,
        args.purchaseOrderId ?? null,
      ]
    );
    const bill = rows[0];
    await writeLines(tx, bill.id, prepared.lines ?? []);
    const lines = await txRows(
      tx,
      `SELECT * FROM bill_line_items WHERE bill_id = $1 ORDER BY created_at`,
      [bill.id]
    );
    return { bill, lines, warnings: prepared.warnings };
  }, args.tx);
}

/** Edit a bill that has no journal yet (draft / pending / rejected). */
export async function updateBillInPlace(args: {
  companyId: string;
  billId: string;
  input: BillUpdateInput;
}): Promise<BillWriteResult> {
  const existingRes = await pool.query(
    `SELECT * FROM vendor_bills WHERE id = $1 AND company_id = $2`,
    [args.billId, args.companyId]
  );
  const existing = existingRes.rows[0] as BillRow | undefined;
  if (!existing) throw new DomainError("BILL_NOT_FOUND", 404, undefined, "Bill not found");
  if (!["draft", "pending", "rejected"].includes(String(existing.status))) {
    throw new DomainError(
      "BILL_LOCKED",
      409,
      { status: existing.status },
      "An approved bill cannot be edited in place; use revise (reversal + repost) or void it"
    );
  }
  await assertPeriodNotLocked(args.companyId, existing.bill_date);
  if (args.input.bill_date) await assertPeriodNotLocked(args.companyId, args.input.bill_date);
  const prepared = await prepareBill(args.companyId, args.input as BillFieldsInput, existing);
  return withLedgerTx(async (tx) => {
    const locked = await lockBill(tx, args.billId, args.companyId);
    if (locked.status !== existing.status) throw new DomainError("BILL_STATE_CHANGED", 409);
    await updateHeader(tx, args.billId, prepared.header);
    if (prepared.lines) await writeLines(tx, args.billId, prepared.lines);
    const bill = (
      await txRows<BillRow & Record<string, unknown>>(
        tx,
        `SELECT * FROM vendor_bills WHERE id = $1`,
        [args.billId]
      )
    )[0];
    const lines = await txRows(
      tx,
      `SELECT * FROM bill_line_items WHERE bill_id = $1 ORDER BY created_at`,
      [args.billId]
    );
    return { bill, lines, warnings: prepared.warnings };
  });
}

/** Prepare a revision (no writes): totals and lines for the revised approved bill. */
export async function prepareBillRevision(
  companyId: string,
  existing: BillRow,
  input: BillUpdateInput
) {
  if (input.bill_date) await assertPeriodNotLocked(companyId, input.bill_date);
  return prepareBill(companyId, input as BillFieldsInput, existing);
}

/** Apply a prepared revision inside `tx` (header + lines + revision bump). */
export async function applyBillRevision(tx: LedgerTx, billId: string, prepared: PreparedBill) {
  await updateHeader(tx, billId, prepared.header, "revision = revision + 1");
  if (prepared.lines) await writeLines(tx, billId, prepared.lines);
  return (
    await txRows<BillRow & Record<string, unknown>>(
      tx,
      `SELECT * FROM vendor_bills WHERE id = $1`,
      [billId]
    )
  )[0];
}

// ─── Payments ───────────────────────────────────────────────────────────────

export interface RecordBillPaymentArgs {
  billId: string;
  companyId?: string;
  /** Bill-currency amount in integer fils (> 0). */
  amountFils: number;
  /** YYYY-MM-DD */
  date: string;
  paymentAccountId?: string | null;
  /** Payment-date rate (bill currency → AED); default fx.getRate at `date`. */
  exchangeRate?: string | null;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
  actorId: string;
  req?: Request;
}

export interface RecordBillPaymentResult {
  payment: Record<string, unknown>;
  billStatus: BillState;
  amountPaid: number;
  remaining: number;
  journalEntryId: string;
  fxDifference: number;
}

async function fxAccounts(companyId: string) {
  return {
    gain: await ensureAccountByCode(companyId, ACCOUNT_CODES.FX_GAIN),
    loss: await ensureAccountByCode(companyId, ACCOUNT_CODES.FX_LOSS),
  };
}

/**
 * Record a payment against an approved / partially paid bill (R04-01, R04-13, R04-14, R14-05).
 * One transaction: lock the bill, exact remaining check, payment row, kernel journal
 * (Dr A/P at the bill rate, Cr bank at the payment-date rate, realised FX difference to 4090 /
 * 5140), status update. Any failure rolls everything back.
 */
export async function recordBillPayment(
  args: RecordBillPaymentArgs
): Promise<RecordBillPaymentResult> {
  const pre = await pool.query(
    `SELECT * FROM vendor_bills WHERE id = $1 AND ($2::uuid IS NULL OR company_id = $2)`,
    [args.billId, args.companyId ?? null]
  );
  const billPre = pre.rows[0] as BillRow | undefined;
  if (!billPre) throw new DomainError("BILL_NOT_FOUND", 404, undefined, "Bill not found");
  const companyId = billPre.company_id;
  if (!PAYABLE_BILL_STATES.includes(String(billPre.status) as BillState)) {
    throw new DomainError(
      "BILL_NOT_PAYABLE",
      409,
      { status: billPre.status },
      "Only approved or partially paid bills can be paid"
    );
  }
  if (!Number.isSafeInteger(args.amountFils) || args.amountFils <= 0) {
    throw new DomainError(
      "INVALID_AMOUNT",
      400,
      undefined,
      "Payment amount must be greater than zero"
    );
  }
  const cash = await resolvePaymentAccount(companyId, args.paymentAccountId, args.method);
  const ap = await requireApAccount(companyId);
  const companyBase = await loadBaseCurrency(companyId);
  const foreign = isForeign(billPre, companyBase);
  const billRate = rateTextOf(billPre, companyBase);
  const payRate = foreign
    ? await resolveDocRate(companyId, billPre.currency, args.date, args.exchangeRate ?? null)
    : "1";
  const fx = foreign ? await fxAccounts(companyId) : null;
  const currency = documentCurrency(billPre.currency, companyBase);

  let paidEvent = false;
  const result = await withLedgerTx(async (tx) => {
    const bill = await lockBill(tx, args.billId, companyId);
    if (!PAYABLE_BILL_STATES.includes(String(bill.status) as BillState)) {
      throw new DomainError("BILL_NOT_PAYABLE", 409, { status: bill.status });
    }
    const total = filsOf(bill.total_amount);
    const paid = await paidFils(tx, bill.id);
    const remaining = total - paid;
    if (args.amountFils > remaining) {
      throw new DomainError(
        "OVERPAYMENT",
        400,
        { amount: fromFils(args.amountFils), remaining: fromFils(remaining) },
        `Payment amount (${fromFils(args.amountFils)}) exceeds remaining balance (${fromFils(remaining)})`
      );
    }
    let apBase: number;
    if (args.amountFils === remaining) {
      const apCredit = await currentBillApCreditFils(tx, companyId, bill.id);
      apBase = apCredit - (await settledApBaseFils(tx, bill));
    } else {
      apBase = toBase(args.amountFils, billRate, foreign);
    }
    const cashBase = toBase(args.amountFils, payRate, foreign);
    const fxDiff = cashBase - apBase; // > 0 loss, < 0 gain
    const inserted = await txRows<Record<string, unknown> & { id: string }>(
      tx,
      `INSERT INTO bill_payments (bill_id, payment_date, amount, payment_method, reference, notes, kind, status,
          payment_account_id, exchange_rate, ap_amount_base, cash_amount_base, fx_difference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'payment','active',$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        bill.id,
        args.date,
        fromFils(args.amountFils),
        args.method || "bank_transfer",
        args.reference ?? null,
        args.notes ?? null,
        cash.id,
        payRate,
        fromFils(apBase),
        fromFils(cashBase),
        fromFils(fxDiff),
        args.actorId,
      ]
    );
    const payment = inserted[0];
    const billRef = bill.bill_number || bill.id.slice(0, 8);
    const lines = [
      {
        accountId: ap.id,
        debitFils: apBase,
        description: `Settle A/P - Bill ${billRef} - ${bill.vendor_name}`.slice(0, 255),
        ...(foreign
          ? {
              foreignCurrency: currency,
              foreignDebit: fromFils(args.amountFils),
              exchangeRate: billRate,
            }
          : {}),
      },
      {
        accountId: cash.id,
        creditFils: cashBase,
        description: `Payment to ${bill.vendor_name} - Bill ${billRef}`.slice(0, 255),
        ...(foreign
          ? {
              foreignCurrency: currency,
              foreignCredit: fromFils(args.amountFils),
              exchangeRate: payRate,
            }
          : {}),
      },
    ];
    if (fxDiff > 0 && fx) {
      lines.push({
        accountId: fx.loss.id,
        debitFils: fxDiff,
        description: `Realised FX loss - Bill ${billRef}`,
      });
    } else if (fxDiff < 0 && fx) {
      lines.push({
        accountId: fx.gain.id,
        creditFils: -fxDiff,
        description: `Realised FX gain - Bill ${billRef}`,
      });
    }
    const { entry } = await postJournal(
      {
        companyId,
        date: args.date,
        memo: `Payment - Bill ${billRef} - ${bill.vendor_name}`.slice(0, 500),
        status: "posted",
        source: BILL_PAYMENT_JE_SOURCE,
        sourceId: String(payment.id),
        idempotencyKey: `bill_payment:${payment.id}`,
        reference: args.reference ?? null,
        allowFutureDate: true,
        lines,
      },
      { actorId: args.actorId, tx }
    );
    const settled = await settleStatus(tx, bill);
    paidEvent = settled.status === "paid";
    // F8: durable event, written in this transaction (rolls back with the payment).
    if (paidEvent) {
      await emitDomainEventInTx(tx, "bill.paid", {
        companyId,
        entityId: bill.id,
        actorUserId: args.actorId,
        amountFils: args.amountFils,
      });
    }
    return {
      payment,
      billStatus: settled.status,
      amountPaid: Number(fromFils(settled.paidFils)),
      remaining: Number(fromFils(total - settled.paidFils)),
      journalEntryId: entry.id,
      fxDifference: Number(fromFils(fxDiff)),
    };
  });
  await recordAudit({
    userId: args.actorId,
    companyId,
    action: "bill.payment",
    entityType: "vendor_bill",
    entityId: args.billId,
    after: {
      paymentId: result.payment.id,
      amount: fromFils(args.amountFils),
      status: result.billStatus,
      journalEntryId: result.journalEntryId,
      fxDifference: result.fxDifference,
    },
    req: args.req,
  });
  log.info({ billId: args.billId, paymentId: result.payment.id }, "Bill payment recorded");
  return result;
}

/**
 * Void a payment / prepayment application / credit application: reverse its journal through the
 * kernel, keep the original row (status voided) and add an equal negative "reversal" row so every
 * SUM(amount) reader nets it out; restore the bill status.
 */
export async function voidBillPayment(args: {
  billId: string;
  paymentId: string;
  companyId: string;
  actorId: string;
  reason?: string | null;
  req?: Request;
  /** Run inside the caller's ledger transaction (bank unmatch / compensation). */
  tx?: LedgerTx;
}): Promise<{ billStatus: BillState; amountPaid: number }> {
  // F2: the audit row is written inside the transaction (savepoint), so a caller's
  // rollback (bank unmatch / compensation, in any transaction) leaves no audit of a void
  // that never happened.
  return withLedgerTx(async (tx) => {
    const bill = await lockBill(tx, args.billId, args.companyId);
    const rows = await txRows<Record<string, string | null>>(
      tx,
      `SELECT * FROM bill_payments WHERE id = $1 AND bill_id = $2 FOR UPDATE`,
      [args.paymentId, bill.id]
    );
    const p = rows[0];
    if (!p) throw new DomainError("PAYMENT_NOT_FOUND", 404);
    if (p.kind === "reversal") throw new DomainError("PAYMENT_IS_REVERSAL", 409);
    if (p.status !== "active") throw new DomainError("PAYMENT_ALREADY_VOIDED", 409);
    await reverseBySource(
      args.companyId,
      p.kind === "vendor_credit" ? "bill_credit_fx" : BILL_PAYMENT_JE_SOURCE,
      args.paymentId,
      {
        reason: args.reason ?? "Payment voided",
        source: "bill_payment_void",
        sourceId: args.paymentId,
      },
      { actorId: args.actorId, tx }
    );
    await txRows(
      tx,
      `INSERT INTO bill_payments (bill_id, payment_date, amount, payment_method, reference, notes, kind, status,
          payment_account_id, exchange_rate, ap_amount_base, cash_amount_base, fx_difference, reverses_payment_id,
          source_document_id, created_by)
       VALUES ($1, now(), $2, $3, $4, $5, 'reversal', 'active', $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        bill.id,
        fromFils(-filsOf(p.amount)),
        p.payment_method,
        p.reference,
        args.reason ?? "Payment voided",
        p.payment_account_id,
        p.exchange_rate,
        p.ap_amount_base === null ? null : fromFils(-filsOf(p.ap_amount_base)),
        p.cash_amount_base === null ? null : fromFils(-filsOf(p.cash_amount_base)),
        fromFils(-filsOf(p.fx_difference)),
        args.paymentId,
        p.source_document_id,
        args.actorId,
      ]
    );
    await txRows(
      tx,
      `UPDATE bill_payments SET status = 'voided', voided_at = now(), voided_by = $2 WHERE id = $1`,
      [args.paymentId, args.actorId]
    );
    if (p.kind === "prepayment" && p.source_document_id) {
      await txRows(
        tx,
        `UPDATE vendor_prepayments SET amount_applied = amount_applied - $2, status = 'open' WHERE id = $1`,
        [p.source_document_id, p.amount]
      );
    }
    if (p.kind === "vendor_credit" && p.source_document_id) {
      await txRows(
        tx,
        `UPDATE vendor_debit_notes SET amount_applied = amount_applied - $2, status = 'open' WHERE id = $1`,
        [p.source_document_id, p.amount]
      );
    }
    const settled = await settleStatus(tx, bill);
    const result = { billStatus: settled.status, amountPaid: Number(fromFils(settled.paidFils)) };
    await recordAudit({
      userId: args.actorId,
      companyId: args.companyId,
      action: "bill.payment.void",
      entityType: "vendor_bill",
      entityId: args.billId,
      after: { paymentId: args.paymentId, ...result, reason: args.reason ?? null },
      req: args.req,
      tx,
    });
    return result;
  }, args.tx);
}

// ─── Vendor prepayments / advances ─────────────────────────────────────────

export async function createPrepayment(args: {
  companyId: string;
  actorId: string;
  input: PrepaymentCreateInput;
  req?: Request;
}) {
  const { companyId, input } = args;
  const vendor = await resolveVendor(companyId, {
    vendor_id: input.vendor_id ?? null,
    vendor_name: input.vendor_name ?? null,
  });
  if (!vendor?.vendorName)
    throw new DomainError("VENDOR_REQUIRED", 400, undefined, "Vendor is required");
  const companyBase = await loadBaseCurrency(companyId);
  const currency = documentCurrency(input.currency, companyBase);
  const foreign = isForeignCurrency(currency, companyBase);
  const rate = await resolveDocRate(
    companyId,
    currency,
    input.payment_date,
    input.exchange_rate ?? null
  );
  const cash = await resolvePaymentAccount(companyId, input.payment_account_id);
  const advances = await ensureAccountByCode(companyId, VENDOR_ADVANCES_CODE);
  const baseFils = toBase(input.amount, rate, foreign);
  return withLedgerTx(async (tx) => {
    const rows = await txRows<Record<string, unknown> & { id: string }>(
      tx,
      `INSERT INTO vendor_prepayments (company_id, vendor_id, vendor_name, payment_date, currency, exchange_rate,
          amount, payment_account_id, reference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        companyId,
        vendor.vendorId,
        vendor.vendorName,
        input.payment_date,
        currency,
        rate,
        fromFils(input.amount),
        cash.id,
        input.reference ?? null,
        args.actorId,
      ]
    );
    const pre = rows[0];
    const fxPart = foreign ? { foreignCurrency: currency, exchangeRate: rate } : {};
    const { entry } = await postJournal(
      {
        companyId,
        date: input.payment_date,
        memo: `Advance to ${vendor.vendorName}`.slice(0, 500),
        status: "posted",
        source: "vendor_prepayment",
        sourceId: pre.id,
        idempotencyKey: `vendor_prepayment:${pre.id}`,
        reference: input.reference ?? null,
        allowFutureDate: true,
        lines: [
          {
            accountId: advances.id,
            debitFils: baseFils,
            description: `Advance - ${vendor.vendorName}`,
            ...(foreign ? { ...fxPart, foreignDebit: fromFils(input.amount) } : {}),
          },
          {
            accountId: cash.id,
            creditFils: baseFils,
            description: `Advance paid - ${vendor.vendorName}`,
            ...(foreign ? { ...fxPart, foreignCredit: fromFils(input.amount) } : {}),
          },
        ],
      },
      { actorId: args.actorId, tx }
    );
    return { prepayment: pre, journalEntryId: entry.id };
  });
}

/** Apply an open vendor prepayment to an approved bill (Dr A/P / Cr Advances to Suppliers). */
export async function applyPrepayment(args: {
  companyId: string;
  prepaymentId: string;
  actorId: string;
  input: ApplyCreditInput;
}) {
  const { companyId, input } = args;
  const ap = await requireApAccount(companyId);
  const advances = await ensureAccountByCode(companyId, VENDOR_ADVANCES_CODE);
  const fx = await fxAccounts(companyId);
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  return withLedgerTx(async (tx) => {
    const preRows = await txRows<Record<string, string>>(
      tx,
      `SELECT * FROM vendor_prepayments WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [args.prepaymentId, companyId]
    );
    const pre = preRows[0];
    if (!pre) throw new DomainError("PREPAYMENT_NOT_FOUND", 404);
    const bill = await lockBill(tx, input.bill_id, companyId);
    if (!PAYABLE_BILL_STATES.includes(String(bill.status) as BillState)) {
      throw new DomainError("BILL_NOT_PAYABLE", 409, { status: bill.status });
    }
    const companyBase = await loadBaseCurrency(companyId, tx);
    if (documentCurrency(bill.currency, companyBase) !== pre.currency) {
      throw new DomainError(
        "CURRENCY_MISMATCH",
        409,
        undefined,
        "Prepayment and bill currencies differ"
      );
    }
    const available = filsOf(pre.amount) - filsOf(pre.amount_applied);
    const remaining = filsOf(bill.total_amount) - (await paidFils(tx, bill.id));
    if (input.amount > available)
      throw new DomainError("PREPAYMENT_INSUFFICIENT", 400, { available: fromFils(available) });
    if (input.amount > remaining)
      throw new DomainError("OVERPAYMENT", 400, { remaining: fromFils(remaining) });
    const foreign = isForeign(bill, companyBase);
    const apBase =
      input.amount === remaining
        ? (await currentBillApCreditFils(tx, companyId, bill.id)) -
          (await settledApBaseFils(tx, bill))
        : toBase(input.amount, rateTextOf(bill, companyBase), foreign);
    const advBase = toBase(input.amount, pre.exchange_rate, foreign);
    const fxDiff = advBase - apBase;
    const ins = await txRows<{ id: string }>(
      tx,
      `INSERT INTO bill_payments (bill_id, payment_date, amount, payment_method, reference, kind, status,
          exchange_rate, ap_amount_base, cash_amount_base, fx_difference, source_document_id, created_by)
       VALUES ($1,$2,$3,'other',$4,'prepayment','active',$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        bill.id,
        date,
        fromFils(input.amount),
        pre.reference,
        pre.exchange_rate,
        fromFils(apBase),
        fromFils(advBase),
        fromFils(fxDiff),
        pre.id,
        args.actorId,
      ]
    );
    const lines = [
      {
        accountId: ap.id,
        debitFils: apBase,
        description: `Prepayment applied - ${bill.vendor_name}`,
      },
      {
        accountId: advances.id,
        creditFils: advBase,
        description: `Prepayment applied - ${bill.vendor_name}`,
      },
    ];
    if (fxDiff > 0)
      lines.push({ accountId: fx.loss.id, debitFils: fxDiff, description: "Realised FX loss" });
    if (fxDiff < 0)
      lines.push({ accountId: fx.gain.id, creditFils: -fxDiff, description: "Realised FX gain" });
    await postJournal(
      {
        companyId,
        date,
        memo: `Prepayment applied to bill ${bill.bill_number ?? bill.id.slice(0, 8)}`,
        status: "posted",
        source: BILL_PAYMENT_JE_SOURCE,
        sourceId: ins[0].id,
        idempotencyKey: `bill_payment:${ins[0].id}`,
        allowFutureDate: true,
        lines,
      },
      { actorId: args.actorId, tx }
    );
    const newApplied = filsOf(pre.amount_applied) + input.amount;
    await txRows(
      tx,
      `UPDATE vendor_prepayments SET amount_applied = $2, status = $3 WHERE id = $1`,
      [pre.id, fromFils(newApplied), newApplied >= filsOf(pre.amount) ? "applied" : "open"]
    );
    const settled = await settleStatus(tx, bill);
    return {
      applicationId: ins[0].id,
      billStatus: settled.status,
      amountPaid: Number(fromFils(settled.paidFils)),
    };
  });
}

// ─── Debit notes / vendor credits ───────────────────────────────────────────

/**
 * Issue a debit note (vendor credit): Dr A/P total, Cr expense lines, Cr Input VAT (R04-18).
 * It reduces A/P immediately; applying it to a bill settles that bill's open balance.
 */
export async function createDebitNote(args: {
  companyId: string;
  actorId: string;
  input: DebitNoteCreateInput;
  req?: Request;
  /** Run inside the caller's ledger transaction (inbound credit note conversion). */
  tx?: LedgerTx;
}) {
  const { companyId, input } = args;
  let vendorName = input.vendor_name ?? null;
  let vendorId = input.vendor_id ?? null;
  if (input.bill_id) {
    const b = await pool.query(
      `SELECT vendor_id, vendor_name, currency FROM vendor_bills WHERE id = $1 AND company_id = $2`,
      [input.bill_id, companyId]
    );
    if (!b.rows[0]) throw new DomainError("BILL_NOT_FOUND", 404);
    vendorName = vendorName ?? b.rows[0].vendor_name;
    vendorId = vendorId ?? b.rows[0].vendor_id;
  }
  const vendor = await resolveVendor(companyId, { vendor_id: vendorId, vendor_name: vendorName });
  if (!vendor?.vendorName)
    throw new DomainError("VENDOR_REQUIRED", 400, undefined, "Vendor is required");
  const companyBase = await loadBaseCurrency(companyId);
  const currency = documentCurrency(input.currency, companyBase);
  const foreign = isForeignCurrency(currency, companyBase);
  const rate = await resolveDocRate(
    companyId,
    currency,
    input.note_date,
    input.exchange_rate ?? null
  );
  const ap = await requireApAccount(companyId);
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const inputVat = accounts.find((a) => a.isVatAccount && a.vatType === "input" && usable(a));
  const general = await ensureAccountByCode(companyId, ACCOUNT_CODES.GENERAL_EXPENSE);
  const lineCalcs = input.lines.map((l) => {
    const vat = l.vat_rate === 0 ? 0 : mulRate(l.amount, "0.05");
    if (l.account_id && !usable(accounts.find((a) => a.id === l.account_id))) {
      throw new DomainError("ACCOUNT_NOT_FOUND", 404, { accountId: l.account_id });
    }
    return { ...l, vatFils: vat, accountId: l.account_id ?? general.id };
  });
  const subtotal = sumFils(lineCalcs.map((l) => l.amount));
  const vatFils = sumFils(lineCalcs.map((l) => l.vatFils));
  const total = subtotal + vatFils;
  if (vatFils > 0 && !inputVat) throw new DomainError("VAT_ACCOUNTS_MISSING", 422);
  return withLedgerTx(async (tx) => {
    const number =
      input.debit_note_number ??
      `DN-${String(await nextDocNumber(tx, companyId, "debit_note")).padStart(4, "0")}`;
    const rows = await txRows<Record<string, unknown> & { id: string }>(
      tx,
      `INSERT INTO vendor_debit_notes (company_id, vendor_id, vendor_name, debit_note_number, bill_id, note_date,
          currency, exchange_rate, subtotal, vat_amount, total_amount, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        companyId,
        vendor.vendorId,
        vendor.vendorName,
        number,
        input.bill_id ?? null,
        input.note_date,
        currency,
        rate,
        fromFils(subtotal),
        fromFils(vatFils),
        fromFils(total),
        input.reason,
        args.actorId,
      ]
    );
    const note = rows[0];
    const credits = lineCalcs.map((l) => ({
      accountId: l.accountId,
      creditFils: toBase(l.amount, rate, foreign),
      description: `Debit note ${number} - ${l.description}`.slice(0, 255),
    }));
    const vatBase = toBase(vatFils, rate, foreign);
    if (vatBase > 0 && inputVat) {
      credits.push({
        accountId: inputVat.id,
        creditFils: vatBase,
        description: `Input VAT reversal - ${number}`,
      });
    }
    const apDebit = sumFils(credits.map((c) => c.creditFils));
    const { entry } = await postJournal(
      {
        companyId,
        date: input.note_date,
        memo: `Debit note ${number} - ${vendor.vendorName}`.slice(0, 500),
        status: "posted",
        source: "vendor_debit_note",
        sourceId: note.id,
        idempotencyKey: `vendor_debit_note:${note.id}`,
        reference: number,
        allowFutureDate: true,
        lines: [
          {
            accountId: ap.id,
            debitFils: apDebit,
            description: `A/P - debit note ${number}`,
            ...(foreign
              ? { foreignCurrency: currency, foreignDebit: fromFils(total), exchangeRate: rate }
              : {}),
          },
          ...credits,
        ],
      },
      { actorId: args.actorId, tx }
    );
    return { debitNote: note, journalEntryId: entry.id };
  }, args.tx);
}

/**
 * "bills.createVendorCreditFromInbound" (W4-C residual): a reviewed supplier credit note received
 * as an e-invoice becomes a vendor debit note (Dr A/P / Cr expense / Cr Input VAT). The inbound
 * row is claimed (received -> credit_created) in the same transaction as the debit note, so a
 * second review cannot book it twice. Amounts come from the archived, PINT AE-validated XML.
 */
export async function createVendorCreditFromInbound(args: {
  companyId: string;
  actorId: string;
  inboundId: string;
  input: InboundVendorCreditInput;
  req?: Request;
}) {
  const { companyId, inboundId } = args;
  const row = (
    await pool.query(
      `SELECT id, status, archive_id, debit_note_id, document_type, document_number
         FROM einvoice_inbound_documents WHERE id = $1 AND company_id = $2`,
      [inboundId, companyId]
    )
  ).rows[0] as
    | {
        id: string;
        status: string;
        archive_id: string | null;
        debit_note_id: string | null;
        document_number: string;
      }
    | undefined;
  if (!row) throw new DomainError("INBOUND_DOCUMENT_NOT_FOUND", 404);
  if (row.debit_note_id || row.status === "credit_created") {
    throw new DomainError(
      "INBOUND_ALREADY_CONVERTED",
      409,
      { debitNoteId: row.debit_note_id },
      "This supplier credit note has already been recorded as a vendor credit"
    );
  }
  if (row.status !== "received" || !row.archive_id) {
    throw new DomainError(
      "INBOUND_NOT_REVIEWABLE",
      409,
      { status: row.status },
      "Only a received, validated supplier document can be converted"
    );
  }
  const archived = (
    await pool.query(`SELECT xml FROM einvoice_archive WHERE id = $1 AND company_id = $2`, [
      row.archive_id,
      companyId,
    ])
  ).rows[0] as { xml: string } | undefined;
  if (!archived) throw new DomainError("INBOUND_ARCHIVE_MISSING", 409);
  const { parseInboundUbl } = await import("./einvoice/inbound");
  const parsed = parseInboundUbl(archived.xml);
  if (parsed.root !== "CreditNote") {
    throw new DomainError(
      "INBOUND_NOT_CREDIT_NOTE",
      409,
      undefined,
      "Only a supplier credit note becomes a vendor credit; invoices become draft bills"
    );
  }
  const lines = parsed.lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => Math.abs(l.netFils) > 0)
    .map(({ l, i }) => ({
      description: l.description.slice(0, 500),
      // A UBL credit note carries positive amounts; the sign is the document type. The schema
      // takes major units (zMoneyFils converts to fils).
      amount: fromFils(Math.abs(l.netFils)),
      vat_rate: l.category === "S" ? 5 : 0,
      account_id: args.input.account_ids?.[i] ?? args.input.account_id ?? null,
    }));
  if (lines.length === 0) throw new DomainError("INBOUND_NO_CREDIT_LINES", 422);
  const input = parseStrict(debitNoteCreateSchema, {
    vendor_name: parsed.supplierName.slice(0, 255),
    debit_note_number: parsed.documentNumber.slice(0, 64),
    bill_id: args.input.bill_id ?? null,
    note_date: parsed.issueDate,
    currency: parsed.currency,
    exchange_rate: parsed.exchangeRate ?? null,
    reason: args.input.reason ?? `Supplier credit note ${parsed.documentNumber}`.slice(0, 500),
    lines,
  });
  await assertPeriodNotLocked(companyId, input.note_date);
  const out = await withLedgerTx(async (tx) => {
    const claimed = await txRows<{ id: string }>(
      tx,
      `UPDATE einvoice_inbound_documents SET status = 'credit_created', error = NULL
        WHERE id = $1 AND company_id = $2 AND status = 'received' AND debit_note_id IS NULL
        RETURNING id`,
      [inboundId, companyId]
    );
    if (!claimed.length) throw new DomainError("INBOUND_ALREADY_CONVERTED", 409);
    const created = await createDebitNote({
      companyId,
      actorId: args.actorId,
      input,
      req: args.req,
      tx,
    });
    await txRows(tx, `UPDATE einvoice_inbound_documents SET debit_note_id = $2 WHERE id = $1`, [
      inboundId,
      created.debitNote.id,
    ]);
    await recordAudit({
      userId: args.actorId,
      companyId,
      action: "bill.inbound.vendor_credit",
      entityType: "vendor_debit_note",
      entityId: created.debitNote.id,
      after: {
        inboundId,
        documentNumber: parsed.documentNumber,
        total: created.debitNote.total_amount,
      },
      req: args.req,
      tx,
    });
    return created;
  });
  return { ...out, inboundId };
}

/** Apply an open debit note to an approved bill (no cash; FX difference posted when rates differ). */
export async function applyDebitNote(args: {
  companyId: string;
  debitNoteId: string;
  actorId: string;
  input: ApplyCreditInput;
}) {
  const { companyId, input } = args;
  const ap = await requireApAccount(companyId);
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  return withLedgerTx(async (tx) => {
    const noteRows = await txRows<Record<string, string>>(
      tx,
      `SELECT * FROM vendor_debit_notes WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [args.debitNoteId, companyId]
    );
    const note = noteRows[0];
    if (!note) throw new DomainError("DEBIT_NOTE_NOT_FOUND", 404);
    if (note.status === "void") throw new DomainError("DEBIT_NOTE_VOID", 409);
    const bill = await lockBill(tx, input.bill_id, companyId);
    if (!PAYABLE_BILL_STATES.includes(String(bill.status) as BillState)) {
      throw new DomainError("BILL_NOT_PAYABLE", 409, { status: bill.status });
    }
    const companyBase = await loadBaseCurrency(companyId, tx);
    if (documentCurrency(bill.currency, companyBase) !== note.currency) {
      throw new DomainError(
        "CURRENCY_MISMATCH",
        409,
        undefined,
        "Debit note and bill currencies differ"
      );
    }
    const available = filsOf(note.total_amount) - filsOf(note.amount_applied);
    const remaining = filsOf(bill.total_amount) - (await paidFils(tx, bill.id));
    if (input.amount > available)
      throw new DomainError("CREDIT_INSUFFICIENT", 400, { available: fromFils(available) });
    if (input.amount > remaining)
      throw new DomainError("OVERPAYMENT", 400, { remaining: fromFils(remaining) });
    const foreign = isForeign(bill, companyBase);
    const apBase =
      input.amount === remaining
        ? (await currentBillApCreditFils(tx, companyId, bill.id)) -
          (await settledApBaseFils(tx, bill))
        : toBase(input.amount, rateTextOf(bill, companyBase), foreign);
    const noteBase = toBase(input.amount, note.exchange_rate, foreign);
    const fxDiff = noteBase - apBase; // A/P was debited noteBase at issue; the bill needs apBase
    const ins = await txRows<{ id: string }>(
      tx,
      `INSERT INTO bill_payments (bill_id, payment_date, amount, payment_method, reference, kind, status,
          exchange_rate, ap_amount_base, cash_amount_base, fx_difference, source_document_id, created_by)
       VALUES ($1,$2,$3,'other',$4,'vendor_credit','active',$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        bill.id,
        date,
        fromFils(input.amount),
        note.debit_note_number,
        note.exchange_rate,
        fromFils(apBase),
        fromFils(noteBase),
        fromFils(fxDiff),
        note.id,
        args.actorId,
      ]
    );
    if (fxDiff !== 0) {
      const fx = await fxAccounts(companyId);
      // noteBase > apBase: A/P was over-debited → Cr A/P, Dr FX loss … and vice versa.
      await postJournal(
        {
          companyId,
          date,
          memo: `FX on debit note ${note.debit_note_number} applied`,
          status: "posted",
          source: "bill_credit_fx",
          sourceId: ins[0].id,
          idempotencyKey: `bill_credit_fx:${ins[0].id}`,
          allowFutureDate: true,
          lines:
            fxDiff > 0
              ? [
                  { accountId: fx.loss.id, debitFils: fxDiff },
                  { accountId: ap.id, creditFils: fxDiff },
                ]
              : [
                  { accountId: ap.id, debitFils: -fxDiff },
                  { accountId: fx.gain.id, creditFils: -fxDiff },
                ],
        },
        { actorId: args.actorId, tx }
      );
    }
    const newApplied = filsOf(note.amount_applied) + input.amount;
    await txRows(
      tx,
      `UPDATE vendor_debit_notes SET amount_applied = $2, status = $3 WHERE id = $1`,
      [note.id, fromFils(newApplied), newApplied >= filsOf(note.total_amount) ? "applied" : "open"]
    );
    const settled = await settleStatus(tx, bill);
    return {
      applicationId: ins[0].id,
      billStatus: settled.status,
      amountPaid: Number(fromFils(settled.paidFils)),
    };
  });
}

// ─── Batch payment export (CSV, export only — nothing is paid) ──────────────

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function batchPaymentCsv(companyId: string, billIds: string[]) {
  const r = await pool.query(
    `SELECT b.id, b.bill_number, b.vendor_name, b.due_date, b.currency, b.total_amount, b.amount_paid, b.status,
            v.iban, v.bank_name, v.trn
       FROM vendor_bills b LEFT JOIN vendors v ON v.id = b.vendor_id
      WHERE b.company_id = $1 AND b.id = ANY($2::uuid[])
      ORDER BY b.due_date NULLS LAST, b.bill_number`,
    [companyId, billIds]
  );
  const header = [
    "bill_id",
    "bill_number",
    "vendor_name",
    "vendor_trn",
    "vendor_iban",
    "vendor_bank",
    "due_date",
    "currency",
    "amount_due",
  ];
  const lines = [header.join(",")];
  const companyBase = await loadBaseCurrency(companyId);
  const skipped: Array<{ billId: string; reason: string }> = [];
  const found = r.rows as Array<Record<string, string | null>>;
  for (const row of found) {
    if (!PAYABLE_BILL_STATES.includes(row.status as BillState)) {
      skipped.push({ billId: String(row.id), reason: `status ${row.status}` });
      continue;
    }
    const due = filsOf(row.total_amount) - filsOf(row.amount_paid);
    if (due <= 0) continue;
    lines.push(
      [
        row.id,
        row.bill_number,
        row.vendor_name,
        row.trn,
        row.iban,
        row.bank_name,
        row.due_date ? new Date(row.due_date).toISOString().slice(0, 10) : "",
        documentCurrency(row.currency, companyBase),
        fromFils(due),
      ]
        .map(csvCell)
        .join(",")
    );
  }
  const missing = billIds.filter((id) => !found.some((row) => row.id === id));
  for (const id of missing) skipped.push({ billId: id, reason: "not found" });
  return { csv: lines.join("\n") + "\n", rows: lines.length - 1, skipped };
}

// ─── Inbound drafts / recurring bills ───────────────────────────────────────

/**
 * Create a DRAFT bill from a structured inbound document (e-invoice, OCR, email intake). The
 * draft has no journal; it goes through the normal submit → approve flow.
 */
export async function createDraftFromParsedInbound(
  companyId: string,
  actorId: string,
  doc: InboundBillInput
): Promise<BillWriteResult> {
  return createBill({
    companyId,
    actorId,
    status: "draft",
    origin: doc.origin ?? "inbound",
    originRef: doc.originRef ?? null,
    input: {
      vendor_name: doc.vendorName,
      vendor_trn: doc.vendorTrn ?? null,
      bill_number: doc.billNumber ?? null,
      bill_date: doc.billDate,
      due_date: doc.dueDate ?? null,
      currency: doc.currency,
      exchange_rate: doc.exchangeRate ?? null,
      reverse_charge: doc.reverseCharge,
      category: doc.category ?? null,
      line_items: doc.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unitPrice,
        vat_rate: l.vatRate ?? null,
        vat_supply_type: l.supplyType as never,
        account_id: l.accountId ?? null,
      })),
    } as BillCreateInput,
  });
}

/**
 * Service "bills.createDraftFromInbound": validates a raw inbound document (amounts in major
 * units, see inboundBillSchema) and creates a draft bill.
 */
export async function createDraftFromInbound(
  companyId: string,
  actorId: string,
  raw: unknown
): Promise<BillWriteResult> {
  return createDraftFromParsedInbound(companyId, actorId, parseStrict(inboundBillSchema, raw));
}

function advance(dateIso: string, frequency: string): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3);
  else if (frequency === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export async function createRecurringBill(
  companyId: string,
  actorId: string,
  input: RecurringBillCreateInput
) {
  const r = await pool.query(
    `INSERT INTO recurring_bills (company_id, name, template, frequency, next_run_on, end_on, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      companyId,
      input.name,
      JSON.stringify(input.template),
      input.frequency,
      input.next_run_on,
      input.end_on ?? null,
      actorId,
    ]
  );
  return r.rows[0];
}

/** Create the pending bill for one recurring template occurrence and advance next_run_on. */
export async function runRecurringBill(
  id: string,
  companyId?: string
): Promise<BillWriteResult | null> {
  const r = await pool.query(
    `SELECT * FROM recurring_bills WHERE id = $1 AND ($2::uuid IS NULL OR company_id = $2)`,
    [id, companyId ?? null]
  );
  const rec = r.rows[0];
  if (!rec) throw new DomainError("RECURRING_BILL_NOT_FOUND", 404);
  if (!rec.is_active) return null;
  const runOn =
    rec.next_run_on instanceof Date
      ? rec.next_run_on.toISOString().slice(0, 10)
      : String(rec.next_run_on).slice(0, 10);
  if (
    rec.end_on &&
    runOn > String(rec.end_on instanceof Date ? rec.end_on.toISOString().slice(0, 10) : rec.end_on)
  ) {
    await pool.query(`UPDATE recurring_bills SET is_active = false WHERE id = $1`, [id]);
    return null;
  }
  const claimed = await pool.query(
    `UPDATE recurring_bills SET next_run_on = $2 WHERE id = $1 AND next_run_on = $3 RETURNING id`,
    [id, advance(runOn, rec.frequency), runOn]
  );
  if (!claimed.rowCount) return null; // another runner took this occurrence
  const t = rec.template as Record<string, unknown> & { due_in_days?: number };
  const dueInDays = typeof t.due_in_days === "number" ? t.due_in_days : null;
  const { due_in_days: _drop, ...template } = t;
  let due: string | null = (template.due_date as string | null) ?? null;
  if (dueInDays !== null) {
    const d = new Date(`${runOn}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + dueInDays);
    due = d.toISOString().slice(0, 10);
  }
  const result = await createBill({
    companyId: rec.company_id,
    actorId: rec.created_by,
    status: "pending",
    origin: "recurring",
    originRef: rec.id,
    input: { ...(template as unknown as BillCreateInput), bill_date: runOn, due_date: due },
  });
  await pool.query(`UPDATE recurring_bills SET last_bill_id = $2 WHERE id = $1`, [
    id,
    result.bill.id,
  ]);
  return result;
}

export async function runDueRecurringBills(today = new Date().toISOString().slice(0, 10)) {
  const due = await pool.query(
    `SELECT id FROM recurring_bills WHERE is_active = true AND next_run_on <= $1::date ORDER BY next_run_on LIMIT 500`,
    [today]
  );
  let created = 0;
  for (const row of due.rows) {
    try {
      if (await runRecurringBill(row.id)) created++;
    } catch (err) {
      log.error({ recurringBillId: row.id, err: (err as Error).message }, "Recurring bill failed");
    }
  }
  return created;
}

// ─── Registration ───────────────────────────────────────────────────────────

export type BillsRecordPayment = typeof recordBillPayment;
export type BillsCreateDraftFromInbound = typeof createDraftFromInbound;

/** Idempotent: safe to call on every app build. */
/**
 * "bills.reversePayment" — the bank-unmatch seam (W3-C): void the payment through
 * voidBillPayment (kernel reversal + reversal row + status restore), optionally inside the
 * caller's ledger transaction. The bill id is looked up when the caller does not know it.
 */
export async function reverseBillPayment(input: {
  companyId: string;
  paymentId: string;
  billId?: string | null;
  actorId: string;
  reason: string;
  tx?: LedgerTx;
}): Promise<{ billStatus: BillState; amountPaid: number } | null> {
  let billId = input.billId ?? null;
  if (!billId) {
    const rows = await txRows<{ bill_id: string }>(
      input.tx ?? db,
      `SELECT bp.bill_id FROM bill_payments bp JOIN vendor_bills vb ON vb.id = bp.bill_id
        WHERE bp.id = $1 AND vb.company_id = $2`,
      [input.paymentId, input.companyId]
    );
    billId = rows[0]?.bill_id ?? null;
    if (!billId) throw new DomainError("PAYMENT_NOT_FOUND", 404);
  }
  return voidBillPayment({
    billId,
    paymentId: input.paymentId,
    companyId: input.companyId,
    actorId: input.actorId,
    reason: input.reason,
    tx: input.tx,
  });
}

export function registerBillServices(): void {
  if (!has("bills.recordPayment")) provide("bills.recordPayment", recordBillPayment);
  if (!has("bills.reversePayment")) provide("bills.reversePayment", reverseBillPayment);
  if (!has("bills.createDraftFromInbound"))
    provide("bills.createDraftFromInbound", createDraftFromInbound);
  if (!has("bills.createVendorCreditFromInbound"))
    provide("bills.createVendorCreditFromInbound", createVendorCreditFromInbound);
  if (!listJobs().some((j) => j.name === "bills.recurring")) {
    registerJob({
      name: "bills.recurring",
      cron: "37 1 * * *",
      description: "Create bills from due recurring bill templates",
      run: async () => {
        await runDueRecurringBills();
      },
    });
  }
}
