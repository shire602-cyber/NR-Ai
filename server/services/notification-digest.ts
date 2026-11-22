import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { notifications, users, type EmailOutboxRow } from "../../shared/schema";
import { isBankStatementReviewCopy, normalizeNotificationCopy } from "../../shared/server-copy";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";
import { BANK_STATEMENT_REVIEW_TITLE } from "../../shared/notification-copy";
import { marketingBrand } from "../../shared/marketing-brand";
import { customerVisibleNotification } from "../storage/notification-visibility";
import { escapeHtml, renderBilingualEmail, renderEmailText } from "./email-layout";

export const NOTIFICATION_DIGEST_ENTITY = "notification_digest";
export const DIGEST_WINDOW_MS = 26 * 3_600_000;

type DigestItem = Pick<typeof notifications.$inferSelect, "title" | "message">;

function digestItemHtml({ title, message }: DigestItem): string {
  return `<strong>${escapeHtml(title)}</strong> — ${escapeHtml(message)}`;
}

function legacyDigestItems(html: string): Map<string, number> {
  const items = new Map<string, number>();
  for (const [, item] of html.matchAll(/<p(?: [^>]*)?>(<strong>.*?<\/strong> — .*?)<\/p>/gs)) {
    items.set(item, (items.get(item) ?? 0) + 1);
  }
  return items;
}

export function renderNotificationDigest(day: string, rows: readonly DigestItem[]) {
  const content = {
    brandName: marketingBrand,
    heading: { en: `Your daily summary (${day})`, ar: `ملخصك اليومي (${day})` },
    paragraphs: {
      en: rows.map((row) => digestItemHtml(normalizeNotificationCopy(row))),
      ar: [
        `لديك ${rows.length} إشعارات جديدة.`,
        ...rows.filter(isBankStatementReviewCopy).map(() =>
          digestItemHtml({
            title: BANK_STATEMENT_REVIEW_TITLE.ar,
            message: BANK_RECONCILIATION_COPY.ar,
          })
        ),
      ],
    },
  };
  return {
    subject: `${marketingBrand} daily summary — ${rows.length} update(s)`,
    html: renderBilingualEmail(content, "bilingual"),
    textBody: renderEmailText(content, "bilingual"),
  };
}

/** Older rows have a rendered snapshot, while new digests have an exact source batch timestamp. */
export async function rebuildNotificationDigest(row: EmailOutboxRow) {
  const key = /^digest:([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}):(\d{4}-\d{2}-\d{2})$/i.exec(
    row.idempotencyKey ?? ""
  );
  if (!key) return null;
  const [, userId, day] = key;
  const dayStart = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(dayStart.getTime()) || dayStart.toISOString().slice(0, 10) !== day)
    return null;

  const exactBatch = row.relatedEntityType === NOTIFICATION_DIGEST_ENTITY;
  if (exactBatch && row.relatedEntityId !== userId) return null;
  const batch = exactBatch
    ? eq(notifications.digestedAt, row.createdAt)
    : and(
        gte(notifications.createdAt, new Date(dayStart.getTime() - DIGEST_WINDOW_MS)),
        lt(notifications.createdAt, new Date(row.createdAt.getTime() + 1)),
        or(
          isNull(notifications.digestedAt),
          and(
            gte(notifications.digestedAt, dayStart),
            lt(notifications.digestedAt, new Date(dayStart.getTime() + 86_400_000))
          )
        )
      );
  const candidates = await db
    .select({ title: notifications.title, message: notifications.message })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(
      and(
        eq(notifications.userId, userId),
        sql`lower(${users.email}) = lower(${row.toAddress})`,
        batch,
        customerVisibleNotification()
      )
    )
    .orderBy(notifications.createdAt, notifications.id);
  const legacyItems = exactBatch ? null : legacyDigestItems(row.html ?? "");
  const items = candidates.filter((item) => {
    if (!legacyItems) return true;
    const original = digestItemHtml(item);
    // A failed delivery can persist a refreshed snapshot while the source keeps its old wording.
    const html = (legacyItems.get(original) ?? 0) > 0
      ? original
      : digestItemHtml(normalizeNotificationCopy(item));
    const remaining = legacyItems.get(html) ?? 0;
    if (remaining === 0) return false;
    legacyItems.set(html, remaining - 1);
    return true;
  });
  return items.length ? renderNotificationDigest(day, items) : null;
}
