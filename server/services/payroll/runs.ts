/**
 * Payroll run state machine and postings (R09-02, R09-12, R09-13, R09-19,
 * R09-22, R09-23).
 *
 *   draft ──calculate──▶ calculated ──approve──▶ approved ──pay──▶ paid
 *                          ▲   (recalculate)        │  ▲            │
 *                          │                 unapprove│  └─unpay─────┘
 *                          └──────calculate────── reversed
 *
 * - The run status is never client-writable; only these functions move it,
 *   each with one conditional UPDATE inside one transaction.
 * - calculate: delete + insert of the non-manual items and the run totals in
 *   one transaction.
 * - approve: the accrual entry (Dr 5020/5025/5028 split by cost centre,
 *   Cr 2030/2032/2034/2036) is posted through server/ledger together with the
 *   run and item updates; items end 'approved' (not 'paid' — R09-12).
 * - pay: Dr 2030 Salaries Payable / Cr the chosen cash or bank account; items
 *   'paid'. This RECORDS a payment the user says was made — WPS submission and
 *   the bank transfer itself happen outside Muhasib.ai.
 * - unapprove: kernel reversal of the accrual entry; unpay: kernel reversal
 *   of the payment entry.
 * - The approver must differ from the preparer (whoever last calculated),
 *   unless the company has a single member and allows single-owner approval.
 */
import { journalMemo } from "@shared/journal-memo";
import type { Request } from "express";
import { DomainError } from "../../errors";
import { assertDifferentActor } from "../../middleware/companyRolePolicy";
import { emitDomainEventInTx } from "../../platform/event-outbox";
import { createLogger } from "../../config/logger";
import { recordAudit } from "../audit.service";
import { convert } from "../fx/rates";
import {
  assertTransition,
  defineMachine,
  postJournal,
  reverseEntry,
  withLedgerTx,
  type LedgerTx,
  type PostJournalLineInput,
} from "../../ledger";
import { fromFils, sumFils } from "../../../shared/money";
import {
  calculatePayrollLine,
  employedDaysInPeriod,
  prorateWages,
  gratuityAccrualTrueUpFils,
  gratuityEntitlement,
  addDays,
  isoDay,
  periodBounds,
  utcDate,
  type PayrollLine,
} from "./calc";
import {
  assertPaymentAccount,
  companyMemberCount,
  loadPayrollSettings,
  payrollAccounts,
  requireAccount,
} from "./context";
import { pensionCountry, pensionRuleFor, type PayrollLegalParams } from "./legal-params";
import { leaveDaysInRange, unpaidLeaveDaysBetween } from "./leave";
import { dayOf, fils, num, q, q1, type Row } from "./sql";
import { uaeToday } from "../../reporting/dates";
import {
  attachClaimsToRun,
  markRunClaimsPaid,
  reimbursementPayableAccount,
  reopenRunClaims,
  runReimbursementFils,
} from "./claims";

const log = createLogger("payroll-runs");

export const PAYROLL_RUN_STATES = [
  "draft",
  "calculated",
  "approved",
  "paid",
  "reversed",
  "cancelled",
] as const;
export type PayrollRunState = (typeof PAYROLL_RUN_STATES)[number];

export const payrollRunMachine = defineMachine<PayrollRunState>({
  states: PAYROLL_RUN_STATES,
  transitions: {
    draft: ["calculated", "cancelled"],
    calculated: ["approved", "cancelled"],
    approved: ["paid", "reversed"],
    paid: ["approved"],
    reversed: ["calculated"],
  },
});

/** States from which (re)calculation is allowed. */
const CALCULABLE = new Set(["draft", "calculated", "reversed"]);

export interface PayrollRunRow extends Row {
  id: string;
  company_id: string;
  period_month: number;
  period_year: number;
  status: PayrollRunState;
  created_by: string | null;
  calculated_by: string | null;
  journal_entry_id: string | null;
  payment_journal_entry_id: string | null;
}

