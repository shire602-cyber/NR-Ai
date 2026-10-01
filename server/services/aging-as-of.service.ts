// Aging reports "as of" a past calendar day (receivables from invoices, payables from vendor bills).
//
// The default aging report (no asOf) is computed to the moment of the request and is not touched by this
// module. With `asOf=YYYY-MM-DD` the books are read as they stood at the END of that UAE calendar day:
//
//  * a document counts when it was dated on or before the day (invoices: invoices.date, bills: bill_date);
//  * a payment counts when its PAYMENT date (invoice_payments.date / bill_payments.payment_date, never
//    created_at) is on or before the day; a credit note when its own date is;
//  * a draft invoice never counts (it was not issued);
//  * a void / cancelled invoice or credit note is judged by the date-based void rule of the VAT engine
//    (vat-void-history.service.ts / vat-document-effect.ts): its void date is the date of its reversal
//    journal entry. Voided on or before the day: it no longer counts. Voided AFTER the day: at that day
//    it still stood, so it counts (a void with no reversal entry was never posted and never counts).
//    Vendor bills have no void date on the ledger, so a void / cancelled bill is left out of every as-of;
//  * buckets are whole calendar days from the due date to the as-of day: due on or after the day is
//    "current", 1-30, 31-60, 61-90 days past due, over 90. (The default report compares instants and
//    shows a document due earlier today as 1-30; as-of reads day to day, so due that day is current.)
//
// Calendar days are UAE days (UTC+4, utils/date.ts). Timestamps in the ledger tables are `timestamp`
// without zone, holding UTC instants (date-only inputs are UTC midnight), so the end of the UAE day is
// compared as a UTC wall-clock value.

import { uaeDayEnd, uaeYmdParts } from "../utils/date";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type AgingAsOf = { ymd: string; dayEnd: string };
export type ParsedAsOf =
  | { ok: true; asOf: AgingAsOf | null }
  | { ok: false; code: "INVALID_AS_OF" | "AS_OF_IN_FUTURE"; message: string };

const ymdOfInstant = (d: Date): string => {
  const { year, month, day } = uaeYmdParts(d);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/** Validate the `asOf` query value. Absent / blank = null (the default, up-to-the-moment report). */
export function parseAgingAsOf(raw: unknown, now: Date = new Date()): ParsedAsOf {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, asOf: null };
  }
  const text = typeof raw === "string" ? raw.trim() : "";
  const probe = YMD.test(text) ? new Date(`${text}T00:00:00Z`) : null;
  if (!probe || Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== text) {
    return { ok: false, code: "INVALID_AS_OF", message: "asOf must be a calendar date (YYYY-MM-DD)." };
  }
  if (text > ymdOfInstant(now)) {
    return { ok: false, code: "AS_OF_IN_FUTURE", message: `asOf ${text} is in the future. Use today or an earlier day.` };
  }
  return { ok: true, asOf: { ymd: text, dayEnd: uaeDayEnd(text).toISOString().slice(0, 23) } };
}

/** SQL parameters of every query below, after companyId ($1): the as-of day ($2) and its end ($3). */
export const asOfParams = (companyId: string, asOf: AgingAsOf): unknown[] => [companyId, asOf.ymd, asOf.dayEnd];

/** True when document `a` (invoice or credit note) was void / cancelled AFTER the as-of day ($2). */
const voidedAfterSql = (a: string) =>
  `EXISTS (
     SELECT 1 FROM journal_entries je_v JOIN journal_entries orig_v ON orig_v.id = je_v.reversed_entry_id
      WHERE je_v.company_id = ${a}.company_id AND je_v.source = 'invoice' AND je_v.source_id = ${a}.id
        AND je_v.status = 'posted'
        AND orig_v.company_id = ${a}.company_id AND orig_v.source = 'invoice' AND orig_v.source_id = ${a}.id
     HAVING MIN(je_v.date::date) > $2::date)`;

/** The document stood at the as-of day: not void/cancelled, or voided only after it. */
const standingSql = (a: string) => `(${a}.status NOT IN ('void', 'cancelled') OR ${voidedAfterSql(a)})`;

