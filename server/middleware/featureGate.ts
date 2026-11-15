import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { isStripeConfigured } from "../services/stripe.service";

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
    log.error({ error, companyId }, "Failed to fetch subscription");
    return null;
  }
}

/**
 * Middleware: Require a specific feature to be available on the current tier.
 * Returns 403 with structured error if feature is locked.
 */
// Tier enforcement policy:
// - Explicit BILLING_ENFORCEMENT=true/false always wins, in any environment.
// - Otherwise, production enforces tiers only when billing is actually usable
//   (Stripe configured) — enforcing without a live checkout would paywall
//   features behind a dead upgrade button, and running open with checkout
//   live would give paid features away. Both states are logged at startup.
// - Non-production without a flag fails open so dev/test never hit paywalls.
// Memoized: env and Stripe config are fixed for the process lifetime, and
// billingEnforced() runs on every gated request — without this, an
// unconfigured Stripe would log a warning per request via getStripe().
let stripeConfiguredCache: boolean | null = null;

export function billingEnforced(): boolean {
  const flag = process.env.BILLING_ENFORCEMENT;
  if (flag === "true") return true;
  if (flag === "false") return false;
  if (process.env.NODE_ENV === "production") {
    if (stripeConfiguredCache === null) stripeConfiguredCache = isStripeConfigured();
    return stripeConfiguredCache;
  }
  return false;
}

/** Test hook: clear the memoized Stripe-configured probe. */
export function __resetBillingEnforcementCacheForTests(): void {
  stripeConfiguredCache = null;
}

/** Call once at startup so the effective billing posture is loud and explicit. */
export function logBillingEnforcementStatus(): void {
  if (process.env.NODE_ENV !== "production") return;
  const flag = process.env.BILLING_ENFORCEMENT;
  if (billingEnforced()) {
    log.info(
      { source: flag === "true" ? "BILLING_ENFORCEMENT=true" : "Stripe configured" },
      "Billing tier enforcement is ACTIVE — free-tier tenants are gated from paid features."
    );
  } else {
    log.warn(
      {
        source:
          flag === "false" ? "BILLING_ENFORCEMENT=false" : "Stripe not configured (auto-open)",
      },
      "Billing tier enforcement is OFF in production — ALL paid features are free for every tenant. " +
        "This is expected only during the pre-billing beta; it activates automatically once Stripe is configured."
    );
  }
}

