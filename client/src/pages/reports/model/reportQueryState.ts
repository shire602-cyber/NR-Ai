import type { FetchStatus } from "@tanstack/react-query";

/**
 * What a statement tab may show for one query. Figures render only from a response (fresh or
 * cached); without one a paused, loading or failed query must never read as a zero statement.
 */
export function reportQueryState(data: unknown, fetchStatus: FetchStatus, error: unknown) {
  const hasData = data != null;
  const paused = fetchStatus === "paused";
  if (hasData) {
    // A paused retry outranks the failure that preceded it.
    const notice = paused ? ("paused" as const) : error ? ("failed" as const) : null;
    return { view: "data" as const, notice };
  }
  const view = paused
    ? ("waiting" as const)
    : fetchStatus === "fetching"
      ? ("loading" as const)
      : error
        ? ("error" as const)
        : ("idle" as const);
  return { view, notice: null };
}
