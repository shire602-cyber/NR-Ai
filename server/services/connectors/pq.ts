/** Typed wrapper over the untyped pg pool for raw-SQL tables (vendor_bills, ...). */
import { pool } from "../../db";

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

export async function pq<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
  client: Queryable = pool
): Promise<{ rows: T[]; rowCount: number }> {
  const res = await client.query(text, params);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
}
