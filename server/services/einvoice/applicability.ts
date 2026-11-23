import type { Invoice } from "../../../shared/schema";

/** Cash settlement does not exempt a business or government buyer. */
export function isB2cCashSale(
  invoice: Pick<Invoice, "source" | "customerTrn">,
  buyer?: { trn?: string | null; endpointId?: string | null }
): boolean {
  return (
    invoice.source === "cash_sale" &&
    !invoice.customerTrn?.trim() &&
    !buyer?.trn?.trim() &&
    !buyer?.endpointId?.trim()
  );
}

export const EINVOICE_NOT_REQUIRED = "EINVOICE_NOT_REQUIRED";
export const EINVOICE_NOT_REQUIRED_MESSAGE = "E-invoicing is not required for this cash sale.";
