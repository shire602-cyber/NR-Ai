// @vitest-environment jsdom
/**
 * Firm audit (2026-11-19) defect 10: failed loads on the command centre and the client profile
 * show translated, cause-specific copy. The raw server message ("Internal error injected") and
 * the browser's "Failed to fetch" are never rendered, a 500 reads differently from a 404, and a
 * failed health query is not reported as "no clients".
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  failing: new Map<string, unknown>(),
  fixtures: {} as Record<string, unknown>,
}));

vi.mock("../../client/src/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/queryClient")>();
  const { QueryClient: QC } = await import("@tanstack/react-query");
  const fail = (url: string) => {
    for (const [prefix, f] of state.failing) {
      if (url.startsWith(prefix)) {
        if (f === "network") throw new TypeError("Failed to fetch");
        throw new actual.ApiError("Internal error injected", (f as { status: number }).status);
      }
    }
  };
  const queryClient = new QC({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        queryFn: async ({ queryKey }) => {
          const url = String(queryKey[0]);
          fail(url);
          return state.fixtures[url] ?? [];
        },
      },
    },
  });
  return {
    ...actual,
    queryClient,
    apiRequest: vi.fn(async (_m: string, url: string) => {
      fail(url);
      return state.fixtures[url.split("?")[0]] ?? [];
    }),
  };
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
  state.failing = new Map();
  const period = { revenue: 0, invoices: 0, receipts: 0 };
  state.fixtures = {
    "/api/firm/command-center/metrics/comparison": {
      current: period,
      previous: period,
      deltas: { revenuePct: 0, invoicesPct: 0, receiptsPct: 0 },
    },
  };
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
async function renderAt(path: string, pattern: string, load: () => Promise<{ default: never }>) {
  const { default: Page } = (await load()) as unknown as { default: () => null };
  const { hook } = memoryLocation({ path, static: false });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(Router, { hook }, createElement(Route, { path: pattern, component: Page }))
      )
    );
  });
  await settle();
}
function englishLines(): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest('[translate="no"], [aria-hidden="true"], .sr-only')) continue;
    const v = (n.textContent ?? "").replace(/\s+/g, " ").trim();
    if (v && isEnglishLine(v)) out.push(v);
  }
  return out;
}
const text = () => container.textContent ?? "";
const ID = "11111111-1111-4111-8111-111111111111";

describe("command centre load failures", () => {
  const load = () => import("../../client/src/pages/FirmCommandCenter") as never;

  it("a network failure shows translated copy, never 'Failed to fetch', in Arabic too", async () => {
    state.failing.set("/api/firm/command-center/dashboard", "network");
    await setLocale("ar");
    await renderAt("/firm/command-center", "/firm/command-center", load);
    expect(container.querySelector('[data-testid="firm-command-center-error"]')).not.toBeNull();
    expect(text()).not.toContain("Failed to fetch");
    expect(englishLines()).toEqual([]);
  });

  it("a 500 on the dashboard hides the raw server message and offers Retry", async () => {
    state.failing.set("/api/firm/command-center/dashboard", { status: 500 });
    await renderAt("/firm/command-center", "/firm/command-center", load);
    expect(text()).not.toContain("Internal error injected");
    expect(
      [...container.querySelectorAll("button")].some((b) => /try again/i.test(b.textContent ?? ""))
    ).toBe(true);
  });

  it("a failed health query is an error row, not 'No clients yet'", async () => {
    state.fixtures["/api/firm/command-center/dashboard"] = {
      summary: { totalClients: 0, activeClients: 0 },
      healthScores: [],
    };
    state.failing.set("/api/firm/command-center/clients/health", { status: 500 });
    await renderAt("/firm/command-center", "/firm/command-center", load);
    expect(container.querySelector('[data-testid="clients-health-error"]')).not.toBeNull();
    expect(text()).not.toMatch(/No clients yet/i);
  });
});

describe("client profile load failures", () => {
  const load = () => import("../../client/src/pages/firm/ClientProfile") as never;
  const route = "/firm/clients/:companyId";

  it("a 500 is a load failure with Retry (not 'removed') and hides the server message", async () => {
    state.failing.set(`/api/firm/clients/${ID}/summary`, { status: 500 });
    await renderAt(`/firm/clients/${ID}`, route, load);
    expect(text()).not.toContain("Internal error injected");
    expect(text()).not.toMatch(/outdated|removed/i);
    expect(
      [...container.querySelectorAll("button")].some((b) => /try again/i.test(b.textContent ?? ""))
    ).toBe(true);
  });

  it("a 404 says not found with an h1 and back link; a 403 says access denied", async () => {
    state.failing.set(`/api/firm/clients/${ID}/summary`, { status: 404 });
    await renderAt(`/firm/clients/${ID}`, route, load);
    const notFound = text();
    expect(container.querySelector("h1")).not.toBeNull();
    expect(notFound).toMatch(/outdated|removed/i);
    qc.clear();
    state.failing.set(`/api/firm/clients/${ID}/summary`, { status: 403 });
    await renderAt(`/firm/clients/${ID}`, route, load);
    expect(text()).not.toBe(notFound);
    expect(container.querySelector("h1")).not.toBeNull();
  });
});
