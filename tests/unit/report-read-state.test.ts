// F03 (report read state) and F05 (cash-flow panel states).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { reportReadState, unreadableReportIds } from "../../client/src/lib/reportReadState";

describe("F03 reportReadState", () => {
  it("failed initial read is error, never a zero-valued ready state", () => {
    expect(reportReadState({ isLoading: false, isError: true, hasData: false })).toBe("error");
  });
  it("failed refetch with last-known data is stale", () => {
    expect(reportReadState({ isLoading: false, isError: true, hasData: true })).toBe("stale");
  });
  it("successful read (even an empty ledger) is ready", () => {
    expect(reportReadState({ isLoading: false, isError: false, hasData: true })).toBe("ready");
  });
  it("pending read is loading; disabled is idle", () => {
    expect(reportReadState({ isLoading: true, isError: false, hasData: false })).toBe("loading");
    expect(reportReadState({ enabled: false, isLoading: false, isError: false, hasData: false })).toBe(
      "idle"
    );
  });
  it("unreadableReportIds lists only failed reports", () => {
    expect(
      unreadableReportIds(["profit-loss", "balance-sheet", "ar-aging"], {
        "profit-loss": "error",
        "balance-sheet": "stale",
      })
    ).toEqual(["profit-loss"]);
  });
});

describe("F03 Reports page source invariants", () => {
  const src = readFileSync("client/src/pages/Reports.tsx", "utf8");
  it("P&L, balance sheet and VAT render an error branch with retry", () => {
    expect(src.match(/plReadState === "error"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(src).toContain('bsReadState === "error"');
    expect(src).toContain('vatReadState === "error"');
    expect(src).toContain("onRetry={() => refetchProfitLoss()}");
  });
  it("exports refuse failed reads", () => {
    expect(src).toContain("unreadableReportIds(");
    expect(src).toMatch(/coreReportReadStates\[activeCoreReportId\] === "error"/);
  });
  it("report queries are keyed by company and period and do not keep previous data", () => {
    expect(src).toContain('queryKey: ["/api/companies", selectedCompanyId, "reports", "pl", dateParams]');
    const opts = src.slice(src.indexOf("const reportQueryOptions"), src.indexOf("const reportQueryOptions") + 300);
    expect(opts).not.toMatch(/placeholderData|keepPreviousData/);
  });
});

describe("F05 CashFlowForecast panel states", () => {
  const src = readFileSync("client/src/pages/CashFlowForecast.tsx", "utf8");
  it("forecast and history each have their own error + retry, distinct from empty", () => {
    expect(src).toContain('testId="cashflow-forecast-error"');
    expect(src).toContain('testId="cashflow-projections-error"');
    expect(src).toContain('testId="cashflow-history-error"');
    expect(src).toContain('data-testid="cashflow-history-empty"');
    expect(src).toContain("onRetry={() => refetchHistory()}");
    // History error branch precedes the empty branch.
    expect(src.indexOf("isHistoryError ? (")).toBeLessThan(src.indexOf("cashflow-history-empty"));
  });
});
