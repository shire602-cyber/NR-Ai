import type { Request, Response, NextFunction } from "express";
import { createLogger } from "../config/logger";
import { isStripeConfigured } from "../services/stripe.service";
import {
  NO_PLAN_ID,
  PLAN_FEATURES,
  UNLIMITED,
  afterTrialPlan,
  isPaidPlanId,
  planDefinition,
  planFeatures,
  planWithMoreOf,
  publicPlanCatalog,
  requiredPlanFor,
  resolveEntitlement,
  type BillingCycle,
  type Entitlement,
  type PaidPlanId,
  type PlanFeature,
  type PlanLimits,
} from "../../shared/plans";

const log = createLogger("feature-gate");

// ===========================
// Plans, features and limits: shared/plans.ts (WQ7)
// ===========================
//
// One plan module feeds the pricing page, the subscription page, GET /api/billing/plans and these
// gates. A company's entitlement (shared/plans.ts resolveEntitlement) is one of:
//   trial   — no paid plan, inside the 14-day trial: the top plan's features (TRIAL_LIMITS caps);
//   active  — a paid plan: its features and limits;
//   expired — trial over without a plan: read-only (writes refused with 402 PLAN_REQUIRED).
// Feature gates refuse WRITES only: a module the plan does not include stays readable, so data is
// never hidden or lost when a plan changes (owner decision 2026-11-18).

/** Plan id stored for a company with no paid plan (legacy name; it is not a plan). */
export const FREE_PLAN_ID = NO_PLAN_ID;

const NO_FEATURES = Object.fromEntries(PLAN_FEATURES.map((f) => [f, false])) as Record<
  PlanFeature,
  boolean
>;

