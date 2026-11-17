/**
 * Complyance webhook events -> our durable inbox (E2).
 *
 * Documented events (docs.complyance.io /one-platform/developer-portal/webhooks/events/,
 * /payload-and-delivery/, /purchase-invoices/, read 2026-11-17). Delivery body:
 *   { eventId, data: { id, type, timestamp, data: {...event fields}, metadata: { requestId } } }
 * with headers X-Webhook-Event (type), X-Webhook-ID (= eventId, same on every retry).
 *
 *   purchase.invoice.stored / purchase.invoice.validation_failed
 *       -> document.received (keyed doc:<documentId>:received, the same key as the poll, so a
 *          purchase seen by both is processed once); attribution.companyId names the company
 *   invoice.passed / invoice.failed (validation at submission only, NOT the final outcome)
 *       -> document.delivered: re-read the status (keyed doc:<documentId>:<event>)
 *   company.* / branch.* / peppol.id.* (onboarding; payload fields not documented)
 *       -> legal_entity.synchronized: re-read the company from Connect (keyed by eventId)
 * Everything else (credits, UAM, reports, ...) is acknowledged and ignored.
 */
import type { CanonicalEventType } from "../provider-events";

export interface NormalisedEvent {
  type: CanonicalEventType;
  payload: Record<string, unknown>;
}

const str = (v: unknown): string | null =>
  v === undefined || v === null || v === "" ? null : String(v);

const ONBOARDING_EVENTS = new Set([
  "company.added.successfully",
  "company.data.modified",
  "company.deleted",
  "branch.egs.added",
  "branch.egs.deleted",
  "branch.data.modified",
  "peppol.id.created",
  "peppol.id.removed",
  "peppol.id.deleted",
]);

export function normaliseComplyanceEvent(args: {
  eventType: string | null | undefined;
  eventId: string | null | undefined;
  body: Record<string, unknown>;
}): NormalisedEvent | null {
  const envelope = (args.body.data ?? {}) as Record<string, unknown>;
  const type = String(args.eventType ?? envelope.type ?? "").toLowerCase();
  const eventId = str(args.eventId) ?? str(args.body.eventId) ?? str(envelope.id);
  const data = (envelope.data ?? {}) as Record<string, unknown>;
  const timestamp = str(envelope.timestamp);

  if (type === "purchase.invoice.stored" || type === "purchase.invoice.validation_failed") {
    const documentId = str(data.documentId);
    if (!documentId) return null;
    const attribution = (data.attribution ?? {}) as Record<string, unknown>;
    return {
      type: "document.received",
      payload: {
        documentId,
        documentNumber: str(data.documentNumber),
        documentType: String(data.documentType ?? "") === "credit_note" ? "credit-note" : "invoice",
        status: "received",
        complyanceCompanyId: str(attribution.companyId),
        validationFailed: type === "purchase.invoice.validation_failed",
        webhookEventId: eventId,
        webhookEvent: type,
      },
    };
  }
  if (type === "invoice.passed" || type === "invoice.failed") {
    const documentId = str(data.documentId);
    if (!documentId) return null;
    return {
      type: "document.delivered",
      payload: {
        documentId,
        documentNumber: str(data.documentNumber),
        status: type,
        webhookEventId: eventId,
      },
    };
  }
  if (ONBOARDING_EVENTS.has(type)) {
    if (!eventId) return null;
    return {
      type: "legal_entity.synchronized",
      payload: {
        eventId,
        legalEntityId: str(data.companyId),
        tin: str(data.tin),
        action: type,
        timestamp,
      },
    };
  }
  return null;
}
