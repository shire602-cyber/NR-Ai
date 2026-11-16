/**
 * The one settlement rule (D5c): what is still owed on an invoice / vendor bill.
 *
 * It mirrors exactly what posts to the A/R (1040) and A/P (2010) control accounts:
 *
 * Receivables (document currency)
 *   open = max(0, total − settled), settled =
 *     invoice_payments                       (Cr A/R at the invoice rate; any excess went to 2050)
 *   + issued credit-note invoices on it      (Cr A/R up to the open balance; excess went to 2055)
 *   + applied customer credits               (Dr 2055/2050, Cr A/R)
 *   + legacy `credit_notes` rows that were posted but never consolidated into a credit-note
 *     invoice (rows migrated by 0081 are counted once, through their invoice row).
 *   Credit-note documents themselves are never open. Credit that reduced A/R without settling
 *   an invoice (a posted credit-note invoice with no original) is an "unapplied credit".
 *
 * Payables (document currency)
 *   open = max(0, total − Σ bill_payments.amount) — payments, prepayment and vendor-credit
 *   applications, and their negative reversal rows. A vendor debit note debits A/P in full when
 *   it is raised, so its unapplied remainder (total − applications) is an "unapplied credit".
 *
 * Base currency: open × the document's booking rate, rounded to fils per document.
 *
 * Every reader (aging, dashboard, invoice list, statements, portal, reminders, FX exposure,
 * cash forecast, bill summary) builds its SQL from these fragments so they cannot drift.
 * `asOf` is a SQL date expression (e.g. `$2::date`); settlements dated after it are ignored.
 */

export interface SettlementOptions {
  /** SQL expression yielding a date; settlements with a later (Gulf-local) date are ignored. */
  asOf?: string;
}

/** Gulf-local calendar date of a timestamp column (the kernel's date convention). */
export const localDateSql = (col: string) => `((${col} + interval '4 hours')::date)`;

const upTo = (col: string, opts: SettlementOptions) =>
  opts.asOf ? ` AND ${localDateSql(col)} <= ${opts.asOf}` : "";

/** Invoice statuses that never carry a receivable. */
export const NON_RECEIVABLE_INVOICE_STATUSES = ["draft", "void", "cancelled"] as const;
/** Bill statuses that never carry a payable (not yet approved / posted, or cancelled). */
export const NON_PAYABLE_BILL_STATUSES = [
  "draft",
  "pending",
  "void",
  "cancelled",
  "rejected",
] as const;

const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

/** SQL predicate: the invoice `i` is an issued document that can carry a receivable. */
export const receivableStatusSql = (i: string) =>
  `${i}.status NOT IN (${list(NON_RECEIVABLE_INVOICE_STATUSES)})`;

/** SQL predicate: the bill `b` is approved (posted) and can carry a payable. */
export const payableStatusSql = (b: string) =>
  `COALESCE(${b}.status, 'pending') NOT IN (${list(NON_PAYABLE_BILL_STATUSES)})`;

/** The settlement components of invoice alias `i`, each a numeric SQL expression. */
export function receivableSettlementPartsSql(i: string, opts: SettlementOptions = {}) {
  return {
    paid: `COALESCE((SELECT SUM(sp.amount) FROM invoice_payments sp
                      WHERE sp.invoice_id = ${i}.id${upTo("sp.date", opts)}), 0)`,
    credited: `(COALESCE((SELECT SUM(-scn.total) FROM invoices scn
                           WHERE scn.original_invoice_id = ${i}.id
                             AND scn.invoice_type = 'credit_note'
                             AND scn.status NOT IN (${list(NON_RECEIVABLE_INVOICE_STATUSES)})${upTo(
                               "scn.date",
                               opts
                             )}), 0)
              + COALESCE((SELECT SUM(ABS(slc.total)) FROM credit_notes slc
                           WHERE slc.invoice_id = ${i}.id AND slc.status = 'issued'
                             AND slc.journal_entry_id IS NOT NULL
                             AND NOT EXISTS (SELECT 1 FROM invoices sm
                                              WHERE sm.legacy_credit_note_id = slc.id)${upTo(
                                                "slc.date",
                                                opts
                                              )}), 0))`,
    applied: `COALESCE((SELECT SUM(sa.amount) FROM customer_credit_allocations sa
                         WHERE sa.invoice_id = ${i}.id AND sa.kind = 'apply'${upTo(
                           "sa.date",
                           opts
                         )}), 0)`,
  };
}

/** Total settled on invoice `i` (document currency). */
export function receivableSettledSql(i: string, opts: SettlementOptions = {}): string {
  const p = receivableSettlementPartsSql(i, opts);
  return `(${p.paid} + ${p.credited} + ${p.applied})`;
}

