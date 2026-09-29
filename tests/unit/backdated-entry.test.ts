import { describe, it, expect } from "vitest";
import {
  getFiscalYearStart,
  isBackdatedBeforeFiscalYear,
  evaluateBackdatedEntry,
} from "../../server/services/backdated-entry.service";

const NOW = new Date("2026-09-29T10:00:00Z");

describe("getFiscalYearStart", () => {
  it("uses 1 January for a calendar fiscal year", () => {
    expect(getFiscalYearStart(NOW, 1)).toBe("2026-01-01");
  });
  it("uses the previous year when the fiscal year has not restarted yet", () => {
    expect(getFiscalYearStart(NOW, 10)).toBe("2025-10-01");
  });
  it("uses this year once the start month has arrived", () => {
    expect(getFiscalYearStart(NOW, 9)).toBe("2026-09-01");
  });
  it("falls back to January for invalid months", () => {
    expect(getFiscalYearStart(NOW, 0)).toBe("2026-01-01");
    expect(getFiscalYearStart(NOW, null)).toBe("2026-01-01");
  });
  it("rolls over at UAE midnight, not UTC midnight", () => {
    // 2025-12-31T21:00Z is already 1 Jan 2026 in the UAE.
    expect(getFiscalYearStart(new Date("2025-12-31T21:00:00Z"), 1)).toBe("2026-01-01");
    expect(getFiscalYearStart(new Date("2025-12-31T19:00:00Z"), 1)).toBe("2025-01-01");
  });
});

describe("isBackdatedBeforeFiscalYear", () => {
  it("flags a 2019 entry", () => {
    expect(isBackdatedBeforeFiscalYear(new Date("2019-06-01"), "2026-01-01")).toBe(true);
  });
  it("flags the last day of the prior year", () => {
    expect(isBackdatedBeforeFiscalYear("2025-12-31", "2026-01-01")).toBe(true);
  });
  it("does not flag the first day of the fiscal year", () => {
    expect(isBackdatedBeforeFiscalYear("2026-01-01", "2026-01-01")).toBe(false);
  });
  it("treats a UAE-midnight local date on the boundary as inside the year", () => {
    // 1 Jan 00:00 UAE == 31 Dec 20:00 UTC
    expect(isBackdatedBeforeFiscalYear(new Date("2025-12-31T20:00:00Z"), "2026-01-01")).toBe(false);
  });
  it("does not flag missing or invalid dates", () => {
    expect(isBackdatedBeforeFiscalYear(undefined, "2026-01-01")).toBe(false);
    expect(isBackdatedBeforeFiscalYear("garbage", "2026-01-01")).toBe(false);
  });
});

describe("evaluateBackdatedEntry", () => {
  const base = { fiscalYearStartMonth: 1, now: NOW };
  it("requires confirmation for a backdated entry without the flag", () => {
    const r = evaluateBackdatedEntry({ ...base, entryDate: "2019-03-01", confirmBackdated: undefined });
    expect(r).toEqual({ requiresConfirmation: true, confirmedBackdated: false, fiscalYearStart: "2026-01-01" });
  });
  it("only accepts a strict boolean true", () => {
    expect(evaluateBackdatedEntry({ ...base, entryDate: "2019-03-01", confirmBackdated: "true" }).requiresConfirmation).toBe(true);
  });
  it("proceeds and records confirmation when the flag is true", () => {
    const r = evaluateBackdatedEntry({ ...base, entryDate: "2019-03-01", confirmBackdated: true });
    expect(r.requiresConfirmation).toBe(false);
    expect(r.confirmedBackdated).toBe(true);
  });
  it("ignores the flag for current-year entries", () => {
    const r = evaluateBackdatedEntry({ ...base, entryDate: "2026-05-01", confirmBackdated: true });
    expect(r.requiresConfirmation).toBe(false);
    expect(r.confirmedBackdated).toBe(false);
  });
});
