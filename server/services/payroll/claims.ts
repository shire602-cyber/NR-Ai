/**
 * Expense claims reimbursed through payroll (S2, R04-20).
 *
 * An approved expense claim (Dr expense / Cr 2045 Employee Reimbursements Payable on approval)
 * can be queued for the employee's next payroll run instead of being paid on its own:
 *
 *   calculate  queued claims of the run's employees attach to the run; each payroll item carries
 *              `expense_reimbursement` (shown on the payslip and added to the WPS amount).
 *              The salary accrual is unchanged: the claim was already expensed on approval.
 *   pay        the salary payment journal also clears 2045:
 *                Dr 2030 net salaries   Dr 2045 reimbursements   Cr bank (net + reimbursements)
 *              and the attached claims become `paid`.
 *   unpay      the payment journal is reversed (2045 is owed again); claims return to `approved`.
 *
 * A claim attached to a live run (calculated / approved / paid) cannot be marked paid manually;
 * a claim whose run was reversed or deleted is free for the next run.
 */
import { DomainError } from "../../errors";
import { ACCOUNT_CODES } from "../../constants";
import { fromFils, sumFils } from "../../../shared/money";
import type { LedgerTx } from "../../ledger";
import { fils, q, q1 } from "./sql";

/** Payroll-run statuses that hold their attached claims. */
export const CLAIM_HOLDING_RUN_STATES = ["calculated", "approved", "paid"] as const;

const FREE_CLAIM_SQL = `(ec.payroll_run_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM payroll_runs pr WHERE pr.id = ec.payroll_run_id
       AND pr.status IN ('calculated', 'approved', 'paid')))`;

/** 2045 still owed (fils) for each claim, from its posted approval journal. */
const OWED_SQL = `COALESCE((
    SELECT SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100))
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN accounts a ON a.id = jl.account_id
     WHERE je.company_id = ec.company_id AND je.source = 'expense_claim' AND je.source_id = ec.id
       AND je.status = 'posted' AND je.reversed_by_entry_id IS NULL AND a.code = '${ACCOUNT_CODES.EMP_REIMBURSEMENT_PAYABLE}'
  ), 0)::bigint`;

export interface QueueClaimInput {
  companyId: string;
  claimId: string;
  submittedBy: string;
  enabled: boolean;
  employeeId?: string | null;
}

/**
 * Queue (or unqueue) an approved claim for payroll reimbursement. The employee defaults to the
 * active employee whose email matches the claim submitter's.
 */
export async function setClaimPayrollReimbursement(
  tx: LedgerTx,
  input: QueueClaimInput
): Promise<Record<string, unknown>> {
  const claim = await q1<{
    id: string;
    status: string;
    payroll_run_id: string | null;
    run_status: string | null;
  }>(
    `SELECT ec.id, ec.status, ec.payroll_run_id, pr.status AS run_status
       FROM expense_claims ec LEFT JOIN payroll_runs pr ON pr.id = ec.payroll_run_id
      WHERE ec.id = $1 AND ec.company_id = $2 FOR UPDATE OF ec`,
    [input.claimId, input.companyId],
    tx
  );
  if (!claim) throw new DomainError("EXPENSE_CLAIM_NOT_FOUND", 404);
  if (claim.status !== "approved") {
    throw new DomainError(
      "CLAIM_NOT_APPROVED",
      409,
      { status: claim.status },
      "Only approved, unpaid claims can be reimbursed through payroll"
    );
  }
  if (
    claim.payroll_run_id &&
    (CLAIM_HOLDING_RUN_STATES as readonly string[]).includes(String(claim.run_status))
  ) {
    throw new DomainError(
      "CLAIM_IN_PAYROLL",
      409,
      { payrollRunId: claim.payroll_run_id },
      "The claim is already on a payroll run; recalculate or reverse that run first"
    );
  }
  if (!input.enabled) {
    const rows = await q(
      `UPDATE expense_claims SET reimburse_via_payroll = false, payroll_run_id = NULL
        WHERE id = $1 RETURNING *`,
      [input.claimId],
      tx
    );
    return rows[0];
  }
  let employeeId = input.employeeId ?? null;
  if (employeeId) {
    const emp = await q1(
      `SELECT id FROM employees WHERE id = $1 AND company_id = $2 AND archived_at IS NULL`,
      [employeeId, input.companyId],
      tx
    );
    if (!emp) throw new DomainError("EMPLOYEE_NOT_FOUND", 404);
  } else {
    const match = await q<{ id: string }>(
      `SELECT e.id FROM employees e JOIN users u ON lower(u.email) = lower(e.email)
        WHERE u.id = $1 AND e.company_id = $2 AND e.archived_at IS NULL AND e.status = 'active'`,
      [input.submittedBy, input.companyId],
      tx
    );
    if (match.length !== 1) {
      throw new DomainError(
        "CLAIM_EMPLOYEE_REQUIRED",
        422,
        { matches: match.length },
        "Choose the employee whose payroll reimburses this claim"
      );
    }
    employeeId = match[0].id;
  }
  const rows = await q(
    `UPDATE expense_claims SET reimburse_via_payroll = true, employee_id = $2, payroll_run_id = NULL
      WHERE id = $1 RETURNING *`,
    [input.claimId, employeeId],
    tx
  );
  return rows[0];
}

