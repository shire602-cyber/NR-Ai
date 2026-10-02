// Final settlement of a leaving employee: gratuity true-up against the 2036 provision, unused annual leave, the loan
// still owed and other deductions, in one journal entry on the termination date (settlement-math.ts).
//
//   draft  ->  posted (employee terminated, loan recovered)  ->  paid (Dr 2030 / Cr cash or bank)
//   draft  ->  void;   posted  ->  void (unpaid only: exact reversal, the employee is active again)
//
// Posting, paying and voiding run under withDocumentLock(employeeId, LOCK_NS.SETTLEMENT). The gratuity is the
// existing calculator (services/gratuity.ts), moved out of the payroll routes unchanged.

import { pool } from "../db";
import { AppError } from "../errors";
import { storage } from "../storage";
import { toCalendarYmd } from "../utils/date";
import { LOCK_NS, withDocumentLock } from "./document-lock";
import { calculateGratuityForEmployee, isUaeOrGccNational } from "./gratuity";
import { assertCashOrBankAccount, ensureEmployeeLoansAccount, postHrJournal, reverseHrJournal, type HrJournalLine } from "./hr-journal";
import { annualLeaveAvailable } from "./leave.service";
import { remainingBalance } from "./loan-math";
import { computeSettlement } from "./settlement-math";

const err = (statusCode: number, code: string, message: string, details?: Record<string, unknown>) => {
  const e = new AppError({ message, statusCode, code, details });
  if (details) e.toJSON = () => ({ message, code, ...details });
  return e;
};

export interface SettlementRequest {
  employeeId: string;
  terminationDate: string;
  reason?: "resignation" | "termination" | "end_of_contract";
  /** Override of the provision used (default: the gratuity accrued for the employee, never above the 2036 balance). */
  provisionUsed?: number | null;
  /** Override of the unused annual leave days paid out (default: the annual balance on the termination date). */
  leaveDays?: number | null;
  otherDeductions?: number;
  notes?: string | null;
}

const utc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

async function facts(companyId: string, req: SettlementRequest) {
  const r = await pool.query(
    `SELECT id::text AS id, full_name AS "fullName", nationality, status, to_char(join_date, 'YYYY-MM-DD') AS "joinYmd",
            basic_salary::float8 AS basic, (basic_salary + housing_allowance + transport_allowance + other_allowance)::float8 AS wage
       FROM employees WHERE id = $1 AND company_id = $2`,
    [req.employeeId, companyId]
  );
  const employee = r.rows[0];
  if (!employee) throw err(422, "INVALID_EMPLOYEE", "The employee does not belong to this company.");
  if (employee.joinYmd && req.terminationDate < employee.joinYmd) throw err(422, "INVALID_DATES", "The termination date is before the join date.");

  const isGcc = isUaeOrGccNational(employee.nationality);
  const warnings: string[] = [];
  let gratuity = { totalGratuity: 0, yearsOfService: 0, eligible: false, reason: null as string | null };
  if (employee.joinYmd) {
    const g = calculateGratuityForEmployee({ joinDate: utc(employee.joinYmd), endDate: utc(req.terminationDate), basicSalary: employee.basic, totalWage: employee.wage, isGccNational: isGcc });
    // Years of service are shown for everyone; only the gratuity is zero for a GCC national (pension instead).
    const years = isGcc
      ? calculateGratuityForEmployee({ joinDate: utc(employee.joinYmd), endDate: utc(req.terminationDate), basicSalary: employee.basic, totalWage: employee.wage, isGccNational: false }).yearsOfService
      : g.yearsOfService;
    gratuity = { totalGratuity: g.totalGratuity, yearsOfService: years, eligible: g.eligible, reason: g.reason };
  } else {
    warnings.push("The employee has no join date: the gratuity could not be calculated.");
  }

  const accrued = await pool.query(
    `SELECT COALESCE(SUM(pi.gratuity_accrual), 0)::float8 AS total
       FROM payroll_items pi JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
      WHERE pi.employee_id = $1 AND pr.company_id = $2 AND pr.status IN ('approved', 'paid')`,
    [req.employeeId, companyId]
  );
  const provisionBalance = await pool.query(
    `SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::float8 AS balance
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = '2036'`,
    [companyId]
  );
  const loans = await pool.query(
    `SELECT i.amount::float8 AS amount, i.status FROM employee_loan_installments i JOIN employee_loans l ON l.id = i.loan_id
      WHERE i.company_id = $1 AND l.employee_id = $2 AND l.status = 'active'`,
    [companyId, req.employeeId]
  );
  const leaveDays = req.leaveDays !== undefined && req.leaveDays !== null ? req.leaveDays : await annualLeaveAvailable(companyId, req.employeeId, req.terminationDate);

  return {
    employee,
    isGcc,
    warnings,
    gratuity,
    leaveDays,
    provisionDefault: accrued.rows[0].total as number,
    provisionBalance: provisionBalance.rows[0].balance as number,
    loanOutstanding: remainingBalance(loans.rows),
    reservedInstalments: loans.rows.some((i: any) => i.status === "reserved"),
  };
}

