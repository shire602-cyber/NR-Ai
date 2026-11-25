// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

import {
  isLocaleLoaded,
  loadLocaleForPath,
  setPublicBootScope,
  useI18n,
} from "../../client/src/lib/i18n";
import { PortalAccountScope } from "../../client/src/lib/portal-scope";
import PortalDocuments from "../../client/src/pages/portal/PortalDocuments";
import PortalInvoices from "../../client/src/pages/portal/PortalInvoices";
import PortalStatements from "../../client/src/pages/portal/PortalStatements";

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
});

describe("portal invoice list load failure", () => {
  for (const [locale, title, body, retryLabel, emptyTitle] of [
    [
      "en",
      "We couldn't load this page",
      "Something went wrong on our side. Try again in a moment.",
      "Try again",
      "No invoices yet",
    ],
    [
      "ar",
      "تعذّر تحميل هذه الصفحة",
      "حدث خطأ من جانبنا. أعد المحاولة بعد قليل.",
      "أعد المحاولة",
      "لا توجد فواتير بعد",
    ],
  ] as const) {
    it(`shows a retryable error instead of the empty state (${locale})`, async () => {
      useI18n.setState({ locale });
      expect(isLocaleLoaded(locale)).toBe(false);
      const loadInvoices = vi.fn().mockRejectedValue(new mocks.ApiError("boom", 500));
      mocks.apiRequest.mockImplementation((_method, path) =>
        path === "/api/client-portal/invoices" ? loadInvoices() : Promise.resolve({})
      );
      await mount(
        createElement(PortalAccountScope.Provider, { value: "a1" }, createElement(PortalInvoices))
      );
      const alert = byId("portal-invoices-load-error");
      expect(isLocaleLoaded(locale)).toBe(false);
      expect(alert?.querySelector("h3")?.textContent).toBe(title);
      expect(alert?.querySelector("p")?.textContent).toBe(body);
      expect(document.body.textContent).not.toContain(emptyTitle);
      const retryBtn = alert?.querySelector("button");
      expect(retryBtn?.textContent).toBe(retryLabel);
      await act(async () => retryBtn!.click());
      await flush();
      expect(loadInvoices).toHaveBeenCalledTimes(2);
    });
  }
});

describe("portal refresh failure", () => {
  const date = "2026-01-01";
  const invoice = {
    id: "i1",
    number: "INV-123",
    invoiceType: "invoice",
    date,
    dueDate: null,
    currency: "AED",
    total: 100,
    amountDue: 0,
    paymentStatus: "paid",
    einvoice: null,
  };

  it.each([
    ["documents", PortalDocuments, [{ id: "d1", name: "Trade license" }], "Trade license"],
    ["invoices", PortalInvoices, [invoice], invoice.number],
    [
      "statements",
      PortalStatements,
      {
        asOf: date,
        party: { name: "Customer" },
        company: { name: "Supplier" },
        sections: [
          {
            currency: "AED",
            openingBalance: 0,
            closingBalance: 100,
            lines: [
              { date, type: "invoice", reference: "ST-123", debit: 100, credit: 0, balance: 100 },
            ],
            aging: { current: 100, days30: 0, days60: 0, days90: 0, over90: 0 },
          },
        ],
      },
      "ST-123",
    ],
  ] as const)(
    "keeps cached %s visible and retries a failed refresh",
    async (resource, Page, data, record) => {
      useI18n.setState({ locale: "en" });
      const path = `/api/client-portal/${resource}`;
      const refresh = vi.fn().mockResolvedValue(data);
      mocks.apiRequest.mockImplementation((_method, requestPath) =>
        requestPath === path ? refresh() : Promise.resolve({})
      );
      const client = await mount(
        createElement(PortalAccountScope.Provider, { value: "a1" }, createElement(Page))
      );
      expect(container.textContent).toContain(record);

      refresh.mockRejectedValueOnce(new mocks.ApiError("boom", 500));
      await act(async () => {
        await client.invalidateQueries({ queryKey: mocks.portalQuery(path, "a1").queryKey });
      });
      await flush();
      expect(container.textContent).toContain(record);
      const retry = byId(`portal-${resource}-load-error`)?.querySelector("button");
      expect(retry?.textContent).toBe("Try again");

      await act(async () => retry!.click());
      await flush();
      expect(refresh).toHaveBeenCalledTimes(3);
      expect(byId(`portal-${resource}-load-error`)).toBeNull();
      expect(container.textContent).toContain(record);
    }
  );
});
