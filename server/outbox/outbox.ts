/**
 * Durable email outbox (W4-D: R16-08, R16-17, R13-33).
 *
 * Every email the app sends is first a row in email_outbox (with its attachments). Delivery is
 * attempted immediately when a provider is configured and then retried by the
 * "email.outboxDelivery" job with exponential backoff; after max_attempts the row is dead-lettered.
 * With no provider the row stays `blocked_no_provider` and nothing is ever reported as sent.
 *
 * Status lifecycle:
 *   queued → sending → sent → delivered | bounced | complained      (provider webhooks)
 *                    ↘ retrying → sending … → dead                   (after max_attempts)
 *   queued → blocked_no_provider → queued (when a provider appears, rows < 24h old)
 */
import { and, desc, eq, inArray, isNull, sql, type AnyColumn } from "drizzle-orm";
import { db, pool } from "../db";
import {
  emailDeliveryEvents,
  emailOutbox,
  emailOutboxAttachments,
  notifications,
  customerPortalInvitations,
  oauthMailboxChallenges,
  type EmailOutboxRow,
  type EmailOutboxStatus,
} from "../../shared/schema";
import { createLogger } from "../config/logger";
import { RETIRED_BANK_NOTIFICATION_PREFIX } from "../../shared/notification-copy";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";
import { refreshQueuedNotificationEmail } from "../services/notification-email-copy";
import {
  canDeliverCompanyNotification,
  containsRetiredNotificationCopy,
} from "../storage/notification-visibility";
import {
  NOTIFICATION_DIGEST_ENTITY,
  rebuildNotificationDigest,
} from "../services/notification-digest";
import {
  EmailTransportError,
  activeProviderName,
  resolveTransport,
  type OutgoingAttachment,
} from "./providers";

const log = createLogger("email-outbox");

