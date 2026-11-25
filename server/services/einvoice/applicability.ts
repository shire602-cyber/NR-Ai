import type { EInvoiceDocument, Invoice } from "../../../shared/schema";

import { documentSubmissionSnapshot, submissionProviderPin } from "./store";

/** Cash settlement does not exempt a business or government buyer. */
export function isB2cCashSale(invoice: Pick<Invoice, "source" | "buyerType">): boolean {
  return invoice.source === "cash_sale" && invoice.buyerType === "consumer";
}

/** Only generated previews can be discarded when changing the buyer. */
export function canRemediateCashSaleBuyer(
  invoice: Invoice,
  doc?: EInvoiceDocument | null
): boolean {
  return (
    invoice.source === "cash_sale" &&
    invoice.status === "paid" &&
    [null, "not_generated", "generated"].includes(invoice.einvoiceStatus) &&
    !invoice.einvoiceProvider &&
    !invoice.einvoiceSubmittedAt &&
    !doc?.provider &&
    !doc?.submittedAt &&
    !doc?.attempts &&
    !documentSubmissionSnapshot(doc)?.operationId &&
    submissionProviderPin(invoice, doc ?? undefined) === undefined &&
    (!doc || doc.status === "generated")
  );
}

export const EINVOICE_NOT_REQUIRED = "EINVOICE_NOT_REQUIRED";
export const EINVOICE_NOT_REQUIRED_MESSAGE = "E-invoicing is not required for this cash sale.";
