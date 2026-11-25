// @vitest-environment jsdom
/**
 * Client portal: a failed invoice load shows a retryable error (English and Arabic), never the
 * "no invoices yet" empty state.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { PortalInvoiceList } from "../../client/src/components/portal/PortalInvoiceList";
import { PortalAccountScope } from "../../client/src/lib/portal-scope";
import { setSelectedPortalAccount } from "../../client/src/lib/portal-state";

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
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
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
  for (const [locale, title] of [
    ["en", "We couldn't load this page"],
    ["ar", "تعذّر تحميل هذه الصفحة"],
  ] as const) {
    it(`shows a retryable error instead of the empty state (${locale})`, async () => {
      useI18n.setState({ locale });
      const retry = vi.fn();
      await mount(
        createElement(
          PortalAccountScope.Provider,
          { value: "a1" },
          createElement(PortalInvoiceList, {
            invoices: [],
            error: new mocks.ApiError("boom", 500),
            onRetry: retry,
            onlinePayment: false,
          })
        )
      );
      expect(byId("portal-invoices-load-error")).not.toBeNull();
      expect(document.body.textContent).toContain(title);
      expect(document.body.textContent).not.toContain("No invoices");
      const retryBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        /try again|retry|أعد المحاولة/i.test(b.textContent ?? "")
      );
      expect(retryBtn).toBeTruthy();
      await act(async () => retryBtn!.click());
      expect(retry).toHaveBeenCalled();
    });
  }
});
