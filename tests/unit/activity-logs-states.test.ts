// @vitest-environment jsdom
/**
 * PR 154 review: the Activity logs screen must never report "no logs" for data it has not loaded.
 * Drives the real page with a real React Query client and the app's query function.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOGS_KEY = ["/api/admin/activity-logs"];
const LOG = {
  id: "l1",
  userId: null,
  companyId: null,
  action: "invoice.create",
  entityType: "invoice",
  entityId: null,
  description: "Invoice INV-2026-00001 created",
  createdAt: "2026-11-18T08:00:00Z",
  metadata: null,
};

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let en: Record<string, string>;
let ar: Record<string, string>;
/** What the activity-log endpoint answers next. */
let server: { status: number; rows: unknown[] };
let logRequests: number;
let exportRequests: number;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  const i18n = await import("../../client/src/lib/i18n");
  await Promise.all([i18n.loadLocale("en"), i18n.loadLocale("ar")]);
  en = i18n.t.en as Record<string, string>;
  ar = i18n.t.ar as Record<string, string>;
});

beforeEach(async () => {
  server = { status: 200, rows: [LOG] };
  logRequests = 0;
  exportRequests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      if (url.includes("/api/export/excel")) {
        exportRequests += 1;
        return json({});
      }
      if (url.includes("/api/admin/activity-logs")) {
        logRequests += 1;
        return server.status === 200 ? json(server.rows) : json({ message: "boom" }, server.status);
      }
      return json([]);
    })
  );
  URL.createObjectURL = () => "blob:x";
  URL.revokeObjectURL = () => {};
  const { getQueryFn } = await import("../../client/src/lib/queryClient");
  client = new QueryClient({
    defaultOptions: { queries: { queryFn: getQueryFn({ on401: "throw" }), retry: false } },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  client.clear();
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.getState().setLocale("en");
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount() {
  const { default: ActivityLogs } = await import("../../client/src/pages/ActivityLogs");
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(ActivityLogs)));
  });
  await flush();
}

const byId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const exportButton = () => byId("button-export-logs") as HTMLButtonElement;

async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
  await flush();
}

async function setOnline(online: boolean) {
  await act(async () => onlineManager.setOnline(online));
  await flush();
}

async function refresh() {
  await act(async () => {
    void client.refetchQueries({ queryKey: LOGS_KEY });
  });
  await flush();
}

