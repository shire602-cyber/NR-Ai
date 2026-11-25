// @vitest-environment jsdom
/**
 * PR 116: what the P&L, balance sheet and VAT tabs show for paused, failed, cached and empty
 * queries. Each tab runs against the real useReportsDataQueries and React Query; only fetch and
 * the connection state are faked.
 */
import { createElement, act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocale, translateNow, useI18n } from "../../client/src/lib/i18n";
import { queryClient } from "../../client/src/lib/queryClient";
import { ReportsPageContext } from "../../client/src/pages/reports/context";
import { useReportsDataQueries } from "../../client/src/pages/reports/hooks/useReportsDataQueries";
import ProfitLossTab from "../../client/src/pages/reports/tabs/ProfitLossTab";
import BalanceSheetTab from "../../client/src/pages/reports/tabs/BalanceSheetTab";
import VatTab from "../../client/src/pages/reports/tabs/VatTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const line = (accountCode: string, accountName: string, amount: number) => ({
  accountCode,
  accountName,
  amount,
});

const reports = [
  {
    name: "profit and loss",
    Tab: ProfitLossTab,
    reportId: "profit-loss",
    path: "/reports/pl/",
    testId: "report-pl",
    row: "Consulting income",
    total: "1,234.50",
    payload: {
      revenue: [line("4000", "Consulting income", 1234.5)],
      expenses: [line("5000", "Office rent", 234.25)],
      totalRevenue: 1234.5,
      totalExpenses: 234.25,
      netProfit: 1000.25,
    },
    empty: { revenue: [], expenses: [], totalRevenue: 0, totalExpenses: 0, netProfit: 0 },
  },
  {
    name: "balance sheet",
    Tab: BalanceSheetTab,
    reportId: "balance-sheet",
    path: "/reports/balance-sheet/",
    testId: "report-bs",
    row: "Main bank",
    total: "2,345.50",
    payload: {
      assets: [line("1010", "Main bank", 2345.5)],
      liabilities: [],
      equity: [],
      totalAssets: 2345.5,
      totalLiabilities: 0,
      totalEquity: 2345.5,
    },
    empty: {
      assets: [],
      liabilities: [],
      equity: [],
      totalAssets: 0,
      totalLiabilities: 0,
      totalEquity: 0,
    },
  },
  {
    name: "VAT summary",
    Tab: VatTab,
    reportId: "vat-summary",
    path: "/reports/vat-summary/",
    testId: "report-vat",
    row: "3,456.50",
    total: "172.83",
    payload: {
      salesSubtotal: 3456.5,
      salesVAT: 172.83,
      purchasesSubtotal: 0,
      purchasesVAT: 0,
      netVATPayable: 172.83,
    },
    empty: {
      salesSubtotal: 0,
      salesVAT: 0,
      purchasesSubtotal: 0,
      purchasesVAT: 0,
      netVATPayable: 0,
    },
  },
] as const;

type Report = (typeof reports)[number];

let container: HTMLDivElement;
let root: Root;
/** What the report endpoint under test answers with. */
let response: { status: number; body: unknown };
const originalDefaults = queryClient.getDefaultOptions();

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
  // The report queries retry once; skip the backoff wait.
  queryClient.setDefaultOptions({
    ...originalDefaults,
    queries: { ...originalDefaults.queries, retryDelay: 0 },
  });
});

afterAll(() => queryClient.setDefaultOptions(originalDefaults));

beforeEach(() => {
  useI18n.getState().setLocale("en");
  queryClient.clear();
  onlineManager.setOnline(true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

function Harness({ report }: { report: Report }) {
  const dateRange = { from: new Date("2026-11-01T00:00:00"), to: new Date("2026-11-19T00:00:00") };
  const queries = useReportsDataQueries({
    accessibleCompanies: [],
    activeReportWorkspaceTab: "reports",
    dateRange,
    hasFocusedReportSelection: true,
    selectedCompanyId: "c-1",
    selectedReportId: report.reportId,
  });
  const t = new Proxy({}, { get: (_o, key: string) => translateNow(key) });
  return createElement(
    ReportsPageContext.Provider,
    { value: { ...queries, t, dateRange, selectedCompanyId: "c-1" } as never },
    createElement(report.Tab as ComponentType)
  );
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

async function mount(report: Report, body: unknown = report.payload, status = 200) {
  response = { status, body };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const answer = url.includes(report.path) ? response : { status: 200, body: [] };
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      });
    })
  );
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Harness, { report })
      )
    );
  });
  await settle();
}

async function refresh() {
  await act(async () => void queryClient.invalidateQueries());
  await settle();
}

async function setOnline(online: boolean) {
  await act(async () => onlineManager.setOnline(online));
  await settle();
}

const failRequests = () => {
  response = { status: 500, body: { message: "database exploded" } };
};

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const text = () => container.textContent ?? "";

async function clickRetry(id: string) {
  const button = byId(id)?.querySelector("button");
  expect(button).toBeTruthy();
  await act(async () => button!.click());
  await settle();
}

