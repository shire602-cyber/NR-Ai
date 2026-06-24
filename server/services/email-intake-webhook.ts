// Inbound-webhook adapter for email document intake.
//
// An email provider (Mailgun / Postmark / SendGrid Inbound Parse, etc.) is
// pointed at POST /api/webhooks/email-intake. It calls us with the parsed email
// + attachments. We verify the provider's HMAC signature, map the payload to the
// internal RawInboundMessage shape, and hand it to the shared ingest pipeline
// (ingestRawMessages) — the same one the poll-based source uses.
//
// The two functions here are pure (no I/O) so signature checking and payload
// mapping are unit-tested without a live provider. See docs/EMAIL_INTAKE_PILOT.md.

import crypto from "node:crypto";
import type { RawInboundMessage, RawAttachment } from "./email-intake";

/**
 * Verify a provider HMAC-SHA256 signature over the exact raw request body.
 * Timing-safe. `signature` is the hex digest the provider sent in its header.
 */
export function verifyInboundSignature(
  rawBody: Buffer | string,
  signature: string | undefined | null,
  secret: string | undefined | null
): boolean {
  if (!signature || !secret) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  // Strip a "sha256=" prefix some providers add.
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided.length % 2 === 0 ? provided : "", "hex");
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function firstString(...vals: unknown[]): string {
  for (const v of vals) if (typeof v === "string" && v.length > 0) return v;
  return "";
}

function toDate(v: unknown): Date {
  if (typeof v === "number") return new Date(v > 1e12 ? v : v * 1000); // s or ms epoch
  if (typeof v === "string") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

interface RawPayloadAttachment {
  filename?: string;
  name?: string;
  contentType?: string;
  type?: string;
  content?: string; // base64
  contentBase64?: string;
  data?: string;
}

/**
 * Map a provider's inbound-email JSON to RawInboundMessage[]. Defensive about
 * field naming so it tolerates Mailgun/Postmark/SendGrid-style shapes; the
 * provider should be configured to deliver base64 attachment content.
 * Returns [] for anything unparseable.
 */
export function parseInboundEmail(payload: any): RawInboundMessage[] {
  if (!payload || typeof payload !== "object") return [];

  const fromHeader = firstString(payload.from, payload.sender, payload.From, payload["from_email"]);
  if (!fromHeader) return [];

  const providerMessageId = firstString(
    payload.messageId,
    payload.MessageID,
    payload["message-id"],
    payload["Message-Id"],
    payload.id,
    crypto.randomUUID()
  );

  const subject = firstString(payload.subject, payload.Subject);
  const receivedAt = toDate(payload.timestamp ?? payload.receivedAt ?? payload.Date ?? payload.date);

  // DKIM pass can arrive as a boolean, a verdict object, or an SPF/DKIM string.
  let dkimPass: boolean | undefined;
  if (typeof payload.dkimPass === "boolean") dkimPass = payload.dkimPass;
  else if (payload.dkim && typeof payload.dkim === "object") dkimPass = payload.dkim.pass === true;
  else if (typeof payload.dkim === "string") dkimPass = /pass/i.test(payload.dkim);

  const rawAtts: RawPayloadAttachment[] = Array.isArray(payload.attachments) ? payload.attachments : [];
  const attachments: RawAttachment[] = rawAtts
    .map((a): RawAttachment | null => {
      const content = firstString(a.content, a.contentBase64, a.data);
      const filename = firstString(a.filename, a.name);
      if (!content) return null;
      return {
        filename: filename || "attachment",
        mimeType: firstString(a.contentType, a.type) || "application/octet-stream",
        content, // base64; hashAttachment/normalizeInboundMessage decode it
      };
    })
    .filter((a): a is RawAttachment => a !== null);

  return [{ providerMessageId, fromHeader, subject, receivedAt, dkimPass, attachments }];
}
