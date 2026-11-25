// WQ1 (7.25): the sent / viewed log of an invoice.
//
// * Emails are read from the durable email outbox (category invoice / reminders, related to the
//   invoice), with the outbox's CURRENT status: nothing reads "sent" unless the provider took it
//   (a company without an email provider shows "blocked_no_provider" = queued, not sent).
// * Views are recorded when the public share link is opened (invoice_events kind "viewed"),
//   at most once per invoice every VIEW_THROTTLE_MS so a refreshing customer does not flood it.
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "../db";
import { emailOutbox, invoiceEvents, invoices, type Invoice } from "../../shared/schema";
import { createLogger } from "../config/logger";

const log = createLogger("invoice-activity");

export const VIEW_THROTTLE_MS = 30 * 60 * 1000;

export interface InvoiceActivityItem {
  kind: "emailed" | "viewed";
  at: string;
  recipient: string | null;
  /** Outbox status for emails (sent, delivered, queued, blocked_no_provider, failed, ...). */
  status: string | null;
  /** True only when the provider accepted the message. */
  sent: boolean;
  subject: string | null;
}

const SENT_STATUSES = new Set(["sent", "delivered"]);

/** Record one share-link view (throttled). Never throws: the public page must still load. */
export async function recordInvoiceView(
  invoice: Pick<Invoice, "id" | "companyId">,
  now: Date = new Date()
): Promise<boolean> {
  try {
    const since = new Date(now.getTime() - VIEW_THROTTLE_MS);
    return await db.transaction(async (tx) => {
      // Serialize the check and insert even when no prior view exists to lock.
      const [locked] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.id, invoice.id), eq(invoices.companyId, invoice.companyId)))
        .for("no key update");
      if (!locked) return false;

      const [recent] = await tx
        .select({ id: invoiceEvents.id })
        .from(invoiceEvents)
        .where(
          and(
            eq(invoiceEvents.invoiceId, invoice.id),
            eq(invoiceEvents.companyId, invoice.companyId),
            eq(invoiceEvents.kind, "viewed"),
            gt(invoiceEvents.createdAt, since)
          )
        )
        .limit(1);
      if (recent) return false;

      await tx.insert(invoiceEvents).values({
        invoiceId: invoice.id,
        companyId: invoice.companyId,
        kind: "viewed",
        createdAt: now,
      });
      return true;
    });
  } catch (err) {
    log.warn({ err, invoiceId: invoice.id }, "could not record the invoice view");
    return false;
  }
}

/** Emails (from the outbox) and views of one invoice, newest first. */
export async function listInvoiceActivity(
  invoice: Pick<Invoice, "id" | "companyId">
): Promise<InvoiceActivityItem[]> {
  const emails = await db
    .select({
      toAddress: emailOutbox.toAddress,
      status: emailOutbox.status,
      subject: emailOutbox.subject,
      createdAt: emailOutbox.createdAt,
      sentAt: emailOutbox.sentAt,
    })
    .from(emailOutbox)
    .where(
      and(
        eq(emailOutbox.relatedEntityType, "invoice"),
        eq(emailOutbox.relatedEntityId, invoice.id),
        sql`(${emailOutbox.companyId} = ${invoice.companyId} OR ${emailOutbox.companyId} IS NULL)`
      )
    )
    .orderBy(desc(emailOutbox.createdAt))
    .limit(200);
  const views = await db
    .select({ createdAt: invoiceEvents.createdAt })
    .from(invoiceEvents)
    .where(
      and(
        eq(invoiceEvents.invoiceId, invoice.id),
        eq(invoiceEvents.companyId, invoice.companyId),
        eq(invoiceEvents.kind, "viewed")
      )
    )
    .orderBy(desc(invoiceEvents.createdAt))
    .limit(200);
  const items: InvoiceActivityItem[] = [
    ...emails.map((e) => ({
      kind: "emailed" as const,
      at: new Date(e.sentAt ?? e.createdAt).toISOString(),
      recipient: e.toAddress,
      status: e.status,
      sent: SENT_STATUSES.has(e.status),
      subject: e.subject,
    })),
    ...views.map((v) => ({
      kind: "viewed" as const,
      at: new Date(v.createdAt).toISOString(),
      recipient: null,
      status: null,
      sent: false,
      subject: null,
    })),
  ];
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
