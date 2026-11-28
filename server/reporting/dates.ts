/**
 * Report date handling. Every report boundary is a UAE calendar date
 * ("YYYY-MM-DD"); the SQL layer compares the entry's UAE-local date against
 * it, so a 23:00 UAE posting on 31 Dec never slips into the next year.
 */
import { DomainError } from "../errors";
import { parseIsoDate } from "../../shared/validators/primitives";

export type IsoDate = string;

/** Parse a report date or throw 400 INVALID_REPORT_DATE. `null`/`undefined`/"" -> null. */
export function parseReportDate(value: unknown, field: string): IsoDate | null {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) value = value[0];
  const iso = parseIsoDate(value);
  if (!iso) {
    throw new DomainError(
      "INVALID_REPORT_DATE",
      400,
      { field, value: String(value).slice(0, 40) },
      `${field} must be a real calendar date in YYYY-MM-DD format`
    );
  }
  return iso;
}

/** Today's UAE calendar date. */
export function uaeToday(now: Date = new Date()): IsoDate {
  return new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
}

function parts(iso: IsoDate): [number, number, number] {
  return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))];
}

function fmt(y: number, m: number, d: number): IsoDate {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(iso);
  return fmt(y, m, d + days);
}

/** Same day `months` later, clamped to the month end (31 Jan + 1 -> 28/29 Feb). */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const [y, m, d] = parts(iso);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return fmt(y, m + months, Math.min(d, last));
}

export function monthStart(iso: IsoDate): IsoDate {
  const [y, m] = parts(iso);
  return fmt(y, m, 1);
}

export function monthEnd(iso: IsoDate): IsoDate {
  const [y, m] = parts(iso);
  return fmt(y, m + 1, 0);
}

export function daysBetween(fromIso: IsoDate, toIso: IsoDate): number {
  return Math.round(
    (Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / 86400_000
  );
}

/** First day of the fiscal year containing `iso` (fiscal year starts on day 1 of `startMonth`). */
export function fiscalYearStart(iso: IsoDate, startMonth = 1): IsoDate {
  const sm = Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12 ? startMonth : 1;
  const [y, m] = parts(iso);
  return fmt(m >= sm ? y : y - 1, sm, 1);
}

export function fiscalYearEnd(iso: IsoDate, startMonth = 1): IsoDate {
  return addDays(addMonths(fiscalYearStart(iso, startMonth), 12), -1);
}

export interface ReportRange {
  from: IsoDate | null;
  to: IsoDate;
}

/**
 * Unified range params (R12-05): accepts from/to, startDate/endDate and
 * periodStart/periodEnd. `to` defaults to today (UAE). Throws 400 for bad
 * dates or from > to.
 */
export function readRange(
  query: Record<string, unknown>,
  opts: { requireFrom?: boolean; defaultTo?: IsoDate } = {}
): ReportRange {
  const from =
    parseReportDate(query.from, "from") ??
    parseReportDate(query.startDate, "startDate") ??
    parseReportDate(query.periodStart, "periodStart");
  const to =
    parseReportDate(query.to, "to") ??
    parseReportDate(query.endDate, "endDate") ??
    parseReportDate(query.periodEnd, "periodEnd") ??
    opts.defaultTo ??
    uaeToday();
  if (opts.requireFrom && !from) {
    throw new DomainError(
      "REPORT_RANGE_REQUIRED",
      400,
      undefined,
      "from (or startDate) is required"
    );
  }
  if (from && from > to) {
    throw new DomainError(
      "INVALID_REPORT_RANGE",
      400,
      { from, to },
      "from must be on or before to"
    );
  }
  return { from, to };
}

/** asOf / asOfDate / to / endDate, default today. */
export function readAsOf(query: Record<string, unknown>): IsoDate {
  return (
    parseReportDate(query.asOf, "asOf") ??
    parseReportDate(query.asOfDate, "asOfDate") ??
    parseReportDate(query.to, "to") ??
    parseReportDate(query.endDate, "endDate") ??
    uaeToday()
  );
}

export type Granularity = "month" | "quarter" | "year";

/** Calendar buckets covering [from, to]; first/last bucket clipped to the range. */
export function buckets(
  from: IsoDate,
  to: IsoDate,
  granularity: Granularity,
  maxBuckets = 60
): Array<{ label: string; from: IsoDate; to: IsoDate }> {
  const out: Array<{ label: string; from: IsoDate; to: IsoDate }> = [];
  const step = granularity === "month" ? 1 : granularity === "quarter" ? 3 : 12;
  let [y, m] = parts(from);
  if (granularity === "quarter") m = Math.floor((m - 1) / 3) * 3 + 1;
  if (granularity === "year") m = 1;
  let start = fmt(y, m, 1);
  while (start <= to) {
    const end = addDays(addMonths(start, step), -1);
    const [sy, sm] = parts(start);
    const label =
      granularity === "month"
        ? start.slice(0, 7)
        : granularity === "quarter"
          ? `Q${Math.floor((sm - 1) / 3) + 1} ${sy}`
          : String(sy);
    out.push({ label, from: start < from ? from : start, to: end > to ? to : end });
    if (out.length > maxBuckets) {
      throw new DomainError(
        "REPORT_TOO_MANY_COLUMNS",
        400,
        { maxBuckets },
        `The range produces more than ${maxBuckets} ${granularity} columns`
      );
    }
    start = addMonths(start, step);
    [y, m] = parts(start);
  }
  return out;
}
