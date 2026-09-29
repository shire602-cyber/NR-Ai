import { describe, it, expect } from "vitest";
import { parseCalendarDay } from "../../client/src/lib/date-safe";

describe("parseCalendarDay", () => {
  it("keeps a period end stored as end-of-day UTC on its own calendar day", () => {
    const d = parseCalendarDay("2026-09-30T23:59:59.999Z");
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 9, 30]);
  });
  it("keeps a period start stored as midnight UTC on its own calendar day", () => {
    const d = parseCalendarDay("2026-07-01T00:00:00.000Z");
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 7, 1]);
  });
  it("keeps a due date 28 days after the period end", () => {
    const d = parseCalendarDay("2026-10-28T23:59:59.999Z");
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 10, 28]);
  });
  it("accepts a plain calendar date", () => {
    const d = parseCalendarDay("2026-09-30");
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 9, 30]);
  });
  it("returns an invalid date for bad input", () => {
    expect(Number.isNaN(parseCalendarDay("nope").getTime())).toBe(true);
  });
});
