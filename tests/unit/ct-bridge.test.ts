/**
 * Deterministic UAE CT fixtures for the full taxable-profit bridge
 * (Federal Decree-Law 47 of 2022). Every adjustment in the schedule is
 * explained by a bridge line — the acceptance bar from the development plan.
 */
import { describe, expect, it } from "vitest";

import {
  CT_LOSS_OFFSET_LIMIT,
  CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP,
  computeCtComputation,
  type CtBridgeAdjustment,
} from "../../shared/ct-workpaper";

const adj = (
  category: CtBridgeAdjustment["category"],
  amount: number,
  extra: Partial<CtBridgeAdjustment> = {}
): CtBridgeAdjustment => ({ id: `${category}-${amount}`, category, amount, ...extra });

describe("disallowable expense add-backs", () => {
  it("builds the bridge: accounting profit + add-backs − deductions", () => {
    const r = computeCtComputation({
      totalRevenue: 1_000_000,
      totalExpenses: 700_000,
      adjustments: [
        adj("entertainment_50", 20_000),
        adj("fines_penalties", 5_000),
        adj("exempt_income", 50_000),
      ],
    });

    expect(r.accountingProfit).toBe(300_000);
    expect(r.totalAddBacks).toBe(25_000);
    expect(r.totalDeductions).toBe(50_000);
    expect(r.adjustedTaxableIncome).toBe(275_000);
    // Below the 375k band → no tax.
    expect(r.taxPayable).toBe(0);

    // Every adjustment appears as a labelled bridge line.
    const labels = r.bridge.map((l) => l.label);
    expect(labels).toContain("Client entertainment (50% disallowed)");
    expect(labels).toContain("Fines and penalties");
    expect(labels).toContain("Exempt income (participation/foreign PE)");
    const entertainment = r.bridge.find((l) => l.label.startsWith("Client entertainment"));
    expect(entertainment?.amount).toBe(20_000);
    const exempt = r.bridge.find((l) => l.label.startsWith("Exempt income"));
    expect(exempt?.amount).toBe(-50_000);
  });

  it("computes 9% above the 375k band after add-backs", () => {
    const r = computeCtComputation({
      totalRevenue: 2_000_000,
      totalExpenses: 1_500_000,
      adjustments: [adj("owner_drawings", 75_000)],
    });
    // 500k + 75k = 575k adjusted; 575k − 375k = 200k @ 9% = 18k
    expect(r.adjustedTaxableIncome).toBe(575_000);
    expect(r.taxableAmount).toBe(200_000);
    expect(r.taxPayable).toBe(18_000);
  });
});

describe("small business relief (Art. 21)", () => {
  it("elected + revenue within AED 3M → taxable income nil, no tax", () => {
    const r = computeCtComputation({
      totalRevenue: 2_900_000,
      totalExpenses: 1_000_000,
      smallBusinessReliefElected: true,
    });
    expect(r.smallBusinessRelief).toEqual({
      elected: true,
      eligible: true,
      applied: true,
      revenueCap: CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP,
    });
    expect(r.taxableIncome).toBe(0);
    expect(r.taxPayable).toBe(0);
    expect(r.bridge.some((l) => l.label.includes("Small business relief"))).toBe(true);
  });

  it("elected but revenue above the cap → relief NOT applied, tax computed normally", () => {
    const r = computeCtComputation({
      totalRevenue: 3_000_001,
      totalExpenses: 1_000_000,
      smallBusinessReliefElected: true,
    });
    expect(r.smallBusinessRelief.applied).toBe(false);
    expect(r.smallBusinessRelief.eligible).toBe(false);
    expect(r.taxPayable).toBeGreaterThan(0);
  });

  it("losses neither relieve nor accrue while relief is claimed", () => {
    const r = computeCtComputation({
      totalRevenue: 1_000_000,
      totalExpenses: 200_000,
      lossBroughtForward: 300_000,
      smallBusinessReliefElected: true,
    });
    expect(r.lossReliefApplied).toBe(0);
    expect(r.lossCarriedForward).toBe(300_000); // pool preserved untouched
  });
});

describe("loss carryforward (Art. 37, 75% cap)", () => {
  it("offsets at most 75% of taxable income and carries the rest", () => {
    const r = computeCtComputation({
      totalRevenue: 2_000_000,
      totalExpenses: 1_000_000, // adjusted income 1,000,000
      lossBroughtForward: 900_000,
    });
    expect(r.lossReliefApplied).toBe(750_000); // capped at 75% of 1M
    expect(r.taxableIncome).toBe(250_000);
    expect(r.lossCarriedForward).toBe(150_000);
    // 250k < 375k band → zero tax despite positive taxable income.
    expect(r.taxPayable).toBe(0);
    expect(CT_LOSS_OFFSET_LIMIT).toBe(0.75);
  });

  it("uses the full pool when it is smaller than the cap", () => {
    const r = computeCtComputation({
      totalRevenue: 2_000_000,
      totalExpenses: 1_000_000,
      lossBroughtForward: 100_000,
    });
    expect(r.lossReliefApplied).toBe(100_000);
    expect(r.taxableIncome).toBe(900_000);
    expect(r.lossCarriedForward).toBe(0);
    expect(r.taxPayable).toBe(47_250); // (900k − 375k) × 9%
  });

  it("a loss year adds to the carryforward pool", () => {
    const r = computeCtComputation({
      totalRevenue: 500_000,
      totalExpenses: 800_000,
      lossBroughtForward: 50_000,
    });
    expect(r.taxableIncome).toBe(0);
    expect(r.taxPayable).toBe(0);
    expect(r.lossCarriedForward).toBe(350_000); // 50k pool + 300k new loss
  });
});

describe("determinism", () => {
  it("identical fixtures produce identical schedules", () => {
    const fixture = {
      totalRevenue: 4_000_000,
      totalExpenses: 3_100_000,
      adjustments: [adj("related_party_excess", 120_000), adj("unrealized_gains", 40_000)],
      lossBroughtForward: 200_000,
    };
    const a = computeCtComputation(fixture);
    const b = computeCtComputation(fixture);
    expect(a).toEqual(b);
    // Full chain: 900k + 120k − 40k = 980k; loss relief min(200k, 735k) = 200k;
    // taxable 780k; (780k − 375k) × 9% = 36,450.
    expect(a.taxableIncome).toBe(780_000);
    expect(a.taxPayable).toBe(36_450);
    expect(a.lossCarriedForward).toBe(0);
  });
});
