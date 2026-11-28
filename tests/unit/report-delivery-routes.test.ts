import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const companyId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

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
    getReportAutomationPreferences: vi.fn(async () => []),
    getReportAutomationPreference: vi.fn(async () => undefined),
    upsertReportAutomationPreference: vi.fn(),
    getReportDeliverySubscriptionSettings: vi.fn(async () => []),
    upsertReportDeliverySubscriptionSetting: vi.fn(),
    getReportDeliveryRuns: vi.fn(async () => []),
    getReportDeliveryRun: vi.fn(async () => undefined),
    getLatestReportDeliverySchedulerScan: vi.fn(async () => null),
    getReportDeliverySchedulerScans: vi.fn(async () => []),
    createReportDeliveryRun: vi.fn(async (run: any) => ({
      id: "run-1",
      ...run,
      createdAt: new Date("2026-06-16T10:00:00.000Z"),
      updatedAt: new Date("2026-06-16T10:00:00.000Z"),
    })),
  },
}));

vi.mock("../../server/services/socket.service", () => ({
  createAndEmitNotification: vi.fn(async (data: any) => ({
    id: "notification-1",
    ...data,
    createdAt: new Date("2026-06-16T10:00:00.000Z"),
  })),
}));

// W5-A (R12-01): queue/retry now render and email through the executor; its behaviour is
// covered end-to-end in tests/db/report-delivery-outbox.test.ts.
vi.mock("../../server/services/report-render/delivery", () => ({
  executeReportDeliveryRun: vi.fn(async ({ runId }: any) => ({
    id: runId,
    status: "sent",
    recipientAddresses: ["owner@example.com"],
    errorMessage: null,
    blockedReason: null,
  })),
  setRunNotification: vi.fn(async (_companyId: string, runId: string, notificationId: string) => ({
    id: runId,
    status: "sent",
    notificationId,
  })),
  refreshReportDeliveryRuns: vi.fn(async (runs: any[]) => runs),
  cancelPendingRunEmails: vi.fn(async () => undefined),
  parseRecipientEmails: (value: string) =>
    (value.match(/[^\s,;]+@[^\s,;]+\.[^\s,;]+/g) ?? []).map((e) => e.toLowerCase()),
  listRunArtifacts: vi.fn(async () => []),
  getRunArtifact: vi.fn(async () => undefined),
}));

import { registerReportDeliveryRoutes } from "../../server/routes/report-delivery.routes";
import {
  executeReportDeliveryRun,
  setRunNotification,
} from "../../server/services/report-render/delivery";
import { createAndEmitNotification } from "../../server/services/socket.service";
import { storage } from "../../server/storage";
import {
  buildReportDeliveryNotificationInput,
  buildReportDeliveryRunInput,
  getReportDeliveryPlans,
} from "../../server/services/report-delivery.service";

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerReportDeliveryRoutes(app);
  return app;
}

