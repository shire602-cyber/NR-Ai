import { describe, expect, it } from "vitest";
import {
  AGEING_BUCKET_KEYS,
  bucketTotal,
  dashboardStatsPath,
  daysUntil,
  normalizeBuckets,
  overdueOfBuckets,
  vatDueView,
} from "../../client/src/lib/dashboardStats";

describe("ageing buckets", () => {
  it("reads the five keys the server now sends", () => {
    const b = normalizeBuckets({
      current: 100,
      days1to30: 50,
      days31to60: 25,
      days61to90: 10,
      days90plus: 5,
    });
    expect(AGEING_BUCKET_KEYS.map((k) => b[k])).toEqual([100, 50, 25, 10, 5]);
    expect(bucketTotal(b)).toBe(190);
    expect(overdueOfBuckets(b)).toBe(90);
  });

  it("an old response with the previous keys, or nothing at all, shows zeros rather than NaN", () => {
    const old = normalizeBuckets({ days0to30: 99, days31to60: 5 } as any);
    expect(old).toEqual({ current: 0, days1to30: 0, days31to60: 5, days61to90: 0, days90plus: 0 });
    expect(normalizeBuckets(undefined)).toEqual({
      current: 0,
      days1to30: 0,
      days31to60: 0,
      days61to90: 0,
      days90plus: 0,
    });
    expect(Number.isNaN(bucketTotal(normalizeBuckets({ current: NaN as any })))).toBe(false);
  });
});

describe("VAT due next", () => {
  it("shows an amount with its dates", () => {
    expect(vatDueView({ amount: 1250.5, periodEnd: "2026-09-30", dueDate: "2026-10-28" })).toEqual({
      kind: "amount",
      amount: 1250.5,
      periodEnd: "2026-09-30",
      dueDate: "2026-10-28",
    });
  });

  it("a zero amount is still an amount (nothing to pay this period)", () => {
    expect(vatDueView({ amount: 0, periodEnd: "2026-09-30", dueDate: "2026-10-28" }).kind).toBe(
      "amount"
    );
  });

  it("keeps the reason when the server cannot work it out, and never invents one", () => {
    expect(vatDueView({ amount: null, periodEnd: null, dueDate: null, reason: "NO_TRN" })).toEqual({
      kind: "none",
      reason: "NO_TRN",
    });
    expect(
      vatDueView({ amount: null, periodEnd: null, dueDate: null, reason: "EMIRATE_NOT_SET" })
    ).toEqual({ kind: "none", reason: "EMIRATE_NOT_SET" });
    expect(vatDueView(null)).toEqual({ kind: "none", reason: "UNAVAILABLE" });
    expect(
      vatDueView({ amount: null, periodEnd: null, dueDate: null, reason: "ANYTHING" as any })
    ).toEqual({ kind: "none", reason: "UNAVAILABLE" });
  });
});

describe("days and paths", () => {
  it("counts whole calendar days", () => {
    expect(daysUntil("2026-10-28", "2026-10-02")).toBe(26);
    expect(daysUntil("2026-10-01", "2026-10-02")).toBe(-1);
    expect(daysUntil("2026-10-02", "2026-10-02")).toBe(0);
  });

  it("asks for a period, never all time", () => {
    expect(dashboardStatsPath("c1", "ytd")).toBe("/api/companies/c1/dashboard/stats?period=ytd");
  });
});
