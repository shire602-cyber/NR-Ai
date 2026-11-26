// @vitest-environment jsdom
import { act } from "react";
import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import arFinance from "../../client/src/locales/ar/financeViews.json";
import arFirm from "../../client/src/locales/ar/firm.json";
import {
  apiCalls,
  byTestId,
  click,
  COMPANY,
  COMPANY_ID,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  flush,
  pickOption,
  renderPage,
  rerenderPage,
  resetHarness,
  setFixtures,
  setWorkspaceCompany,
  unmountPage,
} from "./helpers/form-harness";
import { clearActiveCompany, switchActiveCompany } from "../../client/src/lib/activeCompany";
import CashFlowForecast from "../../client/src/pages/CashFlowForecast";
import { queryClient } from "../../client/src/lib/queryClient";

const FORECAST_URL_PREFIX = `/api/companies/${COMPANY_ID}/cashflow/forecast`;
const COMPANY_B_ID = "c0000000-0000-4000-8000-000000000002";
const ITEMS_PATH = `/api/companies/${COMPANY_ID}/cashflow/items`;
const HISTORY_PATH = `/api/companies/${COMPANY_ID}/cashflow/history?months=6`;
let failForecast = true;
let failItems = false;
let deleteHold: Promise<void> | null = null;
let deleteFails = false;
let itemsFetches = 0;
// When set, the next scheduled-items GET for company A snapshots its data immediately but only
// resolves once the gate opens (a read that started before a DELETE landed and is still in flight).
let itemsGate: Promise<void> | null = null;
// While set, forecast / history reads stay in flight, so a test can cancel the initial fetch.
let forecastGate: Promise<void> | null = null;
let historyGate: Promise<void> | null = null;
// The server-side scheduled items. Fixtures read it through a getter (copies each time) so the
// GET that follows a successful DELETE reflects the deletion, as the real API does.
let serverItems: Array<ReturnType<typeof scheduled>> = [];
const itemsFixture = (items: Array<ReturnType<typeof scheduled>>) => {
  serverItems = items;
  return {
    get [ITEMS_PATH]() {
      return serverItems.map((it) => ({ ...it }));
    },
  };
};

const forecastBody = (scenario: string) => ({
  currentBalance: 5000,
  projections: [
    {
      week: 1,
      weekStart: "2026-01-01",
      weekEnd: "2026-01-07",
      expectedInflows: 100,
      expectedOutflows: 50,
      projectedBalance: 5050,
    },
  ],
  insights: [],
  items: [],
  assumptions: [],
  insufficientData: false,
  scenario,
  summary: { receivablesOverdue: 0, minProjectedBalance: 0, projectedShortfall: 0 },
});
const forecastUrl = (scenario: string) =>
  `${FORECAST_URL_PREFIX}?days=90&scenario=${scenario}&delayReceiptsDays=0`;
const scheduled = (id: string) => ({
  id,
  kind: "one_off_outflow",
  description: `Item ${id}`,
  amount: 100,
  dueDate: "2026-02-01",
  repeatMonths: 0,
  occurrences: 1,
});

vi.mock("../../client/src/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/i18n")>();
  const firm = (await import("../../client/src/locales/ar/firm.json")).default;
  const finance = (await import("../../client/src/locales/ar/financeViews.json")).default;
  const toasts = (await import("../../client/src/locales/ar/toasts.json")).default;
  const dict = { ...finance, ...firm, ...toasts } as Record<string, string>;
  return { ...actual, useTranslation: () => ({ t: dict, locale: "ar" }) };
});
vi.mock("../../client/src/lib/queryClient", async () => {
  const base = formHarnessQueryClientMock();
  const inner = base.apiRequest.getMockImplementation()!;
  base.apiRequest.mockImplementation(async (method: string, url: string, body?: unknown) => {
    if (failForecast && url.startsWith(FORECAST_URL_PREFIX) && !url.includes("/items")) {
      const err = new Error("boom") as Error & { status: number };
      err.status = 500;
      throw err;
    }
    if (method === "DELETE") {
      await inner(method, url, body);
      if (deleteHold) await deleteHold;
      if (deleteFails) {
        const err = new Error("boom") as Error & { status: number };
        err.status = 500;
        throw err;
      }
      // A successful DELETE removes the row server-side, so the refetch that follows returns it gone.
      const deletedId = url.split("/").pop();
      serverItems = serverItems.filter((it) => it.id !== deletedId);
      return {};
    }
    if (forecastGate && url.startsWith(FORECAST_URL_PREFIX)) await forecastGate;
    return inner(method, url, body);
  });
  const defaults = base.queryClient.getDefaultOptions().queries!;
  const defaultFn = defaults.queryFn as (ctx: { queryKey: readonly unknown[] }) => Promise<unknown>;
  base.queryClient.setDefaultOptions({
    ...base.queryClient.getDefaultOptions(),
    queries: {
      ...defaults,
      queryFn: async (ctx) => {
        if (String(ctx.queryKey[0]).endsWith("/cashflow/items")) itemsFetches += 1;
        if (ctx.queryKey[0] === HISTORY_PATH && historyGate) await historyGate;
        if (ctx.queryKey[0] === ITEMS_PATH && itemsGate) {
          const gate = itemsGate;
          itemsGate = null;
          const snapshot = await defaultFn(ctx as { queryKey: readonly unknown[] });
          await gate;
          return snapshot;
        }
        if (failItems && String(ctx.queryKey[0]).endsWith("/cashflow/items")) {
          const err = new Error("boom") as Error & { status: number };
          err.status = 500;
          throw err;
        }
        return defaultFn(ctx as { queryKey: readonly unknown[] });
      },
    },
  });
  return base;
});
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());

