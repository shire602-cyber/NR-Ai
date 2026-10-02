/** Helpers for recording a VAT period as "filed outside Muhasib" and for the books-start setting. */

export const FILED_ELSEWHERE_REFERENCE_MAX = 100;
export const FILED_ELSEWHERE_AUDIT_HREF =
  "/reports/run/audit-trail?action=vat_return.filed_elsewhere";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** `2026-07-01T00:00:00.000Z` or `2026-07-01` -> `2026-07-01`. */
export function dayOnly(value: string): string {
  return value.slice(0, 10);
}

/** A real calendar date in YYYY-MM-DD form. */
export function isCalendarDay(value: string): boolean {
  if (!YMD.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The filing date must be a real day, not in the future, and not before the period ended. */
export function filingDateOk(filingDate: string, periodEnd: string, today: string): boolean {
  if (!isCalendarDay(filingDate)) return false;
  return filingDate <= today && filingDate >= dayOnly(periodEnd);
}

export function filedElsewhereBody(
  periodStart: string,
  periodEnd: string,
  filingDate: string,
  reference: string
) {
  const ref = reference.trim();
  return {
    periodStart: dayOnly(periodStart),
    periodEnd: dayOnly(periodEnd),
    filingDate,
    ...(ref ? { reference: ref.slice(0, FILED_ELSEWHERE_REFERENCE_MAX) } : {}),
  };
}

/** The books start is blank (everything counts) or the first day of a month. */
export function booksStartOk(value: string): boolean {
  return value === "" || (isCalendarDay(value) && value.endsWith("-01"));
}

/** The PATCH body: a blank field clears the setting. */
export function booksStartBody(value: string): { vatBooksStart: string | null } {
  return { vatBooksStart: value === "" ? null : value };
}
