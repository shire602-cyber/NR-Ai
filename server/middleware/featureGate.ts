import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { PLAN_PRICES, PLAN_PRICE_CURRENCY, type PlanPriceId } from "../../shared/plan-prices";
import { createLogger } from "../config/logger";
import { ensureSubscription } from "../services/billing-trial.service";
import { countMonthlyUsage, type CountedResource } from "../services/usage-counts.service";
import {
  parseGrandfatherDate,
  resolveEffectivePlan,
  type EffectivePlan,
} from "../services/billing-plan";

const log = createLogger("feature-gate");

// ===========================
// Tier Feature Map
// ===========================
const TIER_FEATURES: Record<string, Record<string, boolean>> = {
  free: {
    quotes: false,
    creditNotes: false,
    purchaseOrders: false,
    invoiceTemplates: false,
    bankImport: false,
    bulkOps: false,
    advancedReports: false,
    apiAccess: false,
    invoicePayment: false,
    recurringInvoices: false,
    multiCurrency: false,
    payroll: false,
    webhooks: false,
    fixedAssets: false,
    costCenters: false,
  },
  starter: {
    quotes: true,
    creditNotes: true,
    purchaseOrders: false,
    invoiceTemplates: true,
    bankImport: true,
    bulkOps: false,
    advancedReports: false,
    apiAccess: false,
    invoicePayment: true,
    recurringInvoices: true,
    multiCurrency: true,
    payroll: false,
    webhooks: false,
    fixedAssets: false,
    costCenters: false,
  },
  professional: {
    quotes: true,
    creditNotes: true,
    purchaseOrders: true,
    invoiceTemplates: true,
    bankImport: true,
    bulkOps: true,
    advancedReports: true,
    apiAccess: false,
    invoicePayment: true,
    recurringInvoices: true,
    multiCurrency: true,
    payroll: true,
    webhooks: false,
    fixedAssets: true,
    costCenters: true,
  },
  enterprise: {
    quotes: true,
    creditNotes: true,
    purchaseOrders: true,
    invoiceTemplates: true,
    bankImport: true,
    bulkOps: true,
    advancedReports: true,
    apiAccess: true,
    invoicePayment: true,
    recurringInvoices: true,
    multiCurrency: true,
    payroll: true,
    webhooks: true,
    fixedAssets: true,
    costCenters: true,
  },
};

const TIER_LIMITS: Record<string, Record<string, number>> = {
  free: {
    maxUsers: 1,
    maxCompanies: 1,
    maxInvoicesPerMonth: 20,
    maxReceiptsPerMonth: 20,
    aiCreditsPerMonth: 10,
    maxStorageMb: 500,
  },
  starter: {
    maxUsers: 3,
    maxCompanies: 1,
    maxInvoicesPerMonth: 200,
    maxReceiptsPerMonth: 200,
    aiCreditsPerMonth: 50,
    maxStorageMb: 5120,
  },
  professional: {
    maxUsers: 10,
    maxCompanies: 3,
    maxInvoicesPerMonth: -1, // unlimited
    maxReceiptsPerMonth: -1,
    aiCreditsPerMonth: 500,
    maxStorageMb: 25600,
  },
  enterprise: {
    maxUsers: -1,
    maxCompanies: -1,
    maxInvoicesPerMonth: -1,
    maxReceiptsPerMonth: -1,
    aiCreditsPerMonth: -1,
    maxStorageMb: -1,
  },
};

const TIER_ORDER = ["free", "starter", "professional", "enterprise"];

// Minimum tier that unlocks each feature
const FEATURE_MIN_TIER: Record<string, string> = {};
for (const feature of Object.keys(TIER_FEATURES.free)) {
  for (const tier of TIER_ORDER) {
    if (TIER_FEATURES[tier][feature]) {
      FEATURE_MIN_TIER[feature] = tier;
      break;
    }
  }
}

interface RequestPlan {
  subscription: any | null;
  effective: EffectivePlan;
}

/**
 * Resolve (once per request) what plan the current request's company is
 * effectively on: paid > unexpired trial > free, with the firm-managed and
 * grandfathering rules. A company with no subscription row gets a trial
 * created lazily, counted from its creation date. Returns null when the request
 * names no company or the lookup fails (gates then stay out of the way).
 */
async function getRequestPlan(req: Request): Promise<RequestPlan | null> {
  const cached = (req as any).billingPlan as RequestPlan | undefined;
  if (cached) return cached;

  const companyId = req.params.companyId || req.body?.companyId;
  if (!companyId) return null;

  try {
    const company = await storage.getCompany(companyId);
    let subscription: any = (await storage.getSubscription(companyId)) ?? null;
    if (!subscription && company && company.companyType !== "client") {
      subscription = (await ensureSubscription(companyId, { company })) ?? null;
    }
    if (subscription) req.subscription = subscription;

    const effective = resolveEffectivePlan({
      subscription,
      now: new Date(),
      company,
      grandfatherBefore: parseGrandfatherDate(process.env.BILLING_GRANDFATHER_BEFORE),
    });
    const resolved = { subscription, effective };
    (req as any).billingPlan = resolved;
    return resolved;
  } catch (error) {
    log.error({ error, companyId }, "Failed to resolve billing plan");
    return null;
  }
}

