/** Keyset pagination over (created_at, id). Cursors are opaque base64url tokens. */

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

export interface Cursor {
  /** created_at of the last row of the previous page, as rendered by TS_SQL. */
  t: string;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(raw: unknown): Cursor | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed?.t === "string" &&
      !Number.isNaN(Date.parse(parsed.t)) &&
      typeof parsed?.id === "string" &&
      /^[0-9a-f-]{36}$/i.test(parsed.id)
    ) {
      return { t: parsed.t, id: parsed.id };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function parseLimit(raw: unknown): number | null {
  if (raw === undefined || raw === "") return DEFAULT_PAGE_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_LIMIT) return null;
  return n;
}

/**
 * `ts` is created_at rendered by Postgres (`to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.US')`): the cursor
 * round-trips the exact microsecond with no time-zone conversion in between.
 */
export const TS_SQL = (col: string) => `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

/** Fetch limit+1 rows, return the page and the next cursor (null on the last page). */
export function pageFromRows<T extends { ts: string; id: string }>(
  rows: T[],
  limit: number
): { rows: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor:
      hasMore && last
        ? encodeCursor({ t: last.ts, id: last.id })
        : null,
  };
}
