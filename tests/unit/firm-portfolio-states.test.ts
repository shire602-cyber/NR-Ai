// @vitest-environment jsdom
/**
 * Firm audit (2026-11-19) defects 5, 8, 12 and 13: the client portfolio shows a distinct error
 * state (never "No clients yet") when the load fails, hides create/import for roles without
 * firm.clients.create, explains an empty assigned list, speaks Arabic in its last English
 * corners, and renders cards on phones. Behaviour test: renders the real page in jsdom.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  fixtures: {} as Record<string, unknown>,
  failing: new Set<string>(),
  calls: [] as string[],
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
          state.calls.push(url);
          if (state.failing.has(url)) throw new actual.ApiError("Internal error injected", 500);
          return state.fixtures[url] ?? [];
        },
      },
    },
  });
  return { ...actual, queryClient, apiRequest: vi.fn(async () => ({})) };
});
vi.mock("../../client/src/components/ActiveCompanyProvider", () => ({
  useActiveCompany: () => ({
    setActiveClientCompany: vi.fn(async () => undefined),
    isFirmContext: false,
    company: undefined,
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
  state.fixtures = {
    "/api/firm/overview": {
      totalClients: 0,
      vatDueThisMonth: 0,
      overdueAr: 0,
      needsAttention: 0,
      missingDocuments: 0,
    },
    "/api/firm/bookkeeper-dashboard": {
      summary: { critical: 0, attention: 0, vatDue28Days: 0, bookkeepingBlocked: 0 },
      workload: { unassignedClients: 0 },
      vatCohorts: [],
      clients: [],
    },
  };
  state.failing = new Set();
  state.calls = [];
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

async function render() {
  const { default: ClientPortfolio } = await import("../../client/src/pages/firm/ClientPortfolio");
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(ClientPortfolio)));
  });
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

const text = () => container.textContent ?? "";
const ownerContext = {
  membership: {
    firm: { name: "NR" },
    role: "firm_owner",
    permissions: [
      "firm.clients.read",
      "firm.clients.all",
      "firm.clients.create",
      "firm.clients.write",
    ],
  },
};
const preparerContext = {
  membership: {
    firm: { name: "NR" },
    role: "preparer",
    permissions: ["firm.clients.read", "firm.clients.write"],
  },
};

const client = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Al Noor Trading LLC",
  trnVatNumber: "100000000000003",
  invoiceCount: 2,
  lastReceiptDate: null,
  assignedStaff: [],
  serviceScope: ["vat", "bookkeeping"],
  vatPeriodStartMonth: 1,
  ...over,
});

describe("firm client portfolio states", () => {
  it("[defect 5] a failed load shows an error state with Retry, never the empty-firm sentence", async () => {
    state.fixtures["/api/firm/context"] = ownerContext;
    state.failing.add("/api/firm/clients");
    await render();
    expect(container.querySelector('[data-testid="portfolio-load-error"]')).not.toBeNull();
    expect(text()).not.toMatch(/No clients yet|Add first client|0 clients managed/i);
    expect(text()).not.toContain("Internal error injected");
    const retry = [...container.querySelectorAll("button")].find((b) =>
      /try again/i.test(b.textContent ?? "")
    );
    expect(retry).toBeTruthy();
    // Retry refetches and recovers.
    state.failing.clear();
    state.fixtures["/api/firm/clients"] = [client()];
    const before = state.calls.filter((u) => u === "/api/firm/clients").length;
    await act(async () => retry!.click());
    for (let i = 0; i < 5; i++)
      await act(async () => void (await new Promise((r) => setTimeout(r, 15))));
    expect(state.calls.filter((u) => u === "/api/firm/clients").length).toBeGreaterThan(before);
    expect(text()).toContain("Al Noor Trading LLC");
  });

  it("[defect 8] a preparer sees no Add/Import controls and an assigned-clients empty state", async () => {
    state.fixtures["/api/firm/context"] = preparerContext;
    state.fixtures["/api/firm/clients"] = [];
    await render();
    expect(text()).toContain("No clients are assigned to you yet");
    expect(text()).not.toMatch(/Add client|Import clients|Add first client/i);
    expect(container.querySelector('[data-testid="button-add-client"]')).toBeNull();
  });

  it("[defect 8] a firm owner with no clients still gets the add-first-client prompt", async () => {
    state.fixtures["/api/firm/context"] = ownerContext;
    state.fixtures["/api/firm/clients"] = [];
    await render();
    expect(text()).toMatch(/No clients yet/);
    expect(text()).toMatch(/Add first client/i);
    expect(container.querySelector('[data-testid="button-add-client"]')).not.toBeNull();
  });

  it("[defect 13] phones get a card list with the primary action; the table is for md and up", async () => {
    state.fixtures["/api/firm/context"] = ownerContext;
    state.fixtures["/api/firm/clients"] = [client()];
    await render();
    const cards = container.querySelector('[data-testid="clients-cards"]');
    expect(cards?.className).toContain("md:hidden");
    expect(cards?.querySelector("button[data-testid^='button-open-books']")).not.toBeNull();
    expect(
      container.querySelector('[data-testid="clients-table"]')?.closest(".hidden.md\\:block")
    ).not.toBeNull();
  });

  it("[defect 12] Arabic: no English in the empty-search sentence or the Monthly cohort label", async () => {
    state.fixtures["/api/firm/context"] = ownerContext;
    state.fixtures["/api/firm/clients"] = [client()];
    state.fixtures["/api/firm/bookkeeper-dashboard"] = {
      summary: { critical: 0, attention: 0, vatDue28Days: 0, bookkeepingBlocked: 0 },
      workload: { unassignedClients: 1 },
      vatCohorts: [],
      clients: [
        {
          companyId: "11111111-1111-4111-8111-111111111111",
          companyName: "Al Noor Trading LLC",
          serviceScope: ["vat"],
          assignedStaff: [],
          priority: "on_track",
          vat: {
            cohortKey: "monthly",
            cohortLabel: "Monthly",
            status: "on_track",
            dueDate: null,
            daysTilDue: null,
          },
          bookkeeping: {},
        },
      ],
    };
    await setLocale("ar");
    await render();
    expect(text()).not.toMatch(/\bMonthly\b/);
    const search = container.querySelector(
      '[data-testid="input-client-search"]'
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(search, "zzzz");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const lines: string[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest('[translate="no"], [aria-hidden="true"], .sr-only')) continue;
      const v = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (v && isEnglishLine(v)) lines.push(v);
    }
    expect(lines).toEqual([]);
    expect(text()).not.toContain("Try adjusting your search");
  });
});
