import { describe, expect, it } from "vitest";
import { aggregateInvoiceLines } from "../../server/services/vat-autopilot.service";
import { mapBooksToVatWorkpaperRows } from "../../server/services/firm-vat-workspace.service";
import { aggregateReturnSalesLines } from "../../server/services/vat-sales-lines";

// The three VAT engines (VAT 201 generator, autopilot, firm workpaper pull)
// each classified sales lines on their own and drifted apart on 0%
// out_of_scope lines. They now share classifyVatLineForReturn; this feeds the
// same lines through all three and demands identical boxes.

type Line = {
  quantity: number;
  unitPrice: number;
  vatRate: number;
  vatSupplyType: string | null;
};

const FIXTURE: Line[] = [
  { quantity: 1, unitPrice: 1000, vatRate: 0.05, vatSupplyType: "standard_rated" },
  { quantity: 2, unitPrice: 250, vatRate: 0.05, vatSupplyType: "out_of_scope" }, // taxed: payable
  { quantity: 1, unitPrice: 400, vatRate: 0.05, vatSupplyType: "exempt" }, // taxed: payable
  { quantity: 1, unitPrice: 300, vatRate: 0, vatSupplyType: "zero_rated" },
  { quantity: 1, unitPrice: 50, vatRate: 0, vatSupplyType: "standard_rated" }, // legacy 0%: zero-rated
  { quantity: 1, unitPrice: 75, vatRate: 0, vatSupplyType: null },
  { quantity: 1, unitPrice: 200, vatRate: 0, vatSupplyType: "exempt" },
  { quantity: 3, unitPrice: 500, vatRate: 0, vatSupplyType: "out_of_scope" }, // in none of Boxes 1-5
];

const EXPECTED = {
  standardAmount: 1000 + 500 + 400,
  standardVat: 50 + 25 + 20,
  zeroRatedAmount: 300 + 50 + 75,
  exemptAmount: 200,
};

function viaVatRoute(lines: Line[]) {
  const r = aggregateReturnSalesLines(
    lines.map((l) => ({ ...l, invoiceId: "i1" })),
    new Map([["i1", 1]])
  );
  return {
    standardAmount: r.standardRatedAmount,
    standardVat: r.standardRatedVat,
    zeroRatedAmount: r.zeroRatedAmount,
    exemptAmount: r.exemptAmount,
  };
}

function viaAutopilot(lines: Line[]) {
  const r = aggregateInvoiceLines(lines as any);
  return {
    standardAmount: r.standardRatedAmount,
    standardVat: r.standardRatedVat,
    zeroRatedAmount: r.zeroRatedAmount,
    exemptAmount: r.exemptAmount,
  };
}

function viaFirmWorkspace(lines: Line[]) {
  const rows = mapBooksToVatWorkpaperRows({
    invoices: [{ id: "i1", number: "INV-1", date: "2026-08-10", status: "sent" }],
    invoiceLines: lines.map((l) => ({ ...l, invoiceId: "i1" })),
    receipts: [],
    companyEmirate: "dubai",
    periodStart: new Date("2026-08-01T00:00:00Z"),
    periodEnd: new Date("2026-08-31T00:00:00Z"),
    existingSourceIds: new Set(),
  });
  const sum = (cat: string, key: "taxableAmount" | "vatAmount") =>
    rows.filter((r) => r.rowCategory === cat).reduce((s, r) => s + Number(r[key]), 0);
  return {
    standardAmount: sum("standard_sale", "taxableAmount"),
    standardVat: sum("standard_sale", "vatAmount"),
    zeroRatedAmount: sum("zero_rated_sale", "taxableAmount"),
    exemptAmount: sum("exempt_sale", "taxableAmount"),
  };
}

describe("the three VAT engines classify sales lines identically", () => {
  it("VAT 201 generator", () => expect(viaVatRoute(FIXTURE)).toEqual(EXPECTED));
  it("VAT autopilot", () => expect(viaAutopilot(FIXTURE)).toEqual(EXPECTED));
  it("firm VAT workpaper pull", () => expect(viaFirmWorkspace(FIXTURE)).toEqual(EXPECTED));

  it("identical box results for the same fixture", () => {
    const a = viaVatRoute(FIXTURE);
    expect(viaAutopilot(FIXTURE)).toEqual(a);
    expect(viaFirmWorkspace(FIXTURE)).toEqual(a);
  });

  it("ordinary standard / zero / exempt data is unchanged", () => {
    const ordinary: Line[] = [
      { quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "standard_rated" },
      { quantity: 1, unitPrice: 200, vatRate: 0, vatSupplyType: "zero_rated" },
      { quantity: 1, unitPrice: 300, vatRate: 0, vatSupplyType: "exempt" },
    ];
    const want = { standardAmount: 100, standardVat: 5, zeroRatedAmount: 200, exemptAmount: 300 };
    expect(viaVatRoute(ordinary)).toEqual(want);
    expect(viaAutopilot(ordinary)).toEqual(want);
    expect(viaFirmWorkspace(ordinary)).toEqual(want);
  });

  it("a credit note (negative lines) nets off in every engine", () => {
    const lines: Line[] = [
      { quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "standard_rated" },
      { quantity: -1, unitPrice: 100, vatRate: 0.05, vatSupplyType: "standard_rated" },
    ];
    const zero = { standardAmount: 0, standardVat: 0, zeroRatedAmount: 0, exemptAmount: 0 };
    expect(viaVatRoute(lines)).toEqual(zero);
    expect(viaAutopilot(lines)).toEqual(zero);
    // the workpaper pull only emits rows for positive totals
    expect(viaFirmWorkspace(lines)).toEqual(zero);
  });
});