export function requireFeature(feature: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!billingEnforced()) {
      next();
      return;
    }
    const subscription = await getRequestSubscription(req);

    if (!subscription) {
      next();
      return;
    }

    const planId = subscription.planId || "free";
    const tierFeatures = TIER_FEATURES[planId] || TIER_FEATURES.free;

    if (!tierFeatures[feature]) {
      res.status(403).json({
        message: "Upgrade required to access this feature",
        code: "TIER_LOCKED",
        feature,
        currentTier: planId,
        requiredTier: FEATURE_MIN_TIER[feature] || "starter",
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
    if (!billingEnforced()) {
      next();
      return;
    }
    const subscription = await getRequestSubscription(req);
    const currentTier = subscription?.planId || "free";

    const currentIndex = TIER_ORDER.indexOf(currentTier);
    const requiredIndex = TIER_ORDER.indexOf(minimumTier);

    if (currentIndex < requiredIndex) {
      res.status(403).json({
        message: `This feature requires the ${minimumTier} plan or higher`,
        code: "TIER_LOCKED",
        currentTier,
        requiredTier: minimumTier,
      });
      return;
    }

    next();
  };
}

// ===========================
// Usage meter + central plan gates (W5-B, R19-04, R19-05)
// ===========================
//
// Mounted ONCE in server/routes.ts on /api (after the role policy), so route
// files owned by other workstreams need no edits:
//
//   app.use("/api", planFeaturePolicy, usageLimitPolicy);
//
// planFeaturePolicy  METHOD + path -> TIER_FEATURES flag; 403 TIER_LOCKED.
// usageLimitPolicy   METHOD + path -> monthly meter (usage_counters); the
//                    request reserves one unit atomically and releases it when
//                    the response is not 2xx; 402 USAGE_LIMIT_REACHED.
//
// BILLING_ENFORCEMENT semantics are unchanged (billingEnforced()): when
// enforcement is off every gate passes, but successful requests are still
// metered so the usage page shows real numbers.

export type UsageMetric = "invoices" | "receipts" | "ai_calls" | "team_members";

/** Monthly limit key in TIER_LIMITS for each metered resource. */
const METRIC_LIMIT_KEY: Record<UsageMetric, string> = {
  invoices: "maxInvoicesPerMonth",
  receipts: "maxReceiptsPerMonth",
  ai_calls: "aiCreditsPerMonth",
  team_members: "maxUsers",
};

type GateMethods = "*" | "READ" | "MUT" | string;

interface GateRule {
  methods: GateMethods;
  /** Under /api, "/"-separated; "*" one segment, ":uuid" one UUID segment, "**" the rest. */
  pattern: string;
  feature?: string;
  metric?: UsageMetric;
  /** Optional body predicate; the rule applies only when it returns true. */
  when?: (req: Request) => boolean;
}

const foreignCurrency = (req: Request): boolean => {
  const c = (req.body as Record<string, unknown> | undefined)?.currency;
  return typeof c === "string" && c.trim() !== "" && c.trim().toUpperCase() !== "AED";
};

/**
 * Feature gates. Must agree with TIER_FEATURES and the Pricing page matrix
 * (client/src/pages/Pricing.tsx, rows carry the same `gate` key) — a unit test
 * compares all three.
 */
export const PLAN_FEATURE_RULES: readonly GateRule[] = [
  // Payroll & WPS (Professional+)
  { methods: "*", pattern: "companies/*/payroll/**", feature: "payroll" },
  { methods: "*", pattern: "companies/*/payroll-runs/**", feature: "payroll" },
  { methods: "*", pattern: "payroll-runs/**", feature: "payroll" },
  { methods: "*", pattern: "payroll-items/**", feature: "payroll" },
  { methods: "*", pattern: "companies/*/employees/**", feature: "payroll" },
  { methods: "*", pattern: "employees/**", feature: "payroll" },
  // Fixed assets & depreciation (Professional+)
  { methods: "*", pattern: "companies/*/fixed-assets/**", feature: "fixedAssets" },
  { methods: "*", pattern: "companies/*/fixed-asset-classes/**", feature: "fixedAssets" },
  { methods: "*", pattern: "fixed-assets/**", feature: "fixedAssets" },
  // Recurring invoices (Starter+)
  { methods: "*", pattern: "companies/*/recurring-invoices/**", feature: "recurringInvoices" },
  { methods: "*", pattern: "recurring-invoices/**", feature: "recurringInvoices" },
  { methods: "MUT", pattern: "companies/*/invoices/*/set-recurring", feature: "recurringInvoices" },
  // Bulk operations (Professional+)
  { methods: "MUT", pattern: "companies/*/document-chases/bulk-send", feature: "bulkOps" },
  { methods: "MUT", pattern: "chasing/bulk-send/**", feature: "bulkOps" },
  { methods: "MUT", pattern: "companies/*/vat-workpapers/*/rows/bulk", feature: "bulkOps" },
  { methods: "MUT", pattern: "companies/*/vat-workpapers/*/rows/bulk-status", feature: "bulkOps" },
  { methods: "POST", pattern: "ai/batch-categorize", feature: "bulkOps" },
  // Multi-currency documents (Starter+)
  { methods: "MUT", pattern: "companies/*/exchange-rates/**", feature: "multiCurrency" },
  {
    methods: "POST",
    pattern: "companies/*/invoices",
    feature: "multiCurrency",
    when: foreignCurrency,
  },
  { methods: "PUT|PATCH", pattern: "invoices/*", feature: "multiCurrency", when: foreignCurrency },
  {
    methods: "POST",
    pattern: "companies/*/quotes",
    feature: "multiCurrency",
    when: foreignCurrency,
  },
  // Online invoice payment links (Starter+)
  { methods: "MUT", pattern: "companies/*/invoices/*/payment-links", feature: "invoicePayment" },
  { methods: "MUT", pattern: "companies/*/payment-links/**", feature: "invoicePayment" },
  // Webhooks (Enterprise) — endpoint management only; provider callbacks under
  // /api/webhooks/<provider> are not tenant features and never match (:uuid).
  { methods: "*", pattern: "companies/*/webhooks/**", feature: "webhooks" },
  { methods: "*", pattern: "webhooks/:uuid/**", feature: "webhooks" },
  // Public API keys (Enterprise)
  { methods: "*", pattern: "companies/*/api-keys/**", feature: "apiAccess" },
  { methods: "*", pattern: "api-keys/**", feature: "apiAccess" },
];

/** Metered creates (one unit per successful request). */
export const USAGE_LIMIT_RULES: readonly GateRule[] = [
  { methods: "POST", pattern: "companies/*/invoices", metric: "invoices" },
  { methods: "POST", pattern: "companies/*/receipts", metric: "receipts" },
  { methods: "POST", pattern: "ai/**", metric: "ai_calls" },
  { methods: "POST", pattern: "ocr/process", metric: "ai_calls" },
  { methods: "POST", pattern: "companies/*/ai-gl/scan", metric: "ai_calls" },
  { methods: "POST", pattern: "companies/*/team/invitations", metric: "team_members" },
  { methods: "POST", pattern: "companies/*/team/invite", metric: "team_members" },
  { methods: "POST", pattern: "companies/*/team", metric: "team_members" },
];

const UUID_SEG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READS = new Set(["GET", "HEAD", "OPTIONS"]);

function gateMethodMatches(spec: GateMethods, method: string): boolean {
  if (spec === "*") return true;
  if (spec === "READ") return READS.has(method);
  if (spec === "MUT") return !READS.has(method);
  return spec.split("|").includes(method);
}

function gatePathMatches(pattern: string, segs: string[]): boolean {
  const toks = pattern.split("/");
  let i = 0;
  for (const tok of toks) {
    if (tok === "**") return true;
    if (i >= segs.length) return false;
    if (tok === ":uuid") {
      if (!UUID_SEG.test(segs[i])) return false;
    } else if (tok !== "*" && tok !== segs[i]) return false;
    i++;
  }
  return i === segs.length;
}

function apiSegments(path: string): string[] {
  const p = path.split("?")[0];
  const rel = p.startsWith("/api/") ? p.slice(4) : p;
  return rel.split("/").filter(Boolean);
}

export function matchGateRule(
  rules: readonly GateRule[],
  method: string,
  path: string,
  req?: Request
): GateRule | null {
  const segs = apiSegments(path);
  const m = method.toUpperCase();
  for (const rule of rules) {
    if (!gateMethodMatches(rule.methods, m) || !gatePathMatches(rule.pattern, segs)) continue;
    if (rule.when && (!req || !rule.when(req))) continue;
    return rule;
  }
  return null;
}

/** Feature flags gated centrally (for the TIER_FEATURES / Pricing consistency test). */
export function centrallyGatedFeatures(): string[] {
  return [...new Set(PLAN_FEATURE_RULES.map((r) => r.feature!).filter(Boolean))];
}

/** "YYYY-MM" in UAE time (UTC+4, no DST). */
export function usagePeriod(now = new Date()): string {
  const uae = new Date(now.getTime() + 4 * 3600_000);
  return `${uae.getUTCFullYear()}-${String(uae.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The company's plan, or null when it has no subscription row (firm-managed
 * client books): like requireFeature, such companies are not tier-gated.
 */
async function companyPlanId(companyId: string): Promise<string | null> {
  const { pq } = await import("../services/connectors/pq");
  const { rows } = await pq<{ plan_id: string }>(
    `SELECT plan_id FROM subscriptions WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [companyId]
  );
  return rows[0] ? rows[0].plan_id || "free" : null;
}

