/**
 * Raw-SQL access for the payroll tables (employees, payroll_runs,
 * payroll_items, leave_*, payroll_*), which exist only in migrations and not
 * in shared/schema.ts.
 *
 *   await q("SELECT * FROM employees WHERE company_id = $1", [companyId]);
 *   await withLedgerTx(async (tx) => q("UPDATE ...", [...], tx));
 *
 * Without `tx` the statement runs on the pool; with `tx` (a drizzle
 * transaction from withLedgerTx) the `$n` text is rebuilt as a drizzle `sql`
 * fragment so it joins that transaction with the same bound parameters.
 */
import type { SQL } from "drizzle-orm";
import { db } from "../../db";
import { parameterizedSql, rowsOf } from "../../ledger/tx";
import type { LedgerTx } from "../../ledger";

export type Row = Record<string, unknown>;

interface PgPoolLike {
  query(text: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}
interface Executor {
  execute(query: SQL): Promise<unknown>;
}

export async function q<T = Row>(
  text: string,
  params: unknown[] = [],
  tx?: LedgerTx
): Promise<T[]> {
  if (tx) {
    return rowsOf<T>(await (tx as unknown as Executor).execute(parameterizedSql(text, params)));
  }
  const pool = (db as unknown as { $client: PgPoolLike }).$client;
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function q1<T = Row>(
  text: string,
  params: unknown[] = [],
  tx?: LedgerTx
): Promise<T | undefined> {
  const rows = await q<T>(text, params, tx);
  return rows[0];
}

// ─── Row value helpers ───────────────────────────────────────────────────────

/** numeric column ("1234.50" | number | null) -> integer fils. */
export function fils(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const s = typeof value === "number" ? value.toFixed(2) : String(value);
  const m = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(s.trim());
  if (!m) return 0;
  const cents = (m[3] ?? "").padEnd(2, "0");
  const v = Number(m[2]) * 100 + Number(cents);
  return m[1] ? -v : v;
}

export function num(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** date / timestamp column -> "YYYY-MM-DD" (local calendar date as pg parsed it). */
export function dayOf(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}
