// @vitest-environment jsdom
/**
 * Chart of accounts screen states: a failed load must say so (not "No accounts yet"), and the
 * Arabic screen must not carry hardcoded English (page eyebrow).
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
}

describe("chart of accounts states", { timeout: 30000 }, () => {
  it("shows a load error with retry, not the empty state, when the request fails", async () => {
    await renderPage("en", () => Promise.reject(new Error("boom")));
    expect(container.querySelector('[data-testid="coa-load-error"]')).not.toBeNull();
    expect(container.textContent).not.toContain("No accounts yet");
  });

  it("shows the empty state when the company has no accounts", async () => {
    await renderPage("en", () => Promise.resolve([]));
    expect(container.querySelector('[data-testid="coa-load-error"]')).toBeNull();
    expect(container.textContent).toContain("No accounts yet");
  });

  it("renders the page eyebrow in Arabic", async () => {
    await renderPage("ar", () => Promise.resolve([]));
    expect(container.textContent).toContain("المحاسبة");
    expect(container.textContent).not.toContain("Accounting");
  });
});
