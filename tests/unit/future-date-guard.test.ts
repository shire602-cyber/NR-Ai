import { describe, it, expect } from "vitest";
import { isFutureDate, assertNotFutureDate } from "../../server/services/period-lock.service";

const NOW = new Date("2026-06-21T12:00:00Z");

describe("isFutureDate (A-4)", () => {
  it("treats today as not future", () => {
    expect(isFutureDate(new Date("2026-06-21T23:00:00Z"), NOW)).toBe(false);
  });
  it("treats a past date as not future", () => {
    expect(isFutureDate(new Date("2025-01-01T00:00:00Z"), NOW)).toBe(false);
  });
  it("flags tomorrow as future", () => {
    expect(isFutureDate(new Date("2026-06-22T00:00:00Z"), NOW)).toBe(true);
  });
  it("flags a far-future date as future", () => {
    expect(isFutureDate(new Date("2030-08-02T00:00:00Z"), NOW)).toBe(true);
  });
  it("honours a grace window", () => {
    // NOW = 21 Jun; grace 3 => dates through end of 24 Jun are allowed.
    expect(isFutureDate(new Date("2026-06-23T00:00:00Z"), NOW, 3)).toBe(false);
    expect(isFutureDate(new Date("2026-06-24T23:00:00Z"), NOW, 3)).toBe(false);
    expect(isFutureDate(new Date("2026-06-25T00:00:00Z"), NOW, 3)).toBe(true);
  });
});

describe("assertNotFutureDate (A-4)", () => {
  it("does not throw for today or past", () => {
    expect(() => assertNotFutureDate(new Date("2026-06-21T08:00:00Z"), { now: NOW })).not.toThrow();
    expect(() => assertNotFutureDate("2025-12-31", { now: NOW })).not.toThrow();
  });
  it("throws for a future date", () => {
    expect(() => assertNotFutureDate(new Date("2026-08-02T00:00:00Z"), { now: NOW })).toThrow();
  });
  it("ignores null/empty dates", () => {
    expect(() => assertNotFutureDate(null, { now: NOW })).not.toThrow();
    expect(() => assertNotFutureDate(undefined, { now: NOW })).not.toThrow();
  });
});

describe("UAE calendar day (posting 'today' is UTC+4)", () => {
  // 20:30 UTC on 17 Nov is 00:30 on 18 Nov in the UAE: the local today is not a future date.
  const LATE = new Date("2026-11-17T20:30:00Z");
  it("ledger todayIso and the future-date guards use the UAE date", async () => {
    const { todayIso, assertNotFuture } = await import("../../server/ledger/normalize");
    expect(todayIso(LATE)).toBe("2026-11-18");
    expect(() => assertNotFuture("2026-11-18", LATE)).not.toThrow();
    expect(() => assertNotFuture("2026-11-19", LATE)).toThrow();
    expect(isFutureDate(new Date("2026-11-18T00:00:00Z"), LATE)).toBe(false);
    expect(isFutureDate(new Date("2026-11-19T00:00:00Z"), LATE)).toBe(true);
    expect(todayIso(new Date("2026-11-17T19:59:00Z"))).toBe("2026-11-17");
  });
});
