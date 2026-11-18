/**
 * UAE e-invoice generator: UBL 2.1 in the Peppol PINT AE profile.
 *
 * Every tax category comes from shared/vat-classification.ts (classifySupply)
 * and every amount from server/services/document-totals.service.ts
 * (computeSalesDocument), so the XML can never disagree with the posted
 * invoice, the PDF or the VAT 201. The output is checked against the UBL 2.1
 * XSD, the OpenPeppol PINT AE schematron and the PINT AE rule list in
 * server/services/einvoice/validate.ts.
 *
 * What this module does NOT do: sign the document or transmit it. Under the
 * UAE 5-corner model the Accredited Service Provider (ASP) applies its
 * signature and reports to the FTA; see einvoice-provider.ts.
 */
import crypto from "crypto";
import Decimal from "decimal.js";
import type { Invoice, InvoiceLine, Company } from "../../shared/schema";
import { classifySupply, type SupplyClassification } from "../../shared/vat-classification";
import { fromFils } from "../../shared/money";
import { computeSalesDocument, storedLineToTotalsInput } from "./document-totals.service";
import { dueDateFromTerms } from "./invoice-lifecycle";
import { comment, el, opt, serializeXml, type XmlElement } from "./einvoice/xml";
import {
  CATEGORY_REASON_TEXT,
  CREDIT_NOTE_REASON_CODES,
  DEFAULT_CREDIT_NOTE_REASON,
  DOCUMENT_TYPE,
  PEPPOL_SCHEME_UAE_TIN,
  RCM_GOODS_TYPE_CODES,
  emirateSubentity,
  isPintAeTrn,
  paymentTermsText,
  tinFromTrn,
  transactionTypeCode,
  type CreditNoteReasonCode,
  type LegalIdType,
  type PaymentMeansCode,
  type TransactionFlag,
} from "./einvoice/pint-ae-codes";
import { effectiveTin, sellerLegalId, tinProblem } from "../../shared/validators/einvoice-identity";

// PINT AE profile identifiers (aligned-ibrp-001-ae / aligned-ibrp-002-ae).
export const EINVOICE_CUSTOMIZATION_ID = "urn:peppol:pint:billing-1@ae-1";
export const EINVOICE_PROFILE_ID = "urn:peppol:bis:billing";

const NS = {
  invoice: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  creditNote: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
};

export type UblCategory = "S" | "Z" | "E" | "O" | "AE";

/** UNCL5305 category for a stored line, via the single classification table. */
export function vatCategoryFor(
  line: Pick<InvoiceLine, "vatSupplyType" | "vatRate">,
  reverseCharge?: boolean | null
): UblCategory {
  return classifySupply({
    supplyType: line.vatSupplyType,
    vatRate: line.vatRate,
    reverseCharge: reverseCharge ?? null,
  }).ublCategory;
}

export interface EInvoiceParty {
  name: string;
  trn?: string | null;
  /** Address line 1 (IBT-035 / IBT-050). */
  address?: string | null;
  city?: string | null;
  /** Stored emirate ("dubai") or PINT AE code ("DXB"). */
  emirate?: string | null;
  /** ISO 3166-1 alpha-2 or a common name ("UAE"); default AE. */
  country?: string | null;
  /** Peppol participant id (IBT-034 / IBT-049); TIN from the TRN when absent. */
  endpointId?: string | null;
  endpointScheme?: string | null;
  legalId?: string | null;
  legalIdType?: LegalIdType | null;
  legalAuthority?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface EInvoiceLineExtra {
  /** GTIN (scheme 0160) — required on reverse-charge lines (ibr-174-ae). */
  gtin?: string | null;
  /** Goods subject to domestic reverse charge (ibr-006-ae, BTAE-09). */
  rcmGoodsType?: string | null;
  unitCode?: string | null;
}

export interface EInvoiceOptions {
  uuid?: string;
  /** HH:MM:SS (UTC+4 local business time is the caller's choice). */
  issueTime?: string;
  originalInvoice?: { number: string; date: Date | string } | null;
  creditNoteReasonCode?: CreditNoteReasonCode | null;
  paymentMeansCode?: PaymentMeansCode | null;
  payeeIban?: string | null;
  lineExtras?: EInvoiceLineExtra[];
  transactionFlags?: Partial<Record<TransactionFlag, boolean>>;
}

type InvoiceLike = Invoice & {
  invoiceType?: string | null;
  originalInvoiceId?: string | null;
  exchangeRate?: number | string | null;
  reverseCharge?: boolean | null;
  discountType?: string | null;
  discountValue?: number | string | null;
  supplyDate?: Date | string | null;
  dueDate?: Date | string | null;
  paymentTerms?: string | null;
  notes?: string | null;
};

type CompanyLike = Company & {
  peppolParticipantId?: string | null;
  peppolScheme?: string | null;
  tradeLicenceNo?: string | null;
  tradeLicenceAuthority?: string | null;
  einvoicePayeeIban?: string | null;
  einvoicePaymentMeansCode?: string | null;
};

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().split("T")[0];
}

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 19);
}

