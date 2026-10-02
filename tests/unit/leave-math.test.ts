import { describe, it, expect } from "vitest";
import {
  accrualRateForServiceMonth,
  completedServiceMonths,
  daysInRange,
  leaveBalance,
  leaveDeduction,
  sickTierSplit,
  spanDays,
} from "../../server/services/leave-math";

const annual = { code: "annual", payPolicy: "full", annualDays: 30, accrual: "monthly_service" as const, carryForwardMaxDays: 0, allowNegative: false };

describe("accrualRateForServiceMonth", () => {
  it("0 in service months 1-6, 2 in months 7-12, 2.5 from month 13 (30 days a year)", () => {
    expect([1, 6].map((k) => accrualRateForServiceMonth(k))).toEqual([0, 0]);
    expect([7, 12].map((k) => accrualRateForServiceMonth(k))).toEqual([2, 2]);
    expect([13, 24, 60].map((k) => accrualRateForServiceMonth(k))).toEqual([2.5, 2.5, 2.5]);
  });
});

describe("service months are earned at the END of the month (teardown: Fatima 2025 = 12 days)", () => {
  it("joined 1 Jan 2025: service months 7-12 earn 2 days each in 2025 = 12", () => {
    const b = leaveBalance({ type: annual, joinYmd: "2025-01-01", asOfYmd: "2025-12-31", takenInYear: () => 0, overrides: new Map() });
    expect(b.accrued).toBe(12);
  });
  it("...and 22.5 more by 30 Sep 2026 (nine months of 2.5), not 25 on 2 Oct", () => {
    const b = leaveBalance({ type: { ...annual, carryForwardMaxDays: 30 }, joinYmd: "2025-01-01", asOfYmd: "2026-10-02", takenInYear: () => 0, overrides: new Map() });
    expect(b.accrued).toBe(22.5);
    expect(b.opening).toBe(12);
    expect(b.balance).toBe(34.5);
  });
});

describe("no invented carry-forward", () => {
  it("nothing carries into the company's first year in the system unless entered", () => {
    const type = { ...annual, carryForwardMaxDays: 30 };
    const base = { type, joinYmd: "2019-04-01", asOfYmd: "2026-09-30", takenInYear: () => 0, trackingStartYear: 2026 };
    expect(leaveBalance({ ...base, overrides: new Map() }).opening).toBe(0);
    expect(leaveBalance({ ...base, overrides: new Map() }).balance).toBe(22.5);
    expect(leaveBalance({ ...base, overrides: new Map([[2026, { opening: 12 }]]) }).balance).toBe(34.5);
  });
  it("later years carry forward as usual", () => {
    const type = { ...annual, carryForwardMaxDays: 30 };
    const b = leaveBalance({ type, joinYmd: "2019-04-01", asOfYmd: "2027-03-31", takenInYear: () => 0, trackingStartYear: 2026, overrides: new Map() });
    expect(b.opening).toBe(30);
  });
});

describe("annual days of the type", () => {
  it("from service month 13 the rate is annualDays / 12 (24 days -> 2)", () => {
    expect(accrualRateForServiceMonth(13, 24)).toBe(2);
    expect(accrualRateForServiceMonth(12, 24)).toBe(2);
    expect(accrualRateForServiceMonth(6, 24)).toBe(0);
  });
});

describe("completedServiceMonths", () => {
  it("counts a month once its day-of-month has come round", () => {
    expect(completedServiceMonths("2024-01-01", "2026-09-30")).toBe(33);
    expect(completedServiceMonths("2024-01-01", "2026-09-29")).toBe(32);
    expect(completedServiceMonths("2024-01-15", "2024-02-13")).toBe(0);
    expect(completedServiceMonths("2024-01-15", "2024-02-14")).toBe(1);
    expect(completedServiceMonths("2024-01-31", "2024-03-01")).toBe(1);
    expect(completedServiceMonths("2026-10-01", "2026-09-30")).toBe(0);
  });
});

