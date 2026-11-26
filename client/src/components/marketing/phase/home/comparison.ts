import { PLAN_MONTHLY_PRICES, planPrice, type PaidPlanId } from "@shared/plans";
import { vatBreakdown } from "../vat-calculator";
import {
  COMPETITOR_PRICES,
  WAFEQ_ENTRY,
  WAFEQ_TOP,
  ZOHO_ENTRY_PAID,
  ZOHO_TOP,
} from "./competitor-prices";
import type { MarketingKey } from "./text";

export type ComparisonColumn = "muhasib" | "wafeq" | "zoho";

/** A cell is a locale key (with numeric vars) or, with no key, a dash: "not confirmed", never "No". */
export interface ComparisonCell {
  key?: MarketingKey;
  vars?: Record<string, number>;
  source?: string;
  sourceLabelKey?: MarketingKey;
  checked?: string;
}

export interface ComparisonRow {
  id: string;
  labelKey: MarketingKey;
  cells: Record<ComparisonColumn, ComparisonCell>;
}

const CHECKED = COMPETITOR_PRICES.lastChecked;
const WAFEQ_SRC = COMPETITOR_PRICES.wafeq.source;
const ZOHO_SRC = COMPETITOR_PRICES.zoho.source;
const ZOHO_EINVOICING_SRC = "https://www.zoho.com/ae/books/e-invoicing/";
const ZOHO_EINVOICING_HELP_SRC = "https://www.zoho.com/ae/books/help/e-invoicing/";
const ZOHO_SIGNUP_SRC = "https://www.zoho.com/ae/books/signup/";
const WAFEQ_INVOICE_SRC = "https://www.wafeq.com/en-ae/create-invoice-online";
const WAFEQ_ACCOUNTANTS_SRC = "https://www.wafeq.com/en-ae/accountants";

const wafeq = (cell: ComparisonCell = {}): ComparisonCell => ({
  source: WAFEQ_SRC,
  checked: CHECKED,
  ...cell,
});
const zoho = (cell: ComparisonCell = {}): ComparisonCell => ({
  source: ZOHO_SRC,
  checked: CHECKED,
  ...cell,
});
const yes: ComparisonCell = { key: "hxCmpYes" };

function includingVat(aed: number): number {
  return vatBreakdown(aed * 100, "add", "standard").gross / 100;
}

/**
 * Muhasib's price cell: the monthly price and the annual-billing price per month, both from
 * shared/plans.ts (VAT included there, like the footnote says). Per month = yearly / 12, rounded
 * to whole fils (two decimals) like the competitors' VAT-inclusive figures in this table.
 */
export function muhasibPriceCell(plan: PaidPlanId): ComparisonCell {
  return {
    key: "hxCmpPriceYearly",
    vars: {
      monthly: PLAN_MONTHLY_PRICES[plan],
      yearly: Math.round((planPrice(plan, "yearly") / 12) * 100) / 100,
    },
  };
}

/*
 * Vendor pricing pages cover prices. Zoho's sign-up page covers its trial; its e-invoicing page
 * covers the included allowance and packs, and its e-invoicing help page the bilingual PDF for
 * Peppol invoices. Wafeq's UAE invoice page covers invoices in Arabic, English, or both, and
 * its accountants page covers concurrent multi-client management (not a client portal).
 * Cells with no `key` render as a dash.
 */
