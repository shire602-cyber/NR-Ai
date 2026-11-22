import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db";
import { ledgerQueryable } from "../ledger/tx";
import type { LedgerTx } from "../ledger/types";
import { AppError } from "../middleware/errorHandler";
import { DomainError } from "../errors";
import { todayIso } from "../ledger/normalize";

/**
 * Period lock policy (W2-B: R08-05, R02-11, R02-19).
 *
 * A lock lives on a month_end_close row with status 'locked':
 *  - lock_scope 'through' (default for new locks): everything dated on or
 *    before period_end is locked (a "lock-through date").
 *    lock_scope 'month' (legacy rows): only that calendar month.
 *  - lock_type 'hard': nobody posts. 'soft': an owner / admin / accountant
 *    (or firm staff) may post with a reason sent in the
 *    `X-Period-Lock-Reason` header; every override is audited.
 *
 * assertPeriodNotLocked() is the guard every financial write path calls.
 * Callers that cannot see the request (jobs) get the strict behaviour: a soft
 * lock blocks them too.
 */

export type LockType = "soft" | "hard";
export type LockScope = "month" | "through";

export interface EffectiveLock {
  periodEnd: string;
  lockType: LockType;
  lockScope: LockScope;
}

export const PERIOD_LOCK_REASON_HEADER = "x-period-lock-reason";

/** Roles that may post into a soft-locked period (with a reason) and lock periods. */
export const CLOSE_ROLES = new Set(["owner", "admin", "accountant", "cfo"]);

// ─── Request context (so deep write paths can see the override reason) ──────

interface LockRequestContext {
  req: Request;
}
const lockContext = new AsyncLocalStorage<LockRequestContext>();

/** Express middleware: makes the current request visible to assertPeriodNotLocked. */
export function periodLockContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  lockContext.run({ req }, () => next());
}

/** Run `fn` as if inside `req` (for tests / explicit callers). */
export function withPeriodLockRequest<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  return lockContext.run({ req }, fn);
}

// ─── Lock lookup ────────────────────────────────────────────────────────────

