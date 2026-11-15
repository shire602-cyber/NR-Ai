import { describe, it, expect } from "vitest";
import { computeCtLiability, computeCtComputation } from "../../shared/ct-workpaper";

describe("computeCtLiability delegates to computeCtComputation (A-B7)", () => {
  it("matches the full computation for simple profit inputs", () => {
    const simple = computeCtLiability({ totalRevenue: 770000, totalExpenses: 270000 });
    const full = computeCtComputation({ totalRevenue: 770000, totalExpenses: 270000 });
    expect(simple.taxableAmount).toBe(full.taxableAmount);
    expect(simple.taxPayable).toBe(full.taxPayable);
    expect(simple.taxableAmount).toBe(125000);
    expect(simple.taxPayable).toBe(11250);
  });

  it("returns zero tax below the AED 375k band", () => {
    expect(computeCtLiability({ totalRevenue: 570000, totalExpenses: 270000 }).taxPayable).toBe(0);
  });

  it("floors taxable income at zero in a loss period (not negative)", () => {
    const loss = computeCtLiability({ totalRevenue: 100000, totalExpenses: 250000 });
    expect(loss.taxableIncome).toBe(0);
    expect(loss.taxPayable).toBe(0);
  });
});

describe("Small Business Relief prior-period rule (A-B16)", () => {
  const base = {
    totalRevenue: 2_000_000,
    totalExpenses: 1_000_000,
    smallBusinessReliefElected: true,
  };

  it("grants relief when within the cap and no prior breach", () => {
    const r = computeCtComputation({ ...base });
    expect(r.smallBusinessRelief.applied).toBe(true);
    expect(r.taxPayable).toBe(0);
  });

  it("denies relief if a prior period exceeded the cap", () => {
    const r = computeCtComputation({ ...base, priorPeriodsExceededRevenueCap: true });
    expect(r.smallBusinessRelief.applied).toBe(false);
    // Now taxable: 1,000,000 profit - 375,000 band = 625,000 @ 9%.
    expect(r.taxPayable).toBe(56250);
  });

  it("denies relief if current revenue exceeds the cap", () => {
    const r = computeCtComputation({
      ...base,
      totalRevenue: 4_000_000,
      totalExpenses: 1_000_000,
    });
    expect(r.smallBusinessRelief.applied).toBe(false);
  });
});