export const COMPARISON_ROWS: readonly ComparisonRow[] = [
  {
    id: "entry",
    labelKey: "hxCmpRowEntry",
    cells: {
      muhasib: muhasibPriceCell("starter"),
      wafeq: wafeq({
        key: "hxCmpPriceYearly",
        vars: {
          monthly: includingVat(WAFEQ_ENTRY.monthly),
          yearly: includingVat(WAFEQ_ENTRY.yearly),
        },
      }),
      zoho: zoho({ key: "hxCmpZohoEntry", vars: { price: includingVat(ZOHO_ENTRY_PAID.annual) } }),
    },
  },
  {
    id: "top",
    labelKey: "hxCmpRowTop",
    cells: {
      muhasib: muhasibPriceCell("enterprise"),
      wafeq: wafeq({
        key: "hxCmpPriceYearly",
        vars: { monthly: includingVat(WAFEQ_TOP.monthly), yearly: includingVat(WAFEQ_TOP.yearly) },
      }),
      zoho: zoho({ key: "hxCmpZohoTop", vars: { price: includingVat(ZOHO_TOP.annual) } }),
    },
  },
  {
    id: "trial",
    labelKey: "hxCmpRowTrial",
    cells: {
      muhasib: { key: "hxCmpTrialMuhasib" },
      wafeq: wafeq({ key: "hxCmpTrialWafeq" }),
      zoho: zoho({
        key: "hxCmpTrialZoho",
        source: ZOHO_SIGNUP_SRC,
        sourceLabelKey: "hxCmpSrcZohoSignup",
      }),
    },
  },
  {
    id: "einvoicing",
    labelKey: "hxCmpRowEinv",
    cells: {
      muhasib: { key: "hxCmpEinvMuhasib" },
      wafeq: wafeq({ key: "hxCmpEinvWafeq" }),
      zoho: zoho({
        key: "hxCmpEinvZoho",
        source: ZOHO_EINVOICING_SRC,
        sourceLabelKey: "hxCmpSrcZohoEinv",
      }),
    },
  },
  {
    id: "bilingual",
    labelKey: "hxCmpRowBilingual",
    cells: {
      muhasib: yes,
      wafeq: wafeq({
        ...yes,
        source: WAFEQ_INVOICE_SRC,
        sourceLabelKey: "hxCmpSrcWafeqInvoices",
      }),
      zoho: zoho({
        key: "hxCmpBilingualZoho",
        source: ZOHO_EINVOICING_HELP_SRC,
        sourceLabelKey: "hxCmpSrcZohoEinv",
      }),
    },
  },
  {
    id: "vat201",
    labelKey: "hxCmpRowVat",
    cells: { muhasib: yes, wafeq: wafeq(yes), zoho: zoho(yes) },
  },
  {
    id: "wps",
    labelKey: "hxCmpRowWps",
    cells: { muhasib: yes, wafeq: wafeq(), zoho: zoho() },
  },
  {
    id: "firm",
    labelKey: "hxCmpRowFirm",
    cells: {
      muhasib: yes,
      wafeq: wafeq({
        key: "hxCmpFirmWafeq",
        source: WAFEQ_ACCOUNTANTS_SRC,
        sourceLabelKey: "hxCmpSrcWafeqAccountants",
      }),
      zoho: zoho(),
    },
  },
];

export const COMPARISON_SOURCES = {
  wafeq: {
    url: WAFEQ_SRC,
    labelKey: "hxCmpSrcWafeq",
    pageKey: "hxCmpLinkWafeq",
    vsKey: "hxFootCompareWafeq",
    path: "wafeq",
  },
  zoho: {
    url: ZOHO_SRC,
    labelKey: "hxCmpSrcZoho",
    pageKey: "hxCmpLinkZoho",
    vsKey: "hxFootCompareZoho",
    path: "zoho",
  },
} as const satisfies Record<
  Exclude<ComparisonColumn, "muhasib">,
  { url: string; labelKey: MarketingKey; pageKey: MarketingKey; vsKey: MarketingKey; path: string }
>;

/** Vendor names are brand data: shown as-is, never translated. */
export const VENDOR_NAME: Record<"wafeq" | "zoho", string> = {
  wafeq: "Wafeq",
  zoho: "Zoho Books",
};

export function visibleColumns(focus?: "wafeq" | "zoho"): ComparisonColumn[] {
  return focus ? ["muhasib", focus] : ["muhasib", "wafeq", "zoho"];
}
