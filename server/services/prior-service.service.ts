// Prior service: provisions the company already owed an employee when it started payroll here.
//
// Gratuity (2036) and leave pay (2037) accrue month by month from the first payroll period. What an employee earned
// before that comes in as OPENING PROVISIONS entered on the employee (opening gratuity, opening leave days and leave
// provision, as of a date), never as a silent year-to-date catch-up inside the first run. An employee with prior
// service and no opening provisions is named in the run's warnings and in the register; the accountant can then
// book the catch-up as its own journal with an explicit action ("Book prior-service catch-up journal"):
//
//   Dr 3020 Retained Earnings / Cr 2036 EOSB provision / Cr 2037 Leave provision     source "payroll_catchup"
//
// dated with the run, at the day before the company's first payroll period, then marked on each employee so it is
// booked once.

import { pool } from "../db";
import { AppError } from "../errors";
import { storage } from "../storage";
import { calculateGratuityForEmployee, isUaeOrGccNational } from "./gratuity";
import { postHrJournal, type HrJournalLine } from "./hr-journal";
import { getLeaveBalances, unpaidServiceDays } from "./leave.service";
import { ensureLeaveProvisionAccounts } from "./leave-provision.service";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const addDays = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export interface PriorServiceMissing {
  employeeId: string;
  name: string;
}

/** The first day of the company's earliest payroll period (null before any run exists). */
export async function firstPayrollPeriodStart(companyId: string): Promise<string | null> {
  const r = await pool.query(`SELECT to_char(MIN(make_date(period_year, period_month, 1)), 'YYYY-MM-DD') AS d FROM payroll_runs WHERE company_id = $1`, [companyId]);
  return r.rows[0]?.d ?? null;
}

/** Active employees who joined before the first payroll period and have neither opening provisions nor a catch-up. */
export async function priorServiceMissing(companyId: string): Promise<PriorServiceMissing[]> {
  const first = await firstPayrollPeriodStart(companyId);
  if (!first) return [];
  const r = await pool.query(
    `SELECT id::text AS "employeeId", full_name AS name FROM employees
      WHERE company_id = $1 AND status = 'active' AND join_date IS NOT NULL AND join_date < $2::date
        AND opening_gratuity_provision = 0 AND opening_leave_provision = 0 AND opening_leave_days = 0
        AND opening_provisions_as_of IS NULL AND prior_service_catchup_at IS NULL
      ORDER BY full_name`,
    [companyId, first]
  );
  return r.rows;
}

export function priorServiceWarning(missing: PriorServiceMissing[]): string | null {
  if (missing.length === 0) return null;
  return `Prior service not provided for: ${missing.map((m) => m.name).join(", ")}. Enter opening provisions on each employee or book a prior-service catch-up journal.`;
}

export interface CatchupEmployee {
  employeeId: string;
  name: string;
  gratuity: number;
  leave: number;
  /** The annual leave balance (days) at the as-of date: becomes the employee's opening leave days. */
  leaveDays: number;
}

