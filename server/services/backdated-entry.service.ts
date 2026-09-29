/**
 * Soft guard for journal entries dated before the company's current fiscal
 * year. Nothing is locked by default, so a mistyped (or deliberate) prior-year
 * date would silently change prior-year figures / retained earnings. Callers
 * must confirm explicitly (`confirmBackdated: true`).
 *
 * Pure functions only — no DB access — so they are trivially unit-testable.
 * All calendar-day decisions are made in UAE time (UTC+4, no DST).
 */

export const BACKDATED_CONFIRMATION_CODE = "BACKDATED_ENTRY_CONFIRMATION_REQUIRED";

const UAE_OFFSET_MS = 4 * 60 * 60 * 1000;

/** UAE calendar day (YYYY-MM-DD) of an instant. */
export function toUaeDay(date: Date): string {
  return new Date(date.getTime() + UAE_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * First day (YYYY-MM-DD) of the fiscal year containing `now`, in UAE time.
 * `startMonth` is 1..12 (companies.fiscal_year_start_month); invalid values
 * fall back to January.
 */
export function getFiscalYearStart(now: Date, startMonth: number | null | undefined): string {
  const month =
    Number.isInteger(startMonth) && (startMonth as number) >= 1 && (startMonth as number) <= 12
      ? (startMonth as number)
      : 1;
  const uae = new Date(now.getTime() + UAE_OFFSET_MS);
  const currentMonth = uae.getUTCMonth() + 1;
  const year = currentMonth >= month ? uae.getUTCFullYear() : uae.getUTCFullYear() - 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** True when the entry's UAE calendar day is strictly before the fiscal year start. */
export function isBackdatedBeforeFiscalYear(
  entryDate: Date | string | null | undefined,
  fiscalYearStart: string
): boolean {
  if (!entryDate) return false;
  const d = entryDate instanceof Date ? entryDate : new Date(entryDate);
  if (isNaN(d.getTime())) return false;
  return toUaeDay(d) < fiscalYearStart;
}

export interface BackdatedDecision {
  /** True when the request must be rejected with 409 until confirmed. */
  requiresConfirmation: boolean;
  /** True when the entry is backdated and the caller explicitly confirmed it. */
  confirmedBackdated: boolean;
  fiscalYearStart: string;
}

export function evaluateBackdatedEntry(params: {
  entryDate: Date | string | null | undefined;
  fiscalYearStartMonth: number | null | undefined;
  confirmBackdated: unknown;
  now?: Date;
}): BackdatedDecision {
  const fiscalYearStart = getFiscalYearStart(params.now ?? new Date(), params.fiscalYearStartMonth);
  const backdated = isBackdatedBeforeFiscalYear(params.entryDate, fiscalYearStart);
  const confirmed = params.confirmBackdated === true;
  return {
    requiresConfirmation: backdated && !confirmed,
    confirmedBackdated: backdated && confirmed,
    fiscalYearStart,
  };
}
