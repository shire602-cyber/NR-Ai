/** Pure state helpers for the Corporate Tax screen (empty / error handling). */

import type { FetchStatus, QueryStatus } from "@tanstack/react-query";

export type ReturnsListState = "loading" | "paused" | "error" | "empty" | "ready" | "idle";

export function returnsListState(q: {
  status: QueryStatus;
  fetchStatus: FetchStatus;
  data: readonly unknown[] | undefined;
}): ReturnsListState {
  if (q.data?.length) return "ready";
  if (q.fetchStatus === "paused") return "paused";
  if (q.status === "error") return "error";
  if (q.status === "success" && q.data?.length === 0) return "empty";
  return q.fetchStatus === "fetching" ? "loading" : "idle";
}

/**
 * A calculation that processed no journal entries (and no manual workpaper figures were
 * entered) is an empty period, not a genuine nil return.
 */
export function isEmptyCalculation(
  calculation: { journalEntriesProcessed: number } | null,
  hasManualWorkpaper: boolean
): boolean {
  return !!calculation && calculation.journalEntriesProcessed === 0 && !hasManualWorkpaper;
}
