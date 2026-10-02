import { describe, it, expect } from "vitest";
import { prorate, prorateComponents, prorateMonth } from "../../server/services/payroll-proration";

describe("prorateMonth (inclusive calendar days, wage / 30)", () => {
  it("joined 15 Aug 2026 (31-day month): 15-31 Aug is 17 days = 17/30", () => {
    const p = prorateMonth({ joinYmd: "2026-08-15", year: 2026, month: 8 });
    expect(p).toMatchObject({ daysWorked: 17, reason: "joined", partial: true, basis: 30 });
    expect(p.factor).toBeCloseTo(17 / 30, 10);
  });
  it("joined 15 Sep 2026 (30-day month): 16 days = 16/30", () => {
    expect(prorateMonth({ joinYmd: "2026-09-15", year: 2026, month: 9 })).toMatchObject({ daysWorked: 16 });
  });
  it("July, before the join date: nothing", () => {
    expect(prorateMonth({ joinYmd: "2026-08-15", year: 2026, month: 7 })).toMatchObject({ daysWorked: 0, factor: 0, reason: "not_yet_joined" });
  });
  it("September after joining in August: the full month", () => {
    expect(prorateMonth({ joinYmd: "2026-08-15", year: 2026, month: 9 })).toMatchObject({ daysWorked: 30, reason: "full", partial: false, factor: 1 });
  });
  it("joined on the 1st: full; on the 2nd of a 31-day month: 30 days = full pay; on the 31st: one day", () => {
    expect(prorateMonth({ joinYmd: "2026-08-01", year: 2026, month: 8 })).toMatchObject({ daysWorked: 31, factor: 1, partial: false });
    expect(prorateMonth({ joinYmd: "2026-08-02", year: 2026, month: 8 })).toMatchObject({ daysWorked: 30, factor: 1, partial: true });
    const last = prorateMonth({ joinYmd: "2026-08-31", year: 2026, month: 8 });
    expect(last.daysWorked).toBe(1);
    expect(last.factor).toBeCloseTo(1 / 30, 10);
  });
  it("a short February is its own month: 15 Feb joiner works 14 of 28 days", () => {
    const p = prorateMonth({ joinYmd: "2026-02-15", year: 2026, month: 2 });
    expect(p).toMatchObject({ daysWorked: 14, basis: 28 });
    expect(p.factor).toBeCloseTo(0.5, 10);
  });
  it("leaver: paid from the 1st to the last day worked; the last day of the month is a full month", () => {
    expect(prorateMonth({ joinYmd: "2020-01-01", terminationYmd: "2026-09-12", year: 2026, month: 9 })).toMatchObject({ daysWorked: 12, reason: "left" });
    expect(prorateMonth({ joinYmd: "2020-01-01", terminationYmd: "2026-09-30", year: 2026, month: 9 })).toMatchObject({ daysWorked: 30, partial: false, factor: 1 });
    expect(prorateMonth({ joinYmd: "2020-01-01", terminationYmd: "2026-08-31", year: 2026, month: 9 })).toMatchObject({ daysWorked: 0, reason: "already_left" });
  });
  it("joiner and leaver in the same month", () => {
    expect(prorateMonth({ joinYmd: "2026-08-10", terminationYmd: "2026-08-20", year: 2026, month: 8 }).daysWorked).toBe(11);
  });
  it("no join date: the full month", () => {
    expect(prorateMonth({ year: 2026, month: 9 })).toMatchObject({ daysWorked: 30, factor: 1 });
  });
});

describe("prorate / prorateComponents", () => {
  it("9,000 x 16/30 = 4,800", () => expect(prorate(9000, 16 / 30)).toBe(4800));
  it("rounded once per line: 5,000 + 2,000 + 500 at 17/30 is exactly 4,250.00 across the parts", () => {
    const parts = prorateComponents({ basic: 5000, housing: 2000, transport: 500, other: 0 }, 17 / 30);
    expect(Math.round((parts.basic + parts.housing + parts.transport + parts.other) * 100)).toBe(425000);
    expect(parts.housing).toBe(1133.33);
    expect(parts.transport).toBe(283.33);
    expect(parts.basic).toBe(2833.34);
  });
  it("a full month is unchanged", () => {
    expect(prorateComponents({ basic: 6000, housing: 1500 }, 1)).toEqual({ basic: 6000, housing: 1500 });
  });
});
