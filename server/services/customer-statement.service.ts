// Customer statement of account.
//
// Receivable semantics are the shared ones (invoice-outstanding.ts): a credit
// note is an `invoices` row (invoiceType 'credit_note', negative total) that
// reduces its original invoice; draft, void and cancelled documents never
// count; payments reduce the invoice they were recorded against. Ageing
// reuses balanceAsOf() so it agrees with every other "as of" report.
//
// Everything is reported in AED using the stored base amounts (invoice
// baseCurrencyAmount, falling back to total x booking rate); each line also
// carries its document currency and amount. Payments are valued at their
// invoice's booking rate so the receivable clears exactly; any realised FX
// difference lives in the ledger, not on the statement.

import Decimal from "decimal.js";
import { balanceAsOf } from "./invoice-outstanding";

type NumLike = number | string | null | undefined;
type DateLike = Date | string;

export interface StatementInvoiceRow {
  id: string;
  number: string;
  date: DateLike;
  dueDate?: DateLike | null;
  total: NumLike;
  currency?: string | null;
  exchangeRate?: NumLike;
  baseCurrencyAmount?: NumLike;
  status?: string | null;
  invoiceType?: string | null;
  originalInvoiceId?: string | null;
}

export interface StatementPaymentRow {
  id: string;
  invoiceId: string;
  amount: NumLike;
  date: DateLike;
  reference?: string | null;
  method?: string | null;
}

export interface StatementRefundRow {
  id: string;
  amount: NumLike;
  date: DateLike;
  currency?: string | null;
  exchangeRate?: NumLike;
  reference?: string | null;
}

export type StatementLineType = "invoice" | "credit_note" | "payment" | "refund";

export interface StatementLine {
  date: string;
  type: StatementLineType;
  reference: string;
  currency: string;
  /** Amount in the document currency (positive). */
  documentAmount: number;
  /** AED amount that increases what the customer owes. */
  debit: number;
  /** AED amount that decreases what the customer owes. */
  credit: number;
  /** Running AED balance after this line. */
  balance: number;
}

export interface StatementAging {
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  over90: number;
  total: number;
}

export interface CustomerStatement {
  from: string;
  to: string;
  openingBalance: number;
  lines: StatementLine[];
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
  aging: StatementAging;
  /**
   * Phase 8 D1: advances and deposits received and not yet applied, shown as a MEMO. They are not a credit on
   * the receivable balance (the advance invoice is already paid and nets to zero there).
   */
  unappliedAdvances?: StatementAdvanceMemo[];
  /** AED credit the customer holds from overpayments (refundable from the customer's page). */
  creditBalance?: number;
  /** Refunds paid out of that credit in the period's range (memo; not on the receivable). */
  creditRefunds?: Array<{ date: string; amount: number; reference: string | null }>;
}

export interface StatementAdvanceMemo {
  number: string;
  kind: string;
  invoiceNumber: string;
  date: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  /** Net still available to apply or refund, and the same with VAT. */
  availableNet: number;
  availableGross: number;
}

const NOT_ISSUED = ["draft", "void", "cancelled"];
const LINE_ORDER: Record<StatementLineType, number> = { invoice: 0, credit_note: 1, refund: 2, payment: 3 };

const num = (v: NumLike): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const rateOf = (v: NumLike): number => (num(v) > 0 ? num(v) : 1);
const day = (v: DateLike): string => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
const money = (d: Decimal): number => d.toDecimalPlaces(2).toNumber();
const dayNumber = (isoDay: string): number => Math.floor(Date.parse(`${isoDay}T00:00:00Z`) / 86_400_000);

/** AED value of an invoice or credit note row (always positive). */
function baseAmount(row: StatementInvoiceRow): Decimal {
  const stored = new Decimal(Math.abs(num(row.baseCurrencyAmount)));
  if (stored.greaterThan(0)) return stored;
  return new Decimal(Math.abs(num(row.total))).times(rateOf(row.exchangeRate));
}

export function emptyAging(): StatementAging {
  return { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0 };
}

function bucketFor(daysPastDue: number): string {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "days1to30";
  if (daysPastDue <= 60) return "days31to60";
  if (daysPastDue <= 90) return "days61to90";
  return "over90";
}

