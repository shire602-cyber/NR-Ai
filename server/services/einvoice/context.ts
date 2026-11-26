/**
 * Everything the PINT AE generator needs beyond the invoice row: the buyer's
 * address and identifiers (customer contact + einvoice_buyer_endpoints) and
 * the original invoice for credit/debit notes. Tenant-scoped: a contact or
 * original invoice from another company is ignored.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db, type AppDatabase } from "../../db";
import { DomainError } from "../../errors";
import { baseCurrencyOf } from "../../ledger/currency";
import { resolve } from "../../platform/service-registry";
import { salesTaxPointSql } from "../../tax/sales-tax-point";
import type { FxGetRate } from "../fx";
import { first, parseXml, textAt } from "./dom";
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

/** The current buyer identity is shared by scope checks and document generation. */
export async function loadEInvoiceBuyer(
  invoice: Invoice,
  company: Company,
  conn: ContextReader = db
): Promise<NonNullable<EInvoiceContext["customer"]>> {
  const customer: Partial<EInvoiceParty> & { name?: string } = {
    name: invoice.customerName,
    trn: invoice.customerTrn || null,
    address: invoice.customerAddress || null,
  };
  const buyerOverride = invoice.einvoiceBuyerContactId;
  const contactId = buyerOverride ?? invoice.contactId;
  if (contactId) {
    if (buyerOverride) {
      customer.name = "";
      customer.trn = null;
      customer.address = null;
    }
    const [contact] = await conn
      .select()
      .from(customerContacts)
      .where(and(eq(customerContacts.companyId, company.id), eq(customerContacts.id, contactId)));
    if (contact) {
      if (buyerOverride) customer.name = contact.name;
      const additional = [contact.addressBuilding, contact.addressDistrict]
        .filter((v) => v && v.trim())
        .join(", ");
      customer.address = customer.address || contact.addressStreet || contact.address || null;
      if ((buyerOverride || !invoice.customerAddress) && contact.addressStreet) {
        customer.addressLine2 = additional || null;
      }
      customer.city = contact.city || null;
      customer.postalCode = contact.postalCode || null;
      customer.emirate = contact.emirate || null;
      customer.country = countryCode(contact.country);
      customer.trn = customer.trn || contact.trnNumber || null;
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
  return customer;
}

export async function loadEInvoiceContext(
  invoice: Invoice,
  company: Company,
  lines?: InvoiceLine[],
  conn: AppDatabase = db
): Promise<EInvoiceContext> {
  const customer = await loadEInvoiceBuyer(invoice, company, conn);
  // One tenant-scoped read of the original serves the billing reference and the tax rate.
  let original: OriginalRow | null = null;
  if (invoice.originalInvoiceId) {
    const [row] = await conn
      .select({
        id: invoices.id,
        number: invoices.number,
        date: invoices.date,
        currency: invoices.currency,
        exchangeRate: invoices.exchangeRate,
        einvoiceXml: invoices.einvoiceXml,
        taxPoint: sql<string>`(${sql.raw(salesTaxPointSql("invoices"))})::text`,
      })
      .from(invoices)
      .where(and(eq(invoices.companyId, company.id), eq(invoices.id, invoice.originalInvoiceId)));
    original = row ?? null;
  }
  const originalInvoice: EInvoiceContext["originalInvoice"] = original
    ? { number: original.number, date: original.date }
    : null;
  const lineExtras = await loadLineExtras(company.id, lines, conn);
  const cashSalePayment = await loadCashSalePayment(invoice, company, conn);
  const tax = await loadTaxExchangeRate(invoice, company, original, conn);
  return {
    customer,
    originalInvoice,
    ...(lineExtras ? { lineExtras } : {}),
    options: {
      ...cashSalePayment,
      taxExchangeRate: tax.rate,
      ...(tax.source ? { taxExchangeRateSource: tax.source } : {}),
    },
  };
}

type OriginalRow = {
  id: string;
  number: string;
  date: Date | string;
  currency: string | null;
  exchangeRate: string | number | null;
  einvoiceXml: string | null;
  taxPoint: string;
};

type TaxRateSource = NonNullable<EInvoiceOptions["taxExchangeRateSource"]>;

const positiveRate = (value: string | number | null | undefined): string | null => {
  if (value == null || value === "") return null;
  try {
    const rate = new Decimal(String(value)).toDecimalPlaces(6);
    return rate.isFinite() && rate.gt(0) ? rate.toString() : null;
  } catch {
    return null;
  }
};

/**
 * The rate the original document actually exported: cac:TaxExchangeRate of its persisted PINT AE
 * XML, accepted only for exactly this currency into AED with a positive finite rate.
 */
function recordedExportRate(xml: string | null, currency: string): string | null {
  if (!xml) return null;
  try {
    const node = first(parseXml(xml).documentElement, "cac:TaxExchangeRate");
    if (
      !node ||
      textAt(node, "cbc:SourceCurrencyCode")?.toUpperCase() !== currency ||
      textAt(node, "cbc:TargetCurrencyCode")?.toUpperCase() !== "AED"
    ) {
      return null;
    }
    return positiveRate(textAt(node, "cbc:CalculationRate"));
  } catch {
    return null;
  }
}

/**
 * The document-to-AED rate for the PINT AE tax exchange rate, and where it came from.
 *
 * - A sale uses the rate at its own sales tax point, never the ledger journal rate.
 * - A credit note linked to an original of the same currency reuses the rate its ORIGINAL
 *   actually exported (`original_xml`: cac:TaxExchangeRate in the original's persisted XML), so a
 *   full credit exports exactly the VAT the sale exported even if the rate table changed since.
 *   Only when no usable recorded rate exists is the original's own tax point resolved again
 *   (`original_supply`). The credit's own date and journal rate are never used.
 * - With no rate-table entry the row's stored positive manual rate is used (`stored_manual`): on
 *   an AED ledger it is document-to-AED; on another ledger it is document-to-base and is only used
 *   together with a valid tax-point base-to-AED bridge.
 *
 * Preflight, generation and enqueue all load this through loadEInvoiceContext, so they agree.
 */
async function loadTaxExchangeRate(
  invoice: Invoice,
  company: Company,
  original: OriginalRow | null,
  conn: AppDatabase
): Promise<{ rate: string | null | undefined; source?: TaxRateSource }> {
  const baseCurrency = baseCurrencyOf(company);
  const currency = (invoice.currency ?? "AED").toUpperCase();
  if (currency === "AED") return { rate: undefined };

  const linked =
    invoice.invoiceType === "credit_note" &&
    original !== null &&
    (original.currency ?? "AED").toUpperCase() === currency
      ? original
      : null;
  if (linked) {
    const recorded = recordedExportRate(linked.einvoiceXml, currency);
    if (recorded) return { rate: recorded, source: "original_xml" };
  }
  if (!linked && baseCurrency === "AED" && invoice.invoiceType === "credit_note") {
    // An unlinked credit note keeps the rate stored on it, so its own date cannot introduce an
    // exchange difference.
    return { rate: undefined };
  }
  const source: TaxRateSource = linked ? "original_supply" : "tax_point";
  const storedRate = positiveRate(linked ? linked.exchangeRate : invoice.exchangeRate);
  let taxPoint: string;
  if (linked) {
    taxPoint = linked.taxPoint;
  } else {
    const [sale] = await conn
      .select({ taxPoint: sql<string>`(${sql.raw(salesTaxPointSql("invoices"))})::text` })
      .from(invoices)
      .where(and(eq(invoices.companyId, company.id), eq(invoices.id, invoice.id)));
    if (!sale) return { rate: null };
    taxPoint = sale.taxPoint;
  }
  const getRate = resolve<FxGetRate>("fx.getRate");
  const rateAtTaxPoint = async (from: string, to: string) => {
    try {
      return (await getRate(company.id, from, to, taxPoint, { tx: conn })).rateText;
    } catch (err) {
      if (err instanceof DomainError && ["NO_EXCHANGE_RATE", "INVALID_DATE"].includes(err.code)) {
        return null;
      }
      throw err;
    }
  };
  const direct = await rateAtTaxPoint(currency, "AED");
  if (direct) return { rate: new Decimal(direct).toDecimalPlaces(6).toString(), source };
  if (baseCurrency === "AED") {
    // No rate-table entry: the stored manual rate on an AED-ledger row is already document-to-AED.
    return storedRate ? { rate: storedRate, source: "stored_manual" } : { rate: null };
  }
  if (currency === baseCurrency) return { rate: null };
  // Rates for a non-AED ledger are stored against its base, so cross through it at the same date.
  // A stored document-to-base rate stands in for a missing tax-point one only with a valid
  // base-to-AED bridge.
  const baseToAed = await rateAtTaxPoint(baseCurrency, "AED");
  if (!baseToAed) return { rate: null };
  const toBase = await rateAtTaxPoint(currency, baseCurrency);
  const docToBase = toBase ?? storedRate;
  return docToBase
    ? {
        rate: new Decimal(docToBase).times(baseToAed).toDecimalPlaces(6).toString(),
        source: toBase ? source : "stored_manual",
      }
    : { rate: null };
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
