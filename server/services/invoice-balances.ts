/**
 * Per-invoice paid / open balances for the invoice list API. Mirrors the receivable rule in
 * `server/reporting/aging.ts` so the Invoices status tiles sum to the dashboard `outstanding`.
 */
import { pool } from "../db";
import type { InvoiceBalanceFields } from "../../shared/invoice-balance";

const NOT_OPEN_STATUSES = ["draft", "void", "cancelled"];

export async function getInvoiceBalances(
  companyId: string,
  ids?: string[]
): Promise<Map<string, InvoiceBalanceFields>> {
  const out = new Map<string, InvoiceBalanceFields>();
  if (ids && ids.length === 0) return out;
  const { rows } = await pool.query(
    `WITH paid AS (
       SELECT invoice_id, SUM(amount) AS amt FROM invoice_payments
        WHERE company_id = $1 GROUP BY invoice_id
     ), credited AS (
       SELECT invoice_id, SUM(total) AS amt FROM credit_notes
        WHERE company_id = $1 AND status = 'issued' AND invoice_id IS NOT NULL GROUP BY invoice_id
     ), calc AS (
       SELECT i.id, COALESCE(p.amt, 0) AS paid,
              CASE WHEN i.status = ANY($2::text[]) OR i.invoice_type = 'credit_note' THEN 0
                   ELSE GREATEST(i.total - COALESCE(p.amt, 0) - COALESCE(c.amt, 0), 0) END AS open,
              COALESCE(NULLIF(i.exchange_rate, 0), 1) AS fx
         FROM invoices i
         LEFT JOIN paid p ON p.invoice_id = i.id
         LEFT JOIN credited c ON c.invoice_id = i.id
        WHERE i.company_id = $1 AND ($3::text[] IS NULL OR i.id::text = ANY($3::text[]))
     )
     SELECT id, paid::float8 AS paid, open::float8 AS open,
            (ROUND(open * fx * 100)::bigint / 100.0)::float8 AS open_base
       FROM calc`,
    [companyId, NOT_OPEN_STATUSES, ids ?? null]
  );
  for (const r of rows) {
    out.set(String(r.id), {
      amountPaid: Number(r.paid),
      openBalance: Number(r.open),
      openBalanceBase: Number(r.open_base),
    });
  }
  return out;
}