export const DEFAULT_MAX_ATTEMPTS = 6;
export const OAUTH_MAILBOX_CHALLENGE_ENTITY = "oauth_mailbox_challenge";
const BASE_BACKOFF_MS = 60_000; // 1, 2, 4, 8, 16 min …
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
const LOCK_MS = 5 * 60 * 1000;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const notificationRecipientKey = /^notif:.+:([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i;

export interface EnqueueEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string | null;
  cc?: string | null;
  replyTo?: string | null;
  fromName?: string | null;
  companyId?: string | null;
  category?: string;
  notificationDigest?: { userId: string; notificationIds: readonly string[] };
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  attachments?: OutgoingAttachment[];
  /** Redact the body once delivered (password reset links, one-time codes). */
  sensitive?: boolean;
  /** Same key → same row (no duplicate email). */
  idempotencyKey?: string | null;
  maxAttempts?: number;
}

export interface OutboxResult {
  id: string;
  status: EmailOutboxStatus;
  provider: string | null;
  providerMessageId: string | null;
  error: string | null;
  /** True when an existing row was returned for the idempotency key. */
  duplicate?: boolean;
}

/** A message whose body carries a live link or code must not rest in the table unsent. */
function dropsBodyWhenUnsent(m: { category?: string | null; sensitive?: boolean | null }): boolean {
  // The e-invoicing approver link is also returned to the inviter by the API, so its row keeps
  // the body it needs to be retried when a provider appears.
  if (m.category === "einvoice_approver_link") return false;
  return m.category === "portal_invite" || m.sensitive === true;
}

export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

function toResult(row: EmailOutboxRow, duplicate = false): OutboxResult {
  return {
    id: row.id,
    status: row.status as EmailOutboxStatus,
    provider: row.provider ?? null,
    providerMessageId: row.providerMessageId ?? null,
    error: row.lastError ?? null,
    ...(duplicate ? { duplicate: true } : {}),
  };
}

async function recordEvent(
  outboxId: string | null,
  eventType: string,
  detail?: string | null,
  provider?: string | null,
  providerMessageId?: string | null
): Promise<void> {
  try {
    await db.insert(emailDeliveryEvents).values({
      outboxId,
      eventType,
      detail: detail ? detail.slice(0, 2000) : null,
      provider: provider ?? null,
      providerMessageId: providerMessageId ?? null,
    });
  } catch (err) {
    log.warn({ err, outboxId, eventType }, "Could not record email delivery event");
  }
}

/** Insert a message (and its attachments). Never sends. */
export async function enqueueEmail(input: EnqueueEmailInput, executor = db): Promise<OutboxResult> {
  if (!input.to || !input.to.includes("@")) {
    throw new Error("enqueueEmail: a recipient address is required");
  }
  const attachments = input.attachments ?? [];
  const totalBytes = attachments.reduce((n, a) => n + a.content.length, 0);
  if (totalBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error(`enqueueEmail: attachments exceed ${MAX_ATTACHMENT_BYTES} bytes`);
  }
  if (input.idempotencyKey) {
    const [existing] = await executor
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.idempotencyKey, input.idempotencyKey));
    if (existing) return toResult(existing, true);
  }
  const provider = activeProviderName();
  const digest = input.notificationDigest;
  const insert = async (tx: typeof db) => {
    const now = new Date();
    const digestAt = digest ? now : undefined;
    const [inserted] = await tx
      .insert(emailOutbox)
      .values({
        companyId: input.companyId ?? null,
        toAddress: input.to.trim(),
        cc: input.cc ?? null,
        replyTo: input.replyTo ?? null,
        fromName: input.fromName ?? null,
        subject: input.subject.slice(0, 998),
        // R5-9 / STEP5 N-1: with no provider a sensitive message (portal invitation, email
        // verification, password reset, sign-in code) is never sent by this row, so its live
        // link or code is not stored at all. A resend renders a fresh message with a fresh token.
        html: !provider && dropsBodyWhenUnsent(input) ? null : input.html,
        textBody: !provider && dropsBodyWhenUnsent(input) ? null : (input.text ?? null),
        category: input.category ?? "generic",
        relatedEntityType: digest ? NOTIFICATION_DIGEST_ENTITY : (input.relatedEntityType ?? null),
        relatedEntityId: digest?.userId ?? input.relatedEntityId ?? null,
        status: provider ? "queued" : "blocked_no_provider",
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        sensitive: input.sensitive === true,
        idempotencyKey: input.idempotencyKey ?? null,
        lastError: provider ? null : "No email provider configured (RESEND_API_KEY or SMTP_HOST)",
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted) return null;
    if (digest && digestAt) {
      await tx
        .update(notifications)
        .set({ digestedAt: digestAt })
        .where(
          and(
            eq(notifications.userId, digest.userId),
            isNull(notifications.digestedAt),
            inArray(notifications.id, digest.notificationIds)
          )
        );
    }
    for (const a of attachments) {
      await tx.insert(emailOutboxAttachments).values({
        outboxId: inserted.id,
        filename: a.filename,
        contentType: a.contentType,
        content: a.content,
        sizeBytes: a.content.length,
      });
    }
    return inserted as EmailOutboxRow;
  };
  const row = executor === db ? await db.transaction(insert) : await insert(executor);
  if (!row) {
    // Lost an idempotency race: return the winner.
    const [existing] = await executor
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.idempotencyKey, input.idempotencyKey ?? ""));
    return toResult(existing, true);
  }
  const eventType = row.status === "blocked_no_provider" ? "blocked" : "queued";
  if (executor === db) await recordEvent(row.id, eventType);
  else await executor.insert(emailDeliveryEvents).values({ outboxId: row.id, eventType });
  return toResult(row);
}

// A queued link can be superseded, revoked, or expire before a worker picks it up.
const isCurrentPortalInvite = sql`EXISTS (
  SELECT 1 FROM ${customerPortalInvitations} AS invite
  WHERE invite.id = ${emailOutbox.relatedEntityId} AND invite.last_outbox_id = ${emailOutbox.id}
    AND invite.status = 'pending' AND invite.expires_at > (now() AT TIME ZONE 'UTC')
)`;

// The challenge is deleted when consumed or when its permitted attempts are exhausted.
const isCurrentMailboxChallenge = sql`EXISTS (
  SELECT 1 FROM ${oauthMailboxChallenges} AS challenge
  WHERE challenge.id = ${emailOutbox.relatedEntityId}
    AND challenge.expires_at > (now() AT TIME ZONE 'UTC')
)`;

