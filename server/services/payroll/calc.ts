/**
 * Pure payroll calculations (R09-24). Integer fils in, integer fils out; no
 * I/O. Statutory numbers come from PayrollLegalParams (./legal-params.ts) so
 * they stay configurable and reviewable by counsel.
 */
import Decimal from "decimal.js";
import { DomainError } from "../../errors";
import {
  DEFAULT_LEGAL_PARAMS,
  pensionCountry,
  pensionRuleFor,
  type PensionFund,
  type PayrollLegalParams,
  type PensionRule,
} from "./legal-params";

// ─── Integer helpers ─────────────────────────────────────────────────────────

/** round_half_up(a * num / den) on integers (exact, no float). */
export function mulDiv(a: number, num: number | string, den: number | string): number {
  const v = new Decimal(a).times(num).dividedBy(den).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const n = v.toNumber();
  return Object.is(n, -0) ? 0 : n;
}

/** Fils * fraction ("0.05"), rounded half-up. Zero rate -> 0. */
export function pct(fils: number, rate: string | number): number {
  return mulDiv(fils, rate, 1);
}

// ─── Dates ───────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
// R09-01: hard ceiling on service length; bounds arithmetic on absurd dates.
export const MAX_SERVICE_YEARS = 100;

export function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** Calendar date of a Date (UTC) as YYYY-MM-DD. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" -> Date at UTC midnight. */
export function utcDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + Math.round(days) * MS_PER_DAY);
}

export function daysBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY);
}

/** First and last calendar day of a payroll period (UTC). */
export function periodBounds(
  month: number,
  year: number
): { start: Date; end: Date; days: number } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start, end, days: end.getUTCDate() };
}

/**
 * Calendar-correct completed anniversaries between `start` and `end`, by date
 * arithmetic (no loop — R09-01). Invalid dates or end <= start -> 0 years.
 */
export function completedAnniversaries(
  start: Date,
  end: Date
): { years: number; lastAnniversary: Date } {
  if (!isValidDate(start) || !isValidDate(end) || end.getTime() <= start.getTime()) {
    return { years: 0, lastAnniversary: isValidDate(start) ? new Date(start) : new Date(NaN) };
  }
  const addYears = (n: number) => {
    const d = new Date(start);
    d.setFullYear(d.getFullYear() + n);
    return d;
  };
  let years = Math.min(end.getFullYear() - start.getFullYear(), MAX_SERVICE_YEARS);
  let anniversary = addYears(years);
  if (anniversary.getTime() > end.getTime()) {
    years -= 1;
    anniversary = addYears(years);
  }
  years = Math.max(0, years);
  return { years, lastAnniversary: years === 0 ? new Date(start) : anniversary };
}

// ─── Pension (GPSSA / GCC) ───────────────────────────────────────────────────

export interface WageComponents {
  basicFils: number;
  housingFils: number;
  transportFils: number;
  otherFils: number;
}

export function pensionBaseFils(w: WageComponents, rule: PensionRule): number {
  let base: number;
  switch (rule.base) {
    case "basic":
      base = w.basicFils;
      break;
    case "basic_housing":
      base = w.basicFils + w.housingFils;
      break;
    case "basic_housing_transport":
      base = w.basicFils + w.housingFils + w.transportFils;
      break;
    default:
      base = w.basicFils + w.housingFils + w.transportFils + w.otherFils;
  }
  if (rule.minContributionSalary !== null) {
    base = Math.max(base, mulDiv(1, rule.minContributionSalary, "0.01"));
  }
  if (rule.maxContributionSalary !== null) {
    base = Math.min(base, mulDiv(1, rule.maxContributionSalary, "0.01"));
  }
  return base;
}

export interface PensionResult {
  pensionable: boolean;
  country: string | null;
  /** gpssa | adpf | gcc (null when not pensionable). */
  fund: PensionFund | null;
  baseFils: number;
  employeeFils: number;
  employerFils: number;
  ruleConfirmed: boolean;
}

