import { useRef, useState } from "react";

/**
 * Retrying a query that has no data yet: React Query drops the error and reports an initial load,
 * which would unmount the "Try again" button the customer just pressed. This holds that error
 * until the retry settles, per query key (so per supplier), and ignores repeated presses.
 *
 * A pending retry is not the same as a fetching one: offline or unfocused, React Query queues the
 * request, so `retryPending` stays true through the pause while `isFetching` is false.
 */
export function usePortalRetry(
  queryKey: readonly unknown[],
  query: {
    data: unknown;
    error: unknown;
    isLoading: boolean;
    refetch: (options: { cancelRefetch: boolean }) => Promise<unknown>;
  }
) {
  const { data, error, isLoading, refetch } = query;
  const key = JSON.stringify(queryKey);
  const inFlight = useRef(new Set<string>());
  const [held, setHeld] = useState<Record<string, unknown>>({});
  const heldError = data === undefined ? held[key] : undefined;
  const retryPending = key in held;

  const retry = () => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setHeld((current) => ({ ...current, [key]: error }));
    void refetch({ cancelRefetch: false }).finally(() => {
      inFlight.current.delete(key);
      setHeld((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    });
  };

  return {
    error: heldError ?? error,
    /** A first load, as opposed to one the customer asked for with "Try again". */
    isLoading: isLoading && !retryPending,
    /** A manual retry has not settled yet, whether it is fetching or queued. */
    retryPending,
    retry,
  };
}
