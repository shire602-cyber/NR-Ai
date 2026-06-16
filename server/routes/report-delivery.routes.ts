import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { createAndEmitNotification } from "../services/socket.service";
import {
  buildReportDeliveryNotificationInput,
  buildReportDeliveryRunInput,
  getReportDeliveryPlan,
  getReportDeliveryPlans,
  isReportDeliveryPersona,
} from "../services/report-delivery.service";

const reportDeliveryQuerySchema = z.object({
  persona: z
    .string()
    .optional()
    .refine((value) => value === undefined || isReportDeliveryPersona(value), {
      message: "persona must be owner, freelancer, or accountant",
    }),
});

const optionalOverride = z.string().trim().min(1).max(500).nullable().optional();

const reportDeliverySettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    cadence: optionalOverride,
    channel: optionalOverride,
    format: optionalOverride,
    recipients: optionalOverride,
    deliveryGuardrail: optionalOverride,
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one setting must be provided",
  });

const reportDeliveryRunsQuerySchema = z.object({
  subscriptionId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const reportDeliverySchedulerHealthQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Report delivery failed";
}

export function registerReportDeliveryRoutes(app: Express) {
  app.get(
    "/api/companies/:companyId/report-delivery/subscriptions",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const query = reportDeliveryQuerySchema.parse(req.query);
      const settings = await storage.getReportDeliverySubscriptionSettings(companyId);
      const subscriptions = getReportDeliveryPlans({
        persona: isReportDeliveryPersona(query.persona) ? query.persona : null,
        settings,
      });

      res.json({ subscriptions });
    })
  );

  app.get(
    "/api/companies/:companyId/report-delivery/runs",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const query = reportDeliveryRunsQuerySchema.parse(req.query);
      if (query.subscriptionId && !getReportDeliveryPlan(query.subscriptionId)) {
        return res.status(404).json({ message: "Report delivery subscription not found" });
      }

      const runs = await storage.getReportDeliveryRuns(companyId, {
        subscriptionId: query.subscriptionId,
        limit: query.limit,
      });

      res.json({ runs });
    })
  );

  app.get(
    "/api/companies/:companyId/report-delivery/scheduler-health",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const query = reportDeliverySchedulerHealthQuerySchema.parse(req.query);
      const [latestScan, recentScans] = await Promise.all([
        storage.getLatestReportDeliverySchedulerScan(companyId),
        storage.getReportDeliverySchedulerScans(companyId, { limit: query.limit ?? 5 }),
      ]);

      res.json({ latestScan: latestScan ?? null, recentScans });
    })
  );

  app.patch(
    "/api/companies/:companyId/report-delivery/subscriptions/:subscriptionId/settings",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId, subscriptionId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      if (!getReportDeliveryPlan(subscriptionId)) {
        return res.status(404).json({ message: "Report delivery subscription not found" });
      }

      const body = reportDeliverySettingsSchema.parse(req.body);
      const setting = await storage.upsertReportDeliverySubscriptionSetting({
        companyId,
        subscriptionId,
        enabled: body.enabled,
        cadenceOverride: body.cadence,
        channelOverride: body.channel,
        formatOverride: body.format,
        recipientsOverride: body.recipients,
        deliveryGuardrailOverride: body.deliveryGuardrail,
        createdBy: userId,
        updatedBy: userId,
      });

      const subscription = getReportDeliveryPlan(subscriptionId, new Date(), [setting]);

      res.json({ setting, subscription });
    })
  );

  app.post(
    "/api/companies/:companyId/report-delivery/subscriptions/:subscriptionId/queue",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId, subscriptionId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const settings = await storage.getReportDeliverySubscriptionSettings(companyId);
      const delivery = buildReportDeliveryNotificationInput({
        userId,
        companyId,
        subscriptionId,
        settings,
      });

      if (!delivery) {
        return res.status(404).json({ message: "Report delivery subscription not found" });
      }

      if (!delivery.plan.enabled) {
        return res.status(409).json({ message: "Report delivery subscription is paused" });
      }

      let notification;
      let run;
      try {
        notification = await createAndEmitNotification(delivery.notification);
        run = await storage.createReportDeliveryRun(
          buildReportDeliveryRunInput({
            companyId,
            queuedBy: userId,
            plan: delivery.plan,
            notificationId: notification.id,
          })
        );
      } catch (error) {
        await storage.createReportDeliveryRun(
          buildReportDeliveryRunInput({
            companyId,
            queuedBy: userId,
            plan: delivery.plan,
            status: "failed",
            errorMessage: errorMessage(error),
          })
        );
        throw error;
      }

      res.status(201).json({
        subscription: delivery.plan,
        notification,
        run,
      });
    })
  );

  app.post(
    "/api/companies/:companyId/report-delivery/runs/:runId/retry",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId, runId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const failedRun = await storage.getReportDeliveryRun(companyId, runId);
      if (!failedRun) return res.status(404).json({ message: "Report delivery run not found" });
      if (failedRun.status !== "failed") {
        return res.status(409).json({ message: "Only failed report delivery runs can be retried" });
      }

      const settings = await storage.getReportDeliverySubscriptionSettings(companyId);
      const delivery = buildReportDeliveryNotificationInput({
        userId,
        companyId,
        subscriptionId: failedRun.subscriptionId,
        settings,
        scheduledFor: new Date(),
      });

      if (!delivery) {
        return res.status(404).json({ message: "Report delivery subscription not found" });
      }

      if (!delivery.plan.enabled) {
        return res.status(409).json({ message: "Report delivery subscription is paused" });
      }

      if (delivery.plan.status !== "ready") {
        return res.status(409).json({ message: "Report delivery subscription needs setup" });
      }

      const notification = await createAndEmitNotification(delivery.notification);
      const run = await storage.createReportDeliveryRun(
        buildReportDeliveryRunInput({
          companyId,
          queuedBy: userId,
          plan: delivery.plan,
          notificationId: notification.id,
          retriedFromRunId: failedRun.id,
          scheduledFor: delivery.notification.scheduledFor ?? new Date(),
        })
      );

      res.status(201).json({
        subscription: delivery.plan,
        notification,
        run,
        retriedFromRun: failedRun,
      });
    })
  );
}
