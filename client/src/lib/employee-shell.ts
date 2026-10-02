/**
 * The employee-role shell. A plain employee gets a self-service workspace: their own payslips, leave, loans,
 * account settings and help. Everything else is refused by the server (403 ROLE_REQUIRED), so the client sends
 * them to their home page with a plain message instead of showing blank screens.
 */

export const EMPLOYEE_ROLE = "employee";
/** Where an employee lands: the payroll page, which shows only their own records. */
export const EMPLOYEE_HOME = "/payroll";
export const ROLE_NOTICE_PARAM = "notice";
export const ROLE_NOTICE_VALUE = "role";

const EXACT = new Set(["/dashboard", "/payroll", "/expense-claims", "/settings/security", "/notifications", "/notification-preferences", "/onboarding"]);
const PREFIXES = ["/help", "/developers/api"];

export const isEmployeeRole = (role: string | null | undefined): boolean => role === EMPLOYEE_ROLE;

function pathOnly(location: string): string {
  return location.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
}

/** True for the screens an employee may open. Anything else is a finance screen. */
export function isEmployeeAllowedPath(location: string): boolean {
  const path = pathOnly(location);
  return EXACT.has(path) || PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Where to send an employee who opened `location`, or null when it is already fine. */
export function employeeRedirectFor(location: string): string | null {
  if (isEmployeeAllowedPath(location)) return null;
  return `${EMPLOYEE_HOME}?${ROLE_NOTICE_PARAM}=${ROLE_NOTICE_VALUE}`;
}

export const PAYROLL_TABS = ["employees", "payroll-runs", "gratuity", "leave", "loans", "settlement", "payslips"] as const;

/** `?tab=leave` opens that tab; anything unknown means the default one. */
export function payrollTabFromSearch(search: string): (typeof PAYROLL_TABS)[number] | null {
  const tab = new URLSearchParams(search).get("tab");
  return (PAYROLL_TABS as readonly string[]).includes(tab ?? "") ? (tab as (typeof PAYROLL_TABS)[number]) : null;
}
