/**
 * ZATCA (KSA) Phase 2 UBL 2.1 profile: standard (B2B, cleared) and
 * simplified (B2C, reported) tax invoices, credit notes (381) and debit
 * notes (383), with Arabic party/item names and the ICV / PIH chain
 * references. The signer (sign.ts) adds ext:UBLExtensions and the QR.
 */
import Decimal from "decimal.js";
import { el, opt, serializeXml, type XmlElement } from "../einvoice/xml";

export const ZATCA_PROFILE_ID = "reporting:1.0";
/** base64(sha256("0")) as a hex string — the PIH of the first invoice in a chain. */
export const ZATCA_INITIAL_PIH =
  "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";

export const ZATCA_TYPE_CODE = { invoice: "388", credit_note: "381", debit_note: "383" } as const;
/** InvoiceTypeCode/@name: transaction flags; position 1-2 = standard (01) / simplified (02). */
export const ZATCA_TYPE_NAME = { standard: "0100000", simplified: "0200000" } as const;

const NS = {
  invoice: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
};

export interface ZatcaAddress {
  street: string;
  buildingNumber: string;
  district: string;
  city: string;
  postalZone: string;
  country?: string;
}

export interface ZatcaInvoiceLine {
  name: string;
  nameAr?: string | null;
  quantity: number;
  unitPrice: number | string;
  /** 0.15 / 0 */
  vatRate: number;
  category: "S" | "Z" | "E" | "O";
  exemptionCode?: string | null;
  exemptionReason?: string | null;
}

export interface ZatcaInvoiceInput {
  profile: "standard" | "simplified";
  kind: keyof typeof ZATCA_TYPE_CODE;
  number: string;
  uuid: string;
  issueDate: string;
  issueTime: string;
  supplyDate?: string | null;
  currency?: string;
  icv: number;
  previousHash: string;
  billingReference?: string | null;
  /** Reason for a credit/debit note (KSA-10, PaymentMeans/InstructionNote). */
  noteReason?: string | null;
  seller: {
    nameAr: string;
    nameEn?: string | null;
    vatNumber: string;
    crn?: string | null;
    address: ZatcaAddress;
  };
  buyer?: {
    name: string;
    vatNumber?: string | null;
    address?: Partial<ZatcaAddress> | null;
  } | null;
  lines: ZatcaInvoiceLine[];
  paymentMeansCode?: string;
}

