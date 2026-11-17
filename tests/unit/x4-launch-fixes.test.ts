/**
 * X4 launch fixes (end-to-end journey J3): pure rules behind the payroll, budget, fiscal-year,
 * WPS and corporate-tax fixes. Route / ledger behaviour is in tests/db/x4-launch-fixes.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  fiscalYearContaining,
  fiscalYearEndingIn,
  fiscalYearStartingIn,
} from "../../client/src/lib/fiscal-year";
import { summariseBudget } from "../../client/src/lib/budget-summary";
import { employedDaysInPeriod, prorateWages } from "../../server/services/payroll/calc";
import { sifLeaveDays } from "../../server/services/payroll/wps";
import { transitionCtReturnSchema } from "../../shared/validators/corporate-tax";
import { createFixedAssetBody } from "../../shared/validators/fixed-assets";
import { employeeCreateSchema } from "../../shared/validators/payroll";

describe("[X4][J3] company fiscal year defaults (budget, corporate tax)", () => {
  it("a November-start company's fiscal year runs 1 Nov - 31 Oct", () => {
    expect(fiscalYearContaining(11, new Date(2026, 10, 17))).toEqual({
      start: "2026-11-01",
      end: "2027-10-31",
      fiscalYear: 2027,
    });
    expect(fiscalYearContaining(11, new Date(2026, 9, 31))).toEqual({
      start: "2025-11-01",
      end: "2026-10-31",
      fiscalYear: 2026,
    });
  });
  it("a calendar-year company keeps 1 Jan - 31 Dec; bad input falls back to January", () => {
    expect(fiscalYearContaining(1, new Date(2026, 5, 1))).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
      fiscalYear: 2026,
    });
    expect(fiscalYearContaining(undefined, new Date(2026, 5, 1)).start).toBe("2026-01-01");
    expect(fiscalYearStartingIn(3, 2024).end).toBe("2025-02-28");
    expect(fiscalYearEndingIn(4, 2026)).toMatchObject({ start: "2025-04-01", end: "2026-03-31" });
  });
});

describe("[X4][J3] budget summary keeps income and expense apart", () => {
  const lines = [
    { accountType: "income", totals: { budget: 100_000, actual: 110_000 } },
    { accountType: "expense", totals: { budget: 62_500, actual: 52_456.66 } },
  ];
  it("never adds income and expense budgets together; net and variance signs are coherent", () => {
    const s = summariseBudget(lines);
    expect(s.income).toEqual({ budget: 100_000, actual: 110_000, variance: 10_000 });
    // Expense under budget is favourable (positive).
    expect(s.expense).toEqual({ budget: 62_500, actual: 52_456.66, variance: 10_043.34 });
    expect(s.net).toEqual({ budget: 37_500, actual: 57_543.34, variance: 20_043.34 });
    expect(s.net.variance).toBeCloseTo(s.income.variance + s.expense.variance, 2);
  });
  it("an expense over budget and income under budget are unfavourable (negative)", () => {
    const s = summariseBudget([
      { accountType: "income", totals: { budget: 100, actual: 80 } },
      { accountType: "expense", totals: { budget: 50, actual: 70 } },
    ]);
    expect(s.income.variance).toBe(-20);
    expect(s.expense.variance).toBe(-20);
    expect(s.net.variance).toBe(-40);
  });
});

describe("[X4][J3] terminated employee's final partial month", () => {
  it("counts employed days inside the period, inclusive of the termination day", () => {
    expect(employedDaysInPeriod("2026-10-01", "2026-10-31", "2018-01-01", "2026-10-15")).toEqual({
      employedDays: 15,
      monthDays: 31,
    });
    expect(employedDaysInPeriod("2026-10-01", "2026-10-31", "2026-10-20", null)).toEqual({
      employedDays: 12,
      monthDays: 31,
    });
    expect(employedDaysInPeriod("2026-10-01", "2026-10-31", "2018-01-01", null)).toEqual({
      employedDays: 31,
      monthDays: 31,
    });
    expect(
      employedDaysInPeriod("2026-11-01", "2026-11-30", "2018-01-01", "2026-10-15").employedDays
    ).toBe(0);
  });
  it("prorates each fixed component by employed / calendar days; a full month is unchanged", () => {
    const w = { basicFils: 1_000_000, housingFils: 310_000, transportFils: 0, otherFils: 31 };
    expect(prorateWages(w, 15, 31)).toEqual({
      basicFils: 483_871,
      housingFils: 150_000,
      transportFils: 0,
      otherFils: 15,
    });
    expect(prorateWages(w, 31, 31)).toEqual(w);
  });
});

describe("[X4][J3] WPS SIF leave days", () => {
  it("reports unpaid leave only; paid annual leave is fully paid salary", () => {
    expect(sifLeaveDays(0, 5)).toBe(0);
    expect(sifLeaveDays("2", "5")).toBe(2);
  });
});

describe("[X4][J3] record a corporate tax return as filed", () => {
  it("needs the EmaraTax filing reference; the filing date cannot be in the future", () => {
    expect(transitionCtReturnSchema.safeParse({ to: "filed" }).success).toBe(false);
    expect(transitionCtReturnSchema.safeParse({ to: "filed", filingReference: " " }).success).toBe(
      false
    );
    expect(
      transitionCtReturnSchema.safeParse({
        to: "filed",
        filingReference: "FTA-CT-2026-001",
        filedOn: "2026-01-15",
      }).success
    ).toBe(true);
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    expect(
      transitionCtReturnSchema.safeParse({
        to: "filed",
        filingReference: "FTA-CT-2026-001",
        filedOn: future,
      }).success
    ).toBe(false);
    expect(transitionCtReturnSchema.safeParse({ to: "paid" }).success).toBe(true);
  });
});

describe("[X4][J3] fixed asset input VAT and opening gratuity provision contracts", () => {
  const asset = {
    assetName: "Van",
    category: "Vehicles",
    purchaseDate: "2026-10-10",
    purchaseCost: 50000,
    usefulLifeYears: 5,
  };
  it("input VAT needs the payment account it was paid from", () => {
    expect(createFixedAssetBody.safeParse({ ...asset, inputVat: 2500 }).success).toBe(false);
    expect(
      createFixedAssetBody.safeParse({
        ...asset,
        inputVat: 2500,
        paymentAccountId: "a0000000-0000-4000-8000-000000000102",
      }).success
    ).toBe(true);
  });
  it("an employee can carry the gratuity provision booked before go-live", () => {
    const r = employeeCreateSchema.safeParse({ fullName: "A", openingGratuityProvision: "1500" });
    expect(r.success).toBe(true);
  });
});