/** Open balance of invoice `i` at the as-of day, document currency (never below 0). */
export const invoiceOutstandingAsOfSql = (a: string) =>
  `GREATEST(${a}.total
     - COALESCE((SELECT SUM(ip_a.amount) FROM invoice_payments ip_a
                  WHERE ip_a.invoice_id = ${a}.id AND ip_a.date <= $3::timestamp), 0)
     - COALESCE((SELECT SUM(ABS(cn_a.total)) FROM invoices cn_a
                  WHERE cn_a.original_invoice_id = ${a}.id AND cn_a.invoice_type = 'credit_note'
                    AND cn_a.date <= $3::timestamp AND ${standingSql("cn_a")}), 0), 0)`;

/**
 * Open balance of bill `b` at the as-of day, document currency (never below 0). Cash payments count from
 * their payment_date. A vendor credit applied to the bill counts from the LATER of the credit note's date and
 * the bill's date (never from applied_at, which is just when someone clicked): the ledger carries the credit
 * from its own date, so applying it later does not move any earlier as-of figure.
 */
export const billOutstandingAsOfSql = (b: string) =>
  `GREATEST(COALESCE(${b}.total_amount, 0) - (
     CASE WHEN EXISTS (SELECT 1 FROM bill_payments bp_x WHERE bp_x.bill_id = ${b}.id)
               OR EXISTS (SELECT 1 FROM vendor_credit_applications vca_x WHERE vca_x.bill_id = ${b}.id)
          THEN COALESCE((SELECT SUM(bp_a.amount) FROM bill_payments bp_a
                          WHERE bp_a.bill_id = ${b}.id AND bp_a.payment_date <= $3::timestamp), 0)
             + COALESCE((SELECT SUM(vca_a.amount) FROM vendor_credit_applications vca_a
                           JOIN vendor_credit_notes vcn_a ON vcn_a.id = vca_a.credit_note_id
                          WHERE vca_a.bill_id = ${b}.id
                            AND GREATEST(vcn_a.date::date, ${b}.bill_date::date) <= $2::date), 0)
          -- legacy bill settled without payment rows: its paid amount counts from the day it was settled
          ELSE CASE WHEN COALESCE(${b}.paid_at, ${b}.created_at) <= $3::timestamp
                    THEN COALESCE(${b}.amount_paid, 0) ELSE 0 END
     END), 0)`;

/**
 * Approved vendor credits not (or not fully) applied to a bill at the as-of day, as NEGATIVE amounts
 * (document currency): the credit total less the applications that stood by then. They are part of
 * accounts payable in the ledger from the credit's date, so payables ageing shows them (current bucket)
 * and its total equals A/P. Voided and draft credits are not in the ledger and are left out.
 */
export const unappliedCreditAsOfSql = (c: string) =>
  `-(${c}.total - COALESCE((SELECT SUM(vca_c.amount) FROM vendor_credit_applications vca_c
                              JOIN vendor_bills vb_c ON vb_c.id = vca_c.bill_id
                             WHERE vca_c.credit_note_id = ${c}.id
                               AND GREATEST(${c}.date::date, vb_c.bill_date::date) <= $2::date), 0))`;

const DAYS = (n: number) => `INTERVAL '${n} days'`;

/** The aggregate columns shared by both reports; `due` is a date expression, `amt` the amount to add up. */
const bucketColumns = (due: string, amt: string) => {
  const ref = "$2::date";
  return `
    COALESCE(SUM(${amt}) FILTER (WHERE ${due} IS NULL OR ${due} >= ${ref}), 0)::float AS current_balance,
    COALESCE(SUM(${amt}) FILTER (WHERE ${due} < ${ref} AND ${due} >= ${ref} - ${DAYS(30)}), 0)::float AS days_30,
    COALESCE(SUM(${amt}) FILTER (WHERE ${due} < ${ref} - ${DAYS(30)} AND ${due} >= ${ref} - ${DAYS(60)}), 0)::float AS days_60,
    COALESCE(SUM(${amt}) FILTER (WHERE ${due} < ${ref} - ${DAYS(60)} AND ${due} >= ${ref} - ${DAYS(90)}), 0)::float AS days_90,
    COALESCE(SUM(${amt}) FILTER (WHERE ${due} < ${ref} - ${DAYS(90)}), 0)::float AS over_90,
    COALESCE(SUM(${amt}), 0)::float AS total`;
};

