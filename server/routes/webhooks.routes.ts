/**
 * Webhook endpoint management (W5-B, R19-02, R19-05, R19-15).
 *
 * Deliveries are produced by domain events (server/services/webhook.service.ts):
 * signed, queued, retried with backoff and dead-lettered. These routes manage
 * endpoints, list deliveries, send a test event and replay a delivery. All of
 * them need the `webhooks` plan feature; writes need `settings.company`.
 */
import type { Express, Request, Response } from "express";
import { parsedBody } from "../http/parsed-body";
import { z } from "zod";
import { pool } from "../db";
import { pq } from "../services/connectors/pq";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { validateOutboundUrl } from "../services/url-guard";
import { decryptSecret, encryptSecret } from "../services/secret-vault";
import {
  WEBHOOK_EVENTS,
  attemptWebhookDelivery,
  enqueueWebhookEvent,
  normaliseEventList,
  registerWebhookDispatch,
  replayWebhookDelivery,
} from "../services/webhook.service";
import crypto from "crypto";

const zEvents = z
  .union([z.array(z.string().trim().min(1)).min(1).max(50), z.string().trim().min(1).max(2000)])
  .transform((v, ctx) => {
    try {
      return normaliseEventList(v);
    } catch (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (err as Error).message });
      return z.NEVER;
    }
  });

const zWebhookUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((s) => {
    try {
      return new URL(s).protocol === "https:";
    } catch {
      return false;
    }
  }, "Webhook URL must be an https:// URL");

