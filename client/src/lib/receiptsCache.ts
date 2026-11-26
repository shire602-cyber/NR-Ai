import type { QueryClient, QueryKey } from "@tanstack/react-query";

export type ReceiptsReadState = "loading" | "waiting" | "failed" | "stale" | "ready";

/**
 * What the saved-receipts list can claim. Only "ready" (the latest read succeeded) may show an
 * empty state or say that nothing matches. "stale" is rows kept from before a failed refresh:
 * show the matching rows, but never claim there are none. A paused first load or retry (offline,
 * or a hidden tab) is "waiting", not empty.
 */
export function receiptsReadState(query: {
  data: unknown;
  isSuccess: boolean;
  isLoadingError: boolean;
  isPaused: boolean;
}): ReceiptsReadState {
  if (query.data !== undefined) return query.isSuccess ? "ready" : "stale";
  if (query.isLoadingError) return "failed";
  return query.isPaused ? "waiting" : "loading";
}

/**
 * Refresh the receipt list after a write. A read already in flight may have started before the
 * write and would land stale data, so cancel it first, then refetch (also when there is no data
 * yet). Resolves once the refetch settles; it never rejects.
 */
export async function refreshReceiptsAfterWrite(
  client: QueryClient,
  queryKey: QueryKey
): Promise<void> {
  await client.cancelQueries({ queryKey });
  await client.invalidateQueries({ queryKey });
}

export interface ReceiptsSnapshot<T> {
  queryKey: QueryKey;
  previous: T[] | undefined;
}

/** Optimistic list change. A cache that has no data yet stays that way. */
export async function updateReceiptsOptimistically<T>(
  client: QueryClient,
  queryKey: QueryKey,
  update: (rows: T[]) => T[]
): Promise<ReceiptsSnapshot<T>> {
  await client.cancelQueries({ queryKey, exact: true });
  const previous = client.getQueryData<T[]>(queryKey);
  client.setQueryData<T[]>(queryKey, (old) => (old === undefined ? undefined : update(old)));
  return { queryKey, previous };
}

/** Restore the snapshot, first cancelling any read that could land around the restore. */
export async function rollbackReceipts<T>(
  client: QueryClient,
  snapshot: ReceiptsSnapshot<T> | undefined
): Promise<void> {
  if (snapshot?.previous === undefined) return;
  await client.cancelQueries({ queryKey: snapshot.queryKey, exact: true });
  client.setQueryData<T[]>(snapshot.queryKey, snapshot.previous);
}
