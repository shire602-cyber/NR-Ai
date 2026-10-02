// End-of-service gratuity (UAE Federal Decree-Law 33/2021, Art. 51), moved unchanged out of payroll.routes.ts so the
// payroll routes, the gratuity calculator and the final settlement all use the one calculator.
//
// Pure: no database. The 30-day month (daily wage = basic / 30) is the Labour Law's own convention.

// GCC nationalities (ISO-2 codes plus a few common spellings) eligible for
// equivalent-treatment pension under GCC Unified Pension Extension. Match is
// case-insensitive and trimmed; everything else is treated as expat.
const GCC_NATIONALITIES = new Set([
  "AE",
  "UAE",
  "EMIRATI",
  "EMIRATES",
  "UNITED ARAB EMIRATES",
  "SA",
  "KSA",
  "SAUDI",
  "SAUDI ARABIA",
  "SAUDI ARABIAN",
  "BH",
  "BAHRAIN",
  "BAHRAINI",
  "KW",
  "KUWAIT",
  "KUWAITI",
  "OM",
  "OMAN",
  "OMANI",
  "QA",
  "QATAR",
  "QATARI",
]);

export function isUaeOrGccNational(nationality: string | null | undefined): boolean {
  if (!nationality) return false;
  return GCC_NATIONALITIES.has(nationality.trim().toUpperCase());
}

// Round half-away-from-zero to 2dp; numeric(15,2) columns demand exact 2dp.
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Calendar-correct anniversary walk: how many full years elapsed between
// `start` and `end`. Used to pick the 21-day vs 30-day gratuity tier.
export function completedYearsBetween(start: Date, end: Date): number {
  if (!(start instanceof Date) || isNaN(start.getTime())) return 0;
  if (end.getTime() <= start.getTime()) return 0;
  let cursor = new Date(start);
  let years = 0;
  while (true) {
    const next = new Date(cursor);
    next.setFullYear(next.getFullYear() + 1);
    if (next.getTime() > end.getTime()) break;
    cursor = next;
    years++;
  }
  return years;
}

/**
 * UAE Labour Law (Federal Decree-Law 33/2021, Art. 51) gratuity calculation
 * for non-GCC employees:
 *   - First 5 years: 21 days of basic salary per year
 *   - After 5 years: 30 days of basic salary per year
 *   - Total cannot exceed two years' total wage (basic + allowances)
 *   - Service < 1 year: ineligible
 *   - Daily wage = basic / 30
 * Year-counting uses calendar anniversaries (completed years) plus a
 * day-rated trailing partial year — the law does not use 365.25-day approx.
 */
export function calculateGratuityForEmployee(opts: {
  joinDate: Date;
  endDate: Date;
  basicSalary: number;
  totalWage: number; // basic + housing + transport + other
  isGccNational: boolean;
  /**
   * Approved unpaid-leave days in the service period. Unpaid absence is not counted as service (Decree-Law 33/2021),
   * so service starts that many days later.
   */
  unpaidDays?: number;
}) {
  const { endDate, basicSalary, totalWage, isGccNational } = opts;
  const joinDate = opts.unpaidDays && opts.unpaidDays > 0 ? new Date(opts.joinDate.getTime() + Math.round(opts.unpaidDays) * 24 * 60 * 60 * 1000) : opts.joinDate;

  if (isGccNational) {
    return {
      eligible: false,
      reason: "gcc_national",
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

  // The last day of service counts as a day worked, so service runs up to the day AFTER the end date.
  const serviceEnd = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);

  // Step 1: completed years via anniversary walk (calendar-correct).
  let cursor = new Date(joinDate);
  let completedYears = 0;
  while (true) {
    const next = new Date(cursor);
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    if (next.getTime() > serviceEnd.getTime()) break;
    cursor = next;
    completedYears++;
  }

  // Step 2: the part of a year after the last anniversary, on the 30-day-month convention the Labour Law uses:
  // whole calendar months plus remaining days / 30, over 12 (3 years 6 months = 3.5, not 3 + 183/365).
  let partMonths = (serviceEnd.getUTCFullYear() - cursor.getUTCFullYear()) * 12 + (serviceEnd.getUTCMonth() - cursor.getUTCMonth());
  if (serviceEnd.getUTCDate() < cursor.getUTCDate()) partMonths -= 1;
  partMonths = Math.max(0, partMonths);
  const afterMonths = new Date(cursor);
  afterMonths.setUTCMonth(afterMonths.getUTCMonth() + partMonths);
  const msPerDay = 1000 * 60 * 60 * 24;
  const partDays = Math.max(0, Math.round((serviceEnd.getTime() - afterMonths.getTime()) / msPerDay));
  const trailingDays = partMonths * 30 + partDays;
  const trailingYears = Math.min(1, trailingDays / 360);

  // Total continuous-service expressed for display.
  const yearsOfService = completedYears + trailingYears;

  if (yearsOfService < 1) {
    return {
      eligible: false,
      reason: "less_than_one_year",
      yearsOfService,
      completedYears,
      trailingDays,
      dailyWage: 0,
      firstFiveYearsGratuity: 0,
      remainingYearsGratuity: 0,
      uncappedGratuity: 0,
      maxGratuity: round2(totalWage * 24),
      totalGratuity: 0,
      isCapped: false,
    };
  }

  const dailyWage = basicSalary / 30;

  // Step 3: tiered days-credit calculation.
  const yearsInFirst5 = Math.min(completedYears, 5);
  const yearsAfter5 = Math.max(0, completedYears - 5);
  let firstFiveDays = yearsInFirst5 * 21;
  let afterFiveDays = yearsAfter5 * 30;

  if (trailingDays > 0) {
    const nextYearNumber = completedYears + 1; // 1-indexed
    const ratePerYear = nextYearNumber <= 5 ? 21 : 30;
    const partial = trailingYears * ratePerYear;
    if (nextYearNumber <= 5) firstFiveDays += partial;
    else afterFiveDays += partial;
  }

  const firstFiveYearsGratuity = firstFiveDays * dailyWage;
  const remainingYearsGratuity = afterFiveDays * dailyWage;
  const uncappedGratuity = firstFiveYearsGratuity + remainingYearsGratuity;

  // Step 4: 2-years total-wage cap (Art. 51(2)).
  const maxGratuity = totalWage * 24;
  const totalGratuity = Math.min(uncappedGratuity, maxGratuity);

  return {
    eligible: true,
    reason: null as string | null,
    yearsOfService,
    completedYears,
    trailingDays,
    dailyWage: round2(dailyWage),
    firstFiveYearsGratuity: round2(firstFiveYearsGratuity),
    remainingYearsGratuity: round2(remainingYearsGratuity),
    uncappedGratuity: round2(uncappedGratuity),
    maxGratuity: round2(maxGratuity),
    totalGratuity: round2(totalGratuity),
    isCapped: uncappedGratuity > maxGratuity,
  };
}
