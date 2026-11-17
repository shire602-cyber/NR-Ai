/*
 * Plan data for every surface that shows plans: /pricing, the landing pricing strip and the
 * in-app billing page (WP-E imports PlanCard from this folder). Prices live here once; JSX never
 * holds a figure. Copy is catalog keys (marketing namespace, en + ar). Gated rows mirror
 * TIER_FEATURES in server/middleware/featureGate.ts (tests/unit/commercial-plan-matrix.test.ts).
 * The trial itself (length, no card, "contact us" afterwards) is shared/trial.ts.
 */

export type PlanId = "free" | "starter" | "professional" | "enterprise";
export type BillingCycle = "monthly" | "quarterly" | "yearly";

export const BILLING_CYCLES: readonly BillingCycle[] = ["monthly", "quarterly", "yearly"];

/** Months billed together for each cycle. */
export const CYCLE_MONTHS: Record<BillingCycle, number> = { monthly: 1, quarterly: 3, yearly: 12 };

export interface Plan {
  id: PlanId;
  /** Per-month price in AED for each billing cycle. */
  price: Record<BillingCycle, number>;
  featured?: boolean;
  /** "trial" opens a workspace (/register); "contact" writes to us. */
  cta: "trial" | "contact";
  /** Catalog key of the "Everything in X, plus" lead-in above the bullets (upper tiers). */
  inheritsKey?: string;
  /** Five short differentiators, limits first (an equal count keeps the row free of blank blocks). */
  bulletKeys: readonly string[];
}

export const PLANS: readonly Plan[] = [
  {
    id: "free",
    price: { monthly: 0, quarterly: 0, yearly: 0 },
    cta: "trial",
    bulletKeys: [
      "marketing.prFreeB1",
      "marketing.prFreeB2",
      "marketing.prFreeB3",
      "marketing.prFreeB4",
      "marketing.prFreeB5",
    ],
  },
  {
    id: "starter",
    price: { monthly: 49, quarterly: 44, yearly: 39 },
    cta: "trial",
    inheritsKey: "marketing.prInheritsFree",
    bulletKeys: [
      "marketing.prStarterB1",
      "marketing.prStarterB2",
      "marketing.prStarterB3",
      "marketing.prStarterB4",
      "marketing.prStarterB5",
    ],
  },
  {
    id: "professional",
    price: { monthly: 149, quarterly: 134, yearly: 119 },
    featured: true,
    cta: "trial",
    inheritsKey: "marketing.prInheritsStarter",
    bulletKeys: [
      "marketing.prProB1",
      "marketing.prProB2",
      "marketing.prProB3",
      "marketing.prProB4",
      "marketing.prProB5",
    ],
  },
  {
    id: "enterprise",
    price: { monthly: 299, quarterly: 269, yearly: 239 },
    cta: "contact",
    inheritsKey: "marketing.prInheritsPro",
    bulletKeys: [
      "marketing.prEntB1",
      "marketing.prEntB2",
      "marketing.prEntB3",
      "marketing.prEntB4",
      "marketing.prEntB5",
    ],
  },
];

/** Catalog keys per plan: name and one-line audience. */
export const planNameKey = (id: PlanId) => `marketing.prPlan_${id}`;
export const planAudienceKey = (id: PlanId) => `marketing.prAudience_${id}`;

export function planPrice(plan: Plan, cycle: BillingCycle): number {
  return plan.price[cycle];
}

/** Amount charged per billing period (0 for monthly: nothing extra to state). */
export function billedTotal(plan: Plan, cycle: BillingCycle): number {
  return cycle === "monthly" ? 0 : plan.price[cycle] * CYCLE_MONTHS[cycle];
}

/**
 * Whole-percent saving a cycle gives against monthly, computed from the paid plans (the smallest
 * one, so the note is true for every plan). 0 for monthly.
 */
export function cycleSavingPercent(cycle: BillingCycle, plans: readonly Plan[] = PLANS): number {
  if (cycle === "monthly") return 0;
  const savings = plans
    .filter((p) => p.price.monthly > 0)
    .map((p) => (1 - p.price[cycle] / p.price.monthly) * 100);
  return savings.length ? Math.floor(Math.min(...savings)) : 0;
}

// ── Comparison table ─────────────────────────────────────────────────────────────────────────

/** true = included, false = not included, string = catalog key of a short value ("20 / month"). */
export type Cell = boolean | string;

export interface CompareRow {
  /** Catalog key of the row label. */
  key: string;
  /** Optional catalog key of a 12 px qualifier line under the label. */
  noteKey?: string;
  /** TIER_FEATURES flag enforced by server/middleware/featureGate.ts. */
  gate?: string;
  cells: Record<PlanId, Cell>;
}

