// Free trial (owner decision, X6b): every new company gets a free trial of all features, no card
// required. The trial start is the company's subscription row creation time (existing companies
// count from when their row was created). Nothing is locked when the trial ends: the app shows
// "Your trial has ended — contact us to choose a plan" until the owner decides on enforcement.
// Cost/abuse caps (AI credits, storage, companies per user) apply regardless of the trial.

/** Length of the free trial in days. The one place the public claim and the app read. */
export const TRIAL_DAYS = 14;

/** What happens when the trial ends. "contact" = banner only, no lock and no blocked features. */
export const TRIAL_END_BEHAVIOUR = "contact" as const;

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
