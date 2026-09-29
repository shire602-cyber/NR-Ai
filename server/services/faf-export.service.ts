/**
 * FTA Audit File (FAF) export.
 *
 * !! The column layout in ./faf-format.ts MUST be verified against the FTA's
 * published FAF specification before this file is relied on for a real audit
 * (the specification could not be consulted when this was written). !!
 *
 * The file is produced as a stream: the four record blocks are written batch by
 * batch (keyset pagination, a few hundred documents / a few thousand ledger lines
 * at a time), so a year of data never sits in memory. Posted documents only;
 * credit notes are negative lines; foreign-currency documents show AED at the
 * booked rate plus the foreign amounts; amounts are 2dp; every text cell is
 * CSV-quoted and guarded against spreadsheet formula injection.
 *
 * Supply and purchase lines follow the SAME inclusion and classification rules as
 * the VAT 201 generator (vat-return-compute.service.ts / vat-supply-type.ts), so
 * the listing totals tie to the return boxes for the same period.
 */

import { pool } from "../db";
import { classifyVatLineForReturn, type VatReturnClass } from "./vat-supply-type";
import { VOID_DATE_LATERAL_SQL, invoiceEffectForPeriod } from "./vat-document-effect";
import { UAE_VAT_RATE } from "../constants";
import {
  FAF_BLOCKS,
  FAF_COLUMNS,
  FAF_DEFAULT_SUPPLY_COUNTRY,
  FAF_DELIMITER,
  FAF_EMIT_BOM,
  FAF_EOL,
  FAF_FILE_VERSION,
  FAF_LEDGER_CURRENCY,
  FAF_MAX_RANGE_DAYS,
  FAF_TAX_CODES,
  type FafTaxCode,
} from "./faf-format";

// ─── Row shapes ──────────────────────────────────────────────────────────────

export interface FafPurchaseRow {
  supplierName: string;
  supplierTrn: string | null;
  invoiceDate: string;
  invoiceNumber: string;
  permitNumber: string | null;
  lineNumber: number;
  description: string;
  valueAed: number;
  vatAed: number;
  taxCode: FafTaxCode;
  fcyCode: string | null;
  valueFcy: number | null;
  vatFcy: number | null;
}

export interface FafSupplyRow {
  customerName: string;
  customerTrn: string | null;
  invoiceDate: string;
  invoiceNumber: string;
  lineNumber: number;
  description: string;
  valueAed: number;
  vatAed: number;
  taxCode: FafTaxCode;
  country: string;
  fcyCode: string | null;
  valueFcy: number | null;
  vatFcy: number | null;
}

