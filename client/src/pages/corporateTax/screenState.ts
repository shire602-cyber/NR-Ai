/** Pure state helpers for the Corporate Tax screen (empty / error handling). */

export type ReturnsListState = "loading" | "error" | "empty" | "ready";

/** A failed fetch must never look like "no returns yet". */
export function returnsListState(q: {
  isLoading: boolean;
  isError: boolean;
  data: readonly unknown[] | undefined;
}): ReturnsListState {
  if (q.isLoading) return "loading";
  if (q.isError) return "error";
  if (!q.data || q.data.length === 0) return "empty";
  return "ready";
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