/** Pension contribution for one month (R09-06, R09-20). Non-GCC nationals: none. */
export function pensionContribution(
  w: WageComponents,
  nationality: string | null | undefined,
  params: PayrollLegalParams = DEFAULT_LEGAL_PARAMS,
  /** employees.pension_scheme: 'adpf' for Abu Dhabi Pension Fund members (M11). */
  scheme?: string | null
): PensionResult {
  const ruleRef = pensionRuleFor(nationality, scheme);
  if (!ruleRef) {
    return {
      pensionable: false,
      country: null,
      fund: null,
      baseFils: 0,
      employeeFils: 0,
      employerFils: 0,
      ruleConfirmed: true,
    };
  }
  const rule = params.pension[ruleRef.key];
  const baseFils = pensionBaseFils(w, rule);
  return {
    pensionable: true,
    country: ruleRef.country,
    fund: ruleRef.fund,
    baseFils,
    employeeFils: pct(baseFils, rule.employeeRate),
    employerFils: pct(baseFils, rule.employerRate),
    ruleConfirmed: rule.confirmed,
  };
}

// ─── Gratuity (end of service) ───────────────────────────────────────────────

export interface GratuityInput {
  joinDate: Date;
  endDate: Date;
  basicFils: number;
  nationality?: string | null;
  /** Days of unpaid leave inside the service period (excluded from service). */
  unpaidLeaveDays?: number;
}

export interface GratuityResult {
  eligible: boolean;
  reason: "gcc_national" | "less_than_min_service" | null;
  serviceDays: number;
  completedYears: number;
  trailingDays: number;
  yearsOfService: number;
  dailyWageFils: number;
  firstTierDays: number;
  laterTierDays: number;
  firstTierFils: number;
  laterTierFils: number;
  uncappedFils: number;
  capFils: number | null;
  totalFils: number;
  isCapped: boolean;
}

/**
 * UAE end-of-service gratuity (Decree-Law 33/2021 Art. 51, see legal-params):
 * completed years by calendar anniversary plus a pro-rated trailing partial
 * year (days / 365), 21 days per year up to year 5 and 30 days after, on
 * basic / 30, capped at `capMonthsOfBasic` months of basic. Unpaid leave days
 * shorten the service period (R09-14 / R09-17).
 */
export function gratuityEntitlement(
  input: GratuityInput,
  params: PayrollLegalParams = DEFAULT_LEGAL_PARAMS
): GratuityResult {
  const g = params.gratuity;
  const empty = (
    reason: GratuityResult["reason"],
    extra: Partial<GratuityResult> = {}
  ): GratuityResult => ({
    eligible: false,
    reason,
    serviceDays: 0,
    completedYears: 0,
    trailingDays: 0,
    yearsOfService: 0,
    dailyWageFils: 0,
    firstTierDays: 0,
    laterTierDays: 0,
    firstTierFils: 0,
    laterTierFils: 0,
    uncappedFils: 0,
    capFils: g.capMonthsOfBasic === null ? null : input.basicFils * g.capMonthsOfBasic,
    totalFils: 0,
    isCapped: false,
    ...extra,
  });

  if (input.nationality !== undefined && pensionCountry(input.nationality)) {
    return empty("gcc_national");
  }
  if (!isValidDate(input.joinDate) || !isValidDate(input.endDate)) {
    throw new DomainError(
      "INVALID_DATE",
      400,
      undefined,
      "Join and termination dates must be valid"
    );
  }
  if (input.endDate.getTime() < input.joinDate.getTime()) {
    throw new DomainError(
      "TERMINATION_BEFORE_JOIN",
      400,
      undefined,
      "Termination date cannot be before the join date"
    );
  }

  const unpaid = g.excludeUnpaidLeave ? Math.max(0, Math.floor(input.unpaidLeaveDays ?? 0)) : 0;
  const effectiveEnd = addDays(input.endDate, -unpaid);
  const lastDay = effectiveEnd.getTime() < input.joinDate.getTime() ? input.joinDate : effectiveEnd;
  // C2 (NL7): the last working day is a day of service (Art. 51 counts the service period
  // through the last day worked), so the period runs to the end of that day.
  const next = addDays(lastDay, 1);
  const end = isValidDate(next) ? next : lastDay;
  const { years: completedYears, lastAnniversary } = completedAnniversaries(input.joinDate, end);
  const trailingDays = Math.max(0, daysBetween(lastAnniversary, end));
  const serviceDays = Math.max(0, daysBetween(input.joinDate, end));
  const yearsOfService = completedYears + trailingDays / g.partialYearDays;

  if (completedYears < g.minServiceYears) {
    return empty("less_than_min_service", {
      serviceDays,
      completedYears,
      trailingDays,
      yearsOfService,
    });
  }

  // Day credits, scaled by partialYearDays so the partial year stays exact.
  const Y = g.partialYearDays;
  const firstYears = Math.min(completedYears, g.firstTierYears);
  const laterYears = Math.max(0, completedYears - g.firstTierYears);
  let firstScaled = firstYears * g.firstTierDaysPerYear * Y;
  let laterScaled = laterYears * g.laterTierDaysPerYear * Y;
  if (trailingDays > 0) {
    if (completedYears + 1 <= g.firstTierYears) {
      firstScaled += trailingDays * g.firstTierDaysPerYear;
    } else {
      laterScaled += trailingDays * g.laterTierDaysPerYear;
    }
  }
  const den = g.dailyWageDivisor * Y;
  const firstTierFils = mulDiv(input.basicFils, firstScaled, den);
  const laterTierFils = mulDiv(input.basicFils, laterScaled, den);
  const uncappedFils = mulDiv(input.basicFils, firstScaled + laterScaled, den);
  const capFils = g.capMonthsOfBasic === null ? null : input.basicFils * g.capMonthsOfBasic;
  const totalFils = capFils === null ? uncappedFils : Math.min(uncappedFils, capFils);

  return {
    eligible: true,
    reason: null,
    serviceDays,
    completedYears,
    trailingDays,
    yearsOfService,
    dailyWageFils: mulDiv(input.basicFils, 1, g.dailyWageDivisor),
    firstTierDays: firstScaled / Y,
    laterTierDays: laterScaled / Y,
    firstTierFils,
    laterTierFils,
    uncappedFils,
    capFils,
    totalFils,
    isCapped: capFils !== null && uncappedFils > capFils,
  };
}