export async function loadRun(
  id: string,
  tx?: LedgerTx,
  lock = false
): Promise<PayrollRunRow | undefined> {
  return q1<PayrollRunRow>(
    `SELECT * FROM payroll_runs WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [id],
    tx
  );
}

function notFound(): DomainError {
  return new DomainError("PAYROLL_RUN_NOT_FOUND", 404, undefined, "Payroll run not found");
}

async function lockRun(tx: LedgerTx, runId: string, companyId: string): Promise<PayrollRunRow> {
  const run = await loadRun(runId, tx, true);
  if (!run || run.company_id !== companyId) throw notFound();
  return run;
}

function periodLabel(run: { period_month: number; period_year: number }): string {
  return `${String(run.period_month).padStart(2, "0")}/${run.period_year}`;
}

// ─── Calculate ──────────────────────────────────────────────────────────────

interface EmployeeRow extends Row {
  id: string;
  full_name: string;
  nationality: string | null;
  join_date: unknown;
  basic_salary: unknown;
  housing_allowance: unknown;
  transport_allowance: unknown;
  other_allowance: unknown;
  opening_gratuity_provision?: unknown;
  opening_gratuity_as_of?: unknown;
  pension_scheme?: string | null;
  salary_currency: string | null;
  cost_center_id: string | null;
  department: string | null;
  termination_date: unknown;
}

interface ItemRow extends Row {
  id: string;
  employee_id: string;
  basic_salary: unknown;
  housing_allowance: unknown;
  transport_allowance: unknown;
  other_allowance: unknown;
  overtime: unknown;
  deductions: unknown;
  pension_employee: unknown;
  pension_employer: unknown;
  gratuity_accrual: unknown;
  net_salary: unknown;
  unpaid_leave_deduction: unknown;
  unpaid_leave_days: unknown;
  paid_leave_days: unknown;
  overtime_hours: unknown;
  overtime_multiplier: unknown;
  cost_center_id: string | null;
  department: string | null;
}

async function convertToBase(
  companyId: string,
  baseCurrency: string,
  currency: string,
  amounts: number[],
  date: string
): Promise<{ converted: number[]; rate: string }> {
  if (currency === baseCurrency) return { converted: amounts, rate: "1" };
  const out: number[] = [];
  let rate = "1";
  for (const a of amounts) {
    // fx.getRate (tenant-scoped) through convert(); 422 NO_EXCHANGE_RATE when missing.
    const r = await convert(companyId, a, currency, baseCurrency, date);
    out.push(r.convertedFils);
    rate = r.rateText;
  }
  return { converted: out, rate };
}

/** Provision accrued so far for each employee from approved/paid runs before this period. */
async function accruedGratuity(
  companyId: string,
  runId: string,
  periodIndex: number,
  tx: LedgerTx
): Promise<Map<string, number>> {
  const rows = await q<{ employee_id: string; total: string }>(
    `SELECT pi.employee_id, COALESCE(SUM(pi.gratuity_accrual), 0)::text AS total
       FROM payroll_items pi JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
      WHERE pr.company_id = $1 AND pr.id <> $2 AND pr.status IN ('approved', 'paid')
        AND (pr.period_year * 12 + pr.period_month) < $3
      GROUP BY pi.employee_id`,
    [companyId, runId, periodIndex],
    tx
  );
  return new Map(rows.map((r) => [r.employee_id, fils(r.total)]));
}

/** An employee whose opening gratuity provision must be entered before the first run (M10). */
export interface OpeningGratuityGap {
  employeeId: string;
  fullName: string;
  joinDate: string;
  asOf: string;
  suggestedOpeningProvision: string;
}

export interface LineContext {
  params: PayrollLegalParams;
  periodEnd: string;
  accrued: number;
  unpaidServiceDays: number;
}

/** Monthly gratuity true-up for a non-GCC employee at period end. */
export function gratuityAccrualFor(
  emp: { nationality: string | null; join_date: unknown },
  basicFils: number,
  ctx: LineContext
): number {
  if (pensionCountry(emp.nationality)) return 0;
  const join = dayOf(emp.join_date);
  if (!join || join > ctx.periodEnd) return 0;
  const ent = gratuityEntitlement(
    {
      joinDate: utcDate(join),
      endDate: utcDate(ctx.periodEnd),
      basicFils,
      unpaidLeaveDays: ctx.unpaidServiceDays,
    },
    ctx.params
  );
  return gratuityAccrualTrueUpFils(ent.totalFils, ctx.accrued);
}

function itemValues(line: PayrollLine) {
  return {
    basic: fromFils(line.basicFils),
    housing: fromFils(line.housingFils),
    transport: fromFils(line.transportFils),
    other: fromFils(line.otherFils),
    overtime: fromFils(line.overtimeFils),
    deductions: fromFils(line.generalDeductionsFils),
    pensionEmployee: fromFils(line.pensionEmployeeFils),
    pensionEmployer: fromFils(line.pensionEmployerFils),
    gratuity: fromFils(line.gratuityAccrualFils),
    net: fromFils(line.netSalaryFils),
    unpaid: fromFils(line.unpaidLeaveDeductionFils),
  };
}

function assertNonNegativeNet(line: PayrollLine, employee: { id: string; full_name?: string }) {
  if (line.netSalaryFils < 0) {
    throw new DomainError(
      "NEGATIVE_NET_SALARY",
      422,
      {
        employeeId: employee.id,
        grossPay: fromFils(line.grossPayFils),
        deductions: fromFils(line.generalDeductionsFils + line.pensionEmployeeFils),
      },
      `Net salary is negative for ${employee.full_name ?? employee.id}: deductions exceed gross pay`
    );
  }
}

export async function recomputeRunTotals(runId: string, tx: LedgerTx): Promise<void> {
  await q(
    `UPDATE payroll_runs pr SET
        total_basic = t.total_basic,
        total_allowances = t.total_allowances,
        total_deductions = t.total_deductions,
        total_net = t.total_net,
        total_pension_employee = t.total_pension_employee,
        total_pension_employer = t.total_pension_employer,
        total_gratuity_accrual = t.total_gratuity_accrual,
        total_unpaid_leave_deduction = t.total_unpaid,
        employee_count = t.employee_count
       FROM (SELECT COALESCE(SUM(basic_salary), 0) AS total_basic,
                    COALESCE(SUM(housing_allowance + transport_allowance + other_allowance + overtime), 0)
                      AS total_allowances,
                    COALESCE(SUM(deductions + pension_employee + unpaid_leave_deduction), 0) AS total_deductions,
                    COALESCE(SUM(net_salary), 0) AS total_net,
                    COALESCE(SUM(pension_employee), 0) AS total_pension_employee,
                    COALESCE(SUM(pension_employer), 0) AS total_pension_employer,
                    COALESCE(SUM(gratuity_accrual), 0) AS total_gratuity_accrual,
                    COALESCE(SUM(unpaid_leave_deduction), 0) AS total_unpaid,
                    COUNT(*)::int AS employee_count
               FROM payroll_items WHERE payroll_run_id = $1) t
      WHERE pr.id = $1`,
    [runId],
    tx
  );
}

export async function calculateRun(
  runId: string,
  companyId: string,
  actorId: string,
  req?: Request
): Promise<PayrollRunRow> {
  const settings = await loadPayrollSettings(companyId);
  const params = settings.params;
  const company = await q1<{ base_currency: string | null }>(
    `SELECT base_currency FROM companies WHERE id = $1`,
    [companyId]
  );
  const baseCurrency = company?.base_currency || "AED";

  return withLedgerTx(async (tx) => {
    const run = await lockRun(tx, runId, companyId);
    if (!CALCULABLE.has(run.status)) {
      throw new DomainError(
        "INVALID_TRANSITION",
        409,
        { from: run.status, to: "calculated" },
        `A ${run.status} payroll run cannot be recalculated`
      );
    }
    const { start, end } = periodBounds(run.period_month, run.period_year);
    const periodStart = isoDay(start);
    const periodEnd = isoDay(end);
    const periodIndex = run.period_year * 12 + run.period_month;

    const preserved = await q<ItemRow>(
      `SELECT * FROM payroll_items WHERE payroll_run_id = $1 AND manually_edited = true`,
      [runId],
      tx
    );
    const preservedIds = new Set(preserved.map((p) => p.employee_id));
    await q(
      `DELETE FROM payroll_items WHERE payroll_run_id = $1 AND manually_edited = false`,
      [runId],
      tx
    );
    // A recalculation re-opens manual items too (they are re-posted on the next approval).
    await q(
      `UPDATE payroll_items SET status = 'pending', journal_entry_id = NULL,
              payment_journal_entry_id = NULL, paid_at = NULL
        WHERE payroll_run_id = $1`,
      [runId],
      tx
    );

    // X4 (J3): an employee terminated inside the period (status 'terminated' once the final
    // settlement posts) is still paid for the days worked in that month — exactly once, here;
    // the settlement covers gratuity, notice and leave only.
    const employees = await q<EmployeeRow & { has_settlement: boolean }>(
      `SELECT e.*, EXISTS (SELECT 1 FROM payroll_settlements s
                            WHERE s.employee_id = e.id AND s.status <> 'reversed') AS has_settlement
         FROM employees e
        WHERE e.company_id = $1 AND e.archived_at IS NULL
          AND (e.status = 'active'
               OR (e.status = 'terminated' AND e.termination_date IS NOT NULL))
          AND (e.join_date IS NULL OR e.join_date::date <= $2::date)
          AND (e.termination_date IS NULL OR e.termination_date >= $3::date)
        ORDER BY e.full_name`,
      [companyId, periodEnd, periodStart],
      tx
    );
    if (employees.length === 0 && preserved.length === 0) {
      throw new DomainError(
        "NO_ACTIVE_EMPLOYEES",
        422,
        undefined,
        "No active employees found for this company"
      );
    }

    const leave = await leaveDaysInRange(companyId, periodStart, periodEnd, tx);
    const accrued = await accruedGratuity(companyId, runId, periodIndex, tx);
    // M10: the gratuity earned before this employee's first run in Muhasib is an opening
    // balance (2036 at go-live), not this month's expense. Until it is entered (0 = confirmed
    // nil) the run is refused with the suggested amount, so only the period movement is expensed.
    const goLiveDay = isoDay(addDays(utcDate(periodStart), -1));
    const openingMissing: OpeningGratuityGap[] = [];

    for (const emp of employees) {
      if (preservedIds.has(emp.id)) continue;
      const currency = (emp.salary_currency || baseCurrency).toUpperCase();
      const raw = [
        fils(emp.basic_salary),
        fils(emp.housing_allowance),
        fils(emp.transport_allowance),
        fils(emp.other_allowance),
      ];
      const { converted, rate } = await convertToBase(
        companyId,
        baseCurrency,
        currency,
        raw,
        periodEnd
      );
      const join = dayOf(emp.join_date);
      const termination = dayOf(emp.termination_date);
      // Partial month (joiner / leaver): fixed pay x employed days / days in the month.
      const { employedDays, monthDays } = employedDaysInPeriod(
        periodStart,
        periodEnd,
        join,
        termination
      );
      const monthlyBasicFils = converted[0];
      const prorated = prorateWages(
        {
          basicFils: converted[0],
          housingFils: converted[1],
          transportFils: converted[2],
          otherFils: converted[3],
        },
        employedDays,
        monthDays
      );
      const { basicFils, housingFils, transportFils, otherFils } = prorated;
      // Gratuity accrues to the last day of service; once a final settlement exists it has
      // already settled the whole entitlement against the provision, so nothing more accrues.
      const serviceEnd = termination && termination < periodEnd ? termination : periodEnd;
      const unpaidServiceDays = join
        ? await unpaidLeaveDaysBetween(companyId, emp.id, join, serviceEnd, tx)
        : 0;
      const empLeave = leave.get(emp.id) ?? { paid: 0, unpaid: 0 };
      if (
        !emp.has_settlement &&
        !accrued.has(emp.id) &&
        (emp.opening_gratuity_provision === null || emp.opening_gratuity_provision === undefined) &&
        join &&
        join <= goLiveDay
      ) {
        const unpaidBefore = await unpaidLeaveDaysBetween(companyId, emp.id, join, goLiveDay, tx);
        const suggestedFils = gratuityAccrualFor(emp, monthlyBasicFils, {
          params,
          periodEnd: goLiveDay,
          unpaidServiceDays: unpaidBefore,
          accrued: 0,
        });
        if (suggestedFils > 0) {
          openingMissing.push({
            employeeId: emp.id,
            fullName: emp.full_name,
            joinDate: join,
            asOf: goLiveDay,
            suggestedOpeningProvision: fromFils(suggestedFils),
          });
          continue;
        }
      }
      const line = calculatePayrollLine(
        {
          basicFils,
          housingFils,
          transportFils,
          otherFils,
          nationality: emp.nationality,
          pensionScheme: emp.pension_scheme ?? null,
          unpaidLeaveDays: empLeave.unpaid,
          gratuityAccrualFils: emp.has_settlement
            ? 0
            : gratuityAccrualFor(emp, monthlyBasicFils, {
                params,
                periodEnd: serviceEnd,
                unpaidServiceDays,
                // X4 (J3): a provision booked before go-live (opening balance) counts as accrued,
                // so the first run accrues only the month, not the whole service history.
                accrued: (accrued.get(emp.id) ?? 0) + fils(emp.opening_gratuity_provision ?? 0),
              }),
        },
        params
      );
      assertNonNegativeNet(line, emp);
      const foreignNet =
        currency === baseCurrency
          ? null
          : fromFils(
              calculatePayrollLine(
                {
                  ...prorateWages(
                    {
                      basicFils: raw[0],
                      housingFils: raw[1],
                      transportFils: raw[2],
                      otherFils: raw[3],
                    },
                    employedDays,
                    monthDays
                  ),
                  nationality: emp.nationality,
                  pensionScheme: emp.pension_scheme ?? null,
                  unpaidLeaveDays: empLeave.unpaid,
                },
                params
              ).netSalaryFils
            );
      const v = itemValues(line);
      await q(
        `INSERT INTO payroll_items (
           payroll_run_id, employee_id, basic_salary, housing_allowance, transport_allowance,
           other_allowance, overtime, deductions, pension_employee, pension_employer,
           gratuity_accrual, net_salary, unpaid_leave_days, paid_leave_days, unpaid_leave_deduction,
           salary_currency, exchange_rate, net_salary_foreign, cost_center_id, department,
           pension_fund, payment_mode, status, manually_edited)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                 $19, $20, $21, 'bank_transfer', 'pending', false)`,
        [
          runId,
          emp.id,
          v.basic,
          v.housing,
          v.transport,
          v.other,
          v.overtime,
          v.deductions,
          v.pensionEmployee,
          v.pensionEmployer,
          v.gratuity,
          v.net,
          empLeave.unpaid,
          empLeave.paid,
          v.unpaid,
          currency,
          rate,
          foreignNet,
          emp.cost_center_id,
          emp.department,
          pensionRuleFor(emp.nationality, emp.pension_scheme)?.fund ?? null,
        ],
        tx
      );
    }

    if (openingMissing.length > 0) {
      throw new DomainError(
        "OPENING_GRATUITY_REQUIRED",
        422,
        { asOf: goLiveDay, employees: openingMissing },
        `Enter the opening gratuity provision at ${goLiveDay} for ${openingMissing.length} ` +
          `employee(s) before their first payroll run, so this run expenses only the month's ` +
          `movement (book the same amount in the 2036 opening balance). Enter 0 only if no provision ` +
          `existed then: the whole catch-up is then expensed in this run.`
      );
    }

    await recomputeRunTotals(runId, tx);
    // S2 (R04-20): approved expense claims queued for payroll are reimbursed on this run.
    await attachClaimsToRun(tx, companyId, runId);
    const updated = await q1<PayrollRunRow>(
      `UPDATE payroll_runs SET status = 'calculated', calculated_by = $2, calculated_at = NOW(),
              sif_file_content = NULL, sif_file_name = NULL, wps_status = 'not_submitted'
        WHERE id = $1 AND status IN ('draft', 'calculated', 'reversed') RETURNING *`,
      [runId, actorId],
      tx
    );
    if (!updated)
      throw new DomainError("PAYROLL_RUN_CHANGED", 409, undefined, "The run changed; retry");
    await recordAudit({
      userId: actorId,
      companyId,
      action: "payroll.calculate",
      entityType: "payroll_run",
      entityId: runId,
      before: { status: run.status },
      after: { status: "calculated", employeeCount: updated.employee_count },
      req,
      tx,
    });
    return updated;
  });
}

