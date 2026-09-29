import crypto from "crypto";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { safeOutboundFetch, OutboundUrlBlockedError } from "./url-guard";

const log = createLogger("webhook-service");

/** Per-attempt network timeout. */
export const WEBHOOK_TIMEOUT_MS = 5_000;
/** Total attempts per endpoint per event (first try + retries). */
export const WEBHOOK_MAX_ATTEMPTS = 3;
/** Backoff before retry N is BASE * 4^(N-1): 1s, then 4s. */
const WEBHOOK_BACKOFF_BASE_MS = 1_000;
/** Receivers should reject signatures older than this (replay protection). */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;
const MAX_STORED_RESPONSE_CHARS = 1_000;

/**
 * Signature = "sha256=" + HMAC-SHA256(secret, `${timestamp}.${rawBody}`).
 * The timestamp is sent in X-Webhook-Timestamp (unix seconds) and is part of
 * the signed material, so a captured request cannot be replayed later.
 */
export function signWebhookPayload(secret: string, timestamp: string, body: string): string {
  const digest = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${digest}`;
}

/** Reference verifier — what a receiving system should do. */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSeconds - ts) > WEBHOOK_SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signWebhookPayload(secret, timestamp, body));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export interface DispatchOptions {
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

function truncate(text: string | null): string | null {
  if (!text) return null;
  return text.length > MAX_STORED_RESPONSE_CHARS ? text.slice(0, MAX_STORED_RESPONSE_CHARS) : text;
}

interface AttemptOutcome {
  success: boolean;
  retryable: boolean;
  responseStatus: number | null;
  responseBody: string | null;
}

async function attemptDelivery(
  endpoint: { url: string; secret: string },
  event: string,
  payloadStr: string
): Promise<AttemptOutcome> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  try {
    // safeOutboundFetch re-resolves DNS and applies SSRF checks at dispatch
    // time, never follows redirects, and caps the response body size.
    const response = await safeOutboundFetch(
      endpoint.url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Event": event,
          "X-Webhook-Timestamp": timestamp,
          "X-Webhook-Signature": signWebhookPayload(endpoint.secret, timestamp, payloadStr),
        },
        body: payloadStr,
      },
      { timeoutMs: WEBHOOK_TIMEOUT_MS }
    );
    return {
      success: response.ok,
      retryable: !response.ok && isRetryableStatus(response.status),
      responseStatus: response.status,
      responseBody: truncate(response.bodyText),
    };
  } catch (err: any) {
    if (err instanceof OutboundUrlBlockedError) {
      // Policy refusal — retrying cannot help.
      return {
        success: false,
        retryable: false,
        responseStatus: null,
        responseBody: `Blocked: ${err.message}`,
      };
    }
    return {
      success: false,
      retryable: true,
      responseStatus: null,
      responseBody: truncate(err?.message || "Network error"),
    };
  }
}

async function deliverToEndpoint(
  endpoint: { id: string; url: string; secret: string },
  event: string,
  payloadStr: string,
  sleep: (ms: number) => Promise<void>
): Promise<void> {
  let lastSuccess = false;

  for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt++) {
    const outcome = await attemptDelivery(endpoint, event, payloadStr);
    lastSuccess = outcome.success;

    try {
      await storage.createWebhookDelivery({
        webhookEndpointId: endpoint.id,
        event,
        payload: payloadStr,
        responseStatus: outcome.responseStatus,
        responseBody: outcome.responseBody,
        success: outcome.success,
        attemptNumber: attempt,
      });
    } catch (err) {
      log.error({ err, endpointId: endpoint.id }, "Failed to record webhook delivery");
    }

    log.info(
      { endpointId: endpoint.id, event, attempt, status: outcome.responseStatus, success: outcome.success },
      "Webhook attempt"
    );

    if (outcome.success || !outcome.retryable || attempt === WEBHOOK_MAX_ATTEMPTS) break;
    await sleep(WEBHOOK_BACKOFF_BASE_MS * 4 ** (attempt - 1));
  }

  try {
    await storage.updateWebhookEndpoint(endpoint.id, { lastTriggeredAt: new Date() } as any);
    if (!lastSuccess) await storage.incrementWebhookFailureCount(endpoint.id);
  } catch (err) {
    log.error({ err, endpointId: endpoint.id }, "Failed to update webhook endpoint metadata");
  }
}

/**
 * Deliver a webhook event to every active endpoint of the company that
 * subscribes to it. Never throws: all failures are logged and recorded.
 *
 * Payloads carry ids and amounts only — never secrets or credentials.
 */
export async function dispatchWebhookEvent(
  companyId: string,
  event: string,
  payload: object,
  options: DispatchOptions = {}
): Promise<void> {
  try {
    const sleep = options.sleep ?? defaultSleep;
    const endpoints = await storage.getActiveWebhookEndpointsForEvent(companyId, event);
    if (endpoints.length === 0) return;

    log.info({ companyId, event, endpointCount: endpoints.length }, "Dispatching webhook event");

    // One id per event (stable across retries) so receivers can de-duplicate.
    const payloadStr = JSON.stringify({
      id: crypto.randomUUID(),
      event,
      timestamp: new Date().toISOString(),
      data: payload,
    });

    await Promise.allSettled(
      endpoints.map(async (endpoint) => {
        if (!endpoint.secret) {
          log.warn({ endpointId: endpoint.id }, "Webhook endpoint has no secret, skipping");
          return;
        }
        try {
          await deliverToEndpoint(endpoint, event, payloadStr, sleep);
        } catch (err) {
          log.error({ err, endpointId: endpoint.id }, "Unexpected webhook delivery error");
        }
      })
    );
  } catch (err) {
    log.error({ err, companyId, event }, "Webhook dispatch failed");
  }
}

/**
 * Fire-and-forget entry point for request handlers. Call it AFTER the
 * database transaction has committed. Returns immediately; delivery (and any
 * failure) happens in the background and can never fail the request.
 */
export function emitWebhookEvent(companyId: string, event: string, payload: object): void {
  setImmediate(() => {
    dispatchWebhookEvent(companyId, event, payload).catch((err) =>
      log.error({ err, companyId, event }, "Webhook emit failed")
    );
  });
}
