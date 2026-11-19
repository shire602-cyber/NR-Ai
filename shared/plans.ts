/*
 * The one plan module (WQ7). Every surface that names a plan, a price, a feature gate or a limit
 * reads this file: the public pricing page and the landing strip (client/src/components/marketing/
 * plans.ts re-exports from here), the in-app subscription page, the server gates
 * (server/middleware/featureGate.ts), GET /api/billing/plans and the Stripe price-id map.
 *
 * Owner decisions (2026-11-18):
 *   - three paid plans, no free plan; unlimited users on every plan;
 *   - billed monthly or yearly; yearly = 10 × monthly (two months free); no quarterly;
 *   - a 14-day free trial of the top plan, no card (shared/trial.ts); then choose a plan;
 *   - plan limits are enforced: a module the plan does not include is read-only (its data stays
 *     readable, nothing is deleted); after the trial without a plan every module is read-only.
 *
 * The stored `subscriptions.plan_id` for a company without a paid plan is the legacy value
 * "free" (NO_PLAN_ID): it means "trial, then no plan", never a Free plan with its own limits.
 */
import { TRIAL_DAYS } from "./trial";

export const PAID_PLAN_IDS = ["starter", "professional", "enterprise"] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

/** Stored plan id of a company without a paid plan (trial, then no plan). */
export const NO_PLAN_ID = "free";
/** The trial runs on the top plan. */
export const TOP_PLAN_ID: PaidPlanId = "enterprise";

export type BillingCycle = "monthly" | "yearly";
export const BILLING_CYCLES: readonly BillingCycle[] = ["monthly", "yearly"];
/** Months charged for a year paid up front (two months free). */
export const YEARLY_MONTHS_CHARGED = 10;

export const PLAN_CURRENCY = "AED";

/**
 * Feature flags. `bookkeeping` is the core (sales, purchases, banking, ledger, VAT, inventory)
 * that every paid plan includes; it is what a company with no plan after its trial loses (writes
 * only). The rest are the modules plans differ on, plus the all-plan modules older route-level
 * gates still name.
 */