/** Current month's count for a metric. */
export async function getUsage(
  companyId: string,
  metric: UsageMetric,
  period = usagePeriod()
): Promise<number> {
  const { pq } = await import("../services/connectors/pq");
  if (metric === "team_members") return liveTeamCount(companyId);
  const { rows } = await pq<{ count: number }>(
    `SELECT count FROM usage_counters WHERE company_id = $1 AND period = $2 AND metric = $3`,
    [companyId, period, metric]
  );
  return Number(rows[0]?.count ?? 0);
}

async function liveTeamCount(companyId: string): Promise<number> {
  const { pq } = await import("../services/connectors/pq");
  const { rows } = await pq<{ n: string }>(
    `SELECT (SELECT count(*) FROM company_users WHERE company_id = $1)
          + (SELECT count(*) FROM invitations
              WHERE company_id = $1 AND status = 'pending'
                AND (expires_at IS NULL OR expires_at > now())) AS n`,
    [companyId]
  );
  return Number(rows[0]?.n ?? 0);
}

/** Add `delta` to the month's counter (upsert). */
export async function addUsage(
  companyId: string,
  metric: Exclude<UsageMetric, "team_members">,
  delta = 1,
  period = usagePeriod()
): Promise<void> {
  const { pq } = await import("../services/connectors/pq");
  await pq(
    `INSERT INTO usage_counters (company_id, period, metric, count, updated_at)
          VALUES ($1, $2, $3, GREATEST($4, 0), now())
     ON CONFLICT (company_id, period, metric)
          DO UPDATE SET count = GREATEST(usage_counters.count + $4, 0), updated_at = now()`,
    [companyId, period, metric, delta]
  );
}

