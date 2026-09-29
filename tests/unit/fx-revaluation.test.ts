import { describe, it, expect } from "vitest";
import { computeRevaluation, type RevaluationItem } from "../../server/services/fx-revaluation.service";

const usdInvoice = (over: Partial<RevaluationItem> = {}): RevaluationItem => ({
  id: "inv-1",
  kind: "receivable",
  currency: "USD",
  outstandingForeign: 105,
  bookRate: 3.6725,
  currentRate: 3.7,
  ...over,
});

describe("computeRevaluation", () => {
  it("receivable gain: outstanding x (current - booked)", () => {
    const r = computeRevaluation([usdInvoice()]);
    // 105 x 3.70 = 388.50 ; 105 x 3.6725 = 385.61 ; gain 2.89
    expect(r.receivableRevalAed).toBe(2.89);
    expect(r.payableRevalAed).toBe(0);
    expect(r.items[0].adjustmentAed).toBe(2.89);
  });

  it("receivable loss when the foreign currency weakened", () => {
    const r = computeRevaluation([usdInvoice({ currentRate: 3.6 })]);
    expect(r.receivableRevalAed).toBe(-7.61);
  });

  it("partially paid: only the OUTSTANDING foreign amount is revalued", () => {
    const full = computeRevaluation([usdInvoice({ currentRate: 3.8 })]);
    const half = computeRevaluation([usdInvoice({ currentRate: 3.8, outstandingForeign: 52.5 })]);
    expect(half.receivableRevalAed).toBeCloseTo(full.receivableRevalAed / 2, 1);
    // 52.50 x 3.80 = 199.50 ; 52.50 x 3.6725 = 192.81 ; gain 6.69
    expect(half.receivableRevalAed).toBe(6.69);
  });

  it("zero when the rate is unchanged", () => {
    const r = computeRevaluation([usdInvoice({ currentRate: 3.6725 })]);
    expect(r.receivableRevalAed).toBe(0);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].adjustmentAed).toBe(0);
  });

  it("nothing to revalue when nothing is outstanding", () => {
    const r = computeRevaluation([usdInvoice({ outstandingForeign: 0 })]);
    expect(r.items).toHaveLength(0);
    expect(r.receivableRevalAed).toBe(0);
  });

  it("payables mirror receivables: a stronger foreign currency is a LOSS", () => {
    const r = computeRevaluation([
      { id: "bill-1", kind: "payable", currency: "EUR", outstandingForeign: 100, bookRate: 4.0, currentRate: 4.1 },
    ]);
    expect(r.payableRevalAed).toBe(-10);
    expect(r.receivableRevalAed).toBe(0);
  });

  it("skips a document whose current rate is unavailable and reports it", () => {
    const r = computeRevaluation([usdInvoice({ currentRate: null })]);
    expect(r.items).toHaveLength(0);
    expect(r.skipped).toEqual([{ id: "inv-1", reason: "NO_RATE" }]);
  });

  it("is a full recomputation: independent of any earlier run (earlier entries are auto-reversed)", () => {
    const a = computeRevaluation([usdInvoice()]);
    const b = computeRevaluation([usdInvoice()]);
    expect(b).toEqual(a);
  });

  it("sums many documents into net receivable and payable figures", () => {
    const r = computeRevaluation([
      usdInvoice({ id: "a", currentRate: 3.7 }),
      usdInvoice({ id: "b", currentRate: 3.6 }),
      { id: "p", kind: "payable", currency: "EUR", outstandingForeign: 50, bookRate: 4, currentRate: 3.9 },
    ]);
    expect(r.receivableRevalAed).toBe(round2(2.89 - 7.61));
    expect(r.payableRevalAed).toBe(5);
  });
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
