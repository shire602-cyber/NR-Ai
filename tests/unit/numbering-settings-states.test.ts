// @vitest-environment jsdom
/** Settings › Numbering: load error with retry, empty state, loading status, Arabic copy. */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../client/src/locales/en/settingsPages.json";
import ar from "../../client/src/locales/ar/settingsPages.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c1" }),
}));
vi.mock("../../client/src/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ can: () => true }),
}));
vi.mock("../../client/src/components/layout/SettingsLayout", () => ({
  SettingsLayout: ({ children }: { children: unknown }) => children,
}));

const keys = [
  "numberingLoadFailed",
  "numberingRetry",
  "numberingEmpty",
  "numberingSaveFailed",
  "numberingWaiting",
  "numberingRefreshFailed",
  "numberingSaveWaiting",
] as const;

const KEY = ["/api/companies", "c1", "numbering"];
const ROW = {
  docType: "invoice",
  prefix: "INV",
  padding: 4,
  yearlyReset: false,
  nextNumber: 5,
  nextFormatted: "INV-0005",
  lastIssued: 4,
};

describe("numbering catalogs", () => {
  it.each(keys)("has English and Arabic copy for %s", (k) => {
    const key = `settingsPages.${k}` as keyof typeof en;
    expect(en[key]).toBeTruthy();
    expect(ar[key]).toMatch(/[؀-ۿ]/);
  });
});

