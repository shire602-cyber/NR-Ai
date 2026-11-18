/*
 * Plan data for every surface that shows plans: /pricing, the landing pricing strip and the
 * in-app billing page. Ids, prices, limits and which plan includes which module come from the one
 * plan module, shared/plans.ts (also read by the server gates and GET /api/billing/plans); this
 * file only adds catalog keys (marketing namespace, en + ar). JSX never holds a figure, and a
 * comparison cell for a gated module is computed from the shared matrix, never typed by hand
 * (tests/unit/commercial-plan-matrix.test.ts).
 */
import {
  BILLING_CYCLES as SHARED_CYCLES,
  PLAN_DEFINITIONS,
  UNLIMITED,
  YEARLY_FREE_MONTHS,
  planIncludes,
  planPrice as sharedPlanPrice,
  type BillingCycle as SharedCycle,
  type PaidPlanId,
  type PlanFeature,
  type PlanLimits,
} from "@shared/plans";

export type PlanId = PaidPlanId;
export type BillingCycle = SharedCycle;

export const BILLING_CYCLES: readonly BillingCycle[] = SHARED_CYCLES;

export interface Plan {
  id: PlanId;
  /** Price per month in AED when billed monthly. */
  monthlyPrice: number;
  featured?: boolean;
  /** "trial" opens a workspace (/register); "contact" writes to us. */
  cta: "trial" | "contact";
  /** Catalog key of the "Everything in X, plus" lead-in above the bullets (upper tiers). */
  inheritsKey?: string;
  /** Five short differentiators, limits first (an equal count keeps the row free of blank blocks). */
  bulletKeys: readonly string[];
}

const COPY: Record<PlanId, Pick<Plan, "inheritsKey" | "bulletKeys">> = {
  starter: {
    bulletKeys: [
      "marketing.prStarterB1u",
      "marketing.prStarterB2",
      "marketing.prStarterB3",
      "marketing.prStarterB4",
      "marketing.prStarterB5",
    ],
  },
  professional: {
    inheritsKey: "marketing.prInheritsStarter",
    bulletKeys: [
      "marketing.prProB1u",
      "marketing.prProB2",
      "marketing.prProB3w",
      "marketing.prProB4",
      "marketing.prProB5",
    ],
  },
  enterprise: {
    inheritsKey: "marketing.prInheritsPro",
    bulletKeys: [
      "marketing.prEntB1",
      "marketing.prEntB2",
      "marketing.prEntB3",
      "marketing.prEntB4u",
      "marketing.prEntB5",
    ],
  },
};

export const PLANS: readonly Plan[] = PLAN_DEFINITIONS.map((p) => ({
  id: p.id,
  monthlyPrice: p.monthlyPrice,
  featured: p.featured,
  cta: p.cta,
  ...COPY[p.id],
}));

/** Catalog keys per plan: name and one-line audience. */
export const planNameKey = (id: PlanId) => `marketing.prPlan_${id}`;
export const planAudienceKey = (id: PlanId) => `marketing.prAudience_${id}`;

/** Price for the billing period: a month's, or a year's (10 × monthly). */
export function planPrice(plan: Plan, cycle: BillingCycle): number {
  return sharedPlanPrice(plan.id, cycle);
}

/** What paying a year up front saves against twelve monthly payments, in AED. */
export function yearlySaving(plan: Plan): number {
  return sharedPlanPrice(plan.id, "monthly") * 12 - sharedPlanPrice(plan.id, "yearly");
}

/** Months free when paying yearly (2), for the saving note. */
export const YEARLY_FREE = YEARLY_FREE_MONTHS;

// ── Comparison table ─────────────────────────────────────────────────────────────────────────

/** true = included, false = not included, number = a limit, string = catalog key ("Unlimited"). */
export type Cell = boolean | number | string;

export interface CompareRow {
  /** Catalog key of the row label. */
  key: string;
  /** Optional catalog key of a 12 px qualifier line under the label. */
  noteKey?: string;
  /** Feature flag the server gates (shared/plans.ts); its cells come from the shared matrix. */
  gate?: PlanFeature;
  /** Limit the server enforces (shared/plans.ts); its cells come from the shared limits. */
  limit?: keyof PlanLimits;
  /** Unit for a numeric limit ("gb" shows megabytes as gigabytes). */
  unit?: "gb";
  cells: Record<PlanId, Cell>;
}

export interface CompareGroup {
  key: string;
  /** Open on first paint. */
  open?: boolean;
  rows: CompareRow[];
}

const IDS = PLAN_DEFINITIONS.map((p) => p.id);

const gated = (key: string, gate: PlanFeature, noteKey?: string): CompareRow => ({
  key,
  gate,
  noteKey,
  cells: Object.fromEntries(IDS.map((id) => [id, planIncludes(id, gate)])) as Record<PlanId, Cell>,
});

