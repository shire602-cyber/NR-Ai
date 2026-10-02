import { describe, expect, it } from "vitest";
import { latestPayslipRun, leaveSummary } from "./employee-summary";

const run = (y: number, m: number, status: string) => ({ id: `${y}-${m}`, period_year: y, period_month: m, status });

describe("latestPayslipRun", () => {
  it("picks the newest calculated-or-later month and skips drafts", () => {
    expect(latestPayslipRun([run(2026, 8, "paid"), run(2026, 9, "approved"), run(2026, 10, "draft")])?.id).toBe("2026-9");
    expect(latestPayslipRun([run(2025, 12, "paid"), run(2026, 1, "calculated")])?.id).toBe("2026-1");
  });
  it("returns null when there is nothing to show", () => {
    expect(latestPayslipRun([run(2026, 9, "draft")])).toBeNull();
    expect(latestPayslipRun(undefined)).toBeNull();
  });
  it("does not mutate its input", () => {
    const input = [run(2026, 1, "paid"), run(2026, 2, "paid")];
    latestPayslipRun(input);
    expect(input.map((r) => r.id)).toEqual(["2026-1", "2026-2"]);
  });
});

describe("leaveSummary", () => {
  it("rounds to half days and never shows a negative balance", () => {
    expect(leaveSummary([{ code: "ANNUAL", available: 12.26, balance: 12.26 }, { code: "SICK", available: -2, balance: -2 }])).toEqual([
      { code: "ANNUAL", days: 12.5 },
      { code: "SICK", days: 0 },
    ]);
    expect(leaveSummary(undefined)).toEqual([]);
  });
});
