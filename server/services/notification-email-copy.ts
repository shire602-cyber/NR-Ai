import { marketingBrand } from "../../shared/marketing-brand";
import type { EmailOutboxRow } from "../../shared/schema";
import { isBankStatementReview, normalizeNotificationCopy } from "../../shared/server-copy";
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

/** Refresh queued bodies from the previous notification templates while preserving other items. */
export function refreshQueuedNotificationEmail({
  category,
  idempotencyKey,
  html,
  subject,
  textBody,
}: EmailOutboxRow): Pick<EmailOutboxRow, "html" | "subject" | "textBody"> | null {
  const eventKey = idempotencyKey?.startsWith("notif:") ? idempotencyKey.slice(6) : null;
  if (category === "notification" && isBankStatementReview(eventKey)) {
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
    // Match the old renderer's single escaped paragraph, leaving other notifications in place.
    const legacyItem =
      /<strong>Bank[ -]feed sync failed<\/strong> — The bank[ -]feed[^<]*(?=<\/p>)/gi;
    const firstLegacyItem = html.match(legacyItem)?.[0];
    if (!firstLegacyItem) return null;
    const current = normalizeNotificationCopy({
      eventKey: "bank.sync_failed:digest",
      title: "",
      message: "",
    });
    const replacement = renderDigestItem(current);
    // The inbox preview is generated from the first digest item, capped at 140 characters.
    const preheader = (item: string) => escapeHtml(htmlToText(item).slice(0, 140));
    const padding = "&#8199;&#847;";
    return {
      subject,
      textBody,
      html: html
        .replace(legacyItem, () => replacement)
        .replace(`${preheader(firstLegacyItem)}${padding}`, `${preheader(replacement)}${padding}`),
    };
  }
  return null;
}