const COUNTRY_ALIASES: Record<string, string> = {
  uae: "AE",
  "united arab emirates": "AE",
  "u.a.e.": "AE",
  ksa: "SA",
  "saudi arabia": "SA",
  oman: "OM",
  bahrain: "BH",
  qatar: "QA",
  kuwait: "KW",
  india: "IN",
  "united kingdom": "GB",
  uk: "GB",
  "united states": "US",
  usa: "US",
};

export function countryCode(raw: string | null | undefined): string {
  if (!raw) return "AE";
  const v = raw.trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return COUNTRY_ALIASES[v.toLowerCase()] ?? "AE";
}

const money = (fils: number) => fromFils(Math.abs(fils));
const amountEl = (name: string, fils: number, currency: string) =>
  el(name, { currencyID: currency }, money(fils));

/** Document kind → root element and type code. */
export function documentKind(
  invoice: Pick<InvoiceLike, "invoiceType">,
  categories: UblCategory[]
): { root: "Invoice" | "CreditNote"; typeCode: string; kind: string } {
  if (invoice.invoiceType === "credit_note") {
    return { root: "CreditNote", typeCode: DOCUMENT_TYPE.creditNote, kind: "credit_note" };
  }
  if (invoice.invoiceType === "debit_note") {
    // UNCL1001 383 is the debit-note code (used for ZATCA), but the PINT AE
    // 2026.5 schematron (ibr-cl-01) only admits 380/480 on an Invoice. A UAE
    // debit note is therefore a 380 tax invoice that references the original
    // invoice through cac:BillingReference.
    return { root: "Invoice", typeCode: DOCUMENT_TYPE.invoice, kind: "debit_note" };
  }
  if (categories.length > 0 && categories.every((c) => c === "O")) {
    return { root: "Invoice", typeCode: DOCUMENT_TYPE.outOfScope, kind: "out_of_scope" };
  }
  return { root: "Invoice", typeCode: DOCUMENT_TYPE.invoice, kind: "invoice" };
}

export interface ComputedEInvoiceLine {
  line: InvoiceLine;
  classification: SupplyClassification;
  quantity: number;
  unitPriceFils: number;
  grossFils: number;
  lineDiscountFils: number;
  documentDiscountFils: number;
  /** Line net amount (IBT-131): gross less line allowance, before document allowance. */
  lineExtensionFils: number;
  vatFils: number;
  vatRate: number;
}

/** Amounts for the XML, from the same engine that priced the stored invoice. */
export function computeEInvoiceAmounts(invoice: InvoiceLike, lines: InvoiceLine[]) {
  const sign = invoice.invoiceType === "credit_note" ? -1 : 1;
  const totals = computeSalesDocument(
    lines.map((l) => {
      const input = storedLineToTotalsInput({
        quantity: Math.abs(Number(l.quantity)),
        unitPrice: Math.abs(Number(l.unitPrice)),
        vatRate: l.vatRate,
        vatSupplyType: l.vatSupplyType,
        discountType: (l as InvoiceLine & { discountType?: string | null }).discountType ?? null,
        discountValue: (l as InvoiceLine & { discountValue?: number | null }).discountValue ?? null,
      });
      return input;
    }),
    {
      discountType: invoice.discountType ?? null,
      discountValue: invoice.discountValue ?? null,
      reverseCharge: invoice.reverseCharge ?? null,
    }
  );
  const computed: ComputedEInvoiceLine[] = totals.lines.map((t, i) => ({
    line: lines[i],
    classification: t.classification,
    quantity: Math.abs(Number(lines[i].quantity)),
    unitPriceFils: Math.round(Math.abs(Number(lines[i].unitPrice)) * 100),
    grossFils: t.grossFils,
    lineDiscountFils: t.lineDiscountFils,
    documentDiscountFils: t.documentDiscountFils,
    lineExtensionFils: t.grossFils - t.lineDiscountFils,
    vatFils: t.vatFils,
    vatRate: t.vatRate,
  }));
  return { sign, totals, lines: computed };
}