export function computeCustomerStatement(input: {
  /** The customer's invoices AND credit notes (any status; filtered here). */
  invoices: StatementInvoiceRow[];
  payments: StatementPaymentRow[];
  refunds: StatementRefundRow[];
  /** Inclusive UTC calendar days (YYYY-MM-DD). */
  from: string;
  to: string;
}): CustomerStatement {
  const { from, to } = input;
  const issued = input.invoices.filter((i) => !NOT_ISSUED.includes(String(i.status)));
  const byId = new Map(issued.map((i) => [i.id, i]));

  interface Movement {
    date: string;
    type: StatementLineType;
    reference: string;
    currency: string;
    documentAmount: number;
    signed: Decimal; // + increases receivable
  }
  const movements: Movement[] = [];

  for (const i of issued) {
    const isCredit = i.invoiceType === "credit_note";
    const base = baseAmount(i);
    movements.push({
      date: day(i.date),
      type: isCredit ? "credit_note" : "invoice",
      reference: i.number,
      currency: i.currency || "AED",
      documentAmount: Math.abs(num(i.total)),
      signed: isCredit ? base.negated() : base,
    });
  }
  for (const p of input.payments) {
    const inv = byId.get(p.invoiceId);
    if (!inv || inv.invoiceType === "credit_note") continue;
    const amount = Math.abs(num(p.amount));
    movements.push({
      date: day(p.date),
      type: "payment",
      reference: p.reference || `Payment ${inv.number}`,
      currency: inv.currency || "AED",
      documentAmount: amount,
      signed: new Decimal(amount).times(rateOf(inv.exchangeRate)).negated(),
    });
  }
  for (const r of input.refunds) {
    const amount = Math.abs(num(r.amount));
    movements.push({
      date: day(r.date),
      type: "refund",
      reference: r.reference || "Refund",
      currency: r.currency || "AED",
      documentAmount: amount,
      signed: new Decimal(amount).times(rateOf(r.exchangeRate)),
    });
  }

  movements.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      LINE_ORDER[a.type] - LINE_ORDER[b.type] ||
      a.reference.localeCompare(b.reference)
  );

  let opening = new Decimal(0);
  for (const m of movements) if (m.date < from) opening = opening.plus(m.signed);

  let running = opening;
  let debits = new Decimal(0);
  let credits = new Decimal(0);
  const lines: StatementLine[] = [];
  for (const m of movements) {
    if (m.date < from || m.date > to) continue;
    running = running.plus(m.signed);
    const debit = m.signed.greaterThan(0) ? m.signed : new Decimal(0);
    const credit = m.signed.lessThan(0) ? m.signed.negated() : new Decimal(0);
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

  // Ageing at `to`: open invoices (dated on or before `to`), balance as of `to`.
  const asOf = new Date(`${to}T00:00:00Z`);
  const aging: Record<string, Decimal> = {
    current: new Decimal(0),
    days1to30: new Decimal(0),
    days31to60: new Decimal(0),
    days61to90: new Decimal(0),
    over90: new Decimal(0),
  };
  const creditsByInvoice = new Map<string, StatementInvoiceRow[]>();
  for (const c of issued) {
    if (c.invoiceType !== "credit_note" || !c.originalInvoiceId) continue;
    creditsByInvoice.set(c.originalInvoiceId, [...(creditsByInvoice.get(c.originalInvoiceId) ?? []), c]);
  }
  for (const i of issued) {
    if (i.invoiceType === "credit_note" || day(i.date) > to) continue;
    const balance = balanceAsOf(
      {
        total: i.total,
        payments: input.payments.filter((p) => p.invoiceId === i.id),
        creditNotes: creditsByInvoice.get(i.id) ?? [],
      },
      asOf
    );
    if (balance.outstanding <= 0) continue;
    const outstandingBase = new Decimal(balance.outstanding).times(rateOf(i.exchangeRate));
    const due = day(i.dueDate ?? i.date);
    const key = bucketFor(dayNumber(to) - dayNumber(due));
    aging[key] = aging[key].plus(outstandingBase);
  }
  const agingOut: StatementAging = {
    current: money(aging.current),
    days1to30: money(aging.days1to30),
    days31to60: money(aging.days31to60),
    days61to90: money(aging.days61to90),
    over90: money(aging.over90),
    total: money(Object.values(aging).reduce((s, d) => s.plus(d), new Decimal(0))),
  };

  return {
    from,
    to,
    openingBalance: money(opening),
    lines,
    totalDebits: money(debits),
    totalCredits: money(credits),
    closingBalance: money(running),
    aging: agingOut,
  };
}

// ---------------------------------------------------------------------------
// Database loader
// ---------------------------------------------------------------------------

export interface StatementContact {
  id: string;
  name: string;
  nameAr?: string | null;
  email?: string | null;
  trnNumber?: string | null;
  address?: string | null;
}

/** Strict YYYY-MM-DD that is a real calendar date, else null. */
export function parseStatementDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
}

async function loadRefunds(pool: any, companyId: string, contact: StatementContact): Promise<StatementRefundRow[]> {
  // customer_refunds (migration 0100): a refund carries the credit note's contact_id when the
  // customer is a contact, and only the credit note (and its customer_name) otherwise, so match
  // the same way invoices are matched above. Voided refunds (voided_at set) are not money moved.
  // A refund is valued at the CREDIT NOTE's rate (what the receivable ledger moves at), not the
  // refund-date rate: the difference between the two is a realised FX entry, not a receivable.
  const result = await pool.query(
    `SELECT r.id::text AS id, r.amount::float8 AS amount, to_char(r.refund_date, 'YYYY-MM-DD') AS date,
            r.currency, cn.exchange_rate::float8 AS "exchangeRate", r.reference
       FROM customer_refunds r
       JOIN invoices cn ON cn.id = r.credit_note_id
      WHERE r.company_id = $1
        AND r.voided_at IS NULL
        AND (r.contact_id = $2 OR (r.contact_id IS NULL AND lower(cn.customer_name) = lower($3)))`,
    [companyId, contact.id, contact.name]
  );
  return result.rows;
}

