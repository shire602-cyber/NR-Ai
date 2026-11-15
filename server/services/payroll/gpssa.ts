/**
 * GPSSA monthly contribution export (R09-20) and employee document expiry
 * alerts (R09-21).
 *
 * EXTERNAL BOUNDARY: the CSV lists each UAE/GCC national's contribution
 * salary and the employee/employer shares from an approved run, for upload to
 * or reconciliation with the GPSSA employer portal. The portal's own upload
 * template must be confirmed with GPSSA; nothing here submits contributions.
 */
import { DomainError } from "../../errors";
import { emitDomainEvent } from "../../platform/domain-events";
import { createLogger } from "../../config/logger";
import { fromFils } from "../../../shared/money";
import { pensionContribution, utcDate, addDays, isoDay } from "./calc";
import { loadPayrollSettings } from "./context";
import { pensionCountry } from "./legal-params";
import { dayOf, fils, q, q1 } from "./sql";

const log = createLogger("payroll-gpssa");

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function gpssaContributionCsv(
  companyId: string,
  runId: string
): Promise<{ fileName: string; content: string; rows: number; totalFils: number }> {
  const run = await q1<{ period_month: number; period_year: number; status: string }>(
    `SELECT period_month, period_year, status FROM payroll_runs WHERE id = $1 AND company_id = $2`,
    [runId, companyId]
  );
  if (!run) throw new DomainError("PAYROLL_RUN_NOT_FOUND", 404, undefined, "Payroll run not found");
  if (!["approved", "paid"].includes(run.status)) {
    throw new DomainError(
      "PAYROLL_RUN_NOT_APPROVED",
      409,
      { status: run.status },
      "Approve the run first"
    );
  }
  const settings = await loadPayrollSettings(companyId);
  const items = await q<Record<string, unknown>>(
    `SELECT pi.*, e.full_name, e.nationality, e.emirates_id, e.employee_number
       FROM payroll_items pi JOIN employees e ON e.id = pi.employee_id
      WHERE pi.payroll_run_id = $1 ORDER BY e.full_name`,
    [runId]
  );
  const header = [
    "Employee Number",
    "Employee Name",
    "Emirates ID",
    "Nationality",
    "Contribution Month",
    "Contribution Salary",
    "Employee Contribution",
    "Employer Contribution",
    "Total Contribution",
    "Rates Confirmed By Adviser",
  ];
  const lines = [header.map(csvCell).join(",")];
  let totalFils = 0;
  let rows = 0;
  const month = `${String(run.period_month).padStart(2, "0")}/${run.period_year}`;
  for (const it of items) {
    if (!pensionCountry(it.nationality as string | null)) continue;
    const p = pensionContribution(
      {
        basicFils: fils(it.basic_salary),
        housingFils: fils(it.housing_allowance),
        transportFils: fils(it.transport_allowance),
        otherFils: fils(it.other_allowance),
      },
      it.nationality as string,
      settings.params
    );
    const ee = fils(it.pension_employee);
    const er = fils(it.pension_employer);
    totalFils += ee + er;
    rows++;
    lines.push(
      [
        it.employee_number,
        it.full_name,
        it.emirates_id,
        p.country,
        month,
        fromFils(p.baseFils),
        fromFils(ee),
        fromFils(er),
        fromFils(ee + er),
        settings.adviserConfirmed && p.ruleConfirmed ? "yes" : "no",
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return {
    fileName: `GPSSA_contributions_${run.period_year}_${String(run.period_month).padStart(2, "0")}.csv`,
    content: lines.join("\r\n") + "\r\n",
    rows,
    totalFils,
  };
}

// ─── Expiry alerts ──────────────────────────────────────────────────────────

export const EXPIRY_DOCUMENTS = [
  { kind: "visa", column: "visa_expiry" },
  { kind: "labour_card", column: "labor_card_expiry" },
  { kind: "passport", column: "passport_expiry" },
  { kind: "emirates_id", column: "emirates_id_expiry" },
] as const;

export interface ExpiryRow {
  employeeId: string;
  employeeName: string;
  document: (typeof EXPIRY_DOCUMENTS)[number]["kind"];
  expiryDate: string;
  daysLeft: number;
}

export async function upcomingExpiries(
  companyId: string | null,
  withinDays: number,
  today = isoDay(new Date())
): Promise<Array<ExpiryRow & { companyId: string }>> {
  const horizon = isoDay(addDays(utcDate(today), withinDays));
  const rows = await q<Record<string, unknown>>(
    `SELECT id, company_id, full_name, visa_expiry, labor_card_expiry, passport_expiry, emirates_id_expiry
       FROM employees
      WHERE status <> 'terminated' AND archived_at IS NULL
        ${companyId ? "AND company_id = $2" : ""}
        AND (visa_expiry <= $1::date OR labor_card_expiry <= $1::date
             OR passport_expiry <= $1::date OR emirates_id_expiry <= $1::date)`,
    companyId ? [horizon, companyId] : [horizon]
  );
  const out: Array<ExpiryRow & { companyId: string }> = [];
  for (const r of rows) {
    for (const d of EXPIRY_DOCUMENTS) {
      const exp = dayOf(r[d.column]);
      if (!exp || exp > horizon) continue;
      out.push({
        companyId: String(r.company_id),
        employeeId: String(r.id),
        employeeName: String(r.full_name),
        document: d.kind,
        expiryDate: exp,
        daysLeft: Math.round((utcDate(exp).getTime() - utcDate(today).getTime()) / 86_400_000),
      });
    }
  }
  return out.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
}

/**
 * Emit compliance.deadline_due + task.due once per (employee, document,
 * expiry date) for documents expiring within `withinDays`.
 */
export async function scanExpiryAlerts(companyId: string | null, withinDays = 30): Promise<number> {
  const due = await upcomingExpiries(companyId, withinDays);
  let emitted = 0;
  for (const e of due) {
    const inserted = await q1<{ id: string }>(
      `INSERT INTO payroll_expiry_alerts (company_id, employee_id, document_kind, expiry_date)
       VALUES ($1, $2, $3, $4::date)
       ON CONFLICT (employee_id, document_kind, expiry_date) DO NOTHING RETURNING id`,
      [e.companyId, e.employeeId, e.document, e.expiryDate]
    );
    if (!inserted) continue;
    emitted++;
    emitDomainEvent("compliance.deadline_due", {
      companyId: e.companyId,
      entityId: e.employeeId,
      obligation: `employee.${e.document}_expiry`,
      dueDate: e.expiryDate,
    });
    emitDomainEvent("task.due", {
      companyId: e.companyId,
      entityId: e.employeeId,
      dueDate: e.expiryDate,
    });
  }
  if (emitted) log.info({ emitted, companyId }, "Employee document expiry alerts emitted");
  return emitted;
}
