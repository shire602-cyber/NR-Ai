import { describe, expect, it } from "vitest";

import { formatUnitPrice, formatUnitPriceCurrency } from "../../shared/format-unit-price";
import { calculateDocumentTotals } from "../../server/services/document-totals.service";
import { generateEInvoiceXML } from "../../server/services/einvoice.service";
import {
  invoiceLines,
  quoteLines,
  creditNoteLines,
  purchaseOrderLines,
  serviceInvoiceLines,
  products,
  inventoryMovements,
} from "../../shared/schema";

describe("formatUnitPrice", () => {
  it("keeps full stored precision", () => {
    expect(formatUnitPrice(33.333333)).toBe("33.333333");
    expect(formatUnitPrice(0.000001)).toBe("0.000001");
  });

  it("pads to at least two decimals", () => {
    expect(formatUnitPrice(33.3)).toBe("33.30");
    expect(formatUnitPrice(100)).toBe("100.00");
  });

  it("accepts numeric strings and guards non-finite input", () => {
    expect(formatUnitPrice("12.5")).toBe("12.50");
    expect(formatUnitPrice(Number.NaN)).toBe("0.00");
  });

  it("supports thousands grouping for display", () => {
    expect(formatUnitPrice(1234567.5, { grouping: true })).toBe("1,234,567.50");
    expect(formatUnitPrice(1234567.5)).toBe("1234567.50");
  });

  it("formats with a currency prefix", () => {
    expect(formatUnitPriceCurrency(33.333333, "AED")).toBe("AED 33.333333");
    expect(formatUnitPriceCurrency(100, "AED")).toBe("AED 100.00");
  });
});

describe("line totals with 6dp unit prices", () => {
  it("3 x 33.333333 totals 100.00 and does not mutate the input price", () => {
    const lines = [{ quantity: 3, unitPrice: 33.333333, vatRate: 0.05 }];
    const totals = calculateDocumentTotals(lines);
    expect(totals.subtotal).toBe(100);
    expect(totals.vatAmount).toBe(5);
    expect(totals.total).toBe(105);
    expect(lines[0].unitPrice).toBe(33.333333);
  });
});

describe("column types", () => {
  it("unit price columns round-trip 6dp without rounding to 2dp", () => {
    for (const col of [
      invoiceLines.unitPrice,
      quoteLines.unitPrice,
      creditNoteLines.unitPrice,
      purchaseOrderLines.unitPrice,
      serviceInvoiceLines.unitPrice,
      products.unitPrice,
      inventoryMovements.unitCost,
    ]) {
      expect(col.getSQLType()).toBe("numeric(19,6)");
      expect(col.mapFromDriverValue("33.333333")).toBe(33.333333);
      expect(col.mapToDriverValue(33.333333)).toBe("33.333333");
    }
  });

  it("line quantity columns are numeric(15,4), not real", () => {
    for (const col of [
      invoiceLines.quantity,
      quoteLines.quantity,
      creditNoteLines.quantity,
      purchaseOrderLines.quantity,
      serviceInvoiceLines.quantity,
    ]) {
      expect(col.getSQLType()).toBe("numeric(15,4)");
      expect(col.mapFromDriverValue("2.5000")).toBe(2.5);
    }
  });
});

describe("e-invoice PriceAmount", () => {
  const company = { name: "Pearl Trading LLC", trnVatNumber: "100123456700003" } as any;
  const invoice = {
    id: "inv-1",
    companyId: "co-1",
    number: "INV-1",
    customerName: "Acme LLC",
    customerTrn: "100765432100003",
    date: new Date("2026-06-01"),
    currency: "AED",
    subtotal: 100,
    vatAmount: 5,
    total: 105,
  } as any;

  it("emits full unit price precision", () => {
    const { xml } = generateEInvoiceXML(invoice, [
      { description: "Widget", quantity: 3, unitPrice: 33.333333, vatRate: 0.05, vatSupplyType: "standard_rated" },
    ] as any[], company);
    expect(xml).toContain(">33.333333</cbc:PriceAmount>");
    expect(xml).toContain(">100.00</cbc:LineExtensionAmount>");
  });

  it("keeps two decimals for round prices", () => {
    const { xml } = generateEInvoiceXML(invoice, [
      { description: "Widget", quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "standard_rated" },
    ] as any[], company);
    expect(xml).toContain(">100.00</cbc:PriceAmount>");
  });
});