/** Claim rows for delivery (FOR UPDATE SKIP LOCKED); stale `sending` locks are reclaimed. */
async function claim(ids: string[] | null, limit: number): Promise<EmailOutboxRow[]> {
  const params: unknown[] = [LOCK_MS, limit];
  let filter = `(status IN ('queued','retrying') AND next_attempt_at <= (now() AT TIME ZONE 'UTC'))
                OR (status = 'sending' AND locked_until < (now() AT TIME ZONE 'UTC'))`;
  if (ids) {
    params.push(ids);
    filter = `id = ANY($3::uuid[]) AND (status IN ('queued','retrying')
              OR (status = 'sending' AND locked_until < (now() AT TIME ZONE 'UTC')))`;
  }
  const { rows } = await pool.query(
    `UPDATE email_outbox SET status = 'sending',
            locked_until = (now() AT TIME ZONE 'UTC') + ($1::int * interval '1 millisecond'),
            updated_at = now() AT TIME ZONE 'UTC'
      WHERE id IN (SELECT id FROM email_outbox WHERE ${filter}
                    ORDER BY next_attempt_at LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING id`,
    params
  );
  if (!rows.length) return [];
  return (await db
    .select()
    .from(emailOutbox)
    .where(
      inArray(
        emailOutbox.id,
        rows.map((r: { id: string }) => r.id)
      )
    )) as EmailOutboxRow[];
}

async function attempt(row: EmailOutboxRow): Promise<OutboxResult> {
  let refreshed =
    row.category === "notification"
      ? refreshQueuedNotificationEmail(row.subject, row.textBody)
      : null;
  if (
    !refreshed &&
    (row.idempotencyKey?.startsWith(`notif:${RETIRED_BANK_NOTIFICATION_PREFIX}`) ||
      (row.category === "notification" &&
        containsRetiredNotificationCopy(`${row.subject} ${row.textBody ?? ""} ${row.html ?? ""}`)))
  ) {
    return cancelPendingEmail(row.id);
  }
  // A sensitive message that lost its body (stored while no provider existed) can never be sent
  // by this row: the user asks again and gets a fresh link.
  if (row.sensitive && !row.html && !row.textBody) return cancelPendingEmail(row.id);
  const deliveryGuard =
    row.category === "portal_invite"
      ? isCurrentPortalInvite
      : row.relatedEntityType === OAUTH_MAILBOX_CHALLENGE_ENTITY
        ? isCurrentMailboxChallenge
        : null;
  if (deliveryGuard) {
    const [current] = await db
      .select({ id: emailOutbox.id })
      .from(emailOutbox)
      .where(and(eq(emailOutbox.id, row.id), deliveryGuard));
    if (!current) return cancelPendingEmail(row.id);
  }
  const transport = resolveTransport();
  if (!transport) {
    const [blocked] = await db
      .update(emailOutbox)
      .set({
        status: "blocked_no_provider",
        lockedUntil: null,
        lastError: "No email provider configured (RESEND_API_KEY or SMTP_HOST)",
        updatedAt: new Date(),
        // R5-9 / N-1: an unsent sensitive message keeps no live link at rest. The body is dropped;
        // a resend issues a fresh token and renders a new message.
        ...(dropsBodyWhenUnsent(row) ? { html: null, textBody: null } : {}),
      })
      .where(eq(emailOutbox.id, row.id))
      .returning();
    await recordEvent(row.id, "blocked");
    return toResult(blocked as EmailOutboxRow);
  }
  const attachments = await db
    .select()
    .from(emailOutboxAttachments)
    .where(eq(emailOutboxAttachments.outboxId, row.id));
  const attempts = row.attempts + 1;
  // A provider webhook can settle the row before the transport call returns. These expressions run
  // inside the UPDATE below, so that state (and its error) is never overwritten.
  const providerSettled = sql`${emailOutbox.status} IN ('delivered', 'bounced', 'complained', 'dead')`;
  const unlessSettled = (column: AnyColumn, value: string | Date | null) =>
    sql`CASE WHEN ${providerSettled} THEN ${column} ELSE ${
      value === null ? sql`NULL` : sql.param(value, column)
    } END`;
  try {
    if (row.category === "notification") {
      // Historical and new notification keys end in the intended user id.
      const recipientId = notificationRecipientKey.exec(row.idempotencyKey ?? "")?.[1];
      if (
        !recipientId ||
        !row.companyId ||
        !(await canDeliverCompanyNotification(recipientId, row.toAddress, row.companyId))
      ) {
        return await cancelPendingEmail(row.id);
      }
    }
    if (row.category === "digest") {
      refreshed = await rebuildNotificationDigest(row);
      if (!refreshed) return await cancelPendingEmail(row.id);
    }
    const content = refreshed ?? row;
    const { providerMessageId } = await transport.send({
      outboxId: row.id,
      to: row.toAddress,
      cc: row.cc,
      replyTo: row.replyTo,
      fromName: row.fromName,
      subject: content.subject,
      html: content.html ?? "",
      text: content.textBody,
      attachments: attachments.map((a: typeof emailOutboxAttachments.$inferSelect) => ({
        filename: a.filename,
        contentType: a.contentType,
        content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content as Uint8Array),
      })),
    });
    // The message id is recorded and any webhook that beat it is applied in one transaction,
    // under the same lock applyProviderEvent takes, so an event cannot fall between the two.
    const sent = await db.transaction(async (tx: typeof db) => {
      if (providerMessageId) await lockProviderMessage(tx, transport.name, providerMessageId);
      const [updated] = await tx
        .update(emailOutbox)
        .set({
          ...refreshed,
          status: unlessSettled(emailOutbox.status, "sent"),
          attempts,
          provider: transport.name,
          providerMessageId,
          sentAt: new Date(),
          lockedUntil: null,
          // An earlier attempt's error survives only on a terminal failure.
          lastError: sql`CASE WHEN ${emailOutbox.status} IN ('bounced', 'complained', 'dead') THEN ${emailOutbox.lastError} ELSE NULL END`,
          updatedAt: new Date(),
          ...(row.sensitive ? { html: null, textBody: null } : {}),
        })
        .where(eq(emailOutbox.id, row.id))
        .returning();
      if (!providerMessageId) return updated as EmailOutboxRow;
      return applyUnmatchedEvents(tx, updated as EmailOutboxRow, transport.name, providerMessageId);
    });
    await recordEvent(row.id, "sent", null, transport.name, providerMessageId);
    log.info({ outboxId: row.id, provider: transport.name }, "Email delivered to provider");
    return toResult(sent);
  } catch (err) {
    const message = row.sensitive
      ? "Sensitive email delivery failed"
      : (err as Error)?.message || "Email provider error";
    const permanent = err instanceof EmailTransportError && err.permanent;
    const dead = permanent || attempts >= row.maxAttempts;
    const [failed] = await db
      .update(emailOutbox)
      .set({
        ...refreshed,
        status: unlessSettled(emailOutbox.status, dead ? "dead" : "retrying"),
        attempts,
        provider: transport.name,
        lastError: unlessSettled(emailOutbox.lastError, message.slice(0, 2000)),
        lockedUntil: null,
        nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
        deadAt: unlessSettled(emailOutbox.deadAt, dead ? new Date() : null),
        updatedAt: new Date(),
        // A sensitive message the provider already settled is never retried: drop its body.
        ...(row.sensitive
          ? {
              html: sql`CASE WHEN ${emailOutbox.status} IN ('delivered', 'bounced', 'complained') THEN NULL ELSE ${emailOutbox.html} END`,
              textBody: sql`CASE WHEN ${emailOutbox.status} IN ('delivered', 'bounced', 'complained') THEN NULL ELSE ${emailOutbox.textBody} END`,
            }
          : {}),
      })
      .where(eq(emailOutbox.id, row.id))
      .returning();
    await recordEvent(row.id, dead ? "dead" : "failed", message, transport.name);
    log.warn({ outboxId: row.id, attempts, dead, err: message }, "Email delivery failed");
    return toResult(failed as EmailOutboxRow);
  }
}

