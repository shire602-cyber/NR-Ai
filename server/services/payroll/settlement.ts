/**
 * End-of-service final settlement (R09-17).
 *
 * Computes gratuity (21/30-day tiers, unpaid leave excluded from service,
 * capped — see legal-params), notice pay in lieu, leave encashment, other
 * additions and deductions, then posts ONE balanced entry through the kernel:
 *
 *   Dr 2036 Gratuity Provision      provision accrued for the employee
 *   Dr 5028 Gratuity Expense        gratuity above the provision
 *     (Cr 5028 when the provision exceeds the gratuity: release)
 *   Dr 5020 Salaries & Wages        notice pay + leave encashment + additions
 *     Cr 2034 Deductions Payable    deductions
 *     Cr 2030 Salaries Payable      net settlement (or Cr the bank account
 *                                   when the payment is recorded immediately)
 *
 * The employee is marked terminated in the same transaction.
 */
import type { Request } from "express";
import { DomainError } from "../../errors";
import { emitDomainEventInTx } from "../../platform/event-outbox";
import { recordAudit } from "../audit.service";
import { postJournal, withLedgerTx, type PostJournalLineInput } from "../../ledger";
import { fromFils, toFils } from "../../../shared/money";
import { addDays, calculateSettlement, isoDay, utcDate, type SettlementResult } from "./calc";
import {
  assertPaymentAccount,
  loadPayrollSettings,
  payrollAccounts,
  requireAccount,
} from "./context";
import { leaveBalances, unpaidLeaveDaysBetween } from "./leave";
import { dayOf, fils, q, q1, type Row } from "./sql";

export interface SettlementRequest {
  employeeId: string;
  terminationDate: string;
  reason: string;
  noticeDaysInLieu: number;
  leaveEncashmentDays?: number;
  otherAdditions: string;
  deductions: string;
  paymentAccountId?: string;
}

interface Prepared {
  employee: Row & { id: string; full_name: string; nationality: string | null };
  result: SettlementResult;
  unpaidLeaveDays: number;
  leaveEncashmentDays: number;
  provisionFils: number;
}

async function prepare(companyId: string, body: SettlementRequest): Promise<Prepared> {
  const employee = await q1<Prepared["employee"]>(
    `SELECT * FROM employees WHERE id = $1 AND company_id = $2`,
    [body.employeeId, companyId]
  );
  if (!employee) throw new DomainError("EMPLOYEE_NOT_FOUND", 404, undefined, "Employee not found");
  const join = dayOf(employee.join_date);
  if (!join) {
    throw new DomainError(
      "JOIN_DATE_REQUIRED",
      422,
      undefined,
      "Set the employee's join date first"
    );
  }
  if (body.terminationDate < join) {
    throw new DomainError(
      "TERMINATION_BEFORE_JOIN",
      400,
      undefined,
      "Termination date cannot be before the join date"
    );
  }
  const settings = await loadPayrollSettings(companyId);
  const unpaidLeaveDays = await unpaidLeaveDaysBetween(
    companyId,
    employee.id,
    join,
    body.terminationDate
  );
  let leaveEncashmentDays = body.leaveEncashmentDays;
  if (leaveEncashmentDays === undefined) {
    const balances = await leaveBalances(companyId, employee.id, body.terminationDate);
    leaveEncashmentDays = Math.max(0, balances.find((b) => b.code === "annual")?.balanceDays ?? 0);
  }
  const provision = await q1<{ total: string }>(
    `SELECT COALESCE(SUM(pi.gratuity_accrual), 0)::text AS total
       FROM payroll_items pi JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
      WHERE pr.company_id = $1 AND pi.employee_id = $2 AND pr.status IN ('approved', 'paid')`,
    [companyId, employee.id]
  );
  const provisionFils = fils(provision?.total);
  const result = calculateSettlement(
    {
      basicFils: fils(employee.basic_salary),
      housingFils: fils(employee.housing_allowance),
      transportFils: fils(employee.transport_allowance),
      otherFils: fils(employee.other_allowance),
      joinDate: utcDate(join),
      terminationDate: utcDate(body.terminationDate),
      nationality: employee.nationality,
      unpaidLeaveDays,
      noticeDaysInLieu: body.noticeDaysInLieu,
      leaveEncashmentDays,
      otherAdditionsFils: toFils(body.otherAdditions),
      deductionsFils: toFils(body.deductions),
      provisionFils,
    },
    settings.params
  );
  return { employee, result, unpaidLeaveDays, leaveEncashmentDays, provisionFils };
}