describe("cash flow forecast load failure", () => {
  afterEach(async () => {
    onlineManager.setOnline(true);
    failItems = false;
    deleteHold = null;
    deleteFails = false;
    serverItems = [];
    itemsFetches = 0;
    itemsGate = null;
    forecastGate = null;
    historyGate = null;
    clearActiveCompany();
    await unmountPage();
    resetHarness();
    vi.unstubAllGlobals();
  });

  it("shows a translated retryable error, not the empty table, and recovers on retry", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    failForecast = true;
    setFixtures({});
    await renderPage(CashFlowForecast);
    await flush(50);

    const err = document.querySelector('[data-testid="cashflow-forecast-error"]');
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain(arFirm["firm.loadFailedTitle"]);
    expect(document.body.textContent).not.toContain("boom");
    // The page is Arabic, so an English-text check would pass vacuously: assert the Weekly
    // Projections card (and the empty state) are absent instead.
    expect(byTestId("forecast-projections")).toBeNull();
    expect(byTestId("forecast-empty")).toBeNull();

    failForecast = false;
    setFixtures({
      [`${FORECAST_URL_PREFIX}?days=90&scenario=base&delayReceiptsDays=0`]: {
        currentBalance: 0,
        projections: [],
        insights: [],
        items: [],
        assumptions: [],
        insufficientData: false,
        scenario: "base",
        summary: { receivablesOverdue: 0, minProjectedBalance: 0, projectedShortfall: 0 },
      },
    });
    await click(err!.querySelector("button"));
    await flush(50);
    expect(document.querySelector('[data-testid="cashflow-forecast-error"]')).toBeNull();
    const empty = document.querySelector('[data-testid="forecast-empty"]');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain(arFinance["cashFlowForecast.emptyTitle"]);
    expect(empty!.textContent).toContain(arFinance["cashFlowForecast.emptyBody"]);
  });

  it("shows offline guidance (not the empty fallbacks) when paused with no data, and recovers on reconnect", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    failForecast = false;
    setFixtures({ [forecastUrl("base")]: forecastBody("base"), [HISTORY_PATH]: [] });
    onlineManager.setOnline(false);
    await renderPage(CashFlowForecast);
    await flush(20);

    const main = byTestId("forecast-offline");
    expect(main).not.toBeNull();
    expect(main!.textContent).toContain(arFirm["firm.loadOfflineBody"]);
    expect(main!.querySelector("button")).not.toBeNull();
    const hist = byTestId("history-offline");
    expect(hist).not.toBeNull();
    expect(hist!.textContent).toContain(arFirm["firm.loadOfflineBody"]);
    expect(byTestId("forecast-empty")).toBeNull();
    expect(byTestId("forecast-projections")).toBeNull();
    expect(apiCalls("GET").filter((c) => c.url.startsWith(FORECAST_URL_PREFIX))).toHaveLength(0);

    await act(async () => onlineManager.setOnline(true));
    await flush(20);
    expect(byTestId("forecast-offline")).toBeNull();
    expect(byTestId("history-offline")).toBeNull();
    expect(byTestId("forecast-projections")).not.toBeNull();
  });

  // Cancels a held initial read, leaving the query idle with no data, then refetches a real
  // zero-row response: only the latter may show the empty message.
  async function expectEmptyMessageOnlyWithData(
    queryKey: readonly unknown[],
    message: string,
    release: () => void
  ) {
    await renderPage(CashFlowForecast);
    await flush(20);
    await act(async () => {
      await queryClient.cancelQueries({ queryKey });
    });
    await flush(20);

    const query = queryClient.getQueryCache().find({ queryKey, exact: false });
    expect(query?.state.fetchStatus).toBe("idle");
    expect(query?.state.data).toBeUndefined();
    expect(document.body.textContent).not.toContain(message);

    release();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey });
    });
    await flush(20);
    expect(document.body.textContent).toContain(message);
  }

  it("shows no projection empty message after a cancelled initial fetch leaves no data", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    failForecast = false;
    setFixtures({ [forecastUrl("base")]: { ...forecastBody("base"), projections: [] } });
    forecastGate = new Promise<void>(() => {});
    await expectEmptyMessageOnlyWithData(
      ["cashflow-forecast", COMPANY_ID],
      arFinance["cashFlowForecast.noProjectionDataAvailableAdd"],
      () => (forecastGate = null)
    );
  });

  it("shows no history empty message after a cancelled initial fetch leaves no data", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    failForecast = false;
    setFixtures({ [forecastUrl("base")]: forecastBody("base"), [HISTORY_PATH]: [] });
    historyGate = new Promise<void>(() => {});
    await expectEmptyMessageOnlyWithData(
      [HISTORY_PATH],
      arFinance["cashFlowForecast.noHistoricalDataAvailableYet"],
      () => (historyGate = null)
    );
  });

  it("keeps cached results and shows offline guidance only for an uncached scenario", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // Radix Select calls scrollIntoView, which jsdom lacks. Restored in the finally below.
    const hadScroll = "scrollIntoView" in HTMLElement.prototype;
    const origScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    try {
      await uncachedScenario();
    } finally {
      if (hadScroll) HTMLElement.prototype.scrollIntoView = origScroll;
      else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  async function uncachedScenario() {
    failForecast = false;
    setFixtures({
      [forecastUrl("base")]: forecastBody("base"),
      [forecastUrl("conservative")]: forecastBody("conservative"),
    });
    await renderPage(CashFlowForecast);
    await flush(20);
    expect(byTestId("forecast-projections")).not.toBeNull();

    await act(async () => onlineManager.setOnline(false));
    await pickOption(byTestId("select-forecast-scenario"), "متحفظ");
    await flush(20);
    expect(byTestId("forecast-offline")).not.toBeNull();
    expect(byTestId("forecast-empty")).toBeNull();
    expect(byTestId("forecast-projections")).toBeNull();

    await act(async () => onlineManager.setOnline(true));
    await flush(20);
    expect(byTestId("forecast-offline")).toBeNull();
    expect(byTestId("forecast-projections")).not.toBeNull();
  }

  it("keeps a delete button disabled while the DELETE is queued offline, and sends it once on reconnect", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    failForecast = false;
    setFixtures(
      Object.assign(itemsFixture([scheduled("a"), scheduled("b")]), {
        [forecastUrl("base")]: forecastBody("base"),
      })
    );
    await renderPage(CashFlowForecast);
    await flush(20);
    const btn = (id: string) => byTestId(`button-remove-forecast-item-${id}`) as HTMLButtonElement;
    const deletes = (id: string) =>
      apiCalls("DELETE").filter((c) => c.url.endsWith(`/items/${id}`));

    await act(async () => onlineManager.setOnline(false));
    await act(async () => {
      btn("a").click();
      btn("a").click();
    });
    await flush(5);
    // Paused before mutationFn: no request yet, but the row is already locked.
    expect(deletes("a")).toHaveLength(0);
    expect(btn("a").disabled).toBe(true);
    expect(btn("b").disabled).toBe(false);

    // Leave the page and come back (the query/mutation cache survives): the queued delete still
    // locks the row, and a second attempt while offline must not queue another request.
    await rerenderPage(() => null);
    expect(byTestId("button-remove-forecast-item-a")).toBeNull();
    await rerenderPage(CashFlowForecast);
    await flush(20);
    expect(btn("a").disabled).toBe(true);
    expect(btn("b").disabled).toBe(false);
    await act(async () => {
      btn("a").click();
    });
    await flush(5);
    expect(deletes("a")).toHaveLength(0);

    await act(async () => onlineManager.setOnline(true));
    await flush(30);
    expect(deletes("a")).toHaveLength(1);
    expect(btn("b").disabled).toBe(false);
  });

  it("blocks duplicate deletes per scheduled item, allows other rows, and is retryable", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    failForecast = false;
    setFixtures(
      Object.assign(itemsFixture([scheduled("a"), scheduled("b")]), {
        [forecastUrl("base")]: forecastBody("base"),
      })
    );
    await renderPage(CashFlowForecast);
    await flush(20);

    const btn = (id: string) => byTestId(`button-remove-forecast-item-${id}`) as HTMLButtonElement;
    const deletes = (id?: string) =>
      apiCalls("DELETE").filter((c) => !id || c.url.endsWith(`/items/${id}`));

    let release!: () => void;
    deleteHold = new Promise<void>((r) => (release = r));
    // Two clicks in the same tick: only one request may leave.
    await act(async () => {
      btn("a").click();
      btn("a").click();
    });
    await flush(5);
    expect(deletes("a")).toHaveLength(1);
    expect(btn("a").disabled).toBe(true);
    expect(btn("b").disabled).toBe(false);

    // A different item can be deleted concurrently.
    await click(btn("b"));
    expect(deletes("b")).toHaveLength(1);
    expect(btn("b").disabled).toBe(true);

    deleteFails = true;
    await act(async () => release());
    await flush(20);
    // Failure clears the guard so the user can retry.
    expect(btn("a").disabled).toBe(false);
    expect(btn("b").disabled).toBe(false);

    deleteHold = null;
    deleteFails = false;
    const fetchesBeforeRetry = itemsFetches;
    await click(btn("a"));
    await flush(20);
    expect(deletes("a")).toHaveLength(2);
    // The success invalidates the list: it must refetch, and the refetched (server) list no longer
    // has the row. A stale fixture would bring "a" back here, so this fails if the server list
    // still contained it.
    expect(itemsFetches).toBeGreaterThan(fetchesBeforeRetry);
    expect(serverItems.map((it) => it.id)).toEqual(["b"]);
    expect(byTestId("button-remove-forecast-item-a")).toBeNull();
    expect(btn("b").disabled).toBe(false);
  });

  it("keeps a deleted item gone when company A -> B -> A refetched a pre-delete snapshot mid-DELETE", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    failForecast = false;
    setFixtures(
      Object.assign(itemsFixture([scheduled("a"), scheduled("b")]), {
        [forecastUrl("base")]: forecastBody("base"),
        [forecastUrl("base").replace(COMPANY_ID, COMPANY_B_ID)]: forecastBody("base"),
      })
    );
    await renderPage(CashFlowForecast);
    await flush(20);
    const btn = (id: string) => byTestId(`button-remove-forecast-item-${id}`) as HTMLButtonElement;

    let releaseDelete!: () => void;
    deleteHold = new Promise<void>((r) => (releaseDelete = r));
    await click(btn("a"));
    expect(btn("a").disabled).toBe(true);

    // A -> B: the cache is cleared while the DELETE is still pending.
    setWorkspaceCompany({ ...COMPANY, id: COMPANY_B_ID });
    await act(async () => switchActiveCompany(COMPANY_B_ID));
    await rerenderPage(CashFlowForecast);
    await flush(20);

    // B -> A: no cached rows, so a fresh GET starts. It snapshots the pre-delete list ([a, b])
    // and stays in flight through the DELETE success.
    let releaseRead!: () => void;
    itemsGate = new Promise<void>((r) => (releaseRead = r));
    setWorkspaceCompany(COMPANY);
    await act(async () => switchActiveCompany(COMPANY_ID));
    await rerenderPage(CashFlowForecast);
    await flush(20);
    expect(itemsGate).toBeNull(); // the held read has started

    const fetchesBeforeSuccess = itemsFetches;
    await act(async () => releaseDelete());
    await flush(20);
    expect(serverItems.map((it) => it.id)).toEqual(["b"]);
    // Now the stale snapshot resolves: it must not bring the deleted row back.
    await act(async () => releaseRead());
    await flush(20);
    expect(byTestId("button-remove-forecast-item-a")).toBeNull();
    expect(btn("b")).not.toBeNull();
    expect(btn("b").disabled).toBe(false);
    // The DELETE success replaced the stale read with a fresh one.
    expect(itemsFetches).toBeGreaterThan(fetchesBeforeSuccess);
  });

  it("shows a scoped, retryable scheduled-items error and keeps the rest of the page", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    failForecast = false;
    failItems = true;
    setFixtures({ [forecastUrl("base")]: forecastBody("base"), [ITEMS_PATH]: [scheduled("a")] });
    await renderPage(CashFlowForecast);
    await flush(20);

    const err = byTestId("scheduled-items-load-error");
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain(arFirm["firm.loadFailedTitle"]);
    expect(document.body.textContent).not.toContain("boom");
    expect(byTestId("forecast-projections")).not.toBeNull();
    expect(byTestId("cashflow-forecast-error")).toBeNull();
    expect(byTestId("button-remove-forecast-item-a")).toBeNull();

    failItems = false;
    await click(err!.querySelector("button"));
    await flush(20);
    expect(byTestId("scheduled-items-load-error")).toBeNull();
    expect(byTestId("button-remove-forecast-item-a")).not.toBeNull();
  });
});
