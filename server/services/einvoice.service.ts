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
import { isB2cCashSale } from "./einvoice/applicability";
import crypto from "crypto";
import Decimal from "decimal.js";
import type { Invoice, InvoiceLine, Company } from "../../shared/schema";
import { UNSPECIFIED_CARD_PAYMENT_MEANS_CODE } from "../../shared/einvoice-payment-means";
import { classifySupply, type SupplyClassification } from "../../shared/vat-classification";
import { fromFils, toFils, tryToFils } from "../../shared/money";
import { calendarDateKey, calendarTimeKey } from "../../shared/uae-date";
import { computeSalesDocument, storedLineToTotalsInput } from "./document-totals.service";
import { dueDateFromTerms } from "./invoice-lifecycle";
import { comment, el, opt, serializeXml, type XmlElement } from "./einvoice/xml";
import { all, attr, first, parseXml, partyVatTrn, text, textAt } from "./einvoice/dom";
import {
  CATEGORY_REASON_TEXT,
  CREDIT_NOTE_REASON_CODES,
  DEFAULT_CREDIT_NOTE_REASON,
  DOCUMENT_TYPE,
  PEPPOL_SCHEME_UAE_TIN,
  RCM_GOODS_TYPE_CODES,
  emirateSubentity,
  isPintAeTrn,
  isUaeTin,
  paymentTermsText,
  tinFromTrn,
  transactionTypeCode,
  uaePeppolEndpointIssue,
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

export type UblCategory = "S" | "Z" | "E" | "O" | "AE" | "N";

/** UNCL5305 category for a stored line, via the single classification table. */
export function vatCategoryFor(
  line: Pick<InvoiceLine, "vatSupplyType" | "vatRate"> & Partial<Pick<InvoiceLine, "marginScheme">>,
  reverseCharge?: boolean | null
): UblCategory {
  if (line.marginScheme) return "N";
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
  addressLine2?: string | null;
  city?: string | null;
  postalCode?: string | null;
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
  /** An explicit UAE business clock time (HH:MM:SS). */
  issueTime?: string;
  originalInvoice?: { number: string; date: Date | string } | null;
  creditNoteReasonCode?: CreditNoteReasonCode | null;
  paymentMeansCode?: PaymentMeansCode | null;
  payeeIban?: string | null;
  paidAtIssue?: boolean;
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
  const day = calendarDateKey(date);
  const timestamp = Date.parse(day);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day)
    throw new RangeError("Invalid e-invoice calendar date");
  return day;
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
  const outsideVat = categories.length > 0 && categories.every((c) => c === "O" || c === "E");
  if (invoice.invoiceType === "credit_note") {
    return {
      root: "CreditNote",
      typeCode: outsideVat ? DOCUMENT_TYPE.outOfScopeCreditNote : DOCUMENT_TYPE.creditNote,
      kind: "credit_note",
    };
  }
  const typeCode = outsideVat ? DOCUMENT_TYPE.outOfScope : DOCUMENT_TYPE.invoice;
  if (invoice.invoiceType === "debit_note") {
    // UNCL1001 383 is the debit-note code, but the PINT AE
    // 2026.5 schematron (ibr-cl-01) only admits 380/480 on an Invoice. A UAE
    // debit note uses an Invoice that references the original through cac:BillingReference.
    return { root: "Invoice", typeCode, kind: "debit_note" };
  }
  return { root: "Invoice", typeCode, kind: outsideVat ? "out_of_scope" : "invoice" };
}

/** Read the document type from already generated UBL before submitting or polling it. */
export function readEInvoiceDocumentType(xml: string): string | null {
  try {
    const root = parseXml(xml).documentElement;
    if (root.localName === "CreditNote") return textAt(root, "cbc:CreditNoteTypeCode");
    if (root.localName === "Invoice") return textAt(root, "cbc:InvoiceTypeCode");
    return null;
  } catch {
    return null;
  }
}

