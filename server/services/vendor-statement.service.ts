// Vendor statement of account and payables ageing detail.
//
// Mirrors the customer statement (customer-statement.service.ts) from the payable side, in AED:
//   - a bill counts once it is on the ledger (approved, partial, paid; never pending, pending approval,
//     draft or void) and raises what we owe: it is the CREDIT column, valued at its booking rate;
//   - an approved vendor credit note lowers it (DEBIT column), at the credit's own rate;
//   - a payment lowers it (DEBIT), at the rate of the bill it settles so the payable clears exactly;
//     any realised exchange difference lives in the ledger, not on the statement;
//   - applying a credit to a bill moves nothing here: the credit already lowered the balance when it
//     was issued (it is in Accounts Payable from its own date).
// The closing balance therefore ties to account 2010 for the vendor. Ageing reuses the as-of SQL of
// aging-as-of.service.ts so a vendor's detail total equals the payables ageing line for that vendor.

import Decimal from "decimal.js";
import { toCalendarYmd } from "../utils/date";
import { asOfParams, billOutstandingAsOfSql, parseAgingAsOf, postedBillSql, unappliedCreditAsOfSql, type AgingAsOf } from "./aging-as-of.service";
import { emptyAging, parseStatementDay, type StatementAging, type StatementContact } from "./customer-statement.service";

export { parseStatementDay };

type NumLike = number | string | null | undefined;

export interface VendorStatementBillRow {
  id: string;
  number: string | null;
  date: string;
  dueDate?: string | null;
  total: NumLike;
  currency?: string | null;
  exchangeRate?: NumLike;
  status?: string | null;
}

export interface VendorStatementCreditRow {
  id: string;
  number: string;
  date: string;
  total: NumLike;
  currency?: string | null;
  exchangeRate?: NumLike;
  status?: string | null;
}

export interface VendorStatementPaymentRow {
  id: string;
  billId: string;
  amount: NumLike;
  date: string;
  reference?: string | null;
}

/** A realised exchange difference posted to A/P when a credit is applied to a bill booked at another rate. */
export interface VendorStatementFxRow {
  id: string;
  date: string;
  /** AED on the payable: positive raises what we owe, negative lowers it. */
  amount: NumLike;
}

export type VendorStatementLineType = "bill" | "vendor_credit" | "payment" | "vendor_credit_fx";

export interface VendorStatementLine {
  date: string;
  type: VendorStatementLineType;
  reference: string;
  currency: string;
  /** Amount in the document currency (positive). */
  documentAmount: number;
  /** AED that lowers what we owe the vendor (payment, credit note). */
  debit: number;
  /** AED that raises what we owe the vendor (bill). */
  credit: number;
  /** Running AED balance owed to the vendor after this line. */
  balance: number;
}

export interface VendorStatement {
  from: string;
  to: string;
  openingBalance: number;
  lines: VendorStatementLine[];
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
  aging: StatementAging;
}

/** Bill statuses that are not (yet, or no longer) in Accounts Payable. */
const NOT_ON_LEDGER_BILL = ["pending", "pending_approval", "draft", "void", "cancelled"];
const NOT_ON_LEDGER_CREDIT = ["draft", "void", "cancelled"];
const LINE_ORDER: Record<VendorStatementLineType, number> = { bill: 0, vendor_credit: 1, payment: 2, vendor_credit_fx: 3 };

const num = (v: NumLike): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const rateOf = (v: NumLike): number => (num(v) > 0 ? num(v) : 1);
const money = (d: Decimal): number => d.toDecimalPlaces(2).toNumber();
const dayNumber = (isoDay: string): number => Math.floor(Date.parse(`${isoDay}T00:00:00Z`) / 86_400_000);

function bucketFor(daysPastDue: number): keyof Omit<StatementAging, "total"> {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "days1to30";
  if (daysPastDue <= 60) return "days31to60";
  if (daysPastDue <= 90) return "days61to90";
  return "over90";
}

/** Whole-day bucket label used by the ageing detail rows. */
export function agingBucketLabel(daysPastDue: number): string {
  return bucketFor(daysPastDue);
}

export interface AgingRow {
  outstandingAed: number;
  /** YYYY-MM-DD; null for a vendor credit (always current). */
  dueDate: string | null;
}

/** Bucket open AED amounts by whole calendar days past due at the as-of day. */
export function agingFromRows(rows: AgingRow[], asOfYmd: string): StatementAging {
  const totals: Record<string, Decimal> = { current: new Decimal(0), days1to30: new Decimal(0), days31to60: new Decimal(0), days61to90: new Decimal(0), over90: new Decimal(0) };
  for (const r of rows) {
    const key = r.dueDate ? bucketFor(dayNumber(asOfYmd) - dayNumber(r.dueDate)) : "current";
    totals[key] = totals[key].plus(r.outstandingAed);
  }
  const total = Object.values(totals).reduce((s, d) => s.plus(d), new Decimal(0));
  return {
    current: money(totals.current),
    days1to30: money(totals.days1to30),
    days31to60: money(totals.days31to60),
    days61to90: money(totals.days61to90),
    over90: money(totals.over90),
    total: money(total),
  };
}