/** True for NR-managed client books (firm-billed, not plan-gated). */
export function isFirmBilledCompany(company: { companyType?: string | null } | null | undefined) {
  return company?.companyType === "client";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CompanyEntitlement extends Entitlement {
  companyId: string;
  /** subscriptions.plan_id as stored ("free" = no paid plan). */
  storedPlanId: string;
  status: string;
  trialStartedAt: string | null;
  /** STEP4: the plan chosen for after the trial. Informational only: the gates never read it. */
  chosenPlan: {
    planId: PaidPlanId;
    billingCycle: BillingCycle;
    source: string | null;
    chosenAt: string | null;
    price: number;
  } | null;
  activationRequestedAt: string | null;
}

/**
 * The company's entitlement now. Returns null when the company does not exist (the route answers
 * 404) or is NR-managed client books (company_type = 'client', firm-billed: explicit exemption,
 * keyed on a field only platform admins / NR staff can set). Fails closed: a company without a
 * subscription row has no paid plan, so it is on its trial (from the company's creation) and then
 * read-only — never an implicit upgrade.
 */
export async function companyEntitlement(
  companyId: string,
  now: Date = new Date()
): Promise<CompanyEntitlement | null> {
  if (!companyId || !UUID_RE.test(companyId)) return null;
  const { pq } = await import("../services/connectors/pq");
  const { rows } = await pq<{
    company_type: string | null;
    company_created_at: Date | string | null;
    plan_id: string | null;
    status: string | null;
    sub_created_at: Date | string | null;
    trial_ends_at: Date | string | null;
    chosen_plan_id: string | null;
    chosen_billing_cycle: string | null;
    chosen_plan_source: string | null;
    chosen_plan_at: Date | string | null;
    plan_activation_requested_at: Date | string | null;
  }>(
    `SELECT c.company_type, c.created_at AS company_created_at,
            s.plan_id, s.status, s.created_at AS sub_created_at, s.trial_ends_at,
            s.chosen_plan_id, s.chosen_billing_cycle, s.chosen_plan_source, s.chosen_plan_at,
            s.plan_activation_requested_at
       FROM companies c
       LEFT JOIN LATERAL (
         SELECT plan_id, status, created_at, trial_ends_at, chosen_plan_id, chosen_billing_cycle,
                chosen_plan_source, chosen_plan_at, plan_activation_requested_at
           FROM subscriptions
          WHERE company_id = c.id ORDER BY created_at DESC LIMIT 1
       ) s ON true
      WHERE c.id = $1`,
    [companyId]
  );
  const row = rows[0];
  if (!row || isFirmBilledCompany({ companyType: row.company_type })) return null;
  const trialStartedAt = row.sub_created_at ?? row.company_created_at;
  const storedPlanId = row.plan_id || NO_PLAN_ID;
  const ent = resolveEntitlement(
    {
      planId: storedPlanId,
      status: row.status,
      trialStartedAt,
      // A paid plan's Stripe trial end is not the product trial; only a planless row's counts.
      trialEndsAt: isPaidPlanId(storedPlanId) ? null : row.trial_ends_at,
    },
    now
  );
  return {
    ...ent,
    companyId,
    storedPlanId,
    status: row.status ?? "active",
    trialStartedAt: trialStartedAt ? new Date(trialStartedAt).toISOString() : null,
    chosenPlan: (() => {
      const plan = afterTrialPlan({
        chosenPlanId: row.chosen_plan_id,
        chosenBillingCycle: row.chosen_billing_cycle,
      });
      return plan
        ? {
            planId: plan.planId,
            billingCycle: plan.billingCycle,
            source: row.chosen_plan_source,
            chosenAt: row.chosen_plan_at ? new Date(row.chosen_plan_at).toISOString() : null,
            price: plan.price,
          }
        : null;
    })(),
    activationRequestedAt: row.plan_activation_requested_at
      ? new Date(row.plan_activation_requested_at).toISOString()
      : null,
  };
}

/** Effective plan id for the gates: the paid plan, the top plan during the trial, else "free". */
function effectivePlanId(ent: Entitlement): string {
  return ent.planId ?? NO_PLAN_ID;
}

/**
 * Plan id the company's features follow: its paid plan, the top plan while on trial, "free" (no
 * features) once the trial has ended. Null for firm-billed client books or an unknown company.
 */
export async function companyPlanId(companyId: string): Promise<string | null> {
  const ent = await companyEntitlement(companyId);
  return ent ? effectivePlanId(ent) : null;
}

/** Does the company's entitlement include `feature` now? (true for firm-billed client books) */
export async function companyHasFeature(companyId: string, feature: PlanFeature): Promise<boolean> {
  const ent = await companyEntitlement(companyId);
  return ent === null || ent.features[feature] === true;
}

/**
 * Create the company's planless subscription row if it has none (idempotent): the row's creation
 * time starts the trial. The 0113 trigger does this on INSERT INTO companies; callers that
 * provision a company may call it too so the row exists even on a database without the trigger.
 */
export async function ensureFreeSubscription(companyId: string): Promise<void> {
  const { pq } = await import("../services/connectors/pq");
  await pq(
    `INSERT INTO subscriptions (company_id, plan_id, plan_name, status, current_period_start,
                                current_period_end, max_users, max_invoices, max_receipts,
                                ai_credits_remaining)
     SELECT $1, 'free', 'Free', 'active', now(), now() + interval '100 years', 1, 20, 20, 10
      WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE company_id = $1)`,
    [companyId]
  );
}

// Tier enforcement policy (owner decision 2026-11-18: plan limits are enforced now):
// - Explicit BILLING_ENFORCEMENT=true/false always wins, in any environment.
// - Otherwise production enforces, whether or not online checkout is configured (without checkout
//   the upgrade path is "contact us" and an NR admin sets the plan).
// - Development and test without a flag fail open so local work never hits paywalls; the DB tests
//   for each gate set the flag explicitly.
let stripeConfiguredCache: boolean | null = null;

export function billingEnforced(): boolean {
  const flag = process.env.BILLING_ENFORCEMENT;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV === "production";
}

/**
 * Cost / abuse caps: AI credits, storage and companies per user. They follow billing enforcement,
 * and are otherwise ON in production and OFF in development/test unless
 * COST_CAPS_ENFORCEMENT=true|false says so (a deployment that switches plan gates off with
 * BILLING_ENFORCEMENT=false still caps cost by default).
 */
export function costCapsEnforced(): boolean {
  if (billingEnforced()) return true;
  const flag = process.env.COST_CAPS_ENFORCEMENT;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV === "production";
}

/** Test hook: clear the memoized Stripe-configured probe. */
export function __resetBillingEnforcementCacheForTests(): void {
  stripeConfiguredCache = null;
}

/** Call once at startup so the effective billing posture is loud and explicit. */
export function logBillingEnforcementStatus(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (stripeConfiguredCache === null) stripeConfiguredCache = isStripeConfigured();
  if (billingEnforced()) {
    log.info(
      { checkout: stripeConfiguredCache ? "stripe" : "contact-us" },
      "Plan enforcement is ACTIVE — modules outside a company's plan are read-only."
    );
  } else {
    log.warn(
      { source: "BILLING_ENFORCEMENT=false" },
      "Plan enforcement is OFF in production — every module is open for every tenant."
    );
  }
}

// ===========================
// Refusals (stable codes the app localises: forms.serverErrors.<CODE>)
// ===========================

export const UPGRADE_URL = "/subscription";

/** 402 PLAN_REQUIRED (trial over, no plan) or 403 TIER_LOCKED (the plan lacks the module). */
function refuseFeature(res: Response, ent: Entitlement, feature: PlanFeature): void {
  const requiredTier = requiredPlanFor(feature);
  if (ent.state === "expired") {
    res.status(402).json({
      message:
        "Your free trial has ended. Choose a plan to add or change records; your data stays readable.",
      code: "PLAN_REQUIRED",
      messageKey: "forms.serverErrors.PLAN_REQUIRED",
      feature,
      currentTier: null,
      requiredTier,
      upgrade: { requiredPlan: requiredTier, url: UPGRADE_URL },
    });
    return;
  }
  res.status(403).json({
    message: `This module is read-only on your plan. Upgrade to ${requiredTier} to make changes.`,
    code: "TIER_LOCKED",
    messageKey: "forms.serverErrors.TIER_LOCKED",
    feature,
    currentTier: ent.planId,
    requiredTier,
    upgrade: { requiredPlan: requiredTier, url: UPGRADE_URL },
  });
}

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Route-level feature gate (kept for the route files that mount it explicitly). Same rule as the
 * central policy: writes need the feature, reads always pass (the data stays visible).
 */
export function requireFeature(feature: PlanFeature) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!billingEnforced() || READS.has(req.method.toUpperCase())) return next();
      const companyId =
        req.params.companyId ||
        (req.body as Record<string, unknown> | undefined)?.companyId ||
        (await gateCompany(req));
      if (typeof companyId !== "string" || !companyId) return next();
      if (await isExemptCaller(req)) return next();
      const ent = await companyEntitlement(companyId);
      if (ent === null || ent.features[feature]) return next();
      refuseFeature(res, ent, feature);
    } catch (err) {
      next(err);
    }
  };
}

