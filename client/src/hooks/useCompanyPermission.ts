import { useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useTranslation } from "@/lib/i18n";
import { TrialReadOnlyContext } from "@/lib/trial-access";
import {
  canPerform,
  companyAccessQueryKey,
  type CompanyAccess,
  type CompanyRole,
  type Permission,
} from "@/lib/auth";

/** Catalogs the permission tooltips read (declared so a public page that reaches this hook loads them). */
const PERMISSION_NAMESPACES = ["common"];

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
  const readOnly = useContext(TrialReadOnlyContext);
  const { t } = useTranslation(PERMISSION_NAMESPACES);
  const { data: access, isLoading } = useQuery<CompanyAccess>({
    queryKey: companyAccessQueryKey(companyId),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  // Anything that is not a real access record (loading, error, malformed) counts as unknown.
  const known = !!access && Array.isArray(access.permissions);
  const locked = (permission: Permission) =>
    readOnly && permission !== "reports.read" && permission !== "billing.manage";
  const canRead = (permission: Permission): boolean => !known || canPerform(access, permission);
  const can = (permission: Permission): boolean => !locked(permission) && canRead(permission);
  /** Props that disable a control (with an explanatory tooltip) when `permission` is missing. */
  const gate = (permission: Permission) =>
    can(permission)
      ? {}
      : {
          disabled: true,
          title: locked(permission) ? t["common.workspaceReadOnly"] : t["common.noPermission"],
          "data-permission-denied": "true",
        };
  /**
   * E2 (J3-r2): props for an approve / review control. Disabled with the reason when the role
   * lacks `permission`, or when the signed-in user prepared the item (`makerId`) and another
   * member could approve it (the server's maker-checker rule, waived for a sole member).
   */
  const gateApproval = (permission: Permission, makerId: string | null | undefined) => {
    const base = gate(permission);
    if ("disabled" in base) return base;
    if (known && makerId && access?.userId && makerId === access.userId && !access.soleMember) {
      return {
        disabled: true,
        title: t["common.preparerCannotApprove"],
        "data-permission-denied": "true",
      };
    }
    return {};
  };
  return {
    can,
    canRead,
    gate,
    gateApproval,
    role: (access?.role ?? null) as CompanyRole | null,
    isLoading: !!companyId && isLoading,
    known,
  };
}
