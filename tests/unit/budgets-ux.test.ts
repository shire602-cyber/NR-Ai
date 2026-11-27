// @vitest-environment jsdom
/**
 * Budgets screen UX: a failed load is translated cause-specific copy with Retry (never the raw
 * server message, never "no budgets yet"), paused queries resume after reconnection, and budget
 * search announces when there are no matches.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  focusManager,
  onlineManager,
  QueryClientProvider,
  type QueryClient,
} from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enFinanceViews from "../../client/src/locales/en/financeViews.json";
import arFinanceViews from "../../client/src/locales/ar/financeViews.json";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CID = "22222222-2222-4222-8222-222222222222";
const failing = new Map<string, number | "network">();
const fixtures: Record<string, unknown> = {};

vi.mock("../../client/src/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/queryClient")>();
  return { ...actual, apiRequest: vi.fn(async () => ({ imported: 1 })) };
});
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({
    company: { id: CID, fiscalYearStartMonth: 1 },
    companyId: CID,
    isLoading: false,
  }),
}));

let container: HTMLDivElement;
let root: Root;
let qc: QueryClient;

const fetchFixture = async (url: string, _init?: RequestInit) => {
  const failure = failing.get(url);
  if (failure === "network") throw new TypeError("Failed to fetch");
  if (failure) return Response.json({ message: "Internal error injected" }, { status: failure });
  return Response.json(fixtures[url] ?? []);
};

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});
beforeEach(async () => {
  window.localStorage.clear();
  failing.clear();
  for (const key of Object.keys(fixtures)) delete fixtures[key];
  vi.stubGlobal("fetch", vi.fn(fetchFixture));
  ({ queryClient: qc } = await import("../../client/src/lib/queryClient"));
  qc.clear();
  qc.setDefaultOptions({
    queries: { ...qc.getDefaultOptions().queries, retry: false, staleTime: Infinity },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await setLocale("en");
});
afterEach(() => {
  act(() => root.unmount());
  qc.clear();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
  container.remove();
});

async function setLocale(locale: "en" | "ar") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale(locale));
}
async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}
async function renderPage() {
  const { default: Page } = await import("../../client/src/pages/Budgets");
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(Page as never)));
  });
  await settle();
}
const text = () => container.textContent ?? "";
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);

const plan = (id: string, name: string, year: number) => ({
  id,
  company_id: CID,
  name,
  fiscal_year: year,
  status: "draft",
  total_budget: "1000",
  start_date: `${year}-01-01`,
  end_date: `${year}-12-31`,
  version: 1,
});
const URL = `/api/companies/${CID}/budget-plans`;
const LINES_URL = "/api/budget-plans/a/lines";
const VARIANCE_URL = "/api/budget-plans/a/variance";
const PAUSED = enFinanceViews["budgets.readPaused"];
const WAITING = enFinanceViews["budgets.loadWaiting"];

function setDetailFixtures() {
  fixtures[URL] = [plan("a", "موازنة التسويق", 2026)];
  fixtures[LINES_URL] = [
    { id: "line", category: "Marketing", description: "حملة التسويق", annual_total: "1000" },
  ];
  fixtures[VARIANCE_URL] = {
    periods: ["2026-01"],
    varianceLines: [
      {
        id: "line",
        category: "Marketing",
        description: "انحراف التسويق",
        accountType: "expense",
        months: {},
        totals: { budget: 1000, actual: 750, variance: 250, variancePercent: 25 },
      },
    ],
  };
}

function openBudget() {
  act(() => q("mobile-budget-list")!.querySelector("li")!.click());
}

function openTab(label: string) {
  const tab = Array.from(container.querySelectorAll('[role="tab"]')).find(
    (el) => el.textContent === label
  );
  expect(tab).toBeDefined();
  act(() => tab!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
}

async function clickRetry(id: string, label: string) {
  const button = q(id)?.querySelector("button");
  expect(button?.textContent).toBe(label);
  act(() => button!.click());
  await settle();
}

describe("budgets list states", () => {
  it("a 500 shows translated copy with Retry, not the server message or the empty state", async () => {
    failing.set(URL, 500);
    await renderPage();
    expect(q("budgets-load-error")).not.toBeNull();
    expect(q("budgets-empty")).toBeNull();
    expect(text()).not.toContain("Internal error injected");
    failing.delete(URL);
    fixtures[URL] = [plan("a", "Recovered budget plan", 2026)];
    await clickRetry("budgets-load-error", "Try again");
    expect(q("budgets-load-error")).toBeNull();
    expect(text()).toContain("Recovered budget plan");
  });

  it("a network failure in Arabic hides 'Failed to fetch' and has no English lines", async () => {
    failing.set(URL, "network");
    await setLocale("ar");
    await renderPage();
    expect(q("budgets-load-error")).not.toBeNull();
    expect(text()).not.toContain("Failed to fetch");
  });

  it("waits for an uncached budget list to reconnect before showing a successful empty result", async () => {
    onlineManager.setOnline(false);
    await renderPage();
    expect(text()).toContain(PAUSED);
    expect(text()).not.toContain("0 budget plans");
    expect(q("budgets-empty")).toBeNull();

    act(() => onlineManager.setOnline(true));
    await settle();
    expect(text()).not.toContain(PAUSED);
    expect(text()).toContain("0 budget plans");
    expect(q("budgets-empty")).not.toBeNull();
  });

  it("shows neutral waiting copy when an online retry pauses in an unfocused tab", async () => {
    qc.setDefaultOptions({
      queries: { ...qc.getDefaultOptions().queries, retry: 1, retryDelay: 0 },
    });
    focusManager.setFocused(false);
    failing.set(URL, 500);
    await renderPage();

    expect(qc.getQueryState([URL])?.fetchStatus).toBe("paused");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(WAITING);
    expect(q("budgets-empty")).toBeNull();
    expect(q("budgets-load-error")).toBeNull();

    act(() => onlineManager.setOnline(false));
    expect(text()).toContain(PAUSED);
    act(() => onlineManager.setOnline(true));
    expect(text()).toContain(WAITING);

    failing.delete(URL);
    fixtures[URL] = [plan("a", "Recovered after focus", 2026)];
    act(() => focusManager.setFocused(true));
    await settle();
    expect(text()).toContain("Recovered after focus");
    expect(text()).not.toContain(WAITING);
  });

  it("keeps cached budget rows visible when a refresh fails and retries the refresh", async () => {
    fixtures[URL] = [plan("a", "Marketing 2026", 2026)];
    await renderPage();

    failing.set(URL, 500);
    await act(async () => qc.invalidateQueries({ queryKey: [URL] }));
    await settle();
    expect(text()).toContain("Marketing 2026");
    expect(q("budgets-refresh-failed")?.textContent).toContain(
      enFinanceViews["budgets.refreshFailed"]
    );
    expect(q("budgets-load-error")).toBeNull();
    expect(q("budgets-empty")).toBeNull();

    failing.delete(URL);
    fixtures[URL] = [plan("a", "Updated marketing plan", 2026)];
    await clickRetry("budgets-refresh-failed", "Try again");
    expect(q("budgets-refresh-failed")).toBeNull();
    expect(text()).toContain("Updated marketing plan");
  });

  it("announces no search matches in the same status region without moving focus", async () => {
    fixtures[URL] = [plan("a", "Marketing 2026", 2026), plan("b", "Operations", 2025)];
    await renderPage();
    const input = q("input-search-budgets") as HTMLInputElement;
    expect(input).not.toBeNull();
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("");
    act(() => input.focus());
    const setValue = (v: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      act(() => {
        setter.call(input, v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    setValue("market");
    expect(text()).toContain("Marketing 2026");
    expect(text()).not.toContain("Operations");
    setValue("zzz");
    expect(status?.textContent).toBe("No budgets match your search.");
    expect(q("budgets-no-match")?.closest('[role="status"]')).toBe(status);
    expect(document.activeElement).toBe(input);
    expect(q("budgets-empty")).toBeNull();
    setValue("");
    expect(container.querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent).toBe("");
  });

  it("Arabic list screen has no English text nodes", async () => {
    fixtures[URL] = [plan("a", "ميزانية التسويق", 2026)];
    await setLocale("ar");
    await renderPage();
    const english: string[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest('[translate="no"], [aria-hidden="true"], .sr-only')) continue;
      const v = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (v && isEnglishLine(v)) english.push(v);
    }
    expect(english).toEqual([]);
  });
});

describe("budget detail states", () => {
  it.each([
    ["en", enFinanceViews, "Variance"],
    ["ar", arFinanceViews, "الانحراف"],
  ] as const)(
    "renders search and detail copy from the %s catalog",
    async (locale, catalog, tab) => {
      const name = "2026";
      fixtures[URL] = [plan("a", name, 2026)];
      fixtures[VARIANCE_URL] = { periods: [], varianceLines: [] };
      await setLocale(locale);
      await renderPage();

      const search = q("input-search-budgets");
      expect(search?.getAttribute("aria-label")).toBe(catalog["budgets.searchBudgets"]);
      expect(search?.getAttribute("placeholder")).toBe(catalog["budgets.searchBudgets"]);

      openBudget();
      expect(text()).toContain(catalog["budgets.detailHeading"].replace("{name}", name));
      openTab(tab);
      expect(text()).toContain(catalog["budgets.varianceHeading"].replace("{name}", name));
      expect(text()).toContain(catalog["budgets.varianceDescription"]);
      await settle();
    }
  );

  it("aborts an uncached lines read after a CSV import and refreshes affected budget data", async () => {
    setDetailFixtures();
    let firstReadSignal: AbortSignal | null | undefined;
    let resolveFirstRead!: (value: Response) => void;
    const firstRead = new Promise<Response>((resolve) => (resolveFirstRead = resolve));
    let lineReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === LINES_URL && ++lineReads === 1) {
          firstReadSignal = init?.signal;
          return firstRead;
        }
        return fetchFixture(url);
      })
    );
    await renderPage();
    openBudget();
    await settle();
    expect(lineReads).toBe(1);
    expect(firstReadSignal?.aborted).toBe(false);

    const variance = fixtures[VARIANCE_URL];
    openTab("Variance");
    await settle();
    expect(qc.getQueryData([VARIANCE_URL])).toEqual(variance);
    openTab("Budget detail");

    fixtures[LINES_URL] = [
      { id: "imported", category: "Marketing", description: "Imported line", annual_total: "500" },
    ];
    fixtures[URL] = [{ ...plan("a", "موازنة التسويق", 2026), total_budget: "1500" }];
    fixtures[VARIANCE_URL] = { periods: ["2026-01"], varianceLines: [] };
    const input = q("input-import-budget") as HTMLInputElement;
    const csv = "category,jan\nMarketing,500";
    const file = Object.assign(new File([csv], "budget.csv"), { text: async () => csv });
    Object.defineProperty(input, "files", { value: [file] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();

    const { apiRequest } = await import("../../client/src/lib/queryClient");
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/budget-plans/a/import", { csv });
    expect(firstReadSignal?.aborted).toBe(true);
    expect(lineReads).toBe(2);
    expect(text()).toContain("Imported line");
    expect(qc.getQueryData([URL])).toEqual(fixtures[URL]);
    expect(qc.getQueryState([VARIANCE_URL])?.isInvalidated).toBe(true);

    // Even if a response arrives after cancellation, it cannot overwrite the replacement read.
    await act(async () => resolveFirstRead(Response.json([])));
    expect(qc.getQueryData([LINES_URL])).toEqual(fixtures[LINES_URL]);
    openTab("Variance");
    await settle();
    expect(qc.getQueryData([VARIANCE_URL])).toEqual(fixtures[VARIANCE_URL]);
  });

  it("waits for uncached lines and variance to reconnect before showing data and totals", async () => {
    setDetailFixtures();
    await renderPage();

    act(() => onlineManager.setOnline(false));
    openBudget();
    expect(text()).toContain(PAUSED);
    expect(q("empty-state")).toBeNull();
    expect(q("budget-total-net")).toBeNull();

    openTab("Variance");
    expect(text()).toContain(PAUSED);
    expect(text()).not.toContain("No variance data available");
    expect(q("budget-summary-net")).toBeNull();

    act(() => onlineManager.setOnline(true));
    await settle();
    expect(text()).not.toContain(PAUSED);
    expect(text()).toContain("انحراف التسويق");
    expect(q("budget-summary-net")).not.toBeNull();

    openTab("Budget detail");
    expect(text()).not.toContain(PAUSED);
    expect(text()).toContain("حملة التسويق");
    expect(q("budget-total-net")).not.toBeNull();
  });

  it("retries initial lines and variance errors and shows Arabic headings", async () => {
    setDetailFixtures();
    failing.set(LINES_URL, 500);
    failing.set(VARIANCE_URL, 500);
    await setLocale("ar");
    await renderPage();

    openBudget();
    await settle();
    expect(text()).toContain("بنود الموازنة");
    expect(q("empty-state")).toBeNull();
    expect(q("budget-total-net")).toBeNull();
    failing.delete(LINES_URL);
    await clickRetry("budget-lines-load-error", "أعد المحاولة");
    expect(q("budget-lines-load-error")).toBeNull();
    expect(container.querySelector("thead")?.textContent).toContain("الإجمالي السنوي");

    openTab("الانحراف");
    await settle();
    expect(text()).toContain("الموازنة مقابل الفعلي (الانحراف)");
    expect(text()).not.toContain("لا توجد بيانات انحراف");
    expect(q("budget-summary-net")).toBeNull();
    failing.delete(VARIANCE_URL);
    await clickRetry("budget-variance-load-error", "أعد المحاولة");
    expect(q("budget-variance-load-error")).toBeNull();
    const headings = container.querySelector("thead")?.textContent;
    expect(headings).toContain("نسبة الانحراف");
    expect(headings).not.toContain("Var");
  });
});