/** Route-level minimum-plan gate (writes only, like requireFeature). */
export function requireTier(minimumTier: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!billingEnforced() || READS.has(req.method.toUpperCase())) return next();
      const companyId = req.params.companyId || req.body?.companyId;
      if (typeof companyId !== "string" || !companyId) return next();
      if (await isExemptCaller(req)) return next();
      const ent = await companyEntitlement(companyId);
      if (ent === null) return next();
      const order = ["starter", "professional", "enterprise"];
      const have = ent.planId ? order.indexOf(ent.planId) : -1;
      if (have >= order.indexOf(minimumTier)) return next();
      const status = ent.state === "expired" ? 402 : 403;
      res.status(status).json({
        message: `This feature requires the ${minimumTier} plan or higher`,
        code: ent.state === "expired" ? "PLAN_REQUIRED" : "TIER_LOCKED",
        messageKey: `forms.serverErrors.${ent.state === "expired" ? "PLAN_REQUIRED" : "TIER_LOCKED"}`,
        currentTier: ent.planId,
        requiredTier: minimumTier,
        upgrade: { requiredPlan: minimumTier, url: UPGRADE_URL },
      });
    } catch (err) {
      next(err);
    }
  };
}

// ===========================
// Central plan gates and usage meter (W5-B, R19-04, R19-05; WQ7)
// ===========================
//
// Mounted ONCE in server/routes.ts on /api (after the role policy), so route files owned by other
// workstreams need no edits:
//
//   app.use("/api", planFeaturePolicy, usageLimitPolicy, storageLimitPolicy);
//
// planFeaturePolicy  METHOD + path -> feature; writes only; 403 TIER_LOCKED / 402 PLAN_REQUIRED.
// usageLimitPolicy   METHOD + path -> monthly meter (usage_counters); the request reserves one unit
//                    atomically and releases it when the response is not 2xx; 402
//                    USAGE_LIMIT_REACHED.
// storageLimitPolicy uploads past the plan's storage; 402 STORAGE_LIMIT_REACHED.
//
// When enforcement is off every gate passes, but successful requests are still metered so the
// usage page shows real numbers.