export interface CompareGroup {
  key: string;
  /** Open on first paint. */
  open?: boolean;
  rows: CompareRow[];
}

const all = (v: Cell): Record<PlanId, Cell> => ({
  free: v,
  starter: v,
  professional: v,
  enterprise: v,
});
const from = (tier: PlanId): Record<PlanId, Cell> => {
  const order: PlanId[] = ["free", "starter", "professional", "enterprise"];
  const at = order.indexOf(tier);
  return Object.fromEntries(order.map((id, i) => [id, i >= at])) as Record<PlanId, Cell>;
};

/** 24 rows at most; rows that are identical on every plan live in "What every plan includes". */
export const COMPARE_GROUPS: readonly CompareGroup[] = [
  {
    key: "marketing.prGroupCore",
    open: true,
    rows: [
      {
        key: "marketing.prRowCompanies",
        cells: {
          free: "marketing.prVal1",
          starter: "marketing.prVal1",
          professional: "marketing.prVal3",
          enterprise: "marketing.prValUnlimited",
        },
      },
      {
        key: "marketing.prRowUsers",
        cells: {
          free: "marketing.prVal1",
          starter: "marketing.prVal3",
          professional: "marketing.prVal10",
          enterprise: "marketing.prValUnlimited",
        },
      },
      {
        key: "marketing.prRowDocuments",
        noteKey: "marketing.prRowDocumentsNote",
        cells: {
          free: "marketing.prVal20Month",
          starter: "marketing.prVal200Month",
          professional: "marketing.prValUnlimited",
          enterprise: "marketing.prValUnlimited",
        },
      },
      { key: "marketing.prRowMultiCurrency", gate: "multiCurrency", cells: from("starter") },
      { key: "marketing.prRowFixedAssets", gate: "fixedAssets", cells: from("professional") },
      { key: "marketing.prRowBudgets", cells: from("professional") },
      { key: "marketing.prRowMonthEnd", cells: from("professional") },
    ],
  },
  {
    key: "marketing.prGroupSales",
    open: true,
    rows: [
      { key: "marketing.prRowRecurring", gate: "recurringInvoices", cells: from("starter") },
      { key: "marketing.prRowPaymentLinks", gate: "invoicePayment", cells: from("starter") },
      { key: "marketing.prRowBillPay", cells: from("starter") },
      { key: "marketing.prRowInventory", cells: from("starter") },
      { key: "marketing.prRowExpenseClaims", cells: from("professional") },
      { key: "marketing.prRowBulkOps", gate: "bulkOps", cells: from("professional") },
      { key: "marketing.prRowPortal", cells: from("professional") },
    ],
  },
  {
    key: "marketing.prGroupTax",
    rows: [
      { key: "marketing.prRowCorporateTax", cells: from("professional") },
      {
        key: "marketing.prRowEInvoicing",
        noteKey: "marketing.prRowEInvoicingNote",
        cells: from("professional"),
      },
    ],
  },
  {
    key: "marketing.prGroupPayroll",
    rows: [{ key: "marketing.prRowPayroll", gate: "payroll", cells: from("professional") }],
  },
  {
    key: "marketing.prGroupAi",
    rows: [
      {
        key: "marketing.prRowAiCategorise",
        cells: { ...all(true), free: "marketing.prValBasic" },
      },
      {
        key: "marketing.prRowAiReceipts",
        noteKey: "marketing.prRowAiReceiptsNote",
        cells: from("starter"),
      },
      { key: "marketing.prRowAiAssistant", cells: from("professional") },
      { key: "marketing.prRowAiPriority", cells: from("enterprise") },
    ],
  },
  {
    key: "marketing.prGroupTeam",
    rows: [
      { key: "marketing.prRowApi", gate: "apiAccess", cells: from("enterprise") },
      { key: "marketing.prRowWebhooks", gate: "webhooks", cells: from("enterprise") },
      { key: "marketing.prRowManager", cells: from("enterprise") },
    ],
  },
];

/** "What every plan includes": icon name (lucide) + catalog keys. Only claims the landing makes. */
export const EVERY_PLAN = [
  {
    id: "invoices",
    title: "marketing.prEveryInvoicesTitle",
    body: "marketing.prEveryInvoicesBody",
  },
  { id: "vat", title: "marketing.prEveryVatTitle", body: "marketing.prEveryVatBody" },
  { id: "ledger", title: "marketing.prEveryLedgerTitle", body: "marketing.prEveryLedgerBody" },
  { id: "bilingual", title: "marketing.prEveryArabicTitle", body: "marketing.prEveryArabicBody" },
  { id: "bank", title: "marketing.prEveryBankTitle", body: "marketing.prEveryBankBody" },
  { id: "exports", title: "marketing.prEveryExportsTitle", body: "marketing.prEveryExportsBody" },
] as const;
