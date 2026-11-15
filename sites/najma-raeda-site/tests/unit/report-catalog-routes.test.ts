import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import {
  reportAutomationImpactProfiles,
  reportCatalog,
  reportManagementBriefProfiles,
  reportPersonas,
  reportProductDepthAreas,
  reportQuickAccessProfiles,
  reportSavedViewProfiles,
  reportSuiteProfiles,
} from "../../client/src/lib/reportCatalog";
import { buildReportCatalogDiscovery } from "../../server/services/report-catalog.service";

vi.mock("../../server/db", () => ({
  db: {},
  pool: { query: vi.fn() },
}));

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = {
      id: "22222222-2222-4222-8222-222222222222",
      email: "owner@example.com",
      isAdmin: false,
      userType: "customer",
    };
    next();
  },
}));

vi.mock("../../server/storage", () => ({
  storage: {
    hasCompanyAccess: vi.fn(async () => true),
  },
}));

import { registerReportRoutes } from "../../server/routes/reports.routes";
import { storage } from "../../server/storage";

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerReportRoutes(app);
  return app;
}

async function callReportCatalogRoute(
  app: express.Express,
  path: string
): Promise<{ status: number; body: any }> {
  const url = new URL(path, "http://local.test");
  const route = (app as any)._router.stack.find(
    (layer: any) => layer.route?.path === "/api/reports/catalog"
  )?.route;
  if (!route) throw new Error("report catalog route not registered");

  const handlers = route.stack.map((layer: any) => layer.handle);
  let handlerIndex = 0;
  const req: any = {
    method: "GET",
    url: url.pathname + url.search,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: {},
  };
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    set(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    json(body: any) {
      this.body = body;
      resolveResult();
      return this;
    },
  };

  let resolveResult: () => void = () => {};
  let rejectResult: (error: unknown) => void = () => {};
  const result = new Promise<void>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const next = (error?: unknown) => {
    if (error) {
      rejectResult(error);
      return;
    }
    const handler = handlers[handlerIndex++];
    if (!handler) {
      resolveResult();
      return;
    }
    try {
      handler(req, res, next);
    } catch (handlerError) {
      rejectResult(handlerError);
    }
  };

  next();
  await result;

  return { status: res.statusCode, body: res.body };
}

