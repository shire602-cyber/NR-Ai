/**
 * Per-invoice paid / open balances for the invoice list API. Built from the one settlement
 * rule in `server/reporting/settlement.ts` (D5c), the same rule agedReceivables and the
 * dashboard `outstanding` use, so the Invoices status tiles sum to it.
 */
import { pool } from "../db";
import type { InvoiceBalanceFields } from "../../shared/invoice-balance";
import {
  receivableOpenSql,
  receivableSettlementPartsSql,
  receivableStatusSql,
} from "../reporting/settlement";

export async function getInvoiceBalances(
  companyId: string,
  ids?: string[]
): Promise<Map<string, InvoiceBalanceFields>> {
  const out = new Map<string, InvoiceBalanceFields>();
  if (ids && ids.length === 0) return out;
  const { rows } = await pool.query(
    `WITH calc AS (
       SELECT i.id, ${receivableSettlementPartsSql("i").paid} AS paid,
              COALESCE((SELECT SUM(wo.amount) FROM invoice_payments wo
                         WHERE wo.invoice_id = i.id AND wo.method = 'write_off'), 0) AS written_off,
              (${receivableSettlementPartsSql("i").credited}
                 + ${receivableSettlementPartsSql("i").applied}) AS credited,
              CASE WHEN ${receivableStatusSql("i")} THEN ${receivableOpenSql("i")} ELSE 0 END AS open,
              COALESCE(NULLIF(i.exchange_rate, 0), 1) AS fx
         FROM invoices i
        WHERE i.company_id = $1 AND ($2::text[] IS NULL OR i.id::text = ANY($2::text[]))
     )
     SELECT id, paid::float8 AS paid, credited::float8 AS credited, open::float8 AS open,
            written_off::float8 AS written_off,
            (ROUND(open * fx * 100)::bigint / 100.0)::float8 AS open_base
       FROM calc`,
    [companyId, ids ?? null]
  );
  for (const r of rows) {
    out.set(String(r.id), {
      amountPaid: Number(r.paid),
      amountCredited: Number(r.credited),
      openBalance: Number(r.open),
      openBalanceBase: Number(r.open_base),
      amountWrittenOff: Number(r.written_off),
    });
  }
  return out;
}
