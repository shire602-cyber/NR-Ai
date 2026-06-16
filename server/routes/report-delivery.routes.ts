import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { createAndEmitNotification } from "../services/socket.service";
import {
  buildReportDeliveryNotificationInput,
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

      const notification = await createAndEmitNotification(delivery.notification);

      res.status(201).json({
        subscription: delivery.plan,
        notification,
      });
    })
  );
}