function compute(f: Awaited<ReturnType<typeof facts>>, req: SettlementRequest) {
  const result = computeSettlement({
    gratuityAmount: f.gratuity.totalGratuity,
    provisionDefault: f.provisionDefault,
    provisionBalance: f.provisionBalance,
    provisionOverride: req.provisionUsed ?? null,
    basic: f.employee.basic,
    leaveDays: f.leaveDays,
    loanOutstanding: f.loanOutstanding,
    otherDeductions: req.otherDeductions ?? 0,
  });
  if (!result.ok) throw err(422, result.code, result.message);
  return result;
}

export async function previewSettlement(companyId: string, req: SettlementRequest) {
  const f = await facts(companyId, req);
  const result = compute(f, req);
  const { ok: _ok, ...amounts } = result;
  return {
    employeeId: f.employee.id,
    employeeName: f.employee.fullName,
    terminationDate: req.terminationDate,
    reason: req.reason ?? "resignation",
    isGccNational: f.isGcc,
    basicSalary: f.employee.basic,
    totalWage: f.employee.wage,
    yearsOfService: Math.round(f.gratuity.yearsOfService * 10000) / 10000,
    gratuityEligible: f.gratuity.eligible,
    leaveDays: f.leaveDays,
    provisionAccrued: f.provisionDefault,
    provisionBalance: f.provisionBalance,
    warnings: f.warnings,
    ...amounts,
  };
}

const COLUMNS = `s.id::text AS id, s.employee_id::text AS "employeeId", e.full_name AS "employeeName", to_char(s.termination_date, 'YYYY-MM-DD') AS "terminationDate",
  s.reason, s.basic_salary::float8 AS "basicSalary", s.total_wage::float8 AS "totalWage", s.is_gcc_national AS "isGccNational",
  s.years_of_service::float8 AS "yearsOfService", s.gratuity_amount::float8 AS "gratuityAmount", s.provision_used::float8 AS "provisionUsed", s.provision_overridden AS "provisionOverridden",
  s.gratuity_true_up::float8 AS "gratuityTrueUp", s.leave_days::float8 AS "leaveDays", s.leave_encashment::float8 AS "leaveEncashment",
  s.loan_recovered::float8 AS "loanRecovered", s.other_deductions::float8 AS "otherDeductions", s.net_payable::float8 AS "netPayable",
  s.status, s.notes, s.payment_account_id::text AS "paymentAccountId", to_char(s.paid_date, 'YYYY-MM-DD') AS "paidDate",
  s.journal_entry_id::text AS "journalEntryId", s.payment_journal_entry_id::text AS "paymentJournalEntryId", s.void_journal_entry_id::text AS "voidJournalEntryId",
  s.created_at AS "createdAt"`;
const FROM = `FROM employee_final_settlements s JOIN employees e ON e.id = s.employee_id`;

