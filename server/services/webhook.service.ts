/**
 * Outbound webhooks (W5-B, R19-02, R19-15).
 *
 * Domain events (server/platform/domain-events.ts) are subscribed once at
 * startup. Every event a company's active endpoint subscribes to becomes a
 * durable `webhook_deliveries` row (status pending), unique per (endpoint,
 * event id), and is attempted straight away. Confirmed HTTP failures and
 * failures before sending are retried with backoff by `webhooks.deliveryRetry`.
 * An unknown send outcome is dead-lettered without replay.
 *
 * Signature (documented in docs/api/webhooks.md):
 *   X-Muhasib-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>
 *   X-Webhook-Signature: sha256=<hex HMAC-SHA256(secret, body)>   (legacy header)
 * Endpoint secrets are stored encrypted (secret vault) and decrypted only to sign.
 *
 * Plan gate: deliveries are created only when the company's plan has the
 * `webhooks` feature (or billing enforcement is off).
 */
import crypto from "node:crypto";
import { pool } from "../db";
import { pq } from "./connectors/pq";
import { createLogger } from "../config/logger";
import {
  safeOutboundFetch,
  OutboundUrlBlockedError,
  OUTBOUND_RESPONSE_BODY_TIMEOUT_MS,
} from "./url-guard";
import { decryptSecret } from "./secret-vault";
import { onDomainEvent, type DomainEvent, type DomainEventType } from "../platform/domain-events";
import { listJobs, registerJob } from "../platform/job-registry";
import { billingEnforced, companyPlanId, getTierFeatures } from "../middleware/featureGate";

const log = createLogger("webhook-service");

// ─── Event catalogue ─────────────────────────────────────────────────────────

export interface WebhookEventInfo {
  type: DomainEventType;
  en: string;
  ar: string;
}

export const WEBHOOK_EVENTS: readonly WebhookEventInfo[] = [
  { type: "invoice.created", en: "A draft invoice was created", ar: "تم إنشاء مسودة فاتورة" },
  { type: "invoice.issued", en: "An invoice was issued", ar: "تم إصدار فاتورة" },
  { type: "invoice.paid", en: "An invoice was paid in full", ar: "تم سداد فاتورة بالكامل" },
  { type: "invoice.voided", en: "An invoice was voided", ar: "تم إلغاء فاتورة" },
  { type: "payment.received", en: "A customer payment was recorded", ar: "تم تسجيل دفعة عميل" },
  { type: "credit_note.issued", en: "A credit note was issued", ar: "تم إصدار إشعار دائن" },
  { type: "bill.approved", en: "A vendor bill was approved", ar: "تمت الموافقة على فاتورة مورد" },
  { type: "bill.paid", en: "A vendor bill was paid", ar: "تم سداد فاتورة مورد" },
  { type: "contact.created", en: "A contact was created", ar: "تم إنشاء جهة اتصال" },
  { type: "payroll.approved", en: "A payroll run was approved", ar: "تمت الموافقة على مسير رواتب" },
  { type: "payroll.paid", en: "A payroll run was paid", ar: "تم دفع مسير رواتب" },
];

export const WEBHOOK_EVENT_TYPES: readonly string[] = WEBHOOK_EVENTS.map((e) => e.type);

/** Parse "a,b" / ["a","b"] / "*" into a normalised comma list; unknown names throw. */
export function normaliseEventList(input: string | string[]): string {
  const list = (Array.isArray(input) ? input : input.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.includes("*")) return "*";
  const unknown = list.filter((e) => !WEBHOOK_EVENT_TYPES.includes(e));
  if (unknown.length) throw new Error(`Unknown webhook event(s): ${unknown.join(", ")}`);
  if (!list.length) throw new Error("At least one event is required");
  return [...new Set(list)].join(",");
}

// ─── Transport (injectable for tests) ────────────────────────────────────────

