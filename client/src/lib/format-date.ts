/**
 * The one display-date formatter (D2b, CTO checkpoint issue 7).
 *
 * - Single dates: `d MMM yyyy` -> "16 Nov 2026" / "16 نوفمبر 2026".
 * - Ranges collapse shared parts: "1–16 Nov 2026", "28 Oct – 16 Nov 2026",
 *   "28 Dec 2025 – 3 Jan 2026".
 * - Arabic uses ar-AE month names with Latin digits (no Arabic-Indic numerals).
 * - `YYYY-MM-DD` strings are read as calendar dates (no time-zone shift).
 * Machine formats (export cells, file names, query keys) must not use these helpers.
 */

import { boundaryCalendarParts } from "@shared/uae-date";
import { isolateLtrText, isolateRtlText } from "./format-bidi";

export type DateInput = Date | string | number | null | undefined;

// The UAE UI uses Gregorian dates and Latin digits in both languages.
export const ARABIC_DISPLAY_LOCALE = "ar-AE-u-ca-gregory-nu-latn";

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A Date whose local Y/M/D is the calendar day the value stands for (N1). `YYYY-MM-DD` strings
 * and stored business dates (instants on a UTC or UAE day boundary, such as a period end of
 * `2026-09-30T23:59:59.999Z`) become local midnight of that day, so a Dubai or Los Angeles
 * browser shows the same "30 Sep 2026" as a UTC one. Other instants are timestamps and keep
 * their instant (read in the viewer's zone).
 */
export function toCalendarDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const m = ISO_DAY.exec(value.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = value instanceof Date ? value : new Date(value);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  const day = boundaryCalendarParts(ms);
  // A local midnight is already the calendar day it shows (date pickers, `new Date(y, m, d)`).
  if (!day || isLocalMidnight(d)) return d;
  return new Date(day.year, day.month - 1, day.day);
}

function isLocalMidnight(d: Date): boolean {
  return (
    d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0
  );
}

/**
 * `toCalendarDate` for code that needs a Date (date-fns `format`, comparisons): an Invalid Date
 * instead of null, like `parseISO`. Use it for business dates read from the API.
 */
export function parseCalendarDate(value: DateInput): Date {
  return toCalendarDate(value) ?? new Date(Number.NaN);
}

/** `YYYY-MM-DD` of `toCalendarDate` (machine use: query params, file names); "" if invalid. */
export function calendarDayKey(value: DateInput): string {
  const d = toCalendarDate(value);
  if (!d) return "";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, "0")}`;
}

// English abbreviations are fixed: ICU's en-GB gives "Sept" for September while every
// other month is three letters, so "30 Sept 2026" sat next to "Sep 2026" (Fable P8).
const EN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const arabicMonthFormatter = new Intl.DateTimeFormat(ARABIC_DISPLAY_LOCALE, { month: "long" });
function monthName(date: Date, locale: string): string {
  return locale === "ar" ? arabicMonthFormatter.format(date) : EN_MONTHS[date.getMonth()];
}

/** "16 Nov 2026" / "16 نوفمبر 2026"; "" for an empty or invalid value. */
export function formatDate(value: DateInput, locale: string = "en"): string {
  const d = toCalendarDate(value);
  if (!d) return "";
  return `${d.getDate()} ${monthName(d, locale)} ${d.getFullYear()}`;
}

/** "Nov 2026" / "نوفمبر 2026". */
export function formatMonthYear(value: DateInput, locale: string = "en"): string {
  const d = toCalendarDate(value);
  if (!d) return "";
  return `${monthName(d, locale)} ${d.getFullYear()}`;
}

const EN_DASH = "–";

interface DateRangeOptions {
  /** Use plain text for workbooks and external document titles. */
  plain?: boolean;
}

/** "1–16 Nov 2026", "28 Oct – 16 Nov 2026", "28 Dec 2025 – 3 Jan 2026". */
export function formatDateRange(
  from: DateInput,
  to: DateInput,
  locale: string = "en",
  { plain = false }: DateRangeOptions = {}
): string {
  const a = toCalendarDate(from);
  const b = toCalendarDate(to);
  if (!a && !b) return "";
  if (!a) return formatDate(b, locale);
  if (!b) return formatDate(a, locale);
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  if (sameMonth && a.getDate() === b.getDate()) return formatDate(a, locale);
  if (sameMonth) {
    const days = `${a.getDate()}${EN_DASH}${b.getDate()}`;
    // The neutral dash otherwise reverses the two days in an RTL paragraph.
    const displayDays = locale === "ar" && !plain ? isolateLtrText(days) : days;
    return `${displayDays} ${monthName(b, locale)} ${b.getFullYear()}`;
  }
  if (sameYear) {
    return `${a.getDate()} ${monthName(a, locale)} ${EN_DASH} ${b.getDate()} ${monthName(
      b,
      locale
    )} ${b.getFullYear()}`;
  }
  return `${formatDate(a, locale)} ${EN_DASH} ${formatDate(b, locale)}`;
}

const RANGE_IN_TEXT =
  /(?<![\w/-])(\d{4}-\d{2}-\d{2})\s+(?:to|إلى|–|-)\s+(\d{4}-\d{2}-\d{2})(?![\w-])/g;
const DAY_IN_TEXT = /(?<![\w/-])(\d{4}-\d{2}-\d{2})(?![\w-])/g;
const MONTH_IN_TEXT = /(?<![\w/-])(\d{4})-(0[1-9]|1[0-2])(?![\w-])/g;

/**
 * Re-format machine dates inside server text (B6): "2026-07-01 to 2026-09-30" ->
 * "1 Jul – 30 Sep 2026", "2026-11-17" -> "17 Nov 2026", "2026-11" -> "Nov 2026". Codes such
 * as "INV-2026-01" are left alone (a date must not touch a letter, digit, "-" or "/").
 */
export function formatEmbeddedDates(
  text: string,
  locale: string = "en",
  options?: DateRangeOptions
): string {
  if (!text) return text;
  return text
    .replace(RANGE_IN_TEXT, (_m, a: string, b: string) => formatDateRange(a, b, locale, options))
    .replace(DAY_IN_TEXT, (_m, d: string) => formatDate(d, locale))
    .replace(MONTH_IN_TEXT, (_m, y: string, mo: string) =>
      formatMonthYear(`${y}-${mo}-01`, locale)
    );
}

const TRAILING_PERIOD =
  /^(.*?\S)\s+(?:FY\s+)?(\d{4}-\d{2}-\d{2}\s+(?:to|إلى)\s+\d{4}-\d{2}-\d{2})$/;

/**
 * Compliance obligation / task title for display (B6). The calendar generates titles such as
 * "VAT return 2026-07-01 to 2026-09-30" and "Pay 2026-11 salaries through WPS"; they read
 * "VAT return, 1 Jul – 30 Sep 2026" and "Pay Nov 2026 salaries through WPS", the same period
 * style as the firm practice workspace. Other titles only get their dates re-formatted.
 */
export function displayObligationTitle(title: string, locale: string = "en"): string {
  if (!title) return title;
  const m = TRAILING_PERIOD.exec(title.trim());
  if (m) {
    return `${m[1]}${locale === "ar" ? "، " : ", "}${formatEmbeddedDates(m[2], locale)}`;
  }
  return formatEmbeddedDates(title, locale);
}

function toInstant(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && ISO_DAY.test(value.trim())) return toCalendarDate(value);
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "14:05": 24-hour clock with Latin digits in both languages. */
export function formatTime(value: DateInput): string {
  const d = toInstant(value);
  if (!d) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * "16 Nov 2026, 14:05" / "16 نوفمبر 2026، 14:05" as plain text, with no bidi control characters:
 * for spreadsheets, CSV and anything that is not shown on screen. Use `formatDateTime` for the UI.
 */
export function formatDateTimePlain(value: DateInput, locale: string = "en"): string {
  const parts = dateTimeParts(value, locale);
  return parts ? `${parts.date}${parts.separator}${parts.time}` : "";
}

function dateTimeParts(
  value: DateInput,
  locale: string
): { date: string; time: string; separator: string } | null {
  const d = toInstant(value);
  if (!d) return null;
  // A timestamp: day and time both in the viewer's zone (never the calendar-day reading).
  return {
    date: `${d.getDate()} ${monthName(d, locale)} ${d.getFullYear()}`,
    time: formatTime(d),
    separator: locale === "ar" ? "، " : ", ",
  };
}

/**
 * "16 Nov 2026, 14:05" / "16 نوفمبر 2026، 14:05": one line, for logs and timestamps on screen.
 * In Arabic the date and the time are separate bidi isolates inside one right-to-left run, so the
 * day number stays at the start of the date and the time never flips into the middle, wherever the
 * text sits (a flex row, a table cell, a sentence).
 */
export function formatDateTime(value: DateInput, locale: string = "en"): string {
  const parts = dateTimeParts(value, locale);
  if (!parts) return "";
  if (locale !== "ar") return `${parts.date}${parts.separator}${parts.time}`;
  return isolateRtlText(
    `${isolateRtlText(parts.date)}${parts.separator}${isolateLtrText(parts.time)}`
  );
}
