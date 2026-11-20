/**
 * Budget-vs-actual summary (X4/J3). Income and expense lines are totalled separately and the
 * net is derived from them; budgets of income and expense lines are never added together.
 *
 * Sign rules (same as the server's per-line `variance`, positive = favourable):
 *   income  variance = actual - budget
 *   expense variance = budget - actual
 *   net     variance = actual net - budget net = income variance + expense variance
 */
export interface SummaryLine {
  accountType: string | null;
  category?: string | null;
  totals: { budget: number; actual: number };
}

export interface SummaryGroup {
  budget: number;
  actual: number;
  /** Positive = favourable. */
  variance: number;
}

export interface BudgetSummary {
  income: SummaryGroup;
  expense: SummaryGroup;
  net: SummaryGroup;
  hasIncome: boolean;
  hasExpense: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * E2 (J3-r2): whether a budget line is income. The line's account type decides; a legacy line
 * saved without an account falls back to its category ("Revenue"), so revenue is never added to
 * expenses.
 */
export function isIncomeLine(line: {
  accountType?: string | null;
  category?: string | null;
}): boolean {
  if (line.accountType) return line.accountType === "income";
  return (line.category ?? "").trim().toLowerCase() === "revenue";
}

export function summariseBudget(lines: readonly SummaryLine[]): BudgetSummary {
  let ib = 0;
  let ia = 0;
  let eb = 0;
  let ea = 0;
  let hasIncome = false;
  let hasExpense = false;
  for (const l of lines) {
    if (isIncomeLine(l)) {
      hasIncome = true;
      ib += l.totals.budget;
      ia += l.totals.actual;
    } else {
      hasExpense = true;
      eb += l.totals.budget;
      ea += l.totals.actual;
    }
  }
  const income = { budget: r2(ib), actual: r2(ia), variance: r2(ia - ib) };
  const expense = { budget: r2(eb), actual: r2(ea), variance: r2(eb - ea) };
  const net = {
    budget: r2(ib - eb),
    actual: r2(ia - ea),
    variance: r2(ia - ea - (ib - eb)),
  };
  return { income, expense, net, hasIncome, hasExpense };
}

// ─── E2 (J3-r2): plan months, signed totals and the account picker ──────────

export const BUDGET_MONTH_COLUMNS = [
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
export type BudgetMonthColumn = (typeof BUDGET_MONTH_COLUMNS)[number];

export interface PlanMonth {
  /** Year-month, e.g. "2026-09". */
  key: string;
  column: BudgetMonthColumn;
  /** Calendar month 1-12. */
  month: number;
  year: number;
}

/**
 * The calendar months a plan covers (at most 12), oldest first, keyed like the server's variance
 * report. A plan from 1 Sep to 30 Nov has three months and the report returns only those, so the
 * grids must not index all twelve columns.
 */
export function planMonths(
  start: string | null | undefined,
  end: string | null | undefined
): PlanMonth[] {
  const out: PlanMonth[] = [];
  if (!start || !end) return out;
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const endKey = end.slice(0, 7);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return out;
  for (let i = 0; i < 12; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > endKey) break;
    out.push({ key, column: BUDGET_MONTH_COLUMNS[m - 1], month: m, year: y });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export interface SignedTotals {
  income: Record<string, number>;
  expense: Record<string, number>;
  net: Record<string, number>;
}

/**
 * Detail-grid totals per month column plus "annual": income and expenses are totalled
 * separately and net = income - expenses (they are never added together).
 */
export function signedLineTotals<L extends { category?: string | null }>(
  lines: readonly L[],
  accountTypeOf: (line: L) => string | null | undefined
): SignedTotals {
  const keys = [...BUDGET_MONTH_COLUMNS, "annual"];
  const zero = () => Object.fromEntries(keys.map((k) => [k, 0])) as Record<string, number>;
  const income = zero();
  const expense = zero();
  for (const line of lines) {
    const target = isIncomeLine({ accountType: accountTypeOf(line), category: line.category })
      ? income
      : expense;
    const row = line as unknown as Record<string, unknown>;
    for (const k of BUDGET_MONTH_COLUMNS) target[k] += Number(row[k] ?? 0) || 0;
    target.annual += Number(row.annual_total ?? 0) || 0;
  }
  const net = zero();
  for (const k of keys) {
    income[k] = r2(income[k]);
    expense[k] = r2(expense[k]);
    net[k] = r2(income[k] - expense[k]);
  }
  return { income, expense, net };
}

export interface BudgetAccountOption {
  id: string;
  code?: string | null;
  type: string;
  isActive?: boolean | null;
  isVatAccount?: boolean | null;
}

/**
 * Accounts a budget line can be mapped to: active income and expense accounts that are not
 * control accounts (the server refuses anything else). Ordered by code.
 */
export function budgetAccountOptions<A extends BudgetAccountOption>(
  accounts: readonly A[],
  isControl: (a: A) => boolean
): A[] {
  return accounts
    .filter(
      (a) => (a.type === "income" || a.type === "expense") && a.isActive !== false && !isControl(a)
    )
    .sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")));
}
