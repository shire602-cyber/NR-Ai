import webpush from 'web-push';
import { storage } from '../storage';
import { createLogger } from '../config/logger';

const log = createLogger('push-notification');

let initialized = false;

/**
 * Initialize web push with VAPID keys.
 * Call once at server startup.
 */
export function initWebPush(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@muhasib.ai';

  if (!publicKey || !privateKey) {
    log.warn('Web push not configured — VAPID keys not set');
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  initialized = true;
  log.info('Web push initialized with VAPID keys');
  return true;
}

export function isWebPushConfigured(): boolean {
  return initialized;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
}

/**
 * Send a push notification to a specific user.
 * Sends to all active push subscriptions for that user.
 */
export async function sendPushNotification(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (!initialized) {
    log.warn('Web push not initialized, skipping notification');
    return { sent: 0, failed: 0 };
  }

  // Check user preferences
  const prefs = await storage.getNotificationPreferences(userId);
  if (prefs && !prefs.pushEnabled) {
    return { sent: 0, failed: 0 };
  }

  const subscriptions = await storage.getPushSubscriptionsByUserId(userId);
  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const notificationPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/badge-72.png',
    data: {
      url: payload.url || '/dashboard',
    },
    tag: payload.tag,
  });

  let sent = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    if (!sub.isActive) continue;

    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dhKey,
        auth: sub.authKey,
      },
    };

    try {
      await webpush.sendNotification(pushSubscription, notificationPayload);
      sent++;
    } catch (error: any) {
      failed++;
      // If subscription is expired/invalid, deactivate it
      if (error.statusCode === 404 || error.statusCode === 410) {
        log.info({ subscriptionId: sub.id }, 'Push subscription expired, deactivating');
        await storage.deactivatePushSubscription(sub.endpoint);
      } else {
        log.error({ error: error.message, subscriptionId: sub.id }, 'Failed to send push notification');
      }
    }
  }

  return { sent, failed };
}

/**
 * Send push notifications to multiple users.
 */
export async function sendBulkPushNotifications(
  userIds: string[],
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  let totalSent = 0;
  let totalFailed = 0;

  for (const userId of userIds) {
    const result = await sendPushNotification(userId, payload);
    totalSent += result.sent;
    totalFailed += result.failed;
  }

  return { sent: totalSent, failed: totalFailed };
}
