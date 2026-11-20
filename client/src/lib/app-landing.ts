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

export interface OnboardingRedirectState {
  pathname: string;
  companyLoading: boolean;
  /** The active company is a firm-managed client. */
  isFirmContext: boolean;
  /** "Open books" committed a client switch and the company list has not caught up yet. */
  switchingClient: boolean;
  /** /api/companies is being fetched. */
  companiesFetching: boolean;
  hasNoCompanies: boolean;
  company: { onboardingCompleted?: boolean | null } | undefined | null;
  /** The viewer may run the setup wizard for `company` (owner). */
  canRunOnboarding: boolean;
}

/**
 * Where the signed-in shell sends the user for onboarding, or null to stay. A firm staffer who
 * opens a client's books must land on that client's dashboard even while their own home company
 * is not onboarded: the redirect never runs while a client switch is in flight or committed.
 */
export function onboardingRedirectTarget(s: OnboardingRedirectState): string | null {
  if (s.companyLoading || skipsOnboardingRedirect(s.pathname)) return null;
  if (s.isFirmContext || s.switchingClient) return null;
  if (s.companiesFetching) return null;
  if (s.hasNoCompanies) return "/onboarding";
  if (s.company && !s.company.onboardingCompleted && s.canRunOnboarding) return "/onboarding";
  return null;
}
