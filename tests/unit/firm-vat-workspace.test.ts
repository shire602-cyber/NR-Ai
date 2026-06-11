import { describe, expect, it } from "vitest";

import {
  calculateVatWorkpaperTotals,
  mapVatWorkpaperRowToBox,
} from "../../server/services/firm-vat-workspace.service";

describe("firm VAT workspace totals", () => {
  it("maps approved VAT workpaper rows into VAT 201 totals and excludes drafts", () => {
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
        rowCategory: "standard_sale",
        vat201Box: "box1cSharjahAmount",
        emirate: "sharjah",
        taxableAmount: 500,
        vatAmount: 25,
        adjustmentAmount: 5,
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
        rowCategory: "standard_expense",
        vat201Box: "box9ExpensesAmount",
        emirate: null,
        taxableAmount: 999,
        vatAmount: 99,
        adjustmentAmount: 0,
        status: "draft",
      },
    ] as any);

    expect(totals.box1bDubaiAmount).toBe(1000);
    expect(totals.box1bDubaiVat).toBe(50);
    expect(totals.box1cSharjahAmount).toBe(500);
    expect(totals.box1cSharjahVat).toBe(25);
    expect(totals.box8TotalAmount).toBe(1500);
    expect(totals.box8TotalVat).toBe(75);
    expect(totals.box8TotalAdj).toBe(5);
    expect(totals.box9ExpensesVat).toBe(10);
    expect(totals.box11TotalVat).toBe(10);
    expect(totals.box14PayableTax).toBe(65);
  });

  it("lets manual adjustments affect source boxes while derived boxes are recalculated", () => {
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
        rowCategory: "manual_adjustment",
        vat201Box: "box9ExpensesVat",
        emirate: null,
        taxableAmount: 0,
        vatAmount: 0,
        adjustmentAmount: 7,
        status: "approved",
      },
    ] as any);

    expect(totals.box9ExpensesVat).toBe(7);
    expect(totals.box11TotalVat).toBe(7);
    expect(totals.box14PayableTax).toBe(43);
  });
});

describe("firm VAT workspace row mapping", () => {
  it("maps standard sales to the emirate-specific VAT 201 box", () => {
    expect(mapVatWorkpaperRowToBox({ rowCategory: "standard_sale", emirate: "dubai" })).toBe(
      "box1bDubaiAmount"
    );
    expect(
      mapVatWorkpaperRowToBox({ rowCategory: "standard_sale", emirate: "ras_al_khaimah" })
    ).toBe("box1fRasAlKhaimahAmount");
  });

  it("rejects manual adjustments to derived VAT 201 total boxes", () => {
    expect(() =>
      mapVatWorkpaperRowToBox({
        rowCategory: "manual_adjustment",
        vat201Box: "box14PayableTax",
      })
    ).toThrow("Manual adjustment VAT 201 box is not supported");
  });
});
