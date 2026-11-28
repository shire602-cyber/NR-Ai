/*
 * What the customer chose in onboarding (WP-B), per company: the first task, where the books
 * start from, the industry chart and the go-live date. WQ7 (1.10): saved on the server
 * (GET / PUT /api/companies/:id/onboarding/progress) so it survives a device change; the
 * dashboard "Getting started" card (pages/dashboard/GettingStarted.tsx) reads the same record.
 * The completion flag stays `company.onboardingCompleted` (POST /onboarding/complete).
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export type FirstTask = "invoice" | "bank" | "bill" | "explore";
export type StartingPoint = "fresh" | "migrating" | "accountant" | "opening-balances";
export type OnboardingStep = "company" | "starting-point" | "first-task" | "done";

export interface OnboardingProgress {
  companyId: string;
  step: OnboardingStep | null;
  firstTask: FirstTask | null;
  startingPoint: StartingPoint | null;
  industry: string | null;
  /** YYYY-MM-DD the books start in Muhasib.ai (cut-over for opening balances). */
  cutoverDate: string | null;
  dismissedGettingStarted: boolean;
  updatedAt: string | null;
}

export type OnboardingProgressPatch = Partial<
  Pick<
    OnboardingProgress,
    "step" | "firstTask" | "startingPoint" | "industry" | "cutoverDate" | "dismissedGettingStarted"
  >
>;

/** Where each first task lands. */
export const FIRST_TASK_HREF: Record<FirstTask, string> = {
  invoice: "/invoices?new=1",
  bank: "/bank-accounts",
  bill: "/receipts",
  explore: "/dashboard",
};

/** The opening-balance import (D1's go-live model) with the cut-over date filled in. */
export function openingBalancesHref(cutoverDate: string | null | undefined): string {
  const q = new URLSearchParams({ kind: "trial_balance" });
  if (cutoverDate) q.set("cutover", cutoverDate);
  return `/import?${q.toString()}`;
}

export const onboardingProgressKey = (companyId: string | null | undefined) => [
  "/api/companies",
  companyId,
  "onboarding",
  "progress",
];

export function useOnboardingProgress(companyId: string | null | undefined) {
  return useQuery<OnboardingProgress>({
    queryKey: onboardingProgressKey(companyId),
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/onboarding/progress`),
    enabled: !!companyId,
    staleTime: 30_000,
  });
}

export async function saveOnboardingProgress(
  companyId: string,
  patch: OnboardingProgressPatch
): Promise<OnboardingProgress> {
  const saved: OnboardingProgress = await apiRequest(
    "PUT",
    `/api/companies/${companyId}/onboarding/progress`,
    patch
  );
  queryClient.setQueryData(onboardingProgressKey(companyId), saved);
  return saved;
}
