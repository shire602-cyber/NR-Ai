import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  MAX_LINE_QUANTITY,
  MAX_UNIT_PRICE,
  requiredQuantity,
  requiredUnitPrice,
  normalizeDocumentLines,
  normalizeQuantity,
  normalizeUnitPrice,
} from "../../server/services/document-line-limits";
import { calculateDocumentTotals } from "../../server/services/document-totals.service";

const line = z.object({ quantity: requiredQuantity, unitPrice: requiredUnitPrice });

describe("shared line limits", () => {
  it("exposes the numeric(15,4) / numeric(19,6) limits from the shared constants file", () => {
    expect(MAX_LINE_QUANTITY).toBe("9999999999.9999");
    expect(MAX_UNIT_PRICE).toBe("9999999999999.999999");
  });

  it("accepts the largest storable quantity and rejects 2e11 (used to be a 500)", () => {
    expect(line.safeParse({ quantity: 9_999_999_999.9999, unitPrice: 1 }).success).toBe(true);
    const r = line.safeParse({ quantity: 2e11, unitPrice: 0.01 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/quantity is too large/i);
    expect(line.safeParse({ quantity: 1e10, unitPrice: 1 }).success).toBe(false);
  });

  it("accepts the largest storable unit price and rejects 1e13", () => {
    expect(line.safeParse({ quantity: 1, unitPrice: 9_999_999_999_999.998 }).success).toBe(true);
    const r = line.safeParse({ quantity: 1, unitPrice: 1e13 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/unit price is too large/i);
  });

  it("still requires positive values, also after rounding to storage precision", () => {
    expect(line.safeParse({ quantity: 0, unitPrice: 1 }).success).toBe(false);
    expect(line.safeParse({ quantity: -1, unitPrice: 1 }).success).toBe(false);
    expect(line.safeParse({ quantity: 0.00004, unitPrice: 1 }).success).toBe(false); // rounds to 0
    expect(line.safeParse({ quantity: 1, unitPrice: 0.0000004 }).success).toBe(false); // rounds to 0
  });

  it("rounds unit price to 6dp and quantity to 4dp half-up at the input boundary", () => {
    expect(normalizeUnitPrice(0.0000005)).toBe(0.000001);
    expect(normalizeUnitPrice(0.0000004)).toBe(0);
    expect(normalizeQuantity(1.00005)).toBe(1.0001);
    expect(normalizeQuantity(1.00004)).toBe(1);
    const parsed = line.parse({ quantity: 1.00005, unitPrice: 2.0000005 });
    expect(parsed).toEqual({ quantity: 1.0001, unitPrice: 2.000001 });
  });

  it("totals computed after normalisation equal what is stored (defect 6 proof)", () => {
    // 1,000,000 x 0.0000005: raw total 0.50, but the stored 6dp price is
    // 0.000001, so the stored line is worth 1.00.
    const raw = { quantity: 1_000_000, unitPrice: 0.0000005 };
    expect(calculateDocumentTotals([{ ...raw, vatRate: 0 }]).subtotal).toBe(0.5);
    const normalised = line.parse(raw);
    const totals = calculateDocumentTotals([{ ...normalised, vatRate: 0 }]);
    expect(totals.subtotal).toBe(1);
    expect(totals.total).toBe(1);
    // and equals the stored line value
    expect(normalised.quantity * normalised.unitPrice).toBeCloseTo(1, 10);
  });
});

describe("normalizeDocumentLines (quotes / purchase orders / recurring templates)", () => {
  it("rounds and passes other fields through untouched", () => {
    const out = normalizeDocumentLines([
      { description: "x", quantity: 1.00005, unitPrice: 0.0000005, vatRate: 0.05, revenueAccountId: "a" },
    ]);
    expect(out).toEqual([
      { description: "x", quantity: 1.0001, unitPrice: 0.000001, vatRate: 0.05, revenueAccountId: "a" },
    ]);
  });

  it("throws a ZodError (rendered as HTTP 400) for an oversized quantity", () => {
    expect(() => normalizeDocumentLines([{ quantity: 2e11, unitPrice: 0.01 }])).toThrow(z.ZodError);
  });

  it("does not add a positivity rule (a free quote line stays legal)", () => {
    expect(normalizeDocumentLines([{ quantity: 1, unitPrice: 0 }])[0].unitPrice).toBe(0);
  });

  it("leaves missing amounts alone", () => {
    expect(normalizeDocumentLines([{ description: "note" }])).toEqual([{ description: "note" }]);
  });
});