// ─── Item edit ──────────────────────────────────────────────────────────────

export interface ItemEdit {
  overtime?: string;
  overtimeHours?: number;
  overtimeMultiplier?: number | null;
  deductions?: string;
  deductionNotes?: string | null;
  unpaidLeaveDays?: number;
  paidLeaveDays?: number;
}

export async function editItem(itemId: string, companyId: string, edit: ItemEdit): Promise<Row> {
  const settings = await loadPayrollSettings(companyId);
  const params = settings.params;
  return withLedgerTx(async (tx) => {
    const item = await q1<
      ItemRow & {
        run_status: string;
        period_month: number;
        period_year: number;
        payroll_run_id: string;
      }
    >(
      `SELECT pi.*, pr.status AS run_status, pr.period_month, pr.period_year
         FROM payroll_items pi JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
        WHERE pi.id = $1 AND pr.company_id = $2
        FOR UPDATE OF pi, pr`,
      [itemId, companyId],
      tx
    );
    if (!item)
      throw new DomainError("PAYROLL_ITEM_NOT_FOUND", 404, undefined, "Payroll item not found");
    if (!CALCULABLE.has(item.run_status) || item.run_status === "reversed") {
      throw new DomainError(
        "PAYROLL_RUN_LOCKED",
        409,
        { status: item.run_status },
        `Items of a ${item.run_status} payroll run cannot be changed`
      );
    }
    const emp = await q1<EmployeeRow>(
      `SELECT * FROM employees WHERE id = $1`,
      [item.employee_id],
      tx
    );
    const overtimeHours = edit.overtimeHours ?? num(item.overtime_hours);
    const multiplier =
      edit.overtimeMultiplier !== undefined
        ? edit.overtimeMultiplier
        : item.overtime_multiplier === null
          ? null
          : num(item.overtime_multiplier);
    // `overtime` is a manual amount; hours x multiplier is added on top.
    const manualOvertime =
      edit.overtime !== undefined
        ? fils(edit.overtime)
        : fils(item.overtime) -
          (num(item.overtime_hours) > 0
            ? overtimeFromHours(
                fils(item.basic_salary),
                num(item.overtime_hours),
                item.overtime_multiplier,
                params
              )
            : 0);
    const unpaidDays = edit.unpaidLeaveDays ?? num(item.unpaid_leave_days);
    const line = calculatePayrollLine(
      {
        basicFils: fils(item.basic_salary),
        housingFils: fils(item.housing_allowance),
        transportFils: fils(item.transport_allowance),
        otherFils: fils(item.other_allowance),
        nationality: emp?.nationality ?? null,
        pensionScheme: (emp?.pension_scheme as string | null | undefined) ?? null,
        overtimeFils: Math.max(0, manualOvertime),
        overtimeHours,
        overtimeMultiplier: multiplier === null ? null : String(multiplier),
        generalDeductionsFils:
          edit.deductions !== undefined ? fils(edit.deductions) : fils(item.deductions),
        unpaidLeaveDays: unpaidDays,
        gratuityAccrualFils: fils(item.gratuity_accrual),
      },
      params
    );
    if (overtimeHours > params.overtime.maxHoursPerPeriod) {
      throw new DomainError(
        "OVERTIME_HOURS_EXCEEDED",
        422,
        { max: params.overtime.maxHoursPerPeriod },
        `Overtime is limited to ${params.overtime.maxHoursPerPeriod} hours per period`
      );
    }
    assertNonNegativeNet(line, { id: item.employee_id, full_name: emp?.full_name });
    const v = itemValues(line);
    const updated = await q1(
      `UPDATE payroll_items SET overtime = $2, deductions = $3,
              deduction_notes = COALESCE($4, deduction_notes),
              pension_employee = $5, pension_employer = $6, net_salary = $7,
              unpaid_leave_days = $8, paid_leave_days = $9, unpaid_leave_deduction = $10,
              overtime_hours = $11, overtime_multiplier = $12, manually_edited = true
        WHERE id = $1 RETURNING *`,
      [
        itemId,
        v.overtime,
        v.deductions,
        edit.deductionNotes === undefined ? null : edit.deductionNotes,
        v.pensionEmployee,
        v.pensionEmployer,
        v.net,
        unpaidDays,
        edit.paidLeaveDays ?? num(item.paid_leave_days),
        v.unpaid,
        overtimeHours,
        multiplier,
      ],
      tx
    );
    if (edit.deductionNotes === null) {
      await q(`UPDATE payroll_items SET deduction_notes = NULL WHERE id = $1`, [itemId], tx);
    }
    await recomputeRunTotals(item.payroll_run_id, tx);
    // Amounts changed: any SIF generated earlier is stale.
    await q(
      `UPDATE payroll_runs SET sif_file_content = NULL, sif_file_name = NULL WHERE id = $1`,
      [item.payroll_run_id],
      tx
    );
    return updated as Row;
  });
}

