import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  reportAutomationTriggerRuleHref,
  reportAutomationTriggerRules,
  buildReportAutomationHealthTrend,
  calculateReportAutomationHealth,
  liveReportCatalog,
  parseReportAutomationHealthHistory,
  REPORT_AUTOMATION_HEALTH_HISTORY_KEY,
  parseReportPersona,
  reportAutomationPlaybookHref,
  reportAutomationStarterHref,
  reportAutomationStarters,
  reportComparisonPresetHref,
  reportComparisonPresets,
  reportDecisionShortcutHref,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportCatalog,
  reportPackTemplateHref,
  reportPackTemplates,
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
    "Expense Claims",
  ];

  it("keeps the Reports catalog at 32 live high-level reports", () => {
    expect(liveReportCatalog).toHaveLength(32);

    for (const label of expectedLiveReports) {
      expect(liveReportCatalog.map((report) => report.name)).toContain(label);
    }

    for (const report of liveReportCatalog) {
      expect(report.decisionQuestion).toBeTruthy();
      expect(report.decisionQuestion).toMatch(/\?$/);
      expect(report.decisionQuestion.length).toBeGreaterThan(25);
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
    expect(commandSource).toContain("fetchReportCatalogDiscovery");
    expect(commandSource).toContain("reportCatalogDiscoveryQueryKey(null)");
    expect(commandSource).toContain("syncedReportCatalog?.reports ?? liveReportCatalog");
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
    expect(commandSource).toContain("commandLiveReports.map");
    expect(commandSource).toContain("id: `report-${report.id}`");
    expect(commandSource).toContain(
      "href: report.href ?? reportHref({ href: undefined, tab: report.tab })"
    );
    expect(commandSource).toContain(
      "description: `${report.category} · ${report.comparison} · ${report.automation}`"
    );
    expect(commandSource).toContain("report.decisionQuestion");
    expect(commandSource).toContain("useDefaultCompany");
    expect(commandSource).toContain("useQueryClient");
    expect(commandSource).toContain("CommandPaletteReportDeliveryRun");
    expect(commandSource).toContain("commandReportDeliveryRunsQuery");
    expect(commandSource).toContain("commandFailedDeliveryRuns");
    expect(commandSource).toContain("queueReportDeliveryFromPalette");
    expect(commandSource).toContain("id: `report-queue-delivery-${subscription.id}`");
    expect(commandSource).toContain("/report-delivery/subscriptions/${subscriptionId}/queue");
    expect(commandSource).toContain(
      "description: `Send ${subscription.channel} pack to ${subscription.recipients}`"
    );
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
    expect(dashboardSource).toContain("getPreferredReportPersona() ??");
    expect(dashboardSource).toContain("getPreferredReportWorkflowSearch");
    expect(dashboardSource).toContain("dashboardReportWorkflowSearchScore");
    expect(dashboardSource).toContain("normalizedPreferredReportWorkflowSearch");
    expect(dashboardSource).toContain("searchScore");
    expect(dashboardSource).toContain(".sort((a, b) => b.searchScore - a.searchScore");
    expect(dashboardSource).toContain('data-testid="dashboard-report-search-context"');
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
    expect(dashboardSource).toContain("syncedLiveReports");
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
    expect(dashboardSource).toContain("dashboardReportDeliveryRunsQuery");
    expect(dashboardSource).toContain("/report-delivery/runs?limit=30");
    expect(dashboardSource).toContain("retryDashboardReportDeliveryRun");
    expect(dashboardSource).toContain("/report-delivery/runs/${runId}/retry");
    expect(dashboardSource).toContain("dashboardPersonaDeliveryRuns");
    expect(dashboardSource).toContain("dashboardLatestDeliveryRun");
    expect(dashboardSource).toContain("dashboardLatestDeliveryRunSubscription");
    expect(dashboardSource).toContain("dashboardReportDeliveryLauncherPreviewById");
    expect(dashboardSource).toContain("Record<string, ReportLaunchDeliveryPreview | undefined>");
    expect(dashboardSource).toContain("latestRunId: latestRun?.id");
    expect(dashboardSource).toContain("latestRunDetail: latestRun");
    expect(dashboardSource).toContain("latestRunError:");
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
    expect(dashboardSource).toContain("reportHref(report) ?? reportWorkspaceHref");
    expect(dashboardSource).toContain("reportAutomationPlaybookHref(");
    expect(dashboardSource).toContain("preferredAutomationNextAction.href");
    expect(dashboardSource).toContain("preferredAutomationNextAction.cta");
    expect(dashboardSource).toContain("preferredReportWorkspace.packSchedule.cadence");
    expect(dashboardSource).toContain("preferredReportWorkspace.packSchedule.delivery");
    expect(dashboardSource).toContain("preferredReportWorkspace.packSchedule.automation");
    expect(dashboardSource).toContain("preferredReportWorkspace.automationOutcome");
    expect(catalogSource).toContain("REPORT_PERSONA_PREFERENCE_KEY");
    expect(catalogSource).toContain("REPORT_WORKFLOW_SEARCH_PREFERENCE_KEY");
    expect(catalogSource).toContain("REPORT_DELIVERY_AUTOMATION_COMMAND_KEY");
    expect(catalogSource).toContain("getPreferredReportPersona");
    expect(catalogSource).toContain("setPreferredReportPersona");
    expect(catalogSource).toContain("clearPreferredReportPersona");
    expect(catalogSource).toContain("reportWorkflowSearchPreferenceKey");
    expect(catalogSource).toContain("getPreferredReportWorkflowSearch");
    expect(catalogSource).toContain("setPreferredReportWorkflowSearch");
    expect(catalogSource).toContain("clearPreferredReportWorkflowSearch");
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
    expect(mobileNavSource).toContain("reportPersonaWorkspaces.map");
    expect(mobileNavSource).toContain("interface MoreLink");
    expect(mobileNavSource).toContain("description?: string");
    expect(mobileNavSource).toContain("workspace.navLabel");
    expect(mobileNavSource).toContain("workspace.automationNavLabel");
    expect(mobileNavSource).toContain("description: workspace.focus");
    expect(mobileNavSource).toContain("description: workspace.automationOutcome");
    expect(mobileNavSource).toContain("description: workspace.packSchedule.automation");
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
    expect(sidebarSource).toContain("reportPersonaWorkspaces.map");
    expect(sidebarSource).toContain("description?: string");
    expect(sidebarSource).toContain("item.description");
    expect(sidebarSource).toContain("reportWorkspaceHref(workspace)");
    expect(sidebarSource).toContain("description: workspace.focus");
    expect(sidebarSource).toContain('reportSectionHref(workspace, "automation-operations")');
    expect(sidebarSource).toContain("Report operations - ${workspace.title}");
    expect(sidebarSource).toContain("description: workspace.automationOutcome");
    expect(sidebarSource).toContain("report-automation-operations-${workspace.persona}");
    expect(sidebarSource).toContain('reportSectionHref(workspace, "automation-command-center")');
    expect(sidebarSource).toContain("description: workspace.packSchedule.automation");
    expect(sidebarSource).toContain("reportDecisionShortcuts.map");
    expect(sidebarSource).toContain("reportDecisionShortcutHref(shortcut)");
    expect(sidebarSource).toContain("description: shortcut.answer");
    expect(sidebarSource).toContain("reportAutomationTriggerRules.map");
    expect(sidebarSource).toContain("reportAutomationTriggerRuleHref(rule)");
    expect(sidebarSource).toContain("description: `${rule.condition} - ${rule.actionLabel}`");
    expect(sidebarSource).toContain("reportDeliverySubscriptions.map");
    expect(sidebarSource).toContain("reportDeliverySubscriptionHref(subscription)");
    expect(sidebarSource).toContain(
      "description: `${subscription.cadence} - ${subscription.channel}`"
    );
    expect(sidebarSource).toContain("reportAutomationStarters.map");
    expect(sidebarSource).toContain("reportAutomationStarterHref(starter)");
    expect(sidebarSource).toContain("description: `${starter.audience} - ${starter.outcome}`");
    expect(sidebarSource).toContain("reportPackTemplates.map");
    expect(sidebarSource).toContain("reportPackTemplateHref(template)");
    expect(sidebarSource).toContain("description: `${template.cadence} - ${template.delivery}`");
    expect(sidebarSource).toContain("reportComparisonPresets.map");
    expect(sidebarSource).toContain("reportComparisonPresetHref(preset)");
    expect(sidebarSource).toContain(
      "description: `${preset.baseline} - ${preset.automationTrigger}`"
    );
    expect(sidebarSource).toContain('className={item.description ? "h-auto min-h-10 py-1.5"');
    expect(sidebarSource).toContain("testId: `report-pack-template-${template.id}`");
    expect(sidebarSource).toContain("testId: `report-decision-shortcut-${shortcut.id}`");
    expect(sidebarSource).toContain("testId: `report-trigger-rule-${rule.id}`");
    expect(sidebarSource).toContain("testId: `report-delivery-subscription-${subscription.id}`");
    expect(sidebarSource).toContain("testId: `report-automation-starter-${starter.id}`");
    expect(sidebarSource).toContain("testId: `report-comparison-preset-${preset.id}`");
    expect(sidebarSource).toContain("reportWorkspaceTitleKeys[workspace.persona]");
    expect(sidebarSource).toContain("reportAutomationCenterTitleKeys[workspace.persona]");
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
    expect(reportsSource).toContain("updateReportWorkflowSearch");
    expect(reportsSource).toContain("clearReportWorkflowSearch");
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
    expect(commandSource).toContain('reportSectionHref(workspace, "automation-operations")');
    expect(commandSource).toContain('reportSectionHref(workspace, "decision-shortcuts")');
    expect(commandSource).toContain('reportSectionHref(workspace, "recommendations")');
    expect(commandSource).toContain('reportSectionHref(workspace, "automation-starters")');
    expect(commandSource).toContain('reportSectionHref(workspace, "trigger-rules")');
    expect(commandSource).toContain('reportSectionHref(workspace, "delivery-subscriptions")');
    expect(commandSource).toContain('reportSectionHref(workspace, "pack-readiness")');
    expect(commandSource).toContain('reportSectionHref(workspace, "automation-rules")');
    expect(commandSource).toContain('reportSectionHref(workspace, "automation-command-center")');
    expect(commandSource).toContain('reportSectionHref(workspace, "pack-automation")');
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
    expect(commandSource).toContain("id: `report-automation-operations-${workspace.persona}`");
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
    expect(commandSource).toContain("Decision shortcuts - ${workspace.title}");
    expect(commandSource).toContain("Trigger rules - ${workspace.title}");
    expect(commandSource).toContain("Delivery subscriptions - ${workspace.title}");
    expect(commandSource).toContain("Automation starters - ${workspace.title}");
    expect(commandSource).toContain("Recommended reports - ${workspace.title}");
    expect(commandSource).toContain("Report pack readiness - ${workspace.title}");
    expect(commandSource).toContain("Report automation rules - ${workspace.title}");
    expect(commandSource).toContain("Automation command center - ${workspace.title}");
    expect(commandSource).toContain("Report pack automation - ${workspace.title}");

    for (const workspace of reportPersonaWorkspaces) {
      expect(reportSectionHref(workspace, "workflow-finder")).toBe(
        `/reports?tab=${workspace.primaryTab}&persona=${workspace.persona}#report-workflow-finder-title`
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
      "invoice-value",
      "expense-spend",
      "vat-due",
      "payroll-cost",
      "inventory-movement",
      "depreciation-estimate",
      "consolidated-net-profit",
      "ledger-activity",
    ]);
    expect(reportDecisionShortcuts).toHaveLength(9);
    expect(reportAutomationTriggerRules).toHaveLength(9);
    expect(reportDeliverySubscriptions).toHaveLength(6);
    expect(reportAutomationStarters).toHaveLength(6);
    expect(reportPackTemplates).toHaveLength(6);
    expect(reportComparisonPresets).toHaveLength(6);

    for (const workspace of reportPersonaWorkspaces) {
      expect(
        reportDecisionShortcuts.filter((shortcut) => shortcut.persona === workspace.persona)
      ).toHaveLength(3);
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
      ).toHaveLength(2);
    }

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
  });

  it("keeps persona automation playbooks tied to real reports and workflows", () => {
    expect(reportsSource).toContain("Automation playbooks");
    expect(reportsSource).toContain("Report automation rules");
    expect(reportsSource).toContain("reportAutomationRules");
    expect(reportsSource).toContain("visibleReportAutomationRules");
    expect(reportsSource).toContain("automation-rule-${rule.id}");
    expect(reportsSource).toContain("Review before auto-send");
    expect(reportsSource).toContain("Ready to auto-send");
    expect(reportsSource).toContain("workspace.automations.length");
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
    expect(reportsSource).toContain("Report automation operations");
    expect(reportsSource).toContain("fetchReportCatalogDiscovery");
    expect(reportsSource).toContain(
      "reportCatalogDiscoveryQueryKey(reportCatalogDiscoveryPersona)"
    );
    expect(reportsSource).toContain("type ReportCatalogDiscovery");
    expect(reportsSource).toContain("reportCatalogDiscoveryQuery");
    expect(reportsSource).toContain("syncedReportCatalogSummary");
    expect(reportsSource).toContain("syncedReportPersonaSummaries");
    expect(reportsSource).toContain("reportWorkflowSearch");
    expect(reportsSource).toContain("normalizedReportWorkflowSearch");
    expect(reportsSource).toContain("matchesReportWorkflowSearch");
    expect(reportsSource).toContain("ReportWorkflowCoverageCue");
    expect(reportsSource).toContain("ReportWorkflowCoverageContext");
    expect(reportsSource).toContain("buildReportWorkflowCoverageCues");
    expect(reportsSource).toContain("reportIdsOverlap");
    expect(reportsSource).toContain("allReportWorkflowFinderResults");
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
    expect(reportsSource).toContain('id="report-workflow-finder"');
    expect(reportsSource).toContain('data-testid="input-report-workflow-search"');
    expect(reportsSource).toContain('data-testid="report-workflow-finder-count"');
    expect(reportsSource).toContain("data-testid={`report-workflow-finder-result-${result.id}`}");
    expect(reportsSource).toContain("data-testid={`report-workflow-coverage-${result.id}`}");
    expect(reportsSource).toContain(
      "data-testid={`report-workflow-coverage-${result.id}-${cue.id}`}"
    );
    expect(reportsSource).toContain('data-testid="report-workflow-finder-empty"');
    expect(reportsSource).toContain("Search reports, packs, comparisons, automations");
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
    expect(reportsSource).toContain('data-testid="report-workflow-readiness"');
    expect(reportsSource).toContain("report-workflow-readiness-${item.workspace.persona}");
    expect(reportsSource).toContain("report-workflow-readiness-gap-${item.workspace.persona}");
    expect(reportsSource).toContain("report-workflow-readiness-action-${item.workspace.persona}");
    expect(reportsSource).toContain("Automation readiness");
    expect(reportsSource).toContain("Role-specific coverage gaps before report packs");
    expect(reportsSource).toContain("report-automation-operations-${workspace.persona}");
    expect(reportsSource).toContain("report-automation-operations-title");
    expect(reportsSource).toContain("Recover failed delivery");
    expect(reportsSource).toContain("Open command center");
    expect(reportsSource).toContain("Open delivery");
    expect(reportsSource).toContain("report-delivery-subscription-${subscription.id}");
    expect(reportsSource).toContain("Open subscription");
    expect(reportsSource).toContain("queueReportDeliverySubscription");
    expect(reportsSource).toContain("/report-delivery/subscriptions/${subscriptionId}/queue");
    expect(reportsSource).toContain("saveReportDeliverySubscriptionSettings");
    expect(reportsSource).toContain("/report-delivery/subscriptions/${subscriptionId}/settings");
    expect(reportsSource).toContain("reportDeliveryPlansQuery");
    expect(reportsSource).toContain("reportDeliveryRunsQuery");
    expect(reportsSource).toContain("reportDeliverySchedulerHealthQuery");
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
    expect(reportsSource).toContain("queueReportDeliverySubscription.mutate(subscriptionId)");
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
    expect(reportsSource).toContain("packSummary,\n      operationsControl");
    expect(reportsSource).toContain('reportSectionHref(workspace, "automation-operations")');
    expect(reportsSource).toContain("reportHref(report) ?? reportWorkspaceHref(workspace)");
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
    expect(exportSource).toContain("Expense Claims Summary");
    expect(exportSource).toContain("Expense Claims Detail");
    expect(expenseClaimsRouteSource).toContain("/api/companies/:companyId/expense-claims");
    expect(expenseClaimsRouteSource).toContain("/api/companies/:companyId/expense-claims/summary");
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
    expect(reportCatalogServiceSource).toContain("const personaSummaries = workspaces.map");
    expect(reportCatalogServiceSource).toContain("personaReports");
    expect(reportCatalogServiceSource).toContain("personaComparisonPresets");
    expect(reportCatalogServiceSource).toContain("automationCommandCenterHref");
    expect(reportCatalogServiceSource).toContain("liveReportCount");
    expect(reportCatalogServiceSource).toContain("reportHref(report)");
    expect(reportCatalogServiceSource).toContain("reportWorkspaceHref(workspace)");
    expect(reportCatalogServiceSource).toContain(
      'reportSectionHref(workspace, "automation-operations")'
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
    expect(reportCatalogApiSource).toContain("ReportCatalogDiscoverySummary");
    expect(reportCatalogApiSource).toContain("ReportPersonaCatalogSummary");
    expect(reportCatalogApiSource).toContain("personaSummaries: ReportPersonaCatalogSummary[]");
    expect(reportCatalogApiSource).toContain("comparisonPresetCount: number");
    expect(reportCatalogApiSource).toContain("automationPlaybookCount: number");
    expect(reportCatalogApiSource).toContain("recommendationsHref: string");
    expect(reportCatalogApiSource).toContain("triggerRulesHref: string");
    expect(reportCatalogApiSource).toContain("automationRulesHref: string");
    expect(reportCatalogApiSource).toContain("automationCommandCenterHref: string");
    expect(reportCatalogApiSource).toContain("packAutomationHref: string");
    expect(reportCatalogApiSource).toContain("ReportCatalogDiscovery");
    expect(reportCatalogApiSource).toContain("reportCatalogDiscoveryQueryKey");
    expect(reportCatalogApiSource).toContain("reportCatalogDiscoveryPath");
    expect(reportCatalogApiSource).toContain("fetchReportCatalogDiscovery");
    expect(reportCatalogApiSource).toContain('"/api/reports/catalog"');
    expect(reportCatalogApiSource).toContain("new URLSearchParams({ persona })");
    expect(reportLaunchPickerSource).toContain("fetchReportCatalogDiscovery");
    expect(reportLaunchPickerSource).toContain("reportCatalogDiscoveryQueryKey(selectedPersona)");
    expect(reportLaunchPickerSource).toContain("reportCatalog");
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
    expect(reportLaunchPickerSource).toContain("getPreferredReportWorkflowSearch");
    expect(reportLaunchPickerSource).toContain("setPreferredReportWorkflowSearch");
    expect(reportLaunchPickerSource).toContain("setQuery(getPreferredReportWorkflowSearch");
    expect(reportLaunchPickerSource).toContain("updateLauncherQuery");
    expect(reportLaunchPickerSource).toContain("reportLaunchWorkflowSearchScore");
    expect(reportLaunchPickerSource).toContain("rankReportLaunchItems");
    expect(reportLaunchPickerSource).toContain("searchScore");
    expect(reportLaunchPickerSource).toContain("matchesReportLaunchWorkflowSearch");
    expect(reportLaunchPickerSource).toContain("matchesLauncherQuery");
    expect(reportLaunchPickerSource).toContain("visibleShortcuts");
    expect(reportLaunchPickerSource).toContain("visibleStarters");
    expect(reportLaunchPickerSource).toContain("visibleDeliverySubscriptions");
    expect(reportLaunchPickerSource).toContain("visibleComparisonPresets");
    expect(reportLaunchPickerSource).toContain("visiblePackTemplates");
    expect(reportLaunchPickerSource).toContain('reportSectionHref(workspace, "workflow-finder")');
    expect(reportLaunchPickerSource).toContain("workflowFinderHref");
    expect(reportLaunchPickerSource).toContain("matchingAutomationPackHref");
    expect(reportLaunchPickerSource).toContain("matchingAutomationPackLabel");
    expect(reportLaunchPickerSource).toContain(
      "visibleDeliverySubscriptions[0] ?? deliverySubscriptions[0]"
    );
    expect(reportLaunchPickerSource).toContain(
      "visibleComparisonPresets[0] ?? comparisonPresets[0]"
    );
    expect(reportLaunchPickerSource).toContain("deliveryPreview?.summary");
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
    expect(reportLaunchPickerSource).toContain('data-testid="report-launch-search-context"');
    expect(reportLaunchPickerSource).toContain('data-testid="report-launch-context-actions"');
    expect(reportLaunchPickerSource).toContain('data-testid="report-launch-open-workflow-finder"');
    expect(reportLaunchPickerSource).toContain('data-testid="report-launch-open-matching-pack"');
    expect(reportLaunchPickerSource).toContain("report-launch-persona-${item}");
    expect(reportLaunchPickerSource).toContain("report-launch-report-${report.id}");
    expect(reportLaunchPickerSource).toContain(
      "report-launch-delivery-subscription-${subscription.id}"
    );
    expect(reportLaunchPickerSource).toContain("report-launch-delivery-preview-${subscription.id}");
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
    expect(reportDeliveryRouteSource).toContain("buildReportDeliveryRunInput");
    expect(reportDeliveryRouteSource).toContain("getReportDeliveryPlan");
    expect(reportDeliveryRouteSource).toContain("getReportDeliveryPlans");
    expect(reportDeliveryRouteSource).toContain("Report delivery subscription is paused");
    expect(reportDeliveryRouteSource).toContain("Only failed report delivery runs can be retried");
    expect(reportDeliveryRouteSource).toContain("errorMessage(error)");
    expect(reportDeliveryServiceSource).toContain("reportDeliverySubscriptions");
    expect(reportDeliveryServiceSource).toContain("ReportDeliverySetting");
    expect(reportDeliveryServiceSource).toContain("buildReportDeliveryPlan");
    expect(reportDeliveryServiceSource).toContain("ReportDeliveryPreview");
    expect(reportDeliveryServiceSource).toContain("buildReportDeliveryRunInput");
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
      "expense-spend",
      "payroll-cost",
      "inventory-movement",
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
      "Cost pressure",
      "Payroll movement",
      "Stock movement",
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
      'id: "payroll-cost"',
      'id: "inventory-movement"',
      'id: "depreciation-estimate"',
      'id: "consolidated-net-profit"',
      'id: "vat-due"',
      'id: "ledger-activity"',
    ]) {
      expect(reportsSource).toContain(metric);
    }
  });
});