export interface FafGlRow {
  transactionDate: string;
  /** Account code (the identifier accountants know the account by). */
  accountId: string;
  accountName: string;
  description: string;
  name: string;
  transactionId: string;
  sourceDocumentId: string;
  sourceType: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface FafDataSource {
  purchases(): AsyncIterable<FafPurchaseRow[]>;
  supplies(): AsyncIterable<FafSupplyRow[]>;
  /** Ordered by account, then date, then entry, then line. */
  ledger(): AsyncIterable<FafGlRow[]>;
  /** Balance of every account (by code) before the period start. */
  openingBalances(): Promise<Map<string, number>>;
}

export interface FafMeta {
  companyName: string;
  trn: string;
  from: string;
  to: string;
  createdOn: string;
  productVersion: string;
}

export interface FafTotals {
  purchases: { value: number; vat: number; count: number };
  supplies: { value: number; vat: number; count: number };
  ledger: { debit: number; credit: number; count: number };
}

// ─── CSV cells ───────────────────────────────────────────────────────────────

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * A text cell. Values a spreadsheet would evaluate as a formula (leading = + - @
 * tab CR) get a single-quote prefix; the cell is quoted when it contains the
 * delimiter, a quote, a line break or edge whitespace.
 */
export function csvText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  const needsQuotes =
    text.includes(FAF_DELIMITER) || /["\r\n]/.test(text) || text !== text.trim();
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A numeric cell, always 2dp; never formula-guarded (credit notes are legitimately negative). */
export function csvNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  const rounded = Math.round(n * 100 + (n < 0 ? -1e-7 : 1e-7)) / 100;
  return (rounded === 0 ? 0 : rounded).toFixed(2);
}

const line = (cells: string[]): string => cells.join(FAF_DELIMITER) + FAF_EOL;
const round2 = (n: number): number => Math.round(n * 100 + (n < 0 ? -1e-7 : 1e-7)) / 100;

// ─── Tax codes ───────────────────────────────────────────────────────────────

export function fafSupplyTaxCode(input: { klass: VatReturnClass; reverseCharge: boolean }): FafTaxCode {
  if (input.reverseCharge) return FAF_TAX_CODES.reverseCharge;
  switch (input.klass) {
    case "standard":
      return FAF_TAX_CODES.standardRated;
    case "zero_rated":
      return FAF_TAX_CODES.zeroRated;
    case "exempt":
      return FAF_TAX_CODES.exempt;
    default:
      return FAF_TAX_CODES.outOfScope;
  }
}

/**
 * Purchases: reverse charge -> RC, flagged imports -> IG, a line carrying VAT -> SR,
 * otherwise OS (the source does not say whether it was zero-rated, exempt or out of scope).
 */
export function fafPurchaseTaxCode(input: { reverseCharge: boolean; isImport: boolean; vat: number }): FafTaxCode {
  if (input.reverseCharge) return FAF_TAX_CODES.reverseCharge;
  if (input.isImport) return FAF_TAX_CODES.importOfGoods;
  return input.vat > 0 ? FAF_TAX_CODES.standardRated : FAF_TAX_CODES.outOfScope;
}

// ─── Range validation ────────────────────────────────────────────────────────

export type FafRangeResult =
  | { ok: true; from: string; to: string }
  | { ok: false; code: string; message: string };

const isRealDate = (ymd: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
};

export function validateFafRange(from: unknown, to: unknown): FafRangeResult {
  if (typeof from !== "string" || typeof to !== "string" || !from || !to) {
    return { ok: false, code: "FAF_RANGE_REQUIRED", message: "Both from and to (YYYY-MM-DD) are required." };
  }
  if (!isRealDate(from) || !isRealDate(to)) {
    return { ok: false, code: "FAF_RANGE_INVALID", message: "from and to must be real dates in YYYY-MM-DD format." };
  }
  if (from > to) {
    return { ok: false, code: "FAF_RANGE_INVALID", message: "from must be on or before to." };
  }
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > FAF_MAX_RANGE_DAYS) {
    return {
      ok: false,
      code: "FAF_RANGE_TOO_LARGE",
      message: `An FTA Audit File covers at most one financial year (${FAF_MAX_RANGE_DAYS} days); you asked for ${Math.round(days)} days. Request the period in separate files.`,
    };
  }
  return { ok: true, from, to };
}

// ─── The stream ──────────────────────────────────────────────────────────────

/**
 * Yields the FAF text in chunks. `totals` is filled in as blocks are written, so the
 * caller can audit-log the counts once the stream ends.
 */
