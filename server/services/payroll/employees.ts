/**
 * Employee records (R09-05, R09-09, R09-10, R09-21): validated create/update
 * with salary change history, deletion guarded by payroll history (409 — use
 * terminate/archive instead), and a terminate workflow.
 */
import { DomainError } from "../../errors";
import { createLogger } from "../../config/logger";
import { fromFils, sumFils, toFils } from "../../../shared/money";
import type { EmployeeCreateBody, EmployeePatchBody } from "../../../shared/validators/payroll";
import { fils, q, q1, type Row } from "./sql";
import { syncOpeningGratuity } from "./opening-gratuity";
import { ensureDefaultLeaveTypes } from "./leave";

const log = createLogger("payroll-employees");

/** API field -> employees column. */
export const EMPLOYEE_COLUMNS: Record<string, string> = {
  employeeNumber: "employee_number",
  fullName: "full_name",
  fullNameAr: "full_name_ar",
  nationality: "nationality",
  email: "email",
  passportNumber: "passport_number",
  passportExpiry: "passport_expiry",
  visaNumber: "visa_number",
  visaExpiry: "visa_expiry",
  laborCardNumber: "labor_card_number",
  laborCardExpiry: "labor_card_expiry",
  molPersonId: "mol_person_id",
  emiratesId: "emirates_id",
  emiratesIdExpiry: "emirates_id_expiry",
  bankName: "bank_name",
  bankAccountNumber: "bank_account_number",
  iban: "iban",
  routingCode: "routing_code",
  department: "department",
  costCenterId: "cost_center_id",
  designation: "designation",
  contractType: "contract_type",
  contractStart: "contract_start",
  contractEnd: "contract_end",
  noticePeriodDays: "notice_period_days",
  joinDate: "join_date",
  salaryCurrency: "salary_currency",
  basicSalary: "basic_salary",
  housingAllowance: "housing_allowance",
  transportAllowance: "transport_allowance",
  otherAllowance: "other_allowance",
  openingGratuityProvision: "opening_gratuity_provision",
  openingGratuityAsOf: "opening_gratuity_as_of",
  pensionScheme: "pension_scheme",
  status: "status",
};

const SALARY_KEYS = [
  "basicSalary",
  "housingAllowance",
  "transportAllowance",
  "otherAllowance",
] as const;
const NOT_NULL_DEFAULTS: Record<string, unknown> = {
  basicSalary: "0.00",
  housingAllowance: "0.00",
  transportAllowance: "0.00",
  otherAllowance: "0.00",
  salaryCurrency: "AED",
  noticePeriodDays: 30,
};

async function assertCostCenter(companyId: string, costCenterId: unknown): Promise<void> {
  if (!costCenterId) return;
  const cc = await q1(`SELECT id FROM cost_centers WHERE id = $1 AND company_id = $2`, [
    costCenterId,
    companyId,
  ]);
  if (!cc) throw new DomainError("COST_CENTER_NOT_FOUND", 422, undefined, "Cost centre not found");
}

/**
 * X4 (J3): an employee number, IBAN or Emirates ID belongs to one live employee per company
 * (duplicates risk a duplicate WPS salary transfer). Compared normalised: employee number
 * case-insensitive, IBAN without spaces, Emirates ID digits only. Archived employees and,
 * for IBAN / Emirates ID, terminated employees (rehire) do not count. 0118 adds matching
 * partial unique indexes as the race backstop.
 */
export const EMPLOYEE_UNIQUE_SQL = {
  employeeNumber: {
    expr: "lower(btrim(employee_number))",
    value: (v: string) => v.trim().toLowerCase(),
    scope: "archived_at IS NULL",
  },
  iban: {
    expr: "upper(regexp_replace(iban, '\\s', '', 'g'))",
    value: (v: string) => v.replace(/\s/g, "").toUpperCase(),
    scope: "archived_at IS NULL AND status <> 'terminated'",
  },
  emiratesId: {
    expr: "regexp_replace(emirates_id, '[^0-9]', '', 'g')",
    value: (v: string) => v.replace(/[^0-9]/g, ""),
    scope: "archived_at IS NULL AND status <> 'terminated'",
  },
} as const;

