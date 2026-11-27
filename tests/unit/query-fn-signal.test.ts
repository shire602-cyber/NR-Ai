import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshSession = vi.fn();
const takeBootFetch = vi.fn();

vi.mock("../../client/src/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../client/src/lib/auth")>()),
  getAuthHeaders: () => ({}),
  hasAuthHint: () => true,
  refreshSession: (...args: unknown[]) => refreshSession(...args),
}));
vi.mock("../../client/src/lib/bootFetch", () => ({
  takeBootFetch: (...args: unknown[]) => takeBootFetch(...args),
}));

import { getQueryFn } from "../../client/src/lib/queryClient";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A fetch that never settles on its own and rejects when its signal aborts (or already has). */
function hangingFetch(_url: unknown, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    if (init?.signal?.aborted) return abort();
    init?.signal?.addEventListener("abort", abort);
  });
}

describe("getQueryFn forwards the query signal", () => {
  beforeEach(() => {
    refreshSession.mockReset();
    takeBootFetch.mockReset();
    takeBootFetch.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes the same signal to the initial fetch and the 401 retry, and the refresh stays independent", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ message: "expired" }, 401))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    refreshSession.mockResolvedValue(true);

    const result = await getQueryFn({ on401: "throw" })({
      queryKey: ["/api/things"],
      signal: controller.signal,
    } as never);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal);
    expect((fetchMock.mock.calls[1][1] as RequestInit).signal).toBe(controller.signal);
    // The shared session refresh takes no per-query signal.
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(refreshSession.mock.calls[0]).toEqual([]);
  });

  it("cancelling the query aborts the initial request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(hangingFetch);
    vi.stubGlobal("fetch", fetchMock);
    const pending = getQueryFn({ on401: "throw" })({
      queryKey: ["/api/things"],
      signal: controller.signal,
    } as never);
    // Wait until the request has actually started (the boot-fetch lookup is async).
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancelling during the post-refresh retry aborts that request", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ message: "expired" }, 401))
      .mockImplementationOnce(hangingFetch);
    vi.stubGlobal("fetch", fetchMock);
    refreshSession.mockResolvedValue(true);

    const pending = getQueryFn({ on401: "throw" })({
      queryKey: ["/api/things"],
      signal: controller.signal,
    } as never);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("still adopts a boot-fetched response without a new request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    takeBootFetch.mockResolvedValue(json({ adopted: true }));

    const result = await getQueryFn({ on401: "throw" })({
      queryKey: ["/api/companies"],
      signal: new AbortController().signal,
    } as never);

    expect(result).toEqual({ adopted: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