export interface WebhookTransportResult {
  status: number;
  ok: boolean;
  bodyText: string;
}
export interface WebhookTransportRequest {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
  /** Await before sending HTTP bytes, then call the returned function at the write. */
  prepareTransmission: () => Promise<() => void>;
  onResponseHeaders: (status: number) => void;
}
export type WebhookTransport = (
  url: string,
  init: WebhookTransportRequest
) => Promise<WebhookTransportResult>;

const WEBHOOK_TIMEOUT_MS = 15_000;
const UNKNOWN_OUTCOME = "Webhook delivery outcome unknown";
const SIGNING_FAILED = "Webhook signing failed before sending";
const CLAIMED_BEFORE_SEND = "Webhook delivery claimed before sending";
const PRE_SEND_FAILURE = "Webhook delivery failed before sending";
const REPLAYABLE_PRE_SEND_ERRORS = [SIGNING_FAILED, PRE_SEND_FAILURE];

const defaultTransport: WebhookTransport = (
  url,
  { prepareTransmission, onResponseHeaders, ...init }
) =>
  safeOutboundFetch(url, init, {
    timeoutMs: WEBHOOK_TIMEOUT_MS,
    prepareTransmission,
    onResponseHeaders,
  });

let transport: WebhookTransport = defaultTransport;

/** Tests: route deliveries to a mock endpoint. Pass null to restore. */
export function setWebhookTransport(t: WebhookTransport | null): void {
  transport = t ?? defaultTransport;
}

