import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

vi.mock("../../server/storage", () => ({
  storage: {
    getAllCompanies: vi.fn(async () => []),
    getReportDeliverySubscriptionSettings: vi.fn(async () => []),
    getReportDeliveryRuns: vi.fn(async () => []),
    resolveCompanyActorUserId: vi.fn(async () => userId),
    createReportDeliveryRun: vi.fn(async (run: any) => ({
      id: "run-1",
      ...run,
      createdAt: new Date("2026-06-22T09:00:00.000Z"),
      updatedAt: new Date("2026-06-22T09:00:00.000Z"),
    })),
    createReportDeliverySchedulerScan: vi.fn(async (scan: any) => ({
      id: "scan-1",
      ...scan,
      createdAt: new Date("2026-06-22T09:00:00.000Z"),
    })),
  },
}));

vi.mock("../../server/services/socket.service", () => ({
  createAndEmitNotification: vi.fn(async (data: any) => ({
    id: "notification-1",
    ...data,
    createdAt: new Date("2026-06-22T09:00:00.000Z"),
  })),
}));

import { storage } from "../../server/storage";
import { createAndEmitNotification } from "../../server/services/socket.service";
import { getReportDeliveryPlans } from "../../server/services/report-delivery.service";
import {
  getReportDeliveryScheduleDecision,
  scanDueReportDeliveries,
} from "../../server/services/report-delivery-scheduler.service";

describe("report delivery scheduler", () => {
  beforeEach(() => {
    vi.mocked(storage.getAllCompanies).mockResolvedValue([
      {
        id: companyId,
        name: "Demo LLC",
        baseCurrency: "AED",
        country: "AE",
        trn: null,
        address: null,
        companyType: "business",
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
      } as any,
    ]);
    vi.mocked(storage.getReportDeliverySubscriptionSettings).mockResolvedValue([]);
    vi.mocked(storage.getReportDeliveryRuns).mockResolvedValue([]);
    vi.mocked(storage.resolveCompanyActorUserId).mockResolvedValue(userId);
    vi.mocked(storage.createReportDeliveryRun).mockClear();
    vi.mocked(storage.createReportDeliverySchedulerScan).mockClear();
    vi.mocked(createAndEmitNotification).mockClear();
  });

  it("queues initial subscriptions only when their cadence window is due", () => {
    const [ownerWeekly] = getReportDeliveryPlans({
      persona: "owner",
      now: new Date("2026-06-16T09:00:00.000Z"),
    });

    expect(
      getReportDeliveryScheduleDecision(ownerWeekly, null, new Date("2026-06-16T09:00:00.000Z"))
    ).toMatchObject({
      shouldQueue: false,
      reason: "not_due",
    });

    expect(
      getReportDeliveryScheduleDecision(ownerWeekly, null, new Date("2026-06-22T09:00:00.000Z"))
    ).toMatchObject({
      shouldQueue: true,
      reason: "due",
      scheduledFor: new Date("2026-06-22T09:00:00.000Z"),
    });
  });

  it("uses the latest run schedule to avoid duplicate delivery queues", () => {
    const [ownerWeekly] = getReportDeliveryPlans({
      persona: "owner",
      now: new Date("2026-06-22T09:00:00.000Z"),
    });

    const latestRun = {
      scheduledFor: new Date("2026-06-22T08:00:00.000Z"),
    };

    expect(
      getReportDeliveryScheduleDecision(
        ownerWeekly,
        latestRun,
        new Date("2026-06-22T09:00:00.000Z")
      )
    ).toMatchObject({
      shouldQueue: false,
      reason: "not_due",
      scheduledFor: new Date("2026-06-29T08:00:00.000Z"),
    });

    expect(
      getReportDeliveryScheduleDecision(
        ownerWeekly,
        latestRun,
        new Date("2026-06-29T09:00:00.000Z")
      )
    ).toMatchObject({
      shouldQueue: true,
      reason: "due",
      scheduledFor: new Date("2026-06-29T08:00:00.000Z"),
    });
  });

  it("skips paused subscriptions before notification delivery", () => {
    const [pausedPlan] = getReportDeliveryPlans({
      persona: "owner",
      now: new Date("2026-06-22T09:00:00.000Z"),
      settings: [
        {
          subscriptionId: "owner-weekly-executive-delivery",
          enabled: false,
          cadenceOverride: null,
          channelOverride: null,
          formatOverride: null,
          recipientsOverride: null,
          deliveryGuardrailOverride: null,
          updatedAt: new Date("2026-06-21T09:00:00.000Z"),
        },
      ],
    });

    expect(
      getReportDeliveryScheduleDecision(pausedPlan, null, new Date("2026-06-22T09:00:00.000Z"))
    ).toMatchObject({
      shouldQueue: false,
      reason: "paused",
    });
  });

  it("scans companies and queues due ready report delivery runs", async () => {
    const result = await scanDueReportDeliveries(new Date("2026-06-22T09:00:00.000Z"));

    expect(result).toMatchObject({
      scannedCompanies: 1,
      scannedSubscriptions: 6,
      queuedRuns: 3,
      errors: 0,
    });
    expect(createAndEmitNotification).toHaveBeenCalledTimes(3);
    expect(storage.createReportDeliveryRun).toHaveBeenCalledTimes(3);
    expect(storage.createReportDeliveryRun).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        subscriptionId: "owner-weekly-executive-delivery",
        queuedBy: userId,
        scheduledFor: new Date("2026-06-22T09:00:00.000Z"),
      })
    );
    expect(storage.createReportDeliverySchedulerScan).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        status: "success",
        scannedSubscriptions: 6,
        queuedRuns: 3,
        skippedPaused: 0,
        skippedSetup: 0,
        skippedNoActor: 0,
        errors: 0,
        snapshot: expect.objectContaining({
          queuedSubscriptionIds: expect.arrayContaining(["owner-weekly-executive-delivery"]),
        }),
      })
    );
  });

  it("does not create scheduled notifications without a company actor", async () => {
    vi.mocked(storage.resolveCompanyActorUserId).mockResolvedValue(null);

    const result = await scanDueReportDeliveries(new Date("2026-06-22T09:00:00.000Z"));

    expect(result.queuedRuns).toBe(0);
    expect(result.skippedNoActor).toBe(3);
    expect(createAndEmitNotification).not.toHaveBeenCalled();
    expect(storage.createReportDeliveryRun).not.toHaveBeenCalled();
    expect(storage.createReportDeliverySchedulerScan).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        status: "success",
        queuedRuns: 0,
        skippedNoActor: 3,
      })
    );
  });

  it("records failed scheduled runs and continues scanning remaining subscriptions", async () => {
    vi.mocked(createAndEmitNotification).mockRejectedValueOnce(new Error("Email provider down"));

    const result = await scanDueReportDeliveries(new Date("2026-06-22T09:00:00.000Z"));

    expect(result).toMatchObject({
      scannedCompanies: 1,
      scannedSubscriptions: 6,
      queuedRuns: 2,
      errors: 1,
    });
    expect(createAndEmitNotification).toHaveBeenCalledTimes(3);
    expect(storage.createReportDeliveryRun).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        subscriptionId: "owner-weekly-executive-delivery",
        queuedBy: userId,
        status: "failed",
        errorMessage: "Email provider down",
        scheduledFor: new Date("2026-06-22T09:00:00.000Z"),
      })
    );
    expect(storage.createReportDeliverySchedulerScan).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        status: "error",
        queuedRuns: 2,
        errors: 1,
        message: "Email provider down",
      })
    );
  });
});
