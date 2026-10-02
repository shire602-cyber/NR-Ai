import { describe, expect, it } from "vitest";
import { deriveSalesLines } from "../../shared/sales-line-math";
import { buildTemplateLines, splitTemplateLines } from "../../client/src/lib/recurring-template-lines";

const item = { description: "Retainer", quantity: 2, unitPrice: 500, vatRate: 0.05 };

describe("recurring template lines", () => {
  it("keeps a line discount and drops an empty one", () => {
    const lines = buildTemplateLines(
      [{ ...item, discountType: "percent", discountValue: "10" }, { ...item, discountType: "amount", discountValue: "" }, { ...item, discountType: null, discountValue: null }],
      { amount: "", vatRate: 0.05 },
      "Shipping"
    );
    expect(lines[0]).toMatchObject({ discountType: "percent", discountValue: 10 });
    expect(lines[1]).not.toHaveProperty("discountType");
    expect(lines[2]).not.toHaveProperty("discountValue");
    expect(lines).toHaveLength(3);
  });

  it("adds one shipping line only when an amount is entered", () => {
    expect(buildTemplateLines([item], { amount: "", vatRate: 0.05 }, "Shipping")).toHaveLength(1);
    expect(buildTemplateLines([item], { amount: 0, vatRate: 0.05 }, "Shipping")).toHaveLength(1);
    const lines = buildTemplateLines([item], { amount: 50, vatRate: 0 }, "الشحن");
    expect(lines[1]).toEqual({ description: "الشحن", quantity: 1, unitPrice: 50, vatRate: 0, lineKind: "shipping" });
  });

  it("round-trips through the editor split", () => {
    const stored = buildTemplateLines([{ ...item, discountType: "percent", discountValue: 10 }], { amount: 50, vatRate: 0.05 }, "Shipping");
    const { items, shipping } = splitTemplateLines(stored as any[]);
    expect(items).toHaveLength(1);
    expect(shipping).toMatchObject({ lineKind: "shipping", unitPrice: 50 });
  });

  it("derives to the totals the invoice carries (950 net, 47.50 VAT)", () => {
    const stored = buildTemplateLines([{ ...item, discountType: "percent", discountValue: 10 }], { amount: 50, vatRate: 0.05 }, "Shipping");
    const res = deriveSalesLines({
      lines: stored.map((l: any) => ({
        kind: l.lineKind === "shipping" ? "shipping" : "item",
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
        discountType: l.discountType ?? null,
        discountValue: l.discountValue ?? null,
      })),
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.subtotal).toBeCloseTo(950, 2);
      expect(res.vatAmount).toBeCloseTo(47.5, 2);
      expect(res.total).toBeCloseTo(997.5, 2);
    }
  });
});
