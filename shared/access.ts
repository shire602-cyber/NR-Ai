/**
 * Canonical NRA Center access model — single source of truth shared by the
 * server middleware (requireNraAccess) and the client UI (sidebar, routes,
 * command palette) so the two can never disagree about who sees the private
 * firm workspace.
 *
 * Access: platform admins (isAdmin) and NRA firm staff (firm_owner,
 * firm_admin). SaaS customers and client-portal users never qualify.
 */

export const NRA_FIRM_ROLES = ["firm_owner", "firm_admin"] as const;
export type NraFirmRole = (typeof NRA_FIRM_ROLES)[number];

export interface NraAccessUser {
  isAdmin?: boolean | null;
  firmRole?: string | null;
}

export function isNraFirmRole(role: string | null | undefined): role is NraFirmRole {
  return NRA_FIRM_ROLES.includes((role ?? "") as NraFirmRole);
}

export function canAccessNraCenter(user: NraAccessUser | null | undefined): boolean {
  if (!user) return false;
  return user.isAdmin === true || isNraFirmRole(user.firmRole);
}

/**
 * True when the user may see/manage ALL client companies (platform admin or
 * firm_owner). firm_admin sees only assigned clients.
 */
export function hasFullNraScope(user: NraAccessUser | null | undefined): boolean {
  if (!user) return false;
  return user.isAdmin === true || user.firmRole === "firm_owner";
}