describe("annual leave balance (D2-6)", () => {
  it("joined 2024-01-01, no carry-forward: 22.5 days at 2026-09-30 (nine months of 2.5)", () => {
    const b = leaveBalance({ type: annual, joinYmd: "2024-01-01", asOfYmd: "2026-09-30", takenInYear: () => 0, overrides: new Map() });
    expect(b.opening).toBe(0);
    expect(b.accrued).toBe(22.5);
    expect(b.balance).toBe(22.5);
  });

  it("carry-forward is capped at the type's maximum (30 here): 10 + 29.5 = 39.5 at 2025-12-31 -> opening 30", () => {
    const b = leaveBalance({ type: { ...annual, carryForwardMaxDays: 30 }, joinYmd: "2024-01-01", asOfYmd: "2026-09-30", takenInYear: () => 0, overrides: new Map() });
    expect(b.opening).toBe(30);
    expect(b.balance).toBe(52.5);
  });

  it("approved leave in the year reduces the balance; an override opening and adjustment apply", () => {
    const taken = (y: number) => (y === 2026 ? 5 : 0);
    const b = leaveBalance({ type: annual, joinYmd: "2024-01-01", asOfYmd: "2026-09-30", takenInYear: taken, overrides: new Map([[2026, { opening: 4, adjustment: 1 }]]) });
    expect(b).toMatchObject({ opening: 4, accrued: 22.5, adjustment: 1, taken: 5, balance: 22.5 });
  });

  it("accrues nothing in the first six service months", () => {
    const b = leaveBalance({ type: annual, joinYmd: "2026-04-01", asOfYmd: "2026-09-30", takenInYear: () => 0, overrides: new Map() });
    expect(b.accrued).toBe(0);
  });

  it("an annual-grant type (sick 90) is credited in full each calendar year of service", () => {
    const sick = { code: "sick", payPolicy: "sick_tiered", annualDays: 90, accrual: "annual" as const, carryForwardMaxDays: 0, allowNegative: false };
    const b = leaveBalance({ type: sick, joinYmd: "2024-01-01", asOfYmd: "2026-09-30", takenInYear: (y) => (y === 2026 ? 20 : 0), overrides: new Map() });
    expect(b).toMatchObject({ opening: 0, accrued: 90, taken: 20, balance: 70 });
  });

  it("a type with no entitlement tracking has no accrual", () => {
    const unpaid = { code: "unpaid", payPolicy: "unpaid", annualDays: 0, accrual: "none" as const, carryForwardMaxDays: 0, allowNegative: true };
    expect(leaveBalance({ type: unpaid, joinYmd: "2024-01-01", asOfYmd: "2026-09-30", takenInYear: () => 3, overrides: new Map() }).balance).toBe(-3);
  });
});

describe("daysInRange", () => {
  it("counts the calendar days of the request that fall in the range", () => {
    const r = { startYmd: "2026-08-28", endYmd: "2026-09-03", days: 7 };
    expect(spanDays(r.startYmd, r.endYmd)).toBe(7);
    expect(daysInRange(r, "2026-08-01", "2026-08-31")).toBe(4);
    expect(daysInRange(r, "2026-09-01", "2026-09-30")).toBe(3);
    expect(daysInRange(r, "2026-10-01", "2026-10-31")).toBe(0);
  });
  it("a request counted in fewer days than its span is apportioned", () => {
    expect(daysInRange({ startYmd: "2026-08-30", endYmd: "2026-09-02", days: 2 }, "2026-09-01", "2026-09-30")).toBe(1);
  });
});

describe("sickTierSplit (Art. 31: 15 full, 30 half, then unpaid)", () => {
  it("20 days in a fresh year: 15 full, 5 half", () => {
    expect(sickTierSplit(0, 20)).toEqual({ full: 15, half: 5, unpaid: 0 });
  });
  it("tiers are cumulative over the calendar year", () => {
    expect(sickTierSplit(15, 10)).toEqual({ full: 0, half: 10, unpaid: 0 });
    expect(sickTierSplit(40, 10)).toEqual({ full: 0, half: 5, unpaid: 5 });
    expect(sickTierSplit(60, 5)).toEqual({ full: 0, half: 0, unpaid: 5 });
  });
});

describe("leaveDeduction", () => {
  it("20 sick days at basic 6,000 deduct 500 (5 half-pay days)", () => {
    const d = leaveDeduction({ payPolicy: "sick_tiered", wage: 6000, days: 20, sickDaysBefore: 0 });
    expect(d).toEqual({ unpaidDays: 0, halfDays: 5, deduction: 500 });
  });
  it("unpaid leave takes basic/30 a day, half-pay leave basic/60", () => {
    expect(leaveDeduction({ payPolicy: "unpaid", wage: 6000, days: 3, sickDaysBefore: 0 }).deduction).toBe(600);
    expect(leaveDeduction({ payPolicy: "half", wage: 6000, days: 4, sickDaysBefore: 0 }).deduction).toBe(400);
  });
  it("full-pay and manual types never deduct", () => {
    expect(leaveDeduction({ payPolicy: "full", wage: 6000, days: 10, sickDaysBefore: 0 }).deduction).toBe(0);
    expect(leaveDeduction({ payPolicy: "manual", wage: 6000, days: 10, sickDaysBefore: 0 }).deduction).toBe(0);
  });
  it("a 31-day unpaid month deducts 30/30 of basic, never more", () => {
    expect(leaveDeduction({ payPolicy: "unpaid", wage: 6000, days: 31, sickDaysBefore: 0 }).deduction).toBe(6000);
    expect(leaveDeduction({ payPolicy: "half", wage: 6000, days: 31, sickDaysBefore: 0 }).deduction).toBe(3100);
    expect(leaveDeduction({ payPolicy: "half", wage: 6000, days: 62, sickDaysBefore: 0 }).deduction).toBe(6000);
  });
  it("rounds to fils", () => {
    expect(leaveDeduction({ payPolicy: "unpaid", wage: 5000, days: 1, sickDaysBefore: 0 }).deduction).toBe(166.67);
  });
});