// Tier enforcement policy:
// - Gates BLOCK only when BILLING_ENFORCEMENT=true. That is the last switch the
//   owner flips (after Stripe keys, price ids and BILLING_GRANDFATHER_BEFORE).
// - Otherwise nothing is blocked, but a request that WOULD have been blocked
//   carries `X-Billing-Would-Block: <feature>` and is logged at INFO, so the
//   impact of enforcement is visible before it is switched on. Configuring
//   Stripe does NOT switch enforcement on.
export function billingEnforced(): boolean {
  return process.env.BILLING_ENFORCEMENT === "true";
}

/** Call once at startup so the effective billing posture is loud and explicit. */
export function logBillingEnforcementStatus(): void {
  const grandfather = parseGrandfatherDate(process.env.BILLING_GRANDFATHER_BEFORE);
  if (billingEnforced()) {
    log.info(
      { grandfatherBefore: grandfather?.toISOString() ?? null },
      "Billing tier enforcement is ACTIVE - companies without a paid plan or live trial are gated from paid features."
    );
  } else {
    log.warn(
      { grandfatherBefore: grandfather?.toISOString() ?? null },
      "Billing tier enforcement is OFF (BILLING_ENFORCEMENT is not 'true') - paid features are open to every tenant. " +
        "Requests that enforcement would block are flagged with the X-Billing-Would-Block response header."
    );
  }
}

/** Record that enforcement (if on) would have blocked this request. */
function flagWouldBlock(req: Request, res: Response, label: string, plan: EffectivePlan): void {
  const previous = res.getHeader("X-Billing-Would-Block");
  res.setHeader("X-Billing-Would-Block", previous ? `${previous}, ${label}` : label);
  log.info(
    { label, plan: plan.planId, state: plan.state, companyId: req.params.companyId, url: req.originalUrl?.split("?")[0] },
    "Billing enforcement would block this request"
  );
}

export function requireFeature(feature: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const plan = await getRequestPlan(req);
    if (!plan) {
      next();
      return;
    }

    const planId = plan.effective.planId;
    const tierFeatures = TIER_FEATURES[planId] || TIER_FEATURES.free;
    if (tierFeatures[feature]) {
      next();
      return;
    }

    if (!billingEnforced()) {
      flagWouldBlock(req, res, feature, plan.effective);
      next();
      return;
    }

    res.status(403).json({
      message: "Upgrade required to access this feature",
      code: "TIER_LOCKED",
      feature,
      currentTier: planId,
      requiredTier: FEATURE_MIN_TIER[feature] || "starter",
      ...(plan.effective.state === "trial_expired" ? { reason: "TRIAL_EXPIRED" } : {}),
    });
  };
}

/**
 * Middleware: Require minimum tier level.
 */
export function requireTier(minimumTier: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const plan = await getRequestPlan(req);
    if (!plan) {
      next();
      return;
    }

    const currentTier = plan.effective.planId;
    if (TIER_ORDER.indexOf(currentTier) >= TIER_ORDER.indexOf(minimumTier)) {
      next();
      return;
    }

    if (!billingEnforced()) {
      flagWouldBlock(req, res, `tier:${minimumTier}`, plan.effective);
      next();
      return;
    }

    res.status(403).json({
      message: `This feature requires the ${minimumTier} plan or higher`,
      code: "TIER_LOCKED",
      currentTier,
      requiredTier: minimumTier,
      ...(plan.effective.state === "trial_expired" ? { reason: "TRIAL_EXPIRED" } : {}),
    });
  };
}

/**
 * Middleware: refuse a creation once the company's plan cap for the month is used up.
 *
 * Wired on invoice and receipt creation (the monthly caps in TIER_LIMITS). Policy, like the
 * feature gates: it only BLOCKS when BILLING_ENFORCEMENT=true; otherwise a request that would
 * have been blocked is flagged with `X-Billing-Would-Block: usage:<resource>` and goes through.
 * Usage is counted from the rows created this calendar month (usage-counts.service), so there is
 * no stored counter to drift or reset. Any failure while resolving the plan or counting fails
 * OPEN: accounting a quota must never stop real work.
 */
