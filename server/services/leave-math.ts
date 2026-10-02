// Leave maths (UAE Federal Decree-Law 33/2021). Pure: no database.
//
//   - annual leave accrues per COMPLETED service month: 0 in months 1-6, 2 days in months 7-12, 2.5 days from
//     month 13 on (30 days a year); other types are granted `annualDays` at the start of each calendar year;
//   - the leave year is the calendar year; carry-forward is min(the type's maximum, last year's closing);
//   - sick leave pays in tiers over the calendar year (Art. 31): the first 15 days full, the next 30 half, the
//     rest unpaid;
//   - the daily wage is the FULL monthly wage (basic plus allowances) / 30: an unpaid day deducts wage/30, a half-pay
//     day wage/60, and sick-leave tiers use the same wage (Art. 31 speaks of wage, not basic).
// Dates are YYYY-MM-DD strings (UAE calendar days).

import Decimal from "decimal.js";

const r2 = (v: Decimal.Value): number => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

export interface LeaveTypeMath {
  code: string;
  payPolicy: string;
  annualDays: number;
  accrual: "monthly_service" | "annual" | "none";
  carryForwardMaxDays: number;
  allowNegative: boolean;
}

const parse = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
};
const dayNumber = (ymd: string): number => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");
const ymdOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const addDays = (ymd: string, days: number): string => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Days per completed service month: 0 in months 1-6, 2 in months 7-12, then the type's annual days / 12 (2.5 for 30). */
export function accrualRateForServiceMonth(serviceMonth: number, annualDays = 30): number {
  if (serviceMonth <= 6) return 0;
  if (serviceMonth <= 12) return 2;
  return r2(new Decimal(annualDays).div(12));
}

/** The date the k-th service month completes (the join day-of-month, clamped to a short month). */
function completionDate(joinYmd: string, k: number): string {
  const { y, m, d } = parse(joinYmd);
  const total = y * 12 + (m - 1) + k;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return ymdOf(year, month, Math.min(d, lastDayOfMonth(year, month)));
}

