/**
 * IFRS presentation reads for the statements kernel (A3). Every figure is summed in SQL in
 * integer fils from posted, non-closing journal lines (the kernel's ledger rule); nothing here
 * writes. Statements import these; routes never call them directly.
 *
 *   otherComprehensiveIncome   revaluation-reserve movements in a range, excluding transfers
 *                              to retained earnings (IAS 1.81A, IAS 16.39, IAS 16.41).
 *   gratuityCurrentPortionFils the end-of-service provision of known leavers (IAS 1.69).
 *   controlAccountFxRevaluationFils / allowanceForDoubtfulDebtsFils
 *                              aging-to-GL reconciling items (IAS 21.23, IFRS 9.5.5.15).
 */
import { pool } from "../db";
import {
  ENTRY_LOCAL_DATE_SQL,
  NOT_CLOSING_SQL,
  type Fils,
  type Queryable,
  type ReportAccount,
} from "./ledger-query";
import { isRetainedEarningsAccount, isRevaluationReserveAccount } from "./classify";
import type { IsoDate } from "./dates";

/** Journal sources of the periodic FX revaluation and its reversal / undo (services/fx). */
export const FX_REVALUATION_SOURCES = [
  "fx_revaluation",
  "fx_revaluation_reversal",
  "fx_revaluation_undo",
] as const;
const FX_SOURCES_SQL = FX_REVALUATION_SOURCES.map((s) => `'${s}'`).join(", ");

const RANGE_SQL = `je.company_id = $1 AND je.status = 'posted'
        AND ($2::date IS NULL OR ${ENTRY_LOCAL_DATE_SQL} >= $2::date)
        AND ($3::date IS NULL OR ${ENTRY_LOCAL_DATE_SQL} <= $3::date)
        AND ${NOT_CLOSING_SQL}`;

/**
 * Other comprehensive income per revaluation-reserve account (fils, credit − debit) for the
 * range. Entries that also touch a retained-earnings account are transfers within equity (the
 * realised surplus on disposal, IAS 16.41), not OCI, so they are left out.
 */
export async function otherComprehensiveIncome(
  companyId: string,
  accounts: ReportAccount[],
  range: { from?: IsoDate | null; to?: IsoDate | null },
  q: Queryable = pool
): Promise<Map<string, Fils>> {
  const reserveIds = accounts.filter(isRevaluationReserveAccount).map((a) => a.id);
  const out = new Map<string, Fils>();
  if (!reserveIds.length) return out;
  const reIds = accounts.filter(isRetainedEarningsAccount).map((a) => a.id);
  const { rows } = await q.query(
    `SELECT jl.account_id, COALESCE(SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100)), 0)::bigint AS f
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
      WHERE ${RANGE_SQL}
        AND jl.account_id = ANY($4::uuid[])
        AND NOT EXISTS (SELECT 1 FROM journal_lines rl
                         WHERE rl.entry_id = je.id AND rl.account_id = ANY($5::uuid[]))
      GROUP BY jl.account_id`,
    [companyId, range.from ?? null, range.to ?? null, reserveIds, reIds.length ? reIds : [null]]
  );
  for (const r of rows) {
    const f = Number(r.f);
    if (f !== 0) out.set(r.account_id, f);
  }
  return out;
}

/**
 * Current portion (fils) of the end-of-service gratuity provision at `asOf`: the provision
 * accrued (approved / paid payroll runs through the as-of month, plus any opening provision)
 * for employees with a termination date on or before asOf + 12 months who have no active final
 * settlement on or before asOf. Everyone else's provision is non-current (IAS 1.69, 19.153).
 */
export async function gratuityCurrentPortionFils(
  companyId: string,
  asOf: IsoDate,
  q: Queryable = pool
): Promise<Fils> {
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(
              ROUND(COALESCE(e.opening_gratuity_provision, 0) * 100)
              + COALESCE((SELECT SUM(ROUND(pi.gratuity_accrual * 100))
                            FROM payroll_items pi
                            JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
                           WHERE pi.employee_id = e.id AND pr.company_id = e.company_id
                             AND pr.status IN ('approved', 'paid')
                             AND (pr.period_year * 100 + pr.period_month)
                                 <= (EXTRACT(YEAR FROM $2::date) * 100 + EXTRACT(MONTH FROM $2::date))), 0)
            ), 0)::bigint AS f
       FROM employees e
      WHERE e.company_id = $1
        AND e.termination_date IS NOT NULL
        AND e.termination_date <= ($2::date + interval '12 months')::date
        AND NOT EXISTS (SELECT 1 FROM payroll_settlements s
                         WHERE s.employee_id = e.id AND s.status <> 'reversed'
                           AND s.termination_date <= $2::date)`,
    [companyId, asOf]
  );
  return Math.max(0, Number(rows[0]?.f ?? 0));
}

/**
 * Unrealised FX revaluation carried on a control account at `asOf` (fils, debit − credit):
 * the revaluation entries and their reversals dated on or before asOf. The sub-ledger keeps
 * documents at their booking rate (the one settlement rule), so this is the reconciling item
 * between the aging and GL 1040 / 2010 after a period-end revaluation (IAS 21.23).
 */
export async function controlAccountFxRevaluationFils(
  companyId: string,
  accountId: string,
  asOf: IsoDate,
  q: Queryable = pool
): Promise<Fils> {
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(ROUND(jl.debit * 100) - ROUND(jl.credit * 100)), 0)::bigint AS f
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
      WHERE ${RANGE_SQL} AND je.source IN (${FX_SOURCES_SQL}) AND jl.account_id = $4`,
    [companyId, null, asOf, accountId]
  );
  return Number(rows[0]?.f ?? 0);
}

/** Allowance for doubtful debts (1045 in the default chart) — see services/receivables. */
export const ALLOWANCE_FOR_DOUBTFUL_DEBTS_CODE = "1045";

/** Credit balance (fils, positive) of the allowance for doubtful debts at `asOf`. */
export async function allowanceForDoubtfulDebtsFils(
  companyId: string,
  asOf: IsoDate | null,
  q: Queryable = pool
): Promise<Fils> {
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100)), 0)::bigint AS f
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE ${RANGE_SQL} AND a.company_id = $1 AND a.code = $4`,
    [companyId, null, asOf, ALLOWANCE_FOR_DOUBTFUL_DEBTS_CODE]
  );
  return Number(rows[0]?.f ?? 0);
}