export async function* streamFaf(
  source: FafDataSource,
  meta: FafMeta,
  totals: FafTotals
): AsyncGenerator<string> {
  if (FAF_EMIT_BOM) yield "﻿";

  // Company information
  yield line([FAF_BLOCKS.company.start]);
  yield line([...FAF_COLUMNS.company]);
  yield line([
    csvText(meta.companyName),
    csvText(meta.trn),
    meta.from,
    meta.to,
    meta.createdOn,
    csvText(meta.productVersion),
    FAF_FILE_VERSION,
  ]);
  yield line([FAF_BLOCKS.company.end]);

  // Purchase listing
  yield line([FAF_BLOCKS.purchases.start]);
  yield line([...FAF_COLUMNS.purchases]);
  let pValue = 0;
  let pVat = 0;
  for await (const batch of source.purchases()) {
    let out = "";
    for (const r of batch) {
      pValue += r.valueAed;
      pVat += r.vatAed;
      totals.purchases.count += 1;
      out += line([
        csvText(r.supplierName),
        csvText(r.supplierTrn),
        r.invoiceDate,
        csvText(r.invoiceNumber),
        csvText(r.permitNumber),
        String(r.lineNumber),
        csvText(r.description),
        csvNumber(r.valueAed),
        csvNumber(r.vatAed),
        r.taxCode,
        csvText(r.fcyCode),
        csvNumber(r.valueFcy),
        csvNumber(r.vatFcy),
      ]);
    }
    yield out;
  }
  totals.purchases.value = round2(pValue);
  totals.purchases.vat = round2(pVat);
  yield line([...FAF_COLUMNS.purchasesFooter]);
  yield line([csvNumber(totals.purchases.value), csvNumber(totals.purchases.vat), String(totals.purchases.count)]);
  yield line([FAF_BLOCKS.purchases.end]);

  // Supply listing
  yield line([FAF_BLOCKS.supplies.start]);
  yield line([...FAF_COLUMNS.supplies]);
  let sValue = 0;
  let sVat = 0;
  for await (const batch of source.supplies()) {
    let out = "";
    for (const r of batch) {
      sValue += r.valueAed;
      sVat += r.vatAed;
      totals.supplies.count += 1;
      out += line([
        csvText(r.customerName),
        csvText(r.customerTrn),
        r.invoiceDate,
        csvText(r.invoiceNumber),
        String(r.lineNumber),
        csvText(r.description),
        csvNumber(r.valueAed),
        csvNumber(r.vatAed),
        r.taxCode,
        csvText(r.country),
        csvText(r.fcyCode),
        csvNumber(r.valueFcy),
        csvNumber(r.vatFcy),
      ]);
    }
    yield out;
  }
  totals.supplies.value = round2(sValue);
  totals.supplies.vat = round2(sVat);
  yield line([...FAF_COLUMNS.suppliesFooter]);
  yield line([csvNumber(totals.supplies.value), csvNumber(totals.supplies.vat), String(totals.supplies.count)]);
  yield line([FAF_BLOCKS.supplies.end]);

  // General ledger listing
  yield line([FAF_BLOCKS.ledger.start]);
  yield line([...FAF_COLUMNS.ledger]);
  const running = await source.openingBalances();
  let debit = 0;
  let credit = 0;
  for await (const batch of source.ledger()) {
    let out = "";
    for (const r of batch) {
      const balance = round2((running.get(r.accountId) ?? 0) + r.debit - r.credit);
      running.set(r.accountId, balance);
      debit += r.debit;
      credit += r.credit;
      totals.ledger.count += 1;
      out += line([
        r.transactionDate,
        csvText(r.accountId),
        csvText(r.accountName),
        csvText(r.description),
        csvText(r.name),
        csvText(r.transactionId),
        csvText(r.sourceDocumentId),
        csvText(r.sourceType),
        csvNumber(r.debit),
        csvNumber(r.credit),
        csvNumber(balance),
      ]);
    }
    yield out;
  }
  totals.ledger.debit = round2(debit);
  totals.ledger.credit = round2(credit);
  yield line([...FAF_COLUMNS.ledgerFooter]);
  yield line([csvNumber(totals.ledger.debit), csvNumber(totals.ledger.credit), String(totals.ledger.count), FAF_LEDGER_CURRENCY]);
  yield line([FAF_BLOCKS.ledger.end]);
}

export function emptyFafTotals(): FafTotals {
  return {
    purchases: { value: 0, vat: 0, count: 0 },
    supplies: { value: 0, vat: 0, count: 0 },
    ledger: { debit: 0, credit: 0, count: 0 },
  };
}

