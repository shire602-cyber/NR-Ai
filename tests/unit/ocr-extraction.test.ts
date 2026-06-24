import { describe, it, expect } from "vitest";
import { normalizeOcrJson, VALID_OCR_CATEGORIES } from "../../server/services/ocr-extraction.service";

const TODAY = "2026-06-23";

describe("normalizeOcrJson — amount reconciliation", () => {
  it("derives subtotal + VAT from a total-only receipt (UAE 5%)", () => {
    const r = normalizeOcrJson({ merchant: "Acme", total: 105, vatPercentage: 5 }, { today: TODAY });
    expect(r.total).toBe(105);
    expect(r.amount).toBe(100); // 105 / 1.05
    expect(r.vatAmount).toBe(5);
  });

  it("computes total when only subtotal + VAT are present", () => {
    const r = normalizeOcrJson({ subtotal: 200, vatAmount: 10 }, { today: TODAY });
    expect(r.total).toBe(210);
    expect(r.amount).toBe(200);
    expect(r.vatAmount).toBe(10);
  });

  it("derives subtotal when total + VAT% present but no subtotal", () => {
    const r = normalizeOcrJson({ total: 210, vatPercentage: 5 }, { today: TODAY });
    expect(r.amount).toBe(200); // 210 / 1.05
  });

  it("treats explicit vatPercentage 0 as zero-rated", () => {
    const r = normalizeOcrJson({ total: 100, vatPercentage: 0 }, { today: TODAY });
    expect(r.vatAmount).toBe(0);
    expect(r.amount).toBe(100);
  });

  it("defaults missing vatPercentage to 5%", () => {
    const r = normalizeOcrJson({ subtotal: 100 }, { today: TODAY });
    expect(r.vatAmount).toBe(5);
    expect(r.total).toBe(105);
  });

  it("parses thousands separators", () => {
    const r = normalizeOcrJson({ total: "1,234.56", vatPercentage: 5 }, { today: TODAY });
    expect(r.total).toBe(1234.56);
  });

  it("ignores negative junk amounts (treated as 0)", () => {
    const r = normalizeOcrJson({ subtotal: -50, total: 105, vatPercentage: 5 }, { today: TODAY });
    expect(r.amount).toBe(100);
  });
});

describe("normalizeOcrJson — fields", () => {
  it("coerces an unknown category to Other", () => {
    const r = normalizeOcrJson({ category: "Spaceships", total: 105 }, { today: TODAY });
    expect(r.category).toBe("Other");
  });

  it("keeps a valid category", () => {
    const r = normalizeOcrJson({ category: "Utilities", total: 105 }, { today: TODAY });
    expect(r.category).toBe("Utilities");
    expect(VALID_OCR_CATEGORIES).toContain(r.category);
  });

  it("falls back to today for a missing/invalid date", () => {
    expect(normalizeOcrJson({ total: 1 }, { today: TODAY }).date).toBe(TODAY);
    expect(normalizeOcrJson({ date: "31-01-2026", total: 1 }, { today: TODAY }).date).toBe(TODAY);
  });

  it("accepts a valid ISO date", () => {
    expect(normalizeOcrJson({ date: "2026-01-31", total: 1 }, { today: TODAY }).date).toBe("2026-01-31");
  });

  it("defaults merchant and currency", () => {
    const r = normalizeOcrJson({ total: 1 }, { today: TODAY });
    expect(r.merchant).toBe("Unknown Merchant");
    expect(r.currency).toBe("AED");
  });

  it("passes through rawText and imageData", () => {
    const r = normalizeOcrJson({ total: 1 }, { today: TODAY, rawText: "hello", imageData: "BASE64" });
    expect(r.rawText).toBe("hello");
    expect(r.imageData).toBe("BASE64");
  });

  it("maps line items to {description}", () => {
    const r = normalizeOcrJson(
      { total: 1, lineItems: [{ description: "Widget", quantity: 2 }, { description: "Gadget" }] },
      { today: TODAY }
    );
    expect(r.lineItems).toEqual([{ description: "Widget" }, { description: "Gadget" }]);
  });
});
