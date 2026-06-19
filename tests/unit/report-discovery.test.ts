import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPreferredReportWorkflowGapFilter,
  clearPreferredReportWorkflowSearch,
  getPreferredReportWorkflowGapFilter,
  getPreferredReportWorkflowSearch,
  getFavoriteReportIds,
  reportAutomationTriggerRuleHref,
  reportAutomationTriggerRules,
  buildReportAutomationHealthTrend,
  buildReportAutomationRunbookSteps,
  calculateReportAutomationImpact,
  calculateReportAutomationHealth,
  liveReportCatalog,
  normalizeReportWorkflowSearch,
  parseReportFavoriteReportIds,
  parseReportAutomationHealthHistory,
  REPORT_FAVORITE_REPORT_IDS_KEY,
  REPORT_AUTOMATION_HEALTH_HISTORY_KEY,
  REPORT_WORKFLOW_GAP_FILTER_PREFERENCE_KEY,
  REPORT_WORKFLOW_SEARCH_PREFERENCE_KEY,
  parseReportPersona,
  parseReportWorkflowGapFilter,
  reportAutomationImpactProfiles,
  reportAutomationPlaybookHref,
  reportAutomationStarterHref,
  reportAutomationStarters,
  readyReportCatalog,
  reportComparisonPresetHref,
  reportComparisonPresets,
  reportDecisionShortcutHref,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportCatalog,
  reportManagementBriefHref,
  reportManagementBriefProfiles,
  reportPackTemplateHref,
  reportPackTemplates,
  reportHref,
  reportPersonaHref,
  reportPersonas,
  reportPersonaWorkspaces,
  reportProductDepthAreaHref,
  reportProductDepthAreas,
  reportProductDepthSubgoalHref,
  reportQuickAccessProfiles,
  reportRoleWorkflowStepHref,
  reportSavedViewHref,
  reportSavedViewProfiles,
  reportSectionHref,
  reportSuiteHref,
  reportSuiteProfiles,
  reportTabs,
  reportWorkspaceHref,
  reportWorkflowContextHref,
  reportWorkflowGapFilterLabels,
  reportWorkflowFinderGapHref,
  setFavoriteReportIds,
  setPreferredReportWorkflowGapFilter,
  setPreferredReportWorkflowSearch,
  toggleFavoriteReportId,
} from "../../client/src/lib/reportCatalog";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function createMemoryLocalStorage(seed: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(seed));

  return {
    get length() {
      return store.size;
    },
    clear: vi.fn(() => store.clear()),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

describe("report discoverability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const catalogSource = read("client/src/lib/reportCatalog.ts");
  const commandSource = read("client/src/components/CommandPalette.tsx");
  const dashboardSource = read("client/src/pages/Dashboard.tsx");
  const reportLaunchPickerSource = read("client/src/components/reports/ReportLaunchPicker.tsx");
  const mobileNavSource = read("client/src/components/MobileNav.tsx");
  const onboardingSource = read("client/src/pages/Onboarding.tsx");
  const sidebarSource = read("client/src/components/layout/AppSidebar.tsx");
  const i18nSource = read("client/src/lib/i18n.ts");
  const reportCatalogApiSource = read("client/src/lib/reportCatalogApi.ts");
  const reportsSource = read("client/src/pages/Reports.tsx");
  const exportSource = read("client/src/lib/export.ts");
  const reportDeliveryRouteSource = read("server/routes/report-delivery.routes.ts");
  const reportCatalogServiceSource = read("server/services/report-catalog.service.ts");
  const reportDeliveryServiceSource = read("server/services/report-delivery.service.ts");
  const reportDeliverySchedulerSource = read(
    "server/services/report-delivery-scheduler.service.ts"
  );
  const routesSource = read("server/routes.ts");
  const schedulerSource = read("server/services/scheduler.service.ts");
  const storageSource = read("server/storage.ts");
  const schemaSource = read("shared/schema.ts");
  const reportDeliveryMigrationSource = read(
    "migrations/0075_report_delivery_subscription_settings.sql"
  );
  const reportDeliveryRunsMigrationSource = read("migrations/0076_report_delivery_runs.sql");
  const reportDeliverySchedulerScansMigrationSource = read(
    "migrations/0077_report_delivery_scheduler_scans.sql"
  );
  const reportDeliveryRunFailuresMigrationSource = read(
    "migrations/0078_report_delivery_run_failures.sql"
  );
  const reportAutomationPreferencesMigrationSource = read(
    "migrations/0079_report_automation_preferences.sql"
  );
  const reportsRouteSource = read("server/routes/reports.routes.ts");
  const expenseClaimsRouteSource = read("server/routes/expense-claims.routes.ts");
  const fixedAssetsRouteSource = read("server/routes/fixed-assets.routes.ts");
  const inventoryRouteSource = read("server/routes/inventory.routes.ts");
  const costCentersRouteSource = read("server/routes/cost-centers.routes.ts");
  const payrollRouteSource = read("server/routes/payroll.routes.ts");
  const portalRouteSource = read("server/routes/portal.routes.ts");

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
    "Inventory Movement",
    "Fixed Asset Register",
    "Depreciation Schedule",
    "Payroll Summary",
    "WPS / SIF Summary",
    "Invoice Status",
    "Month-End Close Status",
    "Audit Trail",
    "Consolidated Statements",
    "Budget vs Actual",
    "Cash Flow Forecast",
    "Revenue by Customer",
    "Sales by Product/Service",
    "Expenses by Vendor",
    "Expenses by Category",
    "Cost Center P&L",
    "Expense Claims",
  ];

  it("keeps the Reports catalog at 33 live high-level reports with dimensional coverage", () => {
    expect(liveReportCatalog).toHaveLength(33);

    for (const label of expectedLiveReports) {
      expect(liveReportCatalog.map((report) => report.name)).toContain(label);
    }

    for (const report of liveReportCatalog) {
      expect(report.decisionQuestion).toBeTruthy();
      expect(report.decisionQuestion).toMatch(/\?$/);
      expect(report.decisionQuestion.length).toBeGreaterThan(25);
    }

    const costCenterReport = reportCatalog.find(
      (report) => report.id === "cost-center-profitability"
    );
    expect(costCenterReport).toMatchObject({
      name: "Cost Center P&L",
      status: "live",
      href: "/cost-centers",
      personas: ["owner", "accountant"],
    });
    expect(liveReportCatalog.some((report) => report.id === "cost-center-profitability")).toBe(
      true
    );
    expect(readyReportCatalog).toHaveLength(33);
    expect(readyReportCatalog.some((report) => report.id === "cost-center-profitability")).toBe(
      true
    );
    expect(catalogSource).toContain('id: "cost-center-profitability"');
    expect(catalogSource).toContain('status: "live"');
    expect(catalogSource).toContain('href: "/cost-centers"');
    expect(catalogSource).toContain('"cost-center-profitability"');

    for (const persona of ["owner", "accountant"]) {
      expect(
        reportQuickAccessProfiles
          .find((profile) => profile.persona === persona)
          ?.reportIds.includes("cost-center-profitability")
      ).toBe(true);
      expect(
        reportAutomationImpactProfiles
          .find((profile) => profile.persona === persona)
          ?.reportIds.includes("cost-center-profitability")
      ).toBe(true);
    }
    expect(
      reportComparisonPresets
        .find((preset) => preset.id === "owner-profit-cash-movement")
        ?.reportIds.includes("cost-center-profitability")
    ).toBe(true);
    expect(
      reportComparisonPresets
        .find((preset) => preset.id === "accountant-operational-advisory-movement")
        ?.reportIds.includes("cost-center-profitability")
    ).toBe(true);
    expect(
      reportAutomationStarters
        .find((starter) => starter.id === "owner-tax-spend-autopilot")
        ?.reportIds.includes("cost-center-profitability")
    ).toBe(true);
    expect(
      reportAutomationStarters
        .find((starter) => starter.id === "accountant-advisory-pack-autopilot")
        ?.reportIds.includes("cost-center-profitability")
    ).toBe(true);
    expect(
      reportAutomationTriggerRules
        .find((rule) => rule.id === "owner-spend-variance-alert")
        ?.reportIds.includes("cost-center-profitability")
    ).toBe(true);
    expect(
      reportAutomationTriggerRules
        .find((rule) => rule.id === "accountant-advisory-movement-note")
        ?.reportIds.includes("cost-center-profitability")
    ).toBe(true);
    expect(
      reportPackTemplates
        .find((template) => template.id === "owner-tax-cash-pack")
        ?.reportIds.includes("cost-center-profitability")
    ).toBe(true);
    expect(
      reportPackTemplates
        .find((template) => template.id === "accountant-advisory-review-pack")
        ?.reportIds.includes("cost-center-profitability")
    ).toBe(true);
    expect(
      reportDeliverySubscriptions
        .find((subscription) => subscription.id === "owner-tax-deadline-delivery")
        ?.reportIds.includes("cost-center-profitability")
    ).toBe(true);
    expect(
      reportDeliverySubscriptions
        .find((subscription) => subscription.id === "accountant-advisory-pack-delivery")
        ?.reportIds.includes("cost-center-profitability")
    ).toBe(true);

    expect(reportPersonas).toEqual(["owner", "freelancer", "accountant"]);

    for (const persona of reportPersonas) {
      const personaReports = reportCatalog.filter((report) => report.personas.includes(persona));
      expect(personaReports.length).toBeGreaterThanOrEqual(20);
      expect(
        personaReports.filter((report) => report.status === "live").length
      ).toBeGreaterThanOrEqual(20);
      expect(reportPersonaWorkspaces.some((workspace) => workspace.persona === persona)).toBe(true);
      expect(catalogSource).toContain(`persona: "${persona}"`);
      expect(reportsSource).toContain(`id: "${persona}"`);
    }

    const freelancerReportIds = new Set(
      reportCatalog
        .filter((report) => report.personas.includes("freelancer"))
        .map((report) => report.id)
    );
    for (const reportId of [
      "balance-sheet",
      "ap-aging",
      "vat-return",
      "corporate-tax-estimate",
      "vendor-balances",
      "budget-actual",
      "sales-product-service",
      "fixed-asset-register",
      "depreciation-schedule",
      "expense-claims",
    ]) {
      expect(freelancerReportIds.has(reportId)).toBe(true);
    }
  });

  it("exposes all ready reports through the global command palette", () => {
    expect(commandSource).toContain('group: "Reports"');
    expect(commandSource).toContain("fetchReportCatalogDiscovery");
    expect(commandSource).toContain("reportCatalogDiscoveryQueryKey(null)");
    expect(commandSource).toContain("syncedReportCatalog?.reports ?? readyReportCatalog");
    expect(commandSource).toContain('report.status !== "planned"');
    expect(commandSource).toContain("description?: string");
    expect(commandSource).toContain("item.description");
    expect(commandSource).toContain(
      'value={`${item.label} ${item.description ?? ""} ${item.keywords ?? ""}`}'
    );
    expect(commandSource).toContain("getPreferredReportPersona");
    expect(commandSource).toContain("getPreferredReportWorkflowSearch");
    expect(commandSource).toContain("reportWorkflowSearchScore");
    expect(commandSource).toContain("preferredReportWorkflowSearch");
    expect(commandSource).toContain("orderedItems");
    expect(commandSource).toContain("score: reportWorkflowSearchScore");
    expect(commandSource).toContain("commandReadyReports.map");
    expect(commandSource).toContain("id: `report-${report.id}`");
    expect(commandSource).toContain("reportHref:");
    expect(commandSource).toContain("syncedContext?.reportHref ??");
    expect(commandSource).toContain("reportPersonaHref(report, reportActionPersona)");
    expect(commandSource).toContain(
      "context?.reportHref ?? reportPersonaHref(report, preferredReportPersona)"
    );
    expect(commandSource).toContain(
      "description: `${report.category} · ${report.comparison} · ${report.automation}`"
    );
    expect(commandSource).toContain("report.decisionQuestion");
    expect(commandSource).toContain("commandReportAutomationContextById");
    expect(commandSource).toContain("syncedReportCatalog?.reportActionContexts.find");
    expect(commandSource).toContain("syncedContext?.automationStarters[0]");
    expect(commandSource).toContain("syncedContext?.deliverySubscriptions[0]");
    expect(commandSource).toContain("syncedContext?.comparisonPresets[0]");
    expect(commandSource).toContain("syncedContext?.reportSuites[0]");
    expect(commandSource).toContain("href: syncedStarter.href");
    expect(commandSource).toContain("href: syncedDelivery.href");
    expect(commandSource).toContain("href: syncedComparison.href");
    expect(commandSource).toContain("href: syncedSuite.href");
    expect(commandSource).toContain("commandAutomationStarters.find");
    expect(commandSource).toContain("commandDeliverySubscriptions.find");
    expect(commandSource).toContain("commandComparisonPresets.find");
    expect(commandSource).toContain("commandReportSuites.find");
    expect(commandSource).toContain("const actionKeywords = [");
    expect(commandSource).toContain("id: `report-action-${report.id}`");
    expect(commandSource).toContain("label: `Automate ${report.name}`");
    expect(commandSource).toContain("reportWorkflowContextHref({");
    expect(commandSource).toContain("search: report.name");
    expect(commandSource).toContain("href: context.workflowHref");
    expect(commandSource).toContain("id: `report-schedule-${report.id}`");
    expect(commandSource).toContain("label: `Schedule ${report.name}`");
    expect(commandSource).toContain("href: context.delivery.href");
    expect(commandSource).toContain("id: `report-compare-${report.id}`");
    expect(commandSource).toContain("label: `Compare ${report.name}`");
    expect(commandSource).toContain("href: context.comparison.href");
    expect(commandSource).toContain("id: `report-suite-action-${report.id}`");
    expect(commandSource).toContain("label: `Open ${report.name} suite`");
    expect(commandSource).toContain("href: context.suite.href");
    expect(commandSource).toContain("context.starter?.commandKeywords");
    expect(commandSource).toContain("context.delivery?.commandKeywords");
    expect(commandSource).toContain("context.comparison?.commandKeywords");
    expect(commandSource).toContain("context.suite?.commandKeywords");
    expect(commandSource).toContain(
      "report automation action direct from anywhere command palette workflow finder"
    );
    expect(commandSource).toContain(
      "report delivery schedule subscription send from anywhere command palette"
    );
    expect(commandSource).toContain(
      "report comparison preset current vs prior from anywhere command palette"
    );
    expect(commandSource).toContain(
      "report suite pack workflow delivery comparison from anywhere command palette"
    );
    expect(commandSource).toContain("useDefaultCompany");
    expect(commandSource).toContain("useQueryClient");
    expect(commandSource).toContain("CommandPaletteReportDeliveryPlan");
    expect(commandSource).toContain("CommandPaletteReportDeliveryRun");
    expect(commandSource).toContain("commandReportDeliveryPlansQuery");
    expect(commandSource).toContain("commandReportDeliveryRunsQuery");
    expect(commandSource).toContain("commandFailedDeliveryRuns");
    expect(commandSource).toContain("acknowledgedPaletteDeliveryHandoffGaps");
    expect(commandSource).toContain("getCommandPaletteDeliveryHandoff");
    expect(commandSource).toContain("reportWorkflowContextHref");
    expect(commandSource).toContain("reportWorkflowGapFilterLabels");
    expect(commandSource).toContain("queueReportDeliveryFromPalette");
    expect(commandSource).toContain("id: `report-queue-delivery-${subscription.id}`");
    expect(commandSource).toContain("id: `report-queue-suite-delivery-${suite.id}`");
    expect(commandSource).toContain("suite.deliverySubscriptionId");
    expect(commandSource).toContain(
      "queueReportDeliveryFromPalette({ ...subscription, title: suite.title })"
    );
    expect(commandSource).toContain("report-delivery/subscriptions/${subscription.id}/queue");
    expect(commandSource).toContain("acknowledgeHandoffGaps ? { acknowledgeHandoffGaps: true }");
    expect(commandSource).toContain("Acknowledge handoff for");
    expect(commandSource).toContain(
      "`Send ${subscription.channel} pack to ${subscription.recipients}`"
    );
    expect(commandSource).toContain("Select the queue command again");
    expect(commandSource).toContain("acknowledge handoff gaps before queueing");
    expect(commandSource).toContain("retryReportDeliveryFromPalette");
    expect(commandSource).toContain("id: `report-retry-delivery-${run.id}`");
    expect(commandSource).toContain("/report-delivery/runs/${runId}/retry");
    expect(commandSource).toContain(
      'description: run.errorMessage ?? "Recover failed automated report delivery"'
    );
    expect(commandSource).toContain(
      'queryKey: ["/api/companies", selectedCompanyId, "report-delivery"]'
    );
    expect(commandSource).toContain("queue now send schedule automated report pack from anywhere");
    expect(commandSource).toContain("Could not queue report pack");
    expect(commandSource).toContain("retry failed delivery recover report pack automation");
    expect(commandSource).toContain("Could not retry report delivery");

    for (const report of liveReportCatalog) {
      expect(reportHref(report)).toBeTruthy();
    }
    expect(reportPersonaHref({ href: undefined, tab: "pl" }, "freelancer")).toBe(
      "/reports?tab=pl&persona=freelancer"
    );
    expect(reportPersonaHref({ href: undefined, tab: "pl" }, "all")).toBe("/reports?tab=pl");
    expect(
      reportPersonaHref({ href: "/advanced-reports?tab=cashflow", tab: undefined }, "owner")
    ).toBe("/advanced-reports?tab=cashflow");

    for (const href of [
      "/reports?tab=pl",
      "/reports?tab=bs",
      "/reports?tab=vat",
      "/reports?tab=tax",
      "/reports?tab=trial",
      "/reports?tab=sales",
      "/reports?tab=balances",
      "/reports?tab=expenses",
      "/reports?tab=payroll",
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
    expect(commandSource).toContain("commandReportWorkspaces.map");
    expect(commandSource).toContain("syncedReportCatalog?.workspaces ?? reportPersonaWorkspaces");
    expect(commandSource).toContain("id: `report-workspace-${workspace.persona}`");
    expect(commandSource).toContain(
      "href: syncedHref(workspace) ?? reportWorkspaceHref(workspace)"
    );
    expect(commandSource).toContain("description: workspace.focus");
    expect(commandSource).toContain("id: `report-role-setup-${workspace.persona}`");
    expect(commandSource).toContain('reportSectionHref(workspace, "role-setup")');
    expect(sidebarSource).toContain('key: "reports"');
    expect(sidebarSource).toContain('url: "/reports"');
    expect(sidebarSource).toContain("items: []");
    expect(mobileNavSource).toContain("Role setup - ${workspace.title}");
    expect(dashboardSource).toContain("getPreferredReportPersona() ??");
    expect(dashboardSource).toContain("getPreferredReportWorkflowSearch");
    expect(dashboardSource).toContain("clearPreferredReportWorkflowSearch");
    expect(dashboardSource).toContain("clearPreferredReportWorkflowGapFilter");
    expect(dashboardSource).toContain("dashboardReportWorkflowSearchScore");
    expect(dashboardSource).toContain("normalizedPreferredReportWorkflowSearch");
    expect(dashboardSource).toContain("searchScore");
    expect(dashboardSource).toContain(".sort((a, b) => b.searchScore - a.searchScore");
    expect(dashboardSource).toContain('data-testid="dashboard-report-search-context"');
    expect(dashboardSource).toContain('data-testid="dashboard-report-context-summary"');
    expect(dashboardSource).toContain('data-testid="dashboard-report-role-context"');
    expect(dashboardSource).toContain('data-testid="dashboard-report-gap-context"');
    expect(dashboardSource).toContain('data-testid="button-open-dashboard-report-context-link"');
    expect(dashboardSource).toContain('data-testid="button-clear-dashboard-report-context"');
    expect(dashboardSource).toContain("clearDashboardReportWorkflowContext");
    expect(dashboardSource).toContain("reportWorkflowPreferenceRevision");
    expect(dashboardSource).toContain("setPreferredReportPersona(persona)");
    expect(dashboardSource).toContain("fetchReportCatalogDiscovery");
    expect(dashboardSource).toContain(
      "reportCatalogDiscoveryQueryKey(preferredReportWorkspace.persona)"
    );
    expect(dashboardSource).toContain("selectedReportPersonaSummary");
    expect(dashboardSource).toContain("reportCatalogDiscoveryQuery.data?.personaSummaries[0]");
    expect(dashboardSource).toContain('data-testid="dashboard-report-catalog-sync"');
    expect(dashboardSource).toContain('data-testid="dashboard-report-catalog-pack-count"');
    expect(dashboardSource).toContain('data-testid="dashboard-report-catalog-comparison-count"');
    expect(dashboardSource).toContain("ReportLaunchPicker");
    expect(dashboardSource).toContain("ReportLaunchDeliveryPreview");
    expect(dashboardSource).toContain("companyId={selectedCompanyId}");
    expect(dashboardSource).toContain('data-testid="dashboard-report-launch-picker"');
    expect(dashboardSource).toContain("reportWorkflowContextHref");
    expect(dashboardSource).toContain("reportWorkflowFinderGapHref");
    expect(dashboardSource).toContain("getPreferredReportWorkflowGapFilter");
    expect(dashboardSource).toContain("setPreferredReportWorkflowGapFilter");
    expect(dashboardSource).toContain("reportWorkflowGapFilterLabels");
    expect(dashboardSource).toContain("preferredReportWorkflowGapFilter");
    expect(dashboardSource).toContain("preferredReportWorkflowGapLabel");
    expect(dashboardSource).toContain("hasDashboardReportWorkflowContext");
    expect(dashboardSource).toContain("dashboardReportWorkflowContextHref");
    expect(dashboardSource).toContain("search: preferredReportWorkflowSearch");
    expect(dashboardSource).toContain("preferredReportWorkflowGapLinks");
    expect(dashboardSource).toContain('data-testid="dashboard-report-workflow-gap-filters"');
    expect(dashboardSource).toContain("dashboard-report-workflow-gap-${link.gap}");
    expect(dashboardSource).toContain("syncedReadyReports");
    expect(dashboardSource).toContain("syncedSummary?.readyReportCount ?? readyReports");
    expect(reportsSource).toContain("syncedReportCatalogSummary.readyReportCount");
    expect(reportsSource).toContain("syncedSummary?.readyReportCount ?? localReadyReports");
    expect(dashboardSource).toContain("syncedAutomationLanes");
    expect(dashboardSource).toContain("selectDashboardReportPersona");
    expect(dashboardSource).toContain("preferredReportWorkspace");
    expect(dashboardSource).toContain("dashboardReportWorkspaces");
    expect(dashboardSource).toContain("automationStarterCount");
    expect(dashboardSource).toContain("packTemplateCount");
    expect(dashboardSource).toContain("comparisonPresetCount");
    expect(dashboardSource).toContain("syncedPackTemplates");
    expect(dashboardSource).toContain("syncedComparisonPresets");
    expect(dashboardSource).toContain("reportPersonaWorkspaces.find");
    expect(dashboardSource).toContain('data-testid="dashboard-report-role-switcher"');
    expect(dashboardSource).toContain("dashboard-report-mode-${workspace.persona}");
    expect(dashboardSource).toContain("preferredReportSetupSteps");
    expect(dashboardSource).toContain('data-testid="dashboard-report-role-setup"');
    expect(dashboardSource).toContain("dashboard-report-role-setup-step-${step.id}");
    expect(dashboardSource).toContain("Reporting mode");
    expect(dashboardSource).toContain("solo entrepreneur");
    expect(dashboardSource).toContain("preferredWorkspaceCatalogReports");
    expect(dashboardSource).toContain("preferredWorkspaceReports");
    expect(dashboardSource).toContain("preferredReportPackReadiness");
    expect(dashboardSource).toContain("preferredReportDecisionShortcuts");
    expect(dashboardSource).toContain("reportDecisionShortcuts");
    expect(dashboardSource).toContain("reportDecisionShortcutHref(shortcut)");
    expect(dashboardSource).toContain('data-testid="dashboard-report-decision-shortcuts"');
    expect(dashboardSource).toContain("dashboard-report-decision-shortcut-${shortcut.id}");
    expect(dashboardSource).toContain("dashboardReportActionContextById.get(primaryReport.id)");
    expect(dashboardSource).toContain(
      "dashboard-report-decision-shortcut-automation-${shortcut.id}"
    );
    expect(dashboardSource).toContain("preferredReportAutomationStarters");
    expect(dashboardSource).toContain("reportAutomationStarters");
    expect(dashboardSource).toContain("reportAutomationStarterHref(starter)");
    expect(dashboardSource).toContain('data-testid="dashboard-report-automation-starters"');
    expect(dashboardSource).toContain("dashboard-report-automation-starter-${starter.id}");
    expect(dashboardSource).toContain("preferredReportPackTemplates");
    expect(dashboardSource).toContain("reportPackTemplates");
    expect(dashboardSource).toContain("reportPackTemplateHref(template)");
    expect(dashboardSource).toContain('data-testid="dashboard-report-pack-templates"');
    expect(dashboardSource).toContain("dashboard-report-pack-template-${template.id}");
    expect(dashboardSource).toContain("preferredReportComparisonPresets");
    expect(dashboardSource).toContain("reportComparisonPresets");
    expect(dashboardSource).toContain("reportComparisonPresetHref(preset)");
    expect(dashboardSource).toContain('data-testid="dashboard-report-comparison-presets"');
    expect(dashboardSource).toContain("dashboard-report-comparison-preset-${preset.id}");
    expect(dashboardSource).toContain("preset.automationTrigger");
    expect(dashboardSource).toContain("dashboardComparisonRows");
    expect(dashboardSource).toContain("dashboardPercentChange");
    expect(dashboardSource).toContain("formatDashboardComparisonPercent");
    expect(dashboardSource).toContain("dashboardComparisonBadgeVariant");
    expect(catalogSource).toContain("calculateReportAutomationHealth");
    expect(dashboardSource).toContain("calculateReportAutomationHealth({");
    expect(dashboardSource).toContain("reportAutomationHealth");
    expect(dashboardSource).toContain("preferredReportTriggerRules");
    expect(dashboardSource).toContain("reportAutomationTriggerRules");
    expect(dashboardSource).toContain("reportAutomationTriggerRuleHref(rule)");
    expect(dashboardSource).toContain('data-testid="dashboard-report-trigger-rules"');
    expect(dashboardSource).toContain("dashboard-report-trigger-rule-${rule.id}");
    expect(dashboardSource).toContain("preferredReportDeliverySubscriptions");
    expect(dashboardSource).toContain("reportDeliverySubscriptions");
    expect(dashboardSource).toContain("reportDeliverySubscriptionHref(subscription)");
    expect(dashboardSource).toContain("DashboardReportAutomationPreference");
    expect(dashboardSource).toContain("DashboardAutomationAction");
    expect(dashboardSource).toContain("DashboardReportDeliveryRun");
    expect(dashboardSource).toContain("actionType?:");
    expect(dashboardSource).toContain("subscriptionId?:");
    expect(dashboardSource).toContain("runId?:");
    expect(dashboardSource).toContain('readinessStatus: "ready" | "setup" | "paused"');
    expect(dashboardSource).toContain("deliveryGuardrail: string");
    expect(dashboardSource).toContain("readyReportCount: number");
    expect(dashboardSource).toContain("triggerRuleCount: number");
    expect(dashboardSource).toContain("retriedFromRunId: string | null");
    expect(dashboardSource).toContain("reportAutomationPreferencesQuery");
    expect(dashboardSource).toContain(
      "/api/companies/${selectedCompanyId}/report-delivery/preferences"
    );
    expect(dashboardSource).toContain("queueDashboardReportDeliverySubscription");
    expect(dashboardSource).toContain("/report-delivery/subscriptions/${subscriptionId}/queue");
    expect(dashboardSource).toContain("acknowledgeHandoffGaps?: boolean");
    expect(dashboardSource).toContain("acknowledgeHandoffGaps ? { acknowledgeHandoffGaps: true }");
    expect(dashboardSource).toContain("dashboardReportDeliveryRunsQuery");
    expect(dashboardSource).toContain("/report-delivery/runs?limit=30");
    expect(dashboardSource).toContain("retryDashboardReportDeliveryRun");
    expect(dashboardSource).toContain("/report-delivery/runs/${runId}/retry");
    expect(dashboardSource).toContain("dashboardPersonaDeliveryRuns");
    expect(dashboardSource).toContain("dashboardLatestDeliveryRun");
    expect(dashboardSource).toContain("dashboardLatestDeliveryRunSubscription");
    expect(dashboardSource).toContain("acknowledgedDashboardReportDeliveryHandoffGaps");
    expect(dashboardSource).toContain("dashboardReportDeliveryHandoffBySubscriptionId");
    expect(dashboardSource).toContain("queueDashboardReportDeliverySubscriptionWithHandoffGuard");
    expect(dashboardSource).toContain("preferredAutomationQueueRequiresHandoffAcknowledgement");
    expect(dashboardSource).toContain("dashboardReportDeliveryLauncherPreviewById");
    expect(dashboardSource).toContain("Record<string, ReportLaunchDeliveryPreview | undefined>");
    expect(dashboardSource).toContain("latestRunId: latestRun?.id");
    expect(dashboardSource).toContain("latestRunDetail: latestRun");
    expect(dashboardSource).toContain("latestRunError:");
    expect(dashboardSource).toContain("handoffRows: handoff?.rows");
    expect(dashboardSource).toContain("handoffRequiresAcknowledgement: Boolean");
    expect(dashboardSource).toContain("handoffAcknowledged: Boolean");
    expect(dashboardSource).toContain("dashboardPinnedDeliveryAutomationCommand");
    expect(dashboardSource).toContain("dashboardLatestFailedDeliveryRun");
    expect(dashboardSource).toContain("dashboardDeliveryRunStatusSummary");
    expect(dashboardSource).toContain("dashboardDeliveryRunStatusVariant");
    expect(dashboardSource).toContain("dashboardDeliveryRunReadinessVariant");
    expect(dashboardSource).toContain("dashboardDeliveryRunStatusLabel");
    expect(dashboardSource).toContain("formatDashboardDeliveryRunTime");
    expect(dashboardSource).toContain("dashboardPinnedAutomationAction");
    expect(dashboardSource).toContain(
      "if (dashboardPinnedAutomationAction) return dashboardPinnedAutomationAction"
    );
    expect(dashboardSource).toContain("parseReportDeliveryAutomationCommand");
    expect(dashboardSource).toContain("Pinned recovery");
    expect(dashboardSource).toContain("Pinned review");
    expect(dashboardSource).toContain("Pinned queue");
    expect(dashboardSource).toContain("Pinned comparison");
    expect(dashboardSource).toContain(
      'actionType: dashboardLatestFailedDeliveryRun ? "retry" : "link"'
    );
    expect(dashboardSource).toContain('actionType: primaryDeliverySubscription ? "queue" : "link"');
    expect(dashboardSource).toContain('data-testid="dashboard-next-automation-queue"');
    expect(dashboardSource).toContain('data-testid="dashboard-next-automation-retry"');
    expect(dashboardSource).toContain('data-testid="dashboard-report-delivery-run-feedback"');
    expect(dashboardSource).toContain('data-testid="dashboard-next-automation-run-status"');
    expect(dashboardSource).toContain("dashboard-next-automation-run-status-${");
    expect(dashboardSource).toContain('data-testid="dashboard-report-delivery-run-readiness"');
    expect(dashboardSource).toContain('data-testid="dashboard-report-delivery-run-open"');
    expect(dashboardSource).toContain('data-testid="dashboard-report-delivery-run-scheduled"');
    expect(dashboardSource).toContain('data-testid="dashboard-report-delivery-run-report-count"');
    expect(dashboardSource).toContain('data-testid="dashboard-report-delivery-run-channel"');
    expect(dashboardSource).toContain('data-testid="dashboard-report-delivery-run-guardrail"');
    expect(dashboardSource).toContain('data-testid="dashboard-report-delivery-run-error"');
    expect(dashboardSource).toContain('data-testid="dashboard-report-delivery-run-retried-from"');
    expect(dashboardSource).toContain("dashboard-next-automation-command-${");
    expect(dashboardSource).toContain('data-testid="dashboard-report-delivery-subscriptions"');
    expect(dashboardSource).toContain("dashboard-report-delivery-subscription-${subscription.id}");
    expect(dashboardSource).toContain(
      "preferredDeliveryAutomationCommand={dashboardPinnedDeliveryAutomationCommand}"
    );
    expect(dashboardSource).toContain("onQueueDeliverySubscription");
    expect(dashboardSource).toContain("queueDashboardReportDeliverySubscription.mutate");
    expect(dashboardSource).toContain("variables?.subscriptionId");
    expect(dashboardSource).toContain("Acknowledge handoff");
    expect(dashboardSource).toContain("onRetryDeliveryRun");
    expect(dashboardSource).toContain("retryDashboardReportDeliveryRun.mutate");
    expect(dashboardSource).toContain("queueingDeliverySubscriptionId");
    expect(dashboardSource).toContain("retryingDeliveryRunId");
    expect(dashboardSource).toContain("deliveryQueueDisabled");
    expect(dashboardSource).toContain("deliveryRetryDisabled");
    expect(dashboardSource).toContain(
      "deliverySubscriptionPreviewById={dashboardReportDeliveryLauncherPreviewById}"
    );
    expect(dashboardSource).toContain("preferredAutomationNextAction");
    expect(dashboardSource).toContain('data-testid="dashboard-next-automation-action"');
    expect(dashboardSource).toContain("Next automation action");
    expect(dashboardSource).toContain("Review automation readiness");
    expect(dashboardSource).toContain("Ready lane");
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
      'reportSectionHref(preferredReportWorkspace, "automation-operations")'
    );
    expect(dashboardSource).toContain(
      'reportSectionHref(preferredReportWorkspace, "decision-shortcuts")'
    );
    expect(dashboardSource).toContain(
      'reportSectionHref(preferredReportWorkspace, "pack-readiness")'
    );
    expect(dashboardSource).toContain(
      'reportSectionHref(preferredReportWorkspace, "automation-starters")'
    );
    expect(dashboardSource).toContain(
      'reportSectionHref(preferredReportWorkspace, "trigger-rules")'
    );
    expect(dashboardSource).toContain(
      'reportSectionHref(preferredReportWorkspace, "delivery-subscriptions")'
    );
    expect(dashboardSource).toContain(
      'reportSectionHref(preferredReportWorkspace, "automation-command-center")'
    );
    expect(dashboardSource).toContain(
      'reportSectionHref(preferredReportWorkspace, "automation-rules")'
    );
    expect(dashboardSource).toContain(
      'reportSectionHref(preferredReportWorkspace, "pack-automation")'
    );
    expect(dashboardSource).toContain("Open operations");
    expect(dashboardSource).toContain("Open automation center");
    expect(dashboardSource).toContain("Open decision shortcuts");
    expect(dashboardSource).toContain("Open automation starters");
    expect(dashboardSource).toContain("Open trigger rules");
    expect(dashboardSource).toContain("Open delivery subscriptions");
    expect(dashboardSource).toContain("Open automation rules");
    expect(dashboardSource).toContain("preferredReportSuites");
    expect(dashboardSource).toContain('data-testid="dashboard-report-suites"');
    expect(dashboardSource).toContain("dashboard-report-suite-${suite.id}");
    expect(dashboardSource).toContain("suite.triggerRules.length");
    expect(dashboardSource).toContain("suite.deliverySubscription?.channel");
    expect(dashboardSource).toContain("suite.deliveryHref");
    expect(dashboardSource).toContain("suiteTitles: reportSuites.map");
    expect(dashboardSource).toContain(
      'reportSectionHref(preferredReportWorkspace, "report-suites")'
    );
    expect(dashboardSource).toContain("preferredReportQuickAccess");
    expect(dashboardSource).toContain("dashboardReportActionContextById");
    expect(dashboardSource).toContain("reportCatalogDiscoveryQuery.data?.reportActionContexts");
    expect(dashboardSource).toContain("context?.reportHref");
    expect(dashboardSource).toContain("context?.workflowHref");
    expect(dashboardSource).toContain(
      "reportPersonaHref(report, preferredReportWorkspace.persona)"
    );
    expect(dashboardSource).toContain(
      "reportPersonaHref(primaryReport, preferredReportWorkspace.persona)"
    );
    expect(dashboardSource).toContain("context?.comparisonPresets[0]?.href");
    expect(dashboardSource).toContain("context?.deliverySubscriptions[0]?.href");
    expect(dashboardSource).toContain('data-testid="dashboard-report-quick-access"');
    expect(dashboardSource).toContain("dashboard-report-quick-access-${report.id}");
    expect(dashboardSource).toContain("dashboard-report-quick-access-automation-${report.id}");
    expect(dashboardSource).toContain("dashboard-report-quick-access-comparison-${report.id}");
    expect(dashboardSource).toContain("dashboard-report-quick-access-delivery-${report.id}");
    expect(dashboardSource).toContain('data-testid="dashboard-report-quick-access-more"');
    expect(dashboardSource).toContain(
      'reportSectionHref(preferredReportWorkspace, "quick-access")'
    );
    expect(dashboardSource).toContain("preferredReportSavedViews");
    expect(dashboardSource).toContain('data-testid="dashboard-report-saved-views"');
    expect(dashboardSource).toContain("dashboard-report-saved-view-${view.id}");
    expect(dashboardSource).toContain("dashboardReportActionContextById.get(report.id)");
    expect(dashboardSource).toContain("context?.workflowHref");
    expect(dashboardSource).toContain("dashboard-report-saved-view-automation-${view.id}");
    expect(dashboardSource).toContain('reportSectionHref(preferredReportWorkspace, "saved-views")');
    expect(dashboardSource).toContain("preferredReportAutomationImpact");
    expect(dashboardSource).toContain('data-testid="dashboard-report-automation-impact"');
    expect(dashboardSource).toContain("Open automation impact");
    expect(dashboardSource).toContain(
      'reportSectionHref(preferredReportWorkspace, "automation-impact")'
    );
    expect(dashboardSource).toContain("reportWorkspaceHref(preferredReportWorkspace)");
    expect(dashboardSource).toContain("reportAutomationPlaybookHref(");
    expect(dashboardSource).toContain("preferredAutomationNextAction.href");
    expect(dashboardSource).toContain("preferredAutomationNextAction.cta");
    expect(dashboardSource).toContain("preferredReportWorkspace.packSchedule.cadence");
    expect(dashboardSource).toContain("preferredReportWorkspace.packSchedule.delivery");
    expect(dashboardSource).toContain("preferredReportWorkspace.packSchedule.automation");
    expect(dashboardSource).toContain("preferredReportWorkspace.automationOutcome");
    expect(catalogSource).toContain("REPORT_PERSONA_PREFERENCE_KEY");
    expect(catalogSource).toContain("REPORT_WORKFLOW_SEARCH_PREFERENCE_KEY");
    expect(catalogSource).toContain("REPORT_WORKFLOW_GAP_FILTER_PREFERENCE_KEY");
    expect(catalogSource).toContain("REPORT_FAVORITE_REPORT_IDS_KEY");
    expect(catalogSource).toContain("REPORT_DELIVERY_AUTOMATION_COMMAND_KEY");
    expect(catalogSource).toContain("getPreferredReportPersona");
    expect(catalogSource).toContain("setPreferredReportPersona");
    expect(catalogSource).toContain("clearPreferredReportPersona");
    expect(catalogSource).toContain("normalizeReportWorkflowSearch");
    expect(catalogSource).toContain("reportWorkflowGapFilterLabels");
    expect(catalogSource).toContain("reportWorkflowSearchPreferenceKey");
    expect(catalogSource).toContain("getPreferredReportWorkflowSearch");
    expect(catalogSource).toContain("setPreferredReportWorkflowSearch");
    expect(catalogSource).toContain("clearPreferredReportWorkflowSearch");
    expect(catalogSource).toContain("reportWorkflowGapFilterPreferenceKey");
    expect(catalogSource).toContain("getPreferredReportWorkflowGapFilter");
    expect(catalogSource).toContain("setPreferredReportWorkflowGapFilter");
    expect(catalogSource).toContain("clearPreferredReportWorkflowGapFilter");
    expect(catalogSource).toContain("reportFavoriteReportIdsKey");
    expect(catalogSource).toContain("parseReportFavoriteReportIds");
    expect(catalogSource).toContain("getFavoriteReportIds");
    expect(catalogSource).toContain("setFavoriteReportIds");
    expect(catalogSource).toContain("toggleFavoriteReportId");
    expect(catalogSource).toContain("reportWorkflowContextHref");
    expect(catalogSource).toContain("ReportSuiteProfile");
    expect(catalogSource).toContain("reportSuiteProfiles");
    expect(catalogSource).toContain("reportSuiteHref");
    expect(catalogSource).toContain('"report-suites": "report-suites-title"');
    expect(catalogSource).toContain("ReportQuickAccessProfile");
    expect(catalogSource).toContain("reportQuickAccessProfiles");
    expect(catalogSource).toContain('"quick-access": "report-quick-access-title"');
    expect(catalogSource).toContain("ReportSavedViewProfile");
    expect(catalogSource).toContain("reportSavedViewProfiles");
    expect(catalogSource).toContain("reportSavedViewHref");
    expect(catalogSource).toContain('"saved-views": "report-saved-views-title"');
    expect(catalogSource).toContain("ReportAutomationImpactProfile");
    expect(catalogSource).toContain("reportAutomationImpactProfiles");
    expect(catalogSource).toContain("calculateReportAutomationImpact");
    expect(catalogSource).toContain('"automation-impact": "report-automation-impact-title"');
    expect(catalogSource).toContain(".slice(0, 120)");
    expect(catalogSource).toContain("parseReportDeliveryAutomationCommand");
    expect(catalogSource).toContain("getPreferredReportDeliveryAutomationCommand");
    expect(catalogSource).toContain("setPreferredReportDeliveryAutomationCommand");
    expect(catalogSource).toContain("automationNavLabel");
    expect(catalogSource).toContain("automationOutcome");
    expect(catalogSource).toContain("Owner / Solo Reports");
    expect(catalogSource).toContain("Owner / Solo Automations");
    expect(catalogSource).toContain("solo entrepreneur");
    expect(catalogSource).toContain("weekly owner actions");
    expect(catalogSource).toContain("monthly tax-close actions");
    expect(catalogSource).toContain("reviewer queues");
    expect(catalogSource).toContain("reportPersonaHref");
    expect(mobileNavSource).toContain("reportPersonaWorkspaces.map");
    expect(mobileNavSource).toContain("readyReportCatalog");
    expect(mobileNavSource).toContain("interface MoreLink");
    expect(mobileNavSource).toContain("key?: string");
    expect(mobileNavSource).toContain("description?: string");
    expect(mobileNavSource).toContain("workspace.navLabel");
    expect(mobileNavSource).toContain("reportPersonaWorkspaces.flatMap");
    expect(mobileNavSource).toContain("report.personas.includes(workspace.persona)");
    expect(mobileNavSource).toContain("reportPersonaHref(report, workspace.persona)");
    expect(mobileNavSource).toContain("key: `report-catalog-${workspace.persona}-${report.id}`");
    expect(mobileNavSource).toContain("label: `${report.name} - ${workspace.title}`");
    expect(mobileNavSource).toContain(
      "description: `${report.category} - ${report.comparison} - ${report.automation}`"
    );
    expect(mobileNavSource).toContain("key={link.key ?? link.href}");
    expect(mobileNavSource).toContain("reportSuiteProfiles.map");
    expect(mobileNavSource).toContain("reportSuiteHref(suite)");
    expect(mobileNavSource).toContain('reportSectionHref(workspace, "report-suites")');
    expect(mobileNavSource).toContain("reportQuickAccessProfiles");
    expect(mobileNavSource).toContain("Quick access reports - ${workspace.title}");
    expect(mobileNavSource).toContain('reportSectionHref(workspace, "quick-access")');
    expect(mobileNavSource).toContain("reportSavedViewProfiles.map");
    expect(mobileNavSource).toContain("reportSavedViewHref(view)");
    expect(mobileNavSource).toContain("Saved report views - ${workspace.title}");
    expect(mobileNavSource).toContain('reportSectionHref(workspace, "saved-views")');
    expect(mobileNavSource).toContain("workspace.automationNavLabel");
    expect(mobileNavSource).toContain("description: workspace.focus");
    expect(mobileNavSource).toContain("description: workspace.automationOutcome");
    expect(mobileNavSource).toContain("description: workspace.packSchedule.automation");
    expect(mobileNavSource).toContain("reportAutomationImpactProfiles");
    expect(mobileNavSource).toContain("Automation impact - ${workspace.title}");
    expect(mobileNavSource).toContain('reportSectionHref(workspace, "automation-impact")');
    expect(mobileNavSource).toContain("reportWorkspaceHref(workspace)");
    expect(mobileNavSource).toContain('reportSectionHref(workspace, "automation-operations")');
    expect(mobileNavSource).toContain("Report operations - ${workspace.title}");
    expect(mobileNavSource).toContain('reportSectionHref(workspace, "automation-command-center")');
    expect(mobileNavSource).toContain("reportDecisionShortcuts.map");
    expect(mobileNavSource).toContain("reportDecisionShortcutHref(shortcut)");
    expect(mobileNavSource).toContain("description: shortcut.answer");
    expect(mobileNavSource).toContain("reportAutomationTriggerRules.map");
    expect(mobileNavSource).toContain("reportAutomationTriggerRuleHref(rule)");
    expect(mobileNavSource).toContain("description: `${rule.condition} - ${rule.actionLabel}`");
    expect(mobileNavSource).toContain("reportDeliverySubscriptions.map");
    expect(mobileNavSource).toContain("reportDeliverySubscriptionHref(subscription)");
    expect(mobileNavSource).toContain(
      "description: `${subscription.cadence} - ${subscription.channel}`"
    );
    expect(mobileNavSource).toContain("reportAutomationStarters.map");
    expect(mobileNavSource).toContain("reportAutomationStarterHref(starter)");
    expect(mobileNavSource).toContain("description: `${starter.audience} - ${starter.outcome}`");
    expect(mobileNavSource).toContain("reportPackTemplates.map");
    expect(mobileNavSource).toContain("reportPackTemplateHref(template)");
    expect(mobileNavSource).toContain("description: `${template.cadence} - ${template.delivery}`");
    expect(mobileNavSource).toContain("reportComparisonPresets.map");
    expect(mobileNavSource).toContain("reportComparisonPresetHref(preset)");
    expect(mobileNavSource).toContain(
      "description: `${preset.baseline} - ${preset.automationTrigger}`"
    );
    expect(mobileNavSource).toContain("mobile-nav-more-description");
    expect(onboardingSource).toContain("reportPersonaWorkspaces.map");
    expect(onboardingSource).toContain("workspace.navLabel");
    expect(onboardingSource).toContain("selectedWorkspace.automationNavLabel");
    expect(onboardingSource).toContain("workspace.automationOutcome");
    expect(onboardingSource).toContain("selectedReportSuites");
    expect(onboardingSource).toContain("reportSuiteProfiles");
    expect(onboardingSource).toContain("reportSuiteHref(suite)");
    expect(onboardingSource).toContain('data-testid="onboarding-report-suites"');
    expect(onboardingSource).toContain("onboarding-report-suite-${suite.id}");
    expect(onboardingSource).toContain("selectedQuickAccessProfile");
    expect(onboardingSource).toContain("reportQuickAccessProfiles");
    expect(onboardingSource).toContain("selectedQuickAccessReports");
    expect(onboardingSource).toContain("reportCatalog.find((report) => report.id === reportId)");
    expect(onboardingSource).toContain("reportPersonaHref(report, selectedWorkspace.persona)");
    expect(onboardingSource).toContain(
      "onboarding-report-quick-access-reports-${selectedWorkspace.persona}"
    );
    expect(onboardingSource).toContain(
      "onboarding-report-quick-access-report-${selectedWorkspace.persona}-${report.id}"
    );
    expect(onboardingSource).toContain('data-testid="onboarding-report-quick-access-impact"');
    expect(onboardingSource).toContain(
      "onboarding-report-quick-access-${selectedWorkspace.persona}"
    );
    expect(onboardingSource).toContain('reportSectionHref(selectedWorkspace, "quick-access")');
    expect(onboardingSource).toContain("selectedSavedViews");
    expect(onboardingSource).toContain("reportSavedViewProfiles");
    expect(onboardingSource).toContain("reportSavedViewHref(view)");
    expect(onboardingSource).toContain('data-testid="onboarding-report-saved-views"');
    expect(onboardingSource).toContain("onboarding-report-saved-view-${view.id}");
    expect(onboardingSource).toContain("selectedAutomationImpactProfile");
    expect(onboardingSource).toContain("reportAutomationImpactProfiles");
    expect(onboardingSource).toContain(
      "onboarding-report-automation-impact-${selectedWorkspace.persona}"
    );
    expect(onboardingSource).toContain('reportSectionHref(selectedWorkspace, "automation-impact")');
    expect(onboardingSource).toContain("selectedDecisionShortcuts");
    expect(onboardingSource).toContain("reportDecisionShortcutHref(shortcut)");
    expect(onboardingSource).toContain("selectedTriggerRules");
    expect(onboardingSource).toContain("reportAutomationTriggerRuleHref(rule)");
    expect(onboardingSource).toContain("selectedDeliverySubscriptions");
    expect(onboardingSource).toContain("reportDeliverySubscriptionHref(subscription)");
    expect(onboardingSource).toContain("selectedAutomationStarters");
    expect(onboardingSource).toContain("reportAutomationStarterHref(starter)");
    expect(onboardingSource).toContain("selectedReportPackTemplates");
    expect(onboardingSource).toContain("reportPackTemplateHref(template)");
    expect(onboardingSource).toContain("getPreferredReportPersona() ??");
    expect(onboardingSource).toContain('?? "owner"');
    expect(onboardingSource).toContain("setSelectedPersona(workspace.persona)");
    expect(onboardingSource).toContain("setPreferredReportPersona(workspace.persona)");
    expect(onboardingSource).toContain("setPreferredReportPersona(selectedWorkspace.persona)");
    expect(onboardingSource).toContain('data-testid="onboarding-report-workspaces"');
    expect(onboardingSource).toContain("onboarding-report-workspace-${workspace.persona}");
    expect(onboardingSource).toContain('data-testid="onboarding-report-decision-shortcuts"');
    expect(onboardingSource).toContain("onboarding-report-decision-shortcut-${shortcut.id}");
    expect(onboardingSource).toContain("selectedComparisonPresets");
    expect(onboardingSource).toContain("reportComparisonPresets");
    expect(onboardingSource).toContain("reportComparisonPresetHref(preset)");
    expect(onboardingSource).toContain('data-testid="onboarding-report-comparison-presets"');
    expect(onboardingSource).toContain("onboarding-report-comparison-preset-${preset.id}");
    expect(onboardingSource).toContain("preset.automationTrigger");
    expect(onboardingSource).toContain('data-testid="onboarding-report-trigger-rules"');
    expect(onboardingSource).toContain("onboarding-report-trigger-rule-${rule.id}");
    expect(onboardingSource).toContain('data-testid="onboarding-report-delivery-subscriptions"');
    expect(onboardingSource).toContain(
      "onboarding-report-delivery-subscription-${subscription.id}"
    );
    expect(onboardingSource).toContain('data-testid="onboarding-report-automation-starters"');
    expect(onboardingSource).toContain("onboarding-report-automation-starter-${starter.id}");
    expect(onboardingSource).toContain('data-testid="onboarding-report-pack-templates"');
    expect(onboardingSource).toContain("onboarding-report-pack-template-${template.id}");
    expect(onboardingSource).toContain('data-testid="onboarding-open-report-operations"');
    expect(onboardingSource).toContain('data-testid="onboarding-open-report-workspace"');
    expect(onboardingSource).toContain('data-testid="onboarding-open-automation-center"');
    expect(onboardingSource).toContain(
      'reportSectionHref(selectedWorkspace, "automation-operations")'
    );
    expect(onboardingSource).toContain("Open report operations");
    expect(onboardingSource).toContain("reportWorkspaceHref(selectedWorkspace)");
    expect(onboardingSource).toContain(
      'reportSectionHref(selectedWorkspace, "automation-command-center")'
    );
    expect(onboardingSource).toContain("workspace.automations.length");
    expect(sidebarSource).not.toContain("reportPersonaWorkspaces.map");
    expect(sidebarSource).not.toContain("reportPersonaWorkspaces.flatMap");
    expect(i18nSource).toContain("ownerReports");
    expect(i18nSource).toContain("freelancerReports");
    expect(i18nSource).toContain("accountantReports");
    expect(i18nSource).toContain("ownerAutomationCenter");
    expect(i18nSource).toContain("freelancerAutomationCenter");
    expect(i18nSource).toContain("accountantAutomationCenter");
    expect(reportsSource).toContain("function personaFilterFromSearch(");
    expect(reportsSource).toContain("fallbackPersona: ReportPersona | null = null");
    expect(reportsSource).toContain("getPreferredReportPersona()");
    expect(reportsSource).toContain("setPreferredReportPersonaState");
    expect(reportsSource).toContain("clearPreferredReportPersona()");
    expect(reportsSource).toContain("setPreferredReportPersona(persona)");
    expect(reportsSource).toContain("getPreferredReportWorkflowSearch(personaFilter)");
    expect(reportsSource).toContain("setPreferredReportWorkflowSearch(value, personaFilter)");
    expect(reportsSource).toContain("clearPreferredReportWorkflowSearch(personaFilter)");
    expect(reportsSource).toContain("reportWorkflowSearchFromSearch(");
    expect(reportsSource).toContain("normalizeReportWorkflowSearch(value)");
    expect(reportsSource).toContain('new URLSearchParams(search).get("workflowSearch")');
    expect(reportsSource).toContain("updateReportWorkflowSearch");
    expect(reportsSource).toContain("clearReportWorkflowSearch");
    expect(reportsSource).toContain("personaFilterFromSearch(");
    expect(reportsSource).toContain("reportWorkflowGapFilterFromSearch(");
    expect(reportsSource).toContain("parseReportWorkflowGapFilter");
    expect(reportsSource).toContain('parseReportPersona(params.get("workflowGapPersona"))');
    expect(reportsSource).toContain("locationSearch || window.location.search");
    expect(reportsSource).toContain("preferredReportPersona");
    expect(reportsSource).toContain("return reportPersonas.includes(persona as ReportPersona)");
    expect(reportsSource).toContain('if (persona === "all") return "all";');
    expect(reportsSource).toContain("navigate(reportWorkspaceHref(workspace))");

    expect(parseReportPersona("owner")).toBe("owner");
    expect(parseReportPersona("freelancer")).toBe("freelancer");
    expect(parseReportPersona("accountant")).toBe("accountant");
    expect(parseReportPersona("all")).toBeNull();
    expect(parseReportPersona(null)).toBeNull();
    expect(parseReportWorkflowGapFilter("report-gaps")).toBe("report-gaps");
    expect(parseReportWorkflowGapFilter("rule-gaps")).toBe("rule-gaps");
    expect(parseReportWorkflowGapFilter("delivery-gaps")).toBe("delivery-gaps");
    expect(parseReportWorkflowGapFilter("unknown")).toBeNull();
    expect(normalizeReportWorkflowSearch("  cash runway  ")).toBe("cash runway");
    expect(reportWorkflowGapFilterLabels["report-gaps"]).toBe("Report gaps");
    expect(reportWorkflowGapFilterLabels["rule-gaps"]).toBe("Rule gaps");
    expect(reportWorkflowGapFilterLabels["delivery-gaps"]).toBe("Delivery gaps");

    for (const workspace of reportPersonaWorkspaces) {
      expect(reportWorkspaceHref(workspace)).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}`
      );
      expect(reportWorkflowFinderGapHref({ persona: workspace.persona, gap: "report-gaps" })).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}&workflowGap=report-gaps&workflowGapPersona=${workspace.persona}#report-workflow-finder-title`
      );
      expect(
        reportWorkflowContextHref({
          persona: workspace.persona,
          search: "cash runway",
          gap: "rule-gaps",
        })
      ).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}&workflowSearch=cash+runway&workflowGap=rule-gaps&workflowGapPersona=${workspace.persona}#report-workflow-finder-title`
      );
      expect(workspace.navLabel).toContain("Reports");
    }
    expect(reportWorkflowContextHref({ persona: "all", tab: "pl", search: "vat review" })).toBe(
      "/reports?tab=pl&persona=all&workflowSearch=vat+review#report-workflow-finder-title"
    );
  });

  it("persists workflow finder search and gap context per reporting persona", () => {
    const localStorage = createMemoryLocalStorage({
      [`${REPORT_WORKFLOW_SEARCH_PREFERENCE_KEY}.owner`]: "cash runway",
      [`${REPORT_WORKFLOW_SEARCH_PREFERENCE_KEY}.freelancer`]: "expense variance",
      [`${REPORT_WORKFLOW_GAP_FILTER_PREFERENCE_KEY}.owner`]: "rule-gaps",
      [`${REPORT_WORKFLOW_GAP_FILTER_PREFERENCE_KEY}.accountant`]: "unsupported-gap",
    });
    vi.stubGlobal("window", { localStorage });

    expect(getPreferredReportWorkflowSearch("owner")).toBe("cash runway");
    expect(getPreferredReportWorkflowSearch("freelancer")).toBe("expense variance");
    expect(getPreferredReportWorkflowSearch("accountant")).toBe("");
    expect(getPreferredReportWorkflowGapFilter("owner")).toBe("rule-gaps");
    expect(getPreferredReportWorkflowGapFilter("accountant")).toBeNull();

    setPreferredReportWorkflowSearch("  close review  ", "accountant");
    setPreferredReportWorkflowGapFilter("freelancer", "delivery-gaps");

    expect(getPreferredReportWorkflowSearch("accountant")).toBe("close review");
    expect(getPreferredReportWorkflowGapFilter("freelancer")).toBe("delivery-gaps");
    expect(getPreferredReportWorkflowGapFilter("owner")).toBe("rule-gaps");

    clearPreferredReportWorkflowSearch("owner");
    clearPreferredReportWorkflowGapFilter("freelancer");

    expect(getPreferredReportWorkflowSearch("owner")).toBe("");
    expect(getPreferredReportWorkflowSearch("freelancer")).toBe("expense variance");
    expect(getPreferredReportWorkflowGapFilter("freelancer")).toBeNull();
    expect(getPreferredReportWorkflowGapFilter("owner")).toBe("rule-gaps");
  });

  it("persists sanitized favorite report pins per reporting persona", () => {
    const localStorage = createMemoryLocalStorage({
      [`${REPORT_FAVORITE_REPORT_IDS_KEY}.owner`]: JSON.stringify([
        "cash-flow-forecast",
        "missing-report",
        "trial-balance",
        "profit-loss",
      ]),
      [`${REPORT_FAVORITE_REPORT_IDS_KEY}.freelancer`]: "not-json",
    });
    vi.stubGlobal("window", { localStorage });

    expect(
      parseReportFavoriteReportIds(
        JSON.stringify(["invoice-status", "missing-report", "profit-loss"]),
        "freelancer"
      )
    ).toEqual(["profit-loss", "invoice-status"]);
    expect(getFavoriteReportIds("owner")).toEqual(["profit-loss", "cash-flow-forecast"]);
    expect(getFavoriteReportIds("freelancer")).toEqual([]);

    expect(
      setFavoriteReportIds(["invoice-status", "profit-loss", "invoice-status"], "freelancer")
    ).toEqual(["profit-loss", "invoice-status"]);
    expect(getFavoriteReportIds("freelancer")).toEqual(["profit-loss", "invoice-status"]);

    expect(toggleFavoriteReportId("profit-loss", "freelancer")).toEqual(["invoice-status"]);
    expect(toggleFavoriteReportId("cash-flow-forecast", "freelancer")).toEqual([
      "invoice-status",
      "cash-flow-forecast",
    ]);
    expect(getFavoriteReportIds("owner")).toEqual(["profit-loss", "cash-flow-forecast"]);
  });

  it("exposes persona pack workflows through global search", () => {
    expect(commandSource).toContain('reportSectionHref(workspace, "report-suites")');
    expect(commandSource).toContain('reportSectionHref(workspace, "quick-access")');
    expect(commandSource).toContain('reportSectionHref(workspace, "saved-views")');
    expect(commandSource).toContain('reportSectionHref(workspace, "automation-operations")');
    expect(commandSource).toContain('reportSectionHref(workspace, "automation-impact")');
    expect(commandSource).toContain('reportSectionHref(workspace, "decision-shortcuts")');
    expect(commandSource).toContain('reportSectionHref(workspace, "recommendations")');
    expect(commandSource).toContain('reportSectionHref(workspace, "automation-starters")');
    expect(commandSource).toContain('reportSectionHref(workspace, "trigger-rules")');
    expect(commandSource).toContain('reportSectionHref(workspace, "delivery-subscriptions")');
    expect(commandSource).toContain('reportSectionHref(workspace, "pack-readiness")');
    expect(commandSource).toContain('reportSectionHref(workspace, "automation-rules")');
    expect(commandSource).toContain('reportSectionHref(workspace, "automation-command-center")');
    expect(commandSource).toContain('reportSectionHref(workspace, "pack-automation")');
    expect(commandSource).toContain("commandQuickAccessProfiles");
    expect(commandSource).toContain("syncedReportCatalog?.quickAccessProfiles");
    expect(commandSource).toContain("id: `report-quick-access-${workspace.persona}`");
    expect(commandSource).toContain("Quick access reports - ${workspace.title}");
    expect(commandSource).toContain("quick access favorite daily reports open from anywhere");
    expect(commandSource).toContain("commandSavedViewProfiles.map");
    expect(commandSource).toContain("syncedReportCatalog?.savedViews");
    expect(commandSource).toContain("id: `report-saved-view-${view.id}`");
    expect(commandSource).toContain("href: syncedHref(view) ?? reportSavedViewHref(view)");
    expect(commandSource).toContain("saved report view date range comparison currency dimension");
    expect(commandSource).toContain("id: `report-saved-views-${workspace.persona}`");
    expect(commandSource).toContain("Saved report views - ${workspace.title}");
    expect(commandSource).toContain("commandAutomationImpactProfiles");
    expect(commandSource).toContain("syncedReportCatalog?.automationImpactProfiles");
    expect(commandSource).toContain("id: `report-automation-impact-${workspace.persona}`");
    expect(commandSource).toContain("Automation impact - ${workspace.title}");
    expect(commandSource).toContain("automation impact time saved work removed reports");
    expect(commandSource).toContain("commandDecisionShortcuts.map");
    expect(commandSource).toContain("id: `report-decision-shortcut-${shortcut.id}`");
    expect(commandSource).toContain(
      "href: syncedHref(shortcut) ?? reportDecisionShortcutHref(shortcut)"
    );
    expect(commandSource).toContain("description: shortcut.answer");
    expect(commandSource).toContain("decision question report shortcut");
    expect(commandSource).toContain("commandTriggerRules.map");
    expect(commandSource).toContain("id: `report-trigger-rule-${rule.id}`");
    expect(commandSource).toContain(
      "href: syncedHref(rule) ?? reportAutomationTriggerRuleHref(rule)"
    );
    expect(commandSource).toContain("description: `${rule.condition} · ${rule.actionLabel}`");
    expect(commandSource).toContain("trigger rule threshold report automation alert");
    expect(commandSource).toContain("commandDeliverySubscriptions.map");
    expect(commandSource).toContain("id: `report-delivery-subscription-${subscription.id}`");
    expect(commandSource).toContain(
      "href: syncedHref(subscription) ?? reportDeliverySubscriptionHref(subscription)"
    );
    expect(commandSource).toContain(
      "description: `${subscription.cadence} · ${subscription.channel} · ${subscription.recipients}`"
    );
    expect(commandSource).toContain("delivery subscription scheduled send report pack recipients");
    expect(commandSource).toContain("commandAutomationStarters.map");
    expect(commandSource).toContain("id: `report-automation-starter-${starter.id}`");
    expect(commandSource).toContain(
      "href: syncedHref(starter) ?? reportAutomationStarterHref(starter)"
    );
    expect(commandSource).toContain("description: `${starter.audience} · ${starter.outcome}`");
    expect(commandSource).toContain("automation starter autopilot report pack");
    expect(commandSource).toContain("commandPackTemplates.map");
    expect(commandSource).toContain("id: `report-pack-template-${template.id}`");
    expect(commandSource).toContain(
      "href: syncedHref(template) ?? reportPackTemplateHref(template)"
    );
    expect(commandSource).toContain(
      "description: `${template.audience} · ${template.cadence} · ${template.delivery}`"
    );
    expect(commandSource).toContain("ready made report pack template");
    expect(commandSource).toContain("commandComparisonPresets.map");
    expect(commandSource).toContain("id: `report-comparison-preset-${preset.id}`");
    expect(commandSource).toContain(
      "href: syncedHref(preset) ?? reportComparisonPresetHref(preset)"
    );
    expect(commandSource).toContain("description: `${preset.question} · ${preset.baseline}`");
    expect(commandSource).toContain("comparison preset report pack");
    expect(commandSource).toContain("commandReportSuites.map");
    expect(commandSource).toContain("commandReportSuites.flatMap");
    expect(commandSource).toContain("syncedReportCatalog?.reportSuites");
    expect(commandSource).toContain("id: `report-suite-${suite.id}`");
    expect(commandSource).toContain("href: syncedHref(suite) ?? reportSuiteHref(suite)");
    expect(commandSource).toContain("suite.triggerRuleIds.join");
    expect(commandSource).toContain("suite.deliverySubscriptionId");
    expect(commandSource).toContain("suite.decisionShortcutId");
    expect(commandSource).toContain(
      "queue suite delivery send scheduled report suite from anywhere"
    );
    expect(commandSource).toContain(
      "report suite role based reports comparison pack automation delivery trigger rules"
    );
    expect(commandSource).toContain("id: `report-suites-${workspace.persona}`");
    expect(commandSource).toContain("Report suites - ${workspace.title}");
    expect(commandSource).toContain("id: `report-automation-operations-${workspace.persona}`");
    expect(commandSource).toContain("id: `report-suites-${workspace.persona}`");
    expect(commandSource).toContain("id: `report-saved-views-${workspace.persona}`");
    expect(commandSource).toContain("id: `report-decision-shortcuts-${workspace.persona}`");
    expect(commandSource).toContain("id: `report-trigger-rules-${workspace.persona}`");
    expect(commandSource).toContain("id: `report-delivery-subscriptions-${workspace.persona}`");
    expect(commandSource).toContain("id: `report-automation-starters-${workspace.persona}`");
    expect(commandSource).toContain("id: `report-recommendations-${workspace.persona}`");
    expect(commandSource).toContain("id: `report-pack-readiness-${workspace.persona}`");
    expect(commandSource).toContain("id: `report-automation-rules-${workspace.persona}`");
    expect(commandSource).toContain("id: `report-automation-command-center-${workspace.persona}`");
    expect(commandSource).toContain("id: `report-pack-automation-${workspace.persona}`");
    expect(commandSource).toContain("Report automation operations - ${workspace.title}");
    expect(commandSource).toContain("Report suites - ${workspace.title}");
    expect(commandSource).toContain("Saved report views - ${workspace.title}");
    expect(commandSource).toContain("Decision shortcuts - ${workspace.title}");
    expect(commandSource).toContain("Trigger rules - ${workspace.title}");
    expect(commandSource).toContain("Delivery subscriptions - ${workspace.title}");
    expect(commandSource).toContain("Automation starters - ${workspace.title}");
    expect(commandSource).toContain("Recommended reports - ${workspace.title}");
    expect(commandSource).toContain("Report pack readiness - ${workspace.title}");
    expect(commandSource).toContain("Report automation rules - ${workspace.title}");
    expect(commandSource).toContain("Automation command center - ${workspace.title}");
    expect(commandSource).toContain("Report pack automation - ${workspace.title}");

    for (const report of liveReportCatalog) {
      expect(
        reportAutomationStarters.some((starter) => starter.reportIds.includes(report.id))
      ).toBe(true);
      expect(
        reportDeliverySubscriptions.some((subscription) =>
          subscription.reportIds.includes(report.id)
        )
      ).toBe(true);
      expect(reportComparisonPresets.some((preset) => preset.reportIds.includes(report.id))).toBe(
        true
      );
    }

    for (const workspace of reportPersonaWorkspaces) {
      expect(reportSectionHref(workspace, "workflow-finder")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#report-workflow-finder-title`
      );
      expect(reportSectionHref(workspace, "report-suites")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#report-suites-title`
      );
      expect(reportSectionHref(workspace, "automation-operations")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#report-automation-operations-title`
      );
      expect(reportSectionHref(workspace, "decision-shortcuts")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#decision-shortcuts-title`
      );
      expect(reportSectionHref(workspace, "recommendations")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#recommended-reports-title`
      );
      expect(reportSectionHref(workspace, "automation-starters")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#automation-starters-title`
      );
      expect(reportSectionHref(workspace, "trigger-rules")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#trigger-rules-title`
      );
      expect(reportSectionHref(workspace, "delivery-subscriptions")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#report-delivery-subscriptions-title`
      );
      expect(reportSectionHref(workspace, "pack-readiness")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#report-pack-readiness-title`
      );
      expect(reportSectionHref(workspace, "automation-rules")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#report-automation-rules-title`
      );
      expect(reportSectionHref(workspace, "automation-command-center")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#automation-command-center-title`
      );
      expect(reportSectionHref(workspace, "pack-automation")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#report-pack-automation-title`
      );
    }

    const allReportIds = new Set(reportCatalog.map((report) => report.id));
    const comparisonMetricIds = new Set([
      "revenue",
      "net-profit",
      "net-margin",
      "expense-ratio",
      "revenue-expense-coverage",
      "break-even-gap",
      "invoice-value",
      "invoice-count",
      "paid-invoice-share",
      "average-invoice-value",
      "liability-asset-ratio",
      "debt-to-equity-ratio",
      "burn-rate",
      "cash-runway-days",
      "projected-cash-shortfall",
      "cash-risk-week-count",
      "operating-cash-flow",
      "budget-actual-variance",
      "open-receivables",
      "open-invoice-count",
      "average-open-invoice-value",
      "open-invoice-value-share",
      "due-soon-invoice-count",
      "due-soon-invoice-value",
      "average-due-soon-invoice-value",
      "due-soon-invoice-share",
      "open-invoice-share",
      "overdue-receivables",
      "overdue-receivable-share",
      "overdue-invoice-count",
      "average-overdue-invoice-value",
      "average-overdue-invoice-days",
      "overdue-invoice-share",
      "vendor-bill-value",
      "vendor-bill-count",
      "average-bill-value",
      "top-vendor-share",
      "paid-bill-share",
      "open-payables",
      "open-bill-value-share",
      "open-cash-gap",
      "open-cash-coverage",
      "open-workload-gap",
      "open-bill-count",
      "average-open-bill-value",
      "due-soon-bill-count",
      "due-soon-bill-value",
      "average-due-soon-bill-value",
      "due-soon-bill-share",
      "due-soon-cash-gap",
      "due-soon-cash-coverage",
      "due-soon-workload-gap",
      "open-bill-share",
      "overdue-payables",
      "overdue-cash-gap",
      "overdue-cash-coverage",
      "overdue-workload-gap",
      "overdue-payable-share",
      "overdue-bill-count",
      "average-overdue-bill-value",
      "average-overdue-bill-days",
      "overdue-bill-share",
      "working-capital-proxy",
      "collection-days",
      "payable-days",
      "cash-conversion-gap",
      "top-customer-share",
      "top-product-service-share",
      "expense-spend",
      "receipt-count",
      "average-receipt-value",
      "expense-claim-review-value",
      "expense-claim-review-count",
      "submitted-expense-claim-count",
      "submitted-expense-claim-value",
      "approved-expense-claim-count",
      "approved-expense-claim-value",
      "unposted-expense-share",
      "unposted-receipt-count",
      "unposted-receipt-value",
      "auto-posted-receipt-count",
      "auto-posted-receipt-value",
      "receipt-automation-coverage",
      "receipt-automation-value-coverage",
      "bank-reconciliation-coverage",
      "reconciled-bank-count",
      "reconciled-bank-value",
      "unreconciled-bank-count",
      "unreconciled-bank-value",
      "bank-match-suggestion-coverage",
      "bank-match-suggestion-value-coverage",
      "suggested-bank-match-count",
      "bank-assisted-transaction-count",
      "bank-assisted-transaction-value",
      "bank-assisted-transaction-coverage",
      "bank-assisted-transaction-value-coverage",
      "automation-work-queue-count",
      "automation-work-queue-value",
      "ledger-automation-share",
      "manual-ledger-activity",
      "automated-ledger-activity",
      "automation-adoption-index",
      "automation-value-adoption-index",
      "cost-center-net-income",
      "cost-center-expenses",
      "vat-due",
      "corporate-tax-payable",
      "total-tax-exposure",
      "tax-exposure-rate",
      "tax-reserve-coverage",
      "tax-funding-gap",
      "tax-adjusted-runway-days",
      "payroll-cost",
      "payroll-run-count",
      "payroll-deduction-share",
      "average-payroll-run-value",
      "payroll-covered-employees",
      "payroll-cost-per-covered-employee",
      "payroll-approval-queue-count",
      "payroll-approval-queue-value",
      "payroll-readiness-queue-count",
      "payroll-readiness-queue-value",
      "wps-missing-run-count",
      "wps-missing-run-value",
      "payroll-expense-share",
      "wps-ready-share",
      "inventory-movement",
      "inventory-review-items",
      "inventory-review-share",
      "inventory-review-value",
      "fixed-asset-review-items",
      "fixed-asset-review-share",
      "fixed-asset-review-value",
      "depreciation-review-items",
      "depreciation-review-value",
      "depreciation-ready-items",
      "depreciation-ready-share",
      "depreciation-estimate",
      "consolidated-revenue",
      "consolidated-expenses",
      "consolidated-net-profit",
      "consolidated-margin",
      "consolidation-review-items",
      "month-end-open-checks",
      "month-end-readiness",
      "audit-high-risk-event-count",
      "audit-high-risk-event-share",
      "audit-review-event-count",
      "audit-review-event-share",
      "fx-unrealized-exposure",
      "manual-ledger-share",
      "ledger-activity",
    ]);
    expect(reportDecisionShortcuts).toHaveLength(12);
    expect(reportDecisionShortcuts.map((shortcut) => shortcut.id)).toEqual(
      expect.arrayContaining([
        "owner-automation-readiness",
        "freelancer-tax-ready-this-month",
        "accountant-pack-ready-to-send",
      ])
    );
    expect(reportAutomationTriggerRules).toHaveLength(9);
    expect(reportDeliverySubscriptions).toHaveLength(6);
    expect(reportAutomationStarters).toHaveLength(6);
    expect(reportPackTemplates).toHaveLength(6);
    expect(reportComparisonPresets).toHaveLength(9);
    expect(reportSuiteProfiles).toHaveLength(6);
    expect(reportManagementBriefProfiles).toHaveLength(3);
    expect(reportSavedViewProfiles).toHaveLength(9);

    for (const workspace of reportPersonaWorkspaces) {
      expect(
        reportDecisionShortcuts.filter((shortcut) => shortcut.persona === workspace.persona)
      ).toHaveLength(4);
      expect(
        reportAutomationTriggerRules.filter((rule) => rule.persona === workspace.persona)
      ).toHaveLength(3);
      expect(
        reportDeliverySubscriptions.filter(
          (subscription) => subscription.persona === workspace.persona
        )
      ).toHaveLength(2);
      expect(
        reportAutomationStarters.filter((starter) => starter.persona === workspace.persona)
      ).toHaveLength(2);
      expect(
        reportPackTemplates.filter((template) => template.persona === workspace.persona)
      ).toHaveLength(2);
      expect(
        reportComparisonPresets.filter((preset) => preset.persona === workspace.persona)
      ).toHaveLength(3);
      expect(
        reportSuiteProfiles.filter((suite) => suite.persona === workspace.persona)
      ).toHaveLength(2);
      expect(
        reportManagementBriefProfiles.filter((brief) => brief.persona === workspace.persona)
      ).toHaveLength(1);
      expect(
        reportQuickAccessProfiles.filter((profile) => profile.persona === workspace.persona)
      ).toHaveLength(1);
      expect(
        reportSavedViewProfiles.filter((view) => view.persona === workspace.persona)
      ).toHaveLength(3);
    }

    for (const profile of reportQuickAccessProfiles) {
      expect(reportPersonas).toContain(profile.persona);
      expect(profile.reportIds.length).toBeGreaterThanOrEqual(6);
      expect(new Set(profile.reportIds).size).toBe(profile.reportIds.length);
      expect(profile.reportIds).toEqual(
        expect.arrayContaining(
          reportCatalog
            .filter((item) => item.status === "live" && item.personas.includes(profile.persona))
            .map((item) => item.id)
        )
      );
      expect(
        reportSectionHref(
          reportPersonaWorkspaces.find((item) => item.persona === profile.persona)!,
          "quick-access"
        )
      ).toContain("report-quick-access-title");

      for (const reportId of profile.reportIds) {
        const report = reportCatalog.find((item) => item.id === reportId);
        expect(allReportIds.has(reportId)).toBe(true);
        expect(report?.personas).toContain(profile.persona);
      }

      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === profile.comparisonPresetId
      );
      expect(comparisonPreset?.persona).toBe(profile.persona);

      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === profile.automationStarterId
      );
      expect(automationStarter?.persona).toBe(profile.persona);

      const deliverySubscription = reportDeliverySubscriptions.find(
        (subscription) => subscription.id === profile.deliverySubscriptionId
      );
      expect(deliverySubscription?.persona).toBe(profile.persona);
    }

    for (const view of reportSavedViewProfiles) {
      expect(reportPersonas).toContain(view.persona);
      expect(reportSavedViewHref(view)).toContain(
        `persona=${view.persona}#report-saved-view-${view.id}`
      );
      expect(view.dateRangePreset).toBeTruthy();
      expect(view.comparisonPeriod).toBeTruthy();
      expect(view.basis).toBeTruthy();
      expect(view.currency).toBe("AED");
      expect(view.dimension).toBeTruthy();
      expect(view.exportFormat).toBeTruthy();
      expect(view.automationTrigger).toBeTruthy();

      const report = reportCatalog.find((item) => item.id === view.reportId);
      expect(report?.personas).toContain(view.persona);

      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === view.comparisonPresetId
      );
      expect(comparisonPreset?.persona).toBe(view.persona);

      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === view.automationStarterId
      );
      expect(automationStarter?.persona).toBe(view.persona);
    }

    for (const suite of reportSuiteProfiles) {
      expect(reportPersonas).toContain(suite.persona);
      expect(reportSuiteHref(suite)).toContain(`persona=${suite.persona}#report-suite-${suite.id}`);
      expect(suite.workflow).toBeTruthy();
      expect(suite.outcome).toBeTruthy();
      expect(suite.primaryAction).toBeTruthy();
      expect(suite.reportIds.length).toBeGreaterThanOrEqual(5);
      expect(suite.triggerRuleIds.length).toBeGreaterThanOrEqual(2);
      expect(suite.deliverySubscriptionId).toBeTruthy();
      expect(suite.decisionShortcutId).toBeTruthy();
      expect(suite.savedViewIds.length).toBeGreaterThanOrEqual(1);

      for (const reportId of suite.reportIds) {
        const report = reportCatalog.find((item) => item.id === reportId);
        expect(allReportIds.has(reportId)).toBe(true);
        expect(report?.personas).toContain(suite.persona);
      }

      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === suite.comparisonPresetId
      );
      expect(comparisonPreset?.persona).toBe(suite.persona);

      const packTemplate = reportPackTemplates.find(
        (template) => template.id === suite.packTemplateId
      );
      expect(packTemplate?.persona).toBe(suite.persona);

      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === suite.automationStarterId
      );
      expect(automationStarter?.persona).toBe(suite.persona);

      const deliverySubscription = reportDeliverySubscriptions.find(
        (subscription) => subscription.id === suite.deliverySubscriptionId
      );
      expect(deliverySubscription?.persona).toBe(suite.persona);

      const decisionShortcut = reportDecisionShortcuts.find(
        (shortcut) => shortcut.id === suite.decisionShortcutId
      );
      expect(decisionShortcut?.persona).toBe(suite.persona);

      for (const triggerRuleId of suite.triggerRuleIds) {
        const triggerRule = reportAutomationTriggerRules.find((rule) => rule.id === triggerRuleId);
        expect(triggerRule?.persona).toBe(suite.persona);
      }

      for (const savedViewId of suite.savedViewIds) {
        const savedView = reportSavedViewProfiles.find((view) => view.id === savedViewId);
        expect(savedView?.persona).toBe(suite.persona);
      }
    }

    const personaComparisonMetricIds = new Map(
      reportPersonas.map((persona) => [
        persona,
        new Set(
          reportComparisonPresets
            .filter((preset) => preset.persona === persona)
            .flatMap((preset) => preset.metricIds)
        ),
      ])
    );

    for (const brief of reportManagementBriefProfiles) {
      expect(reportPersonas).toContain(brief.persona);
      expect(reportManagementBriefHref(brief)).toContain(
        `persona=${brief.persona}#report-management-brief-${brief.id}`
      );
      expect(brief.reportIds.length).toBeGreaterThanOrEqual(8);
      expect(brief.kpiMetricIds.length).toBeGreaterThanOrEqual(6);
      expect(brief.kpiWidgets).toHaveLength(4);
      expect(brief.narrativeSections).toHaveLength(3);
      expect(brief.dimensionBreakdowns.length).toBeGreaterThanOrEqual(3);
      expect(brief.outcome).toBeTruthy();
      expect(brief.commandKeywords).toContain(brief.persona);

      for (const reportId of brief.reportIds) {
        const report = reportCatalog.find((item) => item.id === reportId);
        expect(allReportIds.has(reportId)).toBe(true);
        expect(report?.personas).toContain(brief.persona);
      }

      const personaMetricIds = personaComparisonMetricIds.get(brief.persona)!;
      for (const metricId of brief.kpiMetricIds) {
        expect(personaMetricIds.has(metricId)).toBe(true);
      }

      for (const widget of brief.kpiWidgets) {
        expect(widget.id).toContain(brief.persona);
        expect(brief.kpiMetricIds).toContain(widget.metricId);
        expect(["currency", "percent", "count", "days"]).toContain(widget.display);
        expect(widget.question).toBeTruthy();
      }

      for (const section of brief.narrativeSections) {
        expect(section.prompt).toBeTruthy();
        expect(section.sourceReportIds.length).toBeGreaterThanOrEqual(3);
        expect(section.comparisonMetricIds.length).toBeGreaterThanOrEqual(3);

        for (const reportId of section.sourceReportIds) {
          expect(brief.reportIds).toContain(reportId);
        }

        for (const metricId of section.comparisonMetricIds) {
          expect(personaMetricIds.has(metricId)).toBe(true);
        }
      }

      for (const dimension of brief.dimensionBreakdowns) {
        expect(brief.reportIds).toContain(dimension.reportId);
        expect(dimension.dimension).toBeTruthy();
        expect(dimension.question).toBeTruthy();
      }

      const suite = reportSuiteProfiles.find((item) => item.id === brief.reportSuiteId);
      expect(suite?.persona).toBe(brief.persona);

      const packTemplate = reportPackTemplates.find((item) => item.id === brief.packTemplateId);
      expect(packTemplate?.persona).toBe(brief.persona);

      const comparisonPreset = reportComparisonPresets.find(
        (item) => item.id === brief.comparisonPresetId
      );
      expect(comparisonPreset?.persona).toBe(brief.persona);

      const automationStarter = reportAutomationStarters.find(
        (item) => item.id === brief.automationStarterId
      );
      expect(automationStarter?.persona).toBe(brief.persona);

      const deliverySubscription = reportDeliverySubscriptions.find(
        (item) => item.id === brief.deliverySubscriptionId
      );
      expect(deliverySubscription?.persona).toBe(brief.persona);

      const decisionShortcut = reportDecisionShortcuts.find(
        (item) => item.id === brief.decisionShortcutId
      );
      expect(decisionShortcut?.persona).toBe(brief.persona);

      const savedView = reportSavedViewProfiles.find((item) => item.id === brief.savedViewId);
      expect(savedView?.persona).toBe(brief.persona);
    }

    const accountantBrief = reportManagementBriefProfiles.find(
      (brief) => brief.persona === "accountant"
    );
    expect(accountantBrief?.batchAction?.label).toBe("Prepare client batch");

    for (const rule of reportAutomationTriggerRules) {
      expect(reportPersonas).toContain(rule.persona);
      expect(["critical", "review", "info"]).toContain(rule.severity);
      expect(reportAutomationTriggerRuleHref(rule)).toContain(
        `persona=${rule.persona}#report-trigger-rule-${rule.id}`
      );
      expect(rule.reportIds.length).toBeGreaterThanOrEqual(3);
      expect(rule.condition).toBeTruthy();
      expect(rule.threshold).toBeTruthy();
      expect(rule.cadence).toBeTruthy();
      expect(rule.actionLabel).toBeTruthy();

      for (const reportId of rule.reportIds) {
        const report = reportCatalog.find((item) => item.id === reportId);
        expect(allReportIds.has(reportId)).toBe(true);
        expect(report?.personas).toContain(rule.persona);
      }

      const starter = reportAutomationStarters.find((item) => item.id === rule.automationStarterId);
      expect(starter?.persona).toBe(rule.persona);

      const shortcut = reportDecisionShortcuts.find((item) => item.id === rule.decisionShortcutId);
      expect(shortcut?.persona).toBe(rule.persona);
    }

    for (const subscription of reportDeliverySubscriptions) {
      expect(reportPersonas).toContain(subscription.persona);
      expect(reportDeliverySubscriptionHref(subscription)).toContain(
        `persona=${subscription.persona}#report-delivery-subscription-${subscription.id}`
      );
      expect(subscription.reportIds.length).toBeGreaterThanOrEqual(5);
      expect(subscription.triggerRuleIds.length).toBeGreaterThanOrEqual(2);
      expect(subscription.audience).toBeTruthy();
      expect(subscription.cadence).toBeTruthy();
      expect(subscription.channel).toBeTruthy();
      expect(subscription.format).toBeTruthy();
      expect(subscription.recipients).toBeTruthy();
      expect(subscription.deliveryGuardrail).toBeTruthy();

      for (const reportId of subscription.reportIds) {
        const report = reportCatalog.find((item) => item.id === reportId);
        expect(allReportIds.has(reportId)).toBe(true);
        expect(report?.personas).toContain(subscription.persona);
      }

      const packTemplate = reportPackTemplates.find(
        (item) => item.id === subscription.packTemplateId
      );
      expect(packTemplate?.persona).toBe(subscription.persona);

      const automationStarter = reportAutomationStarters.find(
        (item) => item.id === subscription.automationStarterId
      );
      expect(automationStarter?.persona).toBe(subscription.persona);

      const decisionShortcut = reportDecisionShortcuts.find(
        (item) => item.id === subscription.decisionShortcutId
      );
      expect(decisionShortcut?.persona).toBe(subscription.persona);

      for (const ruleId of subscription.triggerRuleIds) {
        const rule = reportAutomationTriggerRules.find((item) => item.id === ruleId);
        expect(rule?.persona).toBe(subscription.persona);
      }
    }

    for (const shortcut of reportDecisionShortcuts) {
      expect(reportPersonas).toContain(shortcut.persona);
      expect(reportDecisionShortcutHref(shortcut)).toContain(
        `persona=${shortcut.persona}#report-decision-shortcut-${shortcut.id}`
      );
      expect(shortcut.question).toMatch(/\?$/);
      expect(shortcut.answer).toBeTruthy();
      expect(shortcut.reportIds).toContain(shortcut.primaryReportId);
      expect(shortcut.reportIds.length).toBeGreaterThanOrEqual(4);

      const primaryReport = reportCatalog.find((report) => report.id === shortcut.primaryReportId);
      expect(primaryReport?.personas).toContain(shortcut.persona);

      for (const reportId of shortcut.reportIds) {
        const report = reportCatalog.find((item) => item.id === reportId);
        expect(allReportIds.has(reportId)).toBe(true);
        expect(report?.personas).toContain(shortcut.persona);
      }

      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === shortcut.comparisonPresetId
      );
      expect(comparisonPreset?.persona).toBe(shortcut.persona);

      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === shortcut.automationStarterId
      );
      expect(automationStarter?.persona).toBe(shortcut.persona);
    }

    for (const starter of reportAutomationStarters) {
      const workspace = reportPersonaWorkspaces.find((item) => item.persona === starter.persona);
      expect(reportPersonas).toContain(starter.persona);
      expect(reportAutomationStarterHref(starter)).toBe(
        `/reports?tab=${workspace?.primaryTab}&persona=${starter.persona}#report-automation-starter-${starter.id}`
      );
      expect(starter.reportIds.length).toBeGreaterThanOrEqual(4);
      expect(starter.playbookIds.length).toBeGreaterThanOrEqual(1);
      expect(starter.queueIds.length).toBeGreaterThanOrEqual(2);
      expect(starter.setupSteps.length).toBeGreaterThanOrEqual(3);
      expect(starter.outcome).toBeTruthy();
      expect(starter.setupTime).toMatch(/setup$/);
      expect(starter.primaryAction).toBeTruthy();

      for (const reportId of starter.reportIds) {
        const report = reportCatalog.find((item) => item.id === reportId);
        expect(allReportIds.has(reportId)).toBe(true);
        expect(report?.personas).toContain(starter.persona);
      }

      for (const playbookId of starter.playbookIds) {
        expect(workspace?.automations.some((playbook) => playbook.id === playbookId)).toBe(true);
      }

      for (const queueId of starter.queueIds) {
        expect(reportsSource).toContain(`id: "${queueId}"`);
      }
    }

    for (const template of reportPackTemplates) {
      expect(reportPersonas).toContain(template.persona);
      expect(reportPackTemplateHref(template)).toContain(
        `/reports?tab=${
          reportPersonaWorkspaces.find((workspace) => workspace.persona === template.persona)
            ?.primaryTab
        }&persona=${template.persona}#report-pack-template-${template.id}`
      );
      expect(template.reportIds.length).toBeGreaterThanOrEqual(5);
      expect(template.audience).toBeTruthy();
      expect(template.outcome).toBeTruthy();
      expect(template.comparisonFocus).toBeTruthy();
      expect(template.automationTrigger).toBeTruthy();

      for (const reportId of template.reportIds) {
        const report = reportCatalog.find((item) => item.id === reportId);
        expect(allReportIds.has(reportId)).toBe(true);
        expect(report?.personas).toContain(template.persona);
      }
    }

    const comparisonPresetIds = new Set(reportComparisonPresets.map((preset) => preset.id));
    const automationStarterIds = new Set(reportAutomationStarters.map((starter) => starter.id));
    const triggerRuleIds = new Set(reportAutomationTriggerRules.map((rule) => rule.id));
    const deliverySubscriptionIds = new Set(
      reportDeliverySubscriptions.map((subscription) => subscription.id)
    );
    const decisionShortcutIds = new Set(reportDecisionShortcuts.map((shortcut) => shortcut.id));
    const savedViewIds = new Set(reportSavedViewProfiles.map((view) => view.id));
    const reportSuiteIds = new Set(reportSuiteProfiles.map((suite) => suite.id));
    const productDepthSubgoals = reportProductDepthAreas.flatMap((area) =>
      area.subgoals.map((subgoal) => ({ area, subgoal }))
    );

    expect(reportProductDepthAreas.map((area) => area.id)).toEqual([
      "report-discovery",
      "role-workflows",
      "report-automation",
      "advisory-management",
      "accounting-data-depth",
    ]);
    expect(productDepthSubgoals).toHaveLength(19);
    expect(new Set(productDepthSubgoals.map(({ subgoal }) => subgoal.id)).size).toBe(
      productDepthSubgoals.length
    );
    expect(productDepthSubgoals.map(({ subgoal }) => subgoal.id)).toEqual(
      expect.arrayContaining([
        "unified-report-center",
        "search-pins-recommendations",
        "guided-business-questions",
        "source-drilldowns",
        "owner-operating-rhythm",
        "freelancer-operating-rhythm",
        "accountant-operating-rhythm",
        "defaults-handoff-polish",
        "next-best-actions",
        "task-reminder-delivery-controls",
        "automation-impact-health",
        "ai-narrative-pack-summaries",
        "custom-kpis-dashboard-widgets",
        "dimensional-reporting",
        "accountant-bulk-generation",
        "historical-snapshots",
        "statutory-consolidation-controls",
        "margin-cogs-allocation",
        "settlement-headcount-depth",
      ])
    );

    for (const area of reportProductDepthAreas) {
      expect(["working", "hardening", "data-needed"]).toContain(area.status);
      expect(area.objective).toBeTruthy();
      expect(area.commandKeywords).toBeTruthy();
      expect(area.subgoals.length).toBeGreaterThanOrEqual(3);
      expect(reportProductDepthAreaHref(area)).toContain(`#report-product-depth-${area.id}`);

      for (const subgoal of area.subgoals) {
        expect(["working", "hardening", "data-needed"]).toContain(subgoal.status);
        expect(subgoal.title).toBeTruthy();
        expect(subgoal.outcome).toBeTruthy();
        expect(subgoal.evidence).toBeTruthy();
        expect(subgoal.nextAction).toBeTruthy();
        expect(subgoal.workflowSearch).toBeTruthy();
        expect(subgoal.personas.length).toBeGreaterThanOrEqual(1);
        expect(subgoal.reportIds.length).toBeGreaterThanOrEqual(1);
        expect(reportProductDepthSubgoalHref(area, subgoal)).toContain(`productDepth=${area.id}`);
        expect(reportProductDepthSubgoalHref(area, subgoal)).toContain(
          `#report-product-depth-subgoal-${subgoal.id}`
        );
        if (subgoal.status === "data-needed") {
          expect(subgoal.dataDependency).toBeTruthy();
        }
        if (area.id === "accounting-data-depth") {
          expect(subgoal.evidenceCheckpoints).toHaveLength(3);
          expect(subgoal.requiredSourceRecords).toHaveLength(3);
          expect(subgoal.evidenceCheckpoints?.map((checkpoint) => checkpoint.status)).toEqual([
            "current-proxy",
            "missing-source",
            "guardrail",
          ]);
          for (const checkpoint of subgoal.evidenceCheckpoints ?? []) {
            expect(checkpoint.id).toBeTruthy();
            expect(checkpoint.label).toBeTruthy();
            expect(checkpoint.detail).toBeTruthy();
          }
          for (const record of subgoal.requiredSourceRecords ?? []) {
            expect(record.id).toBeTruthy();
            expect(record.label).toBeTruthy();
            expect(record.systemOfRecord).toBeTruthy();
            expect(record.unlocks).toBeTruthy();
          }
        }
        if (subgoal.id === "source-drilldowns") {
          expect(subgoal.sourceDrilldownTargets).toHaveLength(4);
          for (const target of subgoal.sourceDrilldownTargets ?? []) {
            expect(target.id).toBeTruthy();
            expect(target.title).toBeTruthy();
            expect(target.href.startsWith("/")).toBe(true);
            expect(target.personas.length).toBeGreaterThanOrEqual(1);
            expect(target.reportIds.length).toBeGreaterThanOrEqual(1);
            expect(target.sourceEntities.length).toBeGreaterThanOrEqual(1);
            expect(target.availableEvidence).toBeTruthy();
            expect(target.universalLinkGap).toBeTruthy();

            for (const persona of target.personas) {
              expect(subgoal.personas).toContain(persona);
            }

            for (const reportId of target.reportIds) {
              const report = reportCatalog.find((item) => item.id === reportId);
              expect(subgoal.reportIds).toContain(reportId);
              expect(allReportIds.has(reportId)).toBe(true);
              expect(report?.personas.some((persona) => target.personas.includes(persona))).toBe(
                true
              );
            }
          }
        }

        for (const persona of subgoal.personas) {
          expect(reportPersonas).toContain(persona);
        }

        for (const reportId of subgoal.reportIds) {
          const report = reportCatalog.find((item) => item.id === reportId);
          expect(allReportIds.has(reportId)).toBe(true);
          expect(report?.personas.some((persona) => subgoal.personas.includes(persona))).toBe(true);
        }

        for (const presetId of subgoal.comparisonPresetIds) {
          const preset = reportComparisonPresets.find((item) => item.id === presetId);
          expect(comparisonPresetIds.has(presetId)).toBe(true);
          expect(preset && subgoal.personas.includes(preset.persona)).toBe(true);
        }

        for (const starterId of subgoal.automationStarterIds) {
          const starter = reportAutomationStarters.find((item) => item.id === starterId);
          expect(automationStarterIds.has(starterId)).toBe(true);
          expect(starter && subgoal.personas.includes(starter.persona)).toBe(true);
        }

        for (const ruleId of subgoal.triggerRuleIds) {
          const rule = reportAutomationTriggerRules.find((item) => item.id === ruleId);
          expect(triggerRuleIds.has(ruleId)).toBe(true);
          expect(rule && subgoal.personas.includes(rule.persona)).toBe(true);
        }

        for (const subscriptionId of subgoal.deliverySubscriptionIds) {
          const subscription = reportDeliverySubscriptions.find(
            (item) => item.id === subscriptionId
          );
          expect(deliverySubscriptionIds.has(subscriptionId)).toBe(true);
          expect(subscription && subgoal.personas.includes(subscription.persona)).toBe(true);
        }

        for (const shortcutId of subgoal.decisionShortcutIds) {
          const shortcut = reportDecisionShortcuts.find((item) => item.id === shortcutId);
          expect(decisionShortcutIds.has(shortcutId)).toBe(true);
          expect(shortcut && subgoal.personas.includes(shortcut.persona)).toBe(true);
        }

        for (const viewId of subgoal.savedViewIds) {
          const view = reportSavedViewProfiles.find((item) => item.id === viewId);
          expect(savedViewIds.has(viewId)).toBe(true);
          expect(view && subgoal.personas.includes(view.persona)).toBe(true);
        }

        for (const suiteId of subgoal.reportSuiteIds) {
          const suite = reportSuiteProfiles.find((item) => item.id === suiteId);
          expect(reportSuiteIds.has(suiteId)).toBe(true);
          expect(suite && subgoal.personas.includes(suite.persona)).toBe(true);
        }
      }
    }

    for (const workspace of reportPersonaWorkspaces) {
      const personaReportIds = reportCatalog
        .filter((report) => report.personas.includes(workspace.persona))
        .map((report) => report.id);
      const livePersonaReportIds = reportCatalog
        .filter((report) => report.status === "live" && report.personas.includes(workspace.persona))
        .map((report) => report.id);
      const packReportIds = new Set(
        reportPackTemplates
          .filter((template) => template.persona === workspace.persona)
          .flatMap((template) => template.reportIds)
      );
      const deliveryReportIds = new Set(
        reportDeliverySubscriptions
          .filter((subscription) => subscription.persona === workspace.persona)
          .flatMap((subscription) => subscription.reportIds)
      );
      const automationStarterReportIds = new Set(
        reportAutomationStarters
          .filter((starter) => starter.persona === workspace.persona)
          .flatMap((starter) => starter.reportIds)
      );
      const automationRuleReportIds = new Set(
        reportAutomationTriggerRules
          .filter((rule) => rule.persona === workspace.persona)
          .flatMap((rule) => rule.reportIds)
      );
      const automationImpactReportIds = new Set(
        reportAutomationImpactProfiles
          .filter((profile) => profile.persona === workspace.persona)
          .flatMap((profile) => profile.reportIds)
      );

      expect(livePersonaReportIds.every((reportId) => packReportIds.has(reportId))).toBe(true);
      expect(livePersonaReportIds.every((reportId) => deliveryReportIds.has(reportId))).toBe(true);
      expect(personaReportIds.every((reportId) => automationStarterReportIds.has(reportId))).toBe(
        true
      );
      expect(personaReportIds.every((reportId) => automationRuleReportIds.has(reportId))).toBe(
        true
      );
      expect(personaReportIds.every((reportId) => automationImpactReportIds.has(reportId))).toBe(
        true
      );
    }

    for (const preset of reportComparisonPresets) {
      expect(reportPersonas).toContain(preset.persona);
      expect(reportTabs).toContain(preset.primaryTab);
      expect(reportComparisonPresetHref(preset)).toBe(
        `/reports?tab=${preset.primaryTab}&persona=${preset.persona}#period-comparison-title`
      );
      expect(preset.reportIds.length).toBeGreaterThanOrEqual(3);
      expect(preset.metricIds.length).toBeGreaterThanOrEqual(3);
      expect(preset.question).toMatch(/\?$/);
      expect(preset.baseline).toBeTruthy();
      expect(preset.automationTrigger).toBeTruthy();

      for (const reportId of preset.reportIds) {
        const report = reportCatalog.find((item) => item.id === reportId);
        expect(allReportIds.has(reportId)).toBe(true);
        expect(report?.personas).toContain(preset.persona);
      }

      for (const metricId of preset.metricIds) {
        expect(comparisonMetricIds.has(metricId)).toBe(true);
      }
    }

    expect(
      reportComparisonPresets.find(
        (preset) => preset.id === "owner-operations-payroll-assets-movement"
      )?.reportIds
    ).toEqual(
      expect.arrayContaining([
        "vendor-balances",
        "ap-aging",
        "inventory-movement",
        "fixed-asset-register",
        "payroll-summary",
        "expense-claims",
      ])
    );
    expect(
      reportComparisonPresets.find(
        (preset) => preset.id === "freelancer-tax-payables-assets-movement"
      )?.reportIds
    ).toEqual(
      expect.arrayContaining([
        "vat-return",
        "corporate-tax-estimate",
        "vendor-balances",
        "ap-aging",
        "fixed-asset-register",
        "depreciation-schedule",
        "expense-claims",
      ])
    );
    expect(
      reportComparisonPresets.find((preset) => preset.id === "accountant-tax-payables-asset-review")
        ?.reportIds
    ).toEqual(
      expect.arrayContaining([
        "vat-return",
        "corporate-tax-estimate",
        "vendor-balances",
        "ap-aging",
        "fixed-asset-register",
        "depreciation-schedule",
        "expense-claims",
        "payroll-summary",
      ])
    );

    for (const workspace of reportPersonaWorkspaces) {
      const personaReportIds = reportCatalog
        .filter((report) => report.personas.includes(workspace.persona))
        .map((report) => report.id);
      const comparisonReportIds = new Set(
        reportComparisonPresets
          .filter((preset) => preset.persona === workspace.persona)
          .flatMap((preset) => preset.reportIds)
      );

      expect(personaReportIds.every((reportId) => comparisonReportIds.has(reportId))).toBe(true);
    }
  });

  it("keeps persona automation playbooks tied to real reports and workflows", () => {
    expect(reportsSource).toContain("Automation playbooks");
    expect(reportsSource).toContain("Report automation rules");
    expect(reportsSource).toContain("reportAutomationRules");
    expect(reportsSource).toContain("visibleReportAutomationRules");
    expect(reportsSource).toContain("automation-rule-${rule.id}");
    expect(reportsSource).toContain("Review before auto-send");
    expect(reportsSource).toContain("Ready to auto-send");
    expect(reportsSource).toContain("Automation runbook");
    expect(reportsSource).toContain("runbookSteps");
    expect(reportsSource).toContain("buildReportAutomationRunbookSteps(workspace, playbook)");
    expect(reportsSource).toContain("automation-rule-runbook-${rule.id}-${step.phase}");
    expect(reportsSource).toContain("workspace.automations.length");
    expect(reportsSource).toContain("setupChecklist");
    expect(reportsSource).toContain("report-role-setup-title");
    expect(reportsSource).toContain("report-role-setup-${workspace.persona}");
    expect(reportsSource).toContain("report-role-setup-step-${step.id}");
    expect(reportsSource).toContain("Role workflow checklist");
    expect(reportsSource).toContain("workflowSteps");
    expect(reportsSource).toContain("workflowStepCount");
    expect(reportsSource).toContain("reportRoleWorkflowStepHref(workspace, step)");
    expect(reportsSource).toContain('data-testid="report-role-workflows"');
    expect(reportsSource).toContain("report-role-workflows-${workspace.persona}");
    expect(reportsSource).toContain("report-role-workflow-step-${step.id}");
    expect(reportsSource).toContain("report-role-workflow-defaults-${step.id}");
    expect(reportsSource).toContain("step.defaultViewHref");
    expect(reportsSource).toContain("step.handoffGuardrail");
    expect(reportsSource).toContain("step.handoffRecipients");
    expect(reportsSource).toContain("reportAutomationPlaybookHref(playbook, workspace.persona)");
    expect(commandSource).toContain("commandReportWorkspaces.flatMap");
    expect(commandSource).toContain("id: `report-automation-${playbook.id}`");
    expect(commandSource).toContain("label: `${playbook.title} - ${workspace.title}`");
    expect(commandSource).toContain(
      "href: playbook.href ?? reportAutomationPlaybookHref(playbook, workspace.persona)"
    );
    expect(commandSource).toContain("automation playbook report pack");

    const allReportIds = new Set(reportCatalog.map((report) => report.id));
    const liveReportIds = new Set(liveReportCatalog.map((report) => report.id));

    for (const workspace of reportPersonaWorkspaces) {
      expect(workspace.setupChecklist).toHaveLength(4);
      expect(workspace.workflowSteps).toHaveLength(4);
      expect(workspace.automations).toHaveLength(3);
      const workflowStepIds = new Set<string>();

      for (const step of workspace.setupChecklist) {
        expect(reportSectionHref(workspace, step.section)).toContain("#");
        expect(step.reportIds.length).toBeGreaterThanOrEqual(3);
        expect(["review", "comparison", "queue"]).toContain(step.command);

        for (const reportId of step.reportIds) {
          expect(allReportIds.has(reportId)).toBe(true);
          expect(reportCatalog.find((report) => report.id === reportId)?.personas).toContain(
            workspace.persona
          );
        }
      }

      for (const step of workspace.workflowSteps) {
        expect(step.id).toContain(workspace.persona);
        expect(workflowStepIds.has(step.id)).toBe(false);
        workflowStepIds.add(step.id);
        expect(reportRoleWorkflowStepHref(workspace, step)).toBe(
          `${reportWorkspaceHref(workspace)}#report-role-workflow-step-${step.id}`
        );
        expect(reportSectionHref(workspace, step.section)).toContain("#");
        expect(step.primaryAction).toBeTruthy();
        expect(step.cadence).toBeTruthy();
        expect(step.commandKeywords).toContain(workspace.persona);
        expect(step.reportIds.length).toBeGreaterThanOrEqual(5);

        for (const reportId of step.reportIds) {
          expect(allReportIds.has(reportId)).toBe(true);
          expect(reportCatalog.find((report) => report.id === reportId)?.personas).toContain(
            workspace.persona
          );
        }

        const comparisonPreset = reportComparisonPresets.find(
          (preset) => preset.id === step.comparisonPresetId
        );
        const automationStarter = reportAutomationStarters.find(
          (starter) => starter.id === step.automationStarterId
        );
        const deliverySubscription = reportDeliverySubscriptions.find(
          (subscription) => subscription.id === step.deliverySubscriptionId
        );
        const decisionShortcut = reportDecisionShortcuts.find(
          (shortcut) => shortcut.id === step.decisionShortcutId
        );
        const savedView = reportSavedViewProfiles.find((view) => view.id === step.savedViewId);
        const reportSuite = reportSuiteProfiles.find((suite) => suite.id === step.reportSuiteId);

        expect(comparisonPreset?.persona).toBe(workspace.persona);
        expect(automationStarter?.persona).toBe(workspace.persona);
        expect(deliverySubscription?.persona).toBe(workspace.persona);
        expect(decisionShortcut?.persona).toBe(workspace.persona);
        expect(savedView?.persona).toBe(workspace.persona);
        expect(reportSuite?.persona).toBe(workspace.persona);
        expect(reportSuite?.savedViewIds).toContain(step.savedViewId);
        expect(reportSuite?.deliverySubscriptionId).toBe(step.deliverySubscriptionId);
      }

      for (const playbook of workspace.automations) {
        expect(playbook.id).toContain(workspace.persona);
        expect(playbook.reportIds.length).toBeGreaterThanOrEqual(3);
        expect(reportAutomationPlaybookHref(playbook, workspace.persona)).toBeTruthy();
        expect(playbook.href || playbook.tab).toBeTruthy();
        expect(commandSource).toContain("playbook.reportIds.join");
        const runbookSteps = buildReportAutomationRunbookSteps(workspace, playbook);
        expect(runbookSteps).toHaveLength(3);
        expect(runbookSteps.map((step) => step.phase)).toEqual(["signal", "review", "deliver"]);

        for (const reportId of playbook.reportIds) {
          expect(allReportIds.has(reportId)).toBe(true);
        }

        for (const step of runbookSteps) {
          expect(step.id).toContain(playbook.id);
          expect(step.title).toBeTruthy();
          expect(step.outcome).toBeTruthy();
          expect(step.actionLabel).toBeTruthy();
          expect(step.href).toContain("/reports");
          expect(step.reportIds.length).toBeGreaterThanOrEqual(playbook.reportIds.length);
          expect(step.triggerRuleIds.length).toBeGreaterThan(0);
          expect(step.workflowStepIds.length).toBeGreaterThan(0);
          expect(step.comparisonPresetIds.length).toBeGreaterThan(0);
          expect(step.automationStarterIds.length).toBe(1);
          expect(step.deliverySubscriptionIds.length).toBeGreaterThan(0);
          expect(step.decisionShortcutIds.length).toBeGreaterThan(0);
          expect(step.savedViewIds.length).toBeGreaterThan(0);
          expect(step.reportSuiteIds.length).toBeGreaterThan(0);

          for (const reportId of step.reportIds) {
            expect(allReportIds.has(reportId)).toBe(true);
            expect(reportCatalog.find((report) => report.id === reportId)?.personas).toContain(
              workspace.persona
            );
          }
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
    const ownerSpendPlaybook = reportPersonaWorkspaces
      .find((workspace) => workspace.persona === "owner")
      ?.automations.find((playbook) => playbook.id === "owner-spend-guardrails");

    expect(ownerTaxPlaybook?.reportIds).toContain("corporate-tax-estimate");
    expect(ownerTaxPlaybook?.tab).toBe("tax");
    expect(accountantTaxPlaybook?.reportIds).toContain("corporate-tax-estimate");
    expect(accountantTaxPlaybook?.reportIds).toContain("expense-claims");
    expect(accountantTaxPlaybook?.tab).toBe("tax");
    expect(ownerSpendPlaybook?.reportIds).toContain("expense-claims");
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
    expect(accountantClosePlaybook?.reportIds).toContain("inventory-movement");
    expect(accountantClosePlaybook?.reportIds).toContain("fixed-asset-register");
    expect(accountantClosePlaybook?.reportIds).toContain("payroll-summary");
    expect(accountantClosePlaybook?.reportIds).toContain("wps-sif-summary");
    expect(accountantClosePlaybook?.tab).toBe("close");
    expect(ownerCollectionsPlaybook?.reportIds).toContain("sales-product-service");
    expect(ownerSpendPlaybook?.reportIds).toContain("inventory-movement");
    expect(ownerSpendPlaybook?.reportIds).toContain("payroll-summary");
    expect(ownerSpendPlaybook?.reportIds).toContain("wps-sif-summary");
    expect(accountantAdvisoryPlaybook?.reportIds).toContain("sales-product-service");
  });

  it("offers persona report packs with an index and automation workbook", () => {
    expect(reportsSource).toContain("buildWorkspaceReportPack");
    expect(reportsSource).toContain("handleExportWorkspacePack");
    expect(reportsSource).toContain("handleExportWorkspacePackToSheets");
    expect(reportsSource).toContain("Pack Index");
    expect(reportsSource).toContain("Pack Summary");
    expect(reportsSource).toContain("Pack automation outcome");
    expect(reportsSource).toContain("Coverage Map");
    expect(reportsSource).toContain("Coverage categories");
    expect(reportsSource).toContain("Workbook Sheets");
    expect(reportsSource).toContain("prepareCashFlowStatementForExport");
    expect(reportsSource).toContain("prepareAgingReportsForExport");
    expect(reportsSource).toContain("preparePeriodComparisonForExport");
    expect(reportsSource).toContain("prepareCostCenterProfitabilityForExport");
    expect(reportsSource).toContain("prepareFxGainsLossesForExport");
    expect(reportsSource).toContain("prepareVat201ForExport");
    expect(reportsSource).toContain("Decision Question");
    expect(reportsSource).toContain("Decision Questions");
    expect(reportsSource).toContain("decisionQuestion: report.decisionQuestion");
    expect(reportsSource).toContain("Pack Templates");
    expect(reportsSource).toContain("Pack templates");
    expect(reportsSource).toContain("Decision Shortcuts");
    expect(reportsSource).toContain("Decision shortcuts");
    expect(reportsSource).toContain("decisionShortcutsSheet");
    expect(reportsSource).toContain("packDecisionShortcuts");
    expect(reportsSource).toContain("Trigger Rules");
    expect(reportsSource).toContain("Trigger rules");
    expect(reportsSource).toContain("triggerRulesSheet");
    expect(reportsSource).toContain("packTriggerRules");
    expect(reportsSource).toContain("Delivery Subscriptions");
    expect(reportsSource).toContain("Delivery subscriptions");
    expect(reportsSource).toContain("deliverySubscriptionsSheet");
    expect(reportsSource).toContain("packDeliverySubscriptions");
    expect(reportsSource).toContain("Automation Starters");
    expect(reportsSource).toContain("Automation starters");
    expect(reportsSource).toContain("automationStartersSheet");
    expect(reportsSource).toContain("packAutomationStarters");
    expect(reportsSource).toContain("Comparison Focus");
    expect(reportsSource).toContain("Automation Trigger");
    expect(reportsSource).toContain("Recommended Actions");
    expect(reportsSource).toContain("Report Roadmap");
    expect(reportsSource).toContain("Automation Command Center");
    expect(reportsSource).toContain("Operations Control");
    expect(reportsSource).toContain("Accountant Handoff");
    expect(reportsSource).toContain("accountantHandoff");
    expect(reportsSource).toContain("packHandoff");
    expect(reportsSource).toContain("packPriorityGap");
    expect(reportsSource).toContain("packSharedContextHref");
    expect(reportsSource).toContain("packGapHref");
    expect(reportsSource).toContain("Shared Context");
    expect(reportsSource).toContain("Gap Workflow");
    expect(reportsSource).toContain("Next Action Workflow");
    expect(reportsSource).toContain("Quick access reports");
    expect(reportsSource).toContain("Report suites");
    expect(reportsSource).toContain("reportSuiteProfiles");
    expect(reportsSource).toContain("reportSuiteSummaries");
    expect(reportsSource).toContain("visibleReportSuiteSummaries");
    expect(reportsSource).toContain("reportSuiteHref(suite)");
    expect(reportsSource).toContain("Management pack briefs");
    expect(reportsSource).toContain("reportManagementBriefProfiles");
    expect(reportsSource).toContain("reportManagementBriefSummaries");
    expect(reportsSource).toContain("visibleReportManagementBriefSummaries");
    expect(reportsSource).toContain("reportManagementBriefHref(brief)");
    expect(reportsSource).toContain('data-testid="report-management-briefs"');
    expect(reportsSource).toContain("report-management-brief-${brief.id}");
    expect(reportsSource).toContain("KPI widgets");
    expect(reportsSource).toContain("brief.kpiWidgets.map");
    expect(reportsSource).toContain("report-management-brief-kpi-${widget.id}");
    expect(reportsSource).toContain("report-management-brief-narrative-${section.id}");
    expect(reportsSource).toContain("report-management-brief-dimension-${dimension.id}");
    expect(reportsSource).toContain("report-management-brief-batch-${brief.id}");
    expect(reportsSource).toContain('type: "Brief"');
    expect(reportsSource).toContain("management-brief-${brief.id}");
    expect(reportsSource).toContain("suite.deliverySubscription.channel");
    expect(reportsSource).toContain("suite.triggerRules.length");
    expect(reportsSource).toContain("suite.deliveryHref");
    expect(reportsSource).toContain("suite.deliverySubscriptionId");
    expect(reportsSource).toContain("suiteDeliverySubscription");
    expect(reportsSource).toContain("suiteRequiresHandoffAcknowledgement");
    expect(reportsSource).toContain("report-suite-delivery-readiness-${suite.id}");
    expect(reportsSource).toContain("report-suite-queue-delivery-${suite.id}");
    expect(reportsSource).toContain("subscription.reportSuites[0]?.title");
    expect(reportsSource).toContain("subscription.preview.suiteTitles");
    expect(reportsSource).toContain("report-delivery-preview-suites-${subscription.id}");
    expect(reportsSource).toContain("Open suite");
    expect(reportsSource).toContain('data-testid="report-suites"');
    expect(reportsSource).toContain("report-suite-${suite.id}");
    expect(reportsSource).toContain("reportQuickAccessProfiles");
    expect(reportsSource).toContain("reportQuickAccessSummaries");
    expect(reportsSource).toContain("reportActionContextByPersonaReportId");
    expect(reportsSource).toContain("reportCatalogDiscoveryQuery.data?.reportActionContexts");
    expect(reportsSource).toContain("`${shortcut.persona}:${primaryReport.id}`");
    expect(reportsSource).toContain("context?.reportHref");
    expect(reportsSource).toContain("context?.workflowHref");
    expect(reportsSource).toContain("workflowHref:");
    expect(reportsSource).toContain("reportPersonaHref(report, profile.persona)");
    expect(reportsSource).toContain("reportPersonaHref(report, view.persona)");
    expect(reportsSource).toContain("reportPersonaHref(primaryReport, shortcut.persona)");
    expect(reportsSource).toContain("search: shortcut.question");
    expect(reportsSource).toContain("report-saved-view-automation-${view.id}");
    expect(reportsSource).toContain("visibleReportQuickAccessSummaries");
    expect(reportsSource).toContain("profile.primaryReports");
    expect(reportsSource).toContain("profile.additionalReports");
    expect(reportsSource).toContain("Report automation operations");
    expect(reportsSource).toContain("Automation impact");
    expect(reportsSource).toContain("reportAutomationImpactProfiles");
    expect(reportsSource).toContain("calculateReportAutomationImpact");
    expect(reportsSource).toContain("reportAutomationImpactSummaries");
    expect(reportsSource).toContain("visibleReportAutomationImpactSummaries");
    expect(reportsSource).toContain("reportAutomationImpactTotals");
    expect(reportsSource).toContain("Outcome signals");
    expect(reportsSource).toContain("report-automation-outcome-signal-${signal.id}");
    expect(reportsSource).toContain("signal.currentProxy");
    expect(reportsSource).toContain("signal.missingCounter");
    expect(reportsSource).toContain("signal.guardrail");
    expect(reportsSource).toContain("fetchReportCatalogDiscovery");
    expect(reportsSource).toContain(
      "reportCatalogDiscoveryQueryKey(reportCatalogDiscoveryPersona)"
    );
    expect(reportsSource).toContain("type ReportCatalogDiscovery");
    expect(reportsSource).toContain("reportCatalogDiscoveryQuery");
    expect(reportsSource).toContain("syncedReportCatalogSummary");
    expect(reportsSource).toContain("syncedReportPersonaSummaries");
    expect(reportsSource).toContain("reportWorkflowSearch");
    expect(reportsSource).toContain("reportWorkflowGapFilter");
    expect(reportsSource).toContain("getPreferredReportWorkflowGapFilter");
    expect(reportsSource).toContain("setPreferredReportWorkflowGapFilter");
    expect(reportsSource).toContain("clearPreferredReportWorkflowGapFilter");
    expect(reportsSource).toContain("normalizedReportWorkflowSearch");
    expect(reportsSource).toContain("matchesReportWorkflowSearch");
    expect(reportsSource).toContain("ReportWorkflowFinderGapFilter");
    expect(reportsSource).toContain("ReportWorkflowGapFilterState");
    expect(reportsSource).toContain("reportWorkflowGapFilterLabels");
    expect(reportsSource).toContain("reportWorkflowContextHref");
    expect(reportsSource).toContain("reportWorkflowContextSearchLabel");
    expect(reportsSource).toContain("reportWorkflowContextSharePersona");
    expect(reportsSource).toContain("reportWorkflowContextShareHref");
    expect(reportsSource).toContain("reportAccountantHandoffSummaries");
    expect(reportsSource).toContain("reportDeliveryHandoffPreviewByPersona");
    expect(reportsSource).toContain("acknowledgedReportDeliveryHandoffGaps");
    expect(reportsSource).toContain("reportDeliverySubscriptionHasReviewHandoff");
    expect(reportsSource).toContain("isReportDeliveryHandoffAcknowledged");
    expect(reportsSource).toContain("queueReportDeliverySubscriptionWithHandoffGuard");
    expect(reportsSource).toContain("commandQueueSubscriptionRequiresHandoffAcknowledgement");
    expect(reportsSource).toContain("priorityGapLabel");
    expect(reportsSource).toContain("shareHref");
    expect(reportsSource).toContain("gapHref");
    expect(reportsSource).toContain("hasReportWorkflowContextFilters");
    expect(reportsSource).toContain("resetReportWorkflowContext");
    expect(reportsSource).toContain("matchesReportWorkflowGapFilter");
    expect(reportsSource).toContain("ReportWorkflowCoverageCue");
    expect(reportsSource).toContain("ReportWorkflowCoverageContext");
    expect(reportsSource).toContain("buildReportWorkflowCoverageCues");
    expect(reportsSource).toContain("reportIdsOverlap");
    expect(reportsSource).toContain("allReportWorkflowFinderResults");
    expect(reportsSource).toContain("filteredReportWorkflowFinderResults");
    expect(reportsSource).toContain("activeReportWorkflowGapFilterLabel");
    expect(reportsSource).toContain("reportWorkflowFinderResults");
    expect(reportsSource).toContain("coverageCues: buildReportWorkflowCoverageCues");
    expect(reportsSource).toContain('id: "pack"');
    expect(reportsSource).toContain('id: "schedule"');
    expect(reportsSource).toContain('id: "alert"');
    expect(reportsSource).toContain('id: "delivery"');
    expect(reportsSource).toContain('label: packTemplate ? "Pack" : "No pack"');
    expect(reportsSource).toContain('label: deliverySubscription ? "Scheduled" : "No schedule"');
    expect(reportsSource).toContain('label: triggerRule ? "Alert rule" : "No alert"');
    expect(reportsSource).toContain('label: deliverySubscription ? "Delivery" : "No delivery"');
    expect(reportsSource).toContain('data-testid="report-workflow-finder"');
    expect(reportsSource).toContain('data-testid="reports-workflow-context-summary"');
    expect(reportsSource).toContain('data-testid="reports-workflow-context-role"');
    expect(reportsSource).toContain('data-testid="reports-workflow-context-search"');
    expect(reportsSource).toContain('data-testid="reports-workflow-context-gap"');
    expect(reportsSource).toContain('data-testid="button-open-report-workflow-context-link"');
    expect(reportsSource).toContain('data-testid="button-reset-report-workflow-context"');
    expect(reportsSource).toContain('data-testid="report-quick-access"');
    expect(reportsSource).toContain("report-quick-access-${profile.persona}");
    expect(reportsSource).toContain("report-quick-access-report-${report.id}");
    expect(reportsSource).toContain("report-quick-access-report-automation-${report.id}");
    expect(reportsSource).toContain("report-quick-access-report-comparison-${report.id}");
    expect(reportsSource).toContain("report-quick-access-report-delivery-${report.id}");
    expect(reportsSource).toContain("report-quick-access-more-${profile.persona}");
    expect(reportsSource).toContain("report-quick-access-title");
    expect(reportsSource).toContain("Autopilot");
    expect(reportsSource).toContain('data-testid="report-accountant-handoff"');
    expect(reportsSource).toContain("report-accountant-handoff-${item.workspace.persona}");
    expect(reportsSource).toContain("report-accountant-handoff-share-${item.workspace.persona}");
    expect(reportsSource).toContain("report-accountant-handoff-gap-${item.workspace.persona}");
    expect(reportsSource).toContain("report-accountant-handoff-action-${item.workspace.persona}");
    expect(reportsSource).toContain("Accountant handoff");
    expect(reportsSource).toContain("Open shared view");
    expect(reportsSource).toContain('id="report-workflow-finder"');
    expect(reportsSource).toContain('data-testid="report-workflow-active-gap-filter"');
    expect(reportsSource).toContain('data-testid="button-clear-report-workflow-gap-filter"');
    expect(reportsSource).toContain('data-testid="input-report-workflow-search"');
    expect(reportsSource).toContain('data-testid="report-workflow-finder-count"');
    expect(reportsSource).toContain("data-testid={`report-workflow-finder-result-${result.id}`}");
    expect(reportsSource).toContain(
      "data-testid={`report-workflow-finder-result-open-${result.id}`}"
    );
    expect(reportsSource).toContain("const reportActionLinks: ReportWorkflowFinderAction[]");
    expect(reportsSource).toContain(
      "testId: `report-workflow-finder-result-automation-${report.id}`"
    );
    expect(reportsSource).toContain("context?.comparisonPresets[0]");
    expect(reportsSource).toContain(
      "testId: `report-workflow-finder-result-comparison-${report.id}`"
    );
    expect(reportsSource).toContain("context?.deliverySubscriptions[0]");
    expect(reportsSource).toContain(
      "testId: `report-workflow-finder-result-delivery-${report.id}`"
    );
    expect(reportsSource).toContain("result.actionLinks?.map((action)");
    expect(reportsSource).toContain("data-testid={`report-workflow-coverage-${result.id}`}");
    expect(reportsSource).toContain(
      "data-testid={`report-workflow-coverage-${result.id}-${cue.id}`}"
    );
    expect(reportsSource).toContain('data-testid="report-workflow-finder-empty"');
    expect(reportsSource).toContain("Search reports, packs, comparisons, automations");
    expect(reportsSource).toContain("visibleReportSuiteSummaries.map((suite) => ({");
    expect(reportsSource).toContain("visibleReportPackTemplates.map((template) => ({");
    expect(reportsSource).toContain("visibleReportComparisonPresets.map((preset) => ({");
    expect(reportsSource).toContain("visibleReportAutomationStarters.map((starter) => ({");
    expect(reportsSource).toContain("visibleReportDeliverySubscriptions.map((subscription) => ({");
    expect(reportsSource).toContain("visibleReportAutomationTriggerRules.map((rule) => ({");
    expect(reportsSource).toContain("visibleReportDecisionShortcuts.map((shortcut) => ({");
    expect(reportsSource).toContain('data-testid="reports-catalog-discovery-summary"');
    expect(reportsSource).toContain('data-testid="reports-catalog-discovery-status"');
    expect(reportsSource).toContain("reports-catalog-persona-summary-${workspace.persona}");
    expect(reportsSource).toContain("visibleWorkspaceSummaries");
    expect(reportsSource).toContain("setupStepCount");
    expect(reportsSource).toContain("Role setup paths");
    expect(reportsSource).toContain("catalogReportCount");
    expect(reportsSource).toContain("packTemplateCount");
    expect(reportsSource).toContain("comparisonPresetCount");
    expect(reportsSource).toContain("automationStarterCount");
    expect(reportsSource).toContain("report-workspace-catalog-metadata-${workspace.persona}");
    expect(reportsSource).toContain("Automation Health");
    expect(reportsSource).toContain("Automation Health Trend");
    expect(reportsSource).toContain("Delivery Checklist");
    expect(reportsSource).toContain("Report pack readiness");
    expect(reportsSource).toContain("Comparison Snapshot");
    expect(reportsSource).toContain("Comparison Presets");
    expect(reportsSource).toContain("comparisonPresetsSheet");
    expect(reportsSource).toContain("Pack Cadence");
    expect(reportsSource).toContain("Pack Automation Status");
    expect(reportsSource).toContain("Automation Playbooks");
    expect(reportsSource).toContain("value: workspace.automationOutcome");
    expect(reportsSource).toContain("comparisonCurrentLabel");
    expect(reportsSource).toContain("comparisonPreviousLabel");
    expect(reportsSource).toContain("packComparisonRows");
    expect(reportsSource).toContain("packComparisonPresets");
    expect(reportsSource).toContain("reportComparisonPresetSummaries");
    expect(reportsSource).toContain("packRecommendations");
    expect(reportsSource).toContain("operationsControl");
    expect(reportsSource).toContain("packOperations");
    expect(reportsSource).toContain("Operations status");
    expect(reportsSource).toContain("Operations next action");
    expect(reportsSource).toContain("Failed delivery runs");
    expect(reportsSource).toContain("packCoverageMap");
    expect(reportsSource).toContain("packTemplates");
    expect(reportsSource).toContain("reportPackTemplateSummaries");
    expect(reportsSource).toContain("buildReportCoverageMap(workspace.reports, workbookReportIds)");
    expect(reportsSource).toContain("Recommended actions");
    expect(reportsSource).toContain("Auto-send coverage");
    expect(reportsSource).toContain("Ready auto-send rules");
    expect(reportsSource).toContain("Rules needing review");
    expect(reportsSource).toContain("Setup-needed rules");
    expect(reportsSource).toContain("Setup Steps");
    expect(reportsSource).toContain("Primary Action");
    expect(reportsSource).toContain("Delivery Guardrail");
    expect(reportsSource).toContain("deliveryGuardrail");
    expect(reportsSource).toContain("reportDeliverySubscriptionSummaries");
    expect(reportsSource).toContain("visibleReportDeliverySubscriptions");
    expect(reportsSource).toContain("reportAutomationOperationSummaries");
    expect(reportsSource).toContain("visibleReportAutomationOperations");
    expect(reportsSource).toContain("reportGapCount");
    expect(reportsSource).toContain("automationRuleGapCount");
    expect(reportsSource).toContain("deliveryGapCount");
    expect(reportsSource).toContain("applyReportWorkflowGapFilter");
    expect(reportsSource).toContain("clearReportWorkflowGapFilter");
    expect(reportsSource).toContain('data-testid="report-workflow-readiness"');
    expect(reportsSource).toContain("report-workflow-readiness-${item.workspace.persona}");
    expect(reportsSource).toContain("report-workflow-readiness-gap-${item.workspace.persona}");
    expect(reportsSource).toContain("report-workflow-readiness-filters-${item.workspace.persona}");
    expect(reportsSource).toContain("report-workflow-filter-report-gaps-${item.workspace.persona}");
    expect(reportsSource).toContain("report-workflow-filter-rule-gaps-${item.workspace.persona}");
    expect(reportsSource).toContain(
      "report-workflow-filter-delivery-gaps-${item.workspace.persona}"
    );
    expect(reportsSource).toContain("report-workflow-readiness-action-${item.workspace.persona}");
    expect(reportsSource).toContain("Automation readiness");
    expect(reportsSource).toContain("Role-specific coverage gaps before report packs");
    expect(reportsSource).toContain("report-automation-operations-${workspace.persona}");
    expect(reportsSource).toContain("report-automation-operations-title");
    expect(reportsSource).toContain("report-automation-impact-title");
    expect(reportsSource).toContain('data-testid="report-automation-impact"');
    expect(reportsSource).toContain("report-automation-impact-${workspace.persona}");
    expect(reportsSource).toContain("Open autopilot");
    expect(reportsSource).toContain("Recover failed delivery");
    expect(reportsSource).toContain("Open command center");
    expect(reportsSource).toContain("Open delivery");
    expect(reportsSource).toContain("report-delivery-subscription-${subscription.id}");
    expect(reportsSource).toContain("Open subscription");
    expect(reportsSource).toContain("queueReportDeliverySubscription");
    expect(reportsSource).toContain("/report-delivery/subscriptions/${subscriptionId}/queue");
    expect(reportsSource).toContain("acknowledgeHandoffGaps?: boolean");
    expect(reportsSource).toContain("acknowledgeHandoffGaps ? { acknowledgeHandoffGaps: true }");
    expect(reportsSource).toContain("saveReportDeliverySubscriptionSettings");
    expect(reportsSource).toContain("/report-delivery/subscriptions/${subscriptionId}/settings");
    expect(reportsSource).toContain("reportDeliveryPlansQuery");
    expect(reportsSource).toContain("reportDeliveryRunsQuery");
    expect(reportsSource).toContain("reportDeliverySchedulerHealthQuery");
    expect(reportsSource).toContain("ReportDeliverySchedulerHandoffReview");
    expect(reportsSource).toContain("ReportDeliverySchedulerScanSnapshot");
    expect(reportsSource).toContain("reportDeliverySchedulerHandoffSkipCount");
    expect(reportsSource).toContain("reportDeliverySchedulerHandoffReviews");
    expect(reportsSource).toContain("retryReportDeliveryRun");
    expect(reportsSource).toContain("ReportDeliveryRunStatusFilter");
    expect(reportsSource).toContain("reportDeliveryRunStatusFilters");
    expect(reportsSource).toContain("reportDeliveryRunStatusFilter");
    expect(reportsSource).toContain("setReportDeliveryRunStatusFilter");
    expect(reportsSource).toContain("matchesReportDeliveryRunStatusFilter");
    expect(reportsSource).toContain("reportDeliveryRunStatusCounts");
    expect(reportsSource).toContain("reportDeliveryRunTimelineRows");
    expect(reportsSource).toContain("reportDeliveryRecoverySummary");
    expect(reportsSource).toContain("reportDeliveryAutomationCommandTargets");
    expect(reportsSource).toContain("pinnedReportDeliveryAutomationCommands");
    expect(reportsSource).toContain("pinReportDeliveryAutomationCommand");
    expect(reportsSource).toContain("saveReportDeliveryAutomationPreference");
    expect(reportsSource).toContain("reportDeliveryAutomationPreferencesQuery");
    expect(reportsSource).toContain("reportDeliveryAutomationCommandCardClass");
    expect(reportsSource).toContain("parseReportDeliveryAutomationCommand(command)");
    expect(reportsSource).toContain("setPreferredReportDeliveryAutomationCommand");
    expect(reportsSource).toContain("/report-delivery/preferences/${persona}");
    expect(reportsSource).toContain("/report-delivery/preferences");
    expect(reportsSource).toContain("retryableSubscriptionCount");
    expect(reportsSource).toContain("reviewSubscriptionCount");
    expect(reportsSource).toContain("Retry latest failed delivery");
    expect(reportsSource).toContain("report-delivery-scheduler-health");
    expect(reportsSource).toContain("report-delivery-scheduler-handoff-skips");
    expect(reportsSource).toContain("report-delivery-scheduler-handoff-${review.subscriptionId}");
    expect(reportsSource).toContain("Scheduled sends held for handoff");
    expect(reportsSource).toContain("report-delivery-recovery-summary");
    expect(reportsSource).toContain("report-delivery-recovery-failed-runs");
    expect(reportsSource).toContain("report-delivery-recovery-retryable-subscriptions");
    expect(reportsSource).toContain("report-delivery-recovery-next-action");
    expect(reportsSource).toContain("report-delivery-recovery-retry-latest");
    expect(reportsSource).toContain("report-delivery-command-strip");
    expect(reportsSource).toContain("report-delivery-command-pinned");
    expect(reportsSource).toContain("report-delivery-command-retry");
    expect(reportsSource).toContain("report-delivery-command-review");
    expect(reportsSource).toContain("report-delivery-command-queue");
    expect(reportsSource).toContain("report-delivery-command-comparison");
    expect(reportsSource).toContain("report-delivery-command-pin-retry");
    expect(reportsSource).toContain("report-delivery-command-pin-review");
    expect(reportsSource).toContain("report-delivery-command-pin-queue");
    expect(reportsSource).toContain("report-delivery-command-pin-comparison");
    expect(reportsSource).toContain("report-delivery-run-timeline");
    expect(reportsSource).toContain("report-delivery-run-filter-${filter.id}");
    expect(reportsSource).toContain("report-delivery-run-timeline-${run.id}");
    expect(reportsSource).toContain("report-delivery-run-timeline-retry-${run.id}");
    expect(reportsSource).toContain("report-delivery-run-timeline-empty");
    expect(reportsSource).toContain("Queue delivery");
    expect(reportsSource).toContain("Retry delivery");
    expect(reportsSource).toContain("/report-delivery/runs/${runId}/retry");
    expect(reportsSource).toContain("report-delivery-settings-editor-${subscription.id}");
    expect(reportsSource).toContain("report-delivery-preview-${subscription.id}");
    expect(reportsSource).toContain("report-delivery-preview-handoff-${subscription.id}");
    expect(reportsSource).toContain("report-delivery-handoff-acknowledgement-${subscription.id}");
    expect(reportsSource).toContain("subscriptionHandoffRows");
    expect(reportsSource).toContain("subscriptionRequiresHandoffAcknowledgement");
    expect(reportsSource).toContain("Acknowledge handoff");
    expect(reportsSource).toContain("report-delivery-run-history-${subscription.id}");
    expect(reportsSource).toContain("run.errorMessage");
    expect(reportsSource).toContain("Edit settings");
    expect(reportsSource).toContain("Save delivery settings");
    expect(reportsSource).toContain("reportDeliverySettingsDraft.cadence");
    expect(reportsSource).toContain("reportDeliverySettingsDraft.channel");
    expect(reportsSource).toContain("reportDeliverySettingsDraft.format");
    expect(reportsSource).toContain("reportDeliverySettingsDraft.recipients");
    expect(reportsSource).toContain("reportDeliverySettingsDraft.deliveryGuardrail");
    expect(reportsSource).toContain("ReportLaunchPicker");
    expect(reportsSource).toContain("reportDeliveryLauncherPersona");
    expect(reportsSource).toContain('mode="delivery"');
    expect(reportsSource).toContain("onQueueDeliverySubscription");
    expect(reportsSource).toContain("queueReportDeliverySubscription.mutate({");
    expect(reportsSource).toContain("variables?.subscriptionId");
    expect(reportsSource).toContain("onRetryDeliveryRun");
    expect(reportsSource).toContain("retryReportDeliveryRun.mutate(runId)");
    expect(reportsSource).toContain("queueingDeliverySubscriptionId");
    expect(reportsSource).toContain("retryingDeliveryRunId");
    expect(reportsSource).toContain("deliveryQueueDisabled");
    expect(reportsSource).toContain("deliveryRetryDisabled");
    expect(reportsSource).toContain(
      "preferredDeliveryAutomationCommand={pinnedReportDeliveryAutomationCommand}"
    );
    expect(reportsSource).toContain("companyId={selectedCompanyId}");
    expect(reportsSource).toContain("ReportLaunchDeliveryPreview");
    expect(reportsSource).toContain("reportDeliveryLauncherPreviewById");
    expect(reportsSource).toContain(
      "const handoffRows = reportDeliveryHandoffPreviewByPersona[subscription.persona]"
    );
    expect(reportsSource).toContain("handoffRows,");
    expect(reportsSource).toContain("deliverySubscriptionPreviewById");
    expect(reportsSource).toContain("summary: subscription.preview.summary");
    expect(reportsSource).toContain("const latestRun = subscription.latestDeliveryRun");
    expect(reportsSource).toContain("latestRunStatus: latestRun?.status");
    expect(reportsSource).toContain("latestRunStatusVariant");
    expect(reportsSource).toContain("latestRunId: latestRun?.id");
    expect(reportsSource).toContain("latestRunLabel");
    expect(reportsSource).toContain("latestRunDetail");
    expect(reportsSource).toContain("latestRunError");
    expect(reportsSource).toContain("queueDisabled: !subscription.enabled");
    expect(reportsSource).toContain("packReadyAutomationRules");
    expect(reportsSource).toContain("packAutoSendCoveragePercent");
    expect(reportsSource).toContain("packRuleReportBundleCount");
    expect(reportsSource).toContain("Report bundle coverage");
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
    expect(reportsSource).toContain("Rule Status");
    expect(reportsSource).toContain("Open Work Items");
    expect(reportsSource).toContain("Comparison Metrics");
    expect(reportsSource).toContain("packAutomationRules");
    expect(reportsSource).toContain("reportPackReviewCount");
    expect(reportsSource).toContain("pack-readiness-${workspace.persona}");
    expect(reportsSource).toContain("Delivery checks");
    expect(reportsSource).toContain("Checks needing review");
    expect(reportsSource).toContain("Amount at risk");
    expect(reportsSource).toContain("Included in workbook");
    expect(reportsSource).toContain("Open workflow");
    expect(reportsSource).toContain("Operations Control");
    expect(reportsSource).toContain("operationsControl");
    expect(reportsSource).toContain("accountantHandoff");
    expect(reportsSource).toContain(
      "packSummary,\n      operationsControl,\n      accountantHandoff"
    );
    expect(reportsSource).toContain("packSummary,\n      operationsControl");
    expect(reportsSource).toContain('reportSectionHref(workspace, "automation-operations")');
    expect(reportsSource).toContain("reportPersonaHref(report, workspace.persona)");
    expect(reportsSource).toContain('reportSectionHref(workspace, "automation-command-center")');
    expect(reportsSource).toContain("reportAutomationPlaybookHref(playbook, workspace.persona)");
    expect(reportsSource).toContain("button-open-automation-center-${workspace.persona}");
    expect(reportsSource).toContain("workspace.automationOutcome");
    expect(reportsSource).toContain("Automation outcome");
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
    expect(
      reportsSource.slice(
        reportsSource.indexOf('<TabsContent value="tax"'),
        reportsSource.indexOf('<TabsContent value="sales"')
      )
    ).not.toContain("Audit Trail");
    expect(
      reportsSource.slice(
        reportsSource.indexOf('<TabsContent value="tax"'),
        reportsSource.indexOf('<TabsContent value="sales"')
      )
    ).not.toContain("Expense claims");
    expect(
      reportsSource.slice(
        reportsSource.indexOf('<TabsContent value="tax"'),
        reportsSource.indexOf('<TabsContent value="sales"')
      )
    ).not.toContain("Inventory valuation");
    expect(
      reportsSource.slice(
        reportsSource.indexOf('<TabsContent value="balances"'),
        reportsSource.indexOf('<TabsContent value="expenses"')
      )
    ).toContain("Inventory valuation");
    expect(
      reportsSource.slice(
        reportsSource.indexOf('<TabsContent value="balances"'),
        reportsSource.indexOf('<TabsContent value="expenses"')
      )
    ).toContain("Inventory movement");
    expect(
      reportsSource.slice(
        reportsSource.indexOf('<TabsContent value="balances"'),
        reportsSource.indexOf('<TabsContent value="expenses"')
      )
    ).toContain("Depreciation schedule");
    expect(
      reportsSource.slice(
        reportsSource.indexOf('<TabsContent value="expenses"'),
        reportsSource.indexOf('<TabsContent value="payroll"')
      )
    ).toContain("Expense claims");
    expect(
      reportsSource.slice(
        reportsSource.indexOf('<TabsContent value="close"'),
        reportsSource.indexOf('<TabsContent value="planning"')
      )
    ).toContain("Audit Trail");
    expect(exportSource).toContain("Sales by Product Service");
    expect(reportsSource).toContain("sales-product-service");
    expect(reportsRouteSource).toContain("/api/companies/:id/reports/sales-product-service");
    expect(reportsRouteSource).toContain("inArray(invoiceLines.invoiceId, invoiceIds)");
    expect(reportsSource).toContain("monthEndCloseStatus");
    expect(reportsSource).toContain("Month-End Close Status");
    expect(reportsSource).toContain("/month-end/checklist");
    expect(reportsSource).toContain('data-testid="tab-month-end-close-status"');
    expect(reportsSource).toContain("connectedReportCenters");
    expect(reportsSource).toContain("Connected report centers");
    expect(reportsSource).toContain("Open report center");
    expect(reportsSource).toContain("reportActionContextByPersonaReportId.get");
    expect(reportsSource).toContain("report-library-automation-${report.id}");
    expect(reportsSource).toContain("const comparisonHref = context?.comparisonPresets[0]?.href");
    expect(reportsSource).toContain("report-library-comparison-${report.id}");
    expect(reportsSource).toContain("const deliveryHref = context?.deliverySubscriptions[0]?.href");
    expect(reportsSource).toContain("report-library-delivery-${report.id}");
    expect(catalogSource).toContain("/advanced-reports?tab=cashflow");
    expect(catalogSource).toContain("/advanced-reports?tab=aging");
    expect(catalogSource).toContain("/advanced-reports?tab=comparison");
    expect(exportSource).toContain("prepareMonthEndCloseStatusForExport");
    expect(exportSource).toContain("Month-End Checklist");
    expect(reportsSource).toContain("auditTrailReport");
    expect(reportsSource).toContain("Audit Trail");
    expect(reportsSource).toContain("/activity-logs?limit=200");
    expect(reportsSource).toContain("prepareAuditTrailForExport");
    expect(exportSource).toContain("Audit Trail Summary");
    expect(exportSource).toContain("Audit Trail Detail");
    expect(portalRouteSource).toContain("/api/companies/:companyId/activity-logs");
    expect(reportsSource).toContain("fixedAssetRegisterReport");
    expect(reportsSource).toContain("inventoryValuationReport");
    expect(reportsSource).toContain("Inventory valuation");
    expect(reportsSource).toContain("inventoryMovementReport");
    expect(reportsSource).toContain("Inventory movement");
    expect(reportsSource).toContain("/inventory-movements");
    expect(exportSource).toContain("Inventory Valuation");
    expect(exportSource).toContain("Inventory Summary");
    expect(exportSource).toContain("Inventory Movement Summary");
    expect(exportSource).toContain("Inventory Movement Detail");
    expect(inventoryRouteSource).toContain("/api/companies/:companyId/products");
    expect(inventoryRouteSource).toContain("/api/companies/:companyId/inventory-movements");
    expect(reportsSource).toContain("Fixed asset register");
    expect(reportsSource).toContain("/fixed-assets");
    expect(reportsSource).toContain("/fixed-assets/summary");
    expect(exportSource).toContain("Fixed Asset Register");
    expect(exportSource).toContain("Fixed Assets by Category");
    expect(reportsSource).toContain("depreciationScheduleReport");
    expect(reportsSource).toContain("Depreciation schedule");
    expect(reportsSource).toContain("buildDepreciationScheduleReport");
    expect(exportSource).toContain("Depreciation Schedule Summary");
    expect(exportSource).toContain("Depreciation Schedule");
    expect(fixedAssetsRouteSource).toContain("/api/companies/:companyId/fixed-assets");
    expect(fixedAssetsRouteSource).toContain("/api/companies/:companyId/fixed-assets/summary");
    expect(reportsSource).toContain("expenseClaimReport");
    expect(reportsSource).toContain("Expense claims");
    expect(reportsSource).toContain("/expense-claims/summary");
    expect(reportsSource).toContain("expense-claims");
    expect(reportsSource).toContain("/cost-centers/profitability");
    expect(reportsSource).toContain("costCenterProfitability");
    expect(reportsSource).toContain("comparisonCurrentCostCenterProfitability");
    expect(reportsSource).toContain("comparisonPreviousCostCenterProfitability");
    expect(exportSource).toContain("Expense Claims Summary");
    expect(exportSource).toContain("Expense Claims Detail");
    expect(exportSource).toContain("Cost Center P&L");
    expect(exportSource).toContain("prepareCostCenterProfitabilityForExport");
    expect(expenseClaimsRouteSource).toContain("/api/companies/:companyId/expense-claims");
    expect(expenseClaimsRouteSource).toContain("/api/companies/:companyId/expense-claims/summary");
    expect(costCentersRouteSource).toContain(
      "/api/companies/:companyId/cost-centers/profitability"
    );
    expect(costCentersRouteSource).toContain('eq(journalEntries.status, "posted")');
    expect(costCentersRouteSource).toContain("gte(journalEntries.date, fromDate)");
    expect(costCentersRouteSource).toContain("lte(journalEntries.date, toDate)");
    expect(reportsSource).toContain("payrollReport");
    expect(reportsSource).toContain("Payroll Summary");
    expect(reportsSource).toContain("WPS / SIF readiness");
    expect(reportsSource).toContain("preparePayrollReportsForExport");
    expect(exportSource).toContain("Payroll Summary");
    expect(exportSource).toContain("WPS SIF Summary");
    expect(payrollRouteSource).toContain("/api/companies/:companyId/payroll-runs");
    expect(payrollRouteSource).toContain("/api/payroll-runs/:id/generate-sif");
    expect(reportsSource).toContain("consolidatedStatementsReport");
    expect(reportsSource).toContain("Consolidated statements");
    expect(reportsSource).toContain("buildConsolidatedStatementsReport");
    expect(reportsSource).toContain("accessibleReportCompanies");
    expect(reportsSource).toContain("no eliminations applied");
    expect(exportSource).toContain("prepareConsolidatedStatementsForExport");
    expect(exportSource).toContain("Consolidated Summary");
    expect(exportSource).toContain("Consolidated Entities");
    expect(exportSource).toContain("Consolidation Review");

    const workbookMappedReportIds = new Set(
      Array.from(reportsSource.matchAll(/addSheets\(\s*\[([^\]]+)\]/g)).flatMap(([, ids]) =>
        Array.from(ids.matchAll(/"([^"]+)"/g)).map(([, reportId]) => reportId)
      )
    );

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

      const liveReportIds = reportCatalog
        .filter((report) => report.status === "live" && report.personas.includes(workspace.persona))
        .map((report) => report.id);
      expect(liveReportIds.every((reportId) => workbookMappedReportIds.has(reportId))).toBe(true);
    }

    const plannedReports = reportCatalog.filter((report) => report.status === "planned");
    expect(plannedReports).toHaveLength(0);

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

  it("serves the report catalog through an authenticated discovery endpoint", () => {
    expect(routesSource).toContain("registerReportRoutes");
    expect(reportsRouteSource).toContain('"/api/reports/catalog"');
    expect(reportsRouteSource).toContain("buildReportCatalogDiscovery");
    expect(reportsRouteSource).toContain("isReportCatalogPersona");
    expect(reportsRouteSource).toContain("persona must be owner, freelancer, or accountant");
    expect(reportCatalogServiceSource).toContain("buildReportCatalogDiscovery");
    expect(reportCatalogServiceSource).toContain("reportCatalog.filter");
    expect(reportCatalogServiceSource).toContain("const reportActionContexts = reports.flatMap");
    expect(reportCatalogServiceSource).toContain("reportWorkflowContextHref({");
    expect(reportCatalogServiceSource).toContain("workflowHref");
    expect(reportCatalogServiceSource).toContain("quickAccessHref");
    expect(reportCatalogServiceSource).toContain("automationImpactHref");
    expect(reportCatalogServiceSource).toContain("automationStarters: reportAutomationStarters");
    expect(reportCatalogServiceSource).toContain(
      "deliverySubscriptions: reportDeliverySubscriptions"
    );
    expect(reportCatalogServiceSource).toContain("comparisonPresets: reportComparisonPresets");
    expect(reportCatalogServiceSource).toContain("reportSuites: reportSuiteProfiles");
    expect(reportCatalogServiceSource).toContain(
      "managementBriefs = reportManagementBriefProfiles"
    );
    expect(reportCatalogServiceSource).toContain("savedViews: reportSavedViewProfiles");
    expect(reportCatalogServiceSource).toContain("const personaSummaries = workspaces.map");
    expect(reportCatalogServiceSource).toContain("personaReports");
    expect(reportCatalogServiceSource).toContain("personaComparisonPresets");
    expect(reportCatalogServiceSource).toContain("personaReportSuites");
    expect(reportCatalogServiceSource).toContain("personaQuickAccessProfiles");
    expect(reportCatalogServiceSource).toContain("personaSavedViews");
    expect(reportCatalogServiceSource).toContain("personaAutomationImpactProfiles");
    expect(reportCatalogServiceSource).toContain("quickAccessProfileCount");
    expect(reportCatalogServiceSource).toContain("reportSuiteCount");
    expect(reportCatalogServiceSource).toContain("managementBriefCount");
    expect(reportCatalogServiceSource).toContain("savedViewCount");
    expect(reportCatalogServiceSource).toContain("automationImpactProfileCount");
    expect(reportCatalogServiceSource).toContain("readyReportCount");
    expect(reportCatalogServiceSource).toContain(
      'readyReportCount: reports.filter((report) => report.status !== "planned").length'
    );
    expect(reportCatalogServiceSource).toContain(
      'readyReportCount: personaReports.filter((report) => report.status !== "planned").length'
    );
    expect(reportCatalogServiceSource).toContain("automationCommandCenterHref");
    expect(reportCatalogServiceSource).toContain('reportSectionHref(workspace, "role-setup")');
    expect(reportCatalogServiceSource).toContain('reportSectionHref(workspace, "role-workflows")');
    expect(reportCatalogServiceSource).toContain(
      'reportSectionHref(workspace, "management-briefs")'
    );
    expect(reportCatalogServiceSource).toContain("workflowStepCount");
    expect(reportCatalogServiceSource).toContain("automationRunbookStepCount");
    expect(reportCatalogServiceSource).toContain("workflowSteps: workspace.workflowSteps.map");
    expect(reportCatalogServiceSource).toContain("reportRoleWorkflowStepHref(workspace, step)");
    expect(reportCatalogServiceSource).toContain("defaultViewHref");
    expect(reportCatalogServiceSource).toContain("handoffRecipients");
    expect(reportCatalogServiceSource).toContain("handoffGuardrail");
    expect(reportCatalogServiceSource).toContain("buildReportAutomationRunbookSteps");
    expect(reportCatalogServiceSource).toContain(
      "runbookSteps: buildReportAutomationRunbookSteps(workspace, playbook)"
    );
    expect(reportCatalogServiceSource).toContain("setupStepCount");
    expect(reportCatalogServiceSource).toContain("setupChecklist: workspace.setupChecklist.map");
    expect(reportCatalogServiceSource).toContain("liveReportCount");
    expect(reportCatalogServiceSource).toContain("reportHref(report)");
    expect(reportCatalogServiceSource).toContain("reportPersonaHref(report, reportPersona)");
    expect(reportCatalogServiceSource).toContain(
      "href: (persona ? reportPersonaHref(report, persona) : reportHref(report)) ?? null"
    );
    expect(reportCatalogServiceSource).toContain("reportWorkspaceHref(workspace)");
    expect(reportCatalogServiceSource).toContain(
      'reportSectionHref(workspace, "automation-operations")'
    );
    expect(reportCatalogServiceSource).toContain('reportSectionHref(workspace, "report-suites")');
    expect(reportCatalogServiceSource).toContain('reportSectionHref(workspace, "quick-access")');
    expect(reportCatalogServiceSource).toContain('reportSectionHref(workspace, "saved-views")');
    expect(reportCatalogServiceSource).toContain(
      'reportSectionHref(workspace, "automation-impact")'
    );
    expect(reportCatalogServiceSource).toContain('reportSectionHref(workspace, "recommendations")');
    expect(reportCatalogServiceSource).toContain('reportSectionHref(workspace, "trigger-rules")');
    expect(reportCatalogServiceSource).toContain(
      'reportSectionHref(workspace, "automation-rules")'
    );
    expect(reportCatalogServiceSource).toContain(
      'reportSectionHref(workspace, "automation-command-center")'
    );
    expect(reportCatalogServiceSource).toContain('reportSectionHref(workspace, "pack-automation")');
    expect(reportCatalogServiceSource).toContain("reportDecisionShortcutHref(shortcut)");
    expect(reportCatalogServiceSource).toContain("reportAutomationStarterHref(starter)");
    expect(reportCatalogServiceSource).toContain("reportAutomationTriggerRuleHref(rule)");
    expect(reportCatalogServiceSource).toContain("reportDeliverySubscriptionHref(subscription)");
    expect(reportCatalogServiceSource).toContain("reportPackTemplateHref(template)");
    expect(reportCatalogServiceSource).toContain("reportComparisonPresetHref(preset)");
    expect(reportCatalogServiceSource).toContain("reportSuiteHref(suite)");
    expect(reportCatalogServiceSource).toContain("reportManagementBriefHref(brief)");
    expect(reportCatalogServiceSource).toContain("reportSavedViewHref(view)");
    expect(reportCatalogApiSource).toContain("ReportCatalogDiscoverySummary");
    expect(reportCatalogApiSource).toContain("ReportCatalogActionLink");
    expect(reportCatalogApiSource).toContain("ReportCatalogReportActionContext");
    expect(reportCatalogApiSource).toContain("ReportPersonaCatalogSummary");
    expect(reportCatalogApiSource).toContain("personaSummaries: ReportPersonaCatalogSummary[]");
    expect(reportCatalogApiSource).toContain("readyReportCount: number");
    expect(reportCatalogApiSource).toContain("apiReportCount: number");
    expect(reportCatalogApiSource).toContain("plannedReportCount: number");
    expect(reportCatalogApiSource).toContain("comparisonPresetCount: number");
    expect(reportCatalogApiSource).toContain("reportSuiteCount: number");
    expect(reportCatalogApiSource).toContain("managementBriefCount: number");
    expect(reportCatalogApiSource).toContain("quickAccessProfileCount: number");
    expect(reportCatalogApiSource).toContain("savedViewCount: number");
    expect(reportCatalogApiSource).toContain("automationImpactProfileCount: number");
    expect(reportCatalogApiSource).toContain("setupStepCount: number");
    expect(reportCatalogApiSource).toContain("workflowStepCount: number");
    expect(reportCatalogApiSource).toContain("automationRunbookStepCount: number");
    expect(reportCatalogApiSource).toContain("automationPlaybookCount: number");
    expect(reportCatalogApiSource).toContain("roleSetupHref: string");
    expect(reportCatalogApiSource).toContain("roleWorkflowsHref: string");
    expect(reportCatalogApiSource).toContain("managementBriefsHref: string");
    expect(reportCatalogApiSource).toContain("reportSuitesHref: string");
    expect(reportCatalogApiSource).toContain("quickAccessHref: string");
    expect(reportCatalogApiSource).toContain("savedViewsHref: string");
    expect(reportCatalogApiSource).toContain("automationImpactHref: string");
    expect(reportCatalogApiSource).toContain("recommendationsHref: string");
    expect(reportCatalogApiSource).toContain("triggerRulesHref: string");
    expect(reportCatalogApiSource).toContain("automationRulesHref: string");
    expect(reportCatalogApiSource).toContain("automationCommandCenterHref: string");
    expect(reportCatalogApiSource).toContain("packAutomationHref: string");
    expect(reportCatalogApiSource).toContain("setupChecklist: Array");
    expect(reportCatalogApiSource).toContain("workflowSteps: Array");
    expect(reportCatalogApiSource).toContain("ReportRoleWorkflowStep");
    expect(reportCatalogApiSource).toContain("defaultViewHref: string");
    expect(reportCatalogApiSource).toContain("handoffRecipients: string");
    expect(reportCatalogApiSource).toContain("handoffGuardrail: string");
    expect(reportCatalogApiSource).toContain("ReportAutomationRunbookStep");
    expect(reportCatalogApiSource).toContain("runbookSteps: ReportAutomationRunbookStep[]");
    expect(reportCatalogApiSource).toContain("reportSuites: Array");
    expect(reportCatalogApiSource).toContain("managementBriefs: Array");
    expect(reportCatalogApiSource).toContain("ReportManagementBriefProfile");
    expect(reportCatalogApiSource).toContain("quickAccessProfiles: Array");
    expect(reportCatalogApiSource).toContain("savedViews: Array");
    expect(reportCatalogApiSource).toContain("automationImpactProfiles: Array");
    expect(reportCatalogApiSource).toContain("ReportCatalogDiscovery");
    expect(reportCatalogApiSource).toContain(
      "reportActionContexts: ReportCatalogReportActionContext[]"
    );
    expect(reportCatalogApiSource).toContain("reportCatalogDiscoveryQueryKey");
    expect(reportCatalogApiSource).toContain("reportCatalogDiscoveryPath");
    expect(reportCatalogApiSource).toContain("fetchReportCatalogDiscovery");
    expect(reportCatalogApiSource).toContain('"/api/reports/catalog"');
    expect(reportCatalogApiSource).toContain("new URLSearchParams({ persona })");
    expect(reportLaunchPickerSource).toContain("fetchReportCatalogDiscovery");
    expect(reportLaunchPickerSource).toContain("reportCatalogDiscoveryQueryKey(selectedPersona)");
    expect(reportLaunchPickerSource).toContain("reportCatalog");
    expect(reportLaunchPickerSource).toContain("readyReportCatalog");
    expect(reportLaunchPickerSource).toContain('report.status !== "planned"');
    expect(reportLaunchPickerSource).toContain("reportSuiteProfiles");
    expect(reportLaunchPickerSource).toContain("reportSuiteHref");
    expect(reportLaunchPickerSource).toContain("reportDecisionShortcuts");
    expect(reportLaunchPickerSource).toContain("reportAutomationStarters");
    expect(reportLaunchPickerSource).toContain("reportDeliverySubscriptions");
    expect(reportLaunchPickerSource).toContain("reportDeliverySubscriptionHref");
    expect(reportLaunchPickerSource).toContain("getPreferredReportDeliveryAutomationCommand");
    expect(reportLaunchPickerSource).toContain("preferredDeliveryAutomationCommand");
    expect(reportLaunchPickerSource).toContain("companyId");
    expect(reportLaunchPickerSource).toContain("automationPreferencesQuery");
    expect(reportLaunchPickerSource).toContain(
      "/api/companies/${companyId}/report-delivery/preferences"
    );
    expect(reportLaunchPickerSource).toContain("storedDeliveryAutomationCommand");
    expect(reportLaunchPickerSource).toContain("hasControlledDeliveryAutomationCommand");
    expect(reportLaunchPickerSource).toContain("selectedPersona === persona");
    expect(reportLaunchPickerSource).toContain("syncedDeliveryAutomationCommand");
    expect(reportLaunchPickerSource).toContain("pinnedDeliveryAutomationCommand");
    expect(reportLaunchPickerSource).toContain("reportComparisonPresetHref");
    expect(reportLaunchPickerSource).toContain("reportComparisonPresets");
    expect(reportLaunchPickerSource).toContain("reportSectionHref");
    expect(reportLaunchPickerSource).toContain("reportLaunchPinnedCommandLabels");
    expect(reportLaunchPickerSource).toContain("report-delivery-launch-picker");
    expect(reportLaunchPickerSource).toContain("onQueueDeliverySubscription");
    expect(reportLaunchPickerSource).toContain("onRetryDeliveryRun");
    expect(reportLaunchPickerSource).toContain("queueingDeliverySubscriptionId");
    expect(reportLaunchPickerSource).toContain("retryingDeliveryRunId");
    expect(reportLaunchPickerSource).toContain("deliveryQueueDisabled");
    expect(reportLaunchPickerSource).toContain("deliveryRetryDisabled");
    expect(reportLaunchPickerSource).toContain("ReportLaunchDeliveryPreview");
    expect(reportLaunchPickerSource).toContain("deliverySubscriptionPreviewById");
    expect(reportLaunchPickerSource).toContain("getPreferredReportWorkflowGapFilter");
    expect(reportLaunchPickerSource).toContain("getPreferredReportWorkflowSearch");
    expect(reportLaunchPickerSource).toContain("reportWorkflowContextHref");
    expect(reportLaunchPickerSource).toContain("reportWorkflowFinderGapHref");
    expect(reportLaunchPickerSource).toContain("storedWorkflowGapFilter");
    expect(reportLaunchPickerSource).toContain("reportWorkflowGapFilterLabels");
    expect(reportLaunchPickerSource).toContain("search: trimmedQuery");
    expect(reportLaunchPickerSource).toContain("setPreferredReportWorkflowSearch");
    expect(reportLaunchPickerSource).toContain("setQuery(getPreferredReportWorkflowSearch");
    expect(reportLaunchPickerSource).toContain("updateLauncherQuery");
    expect(reportLaunchPickerSource).toContain("reportLaunchWorkflowSearchScore");
    expect(reportLaunchPickerSource).toContain("rankReportLaunchItems");
    expect(reportLaunchPickerSource).toContain("searchScore");
    expect(reportLaunchPickerSource).toContain("matchesReportLaunchWorkflowSearch");
    expect(reportLaunchPickerSource).toContain("linkedReportSearchValues");
    expect(reportLaunchPickerSource).toContain(
      "reportCatalog.find((report) => report.id === reportId)?.name"
    );
    expect(reportLaunchPickerSource).toContain("...linkedReportSearchValues(starter.reportIds)");
    expect(reportLaunchPickerSource).toContain(
      "...linkedReportSearchValues(subscription.reportIds)"
    );
    expect(reportLaunchPickerSource).toContain("...linkedReportSearchValues(preset.reportIds)");
    expect(reportLaunchPickerSource).toContain("...linkedReportSearchValues(template.reportIds)");
    expect(reportLaunchPickerSource).toContain("...linkedReportSearchValues(suite.reportIds)");
    expect(reportLaunchPickerSource).toContain("matchesLauncherQuery");
    expect(reportLaunchPickerSource).toContain("reportPersonaHref(report, selectedPersona)");
    expect(reportLaunchPickerSource).toContain("reportItemHref(report, selectedPersona)");
    expect(reportLaunchPickerSource).toContain("visibleShortcuts");
    expect(reportLaunchPickerSource).toContain("visibleStarters");
    expect(reportLaunchPickerSource).toContain("visibleDeliverySubscriptions");
    expect(reportLaunchPickerSource).toContain("visibleComparisonPresets");
    expect(reportLaunchPickerSource).toContain("visiblePackTemplates");
    expect(reportLaunchPickerSource).toContain("reportAutomationContextById");
    expect(reportLaunchPickerSource).toContain("type ReportCatalogReportActionContext");
    expect(reportLaunchPickerSource).toContain("type LaunchReportActionLink");
    expect(reportLaunchPickerSource).toContain("starterActionLink");
    expect(reportLaunchPickerSource).toContain("deliveryActionLink");
    expect(reportLaunchPickerSource).toContain("comparisonActionLink");
    expect(reportLaunchPickerSource).toContain("suiteActionLink");
    expect(reportLaunchPickerSource).toContain("syncedCatalog?.reportActionContexts.find");
    expect(reportLaunchPickerSource).toContain("syncedContext?.automationStarters[0]");
    expect(reportLaunchPickerSource).toContain("syncedContext?.deliverySubscriptions[0]");
    expect(reportLaunchPickerSource).toContain("syncedContext?.comparisonPresets[0]");
    expect(reportLaunchPickerSource).toContain("syncedContext?.reportSuites[0]");
    expect(reportLaunchPickerSource).toContain("starters.find");
    expect(reportLaunchPickerSource).toContain("deliverySubscriptions.find");
    expect(reportLaunchPickerSource).toContain("comparisonPresets.find");
    expect(reportLaunchPickerSource).toContain("reportSuites.find");
    expect(reportLaunchPickerSource).toContain("syncedCatalog?.reportSuites");
    expect(reportLaunchPickerSource).toContain("suiteSearchValues");
    expect(reportLaunchPickerSource).toContain("suite.triggerRuleIds.join");
    expect(reportLaunchPickerSource).toContain("suite.deliverySubscriptionId");
    expect(reportLaunchPickerSource).toContain("suite.decisionShortcutId");
    expect(reportLaunchPickerSource).toContain("visibleSuites");
    expect(reportLaunchPickerSource).toContain("suiteHref(suite)");
    expect(reportLaunchPickerSource).toContain('reportSectionHref(workspace, "workflow-finder")');
    expect(reportLaunchPickerSource).toContain("workflowFinderHref");
    expect(reportLaunchPickerSource).toContain("matchingAutomationPackHref");
    expect(reportLaunchPickerSource).toContain("matchingAutomationPackLabel");
    expect(reportLaunchPickerSource).toContain("Open matching suite");
    expect(reportLaunchPickerSource).toContain(
      "visibleDeliverySubscriptions[0] ?? deliverySubscriptions[0]"
    );
    expect(reportLaunchPickerSource).toContain(
      "visibleComparisonPresets[0] ?? comparisonPresets[0]"
    );
    expect(reportLaunchPickerSource).toContain("deliveryPreview?.summary");
    expect(reportLaunchPickerSource).toContain("handoffRows");
    expect(reportLaunchPickerSource).toContain("deliveryPreview?.handoffRows");
    expect(reportLaunchPickerSource).toContain("handoffRequiresAcknowledgement");
    expect(reportLaunchPickerSource).toContain("handoffAcknowledged");
    expect(reportLaunchPickerSource).toContain("primaryDeliveryRequiresHandoffAcknowledgement");
    expect(reportLaunchPickerSource).toContain("deliveryPreview?.nextRunLabel");
    expect(reportLaunchPickerSource).toContain("deliveryPreview?.deliveryGuardrail");
    expect(reportLaunchPickerSource).toContain("latestRunStatus");
    expect(reportLaunchPickerSource).toContain("latestRunId");
    expect(reportLaunchPickerSource).toContain("latestRunDetail");
    expect(reportLaunchPickerSource).toContain("latestRunError");
    expect(reportLaunchPickerSource).toContain("report-launch-retry-delivery-${subscription.id}");
    expect(reportLaunchPickerSource).toContain('data-testid="report-launch-pinned-command-retry"');
    expect(reportLaunchPickerSource).toContain("visibleComparisonPresets.slice(0, 2).map");
    expect(reportLaunchPickerSource).toContain("reportComparisonPresetHref(preset)");
    expect(reportLaunchPickerSource).toContain("report-launch-comparison-preset-${preset.id}");
    expect(reportLaunchPickerSource).toContain("preset.automationTrigger");
    expect(reportLaunchPickerSource).toContain("visibleSuites.slice(0, 2).map");
    expect(reportLaunchPickerSource).toContain("report-launch-suite-${suite.id}");
    expect(reportLaunchPickerSource).toContain("suite.reportIds.length");
    expect(reportLaunchPickerSource).toContain("suite.triggerRuleIds.length");
    expect(reportLaunchPickerSource).toContain("report-launch-queue-suite-delivery-${suite.id}");
    expect(reportLaunchPickerSource).toContain(
      "onQueueDeliverySubscription(suite.deliverySubscriptionId)"
    );
    expect(reportLaunchPickerSource).toContain("reportPackTemplates");
    expect(reportLaunchPickerSource).toContain("visiblePackTemplates.slice(0, 2).map");
    expect(reportLaunchPickerSource).toContain("packTemplateHref(template)");
    expect(reportLaunchPickerSource).toContain("report-launch-pack-template-${template.id}");
    expect(reportLaunchPickerSource).toContain("template.delivery");
    expect(reportLaunchPickerSource).toContain("isQueueDisabled");
    expect(reportLaunchPickerSource).toContain("isPinnedRetryCommandDisabled");
    expect(reportLaunchPickerSource).toContain("isPinnedQueueCommandDisabled");
    expect(reportLaunchPickerSource).toContain("report-launch-picker");
    expect(reportLaunchPickerSource).toContain("report-launch-pinned-command");
    expect(reportLaunchPickerSource).toContain("report-launch-pinned-command-${");
    expect(reportLaunchPickerSource).toContain("report-launch-pinned-command-open");
    expect(reportLaunchPickerSource).toContain("report-launch-pinned-command-queue");
    expect(reportLaunchPickerSource).toContain('data-testid="report-launch-search"');
    expect(reportLaunchPickerSource).toContain('data-testid="report-launch-gap-context"');
    expect(reportLaunchPickerSource).toContain('data-testid="report-launch-search-context"');
    expect(reportLaunchPickerSource).toContain('data-testid="report-launch-context-actions"');
    expect(reportLaunchPickerSource).toContain('data-testid="report-launch-open-workflow-finder"');
    expect(reportLaunchPickerSource).toContain('data-testid="report-launch-open-matching-pack"');
    expect(reportLaunchPickerSource).toContain("report-launch-persona-${item}");
    expect(reportLaunchPickerSource).toContain("report-launch-report-${report.id}");
    expect(reportLaunchPickerSource).toContain("report-launch-report-automation-${report.id}");
    expect(reportLaunchPickerSource).toContain("report-launch-report-delivery-${report.id}");
    expect(reportLaunchPickerSource).toContain("report-launch-report-comparison-${report.id}");
    expect(reportLaunchPickerSource).toContain("report-launch-report-suite-${report.id}");
    expect(reportLaunchPickerSource).toContain(
      "reportAutomationContext?.syncedContext?.reportHref"
    );
    expect(reportLaunchPickerSource).toContain("href={reportAutomationContext.starter.href}");
    expect(reportLaunchPickerSource).toContain("href={reportAutomationContext.delivery.href}");
    expect(reportLaunchPickerSource).toContain("href={reportAutomationContext.comparison.href}");
    expect(reportLaunchPickerSource).toContain("href={reportAutomationContext.suite.href}");
    expect(reportLaunchPickerSource).toContain("Open report <ArrowRight");
    expect(reportLaunchPickerSource).toContain("Autopilot");
    expect(reportLaunchPickerSource).toContain("Scheduled");
    expect(reportLaunchPickerSource).toContain(
      "report-launch-delivery-subscription-${subscription.id}"
    );
    expect(reportLaunchPickerSource).toContain("report-launch-delivery-preview-${subscription.id}");
    expect(reportLaunchPickerSource).toContain("deliveryPreview?.suiteTitles");
    expect(reportLaunchPickerSource).toContain("report-launch-delivery-handoff-${subscription.id}");
    expect(reportLaunchPickerSource).toContain("Acknowledge handoff");
    expect(reportLaunchPickerSource).toContain(
      "report-launch-latest-delivery-run-${subscription.id}"
    );
    expect(reportLaunchPickerSource).toContain("report-launch-queue-delivery-${subscription.id}");
  });

  it("serves report delivery subscriptions through an authenticated queue endpoint", () => {
    expect(routesSource).toContain("registerReportDeliveryRoutes");
    expect(reportDeliveryRouteSource).toContain(
      '"/api/companies/:companyId/report-delivery/subscriptions"'
    );
    expect(reportDeliveryRouteSource).toContain(
      '"/api/companies/:companyId/report-delivery/subscriptions/:subscriptionId/queue"'
    );
    expect(reportDeliveryRouteSource).toContain(
      '"/api/companies/:companyId/report-delivery/subscriptions/:subscriptionId/settings"'
    );
    expect(reportDeliveryRouteSource).toContain('"/api/companies/:companyId/report-delivery/runs"');
    expect(reportDeliveryRouteSource).toContain(
      '"/api/companies/:companyId/report-delivery/scheduler-health"'
    );
    expect(reportDeliveryRouteSource).toContain(
      '"/api/companies/:companyId/report-delivery/runs/:runId/retry"'
    );
    expect(reportDeliveryRouteSource).toContain(
      '"/api/companies/:companyId/report-delivery/preferences"'
    );
    expect(reportDeliveryRouteSource).toContain(
      '"/api/companies/:companyId/report-delivery/preferences/:persona"'
    );
    expect(reportDeliveryRouteSource).toContain("storage.hasCompanyAccess(userId, companyId)");
    expect(reportDeliveryRouteSource).toContain(
      "storage.getReportDeliverySubscriptionSettings(companyId)"
    );
    expect(reportDeliveryRouteSource).toContain("storage.getReportAutomationPreferences");
    expect(reportDeliveryRouteSource).toContain("storage.upsertReportAutomationPreference");
    expect(reportDeliveryRouteSource).toContain("preferredDeliveryAutomationCommand");
    expect(reportDeliveryRouteSource).toContain("storage.upsertReportDeliverySubscriptionSetting");
    expect(reportDeliveryRouteSource).toContain("storage.getReportDeliveryRuns");
    expect(reportDeliveryRouteSource).toContain("storage.getReportDeliveryRun");
    expect(reportDeliveryRouteSource).toContain("storage.createReportDeliveryRun");
    expect(reportDeliveryRouteSource).toContain("storage.getLatestReportDeliverySchedulerScan");
    expect(reportDeliveryRouteSource).toContain("storage.getReportDeliverySchedulerScans");
    expect(reportDeliveryRouteSource).toContain("createAndEmitNotification");
    expect(reportDeliveryRouteSource).toContain("buildReportDeliveryNotificationInput");
    expect(reportDeliveryRouteSource).toContain("buildReportDeliveryHandoffReview");
    expect(reportDeliveryRouteSource).toContain("buildReportDeliveryRunInput");
    expect(reportDeliveryRouteSource).toContain("getReportDeliveryPlan");
    expect(reportDeliveryRouteSource).toContain("getReportDeliveryPlans");
    expect(reportDeliveryRouteSource).toContain("Report delivery subscription is paused");
    expect(reportDeliveryRouteSource).toContain("reportDeliveryQueueSchema");
    expect(reportDeliveryRouteSource).toContain("acknowledgeHandoffGaps");
    expect(reportDeliveryRouteSource).toContain("handoffReview");
    expect(reportDeliveryRouteSource).toContain("Only failed report delivery runs can be retried");
    expect(reportDeliveryRouteSource).toContain("errorMessage(error)");
    expect(reportDeliveryServiceSource).toContain("reportDeliverySubscriptions");
    expect(reportDeliveryServiceSource).toContain("reportSuiteProfiles");
    expect(reportDeliveryServiceSource).toContain("reportSuiteHref(suite)");
    expect(reportDeliveryServiceSource).toContain("ReportDeliverySetting");
    expect(reportDeliveryServiceSource).toContain("buildReportDeliveryPlan");
    expect(reportDeliveryServiceSource).toContain("ReportDeliveryPreview");
    expect(reportDeliveryServiceSource).toContain("ReportDeliveryHandoffReview");
    expect(reportDeliveryServiceSource).toContain("buildReportDeliveryHandoffReview");
    expect(reportDeliveryServiceSource).toContain("Report delivery has unresolved handoff gaps");
    expect(reportDeliveryServiceSource).toContain("buildReportDeliveryRunInput");
    expect(reportDeliveryServiceSource).toContain("reportSuites: plan.reportSuites");
    expect(reportDeliveryServiceSource).toContain("suiteTitles");
    expect(reportDeliveryServiceSource).toContain(
      'status?: "queued" | "failed" | "sent" | "cancelled"'
    );
    expect(reportDeliveryServiceSource).toContain("retriedFromRunId");
    expect(reportDeliveryServiceSource).toContain("errorMessage");
    expect(reportDeliveryServiceSource).toContain("buildReportDeliveryNotificationForPlan");
    expect(reportDeliveryServiceSource).toContain("estimateReportDeliveryNextRun");
    expect(reportDeliveryServiceSource).toContain("settingsSource");
    expect(reportDeliveryServiceSource).toContain('status: "ready" | "setup" | "paused"');
    expect(reportDeliveryServiceSource).toContain(
      "const scheduledFor = input.scheduledFor ?? new Date(plan.nextRunAt)"
    );
    expect(reportDeliveryServiceSource).toContain(
      'relatedEntityType: "report_delivery_subscription"'
    );
    expect(reportDeliveryServiceSource).toContain("reportDeliverySubscriptionHref(subscription)");
    expect(schemaSource).toContain("companyReportDeliverySubscriptions");
    expect(schemaSource).toContain("companyReportAutomationPreferences");
    expect(schemaSource).toContain("companyReportDeliveryRuns");
    expect(schemaSource).toContain("companyReportDeliverySchedulerScans");
    expect(schemaSource).toContain("company_report_delivery_subscriptions_unique");
    expect(schemaSource).toContain("company_report_automation_preferences_unique");
    expect(schemaSource).toContain("retriedFromRunId");
    expect(schemaSource).toContain("errorMessage");
    expect(reportDeliveryMigrationSource).toContain(
      'CREATE TABLE IF NOT EXISTS "company_report_delivery_subscriptions"'
    );
    expect(reportDeliveryMigrationSource).toContain(
      'CONSTRAINT "company_report_delivery_subscriptions_unique"'
    );
    expect(reportDeliveryRunsMigrationSource).toContain(
      'CREATE TABLE IF NOT EXISTS "company_report_delivery_runs"'
    );
    expect(reportDeliveryRunsMigrationSource).toContain('"snapshot" jsonb NOT NULL');
    expect(reportDeliveryRunFailuresMigrationSource).toContain('"retried_from_run_id" uuid');
    expect(reportDeliveryRunFailuresMigrationSource).toContain('"error_message" text');
    expect(reportAutomationPreferencesMigrationSource).toContain(
      'CREATE TABLE IF NOT EXISTS "company_report_automation_preferences"'
    );
    expect(reportAutomationPreferencesMigrationSource).toContain(
      '"preferred_delivery_automation_command" text'
    );
    expect(reportAutomationPreferencesMigrationSource).toContain(
      'CONSTRAINT "company_report_automation_preferences_unique"'
    );
    expect(reportDeliverySchedulerScansMigrationSource).toContain(
      'CREATE TABLE IF NOT EXISTS "company_report_delivery_scheduler_scans"'
    );
    expect(reportDeliverySchedulerScansMigrationSource).toContain('"queued_runs" integer');
    expect(storageSource).toContain("getReportDeliverySubscriptionSettings");
    expect(storageSource).toContain("upsertReportDeliverySubscriptionSetting");
    expect(storageSource).toContain("getReportAutomationPreferences");
    expect(storageSource).toContain("upsertReportAutomationPreference");
    expect(storageSource).toContain("getReportDeliveryRuns");
    expect(storageSource).toContain("getReportDeliveryRun");
    expect(storageSource).toContain("createReportDeliveryRun");
    expect(storageSource).toContain("getReportDeliverySchedulerScans");
    expect(storageSource).toContain("createReportDeliverySchedulerScan");
    expect(reportDeliverySchedulerSource).toContain("scanDueReportDeliveries");
    expect(reportDeliverySchedulerSource).toContain("getReportDeliveryScheduleDecision");
    expect(reportDeliverySchedulerSource).toContain("buildReportDeliveryHandoffReview");
    expect(reportDeliverySchedulerSource).toContain("skippedHandoff");
    expect(reportDeliverySchedulerSource).toContain("handoffReviews");
    expect(reportDeliverySchedulerSource).toContain("buildReportDeliveryNotificationForPlan");
    expect(reportDeliverySchedulerSource).toContain("buildReportDeliveryRunInput");
    expect(reportDeliverySchedulerSource).toContain("resolveCompanyActorUserId");
    expect(reportDeliverySchedulerSource).toContain("createAndEmitNotification");
    expect(reportDeliverySchedulerSource).toContain("createReportDeliverySchedulerScan");
    expect(reportDeliverySchedulerSource).toContain('status: "failed"');
    expect(reportDeliverySchedulerSource).toContain("errorMessage: message");
    expect(reportDeliverySchedulerSource).toContain("Failed to queue scheduled report delivery");
    expect(schedulerSource).toContain("scanDueReportDeliveries");
    expect(schedulerSource).toContain("Report delivery subscription scan");
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

    expect(reportAutomationImpactProfiles).toHaveLength(reportPersonas.length);
    for (const profile of reportAutomationImpactProfiles) {
      expect(reportPersonas).toContain(profile.persona);
      expect(profile.reportIds.length).toBeGreaterThanOrEqual(20);
      expect(profile.automationStarterIds.length).toBeGreaterThanOrEqual(2);
      expect(profile.triggerRuleIds.length).toBeGreaterThanOrEqual(3);
      expect(profile.evidence).toHaveLength(3);
      expect(profile.outcomeSignals).toHaveLength(3);

      for (const signal of profile.outcomeSignals) {
        expect(signal.id).toContain(profile.persona);
        expect(signal.label).toBeTruthy();
        expect(signal.currentProxy).toBeTruthy();
        expect(signal.missingCounter).toBeTruthy();
        expect(signal.guardrail).toBeTruthy();
        expect(signal.reportIds.length).toBeGreaterThanOrEqual(1);

        for (const reportId of signal.reportIds) {
          expect(profile.reportIds).toContain(reportId);
        }
      }
    }

    const ownerImpactProfile = reportAutomationImpactProfiles[0]!;
    const ownerImpact = calculateReportAutomationImpact(ownerImpactProfile, {
      readyRuleCount: 3,
      readyDeliveryCount: 2,
      readyReportCount: ownerImpactProfile.reportIds.length,
      openWorkItemCount: 1,
      recommendationCount: 2,
      amountAtRisk: 12000,
    });

    expect(ownerImpact.estimatedMonthlyHoursSaved).toBe(13);
    expect(ownerImpact.estimatedAutomatedItemCount).toBe(33);
    expect(ownerImpact.coverageScore).toBe(97);
    expect(ownerImpact.status).toBe("compounding");
    expect(ownerImpact.amountAtRisk).toBe(12000);
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
      "payroll",
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
    expect(reportsSource).toContain('data-testid="tab-payroll-reports"');
    expect(reportsSource).toContain('data-testid="text-corporate-tax-payable"');

    for (const tab of reportTabs) {
      expect(reportsSource).toContain(`value="${tab}"`);
    }
  });

  it("surfaces current-vs-prior comparison snapshots", () => {
    expect(reportsSource).toContain("Comparison snapshots");
    expect(reportsSource).toContain("Current vs prior period");
    expect(reportsSource).toContain("buildComparisonRanges(dateRange)");
    expect(reportsSource).toContain("reportComparisonPresetSummaries");
    expect(reportsSource).toContain("visibleReportComparisonPresets");
    expect(reportsSource).toContain("data-testid={`report-comparison-preset-${preset.id}`}");
    expect(reportsSource).toContain("Open preset");
    expect(reportsSource).toContain("reportComparisonPresetHref(preset)");

    for (const metricId of [
      "revenue",
      "net-profit",
      "invoice-value",
      "invoice-count",
      "expense-spend",
      "payroll-cost",
      "inventory-movement",
      "consolidated-revenue",
      "consolidated-expenses",
      "consolidated-margin",
      "consolidated-net-profit",
      "vat-due",
      "ledger-activity",
    ]) {
      expect(reportsSource).toContain(`id: "${metricId}"`);
    }

    for (const signal of [
      "Growth",
      "Profitability",
      "Sales activity",
      "Invoice volume",
      "Cost pressure",
      "Payroll movement",
      "Stock movement",
      "Group revenue",
      "Group expenses",
      "Group profitability",
      "Multi-entity roll-up",
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

  it("surfaces report-level favorite pins in the report library", () => {
    expect(reportsSource).toContain("getFavoriteReportIds(personaFilter)");
    expect(reportsSource).toContain("toggleFavoriteReportId(report.id, personaFilter)");
    expect(reportsSource).toContain("favoriteReportIdSet.has(report.id)");
    expect(reportsSource).toContain("favoriteReports");
    expect(reportsSource).toContain('data-testid="favorite-report-shortcuts"');
    expect(reportsSource).toContain('data-testid="favorite-report-shortcuts-empty"');
    expect(reportsSource).toContain("data-testid={`report-library-favorite-${report.id}`}");
    expect(reportsSource).toContain("data-testid={`report-favorite-shortcut-toggle-${report.id}`}");
    expect(reportsSource).toContain("Report pinned");
    expect(reportsSource).toContain("Report unpinned");
    expect(reportsSource).toContain("aFavorite - bFavorite || a.name.localeCompare(b.name)");
  });

  it("surfaces the five product-depth headers and subgoals", () => {
    expect(reportsSource).toContain("Reporting workflow map");
    expect(reportsSource).toContain("visibleReportProductDepthAreas");
    expect(reportsSource).toContain("visibleReportProductDepthSubgoalCount");
    expect(reportsSource).toContain("productDepthStatusMeta");
    expect(reportsSource).toContain("productDepthEvidenceCheckpointStatusMeta");
    expect(reportsSource).toContain("data-testid={`report-product-depth-${area.id}`}");
    expect(reportsSource).toContain("data-testid={`report-product-depth-subgoal-${subgoal.id}`}");
    expect(reportsSource).toContain("data-testid={`report-source-drilldown-target-${target.id}`}");
    expect(reportsSource).toContain("target.personas");
    expect(reportCatalogServiceSource).toContain("sourceDrilldownTargets");
    expect(reportsSource).toContain("data-testid={`report-evidence-checkpoint-${checkpoint.id}`}");
    expect(reportsSource).toContain("data-testid={`report-required-source-record-${record.id}`}");
    expect(reportsSource).toContain("Required source records");
    expect(reportsSource).toContain('data-testid="report-product-depth-count"');
    expect(reportsSource).toContain("Open workflow");
    expect(reportsSource).toContain("Open header");
    expect(catalogSource).toContain("export const reportProductDepthAreas");
    expect(catalogSource).toContain('id: "report-discovery"');
    expect(catalogSource).toContain('id: "role-workflows"');
    expect(catalogSource).toContain('id: "report-automation"');
    expect(catalogSource).toContain('id: "advisory-management"');
    expect(catalogSource).toContain('id: "accounting-data-depth"');
    expect(catalogSource).toContain("sourceDrilldownTargets");
    expect(catalogSource).toContain('id: "ledger-journal-lines"');
    expect(catalogSource).toContain('href: "/journal"');
    expect(catalogSource).toContain('href: "/invoices"');
    expect(catalogSource).toContain('href: "/receipts"');
    expect(reportsSource).toContain('id="audit-trail-title"');
    expect(catalogSource).toContain("evidenceCheckpoints");
    expect(catalogSource).toContain("requiredSourceRecords");
    expect(catalogSource).toContain('id: "tax-filing-payment-ledger"');
    expect(catalogSource).toContain('id: "entity-ownership-register"');
    expect(catalogSource).toContain('status: "missing-source"');
    expect(catalogSource).toContain('status: "guardrail"');
    expect(reportCatalogServiceSource).toContain("productDepthAreas");
    expect(reportCatalogServiceSource).toContain("productDepthAreaCount");
    expect(reportCatalogServiceSource).toContain("productDepthSubgoalCount");
    expect(reportCatalogApiSource).toContain("productDepthAreas: Array");
    expect(reportCatalogApiSource).toContain("productDepthSubgoalCount: number");
  });

  it("filters comparison and automation signals by selected persona", () => {
    expect(reportsSource).toContain("function matchesReportPersona");
    expect(reportsSource).toContain("Role focus");
    expect(reportsSource).toContain("Reporting role focus");
    expect(reportsSource).toContain("Owner / Solo");
    expect(reportsSource).toContain("solo entrepreneurs");
    expect(reportsSource).toContain("Report coverage map");
    expect(reportsSource).toContain("Category-level view of report depth");
    expect(reportsSource).toContain("reportCoverageMap");
    expect(reportsSource).toContain("buildReportCoverageMap(filteredReports)");
    expect(reportsSource).toContain("data-testid={`report-coverage-${categoryId}`}");
    expect(reportsSource).toContain("Decision question, status, comparison mode");
    expect(reportsSource).toContain("{report.decisionQuestion}");
    expect(reportsSource).toContain("Report pack templates");
    expect(reportsSource).toContain("Decision shortcuts");
    expect(reportsSource).toContain("visibleReportDecisionShortcuts");
    expect(reportsSource).toContain("data-testid={`report-decision-shortcut-${shortcut.id}`}");
    expect(reportsSource).toContain("report-decision-shortcut-automation-${shortcut.id}");
    expect(reportsSource).toContain("Open comparison");
    expect(reportsSource).toContain("Open automation");
    expect(reportsSource).toContain("Trigger rules");
    expect(reportsSource).toContain("visibleReportAutomationTriggerRules");
    expect(reportsSource).toContain("data-testid={`report-trigger-rule-${rule.id}`}");
    expect(reportsSource).toContain("triggerSeverityMeta[rule.severity]");
    expect(reportsSource).toContain("Open question");
    expect(reportsSource).toContain("Delivery subscriptions");
    expect(reportsSource).toContain("visibleReportDeliverySubscriptions");
    expect(reportsSource).toContain(
      "data-testid={`report-delivery-subscription-${subscription.id}`}"
    );
    expect(reportsSource).toContain("subscription.deliveryGuardrail");
    expect(reportsSource).toContain("subscription.reportSuites[0]?.title");
    expect(reportsSource).toContain("Open suite");
    expect(reportsSource).toContain("Automation starters");
    expect(reportsSource).toContain("visibleReportAutomationStarters");
    expect(reportsSource).toContain("data-testid={`report-automation-starter-${starter.id}`}");
    expect(reportsSource).toContain("starter.primaryAction");
    expect(reportsSource).toContain("visibleReportPackTemplates");
    expect(reportsSource).toContain("data-testid={`report-pack-template-${template.id}`}");
    expect(reportsSource).toContain("Open template");
    expect(reportsSource).toContain("personaScopeDescription");
    expect(reportsSource).toContain("visibleComparisonRows");
    expect(reportsSource).toContain("visibleAutomationQueue");
    expect(reportsSource).toContain("button-role-focus-${filter.id}");
    expect(reportsSource).toContain("setReportPersonaFilter(filter.id)");
    expect(reportsSource).toContain("comparisonRows.filter(");
    expect(reportsSource).toContain("matchesReportPersona(row.personas, personaFilter) &&");
    expect(reportsSource).toContain("matchesReportWorkflowSearch([");
    expect(reportsSource).toContain(
      "automationQueue.filter((item) => matchesReportPersona(item.personas, personaFilter))"
    );
    expect(reportsSource).toContain('personas: ["accountant"]');
  });

  it("surfaces report-driven automation queues for next actions", () => {
    expect(reportsSource).toContain("Automation queues");
    expect(reportsSource).toContain("Live report signals routed to the next workflow.");
    expect(reportsSource).toContain("Automation coverage");
    expect(reportsSource).toContain("Automation command center");
    expect(reportsSource).toContain("Auto-send readiness across report rules");
    expect(reportsSource).toContain("Auto-send readiness");
    expect(reportsSource).toContain("reportAutomationCommandCenter");
    expect(reportsSource).toContain("automation-command-center");
    expect(reportsSource).toContain("automation-command-center-title");
    expect(reportsSource).toContain("Top blockers");
    expect(reportsSource).toContain("Pack delivery readiness");
    expect(reportsSource).toContain("Ready auto-send");
    expect(reportsSource).toContain("Packs in review");
    expect(reportsSource).toContain("automationCoverageSummary");
    expect(reportsSource).toContain("visibleAutomationCoverage");
    expect(reportsSource).toContain("Role coverage across live reports");
    expect(reportsSource).toContain("Signal coverage");
    expect(reportsSource).toContain("Pack automation");
    expect(reportsSource).toContain("Report automation rules");
    expect(reportsSource).toContain("Role-specific pack rules");
    expect(reportsSource).toContain("reportAutomationRuleReviewCount");
    expect(reportsSource).toContain("Rule signals");
    expect(reportsSource).toContain("automation-coverage-${workspace.persona}");
    expect(reportsSource).toContain("workflowReportCount");
    expect(reportsSource).toContain("comparisonTypeCount");
    expect(reportsSource).toContain("automatedSignalCount");
    expect(reportsSource).toContain("openWorkItemCount");

    for (const queueId of [
      "collections",
      "bill-pay",
      "inventory-risk",
      "inventory-movement-review",
      "receipt-posting",
      "expense-claims-review",
      "payroll-wps-review",
      "vat-readiness",
      "sales-mix",
      "corporate-tax",
      "fixed-asset-review",
      "depreciation-posting",
      "close-review",
      "month-end-close",
      "audit-trail-review",
      "consolidated-statements-review",
      "planning-risk",
    ]) {
      expect(reportsSource).toContain(`id: "${queueId}"`);
    }

    for (const destination of [
      'href: "/payment-chasing"',
      'href: "/bill-pay?tab=summary"',
      'href: "/inventory"',
      'href: "/fixed-assets"',
      'href: "/expense-claims"',
      'href: "/payroll"',
      'href: "/history"',
      'href: "/vat-filing"',
      'tab: "expenses"',
      'tab: "payroll"',
      'tab: "tax"',
      'tab: "close"',
      'tab: "planning"',
    ]) {
      expect(reportsSource).toContain(destination);
    }
    expect(reportsSource).toContain(
      'tab: closeReviewCount > 0 && !trialBalanceSummary.isBalanced ? "trial" : "ledger"'
    );
    expect(reportsSource).toMatch(
      /id: "bill-pay"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "fixed-asset-review"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "depreciation-posting"[\s\S]*?personas: \["freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "expense-claims-review"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "sales-mix"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "corporate-tax"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "inventory-risk"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "payroll-wps-review"[\s\S]*?personas: \["owner", "accountant"\]/
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
      'id: "net-margin"',
      'id: "expense-ratio"',
      'id: "revenue-expense-coverage"',
      'id: "break-even-gap"',
      'id: "invoice-value"',
      'id: "invoice-count"',
      'id: "paid-invoice-share"',
      'id: "average-invoice-value"',
      'id: "liability-asset-ratio"',
      'id: "debt-to-equity-ratio"',
      'id: "burn-rate"',
      'id: "cash-runway-days"',
      'id: "projected-cash-shortfall"',
      'id: "cash-risk-week-count"',
      'id: "operating-cash-flow"',
      'id: "budget-actual-variance"',
      'id: "open-receivables"',
      'id: "open-invoice-count"',
      'id: "average-open-invoice-value"',
      'id: "open-invoice-value-share"',
      'id: "due-soon-invoice-count"',
      'id: "due-soon-invoice-value"',
      'id: "average-due-soon-invoice-value"',
      'id: "due-soon-invoice-share"',
      'id: "open-invoice-share"',
      'id: "overdue-receivables"',
      'id: "overdue-receivable-share"',
      'id: "overdue-invoice-count"',
      'id: "average-overdue-invoice-value"',
      'id: "average-overdue-invoice-days"',
      'id: "overdue-invoice-share"',
      'id: "vendor-bill-value"',
      'id: "vendor-bill-count"',
      'id: "average-bill-value"',
      'id: "top-vendor-share"',
      'id: "paid-bill-share"',
      'id: "open-payables"',
      'id: "open-bill-value-share"',
      'id: "open-cash-gap"',
      'id: "open-cash-coverage"',
      'id: "open-workload-gap"',
      'id: "open-bill-count"',
      'id: "average-open-bill-value"',
      'id: "due-soon-bill-count"',
      'id: "due-soon-bill-value"',
      'id: "average-due-soon-bill-value"',
      'id: "due-soon-bill-share"',
      'id: "due-soon-cash-gap"',
      'id: "due-soon-cash-coverage"',
      'id: "due-soon-workload-gap"',
      'id: "open-bill-share"',
      'id: "overdue-payables"',
      'id: "overdue-cash-gap"',
      'id: "overdue-cash-coverage"',
      'id: "overdue-workload-gap"',
      'id: "overdue-payable-share"',
      'id: "overdue-bill-count"',
      'id: "average-overdue-bill-value"',
      'id: "average-overdue-bill-days"',
      'id: "overdue-bill-share"',
      'id: "working-capital-proxy"',
      'id: "collection-days"',
      'id: "payable-days"',
      'id: "cash-conversion-gap"',
      'id: "top-customer-share"',
      'id: "top-product-service-share"',
      'id: "expense-spend"',
      'id: "receipt-count"',
      'id: "average-receipt-value"',
      'id: "expense-claim-review-value"',
      'id: "expense-claim-review-count"',
      'id: "submitted-expense-claim-count"',
      'id: "submitted-expense-claim-value"',
      'id: "approved-expense-claim-count"',
      'id: "approved-expense-claim-value"',
      'id: "unposted-expense-share"',
      'id: "unposted-receipt-count"',
      'id: "unposted-receipt-value"',
      'id: "auto-posted-receipt-count"',
      'id: "auto-posted-receipt-value"',
      'id: "receipt-automation-coverage"',
      'id: "receipt-automation-value-coverage"',
      'id: "bank-reconciliation-coverage"',
      'id: "reconciled-bank-count"',
      'id: "reconciled-bank-value"',
      'id: "unreconciled-bank-count"',
      'id: "unreconciled-bank-value"',
      'id: "bank-match-suggestion-coverage"',
      'id: "bank-match-suggestion-value-coverage"',
      'id: "suggested-bank-match-count"',
      'id: "bank-assisted-transaction-count"',
      'id: "bank-assisted-transaction-value"',
      'id: "bank-assisted-transaction-coverage"',
      'id: "bank-assisted-transaction-value-coverage"',
      'id: "automation-work-queue-count"',
      'id: "automation-work-queue-value"',
      'id: "ledger-automation-share"',
      'id: "manual-ledger-activity"',
      'id: "automated-ledger-activity"',
      'id: "automation-adoption-index"',
      'id: "automation-value-adoption-index"',
      'id: "cost-center-net-income"',
      'id: "cost-center-expenses"',
      'id: "payroll-cost"',
      'id: "payroll-run-count"',
      'id: "payroll-deduction-share"',
      'id: "average-payroll-run-value"',
      'id: "payroll-covered-employees"',
      'id: "payroll-cost-per-covered-employee"',
      'id: "payroll-approval-queue-count"',
      'id: "payroll-approval-queue-value"',
      'id: "payroll-readiness-queue-count"',
      'id: "payroll-readiness-queue-value"',
      'id: "wps-missing-run-count"',
      'id: "wps-missing-run-value"',
      'id: "payroll-expense-share"',
      'id: "wps-ready-share"',
      'id: "inventory-movement"',
      'id: "inventory-review-items"',
      'id: "inventory-review-share"',
      'id: "inventory-review-value"',
      'id: "fixed-asset-review-items"',
      'id: "fixed-asset-review-share"',
      'id: "fixed-asset-review-value"',
      'id: "depreciation-review-items"',
      'id: "depreciation-review-value"',
      'id: "depreciation-ready-items"',
      'id: "depreciation-ready-share"',
      'id: "depreciation-estimate"',
      'id: "consolidated-revenue"',
      'id: "consolidated-expenses"',
      'id: "consolidated-net-profit"',
      'id: "consolidated-margin"',
      'id: "consolidation-review-items"',
      'id: "month-end-open-checks"',
      'id: "month-end-readiness"',
      'id: "audit-high-risk-event-count"',
      'id: "audit-high-risk-event-share"',
      'id: "audit-review-event-count"',
      'id: "audit-review-event-share"',
      'id: "fx-unrealized-exposure"',
      'id: "manual-ledger-share"',
      'id: "vat-due"',
      'id: "corporate-tax-payable"',
      'id: "total-tax-exposure"',
      'id: "tax-exposure-rate"',
      'id: "tax-reserve-coverage"',
      'id: "tax-funding-gap"',
      'id: "tax-adjusted-runway-days"',
      'id: "ledger-activity"',
    ]) {
      expect(reportsSource).toContain(metric);
    }
    expect(reportsSource).toMatch(
      /id: "depreciation-review-items"[\s\S]*?currentLabel: "Review items"[\s\S]*?previousLabel: "Clear baseline"[\s\S]*?currency: "count"[\s\S]*?signal: "Depreciation setup queue"[\s\S]*?personas: \["freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("depreciationScheduleReport.reviewCount");
    expect(reportsSource).toMatch(
      /id: "depreciation-review-value"[\s\S]*?currentLabel: "Review value"[\s\S]*?previousLabel: "Clear baseline"[\s\S]*?currency: "AED"[\s\S]*?signal: "Depreciable value at review"[\s\S]*?personas: \["freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("depreciationScheduleReport.reviewValueAed");
    expect(reportsSource).toContain(
      "reviewRows.reduce((sum, row) => sum + Math.max(0, row.remainingDepreciable), 0)"
    );
    expect(reportsSource).toMatch(
      /id: "depreciation-ready-items"[\s\S]*?currentLabel: "Ready items"[\s\S]*?previousLabel: "Clear baseline"[\s\S]*?currency: "count"[\s\S]*?signal: "Depreciation posting queue"[\s\S]*?personas: \["freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("depreciationScheduleReport.readyToPostCount");
    expect(reportsSource).toMatch(
      /id: "depreciation-ready-share"[\s\S]*?currentLabel: "Ready share"[\s\S]*?previousLabel: "Ready"[\s\S]*?currency: "%"[\s\S]*?signal: "Depreciation readiness"[\s\S]*?personas: \["freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("depreciationScheduleReport.readyToPostCount");
    expect(reportsSource).toContain(
      "depreciationScheduleReport.readyToPostCount + depreciationScheduleReport.reviewCount"
    );
    expect(reportsSource).toMatch(
      /id: "depreciation-estimate"[\s\S]*?personas: \["freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "revenue"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "net-profit"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "net-margin"[\s\S]*?currency: "%"[\s\S]*?signal: "Profit efficiency"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "expense-ratio"[\s\S]*?currency: "%"[\s\S]*?signal: "Cost efficiency"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "revenue-expense-coverage"[\s\S]*?currency: "%"[\s\S]*?signal: "Revenue covers expenses"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "break-even-gap"[\s\S]*?currency: "AED"[\s\S]*?signal: "Break-even shortfall"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("currentRevenueExpenseCoverage");
    expect(reportsSource).toContain("currentBreakEvenGap");
    expect(reportsSource).toContain("ratioPercent");
    expect(reportsSource).toContain("comparisonCurrentBalanceSheet");
    expect(reportsSource).toContain("comparisonPreviousBalanceSheet");
    expect(reportsSource).toMatch(
      /id: "liability-asset-ratio"[\s\S]*?currency: "%"[\s\S]*?signal: "Balance leverage"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "debt-to-equity-ratio"[\s\S]*?currency: "%"[\s\S]*?signal: "Capital structure"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "paid-invoice-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Collections effectiveness"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "invoice-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Invoice volume"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "average-invoice-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Deal size"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("currentInvoices.length");
    expect(reportsSource).toContain("previousInvoices.length");
    expect(reportsSource).toContain("averageInvoiceValue");
    expect(reportsSource).toContain("paidInvoiceShare");
    expect(reportsSource).toMatch(
      /id: "burn-rate"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "cash-runway-days"[\s\S]*?currency: "days"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "projected-cash-shortfall"[\s\S]*?currentLabel: "Forecast"[\s\S]*?previousLabel: "Zero shortfall"[\s\S]*?currency: "AED"[\s\S]*?signal: "Negative cash risk"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "cash-risk-week-count"[\s\S]*?currentLabel: "Forecast"[\s\S]*?previousLabel: "Clear weeks"[\s\S]*?currency: "count"[\s\S]*?signal: "Forecast risk weeks"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "operating-cash-flow"[\s\S]*?signal: "Cash movement"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("operatingCashFlowForRow");
    expect(reportsSource).toMatch(
      /id: "budget-actual-variance"[\s\S]*?currentLabel: "Actual"[\s\S]*?previousLabel: "Budget"[\s\S]*?signal: "Budget vs actual"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("budgetComparisonLines");
    expect(reportsSource).toContain("varianceReport?.varianceLines");
    expect(reportsSource).toContain('TableHead className="text-right">Baseline</TableHead>');
    expect(reportsSource).toContain("normalizeMonthlyBurn");
    expect(reportsSource).toContain("runwayCoverageDays");
    expect(reportsSource).toContain("cashFlowForecast?.currentBalance");
    expect(reportsSource).toContain("cashForecastProjections");
    expect(reportsSource).toContain("currentProjectedCashShortfall");
    expect(reportsSource).toContain("currentCashRiskWeekCount");
    expect(reportsSource).toMatch(
      /id: "open-receivables"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "open-invoice-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Collections workload"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "average-open-invoice-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Open invoice size"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "open-invoice-value-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Collections value mix"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "due-soon-invoice-count"[\s\S]*?currency: "count"[\s\S]*?signal: "7-day collections queue"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "due-soon-invoice-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "7-day cash collection"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "average-due-soon-invoice-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "7-day invoice size"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "due-soon-invoice-share"[\s\S]*?currency: "%"[\s\S]*?signal: "7-day collections mix"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "open-invoice-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Collections workload mix"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("currentAverageOpenInvoiceValue");
    expect(reportsSource).toContain("previousAverageOpenInvoiceValue");
    expect(reportsSource).toContain("currentRevenueInvoiceValue");
    expect(reportsSource).toContain("previousRevenueInvoiceValue");
    expect(reportsSource).toContain("currentOpenInvoiceValueShare");
    expect(reportsSource).toContain("previousOpenInvoiceValueShare");
    expect(reportsSource).toContain("currentDueSoonReceivableInvoices");
    expect(reportsSource).toContain("previousDueSoonReceivableInvoices");
    expect(reportsSource).toContain("currentDueSoonReceivableValue");
    expect(reportsSource).toContain("currentAverageDueSoonInvoiceValue");
    expect(reportsSource).toContain("previousAverageDueSoonInvoiceValue");
    expect(reportsSource).toContain("currentDueSoonInvoiceShare");
    expect(reportsSource).toContain("previousDueSoonInvoiceShare");
    expect(reportsSource).toContain("dueWithinDaysAfterRangeEnd");
    expect(reportsSource).toMatch(
      /id: "overdue-receivables"[\s\S]*?currency: "AED"[\s\S]*?signal: "A\/R at risk"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "overdue-receivable-share"[\s\S]*?currency: "%"[\s\S]*?signal: "A\/R overdue mix"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "overdue-invoice-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Customer follow-ups"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "average-overdue-invoice-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Overdue invoice size"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "average-overdue-invoice-days"[\s\S]*?currency: "days"[\s\S]*?signal: "Overdue aging"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "overdue-invoice-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Overdue workload mix"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("currentAverageOverdueInvoiceValue");
    expect(reportsSource).toContain("previousAverageOverdueInvoiceValue");
    expect(reportsSource).toContain("currentAverageOverdueInvoiceDays");
    expect(reportsSource).toContain("previousAverageOverdueInvoiceDays");
    expect(reportsSource).toMatch(
      /id: "vendor-bill-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Supplier spend"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "vendor-bill-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Supplier bill volume"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "average-bill-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Supplier bill size"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "top-vendor-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Supplier concentration"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "paid-bill-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Supplier payment coverage"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("currentVendorBillValue");
    expect(reportsSource).toContain("previousVendorBillValue");
    expect(reportsSource).toContain("currentVendorBillDocuments.length");
    expect(reportsSource).toContain("previousVendorBillDocuments.length");
    expect(reportsSource).toContain("currentAverageVendorBillValue");
    expect(reportsSource).toContain("previousAverageVendorBillValue");
    expect(reportsSource).toContain("currentTopVendorShare");
    expect(reportsSource).toContain("previousTopVendorShare");
    expect(reportsSource).toContain("vendorBillPaidAed");
    expect(reportsSource).toContain("currentPaidVendorBillShare");
    expect(reportsSource).toContain("previousPaidVendorBillShare");
    expect(reportsSource).toContain("bill.vendor_name");
    expect(reportsSource).toContain("currentOpenReceivableInvoices.length");
    expect(reportsSource).toContain("previousOpenReceivableInvoices.length");
    expect(reportsSource).toContain("currentOpenInvoiceShare");
    expect(reportsSource).toContain("previousOpenInvoiceShare");
    expect(reportsSource).toContain("currentRevenueInvoices.length");
    expect(reportsSource).toContain("previousRevenueInvoices.length");
    expect(reportsSource).toContain("overdueReceivableRows");
    expect(reportsSource).toContain("currentOverdueReceivableShare");
    expect(reportsSource).toContain("currentOverdueInvoiceCount");
    expect(reportsSource).toContain("currentOverdueInvoiceShare");
    expect(reportsSource).toContain("previousOverdueInvoiceShare");
    expect(reportsSource).toMatch(
      /id: "open-payables"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "open-bill-value-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Bill-pay value mix"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "open-cash-gap"[\s\S]*?currency: "AED"[\s\S]*?signal: "Net unpaid pressure"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "open-cash-coverage"[\s\S]*?currency: "%"[\s\S]*?signal: "Open bill coverage"[\s\S]*?favorable: "increase"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "open-workload-gap"[\s\S]*?currency: "count"[\s\S]*?signal: "Net unpaid workload"[\s\S]*?favorable: "neutral"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "open-bill-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Bill-pay workload"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "average-open-bill-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Open bill size"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "due-soon-bill-count"[\s\S]*?currency: "count"[\s\S]*?signal: "7-day bill-pay queue"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "due-soon-bill-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "7-day cash need"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "average-due-soon-bill-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "7-day bill size"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "due-soon-bill-share"[\s\S]*?currency: "%"[\s\S]*?signal: "7-day bill-pay mix"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "due-soon-cash-gap"[\s\S]*?currency: "AED"[\s\S]*?signal: "7-day net cash need"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "due-soon-cash-coverage"[\s\S]*?currency: "%"[\s\S]*?signal: "7-day bill coverage"[\s\S]*?favorable: "increase"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "due-soon-workload-gap"[\s\S]*?currency: "count"[\s\S]*?signal: "7-day net workload"[\s\S]*?favorable: "neutral"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "open-bill-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Bill-pay workload mix"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("currentVendorBills.length");
    expect(reportsSource).toContain("previousVendorBills.length");
    expect(reportsSource).toContain("currentVendorBillDocuments.length");
    expect(reportsSource).toContain("previousVendorBillDocuments.length");
    expect(reportsSource).toContain("currentOpenCashGap");
    expect(reportsSource).toContain("previousOpenCashGap");
    expect(reportsSource).toContain("currentOpenCashCoverage");
    expect(reportsSource).toContain("previousOpenCashCoverage");
    expect(reportsSource).toContain("currentOpenBillValueShare");
    expect(reportsSource).toContain("previousOpenBillValueShare");
    expect(reportsSource).toContain("currentOpenWorkloadGap");
    expect(reportsSource).toContain("previousOpenWorkloadGap");
    expect(reportsSource).toContain("currentAverageOpenBillValue");
    expect(reportsSource).toContain("previousAverageOpenBillValue");
    expect(reportsSource).toContain("currentDueSoonBills");
    expect(reportsSource).toContain("previousDueSoonBills");
    expect(reportsSource).toContain("currentDueSoonBillValue");
    expect(reportsSource).toContain("currentAverageDueSoonBillValue");
    expect(reportsSource).toContain("previousAverageDueSoonBillValue");
    expect(reportsSource).toContain("currentDueSoonBillShare");
    expect(reportsSource).toContain("previousDueSoonBillShare");
    expect(reportsSource).toContain("currentDueSoonCashGap");
    expect(reportsSource).toContain("previousDueSoonCashGap");
    expect(reportsSource).toContain("currentDueSoonCashCoverage");
    expect(reportsSource).toContain("previousDueSoonCashCoverage");
    expect(reportsSource).toContain("currentDueSoonWorkloadGap");
    expect(reportsSource).toContain("previousDueSoonWorkloadGap");
    expect(reportsSource).toContain("currentOpenBillShare");
    expect(reportsSource).toContain("previousOpenBillShare");
    expect(reportsSource).toMatch(
      /id: "overdue-payables"[\s\S]*?currency: "AED"[\s\S]*?signal: "A\/P at risk"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "overdue-cash-gap"[\s\S]*?currency: "AED"[\s\S]*?signal: "Net overdue pressure"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "overdue-cash-coverage"[\s\S]*?currency: "%"[\s\S]*?signal: "Overdue bill coverage"[\s\S]*?favorable: "increase"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "overdue-workload-gap"[\s\S]*?currency: "count"[\s\S]*?signal: "Net overdue workload"[\s\S]*?favorable: "neutral"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "overdue-payable-share"[\s\S]*?currency: "%"[\s\S]*?signal: "A\/P overdue mix"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("currentOverdueCashGap");
    expect(reportsSource).toContain("previousOverdueCashGap");
    expect(reportsSource).toContain("currentOverdueCashCoverage");
    expect(reportsSource).toContain("previousOverdueCashCoverage");
    expect(reportsSource).toContain("currentOverdueWorkloadGap");
    expect(reportsSource).toContain("previousOverdueWorkloadGap");
    expect(reportsSource).toMatch(
      /id: "overdue-bill-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Vendor follow-ups"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "average-overdue-bill-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Overdue bill size"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "average-overdue-bill-days"[\s\S]*?currency: "days"[\s\S]*?signal: "Overdue aging"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "overdue-bill-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Overdue bill mix"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("currentAverageOverdueBillValue");
    expect(reportsSource).toContain("previousAverageOverdueBillValue");
    expect(reportsSource).toContain("currentAverageOverdueBillDays");
    expect(reportsSource).toContain("previousAverageOverdueBillDays");
    expect(reportsSource).toContain("averageDaysOverdue");
    expect(reportsSource).toContain("overduePayableRows");
    expect(reportsSource).toContain("currentOverduePayableShare");
    expect(reportsSource).toContain("currentOverdueBillCount");
    expect(reportsSource).toContain("currentOverdueBillShare");
    expect(reportsSource).toContain("previousOverdueBillShare");
    expect(reportsSource).toMatch(
      /id: "working-capital-proxy"[\s\S]*?signal: "A\/R less A\/P"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "collection-days"[\s\S]*?currency: "days"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "payable-days"[\s\S]*?currency: "days"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "cash-conversion-gap"[\s\S]*?currency: "days"[\s\S]*?signal: "DSO less DPO"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("vendorBillOutstandingAed");
    expect(reportsSource).toContain("vendorBillTotalAed");
    expect(reportsSource).toContain('if (row.currency === "days")');
    expect(reportsSource).toContain('queryKey: ["/api/companies", selectedCompanyId, "bills"]');
    expect(reportsSource).toMatch(
      /id: "top-customer-share"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "top-product-service-share"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "unposted-expense-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Bookkeeping backlog"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "receipt-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Receipt workload"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "average-receipt-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Receipt size"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "unposted-receipt-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Posting queue"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "unposted-receipt-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Posting value"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "expense-claim-review-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Claims queue"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "expense-claim-review-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Claims awaiting review"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "submitted-expense-claim-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Claim approvals"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "submitted-expense-claim-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Claim approval value"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "approved-expense-claim-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Reimbursement follow-up"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "approved-expense-claim-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Reimbursement value"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("expenseClaimReviewRows");
    expect(reportsSource).toContain("submittedExpenseClaimRows");
    expect(reportsSource).toContain("submittedExpenseClaimValue");
    expect(reportsSource).toContain("approvedExpenseClaimRows");
    expect(reportsSource).toContain("approvedExpenseClaimValue");
    expect(reportsSource).toContain("expenseClaimReviewValue");
    expect(reportsSource).toContain("currentAverageReceiptValue");
    expect(reportsSource).toContain("previousAverageReceiptValue");
    expect(reportsSource).toContain("currentReceipts.length");
    expect(reportsSource).toContain("previousReceipts.length");
    expect(reportsSource).toContain("currentExpenseClaimReviewCount");
    expect(reportsSource).toContain("currentSubmittedExpenseClaimCount");
    expect(reportsSource).toContain("previousSubmittedExpenseClaimCount");
    expect(reportsSource).toContain("currentSubmittedExpenseClaimValue");
    expect(reportsSource).toContain("previousSubmittedExpenseClaimValue");
    expect(reportsSource).toContain("currentApprovedExpenseClaimCount");
    expect(reportsSource).toContain("previousApprovedExpenseClaimCount");
    expect(reportsSource).toContain("currentApprovedExpenseClaimValue");
    expect(reportsSource).toContain("previousApprovedExpenseClaimValue");
    expect(reportsSource).toContain("currentExpenseClaims");
    expect(reportsSource).toContain("unpostedReceiptRows");
    expect(reportsSource).toContain("currentUnpostedReceiptCount");
    expect(reportsSource).toContain("currentUnpostedReceiptValue");
    expect(reportsSource).toContain("previousUnpostedReceiptValue");
    expect(reportsSource).toContain("unpostedExpenseShare");
    expect(reportsSource).toMatch(
      /id: "auto-posted-receipt-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Receipts automated"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "auto-posted-receipt-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Automated expense value"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("autoPostedReceiptRows");
    expect(reportsSource).toContain("autoPostedReceiptValue");
    expect(reportsSource).toContain("currentAutoPostedReceiptCount");
    expect(reportsSource).toContain("previousAutoPostedReceiptCount");
    expect(reportsSource).toContain("currentAutoPostedReceiptValue");
    expect(reportsSource).toContain("previousAutoPostedReceiptValue");
    expect(reportsSource).toMatch(
      /id: "receipt-automation-coverage"[\s\S]*?currency: "%"[\s\S]*?signal: "Auto-post coverage"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("receiptAutomationCoverage");
    expect(reportsSource).toMatch(
      /id: "receipt-automation-value-coverage"[\s\S]*?currency: "%"[\s\S]*?signal: "Auto-posted value"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("receiptAutomationValueCoverage");
    expect(reportsSource).toContain("currentReceiptAutomationValueCoverage");
    expect(reportsSource).toMatch(
      /id: "bank-reconciliation-coverage"[\s\S]*?currency: "%"[\s\S]*?signal: "Bank automation coverage"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "reconciled-bank-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Bank transactions cleared"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "reconciled-bank-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Bank value cleared"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "unreconciled-bank-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Bank review queue"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "unreconciled-bank-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Bank value at review"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "bank-match-suggestion-coverage"[\s\S]*?currency: "%"[\s\S]*?signal: "Suggested match coverage"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "bank-match-suggestion-value-coverage"[\s\S]*?currency: "%"[\s\S]*?signal: "Suggested match value"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "suggested-bank-match-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Review-ready matches"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "bank-assisted-transaction-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Bank work assisted"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "bank-assisted-transaction-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Assisted bank value"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "bank-assisted-transaction-coverage"[\s\S]*?currency: "%"[\s\S]*?signal: "Bank work coverage"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "bank-assisted-transaction-value-coverage"[\s\S]*?currency: "%"[\s\S]*?signal: "Assisted bank value coverage"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "automation-work-queue-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Action queue"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "automation-work-queue-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Queue value"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /const currentAutomationWorkQueueCount =[\s\S]*?currentOverdueInvoiceCount[\s\S]*?currentDueSoonReceivableInvoices\.length[\s\S]*?currentOverdueBillCount[\s\S]*?currentDueSoonBills\.length/
    );
    expect(reportsSource).toMatch(
      /const currentAutomationWorkQueueValue =[\s\S]*?currentOverdueReceivableValue[\s\S]*?currentDueSoonReceivableValue[\s\S]*?currentOverduePayableValue[\s\S]*?currentDueSoonBillValue/
    );
    expect(reportsSource).toMatch(
      /id: "ledger-automation-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Ledger automation coverage"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "manual-ledger-activity"[\s\S]*?currency: "AED"[\s\S]*?signal: "Manual ledger value"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "automated-ledger-activity"[\s\S]*?currency: "AED"[\s\S]*?signal: "Automated ledger value"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "automation-adoption-index"[\s\S]*?currency: "%"[\s\S]*?signal: "Automation adoption"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "automation-value-adoption-index"[\s\S]*?currency: "%"[\s\S]*?signal: "Automation value adoption"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("bankReconciliationCoverage");
    expect(reportsSource).toContain("reconciledBankTransactionRows");
    expect(reportsSource).toContain("currentReconciledBankCount");
    expect(reportsSource).toContain("previousReconciledBankCount");
    expect(reportsSource).toContain("currentReconciledBankValue");
    expect(reportsSource).toContain("previousReconciledBankValue");
    expect(reportsSource).toContain("currentUnreconciledBankCount");
    expect(reportsSource).toContain("bankTransactionReviewValue");
    expect(reportsSource).toContain("currentUnreconciledBankValue");
    expect(reportsSource).toContain("bankSuggestedMatchRows");
    expect(reportsSource).toContain("currentBankMatchSuggestionCoverage");
    expect(reportsSource).toContain("currentSuggestedBankMatchValue");
    expect(reportsSource).toContain("currentBankMatchSuggestionValueCoverage");
    expect(reportsSource).toContain("currentSuggestedBankMatchCount");
    expect(reportsSource).toContain("bankAssistedTransactionRows");
    expect(reportsSource).toContain("bankAssistedTransactionValue");
    expect(reportsSource).toContain("currentBankAssistedTransactionCount");
    expect(reportsSource).toContain("previousBankAssistedTransactionCount");
    expect(reportsSource).toContain("currentBankAssistedTransactionValue");
    expect(reportsSource).toContain("previousBankAssistedTransactionValue");
    expect(reportsSource).toContain("currentBankAssistedTransactionCoverage");
    expect(reportsSource).toContain("previousBankAssistedTransactionCoverage");
    expect(reportsSource).toContain("currentBankAssistedTransactionValueCoverage");
    expect(reportsSource).toContain("previousBankAssistedTransactionValueCoverage");
    expect(reportsSource).toContain("unpostedReceiptValue");
    expect(reportsSource).toContain("currentAutomationWorkQueueCount");
    expect(reportsSource).toContain("currentAutomationWorkQueueValue");
    expect(reportsSource).toContain("averageAvailablePercent");
    expect(reportsSource).toContain("currentLedgerAutomationShare");
    expect(reportsSource).toContain("previousLedgerAutomationShare");
    expect(reportsSource).toContain("currentManualLedgerActivity");
    expect(reportsSource).toContain("previousManualLedgerActivity");
    expect(reportsSource).toContain("automatedLedgerActivity");
    expect(reportsSource).toContain("currentAutomatedLedgerActivity");
    expect(reportsSource).toContain("previousAutomatedLedgerActivity");
    expect(reportsSource).toContain("bankAssistedTransactionCoverage");
    expect(reportsSource).toContain("bankAssistedTransactionValueCoverage");
    expect(reportsSource).toContain("currentLedgerAutomationCoverage");
    expect(reportsSource).toContain("currentAutomationAdoptionIndex");
    expect(reportsSource).toContain("currentAutomationValueAdoptionIndex");
    expect(reportsSource).toContain(
      'queryKey: ["/api/companies", selectedCompanyId, "bank-statements", "transactions"]'
    );
    expect(reportsSource).toContain("comparisonCurrentSalesProductService");
    expect(reportsSource).toContain("comparisonPreviousSalesProductService");
    expect(reportsSource).toContain("comparisonPreviousCorporateTaxEstimate");
    expect(reportsSource).toContain("corporateTaxPreviousParams");
    expect(reportsSource).toMatch(
      /id: "corporate-tax-payable"[\s\S]*?signal: "Tax exposure"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "total-tax-exposure"[\s\S]*?signal: "VAT plus corporate tax"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "tax-exposure-rate"[\s\S]*?currency: "%"[\s\S]*?signal: "Tax load"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "tax-reserve-coverage"[\s\S]*?currentLabel: "Current cash"[\s\S]*?previousLabel: "Fully funded"[\s\S]*?currency: "%"[\s\S]*?signal: "Tax cash coverage"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "tax-funding-gap"[\s\S]*?currentLabel: "Current gap"[\s\S]*?previousLabel: "Zero gap"[\s\S]*?currency: "AED"[\s\S]*?signal: "Tax cash gap"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "tax-adjusted-runway-days"[\s\S]*?currentLabel: "After tax reserve"[\s\S]*?previousLabel: "Before tax reserve"[\s\S]*?currency: "days"[\s\S]*?signal: "Post-tax runway"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("currentTotalTaxExposure");
    expect(reportsSource).toContain("previousTotalTaxExposure");
    expect(reportsSource).toContain("currentTaxExposureRate");
    expect(reportsSource).toContain("currentAvailableTaxCash");
    expect(reportsSource).toContain("currentTaxReserveNeed");
    expect(reportsSource).toContain("currentTaxReserveCoverage");
    expect(reportsSource).toContain("currentTaxFundingGap");
    expect(reportsSource).toContain("currentTaxAdjustedRunwayDays");
    expect(reportsSource).toContain("formatComparisonValue(row, row.current, locale)");
    expect(reportsSource).toContain("formatComparisonExportValue(row, row.current)");
    expect(reportsSource).toMatch(
      /id: "inventory-movement"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "inventory-review-items"[\s\S]*?currentLabel: "Review items"[\s\S]*?previousLabel: "Clear baseline"[\s\S]*?currency: "count"[\s\S]*?signal: "Stock review queue"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("inventoryValuationReport.reviewCount");
    expect(reportsSource).toMatch(
      /id: "inventory-review-share"[\s\S]*?currentLabel: "Review share"[\s\S]*?previousLabel: "Clear baseline"[\s\S]*?currency: "%"[\s\S]*?signal: "Stock review mix"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("inventoryValuationReport.activeProductCount");
    expect(reportsSource).toMatch(
      /id: "inventory-review-value"[\s\S]*?currentLabel: "Review value"[\s\S]*?previousLabel: "Clear baseline"[\s\S]*?currency: "AED"[\s\S]*?signal: "Stock value at review"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("inventoryValuationReport.reviewValueAed");
    expect(reportsSource).toMatch(
      /id: "fixed-asset-review-items"[\s\S]*?currentLabel: "Review items"[\s\S]*?previousLabel: "Clear baseline"[\s\S]*?currency: "count"[\s\S]*?signal: "Asset review queue"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("fixedAssetRegisterReport.reviewCount");
    expect(reportsSource).toMatch(
      /id: "fixed-asset-review-share"[\s\S]*?currentLabel: "Review share"[\s\S]*?previousLabel: "Clear baseline"[\s\S]*?currency: "%"[\s\S]*?signal: "Asset review mix"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("fixedAssetRegisterReport.activeRows.length");
    expect(reportsSource).toMatch(
      /id: "fixed-asset-review-value"[\s\S]*?currentLabel: "Review value"[\s\S]*?previousLabel: "Clear baseline"[\s\S]*?currency: "AED"[\s\S]*?signal: "Asset value at review"[\s\S]*?personas: \["owner", "freelancer", "accountant"\]/
    );
    expect(reportsSource).toContain("fixedAssetRegisterReport.reviewValueAed");
    expect(reportsSource).toMatch(
      /id: "consolidated-revenue"[\s\S]*?currency: "AED"[\s\S]*?signal: "Group revenue"[\s\S]*?personas: \["accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "consolidated-expenses"[\s\S]*?currency: "AED"[\s\S]*?signal: "Group expenses"[\s\S]*?personas: \["accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "consolidated-margin"[\s\S]*?currency: "%"[\s\S]*?signal: "Group profitability"[\s\S]*?personas: \["accountant"\]/
    );
    expect(reportsSource).toContain("currentConsolidatedMargin");
    expect(reportsSource).toContain("previousConsolidatedMargin");
    expect(reportsSource).toContain("consolidatedStatementsReport.currentComparisonRevenue");
    expect(reportsSource).toContain("consolidatedStatementsReport.previousRevenue");
    expect(reportsSource).toContain("consolidatedStatementsReport.currentComparisonExpenses");
    expect(reportsSource).toContain("consolidatedStatementsReport.previousExpenses");
    expect(reportsSource).toMatch(
      /id: "month-end-open-checks"[\s\S]*?currentLabel: "Open checks"[\s\S]*?previousLabel: "Clear baseline"[\s\S]*?currency: "count"[\s\S]*?signal: "Close checklist"[\s\S]*?personas: \["accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "consolidation-review-items"[\s\S]*?currentLabel: "Review items"[\s\S]*?previousLabel: "Clear baseline"[\s\S]*?currency: "count"[\s\S]*?signal: "Consolidation review queue"[\s\S]*?personas: \["accountant"\]/
    );
    expect(reportsSource).toContain("consolidatedStatementsReport.reviewCount");
    expect(reportsSource).toMatch(
      /id: "month-end-readiness"[\s\S]*?currentLabel: "Checklist"[\s\S]*?previousLabel: "Ready"[\s\S]*?currency: "%"[\s\S]*?signal: "Close readiness"[\s\S]*?personas: \["accountant"\]/
    );
    expect(reportsSource).toContain("currentMonthEndOpenChecks");
    expect(reportsSource).toContain("currentMonthEndReadiness");
    expect(reportsSource).toContain("monthEndChecklistItems");
    expect(reportsSource).toContain("monthEndCloseStatus?.checklist");
    expect(reportsSource).toMatch(
      /id: "audit-high-risk-event-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Risky audit activity"[\s\S]*?personas: \["accountant"\]/
    );
    expect(reportsSource).toContain("currentHighRiskActivityCount");
    expect(reportsSource).toContain('activityLogRiskLevel(log) === "High"');
    expect(reportsSource).toMatch(
      /id: "audit-high-risk-event-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Risky activity mix"[\s\S]*?personas: \["accountant"\]/
    );
    expect(reportsSource).toContain("currentHighRiskActivityShare");
    expect(reportsSource).toContain("previousHighRiskActivityShare");
    expect(reportsSource).toContain("currentActivityLogs.length");
    expect(reportsSource).toContain("previousActivityLogs.length");
    expect(reportsSource).toMatch(
      /id: "audit-review-event-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Audit review workload"[\s\S]*?personas: \["accountant"\]/
    );
    expect(reportsSource).toContain("currentReviewActivityCount");
    expect(reportsSource).toContain("previousReviewActivityCount");
    expect(reportsSource).toContain('activityLogRiskLevel(log) !== "Low"');
    expect(reportsSource).toMatch(
      /id: "audit-review-event-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Audit review mix"[\s\S]*?personas: \["accountant"\]/
    );
    expect(reportsSource).toContain("currentReviewActivityShare");
    expect(reportsSource).toContain("previousReviewActivityShare");
    expect(reportsSource).toMatch(
      /id: "fx-unrealized-exposure"[\s\S]*?currentLabel: "Exposure"[\s\S]*?previousLabel: "Clear baseline"[\s\S]*?currency: "AED"[\s\S]*?signal: "FX exposure at review"[\s\S]*?personas: \["accountant"\]/
    );
    expect(reportsSource).toContain("currentFxUnrealizedExposure");
    expect(reportsSource).toContain("fxGainsLosses?.totalUnrealizedGain");
    expect(reportsSource).toContain("fxGainsLosses?.totalUnrealizedLoss");
    expect(reportsSource).toMatch(
      /id: "manual-ledger-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Manual source coverage"[\s\S]*?personas: \["accountant"\]/
    );
    expect(reportsSource).toContain("ledgerActivityBreakdownForRange");
    expect(reportsSource).toContain("currentManualLedgerShare");
    expect(reportsSource).toContain("manualActivity");
    expect(reportsSource).toContain('if (row.currency === "count")');
    expect(reportsSource).toMatch(
      /id: "cost-center-net-income"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "cost-center-expenses"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toMatch(/id: "payroll-cost"[\s\S]*?personas: \["owner", "accountant"\]/);
    expect(reportsSource).toMatch(
      /id: "payroll-run-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Payroll run volume"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("currentPayrollRuns.length");
    expect(reportsSource).toContain("previousPayrollRuns.length");
    expect(reportsSource).toMatch(
      /id: "payroll-deduction-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Gross-to-net payroll"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("currentPayrollDeductionShare");
    expect(reportsSource).toContain("previousPayrollDeductionShare");
    expect(reportsSource).toContain("run.total_basic");
    expect(reportsSource).toContain("run.total_allowances");
    expect(reportsSource).toContain("run.total_deductions");
    expect(reportsSource).toMatch(
      /id: "average-payroll-run-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Payroll run size"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("currentAveragePayrollRunValue");
    expect(reportsSource).toContain("previousAveragePayrollRunValue");
    expect(reportsSource).toMatch(
      /id: "payroll-covered-employees"[\s\S]*?currency: "count"[\s\S]*?signal: "Payroll headcount"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("currentPayrollCoveredEmployees");
    expect(reportsSource).toMatch(
      /id: "payroll-cost-per-covered-employee"[\s\S]*?currency: "AED"[\s\S]*?signal: "Payroll unit cost"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("currentPayrollCostPerCoveredEmployee");
    expect(reportsSource).toContain("previousPayrollCostPerCoveredEmployee");
    expect(reportsSource).toMatch(
      /id: "payroll-approval-queue-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Payroll approvals"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("currentPayrollApprovalQueueCount");
    expect(reportsSource).toContain("previousPayrollApprovalQueueCount");
    expect(reportsSource).toMatch(
      /id: "payroll-approval-queue-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Payroll approval value"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("payrollApprovalQueueRows");
    expect(reportsSource).toContain("payrollApprovalQueueValue");
    expect(reportsSource).toContain("currentPayrollApprovalQueueValue");
    expect(reportsSource).toContain("previousPayrollApprovalQueueValue");
    expect(reportsSource).toMatch(
      /id: "payroll-readiness-queue-count"[\s\S]*?currency: "count"[\s\S]*?signal: "Payroll approvals and WPS"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("currentPayrollReadinessQueueCount");
    expect(reportsSource).toMatch(
      /id: "payroll-readiness-queue-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "Payroll readiness value"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("currentPayrollReadinessQueueValue");
    expect(reportsSource).toContain("previousPayrollReadinessQueueValue");
    expect(reportsSource).toContain("currentPayrollApprovalQueueValue + currentWpsMissingRunValue");
    expect(reportsSource).toContain('run.status === "calculated"');
    expect(reportsSource).toContain("!run.sif_file_content");
    expect(reportsSource).toMatch(
      /id: "wps-missing-run-count"[\s\S]*?currency: "count"[\s\S]*?signal: "WPS file gap"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("currentWpsMissingRunCount");
    expect(reportsSource).toContain("previousWpsMissingRunCount");
    expect(reportsSource).toMatch(
      /id: "wps-missing-run-value"[\s\S]*?currency: "AED"[\s\S]*?signal: "WPS file value gap"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("wpsMissingRunRows");
    expect(reportsSource).toContain("wpsMissingRunValue");
    expect(reportsSource).toContain("currentWpsMissingRunValue");
    expect(reportsSource).toContain("previousWpsMissingRunValue");
    expect(reportsSource).toMatch(
      /id: "payroll-expense-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Payroll burden"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toMatch(
      /id: "wps-ready-share"[\s\S]*?currency: "%"[\s\S]*?signal: "Payroll file readiness"[\s\S]*?personas: \["owner", "accountant"\]/
    );
    expect(reportsSource).toContain("wpsReadyShare");
    expect(reportsSource).toContain('run.status === "calculated" || run.status === "approved"');
  });
});
