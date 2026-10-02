/**
 * Idempotency-Key for v1 writes (table idempotency_keys, 0119).
 *
 * Claim: INSERT ... ON CONFLICT DO NOTHING RETURNING id.
 *   inserted            -> run the request, store 2xx/4xx (not 409/429) when it ends,
 *                          delete the claim on 5xx/409/429 so a retry runs again
 *   conflict, other body-> 422 IDEMPOTENCY_KEY_REUSED
 *   conflict, in flight -> 409 IDEMPOTENCY_IN_FLIGHT (a claim older than 60 s is taken over)
 *   conflict, completed -> replay the stored response, `Idempotent-Replayed: true`
 */
import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db";
import { createLogger } from "../config/logger";
import { addAfterJsonHook, ctx } from "./context";
import { errorEnvelope, markEnveloped } from "./response";

const log = createLogger("api-v1-idem");

export const IDEMPOTENCY_TTL_HOURS = 24;
export const IN_FLIGHT_TAKEOVER_SECONDS = 60;
const MAX_KEY_LENGTH = 255;

/** Key-order independent JSON so {a,b} and {b,a} hash alike. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function requestHash(body: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(body ?? null)).digest("hex");
}

export function idempotencyScopePath(req: Request): string {
  return req.originalUrl.split("?")[0];
}

export async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const c = ctx(req);
    const raw = req.header("idempotency-key");
    if (!raw || !raw.trim() || raw.length > MAX_KEY_LENGTH) {
      res.status(400).json(
        errorEnvelope(req, 400, "IDEMPOTENCY_KEY_REQUIRED", "Every write needs an Idempotency-Key header (1-255 characters)")
      );
      return;
    }
    const key = raw.trim();
    const method = req.method;
    const path = idempotencyScopePath(req);
    const hash = requestHash(req.body);

    await pool.query(
      `DELETE FROM idempotency_keys WHERE api_key_id = $1 AND idem_key = $2 AND method = $3 AND path = $4 AND expires_at < now()`,
      [c.keyId, key, method, path]
    );

    const claim = await pool.query(
      `INSERT INTO idempotency_keys (company_id, api_key_id, idem_key, method, path, request_hash, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'in_flight', now() + ($7 || ' hours')::interval)
       ON CONFLICT (api_key_id, idem_key, method, path) DO NOTHING
       RETURNING id`,
      [c.companyId, c.keyId, key, method, path, hash, String(IDEMPOTENCY_TTL_HOURS)]
    );

    let claimId: string | null = claim.rows[0]?.id ?? null;

    if (!claimId) {
      const existing = (
        await pool.query(
          `SELECT id, request_hash, status, response_status, response_body, response_location, created_at,
                  (created_at < now() - ($5 || ' seconds')::interval) AS stale
             FROM idempotency_keys
            WHERE api_key_id = $1 AND idem_key = $2 AND method = $3 AND path = $4`,
          [c.keyId, key, method, path, String(IN_FLIGHT_TAKEOVER_SECONDS)]
        )
      ).rows[0];
      if (!existing) {
        // Deleted between the insert and the select (a 5xx rollback): let the client retry.
        res.status(409).json(errorEnvelope(req, 409, "IDEMPOTENCY_IN_FLIGHT", "A request with this key was just retried; try again"));
        return;
      }
      if (existing.request_hash !== hash) {
        res.status(422).json(
          errorEnvelope(req, 422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different request body")
        );
        return;
      }
      if (existing.status === "completed") {
        res.setHeader("Idempotent-Replayed", "true");
        if (existing.response_location) res.setHeader("Location", existing.response_location);
        res.status(existing.response_status).json(markEnveloped(existing.response_body ?? {}));
        return;
      }
      if (!existing.stale) {
        res.setHeader("Retry-After", "1");
        res.status(409).json(
          errorEnvelope(req, 409, "IDEMPOTENCY_IN_FLIGHT", "A request with this Idempotency-Key is still being processed")
        );
        return;
      }
      const taken = await pool.query(
        `UPDATE idempotency_keys SET created_at = now()
          WHERE id = $1 AND status = 'in_flight' AND created_at < now() - ($2 || ' seconds')::interval
        RETURNING id`,
        [existing.id, String(IN_FLIGHT_TAKEOVER_SECONDS)]
      );
      if (!taken.rows[0]) {
        res.status(409).json(errorEnvelope(req, 409, "IDEMPOTENCY_IN_FLIGHT", "A request with this Idempotency-Key is still being processed"));
        return;
      }
      claimId = existing.id;
    }

    addAfterJsonHook(res, async (status, body) => {
      const keep = status < 500 && status !== 409 && status !== 429;
      if (!keep) {
        await pool.query(`DELETE FROM idempotency_keys WHERE id = $1`, [claimId]);
        return;
      }
      const location = res.getHeader("Location");
      await pool.query(
        `UPDATE idempotency_keys
            SET status = 'completed', response_status = $2, response_body = $3::jsonb, response_location = $4
          WHERE id = $1`,
        [claimId, status, JSON.stringify(body), typeof location === "string" ? location : null]
      );
    });

    // A client that disconnects mid-request leaves the claim in flight; the 60 s takeover covers it.
    next();
  } catch (err) {
    log.error({ err }, "Idempotency middleware failed");
    res.status(500).json(errorEnvelope(req, 500, "INTERNAL_ERROR", "The request could not be processed"));
  }
}

/** Housekeeping, called by the scheduler. */
export async function purgeExpiredIdempotencyKeys(): Promise<number> {
  const r = await pool.query(`DELETE FROM idempotency_keys WHERE expires_at < now()`);
  return r.rowCount ?? 0;
}
