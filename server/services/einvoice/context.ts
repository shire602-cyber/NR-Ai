/**
 * Everything the PINT AE generator needs beyond the invoice row: the buyer's
 * address and identifiers (customer contact + einvoice_buyer_endpoints) and
 * the original invoice for credit/debit notes. Tenant-scoped: a contact or
 * original invoice from another company is ignored.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, type AppDatabase } from "../../db";
import {
  customerContacts,
  invoices,
  invoicePayments,
  products,
  type Company,
  type Invoice,
  type InvoiceLine,
} from "../../../shared/schema";
import type { EInvoiceContext } from "../einvoice-submit.service";
import {
  countryCode,
  type EInvoiceLineExtra,
  type EInvoiceOptions,
  type EInvoiceParty,
} from "../einvoice.service";
import type { LegalIdType, PaymentMeansCode } from "./pint-ae-codes";
import { getBuyerEndpoint } from "./store";

type ContextReader = Pick<AppDatabase, "select">;

export async function loadEInvoiceContext(
  invoice: Invoice,
  company: Company,
  lines?: InvoiceLine[],
  conn: ContextReader = db
): Promise<EInvoiceContext> {
  const customer: Partial<EInvoiceParty> & { name?: string } = {
    name: invoice.customerName,
    trn: invoice.customerTrn || null,
    address: invoice.customerAddress || null,
  };
  if (invoice.contactId) {
    const [contact] = await conn
      .select()
      .from(customerContacts)
      .where(
        and(eq(customerContacts.companyId, company.id), eq(customerContacts.id, invoice.contactId))
      );
    if (contact) {
      const additional = [contact.addressBuilding, contact.addressDistrict]
        .filter((v) => v && v.trim())
        .join(", ");
      customer.address =
        invoice.customerAddress || contact.addressStreet || contact.address || null;
      if (!invoice.customerAddress && contact.addressStreet) {
        customer.addressLine2 = additional || null;
      }
      customer.city = contact.city || null;
      customer.postalCode = contact.postalCode || null;
      customer.emirate = contact.emirate || null;
      customer.country = countryCode(contact.country);
      customer.trn = invoice.customerTrn || contact.trnNumber || null;
      customer.email = contact.email || null;
      customer.phone = contact.phone || null;
      const endpoint = await getBuyerEndpoint(company.id, contact.id, conn);
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
    const [original] = await conn
      .select({ number: invoices.number, date: invoices.date })
      .from(invoices)
      .where(and(eq(invoices.companyId, company.id), eq(invoices.id, invoice.originalInvoiceId)));
    if (original) originalInvoice = { number: original.number, date: original.date };
  }
  const lineExtras = await loadLineExtras(company.id, lines, conn);
  const cashSalePayment = await loadCashSalePayment(invoice, company, conn);
  return {
    customer,
    originalInvoice,
    ...(lineExtras ? { lineExtras } : {}),
    options: cashSalePayment,
  };
}

const CASH_SALE_MEANS: Readonly<Record<string, PaymentMeansCode>> = {
  cash: "10",
  cheque: "20",
  card: "48",
  credit_card: "54",
  debit_card: "55",
  online: "68",
};

/** Use the settlement recorded at issuance of a cash-series document. */
async function loadCashSalePayment(
  invoice: Invoice,
  company: Company,
  conn: ContextReader
): Promise<EInvoiceOptions> {
  if (invoice.source !== "cash_sale" || invoice.status !== "paid") return {};
  const [payment] = await conn
    .select({ method: invoicePayments.method })
    .from(invoicePayments)
    .where(
      and(
        eq(invoicePayments.companyId, company.id),
        eq(invoicePayments.invoiceId, invoice.id),
        eq(invoicePayments.date, invoice.date),
        eq(invoicePayments.amount, invoice.total)
      )
    )
    .orderBy(invoicePayments.createdAt)
    .limit(1);
  if (!payment) return {};

  const method = payment.method.trim().toLowerCase();
  // A transfer code requires the receiving account identifier. Company-wide payment
  // instructions do not establish which bank account actually received this cash sale.
  return { paidAtIssue: true, paymentMeansCode: CASH_SALE_MEANS[method] ?? "1" };
}

/**
 * S1 (W4-C follow-up): per-line GTIN and domestic reverse-charge goods type from the line's
 * product (tenant-scoped), so an AE-category (reverse-charge) invoice can be e-invoiced.
 * Null when no line references a product with either field.
 */
async function loadLineExtras(
  companyId: string,
  lines: InvoiceLine[] | undefined,
  conn: ContextReader
): Promise<EInvoiceLineExtra[] | null> {
  const ids = [...new Set((lines ?? []).map((l) => l.productId).filter(Boolean) as string[])];
  if (!lines || ids.length === 0) return null;
  const rows = await conn
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
