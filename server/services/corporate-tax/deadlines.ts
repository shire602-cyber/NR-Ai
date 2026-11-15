/**
 * Pure date maths for UAE filing deadlines (R08-03, R08-21). No imports, no
 * Date-with-timezone arithmetic: every value is a calendar date "YYYY-MM-DD".
 *
 * - Corporate tax return and payment: 9 months after the end of the tax
 *   period (FDL 47/2022 Art. 53(1), Art. 48(1)). A period ending on the last
 *   day of a month is due on the last day of the 9th following month (end-of-
 *   month rule): FY ending 31 Dec 2025 -> 30 Sep 2026 (JS setMonth would give
 *   1 Oct). Other dates clamp to the target month's length.
 * - VAT return and payment: 28 days after the end of the tax period
 *   (FDL 8/2017 Art. 64; Executive Regulation Art. 59).
 */

export type IsoDate = string;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function lastDayOfMonth(year: number, month: number): IsoDate {
  return `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
}

function parts(date: IsoDate): [number, number, number] {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

export function isMonthEnd(date: IsoDate): boolean {
  const [y, m, d] = parts(date);
  return d === daysInMonth(y, m);
}

/**
 * Add calendar months. A month-end date stays a month-end date; any other
 * day clamps to the target month's last day when it does not exist.
 */
export function addMonthsClamped(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = parts(date);
  const index = y * 12 + (m - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  const last = daysInMonth(ty, tm);
  const day = isMonthEnd(date) ? last : Math.min(d, last);
  return `${ty}-${pad(tm)}-${pad(day)}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** UAE calendar date (UTC+4) of an instant. */
export function uaeToday(now: Date = new Date()): IsoDate {
  return new Date(now.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
}

/** CT return and payment deadline: 9 months after the tax period end. */
export function ctFilingDeadline(periodEnd: IsoDate): IsoDate {
  return addMonthsClamped(periodEnd, 9);
}

/** VAT return and payment deadline: 28 days after the tax period end. */
export function vatFilingDeadline(periodEnd: IsoDate): IsoDate {
  return addDays(periodEnd, 28);
}

/** Excise return deadline: 15 days after the tax period end (Cabinet Decision 52/2019 as amended). */
export function exciseFilingDeadline(periodEnd: IsoDate): IsoDate {
  return addDays(periodEnd, 15);
}

export type VatFrequency = "monthly" | "quarterly" | "annual";

export function normalizeVatFrequency(raw: unknown): VatFrequency {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v.startsWith("month")) return "monthly";
  if (v.startsWith("annual") || v.startsWith("year")) return "annual";
  return "quarterly";
}

export interface TaxPeriod {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  dueDate: IsoDate;
}

/**
 * VAT tax periods whose DUE DATE falls in `year`. Quarterly periods follow
 * the FTA stagger: `startMonth` is the first month of a quarter (1, 2 or 3).
 */
export function vatPeriodsDueInYear(
  frequency: VatFrequency,
  startMonth: number,
  year: number
): TaxPeriod[] {
  const length = frequency === "monthly" ? 1 : frequency === "annual" ? 12 : 3;
  const anchor = Math.min(12, Math.max(1, Math.trunc(startMonth) || 1));
  const out: TaxPeriod[] = [];
  // Walk period starts from two years back; keep the ones due inside `year`.
  let index = (year - 2) * 12 + (anchor - 1);
  for (let guard = 0; guard < 80; guard += 1, index += length) {
    const sy = Math.floor(index / 12);
    const sm = (index % 12) + 1;
    const endIndex = index + length - 1;
    const ey = Math.floor(endIndex / 12);
    const em = (endIndex % 12) + 1;
    const periodEnd = lastDayOfMonth(ey, em);
    const dueDate = vatFilingDeadline(periodEnd);
    const dueYear = Number(dueDate.slice(0, 4));
    if (dueYear < year) continue;
    if (dueYear > year) break;
    out.push({ periodStart: `${sy}-${pad(sm)}-01`, periodEnd, dueDate });
  }
  return out;
}

/** Monthly periods (payroll/WPS, excise) whose due date falls in `year`. */
export function monthlyPeriodsDueInYear(
  year: number,
  dueOf: (periodEnd: IsoDate) => IsoDate
): TaxPeriod[] {
  const out: TaxPeriod[] = [];
  for (let index = (year - 1) * 12; index < (year + 1) * 12; index += 1) {
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const periodEnd = lastDayOfMonth(y, m);
    const dueDate = dueOf(periodEnd);
    if (dueDate.startsWith(`${year}-`)) {
      out.push({ periodStart: `${y}-${pad(m)}-01`, periodEnd, dueDate });
    }
  }
  return out;
}

/** Fiscal year [start, end] that ends in `endYear` for a fiscal-year start month. */
export function fiscalYearEndingIn(
  endYear: number,
  fiscalYearStartMonth: number
): { periodStart: IsoDate; periodEnd: IsoDate } {
  const sm = Math.min(12, Math.max(1, Math.trunc(fiscalYearStartMonth) || 1));
  if (sm === 1) return { periodStart: `${endYear}-01-01`, periodEnd: `${endYear}-12-31` };
  return {
    periodStart: `${endYear - 1}-${pad(sm)}-01`,
    periodEnd: lastDayOfMonth(endYear, sm - 1),
  };
}

/** Corporate tax periods whose filing deadline falls in `year`. */
export function ctPeriodsDueInYear(year: number, fiscalYearStartMonth: number): TaxPeriod[] {
  const out: TaxPeriod[] = [];
  for (const endYear of [year - 1, year]) {
    const fy = fiscalYearEndingIn(endYear, fiscalYearStartMonth);
    const dueDate = ctFilingDeadline(fy.periodEnd);
    if (dueDate.startsWith(`${year}-`)) out.push({ ...fy, dueDate });
  }
  return out;
}
