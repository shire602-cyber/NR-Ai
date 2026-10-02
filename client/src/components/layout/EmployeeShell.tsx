import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMyCompanyRole } from "@/hooks/useMyCompanyRole";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { EMPLOYEE_HOME, ROLE_NOTICE_PARAM, ROLE_NOTICE_VALUE, employeeRedirectFor, isEmployeeRole } from "@/lib/employee-shell";
import { clearRoleBlocked, useRoleBlockedPath } from "@/lib/role-blocked";
import { messages as pageMessages } from "./EmployeeShell.i18n";

/** The app's standard "not available for your role" screen. */
export function NotAvailableForRole({ home = EMPLOYEE_HOME }: { home?: string }) {
  const tr = pageMessages.useT();
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-20 text-center" role="alert" data-testid="role-unavailable">
      <Lock className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-2xl font-semibold">{tr("unavailableTitle")}</h1>
      <p className="text-muted-foreground">{tr("unavailableBody")}</p>
      <Button asChild>
        <Link href={home}>{home === "/dashboard" ? tr("goDashboard") : tr("goHome")}</Link>
      </Button>
    </div>
  );
}

/** Is the signed-in user a plain employee of the active company? Null while the role is still loading. */
export function useIsEmployee(): boolean | null {
  const { companyId } = useDefaultCompany();
  const { role, isLoading } = useMyCompanyRole(companyId);
  if (!companyId) return false;
  if (!role && isLoading) return null;
  return isEmployeeRole(role);
}

/**
 * Sends an employee who opened a finance screen to their own page. Renders nothing; the notice about why they
 * landed there is <RoleNotices/>.
 */
export function useEmployeeGuard(): void {
  const [location, navigate] = useLocation();
  const isEmployee = useIsEmployee();
  useEffect(() => {
    if (isEmployee !== true) return;
    const target = employeeRedirectFor(location);
    if (target) navigate(target, { replace: true });
  }, [isEmployee, location, navigate]);
}

/** The two plain notices above the page: "that screen is not for you" after a redirect, and "some data is hidden". */
export function RoleNotices() {
  const tr = pageMessages.useT();
  const [location] = useLocation();
  const blockedPath = useRoleBlockedPath();
  const [dismissedRedirect, setDismissedRedirect] = useState(false);
  const redirected = typeof window !== "undefined" && new URLSearchParams(window.location.search).get(ROLE_NOTICE_PARAM) === ROLE_NOTICE_VALUE;

  // A new page starts clean.
  useEffect(() => {
    setDismissedRedirect(false);
    if (blockedPath !== null && blockedPath !== window.location.pathname) clearRoleBlocked();
  }, [location, blockedPath]);

  const showRedirect = redirected && !dismissedRedirect;
  const showBlocked = blockedPath !== null && blockedPath === (typeof window !== "undefined" ? window.location.pathname : "");
  if (!showRedirect && !showBlocked) return null;
  return (
    <div className="space-y-2 px-4 pt-4" data-testid="role-notices">
      {showRedirect && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="notice-role-redirect">
          <span>{tr("redirectedNotice")}</span>
          <Button variant="ghost" size="icon" aria-label={tr("dismiss")} onClick={() => setDismissedRedirect(true)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
      {showBlocked && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-md border bg-muted/50 p-3 text-sm" data-testid="notice-role-blocked">
          <span>{tr("someUnavailable")}</span>
          <Button variant="ghost" size="icon" aria-label={tr("dismiss")} onClick={clearRoleBlocked}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
