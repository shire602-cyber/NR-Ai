// The one place plan prices live. The public pages (client/src/lib/plan-catalog.ts)
// and the billing API (server/middleware/featureGate.ts getAllPlanDefinitions)
// both read from here, so a price can never be shown differently in two places.
// Stripe charges whatever price object STRIPE_PRICE_* points at; keep those in
// step with this file when the owner changes a number.

export type PlanPriceId = "free" | "starter" | "professional" | "enterprise";

/** AED per month, ex VAT. `yearly` is the per-month price when billed yearly. */
export const PLAN_PRICES: Record<PlanPriceId, { monthly: number; yearly: number }> = {
  free: { monthly: 0, yearly: 0 },
  starter: { monthly: 49, yearly: 39 },
  professional: { monthly: 149, yearly: 119 },
  enterprise: { monthly: 299, yearly: 239 },
};

export const PLAN_PRICE_CURRENCY = "AED";
