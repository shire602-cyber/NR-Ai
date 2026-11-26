/**
 * What a screen can honestly show for one query:
 *  - "pending": nothing has loaded yet (never show counts or empty copy),
 *  - "error":   nothing to show and the read failed,
 *  - "stale":   a refresh failed but the last successful data is still here,
 *  - "ready":   the data is current.
 */
export type QueryReadState = "pending" | "error" | "stale" | "ready";

export function queryReadState(query: {
  data: unknown;
  isError: boolean;
  error?: unknown;
}): QueryReadState {
  if (query.data !== undefined) return query.isError ? "stale" : "ready";
  return query.isError ? "error" : "pending";
}

/** True when `query.data` may be rendered (current, or kept from before a failed refresh). */
export function hasReadData(state: QueryReadState): boolean {
  return state === "ready" || state === "stale";
}