function overtimeFromHours(
  basicFils: number,
  hours: number,
  multiplier: unknown,
  params: PayrollLegalParams
): number {
  return calculatePayrollLine(
    {
      basicFils,
      housingFils: 0,
      transportFils: 0,
      otherFils: 0,
      nationality: null,
      overtimeHours: hours,
      overtimeMultiplier:
        multiplier === null || multiplier === undefined ? null : String(multiplier),
    },
    params
  ).overtimeFils;
}

// ─── Approve (accrual entry) ────────────────────────────────────────────────

interface CostGroup {
  costCenterId: string | null;
  departments: Set<string>;
  grossFils: number;
  pensionEmployerFils: number;
  gratuityFils: number;
}

/**
 * C2 (NL6): 2032 holds Abu Dhabi Pension Fund contributions as well as GPSSA ones. A chart that
 * still carries the old default name "Pension Payable - GPSSA" is renamed (only that untouched
 * default; a user-chosen name is kept) the first time ADPF contributions are accrued, so the
 * balance sheet and the GL do not present ADPF money as owed to GPSSA.
 */
async function alignPensionPayableName(companyId: string, tx: LedgerTx): Promise<void> {
  await q(
    `UPDATE accounts
        SET name_en = 'Pension Payable - GPSSA / ADPF',
            name_ar = 'المعاشات المستحقة - الهيئة العامة للمعاشات / صندوق أبوظبي للمعاشات'
      WHERE company_id = $1 AND code = '2032' AND name_en = 'Pension Payable - GPSSA'`,
    [companyId],
    tx
  );
}

