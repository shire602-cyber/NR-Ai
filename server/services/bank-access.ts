// Who may post to the ledger from the bank screens (match, create entry, rules, reconciliation, feeds).
// owner / accountant / cfo members and firm staff with access to a client company; an employee may look but not post.

import { AppError } from "../errors";
import { storage } from "../storage";

const POSTING_ROLES = new Set(["owner", "accountant", "cfo"]);

export function roleMayPostBanking(role: string | null | undefined): boolean {
  return !!role && POSTING_ROLES.has(role);
}

export async function assertCanPostBanking(userId: string, companyId: string): Promise<void> {
  const membership = await storage.getUserRole(companyId, userId);
  if (membership) {
    if (roleMayPostBanking(membership.role)) return;
    throw new AppError({
      message: "Your role cannot post banking entries for this company.",
      statusCode: 403,
      code: "ROLE_NOT_ALLOWED",
    });
  }
  // No membership: only firm staff with access (hasCompanyAccess checks the firm role and assignment).
  if (await storage.hasCompanyAccess(userId, companyId)) return;
  throw new AppError({ message: "Access denied", statusCode: 403, code: "ROLE_NOT_ALLOWED" });
}
