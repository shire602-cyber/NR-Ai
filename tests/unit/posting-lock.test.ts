import { describe, expect, it } from "vitest";
import { monthLockKeys, monthKeyOf } from "../../server/services/posting-lock";

describe("posting lock keys", () => {
  it("derives the calendar month (UTC) from a date, a timestamp or a YYYY-MM-DD string", () => {
    expect(monthKeyOf("2026-08-31")).toBe("2026-08");
    expect(monthKeyOf(new Date("2026-08-31T23:59:59Z"))).toBe("2026-08");
    expect(monthKeyOf("2026-09-01T00:00:00.000Z")).toBe("2026-09");
  });

  it("gives the same key for every day of a month and different keys across companies and months", () => {
    const a = monthLockKeys("co-1", "2026-08-01");
    expect(monthLockKeys("co-1", "2026-08-31")).toEqual(a);
    expect(monthLockKeys("co-1", "2026-09-01")).not.toEqual(a);
    expect(monthLockKeys("co-2", "2026-08-01")).not.toEqual(a);
  });

  it("keys are 32-bit signed integers (advisory lock int4 pair)", () => {
    const [ns, key] = monthLockKeys("some-company-uuid", "2026-01-15");
    for (const v of [ns, key]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-2147483648);
      expect(v).toBeLessThanOrEqual(2147483647);
    }
  });
});
