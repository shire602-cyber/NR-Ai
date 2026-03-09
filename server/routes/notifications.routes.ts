import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { z } from "zod";

export function registerNotificationRoutes(app: Express) {
  // =====================================
  // NOTIFICATIONS & SMART REMINDERS
  // =====================================

  // Get user notifications
  app.get("/api/notifications", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const notifications = await storage.getNotificationsByUserId(userId);
    const unreadCount = await storage.getUnreadNotificationCount(userId);
    res.json({ notifications, unreadCount });
  }));

  // Mark notification as read
  app.patch("/api/notifications/:id/read", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const notification = await storage.markNotificationAsRead(id);
    res.json(notification);
  }));

  // Mark all notifications as read
  app.post("/api/notifications/read-all", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    await storage.markAllNotificationsAsRead(userId);
    res.json({ message: 'All notifications marked as read' });
  }));

  // Dismiss notification
  app.patch("/api/notifications/:id/dismiss", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const notification = await storage.dismissNotification(id);
    res.json(notification);
  }));

  // Create notification (for current user only - system notifications should be created server-side)
  app.post("/api/notifications", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;

    // Validate input with comprehensive schema
    const validationSchema = z.object({
      companyId: z.string().uuid().optional(),
      type: z.enum(['deadline', 'payment_due', 'overdue', 'regulatory', 'referral', 'system']),
      title: z.string().min(1).max(200),
      message: z.string().min(1).max(2000),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
      actionUrl: z.string().url().optional().nullable(),
      relatedEntityType: z.string().max(50).optional().nullable(),
      relatedEntityId: z.string().uuid().optional().nullable(),
    });

    const validated = validationSchema.parse(req.body);

    // Verify user has access to the company if specified
    if (validated.companyId) {
      const hasAccess = await storage.hasCompanyAccess(userId, validated.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied to this company' });
      }
    }

    // Users can only create notifications for themselves
    const notification = await storage.createNotification({
      ...validated,
      userId,
      isRead: false,
      isDismissed: false,
    });
    res.json(notification);
  }));
}
