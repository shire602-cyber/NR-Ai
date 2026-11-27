/**
 * Public list prices of competitors, AED per month, excl. VAT. The ONE place these numbers live
 * (savings calculator and comparison table both read it). Muhasib's own prices are NOT here: read
 * them from `shared/plans.ts`. Never convert currencies or guess: no AED price means `null`.
 */
export const COMPETITOR_PRICES = {
  lastChecked: "2026-11-24",
  note: "as listed on vendor sites, excl. VAT",
  wafeq: {
    source: "https://www.wafeq.com/en-ae/pricing",
    plans: [
      { name: "Starter", monthly: 69, yearly: 57 },
      { name: "Plus", monthly: 99, yearly: 80 },
      { name: "Premium", monthly: 249, yearly: 200 },
    ],
  },
  zoho: {
    source: "https://www.zoho.com/ae/books/pricing/",
    /** Per month, billed annually. */
    plans: [
      { name: "Free", annual: 0 },
      { name: "Standard", annual: 60 },
      { name: "Professional", annual: 90 },
      { name: "Premium", annual: 120 },
      { name: "Elite", annual: 280 },
    ],
  },
  xero: {
    /** Xero lists UAE prices in USD on its site; we never convert or guess. */
    aedListPrice: null,
    noteKey: "hxSavXeroNote",
  },
} as const;

function wafeqPlan(name: string) {
  const plan = COMPETITOR_PRICES.wafeq.plans.find((p) => p.name === name);
  if (!plan) throw new Error(`Unknown Wafeq plan ${name}`);
  return plan;
}
function zohoPlan(name: string) {
  const plan = COMPETITOR_PRICES.zoho.plans.find((p) => p.name === name);
  if (!plan) throw new Error(`Unknown Zoho plan ${name}`);
  return plan;
}

export const WAFEQ_ENTRY = wafeqPlan("Starter");
export const WAFEQ_TOP = wafeqPlan("Premium");
export const ZOHO_ENTRY_PAID = zohoPlan("Standard");
export const ZOHO_TOP = zohoPlan("Elite");

export type CompetitorId = "wafeq" | "zoho" | "xero" | "sheet" | "other";

export interface Comparator {
  id: CompetitorId;
  /** Brand name shown as-is (not translated); null where the label comes from a locale key. */
  brand: string | null;
  /** Plan compared, e.g. "Premium". */
  plan: string | null;
  /** AED per month used for the yearly comparison (cheapest public billing option), or null. */
  perMonth: number | null;
  /** Locale-key stem for the note shown when there is no number. */
  note: "hxSavXeroNote" | "hxSavSheetNote" | "hxSavOtherNote" | null;
}

/**
 * The "current software" options. Rule: Wafeq Premium and Zoho Books Professional, each at the
 * cheaper public billing option (yearly / annual), so the comparison never flatters Muhasib.
 */
export const COMPARATORS: readonly Comparator[] = [
  {
    id: "wafeq",
    brand: "Wafeq",
    plan: "Premium",
    perMonth: wafeqPlan("Premium").yearly,
    note: null,
  },
  {
    id: "zoho",
    brand: "Zoho Books",
    plan: "Professional",
    perMonth: zohoPlan("Professional").annual,
    note: null,
  },
  {
    id: "xero",
    brand: "Xero",
    plan: null,
    perMonth: COMPETITOR_PRICES.xero.aedListPrice,
    note: "hxSavXeroNote",
  },
  { id: "sheet", brand: null, plan: null, perMonth: 0, note: "hxSavSheetNote" },
  { id: "other", brand: null, plan: null, perMonth: null, note: "hxSavOtherNote" },
];
