/**
 * Trial-balance in-balance check for many companies at once (firm dashboards).
 *
 * The firm bookkeeper dashboard, client health and value-ops review used to sum
 * journal_lines themselves (code audit §2.9). They only need, per company, the
 * posted debit and credit totals (to flag an out-of-balance ledger) and the latest
 * journal activity, so this reads exactly that in one grouped query:
 *
 * - posted entries only; sums in SQL in integer fils (`ROUND(x * 100)`);
 * - closing entries excluded from the totals, per the kernel policy (they are
 *   balanced entries, so the debit-credit difference is the same either way);
 * - `lastJournalAt` is activity, not a statement figure: the latest
 *   updated/posted/created time over every posted entry, closing ones included.
 */
import { pool } from "../db";
import { CLOSING_ENTRY_SQL, type Fils, type Queryable } from "./ledger-query";

export interface LedgerBalanceCheck {
  companyId: string;
  debitFils: Fils;
  creditFils: Fils;
  /** |debit - credit| in fils; 0 for a balanced ledger. */
  differenceFils: Fils;
  lastJournalAt: Date | null;
}

export async function ledgerBalanceCheckByCompany(
  companyIds: readonly string[],
  q: Queryable = pool
): Promise<Map<string, LedgerBalanceCheck>> {
  const out = new Map<string, LedgerBalanceCheck>();
  if (companyIds.length === 0) return out;
  const { rows } = await q.query(
    `SELECT je.company_id,
            COALESCE(SUM(ROUND(jl.debit * 100)) FILTER (WHERE NOT ${CLOSING_ENTRY_SQL}), 0)::bigint AS debit_fils,
            COALESCE(SUM(ROUND(jl.credit * 100)) FILTER (WHERE NOT ${CLOSING_ENTRY_SQL}), 0)::bigint AS credit_fils,
            MAX(COALESCE(je.updated_at, je.posted_at, je.created_at)) AS last_journal_at
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
      WHERE je.company_id = ANY($1::uuid[])
        AND je.status = 'posted'
      GROUP BY je.company_id`,
    [[...companyIds]]
  );
  for (const r of rows) {
    const debitFils = Number(r.debit_fils);
    const creditFils = Number(r.credit_fils);
    out.set(r.company_id, {
      companyId: r.company_id,
      debitFils,
      creditFils,
      differenceFils: Math.abs(debitFils - creditFils),
      lastJournalAt: r.last_journal_at ? new Date(r.last_journal_at) : null,
    });
  }
  return out;
}
