/**
 * Payroll legal parameters (R09-06, R09-07, R09-14, R09-20).
 *
 * Every statutory number the payroll engine uses lives here as CONFIGURATION
 * with a documented default. A company can override any of them through
 * `payroll_settings.legal_params` (PUT /api/companies/:companyId/payroll/settings)
 * and record that its adviser confirmed the values (`adviser_confirmed`).
 *
 * COUNSEL REVIEW REQUIRED. The readings below are the engineering team's
 * reading of the sources cited, not legal advice. They are listed with their
 * source and open questions in docs/payroll-legal-parameters.md.
 *
 *  - Pension (GPSSA), Federal Decree-Law No. 57 of 2023 on Pensions and Social
 *    Security (replacing Federal Law No. 7 of 1999): UAE nationals in the
 *    private sector contribute 5% (employee) and 12.5% (employer) of the
 *    contribution account salary. Default contribution base: basic + housing
 *    (the reading this module's predecessor documented in its header; the
 *    audit found the code used basic + housing + transport — R09-06). Floors
 *    and caps on the contribution salary are configurable and default to none
 *    until counsel confirms the figures in the 2023 law and GPSSA circulars.
 *  - Other GCC nationals (GCC Unified Insurance Protection Extension): the
 *    home-country scheme's rates apply. Defaults mirror the UAE rates and are
 *    flagged `confirmed: false` so the UI shows that they need an adviser.
 *  - End-of-service gratuity, Federal Decree-Law No. 33 of 2021, Art. 51:
 *    21 days of basic wage per year for the first five years, 30 days per year
 *    thereafter; daily wage = basic / 30; no gratuity below one year of
 *    continuous service; total capped at two years' wage — read here as 24
 *    months of BASIC wage (R09-07; the old code used total wage). Days of
 *    unpaid absence are not counted in the service period (Art. 51(3) reading).
 *  - Overtime, Federal Decree-Law No. 33 of 2021, Art. 19: +25% of the basic
 *    hourly wage; +50% for hours between 22:00 and 04:00 or on a rest day
 *    (rest-day/night rate). Hourly wage = basic / 30 / 8.
 *  - Unpaid leave deduction: basic / 30 per day of unpaid leave (configurable
 *    to gross / 30).
 */
import { z } from "zod";

export const PENSION_BASES = [
  "basic",
  "basic_housing",
  "basic_housing_transport",
  "gross",
] as const;
export type PensionBase = (typeof PENSION_BASES)[number];

export const GCC_COUNTRIES = ["SA", "BH", "KW", "OM", "QA"] as const;
export type GccCountry = (typeof GCC_COUNTRIES)[number];

const rate = z
  .string()
  .regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/, "Rate must be a fraction between 0 and 1, e.g. 0.05");
const moneyOrNull = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Amount must be a positive decimal")
  .nullable();

export const pensionRuleSchema = z
  .object({
    employeeRate: rate,
    employerRate: rate,
    base: z.enum(PENSION_BASES),
    minContributionSalary: moneyOrNull,
    maxContributionSalary: moneyOrNull,
    /** true only when the company's adviser has confirmed this row. */
    confirmed: z.boolean(),
  })
  .strict();
export type PensionRule = z.infer<typeof pensionRuleSchema>;

export const legalParamsSchema = z
  .object({
    pension: z
      .object({
        AE: pensionRuleSchema,
        SA: pensionRuleSchema,
        BH: pensionRuleSchema,
        KW: pensionRuleSchema,
        OM: pensionRuleSchema,
        QA: pensionRuleSchema,
      })
      .strict(),
    gratuity: z
      .object({
        firstTierDaysPerYear: z.number().int().min(0).max(60),
        laterTierDaysPerYear: z.number().int().min(0).max(60),
        firstTierYears: z.number().int().min(0).max(40),
        minServiceYears: z.number().int().min(0).max(10),
        /** Cap in months of basic wage (24 = two years). null = no cap. */
        capMonthsOfBasic: z.number().int().min(1).max(120).nullable(),
        dailyWageDivisor: z.number().int().min(1).max(365),
        partialYearDays: z.number().int().min(360).max(366),
        excludeUnpaidLeave: z.boolean(),
        /** Accrue nothing while service is below minServiceYears (R09-14). */
        noAccrualBeforeMinService: z.boolean(),
      })
      .strict(),
    unpaidLeave: z
      .object({
        basis: z.enum(["basic", "gross"]),
        divisor: z.number().int().min(1).max(31),
      })
      .strict(),
    overtime: z
      .object({
        normalMultiplier: z.string().regex(/^\d(\.\d{1,2})?$/),
        nightOrRestDayMultiplier: z.string().regex(/^\d(\.\d{1,2})?$/),
        hoursPerDay: z.number().int().min(1).max(24),
        daysPerMonth: z.number().int().min(1).max(31),
        maxHoursPerPeriod: z.number().int().min(0).max(400),
      })
      .strict(),
    settlement: z
      .object({
        /** Notice pay per day = gross / divisor. */
        noticePayBasis: z.enum(["basic", "gross"]),
        /** Leave encashment per day = basic / divisor. */
        leaveEncashmentBasis: z.enum(["basic", "gross"]),
      })
      .strict(),
  })
  .strict();
