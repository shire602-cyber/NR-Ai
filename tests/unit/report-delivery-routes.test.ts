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
  path: string
): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, { method });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("report delivery subscriptions", () => {
  beforeEach(() => {
    vi.mocked(storage.hasCompanyAccess).mockResolvedValue(true);
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
    expect(createAndEmitNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        companyId,
        relatedEntityType: "report_delivery_subscription",
        actionUrl:
          "/reports?tab=balances&persona=owner#report-delivery-subscription-owner-weekly-executive-delivery",
      })
    );
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