export async function listSettlements(companyId: string, f: { status?: string; limit: number; offset: number }) {
  const params: unknown[] = [companyId];
  let where = "s.company_id = $1";
  if (f.status && f.status !== "all") { params.push(f.status); where += ` AND s.status = $${params.length}`; }
  params.push(f.limit, f.offset);
  return (await pool.query(`SELECT ${COLUMNS} ${FROM} WHERE ${where} ORDER BY s.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
}

export async function getSettlement(settlementId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(settlementId)) return null;
  return (await pool.query(`SELECT ${COLUMNS}, s.company_id::text AS "companyId" ${FROM} WHERE s.id = $1`, [settlementId])).rows[0] ?? null;
}

export async function createSettlement(companyId: string, userId: string, req: SettlementRequest) {
  const f = await facts(companyId, req);
  if (f.employee.status !== "active") throw err(409, "EMPLOYEE_NOT_ACTIVE", "A final settlement can be made only for an active employee.");
  const existing = await pool.query(`SELECT 1 FROM employee_final_settlements WHERE employee_id = $1 AND status IN ('draft', 'posted', 'paid') LIMIT 1`, [req.employeeId]);
  if (existing.rows[0]) throw err(409, "SETTLEMENT_EXISTS", "This employee already has a final settlement.");
  const r = compute(f, req);
  try {
    const ins = await pool.query(
      `INSERT INTO employee_final_settlements (company_id, employee_id, termination_date, reason, basic_salary, total_wage, is_gcc_national, years_of_service,
          gratuity_amount, provision_used, gratuity_true_up, leave_days, leave_encashment, loan_recovered, other_deductions, net_payable, notes, created_by,
          provision_overridden)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id::text`,
      [
        companyId, req.employeeId, req.terminationDate, req.reason ?? "resignation", f.employee.basic, f.employee.wage, f.isGcc,
        Math.round(f.gratuity.yearsOfService * 10000) / 10000, r.gratuityAmount, r.provisionUsed, r.gratuityTrueUp, f.leaveDays, r.leaveEncashment,
        r.loanRecovered, r.otherDeductions, r.netPayable, req.notes ?? null, userId,
        req.provisionUsed !== undefined && req.provisionUsed !== null,
      ]
    );
    return await getSettlement(ins.rows[0].id);
  } catch (e: any) {
    if (e?.code === "23505") throw err(409, "SETTLEMENT_EXISTS", "This employee already has a final settlement.");
    throw e;
  }
}

async function accountIds(companyId: string, codes: string[]): Promise<Map<string, string>> {
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const out = new Map<string, string>();
  for (const code of codes) {
    const a = accounts.find((x) => x.code === code && !x.isArchived);
    if (!a) throw err(422, "CHART_ACCOUNT_MISSING", `Account ${code} is missing from the chart of accounts.`);
    out.set(code, a.id);
  }
  return out;
}

export async function postSettlement(settlementId: string, userId: string) {
  const initial = await getSettlement(settlementId);
  if (!initial) throw err(404, "NOT_FOUND", "Final settlement not found.");
  return await withDocumentLock(initial.employeeId, LOCK_NS.SETTLEMENT, async () => {
    const s = await getSettlement(settlementId);
    if (!s) throw err(404, "NOT_FOUND", "Final settlement not found.");
    if (s.status !== "draft") throw err(409, "NOT_DRAFT", `This settlement is ${s.status}.`);
    const request: SettlementRequest = {
      employeeId: s.employeeId,
      terminationDate: s.terminationDate,
      reason: s.reason,
      provisionUsed: s.provisionOverridden ? s.provisionUsed : null,
      leaveDays: s.leaveDays,
      otherDeductions: s.otherDeductions,
    };
    const f = await facts(s.companyId, request);
    if (f.employee.status !== "active") throw err(409, "EMPLOYEE_NOT_ACTIVE", "The employee is no longer active.");
    if (f.reservedInstalments) throw err(409, "LOAN_HAS_RESERVED", "A payroll run is waiting to deduct a loan instalment of this employee. Approve or recalculate it first.");
    // The gratuity is the draft's snapshot; the loan still owed is read again now (payroll may have deducted since).
    const r = computeSettlement({
      gratuityAmount: s.gratuityAmount,
      // Typed by the user: kept. Otherwise recomputed now: payroll runs approved since the draft add to the accrual.
      provisionDefault: f.provisionDefault,
      provisionBalance: f.provisionBalance,
      provisionOverride: s.provisionOverridden ? s.provisionUsed : null,
      basic: s.basicSalary,
      leaveDays: s.leaveDays,
      loanOutstanding: f.loanOutstanding,
      otherDeductions: s.otherDeductions,
    });
    if (!r.ok) throw err(422, r.code, r.message);

    const codes = ["5020", "2030"];
    if (r.provisionUsed > 0) codes.push("2036");
    if (r.gratuityTrueUp !== 0) codes.push("5028");
    if (r.otherDeductions > 0) codes.push("2034");
    const ids = await accountIds(s.companyId, codes);
    const lines: HrJournalLine[] = [];
    if (r.provisionUsed > 0) lines.push({ accountId: ids.get("2036")!, debit: r.provisionUsed, credit: 0, description: `Gratuity provision used - ${s.employeeName}` });
    if (r.gratuityTrueUp > 0) lines.push({ accountId: ids.get("5028")!, debit: r.gratuityTrueUp, credit: 0, description: `Gratuity true-up - ${s.employeeName}` });
    if (r.gratuityTrueUp < 0) lines.push({ accountId: ids.get("5028")!, debit: 0, credit: -r.gratuityTrueUp, description: `Gratuity over-accrual released - ${s.employeeName}` });
    if (r.leaveEncashment > 0) lines.push({ accountId: ids.get("5020")!, debit: r.leaveEncashment, credit: 0, description: `Unused leave paid out - ${s.employeeName}` });
    if (r.loanRecovered > 0) lines.push({ accountId: await ensureEmployeeLoansAccount(s.companyId), debit: 0, credit: r.loanRecovered, description: `Loan recovered from settlement - ${s.employeeName}` });
    if (r.otherDeductions > 0) lines.push({ accountId: ids.get("2034")!, debit: 0, credit: r.otherDeductions, description: `Settlement deductions - ${s.employeeName}` });
    if (r.netPayable > 0) lines.push({ accountId: ids.get("2030")!, debit: 0, credit: r.netPayable, description: `Final settlement payable - ${s.employeeName}` });

    const je = await postHrJournal({
      companyId: s.companyId,
      dateYmd: s.terminationDate,
      memo: `Final settlement - ${s.employeeName}`,
      source: "final_settlement",
      sourceId: settlementId,
      userId,
      lines,
    });

    await pool.query(`UPDATE employees SET status = 'terminated', termination_date = $2 WHERE id = $1`, [s.employeeId, s.terminationDate]);
    if (r.loanRecovered > 0) {
      await pool.query(
        `UPDATE employee_loan_installments i SET status = 'settled', settled_by_settlement_id = $2
           FROM employee_loans l WHERE l.id = i.loan_id AND l.employee_id = $1 AND l.status = 'active' AND i.status = 'scheduled'`,
        [s.employeeId, settlementId]
      );
      await pool.query(
        `UPDATE employee_loans l SET status = 'settled'
          WHERE l.employee_id = $1 AND l.status = 'active' AND NOT EXISTS (SELECT 1 FROM employee_loan_installments i WHERE i.loan_id = l.id AND i.status IN ('scheduled', 'reserved'))`,
        [s.employeeId]
      );
    }
    await pool.query(
      `UPDATE employee_final_settlements SET status = 'posted', journal_entry_id = $2, loan_recovered = $3, net_payable = $4, gratuity_true_up = $5, provision_used = $6, updated_at = NOW() WHERE id = $1`,
      [settlementId, je.id, r.loanRecovered, r.netPayable, r.gratuityTrueUp, r.provisionUsed]
    );
    return await getSettlement(settlementId);
  });
}

export async function paySettlement(settlementId: string, userId: string, input: { paymentAccountId: string; date?: string }) {
  const initial = await getSettlement(settlementId);
  if (!initial) throw err(404, "NOT_FOUND", "Final settlement not found.");
  await assertCashOrBankAccount(initial.companyId, input.paymentAccountId);
  const dateYmd = input.date ?? toCalendarYmd(new Date());
  if (dateYmd > toCalendarYmd(new Date())) throw err(422, "PAYMENT_IN_FUTURE", "The payment date cannot be in the future.");
  return await withDocumentLock(initial.employeeId, LOCK_NS.SETTLEMENT, async () => {
    const s = await getSettlement(settlementId);
    if (!s) throw err(404, "NOT_FOUND", "Final settlement not found.");
    if (s.status !== "posted") throw err(409, "NOT_POSTED", `Only a posted settlement can be paid; this one is ${s.status}.`);
    if (!(s.netPayable > 0)) throw err(409, "NOTHING_TO_PAY", "There is nothing payable on this settlement.");
    const ids = await accountIds(s.companyId, ["2030"]);
    const je = await postHrJournal({
      companyId: s.companyId,
      dateYmd,
      memo: `Final settlement paid - ${s.employeeName}`,
      source: "final_settlement_payment",
      sourceId: settlementId,
      userId,
      lines: [
        { accountId: ids.get("2030")!, debit: s.netPayable, credit: 0, description: `Final settlement paid - ${s.employeeName}` },
        { accountId: input.paymentAccountId, debit: 0, credit: s.netPayable, description: `Final settlement paid - ${s.employeeName}` },
      ],
    });
    await pool.query(
      `UPDATE employee_final_settlements SET status = 'paid', payment_account_id = $2, paid_date = $3, payment_journal_entry_id = $4, updated_at = NOW() WHERE id = $1`,
      [settlementId, input.paymentAccountId, dateYmd, je.id]
    );
    return await getSettlement(settlementId);
  });
}

export async function voidSettlement(settlementId: string, userId: string) {
  const initial = await getSettlement(settlementId);
  if (!initial) throw err(404, "NOT_FOUND", "Final settlement not found.");
  return await withDocumentLock(initial.employeeId, LOCK_NS.SETTLEMENT, async () => {
    const s = await getSettlement(settlementId);
    if (!s) throw err(404, "NOT_FOUND", "Final settlement not found.");
    if (s.status === "paid") throw err(409, "SETTLEMENT_PAID", "A paid settlement cannot be voided; it needs a correcting entry.");
    if (s.status === "void") throw err(409, "ALREADY_VOID", "This settlement is already void.");
    if (s.status === "draft") {
      await pool.query(`UPDATE employee_final_settlements SET status = 'void', updated_at = NOW() WHERE id = $1`, [settlementId]);
      return await getSettlement(settlementId);
    }
    const reversal = await reverseHrJournal({
      companyId: s.companyId,
      entryId: s.journalEntryId,
      source: "final_settlement_void",
      sourceId: settlementId,
      userId,
      memo: `Void final settlement - ${s.employeeName}`,
    });
    await pool.query(`UPDATE employees SET status = 'active', termination_date = NULL WHERE id = $1 AND status = 'terminated'`, [s.employeeId]);
    await pool.query(`UPDATE employee_loan_installments SET status = 'scheduled', settled_by_settlement_id = NULL WHERE settled_by_settlement_id = $1`, [settlementId]);
    await pool.query(
      `UPDATE employee_loans l SET status = 'active' WHERE l.employee_id = $1 AND l.status = 'settled'
          AND EXISTS (SELECT 1 FROM employee_loan_installments i WHERE i.loan_id = l.id AND i.status = 'scheduled')`,
      [s.employeeId]
    );
    await pool.query(`UPDATE employee_final_settlements SET status = 'void', void_journal_entry_id = $2, updated_at = NOW() WHERE id = $1`, [settlementId, reversal.id]);
    return await getSettlement(settlementId);
  });
}

