// @vitest-environment jsdom
/**
 * PR 164: a signed-in user with no company must be able to stay on /settings/tax-rates (the page
 * has its own no-company state). Real App, Router, ProtectedLayout and company query; only the
 * HTTP boundary and the (unrelated) onboarding wizard page are replaced.
 */
import { createElement as h, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/pages/Onboarding", () => ({
  default: () => h("div", { "data-testid": "onboarding-stub" }),
}));

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let companies: unknown[] = [];
let releaseCompanies: () => void;
let companiesGate: Promise<void>;
let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView ??= () => {};
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
  // Transform the app and the lazy pages once, so a cold cache cannot eat a test's timeout.
  await import("../../client/src/App");
  await import("../../client/src/pages/settings/TaxRates");
  await import("../../client/src/pages/CompanySettings");
  await import("@/pages/Onboarding");
}, 240_000);

beforeEach(async () => {
  companies = [];
  companiesGate = new Promise<void>((resolve) => (releaseCompanies = resolve));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/auth/me") {
        return json({ id: "u1", email: "u1@example.test", name: "U One", userType: "customer" });
      }
      if (path === "/api/companies") {
        await companiesGate;
        return json(companies);
      }
      return json(null);
    })
  );
  const { setAuthHint } = await import("../../client/src/lib/authHint");
  setAuthHint();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  const { queryClient } = await import("../../client/src/lib/queryClient");
  queryClient.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
const settle = (assertion: () => void) =>
  vi.waitFor(
    async () => {
      await flush();
      assertion();
    },
    { timeout: 20_000 }
  );

async function startAt(path: string) {
  window.history.replaceState(null, "", path);
  const { default: App } = await import("../../client/src/App");
  await act(async () => {
    root.render(h(App));
  });
}

/** Answer GET /api/companies, then let the query, the shell effects and any navigation run. */
async function answerCompanies() {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  await act(async () => releaseCompanies());
  await settle(() => {
    expect(queryClient.getQueryState(["/api/companies"])?.status).toBe("success");
    expect(queryClient.isFetching({ queryKey: ["/api/companies"] })).toBe(0);
  });
  for (let i = 0; i < 5; i++) await flush();
}

describe("signed-in shell with no company", () => {
  // The same variants wouter's <Route path="/settings/tax-rates"> matches.
  it.each(["/settings/tax-rates", "/settings/tax-rates/", "/Settings/Tax-Rates"])(
    "stays on %s and keeps the no-company state",
    async (path) => {
      await startAt(path);
      await answerCompanies();
      // Checked first so a redirect fails with the location it went to.
      expect(window.location.pathname).toBe(path);
      await settle(() => expect(q("tax-rates-no-company")).not.toBeNull());
      for (let i = 0; i < 5; i++) await flush();
      expect(window.location.pathname).toBe(path);
      expect(q("tax-rates-no-company")).not.toBeNull();
      expect(q("onboarding-stub")).toBeNull();
    },
    30_000
  );

  it("still sends another workspace route to onboarding", async () => {
    await startAt("/settings/company");
    await answerCompanies();
    await settle(() => expect(q("onboarding-stub")).not.toBeNull());
    expect(window.location.pathname).toBe("/onboarding");
  }, 30_000);

  it("still sends an owner who has not finished onboarding away from tax rates", async () => {
    companies = [
      { id: "c1", name: "Acme", companyType: "owner", role: "owner", onboardingCompleted: false },
    ];
    await startAt("/settings/tax-rates");
    await answerCompanies();
    await settle(() => expect(q("onboarding-stub")).not.toBeNull());
    expect(window.location.pathname).toBe("/onboarding");
  }, 30_000);
});
