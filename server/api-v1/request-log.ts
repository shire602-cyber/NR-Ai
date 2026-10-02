/**
 * One api_request_log row per v1 request (success or failure) and an
 * activity_logs row for every successful write, so "who changed this" can name
 * the API key. Failures to log never fail the request.
 */
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db";
import { storage } from "../storage";
import { createLogger } from "../config/logger";

const log = createLogger("api-v1-log");

export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  const method = req.method;
  const path = req.originalUrl.split("?")[0].slice(0, 300);
  res.on("finish", () => {
    const keyId: string | null = res.locals.v1KeyId ?? null;
    const companyId: string | null = res.locals.v1CompanyId ?? null;
    const userId: string | null = res.locals.v1UserId ?? null;
    pool
      .query(
        `INSERT INTO api_request_log (api_key_id, company_id, method, path, status, duration_ms, ip) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [keyId, companyId, method, path, res.statusCode, Date.now() - started, req.ip ?? null]
      )
      .catch((err: unknown) => log.warn({ err }, "Could not write api_request_log"));
    if (method !== "GET" && res.statusCode < 400 && keyId && companyId) {
      storage
        .createActivityLog({
          userId,
          companyId,
          action: "api_write",
          entityType: "api_key",
          entityId: keyId,
          description: `${method} ${path} -> ${res.statusCode} via API key`,
          metadata: JSON.stringify({ apiKeyId: keyId, method, path, status: res.statusCode, idempotencyKey: req.header("idempotency-key") ?? null }),
          ipAddress: req.ip ?? null,
          userAgent: req.get("user-agent") ?? null,
        } as any)
        .catch((err: unknown) => log.warn({ err }, "Could not write api activity log"));
    }
  });
  next();
}

/** 90-day retention for the request log; called by the scheduler. */
export async function purgeOldRequestLog(): Promise<number> {
  const r = await pool.query(`DELETE FROM api_request_log WHERE created_at < now() - interval '90 days'`);
  return r.rowCount ?? 0;
}
