/**
 * Outbound webhooks (W5-B, R19-02, R19-15).
 *
 * Domain events (server/platform/domain-events.ts) are subscribed once at
 * startup. Every event a company's active endpoint subscribes to becomes a
 * durable `webhook_deliveries` row (status pending), unique per
 * (endpoint, event id), and is attempted straight away. Confirmed HTTP failures
 * are retried with backoff by the `webhooks.deliveryRetry` job. An unknown send
 * outcome is dead-lettered and cannot be replayed automatically or manually.
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
import { safeOutboundFetch, OutboundUrlBlockedError } from "./url-guard";
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
export type WebhookTransport = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal }
) => Promise<WebhookTransportResult>;

const WEBHOOK_TIMEOUT_MS = 15_000;
const UNKNOWN_OUTCOME = "Webhook delivery outcome unknown";
const SIGNING_FAILED = "Webhook signing failed before sending";

const defaultTransport: WebhookTransport = (url, init) =>
  safeOutboundFetch(url, init, { timeoutMs: WEBHOOK_TIMEOUT_MS });

let transport: WebhookTransport = defaultTransport;

/** Tests: route deliveries to a mock endpoint. Pass null to restore. */
export function setWebhookTransport(t: WebhookTransport | null): void {
  transport = t ?? defaultTransport;
}

async function postWebhook(
  url: string,
  init: Omit<Parameters<WebhookTransport>[1], "signal">,
  parentSignal?: AbortSignal
): Promise<WebhookTransportResult> {
  const controller = new AbortController();
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, controller.signal])
    : controller.signal;
  signal.throwIfAborted();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  let onAbort!: () => void;
  try {
    // Bound the worker's wait even if a transport has not settled after cancellation.
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([transport(url, { ...init, signal }), aborted]);
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
    `UPDATE webhook_deliveries d
        SET status = 'in_flight', attempt_number = d.attempt_number + 1, updated_at = now()
       FROM webhook_endpoints e
      WHERE d.id = $1 AND e.id = d.webhook_endpoint_id
        AND (d.status = 'pending' OR (d.status = 'retrying'
          AND (d.response_status IS NOT NULL OR d.last_error LIKE 'Blocked: %')))
        AND d.attempt_number < d.max_attempts
        AND ($2::boolean OR d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
      RETURNING d.id, d.webhook_endpoint_id, d.event, d.event_id, d.payload, d.attempt_number,
                d.max_attempts, e.url, e.secret`,
    [deliveryId, opts.force === true]
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
    sendStarted = true;
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
      opts.signal
    );
    status = res.status;
    responseBody = (res.bodyText || "").slice(0, 2000) || null;
    ok = res.status >= 200 && res.status < 300;
    retryable = !ok;
    if (!ok) error = `HTTP ${res.status}`;
  } catch (err) {
    if (err instanceof OutboundUrlBlockedError) {
      // The URL guard rejected the destination before opening a connection.
      error = `Blocked: ${err.message}`;
      retryable = true;
    } else if (sendStarted) {
      // A timeout or lost connection can hide a successful receiver-side commit.
      error = `${UNKNOWN_OUTCOME} after transport failure`;
    } else {
      error = SIGNING_FAILED;
    }
  }

  const outcome = ok ? "delivered" : retryable && attempt < row.max_attempts ? "retrying" : "dead";
  const completed = await pool.query(
    `WITH completed AS (
       UPDATE webhook_deliveries
          SET status = $2, response_status = $4, response_body = $5,
              success = $6, last_error = $7, signature = $8,
              delivered_at = CASE WHEN $6 THEN now() ELSE delivered_at END,
              next_attempt_at = CASE WHEN $2 = 'retrying' THEN now() + ($9::text || ' milliseconds')::interval ELSE NULL END,
              updated_at = now()
        WHERE id = $1 AND status = 'in_flight' AND attempt_number = $3
        RETURNING webhook_endpoint_id
     )
     UPDATE webhook_endpoints e
        SET last_triggered_at = now(),
            failure_count = CASE WHEN $6 THEN 0 ELSE e.failure_count + 1 END
       FROM completed
      WHERE e.id = completed.webhook_endpoint_id`,
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
    ]
  );
  if (!completed.rowCount) return "skipped";
  log.info({ deliveryId: row.id, event: row.event, attempt, outcome, status }, "Webhook attempt");
  return outcome;
}

/** Attempt every due delivery (retry job). */
export async function processDueWebhookDeliveries(limit = 100): Promise<Record<string, number>> {
  // Old workers could have sent a POST before they stopped or scheduled an ambiguous retry.
  const expired = await pool.query(
    `UPDATE webhook_deliveries
        SET status = 'dead', next_attempt_at = NULL,
            response_status = NULL, response_body = NULL,
            last_error = CASE WHEN status = 'in_flight' THEN $1 ELSE $2 END, updated_at = now()
      WHERE (status = 'in_flight' AND updated_at < now() - interval '10 minutes')
         OR (status = 'retrying' AND response_status IS NULL
          AND (last_error IS NULL OR last_error NOT LIKE 'Blocked: %'))`,
    [`${UNKNOWN_OUTCOME} after worker interruption`, `${UNKNOWN_OUTCOME} from a previous attempt`]
  );
  const { rows } = await pq<{ id: string }>(
    `SELECT id FROM webhook_deliveries
      WHERE status IN ('pending', 'retrying') AND attempt_number < max_attempts
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      ORDER BY next_attempt_at NULLS FIRST LIMIT $1`,
    [limit]
  );
  const counts = { delivered: 0, retrying: 0, dead: expired.rowCount ?? 0, skipped: 0 };
  for (const { id } of rows) counts[await attemptWebhookDelivery(id)] += 1;
  return counts;
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
      `SELECT webhook_endpoint_id AS endpoint_id,
              split_part(COALESCE(event_id, id::text), '#replay-', 1) AS event_id
         FROM webhook_deliveries WHERE id = $1`,
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
                $2 || '#replay-' || gen_random_uuid()::text,
                source.payload, 'pending', 0, source.max_attempts, now(), false, now()
           FROM webhook_deliveries source
          WHERE source.id = $1 AND source.status IN ('delivered', 'dead')
            AND NOT EXISTS (
              SELECT 1 FROM webhook_deliveries sibling
               WHERE sibling.webhook_endpoint_id = source.webhook_endpoint_id
                 AND split_part(COALESCE(sibling.event_id, sibling.id::text), '#replay-', 1) = $2
                 AND (
                   sibling.status IN ('pending', 'in_flight', 'retrying')
                   OR (
                     sibling.status = 'dead' AND sibling.response_status IS NULL
                     AND sibling.last_error IS DISTINCT FROM $3
                     AND (sibling.last_error IS NULL OR sibling.last_error NOT LIKE 'Blocked: %')
                   )
                 )
            )
         RETURNING id`,
        [deliveryId, original.event_id, SIGNING_FAILED],
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
