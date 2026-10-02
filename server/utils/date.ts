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
  return new Date(Date.parse(ymd + "T00:00:00Z") - UAE_OFFSET_MS);
}

/**
 * Returns the UTC instant corresponding to 23:59:59.999 in UAE time on the
 * given 'YYYY-MM-DD' date.
 */
export function uaeDayEnd(date: string | Date): Date {
  const ymd = toYmd(date);
  return new Date(Date.parse(ymd + "T00:00:00Z") + 24 * 60 * 60 * 1000 - 1 - UAE_OFFSET_MS);
}

function toYmd(date: string | Date): string {
  if (typeof date === "string") {
    // Allow full ISO strings — keep only the date portion.
    return date.length >= 10 ? date.slice(0, 10) : date;
  }
  // Use UTC components so parsing 'YYYY-MM-DD' (which becomes UTC midnight)
  // round-trips back to the same date.
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
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
  const ymd = `${year}-${String(month + 1).padStart(2, "0")}-01`;
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
  const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return uaeDayEnd(ymd);
}

/**
 * Returns the UTC instant of 00:00 UAE on today's UAE calendar date.
 */
export function uaeTodayStart(now: Date = new Date()): Date {
  const { year, month, day } = uaeYmdParts(now);
  const ymd = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return uaeDayStart(ymd);
}

/**
 * The accounting date of an instant: UTC midnight of its UAE calendar day. Journal entry dates
 * are read as `date::date` in SQL (the ledger, the VAT engines), so a posting made at 01:30 UAE on
 * 1 October must be stored as 2026-10-01T00:00Z, not as its 21:30Z instant of 30 September.
 */
export function uaeCalendarDate(now: Date = new Date()): Date {
  const { year, month, day } = uaeYmdParts(now);
  return new Date(Date.UTC(year, month, day));
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

/**
 * Canonicalise a calendar-date input to 'YYYY-MM-DD' for writing to a
 * `timestamp without time zone` column via raw SQL.
 *  - a bare date, or a datetime with NO offset, keeps its own date part;
 *  - an instant (trailing 'Z' or ±hh:mm offset, or a Date) becomes its UAE
 *    calendar day — so a browser's `new Date(2026, 8, 29).toISOString()`
 *    ("2026-09-28T20:00:00.000Z" for a UAE user) is the 29th, not the 28th.
 */
export function toCalendarYmd(value: string | Date): string {
  if (typeof value === "string") {
    const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
    if (/^\d{4}-\d{2}-\d{2}/.test(value) && !(value.length > 10 && hasOffset)) {
      return value.slice(0, 10);
    }
  }
  const d = value instanceof Date ? value : new Date(value);
  const { year, month, day } = uaeYmdParts(d);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * node-pg parses a `timestamp without time zone` value as SERVER-LOCAL time.
 * A date-only column written as '2026-09-29' therefore comes back on a UAE
 * host as 2026-09-28T20:00:00Z — the prior day/month in UTC (and in every
 * `.toISOString().slice(0,10)` downstream). Drizzle-managed tables (invoices)
 * treat the same column type as UTC, so this converts a raw-SQL read to that
 * same convention: the local Y/M/D becomes UTC midnight of the same calendar
 * day. Identity on a UTC host. Non-Date values pass through unchanged.
 */
export function localWallDateToUtcMidnight<T>(value: T): T | Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return value;
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
}

/** Apply localWallDateToUtcMidnight to the named columns of a raw-SQL row. */
export function normalizeCalendarColumns<R extends Record<string, any>>(
  row: R,
  columns: readonly string[]
): R {
  if (!row) return row;
  const out: Record<string, any> = { ...row };
  for (const c of columns) {
    if (c in out) out[c] = localWallDateToUtcMidnight(out[c]);
  }
  return out as R;
}

/**
 * THE document-date contract (Phase 9, teardown F1). Every document or posting date a client sends is accepted as
 *  - a calendar day "YYYY-MM-DD" (what the pickers should send), or
 *  - an ISO instant ("2026-09-30T20:00:00.000Z"), which is converted to the UAE calendar day it falls on, or
 *  - a datetime with no offset, which keeps its own date part,
 * and is stored as UTC midnight of that calendar day. Documents are `timestamp without time zone` columns read as
 * `date::date` by the ledger, the VAT engines, the P&L and the ageing, so storing the day this way makes all of them
 * read the same UAE day. Returns null for anything that is not a real date (2026-02-30, "abc", empty).
 */
export function parseCalendarDay(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(text) && text.length > 10;
    if (m && !hasOffset) {
      const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}` ? d : null;
    }
  }
  const instant = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  if (!instant || Number.isNaN(instant.getTime())) return null;
  return uaeCalendarDate(instant);
}

/** Same as parseCalendarDay but today (UAE) when nothing was sent. */
export function parseCalendarDayOrToday(value: unknown): Date | null {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return uaeCalendarDate();
  return parseCalendarDay(value);
}

/** 'YYYY-MM-DD' of a stored or parsed calendar date (its UTC date part). */
export const calendarDayYmd = (d: Date): string => d.toISOString().slice(0, 10);
