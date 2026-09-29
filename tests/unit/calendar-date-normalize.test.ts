import { describe, it, expect } from "vitest";
import {
  toCalendarYmd,
  localWallDateToUtcMidnight,
  normalizeCalendarColumns,
} from "../../server/utils/date";

describe("toCalendarYmd", () => {
  it("keeps a bare date, and a datetime without an offset, as written", () => {
    expect(toCalendarYmd("2026-09-29")).toBe("2026-09-29");
    expect(toCalendarYmd("2026-09-29T00:00:00")).toBe("2026-09-29");
  });
  it("converts an instant to its UAE calendar day", () => {
    // What a UAE browser sends for 29 Sep: new Date(2026, 8, 29).toISOString()
    expect(toCalendarYmd("2026-09-28T20:00:00.000Z")).toBe("2026-09-29");
    expect(toCalendarYmd("2026-09-29T00:00:00.000Z")).toBe("2026-09-29");
    expect(toCalendarYmd("2026-09-29T00:00:00+04:00")).toBe("2026-09-29");
    expect(toCalendarYmd("2026-09-30T21:00:00Z")).toBe("2026-10-01");
  });
  it("converts a Date to its UAE calendar day", () => {
    expect(toCalendarYmd(new Date("2026-09-28T20:00:00Z"))).toBe("2026-09-29");
  });
});

describe("localWallDateToUtcMidnight", () => {
  it("maps a local-midnight Date to UTC midnight of the same calendar day", () => {
    // Built from local components, exactly as node-pg does for a timestamp
    // column, so the assertion holds in whatever TZ the test host runs in.
    const localMidnight = new Date(2026, 8, 29, 0, 0, 0);
    expect(localWallDateToUtcMidnight(localMidnight).toISOString()).toBe(
      "2026-09-29T00:00:00.000Z"
    );
  });
  it("passes non-dates through", () => {
    expect(localWallDateToUtcMidnight(null)).toBeNull();
    expect(localWallDateToUtcMidnight("2026-09-29")).toBe("2026-09-29");
  });
});

describe("normalizeCalendarColumns", () => {
  it("normalises only the named columns and does not mutate the row", () => {
    const row = { bill_date: new Date(2026, 9, 1), other: new Date(2026, 9, 1, 5), n: 1 };
    const out = normalizeCalendarColumns(row, ["bill_date", "due_date"]);
    expect((out.bill_date as Date).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(out.other).toBe(row.other);
    expect(out).not.toBe(row);
    expect(row.bill_date.getFullYear()).toBe(2026);
  });
});