/** Build the balanced accrual lines (split by cost centre — R09-22). Exported for tests. */
export function buildAccrualLines(
  items: ItemRow[],
  accounts: Partial<Record<import("./context").PayrollAccountKey, string>>,
  label: string
): PostJournalLineInput[] {
  const groups = new Map<string, CostGroup>();
  let net = 0;
  let pensionEe = 0;
  let pensionEr = 0;
  let deductions = 0;
  let gratuity = 0;
  for (const it of items) {
    const key = it.cost_center_id ?? "";
    const g =
      groups.get(key) ??
      ({
        costCenterId: it.cost_center_id,
        departments: new Set(),
        grossFils: 0,
        pensionEmployerFils: 0,
        gratuityFils: 0,
      } as CostGroup);
    if (it.department) g.departments.add(it.department);
    const gross =
      fils(it.basic_salary) +
      fils(it.housing_allowance) +
      fils(it.transport_allowance) +
      fils(it.other_allowance) +
      fils(it.overtime) -
      fils(it.unpaid_leave_deduction);
    g.grossFils += gross;
    g.pensionEmployerFils += fils(it.pension_employer);
    g.gratuityFils += fils(it.gratuity_accrual);
    groups.set(key, g);
    net += fils(it.net_salary);
    pensionEe += fils(it.pension_employee);
    pensionEr += fils(it.pension_employer);
    deductions += fils(it.deductions);
    gratuity += fils(it.gratuity_accrual);
  }
  const lines: PostJournalLineInput[] = [];
  const sorted = [...groups.values()].sort((a, b) =>
    (a.costCenterId ?? "").localeCompare(b.costCenterId ?? "")
  );
  for (const g of sorted) {
    const dept = g.departments.size ? ` (${[...g.departments].sort().join(", ")})` : "";
    if (g.grossFils > 0) {
      lines.push({
        accountId: requireAccount(accounts, "salariesExpense"),
        debitFils: g.grossFils,
        costCenterId: g.costCenterId,
        description: `Salaries & wages - payroll ${label}${dept}`,
      });
    }
    if (g.pensionEmployerFils > 0) {
      lines.push({
        accountId: requireAccount(accounts, "pensionExpense"),
        debitFils: g.pensionEmployerFils,
        costCenterId: g.costCenterId,
        description: `Employer pension contribution (GPSSA / ADPF) - payroll ${label}${dept}`,
      });
    }
    if (g.gratuityFils > 0) {
      lines.push({
        accountId: requireAccount(accounts, "gratuityExpense"),
        debitFils: g.gratuityFils,
        costCenterId: g.costCenterId,
        description: `End-of-service gratuity accrual - payroll ${label}${dept}`,
      });
    }
  }
  if (net > 0) {
    lines.push({
      accountId: requireAccount(accounts, "salariesPayable"),
      controlLeg: "payroll",
      creditFils: net,
      description: `Net salaries payable - payroll ${label}`,
    });
  }
  if (pensionEe + pensionEr > 0) {
    lines.push({
      accountId: requireAccount(accounts, "pensionPayable"),
      controlLeg: "payroll",
      creditFils: pensionEe + pensionEr,
      description: `Pension payable (GPSSA / ADPF, employee + employer) - payroll ${label}`,
    });
  }
  if (deductions > 0) {
    lines.push({
      accountId: requireAccount(accounts, "deductionsPayable"),
      controlLeg: "payroll",
      creditFils: deductions,
      description: `Payroll deductions payable - payroll ${label}`,
    });
  }
  if (gratuity > 0) {
    lines.push({
      accountId: requireAccount(accounts, "gratuityProvision"),
      controlLeg: "payroll",
      creditFils: gratuity,
      description: `End-of-service gratuity provision - payroll ${label}`,
    });
  }
  return lines;
}

