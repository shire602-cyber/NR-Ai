/**
 * Calendar days. A document date is a CALENDAR DAY ("2026-10-01"), not an instant.
 *
 * The date pickers hand back a Date at LOCAL midnight. Serialised with JSON (toISOString) that is the previous
 * day in UTC for anyone east of Greenwich: a UAE user picking 1 August sent 2026-07-31T20:00Z and the document
 * landed in July's VAT period. So every Date leaving the client is sent as the local calendar day, and every date
 * shown is the UAE calendar day (Asia/Dubai), whatever the browser's own time zone is.
 */

export const UAE_TIME_ZONE = "Asia/Dubai";

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar day a picker shows ("2026-10-01"): the Date's LOCAL year, month and day, never a UTC shift. */
export function toYmd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A calendar day as a picker value: that day at local midnight (never `new Date("2026-10-01")`, which is UTC midnight). */
export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** The UAE calendar day of a stored value: "2026-10-01", "2026-10-01T00:00:00Z" or "2026-09-30T20:00:00Z" -> 2026-10-01. */
export function uaeDayOf(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: UAE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Today in the UAE ("2026-10-02"): what "today" means for a document, however late or early it is in the browser's zone. */
export function todayYmd(now: Date = new Date()): string {
  return uaeDayOf(now);
}

/** A stored value as a picker value (the UAE calendar day at local midnight). */
export function pickerDate(value: string | Date | null | undefined): Date | undefined {
  const ymd = uaeDayOf(value);
  return ymd ? parseYmd(ymd) : undefined;
}

/**
 * JSON.stringify replacer: a Date becomes its local calendar day. It reads the original value from `this`
 * (JSON has already called toJSON on the value it passes in).
 */
export function calendarDateReplacer(this: unknown, key: string, value: unknown): unknown {
  const original = (this as Record<string, unknown> | undefined)?.[key];
  return original instanceof Date && !Number.isNaN(original.getTime()) ? toYmd(original) : value;
}

/** JSON for a request body: dates leave as calendar days. */
export function stringifyBody(data: unknown): string {
  return JSON.stringify(data, calendarDateReplacer);
}

/** A long date for the picker button and lists, in the UI language, Western digits, the UAE day. */
export function formatCalendarDate(value: string | Date | null | undefined, locale: string, style: "long" | "short" = "long"): string {
  const ymd = uaeDayOf(value);
  if (!ymd) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-AE", {
    timeZone: "UTC",
    year: "numeric",
    month: style === "long" ? "long" : "short",
    day: "numeric",
  }).format(parseYmdUtc(ymd));
}

function parseYmdUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
