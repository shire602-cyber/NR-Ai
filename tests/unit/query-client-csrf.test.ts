import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../client/src/lib/queryClient";
import { clearCsrfToken } from "../../client/src/lib/csrf";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

describe("apiRequest CSRF recovery", () => {
  beforeEach(() => {
    clearCsrfToken();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  it("refetches the CSRF token and replays one failed mutation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "stale-token" }))
      .mockResolvedValueOnce(
        jsonResponse(
          { code: "CSRF_INVALID", message: "Invalid or missing CSRF token" },
          { status: 403 }
        )
      )
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "fresh-token" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await apiRequest("PATCH", "/api/companies/company-1", { name: "Najma" });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const firstMutation = fetchMock.mock.calls[1][1] as RequestInit;
    expect(firstMutation.credentials).toBe("include");
    expect((firstMutation.headers as Record<string, string>)["x-csrf-token"]).toBe("stale-token");

    const retryMutation = fetchMock.mock.calls[3][1] as RequestInit;
    expect(retryMutation.credentials).toBe("include");
    expect((retryMutation.headers as Record<string, string>)["x-csrf-token"]).toBe("fresh-token");
  });

  it("PR129: aborting the caller's signal aborts the in-flight fetch", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const request = apiRequest("GET", "/api/slow", undefined, undefined, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("PR129: the session-refresh retry carries the same signal", async () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => "1"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "token" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const { signal } = new AbortController();

    await expect(apiRequest("GET", "/api/slow", undefined, undefined, { signal })).resolves.toEqual(
      []
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(signal);
    expect((fetchMock.mock.calls[3][1] as RequestInit).signal).toBe(signal);
  });

  it("PR129: the CSRF retry carries the same signal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "stale-token" }))
      .mockResolvedValueOnce(jsonResponse({ code: "CSRF_INVALID" }, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "fresh-token" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { signal } = new AbortController();

    await apiRequest("POST", "/api/things", {}, undefined, { signal });

    expect((fetchMock.mock.calls[1][1] as RequestInit).signal).toBe(signal);
    expect((fetchMock.mock.calls[3][1] as RequestInit).signal).toBe(signal);
  });

  it("returns null for successful empty responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "token" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("DELETE", "/api/backups/backup-1")).resolves.toBeNull();
  });
});
