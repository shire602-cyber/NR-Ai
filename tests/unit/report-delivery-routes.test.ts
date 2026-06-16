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
    getReportDeliverySubscriptionSettings: vi.fn(async () => []),
    upsertReportDeliverySubscriptionSetting: vi.fn(),
    getReportDeliveryRuns: vi.fn(async () => []),
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

import { registerReportDeliveryRoutes } from "../../server/routes/report-delivery.routes";
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
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("report delivery subscriptions", () => {
  beforeEach(() => {
    vi.mocked(storage.hasCompanyAccess).mockResolvedValue(true);
    vi.mocked(storage.getReportDeliverySubscriptionSettings).mockResolvedValue([]);
    vi.mocked(storage.upsertReportDeliverySubscriptionSetting).mockReset();
    vi.mocked(storage.getReportDeliveryRuns).mockResolvedValue([]);
    vi.mocked(storage.getLatestReportDeliverySchedulerScan).mockResolvedValue(null);
    vi.mocked(storage.getReportDeliverySchedulerScans).mockResolvedValue([]);
    vi.mocked(storage.createReportDeliveryRun).mockClear();
    vi.mocked(createAndEmitNotification).mockClear();
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
      href: "/reports?tab=balances&persona=owner#report-delivery-subscription-owner-weekly-executive-delivery",
    });
    expect(plans[0].readyReportCount).toBe(plans[0].reportCount);
    expect(plans[0].nextRunAt).toBe("2026-06-22T08:00:00.000Z");
    expect(plans[0].packTemplate?.title).toBe("Owner weekly command pack");
    expect(plans[0].preview).toMatchObject({
      readinessLabel: "Ready for queue",
      reportNames: expect.arrayContaining(["Profit & Loss", "A/R Aging"]),
      triggerRuleTitles: expect.arrayContaining(["Cash runway risk"]),
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
      channel: "Email only",
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
      queuedBy: userId,
      reportCount: plan.reportCount,
      readyReportCount: plan.readyReportCount,
      triggerRuleCount: plan.triggerRuleCount,
    });
    expect(run.scheduledFor.toISOString()).toBe("2026-06-22T08:00:00.000Z");
    expect(run.snapshot).toMatchObject({
      title: "Owner weekly executive delivery",
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

  it("returns recent report delivery runs by subscription", async () => {
    vi.mocked(storage.getReportDeliveryRuns).mockResolvedValue([
      {
        id: "run-1",
        companyId,
        subscriptionId: "owner-weekly-executive-delivery",
        status: "queued",
        readinessStatus: "ready",
        notificationId: "notification-1",
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
        channel: "Email and Google Sheets",
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
        channelOverride: "Email and Google Sheets",
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
        notificationId: "notification-1",
        queuedBy: userId,
        status: "queued",
        readinessStatus: "ready",
      })
    );
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
