import { describe, expect, it } from "vitest";
import {
  addMonths,
  applyCollectionRate,
  buildInsights,
  buildWeeks,
  expectedDate,
  payrollDates,
  recurringRunDates,
  type ForecastItem,
} from "../../server/services/cashflow-forecast-math";

const item = (date: string, amount: number, type: ForecastItem["type"] = "invoice"): ForecastItem => ({ date, type, sourceId: null, label: type, amount, originalDate: date });

describe("forecast dates", () => {
  it("shifts by the delay and pulls anything already late to today", () => {
    expect(expectedDate("2026-10-12", 0, "2026-10-02")).toBe("2026-10-12");
    expect(expectedDate("2026-10-12", 15, "2026-10-02")).toBe("2026-10-27");
    expect(expectedDate("2026-09-01", 0, "2026-10-02")).toBe("2026-10-02");
    expect(expectedDate("2026-10-12", -5, "2026-10-02")).toBe("2026-10-07");
  });
  it("adds months without overflowing short months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
  });
  it("expands recurring templates up to the horizon and their end date", () => {
    expect(recurringRunDates({ nextRunDate: "2026-10-05", frequency: "monthly", until: "2027-01-10" })).toEqual(["2026-10-05", "2026-11-05", "2026-12-05", "2027-01-05"]);
    expect(recurringRunDates({ nextRunDate: "2026-10-05", frequency: "weekly", endDate: "2026-10-19", until: "2027-01-10" })).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
  });
  it("lists pay days in the window", () => {
    expect(payrollDates("2026-10-02", "2026-12-31", 28)).toEqual(["2026-10-28", "2026-11-28", "2026-12-28"]);
    expect(payrollDates("2026-10-29", "2026-12-31", 28)).toEqual(["2026-11-28", "2026-12-28"]);
  });
  it("collection rate keeps the cents", () => {
    expect(applyCollectionRate(1000, 80)).toBe(800);
    expect(applyCollectionRate(333.33, 50)).toBe(166.67);
  });
});

describe("D3-10 weekly buckets", () => {
  const today = "2026-10-02";
  const items = [item("2026-10-12", 1000), item("2026-10-22", -400, "bill"), item("2026-11-02", 500, "recurring"), item("2026-10-28", -6000, "payroll")];

  it("buckets inflows, outflows and the running balance", () => {
    const { weeks } = buildWeeks({ today, days: 90, openingBalance: 10_000, items });
    expect(weeks).toHaveLength(13);
    expect(weeks[1]).toMatchObject({ weekStart: "2026-10-09", inflows: 1000, outflows: 0, closingBalance: 11_000 });
    expect(weeks[2]).toMatchObject({ outflows: 400 });
    expect(weeks[3]).toMatchObject({ outflows: 6000 });
    expect(weeks[4]).toMatchObject({ inflows: 500 });
    expect(weeks[12].closingBalance).toBe(10_000 + 1000 - 400 - 6000 + 500);
  });

  it("a 15 day delay moves the receipt to a later week", () => {
    const shifted = [item(expectedDate("2026-10-12", 15, today), 1000)];
    const { weeks } = buildWeeks({ today, days: 90, openingBalance: 0, items: shifted });
    expect(weeks.findIndex((w) => w.inflows === 1000)).toBe(3);
  });

  it("drops items beyond the horizon and before today", () => {
    const { items: kept } = buildWeeks({ today, days: 14, openingBalance: 0, items: [item("2026-10-01", 5), item("2026-10-10", 7), item("2026-11-30", 9)] });
    expect(kept.map((i) => i.amount)).toEqual([7]);
  });
});

describe("insights", () => {
  it("flags a negative balance with the week and an empty forecast", () => {
    const { weeks } = buildWeeks({ today: "2026-10-02", days: 14, openingBalance: 100, items: [item("2026-10-09", -500, "bill")] });
    const codes = buildInsights({ openingBalance: 100, weeks, overdueAmount: 0, overdueCount: 0, receivable: 0, payable: 500, itemCount: 1 }).map((i) => i.code);
    expect(codes).toContain("NEGATIVE_BALANCE");
    expect(codes).toContain("PAYABLES_DUE");
    expect(buildInsights({ openingBalance: 0, weeks: [], overdueAmount: 0, overdueCount: 0, receivable: 0, payable: 0, itemCount: 0 }).map((i) => i.code)).toEqual(["NO_ACTIVITY"]);
  });
});
