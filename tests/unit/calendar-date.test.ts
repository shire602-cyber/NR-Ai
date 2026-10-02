/**
 * Teardown t1 F1: a document date is a calendar day. Picking 1 October must send "2026-10-01" and show as
 * 1 October whatever the browser's time zone is (UTC, UAE +04:00, or west of Greenwich).
 */
import { afterEach, describe, expect, it } from "vitest";
import { formatDate } from "../../client/src/lib/format";
import {
  formatCalendarDate,
  parseYmd,
  pickerDate,
  stringifyBody,
  toYmd,
  todayYmd,
  uaeDayOf,
} from "../../client/src/lib/calendar-date";

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const ZONES = ["UTC", "Asia/Dubai", "America/New_York", "Pacific/Auckland"];

describe.each(ZONES)("picking 1 October in a browser at %s", (zone) => {
  it("sends the calendar day, not a UTC instant", () => {
    process.env.TZ = zone;
    const picked = new Date(2026, 9, 1); // what the date picker returns: local midnight
    expect(toYmd(picked)).toBe("2026-10-01");
    expect(JSON.parse(stringifyBody({ date: picked, nested: { dueDate: picked }, list: [picked] }))).toEqual({
      date: "2026-10-01",
      nested: { dueDate: "2026-10-01" },
      list: ["2026-10-01"],
    });
  });

  it("round-trips through the picker and shows as 1 October everywhere", () => {
    process.env.TZ = zone;
    const stored = "2026-10-01"; // what the server returns for a date-only document
    const back = pickerDate(stored)!;
    expect(toYmd(back)).toBe("2026-10-01");
    expect(parseYmd(stored).getDate()).toBe(1);
    expect(formatDate(stored, "en")).toMatch(/1 Oct 2026/);
    expect(formatCalendarDate(stored, "en")).toMatch(/1 October 2026/);
    expect(formatCalendarDate(stored, "ar")).toMatch(/1 أكتوبر 2026|١ أكتوبر|1 اكتوبر/);
  });
});

describe("documents saved before the fix", () => {
  it("2026-09-30T20:00Z (a UAE user's 1 October) is the 1st in the UAE, in any browser zone", () => {
    for (const zone of ZONES) {
      process.env.TZ = zone;
      expect(uaeDayOf("2026-09-30T20:00:00.000Z")).toBe("2026-10-01");
      expect(formatDate("2026-09-30T20:00:00.000Z", "en")).toMatch(/1 Oct 2026/);
      expect(toYmd(pickerDate("2026-09-30T20:00:00.000Z")!)).toBe("2026-10-01");
    }
  });

  it("2026-10-01T00:00Z (a date-only value stored as UTC midnight) is 1 October", () => {
    for (const zone of ZONES) {
      process.env.TZ = zone;
      expect(uaeDayOf("2026-10-01T00:00:00.000Z")).toBe("2026-10-01");
    }
  });
});

describe("today", () => {
  it("is the UAE day: 22:00 UTC is already tomorrow in Dubai", () => {
    expect(todayYmd(new Date("2026-10-01T22:00:00Z"))).toBe("2026-10-02");
    expect(todayYmd(new Date("2026-10-01T19:59:00Z"))).toBe("2026-10-01");
  });
  it("empty and invalid values give an empty day", () => {
    expect(uaeDayOf(null)).toBe("");
    expect(uaeDayOf("nonsense")).toBe("");
    expect(pickerDate(undefined)).toBeUndefined();
  });
});
