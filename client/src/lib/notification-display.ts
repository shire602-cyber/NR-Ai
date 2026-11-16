/**
 * Display text for server notifications (D2b, CTO 11; D4). The server stores English and
 * returns stable message keys + params in `copy`; this renders them from the en/ar catalogs.
 * Rows without `copy` (older cached rows, socket pushes) are mapped on read with the same
 * shared templates. Configuration problems are phrased for users with a "Set up email" link
 * instead of environment variable names.
 */
import { EMAIL_SETUP_HREF, isEmailNotSetUpMessage } from "@shared/notification-copy";
import {
  describeNotificationCopy,
  renderDescriptor,
  type NotificationCopyDescriptor,
} from "@shared/server-copy";
import { reportDeliverySubscriptions } from "@/lib/reportCatalog";

type NotificationLike = {
  title: string;
  message: string;
  copy?: NotificationCopyDescriptor | null;
};

const SUBSCRIPTION_TITLE_KEY = (id: string) => `reportCatalog.delivery.${id}.title`;

/** Localised name of a report delivery subscription (catalog titles are English-only data). */
export function localizeDeliverySubscriptionTitle(
  title: string,
  t: Record<string, string | undefined>
): string {
  const sub = reportDeliverySubscriptions.find((s) => s.title === title);
  return (sub && t[SUBSCRIPTION_TITLE_KEY(sub.id)]) || title;
}

export function localizeNotification(
  n: NotificationLike,
  t: Record<string, string | undefined>
): { title: string; message: string; setupEmailHref?: string } {
  const copy = n.copy ?? describeNotificationCopy(n);
  const titleParams = { ...copy.titleParams };
  if (titleParams.title) {
    titleParams.title = localizeDeliverySubscriptionTitle(titleParams.title, t);
  }
  const title = renderDescriptor(copy.titleKey, titleParams, n.title, t);
  if (isEmailNotSetUpMessage(n.message)) {
    return {
      title,
      message: t["components.notificationEmailNotSetUpBody"] ?? n.message,
      setupEmailHref: EMAIL_SETUP_HREF,
    };
  }
  return {
    title,
    message: renderDescriptor(copy.messageKey, copy.messageParams, n.message, t),
  };
}
