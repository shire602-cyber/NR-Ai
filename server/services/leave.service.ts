// Leave types, balances and requests, and the leave deductions a payroll run takes (Decree-Law 33/2021).
//
// Balances are derived (leave-math.ts) from the join date, the type and the approved requests; leave_balances
// holds only overrides. Requests are created and approved under withDocumentLock(employeeId, LOCK_NS.LEAVE) so two
// overlapping requests, or two that together exceed the balance, cannot both get in.

import { pool } from "../db";
import { AppError } from "../errors";
import { toCalendarYmd } from "../utils/date";
import { LOCK_NS, withDocumentLock } from "./document-lock";
import {
  daysInRange,
  leaveBalance,
  leaveDeduction,
  spanDays,
  type LeaveBalanceResult,
  type LeaveTypeMath,
  type YearOverride,
} from "./leave-math";

const err = (statusCode: number, code: string, message: string, details?: Record<string, unknown>) => {
  const e = new AppError({ message, statusCode, code, details });
  if (details) e.toJSON = () => ({ message, code, ...details });
  return e;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const DEFAULT_TYPES: Array<{ code: string; en: string; ar: string; policy: string; days: number; accrual: string; carry: number; negative?: boolean }> = [
  { code: "annual", en: "Annual leave", ar: "إجازة سنوية", policy: "full", days: 30, accrual: "monthly_service", carry: 30 },
  { code: "sick", en: "Sick leave", ar: "إجازة مرضية", policy: "sick_tiered", days: 90, accrual: "annual", carry: 0 },
  { code: "maternity", en: "Maternity leave", ar: "إجازة وضع", policy: "manual", days: 60, accrual: "annual", carry: 0 },
  { code: "parental", en: "Parental leave", ar: "إجازة والدية", policy: "full", days: 5, accrual: "annual", carry: 0 },
  { code: "bereavement", en: "Bereavement leave", ar: "إجازة وفاة", policy: "full", days: 5, accrual: "annual", carry: 0 },
  { code: "study", en: "Study leave", ar: "إجازة دراسية", policy: "full", days: 10, accrual: "annual", carry: 0 },
  { code: "hajj", en: "Hajj leave", ar: "إجازة حج", policy: "manual", days: 30, accrual: "annual", carry: 0 },
  { code: "unpaid", en: "Unpaid leave", ar: "إجازة بدون راتب", policy: "unpaid", days: 0, accrual: "none", carry: 0, negative: true },
];

/** The company's leave types; a company with none gets the defaults on first use (idempotent, race-safe). */
export async function ensureLeaveTypes(companyId: string): Promise<void> {
  const existing = await pool.query(`SELECT 1 FROM leave_types WHERE company_id = $1 LIMIT 1`, [companyId]);
  if (existing.rows.length > 0) return;
  for (const t of DEFAULT_TYPES) {
    await pool.query(
      `INSERT INTO leave_types (company_id, code, name_en, name_ar, pay_policy, annual_days, accrual, carry_forward_max_days, allow_negative)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (company_id, code) DO NOTHING`,
      [companyId, t.code, t.en, t.ar, t.policy, t.days, t.accrual, t.carry, t.negative ?? false]
    );
  }
}

const TYPE_COLUMNS = `id::text AS id, company_id::text AS "companyId", code, name_en AS "nameEn", name_ar AS "nameAr", pay_policy AS "payPolicy",
  annual_days::float8 AS "annualDays", accrual, carry_forward_max_days::float8 AS "carryForwardMaxDays", allow_negative AS "allowNegative", is_active AS "isActive"`;

export async function listLeaveTypes(companyId: string) {
  await ensureLeaveTypes(companyId);
  return (await pool.query(`SELECT ${TYPE_COLUMNS} FROM leave_types WHERE company_id = $1 ORDER BY created_at, code`, [companyId])).rows;
}

export async function createLeaveType(
  companyId: string,
  input: { code: string; nameEn: string; nameAr: string; payPolicy: string; annualDays?: number; accrual?: string; carryForwardMaxDays?: number; allowNegative?: boolean }
) {
  await ensureLeaveTypes(companyId);
  try {
    const r = await pool.query(
      `INSERT INTO leave_types (company_id, code, name_en, name_ar, pay_policy, annual_days, accrual, carry_forward_max_days, allow_negative)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text`,
      [companyId, input.code, input.nameEn, input.nameAr, input.payPolicy, input.annualDays ?? 0, input.accrual ?? "annual", input.carryForwardMaxDays ?? 0, input.allowNegative ?? false]
    );
    return (await pool.query(`SELECT ${TYPE_COLUMNS} FROM leave_types WHERE id = $1`, [r.rows[0].id])).rows[0];
  } catch (e: any) {
    if (e?.code === "23505") throw err(409, "LEAVE_TYPE_EXISTS", "A leave type with this code already exists.");
    throw e;
  }
}

export async function findLeaveType(typeId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(typeId)) return null;
  return (await pool.query(`SELECT ${TYPE_COLUMNS} FROM leave_types WHERE id = $1`, [typeId])).rows[0] ?? null;
}

