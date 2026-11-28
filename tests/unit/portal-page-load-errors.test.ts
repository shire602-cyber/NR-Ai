// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public body?: Record<string, unknown>,
      public rawMessage: string = message
    ) {
      super(message);
    }
  }
  const apiRequest = vi.fn();
  const portalQuery = (path: string, selection: string | null = null) => ({
    queryKey: [path.replace(/^\/api\/client-portal\//, "portal-"), selection] as const,
    queryFn: () => apiRequest("GET", path),
  });
  return { ApiError, apiRequest, portalQuery, signOut: vi.fn(async () => undefined) };
});

vi.mock("../../client/src/lib/queryClient", () => ({
  ApiError: mocks.ApiError,
  apiRequest: mocks.apiRequest,
  portalQuery: mocks.portalQuery,
  queryClient: new (class {})(),
}));
vi.mock("../../client/src/hooks/useSessionActions", () => ({
  useSessionActions: () => ({ signOut: mocks.signOut }),
}));
vi.mock("../../client/src/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ can: () => true, gate: () => ({}) }),
}));

vi.mock("../../client/src/hooks/useCurrentUser", () => ({
  currentUserQueryKey: ["me"],
  useCurrentUser: () => ({ data: { name: "Cust", email: "c@example.com" } }),
}));
vi.mock("../../client/src/pages/security/ChangePasswordCard", () => ({
  ChangePasswordCard: () => null,
}));

import { loadLocaleForPath, setPublicBootScope, useI18n } from "../../client/src/lib/i18n";
import { PortalAccountScope } from "../../client/src/lib/portal-scope";
import PortalAccount from "../../client/src/pages/portal/PortalAccount";
import PortalDashboard from "../../client/src/pages/portal/PortalDashboard";
import PortalMessages from "../../client/src/pages/portal/PortalMessages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(node: React.ReactElement, client?: QueryClient) {
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, node));
  });
  await flush();
  return qc;
}

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeAll(async () => {
  const path = "/client-portal/invoices";
  window.history.replaceState(null, "", path);
  setPublicBootScope(path);
  await Promise.all([loadLocaleForPath("en", path), loadLocaleForPath("ar", path)]);
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as any).scrollIntoView ??= () => {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
});

afterAll(() => {
  window.history.replaceState(null, "", "/");
  setPublicBootScope("/");
});

beforeEach(() => {
  mocks.apiRequest.mockReset();
  mocks.signOut.mockClear();
  window.localStorage.clear();
  document.documentElement.dir = "ltr";
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
});

const LOCALES = [
  ["en", "We couldn't load this page", "Try again"],
  ["ar", "تعذّر تحميل هذه الصفحة", "أعد المحاولة"],
] as const;

const page = (Page: React.ComponentType) =>
  createElement(PortalAccountScope.Provider, { value: "a1" }, createElement(Page));

function respond(fail: string[], data: Record<string, unknown>) {
  const calls: Record<string, number> = {};
  mocks.apiRequest.mockImplementation((_m: string, path: string) => {
    calls[path] = (calls[path] ?? 0) + 1;
    if (fail.includes(path)) return Promise.reject(new mocks.ApiError("boom", 500));
    const fallback = /\/(documents|messages|accounts)$/.test(path) ? [] : {};
    return Promise.resolve(data[path] ?? fallback);
  });
  return calls;
}

describe.each(LOCALES)("portal page load failures (%s)", (locale, title, retryLabel) => {
  beforeEach(() => useI18n.setState({ locale }));

  const cases = [
    {
      name: "messages",
      Page: PortalMessages,
      path: "/api/client-portal/messages",
      errorId: "portal-messages-load-error",
      empty: { en: "No messages yet", ar: "لا توجد رسائل بعد" },
      emptyData: [],
    },
    {
      name: "dashboard invoices",
      Page: PortalDashboard,
      path: "/api/client-portal/dashboard",
      errorId: "portal-dashboard-load-error",
      empty: { en: "No invoices yet", ar: "لا توجد فواتير بعد" },
      emptyData: { invoices: { total: 0 }, recentInvoices: [] },
    },
    {
      name: "dashboard documents",
      Page: PortalDashboard,
      path: "/api/client-portal/documents",
      errorId: "portal-documents-load-error",
      empty: { en: "No documents yet", ar: "لا توجد مستندات بعد" },
      emptyData: [],
    },
    {
      name: "account suppliers",
      Page: PortalAccount,
      path: "/api/client-portal/accounts",
      errorId: "portal-account-load-error",
      empty: null,
      emptyData: [],
    },
  ] as const;

  for (const c of cases) {
    it(`${c.name}: failed load shows a retryable error, not the empty state`, async () => {
      const calls = respond([c.path], {});
      await mount(page(c.Page));
      const alert = byId(c.errorId);
      expect(alert?.querySelector("h3")?.textContent).toBe(title);
      const btn = alert?.querySelector("button");
      expect(btn?.textContent).toBe(retryLabel);
      if (c.empty) expect(document.body.textContent).not.toContain(c.empty[locale]);
      expect(alert?.textContent).not.toMatch(/firm owner/i);
      await act(async () => btn!.click());
      await flush();
      expect(calls[c.path]).toBe(2);
    });

    it(`${c.name}: a successful empty load shows the empty state and no error`, async () => {
      respond([], { [c.path]: c.emptyData });
      await mount(page(c.Page));
      expect(byId(c.errorId)).toBeNull();
      if (c.empty) expect(document.body.textContent).toContain(c.empty[locale]);
    });
  }
});
