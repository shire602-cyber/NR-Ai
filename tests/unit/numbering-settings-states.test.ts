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
] as const;

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
  let mode: "error" | "empty";
  beforeAll(async () => {
    const { loadLocale } = await import("../../client/src/lib/i18n");
    await loadLocale("en");
  });
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mode === "error"
          ? new Response(JSON.stringify({ message: "boom" }), {
              status: 500,
              headers: { "content-type": "application/json" },
            })
          : new Response(JSON.stringify({ numbering: [] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
      )
    );
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function mount() {
    const { queryClient, getQueryFn } = await import("../../client/src/lib/queryClient");
    const { default: Page } = await import("../../client/src/pages/settings/Numbering");
    queryClient.clear();
    queryClient.setDefaultOptions({
      queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) },
    });
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Page)));
    });
    for (let i = 0; i < 8; i++)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
  }

  it("shows a retryable error when loading fails", async () => {
    mode = "error";
    await mount();
    const err = container.querySelector('[data-testid="numbering-load-error"]');
    expect(err?.textContent).toContain(en["settingsPages.numberingLoadFailed"]);
    expect(err?.querySelector("button")).not.toBeNull();
  });

  it("shows an empty state when no series come back", async () => {
    mode = "empty";
    await mount();
    expect(container.querySelector('[data-testid="numbering-empty"]')).not.toBeNull();
  });
});
