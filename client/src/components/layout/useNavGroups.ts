import { useMemo } from "react";
import { shouldShowNraCenterNav } from "@shared/access";
import { isSaudiCompany } from "@/lib/company-country";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useActiveCompany } from "@/components/ActiveCompanyProvider";
import {
  ADMIN_GROUP,
  CUSTOMER_GROUPS,
  NRA_GROUP,
  SETTINGS_GROUP,
  type NavGroup,
} from "@/components/layout/nav-config";

function useActiveCompanySafe() {
  // The mobile nav is also rendered in isolation (tests, error shells) without the provider;
  // navigation must still render there, just without company-specific items.
  try {
    return useActiveCompany();
  } catch {
    return { isFirmContext: false, company: undefined };
  }
}

/** The navigation groups the current user sees, in order (sidebar and mobile More sheet). */
export function useNavGroups() {
  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.isAdmin === true;
  // `isFirmContext` is true when the user has switched INTO a firm-managed
  // client company. Firm-level tools (the NRA Center) belong at the firm level,
  // so we hide that group while a specific client file is the active workspace.
  // The user re-enters the firm via the "Firm workspace" entry in CompanySwitcher.
  const { isFirmContext, company } = useActiveCompanySafe();
  // ZATCA applies to companies registered in Saudi Arabia only (UAE companies never see it).
  const isSaudi = isSaudiCompany(company as { addressCountry?: string | null } | undefined);
  // Accounting-firm management is NR-internal: only NR staff and platform admins see the group.
  const showNraCenter = shouldShowNraCenterNav(currentUser, { inClientContext: isFirmContext });

  // All collapsible groups for this user (Dashboard is separate — direct link)
  const allGroups = useMemo<NavGroup[]>(
    () => [
      ...CUSTOMER_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.saudiOnly || isSaudi),
      })),
      ...(showNraCenter ? [NRA_GROUP] : []),
      ...(isAdmin ? [ADMIN_GROUP] : []),
      SETTINGS_GROUP,
    ],
    [showNraCenter, isAdmin, isSaudi]
  );
  return { allGroups, currentUser, userType: currentUser?.userType || "customer" };
}
