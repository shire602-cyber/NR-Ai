// @vitest-environment jsdom
/**
 * Budgets screen UX: a failed load is translated cause-specific copy with Retry (never the raw
 * server message, never "no budgets yet"), paused queries resume after reconnection, and budget
 * search announces when there are no matches.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CID = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({
  failing: new Map<string, unknown>(),
  fixtures: {} as Record<string, unknown>,
}));

vi.mock("../../client/src/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/queryClient")>();
  const { QueryClient: QC } = await import("@tanstack/react-query");
  const queryClient = new QC({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        queryFn: async ({ queryKey }) => {
          const url = String(queryKey[0]);
          for (const [prefix, f] of state.failing) {
            if (url.startsWith(prefix)) {
              if (f === "network") throw new TypeError("Failed to fetch");
              throw new actual.ApiError(
                "Internal error injected",
                (f as { status: number }).status
              );
            }
          }
          return state.fixtures[url] ?? [];
        },
      },
    },
  });
  return { ...actual, queryClient, apiRequest: vi.fn(async () => ({})) };
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

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});
beforeEach(async () => {
  window.localStorage.clear();
  state.failing = new Map();
  state.fixtures = {};
  ({ queryClient: qc } = (await import("../../client/src/lib/queryClient")) as unknown as {
    queryClient: QueryClient;
  });
  qc.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await setLocale("en");
});
afterEach(() => {
  act(() => root.unmount());
  onlineManager.setOnline(true);
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
const PAUSED = "You're offline. Budget data will load when you reconnect.";

function setDetailFixtures() {
  state.fixtures[URL] = [plan("a", "موازنة التسويق", 2026)];
  state.fixtures[LINES_URL] = [
    { id: "line", category: "Marketing", description: "حملة التسويق", annual_total: "1000" },
  ];
  state.fixtures[VARIANCE_URL] = {
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
    state.failing.set(URL, { status: 500 });
    await renderPage();
    expect(q("budgets-load-error")).not.toBeNull();
    expect(q("budgets-empty")).toBeNull();
    expect(text()).not.toContain("Internal error injected");
    state.failing.delete(URL);
    state.fixtures[URL] = [plan("a", "Recovered budget plan", 2026)];
    await clickRetry("budgets-load-error", "Try again");
    expect(q("budgets-load-error")).toBeNull();
    expect(text()).toContain("Recovered budget plan");
  });

  it("a network failure in Arabic hides 'Failed to fetch' and has no English lines", async () => {
    state.failing.set(URL, "network");
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

  it("keeps cached budget rows visible when a refresh fails and retries the refresh", async () => {
    state.fixtures[URL] = [plan("a", "Marketing 2026", 2026)];
    await renderPage();

    state.failing.set(URL, { status: 500 });
    await act(async () => qc.invalidateQueries({ queryKey: [URL] }));
    await settle();
    expect(text()).toContain("Marketing 2026");
    expect(q("budgets-load-error")?.textContent).toContain("Could not refresh budget data");
    expect(q("budgets-empty")).toBeNull();

    state.failing.delete(URL);
    state.fixtures[URL] = [plan("a", "Updated marketing plan", 2026)];
    await clickRetry("budgets-load-error", "Try again");
    expect(q("budgets-load-error")).toBeNull();
    expect(text()).toContain("Updated marketing plan");
  });

  it("announces no search matches in the same status region without moving focus", async () => {
    state.fixtures[URL] = [plan("a", "Marketing 2026", 2026), plan("b", "Operations", 2025)];
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
    state.fixtures[URL] = [plan("a", "ميزانية التسويق", 2026)];
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
    state.failing.set(LINES_URL, { status: 500 });
    state.failing.set(VARIANCE_URL, { status: 500 });
    await setLocale("ar");
    await renderPage();

    openBudget();
    await settle();
    expect(text()).toContain("بنود الموازنة");
    expect(q("empty-state")).toBeNull();
    expect(q("budget-total-net")).toBeNull();
    state.failing.delete(LINES_URL);
    await clickRetry("budget-lines-load-error", "أعد المحاولة");
    expect(q("budget-lines-load-error")).toBeNull();
    expect(container.querySelector("thead")?.textContent).toContain("الإجمالي السنوي");

    openTab("الانحراف");
    await settle();
    expect(text()).toContain("الموازنة مقابل الفعلي (الانحراف)");
    expect(text()).not.toContain("لا توجد بيانات انحراف");
    expect(q("budget-summary-net")).toBeNull();
    state.failing.delete(VARIANCE_URL);
    await clickRetry("budget-variance-load-error", "أعد المحاولة");
    expect(q("budget-variance-load-error")).toBeNull();
    const headings = container.querySelector("thead")?.textContent;
    expect(headings).toContain("نسبة الانحراف");
    expect(headings).not.toContain("Var");
  });
});
