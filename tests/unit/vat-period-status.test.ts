import { describe, expect, it } from "vitest";
import {
  assertVatPeriodEnded,
  classifyVatPeriod,
  vatPeriodPreviewMeta,
} from "../../server/services/vat-period-status.service";

// 2026-09-29 12:00 UTC == 2026-09-29 16:00 UAE
const NOW = new Date("2026-09-29T12:00:00Z");

describe("classifyVatPeriod", () => {
  it("returns 'closed' for a period that ended before today", () => {
    expect(classifyVatPeriod("2026-04-01", "2026-06-30", NOW)).toBe("closed");
  });

  it("returns 'closed' when the period ended yesterday (UAE)", () => {
    expect(classifyVatPeriod("2026-08-01", "2026-09-28", NOW)).toBe("closed");
  });

  it("returns 'open' when the period ends today: the last day is not over yet", () => {
    expect(classifyVatPeriod("2026-07-01", "2026-09-29", NOW)).toBe("open");
  });

  it("returns 'open' for the current quarter (started, not ended)", () => {
    expect(classifyVatPeriod("2026-07-01", "2026-09-30", NOW)).toBe("open");
  });

  it("returns 'open' when the period starts today", () => {
    expect(classifyVatPeriod("2026-09-29", "2026-12-28", NOW)).toBe("open");
  });

  it("returns 'future' when the period starts tomorrow", () => {
    expect(classifyVatPeriod("2026-09-30", "2026-12-31", NOW)).toBe("future");
  });

  it("returns 'future' for a period entirely in the future", () => {
    expect(classifyVatPeriod("2027-01-01", "2027-03-31", NOW)).toBe("future");
  });

  it("uses the UAE calendar day: 21:00 UTC is already tomorrow in UAE", () => {
    const lateUtc = new Date("2026-09-29T21:00:00Z"); // 01:00 on 30 Sep UAE
    expect(classifyVatPeriod("2026-07-01", "2026-09-29", lateUtc)).toBe("closed");
    expect(classifyVatPeriod("2026-09-30", "2026-12-31", lateUtc)).toBe("open");
  });

  it("uses the UAE calendar day just before UAE midnight", () => {
    const beforeMidnightUae = new Date("2026-09-29T19:59:59Z"); // 23:59:59 UAE
    expect(classifyVatPeriod("2026-07-01", "2026-09-29", beforeMidnightUae)).toBe("open");
  });

  it("treats stored end-of-day UTC instants as their calendar date", () => {
    // Stored periodEnd is 23:59:59.999Z of the calendar date.
    const end = new Date("2026-09-28T23:59:59.999Z");
    expect(classifyVatPeriod(new Date("2026-07-01T00:00:00Z"), end, NOW)).toBe("closed");
  });

  it("accepts full ISO strings", () => {
    expect(classifyVatPeriod("2026-07-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z", NOW)).toBe(
      "open"
    );
  });
});

describe("assertVatPeriodEnded", () => {
  it("does not throw for a closed period", () => {
    expect(() => assertVatPeriodEnded("2026-04-01", "2026-06-30", NOW)).not.toThrow();
  });

  it("throws PERIOD_NOT_ENDED (400) for an open period", () => {
    try {
      assertVatPeriodEnded("2026-07-01", "2026-09-30", NOW);
      throw new Error("expected throw");
    } catch (err: any) {
      expect(err.code).toBe("PERIOD_NOT_ENDED");
      expect(err.statusCode).toBe(400);
    }
  });

  it("throws PERIOD_NOT_ENDED for a future period", () => {
    expect(() => assertVatPeriodEnded("2027-01-01", "2027-03-31", NOW)).toThrowError(
      /not ended/i
    );
  });
});

describe("vatPeriodPreviewMeta", () => {
  it("flags an open period as a draft preview with the UAE as-of date", () => {
    expect(vatPeriodPreviewMeta("2026-07-01", "2026-09-30", NOW)).toEqual({
      isDraftPreview: true,
      previewAsOf: "2026-09-29",
    });
  });

  it("does not flag a closed period", () => {
    expect(vatPeriodPreviewMeta("2026-04-01", "2026-06-30", NOW)).toEqual({
      isDraftPreview: false,
      previewAsOf: null,
    });
  });
});