describe("Numbering page states", () => {
  let container: HTMLDivElement;
  let root: Root;
  let mode: "error" | "empty" | "rows";
  let fetchMock: ReturnType<typeof vi.fn>;
  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  beforeAll(async () => {
    const { loadLocale } = await import("../../client/src/lib/i18n");
    await loadLocale("en");
  });
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input).includes("/api/csrf-token")) return jsonResponse({ csrfToken: "tok" });
      if (init?.method === "PUT") return jsonResponse({ ok: true });
      if (mode === "error") return jsonResponse({ message: "boom" }, 500);
      return jsonResponse({ numbering: mode === "rows" ? [ROW] : [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });
  afterEach(async () => {
    const { onlineManager } = await import("@tanstack/react-query");
    onlineManager.setOnline(true);
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  async function settle() {
    for (let i = 0; i < 8; i++)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
  }

  async function mount(seed?: unknown) {
    const { queryClient, getQueryFn } = await import("../../client/src/lib/queryClient");
    const { default: Page } = await import("../../client/src/pages/settings/Numbering");
    queryClient.clear();
    queryClient.setDefaultOptions({
      queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) },
    });
    if (seed !== undefined) queryClient.setQueryData(KEY, seed);
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Page)));
    });
    await settle();
  }

  const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`);
  async function clickSave() {
    await act(async () => {
      (byTestId("numbering-save-invoice") as HTMLButtonElement).click();
    });
    await settle();
  }

  it("shows a retryable error when loading fails", async () => {
    mode = "error";
    await mount();
    const err = container.querySelector('[data-testid="numbering-load-error"]');
    expect(err?.textContent).toContain(en["settingsPages.numberingLoadFailed"]);
    const retry = err?.querySelector("button") as HTMLButtonElement | null;
    expect(retry).not.toBeNull();

    mode = "rows";
    await act(async () => {
      retry!.click();
    });
    await settle();
    expect(byTestId("numbering-invoice")).not.toBeNull();
    expect(byTestId("numbering-load-error")).toBeNull();
  });

  it("shows waiting, not empty, for a paused refresh with a cached empty response", async () => {
    const { onlineManager } = await import("@tanstack/react-query");
    onlineManager.setOnline(false);
    mode = "empty";
    await mount({ numbering: [] });
    expect(byTestId("numbering-waiting")?.getAttribute("role")).toBe("status");
    expect(byTestId("numbering-empty")).toBeNull();

    onlineManager.setOnline(true);
    await settle();
    expect(byTestId("numbering-empty")).not.toBeNull();
    expect(byTestId("numbering-waiting")).toBeNull();
  });

  it("shows an empty state when no series come back", async () => {
    mode = "empty";
    await mount();
    expect(container.querySelector('[data-testid="numbering-empty"]')).not.toBeNull();
  });

  it("shows a neutral waiting status for a paused first load, then loads on reconnect", async () => {
    const { onlineManager } = await import("@tanstack/react-query");
    mode = "rows";
    onlineManager.setOnline(false);
    await mount();
    const waiting = byTestId("numbering-waiting");
    expect(waiting?.getAttribute("role")).toBe("status");
    expect(waiting?.textContent).toBe(en["settingsPages.numberingWaiting"]);
    expect(byTestId("numbering-empty")).toBeNull();
    expect(byTestId("numbering-load-error")).toBeNull();

    onlineManager.setOnline(true);
    await settle();
    expect(byTestId("numbering-invoice")).not.toBeNull();
    expect(byTestId("numbering-waiting")).toBeNull();
  });

  it("keeps cached cards and shows a distinct error when a refresh fails", async () => {
    mode = "error";
    await mount({ numbering: [ROW] });
    const alert = byTestId("numbering-refresh-error");
    expect(alert?.textContent).toContain(en["settingsPages.numberingRefreshFailed"]);
    expect(alert?.textContent).toContain(en["settingsPages.numberingRetry"]);
    expect(byTestId("numbering-load-error")).toBeNull();
    expect(byTestId("numbering-invoice")).not.toBeNull();
  });

  it("hides the refresh error while a paused refresh is waiting", async () => {
    const { onlineManager } = await import("@tanstack/react-query");
    mode = "error";
    await mount({ numbering: [ROW] });
    expect(byTestId("numbering-refresh-error")).not.toBeNull();

    onlineManager.setOnline(false);
    const { queryClient } = await import("../../client/src/lib/queryClient");
    await act(async () => {
      void queryClient.refetchQueries({ queryKey: KEY });
    });
    await settle();
    expect(byTestId("numbering-waiting")).not.toBeNull();
    expect(byTestId("numbering-refresh-error")).toBeNull();
    expect(byTestId("numbering-invoice")).not.toBeNull();
  });

  describe("offline save", () => {
    const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");

    /** React tracks the input value, so set it through the native setter before the event. */
    async function type(testId: string, value: string) {
      const input = byTestId(testId) as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      await act(async () => {
        setValue.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await settle();
    }

    it("never claims a queued save when offline is discovered after the save starts", async () => {
      mode = "rows";
      await mount();
      const postMessage = vi.fn();
      // TanStack still says online, so the mutation runs; only the browser knows it is offline.
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: { controller: { postMessage } },
      });
      await clickSave();

      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        en["settingsPages.numberingSaveFailed"]
      );
      expect(byTestId("numbering-save-waiting-invoice")).toBeNull();
      expect(postMessage).not.toHaveBeenCalled();
      expect(puts()).toHaveLength(0);
    });

    it("pauses the save while offline and sends exactly what was submitted on reconnect", async () => {
      const { onlineManager } = await import("@tanstack/react-query");
      mode = "rows";
      await mount();
      await type("numbering-prefix-invoice", "ABC");
      await type("numbering-next-invoice", "9");
      await act(async () => onlineManager.setOnline(false));
      await clickSave();

      const expectWaiting = () => {
        const waiting = byTestId("numbering-save-waiting-invoice");
        expect(waiting?.getAttribute("role")).toBe("status");
        expect(waiting?.textContent).toBe(en["settingsPages.numberingSaveWaiting"]);
        expect((byTestId("numbering-save-invoice") as HTMLButtonElement).disabled).toBe(true);
        expect(puts()).toHaveLength(0);
      };
      expectWaiting();

      // The form stays editable; the edit renders before reconnect and must not change the save.
      const prefix = byTestId("numbering-prefix-invoice") as HTMLInputElement;
      expect(prefix.disabled).toBe(false);
      await type("numbering-prefix-invoice", "XYZ");
      await type("numbering-next-invoice", "20");
      expect(prefix.value).toBe("XYZ");
      expectWaiting();

      await act(async () => onlineManager.setOnline(true));
      await settle();
      expect(puts()).toHaveLength(1);
      expect(String(puts()[0][0])).toMatch(/\/api\/companies\/c1\/numbering\/invoice$/);
      expect(JSON.parse(String((puts()[0][1] as RequestInit).body))).toEqual({
        prefix: "ABC",
        padding: 4,
        yearlyReset: false,
        nextNumber: 9,
      });
      expect(byTestId("numbering-save-waiting-invoice")).toBeNull();
    });
  });
});
