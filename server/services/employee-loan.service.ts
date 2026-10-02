// Employee loans and advances: disbursement, schedule, payroll deduction, cancellation and cash repayment.
//
//   disbursed   Dr 1080 Employee Loans / Cr cash or bank, on the disbursement date            source employee_loan
//   deducted    each payroll run Cr 1080 for the instalments it reserved (payroll.routes approve)
//   cancelled   exact reversal on the original date, only while nothing is reserved or deducted source employee_loan_cancel
//   repaid      Dr cash or bank / Cr 1080 for the rest; the remaining instalments are settled     source employee_loan_repayment
//
// Loan state changes run under withDocumentLock(loanId, LOCK_NS.EMPLOYEE_LOAN); payroll calculate reserves the due
// instalments with row locks, so a cancel racing a payroll run has exactly one winner.

import type { PoolClient } from "pg";
import { pool } from "../db";
import { AppError } from "../errors";
import { toCalendarYmd } from "../utils/date";
import { LOCK_NS, withDocumentLock } from "./document-lock";
import { assertCashOrBankAccount, ensureEmployeeLoansAccount, postHrJournal, reverseHrJournal } from "./hr-journal";
import { allocateRunDeductions, buildLoanSchedule, instalmentCapProblem, maxInstalment, periodKey, remainingBalance, type ScheduleItem } from "./loan-math";

const err = (statusCode: number, code: string, message: string, details?: Record<string, unknown>) => {
  const e = new AppError({ message, statusCode, code, details });
  if (details) e.toJSON = () => ({ message, code, ...details, details });
  return e;
};

/** Instalments the employee's OTHER active loans still have to take, per period (the cap is shared by all loans). */
async function committedInstalments(companyId: string, employeeId: string): Promise<Map<number, number>> {
  const r = await pool.query(
    `SELECT i.period_year AS y, i.period_month AS m, SUM(i.amount)::float8 AS amount
       FROM employee_loan_installments i JOIN employee_loans l ON l.id = i.loan_id
      WHERE i.company_id = $1 AND l.employee_id = $2 AND l.status = 'active' AND i.status IN ('scheduled', 'reserved')
      GROUP BY i.period_year, i.period_month`,
    [companyId, employeeId]
  );
  return new Map(r.rows.map((row: any) => [periodKey(row.y, row.m), row.amount]));
}

export interface LoanInput {
  employeeId: string;
  kind?: "loan" | "advance";
  principal: number;
  instalmentCount: number;
  firstPeriodYear: number;
  firstPeriodMonth: number;
  disbursementDate: string;
  paymentAccountId: string;
  notes?: string | null;
}

async function loadEmployee(companyId: string, employeeId: string) {
  const r = await pool.query(
    `SELECT id::text AS id, full_name AS "fullName", status, basic_salary::float8 AS basic,
            (basic_salary + housing_allowance + transport_allowance + other_allowance)::float8 AS wage
       FROM employees WHERE id = $1 AND company_id = $2`,
    [employeeId, companyId]
  );
  return r.rows[0] as { id: string; fullName: string; status: string; basic: number; wage: number } | undefined;
}

/** The schedule and the 20 % cap for a proposed loan; nothing is written. */
export async function previewLoan(companyId: string, input: Pick<LoanInput, "employeeId" | "principal" | "instalmentCount" | "firstPeriodYear" | "firstPeriodMonth">) {
  const employee = await loadEmployee(companyId, input.employeeId);
  if (!employee) throw err(422, "INVALID_EMPLOYEE", "The employee does not belong to this company.");
  const schedule = buildLoanSchedule({ principal: input.principal, count: input.instalmentCount, firstYear: input.firstPeriodYear, firstMonth: input.firstPeriodMonth });
  const cap = instalmentCapProblem(schedule, employee.wage, await committedInstalments(companyId, employee.id));
  return {
    employeeId: employee.id,
    monthlyWage: employee.wage,
    maxInstalment: maxInstalment(employee.wage),
    instalmentAmount: schedule[0]?.amount ?? 0,
    withinCap: cap === null,
    schedule,
  };
}

