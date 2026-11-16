/**
 * withLedgerTx — run `fn` in a transaction and flush after-commit callbacks
 * (domain events, notifications) only once the outermost transaction commits.
 *
 *   await withLedgerTx(async (tx, { afterCommit }) => {
 *     const r = await postJournal(input, { actorId, tx });
 *     afterCommit(() => emitDomainEvent("receipt.posted", {...}));
 *   });
 *
 * When `outer` is given (a tx opened by another withLedgerTx), `fn` runs in it
 * and its callbacks join the outer transaction's queue. When `outer` is a
 * transaction this helper did not open, callbacks run on the next tick after
 * `fn` resolves (best effort: the caller owns that commit).
 *
 * After-commit callbacks are fire-and-forget: failures are only logged and nothing retries them.
 * Use them only for side effects that may lag or be lost (in-memory domain events). Anything that
 * must be atomic with the document (journals, stock, GRNI, payments, status, audit rows) runs in
 * `tx` itself; pass `tx` down (e.g. `inventory.onGoodsReceived(event, tx)`,
 * `recordAudit({ ..., tx })`).
 */
import { db } from "../db";
import { createLogger } from "../config/logger";
import type { LedgerTx } from "./types";

const log = createLogger("ledger-tx");

export interface LedgerTxHooks {
  afterCommit(cb: () => void | Promise<void>): void;
}

const queues = new WeakMap<object, Array<() => void | Promise<void>>>();

function runCallbacks(cbs: Array<() => void | Promise<void>>): void {
  for (const cb of cbs) {
    setImmediate(() => {
      Promise.resolve()
        .then(cb)
        .catch((err) => log.error({ err: (err as Error)?.message }, "afterCommit callback failed"));
    });
  }
}

export async function withLedgerTx<T>(
  fn: (tx: LedgerTx, hooks: LedgerTxHooks) => Promise<T>,
  outer?: LedgerTx
): Promise<T> {
  if (outer) {
    const queue = queues.get(outer as object);
    if (queue) return fn(outer, { afterCommit: (cb) => queue.push(cb) });
    const local: Array<() => void | Promise<void>> = [];
    const result = await fn(outer, { afterCommit: (cb) => local.push(cb) });
    runCallbacks(local);
    return result;
  }
  const pending: Array<() => void | Promise<void>> = [];
  const result = await db.transaction(async (tx: LedgerTx) => {
    queues.set(tx as object, pending);
    return fn(tx, { afterCommit: (cb) => pending.push(cb) });
  });
  runCallbacks(pending);
  return result;
}

/** Walk an error's cause chain for a Postgres error with this SQLSTATE. */
export function findPgError(
  err: unknown,
  code: string
): { code: string; constraint?: string; detail?: string } | null {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const c = cur as { code?: unknown; cause?: unknown };
    if (c.code === code) return cur as { code: string; constraint?: string; detail?: string };
    cur = c.cause;
  }
  return null;
}

/** Rows from a drizzle `execute` result (node-postgres returns {rows}, neon an array). */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