/** VAT breakdown: one subtotal per category (and rate). */
export function taxBreakdown(computed: ComputedEInvoiceLine[]) {
  const groups = new Map<
    string,
    { category: UblCategory; rate: number; taxableFils: number; allowanceFils: number }
  >();
  for (const l of computed) {
    const category = l.classification.ublCategory;
    const rate = category === "S" ? l.vatRate : 0;
    const key = `${category}:${rate}`;
    const g = groups.get(key) ?? { category, rate, taxableFils: 0, allowanceFils: 0 };
    g.taxableFils += l.lineExtensionFils - l.documentDiscountFils;
    g.allowanceFils += l.documentDiscountFils;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    taxFils:
      g.category === "S"
        ? new Decimal(g.taxableFils)
            .times(g.rate)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
            .toNumber()
        : 0,
    reasonCode: classifySupplyForCategory(g.category).exemptionReasonCode ?? null,
  }));
}

function classifySupplyForCategory(category: UblCategory): SupplyClassification {
  const type =
    category === "S"
      ? "standard_rated"
      : category === "Z"
        ? "zero_rated"
        : category === "E"
          ? "exempt"
          : category === "O"
            ? "out_of_scope"
            : "reverse_charge";
  return classifySupply({ supplyType: type });
}

/** TaxCategory / ClassifiedTaxCategory content for a category. */
function taxCategory(tag: string, category: UblCategory, rate: number): XmlElement {
  const c = classifySupplyForCategory(category);
  const percent =
    category === "E" || category === "O" ? null : (category === "S" ? rate * 100 : 0).toFixed(2);
  const withReason = category === "E" || category === "O" || category === "AE";
  return el(
    tag,
    null,
    el("cbc:ID", null, category),
    opt("cbc:Percent", percent),
    withReason && opt("cbc:TaxExemptionReasonCode", c.exemptionReasonCode),
    withReason && opt("cbc:TaxExemptionReason", CATEGORY_REASON_TEXT[category]),
    el("cac:TaxScheme", null, el("cbc:ID", null, "VAT"))
  );
}

function partyXml(p: EInvoiceParty, role: "seller" | "buyer"): XmlElement {
  const country = countryCode(p.country);
  const trn = p.trn?.trim() || null;
  const endpoint = p.endpointId?.trim() || tinFromTrn(trn);
  const scheme = p.endpointScheme?.trim() || PEPPOL_SCHEME_UAE_TIN;
  const subentity = country === "AE" ? emirateSubentity(p.emirate) : p.emirate?.trim() || null;
  const legalType = p.legalIdType ?? (p.legalId ? "TL" : null);
  return el(
    "cac:Party",
    null,
    endpoint && el("cbc:EndpointID", { schemeID: scheme }, endpoint),
    role === "buyer" &&
      trn &&
      el(
        "cac:PartyIdentification",
        null,
        el("cbc:ID", { schemeID: scheme }, tinFromTrn(trn) ?? trn)
      ),
    el("cac:PartyName", null, el("cbc:Name", null, p.name)),
    el(
      "cac:PostalAddress",
      null,
      opt("cbc:StreetName", p.address),
      opt("cbc:CityName", p.city),
      opt("cbc:CountrySubentity", subentity),
      el("cac:Country", null, el("cbc:IdentificationCode", null, country))
    ),
    trn &&
      el(
        "cac:PartyTaxScheme",
        null,
        el("cbc:CompanyID", null, trn),
        el("cac:TaxScheme", null, el("cbc:ID", null, "VAT"))
      ),
    el(
      "cac:PartyLegalEntity",
      null,
      el("cbc:RegistrationName", null, p.name),
      p.legalId &&
        el(
          "cbc:CompanyID",
          {
            schemeAgencyID: legalType,
            // TL: the issuing authority (ibr-172-ae). PAS: the passport issuing country,
            // ISO 3166-1 (BTAE-18/19, ibr-010..013-ae).
            schemeAgencyName:
              legalType === "TL"
                ? p.legalAuthority || p.emirate || null
                : legalType === "PAS"
                  ? p.legalAuthority?.trim().toUpperCase() || null
                  : null,
          },
          p.legalId
        )
    ),
    (p.email || p.phone) &&
      el("cac:Contact", null, opt("cbc:Telephone", p.phone), opt("cbc:ElectronicMail", p.email))
  );
}

/** Seller party data from the company record (identity columns from migration 0102). */
export function sellerFromCompany(company: CompanyLike): EInvoiceParty {
  // WQ5: the stored TIN (else the CT TRN's first 10 digits) is the EndpointID when the partner
  // registered no other participant id; the seller ID type/number replaces the TL-only rule.
  const legal = sellerLegalId(company);
  const tin = effectiveTin(company);
  return {
    name: company.legalName || company.name,
    trn: company.trnVatNumber,
    address: company.addressStreet || company.businessAddress || null,
    city: company.addressCity || null,
    emirate: company.emirate || null,
    country: company.addressCountry || "AE",
    endpointId: company.peppolParticipantId || tin || null,
    endpointScheme: company.peppolScheme || null,
    legalId: legal?.number ?? null,
    legalIdType: legal?.type ?? "TL",
    legalAuthority:
      legal?.type === "TL"
        ? company.tradeLicenceAuthority || null
        : legal?.type === "PAS"
          ? (company as CompanyLike & { sellerIdCountry?: string | null }).sellerIdCountry || null
          : null,
    email: company.contactEmail || null,
    phone: company.contactPhone || null,
  };
}

