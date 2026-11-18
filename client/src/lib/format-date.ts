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

export type DateInput = Date | string | number | null | undefined;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toCalendarDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const m = ISO_DAY.exec(value.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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

const monthFormatters = new Map<string, Intl.DateTimeFormat>();
function monthName(date: Date, locale: string): string {
  if (locale !== "ar") return EN_MONTHS[date.getMonth()];
  const tag = "ar-AE-u-nu-latn";
  let f = monthFormatters.get(tag);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, { month: "long" });
    monthFormatters.set(tag, f);
  }
  return f.format(date);
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

/** "1–16 Nov 2026", "28 Oct – 16 Nov 2026", "28 Dec 2025 – 3 Jan 2026". */
export function formatDateRange(from: DateInput, to: DateInput, locale: string = "en"): string {
  const a = toCalendarDate(from);
  const b = toCalendarDate(to);
  if (!a && !b) return "";
  if (!a) return formatDate(b, locale);
  if (!b) return formatDate(a, locale);
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  if (sameMonth && a.getDate() === b.getDate()) return formatDate(a, locale);
  if (sameMonth) {
    return `${a.getDate()}${EN_DASH}${b.getDate()} ${monthName(b, locale)} ${b.getFullYear()}`;
  }
  if (sameYear) {
    return `${a.getDate()} ${monthName(a, locale)} ${EN_DASH} ${b.getDate()} ${monthName(
      b,
      locale
    )} ${b.getFullYear()}`;
  }
  return `${formatDate(a, locale)} ${EN_DASH} ${formatDate(b, locale)}`;
}

/** "14:05": 24-hour clock with Latin digits in both languages. */
export function formatTime(value: DateInput): string {
  const d = toCalendarDate(value);
  if (!d) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "16 Nov 2026, 14:05" / "16 نوفمبر 2026، 14:05": one line, for logs and timestamps. */
export function formatDateTime(value: DateInput, locale: string = "en"): string {
  const d = toCalendarDate(value);
  if (!d) return "";
  return `${formatDate(d, locale)}${locale === "ar" ? "، " : ", "}${formatTime(d)}`;
}
