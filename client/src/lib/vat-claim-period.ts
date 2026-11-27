/**
 * The VAT return period (monthly, or a quarter anchored on the company's start month) that
 * contains a date. Mirrors `periodContaining` in server/tax/vat-periods.ts; the server stays the
 * authority, this only labels a claim or a reversal date on screen.
 */
function lastDayOfMonth(year: number, month1: number): string {
  return new Date(Date.UTC(year, month1, 0)).toISOString().slice(0, 10);
}

export function vatPeriodContaining(
  date: string,
  frequency: string | null | undefined,
  startMonth: number | null | undefined
): { from: string; to: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (String(frequency || "").toLowerCase() === "monthly") {
    return { from: `${date.slice(0, 7)}-01`, to: lastDayOfMonth(y, m) };
  }
  const anchor = ((((startMonth || 1) - 1) % 12) + 12) % 12;
  const since = (((m - 1 - anchor) % 12) + 12) % 12;
  const qStart0 = (anchor + Math.floor(since / 3) * 3) % 12;
  const year = qStart0 > m - 1 ? y - 1 : y;
  const endMonthAbs = qStart0 + 3;
  const endYear = year + Math.floor((endMonthAbs - 1) / 12);
  const endMonth = ((endMonthAbs - 1) % 12) + 1;
  return {
    from: `${year}-${String(qStart0 + 1).padStart(2, "0")}-01`,
    to: lastDayOfMonth(endYear, endMonth),
  };
}