export function describeSettlement(p: Prepared) {
  const r = p.result;
  return {
    employeeId: p.employee.id,
    employeeName: p.employee.full_name,
    serviceDays: r.gratuity.serviceDays,
    completedYears: r.gratuity.completedYears,
    trailingDays: r.gratuity.trailingDays,
    unpaidLeaveDays: p.unpaidLeaveDays,
    gratuityEligible: r.gratuity.eligible,
    gratuityReason: r.gratuity.reason,
    gratuity: fromFils(r.gratuityFils),
    gratuityUncapped: fromFils(r.gratuity.uncappedFils),
    gratuityCap: r.gratuity.capFils === null ? null : fromFils(r.gratuity.capFils),
    isCapped: r.gratuity.isCapped,
    provisionAccrued: fromFils(p.provisionFils),
    noticePay: fromFils(r.noticePayFils),
    leaveEncashmentDays: p.leaveEncashmentDays,
    leaveEncashment: fromFils(r.leaveEncashmentFils),
    otherAdditions: fromFils(r.otherAdditionsFils),
    deductions: fromFils(r.deductionsFils),
    net: fromFils(r.netFils),
  };
}

/** Preview without posting. */
export async function previewSettlement(companyId: string, body: SettlementRequest) {
  return describeSettlement(await prepare(companyId, body));
}

export function settlementLines(
  p: Prepared,
  accounts: Awaited<ReturnType<typeof payrollAccounts>>,
  creditAccountId: string
): PostJournalLineInput[] {
  const r = p.result;
  const who = p.employee.full_name;
  const lines: PostJournalLineInput[] = [];
  const provision = Math.max(0, p.provisionFils);
  if (provision > 0) {
    lines.push({
      accountId: requireAccount(accounts, "gratuityProvision"),
      debitFils: provision,
      description: `Gratuity provision cleared - ${who}`,
    });
  }
  if (r.gratuityExpenseFils > 0) {
    lines.push({
      accountId: requireAccount(accounts, "gratuityExpense"),
      debitFils: r.gratuityExpenseFils,
      description: `End-of-service gratuity above provision - ${who}`,
    });
  } else if (r.gratuityExpenseFils < 0) {
    lines.push({
      accountId: requireAccount(accounts, "gratuityExpense"),
      creditFils: -r.gratuityExpenseFils,
      description: `Excess gratuity provision released - ${who}`,
    });
  }
  const wages = r.noticePayFils + r.leaveEncashmentFils + r.otherAdditionsFils;
  if (wages > 0) {
    lines.push({
      accountId: requireAccount(accounts, "salariesExpense"),
      debitFils: wages,
      description: `Notice pay, leave encashment and additions - ${who}`,
    });
  }
  if (r.deductionsFils > 0) {
    lines.push({
      accountId: requireAccount(accounts, "deductionsPayable"),
      creditFils: r.deductionsFils,
      description: `Final settlement deductions - ${who}`,
    });
  }
  if (r.netFils > 0) {
    lines.push({
      accountId: creditAccountId,
      creditFils: r.netFils,
      description: `Final settlement payable - ${who}`,
    });
  }
  return lines;
}

