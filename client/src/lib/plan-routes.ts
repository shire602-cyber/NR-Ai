import type { PlanFeature } from "@shared/plans";

/**
 * App routes of the modules plans differ on (shared/plans.ts FEATURE_MIN_PLAN). The sidebar marks
 * these with a lock and the page shows a read-only banner with an upgrade prompt when the
 * company's plan does not include them; the server refuses the writes
 * (server/middleware/featureGate.ts PLAN_FEATURE_RULES). Data is never hidden.
 */
export const PLAN_ROUTE_FEATURES: ReadonlyArray<readonly [prefix: string, feature: PlanFeature]> = [
  ["/payroll", "payroll"],
  ["/employees", "payroll"],
  ["/fixed-assets", "fixedAssets"],
  ["/budgets", "budgets"],
  ["/month-end", "monthEnd"],
  ["/cost-centers", "costCenters"],
  ["/purchase-orders", "purchaseOrders"],
  ["/expense-claims", "expenseClaims"],
  ["/corporate-tax", "corporateTax"],
  ["/settings/developer", "apiAccess"],
  ["/developer", "apiAccess"],
];

/** The plan feature a route belongs to, or null for the core (every plan) and settings. */
export function featureForRoute(path: string): PlanFeature | null {
  const p = path.split("?")[0];
  for (const [prefix, feature] of PLAN_ROUTE_FEATURES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return feature;
  }
  return null;
}

/** Catalog key of a gated module's name (components namespace). */
export function planFeatureLabelKey(feature: PlanFeature): string {
  return `components.planFeature_${feature}`;
}

/** Pages a read-only workspace still uses fully (choosing a plan, settings, help). */
export const PLAN_LOCK_ALWAYS_OPEN = [
  "/subscription",
  "/settings",
  "/onboarding",
  "/help",
  "/profile",
];
