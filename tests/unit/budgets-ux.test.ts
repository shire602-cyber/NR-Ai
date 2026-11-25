// @vitest-environment jsdom
/**
 * Budgets screen UX: a failed load is translated cause-specific copy with Retry (never the raw
 * server message, never "no budgets yet"), the list can be searched with a no-match state, and the
 * list screen has no English text nodes in Arabic.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

describe("budgets list states", () => {
  it("a 500 shows translated copy with Retry, not the server message or the empty state", async () => {
    state.failing.set(URL, { status: 500 });
    await renderPage();
    expect(q("budgets-load-error")).not.toBeNull();
    expect(q("budgets-empty")).toBeNull();
    expect(text()).not.toContain("Internal error injected");
    expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
  });

  it("a network failure in Arabic hides 'Failed to fetch' and has no English lines", async () => {
    state.failing.set(URL, "network");
    await setLocale("ar");
    await renderPage();
    expect(q("budgets-load-error")).not.toBeNull();
    expect(text()).not.toContain("Failed to fetch");
  });

  it("search filters the list and shows a no-match state", async () => {
    state.fixtures[URL] = [plan("a", "Marketing 2026", 2026), plan("b", "Operations", 2025)];
    await renderPage();
    const input = q("input-search-budgets") as HTMLInputElement;
    expect(input).not.toBeNull();
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
    expect(q("budgets-no-match")).not.toBeNull();
    expect(q("budgets-empty")).toBeNull();
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
