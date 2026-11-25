/**
 * W4-A pure rules: QFZP de minimis truth table (R08-15), general interest
 * deduction limitation (R08-16), transfer-pricing thresholds (R08-17),
 * adjustment validation (R08-06/07), SBR sunset (R08-14) and deadline maths
 * for month-end dates (R08-03).
 */
import { describe, expect, it } from "vitest";
import {
  CT_INTEREST_SAFE_HARBOUR,
  adjustmentEffect,
  computeCtComputation,
  computeInterestLimitation,
  qfzpDeMinimis,
  sbrAvailableForPeriodEnd,
  transferPricingFlags,
  type CtBridgeAdjustment,
} from "../../shared/ct-workpaper";
import { ctAdjustmentSchema, createCtReturnSchema } from "../../shared/validators/corporate-tax";
import {
  addMonthsClamped,
  ctFilingDeadline,
  ctPeriodsDueInYear,
  vatFilingDeadline,
  vatPeriodsDueInYear,
} from "../../server/services/corporate-tax/deadlines";

describe("[R08-15] QFZP de minimis truth table", () => {
  it.each([
    // qualifying, non-qualifying, passes
    [1_000_000, 0, true],
    [950_000, 50_000, true], // exactly 5%
    [949_999, 50_001, false], // just above 5%
    [200_000_000, 5_000_000, true], // 2.44%, exactly AED 5M
    [200_000_000, 5_000_001, false], // above AED 5M although under 5%
    [0, 0, true],
    [0, 10, false],
  ])("qualifying %d / non-qualifying %d → passes=%s", (q, n, passes) => {
    expect(qfzpDeMinimis(q, n).passed).toBe(passes);
  });

  it("0% on qualifying and 9% on non-qualifying income when the test passes (no 375k band)", () => {
    const r = computeCtComputation({
      totalRevenue: 2_000_000,
      totalExpenses: 1_000_000,
      qfzp: { elected: true, qualifyingRevenue: 1_900_000, nonQualifyingRevenue: 100_000 },
    });
    expect(r.qfzp?.deMinimisPassed).toBe(true);
    expect(r.qfzp?.nonQualifyingTaxableIncome).toBe(50_000);
    expect(r.taxableAmount).toBe(50_000);
    expect(r.taxPayable).toBe(4_500);
    expect(r.bridge.some((l) => l.key === "zero_band")).toBe(false);
  });

  it("fails → status lost, all taxable income under the standard 9% regime, consequence shown", () => {
    const r = computeCtComputation({
      totalRevenue: 2_000_000,
      totalExpenses: 1_000_000,
      qfzp: { elected: true, qualifyingRevenue: 1_800_000, nonQualifyingRevenue: 200_000 },
    });
    const standard = computeCtComputation({ totalRevenue: 2_000_000, totalExpenses: 1_000_000 });
    expect(r.qfzp?.statusLost).toBe(true);
    expect(r.qfzp?.consequence).toMatch(/status is lost/);
    expect(r.qfzp?.consequenceAr.length).toBeGreaterThan(10);
    expect(r.taxPayable).toBe(standard.taxPayable);
  });

  it("a QFZP cannot claim Small Business Relief", () => {
    const r = computeCtComputation({
      totalRevenue: 1_000_000,
      totalExpenses: 100_000,
      smallBusinessReliefElected: true,
      qfzp: { elected: true, qualifyingRevenue: 1_000_000, nonQualifyingRevenue: 0 },
    });
    expect(r.smallBusinessRelief.applied).toBe(false);
    expect(r.smallBusinessRelief.ineligibleReason).toBe("qfzp");
  });
});

describe("[R08-16] interest limitation", () => {
  it("net interest within the AED 12M safe harbour is fully deductible", () => {
    const r = computeInterestLimitation(1_000_000, { netInterestExpense: 11_000_000 });
    expect(r.capacity).toBe(CT_INTEREST_SAFE_HARBOUR);
    expect(r.disallowed).toBe(0);
  });

  it("above the greater of 30% EBITDA and 12M is disallowed and carried forward", () => {
    // EBITDA = 50M + 30M + 20M = 100M → cap 30M; 30M interest → nothing disallowed.
    const atCap = computeInterestLimitation(50_000_000, {
      netInterestExpense: 30_000_000,
      depreciationAmortisation: 20_000_000,
    });
    expect(atCap.taxEbitda).toBe(100_000_000);
    expect(atCap.capacity).toBe(30_000_000);
    expect(atCap.disallowed).toBe(0);
    // EBITDA = 10M + 40M = 50M → 30% = 15M; 40M interest → 25M disallowed.
    const over = computeInterestLimitation(10_000_000, { netInterestExpense: 40_000_000 });
    expect(over.capacity).toBe(15_000_000);
    expect(over.disallowed).toBe(25_000_000);
    expect(over.carriedForwardOut).toBe(25_000_000);
  });

  it("spare capacity absorbs interest carried forward from earlier periods", () => {
    const r = computeInterestLimitation(5_000_000, {
      netInterestExpense: 2_000_000,
      carriedForwardIn: 15_000_000,
    });
    // capacity 12M, current 2M → 10M spare used from the 15M pool.
    expect(r.carriedForwardUtilised).toBe(10_000_000);
    expect(r.carriedForwardOut).toBe(5_000_000);
    const full = computeCtComputation({
      totalRevenue: 20_000_000,
      totalExpenses: 15_000_000,
      interest: { netInterestExpense: 2_000_000, carriedForwardIn: 15_000_000 },
    });
    expect(full.adjustedTaxableIncome).toBe(-5_000_000);
  });

  it("net interest income is never limited", () => {
    const r = computeInterestLimitation(1_000_000, { netInterestExpense: -500_000 });
    expect(r.disallowed).toBe(0);
  });
});