// ─── Database source ─────────────────────────────────────────────────────────

const DOC_BATCH = 500;
const GL_BATCH = 4000;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const AED = "AED";
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const rateOf = (v: unknown): number => (num(v) > 0 ? num(v) : 1);
const fcy = (currency: unknown) => (currency && String(currency).toUpperCase() !== AED ? String(currency).toUpperCase() : null);

/** Split `total` over `weights` so the parts sum to `total` to the fils (last part takes the remainder). */
export function allocate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((s, w) => s + w, 0);
  const out: number[] = [];
  let used = 0;
  weights.forEach((w, i) => {
    if (i === weights.length - 1) out.push(round2(total - used));
    else {
      const part = round2(sum === 0 ? total / weights.length : (total * w) / sum);
      out.push(part);
      used += part;
    }
  });
  return out;
}

async function* supplyBatches(companyId: string, from: string, to: string): AsyncGenerator<FafSupplyRow[]> {
  let cursorDate = "-infinity";
  let cursorId = NIL_UUID;
  for (;;) {
    // Invoices dated in the range, plus older ones whose void (cancellation) falls inside it. The
    // ledger holds the original in its own period and the reversal in the void's period, so the
    // listing follows the same shared rule as the VAT return (vat-document-effect.ts).
    const inv = await pool.query(
      `SELECT i.id, i.number, to_char(i.date, 'YYYY-MM-DD') AS d, i.date, i.status, i.customer_name, i.customer_trn,
              i.currency, i.exchange_rate, i.reverse_charge, to_char(rev.d, 'YYYY-MM-DD') AS voided_on
         FROM invoices i ${VOID_DATE_LATERAL_SQL}
        WHERE i.company_id = $1
          AND i.status <> 'draft'
          AND COALESCE(i.is_opening_balance, false) = false
          AND ( (i.date >= $2::date AND i.date < ($3::date + 1))
             OR (i.status IN ('void', 'cancelled') AND rev.d >= $2::date AND rev.d <= $3::date) )
          AND (i.date, i.id) > ($4::timestamp, $5::uuid)
        ORDER BY i.date, i.id
        LIMIT ${DOC_BATCH}`,
      [companyId, from, to, cursorDate, cursorId]
    );
    if (inv.rows.length === 0) return;
    const ids = inv.rows.map((r: any) => r.id);
    const lines = await pool.query(
      `SELECT invoice_id, description, quantity, unit_price, vat_rate, vat_supply_type
         FROM invoice_lines WHERE invoice_id = ANY($1::uuid[]) ORDER BY invoice_id, id`,
      [ids]
    );
    const byInvoice = new Map<string, any[]>();
    for (const l of lines.rows) byInvoice.set(l.invoice_id, [...(byInvoice.get(l.invoice_id) ?? []), l]);

    const rows: FafSupplyRow[] = [];
    for (const d of inv.rows) {
      const effect = invoiceEffectForPeriod({ id: d.id, date: d.d, status: d.status, voidedOn: d.voided_on }, from, to);
      if (effect !== "include" && effect !== "reverse_in_period") continue;
      // a cancellation from an earlier period is a negative line dated the day of the void
      const sign = effect === "reverse_in_period" ? -1 : 1;
      const rate = rateOf(d.exchange_rate);
      const foreign = fcy(d.currency);
      (byInvoice.get(d.id) ?? []).forEach((l, index) => {
        const docValue = sign * num(l.quantity) * num(l.unit_price);
        const vatRate = l.vat_rate == null ? UAE_VAT_RATE : num(l.vat_rate);
        const klass = classifyVatLineForReturn({ rate: l.vat_rate, supplyType: l.vat_supply_type });
        const docVat = klass === "standard" ? docValue * vatRate : 0;
        rows.push({
          customerName: d.customer_name ?? "",
          customerTrn: d.customer_trn ?? null,
          invoiceDate: effect === "reverse_in_period" ? d.voided_on : d.d,
          invoiceNumber: d.number,
          lineNumber: index + 1,
          description: l.description ?? "",
          valueAed: round2(docValue * rate),
          vatAed: round2(docVat * rate),
          taxCode: fafSupplyTaxCode({ klass, reverseCharge: d.reverse_charge === true }),
          country: FAF_DEFAULT_SUPPLY_COUNTRY,
          fcyCode: foreign,
          valueFcy: foreign ? round2(docValue) : null,
          vatFcy: foreign ? round2(docVat) : null,
        });
      });
    }
    yield rows;
    const last = inv.rows[inv.rows.length - 1];
    cursorDate = new Date(last.date).toISOString().replace("T", " ").replace("Z", "");
    cursorId = last.id;
    if (inv.rows.length < DOC_BATCH) return;
  }
}