export function computeVendorStatement(input: {
  bills: VendorStatementBillRow[];
  credits: VendorStatementCreditRow[];
  payments: VendorStatementPaymentRow[];
  /** Exchange differences on credit applications (journal source vendor_credit_fx), so the statement ties to 2010. */
  fx?: VendorStatementFxRow[];
  /** Inclusive calendar days (YYYY-MM-DD). */
  from: string;
  to: string;
  aging?: StatementAging;
}): VendorStatement {
  const { from, to } = input;
  const ledgerBills = input.bills.filter((b) => !NOT_ON_LEDGER_BILL.includes(String(b.status ?? "pending")));
  const billById = new Map(ledgerBills.map((b) => [b.id, b]));

  interface Movement {
    date: string;
    type: VendorStatementLineType;
    reference: string;
    currency: string;
    documentAmount: number;
    signed: Decimal; // + raises what we owe
  }
  const movements: Movement[] = [];

  for (const b of ledgerBills) {
    movements.push({
      date: b.date.slice(0, 10),
      type: "bill",
      reference: b.number || "Bill",
      currency: b.currency || "AED",
      documentAmount: Math.abs(num(b.total)),
      signed: new Decimal(Math.abs(num(b.total))).times(rateOf(b.exchangeRate)),
    });
  }
  for (const c of input.credits) {
    if (NOT_ON_LEDGER_CREDIT.includes(String(c.status ?? "draft"))) continue;
    movements.push({
      date: c.date.slice(0, 10),
      type: "vendor_credit",
      reference: c.number,
      currency: c.currency || "AED",
      documentAmount: Math.abs(num(c.total)),
      signed: new Decimal(Math.abs(num(c.total))).times(rateOf(c.exchangeRate)).negated(),
    });
  }
  for (const p of input.payments) {
    const bill = billById.get(p.billId);
    if (!bill) continue;
    const amount = Math.abs(num(p.amount));
    movements.push({
      date: p.date.slice(0, 10),
      type: "payment",
      reference: p.reference || `Payment ${bill.number ?? ""}`.trim(),
      currency: bill.currency || "AED",
      documentAmount: amount,
      signed: new Decimal(amount).times(rateOf(bill.exchangeRate)).negated(),
    });
  }

  for (const f of input.fx ?? []) {
    const signed = new Decimal(num(f.amount));
    if (signed.isZero()) continue;
    movements.push({
      date: f.date.slice(0, 10),
      type: "vendor_credit_fx",
      reference: "Exchange difference",
      currency: "AED",
      documentAmount: Math.abs(num(f.amount)),
      signed,
    });
  }

  movements.sort(
    (a, b) => a.date.localeCompare(b.date) || LINE_ORDER[a.type] - LINE_ORDER[b.type] || a.reference.localeCompare(b.reference)
  );

  let opening = new Decimal(0);
  for (const m of movements) if (m.date < from) opening = opening.plus(m.signed);

  let running = opening;
  let debits = new Decimal(0);
  let credits = new Decimal(0);
  const lines: VendorStatementLine[] = [];
  for (const m of movements) {
    if (m.date < from || m.date > to) continue;
    running = running.plus(m.signed);
    const credit = m.signed.greaterThan(0) ? m.signed : new Decimal(0);
    const debit = m.signed.lessThan(0) ? m.signed.negated() : new Decimal(0);
    debits = debits.plus(debit);
    credits = credits.plus(credit);
    lines.push({
      date: m.date,
      type: m.type,
      reference: m.reference,
      currency: m.currency,
      documentAmount: m.documentAmount,
      debit: money(debit),
      credit: money(credit),
      balance: money(running),
    });
  }

  return {
    from,
    to,
    openingBalance: money(opening),
    lines,
    totalDebits: money(debits),
    totalCredits: money(credits),
    closingBalance: money(running),
    aging: input.aging ?? emptyAging(),
  };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/** Bills (and credits) of one vendor contact; a document with no link matches on its name snapshot. */
const BILL_OWNER = `(b.vendor_id = $2 OR (b.vendor_id IS NULL AND lower(btrim(b.vendor_name)) = lower(btrim($3))))`;
const CREDIT_OWNER = `(c.vendor_id = $2 OR (c.vendor_id IS NULL AND lower(btrim(c.vendor_name)) = lower(btrim($3))))`;

export interface AgeingDetailRow {
  type: "bill" | "credit";
  billId: string | null;
  creditId: string | null;
  number: string | null;
  billDate: string;
  dueDate: string | null;
  currency: string;
  outstanding: number;
  outstandingAed: number;
  daysPastDue: number;
  bucket: string;
}

export interface AgeingDetailVendor {
  vendorId: string | null;
  name: string;
  rows: AgeingDetailRow[];
  totals: StatementAging;
}

export interface AgeingDetail {
  asOf: string;
  vendors: AgeingDetailVendor[];
  totals: StatementAging;
}

/**
 * Open bills and unapplied credits at the as-of day, one row each, in the same population as
 * payableAgingAsOfSql (pending and pending-approval bills are not payables yet). Params: asOfParams(),
 * then an optional vendor contact id ($4) and its name ($5).
 */
export function payablesDetailSql(withVendor: boolean): string {
  const owner = (a: string) =>
    withVendor ? `AND (${a}.vendor_id = $4 OR (${a}.vendor_id IS NULL AND lower(btrim(${a}.vendor_name)) = lower(btrim($5))))` : "";
  return `
    SELECT 'bill' AS type, b.id::text AS bill_id, NULL::text AS credit_id, b.vendor_id::text AS vendor_id,
           COALESCE(NULLIF(TRIM(b.vendor_name), ''), 'Unknown Vendor') AS name, b.bill_number AS number,
           to_char(b.bill_date, 'YYYY-MM-DD') AS bill_date, to_char(b.due_date, 'YYYY-MM-DD') AS due_date,
           COALESCE(b.currency, 'AED') AS currency,
           ${billOutstandingAsOfSql("b")}::float8 AS outstanding,
           (${billOutstandingAsOfSql("b")} * COALESCE(NULLIF(b.exchange_rate, 0), 1))::float8 AS outstanding_aed
      FROM vendor_bills b
     WHERE b.company_id = $1
       AND ${postedBillSql("b")}
       AND b.bill_date <= $3::timestamp ${owner("b")}
    UNION ALL
    SELECT 'credit', NULL, c.id::text, c.vendor_id::text,
           COALESCE(NULLIF(TRIM(c.vendor_name), ''), 'Unknown Vendor'), c.number,
           to_char(c.date, 'YYYY-MM-DD'), NULL, COALESCE(c.currency, 'AED'),
           (${unappliedCreditAsOfSql("c")})::float8,
           (${unappliedCreditAsOfSql("c")} * COALESCE(NULLIF(c.exchange_rate, 0), 1))::float8
      FROM vendor_credit_notes c
     WHERE c.company_id = $1 AND c.status = 'approved' AND c.date::date <= $2::date ${owner("c")}`;
}

function buildDetail(rows: any[], asOfYmd: string, contactByName: Map<string, string>): AgeingDetail {
  const byVendor = new Map<string, AgeingDetailVendor>();
  for (const r of rows) {
    const outstandingAed = Number(r.outstanding_aed);
    if (!outstandingAed) continue;
    // An unlinked document groups with the one contact its name matches (the statement's rule), not apart from it.
    const linked: string | null = r.vendor_id ?? contactByName.get(String(r.name).trim().toLowerCase()) ?? null;
    if (linked && !r.vendor_id) r.vendor_id = linked;
    const key = linked ?? `name:${String(r.name).trim().toLowerCase()}`;
    const dueDate: string | null = r.due_date ?? null;
    const daysPastDue = dueDate ? dayNumber(asOfYmd) - dayNumber(dueDate) : 0;
    const row: AgeingDetailRow = {
      type: r.type,
      billId: r.bill_id,
      creditId: r.credit_id,
      number: r.number,
      billDate: r.bill_date,
      dueDate,
      currency: r.currency,
      outstanding: Number(r.outstanding),
      outstandingAed: money(new Decimal(outstandingAed)),
      daysPastDue,
      bucket: dueDate ? bucketFor(daysPastDue) : "current",
    };
    const entry: AgeingDetailVendor = byVendor.get(key) ?? { vendorId: r.vendor_id ?? null, name: r.name, rows: [], totals: emptyAging() };
    entry.rows.push(row);
    byVendor.set(key, entry);
  }
  const vendors = [...byVendor.values()]
    .map((v) => ({
      ...v,
      rows: [...v.rows].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || String(a.number).localeCompare(String(b.number))),
      totals: agingFromRows(v.rows.map((r) => ({ outstandingAed: r.outstandingAed, dueDate: r.dueDate })), asOfYmd),
    }))
    .sort((a, b) => b.totals.total - a.totals.total || a.name.localeCompare(b.name));
  return {
    asOf: asOfYmd,
    vendors,
    totals: agingFromRows(vendors.flatMap((v) => v.rows.map((r) => ({ outstandingAed: r.outstandingAed, dueDate: r.dueDate }))), asOfYmd),
  };
}

