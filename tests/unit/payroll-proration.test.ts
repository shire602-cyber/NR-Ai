import { describe, it, expect } from "vitest";
import { prorate, prorateMonth } from "../../server/services/payroll-proration";

describe("prorateMonth (30-day basis)", () => {
  it("joined 15 Aug 2026: 16 days = 16/30", () => {
    const p = prorateMonth({ joinYmd: "2026-08-15", year: 2026, month: 8 });
    expect(p).toMatchObject({ daysWorked: 16, reason: "joined" });
    expect(p.factor).toBeCloseTo(16 / 30, 10);
  });
  it("July, before the join date: nothing", () => {
    expect(prorateMonth({ joinYmd: "2026-08-15", year: 2026, month: 7 })).toMatchObject({ daysWorked: 0, factor: 0, reason: "not_yet_joined" });
  });
  it("September after joining in August: the full month", () => {
    expect(prorateMonth({ joinYmd: "2026-08-15", year: 2026, month: 9 })).toMatchObject({ daysWorked: 30, reason: "full" });
  });
  it("joined on the 1st: full; on the 2nd of a 31-day month: 29; on the 31st: 0", () => {
    expect(prorateMonth({ joinYmd: "2026-08-01", year: 2026, month: 8 }).daysWorked).toBe(30);
    expect(prorateMonth({ joinYmd: "2026-08-02", year: 2026, month: 8 }).daysWorked).toBe(29);
    expect(prorateMonth({ joinYmd: "2026-08-31", year: 2026, month: 8 }).daysWorked).toBe(0);
  });
  it("leaver: paid from the 1st to the last day worked; the last day of the month is a full month", () => {
    expect(prorateMonth({ joinYmd: "2020-01-01", terminationYmd: "2026-09-12", year: 2026, month: 9 })).toMatchObject({ daysWorked: 12, reason: "left" });
    expect(prorateMonth({ joinYmd: "2020-01-01", terminationYmd: "2026-09-30", year: 2026, month: 9 }).daysWorked).toBe(30);
    expect(prorateMonth({ joinYmd: "2020-01-01", terminationYmd: "2026-08-31", year: 2026, month: 9 })).toMatchObject({ daysWorked: 0, reason: "already_left" });
  });
  it("joiner and leaver in the same month", () => {
    expect(prorateMonth({ joinYmd: "2026-08-10", terminationYmd: "2026-08-20", year: 2026, month: 8 }).daysWorked).toBe(11);
  });
  it("no join date: the full month", () => {
    expect(prorateMonth({ year: 2026, month: 8 }).daysWorked).toBe(30);
  });
});

describe("prorate", () => {
  it("9,000 x 16/30 = 4,800", () => expect(prorate(9000, 16 / 30)).toBe(4800));
});
