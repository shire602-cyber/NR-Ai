import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { generateEInvoiceXML, validateForEInvoicing } from "../../server/services/einvoice.service";

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

// D1-7: 1,000 item, 10% line discount (-100), 50 document discount, 100 shipping -> subtotal 950, VAT 47.50, total 997.50.
const invoice = {
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
  subtotal: 950,
  vatAmount: 47.5,
  total: 997.5,
  status: "sent",
  invoiceType: "invoice",
} as any;

const line = (over: Record<string, unknown>) =>
  ({ description: "x", quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "standard_rated", lineKind: "item", ...over }) as any;

const lines = [
  line({ description: "Consulting", unitPrice: 1000 }),
  line({ description: "Discount: Consulting", unitPrice: -100, lineKind: "discount" }),
  line({ description: "Discount", unitPrice: -50, lineKind: "discount" }),
  line({ description: "Delivery", unitPrice: 100, lineKind: "shipping" }),
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false });
const doc = (xml: string) => parser.parse(xml).Invoice;

describe("e-invoice with discounts and advances (Phase 8 D1)", () => {
  it("sends derived negative lines as one document-level allowance per tax category", () => {
    const { xml } = generateEInvoiceXML(invoice, lines, company, undefined, { uuid: "u-1" });
    const d = doc(xml);
    const allowance = d["cac:AllowanceCharge"];
    expect(allowance["cbc:ChargeIndicator"]).toBe("false");
    expect(allowance["cbc:AllowanceChargeReason"]).toBe("Discount");
    expect(allowance["cbc:Amount"]["#text"]).toBe("150.00");
    expect(allowance["cac:TaxCategory"]["cbc:ID"]).toBe("S");
    expect(allowance["cac:TaxCategory"]["cbc:Percent"]).toBe("5.00");
  });

  it("keeps only the gross item and shipping lines as invoice lines", () => {
    const { xml } = generateEInvoiceXML(invoice, lines, company, undefined, { uuid: "u-1" });
    const invLines = [].concat(doc(xml)["cac:InvoiceLine"]);
    expect(invLines).toHaveLength(2);
    expect(invLines.map((l: any) => l["cac:Item"]["cbc:Name"])).toEqual(["Consulting", "Delivery"]);
    expect(invLines.map((l: any) => l["cbc:ID"])).toEqual(["1", "2"]);
  });

  it("states line extension, allowance, tax-exclusive and payable totals that reconcile", () => {
    const { xml } = generateEInvoiceXML(invoice, lines, company, undefined, { uuid: "u-1" });
    const m = doc(xml)["cac:LegalMonetaryTotal"];
    expect(m["cbc:LineExtensionAmount"]["#text"]).toBe("1100.00");
    expect(m["cbc:AllowanceTotalAmount"]["#text"]).toBe("150.00");
    expect(m["cbc:TaxExclusiveAmount"]["#text"]).toBe("950.00");
    expect(m["cbc:TaxInclusiveAmount"]["#text"]).toBe("997.50");
    expect(m["cbc:PayableAmount"]["#text"]).toBe("997.50");
    const tax = doc(xml)["cac:TaxTotal"];
    expect(tax["cbc:TaxAmount"]["#text"]).toBe("47.50");
    expect(tax["cac:TaxSubtotal"]["cbc:TaxableAmount"]["#text"]).toBe("950.00");
  });

  it("an advance deduction is its own allowance reason", () => {
    const adv = {
      ...invoice,
      subtotal: 2000,
      vatAmount: 100,
      total: 2100,
    };
    const l = [line({ description: "Project", unitPrice: 3000 }), line({ description: "Less advance ADV-1 (INV-1)", unitPrice: -1000, lineKind: "advance" })];
    const { xml } = generateEInvoiceXML(adv, l, company, undefined, { uuid: "u-2" });
    const a = doc(xml)["cac:AllowanceCharge"];
    expect(a["cbc:AllowanceChargeReason"]).toBe("Advance payment deducted");
    expect(a["cbc:Amount"]["#text"]).toBe("1000.00");
  });

  it("validation exempts derived lines from the unit-price check but still checks totals", () => {
    const issues = validateForEInvoicing(invoice, lines, company);
    expect(issues.filter((i) => i.code === "LINE_UNIT_PRICE_INVALID")).toHaveLength(0);
    expect(issues.filter((i) => i.code === "SUBTOTAL_MISMATCH")).toHaveLength(0);
    // a plain item with a negative price is still invalid
    const bad = validateForEInvoicing(invoice, [line({ unitPrice: -5 })], company);
    expect(bad.some((i) => i.code === "LINE_UNIT_PRICE_INVALID")).toBe(true);
  });
});
