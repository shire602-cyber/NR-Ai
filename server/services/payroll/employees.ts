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

function totalSalary(values: Record<string, unknown>): string {
  return fromFils(sumFils(SALARY_KEYS.map((k) => fils(values[k] ?? "0"))));
}

export async function createEmployee(
  companyId: string,
  actorId: string,
  body: EmployeeCreateBody
): Promise<Row> {
  await assertCostCenter(companyId, body.costCenterId);
  const values: Record<string, unknown> = { ...NOT_NULL_DEFAULTS };
  for (const [k, v] of Object.entries(body)) if (v !== undefined) values[k] = v;
  const keys = Object.keys(values).filter((k) => EMPLOYEE_COLUMNS[k]);
  const cols = keys.map((k) => `"${EMPLOYEE_COLUMNS[k]}"`);
  const params = keys.map((k) => values[k]);
  cols.push(`"company_id"`, `"total_salary"`, `"status"`, `"created_by"`);
  params.push(companyId, totalSalary(values), "active", actorId);
  const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");
  const employee = await q1<Row & { id: string }>(
    `INSERT INTO employees (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
    params
  );
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
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
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
  );
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
