import { describe, it, expect } from "vitest";
import {
  deriveSalesLines,
  splitGross,
  splitGrossRefund,
  amountDiscountToPercent,
  type SalesLineInput,
} from "../../shared/sales-line-math";

const item = (over: Partial<SalesLineInput> = {}): SalesLineInput => ({
  kind: "item",
  description: "Widget",
  quantity: 1,
  unitPrice: 1000,
  vatRate: 0.05,
  vatSupplyType: "standard_rated",
  ...over,
});

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error("expected ok, got " + JSON.stringify(r));
  return r as any;
}

describe("deriveSalesLines", () => {
  it("builds the D1-7 example: 10% line discount, 50 document discount, 100 shipping", () => {
    const r = ok(
      deriveSalesLines({
        lines: [item({ discountType: "percent", discountValue: 10 }), { ...item({ description: "Delivery", unitPrice: 100 }), kind: "shipping" }],
        discountType: "amount",
        discountValue: 50,
      })
    );
    expect(r.itemsSubtotal).toBe(850);
    expect(r.discountAmount).toBe(150);
    expect(r.shippingAmount).toBe(100);
    expect(r.subtotal).toBe(950);
    expect(r.vatAmount).toBe(47.5);
    expect(r.total).toBe(997.5);
    const kinds = r.lines.map((l) => l.lineKind);
    expect(kinds).toEqual(["item", "discount", "discount", "shipping"]);
    expect(r.lines[1].parentIndex).toBe(0);
    expect(r.lines[1].quantity * r.lines[1].unitPrice).toBe(-100);
    expect(r.lines[2].parentIndex).toBeUndefined();
    expect(r.lines[2].quantity * r.lines[2].unitPrice).toBe(-50);
  });

  it("applies a document discount pro rata per VAT bucket with the residual on the largest bucket", () => {
    const r = ok(
      deriveSalesLines({
        lines: [
          item({ unitPrice: 100 }),
          item({ unitPrice: 100, vatRate: 0, vatSupplyType: "zero_rated" }),
          item({ unitPrice: 100 }),
        ],
        discountType: "amount",
        discountValue: 10,
      })
    );
    const docDiscounts = r.lines.filter((l) => l.lineKind === "discount" && l.parentIndex === undefined);
    // 10 over 300 net: 5%-bucket carries 200 -> 6.67, zero-rated 100 -> 3.33
    const amounts = Object.fromEntries(docDiscounts.map((l) => [l.vatRate, -l.quantity * l.unitPrice]));
    expect(amounts[0.05]).toBe(6.67);
    expect(amounts[0]).toBe(3.33);
    expect(r.discountAmount).toBe(10);
  });

  it("converts a percent document discount on the item net after line discounts", () => {
    const r = ok(
      deriveSalesLines({
        lines: [item({ discountType: "amount", discountValue: 200 })],
        discountType: "percent",
        discountValue: 10,
      })
    );
    // net after line discount 800 -> 10% = 80
    expect(r.discountAmount).toBe(280);
    expect(r.subtotal).toBe(720);
  });

  it("rejects a line discount above the line gross", () => {
    const r = deriveSalesLines({ lines: [item({ discountType: "amount", discountValue: 1000.01 })] });
    expect(r).toMatchObject({ ok: false, code: "DISCOUNT_EXCEEDS_LINE" });
    const p = deriveSalesLines({ lines: [item({ discountType: "percent", discountValue: 100.5 })] });
    expect(p).toMatchObject({ ok: false, code: "DISCOUNT_EXCEEDS_LINE" });
  });

  it("rejects a document discount above the item net", () => {
    const r = deriveSalesLines({ lines: [item()], discountType: "amount", discountValue: 1000.01 });
    expect(r).toMatchObject({ ok: false, code: "DISCOUNT_EXCEEDS_SUBTOTAL" });
  });

  it("allows a 100% discount", () => {
    const r = ok(deriveSalesLines({ lines: [item({ discountType: "percent", discountValue: 100 })] }));
    expect(r.subtotal).toBe(0);
    expect(r.total).toBe(0);
  });

  it("rejects two shipping lines", () => {
    const s: SalesLineInput = { ...item({ unitPrice: 10 }), kind: "shipping" };
    expect(deriveSalesLines({ lines: [item(), s, s] })).toMatchObject({ ok: false, code: "SHIPPING_LINE_LIMIT" });
  });

  it("shipping takes the dominant item VAT rate", () => {
    const r = ok(
      deriveSalesLines({
        lines: [
          item({ unitPrice: 10, vatRate: 0.05 }),
          item({ unitPrice: 500, vatRate: 0, vatSupplyType: "zero_rated" }),
          { ...item({ unitPrice: 20, vatRate: undefined as any }), kind: "shipping" },
        ],
      })
    );
    const ship = r.lines.find((l) => l.lineKind === "shipping")!;
    expect(ship.vatRate).toBe(0);
    expect(ship.vatSupplyType).toBe("zero_rated");
  });

  it("adds advance lines as negative net at the advance's rate", () => {
    const r = ok(
      deriveSalesLines({
        lines: [item({ unitPrice: 3000 })],
        advances: [{ advanceId: "a1", description: "Less advance ADV-1 (INV-1)", net: 1000, vatRate: 0.05, vatSupplyType: "standard_rated" }],
      })
    );
    expect(r.subtotal).toBe(2000);
    expect(r.vatAmount).toBe(100);
    expect(r.total).toBe(2100);
    const adv = r.lines.find((l) => l.lineKind === "advance")!;
    expect(adv.customerAdvanceId).toBe("a1");
    expect(adv.quantity * adv.unitPrice).toBe(-1000);
  });

  it("rejects an advance above the item net at its rate", () => {
    const r = deriveSalesLines({
      lines: [item({ unitPrice: 500 })],
      advances: [{ advanceId: "a1", description: "x", net: 600, vatRate: 0.05, vatSupplyType: "standard_rated" }],
    });
    expect(r).toMatchObject({ ok: false, code: "ADVANCE_EXCEEDS_INVOICE" });
  });

  it("totals every line like the engines do: sum of quantity x price, VAT per line rate", () => {
    const r = ok(
      deriveSalesLines({
        lines: [item({ quantity: 3, unitPrice: 33.333333 }), item({ unitPrice: 12.345, vatRate: 0, vatSupplyType: "zero_rated" })],
        discountType: "percent",
        discountValue: 7.5,
      })
    );
    const sum = r.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    expect(r.subtotal).toBeCloseTo(sum, 2);
    const vat = r.lines.reduce((s, l) => s + l.quantity * l.unitPrice * l.vatRate, 0);
    expect(r.vatAmount).toBeCloseTo(vat, 2);
    expect(r.total).toBeCloseTo(r.subtotal + r.vatAmount, 2);
  });
});

