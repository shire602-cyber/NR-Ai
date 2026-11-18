// Free trial (owner decision, 2026-11-18): every new company gets a 14-day free trial of the top
// plan, no card required. The trial start is the company's subscription row creation time
// (existing companies count from when their row was created); an NR admin may extend it
// (subscriptions.trial_ends_at). When it ends without a paid plan the workspace becomes read-only:
// data stays readable and exportable, nothing is deleted, and new work needs a plan (see
// shared/plans.ts resolveEntitlement). While online checkout is not configured, choosing a plan
// means contacting us; an NR admin then sets the plan (PUT /api/admin/companies/:id/plan).

/** Length of the free trial in days. The one place the public claim and the app read. */
export const TRIAL_DAYS = 14;

/** What happens when the trial ends: the workspace is read-only until a plan is chosen. */
export const TRIAL_END_BEHAVIOUR = "read_only" as const;

/** Where "Contact us" goes while online checkout is not configured. */
export const UPGRADE_CONTACT_EMAIL = "support@muhasib.ai";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrialState {
  days: number;
  startedAt: string;
  endsAt: string;
  /** Whole days left, rounded up; 0 once ended. */
  daysLeft: number;
  ended: boolean;
}

/** Trial state from the subscription row's creation time. */
export function trialState(
  startedAt: string | Date | null | undefined,
  now: Date = new Date(),
  days: number = TRIAL_DAYS
): TrialState | null {
  if (!startedAt) return null;
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + days * DAY_MS);
  const msLeft = end.getTime() - now.getTime();
  return {
    days,
    startedAt: start.toISOString(),
    endsAt: end.toISOString(),
    daysLeft: msLeft > 0 ? Math.ceil(msLeft / DAY_MS) : 0,
    ended: msLeft <= 0,
  };
}