/** Open balance of invoice `i` in its own currency (0 for credit notes, never negative). */
export function receivableOpenSql(i: string, opts: SettlementOptions = {}): string {
  return `(CASE WHEN COALESCE(${i}.invoice_type, 'invoice') = 'credit_note' THEN 0
               ELSE GREATEST(${i}.total - ${receivableSettledSql(i, opts)}, 0) END)`;
}

/** Booking rate of a document alias (1 when missing). */
export const docRateSql = (alias: string) => `COALESCE(NULLIF(${alias}.exchange_rate, 0), 1)`;

/** Open balance of invoice `i` in base-currency fils (bigint), rounded per document. */
export function receivableOpenBaseFilsSql(i: string, opts: SettlementOptions = {}): string {
  return `ROUND(${receivableOpenSql(i, opts)} * ${docRateSql(i)} * 100)::bigint`;
}

/**
 * Base-currency fils of credit that reduced A/R without settling an invoice: posted credit-note
 * invoices with no original, and posted legacy credit notes with no invoice that were never
 * consolidated. `companyParam` is the SQL placeholder for the company id.
 */
export function unappliedReceivableCreditsFilsSql(
  companyParam: string,
  opts: SettlementOptions = {}
): string {
  return `(COALESCE((SELECT SUM(ROUND(ABS(u.total) * ${docRateSql("u")} * 100))::bigint FROM invoices u
                      WHERE u.company_id = ${companyParam} AND u.invoice_type = 'credit_note'
                        AND u.original_invoice_id IS NULL
                        AND u.status NOT IN (${list(NON_RECEIVABLE_INVOICE_STATUSES)})
                        AND EXISTS (SELECT 1 FROM journal_entries uj
                                     WHERE uj.company_id = u.company_id AND uj.source = 'invoice'
                                       AND uj.source_id = u.id AND uj.status = 'posted')${upTo(
                                         "u.date",
                                         opts
                                       )}), 0)
          + COALESCE((SELECT SUM(ROUND(ABS(l.total) * 100))::bigint FROM credit_notes l
                       WHERE l.company_id = ${companyParam} AND l.invoice_id IS NULL
                         AND l.status = 'issued' AND l.journal_entry_id IS NOT NULL
                         AND NOT EXISTS (SELECT 1 FROM invoices lm
                                          WHERE lm.legacy_credit_note_id = l.id)${upTo(
                                            "l.date",
                                            opts
                                          )}), 0))`;
}

/** Total settled on bill `b` (document currency): Σ bill_payments.amount (reversals are negative). */
export function payableSettledSql(b: string, opts: SettlementOptions = {}): string {
  return `COALESCE((SELECT SUM(sbp.amount) FROM bill_payments sbp
                     WHERE sbp.bill_id = ${b}.id${upTo("sbp.payment_date", opts)}), 0)`;
}

/** Open balance of bill `b` in its own currency (never negative). */
export function payableOpenSql(b: string, opts: SettlementOptions = {}): string {
  return `GREATEST(COALESCE(${b}.total_amount, 0) - ${payableSettledSql(b, opts)}, 0)`;
}

/** Open balance of bill `b` in base-currency fils (bigint), rounded per document. */
export function payableOpenBaseFilsSql(b: string, opts: SettlementOptions = {}): string {
  return `ROUND(${payableOpenSql(b, opts)} * ${docRateSql(b)} * 100)::bigint`;
}

/**
 * Unapplied remainder of vendor debit note `n` (document currency): total less its active
 * applications to bills (vendor-credit rows net of their reversal rows).
 */
export function vendorCreditUnappliedSql(n: string, opts: SettlementOptions = {}): string {
  return `GREATEST(COALESCE(${n}.total_amount, 0)
            - COALESCE((SELECT SUM(va.amount) FROM bill_payments va
                         WHERE va.source_document_id = ${n}.id
                           AND va.kind IN ('vendor_credit', 'reversal')${upTo(
                             "va.payment_date",
                             opts
                           )}), 0), 0)`;
}

/** Base-currency fils of unapplied vendor debit notes of company `companyParam`. */
export function unappliedPayableCreditsFilsSql(
  companyParam: string,
  opts: SettlementOptions = {}
): string {
  return `COALESCE((SELECT SUM(ROUND(${vendorCreditUnappliedSql("vn", opts)} * ${docRateSql("vn")} * 100))::bigint
                     FROM vendor_debit_notes vn
                    WHERE vn.company_id = ${companyParam} AND vn.status <> 'void'${upTo(
                      "vn.note_date",
                      opts
                    )}), 0)`;
}
