import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiRequestNotSentError, apiRequest } from "../../client/src/lib/queryClient";
import { clearCsrfToken } from "../../client/src/lib/csrf";
import { useI18n } from "../../client/src/lib/i18n";
import offlineAr from "../../client/src/locales/offline/ar.json";
import offlineEn from "../../client/src/locales/offline/en.json";

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

describe("apiRequest offline write refusal", () => {
  afterEach(() => {
    useI18n.setState({ locale: "en" });
    vi.unstubAllGlobals();
  });

  it.each([
    ["en", offlineEn],
    ["ar", offlineAr],
  ] as const)("refuses in the active locale (%s) without sending", async (locale, catalog) => {
    useI18n.setState({ locale });
    clearCsrfToken();
    // The shared path prepares headers (a CSRF token fetch) before its own offline check.
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ csrfToken: "token" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: false });
    const message = catalog["offline.writeNotSent"];

    const shared = await apiRequest("POST", "/api/things", {}).catch((e: unknown) => e);
    expect(shared).toBeInstanceOf(ApiError);
    expect(shared).toMatchObject({ message, status: 0 });

    const immediate = await apiRequest("POST", "/api/things", {}, undefined, {
      queueWhenOffline: false,
    }).catch((e: unknown) => e);
    expect(immediate).toBeInstanceOf(ApiRequestNotSentError);
    expect(immediate).toMatchObject({ message, status: 0 });

    const writes = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/things"));
    expect(writes).toHaveLength(0);
  });

  it("has distinct English and Arabic copy", () => {
    expect(offlineEn["offline.writeNotSent"]).toContain("was not sent");
    expect(offlineAr["offline.writeNotSent"]).toMatch(/[؀-ۿ]/);
  });
});
