import { DEADLINES } from "../home/deadlines";
import { invoiceTotals } from "../home/tour/model";
import { INVOICE_LINES } from "../home/tour/sample";
import { vatBreakdown } from "../vat-calculator";

/** A calendar date from the deadline table, in Western digits for both languages. */
export function formatDeadlineDate(iso: string, locale: "en" | "ar"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** Live mini-previews for the free-tools index, built from the same logic as the tools. */

/** Corporate tax on taxable income, in fils: 0% up to AED 375,000 and 9% above (as the estimator). */
export function corporateTaxFils(incomeFils: number): number {
  return Math.round((Math.max(0, incomeFils - 37_500_000) * 9) / 100);
}

const VAT_EXAMPLE_FILS = 100_000;
const CT_EXAMPLE_FILS = 50_000_000;

export function vatPreview() {
  return vatBreakdown(VAT_EXAMPLE_FILS, "add", "standard");
}

export function corporateTaxPreview() {
  return { incomeFils: CT_EXAMPLE_FILS, taxFils: corporateTaxFils(CT_EXAMPLE_FILS) };
}

export function invoicePreview() {
  const totals = invoiceTotals(INVOICE_LINES);
  return { net: totals.subtotalFils, vat: totals.vatFils, gross: totals.totalFils };
}

/** First deadline a business under AED 50m meets (ISO date, Dubai calendar). */
export function readinessPreviewDate() {
  return DEADLINES.small.appoint;
}
