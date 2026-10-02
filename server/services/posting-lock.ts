// "Lock this month" and "post into this month" must be mutually exclusive.
//
// The period-lock check used to run in the route, OUTSIDE the transaction that
// writes the journal entry, so a posting could pass the check, then a VAT filing
// or year-end close could lock the month and clear the VAT accounts, and only
// then would the posting commit: a journal entry inside a locked month, created
// after the clearing entry (measured: 1 of 12 parallel issues).
//
// One Postgres transaction-scoped advisory lock per (company, calendar month):
//
//   * every transaction that writes a POSTED journal entry takes it in SHARED
//     mode for the month of the entry date and then RE-CHECKS the period lock
//     inside that same transaction (assertMonthOpen*);
//   * every transaction that LOCKS a period (VAT filing, year-end close, month-end
//     lock) takes it in EXCLUSIVE mode, first thing, for each month it locks.
//
// Shared locks do not block each other, so ordinary posting throughput is
// unchanged. A lock waits for in-flight postings to commit; a posting that
// starts after it finds the month locked and is refused cleanly.
//
// Callers that lock several months take them in ascending order.
// Connection-pool note (see document-queue.ts): a transaction waiting for this
// lock holds a pooled connection, so the exclusive holder must do all its work
// on its own transaction connection and never wait for a second one.

import { sql } from "drizzle-orm";
import { AppError } from "../errors";
import { LOCK_NS } from "./document-lock";

type DateLike = Date | string;

/**
 * Narrow, audited exceptions that skip ONLY the period-lock re-check (never the
 * advisory lock). Constructed by server code, never from a request body.
 */
export type PostingBypass =
  // a corporate tax accrual (and its closing line) dated the last day of a tax year whose month is locked
  | { reason: "corporate_tax_accrual"; returnId: string }
  // the year-end closing entry, dated the last day of a year whose December a VAT filing has locked
  | { reason: "year_end_close"; closeId?: string }
  // its reversal when the year is reopened
  | { reason: "year_end_reopen"; closeId: string }
  // the VAT filing journal (clearing of the VAT accounts), dated the filing day, when that day's month was locked meanwhile:
  // only the filing flow constructs it, and it is labelled as the VAT filing journal
  | { reason: "vat_filing"; returnId: string };

/** Calendar month (UTC) of a date, "YYYY-MM": the convention month_end_close uses. */
export function monthKeyOf(date: DateLike): string {
  if (typeof date === "string" && /^\d{4}-\d{2}/.test(date)) return date.slice(0, 7);
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid posting date: ${String(date)}`);
  return d.toISOString().slice(0, 7);
}

function hash32(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/** (namespace, key) int4 pair of the advisory lock for a company-month. */
export function monthLockKeys(companyId: string, date: DateLike): [number, number] {
  return [LOCK_NS.PERIOD_POSTING, hash32(`${companyId}:${monthKeyOf(date)}`)];
}

const isoDay = (date: DateLike): string => {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
  return (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10);
};

function lockedError(date: DateLike): AppError {
  const day = isoDay(date);
  return new AppError({
    message: `Cannot post to locked period (${day.slice(5, 7)}/${day.slice(0, 4)}). Unlock the period first.`,
    statusCode: 403,
    code: "PERIOD_LOCKED",
  });
}

// ─── Drizzle transactions ────────────────────────────────────────────────────

type Tx = { execute: (query: any) => Promise<any> };

/** SHARED month lock: held until the surrounding transaction ends. */
export async function acquirePostingLockShared(tx: Tx, companyId: string, date: DateLike): Promise<void> {
  const [ns, key] = monthLockKeys(companyId, date);
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${ns}, ${key})`);
}

/** EXCLUSIVE month locks for every distinct month of `dates`, ascending. */
export async function acquirePeriodLockExclusive(tx: Tx, companyId: string, dates: DateLike[]): Promise<void> {
  const months = [...new Set(dates.map(monthKeyOf))].sort();
  for (const month of months) {
    const [ns, key] = monthLockKeys(companyId, `${month}-01`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ns}, ${key})`);
  }
}

/** The period-lock check, on the transaction's own connection (after the shared lock is held). */
export async function assertMonthOpenInTx(tx: Tx, companyId: string, date: DateLike): Promise<void> {
  const day = isoDay(date);
  const res: any = await tx.execute(sql`
    SELECT 1 FROM month_end_close
     WHERE company_id = ${companyId} AND status = 'locked'
       AND ${day}::date >= date_trunc('month', period_end)::date
       AND ${day}::date <= period_end
     LIMIT 1`);
  const rows = (res?.rows ?? res) as unknown[];
  if (Array.isArray(rows) && rows.length > 0) throw lockedError(date);
}

/** Shared lock + re-check: what every posting transaction does for the month of its entry date. */
export async function lockAndCheckMonth(
  tx: Tx,
  companyId: string,
  date: DateLike,
  bypass?: PostingBypass
): Promise<void> {
  await acquirePostingLockShared(tx, companyId, date);
  if (!bypass) await assertMonthOpenInTx(tx, companyId, date);
}

// ─── Raw pg clients (paths that write journal rows with plain SQL) ───────────

type PgClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export async function lockAndCheckMonthPg(client: PgClient, companyId: string, date: DateLike): Promise<void> {
  const [ns, key] = monthLockKeys(companyId, date);
  await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [ns, key]);
  const day = isoDay(date);
  const res = await client.query(
    `SELECT 1 FROM month_end_close
      WHERE company_id = $1 AND status = 'locked'
        AND $2::date >= date_trunc('month', period_end)::date AND $2::date <= period_end
      LIMIT 1`,
    [companyId, day]
  );
  if (res.rows.length > 0) throw lockedError(date);
}
