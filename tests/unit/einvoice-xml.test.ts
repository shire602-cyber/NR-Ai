import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";

import {
  EINVOICE_DEFAULT_UNIT_CODE,
  EMIT_ENDPOINT_ID,
  PEPPOL_EAS_UAE_TRN,
} from "../../server/services/einvoice-constants";
import { generateEInvoiceXML } from "../../server/services/einvoice.service";

// parseTagValue:false keeps "1350.00" as text: the tests assert the exact serialised amounts.
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", preserveOrder: true, parseTagValue: false });

type Node = Record<string, any>;

/** The parsed children of the first element called `name` anywhere in the tree (document order). */
function childrenOf(tree: Node[], name: string): Node[] {
  for (const node of tree) {
    const key = Object.keys(node).find((k) => k !== ":@" && k !== "#text");
    if (!key) continue;
    if (key === name) return node[key] as Node[];
    const inner = Array.isArray(node[key]) ? childrenOf(node[key] as Node[], name) : null;
    if (inner) return inner;
  }
  return null as unknown as Node[];
}
const names = (nodes: Node[]) => nodes.map((n) => Object.keys(n).find((k) => k !== ":@" && k !== "#text")!).filter(Boolean);
const textOf = (nodes: Node[], name: string): string | undefined => {
  const hit = nodes.find((n) => n[name]);
  const inner = hit?.[name] as Node[] | undefined;
  return inner?.[0]?.["#text"] !== undefined ? String(inner[0]["#text"]) : undefined;
};
const root = (xml: string) => parser.parse(xml) as Node[];
const docRoot = (xml: string) => {
  const tree = root(xml);
  const node = tree.find((n) => Object.keys(n).some((k) => k !== ":@" && k !== "?xml"))!;
  const key = Object.keys(node).find((k) => k !== ":@" && k !== "?xml")!;
  return { key, children: node[key] as Node[], attrs: node[":@"] as Record<string, string> };
};

const company = {
  name: "Pearl Trading LLC",
  trnVatNumber: "100123456700003",
  businessAddress: "Office 12, Sheikh Zayed Road",
  addressStreet: "Office 12, Sheikh Zayed Road",
  addressCity: "Dubai",
  addressCountry: "AE",
  emirate: "dubai",
  contactEmail: "billing@pearl.example",
  contactPhone: "+97145550100",
} as any;

const invoice = (over: Record<string, unknown> = {}) =>
  ({
    id: "inv-1",
    companyId: "co-1",
    number: "INV-2026-001",
    customerName: "Acme LLC",
    customerTrn: "100765432100003",
    customerAddress: "Business Bay Tower 3",
    date: new Date("2026-06-01T00:00:00Z"),
    dueDate: new Date("2026-07-01T00:00:00Z"),
    paymentTerms: "net30",
    currency: "AED",
    exchangeRate: 1,
    subtotal: 1300,
    vatAmount: 50,
    total: 1350,
    invoiceType: "invoice",
    ...over,
  }) as any;

const lines = [
  { description: "Consulting", quantity: 2, unitPrice: 500, vatRate: 0.05, vatSupplyType: "standard_rated" },
  { description: "Export shipment", quantity: 1, unitPrice: 300, vatRate: 0, vatSupplyType: "zero_rated" },
] as any[];

const FIXED_UUID = "11111111-2222-4333-8444-555555555555";
const buyer = { address: "Business Bay Tower 3", city: "Dubai", country: "AE", buyerIsBusiness: true };
const bank = { iban: "AE070331234567890123456", accountName: "Pearl Trading LLC", bankName: "Emirates NBD" };

const creditNote = () =>
  invoice({
    number: "CN-2026-001",
    invoiceType: "credit_note",
    originalInvoiceId: "00000000-0000-4000-8000-000000000001",
    subtotal: -1300,
    vatAmount: -50,
    total: -1350,
  });
const creditLines = lines.map((l) => ({ ...l, quantity: -l.quantity }));

describe("constants", () => {
  it("the Peppol scheme for the UAE TRN is one constant and the endpoint feature flag defaults on", () => {
    expect(PEPPOL_EAS_UAE_TRN).toBe("0235");
    expect(EMIT_ENDPOINT_ID).toBe(true);
    expect(EINVOICE_DEFAULT_UNIT_CODE).toBe("C62");
  });
});

