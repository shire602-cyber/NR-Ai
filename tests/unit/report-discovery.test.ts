import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("report discoverability", () => {
  const commandSource = read("client/src/components/CommandPalette.tsx");
  const reportsSource = read("client/src/pages/Reports.tsx");
  const catalogSource = reportsSource.match(
    /const reportCatalog: ReportCatalogItem\[\] = \[([\s\S]*?)\];\n\nconst invoiceStatusLabels/
  )?.[1];

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
    expect(catalogSource).toBeDefined();
    expect(catalogSource?.match(/status: "live"/g)).toHaveLength(20);

    for (const label of expectedLiveReports) {
      expect(catalogSource).toContain(`name: "${label}"`);
    }

    for (const persona of ["owner", "freelancer", "accountant"]) {
      expect(reportsSource).toContain(`persona: "${persona}"`);
      expect(reportsSource).toContain(`id: "${persona}"`);
    }
  });

  it("exposes all live reports through the global command palette", () => {
    expect(commandSource).toContain('group: "Reports"');
    expect(commandSource.match(/id: "report-/g)).toHaveLength(20);

    for (const expected of [
      'href: "/reports?tab=pl"',
      'href: "/reports?tab=bs"',
      'href: "/reports?tab=vat"',
      'href: "/reports?tab=trial"',
      'href: "/reports?tab=sales"',
      'href: "/reports?tab=balances"',
      'href: "/reports?tab=expenses"',
      'href: "/reports?tab=ledger"',
      'href: "/reports?tab=planning"',
    ]) {
      expect(commandSource).toContain(expected);
    }

    for (const label of expectedLiveReports) {
      expect(commandSource).toContain(`label: "${label}"`);
    }
  });

  it("keeps report tab deep links bounded to known Reports tabs", () => {
    expect(reportsSource).toContain("const reportTabs = [");
    expect(reportsSource).toContain("type ReportTab = (typeof reportTabs)[number]");
    expect(reportsSource).toContain("function reportTabFromSearch(search: string): ReportTab");
    expect(reportsSource).toContain("return reportTabs.includes(tab as ReportTab)");
    expect(reportsSource).toContain(': "pl"');

    for (const tab of [
      "pl",
      "bs",
      "vat",
      "trial",
      "sales",
      "balances",
      "expenses",
      "ledger",
      "planning",
    ]) {
      expect(reportsSource).toContain(`"${tab}"`);
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