export async function buildCustomerStatement(args: {
  companyId: string;
  contactId: string;
  from: string;
  to: string;
}): Promise<(CustomerStatement & { contact: StatementContact }) | null> {
  const { pool } = await import("../db");
  const { getCustomerCreditBalance } = await import("./customer-credit-refund.service");
  const contactResult = await pool.query(
    `SELECT id::text AS id, name, name_ar AS "nameAr", email, trn_number AS "trnNumber", address
       FROM customer_contacts WHERE id = $1 AND company_id = $2`,
    [args.contactId, args.companyId]
  );
  const contact: StatementContact | undefined = contactResult.rows[0];
  if (!contact) return null;

  // Invoices are linked by contact_id; older rows only carry the customer name.
  const invoiceResult = await pool.query(
    `SELECT id::text AS id, number, to_char(date + INTERVAL '4 hours', 'YYYY-MM-DD') AS date,
            to_char(due_date + INTERVAL '4 hours', 'YYYY-MM-DD') AS "dueDate", total::float8 AS total, currency,
            exchange_rate::float8 AS "exchangeRate", base_currency_amount::float8 AS "baseCurrencyAmount",
            status, invoice_type AS "invoiceType", original_invoice_id::text AS "originalInvoiceId"
       FROM invoices
      WHERE company_id = $1
        AND (contact_id = $2 OR (contact_id IS NULL AND lower(customer_name) = lower($3)))`,
    [args.companyId, contact.id, contact.name]
  );
  const ids = invoiceResult.rows.map((r: any) => r.id);
  const paymentResult = ids.length
    ? await pool.query(
        `SELECT id::text AS id, invoice_id::text AS "invoiceId", amount::float8 AS amount,
                to_char(date + INTERVAL '4 hours', 'YYYY-MM-DD') AS date, reference, method
           FROM invoice_payments WHERE company_id = $1 AND invoice_id = ANY($2::uuid[])`,
        [args.companyId, ids]
      )
    : { rows: [] };
  const refunds = await loadRefunds(pool, args.companyId, contact);
  const advanceResult = await pool.query(
    `SELECT a.number, a.kind, i.number AS "invoiceNumber", to_char(i.date + INTERVAL '4 hours', 'YYYY-MM-DD') AS date,
            a.net_amount::float8 AS "netAmount", a.vat_amount::float8 AS "vatAmount", a.gross_amount::float8 AS "grossAmount",
            a.vat_rate::float8 AS "vatRate",
            (a.net_amount - COALESCE((SELECT SUM(x.net_amount) FROM customer_advance_applications x
                WHERE x.advance_id = a.id
                  AND ((x.kind = 'application' AND x.status = 'active') OR (x.kind = 'refund' AND x.status IN ('active', 'pending')))), 0))::float8
              AS "availableNet"
       FROM customer_advances a JOIN invoices i ON i.id = a.invoice_id
      WHERE a.company_id = $1 AND a.contact_id = $2 AND a.status <> 'void'
        AND i.status NOT IN ('draft', 'void', 'cancelled') AND to_char(i.date + INTERVAL '4 hours', 'YYYY-MM-DD') <= $3
      ORDER BY i.date, a.number`,
    [args.companyId, contact.id, args.to]
  );
  const unappliedAdvances: StatementAdvanceMemo[] = advanceResult.rows
    .filter((r: any) => r.availableNet > 0.004)
    .map((r: any) => ({
      number: r.number,
      kind: r.kind,
      invoiceNumber: r.invoiceNumber,
      date: r.date,
      netAmount: r.netAmount,
      vatAmount: r.vatAmount,
      grossAmount: r.grossAmount,
      availableNet: Math.round(r.availableNet * 100) / 100,
      availableGross: Math.round(r.availableNet * (1 + (r.vatRate || 0)) * 100) / 100,
    }));

  return {
    ...computeCustomerStatement({
      invoices: invoiceResult.rows,
      payments: paymentResult.rows,
      refunds,
      from: args.from,
      to: args.to,
    }),
    unappliedAdvances,
    // Overpayments held as customer credit (2050), net of refunds paid out: a memo like the advances.
    creditBalance: (await getCustomerCreditBalance(args.companyId, contact.id)).available,
    creditRefunds: (
      await pool.query(
        `SELECT to_char(refund_date, 'YYYY-MM-DD') AS date, amount::float8 AS amount, reference
           FROM customer_credit_refunds
          WHERE company_id = $1 AND contact_id = $2 AND voided_at IS NULL AND refund_date <= $3::date
          ORDER BY refund_date, created_at`,
        [args.companyId, contact.id, args.to]
      )
    ).rows as Array<{ date: string; amount: number; reference: string | null }>,
    contact,
  };
}