export function checkUsageLimit(resource: CountedResource) {
  const limitKey = resource === "invoices" ? "maxInvoicesPerMonth" : "maxReceiptsPerMonth";
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const plan = await getRequestPlan(req);
      const companyId = req.params.companyId || req.body?.companyId;
      if (!plan || !companyId) {
        next();
        return;
      }

      const planId = plan.effective.planId;
      const limit = (TIER_LIMITS[planId] || TIER_LIMITS.free)[limitKey];
      if (limit === -1) {
        next();
        return;
      }

      // Never describe another tenant's usage: a caller without access falls through to the
      // route's own 403.
      const userId = (req as any).user?.id;
      if (!userId || !(await storage.hasCompanyAccess(userId, companyId))) {
        next();
        return;
      }

      const currentUsage = await countMonthlyUsage(companyId, resource);
      if (currentUsage < limit) {
        next();
        return;
      }

      if (!billingEnforced()) {
        flagWouldBlock(req, res, `usage:${resource}`, plan.effective);
        next();
        return;
      }

      res.status(403).json({
        message: `Your ${planId} plan allows ${limit} ${resource} per month and ${currentUsage} have been created this month. Upgrade your plan for more.`,
        code: "USAGE_LIMIT_REACHED",
        details: { resource, limit, currentUsage, planId },
        ...(plan.effective.state === "trial_expired" ? { reason: "TRIAL_EXPIRED" } : {}),
      });
    } catch (error) {
      log.warn({ error }, "Usage limit check failed open");
      next();
    }
  };
}

/**
 * H8 — enforce the per-user company quota.
 *
 * `maxCompanies` was declared in every tier and read nowhere, so the free-tier
 * caps (1 user, 20 invoices/month) were trivially bypassed: create another
 * company and get another quota, indefinitely.
 *
 * Deliberate carve-outs, because the limit must not break real work:
 *   - Platform admins are exempt.
 *   - Firm users (any firmRole) are exempt — managing many client companies is
 *     the entire product for them, and firm seats are priced separately.
 *   - Skipped entirely when billing enforcement is off (pre-billing / dev),
 *     matching checkUsageLimit's behaviour.
 *
 * The user's entitlement is the HIGHEST tier across the companies they own, so
 * upgrading any one company lifts the cap rather than trapping them.
 */
export function checkCompanyQuota() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!billingEnforced()) {
      next();
      return;
    }
    const user = (req as any).user;
    if (!user?.id || user.isAdmin === true || user.firmRole) {
      next();
      return;
    }

    try {
      const { storage } = await import("../storage");
      const owned = await storage.getCompaniesByUserId(user.id);
      if (!Array.isArray(owned) || owned.length === 0) {
        next();
        return;
      }

      // Highest tier the user holds across owned companies.
      let bestTierIdx = 0;
      for (const c of owned) {
        try {
          const sub = await storage.getSubscription((c as any).id);
          const effective = resolveEffectivePlan({
            subscription: sub,
            now: new Date(),
            company: c as any,
            grandfatherBefore: parseGrandfatherDate(process.env.BILLING_GRANDFATHER_BEFORE),
          });
          const idx = TIER_ORDER.indexOf(effective.planId);
          if (idx > bestTierIdx) bestTierIdx = idx;
        } catch {
          /* a missing subscription just means free */
        }
      }
      const planId = TIER_ORDER[bestTierIdx] || "free";
      const limit = (TIER_LIMITS[planId] || TIER_LIMITS.free).maxCompanies;

      if (limit === -1 || owned.length < limit) {
        next();
        return;
      }

      res.status(403).json({
        message: `Your ${planId} plan allows ${limit} ${limit === 1 ? "company" : "companies"}. You already have ${owned.length}. Upgrade to add more.`,
        code: "COMPANY_LIMIT_REACHED",
        details: { planId, limit, current: owned.length },
      });
    } catch (err) {
      // Never let quota accounting break company creation.
      log.warn({ err }, "Company quota check failed open");
      next();
    }
  };
}

/**
 * Get tier limits for a given plan.
 */
export function getTierLimits(planId: string) {
  return TIER_LIMITS[planId] || TIER_LIMITS.free;
}

/**
 * Get tier features for a given plan.
 */
export function getTierFeatures(planId: string) {
  return TIER_FEATURES[planId] || TIER_FEATURES.free;
}

/**
 * Get all plan definitions (for public API / pricing page).
 */
export function getAllPlanDefinitions() {
  return TIER_ORDER.map((tier) => ({
    id: tier,
    name: tier.charAt(0).toUpperCase() + tier.slice(1),
    features: TIER_FEATURES[tier],
    limits: TIER_LIMITS[tier],
    pricing: getPlanPricing(tier),
  }));
}

function getPlanPricing(planId: string) {
  // Same numbers the public pricing page shows: shared/plan-prices.ts.
  const price = PLAN_PRICES[planId as PlanPriceId] ?? PLAN_PRICES.free;
  return { ...price, currency: PLAN_PRICE_CURRENCY };
}
