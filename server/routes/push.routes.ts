import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { validateOutboundUrl } from "../services/url-guard";
import { getCapability } from "../../shared/capabilities";
import {
  notificationPreferencesBody,
  type NotificationPreferencesBody,
} from "../../shared/validators/portal";
import { NOTIFICATION_EVENT_TYPES } from "../services/notification-engine.service";

const logger = createLogger("push-routes");

const subscribeBody = z.object({
  endpoint: z.string().trim().min(1).max(2048),
  expirationTime: z.union([z.number(), z.null()]).optional(),
  keys: z
    .object({
      p256dh: z.string().trim().min(16).max(512),
      auth: z.string().trim().min(8).max(256),
    })
    .strict(),
});

const unsubscribeBody = z.object({ endpoint: z.string().trim().min(1).max(2048) });

/**
 * W4-D (R16-11): a push endpoint is only ever an https URL on a public host (the url-guard
 * rejects loopback, private, link-local/metadata and reserved ranges), because web-push POSTs
 * to it from the server.
 */
export async function assertSafePushEndpoint(endpoint: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new DomainError("INVALID_PUSH_ENDPOINT", 400, undefined, "Invalid push endpoint");
  }
  if (url.protocol !== "https:") {
    throw new DomainError("INVALID_PUSH_ENDPOINT", 400, undefined, "Push endpoint must be https");
  }
  const verdict = await validateOutboundUrl(endpoint);
  if (!verdict.ok) {
    throw new DomainError("INVALID_PUSH_ENDPOINT", 400, { reason: verdict.reason }, verdict.reason);
  }
}

export function registerPushRoutes(app: Express) {
  // Public: VAPID public key. Without VAPID the capability is reported, never a 500.
  app.get(
    "/api/push/vapid-key",
    asyncHandler(async (_req: Request, res: Response) => {
      const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
      const capability = getCapability("push");
      if (!vapidPublicKey) {
        return res.json({
          publicKey: null,
          configured: false,
          status: capability.status === "live" ? "disabled" : capability.status,
          capability: capability.id,
          externalAction: capability.externalAction,
        });
      }
      res.json({ publicKey: vapidPublicKey, configured: true, status: capability.status });
    })
  );

  app.post(
    "/api/push/subscribe",
    authMiddleware,
    requireCustomer,
    strictBody(subscribeBody),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { endpoint, keys } = parsedBody<z.output<typeof subscribeBody>>(req);
      await assertSafePushEndpoint(endpoint);
      const subscription = await storage.createPushSubscription({
        userId,
        endpoint,
        p256dhKey: keys.p256dh,
        authKey: keys.auth,
      });
      logger.info({ userId }, "User subscribed to push notifications");
      res.status(201).json({ message: "Subscribed to push notifications", id: subscription.id });
    })
  );

  // Unsubscribe: only the caller's own subscription for that endpoint (R16-11).
  app.delete(
    "/api/push/unsubscribe",
    authMiddleware,
    requireCustomer,
    strictBody(unsubscribeBody),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { endpoint } = parsedBody<z.output<typeof unsubscribeBody>>(req);
      const count = await storage.deactivatePushSubscriptionByEndpoint(userId, endpoint);
      logger.info({ userId, count }, "User unsubscribed from push notifications");
      res.json({ message: "Unsubscribed from push notifications", unsubscribed: count });
    })
  );

  app.get(
    "/api/notification-preferences",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const preferences = await storage.getNotificationPreferences(userId);
      const push = getCapability("push");
      const email = getCapability("email");
      const channels = {
        push: { status: push.status, externalAction: push.externalAction },
        email: { status: email.status, externalAction: email.externalAction },
      };
      if (!preferences) {
        return res.json({
          userId,
          pushEnabled: false,
          emailEnabled: true,
          inAppEnabled: true,
          invoiceReminders: true,
          vatDeadlines: true,
          paymentReceived: true,
          weeklyDigest: false,
          digestFrequency: "none",
          typePreferences: {},
          eventTypes: NOTIFICATION_EVENT_TYPES,
          channels,
        });
      }
      let typePreferences: Record<string, unknown> = {};
      try {
        typePreferences = JSON.parse(preferences.typePreferences || "{}");
      } catch {
        typePreferences = {};
      }
      res.json({ ...preferences, typePreferences, eventTypes: NOTIFICATION_EVENT_TYPES, channels });
    })
  );

  app.put(
    "/api/notification-preferences",
    authMiddleware,
    requireCustomer,
    strictBody(notificationPreferencesBody),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const body = parsedBody<NotificationPreferencesBody>(req);
      const { typePreferences, ...rest } = body;
      const preferences = await storage.upsertNotificationPreferences(userId, {
        ...rest,
        ...(typePreferences !== undefined
          ? { typePreferences: JSON.stringify(typePreferences) }
          : {}),
      });
      logger.info({ userId }, "Notification preferences updated");
      res.json(preferences);
    })
  );
}