export type UsageMetric = "invoices" | "receipts" | "ai_calls" | "team_members";

/** Monthly limit key in PlanLimits for each metered resource. */
const METRIC_LIMIT_KEY: Record<UsageMetric, keyof PlanLimits> = {
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
  feature?: PlanFeature;
  metric?: UsageMetric;
  /** Optional body predicate; the rule applies only when it returns true. */
  when?: (req: Request) => boolean;
}

const foreignCurrency = (req: Request): boolean => {
  const c = (req.body as Record<string, unknown> | undefined)?.currency;
  return typeof c === "string" && c.trim() !== "" && c.trim().toUpperCase() !== "AED";
};

const mut = (pattern: string, feature: PlanFeature): GateRule => ({
  methods: "MUT",
  pattern,
  feature,
});

/**
 * Core bookkeeping modules every paid plan includes. Listed so that a company whose trial ended
 * without a plan cannot add or change records in them (reads, exports and PDFs stay open).
 * Billing, team, onboarding, automations switches, notification settings, backups and data
 * export are deliberately absent: a planless company can still choose a plan and take its data.
 */
const CORE_COMPANY_MODULES = [
  "invoices",
  "bills",
  "receipts",
  "journal",
  "journal-templates",
  "accounts",
  "seed-accounts",
  "customer-contacts",
  "vendors",
  "products",
  "quotes",
  "credit-notes",
  "debit-notes",
  "customer-deposits",
  "customer-credits",
  "vendor-prepayments",
  "receivables",
  "reminders",
  "reminder-settings",
  "customer-statements",
  "invoice-templates",
  "recurring-bills",
  "bank-accounts",
  "bank-statements",
  "bank-transactions",
  "bank-connections",
  "bank-reconciliations",
  "auto-reconcile",
  "reconciliation-rules",
  "vat-returns",
  "vat-workpapers",
  "tax-returns-archive",
  "period-lock",
  "inventory",
  "warehouses",
  "stocktakes",
  "fx-revaluations",
  "imports",
  "documents",
  "document-versions",
  "einvoicing",
  "ai-gl",
] as const;

const CORE_ROW_MODULES = [
  "invoices",
  "bills",
  "receipts",
  "journal",
  "journal-templates",
  "accounts",
  "products",
  "quotes",
  "credit-notes",
  "vat-returns",
  "bank-connections",
  "reconciliation-rules",
  "exchange-rates",
  "documents",
  "tax-returns-archive",
  "reminder-settings",
] as const;