describe("invoice document structure", () => {
  const { xml } = generateEInvoiceXML(invoice(), lines, company, undefined, { uuid: FIXED_UUID, buyer, bank });
  const doc = docRoot(xml);

  it("is well-formed UTF-8 with the UBL Invoice-2 namespaces", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(doc.key).toBe("Invoice");
    expect(doc.attrs["@_xmlns"]).toBe("urn:oasis:names:specification:ubl:schema:xsd:Invoice-2");
    expect(doc.attrs["@_xmlns:cac"]).toBe("urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2");
    expect(doc.attrs["@_xmlns:cbc"]).toBe("urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2");
  });

  it("children follow the UBL 2.1 Invoice sequence", () => {
    expect(names(doc.children)).toEqual([
      "cbc:UBLVersionID",
      "cbc:CustomizationID",
      "cbc:ProfileID",
      "cbc:ID",
      "cbc:UUID",
      "cbc:IssueDate",
      "cbc:DueDate",
      "cbc:InvoiceTypeCode",
      "cbc:DocumentCurrencyCode",
      "cbc:TaxCurrencyCode",
      "cac:AccountingSupplierParty",
      "cac:AccountingCustomerParty",
      "cac:PaymentMeans",
      "cac:PaymentTerms",
      "cac:TaxTotal",
      "cac:LegalMonetaryTotal",
      "cac:InvoiceLine",
      "cac:InvoiceLine",
    ]);
    expect(textOf(doc.children, "cbc:InvoiceTypeCode")).toBe("380");
    expect(textOf(doc.children, "cbc:CustomizationID")).toBe("urn:peppol:pint:billing-1@ae-1");
    expect(textOf(doc.children, "cbc:UUID")).toBe(FIXED_UUID);
    expect(textOf(doc.children, "cbc:DueDate")).toBe("2026-07-01");
  });

  it("parties carry endpoint id, address, tax scheme, legal entity and contact in UBL order", () => {
    const seller = childrenOf(doc.children, "cac:Party")!;
    expect(names(seller)).toEqual([
      "cbc:EndpointID",
      "cac:PartyName",
      "cac:PostalAddress",
      "cac:PartyTaxScheme",
      "cac:PartyLegalEntity",
      "cac:Contact",
    ]);
    const endpoint = seller[0] as Node;
    expect(endpoint[":@"]["@_schemeID"]).toBe("0235");
    expect(endpoint["cbc:EndpointID"][0]["#text"]).toBe("100123456700003");

    const address = childrenOf(seller, "cac:PostalAddress")!;
    expect(names(address)).toEqual(["cbc:StreetName", "cbc:CityName", "cbc:CountrySubentity", "cac:Country"]);
    expect(textOf(address, "cbc:CityName")).toBe("Dubai");
    expect(textOf(address, "cbc:CountrySubentity")).toBe("DXB");
    expect(textOf(childrenOf(address, "cac:Country")!, "cbc:IdentificationCode")).toBe("AE");

    const tax = childrenOf(seller, "cac:PartyTaxScheme")!;
    expect(textOf(tax, "cbc:CompanyID")).toBe("100123456700003");
    expect(textOf(childrenOf(tax, "cac:TaxScheme")!, "cbc:ID")).toBe("VAT");
    expect(textOf(childrenOf(seller, "cac:PartyLegalEntity")!, "cbc:RegistrationName")).toBe("Pearl Trading LLC");
    expect(names(childrenOf(seller, "cac:Contact")!)).toEqual(["cbc:Name", "cbc:Telephone", "cbc:ElectronicMail"]);
  });

  it("the buyer has its own endpoint id and address", () => {
    const customer = childrenOf(childrenOf(doc.children, "cac:AccountingCustomerParty")!, "cac:Party")!;
    expect(textOf(customer, "cbc:EndpointID")).toBe("100765432100003");
    expect(textOf(childrenOf(customer, "cac:PostalAddress")!, "cbc:StreetName")).toBe("Business Bay Tower 3");
    expect(textOf(childrenOf(customer, "cac:PartyTaxScheme")!, "cbc:CompanyID")).toBe("100765432100003");
  });

  it("PaymentMeans code 30 with the IBAN, and PaymentTerms", () => {
    const means = childrenOf(doc.children, "cac:PaymentMeans")!;
    expect(textOf(means, "cbc:PaymentMeansCode")).toBe("30");
    expect(textOf(childrenOf(means, "cac:PayeeFinancialAccount")!, "cbc:ID")).toBe("AE070331234567890123456");
    expect(textOf(childrenOf(doc.children, "cac:PaymentTerms")!, "cbc:Note")).toMatch(/30/);
  });

  it("no PaymentMeans without bank details", () => {
    const { xml: plain } = generateEInvoiceXML(invoice(), lines, company, undefined, { uuid: FIXED_UUID });
    expect(names(docRoot(plain).children)).not.toContain("cac:PaymentMeans");
  });

  it("tax total, monetary total and lines: amounts are 2dp, unit codes default to C62", () => {
    const totals = childrenOf(doc.children, "cac:LegalMonetaryTotal")!;
    expect(names(totals)).toEqual([
      "cbc:LineExtensionAmount",
      "cbc:TaxExclusiveAmount",
      "cbc:TaxInclusiveAmount",
      "cbc:PayableAmount",
    ]);
    expect(textOf(totals, "cbc:PayableAmount")).toBe("1350.00");
    const taxTotal = childrenOf(doc.children, "cac:TaxTotal")!;
    expect(names(taxTotal)).toEqual(["cbc:TaxAmount", "cac:TaxSubtotal", "cac:TaxSubtotal"]);
    expect(textOf(taxTotal, "cbc:TaxAmount")).toBe("50.00");
    const line1 = childrenOf(doc.children, "cac:InvoiceLine")!;
    expect(names(line1)).toEqual(["cbc:ID", "cbc:InvoicedQuantity", "cbc:LineExtensionAmount", "cac:Item", "cac:Price"]);
    expect((line1[1] as Node)[":@"]["@_unitCode"]).toBe("C62");
    expect(textOf(line1, "cbc:LineExtensionAmount")).toBe("1000.00");
  });

  it("unit prices keep full precision while amounts stay 2dp", () => {
    const { xml: precise } = generateEInvoiceXML(
      invoice({ subtotal: 100, vatAmount: 5, total: 105 }),
      [{ description: "Widget", quantity: 3, unitPrice: 33.333333, vatRate: 0.05, vatSupplyType: "standard_rated" }] as any[],
      company,
      undefined,
      { uuid: FIXED_UUID }
    );
    expect(precise).toContain(">33.333333</cbc:PriceAmount>");
    expect(precise).toContain(">100.00</cbc:LineExtensionAmount>");
  });

  it("a line can carry its own unit code and item classification", () => {
    const { xml: custom } = generateEInvoiceXML(
      invoice({ subtotal: 100, vatAmount: 5, total: 105 }),
      [{ description: "Cable", quantity: 10, unitPrice: 10, vatRate: 0.05, vatSupplyType: "standard_rated", unitCode: "MTR", itemClassificationCode: "854449" }] as any[],
      company,
      undefined,
      { uuid: FIXED_UUID }
    );
    expect(custom).toContain('unitCode="MTR"');
    expect(custom).toContain('<cbc:ItemClassificationCode listID="HS">854449</cbc:ItemClassificationCode>');
  });

  it("emits the endpoint id only while the feature constant is on", () => {
    const { xml: off } = generateEInvoiceXML(invoice(), lines, company, undefined, { uuid: FIXED_UUID, emitEndpointId: false });
    expect(off).not.toContain("EndpointID");
  });

  it("adds the AED tax total for a foreign-currency invoice", () => {
    const { xml: usd } = generateEInvoiceXML(
      invoice({ currency: "USD", exchangeRate: 3.6725, subtotal: 1000, vatAmount: 50, total: 1050 }),
      lines,
      company,
      undefined,
      { uuid: FIXED_UUID }
    );
    expect(usd).toContain('<cbc:TaxAmount currencyID="AED">183.63</cbc:TaxAmount>');
    expect((usd.match(/<cac:TaxTotal>/g) ?? []).length).toBe(2);
  });
});