async function* billBatches(companyId: string, from: string, to: string): AsyncGenerator<FafPurchaseRow[]> {
  let cursorDate = "-infinity";
  let cursorId = NIL_UUID;
  for (;;) {
    const bills = await pool.query(
      `SELECT id, vendor_name, vendor_trn, bill_number, to_char(bill_date, 'YYYY-MM-DD') AS d, bill_date,
              currency, subtotal, vat_amount, reverse_charge, COALESCE(exchange_rate, 1) AS rate
         FROM vendor_bills
        WHERE company_id = $1
          AND bill_date >= $2::date AND bill_date < ($3::date + 1)
          AND status NOT IN ('void', 'cancelled', 'draft', 'pending')
          AND COALESCE(is_opening_balance, false) = false
          AND (bill_date, id) > ($4::timestamp, $5::uuid)
        ORDER BY bill_date, id
        LIMIT ${DOC_BATCH}`,
      [companyId, from, to, cursorDate, cursorId]
    );
    if (bills.rows.length === 0) return;
    const ids = bills.rows.map((r: any) => r.id);
    const items = await pool.query(
      `SELECT bill_id, description, quantity, unit_price, amount
         FROM bill_line_items WHERE bill_id = ANY($1::uuid[]) ORDER BY bill_id, created_at, id`,
      [ids]
    );
    const byBill = new Map<string, any[]>();
    for (const l of items.rows) byBill.set(l.bill_id, [...(byBill.get(l.bill_id) ?? []), l]);

    const rows: FafPurchaseRow[] = [];
    for (const b of bills.rows) {
      const rate = rateOf(b.rate);
      const foreign = fcy(b.currency);
      const subtotal = num(b.subtotal);
      const vat = num(b.vat_amount);
      const lines = byBill.get(b.id) ?? [];
      // Line amounts, with any difference to the bill subtotal folded into the last line so the
      // listing always ties to the header (and to the VAT return, which uses the header).
      let amounts = lines.map((l) => (l.amount != null ? num(l.amount) : num(l.quantity) * num(l.unit_price)));
      let descriptions = lines.map((l) => l.description ?? "");
      if (lines.length === 0) {
        amounts = [subtotal];
        descriptions = ["Vendor bill"];
      } else {
        const diff = round2(subtotal - amounts.reduce((s, a) => s + a, 0));
        if (diff !== 0) amounts[amounts.length - 1] = round2(amounts[amounts.length - 1] + diff);
      }
      const docVats = allocate(vat, amounts);
      amounts.forEach((amount, index) => {
        rows.push({
          supplierName: b.vendor_name ?? "",
          supplierTrn: b.vendor_trn ?? null,
          invoiceDate: b.d,
          invoiceNumber: b.bill_number || `BILL-${String(b.id).slice(0, 8)}`,
          permitNumber: null,
          lineNumber: index + 1,
          description: descriptions[index],
          valueAed: round2(amount * rate),
          vatAed: round2(docVats[index] * rate),
          taxCode: fafPurchaseTaxCode({ reverseCharge: b.reverse_charge === true, isImport: false, vat: docVats[index] }),
          fcyCode: foreign,
          valueFcy: foreign ? round2(amount) : null,
          vatFcy: foreign ? round2(docVats[index]) : null,
        });
      });
    }
    yield rows;
    const last = bills.rows[bills.rows.length - 1];
    cursorDate = new Date(last.bill_date).toISOString().replace("T", " ").replace("Z", "");
    cursorId = last.id;
    if (bills.rows.length < DOC_BATCH) return;
  }
}

