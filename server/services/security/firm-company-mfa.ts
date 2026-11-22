import { sql } from "drizzle-orm";
import { db, type AppDatabase } from "../../db";
import { normalizeCompanyRole, type CompanyRole } from "../../../shared/permissions";
import type { CompanyMfaPolicy } from "../../../shared/schema";

export function policyCoversRole(policy: CompanyMfaPolicy, role: CompanyRole | null): boolean {
  if (!role || policy === "none") return false;
  if (policy === "all") return true;
  return role === "owner" || role === "admin";
}

/** Check an actor's enrollment for already-authorized companies. */
export async function firmMfaRequirement(
  companyIds: string[],
  userId: string,
  exec: Pick<AppDatabase, "execute"> = db
) {
  if (!companyIds.length) return undefined;
  const { rows } = await exec.execute<{
    company_id: string;
    require_mfa: string;
    role: string | null;
  }>(sql`
    SELECT p.company_id, p.require_mfa, membership.role
    FROM company_security_policies p
    JOIN users actor ON actor.id = ${userId} AND NOT actor.mfa_enabled
    LEFT JOIN company_users membership
      ON membership.company_id = p.company_id AND membership.user_id = actor.id
    WHERE p.company_id = ANY(${sql.param(companyIds)}::uuid[]) AND p.require_mfa <> 'none'
    ORDER BY p.company_id
  `);
  const matched = rows.find(
    ({ require_mfa: policy, role }) =>
      policy === "all" ||
      (policy === "owners_admins" &&
        policyCoversRole(policy, role ? normalizeCompanyRole(role) : null))
  );
  return matched && { companyId: matched.company_id, policy: matched.require_mfa };
}
