/** Pure helpers for the employee dashboard: pick the latest payslip and total the leave balances. */

export interface RunLite {
  id: string;
  period_year: number;
  period_month: number;
  status: string;
}

export interface BalanceLite {
  code: string;
  available: number;
  balance: number;
}

/** Payslips exist once a run has been calculated; the dashboard shows the newest such month. */
const PAYSLIP_STATUSES = new Set(["calculated", "pending_approval", "approved", "paid"]);

export function latestPayslipRun(runs: readonly RunLite[] | undefined): RunLite | null {
  const usable = (runs ?? []).filter((r) => PAYSLIP_STATUSES.has(r.status));
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => b.period_year - a.period_year || b.period_month - a.period_month)[0];
}

/** One line per leave type, never negative, rounded to half a day. */
export function leaveSummary(rows: readonly BalanceLite[] | undefined): Array<{ code: string; days: number }> {
  return (rows ?? []).map((r) => ({ code: r.code, days: Math.max(0, Math.round(r.available * 2) / 2) }));
}
