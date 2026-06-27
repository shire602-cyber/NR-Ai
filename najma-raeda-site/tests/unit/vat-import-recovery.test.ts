import { describe, it, expect } from "vitest";
import { calculateVatWorkpaperTotals } from "../../server/services/firm-vat-workspace.service";

describe("import VAT recovery (A-B6)", () => {
  it("nets import VAT to nil for a fully-taxable importer", () => {
    const totals = calculateVatWorkpaperTotals([
      {
        rowCategory: "import",
        vat201Box: "box6ImportsAmount",
        emirate: null,
        taxableAmount: 10000,
        vatAmount: 500,
        adjustmentAmount: 0,
        status: "approved",
      },
    ] as any);
    // Output side declares the import VAT...
    expect(totals.box6ImportsVat).toBe(500);
    expect(totals.box12TotalDueTax).toBe(500);
    // ...and it is now recovered as input, so net payable is zero.
    expect(totals.box13RecoverableTax).toBe(500);
    expect(totals.box14PayableTax).toBe(0);
  });

  it("still nets correctly alongside ordinary sales and expenses", () => {
    const totals = calculateVatWorkpaperTotals([
      {
        rowCategory: "standard_sale",
        vat201Box: "box1bDubaiAmount",
        emirate: "dubai",
        taxableAmount: 1000,
        vatAmount: 50,
        adjustmentAmount: 0,
        status: "approved",
      },
      {
        rowCategory: "standard_expense",
        vat201Box: "box9ExpensesAmount",
        emirate: null,
        taxableAmount: 200,
        vatAmount: 10,
        adjustmentAmount: 0,
        status: "approved",
      },
      {
        rowCategory: "import",
        vat201Box: "box6ImportsAmount",
        emirate: null,
        taxableAmount: 4000,
        vatAmount: 200,
        adjustmentAmount: 0,
        status: "approved",
      },
    ] as any);
    // Due: 50 (sale) + 200 (import) = 250. Recoverable: 10 (expense) + 200 (import) = 210.
    expect(totals.box12TotalDueTax).toBe(250);
    expect(totals.box13RecoverableTax).toBe(210);
    expect(totals.box14PayableTax).toBe(40); // only the genuine 50-10 = 40 net on real activity
  });
});