/** Receivable aging by customer at the as-of day. Params: asOfParams(). Same columns as the default query. */
export function receivableAgingAsOfSql(): string {
  return `WITH open_invoices AS (
    SELECT
      COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Unknown Customer') AS name,
      ${invoiceOutstandingAsOfSql("i")} * COALESCE(NULLIF(i.exchange_rate, 0), 1) AS open_balance_aed,
      COALESCE(i.due_date, i.date + INTERVAL '30 days')::date AS due_date
    FROM invoices i
    WHERE i.company_id = $1
      AND i.invoice_type <> 'credit_note'
      AND i.status <> 'draft'
      AND i.date <= $3::timestamp
      AND ${standingSql("i")}
  )
  SELECT name, ${bucketColumns("due_date", "open_balance_aed")}
  FROM open_invoices
  WHERE open_balance_aed > 0
  GROUP BY name
  ORDER BY total DESC, name ASC`;
}

/** Payable aging by vendor at the as-of day. Params: asOfParams(). Same columns as the default query. */
export function payableAgingAsOfSql(): string {
  return `WITH open_bills AS (
    SELECT
      COALESCE(NULLIF(TRIM(b.vendor_name), ''), 'Unknown Vendor') AS name,
      ${billOutstandingAsOfSql("b")} * COALESCE(NULLIF(b.exchange_rate, 0), 1) AS open_balance_aed,
      b.due_date::date AS due_date
    FROM vendor_bills b
    WHERE b.company_id = $1
      AND COALESCE(b.status, 'pending') NOT IN ('void', 'cancelled')
      AND b.bill_date <= $3::timestamp
    UNION ALL
    SELECT
      COALESCE(NULLIF(TRIM(c.vendor_name), ''), 'Unknown Vendor') AS name,
      ${unappliedCreditAsOfSql("c")} * COALESCE(NULLIF(c.exchange_rate, 0), 1) AS open_balance_aed,
      NULL::date AS due_date
    FROM vendor_credit_notes c
    WHERE c.company_id = $1 AND c.status = 'approved' AND c.date::date <= $2::date
  )
  SELECT name, ${bucketColumns("due_date", "open_balance_aed")}
  FROM open_bills
  WHERE open_balance_aed <> 0
  GROUP BY name
  ORDER BY total DESC, name ASC`;
}

/** Company-level payable buckets with bill counts (the Bill Pay aging card), as of the day; document currency. */
export function billAgingBucketsAsOfSql(): string {
  const due = "due_date";
  const ref = "$2::date";
  // Credits add to the amount (negative) but are not bills: they are left out of the counts.
  const c = (cond: string) => `COALESCE(SUM(open_amount) FILTER (WHERE ${cond}), 0) AS %A, COUNT(*) FILTER (WHERE (${cond}) AND NOT is_credit) AS %C`;
  const cur = `${due} IS NULL OR ${due} >= ${ref}`;
  const d30 = `${due} < ${ref} AND ${due} >= ${ref} - ${DAYS(30)}`;
  const d60 = `${due} < ${ref} - ${DAYS(30)} AND ${due} >= ${ref} - ${DAYS(60)}`;
  const d90 = `${due} < ${ref} - ${DAYS(60)} AND ${due} >= ${ref} - ${DAYS(90)}`;
  const d90p = `${due} < ${ref} - ${DAYS(90)}`;
  const col = (cond: string, name: string) => c(cond).replace("%A", `${name}_amount`).replace("%C", `${name}_count`);
  return `WITH open_bills AS (
    SELECT ${billOutstandingAsOfSql("b")} AS open_amount, b.due_date::date AS due_date, false AS is_credit
      FROM vendor_bills b
     WHERE b.company_id = $1 AND COALESCE(b.status, 'pending') NOT IN ('void', 'cancelled')
       AND b.bill_date <= $3::timestamp
    UNION ALL
    SELECT ${unappliedCreditAsOfSql("c")} AS open_amount, NULL::date AS due_date, true AS is_credit
      FROM vendor_credit_notes c
     WHERE c.company_id = $1 AND c.status = 'approved' AND c.date::date <= $2::date
  )
  SELECT ${col(cur, "current")}, ${col(d30, "days_1_30")}, ${col(d60, "days_31_60")},
         ${col(d90, "days_61_90")}, ${col(d90p, "days_90_plus")}
    FROM open_bills WHERE open_amount <> 0`;
}