const LOAN_COLUMNS = `l.id::text AS id, l.employee_id::text AS "employeeId", e.full_name AS "employeeName", l.loan_number AS "loanNumber", l.kind,
  l.principal::float8 AS principal, l.instalment_count AS "instalmentCount", l.instalment_amount::float8 AS "instalmentAmount",
  l.first_period_year AS "firstPeriodYear", l.first_period_month AS "firstPeriodMonth", to_char(l.disbursement_date, 'YYYY-MM-DD') AS "disbursementDate",
  l.payment_account_id::text AS "paymentAccountId", l.status, l.notes, l.journal_entry_id::text AS "journalEntryId",
  l.cancel_journal_entry_id::text AS "cancelJournalEntryId", l.repayment_journal_entry_id::text AS "repaymentJournalEntryId", l.created_at AS "createdAt"`;
const LOAN_FROM = `FROM employee_loans l JOIN employees e ON e.id = l.employee_id`;

const INSTALMENT_COLUMNS = `id::text AS id, sequence, period_year AS "periodYear", period_month AS "periodMonth", amount::float8 AS amount,
  deducted_amount::float8 AS "deductedAmount", status, payroll_run_id::text AS "payrollRunId"`;

export async function listLoans(companyId: string, f: { status?: string; employeeId?: string; limit: number; offset: number }) {
  const params: unknown[] = [companyId];
  let where = "l.company_id = $1";
  if (f.status && f.status !== "all") { params.push(f.status); where += ` AND l.status = $${params.length}`; }
  if (f.employeeId) { params.push(f.employeeId); where += ` AND l.employee_id = $${params.length}`; }
  params.push(f.limit, f.offset);
  const loans = (await pool.query(`SELECT ${LOAN_COLUMNS} ${LOAN_FROM} WHERE ${where} ORDER BY l.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
  if (loans.length === 0) return loans;
  const instalments = (await pool.query(`SELECT loan_id::text AS "loanId", amount::float8 AS amount, status FROM employee_loan_installments WHERE loan_id = ANY($1::uuid[])`, [loans.map((l: any) => l.id)])).rows;
  return loans.map((l: any) => ({ ...l, outstanding: remainingBalance(instalments.filter((i: any) => i.loanId === l.id)) }));
}

export async function getLoan(loanId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(loanId)) return null;
  const loan = (await pool.query(`SELECT ${LOAN_COLUMNS}, l.company_id::text AS "companyId" ${LOAN_FROM} WHERE l.id = $1`, [loanId])).rows[0];
  if (!loan) return null;
  const instalments = (await pool.query(`SELECT ${INSTALMENT_COLUMNS} FROM employee_loan_installments WHERE loan_id = $1 ORDER BY sequence`, [loanId])).rows;
  return { ...loan, instalments, outstanding: remainingBalance(instalments) };
}

export async function createLoan(companyId: string, userId: string, input: LoanInput) {
  const employee = await loadEmployee(companyId, input.employeeId);
  if (!employee) throw err(422, "INVALID_EMPLOYEE", "The employee does not belong to this company.");
  if (employee.status !== "active") throw err(409, "EMPLOYEE_NOT_ACTIVE", "A loan can be made only to an active employee.");
  await assertCashOrBankAccount(companyId, input.paymentAccountId);
  if (input.disbursementDate > toCalendarYmd(new Date())) throw err(422, "DISBURSEMENT_IN_FUTURE", "The disbursement date cannot be in the future.");

  const schedule = buildLoanSchedule({ principal: input.principal, count: input.instalmentCount, firstYear: input.firstPeriodYear, firstMonth: input.firstPeriodMonth });
  const cap = instalmentCapProblem(schedule, employee.wage, await committedInstalments(companyId, employee.id));
  if (cap) {
    throw err(422, "DEDUCTION_CAP", `The instalments of all this employee's loans together may not be more than 20 % of the monthly wage; ${cap.maxInstalment.toFixed(2)} is left for this loan. Use more instalments or a smaller loan.`, { maxInstalment: cap.maxInstalment });
  }
  const loansAccountId = await ensureEmployeeLoansAccount(companyId);

  const client = await pool.connect();
  let loanId = "";
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`loan-number:${companyId}`]);
    const next = await client.query(`SELECT COALESCE(MAX(substring(loan_number from 4)::int), 0) + 1 AS n FROM employee_loans WHERE company_id = $1 AND loan_number ~ '^LN-[0-9]+$'`, [companyId]);
    const number = `LN-${String(next.rows[0].n).padStart(4, "0")}`;
    const ins = await client.query(
      `INSERT INTO employee_loans (company_id, employee_id, loan_number, kind, principal, instalment_count, instalment_amount, first_period_year,
                                   first_period_month, disbursement_date, payment_account_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id::text`,
      [companyId, input.employeeId, number, input.kind ?? "loan", input.principal, input.instalmentCount, schedule[0].amount, input.firstPeriodYear, input.firstPeriodMonth, input.disbursementDate, input.paymentAccountId, input.notes ?? null, userId]
    );
    loanId = ins.rows[0].id;
    for (const i of schedule) {
      await client.query(
        `INSERT INTO employee_loan_installments (company_id, loan_id, sequence, period_year, period_month, amount) VALUES ($1,$2,$3,$4,$5,$6)`,
        [companyId, loanId, i.sequence, i.periodYear, i.periodMonth, i.amount]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  // The disbursement posts after the loan exists; if the ledger refuses (locked month), the loan is removed again.
  try {
    const je = await postHrJournal({
      companyId,
      dateYmd: input.disbursementDate,
      memo: `Employee loan - ${employee.fullName}`,
      source: "employee_loan",
      sourceId: loanId,
      userId,
      lines: [
        { accountId: loansAccountId, debit: input.principal, credit: 0, description: `Loan to ${employee.fullName}` },
        { accountId: input.paymentAccountId, debit: 0, credit: input.principal, description: `Loan paid to ${employee.fullName}` },
      ],
    });
    await pool.query(`UPDATE employee_loans SET journal_entry_id = $2 WHERE id = $1`, [loanId, je.id]);
  } catch (e) {
    await pool.query(`DELETE FROM employee_loans WHERE id = $1`, [loanId]).catch(() => {});
    throw e;
  }
  return await getLoan(loanId);
}

export async function cancelLoan(loanId: string, userId: string) {
  const initial = await getLoan(loanId);
  if (!initial) throw err(404, "NOT_FOUND", "Loan not found.");
  return await withDocumentLock(loanId, LOCK_NS.EMPLOYEE_LOAN, async () => {
    const loan = await getLoan(loanId);
    if (!loan) throw err(404, "NOT_FOUND", "Loan not found.");
    if (loan.status !== "active") throw err(409, "LOAN_NOT_ACTIVE", `This loan is ${loan.status}.`);
    // Rows are locked so a payroll calculation reserving them at this moment is serialised with the cancel.
    const locked = await pool.query(`SELECT status FROM employee_loan_installments WHERE loan_id = $1 FOR UPDATE`, [loanId]);
    if (locked.rows.some((i: any) => i.status === "deducted" || i.status === "reserved" || i.status === "settled")) {
      throw err(409, "LOAN_HAS_DEDUCTIONS", "Payroll has deducted, or is about to deduct, instalments of this loan. It can no longer be cancelled; record a cash repayment instead.");
    }
    const reversal = await reverseHrJournal({
      companyId: loan.companyId,
      entryId: loan.journalEntryId,
      source: "employee_loan_cancel",
      sourceId: loanId,
      userId,
      memo: `Cancel employee loan ${loan.loanNumber}`,
    });
    await pool.query(`UPDATE employee_loan_installments SET status = 'cancelled' WHERE loan_id = $1`, [loanId]);
    await pool.query(`UPDATE employee_loans SET status = 'cancelled', cancel_journal_entry_id = $2 WHERE id = $1`, [loanId, reversal.id]);
    return await getLoan(loanId);
  });
}

export async function repayLoan(loanId: string, userId: string, input: { paymentAccountId: string; date?: string }) {
  const initial = await getLoan(loanId);
  if (!initial) throw err(404, "NOT_FOUND", "Loan not found.");
  await assertCashOrBankAccount(initial.companyId, input.paymentAccountId);
  const dateYmd = input.date ?? toCalendarYmd(new Date());
  if (dateYmd > toCalendarYmd(new Date())) throw err(422, "REPAYMENT_IN_FUTURE", "The repayment date cannot be in the future.");
  return await withDocumentLock(loanId, LOCK_NS.EMPLOYEE_LOAN, async () => {
    const loan = await getLoan(loanId);
    if (!loan) throw err(404, "NOT_FOUND", "Loan not found.");
    if (loan.status !== "active") throw err(409, "LOAN_NOT_ACTIVE", `This loan is ${loan.status}.`);
    if (loan.instalments.some((i: any) => i.status === "reserved")) {
      throw err(409, "LOAN_HAS_RESERVED", "A payroll run is waiting to deduct an instalment of this loan. Approve or recalculate it first.");
    }
    const amount = remainingBalance(loan.instalments);
    if (!(amount > 0)) throw err(409, "NOTHING_OWED", "Nothing is owed on this loan.");
    const loansAccountId = await ensureEmployeeLoansAccount(loan.companyId);
    const je = await postHrJournal({
      companyId: loan.companyId,
      dateYmd,
      memo: `Cash repayment of employee loan ${loan.loanNumber}`,
      source: "employee_loan_repayment",
      sourceId: loanId,
      userId,
      lines: [
        { accountId: input.paymentAccountId, debit: amount, credit: 0, description: `Repayment of ${loan.loanNumber}` },
        { accountId: loansAccountId, debit: 0, credit: amount, description: `Loan ${loan.loanNumber} repaid in cash` },
      ],
    });
    await pool.query(`UPDATE employee_loan_installments SET status = 'settled' WHERE loan_id = $1 AND status = 'scheduled'`, [loanId]);
    await pool.query(`UPDATE employee_loans SET status = 'settled', repayment_journal_entry_id = $2 WHERE id = $1`, [loanId, je.id]);
    return await getLoan(loanId);
  });
}

// ---------------------------------------------------------------------------
// Payroll hooks
// ---------------------------------------------------------------------------

/** A run being recalculated gives back what it had reserved. */
export async function releaseRunInstalments(runId: string, client?: { query: (text: string, params?: unknown[]) => Promise<unknown> }): Promise<void> {
  await (client ?? pool).query(
    `UPDATE employee_loan_installments SET status = 'scheduled', payroll_run_id = NULL, payroll_item_id = NULL WHERE payroll_run_id = $1 AND status = 'reserved'`,
    [runId]
  );
}

/**
 * Reserve the instalments an employee's pay can carry in this run (those due on or before the run's period), up to
 * 50 % of gross less the other deductions. What does not fit is deferred: the instalment is cut to what fits and the
 * rest becomes a new last instalment of the loan. Returns the total reserved.
 */
export async function reserveInstalmentsForItem(args: {
  companyId: string;
  runId: string;
  itemId: string;
  employeeId: string;
  periodYear: number;
  periodMonth: number;
  grossPay: number;
  generalDeductions: number;
  /** The caller's transaction (payroll calculate): reservations commit or roll back with the run. */
  client?: PoolClient;
}): Promise<number> {
  const ownTx = !args.client;
  const client = args.client ?? (await pool.connect());
  try {
    if (ownTx) await client.query("BEGIN");
    const due = await client.query(
      `SELECT i.id::text AS id, i.loan_id::text AS "loanId", i.sequence, i.amount::float8 AS amount
         FROM employee_loan_installments i JOIN employee_loans l ON l.id = i.loan_id
        WHERE i.company_id = $1 AND l.employee_id = $2 AND l.status = 'active' AND i.status = 'scheduled'
          AND (i.period_year * 12 + i.period_month) <= $3
        ORDER BY i.period_year, i.period_month, l.created_at, i.sequence
        FOR UPDATE OF i`,
      [args.companyId, args.employeeId, args.periodYear * 12 + args.periodMonth]
    );
    if (due.rows.length === 0) {
      if (ownTx) await client.query("COMMIT");
      return 0;
    }
    const wageRow = await client.query(`SELECT (basic_salary + housing_allowance + transport_allowance + other_allowance)::float8 AS wage FROM employees WHERE id = $1`, [args.employeeId]);
    const byId = new Map(due.rows.map((r: any) => [r.id, r]));
    const allocation = allocateRunDeductions({
      due: due.rows.map((r: any, index: number) => ({ id: r.id, sequence: index, amount: r.amount })),
      grossPay: args.grossPay,
      generalDeductions: args.generalDeductions,
      monthlyWage: wageRow.rows[0]?.wage,
    });
    for (const take of allocation.take) {
      const row: any = byId.get(take.id);
      if (take.amount > 0) {
        await client.query(
          `UPDATE employee_loan_installments SET status = 'reserved', amount = $2, payroll_run_id = $3, payroll_item_id = $4 WHERE id = $1`,
          [take.id, take.amount, args.runId, args.itemId]
        );
      }
      if (take.deferred > 0) {
        const tail = await client.query(
          `SELECT sequence, period_year, period_month FROM employee_loan_installments WHERE loan_id = $1 ORDER BY sequence DESC LIMIT 1`,
          [row.loanId]
        );
        const last = tail.rows[0];
        const total = last.period_year * 12 + (last.period_month - 1) + 1;
        const nextYear = Math.floor(total / 12);
        const nextMonth = (total % 12) + 1;
        if (take.amount > 0) {
          await client.query(
            `INSERT INTO employee_loan_installments (company_id, loan_id, sequence, period_year, period_month, amount) VALUES ($1,$2,$3,$4,$5,$6)`,
            [args.companyId, row.loanId, last.sequence + 1, nextYear, nextMonth, take.deferred]
          );
        } else {
          // Nothing of it fits: the whole instalment moves to the end of the schedule.
          await client.query(`UPDATE employee_loan_installments SET sequence = $2, period_year = $3, period_month = $4 WHERE id = $1`, [take.id, last.sequence + 1, nextYear, nextMonth]);
        }
      }
    }
    if (ownTx) await client.query("COMMIT");
    return allocation.total;
  } catch (e) {
    if (ownTx) await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    if (ownTx) client.release();
  }
}

/** A run is approved: what it reserved is deducted, and a loan with nothing left owed is settled. */
export async function markRunInstalmentsDeducted(runId: string): Promise<void> {
  await pool.query(`UPDATE employee_loan_installments SET status = 'deducted', deducted_amount = amount WHERE payroll_run_id = $1 AND status = 'reserved'`, [runId]);
  await pool.query(
    `UPDATE employee_loans l SET status = 'settled'
      WHERE l.status = 'active' AND l.id IN (SELECT DISTINCT loan_id FROM employee_loan_installments WHERE payroll_run_id = $1)
        AND NOT EXISTS (SELECT 1 FROM employee_loan_installments i WHERE i.loan_id = l.id AND i.status IN ('scheduled', 'reserved'))`,
    [runId]
  );
}

export type { ScheduleItem };
