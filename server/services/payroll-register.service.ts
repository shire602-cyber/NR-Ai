// Payroll register: one row per employee of a run with every pay component, the run totals, and a tie-out of
// those totals to the journal entry the approval posted (net = Cr 2030, gross - leave = Dr 5020, loans = Cr 1080,
// sundry deductions = Cr 2034, employer pension = Dr 5025, gratuity = Dr 5028).

import Decimal from "decimal.js";
import { pool } from "../db";
import { leaveProvisionDeltas, leaveProvisionEnabled } from "./leave-provision.service";
import { priorServiceMissing, priorServiceWarning } from "./prior-service.service";

const r2 = (v: Decimal.Value): number => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

export interface RegisterRow {
  employeeId: string;
  employeeNumber: string | null;
  employeeName: string;
  department: string | null;
  basic: number;
  housing: number;
  transport: number;
  other: number;
  overtime: number;
  gross: number;
  /** Every deduction together (sundry, employee pension, leave, loan): gross - totalDeductions = net. */
  totalDeductions: number;
  leaveDeduction: number;
  loanDeduction: number;
  deductions: number;
  pensionEmployee: number;
  net: number;
  pensionEmployer: number;
  gratuityAccrual: number;
  /** Leave-pay provision for the month (accrual less leave taken): Dr 5029 / Cr 2037. */
  leaveAccrual: number;
  /** What the employee costs the company beyond the pay: employer pension + gratuity accrual + leave accrual. */
  employerCost: number;
  unpaidLeaveDays: number;
  halfPayLeaveDays: number;
}

export type RegisterTotals = Omit<RegisterRow, "employeeId" | "employeeNumber" | "employeeName" | "department">;

const NUMERIC_KEYS = [
  "basic", "housing", "transport", "other", "overtime", "gross", "totalDeductions", "leaveDeduction", "loanDeduction", "deductions",
  "pensionEmployee", "net", "pensionEmployer", "gratuityAccrual", "leaveAccrual", "employerCost", "unpaidLeaveDays", "halfPayLeaveDays",
] as const;

export function totalsOf(rows: RegisterRow[]): RegisterTotals {
  const out: Record<string, number> = {};
  for (const key of NUMERIC_KEYS) out[key] = r2(rows.reduce((sum, row) => sum.plus(row[key]), new Decimal(0)));
  return out as unknown as RegisterTotals;
}

export interface TieOutCheck {
  label: string;
  account: string;
  side: "debit" | "credit";
  register: number;
  ledger: number;
  ok: boolean;
}

