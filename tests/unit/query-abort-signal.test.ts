// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getQueryFn } from "../../client/src/lib/queryClient";

const auth = vi.hoisted(() => ({ refreshSession: vi.fn<() => Promise<boolean>>() }));

vi.mock("../../client/src/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../client/src/lib/auth")>()),
  getAuthHeaders: () => ({}),
  hasAuthHint: () => true,
  refreshSession: auth.refreshSession,
}));

const queryKey = ["/api/companies", "c1", "reconciliation-rules"];

/** A request that stays open until its signal aborts it. */
const hang = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError"))
    );
  });
const unauthorized = async () => new Response("{}", { status: 401 });

describe("default query function cancellation", () => {
  let client: QueryClient;
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  const signalOf = (call: number) => fetchMock.mock.calls[call][1]?.signal;
  const start = () =>
    client.fetchQuery({ queryKey, queryFn: getQueryFn({ on401: "throw" }), retry: false });

  beforeEach(() => {
    client = new QueryClient();
    fetchMock.mockReset();
    auth.refreshSession.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    client.clear();
    vi.unstubAllGlobals();
  });

  it("aborts the first request", async () => {
    fetchMock.mockImplementation(hang);
    const settled = expect(start()).rejects.toBeDefined();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(signalOf(0)?.aborted).toBe(false);

    await client.cancelQueries({ queryKey });
    await settled;
    expect(signalOf(0)?.aborted).toBe(true);
  });

  it("aborts the replay sent after a session refresh", async () => {
    auth.refreshSession.mockResolvedValue(true);
    fetchMock.mockImplementationOnce(unauthorized).mockImplementation(hang);
    const settled = expect(start()).rejects.toBeDefined();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(signalOf(1)).toBe(signalOf(0));
    expect(signalOf(1)?.aborted).toBe(false);

    await client.cancelQueries({ queryKey });
    await settled;
    expect(signalOf(1)?.aborted).toBe(true);
  });

  it("does not launch the replay when cancelled during the session refresh", async () => {
    let finishRefresh!: (ok: boolean) => void;
    auth.refreshSession.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishRefresh = resolve;
      })
    );
    fetchMock.mockImplementation(unauthorized);
    const settled = expect(start()).rejects.toBeDefined();
    await vi.waitFor(() => expect(auth.refreshSession).toHaveBeenCalledTimes(1));

    await client.cancelQueries({ queryKey });
    await settled;
    finishRefresh(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
