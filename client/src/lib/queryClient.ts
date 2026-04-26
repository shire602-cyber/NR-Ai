import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getAuthHeaders } from "./auth";
import { apiUrl } from "./api";

/** Error that carries the HTTP status code — used to decide retry behaviour. */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage = res.statusText;
    try {
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const json = await res.json();
        errorMessage = json.message || json.error || JSON.stringify(json);
      } else {
        const text = await res.text();
        // If it's HTML, just use the status
        if (text.includes('<!DOCTYPE') || text.includes('<html')) {
          errorMessage = `${res.status}: ${res.statusText}`;
        } else {
          errorMessage = text.substring(0, 200);
        }
      }
    } catch {
      errorMessage = res.statusText;
    }
    throw new ApiError(errorMessage, res.status);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<any> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
  };

  if (data) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(apiUrl(url), {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res.json();
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(apiUrl(queryKey.join("/") as string), {
      credentials: "include",
      headers: getAuthHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
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
