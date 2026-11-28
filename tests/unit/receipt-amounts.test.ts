import { describe, expect, it } from "vitest";
import { toFils } from "../../shared/money";
import {
  amountMismatchMessage,
  isVatDerived,
  reconcileReceiptAmounts,
  vatDerivedMessage,
} from "../../shared/receipt-amounts";
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
    expect(r).toEqual({ subtotal: 95.24, vatAmount: 4.76, total: 100, mismatch: false });
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
      mismatch: false,
    });
  });

  it("keeps consistent supplied figures and returns zeros for no data", () => {
    expect(
      reconcileReceiptAmounts({ subtotal: 20, vatAmount: 1, total: 21, vatPercentage: 5 })
    ).toEqual({
      subtotal: 20,
      vatAmount: 1,
      total: 21,
      mismatch: false,
    });
    expect(
      reconcileReceiptAmounts({ subtotal: 0, vatAmount: 0, total: 0, vatPercentage: 5 })
    ).toEqual({
      subtotal: 0,
      vatAmount: 0,
      total: 0,
      mismatch: false,
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
    expect(fixed).toEqual({ subtotal: 100, vatAmount: 5, total: 105, mismatch: false });
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

describe("reconcileReceiptAmounts inconsistent sets (never silently made to add up)", () => {
  const r = reconcileReceiptAmounts;

  it("0% with subtotal 100 / total 110: VAT stays 0 and the mismatch is flagged", () => {
    expect(r({ subtotal: 100, vatAmount: 0, total: 110, vatPercentage: 0 })).toEqual({
      subtotal: 100,
      vatAmount: 0,
      total: 110,
      mismatch: true,
    });
  });

  it("5% with a service-charge gap (100 / 115.50): VAT is 5.00, not 15.50, and flagged", () => {
    expect(r({ subtotal: 100, vatAmount: 0, total: 115.5, vatPercentage: 5 })).toEqual({
      subtotal: 100,
      vatAmount: 5,
      total: 115.5,
      mismatch: true,
    });
  });

  it("5% gap within 1 fil of rate x subtotal is accepted as VAT", () => {
    expect(r({ subtotal: 100, vatAmount: 0, total: 105.01, vatPercentage: 5 })).toMatchObject({
      vatAmount: 5.01,
      mismatch: false,
    });
    expect(r({ subtotal: 100, vatAmount: 0, total: 105.02, vatPercentage: 5 })).toMatchObject({
      vatAmount: 5,
      mismatch: true,
    });
  });

  it("total below subtotal (discount): VAT is 0 (never invented) and flagged", () => {
    expect(r({ subtotal: 100, vatAmount: 0, total: 95, vatPercentage: 5 })).toEqual({
      subtotal: 100,
      vatAmount: 0,
      total: 95,
      mismatch: true,
    });
  });

  it("subtotal 100 / total 100 with no VAT line: VAT 0 and no mismatch (no VAT charged)", () => {
    expect(r({ subtotal: 100, vatAmount: 0, total: 100, vatPercentage: 5 })).toEqual({
      subtotal: 100,
      vatAmount: 0,
      total: 100,
      mismatch: false,
    });
  });

  it("subtotal 100 / total 105 is VAT 5 with no mismatch", () => {
    expect(r({ subtotal: 100, vatAmount: 0, total: 105, vatPercentage: 5 })).toEqual({
      subtotal: 100,
      vatAmount: 5,
      total: 105,
      mismatch: false,
    });
  });

  it("all three supplied but inconsistent are left unchanged and flagged", () => {
    expect(r({ subtotal: 100, vatAmount: 5, total: 120, vatPercentage: 5 })).toEqual({
      subtotal: 100,
      vatAmount: 5,
      total: 120,
      mismatch: true,
    });
  });

  it("supplied VAT >= total: subtotal falls back to net-of-gross and the set is flagged", () => {
    const out = r({ subtotal: 0, vatAmount: 120, total: 100, vatPercentage: 5 });
    expect(out.subtotal).toBe(95.24);
    expect(out.vatAmount).toBe(120);
    expect(out.total).toBe(100);
    expect(out.mismatch).toBe(true);
  });

  it("rounds inputs with more than 2 decimals half-up (10.005 -> 10.01)", () => {
    expect(r({ subtotal: 10.005, vatAmount: 0, total: 0, vatPercentage: 0 }).subtotal).toBe(10.01);
  });

  it("negative amounts (refunds / credit notes) are treated as missing", () => {
    expect(r({ subtotal: -100, vatAmount: -5, total: -105, vatPercentage: 5 })).toEqual({
      subtotal: 0,
      vatAmount: 0,
      total: 0,
      mismatch: false,
    });
  });
});

describe("parseReceiptOcrText amounts", () => {
  it("Subtotal 100 / Total 100 with no VAT line gives VAT 0 and no AMOUNT_MISMATCH", () => {
    const p = parseReceiptOcrText("Cafe\nSubtotal AED 100.00\nTotal AED 100.00");
    expect([p.subtotal, p.vatAmount, p.total]).toEqual([100, 0, 100]);
    expect(p.validationIssues).toEqual([]);
    expect(p.reviewReasonCodes).toEqual([]);
  });

  it("a 100 / 115.50 receipt surfaces AMOUNT_MISMATCH matching the pre-filled figures", () => {
    const p = parseReceiptOcrText("Cafe\nSubtotal AED 100.00\nTotal AED 115.50");
    expect([p.subtotal, p.vatAmount, p.total]).toEqual([100, 5, 115.5]);
    expect(p.validationIssues.map((i) => i.code)).toEqual(["AMOUNT_MISMATCH"]);
    expect(p.reviewReasonCodes).toContain("AMOUNT_MISMATCH");
    expect(p.reviewReasons.join(" ")).toMatch(
      /Subtotal 100\.00 \+ VAT 5\.00 does not equal total 115\.50/
    );
    expect(p.confidenceBand).not.toBe("high");
  });

  it("a 100 / 95 receipt (discount) pre-fills VAT 0 and flags the mismatch", () => {
    const p = parseReceiptOcrText("Cafe\nSubtotal AED 100.00\nTotal AED 95.00");
    expect([p.subtotal, p.vatAmount, p.total]).toEqual([100, 0, 95]);
    expect(p.reviewReasonCodes).toContain("AMOUNT_MISMATCH");
  });

  it("the review-note catalog key for AMOUNT_MISMATCH exists in en and ar", async () => {
    const en = (await import("../../client/src/locales/en/pageLabels.json")).default as Record<
      string,
      string
    >;
    const ar = (await import("../../client/src/locales/ar/pageLabels.json")).default as Record<
      string,
      string
    >;
    expect(en["pageLabels.receiptIssueAmounts"]).toBeTruthy();
    expect(ar["pageLabels.receiptIssueAmounts"]).toBeTruthy();
  });

  it("total-only receipt reconciles to the fil", () => {
    const r = parseReceiptOcrText("Shop\nTotal AED 10.01", { fallbackDate: "2026-06-29" });
    expect(f(r.subtotal) + f(r.vatAmount)).toBe(f(r.total));
    expect(r.total).toBe(10.01);
  });
});

describe("amountMismatchMessage / vatDerivedMessage wording", () => {
  it("formats amounts to 2 decimals (115.5 -> 115.50)", () => {
    expect(amountMismatchMessage(100, 5, 115.5, 5)).toMatch(
      /^Subtotal 100\.00 \+ VAT 5\.00 does not equal total 115\.50\./
    );
  });

  it("does not claim there is no VAT line when a VAT figure was read", () => {
    const m = amountMismatchMessage(100, 7, 120, 5, true);
    expect(m).not.toMatch(/no VAT line/);
    expect(m).toMatch(/Check all three figures/);
  });

  it("uses natural zero-rated wording at 0%", () => {
    const m = amountMismatchMessage(100, 0, 110, 0);
    expect(m).toMatch(/zero-rated, so the total should equal the subtotal/);
    expect(m).not.toMatch(/0% VAT/);
  });

  it("flags a derived VAT only for a subtotal-only input", () => {
    const base = { subtotal: 100, vatAmount: 0, total: 0, vatPercentage: 5 };
    expect(isVatDerived(base)).toBe(true);
    expect(isVatDerived({ ...base, total: 105 })).toBe(false);
    expect(isVatDerived({ ...base, vatAmount: 5 })).toBe(false);
    expect(isVatDerived({ ...base, vatPercentage: 0 })).toBe(false);
    expect(vatDerivedMessage(5, 5)).toMatch(/VAT 5\.00 was calculated at 5%/);
  });

  it("the parser path never derives VAT from a subtotal alone (its total falls back to the subtotal)", () => {
    const p = parseReceiptOcrText("Cafe\nSubtotal AED 100.00");
    expect([p.subtotal, p.vatAmount, p.total]).toEqual([100, 0, 100]);
    expect(p.validationIssues.map((i) => i.code)).not.toContain("VAT_DERIVED");
  });

  it("the VAT_DERIVED review-note catalog key exists in en and ar", async () => {
    const en = (await import("../../client/src/locales/en/pageLabels.json")).default as Record<
      string,
      string
    >;
    const ar = (await import("../../client/src/locales/ar/pageLabels.json")).default as Record<
      string,
      string
    >;
    expect(en["pageLabels.receiptIssueVatDerived"]).toBeTruthy();
    expect(ar["pageLabels.receiptIssueVatDerived"]).toBeTruthy();
  });
});
