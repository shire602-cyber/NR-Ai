// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({
    companyId: "c1",
    company: { id: "c1", baseCurrency: "AED" },
    companies: [],
    isLoading: false,
  }),
}));
import { loadNamespaces, useI18n } from "../../client/src/lib/i18n";
import ExchangeRates from "../../client/src/pages/ExchangeRates";

const BASE = "/api/companies/c1";
const RATES = `${BASE}/exchange-rates`;
const serverError = () => Object.assign(new Error("500: boom"), { status: 500 });
const rate = (id: string, from: string, to: string, r: number) => ({
  id,
  companyId: "c1",
  scope: "company",
  fromCurrency: from,
  toCurrency: to,
  rate: r,
  rateType: "spot",
  effectiveDate: "2026-11-01",
  source: "manual",
  createdAt: "2026-11-01",
});

async function render(
  locale: "en" | "ar",
  ratesRequest: () => Promise<unknown>,
  fxRequest: () => Promise<unknown>,
  test: (node: HTMLDivElement) => Promise<void>
) {
  await loadNamespaces(locale, ["common", "components", "pages"]);
  const prior = useI18n.getState().locale;
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const priorEnv = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  useI18n.setState({ locale });
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const path = queryKey.join("/");
          if (path === RATES) return ratesRequest();
          if (path === `${BASE}/reports/fx-gains-losses`) return fxRequest();
          if (path === `${BASE}/fx-revaluations`) return [];
          if (path === `${RATES}/feed-status`) return null;
          return null;
        },
      },
    },
  });
  const node = document.createElement("div");
  document.body.appendChild(node);
  const root = createRoot(node);
  try {
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client, children: createElement(ExchangeRates) })
      );
    });
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(node.querySelector(".animate-pulse")).toBeNull();
    });
    await test(node);
  } finally {
    await act(async () => root.unmount());
    node.remove();
    client.clear();
    useI18n.setState({ locale: prior });
    env.IS_REACT_ACT_ENVIRONMENT = priorEnv;
  }
}

const emptyFx = { asOf: "2026-11-24", exposures: [], warnings: [] };

describe.each(["en", "ar"] as const)("exchange rates screen (%s)", (locale) => {
  it("shows an error with Retry, not the empty state, when loads fail", async () => {
    const ratesRequest = vi.fn().mockRejectedValueOnce(serverError()).mockResolvedValue([]);
    const fxRequest = vi.fn().mockRejectedValueOnce(serverError()).mockResolvedValue(emptyFx);
    await render(locale, ratesRequest, fxRequest, async (node) => {
      const ratesErr = node.querySelector('[data-testid="rates-load-error"]');
      const fxErr = node.querySelector('[data-testid="fx-load-error"]');
      expect(ratesErr?.getAttribute("role")).toBe("alert");
      expect(fxErr).not.toBeNull();
      expect(ratesErr?.textContent).not.toContain("boom");
      expect(node.querySelector('[data-testid="fx-exposure-empty"]')).toBeNull();
      const button = ratesErr?.querySelector("button");
      await act(async () => button?.click());
      await vi.waitFor(() =>
        expect(node.querySelector('[data-testid="rates-load-error"]')).toBeNull()
      );
    });
  });

  it("filters saved rates and shows a no-match state", async () => {
    const rows = [rate("1", "USD", "AED", 3.6725), rate("2", "EUR", "AED", 4.0)];
    await render(
      locale,
      async () => rows,
      async () => emptyFx,
      async (node) => {
        const input = node.querySelector<HTMLInputElement>('[data-testid="input-rate-search"]')!;
        const setValue = (v: string) =>
          act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value"
            )!.set!;
            setter.call(input, v);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          });
        expect(node.querySelectorAll("tbody tr").length).toBe(2);
        await setValue("eur");
        expect(node.querySelectorAll("tbody tr").length).toBe(1);
        await setValue("zzz");
        expect(node.querySelector('[data-testid="rates-no-match"]')).not.toBeNull();
        expect(node.querySelectorAll("tbody tr").length).toBe(0);
        await act(async () =>
          node.querySelector<HTMLButtonElement>('[data-testid="rates-no-match"] button')?.click()
        );
        expect(node.querySelectorAll("tbody tr").length).toBe(2);
      }
    );
  });
});