describe("credit note document", () => {
  const { xml } = generateEInvoiceXML(creditNote(), creditLines, company, undefined, {
    uuid: FIXED_UUID,
    buyer,
    original: { number: "INV-2026-001", issueDate: "2026-06-01" },
  });
  const doc = docRoot(xml);

  it("is a true CreditNote root in the CreditNote-2 namespace with type code 381", () => {
    expect(doc.key).toBe("CreditNote");
    expect(doc.attrs["@_xmlns"]).toBe("urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2");
    expect(textOf(doc.children, "cbc:CreditNoteTypeCode")).toBe("381");
    expect(xml).not.toContain("InvoiceTypeCode");
    expect(xml).not.toContain("<cac:InvoiceLine>");
    expect(xml).not.toContain("InvoicedQuantity");
  });

  it("follows the UBL CreditNote sequence and references the original invoice", () => {
    expect(names(doc.children).slice(0, 10)).toEqual([
      "cbc:UBLVersionID",
      "cbc:CustomizationID",
      "cbc:ProfileID",
      "cbc:ID",
      "cbc:UUID",
      "cbc:IssueDate",
      "cbc:CreditNoteTypeCode",
      "cbc:DocumentCurrencyCode",
      "cbc:TaxCurrencyCode",
      "cac:BillingReference",
    ]);
    const ref = childrenOf(childrenOf(doc.children, "cac:BillingReference")!, "cac:InvoiceDocumentReference")!;
    expect(textOf(ref, "cbc:ID")).toBe("INV-2026-001");
    expect(textOf(ref, "cbc:IssueDate")).toBe("2026-06-01");
    expect(names(doc.children).filter((n) => n === "cac:CreditNoteLine")).toHaveLength(2);
  });

  it("uses cbc:CreditedQuantity and positive amounts (the document type carries the sign)", () => {
    const line = childrenOf(doc.children, "cac:CreditNoteLine")!;
    expect(names(line)).toEqual(["cbc:ID", "cbc:CreditedQuantity", "cbc:LineExtensionAmount", "cac:Item", "cac:Price"]);
    expect(textOf(line, "cbc:CreditedQuantity")).toBe("2");
    expect(textOf(line, "cbc:LineExtensionAmount")).toBe("1000.00");
    expect(textOf(childrenOf(doc.children, "cac:LegalMonetaryTotal")!, "cbc:PayableAmount")).toBe("1350.00");
    expect(textOf(childrenOf(doc.children, "cac:TaxTotal")!, "cbc:TaxAmount")).toBe("50.00");
  });

  it("the old form (Invoice root with type 381) is one option away", () => {
    const { xml: legacy } = generateEInvoiceXML(creditNote(), creditLines, company, undefined, {
      uuid: FIXED_UUID,
      creditNoteSyntax: "invoice-381",
      original: { number: "INV-2026-001" },
    });
    const legacyDoc = docRoot(legacy);
    expect(legacyDoc.key).toBe("Invoice");
    expect(textOf(legacyDoc.children, "cbc:InvoiceTypeCode")).toBe("381");
    expect(legacy).toContain("<cac:BillingReference>");
  });
});

