/**
 * Budget versus actual (W3-E: R13-11, R13-12, R13-26, R13-29).
 *
 * - Actuals come from the posted ledger through server/reporting's closing
 *   exclusion and UAE dates, grouped by account and year-month.
 * - Budget months are keyed by year-month: a plan spans at most 12 calendar
 *   months, so each month column (jan..dec) maps to exactly one year-month.
 * - Variance is signed by account type: for income, actual above budget is
 *   favourable; for expense, actual below budget is favourable. `variance` is
 *   therefore always "positive = favourable", and `favourable` says so.
 */
import { pool } from "../db";
import { DomainError } from "../errors";
import {
  ENTRY_LOCAL_DATE_SQL,
  NOT_CLOSING_SQL,
  aed,
  addMonths,
  loadAccounts,
  monthEnd,
  monthStart,
  uaeToday,
  type IsoDate,
  type Queryable,
} from "../reporting";

const db: Queryable = pool as unknown as Queryable;

export const MONTH_COLUMNS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;
export type MonthColumn = (typeof MONTH_COLUMNS)[number];

export interface MonthVariance {
  periodKey: string;
  budget: number;
  actual: number;
  variance: number;
  variancePercent: number;
  favourable: boolean;
}

/** Pure: variance and favourability for an account type (all inputs in AED). */
export function varianceFor(
  accountType: string | null | undefined,
  budget: number,
  actual: number
): { variance: number; variancePercent: number; favourable: boolean } {
  const isIncome = accountType === "income";
  const raw = isIncome ? actual - budget : budget - actual;
  const variance = Math.round(raw * 100) / 100;
  const variancePercent = budget !== 0 ? Math.round((raw / Math.abs(budget)) * 1000) / 10 : 0;
  return { variance, variancePercent, favourable: variance >= 0 };
}

/** Calendar year-months a plan covers, oldest first, mapped to month columns. */
export function planMonths(
  start: IsoDate,
  end: IsoDate
): Array<{ key: string; column: MonthColumn }> {
  const out: Array<{ key: string; column: MonthColumn }> = [];
  let cursor = monthStart(start);
  const last = monthStart(end);
  let guard = 0;
  while (cursor <= last && guard++ < 24) {
    out.push({ key: cursor.slice(0, 7), column: MONTH_COLUMNS[Number(cursor.slice(5, 7)) - 1] });
    cursor = addMonths(cursor, 1);
  }
  return out;
}