async function* receiptBatches(companyId: string, from: string, to: string): AsyncGenerator<FafPurchaseRow[]> {
  let cursorDate = "-infinity";
  let cursorId = NIL_UUID;
  for (;;) {
    const res = await pool.query(
      `SELECT id, merchant, category, COALESCE(date, created_at) AS eff_date,
              to_char(COALESCE(date, created_at), 'YYYY-MM-DD') AS d,
              amount, vat_amount, currency, exchange_rate, reverse_charge
         FROM receipts
        WHERE company_id = $1 AND posted = true
          AND COALESCE(date, created_at) >= $2::date AND COALESCE(date, created_at) < ($3::date + 1)
          AND (COALESCE(date, created_at), id) > ($4::timestamp, $5::uuid)
        ORDER BY COALESCE(date, created_at), id
        LIMIT ${DOC_BATCH}`,
      [companyId, from, to, cursorDate, cursorId]
    );
    if (res.rows.length === 0) return;
    const rows: FafPurchaseRow[] = res.rows.map((r: any) => {
      const rate = rateOf(r.exchange_rate);
      const foreign = fcy(r.currency);
      const value = num(r.amount);
      const vat = num(r.vat_amount);
      return {
        supplierName: r.merchant ?? "",
        supplierTrn: null, // receipts do not record the supplier TRN
        invoiceDate: r.d,
        invoiceNumber: `RECEIPT-${String(r.id).slice(0, 8)}`,
        permitNumber: null,
        lineNumber: 1,
        description: r.category ?? "Receipt",
        valueAed: round2(value * rate),
        vatAed: round2(vat * rate),
        taxCode: fafPurchaseTaxCode({ reverseCharge: r.reverse_charge === true, isImport: false, vat }),
        fcyCode: foreign,
        valueFcy: foreign ? round2(value) : null,
        vatFcy: foreign ? round2(vat) : null,
      };
    });
    yield rows;
    const last = res.rows[res.rows.length - 1];
    cursorDate = new Date(last.eff_date).toISOString().replace("T", " ").replace("Z", "");
    cursorId = last.id;
    if (res.rows.length < DOC_BATCH) return;
  }
}

async function* claimBatches(companyId: string, from: string, to: string): AsyncGenerator<FafPurchaseRow[]> {
  let cursorDate = "-infinity";
  let cursorId = NIL_UUID;
  for (;;) {
    const res = await pool.query(
      `SELECT i.id, i.claim_id, i.expense_date, to_char(i.expense_date, 'YYYY-MM-DD') AS d,
              i.description, i.category, i.merchant_name, i.amount, i.vat_amount
         FROM expense_claim_items i
         JOIN expense_claims c ON c.id = i.claim_id
        WHERE c.company_id = $1 AND c.status IN ('approved', 'paid')
          AND i.expense_date >= $2::date AND i.expense_date < ($3::date + 1)
          AND (i.expense_date, i.id) > ($4::timestamp, $5::uuid)
        ORDER BY i.expense_date, i.id
        LIMIT ${DOC_BATCH}`,
      [companyId, from, to, cursorDate, cursorId]
    );
    if (res.rows.length === 0) return;
    const rows: FafPurchaseRow[] = res.rows.map((r: any) => {
      const value = num(r.amount);
      // Entertainment VAT is blocked input tax (Art. 53) and excluded from the return, so it
      // is excluded here too; the FAF then ties to Box 9.
      const blocked = String(r.category ?? "").toLowerCase().includes("entertain");
      const vat = blocked ? 0 : num(r.vat_amount);
      return {
        supplierName: r.merchant_name ?? "",
        supplierTrn: null,
        invoiceDate: r.d,
        invoiceNumber: `CLAIM-${String(r.claim_id).slice(0, 8)}`,
        permitNumber: null,
        lineNumber: 1,
        description: r.description ?? r.category ?? "Expense claim",
        valueAed: round2(value),
        vatAed: round2(vat),
        taxCode: fafPurchaseTaxCode({ reverseCharge: false, isImport: false, vat }),
        fcyCode: null,
        valueFcy: null,
        vatFcy: null,
      };
    });
    yield rows;
    const last = res.rows[res.rows.length - 1];
    cursorDate = new Date(last.expense_date).toISOString().replace("T", " ").replace("Z", "");
    cursorId = last.id;
    if (res.rows.length < DOC_BATCH) return;
  }
}

