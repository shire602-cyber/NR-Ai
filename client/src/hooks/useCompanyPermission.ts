import { useQuery } from "@tanstack/react-query";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useTranslation } from "@/lib/i18n";
import {
  canPerform,
  companyAccessQueryKey,
  type CompanyAccess,
  type CompanyRole,
  type Permission,
} from "@/lib/auth";

/**
 * Client view of the signed-in user's permissions in the active company
 * (GET /api/companies/:id/team/me, built from shared/permissions.ts). The
 * server stays the authority (companyRolePolicy); this only decides which
 * controls to hide or disable so a role is not offered actions that answer 403.
 *
 * While the access record is loading, or if it cannot be read, `can` answers
 * true: the UI never hides a control on a guess, and the server still refuses.
 */
export function useCompanyPermission() {
  const { companyId } = useDefaultCompany();
  const { t } = useTranslation();
  const { data: access, isLoading } = useQuery<CompanyAccess>({
    queryKey: companyAccessQueryKey(companyId),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  // Anything that is not a real access record (loading, error, malformed) counts as unknown.
  const known = !!access && Array.isArray(access.permissions);
  const can = (permission: Permission): boolean => !known || canPerform(access, permission);
  /** Props that disable a control (with an explanatory tooltip) when `permission` is missing. */
  const gate = (permission: Permission) =>
    can(permission)
      ? {}
      : { disabled: true, title: t["common.noPermission"], "data-permission-denied": "true" };
  return {
    can,
    gate,
    role: (access?.role ?? null) as CompanyRole | null,
    isLoading: !!companyId && isLoading,
    known,
  };
}
