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
import { runExclusive, runInPostingSlot } from "./document-queue";

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
  // Queue same-document callers in-process first, so waiters do not each hold
  // a pooled connection while the holder needs more (see document-queue.ts).
  return await runExclusive(`${namespace}:${documentId}`, () =>
    // The slot keeps the number of open document transactions below the pool
    // size: each one needs a SECOND connection for its own reads and journal
    // insert, so a pool full of first connections would starve itself.
    runInPostingSlot(() =>
      db.transaction(async (tx: typeof db) => {
        await acquireDocumentLock(tx, documentId, namespace);
        return await fn(tx);
      })
    )
  );
}

/**
 * Take the same transaction-scoped advisory lock inside a transaction the
 * caller already owns (e.g. to hold several document locks at once).
 */
export async function acquireDocumentLock(tx: typeof db, documentId: string, namespace: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${namespace}, ${lockKey(documentId)})`);
}

/** Lock namespaces — keep distinct so unrelated guards never collide. */
export const LOCK_NS = {
  INVOICE_POSTING: 1001,
  CREDIT_NOTE: 1002,
  FX_REVALUATION: 1003,
  /** Per company-month: shared by postings, exclusive for whoever locks the month (posting-lock.ts). */
  PERIOD_POSTING: 1004,
  /** Phase 8 D1: a quote's state change (send, accept, decline, revise, convert) one at a time. */
  QUOTE: 1005,
  /** Phase 8 D1: a gateway payment (one Stripe payment intent / charge) is settled and refunded one at a time. */
  GATEWAY: 1006,
  /** D3 banking (1301-1399): one bank line being matched, posted or unmatched. */
  BANK_TRANSACTION: 1301,
  /** D3: count-then-insert of statement lines for one bank account (imports and feed syncs). */
  BANK_ACCOUNT_IMPORT: 1302,
  /** D3: completing or reopening a reconciliation session for one bank account. */
  BANK_RECONCILIATION: 1303,
  // 1020-1029 are reserved for Phase 8 D2 (purchases, projects and people).
  /** Approval gate: one approve decision per bill, claim, PO, payroll run or journal at a time. */
  APPROVAL: 1020,
  /** Invoice-from-unbilled on one project. */
  PROJECT_INVOICE: 1021,
  /** Leave requests of one employee (balance and overlap checks). */
  LEAVE: 1022,
  /** Employee loan lifecycle (cancel, repay) against payroll approve. */
  EMPLOYEE_LOAN: 1023,
  /** Final settlement of one employee. */
  SETTLEMENT: 1024,
} as const;
