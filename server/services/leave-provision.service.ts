// Monthly leave-pay provision: the annual leave an employee has earned and not taken is a liability at the daily wage
// (basic / 30). Each approved payroll run tops the provision up to that figure:
//
//   Dr 5029 Leave Pay Expense / Cr 2037 Leave Provision      (reversed when the balance of leave falls)
//
// employee_leave_provisions keeps the provision per employee (accruals positive, uses and releases negative), so a
// final settlement can use it for the leave it pays out and leave 2037 at zero for the leaver. A company setting
// (companies.leave_provision_enabled, on by default) switches it off.

import { pool, db } from "../db";
import { ACCOUNT_CODES } from "../constants";
import { ensureSystemAccount } from "./inventory-costing.service";
import { getLeaveBalances } from "./leave.service";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function leaveProvisionEnabled(companyId: string): Promise<boolean> {
  const r = await pool.query(`SELECT leave_provision_enabled AS on FROM companies WHERE id = $1`, [companyId]);
  return r.rows[0]?.on !== false;
}

export async function ensureLeaveProvisionAccounts(companyId: string): Promise<{ expenseId: string; provisionId: string }> {
  const ensure = async (code: string, type: string) => {
    try {
      return (await ensureSystemAccount(db as any, companyId, code, type)).id;
    } catch (err: any) {
      if (err?.code === "23505" || err?.cause?.code === "23505") return (await ensureSystemAccount(db as any, companyId, code, type)).id;
      throw err;
    }
  };
  return {
    expenseId: await ensure(ACCOUNT_CODES.LEAVE_PAY_EXPENSE, "expense"),
    provisionId: await ensure(ACCOUNT_CODES.LEAVE_PROVISION, "liability"),
  };
}

/** What the company holds for each employee's accrued leave. */
export async function leaveProvisionBalances(companyId: string, employeeIds?: string[]): Promise<Map<string, number>> {
  const r = await pool.query(
    `SELECT employee_id::text AS id, COALESCE(SUM(amount), 0)::float8 AS balance FROM employee_leave_provisions
      WHERE company_id = $1 AND ($2::uuid[] IS NULL OR employee_id = ANY($2::uuid[])) GROUP BY employee_id`,
    [companyId, employeeIds ?? null]
  );
  return new Map(r.rows.map((row: any) => [row.id, row.balance]));
}

export interface LeaveProvisionDelta {
  employeeId: string;
  target: number;
  current: number;
  delta: number;
}

/** Per employee: the provision the earned-and-untaken annual leave calls for at the end of the period, and the top-up. */
export async function leaveProvisionDeltas(companyId: string, periodEndYmd: string, employeeIds: string[]): Promise<LeaveProvisionDelta[]> {
  if (employeeIds.length === 0) return [];
  const balances = (await getLeaveBalances(companyId, { asOfYmd: periodEndYmd })).filter((b) => b.code === "annual" && employeeIds.includes(b.employeeId));
  const basics = await pool.query(`SELECT id::text AS id, basic_salary::float8 AS basic FROM employees WHERE company_id = $1 AND id = ANY($2::uuid[])`, [companyId, employeeIds]);
  const basicOf = new Map<string, number>(basics.rows.map((r: any) => [r.id as string, Number(r.basic)]));
  const current = await leaveProvisionBalances(companyId, employeeIds);
  const out: LeaveProvisionDelta[] = [];
  for (const b of balances) {
    const target = r2(Math.max(0, b.balance) * ((basicOf.get(b.employeeId) ?? 0) / 30));
    const now = current.get(b.employeeId) ?? 0;
    const delta = r2(target - now);
    if (delta !== 0) out.push({ employeeId: b.employeeId, target, current: now, delta });
  }
  return out;
}

export async function recordRunProvisions(companyId: string, runId: string, deltas: LeaveProvisionDelta[]): Promise<void> {
  for (const d of deltas) {
    await pool.query(
      `INSERT INTO employee_leave_provisions (company_id, employee_id, payroll_run_id, amount) VALUES ($1, $2, $3, $4)
       ON CONFLICT (payroll_run_id, employee_id) WHERE payroll_run_id IS NOT NULL DO NOTHING`,
      [companyId, d.employeeId, runId, d.delta]
    );
  }
}