export async function buildPayrollRegister(run: { id: string; company_id: string; journal_entry_id: string | null; status: string; period_month: number; period_year: number }) {
  const items = await pool.query(
    `SELECT pi.employee_id::text AS "employeeId", e.employee_number AS "employeeNumber", e.full_name AS "employeeName", e.department,
            pi.basic_salary::float8 AS basic, pi.housing_allowance::float8 AS housing, pi.transport_allowance::float8 AS transport,
            pi.other_allowance::float8 AS other, pi.overtime::float8 AS overtime, pi.leave_deduction::float8 AS "leaveDeduction",
            pi.loan_deduction::float8 AS "loanDeduction", pi.deductions::float8 AS deductions, pi.pension_employee::float8 AS "pensionEmployee",
            pi.net_salary::float8 AS net, pi.pension_employer::float8 AS "pensionEmployer", pi.gratuity_accrual::float8 AS "gratuityAccrual",
            pi.unpaid_leave_days::float8 AS "unpaidLeaveDays", pi.half_pay_leave_days::float8 AS "halfPayLeaveDays"
       FROM payroll_items pi JOIN employees e ON e.id = pi.employee_id
      WHERE pi.payroll_run_id = $1 ORDER BY e.full_name`,
    [run.id]
  );
  // Leave accrual per employee: what the approval booked, or (a draft) what it would book.
  const isPosted = run.status === "approved" || run.status === "paid";
  const accrual = new Map<string, number>();
  if (isPosted) {
    const booked = await pool.query(`SELECT employee_id::text AS id, amount::float8 AS amount FROM employee_leave_provisions WHERE payroll_run_id = $1`, [run.id]);
    for (const b of booked.rows) accrual.set(b.id, b.amount);
  } else if (await leaveProvisionEnabled(run.company_id)) {
    const periodStart = `${run.period_year}-${String(run.period_month).padStart(2, "0")}-01`;
    const periodEnd = new Date(Date.UTC(run.period_year, run.period_month, 0)).toISOString().slice(0, 10);
    for (const d of await leaveProvisionDeltas(run.company_id, run.id, periodStart, periodEnd)) accrual.set(d.employeeId, d.delta);
  }
  const rows: RegisterRow[] = items.rows.map((r: any) => {
    const leaveAccrual = r2(accrual.get(r.employeeId) ?? 0);
    return {
      ...r,
      gross: r2(new Decimal(r.basic).plus(r.housing).plus(r.transport).plus(r.other).plus(r.overtime)),
      totalDeductions: r2(new Decimal(r.deductions).plus(r.pensionEmployee).plus(r.leaveDeduction).plus(r.loanDeduction)),
      leaveAccrual,
      employerCost: r2(new Decimal(r.pensionEmployer).plus(r.gratuityAccrual).plus(leaveAccrual)),
    };
  });
  const totals = totalsOf(rows);

  let tieOut: { available: boolean; entryId: string | null; checks: TieOutCheck[]; ok: boolean } = { available: false, entryId: null, checks: [], ok: false };
  let reconciliation: { available: boolean; entryId: string | null; rows: Array<{ code: string; label: string; register: number; ledger: number; difference: number }>; difference: number; ok: boolean } = {
    available: false,
    entryId: null,
    rows: [],
    difference: 0,
    ok: false,
  };
  if (run.journal_entry_id) {
    const lines = await pool.query(
      `SELECT a.code, COALESCE(SUM(jl.debit), 0)::float8 AS debit, COALESCE(SUM(jl.credit), 0)::float8 AS credit
         FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1 GROUP BY a.code`,
      [run.journal_entry_id]
    );
    const byCode = new Map<string, { debit: number; credit: number }>(lines.rows.map((l: any) => [l.code, l]));
    const check = (label: string, account: string, side: "debit" | "credit", register: number): TieOutCheck => {
      const ledger = r2(byCode.get(account)?.[side] ?? 0);
      return { label, account, side, register: r2(register), ledger, ok: Math.abs(ledger - r2(register)) < 0.005 };
    };
    const checks = [
      check("Net salaries payable", "2030", "credit", totals.net),
      check("Salaries and wages expense (gross less leave deductions)", "5020", "debit", r2(new Decimal(totals.gross).minus(totals.leaveDeduction))),
      check("Employee loans recovered", "1080", "credit", totals.loanDeduction),
      check("Sundry deductions payable", "2034", "credit", totals.deductions),
      check("Employer pension expense", "5025", "debit", totals.pensionEmployer),
      check("Gratuity expense", "5028", "debit", totals.gratuityAccrual),
    ];
    tieOut = { available: true, entryId: run.journal_entry_id, checks, ok: checks.every((c) => c.ok) };
    // The reconciliation block: the run's postings next to the register totals, with the difference (it must be 0.00).
    const net = (code: string, side: "debit" | "credit") => {
      const l = byCode.get(code);
      return r2(side === "debit" ? new Decimal(l?.debit ?? 0).minus(l?.credit ?? 0) : new Decimal(l?.credit ?? 0).minus(l?.debit ?? 0));
    };
    const rec = (code: string, label: string, register: number, ledger: number) => ({ code, label, register: r2(register), ledger, difference: r2(new Decimal(ledger).minus(register)) });
    const recRows = [
      rec("5020", "Salaries and wages expense (gross less leave deductions)", r2(new Decimal(totals.gross).minus(totals.leaveDeduction)), net("5020", "debit")),
      rec("2030", "Salaries payable (net pay)", totals.net, net("2030", "credit")),
      rec("5025", "Employer pension expense", totals.pensionEmployer, net("5025", "debit")),
      rec("5028", "Gratuity expense", totals.gratuityAccrual, net("5028", "debit")),
      rec("5029", "Leave pay expense (provision)", totals.leaveAccrual, net("5029", "debit")),
    ];
    const diff = r2(recRows.reduce((sum, row) => sum.plus(Math.abs(row.difference)), new Decimal(0)));
    reconciliation = { available: true, entryId: run.journal_entry_id, rows: recRows, difference: diff, ok: diff < 0.005 };
  }
  // Only an approved (or paid) run is posted payroll; anything else is shown as a draft and never ties to the ledger.
  const isDraft = run.status !== "approved" && run.status !== "paid";
  const missing = await priorServiceMissing(run.company_id);
  const warning = priorServiceWarning(missing);
  return {
    runId: run.id,
    periodMonth: run.period_month,
    periodYear: run.period_year,
    status: run.status,
    isDraft,
    label: isDraft ? "draft" : "approved",
    rows,
    totals,
    journalTieOut: tieOut,
    reconciliation,
    warnings: warning ? [warning] : [],
    priorServiceMissing: missing,
  };
}

const CSV_COLUMNS: Array<[keyof RegisterRow, string]> = [
  ["employeeNumber", "Employee no"], ["employeeName", "Employee"], ["department", "Department"], ["basic", "Basic"], ["housing", "Housing"],
  ["transport", "Transport"], ["other", "Other allowance"], ["overtime", "Overtime"], ["gross", "Gross"], ["totalDeductions", "Total deductions"], ["leaveDeduction", "Leave deduction"],
  ["loanDeduction", "Loan deduction"], ["deductions", "Other deductions"], ["pensionEmployee", "Pension (employee)"], ["net", "Net pay"],
  ["pensionEmployer", "Pension (employer)"], ["gratuityAccrual", "Gratuity accrual"], ["leaveAccrual", "Leave accrual"], ["employerCost", "Employer cost"], ["unpaidLeaveDays", "Unpaid leave days"], ["halfPayLeaveDays", "Half-pay leave days"],
];

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  // A cell that starts like a formula is neutralised so a spreadsheet does not run it.
  const safe = /^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function registerToCsv(register: { rows: RegisterRow[]; totals: RegisterTotals }): string {
  const lines = [CSV_COLUMNS.map(([, header]) => csvCell(header)).join(",")];
  for (const row of register.rows) lines.push(CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(","));
  lines.push(CSV_COLUMNS.map(([key], i) => (i === 1 ? csvCell("Total") : key in register.totals ? csvCell((register.totals as any)[key]) : "")).join(","));
  return lines.join("\n") + "\n";
}
