import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildReportAutomationHealthTrend,
  calculateReportAutomationHealth,
  liveReportCatalog,
  parseReportAutomationHealthHistory,
  REPORT_AUTOMATION_HEALTH_HISTORY_KEY,
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
  const dashboardSource = read("client/src/pages/Dashboard.tsx");
  const mobileNavSource = read("client/src/components/MobileNav.tsx");
  const onboardingSource = read("client/src/pages/Onboarding.tsx");
  const sidebarSource = read("client/src/components/layout/AppSidebar.tsx");
  const i18nSource = read("client/src/lib/i18n.ts");
  const reportsSource = read("client/src/pages/Reports.tsx");
  const exportSource = read("client/src/lib/export.ts");
  const reportsRouteSource = read("server/routes/reports.routes.ts");
  const fixedAssetsRouteSource = read("server/routes/fixed-assets.routes.ts");
  const inventoryRouteSource = read("server/routes/inventory.routes.ts");

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
    "Corporate Tax Estimate",
    "Customer Balance Summary",
    "Vendor Balance Summary",
    "Inventory Valuation",
    "Fixed Asset Register",
    "Invoice Status",
    "Month-End Close Status",
    "Budget vs Actual",
    "Cash Flow Forecast",
    "Revenue by Customer",
    "Sales by Product/Service",
    "Expenses by Vendor",
    "Expenses by Category",
  ];

  it("keeps the Reports catalog at 25 live high-level reports", () => {
    expect(liveReportCatalog).toHaveLength(25);

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
      "/reports?tab=tax",
      "/reports?tab=trial",
      "/reports?tab=sales",
      "/reports?tab=balances",
      "/reports?tab=expenses",
      "/reports?tab=ledger",
      "/reports?tab=close",
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
    expect(dashboardSource).toContain("getPreferredReportPersona() ??");
    expect(dashboardSource).toContain("preferredReportWorkspace");
    expect(dashboardSource).toContain("reportPersonaWorkspaces.find");
    expect(dashboardSource).toContain("preferredWorkspaceCatalogReports");
    expect(dashboardSource).toContain("preferredWorkspaceReports");
    expect(dashboardSource).toContain("preferredReportPackReadiness");
    expect(dashboardSource).toContain("dashboardComparisonRows");
    expect(dashboardSource).toContain("dashboardPercentChange");
    expect(dashboardSource).toContain("formatDashboardComparisonPercent");
    expect(dashboardSource).toContain("dashboardComparisonBadgeVariant");
    expect(catalogSource).toContain("calculateReportAutomationHealth");
    expect(dashboardSource).toContain("calculateReportAutomationHealth({");
    expect(dashboardSource).toContain("reportAutomationHealth");
    expect(dashboardSource).toContain('data-testid="dashboard-report-automation-health"');
    expect(dashboardSource).toContain("Automation health");
    expect(dashboardSource).toContain("Review automation health");
    expect(dashboardSource).toContain("comparisonWarnings");
    expect(dashboardSource).toContain("reviewSignals");
    expect(dashboardSource).toContain(
      "readinessPercent: preferredReportPackReadiness.readinessPercent"
    );
    expect(dashboardSource).toContain(
      "automationLaneCount: preferredReportPackReadiness.automationLanes"
    );
    expect(dashboardSource).toContain('data-testid="dashboard-comparison-snapshot"');
    expect(dashboardSource).toContain("Current vs prior month for this workspace.");
    expect(dashboardSource).toContain("comparisonOrder");
    expect(dashboardSource).toContain(
      'reportsHref({ tab: "sales", persona: preferredReportWorkspace.persona })'
    );
    expect(dashboardSource).toContain(
      'reportsHref({ tab: "expenses", persona: preferredReportWorkspace.persona })'
    );
    expect(dashboardSource).toContain(
      'reportsHref({ tab: "pl", persona: preferredReportWorkspace.persona })'
    );
    expect(dashboardSource).toContain("href={row.href}");
    expect(dashboardSource).toContain("Open <ArrowUpRight");
    expect(dashboardSource).toContain("reportCatalog");
    expect(dashboardSource).toContain('data-testid="dashboard-report-workspace"');
    expect(dashboardSource).toContain('data-testid="dashboard-open-report-workspace"');
    expect(dashboardSource).toContain('data-testid="dashboard-report-pack-readiness"');
    expect(dashboardSource).toContain("reportWorkspaceHref(preferredReportWorkspace)");
    expect(dashboardSource).toContain(
      'reportSectionHref(preferredReportWorkspace, "pack-readiness")'
    );
    expect(dashboardSource).toContain(
      'reportSectionHref(preferredReportWorkspace, "pack-automation")'
    );
    expect(dashboardSource).toContain("reportHref(report) ?? reportWorkspaceHref");
    expect(dashboardSource).toContain("reportAutomationPlaybookHref(");
    expect(dashboardSource).toContain("preferredReportWorkspace.packSchedule.cadence");
    expect(dashboardSource).toContain("preferredReportWorkspace.packSchedule.delivery");
    expect(dashboardSource).toContain("preferredReportWorkspace.packSchedule.automation");
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

    const ownerTaxPlaybook = reportPersonaWorkspaces
      .find((workspace) => workspace.persona === "owner")
      ?.automations.find((playbook) => playbook.id === "owner-vat-readiness");
    const accountantTaxPlaybook = reportPersonaWorkspaces
      .find((workspace) => workspace.persona === "accountant")
      ?.automations.find((playbook) => playbook.id === "accountant-tax-workpapers");

    expect(ownerTaxPlaybook?.reportIds).toContain("corporate-tax-estimate");
    expect(ownerTaxPlaybook?.tab).toBe("tax");
    expect(accountantTaxPlaybook?.reportIds).toContain("corporate-tax-estimate");
    expect(accountantTaxPlaybook?.tab).toBe("tax");
    const accountantClosePlaybook = reportPersonaWorkspaces
      .find((workspace) => workspace.persona === "accountant")
      ?.automations.find((playbook) => playbook.id === "accountant-close-review");

    const ownerCollectionsPlaybook = reportPersonaWorkspaces
      .find((workspace) => workspace.persona === "owner")
      ?.automations.find((playbook) => playbook.id === "owner-cash-collections");
    const accountantAdvisoryPlaybook = reportPersonaWorkspaces
      .find((workspace) => workspace.persona === "accountant")
      ?.automations.find((playbook) => playbook.id === "accountant-advisory-pack");

    expect(accountantClosePlaybook?.reportIds).toContain("month-end-close-status");
    expect(accountantClosePlaybook?.reportIds).toContain("inventory-valuation");
    expect(accountantClosePlaybook?.reportIds).toContain("fixed-asset-register");
    expect(accountantClosePlaybook?.tab).toBe("close");
    expect(ownerCollectionsPlaybook?.reportIds).toContain("sales-product-service");
    expect(accountantAdvisoryPlaybook?.reportIds).toContain("sales-product-service");
  });

  it("offers persona report packs with an index and automation workbook", () => {
    expect(reportsSource).toContain("buildWorkspaceReportPack");
    expect(reportsSource).toContain("handleExportWorkspacePack");
    expect(reportsSource).toContain("handleExportWorkspacePackToSheets");
    expect(reportsSource).toContain("Pack Index");
    expect(reportsSource).toContain("Pack Summary");
    expect(reportsSource).toContain("Recommended Actions");
    expect(reportsSource).toContain("Report Roadmap");
    expect(reportsSource).toContain("Automation Health");
    expect(reportsSource).toContain("Automation Health Trend");
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
    expect(reportsSource).toContain("reportRoadmap");
    expect(reportsSource).toContain("visibleReportRoadmap");
    expect(reportsSource).toContain("visiblePlannedReportCount");
    expect(reportsSource).toContain("plannedAutomationHooks");
    expect(reportsSource).toContain("plannedWorkflowDependencies");
    expect(reportsSource).toContain("prerequisiteCount");
    expect(reportsSource).toContain("topPriorityReport");
    expect(reportsSource).toContain("topPriorityImpact");
    expect(reportsSource).toContain("topPriorityScore");
    expect(reportsSource).toContain("Planned report gaps");
    expect(reportsSource).toContain("Roadmap prerequisites");
    expect(reportsSource).toContain("Roadmap status");
    expect(reportsSource).toContain("Top roadmap priority");
    expect(reportsSource).toContain("roadmapImpactMeta");
    expect(reportsSource).toContain("Priority Score");
    expect(reportsSource).toContain("Persona Impact");
    expect(reportsSource).toContain("Priority Rationale");
    expect(reportsSource).toContain("Automation Unlock");
    expect(reportsSource).toContain("Data Source Needed");
    expect(reportsSource).toContain("Workflow Dependency");
    expect(reportsSource).toContain("Automation Rule Needed");
    expect(reportsSource).toContain("report-roadmap-${workspace.persona}");
    expect(reportsSource).toContain("Next report unlocks");
    expect(reportsSource).toContain("Automation unlocks");
    expect(reportsSource).toContain("Workflow dependencies");
    expect(reportsSource).toContain("Data source:");
    expect(reportsSource).toContain("Automation rule:");
    expect(reportsSource).toContain("Open next workflow");
    expect(reportsSource).toContain("visibleReportPackReadiness");
    expect(reportsSource).toContain("reportPackReadinessNeedingReview");
    expect(reportsSource).toContain("calculateReportAutomationHealth");
    expect(catalogSource).toContain("REPORT_AUTOMATION_HEALTH_HISTORY_KEY");
    expect(catalogSource).toContain("parseReportAutomationHealthHistory");
    expect(catalogSource).toContain("recordReportAutomationHealthSnapshots");
    expect(catalogSource).toContain("buildReportAutomationHealthTrend");
    expect(reportsSource).toContain("automationHealth");
    expect(reportsSource).toContain("getReportAutomationHealthHistory");
    expect(reportsSource).toContain("recordReportAutomationHealthSnapshots");
    expect(reportsSource).toContain("reportAutomationHealthHistory");
    expect(reportsSource).toContain("reportAutomationHealthTrends");
    expect(reportsSource).toContain("visibleReportAutomationHealthTrends");
    expect(reportsSource).toContain("pack-automation-health-${workspace.persona}");
    expect(reportsSource).toContain("automation-health-trend-${item.workspace.persona}");
    expect(reportsSource).toContain("Automation health review signals");
    expect(reportsSource).toContain("Automation health trend");
    expect(reportsSource).toContain("Health trend");
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
    expect(reportsSource).toContain("prepareCorporateTaxEstimateForExport");
    expect(reportsSource).toContain("corporateTaxEstimate");
    expect(reportsSource).toContain("/corporate-tax/calculate");
    expect(reportsSource).toContain("corporateTaxBridgeRows");
    expect(reportsSource).toContain("Open Corporate Tax");
    expect(reportsSource).toContain("corporate_tax_estimate");
    expect(reportsSource).toContain("Corporate Tax Estimate");
    expect(reportsSource).toContain("salesProductServiceReport");
    expect(reportsSource).toContain("productServiceSalesRows");
    expect(reportsSource).toContain("Sales by product/service");
    expect(
      reportsSource.slice(
        reportsSource.indexOf('<TabsContent value="tax"'),
        reportsSource.indexOf('<TabsContent value="sales"')
      )
    ).not.toContain("Sales by product/service");
    expect(
      reportsSource.slice(
        reportsSource.indexOf('<TabsContent value="sales"'),
        reportsSource.indexOf('<TabsContent value="balances"')
      )
    ).toContain("Sales by product/service");
    expect(exportSource).toContain("Sales by Product Service");
    expect(reportsSource).toContain("sales-product-service");
    expect(reportsRouteSource).toContain("/api/companies/:id/reports/sales-product-service");
    expect(reportsRouteSource).toContain("inArray(invoiceLines.invoiceId, invoiceIds)");
    expect(reportsSource).toContain("monthEndCloseStatus");
    expect(reportsSource).toContain("Month-End Close Status");
    expect(reportsSource).toContain("/month-end/checklist");
    expect(reportsSource).toContain('data-testid="tab-month-end-close-status"');
    expect(exportSource).toContain("prepareMonthEndCloseStatusForExport");
    expect(exportSource).toContain("Month-End Checklist");
    expect(reportsSource).toContain("fixedAssetRegisterReport");
    expect(reportsSource).toContain("inventoryValuationReport");
    expect(reportsSource).toContain("Inventory valuation");
    expect(reportsSource).toContain("/inventory-movements");
    expect(exportSource).toContain("Inventory Valuation");
    expect(exportSource).toContain("Inventory Summary");
    expect(inventoryRouteSource).toContain("/api/companies/:companyId/products");
    expect(inventoryRouteSource).toContain("/api/companies/:companyId/inventory-movements");
    expect(reportsSource).toContain("Fixed asset register");
    expect(reportsSource).toContain("/fixed-assets");
    expect(reportsSource).toContain("/fixed-assets/summary");
    expect(exportSource).toContain("Fixed Asset Register");
    expect(exportSource).toContain("Fixed Assets by Category");
    expect(fixedAssetsRouteSource).toContain("/api/companies/:companyId/fixed-assets");
    expect(fixedAssetsRouteSource).toContain("/api/companies/:companyId/fixed-assets/summary");

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

    const plannedReports = reportCatalog.filter((report) => report.status === "planned");
    expect(plannedReports.length).toBeGreaterThan(0);

    for (const report of plannedReports) {
      expect(report.roadmapPrerequisites?.dataSource).toBeTruthy();
      expect(report.roadmapPrerequisites?.workflowDependency).toBeTruthy();
      expect(report.roadmapPrerequisites?.automationRule).toBeTruthy();
      expect(report.roadmapPriority?.score).toBeGreaterThan(0);
      expect(report.roadmapPriority?.score).toBeLessThanOrEqual(100);
      expect(report.roadmapPriority?.rationale).toBeTruthy();

      for (const persona of report.personas) {
        expect(report.roadmapPriority?.impactByPersona[persona]).toMatch(/^(high|medium|low)$/);
      }
    }
  });

  it("calculates shared report automation health for packs and dashboards", () => {
    expect(REPORT_AUTOMATION_HEALTH_HISTORY_KEY).toBe("nr_ai.report_automation_health_history");

    const ready = calculateReportAutomationHealth({
      readinessPercent: 100,
      automationLaneCount: 3,
      comparisonMetricCount: 3,
      comparisonWarningCount: 0,
    });

    expect(ready.score).toBe(100);
    expect(ready.label).toBe("Ready to automate");
    expect(ready.variant).toBe("success");

    const needsReview = calculateReportAutomationHealth({
      readinessPercent: 50,
      automationLaneCount: 1,
      comparisonMetricCount: 4,
      comparisonWarningCount: 2,
      plannedReportCount: 3,
    });

    expect(needsReview.score).toBeLessThan(65);
    expect(needsReview.variant).toBe("danger");
    expect(needsReview.reviewSignals).toBe(5);

    const parsedHistory = parseReportAutomationHealthHistory(
      JSON.stringify([
        {
          persona: "owner",
          score: 72,
          label: "Review signals",
          variant: "warning",
          readinessScore: 80,
          automationLaneScore: 100,
          comparisonScore: 50,
          comparisonWarnings: 2,
          reviewSignals: 4,
          capturedAt: "2026-06-15T08:00:00.000Z",
        },
        { persona: "invalid", score: 10 },
      ])
    );
    const trend = buildReportAutomationHealthTrend(
      parsedHistory,
      "owner",
      ready,
      "2026-06-16T08:00:00.000Z"
    );

    expect(parsedHistory).toHaveLength(1);
    expect(trend.direction).toBe("up");
    expect(trend.variant).toBe("success");
    expect(trend.delta).toBe(28);
  });

  it("keeps report tab deep links bounded to known Reports tabs", () => {
    expect(reportTabs).toEqual([
      "pl",
      "bs",
      "vat",
      "tax",
      "trial",
      "sales",
      "balances",
      "expenses",
      "ledger",
      "close",
      "planning",
    ]);
    expect(catalogSource).toContain("type ReportTab = (typeof reportTabs)[number]");
    expect(reportsSource).toContain("function reportTabFromSearch(search: string): ReportTab");
    expect(reportsSource).toContain("return reportTabs.includes(tab as ReportTab)");
    expect(reportsSource).toContain(': "pl"');
    expect(reportsSource).toContain('data-testid="tab-corporate-tax"');
    expect(reportsSource).toContain('data-testid="tab-month-end-close-status"');
    expect(reportsSource).toContain('data-testid="text-corporate-tax-payable"');

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
      "inventory-risk",
      "receipt-posting",
      "vat-readiness",
      "sales-mix",
      "corporate-tax",
      "fixed-asset-review",
      "close-review",
      "month-end-close",
      "planning-risk",
    ]) {
      expect(reportsSource).toContain(`id: "${queueId}"`);
    }

    for (const destination of [
      'href: "/payment-chasing"',
      'href: "/bill-pay?tab=summary"',
      'href: "/inventory"',
      'href: "/fixed-assets"',
      'href: "/vat-filing"',
      'tab: "expenses"',
      'tab: "tax"',
      'tab: "close"',
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
