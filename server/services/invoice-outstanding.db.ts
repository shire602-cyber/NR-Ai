// Database side of the shared outstanding-amount definition (see
// invoice-outstanding.ts): loaders for route code and SQL fragments for the
// raw-SQL reports, so both compute total - payments - live credit notes.

import { sql } from "drizzle-orm";
import { pool } from "../db";
import { computeInvoiceBalance, type InvoiceBalance } from "./invoice-outstanding";

/** Sum of payments on invoice alias `a` (numeric). */
export const paidSql = (a: string) =>
  `COALESCE((SELECT SUM(ip_o.amount) FROM invoice_payments ip_o WHERE ip_o.invoice_id = ${a}.id), 0)`;

/** Sum of live credit notes (absolute) on invoice alias `a` (numeric). */
export const creditedSql = (a: string) =>
  `COALESCE((SELECT SUM(ABS(cn_o.total)) FROM invoices cn_o WHERE cn_o.original_invoice_id = ${a}.id AND cn_o.invoice_type = 'credit_note' AND cn_o.status NOT IN ('void', 'cancelled')), 0)`;

/** total - payments - credit notes, never below 0 (document currency). */
export const outstandingSql = (a: string) =>
  `GREATEST(${a}.total - ${paidSql(a)} - ${creditedSql(a)}, 0)`;

/** Outstanding converted to AED at the invoice's own booking rate. */
export const outstandingBaseSql = (a: string) =>
  `(${outstandingSql(a)} * COALESCE(NULLIF(${a}.exchange_rate, 0), 1))`;

/**
 * "This invoice is an open receivable": an issued invoice (not a credit note,
 * draft, void, cancelled, paid or credited) with something still outstanding.
 */
export const openReceivableSql = (a: string) =>
  `(${a}.invoice_type <> 'credit_note' AND ${a}.status NOT IN ('paid', 'draft', 'void', 'cancelled', 'credited') AND ${outstandingSql(a)} > 0)`;

export interface LoadBalanceOptions {
  /** Only these invoices. */
  invoiceIds?: string[];
  /** Count only payments and credit notes dated on or before this UTC day. */
  asOf?: Date;
}

/** Balances for a company's invoices (credit notes themselves excluded). */
export async function loadInvoiceBalances(
  companyId: string,
  opts: LoadBalanceOptions = {}
): Promise<Map<string, InvoiceBalance>> {
  const params: unknown[] = [companyId];
  let paidDate = "";
  let creditDate = "";
  if (opts.asOf) {
    params.push(`${opts.asOf.toISOString().slice(0, 10)}T23:59:59.999`);
    paidDate = ` AND ip.date <= $${params.length}::timestamp`;
    creditDate = ` AND cn.date <= $${params.length}::timestamp`;
  }
  let idFilter = "";
  if (opts.invoiceIds) {
    params.push(opts.invoiceIds);
    idFilter = ` AND i.id = ANY($${params.length}::uuid[])`;
  }
  const result = await pool.query(
    `SELECT i.id,
            i.total::float8 AS total,
            COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id${paidDate}), 0)::float8 AS paid,
            COALESCE((SELECT SUM(ABS(cn.total)) FROM invoices cn
                       WHERE cn.original_invoice_id = i.id AND cn.invoice_type = 'credit_note'
                         AND cn.status NOT IN ('void', 'cancelled')${creditDate}), 0)::float8 AS credited
       FROM invoices i
      WHERE i.company_id = $1 AND i.invoice_type <> 'credit_note'${idFilter}`,
    params
  );
  const out = new Map<string, InvoiceBalance>();
  for (const row of result.rows) {
    out.set(row.id, computeInvoiceBalance({ total: row.total, paid: row.paid, credited: row.credited }));
  }
  return out;
}

/** Balance of one invoice; a zero balance for an unknown id. */
export async function getInvoiceBalance(companyId: string, invoiceId: string): Promise<InvoiceBalance> {
  const map = await loadInvoiceBalances(companyId, { invoiceIds: [invoiceId] });
  return map.get(invoiceId) ?? computeInvoiceBalance({ total: 0 });
}

// Drizzle fragments for queries that select FROM `invoices` (no alias): the
// firm dashboards. `openArCondition` = an open receivable (see openReceivableSql);
// `openArAmount` = its outstanding amount in AED.
export const openArCondition = sql.raw(openReceivableSql("invoices"));
export const openArAmount = sql.raw(outstandingBaseSql("invoices"));