async function cancelPendingEmail(id: string): Promise<OutboxResult> {
  const [cancelled] = await db
    .update(emailOutbox)
    .set({
      status: "cancelled",
      lockedUntil: null,
      updatedAt: new Date(),
      html: null,
      textBody: null,
      lastError: null,
    })
    .where(eq(emailOutbox.id, id))
    .returning();
  await recordEvent(id, "cancelled");
  return toResult(cancelled);
}

/**
 * R5-9: cancel the unsent invitation emails of one invitation (superseded by a resend, or the
 * invitation was cancelled) and drop their bodies, so no unsent message keeps a live link.
 */
export async function cancelUnsentPortalInvites(
  invitationId: string,
  exceptOutboxId?: string | null,
  executor: typeof db = db
): Promise<void> {
  await executor
    .update(emailOutbox)
    .set({
      status: "cancelled",
      lockedUntil: null,
      updatedAt: new Date(),
      html: null,
      textBody: null,
      lastError: null,
    })
    .where(
      and(
        eq(emailOutbox.category, "portal_invite"),
        eq(emailOutbox.relatedEntityType, "customer_portal_invitation"),
        eq(emailOutbox.relatedEntityId, invitationId),
        inArray(emailOutbox.status, ["queued", "retrying", "blocked_no_provider"]),
        exceptOutboxId ? sql`${emailOutbox.id} <> ${exceptOutboxId}` : undefined
      )
    );
}

