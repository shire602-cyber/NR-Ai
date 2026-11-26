// F06 — business dates preserved, instants converted to Asia/Dubai before the
// period-lock lookup, and the stored journal date matches the selected period.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// vi.hoisted so this variable is defined before vi.mock() factory runs (vitest hoists both).
const { lockedMonths } = vi.hoisted(() => ({ lockedMonths: new Set<string>() }));

// Mock the db module so assertPeriodNotLocked → getEffectiveLock never dials a real Postgres.
// The execute mock returns a lock row when the ISO date's month is in lockedMonths.
vi.mock("../../server/db", () => ({
  db: {
    execute: vi.fn().mockImplementation((sqlQuery: { queryChunks?: unknown[] }) => {
      // Drizzle stores template literal values directly in queryChunks (not nested).
      // e.g. sql`WHERE company_id = ${"c1"} AND ... ${isoDate}` gives queryChunks like:
      //   [{ value: ["WHERE..."] }, "c1", { value: ["AND ..."] }, "2026-11-30", ...]
      function extractDates(node: unknown): string[] {
        if (!node || typeof node !== "object") return [];
        const n = node as Record<string, unknown>;
        const out: string[] = [];
        if (Array.isArray(n.queryChunks)) {
          for (const c of n.queryChunks) {
            if (typeof c === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c)) {
              out.push(c);
            } else if (c && typeof c === "object") {
              out.push(...extractDates(c));
            }
          }
        }
        return out;
      }
      const isoDate = extractDates(sqlQuery)[0];
      if (isoDate && lockedMonths.has(isoDate.slice(0, 7))) {
        return Promise.resolve({
          rows: [{ period_end: isoDate.slice(0, 7) + "-30", lock_type: "hard", lock_scope: "through" }],
        });
      }
      return Promise.resolve({ rows: [] });
    }),
  },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import { toAccountingDate } from "../../shared/accounting-date";
import { assertPeriodNotLocked, isFutureDate } from "../../server/services/period-lock.service";

describe("F06 toAccountingDate", () => {
  it("preserves date-only business dates", () => {
    expect(toAccountingDate("2026-12-01")).toMatchObject({
      businessDate: "2026-12-01",
      convertedFromInstant: false,
    });
    expect(toAccountingDate("2026-12-01")!.date.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("converts instants to the Dubai calendar date", () => {
    // 1 Dec 00:30 Dubai = 30 Nov 20:30 UTC
    expect(toAccountingDate("2026-11-30T20:30:00Z")!.businessDate).toBe("2026-12-01");
    expect(toAccountingDate(new Date("2026-12-01T00:30:00+04:00"))!.businessDate).toBe("2026-12-01");
    // 30 Nov 23:59 Dubai stays November
    expect(toAccountingDate("2026-11-30T23:59:00+04:00")!.businessDate).toBe("2026-11-30");
    // Year end: 1 Jan 00:30 Dubai
    expect(toAccountingDate("2026-12-31T20:30:00Z")!.businessDate).toBe("2027-01-01");
    expect(toAccountingDate("2026-12-31T23:59:00+04:00")!.businessDate).toBe("2026-12-31");
  });

  it("rejects impossible and empty dates", () => {
    expect(toAccountingDate("2026-02-30")).toBeNull();
    expect(toAccountingDate("not a date")).toBeNull();
    expect(toAccountingDate("")).toBeNull();
    expect(toAccountingDate(null)).toBeNull();
    expect(toAccountingDate("2028-02-29")!.businessDate).toBe("2028-02-29");
  });
});

describe("F06 assertPeriodNotLocked (November locked, December open)", () => {
  beforeEach(() => {
    lockedMonths.clear();
    lockedMonths.add("2026-11");
  });

  it("1 Dec 00:30 Dubai posts to December and returns the stored date", async () => {
    const r = await assertPeriodNotLocked("c1", "2026-11-30T20:30:00Z", { storesBusinessDate: true });
    expect(r!.businessDate).toBe("2026-12-01");
    expect(r!.date.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  it("30 Nov 23:59 Dubai remains locked", async () => {
    await expect(
      assertPeriodNotLocked("c1", "2026-11-30T23:59:00+04:00", { storesBusinessDate: true })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("date-only input is preserved", async () => {
    // November (locked) → rejected
    await expect(assertPeriodNotLocked("c1", "2026-11-30")).rejects.toBeTruthy();
    // December (open) → resolves with the normalised accounting date
    // Uses storesBusinessDate so the returned AccountingDate can be inspected.
    await expect(
      assertPeriodNotLocked("c1", "2026-12-01", { storesBusinessDate: true })
    ).resolves.toMatchObject({ businessDate: "2026-12-01" });
  });

  it("raw instants whose Dubai date is locked are blocked", async () => {
    // 2026-11-30T12:00:00Z = 16:00 Dubai → still November → locked.
    // (2026-11-30T20:30:00Z = 00:30 Dubai next day → December → NOT locked, that's the F06 fix.)
    await expect(assertPeriodNotLocked("c1", "2026-11-30T12:00:00Z")).rejects.toBeTruthy();
  });

  it("year-end: December locked, 1 Jan 00:30 Dubai posts to January", async () => {
    lockedMonths.clear();
    lockedMonths.add("2026-12");
    const r = await assertPeriodNotLocked("c1", "2026-12-31T20:30:00Z", { storesBusinessDate: true });
    expect(r!.businessDate).toBe("2027-01-01");
  });
});

describe("F06 future-date guard uses the Dubai business day", () => {
  it("today's Dubai business date is not future between 00:00 and 04:00 Dubai", () => {
    const now = new Date("2026-11-30T20:30:00Z"); // 1 Dec 00:30 Dubai
    expect(isFutureDate(toAccountingDate(now)!.date, now)).toBe(false);
    expect(isFutureDate(new Date("2026-12-02T00:00:00Z"), now)).toBe(true);
  });
});

describe("F06 journal routes store the normalised business date", () => {
  const src = readFileSync("server/routes/journal.routes.ts", "utf8");
  it("create, update and reversal pass storesBusinessDate and persist accounting dates", () => {
    expect(src.match(/storesBusinessDate: true/g)?.length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("const entryDate = accountingDate.date;");
    expect(src).toContain("const now = reversalAccountingDate!.date;");
  });
});
