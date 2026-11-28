/** W4-B pure depreciation schedule: R10-04 (non-depreciable), R10-12 (fixed straight line). */
import { describe, expect, it } from "vitest";
import {
  depreciationFor,
  disposalSplit,
  scheduleTo,
  type AssetCalcInput,
} from "../../server/services/fixed-assets/calc";

const laptop: AssetCalcInput = {
  costFils: 1_200_000,
  salvageFils: 0,
  usefulLifeYears: 5,
  method: "straight_line",
  purchaseDate: "2026-01-15",
  accumulatedFils: 0,
  isDepreciable: true,
};

describe("fixed-asset depreciation schedule", () => {
  it("[R10-12] straight line: prorated first month, equal months after, last month takes the remainder", () => {
    const s = scheduleTo(laptop, 2031, 12);
    expect(s.months[0].amountFils).toBe(10_968); // 200 × 17/31
    expect(new Set(s.months.slice(1, -1).map((m) => m.amountFils))).toEqual(new Set([20_000]));
    expect(s.accumulatedFils).toBe(1_200_000);
    expect(s.months).toHaveLength(61);
    expect(s.months[60]).toMatchObject({ year: 2031, month: 1, amountFils: 20_000 - 10_968 });
  });

  it("[R10-12] a life that does not divide evenly still totals the exact depreciable base", () => {
    const s = scheduleTo(
      { ...laptop, costFils: 100_000, usefulLifeYears: 3, purchaseDate: "2026-01-01" },
      2030,
      12
    );
    expect(s.months).toHaveLength(36);
    expect(s.months[0].amountFils).toBe(2_778);
    expect(s.accumulatedFils).toBe(100_000);
  });

  it("[R10-04] land never depreciates, with or without a useful life", () => {
    const land = { ...laptop, isDepreciable: false, usefulLifeYears: null };
    expect(depreciationFor(land, 2026, 3)).toMatchObject({
      skipped: true,
      skipReason: "NON_DEPRECIABLE",
    });
    expect(scheduleTo(land, 2030, 1).accumulatedFils).toBe(0);
  });

  it("declining balance: NBV × 2 / life / 12 (10,000 over 5 years → 333.33 then 322.22)", () => {
    const truck = {
      ...laptop,
      costFils: 1_000_000,
      method: "declining_balance",
      purchaseDate: "2026-01-01",
    };
    const s = scheduleTo(truck, 2026, 2);
    expect(s.months.map((m) => m.amountFils)).toEqual([33_333, 32_222]);
  });

  it("[R10-08] disposal split: 5% VAT on proceeds, gain/loss against NBV", () => {
    expect(
      disposalSplit({
        proceedsFils: 900_000,
        vatRate: 5,
        costFils: 1_200_000,
        revaluationFils: 0,
        accumulatedFils: 50_968,
        impairmentFils: 0,
      })
    ).toEqual({ vatFils: 45_000, nbvFils: 1_149_032, gainLossFils: -249_032 });
  });
});
