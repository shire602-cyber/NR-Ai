// Payroll register: one row per employee of a run with every pay component, the run totals, and a tie-out of
// those totals to the journal entry the approval posted (net = Cr 2030, gross - leave = Dr 5020, loans = Cr 1080,
// sundry deductions = Cr 2034, employer pension = Dr 5025, gratuity = Dr 5028).

import Decimal from "decimal.js";
import { pool } from "../db";

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
  unpaidLeaveDays: number;
  halfPayLeaveDays: number;
}

export type RegisterTotals = Omit<RegisterRow, "employeeId" | "employeeNumber" | "employeeName" | "department">;

const NUMERIC_KEYS = [
  "basic", "housing", "transport", "other", "overtime", "gross", "totalDeductions", "leaveDeduction", "loanDeduction", "deductions",
  "pensionEmployee", "net", "pensionEmployer", "gratuityAccrual", "unpaidLeaveDays", "halfPayLeaveDays",
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
  const rows: RegisterRow[] = items.rows.map((r: any) => ({
    ...r,
    gross: r2(new Decimal(r.basic).plus(r.housing).plus(r.transport).plus(r.other).plus(r.overtime)),
    totalDeductions: r2(new Decimal(r.deductions).plus(r.pensionEmployee).plus(r.leaveDeduction).plus(r.loanDeduction)),
  }));
  const totals = totalsOf(rows);

  let tieOut: { available: boolean; entryId: string | null; checks: TieOutCheck[]; ok: boolean } = { available: false, entryId: null, checks: [], ok: false };
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
  }
  // Only an approved (or paid) run is posted payroll; anything else is shown as a draft and never ties to the ledger.
  const isDraft = run.status !== "approved" && run.status !== "paid";
  return { runId: run.id, periodMonth: run.period_month, periodYear: run.period_year, status: run.status, isDraft, label: isDraft ? "draft" : "approved", rows, totals, journalTieOut: tieOut };
}

const CSV_COLUMNS: Array<[keyof RegisterRow, string]> = [
  ["employeeNumber", "Employee no"], ["employeeName", "Employee"], ["department", "Department"], ["basic", "Basic"], ["housing", "Housing"],
  ["transport", "Transport"], ["other", "Other allowance"], ["overtime", "Overtime"], ["gross", "Gross"], ["totalDeductions", "Total deductions"], ["leaveDeduction", "Leave deduction"],
  ["loanDeduction", "Loan deduction"], ["deductions", "Other deductions"], ["pensionEmployee", "Pension (employee)"], ["net", "Net pay"],
  ["pensionEmployer", "Pension (employer)"], ["gratuityAccrual", "Gratuity accrual"], ["unpaidLeaveDays", "Unpaid leave days"], ["halfPayLeaveDays", "Half-pay leave days"],
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