async function* ledgerBatches(companyId: string, from: string, to: string): AsyncGenerator<FafGlRow[]> {
  let cCode = "";
  let cDate = "-infinity";
  let cEntry = NIL_UUID;
  let cLine = NIL_UUID;
  for (;;) {
    const res = await pool.query(
      `SELECT jl.id AS line_id, je.id AS entry_id, je.date, to_char(je.date, 'YYYY-MM-DD') AS d,
              a.code, a.name_en, COALESCE(NULLIF(jl.description, ''), je.memo, '') AS description,
              je.entry_number, je.source, je.source_id, jl.debit, jl.credit,
              COALESCE(inv.customer_name, vb.vendor_name, '') AS party
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
         LEFT JOIN invoices inv ON inv.id = je.source_id AND inv.company_id = je.company_id
         LEFT JOIN vendor_bills vb ON vb.id = je.source_id AND vb.company_id = je.company_id
        WHERE je.company_id = $1 AND je.status = 'posted'
          AND je.date >= $2::date AND je.date < ($3::date + 1)
          AND (a.code, je.date, je.id, jl.id) > ($4::text, $5::timestamp, $6::uuid, $7::uuid)
        ORDER BY a.code, je.date, je.id, jl.id
        LIMIT ${GL_BATCH}`,
      [companyId, from, to, cCode, cDate, cEntry, cLine]
    );
    if (res.rows.length === 0) return;
    yield res.rows.map((r: any) => ({
      transactionDate: r.d,
      accountId: r.code,
      accountName: r.name_en,
      description: r.description,
      name: r.party,
      transactionId: r.entry_number,
      sourceDocumentId: r.source_id ?? "",
      sourceType: r.source ?? "",
      debit: num(r.debit),
      credit: num(r.credit),
      balance: 0,
    }));
    const last = res.rows[res.rows.length - 1];
    cCode = last.code;
    cDate = new Date(last.date).toISOString().replace("T", " ").replace("Z", "");
    cEntry = last.entry_id;
    cLine = last.line_id;
    if (res.rows.length < GL_BATCH) return;
  }
}

export function createDbFafSource(companyId: string, from: string, to: string): FafDataSource {
  return {
    async *purchases() {
      yield* billBatches(companyId, from, to);
      yield* receiptBatches(companyId, from, to);
      yield* claimBatches(companyId, from, to);
    },
    supplies: () => supplyBatches(companyId, from, to),
    ledger: () => ledgerBatches(companyId, from, to),
    async openingBalances() {
      const res = await pool.query(
        `SELECT a.code, SUM(jl.debit - jl.credit) AS net
           FROM journal_lines jl
           JOIN journal_entries je ON je.id = jl.entry_id
           JOIN accounts a ON a.id = jl.account_id
          WHERE je.company_id = $1 AND je.status = 'posted' AND je.date < $2::date
          GROUP BY a.code`,
        [companyId, from]
      );
      return new Map(res.rows.map((r: any) => [r.code as string, round2(num(r.net))]));
    },
  };
}
