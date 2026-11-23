import type { Invoice } from "../../../shared/schema";

/** Cash settlement does not exempt a business or government buyer. */
export function isB2cCashSale(invoice: Pick<Invoice, "source" | "buyerType">): boolean {
  return invoice.source === "cash_sale" && invoice.buyerType === "consumer";
}

export const EINVOICE_NOT_REQUIRED = "EINVOICE_NOT_REQUIRED";
export const EINVOICE_NOT_REQUIRED_MESSAGE = "E-invoicing is not required for this cash sale.";
