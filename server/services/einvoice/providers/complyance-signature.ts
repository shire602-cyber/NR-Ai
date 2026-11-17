/**
 * Complyance webhook signature (E2).
 *
 * Documented scheme (docs.complyance.io /one-platform/developer-portal/webhooks/payload-and-delivery/,
 * read 2026-11-17): with HMAC signing on, every delivery carries `X-Webhook-Signature`, the HMAC of
 * the raw request body with the webhook's signing secret, as lowercase hex; the algorithm is the
 * one chosen when the webhook was created (sha256 recommended, sha512 allowed). `X-Webhook-ID` is
 * the event id (same on every retry), `X-Webhook-Timestamp` the time of this delivery attempt.
 *
 * Replay: the timestamp is NOT covered by the HMAC, so it cannot prove freshness; the real replay
 * defence is the durable inbox, unique on the event id (a replayed event is a duplicate and is not
 * processed twice). We still refuse a delivery whose timestamp header is older than the window
 * (COMPLYANCE_WEBHOOK_MAX_AGE_SECONDS, default 1 hour; Complyance retries for ~36 minutes and
 * stamps each attempt) as a cheap filter for naive replays.
 */
import crypto from "node:crypto";

export type ComplyanceHmacAlgorithm = "sha256" | "sha512";

export function complyanceWebhookAlgorithm(
  env: NodeJS.ProcessEnv = process.env
): ComplyanceHmacAlgorithm {
  return (env.COMPLYANCE_WEBHOOK_ALGORITHM ?? "").toLowerCase() === "sha512" ? "sha512" : "sha256";
}

export function complyanceWebhookMaxAgeSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.COMPLYANCE_WEBHOOK_MAX_AGE_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 3600;
}

/** Lowercase-hex HMAC of the raw body (what Complyance sends; used by tests and fixtures). */
export function signComplyanceBody(
  raw: Buffer | string,
  secret: string,
  algorithm: ComplyanceHmacAlgorithm = "sha256"
): string {
  return crypto.createHmac(algorithm, secret).update(raw).digest("hex");
}

export type ComplyanceVerdict =
  | { ok: true }
  | { ok: false; reason: "missing_signature" | "bad_signature" | "stale" };

/** Parse X-Webhook-Timestamp: ISO 8601, unix seconds or unix milliseconds. Null when unreadable. */
export function parseWebhookTimestamp(value: string | undefined | null): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d{10}$/.test(v)) return Number(v) * 1000;
  if (/^\d{13}$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export function verifyComplyanceSignature(args: {
  raw: Buffer;
  signature: string | undefined | null;
  secret: string;
  algorithm?: ComplyanceHmacAlgorithm;
  timestamp?: string | null;
  maxAgeSeconds?: number;
  now?: number;
}): ComplyanceVerdict {
  const algorithm = args.algorithm ?? "sha256";
  const hexLength = algorithm === "sha512" ? 128 : 64;
  const given = (args.signature ?? "").trim();
  if (!given) return { ok: false, reason: "missing_signature" };
  if (!new RegExp(`^[0-9a-f]{${hexLength}}$`).test(given)) {
    return { ok: false, reason: "bad_signature" };
  }
  const expected = signComplyanceBody(args.raw, args.secret, algorithm);
  if (!crypto.timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"))) {
    return { ok: false, reason: "bad_signature" };
  }
  const at = parseWebhookTimestamp(args.timestamp);
  if (at !== null && args.maxAgeSeconds) {
    const now = args.now ?? Date.now();
    if (now - at > args.maxAgeSeconds * 1000) return { ok: false, reason: "stale" };
  }
  return { ok: true };
}
