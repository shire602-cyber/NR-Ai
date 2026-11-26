// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "co-1" }),
}));
vi.mock("../../client/src/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ gate: () => ({}) }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const cashAccount = {
  account: {
    id: "cash",
    code: "1000",
    name: "Cash on hand",
    nameEn: "Cash on hand",
    nameAr: "النقدية",
    type: "asset",
    parentId: null,
    isActive: true,
  },
  balance: 0,
  debitTotal: 0,
  creditTotal: 0,
};

beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined))
  );
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  onlineManager.setOnline(true);
});

async function renderPage(locale: "en" | "ar", queryFn: () => Promise<unknown>) {
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale(locale));
  const { default: ChartOfAccounts } = await import("../../client/src/pages/ChartOfAccounts");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn } },
  });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(ChartOfAccounts)));
  });
  // Wait for the query to settle (the first import of the page can be slow on a cold cache).
  for (let i = 0; i < 100 && !container.querySelector("[data-testid='button-add-account']"); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  return client;
}

/** Refetch and wait until the cache records the failure and observers have been notified. */
async function failRefetch(client: QueryClient) {
  const queryKey = ["/api/companies", "co-1", "accounts-with-balances"];
  await act(async () => {
    await client.refetchQueries({ queryKey });
    await vi.waitFor(() => expect(client.getQueryState(queryKey)?.status).toBe("error"));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("chart of accounts states", { timeout: 30000 }, () => {
  it("pauses an offline retry without showing the empty state and recovers on reconnect", async () => {
    const queryFn = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([cashAccount]);
    await renderPage("en", queryFn);

    const retry = container.querySelector<HTMLButtonElement>(
      '[data-testid="coa-load-error"] button'
    );
    expect(retry?.textContent).toContain("Retry");
    expect(container.textContent).not.toContain("No accounts yet");

    await act(async () => {
      onlineManager.setOnline(false);
      retry!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("No accounts yet");
    expect(container.querySelector('[data-testid="table-skeleton"]')).not.toBeNull();

    await act(async () => {
      onlineManager.setOnline(true);
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="coa-load-error"]')).toBeNull();
    expect(container.querySelector('[data-testid="row-account-cash"]')?.textContent).toContain(
      cashAccount.account.nameEn
    );
  });

  it("shows the empty state when the company has no accounts", async () => {
    await renderPage("en", () => Promise.resolve([]));
    expect(container.querySelector('[data-testid="coa-load-error"]')).toBeNull();
    expect(container.textContent).toContain("No accounts yet");
  });

  it("keeps the empty state when a refetch fails after an empty response", async () => {
    const queryFn = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("boom"));
    const client = await renderPage("en", queryFn);
    await failRefetch(client);

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="coa-load-error"]')).toBeNull();
    expect(container.textContent).toContain("No accounts yet");
  });

  it("keeps the no-results state when a refetch fails with cached accounts filtered out", async () => {
    const queryFn = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce([cashAccount])
      .mockRejectedValueOnce(new Error("boom"));
    const client = await renderPage("en", queryFn);

    const search = container.querySelector<HTMLInputElement>(
      '[data-testid="input-search-accounts"]'
    )!;
    act(() => {
      // React tracks the input value, so set it through the native setter before the event.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        "no-such-account"
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("No results found");

    await failRefetch(client);

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="coa-load-error"]')).toBeNull();
    expect(container.textContent).toContain("No results found");
  });

  it("renders the page eyebrow in Arabic", async () => {
    await renderPage("ar", () => Promise.resolve([]));
    expect(container.textContent).toContain("المحاسبة");
    expect(container.textContent).not.toContain("Accounting");
  });

  it("uses the Arabic name of a bilingual account in the set-parent dialog", async () => {
    await renderPage("ar", () => Promise.resolve([cashAccount]));

    const setParent = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-set-parent-cash"]'
    );
    act(() => setParent!.click());

    const dialog = document.body.querySelector('[data-testid="dialog-set-parent"]');
    expect(dialog?.textContent).toContain(`1000 · ${cashAccount.account.nameAr}`);
  });
});