// ─── Overtime and unpaid leave ───────────────────────────────────────────────

/** Overtime pay = hours x (basic / daysPerMonth / hoursPerDay) x multiplier (Art. 19). */
export function overtimePayFils(
  basicFils: number,
  hours: number,
  multiplier: string,
  params: PayrollLegalParams = DEFAULT_LEGAL_PARAMS
): number {
  if (!(hours > 0)) return 0;
  const o = params.overtime;
  return mulDiv(
    basicFils,
    new Decimal(hours).times(multiplier).toString(),
    o.daysPerMonth * o.hoursPerDay
  );
}

/** Deduction for unpaid leave days: basis / divisor per day (R09-15). */
export function unpaidLeaveDeductionFils(
  w: WageComponents,
  days: number,
  params: PayrollLegalParams = DEFAULT_LEGAL_PARAMS
): number {
  if (!(days > 0)) return 0;
  const basis =
    params.unpaidLeave.basis === "basic"
      ? w.basicFils
      : w.basicFils + w.housingFils + w.transportFils + w.otherFils;
  return Math.min(basis, mulDiv(basis, String(days), params.unpaidLeave.divisor));
}

// ─── Payroll line ────────────────────────────────────────────────────────────

export interface PayrollLineInput extends WageComponents {
  nationality: string | null | undefined;
  /** employees.pension_scheme ('adpf' = Abu Dhabi Pension Fund). */
  pensionScheme?: string | null;
  /** Manual overtime amount (fils). Added to any hours-based overtime. */
  overtimeFils?: number;
  overtimeHours?: number;
  overtimeMultiplier?: string | null;
  generalDeductionsFils?: number;
  unpaidLeaveDays?: number;
  /** Monthly gratuity accrual for the line (fils), computed by the caller as a true-up. */
  gratuityAccrualFils?: number;
}

export interface PayrollLine {
  basicFils: number;
  housingFils: number;
  transportFils: number;
  otherFils: number;
  overtimeFils: number;
  unpaidLeaveDeductionFils: number;
  pensionBaseFils: number;
  pensionEmployeeFils: number;
  pensionEmployerFils: number;
  gratuityAccrualFils: number;
  generalDeductionsFils: number;
  /** basic + allowances + overtime - unpaid leave (the salary expense). */
  grossPayFils: number;
  /** gross - employee pension - general deductions. */
  netSalaryFils: number;
}

