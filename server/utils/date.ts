// UAE is UTC+4 with no DST. A bare 'YYYY-MM-DD' parsed with `new Date()` is
// interpreted as UTC midnight, which sits 4 hours inside the previous UAE day.
// This helper produces the correct UTC instant for the start/end of a UAE
// calendar day, so report period filters bucket transactions by the UAE day
// the user actually transacted in.

const UAE_OFFSET_MS = 4 * 60 * 60 * 1000;

/**
 * Returns the UTC instant corresponding to 00:00:00 in UAE time on the given
 * 'YYYY-MM-DD' date. Accepts a Date or string; if a Date is given its UTC
 * Y/M/D components are taken as the UAE calendar date.
 */
export function uaeDayStart(date: string | Date): Date {
  const ymd = toYmd(date);
  return new Date(Date.parse(ymd + 'T00:00:00Z') - UAE_OFFSET_MS);
}

/**
 * Returns the UTC instant corresponding to 23:59:59.999 in UAE time on the
 * given 'YYYY-MM-DD' date.
 */
export function uaeDayEnd(date: string | Date): Date {
  const ymd = toYmd(date);
  return new Date(Date.parse(ymd + 'T00:00:00Z') + 24 * 60 * 60 * 1000 - 1 - UAE_OFFSET_MS);
}

function toYmd(date: string | Date): string {
  if (typeof date === 'string') {
    // Allow full ISO strings — keep only the date portion.
    return date.length >= 10 ? date.slice(0, 10) : date;
  }
  // Use UTC components so parsing 'YYYY-MM-DD' (which becomes UTC midnight)
  // round-trips back to the same date.
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the UAE-local Y/M/D parts for an instant. Use these instead of
 * Date.getMonth()/getFullYear()/getDate() when bucketing financial data —
 * those reflect the server's local TZ, which on UTC infrastructure rolls
 * the day at 04:00 UAE and shifts late-night UAE transactions into the
 * previous month/year.
 */
export function uaeYmdParts(date: Date): { year: number; month: number; day: number } {
  // UAE wall time = UTC + 4 with no DST.
  const shifted = new Date(date.getTime() + UAE_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

/**
 * Returns the UTC instant of 00:00 UAE on the 1st of the same UAE-local
 * calendar month as the given date.
 */
export function uaeMonthStart(date: Date): Date {
  const { year, month } = uaeYmdParts(date);
  const ymd = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return uaeDayStart(ymd);
}

/**
 * Returns the UTC instant of 23:59:59.999 UAE on the last day of the same
 * UAE-local calendar month as the given date.
 */
export function uaeMonthEnd(date: Date): Date {
  const { year, month } = uaeYmdParts(date);
  // Day 0 of next month = last day of this month.
  const d = new Date(Date.UTC(year, month + 1, 0));
  const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return uaeDayEnd(ymd);
}

/**
 * Returns the UTC instant of 00:00 UAE on today's UAE calendar date.
 */
export function uaeTodayStart(now: Date = new Date()): Date {
  const { year, month, day } = uaeYmdParts(now);
  const ymd = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return uaeDayStart(ymd);
}

/**
 * Returns 0 (Sunday) … 6 (Saturday) for the UAE-local day of week. Use this
 * for weekend checks — `Date.getDay()` reflects server-local TZ and rolls the
 * day at the wrong instant for late-night UAE activity.
 */
export function uaeDayOfWeek(date: Date): number {
  const shifted = new Date(date.getTime() + UAE_OFFSET_MS);
  return shifted.getUTCDay();
}
