import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import { useDefaultCompany } from "./useDefaultCompany";
import type { TrialState } from "@shared/trial";
import {
  FEATURE_MIN_PLAN,
  type BillingCycle,
  type PaidPlanId,
  type PlanFeature,
  type PlanLimits,
  type PlanState,
} from "@shared/plans";

export interface EntitlementData {
  /** trial | active | expired; "firm" = NR-managed client books (billed through the firm). */
  state: PlanState | "firm";
  /** Plan whose features apply (the top plan during the trial); null when expired. */
  planId: PaidPlanId | null;
  storedPlanId: string;
  features: Record<PlanFeature, boolean> | null;
  limits?: PlanLimits;
  trialEndsAt?: string | null;
  /** STEP4: the plan chosen for after the trial (never changes what the company can do now). */
  chosenPlan?: ChosenPlan | null;
  activationRequestedAt?: string | null;
}

export interface ChosenPlan {
  planId: PaidPlanId;
  billingCycle: BillingCycle;
  source: string | null;
  chosenAt: string | null;
  /** Price per billing period in AED. */
  price: number;
}

interface SubscriptionData {
  subscription: {
    id: string;
    planId: string;
    planName: string;
    status: string;
    billingCycle: string;
    currentPeriodEnd: string;
    stripeCustomerId: string | null;
    invoicesCreatedThisMonth: number;
    receiptsCreatedThisMonth: number;
    aiCreditsUsedThisMonth: number;
  };
  limits: Record<string, number>;
  entitlement?: EntitlementData;
  enforcement?: boolean;
  /** False while Stripe is not configured: the plan buttons become "Contact us". */
  checkoutAvailable?: boolean;
  trial?: TrialState | null;
}

interface UsageData {
  plan: string | null;
  usage: {
    invoices: { used: number; limit: number };
    receipts: { used: number; limit: number };
    aiCredits: { used: number; limit: number };
    users: { used: number; limit: number };
    storage: { used: number | null; limit: number };
  };
}

/**
 * The company's plan as the server enforces it (server/middleware/featureGate.ts, shared/plans.ts).
 * Feature gates refuse writes only, so a module outside the plan stays open to read:
 *   canAccess(f)  — may the module be opened? (always true: data is never hidden)
 *   canWrite(f)   — may records be added or changed? (false → show the locked state)
 */
export function useSubscription() {
  const { companyId } = useDefaultCompany();

  const {
    data: subData,
    isLoading: subLoading,
    isError: subError,
  } = useQuery<SubscriptionData>({
    queryKey: ["/api/companies", companyId, "billing", "subscription"],
    // 404 = billing module not deployed in this environment; resolve null
    // instead of erroring so the UI fails open without retry noise.
    queryFn: () =>
      apiRequest("GET", `/api/companies/${companyId}/billing/subscription`).catch((err: any) => {
        if (err?.status === 404) return null;
        throw err;
      }),
    enabled: !!companyId,
    staleTime: 30000,
    retry: 1,
  });

  const { data: usageData, isLoading: usageLoading } = useQuery<UsageData>({
    queryKey: ["/api/companies", companyId, "billing", "usage"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${companyId}/billing/usage`).catch((err: any) => {
        if (err?.status === 404) return null;
        throw err;
      }),
    enabled: !!companyId,
    staleTime: 30000,
  });

  // No billing module (endpoint missing/erroring) or enforcement off means the client locks
  // nothing: the UI must never block what the API serves.
  const billingUnavailable = (subError || subData === null) && !subData;
  const enforcementOff = subData ? subData.enforcement !== true : false;
  const gatesOpen = billingUnavailable || enforcementOff;
  const entitlement = subData?.entitlement ?? null;
  const planState = entitlement?.state ?? null;
  const tierName = entitlement?.planId ?? subData?.subscription?.planId ?? "free";

  function canWrite(feature: string): boolean {
    if (gatesOpen || !entitlement?.features) return true;
    return entitlement.features[feature as PlanFeature] !== false;
  }

  /** Reading a module is never gated (WQ7): its data stays visible on every plan. */
  function canAccess(_feature: string): boolean {
    return true;
  }

  function getRequiredTier(feature: string): string {
    return FEATURE_MIN_PLAN[feature as PlanFeature] ?? "starter";
  }

  return {
    subscription: subData?.subscription,
    usage: usageData?.usage,
    limits: subData?.limits,
    entitlement,
    /** trial | active | expired | firm (null while loading or without billing). */
    planState,
    /** Plan limits are enforced (server billingEnforced()). */
    enforcement: subData?.enforcement === true,
    checkoutAvailable: subData?.checkoutAvailable === true,
    trial: subData?.trial ?? null,
    chosenPlan: entitlement?.chosenPlan ?? null,
    activationRequestedAt: entitlement?.activationRequestedAt ?? null,
    tierName,
    /** Trial over without a plan, with enforcement on: the workspace is read-only. */
    isReadOnly: !gatesOpen && planState === "expired",
    /** @deprecated there is no free plan; kept for older callers (true = read-only workspace). */
    isFreeTier: !gatesOpen && planState === "expired",
    canAccess,
    canWrite,
    getRequiredTier,
    isLoading: subLoading || usageLoading,
  };
}

/** STEP4: the customer's mutations on their after-trial choice; both refresh the subscription. */
export function usePlanChoiceActions() {
  const { companyId } = useDefaultCompany();
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["/api/companies", companyId, "billing", "subscription"],
    });
  const choose = useMutation({
    mutationFn: (body: { planId: PaidPlanId; billingCycle: BillingCycle }) =>
      apiRequest("PUT", `/api/companies/${companyId}/billing/chosen-plan`, body),
    onSuccess: refresh,
  });
  const activate = useMutation({
    mutationFn: (note?: string) =>
      apiRequest(
        "POST",
        `/api/companies/${companyId}/billing/activation-request`,
        note ? { note } : {}
      ),
    onSuccess: refresh,
  });
  return { choose, activate };
}
