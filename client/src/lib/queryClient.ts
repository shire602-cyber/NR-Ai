import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getAuthHeaders, hasAuthHint, refreshSession } from "./auth";
import { apiUrl } from "./api";
import { withCsrfHeader, clearCsrfToken } from "./csrf";
import { isOnline, queueForSync } from "./pwa";
import { localizeApiError, VALIDATION_NAMESPACES } from "./validation-messages";
import { loadNamespaces, useI18n } from "./i18n";
import { announcePlanLimit } from "./plan-limit";
import {
  PERIOD_LOCK_REASON_HEADER,
  askLockReason,
  encodeLockReason,
  isOverridableSoftLock,
} from "./period-lock-reason";

/** Error that carries the HTTP status code — used to decide retry behaviour. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Parsed JSON error body (code, issues, details, ...) when the server sent one. */
    public readonly body?: Record<string, unknown>,
    /** The server's own message, unchanged (`message` is Arabic for known errors in Arabic mode). */
    public readonly rawMessage: string = message
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage = res.statusText;
    let body: Record<string, unknown> | undefined;
    try {
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const json = await res.json();
        if (json && typeof json === "object") body = json;
        errorMessage = json.message || json.error || JSON.stringify(json);
      } else {
        const text = await res.text();
        // If it's HTML, just use the status
        if (text.includes("<!DOCTYPE") || text.includes("<html")) {
          errorMessage = `${res.status}: ${res.statusText}`;
        } else {
          errorMessage = text.substring(0, 200);
        }
      }
    } catch {
      errorMessage = res.statusText;
    }
    // E3 (J2-r3): the localised error copy lives in `forms`, which public routes do not load.
    await loadNamespaces(useI18n.getState().locale, VALIDATION_NAMESPACES).catch(() => undefined);
    // WQ7: a plan refusal (402/403 with a plan code) also opens the upgrade prompt.
    announcePlanLimit(body);
    throw new ApiError(localizeApiError(body) ?? errorMessage, res.status, body, errorMessage);
  }
}

async function parseResponseBody(res: Response): Promise<any> {
  if (res.status === 204 || res.status === 205 || res.headers.get("content-length") === "0") {
    return null;
  }

  const text = await res.text();
  if (!text) return null;

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return JSON.parse(text);
  }

  return text;
}

async function isCsrfInvalidResponse(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try {
    const json = await res.clone().json();
    return json?.code === "CSRF_INVALID";
  } catch {
    return false;
  }
}

/** Mutating methods are eligible for offline queueing. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function buildRequestHeaders(
  method: string,
  data?: unknown
): Promise<Record<string, string>> {
  let headers: Record<string, string> = {
    ...getAuthHeaders(),
  };

  if (data !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  // Cookie-session requests need CSRF tokens; Bearer requests are exempt server-side.
  if (!headers.Authorization) {
    headers = await withCsrfHeader(method, headers);
  }

  return headers;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  /** Extra request headers, e.g. `X-Period-Lock-Reason` for an audited soft-lock override. */
  extraHeaders?: Record<string, string>
): Promise<any> {
  const withExtra = (h: Record<string, string>) => (extraHeaders ? { ...h, ...extraHeaders } : h);
  let headers = withExtra(await buildRequestHeaders(method, data));

  const fullUrl = apiUrl(url);
  const upperMethod = method.toUpperCase();
  const body = data !== undefined ? JSON.stringify(data) : undefined;

  // If we're offline and this is a mutation, queue it for the service worker
  // to replay once connectivity returns. Reads are not queued — they should
  // surface a clear error so the UI can render its offline state.
  if (!isOnline() && MUTATING_METHODS.has(upperMethod)) {
    await queueForSync({ url: fullUrl, method: upperMethod, headers, body });
    throw new ApiError("You are offline. This change will sync when you reconnect.", 0);
  }

  let res = await fetch(fullUrl, {
    method,
    headers,
    body,
    credentials: "include",
  });

  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      headers = withExtra(await buildRequestHeaders(method, data));
      res = await fetch(fullUrl, {
        method,
        headers,
        body,
        credentials: "include",
      });
    }
  }

  // A CSRF token can expire or be dropped during a deploy/cookie rotation.
  // Refetch once and replay the mutation so onboarding and other form saves
  // recover without making the user refresh the whole app.
  if (await isCsrfInvalidResponse(res)) {
    clearCsrfToken();
    const retryHeaders = await withCsrfHeader(method, { ...headers });
    res = await fetch(fullUrl, {
      method,
      headers: retryHeaders,
      body,
      credentials: "include",
    });
    if (await isCsrfInvalidResponse(res)) {
      clearCsrfToken();
    }
  }

  // X5 (J1 D3): a soft-locked period the user may override: ask for a reason, replay once.
  if (res.status === 403 && MUTATING_METHODS.has(upperMethod)) {
    const lockBody = await softLockBody(res);
    if (lockBody) {
      const reason = await askLockReason(lockBody);
      if (reason) {
        const lockHeaders = withExtra(await buildRequestHeaders(method, data));
        lockHeaders[PERIOD_LOCK_REASON_HEADER] = encodeLockReason(reason);
        res = await fetch(fullUrl, {
          method,
          headers: lockHeaders,
          body,
          credentials: "include",
        });
      }
    }
  }

  await throwIfResNotOk(res);
  return parseResponseBody(res);
}

async function softLockBody(res: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const json = await res.clone().json();
    return isOverridableSoftLock(json) ? json : undefined;
  } catch {
    return undefined;
  }
}

const ANONYMOUS_SKIP_KEYS = new Set(["/api/companies", "/api/auth/me"]);

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = apiUrl(queryKey.join("/") as string);
    // R18-04: anonymous visitors have no session, so skip the bootstrap probes
    // that would only produce 401 console noise. This resolves exactly as the
    // 401 would have (null / thrown 401) WITHOUT caching a successful empty
    // result, so the first query after sign-in still fetches the real data.
    if (!hasAuthHint() && ANONYMOUS_SKIP_KEYS.has(queryKey.join("/") as string)) {
      if (unauthorizedBehavior === "returnNull") return null as never;
      throw new ApiError("Not signed in", 401);
    }
    let res = await fetch(url, {
      credentials: "include",
      headers: getAuthHeaders(),
    });

    if (res.status === 401) {
      const refreshed = await refreshSession();
      if (refreshed) {
        res = await fetch(url, {
          credentials: "include",
          headers: getAuthHeaders(),
        });
      }
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await parseResponseBody(res);
  };

// Don't retry client errors (4xx) — only retry network failures and 5xx
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 3;
}

// staleTime: Infinity means a query never re-fetches on its own — fine for
// truly static reference data, but for the lists/dashboards we render it
// freezes the UI on whatever was first loaded. Default to 1 minute fresh +
// 10 minutes in cache (gcTime), so:
//   • repeated mounts of the same screen reuse the cache without a network
//     round-trip,
//   • after 60s a focus/refetch updates the data,
//   • a screen the user comes back to within 10 minutes paints instantly.
// Mutations still call queryClient.invalidateQueries to force-refresh after
// writes, so freshness guarantees don't depend on the timer alone.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      retry: shouldRetry,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30_000),
    },
    mutations: {
      retry: false,
    },
  },
});
