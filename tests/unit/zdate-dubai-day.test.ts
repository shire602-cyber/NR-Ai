import { afterEach, describe, expect, it, vi } from "vitest";
import { zDateIn } from "../../shared/validators/primitives";

describe("zDateIn compares to the Dubai day", () => {
  afterEach(() => vi.useRealTimers());

  it("at 01:30 Dubai (21:30Z the day before) accepts the Dubai today and rejects the day after", () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T21:30:00Z") });
    const schema = zDateIn({ maxDaysAhead: 0 });
    expect(schema.safeParse("2026-11-28").success).toBe(true);
    expect(schema.safeParse("2026-11-29").success).toBe(false);
  });

  it("midday Dubai behaves the same", () => {
    vi.useFakeTimers({ now: new Date("2026-11-28T08:00:00Z") });
    const schema = zDateIn({ maxDaysAhead: 0 });
    expect(schema.safeParse("2026-11-28").success).toBe(true);
    expect(schema.safeParse("2026-11-29").success).toBe(false);
  });
});
