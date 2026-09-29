// Pure billing rules: which plan is a company effectively on right now?
// No I/O. featureGate, the billing status endpoint and the Stripe webhook all
// share this so "what would enforcement do" has exactly one answer.

export const TRIAL_DAYS = 14;
/** The plan the pricing page advertises the 14-day trial on (the "most popular" tier). */
export const TRIAL_PLAN = "professional";
export const PAST_DUE_GRACE_DAYS = 7;
export const TOP_PLAN = "enterprise";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanState =
  | "paid"
  | "trial"
  | "trial_expired"
  | "grace"
  | "grandfathered"
  | "managed"
  | "free";

export interface SubscriptionLike {
  planId?: string | null;
  status?: string | null;
  currentPeriodEnd?: Date | string | null;
  trialEndsAt?: Date | string | null;
}

export interface EffectivePlan {
  planId: string;
  state: PlanState;
  /** Whole days left in an active trial, 0 otherwise. */
  daysLeft: number;
  trialEndsAt: Date | null;
}

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function resolveEffectivePlan(input: {
  subscription: SubscriptionLike | null | undefined;
  now: Date;
  company?: { createdAt?: Date | string | null; companyType?: string | null } | null;
  grandfatherBefore?: Date | null;
}): EffectivePlan {
  const { subscription, now, company, grandfatherBefore } = input;
  const nowMs = now.getTime();
  const trialEndsAt = toDate(subscription?.trialEndsAt);
  const base = { daysLeft: 0, trialEndsAt };

  // 1. Owner-controlled escape hatch for existing customers when enforcement is switched on.
  const createdAt = toDate(company?.createdAt);
  if (grandfatherBefore && createdAt && createdAt.getTime() < grandfatherBefore.getTime()) {
    return { ...base, planId: TOP_PLAN, state: "grandfathered" };
  }

  // 2. Companies a firm manages for its clients are covered by the firm's arrangement.
  if (company?.companyType === "client") {
    return { ...base, planId: TOP_PLAN, state: "managed" };
  }

  if (!subscription) return { ...base, planId: "free", state: "free" };

  const planId = subscription.planId || "free";
  const status = subscription.status || "active";
  const periodEnd = toDate(subscription.currentPeriodEnd);

  if (status === "trialing") {
    if (trialEndsAt && nowMs < trialEndsAt.getTime()) {
      return {
        planId,
        state: "trial",
        trialEndsAt,
        daysLeft: Math.max(1, Math.ceil((trialEndsAt.getTime() - nowMs) / DAY_MS)),
      };
    }
    return { ...base, planId: "free", state: "trial_expired" };
  }

  if (planId === "free") return { ...base, planId: "free", state: "free" };

  if (status === "past_due") {
    const graceEnd = periodEnd ? periodEnd.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS : 0;
    return nowMs < graceEnd
      ? { ...base, planId, state: "grace" }
      : { ...base, planId: "free", state: "free" };
  }

  if (status === "cancelled") {
    return periodEnd && nowMs < periodEnd.getTime()
      ? { ...base, planId, state: "paid" }
      : { ...base, planId: "free", state: "free" };
  }

  // "active" (and any unrecognised status Stripe may add) with a paid plan.
  return { ...base, planId, state: "paid" };
}

/** Trial runs from the company's creation, so companies that predate billing start already expired. */
export function buildTrialWindow(companyCreatedAt: Date): { start: Date; end: Date } {
  const start = new Date(companyCreatedAt.getTime());
  return { start, end: new Date(start.getTime() + TRIAL_DAYS * DAY_MS) };
}

/** BILLING_GRANDFATHER_BEFORE: an ISO date; blank or unparseable means "off". */
export function parseGrandfatherDate(value: string | undefined | null): Date | null {
  if (!value || !value.trim()) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}
