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

// After the W5-A refactor the monolithic Reports.tsx was split into tab modules and hooks.
// Source checks target the files that now carry the implementations.
describe("F03 Reports page source invariants", () => {
  const plTabSrc = readFileSync(
    "client/src/pages/reports/tabs/ProfitLossTab.tsx",
    "utf8"
  );
  const bsTabSrc = readFileSync(
    "client/src/pages/reports/tabs/BalanceSheetTab.tsx",
    "utf8"
  );
  const vatTabSrc = readFileSync(
    "client/src/pages/reports/tabs/VatTab.tsx",
    "utf8"
  );
  const exportsSrc = readFileSync(
    "client/src/pages/reports/hooks/useReportsExports.ts",
    "utf8"
  );
  const dataQueriesSrc = readFileSync(
    "client/src/pages/reports/hooks/useReportsDataQueries.ts",
    "utf8"
  );

  it("P&L, balance sheet and VAT render an error branch with retry", () => {
    // Source-inspection: behaviour tests would require mocking react-query and the context.
    // plReadState === "error" guards 3 KPI cards + the detail card = 4 occurrences minimum.
    expect(plTabSrc.match(/plReadState === "error"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(bsTabSrc).toContain('bsReadState === "error"');
    expect(vatTabSrc).toContain('vatReadState === "error"');
    expect(plTabSrc).toContain("onRetry={() => refetchProfitLoss()}");
  });
  it("exports refuse failed reads", () => {
    // Source-inspection: gating logic lives in useReportsExports, not in a React component,
    // making a behaviour test impractical without a full hook harness.
    expect(exportsSrc).toContain("unreadableReportIds(");
    expect(exportsSrc).toMatch(/coreReportReadStates\[activeCoreReportId\] === "error"/);
  });
  it("report queries are keyed by company and period and do not keep previous data", () => {
    // Source-inspection: verifies the query key shape that react-query uses for cache separation.
    expect(dataQueriesSrc).toContain(
      'queryKey: ["/api/companies", selectedCompanyId, "reports", "pl", dateParams]'
    );
    const opts = dataQueriesSrc.slice(
      dataQueriesSrc.indexOf("const reportQueryOptions"),
      dataQueriesSrc.indexOf("const reportQueryOptions") + 300
    );
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
