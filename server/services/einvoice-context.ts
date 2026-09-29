/**
 * Resolves the details an invoice row does not carry (buyer address from the
 * customer contact, the original invoice of a credit note, the company's
 * collection bank account) into the options the XML serializer and the
 * validation gate take. The only place e-invoicing reads other tables.
 */

import type { Company, Invoice } from "../../shared/schema";
import { storage } from "../storage";
import type { EInvoiceOptions } from "./einvoice.service";
import type { EInvoiceValidationOptions } from "./einvoice-validation";

export interface EInvoiceContext {
  xml: EInvoiceOptions;
  validation: EInvoiceValidationOptions;
}

const ymd = (d: Date | string): string => (typeof d === "string" ? new Date(d) : d).toISOString().slice(0, 10);

export async function resolveEInvoiceContext(invoice: Invoice, company: Company): Promise<EInvoiceContext> {
  const contact = invoice.contactId ? await storage.getCustomerContact(invoice.contactId).catch(() => undefined) : undefined;
  const contactInThisCompany = contact && contact.companyId === company.id ? contact : undefined;

  const original =
    (invoice as any).invoiceType === "credit_note" && invoice.originalInvoiceId
      ? await storage.getInvoice(invoice.originalInvoiceId, company.id).catch(() => undefined)
      : undefined;

  const banks = await storage.getBankAccountsByCompanyId(company.id).catch(() => []);
  const bank = banks.find((b) => b.isActive && b.iban && b.iban.trim() !== "");

  const buyerTrn = invoice.customerTrn || contactInThisCompany?.trnNumber || null;
  const buyer = {
    address: (invoice as any).customerAddress || contactInThisCompany?.address || null,
    city: contactInThisCompany?.city ?? null,
    country: contactInThisCompany?.country ?? null,
    // A buyer that carries a TRN is a VAT-registered business.
    buyerIsBusiness: Boolean(buyerTrn),
  };

  return {
    xml: {
      buyer,
      original: original ? { number: original.number, issueDate: ymd(original.date as any) } : undefined,
      bank: bank ? { iban: bank.iban!, accountName: bank.nameEn, bankName: bank.bankName } : null,
    },
    validation: {
      buyer,
      original: original ? { number: original.number } : undefined,
    },
  };
}