export async function buildAgeingDetail(args: { companyId: string; asOf: AgingAsOf; vendorId?: string | null }): Promise<AgeingDetail | null> {
  const { pool } = await import("../db");
  let contact: { id: string; name: string } | undefined;
  if (args.vendorId) {
    const found = await pool.query(`SELECT id::text AS id, name FROM customer_contacts WHERE id = $1 AND company_id = $2`, [args.vendorId, args.companyId]);
    contact = found.rows[0];
    if (!contact) return null;
  }
  const params = contact ? [...asOfParams(args.companyId, args.asOf), contact.id, contact.name] : asOfParams(args.companyId, args.asOf);
  const res = await pool.query(payablesDetailSql(!!contact), params);
  const contacts = await pool.query(`SELECT id::text AS id, lower(btrim(name)) AS norm FROM customer_contacts WHERE company_id = $1`, [args.companyId]);
  const counts = new Map<string, number>();
  for (const c of contacts.rows) counts.set(c.norm, (counts.get(c.norm) ?? 0) + 1);
  const contactByName = new Map<string, string>();
  for (const c of contacts.rows) if (counts.get(c.norm) === 1) contactByName.set(c.norm, c.id);
  return buildDetail(res.rows, args.asOf.ymd, contactByName);
}

export async function buildVendorStatement(args: {
  companyId: string;
  contactId: string;
  from: string;
  to: string;
}): Promise<(VendorStatement & { contact: StatementContact }) | null> {
  const { pool } = await import("../db");
  const contactResult = await pool.query(
    `SELECT id::text AS id, name, name_ar AS "nameAr", email, trn_number AS "trnNumber", address
       FROM customer_contacts WHERE id = $1 AND company_id = $2`,
    [args.contactId, args.companyId]
  );
  const contact: StatementContact | undefined = contactResult.rows[0];
  if (!contact) return null;

  const billResult = await pool.query(
    `SELECT b.id::text AS id, b.bill_number AS number, to_char(b.bill_date, 'YYYY-MM-DD') AS date,
            to_char(b.due_date, 'YYYY-MM-DD') AS "dueDate", b.total_amount::float8 AS total, b.currency,
            b.exchange_rate::float8 AS "exchangeRate", b.status
       FROM vendor_bills b WHERE b.company_id = $1 AND ${BILL_OWNER}`,
    [args.companyId, contact.id, contact.name]
  );
  const billIds = billResult.rows.map((r: any) => r.id);
  const paymentResult = billIds.length
    ? await pool.query(
        `SELECT id::text AS id, bill_id::text AS "billId", amount::float8 AS amount,
                to_char(payment_date, 'YYYY-MM-DD') AS date, reference
           FROM bill_payments WHERE bill_id = ANY($1::uuid[])`,
        [billIds]
      )
    : { rows: [] };
  const creditResult = await pool.query(
    `SELECT c.id::text AS id, c.number, to_char(c."date", 'YYYY-MM-DD') AS date, c.total::float8 AS total,
            c.currency, c.exchange_rate::float8 AS "exchangeRate", c.status
       FROM vendor_credit_notes c WHERE c.company_id = $1 AND ${CREDIT_OWNER}`,
    [args.companyId, contact.id, contact.name]
  );

  // Realised exchange differences on applying credits to this vendor's bills: they sit on 2010, so they sit here.
  const fxResult = await pool.query(
    `SELECT je.id::text AS id, to_char(je.date, 'YYYY-MM-DD') AS date,
            COALESCE(SUM(jl.credit - jl.debit), 0)::float8 AS amount
       FROM vendor_credit_applications a
       JOIN vendor_bills b ON b.id = a.bill_id
       JOIN journal_entries je ON je.company_id = a.company_id AND je.source = 'vendor_credit_fx' AND je.source_id = a.id AND je.status = 'posted'
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN accounts acc ON acc.id = jl.account_id AND acc.code = '2010'
      WHERE a.company_id = $1 AND ${BILL_OWNER}
      GROUP BY je.id, je.date`,
    [args.companyId, contact.id, contact.name]
  );

  // Ageing at the end of the period: the as-of day is `to` (a future `to` is read as today's books).
  const today = toCalendarYmd(new Date());
  const parsed = parseAgingAsOf(args.to > today ? today : args.to);
  const asOf: AgingAsOf | null = parsed.ok ? parsed.asOf : null;
  let aging: StatementAging | undefined;
  if (asOf) {
    const detail = await buildAgeingDetail({ companyId: args.companyId, asOf, vendorId: contact.id });
    aging = detail?.totals;
  }

  return {
    ...computeVendorStatement({
      bills: billResult.rows,
      credits: creditResult.rows,
      payments: paymentResult.rows,
      fx: fxResult.rows,
      from: args.from,
      to: args.to,
      aging,
    }),
    contact,
  };
}
