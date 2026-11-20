/**
 * Today's UAE calendar date (Asia/Dubai, UTC+4, no DST) as YYYY-MM-DD, the date the server's
 * posting kernel and period lock use (`uaeToday` in server/reporting/dates.ts). A default
 * posting date taken from the browser's UTC date is a day early between 00:00 and 04:00 UAE.
 * Client-safe (no imports).
 */
export function uaeToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const UAE_OFFSET_MS = 4 * HOUR_MS;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar date parts (month is 1-12). */
export interface CalendarParts {
  year: number;
  month: number;
  day: number;
}

export type CalendarInput = Date | string | number | null | undefined;

function utcParts(ms: number): CalendarParts {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The calendar day a stored business-date instant stands for, or null when the instant is an
 * ordinary timestamp (N1). Date-only values (period starts/ends, due dates, document dates,
 * fiscal years) reach the app as instants on a day boundary: UTC midnight
 * (`new Date("2026-09-30")`), UTC end of day (`2026-09-30T23:59:59.999Z`), or the UAE day
 * boundaries the reporting kernel uses (`uaeDayStart` = 20:00Z the day before, `uaeDayEnd` =
 * 19:59:59.999Z). Read in the viewer's zone they show "1 Oct" for a 30 Sep period end in Dubai
 * and "29 Sep" for a 30 Sep document date in Los Angeles, so they are read as the calendar day
 * they encode instead.
 */
export function boundaryCalendarParts(ms: number): CalendarParts | null {
  const msOfDay = ((ms % DAY_MS) + DAY_MS) % DAY_MS;
  const secOfDay = Math.floor(msOfDay / 1000);
  if (msOfDay === 0 || secOfDay === 86_399) return utcParts(ms); // UTC 00:00 / 23:59:59
  if (msOfDay === 20 * HOUR_MS || secOfDay === 20 * 3600 - 1) {
    return utcParts(ms + UAE_OFFSET_MS); // UAE 00:00 / 23:59:59
  }
  return null;
}

/**
 * Calendar day of a business date, independent of the process / browser time zone:
 * `YYYY-MM-DD` strings as written, day-boundary instants as the day they encode, any other
 * instant as its UAE wall-clock day. Null for an empty or invalid value. Server renderers
 * (PDF, email, statements) use this; the browser formatter (client/src/lib/format-date.ts)
 * reads ordinary timestamps in the viewer's zone instead of the UAE day.
 */
export function calendarParts(value: CalendarInput): CalendarParts | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const m = ISO_DAY.exec(value.trim());
    if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return boundaryCalendarParts(ms) ?? utcParts(ms + UAE_OFFSET_MS);
}

/** `calendarParts` as `YYYY-MM-DD` ("" for an empty or invalid value). */
export function calendarDateKey(value: CalendarInput): string {
  const p = calendarParts(value);
  if (!p) return "";
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
