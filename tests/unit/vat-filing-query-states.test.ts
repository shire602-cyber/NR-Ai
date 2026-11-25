// @vitest-environment jsdom
/**
 * PR 125: what the VAT filing screen shows for its queries (company list, company profile, VAT
 * returns) while they are paused, loading, failed, cached or empty. The page runs against the
 * real ActiveCompanyProvider, React Query client and query function; only fetch and the
 * connection state are faked.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActiveCompanyProvider,
  useActiveCompany,
} from "../../client/src/components/ActiveCompanyProvider";
import { setAuthHint } from "../../client/src/lib/authHint";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { queryClient } from "../../client/src/lib/queryClient";
import { COMPANY, COMPANY_ID } from "./helpers/form-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIST_PATH = "/api/companies";
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
  // The company list is not requested for a visitor without a session hint, and is already
  // cached for a signed-in user who opens this screen (the company-list tests remove it).
  setAuthHint();
  queryClient.setQueryData([LIST_PATH], [{ ...COMPANY }]);
  answers = {
    [LIST_PATH]: { status: 200, body: [{ ...COMPANY }] },
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

/** What the provider tells the shell's onboarding redirect. */
function ProviderProbe() {
  const { hasNoCompanies } = useActiveCompany();
  return createElement("i", {
    "data-testid": "has-no-companies",
    "data-value": String(hasNoCompanies),
  });
}
const hasNoCompanies = () => byId("has-no-companies")?.getAttribute("data-value");

async function mount(painted = () => !!text()) {
  const { default: VATFiling } = await import("../../client/src/pages/VATFiling");
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          ActiveCompanyProvider,
          null,
          createElement(VATFiling),
          createElement(ProviderProbe)
        )
      )
    );
  });
  // The page paints once its catalogs and first queries have answered.
  for (let i = 0; i < 100 && !painted(); i++) {
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

describe("VAT filing: no active company", () => {
  beforeEach(() => queryClient.removeQueries({ queryKey: [LIST_PATH] }));

  const requested = () =>
    vi
      .mocked(fetch)
      .mock.calls.map(([input]) => new URL(String(input), "http://localhost").pathname);

  it("shows a company-list error whose retry fetches only the company list, then recovers", async () => {
    answers[LIST_PATH] = { status: 500, body: { message: "database exploded" } };
    await mount();
    expect(byId("vat-companies-load-error")?.textContent).toContain(
      "We couldn't load your companies"
    );
    expect(text()).not.toContain("database exploded");
    expect(byId("vat-no-company")).toBeNull();
    expectNoTrnPrompts();
    expectNoEmptyReturns();

    answers[LIST_PATH] = { status: 200, body: [{ ...COMPANY }] };
    vi.mocked(fetch).mockClear();
    const refetchQueries = vi.spyOn(queryClient, "refetchQueries");
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    await clickRetry("vat-companies-load-error");
    expect(byId("vat-companies-load-error")).toBeNull();
    expect(text()).toContain(NET);
    // One list request; the profile and returns load because the company is now known.
    expect(requested().filter((path) => path === LIST_PATH)).toHaveLength(1);
    expect(requested()[0]).toBe(LIST_PATH);
    expect(refetchQueries).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
    refetchQueries.mockRestore();
    invalidateQueries.mockRestore();
  });

  it("says there is no company only after a successful empty list", async () => {
    answers[LIST_PATH] = { status: 200, body: [] };
    await mount();
    expect(byId("vat-no-company")?.textContent).toContain("No company yet");
    expect(byId("vat-companies-load-error")).toBeNull();
    expect(byId("vat-companies-waiting")).toBeNull();
    expect(byId("vat-page-loading")).toBeNull();
    expect(hasNoCompanies()).toBe("true");
    expectNoTrnPrompts();
    expectNoEmptyReturns();
    expect(requested()).toEqual([LIST_PATH]);
  });

  it("shows the Arabic no-company copy in Arabic mode", async () => {
    useI18n.getState().setLocale("ar");
    answers[LIST_PATH] = { status: 200, body: [] };
    await mount();
    expect(byId("vat-no-company")?.textContent).toContain("لا توجد شركة بعد");
  });

  it("waits, without claiming there is no company, while the first list load is paused", async () => {
    onlineManager.setOnline(false);
    await mount();
    expect(byId("vat-companies-waiting")?.textContent).toContain("Waiting to load");
    expect(byId("vat-no-company")).toBeNull();
    expect(byId("vat-companies-load-error")).toBeNull();
    // The shell's onboarding redirect needs a confirmed empty list.
    expect(hasNoCompanies()).toBe("false");
    expectNoTrnPrompts();
    expectNoEmptyReturns();

    await setOnline(true);
    expect(byId("vat-companies-waiting")).toBeNull();
    expect(text()).toContain(NET);
  });

  it("keeps the loading skeleton while the first list load is in flight", async () => {
    const answered = vi.mocked(fetch).getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(fetch).mockImplementation(async (...args) => {
      await held;
      return answered(...args);
    });
    try {
      await mount(() => !!byId("vat-page-loading"));
      expect(byId("vat-page-loading")).toBeTruthy();
      expect(hasNoCompanies()).toBe("false");
      expect(byId("vat-no-company")).toBeNull();
      expect(byId("vat-companies-waiting")).toBeNull();
      expect(byId("vat-companies-load-error")).toBeNull();
    } finally {
      await act(async () => release());
      await settle();
    }
    expect(text()).toContain(NET);
  });

  it("does not treat a cached empty list whose refresh failed as confirmed", async () => {
    answers[LIST_PATH] = { status: 200, body: [] };
    await mount();
    expect(byId("vat-no-company")).toBeTruthy();

    answers[LIST_PATH] = { status: 500, body: { message: "database exploded" } };
    await refresh();
    expect(byId("vat-companies-load-error")).toBeTruthy();
    expect(byId("vat-no-company")).toBeNull();
  });
});

describe("VAT filing: cached profile of a company that is not VAT registered", () => {
  const unregistered = { ...COMPANY, taxRegistrationType: "Non-registered", trnVatNumber: null };
  beforeEach(() => {
    answers[PROFILE_PATH] = { status: 200, body: unregistered };
  });

  it("keeps the card with a notice while a refresh is paused", async () => {
    await mount();
    expect(byId("card-vat-not-registered")).toBeTruthy();
    expect(byId("vat-profile-refresh-paused")).toBeNull();

    await setOnline(false);
    await refresh();
    expect(byId("vat-profile-refresh-paused")?.textContent).toContain("Waiting to refresh");
    expect(byId("card-vat-not-registered")).toBeTruthy();

    await setOnline(true);
    expect(byId("vat-profile-refresh-paused")).toBeNull();
    expect(byId("card-vat-not-registered")).toBeTruthy();
  });

  it("keeps the card with a retry notice when a refresh fails", async () => {
    await mount();
    answers[PROFILE_PATH] = { status: 500, body: { message: "database exploded" } };
    await refresh();
    expect(byId("vat-profile-refresh-error")).toBeTruthy();
    expect(byId("card-vat-not-registered")).toBeTruthy();
    expect(text()).not.toContain("database exploded");

    answers[PROFILE_PATH] = { status: 200, body: unregistered };
    await clickRetry("vat-profile-refresh-error");
    expect(byId("vat-profile-refresh-error")).toBeNull();
    expect(byId("card-vat-not-registered")).toBeTruthy();
  });
});
