/**
 * The shared query function hands TanStack's AbortSignal to every request it makes, so a
 * cancelled query (a cache write, an unmount) stops its fetch, including the retry after a 401
 * session refresh. Callers that pass no signal, and the pre-started boot fetch, behave as before.
 */
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshSession = vi.hoisted(() => vi.fn());
vi.mock("../../client/src/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../client/src/lib/auth")>()),
  refreshSession,
}));

import { getQueryFn } from "../../client/src/lib/queryClient";
import { startBootFetch } from "../../client/src/lib/bootFetch";

const KEY = ["/api/companies", "c-1", "vat-returns"];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** A fetch that never answers, and rejects like the browser does once its signal aborts. */
const hangingFetch = () =>
  vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError"))
        );
      })
  );

beforeEach(() => {
  refreshSession.mockReset();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => "1"),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("getQueryFn signal forwarding", () => {
  it("passes the signal to the request", async () => {
    const fetchMock = vi.fn(async () => json([{ id: "r1" }]));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    const run = getQueryFn<unknown>({ on401: "throw" });

    await expect(run({ queryKey: KEY, signal } as never)).resolves.toEqual([{ id: "r1" }]);
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({
      credentials: "include",
      signal,
    });
  });

  it("passes the same signal to the retry after a 401 session refresh", async () => {
    refreshSession.mockResolvedValue(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ message: "expired" }, 401))
      .mockResolvedValueOnce(json([{ id: "r1" }]));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(
      getQueryFn<unknown>({ on401: "throw" })({ queryKey: KEY, signal } as never)
    ).resolves.toEqual([{ id: "r1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ signal });
    expect((fetchMock.mock.calls[1] as unknown[])[1]).toMatchObject({ signal });
  });

  it("still works for a caller that passes no signal", async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      getQueryFn<unknown>({ on401: "throw" })({ queryKey: KEY } as never)
    ).resolves.toEqual({ ok: true });
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ credentials: "include" });
  });

  it("takes over a pre-started boot response instead of fetching again", async () => {
    const fetchMock = vi.fn(async () => json([{ id: "boot" }]));
    vi.stubGlobal("fetch", fetchMock);
    startBootFetch(["/api/companies"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const result = await getQueryFn<unknown>({ on401: "throw" })({
      queryKey: ["/api/companies"],
      signal: new AbortController().signal,
    } as never);
    expect(result).toEqual([{ id: "boot" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("a query using the shared loader", () => {
  const client = () =>
    new QueryClient({
      defaultOptions: { queries: { queryFn: getQueryFn({ on401: "throw" }), retry: false } },
    });

  it("aborts its in-flight request when cancelled, and a retry fetches again", async () => {
    const hanging = hangingFetch();
    vi.stubGlobal("fetch", hanging);
    const qc = client();

    const first = qc.fetchQuery({ queryKey: KEY });
    await vi.waitFor(() => expect(hanging).toHaveBeenCalledTimes(1));
    const signal = (hanging.mock.calls[0][1] as RequestInit).signal!;
    expect(signal.aborted).toBe(false);

    await qc.cancelQueries({ queryKey: KEY });
    expect(signal.aborted).toBe(true);
    await first.catch(() => undefined);

    const fetchMock = vi.fn(async () => json([{ id: "r1" }]));
    vi.stubGlobal("fetch", fetchMock);
    await expect(qc.fetchQuery({ queryKey: KEY })).resolves.toEqual([{ id: "r1" }]);
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ credentials: "include" });
  });

  it("aborts the retry attempt after a 401 refresh when cancelled", async () => {
    refreshSession.mockResolvedValue(true);
    const retryCall = hangingFetch();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ message: "expired" }, 401))
      .mockImplementationOnce(retryCall);
    vi.stubGlobal("fetch", fetchMock);
    const qc = client();

    const pending = qc.fetchQuery({ queryKey: KEY });
    await vi.waitFor(() => expect(retryCall).toHaveBeenCalledTimes(1));
    const signal = (retryCall.mock.calls[0][1] as RequestInit).signal!;
    expect(signal.aborted).toBe(false);

    await qc.cancelQueries({ queryKey: KEY });
    expect(signal.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});
