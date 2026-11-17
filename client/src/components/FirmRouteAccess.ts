/**
 * Firm UI access.
 *
 * Accounting-firm management is NR-internal: every /firm/* page is open to NR
 * staff (users.firm_role) and platform admins only. Customers, client-portal
 * users and staff of any other firm never see or reach it. The server enforces
 * the same rule on /api/firm/* (requireNrFirm); this only controls visibility.
 */
import { canAccessNraCenter, type NraAccessUser } from "@shared/access";

export interface FirmAccess {
  /** May open the firm workspace (NR staff or platform admin). */
  canAccessFirm: boolean;
  /** Same as canAccessFirm; kept so callers can name the NR requirement. */
  isNr: boolean;
  role: string | null;
}

/** Route prefixes that are NR-only: every firm page. */
export const NR_ONLY_FIRM_PATHS: readonly string[] = ["/firm"];

export function isNrOnlyFirmPath(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return NR_ONLY_FIRM_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

type AccessUser = (NraAccessUser & { userType?: string | null }) | null | undefined;

/** Pure: the signed-in user's firm access. */
export function resolveFirmAccess(user: AccessUser): FirmAccess {
  if (!user || !canAccessNraCenter(user)) return { canAccessFirm: false, isNr: false, role: null };
  return {
    canAccessFirm: true,
    isNr: true,
    role: user.isAdmin === true ? "firm_owner" : (user.firmRole ?? null),
  };
}

/** Whether `url` may be opened with this access (route guard + nav filter). */
export function firmPathAllowed(access: FirmAccess, url: string): boolean {
  if (!isNrOnlyFirmPath(url)) return true;
  return access.canAccessFirm && access.isNr;
}

/** The caller's firm access (no request: it is derived from the signed-in user). */
export function useFirmAccess(user: AccessUser): FirmAccess & { isLoading: boolean } {
  return { ...resolveFirmAccess(user), isLoading: false };
}
