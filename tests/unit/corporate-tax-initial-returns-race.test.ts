// @vitest-environment jsdom
// Regression: a draft is saved while the first (uncached) returns GET is still in flight. That GET
// was issued before the write and resolves with the stale empty list; it must never replace the
// saved draft. This renders the real screen because the bug lives in its save handler and its
// shared query cache, not in a pure helper.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({
    company: { fiscalYearStartMonth: 1 },
    companyId: "c1",
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ gate: () => ({}), gateApproval: () => ({}) }),
}));
vi.mock("@/components/firm/AskNajmaButton", () => ({ AskNajmaButton: () => null }));
vi.mock("@/pages/corporateTax/CtYearEndPanel", () => ({ CtYearEndPanel: () => null }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import CorporateTax from "../../client/src/pages/CorporateTax";
import { loadLocale, translateNow, useI18n } from "../../client/src/lib/i18n";
import { queryClient } from "../../client/src/lib/queryClient";

const RETURNS_PATH = "/api/companies/c1/corporate-tax/returns";
const SAVED_DRAFT = {
  id: "ret-1",
  companyId: "c1",
  taxPeriodStart: "2026-01-01",
  taxPeriodEnd: "2026-12-31",
  totalRevenue: 500000,
  totalExpenses: 0,
  totalDeductions: 0,
  taxableIncome: 500000,
  exemptionThreshold: 375000,
  taxRate: 0.09,
  taxPayable: 11250,
  status: "draft",
  filedAt: null,
  workpaper: null,
  notes: null,
  createdAt: "2026-11-26T00:00:00.000Z",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

let root: Root;
let container: HTMLElement;
/** Requests to the returns collection, in the order they happened. */
let events: string[];
let draftPosts: unknown[];
let staleResponse: Response;
let releaseStaleGet: () => void;

/** The first returns GET is held open and answers with an empty list when released. */
function stubFetch() {
  events = [];
  draftPosts = [];
  staleResponse = json([]);
  let returnsGets = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/api/csrf-token")) return Promise.resolve(json({ csrfToken: "t" }));
      if (url.endsWith(RETURNS_PATH) && method === "POST") {
        events.push("POST");
        draftPosts.push(JSON.parse(String(init?.body)));
        return Promise.resolve(json(SAVED_DRAFT, 201));
      }
      if (url.endsWith(RETURNS_PATH) && method === "GET") {
        returnsGets += 1;
        events.push(`GET#${returnsGets}`);
        if (returnsGets === 1) {
          // Deliberately ignores the abort signal and settles late with the stale empty list.
          return new Promise<Response>((resolve) => {
            releaseStaleGet = () => {
              events.push("GET#1 released");
              resolve(staleResponse);
            };
          });
        }
        return Promise.resolve(json([SAVED_DRAFT]));
      }
      if (url.endsWith("/related-parties")) return Promise.resolve(json([]));
      return Promise.resolve(json({}));
    })
  );
}

/** Retries `assertion` until it passes or the bound expires, flushing React work inside act. */
async function waitForUi(assertion: () => void) {
  await vi.waitFor(
    async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      assertion();
    },
    { timeout: 3000, interval: 20 }
  );
}

function typeRevenue(value: string) {
  const input = container.querySelector<HTMLInputElement>(
    '[data-testid="mobile-workpaper-list"] input[type="number"]'
  )!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setValue.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const saveButton = () =>
  Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === translateNow("corporateTaxScreen.saveAsDraft")
  );
const savedDraftRow = () => container.querySelector('[data-testid="button-ct-compute-ret-1"]');

describe("corporate tax: draft saved while the first returns GET is in flight", () => {
  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useI18n.setState({ locale: "en" });
    await loadLocale("en");
    toast.mockClear();
    stubFetch();
    queryClient.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  it("renders the saved draft from a fresh GET and ignores the late stale empty response", async () => {
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(CorporateTax))
      );
    });
    await waitForUi(() => expect(events).toEqual(["GET#1"]));
    expect(savedDraftRow()).toBeNull();

    // Type workpaper figures so "Save as Draft" is available, then save while GET#1 is unresolved.
    await act(async () => typeRevenue("500000"));
    const button = saveButton();
    expect(button).toBeDefined();
    await act(async () => button!.click());

    // A GET issued after the write supplies the list; the first one is still unresolved.
    await waitForUi(() => {
      expect(events).toEqual(["GET#1", "POST", "GET#2"]);
      expect(savedDraftRow()).not.toBeNull();
    });
    expect(draftPosts).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith({
      title: translateNow("toasts.draftSaved"),
      description: translateNow("toasts.corporateTaxReturnSavedAsDraft"),
    });
    expect(staleResponse.bodyUsed).toBe(false);

    // The old, pre-write response now lands with an empty list.
    await act(async () => releaseStaleGet());

    // Wait until the app has actually read the stale body and no fetch is left running.
    await waitForUi(() => {
      expect(staleResponse.bodyUsed).toBe(true);
      expect(queryClient.isFetching()).toBe(0);
    });
    expect(events).toEqual(["GET#1", "POST", "GET#2", "GET#1 released"]);
    expect(savedDraftRow()).not.toBeNull();
  });
});