/**
 * L6: the accrual date of a payroll run approved on `today`: period end once the month is over,
 * today while it is running, and 422 PAYROLL_PERIOD_NOT_STARTED before it begins.
 */
export function payrollAccrualDate(periodStart: string, periodEnd: string, today: string): string {
  if (today < periodStart) {
    throw new DomainError(
      "PAYROLL_PERIOD_NOT_STARTED",
      422,
      { periodStart, today },
      `This payroll month starts on ${periodStart}; approve the run once the month has started`
    );
  }
  return today < periodEnd ? today : periodEnd;
}

export async function approveRun(
  runId: string,
  companyId: string,
  actorId: string,
  req?: Request
): Promise<PayrollRunRow> {
  const settings = await loadPayrollSettings(companyId);
  return withLedgerTx(async (tx) => {
    const run = await lockRun(tx, runId, companyId);
    if (run.status === "approved" || run.status === "paid") {
      throw new DomainError(
        "PAYROLL_ALREADY_APPROVED",
        409,
        { status: run.status },
        "Payroll run is already approved"
      );
    }
    if (run.status === "draft") {
      throw new DomainError(
        "INVALID_TRANSITION",
        409,
        { from: "draft", to: "approved" },
        "Calculate the payroll run before approving it"
      );
    }
    assertTransition(payrollRunMachine, run.status, "approved");
    const preparer = run.calculated_by ?? run.created_by;
    const single =
      settings.allowSingleOwnerApproval && (await companyMemberCount(companyId, tx)) <= 1;
    assertDifferentActor(preparer, actorId, { allowSingleOwner: single });

    const items = await q<ItemRow>(
      `SELECT * FROM payroll_items WHERE payroll_run_id = $1`,
      [runId],
      tx
    );
    if (items.length === 0) {
      throw new DomainError(
        "PAYROLL_RUN_EMPTY",
        422,
        undefined,
        "Cannot approve a payroll run with no items"
      );
    }
    const accounts = await payrollAccounts(companyId, tx);
    if (items.some((it) => String(it.pension_fund ?? "") === "adpf")) {
      await alignPensionPayableName(companyId, tx);
    }
    const label = periodLabel(run);
    const lines = buildAccrualLines(items, accounts, label);
    const { start, end } = periodBounds(run.period_month, run.period_year);
    // L6: no future-dated payroll journals (final settlements refuse them too). A run approved
    // inside its month accrues today (the same month); a later approval accrues at period end;
    // a run cannot be approved before its month starts.
    const accrualDate = payrollAccrualDate(isoDay(start), isoDay(end), uaeToday());
    const posted = await postJournal(
      {
        companyId,
        date: accrualDate,
        ...journalMemo("payrollRun", { label, n: items.length }),
        source: "payroll",
        sourceId: runId,
        status: "posted",
        lines,
      },
      { actorId, tx, req, audit: true }
    );
    const updated = await q1<PayrollRunRow>(
      `UPDATE payroll_runs SET status = 'approved', approved_by = $2, approved_at = NOW(),
              journal_entry_id = $3
        WHERE id = $1 AND status = $4 RETURNING *`,
      [runId, actorId, posted.entry.id, run.status],
      tx
    );
    if (!updated)
      throw new DomainError("PAYROLL_RUN_CHANGED", 409, undefined, "The run changed; retry");
    await q(
      `UPDATE payroll_items SET status = 'approved', journal_entry_id = $2 WHERE payroll_run_id = $1`,
      [runId, posted.entry.id],
      tx
    );
    await recordAudit({
      userId: actorId,
      companyId,
      action: "payroll.approve",
      entityType: "payroll_run",
      entityId: runId,
      before: { status: run.status },
      after: {
        status: "approved",
        journalEntryId: posted.entry.id,
        entryNumber: posted.entry.entryNumber,
      },
      req,
      tx,
    });
    // F8: durable event, written in the approval transaction.
    await emitDomainEventInTx(tx, "payroll.approved", {
      companyId,
      entityId: runId,
      actorUserId: actorId,
      periodMonth: run.period_month,
      periodYear: run.period_year,
    });
    log.info({ runId, journalEntryId: posted.entry.id }, "Payroll run approved");
    return updated;
  });
}

