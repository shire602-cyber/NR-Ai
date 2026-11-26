// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const apiRequestMock = vi.hoisted(() => vi.fn());

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({
    companyId: "c1",
    company: { id: "c1", baseCurrency: "AED" },
    companies: [],
    isLoading: false,
  }),
}));
// Only the write path is replaced (delete); reads go through the test client's queryFn.
vi.mock("../../client/src/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../client/src/lib/queryClient")>()),
  apiRequest: apiRequestMock,
}));
import { loadNamespaces, useI18n } from "../../client/src/lib/i18n";
import ExchangeRates from "../../client/src/pages/ExchangeRates";

const BASE = "/api/companies/c1";
const RATES = `${BASE}/exchange-rates`;
const FX = `${BASE}/reports/fx-gains-losses`;
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

const emptyFx = { asOf: "2026-11-24", exposures: [], warnings: [] };
const fxWithRow = {
  asOf: "2026-11-24",
  baseCurrency: "AED",
  receivables: [
    {
      entityType: "invoice",
      entityId: "i1",
      entityNumber: "INV-FX-1",
      counterparty: "Acme",
      currency: "USD",
      foreignAmount: 100,
      transactionRate: 3.6,
      currentRate: 3.67,
      bookValueAed: 360,
      currentValueAed: 367,
      unrealizedGainLoss: 7,
    },
  ],
  payables: [],
  totalUnrealizedGain: 7,
  totalUnrealizedLoss: 0,
  netUnrealizedGainLoss: 7,
  warnings: [],
};

/** Requests the stubbed fetch saw for the rates and FX endpoints (reset per render). */
let fetchCalls: Array<{ path: string; signal: AbortSignal | null | undefined }> = [];

