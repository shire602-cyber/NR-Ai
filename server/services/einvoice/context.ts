/**
 * Everything the PINT AE generator needs beyond the invoice row: the buyer's
 * address and identifiers (customer contact + einvoice_buyer_endpoints) and
 * the original invoice for credit/debit notes. Tenant-scoped: a contact or
 * original invoice from another company is ignored.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { products, type Company, type Invoice, type InvoiceLine } from "../../../shared/schema";
import { storage } from "../../storage";
import type { EInvoiceContext } from "../einvoice-submit.service";
import { countryCode, type EInvoiceLineExtra, type EInvoiceParty } from "../einvoice.service";
import type { LegalIdType } from "./pint-ae-codes";
import { getBuyerEndpoint } from "./store";

export async function loadEInvoiceContext(
  invoice: Invoice,
  company: Company,
  lines?: InvoiceLine[]
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
  const lineExtras = await loadLineExtras(company.id, lines);
  const marginScheme = (lines ?? []).some((l) => l.marginScheme);
  return {
    customer,
    originalInvoice,
    ...(lineExtras ? { lineExtras } : {}),
    ...(marginScheme ? { options: { transactionFlags: { marginScheme: true } } } : {}),
  };
}

/**
 * S1 (W4-C follow-up): per-line GTIN and domestic reverse-charge goods type from the line's
 * product (tenant-scoped), so an AE-category (reverse-charge) invoice can be e-invoiced.
 * Null when no line references a product with either field.
 */
async function loadLineExtras(
  companyId: string,
  lines: InvoiceLine[] | undefined
): Promise<EInvoiceLineExtra[] | null> {
  const ids = [...new Set((lines ?? []).map((l) => l.productId).filter(Boolean) as string[])];
  if (!lines || ids.length === 0) return null;
  const rows = await db
    .select({ id: products.id, gtin: products.gtin, rcmGoodsType: products.rcmGoodsType })
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, ids)));
  if (
    !rows.some(
      (r: { gtin: string | null; rcmGoodsType: string | null }) => r.gtin || r.rcmGoodsType
    )
  ) {
    return null;
  }
  const byId = new Map(rows.map((r: { id: string }) => [r.id, r]));
  return lines.map((l) => {
    const p = l.productId
      ? (byId.get(l.productId) as { gtin: string | null; rcmGoodsType: string | null } | undefined)
      : undefined;
    return { gtin: p?.gtin ?? null, rcmGoodsType: p?.rcmGoodsType ?? null };
  });
}
