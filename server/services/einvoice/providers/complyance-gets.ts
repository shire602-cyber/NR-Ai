/**
 * PINT AE UBL -> Complyance GETS (E2).
 *
 * Complyance does not take a PINT AE UBL document as such: its Unify API takes the invoice in
 * GETS, Complyance's own JSON format, and produces the PINT AE e-invoice itself (or reads XML
 * through a mapping you build in its Integration engine). Our single source of truth stays the
 * PINT AE UBL we generate and validate (XSD + schematron + rule list): this module reads that
 * document and writes the same facts as GETS, so the provider never sees anything we did not
 * validate, and there is no second generator to keep in step.
 *
 * Field paths, document-type selections and code-list values follow docs.complyance.io (read
 * 2026-11-17): /countries/ae/fields/, /countries/ae/examples/, /countries/ae/code-lists/,
 * /api-reference/gets/document-types/. DOC-DERIVED: confirm every payload with
 * `purpose: "validate"` in the Complyance sandbox before relying on it (docs/einvoicing-complyance.md).
 */
import { all, attr, children, first, num, parseXml, text, textAt, type XNode } from "../dom";

export interface GetsDocumentType {
  base: "tax_invoice" | "credit_note";
  modifiers: string[];
}

export interface GetsDocument {
  documentType: GetsDocumentType;
  payload: Record<string, unknown>;
}

/** UAE document type code -> GETS selection (/api-reference/gets/document-types/). */
const TYPE_CODES: Record<string, GetsDocumentType> = {
  "380": { base: "tax_invoice", modifiers: [] },
  "381": { base: "credit_note", modifiers: [] },
  "480": { base: "tax_invoice", modifiers: ["out_of_scope"] },
  "81": { base: "credit_note", modifiers: ["out_of_scope"] },
  "389": { base: "tax_invoice", modifiers: ["self_billed"] },
  "261": { base: "credit_note", modifiers: ["self_billed"] },
};

/** BTAE-02 transaction type flags (cbc:ProfileExecutionID, 8 positions) -> GETS modifiers. */
const TRANSACTION_FLAG_MODIFIERS = [
  "free_trade_zone",
  "deemed_supply",
  "margin_scheme",
  "summary",
  "continuous_supply",
  "disclosed_agent",
  "e_commerce",
  "export",
];

/** UNCL4461 payment means code -> GETS value (UAE payment means list). */
const PAYMENT_MEANS: Record<string, string> = {
  "1": "INSTRUMENT_NOT_DEFINED",
  "10": "IN_CASH",
  "20": "CHEQUE",
  "21": "BANKERS_DRAFT",
  "30": "CREDIT_TRANSFER",
  "49": "DIRECT_DEBIT",
  "54": "CREDIT_CARD",
  "55": "DEBIT_CARD",
  "68": "ONLINE_PAYMENT_SERVICE",
};

/** BTAE-03 credit note reason code -> GETS value. */
const CREDIT_NOTE_REASONS: Record<string, string> = {
  "DL8.61.1.A": "SUPPLY_CANCELLED",
  "DL8.61.1.B": "TAX_TREATMENT_CHANGED",
  "DL8.61.1.C": "CONSIDERATION_ALTERED",
  "DL8.61.1.D": "GOODS_OR_SERVICES_RETURNED",
  "DL8.61.1.E": "TAX_APPLIED_IN_ERROR",
  VD: "VOLUME_DISCOUNT",
};

/** IBT-121 VAT exemption reason code -> GETS value. Other codes go as text only. */
const EXEMPTION_REASONS: Record<string, string> = {
  "DL8.46.1": "CERTAIN_FINANCIAL_SERVICES",
  "DL8.46.2": "RESIDENTIAL_UNITS",
  "DL8.46.3": "BARE_LAND",
  "DL8.46.4": "LOCAL_PASSENGER_TRANSPORT",
};