const DUPLICATE_MESSAGES: Record<keyof typeof EMPLOYEE_UNIQUE_SQL, string> = {
  employeeNumber: "Another employee already uses this employee number",
  iban: "Another employee already uses this IBAN",
  emiratesId: "Another employee already uses this Emirates ID",
};

async function assertUniqueIdentifiers(
  companyId: string,
  values: Partial<Record<keyof typeof EMPLOYEE_UNIQUE_SQL, unknown>>,
  excludeId: string | null
): Promise<void> {
  const fields: Record<string, string> = {};
  for (const key of Object.keys(EMPLOYEE_UNIQUE_SQL) as Array<keyof typeof EMPLOYEE_UNIQUE_SQL>) {
    const raw = values[key];
    if (typeof raw !== "string") continue;
    const rule = EMPLOYEE_UNIQUE_SQL[key];
    const v = rule.value(raw);
    if (!v) continue;
    const dup = await q1(
      `SELECT id FROM employees
        WHERE company_id = $1 AND ${rule.scope} AND ${rule.expr} = $2
          AND ($3::uuid IS NULL OR id <> $3::uuid)
        LIMIT 1`,
      [companyId, v, excludeId]
    );
    if (dup) fields[key] = DUPLICATE_MESSAGES[key];
  }
  const keys = Object.keys(fields);
  if (keys.length > 0) {
    throw new DomainError("EMPLOYEE_DUPLICATE", 409, { fields }, fields[keys[0]]);
  }
}

/** Map a unique-index race (23505 on the 0118 indexes) to the same 409. */
function rethrowDuplicate(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (e?.code === "23505" && typeof e.constraint === "string") {
    const key = e.constraint.includes("iban")
      ? "iban"
      : e.constraint.includes("emirates")
        ? "emiratesId"
        : e.constraint.includes("number")
          ? "employeeNumber"
          : null;
    if (key) {
      throw new DomainError(
        "EMPLOYEE_DUPLICATE",
        409,
        { fields: { [key]: DUPLICATE_MESSAGES[key] } },
        DUPLICATE_MESSAGES[key]
      );
    }
  }
  throw err;
}

/**
 * M10: entering an opening gratuity provision (0 included) records when it was measured
 * (`openingGratuityAsOf`, default today); clearing it (null) clears the date, so the first
 * payroll run asks for it again.
 */
function withOpeningGratuityDate(values: Record<string, unknown>): void {
  if (!("openingGratuityProvision" in values) || values.openingGratuityProvision === undefined) {
    return;
  }
  if (values.openingGratuityProvision === null) {
    values.openingGratuityAsOf = null;
  } else if (!values.openingGratuityAsOf) {
    values.openingGratuityAsOf = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
  }
}

/** The body sets the opening gratuity provision or its date. */
function touchesOpeningGratuity(values: Record<string, unknown>): boolean {
  return values.openingGratuityProvision !== undefined || values.openingGratuityAsOf !== undefined;
}

/**
 * D1 (N1): an opening provision saved on the employee is booked in the GL at once (the opening
 * gratuity seam posts the difference to the opening 2036), so the form and the ledger cannot
 * drift apart. When the posting is refused (a locked period) the employee change is undone.
 */
async function bookOpeningProvision(
  companyId: string,
  actorId: string,
  undo: () => Promise<unknown>
): Promise<void> {
  try {
    await syncOpeningGratuity(companyId, actorId);
  } catch (err) {
    await undo();
    throw err;
  }
}

function totalSalary(values: Record<string, unknown>): string {
  return fromFils(sumFils(SALARY_KEYS.map((k) => fils(values[k] ?? "0"))));
}

