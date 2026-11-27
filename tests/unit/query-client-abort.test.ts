// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAuthHint } from "../../client/src/lib/authHint";
import { getQueryFn } from "../../client/src/lib/queryClient";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const queryFn = getQueryFn<unknown>({ on401: "returnNull" });
const run = (signal: AbortSignal) =>
  Promise.resolve(queryFn({ queryKey: ["/api/things"], signal } as never));

describe("default query function abort handling", () => {
  beforeEach(() => setAuthHint());
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("passes the query signal to the request and to the retry after a refresh", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "t" });
      if (url.includes("/api/auth/refresh")) {
        expect(init?.signal).toBeUndefined();
        return json({});
      }
      signals.push(init?.signal);
      return signals.length === 1 ? json({}, 401) : json({ ok: true });
    });
    const { signal } = new AbortController();

    await expect(run(signal)).resolves.toEqual({ ok: true });
    expect(signals).toEqual([signal, signal]);
  });

  it("lets other callers finish the shared refresh when one caller aborts", async () => {
    let finishRefresh!: () => void;
    const refresh = new Promise<Response>((resolve) => {
      finishRefresh = () => resolve(json({}));
    });
    let refreshes = 0;
    let refreshed = false;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "t" });
      if (url.includes("/api/auth/refresh")) {
        refreshes += 1;
        const res = await refresh;
        refreshed = true;
        return res;
      }
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return refreshed ? json({ ok: true }) : json({}, 401);
    });
    const leaving = new AbortController();
    const first = run(leaving.signal);
    const second = run(new AbortController().signal);
    const firstRejects = expect(first).rejects.toMatchObject({ name: "AbortError" });

    await vi.waitFor(() => expect(refreshes).toBe(1));
    leaving.abort();
    finishRefresh();

    await firstRejects;
    await expect(second).resolves.toEqual({ ok: true });
    expect(refreshes).toBe(1);
  });
});
