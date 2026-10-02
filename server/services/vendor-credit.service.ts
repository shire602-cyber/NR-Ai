// Vendor credit notes (supplier credit / debit notes against vendor bills).
//
// Raw-SQL subledger like bill-pay (migration 0098). Lifecycle:
//   draft    -> editable, no ledger effect
//   approved -> journal posted (reverse of the bill entry), remaining_amount = total
//   void     -> journal reversed; refused (409) once applied to any bill
//
// Applying a credit to a bill settles part/all of the bill's amount due without
// cash: it counts toward vendor_bills.amount_paid exactly like a payment does
// (so summaries/aging, which read total - amount_paid, stay right), and the
// payment guard in bill-pay.routes.ts adds applications to what has been paid.

import Decimal from "decimal.js";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { storage } from "../storage";
import { ACCOUNT_CODES } from "../constants";
import { AppError } from "../errors";
import { createLogger } from "../config/logger";
import { assertPeriodNotLocked } from "./period-lock.service";
import { resolveLineAccount } from "./bill-posting.service";
import {
  buildVendorCreditLines,
  computeCreditTotals,
  nextVendorCreditNumber,
  remainingApplicable,
} from "./vendor-credit-posting";
import { toCalendarYmd, uaeCalendarDate } from "../utils/date";
import { resolveVendor, type VendorWarning } from "./vendor-contact.service";
import { db } from "../db";
import { applyVendorCreditStockInTx, assertProductsOfCompany, restoreVendorCreditStockInTx } from "./purchase-stock.service";
import { ensureSystemAccount } from "./inventory-costing.service";

const log = createLogger("vendor-credit");

export const VENDOR_CREDIT_JE_SOURCE = "vendor_credit_note";
/** Realised exchange difference when a credit is applied to a bill booked at another rate (source_id = the application). */
export const VENDOR_CREDIT_FX_SOURCE = "vendor_credit_fx";

/** Bill statuses a credit may be applied to (a pending bill has not hit A/P yet). */
const APPLICABLE_BILL_STATUSES = ["approved", "partial", "overdue"];
const TOLERANCE = new Decimal("0.005");

export interface VendorCreditLineInput {
  description: string;
  quantity?: number | string | null;
  unit_price: number | string;
  vat_rate?: number | string | null;
  account_id?: string | null;
  product_id?: string | null;
}

export interface VendorCreditInput {
  vendor_id?: string | null;
  vendor_name?: string;
  vendor_trn?: string | null;
  bill_id?: string | null;
  vendor_reference?: string | null;
  date: string;
  currency?: string;
  exchange_rate?: number | string | null;
  reverse_charge?: boolean;
  notes?: string | null;
  line_items: VendorCreditLineInput[];
}

const calendarDayToDate = (value: string | Date): Date => new Date(`${toCalendarYmd(value)}T00:00:00Z`);

const err = (statusCode: number, code: string, message: string) =>
  new AppError({ message, statusCode, code });

const HEADER_SELECT = `SELECT vcn.*, to_char(vcn."date", 'YYYY-MM-DD') AS date_ymd FROM vendor_credit_notes vcn`;

function shape<R extends Record<string, any>>(row: R): R {
  if (!row) return row;
  const { date_ymd, ...rest } = row as any;
  return { ...rest, date: date_ymd ?? rest.date } as R;
}

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function validateLineAccounts(companyId: string, lines: VendorCreditLineInput[]): Promise<void> {
  await assertProductsOfCompany(companyId, lines.map((l) => l.product_id));
  const ids = Array.from(new Set(lines.map((l) => l.account_id).filter((v): v is string => !!v)));
  if (ids.length === 0) return;
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const known = new Set(accounts.map((a) => a.id));
  const bad = ids.filter((id) => !known.has(id));
  if (bad.length > 0) throw err(422, "INVALID_ACCOUNT", "A line account does not belong to this company.");
}

interface ResolvedHeader {
  vendor_id: string | null;
  warnings: VendorWarning[];
  vendor_name: string;
  vendor_trn: string | null;
  bill_id: string | null;
  currency: string;
  exchange_rate: number;
  reverse_charge: boolean;
}

