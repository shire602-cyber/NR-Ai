import { describe, expect, it } from "vitest";
import {
  computeCtComputation,
  ctSmallBusinessReliefAvailability,
  normalizeCtAdjustments,
} from "../../shared/ct-workpaper";

describe("normalizeCtAdjustments", () => {
  it("derives the entertainment add-back as 50% of its base (Art. 32), ignoring a client-supplied amount", () => {
    const r = normalizeCtAdjustments([{ id: "e", category: "entertainment_50", baseAmount: 20000, amount: 1 }]);
    expect(r.ok && r.adjustments[0].amount).toBe(10000);
    expect(r.ok && r.adjustments[0].baseAmount).toBe(20000);
  });
  it("requires a reason for the free-form categories", () => {
    expect(normalizeCtAdjustments([{ id: "o", category: "other_addback", amount: 10 }]).ok).toBe(false);
    expect(normalizeCtAdjustments([{ id: "o", category: "other_addback", amount: 10, notes: "Personal car expenses" }]).ok).toBe(true);
  });
  it("refuses unknown categories, negative amounts and duplicate ids", () => {
    expect(normalizeCtAdjustments([{ id: "a", category: "nope", amount: 1 }]).ok).toBe(false);
    expect(normalizeCtAdjustments([{ id: "a", category: "fines_penalties", amount: -1 }]).ok).toBe(false);
    expect(normalizeCtAdjustments([{ id: "a", category: "fines_penalties", amount: 1 }, { id: "a", category: "fines_penalties", amount: 2 }]).ok).toBe(false);
  });
  it("forces the direction of the category", () => {
    const r = normalizeCtAdjustments([{ id: "c", category: "capital_allowance", amount: 5000, direction: "add" }]);
    expect(r.ok && r.adjustments[0].direction).toBe("deduct");
  });
});

describe("small business relief availability", () => {
  it("is offered up to 3m revenue in a period ending by 31 Dec 2026", () => {
    expect(ctSmallBusinessReliefAvailability({ totalRevenue: 3_000_000, taxPeriodEnd: "2026-12-31" })).toEqual({ available: true });
  });
  it("is not offered above 3m, after a prior breach, or after the sunset", () => {
    expect(ctSmallBusinessReliefAvailability({ totalRevenue: 3_200_000, taxPeriodEnd: "2026-12-31" }).reason).toBe("revenue_cap");
    expect(ctSmallBusinessReliefAvailability({ totalRevenue: 1, priorPeriodsExceededRevenueCap: true }).reason).toBe("prior_period_breach");
    expect(ctSmallBusinessReliefAvailability({ totalRevenue: 1, taxPeriodEnd: "2027-12-31" }).reason).toBe("period_after_sunset");
  });
});

describe("Falcon (teardown t5)", () => {
  it("adds back 50% of 20,000 entertainment: 9% x (1,390,000 - 375,000) = 91,350, not 90,450", () => {
    const without = computeCtComputation({ totalRevenue: 3_200_000, totalExpenses: 1_820_000, taxPeriodEnd: "2026-12-31" });
    expect(without.taxPayable).toBe(90450);
    const n = normalizeCtAdjustments([{ id: "e", category: "entertainment_50", baseAmount: 20000 }]);
    if (!n.ok) throw new Error(n.message);
    const withAddBack = computeCtComputation({ totalRevenue: 3_200_000, totalExpenses: 1_820_000, adjustments: n.adjustments, taxPeriodEnd: "2026-12-31" });
    expect(withAddBack.taxableIncome).toBe(1_390_000);
    expect(withAddBack.taxPayable).toBe(91350);
    expect(withAddBack.bridge.some((l) => /Art\. 3\b/.test(l.label) && /375,000/.test(l.label))).toBe(true);
  });
});
