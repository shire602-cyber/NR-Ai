// Date presets for the report viewer (Phase 8 D4). Mirrors server/reports/params.ts: a preset resolves to concrete
// Dubai calendar days (UTC+4, no DST), so the viewer, a bookmarked link and a scheduled run agree on "last month".
// Pure: `now` and the company's fiscal-year start month are passed in. tests/unit/report-params-ui.test.ts checks
// every preset against the server's own resolver.

export const RANGE_PRESETS = [
  "thisMonth",
  "lastMonth",
  "thisQuarter",
  "lastQuarter",
  "thisYear",
  "lastYear",
  "last30Days",
  "last90Days",
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const AS_OF_PRESETS = ["today", "lastMonthEnd", "lastQuarterEnd", "lastYearEnd"] as const;
export type AsOfPreset = (typeof AS_OF_PRESETS)[number];

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");
const ymdOf = (year: number, month0: number, day: number) =>
  `${year}-${pad(month0 + 1)}-${pad(day)}`;
const utc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export function isYmd(value: unknown): value is string {
  if (typeof value !== "string" || !YMD.test(value)) return false;
  const d = utc(value);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today's Dubai calendar day. */
export function dubaiToday(now: Date = new Date()): string {
  return new Date(now.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(ymd: string, n: number): string {
  const d = utc(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function isMonthEnd(ymd: string): boolean {
  const d = utc(ymd);
  return d.getUTCDate() === lastDayOfMonth(d.getUTCFullYear(), d.getUTCMonth());
}

function addMonths(ymd: string, n: number): string {
  const d = utc(ymd);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
  const year = Math.floor(total / 12);
  const month0 = ((total % 12) + 12) % 12;
  return ymdOf(year, month0, Math.min(d.getUTCDate(), lastDayOfMonth(year, month0)));
}

/** A month-end date lands on the target month's last day (31 Mar minus a month is 28 or 29 Feb). */
function addMonthsKeepEnd(ymd: string, n: number): string {
  if (!isMonthEnd(ymd)) return addMonths(ymd, n);
  const d = utc(ymd);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
  const year = Math.floor(total / 12);
  const month0 = ((total % 12) + 12) % 12;
  return ymdOf(year, month0, lastDayOfMonth(year, month0));
}

const startOfMonth = (ymd: string) => `${ymd.slice(0, 7)}-01`;

function endOfMonth(ymd: string): string {
  const d = utc(ymd);
  return ymdOf(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    lastDayOfMonth(d.getUTCFullYear(), d.getUTCMonth())
  );
}

function startOfQuarter(ymd: string): string {
  const d = utc(ymd);
  return ymdOf(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
}

/** First day of the fiscal year containing `ymd`; `startMonth` is 1..12. */
export function fiscalYearStart(ymd: string, startMonth: number): string {
  const m = Math.min(12, Math.max(1, Math.trunc(startMonth) || 1));
  const d = utc(ymd);
  const year = d.getUTCMonth() + 1 >= m ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return ymdOf(year, m - 1, 1);
}

const minusOneYear = (ymd: string) => addMonths(ymd, -12);

export function resolveRangePreset(
  preset: RangePreset,
  now: Date,
  fiscalStartMonth = 1
): { from: string; to: string } {
  const today = dubaiToday(now);
  switch (preset) {
    case "thisMonth":
      return { from: startOfMonth(today), to: today };
    case "lastMonth": {
      const prev = addMonthsKeepEnd(startOfMonth(today), -1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case "thisQuarter":
      return { from: startOfQuarter(today), to: today };
    case "lastQuarter": {
      const start = addMonthsKeepEnd(startOfQuarter(today), -3);
      return { from: start, to: addDays(startOfQuarter(today), -1) };
    }
    case "thisYear":
      return { from: fiscalYearStart(today, fiscalStartMonth), to: today };
    case "lastYear": {
      const thisStart = fiscalYearStart(today, fiscalStartMonth);
      return { from: minusOneYear(thisStart), to: addDays(thisStart, -1) };
    }
    case "last30Days":
      return { from: addDays(today, -29), to: today };
    case "last90Days":
      return { from: addDays(today, -89), to: today };
  }
}

export function resolveAsOfPreset(preset: AsOfPreset, now: Date, fiscalStartMonth = 1): string {
  const today = dubaiToday(now);
  switch (preset) {
    case "today":
      return today;
    case "lastMonthEnd":
      return addDays(startOfMonth(today), -1);
    case "lastQuarterEnd":
      return addDays(startOfQuarter(today), -1);
    case "lastYearEnd":
      return addDays(fiscalYearStart(today, fiscalStartMonth), -1);
  }
}
