import { describe, it, expect } from "vitest";
import { calculateGratuityForEmployee } from "../../server/services/gratuity";
import { leaveBalance } from "../../server/services/leave-math";

const annual = { code: "annual", payPolicy: "full", annualDays: 30, accrual: "monthly_service" as const, carryForwardMaxDays: 30, allowNegative: false };
const utc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

describe("unpaid leave is not service", () => {
  it("36 unpaid days take the service from 3.5 to 3 years + 145/360", () => {
    const plain = calculateGratuityForEmployee({ joinDate: utc("2023-01-01"), endDate: utc("2026-06-30"), basicSalary: 5000, totalWage: 5000, isGccNational: false });
    const less = calculateGratuityForEmployee({ joinDate: utc("2023-01-01"), endDate: utc("2026-06-30"), basicSalary: 5000, totalWage: 5000, isGccNational: false, unpaidDays: 36 });
    expect(plain.totalGratuity).toBe(12250);
    expect(less.totalGratuity).toBeCloseTo(((3 + 145 / 360) * 21 * 5000) / 30, 1);
  });
  it("no unpaid days: unchanged", () => {
    const a = calculateGratuityForEmployee({ joinDate: utc("2023-01-01"), endDate: utc("2026-06-30"), basicSalary: 5000, totalWage: 5000, isGccNational: false, unpaidDays: 0 });
    expect(a.totalGratuity).toBe(12250);
  });
  it("each unpaid day takes 30/360 of a day off the annual-leave accrual", () => {
    const base = { type: annual, joinYmd: "2024-01-01", asOfYmd: "2026-09-30", takenInYear: () => 0, overrides: new Map(), trackingStartYear: 2026 };
    const plain = leaveBalance(base);
    const less = leaveBalance({ ...base, unpaidDaysBetween: () => 12 });
    expect(plain.accrued).toBe(22.5);
    expect(less.accrued).toBeCloseTo(21.5, 5);
  });
});

describe("prior service: opening leave days", () => {
  it("opening days on 31 Aug are the opening balance; accrual and leave taken count from 1 Sep", () => {
    const b = leaveBalance({
      type: annual,
      joinYmd: "2024-01-01",
      asOfYmd: "2026-09-30",
      takenInYear: () => 99,
      takenBetween: () => 1,
      overrides: new Map(),
      trackingStartYear: 2026,
      openingDays: 4,
      openingAsOfYmd: "2026-08-31",
    });
    expect(b).toMatchObject({ opening: 4, accrued: 2.5, taken: 1, balance: 5.5 });
  });
  it("an explicit year override still wins", () => {
    const b = leaveBalance({
      type: annual,
      joinYmd: "2024-01-01",
      asOfYmd: "2026-09-30",
      takenInYear: () => 0,
      overrides: new Map([[2026, { opening: 10, adjustment: 0 }]]),
      trackingStartYear: 2026,
      openingDays: 4,
      openingAsOfYmd: "2026-08-31",
    });
    expect(b.opening).toBe(10);
  });
});
