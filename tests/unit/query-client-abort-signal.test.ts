// PR #164: the default query loader must hand React Query's AbortSignal to fetch (initial GET and
// the retry after a session refresh) so cancelling a query cancels the network request.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const refreshSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getAuthHeaders: () => ({}),
  hasAuthHint: () => true,
  refreshSession,
}));
vi.mock("@/lib/api", () => ({ apiUrl: (p: string) => p }));
vi.mock("@/lib/bootFetch", () => ({ takeBootFetch: async () => null }));
vi.mock("@/lib/csrf", () => ({
  withCsrfHeader: async (_m: string, h: Record<string, string>) => h,
  clearCsrfToken: () => undefined,
}));
vi.mock("@/lib/pwa", () => ({ isOnline: () => true, queueForSync: async () => undefined }));
vi.mock("@/lib/validation-messages", () => ({
  localizeApiError: () => undefined,
  localizeApiErrorByStatus: () => undefined,
  SERVER_ERROR_NAMESPACES: [],
}));
vi.mock("@/lib/i18n", () => ({
  loadNamespaces: async () => undefined,
  useI18n: { getState: () => ({ locale: "en" }) },
}));
vi.mock("@/lib/plan-limit", () => ({ announcePlanLimit: () => undefined }));
vi.mock("@/lib/portal-state", () => ({
  clearRevokedPortalSelection: () => undefined,
  getPortalAccountSelection: () => null,
  portalRequestHeaders: () => ({}),
}));
vi.mock("@/lib/period-lock-reason", () => ({
  PERIOD_LOCK_REASON_HEADER: "X-Period-Lock-Reason",
  askLockReason: async () => null,
  encodeLockReason: (r: string) => r,
  isOverridableSoftLock: () => false,
}));

import { getQueryFn } from "@/lib/queryClient";

function jsonResponse(status: number, body: unknown = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function run(signal: AbortSignal, key = "/api/things") {
  const fn = getQueryFn<unknown>({ on401: "throw" }) as (ctx: unknown) => Promise<unknown>;
  return fn({ queryKey: [key], signal });
}

describe("default query loader abort signal", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refreshSession.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes the query signal to the initial GET", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { a: 1 }));
    const controller = new AbortController();
    await expect(run(controller.signal)).resolves.toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it("passes the same signal to the retry after a session refresh", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: "expired" }))
      .mockResolvedValueOnce(jsonResponse(200, { a: 2 }));
    refreshSession.mockResolvedValue(true);
    const controller = new AbortController();
    await expect(run(controller.signal)).resolves.toEqual({ a: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    expect(fetchMock.mock.calls[1][1].signal).toBe(controller.signal);
  });

  it("does not retry when the query is cancelled while the session refreshes", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: "expired" }));
    refreshSession.mockImplementation(async () => {
      controller.abort();
      return true;
    });
    await expect(run(controller.signal)).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts the in-flight request when React Query cancels the query, leaving the cache untouched", async () => {
    let seen: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          seen = init.signal as AbortSignal;
          seen.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );
    const client = new QueryClient({
      defaultOptions: { queries: { queryFn: getQueryFn({ on401: "throw" }), retry: false } },
    });
    client.setQueryData(["/api/slow"], { cached: true });
    const pending = client.fetchQuery({ queryKey: ["/api/slow"], staleTime: 0 });
    const settled = pending.catch(() => "cancelled");
    await vi.waitFor(() => expect(seen).toBeDefined());
    await client.cancelQueries({ queryKey: ["/api/slow"] });
    await settled;
    expect(seen?.aborted).toBe(true);
    expect(client.getQueryData(["/api/slow"])).toEqual({ cached: true });
  });
});