describe("[R08-17] transfer-pricing thresholds", () => {
  it("disclosure above AED 40M related-party transactions; Master/Local File at 200M revenue or 3.15bn group", () => {
    expect(
      transferPricingFlags({ relatedPartyTransactionsTotal: 40_000_000, revenue: 0 })
    ).toMatchObject({ disclosureFormRequired: false, masterLocalFileRequired: false });
    expect(
      transferPricingFlags({ relatedPartyTransactionsTotal: 40_000_001, revenue: 0 })
        .disclosureFormRequired
    ).toBe(true);
    expect(
      transferPricingFlags({ relatedPartyTransactionsTotal: 0, revenue: 200_000_000 })
        .masterLocalFileRequired
    ).toBe(true);
    expect(
      transferPricingFlags({
        relatedPartyTransactionsTotal: 0,
        revenue: 1,
        mneGroupRevenue: 3_150_000_000,
      }).masterLocalFileRequired
    ).toBe(true);
  });
});

describe("[R08-06][R08-07] adjustment validation and the 50% entertainment rule", () => {
  it("rejects unknown categories, non-numeric and negative amounts", () => {
    expect(ctAdjustmentSchema.safeParse({ id: "a", category: "bogus", amount: 1 }).success).toBe(
      false
    );
    expect(
      ctAdjustmentSchema.safeParse({ id: "a", category: "fines_penalties", amount: "abc" }).success
    ).toBe(false);
    expect(
      ctAdjustmentSchema.safeParse({ id: "a", category: "fines_penalties", amount: -1 }).success
    ).toBe(false);
    expect(() =>
      adjustmentEffect({ category: "bogus" as CtBridgeAdjustment["category"], amount: 1 })
    ).toThrow();
  });

  it("entertainment 100,000 → +50,000; exempt income → negative", () => {
    expect(adjustmentEffect({ category: "entertainment_50", amount: 100_000 })).toBe(50_000);
    expect(adjustmentEffect({ category: "exempt_income", amount: 10_000 })).toBe(-10_000);
  });

  it("[R08-09] period must end after it starts and be at most 18 months", () => {
    expect(
      createCtReturnSchema.safeParse({ taxPeriodStart: "2025-12-31", taxPeriodEnd: "2025-01-01" })
        .success
    ).toBe(false);
    expect(
      createCtReturnSchema.safeParse({ taxPeriodStart: "2025-01-01", taxPeriodEnd: "2025-12-31" })
        .success
    ).toBe(true);
    expect(
      createCtReturnSchema.safeParse({
        taxPeriodStart: "2025-01-01",
        taxPeriodEnd: "2025-12-31",
        taxRate: 0.05,
      }).success
    ).toBe(false);
  });
});

describe("[R08-14] SBR sunset", () => {
  it("only for tax periods ending on or before 31 Dec 2026", () => {
    expect(sbrAvailableForPeriodEnd("2026-12-31")).toBe(true);
    expect(sbrAvailableForPeriodEnd("2027-01-31")).toBe(false);
    const r = computeCtComputation({
      totalRevenue: 1_000_000,
      totalExpenses: 400_000,
      smallBusinessReliefElected: true,
      taxPeriodEnd: "2027-06-30",
    });
    expect(r.smallBusinessRelief).toMatchObject({ applied: false, ineligibleReason: "sunset" });
    expect(r.taxPayable).toBe(20_250);
  });
});

describe("[R08-03] deadline maths for month-end dates", () => {
  it.each([
    ["2025-12-31", "2026-09-30"],
    ["2025-06-30", "2026-03-31"],
    ["2025-03-31", "2025-12-31"],
    ["2025-05-31", "2026-02-28"],
    ["2027-05-31", "2028-02-29"],
    ["2025-02-28", "2025-11-30"],
    ["2025-01-15", "2025-10-15"],
  ])("CT period ending %s is due %s", (end, due) => {
    expect(ctFilingDeadline(end)).toBe(due);
  });

  it("clamps non-month-end dates and keeps month-ends", () => {
    expect(addMonthsClamped("2025-01-30", 1)).toBe("2025-02-28");
    expect(addMonthsClamped("2024-02-29", 12)).toBe("2025-02-28");
    expect(addMonthsClamped("2025-11-30", 3)).toBe("2026-02-28");
  });

  it("VAT is due 28 days after the period end; stagger and frequency produce the right periods", () => {
    expect(vatFilingDeadline("2026-03-31")).toBe("2026-04-28");
    expect(vatFilingDeadline("2026-02-28")).toBe("2026-03-28");
    const q1 = vatPeriodsDueInYear("quarterly", 1, 2026).map((p) => p.periodEnd);
    expect(q1).toEqual(["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"]);
    const q2 = vatPeriodsDueInYear("quarterly", 2, 2026).map((p) => p.periodEnd);
    expect(q2).toEqual(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"]);
    expect(vatPeriodsDueInYear("monthly", 1, 2026)).toHaveLength(12);
  });

  it("CT periods follow the fiscal year start month", () => {
    expect(ctPeriodsDueInYear(2026, 1)).toEqual([
      { periodStart: "2025-01-01", periodEnd: "2025-12-31", dueDate: "2026-09-30" },
    ]);
    expect(ctPeriodsDueInYear(2026, 7)).toEqual([
      { periodStart: "2024-07-01", periodEnd: "2025-06-30", dueDate: "2026-03-31" },
    ]);
  });
});