const iso = (v: unknown): IsoDate => {
  if (v instanceof Date) return new Date(v.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

export interface BudgetPlanRow {
  id: string;
  company_id: string;
  name: string;
  fiscal_year: number;
  start_date: Date | string;
  end_date: Date | string;
  status: string | null;
  alert_threshold_pct?: string | number | null;
  version?: number;
  cost_center_id?: string | null;
  parent_budget_id?: string | null;
  created_by?: string | null;
}

export interface VarianceLine {
  id: string;
  category: string;
  description: string | null;
  accountId: string | null;
  accountType: string | null;
  costCenterId: string | null;
  isContra: boolean;
  months: Record<string, MonthVariance & { monthName: string }>;
  totals: {
    budget: number;
    actual: number;
    variance: number;
    variancePercent: number;
    favourable: boolean;
  };
}

export async function computeBudgetVariance(
  plan: BudgetPlanRow,
  opts: { throughMonth?: string } = {}
) {
  const start = iso(plan.start_date);
  const end = iso(plan.end_date);
  const months = planMonths(start, end);
  const [{ rows: lines }, accounts] = await Promise.all([
    db.query(`SELECT * FROM budget_lines WHERE budget_id = $1 ORDER BY category, created_at`, [
      plan.id,
    ]),
    loadAccounts(plan.company_id),
  ]);
  const typeById = new Map(accounts.map((a) => [a.id, a.type]));

  const { rows: actualRows } = await db.query(
    `SELECT jl.account_id, jl.cost_center_id, to_char(${ENTRY_LOCAL_DATE_SQL}, 'YYYY-MM') AS ym,
            COALESCE(SUM(ROUND(jl.debit * 100)), 0)::bigint AS d,
            COALESCE(SUM(ROUND(jl.credit * 100)), 0)::bigint AS c
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.company_id = $1 AND je.status = 'posted'
        AND ${ENTRY_LOCAL_DATE_SQL} >= $2::date AND ${ENTRY_LOCAL_DATE_SQL} <= $3::date
        AND ${NOT_CLOSING_SQL}
      GROUP BY 1, 2, 3`,
    [plan.company_id, monthStart(start), monthEnd(end)]
  );
  const actualByAccountMonth = new Map<string, number>();
  for (const r of actualRows) {
    const type = typeById.get(r.account_id as string);
    // Natural sign: income credit-normal, everything else debit-normal.
    const fils = type === "income" ? Number(r.c) - Number(r.d) : Number(r.d) - Number(r.c);
    const cc = (r.cost_center_id as string | null) ?? "";
    actualByAccountMonth.set(`${r.account_id}|${r.ym}|${cc}`, fils);
    // "*" accumulates every cost centre for lines that carry no cost-centre dimension.
    const all = `${r.account_id}|${r.ym}|*`;
    actualByAccountMonth.set(all, (actualByAccountMonth.get(all) ?? 0) + fils);
  }

  const through = opts.throughMonth ?? null;
  const varianceLines: VarianceLine[] = lines.map((line) => {
    const accountId = (line.account_id as string | null) ?? null;
    const accountType = accountId ? (typeById.get(accountId) ?? null) : null;
    const lineCostCenter =
      (line.cost_center_id as string | null) ?? (plan.cost_center_id as string | null) ?? null;
    const monthly: VarianceLine["months"] = {};
    let totalBudget = 0;
    let totalActual = 0;
    for (const { key, column } of months) {
      const budget = Number(line[column] ?? 0) || 0;
      const actual = accountId
        ? aed(actualByAccountMonth.get(`${accountId}|${key}|${lineCostCenter ?? "*"}`) ?? 0)
        : 0;
      const v = varianceFor(accountType, budget, actual);
      monthly[column] = {
        periodKey: key,
        monthName: column,
        budget: Math.round(budget * 100) / 100,
        actual,
        ...v,
      };
      if (!through || key <= through) {
        totalBudget += budget;
        totalActual += actual;
      }
    }
    const tv = varianceFor(accountType, totalBudget, totalActual);
    return {
      id: line.id,
      category: line.category,
      description: line.description ?? null,
      accountId,
      accountType,
      costCenterId: lineCostCenter,
      isContra: line.is_contra === true,
      months: monthly,
      totals: {
        budget: Math.round(totalBudget * 100) / 100,
        actual: Math.round(totalActual * 100) / 100,
        ...tv,
      },
    };
  });

  return {
    budget: {
      id: plan.id,
      name: plan.name,
      fiscalYear: plan.fiscal_year,
      startDate: plan.start_date,
      endDate: plan.end_date,
      status: plan.status,
      version: plan.version ?? 1,
    },
    periods: months.map((m) => m.key),
    varianceLines,
  };
}

export async function loadPlan(companyId: string, id: string): Promise<BudgetPlanRow> {
  const { rows } = await db.query(`SELECT * FROM budget_plans WHERE id = $1 AND company_id = $2`, [
    id,
    companyId,
  ]);
  if (!rows[0]) throw new DomainError("BUDGET_NOT_FOUND", 404, undefined, "Budget not found");
  return rows[0] as BudgetPlanRow;
}

/** The approved plan to compare against: explicit id, else the latest approved plan for the fiscal year. */
export async function findApprovedPlan(
  companyId: string,
  opts: { budgetId?: string; year?: number }
): Promise<BudgetPlanRow | null> {
  if (opts.budgetId) {
    const plan = await loadPlan(companyId, opts.budgetId);
    return plan.status === "approved" ? plan : null;
  }
  const { rows } = await db.query(
    `SELECT * FROM budget_plans
      WHERE company_id = $1 AND status = 'approved' AND ($2::int IS NULL OR fiscal_year = $2)
      ORDER BY fiscal_year DESC, version DESC, created_at DESC LIMIT 1`,
    [companyId, opts.year ?? null]
  );
  return (rows[0] as BudgetPlanRow) ?? null;
}

export interface BudgetAlertCandidate {
  budgetId: string;
  lineId: string;
  category: string;
  period: string;
  budget: number;
  actual: number;
  variancePct: number;
}

/**
 * Unfavourable variances beyond the plan's threshold for completed months.
 * Pure over a computed variance report so it is unit-testable.
 */
export function alertCandidates(
  report: Awaited<ReturnType<typeof computeBudgetVariance>>,
  thresholdPct: number,
  today: IsoDate = uaeToday()
): BudgetAlertCandidate[] {
  const currentKey = today.slice(0, 7);
  const out: BudgetAlertCandidate[] = [];
  for (const line of report.varianceLines) {
    if (!line.accountId) continue;
    for (const m of Object.values(line.months)) {
      if (m.periodKey > currentKey) continue;
      if (m.periodKey === currentKey && line.accountType === "income") continue;
      if (m.budget <= 0 || m.favourable) continue;
      if (Math.abs(m.variancePercent) < thresholdPct) continue;
      out.push({
        budgetId: report.budget.id,
        lineId: line.id,
        category: line.category,
        period: m.periodKey,
        budget: m.budget,
        actual: m.actual,
        variancePct: m.variancePercent,
      });
    }
  }
  return out;
}
