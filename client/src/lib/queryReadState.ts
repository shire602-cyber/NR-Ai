import { QueryCache, type QueryKey } from "@tanstack/react-query";

/**
 * What a screen can honestly show for one query:
 *  - "pending": nothing has loaded yet (never show counts or empty copy),
 *  - "error":   nothing to show and the read failed, or access to the data was lost,
 *  - "stale":   a transient refresh failure; the last successful data is still here,
 *  - "ready":   the data is current.
 */
export type QueryReadState = "pending" | "error" | "stale" | "ready";

// Duck-typed (ApiError carries `status`): importing it here would make a cycle with queryClient.
const errorStatus = (error: unknown) => (error as { status?: unknown } | null | undefined)?.status;

/** The reader is signed out or no longer allowed to see this: cached data must not be shown. */
function isAccessRefused(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 401 || status === 403;
}

/**
 * Another tenant's data is a 404 (never a 403), so a 404 on a company-scoped key also means the
 * cached copy is no longer the reader's. Company-scoped keys are `["/api/companies", companyId, ...]`
 * (or one joined `/api/companies/<id>/...` string). Any other tenant-scoped endpoint opts in with
 * `meta: { tenantScoped: true }`; a 404 elsewhere stays a plain not-found.
 */
function isTenantScoped(queryKey: QueryKey, meta?: Record<string, unknown>): boolean {
  if (meta?.tenantScoped === true) return true;
  const [first, second] = queryKey;
  if (first === "/api/companies") return typeof second === "string" && second.length > 0;
  return typeof first === "string" && /^\/api\/companies\/[^/?]+/.test(first);
}

/**
 * The app's query cache. When access is lost it drops the cached data (keeping the error, so access
 * screens still render) and marks the query invalid; a later successful refetch restores it.
 * Transient failures (offline, 5xx) keep the data.
 */
export function createQueryCache(): QueryCache {
  return new QueryCache({
    onError: (error, query) => {
      const lost =
        isAccessRefused(error) ||
        (errorStatus(error) === 404 && isTenantScoped(query.queryKey, query.meta));
      if (lost && query.state.data !== undefined) {
        query.setState({ data: undefined, isInvalidated: true });
      }
    },
  });
}

export function queryReadState(query: {
  data: unknown;
  isError: boolean;
  error?: unknown;
  /** Pass with `meta` so a tenant-scoped 404 drops cached data even on a client without our cache. */
  queryKey?: QueryKey;
  meta?: Record<string, unknown>;
}): QueryReadState {
  if (query.isError && isAccessRefused(query.error)) return "error";
  if (
    query.isError &&
    query.queryKey &&
    errorStatus(query.error) === 404 &&
    isTenantScoped(query.queryKey, query.meta)
  ) {
    return "error";
  }
  if (query.data !== undefined) return query.isError ? "stale" : "ready";
  return query.isError ? "error" : "pending";
}

/** True when `query.data` may be rendered (current, or kept from before a failed refresh). */
export function hasReadData(state: QueryReadState): boolean {
  return state === "ready" || state === "stale";
}
