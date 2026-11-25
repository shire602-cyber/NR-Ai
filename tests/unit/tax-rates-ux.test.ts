// @vitest-environment jsdom
/** Tax rates settings: empty state, unknown treatment label, load states, retry, pauses, no company. */
import { createElement as h, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/receipts/ReceiptQueueProvider", () => ({
  ReceiptQueueProvider: ({ children }: { children: ReactNode }) => children,
}));
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
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  onlineManager.setOnline(true);
  act(() => root.unmount());
  container.remove();
});

const COMPANIES = ["/api/companies"];
const RATES = ["/api/companies", "c1", "tax-rates"];
const ratesBody = {
  standardRate: 0.05,
  emirate: null,
  rows: [{ side: "sales", treatment: "standard", rate: 0.05, boxes: [] }],
};
const companyRow = { id: "c1", companyType: "owner" };
const serverError = () => Object.assign(new Error("boom"), { status: 500 });

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);
/** Poll until the assertion holds; each attempt flushes React inside act, asserts outside it. */
const settle = (assertion: () => void) =>
  vi.waitFor(async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    assertion();
  });

const newClient = (queryFn: (ctx: { queryKey: readonly unknown[] }) => Promise<unknown>) =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: queryFn as never } },
  });

/** The one render helper: the page under the real ActiveCompanyProvider. */
async function renderPage(qc: QueryClient) {
  const { default: TaxRates } = await import("../../client/src/pages/settings/TaxRates");
  const { ActiveCompanyProvider } =
    await import("../../client/src/components/ActiveCompanyProvider");
  await act(async () => {
    root.render(
      h(QueryClientProvider, { client: qc }, h(ActiveCompanyProvider, null, h(TaxRates)))
    );
  });
}

describe("tax rates view", () => {
  it("shows an empty state when the engine returns no rows", async () => {
    const { TaxRatesView } = await import("../../client/src/pages/settings/TaxRates");
    await act(async () => {
      root.render(h(TaxRatesView, { data: { standardRate: 0.05, emirate: null, rows: [] } }));
    });
    expect(q("tax-rates-empty")).not.toBeNull();
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
    const row = q("tax-rate-sales-weird_new_kind")!;
    expect(row.textContent).not.toContain("weird_new_kind");
    expect(row.textContent).toContain("Other treatment");
  });
});

describe("tax rates page load states", () => {
  it("offers Retry when the rates load fails with a server error", async () => {
    const qc = newClient(() => Promise.reject(serverError()));
    qc.setQueryData(COMPANIES, [companyRow]);
    await renderPage(qc);
    await settle(() => expect(q("tax-rates-load-error")).not.toBeNull());
    expect(container.textContent).not.toContain("boom");
    expect(container.textContent).toContain("Try again");
  });

  it("shows a no-company state, not a load error, when the company list is really empty", async () => {
    await renderPage(newClient(() => Promise.resolve([])));
    await settle(() => expect(q("tax-rates-no-company")).not.toBeNull());
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows the skeleton, not an error, while the company request is pending", async () => {
    await renderPage(newClient(() => new Promise(() => {})));
    expect(q("card-list-skeleton")).not.toBeNull();
    expect(q("tax-rates-load-error")).toBeNull();
    expect(q("tax-rates-no-company")).toBeNull();
    expect(q("tax-rates-waiting")).toBeNull();
    expect(q("tax-rates-empty")).toBeNull();
  });

  it("shows waiting while the first company load is paused offline, then no-company after reconnecting to an empty list", async () => {
    onlineManager.setOnline(false);
    const queryFn = vi.fn(() => Promise.resolve([]));
    await renderPage(newClient(queryFn));
    expect(queryFn).not.toHaveBeenCalled();
    expect(q("tax-rates-waiting")).not.toBeNull();
    expect(q("tax-rates-no-company")).toBeNull();
    expect(q("tax-rates-empty")).toBeNull();

    await act(async () => {
      onlineManager.setOnline(true);
    });
    await settle(() => expect(q("tax-rates-no-company")).not.toBeNull());
    expect(q("tax-rates-waiting")).toBeNull();
  });

  it("shows waiting, not empty, while the first rates load is paused offline", async () => {
    const qc = newClient(() => Promise.resolve(null));
    qc.setQueryData(COMPANIES, [companyRow]);
    onlineManager.setOnline(false);
    await renderPage(qc);
    await settle(() => expect(q("tax-rates-waiting")).not.toBeNull());
    expect(q("tax-rates-empty")).toBeNull();
    expect(q("tax-rates-load-error")).toBeNull();
  });

  it("keeps cached rows when a refresh fails, then recovers on the real Retry button", async () => {
    let failing = true;
    const qc = newClient(async () => {
      if (failing) throw serverError();
      return ratesBody;
    });
    qc.setQueryData(COMPANIES, [companyRow]);
    qc.setQueryData(RATES, ratesBody);
    await renderPage(qc);
    expect(q("tax-rate-sales-standard")).not.toBeNull();

    await act(async () => {
      await qc.invalidateQueries({ queryKey: RATES });
    });
    await settle(() => expect(q("tax-rates-refresh-error")).not.toBeNull());
    expect(q("tax-rate-sales-standard")).not.toBeNull();
    expect(q("tax-rates-load-error")).toBeNull();

    failing = false;
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="tax-rates-refresh-error"] button')!
        .click();
    });
    await settle(() => expect(q("tax-rates-refresh-error")).toBeNull());
    expect(q("tax-rate-sales-standard")).not.toBeNull();
  });

  it("retries the company query, not the disabled rates query, after a company load error", async () => {
    let companiesFail = true;
    const calls: string[] = [];
    const qc = newClient(async ({ queryKey }) => {
      calls.push(queryKey.join("/"));
      if (queryKey.length === 1) {
        if (companiesFail) throw serverError();
        return [companyRow];
      }
      return ratesBody;
    });
    await renderPage(qc);
    await settle(() => expect(q("tax-rates-load-error")).not.toBeNull());
    expect(q("tax-rates-no-company")).toBeNull();

    companiesFail = false;
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="tax-rates-load-error"] button')!
        .click();
    });
    await settle(() => expect(q("tax-rate-sales-standard")).not.toBeNull());
    expect(calls.filter((c) => c === "/api/companies").length).toBe(2);
    expect(q("tax-rates-load-error")).toBeNull();
  });
});
