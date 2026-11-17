/*
 * What the customer chose in onboarding (WP-B), per company, for the dashboard "Getting started"
 * card (WP-C, client/src/pages/dashboard/GettingStarted.tsx) to read: the first task, where the
 * books start from, and when onboarding finished. Kept in this browser only; the server-side
 * completion flag stays `company.onboardingCompleted` (POST /onboarding/complete).
 */

export type FirstTask = "invoice" | "bank" | "bill" | "explore";
export type StartingPoint = "fresh" | "migrating" | "accountant";

export interface OnboardingRecord {
  firstTask?: FirstTask;
  startingPoint?: StartingPoint;
  /** YYYY-MM-DD the books start in Muhasib.ai (moving from another system). */
  goLiveDate?: string;
  /** Email of the accountant invited during onboarding. */
  accountantInvited?: string;
  /** ISO time onboarding finished in this browser. */
  completedAt?: string;
}

/** Where each first task lands. */
export const FIRST_TASK_HREF: Record<FirstTask, string> = {
  invoice: "/invoices?new=1",
  bank: "/bank-accounts",
  bill: "/receipts",
  explore: "/dashboard",
};

const key = (companyId: string) => `muhasib:onboarding:${companyId}`;

export function readOnboardingRecord(companyId: string | null | undefined): OnboardingRecord {
  if (!companyId) return {};
  try {
    const raw = localStorage.getItem(key(companyId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as OnboardingRecord) : {};
  } catch {
    return {};
  }
}

export function writeOnboardingRecord(
  companyId: string | null | undefined,
  patch: OnboardingRecord
): OnboardingRecord {
  if (!companyId) return patch;
  const next = { ...readOnboardingRecord(companyId), ...patch };
  try {
    localStorage.setItem(key(companyId), JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode): the dashboard simply shows the default card */
  }
  return next;
}
