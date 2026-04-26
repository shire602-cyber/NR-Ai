import type { Request } from 'express';
import { storage } from '../storage';

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
export async function recordAudit(params: AuditParams): Promise<void> {
  try {
    const { userId, companyId, action, entityType, entityId, before, after, req, extra } = params;
    const details = JSON.stringify({
      companyId: companyId ?? null,
      before: before ?? null,
      after: after ?? null,
      ...(extra ?? {}),
    });
    const ipAddress =
      (req?.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
      req?.socket?.remoteAddress ||
      null;
    const userAgent = (req?.headers['user-agent'] as string | undefined) || null;
    await storage.createAuditLog({
      userId: userId || null,
      action,
      resourceType: entityType,
      resourceId: entityId ?? null,
      details,
      ipAddress,
      userAgent,
    } as any);
  } catch (err) {
    console.error('[audit] failed to record audit log:', (err as Error).message);
  }
}
