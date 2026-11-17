/**
 * Payroll / HR request schemas (W3-D). Shared by the server routes
 * (strictBody) and the client forms.
 *
 * Identifiers follow the UAE Wage Protection System (WPS) Salary Information
 * File conventions: the MOHRE person id ("labour card / person id") is 14
 * digits, the MOHRE establishment id 13 digits, a bank / agent routing code 9
 * digits, and the salary account a UAE IBAN with valid mod-97 check digits.
 */
import { z } from "zod";
import {
  zCurrency,
  zDate,
  zDateIn,
  zEmail,
  zEmiratesId,
  zIbanAE,
  zMoney,
  zPeriodMonth,
  zPeriodYear,
  zText,
  zUuid,
} from "./primitives";

// ─── Identifier primitives ───────────────────────────────────────────────────

const digits = (n: number, label: string) =>
  z
    .string()
    .transform((s) => s.replace(/[\s-]/g, ""))
    .refine((s) => new RegExp(`^\\d{${n}}$`).test(s), `${label} must be exactly ${n} digits`);

/** MOHRE person id (EDR employee unique id): 14 digits. */
export const zMolPersonId = digits(14, "MOL person id");
/** MOHRE establishment id (SCR employer unique id): 13 digits. */
export const zMolEstablishmentId = digits(13, "MOL establishment id");
/** Bank / agent routing code: 9 digits. */
export const zRoutingCode = digits(9, "Routing code");
/** Passport number: 5–20 letters/digits. */
export const zPassport = z
  .string()
  .transform((s) => s.replace(/\s+/g, "").toUpperCase())
  .refine((s) => /^[A-Z0-9]{5,20}$/.test(s), "Passport number must be 5-20 letters or digits");
/** Nationality: ISO 3166 alpha-2 or alpha-3 code ("AE", "IND"). */
export const zNationality = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => /^[A-Z]{2,3}$/.test(s), "Nationality must be an ISO country code (e.g. AE, IN)");

export const CONTRACT_TYPES = [
  "full_time",
  "part_time",
  "temporary",
  "flexible",
  "remote",
  "job_sharing",
] as const;
export const EMPLOYEE_STATUSES = ["active", "inactive"] as const;

/** Salary amount: >= 0, at most 2 decimals, at most 10,000,000 per month. */
const zSalary = zMoney.refine((v) => Number(v) <= 10_000_000, "Amount is too large");
/** Overtime / deduction amount per item: >= 0, at most 1,000,000. */
const zItemAmount = zMoney.refine((v) => Number(v) <= 1_000_000, "Amount is too large");

const zDays = (max: number) =>
  z.coerce
    .number({
      error: (iss) =>
        iss.code === "invalid_type" && iss.input !== undefined ? "Must be a number" : undefined,
    })
    .min(0, "Must be zero or more")
    .max(max, `Must be at most ${max}`)
    .refine((v) => Number.isInteger(v * 2), "Use whole or half days");

// "" from an empty form input means "not given" on create and "clear" on update.
const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
const blankToNull = (v: unknown) => (v === "" ? null : v);
const opt = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());
const clearable = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(blankToNull, schema.nullable().optional());

const zPastOrFutureDate = zDateIn({ min: "1950-01-01", maxDaysAhead: 365 * 15 });

const employeeFields = {
  employeeNumber: zText(64, { min: 1 }),
  fullName: zText(255, { min: 1 }),
  fullNameAr: zText(255),
  nationality: zNationality,
  email: zEmail,
  passportNumber: zPassport,
  passportExpiry: zPastOrFutureDate,
  visaNumber: zText(64),
  visaExpiry: zPastOrFutureDate,
  laborCardNumber: zText(64),
  laborCardExpiry: zPastOrFutureDate,
  molPersonId: zMolPersonId,
  emiratesId: zEmiratesId,
  emiratesIdExpiry: zPastOrFutureDate,
  bankName: zText(128),
  bankAccountNumber: zText(64),
  iban: zIbanAE,
  routingCode: zRoutingCode,
  department: zText(128),
  costCenterId: zUuid,
  designation: zText(128),
  contractType: z.enum(CONTRACT_TYPES),
  contractStart: zPastOrFutureDate,
  contractEnd: zPastOrFutureDate,
  noticePeriodDays: z.coerce.number().int().min(0).max(90),
  joinDate: zDateIn({ min: "1950-01-01" }),
  salaryCurrency: zCurrency,
  basicSalary: zSalary,
  housingAllowance: zSalary,
  transportAllowance: zSalary,
  otherAllowance: zSalary,
  /** X4: gratuity provision already booked before go-live (opening balance in 2036). */
  openingGratuityProvision: zSalary,
};

type EmployeeFieldKey = keyof typeof employeeFields;
const OPTIONAL_CREATE_KEYS = Object.keys(employeeFields).filter(
  (k) => k !== "fullName"
) as EmployeeFieldKey[];

function contractDatesOk(input: unknown) {
  const v = input as { contractStart?: string | null; contractEnd?: string | null };
  return !v.contractStart || !v.contractEnd || v.contractEnd >= v.contractStart;
}

export const employeeCreateSchema = z
  .object({
    ...Object.fromEntries(OPTIONAL_CREATE_KEYS.map((k) => [k, opt(employeeFields[k])])),
    fullName: employeeFields.fullName,
  } as unknown as { [K in EmployeeFieldKey]: z.ZodTypeAny })
  .strict()
  .refine(contractDatesOk, {
    message: "Contract end must be on or after its start",
    path: ["contractEnd"],
  });