function toIsoDate(date: Date | string): string | null {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** The strongest lock covering `isoDate` (hard beats soft), or null. */
export async function getEffectiveLock(
  companyId: string,
  isoDate: string,
  tx?: LedgerTx
): Promise<EffectiveLock | null> {
  const result = await ledgerQueryable(tx).query(
    `SELECT period_end::date::text AS period_end, lock_type, lock_scope
       FROM month_end_close
      WHERE company_id = $1
        AND status = 'locked'
        AND (
          (COALESCE(lock_scope, 'month') = 'through' AND $2::date <= period_end::date)
          OR (COALESCE(lock_scope, 'month') = 'month'
              AND $2::date >= date_trunc('month', period_end)::date
              AND $2::date <= period_end::date)
        )
      ORDER BY CASE WHEN lock_type = 'hard' THEN 0 ELSE 1 END, period_end DESC
      LIMIT 1`,
    [companyId, isoDate]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    periodEnd: row.period_end,
    lockType: row.lock_type === "soft" ? "soft" : "hard",
    lockScope: row.lock_scope === "through" ? "through" : "month",
  };
}

export async function isPeriodLocked(
  companyId: string,
  date: string,
  tx?: LedgerTx
): Promise<boolean> {
  return (await getEffectiveLock(companyId, date, tx)) !== null;
}

/** The latest lock-through date for the company (null when none). */
export async function getLockThroughDate(companyId: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT MAX(period_end)::date::text AS d FROM month_end_close
      WHERE company_id = $1 AND status = 'locked' AND lock_scope = 'through'`,
    [companyId]
  );
  return r.rows[0]?.d ?? null;
}

// ─── Roles ──────────────────────────────────────────────────────────────────

export type CloseActor =
  | { kind: "platform_admin" | "firm_owner" | "firm_admin"; companyRole: string | null }
  | { kind: "member"; companyRole: string | null };

export async function resolveCloseActor(
  companyId: string,
  user: { id: string; isAdmin?: boolean; firmRole?: string | null },
  tx?: LedgerTx
): Promise<CloseActor> {
  const r = await ledgerQueryable(tx).query(
    `SELECT role FROM company_users WHERE company_id = $1 AND user_id = $2 LIMIT 1`,
    [companyId, user.id]
  );
  const companyRole: string | null = r.rows[0]?.role ?? null;
  if (user.isAdmin) return { kind: "platform_admin", companyRole };
  if (user.firmRole === "firm_owner") return { kind: "firm_owner", companyRole };
  if (user.firmRole === "firm_admin") return { kind: "firm_admin", companyRole };
  return { kind: "member", companyRole };
}

export function isFirmOrAdmin(actor: CloseActor): boolean {
  return actor.kind !== "member";
}

export function canManageClose(actor: CloseActor): boolean {
  return isFirmOrAdmin(actor) || CLOSE_ROLES.has(actor.companyRole ?? "");
}

// ─── Guard ──────────────────────────────────────────────────────────────────

/**
 * Period lock guard for financial write paths.
 *
 * Throws 403 PERIOD_LOCKED inside a hard lock, and 403 PERIOD_SOFT_LOCKED
 * inside a soft lock unless the current request is from an owner / admin /
 * accountant (or firm staff) and carries a reason in X-Period-Lock-Reason.
 */
export async function assertPeriodNotLocked(
  companyId: string,
  date: Date | string | null | undefined,
  tx?: LedgerTx
): Promise<void> {
  if (!companyId) return;
  if (!date) return;
  const isoDate = toIsoDate(date);
  if (!isoDate) return;

  const lock = await getEffectiveLock(companyId, isoDate, tx);
  if (!lock) return;

  const label = `${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;
  if (lock.lockType === "hard") {
    throw new AppError({
      message: `Cannot post to locked period (${label}). Unlock the period first.`,
      statusCode: 403,
      code: "PERIOD_LOCKED",
      details: {
        lockedThrough: lock.periodEnd,
        lockType: lock.lockType,
        lockScope: lock.lockScope,
      },
    });
  }

  const ctx = lockContext.getStore();
  const req = ctx?.req;
  const rawReason = req?.header?.(PERIOD_LOCK_REASON_HEADER);
  const reason = decodeLockReason(rawReason);
  const user = req?.user;
  // X5 (J1 D3): the refusal tells the client whether this user may override with a reason,
  // so the UI asks for one (and retries) only when it would be accepted.
  const actor = user ? await resolveCloseActor(companyId, user, tx) : null;
  const canOverride = !!actor && canManageClose(actor);
  if (user && reason.length >= 3) {
    if (canOverride) {
      const { recordAudit } = await import("./audit.service");
      await recordAudit({
        userId: user.id,
        companyId,
        action: "period.soft_lock_override",
        entityType: "period",
        entityId: lock.periodEnd,
        before: null,
        after: { postingDate: isoDate, lockedThrough: lock.periodEnd, reason },
        req,
        tx,
      });
      return;
    }
  }
  throw new AppError({
    message: canOverride
      ? `Period ${label} is closed (soft lock). You can still post this by giving a reason, which is kept in the audit trail.`
      : `Period ${label} is closed (soft lock). Ask the owner or your accountant to post it, or to reopen the period.`,
    statusCode: 403,
    code: "PERIOD_SOFT_LOCKED",
    details: {
      lockedThrough: lock.periodEnd,
      lockType: lock.lockType,
      lockScope: lock.lockScope,
      canOverride,
      reasonRequired: canOverride,
    },
  });
}

/**
 * The override reason from the request header. The client sends it URI-encoded (headers are
 * Latin-1 only, and reasons are often Arabic); a plain ASCII value is accepted as is.
 */
export function decodeLockReason(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    text = raw;
  }
  return text.trim().slice(0, 500);
}

/** Throw 403 FISCAL_YEAR_HARD_CLOSED when `isoDate` sits in a hard-closed fiscal year. */
export async function assertNotInHardClosedYear(companyId: string, isoDate: string): Promise<void> {
  const r = await pool.query(
    `SELECT fiscal_year_end::text AS fye FROM fiscal_year_closes
      WHERE company_id = $1 AND status = 'closed' AND hard_closed = true
        AND $2::date BETWEEN fiscal_year_start AND fiscal_year_end
      LIMIT 1`,
    [companyId, isoDate]
  );
  if (r.rows[0]) {
    throw new DomainError(
      "FISCAL_YEAR_HARD_CLOSED",
      403,
      { fiscalYearEnd: r.rows[0].fye },
      "This fiscal year is hard-closed. Only firm staff or an administrator can reopen it."
    );
  }
}

/**
 * Pure predicate: is `date` after the end of (now + graceDays) in UTC?
 * Exposed for unit testing.
 */
export function isFutureDate(date: Date, now: Date, graceDays = 0): boolean {
  // Posting dates are UAE calendar dates (stored at UTC midnight): "today" is the UAE date
  // (UTC+4), so 00:00-04:00 local is not refused as tomorrow (same rule as ledger todayIso).
  const limit = new Date(`${todayIso(now)}T23:59:59.999Z`);
  limit.setUTCDate(limit.getUTCDate() + graceDays);
  return date.getTime() > limit.getTime();
}

/**
 * A-4: Future-date guard for financial posting paths. UAE/IFRS practice is
 * that posted journal entries must not be dated in the future (back-dating to
 * an open period is allowed; forward-dating is not). Rejects a posting date
 * after the end of today (UTC) plus an optional grace window.
 *
 * Throws a 422 AppError when the date is in the future.
 */
export function assertNotFutureDate(
  date: Date | string | null | undefined,
  opts?: { graceDays?: number; now?: Date }
): void {
  if (!date) return;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return;
  const now = opts?.now ?? new Date();
  if (isFutureDate(d, now, opts?.graceDays ?? 0)) {
    throw new AppError(
      `Cannot post an entry dated in the future (${d
        .toISOString()
        .slice(0, 10)}). Posting dates must be on or before today.`,
      422
    );
  }
}