describe("escaping and UTF-8", () => {
  const nasty = `A & B <Co> "quoted" 'single'`;
  const arabic = "شركة النور للتجارة ذ.م.م";
  const { xml } = generateEInvoiceXML(
    invoice({ customerName: nasty }),
    [{ description: `${arabic} \u0007control`, quantity: 1, unitPrice: 1300, vatRate: 0.05, vatSupplyType: "standard_rated" }] as any[],
    { ...company, name: arabic },
    undefined,
    { uuid: FIXED_UUID }
  );

  it("special characters are escaped and parse back unchanged", () => {
    expect(xml).toContain("A &amp; B &lt;Co&gt; &quot;quoted&quot; &apos;single&apos;");
    const doc = docRoot(xml);
    const cust = childrenOf(childrenOf(doc.children, "cac:AccountingCustomerParty")!, "cac:Party")!;
    expect(textOf(childrenOf(cust, "cac:PartyName")!, "cbc:Name")).toBe(nasty);
  });

  it("Arabic survives a UTF-8 round trip and control characters are stripped", () => {
    expect(Buffer.from(xml, "utf8").toString("utf8")).toBe(xml);
    expect(xml).toContain(arabic);
    expect(xml).not.toContain("\u0007");
    const doc = docRoot(xml);
    const seller = childrenOf(childrenOf(doc.children, "cac:AccountingSupplierParty")!, "cac:Party")!;
    expect(textOf(childrenOf(seller, "cac:PartyName")!, "cbc:Name")).toBe(arabic);
  });
});

describe("golden files", () => {
  const dir = path.join(__dirname, "..", "fixtures", "einvoice");
  const check = (file: string, xml: string) => {
    const target = path.join(dir, file);
    if (process.env.UPDATE_GOLDEN === "1" || !existsSync(target)) writeFileSync(target, xml, "utf8");
    expect(xml).toBe(readFileSync(target, "utf8"));
  };

  it("invoice", () => {
    const { xml } = generateEInvoiceXML(invoice(), lines, company, undefined, { uuid: FIXED_UUID, buyer, bank });
    check("invoice.golden.xml", xml);
  });

  it("credit note", () => {
    const { xml } = generateEInvoiceXML(creditNote(), creditLines, company, undefined, {
      uuid: FIXED_UUID,
      buyer,
      original: { number: "INV-2026-001", issueDate: "2026-06-01" },
    });
    check("credit-note.golden.xml", xml);
  });
});
