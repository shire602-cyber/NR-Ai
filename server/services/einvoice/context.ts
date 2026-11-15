/**
 * Everything the PINT AE generator needs beyond the invoice row: the buyer's
 * address and identifiers (customer contact + einvoice_buyer_endpoints) and
 * the original invoice for credit/debit notes. Tenant-scoped: a contact or
 * original invoice from another company is ignored.
 */
import type { Company, Invoice } from "../../../shared/schema";
import { storage } from "../../storage";
import type { EInvoiceContext } from "../einvoice-submit.service";
import { countryCode, type EInvoiceParty } from "../einvoice.service";
import type { LegalIdType } from "./pint-ae-codes";
import { getBuyerEndpoint } from "./store";

export async function loadEInvoiceContext(
  invoice: Invoice,
  company: Company
): Promise<EInvoiceContext> {
  const customer: Partial<EInvoiceParty> & { name?: string } = {
    name: invoice.customerName,
    trn: invoice.customerTrn || null,
    address: invoice.customerAddress || null,
  };
  if (invoice.contactId) {
    const contact = await storage.getCustomerContact(invoice.contactId);
    if (contact && contact.companyId === company.id) {
      customer.address = invoice.customerAddress || contact.address || null;
      customer.city = contact.city || null;
      customer.emirate =
        (invoice as Invoice & { placeOfSupplyEmirate?: string | null }).placeOfSupplyEmirate ||
        contact.emirate ||
        null;
      customer.country = countryCode(contact.country);
      customer.trn = invoice.customerTrn || contact.trnNumber || null;
      customer.email = contact.email || null;
      customer.phone = contact.phone || null;
      const endpoint = await getBuyerEndpoint(company.id, contact.id);
      if (endpoint) {
        customer.endpointId = endpoint.participantId;
        customer.endpointScheme = endpoint.scheme;
        customer.legalId = endpoint.legalId;
        customer.legalIdType = (endpoint.legalIdType as LegalIdType | null) ?? null;
        customer.legalAuthority = endpoint.legalAuthority;
      }
    }
  }
  let originalInvoice: EInvoiceContext["originalInvoice"] = null;
  if (invoice.originalInvoiceId) {
    const original = await storage.getInvoice(invoice.originalInvoiceId, company.id);
    if (original) originalInvoice = { number: original.number, date: original.date };
  }
  return { customer, originalInvoice };
}
