import { describe, expect, it } from "vitest";

import {
  generateEInvoiceXML,
  validateForEInvoicing,
  vatCategoryFor,
} from "../../server/services/einvoice.service";
import { fixtureCompany } from "../fixtures/pint-ae/fixtures";

// R07-04: a PINT AE-ready company (address, city, emirate, trade licence, Peppol id).
const company = { ...fixtureCompany, name: "Pearl Trading LLC", legalName: null } as any;

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    companyId: "co-1",
    number: "INV-2026-001",
    customerName: "Acme LLC",
    customerTrn: "100765432100003",
    date: new Date("2026-06-01"),
    dueDate: new Date("2026-07-01"),
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
    // R07-05: reverse charge is its own category (classifySupply), never Z.
    expect(vatCategoryFor({ vatSupplyType: "reverse_charge", vatRate: 0 } as any)).toBe("AE");
    expect(vatCategoryFor({ vatSupplyType: "standard_rated", vatRate: 0.05 } as any, true)).toBe(
      "AE"
    );
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

describe("PINT AE profile + document type", () => {
  it("uses the PINT-AE customization id and type 380 for an invoice", () => {
    const { xml } = generateEInvoiceXML(makeInvoice(), lines, company);
    expect(xml).toContain("urn:peppol:pint:billing-1@ae-1");
    expect(xml).toContain("<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>");
    expect(xml).not.toContain("<cac:BillingReference>");
  });

  it("adds the AED tax total + TaxCurrencyCode for a foreign-currency invoice", () => {
    // USD invoice, 1000 net + 50 VAT, booked at 3.67 AED/USD.
    const { xml } = generateEInvoiceXML(
      makeInvoice({
        currency: "USD",
        exchangeRate: 3.67,
        subtotal: 1000,
        vatAmount: 50,
        total: 1050,
      }),
      lines,
      company
    );
    expect(xml).toContain("<cbc:TaxCurrencyCode>AED</cbc:TaxCurrencyCode>");
    // 50 USD VAT * 3.67 = 183.50 AED
    expect(xml).toContain('<cbc:TaxAmount currencyID="AED">183.50</cbc:TaxAmount>');
  });

  it("does not add a second tax total for an AED invoice", () => {
    const { xml } = generateEInvoiceXML(makeInvoice({ currency: "AED" }), lines, company);
    // Document-level TaxTotal only (lines carry their own BTAE-08 TaxTotal).
    const taxTotals = (xml.match(/\n {2}<cac:TaxTotal>/g) || []).length;
    expect(taxTotals).toBe(1); // foreign invoices get a second AED tax total
  });

  it("emits a UBL CreditNote (type 381) with a billing reference for a credit note", () => {
    const cn = makeInvoice({
      invoiceType: "credit_note",
      originalInvoiceId: "inv-original-1",
      subtotal: -1300,
      vatAmount: -50,
      total: -1350,
    });
    const { xml } = generateEInvoiceXML(cn, lines, company, undefined, {
      originalInvoice: { number: "INV-2026-0001", date: "2026-01-01" },
    });
    expect(xml).toContain("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>");
    expect(xml).toContain("<cac:BillingReference>");
    expect(xml).toContain("INV-2026-0001");
    expect(xml).not.toContain("inv-original-1");
  });
});

describe("e-invoicing validation gate", () => {
  it("passes a consistent invoice", () => {
    expect(validateForEInvoicing(makeInvoice(), lines, company)).toEqual([]);
  });

  it("requires a valid supplier TRN (15 digits, 1...03)", () => {
    const issues = validateForEInvoicing(makeInvoice(), lines, { ...company, trnVatNumber: null });
    expect(issues.some((i) => i.field === "company.trnVatNumber")).toBe(true);
    const badFormat = validateForEInvoicing(makeInvoice(), lines, {
      ...company,
      trnVatNumber: "12345",
    });
    expect(badFormat.some((i) => i.message.includes("15 digits"))).toBe(true);
    const badShape = validateForEInvoicing(makeInvoice(), lines, {
      ...company,
      trnVatNumber: "200123456700001",
    });
    expect(badShape.some((i) => i.message.includes("ibr-132-ae"))).toBe(true);
  });

  it("rejects buyer TRNs with the wrong format; an absent TRN needs a recorded buyer endpoint", () => {
    expect(
      validateForEInvoicing(makeInvoice({ customerTrn: "ABC" }), lines, company).some(
        (i) => i.field === "invoice.customerTrn"
      )
    ).toBe(true);
    // No TRN and no endpoint: the buyer EndpointID (IBT-049) cannot be built, so the data check
    // names the fix instead of letting the document fail PINT-EndpointID later.
    expect(validateForEInvoicing(makeInvoice({ customerTrn: null }), lines, company)).toEqual([
      expect.objectContaining({
        field: "customer.endpointId",
        code: "EINVOICE_BUYER_ENDPOINT_MISSING",
      }),
    ]);
    // A recorded Peppol endpoint (e.g. a foreign buyer) is enough without a TRN.
    expect(
      validateForEInvoicing(makeInvoice({ customerTrn: null }), lines, company, {
        customer: {
          endpointId: "DE123456789",
          endpointScheme: "9930",
          address: "Hauptstrasse 1",
          city: "Berlin",
          country: "DE",
        },
      })
    ).toEqual([]);
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

  it("requires a document currency", () => {
    const issues = validateForEInvoicing(makeInvoice({ currency: null }), lines, company);
    expect(issues.some((i) => i.field === "invoice.currency")).toBe(true);
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
