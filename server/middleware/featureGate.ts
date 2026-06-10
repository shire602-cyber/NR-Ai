import type { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { createLogger } from '../config/logger';

const log = createLogger('feature-gate');

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

const TIER_ORDER = ['free', 'starter', 'professional', 'enterprise'];

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

/**
 * Get the subscription for the current request's company.
 * Caches on req.subscription to avoid repeated DB calls.
 */
async function getRequestSubscription(req: Request): Promise<any | null> {
  if (req.subscription) return req.subscription;

  const companyId = req.params.companyId || req.body?.companyId;
  if (!companyId) return null;

  try {
    const subscription = await storage.getSubscription(companyId);
    if (subscription) {
      req.subscription = subscription;
    }
    return subscription || null;
  } catch (error) {
    log.error({ error, companyId }, 'Failed to fetch subscription');
    return null;
  }
}

/**
 * Middleware: Require a specific feature to be available on the current tier.
 * Returns 403 with structured error if feature is locked.
 */
export function requireFeature(feature: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const subscription = await getRequestSubscription(req);

    if (!subscription) {
      // No subscription found — treat as free tier
      const allowed = TIER_FEATURES.free[feature];
      if (!allowed) {
        res.status(403).json({
          message: 'Upgrade required to access this feature',
          code: 'TIER_LOCKED',
          feature,
          currentTier: 'free',
          requiredTier: FEATURE_MIN_TIER[feature] || 'starter',
        });
        return;
      }
      next();
      return;
    }

    const planId = subscription.planId || 'free';
    const tierFeatures = TIER_FEATURES[planId] || TIER_FEATURES.free;

    if (!tierFeatures[feature]) {
      res.status(403).json({
        message: 'Upgrade required to access this feature',
        code: 'TIER_LOCKED',
        feature,
        currentTier: planId,
        requiredTier: FEATURE_MIN_TIER[feature] || 'starter',
      });
      return;
    }

    next();
  };
}

/**
 * Middleware: Require minimum tier level.
 */
export function requireTier(minimumTier: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const subscription = await getRequestSubscription(req);
    const currentTier = subscription?.planId || 'free';

    const currentIndex = TIER_ORDER.indexOf(currentTier);
    const requiredIndex = TIER_ORDER.indexOf(minimumTier);

    if (currentIndex < requiredIndex) {
      res.status(403).json({
        message: `This feature requires the ${minimumTier} plan or higher`,
        code: 'TIER_LOCKED',
        currentTier,
        requiredTier: minimumTier,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware: Check and increment usage limit.
 * Call this BEFORE the route handler — it increments the counter.
 */
export function checkUsageLimit(resource: 'invoices' | 'receipts' | 'aiCredits') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const subscription = await getRequestSubscription(req);
    const planId = subscription?.planId || 'free';
    const limits = TIER_LIMITS[planId] || TIER_LIMITS.free;

    // Map resource to limit key and usage field
    const resourceMap: Record<string, { limitKey: string; usageField: string; incrementFn: string }> = {
      invoices: { limitKey: 'maxInvoicesPerMonth', usageField: 'invoicesCreatedThisMonth', incrementFn: 'incrementInvoiceCount' },
      receipts: { limitKey: 'maxReceiptsPerMonth', usageField: 'receiptsCreatedThisMonth', incrementFn: 'incrementReceiptCount' },
      aiCredits: { limitKey: 'aiCreditsPerMonth', usageField: 'aiCreditsUsedThisMonth', incrementFn: 'decrementAiCredits' },
    };

    const mapping = resourceMap[resource];
    if (!mapping) {
      next();
      return;
    }

    const limit = limits[mapping.limitKey];

    // -1 means unlimited
    if (limit === -1) {
      next();
      return;
    }

    // Check current usage
    const currentUsage = subscription?.[mapping.usageField as keyof typeof subscription] as number || 0;

    if (currentUsage >= limit) {
      res.status(403).json({
        message: `Monthly ${resource} limit reached. Upgrade your plan for more.`,
        code: 'LIMIT_REACHED',
        resource,
        currentUsage,
        limit,
        currentTier: planId,
      });
      return;
    }

    // Register post-response increment so the counter only advances when the
    // handler actually succeeds (2xx). Pre-incrementing caused quota loss on
    // any handler failure and made race conditions immediately destructive.
    const companyId = req.params.companyId || req.body?.companyId;
    if (companyId && subscription) {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const doIncrement = async () => {
            try {
              if (resource === 'invoices') {
                await storage.incrementInvoiceCount(companyId);
              } else if (resource === 'receipts') {
                await storage.incrementReceiptCount(companyId);
              } else if (resource === 'aiCredits') {
                await storage.decrementAiCredits(companyId);
              }
            } catch (error) {
              log.error({ error, companyId, resource }, 'Failed to increment usage counter');
            }
          };
          doIncrement();
        }
      });
    }

    next();
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
  return TIER_ORDER.map(tier => ({
    id: tier,
    name: tier.charAt(0).toUpperCase() + tier.slice(1),
    features: TIER_FEATURES[tier],
    limits: TIER_LIMITS[tier],
    pricing: getPlanPricing(tier),
  }));
}

function getPlanPricing(planId: string) {
  const pricing: Record<string, { monthly: number; yearly: number; currency: string }> = {
    free: { monthly: 0, yearly: 0, currency: 'AED' },
    starter: { monthly: 49, yearly: 39, currency: 'AED' },
    professional: { monthly: 129, yearly: 99, currency: 'AED' },
    enterprise: { monthly: 299, yearly: 249, currency: 'AED' },
  };
  return pricing[planId] || pricing.free;
}
