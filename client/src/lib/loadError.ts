import { ApiError } from "@/lib/queryClient";

export type LoadErrorKind = "offline" | "server" | "forbidden" | "notFound";

/**
 * Why a query failed, as one of four reader-facing causes. The raw message (a server string or
 * the browser's "Failed to fetch") is never shown: each kind has its own translated copy.
 */
export function classifyLoadError(error: unknown): LoadErrorKind {
  if (error instanceof ApiError) {
    if (error.status === 403) return "forbidden";
    if (error.status === 404) return "notFound";
    return "server";
  }
  const status = (error as { status?: number } | null)?.status;
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (typeof status === "number" && status >= 500) return "server";
  // fetch() rejected before any response: offline, DNS, timeout.
  return "offline";
}

/** Translated one-sentence cause for a failed query or mutation (for toasts); never `error.message`. */
export function loadErrorMessage(
  error: unknown,
  t: Record<string, string | undefined>
): string | undefined {
  const kind = classifyLoadError(error);
  return {
    offline: t["firm.loadOfflineBody"],
    server: t["firm.loadFailedBody"],
    forbidden: t["firm.loadForbiddenBody"],
    notFound: t["firm.loadNotFoundBody"],
  }[kind];
}
