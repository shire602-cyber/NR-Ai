import type { Request } from "express";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { auditLogs } from "../../shared/schema";
import type { LedgerTx } from "../ledger/types";
import type { Queryable } from "./connectors/pq";

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
  /** The operation relies on the audit row as durable evidence. */
  required?: boolean;
  /**
   * Write the row inside this transaction (F2): it then commits or rolls back with the document
   * it describes, instead of a detached after-commit write whose failure is only logged. The
   * insert runs in a savepoint so a failing audit write still never aborts the business operation.
   */
  tx?: LedgerTx;
}

/**
 * Persist an audit-log row for a critical financial operation.
 *
 * Failures are logged and swallowed unless the operation requires durable evidence.
 * Use sparingly: only on operations that
 * change posted ledger state, money movement, access control, or user
 * permissions.
 */
export async function recordAudit(
  params: AuditParams & ({ client?: never } | { tx?: never; client: Queryable; required: true })
): Promise<void> {
  try {
    const { userId, companyId, action, entityType, entityId, before, after, req, extra } = params;
    const details = JSON.stringify({
      companyId: companyId ?? null,
      before: before ?? null,
      after: after ?? null,
      ...(extra ?? {}),
    });
    // req.ip honours TRUST_PROXY_HOPS; a raw X-Forwarded-For header is client-controlled.
    const ipAddress = req?.ip || req?.socket?.remoteAddress || null;
    const userAgent = (req?.headers["user-agent"] as string | undefined) || null;
    const row = {
      userId: userId || null,
      companyId: companyId ?? null,
      action,
      resourceType: entityType,
      resourceId: entityId ?? null,
      details,
      ipAddress,
      userAgent,
    };
    if (params.client) {
      await params.client.query(
        `INSERT INTO audit_logs
          (user_id, company_id, action, resource_type, resource_id, details, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          row.userId,
          row.companyId,
          row.action,
          row.resourceType,
          row.resourceId,
          row.details,
          row.ipAddress,
          row.userAgent,
        ]
      );
      return;
    }
    if (params.tx) {
      await params.tx.transaction(async (sp: LedgerTx) => {
        await sp.insert(auditLogs).values(row);
      });
      return;
    }
    await storage.createAuditLog(row);
  } catch (err) {
    log.error({ err: (err as Error).message }, "failed to record audit log");
    if (params.required) throw err;
  }
}
