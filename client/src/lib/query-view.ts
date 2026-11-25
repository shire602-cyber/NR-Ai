/**
 * What a contact or supplier list may honestly show, derived from React Query state: a first
 * load, a paused first load, a failed first load, or data that may be a saved copy because the
 * latest refresh paused or failed. "Paused" says nothing about why (offline, or waiting for focus).
 */
export type QueryView =
  | { kind: "loading" }
  | { kind: "waiting" }
  | { kind: "noCompany" }
  | { kind: "error"; error: unknown; canRetry: boolean }
  | { kind: "data"; stale: "paused" | "error" | null; error: unknown };

export function queryView(
  query: {
    data: unknown;
    error: unknown;
    /** An error with no data to fall back on (the first request failed). */
    isLoadingError: boolean;
    /** An error on a refresh: the data stays, and is a saved copy. */
    isRefetchError: boolean;
    fetchStatus: string;
  },
  company: {
    companyId: string | undefined;
    isLoading: boolean;
    /** The company lookup itself is paused (no company yet). */
    isPaused?: boolean;
    error: unknown;
  }
): QueryView {
  const paused = query.fetchStatus === "paused";
  if (query.data !== undefined) {
    const stale = paused ? "paused" : query.isRefetchError ? "error" : null;
    return { kind: "data", stale, error: query.error };
  }
  // Without a company the query is disabled: report the company lookup instead.
  if (!company.companyId) {
    if (company.isPaused) return { kind: "waiting" };
    if (company.isLoading) return { kind: "loading" };
    if (company.error) return { kind: "error", error: company.error, canRetry: false };
    // No company and nothing in flight: say so, never an empty list.
    return { kind: "noCompany" };
  }
  if (paused) return { kind: "waiting" };
  if (query.isLoadingError) return { kind: "error", error: query.error, canRetry: true };
  return { kind: "loading" };
}
