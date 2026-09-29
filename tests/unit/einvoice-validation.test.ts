import { describe, expect, it } from "vitest";
import { validateForEInvoicing } from "../../server/services/einvoice.service";

const company = {
  name: "Pearl Trading LLC",
  trnVatNumber: "100123456700003",
  addressStreet: "Office 12, Sheikh Zayed Road",
  addressCity: "Dubai",
  emirate: "dubai",
} as any;

const invoice = (over: Record<string, unknown> = {}) =>
  ({
    number: "INV-1",
    customerName: "Acme LLC",
    customerTrn: "100765432100003",
    customerAddress: "Business Bay",
    date: new Date("2026-06-01"),
    currency: "AED",
    exchangeRate: 1,
    invoiceType: "invoice",
    subtotal: 1300,
    vatAmount: 50,
    total: 1350,
    ...over,
  }) as any;

const lines = [
  { description: "Consulting", quantity: 2, unitPrice: 500, vatRate: 0.05, vatSupplyType: "standard_rated" },
  { description: "Export", quantity: 1, unitPrice: 300, vatRate: 0, vatSupplyType: "zero_rated" },
] as any[];

const buyer = { city: "Dubai", address: "Business Bay", buyerIsBusiness: true };
const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

describe("structured e-invoice issues", () => {
  it("a consistent B2B invoice has none", () => {
    expect(validateForEInvoicing(invoice(), lines, company, { buyer })).toEqual([]);
  });

  it("every issue says which field, what is wrong in English and Arabic, and where", () => {
    const issues = validateForEInvoicing(invoice(), [{ ...lines[0], description: "" }], { ...company, trnVatNumber: null });
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) {
      expect(i.code).toMatch(/^[A-Z_]+$/);
      expect(i.field).toBeTruthy();
      expect(i.message.length).toBeGreaterThan(5);
      expect(i.messageAr).toMatch(/[؀-ۿ]/);
      expect(["seller", "buyer", "invoice", "line", "credit_note"]).toContain(i.entity);
    }
    const lineIssue = issues.find((i) => i.code === "LINE_DESCRIPTION_MISSING")!;
    expect(lineIssue.entity).toBe("line");
    expect(lineIssue.lineIndex).toBe(0);
    expect(lineIssue.field).toBe("lines[0].description");
    expect(issues.find((i) => i.code === "SELLER_TRN_MISSING")?.entity).toBe("seller");
  });

  it("seller TRN missing / not 15 digits", () => {
    expect(codes(validateForEInvoicing(invoice(), lines, { ...company, trnVatNumber: "" }, { buyer }))).toContain("SELLER_TRN_MISSING");
    expect(codes(validateForEInvoicing(invoice(), lines, { ...company, trnVatNumber: "12345" }, { buyer }))).toContain("SELLER_TRN_INVALID");
  });

  it("buyer TRN invalid; missing only when the buyer is a business on a taxable supply", () => {
    expect(codes(validateForEInvoicing(invoice({ customerTrn: "ABC" }), lines, company, { buyer }))).toContain("BUYER_TRN_INVALID");
    expect(codes(validateForEInvoicing(invoice({ customerTrn: null }), lines, company, { buyer }))).toContain("BUYER_TRN_MISSING");
    // a consumer (not flagged as a business) needs no TRN
    expect(validateForEInvoicing(invoice({ customerTrn: null }), lines, company)).toEqual([]);
    // a business buying only zero-rated goods: the taxable-supply rule does not apply
    expect(codes(validateForEInvoicing(invoice({ customerTrn: null, subtotal: 300, vatAmount: 0, total: 300 }), [lines[1]], company, { buyer }))).not.toContain("BUYER_TRN_MISSING");
  });

  it("missing seller address parts (street, city, emirate)", () => {
    const issues = validateForEInvoicing(invoice(), lines, { ...company, addressStreet: null, addressCity: null, emirate: null }, { buyer });
    expect(codes(issues)).toEqual(expect.arrayContaining(["SELLER_STREET_MISSING", "SELLER_CITY_MISSING", "SELLER_EMIRATE_MISSING"]));
    // the legacy single-line business address stands in for the street
    expect(codes(validateForEInvoicing(invoice(), lines, { ...company, addressStreet: null, businessAddress: "Dubai" }, { buyer }))).not.toContain("SELLER_STREET_MISSING");
  });

  it("missing buyer address parts for a business buyer", () => {
    const issues = validateForEInvoicing(invoice({ customerAddress: null }), lines, company, { buyer: { buyerIsBusiness: true } });
    expect(codes(issues)).toEqual(expect.arrayContaining(["BUYER_STREET_MISSING", "BUYER_CITY_MISSING"]));
  });

  it("currency, line description, quantity and unit price", () => {
    expect(codes(validateForEInvoicing(invoice({ currency: null }), lines, company, { buyer }))).toContain("CURRENCY_MISSING");
    const bad = validateForEInvoicing(
      invoice(),
      [
        { description: "", quantity: 1, unitPrice: 10, vatRate: 0.05, vatSupplyType: "standard_rated" },
        { description: "x", quantity: 0, unitPrice: 10, vatRate: 0.05, vatSupplyType: "standard_rated" },
        { description: "y", quantity: 1, unitPrice: undefined, vatRate: 0.05, vatSupplyType: "standard_rated" },
      ] as any[],
      company,
      { buyer }
    );
    expect(codes(bad)).toEqual(expect.arrayContaining(["LINE_DESCRIPTION_MISSING", "LINE_QUANTITY_INVALID", "LINE_UNIT_PRICE_INVALID"]));
    expect(bad.find((i) => i.code === "LINE_QUANTITY_INVALID")?.lineIndex).toBe(1);
    expect(bad.find((i) => i.code === "LINE_UNIT_PRICE_INVALID")?.lineIndex).toBe(2);
  });

  it("totals that do not reconcile", () => {
    expect(codes(validateForEInvoicing(invoice({ subtotal: 9999, total: 10049 }), lines, company, { buyer }))).toContain("SUBTOTAL_MISMATCH");
    expect(codes(validateForEInvoicing(invoice({ vatAmount: 500, total: 1800 }), lines, company, { buyer }))).toContain("VAT_TOTAL_MISMATCH");
    expect(codes(validateForEInvoicing(invoice({ total: 2000 }), lines, company, { buyer }))).toContain("TOTAL_MISMATCH");
  });

  it("VAT per category that drifts from the header VAT through rounding", () => {
    // 3 lines of 0.1 x 3 at 5%: each category rounds to 0.02 (0.015), header VAT says 0.05
    const many = Array.from({ length: 3 }, () => ({ description: "p", quantity: 1, unitPrice: 0.3, vatRate: 0.05, vatSupplyType: "standard_rated" })) as any[];
    const issues = validateForEInvoicing(invoice({ subtotal: 0.9, vatAmount: 0.05, total: 0.95 }), many, company, { buyer });
    expect(codes(issues)).not.toContain("SUBTOTAL_MISMATCH");
    // a single category is one subtotal, so this stays consistent; the rule only fires across categories
    expect(codes(issues)).not.toContain("TAX_SUBTOTAL_MISMATCH");
    const mixed = [
      { description: "a", quantity: 1, unitPrice: 10.1, vatRate: 0.05, vatSupplyType: "standard_rated" },
      { description: "b", quantity: 1, unitPrice: 10.1, vatRate: 0.1, vatSupplyType: "standard_rated" },
    ] as any[];
    // 10.1@5% = 0.505 -> 0.51 ; 10.1@10% = 1.01 ; the tax subtotals add up to 1.52 but the header says 1.55
    const inconsistent = validateForEInvoicing(invoice({ subtotal: 20.2, vatAmount: 1.55, total: 21.75 }), mixed, company, { buyer });
    expect(codes(inconsistent)).toContain("TAX_SUBTOTAL_MISMATCH");
  });

  it("VAT category vs rate inconsistencies", () => {
    const wrong = [
      { description: "zero but taxed", quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "zero_rated" },
      { description: "exempt but taxed", quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "exempt" },
      { description: "standard at 0", quantity: 1, unitPrice: 100, vatRate: 0, vatSupplyType: "standard_rated" },
      { description: "standard at 7", quantity: 1, unitPrice: 100, vatRate: 0.07, vatSupplyType: "standard_rated" },
    ] as any[];
    const issues = validateForEInvoicing(invoice({ subtotal: 400, vatAmount: 7, total: 407 }), wrong, company, { buyer });
    const rateIssues = issues.filter((i) => i.code === "VAT_CATEGORY_RATE_MISMATCH");
    expect(rateIssues.map((i) => i.lineIndex)).toEqual([0, 1, 3]);
    expect(rateIssues[0].entity).toBe("line");
  });

  it("credit note without an original invoice reference", () => {
    const cn = invoice({ invoiceType: "credit_note", originalInvoiceId: null, subtotal: -1300, vatAmount: -50, total: -1350 });
    const negLines = lines.map((l) => ({ ...l, quantity: -l.quantity }));
    const issues = validateForEInvoicing(cn, negLines, company, { buyer });
    expect(codes(issues)).toContain("CREDIT_NOTE_ORIGINAL_MISSING");
    expect(issues.find((i) => i.code === "CREDIT_NOTE_ORIGINAL_MISSING")?.entity).toBe("credit_note");
    // negative line quantities are how credit notes are stored: not an error
    expect(codes(issues)).not.toContain("LINE_QUANTITY_INVALID");
    const ok = validateForEInvoicing({ ...cn, originalInvoiceId: "00000000-0000-4000-8000-000000000001" }, negLines, company, { buyer, original: { number: "INV-1" } });
    expect(ok).toEqual([]);
  });

  it("foreign-currency invoice without a usable rate cannot state the AED tax total", () => {
    const usd = invoice({ currency: "USD", exchangeRate: 0 });
    expect(codes(validateForEInvoicing(usd, lines, company, { buyer }))).toContain("FX_RATE_MISSING");
    expect(codes(validateForEInvoicing(invoice({ currency: "USD", exchangeRate: 3.6725 }), lines, company, { buyer }))).not.toContain("FX_RATE_MISSING");
  });
});
