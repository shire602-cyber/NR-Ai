import { describe, expect, it } from "vitest";

import {
  normalizeVatRowCategory,
  parseVatPasteRows,
  vat201CopyGroups,
  vatRowCategoryLabel,
} from "../../client/src/lib/vat-workpaper-grid";

describe("VAT workpaper grid helpers", () => {
  it("parses tab-delimited Excel rows with headers in bookkeeper-friendly names", () => {
    const rows = parseVatPasteRows(
      [
        "invoice number\tdate\tcustomer/vendor\tTRN\temirate\tcategory\ttaxable amount\tVAT amount\tgross amount\tnotes",
        "INV-1001\t2026-05-18\tAcme LLC\t100123456700003\tdubai\tstandard sale\t1,000.00\t50.00\t1,050.00\tMay sale",
      ].join("\n"),
      "sharjah"
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowCategory: "standard_sale",
      invoiceNumber: "INV-1001",
      counterpartyName: "Acme LLC",
      emirate: "dubai",
      taxableAmount: 1000,
      vatAmount: 50,
      grossAmount: 1050,
      sourceMethod: "import",
      status: "approved",
    });
  });

  it("parses quoted CSV exports and defaults missing emirate to the active client emirate", () => {
    const rows = parseVatPasteRows(
      [
        "category,invoice no,date,supplier,taxable,vat,gross,notes",
        '"standard expenses",BILL-7,2026-05-01,"Supplier, LLC",2500,125,2625,"Office rent"',
      ].join("\n"),
      "abu_dhabi"
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowCategory: "standard_expense",
      invoiceNumber: "BILL-7",
      counterpartyName: "Supplier, LLC",
      emirate: "abu_dhabi",
      taxableAmount: 2500,
      vatAmount: 125,
    });
  });

  it("normalizes real VAT workflow labels into supported row categories", () => {
    expect(normalizeVatRowCategory("Reverse charge input")).toBe("reverse_charge_input");
    expect(normalizeVatRowCategory("Import adjustment")).toBe("import_adjustment");
    expect(normalizeVatRowCategory("Zero rated supplies")).toBe("zero_rated_sale");
    expect(vatRowCategoryLabel("tourist_refund")).toBe("Tourist refunds");
  });

  it("exposes copy fields for all major VAT 201 sections", () => {
    const fields = vat201CopyGroups.flatMap((group) => group.fields.map(([key]) => key));

    expect(fields).toContain("box1bDubaiAmount");
    expect(fields).toContain("box2TouristRefundAmount");
    expect(fields).toContain("box6ImportsAmount");
    expect(fields).toContain("box9ExpensesVat");
    expect(fields).toContain("box14PayableTax");
  });
});
