// Serialises "check then write" operations against a single document.
//
// Several accounting operations are guarded by a read-then-write check:
//
//   * revenue recognition  — "has this invoice already been posted?"
//   * credit notes         — "how much of this invoice has already been credited?"
//
// Both were read-then-write with nothing between the read and the write, so two
// concurrent requests each saw a clean slate and both proceeded. Measured on the
// running app: marking one invoice "sent" 10 times in parallel produced **10
// revenue journal entries**, and 5 parallel credit notes fully credited the same
// invoice **5 times**, driving accounts receivable negative.
//
// A Postgres transaction-scoped advisory lock serialises them. The lock is keyed
// on the document id, so unrelated documents never contend, and it is released
// automatically when the surrounding transaction commits or rolls back — no
// cleanup path can leak it.
//
// This is deliberately a *pessimistic* lock rather than a unique index: the same
// (source, source_id) pair is legitimately reused by payment entries, so a
// database constraint would break paying an invoice more than once.

import { sql } from "drizzle-orm";
import { db } from "../db";

/** Stable 32-bit key from a document id (advisory locks take bigints). */
function lockKey(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h << 5) - h + id.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/**
 * Run `fn` while holding an exclusive advisory lock on `documentId`.
 *
 * Everything inside runs in one transaction, so the check and the write it
 * guards are atomic with respect to any other caller using the same lock.
 * `fn` receives the transaction handle — use it for reads that must see the
 * post-lock state.
 */
export async function withDocumentLock<T>(
  documentId: string,
  namespace: number,
  fn: (tx: typeof db) => Promise<T>
): Promise<T> {
  // Waiters must not hold a pool connection while they wait: `fn` may read
  // through the global `db` (a second connection), so N callers blocked in
  // pg_advisory_xact_lock could hold every connection while the lock holder
  // waits for one (pool starvation). Try the lock, and if it is busy roll
  // back (releasing the connection) and retry with a short jittered backoff.
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (let attempt = 0; ; attempt++) {
    const result = await db.transaction(async (tx: typeof db) => {
      const res = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${namespace}, ${lockKey(documentId)}) AS locked`
      );
      const row = (res?.rows ?? res)?.[0];
      if (!row?.locked) return LOCK_BUSY;
      return { value: await fn(tx) };
    });
    if (result !== LOCK_BUSY) return (result as { value: T }).value;
    if (Date.now() > deadline) {
      throw Object.assign(new Error("Document is busy; please retry"), {
        statusCode: 409,
        code: "DOCUMENT_LOCK_TIMEOUT",
      });
    }
    await new Promise((r) =>
      setTimeout(r, Math.min(100, 5 * 2 ** Math.min(attempt, 4)) + Math.random() * 10)
    );
  }
}

const LOCK_BUSY = Symbol("document-lock-busy");
const LOCK_WAIT_MS = 30_000;

/** Lock namespaces — keep distinct so unrelated guards never collide. */
export const LOCK_NS = {
  INVOICE_POSTING: 1001,
  CREDIT_NOTE: 1002,
} as const;
