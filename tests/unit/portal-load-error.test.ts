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
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
});

const emptyStatement = {
  asOf: "2026-01-01",
  party: { name: "Customer" },
  company: { name: "Supplier" },
  sections: [],
};

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

  it.each([
    ["documents", PortalDocuments, [{ id: "d1", name: "Trade license" }], "Trade license"],
    ["invoices", PortalInvoices, [invoice], invoice.number],
  ] as const)(
    "keeps cached %s through a paused refresh and blocks a repeated retry",
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
      const queryKey = mocks.portalQuery(path, "a1").queryKey;

      await act(async () => onlineManager.setOnline(false));
      await act(async () => {
        void client.invalidateQueries({ queryKey });
      });
      await flush();
      expect(byId(`portal-${resource}-offline`)).not.toBeNull();
      expect(container.textContent).toContain(record);
      expect(refresh).toHaveBeenCalledTimes(1);

      refresh.mockRejectedValueOnce(new mocks.ApiError("boom", 500));
      await act(async () => onlineManager.setOnline(true));
      await flush();
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain(record);

      let finish!: (value: unknown) => void;
      refresh.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
      const retry = byId(`portal-${resource}-load-error`)!.querySelector("button")!;
      await act(async () => retry.click());
      await flush();
      expect(retry.disabled).toBe(true);
      await act(async () => retry.click());
      await flush();
      expect(refresh).toHaveBeenCalledTimes(3);
      expect(container.textContent).toContain(record);

      await act(async () => finish(data));
      await flush();
      expect(byId(`portal-${resource}-load-error`)).toBeNull();
      expect(container.textContent).toContain(record);
    }
  );
});

describe("portal uncached manual retry", () => {
  it.each([
    ["documents", PortalDocuments, [], "No documents yet"],
    ["invoices", PortalInvoices, [], "No invoices yet"],
    ["statements", PortalStatements, emptyStatement, "No transactions yet"],
  ] as const)(
    "keeps Try again busy on screen until a %s retry settles",
    async (resource, Page, data, emptyTitle) => {
      useI18n.setState({ locale: "en" });
      const path = `/api/client-portal/${resource}`;
      const load = vi.fn().mockRejectedValueOnce(new mocks.ApiError("boom", 500));
      mocks.apiRequest.mockImplementation((_method, requestPath) =>
        requestPath === path ? load() : Promise.resolve({})
      );
      await mount(createElement(PortalAccountScope.Provider, { value: "a1" }, createElement(Page)));
      const retry = byId(`portal-${resource}-load-error`)!.querySelector("button")!;

      let fail!: (reason: unknown) => void;
      load.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
      await act(async () => retry.click());
      await flush();
      expect(retry.isConnected).toBe(true);
      expect(retry.textContent).toBe("Try again");
      expect(retry.disabled).toBe(true);
      expect(retry.getAttribute("aria-busy")).toBe("true");
      expect(retry.querySelector("svg")?.classList.contains("animate-spin")).toBe(true);
      expect(document.body.textContent).not.toContain(emptyTitle);
      await act(async () => retry.click());
      await flush();
      expect(load).toHaveBeenCalledTimes(2);

      // A failed retry hands the button back.
      await act(async () => fail(new mocks.ApiError("boom", 500)));
      await flush();
      expect(retry.isConnected).toBe(true);
      expect(retry.disabled).toBe(false);
      expect(retry.hasAttribute("aria-busy")).toBe(false);

      let finish!: (value: unknown) => void;
      load.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
      await act(async () => retry.click());
      await flush();
      expect(load).toHaveBeenCalledTimes(3);
      expect(retry.isConnected).toBe(true);
      expect(retry.disabled).toBe(true);

      await act(async () => finish(data));
      await flush();
      expect(byId(`portal-${resource}-load-error`)).toBeNull();
      expect(document.body.textContent).toContain(emptyTitle);
    }
  );
});