export type PayrollLegalParams = z.infer<typeof legalParamsSchema>;

const uaeRule: PensionRule = {
  employeeRate: "0.05",
  employerRate: "0.125",
  base: "basic_housing",
  minContributionSalary: null,
  maxContributionSalary: null,
  confirmed: false,
};

export const DEFAULT_LEGAL_PARAMS: PayrollLegalParams = Object.freeze({
  pension: {
    AE: uaeRule,
    SA: { ...uaeRule },
    BH: { ...uaeRule },
    KW: { ...uaeRule },
    OM: { ...uaeRule },
    QA: { ...uaeRule },
  },
  gratuity: {
    firstTierDaysPerYear: 21,
    laterTierDaysPerYear: 30,
    firstTierYears: 5,
    minServiceYears: 1,
    capMonthsOfBasic: 24,
    dailyWageDivisor: 30,
    partialYearDays: 365,
    excludeUnpaidLeave: true,
    noAccrualBeforeMinService: true,
  },
  unpaidLeave: { basis: "basic", divisor: 30 },
  overtime: {
    normalMultiplier: "1.25",
    nightOrRestDayMultiplier: "1.5",
    hoursPerDay: 8,
    daysPerMonth: 30,
    maxHoursPerPeriod: 144,
  },
  settlement: { noticePayBasis: "gross", leaveEncashmentBasis: "basic" },
}) as PayrollLegalParams;

/** Deep-merge a stored partial override onto the defaults, then validate. */
export function resolveLegalParams(stored: unknown): PayrollLegalParams {
  const base = structuredClone(DEFAULT_LEGAL_PARAMS);
  if (!stored || typeof stored !== "object") return base;
  const merged = deepMerge(base as unknown as Record<string, unknown>, stored);
  const parsed = legalParamsSchema.safeParse(merged);
  // An invalid stored override never half-applies: fall back to the defaults.
  return parsed.success ? parsed.data : structuredClone(DEFAULT_LEGAL_PARAMS);
}

function deepMerge(target: Record<string, unknown>, source: unknown): Record<string, unknown> {
  if (!source || typeof source !== "object" || Array.isArray(source)) return target;
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (!(key in target)) continue; // unknown keys are dropped
    const current = target[key];
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      target[key] = deepMerge({ ...(current as Record<string, unknown>) }, value);
    } else if (value !== undefined) {
      target[key] = value;
    }
  }
  return target;
}

// GCC nationality spellings (ISO-2 plus common names), case-insensitive.
const NATIONALITY_ALIASES: Record<string, "AE" | GccCountry> = {
  AE: "AE",
  ARE: "AE",
  UAE: "AE",
  EMIRATI: "AE",
  EMIRATES: "AE",
  "UNITED ARAB EMIRATES": "AE",
  SA: "SA",
  SAU: "SA",
  KSA: "SA",
  SAUDI: "SA",
  "SAUDI ARABIA": "SA",
  "SAUDI ARABIAN": "SA",
  BH: "BH",
  BHR: "BH",
  BAHRAIN: "BH",
  BAHRAINI: "BH",
  KW: "KW",
  KWT: "KW",
  KUWAIT: "KW",
  KUWAITI: "KW",
  OM: "OM",
  OMN: "OM",
  OMAN: "OM",
  OMANI: "OM",
  QA: "QA",
  QAT: "QA",
  QATAR: "QA",
  QATARI: "QA",
};

/** "AE" / GCC ISO-2 code for UAE and GCC nationals, null for everyone else. */
export function pensionCountry(nationality: string | null | undefined): "AE" | GccCountry | null {
  if (!nationality) return null;
  return NATIONALITY_ALIASES[nationality.trim().toUpperCase()] ?? null;
}

export function isUaeOrGccNational(nationality: string | null | undefined): boolean {
  return pensionCountry(nationality) !== null;
}
