import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { reportCatalog, reportPersonas } from "../../client/src/lib/reportCatalog";
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
    status(code: number) {
      this.statusCode = code;
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

    expect(discovery.summary.liveReportCount).toBe(32);
    expect(discovery.summary.reportCount).toBe(reportCatalog.length);
    expect(discovery.summary.deliverySubscriptionCount).toBe(6);
    expect(discovery.summary.automationStarterCount).toBe(6);
    expect(discovery.summary.triggerRuleCount).toBe(9);
    expect(discovery.summary.decisionShortcutCount).toBe(9);
    expect(discovery.personas).toEqual(reportPersonas);
    expect(discovery.personaSummaries).toHaveLength(3);
    expect(discovery.personaSummaries[0]).toMatchObject({
      persona: "owner",
      automationPlaybookCount: 3,
    });
    expect(discovery.personaSummaries[0].reportCount).toBeGreaterThan(20);
    expect(discovery.personaSummaries[0].liveReportCount).toBeGreaterThan(20);
    expect(discovery.personaSummaries[0].comparisonPresetCount).toBeGreaterThan(0);
    expect(discovery.personaSummaries[0].operationsHref).toContain(
      "#report-automation-operations-title"
    );
    expect(discovery.personaSummaries[0].automationCommandCenterHref).toContain(
      "#automation-command-center-title"
    );
    expect(discovery.reports.every((report) => report.href)).toBe(true);
    expect(discovery.workspaces).toHaveLength(3);
    expect(discovery.workspaces[0].operationsHref).toContain("#report-automation-operations-title");
    expect(discovery.workspaces[0].recommendationsHref).toContain("#recommended-reports-title");
    expect(discovery.workspaces[0].triggerRulesHref).toContain("#trigger-rules-title");
    expect(discovery.workspaces[0].automationRulesHref).toContain("#report-automation-rules-title");
    expect(discovery.workspaces[0].automationCommandCenterHref).toContain(
      "#automation-command-center-title"
    );
    expect(discovery.workspaces[0].packAutomationHref).toContain("#report-pack-automation-title");
    expect(discovery.deliverySubscriptions[0].href).toContain("#report-delivery-subscription-");
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
    expect(res.body.summary.liveReportCount).toBeGreaterThan(0);
    expect(res.body.personaSummaries).toHaveLength(1);
    expect(res.body.personaSummaries[0]).toMatchObject({
      persona: "freelancer",
      reportCount: res.body.summary.reportCount,
      liveReportCount: res.body.summary.liveReportCount,
      automationPlaybookCount: 3,
    });
    expect(res.body.personaSummaries[0].decisionShortcutCount).toBeGreaterThan(0);
    expect(res.body.personaSummaries[0].packTemplateCount).toBeGreaterThan(0);
    expect(res.body.personaSummaries[0].comparisonPresetCount).toBeGreaterThan(0);
    expect(res.body.personaSummaries[0].automationCommandCenterHref).toContain(
      "persona=freelancer#automation-command-center-title"
    );
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0]).toMatchObject({
      persona: "freelancer",
      href: "/reports?tab=sales&persona=freelancer",
    });
    expect(res.body.workspaces[0].operationsHref).toContain(
      "persona=freelancer#report-automation-operations-title"
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
    expect(res.body.reports.every((report: any) => report.personas.includes("freelancer"))).toBe(
      true
    );
    expect(
      res.body.deliverySubscriptions.every(
        (subscription: any) => subscription.persona === "freelancer"
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