/** Vendor / currency / tax treatment: inherited from the bill when one is referenced. */
async function resolveHeader(companyId: string, input: VendorCreditInput): Promise<ResolvedHeader> {
  let vendorName = input.vendor_name?.trim() || "";
  let vendorTrn = input.vendor_trn ?? null;
  let vendorId: string | null = input.vendor_id ?? null;
  let currency = (input.currency || "AED").toUpperCase();
  let rate = Number(input.exchange_rate) > 0 ? Number(input.exchange_rate) : 1;
  let reverseCharge = input.reverse_charge === true;
  let rateGiven = Number(input.exchange_rate) > 0;

  if (input.bill_id) {
    const res = await pool.query(
      `SELECT vendor_id, vendor_name, vendor_trn, currency, exchange_rate, reverse_charge
         FROM vendor_bills WHERE id = $1 AND company_id = $2`,
      [input.bill_id, companyId]
    );
    const bill = res.rows[0];
    if (!bill) throw err(404, "BILL_NOT_FOUND", "The referenced vendor bill was not found.");
    // The credit inherits the bill's vendor unless a vendor (by id or by name) was given.
    if (!vendorId && !vendorName) vendorId = bill.vendor_id ?? null;
    vendorName = vendorName || bill.vendor_name;
    vendorTrn = vendorTrn ?? bill.vendor_trn ?? null;
    currency = String(bill.currency || "AED").toUpperCase();
    rate = Number(bill.exchange_rate) > 0 ? Number(bill.exchange_rate) : 1;
    rateGiven = true;
    reverseCharge = bill.reverse_charge === true;
  }

  if (!vendorName && !vendorId) throw err(422, "VENDOR_REQUIRED", "Vendor name is required.");
  if (currency !== "AED" && !rateGiven) {
    throw err(422, "NO_EXCHANGE_RATE", `Foreign-currency credit notes require exchange_rate (${currency}→AED).`);
  }
  const vendor = await resolveVendor(companyId, { vendorId, vendorName: vendorId ? undefined : vendorName, vendorTrn });
  return { vendor_id: vendor.vendorId, warnings: vendor.warnings, vendor_name: vendor.vendorName, vendor_trn: vendor.vendorTrn, bill_id: input.bill_id ?? null, currency, exchange_rate: rate, reverse_charge: reverseCharge };
}