export function calculatePayrollLine(
  input: PayrollLineInput,
  params: PayrollLegalParams = DEFAULT_LEGAL_PARAMS
): PayrollLine {
  const w: WageComponents = {
    basicFils: input.basicFils,
    housingFils: input.housingFils,
    transportFils: input.transportFils,
    otherFils: input.otherFils,
  };
  const pension = pensionContribution(w, input.nationality, params, input.pensionScheme);
  const multiplier = input.overtimeMultiplier ?? params.overtime.normalMultiplier;
  const overtimeFils =
    (input.overtimeFils ?? 0) +
    overtimePayFils(input.basicFils, input.overtimeHours ?? 0, multiplier, params);
  const unpaid = unpaidLeaveDeductionFils(w, input.unpaidLeaveDays ?? 0, params);
  const grossPayFils =
    w.basicFils + w.housingFils + w.transportFils + w.otherFils + overtimeFils - unpaid;
  const generalDeductionsFils = input.generalDeductionsFils ?? 0;
  const netSalaryFils = grossPayFils - pension.employeeFils - generalDeductionsFils;
  return {
    ...w,
    overtimeFils,
    unpaidLeaveDeductionFils: unpaid,
    pensionBaseFils: pension.baseFils,
    pensionEmployeeFils: pension.employeeFils,
    pensionEmployerFils: pension.employerFils,
    gratuityAccrualFils: pension.pensionable ? 0 : Math.max(0, input.gratuityAccrualFils ?? 0),
    generalDeductionsFils,
    grossPayFils,
    netSalaryFils,
  };
}

/**
 * Monthly gratuity accrual as a true-up: entitlement at period end minus the
 * provision already accrued. Nothing accrues below minimum service (R09-14);
 * the first eligible month catches up the whole first year. Never negative
 * (an over-provision is released by the end-of-service settlement).
 */
export function gratuityAccrualTrueUpFils(
  entitlementFils: number,
  accruedToDateFils: number
): number {
  return Math.max(0, entitlementFils - accruedToDateFils);
}

// ─── End-of-service settlement ───────────────────────────────────────────────

export interface SettlementInput extends WageComponents {
  joinDate: Date;
  terminationDate: Date;
  nationality: string | null | undefined;
  unpaidLeaveDays: number;
  noticeDaysInLieu: number;
  leaveEncashmentDays: number;
  otherAdditionsFils: number;
  deductionsFils: number;
  /** Gratuity provision (2036) accrued for this employee to date. */
  provisionFils: number;
}

export interface SettlementResult {
  gratuity: GratuityResult;
  gratuityFils: number;
  provisionUsedFils: number;
  /** Gratuity above the provision -> 5028 expense (negative = provision released). */
  gratuityExpenseFils: number;
  noticePayFils: number;
  leaveEncashmentFils: number;
  otherAdditionsFils: number;
  deductionsFils: number;
  netFils: number;
}

export function calculateSettlement(
  input: SettlementInput,
  params: PayrollLegalParams = DEFAULT_LEGAL_PARAMS
): SettlementResult {
  const gratuity = gratuityEntitlement(
    {
      joinDate: input.joinDate,
      endDate: input.terminationDate,
      basicFils: input.basicFils,
      nationality: input.nationality,
      unpaidLeaveDays: input.unpaidLeaveDays,
    },
    params
  );
  const gross = input.basicFils + input.housingFils + input.transportFils + input.otherFils;
  const divisor = params.gratuity.dailyWageDivisor;
  const noticeBase = params.settlement.noticePayBasis === "basic" ? input.basicFils : gross;
  const leaveBase = params.settlement.leaveEncashmentBasis === "basic" ? input.basicFils : gross;
  const noticePayFils = mulDiv(noticeBase, String(Math.max(0, input.noticeDaysInLieu)), divisor);
  const leaveEncashmentFils = mulDiv(
    leaveBase,
    String(Math.max(0, input.leaveEncashmentDays)),
    divisor
  );
  const gratuityFils = gratuity.totalFils;
  const provisionUsedFils = Math.min(Math.max(0, input.provisionFils), gratuityFils);
  const gratuityExpenseFils = gratuityFils - Math.max(0, input.provisionFils);
  const netFils =
    gratuityFils +
    noticePayFils +
    leaveEncashmentFils +
    input.otherAdditionsFils -
    input.deductionsFils;
  return {
    gratuity,
    gratuityFils,
    provisionUsedFils,
    gratuityExpenseFils,
    noticePayFils,
    leaveEncashmentFils,
    otherAdditionsFils: input.otherAdditionsFils,
    deductionsFils: input.deductionsFils,
    netFils,
  };
}

