/**
 * N5: the P&L expenses card must not repeat cost-of-sales accounts (e.g. 5005/5007) that the
 * statement already shows under Cost of sales. Figures are unchanged; only the row grouping is.
 */
export interface PlLineRef {
  accountId: string;
  accountCode: string;
}

export function operatingExpenseLinesOf<T extends PlLineRef>(
  expenses: T[],
  costOfSalesLines: PlLineRef[] | undefined
): T[] {
  if (!costOfSalesLines || costOfSalesLines.length === 0) return expenses;
  const ids = new Set(costOfSalesLines.map((l) => l.accountId));
  const codes = new Set(costOfSalesLines.map((l) => l.accountCode));
  return expenses.filter((l) => !ids.has(l.accountId) && !codes.has(l.accountCode));
}