async function insertLines(client: PoolClient, creditId: string, input: VendorCreditInput, totals: ReturnType<typeof computeCreditTotals>) {
  for (const [i, line] of input.line_items.entries()) {
    const c = totals.lines[i];
    await client.query(
      `INSERT INTO vendor_credit_note_lines
         (credit_note_id, description, quantity, unit_price, vat_rate, vat_supply_type, account_id, line_total, product_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [creditId, line.description, c.quantity, c.unitPrice, c.vatRatePercent, c.vatRatePercent > 0 ? "standard" : "zero_rated", line.account_id || null, c.amount, line.product_id || null]
    );
  }
}

export async function createVendorCredit(companyId: string, userId: string, input: VendorCreditInput) {
  await validateLineAccounts(companyId, input.line_items);
  const header = await resolveHeader(companyId, input);
  const ymd = toCalendarYmd(input.date);
  await assertPeriodNotLocked(companyId, calendarDayToDate(ymd));
  const totals = computeCreditTotals(input.line_items, header.reverse_charge);

  return inTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`vcn:${companyId}`]);
    const last = await client.query(
      `SELECT number FROM vendor_credit_notes
        WHERE company_id = $1 AND number ~ '^VCN-[0-9]+$'
        ORDER BY length(number) DESC, number DESC LIMIT 1`,
      [companyId]
    );
    const number = nextVendorCreditNumber(last.rows[0]?.number);
    const ins = await client.query(
      `INSERT INTO vendor_credit_notes
         (company_id, vendor_name, vendor_trn, bill_id, number, vendor_reference, "date", currency, exchange_rate,
          subtotal, vat_amount, total, reverse_charge, status, remaining_amount, notes, created_by, vendor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',0,$14,$15,$16)
       RETURNING id`,
      [
        companyId, header.vendor_name, header.vendor_trn, header.bill_id, number,
        input.vendor_reference || null, ymd, header.currency, header.exchange_rate,
        totals.subtotal, totals.vatAmount, totals.total, header.reverse_charge,
        input.notes || null, userId, header.vendor_id,
      ]
    );
    await insertLines(client, ins.rows[0].id, input, totals);
    log.info({ companyId, number }, "Vendor credit note drafted");
    return ins.rows[0].id as string;
  }).then(async (id) => {
    const created = await getVendorCredit(companyId, id);
    return created && header.warnings.length > 0 ? { ...created, warnings: header.warnings } : created;
  });
}

export async function updateVendorCredit(companyId: string, id: string, input: Partial<VendorCreditInput>) {
  const current = await getVendorCredit(companyId, id);
  if (!current) throw err(404, "NOT_FOUND", "Vendor credit note not found.");
  if (current.status !== "draft") throw err(409, "NOT_DRAFT", "Only draft credit notes can be edited.");

  // A vendor given by id wins; a vendor given by name alone is re-resolved by name; otherwise the link stays.
  const keepVendorLink = input.vendor_id === undefined && input.vendor_name === undefined;
  const merged: VendorCreditInput = {
    vendor_id: input.vendor_id !== undefined ? input.vendor_id : keepVendorLink ? current.vendor_id ?? null : null,
    vendor_name: input.vendor_name ?? current.vendor_name,
    vendor_trn: input.vendor_trn === undefined ? current.vendor_trn : input.vendor_trn,
    bill_id: input.bill_id === undefined ? current.bill_id : input.bill_id,
    vendor_reference: input.vendor_reference === undefined ? current.vendor_reference : input.vendor_reference,
    date: input.date ?? current.date,
    currency: input.currency ?? current.currency,
    exchange_rate: input.exchange_rate ?? current.exchange_rate,
    reverse_charge: input.reverse_charge ?? current.reverse_charge,
    notes: input.notes === undefined ? current.notes : input.notes,
    line_items:
      input.line_items ??
      current.lines.map((l: any) => ({
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        vat_rate: l.vat_rate,
        account_id: l.account_id,
        product_id: l.product_id,
      })),
  };
  await validateLineAccounts(companyId, merged.line_items);
  const header = await resolveHeader(companyId, merged);
  const ymd = toCalendarYmd(merged.date);
  await assertPeriodNotLocked(companyId, calendarDayToDate(ymd));
  const totals = computeCreditTotals(merged.line_items, header.reverse_charge);

  await inTransaction(async (client) => {
    const lock = await client.query(
      `SELECT status FROM vendor_credit_notes WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    if (lock.rows[0]?.status !== "draft") throw err(409, "NOT_DRAFT", "Only draft credit notes can be edited.");
    await client.query(
      `UPDATE vendor_credit_notes SET vendor_name=$1, vendor_trn=$2, bill_id=$3, vendor_reference=$4, "date"=$5,
              currency=$6, exchange_rate=$7, subtotal=$8, vat_amount=$9, total=$10, reverse_charge=$11,
              notes=$12, vendor_id=$15, updated_at=NOW()
        WHERE id=$13 AND company_id=$14`,
      [
        header.vendor_name, header.vendor_trn, header.bill_id, merged.vendor_reference || null, ymd,
        header.currency, header.exchange_rate, totals.subtotal, totals.vatAmount, totals.total,
        header.reverse_charge, merged.notes || null, id, companyId, header.vendor_id,
      ]
    );
    await client.query(`DELETE FROM vendor_credit_note_lines WHERE credit_note_id = $1`, [id]);
    await insertLines(client, id, merged, totals);
  });
  return getVendorCredit(companyId, id);
}

export async function listVendorCredits(
  companyId: string,
  filters: { status?: string; vendor?: string; billId?: string } = {}
) {
  const where = ["vcn.company_id = $1"];
  const params: unknown[] = [companyId];
  if (filters.status && filters.status !== "all") {
    params.push(filters.status);
    where.push(`vcn.status = $${params.length}`);
  }
  if (filters.vendor) {
    params.push(`%${filters.vendor}%`);
    where.push(`vcn.vendor_name ILIKE $${params.length}`);
  }
  if (filters.billId) {
    params.push(filters.billId);
    where.push(`vcn.bill_id = $${params.length}`);
  }
  const res = await pool.query(
    `${HEADER_SELECT} WHERE ${where.join(" AND ")} ORDER BY vcn."date" DESC, vcn.created_at DESC`,
    params
  );
  return res.rows.map(shape);
}

export async function getVendorCredit(companyId: string, id: string) {
  const head = await pool.query(`${HEADER_SELECT} WHERE vcn.id = $1 AND vcn.company_id = $2`, [id, companyId]);
  if (head.rows.length === 0) return null;
  const lines = await pool.query(
    `SELECT * FROM vendor_credit_note_lines WHERE credit_note_id = $1 ORDER BY created_at, id`,
    [id]
  );
  const apps = await pool.query(
    `SELECT a.*, b.bill_number, b.vendor_name FROM vendor_credit_applications a
       LEFT JOIN vendor_bills b ON b.id = a.bill_id
      WHERE a.credit_note_id = $1 ORDER BY a.applied_at`,
    [id]
  );
  return { ...shape(head.rows[0]), lines: lines.rows, applications: apps.rows };
}

export async function approveVendorCredit(companyId: string, id: string, userId: string) {
  const credit = await getVendorCredit(companyId, id);
  if (!credit) throw err(404, "NOT_FOUND", "Vendor credit note not found.");
  if (credit.status !== "draft") throw err(409, "NOT_DRAFT", "Only draft credit notes can be approved.");
  if (credit.lines.length === 0) throw err(422, "NO_LINES", "A credit note needs at least one line.");

  const creditDate = calendarDayToDate(credit.date);
  await assertPeriodNotLocked(companyId, creditDate);

  await inTransaction(async (client) => {
    const lock = await client.query(
      `SELECT status FROM vendor_credit_notes WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    if (lock.rows[0]?.status !== "draft") throw err(409, "NOT_DRAFT", "Only draft credit notes can be approved.");

    // Goods returned to the supplier leave stock in the same transaction that books the credit (purchase-stock.service).
    const journalId = await db.transaction((stockTx: any) => postCreditJournal(companyId, credit, userId, creditDate, stockTx));
    await client.query(
      `UPDATE vendor_credit_notes
          SET status='approved', remaining_amount=total, journal_entry_id=$1, approved_by=$2,
              approved_at=NOW(), updated_at=NOW()
        WHERE id=$3`,
      [journalId, userId, id]
    );
  });
  log.info({ companyId, creditId: id }, "Vendor credit note approved");
  return getVendorCredit(companyId, id);
}

async function postCreditJournal(companyId: string, credit: any, userId: string, creditDate: Date, stockTx?: any): Promise<string> {
  // Idempotent: a retried approval (journal posted, status update lost) reuses the entry.
  const existing = await storage.getJournalEntriesBySource(companyId, VENDOR_CREDIT_JE_SOURCE, credit.id);
  const original = existing.find((e) => e.status === "posted" && !e.reversedEntryId);
  if (original) return original.id;

  const accounts = await storage.getAccountsByCompanyId(companyId);
  const ap = accounts.find((a) => a.code === ACCOUNT_CODES.AP && a.type === "liability");
  if (!ap) throw err(422, "NO_AP_ACCOUNT", "Accounts Payable account (2010) not found in chart of accounts");
  const inputVat = accounts.find((a) => a.isVatAccount && a.vatType === "input" && a.code === ACCOUNT_CODES.VAT_INPUT);
  const outputVat = accounts.find((a) => a.isVatAccount && a.vatType === "output" && a.code === ACCOUNT_CODES.VAT_OUTPUT);

  let category: string | null = null;
  if (credit.bill_id) {
    const b = await pool.query(`SELECT category FROM vendor_bills WHERE id = $1`, [credit.bill_id]);
    category = b.rows[0]?.category ?? null;
  }

  const lines = [];
  // Returned stock: out of the stock record at the credit's value, and 1070 is credited for exactly what left.
  const returned = stockTx
    ? await applyVendorCreditStockInTx(
        stockTx,
        { id: credit.id, company_id: companyId, number: credit.number, date: credit.date, exchange_rate: credit.exchange_rate },
        credit.lines,
        userId
      )
    : new Map<string, { left: number; lineAed: number }>();
  const stockAdjustments: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];
  for (const line of credit.lines) {
    const moved = returned.get(line.id);
    if (moved) {
      const inventory = await ensureSystemAccount(stockTx, companyId, ACCOUNT_CODES.INVENTORY, "asset");
      lines.push({ accountId: inventory.id, amount: Number(line.line_total), description: line.description });
      // The credit may be worth more or less than the stock's value: the difference is an inventory adjustment.
      const diff = Math.round((moved.lineAed - moved.left) * 100) / 100;
      if (diff !== 0) {
        const adj = await ensureSystemAccount(stockTx, companyId, ACCOUNT_CODES.INVENTORY_ADJUSTMENTS, "expense");
        const label = `Vendor credit ${credit.number} - ${line.description} (difference to stock value)`.slice(0, 255);
        const amount = Math.abs(diff);
        // Credit worth more than the stock (diff > 0): 1070 gives back what the credit over-credited, 5210 takes the gain.
        stockAdjustments.push({ accountId: inventory.id, debit: diff > 0 ? amount : 0, credit: diff > 0 ? 0 : amount, description: label });
        stockAdjustments.push({ accountId: adj.id, debit: diff > 0 ? 0 : amount, credit: diff > 0 ? amount : 0, description: label });
      }
      continue;
    }
    const accountId = await resolveLineAccount(
      accounts,
      companyId,
      { description: line.description, amount: line.line_total, account_id: line.account_id },
      category
    );
    lines.push({ accountId, amount: Number(line.line_total), description: line.description });
  }

  const ref = credit.number;
  const posting = buildVendorCreditLines({
    lines,
    vatAmount: Number(credit.vat_amount),
    fxRate: Number(credit.exchange_rate) || 1,
    reverseCharge: credit.reverse_charge === true,
    accounts: { apId: ap.id, inputVatId: inputVat?.id, outputVatId: outputVat?.id },
    ref,
    vendorName: credit.vendor_name,
  });

  const entryNumber = stockTx ? "PENDING" : await storage.generateEntryNumber(companyId, creditDate);
  const entry = await storage.createJournalEntry(
    {
      companyId,
      date: creditDate,
      memo: `Vendor Credit ${ref} - ${credit.vendor_name}`,
      entryNumber,
      status: "posted",
      source: VENDOR_CREDIT_JE_SOURCE,
      sourceId: credit.id,
      createdBy: userId,
      postedBy: userId,
      postedAt: creditDate,
    } as any,
    [...posting, ...stockAdjustments] as any,
    stockTx ? { tx: stockTx } : undefined
  );
  return entry.id;
}

/**
 * The bill credited A/P at the bill's rate, the credit note debited it at the credit's rate: applying
 * `amount` of foreign currency leaves amount x (bill rate - credit rate) of AED on A/P. Move it to the
 * realised FX account so A/P lands on exactly zero when the bill is fully settled: a lower credit rate
 * leaves a debit residue (Cr 2010 / Dr FX loss 5140), a higher one a credit residue (Dr 2010 / Cr FX gain 4090).
 * Runs inside the application's transaction: a refusal (locked period) rolls the application back.
 */
async function postApplicationFxDifference(
  companyId: string,
  args: { applicationId: string; amount: Decimal; billRate: Decimal; creditRate: Decimal; reference: string; userId: string }
): Promise<void> {
  const diff = args.amount.times(args.billRate.minus(args.creditRate)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (diff.isZero()) return;

  const accounts = await storage.getAccountsByCompanyId(companyId);
  const byCode = (code: string) => accounts.find((a) => a.code === code && a.isActive !== false);
  const ap = byCode(ACCOUNT_CODES.AP);
  const fx = byCode(diff.isNegative() ? ACCOUNT_CODES.FX_LOSS : ACCOUNT_CODES.FX_GAIN);
  if (!ap || !fx) {
    throw err(
      422,
      "CHART_OF_ACCOUNTS_MISSING",
      `Cannot post the exchange difference: account ${!ap ? ACCOUNT_CODES.AP : diff.isNegative() ? ACCOUNT_CODES.FX_LOSS : ACCOUNT_CODES.FX_GAIN} is missing from the chart of accounts.`
    );
  }
  const amount = diff.abs().toNumber();
  const date = uaeCalendarDate();
  // loss (credit rate above the bill rate): Dr FX loss / Cr A/P;  gain: Dr A/P / Cr FX gain
  const lines = diff.isNegative()
    ? [
        { accountId: fx.id, debit: amount, credit: 0, description: `Realised exchange loss - ${args.reference}` },
        { accountId: ap.id, debit: 0, credit: amount, description: `Exchange difference - ${args.reference}` },
      ]
    : [
        { accountId: ap.id, debit: amount, credit: 0, description: `Exchange difference - ${args.reference}` },
        { accountId: fx.id, debit: 0, credit: amount, description: `Realised exchange gain - ${args.reference}` },
      ];
  await storage.createJournalEntry(
    {
      companyId,
      date,
      memo: `Realised exchange difference - ${args.reference}`,
      entryNumber: await storage.generateEntryNumber(companyId, date),
      status: "posted",
      source: VENDOR_CREDIT_FX_SOURCE,
      sourceId: args.applicationId,
      createdBy: args.userId,
      postedBy: args.userId,
      postedAt: new Date(),
    } as any,
    lines as any
  );
}

export async function applyVendorCredit(
  companyId: string,
  id: string,
  input: { bill_id: string; amount: number | string },
  userId: string
) {
  const amount = new Decimal(input.amount);
  if (!amount.isFinite() || amount.lte(0)) throw err(422, "INVALID_AMOUNT", "Amount must be positive.");

  const out = await inTransaction(async (client) => {
    const creditRes = await client.query(
      `SELECT * FROM vendor_credit_notes WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    const credit = creditRes.rows[0];
    if (!credit) throw err(404, "NOT_FOUND", "Vendor credit note not found.");
    if (credit.status !== "approved") throw err(409, "NOT_APPROVED", "Only approved credit notes can be applied.");

    const billRes = await client.query(
      `SELECT * FROM vendor_bills WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [input.bill_id, companyId]
    );
    const bill = billRes.rows[0];
    if (!bill) throw err(404, "BILL_NOT_FOUND", "Vendor bill not found.");
    if (!APPLICABLE_BILL_STATUSES.includes(bill.status)) {
      throw err(422, "BILL_NOT_PAYABLE", `A credit can only be applied to an approved, unpaid bill (this bill is ${bill.status}).`);
    }
    if (String(bill.vendor_name).trim().toLowerCase() !== String(credit.vendor_name).trim().toLowerCase()) {
      throw err(422, "VENDOR_MISMATCH", "The credit note and the bill belong to different vendors.");
    }
    if (String(bill.currency || "AED").toUpperCase() !== String(credit.currency).toUpperCase()) {
      throw err(422, "CURRENCY_MISMATCH", "The credit note and the bill are in different currencies.");
    }
    if ((bill.reverse_charge === true) !== (credit.reverse_charge === true)) {
      throw err(422, "TAX_TREATMENT_MISMATCH", "The credit note and the bill differ in reverse-charge treatment.");
    }

    // Due is recomputed under the lock from the sources of truth, never from a stale column.
    const paid = await client.query(
      `SELECT COALESCE((SELECT SUM(amount) FROM bill_payments WHERE bill_id = $1), 0)
            + COALESCE((SELECT SUM(amount) FROM vendor_credit_applications WHERE bill_id = $1), 0) AS settled`,
      [input.bill_id]
    );
    const total = new Decimal(bill.total_amount ?? 0);
    const settled = new Decimal(paid.rows[0].settled ?? 0);
    const due = total.minus(settled);
    const remaining = new Decimal(credit.remaining_amount ?? 0);
    const cap = new Decimal(remainingApplicable(remaining.toFixed(2), due.toFixed(2)));
    if (amount.gt(cap.plus(TOLERANCE))) {
      throw err(
        422,
        "OVER_APPLIED",
        `Amount (${amount.toFixed(2)}) exceeds what can be applied: credit remaining ${remaining.toFixed(2)}, bill due ${due.toFixed(2)}.`
      );
    }

    const app = await client.query(
      `INSERT INTO vendor_credit_applications (company_id, credit_note_id, bill_id, amount, applied_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [companyId, id, input.bill_id, amount.toFixed(2), userId]
    );
    await postApplicationFxDifference(companyId, {
      applicationId: app.rows[0].id,
      amount,
      billRate: new Decimal(bill.exchange_rate ?? 1),
      creditRate: new Decimal(credit.exchange_rate ?? 1),
      reference: `${credit.number} applied to bill ${bill.bill_number || bill.id}`,
      userId,
    });
    await client.query(
      `UPDATE vendor_credit_notes SET remaining_amount = remaining_amount - $1, updated_at = NOW() WHERE id = $2`,
      [amount.toFixed(2), id]
    );
    const newSettled = settled.plus(amount);
    const newStatus = newSettled.gte(total.minus(TOLERANCE)) ? "paid" : "partial";
    await client.query(
      `UPDATE vendor_bills
          SET amount_paid = $1, status = $2, paid_at = ${newStatus === "paid" ? "NOW()" : "paid_at"}
        WHERE id = $3`,
      [newSettled.toFixed(2), newStatus, input.bill_id]
    );
    return {
      application: app.rows[0],
      bill_status: newStatus,
      bill_due: total.minus(newSettled).toFixed(2),
      credit_remaining: remaining.minus(amount).toFixed(2),
    };
  });
  log.info({ companyId, creditId: id, billId: input.bill_id, amount: amount.toFixed(2) }, "Vendor credit applied");
  return out;
}

export async function voidVendorCredit(companyId: string, id: string, userId: string, reason?: string | null) {
  const credit = await getVendorCredit(companyId, id);
  if (!credit) throw err(404, "NOT_FOUND", "Vendor credit note not found.");
  if (credit.status === "void") throw err(409, "ALREADY_VOID", "This credit note is already void.");
  if (credit.status === "approved") await assertPeriodNotLocked(companyId, calendarDayToDate(credit.date));

  await inTransaction(async (client) => {
    const lock = await client.query(
      `SELECT status FROM vendor_credit_notes WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    const status = lock.rows[0]?.status;
    if (status === "void") throw err(409, "ALREADY_VOID", "This credit note is already void.");
    const apps = await client.query(
      `SELECT COUNT(*)::int AS n FROM vendor_credit_applications WHERE credit_note_id = $1`,
      [id]
    );
    if (apps.rows[0].n > 0) {
      throw err(409, "HAS_APPLICATIONS", "This credit note has been applied to a bill and cannot be voided.");
    }

    let reversalId: string | null = null;
    if (status === "approved") {
      // The returned goods come back into stock in the transaction that posts the reversing entry.
      reversalId = await db.transaction(async (stockTx: any) => {
        await restoreVendorCreditStockInTx(stockTx, { id: credit.id, company_id: companyId, number: credit.number, date: credit.date }, userId);
        return postReversal(companyId, credit, userId, reason, stockTx);
      });
    }
    await client.query(
      `UPDATE vendor_credit_notes
          SET status='void', remaining_amount=0, void_journal_entry_id=$1, voided_at=NOW(), updated_at=NOW()
        WHERE id=$2`,
      [reversalId, id]
    );
  });
  log.info({ companyId, creditId: id }, "Vendor credit note voided");
  return getVendorCredit(companyId, id);
}

async function postReversal(companyId: string, credit: any, userId: string, reason?: string | null, stockTx?: any): Promise<string> {
  const entries = await storage.getJournalEntriesBySource(companyId, VENDOR_CREDIT_JE_SOURCE, credit.id);
  const reversed = entries.find((e) => e.status === "posted" && e.reversedEntryId);
  if (reversed) return reversed.id;
  const original = entries.find((e) => e.status === "posted" && !e.reversedEntryId);
  if (!original) throw err(409, "NO_JOURNAL", "The credit note has no posted journal entry to reverse.");

  const originalLines = await storage.getJournalLinesByEntryId(original.id);
  const reversalLines = originalLines.map((l) => ({
    accountId: l.accountId,
    debit: l.credit,
    credit: l.debit,
    description: `Reversal: ${l.description || ""}`.slice(0, 255),
  }));
  const date = calendarDayToDate(credit.date);
  const entryNumber = stockTx ? "PENDING" : await storage.generateEntryNumber(companyId, date);
  const entry = await storage.createJournalEntry(
    {
      companyId,
      date,
      memo: `Void Vendor Credit ${credit.number} - reversal of original posting`,
      entryNumber,
      status: "posted",
      source: VENDOR_CREDIT_JE_SOURCE,
      sourceId: credit.id,
      reversedEntryId: original.id,
      reversalReason: reason || "Vendor credit note voided",
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
    } as any,
    reversalLines as any,
    stockTx ? { tx: stockTx } : undefined
  );
  return entry.id;
}