describe("portal manual retry queued while offline", () => {
  const pages = [
    ["documents", PortalDocuments, [], "No documents yet"],
    ["invoices", PortalInvoices, [], "No invoices yet"],
    ["statements", PortalStatements, emptyStatement, "No transactions yet"],
  ] as const;

  const retryButton = (resource: string, state: string) => {
    const notice = byId(`portal-${resource}-${state}`);
    expect(notice).not.toBeNull();
    return notice!.querySelector("button")!;
  };
  const expectQueued = (button: HTMLButtonElement) => {
    expect(button.textContent).toBe("Try again");
    expect(button.disabled).toBe(true);
    expect(button.hasAttribute("aria-busy")).toBe(false);
    expect(button.querySelector("svg")?.classList.contains("animate-spin")).toBe(false);
  };
  const expectFetching = (button: HTMLButtonElement) => {
    expect(button.textContent).toBe("Try again");
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector("svg")?.classList.contains("animate-spin")).toBe(true);
  };

  it.each(pages)(
    "keeps Try again disabled through offline and focus pauses of a failed %s load",
    async (resource, Page, data, emptyTitle) => {
      useI18n.setState({ locale: "en" });
      const path = `/api/client-portal/${resource}`;
      const load = vi.fn().mockRejectedValueOnce(new mocks.ApiError("boom", 500));
      mocks.apiRequest.mockImplementation((_method, requestPath) =>
        requestPath === path ? load() : Promise.resolve({})
      );
      await mount(createElement(PortalAccountScope.Provider, { value: "a1" }, createElement(Page)));
      await act(async () => onlineManager.setOnline(false));
      const first = retryButton(resource, "load-error");
      await act(async () => first.click());
      await flush();

      let button = retryButton(resource, "offline");
      expectQueued(button);
      expect(byId(`portal-${resource}-offline`)?.textContent).toContain("Waiting for a connection");
      expect(document.body.textContent).not.toContain(emptyTitle);

      // Online again but the window is not focused: still queued, with the focus copy.
      await act(async () => focusManager.setFocused(false));
      await act(async () => onlineManager.setOnline(true));
      await flush();
      button = retryButton(resource, "paused");
      expectQueued(button);
      expect(byId(`portal-${resource}-paused`)?.textContent).toContain("Loading is paused");
      await act(async () => button.click());
      expect(load).toHaveBeenCalledTimes(1);

      let finish!: (value: unknown) => void;
      load.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
      await act(async () => focusManager.setFocused(true));
      await flush();
      expect(load).toHaveBeenCalledTimes(2);
      expectFetching(retryButton(resource, "load-error"));
      expect(document.body.textContent).not.toContain(emptyTitle);

      await act(async () => finish(data));
      await flush();
      expect(byId(`portal-${resource}-load-error`)).toBeNull();
      expect(document.body.textContent).toContain(emptyTitle);
    }
  );

  it.each(pages)(
    "keeps Try again on screen when a %s retry queued before any result starts fetching",
    async (resource, Page, data, emptyTitle) => {
      useI18n.setState({ locale: "en" });
      const path = `/api/client-portal/${resource}`;
      let fail!: (reason: unknown) => void;
      let finish!: (value: unknown) => void;
      const load = vi.fn(
        () =>
          new Promise((resolve, reject) => {
            finish = resolve;
            fail = reject;
          })
      );
      mocks.apiRequest.mockImplementation((_method, requestPath) =>
        requestPath === path ? load() : Promise.resolve({})
      );
      onlineManager.setOnline(false);
      await mount(createElement(PortalAccountScope.Provider, { value: "a1" }, createElement(Page)));
      const queued = retryButton(resource, "offline");
      expect(queued.disabled).toBe(false);
      await act(async () => queued.click());
      await flush();
      expectQueued(retryButton(resource, "offline"));

      await act(async () => onlineManager.setOnline(true));
      await flush();
      expect(load).toHaveBeenCalledTimes(1);
      expectFetching(retryButton(resource, "retrying"));
      expect(document.body.textContent).not.toContain(emptyTitle);

      await act(async () => fail(new mocks.ApiError("boom", 500)));
      await flush();
      expect(byId(`portal-${resource}-retrying`)).toBeNull();
      const again = retryButton(resource, "load-error");
      expect(again.disabled).toBe(false);
      expect(document.body.textContent).not.toContain(emptyTitle);

      await act(async () => again.click());
      await flush();
      await act(async () => finish(data));
      await flush();
      expect(byId(`portal-${resource}-load-error`)).toBeNull();
      expect(document.body.textContent).toContain(emptyTitle);
    }
  );

  const date = "2026-01-01";
  const statement = {
    asOf: date,
    party: { name: "Customer" },
    company: { name: "Supplier" },
    sections: [
      {
        currency: "AED",
        openingBalance: 0,
        closingBalance: 100,
        lines: [{ date, type: "invoice", reference: "ST-123", debit: 100, credit: 0, balance: 100 }],
        aging: { current: 100, days30: 0, days60: 0, days90: 0, over90: 0 },
      },
    ],
  };
  const invoiceRow = {
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
    ["invoices", PortalInvoices, [invoiceRow], "INV-123"],
    ["statements", PortalStatements, statement, "ST-123"],
  ] as const)(
    "keeps cached %s and a busy Try again while a retry queued during a paused refresh fetches",
    async (resource, Page, data, record) => {
      useI18n.setState({ locale: "en" });
      const path = `/api/client-portal/${resource}`;
      const load = vi.fn().mockResolvedValue(data);
      mocks.apiRequest.mockImplementation((_method, requestPath) =>
        requestPath === path ? load() : Promise.resolve({})
      );
      const client = await mount(
        createElement(PortalAccountScope.Provider, { value: "a1" }, createElement(Page))
      );
      expect(container.textContent).toContain(record);

      await act(async () => onlineManager.setOnline(false));
      await act(async () => {
        void client.invalidateQueries({ queryKey: mocks.portalQuery(path, "a1").queryKey });
      });
      await flush();
      expect(load).toHaveBeenCalledTimes(1);
      await act(async () => retryButton(resource, "offline").click());
      await flush();
      expectQueued(retryButton(resource, "offline"));
      expect(container.textContent).toContain(record);

      let finish!: (value: unknown) => void;
      load.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
      await act(async () => onlineManager.setOnline(true));
      await flush();
      expect(load).toHaveBeenCalledTimes(2);
      expect(byId(`portal-${resource}-offline`)).toBeNull();
      expectFetching(retryButton(resource, "retrying"));
      expect(container.textContent).toContain(record);

      await act(async () => finish(data));
      await flush();
      expect(byId(`portal-${resource}-retrying`)).toBeNull();
      expect(byId(`portal-${resource}-load-error`)).toBeNull();
      expect(container.textContent).toContain(record);
    }
  );

  it("keeps cached rows and a disabled Try again while a failed refresh retry is queued", async () => {
    useI18n.setState({ locale: "en" });
    const path = "/api/client-portal/documents";
    const rows = [{ id: "d1", name: "Trade license" }];
    const load = vi.fn().mockResolvedValue(rows);
    mocks.apiRequest.mockImplementation((_method, requestPath) =>
      requestPath === path ? load() : Promise.resolve({})
    );
    const client = await mount(
      createElement(
        PortalAccountScope.Provider,
        { value: "a1" },
        createElement(PortalDocuments)
      )
    );
    load.mockRejectedValueOnce(new mocks.ApiError("boom", 500));
    await act(async () => {
      await client.invalidateQueries({ queryKey: mocks.portalQuery(path, "a1").queryKey });
    });
    await flush();

    await act(async () => onlineManager.setOnline(false));
    await act(async () => retryButton("documents", "load-error").click());
    await flush();
    expectQueued(retryButton("documents", "offline"));
    expect(container.textContent).toContain("Trade license");

    await act(async () => onlineManager.setOnline(true));
    await flush();
    expect(load).toHaveBeenCalledTimes(3);
    expect(byId("portal-documents-offline")).toBeNull();
    expect(byId("portal-documents-load-error")).toBeNull();
    expect(container.textContent).toContain("Trade license");
  });
});

