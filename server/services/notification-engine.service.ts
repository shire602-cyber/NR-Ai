/**
 * Notification engine (W4-D: R13-32, R13-33, R16-18).
 *
 * Domain events (server/platform/domain-events.ts) and three daily scans become notifications
 * for the company's staff, on the channels each user allows:
 *   - in-app  (notifications row, idempotent per user + `<type>:<entity>` event key)
 *   - email   (through the durable outbox; never reported as sent unless a provider took it)
 *   - push    (web push; capability `push` is requires-external/disabled until VAPID is set)
 *
 * Preferences: notification_preferences columns (pushEnabled, emailEnabled, inAppEnabled and the
 * legacy per-category flags) plus per-type overrides in type_preferences. A user on the daily
 * digest gets non-urgent emails batched into one message by "notifications.dailyDigest".
 */
import { billHref, invoiceHref } from "../../shared/app-links";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db, pool } from "../db";
import {
  companyUsers,
  notificationPreferences,
  notifications,
  users,
  vatReturns,
  type NotificationPreferences,
} from "../../shared/schema";
import { createLogger } from "../config/logger";
import { onDomainEvent, type DomainEvent } from "../platform/domain-events";
import { listJobs, registerJob } from "../platform/job-registry";
import { sendEmail } from "./email.service";
import { renderQueuedNotificationEmail } from "./notification-email-copy";
import { isCapabilityLive } from "../../shared/capabilities";
import { notificationCopy, renderServerCopy } from "../../shared/server-copy";
import { vatFilingOutstandingFilter } from "../tax/vat-filing-filter";
import { customerVisibleNotification } from "../storage/notification-visibility";
import { deliverOutboxMessage, enqueueEmail } from "../outbox/outbox";
import { DIGEST_WINDOW_MS, renderNotificationDigest } from "./notification-digest";

const log = createLogger("notification-engine");

export const NOTIFICATION_EVENT_TYPES = [
  "invoice.issued",
  "invoice.paid",
  "invoice.overdue",
  "payment.received",
  "bill.approved",
  "bill.paid",
  "payroll.approved",
  "compliance.deadline_due",
  "task.due",
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

type Priority = "low" | "normal" | "high" | "urgent";

/** Legacy category column that also gates the type, and the default email choice. */
const TYPE_RULES: Record<
  NotificationEventType,
  {
    category: "invoiceReminders" | "paymentReceived" | "vatDeadlines" | null;
    emailByDefault: boolean;
    notificationType: string;
  }
> = {
  "invoice.issued": {
    category: "invoiceReminders",
    emailByDefault: false,
    notificationType: "system",
  },
  "invoice.paid": {
    category: "paymentReceived",
    emailByDefault: false,
    notificationType: "system",
  },
  "invoice.overdue": {
    category: "invoiceReminders",
    emailByDefault: true,
    notificationType: "overdue",
  },
  "payment.received": {
    category: "paymentReceived",
    emailByDefault: false,
    notificationType: "system",
  },
  "bill.approved": { category: null, emailByDefault: false, notificationType: "system" },
  "bill.paid": { category: null, emailByDefault: false, notificationType: "system" },
  "payroll.approved": { category: null, emailByDefault: true, notificationType: "system" },
  "compliance.deadline_due": {
    category: "vatDeadlines",
    emailByDefault: true,
    notificationType: "deadline",
  },
  "task.due": { category: null, emailByDefault: true, notificationType: "deadline" },
};

export interface Channels {
  inApp: boolean;
  email: boolean;
  push: boolean;
}

type ChannelOverride = Partial<Channels>;

function parseTypePrefs(raw: string | null | undefined): Record<string, ChannelOverride> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, ChannelOverride>) : {};
  } catch {
    return {};
  }
}

/** Pure: which channels a user gets for an event type. */
export function resolveChannels(
  prefs: NotificationPreferences | undefined | null,
  type: NotificationEventType,
  opts: { pushLive?: boolean; urgent?: boolean } = {}
): Channels {
  const rule = TYPE_RULES[type];
  const override = parseTypePrefs(prefs?.typePreferences)[type] ?? {};
  const categoryOn = rule.category && prefs ? prefs[rule.category] !== false : true;
  const inAppAllowed = (prefs?.inAppEnabled ?? true) && categoryOn;
  const emailAllowed = (prefs?.emailEnabled ?? true) && categoryOn;
  const pushAllowed = (prefs?.pushEnabled ?? false) && categoryOn && opts.pushLive === true;
  const digest = prefs?.digestFrequency === "daily" && !opts.urgent;
  return {
    inApp: inAppAllowed && override.inApp !== false,
    email: emailAllowed && (override.email ?? rule.emailByDefault) && !digest,
    push: pushAllowed && override.push !== false,
  };
}

