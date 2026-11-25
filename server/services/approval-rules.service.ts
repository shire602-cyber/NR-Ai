/**
 * Approval rules and maker-checker (W3-B: R04-11, R04-19). Exported for every module that
 * approves money (bills, purchase orders, expense claims; payroll and budgets can call it too).
 *
 *   const gate = await evaluateApproval({ companyId, documentType: "bill", documentId,
 *     amountFils, makerId, actor: { id, role } });
 *   // gate.final === false → this approval recorded one step; more steps remain.
 *
 * Rules: by document type and amount band (min ≤ amount, amount ≤ max when set), with a required
 * permission and optional required role. Steps run in step_order; each step needs a different
 * approver from earlier steps and from the maker. Companies with a single member may self-approve
 * when `approval_settings.allow_single_member_self_approval` (default true).
 */
import type { Request } from "express";
import { pool } from "../db";
import { DomainError } from "../errors";
import { assertDifferentActor, getCompanyRole } from "../middleware/companyRolePolicy";
import {
  PERMISSIONS,
  normalizeCompanyRole,
  roleHasAnyPermission,
  type CompanyRole,
  type Permission,
} from "../../shared/permissions";
import { isNraFirmRole } from "../../shared/access";
import { fromFils, toFils } from "../../shared/money";
import { txRows } from "./bill-posting.service";
import type { LedgerTx } from "../ledger";
import { recordAudit } from "./audit.service";

export const APPROVAL_DOCUMENT_TYPES = [
  "bill",
  "purchase_order",
  "expense_claim",
  "payroll",
  "budget",
] as const;
export type ApprovalDocumentType = (typeof APPROVAL_DOCUMENT_TYPES)[number];

export interface ApprovalRuleRow {
  id: string;
  company_id: string;
  name: string;
  document_type: string;
  min_amount: string;
  max_amount: string | null;
  step_order: number;
  required_permission: string;
  required_role: string | null;
  is_active: boolean;
}

export interface ApprovalActor {
  id: string;
  /** Company role; resolved from company_users when omitted. */
  role?: CompanyRole | null;
  isAdmin?: boolean;
  firmRole?: string | null;
}

export interface ApprovalEvaluation {
  /** true: every required step is satisfied after this approval → transition the document. */
  final: boolean;
  /** Step recorded by this call (null when no rule applies). */
  stepOrder: number | null;
  remainingSteps: number[];
  rulesApplied: string[];
}

/** Role of the request user in the company (admins / NR firm staff bypass company roles). */
export function actorFromRequest(req: Request): ApprovalActor {
  const u = req.user!;
  return {
    id: u.id,
    // Always re-read from company_users for the document's company (never trust a cached role).
    role: null,
    isAdmin: u.isAdmin === true,
    firmRole: (u as { firmRole?: string | null }).firmRole ?? null,
  };
}

const bypasses = (a: ApprovalActor) => a.isAdmin === true || isNraFirmRole(a.firmRole ?? null);

/** Throw 403 PERMISSION_DENIED unless the actor's company role has one of `permissions`. */
export async function assertCompanyPermission(
  actor: ApprovalActor,
  companyId: string,
  permissions: readonly Permission[]
): Promise<CompanyRole | null> {
  if (bypasses(actor)) return actor.role ?? null;
  const role = actor.role ?? (await getCompanyRole(actor.id, companyId));
  if (!role || !roleHasAnyPermission(role, permissions)) {
    throw new DomainError(
      "PERMISSION_DENIED",
      403,
      { permissions, role },
      "Your role in this company does not allow this action"
    );
  }
  return role;
}

export async function companyMemberCount(companyId: string): Promise<number> {
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM company_users WHERE company_id = $1`, [
    companyId,
  ]);
  return Number(r.rows[0]?.n ?? 0);
}

export async function allowsSingleMemberSelfApproval(companyId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT allow_single_member_self_approval AS allow FROM approval_settings WHERE company_id = $1`,
    [companyId]
  );
  return r.rows.length === 0 ? true : r.rows[0].allow === true;
}