describe("portal automatic retry paused while unfocused", () => {
  it.each([
    ["en", "documents", PortalDocuments, [], "No documents yet"],
    ["en", "invoices", PortalInvoices, [], "No invoices yet"],
    ["en", "statements", PortalStatements, emptyStatement, "No transactions yet"],
    ["ar", "documents", PortalDocuments, [], "لا توجد مستندات بعد"],
    ["ar", "invoices", PortalInvoices, [], "لا توجد فواتير بعد"],
    ["ar", "statements", PortalStatements, emptyStatement, "لا توجد معاملات بعد"],
  ] as const)(
    "(%s) says %s is paused, not offline, and resumes on focus",
    async (locale, resource, Page, data, emptyTitle) => {
      useI18n.setState({ locale });
      const pausedTitle = locale === "en" ? "Loading is paused" : "التحميل متوقف مؤقتًا";
      const offlineTitle = locale === "en" ? "Waiting for a connection" : "في انتظار الاتصال";
      const path = `/api/client-portal/${resource}`;
      const load = vi
        .fn()
        .mockRejectedValueOnce(new mocks.ApiError("boom", 500))
        .mockResolvedValue(data);
      mocks.apiRequest.mockImplementation((_method, requestPath) =>
        requestPath === path ? load() : Promise.resolve({})
      );
      focusManager.setFocused(false);
      await mount(
        createElement(PortalAccountScope.Provider, { value: "a1" }, createElement(Page)),
        new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } })
      );
      const expectPaused = () => {
        const notice = byId(`portal-${resource}-paused`);
        expect(notice?.querySelector("h3")?.textContent).toBe(pausedTitle);
        const button = notice!.querySelector("button")!;
        expect(button.disabled).toBe(false);
        expect(button.querySelector("svg")?.classList.contains("animate-spin")).toBe(false);
        expect(byId(`portal-${resource}-offline`)).toBeNull();
        expect(document.body.textContent).not.toContain(offlineTitle);
        expect(document.body.textContent).not.toContain(emptyTitle);
        expect(load).toHaveBeenCalledTimes(1);
      };
      expectPaused();

      await act(async () => onlineManager.setOnline(false));
      await flush();
      expect(byId(`portal-${resource}-offline`)?.querySelector("h3")?.textContent).toBe(
        offlineTitle
      );
      expect(byId(`portal-${resource}-paused`)).toBeNull();

      await act(async () => onlineManager.setOnline(true));
      await flush();
      expectPaused();

      await act(async () => focusManager.setFocused(true));
      await flush();
      expect(load).toHaveBeenCalledTimes(2);
      expect(byId(`portal-${resource}-paused`)).toBeNull();
      expect(document.body.textContent).toContain(emptyTitle);
    }
  );
});