/** Try to deliver one message now (no-op unless it is claimable). */
export async function deliverOutboxMessage(id: string): Promise<OutboxResult | null> {
  const [row] = await claim([id], 1);
  if (!row) {
    const [current] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id));
    return current ? toResult(current as EmailOutboxRow) : null;
  }
  return attempt(row);
}

/**
 * One worker tick: re-queue recently blocked rows when a provider is now configured, then
 * deliver due rows. Returns per-status counts.
 */
export async function processOutbox(limit = 50): Promise<Record<string, number>> {
  if (activeProviderName()) {
    await pool.query(
      `UPDATE email_outbox SET status = 'queued', next_attempt_at = now() AT TIME ZONE 'UTC', last_error = NULL,
              updated_at = now() AT TIME ZONE 'UTC'
        WHERE status = 'blocked_no_provider'
          AND category <> 'portal_invite'
          AND (NOT sensitive OR html IS NOT NULL)
          AND created_at > (now() AT TIME ZONE 'UTC') - CASE WHEN sensitive THEN interval '1 hour'
                                        ELSE interval '24 hours' END`
    );
  }
  const counts: Record<string, number> = {};
  const rows = await claim(null, limit);
  for (const row of rows) {
    const r = await attempt(row);
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }
  return counts;
}

/** Manually retry a dead / blocked / retrying row (staff action). */
export async function requeueOutboxMessage(
  id: string,
  companyId: string
): Promise<OutboxResult | null> {
  const [row] = await db
    .update(emailOutbox)
    .set({
      status: activeProviderName() ? "queued" : "blocked_no_provider",
      nextAttemptAt: new Date(),
      attempts: 0,
      deadAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emailOutbox.id, id),
        eq(emailOutbox.companyId, companyId),
        inArray(emailOutbox.status, ["dead", "blocked_no_provider", "retrying"]),
        sql`(${emailOutbox.category} <> 'portal_invite' OR ${isCurrentPortalInvite})`,
        // A body-less (sensitive, never sent) row has nothing to retry: ask for a fresh message.
        sql`(NOT ${emailOutbox.sensitive} OR ${emailOutbox.html} IS NOT NULL)`
      )
    )
    .returning();
  if (!row) return null;
  return (await deliverOutboxMessage(row.id)) ?? toResult(row as EmailOutboxRow);
}

export async function getOutboxMessage(id: string): Promise<EmailOutboxRow | undefined> {
  const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id));
  return row as EmailOutboxRow | undefined;
}

export async function listOutboxForCompany(
  companyId: string,
  opts: { relatedEntityId?: string; limit?: number } = {}
) {
  const conds = [eq(emailOutbox.companyId, companyId)];
  if (opts.relatedEntityId) conds.push(eq(emailOutbox.relatedEntityId, opts.relatedEntityId));
  const rows = await db
    .select({
      id: emailOutbox.id,
      toAddress: emailOutbox.toAddress,
      subject: emailOutbox.subject,
      idempotencyKey: emailOutbox.idempotencyKey,
      category: emailOutbox.category,
      relatedEntityType: emailOutbox.relatedEntityType,
      relatedEntityId: emailOutbox.relatedEntityId,
      status: emailOutbox.status,
      attempts: emailOutbox.attempts,
      lastError: emailOutbox.lastError,
      provider: emailOutbox.provider,
      sentAt: emailOutbox.sentAt,
      deliveredAt: emailOutbox.deliveredAt,
      bouncedAt: emailOutbox.bouncedAt,
      createdAt: emailOutbox.createdAt,
      attachmentCount: sql<number>`(SELECT count(*)::int FROM email_outbox_attachments a WHERE a.outbox_id = ${emailOutbox.id})`,
    })
    .from(emailOutbox)
    .where(and(...conds))
    .orderBy(desc(emailOutbox.createdAt))
    .limit(Math.min(opts.limit ?? 100, 500));
  return rows.map(({ idempotencyKey, ...row }) => ({
    ...row,
    subject:
      idempotencyKey?.startsWith(`notif:${RETIRED_BANK_NOTIFICATION_PREFIX}`) ||
      containsRetiredNotificationCopy(row.subject)
        ? BANK_RECONCILIATION_COPY.en
        : row.subject,
    lastError:
      row.lastError && containsRetiredNotificationCopy(row.lastError)
        ? BANK_RECONCILIATION_COPY.en
        : row.lastError,
  }));
}

export type ProviderEventType = "delivered" | "bounced" | "complained" | "opened" | "failed";

