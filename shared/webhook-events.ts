/**
 * The only events the platform actually emits. Endpoints may subscribe to
 * these (or "*"); anything else is rejected at registration so customers are
 * never offered an event that will never fire.
 */
export const SUPPORTED_WEBHOOK_EVENTS = [
  "invoice.created",
  "invoice.issued",
  "invoice.paid",
  "invoice.voided",
  "credit_note.created",
  "bill.approved",
  "payment.received",
] as const;

export type SupportedWebhookEvent = (typeof SUPPORTED_WEBHOOK_EVENTS)[number];

const SUPPORTED_SET = new Set<string>(SUPPORTED_WEBHOOK_EVENTS);

export type EventSubscriptionResult = { ok: true; events: string } | { ok: false; message: string };

/**
 * Normalises a comma-separated subscription ("*" means everything) and rejects
 * events the platform never emits, so nobody subscribes to something that
 * cannot fire.
 */
export function parseEventSubscription(raw: unknown): EventSubscriptionResult {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, message: "At least one event is required" };
  }
  const events = Array.from(
    new Set(
      raw
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean)
    )
  );
  if (events.length === 0) return { ok: false, message: "At least one event is required" };
  const unknown = events.filter((e) => e !== "*" && !SUPPORTED_SET.has(e));
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `Unsupported event(s): ${unknown.join(", ")}. Supported: ${SUPPORTED_WEBHOOK_EVENTS.join(", ")}`,
    };
  }
  return { ok: true, events: events.join(",") };
}
