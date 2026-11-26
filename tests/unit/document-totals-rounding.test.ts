// F01 — one line-level VAT rounding rule across editor, API, PDF buckets,
// e-invoice payload and VAT autopilot.
// Source-inspection tests are used here because the full CN→invoice posting
// path requires a live Postgres DB; we can verify the code paths exist and
// wire through computeSalesDocument without a DB.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  calculateDocumentTotals,
  lineNetAmount,
  lineVatAmount,
  roundMoney,
} from "../../shared/document-totals";
import { calculateDocumentTotals as serverTotals } from "../../server/services/document-totals.service";
import { aggregateInvoiceLines } from "../../server/services/vat-autopilot.service";

describe("F01 document totals — line-level half-up rounding", () => {
  it("control case: two AED 0.10 lines at 5% → 0.01 VAT each, 0.02 VAT, 0.22 gross", () => {
    const lines = [
      { quantity: 1, unitPrice: 0.1, vatRate: 0.05 },
      { quantity: 1, unitPrice: 0.1, vatRate: 0.05 },
    ];
    expect(lines.map((l) => lineVatAmount(l))).toEqual([0.01, 0.01]);
    expect(calculateDocumentTotals(lines)).toEqual({ subtotal: 0.2, vatAmount: 0.02, total: 0.22 });
    // Server re-export must be the same function (API == editor).
    expect(serverTotals(lines)).toEqual({ subtotal: 0.2, vatAmount: 0.02, total: 0.22 });
  });

  it("VAT autopilot Box 1 agrees with document VAT for the control case", () => {
    const agg = aggregateInvoiceLines([
      { quantity: 1, unitPrice: 0.1, vatRate: 0.05 },
      { quantity: 1, unitPrice: 0.1, vatRate: 0.05 },
    ]);
    expect(agg.standardRatedAmount).toBe(0.2);
    expect(agg.standardRatedVat).toBe(0.02);
  });

  it("mixed 0% / 5% rates and percent-form rate", () => {
    const totals = calculateDocumentTotals([
      { quantity: 3, unitPrice: 33.335, vatRate: 5 }, // net 100.005 → 100.01; VAT 5.0005 → 5.00
      { quantity: 1, unitPrice: 50, vatRate: 0 },
    ]);
    expect(totals).toEqual({ subtotal: 150.01, vatAmount: 5, total: 155.01 });
  });

  it("fractional quantities keep full precision until the line result", () => {
    // 2.5 × 0.333 = 0.8325 → 0.83 net; VAT 0.0415 → 0.04
    expect(lineNetAmount({ quantity: 2.5, unitPrice: 0.333 })).toBe(0.83);
    expect(lineVatAmount({ quantity: 2.5, unitPrice: 0.333, vatRate: 0.05 })).toBe(0.04);
    // Binary-float trap: 1.005 must round half-up to 1.01, not 1.00.
    expect(roundMoney(1.005)).toBe(1.01);
    expect(lineNetAmount({ quantity: "1", unitPrice: "1.005" })).toBe(1.01);
  });

  it("total always equals subtotal + VAT exactly", () => {
    for (let i = 1; i <= 200; i++) {
      const t = calculateDocumentTotals([
        { quantity: i / 7, unitPrice: 0.37 * i, vatRate: 0.05 },
        { quantity: 1, unitPrice: i / 3, vatRate: 0.05 },
      ]);
      expect(roundMoney(t.subtotal + t.vatAmount)).toBe(t.total);
    }
  });

  it("garbage inputs contribute zero instead of NaN", () => {
    expect(
      calculateDocumentTotals([{ quantity: " " as any, unitPrice: "abc" as any, vatRate: null }])
    ).toEqual({ subtotal: 0, vatAmount: 0, total: 0 });
  });
});

describe("F01 CN-line totals path — insertCreditNoteDocument routes through computeSalesDocument", () => {
  // Source-inspection: behaviour test requires Postgres (insertCreditNoteDocument
  // runs inside a DB transaction). We verify the code-path invariants here.
  it("insertCreditNoteDocument calls computeSalesDocument for explicit lines", () => {
    const s = readFileSync("server/services/invoice-posting.service.ts", "utf8");
    // The function is imported from document-totals.service.
    expect(s).toContain('"./document-totals.service"');
    // computeSalesDocument is called inside insertCreditNoteDocument.
    expect(s).toMatch(/insertCreditNoteDocument[\s\S]{0,2000}computeSalesDocument/);
  });

  it("CN creation route delegates to createDraftCreditNote (uses insertCreditNoteDocument)", () => {
    const s = readFileSync("server/routes/credit-notes.routes.ts", "utf8");
    expect(s).toContain("createDraftCreditNote");
    // Lines are prepared via toCreditLines → prepareSalesLines → unitPriceFils
    expect(s).toContain("toCreditLines");
  });
});
