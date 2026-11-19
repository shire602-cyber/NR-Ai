import { useQuery } from "@tanstack/react-query";
import { FIRM_UI_PERMISSIONS, firmRoleHasPermission, type FirmPermission } from "@shared/access";

interface FirmContextPayload {
  membership: {
    firm: { name: string } | null;
    role: string;
    permissions: string[];
  } | null;
}

/**
 * What the signed-in firm member may do, from `/api/firm/context` (the server's
 * FIRM_ROLE_PERMISSIONS in shared/access.ts). Controls the user cannot use are hidden or
 * disabled with this, so the UI cannot drift from the route checks. Until the context has
 * loaded nothing is allowed.
 */
export function useFirmPermissions() {
  const query = useQuery<FirmContextPayload>({ queryKey: ["/api/firm/context"] });
  const membership = query.data?.membership ?? null;
  const granted = new Set(membership?.permissions ?? []);
  const can = (permission: FirmPermission): boolean =>
    !!membership && (granted.has(permission) || firmRoleHasPermission(membership.role, permission));
  return {
    loaded: query.isSuccess,
    membership,
    can,
    /** firm_owner-style scope: every client of the firm, not only assigned ones. */
    seesAllClients: can(FIRM_UI_PERMISSIONS.seesAllClients),
  };
}