// ─── Pay (payment entry) ────────────────────────────────────────────────────

export async function payRun(
  runId: string,
  companyId: string,
  actorId: string,
  body: { paymentAccountId: string; paymentDate: string },
  req?: Request
): Promise<PayrollRunRow> {
  return withLedgerTx(async (tx) => {
    const run = await lockRun(tx, runId, companyId);
    if (run.status === "paid") {
      throw new DomainError("PAYROLL_ALREADY_PAID", 409, undefined, "Payroll run is already paid");
    }
    assertTransition(payrollRunMachine, run.status, "paid");
    await assertPaymentAccount(companyId, body.paymentAccountId, tx);
    const items = await q<ItemRow>(
      `SELECT net_salary FROM payroll_items WHERE payroll_run_id = $1`,
      [runId],
      tx
    );
    const netFils = sumFils(items.map((i) => fils(i.net_salary)));
    const accounts = await payrollAccounts(companyId, tx);
    const label = periodLabel(run);
    // S2 (R04-20): expense claims reimbursed on this run clear 2045 in the payment journal.
    const reimbursementFils = await runReimbursementFils(tx, runId);
    let paymentEntryId: string | null = null;
    if (netFils + reimbursementFils > 0) {
      const lines: PostJournalLineInput[] = [];
      if (netFils > 0) {
        lines.push({
          accountId: requireAccount(accounts, "salariesPayable"),
          controlLeg: "payroll",
          debitFils: netFils,
          description: `Net salaries paid - payroll ${label}`,
        });
      }
      if (reimbursementFils > 0) {
        lines.push({
          accountId: await reimbursementPayableAccount(tx, companyId),
          debitFils: reimbursementFils,
          description: `Expense claim reimbursements - payroll ${label}`,
        });
      }
      lines.push({
        accountId: body.paymentAccountId,
        creditFils: netFils + reimbursementFils,
        description: `Salary payment - payroll ${label}`,
      });
      const posted = await postJournal(
        {
          companyId,
          date: body.paymentDate,
          ...journalMemo("salaryPayment", { label }),
          source: "payroll_payment",
          sourceId: runId,
          status: "posted",
          lines,
        },
        { actorId, tx, req, audit: true }
      );
      paymentEntryId = posted.entry.id;
    }
    const reimbursedClaims =
      reimbursementFils > 0
        ? await markRunClaimsPaid(tx, {
            companyId,
            runId,
            actorId,
            paymentDate: body.paymentDate,
            paymentAccountId: body.paymentAccountId,
            label,
          })
        : [];
    const updated = await q1<PayrollRunRow>(
      `UPDATE payroll_runs SET status = 'paid', paid_by = $2, paid_at = NOW(), payment_date = $3::date,
              payment_account_id = $4, payment_journal_entry_id = $5
        WHERE id = $1 AND status = 'approved' RETURNING *`,
      [runId, actorId, body.paymentDate, body.paymentAccountId, paymentEntryId],
      tx
    );
    if (!updated)
      throw new DomainError("PAYROLL_RUN_CHANGED", 409, undefined, "The run changed; retry");
    await q(
      `UPDATE payroll_items SET status = 'paid', paid_at = NOW(), payment_journal_entry_id = $2
        WHERE payroll_run_id = $1`,
      [runId, paymentEntryId],
      tx
    );
    await recordAudit({
      userId: actorId,
      companyId,
      action: "payroll.pay",
      entityType: "payroll_run",
      entityId: runId,
      before: { status: run.status },
      after: {
        status: "paid",
        paymentJournalEntryId: paymentEntryId,
        netPaid: fromFils(netFils),
        expenseReimbursements: fromFils(reimbursementFils),
        reimbursedClaims,
      },
      req,
      tx,
    });
    // F8: durable event, written in the payment transaction.
    await emitDomainEventInTx(tx, "payroll.paid", {
      companyId,
      entityId: runId,
      actorUserId: actorId,
      periodMonth: run.period_month,
      periodYear: run.period_year,
    });
    return updated;
  });
}