describe("portal offline first load", () => {
  it.each([
    ["en", "documents", PortalDocuments, [], "No documents yet"],
    ["en", "invoices", PortalInvoices, [], "No invoices yet"],
    ["en", "statements", PortalStatements, emptyStatement, "No transactions yet"],
    ["ar", "documents", PortalDocuments, [], "لا توجد مستندات بعد"],
    ["ar", "invoices", PortalInvoices, [], "لا توجد فواتير بعد"],
    ["ar", "statements", PortalStatements, emptyStatement, "لا توجد معاملات بعد"],
  ] as const)(
    "(%s) waits for a connection before showing %s as empty",
    async (locale, resource, Page, data, emptyTitle) => {
      useI18n.setState({ locale });
      const path = `/api/client-portal/${resource}`;
      const load = vi.fn().mockResolvedValue(data);
      mocks.apiRequest.mockImplementation((_method, requestPath) =>
        requestPath === path ? load() : Promise.resolve({})
      );
      onlineManager.setOnline(false);
      await mount(createElement(PortalAccountScope.Provider, { value: "a1" }, createElement(Page)));
      const notice = byId(`portal-${resource}-offline`);
      expect(notice?.querySelector("h3")?.textContent).toBe(
        locale === "en" ? "Waiting for a connection" : "في انتظار الاتصال"
      );
      expect(document.body.textContent).not.toContain(emptyTitle);

      // Retrying while still offline sends nothing and keeps the notice.
      await act(async () => notice!.querySelector("button")!.click());
      await flush();
      expect(load).not.toHaveBeenCalled();
      expect(byId(`portal-${resource}-offline`)).not.toBeNull();
      expect(document.body.textContent).not.toContain(emptyTitle);

      await act(async () => onlineManager.setOnline(true));
      await flush();
      expect(load).toHaveBeenCalledTimes(1);
      expect(byId(`portal-${resource}-offline`)).toBeNull();
      expect(document.body.textContent).toContain(emptyTitle);
    }
  );
});
