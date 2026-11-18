/**
 * Who may add another company from the company switcher: the customer (owner) account. The
 * plan's company cap is enforced by the server (403 COMPANY_LIMIT_REACHED) and explained by the
 * PlanLimitDialog. NR staff and portal users manage companies elsewhere.
 */
export function canCreateCompany(user: { userType?: string | null } | null | undefined): boolean {
  return user?.userType === "customer";
}
