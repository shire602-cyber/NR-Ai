// @vitest-environment jsdom
/** Tax rates settings: empty state, unknown treatment label, retryable load error, no company. */
import { createElement as h, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const company = vi.hoisted(() => ({
  value: { companyId: "c1" as string | undefined, isLoading: false, hasNoCompanies: false },
}));
vi.mock("@/hooks/useDefaultCompany", () => ({ useDefaultCompany: () => company.value }));
vi.mock("@/components/layout/SettingsLayout", () => ({
  SettingsLayout: ({ children }: { children: ReactNode }) => h("div", null, children),
}));

let container: HTMLDivElement;
let root: Root;
beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});
beforeEach(() => {
  company.value = { companyId: "c1", isLoading: false, hasNoCompanies: false };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderPage(queryFn: () => Promise<unknown>) {
  const { default: TaxRates } = await import("../../client/src/pages/settings/TaxRates");
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: queryFn as never } },
  });
  await act(async () => {
    root.render(h(QueryClientProvider, { client: qc }, h(TaxRates)));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe("tax rates ux", () => {
  it("shows an empty state when the engine returns no rows", async () => {
    const { TaxRatesView } = await import("../../client/src/pages/settings/TaxRates");
    await act(async () => {
      root.render(h(TaxRatesView, { data: { standardRate: 0.05, emirate: null, rows: [] } }));
    });
    expect(container.querySelector('[data-testid="tax-rates-empty"]')).not.toBeNull();
    expect(container.querySelector("table")).toBeNull();
  });

  it("does not show a raw treatment key for an unknown treatment", async () => {
    const { TaxRatesView } = await import("../../client/src/pages/settings/TaxRates");
    await act(async () => {
      root.render(
        h(TaxRatesView, {
          data: {
            standardRate: 0.05,
            emirate: "dubai",
            rows: [{ side: "sales", treatment: "weird_new_kind", rate: 0.05, boxes: [] }],
          },
        })
      );
    });
    const row = container.querySelector('[data-testid="tax-rate-sales-weird_new_kind"]')!;
    expect(row.textContent).not.toContain("weird_new_kind");
    expect(row.textContent).toContain("Other treatment");
  });

  it("offers Retry when the load fails with a server error", async () => {
    await renderPage(() => Promise.reject(new Error("500: boom")));
    expect(container.querySelector('[data-testid="tax-rates-load-error"]')).not.toBeNull();
    expect(container.textContent).not.toContain("boom");
    expect(container.textContent).toContain("Try again");
  });

  it("shows a no-company state instead of a load error", async () => {
    company.value = { companyId: undefined, isLoading: false, hasNoCompanies: true };
    await renderPage(() => Promise.resolve(null));
    expect(container.querySelector('[data-testid="tax-rates-no-company"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows the skeleton, not an error, while the company is still resolving", async () => {
    company.value = { companyId: undefined, isLoading: true, hasNoCompanies: false };
    await renderPage(() => Promise.resolve(null));
    expect(container.querySelector('[data-testid="tax-rates-load-error"]')).toBeNull();
    expect(container.querySelector('[data-testid="tax-rates-no-company"]')).toBeNull();
  });
});
