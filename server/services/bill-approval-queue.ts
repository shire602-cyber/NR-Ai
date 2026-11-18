/**
 * WQ2 (8.15): the "To approve" tab of the bill list. For every pending bill, which approval step
 * is next under the company's approval rules (Settings › Approvals, WQ7) and whether the person
 * asking may sign it off now. It mirrors evaluateApproval (approval-rules.service.ts) without
 * recording anything: the approve route stays the only writer and re-checks everything.
 */
import { pool } from "../db";
import { getCompanyRole } from "../middleware/companyRolePolicy";
import {
  PERMISSIONS,
  normalizeCompanyRole,
  roleHasAnyPermission,
  type Permission,
} from "../../shared/permissions";
import { isNraFirmRole } from "../../shared/access";
import { toFils } from "../../shared/money";
import { loadBaseCurrency } from "../ledger";
import {
  allowsSingleMemberSelfApproval,
  companyMemberCount,
  listRules,
  type ApprovalActor,
  type ApprovalRuleRow,
} from "./approval-rules.service";
import { filsOf, isForeign, rateTextOf, toBase, type BillRow } from "./bill-posting.service";

export type ApprovalBlock = "maker" | "role" | "already_signed" | "no_permission" | null;

export interface BillApprovalState {
  bill_id: string;
  /** Step that needs a decision next (null when no approval rule applies to the amount). */
  step: number | null;
  steps_total: number;
  steps_done: number;
  /** Roles / permissions the next step asks for (empty without rules). */
  required: Array<{ role: string | null; permission: string }>;
  /** The caller may approve now (the approve button works for them). */
  awaiting_me: boolean;
  /** Why not, when awaiting_me is false. */
  blocked: ApprovalBlock;
}

function ruleApplies(rule: ApprovalRuleRow, amountFils: number): boolean {
  if (!rule.is_active) return false;
  if (amountFils < toFils(String(rule.min_amount))) return false;
  if (rule.max_amount !== null && rule.max_amount !== undefined) {
    if (amountFils > toFils(String(rule.max_amount))) return false;
  }
  return true;
}

export async function billApprovalQueue(
  companyId: string,
  actor: ApprovalActor
): Promise<BillApprovalState[]> {
  const bills = (
    await pool.query(
      `SELECT id, total_amount, currency, exchange_rate, created_by FROM vendor_bills
        WHERE company_id = $1 AND status = 'pending' ORDER BY bill_date, created_at`,
      [companyId]
    )
  ).rows as Array<BillRow & { created_by: string | null }>;
  if (bills.length === 0) return [];

  const bypass = actor.isAdmin === true || isNraFirmRole(actor.firmRole ?? null);
  const roleRaw = bypass ? null : (actor.role ?? (await getCompanyRole(actor.id, companyId)));
  const role = roleRaw ? normalizeCompanyRole(roleRaw) : null;
  const canApproveAtAll = bypass || (!!role && roleHasAnyPermission(role, ["documents.approve"]));
  const [rules, base, members, selfAllowed, decisions] = await Promise.all([
    listRules(companyId, "bill"),
    loadBaseCurrency(companyId),
    companyMemberCount(companyId),
    allowsSingleMemberSelfApproval(companyId),
    pool.query(
      `SELECT document_id, step_order, decided_by FROM approval_decisions
        WHERE company_id = $1 AND document_type = 'bill' AND decision = 'approved'
          AND document_id = ANY($2::uuid[])`,
      [companyId, bills.map((b) => b.id)]
    ),
  ]);
  const makerMayApprove = members <= 1 && selfAllowed;

  return bills.map((bill) => {
    const amountFils = toBase(
      filsOf(bill.total_amount),
      rateTextOf(bill, base),
      isForeign(bill, base)
    );
    const applying = rules.filter((r) => ruleApplies(r, amountFils));
    const steps = [...new Set(applying.map((r) => r.step_order))].sort((a, b) => a - b);
    const done = decisions.rows.filter((d) => d.document_id === bill.id);
    const doneSteps = new Set(done.map((d) => Number(d.step_order)));
    const current = steps.find((s) => !doneSteps.has(s)) ?? null;
    const stepRules = current === null ? [] : applying.filter((r) => r.step_order === current);
    const satisfies = (r: ApprovalRuleRow) => {
      if (bypass) return true;
      if (!role) return false;
      if (r.required_role && normalizeCompanyRole(r.required_role) !== role && role !== "owner")
        return false;
      const perm = r.required_permission as Permission;
      if ((PERMISSIONS as readonly string[]).includes(perm) && !roleHasAnyPermission(role, [perm]))
        return false;
      return true;
    };
    let blocked: ApprovalBlock = null;
    if (!canApproveAtAll) blocked = "no_permission";
    else if (bill.created_by === actor.id && !makerMayApprove) blocked = "maker";
    else if (done.some((d) => d.decided_by === actor.id)) blocked = "already_signed";
    else if (!stepRules.every(satisfies)) blocked = "role";
    return {
      bill_id: bill.id,
      step: current,
      steps_total: steps.length,
      steps_done: steps.filter((s) => doneSteps.has(s)).length,
      required: stepRules.map((r) => ({
        role: r.required_role,
        permission: r.required_permission,
      })),
      awaiting_me: blocked === null,
      blocked,
    };
  });
}
