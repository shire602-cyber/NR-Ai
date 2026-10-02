// Reversal bookkeeping of journal entries. The ledger pairs a reversed entry with an equal-and-opposite POSTED reversal entry
// (source "reversal", reversed_entry_id = the original); the original keeps status "posted" (marking it void would remove it from
// reports while the reversal still subtracts it, a double reversal). So "is this entry reversed" is DERIVED from the pair:
// a posted reversal entry points at it. Voiding that reversal entry takes it out of the ledger and re-opens the original.

import { sql } from "drizzle-orm";
import { db } from "../db";

type Executor = { execute: (query: any) => Promise<any> };
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];

export interface ReversalLink {
  /** The posted reversal entry that reverses this entry (null when it is not reversed). */
  reversedById: string | null;
  reversedByNumber: string | null;
  reversedAt: string | null;
}

/** The posted reversal of an entry, if any. */
export async function findPostedReversal(companyId: string, entryId: string, ex: Executor = db as unknown as Executor): Promise<{ id: string; entryNumber: string } | null> {
  const res = await ex.execute(sql`
    SELECT id, entry_number FROM journal_entries
     WHERE company_id = ${companyId} AND source = 'reversal' AND status = 'posted' AND reversed_entry_id = ${entryId}
     ORDER BY created_at LIMIT 1`);
  const row = rowsOf(res)[0];
  return row ? { id: String(row.id), entryNumber: String(row.entry_number) } : null;
}

/** For a page of entries: which of them are reversed, and by which posted reversal entry. */
export async function reversalLinksFor(companyId: string, entryIds: string[]): Promise<Map<string, ReversalLink>> {
  const out = new Map<string, ReversalLink>();
  if (entryIds.length === 0) return out;
  const res = await db.execute(sql`
    SELECT id, entry_number, reversed_entry_id, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
      FROM journal_entries
     WHERE company_id = ${companyId} AND source = 'reversal' AND status = 'posted'
       AND reversed_entry_id IN (${sql.join(entryIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
  for (const r of rowsOf(res)) {
    const key = String(r.reversed_entry_id);
    if (!out.has(key)) out.set(key, { reversedById: String(r.id), reversedByNumber: String(r.entry_number), reversedAt: r.at ?? null });
  }
  return out;
}

export const NOT_REVERSED: ReversalLink = { reversedById: null, reversedByNumber: null, reversedAt: null };
