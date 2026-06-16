import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { createAndEmitNotification } from "../services/socket.service";
import {
  buildReportDeliveryNotificationInput,
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
      const subscriptions = getReportDeliveryPlans({
        persona: isReportDeliveryPersona(query.persona) ? query.persona : null,
      });

      res.json({ subscriptions });
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

      const delivery = buildReportDeliveryNotificationInput({
        userId,
        companyId,
        subscriptionId,
      });

      if (!delivery) {
        return res.status(404).json({ message: "Report delivery subscription not found" });
      }

      const notification = await createAndEmitNotification(delivery.notification);

      res.status(201).json({
        subscription: delivery.plan,
        notification,
      });
    })
  );
}