// ─── Legacy number-based gratuity API (gratuity calculator route, R09-01) ────

const round2 = (fils: number) => fils / 100;

/**
 * Number-based wrapper kept for the advisory gratuity calculator. Cap is two
 * years of BASIC wage (R09-07); `totalWage` is reported but no longer caps.
 */
export function calculateGratuityForEmployee(opts: {
  joinDate: Date;
  endDate: Date;
  basicSalary: number;
  totalWage: number;
  isGccNational: boolean;
  unpaidLeaveDays?: number;
  params?: PayrollLegalParams;
}) {
  const params = opts.params ?? DEFAULT_LEGAL_PARAMS;
  if (opts.isGccNational) {
    return {
      eligible: false,
      reason: "gcc_national" as string | null,
      yearsOfService: 0,
      completedYears: 0,
      trailingDays: 0,
      dailyWage: 0,
      firstFiveYearsGratuity: 0,
      remainingYearsGratuity: 0,
      uncappedGratuity: 0,
      maxGratuity: 0,
      totalGratuity: 0,
      isCapped: false,
    };
  }
  const basicFils = Math.round(new Decimal(opts.basicSalary || 0).times(100).toNumber());
  const r = gratuityEntitlement(
    {
      joinDate: opts.joinDate,
      endDate: opts.endDate,
      basicFils,
      unpaidLeaveDays: opts.unpaidLeaveDays,
    },
    params
  );
  return {
    eligible: r.eligible,
    reason: r.eligible ? null : "less_than_one_year",
    yearsOfService: r.yearsOfService,
    completedYears: r.completedYears,
    trailingDays: r.trailingDays,
    dailyWage: r.eligible ? round2(r.dailyWageFils) : 0,
    firstFiveYearsGratuity: round2(r.firstTierFils),
    remainingYearsGratuity: round2(r.laterTierFils),
    uncappedGratuity: round2(r.uncappedFils),
    maxGratuity: r.capFils === null ? 0 : round2(r.capFils),
    totalGratuity: round2(r.totalFils),
    isCapped: r.isCapped,
  };
}

// ─── Partial month (joiners and leavers) ─────────────────────────────────────

/**
 * Days an employee is on the payroll in [periodStart, periodEnd] (ISO dates, inclusive):
 * from the later of join date and period start to the earlier of termination date and
 * period end. `monthDays` is the number of calendar days in the period.
 */
export function employedDaysInPeriod(
  periodStart: string,
  periodEnd: string,
  joinDate: string | null,
  terminationDate: string | null
): { employedDays: number; monthDays: number } {
  const dayMs = 86_400_000;
  const ms = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);
  const monthDays = Math.round((ms(periodEnd) - ms(periodStart)) / dayMs) + 1;
  const from = joinDate && joinDate > periodStart ? joinDate : periodStart;
  const to = terminationDate && terminationDate < periodEnd ? terminationDate : periodEnd;
  const employedDays = to < from ? 0 : Math.round((ms(to) - ms(from)) / dayMs) + 1;
  return { employedDays: Math.min(employedDays, monthDays), monthDays };
}

/**
 * Fixed monthly pay for a partial month (X4/J3): each component x employed calendar days /
 * calendar days in the month (docs/payroll-legal-parameters.md, "Partial month"). A full
 * month returns the components unchanged, so the final month is paid exactly once.
 */
export function prorateWages(
  w: WageComponents,
  employedDays: number,
  monthDays: number
): WageComponents {
  if (employedDays >= monthDays) return { ...w };
  const part = (f: number) => Math.round((f * Math.max(0, employedDays)) / monthDays);
  return {
    basicFils: part(w.basicFils),
    housingFils: part(w.housingFils),
    transportFils: part(w.transportFils),
    otherFils: part(w.otherFils),
  };
}