async function search(value: string) {
  const input = byId("input-search-logs") as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

function expectNoEmptyClaim() {
  expect(byId("empty-state")).toBeNull();
  expect(byId("badge-log-count")).toBeNull();
}

describe("Activity logs load states", () => {
  it.each(["en", "ar"] as const)(
    "shows a paused status on a cold offline load, then the rows on reconnect (%s)",
    async (locale) => {
      const { useI18n } = await import("../../client/src/lib/i18n");
      await act(async () => useI18n.getState().setLocale(locale));
      onlineManager.setOnline(false);
      await mount();

      const status = byId("status-activity-logs-paused")!;
      expect(status.getAttribute("role")).toBe("status");
      expect(status.textContent).toBe((locale === "ar" ? ar : en)["activityLogs.loadPaused"]);
      expectNoEmptyClaim();
      expect(byId("state-activity-logs-error")).toBeNull();
      expect(exportButton().disabled).toBe(true);
      expect(logRequests).toBe(0);

      await setOnline(true);
      expect(byId("status-activity-logs-paused")).toBeNull();
      expect(byId("row-log-l1")).not.toBeNull();
    }
  );

  it("replaces the load error with the paused status when Retry is pressed offline", async () => {
    server.status = 500;
    await mount();
    const error = byId("state-activity-logs-error")!;
    expect(error.textContent).toContain(en["activityLogs.loadFailedTitle"]);
    expectNoEmptyClaim();

    await setOnline(false);
    await click(error.querySelector("button"));
    expect(byId("status-activity-logs-paused")).not.toBeNull();
    expect(byId("state-activity-logs-error")).toBeNull();
    expectNoEmptyClaim();

    server.status = 200;
    await setOnline(true);
    expect(byId("row-log-l1")).not.toBeNull();
  });

  it("keeps cached rows and Export after a failed refresh, with a warning and Retry", async () => {
    await mount();
    server.status = 500;
    await refresh();

    const warning = byId("state-activity-logs-refresh-error")!;
    expect(warning.querySelector('[role="alert"]')?.textContent).toBe(
      en["activityLogs.refreshFailed"]
    );
    expect(byId("state-activity-logs-error")).toBeNull();
    expect(byId("row-log-l1")).not.toBeNull();
    expect(exportButton().disabled).toBe(false);
    await click(exportButton());
    await vi.waitFor(() => expect(exportRequests).toBe(1));

    // Retry offline: the rows stay and the pause is announced.
    await setOnline(false);
    await click(byId("button-retry-refresh-logs"));
    const paused = byId("status-activity-logs-refresh-paused")!;
    expect(paused.getAttribute("role")).toBe("status");
    expect(paused.textContent).toBe(en["activityLogs.refreshPaused"]);
    expect(byId("row-log-l1")).not.toBeNull();
    expect(exportButton().disabled).toBe(false);

    server.status = 200;
    await setOnline(true);
    expect(byId("status-activity-logs-refresh-paused")).toBeNull();
    expect(byId("state-activity-logs-refresh-error")).toBeNull();
    expect(byId("row-log-l1")).not.toBeNull();
  });

  it("Retry on the refresh warning requests again and clears the warning", async () => {
    await mount();
    server.status = 500;
    await refresh();
    server.status = 200;
    const before = logRequests;
    await click(byId("button-retry-refresh-logs"));
    expect(logRequests).toBe(before + 1);
    expect(byId("state-activity-logs-refresh-error")).toBeNull();
  });

  it("reports a successful empty load, and keeps saying so when a refresh fails", async () => {
    server.rows = [];
    await mount();
    expect(byId("empty-state")?.textContent).toBe(en["activityLogs.noActivityLogsYet"]);
    expect(byId("badge-log-count")).not.toBeNull();
    expect(exportButton().disabled).toBe(true);

    server.status = 500;
    await refresh();
    expect(byId("empty-state")?.textContent).toBe(en["activityLogs.noActivityLogsYet"]);
    expect(byId("state-activity-logs-refresh-error")).not.toBeNull();
    expect(byId("state-activity-logs-error")).toBeNull();
  });

  it("aborts the pending log request when the screen is left", async () => {
    const answer = globalThis.fetch;
    let signal: AbortSignal | null | undefined;
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (!String(input).includes("/api/admin/activity-logs")) return answer(input, init);
        signal = init?.signal;
        // Never answers: only the abort can settle it, as with a real fetch.
        return new Promise<Response>((_, reject) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("The request was cancelled.", "AbortError"));
          });
        });
      })
    );
    await mount();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);

    await act(async () => root.unmount());
    await flush();
    expect(signal!.aborted).toBe(true);
    expect(aborted).toBe(true);
  });

  it("ignores surrounding and whitespace-only search text", async () => {
    await mount();
    await search("  INV-2026-00001  ");
    expect(byId("row-log-l1")).not.toBeNull();

    await search("   ");
    expect(byId("row-log-l1")).not.toBeNull();

    // A whitespace-only search is not an active filter, so an empty log is not "no matches".
    server.rows = [];
    await refresh();
    expect(byId("empty-state")?.textContent).toBe(en["activityLogs.noActivityLogsYet"]);

    await search("zzz");
    expect(byId("empty-state")?.textContent).toContain(en["activityLogs.noLogsMatchYourFilters"]);
  });

  // TanStack also pauses a failed request's retry while the tab is hidden, so "paused" does not
  // mean "offline". These tests stay online and only remove focus.
  describe("retry paused on an unfocused tab while online", () => {
    beforeEach(() => {
      client.setQueryDefaults(LOGS_KEY, { retry: 1, retryDelay: 0 });
    });

    it.each(["en", "ar"] as const)(
      "cold load: paused status without an offline claim, then rows on focus (%s)",
      async (locale) => {
        const { useI18n } = await import("../../client/src/lib/i18n");
        await act(async () => useI18n.getState().setLocale(locale));
        focusManager.setFocused(false);
        server.status = 500;
        await mount();

        expect(onlineManager.isOnline()).toBe(true);
        expect(focusManager.isFocused()).toBe(false);
        const status = byId("status-activity-logs-paused")!;
        expect(status.getAttribute("role")).toBe("status");
        expect(status.textContent).toBe((locale === "ar" ? ar : en)["activityLogs.loadPaused"]);
        expect(status.textContent).not.toMatch(/offline|غير متصل|عدم وجود اتصال/i);
        expectNoEmptyClaim();
        expect(byId("state-activity-logs-error")).toBeNull();
        expect(logRequests).toBe(1);

        server.status = 200;
        await act(async () => focusManager.setFocused(true));
        await flush();
        expect(logRequests).toBe(2);
        expect(byId("status-activity-logs-paused")).toBeNull();
        expect(byId("row-log-l1")).not.toBeNull();
      }
    );

    it.each(["en", "ar"] as const)(
      "cached refresh: keeps rows with a paused status, then resumes on focus (%s)",
      async (locale) => {
        const { useI18n } = await import("../../client/src/lib/i18n");
        await act(async () => useI18n.getState().setLocale(locale));
        await mount();
        expect(byId("row-log-l1")).not.toBeNull();

        focusManager.setFocused(false);
        server.status = 500;
        const before = logRequests;
        await refresh();

        expect(onlineManager.isOnline()).toBe(true);
        expect(logRequests).toBe(before + 1);
        const paused = byId("status-activity-logs-refresh-paused")!;
        expect(paused.getAttribute("role")).toBe("status");
        expect(paused.textContent).toBe((locale === "ar" ? ar : en)["activityLogs.refreshPaused"]);
        expect(paused.textContent).not.toMatch(/offline|غير متصل|عدم وجود اتصال/i);
        expect(byId("row-log-l1")).not.toBeNull();
        expect(byId("state-activity-logs-refresh-error")).toBeNull();
        expect(exportButton().disabled).toBe(false);

        server.status = 200;
        await act(async () => focusManager.setFocused(true));
        await flush();
        expect(logRequests).toBe(before + 2);
        expect(byId("status-activity-logs-refresh-paused")).toBeNull();
        expect(byId("state-activity-logs-refresh-error")).toBeNull();
        expect(byId("row-log-l1")).not.toBeNull();
      }
    );
  });
});