export function generateEInvoiceXML(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  customer?: Partial<EInvoiceParty> & { name?: string },
  opts: EInvoiceOptions = {}
): { xml: string; uuid: string; hash: string; documentType: string } {
  const inv = invoice as InvoiceLike;
  const co = company as CompanyLike;
  const uuid = opts.uuid ?? crypto.randomUUID();
  const currency = (inv.currency || "AED").toUpperCase();
  const { totals, lines: computed } = computeEInvoiceAmounts(inv, lines);
  const breakdown = taxBreakdown(computed);
  const categories = computed.map((l) => l.classification.ublCategory);
  const doc = documentKind(inv, categories);
  const isCredit = doc.root === "CreditNote";
  const rate =
    Number(inv.exchangeRate) > 0 ? new Decimal(String(inv.exchangeRate)) : new Decimal(1);
  const foreign = currency !== "AED";
  const toAedFils = (fils: number) =>
    new Decimal(fils).times(rate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

  const seller = sellerFromCompany(co);
  const buyer: EInvoiceParty = {
    name: customer?.name || inv.customerName || "Cash Customer",
    trn: customer?.trn ?? inv.customerTrn ?? null,
    address: customer?.address ?? inv.customerAddress ?? null,
    city: customer?.city ?? null,
    emirate:
      customer?.emirate ??
      (inv as InvoiceLike & { placeOfSupplyEmirate?: string | null }).placeOfSupplyEmirate ??
      null,
    country: customer?.country ?? "AE",
    endpointId: customer?.endpointId ?? null,
    endpointScheme: customer?.endpointScheme ?? null,
    legalId: customer?.legalId ?? null,
    legalIdType: customer?.legalIdType ?? null,
    legalAuthority: customer?.legalAuthority ?? null,
    email: customer?.email ?? null,
    phone: customer?.phone ?? null,
  };
  const buyerCountry = countryCode(buyer.country);
  const flags: Partial<Record<TransactionFlag, boolean>> = {
    exports: buyerCountry !== "AE" && categories.includes("Z"),
    ...(opts.transactionFlags ?? {}),
  };

  const issueDate = formatDate(inv.date);
  const issueTime = opts.issueTime ?? formatTime(new Date(inv.date));
  const supplyDate = inv.supplyDate ? formatDate(inv.supplyDate) : null;
  const dueDate = resolveDueDate(inv);
  const payableFils = totals.totalFils;
  const subtotalFils = totals.subtotalFils;
  const vatFils = breakdown.reduce((s, g) => s + g.taxFils, 0);
  const lineExtTotal = computed.reduce((s, l) => s + l.lineExtensionFils, 0);
  const docAllowanceFils = totals.documentDiscountFils;

  const reasonCode: CreditNoteReasonCode =
    opts.creditNoteReasonCode && opts.creditNoteReasonCode in CREDIT_NOTE_REASON_CODES
      ? opts.creditNoteReasonCode
      : DEFAULT_CREDIT_NOTE_REASON;

  const original = opts.originalInvoice ?? null;
  const originalId =
    original?.number ?? (inv.originalInvoiceId ? String(inv.originalInvoiceId) : null);
  const billingReference =
    (isCredit || doc.kind === "debit_note") &&
    originalId &&
    el(
      "cac:BillingReference",
      null,
      el(
        "cac:InvoiceDocumentReference",
        null,
        el("cbc:ID", null, originalId),
        original?.date ? el("cbc:IssueDate", null, formatDate(original.date)) : null
      )
    );

  const iban = opts.payeeIban ?? co.einvoicePayeeIban ?? null;
  const meansCode = (opts.paymentMeansCode ??
    co.einvoicePaymentMeansCode ??
    (iban ? "30" : "1")) as string;
  const paymentMeans = el(
    "cac:PaymentMeans",
    null,
    el("cbc:PaymentMeansCode", null, meansCode),
    el("cbc:PaymentID", null, inv.number),
    iban && el("cac:PayeeFinancialAccount", null, el("cbc:ID", null, iban.replace(/\s+/g, "")))
  );
  const termsText = paymentTermsText(inv.paymentTerms);

  // Document-level allowance per tax category (the stored discount is
  // allocated across lines; PINT AE needs each allowance categorised).
  const allowances = breakdown
    .filter((g) => g.allowanceFils > 0)
    .map((g) =>
      el(
        "cac:AllowanceCharge",
        null,
        el("cbc:ChargeIndicator", null, "false"),
        el("cbc:AllowanceChargeReasonCode", null, "95"),
        el("cbc:AllowanceChargeReason", null, "Discount"),
        amountEl("cbc:Amount", g.allowanceFils, currency),
        taxCategory("cac:TaxCategory", g.category, g.rate)
      )
    );

  const taxSubtotals = breakdown.map((g) =>
    el(
      "cac:TaxSubtotal",
      null,
      amountEl("cbc:TaxableAmount", g.taxableFils, currency),
      amountEl("cbc:TaxAmount", g.taxFils, currency),
      taxCategory("cac:TaxCategory", g.category, g.rate)
    )
  );

  const lineTag = isCredit ? "cac:CreditNoteLine" : "cac:InvoiceLine";
  const qtyTag = isCredit ? "cbc:CreditedQuantity" : "cbc:InvoicedQuantity";
  const lineXml = computed.map((l, i) => {
    const extra = opts.lineExtras?.[i] ?? {};
    const category = l.classification.ublCategory;
    const unitCode = extra.unitCode || "EA";
    const lineVatFils = category === "S" ? l.vatFils : 0;
    const lineNetAfterDoc = l.lineExtensionFils - l.documentDiscountFils;
    const lineDiscount = l.line as InvoiceLine & {
      discountType?: string | null;
      discountValue?: number | null;
    };
    return el(
      lineTag,
      null,
      el("cbc:ID", null, String(i + 1)),
      el(qtyTag, { unitCode }, String(l.quantity)),
      amountEl("cbc:LineExtensionAmount", l.lineExtensionFils, currency),
      l.lineDiscountFils > 0 &&
        el(
          "cac:AllowanceCharge",
          null,
          el("cbc:ChargeIndicator", null, "false"),
          el("cbc:AllowanceChargeReasonCode", null, "95"),
          el("cbc:AllowanceChargeReason", null, "Discount"),
          lineDiscount.discountType === "percent" && lineDiscount.discountValue
            ? el("cbc:MultiplierFactorNumeric", null, String(Number(lineDiscount.discountValue)))
            : null,
          amountEl("cbc:Amount", l.lineDiscountFils, currency),
          lineDiscount.discountType === "percent"
            ? amountEl("cbc:BaseAmount", l.grossFils, currency)
            : null
        ),
      el(
        "cac:Item",
        null,
        el("cbc:Description", null, l.line.description),
        el("cbc:Name", null, l.line.description.slice(0, 200)),
        extra.gtin &&
          el(
            "cac:StandardItemIdentification",
            null,
            el("cbc:ID", { schemeID: "0160" }, extra.gtin)
          ),
        extra.rcmGoodsType &&
          el("cac:CommodityClassification", null, el("cbc:NatureCode", null, extra.rcmGoodsType)),
        taxCategory("cac:ClassifiedTaxCategory", category, l.vatRate)
      ),
      el(
        "cac:Price",
        null,
        amountEl("cbc:PriceAmount", l.unitPriceFils, currency),
        el("cbc:BaseQuantity", { unitCode }, "1"),
        el(
          "cac:AllowanceCharge",
          null,
          el("cbc:ChargeIndicator", null, "false"),
          amountEl("cbc:Amount", 0, currency),
          amountEl("cbc:BaseAmount", l.unitPriceFils, currency)
        )
      ),
      el(
        "cac:ItemPriceExtension",
        null,
        amountEl("cbc:Amount", lineNetAfterDoc + lineVatFils, currency),
        category !== "E" &&
          el("cac:TaxTotal", null, amountEl("cbc:TaxAmount", lineVatFils, currency))
      )
    );
  });

  const aedTotalInclVat = foreign ? fromFils(toAedFils(payableFils)) : null;
  const typeCodeTag = isCredit ? "cbc:CreditNoteTypeCode" : "cbc:InvoiceTypeCode";

  const head = [
    el("cbc:UBLVersionID", null, "2.1"),
    el("cbc:CustomizationID", null, EINVOICE_CUSTOMIZATION_ID),
    el("cbc:ProfileID", null, EINVOICE_PROFILE_ID),
    el("cbc:ProfileExecutionID", null, transactionTypeCode(flags)),
    el("cbc:ID", null, inv.number),
    el("cbc:UUID", null, uuid),
    el("cbc:IssueDate", null, issueDate),
    el("cbc:IssueTime", null, issueTime),
  ];
  const currencyBlock = [
    el("cbc:DocumentCurrencyCode", null, currency),
    foreign && el("cbc:TaxCurrencyCode", null, "AED"),
  ];
  const aedTotalRef =
    foreign &&
    el(
      "cac:AdditionalDocumentReference",
      null,
      el("cbc:ID", null, "AED-TOTAL-INCL-VAT"),
      el("cbc:DocumentTypeCode", null, "aedtotal-incl-vat"),
      el("cbc:DocumentDescription", null, aedTotalInclVat)
    );
  const signatureNote = comment(
    "Digital signature is applied by the Accredited Service Provider (PINT AE corner 2); not signed here."
  );
  const parties = [
    el("cac:AccountingSupplierParty", null, partyXml(seller, "seller")),
    el("cac:AccountingCustomerParty", null, partyXml(buyer, "buyer")),
  ];
  // Exports (BTAE-02 XXXXXXX1) must state the deliver-to address (ibr-152-ae).
  const deliverTo =
    flags.exports && buyerCountry !== "AE"
      ? el(
          "cac:DeliveryLocation",
          null,
          el(
            "cac:Address",
            null,
            opt("cbc:StreetName", buyer.address),
            opt("cbc:CityName", buyer.city),
            opt("cbc:CountrySubentity", buyer.emirate),
            el("cac:Country", null, el("cbc:IdentificationCode", null, buyerCountry))
          )
        )
      : null;
  const delivery =
    (supplyDate || deliverTo) &&
    el("cac:Delivery", null, opt("cbc:ActualDeliveryDate", supplyDate), deliverTo);
  const exchange =
    foreign &&
    el(
      "cac:TaxExchangeRate",
      null,
      el("cbc:SourceCurrencyCode", null, currency),
      el("cbc:TargetCurrencyCode", null, "AED"),
      el("cbc:CalculationRate", null, rate.toDecimalPlaces(6).toString())
    );
  const taxTotals = [
    el("cac:TaxTotal", null, amountEl("cbc:TaxAmount", vatFils, currency), taxSubtotals),
    foreign && el("cac:TaxTotal", null, amountEl("cbc:TaxAmount", toAedFils(vatFils), "AED")),
  ];
  const monetary = el(
    "cac:LegalMonetaryTotal",
    null,
    amountEl("cbc:LineExtensionAmount", lineExtTotal, currency),
    amountEl("cbc:TaxExclusiveAmount", subtotalFils, currency),
    amountEl("cbc:TaxInclusiveAmount", subtotalFils + vatFils, currency),
    docAllowanceFils > 0 && amountEl("cbc:AllowanceTotalAmount", docAllowanceFils, currency),
    amountEl("cbc:PayableAmount", subtotalFils + vatFils, currency)
  );
  const paymentTerms = termsText && el("cac:PaymentTerms", null, el("cbc:Note", null, termsText));

  const root = isCredit
    ? el(
        "CreditNote",
        { xmlns: NS.creditNote, "xmlns:cac": NS.cac, "xmlns:cbc": NS.cbc },
        head,
        el(typeCodeTag, null, doc.typeCode),
        opt("cbc:Note", inv.notes),
        currencyBlock,
        el(
          "cac:DiscrepancyResponse",
          null,
          el("cbc:ResponseCode", null, reasonCode),
          el("cbc:Description", null, inv.notes || CREDIT_NOTE_REASON_CODES[reasonCode])
        ),
        billingReference,
        aedTotalRef,
        signatureNote,
        parties,
        delivery,
        paymentMeans,
        paymentTerms,
        exchange,
        allowances,
        taxTotals,
        monetary,
        lineXml
      )
    : el(
        "Invoice",
        { xmlns: NS.invoice, "xmlns:cac": NS.cac, "xmlns:cbc": NS.cbc },
        head,
        opt("cbc:DueDate", dueDate),
        el(typeCodeTag, null, doc.typeCode),
        opt("cbc:Note", inv.notes),
        supplyDate && supplyDate < issueDate ? el("cbc:TaxPointDate", null, supplyDate) : null,
        currencyBlock,
        billingReference,
        aedTotalRef,
        signatureNote,
        parties,
        delivery,
        paymentMeans,
        paymentTerms,
        allowances,
        exchange,
        taxTotals,
        monetary,
        lineXml
      );

  const xml = serializeXml(root);
  const hash = crypto.createHash("sha256").update(xml).digest("hex");
  return { xml, uuid, hash, documentType: doc.typeCode };
}

/** IBT-009: stored due date, else derived from the payment terms (net30, due_on_receipt). */
function resolveDueDate(inv: InvoiceLike): string | null {
  if (inv.dueDate) return formatDate(inv.dueDate);
  return inv.date ? dueDateFromTerms(formatDate(inv.date), inv.paymentTerms) : null;
}

export interface EInvoiceIssue {
  field: string;
  message: string;
  /** Stable machine code for issues the UI explains with its own localised fix text. */
  code?: string;
}

/** IBT-049: the buyer's electronic address (cbc:EndpointID) cannot be built. */
export const BUYER_ENDPOINT_MISSING = "EINVOICE_BUYER_ENDPOINT_MISSING";

/** ibr-144-ae: the buyer's street, city or emirate is missing (named fix-it field customer.address). */
export const BUYER_ADDRESS_MISSING = "EINVOICE_BUYER_ADDRESS_MISSING";

const TRN_RE = /^[0-9]{15}$/;

/**
 * Pre-submission validation on the stored data: every issue here would make
 * the PINT AE document fail the schematron or be rejected by an ASP. Surfaced
 * to the UI as fix-it errors before generation.
 */
export function validateForEInvoicing(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  ctx: {
    customer?: Partial<EInvoiceParty>;
    originalInvoice?: { number: string } | null;
    lineExtras?: EInvoiceLineExtra[];
  } = {}
): EInvoiceIssue[] {
  const issues: EInvoiceIssue[] = [];
  const inv = invoice as InvoiceLike;
  const co = company as CompanyLike;

  if (!company.trnVatNumber) {
    issues.push({
      field: "company.trnVatNumber",
      message: "Supplier TRN is required for e-invoicing",
    });
  } else if (!TRN_RE.test(company.trnVatNumber)) {
    issues.push({
      field: "company.trnVatNumber",
      message: "Supplier TRN must be exactly 15 digits",
    });
  } else if (!isPintAeTrn(company.trnVatNumber)) {
    issues.push({
      field: "company.trnVatNumber",
      message: "Supplier TRN must start with 1 and end with 03 (ibr-132-ae)",
    });
  }
  if (!company.name) {
    issues.push({ field: "company.name", message: "Supplier legal name is required" });
  }
  if (!(co.addressStreet || co.businessAddress)) {
    issues.push({
      field: "company.addressStreet",
      message: "Supplier street address is required (ibr-143-ae)",
    });
  }
  if (!co.addressCity) {
    issues.push({
      field: "company.addressCity",
      message: "Supplier city is required (ibr-143-ae)",
    });
  }
  if (countryCode(co.addressCountry) === "AE" && !emirateSubentity(co.emirate)) {
    issues.push({ field: "company.emirate", message: "Supplier emirate is required (ibr-128-ae)" });
  }
  const sellerLegal = sellerLegalId(co);
  if (!sellerLegal) {
    issues.push({
      field: "company.tradeLicenceNo",
      message:
        "Seller legal identifier (trade licence, Emirates ID, passport or Cabinet decision) is required (ibr-150-ae)",
    });
  } else if (sellerLegal.type === "PAS" && !co.sellerIdCountry) {
    issues.push({
      field: "company.sellerIdCountry",
      message: "Passport issuing country is required for a passport seller ID (ibr-012-ae)",
    });
  }
  const buyerLegal = ctx.customer;
  if (buyerLegal?.legalIdType === "PAS" && buyerLegal.legalId && !buyerLegal.legalAuthority) {
    issues.push({
      field: "customer.legalIdCountry",
      message: "Passport issuing country is required for a passport buyer ID (ibr-010-ae)",
    });
  }
  const storedTin = (co as CompanyLike & { einvoiceTin?: string | null }).einvoiceTin;
  if (storedTin && tinProblem(storedTin, co)) {
    issues.push({
      field: "company.einvoiceTin",
      message: "Supplier TIN must be 10 digits starting with 1 and match the TRN's first 10 digits",
    });
  }
  if (!invoice.number) {
    issues.push({ field: "invoice.number", message: "Invoice number is required" });
  }
  if (!invoice.date) {
    issues.push({ field: "invoice.date", message: "Invoice issue date is required" });
  }
  if (!invoice.customerName) {
    issues.push({ field: "invoice.customerName", message: "Buyer name is required" });
  }
  const buyerTrn = ctx.customer?.trn ?? invoice.customerTrn;
  if (buyerTrn && !TRN_RE.test(buyerTrn)) {
    issues.push({
      field: "invoice.customerTrn",
      message: "Buyer TRN must be exactly 15 digits when provided",
    });
  } else if (!ctx.customer?.endpointId?.trim() && !tinFromTrn(buyerTrn ?? null)) {
    // PINT AE requires a buyer EndpointID (IBT-049) with a scheme; partyXml derives it from the
    // TRN (0235 + 10-digit TIN) or takes the contact's recorded Peppol endpoint. Without either
    // the document can never pass PINT-EndpointID, so say what to add before anything is built.
    issues.push({
      field: "customer.endpointId",
      code: BUYER_ENDPOINT_MISSING,
      message:
        "Buyer has no electronic address (IBT-049): add the buyer's 15-digit TRN to the invoice " +
        "or customer, or record the customer's Peppol endpoint (scheme 0235 with its 10-digit TIN, " +
        "or its own Peppol scheme and ID) (PINT-EndpointID)",
    });
  }
  if (lines.length === 0) {
    issues.push({ field: "lines", message: "At least one invoice line is required" });
  }
  if (!invoice.currency) {
    issues.push({ field: "invoice.currency", message: "Document currency code is required" });
  }
  if (inv.invoiceType !== "credit_note" && Number(invoice.total) > 0 && !resolveDueDate(inv)) {
    issues.push({
      field: "invoice.dueDate",
      message: "Payment due date is required when an amount is payable (ibr-127-ae)",
    });
  }
  if (inv.invoiceType === "credit_note" && !(ctx.originalInvoice || inv.originalInvoiceId)) {
    issues.push({
      field: "invoice.originalInvoiceId",
      message: "A credit note must reference the invoice it adjusts (ibr-055-ae)",
    });
  }
  if (ctx.customer) {
    const c = ctx.customer;
    if (countryCode(c.country) === "AE") {
      // Check the parts one by one (a buyer with no address at all used to slip through here and
      // only surface later as the schematron rule ibr-144-ae).
      const missing = [
        !c.address?.trim() && "street",
        !c.city?.trim() && "city",
        !emirateSubentity(c.emirate) && "emirate",
      ].filter(Boolean) as string[];
      if (missing.length > 0) {
        issues.push({
          field: "customer.address",
          code: BUYER_ADDRESS_MISSING,
          message: `Buyer ${missing.join(", ")} missing: street, city and emirate are all required for a UAE buyer (ibr-144-ae)`,
        });
      }
    }
  }

  let lineSum = 0;
  let lineVat = 0;
  let anyReverseCharge = false;
  lines.forEach((line, i) => {
    const category = vatCategoryFor(line, inv.reverseCharge);
    if (!line.description) {
      issues.push({ field: `lines[${i}].description`, message: "Line description is required" });
    }
    if (!(Math.abs(Number(line.quantity)) > 0)) {
      issues.push({ field: `lines[${i}].quantity`, message: "Line quantity must be non-zero" });
    }
    if (line.unitPrice < 0) {
      issues.push({
        field: `lines[${i}].unitPrice`,
        message: "Line unit price cannot be negative",
      });
    }
    if (category === "AE") {
      anyReverseCharge = true;
      const extra = ctx.lineExtras?.[i];
      if (!extra?.gtin) {
        issues.push({
          field: `lines[${i}].gtin`,
          message: "A reverse-charge line needs the item GTIN (ibr-174-ae)",
        });
      }
      if (
        !extra?.rcmGoodsType ||
        !(RCM_GOODS_TYPE_CODES as readonly string[]).includes(extra.rcmGoodsType)
      ) {
        issues.push({
          field: `lines[${i}].rcmGoodsType`,
          message: "A reverse-charge line needs the goods type code (ibr-006-ae / ibr-166-ae)",
        });
      }
    }
    const ext = Number(line.quantity) * Number(line.unitPrice);
    lineSum += ext;
    lineVat += category === "S" ? ext * Number(line.vatRate ?? 0.05) : 0;
  });
  if (anyReverseCharge && !buyerTrn) {
    issues.push({
      field: "invoice.customerTrn",
      message: "Buyer TRN is required on a reverse-charge invoice (ibr-103-ae)",
    });
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const hasDiscount = Number(inv.discountAmount ?? 0) !== 0;
  if (lines.length > 0 && !hasDiscount) {
    if (Math.abs(round2(lineSum) - round2(invoice.subtotal)) > 0.05) {
      issues.push({
        field: "invoice.subtotal",
        message: `Line totals (${round2(lineSum).toFixed(2)}) do not match the invoice subtotal (${round2(invoice.subtotal).toFixed(2)})`,
      });
    }
    if (Math.abs(round2(lineVat) - round2(invoice.vatAmount)) > 0.05) {
      issues.push({
        field: "invoice.vatAmount",
        message: `Line VAT (${round2(lineVat).toFixed(2)}) does not match the invoice VAT amount (${round2(invoice.vatAmount).toFixed(2)})`,
      });
    }
  } else if (lines.length > 0) {
    try {
      const { totals } = computeEInvoiceAmounts(inv, lines);
      if (Math.abs(totals.subtotalFils - Math.round(Math.abs(invoice.subtotal) * 100)) > 1) {
        issues.push({
          field: "invoice.subtotal",
          message: "Discounted line totals do not match the invoice subtotal",
        });
      }
    } catch (err) {
      issues.push({ field: "lines", message: (err as Error).message });
    }
  }
  if (Math.abs(round2(invoice.subtotal + invoice.vatAmount) - round2(invoice.total)) > 0.05) {
    issues.push({
      field: "invoice.total",
      message: "Subtotal plus VAT does not equal the invoice total",
    });
  }

  return issues;
}
