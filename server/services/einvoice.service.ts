import crypto from "crypto";
import type { Invoice, InvoiceLine, Company } from "../../shared/schema";
import { UAE_VAT_RATE } from "../constants";
import { formatUnitPrice } from "../../shared/format-unit-price";
import {
  EINVOICE_CREDIT_NOTE_SYNTAX,
  EINVOICE_CUSTOMIZATION_ID,
  EINVOICE_DEFAULT_COUNTRY,
  EINVOICE_DEFAULT_UNIT_CODE,
  EINVOICE_ITEM_CLASSIFICATION_LIST_ID,
  EINVOICE_PROFILE_ID,
  EMIRATE_SUBENTITY_CODES,
  EMIT_ENDPOINT_ID,
  INVOICE_TYPE_CODE_CREDIT_NOTE,
  INVOICE_TYPE_CODE_INVOICE,
  PAYMENT_MEANS_CREDIT_TRANSFER,
  PEPPOL_EAS_UAE_TRN,
  UBL_NS_CAC,
  UBL_NS_CBC,
  UBL_NS_CREDIT_NOTE,
  UBL_NS_INVOICE,
  type CreditNoteSyntax,
} from "./einvoice-constants";
import { validateForEInvoicing, vatCategoryFor } from "./einvoice-validation";

// Re-exported so existing imports (`from "./einvoice.service"`) keep working.
export { EINVOICE_CUSTOMIZATION_ID, EINVOICE_PROFILE_ID, validateForEInvoicing, vatCategoryFor };
export type { EInvoiceIssue, EInvoiceValidationOptions } from "./einvoice-validation";

/**
 * Details the invoice row does not carry itself. The route resolves them from the
 * customer contact, the original invoice and the company's bank account.
 */
export interface EInvoiceOptions {
  /** Fixed UUID (tests and golden files); a random one is generated otherwise. */
  uuid?: string;
  creditNoteSyntax?: CreditNoteSyntax;
  /** Override the EMIT_ENDPOINT_ID constant. */
  emitEndpointId?: boolean;
  /** The invoice a credit note corrects. */
  original?: { number: string; issueDate?: string | null };
  buyer?: {
    address?: string | null;
    city?: string | null;
    /** Emirate key (dubai, abu_dhabi ...) when known. */
    emirate?: string | null;
    country?: string | null;
    buyerIsBusiness?: boolean;
  };
  /** Company collection account, for PaymentMeans (code 30, credit transfer). */
  bank?: { iban: string; accountName?: string | null; bankName?: string | null } | null;
  /** Delivery date or invoicing period, when known. */
  delivery?: { date?: string | null; periodStart?: string | null; periodEnd?: string | null };
}

// XML 1.0 forbids most C0 controls; a stray one from pasted text would make the document ill-formed.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Escape XML special characters and drop characters XML 1.0 cannot carry. */
function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** YYYY-MM-DD for a UBL date. */
function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().split("T")[0];
}

const amount = (n: number): string => {
  const rounded = Math.round(n * 100 + (n < 0 ? -1e-7 : 1e-7)) / 100;
  return (rounded === 0 ? 0 : rounded).toFixed(2);
};

const COUNTRY_NAMES: Record<string, string> = {
  uae: "AE",
  "united arab emirates": "AE",
  "الإمارات": "AE",
  "الإمارات العربية المتحدة": "AE",
};

/** ISO 3166-1 alpha-2 for a stored country value ("UAE", "AE", "United Arab Emirates" ...). */
function isoCountry(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return EINVOICE_DEFAULT_COUNTRY;
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  return COUNTRY_NAMES[text.toLowerCase()] ?? EINVOICE_DEFAULT_COUNTRY;
}

const el = (name: string, value: unknown, attrs = ""): string => `<${name}${attrs}>${escapeXml(value)}</${name}>`;
const has = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function postalAddress(parts: {
  street?: string | null;
  city?: string | null;
  subentity?: string | null;
  country: string;
}): string {
  const inner: string[] = [];
  if (has(parts.street)) inner.push(el("cbc:StreetName", parts.street));
  if (has(parts.city)) inner.push(el("cbc:CityName", parts.city));
  if (has(parts.subentity)) inner.push(el("cbc:CountrySubentity", parts.subentity));
  inner.push(`<cac:Country>${el("cbc:IdentificationCode", parts.country)}</cac:Country>`);
  return `<cac:PostalAddress>${inner.join("")}</cac:PostalAddress>`;
}

