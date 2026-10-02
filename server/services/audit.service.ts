import type { Request } from "express";
import { storage } from "../storage";
import { pool } from "../db";
import { createLogger } from "../config/logger";
import { webhookEventsForAudit } from "./webhook-events";
import { emitWebhookEvent } from "./webhook.service";

const log = createLogger("audit");

interface AuditParams {
  userId?: string | null;
  companyId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  req?: Request;
  extra?: Record<string, unknown>;
}

/**
 * Persist an audit-log row for a critical financial operation.
 *
 * Failures are logged and swallowed — audit logging must never block the
 * underlying business operation. Use sparingly: only on operations that
 * change posted ledger state, money movement, access control, or user
 * permissions.
 */
/** Events about a person rather than a company; they get a company id only when the person has exactly one. */
const USER_SCOPED_ACTION = /^(login$|logout$|2fa\.|session\.|password\.|auth\.)/;

async function soleCompanyOf(userId: string): Promise<string | null> {
  const { rows } = await pool.query(`SELECT company_id FROM company_users WHERE user_id = $1 LIMIT 2`, [userId]);
  return rows.length === 1 ? (rows[0].company_id as string) : null;
}

export async function recordAudit(params: AuditParams): Promise<void> {
  try {
    const { userId, action, entityType, entityId, before, after, req, extra } = params;
    let companyId = params.companyId;
    if (!companyId && userId && USER_SCOPED_ACTION.test(action)) companyId = await soleCompanyOf(userId);
    const details = JSON.stringify({
      companyId: companyId ?? null,
      before: before ?? null,
      after: after ?? null,
      ...(extra ?? {}),
    });
    const ipAddress =
      (req?.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req?.socket?.remoteAddress ||
      null;
    const userAgent = (req?.headers["user-agent"] as string | undefined) || null;
    await storage.createAuditLog({
      userId: userId || null,
      companyId: companyId ?? null,
      action,
      resourceType: entityType,
      resourceId: entityId ?? null,
      details,
      ipAddress,
      userAgent,
    } as any);
  } catch (err) {
    log.error({ err: (err as Error).message }, "failed to record audit log");
  }

  // Audit rows are written after the business transaction has committed, so
  // this is the single, safe point to notify webhook subscribers. Strictly
  // fire-and-forget: it can never delay or fail the request.
  void emitWebhooksForAudit(params);
}

async function emitWebhooksForAudit(params: AuditParams): Promise<void> {
  try {
    const events = await webhookEventsForAudit(params);
    for (const { event, payload } of events) {
      emitWebhookEvent(params.companyId as string, event, payload);
    }
  } catch (err) {
    log.error({ err: (err as Error).message }, "failed to emit webhook events");
  }
}