export async function bookPriorServiceCatchup(args: { companyId: string; runId: string; userId: string }) {
  const run = (await pool.query(`SELECT period_month, period_year FROM payroll_runs WHERE id = $1 AND company_id = $2`, [args.runId, args.companyId])).rows[0];
  if (!run) throw new AppError({ message: "Payroll run not found", statusCode: 404, code: "NOT_FOUND" });
  const missing = await priorServiceMissing(args.companyId);
  if (missing.length === 0) {
    throw new AppError({ message: "Every employee with prior service already has opening provisions or a catch-up.", statusCode: 409, code: "NOTHING_TO_BOOK" });
  }
  const first = (await firstPayrollPeriodStart(args.companyId))!;
  const asOf = addDays(first, -1);
  const emps = (
    await pool.query(
      `SELECT id::text AS id, full_name AS name, nationality, to_char(join_date, 'YYYY-MM-DD') AS join, basic_salary::float8 AS basic,
              (basic_salary + housing_allowance + transport_allowance + other_allowance)::float8 AS wage
         FROM employees WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [args.companyId, missing.map((m) => m.employeeId)]
    )
  ).rows;
  const done: CatchupEmployee[] = [];
  for (const e of emps) {
    let gratuity = 0;
    if (!isUaeOrGccNational(e.nationality)) {
      const unpaid = await unpaidServiceDays(args.companyId, e.id, e.join, asOf);
      gratuity = calculateGratuityForEmployee({ joinDate: new Date(`${e.join}T00:00:00Z`), endDate: new Date(`${asOf}T00:00:00Z`), basicSalary: e.basic, totalWage: e.wage, isGccNational: false, unpaidDays: unpaid }).totalGratuity;
    }
    const balance = (await getLeaveBalances(args.companyId, { asOfYmd: asOf, employeeId: e.id })).find((b) => b.code === "annual")?.balance ?? 0;
    done.push({ employeeId: e.id, name: e.name, gratuity: r2(gratuity), leave: r2(Math.max(0, balance) * (e.basic / 30)), leaveDays: r2(Math.max(0, balance)) });
  }
  const gratuityTotal = r2(done.reduce((s, d) => s + d.gratuity, 0));
  const leaveTotal = r2(done.reduce((s, d) => s + d.leave, 0));

  let journalEntryId: string | null = null;
  if (gratuityTotal + leaveTotal > 0) {
    const accounts = await storage.getAccountsByCompanyId(args.companyId);
    const find = (code: string) => accounts.find((a) => a.code === code && !a.isArchived)?.id;
    const retained = find("3020");
    const eosb = find("2036");
    if (!retained || !eosb) throw new AppError({ message: "Retained Earnings (3020) or the gratuity provision (2036) is missing from the chart of accounts.", statusCode: 422, code: "CHART_ACCOUNT_MISSING" });
    const leaveAccounts = await ensureLeaveProvisionAccounts(args.companyId);
    const label = `${String(run.period_month).padStart(2, "0")}/${run.period_year}`;
    const lines: HrJournalLine[] = [{ accountId: retained, debit: r2(gratuityTotal + leaveTotal), credit: 0, description: `Prior-service catch-up - payroll ${label}` }];
    if (gratuityTotal > 0) lines.push({ accountId: eosb, debit: 0, credit: gratuityTotal, description: "Gratuity earned before payroll started" });
    if (leaveTotal > 0) lines.push({ accountId: leaveAccounts.provisionId, debit: 0, credit: leaveTotal, description: "Leave pay earned before payroll started" });
    const dateYmd = new Date(Date.UTC(run.period_year, run.period_month, 0)).toISOString().slice(0, 10);
    const je = await postHrJournal({ companyId: args.companyId, dateYmd, memo: `Prior-service catch-up - payroll ${label}`, source: "payroll_catchup", sourceId: args.runId, userId: args.userId, lines });
    journalEntryId = je.id;
  }
  // The gratuity becomes each employee's opening provision (settlements use opening + accruals); the leave goes on their
  // leave-provision ledger; both mark the employee as handled.
  for (const d of done) {
    await pool.query(`UPDATE employees SET opening_gratuity_provision = opening_gratuity_provision + $2, opening_leave_days = $4, opening_provisions_as_of = $3::date, prior_service_catchup_at = NOW() WHERE id = $1`, [d.employeeId, d.gratuity, asOf, d.leaveDays]);
    if (d.leave > 0) await pool.query(`INSERT INTO employee_leave_provisions (company_id, employee_id, amount) VALUES ($1, $2, $3)`, [args.companyId, d.employeeId, d.leave]);
  }
  return { journalEntryId, asOf, gratuityTotal, leaveTotal, total: r2(gratuityTotal + leaveTotal), employees: done };
}
