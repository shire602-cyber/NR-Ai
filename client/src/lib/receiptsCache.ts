import {
  isCancelledError,
  type Query,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

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

/**
 * Query -> `dataUpdateCount` at the time an optimistic write changed the row count. Optimistic
 * writes use `Query.setState`, which (unlike `setQueryData`) leaves the read metadata alone, so
 * the count only moves when a real read lands. A mark that still equals the query's count means
 * the rows on screen have never been confirmed by the server since the removal.
 */
const removalMarks = new WeakMap<object, number>();

function findReceiptsQuery<T>(client: QueryClient, queryKey: QueryKey) {
  return client.getQueryCache().find<T[]>({ queryKey, exact: true });
}

/** Swap the cached rows without touching read metadata; a changed row count is marked. */
function replaceRows<T>(query: Query<T[]>, next: T[]) {
  const current = query.state.data;
  if (current === undefined || current.length !== next.length) {
    removalMarks.set(query, query.state.dataUpdateCount);
  }
  query.setState({ data: next });
}

/**
 * True while the cached rows include an optimistic (or rolled back) row-count change that no
 * server read has confirmed. An empty list or "no matches" must not be claimed in that window.
 */
export function hasUnconfirmedRowRemoval(client: QueryClient, queryKey: QueryKey): boolean {
  const query = findReceiptsQuery<unknown>(client, queryKey);
  return !!query && removalMarks.get(query) === query.state.dataUpdateCount;
}

/** Optimistic list change. A cache that has no data yet stays that way. */
export async function updateReceiptsOptimistically<T>(
  client: QueryClient,
  queryKey: QueryKey,
  update: (rows: T[]) => T[]
): Promise<ReceiptsSnapshot<T>> {
  await client.cancelQueries({ queryKey, exact: true });
  const query = findReceiptsQuery<T>(client, queryKey);
  const previous = query?.state.data;
  if (query && previous !== undefined) replaceRows(query, update(previous));
  return { queryKey, previous };
}

/** Restore the snapshot, first cancelling any read that could land around the restore. */
export async function rollbackReceipts<T>(
  client: QueryClient,
  snapshot: ReceiptsSnapshot<T> | undefined
): Promise<void> {
  if (snapshot?.previous === undefined) return;
  await client.cancelQueries({ queryKey: snapshot.queryKey, exact: true });
  // Restored rows are still not a server answer: a count change is marked against the current
  // read count (which also covers a read that landed after the optimistic write).
  const query = findReceiptsQuery<T>(client, snapshot.queryKey);
  if (query) replaceRows(query, snapshot.previous);
}

/**
 * Resolve a receipt by id (cached list first, then a fresh read) and hand it to `onOpen`.
 * A write refresh cancels reads in flight, which rejects the read with a cancellation. The lookup
 * then yields once (letting the refresh start its replacement) and follows the query's current
 * retryer promise if it differs from the cancelled one (even if already settled or paused), and
 * only otherwise starts a read. It repeats until a real read settles or `signal` aborts, which
 * stops it before `onOpen`. Never rejects: a genuine read failure ends the lookup.
 */
export async function openReceiptById<T extends { id: string }>(opts: {
  client: QueryClient;
  queryKey: QueryKey;
  id: string;
  cached: T[] | undefined;
  signal: AbortSignal;
  onOpen: (receipt: T) => void;
}): Promise<void> {
  const { client, queryKey, id, cached, signal, onOpen } = opts;
  let target = cached?.find((r) => r.id === id);
  if (!target) {
    // Start (or join) a read and return the query's retryer promise, captured right away.
    const startRead = (): Promise<T[]> => {
      const started = client.fetchQuery<T[]>({ queryKey, staleTime: 0 });
      // Only the retryer promise is awaited; keep the wrapper from becoming unhandled.
      started.catch(() => undefined);
      return findReceiptsQuery<T>(client, queryKey)?.promise ?? started;
    };
    let read = signal.aborted ? undefined : startRead();
    while (read && !target) {
      try {
        const fresh = await read;
        target = fresh.find((r) => r.id === id);
        break;
      } catch (error) {
        if (!isCancelledError(error)) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (signal.aborted) return;
        const current = findReceiptsQuery<T>(client, queryKey)?.promise;
        read = current && current !== read ? current : startRead();
      }
    }
  }
  if (target && !signal.aborted) onOpen(target);
}