async function postWebhook(
  url: string,
  init: Omit<WebhookTransportRequest, "signal" | "prepareTransmission" | "onResponseHeaders">,
  prepareTransmission: (signal: AbortSignal) => Promise<() => void>,
  parentSignal?: AbortSignal
): Promise<WebhookTransportResult> {
  const controller = new AbortController();
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, controller.signal])
    : controller.signal;
  signal.throwIfAborted();
  const abort = () => controller.abort();
  let timer = setTimeout(abort, WEBHOOK_TIMEOUT_MS);
  let observedResponse: WebhookTransportResult | undefined;
  let onAbort!: () => void;
  try {
    const aborted = new Promise<WebhookTransportResult>((resolve, reject) => {
      // An observed status is authoritative even if a caller cancels while the body is open.
      onAbort = () => (observedResponse ? resolve(observedResponse) : reject(signal.reason));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([
      transport(url, {
        ...init,
        signal,
        prepareTransmission: () => prepareTransmission(signal),
        onResponseHeaders: (status) => {
          if (signal.aborted || observedResponse) return;
          observedResponse = { status, ok: status >= 200 && status < 300, bodyText: "" };
          clearTimeout(timer);
          timer = setTimeout(abort, OUTBOUND_RESPONSE_BODY_TIMEOUT_MS);
        },
      }),
      aborted,
    ]);
  } catch (err) {
    if (observedResponse) return observedResponse;
    throw err;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

// ─── Signing ─────────────────────────────────────────────────────────────────

export function signWebhookPayload(secret: string, body: string, timestamp: number) {
  const v1 = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const legacy = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return { header: `t=${timestamp},v1=${v1}`, v1, legacy: `sha256=${legacy}` };
}

/** Receiver-side check (exported for docs/tests): constant-time, 5-minute tolerance. */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=", 2) as [string, string])
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > toleranceSeconds || !parts.v1) return false;
  const expected = signWebhookPayload(secret, body, t).v1;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(String(parts.v1), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Delay before attempt n+1 after n failed attempts: 30s, 2m, 8m, 32m, ~2h, capped at 6h. */
export function webhookBackoffMs(failedAttempts: number): number {
  return Math.min(30_000 * 4 ** Math.max(0, failedAttempts - 1), 6 * 3600_000);
}

export const DEFAULT_MAX_ATTEMPTS = 6;

// ─── Queue ───────────────────────────────────────────────────────────────────

interface EndpointRow {
  id: string;
  company_id: string;
  url: string;
  secret: string;
  events: string;
  is_active: boolean;
}

function subscribes(events: string, type: string): boolean {
  const list = events.split(",").map((e) => e.trim());
  return list.includes("*") || list.includes(type);
}

async function companyHasWebhooks(companyId: string): Promise<boolean> {
  if (!billingEnforced()) return true;
  // Fails closed (S5): no subscription row = Free; null only for firm-billed client books.
  const planId = await companyPlanId(companyId);
  return planId === null || !!getTierFeatures(planId).webhooks;
}

/**
 * Queue one event for every subscribed active endpoint of the company and
 * attempt delivery now. Returns the delivery ids created.
 */
export async function enqueueWebhookEvent(
  companyId: string,
  type: string,
  data: Record<string, unknown>,
  eventId: string = crypto.randomUUID(),
  opts: { durable?: boolean; signal?: AbortSignal } = {}
): Promise<string[]> {
  const { rows: endpoints } = await pq<EndpointRow>(
    `SELECT id, company_id, url, secret, events, is_active
       FROM webhook_endpoints WHERE company_id = $1 AND is_active = true`,
    [companyId]
  );
  const targets = endpoints.filter((e: EndpointRow) => subscribes(e.events, type));
  if (!targets.length) return [];
  if (!(await companyHasWebhooks(companyId))) {
    log.info({ companyId, type }, "Webhooks not on this plan; event not queued");
    return [];
  }
  const body = JSON.stringify({
    id: eventId,
    type,
    createdAt: new Date().toISOString(),
    companyId,
    data,
  });
  const ids: string[] = [];
  for (const ep of targets) {
    // Historical deliveries stored the outbox ID only in their envelope. On outbox
    // redelivery, reuse that record and its original ID instead of posting again.
    const { rows } = await pq<{ id: string }>(
      `INSERT INTO webhook_deliveries
         (webhook_endpoint_id, company_id, event, event_id, payload, status, attempt_number,
          max_attempts, next_attempt_at, success, updated_at)
       SELECT $1, $2, $3, $4, $5, 'pending', 0, $6, now(), false, now()
       WHERE NOT EXISTS (
         SELECT 1
           FROM domain_event_outbox source
           JOIN webhook_deliveries previous
             ON previous.webhook_endpoint_id = $1
            AND previous.company_id = $2
            AND previous.event = $3
          WHERE source.id = $7::uuid AND source.attempts > 1
            AND CASE WHEN pg_input_is_valid(previous.payload, 'jsonb')
                     THEN previous.payload::jsonb #>> '{data,eventId}' END = $4
       )
       ON CONFLICT (webhook_endpoint_id, event_id) WHERE event_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [ep.id, companyId, type, eventId, body, DEFAULT_MAX_ATTEMPTS, opts.durable ? eventId : null]
    );
    if (rows[0]) ids.push(rows[0].id);
  }
  for (const id of ids) await attemptWebhookDelivery(id, { signal: opts.signal });
  return ids;
}

interface ClaimedDelivery {
  id: string;
  webhook_endpoint_id: string;
  event: string;
  event_id: string | null;
  payload: string;
  attempt_number: number;
  max_attempts: number;
  claim_at: string;
  previous_status: "pending" | "retrying";
  previous_error: string | null;
  url: string;
  secret: string;
}

/**
 * Attempt one delivery if it is due. The claim is a single conditional
 * UPDATE (status -> in_flight), so the retry job and an immediate attempt
 * never send the same row twice.
 */
export async function attemptWebhookDelivery(
  deliveryId: string,
  opts: { force?: boolean; signal?: AbortSignal } = {}
): Promise<"delivered" | "retrying" | "dead" | "skipped"> {
  if (opts.signal?.aborted) return "skipped";
  const { rows } = await pq<ClaimedDelivery>(
    `WITH ready AS (
       SELECT d.id, d.status, d.last_error, e.url, e.secret
         FROM webhook_deliveries d
         JOIN webhook_endpoints e ON e.id = d.webhook_endpoint_id AND e.is_active
        WHERE d.id = $1
          AND (d.status = 'pending' OR (d.status = 'retrying'
            AND (d.response_status IS NOT NULL OR d.last_error LIKE 'Blocked: %' OR d.last_error = $4)))
          AND d.attempt_number < d.max_attempts
          AND ($2::boolean OR d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
        FOR UPDATE OF d
     )
     UPDATE webhook_deliveries d
        SET status = 'in_flight', attempt_number = d.attempt_number + 1,
            last_error = $3,
            updated_at = GREATEST(clock_timestamp()::timestamp, d.updated_at + interval '1 microsecond')
       FROM ready
      WHERE d.id = ready.id
      RETURNING d.id, d.webhook_endpoint_id, d.event, d.event_id, d.payload, d.attempt_number,
                d.max_attempts, d.updated_at::text AS claim_at,
                ready.status AS previous_status, ready.last_error AS previous_error,
                ready.url, ready.secret`,
    [deliveryId, opts.force === true, CLAIMED_BEFORE_SEND, PRE_SEND_FAILURE]
  );
  const row = rows[0];
  if (!row) return "skipped";

  const attempt = row.attempt_number;
  let status: number | null = null;
  let responseBody: string | null = null;
  let ok = false;
  let error: string | null = null;
  let signatureHeader = "";
  let sendStarted = false;
  let retryable = false;
  try {
    const secret = decryptSecret(row.secret) ?? "";
    const sig = signWebhookPayload(secret, row.payload, Math.floor(Date.now() / 1000));
    signatureHeader = sig.header;
    const res = await postWebhook(
      row.url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Muhasib-Webhooks/1.0",
          "X-Muhasib-Signature": sig.header,
          "X-Webhook-Signature": sig.legacy,
          "X-Webhook-Event": row.event,
          "X-Webhook-Id": row.event_id?.split("#replay-", 1)[0] ?? row.id,
          "X-Webhook-Delivery": row.id,
          "X-Webhook-Attempt": String(attempt),
        },
        body: row.payload,
      },
      async (signal) => {
        signal.throwIfAborted();
        // A pause before sending restores the previous queue state, including its
        // attempt budget. Clearing the marker when active makes interrupted sends
        // conservative across restarts. Keep the exact claim timestamp as a fence
        // so an old worker cannot complete a new claim reusing its attempt number.
        const prepared = await pool.query<{ is_active: boolean }>(
          `UPDATE webhook_deliveries d
              SET status = CASE WHEN e.is_active THEN d.status ELSE $5 END,
                  attempt_number = d.attempt_number - (NOT e.is_active)::integer,
                  last_error = CASE WHEN e.is_active THEN NULL ELSE $6 END
             FROM webhook_endpoints e
            WHERE d.id = $1 AND d.status = 'in_flight' AND d.attempt_number = $2 AND d.last_error = $3
              AND d.updated_at = $4::timestamp AND e.id = d.webhook_endpoint_id
           RETURNING e.is_active`,
          [
            row.id,
            attempt,
            CLAIMED_BEFORE_SEND,
            row.claim_at,
            row.previous_status,
            row.previous_error,
          ]
        );
        if (!prepared.rows[0]?.is_active) {
          throw new Error("Webhook delivery is no longer eligible to send");
        }
        return () => {
          signal.throwIfAborted();
          sendStarted = true;
        };
      },
      opts.signal
    );
    status = res.status;
    // PostgreSQL text rejects NUL. UTF-8 encoding also replaces any surrogate
    // split by truncation, so an arbitrary body preview cannot block completion.
    const preview = (res.bodyText || "").slice(0, 2_000).replaceAll("\0", "\uFFFD");
    responseBody = Buffer.from(preview, "utf8").toString("utf8") || null;
    ok = res.status >= 200 && res.status < 300;
    retryable = !ok;
    if (!ok) error = `HTTP ${res.status}`;
  } catch (err) {
    if (sendStarted) {
      // A timeout or lost connection can hide a successful receiver-side commit.
      error = `${UNKNOWN_OUTCOME} after transport failure`;
    } else if (err instanceof OutboundUrlBlockedError) {
      // The URL guard rejected the destination before opening a connection.
      error = `Blocked: ${err.message}`;
      retryable = true;
    } else if (signatureHeader) {
      error = PRE_SEND_FAILURE;
      retryable = true;
    } else {
      error = SIGNING_FAILED;
    }
  }

  const outcome = ok ? "delivered" : retryable && attempt < row.max_attempts ? "retrying" : "dead";
  // A socket or DNS failure can occur before the transport reaches the fence.
  // Restore the unused attempt if completion finds the endpoint paused and the
  // durable pre-send marker still present.
  const completed = await pool.query(
    `WITH claimed AS (
       SELECT d.id, $11::boolean AND d.last_error IS NOT DISTINCT FROM $12 AND NOT e.is_active AS paused
         FROM webhook_deliveries d
         JOIN webhook_endpoints e ON e.id = d.webhook_endpoint_id
        WHERE d.id = $1 AND d.status = 'in_flight' AND d.attempt_number = $3
          AND d.updated_at = $10::timestamp
        FOR UPDATE OF d
     ), completed AS (
       UPDATE webhook_deliveries d
          SET status = CASE WHEN claimed.paused THEN $13 ELSE $2 END,
              attempt_number = d.attempt_number - claimed.paused::integer,
              response_status = CASE WHEN claimed.paused THEN d.response_status ELSE $4 END,
              response_body = CASE WHEN claimed.paused THEN d.response_body ELSE $5 END,
              success = CASE WHEN claimed.paused THEN d.success ELSE $6 END,
              last_error = CASE WHEN claimed.paused THEN $14 ELSE $7 END,
              signature = CASE WHEN claimed.paused THEN d.signature ELSE $8 END,
              delivered_at = CASE WHEN $6 AND NOT claimed.paused THEN now() ELSE d.delivered_at END,
              next_attempt_at = CASE
                WHEN claimed.paused THEN d.next_attempt_at
                WHEN $2 = 'retrying' THEN now() + ($9::text || ' milliseconds')::interval
                ELSE NULL END,
              updated_at = now()
         FROM claimed
        WHERE d.id = claimed.id
        RETURNING d.webhook_endpoint_id, claimed.paused
     )
     UPDATE webhook_endpoints e
        SET last_triggered_at = now(),
            failure_count = CASE WHEN $6 THEN 0 ELSE e.failure_count + 1 END
       FROM completed
      WHERE e.id = completed.webhook_endpoint_id AND NOT completed.paused`,
    [
      row.id,
      outcome,
      attempt,
      status,
      responseBody,
      ok,
      error,
      signatureHeader || null,
      String(webhookBackoffMs(attempt)),
      row.claim_at,
      !sendStarted && status === null,
      CLAIMED_BEFORE_SEND,
      row.previous_status,
      row.previous_error,
    ]
  );
  if (!completed.rowCount) return "skipped";
  log.info({ deliveryId: row.id, event: row.event, attempt, outcome, status }, "Webhook attempt");
  return outcome;
}

/** Attempt every due delivery (retry job). */
export async function processDueWebhookDeliveries(limit = 100): Promise<Record<string, number>> {
  // A pre-send claim can be recovered. After the write boundary (or with no
  // marker from an older worker), retrying could deliver an event twice.
  const {
    rows: [{ dead }],
  } = await pq<{ dead: number }>(
    `WITH stale AS (
       SELECT d.id, d.status = 'in_flight' AND d.last_error = $3 AS before_send,
              d.status = 'in_flight' AND d.last_error = $3 AND NOT e.is_active AS paused
         FROM webhook_deliveries d
         JOIN webhook_endpoints e ON e.id = d.webhook_endpoint_id
        WHERE (d.status = 'in_flight' AND d.updated_at < now() - interval '10 minutes')
           OR (d.status = 'retrying' AND d.response_status IS NULL
            AND (d.last_error LIKE 'Blocked: %' OR d.last_error = $4) IS NOT TRUE)
        FOR UPDATE OF d
     ), recovered AS (
       UPDATE webhook_deliveries d
          SET status = CASE
                WHEN stale.paused AND d.attempt_number = 1 THEN 'pending'
                WHEN stale.paused OR (stale.before_send AND d.attempt_number < d.max_attempts)
                THEN 'retrying'
                ELSE 'dead' END,
              attempt_number = CASE WHEN stale.paused THEN d.attempt_number - 1 ELSE d.attempt_number END,
              next_attempt_at = CASE
                WHEN stale.paused THEN d.next_attempt_at
                WHEN stale.before_send AND d.attempt_number < d.max_attempts THEN now()
                ELSE NULL END,
              response_status = CASE WHEN stale.paused THEN d.response_status ELSE NULL END,
              response_body = CASE WHEN stale.paused THEN d.response_body ELSE NULL END,
              last_error = CASE
                WHEN stale.paused AND d.attempt_number = 1 THEN NULL
                WHEN stale.paused AND d.response_status IS NOT NULL THEN 'HTTP ' || d.response_status
                WHEN stale.before_send THEN $4
                WHEN d.status = 'in_flight' THEN $1 ELSE $2 END,
              updated_at = now()
         FROM stale
        WHERE d.id = stale.id
        RETURNING d.status
     )
     SELECT count(*) FILTER (WHERE status = 'dead')::integer AS dead FROM recovered`,
    [
      `${UNKNOWN_OUTCOME} after worker interruption`,
      `${UNKNOWN_OUTCOME} from a previous attempt`,
      CLAIMED_BEFORE_SEND,
      PRE_SEND_FAILURE,
    ]
  );
  const { rows } = await pq<{ id: string }>(
    `SELECT d.id FROM webhook_deliveries d
       JOIN webhook_endpoints e ON e.id = d.webhook_endpoint_id AND e.is_active
      WHERE d.status IN ('pending', 'retrying') AND d.attempt_number < d.max_attempts
        AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
      ORDER BY d.next_attempt_at NULLS FIRST LIMIT $1`,
    [limit]
  );
  const counts = { delivered: 0, retrying: 0, dead, skipped: 0 };
  for (const { id } of rows) counts[await attemptWebhookDelivery(id)] += 1;
  return counts;
}

// Use the same family-wide replay rules for the listing and the insert under
// the advisory lock. An uncertain delivery blocks replay of all of its siblings.
const SOURCE_EVENT_ROOT = `split_part(COALESCE(source.event_id, source.id::text), '#replay-', 1)`;
const SIBLING_EVENT_ROOT = `split_part(COALESCE(sibling.event_id, sibling.id::text), '#replay-', 1)`;
const REPLAY_REASON = `CASE
    WHEN bool_or(sibling.status = 'dead' AND sibling.response_status IS NULL
      AND (sibling.last_error = ANY($2::text[]) OR sibling.last_error LIKE 'Blocked: %') IS NOT TRUE)
      THEN 'delivery_uncertain'
    WHEN bool_or(sibling.status NOT IN ('delivered', 'dead')) THEN 'delivery_pending'
  END`;

export async function listWebhookDeliveries(endpointId: string) {
  const { rows } = await pool.query(
    `WITH recent AS (
       SELECT source.id, ${SOURCE_EVENT_ROOT} AS event_root
         FROM webhook_deliveries source WHERE source.webhook_endpoint_id = $1
        ORDER BY source.created_at DESC LIMIT 100
     ), eligibility AS (
       SELECT roots.event_root, ${REPLAY_REASON} AS reason
         FROM webhook_deliveries sibling
         JOIN (SELECT DISTINCT event_root FROM recent) roots ON roots.event_root = ${SIBLING_EVENT_ROOT}
        WHERE sibling.webhook_endpoint_id = $1 AND sibling.status <> 'delivered'
        GROUP BY roots.event_root
     )
     SELECT source.id, source.event, source.event_id AS "eventId", source.status,
            source.attempt_number AS "attemptNumber", source.max_attempts AS "maxAttempts",
            source.response_status AS "responseStatus", source.response_body AS "responseBody",
            source.success, source.last_error AS "lastError", source.next_attempt_at AS "nextAttemptAt",
            source.delivered_at AS "deliveredAt", source.created_at AS "createdAt", source.payload,
            e.is_active AND eligibility.reason IS NULL AS "replayEligible",
            CASE WHEN e.is_active THEN eligibility.reason ELSE 'endpoint_disabled' END AS "replayUnavailableReason"
       FROM recent
       JOIN webhook_deliveries source ON source.id = recent.id
       JOIN webhook_endpoints e ON e.id = source.webhook_endpoint_id
       LEFT JOIN eligibility ON eligibility.event_root = recent.event_root
      ORDER BY source.created_at DESC`,
    [endpointId, REPLAYABLE_PRE_SEND_ERRORS]
  );
  return rows;
}

/**
 * Replay a settled delivery with a known outcome. The receiver sees the original
 * event id and body, with a new delivery id and signature.
 */
export async function replayWebhookDelivery(deliveryId: string): Promise<string | null> {
  const client = await pool.connect();
  let id: string | null = null;
  try {
    await client.query("BEGIN");
    const { rows: references } = await pq<{ endpoint_id: string; event_id: string }>(
      `SELECT webhook_endpoint_id AS endpoint_id, ${SOURCE_EVENT_ROOT} AS event_id
         FROM webhook_deliveries source WHERE id = $1`,
      [deliveryId],
      client
    );
    const original = references[0];
    if (original) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `webhook-replay:${original.endpoint_id}:${original.event_id}`,
      ]);
      const { rows } = await pq<{ id: string }>(
        `INSERT INTO webhook_deliveries
           (webhook_endpoint_id, company_id, event, event_id, payload, status, attempt_number,
            max_attempts, next_attempt_at, success, updated_at)
         SELECT source.webhook_endpoint_id, source.company_id, source.event,
                $3 || '#replay-' || gen_random_uuid()::text,
                source.payload, 'pending', 0, source.max_attempts, now(), false, now()
           FROM webhook_deliveries source
           JOIN webhook_endpoints e ON e.id = source.webhook_endpoint_id AND e.is_active
          WHERE source.id = $1 AND source.status IN ('delivered', 'dead')
            AND (
              SELECT ${REPLAY_REASON} FROM webhook_deliveries sibling
               WHERE sibling.webhook_endpoint_id = source.webhook_endpoint_id
                 AND sibling.status <> 'delivered'
                 AND ${SIBLING_EVENT_ROOT} = ${SOURCE_EVENT_ROOT}
            ) IS NULL
         FOR SHARE OF e
         RETURNING id`,
        [deliveryId, REPLAYABLE_PRE_SEND_ERRORS, original.event_id],
        client
      );
      id = rows[0]?.id ?? null;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (id) await attemptWebhookDelivery(id, { force: true });
  return id;
}

/** Legacy entry point: queue + attempt for one event. */
export async function dispatchWebhookEvent(
  companyId: string,
  event: string,
  payload: object
): Promise<void> {
  await enqueueWebhookEvent(companyId, event, payload as Record<string, unknown>);
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

let subscribed = false;

/** Subscribe to the domain-event bus and register the retry job (idempotent). */
export function registerWebhookDispatch(): void {
  if (!subscribed) {
    subscribed = true;
    for (const info of WEBHOOK_EVENTS) {
      onDomainEvent(info.type, async (event: DomainEvent, signal) => {
        const { companyId, ...data } = event.payload as unknown as Record<string, unknown> & {
          companyId: string;
        };
        await enqueueWebhookEvent(
          companyId,
          event.type,
          { companyId, ...data },
          event.payload.eventId,
          { durable: Boolean(event.payload.eventId), signal }
        );
      });
    }
  }
  if (!listJobs().some((j) => j.name === "webhooks.deliveryRetry")) {
    registerJob({
      name: "webhooks.deliveryRetry",
      cron: "* * * * *",
      description: "Retry due outbound webhook deliveries with exponential backoff",
      run: async () => {
        await processDueWebhookDeliveries();
      },
    });
  }
}

/** Tests only: allow registerWebhookDispatch to re-subscribe after handler reset. */
export function __resetWebhookDispatchForTests(): void {
  subscribed = false;
}
