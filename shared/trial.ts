import { MARKETING_BRAND } from "./marketing-brand";

// Free trial (owner decision, 2026-11-18): every new company gets a 14-day free trial of the top
// plan, no card required. The trial start is the company's subscription row creation time
// (existing companies count from when their row was created); an NR admin may extend it
// (subscriptions.trial_ends_at). When it ends without an active paid plan, workspace access is
// locked and all data is kept. Checkout or an NR admin can activate the selected plan.

/** Length of the free trial in days. The one place the public claim and the app read. */
export const TRIAL_DAYS = 14;

/** What happens when the trial ends: the workspace is locked until a paid plan is active. */
export const TRIAL_END_BEHAVIOUR = "locked" as const;

/** Where "Contact us" goes while online checkout is not configured. */
export const UPGRADE_CONTACT_EMAIL = MARKETING_BRAND.supportEmail;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrialState {
  days: number;
  startedAt: string;
  endsAt: string;
  /** Whole days left, rounded up; 0 once ended. */
  daysLeft: number;
  ended: boolean;
}

/**
 * The ONE trial-end rule. The plan gate (shared/plans.ts resolveEntitlement), the subscription
 * API and every banner read the end from here: the stored end (an NR admin may extend it), else
 * start + `days`. The length is never rounded to whole days, so a non-whole-day end shows
 * exactly the end the gate enforces.
 */
export function trialEndDate(
  startedAt: string | Date | null | undefined,
  endsAt?: string | Date | null,
  days: number = TRIAL_DAYS
): Date | null {
  if (endsAt) {
    const given = new Date(endsAt);
    if (!Number.isNaN(given.getTime())) return given;
  }
  if (!startedAt) return null;
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + days * DAY_MS);
}

/** Trial state (days left, ended) from the same end the gate uses. */
export function trialState(
  startedAt: string | Date | null | undefined,
  now: Date = new Date(),
  days: number = TRIAL_DAYS,
  endsAt?: string | Date | null
): TrialState | null {
  if (!startedAt) return null;
  const start = new Date(startedAt);
  const end = trialEndDate(startedAt, endsAt, days);
  if (!end || Number.isNaN(start.getTime())) return null;
  const msLeft = end.getTime() - now.getTime();
  return {
    days: Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS)),
    startedAt: start.toISOString(),
    endsAt: end.toISOString(),
    daysLeft: msLeft > 0 ? Math.ceil(msLeft / DAY_MS) : 0,
    ended: msLeft <= 0,
  };
}
