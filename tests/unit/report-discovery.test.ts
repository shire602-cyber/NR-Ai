import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  liveReportCatalog,
  reportCatalog,
  reportHref,
  reportTabs,
} from "../../client/src/lib/reportCatalog";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("report discoverability", () => {
  const catalogSource = read("client/src/lib/reportCatalog.ts");
  const commandSource = read("client/src/components/CommandPalette.tsx");
  const reportsSource = read("client/src/pages/Reports.tsx");

  const expectedLiveReports = [
    "Profit & Loss",
    "Balance Sheet",
    "VAT Summary",
    "Cash Flow Statement",
    "A/R Aging",
    "A/P Aging",
    "Trial Balance",
    "VAT Return",
    "Period Comparison",
    "FX Gains and Losses",
    "General Ledger",
    "Account Transactions",
    "Customer Balance Summary",
    "Vendor Balance Summary",
    "Invoice Status",
    "Budget vs Actual",
    "Cash Flow Forecast",
    "Revenue by Customer",
    "Expenses by Vendor",
    "Expenses by Category",
  ];

  it("keeps the Reports catalog at 20 live high-level reports", () => {
    expect(liveReportCatalog).toHaveLength(20);

    for (const label of expectedLiveReports) {
      expect(liveReportCatalog.map((report) => report.name)).toContain(label);
    }

    for (const persona of ["owner", "freelancer", "accountant"] as const) {
      expect(reportCatalog.some((report) => report.personas.includes(persona))).toBe(true);
      expect(reportsSource).toContain(`persona: "${persona}"`);
      expect(reportsSource).toContain(`id: "${persona}"`);
    }
  });

  it("exposes all live reports through the global command palette", () => {
    expect(commandSource).toContain('group: "Reports"');
    expect(commandSource).toContain("liveReportCatalog.map");
    expect(commandSource).toContain("id: `report-${report.id}`");
    expect(commandSource).toContain("href: reportHref(report)");

    for (const report of liveReportCatalog) {
      expect(reportHref(report)).toBeTruthy();
    }

    for (const href of [
      "/reports?tab=pl",
      "/reports?tab=bs",
      "/reports?tab=vat",
      "/reports?tab=trial",
      "/reports?tab=sales",
      "/reports?tab=balances",
      "/reports?tab=expenses",
      "/reports?tab=ledger",
      "/reports?tab=planning",
    ]) {
      expect(liveReportCatalog.map((report) => reportHref(report))).toContain(href);
    }
  });

  it("keeps report tab deep links bounded to known Reports tabs", () => {
    expect(reportTabs).toEqual([
      "pl",
      "bs",
      "vat",
      "trial",
      "sales",
      "balances",
      "expenses",
      "ledger",
      "planning",
    ]);
    expect(catalogSource).toContain("type ReportTab = (typeof reportTabs)[number]");
    expect(reportsSource).toContain("function reportTabFromSearch(search: string): ReportTab");
    expect(reportsSource).toContain("return reportTabs.includes(tab as ReportTab)");
    expect(reportsSource).toContain(': "pl"');

    for (const tab of reportTabs) {
      expect(reportsSource).toContain(`value="${tab}"`);
    }
  });

  it("surfaces current-vs-prior comparison snapshots", () => {
    expect(reportsSource).toContain("Comparison snapshots");
    expect(reportsSource).toContain("Current vs prior period");
    expect(reportsSource).toContain("buildComparisonRanges(dateRange)");

    for (const metricId of ["revenue", "net-profit", "invoice-value", "expense-spend", "vat-due"]) {
      expect(reportsSource).toContain(`id: "${metricId}"`);
    }

    for (const signal of [
      "Growth",
      "Profitability",
      "Sales activity",
      "Cost pressure",
      "Tax cash flow",
    ]) {
      expect(reportsSource).toContain(`signal: "${signal}"`);
    }
  });

  it("surfaces report-driven automation queues for next actions", () => {
    expect(reportsSource).toContain("Automation queues");
    expect(reportsSource).toContain("Live report signals routed to the next workflow.");

    for (const queueId of [
      "collections",
      "bill-pay",
      "receipt-posting",
      "vat-readiness",
      "close-review",
      "planning-risk",
    ]) {
      expect(reportsSource).toContain(`id: "${queueId}"`);
    }

    for (const destination of [
      'href: "/payment-chasing"',
      'href: "/bill-pay?tab=summary"',
      'href: "/vat-filing"',
      'tab: "expenses"',
      'tab: "planning"',
    ]) {
      expect(reportsSource).toContain(destination);
    }
    expect(reportsSource).toContain(
      'tab: closeReviewCount > 0 && !trialBalanceSummary.isBalanced ? "trial" : "ledger"'
    );
  });

  it("renders period comparison rows instead of leaving comparison signals hidden", () => {
    expect(reportsSource).toContain("Period comparison");
    expect(reportsSource).toContain("comparisonRows.map((row)");
    expect(reportsSource).toContain("formatComparisonPercent(row.percentChange)");
    expect(reportsSource).toContain("comparisonBadgeVariant(row)");
    expect(reportsSource).toContain("setActiveTab(row.tab)");

    for (const metric of [
      'id: "revenue"',
      'id: "net-profit"',
      'id: "invoice-value"',
      'id: "expense-spend"',
      'id: "vat-due"',
    ]) {
      expect(reportsSource).toContain(metric);
    }
  });
});