export type EmployeeCreateBody = {
  [K in EmployeeFieldKey]?: K extends "noticePeriodDays" ? number : string;
} & { fullName: string };

export const employeePatchSchema = z
  .object({
    ...Object.fromEntries(
      (Object.keys(employeeFields) as EmployeeFieldKey[]).map((k) => [
        k,
        k === "fullName" ? employeeFields.fullName.optional() : clearable(employeeFields[k]),
      ])
    ),
    status: z.enum(EMPLOYEE_STATUSES).optional(),
    salaryEffectiveDate: opt(zDate),
    salaryChangeReason: opt(zText(500)),
  } as Record<string, z.ZodTypeAny>)
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update",
  })
  .refine(contractDatesOk, {
    message: "Contract end must be on or after its start",
    path: ["contractEnd"],
  });
export type EmployeePatchBody = Partial<Record<EmployeeFieldKey, string | number | null>> & {
  status?: (typeof EMPLOYEE_STATUSES)[number];
  salaryEffectiveDate?: string;
  salaryChangeReason?: string;
};

export const employeeTerminateSchema = z
  .object({
    terminationDate: zDate,
    reason: zText(500, { min: 1 }),
  })
  .strict();

// ─── Payroll runs and items ──────────────────────────────────────────────────

export const payrollRunCreateSchema = z
  .object({
    periodMonth: zPeriodMonth,
    periodYear: zPeriodYear,
    notes: opt(zText(1000)),
  })
  .strict();
export type PayrollRunCreateBody = z.output<typeof payrollRunCreateSchema>;

/** Only notes and (while draft) the period are editable; status never (R09-02). */
export const payrollRunPatchSchema = z
  .object({
    periodMonth: zPeriodMonth.optional(),
    periodYear: zPeriodYear.optional(),
    notes: clearable(zText(1000)),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update",
  });
export type PayrollRunPatchBody = z.output<typeof payrollRunPatchSchema>;

export const payrollItemPatchSchema = z
  .object({
    overtime: zItemAmount.optional(),
    overtimeHours: z.coerce.number().min(0).max(400).optional(),
    overtimeMultiplier: z
      .preprocess(blankToNull, z.coerce.number().min(1).max(3).nullable())
      .optional(),
    deductions: zItemAmount.optional(),
    deductionNotes: clearable(zText(500)),
    unpaidLeaveDays: zDays(31).optional(),
    paidLeaveDays: zDays(31).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update",
  });
export type PayrollItemPatchBody = z.output<typeof payrollItemPatchSchema>;

export const payrollApproveSchema = z.object({ notes: opt(zText(500)) }).strict();
export const payrollPaySchema = z.object({ paymentAccountId: zUuid, paymentDate: zDate }).strict();
export type PayrollPayBody = z.output<typeof payrollPaySchema>;
export const payrollReverseSchema = z.object({ reason: zText(500, { min: 1 }) }).strict();

export const WPS_STATUSES = ["submitted", "accepted", "rejected"] as const;
export const payrollWpsStatusSchema = z
  .object({
    wpsStatus: z.enum(WPS_STATUSES),
    notes: opt(zText(2000)),
  })
  .strict()
  .refine((v) => v.wpsStatus !== "rejected" || !!v.notes, {
    message: "Rejection notes are required",
    path: ["notes"],
  });

export const sifValidateSchema = z.object({ content: z.string().min(1).max(2_000_000) }).strict();

// ─── WPS company settings ────────────────────────────────────────────────────

export const wpsSettingsSchema = z
  .object({
    mohreEstablishmentId: clearable(zMolEstablishmentId),
    wpsEmployerRoutingCode: clearable(zRoutingCode),
    wpsEmployerIban: clearable(zIbanAE),
    wpsEmployerBankName: clearable(zText(100)),
    wpsAgentId: clearable(zText(40)),
  })
  .strict();

// ─── Leave ───────────────────────────────────────────────────────────────────

export const leaveTypeCreateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_]{1,31}$/, "Code must be 2-32 lowercase letters, digits or _"),
    nameEn: zText(100, { min: 1 }),
    nameAr: opt(zText(100)),
    isPaid: z.boolean(),
    annualEntitlementDays: z.coerce.number().min(0).max(365),
    accrualMethod: z.enum(["monthly", "annual", "none"]),
    carryForwardMaxDays: z.coerce.number().min(0).max(365).default(0),
  })
  .strict();

export const leaveRequestCreateSchema = z
  .object({
    employeeId: zUuid,
    leaveTypeId: zUuid,
    startDate: zDate,
    endDate: zDate,
    days: opt(zDays(366)),
    notes: opt(zText(1000)),
  })
  .strict()
  .refine((v) => v.endDate >= v.startDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  });

export const leaveDecisionSchema = z
  .object({
    decision: z.enum(["approve", "reject", "cancel"]),
    notes: opt(zText(1000)),
  })
  .strict();

// ─── Settlement ──────────────────────────────────────────────────────────────

export const settlementCreateSchema = z
  .object({
    employeeId: zUuid,
    terminationDate: zDate,
    reason: zText(500, { min: 1 }),
    noticeDaysInLieu: z.coerce.number().int().min(0).max(90).default(0),
    leaveEncashmentDays: opt(zDays(365)),
    otherAdditions: zMoney.default("0.00"),
    deductions: zMoney.default("0.00"),
    paymentAccountId: opt(zUuid),
  })
  .strict();
export type SettlementCreateBody = z.output<typeof settlementCreateSchema>;

// ─── Payslips ────────────────────────────────────────────────────────────────

export const payslipEmailSchema = z
  .object({ itemIds: z.array(zUuid).min(1).max(500).optional() })
  .strict();