/** The last day of service month k: it is earned (credited) at the END of that month, not a month later. */
function creditDate(joinYmd: string, k: number): string {
  const completion = completionDate(joinYmd, k);
  return new Date(Date.parse(`${completion}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Service months earned by `asOfYmd`: month k counts on its last day (a join on 1 Jan: month 1 on 31 Jan). */
export function completedServiceMonths(joinYmd: string, asOfYmd: string): number {
  if (asOfYmd < joinYmd) return 0;
  const a = parse(joinYmd);
  const b = parse(asOfYmd);
  let months = (b.y - a.y) * 12 + (b.m - a.m) + 1;
  while (months > 0 && creditDate(joinYmd, months) > asOfYmd) months--;
  return Math.max(0, months);
}

/** Days accrued in `year` up to `asOfYmd` (monthly service accrual or the annual grant). */
export function accruedInYear(type: LeaveTypeMath, joinYmd: string, year: number, asOfYmd: string): number {
  const yearStart = ymdOf(year, 1, 1);
  const yearEnd = ymdOf(year, 12, 31);
  const to = asOfYmd < yearEnd ? asOfYmd : yearEnd;
  if (to < yearStart) return 0;
  if (type.accrual === "none") return 0;
  if (type.accrual === "annual") {
    // Granted in full for every calendar year of service (from the year of joining).
    return parse(joinYmd).y <= year && to >= yearStart ? type.annualDays : 0;
  }
  let total = new Decimal(0);
  const completed = completedServiceMonths(joinYmd, to);
  for (let k = 1; k <= completed; k++) {
    if (creditDate(joinYmd, k) >= yearStart) total = total.plus(accrualRateForServiceMonth(k, type.annualDays));
  }
  return r2(total);
}

export interface YearOverride {
  opening?: number | null;
  adjustment?: number;
}

export interface LeaveBalanceResult {
  year: number;
  opening: number;
  accrued: number;
  adjustment: number;
  taken: number;
  balance: number;
}

/** Balance of one employee, type and calendar year (the year of `asOfYmd`). */
export function leaveBalance(args: {
  type: LeaveTypeMath;
  joinYmd: string;
  asOfYmd: string;
  /** Approved days falling in a calendar year. */
  takenInYear: (year: number) => number;
  overrides: Map<number, YearOverride>;
  /**
   * The first calendar year the company has records in this system. Leave earned before it is not known, so nothing is
   * carried into that year unless an opening balance was entered (no invented carry-forward).
   */
  trackingStartYear?: number;
  /**
   * Prior service: the days the company already held for the employee on `openingAsOfYmd` (opening_leave_days). They are
   * the opening balance of that date's year; accrual and leave taken count from the next day on.
   */
  openingDays?: number;
  openingAsOfYmd?: string;
  /** Approved days (any pay policy) falling between two dates, inclusive. Falls back to the whole year. */
  takenBetween?: (fromYmd: string, toYmd: string) => number;
  /**
   * Unpaid-leave days between two dates, inclusive. Unpaid absence is not service (Decree-Law 33/2021): each unpaid
   * day takes annualDays / 360 off a monthly-service accrual (2.5 days a month = 1/12 day per unpaid day).
   */
  unpaidDaysBetween?: (fromYmd: string, toYmd: string) => number;
}): LeaveBalanceResult {
  const year = parse(args.asOfYmd).y;
  const joinYear = parse(args.joinYmd).y;

  const closing = (y: number): number => {
    const b = at(y, ymdOf(y, 12, 31));
    return b.balance;
  };
  const at = (y: number, asOf: string): LeaveBalanceResult => {
    const override = args.overrides.get(y);
    const openingYear = args.openingAsOfYmd && args.openingDays !== undefined ? parse(args.openingAsOfYmd).y : undefined;
    const fromOpening = openingYear === y ? addDays(args.openingAsOfYmd!, 1) : null;
    let opening: number;
    if (override?.opening !== undefined && override.opening !== null) opening = Number(override.opening);
    else if (fromOpening) opening = Number(args.openingDays);
    else if (y > joinYear && ((args.trackingStartYear === undefined || y > args.trackingStartYear) || (openingYear !== undefined && y > openingYear))) opening = r2(Math.min(args.type.carryForwardMaxDays, Math.max(0, closing(y - 1))));
    else opening = 0;
    const yearStart = ymdOf(y, 1, 1);
    const yearEnd = ymdOf(y, 12, 31);
    const to = asOf < yearEnd ? asOf : yearEnd;
    const from = fromOpening && !(override?.opening !== undefined && override.opening !== null) ? fromOpening : yearStart;
    let accrued = accruedInYear(args.type, args.joinYmd, y, asOf);
    if (from !== yearStart) accrued = Math.max(0, r2(new Decimal(accrued).minus(accruedInYear(args.type, args.joinYmd, y, addDays(from, -1)))));
    if (args.type.accrual === "monthly_service" && args.unpaidDaysBetween && to >= from) {
      const unpaid = args.unpaidDaysBetween(from, to);
      if (unpaid > 0) accrued = Math.max(0, r2(new Decimal(accrued).minus(new Decimal(unpaid).times(args.type.annualDays).div(360))));
    }
    const adjustment = Number(override?.adjustment ?? 0);
    const taken = from !== yearStart && args.takenBetween ? args.takenBetween(from, to) : args.takenInYear(y);
    return { year: y, opening, accrued, adjustment, taken, balance: r2(opening + accrued + adjustment - taken) };
  };
  return at(year, args.asOfYmd);
}

/** Calendar days from start to end inclusive. */
export function spanDays(startYmd: string, endYmd: string): number {
  return dayNumber(endYmd) - dayNumber(startYmd) + 1;
}

/** The part of a request that falls in [rangeStart, rangeEnd]; a request counted in fewer days than its span is apportioned. */
export function daysInRange(request: { startYmd: string; endYmd: string; days: number }, rangeStart: string, rangeEnd: string): number {
  const start = request.startYmd > rangeStart ? request.startYmd : rangeStart;
  const end = request.endYmd < rangeEnd ? request.endYmd : rangeEnd;
  if (end < start) return 0;
  const overlap = spanDays(start, end);
  const span = spanDays(request.startYmd, request.endYmd);
  return span === request.days ? overlap : r2(new Decimal(request.days).times(overlap).div(span));
}

/** Sick leave pay tiers: positions 1-15 of the year are full pay, 16-45 half pay, beyond that unpaid. */
export function sickTierSplit(daysBefore: number, days: number): { full: number; half: number; unpaid: number } {
  const slice = (from: number, to: number) => Math.max(0, Math.min(daysBefore + days, to) - Math.max(daysBefore, from));
  return { full: r2(slice(0, 15)), half: r2(slice(15, 45)), unpaid: r2(slice(45, Number.POSITIVE_INFINITY)) };
}

/** What a stretch of leave in one pay period takes off an employee's pay (at most 30 paid days, never more than the wage). */
export function leaveDeduction(args: { payPolicy: string; wage: number; days: number; sickDaysBefore: number }): {
  unpaidDays: number;
  halfDays: number;
  deduction: number;
} {
  let unpaidDays = 0;
  let halfDays = 0;
  if (args.payPolicy === "unpaid") unpaidDays = args.days;
  else if (args.payPolicy === "half") halfDays = args.days;
  else if (args.payPolicy === "sick_tiered") {
    const t = sickTierSplit(args.sickDaysBefore, args.days);
    unpaidDays = t.unpaid;
    halfDays = t.half;
  }
  // Daily wage is wage / 30 and a month never costs more than 30 paid days: a 31-day unpaid month deducts the
  // whole wage, not 31/30 of it.
  const paidDayEquivalents = Decimal.min(30, new Decimal(unpaidDays).plus(new Decimal(halfDays).div(2)));
  const deduction = r2(new Decimal(args.wage).div(30).times(paidDayEquivalents));
  return { unpaidDays, halfDays, deduction };
}