export async function postSettlement(
  companyId: string,
  actorId: string,
  body: SettlementRequest,
  req?: Request
) {
  const p = await prepare(companyId, body);
  if (p.result.netFils < 0) {
    throw new DomainError(
      "NEGATIVE_SETTLEMENT",
      422,
      { net: fromFils(p.result.netFils) },
      "Deductions exceed the settlement amount"
    );
  }
  return withLedgerTx(async (tx) => {
    const emp = await q1<{ status: string }>(
      `SELECT status FROM employees WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [p.employee.id, companyId],
      tx
    );
    if (!emp || emp.status === "terminated") {
      throw new DomainError(
        "EMPLOYEE_ALREADY_SETTLED",
        409,
        undefined,
        "This employee is already terminated"
      );
    }
    const existing = await q1(
      `SELECT id FROM payroll_settlements WHERE employee_id = $1 AND status <> 'reversed'`,
      [p.employee.id],
      tx
    );
    if (existing) {
      throw new DomainError(
        "EMPLOYEE_ALREADY_SETTLED",
        409,
        undefined,
        "A settlement already exists"
      );
    }
    const accounts = await payrollAccounts(companyId, tx);
    if (body.paymentAccountId) await assertPaymentAccount(companyId, body.paymentAccountId, tx);
    const creditAccountId = body.paymentAccountId ?? requireAccount(accounts, "salariesPayable");
    const lines = settlementLines(p, accounts, creditAccountId);
    const settlementRow = await q1<{ id: string }>(
      `INSERT INTO payroll_settlements (
         company_id, employee_id, termination_date, reason, service_days, unpaid_leave_days,
         gratuity_amount, gratuity_provision_used, notice_pay, leave_encashment, other_additions,
         deductions, net_amount, breakdown, status, payment_account_id, created_by)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17)
       RETURNING id`,
      [
        companyId,
        p.employee.id,
        body.terminationDate,
        body.reason,
        p.result.gratuity.serviceDays,
        p.unpaidLeaveDays,
        fromFils(p.result.gratuityFils),
        fromFils(p.result.provisionUsedFils),
        fromFils(p.result.noticePayFils),
        fromFils(p.result.leaveEncashmentFils),
        fromFils(p.result.otherAdditionsFils),
        fromFils(p.result.deductionsFils),
        fromFils(p.result.netFils),
        JSON.stringify(describeSettlement(p)),
        body.paymentAccountId ? "paid" : "posted",
        body.paymentAccountId ?? null,
        actorId,
      ],
      tx
    );
    let journalEntryId: string | null = null;
    if (lines.length > 0) {
      const posted = await postJournal(
        {
          companyId,
          date: body.terminationDate,
          memo: `End-of-service settlement - ${p.employee.full_name}`,
          source: "payroll_settlement",
          sourceId: settlementRow!.id,
          status: "posted",
          lines,
        },
        { actorId, tx, req, audit: true }
      );
      journalEntryId = posted.entry.id;
      await q(
        `UPDATE payroll_settlements SET journal_entry_id = $2 WHERE id = $1`,
        [settlementRow!.id, journalEntryId],
        tx
      );
    }
    await q(
      `UPDATE employees SET status = 'terminated', termination_date = $3::date, termination_reason = $4
        WHERE id = $1 AND company_id = $2`,
      [p.employee.id, companyId, body.terminationDate, body.reason],
      tx
    );
    await recordAudit({
      userId: actorId,
      companyId,
      action: "payroll.settlement",
      entityType: "employee",
      entityId: p.employee.id,
      after: { settlementId: settlementRow!.id, journalEntryId, net: fromFils(p.result.netFils) },
      req,
      tx,
    });
    if (!body.paymentAccountId && p.result.netFils > 0) {
      // Decree-Law 33/2021 Art. 53 reading: dues are paid within 14 days of the end of service.
      const dueDate = isoDay(addDays(utcDate(body.terminationDate), 14));
      // F8: durable event, written in the settlement transaction.
      await emitDomainEventInTx(tx, "task.due", {
        companyId,
        entityId: settlementRow!.id,
        actorUserId: actorId,
        dueDate,
      });
    }
    return { id: settlementRow!.id, journalEntryId, ...describeSettlement(p) };
  });
}
