/**
 * WPS orchestration for a payroll run (R09-03, R09-04, R09-18): build the SIF
 * from the run, pre-validate identifiers, and track the status the user
 * reports back from the bank / exchange house. Submission is EXTERNAL — the
 * status is entered manually and never inferred.
 */
import { DomainError } from "../../errors";
import { buildSif, prevalidateSif, type SifInput } from "../wps-sif.service";
import { fils, num, q, q1 } from "./sql";

const SIF_RUN_STATES = new Set(["calculated", "approved", "paid"]);

async function sifInput(companyId: string, runId: string): Promise<SifInput> {
  const run = await q1<{ period_month: number; period_year: number; status: string }>(
    `SELECT period_month, period_year, status FROM payroll_runs WHERE id = $1 AND company_id = $2`,
    [runId, companyId]
  );
  if (!run) throw new DomainError("PAYROLL_RUN_NOT_FOUND", 404, undefined, "Payroll run not found");
  if (!SIF_RUN_STATES.has(run.status)) {
    throw new DomainError(
      "PAYROLL_RUN_NOT_CALCULATED",
      409,
      { status: run.status },
      "Calculate the payroll run before generating the SIF"
    );
  }
  const company = await q1<{
    name: string;
    mohre_establishment_id: string | null;
    wps_employer_routing_code: string | null;
  }>(
    `SELECT name, mohre_establishment_id, wps_employer_routing_code FROM companies WHERE id = $1`,
    [companyId]
  );
  const items = await q<Record<string, unknown>>(
    `SELECT pi.employee_id, pi.net_salary, pi.overtime, pi.unpaid_leave_days, pi.paid_leave_days,
            pi.expense_reimbursement,
            e.full_name, e.mol_person_id, e.labor_card_number, e.routing_code, e.iban
       FROM payroll_items pi JOIN employees e ON e.id = pi.employee_id
      WHERE pi.payroll_run_id = $1 ORDER BY e.full_name`,
    [runId]
  );
  return {
    employer: {
      name: company?.name ?? "",
      molEstablishmentId: company?.mohre_establishment_id,
      routingCode: company?.wps_employer_routing_code,
      reference: `${String(run.period_month).padStart(2, "0")}${run.period_year}`,
    },
    periodMonth: run.period_month,
    periodYear: run.period_year,
    createdAt: new Date(),
    lines: items.map((it) => {
      const labour = String(it.labor_card_number ?? "").replace(/\D/g, "");
      return {
        employeeId: String(it.employee_id),
        employeeName: String(it.full_name),
        // The MOHRE person id; a 14-digit labour card number field is accepted as a fallback.
        molPersonId: (it.mol_person_id as string | null) || (labour.length === 14 ? labour : null),
        routingCode: it.routing_code as string | null,
        iban: it.iban as string | null,
        // S2 (R04-20): expense claims reimbursed on the run are paid with the salary (variable).
        netFils: fils(it.net_salary) + fils(it.expense_reimbursement),
        variableFils: fils(it.overtime) + fils(it.expense_reimbursement),
        // X4 (J3): the EDR "days on leave" explains a fixed salary below the contract, so only
        // unpaid leave counts; paid annual leave is salary paid in full
        // (docs/payroll-legal-parameters.md, WPS section: confirm with the WPS agent).
        leaveDays: sifLeaveDays(it.unpaid_leave_days, it.paid_leave_days),
      };
    }),
  };
}

export async function sifPrevalidation(companyId: string, runId: string) {
  const input = await sifInput(companyId, runId);
  const issues = prevalidateSif(input);
  return { ready: issues.length === 0, issues };
}

export async function downloadRunSif(companyId: string, runId: string) {
  const saved = await q1<{ content: string | null; name: string | null }>(
    `SELECT sif_file_content AS content, sif_file_name AS name FROM payroll_runs
      WHERE id = $1 AND company_id = $2`,
    [runId, companyId]
  );
  if (saved?.content && saved.name) return { content: saved.content, fileName: saved.name };
  return buildSif(await sifInput(companyId, runId));
}

export async function generateRunSif(companyId: string, runId: string): Promise<void> {
  const file = buildSif(await sifInput(companyId, runId));
  await q(
    `UPDATE payroll_runs SET sif_file_content = $2, sif_file_name = $3, sif_generated_at = NOW()
      WHERE id = $1 AND company_id = $4`,
    [runId, file.content, file.fileName, companyId]
  );
}

export async function setWpsStatus(
  companyId: string,
  runId: string,
  actorId: string,
  status: "submitted" | "accepted" | "rejected",
  notes: string | undefined
) {
  const run = await q1<{ sif_file_content: string | null; wps_status: string }>(
    `SELECT sif_file_content, wps_status FROM payroll_runs WHERE id = $1 AND company_id = $2`,
    [runId, companyId]
  );
  if (!run) throw new DomainError("PAYROLL_RUN_NOT_FOUND", 404, undefined, "Payroll run not found");
  if (!run.sif_file_content) {
    throw new DomainError(
      "SIF_NOT_GENERATED",
      409,
      undefined,
      "Generate the SIF before recording its WPS status"
    );
  }
  const allowed: Record<string, string[]> = {
    not_submitted: ["submitted"],
    submitted: ["accepted", "rejected"],
    rejected: ["submitted"],
    accepted: [],
  };
  if (!(allowed[run.wps_status] ?? []).includes(status)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      409,
      { from: run.wps_status, to: status },
      `WPS status cannot move from ${run.wps_status} to ${status}`
    );
  }
  const updated = await q1(
    `UPDATE payroll_runs SET wps_status = $3, wps_status_notes = $4, wps_status_updated_at = NOW(),
            wps_status_updated_by = $5
      WHERE id = $1 AND company_id = $2 AND wps_status = $6 RETURNING *`,
    [runId, companyId, status, notes ?? null, actorId, run.wps_status]
  );
  if (!updated)
    throw new DomainError("PAYROLL_RUN_CHANGED", 409, undefined, "The run changed; retry");
  await q(
    `INSERT INTO payroll_wps_events (company_id, payroll_run_id, status, notes, actor_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [companyId, runId, status, notes ?? null, actorId]
  );
  return updated;
}

export async function wpsEvents(companyId: string, runId: string) {
  return q(
    `SELECT status, notes, actor_id, created_at FROM payroll_wps_events
      WHERE company_id = $1 AND payroll_run_id = $2 ORDER BY created_at`,
    [companyId, runId]
  );
}

/** EDR leave days for one payroll item: unpaid leave only (paid leave is fully paid salary). */
export function sifLeaveDays(unpaidLeaveDays: unknown, _paidLeaveDays?: unknown): number {
  return Math.max(0, num(unpaidLeaveDays));
}
