/** Typed wrapper over the shared pg pool (which is exported untyped). */
import { pool } from "../../db";

export interface SqlResult<T> {
  rows: T[];
  rowCount: number | null;
}

export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<SqlResult<T>> {
  return (await pool.query(text, params)) as unknown as SqlResult<T>;
}
