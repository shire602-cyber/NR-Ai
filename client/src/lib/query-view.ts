/**
 * What a contact or supplier list may honestly show, derived from React Query state: a first
 * load, a paused (offline) first load, a failed first load, or data that may be a saved copy
 * because the latest refresh paused or failed.
 */
export type QueryView =
  | { kind: "loading" }
  | { kind: "waiting" }
  | { kind: "noCompany" }
  | { kind: "error"; error: unknown; canRetry: boolean }
  | { kind: "data"; stale: "paused" | "error" | null; error: unknown };

export function queryView(
  query: { data: unknown; error: unknown; isError: boolean; fetchStatus: string },
  company: { companyId: string | undefined; isLoading: boolean; error: unknown }
): QueryView {
  const paused = query.fetchStatus === "paused";
  if (query.data !== undefined) {
    const stale = paused ? "paused" : query.isError ? "error" : null;
    return { kind: "data", stale, error: query.error };
  }
  // Without a company the query is disabled: report the company lookup instead.
  if (!company.companyId) {
    if (company.isLoading) return { kind: "loading" };
    if (company.error) return { kind: "error", error: company.error, canRetry: false };
    // No company and nothing in flight: say so, never an empty list.
    return { kind: "noCompany" };
  }
  if (paused) return { kind: "waiting" };
  if (query.isError) return { kind: "error", error: query.error, canRetry: true };
  return { kind: "loading" };
}