async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    try {
      return { status: res.status, body: text ? JSON.parse(text) : null };
    } catch {
      return { status: res.status, body: { raw: text } };
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function missingOptionalReportDeliveryStorage(tableName: string): Error & { code: string } {
  const error = new Error(`relation "${tableName}" does not exist`) as Error & { code: string };
  error.code = "42P01";
  return error;
}

describe("report delivery subscriptions", () => {
  beforeEach(() => {
    vi.mocked(storage.hasCompanyAccess).mockResolvedValue(true);
    vi.mocked(storage.getReportAutomationPreferences).mockResolvedValue([]);
    vi.mocked(storage.getReportAutomationPreference).mockResolvedValue(undefined);
    vi.mocked(storage.upsertReportAutomationPreference).mockReset();
    vi.mocked(storage.getReportDeliverySubscriptionSettings).mockResolvedValue([]);
    vi.mocked(storage.upsertReportDeliverySubscriptionSetting).mockReset();
    vi.mocked(storage.getReportDeliveryRuns).mockResolvedValue([]);
    vi.mocked(storage.getReportDeliveryRun).mockResolvedValue(undefined);
    vi.mocked(storage.getLatestReportDeliverySchedulerScan).mockResolvedValue(null);
    vi.mocked(storage.getReportDeliverySchedulerScans).mockResolvedValue([]);
    vi.mocked(storage.createReportDeliveryRun).mockClear();
    vi.mocked(createAndEmitNotification).mockClear();
    vi.mocked(executeReportDeliveryRun).mockClear();
  });

  it("builds persona delivery plans with schedules and deep links", () => {
    const plans = getReportDeliveryPlans({
      persona: "owner",
      now: new Date("2026-06-16T10:00:00.000Z"),
    });

    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({
      id: "owner-weekly-executive-delivery",
      persona: "owner",
      status: "ready",
      triggerRuleCount: 2,
      suiteCount: 1,
      href: "/reports?tab=balances&persona=owner#report-delivery-subscription-owner-weekly-executive-delivery",
    });
    expect(plans[0].readyReportCount).toBe(plans[0].reportCount);
    expect(plans[0].nextRunAt).toBe("2026-06-22T08:00:00.000Z");
    expect(plans[0].packTemplate?.title).toBe("Owner weekly command pack");
    expect(plans[0].reportSuites[0]).toMatchObject({
      id: "owner-cash-control-suite",
      title: "Owner cash control suite",
      workflow: "Cash control and collections",
      href: "/reports?tab=balances&persona=owner#report-suite-owner-cash-control-suite",
    });
    expect(plans[0].preview).toMatchObject({
      readinessLabel: "Ready for queue",
      reportNames: expect.arrayContaining(["Profit & Loss", "A/R Aging"]),
      triggerRuleTitles: expect.arrayContaining(["Cash runway risk"]),
      suiteTitles: expect.arrayContaining(["Owner cash control suite"]),
    });
  });

  it("applies company delivery settings to catalog plans", () => {
    const plans = getReportDeliveryPlans({
      persona: "owner",
      now: new Date("2026-06-16T10:00:00.000Z"),
      settings: [
        {
          subscriptionId: "owner-weekly-executive-delivery",
          enabled: false,
          cadenceOverride: "Daily at 8:00 AM",
          channelOverride: "Email only",
          formatOverride: "PDF digest",
          recipientsOverride: "Owner",
          deliveryGuardrailOverride: "Manual approval required",
          updatedAt: new Date("2026-06-16T09:30:00.000Z"),
        },
      ],
    });

    expect(plans[0]).toMatchObject({
      id: "owner-weekly-executive-delivery",
      enabled: false,
      status: "paused",
      settingsSource: "company",
      cadence: "Daily at 8:00 AM",
      // R12-01: the channel label is what the server really does (no Sheets unless live).
      channel: "Email with PDF and Excel attachments",
      format: "PDF digest",
      recipients: "Owner",
      deliveryGuardrail: "Manual approval required",
      settingsUpdatedAt: "2026-06-16T09:30:00.000Z",
    });
    expect(plans[0].nextRunAt).toBe("2026-06-17T08:00:00.000Z");
  });

  it("builds a notification payload for queued delivery", () => {
    const delivery = buildReportDeliveryNotificationInput({
      userId,
      companyId,
      subscriptionId: "owner-weekly-executive-delivery",
      now: new Date("2026-06-16T10:00:00.000Z"),
    });

    expect(delivery?.notification).toMatchObject({
      userId,
      companyId,
      type: "system",
      title: "Report delivery queued: Owner weekly executive delivery",
      priority: "normal",
      relatedEntityType: "report_delivery_subscription",
      actionUrl:
        "/reports?tab=balances&persona=owner#report-delivery-subscription-owner-weekly-executive-delivery",
    });
    expect(delivery?.notification.message).toContain("Management pack workbook");
    expect(delivery?.notification.message).toContain("Owner cash control suite");
    expect(delivery?.notification.scheduledFor?.toISOString()).toBe("2026-06-22T08:00:00.000Z");
  });

  it("builds a queued report delivery run snapshot", () => {
    const [plan] = getReportDeliveryPlans({
      persona: "owner",
      now: new Date("2026-06-16T10:00:00.000Z"),
    });

    const run = buildReportDeliveryRunInput({
      companyId,
      queuedBy: userId,
      plan,
      notificationId: "notification-1",
    });

    expect(run).toMatchObject({
      companyId,
      subscriptionId: "owner-weekly-executive-delivery",
      status: "queued",
      readinessStatus: "ready",
      notificationId: "notification-1",
      retriedFromRunId: null,
      errorMessage: null,
      queuedBy: userId,
      reportCount: plan.reportCount,
      readyReportCount: plan.readyReportCount,
      triggerRuleCount: plan.triggerRuleCount,
    });
    expect(run.scheduledFor.toISOString()).toBe("2026-06-22T08:00:00.000Z");
    expect(run.snapshot).toMatchObject({
      title: "Owner weekly executive delivery",
      reportSuites: expect.arrayContaining([
        expect.objectContaining({ id: "owner-cash-control-suite" }),
      ]),
      preview: expect.objectContaining({ readinessLabel: "Ready for queue" }),
    });
  });

  it("returns report delivery plans by persona", async () => {
    const res = await request(
      appWithRoutes(),
      "GET",
      `/api/companies/${companyId}/report-delivery/subscriptions?persona=freelancer`
    );

    expect(res.status).toBe(200);
    expect(res.body.subscriptions).toHaveLength(2);
    expect(res.body.subscriptions.map((item: any) => item.persona)).toEqual([
      "freelancer",
      "freelancer",
    ]);
    expect(res.body.subscriptions[0].href).toContain("#report-delivery-subscription-");
    expect(storage.getReportDeliverySubscriptionSettings).toHaveBeenCalledWith(companyId);
  });

  it("falls back to catalog delivery plans when optional delivery settings storage is unavailable", async () => {
    vi.mocked(storage.getReportDeliverySubscriptionSettings).mockRejectedValueOnce(
      missingOptionalReportDeliveryStorage("company_report_delivery_subscriptions")
    );

    const res = await request(
      appWithRoutes(),
      "GET",
      `/api/companies/${companyId}/report-delivery/subscriptions?persona=owner`
    );

    expect(res.status).toBe(200);
    expect(res.body.subscriptions).toHaveLength(2);
    expect(res.body.subscriptions[0]).toMatchObject({
      id: "owner-weekly-executive-delivery",
      persona: "owner",
      settingsSource: "catalog",
    });
  });

  it("returns recent report delivery runs by subscription", async () => {
    vi.mocked(storage.getReportDeliveryRuns).mockResolvedValue([
      {
        id: "run-1",
        companyId,
        subscriptionId: "owner-weekly-executive-delivery",
        status: "queued",
        readinessStatus: "ready",
        notificationId: "notification-1",
        retriedFromRunId: null,
        errorMessage: null,
        scheduledFor: new Date("2026-06-22T08:00:00.000Z"),
        queuedBy: userId,
        channel: "Google Sheets plus email summary",
        format: "Management pack workbook",
        recipients: "Owner",
        deliveryGuardrail: "Review guardrail",
        reportCount: 6,
        readyReportCount: 6,
        triggerRuleCount: 2,
        snapshot: {},
        createdAt: new Date("2026-06-16T10:00:00.000Z"),
        updatedAt: new Date("2026-06-16T10:00:00.000Z"),
      },
    ]);

    const res = await request(
      appWithRoutes(),
      "GET",
      `/api/companies/${companyId}/report-delivery/runs?subscriptionId=owner-weekly-executive-delivery&limit=5`
    );

    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0]).toMatchObject({
      id: "run-1",
      subscriptionId: "owner-weekly-executive-delivery",
      status: "queued",
    });
    expect(storage.getReportDeliveryRuns).toHaveBeenCalledWith(companyId, {
      subscriptionId: "owner-weekly-executive-delivery",
      limit: 5,
    });
  });

  it("returns an empty run list when optional delivery run storage is unavailable", async () => {
    vi.mocked(storage.getReportDeliveryRuns).mockRejectedValueOnce(
      missingOptionalReportDeliveryStorage("company_report_delivery_runs")
    );

    const res = await request(
      appWithRoutes(),
      "GET",
      `/api/companies/${companyId}/report-delivery/runs?subscriptionId=owner-weekly-executive-delivery`
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs: [] });
  });

  it("returns report delivery scheduler health for the company", async () => {
    const scan = {
      id: "scan-1",
      companyId,
      status: "success",
      startedAt: new Date("2026-06-22T09:00:00.000Z"),
      finishedAt: new Date("2026-06-22T09:00:03.000Z"),
      scannedSubscriptions: 6,
      queuedRuns: 3,
      skippedPaused: 1,
      skippedSetup: 1,
      skippedNotDue: 1,
      skippedNoActor: 0,
      errors: 0,
      message: null,
      snapshot: {},
      createdAt: new Date("2026-06-22T09:00:03.000Z"),
    };
    vi.mocked(storage.getLatestReportDeliverySchedulerScan).mockResolvedValue(scan);
    vi.mocked(storage.getReportDeliverySchedulerScans).mockResolvedValue([scan]);

    const res = await request(
      appWithRoutes(),
      "GET",
      `/api/companies/${companyId}/report-delivery/scheduler-health?limit=3`
    );

    expect(res.status).toBe(200);
    expect(res.body.latestScan).toMatchObject({
      id: "scan-1",
      status: "success",
      queuedRuns: 3,
      skippedSetup: 1,
    });
    expect(res.body.recentScans).toHaveLength(1);
    expect(storage.getLatestReportDeliverySchedulerScan).toHaveBeenCalledWith(companyId);
    expect(storage.getReportDeliverySchedulerScans).toHaveBeenCalledWith(companyId, { limit: 3 });
  });

  it("returns empty scheduler health when optional scheduler storage is unavailable", async () => {
    vi.mocked(storage.getLatestReportDeliverySchedulerScan).mockRejectedValueOnce(
      missingOptionalReportDeliveryStorage("company_report_delivery_scheduler_scans")
    );
    vi.mocked(storage.getReportDeliverySchedulerScans).mockRejectedValueOnce(
      missingOptionalReportDeliveryStorage("company_report_delivery_scheduler_scans")
    );

    const res = await request(
      appWithRoutes(),
      "GET",
      `/api/companies/${companyId}/report-delivery/scheduler-health`
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ latestScan: null, recentScans: [] });
  });

  it("returns persisted report automation preferences for the current user and company", async () => {
    vi.mocked(storage.getReportAutomationPreferences).mockResolvedValue([
      {
        id: "preference-1",
        companyId,
        userId,
        persona: "owner",
        preferredDeliveryAutomationCommand: "queue",
        createdAt: new Date("2026-06-16T09:00:00.000Z"),
        updatedAt: new Date("2026-06-16T10:00:00.000Z"),
      },
    ]);

    const res = await request(
      appWithRoutes(),
      "GET",
      `/api/companies/${companyId}/report-delivery/preferences`
    );

    expect(res.status).toBe(200);
    expect(res.body.preferences).toHaveLength(1);
    expect(res.body.preferences[0]).toMatchObject({
      companyId,
      userId,
      persona: "owner",
      preferredDeliveryAutomationCommand: "queue",
    });
    expect(storage.getReportAutomationPreferences).toHaveBeenCalledWith(companyId, userId);
  });

  it("returns empty automation preferences when optional preference storage is unavailable", async () => {
    vi.mocked(storage.getReportAutomationPreferences).mockRejectedValueOnce(
      missingOptionalReportDeliveryStorage("company_report_automation_preferences")
    );

    const res = await request(
      appWithRoutes(),
      "GET",
      `/api/companies/${companyId}/report-delivery/preferences`
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferences: [] });
  });

  it("persists a report automation command preference for the current user and company", async () => {
    vi.mocked(storage.upsertReportAutomationPreference).mockResolvedValue({
      id: "preference-1",
      companyId,
      userId,
      persona: "accountant",
      preferredDeliveryAutomationCommand: "comparison",
      createdAt: new Date("2026-06-16T09:00:00.000Z"),
      updatedAt: new Date("2026-06-16T10:00:00.000Z"),
    });

    const res = await request(
      appWithRoutes(),
      "PATCH",
      `/api/companies/${companyId}/report-delivery/preferences/accountant`,
      { preferredDeliveryAutomationCommand: "comparison" }
    );

    expect(res.status).toBe(200);
    expect(storage.upsertReportAutomationPreference).toHaveBeenCalledWith({
      companyId,
      userId,
      persona: "accountant",
      preferredDeliveryAutomationCommand: "comparison",
    });
    expect(res.body.preference).toMatchObject({
      persona: "accountant",
      preferredDeliveryAutomationCommand: "comparison",
    });
  });

  it("rejects report automation preferences for unsupported personas", async () => {
    const res = await request(
      appWithRoutes(),
      "PATCH",
      `/api/companies/${companyId}/report-delivery/preferences/partner`,
      { preferredDeliveryAutomationCommand: "queue" }
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("persona must be owner, freelancer, or accountant");
    expect(storage.upsertReportAutomationPreference).not.toHaveBeenCalled();
  });

  it("updates company delivery settings", async () => {
    vi.mocked(storage.upsertReportDeliverySubscriptionSetting).mockResolvedValue({
      id: "setting-1",
      companyId,
      subscriptionId: "owner-weekly-executive-delivery",
      enabled: false,
      cadenceOverride: "Daily at 8:00 AM",
      channelOverride: null,
      formatOverride: null,
      recipientsOverride: null,
      deliveryGuardrailOverride: "Manual approval required",
      createdBy: userId,
      updatedBy: userId,
      createdAt: new Date("2026-06-16T09:00:00.000Z"),
      updatedAt: new Date("2026-06-16T10:00:00.000Z"),
    });

    const res = await request(
      appWithRoutes(),
      "PATCH",
      `/api/companies/${companyId}/report-delivery/subscriptions/owner-weekly-executive-delivery/settings`,
      {
        enabled: false,
        cadence: "Daily at 8:00 AM",
        channel: "Email only",
        format: "Executive PDF pack",
        recipients: "Owner and accountant",
        deliveryGuardrail: "Manual approval required",
      }
    );

    expect(res.status).toBe(200);
    expect(storage.upsertReportDeliverySubscriptionSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        subscriptionId: "owner-weekly-executive-delivery",
        enabled: false,
        cadenceOverride: "Daily at 8:00 AM",
        channelOverride: "Email only",
        formatOverride: "Executive PDF pack",
        recipientsOverride: "Owner and accountant",
        deliveryGuardrailOverride: "Manual approval required",
        createdBy: userId,
        updatedBy: userId,
      })
    );
    expect(res.body.subscription).toMatchObject({
      id: "owner-weekly-executive-delivery",
      enabled: false,
      status: "paused",
      settingsSource: "company",
    });
  });

  it("[R12-10] rejects a Google Sheets channel while the integration is unconfigured", async () => {
    const res = await request(
      appWithRoutes(),
      "PATCH",
      `/api/companies/${companyId}/report-delivery/subscriptions/owner-weekly-executive-delivery/settings`,
      { channel: "Email and Google Sheets" }
    );

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("GOOGLE_SHEETS_NOT_CONFIGURED");
    expect(storage.upsertReportDeliverySubscriptionSetting).not.toHaveBeenCalled();
  });

  it("queues a report delivery notification for the current user", async () => {
    const res = await request(
      appWithRoutes(),
      "POST",
      `/api/companies/${companyId}/report-delivery/subscriptions/owner-weekly-executive-delivery/queue`
    );

    expect(res.status).toBe(201);
    expect(res.body.subscription.id).toBe("owner-weekly-executive-delivery");
    expect(res.body.notification.id).toBe("notification-1");
    expect(res.body.run.id).toBe("run-1");
    expect(createAndEmitNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        companyId,
        relatedEntityType: "report_delivery_subscription",
        actionUrl:
          "/reports?tab=balances&persona=owner#report-delivery-subscription-owner-weekly-executive-delivery",
      })
    );
    expect(storage.createReportDeliveryRun).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        subscriptionId: "owner-weekly-executive-delivery",
        queuedBy: userId,
        status: "queued",
        readinessStatus: "ready",
      })
    );
    // R12-01: the run is executed (rendered + emailed) and the notification reports the outcome.
    expect(executeReportDeliveryRun).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, runId: "run-1" })
    );
    expect(createAndEmitNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Report delivery sent: Owner weekly executive delivery" })
    );
    expect(setRunNotification).toHaveBeenCalledWith(companyId, "run-1", "notification-1");
    expect(res.body.run.status).toBe("sent");
  });

  it("requires handoff acknowledgement before queueing after a failed delivery", async () => {
    vi.mocked(storage.getReportDeliveryRuns).mockResolvedValue([
      {
        id: "failed-run-1",
        companyId,
        subscriptionId: "owner-weekly-executive-delivery",
        status: "failed",
        readinessStatus: "ready",
        notificationId: null,
        retriedFromRunId: null,
        errorMessage: "Email provider down",
        scheduledFor: new Date("2026-06-22T08:00:00.000Z"),
        queuedBy: userId,
        channel: "Google Sheets plus email summary",
        format: "Management pack workbook",
        recipients: "Owner",
        deliveryGuardrail: "Review guardrail",
        reportCount: 6,
        readyReportCount: 6,
        triggerRuleCount: 2,
        snapshot: {},
        createdAt: new Date("2026-06-22T09:00:00.000Z"),
        updatedAt: new Date("2026-06-22T09:00:00.000Z"),
      },
    ]);

    const blocked = await request(
      appWithRoutes(),
      "POST",
      `/api/companies/${companyId}/report-delivery/subscriptions/owner-weekly-executive-delivery/queue`
    );

    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toBe("Report delivery has unresolved handoff gaps");
    expect(blocked.body.handoffReview).toMatchObject({
      gap: "delivery-gaps",
      latestRunId: "failed-run-1",
      detail: "Email provider down",
    });
    expect(createAndEmitNotification).not.toHaveBeenCalled();
    expect(storage.createReportDeliveryRun).not.toHaveBeenCalled();

    const acknowledged = await request(
      appWithRoutes(),
      "POST",
      `/api/companies/${companyId}/report-delivery/subscriptions/owner-weekly-executive-delivery/queue`,
      { acknowledgeHandoffGaps: true }
    );

    expect(acknowledged.status).toBe(201);
    expect(acknowledged.body.subscription.id).toBe("owner-weekly-executive-delivery");
    expect(storage.createReportDeliveryRun).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        subscriptionId: "owner-weekly-executive-delivery",
        status: "queued",
      })
    );
  });

  it("reports the executed run status when the in-app notification fails", async () => {
    // R12-01: the notification is an extra signal, never the delivery itself.
    vi.mocked(createAndEmitNotification).mockRejectedValueOnce(new Error("Socket down"));
    vi.mocked(executeReportDeliveryRun).mockResolvedValueOnce({
      id: "run-1",
      status: "failed",
      errorMessage: "Email provider down",
    } as any);

    const res = await request(
      appWithRoutes(),
      "POST",
      `/api/companies/${companyId}/report-delivery/subscriptions/owner-weekly-executive-delivery/queue`
    );

    expect(res.status).toBe(201);
    expect(res.body.run).toMatchObject({ status: "failed", errorMessage: "Email provider down" });
    expect(storage.createReportDeliveryRun).toHaveBeenCalledTimes(1);
  });

  it("retries failed report delivery runs", async () => {
    vi.mocked(storage.getReportDeliveryRun).mockResolvedValue({
      id: "failed-run-1",
      companyId,
      subscriptionId: "owner-weekly-executive-delivery",
      status: "failed",
      readinessStatus: "ready",
      notificationId: null,
      retriedFromRunId: null,
      errorMessage: "Email provider down",
      scheduledFor: new Date("2026-06-22T08:00:00.000Z"),
      queuedBy: userId,
      channel: "Google Sheets plus email summary",
      format: "Management pack workbook",
      recipients: "Owner",
      deliveryGuardrail: "Review guardrail",
      reportCount: 6,
      readyReportCount: 6,
      triggerRuleCount: 2,
      snapshot: {},
      createdAt: new Date("2026-06-22T09:00:00.000Z"),
      updatedAt: new Date("2026-06-22T09:00:00.000Z"),
    });

    const res = await request(
      appWithRoutes(),
      "POST",
      `/api/companies/${companyId}/report-delivery/runs/failed-run-1/retry`
    );

    expect(res.status).toBe(201);
    expect(res.body.retriedFromRun.id).toBe("failed-run-1");
    expect(res.body.run.id).toBe("run-1");
    expect(storage.createReportDeliveryRun).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        subscriptionId: "owner-weekly-executive-delivery",
        retriedFromRunId: "failed-run-1",
        queuedBy: userId,
        status: "queued",
      })
    );
  });

  it("rejects retrying report delivery runs that are not failed", async () => {
    vi.mocked(storage.getReportDeliveryRun).mockResolvedValue({
      id: "queued-run-1",
      companyId,
      subscriptionId: "owner-weekly-executive-delivery",
      status: "queued",
      readinessStatus: "ready",
      notificationId: "notification-1",
      retriedFromRunId: null,
      errorMessage: null,
      scheduledFor: new Date("2026-06-22T08:00:00.000Z"),
      queuedBy: userId,
      channel: "Google Sheets plus email summary",
      format: "Management pack workbook",
      recipients: "Owner",
      deliveryGuardrail: "Review guardrail",
      reportCount: 6,
      readyReportCount: 6,
      triggerRuleCount: 2,
      snapshot: {},
      createdAt: new Date("2026-06-22T09:00:00.000Z"),
      updatedAt: new Date("2026-06-22T09:00:00.000Z"),
    });

    const res = await request(
      appWithRoutes(),
      "POST",
      `/api/companies/${companyId}/report-delivery/runs/queued-run-1/retry`
    );

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Only failed or blocked report delivery runs can be retried");
    expect(createAndEmitNotification).not.toHaveBeenCalled();
    expect(storage.createReportDeliveryRun).not.toHaveBeenCalled();
  });

  it("does not queue paused report delivery subscriptions", async () => {
    vi.mocked(storage.getReportDeliverySubscriptionSettings).mockResolvedValue([
      {
        id: "setting-1",
        companyId,
        subscriptionId: "owner-weekly-executive-delivery",
        enabled: false,
        cadenceOverride: null,
        channelOverride: null,
        formatOverride: null,
        recipientsOverride: null,
        deliveryGuardrailOverride: null,
        createdBy: userId,
        updatedBy: userId,
        createdAt: new Date("2026-06-16T09:00:00.000Z"),
        updatedAt: new Date("2026-06-16T10:00:00.000Z"),
      },
    ]);

    const res = await request(
      appWithRoutes(),
      "POST",
      `/api/companies/${companyId}/report-delivery/subscriptions/owner-weekly-executive-delivery/queue`
    );

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Report delivery subscription is paused");
    expect(createAndEmitNotification).not.toHaveBeenCalled();
    expect(storage.createReportDeliveryRun).not.toHaveBeenCalled();
  });

  it("rejects users without company access", async () => {
    vi.mocked(storage.hasCompanyAccess).mockResolvedValue(false);

    const res = await request(
      appWithRoutes(),
      "POST",
      `/api/companies/${companyId}/report-delivery/subscriptions/owner-weekly-executive-delivery/queue`
    );

    expect(res.status).toBe(403);
    expect(createAndEmitNotification).not.toHaveBeenCalled();
  });
});
