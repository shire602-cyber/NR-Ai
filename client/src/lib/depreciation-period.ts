/**
 * E2 (J3-r2): depreciation is dated at month end and never in the future (the server refuses a
 * month that has not ended with 422 DEPRECIATION_PERIOD_NOT_ENDED). These pick the default month
 * and validate the dialog's choice in the browser.
 */
const pad = (n: number) => String(n).padStart(2, "0");

export function localIsoToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function depreciationPeriodEnd(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(lastDay)}`;
}

/** The last month that has fully ended on `today` (YYYY-MM-DD). */
export function lastEndedMonth(today: string = localIsoToday()): { year: number; month: number } {
  const [y, m] = today.split("-").map(Number);
  if (depreciationPeriodEnd(y, m) <= today) return { year: y, month: m };
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

export function depreciationPeriodEnded(
  year: number,
  month: number,
  today: string = localIsoToday()
): boolean {
  return depreciationPeriodEnd(year, month) <= today;
}
