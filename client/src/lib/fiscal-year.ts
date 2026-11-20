/**
 * Company fiscal-year helpers (X4/J3): budget and corporate-tax defaults follow the
 * company's `fiscalYearStartMonth` instead of assuming 1 Jan - 31 Dec.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export interface FiscalYearRange {
  /** ISO date of the first day of the fiscal year. */
  start: string;
  /** ISO date of the last day of the fiscal year. */
  end: string;
  /** Label year: the calendar year in which the fiscal year ends. */
  fiscalYear: number;
}

/** The fiscal year that contains `today` for a company whose year starts in `startMonth` (1-12). */
export function fiscalYearContaining(
  startMonth: number | null | undefined,
  today: Date = new Date()
): FiscalYearRange {
  const m = Number.isInteger(startMonth) && startMonth! >= 1 && startMonth! <= 12 ? startMonth! : 1;
  const y = today.getFullYear();
  const startYear = today.getMonth() + 1 >= m ? y : y - 1;
  return fiscalYearStartingIn(m, startYear);
}

/**
 * E2 (J3-r2): the last fiscal year that has ended on `today` (the default year-end close). A
 * Nov-Oct company on 18 Nov 2026 closes the year ending 31 Oct 2026.
 */
export function lastEndedFiscalYear(
  startMonth: number | null | undefined,
  today: Date = new Date()
): FiscalYearRange {
  const current = fiscalYearContaining(startMonth, today);
  const [y, m] = current.start.split("-").map(Number);
  return fiscalYearStartingIn(m, y - 1);
}

/**
 * E2 (J3-r2): the default report range: the start of the fiscal year containing `today` up to
 * today (local calendar dates), not 1 January.
 */
export function fiscalYearToDate(
  startMonth: number | null | undefined,
  today: Date = new Date()
): { startDate: string; endDate: string } {
  return {
    startDate: fiscalYearContaining(startMonth, today).start,
    endDate: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
  };
}

/** The fiscal year that starts in `startMonth` of `startYear`. */
export function fiscalYearStartingIn(startMonth: number, startYear: number): FiscalYearRange {
  const m = startMonth >= 1 && startMonth <= 12 ? startMonth : 1;
  const endMonth = m === 1 ? 12 : m - 1;
  const endYear = m === 1 ? startYear : startYear + 1;
  return {
    start: `${startYear}-${pad(m)}-01`,
    end: `${endYear}-${pad(endMonth)}-${pad(lastDayOfMonth(endYear, endMonth))}`,
    fiscalYear: endYear,
  };
}

/** The fiscal year whose label year (the year it ends in) is `fiscalYear`. */
export function fiscalYearEndingIn(
  startMonth: number | null | undefined,
  fiscalYear: number
): FiscalYearRange {
  const m = Number.isInteger(startMonth) && startMonth! >= 1 && startMonth! <= 12 ? startMonth! : 1;
  return fiscalYearStartingIn(m, m === 1 ? fiscalYear : fiscalYear - 1);
}