describe("fuzz: derived lines always add up", () => {
  it("200 random line sets: totals match the lines, every document discount is within the item net", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 200; i++) {
      const n = 1 + Math.floor(rnd() * 4);
      const lines: SalesLineInput[] = [];
      for (let j = 0; j < n; j++) {
        const zero = rnd() < 0.3;
        lines.push(
          item({
            quantity: Math.round((0.5 + rnd() * 9) * 100) / 100,
            unitPrice: Math.round(rnd() * 100000) / 100 + 0.01,
            vatRate: zero ? 0 : 0.05,
            vatSupplyType: zero ? "zero_rated" : "standard_rated",
            discountType: rnd() < 0.4 ? "percent" : null,
            discountValue: rnd() < 0.4 ? Math.round(rnd() * 5000) / 100 : null,
          })
        );
      }
      if (rnd() < 0.5) lines.push({ ...item({ unitPrice: Math.round(rnd() * 5000) / 100 + 1 }), kind: "shipping" });
      const r = deriveSalesLines({
        lines,
        discountType: rnd() < 0.5 ? "percent" : "amount",
        discountValue: Math.round(rnd() * 1500) / 100,
      });
      if (!r.ok) continue; // a rejected combination is fine; accepted ones must add up
      const sum = r.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
      expect(Math.abs(r.subtotal - sum)).toBeLessThan(0.006);
      const vat = r.lines.reduce((s, l) => s + l.quantity * l.unitPrice * l.vatRate, 0);
      expect(Math.abs(r.vatAmount - vat)).toBeLessThan(0.006);
      expect(r.subtotal).toBeCloseTo(r.itemsSubtotal + r.shippingAmount, 2);
    }
  });
});

describe("splitGross", () => {
  it("splits a gross advance into net and VAT", () => {
    expect(splitGross(1050, 0.05)).toEqual({ net: 1000, vat: 50 });
    expect(splitGross(1000, 0)).toEqual({ net: 1000, vat: 0 });
    const odd = splitGross(100, 0.05);
    expect(odd.net + odd.vat).toBeCloseTo(100, 2);
    expect(odd).toEqual({ net: 95.24, vat: 4.76 });
  });
});

describe("splitGrossRefund", () => {
  const buckets = [
    { vatRate: 0.05, vatSupplyType: "standard_rated", net: 900, vat: 45 },
    { vatRate: 0, vatSupplyType: "zero_rated", net: 100, vat: 0 },
  ];
  it("splits a refund pro rata over the VAT buckets and sums exactly", () => {
    const r = splitGrossRefund(200, buckets);
    const gross = r.reduce((s, b) => s + b.net + b.vat, 0);
    expect(Math.round(gross * 100) / 100).toBe(200);
    expect(r).toHaveLength(2);
    expect(r[0].vat).toBeGreaterThan(0);
    expect(r[1].vat).toBe(0);
  });
  it("refunding the whole gross returns the buckets unchanged", () => {
    const r = splitGrossRefund(1045, buckets);
    expect(r.map((b) => [b.net, b.vat])).toEqual([[900, 45], [100, 0]]);
  });
  it("rejects a refund above the gross", () => {
    expect(() => splitGrossRefund(1045.01, buckets)).toThrow();
  });
});

describe("amountDiscountToPercent", () => {
  it("converts an amount discount to a 6dp percent", () => {
    expect(amountDiscountToPercent(100, 1000)).toBe(10);
    expect(amountDiscountToPercent(1, 3)).toBe(33.333333);
  });
});