export interface ComputedEInvoiceLine {
  line: InvoiceLine;
  category: UblCategory;
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
        marginScheme: l.marginScheme,
        marginPurchaseCost: l.marginPurchaseCost,
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
  const computed: ComputedEInvoiceLine[] = totals.lines.map((t, i) => {
    const line = lines[i];
    // PINT AE category N reports the selling price with no separate VAT. Rule ibr-115-ae
    // forbids a document allowance tagged N, so include its allocated share on each line.
    const margin = line.marginScheme;
    const lineDiscountFils = t.lineDiscountFils + (margin ? t.documentDiscountFils : 0);
    return {
      line,
      category: margin ? "N" : t.classification.ublCategory,
      quantity: Math.abs(Number(line.quantity)),
      unitPriceFils: Math.abs(toFils(line.unitPrice)),
      grossFils: t.grossFils,
      lineDiscountFils,
      documentDiscountFils: margin ? 0 : t.documentDiscountFils,
      lineExtensionFils: t.grossFils - lineDiscountFils,
      vatFils: margin ? 0 : t.vatFils,
      vatRate: t.vatRate,
    };
  });
  return { sign, totals, lines: computed };
}

/** VAT breakdown: one subtotal per category (and rate). */
export function taxBreakdown(computed: ComputedEInvoiceLine[]) {
  const groups = new Map<
    string,
    { category: UblCategory; rate: number; taxableFils: number; allowanceFils: number }
  >();
  for (const l of computed) {
    const { category } = l;
    const rate = category === "S" || category === "N" ? l.vatRate : 0;
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
    category === "S" || category === "N"
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
    category === "E" || category === "O"
      ? null
      : (category === "S" || category === "N" ? rate * 100 : 0).toFixed(2);
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
  const scheme = (p.endpointId?.trim() && p.endpointScheme?.trim()) || PEPPOL_SCHEME_UAE_TIN;
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
        el("cbc:ID", { schemeID: PEPPOL_SCHEME_UAE_TIN }, tinFromTrn(trn))
      ),
    el("cac:PartyName", null, el("cbc:Name", null, p.name)),
    el(
      "cac:PostalAddress",
      null,
      opt("cbc:StreetName", p.address),
      opt("cbc:AdditionalStreetName", p.addressLine2),
      opt("cbc:CityName", p.city),
      opt("cbc:PostalZone", p.postalCode),
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
    addressLine2:
      [company.addressDistrict, company.addressPoBox && `PO Box ${company.addressPoBox}`]
        .filter((part) => part?.trim())
        .join(", ") || null,
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
  const categories = computed.map((l) => l.category);
  const doc = documentKind(inv, categories);
  const isCredit = doc.root === "CreditNote";
  const rate =
    Number(inv.exchangeRate) > 0 ? new Decimal(String(inv.exchangeRate)) : new Decimal(1);
  const foreign = currency !== "AED";
  const toAedFils = (fils: number) =>
    new Decimal(fils).times(rate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

  const seller = sellerFromCompany(co);
  const buyer: EInvoiceParty = {
    name: customer?.name || (inv.einvoiceBuyerContactId ? "" : inv.customerName) || "Cash Customer",
    trn: customer?.trn ?? (inv.einvoiceBuyerContactId ? null : inv.customerTrn) ?? null,
    address: customer?.address ?? (inv.einvoiceBuyerContactId ? null : inv.customerAddress) ?? null,
    addressLine2: customer?.addressLine2 ?? null,
    city: customer?.city ?? null,
    postalCode: customer?.postalCode ?? null,
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
    marginScheme: categories.includes("N"),
  };

  const issueDate = formatDate(inv.date);
  const issueTime = opts.issueTime ?? calendarTimeKey(inv.date);
  const supplyDate = inv.supplyDate ? formatDate(inv.supplyDate) : null;
  const dueDate = resolveDueDate(inv);
  const payableFils = totals.totalFils;
  const subtotalFils = breakdown.reduce((s, g) => s + g.taxableFils, 0);
  const vatFils = breakdown.reduce((s, g) => s + g.taxFils, 0);
  const lineExtTotal = computed.reduce((s, l) => s + l.lineExtensionFils, 0);
  const docAllowanceFils = breakdown.reduce((s, g) => s + g.allowanceFils, 0);

  const reasonCode: CreditNoteReasonCode =
    opts.creditNoteReasonCode && opts.creditNoteReasonCode in CREDIT_NOTE_REASON_CODES
      ? opts.creditNoteReasonCode
      : DEFAULT_CREDIT_NOTE_REASON;

  const original = opts.originalInvoice ?? null;
  const originalId = original?.number?.trim();
  const billingReference =
    ((isCredit && reasonCode !== "VD") || doc.kind === "debit_note") &&
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
  const meansCode = opts.paymentMeansCode ?? co.einvoicePaymentMeansCode ?? (iban ? "30" : "1");
  const paymentMeans = el(
    "cac:PaymentMeans",
    null,
    el("cbc:PaymentMeansCode", null, meansCode),
    el("cbc:PaymentID", null, inv.number),
    iban &&
      (meansCode === "30" || meansCode === "42") &&
      el("cac:PayeeFinancialAccount", null, el("cbc:ID", null, iban.replace(/\s+/g, "")))
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
    const { category } = l;
    const unitCode = extra.unitCode || "EA";
    const lineVatFils = l.vatFils;
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
          category !== "N" && lineDiscount.discountType === "percent" && lineDiscount.discountValue
            ? el("cbc:MultiplierFactorNumeric", null, String(Number(lineDiscount.discountValue)))
            : null,
          amountEl("cbc:Amount", l.lineDiscountFils, currency),
          category !== "N" && lineDiscount.discountType === "percent"
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
            opt("cbc:AdditionalStreetName", buyer.addressLine2),
            opt("cbc:CityName", buyer.city),
            opt("cbc:PostalZone", buyer.postalCode),
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
    opts.paidAtIssue && amountEl("cbc:PrepaidAmount", subtotalFils + vatFils, currency),
    amountEl("cbc:PayableAmount", opts.paidAtIssue ? 0 : subtotalFils + vatFils, currency)
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
export const BUYER_ENDPOINT_MISMATCH = "EINVOICE_BUYER_ENDPOINT_MISMATCH";
const PAYMENT_CARD_TYPE_REQUIRED = "EINVOICE_PAYMENT_CARD_TYPE_REQUIRED";

/** ibr-144-ae: the buyer's street, city or emirate is missing (named fix-it field customer.address). */
export const BUYER_ADDRESS_MISSING = "EINVOICE_BUYER_ADDRESS_MISSING";

const TRN_RE = /^[0-9]{15}$/;

function validDate(value: string | Date | null | undefined): boolean {
  return value != null && Number.isFinite(new Date(value).getTime());
}

/** Recheck these dispatch requirements on immutable XML queued by an earlier release. */
export function frozenEInvoiceDispatchIssue(xml: string): string | null {
  try {
    const root = parseXml(xml).documentElement;
    const buyer = first(root, "cac:AccountingCustomerParty/cac:Party");
    if (buyer) {
      const endpoint = first(buyer, "cbc:EndpointID");
      const participant = text(endpoint);
      const buyerTin = tinFromTrn(partyVatTrn(buyer));
      if (
        participant &&
        uaePeppolEndpointIssue(attr(endpoint, "schemeID"), participant, buyerTin) === "mismatch"
      ) {
        return BUYER_ENDPOINT_MISMATCH;
      }
    }
    if (
      all(root, "cac:PaymentMeans/cbc:PaymentMeansCode").some(
        (code) => text(code) === UNSPECIFIED_CARD_PAYMENT_MEANS_CODE
      )
    ) {
      return PAYMENT_CARD_TYPE_REQUIRED;
    }
    return null;
  } catch {
    return "EINVOICE_SCHEMA_INVALID";
  }
}

/** Check the stored invoice data before generating a UBL document. */
export function validateForEInvoicing(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  ctx: {
    customer?: Partial<EInvoiceParty>;
    originalInvoice?: { number: string; date?: string | Date } | null;
    lineExtras?: EInvoiceLineExtra[];
    options?: EInvoiceOptions;
  } = {}
): EInvoiceIssue[] {
  if (isB2cCashSale(invoice)) return [];
  const issues: EInvoiceIssue[] = [];
  const add = (field: string, code: string, message: string) =>
    issues.push({ field, code, message });
  const inv = invoice as InvoiceLike;
  const co = company as CompanyLike;
  const options = ctx.options;
  const categories = lines.map((line) => vatCategoryFor(line, inv.reverseCharge));
  const doc = documentKind(inv, categories);
  const seller = sellerFromCompany(co);
  const supplierTrn = seller.trn?.trim();
  const needsVatId =
    doc.typeCode !== DOCUMENT_TYPE.outOfScope &&
    doc.typeCode !== DOCUMENT_TYPE.outOfScopeCreditNote;

  if (!supplierTrn && needsVatId) {
    add(
      "company.trnVatNumber",
      "EINVOICE_SUPPLIER_TRN_REQUIRED",
      "Supplier TRN is required for e-invoicing"
    );
  } else if (supplierTrn && !TRN_RE.test(supplierTrn)) {
    add(
      "company.trnVatNumber",
      "EINVOICE_SUPPLIER_TRN_INVALID",
      "Supplier TRN must be exactly 15 digits"
    );
  } else if (supplierTrn && !isPintAeTrn(supplierTrn)) {
    add(
      "company.trnVatNumber",
      "EINVOICE_SUPPLIER_TRN_INVALID",
      "Supplier TRN must start with 1 and end with 03 (ibr-132-ae)"
    );
  }
  if (!seller.name?.trim()) {
    add("company.name", "EINVOICE_SUPPLIER_NAME_REQUIRED", "Supplier legal name is required");
  }
  if (!seller.address?.trim()) {
    add(
      "company.addressStreet",
      "EINVOICE_SUPPLIER_STREET_REQUIRED",
      "Supplier street address is required (ibr-143-ae)"
    );
  }
  if (!seller.city?.trim()) {
    add(
      "company.addressCity",
      "EINVOICE_SUPPLIER_CITY_REQUIRED",
      "Supplier city is required (ibr-143-ae)"
    );
  }
  if (countryCode(seller.country) === "AE" && !emirateSubentity(seller.emirate)) {
    add(
      "company.emirate",
      "EINVOICE_SUPPLIER_EMIRATE_REQUIRED",
      "Supplier emirate is required (ibr-128-ae)"
    );
  }
  if (!seller.legalId?.trim()) {
    add(
      "company.tradeLicenceNo",
      "EINVOICE_SUPPLIER_LEGAL_ID_REQUIRED",
      "Seller legal identifier (trade licence, Emirates ID, passport or Cabinet decision) is required (ibr-150-ae)"
    );
  } else if (
    seller.legalIdType === "PAS" &&
    !/^[A-Za-z]{2}$/.test(seller.legalAuthority?.trim() ?? "")
  ) {
    add(
      "company.sellerIdCountry",
      "EINVOICE_PASSPORT_COUNTRY_REQUIRED",
      "Passport issuing country is required for a passport seller ID (ibr-012-ae)"
    );
  }
  const buyerLegal = ctx.customer;
  if (
    buyerLegal?.legalIdType === "PAS" &&
    buyerLegal.legalId &&
    !/^[A-Za-z]{2}$/.test(buyerLegal.legalAuthority?.trim() ?? "")
  ) {
    add(
      "customer.legalIdCountry",
      "EINVOICE_PASSPORT_COUNTRY_REQUIRED",
      "Passport issuing country is required for a passport buyer ID (ibr-010-ae)"
    );
  }
  const storedTin = co.einvoiceTin;
  if (storedTin && tinProblem(storedTin, co)) {
    add(
      "company.einvoiceTin",
      "EINVOICE_SUPPLIER_TIN_INVALID",
      "Supplier TIN must be 10 digits starting with 1 and match the TRN's first 10 digits"
    );
  }
  const sellerEndpoint = seller.endpointId?.trim() || tinFromTrn(supplierTrn);
  if (
    (!sellerEndpoint && !needsVatId) ||
    (sellerEndpoint &&
      (!seller.endpointScheme || seller.endpointScheme === PEPPOL_SCHEME_UAE_TIN) &&
      !isUaeTin(sellerEndpoint))
  ) {
    add(
      "company.einvoiceTin",
      "EINVOICE_SUPPLIER_ENDPOINT_INVALID",
      "Enter a valid supplier Peppol address. Scheme 0235 requires a 10-digit TIN starting with 1."
    );
  }
  if (!invoice.number?.trim()) {
    add("invoice.number", "EINVOICE_INVOICE_NUMBER_REQUIRED", "Invoice number is required");
  }
  const issueDateValid = validDate(inv.date);
  if (!issueDateValid) {
    add("invoice.date", "EINVOICE_ISSUE_DATE_INVALID", "A valid invoice issue date is required");
  }
  const buyerName =
    ctx.customer?.name || (invoice.einvoiceBuyerContactId ? null : invoice.customerName);
  if (!buyerName?.trim()) {
    add("invoice.customerName", "EINVOICE_BUYER_NAME_REQUIRED", "Buyer name is required");
  }
  const buyerTrn = (
    ctx.customer?.trn ?? (invoice.einvoiceBuyerContactId ? null : invoice.customerTrn)
  )?.trim();
  const buyerEndpoint = ctx.customer?.endpointId?.trim();
  const buyerScheme = ctx.customer?.endpointScheme?.trim() || PEPPOL_SCHEME_UAE_TIN;
  const buyerEndpointIssue = buyerEndpoint
    ? uaePeppolEndpointIssue(buyerScheme, buyerEndpoint, tinFromTrn(buyerTrn))
    : null;
  if (buyerTrn && !isPintAeTrn(buyerTrn)) {
    add(
      "invoice.customerTrn",
      "EINVOICE_BUYER_TRN_INVALID",
      "Buyer TRN must be 15 digits, start with 1 and end with 03 (ibr-132-ae)"
    );
  }
  if (!buyerTrn && !buyerEndpoint) {
    add(
      "customer.endpointId",
      BUYER_ENDPOINT_MISSING,
      "Buyer has no electronic address (IBT-049): add the buyer's 15-digit TRN to the invoice " +
        "or customer, or record the customer's Peppol endpoint (scheme 0235 with its 10-digit TIN, " +
        "or its own Peppol scheme and ID) (PINT-EndpointID)"
    );
  } else if (buyerEndpointIssue === "invalid") {
    add(
      "customer.endpointId",
      "EINVOICE_BUYER_ENDPOINT_INVALID",
      "Buyer Peppol scheme 0235 requires a 10-digit TIN starting with 1."
    );
  } else if (buyerEndpointIssue === "mismatch") {
    add(
      "customer.endpointId",
      BUYER_ENDPOINT_MISMATCH,
      "The buyer's Peppol 0235 endpoint must match the first 10 digits of the buyer's VAT TRN."
    );
  }
  if (lines.length === 0) {
    add("lines", "EINVOICE_LINES_REQUIRED", "At least one invoice line is required");
  }
  if (categories.includes("N") && categories.some((category) => category !== "N")) {
    add(
      "lines",
      "EINVOICE_MARGIN_SCHEME_MIXED",
      "PINT AE requires every line on a profit-margin scheme invoice to use that scheme (ibr-116-ae)"
    );
  }
  if (!/^[A-Za-z]{3}$/.test(inv.currency ?? "")) {
    add(
      "invoice.currency",
      "EINVOICE_CURRENCY_INVALID",
      "Enter a three-letter document currency code"
    );
  } else if (
    inv.currency.toUpperCase() !== "AED" &&
    (!Number.isFinite(Number(inv.exchangeRate)) || Number(inv.exchangeRate) <= 0)
  ) {
    add(
      "invoice.exchangeRate",
      "EINVOICE_EXCHANGE_RATE_INVALID",
      "An exchange rate to AED is required for this currency"
    );
  }
  const payable = !options?.paidAtIssue && Number(invoice.total) > 0;
  if (
    (inv.dueDate && !validDate(inv.dueDate)) ||
    (doc.root !== "CreditNote" && payable && issueDateValid && !resolveDueDate(inv))
  ) {
    add(
      "invoice.dueDate",
      "EINVOICE_DUE_DATE_INVALID",
      "A valid payment due date is required when an amount is payable (ibr-127-ae)"
    );
  }
  if (inv.supplyDate && !validDate(inv.supplyDate)) {
    add("invoice.supplyDate", "EINVOICE_SUPPLY_DATE_INVALID", "Enter a valid supply date");
  }

  const original = ctx.originalInvoice ?? options?.originalInvoice;
  const needsOriginal =
    doc.kind === "debit_note" ||
    (doc.root === "CreditNote" && options?.creditNoteReasonCode !== "VD");
  if (needsOriginal && !original?.number?.trim()) {
    add(
      "invoice.originalInvoiceId",
      "EINVOICE_ORIGINAL_INVOICE_REQUIRED",
      "The adjustment must reference the number of the original invoice (ibr-055-ae)"
    );
  } else if (original?.date && !validDate(original.date)) {
    add(
      "invoice.originalInvoiceId",
      "EINVOICE_ORIGINAL_INVOICE_DATE_INVALID",
      "The original invoice must have a valid issue date"
    );
  }

  const iban = options?.payeeIban ?? co.einvoicePayeeIban;
  const meansCode = options?.paymentMeansCode ?? co.einvoicePaymentMeansCode;
  if (meansCode === UNSPECIFIED_CARD_PAYMENT_MEANS_CODE) {
    add(
      "invoice.paymentMeans",
      PAYMENT_CARD_TYPE_REQUIRED,
      "Check the payment record and use the confirmed credit or debit card method for e-invoicing."
    );
  }
  if (meansCode === "30" && !iban?.trim()) {
    add(
      "company.einvoicePayeeIban",
      "EINVOICE_PAYMENT_ACCOUNT_REQUIRED",
      "Enter the receiving account IBAN for the selected credit-transfer payment method (ibr-192-ae)"
    );
  }

  if (ctx.customer && countryCode(ctx.customer.country) === "AE") {
    const c = ctx.customer;
    const missing = [
      !c.address?.trim() && "street",
      !c.city?.trim() && "city",
      !emirateSubentity(c.emirate) && "emirate",
    ].filter(Boolean);
    if (missing.length > 0) {
      add(
        "customer.address",
        BUYER_ADDRESS_MISSING,
        `Buyer ${missing.join(", ")} missing: street, city and emirate are all required for a UAE buyer (ibr-144-ae)`
      );
    }
  }

  if (categories.includes("AE") && !buyerTrn) {
    add(
      "invoice.customerTrn",
      "EINVOICE_REVERSE_CHARGE_TRN_REQUIRED",
      "Buyer TRN is required on a reverse-charge invoice (ibr-103-ae)"
    );
  }
  const extras = ctx.lineExtras ?? options?.lineExtras;
  let numbersValid = true;
  lines.forEach((line, i) => {
    if (!line.description?.trim()) {
      add(
        `lines[${i}].description`,
        "EINVOICE_LINE_DESCRIPTION_REQUIRED",
        "Line description is required"
      );
    }
    const quantity = Number(line.quantity);
    if (
      !Number.isFinite(quantity) ||
      quantity === 0 ||
      (doc.root !== "CreditNote" && quantity < 0)
    ) {
      numbersValid = false;
      add(
        `lines[${i}].quantity`,
        "EINVOICE_LINE_QUANTITY_INVALID",
        "Line quantity must be finite and positive for an invoice, or non-zero for a credit note"
      );
    }
    const priceFils = tryToFils(line.unitPrice);
    if (priceFils === null || priceFils < 0) {
      numbersValid = false;
      add(
        `lines[${i}].unitPrice`,
        "EINVOICE_LINE_PRICE_INVALID",
        "Enter a valid non-negative line unit price"
      );
    }
    if (line.marginScheme && tryToFils(line.marginPurchaseCost) === null) {
      numbersValid = false;
      add(
        `lines[${i}].marginPurchaseCost`,
        "EINVOICE_MARGIN_SCHEME_COST_INVALID",
        "Enter the purchase cost for the profit-margin scheme item"
      );
    }
    if (categories[i] !== "AE") return;

    const extra = extras?.[i];
    if (!extra?.gtin?.trim()) {
      add(
        `lines[${i}].gtin`,
        "EINVOICE_REVERSE_CHARGE_GTIN_REQUIRED",
        "A reverse-charge line needs the item GTIN (ibr-174-ae)"
      );
    }
    if (
      !extra?.rcmGoodsType ||
      !(RCM_GOODS_TYPE_CODES as readonly string[]).includes(extra.rcmGoodsType)
    ) {
      add(
        `lines[${i}].rcmGoodsType`,
        "EINVOICE_REVERSE_CHARGE_GOODS_TYPE_REQUIRED",
        "A reverse-charge line needs the goods type code (ibr-006-ae / ibr-166-ae)"
      );
    }
  });

  if (numbersValid && lines.length > 0) {
    try {
      const { sign, totals } = computeEInvoiceAmounts(inv, lines);
      if (totals.subtotalFils * sign !== tryToFils(invoice.subtotal)) {
        add(
          "invoice.subtotal",
          "EINVOICE_SUBTOTAL_MISMATCH",
          "Line totals after discounts do not match the invoice subtotal"
        );
      }
      if (totals.vatFils * sign !== tryToFils(invoice.vatAmount)) {
        add(
          "invoice.vatAmount",
          "EINVOICE_VAT_TOTAL_MISMATCH",
          "VAT calculated on the lines after discounts does not match the invoice VAT"
        );
      }
      if (totals.totalFils * sign !== tryToFils(invoice.total)) {
        add(
          "invoice.total",
          "EINVOICE_TOTAL_MISMATCH",
          "Subtotal after discounts plus VAT does not equal the invoice total"
        );
      }
    } catch {
      add(
        "lines",
        "EINVOICE_LINE_AMOUNTS_INVALID",
        "Check the line values and discounts: a discount cannot exceed the amount it applies to"
      );
    }
  }
  return issues;
}