function partyXml(p: {
  name: string;
  trn?: string | null;
  address?: string;
  contact?: { name: string; phone?: string | null; email?: string | null } | null;
  emitEndpoint: boolean;
}): string {
  const out: string[] = [];
  if (p.emitEndpoint && has(p.trn)) {
    out.push(el("cbc:EndpointID", p.trn, ` schemeID="${escapeXml(PEPPOL_EAS_UAE_TRN)}"`));
  }
  out.push(`<cac:PartyName>${el("cbc:Name", p.name)}</cac:PartyName>`);
  if (p.address) out.push(p.address);
  if (has(p.trn)) {
    out.push(
      `<cac:PartyTaxScheme>${el("cbc:CompanyID", p.trn)}<cac:TaxScheme>${el("cbc:ID", "VAT")}</cac:TaxScheme></cac:PartyTaxScheme>`
    );
  }
  out.push(`<cac:PartyLegalEntity>${el("cbc:RegistrationName", p.name)}</cac:PartyLegalEntity>`);
  if (p.contact && (has(p.contact.phone) || has(p.contact.email))) {
    const c: string[] = [el("cbc:Name", p.contact.name)];
    if (has(p.contact.phone)) c.push(el("cbc:Telephone", p.contact.phone));
    if (has(p.contact.email)) c.push(el("cbc:ElectronicMail", p.contact.email));
    out.push(`<cac:Contact>${c.join("")}</cac:Contact>`);
  }
  return `<cac:Party>${out.join("")}</cac:Party>`;
}

function paymentTermsNote(terms: string | null | undefined, due: string | null): string {
  const t = (terms ?? "").trim();
  let text = "";
  const net = /^net\s*_?(\d+)$/i.exec(t);
  if (net) text = `Net ${net[1]} days`;
  else if (/^(due_on_receipt|immediate)$/i.test(t)) text = "Due on receipt";
  else if (t) text = t;
  return [text, due ? `Payment due ${due}` : ""].filter(Boolean).join(". ");
}

/**
 * Generate UBL 2.1 XML for the UAE PINT AE e-invoicing format.
 *
 * An invoice is an `<Invoice>`; a credit note is by default a true `<CreditNote>`
 * (CreditNote-2 namespace, CreditNoteTypeCode 381, `cac:CreditNoteLine`,
 * `cbc:CreditedQuantity`, BillingReference to the original invoice). All amounts of a
 * CreditNote are positive: the document type carries the sign. Child elements are
 * written in the UBL 2.1 schema sequence.
 *
 * Nothing here talks to a provider: it only builds the payload an ASP will be given.
 */