/**
 * Feature gates, most specific first (the first matching rule decides). Must agree with the plan
 * matrix in shared/plans.ts and the Pricing page (tests/unit/commercial-plan-matrix.test.ts).
 */
export const PLAN_FEATURE_RULES: readonly GateRule[] = [
  // Payroll & WPS (Professional+)
  mut("companies/*/payroll/**", "payroll"),
  mut("companies/*/payroll-runs/**", "payroll"),
  mut("payroll-runs/**", "payroll"),
  mut("payroll-items/**", "payroll"),
  mut("companies/*/employees/**", "payroll"),
  mut("employees/**", "payroll"),
  // Fixed assets & depreciation (Professional+)
  mut("companies/*/fixed-assets/**", "fixedAssets"),
  mut("companies/*/fixed-asset-classes/**", "fixedAssets"),
  mut("fixed-assets/**", "fixedAssets"),
  // Budgets and variance (Professional+)
  mut("companies/*/budget-plans/**", "budgets"),
  mut("budget-plans/**", "budgets"),
  mut("budget-lines/**", "budgets"),
  // Month-end close checklist (Professional+)
  mut("companies/*/month-end/**", "monthEnd"),
  // Cost centres (Professional+)
  mut("companies/*/cost-centers/**", "costCenters"),
  mut("cost-centers/**", "costCenters"),
  // Purchase orders (Professional+)
  mut("companies/*/purchase-orders/**", "purchaseOrders"),
  mut("purchase-orders/**", "purchaseOrders"),
  // Expense claims (Professional+)
  mut("companies/*/expense-claims/**", "expenseClaims"),
  mut("expense-claims/**", "expenseClaims"),
  // Customer portal access (Professional+); revoking access always works.
  { methods: "POST|PUT|PATCH", pattern: "portal/generate-access", feature: "customerPortal" },
  { methods: "POST|PUT|PATCH", pattern: "portal/contacts/**", feature: "customerPortal" },
  // STEP5 invitations: sending is gated, revoking an invitation or an account never is.
  {
    methods: "POST",
    pattern: "companies/*/customer-contacts/*/portal-invitations",
    feature: "customerPortal",
  },
  { methods: "POST", pattern: "companies/*/portal-invitations/bulk", feature: "customerPortal" },
  {
    methods: "POST",
    pattern: "companies/*/portal-invitations/*/resend",
    feature: "customerPortal",
  },
  // Corporate tax (Professional+)
  mut("companies/*/corporate-tax/**", "corporateTax"),
  mut("corporate-tax/**", "corporateTax"),
  // AI assistant: ask, forecasts and anomaly checks (Professional+)
  { methods: "POST", pattern: "ai/chat", feature: "aiAssistant" },
  { methods: "POST", pattern: "ai/nl-gateway", feature: "aiAssistant" },
  { methods: "POST", pattern: "ai/cfo-advice", feature: "aiAssistant" },
  { methods: "POST", pattern: "ai/detect-anomalies", feature: "aiAssistant" },
  { methods: "POST", pattern: "ai/forecast-cashflow", feature: "aiAssistant" },
  { methods: "POST", pattern: "analytics/generate-forecast", feature: "aiAssistant" },
  { methods: "POST", pattern: "companies/*/anomalies/scan", feature: "aiAssistant" },
  // Recurring invoices (every plan)
  mut("companies/*/recurring-invoices/**", "recurringInvoices"),
  mut("recurring-invoices/**", "recurringInvoices"),
  // Bulk operations (Professional+)
  mut("companies/*/document-chases/bulk-send", "bulkOps"),
  mut("chasing/bulk-send/**", "bulkOps"),
  mut("companies/*/vat-workpapers/*/rows/bulk", "bulkOps"),
  mut("companies/*/vat-workpapers/*/rows/bulk-status", "bulkOps"),
  { methods: "POST", pattern: "ai/batch-categorize", feature: "bulkOps" },
  // Multi-currency documents (every plan)
  mut("companies/*/exchange-rates/**", "multiCurrency"),
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
  // Online invoice payment links (every plan)
  mut("companies/*/invoices/*/payment-links", "invoicePayment"),
  mut("companies/*/payment-links/**", "invoicePayment"),
  // Webhooks (Enterprise) — endpoint management only; provider callbacks under
  // /api/webhooks/<provider> are not tenant features and never match (:uuid).
  mut("companies/*/webhooks/**", "webhooks"),
  mut("webhooks/:uuid/**", "webhooks"),
  // Public API keys (Enterprise)
  mut("companies/*/api-keys/**", "apiAccess"),
  mut("api-keys/**", "apiAccess"),
  // Core bookkeeping (every plan; read-only after the trial without a plan)
  ...CORE_COMPANY_MODULES.map((m) => mut(`companies/*/${m}/**`, "bookkeeping")),
  ...CORE_ROW_MODULES.map((m) => mut(`${m}/**`, "bookkeeping")),
  { methods: "POST", pattern: "ocr/**", feature: "bookkeeping" },
];

