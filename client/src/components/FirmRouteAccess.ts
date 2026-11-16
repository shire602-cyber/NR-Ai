/**
 * Firm UI access (S4, W5-D follow-up).
 *
 * The firm workspace is open to NR staff (users.firm_role), platform admins
 * and staff of any *approved* accounting firm (GET /api/firms/me returns a
 * membership with permissions only for an active firm). NR-only surfaces —
 * firm messaging (comms), document chasing, email intake and value-ops/growth —
 * stay hidden for staff of other firms; the server enforces the same split
 * (requireNraAccess / requireNrFirm), this only controls visibility.
 */
import { useQuery } from "@tanstack/react-query";
import { canAccessNraCenter, type NraAccessUser } from "@shared/access";

export interface FirmMembershipPayload {
  membership: {
    firm: { id: string; name: string; status: string; isNr: boolean } | null;
    role: string;
    isNr: boolean;
    platformAdmin: boolean;
    permissions: string[];
  } | null;
}

export interface FirmAccess {
  /** May open the firm workspace at all. */
  canAccessFirm: boolean;
  /** May open NR-only surfaces (NR staff or platform admin). */
  isNr: boolean;
  role: string | null;
}

/** Firm routes only NR staff (and platform admins) may open. */
export const NR_ONLY_FIRM_PATHS: readonly string[] = [
  "/firm/value-ops",
  "/firm/comms",
  "/firm/document-chasing",
  "/firm/email-intake",
];

export function isNrOnlyFirmPath(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return NR_ONLY_FIRM_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

type AccessUser = (NraAccessUser & { userType?: string | null }) | null | undefined;

/** Pure: combine the signed-in user with the /api/firms/me payload. */
export function resolveFirmAccess(
  user: AccessUser,
  payload: FirmMembershipPayload | null | undefined
): FirmAccess {
  if (!user) return { canAccessFirm: false, isNr: false, role: null };
  if (canAccessNraCenter(user)) {
    return {
      canAccessFirm: true,
      isNr: true,
      role: user.isAdmin === true ? "firm_owner" : (user.firmRole ?? null),
    };
  }
  const m = payload?.membership;
  const active = !!m && m.permissions.length > 0 && (m.firm?.status ?? "active") === "active";
  if (!active) return { canAccessFirm: false, isNr: false, role: null };
  return { canAccessFirm: true, isNr: m.isNr === true, role: m.role };
}

/** Whether `url` may be opened with this access (route guard + nav filter). */
export function firmPathAllowed(access: FirmAccess, url: string): boolean {
  if (!access.canAccessFirm) return false;
  return access.isNr || !isNrOnlyFirmPath(url);
}

export const firmMembershipQueryKey = ["/api/firms/me"] as const;

/**
 * The caller's firm access. NR staff and admins resolve without a request;
 * other signed-in (non-portal) users ask /api/firms/me.
 */
export function useFirmAccess(user: AccessUser): FirmAccess & { isLoading: boolean } {
  const needsLookup = !!user && !canAccessNraCenter(user) && user.userType !== "client_portal";
  const { data, isLoading } = useQuery<FirmMembershipPayload>({
    queryKey: firmMembershipQueryKey,
    enabled: needsLookup,
    staleTime: 60_000,
    retry: false,
  });
  return { ...resolveFirmAccess(user, data), isLoading: needsLookup && isLoading };
}
