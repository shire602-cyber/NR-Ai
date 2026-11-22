/**
 * Firm receivables: open and overdue A/R per client company, in each company's base currency.
 *
 * This is the settlement rule (`./settlement.ts`) applied to many companies in one grouped
 * query: partial payments, credit notes (both kinds) and applied customer credits reduce the
 * open balance, and each document is converted at its own booking rate. The aging report
 * reads the same fragments, so the figure here ties to GL 1040 for the same date. The firm
 * screens (portfolio, overview, command centre, bookkeeper dashboard) must read this module
 * and never sum `invoices.total` themselves.
 *
 * Overdue uses the aging rule: due date, else invoice date + 30 days, strictly before `asOf`.
 */
import { pool } from "../db";
import type { IsoDate } from "./dates";
import { uaeToday } from "./dates";
import {
  documentAmountBaseFilsSql,
  localDateSql,
  localDateOnOrBeforeSql,
  receivableOpenSql,
  receivableStatusSql,
} from "./settlement";
import type { Queryable } from "./ledger-query";

export interface CompanyReceivables {
  companyId: string;
  baseCurrency: string;
  /** Open A/R in base-currency fils. */
  openFils: number;
  /** Open A/R past its due date, in base-currency fils. */
  overdueFils: number;
  /** Invoices with an open balance. */
  openCount: number;
  /** Invoices with an open balance past their due date. */
  overdueCount: number;
}

const AS_OF = { asOf: "$2::date" };

/** Open and overdue A/R for each of `companyIds` (companies without any are omitted). */
export async function receivablesByCompany(
  companyIds: string[],
  asOf: IsoDate = uaeToday(),
  q: Queryable = pool
): Promise<Map<string, CompanyReceivables>> {
  const out = new Map<string, CompanyReceivables>();
  if (companyIds.length === 0) return out;
  const due = `COALESCE(${localDateSql("i.due_date")}, ${localDateSql("i.date")} + 30)`;
  const openFils = documentAmountBaseFilsSql("balance.open", "i");
  const { rows } = await q.query(
    `SELECT i.company_id, co.base_currency,
            COALESCE(SUM(${openFils}), 0)::text AS open_fils,
            COALESCE(SUM(${openFils}) FILTER (WHERE ${due} < $2::date), 0)::text AS overdue_fils,
            COUNT(*) FILTER (WHERE balance.open > 0)::int AS open_count,
            COUNT(*) FILTER (WHERE balance.open > 0 AND ${due} < $2::date)::int AS overdue_count
       FROM invoices i
       JOIN companies co ON co.id = i.company_id
       -- Keep the settlement subqueries in the lateral plan so each runs only once per invoice.
       CROSS JOIN LATERAL (SELECT ${receivableOpenSql("i", AS_OF)} AS open OFFSET 0) balance
      WHERE i.company_id = ANY($1::uuid[])
        AND ${receivableStatusSql("i")}
        AND COALESCE(i.invoice_type, 'invoice') <> 'credit_note'
        AND ${localDateOnOrBeforeSql("i.date", AS_OF.asOf)}
      GROUP BY i.company_id, co.base_currency`,
    [companyIds, asOf]
  );
  for (const r of rows as Array<Record<string, string | number>>) {
    out.set(String(r.company_id), {
      companyId: String(r.company_id),
      baseCurrency: String(r.base_currency || "AED"),
      openFils: Number(r.open_fils),
      overdueFils: Number(r.overdue_fils),
      openCount: Number(r.open_count),
      overdueCount: Number(r.overdue_count),
    });
  }
  return out;
}
