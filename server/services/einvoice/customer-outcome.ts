import type { EInvoiceDocument, Invoice } from "../../../shared/schema";
import { getEInvoiceDocument } from "./store";
import { storedReportingEvidence, providerRecipientAcknowledgement } from "./tracks";

type InvoiceReference = Pick<
  Invoice,
  "einvoiceStatus" | "einvoiceProvider" | "einvoiceProviderMessageId"
>;

export type EInvoiceCustomerEvidence = Pick<
  EInvoiceDocument,
  | "status"
  | "provider"
  | "providerMessageId"
  | "providerStatus"
  | "deliveryStatus"
  | "reportingStatus"
  | "validation"
>;

/** Public outcome for an already authorized invoice. Only the result is safe to return. */
export function customerEInvoiceStatus(
  invoice: InvoiceReference,
  evidence: EInvoiceCustomerEvidence | null | undefined
): string | null {
  const stored = evidence?.status ?? invoice.einvoiceStatus;
  if (!stored) return null;
  const provider = evidence?.provider ?? invoice.einvoiceProvider;
  const providerMessageId = evidence?.providerMessageId ?? invoice.einvoiceProviderMessageId;
  const consistent =
    (!evidence?.provider ||
      !invoice.einvoiceProvider ||
      evidence.provider === invoice.einvoiceProvider) &&
    (!evidence?.providerMessageId ||
      !invoice.einvoiceProviderMessageId ||
      evidence.providerMessageId === invoice.einvoiceProviderMessageId);
  if (consistent && providerMessageId) {
    if (evidence?.deliveryStatus === "rejected") return "rejected";
    if (evidence?.deliveryStatus === "delivery_failed") return "failed";
    if (!evidence?.deliveryStatus || evidence.deliveryStatus === "delivered") {
      const acknowledgement = providerRecipientAcknowledgement(provider, evidence?.providerStatus);
      if (acknowledgement === "received") return "delivered";
      if (acknowledgement === "accepted") {
        return storedReportingEvidence(evidence, provider) === "reported" ? "cleared" : "accepted";
      }
    }
  }
  if (stored === "cleared" || stored === "accepted" || stored === "delivered") {
    return consistent && providerMessageId ? "submitted" : "generated";
  }
  return stored;
}

export async function getCustomerEInvoiceStatus(invoice: Invoice) {
  return customerEInvoiceStatus(invoice, await getEInvoiceDocument(invoice.companyId, invoice.id));
}