/**
 * Atomically take one unit under `limit`. Returns false when the month's
 * quota is used up. Single statement, so concurrent requests cannot overshoot.
 */
export async function reserveUsage(
  companyId: string,
  metric: Exclude<UsageMetric, "team_members">,
  limit: number,
  period = usagePeriod()
): Promise<boolean> {
  const { pq } = await import("../services/connectors/pq");
  if (limit <= 0) return false;
  const { rows } = await pq(
    `INSERT INTO usage_counters AS u (company_id, period, metric, count, updated_at)
          VALUES ($1, $2, $3, 1, now())
     ON CONFLICT (company_id, period, metric)
          DO UPDATE SET count = u.count + 1, updated_at = now()
          WHERE u.count < $4
     RETURNING u.count`,
    [companyId, period, metric, limit]
  );
  return rows.length > 0;
}

async function gateCompany(req: Request): Promise<string | null> {
  const { resolveRequestCompany } = await import("./companyRolePolicy");
  return resolveRequestCompany(req, req.path.startsWith("/api/") ? req.path.slice(4) : req.path);
}

/** Platform admins and NR firm staff are not metered against a tenant's plan. */
async function isExemptCaller(req: Request): Promise<boolean> {
  const { authenticateRequest } = await import("./auth");
  const auth = await authenticateRequest(req);
  const user = auth && !("code" in auth) ? auth.user : null;
  return user?.isAdmin === true || !!user?.firmRole;
}