/**
 * Maker-checker (R04-11): the approver must differ from the preparer, unless the company has a
 * single member and allows self-approval. Throws 403 SAME_ACTOR_APPROVAL.
 */
export async function assertMakerChecker(
  companyId: string,
  makerId: string | null | undefined,
  checkerId: string
): Promise<void> {
  if (!makerId || makerId !== checkerId) return;
  const single = (await companyMemberCount(companyId)) <= 1;
  const allow = single && (await allowsSingleMemberSelfApproval(companyId));
  assertDifferentActor(makerId, checkerId, { allowSingleOwner: allow });
}

export async function listRules(
  companyId: string,
  documentType?: string
): Promise<ApprovalRuleRow[]> {
  const r = await pool.query(
    `SELECT * FROM approval_rules WHERE company_id = $1 AND ($2::text IS NULL OR document_type = $2)
      ORDER BY document_type, step_order, min_amount`,
    [companyId, documentType ?? null]
  );
  return r.rows;
}

function ruleApplies(rule: ApprovalRuleRow, amountFils: number): boolean {
  if (!rule.is_active) return false;
  if (amountFils < toFils(String(rule.min_amount))) return false;
  if (rule.max_amount !== null && rule.max_amount !== undefined) {
    if (amountFils > toFils(String(rule.max_amount))) return false;
  }
  return true;
}

function actorSatisfies(rule: ApprovalRuleRow, actor: ApprovalActor, role: CompanyRole | null) {
  if (bypasses(actor)) return true;
  if (!role) return false;
  if (rule.required_role && normalizeCompanyRole(rule.required_role) !== role && role !== "owner") {
    return false;
  }
  const perm = rule.required_permission as Permission;
  if ((PERMISSIONS as readonly string[]).includes(perm) && !roleHasAnyPermission(role, [perm])) {
    return false;
  }
  return true;
}

/**
 * Evaluate the approval rules for one approval action and record the step decision. Run inside
 * the caller's transaction (`tx`) so the step and the document transition commit together.
 * Throws 403 SAME_ACTOR_APPROVAL (maker), 403 APPROVAL_RULE_DENIED (role/permission short of the
 * current step), 409 APPROVAL_STEP_DUPLICATE_ACTOR (same person approving two steps).
 */
export async function evaluateApproval(
  tx: LedgerTx,
  args: {
    companyId: string;
    documentType: ApprovalDocumentType;
    documentId: string;
    amountFils: number;
    makerId: string | null | undefined;
    actor: ApprovalActor;
    comment?: string | null;
  }
): Promise<ApprovalEvaluation> {
  const { companyId, documentType, documentId, amountFils, actor } = args;
  await assertMakerChecker(companyId, args.makerId, actor.id);
  const role = bypasses(actor) ? null : (actor.role ?? (await getCompanyRole(actor.id, companyId)));

  const rules = (await listRules(companyId, documentType)).filter((r) =>
    ruleApplies(r, amountFils)
  );
  if (rules.length === 0) {
    return { final: true, stepOrder: null, remainingSteps: [], rulesApplied: [] };
  }
  const steps = [...new Set(rules.map((r) => r.step_order))].sort((a, b) => a - b);
  const done = await txRows<{ step_order: number; decided_by: string }>(
    tx,
    `SELECT step_order, decided_by FROM approval_decisions
      WHERE company_id = $1 AND document_type = $2 AND document_id = $3 AND decision = 'approved'`,
    [companyId, documentType, documentId]
  );
  const doneSteps = new Set(done.map((d) => Number(d.step_order)));
  const current = steps.find((s) => !doneSteps.has(s));
  if (current === undefined) {
    return {
      final: true,
      stepOrder: null,
      remainingSteps: [],
      rulesApplied: rules.map((r) => r.id),
    };
  }
  if (done.some((d) => d.decided_by === actor.id)) {
    throw new DomainError(
      "APPROVAL_STEP_DUPLICATE_ACTOR",
      409,
      { step: current },
      "A different approver must sign off the next approval step"
    );
  }
  const stepRules = rules.filter((r) => r.step_order === current);
  const satisfied = stepRules.every((r) => actorSatisfies(r, actor, role));
  if (!satisfied) {
    throw new DomainError(
      "APPROVAL_RULE_DENIED",
      403,
      {
        step: current,
        amount: fromFils(amountFils),
        rules: stepRules.map((r) => ({
          id: r.id,
          name: r.name,
          requiredPermission: r.required_permission,
          requiredRole: r.required_role,
        })),
      },
      `This amount needs approval by ${stepRules.map((r) => r.required_role ?? r.required_permission).join(" / ")}`
    );
  }
  await txRows(
    tx,
    `INSERT INTO approval_decisions (company_id, document_type, document_id, rule_id, step_order, decision, decided_by, comment)
     VALUES ($1, $2, $3, $4, $5, 'approved', $6, $7)`,
    [companyId, documentType, documentId, stepRules[0].id, current, actor.id, args.comment ?? null]
  );
  const remaining = steps.filter((s) => s !== current && !doneSteps.has(s));
  return {
    final: remaining.length === 0,
    stepOrder: current,
    remainingSteps: remaining,
    rulesApplied: rules.map((r) => r.id),
  };
}