const d2 = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function zatcaTotals(input: ZatcaInvoiceInput) {
  const lines = input.lines.map((l) => {
    const ext = d2(new Decimal(l.quantity).times(l.unitPrice));
    const rate = l.category === "S" ? l.vatRate : 0;
    const vat = d2(ext.times(rate));
    return { ...l, ext, vat, rate };
  });
  const groups = new Map<
    string,
    { category: string; rate: number; taxable: Decimal; tax: Decimal; line: ZatcaInvoiceLine }
  >();
  for (const l of lines) {
    const key = `${l.category}:${l.rate}`;
    const g = groups.get(key) ?? {
      category: l.category,
      rate: l.rate,
      taxable: new Decimal(0),
      tax: new Decimal(0),
      line: l,
    };
    g.taxable = g.taxable.plus(l.ext);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.tax = d2(g.taxable.times(g.rate));
  const lineTotal = lines.reduce((s, l) => s.plus(l.ext), new Decimal(0));
  const vatTotal = [...groups.values()].reduce((s, g) => s.plus(g.tax), new Decimal(0));
  return {
    lines,
    groups: [...groups.values()],
    lineTotal,
    vatTotal,
    total: lineTotal.plus(vatTotal),
  };
}

function address(a: Partial<ZatcaAddress> | null | undefined) {
  if (!a) return null;
  return el(
    "cac:PostalAddress",
    null,
    opt("cbc:StreetName", a.street),
    opt("cbc:BuildingNumber", a.buildingNumber),
    opt("cbc:CitySubdivisionName", a.district),
    opt("cbc:CityName", a.city),
    opt("cbc:PostalZone", a.postalZone),
    el("cac:Country", null, el("cbc:IdentificationCode", null, a.country || "SA"))
  );
}

function taxCategory(
  tag: string,
  category: string,
  rate: number,
  code?: string | null,
  reason?: string | null
) {
  return el(
    tag,
    null,
    el("cbc:ID", null, category),
    el("cbc:Percent", null, (rate * 100).toFixed(2)),
    category !== "S" && opt("cbc:TaxExemptionReasonCode", code),
    category !== "S" && opt("cbc:TaxExemptionReason", reason),
    el("cac:TaxScheme", null, el("cbc:ID", null, "VAT"))
  );
}

/**
 * Build the invoice tree. `extensions` (ds:Signature wrapper) and `qr` are
 * supplied by the signer; without them this is the document that is hashed.
 */
export function buildZatcaInvoice(
  input: ZatcaInvoiceInput,
  parts: { extensions?: XmlElement | null; qr?: string | null } = {}
): XmlElement {
  const currency = input.currency ?? "SAR";
  const t = zatcaTotals(input);
  const amt = (name: string, v: Decimal) => el(name, { currencyID: currency }, v.toFixed(2));
  const isNote = input.kind !== "invoice";
  return el(
    "Invoice",
    { xmlns: NS.invoice, "xmlns:cac": NS.cac, "xmlns:cbc": NS.cbc, "xmlns:ext": NS.ext },
    parts.extensions ?? null,
    el("cbc:ProfileID", null, ZATCA_PROFILE_ID),
    el("cbc:ID", null, input.number),
    el("cbc:UUID", null, input.uuid),
    el("cbc:IssueDate", null, input.issueDate),
    el("cbc:IssueTime", null, input.issueTime),
    el(
      "cbc:InvoiceTypeCode",
      { name: ZATCA_TYPE_NAME[input.profile] },
      ZATCA_TYPE_CODE[input.kind]
    ),
    el("cbc:DocumentCurrencyCode", null, currency),
    el("cbc:TaxCurrencyCode", null, "SAR"),
    isNote &&
      input.billingReference &&
      el(
        "cac:BillingReference",
        null,
        el("cac:InvoiceDocumentReference", null, el("cbc:ID", null, input.billingReference))
      ),
    el(
      "cac:AdditionalDocumentReference",
      null,
      el("cbc:ID", null, "ICV"),
      el("cbc:UUID", null, String(input.icv))
    ),
    el(
      "cac:AdditionalDocumentReference",
      null,
      el("cbc:ID", null, "PIH"),
      el(
        "cac:Attachment",
        null,
        el("cbc:EmbeddedDocumentBinaryObject", { mimeCode: "text/plain" }, input.previousHash)
      )
    ),
    parts.qr &&
      el(
        "cac:AdditionalDocumentReference",
        null,
        el("cbc:ID", null, "QR"),
        el(
          "cac:Attachment",
          null,
          el("cbc:EmbeddedDocumentBinaryObject", { mimeCode: "text/plain" }, parts.qr)
        )
      ),
    el(
      "cac:Signature",
      null,
      el("cbc:ID", null, "urn:oasis:names:specification:ubl:signature:Invoice"),
      el("cbc:SignatureMethod", null, "urn:oasis:names:specification:ubl:dsig:enveloped:xades")
    ),
    el(
      "cac:AccountingSupplierParty",
      null,
      el(
        "cac:Party",
        null,
        input.seller.crn &&
          el("cac:PartyIdentification", null, el("cbc:ID", { schemeID: "CRN" }, input.seller.crn)),
        address(input.seller.address),
        el(
          "cac:PartyTaxScheme",
          null,
          el("cbc:CompanyID", null, input.seller.vatNumber),
          el("cac:TaxScheme", null, el("cbc:ID", null, "VAT"))
        ),
        el("cac:PartyLegalEntity", null, el("cbc:RegistrationName", null, input.seller.nameAr))
      )
    ),
    el(
      "cac:AccountingCustomerParty",
      null,
      input.buyer
        ? el(
            "cac:Party",
            null,
            address(input.buyer.address),
            input.buyer.vatNumber &&
              el(
                "cac:PartyTaxScheme",
                null,
                el("cbc:CompanyID", null, input.buyer.vatNumber),
                el("cac:TaxScheme", null, el("cbc:ID", null, "VAT"))
              ),
            el("cac:PartyLegalEntity", null, el("cbc:RegistrationName", null, input.buyer.name))
          )
        : el("cac:Party", null)
    ),
    input.supplyDate &&
      el("cac:Delivery", null, el("cbc:ActualDeliveryDate", null, input.supplyDate)),
    el(
      "cac:PaymentMeans",
      null,
      el("cbc:PaymentMeansCode", null, input.paymentMeansCode ?? "10"),
      isNote && opt("cbc:InstructionNote", input.noteReason)
    ),
    el("cac:TaxTotal", null, el("cbc:TaxAmount", { currencyID: "SAR" }, t.vatTotal.toFixed(2))),
    el(
      "cac:TaxTotal",
      null,
      amt("cbc:TaxAmount", t.vatTotal),
      t.groups.map((g) =>
        el(
          "cac:TaxSubtotal",
          null,
          amt("cbc:TaxableAmount", g.taxable),
          amt("cbc:TaxAmount", g.tax),
          taxCategory(
            "cac:TaxCategory",
            g.category,
            g.rate,
            g.line.exemptionCode,
            g.line.exemptionReason
          )
        )
      )
    ),
    el(
      "cac:LegalMonetaryTotal",
      null,
      amt("cbc:LineExtensionAmount", t.lineTotal),
      amt("cbc:TaxExclusiveAmount", t.lineTotal),
      amt("cbc:TaxInclusiveAmount", t.total),
      amt("cbc:AllowanceTotalAmount", new Decimal(0)),
      amt("cbc:PrepaidAmount", new Decimal(0)),
      amt("cbc:PayableAmount", t.total)
    ),
    t.lines.map((l, i) =>
      el(
        "cac:InvoiceLine",
        null,
        el("cbc:ID", null, String(i + 1)),
        el("cbc:InvoicedQuantity", { unitCode: "PCE" }, String(l.quantity)),
        amt("cbc:LineExtensionAmount", l.ext),
        el(
          "cac:TaxTotal",
          null,
          amt("cbc:TaxAmount", l.vat),
          amt("cbc:RoundingAmount", l.ext.plus(l.vat))
        ),
        el(
          "cac:Item",
          null,
          el("cbc:Name", null, l.nameAr ? `${l.nameAr} / ${l.name}` : l.name),
          taxCategory("cac:ClassifiedTaxCategory", l.category, l.rate)
        ),
        el("cac:Price", null, amt("cbc:PriceAmount", new Decimal(l.unitPrice)))
      )
    )
  );
}

export function zatcaInvoiceXml(
  input: ZatcaInvoiceInput,
  parts: { extensions?: XmlElement | null; qr?: string | null } = {}
): string {
  return serializeXml(buildZatcaInvoice(input, parts));
}