/** Central feature gate (403 TIER_LOCKED). */
export async function planFeaturePolicy(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!billingEnforced()) return next();
    const rule = matchGateRule(PLAN_FEATURE_RULES, req.method, req.originalUrl || req.path, req);
    if (!rule?.feature) return next();
    const companyId = await gateCompany(req);
    if (!companyId) return next(); // the route answers 400/401/404 itself
    if (await isExemptCaller(req)) return next();
    const planId = await companyPlanId(companyId);
    if (planId === null) return next();
    if ((TIER_FEATURES[planId] || TIER_FEATURES.free)[rule.feature]) return next();
    res.status(403).json({
      message: "Upgrade required to access this feature",
      code: "TIER_LOCKED",
      feature: rule.feature,
      currentTier: planId,
      requiredTier: FEATURE_MIN_TIER[rule.feature] || "starter",
    });
  } catch (err) {
    next(err);
  }
}

/** Central monthly usage meter and limit (402 USAGE_LIMIT_REACHED). */
export async function usageLimitPolicy(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rule = matchGateRule(USAGE_LIMIT_RULES, req.method, req.originalUrl || req.path, req);
    if (!rule?.metric) return next();
    const companyId = await gateCompany(req);
    if (!companyId) return next();
    const metric = rule.metric;
    const plan =
      billingEnforced() && !(await isExemptCaller(req)) ? await companyPlanId(companyId) : null;
    const enforced = plan !== null;
    const planId = plan ?? "free";
    const limit = (TIER_LIMITS[planId] || TIER_LIMITS.free)[METRIC_LIMIT_KEY[metric]];

    const limitReached = async () => {
      const used = await getUsage(companyId, metric);
      res.status(402).json({
        message: `Monthly ${metric.replace("_", " ")} limit reached on the ${planId} plan. Upgrade for more.`,
        code: "USAGE_LIMIT_REACHED",
        resource: metric,
        currentUsage: used,
        limit,
        currentTier: planId,
      });
    };

    if (metric === "team_members") {
      // Seats are a live count (members + pending invitations), not a monthly meter.
      if (enforced && limit !== -1 && (await liveTeamCount(companyId)) >= limit) {
        return limitReached();
      }
      return next();
    }

    if (enforced && limit !== -1) {
      if (!(await reserveUsage(companyId, metric, limit))) return limitReached();
      res.on("finish", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          addUsage(companyId, metric, -1).catch((error) =>
            log.error({ error, companyId, metric }, "Failed to release usage reservation")
          );
        }
      });
      return next();
    }

    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        addUsage(companyId, metric, 1).catch((error) =>
          log.error({ error, companyId, metric }, "Failed to meter usage")
        );
      }
    });
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Route-level variant kept for callers that mount it explicitly; same meter
 * and 402 contract as usageLimitPolicy.
 */
export function checkUsageLimit(resource: "invoices" | "receipts" | "aiCredits") {
  const metric: Exclude<UsageMetric, "team_members"> =
    resource === "aiCredits" ? "ai_calls" : resource;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const companyId = req.params.companyId || req.body?.companyId;
      if (!companyId || !billingEnforced()) return next();
      const planId = await companyPlanId(companyId);
      if (planId === null) return next();
      const limit = (TIER_LIMITS[planId] || TIER_LIMITS.free)[METRIC_LIMIT_KEY[metric]];
      if (limit === -1) return next();
      if (!(await reserveUsage(companyId, metric, limit))) {
        res.status(402).json({
          message: `Monthly ${resource} limit reached. Upgrade your plan for more.`,
          code: "USAGE_LIMIT_REACHED",
          resource,
          limit,
          currentTier: planId,
        });
        return;
      }
      res.on("finish", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          addUsage(companyId, metric, -1).catch(() => undefined);
        }
      });
      next();
    } catch (err) {
      next(err);
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
          const idx = TIER_ORDER.indexOf(sub?.planId || "free");
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
  const pricing: Record<string, { monthly: number; yearly: number; currency: string }> = {
    free: { monthly: 0, yearly: 0, currency: "AED" },
    starter: { monthly: 49, yearly: 39, currency: "AED" },
    professional: { monthly: 129, yearly: 99, currency: "AED" },
    enterprise: { monthly: 299, yearly: 249, currency: "AED" },
  };
  return pricing[planId] || pricing.free;
}
