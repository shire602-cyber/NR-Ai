/**
 * Provider delivery-event parsing for the outbox (W4-D, R16-17).
 *
 *   Resend: Svix-signed JSON (`svix-id`, `svix-timestamp`, `svix-signature`), secret
 *           RESEND_WEBHOOK_SECRET ("whsec_<base64>").
 *   SMTP:   an RFC 3464 delivery status notification (multipart/report or the bare
 *           message/delivery-status part), posted by the MTA or a relay with the shared secret
 *           EMAIL_DSN_WEBHOOK_SECRET in `x-webhook-secret`.
 *
 * Parsers are pure so they can be unit-tested without a database.
 */
import crypto from "crypto";
import type { ProviderEventType } from "./outbox";

export interface ParsedDeliveryEvent {
  providerMessageId: string | null;
  outboxId: string | null;
  type: ProviderEventType;
  detail: string | null;
  /** When the provider says the event happened (null when the payload carries no usable time). */
  occurredAt: Date | null;
}

/** A provider timestamp, or null when absent or unparseable. Future times are clamped to now. */
export function parseEventTime(value: unknown, now: Date = new Date()): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return at.getTime() > now.getTime() ? now : at;
}

const RESEND_TYPES: Record<string, ProviderEventType> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "opened",
  "email.failed": "failed",
};

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Svix signature check. Returns false on any malformed input. */
export function verifySvixSignature(args: {
  secret: string;
  id: string | undefined;
  timestamp: string | undefined;
  signatureHeader: string | undefined;
  body: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  const { secret, id, timestamp, signatureHeader, body } = args;
  if (!secret || !id || !timestamp || !signatureHeader) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (args.toleranceSeconds ?? 300)) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return signatureHeader
    .split(" ")
    .map((part) => part.split(",")[1] ?? "")
    .some((sig) => sig && timingSafeEqualStr(sig, expected));
}

export function parseResendEvent(body: unknown): ParsedDeliveryEvent | null {
  const evt = body as {
    type?: string;
    created_at?: string;
    data?: { email_id?: string; bounce?: { message?: string; type?: string } };
  } | null;
  const type = evt?.type ? RESEND_TYPES[evt.type] : undefined;
  if (!type) return null;
  const detail =
    type === "bounced"
      ? [evt?.data?.bounce?.type, evt?.data?.bounce?.message].filter(Boolean).join(": ") || null
      : null;
  return {
    providerMessageId: evt?.data?.email_id ?? null,
    outboxId: null,
    type,
    detail,
    occurredAt: parseEventTime(evt?.created_at),
  };
}

function headerValue(block: string, name: string): string | null {
  const re = new RegExp(`^${name}:[ \\t]*(.+(?:\\r?\\n[ \\t].+)*)`, "im");
  const m = block.match(re);
  return m ? m[1].replace(/\r?\n[ \t]+/g, " ").trim() : null;
}

/**
 * Parse an RFC 3464 DSN. Identifies the original message by Original-Message-ID / Message-ID
 * (`<outbox-<uuid>@muhasib.ai>`) or the X-Muhasib-Outbox-Id header of the returned headers.
 */
export function parseSmtpDsn(raw: string): ParsedDeliveryEvent | null {
  if (!raw || typeof raw !== "string") return null;
  const action = headerValue(raw, "Action")?.toLowerCase() ?? null;
  const status = headerValue(raw, "Status");
  if (!action) return null;
  let type: ProviderEventType;
  if (action === "failed") type = "bounced";
  else if (action === "delivered" || action === "relayed" || action === "expanded")
    type = "delivered";
  else return null; // delayed: not final
  const messageId =
    headerValue(raw, "Original-Message-ID") ??
    headerValue(raw, "Original-Envelope-Id") ??
    headerValue(raw, "Message-ID");
  const outboxHeader = headerValue(raw, "X-Muhasib-Outbox-Id");
  const fromMessageId = messageId?.match(/outbox-([0-9a-f-]{36})@/i)?.[1] ?? null;
  const diagnostic = headerValue(raw, "Diagnostic-Code");
  return {
    providerMessageId: messageId,
    outboxId: outboxHeader ?? fromMessageId,
    type,
    detail: [status, diagnostic].filter(Boolean).join(" ") || null,
    occurredAt: parseEventTime(headerValue(raw, "Arrival-Date")),
  };
}
