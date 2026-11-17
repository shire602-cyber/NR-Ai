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

export function summariseBudget(lines: readonly SummaryLine[]): BudgetSummary {
  let ib = 0;
  let ia = 0;
  let eb = 0;
  let ea = 0;
  let hasIncome = false;
  let hasExpense = false;
  for (const l of lines) {
    if (l.accountType === "income") {
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
