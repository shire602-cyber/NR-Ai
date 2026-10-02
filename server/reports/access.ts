// Who may open the sensitive reports (Phase 8 D4): payroll register, payroll summary, WPS, EOS, leave, loans and the
// Audit Trail need a company role of owner, accountant or CFO, or firm staff (platform admin, firm_owner, or an
// assigned firm_admin: the company-access middleware has already checked the assignment).

import { pool } from "../db";
import { hasFullNraScope, isNraFirmRole } from "../../shared/access";

export const SENSITIVE_ROLES = ["owner", "accountant", "cfo"] as const;

export async function memberRole(companyId: string, userId: string): Promise<string | null> {
  const { rows } = await pool.query(`SELECT role FROM company_users WHERE company_id = $1 AND user_id = $2 LIMIT 1`, [companyId, userId]);
  return rows[0]?.role ?? null;
}

export const isSensitiveRole = (role: string | null | undefined): boolean => (SENSITIVE_ROLES as readonly string[]).includes(role ?? "");

/** Sensitive-report access for a user who already passed the company-access check. */
export async function canViewSensitive(
  user: { id: string; isAdmin?: boolean | null; firmRole?: string | null },
  companyId: string
): Promise<boolean> {
  if (hasFullNraScope(user)) return true;
  const role = await memberRole(companyId, user.id);
  if (role) return isSensitiveRole(role);
  return isNraFirmRole(user.firmRole);
}

/** May the user create or change report schedules for the company? owner / accountant / cfo or firm staff. */
export async function canManageSchedules(
  user: { id: string; isAdmin?: boolean | null; firmRole?: string | null },
  companyId: string
): Promise<boolean> {
  return canViewSensitive(user, companyId);
}
