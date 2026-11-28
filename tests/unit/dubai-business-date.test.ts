/**
 * Business dates in tests follow the server's Dubai calendar day (UTC+4). Between 20:00 and 24:00
 * UTC the UTC day (`toISOString().slice(0, 10)`) is one day behind, which made date-sensitive
 * DB tests fail only in that window. Pinned here at 2026-11-27T21:30:00Z (01:30 Dubai, Nov 28).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { uaeToday } from "../../shared/uae-date";
import { dubaiDaysAgo, dubaiInDays, dubaiIso, dubaiToday } from "../helpers/dates";
import * as mjs from "../helpers/dates.mjs";

const PINNED = new Date("2026-11-27T21:30:00Z");

describe("test business-date helpers", () => {
  afterEach(() => vi.useRealTimers());

  it("the old UTC pattern is a day behind the Dubai day at the pinned instant", () => {
    expect(PINNED.toISOString().slice(0, 10)).toBe("2026-11-27");
    expect(dubaiIso(PINNED)).toBe("2026-11-28");
  });

  it("today / N days ago / in N days use the Dubai day with the clock pinned", () => {
    vi.useFakeTimers();
    vi.setSystemTime(PINNED);
    expect(dubaiToday()).toBe("2026-11-28");
    expect(dubaiDaysAgo(1)).toBe("2026-11-27");
    expect(dubaiDaysAgo(0)).toBe("2026-11-28");
    expect(dubaiInDays(3)).toBe("2026-12-01");
    // the exact expressions the two failing files used, before and after
    expect(new Date(Date.now() - 1 * 86_400_000).toISOString().slice(0, 10)).toBe("2026-11-26");
    expect(dubaiIso(new Date(Date.now() - 1 * 86_400_000))).toBe("2026-11-27");
  });

  it("rolls over at 20:00 UTC exactly and not before", () => {
    expect(dubaiIso(new Date("2026-11-27T19:59:59Z"))).toBe("2026-11-27");
    expect(dubaiIso(new Date("2026-11-27T20:00:00Z"))).toBe("2026-11-28");
  });

  it("the helpers equal the server's uaeToday, and the .mjs twin equals both", () => {
    for (const iso of ["2026-11-27T19:59:59Z", "2026-11-27T21:30:00Z", "2026-12-31T20:00:00Z"]) {
      const d = new Date(iso);
      expect(dubaiIso(d)).toBe(uaeToday(d));
      expect(mjs.dubaiIso(d)).toBe(uaeToday(d));
    }
    vi.useFakeTimers();
    vi.setSystemTime(PINNED);
    expect(mjs.dubaiToday()).toBe(dubaiToday());
    expect(mjs.dubaiDaysAgo(5)).toBe(dubaiDaysAgo(5));
    expect(mjs.dubaiInDays(5)).toBe(dubaiInDays(5));
  });
});
