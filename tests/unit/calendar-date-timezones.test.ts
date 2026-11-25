/**
 * DF3 / Fable N1: business dates (period starts and ends, due dates, document dates, fiscal
 * years) are calendar days. The VAT quarter 1 Jul – 30 Sep 2026 is stored with the period end
 * 2026-09-30T23:59:59.999Z; a UAE-time browser read it as 1 Oct. Every formatter here runs
 * under Asia/Dubai, America/Los_Angeles and UTC and must give the same calendar day.
 * Node re-reads `process.env.TZ` on assignment, so each zone is checked in-process (the
 * offset assertion proves the zone switch took effect).
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  calendarDayKey,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatMonthYear,
  parseCalendarDate,
} from "../../client/src/lib/format-date";
import { formatDatePlain } from "../../client/src/lib/format";
import { formatDateForExport } from "../../client/src/lib/export";
import { calendarDateKey, calendarParts } from "../../shared/uae-date";
import { date as pdfDate } from "../../server/services/pdf-ledger";
import { formatIsoDate, formatIsoDateAr } from "../../server/services/report-render/model";

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const ZONES: Array<[string, number]> = [
  ["Asia/Dubai", -240],
  ["America/Los_Angeles", 480], // January offset (PST)
  ["UTC", 0],
];

// Encodings of the calendar day 30 Sep 2026 the app stores or sends.
const PERIOD_END_UTC_EOD = "2026-09-30T23:59:59.999Z"; // VAT period end (N1)
const UTC_MIDNIGHT = "2026-09-30T00:00:00.000Z"; // new Date("2026-09-30") on the server
const UAE_DAY_START = "2026-09-29T20:00:00.000Z"; // uaeDayStart("2026-09-30")
const UAE_DAY_END = "2026-09-30T19:59:59.999Z"; // uaeDayEnd("2026-09-30")
const ENCODINGS = ["2026-09-30", PERIOD_END_UTC_EOD, UTC_MIDNIGHT, UAE_DAY_START, UAE_DAY_END];

for (const [zone, januaryOffset] of ZONES) {
  describe(`business dates under TZ=${zone}`, () => {
    it("the zone switch took effect", () => {
      process.env.TZ = zone;
      expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(januaryOffset);
    });

    it.each(ENCODINGS)("formatDate(%s) is 30 Sep 2026 in en and ar", (value) => {
      process.env.TZ = zone;
      expect(formatDate(value, "en")).toBe("30 Sep 2026");
      expect(formatDate(new Date(value), "en")).toBe("30 Sep 2026");
      expect(formatDate(value, "ar")).toBe("30 سبتمبر 2026");
      expect(calendarDayKey(value)).toBe("2026-09-30");
      expect(calendarDateKey(value)).toBe("2026-09-30");
    });

    it("the VAT quarter reads 1 Jul – 30 Sep 2026, Sep 2026 and stays in the quarter", () => {
      process.env.TZ = zone;
      const start = "2026-07-01T00:00:00.000Z";
      expect(formatDateRange(start, PERIOD_END_UTC_EOD, "en")).toBe("1 Jul – 30 Sep 2026");
      expect(formatMonthYear(PERIOD_END_UTC_EOD, "en")).toBe("Sep 2026");
      const end = parseCalendarDate(PERIOD_END_UTC_EOD);
      expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2026, 8, 30]);
    });

    it("a fiscal year end on 31 Dec stays in its year", () => {
      process.env.TZ = zone;
      expect(parseCalendarDate("2026-12-31T23:59:59.999Z").getFullYear()).toBe(2026);
      expect(parseCalendarDate("2027-01-01T00:00:00.000Z").getFullYear()).toBe(2027);
    });

    it("a local date-picker date keeps its day", () => {
      process.env.TZ = zone;
      expect(formatDate(new Date(2026, 8, 30), "en")).toBe("30 Sep 2026");
      expect(calendarDayKey(new Date(2026, 8, 30))).toBe("2026-09-30");
    });

    it("PDF, print and export helpers give the same day", () => {
      process.env.TZ = zone;
      expect(formatDatePlain(PERIOD_END_UTC_EOD, "en")).toMatch(/^30 Sept? 2026$/);
      expect(formatDateForExport(PERIOD_END_UTC_EOD)).toMatch(/^30 Sept? 2026$/);
      expect(pdfDate(PERIOD_END_UTC_EOD)).toBe("30 Sep 2026");
      expect(pdfDate(new Date(UAE_DAY_START))).toBe("30 Sep 2026");
      expect(formatIsoDate(UAE_DAY_START)).toBe("30 Sep 2026");
      expect(formatIsoDateAr(PERIOD_END_UTC_EOD)).toBe("30 سبتمبر 2026");
    });

    it("ordinary timestamps keep the viewer's clock", () => {
      process.env.TZ = zone;
      const ts = "2026-11-18T10:15:00.000Z";
      const local = new Date(ts);
      const expected = `${local.getDate()} Nov 2026, ${String(local.getHours()).padStart(2, "0")}:15`;
      expect(formatDateTime(ts, "en")).toBe(expected);
      // Server renderers have no viewer: an ordinary timestamp is its UAE day.
      expect(calendarParts("2026-11-18T21:00:00.000Z")).toEqual({ year: 2026, month: 11, day: 19 });
    });
  });
}
