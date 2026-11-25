import { useRef, useState } from "react";

/**
 * Retrying a query that has no data yet: React Query drops the error and reports an initial load,
 * which would unmount the "Try again" button the customer just pressed. This holds that error
 * until the retry settles, per query key (so per supplier), and ignores repeated presses.
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
    /** A first load, as opposed to a manual retry of a failed one. */
    isLoading: isLoading && !heldError,
    retry,
  };
}