/**
 * Last path segments that read rather than write even when sent as POST (exports, PDFs,
 * previews, validation): never feature-gated, so data stays readable and exportable.
 */
const READ_LIKE_TAILS = new Set([
  "export",
  "exports",
  "pdf",
  "preview",
  "download",
  "xlsx",
  "csv",
  "print",
  "validate",
  "search",
]);

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

/** The feature a write to METHOD + path needs (null when none: reads, exports, billing ...). */
export function featureForRequest(method: string, path: string, req?: Request): PlanFeature | null {
  const segs = apiSegments(path);
  if (segs.length && READ_LIKE_TAILS.has(segs[segs.length - 1].toLowerCase())) return null;
  return matchGateRule(PLAN_FEATURE_RULES, method, path, req)?.feature ?? null;
}

/** Feature flags gated centrally (for the plan matrix / Pricing consistency test). */
export function centrallyGatedFeatures(): PlanFeature[] {
  return [...new Set(PLAN_FEATURE_RULES.map((r) => r.feature!).filter(Boolean))];
}

/** "YYYY-MM" in UAE time (UTC+4, no DST). */
export function usagePeriod(now = new Date()): string {
  const uae = new Date(now.getTime() + 4 * 3600_000);
  return `${uae.getUTCFullYear()}-${String(uae.getUTCMonth() + 1).padStart(2, "0")}`;
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
 * Atomically take one unit under `limit`. Returns false when the month's quota is used up. Single
 * statement, so concurrent requests cannot overshoot.
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
  const path = req.originalUrl?.split("?")[0] || req.path;
  return resolveRequestCompany(req, path.startsWith("/api/") ? path.slice(4) : path);
}

/** Platform admins and NR firm staff are not metered or gated against a tenant's plan. */
async function isExemptCaller(req: Request): Promise<boolean> {
  if (req.user) return req.user.isAdmin === true || !!req.user.firmRole;
  const { authenticateRequest } = await import("./auth");
  const auth = await authenticateRequest(req);
  const user = auth && !("code" in auth) ? auth.user : null;
  return user?.isAdmin === true || !!user?.firmRole;
}

/** Central feature gate (writes only): 403 TIER_LOCKED, or 402 PLAN_REQUIRED after the trial. */
export async function planFeaturePolicy(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!billingEnforced()) return next();
    const feature = featureForRequest(req.method, req.originalUrl || req.path, req);
    if (!feature) return next();
    const companyId = await gateCompany(req);
    if (!companyId) return next(); // the route answers 400/401/404 itself
    if (await isExemptCaller(req)) return next();
    const ent = await companyEntitlement(companyId);
    if (ent === null || ent.features[feature]) return next();
    refuseFeature(res, ent, feature);
  } catch (err) {
    next(err);
  }
}

