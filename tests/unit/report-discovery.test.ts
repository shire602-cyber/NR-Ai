import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  liveReportCatalog,
  parseReportPersona,
  reportAutomationPlaybookHref,
  reportCatalog,
  reportHref,
  reportPersonas,
  reportPersonaWorkspaces,
  reportSectionHref,
  reportTabs,
  reportWorkspaceHref,
} from "../../client/src/lib/reportCatalog";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("report discoverability", () => {
  const catalogSource = read("client/src/lib/reportCatalog.ts");
  const commandSource = read("client/src/components/CommandPalette.tsx");
  const mobileNavSource = read("client/src/components/MobileNav.tsx");
  const onboardingSource = read("client/src/pages/Onboarding.tsx");
  const sidebarSource = read("client/src/components/layout/AppSidebar.tsx");
  const i18nSource = read("client/src/lib/i18n.ts");
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
    expect(catalogSource).toContain("REPORT_PERSONA_PREFERENCE_KEY");
    expect(catalogSource).toContain("getPreferredReportPersona");
    expect(catalogSource).toContain("setPreferredReportPersona");
    expect(catalogSource).toContain("clearPreferredReportPersona");
    expect(mobileNavSource).toContain("reportPersonaWorkspaces.map");
    expect(mobileNavSource).toContain("workspace.navLabel");
    expect(mobileNavSource).toContain("reportWorkspaceHref(workspace)");
    expect(onboardingSource).toContain("reportPersonaWorkspaces.map");
    expect(onboardingSource).toContain("workspace.navLabel");
    expect(onboardingSource).toContain("getPreferredReportPersona() ??");
    expect(onboardingSource).toContain('?? "owner"');
    expect(onboardingSource).toContain("setSelectedPersona(workspace.persona)");
    expect(onboardingSource).toContain("setPreferredReportPersona(workspace.persona)");
    expect(onboardingSource).toContain("setPreferredReportPersona(selectedWorkspace.persona)");
    expect(onboardingSource).toContain('data-testid="onboarding-report-workspaces"');
    expect(onboardingSource).toContain("onboarding-report-workspace-${workspace.persona}");
    expect(onboardingSource).toContain('data-testid="onboarding-open-report-workspace"');
    expect(onboardingSource).toContain("reportWorkspaceHref(selectedWorkspace)");
    expect(onboardingSource).toContain("workspace.automations.length");
    expect(sidebarSource).toContain("reportPersonaWorkspaces.map");
    expect(sidebarSource).toContain("reportWorkspaceHref(workspace)");
    expect(sidebarSource).toContain("reportWorkspaceTitleKeys[workspace.persona]");
    expect(i18nSource).toContain("ownerReports");
    expect(i18nSource).toContain("freelancerReports");
    expect(i18nSource).toContain("accountantReports");
    expect(reportsSource).toContain("function personaFilterFromSearch(");
    expect(reportsSource).toContain("fallbackPersona: ReportPersona | null = null");
    expect(reportsSource).toContain("getPreferredReportPersona()");
    expect(reportsSource).toContain("setPreferredReportPersonaState");
    expect(reportsSource).toContain("clearPreferredReportPersona()");
    expect(reportsSource).toContain("setPreferredReportPersona(persona)");
    expect(reportsSource).toContain("personaFilterFromSearch(");
    expect(reportsSource).toContain("locationSearch || window.location.search");
    expect(reportsSource).toContain("preferredReportPersona");
    expect(reportsSource).toContain("return reportPersonas.includes(persona as ReportPersona)");
    expect(reportsSource).toContain("navigate(reportWorkspaceHref(workspace))");

    expect(parseReportPersona("owner")).toBe("owner");
    expect(parseReportPersona("freelancer")).toBe("freelancer");
    expect(parseReportPersona("accountant")).toBe("accountant");
    expect(parseReportPersona("all")).toBeNull();
    expect(parseReportPersona(null)).toBeNull();

    for (const workspace of reportPersonaWorkspaces) {
      expect(reportWorkspaceHref(workspace)).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}`
      );
      expect(workspace.navLabel).toContain("Reports");
    }
  });

  it("exposes persona pack workflows through global search", () => {
    expect(commandSource).toContain('reportSectionHref(workspace, "recommendations")');
    expect(commandSource).toContain('reportSectionHref(workspace, "pack-readiness")');
    expect(commandSource).toContain('reportSectionHref(workspace, "pack-automation")');
    expect(commandSource).toContain("id: `report-recommendations-${workspace.persona}`");
    expect(commandSource).toContain("id: `report-pack-readiness-${workspace.persona}`");
    expect(commandSource).toContain("id: `report-pack-automation-${workspace.persona}`");
    expect(commandSource).toContain("Recommended reports - ${workspace.title}");
    expect(commandSource).toContain("Report pack readiness - ${workspace.title}");
    expect(commandSource).toContain("Report pack automation - ${workspace.title}");

    for (const workspace of reportPersonaWorkspaces) {
      expect(reportSectionHref(workspace, "recommendations")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#recommended-reports-title`
      );
      expect(reportSectionHref(workspace, "pack-readiness")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#report-pack-readiness-title`
      );
      expect(reportSectionHref(workspace, "pack-automation")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#report-pack-automation-title`
      );
    }
  });

  it("keeps persona automation playbooks tied to real reports and workflows", () => {
    expect(reportsSource).toContain("Automation playbooks");
    expect(reportsSource).toContain("workspace.automations.length");
    expect(reportsSource).toContain("reportAutomationPlaybookHref(playbook, workspace.persona)");
    expect(commandSource).toContain("reportPersonaWorkspaces.flatMap");
    expect(commandSource).toContain("id: `report-automation-${playbook.id}`");
    expect(commandSource).toContain("label: `${playbook.title} - ${workspace.title}`");
    expect(commandSource).toContain(
      "href: reportAutomationPlaybookHref(playbook, workspace.persona)"
    );
    expect(commandSource).toContain("automation playbook report pack");

    const allReportIds = new Set(reportCatalog.map((report) => report.id));
    const liveReportIds = new Set(liveReportCatalog.map((report) => report.id));

    for (const workspace of reportPersonaWorkspaces) {
      expect(workspace.automations).toHaveLength(3);

      for (const playbook of workspace.automations) {
        expect(playbook.id).toContain(workspace.persona);
        expect(playbook.reportIds.length).toBeGreaterThanOrEqual(3);
        expect(reportAutomationPlaybookHref(playbook, workspace.persona)).toBeTruthy();
        expect(playbook.href || playbook.tab).toBeTruthy();
        expect(commandSource).toContain("playbook.reportIds.join");

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
    expect(reportsSource).toContain("Recommended Actions");
    expect(reportsSource).toContain("Delivery Checklist");
    expect(reportsSource).toContain("Report pack readiness");
    expect(reportsSource).toContain("Comparison Snapshot");
    expect(reportsSource).toContain("Pack Cadence");
    expect(reportsSource).toContain("Pack Automation Status");
    expect(reportsSource).toContain("Automation Playbooks");
    expect(reportsSource).toContain("comparisonCurrentLabel");
    expect(reportsSource).toContain("comparisonPreviousLabel");
    expect(reportsSource).toContain("packComparisonRows");
    expect(reportsSource).toContain("packRecommendations");
    expect(reportsSource).toContain("Recommended actions");
    expect(reportsSource).toContain("reportPackDeliveryReadiness");
    expect(reportsSource).toContain("visibleReportPackReadiness");
    expect(reportsSource).toContain("reportPackReadinessNeedingReview");
    expect(reportsSource).toContain("reportPackReviewCount");
    expect(reportsSource).toContain("pack-readiness-${workspace.persona}");
    expect(reportsSource).toContain("Delivery checks");
    expect(reportsSource).toContain("Checks needing review");
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

  it("surfaces persona next-best report recommendations", () => {
    expect(reportsSource).toContain("Recommended reports");
    expect(reportsSource).toContain("Next-best report actions");
    expect(reportsSource).toContain("personaReportRecommendations");
    expect(reportsSource).toContain("visiblePersonaRecommendations");
    expect(reportsSource).toContain("recommended-reports-${workspace.persona}");
    expect(reportsSource).toContain("queue-${workspace.persona}-${item.id}");
    expect(reportsSource).toContain("comparison-${workspace.persona}-${row.id}");
    expect(reportsSource).toContain("primary-${workspace.persona}-${workspace.topReadyReport.id}");
    expect(reportsSource).toContain("formatComparisonPercent(row.percentChange)");
    expect(reportsSource).toContain("comparisonBadgeVariant(row)");
    expect(reportsSource).toContain("reportStatusMeta[workspace.topReadyReport.status]");
    expect(reportsSource).toContain("recommendations.slice(0, 3)");
  });

  it("filters comparison and automation signals by selected persona", () => {
    expect(reportsSource).toContain("function matchesReportPersona");
    expect(reportsSource).toContain("Role focus");
    expect(reportsSource).toContain("Reporting role focus");
    expect(reportsSource).toContain("personaScopeDescription");
    expect(reportsSource).toContain("visibleComparisonRows");
    expect(reportsSource).toContain("visibleAutomationQueue");
    expect(reportsSource).toContain("button-role-focus-${filter.id}");
    expect(reportsSource).toContain("setReportPersonaFilter(filter.id)");
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