/** BTAE-09 reverse-charge goods type -> GETS value. */
const RCM_TYPES: Record<string, string> = {
  "DL8.48.8.2": "ELECTRONIC_DEVICES",
  "DL8.48.8.1": "GOLD_AND_DIAMONDS",
  "DL8.48.3.1": "CRUDE_OR_REFINED_OIL",
  "DL8.48.3.2": "UNPROCESSED_OR_PROCESSED_NATURAL_GAS",
  "DL8.48.3.3": "PURE_HYDROCARBONS",
};

/** UNCL5189 allowance reason codes our generator emits -> GETS value. */
const ALLOWANCE_REASONS: Record<string, string> = {
  "95": "discount",
  "100": "special_rebate",
};

class GetsMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GetsMappingError";
  }
}

const amount = (node: XNode | Document, path: string): number | undefined =>
  num(textAt(node, path)) ?? undefined;

/** Drop undefined / null / empty-string / empty-object members so the payload stays minimal. */
function compact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => compact(v)).filter((v) => v !== undefined) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || v === null || v === "") continue;
      const c = compact(v);
      if (c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 0) continue;
      out[k] = c;
    }
    return out as T;
  }
  return value;
}

function address(node: XNode | null) {
  if (!node) return undefined;
  return {
    addressLine1: textAt(node, "cbc:StreetName"),
    addressLine2: textAt(node, "cbc:AdditionalStreetName"),
    city: textAt(node, "cbc:CityName"),
    postalCode: textAt(node, "cbc:PostalZone"),
    stateOrProvince: textAt(node, "cbc:CountrySubentity"),
    country: textAt(node, "cac:Country/cbc:IdentificationCode"),
  };
}

function party(node: XNode | null) {
  if (!node) return { party: undefined, scheme: null, authority: null, passportCountry: null };
  const endpoint = first(node, "cbc:EndpointID");
  const legalId = first(node, "cac:PartyLegalEntity/cbc:CompanyID");
  const registrationType = attr(legalId, "schemeAgencyID") ?? attr(legalId, "schemeID") ?? "TL";
  const agencyName = attr(legalId, "schemeAgencyName");
  const vat = all(node, "cac:PartyTaxScheme")
    .filter((p) => textAt(p, "cac:TaxScheme/cbc:ID") === "VAT")
    .map((p) => textAt(p, "cbc:CompanyID"))
    .filter((v): v is string => !!v);
  return {
    party: {
      name:
        textAt(node, "cac:PartyLegalEntity/cbc:RegistrationName") ??
        textAt(node, "cac:PartyName/cbc:Name"),
      peppolId: text(endpoint),
      taxIds: vat.map((value) => ({ type: "VAT", value })),
      registrationNumbers: legalId
        ? [
            {
              type: registrationType,
              value: text(legalId),
            },
          ]
        : undefined,
      address: address(first(node, "cac:PostalAddress")),
      contact: {
        name: textAt(node, "cac:Contact/cbc:Name"),
        phone: textAt(node, "cac:Contact/cbc:Telephone"),
        email: textAt(node, "cac:Contact/cbc:ElectronicMail"),
      },
    },
    scheme: attr(endpoint, "schemeID"),
    authority: registrationType === "PAS" ? null : agencyName,
    passportCountry: registrationType === "PAS" ? agencyName : null,
  };
}