/** 409 when the claim sits on a live payroll run (manual mark-paid would pay it twice). */
export async function assertClaimNotOnPayroll(
  tx: LedgerTx,
  companyId: string,
  claimId: string
): Promise<void> {
  const row = await q1<{ payroll_run_id: string | null; run_status: string | null }>(
    `SELECT ec.payroll_run_id, pr.status AS run_status
       FROM expense_claims ec LEFT JOIN payroll_runs pr ON pr.id = ec.payroll_run_id
      WHERE ec.id = $1 AND ec.company_id = $2 FOR UPDATE OF ec`,
    [claimId, companyId],
    tx
  );
  if (
    row?.payroll_run_id &&
    (CLAIM_HOLDING_RUN_STATES as readonly string[]).includes(String(row.run_status))
  ) {
    throw new DomainError(
      "CLAIM_IN_PAYROLL",
      409,
      { payrollRunId: row.payroll_run_id },
      "This claim is reimbursed on a payroll run; it is paid with the salary payment"
    );
  }
}

/**
 * Attach the queued claims of the run's employees to the run (calculate) and write each item's
 * `expense_reimbursement`. Claims attached on an earlier calculation of the same run are
 * re-evaluated. Returns the total reimbursement (fils).
 */
export async function attachClaimsToRun(
  tx: LedgerTx,
  companyId: string,
  runId: string
): Promise<number> {
  await q(
    `UPDATE expense_claims SET payroll_run_id = NULL
      WHERE company_id = $1 AND payroll_run_id = $2 AND status = 'approved'`,
    [companyId, runId],
    tx
  );
  const attached = await q<{ employee_id: string; owed: string }>(
    `UPDATE expense_claims ec SET payroll_run_id = $2
      WHERE ec.company_id = $1 AND ec.status = 'approved' AND ec.reimburse_via_payroll = true
        AND ec.employee_id IN (SELECT employee_id FROM payroll_items WHERE payroll_run_id = $2)
        AND ${FREE_CLAIM_SQL}
        AND ${OWED_SQL} > 0
      RETURNING ec.employee_id, (${OWED_SQL})::text AS owed`,
    [companyId, runId],
    tx
  );
  const byEmployee = new Map<string, number>();
  for (const a of attached) {
    byEmployee.set(a.employee_id, (byEmployee.get(a.employee_id) ?? 0) + Number(a.owed));
  }
  await q(
    `UPDATE payroll_items SET expense_reimbursement = 0 WHERE payroll_run_id = $1`,
    [runId],
    tx
  );
  for (const [employeeId, owed] of byEmployee) {
    await q(
      `UPDATE payroll_items SET expense_reimbursement = $3
        WHERE payroll_run_id = $1 AND employee_id = $2`,
      [runId, employeeId, fromFils(owed)],
      tx
    );
  }
  const total = sumFils([...byEmployee.values()]);
  await q(
    `UPDATE payroll_runs SET total_expense_reimbursement = $2 WHERE id = $1`,
    [runId, fromFils(total)],
    tx
  );
  return total;
}

/** Reimbursement (fils) carried by the run's items. */
export async function runReimbursementFils(tx: LedgerTx, runId: string): Promise<number> {
  const row = await q1<{ total: string }>(
    `SELECT COALESCE(SUM(expense_reimbursement), 0)::text AS total
       FROM payroll_items WHERE payroll_run_id = $1`,
    [runId],
    tx
  );
  return fils(row?.total);
}

/** The 2045 account id (422 when the chart lacks it). */
export async function reimbursementPayableAccount(
  tx: LedgerTx,
  companyId: string
): Promise<string> {
  const row = await q1<{ id: string }>(
    `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 AND is_active = true
        AND is_archived = false LIMIT 1`,
    [companyId, ACCOUNT_CODES.EMP_REIMBURSEMENT_PAYABLE],
    tx
  );
  if (!row) throw new DomainError("REIMBURSEMENT_ACCOUNT_MISSING", 422);
  return row.id;
}

/** pay: the run's claims are reimbursed by the salary payment. */
export async function markRunClaimsPaid(
  tx: LedgerTx,
  args: {
    companyId: string;
    runId: string;
    actorId: string;
    paymentDate: string;
    paymentAccountId: string;
    label: string;
  }
): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `UPDATE expense_claims SET status = 'paid', paid_at = $3::date, paid_by = $4,
            payment_account_id = $5, payment_reference = $6
      WHERE company_id = $1 AND payroll_run_id = $2 AND status = 'approved'
      RETURNING id`,
    [
      args.companyId,
      args.runId,
      args.paymentDate,
      args.actorId,
      args.paymentAccountId,
      `Payroll ${args.label}`,
    ],
    tx
  );
  return rows.map((r) => r.id);
}

/** unpay: the payment journal was reversed, so the run's claims are owed again. */
export async function reopenRunClaims(
  tx: LedgerTx,
  companyId: string,
  runId: string
): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `UPDATE expense_claims SET status = 'approved', paid_at = NULL, paid_by = NULL,
            payment_account_id = NULL, payment_reference = NULL
      WHERE company_id = $1 AND payroll_run_id = $2 AND status = 'paid'
      RETURNING id`,
    [companyId, runId],
    tx
  );
  return rows.map((r) => r.id);
}
