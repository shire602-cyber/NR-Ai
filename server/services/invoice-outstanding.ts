// ONE definition of "how much of this invoice is still owed":
//
//   outstanding = total - payments - credit notes   (document currency, never < 0)
//
// Credit notes are their own `invoices` rows (invoiceType = 'credit_note',
// negative total, originalInvoiceId = the invoice they reduce). A void or
// cancelled credit note no longer reduces anything. Every screen, report,
// reminder and payment guard that needs an outstanding amount goes through
// this module (pure maths here, database loaders and SQL fragments in
// invoice-outstanding.db.ts) so a credited invoice can never again look open.

import Decimal from "decimal.js";

/** Tolerance (half a fils) for "the credit covers the whole invoice". */
export const OUTSTANDING_TOLERANCE = 0.005;

type NumLike = number | string | null | undefined;

function dec(value: NumLike): Decimal {
  const n = Number(value);
  return Number.isFinite(n) ? new Decimal(n) : new Decimal(0);
}

export interface InvoiceBalance {
  total: number;
  /** Sum of payments recorded against the invoice (document currency). */
  paid: number;
  /** Sum of live (non-void) credit notes against the invoice, as a positive number. */
  credited: number;
  /** total - paid - credited, clamped at 0. */
  outstanding: number;
  /** The credit notes cover the whole invoice total. */
  isFullyCredited: boolean;
}

export function computeInvoiceBalance(input: {
  total: NumLike;
  paid?: NumLike;
  credited?: NumLike;
}): InvoiceBalance {
  const total = dec(input.total);
  const paid = dec(input.paid).abs();
  const credited = dec(input.credited).abs();
  const raw = total.minus(paid).minus(credited);
  const outstanding = raw.isNegative() ? new Decimal(0) : raw;
  return {
    total: total.toDecimalPlaces(2).toNumber(),
    paid: paid.toDecimalPlaces(2).toNumber(),
    credited: credited.toDecimalPlaces(2).toNumber(),
    outstanding: outstanding.toDecimalPlaces(2).toNumber(),
    isFullyCredited:
      credited.greaterThan(0) && total.greaterThan(0) && credited.gte(total.minus(OUTSTANDING_TOLERANCE)),
  };
}

type DateLike = Date | string;

/** UTC calendar day (YYYY-MM-DD) of a date or date string. */
function utcDay(value: DateLike): string {
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}

/**
 * The balance of a document AS OF a date: only payments and live credit notes
 * dated on or before that UTC day are counted, then the one shared arithmetic
 * (computeInvoiceBalance) is applied. Used by the FX revaluation and any report
 * "as of" a past date, so a document paid later still shows as open then.
 */
export function balanceAsOf(
  doc: {
    total: NumLike;
    payments: Array<{ amount: NumLike; date: DateLike }>;
    creditNotes: Array<{ total: NumLike; status?: string | null; date: DateLike }>;
  },
  asOf: Date
): InvoiceBalance {
  const day = utcDay(asOf);
  const onOrBefore = (d: DateLike) => utcDay(d) <= day;
  const paid = doc.payments
    .filter((p) => onOrBefore(p.date))
    .reduce((sum, p) => sum.plus(dec(p.amount).abs()), new Decimal(0));
  const credited = sumCreditNotes(doc.creditNotes.filter((cn) => onOrBefore(cn.date)));
  return computeInvoiceBalance({ total: doc.total, paid: paid.toNumber(), credited });
}

/** Statuses in which nothing is receivable yet or any more (never posted / cancelled). */
const NOT_RECEIVABLE_STATUSES = ["draft", "void", "cancelled"];

/**
 * The outstanding amount an invoice reports in API responses. Nothing is
 * receivable until an invoice is issued, so a draft, void or cancelled invoice
 * reports 0 whatever its lines add up to; a credit note is never a receivable.
 * Every endpoint that returns `outstandingAmount` goes through this.
 */
export function receivableOutstanding(
  invoice: { status?: string | null; invoiceType?: string | null },
  balance: { outstanding: number } | undefined
): number {
  if (!balance || invoice.invoiceType === "credit_note") return 0;
  if (NOT_RECEIVABLE_STATUSES.includes(String(invoice.status))) return 0;
  return balance.outstanding;
}

