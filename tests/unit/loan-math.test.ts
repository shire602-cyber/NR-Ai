import { describe, it, expect } from "vitest";
import { allocateRunDeductions, buildLoanSchedule, instalmentCapProblem, maxInstalment, remainingBalance } from "../../server/services/loan-math";

describe("maxInstalment", () => {
  it("is 20 % of the monthly wage (basic and all allowances)", () => {
    expect(maxInstalment(6000)).toBe(1200);
    expect(maxInstalment(9999.99)).toBe(2000);
  });
});

describe("buildLoanSchedule", () => {
  it("equal instalments, one per month from the first period, rolling over the year end", () => {
    const s = buildLoanSchedule({ principal: 12000, count: 10, firstYear: 2026, firstMonth: 11 });
    expect(s).toHaveLength(10);
    expect(s[0]).toEqual({ sequence: 1, periodYear: 2026, periodMonth: 11, amount: 1200 });
    expect(s[2]).toMatchObject({ periodYear: 2027, periodMonth: 1 });
    expect(s[9]).toMatchObject({ periodYear: 2027, periodMonth: 8 });
  });

  it("the last instalment absorbs rounding so the schedule adds up to the principal exactly", () => {
    const s = buildLoanSchedule({ principal: 1000, count: 3, firstYear: 2026, firstMonth: 1 });
    expect(s.map((i) => i.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(s.reduce((sum, i) => sum + i.amount, 0)).toBeCloseTo(1000, 10);
  });
});

describe("instalmentCapProblem (D2-8)", () => {
  it("12,000 over 6 months is 2,000 against a 1,200 cap; over 10 months it fits", () => {
    expect(instalmentCapProblem(buildLoanSchedule({ principal: 12000, count: 6, firstYear: 2026, firstMonth: 1 }), 6000)).toEqual({ maxInstalment: 1200 });
    expect(instalmentCapProblem(buildLoanSchedule({ principal: 12000, count: 10, firstYear: 2026, firstMonth: 1 }), 6000)).toBeNull();
  });
});

describe("allocateRunDeductions (loan + general deductions <= 50 % of gross)", () => {
  const due = [
    { id: "a", sequence: 1, amount: 1200 },
    { id: "b", sequence: 2, amount: 1200 },
  ];
  it("takes every due instalment when the cap allows", () => {
    const r = allocateRunDeductions({ due, grossPay: 6000, generalDeductions: 0 });
    expect(r.take).toEqual([{ id: "a", amount: 1200, deferred: 0 }, { id: "b", amount: 1200, deferred: 0 }]);
    expect(r.total).toBe(2400);
  });
  it("splits the instalment that crosses the cap and defers the excess", () => {
    const r = allocateRunDeductions({ due, grossPay: 4000, generalDeductions: 500 });
    // allowance = 2000 - 500 = 1500: a in full, b only 300
    expect(r.take).toEqual([{ id: "a", amount: 1200, deferred: 0 }, { id: "b", amount: 300, deferred: 900 }]);
    expect(r.total).toBe(1500);
    expect(r.deferredTotal).toBe(900);
  });
  it("defers whole instalments when general deductions use the allowance up", () => {
    const r = allocateRunDeductions({ due, grossPay: 2000, generalDeductions: 1000 });
    expect(r.take).toEqual([{ id: "a", amount: 0, deferred: 1200 }, { id: "b", amount: 0, deferred: 1200 }]);
    expect(r.total).toBe(0);
  });
});

describe("the 20 % cap covers every loan of the employee", () => {
  it("other loans' instalments in the same months use up the room", () => {
    const s = buildLoanSchedule({ principal: 1200, count: 12, firstYear: 2026, firstMonth: 1 });
    const committed = new Map([[2026 * 12 + 1, 1200]]);
    expect(instalmentCapProblem(s, 6000, committed)).toEqual({ maxInstalment: 0 });
    expect(instalmentCapProblem(s, 6000, new Map([[2026 * 12 + 1, 1150]]))).toEqual({ maxInstalment: 50 });
    expect(instalmentCapProblem(s, 6000, new Map([[2030 * 12 + 1, 1200]]))).toBeNull();
  });
  it("a run takes at most 20 % of the wage from all loans together", () => {
    const due = [{ id: "a", sequence: 1, amount: 1000 }, { id: "b", sequence: 2, amount: 1000 }];
    const r = allocateRunDeductions({ due, grossPay: 6000, generalDeductions: 0, monthlyWage: 6000 });
    expect(r.total).toBe(1200);
    expect(r.take).toEqual([{ id: "a", amount: 1000, deferred: 0 }, { id: "b", amount: 200, deferred: 800 }]);
  });
});

describe("remainingBalance", () => {
  it("is the sum of the instalments not yet deducted or settled", () => {
    expect(remainingBalance([{ amount: 100, status: "deducted" }, { amount: 100, status: "scheduled" }, { amount: 50, status: "reserved" }, { amount: 20, status: "cancelled" }])).toBe(150);
  });
});
