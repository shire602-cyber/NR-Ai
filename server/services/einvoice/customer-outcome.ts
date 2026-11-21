import type { EInvoiceDocument, Invoice } from "../../../shared/schema";
import { documentProviderEnvironment, getEInvoiceDocument } from "./store";
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
export function customerEInvoiceOutcome(
  invoice: InvoiceReference,
  evidence: EInvoiceCustomerEvidence | null | undefined
) {
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
  const pinned = consistent && providerMessageId ? documentProviderEnvironment(evidence) : null;
  const environment = pinned === "sandbox" || pinned === "production" ? pinned : null;
  const outcome = (status: string) => ({ status, environment });
  if (consistent && providerMessageId) {
    if (evidence?.deliveryStatus === "rejected") return outcome("rejected");
    if (evidence?.deliveryStatus === "delivery_failed") return outcome("failed");
    if (!evidence?.deliveryStatus || evidence.deliveryStatus === "delivered") {
      const acknowledgement = providerRecipientAcknowledgement(provider, evidence?.providerStatus);
      if (acknowledgement === "received") return outcome("delivered");
      if (acknowledgement === "accepted") {
        return outcome(
          storedReportingEvidence(evidence, provider) === "reported" ? "cleared" : "accepted"
        );
      }
    }
  }
  if (stored === "cleared" || stored === "accepted" || stored === "delivered") {
    return outcome(consistent && providerMessageId ? "submitted" : "generated");
  }
  return outcome(stored);
}

export async function getCustomerEInvoiceOutcome(invoice: Invoice) {
  return customerEInvoiceOutcome(invoice, await getEInvoiceDocument(invoice.companyId, invoice.id));
}
