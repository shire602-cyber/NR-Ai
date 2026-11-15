/**
 * Journal entry numbering: JE-YYYYMMDD-NNN per company and posting date.
 *
 * R14-06: the number is allocated INSIDE the posting transaction, on the same
 * connection, under pg_advisory_xact_lock. The lock is released by COMMIT or
 * ROLLBACK, so it can never leak onto an idle pooled connection (the old
 * session-level pg_advisory_lock/unlock pair could run on two different pooled
 * connections and leave the lock held forever). The unique constraint
 * (company_id, entry_number) stays as the backstop.
 *
 * The lock keys are the same (company hash, prefix hash) pair that
 * storage.recordInvoicePayment uses, so both writers serialise on one lock.
 */
import { sql } from "drizzle-orm";
import type { LedgerTx } from "./types";
import { rowsOf } from "./tx";

/** Stable 32-bit string hash (same algorithm as server/storage.ts hashStringToInt). */
export function hashKey(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

export function entryNumberPrefix(date: Date): string {
  return `JE-${date.toISOString().slice(0, 10).replace(/-/g, "")}`;
}

export function entryNumberLockKeys(companyId: string, prefix: string): [number, number] {
  return [hashKey(companyId), hashKey(prefix)];
}

async function maxSequence(tx: LedgerTx, companyId: string, prefix: string): Promise<number> {
  const counterStart = prefix.length + 2; // 1-based SUBSTRING position of NNN
  // The ::int cast is load-bearing: a text parameter selects the regex form
  // of SUBSTRING and returns NULL for every row.
  const res = await tx.execute(sql`
    SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number FROM ${counterStart}::int) AS INTEGER)), 0) AS max_seq
      FROM journal_entries
     WHERE company_id = ${companyId}
       AND entry_number LIKE ${prefix + "-%"}
       AND entry_number ~ ${"^" + prefix + "-[0-9]+$"}
  `);
  const rows = rowsOf<{ max_seq: number | string | null }>(res);
  return Number(rows[0]?.max_seq ?? 0);
}

/**
 * Allocate the next entry number. MUST be called inside a transaction; the
 * advisory lock is held until that transaction ends, so insert the entry in
 * the same transaction.
 */
export async function allocateEntryNumber(
  tx: LedgerTx,
  companyId: string,
  date: Date
): Promise<string> {
  const prefix = entryNumberPrefix(date);
  const [k1, k2] = entryNumberLockKeys(companyId, prefix);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${k1}::int, ${k2}::int)`);
  const next = (await maxSequence(tx, companyId, prefix)) + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

/**
 * Lock-free preview of the next number (what storage.generateEntryNumber
 * returns). Informational only: the real number is allocated at insert time.
 */
export async function previewEntryNumber(
  tx: LedgerTx,
  companyId: string,
  date: Date
): Promise<string> {
  const prefix = entryNumberPrefix(date);
  const next = (await maxSequence(tx, companyId, prefix)) + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

/** Transaction-scoped lock serialising one idempotency key per company. */
export async function lockIdempotencyKey(
  tx: LedgerTx,
  companyId: string,
  key: string
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${hashKey(companyId)}::int, ${hashKey("idem:" + key)}::int)`
  );
}
