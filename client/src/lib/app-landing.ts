// Where a signed-in user lands, and which paths are exempt from the onboarding redirect.
// Pure so the rules are unit-tested (STEP1 F7, F11).
import { isFirmRole } from "@shared/access";

export interface LandingUser {
  userType?: string | null;
  isAdmin?: boolean | null;
  firmRole?: string | null;
}

/**
 * Default landing page after sign-in (when no explicit `next` was requested): portal users go to
 * their portal, platform admins to the admin console and NR firm staff to the firm command
 * center. Everyone else lands on the dashboard. Staff never land on their own company's
 * onboarding wizard.
 */
export function landingPathFor(user: LandingUser | null | undefined): string {
  if (user?.userType === "client_portal") return "/client-portal/dashboard";
  if (user?.isAdmin === true) return "/admin/users";
  if (isFirmRole(user?.firmRole)) return "/firm/command-center";
  return "/dashboard";
}

/**
 * The NR console (/admin, /firm) is staff work with its own role checks: an admin's or staffer's
 * own unfinished company must not bounce them to /onboarding while they are on it.
 */
export function skipsOnboardingRedirect(pathname: string): boolean {
  return pathname === "/onboarding" || /^\/(admin|firm)(\/|$)/.test(pathname);
}
