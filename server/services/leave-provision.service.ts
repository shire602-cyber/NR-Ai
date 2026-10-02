// Monthly leave-pay provision: the annual leave an employee earns is a liability at the daily wage (basic / 30). Each
// approved payroll run books THAT MONTH's accrual (a service month earns 2.5 days = basic/12; unpaid absence earns
// nothing; annual leave taken in the month is released):
//
//   Dr 5029 Leave Pay Expense / Cr 2037 Leave Provision      (reversed when more leave was taken than accrued)
//
// What the employee brought with them (opening_leave_provision, or a prior-service catch-up journal) is NOT booked
// in a run: nothing is caught up silently, so the first run's P&L carries one month, not the year to date.
//
// employee_leave_provisions keeps the provision per employee (accruals positive, uses and releases negative), so a
// final settlement can use it for the leave it pays out and leave 2037 at zero for the leaver. A company setting
// (companies.leave_provision_enabled, on by default) switches it off.

import { pool, db } from "../db";
import { ACCOUNT_CODES } from "../constants";
import { ensureSystemAccount } from "./inventory-costing.service";
import { annualLeaveTakenInRange } from "./leave.service";
import { accrualRateForServiceMonth, completedServiceMonths } from "./leave-math";

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

/** What the company holds for each employee: the opening provision plus every accrual, use and release since. */
export async function leaveProvisionBalances(companyId: string, employeeIds?: string[]): Promise<Map<string, number>> {
  const r = await pool.query(
    `SELECT e.id::text AS id,
            (e.opening_leave_provision + COALESCE((SELECT SUM(p.amount) FROM employee_leave_provisions p WHERE p.employee_id = e.id AND p.company_id = e.company_id), 0))::float8 AS balance
       FROM employees e WHERE e.company_id = $1 AND ($2::uuid[] IS NULL OR e.id = ANY($2::uuid[]))`,
    [companyId, employeeIds ?? null]
  );
  return new Map(r.rows.map((row: any) => [row.id, row.balance]));
}

export interface LeaveProvisionDelta {
  employeeId: string;
  /** What was earned this month (days x daily wage) and what was taken. */
  accrued: number;
  taken: number;
  current: number;
  delta: number;
}

const addDays = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Per employee on the run: this month's accrual less the annual leave taken in it. Pure read: used by the approval (which
 * books it) and by the register of a draft run (which shows it).
 */
export async function leaveProvisionDeltas(companyId: string, runId: string, periodStartYmd: string, periodEndYmd: string): Promise<LeaveProvisionDelta[]> {
  const rows = (
    await pool.query(
      `SELECT pi.employee_id::text AS id, pi.unpaid_leave_days::float8 AS unpaid, e.basic_salary::float8 AS basic, to_char(e.join_date, 'YYYY-MM-DD') AS join
         FROM payroll_items pi JOIN employees e ON e.id = pi.employee_id WHERE pi.payroll_run_id = $1 AND e.company_id = $2`,
      [runId, companyId]
    )
  ).rows;
  if (rows.length === 0) return [];
  const ids = rows.map((r: any) => r.id as string);
  const taken = await annualLeaveTakenInRange(companyId, ids, periodStartYmd, periodEndYmd);
  const held = await leaveProvisionBalances(companyId, ids);
  const dayBefore = addDays(periodStartYmd, -1);
  const out: LeaveProvisionDelta[] = [];
  for (const r of rows) {
    const daily = r.basic / 30;
    // A service month is earned on its last day: this month earns one if it completed between the two dates.
    let rate = 0;
    if (r.join) {
      const before = completedServiceMonths(r.join, dayBefore);
      const upTo = completedServiceMonths(r.join, periodEndYmd);
      if (upTo > before) rate = accrualRateForServiceMonth(upTo, 30);
    }
    // Unpaid absence is not service: each unpaid day takes 30/360 of a day off the accrual.
    const days = Math.max(0, rate - (r.unpaid || 0) * (30 / 360));
    const accrued = r2(days * daily);
    const used = r2((taken.get(r.id) ?? 0) * daily);
    const current = held.get(r.id) ?? 0;
    const delta = r2(Math.max(accrued - used, -Math.max(0, current)));
    if (delta !== 0 || accrued !== 0) out.push({ employeeId: r.id, accrued, taken: used, current, delta });
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
