import { describe, it, expect } from "vitest";
import {
  comparisonWindow,
  parseRunQuery,
  priorAsOf,
  resolveAsOfPreset,
  resolveRangePreset,
  resolveSchedulePreset,
} from "../../server/reports/params";
import { addMonths, fiscalYearStart, minusOneYear, todayYmd } from "../../server/reports/dates";

// Phase 8 D4: Dubai presets, comparison windows and query parsing of the report engine.

describe("Dubai days", () => {
  it("rolls the day at Dubai midnight (20:00 UTC), not at UTC midnight", () => {
    expect(todayYmd(new Date("2026-10-01T19:59:00Z"))).toBe("2026-10-01");
    expect(todayYmd(new Date("2026-10-01T20:00:00Z"))).toBe("2026-10-02");
    expect(todayYmd(new Date("2026-12-31T20:30:00Z"))).toBe("2027-01-01");
  });

  it("finds the fiscal year start for January and April years", () => {
    expect(fiscalYearStart("2026-10-02", 1)).toBe("2026-01-01");
    expect(fiscalYearStart("2026-10-02", 4)).toBe("2026-04-01");
    expect(fiscalYearStart("2026-02-10", 4)).toBe("2025-04-01");
    expect(fiscalYearStart("2026-04-01", 4)).toBe("2026-04-01");
  });

  it("clamps month steps and takes 29 Feb back to 28 Feb", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2024-03-31", -1)).toBe("2024-02-29");
    expect(minusOneYear("2024-02-29")).toBe("2023-02-28");
  });
});

