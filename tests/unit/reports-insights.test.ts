/**
 * WP-D (spec 3.11): Reports > Insights replaces /analytics, /advanced-analytics and
 * /advanced-reports. Behaviour of the routing, period and delta helpers the views share.
 */
import { describe, expect, it } from "vitest";
import {
  COMPARISON_METRIC_KEYS,
  analyticsRedirectTarget,
  comparisonDelta,
  insightsViewFromSearch,
  periodWindow,
  reportsModeFromSearch,
  trailingYearStart,
} from "../../client/src/pages/reports/insights/model";
import en from "../../client/src/locales/en/analytics.json";
import ar from "../../client/src/locales/ar/analytics.json";

describe("legacy analytics routes forward to Insights", () => {
  it("maps every old view and tab to an Insights view", () => {
    expect(analyticsRedirectTarget("")).toBe("/reports?workspace=insights&view=cash-flow");
    expect(analyticsRedirectTarget("?view=overview")).toBe(
      "/reports?workspace=insights&view=cash-flow"
    );
    expect(analyticsRedirectTarget("?view=advanced")).toBe(
      "/reports?workspace=insights&view=cash-flow"
    );
    expect(analyticsRedirectTarget("?view=advanced&tab=budget")).toBe(
      "/reports?workspace=insights&view=budget"
    );
    expect(analyticsRedirectTarget("?view=reports&tab=aging")).toBe(
      "/reports?workspace=insights&view=ageing"
    );
    expect(analyticsRedirectTarget("?view=reports&tab=comparison")).toBe(
      "/reports?workspace=insights&view=comparison"
    );
  });

  it("reads the Reports mode and the Insights view from the query string", () => {
    expect(reportsModeFromSearch("")).toBe("reports");
    expect(reportsModeFromSearch("?workspace=home")).toBe("reports");
    expect(reportsModeFromSearch("?workspace=insights&view=budget")).toBe("insights");
    expect(insightsViewFromSearch("?view=ageing")).toBe("ageing");
    expect(insightsViewFromSearch("?view=usage")).toBe("cash-flow");
  });
});

describe("period windows", () => {
  const today = new Date(2026, 10, 17); // 17 Nov 2026
  it("matches the server's calendar windows", () => {
    expect(periodWindow("month", today)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(periodWindow("quarter", today)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodWindow("year", today)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodWindow("quarter", new Date(2026, 1, 3))).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
    expect(trailingYearStart(today)).toBe("2025-12-01");
  });
});

describe("comparison deltas", () => {
  const m = (metric: string, current: number, previous: number, changePercent: number) => ({
    metric,
    current,
    previous,
    change: current - previous,
    changePercent,
  });
  it("tones by meaning: revenue up is good, expenses up is bad", () => {
    expect(comparisonDelta(m("Total Revenue", 120, 100, 20), "vs Q3")).toMatchObject({
      label: "+20.0%",
      direction: "up",
      tone: "positive",
    });
    expect(comparisonDelta(m("Total Expenses", 120, 100, 20), "vs Q3")).toMatchObject({
      direction: "up",
      tone: "negative",
    });
    expect(comparisonDelta(m("Total Expenses", 80, 100, -20), "vs Q3")?.tone).toBe("positive");
  });

  it("shows no delta when there is nothing to compare with", () => {
    expect(comparisonDelta(m("Net Profit", 50, 0, 0), "vs Q3")).toBeUndefined();
  });

  it("every server metric name has an English and Arabic label (no raw metric names)", () => {
    const enCat = en as Record<string, string>;
    const arCat = ar as Record<string, string>;
    for (const key of Object.values(COMPARISON_METRIC_KEYS)) {
      expect(enCat[key]).toBeTruthy();
      expect(arCat[key]).toMatch(/[؀-ۿ]/);
    }
  });
});
