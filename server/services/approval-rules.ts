// Approval rules: pure matching and ranking (no database).
//
// A rule says: for this document type, when the AED amount is ABOVE threshold_aed, the document needs one
// or two approvals; approver_roles[k-1] is the minimum role for step k. Roles are ranked
// owner 3 > cfo 2 > accountant 1 > employee 0; firm staff and platform admins rank 1 (accountant).
// Of several matching rules the one with the HIGHEST threshold applies (the most specific).

import type { ApprovalDocumentType, ApproverRole } from "../../shared/schema-purchasing-hr";

export const ROLE_RANK: Record<string, number> = { owner: 3, cfo: 2, accountant: 1, employee: 0 };

/** Rank of firm staff and platform admins acting on a company they have no membership in. */
export const STAFF_RANK = ROLE_RANK.accountant;

export interface ApprovalRuleLike {
  id: string;
  documentType: ApprovalDocumentType | string;
  name: string;
  thresholdAed: number;
  approverRoles: string[];
  isActive: boolean;
}

export function rankOfRole(role: string | null | undefined): number {
  return role ? (ROLE_RANK[role] ?? 0) : 0;
}

/** Rank of an acting user: their company role, else staff rank for firm staff / platform admins, else 0. */
export function actorRank(input: { companyRole: string | null; isAdmin?: boolean; firmRole?: string | null }): number {
  if (input.companyRole) return rankOfRole(input.companyRole);
  if (input.isAdmin === true || input.firmRole === "firm_owner" || input.firmRole === "firm_admin") return STAFF_RANK;
  return 0;
}

/** The active rule that applies to an amount: strictly above its threshold, highest threshold wins. */
export function matchRule<R extends ApprovalRuleLike>(rules: R[], documentType: string, amountAed: number): R | null {
  let best: R | null = null;
  for (const rule of rules) {
    if (!rule.isActive || rule.documentType !== documentType) continue;
    if (!(amountAed > rule.thresholdAed)) continue;
    if (!best || rule.thresholdAed > best.thresholdAed) best = rule;
  }
  return best;
}

/** The minimum role of step `stepNumber` (1-based) of a rule or request. */
export function roleForStep(roles: string[], stepNumber: number): string | null {
  return roles[stepNumber - 1] ?? null;
}

/** Whether a user of `rank` may sign a step that needs `role`. */
export function canSignStep(rank: number, role: string): boolean {
  return rank >= rankOfRole(role);
}

export interface RuleInputProblem {
  code: "INVALID_APPROVER_ROLES" | "INVALID_THRESHOLD";
  message: string;
}

/** Validate the roles and threshold of a rule write; null when fine. */
export function ruleInputProblem(input: { thresholdAed?: unknown; approverRoles?: unknown }): RuleInputProblem | null {
  if (input.thresholdAed !== undefined) {
    const n = Number(input.thresholdAed);
    if (!Number.isFinite(n) || n < 0) return { code: "INVALID_THRESHOLD", message: "The threshold must be zero or more." };
  }
  if (input.approverRoles !== undefined) {
    const roles = input.approverRoles;
    const valid =
      Array.isArray(roles) &&
      roles.length >= 1 &&
      roles.length <= 2 &&
      roles.every((r) => r === "accountant" || r === "cfo" || r === "owner");
    if (!valid) {
      return { code: "INVALID_APPROVER_ROLES", message: "Choose one or two approver roles from accountant, cfo and owner." };
    }
  }
  return null;
}

/** Roles of a rule that no active company member can sign (a member of a higher role can sign a lower step). */
export function unstaffedRoles(roles: string[], memberRoles: string[]): string[] {
  const best = memberRoles.reduce((max, r) => Math.max(max, rankOfRole(r)), -1);
  return roles.filter((role) => best < rankOfRole(role));
}

export const APPROVER_ROLE_LIST: ApproverRole[] = ["accountant", "cfo", "owner"];