export function generateEInvoiceXML(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  customer?: { name: string; trn?: string },
  options: EInvoiceOptions = {}
): { xml: string; uuid: string; hash: string } {
  const uuid = options.uuid ?? crypto.randomUUID();
  const currency = invoice.currency || "AED";
  const isCreditNote = (invoice as any).invoiceType === "credit_note";
  const syntax = options.creditNoteSyntax ?? EINVOICE_CREDIT_NOTE_SYNTAX;
  const asCreditNoteRoot = isCreditNote && syntax === "credit-note";
  const emitEndpoint = options.emitEndpointId ?? EMIT_ENDPOINT_ID;
  // In a CreditNote document every amount and quantity is positive.
  const sign = (n: number): number => (asCreditNoteRoot ? Math.abs(n) : n);

  const exchangeRate =
    Number((invoice as any).exchangeRate) > 0 ? Number((invoice as any).exchangeRate) : 1;
  const customerName = customer?.name || invoice.customerName || "Cash Customer";
  const customerTrn = customer?.trn || invoice.customerTrn || "";
  const dueDate = invoice.dueDate ? formatDate(invoice.dueDate as any) : null;
  const cur = ` currencyID="${escapeXml(currency)}"`;

  // ── tax breakdown grouped by (VAT category, rate) ──
  const taxByGroup = new Map<string, { category: string; rate: number; taxable: number; tax: number }>();
  for (const line of lines) {
    const category = vatCategoryFor(line);
    const rate = category === "S" ? (line.vatRate ?? UAE_VAT_RATE) : 0;
    const ext = sign(line.quantity * line.unitPrice);
    const key = `${category}:${rate}`;
    const g = taxByGroup.get(key) || { category, rate, taxable: 0, tax: 0 };
    g.taxable += ext;
    g.tax += ext * rate;
    taxByGroup.set(key, g);
  }
  const taxSubtotals = [...taxByGroup.values()]
    .map(
      ({ category, rate, taxable, tax }) =>
        `<cac:TaxSubtotal>${el("cbc:TaxableAmount", amount(taxable), cur)}${el("cbc:TaxAmount", amount(tax), cur)}` +
        `<cac:TaxCategory>${el("cbc:ID", category)}${el("cbc:Percent", (rate * 100).toFixed(2))}` +
        `<cac:TaxScheme>${el("cbc:ID", "VAT")}</cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`
    )
    .join("");

  // ── parties ──
  const emirate = (company as any).emirate as string | null | undefined;
  const seller = partyXml({
    name: company.name,
    trn: company.trnVatNumber,
    address: postalAddress({
      street: (company as any).addressStreet || company.businessAddress,
      city: (company as any).addressCity,
      subentity: emirate ? (EMIRATE_SUBENTITY_CODES[emirate] ?? null) : null,
      country: isoCountry((company as any).addressCountry),
    }),
    contact: { name: company.name, phone: company.contactPhone, email: company.contactEmail },
    emitEndpoint,
  });
  const buyerStreet = options.buyer?.address || (invoice as any).customerAddress;
  const buyerEmirate = options.buyer?.emirate;
  const buyer = partyXml({
    name: customerName,
    trn: customerTrn,
    address:
      has(buyerStreet) || has(options.buyer?.city)
        ? postalAddress({
            street: buyerStreet,
            city: options.buyer?.city,
            subentity: buyerEmirate ? (EMIRATE_SUBENTITY_CODES[buyerEmirate] ?? null) : null,
            country: isoCountry(options.buyer?.country),
          })
        : undefined,
    emitEndpoint,
  });

  // ── document-level blocks ──
  const invoicePeriod =
    options.delivery?.periodStart || options.delivery?.periodEnd
      ? `<cac:InvoicePeriod>${options.delivery.periodStart ? el("cbc:StartDate", options.delivery.periodStart) : ""}${
          options.delivery.periodEnd ? el("cbc:EndDate", options.delivery.periodEnd) : ""
        }</cac:InvoicePeriod>`
      : "";
  const billingReference =
    isCreditNote && options.original?.number
      ? `<cac:BillingReference><cac:InvoiceDocumentReference>${el("cbc:ID", options.original.number)}${
          options.original.issueDate ? el("cbc:IssueDate", options.original.issueDate) : ""
        }</cac:InvoiceDocumentReference></cac:BillingReference>`
      : isCreditNote && (invoice as any).originalInvoiceId
        ? // The caller could not resolve the number: fall back to the stable internal id.
          `<cac:BillingReference><cac:InvoiceDocumentReference>${el("cbc:ID", (invoice as any).originalInvoiceId)}</cac:InvoiceDocumentReference></cac:BillingReference>`
        : "";
  const delivery = options.delivery?.date
    ? `<cac:Delivery>${el("cbc:ActualDeliveryDate", options.delivery.date)}</cac:Delivery>`
    : "";
  const paymentMeans = options.bank?.iban
    ? `<cac:PaymentMeans>${el("cbc:PaymentMeansCode", PAYMENT_MEANS_CREDIT_TRANSFER)}<cac:PayeeFinancialAccount>${el(
        "cbc:ID",
        options.bank.iban.replace(/\s+/g, "")
      )}${options.bank.accountName ? el("cbc:Name", options.bank.accountName) : ""}</cac:PayeeFinancialAccount></cac:PaymentMeans>`
    : "";
  const termsNote = paymentTermsNote((invoice as any).paymentTerms, dueDate);
  const paymentTerms = termsNote && !isCreditNote ? `<cac:PaymentTerms>${el("cbc:Note", termsNote)}</cac:PaymentTerms>` : "";

  const vatTotal = sign(invoice.vatAmount);
  const taxTotal = `<cac:TaxTotal>${el("cbc:TaxAmount", amount(vatTotal), cur)}${taxSubtotals}</cac:TaxTotal>`;
  // PINT-AE / EN16931 BT-6: a foreign-currency invoice also states its VAT in AED (exchangeRate is AED per unit).
  const aedTaxTotal =
    currency !== "AED"
      ? `<cac:TaxTotal>${el("cbc:TaxAmount", amount(vatTotal * exchangeRate), ' currencyID="AED"')}</cac:TaxTotal>`
      : "";
  const monetary =
    `<cac:LegalMonetaryTotal>${el("cbc:LineExtensionAmount", amount(sign(invoice.subtotal)), cur)}` +
    `${el("cbc:TaxExclusiveAmount", amount(sign(invoice.subtotal)), cur)}` +
    `${el("cbc:TaxInclusiveAmount", amount(sign(invoice.total)), cur)}` +
    `${el("cbc:PayableAmount", amount(sign(invoice.total)), cur)}</cac:LegalMonetaryTotal>`;

  // ── lines ──
  const lineElement = asCreditNoteRoot ? "cac:CreditNoteLine" : "cac:InvoiceLine";
  const quantityElement = asCreditNoteRoot ? "cbc:CreditedQuantity" : "cbc:InvoicedQuantity";
  const linesXml = lines.map((line, index) => {
    const ext = sign(line.quantity * line.unitPrice);
    const category = vatCategoryFor(line);
    const percent = category === "S" ? (line.vatRate ?? UAE_VAT_RATE) * 100 : 0;
    const unitCode = (line as any).unitCode || EINVOICE_DEFAULT_UNIT_CODE;
    const classification = (line as any).itemClassificationCode
      ? `<cac:CommodityClassification>${el(
          "cbc:ItemClassificationCode",
          (line as any).itemClassificationCode,
          ` listID="${escapeXml((line as any).itemClassificationListId || EINVOICE_ITEM_CLASSIFICATION_LIST_ID)}"`
        )}</cac:CommodityClassification>`
      : "";
    return (
      `<${lineElement}>${el("cbc:ID", index + 1)}` +
      `${el(quantityElement, sign(line.quantity), ` unitCode="${escapeXml(unitCode)}"`)}` +
      `${el("cbc:LineExtensionAmount", amount(ext), cur)}` +
      `<cac:Item>${el("cbc:Name", line.description)}${classification}` +
      `<cac:ClassifiedTaxCategory>${el("cbc:ID", category)}${el("cbc:Percent", percent.toFixed(2))}` +
      `<cac:TaxScheme>${el("cbc:ID", "VAT")}</cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>` +
      `<cac:Price>${el("cbc:PriceAmount", formatUnitPrice(line.unitPrice), cur)}</cac:Price></${lineElement}>`
    );
  });

  const rootName = asCreditNoteRoot ? "CreditNote" : "Invoice";
  const rootNs = asCreditNoteRoot ? UBL_NS_CREDIT_NOTE : UBL_NS_INVOICE;
  const typeCodeElement = asCreditNoteRoot ? "cbc:CreditNoteTypeCode" : "cbc:InvoiceTypeCode";
  const typeCode = isCreditNote ? INVOICE_TYPE_CODE_CREDIT_NOTE : INVOICE_TYPE_CODE_INVOICE;

  // UBL sequence: ID, UUID, IssueDate, DueDate (Invoice only), type code, DocumentCurrencyCode,
  // TaxCurrencyCode, InvoicePeriod, BillingReference, parties, Delivery, PaymentMeans,
  // PaymentTerms, TaxTotal(s), LegalMonetaryTotal, lines.
  const body = [
    el("cbc:UBLVersionID", "2.1"),
    el("cbc:CustomizationID", EINVOICE_CUSTOMIZATION_ID),
    el("cbc:ProfileID", EINVOICE_PROFILE_ID),
    el("cbc:ID", invoice.number),
    el("cbc:UUID", uuid),
    el("cbc:IssueDate", formatDate(invoice.date)),
    !asCreditNoteRoot && dueDate ? el("cbc:DueDate", dueDate) : "",
    el(typeCodeElement, typeCode),
    el("cbc:DocumentCurrencyCode", currency),
    el("cbc:TaxCurrencyCode", "AED"),
    invoicePeriod,
    billingReference,
    `<cac:AccountingSupplierParty>${seller}</cac:AccountingSupplierParty>`,
    `<cac:AccountingCustomerParty>${buyer}</cac:AccountingCustomerParty>`,
    delivery,
    paymentMeans,
    paymentTerms,
    taxTotal,
    aedTaxTotal,
    monetary,
    ...linesXml,
  ]
    .filter((part) => part !== "")
    .join("\n  ");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<${rootName} xmlns="${rootNs}" xmlns:cac="${UBL_NS_CAC}" xmlns:cbc="${UBL_NS_CBC}">
  ${body}
</${rootName}>`;

  const hash = crypto.createHash("sha256").update(xml).digest("hex");
  return { xml, uuid, hash };
}