const createEndpointBody = z.object({ url: zWebhookUrl, events: zEvents }).strict();
const updateEndpointBody = z
  .object({
    url: zWebhookUrl.optional(),
    events: zEvents.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

interface EndpointRow {
  id: string;
  company_id: string;
  url: string;
  secret: string;
  events: string;
  is_active: boolean;
  failure_count: number;
  last_triggered_at: Date | null;
  created_by: string | null;
  created_at: Date;
}

const ENDPOINT_COLUMNS = `id, company_id, url, secret, events, is_active, failure_count,
  last_triggered_at, created_by, created_at`;

function present(row: EndpointRow) {
  const plain = decryptSecret(row.secret) ?? "";
  return {
    id: row.id,
    companyId: row.company_id,
    url: row.url,
    events: row.events,
    isActive: row.is_active,
    failureCount: row.failure_count,
    lastTriggeredAt: row.last_triggered_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    secretLast4: plain.slice(-4),
  };
}

/** Endpoint owned by a company the caller belongs to, else 404. */
async function endpointForUser(id: string, userId: string): Promise<EndpointRow> {
  const { rows } = await pq<EndpointRow>(
    `SELECT ${ENDPOINT_COLUMNS} FROM webhook_endpoints
      WHERE id = $1 AND company_id IN (SELECT company_id FROM company_users WHERE user_id = $2)`,
    [id, userId]
  );
  if (!rows[0]) throw new DomainError("NOT_FOUND", 404, undefined, "Webhook endpoint not found");
  return rows[0];
}

async function assertSafeUrl(url: string): Promise<void> {
  const verdict = await validateOutboundUrl(url);
  if (!verdict.ok) {
    throw new DomainError(
      "WEBHOOK_URL_BLOCKED",
      400,
      { fields: { url: [verdict.reason] } },
      `Invalid webhook URL: ${verdict.reason}`
    );
  }
}

export function registerWebhookRoutes(app: Express) {
  registerWebhookDispatch();

  // Event catalogue (en/ar) for the Developer Settings UI and docs.
  app.get("/api/webhooks/events", authMiddleware, (_req: Request, res: Response) => {
    res.json({ events: WEBHOOK_EVENTS });
  });

  app.get(
    "/api/companies/:companyId/webhooks",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    requireFeature("webhooks"),
    asyncHandler(async (req: Request, res: Response) => {
      const { rows } = await pq<EndpointRow>(
        `SELECT ${ENDPOINT_COLUMNS} FROM webhook_endpoints WHERE company_id = $1 ORDER BY created_at DESC`,
        [req.params.companyId]
      );
      res.json(rows.map(present));
    })
  );

  app.post(
    "/api/companies/:companyId/webhooks",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    requireFeature("webhooks"),
    strictBody(createEndpointBody),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<z.output<typeof createEndpointBody>>(req);
      await assertSafeUrl(body.url);
      const secret = `whsec_${crypto.randomBytes(32).toString("hex")}`;
      const { rows } = await pq<EndpointRow>(
        `INSERT INTO webhook_endpoints (company_id, url, secret, events, is_active, created_by)
              VALUES ($1, $2, $3, $4, true, $5) RETURNING ${ENDPOINT_COLUMNS}`,
        [req.params.companyId, body.url, encryptSecret(secret), body.events, req.user!.id]
      );
      // The signing secret is returned ONLY on creation.
      res.status(201).json({ ...present(rows[0]), secret });
    })
  );

  app.put(
    "/api/webhooks/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("webhooks"),
    strictBody(updateEndpointBody),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<z.output<typeof updateEndpointBody>>(req);
      const existing = await endpointForUser(req.params.id, req.user!.id);
      if (body.url) await assertSafeUrl(body.url);
      const { rows } = await pq<EndpointRow>(
        `UPDATE webhook_endpoints
            SET url = COALESCE($2, url), events = COALESCE($3, events),
                is_active = COALESCE($4, is_active),
                failure_count = CASE WHEN $4 IS TRUE THEN 0 ELSE failure_count END
          WHERE id = $1 RETURNING ${ENDPOINT_COLUMNS}`,
        [existing.id, body.url ?? null, body.events ?? null, body.isActive ?? null]
      );
      res.json(present(rows[0]));
    })
  );

  app.delete(
    "/api/webhooks/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("webhooks"),
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await endpointForUser(req.params.id, req.user!.id);
      await pool.query(`DELETE FROM webhook_endpoints WHERE id = $1`, [existing.id]);
      res.json({ message: "Webhook endpoint deleted successfully" });
    })
  );

  app.get(
    "/api/webhooks/:id/deliveries",
    authMiddleware,
    requireCustomer,
    requireFeature("webhooks"),
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await endpointForUser(req.params.id, req.user!.id);
      const { rows } = await pool.query(
        `SELECT id, event, event_id AS "eventId", status, attempt_number AS "attemptNumber",
                max_attempts AS "maxAttempts", response_status AS "responseStatus",
                response_body AS "responseBody", success, last_error AS "lastError",
                next_attempt_at AS "nextAttemptAt", delivered_at AS "deliveredAt",
                created_at AS "createdAt", payload
           FROM webhook_deliveries WHERE webhook_endpoint_id = $1
          ORDER BY created_at DESC LIMIT 100`,
        [existing.id]
      );
      res.json(rows);
    })
  );

  // Send a signed `test` event through the same queue (one attempt, no retries).
  app.post(
    "/api/webhooks/:id/test",
    authMiddleware,
    requireCustomer,
    requireFeature("webhooks"),
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await endpointForUser(req.params.id, req.user!.id);
      const eventId = `test_${crypto.randomUUID()}`;
      const body = JSON.stringify({
        id: eventId,
        type: "test",
        createdAt: new Date().toISOString(),
        companyId: existing.company_id,
        data: { message: "This is a test webhook from Muhasib.ai", webhookEndpointId: existing.id },
      });
      const { rows } = await pq<{ id: string }>(
        `INSERT INTO webhook_deliveries
           (webhook_endpoint_id, company_id, event, event_id, payload, status, attempt_number,
            max_attempts, next_attempt_at, success, updated_at)
         VALUES ($1, $2, 'test', $3, $4, 'pending', 0, 1, now(), false, now()) RETURNING id`,
        [existing.id, existing.company_id, eventId, body]
      );
      const outcome = await attemptWebhookDelivery(rows[0].id, { force: true });
      const { rows: d } = await pool.query(
        `SELECT id, status, response_status AS "responseStatus", last_error AS "lastError"
           FROM webhook_deliveries WHERE id = $1`,
        [rows[0].id]
      );
      res.json({
        success: outcome === "delivered",
        delivery: d[0],
        responseStatus: d[0]?.responseStatus ?? null,
      });
    })
  );

  app.post(
    "/api/webhooks/:id/deliveries/:deliveryId/replay",
    authMiddleware,
    requireCustomer,
    requireFeature("webhooks"),
    asyncHandler(async (req: Request, res: Response) => {
      const existing = await endpointForUser(req.params.id, req.user!.id);
      const { rows } = await pq<{ id: string }>(
        `SELECT id FROM webhook_deliveries WHERE id = $1 AND webhook_endpoint_id = $2`,
        [req.params.deliveryId, existing.id]
      );
      if (!rows[0]) throw new DomainError("NOT_FOUND", 404, undefined, "Delivery not found");
      const replayId = await replayWebhookDelivery(rows[0].id);
      if (!replayId) {
        throw new DomainError(
          "INVALID_STATUS",
          409,
          undefined,
          "Replay requires a completed delivery with a known outcome"
        );
      }
      const { rows: d } = await pool.query(
        `SELECT id, status, attempt_number AS "attemptNumber", response_status AS "responseStatus"
           FROM webhook_deliveries WHERE id = $1`,
        [replayId]
      );
      res.status(201).json(d[0]);
    })
  );
}

/** Re-exported for tests that queue events without going through the bus. */
export { enqueueWebhookEvent };
