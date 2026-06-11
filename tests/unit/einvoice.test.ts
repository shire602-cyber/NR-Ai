import { describe, expect, it } from "vitest";

import {
  generateEInvoiceXML,
  validateForEInvoicing,
  vatCategoryFor,
} from "../../server/services/einvoice.service";

const company = {
  name: "Pearl Trading LLC",
  trnVatNumber: "100123456700003",
  businessAddress: "Dubai",
} as any;

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    companyId: "co-1",
    number: "INV-2026-001",
    customerName: "Acme LLC",
    customerTrn: "100765432100003",
    date: new Date("2026-06-01"),
    currency: "AED",
    subtotal: 1300,
    vatAmount: 50,
    total: 1350,
    ...overrides,
  } as any;
}

const lines = [
  {
    description: "Consulting",
    quantity: 2,
    unitPrice: 500,
    vatRate: 0.05,
    vatSupplyType: "standard_rated",
  },
  {
    description: "Export shipment",
    quantity: 1,
    unitPrice: 300,
    vatRate: 0,
    vatSupplyType: "zero_rated",
  },
] as any[];

describe("VAT category mapping", () => {
  it("maps supply types to UNCL5305 codes", () => {
    expect(vatCategoryFor({ vatSupplyType: "standard_rated", vatRate: 0.05 } as any)).toBe("S");
    expect(vatCategoryFor({ vatSupplyType: "zero_rated", vatRate: 0 } as any)).toBe("Z");
    expect(vatCategoryFor({ vatSupplyType: "exempt", vatRate: 0 } as any)).toBe("E");
    expect(vatCategoryFor({ vatSupplyType: "out_of_scope", vatRate: 0 } as any)).toBe("O");
    // Untagged 0% lines fall back to zero-rated, not standard.
    expect(vatCategoryFor({ vatSupplyType: null, vatRate: 0 } as any)).toBe("Z");
  });
});

describe("PINT AE XML generation", () => {
  it("declares per-line categories and grouped tax subtotals", () => {
    const { xml, uuid, hash } = generateEInvoiceXML(makeInvoice(), lines, company, {
      name: "Acme LLC",
      trn: "100765432100003",
    });
    expect(uuid).toMatch(/[0-9a-f-]{36}/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Standard line keeps S at 5%, zero-rated line is Z at 0% — the old
    // serializer hardcoded S everywhere, mis-declaring exports.
    expect(xml).toContain("<cbc:ID>S</cbc:ID>");
    expect(xml).toContain("<cbc:ID>Z</cbc:ID>");
    expect(xml).toContain("100123456700003");
    expect(xml).toContain("Pearl Trading LLC");
  });
});

describe("e-invoicing validation gate", () => {
  it("passes a consistent invoice", () => {
    expect(validateForEInvoicing(makeInvoice(), lines, company)).toEqual([]);
  });

  it("requires a valid supplier TRN", () => {
    const issues = validateForEInvoicing(makeInvoice(), lines, { ...company, trnVatNumber: null });
    expect(issues.some((i) => i.field === "company.trnVatNumber")).toBe(true);
    const badFormat = validateForEInvoicing(makeInvoice(), lines, {
      ...company,
      trnVatNumber: "12345",
    });
    expect(badFormat.some((i) => i.message.includes("15 digits"))).toBe(true);
  });

  it("rejects buyer TRNs with the wrong format but allows absent ones", () => {
    expect(
      validateForEInvoicing(makeInvoice({ customerTrn: "ABC" }), lines, company).some(
        (i) => i.field === "invoice.customerTrn"
      )
    ).toBe(true);
    expect(validateForEInvoicing(makeInvoice({ customerTrn: null }), lines, company)).toEqual([]);
  });

  it("catches totals that disagree with the lines", () => {
    const issues = validateForEInvoicing(makeInvoice({ subtotal: 9999 }), lines, company);
    expect(issues.some((i) => i.field === "invoice.subtotal")).toBe(true);
    const vatIssues = validateForEInvoicing(
      makeInvoice({ vatAmount: 500, total: 1800 }),
      lines,
      company
    );
    expect(vatIssues.some((i) => i.field === "invoice.vatAmount")).toBe(true);
  });

  it("catches subtotal+VAT vs total drift and empty invoices", () => {
    expect(
      validateForEInvoicing(makeInvoice({ total: 2000 }), lines, company).some(
        (i) => i.field === "invoice.total"
      )
    ).toBe(true);
    expect(
      validateForEInvoicing(makeInvoice({ subtotal: 0, vatAmount: 0, total: 0 }), [], company).some(
        (i) => i.field === "lines"
      )
    ).toBe(true);
  });
});