function allowanceCharge(node: XNode, withTax: boolean) {
  const code = textAt(node, "cbc:AllowanceChargeReasonCode");
  return {
    isCharge: textAt(node, "cbc:ChargeIndicator") === "true",
    amount: amount(node, "cbc:Amount"),
    baseAmount: amount(node, "cbc:BaseAmount"),
    percent: num(textAt(node, "cbc:MultiplierFactorNumeric")) ?? undefined,
    reason: textAt(node, "cbc:AllowanceChargeReason"),
    reasonCode: code ? (ALLOWANCE_REASONS[code] ?? code) : undefined,
    taxCategory: withTax ? textAt(node, "cac:TaxCategory/cbc:ID") : undefined,
    taxRate: withTax ? (num(textAt(node, "cac:TaxCategory/cbc:Percent")) ?? undefined) : undefined,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Map one generated PINT AE document (Invoice or CreditNote) to a GETS request part. */
export function ublToGets(
  xml: string,
  documentCurrencyLines?: { taxAmount: number; lineTotal: number }[]
): GetsDocument {
  const doc = parseXml(xml);
  const root = doc.documentElement as unknown as XNode;
  const isCredit = root.localName === "CreditNote";
  const typeCode =
    textAt(root, isCredit ? "cbc:CreditNoteTypeCode" : "cbc:InvoiceTypeCode") ??
    (isCredit ? "381" : "380");
  const selected = TYPE_CODES[typeCode];
  if (!selected) {
    throw new GetsMappingError(`Document type ${typeCode} has no GETS selection for the UAE`);
  }
  const modifiers = [...selected.modifiers];
  const flags = textAt(root, "cbc:ProfileExecutionID") ?? "";
  if (/^[01]{8}$/.test(flags)) {
    [...flags].forEach((bit, i) => {
      if (bit === "1") modifiers.push(TRANSACTION_FLAG_MODIFIERS[i]);
    });
  }
  const lineTag = isCredit ? "cac:CreditNoteLine" : "cac:InvoiceLine";
  const qtyTag = isCredit ? "cbc:CreditedQuantity" : "cbc:InvoicedQuantity";
  const lines = all(root, lineTag);
  const categories = new Set(
    lines.map((l) => textAt(l, "cac:Item/cac:ClassifiedTaxCategory/cbc:ID"))
  );
  if (categories.has("AE") && !modifiers.includes("reverse_charge"))
    modifiers.push("reverse_charge");
  const documentType: GetsDocumentType = { base: selected.base, modifiers };

  const currency = textAt(root, "cbc:DocumentCurrencyCode") ?? "AED";
  const taxCurrency = textAt(root, "cbc:TaxCurrencyCode");
  const seller = party(first(root, "cac:AccountingSupplierParty/cac:Party"));
  const buyer = party(first(root, "cac:AccountingCustomerParty/cac:Party"));
  const preceding = first(root, "cac:BillingReference/cac:InvoiceDocumentReference");
  const reasonCode = textAt(root, "cac:DiscrepancyResponse/cbc:ResponseCode");

  const taxTotals = all(root, "cac:TaxTotal");
  const docTaxTotal =
    taxTotals.find((t) => attr(first(t, "cbc:TaxAmount"), "currencyID") === currency) ??
    taxTotals[0] ??
    null;
  const aedTaxTotal =
    taxCurrency && taxCurrency !== currency
      ? taxTotals.find((t) => attr(first(t, "cbc:TaxAmount"), "currencyID") === taxCurrency)
      : undefined;
  const rate = num(textAt(root, "cac:TaxExchangeRate/cbc:CalculationRate"));
  const aedTotalRef =
    currency !== "AED"
      ? children(root, "cac:AdditionalDocumentReference").find(
          (ref) => textAt(ref, "cbc:DocumentTypeCode") === "aedtotal-incl-vat"
        )
      : undefined;

  const documentLineAmount = (node: XNode | null, exactAmount?: number) => {
    const value = num(text(node));
    if (currency === "AED" || attr(node, "currencyID") !== "AED") return value;
    return exactAmount ?? (value !== null && rate && rate > 0 ? round2(value / rate) : null);
  };
  const lineItems = lines.map((l, index) => {
    const taxable = amount(l, "cbc:LineExtensionAmount") ?? 0;
    const taxRate = num(textAt(l, "cac:Item/cac:ClassifiedTaxCategory/cbc:Percent")) ?? 0;
    const taxAmount =
      documentLineAmount(
        first(l, "cac:ItemPriceExtension/cac:TaxTotal/cbc:TaxAmount"),
        documentCurrencyLines?.[index]?.taxAmount
      ) ?? round2((taxable * taxRate) / 100);
    const priceAmount = amount(l, "cac:Price/cbc:PriceAmount");
    const exemptionCode = textAt(
      l,
      "cac:Item/cac:ClassifiedTaxCategory/cbc:TaxExemptionReasonCode"
    );
    const nature = textAt(l, "cac:Item/cac:CommodityClassification/cbc:NatureCode");
    const classification = first(
      l,
      "cac:Item/cac:CommodityClassification/cbc:ItemClassificationCode"
    );
    const standard = first(l, "cac:Item/cac:StandardItemIdentification/cbc:ID");
    return {
      id: textAt(l, "cbc:ID"),
      name: textAt(l, "cac:Item/cbc:Name"),
      description: textAt(l, "cac:Item/cbc:Description"),
      quantity: num(textAt(l, qtyTag)) ?? undefined,
      unitCode: attr(first(l, qtyTag), "unitCode"),
      price: {
        amount: priceAmount,
        grossPrice: amount(l, "cac:Price/cac:AllowanceCharge/cbc:BaseAmount") ?? priceAmount,
        baseQuantity: num(textAt(l, "cac:Price/cbc:BaseQuantity")) ?? 1,
      },
      lineTaxableValue: taxable,
      taxCategory: textAt(l, "cac:Item/cac:ClassifiedTaxCategory/cbc:ID"),
      taxRate,
      taxAmount,
      lineTotal:
        documentLineAmount(
          first(l, "cac:ItemPriceExtension/cbc:Amount"),
          documentCurrencyLines?.[index]?.lineTotal
        ) ?? round2(taxable + taxAmount),
      taxExemptionReasonCode: exemptionCode ? EXEMPTION_REASONS[exemptionCode] : undefined,
      taxExemptionReason: textAt(l, "cac:Item/cac:ClassifiedTaxCategory/cbc:TaxExemptionReason"),
      standardItemCode: standard
        ? { id: text(standard), schemeId: attr(standard, "schemeID") }
        : undefined,
      commodityClassification: classification
        ? { code: text(classification), scheme: attr(classification, "listID") }
        : undefined,
      discountsOrCharges: all(l, "cac:AllowanceCharge").map((a) => allowanceCharge(a, false)),
      extensions: nature && RCM_TYPES[nature] ? { ae_rcmType: RCM_TYPES[nature] } : undefined,
    };
  });

  const deliveryAddress = first(root, "cac:Delivery/cac:DeliveryLocation/cac:Address");
  const payload = compact({
    header: {
      documentType,
      documentNumber: textAt(root, "cbc:ID"),
      uuid: textAt(root, "cbc:UUID"),
      issueDate: textAt(root, "cbc:IssueDate"),
      dueDate: textAt(root, "cbc:DueDate") ?? textAt(root, "cac:PaymentMeans/cbc:PaymentDueDate"),
      currency,
      taxCurrency: taxCurrency && taxCurrency !== currency ? taxCurrency : undefined,
      exchangeRate: rate && taxCurrency && taxCurrency !== currency ? { rate } : undefined,
      referenceId: preceding ? textAt(preceding, "cbc:ID") : undefined,
    },
    parties: {
      seller: seller.party,
      buyer: buyer.party,
      delivery: deliveryAddress ? { address: address(deliveryAddress) } : undefined,
    },
    lineItems,
    allowancesAndCharges: children(root, "cac:AllowanceCharge").map((a) =>
      allowanceCharge(a, true)
    ),
    payment: {
      paymentMeans: all(root, "cac:PaymentMeans").map((pm) => {
        const code = textAt(pm, "cbc:PaymentMeansCode") ?? "";
        return {
          paymentMeansCode: PAYMENT_MEANS[code] ?? code,
          creditTransferInfo: {
            payeeFinancialAccountId: textAt(pm, "cac:PayeeFinancialAccount/cbc:ID"),
          },
        };
      }),
    },
    taxTotals: docTaxTotal
      ? [
          {
            taxAmount: amount(docTaxTotal, "cbc:TaxAmount"),
            taxSubtotals: all(docTaxTotal, "cac:TaxSubtotal").map((st) => {
              const code = textAt(st, "cac:TaxCategory/cbc:TaxExemptionReasonCode");
              return {
                taxableAmount: amount(st, "cbc:TaxableAmount"),
                taxAmount: amount(st, "cbc:TaxAmount"),
                taxCategory: textAt(st, "cac:TaxCategory/cbc:ID"),
                percent: num(textAt(st, "cac:TaxCategory/cbc:Percent")) ?? 0,
                taxExemptionReasonCode: code ? EXEMPTION_REASONS[code] : undefined,
                taxExemptionReason: textAt(st, "cac:TaxCategory/cbc:TaxExemptionReason"),
              };
            }),
          },
        ]
      : undefined,
    totals: {
      totalLineTaxableAmount: amount(root, "cac:LegalMonetaryTotal/cbc:LineExtensionAmount"),
      totalAmountExcludingTax: amount(root, "cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount"),
      totalTaxAmount: docTaxTotal ? amount(docTaxTotal, "cbc:TaxAmount") : undefined,
      totalAmountIncludingTax: amount(root, "cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount"),
      totalAllowances: amount(root, "cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount"),
      totalCharges: amount(root, "cac:LegalMonetaryTotal/cbc:ChargeTotalAmount"),
      prepaidAmount: amount(root, "cac:LegalMonetaryTotal/cbc:PrepaidAmount"),
      roundingAmount: amount(root, "cac:LegalMonetaryTotal/cbc:PayableRoundingAmount"),
      amountDue: amount(root, "cac:LegalMonetaryTotal/cbc:PayableAmount"),
    },
    extensions: {
      peppol_seller_peppolIdScheme: seller.scheme,
      peppol_buyer_peppolIdScheme: buyer.scheme,
      ae_seller_authorityName: seller.authority,
      ae_buyer_authorityName: buyer.authority,
      ae_seller_passportIssuingCountry: seller.passportCountry,
      ae_buyer_passportCountry: buyer.passportCountry,
      ae_totalAmountIncludingTaxInAED: aedTotalRef
        ? amount(aedTotalRef, "cbc:DocumentDescription")
        : undefined,
      peppol_buyerAccountingReference: textAt(root, "cbc:BuyerReference"),
      peppol_precedingInvoiceIssueDate: preceding ? textAt(preceding, "cbc:IssueDate") : undefined,
      ae_creditNoteReasonCode: reasonCode
        ? (CREDIT_NOTE_REASONS[reasonCode] ?? reasonCode)
        : undefined,
      peppol_totalTaxAmountInTaxCurrency: aedTaxTotal
        ? amount(aedTaxTotal, "cbc:TaxAmount")
        : undefined,
    },
  });
  return { documentType, payload };
}

/**
 * The Unify XML request (COMPLYANCE_SUBMIT_FORMAT=xml): our PINT AE document inside a
 * UnifyRequest envelope, read by an XML mapping built in Complyance's Integration engine from a
 * sample (purpose "mapping"). The envelope takes no attributes; DTDs are refused.
 */
export function unifyXmlRequest(args: {
  environment: string;
  source: string;
  purpose: "invoicing" | "validate" | "mapping";
  documentType: GetsDocumentType;
  xml: string;
}): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = args.xml.replace(/^\s*<\?xml[^>]*\?>\s*/, "");
  const modifiers = args.documentType.modifiers.length
    ? `<modifiers>${args.documentType.modifiers.map((m) => `<item>${esc(m)}</item>`).join("")}</modifiers>`
    : "<modifiers/>";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<UnifyRequest>",
    "<country>AE</country>",
    `<environment>${esc(args.environment)}</environment>`,
    `<purpose>${args.purpose}</purpose>`,
    `<source>${esc(args.source)}</source>`,
    `<documentType><base>${args.documentType.base}</base>${modifiers}</documentType>`,
    `<payload>${body}</payload>`,
    "</UnifyRequest>",
  ].join("");
}
