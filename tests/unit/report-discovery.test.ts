import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  liveReportCatalog,
  reportAutomationPlaybookHref,
  reportCatalog,
  reportHref,
  reportPersonas,
  reportPersonaWorkspaces,
  reportTabs,
  reportWorkspaceHref,
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

    expect(reportPersonas).toEqual(["owner", "freelancer", "accountant"]);

    for (const persona of reportPersonas) {
      expect(reportCatalog.some((report) => report.personas.includes(persona))).toBe(true);
      expect(reportPersonaWorkspaces.some((workspace) => workspace.persona === persona)).toBe(true);
      expect(catalogSource).toContain(`persona: "${persona}"`);
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

  it("exposes persona report workspaces through deep links and global search", () => {
    expect(reportPersonaWorkspaces.map((workspace) => workspace.persona)).toEqual([
      "owner",
      "freelancer",
      "accountant",
    ]);
    expect(commandSource).toContain("reportPersonaWorkspaces.map");
    expect(commandSource).toContain("id: `report-workspace-${workspace.persona}`");
    expect(commandSource).toContain("href: reportWorkspaceHref(workspace)");
    expect(reportsSource).toContain("function personaFilterFromSearch(search: string)");
    expect(reportsSource).toContain("return reportPersonas.includes(persona as ReportPersona)");
    expect(reportsSource).toContain("navigate(reportWorkspaceHref(workspace))");

    for (const workspace of reportPersonaWorkspaces) {
      expect(reportWorkspaceHref(workspace)).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}`
      );
    }
  });

  it("keeps persona automation playbooks tied to real reports and workflows", () => {
    expect(reportsSource).toContain("Automation playbooks");
    expect(reportsSource).toContain("workspace.automations.length");
    expect(reportsSource).toContain("reportAutomationPlaybookHref(playbook, workspace.persona)");

    const allReportIds = new Set(reportCatalog.map((report) => report.id));
    const liveReportIds = new Set(liveReportCatalog.map((report) => report.id));

    for (const workspace of reportPersonaWorkspaces) {
      expect(workspace.automations).toHaveLength(3);

      for (const playbook of workspace.automations) {
        expect(playbook.id).toContain(workspace.persona);
        expect(playbook.reportIds.length).toBeGreaterThanOrEqual(3);
        expect(reportAutomationPlaybookHref(playbook, workspace.persona)).toBeTruthy();
        expect(playbook.href || playbook.tab).toBeTruthy();

        for (const reportId of playbook.reportIds) {
          expect(allReportIds.has(reportId)).toBe(true);
        }

        const liveReportCount = playbook.reportIds.filter((reportId) =>
          liveReportIds.has(reportId)
        ).length;
        expect(liveReportCount).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("offers persona report packs with an index and automation workbook", () => {
    expect(reportsSource).toContain("buildWorkspaceReportPack");
    expect(reportsSource).toContain("handleExportWorkspacePack");
    expect(reportsSource).toContain("handleExportWorkspacePackToSheets");
    expect(reportsSource).toContain("Pack Index");
    expect(reportsSource).toContain("Pack Summary");
    expect(reportsSource).toContain("Comparison Snapshot");
    expect(reportsSource).toContain("Pack Cadence");
    expect(reportsSource).toContain("Pack Automation Status");
    expect(reportsSource).toContain("Automation Playbooks");
    expect(reportsSource).toContain("comparisonCurrentLabel");
    expect(reportsSource).toContain("comparisonPreviousLabel");
    expect(reportsSource).toContain("packComparisonRows");
    expect(reportsSource).toContain("Amount at risk");
    expect(reportsSource).toContain("Included in workbook");
    expect(reportsSource).toContain("Open workflow");
    expect(reportsSource).toContain("reportHref(report) ?? reportWorkspaceHref(workspace)");
    expect(reportsSource).toContain("reportAutomationPlaybookHref(playbook, workspace.persona)");
    expect(reportsSource).toContain("button-export-workspace-pack-${workspace.persona}");
    expect(reportsSource).toContain("button-export-workspace-pack-sheets-${workspace.persona}");
    expect(reportsSource).toContain("exportToGoogleSheets(");
    expect(reportsSource).toContain("Export pack");
    expect(reportsSource).toContain("Sheets pack");
    expect(reportsSource).toContain("Report pack automation");
    expect(reportsSource).toContain("reportPackAutomationQueue");
    expect(reportsSource).toContain("visibleReportPackAutomation");
    expect(reportsSource).toContain("reportPacksNeedingReview");
    expect(reportsSource).toContain("Review before send");
    expect(reportsSource).toContain("Send pack");

    for (const workspace of reportPersonaWorkspaces) {
      expect(
        reportCatalog.filter((report) => report.personas.includes(workspace.persona)).length
      ).toBeGreaterThan(0);
      expect(workspace.packSchedule.cadence).toBeTruthy();
      expect(workspace.packSchedule.delivery).toBeTruthy();
      expect(workspace.packSchedule.recipients).toBeTruthy();
      expect(workspace.packSchedule.trigger).toBeTruthy();
      expect(workspace.packSchedule.automation).toBeTruthy();
      expect(workspace.automations).toHaveLength(3);
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

    for (const metricId of [
      "revenue",
      "net-profit",
      "invoice-value",
      "expense-spend",
      "vat-due",
      "ledger-activity",
    ]) {
      expect(reportsSource).toContain(`id: "${metricId}"`);
    }

    for (const signal of [
      "Growth",
      "Profitability",
      "Sales activity",
      "Cost pressure",
      "Tax cash flow",
      "Close activity",
    ]) {
      expect(reportsSource).toContain(`signal: "${signal}"`);
    }
  });

  it("filters comparison and automation signals by selected persona", () => {
    expect(reportsSource).toContain("function matchesReportPersona");
    expect(reportsSource).toContain("personaScopeDescription");
    expect(reportsSource).toContain("visibleComparisonRows");
    expect(reportsSource).toContain("visibleAutomationQueue");
    expect(reportsSource).toContain(
      "comparisonRows.filter((row) => matchesReportPersona(row.personas, personaFilter))"
    );
    expect(reportsSource).toContain(
      "automationQueue.filter((item) => matchesReportPersona(item.personas, personaFilter))"
    );
    expect(reportsSource).toContain('personas: ["accountant"]');
  });

  it("surfaces report-driven automation queues for next actions", () => {
    expect(reportsSource).toContain("Automation queues");
    expect(reportsSource).toContain("Live report signals routed to the next workflow.");
    expect(reportsSource).toContain("Automation coverage");
    expect(reportsSource).toContain("automationCoverageSummary");
    expect(reportsSource).toContain("visibleAutomationCoverage");
    expect(reportsSource).toContain("Role coverage across live reports");
    expect(reportsSource).toContain("Signal coverage");
    expect(reportsSource).toContain("Pack automation");
    expect(reportsSource).toContain("automation-coverage-${workspace.persona}");
    expect(reportsSource).toContain("workflowReportCount");
    expect(reportsSource).toContain("comparisonTypeCount");
    expect(reportsSource).toContain("automatedSignalCount");
    expect(reportsSource).toContain("openWorkItemCount");

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
    expect(reportsSource).toContain("visibleComparisonRows.map((row)");
    expect(reportsSource).toContain("matchesReportPersona(row.personas, personaFilter)");
    expect(reportsSource).toContain("formatComparisonPercent(row.percentChange)");
    expect(reportsSource).toContain("comparisonBadgeVariant(row)");
    expect(reportsSource).toContain("setActiveTab(row.tab)");

    for (const metric of [
      'id: "revenue"',
      'id: "net-profit"',
      'id: "invoice-value"',
      'id: "expense-spend"',
      'id: "vat-due"',
      'id: "ledger-activity"',
    ]) {
      expect(reportsSource).toContain(metric);
    }
  });
});