/** Serialises webhook matching with the sender recording the same provider message id. */
async function lockProviderMessage(
  tx: typeof db,
  provider: string,
  providerMessageId: string
): Promise<void> {
  const key = `email-message:${provider}:${providerMessageId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** Move a row (locked by the caller's transaction) to the state one delivery event implies. */
async function applyEventToRow(
  tx: typeof db,
  row: EmailOutboxRow,
  type: ProviderEventType,
  detail: string | null,
  at: Date
): Promise<EmailOutboxRow> {
  const patch: Partial<typeof emailOutbox.$inferInsert> = { updatedAt: new Date() };
  if (type === "delivered" && ["sent", "sending", "retrying"].includes(row.status)) {
    patch.status = "delivered";
    patch.deliveredAt = at;
    patch.lastError = null;
  } else if (type === "bounced") {
    patch.status = "bounced";
    patch.bouncedAt = at;
    patch.lastError = detail ?? "Bounced";
  } else if (type === "complained") {
    patch.status = "complained";
    patch.complainedAt = at;
  } else if (type === "failed" && row.status !== "delivered") {
    patch.status = "dead";
    patch.deadAt = at;
    patch.lastError = detail ?? "Delivery failed";
  }
  const [updated] = await tx
    .update(emailOutbox)
    .set(patch)
    .where(eq(emailOutbox.id, row.id))
    .returning();
  return updated as EmailOutboxRow;
}

/**
 * Apply the events that arrived before the row knew its provider message id. Claiming them (setting
 * outbox_id) makes this happen once.
 */
async function applyUnmatchedEvents(
  tx: typeof db,
  row: EmailOutboxRow,
  provider: string,
  providerMessageId: string
): Promise<EmailOutboxRow> {
  const unmatched = await tx
    .select()
    .from(emailDeliveryEvents)
    .where(
      and(
        isNull(emailDeliveryEvents.outboxId),
        eq(emailDeliveryEvents.provider, provider),
        eq(emailDeliveryEvents.providerMessageId, providerMessageId)
      )
    )
    .orderBy(emailDeliveryEvents.createdAt);
  let current = row;
  for (const event of unmatched as Array<typeof emailDeliveryEvents.$inferSelect>) {
    const detail = row.sensitive ? null : event.detail;
    current = await applyEventToRow(
      tx,
      current,
      event.eventType as ProviderEventType,
      detail,
      event.createdAt
    );
    await tx
      .update(emailDeliveryEvents)
      .set({ outboxId: row.id, detail })
      .where(eq(emailDeliveryEvents.id, event.id));
  }
  return current;
}

/**
 * Apply a provider delivery event (from a verified webhook). Matches by provider message id
 * (or outbox id). Returns the updated row id, or null when nothing matched yet: the event is then
 * kept and applied when the sender records that message id.
 */
export async function applyProviderEvent(evt: {
  provider: string;
  providerMessageId?: string | null;
  outboxId?: string | null;
  type: ProviderEventType;
  detail?: string | null;
}): Promise<string | null> {
  return db.transaction(async (tx: typeof db) => {
    if (evt.providerMessageId) {
      await lockProviderMessage(tx, evt.provider, evt.providerMessageId);
    }
    let row: EmailOutboxRow | undefined;
    if (evt.outboxId && /^[0-9a-f-]{36}$/i.test(evt.outboxId)) {
      const [byId] = await tx
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.id, evt.outboxId))
        .for("update");
      row = byId as EmailOutboxRow | undefined;
    }
    if (!row && evt.providerMessageId) {
      const [byMsg] = await tx
        .select()
        .from(emailOutbox)
        .where(
          and(
            eq(emailOutbox.provider, evt.provider),
            eq(emailOutbox.providerMessageId, evt.providerMessageId)
          )
        )
        .for("update");
      row = byMsg as EmailOutboxRow | undefined;
    }
    // Raw provider text (bounce messages can quote recipients or content) is kept only once the
    // row is known and not sensitive. An unmatched event keeps its type and time with no detail;
    // the row then gets the generic failure text when the event is applied.
    const detail = row && !row.sensitive ? (evt.detail ?? null) : null;
    if (row) await applyEventToRow(tx, row, evt.type, detail, new Date());
    // Not in recordEvent: a lost unmatched event must fail the webhook so the provider retries.
    await tx.insert(emailDeliveryEvents).values({
      outboxId: row?.id ?? null,
      eventType: evt.type,
      detail: detail ? detail.slice(0, 2000) : null,
      provider: evt.provider,
      providerMessageId: evt.providerMessageId ?? null,
    });
    return row?.id ?? null;
  });
}
