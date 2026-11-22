/**
 * UAE e-invoicing scope switch (R07-13): who must e-invoice and from when.
 *
 * Phased timeline as published by the UAE Ministry of Finance (Ministerial
 * Decisions 243 and 244 of 2025; NOT independently verified, so the UI presents them as guidance
 * to confirm per entity). Revenue threshold for "large" is AED 50 million. A
 * company may store an explicit go-live date (e.g. a voluntary early
 * adoption, or a revised FTA date) which overrides the band.
 */

import { calendarDateKey, uaeToday } from "../../../shared/uae-date";

export type EInvoiceScope = "b2b" | "b2g" | "b2b_b2g" | "none";
export type TurnoverBand = "large" | "standard" | "government";

export const LARGE_BUSINESS_REVENUE_AED = 50_000_000;

export const EINVOICE_TIMELINE: Record<
  TurnoverBand,
  { appointAspBy: string; goLive: string; label: { en: string; ar: string } }
> = {
  large: {
    appointAspBy: "2026-07-31",
    goLive: "2027-01-01",
    label: {
      en: "Revenue of AED 50 million or more",
      ar: "إيرادات 50 مليون درهم أو أكثر",
    },
  },
  standard: {
    appointAspBy: "2027-03-31",
    goLive: "2027-07-01",
    label: { en: "Revenue below AED 50 million", ar: "إيرادات أقل من 50 مليون درهم" },
  },
  government: {
    appointAspBy: "2027-03-31",
    goLive: "2027-10-01",
    label: { en: "Government entity", ar: "جهة حكومية" },
  },
};

export interface ScopeInput {
  einvoiceScope?: string | null;
  einvoiceTurnoverBand?: string | null;
  einvoiceGoLiveDate?: string | Date | null;
}

export interface ScopeStatus {
  scope: EInvoiceScope | null;
  band: TurnoverBand | null;
  goLiveDate: string | null;
  appointAspBy: string | null;
  source: "override" | "band" | "unset";
  /** True from the go-live date onward for an in-scope company. */
  mandatory: boolean;
  daysToGoLive: number | null;
}

export function einvoicingScope(company: ScopeInput, today: Date = new Date()): ScopeStatus {
  const scope = (["b2b", "b2g", "b2b_b2g", "none"] as const).includes(
    company.einvoiceScope as EInvoiceScope
  )
    ? (company.einvoiceScope as EInvoiceScope)
    : null;
  const band = (["large", "standard", "government"] as const).includes(
    company.einvoiceTurnoverBand as TurnoverBand
  )
    ? (company.einvoiceTurnoverBand as TurnoverBand)
    : null;
  const override = calendarDateKey(company.einvoiceGoLiveDate) || null;
  const goLiveDate = override ?? (band ? EINVOICE_TIMELINE[band].goLive : null);
  const todayIso = uaeToday(today);
  const daysToGoLive = goLiveDate
    ? Math.round((Date.parse(goLiveDate) - Date.parse(todayIso)) / 86_400_000)
    : null;
  return {
    scope,
    band,
    goLiveDate,
    appointAspBy: band ? EINVOICE_TIMELINE[band].appointAspBy : null,
    source: override ? "override" : band ? "band" : "unset",
    mandatory: scope !== null && scope !== "none" && goLiveDate !== null && todayIso >= goLiveDate,
    daysToGoLive,
  };
}

export function bandForRevenue(annualRevenueAed: number): TurnoverBand {
  return annualRevenueAed >= LARGE_BUSINESS_REVENUE_AED ? "large" : "standard";
}

/**
 * Does FTA reporting apply to this company today? True only when an e-invoicing scope is chosen
 * (not "none") AND its go-live date has been reached. The go-live date is the band's date from the
 * published MoF timeline, or the company's explicit go-live override (a voluntary early opt-in).
 * Before that, nothing is "required" and no report-by deadline exists.
 */
export function einvoiceMandateApplies(company: ScopeInput, today: Date = new Date()): boolean {
  return einvoicingScope(company, today).mandatory;
}