/** Pure check (no recording) used by UIs / other modules: may this actor approve this amount? */
export async function canApprove(args: {
  companyId: string;
  documentType: ApprovalDocumentType;
  amountFils: number;
  actor: ApprovalActor;
}): Promise<{ allowed: boolean; blockingRules: string[] }> {
  const role = bypasses(args.actor)
    ? null
    : (args.actor.role ?? (await getCompanyRole(args.actor.id, args.companyId)));
  const rules = (await listRules(args.companyId, args.documentType)).filter((r) =>
    ruleApplies(r, args.amountFils)
  );
  const blocking = rules.filter((r) => !actorSatisfies(r, args.actor, role)).map((r) => r.id);
  return { allowed: blocking.length === 0, blockingRules: blocking };
}

/** Drop recorded step decisions (document rejected / sent back / voided). */
export async function clearApprovalDecisions(
  tx: LedgerTx,
  companyId: string,
  documentType: ApprovalDocumentType,
  documentId: string
): Promise<void> {
  await txRows(
    tx,
    `DELETE FROM approval_decisions WHERE company_id = $1 AND document_type = $2 AND document_id = $3`,
    [companyId, documentType, documentId]
  );
}

export interface ApprovalRuleInput {
  name: string;
  document_type: ApprovalDocumentType;
  min_amount: string;
  max_amount?: string | null;
  step_order?: number;
  required_permission?: Permission;
  required_role?: CompanyRole | null;
  is_active?: boolean;
}

export async function createRule(
  companyId: string,
  userId: string,
  input: ApprovalRuleInput,
  req?: Request
): Promise<ApprovalRuleRow> {
  const r = await pool.query(
    `INSERT INTO approval_rules (company_id, name, document_type, min_amount, max_amount, step_order,
        required_permission, required_role, is_active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      companyId,
      input.name,
      input.document_type,
      input.min_amount,
      input.max_amount ?? null,
      input.step_order ?? 1,
      input.required_permission ?? "documents.approve",
      input.required_role ?? null,
      input.is_active ?? true,
      userId,
    ]
  );
  await recordAudit({
    userId,
    companyId,
    action: "approval_rule.create",
    entityType: "approval_rule",
    entityId: r.rows[0].id,
    after: r.rows[0],
    req,
  });
  return r.rows[0];
}

export async function deleteRule(companyId: string, ruleId: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM approval_rules WHERE id = $1 AND company_id = $2`, [
    ruleId,
    companyId,
  ]);
  return (r.rowCount ?? 0) > 0;
}

export async function setSelfApprovalSetting(companyId: string, allow: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO approval_settings (company_id, allow_single_member_self_approval, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (company_id) DO UPDATE SET allow_single_member_self_approval = $2, updated_at = now()`,
    [companyId, allow]
  );
}