function usageRefusal(
  res: Response,
  ent: Entitlement | null,
  metric: Exclude<UsageMetric, "team_members">,
  used: number,
  limit: number
): void {
  const key = METRIC_LIMIT_KEY[metric];
  const requiredPlan = ent?.state === "expired" ? "starter" : planWithMoreOf(key, used);
  res.status(402).json({
    message:
      ent?.state === "expired"
        ? "Your free trial has ended. Choose a plan to add new records; your data stays readable."
        : `Monthly ${metric.replace("_", " ")} limit reached on your plan. Upgrade for more.`,
    code: ent?.state === "expired" ? "PLAN_REQUIRED" : "USAGE_LIMIT_REACHED",
    messageKey:
      ent?.state === "expired"
        ? "forms.serverErrors.PLAN_REQUIRED"
        : `forms.serverErrors.USAGE_LIMIT_REACHED_${metric}`,
    resource: metric,
    currentUsage: used,
    limit,
    currentTier: ent?.planId ?? null,
    planState: ent?.state ?? null,
    upgrade: requiredPlan ? { requiredPlan, url: UPGRADE_URL } : { url: UPGRADE_URL },
  });
}

/** Central monthly usage meter and limit (402 USAGE_LIMIT_REACHED / PLAN_REQUIRED). */
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
    // AI credits are a cost cap and stay enforced whenever cost caps are on.
    const limitsOn = billingEnforced() || (metric === "ai_calls" && costCapsEnforced());
    const ent =
      limitsOn && !(await isExemptCaller(req)) ? await companyEntitlement(companyId) : null;
    const limit = ent ? ent.limits[METRIC_LIMIT_KEY[metric]] : UNLIMITED;

    if (metric === "team_members") {
      // Unlimited users on every plan (owner decision): seats are counted, never refused.
      if (ent && limit !== UNLIMITED && (await liveTeamCount(companyId)) >= limit) {
        res.status(402).json({
          message: "User limit reached on your plan.",
          code: "USAGE_LIMIT_REACHED",
          resource: metric,
          limit,
          currentTier: ent.planId,
          upgrade: { url: UPGRADE_URL },
        });
        return;
      }
      return next();
    }

    if (ent && limit !== UNLIMITED) {
      if (!(await reserveUsage(companyId, metric, limit))) {
        return usageRefusal(res, ent, metric, await getUsage(companyId, metric), limit);
      }
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

/** Uploads that add stored bytes to a company (storage cap, X6b). */
export const STORAGE_LIMIT_RULES: readonly GateRule[] = [
  { methods: "POST", pattern: "companies/*/receipts" },
  { methods: "POST", pattern: "journal/*/attachments" },
];

/**
 * Storage cap (402 STORAGE_LIMIT_REACHED). Refuses an upload that would take the company past its
 * plan's storage allowance, measured as stored receipt images plus journal attachments.
 */
export async function storageLimitPolicy(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!costCapsEnforced()) return next();
    const rule = matchGateRule(STORAGE_LIMIT_RULES, req.method, req.originalUrl || req.path, req);
    if (!rule) return next();
    const companyId = await gateCompany(req);
    if (!companyId) return next();
    if (await isExemptCaller(req)) return next();
    const ent = await companyEntitlement(companyId);
    if (ent === null) return next();
    const limitMb = ent.limits.maxStorageMb;
    if (limitMb === UNLIMITED) return next();
    const { companyStorageBytes } = await import("../services/storage-usage");
    const used = await companyStorageBytes(companyId);
    const incoming = Number(req.headers["content-length"] ?? 0) || 0;
    if (used + incoming > limitMb * 1024 * 1024) {
      const requiredPlan = planWithMoreOf("maxStorageMb", Math.ceil(used / (1024 * 1024)) + 1);
      res.status(402).json({
        message: `Storage limit reached on your plan (${limitMb} MB). Delete files or upgrade.`,
        code: ent.state === "expired" ? "PLAN_REQUIRED" : "STORAGE_LIMIT_REACHED",
        messageKey:
          ent.state === "expired"
            ? "forms.serverErrors.PLAN_REQUIRED"
            : "forms.serverErrors.STORAGE_LIMIT_REACHED",
        resource: "storage",
        currentUsageBytes: used,
        limitMb,
        currentTier: ent.planId,
        planState: ent.state,
        upgrade: requiredPlan ? { requiredPlan, url: UPGRADE_URL } : { url: UPGRADE_URL },
      });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Route-level variant kept for callers that mount it explicitly; same meter and 402 contract as
 * usageLimitPolicy.
 */
export function checkUsageLimit(resource: "invoices" | "receipts" | "aiCredits") {
  const metric: Exclude<UsageMetric, "team_members"> =
    resource === "aiCredits" ? "ai_calls" : resource;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const companyId = req.params.companyId || req.body?.companyId;
      if (!companyId || !billingEnforced()) return next();
      const ent = await companyEntitlement(companyId);
      if (ent === null) return next();
      const limit = ent.limits[METRIC_LIMIT_KEY[metric]];
      if (limit === UNLIMITED) return next();
      if (!(await reserveUsage(companyId, metric, limit))) {
        return usageRefusal(res, ent, metric, await getUsage(companyId, metric), limit);
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
 * Deliberate carve-outs, because the limit must not break real work:
 *   - Platform admins are exempt.
 *   - Firm users (any firmRole) are exempt — managing many client companies is the entire product
 *     for them, and firm seats are priced separately.
 *   - Skipped when cost caps are off (development / test default).
 *
 * The user's allowance is the BEST across the companies they own (a paid plan's, or the trial's
 * cap while a company is on trial), so upgrading any one company lifts the cap rather than
 * trapping them. A user whose companies all ended their trial without a plan cannot start new
 * trials by creating more companies.
 */
export function checkCompanyQuota() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!costCapsEnforced()) {
      next();
      return;
    }
    const user = req.user;
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

      let best = 0;
      let bestPlan: string | null = null;
      for (const c of owned) {
        const ent = await companyEntitlement(c.id);
        if (!ent) continue;
        const cap = ent.limits.maxCompanies === UNLIMITED ? Infinity : ent.limits.maxCompanies;
        if (cap > best) {
          best = cap;
          bestPlan = ent.state === "trial" ? "trial" : ent.planId;
        }
      }

      if (owned.length < best) {
        next();
        return;
      }
      const limit = best === Infinity ? UNLIMITED : best;
      const requiredPlan = planWithMoreOf("maxCompanies", owned.length);
      res.status(403).json({
        message: `Your plan allows ${limit} ${limit === 1 ? "company" : "companies"}. You already have ${owned.length}. Upgrade to add more.`,
        code: "COMPANY_LIMIT_REACHED",
        messageKey: "forms.serverErrors.COMPANY_LIMIT_REACHED",
        details: { planId: bestPlan, limit, current: owned.length },
        upgrade: requiredPlan ? { requiredPlan, url: UPGRADE_URL } : { url: UPGRADE_URL },
      });
    } catch (err) {
      // Never let quota accounting break company creation.
      log.warn({ err }, "Company quota check failed open");
      next();
    }
  };
}

/** Limits of a paid plan id; anything else (the planless "free") is the no-plan limits. */
export function getTierLimits(planId: string): PlanLimits {
  return isPaidPlanId(planId)
    ? { ...planDefinition(planId).limits }
    : resolveEntitlement({ planId: null }).limits;
}

/** Features of a paid plan id; anything else (the planless "free") has none. */
export function getTierFeatures(planId: string): Record<PlanFeature, boolean> {
  return isPaidPlanId(planId) ? planFeatures(planId) : { ...NO_FEATURES };
}

/** Public JSON for GET /api/billing/plans: shared/plans.ts, the pricing page's own source. */
export function getAllPlanDefinitions() {
  return publicPlanCatalog();
}
