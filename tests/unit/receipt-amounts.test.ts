import { describe, expect, it } from "vitest";
import { toFils } from "../../shared/money";
import { reconcileReceiptAmounts } from "../../shared/receipt-amounts";
import { parseReceiptOcrText } from "../../shared/receipt-ocr-parser";

const f = (n: number) => toFils(n); // strict: throws if a figure is not exactly 2dp

// The pre-fix float formulas from server/routes/ocr.routes.ts buildResult, kept to prove drift.
function oldReconcile(subtotal: number, vatAmount: number, totalIn: number, pct: number) {
  let total = totalIn;
  if (total === 0 && subtotal > 0) total = parseFloat((subtotal + vatAmount).toFixed(2));
  const sub =
    subtotal > 0 ? subtotal : total > 0 ? parseFloat((total / (1 + pct / 100)).toFixed(2)) : 0;
  const vat = vatAmount > 0 ? vatAmount : parseFloat(((sub * pct) / 100).toFixed(2));
  const tot = total > 0 ? total : parseFloat((sub + vat).toFixed(2));
  return { subtotal: sub, vatAmount: vat, total: tot };
}

describe("reconcileReceiptAmounts (integer fils, half-up)", () => {
  it.each([0.05, 0.1, 0.99, 1.05, 10.01, 99.99, 105, 1234.57, 99999.99, 0.03])(
    "total-only %s: subtotal + VAT equals total to the fil",
    (total) => {
      const r = reconcileReceiptAmounts({ subtotal: 0, vatAmount: 0, total, vatPercentage: 5 });
      expect(f(r.subtotal) + f(r.vatAmount)).toBe(f(total));
      expect(f(r.total)).toBe(f(total));
    }
  );

  it.each([0.05, 0.1, 10, 10.01, 99.99, 100, 1234.56, 0.3])(
    "subtotal-only %s: VAT is 5% half-up and total = subtotal + VAT",
    (subtotal) => {
      const r = reconcileReceiptAmounts({ subtotal, vatAmount: 0, total: 0, vatPercentage: 5 });
      expect(f(r.subtotal) + f(r.vatAmount)).toBe(f(r.total));
      expect(f(r.vatAmount)).toBe(Math.floor((f(subtotal) * 5 + 50) / 100));
    }
  );

  it("rounds ties away from zero (0.10 at 5% = 0.005 -> 0.01; 0.30 -> 0.015 -> 0.02)", () => {
    expect(
      reconcileReceiptAmounts({ subtotal: 0.1, vatAmount: 0, total: 0, vatPercentage: 5 }).vatAmount
    ).toBe(0.01);
    expect(
      reconcileReceiptAmounts({ subtotal: 0.3, vatAmount: 0, total: 0, vatPercentage: 5 }).vatAmount
    ).toBe(0.02);
  });

  it("derives the VAT-inclusive net from a known VAT amount exactly", () => {
    const r = reconcileReceiptAmounts({
      subtotal: 0,
      vatAmount: 4.76,
      total: 100,
      vatPercentage: 5,
    });
    expect(r).toEqual({ subtotal: 95.24, vatAmount: 4.76, total: 100 });
  });

  it("subtotal + total supplied: VAT is the difference (also handles zero-rated)", () => {
    expect(
      reconcileReceiptAmounts({ subtotal: 100, vatAmount: 0, total: 105, vatPercentage: 5 })
        .vatAmount
    ).toBe(5);
    expect(
      reconcileReceiptAmounts({ subtotal: 100, vatAmount: 0, total: 100, vatPercentage: 0 })
        .vatAmount
    ).toBe(0);
  });

  it("zero-rated total-only keeps the whole total as subtotal", () => {
    expect(
      reconcileReceiptAmounts({ subtotal: 0, vatAmount: 0, total: 50.5, vatPercentage: 0 })
    ).toEqual({
      subtotal: 50.5,
      vatAmount: 0,
      total: 50.5,
    });
  });

  it("never alters supplied figures and returns zeros for no data", () => {
    expect(
      reconcileReceiptAmounts({ subtotal: 20, vatAmount: 1, total: 21, vatPercentage: 5 })
    ).toEqual({
      subtotal: 20,
      vatAmount: 1,
      total: 21,
    });
    expect(
      reconcileReceiptAmounts({ subtotal: 0, vatAmount: 0, total: 0, vatPercentage: 5 })
    ).toEqual({
      subtotal: 0,
      vatAmount: 0,
      total: 0,
    });
  });

  it("the old float path left subtotal-only receipts with total != subtotal + VAT; the new one does not", () => {
    const old = oldReconcile(100, 0, 0, 5);
    expect(f(old.subtotal) + f(old.vatAmount)).not.toBe(f(old.total)); // 100 + 5 !== 100
    const fixed = reconcileReceiptAmounts({
      subtotal: 100,
      vatAmount: 0,
      total: 0,
      vatPercentage: 5,
    });
    expect(fixed).toEqual({ subtotal: 100, vatAmount: 5, total: 105 });
  });

  it("old float path drifted by a fil on total-only receipts (0.10, 0.32, 0.52); new path does not", () => {
    for (const total of [0.1, 0.32, 0.52]) {
      const old = oldReconcile(0, 0, total, 5);
      expect(f(old.subtotal) + f(old.vatAmount)).not.toBe(f(old.total));
      const r = reconcileReceiptAmounts({ subtotal: 0, vatAmount: 0, total, vatPercentage: 5 });
      expect(f(r.subtotal) + f(r.vatAmount)).toBe(f(r.total));
    }
  });

  it("matches what posting books: figures are strict 2dp so toFils accepts them (no re-rounding)", () => {
    for (let c = 1; c <= 2000; c += 7) {
      const total = c / 100;
      const r = reconcileReceiptAmounts({ subtotal: 0, vatAmount: 0, total, vatPercentage: 5 });
      expect(f(r.subtotal) + f(r.vatAmount)).toBe(f(r.total));
    }
  });
});

describe("parseReceiptOcrText amounts", () => {
  it("total-only receipt reconciles to the fil", () => {
    const r = parseReceiptOcrText("Shop\nTotal AED 10.01", { fallbackDate: "2026-06-29" });
    expect(f(r.subtotal) + f(r.vatAmount)).toBe(f(r.total));
    expect(r.total).toBe(10.01);
  });
});
