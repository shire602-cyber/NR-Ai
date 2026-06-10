import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';
import { createLogger } from '../config/logger';

const logger = createLogger('push-routes');

export function registerPushRoutes(app: Express) {
  // =====================================
  // Push Notification Routes
  // =====================================

  // Public: Get VAPID public key
  app.get('/api/push/vapid-key', asyncHandler(async (req: Request, res: Response) => {
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      return res.status(500).json({ message: 'VAPID public key not configured' });
    }
    res.json({ publicKey: vapidPublicKey });
  }));

  // Customer-only: Subscribe to push notifications
  app.post('/api/push/subscribe', authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ message: 'Invalid push subscription: endpoint and keys (p256dh, auth) required' });
    }

    const subscription = await storage.createPushSubscription({
      userId,
      endpoint,
      p256dhKey: keys.p256dh,
      authKey: keys.auth,
    });

    logger.info({ userId }, 'User subscribed to push notifications');
    res.status(201).json({ message: 'Subscribed to push notifications', id: subscription.id });
  }));

  // Customer-only: Unsubscribe from push notifications
  app.delete('/api/push/unsubscribe', authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({ message: 'Endpoint is required to unsubscribe' });
    }

    // Deactivate by endpoint
    await storage.deactivatePushSubscription(endpoint);

    logger.info({ userId }, 'User unsubscribed from push notifications');
    res.json({ message: 'Unsubscribed from push notifications' });
  }));

  // Customer-only: Get notification preferences
  app.get('/api/notification-preferences', authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;

    const preferences = await storage.getNotificationPreferences(userId);
    if (!preferences) {
      // Return defaults if no preferences set
      return res.json({
        userId,
        pushEnabled: false,
        emailEnabled: true,
        invoiceReminders: true,
        vatDeadlines: true,
        paymentReceived: true,
        weeklyDigest: false,
      });
    }

    res.json(preferences);
  }));

  // Customer-only: Update notification preferences
  app.put('/api/notification-preferences', authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;

    const preferences = await storage.upsertNotificationPreferences(userId, req.body);

    logger.info({ userId }, 'Notification preferences updated');
    res.json(preferences);
  }));
}