export const PLAN_FEATURES = [
  "bookkeeping",
  "quotes",
  "creditNotes",
  "invoiceTemplates",
  "bankImport",
  "invoicePayment",
  "recurringInvoices",
  "multiCurrency",
  "advancedReports",
  "purchaseOrders",
  "costCenters",
  "budgets",
  "monthEnd",
  "fixedAssets",
  "expenseClaims",
  "bulkOps",
  "customerPortal",
  "corporateTax",
  "payroll",
  "aiAssistant",
  "apiAccess",
  "webhooks",
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

/** Lowest plan that includes each feature (every higher plan includes it too). */
export const FEATURE_MIN_PLAN: Record<PlanFeature, PaidPlanId> = {
  bookkeeping: "starter",
  quotes: "starter",
  creditNotes: "starter",
  invoiceTemplates: "starter",
  bankImport: "starter",
  invoicePayment: "starter",
  recurringInvoices: "starter",
  multiCurrency: "starter",
  advancedReports: "starter",
  purchaseOrders: "professional",
  costCenters: "professional",
  budgets: "professional",
  monthEnd: "professional",
  fixedAssets: "professional",
  expenseClaims: "professional",
  bulkOps: "professional",
  customerPortal: "professional",
  corporateTax: "professional",
  payroll: "professional",
  aiAssistant: "professional",
  apiAccess: "enterprise",
  webhooks: "enterprise",
};

/** -1 = unlimited. */
export interface PlanLimits {
  maxUsers: number;
  /** Companies a user may own (the best plan across the companies they own). */
  maxCompanies: number;
  maxInvoicesPerMonth: number;
  maxReceiptsPerMonth: number;
  aiCreditsPerMonth: number;
  maxStorageMb: number;
}

export const UNLIMITED = -1;

export interface PlanDefinition {
  id: PaidPlanId;
  /** Price per month in AED when billed monthly (VAT included). */
  monthlyPrice: number;
  featured?: boolean;
  /** "trial" opens a workspace (/register); "contact" writes to us. */
  cta: "trial" | "contact";
  limits: PlanLimits;
}

/**
 * THE PRICES (AED per month, VAT included): the one line to change when the owner approves new
 * prices. Every surface reads it: /pricing, the landing strip, Settings › Billing, GET
 * /api/billing/plans and the Stripe amounts (tests/unit/wq7-stripe-plan-map.test.ts, tests/unit/trial-pricing.test.ts and
 * tests/db/step3-price-editor-removed.test.ts). Yearly is
 * always 10 × monthly. Owner-approved 2026-11-18: 59 / 119 / 229 monthly, 590 / 1,190 / 2,290
 * yearly.
 */
// prettier-ignore
export const PLAN_MONTHLY_PRICES: Record<PaidPlanId, number> = { starter: 59, professional: 119, enterprise: 229 };

export const PLAN_DEFINITIONS: readonly PlanDefinition[] = [
  {
    id: "starter",
    monthlyPrice: PLAN_MONTHLY_PRICES.starter,
    cta: "trial",
    limits: {
      maxUsers: UNLIMITED,
      maxCompanies: 1,
      maxInvoicesPerMonth: 200,
      maxReceiptsPerMonth: 200,
      aiCreditsPerMonth: 50,
      maxStorageMb: 5120,
    },
  },
  {
    id: "professional",
    monthlyPrice: PLAN_MONTHLY_PRICES.professional,
    featured: true,
    cta: "trial",
    limits: {
      maxUsers: UNLIMITED,
      maxCompanies: 3,
      maxInvoicesPerMonth: UNLIMITED,
      maxReceiptsPerMonth: UNLIMITED,
      aiCreditsPerMonth: 500,
      maxStorageMb: 25600,
    },
  },
  {
    id: "enterprise",
    monthlyPrice: PLAN_MONTHLY_PRICES.enterprise,
    cta: "contact",
    limits: {
      maxUsers: UNLIMITED,
      maxCompanies: UNLIMITED,
      maxInvoicesPerMonth: UNLIMITED,
      maxReceiptsPerMonth: UNLIMITED,
      aiCreditsPerMonth: UNLIMITED,
      maxStorageMb: UNLIMITED,
    },
  },
];

/**
 * The trial is the top plan's features and document limits. Three cost / abuse caps stay finite
 * during a trial (no card is taken, so unlimited AI, storage or companies would be free for
 * anyone who signs up again): AI credits, storage and companies per user.
 */
export const TRIAL_LIMITS: PlanLimits = {
  maxUsers: UNLIMITED,
  maxCompanies: 3,
  maxInvoicesPerMonth: UNLIMITED,
  maxReceiptsPerMonth: UNLIMITED,
  aiCreditsPerMonth: 100,
  maxStorageMb: 1024,
};

/** After the trial without a plan: nothing new is created; existing data stays readable. */
export const NO_PLAN_LIMITS: PlanLimits = {
  maxUsers: UNLIMITED,
  maxCompanies: 0,
  maxInvoicesPerMonth: 0,
  maxReceiptsPerMonth: 0,
  aiCreditsPerMonth: 0,
  maxStorageMb: 0,
};

const ORDER: readonly PaidPlanId[] = PAID_PLAN_IDS;

export function isPaidPlanId(id: unknown): id is PaidPlanId {
  return typeof id === "string" && (PAID_PLAN_IDS as readonly string[]).includes(id);
}

export function planDefinition(id: PaidPlanId): PlanDefinition {
  return PLAN_DEFINITIONS.find((p) => p.id === id)!;
}

export function planRank(id: PaidPlanId): number {
  return ORDER.indexOf(id);
}

export function planIncludes(id: PaidPlanId, feature: PlanFeature): boolean {
  return planRank(id) >= planRank(FEATURE_MIN_PLAN[feature]);
}

export function planFeatures(id: PaidPlanId): Record<PlanFeature, boolean> {
  return Object.fromEntries(PLAN_FEATURES.map((f) => [f, planIncludes(id, f)])) as Record<
    PlanFeature,
    boolean
  >;
}

const NO_FEATURES = Object.fromEntries(PLAN_FEATURES.map((f) => [f, false])) as Record<
  PlanFeature,
  boolean
>;

/** Price per billing period in AED: the month's price, or the year's (10 × monthly). */
export function planPrice(id: PaidPlanId, cycle: BillingCycle): number {
  const monthly = planDefinition(id).monthlyPrice;
  return cycle === "yearly" ? monthly * YEARLY_MONTHS_CHARGED : monthly;
}

/** Whole months free for a year paid up front (2). */
export const YEARLY_FREE_MONTHS = 12 - YEARLY_MONTHS_CHARGED;

// ── Entitlement: what a company may do right now ─────────────────────────────────────────────

/**
 * trial   — no paid plan, inside the trial: the top plan's features (TRIAL_LIMITS caps).
 * active  — on a paid plan: that plan's features and limits.
 * expired — no paid plan, trial over: read-only (no features, NO_PLAN_LIMITS).
 */
export type PlanState = "trial" | "active" | "expired";

export interface Entitlement {
  state: PlanState;
  /** The plan whose features apply (the top plan during the trial); null when expired. */
  planId: PaidPlanId | null;
  features: Record<PlanFeature, boolean>;
  limits: PlanLimits;
  trialEndsAt: string | null;
}

/** Subscription statuses that keep a paid plan's entitlement (past_due keeps a grace period). */
const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EntitlementInput {
  planId: string | null | undefined;
  status?: string | null;
  /** When the trial started (the subscription row's, else the company's, creation time). */
  trialStartedAt?: string | Date | null;
  /** Explicit trial end (an NR admin may extend a trial); else start + TRIAL_DAYS. */
  trialEndsAt?: string | Date | null;
}

export function trialEnd(input: EntitlementInput): Date | null {
  if (input.trialEndsAt) {
    const d = new Date(input.trialEndsAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (!input.trialStartedAt) return null;
  const start = new Date(input.trialStartedAt);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + TRIAL_DAYS * DAY_MS);
}

/** Pure entitlement rule (the server gates and the subscription API both call it). */
export function resolveEntitlement(input: EntitlementInput, now: Date = new Date()): Entitlement {
  const status = (input.status ?? "active").toLowerCase();
  if (isPaidPlanId(input.planId) && ENTITLED_STATUSES.has(status)) {
    return {
      state: "active",
      planId: input.planId,
      features: planFeatures(input.planId),
      limits: { ...planDefinition(input.planId).limits },
      trialEndsAt: null,
    };
  }
  const end = trialEnd(input);
  if (end && end.getTime() > now.getTime()) {
    return {
      state: "trial",
      planId: TOP_PLAN_ID,
      features: planFeatures(TOP_PLAN_ID),
      limits: { ...TRIAL_LIMITS },
      trialEndsAt: end.toISOString(),
    };
  }
  return {
    state: "expired",
    planId: null,
    features: { ...NO_FEATURES },
    limits: { ...NO_PLAN_LIMITS },
    trialEndsAt: end ? end.toISOString() : null,
  };
}

/** Lowest plan that unlocks `feature` (the upgrade hint). */
export function requiredPlanFor(feature: PlanFeature): PaidPlanId {
  return FEATURE_MIN_PLAN[feature];
}

/** Lowest plan whose limit for `key` is above `used` (null when no plan offers more). */
export function planWithMoreOf(key: keyof PlanLimits, used: number): PaidPlanId | null {
  for (const p of PLAN_DEFINITIONS) {
    const limit = p.limits[key];
    if (limit === UNLIMITED || limit > used) return p.id;
  }
  return null;
}

/** Public JSON for GET /api/billing/plans (the pricing page renders the same values). */
export function publicPlanCatalog() {
  return {
    currency: PLAN_CURRENCY,
    cycles: BILLING_CYCLES,
    yearlyMonthsCharged: YEARLY_MONTHS_CHARGED,
    trial: { days: TRIAL_DAYS, planId: TOP_PLAN_ID, cardRequired: false },
    plans: PLAN_DEFINITIONS.map((p) => ({
      id: p.id,
      featured: !!p.featured,
      pricing: {
        monthly: planPrice(p.id, "monthly"),
        yearly: planPrice(p.id, "yearly"),
        currency: PLAN_CURRENCY,
      },
      features: planFeatures(p.id),
      limits: { ...p.limits },
    })),
  };
}