// ─── Reversals ──────────────────────────────────────────────────────────────

/** paid -> approved: reverse the payment entry through the kernel. */
export async function unpayRun(
  runId: string,
  companyId: string,
  actorId: string,
  reason: string,
  req?: Request
): Promise<PayrollRunRow> {
  return withLedgerTx(async (tx) => {
    const run = await lockRun(tx, runId, companyId);
    assertTransition(payrollRunMachine, run.status, "approved");
    if (run.payment_journal_entry_id) {
      await reverseEntry(
        run.payment_journal_entry_id,
        { reason, source: "payroll_payment", sourceId: runId },
        { actorId, tx, req, companyId }
      );
    }
    const updated = await q1<PayrollRunRow>(
      `UPDATE payroll_runs SET status = 'approved', paid_by = NULL, paid_at = NULL, payment_date = NULL,
              payment_account_id = NULL, payment_journal_entry_id = NULL
        WHERE id = $1 AND status = 'paid' RETURNING *`,
      [runId],
      tx
    );
    if (!updated)
      throw new DomainError("PAYROLL_RUN_CHANGED", 409, undefined, "The run changed; retry");
    await q(
      `UPDATE payroll_items SET status = 'approved', paid_at = NULL, payment_journal_entry_id = NULL
        WHERE payroll_run_id = $1`,
      [runId],
      tx
    );
    // The reversed payment journal restored 2045: the reimbursed claims are owed again.
    await reopenRunClaims(tx, companyId, runId);
    await recordAudit({
      userId: actorId,
      companyId,
      action: "payroll.unpay",
      entityType: "payroll_run",
      entityId: runId,
      before: { status: "paid" },
      after: { status: "approved", reason },
      req,
      tx,
    });
    return updated;
  });
}

/** approved -> reversed: reverse the accrual entry; the run can then be recalculated. */
export async function unapproveRun(
  runId: string,
  companyId: string,
  actorId: string,
  reason: string,
  req?: Request
): Promise<PayrollRunRow> {
  return withLedgerTx(async (tx) => {
    const run = await lockRun(tx, runId, companyId);
    if (run.status === "paid") {
      throw new DomainError(
        "PAYROLL_RUN_PAID",
        409,
        undefined,
        "Reverse the salary payment before unapproving the run"
      );
    }
    assertTransition(payrollRunMachine, run.status, "reversed");
    if (run.journal_entry_id) {
      await reverseEntry(
        run.journal_entry_id,
        { reason, source: "payroll", sourceId: runId },
        { actorId, tx, req, companyId }
      );
    }
    const updated = await q1<PayrollRunRow>(
      `UPDATE payroll_runs SET status = 'reversed', reversed_by = $2, reversed_at = NOW(),
              reversal_reason = $3, journal_entry_id = NULL, sif_file_content = NULL
        WHERE id = $1 AND status = 'approved' RETURNING *`,
      [runId, actorId, reason],
      tx
    );
    if (!updated)
      throw new DomainError("PAYROLL_RUN_CHANGED", 409, undefined, "The run changed; retry");
    await q(
      `UPDATE payroll_items SET status = 'reversed', journal_entry_id = NULL WHERE payroll_run_id = $1`,
      [runId],
      tx
    );
    await recordAudit({
      userId: actorId,
      companyId,
      action: "payroll.unapprove",
      entityType: "payroll_run",
      entityId: runId,
      before: { status: "approved", journalEntryId: run.journal_entry_id },
      after: { status: "reversed", reason },
      req,
      tx,
    });
    return updated;
  });
}
