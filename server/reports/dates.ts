// Dubai calendar-day helpers for the report engine. Every report boundary is a Dubai day (UTC+4, no DST,
// utils/date.ts). A day is passed around as 'YYYY-MM-DD'; SQL compares journal and document timestamps
// (UTC wall-clock `timestamp` columns) against the instants these helpers return.

import { uaeDayEnd, uaeDayStart, uaeYmdParts } from "../utils/date";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(value: unknown): value is string {
  if (typeof value !== "string" || !YMD.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const ymdOf = (y: number, m0: number, d: number): string => `${y}-${pad(m0 + 1)}-${pad(d)}`;

/** Today's Dubai calendar day. */
export function todayYmd(now: Date = new Date()): string {
  const { year, month, day } = uaeYmdParts(now);
  return ymdOf(year, month, day);
}

const utc = (ymd: string): Date => new Date(`${ymd}T00:00:00Z`);
const fromUtc = (d: Date): string => d.toISOString().slice(0, 10);

export function addDays(ymd: string, n: number): string {
  const d = utc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((utc(toYmd).getTime() - utc(fromYmd).getTime()) / 86_400_000);
}

export function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

export function isMonthEnd(ymd: string): boolean {
  const d = utc(ymd);
  return d.getUTCDate() === lastDayOfMonth(d.getUTCFullYear(), d.getUTCMonth());
}

/** Same day `n` months away; clamps to the target month's last day (31 Mar - 1 month = 28/29 Feb). */
export function addMonths(ymd: string, n: number): string {
  const d = utc(ymd);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
  const year = Math.floor(total / 12);
  const month0 = ((total % 12) + 12) % 12;
  return ymdOf(year, month0, Math.min(d.getUTCDate(), lastDayOfMonth(year, month0)));
}

/** Month-end-aware month step: a month-end date lands on the target month's last day. */
export function addMonthsKeepEnd(ymd: string, n: number): string {
  if (!isMonthEnd(ymd)) return addMonths(ymd, n);
  const d = utc(ymd);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
  const year = Math.floor(total / 12);
  const month0 = ((total % 12) + 12) % 12;
  return ymdOf(year, month0, lastDayOfMonth(year, month0));
}

/** One year earlier; 29 Feb becomes 28 Feb. */
export function minusOneYear(ymd: string): string {
  return addMonths(ymd, -12);
}

export function startOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function endOfMonth(ymd: string): string {
  const d = utc(ymd);
  return ymdOf(d.getUTCFullYear(), d.getUTCMonth(), lastDayOfMonth(d.getUTCFullYear(), d.getUTCMonth()));
}

/** First day of the fiscal year containing `ymd`. `startMonth` is 1..12 (companies.fiscal_year_start_month). */
export function fiscalYearStart(ymd: string, startMonth: number): string {
  const m = Math.min(12, Math.max(1, Math.trunc(startMonth) || 1));
  const d = utc(ymd);
  const year = d.getUTCMonth() + 1 >= m ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return ymdOf(year, m - 1, 1);
}

export function startOfQuarter(ymd: string): string {
  const d = utc(ymd);
  return ymdOf(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
}

/** Naive timestamp text of the first instant of the Dubai day, comparable to a `timestamp` column. */
export function dayStartTs(ymd: string): string {
  return uaeDayStart(ymd).toISOString().slice(0, 23);
}

/** Naive timestamp text of the last millisecond of the Dubai day. */
export function dayEndTs(ymd: string): string {
  return uaeDayEnd(ymd).toISOString().slice(0, 23);
}

/** SQL: the Dubai calendar day of a `timestamp` column holding a UTC instant, as 'YYYY-MM-DD'. */
export const ymdSql = (col: string): string => `to_char(${col} + INTERVAL '4 hours', 'YYYY-MM-DD')`;

/** Naive timestamp texts bounding the Dubai days `from`..`to` inclusive. */
export const dayBounds = (from: string, to: string): { start: string; end: string } => ({
  start: dayStartTs(from),
  end: dayEndTs(to),
});
