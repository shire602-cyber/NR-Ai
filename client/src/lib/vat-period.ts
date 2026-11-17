/**
 * X5 (J1 D7): may the VAT return for a period be generated? The server refuses a period that
 * ends after today (PERIOD_IN_FUTURE), so a period ending today or earlier can be generated;
 * a later one is shown as a live preview instead.
 */
export function vatPeriodEnded(periodEnd: string, today: string): boolean {
  return periodEnd <= today;
}
