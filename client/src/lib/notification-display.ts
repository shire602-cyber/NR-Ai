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
import { formatAedText } from "@/lib/format";
import { formatMoneyText } from "@/lib/format-money";
import { formatDate, formatEmbeddedDates } from "@/lib/format-date";

const ISO_DAY_PARAM = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/;

/**
 * F3 (Fable sign-off 2): date params arrive as ISO days ("2026-10-28"); show them in the app's
 * date format for the active language ("28 Oct 2026" / "28 أكتوبر 2026"), zone-safe.
 */
function localizeDateParams(
  params: Record<string, string>,
  locale: "en" | "ar"
): Record<string, string> {
  const out = { ...params };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string" && ISO_DAY_PARAM.test(v.trim())) {
      out[k] = formatDate(v.trim().slice(0, 10), locale) || v;
    }
  }
  return out;
}

/** Server strings carry "AED 15000.00"; re-render amounts through the one money formatter. */
function localizeAmounts(text: string): string {
  return text.replace(/AED\s?(\d[\d,]*(?:\.\d+)?)/g, (_m, n: string) =>
    formatAedText(Number(n.replace(/,/g, "")))
  );
}

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

/** "AED 15000.00" / "15000.00" (server string) -> locale money text, or null when not an amount. */
function localizeAmountParam(value: string, locale: "en" | "ar"): string | null {
  // "AED 15000.00", "15000.00", or the older "6100 AED" (amount first) stored by receipt uploads.
  const m = /^(?:([A-Z]{3})\s+)?(-?\d+(?:\.\d+)?)(?:\s+([A-Z]{3}))?$/.exec(value.trim());
  if (!m) return null;
  return formatMoneyText(Number(m[2]), m[1] ?? m[3] ?? "AED", locale);
}

function monthYearLabel(month: string, year: string, locale: "en" | "ar"): string | null {
  const mo = Number(month);
  const yr = Number(year);
  if (!Number.isInteger(mo) || mo < 1 || mo > 12 || !Number.isInteger(yr)) return null;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-AE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
    numberingSystem: "latn",
  }).format(new Date(Date.UTC(yr, mo - 1, 1)));
}

export function localizeNotification(
  n: NotificationLike,
  t: Record<string, string | undefined>,
  locale: "en" | "ar" = "en"
): { title: string; message: string; setupEmailHref?: string } {
  const copy = n.copy ?? describeNotificationCopy(n);
  const titleParams = localizeDateParams({ ...copy.titleParams }, locale);
  if (titleParams.title) {
    titleParams.title = localizeDeliverySubscriptionTitle(titleParams.title, t);
  }
  // Rows without a catalog key fall back to the stored English, whose dates are ISO too.
  const title = formatEmbeddedDates(
    renderDescriptor(copy.titleKey, titleParams, n.title, t),
    locale
  );
  if (isEmailNotSetUpMessage(n.message)) {
    return {
      title,
      message: t["components.notificationEmailNotSetUpBody"] ?? n.message,
      setupEmailHref: EMAIL_SETUP_HREF,
    };
  }
  const messageParams = localizeDateParams({ ...copy.messageParams }, locale);
  for (const key of ["amount", "total"]) {
    const v = messageParams[key];
    const cur = messageParams.currency;
    const formatted = v
      ? localizeAmountParam(cur && !/^[A-Z]{3}\s/.test(v) ? `${cur} ${v}` : v, locale)
      : null;
    if (formatted) {
      messageParams[key] = formatted;
      // The amount now carries its currency; drop the separate {currency} suffix.
      if (cur) messageParams.currency = "";
    }
  }
  if (copy.messageKey === "notification.payrollApproved.message") {
    const period = monthYearLabel(messageParams.month ?? "", messageParams.year ?? "", locale);
    const template = t["components.notificationPayrollApproved"];
    if (period && template) {
      return { title, message: template.replace("{period}", period) };
    }
  }
  return {
    title,
    message: formatEmbeddedDates(
      localizeAmounts(renderDescriptor(copy.messageKey, messageParams, n.message, t).trim()),
      locale
    ),
  };
}