export interface NotifyInput {
  companyId: string;
  type: NotificationEventType;
  entityId: string;
  title: string;
  message: string;
  priority?: Priority;
  actionUrl?: string | null;
  relatedEntityType?: string | null;
  /** Default: every staff member of the company (client-portal users excluded). */
  userIds?: string[];
  /** The user who performed the action already has its immediate confirmation. */
  excludeUserId?: string | null;
  /** Idempotency suffix (default: entity id) — `<type>:<key>` is unique per user. */
  eventKey?: string;
}

export interface NotifyResult {
  userId: string;
  inApp: "created" | "duplicate" | "skipped";
  email: string;
  push: string;
}

async function staffRecipients(companyId: string): Promise<Array<{ id: string; email: string }>> {
  return db
    .select({ id: users.id, email: users.email })
    .from(companyUsers)
    .innerJoin(users, eq(users.id, companyUsers.userId))
    .where(
      and(
        eq(companyUsers.companyId, companyId),
        sql`coalesce(${users.userType}, '') <> 'client_portal'`
      )
    );
}

async function loadPrefs(userIds: string[]): Promise<Map<string, NotificationPreferences>> {
  if (!userIds.length) return new Map();
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(
      sql`${notificationPreferences.userId} IN (${sql.join(
        userIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    );
  return new Map(rows.map((r: NotificationPreferences) => [r.userId, r]));
}

async function emitSocket(userId: string, row: unknown): Promise<void> {
  try {
    const { getIO } = await import("./socket.service");
    getIO()?.to(`user:${userId}`).emit("notification:new", row);
  } catch {
    // sockets are optional
  }
}

/** Fan one event out to its recipients on their allowed channels. */
export async function notify(input: NotifyInput): Promise<NotifyResult[]> {
  const eligible = input.userIds
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(
          sql`${users.id} IN (${sql.join(
            input.userIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        )
    : await staffRecipients(input.companyId);
  const recipients = eligible.filter(({ id }) => id !== input.excludeUserId);
  const prefs = await loadPrefs(recipients.map((r: { id: string }) => r.id));
  const pushLive = isCapabilityLive("push");
  const urgent = input.priority === "urgent";
  const key = `${input.type}:${input.eventKey ?? input.entityId}`;
  const results: NotifyResult[] = [];
  for (const user of recipients) {
    const ch = resolveChannels(prefs.get(user.id), input.type, { pushLive, urgent });
    const result: NotifyResult = {
      userId: user.id,
      inApp: "skipped",
      email: "skipped",
      push: "skipped",
    };
    if (ch.inApp) {
      const [row] = await db
        .insert(notifications)
        .values({
          userId: user.id,
          companyId: input.companyId,
          type: TYPE_RULES[input.type].notificationType,
          title: input.title.slice(0, 200),
          message: input.message.slice(0, 2000),
          priority: input.priority ?? "normal",
          relatedEntityType: input.relatedEntityType ?? null,
          relatedEntityId: /^[0-9a-f-]{36}$/i.test(input.entityId) ? input.entityId : null,
          actionUrl: input.actionUrl ?? null,
          isRead: false,
          isDismissed: false,
          eventKey: key,
        })
        .onConflictDoNothing()
        .returning();
      result.inApp = row ? "created" : "duplicate";
      if (row) await emitSocket(user.id, row);
      // An event already delivered to this user is not re-sent on other channels either.
      if (!row) {
        results.push(result);
        continue;
      }
    }
    if (ch.email && user.email) {
      const { subject, html, textBody } = renderQueuedNotificationEmail(input);
      const r = await sendEmail(user.email, subject, textBody, {
        html,
        companyId: input.companyId,
        category: "notification",
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: /^[0-9a-f-]{36}$/i.test(input.entityId) ? input.entityId : null,
        idempotencyKey: `notif:${key}:${user.id}`,
      });
      result.email = r.status;
    }
    if (ch.push) {
      try {
        const { sendPushNotification } = await import("./push-notification.service");
        const r = await sendPushNotification(user.id, {
          title: input.title,
          body: input.message,
          url: input.actionUrl ?? "/notifications",
          tag: key,
        });
        result.push = r.sent > 0 ? "sent" : r.failed > 0 ? "failed" : "no_subscription";
      } catch (err) {
        result.push = "failed";
        log.warn({ err: (err as Error)?.message }, "push send failed");
      }
    }
    results.push(result);
  }
  return results;
}

// ─── Domain event → notification ────────────────────────────────────────────

const fmtAmount = (fils?: number) =>
  typeof fils === "number"
    ? `AED ${(fils / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "";

async function invoiceNumber(id: string | undefined): Promise<string> {
  if (!id) return "";
  const { rows } = await pool.query(`SELECT number FROM invoices WHERE id = $1`, [id]);
  return rows[0]?.number ?? "";
}

async function billLabel(id: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT coalesce(bill_number, '') AS n, vendor_name FROM vendor_bills WHERE id = $1`,
    [id]
  );
  return rows[0] ? `${rows[0].n ? `${rows[0].n} ` : ""}(${rows[0].vendor_name})` : "";
}

/** Map a domain event to a notification (exported for tests). */
export async function notificationForEvent(event: DomainEvent): Promise<NotifyInput | null> {
  const p = event.payload as DomainEvent["payload"] & Record<string, unknown>;
  const base = { companyId: p.companyId, entityId: p.entityId };
  switch (event.type) {
    case "invoice.issued": {
      const number = (p.number as string | undefined) || (await invoiceNumber(p.entityId));
      return {
        ...base,
        type: "invoice.issued",
        ...notificationCopy(
          "notification.invoiceIssued.title",
          "notification.invoiceIssued.message",
          {
            number,
            amount: p.totalFils ? fmtAmount(p.totalFils as number) : "",
          }
        ),
        relatedEntityType: "invoice",
        actionUrl: invoiceHref(p.entityId as string),
      };
    }
    case "invoice.paid": {
      const number = await invoiceNumber(p.entityId);
      return {
        ...base,
        type: "invoice.paid",
        ...notificationCopy("notification.invoicePaid.title", "notification.invoicePaid.message", {
          number,
        }),
        relatedEntityType: "invoice",
        actionUrl: invoiceHref(p.entityId as string),
      };
    }
    case "payment.received": {
      const number = await invoiceNumber(p.invoiceId as string | undefined);
      return {
        ...base,
        type: "payment.received",
        ...notificationCopy(
          "notification.paymentReceived.title",
          "notification.paymentReceived.message",
          { number, amount: fmtAmount(p.amountFils as number) }
        ),
        relatedEntityType: "invoice",
        actionUrl: p.invoiceId ? invoiceHref(p.invoiceId as string) : "/invoices",
      };
    }
    case "bill.approved":
    case "bill.paid": {
      const label = await billLabel(p.entityId);
      const paid = event.type === "bill.paid";
      return {
        ...base,
        type: event.type,
        ...(paid
          ? notificationCopy("notification.billPaid.title", "notification.billPaid.message", {
              label,
            })
          : notificationCopy(
              "notification.billApproved.title",
              "notification.billApproved.message",
              {
                label,
              }
            )),
        relatedEntityType: "bill",
        actionUrl: p.entityId ? billHref(p.entityId as string) : "/bill-pay",
      };
    }
    case "payroll.approved":
      return {
        ...base,
        type: "payroll.approved",
        ...notificationCopy(
          "notification.payrollApproved.title",
          "notification.payrollApproved.message",
          { month: String(p.periodMonth ?? ""), year: String(p.periodYear ?? "") }
        ),
        relatedEntityType: "payroll_run",
        actionUrl: "/payroll",
      };
    case "compliance.deadline_due":
      return {
        ...base,
        type: "compliance.deadline_due",
        title: renderServerCopy("notification.deadlineDue.title", { dueDate: p.dueDate as string }),
        message: renderServerCopy(
          p.obligation
            ? "notification.deadlineDue.message"
            : "notification.deadlineDueGeneric.message",
          { obligation: p.obligation as string | undefined, dueDate: p.dueDate as string }
        ),
        priority: "high",
        actionUrl: "/compliance-calendar",
        eventKey: `${p.entityId}:${p.obligation ?? ""}:${p.dueDate ?? ""}`,
      };
    case "task.due":
      return {
        ...base,
        type: "task.due",
        ...notificationCopy("notification.taskDue.title", "notification.taskDue.message", {
          dueDate: p.dueDate as string,
        }),
        actionUrl: "/task-center",
        eventKey: `${p.entityId}:${p.dueDate ?? ""}`,
      };
    default:
      return null;
  }
}

let subscribed = false;
const unsubscribers: Array<() => void> = [];

/** Subscribe to the domain events and register the daily scans (idempotent). */
export function registerNotificationEngine(): void {
  if (!subscribed) {
    subscribed = true;
    const handle = async (event: DomainEvent) => {
      const input = await notificationForEvent(event);
      if (!input) return;
      const isSalesAction =
        event.type === "invoice.issued" ||
        event.type === "invoice.paid" ||
        event.type === "payment.received";
      await notify({ ...input, excludeUserId: isSalesAction ? event.payload.actorUserId : null });
    };
    for (const type of [
      "invoice.issued",
      "invoice.paid",
      "payment.received",
      "bill.approved",
      "bill.paid",
      "payroll.approved",
      "compliance.deadline_due",
      "task.due",
    ] as const) {
      unsubscribers.push(onDomainEvent(type, handle as never, { name: "notifications.engine" }));
    }
  }
  const have = new Set(listJobs().map((j) => j.name));
  if (!have.has("notifications.overdueScan")) {
    registerJob({
      name: "notifications.overdueScan",
      cron: "30 4 * * *",
      description: "Daily: notify staff about newly overdue invoices and VAT return deadlines",
      run: async () => {
        await scanOverdueInvoices();
        await scanVatDeadlines();
      },
    });
  }
  if (!have.has("notifications.dailyDigest")) {
    registerJob({
      name: "notifications.dailyDigest",
      cron: "0 5 * * *",
      description: "Daily digest email for users who chose it",
      run: async () => {
        await sendDailyDigests();
      },
    });
  }
}

/** Tests only. */
export function unregisterNotificationEngine(): void {
  for (const u of unsubscribers.splice(0)) u();
  subscribed = false;
}

// ─── Scans ──────────────────────────────────────────────────────────────────

/** Issued, unpaid invoices whose due date has passed: one notification per invoice. */
export async function scanOverdueInvoices(now: Date = new Date()): Promise<number> {
  const today = now.toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT i.id, i.company_id, i.number, i.customer_name, i.currency,
            (i.due_date)::date::text AS due
       FROM invoices i
      WHERE i.status IN ('sent', 'posted', 'partial')
        AND i.invoice_type <> 'credit_note'
        AND i.due_date IS NOT NULL
        AND i.due_date::date < $1::date
      ORDER BY i.due_date
      LIMIT 2000`,
    [today]
  );
  let n = 0;
  for (const r of rows) {
    await notify({
      companyId: r.company_id,
      type: "invoice.overdue",
      entityId: r.id,
      ...notificationCopy(
        "notification.invoiceOverdue.title",
        "notification.invoiceOverdue.message",
        { number: r.number, customer: r.customer_name, dueDate: r.due }
      ),
      priority: "high",
      relatedEntityType: "invoice",
      actionUrl: invoiceHref(r.id),
    });
    n++;
  }
  return n;
}

/** VAT returns with an outstanding external filing that are due within 14 days (or overdue). */
export async function scanVatDeadlines(now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({
      id: vatReturns.id,
      companyId: vatReturns.companyId,
      due: sql<string>`${vatReturns.dueDate}::date::text`,
      periodEnd: sql<string>`${vatReturns.periodEnd}::date::text`,
    })
    .from(vatReturns)
    .where(
      and(
        vatFilingOutstandingFilter,
        sql`${vatReturns.dueDate}::date <= (${now.toISOString().slice(0, 10)}::date + 14)`
      )
    );
  for (const r of rows) {
    await notify({
      companyId: r.companyId,
      type: "compliance.deadline_due",
      entityId: r.id,
      ...notificationCopy("notification.vatReturnDue.title", "notification.vatReturnDue.message", {
        dueDate: r.due,
        periodEnd: r.periodEnd,
      }),
      priority: "high",
      relatedEntityType: "vat_return",
      actionUrl: "/vat-filing",
      eventKey: `vat:${r.id}:${r.due}`,
    });
  }
  return rows.length;
}

/** One digest email per opted-in user with the undigested notifications of the last day. */
export async function sendDailyDigests(now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - DIGEST_WINDOW_MS);
  const optedIn = await db
    .select({ userId: notificationPreferences.userId, email: users.email })
    .from(notificationPreferences)
    .innerJoin(users, eq(users.id, notificationPreferences.userId))
    .where(
      and(
        eq(notificationPreferences.digestFrequency, "daily"),
        eq(notificationPreferences.emailEnabled, true)
      )
    );
  let sent = 0;
  for (const u of optedIn) {
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, u.userId),
          customerVisibleNotification(),
          isNull(notifications.digestedAt),
          gte(notifications.createdAt, since)
        )
      )
      .orderBy(notifications.createdAt, notifications.id)
      .limit(100);
    if (!rows.length || !u.email) continue;
    const day = now.toISOString().slice(0, 10);
    const { subject, html, textBody } = renderNotificationDigest(day, rows);
    try {
      const queued = await enqueueEmail({
        to: u.email,
        subject,
        html,
        text: textBody,
        category: "digest",
        idempotencyKey: `digest:${u.userId}:${day}`,
        notificationDigest: { userId: u.userId, notificationIds: rows.map(({ id }) => id) },
      });
      if (queued.duplicate) continue;
      await db
        .update(notificationPreferences)
        .set({ lastDigestAt: now })
        .where(eq(notificationPreferences.userId, u.userId));
      sent++;
      if (queued.status === "queued") await deliverOutboxMessage(queued.id);
    } catch (err) {
      log.error({ err, userId: u.userId }, "Could not queue or deliver notification digest");
    }
  }
  return sent;
}