describe("presets", () => {
  const now = new Date("2026-10-02T08:00:00Z");
  it("resolves range presets in Dubai time", () => {
    expect(resolveRangePreset("thisMonth", now)).toEqual({ from: "2026-10-01", to: "2026-10-02" });
    expect(resolveRangePreset("lastMonth", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolveRangePreset("thisQuarter", now)).toEqual({ from: "2026-10-01", to: "2026-10-02" });
    expect(resolveRangePreset("lastQuarter", now)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(resolveRangePreset("last30Days", now)).toEqual({ from: "2026-09-03", to: "2026-10-02" });
  });

  it("uses the fiscal year for thisYear and lastYear", () => {
    expect(resolveRangePreset("thisYear", now, 1)).toEqual({ from: "2026-01-01", to: "2026-10-02" });
    expect(resolveRangePreset("lastYear", now, 1)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(resolveRangePreset("thisYear", now, 4)).toEqual({ from: "2026-04-01", to: "2026-10-02" });
    expect(resolveRangePreset("lastYear", now, 4)).toEqual({ from: "2025-04-01", to: "2026-03-31" });
  });

  it("last month in January is December of the year before", () => {
    expect(resolveRangePreset("lastMonth", new Date("2026-01-15T08:00:00Z"))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("resolves as-of presets", () => {
    expect(resolveAsOfPreset("today", now)).toBe("2026-10-02");
    expect(resolveAsOfPreset("lastMonthEnd", now)).toBe("2026-09-30");
    expect(resolveAsOfPreset("lastQuarterEnd", now)).toBe("2026-09-30");
    expect(resolveAsOfPreset("lastYearEnd", now, 1)).toBe("2025-12-31");
  });

  it("turns a stored schedule into a run query", () => {
    expect(
      resolveSchedulePreset({ rangePreset: "lastMonth", compare: "priorPeriod", filters: { accountId: "x" } }, now)
    ).toEqual({ from: "2026-09-01", to: "2026-09-30", compare: "priorPeriod", accountId: "x" });
    expect(resolveSchedulePreset({ asOfPreset: "today", compare: "none" }, now)).toEqual({ asOf: "2026-10-02" });
  });
});

describe("comparison windows", () => {
  it("priorPeriod of whole calendar months is the previous calendar months (a month, a quarter)", () => {
    expect(comparisonWindow({ from: "2026-03-01", to: "2026-03-31" }, "priorPeriod")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(comparisonWindow({ from: "2026-04-01", to: "2026-06-30" }, "priorPeriod")).toMatchObject({ from: "2026-01-01", to: "2026-03-31" });
    expect(comparisonWindow({ from: "2026-01-01", to: "2026-01-31" }, "priorPeriod")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(comparisonWindow({ from: "2024-03-01", to: "2024-03-31" }, "priorPeriod")).toMatchObject({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("priorPeriod of any other range is the same number of days immediately before", () => {
    expect(comparisonWindow({ from: "2026-03-05", to: "2026-03-11" }, "priorPeriod")).toMatchObject({ from: "2026-02-26", to: "2026-03-04" });
    expect(comparisonWindow({ from: "2026-01-01", to: "2026-01-07" }, "priorPeriod")).toMatchObject({ from: "2025-12-25", to: "2025-12-31" });
  });

  it("priorYear shifts a year back, 29 Feb to 28 Feb", () => {
    expect(comparisonWindow({ from: "2024-02-01", to: "2024-02-29" }, "priorYear")).toMatchObject({ from: "2023-02-01", to: "2023-02-28" });
    expect(comparisonWindow({ asOf: "2024-02-29" }, "priorYear")).toMatchObject({ asOf: "2023-02-28" });
  });

  it("an as-of day moves one month, month end to month end", () => {
    expect(priorAsOf("2026-03-31")).toBe("2026-02-28");
    expect(priorAsOf("2026-05-31")).toBe("2026-04-30");
    expect(priorAsOf("2026-05-15")).toBe("2026-04-15");
  });

  it("custom passes the caller's window through", () => {
    expect(comparisonWindow({ from: "2026-03-01", to: "2026-03-31" }, "custom", { from: "2025-03-01", to: "2025-03-31" })).toEqual({
      mode: "custom",
      from: "2025-03-01",
      to: "2025-03-31",
    });
  });
});

describe("parseRunQuery", () => {
  const rules = { kinds: ["range", "comparison"] as const, filters: ["accountId"] as const };
  const ctx = { now: new Date("2026-10-02T08:00:00Z"), fiscalStartMonth: 1 };

  it("defaults a range report to the fiscal year to date and an as-of report to today", () => {
    const r = parseRunQuery({}, rules, ctx);
    expect(r.ok && r.value).toMatchObject({ from: "2026-01-01", to: "2026-10-02", limit: 500, offset: 0, format: "json", lang: "en" });
    const a = parseRunQuery({}, { kinds: ["asOf"], filters: [] }, ctx);
    expect(a.ok && a.value.asOf).toBe("2026-10-02");
  });

  it("refuses unknown keys, repeated keys and bad values", () => {
    expect(parseRunQuery({ nope: "1" }, rules, ctx)).toMatchObject({ ok: false, issue: { code: "UNKNOWN_PARAM" } });
    expect(parseRunQuery({ from: ["a", "b"] }, rules, ctx)).toMatchObject({ ok: false, issue: { code: "INVALID_PARAMS" } });
    expect(parseRunQuery({ from: "2026-13-01" }, rules, ctx)).toMatchObject({ ok: false, issue: { code: "INVALID_PARAMS" } });
    expect(parseRunQuery({ limit: "5000" }, rules, ctx)).toMatchObject({ ok: false, issue: { code: "INVALID_PARAMS" } });
    expect(parseRunQuery({ limit: "0" }, rules, ctx)).toMatchObject({ ok: false, issue: { code: "INVALID_PARAMS" } });
    expect(parseRunQuery({ offset: "-1" }, rules, ctx)).toMatchObject({ ok: false, issue: { code: "INVALID_PARAMS" } });
    expect(parseRunQuery({ format: "docx" }, rules, ctx)).toMatchObject({ ok: false, issue: { code: "INVALID_PARAMS" } });
    expect(parseRunQuery({ accountId: "not-an-id" }, rules, ctx)).toMatchObject({ ok: false, issue: { code: "INVALID_PARAMS" } });
    // a filter the definition does not take is an unknown key
    expect(parseRunQuery({ contactId: "11111111-1111-4111-8111-111111111111" }, rules, ctx)).toMatchObject({ ok: false });
  });

  it("refuses a date key the report does not take, like any unknown key", () => {
    expect(parseRunQuery({ asOf: "2026-01-01" }, rules, ctx)).toMatchObject({ ok: false, issue: { code: "UNKNOWN_PARAM", status: 400 } });
    expect(parseRunQuery({ from: "2026-01-01" }, { kinds: ["asOf"], filters: [] }, ctx)).toMatchObject({ ok: false, issue: { code: "UNKNOWN_PARAM" } });
    expect(parseRunQuery({ from: "2026-01-01", asOf: "2026-02-01" }, { kinds: ["range", "asOf"], filters: [] }, ctx).ok).toBe(true);
  });

  it("refuses an inverted range, a range over five years and a future as-of on ageing", () => {
    expect(parseRunQuery({ from: "2026-02-01", to: "2026-01-01" }, rules, ctx)).toMatchObject({ ok: false, issue: { code: "INVALID_RANGE", status: 422 } });
    expect(parseRunQuery({ from: "2019-01-01", to: "2026-01-01" }, rules, ctx)).toMatchObject({ ok: false, issue: { code: "RANGE_TOO_LONG" } });
    expect(parseRunQuery({ asOf: "2026-10-03" }, { kinds: ["asOf"], filters: [], noFutureAsOf: true }, ctx)).toMatchObject({ ok: false, issue: { code: "AS_OF_IN_FUTURE" } });
    expect(parseRunQuery({ asOf: "2026-10-03" }, { kinds: ["asOf"], filters: [] }, ctx).ok).toBe(true);
  });

  it("refuses a comparison on a report without one", () => {
    expect(parseRunQuery({ compare: "priorYear" }, { kinds: ["range"], filters: [] }, ctx)).toMatchObject({ ok: false, issue: { code: "COMPARISON_NOT_SUPPORTED" } });
    const ok = parseRunQuery({ from: "2026-01-01", to: "2026-01-31", compare: "priorYear" }, rules, ctx);
    expect(ok.ok && ok.value.compare).toMatchObject({ mode: "priorYear", from: "2025-01-01", to: "2025-01-31" });
  });

  it("custom comparison needs its own window", () => {
    expect(parseRunQuery({ compare: "custom" }, rules, ctx)).toMatchObject({ ok: false, issue: { code: "INVALID_PARAMS" } });
    const ok = parseRunQuery({ compare: "custom", compareFrom: "2025-01-01", compareTo: "2025-01-31" }, rules, ctx);
    expect(ok.ok && ok.value.compare).toMatchObject({ mode: "custom", from: "2025-01-01", to: "2025-01-31" });
  });

  it("limits the number of consolidated companies to 25", () => {
    const ids = Array.from({ length: 26 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`).join(",");
    expect(parseRunQuery({ companyIds: ids }, { kinds: ["range"], filters: ["companyIds"] }, ctx)).toMatchObject({ ok: false, issue: { code: "TOO_MANY_COMPANIES", status: 422 } });
  });
});