/** No statement body, and no amount anywhere on the tab (zero or otherwise). */
function expectNoFigures() {
  expect(text()).not.toMatch(/\d\.\d\d/);
  expect(container.querySelector("table")).toBeNull();
}

function expectCachedFigures(report: Report) {
  expect(text()).toContain(report.row);
  expect(text()).toContain(report.total);
  if (report.reportId === "profit-loss") {
    expect(byId("text-total-revenue")?.textContent).toContain(report.total);
    expect(byId("text-total-expenses")?.textContent).toContain("234.25");
    expect(byId("text-net-profit")?.textContent).toContain("1,000.25");
  }
}

describe.each(reports)("$name query states", (report) => {
  const waiting = `${report.testId}-waiting`;
  const loadError = `${report.testId}-load-error`;
  const paused = `${report.testId}-refresh-paused`;
  const refreshError = `${report.testId}-refresh-error`;

  it("paused with no data waits for a connection, then loads", async () => {
    onlineManager.setOnline(false);
    await mount(report);
    expect(byId(waiting)?.textContent).toContain("Waiting for a connection");
    expect(byId(loadError)).toBeNull();
    expectNoFigures();

    await setOnline(true);
    expect(byId(waiting)).toBeNull();
    expectCachedFigures(report);
  });

  it("paused refresh keeps the cached figures and says it is waiting", async () => {
    await mount(report);
    await setOnline(false);
    await refresh();
    expect(byId(paused)?.textContent).toContain("Waiting for a connection to refresh");
    expect(byId(refreshError)).toBeNull();
    expectCachedFigures(report);
  });

  it("failed refresh keeps rows and totals, and retry recovers", async () => {
    await mount(report);
    failRequests();
    await refresh();
    expect(byId(refreshError)?.textContent).toContain("We couldn't refresh this report");
    expect(byId(loadError)).toBeNull();
    expect(text()).not.toContain("database exploded");
    expectCachedFigures(report);

    response = { status: 200, body: report.payload };
    await clickRetry(refreshError);
    expect(byId(refreshError)).toBeNull();
    expectCachedFigures(report);
  });

  it.each([403, 404])("a %i refresh keeps the figures and still offers retry", async (status) => {
    await mount(report);
    response = { status, body: { message: "database exploded" } };
    await refresh();
    expect(byId(refreshError)?.textContent).toContain("We couldn't refresh this report");
    expect(byId(refreshError)?.textContent).toContain("Showing the last loaded figures");
    expect(byId(refreshError)?.textContent).toContain("Try again");
    expect(text()).not.toContain("database exploded");
    expectCachedFigures(report);

    response = { status: 200, body: report.payload };
    await clickRetry(refreshError);
    expect(byId(refreshError)).toBeNull();
    expectCachedFigures(report);
  });

  it("a retry paused after a failed refresh shows waiting, not the old error", async () => {
    await mount(report);
    failRequests();
    await refresh();
    await setOnline(false);
    await clickRetry(refreshError);
    expect(byId(paused)).not.toBeNull();
    expect(byId(refreshError)).toBeNull();
    expectCachedFigures(report);
  });

  it("uncached failure is a full load error with retry and no figures", async () => {
    await mount(report, { message: "database exploded" }, 500);
    expect(byId(loadError)?.textContent).toContain("Try again");
    expect(byId(waiting)).toBeNull();
    expectNoFigures();

    response = { status: 200, body: report.payload };
    await clickRetry(loadError);
    expect(byId(loadError)).toBeNull();
    expectCachedFigures(report);
  });

  it("a retry paused after an uncached failure waits instead", async () => {
    await mount(report, { message: "database exploded" }, 500);
    await setOnline(false);
    await clickRetry(loadError);
    expect(byId(waiting)).not.toBeNull();
    expect(byId(loadError)).toBeNull();
    expectNoFigures();
  });

  it("a successful empty response shows zero totals, also when cached and offline", async () => {
    await mount(report, report.empty);
    expect(text()).toContain("0.00");
    expect(byId(waiting)).toBeNull();
    expect(byId(loadError)).toBeNull();
    expect(byId(paused)).toBeNull();

    await setOnline(false);
    await refresh();
    expect(byId(paused)).not.toBeNull();
    expect(byId(waiting)).toBeNull();
    expect(text()).toContain("0.00");
  });

  it("speaks Arabic while waiting and after a failed refresh", async () => {
    useI18n.getState().setLocale("ar");
    onlineManager.setOnline(false);
    await mount(report);
    expect(byId(waiting)?.textContent).toContain("في انتظار الاتصال");

    await setOnline(true);
    await setOnline(false);
    await refresh();
    expect(byId(paused)?.textContent).toContain("في انتظار الاتصال للتحديث");

    failRequests();
    await setOnline(true);
    expect(byId(refreshError)?.textContent).toContain("تعذّر تحديث هذا التقرير");
    expect(byId(refreshError)?.textContent).toContain("أعد المحاولة");
  });
});
