/**
 * Pure helpers deciding which employees may enter a payroll run.
 * An employee with a zero (or negative / non-numeric) basic salary is not
 * payable — they would produce a 0.00 SIF line and skew run totals.
 */

export const BASIC_SALARY_POSITIVE_MESSAGE = "Basic salary must be greater than 0";

const STRICT_NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * Strictly parse a salary input: a finite number, or a plain numeric string
 * (no thousands separators, exponents or trailing junk — parseFloat("5,000")
 * would silently give 5). Returns null for anything else.
 */
export function parseBasicSalary(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!STRICT_NUMERIC.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export type OptionalMoneyResult =
  | { ok: true; value: number | undefined }
  | { ok: false; message: string };

/**
 * Strictly parse an optional, non-negative money input. Absent / null / blank
 * means "not supplied" (value undefined: default to 0 on create, leave
 * unchanged on update). Anything that is not a finite number or a plain
 * numeric string, or is negative, is rejected with a message naming the field.
 */
export function parseOptionalMoney(value: unknown, fieldName: string): OptionalMoneyResult {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value === "string" && value.trim() === "") return { ok: true, value: undefined };
  const n = parseBasicSalary(value);
  if (n === null || n < 0) {
    return { ok: false, message: `${fieldName} must be a non-negative number` };
  }
  return { ok: true, value: n };
}

export const ALLOWANCE_FIELDS = ["housingAllowance", "transportAllowance", "otherAllowance"] as const;
export type AllowanceField = (typeof ALLOWANCE_FIELDS)[number];

export type AllowanceFieldsResult =
  | { ok: true; values: Partial<Record<AllowanceField, number>> }
  | { ok: false; field: AllowanceField; message: string };

/** Strictly parse every allowance in a request body; only supplied fields appear in `values`. */
export function parseAllowanceFields(body: Record<string, unknown>): AllowanceFieldsResult {
  const values: Partial<Record<AllowanceField, number>> = {};
  for (const field of ALLOWANCE_FIELDS) {
    const r = parseOptionalMoney(body[field], field);
    if (!r.ok) return { ok: false, field, message: r.message };
    if (r.value !== undefined) values[field] = r.value;
  }
  return { ok: true, values };
}

/** True when `value` is a valid salary input strictly greater than zero. */
export function isPositiveBasicSalary(value: unknown): boolean {
  const n = parseBasicSalary(value);
  return n !== null && n > 0;
}

/** Validation message for an employee create/update payload value, or null when valid. */
export function validateBasicSalaryInput(value: unknown): string | null {
  return isPositiveBasicSalary(value) ? null : BASIC_SALARY_POSITIVE_MESSAGE;
}

export interface PayrollCandidate {
  id: string;
  full_name?: string | null;
  employee_number?: string | null;
  basic_salary: unknown;
}

export interface PayrollEligibility<T extends PayrollCandidate> {
  eligible: T[];
  excluded: T[];
  warnings: string[];
}

/** Splits employees into payable and excluded (zero salary), with one warning per exclusion. */
export function partitionPayrollEligible<T extends PayrollCandidate>(
  employees: readonly T[]
): PayrollEligibility<T> {
  const eligible: T[] = [];
  const excluded: T[] = [];
  const warnings: string[] = [];
  for (const emp of employees) {
    if (isPositiveBasicSalary(emp.basic_salary)) {
      eligible.push(emp);
      continue;
    }
    excluded.push(emp);
    const label = emp.full_name?.trim() || emp.id;
    const ref = emp.employee_number ? ` (${emp.employee_number})` : "";
    warnings.push(`Excluded ${label}${ref} from the payroll run: basic salary is zero.`);
  }
  return { eligible, excluded, warnings };
}
