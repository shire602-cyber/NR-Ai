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
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../db";
import {
  emailDeliveryEvents,
  emailOutbox,
  emailOutboxAttachments,
  customerPortalInvitations,
  type EmailOutboxRow,
  type EmailOutboxStatus,
} from "../../shared/schema";
import { createLogger } from "../config/logger";
import {
  EmailTransportError,
  activeProviderName,
  resolveTransport,
  type OutgoingAttachment,
} from "./providers";

const log = createLogger("email-outbox");

export const DEFAULT_MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 60_000; // 1, 2, 4, 8, 16 min …
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
const LOCK_MS = 5 * 60 * 1000;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

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
  const insert = async (tx: typeof db) => {
    const now = new Date();
    const [inserted] = await tx
      .insert(emailOutbox)
      .values({
        companyId: input.companyId ?? null,
        toAddress: input.to.trim(),
        cc: input.cc ?? null,
        replyTo: input.replyTo ?? null,
        fromName: input.fromName ?? null,
        subject: input.subject.slice(0, 998),
        html: input.html,
        textBody: input.text ?? null,
        category: input.category ?? "generic",
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
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
  if (row.category === "portal_invite") {
    const [current] = await db
      .select({ id: emailOutbox.id })
      .from(emailOutbox)
      .where(and(eq(emailOutbox.id, row.id), isCurrentPortalInvite));
    if (!current) {
      const [cancelled] = await db
        .update(emailOutbox)
        .set({ status: "cancelled", lockedUntil: null, updatedAt: new Date() })
        .where(eq(emailOutbox.id, row.id))
        .returning();
      await recordEvent(row.id, "cancelled");
      return toResult(cancelled);
    }
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
  try {
    const { providerMessageId } = await transport.send({
      outboxId: row.id,
      to: row.toAddress,
      cc: row.cc,
      replyTo: row.replyTo,
      fromName: row.fromName,
      subject: row.subject,
      html: row.html ?? "",
      text: row.textBody,
      attachments: attachments.map((a: typeof emailOutboxAttachments.$inferSelect) => ({
        filename: a.filename,
        contentType: a.contentType,
        content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content as Uint8Array),
      })),
    });
    const [sent] = await db
      .update(emailOutbox)
      .set({
        status: "sent",
        attempts,
        provider: transport.name,
        providerMessageId,
        sentAt: new Date(),
        lockedUntil: null,
        lastError: null,
        updatedAt: new Date(),
        ...(row.sensitive ? { html: null, textBody: null } : {}),
      })
      .where(eq(emailOutbox.id, row.id))
      .returning();
    await recordEvent(row.id, "sent", null, transport.name, providerMessageId);
    log.info({ outboxId: row.id, provider: transport.name }, "Email delivered to provider");
    return toResult(sent as EmailOutboxRow);
  } catch (err) {
    const message = row.sensitive
      ? "Sensitive email delivery failed"
      : (err as Error)?.message || "Email provider error";
    const permanent = err instanceof EmailTransportError && err.permanent;
    const dead = permanent || attempts >= row.maxAttempts;
    const [failed] = await db
      .update(emailOutbox)
      .set({
        status: dead ? "dead" : "retrying",
        attempts,
        provider: transport.name,
        lastError: message.slice(0, 2000),
        lockedUntil: null,
        nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
        deadAt: dead ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(emailOutbox.id, row.id))
      .returning();
    await recordEvent(row.id, dead ? "dead" : "failed", message, transport.name);
    log.warn({ outboxId: row.id, attempts, dead, err: message }, "Email delivery failed");
    return toResult(failed as EmailOutboxRow);
  }
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
        sql`(${emailOutbox.category} <> 'portal_invite' OR ${isCurrentPortalInvite})`
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
  return db
    .select({
      id: emailOutbox.id,
      toAddress: emailOutbox.toAddress,
      subject: emailOutbox.subject,
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
}

export type ProviderEventType = "delivered" | "bounced" | "complained" | "opened" | "failed";

/**
 * Apply a provider delivery event (from a verified webhook). Matches by provider message id
 * (or outbox id). Returns the updated row id, or null when nothing matched.
 */
export async function applyProviderEvent(evt: {
  provider: string;
  providerMessageId?: string | null;
  outboxId?: string | null;
  type: ProviderEventType;
  detail?: string | null;
}): Promise<string | null> {
  let row: EmailOutboxRow | undefined;
  if (evt.outboxId && /^[0-9a-f-]{36}$/i.test(evt.outboxId)) {
    row = await getOutboxMessage(evt.outboxId);
  }
  if (!row && evt.providerMessageId) {
    const [byMsg] = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.providerMessageId, evt.providerMessageId));
    row = byMsg as EmailOutboxRow | undefined;
  }
  if (!row) {
    await recordEvent(null, evt.type, null, evt.provider, evt.providerMessageId);
    return null;
  }
  const detail = row.sensitive ? null : evt.detail;
  const now = new Date();
  const patch: Partial<typeof emailOutbox.$inferInsert> = { updatedAt: now };
  if (evt.type === "delivered" && ["sent", "sending", "retrying"].includes(row.status)) {
    patch.status = "delivered";
    patch.deliveredAt = now;
  } else if (evt.type === "bounced") {
    patch.status = "bounced";
    patch.bouncedAt = now;
    patch.lastError = detail ?? "Bounced";
  } else if (evt.type === "complained") {
    patch.status = "complained";
    patch.complainedAt = now;
  } else if (evt.type === "failed" && row.status !== "delivered") {
    patch.status = "dead";
    patch.deadAt = now;
    patch.lastError = detail ?? "Delivery failed";
  }
  await db.update(emailOutbox).set(patch).where(eq(emailOutbox.id, row.id));
  await recordEvent(row.id, evt.type, detail, evt.provider, evt.providerMessageId);
  return row.id;
}
