/**
 * Display text for server notifications (D2b, CTO 11). Notifications are stored in English;
 * known system messages are shown in the reader's language, and configuration problems are
 * phrased for users with a "Set up email" link instead of environment variable names.
 */
import {
  EMAIL_SETUP_HREF,
  isEmailNotSetUpMessage,
  parseReportDeliveryTitle,
} from "@shared/notification-copy";

const DELIVERY_TITLE_KEYS = {
  sent: "components.notificationDeliverySentTitle",
  blocked: "components.notificationDeliveryBlockedTitle",
  failed: "components.notificationDeliveryFailedTitle",
  queued: "components.notificationDeliveryQueuedTitle",
} as const;

/**
 * Server notifications are stored in English. Known system messages are shown in the
 * reader's language, and configuration problems are phrased for users (CTO 11).
 */
export function localizeNotification(
  n: { title: string; message: string },
  t: Record<string, string>
): { title: string; message: string; setupEmailHref?: string } {
  const delivery = parseReportDeliveryTitle(n.title);
  const title = delivery
    ? (t[DELIVERY_TITLE_KEYS[delivery.outcome]] ?? n.title).replace("{title}", delivery.planTitle)
    : n.title;
  if (isEmailNotSetUpMessage(n.message)) {
    return {
      title,
      message: t["components.notificationEmailNotSetUpBody"] ?? n.message,
      setupEmailHref: EMAIL_SETUP_HREF,
    };
  }
  return { title, message: n.message };
}