/** The balance fields every invoice response carries. */
export function invoiceBalanceFields(
  invoice: { status?: string | null; invoiceType?: string | null },
  balance: InvoiceBalance | undefined
) {
  if (invoice.invoiceType === "credit_note" || !balance) {
    return { outstandingAmount: 0, paidAmount: 0, creditedAmount: 0, isFullyCredited: false };
  }
  return {
    outstandingAmount: receivableOutstanding(invoice, balance),
    paidAmount: balance.paid,
    creditedAmount: balance.credited,
    isFullyCredited: balance.isFullyCredited,
  };
}

/** A credit note counts unless it has been voided or cancelled. */
export function isLiveCreditNote(cn: { status?: string | null }): boolean {
  return cn.status !== "void" && cn.status !== "cancelled";
}

/** Sum of the absolute totals of the live credit notes in `creditNotes`. */
export function sumCreditNotes(creditNotes: Array<{ total: NumLike; status?: string | null }>): number {
  return creditNotes
    .filter(isLiveCreditNote)
    .reduce((sum, cn) => sum.plus(dec(cn.total).abs()), new Decimal(0))
    .toDecimalPlaces(2)
    .toNumber();
}

export interface BalanceInvoiceRow {
  id: string;
  total: NumLike;
  status?: string | null;
  invoiceType?: string | null;
  originalInvoiceId?: string | null;
}

/**
 * Balances for a whole list of invoice rows (which MUST include the credit
 * notes) plus the payments, without touching the database. A credit note row
 * is not a receivable, so its own outstanding is 0.
 */
export function buildInvoiceBalances(
  rows: BalanceInvoiceRow[],
  payments: Array<{ invoiceId: string; amount: NumLike }>
): Map<string, InvoiceBalance> {
  const creditsByInvoice = new Map<string, Decimal>();
  for (const row of rows) {
    if (row.invoiceType !== "credit_note" || !row.originalInvoiceId || !isLiveCreditNote(row)) continue;
    creditsByInvoice.set(
      row.originalInvoiceId,
      (creditsByInvoice.get(row.originalInvoiceId) ?? new Decimal(0)).plus(dec(row.total).abs())
    );
  }
  const paidByInvoice = new Map<string, Decimal>();
  for (const p of payments) {
    paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) ?? new Decimal(0)).plus(dec(p.amount)));
  }
  const out = new Map<string, InvoiceBalance>();
  for (const row of rows) {
    if (row.invoiceType === "credit_note") {
      out.set(row.id, computeInvoiceBalance({ total: 0 }));
      continue;
    }
    out.set(
      row.id,
      computeInvoiceBalance({
        total: row.total,
        paid: (paidByInvoice.get(row.id) ?? new Decimal(0)).toNumber(),
        credited: (creditsByInvoice.get(row.id) ?? new Decimal(0)).toNumber(),
      })
    );
  }
  return out;
}

/** Statuses of an issued invoice that can still be owed money. */
export const OPEN_INVOICE_STATUSES = ["sent", "posted", "partial"] as const;

export interface OpenReceivable<T> {
  invoice: T;
  balance: InvoiceBalance;
  /** Outstanding converted to AED at the invoice's own booking rate. */
  outstandingBase: number;
}

/**
 * Issued invoices (not credit notes, drafts, void, cancelled, paid or credited)
 * with something still outstanding, with their balances. `invoices` MUST include
 * the credit notes so they can be netted off. Amounts are in document currency;
 * `outstandingBase` is the AED value for dashboards and totals.
 */
export function listOpenReceivables<
  T extends BalanceInvoiceRow & { exchangeRate?: NumLike }
>(invoices: T[], payments: Array<{ invoiceId: string; amount: NumLike }>): OpenReceivable<T>[] {
  const balances = buildInvoiceBalances(invoices, payments);
  const out: OpenReceivable<T>[] = [];
  for (const invoice of invoices) {
    if (invoice.invoiceType === "credit_note") continue;
    if (!(OPEN_INVOICE_STATUSES as readonly string[]).includes(String(invoice.status))) continue;
    const balance = balances.get(invoice.id);
    if (!balance || balance.outstanding <= OUTSTANDING_TOLERANCE) continue;
    const rate = Number(invoice.exchangeRate) > 0 ? Number(invoice.exchangeRate) : 1;
    out.push({
      invoice,
      balance,
      outstandingBase: new Decimal(balance.outstanding).times(rate).toDecimalPlaces(2).toNumber(),
    });
  }
  return out;
}
