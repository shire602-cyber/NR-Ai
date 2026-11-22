import { marketingBrand } from "../../shared/marketing-brand";
import type { EmailOutboxRow } from "../../shared/schema";
import {
  isBankStatementReview,
  normalizeNotificationCopy,
  renderServerCopy,
} from "../../shared/server-copy";
import { escapeHtml, htmlToText, renderBilingualEmail } from "./email-layout";

export function renderNotificationEmail(title: string, message: string): string {
  return renderBilingualEmail(
    {
      brandName: marketingBrand,
      heading: { en: title, ar: title },
      paragraphs: { en: [escapeHtml(message)], ar: [] },
      footer: `${marketingBrand} notifications — manage them under Settings → Notifications`,
    },
    "en"
  );
}

export function renderDigestItem({ title, message }: { title: string; message: string }): string {
  return `<strong>${escapeHtml(title)}</strong> — ${escapeHtml(message)}`;
}

function notificationEventKey(category: string, idempotencyKey: string | null) {
  return category === "notification" && idempotencyKey?.startsWith("notif:")
    ? idempotencyKey.slice(6)
    : null;
}

export function displayedOutboxSubject(
  row: Pick<EmailOutboxRow, "category" | "idempotencyKey" | "subject">
): string {
  return isBankStatementReview(notificationEventKey(row.category, row.idempotencyKey))
    ? renderServerCopy("notification.bankSyncFailed.title")
    : row.subject;
}

/** Refresh queued bodies from the previous notification templates while preserving other items. */
export function refreshQueuedNotificationEmail({
  category,
  idempotencyKey,
  html,
  subject,
  textBody,
}: EmailOutboxRow): Pick<EmailOutboxRow, "html" | "subject" | "textBody"> | null {
  const eventKey = notificationEventKey(category, idempotencyKey);
  if (isBankStatementReview(eventKey)) {
    const { title, message } = normalizeNotificationCopy({
      eventKey,
      title: subject,
      message: textBody ?? "",
    });
    const body = renderNotificationEmail(title, message);
    if (title === subject && message === textBody && body === html) return null;
    return { subject: title, textBody: message, html: body };
  }

  if (category === "digest" && html) {
    // Earlier digests stored the rendered snapshot and did not record which rows it included.
    // Match the old renderer's escaped paragraphs, leaving other notifications in place.
    const legacyItem =
      /<strong>(Bank[ -]feed\s+sync\s+failed|Bank statement imported)<\/strong> — ([^<]*)(?=<\/p>)/gi;
    let firstReplacement: { old: string; updated: string } | undefined;
    const refreshed = html.replace(legacyItem, (old, title: string, message: string) => {
      const original = {
        eventKey: /^The bank[ -]feed/i.test(message) ? "bank.sync_failed:digest" : null,
        title,
        message: htmlToText(message),
      };
      const current = normalizeNotificationCopy(original);
      if (current === original) return old;
      const updated = renderDigestItem(current);
      firstReplacement ??= { old, updated };
      return updated;
    });
    if (!firstReplacement) return null;
    // The inbox preview uses the first digest item, capped at 140 characters.
    const preheader = (item: string) => escapeHtml(htmlToText(item).slice(0, 140));
    const padding = "&#8199;&#847;";
    return {
      subject,
      textBody,
      html: refreshed.replace(
        `${preheader(firstReplacement.old)}${padding}`,
        `${preheader(firstReplacement.updated)}${padding}`
      ),
    };
  }
  return null;
}
