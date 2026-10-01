// Single source of truth for what the PUBLIC pages (landing "/" and /pricing)
// say about plans: prices, usage limits, which feature unlocks on which plan,
// and the trial. The server's plan gates (server/middleware/featureGate.ts) and
// trial rules (server/services/billing-plan.ts) are the real authority;
// tests/unit/public-claims.test.ts fails if this file drifts from them.
//
// Prices are set by the owner. Change them here, in one place, and both public
// pages follow.

export type PlanId = "free" | "starter" | "professional" | "enterprise";

export const PLAN_IDS: readonly PlanId[] = ["free", "starter", "professional", "enterprise"];

/** Marker for "no cap" in {@link PLAN_LIMITS}, same convention as the server. */
export const UNLIMITED = -1;

/** The free trial every new company starts: server/services/billing-plan.ts. */
export const TRIAL_DAYS = 14;
export const TRIAL_PLAN_ID: PlanId = "professional";

/** AED per month, ex VAT. Defined once in shared/plan-prices.ts (the billing API reads the same file). */
export { PLAN_PRICES } from "../../../shared/plan-prices";

export interface PlanLimits {
  maxUsers: number;
  maxCompanies: number;
  maxInvoicesPerMonth: number;
  maxReceiptsPerMonth: number;
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: { maxUsers: 1, maxCompanies: 1, maxInvoicesPerMonth: 20, maxReceiptsPerMonth: 20 },
  starter: { maxUsers: 3, maxCompanies: 1, maxInvoicesPerMonth: 200, maxReceiptsPerMonth: 200 },
  professional: {
    maxUsers: 10,
    maxCompanies: 3,
    maxInvoicesPerMonth: UNLIMITED,
    maxReceiptsPerMonth: UNLIMITED,
  },
  enterprise: {
    maxUsers: UNLIMITED,
    maxCompanies: UNLIMITED,
    maxInvoicesPerMonth: UNLIMITED,
    maxReceiptsPerMonth: UNLIMITED,
  },
};

/**
 * Features the server gates by plan (TIER_FEATURES) that the pricing page
 * advertises, mapped to the lowest plan that includes them. Everything else the
 * product does (VAT 201 and filing evidence, corporate tax, AI bookkeeping,
 * month-end and year-end close...) is not gated by plan today and is listed as
 * "included on every plan".
 */
export type GatedFeature =
  | "quotes"
  | "creditNotes"
  | "purchaseOrders"
  | "invoiceTemplates"
  | "bankImport"
  | "bulkOps"
  | "advancedReports"
  | "apiAccess"
  | "recurringInvoices"
  | "multiCurrency"
  | "payroll"
  | "fixedAssets"
  | "costCenters";

export const FEATURE_MIN_PLAN: Record<GatedFeature, PlanId> = {
  recurringInvoices: "starter",
  quotes: "starter",
  creditNotes: "starter",
  invoiceTemplates: "starter",
  multiCurrency: "starter",
  bankImport: "starter",
  purchaseOrders: "professional",
  bulkOps: "professional",
  costCenters: "professional",
  fixedAssets: "professional",
  advancedReports: "professional",
  payroll: "professional",
  apiAccess: "enterprise",
};

export function planIncludes(plan: PlanId, feature: GatedFeature): boolean {
  return PLAN_IDS.indexOf(plan) >= PLAN_IDS.indexOf(FEATURE_MIN_PLAN[feature]);
}