const limited = (
  key: string,
  limit: keyof PlanLimits,
  opts: { noteKey?: string; unit?: "gb" } = {}
): CompareRow => ({
  key,
  limit,
  ...opts,
  cells: Object.fromEntries(
    PLAN_DEFINITIONS.map((p) => {
      const v = p.limits[limit];
      if (v === UNLIMITED) return [p.id, "marketing.prValUnlimited"];
      return [p.id, opts.unit === "gb" ? Math.round(v / 1024) : v];
    })
  ) as Record<PlanId, Cell>,
});

const service = (key: string, from: PlanId): CompareRow => ({
  key,
  cells: Object.fromEntries(IDS.map((id) => [id, IDS.indexOf(id) >= IDS.indexOf(from)])) as Record<
    PlanId,
    Cell
  >,
});

/**
 * Only what the plans differ on (spec 3.1: at most 24 rows; rows identical on every plan live in
 * "What every plan includes"). Every gated or limited row is enforced by the server.
 */
export const COMPARE_GROUPS: readonly CompareGroup[] = [
  {
    key: "marketing.prGroupCore",
    open: true,
    rows: [
      limited("marketing.prRowCompanies", "maxCompanies"),
      limited("marketing.prRowDocuments", "maxInvoicesPerMonth", {
        noteKey: "marketing.prRowDocumentsNote",
      }),
      limited("marketing.prRowStorage", "maxStorageMb", {
        unit: "gb",
        noteKey: "marketing.prRowStorageNote",
      }),
      gated("marketing.prRowFixedAssets", "fixedAssets"),
      gated("marketing.prRowBudgets", "budgets"),
      gated("marketing.prRowMonthEnd", "monthEnd"),
      gated("marketing.prRowCostCentres", "costCenters"),
    ],
  },
  {
    key: "marketing.prGroupSales",
    open: true,
    rows: [
      gated("marketing.prRowPurchaseOrders", "purchaseOrders"),
      gated("marketing.prRowExpenseClaims", "expenseClaims"),
      gated("marketing.prRowBulkOps", "bulkOps"),
      gated("marketing.prRowPortal", "customerPortal"),
    ],
  },
  {
    key: "marketing.prGroupTax",
    rows: [gated("marketing.prRowCorporateTax", "corporateTax")],
  },
  {
    key: "marketing.prGroupPayroll",
    rows: [gated("marketing.prRowPayroll", "payroll")],
  },
  {
    key: "marketing.prGroupAi",
    rows: [
      gated("marketing.prRowAiAssistantAsk", "aiAssistant"),
      limited("marketing.prRowAiCredits", "aiCreditsPerMonth", {
        noteKey: "marketing.prRowAiCreditsNote",
      }),
    ],
  },
  {
    key: "marketing.prGroupTeam",
    rows: [
      gated("marketing.prRowApi", "apiAccess"),
      gated("marketing.prRowWebhooks", "webhooks"),
      service("marketing.prRowManager", "enterprise"),
    ],
  },
];

/** "What every plan includes": icon name (lucide) + catalog keys. Only claims the product makes. */
export const EVERY_PLAN = [
  { id: "users", title: "marketing.prEveryUsersTitle", body: "marketing.prEveryUsersBody" },
  {
    id: "invoices",
    title: "marketing.prEveryInvoicesTitle",
    body: "marketing.prEveryInvoicesBody",
  },
  { id: "vat", title: "marketing.prEveryVatTitle", body: "marketing.prEveryVatBody" },
  { id: "ledger", title: "marketing.prEveryLedgerTitle", body: "marketing.prEveryLedgerBody" },
  { id: "bilingual", title: "marketing.prEveryArabicTitle", body: "marketing.prEveryArabicBody" },
  { id: "bank", title: "marketing.prEveryBankTitle", body: "marketing.prEveryBankBody" },
  {
    id: "currency",
    title: "marketing.prEveryCurrencyTitle",
    body: "marketing.prEveryCurrencyBody",
  },
  {
    id: "recurring",
    title: "marketing.prEveryRecurringTitle",
    body: "marketing.prEveryRecurringBody",
  },
  {
    id: "inventory",
    title: "marketing.prEveryInventoryTitle",
    body: "marketing.prEveryInventoryBody",
  },
  {
    id: "einvoice",
    title: "marketing.prEveryEinvoiceTitle",
    body: "marketing.prEveryEinvoiceBody",
  },
  { id: "ai", title: "marketing.prEveryAiTitle", body: "marketing.prEveryAiBody" },
  { id: "exports", title: "marketing.prEveryExportsTitle", body: "marketing.prEveryExportsBody" },
] as const;

/** Features every plan includes (shown in EVERY_PLAN; gated only after a trial without a plan). */
export const EVERY_PLAN_FEATURES: readonly PlanFeature[] = [
  "bookkeeping",
  "multiCurrency",
  "recurringInvoices",
  "invoicePayment",
];
