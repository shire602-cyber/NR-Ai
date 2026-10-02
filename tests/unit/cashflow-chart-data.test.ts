import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCENARIO,
  buildChartData,
  isDefaultScenario,
  lowestBalance,
  scenarioIssues,
  scenarioQuery,
  weekLabel,
} from "../../client/src/components/cashflow/chart-data";
import type { ForecastWeek } from "../../client/src/lib/banking-api-types";

const weeks: ForecastWeek[] = [
  { weekStart: "2026-10-02", weekEnd: "2026-10-08", inflows: 1000, outflows: 400, net: 600, closingBalance: 10600 },
  { weekStart: "2026-10-09", weekEnd: "2026-10-15", inflows: 0, outflows: 6000, net: -6000, closingBalance: 4600 },
  { weekStart: "2026-10-16", weekEnd: "2026-10-22", inflows: 0, outflows: 5000, net: -5000, closingBalance: -400 },
];

describe("buildChartData", () => {
  it("plots outflows below the axis and keeps the closing balance as the line", () => {
    const data = buildChartData(weeks, "en");
    expect(data).toHaveLength(3);
    expect(data[0]).toMatchObject({ weekStart: "2026-10-02", inflows: 1000, outflows: -400, balance: 10600, negative: false });
    expect(data[2]).toMatchObject({ outflows: -5000, balance: -400, negative: true });
  });
  it("labels weeks by their first day in the active language, in UTC", () => {
    expect(weekLabel("2026-10-02", "en")).toBe("2 Oct");
    expect(weekLabel("2026-10-02", "ar")).toMatch(/2/);
  });
  it("is empty for no weeks", () => {
    expect(buildChartData([], "en")).toEqual([]);
  });
});

describe("lowestBalance", () => {
  it("finds the week where the balance is lowest", () => {
    expect(lowestBalance(weeks)).toEqual({ weekIndex: 2, weekStart: "2026-10-16", balance: -400 });
    expect(lowestBalance([])).toBeNull();
  });
});

describe("scenarioQuery", () => {
  it("always sends the horizon and every field, so the screen is what the server computes", () => {
    const q = new URLSearchParams(scenarioQuery(90, DEFAULT_SCENARIO));
    expect(q.get("days")).toBe("90");
    expect(q.get("receiptDelayDays")).toBe("0");
    expect(q.get("collectionRatePct")).toBe("100");
    expect(q.get("includePayroll")).toBe("true");
    expect(q.get("payrollPayDay")).toBe("28");
    expect(q.get("adjustments")).toBe("[]");
  });
  it("carries changed fields", () => {
    const q = new URLSearchParams(scenarioQuery(60, { ...DEFAULT_SCENARIO, receiptDelayDays: 15, includePayroll: false }));
    expect(q.get("days")).toBe("60");
    expect(q.get("receiptDelayDays")).toBe("15");
    expect(q.get("includePayroll")).toBe("false");
  });
  it("sends one-offs as JSON", () => {
    const adj = [{ date: "2026-10-20", amount: -2500, label: "Laptop" }];
    const q = new URLSearchParams(scenarioQuery(90, { ...DEFAULT_SCENARIO, adjustments: adj }));
    expect(JSON.parse(q.get("adjustments") as string)).toEqual(adj);
  });
});

describe("isDefaultScenario", () => {
  it("is true only for the untouched defaults", () => {
    expect(isDefaultScenario(DEFAULT_SCENARIO)).toBe(true);
    expect(isDefaultScenario({ ...DEFAULT_SCENARIO, collectionRatePct: 90 })).toBe(false);
    expect(isDefaultScenario({ ...DEFAULT_SCENARIO, adjustments: [{ date: "2026-10-20", amount: 1, label: "x" }] })).toBe(false);
  });
});

describe("scenarioIssues", () => {
  it("accepts the server's ranges", () => {
    expect(scenarioIssues(DEFAULT_SCENARIO)).toEqual([]);
    expect(scenarioIssues({ ...DEFAULT_SCENARIO, receiptDelayDays: -60, paymentDelayDays: 180, payrollPayDay: 1 })).toEqual([]);
  });
  it("flags values the server would refuse", () => {
    expect(scenarioIssues({ ...DEFAULT_SCENARIO, receiptDelayDays: 181 })).toContain("RECEIPT_DELAY_RANGE");
    expect(scenarioIssues({ ...DEFAULT_SCENARIO, paymentDelayDays: -61 })).toContain("PAYMENT_DELAY_RANGE");
    expect(scenarioIssues({ ...DEFAULT_SCENARIO, collectionRatePct: 101 })).toContain("COLLECTION_RATE_RANGE");
    expect(scenarioIssues({ ...DEFAULT_SCENARIO, payrollPayDay: 29 })).toContain("PAYROLL_DAY_RANGE");
    expect(scenarioIssues({ ...DEFAULT_SCENARIO, adjustments: [{ date: "bad", amount: 5, label: "x" }] })).toContain("ADJUSTMENT_INVALID");
    expect(scenarioIssues({ ...DEFAULT_SCENARIO, adjustments: [{ date: "2026-10-20", amount: 0, label: "x" }] })).toContain("ADJUSTMENT_INVALID");
    expect(scenarioIssues({ ...DEFAULT_SCENARIO, adjustments: Array.from({ length: 51 }, () => ({ date: "2026-10-20", amount: 1, label: "x" })) })).toContain("ADJUSTMENT_LIMIT");
  });
});