/** Rejects like a real fetch when the request's signal aborts. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject);
  });
}

const q = (node: HTMLElement, id: string) => node.querySelector(`[data-testid="${id}"]`);
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

async function render(
  locale: "en" | "ar",
  ratesRequest: () => Promise<unknown>,
  fxRequest: () => Promise<unknown>,
  test: (node: HTMLDivElement, client: QueryClient) => Promise<void>,
  options: { offline?: boolean } = {}
) {
  await loadNamespaces(locale, ["common", "components", "pages", "exchangeRates"]);
  const prior = useI18n.getState().locale;
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const priorEnv = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = true;
  useI18n.setState({ locale });
  if (options.offline) onlineManager.setOnline(false);
  fetchCalls = [];
  // The rates and FX queries use the real getQueryFn, so they reach this stub; the other
  // queries on the page use the default mock below.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(href, "http://localhost").pathname;
    const handler = path === RATES ? ratesRequest : path === FX ? fxRequest : null;
    if (!handler) return Promise.reject(new Error(`Unexpected fetch ${path}`));
    fetchCalls.push({ path, signal: init?.signal });
    return untilAborted(Promise.resolve().then(handler), init?.signal).then((body) =>
      Response.json(body ?? null)
    );
  });
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const path = queryKey.join("/");
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
      await settle();
      expect(node.querySelector(".animate-pulse")).toBeNull();
    });
    await test(node, client);
  } finally {
    onlineManager.setOnline(true);
    vi.unstubAllGlobals();
    await act(async () => root.unmount());
    node.remove();
    client.clear();
    useI18n.setState({ locale: prior });
    env.IS_REACT_ACT_ENVIRONMENT = priorEnv;
  }
}

describe.each(["en", "ar"] as const)("exchange rates screen (%s)", (locale) => {
  it("shows an error with Retry, then a successful empty state, when initial loads fail", async () => {
    const ratesRequest = vi.fn().mockRejectedValueOnce(serverError()).mockResolvedValue([]);
    const fxRequest = vi.fn().mockRejectedValueOnce(serverError()).mockResolvedValue(emptyFx);
    await render(locale, ratesRequest, fxRequest, async (node) => {
      const ratesErr = q(node, "rates-load-error");
      const fxErr = q(node, "fx-load-error");
      expect(ratesErr?.getAttribute("role")).toBe("alert");
      expect(fxErr).not.toBeNull();
      expect(ratesErr?.textContent).not.toContain("boom");
      // No empty-state copy while the load has only failed.
      expect(q(node, "fx-exposure-empty")).toBeNull();
      expect(q(node, "rates-empty")).toBeNull();
      await act(async () => ratesErr?.querySelector("button")?.click());
      await act(async () => fxErr?.querySelector("button")?.click());
      await vi.waitFor(() => {
        expect(q(node, "rates-load-error")).toBeNull();
        expect(q(node, "fx-load-error")).toBeNull();
        expect(q(node, "rates-empty")).not.toBeNull();
        expect(q(node, "fx-exposure-empty")).not.toBeNull();
      });
    });
  });

  it("shows a neutral waiting state, not an empty state, while loads are paused offline", async () => {
    await render(
      locale,
      async () => [],
      async () => emptyFx,
      async (node) => {
        expect(q(node, "rates-paused")?.getAttribute("role")).toBe("status");
        expect(q(node, "fx-paused")).not.toBeNull();
        expect(q(node, "rates-empty")).toBeNull();
        expect(q(node, "fx-exposure-empty")).toBeNull();
        expect(q(node, "rates-load-error")).toBeNull();
        await act(async () => onlineManager.setOnline(true));
        await vi.waitFor(() => {
          expect(q(node, "rates-paused")).toBeNull();
          expect(q(node, "fx-paused")).toBeNull();
          expect(q(node, "rates-empty")).not.toBeNull();
          expect(q(node, "fx-exposure-empty")).not.toBeNull();
        });
      },
      { offline: true }
    );
  });

  it("keeps cached rates and FX figures with a warning and Retry when a refresh fails", async () => {
    const rows = [rate("1", "USD", "AED", 3.6725), rate("2", "EUR", "AED", 4.0)];
    const ratesRequest = vi
      .fn()
      .mockResolvedValueOnce(rows)
      .mockRejectedValueOnce(serverError())
      .mockResolvedValue(rows);
    const fxRequest = vi
      .fn()
      .mockResolvedValueOnce(fxWithRow)
      .mockRejectedValueOnce(serverError())
      .mockResolvedValue(fxWithRow);
    await render(locale, ratesRequest, fxRequest, async (node, client) => {
      const exportButton = q(node, "button-export-fx") as HTMLButtonElement;
      expect(exportButton.disabled).toBe(false);
      await act(async () => {
        await client.refetchQueries({ queryKey: [RATES] });
        await client.refetchQueries({ queryKey: [FX] });
      });
      // React Query batches observer notifications, so the warnings can land after act returns.
      await vi.waitFor(async () => {
        await settle();
        expect(q(node, "rates-refresh-error")?.getAttribute("role")).toBe("alert");
        expect(q(node, "fx-refresh-error")?.getAttribute("role")).toBe("alert");
      });
      const ratesWarn = q(node, "rates-refresh-error");
      const fxWarn = q(node, "fx-refresh-error");
      // Cached data stays visible; nothing claims the data is empty or failed to load.
      expect(q(node, "rates-load-error")).toBeNull();
      expect(q(node, "fx-load-error")).toBeNull();
      expect(q(node, "fx-exposure-empty")).toBeNull();
      expect(node.textContent).toContain("INV-FX-1");
      expect(node.querySelectorAll("tbody tr").length).toBeGreaterThanOrEqual(3);
      expect(exportButton.disabled).toBe(true);
      await act(async () => ratesWarn?.querySelector("button")?.click());
      await act(async () => fxWarn?.querySelector("button")?.click());
      await vi.waitFor(() => {
        expect(q(node, "rates-refresh-error")).toBeNull();
        expect(q(node, "fx-refresh-error")).toBeNull();
        expect(exportButton.disabled).toBe(false);
      });
      expect(node.textContent).toContain("INV-FX-1");
    });
  });

  it("keeps cached data and disables export while a refresh is paused offline", async () => {
    const rows = [rate("1", "USD", "AED", 3.6725)];
    await render(
      locale,
      async () => rows,
      async () => fxWithRow,
      async (node, client) => {
        const exportButton = q(node, "button-export-fx") as HTMLButtonElement;
        expect(exportButton.disabled).toBe(false);
        await act(async () => onlineManager.setOnline(false));
        await act(async () => {
          void client.invalidateQueries({ queryKey: [RATES] });
          void client.invalidateQueries({ queryKey: [FX] });
        });
        await vi.waitFor(() => {
          expect(q(node, "rates-refresh-paused")?.getAttribute("role")).toBe("status");
          expect(q(node, "fx-refresh-paused")).not.toBeNull();
        });
        expect(node.textContent).toContain("INV-FX-1");
        expect(exportButton.disabled).toBe(true);
        await act(async () => onlineManager.setOnline(true));
        await vi.waitFor(() => {
          expect(q(node, "rates-refresh-paused")).toBeNull();
          expect(q(node, "fx-refresh-paused")).toBeNull();
          expect(exportButton.disabled).toBe(false);
        });
      }
    );
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

  it("removes a deleted rate even when an older refresh was still in flight", async () => {
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue(null);
    const rows = [rate("1", "USD", "AED", 3.6725), rate("2", "EUR", "AED", 4.0)];
    let releaseStale: (value: unknown) => void = () => undefined;
    const stale = new Promise((resolve) => {
      releaseStale = resolve;
    });
    const ratesRequest = vi
      .fn()
      .mockResolvedValueOnce(rows) // initial load
      .mockReturnValueOnce(stale) // refresh in flight, resolves with the pre-delete rows
      .mockResolvedValue([rows[1]]); // reconcile after the delete
    await render(
      locale,
      ratesRequest,
      async () => emptyFx,
      async (node, client) => {
        expect(node.querySelectorAll("tbody tr").length).toBe(2);
        await act(async () => {
          void client.invalidateQueries({ queryKey: [RATES] });
        });
        const deleteButton = node.querySelector<HTMLButtonElement>("tbody button[aria-label]")!;
        await act(async () => deleteButton.click());
        expect(apiRequestMock).toHaveBeenCalledWith("DELETE", `${RATES}/1`);
        // The in-flight refresh (second rates request) carries a real signal and is aborted.
        const inFlight = fetchCalls.filter((c) => c.path === RATES)[1];
        expect(inFlight.signal).toBeInstanceOf(AbortSignal);
        await vi.waitFor(() => expect(inFlight.signal?.aborted).toBe(true));
        await vi.waitFor(() => expect(node.querySelectorAll("tbody tr").length).toBe(1));
        // The older response arrives late and must not bring the deleted row back.
        await act(async () => {
          releaseStale(rows);
          await Promise.resolve();
        });
        await settle();
        expect(node.querySelectorAll("tbody tr").length).toBe(1);
        expect(client.getQueryData<unknown[]>([RATES])).toEqual([rows[1]]);
      }
    );
  });

  it("keeps the undeleted rows with a warning and Retry when the reconcile after a delete fails", async () => {
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue(null);
    const rows = [rate("1", "USD", "AED", 3.6725), rate("2", "EUR", "AED", 4.0)];
    const ratesRequest = vi
      .fn()
      .mockResolvedValueOnce(rows) // initial load
      .mockRejectedValueOnce(serverError()) // reconcile after the delete fails
      .mockResolvedValue([rows[1]]); // Retry
    await render(
      locale,
      ratesRequest,
      async () => emptyFx,
      async (node, client) => {
        expect(node.querySelectorAll("tbody tr").length).toBe(2);
        const deleteButton = node.querySelector<HTMLButtonElement>("tbody button[aria-label]")!;
        await act(async () => deleteButton.click());
        expect(apiRequestMock).toHaveBeenCalledWith("DELETE", `${RATES}/1`);
        await vi.waitFor(() => expect(q(node, "rates-refresh-error")).not.toBeNull());
        const warn = q(node, "rates-refresh-error");
        expect(warn?.getAttribute("role")).toBe("alert");
        // The deleted row stays gone, the other row stays visible, and nothing claims a load failure.
        expect(node.querySelectorAll("tbody tr").length).toBe(1);
        expect(node.textContent).toContain("EUR");
        expect(q(node, "rates-load-error")).toBeNull();
        expect(q(node, "rates-empty")).toBeNull();
        expect(client.getQueryData<unknown[]>([RATES])).toEqual([rows[1]]);
        await act(async () => warn?.querySelector("button")?.click());
        await vi.waitFor(() => {
          expect(q(node, "rates-refresh-error")).toBeNull();
          expect(node.querySelectorAll("tbody tr").length).toBe(1);
        });
        expect(ratesRequest).toHaveBeenCalledTimes(3);
      }
    );
  });
});
