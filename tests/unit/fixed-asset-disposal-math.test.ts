import { describe, it, expect } from "vitest";
import { disposalMonthCharge, disposalVat, invoicedDisposalLines, planDisposalDepreciation } from "../../server/services/fixed-asset-disposal-math";

const forklift = { category: "equipment", purchase_cost: 36000, salvage_value: 0, useful_life_years: 3, depreciation_method: "straight_line", purchase_date: new Date("2026-06-01T00:00:00Z") };

describe("disposal depreciation: pro rata by days in the disposal month", () => {
  it("15 September (30 days) charges half the month: 500 of 1,000", () => {
    expect(disposalMonthCharge(forklift, 3000, 2026, 9, 15)).toEqual({ charge: 500, fraction: 0.5 });
  });
  it("the last day of the month charges the whole month", () => {
    expect(disposalMonthCharge(forklift, 3000, 2026, 9, 30).charge).toBe(1000);
  });
  it("the acquisition month counts from the acquisition day", () => {
    const a = { ...forklift, purchase_cost: 12000, useful_life_years: 1, purchase_date: new Date("2026-09-11T00:00:00Z") };
    // 10 of the 20 days held: 1,000 x 20/30 (month charge) x 10/20
    expect(disposalMonthCharge(a, 0, 2026, 9, 20).charge).toBeCloseTo(333.33, 1);
  });
  it("land never depreciates", () => {
    expect(disposalMonthCharge({ ...forklift, category: "land" }, 0, 2026, 9, 15).charge).toBe(0);
  });
});

describe("planDisposalDepreciation", () => {
  const rows = [6, 7, 8, 9].map((m) => ({ year: 2026, month: m, amount: 1000 }));
  it("a full disposal month already posted: the other half is excess to reverse", () => {
    const plan = planDisposalDepreciation(forklift, rows, { year: 2026, month: 9, day: 15 });
    expect(plan.excess).toBe(500);
    expect(plan.accumulatedAtDisposal).toBe(3500);
    expect(plan.accumulatedPosted).toBe(4000);
    expect(plan.missingMonths).toEqual([]);
  });
  it("months after the disposal month are all excess", () => {
    const plan = planDisposalDepreciation(forklift, [...rows, { year: 2026, month: 10, amount: 1000 }], { year: 2026, month: 9, day: 15 });
    expect(plan.excess).toBe(1500);
    expect(plan.laterMonths).toHaveLength(1);
  });
  it("nothing posted: three months in full plus the part month", () => {
    const plan = planDisposalDepreciation(forklift, [], { year: 2026, month: 9, day: 15 });
    expect(plan.missingMonths.map((m) => m.month)).toEqual([6, 7, 8]);
    expect(plan.accumulatedAtDisposal).toBe(3500);
    expect(plan.excess).toBe(0);
  });
});

describe("VAT on a disposal and its journal", () => {
  it("standard-rated: 5% on the price without VAT", () => {
    expect(disposalVat(40000, "standard")).toEqual({ vatAmount: 2000, total: 42000 });
    expect(disposalVat(40000, "zero_rated")).toEqual({ vatAmount: 0, total: 40000 });
    expect(disposalVat(40000, "none").vatAmount).toBe(0);
  });
  it("invoiced: 4080 is debited by the book value so the gain stays in it; a loss goes to its own account", () => {
    expect(invoicedDisposalLines(36000, 3500, 40000)).toEqual({ nbv: 32500, against4080: 32500, loss: 0, gainLoss: 7500 });
    expect(invoicedDisposalLines(36000, 3500, 10000)).toEqual({ nbv: 32500, against4080: 10000, loss: 22500, gainLoss: -22500 });
    expect(invoicedDisposalLines(1000, 1000, 500)).toEqual({ nbv: 0, against4080: 0, loss: 0, gainLoss: 500 });
  });
});