export async function updateLeaveType(
  typeId: string,
  input: { nameEn?: string; nameAr?: string; payPolicy?: string; annualDays?: number; accrual?: string; carryForwardMaxDays?: number; allowNegative?: boolean; isActive?: boolean }
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of [["nameEn", "name_en"], ["nameAr", "name_ar"], ["payPolicy", "pay_policy"], ["annualDays", "annual_days"], ["accrual", "accrual"], ["carryForwardMaxDays", "carry_forward_max_days"], ["allowNegative", "allow_negative"], ["isActive", "is_active"]] as const) {
    if ((input as any)[key] === undefined) continue;
    params.push((input as any)[key]);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length > 0) {
    params.push(typeId);
    await pool.query(`UPDATE leave_types SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  }
  return findLeaveType(typeId);
}

const toMath = (t: any): LeaveTypeMath => ({
  code: t.code,
  payPolicy: t.payPolicy,
  annualDays: Number(t.annualDays),
  accrual: t.accrual,
  carryForwardMaxDays: Number(t.carryForwardMaxDays),
  allowNegative: t.allowNegative === true,
});

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

interface EmployeeRef {
  id: string;
  fullName: string;
  joinYmd: string | null;
  status: string;
}

async function loadEmployees(companyId: string, employeeId?: string): Promise<EmployeeRef[]> {
  const params: unknown[] = [companyId];
  let where = "company_id = $1";
  if (employeeId) {
    params.push(employeeId);
    where += ` AND id = $${params.length}`;
  } else {
    where += ` AND status = 'active'`;
  }
  const r = await pool.query(
    `SELECT id::text AS id, full_name AS "fullName", to_char(join_date, 'YYYY-MM-DD') AS "joinYmd", status FROM employees WHERE ${where} ORDER BY full_name`,
    params
  );
  return r.rows;
}

interface RequestRow {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  startYmd: string;
  endYmd: string;
  days: number;
  status: string;
}

async function loadRequests(companyId: string, employeeIds: string[], statuses: string[]): Promise<RequestRow[]> {
  if (employeeIds.length === 0) return [];
  const r = await pool.query(
    `SELECT id::text AS id, employee_id::text AS "employeeId", leave_type_id::text AS "leaveTypeId",
            to_char(start_date, 'YYYY-MM-DD') AS "startYmd", to_char(end_date, 'YYYY-MM-DD') AS "endYmd", days::float8 AS days, status
       FROM leave_requests WHERE company_id = $1 AND employee_id = ANY($2::uuid[]) AND status = ANY($3::text[])`,
    [companyId, employeeIds, statuses]
  );
  return r.rows;
}

async function loadOverrides(companyId: string, employeeIds: string[]): Promise<Map<string, Map<number, YearOverride>>> {
  const out = new Map<string, Map<number, YearOverride>>();
  if (employeeIds.length === 0) return out;
  const r = await pool.query(
    `SELECT employee_id::text AS "employeeId", leave_type_id::text AS "leaveTypeId", leave_year AS year, opening_days::float8 AS opening, adjustment_days::float8 AS adjustment
       FROM leave_balances WHERE company_id = $1 AND employee_id = ANY($2::uuid[])`,
    [companyId, employeeIds]
  );
  for (const row of r.rows) {
    const key = `${row.employeeId}|${row.leaveTypeId}`;
    const years = out.get(key) ?? new Map<number, YearOverride>();
    years.set(row.year, { opening: row.opening, adjustment: row.adjustment ?? 0 });
    out.set(key, years);
  }
  return out;
}

const yearRange = (y: number) => [`${y}-01-01`, `${y}-12-31`] as const;
const takenIn = (requests: RequestRow[], year: number): number => {
  const [from, to] = yearRange(year);
  return requests.reduce((s, r) => s + daysInRange(r, from, to), 0);
};

export interface BalanceRow {
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  code: string;
  year: number;
  opening: number;
  accrued: number;
  adjustment: number;
  taken: number;
  pending: number;
  balance: number;
  available: number;
}

export async function getLeaveBalances(companyId: string, args: { asOfYmd: string; employeeId?: string }): Promise<BalanceRow[]> {
  await ensureLeaveTypes(companyId);
  const types = (await pool.query(`SELECT ${TYPE_COLUMNS} FROM leave_types WHERE company_id = $1 AND is_active AND accrual <> 'none' ORDER BY created_at, code`, [companyId])).rows;
  const employees = await loadEmployees(companyId, args.employeeId);
  const ids = employees.map((e) => e.id);
  const approved = await loadRequests(companyId, ids, ["approved"]);
  const pending = await loadRequests(companyId, ids, ["pending"]);
  const overrides = await loadOverrides(companyId, ids);
  const rows: BalanceRow[] = [];
  for (const employee of employees) {
    if (!employee.joinYmd) continue;
    for (const type of types) {
      rows.push(balanceRow(employee, type, args.asOfYmd, approved, pending, overrides));
    }
  }
  return rows;
}

function balanceRow(employee: EmployeeRef, type: any, asOfYmd: string, approved: RequestRow[], pending: RequestRow[], overrides: Map<string, Map<number, YearOverride>>): BalanceRow {
  const mine = approved.filter((r) => r.employeeId === employee.id && r.leaveTypeId === type.id);
  const waiting = pending.filter((r) => r.employeeId === employee.id && r.leaveTypeId === type.id);
  const b: LeaveBalanceResult = leaveBalance({
    type: toMath(type),
    joinYmd: employee.joinYmd!,
    asOfYmd,
    takenInYear: (y) => takenIn(mine, y),
    overrides: overrides.get(`${employee.id}|${type.id}`) ?? new Map(),
  });
  const pendingDays = takenIn(waiting, b.year);
  return {
    employeeId: employee.id,
    employeeName: employee.fullName,
    leaveTypeId: type.id,
    code: type.code,
    year: b.year,
    opening: b.opening,
    accrued: b.accrued,
    adjustment: b.adjustment,
    taken: b.taken,
    pending: Math.round(pendingDays * 100) / 100,
    balance: b.balance,
    available: Math.round((b.balance - pendingDays) * 100) / 100,
  };
}

export async function setLeaveBalanceOverride(
  companyId: string,
  input: { employeeId: string; leaveTypeId: string; year: number; openingDays?: number | null; adjustmentDays?: number; note?: string | null }
) {
  const emp = await pool.query(`SELECT 1 FROM employees WHERE id = $1 AND company_id = $2`, [input.employeeId, companyId]);
  if (!emp.rows[0]) throw err(422, "INVALID_EMPLOYEE", "The employee does not belong to this company.");
  const type = await pool.query(`SELECT 1 FROM leave_types WHERE id = $1 AND company_id = $2`, [input.leaveTypeId, companyId]);
  if (!type.rows[0]) throw err(422, "INVALID_LEAVE_TYPE", "The leave type does not belong to this company.");
  await pool.query(
    `INSERT INTO leave_balances (company_id, employee_id, leave_type_id, leave_year, opening_days, adjustment_days, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (employee_id, leave_type_id, leave_year) DO UPDATE
       SET opening_days = EXCLUDED.opening_days, adjustment_days = EXCLUDED.adjustment_days, note = EXCLUDED.note, updated_at = NOW()`,
    [companyId, input.employeeId, input.leaveTypeId, input.year, input.openingDays ?? null, input.adjustmentDays ?? 0, input.note ?? null]
  );
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const REQUEST_COLUMNS = `r.id::text AS id, r.employee_id::text AS "employeeId", e.full_name AS "employeeName", r.leave_type_id::text AS "leaveTypeId",
  t.code AS "typeCode", t.name_en AS "typeNameEn", t.name_ar AS "typeNameAr", t.pay_policy AS "payPolicy",
  to_char(r.start_date, 'YYYY-MM-DD') AS "startDate", to_char(r.end_date, 'YYYY-MM-DD') AS "endDate", r.days::float8 AS days,
  r.status, r.reason, r.decided_by::text AS "decidedBy", r.decided_at AS "decidedAt", r.created_at AS "createdAt"`;
const REQUEST_FROM = `FROM leave_requests r JOIN employees e ON e.id = r.employee_id JOIN leave_types t ON t.id = r.leave_type_id`;

export async function listLeaveRequests(companyId: string, f: { status?: string; employeeId?: string; limit: number; offset: number }) {
  const params: unknown[] = [companyId];
  let where = "r.company_id = $1";
  if (f.status && f.status !== "all") { params.push(f.status); where += ` AND r.status = $${params.length}`; }
  if (f.employeeId) { params.push(f.employeeId); where += ` AND r.employee_id = $${params.length}`; }
  params.push(f.limit, f.offset);
  return (await pool.query(`SELECT ${REQUEST_COLUMNS} ${REQUEST_FROM} WHERE ${where} ORDER BY r.start_date DESC, r.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
}

export async function getLeaveRequest(requestId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return null;
  return (await pool.query(`SELECT ${REQUEST_COLUMNS}, r.company_id::text AS "companyId" ${REQUEST_FROM} WHERE r.id = $1`, [requestId])).rows[0] ?? null;
}

/** An approved or in-flight payroll run covering a month of the leave blocks changes to leave that changes pay. */
async function assertNotInApprovedPayroll(companyId: string, payPolicy: string, startYmd: string, endYmd: string) {
  if (payPolicy === "full" || payPolicy === "manual") return;
  const r = await pool.query(
    `SELECT period_month, period_year FROM payroll_runs
      WHERE company_id = $1 AND status IN ('approved', 'paid', 'pending_approval')
        AND make_date(period_year, period_month, 1) <= $3::date
        AND (make_date(period_year, period_month, 1) + interval '1 month' - interval '1 day')::date >= $2::date
      LIMIT 1`,
    [companyId, startYmd, endYmd]
  );
  if (r.rows[0]) {
    throw err(409, "LEAVE_IN_APPROVED_PAYROLL", `Payroll for ${String(r.rows[0].period_month).padStart(2, "0")}/${r.rows[0].period_year} is already approved: leave that changes pay in that month can no longer be changed.`);
  }
}

async function assertNoOverlap(companyId: string, employeeId: string, startYmd: string, endYmd: string, exceptId?: string) {
  const r = await pool.query(
    `SELECT id FROM leave_requests
      WHERE company_id = $1 AND employee_id = $2 AND status IN ('pending', 'approved')
        AND start_date <= $4::date AND end_date >= $3::date AND ($5::uuid IS NULL OR id <> $5)
      LIMIT 1`,
    [companyId, employeeId, startYmd, endYmd, exceptId ?? null]
  );
  if (r.rows[0]) throw err(409, "LEAVE_OVERLAP", "The employee already has leave (pending or approved) on some of these days.");
}

/** Annual-type balance check, year by year: a request cannot take more than is available unless the type allows it. */
async function assertBalance(companyId: string, employee: EmployeeRef, type: any, req: { startYmd: string; endYmd: string; days: number }, exceptRequestId?: string) {
  if (type.accrual === "none" || type.allowNegative === true) return;
  if (!employee.joinYmd) {
    throw err(422, "EMPLOYEE_JOIN_DATE_MISSING", "Set the employee's join date before recording leave that draws on a balance.");
  }
  const approved = (await loadRequests(companyId, [employee.id], ["approved"])).filter((r) => r.id !== exceptRequestId);
  const pending = (await loadRequests(companyId, [employee.id], ["pending"])).filter((r) => r.id !== exceptRequestId);
  const overrides = await loadOverrides(companyId, [employee.id]);
  const firstYear = Number(req.startYmd.slice(0, 4));
  const lastYear = Number(req.endYmd.slice(0, 4));
  for (let y = firstYear; y <= lastYear; y++) {
    const [from, to] = yearRange(y);
    const inYear = daysInRange({ startYmd: req.startYmd, endYmd: req.endYmd, days: req.days }, from, to);
    if (inYear <= 0) continue;
    const asOf = y === firstYear ? req.startYmd : from;
    const row = balanceRow(employee, type, asOf, approved, pending, overrides);
    if (inYear > row.available + 0.005) {
      throw err(422, "LEAVE_INSUFFICIENT_BALANCE", `Only ${row.available} ${type.code} leave day(s) are available in ${y}; ${inYear} requested.`, { available: row.available, requested: inYear, year: y });
    }
  }
}

export async function createLeaveRequest(
  companyId: string,
  userId: string,
  input: { employeeId: string; leaveTypeId: string; startDate: string; endDate: string; days?: number; reason?: string | null }
) {
  await ensureLeaveTypes(companyId);
  const employees = await loadEmployees(companyId, input.employeeId);
  const employee = employees[0];
  if (!employee) throw err(422, "INVALID_EMPLOYEE", "The employee does not belong to this company.");
  if (employee.status !== "active") throw err(409, "EMPLOYEE_NOT_ACTIVE", "Leave can be recorded only for an active employee.");
  const type = await findLeaveType(input.leaveTypeId);
  if (!type || type.companyId !== companyId || !type.isActive) throw err(422, "INVALID_LEAVE_TYPE", "The leave type does not belong to this company or is switched off.");
  if (input.endDate < input.startDate) throw err(422, "INVALID_DATES", "The end date is before the start date.");
  const span = spanDays(input.startDate, input.endDate);
  const days = input.days ?? span;
  if (!(days > 0) || days > span + 0.001 || Math.round(days * 2) !== days * 2) {
    throw err(422, "INVALID_DAYS", `Days must be a multiple of 0.5 between 0.5 and ${span}.`);
  }

  return await withDocumentLock(input.employeeId, LOCK_NS.LEAVE, async () => {
    await assertNoOverlap(companyId, input.employeeId, input.startDate, input.endDate);
    await assertBalance(companyId, employee, type, { startYmd: input.startDate, endYmd: input.endDate, days });
    const r = await pool.query(
      `INSERT INTO leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, days, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text`,
      [companyId, input.employeeId, input.leaveTypeId, input.startDate, input.endDate, days, input.reason ?? null, userId]
    );
    return await getLeaveRequest(r.rows[0].id);
  });
}

export async function decideLeaveRequest(requestId: string, userId: string, decision: "approve" | "reject" | "cancel") {
  const initial = await getLeaveRequest(requestId);
  if (!initial) throw err(404, "NOT_FOUND", "Leave request not found.");
  return await withDocumentLock(initial.employeeId, LOCK_NS.LEAVE, async () => {
    const req = await getLeaveRequest(requestId);
    if (!req) throw err(404, "NOT_FOUND", "Leave request not found.");
    if (decision === "approve" || decision === "reject") {
      if (req.status !== "pending") throw err(409, "NOT_PENDING", `This request is ${req.status}.`);
    } else if (req.status !== "pending" && req.status !== "approved") {
      throw err(409, "NOT_CANCELLABLE", `A ${req.status} request cannot be cancelled.`);
    }
    if (decision === "approve") {
      const employee = (await loadEmployees(req.companyId, req.employeeId))[0];
      if (!employee || employee.status !== "active") throw err(409, "EMPLOYEE_NOT_ACTIVE", "Leave can be approved only for an active employee.");
      const type = await findLeaveType(req.leaveTypeId);
      await assertNoOverlap(req.companyId, req.employeeId, req.startDate, req.endDate, req.id);
      await assertBalance(req.companyId, employee, type, { startYmd: req.startDate, endYmd: req.endDate, days: req.days }, req.id);
      await assertNotInApprovedPayroll(req.companyId, req.payPolicy, req.startDate, req.endDate);
    }
    if (decision === "cancel" && req.status === "approved") {
      await assertNotInApprovedPayroll(req.companyId, req.payPolicy, req.startDate, req.endDate);
    }
    const next = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "cancelled";
    await pool.query(`UPDATE leave_requests SET status = $2, decided_by = $3, decided_at = NOW() WHERE id = $1`, [requestId, next, userId]);
    return await getLeaveRequest(requestId);
  });
}

// ---------------------------------------------------------------------------
// Payroll: the leave deduction of every employee in a month
// ---------------------------------------------------------------------------

export interface LeaveDeductionResult {
  unpaidDays: number;
  halfDays: number;
  deduction: number;
}

/** Leave deductions per employee for a payroll month, from approved leave. Basic is the employee's basic salary. */
export async function leaveDeductionsForMonth(
  companyId: string,
  year: number,
  month: number,
  employees: Array<{ id: string; basic: number }>
): Promise<Map<string, LeaveDeductionResult>> {
  const out = new Map<string, LeaveDeductionResult>();
  if (employees.length === 0) return out;
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = toCalendarYmd(new Date(Date.UTC(year, month, 0)));
  const yearStart = `${year}-01-01`;
  const dayBefore = toCalendarYmd(new Date(Date.UTC(year, month - 1, 0)));
  const rows = (
    await pool.query(
      `SELECT r.employee_id::text AS "employeeId", r.leave_type_id::text AS "leaveTypeId", t.pay_policy AS "payPolicy",
              to_char(r.start_date, 'YYYY-MM-DD') AS "startYmd", to_char(r.end_date, 'YYYY-MM-DD') AS "endYmd", r.days::float8 AS days
         FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id
        WHERE r.company_id = $1 AND r.status = 'approved' AND r.employee_id = ANY($2::uuid[])
          AND r.start_date <= $3::date AND r.end_date >= $4::date AND t.pay_policy IN ('unpaid', 'half', 'sick_tiered')
        ORDER BY r.start_date`,
      [companyId, employees.map((e) => e.id), monthEnd, yearStart]
    )
  ).rows;
  for (const e of employees) {
    let unpaid = 0;
    let half = 0;
    let deduction = 0;
    const sickDaysBefore = new Map<string, number>();
    const mine = rows.filter((r: any) => r.employeeId === e.id);
    for (const r of mine) {
      const inMonth = daysInRange(r, monthStart, monthEnd);
      if (r.payPolicy === "sick_tiered" && !sickDaysBefore.has(r.leaveTypeId)) {
        // Earlier days of this type in the same calendar year, before the month, set where in the tiers it starts.
        const before = dayBefore >= yearStart
          ? mine.filter((x: any) => x.leaveTypeId === r.leaveTypeId).reduce((s: number, x: any) => s + daysInRange(x, yearStart, dayBefore), 0)
          : 0;
        sickDaysBefore.set(r.leaveTypeId, before);
      }
      if (inMonth <= 0) continue;
      const d = leaveDeduction({ payPolicy: r.payPolicy, basic: e.basic, days: inMonth, sickDaysBefore: sickDaysBefore.get(r.leaveTypeId) ?? 0 });
      if (r.payPolicy === "sick_tiered") sickDaysBefore.set(r.leaveTypeId, (sickDaysBefore.get(r.leaveTypeId) ?? 0) + inMonth);
      unpaid += d.unpaidDays;
      half += d.halfDays;
      deduction += d.deduction;
    }
    // Across several requests in the month the cap still holds: 30 paid days, i.e. never more than basic.
    deduction = Math.min(deduction, e.basic);
    out.set(e.id, { unpaidDays: Math.round(unpaid * 100) / 100, halfDays: Math.round(half * 100) / 100, deduction: Math.round(deduction * 100) / 100 });
  }
  return out;
}

/** Annual-leave days available to an employee on a day (for the leave encashment of a final settlement). */
export async function annualLeaveAvailable(companyId: string, employeeId: string, asOfYmd: string): Promise<number> {
  const rows = await getLeaveBalances(companyId, { asOfYmd, employeeId });
  const annual = rows.find((r) => r.code === "annual");
  return annual ? Math.max(0, annual.available) : 0;
}