describe("report catalog discovery route", () => {
  beforeEach(() => {
    vi.mocked(storage.hasCompanyAccess).mockClear();
  });

  it("builds deep-linked catalog metadata from the shared report catalog", () => {
    const discovery = buildReportCatalogDiscovery();

    expect(discovery.summary.liveReportCount).toBe(33);
    expect(discovery.summary.apiReportCount).toBe(0);
    expect(discovery.summary.readyReportCount).toBe(33);
    expect(discovery.summary.reportCount).toBe(reportCatalog.length);
    expect(discovery.summary.deliverySubscriptionCount).toBe(6);
    expect(discovery.summary.automationStarterCount).toBe(6);
    expect(discovery.summary.triggerRuleCount).toBe(9);
    expect(discovery.summary.decisionShortcutCount).toBe(12);
    expect(discovery.summary.reportSuiteCount).toBe(reportSuiteProfiles.length);
    expect(discovery.summary.managementBriefCount).toBe(reportManagementBriefProfiles.length);
    expect(discovery.summary.quickAccessProfileCount).toBe(reportQuickAccessProfiles.length);
    expect(discovery.summary.savedViewCount).toBe(reportSavedViewProfiles.length);
    expect(discovery.summary.automationImpactProfileCount).toBe(
      reportAutomationImpactProfiles.length
    );
    expect(discovery.summary.productDepthAreaCount).toBe(reportProductDepthAreas.length);
    expect(discovery.summary.productDepthSubgoalCount).toBe(
      reportProductDepthAreas.reduce((total, area) => total + area.subgoals.length, 0)
    );
    expect(discovery.summary.workflowStepCount).toBe(12);
    expect(discovery.summary.automationRunbookStepCount).toBe(27);
    expect(discovery.personas).toEqual(reportPersonas);
    expect(discovery.personaSummaries).toHaveLength(3);
    expect(discovery.personaSummaries[0]).toMatchObject({
      persona: "owner",
      automationPlaybookCount: 3,
      apiReportCount: 0,
      readyReportCount: discovery.personaSummaries[0].reportCount,
      plannedReportCount: 0,
    });
    expect(discovery.personaSummaries[0].reportCount).toBeGreaterThan(20);
    expect(discovery.personaSummaries[0].liveReportCount).toBeGreaterThan(20);
    for (const summary of discovery.personaSummaries) {
      expect(summary.reportCount).toBeGreaterThanOrEqual(20);
      expect(summary.liveReportCount).toBeGreaterThanOrEqual(20);
      expect(summary.readyReportCount).toBe(summary.liveReportCount + summary.apiReportCount);
      expect(summary.plannedReportCount).toBe(0);
    }
    const accountantSummary = discovery.personaSummaries.find(
      (summary) => summary.persona === "accountant"
    );
    const freelancerSummary = discovery.personaSummaries.find(
      (summary) => summary.persona === "freelancer"
    );
    expect(accountantSummary?.apiReportCount).toBe(0);
    expect(freelancerSummary?.apiReportCount).toBe(0);
    expect(discovery.personaSummaries[0].comparisonPresetCount).toBeGreaterThanOrEqual(3);
    expect(discovery.personaSummaries[0].reportSuiteCount).toBe(2);
    expect(discovery.personaSummaries[0].managementBriefCount).toBe(1);
    expect(discovery.personaSummaries[0].quickAccessProfileCount).toBe(1);
    expect(discovery.personaSummaries[0].savedViewCount).toBe(3);
    expect(discovery.personaSummaries[0].automationImpactProfileCount).toBe(1);
    expect(discovery.personaSummaries[0].productDepthSubgoalCount).toBeGreaterThan(0);
    expect(discovery.personaSummaries[0].setupStepCount).toBe(4);
    expect(discovery.personaSummaries[0].workflowStepCount).toBe(4);
    expect(discovery.personaSummaries[0].automationRunbookStepCount).toBe(9);
    expect(discovery.personaSummaries[0].roleSetupHref).toContain("#report-role-setup-title");
    expect(discovery.personaSummaries[0].roleWorkflowsHref).toContain(
      "#report-role-workflows-title"
    );
    expect(discovery.personaSummaries[0].operationsHref).toContain(
      "#report-automation-operations-title"
    );
    expect(discovery.personaSummaries[0].automationCommandCenterHref).toContain(
      "#automation-command-center-title"
    );
    expect(discovery.reports.every((report) => report.href)).toBe(true);
    expect(discovery.workspaces).toHaveLength(3);
    expect(discovery.workspaces[0].roleSetupHref).toContain("#report-role-setup-title");
    expect(discovery.workspaces[0].roleWorkflowsHref).toContain("#report-role-workflows-title");
    expect(discovery.workspaces[0].managementBriefsHref).toContain(
      "#report-management-briefs-title"
    );
    expect(discovery.workspaces[0].setupChecklist).toHaveLength(4);
    expect(discovery.workspaces[0].setupChecklist[0].href).toContain("#");
    expect(discovery.workspaces[0].workflowSteps).toHaveLength(4);
    expect(discovery.workspaces[0].workflowSteps[0].href).toContain("#report-role-workflow-step-");
    expect(discovery.workspaces[0].workflowSteps[0].sectionHref).toContain("#");
    expect(discovery.workspaces[0].workflowSteps[0].defaultViewHref).toContain(
      "#report-saved-view-"
    );
    expect(discovery.workspaces[0].workflowSteps[0].defaultViewLabel).toBeTruthy();
    expect(discovery.workspaces[0].workflowSteps[0].handoffRecipients).toBeTruthy();
    expect(discovery.workspaces[0].workflowSteps[0].handoffGuardrail).toBeTruthy();
    expect(discovery.workspaces[0].automations[0].runbookSteps).toHaveLength(3);
    expect(discovery.workspaces[0].automations[0].runbookSteps.map((step) => step.phase)).toEqual([
      "signal",
      "review",
      "deliver",
    ]);
    expect(discovery.workspaces[0].automations[0].runbookSteps[0].href).toContain("/reports");
    expect(discovery.workspaces[0].operationsHref).toContain("#report-automation-operations-title");
    expect(discovery.workspaces[0].reportSuitesHref).toContain("#report-suites-title");
    expect(discovery.workspaces[0].quickAccessHref).toContain("#report-quick-access-title");
    expect(discovery.workspaces[0].savedViewsHref).toContain("#report-saved-views-title");
    expect(discovery.workspaces[0].automationImpactHref).toContain(
      "#report-automation-impact-title"
    );
    expect(discovery.workspaces[0].recommendationsHref).toContain("#recommended-reports-title");
    expect(discovery.workspaces[0].triggerRulesHref).toContain("#trigger-rules-title");
    expect(discovery.workspaces[0].automationRulesHref).toContain("#report-automation-rules-title");
    expect(discovery.workspaces[0].automationCommandCenterHref).toContain(
      "#automation-command-center-title"
    );
    expect(discovery.workspaces[0].packAutomationHref).toContain("#report-pack-automation-title");
    expect(discovery.deliverySubscriptions[0].href).toContain("#report-delivery-subscription-");
    expect(discovery.reportSuites[0].href).toContain("#report-suite-");
    expect(discovery.reportSuites[0].deliverySubscriptionId).toBeTruthy();
    expect(discovery.reportSuites[0].triggerRuleIds.length).toBeGreaterThan(0);
    expect(discovery.reportSuites[0].decisionShortcutId).toBeTruthy();
    expect(discovery.managementBriefs).toHaveLength(reportManagementBriefProfiles.length);
    expect(discovery.managementBriefs[0].href).toContain("#report-management-brief-");
    expect(discovery.managementBriefs[0].kpiMetricIds.length).toBeGreaterThan(0);
    expect(discovery.managementBriefs[0].kpiWidgets).toHaveLength(4);
    expect(discovery.managementBriefs[0].narrativeSections).toHaveLength(3);
    expect(discovery.quickAccessProfiles[0].href).toContain("#report-quick-access-title");
    expect(discovery.savedViews[0].href).toContain("#report-saved-view-");
    expect(discovery.automationImpactProfiles[0].href).toContain("#report-automation-impact-title");
    expect(discovery.automationImpactProfiles[0].outcomeSignals).toHaveLength(3);
    expect(discovery.automationImpactProfiles[0].outcomeSignals[0].missingCounter).toBeTruthy();
    expect(discovery.productDepthAreas).toHaveLength(5);
    expect(discovery.productDepthAreas[0].href).toContain("#report-product-depth-");
    expect(discovery.productDepthAreas[0].subgoals[0].href).toContain(
      "#report-product-depth-subgoal-"
    );
    expect(discovery.productDepthAreas[0].subgoals[0].href).toContain("productDepth=");
    const discoverySourceDrilldowns = discovery.productDepthAreas
      .flatMap((area: any) => area.subgoals)
      .find((subgoal: any) => subgoal.id === "source-drilldowns");
    expect(discoverySourceDrilldowns.sourceDrilldownTargets).toHaveLength(4);
    expect(
      discoverySourceDrilldowns.sourceDrilldownTargets.map((target: any) => target.href)
    ).toEqual(
      expect.arrayContaining([
        "/journal",
        "/invoices",
        "/receipts",
        "/reports?tab=close&persona=accountant#audit-trail-title",
      ])
    );
    const dataDepthArea = discovery.productDepthAreas.find(
      (area: any) => area.id === "accounting-data-depth"
    );
    expect(
      dataDepthArea?.subgoals.every((subgoal: any) => subgoal.evidenceCheckpoints.length)
    ).toBe(true);
    expect(
      dataDepthArea?.subgoals.every((subgoal: any) => subgoal.requiredSourceRecords.length === 3)
    ).toBe(true);
    expect(
      dataDepthArea?.subgoals[0].evidenceCheckpoints.map((checkpoint: any) => checkpoint.status)
    ).toEqual(["current-proxy", "missing-source", "guardrail"]);
    expect(discovery.reportActionContexts.length).toBeGreaterThan(
      discovery.summary.liveReportCount
    );
    const costCenterReport = discovery.reports.find(
      (report) => report.id === "cost-center-profitability"
    );
    expect(costCenterReport).toMatchObject({
      name: "Cost Center P&L",
      status: "live",
      href: "/cost-centers",
      personas: ["owner", "accountant"],
    });
    const ownerCostCenterContext = discovery.reportActionContexts.find(
      (context) => context.reportId === "cost-center-profitability" && context.persona === "owner"
    );
    expect(ownerCostCenterContext?.reportHref).toBe("/cost-centers");
    expect(ownerCostCenterContext?.quickAccessHref).toContain("#report-quick-access-title");
    expect(ownerCostCenterContext?.automationImpactHref).toContain(
      "#report-automation-impact-title"
    );
    expect(ownerCostCenterContext?.automationStarters.map((starter) => starter.id)).toContain(
      "owner-tax-spend-autopilot"
    );
    expect(ownerCostCenterContext?.comparisonPresets.map((preset) => preset.id)).toContain(
      "owner-profit-cash-movement"
    );
    expect(ownerCostCenterContext?.triggerRules.map((rule) => rule.id)).toContain(
      "owner-spend-variance-alert"
    );
    expect(
      ownerCostCenterContext?.deliverySubscriptions.map((subscription) => subscription.id)
    ).toContain("owner-tax-deadline-delivery");

    for (const report of reportCatalog.filter((item) => item.status === "live")) {
      for (const persona of report.personas) {
        const context = discovery.reportActionContexts.find(
          (item) => item.reportId === report.id && item.persona === persona
        );
        expect(context).toBeTruthy();
        expect(context?.reportHref).toBeTruthy();
        if (report.tab) {
          expect(context?.reportHref).toContain(`tab=${report.tab}`);
          expect(context?.reportHref).toContain(`report=${report.id}`);
          expect(context?.reportHref).toContain(`persona=${persona}`);
        }
        expect(context?.workspaceHref).toContain("persona=");
        expect(context?.workflowHref).toContain("workflowSearch=");
        expect(context?.quickAccessHref).toContain("#report-quick-access-title");
        expect(context?.automationImpactHref).toContain("#report-automation-impact-title");
        expect(context?.automationStarters.length).toBeGreaterThan(0);
        expect(context?.deliverySubscriptions.length).toBeGreaterThan(0);
        expect(context?.comparisonPresets.length).toBeGreaterThan(0);
      }
    }
  });

  it("returns persona-filtered catalog metadata without requiring company access", async () => {
    const res = await callReportCatalogRoute(
      appWithRoutes(),
      "/api/reports/catalog?persona=freelancer"
    );

    expect(res.status).toBe(200);
    expect(res.body.filters.persona).toBe("freelancer");
    expect(res.body.personas).toEqual(reportPersonas);
    expect(res.body.summary.reportCount).toBe(res.body.reports.length);
    expect(res.body.summary.liveReportCount).toBeGreaterThanOrEqual(20);
    expect(res.body.summary.apiReportCount).toBe(0);
    expect(res.body.summary.readyReportCount).toBe(res.body.summary.liveReportCount);
    expect(res.body.personaSummaries).toHaveLength(1);
    expect(res.body.personaSummaries[0]).toMatchObject({
      persona: "freelancer",
      reportCount: res.body.summary.reportCount,
      liveReportCount: res.body.summary.liveReportCount,
      apiReportCount: res.body.summary.apiReportCount,
      readyReportCount: res.body.summary.readyReportCount,
      plannedReportCount: 0,
      workflowStepCount: 4,
      automationRunbookStepCount: 9,
      automationPlaybookCount: 3,
    });
    expect(res.body.personaSummaries[0].decisionShortcutCount).toBeGreaterThan(0);
    expect(res.body.personaSummaries[0].packTemplateCount).toBeGreaterThan(0);
    expect(res.body.personaSummaries[0].comparisonPresetCount).toBeGreaterThanOrEqual(3);
    expect(res.body.personaSummaries[0].reportSuiteCount).toBe(2);
    expect(res.body.personaSummaries[0].managementBriefCount).toBe(1);
    expect(res.body.personaSummaries[0].quickAccessProfileCount).toBe(1);
    expect(res.body.personaSummaries[0].savedViewCount).toBe(3);
    expect(res.body.personaSummaries[0].automationImpactProfileCount).toBe(1);
    expect(res.body.personaSummaries[0].productDepthSubgoalCount).toBeGreaterThan(0);
    expect(res.body.personaSummaries[0].setupStepCount).toBe(4);
    expect(res.body.personaSummaries[0].workflowStepCount).toBe(4);
    expect(res.body.personaSummaries[0].automationRunbookStepCount).toBe(9);
    expect(res.body.personaSummaries[0].roleSetupHref).toContain(
      "persona=freelancer#report-role-setup-title"
    );
    expect(res.body.personaSummaries[0].roleWorkflowsHref).toContain(
      "persona=freelancer#report-role-workflows-title"
    );
    expect(res.body.personaSummaries[0].managementBriefsHref).toContain(
      "persona=freelancer#report-management-briefs-title"
    );
    expect(res.body.reports.map((report: any) => report.id)).toEqual(
      expect.arrayContaining([
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
      ])
    );
    expect(res.body.personaSummaries[0].automationCommandCenterHref).toContain(
      "persona=freelancer#automation-command-center-title"
    );
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0]).toMatchObject({
      persona: "freelancer",
      href: "/reports?tab=sales&persona=freelancer",
    });
    expect(res.body.workspaces[0].roleSetupHref).toContain(
      "persona=freelancer#report-role-setup-title"
    );
    expect(res.body.workspaces[0].roleWorkflowsHref).toContain(
      "persona=freelancer#report-role-workflows-title"
    );
    expect(res.body.workspaces[0].managementBriefsHref).toContain(
      "persona=freelancer#report-management-briefs-title"
    );
    expect(res.body.workspaces[0].setupChecklist).toHaveLength(4);
    expect(res.body.workspaces[0].setupChecklist[0].href).toContain(
      "persona=freelancer#report-quick-access-title"
    );
    expect(res.body.workspaces[0].workflowSteps).toHaveLength(4);
    expect(res.body.workspaces[0].workflowSteps[0].href).toContain(
      "persona=freelancer#report-role-workflow-step-"
    );
    expect(res.body.workspaces[0].workflowSteps[0].sectionHref).toContain(
      "persona=freelancer#report-quick-access-title"
    );
    expect(res.body.workspaces[0].workflowSteps[0].defaultViewHref).toContain(
      "persona=freelancer#report-saved-view-"
    );
    expect(res.body.workspaces[0].workflowSteps[0].defaultViewLabel).toContain("Freelancer");
    expect(res.body.workspaces[0].workflowSteps[0].handoffRecipients).toBeTruthy();
    expect(res.body.workspaces[0].workflowSteps[0].handoffGuardrail).toBeTruthy();
    expect(res.body.workspaces[0].automations[0].runbookSteps).toHaveLength(3);
    expect(
      res.body.workspaces[0].automations[0].runbookSteps.map((step: any) => step.phase)
    ).toEqual(["signal", "review", "deliver"]);
    expect(res.body.workspaces[0].automations[0].runbookSteps[0].href).toContain(
      "persona=freelancer"
    );
    expect(res.body.workspaces[0].operationsHref).toContain(
      "persona=freelancer#report-automation-operations-title"
    );
    expect(res.body.workspaces[0].reportSuitesHref).toContain(
      "persona=freelancer#report-suites-title"
    );
    expect(res.body.workspaces[0].quickAccessHref).toContain(
      "persona=freelancer#report-quick-access-title"
    );
    expect(res.body.workspaces[0].savedViewsHref).toContain(
      "persona=freelancer#report-saved-views-title"
    );
    expect(res.body.workspaces[0].automationImpactHref).toContain(
      "persona=freelancer#report-automation-impact-title"
    );
    expect(res.body.workspaces[0].recommendationsHref).toContain(
      "persona=freelancer#recommended-reports-title"
    );
    expect(res.body.workspaces[0].triggerRulesHref).toContain(
      "persona=freelancer#trigger-rules-title"
    );
    expect(res.body.workspaces[0].automationRulesHref).toContain(
      "persona=freelancer#report-automation-rules-title"
    );
    expect(res.body.workspaces[0].automationCommandCenterHref).toContain(
      "persona=freelancer#automation-command-center-title"
    );
    expect(res.body.workspaces[0].packAutomationHref).toContain(
      "persona=freelancer#report-pack-automation-title"
    );
    expect(res.body.managementBriefs).toHaveLength(1);
    expect(res.body.managementBriefs[0]).toMatchObject({
      persona: "freelancer",
      href: "/reports?tab=sales&persona=freelancer#report-management-brief-freelancer-client-tax-brief",
    });
    expect(res.body.managementBriefs[0].kpiWidgets).toHaveLength(4);
    expect(res.body.managementBriefs[0].kpiWidgets[0].id).toContain("freelancer");
    expect(res.body.managementBriefs[0].narrativeSections).toHaveLength(3);
    expect(res.body.managementBriefs[0].dimensionBreakdowns).toHaveLength(3);
    expect(res.body.automationImpactProfiles[0].outcomeSignals).toHaveLength(3);
    expect(res.body.automationImpactProfiles[0].outcomeSignals[0].id).toContain("freelancer");
    expect(res.body.reportActionContexts).toHaveLength(res.body.reports.length);
    expect(
      res.body.reportActionContexts.every((context: any) => context.persona === "freelancer")
    ).toBe(true);
    expect(
      res.body.reportActionContexts.every((context: any) =>
        context.workflowHref.includes("persona=freelancer")
      )
    ).toBe(true);
    const profitContext = res.body.reportActionContexts.find(
      (context: any) => context.reportId === "profit-loss"
    );
    const profitReport = res.body.reports.find((report: any) => report.id === "profit-loss");
    expect(profitReport.href).toContain("tab=pl");
    expect(profitReport.href).toContain("report=profit-loss");
    expect(profitReport.href).toContain("persona=freelancer");
    expect(profitContext.reportHref).toContain("tab=pl");
    expect(profitContext.reportHref).toContain("report=profit-loss");
    expect(profitContext.reportHref).toContain("persona=freelancer");
    expect(profitContext.quickAccessHref).toContain("persona=freelancer#report-quick-access-title");
    expect(profitContext.automationImpactHref).toContain(
      "persona=freelancer#report-automation-impact-title"
    );
    expect(profitContext.automationStarters.length).toBeGreaterThan(0);
    expect(profitContext.deliverySubscriptions.length).toBeGreaterThan(0);
    expect(profitContext.comparisonPresets.length).toBeGreaterThan(0);
    expect(res.body.reports.every((report: any) => report.personas.includes("freelancer"))).toBe(
      true
    );
    expect(
      res.body.deliverySubscriptions.every(
        (subscription: any) => subscription.persona === "freelancer"
      )
    ).toBe(true);
    expect(res.body.reportSuites.every((suite: any) => suite.persona === "freelancer")).toBe(true);
    expect(
      res.body.quickAccessProfiles.every((profile: any) => profile.persona === "freelancer")
    ).toBe(true);
    expect(res.body.savedViews.every((view: any) => view.persona === "freelancer")).toBe(true);
    expect(
      res.body.automationImpactProfiles.every((profile: any) => profile.persona === "freelancer")
    ).toBe(true);
    expect(res.body.summary.productDepthAreaCount).toBe(5);
    expect(res.body.summary.productDepthSubgoalCount).toBeGreaterThan(0);
    expect(res.body.productDepthAreas).toHaveLength(5);
    expect(
      res.body.productDepthAreas.every((area: any) =>
        area.subgoals.every((subgoal: any) => subgoal.personas.includes("freelancer"))
      )
    ).toBe(true);
    expect(res.body.productDepthAreas[0].href).toContain("#report-product-depth-");
    expect(res.body.productDepthAreas[0].subgoals[0].href).toContain("persona=freelancer");
    const freelancerSourceDrilldowns = res.body.productDepthAreas
      .flatMap((area: any) => area.subgoals)
      .find((subgoal: any) => subgoal.id === "source-drilldowns");
    expect(freelancerSourceDrilldowns.sourceDrilldownTargets).toHaveLength(2);
    expect(
      freelancerSourceDrilldowns.sourceDrilldownTargets.some((target: any) =>
        target.reportIds.includes("expenses-category")
      )
    ).toBe(true);
    expect(
      freelancerSourceDrilldowns.sourceDrilldownTargets.every((target: any) =>
        target.personas.includes("freelancer")
      )
    ).toBe(true);
    const freelancerDataDepthArea = res.body.productDepthAreas.find(
      (area: any) => area.id === "accounting-data-depth"
    );
    expect(freelancerDataDepthArea.subgoals.every((subgoal: any) => subgoal.personas)).toBe(true);
    expect(
      freelancerDataDepthArea.subgoals.every(
        (subgoal: any) => subgoal.evidenceCheckpoints?.length === 3
      )
    ).toBe(true);
    expect(
      freelancerDataDepthArea.subgoals.every(
        (subgoal: any) => subgoal.requiredSourceRecords?.length === 3
      )
    ).toBe(true);
    expect(storage.hasCompanyAccess).not.toHaveBeenCalled();
  });

  it("rejects unsupported persona filters", async () => {
    const res = await callReportCatalogRoute(appWithRoutes(), "/api/reports/catalog?persona=staff");

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("persona must be owner, freelancer, or accountant");
  });
});