export async function createEmployee(
  companyId: string,
  actorId: string,
  body: EmployeeCreateBody
): Promise<Row> {
  await assertCostCenter(companyId, body.costCenterId);
  await assertUniqueIdentifiers(companyId, body, null);
  await ensureDefaultLeaveTypes(companyId);
  const values: Record<string, unknown> = { ...NOT_NULL_DEFAULTS };
  for (const [k, v] of Object.entries(body)) if (v !== undefined) values[k] = v;
  withOpeningGratuityDate(values);
  const keys = Object.keys(values).filter((k) => EMPLOYEE_COLUMNS[k]);
  const cols = keys.map((k) => `"${EMPLOYEE_COLUMNS[k]}"`);
  const params = keys.map((k) => values[k]);
  cols.push(`"company_id"`, `"total_salary"`, `"status"`, `"created_by"`);
  params.push(companyId, totalSalary(values), "active", actorId);
  const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");
  const employee = await q1<Row & { id: string }>(
    `INSERT INTO employees (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
    params
  ).catch(rethrowDuplicate);
  await q(
    `INSERT INTO employee_salary_history (company_id, employee_id, effective_date, basic_salary,
       housing_allowance, transport_allowance, other_allowance, salary_currency, reason, changed_by)
     VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8, 'Initial salary', $9)`,
    [
      companyId,
      employee!.id,
      body.joinDate ?? null,
      values.basicSalary,
      values.housingAllowance,
      values.transportAllowance,
      values.otherAllowance,
      values.salaryCurrency,
      actorId,
    ]
  );
  if (touchesOpeningGratuity(values)) {
    await bookOpeningProvision(companyId, actorId, () =>
      q(
        `UPDATE employees SET opening_gratuity_provision = NULL, opening_gratuity_as_of = NULL
          WHERE id = $1 AND company_id = $2`,
        [employee!.id, companyId]
      )
    );
  }
  log.info({ employeeId: employee!.id, companyId }, "Employee created");
  return employee!;
}

export async function updateEmployee(
  companyId: string,
  employeeId: string,
  actorId: string,
  body: EmployeePatchBody
): Promise<Row> {
  const current = await q1<Row>(`SELECT * FROM employees WHERE id = $1 AND company_id = $2`, [
    employeeId,
    companyId,
  ]);
  if (!current) throw new DomainError("EMPLOYEE_NOT_FOUND", 404, undefined, "Employee not found");
  if (current.status === "terminated") {
    throw new DomainError(
      "EMPLOYEE_TERMINATED",
      409,
      undefined,
      "A terminated employee cannot be edited"
    );
  }
  if (body.costCenterId) await assertCostCenter(companyId, body.costCenterId);
  await assertUniqueIdentifiers(companyId, body, employeeId);
  const sets: string[] = [];
  const params: unknown[] = [];
  const patch: Record<string, unknown> = { ...body };
  withOpeningGratuityDate(patch);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || !EMPLOYEE_COLUMNS[k]) continue;
    // NOT NULL columns cannot be cleared; null resets them to the default.
    const value = v === null && k in NOT_NULL_DEFAULTS ? NOT_NULL_DEFAULTS[k] : v;
    if (v === null && k === "fullName") continue;
    params.push(value);
    sets.push(`"${EMPLOYEE_COLUMNS[k]}" = $${params.length}`);
  }
  const salaryChanged =
    SALARY_KEYS.some(
      (k) =>
        body[k] !== undefined &&
        toFils(String(body[k] ?? "0")) !== fils(current[EMPLOYEE_COLUMNS[k]])
    ) ||
    (body.salaryCurrency !== undefined && body.salaryCurrency !== current.salary_currency);
  const merged: Record<string, unknown> = {};
  for (const k of SALARY_KEYS) merged[k] = body[k] ?? current[EMPLOYEE_COLUMNS[k]];
  params.push(totalSalary(merged));
  sets.push(`"total_salary" = $${params.length}`);
  params.push(employeeId, companyId);
  const updated = await q1<Row>(
    `UPDATE employees SET ${sets.join(", ")} WHERE id = $${params.length - 1} AND company_id = $${params.length} RETURNING *`,
    params
  ).catch(rethrowDuplicate);
  if (salaryChanged) {
    await q(
      `INSERT INTO employee_salary_history (company_id, employee_id, effective_date, basic_salary,
         housing_allowance, transport_allowance, other_allowance, salary_currency, reason, changed_by)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8, $9, $10)`,
      [
        companyId,
        employeeId,
        body.salaryEffectiveDate ?? null,
        updated!.basic_salary,
        updated!.housing_allowance,
        updated!.transport_allowance,
        updated!.other_allowance,
        updated!.salary_currency,
        body.salaryChangeReason ?? null,
        actorId,
      ]
    );
  }
  if (touchesOpeningGratuity(patch)) {
    await bookOpeningProvision(companyId, actorId, () =>
      q(
        `UPDATE employees SET opening_gratuity_provision = $3, opening_gratuity_as_of = $4
          WHERE id = $1 AND company_id = $2`,
        [employeeId, companyId, current.opening_gratuity_provision, current.opening_gratuity_as_of]
      )
    );
  }
  return updated!;
}

export async function employeeHasPayrollHistory(employeeId: string): Promise<boolean> {
  const row = await q1(
    `SELECT 1 FROM payroll_items WHERE employee_id = $1
     UNION ALL SELECT 1 FROM payroll_settlements WHERE employee_id = $1
     UNION ALL SELECT 1 FROM leave_requests WHERE employee_id = $1 AND status = 'approved'
     LIMIT 1`,
    [employeeId]
  );
  return !!row;
}

/** Hard delete only for employees with no payroll history; otherwise 409 (R09-05). */
export async function deleteEmployee(companyId: string, employeeId: string): Promise<void> {
  const emp = await q1(`SELECT id FROM employees WHERE id = $1 AND company_id = $2`, [
    employeeId,
    companyId,
  ]);
  if (!emp) throw new DomainError("EMPLOYEE_NOT_FOUND", 404, undefined, "Employee not found");
  if (await employeeHasPayrollHistory(employeeId)) {
    throw new DomainError(
      "EMPLOYEE_HAS_PAYROLL_HISTORY",
      409,
      undefined,
      "This employee has payroll history and cannot be deleted. Terminate or archive them instead."
    );
  }
  await q(`DELETE FROM leave_requests WHERE employee_id = $1`, [employeeId]);
  await q(`DELETE FROM employees WHERE id = $1 AND company_id = $2`, [employeeId, companyId]);
}

/** Terminate without a settlement run (e.g. GCC national, or settled outside the app). */
export async function terminateEmployee(
  companyId: string,
  employeeId: string,
  terminationDate: string,
  reason: string
): Promise<Row> {
  const updated = await q1<Row>(
    `UPDATE employees SET status = 'terminated', termination_date = $3::date, termination_reason = $4
      WHERE id = $1 AND company_id = $2 AND status <> 'terminated' RETURNING *`,
    [employeeId, companyId, terminationDate, reason]
  );
  if (!updated) {
    const exists = await q1(`SELECT status FROM employees WHERE id = $1 AND company_id = $2`, [
      employeeId,
      companyId,
    ]);
    if (!exists) throw new DomainError("EMPLOYEE_NOT_FOUND", 404, undefined, "Employee not found");
    throw new DomainError(
      "EMPLOYEE_ALREADY_TERMINATED",
      409,
      undefined,
      "Employee is already terminated"
    );
  }
  return updated;
}

/** Archive hides the record from active lists; history stays (R09-05). */
export async function archiveEmployee(companyId: string, employeeId: string): Promise<Row> {
  const updated = await q1<Row>(
    `UPDATE employees SET archived_at = COALESCE(archived_at, NOW()),
            status = CASE WHEN status = 'terminated' THEN status ELSE 'inactive' END
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [employeeId, companyId]
  );
  if (!updated) throw new DomainError("EMPLOYEE_NOT_FOUND", 404, undefined, "Employee not found");
  return updated;
}

export async function salaryHistory(companyId: string, employeeId: string) {
  return q(
    `SELECT effective_date, basic_salary, housing_allowance, transport_allowance, other_allowance,
            salary_currency, reason, changed_by, created_at
       FROM employee_salary_history WHERE company_id = $1 AND employee_id = $2
      ORDER BY effective_date DESC, created_at DESC`,
    [companyId, employeeId]
  );
}
