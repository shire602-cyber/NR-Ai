import { DomainError } from "../errors";
import { UAE_STANDARD_VAT_RATE, isUaeVatRateFraction } from "../../shared/vat-classification";

/**
 * The one UAE VAT-rate rule for stored rates (company default, product rate): 0% or 5% only.
 * Exempt and out-of-scope are supply treatments, not rates. Throws 422 VAT_RATE_NOT_FOR_COUNTRY.
 */
export function assertUaeVatRate(rate: unknown, field: string, label: string): void {
  if (isUaeVatRateFraction(rate)) return;
  const pct = Math.round(UAE_STANDARD_VAT_RATE * 100);
  throw new DomainError(
    "VAT_RATE_NOT_FOR_COUNTRY",
    422,
    { fields: { [field]: [`Use 0% or ${pct}%`] } },
    `The ${label} must be 0% or ${pct}%, the UAE standard rate.`
  );
}
