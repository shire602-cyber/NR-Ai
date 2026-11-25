// @vitest-environment jsdom
/**
 * PR 125: what the VAT filing screen shows for its two queries (company profile, VAT returns)
 * while they are paused, loading, failed, cached or empty. The page runs against the real
 * React Query client and the real query function; only fetch, the connection state and the
 * active-company hook are faked.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { queryClient } from "../../client/src/lib/queryClient";
import { COMPANY, COMPANY_ID } from "./helpers/form-harness";

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({
    company: undefined,
    companyId: "c0000000-0000-4000-8000-000000000001",
    companies: [],
    hasNoCompanies: false,
    isLoading: false,
    error: null,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROFILE_PATH = `/api/companies/${COMPANY_ID}`;
const RETURNS_PATH = `${PROFILE_PATH}/vat-returns`;
const PROFILE_KEY = ["/api/companies", COMPANY_ID];

const vatReturn = {
  id: "r0000000-0000-4000-8000-000000000125",
  companyId: COMPANY_ID,
  periodStart: "2026-07-01T00:00:00.000Z",
  periodEnd: "2026-09-30T23:59:59.999Z",
  dueDate: "2026-10-28T00:00:00.000Z",
  status: "ready",
  box8TotalVat: 2000,
  box11TotalVat: 765.5,
  box12TotalDueTax: 2000,
  box13RecoverableTax: 765.5,
  box14PayableTax: 1234.5,
  paymentStatus: "unpaid",
  paymentAmount: null,
  paymentDate: null,
  ftaReferenceNumber: null,
  notes: null,
  createdAt: "2026-10-02T00:00:00.000Z",
};
const NET = "1,234.50";

type Answer = { status: number; body: unknown };
let answers: Record<string, Answer>;
let container: HTMLDivElement;
let root: Root;
const originalDefaults = queryClient.getDefaultOptions();

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as any).scrollIntoView ??= () => {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
  (Element.prototype as any).releasePointerCapture ??= () => {};
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as any;
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
  // The page and its lazy chunks are heavy to transform; load them before the first test.
  await import("../../client/src/pages/VATFiling");
  // A failed read must show its error at once, not after the production retry backoff.
  queryClient.setDefaultOptions({
    ...originalDefaults,
    queries: { ...originalDefaults.queries, retry: false },
  });
}, 120_000);

afterAll(() => queryClient.setDefaultOptions(originalDefaults));

beforeEach(() => {
  queryClient.clear();
  onlineManager.setOnline(true);
  useI18n.getState().setLocale("en");
  answers = {
    [PROFILE_PATH]: { status: 200, body: { ...COMPANY } },
    [RETURNS_PATH]: { status: 200, body: [vatReturn] },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const answer = answers[new URL(String(input), "http://localhost").pathname] ?? {
        status: 404,
        body: { message: "not found" },
      };
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      });
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let i = 0; i < 10; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
};
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const text = () => container.textContent ?? "";

async function mount() {
  const { default: VATFiling } = await import("../../client/src/pages/VATFiling");
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(VATFiling))
    );
  });
  // The page paints once its catalogs and first queries have answered.
  for (let i = 0; i < 100 && !text(); i++) {
    await act(async () => new Promise((r) => setTimeout(r, 50)));
  }
  await settle();
}

const setOnline = async (online: boolean) => {
  await act(async () => onlineManager.setOnline(online));
  await settle();
};
const refresh = async () => {
  await act(async () => void queryClient.invalidateQueries());
  await settle();
};
async function clickRetry(id: string) {
  const button = byId(id)?.querySelector("button");
  expect(button).toBeTruthy();
  await act(async () => button!.click());
  await settle();
}

/** The "no returns" empty state, or the "not yet calculated" hero, must never read as a fact. */
function expectNoEmptyReturns() {
  expect(text()).not.toContain("No VAT returns yet");
  expect(text()).not.toContain("Not yet calculated");
  expect(byId("button-hero-generate")).toBeNull();
}
function expectNoTrnPrompts() {
  expect(byId("link-add-trn-warning")).toBeNull();
  expect(byId("button-add-trn-header")).toBeNull();
}

describe("VAT filing: paused loads", () => {
  it("shows neutral waiting copy for the profile, then loads when the connection returns", async () => {
    onlineManager.setOnline(false);
    await mount();
    expect(byId("vat-profile-waiting")?.getAttribute("role")).toBe("status");
    expect(byId("vat-profile-waiting")?.textContent).toContain("Waiting to load");
    expectNoTrnPrompts();
    expectNoEmptyReturns();
    expect(byId("vat-profile-load-error")).toBeNull();

    await setOnline(true);
    expect(byId("vat-profile-waiting")).toBeNull();
    expect(text()).toContain(NET);
  });

  it("shows the Arabic waiting copy in Arabic mode", async () => {
    useI18n.getState().setLocale("ar");
    onlineManager.setOnline(false);
    await mount();
    expect(byId("vat-profile-waiting")?.textContent).toContain("في انتظار التحميل");
  });

  it("waits for the returns, not an empty list, when only the returns query is paused", async () => {
    queryClient.setQueryData(PROFILE_KEY, { ...COMPANY });
    onlineManager.setOnline(false);
    await mount();
    expect(byId("vat-returns-waiting")?.textContent).toContain("Waiting to load");
    expect(byId("vat-profile-waiting")).toBeNull();
    expectNoEmptyReturns();

    await setOnline(true);
    expect(byId("vat-returns-waiting")).toBeNull();
    expect(text()).toContain(NET);
  });

  it("keeps cached returns on screen with a notice while a refresh is paused", async () => {
    await mount();
    expect(text()).toContain(NET);
    await setOnline(false);
    await refresh();
    expect(byId("vat-returns-refresh-paused")?.textContent).toContain("Waiting to refresh");
    expect(text()).toContain(NET);
    expect(byId("vat-returns-load-error")).toBeNull();

    await setOnline(true);
    expect(byId("vat-returns-refresh-paused")).toBeNull();
    expect(text()).toContain(NET);
  });
});

