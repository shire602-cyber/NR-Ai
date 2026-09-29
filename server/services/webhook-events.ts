import { storage } from "../storage";
import type { SupportedWebhookEvent } from "../../shared/webhook-events";

/**
 * Translates a committed business operation (as recorded in the audit log)
 * into outbound webhook events. Lives in one place so the set of events that
 * can fire is auditable at a glance and route handlers stay untouched.
 *
 * Payloads hold identifiers, document numbers, statuses and amounts only —
 * never customer/vendor names, contact details, tokens or secrets.
 */
export interface AuditLike {
  action: string;
  companyId?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  extra?: Record<string, unknown>;
}

export interface OutboundWebhookEvent {
  event: SupportedWebhookEvent;
  payload: Record<string, unknown>;
}

type Bag = Record<string, unknown>;
const asBag = (v: unknown): Bag => (v && typeof v === "object" ? (v as Bag) : {});

/** Drops undefined values so payloads stay compact and comparable. */
function compact(obj: Bag): Bag {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

async function invoiceSnapshot(invoiceId: string, companyId: string): Promise<Bag> {
  try {
    const invoice = await storage.getInvoice(invoiceId, companyId);
    if (!invoice) return {};
    return compact({
      number: invoice.number,
      total: invoice.total,
      currency: invoice.currency,
    });
  } catch {
    return {}; // enrichment is best-effort — still emit the id-only event
  }
}

export async function webhookEventsForAudit(audit: AuditLike): Promise<OutboundWebhookEvent[]> {
  const { action, companyId, entityId } = audit;
  if (!companyId || !entityId) return [];
  const before = asBag(audit.before);
  const after = asBag(audit.after);
  const extra = asBag(audit.extra);

  switch (action) {
    case "invoice.create":
      return [
        {
          event: "invoice.created",
          payload: compact({
            invoiceId: entityId,
            number: after.number,
            total: after.total,
            currency: after.currency,
            status: after.status,
          }),
        },
      ];

    case "invoice.status_change": {
      const to = after.status;
      const event: SupportedWebhookEvent | null =
        to === "sent"
          ? "invoice.issued"
          : to === "paid"
            ? "invoice.paid"
            : to === "void" || to === "cancelled"
              ? "invoice.voided"
              : null;
      if (!event) return [];
      const snapshot = await invoiceSnapshot(entityId, companyId);
      return [
        {
          event,
          payload: compact({
            invoiceId: entityId,
            ...snapshot,
            status: to,
            previousStatus: before.status,
          }),
        },
      ];
    }

    case "invoice.payment": {
      const events: OutboundWebhookEvent[] = [
        {
          event: "payment.received",
          payload: compact({
            paymentId: extra.paymentId,
            invoiceId: entityId,
            amount: extra.amount,
            method: extra.method,
            invoiceStatus: after.status,
          }),
        },
      ];
      if (after.status === "paid" && before.status !== "paid") {
        const snapshot = await invoiceSnapshot(entityId, companyId);
        events.push({
          event: "invoice.paid",
          payload: compact({
            invoiceId: entityId,
            ...snapshot,
            status: "paid",
            previousStatus: before.status,
          }),
        });
      }
      return events;
    }

    case "invoice.credit_note":
      return [
        {
          event: "credit_note.created",
          payload: compact({
            creditNoteId: entityId,
            originalInvoiceId: before.originalInvoiceId,
            number: after.creditNoteNumber,
            total: after.total,
            currency: after.currency,
          }),
        },
      ];

    case "bill.approve":
      return [
        {
          event: "bill.approved",
          payload: compact({
            billId: entityId,
            number: after.number,
            total: after.total,
            currency: after.currency,
          }),
        },
      ];

    default:
      return [];
  }
}