describe("VAT filing: initial failures", () => {
  it("a failed profile load shows an error with retry, never the missing-TRN prompts", async () => {
    answers[PROFILE_PATH] = { status: 500, body: { message: "database exploded" } };
    await mount();
    expect(byId("vat-profile-load-error")).toBeTruthy();
    expect(text()).not.toContain("database exploded");
    expectNoTrnPrompts();
    expectNoEmptyReturns();

    answers[PROFILE_PATH] = { status: 200, body: { ...COMPANY } };
    await clickRetry("vat-profile-load-error");
    expect(byId("vat-profile-load-error")).toBeNull();
    expect(text()).toContain(NET);
  });

  it("failed returns show an error with retry, not an empty list", async () => {
    answers[RETURNS_PATH] = { status: 500, body: { message: "database exploded" } };
    await mount();
    expect(byId("vat-returns-load-error")).toBeTruthy();
    expect(text()).not.toContain("database exploded");
    expectNoEmptyReturns();

    answers[RETURNS_PATH] = { status: 200, body: [vatReturn] };
    await clickRetry("vat-returns-load-error");
    expect(byId("vat-returns-load-error")).toBeNull();
    expect(text()).toContain(NET);
  });
});

describe("VAT filing: successful data", () => {
  it("shows the empty state only after a successful empty response", async () => {
    answers[RETURNS_PATH] = { status: 200, body: [] };
    await mount();
    expect(text()).toContain("No VAT returns yet");
    expect(byId("vat-returns-load-error")).toBeNull();
    expect(byId("vat-returns-refresh-error")).toBeNull();
  });

  it("offers the TRN prompts only for a loaded company without a TRN", async () => {
    answers[PROFILE_PATH] = { status: 200, body: { ...COMPANY, trnVatNumber: null } };
    answers[RETURNS_PATH] = { status: 200, body: [] };
    await mount();
    expect(byId("link-add-trn-warning")).toBeTruthy();
    expect(byId("button-add-trn-header")).toBeTruthy();
  });

  it("does not offer them to a company that has a TRN", async () => {
    await mount();
    expectNoTrnPrompts();
  });
});

describe("VAT filing: failed refreshes", () => {
  it("keeps cached returns visible with a retry notice", async () => {
    await mount();
    expect(text()).toContain(NET);
    answers[RETURNS_PATH] = { status: 500, body: { message: "database exploded" } };
    await refresh();
    expect(byId("vat-returns-refresh-error")).toBeTruthy();
    expect(byId("vat-returns-load-error")).toBeNull();
    expect(text()).toContain(NET);

    answers[RETURNS_PATH] = { status: 200, body: [vatReturn] };
    await clickRetry("vat-returns-refresh-error");
    expect(byId("vat-returns-refresh-error")).toBeNull();
    expect(text()).toContain(NET);
  });

  it("shows a retry error, not an empty list, when an empty cache fails to refresh", async () => {
    answers[RETURNS_PATH] = { status: 200, body: [] };
    await mount();
    expect(text()).toContain("No VAT returns yet");

    answers[RETURNS_PATH] = { status: 500, body: { message: "database exploded" } };
    await refresh();
    expect(byId("vat-returns-load-error")).toBeTruthy();
    expect(text()).not.toContain("No VAT returns yet");
    expect(text()).not.toContain("Not yet calculated");

    answers[RETURNS_PATH] = { status: 200, body: [vatReturn] };
    await clickRetry("vat-returns-load-error");
    expect(byId("vat-returns-load-error")).toBeNull();
    expect(text()).toContain(NET);
  });

  it("keeps the loaded profile, with a retry notice, when its refresh fails", async () => {
    answers[PROFILE_PATH] = { status: 200, body: { ...COMPANY, trnVatNumber: null } };
    await mount();
    expect(byId("link-add-trn-warning")).toBeTruthy();

    answers[PROFILE_PATH] = { status: 500, body: { message: "database exploded" } };
    await refresh();
    expect(byId("vat-profile-refresh-error")).toBeTruthy();
    expect(byId("vat-profile-load-error")).toBeNull();
    expect(byId("link-add-trn-warning")).toBeTruthy();
    expect(text()).toContain(NET);

    answers[PROFILE_PATH] = { status: 200, body: { ...COMPANY } };
    await clickRetry("vat-profile-refresh-error");
    expect(byId("vat-profile-refresh-error")).toBeNull();
    expect(byId("link-add-trn-warning")).toBeNull();
  });
});
