// @vitest-environment jsdom
/**
 * D1b (mobile performance): signed-out visitors boot a light root.
 *  - Public routes load only the catalog namespaces they need; app routes load every one.
 *  - Every public page renders the same copy from its route namespaces as from the full
 *    catalog (no key is read from a namespace the route does not load).
 *  - PublicApp hands over to the full <App /> as soon as the visitor leaves the public pages,
 *    and never loads it before that.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const appLoads = vi.fn();
vi.mock("../../client/src/App", () => {
  appLoads();
  return { default: () => createElement("div", { "data-testid": "full-app" }, "full app") };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetModules();
  // jsdom has no matchMedia; the install prompt and theme read it.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  appLoads.mockClear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The page itself (toasts from an earlier page live outside the shell). */
function pageText(): string {
  return (container.querySelector(".mk-root") ?? container).textContent ?? "";
}

async function settle(rounds = 12) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("D1b route-scoped catalogs", () => {
  it("[D1b] public paths map to a small namespace set; app paths need every namespace", async () => {
    const i18n = await import("../../client/src/lib/i18n");
    expect(i18n.namespacesForPath("/")).toEqual(["marketing", "components", "shell"]);
    expect(i18n.namespacesForPath("/pricing/")).toEqual(["marketing", "components", "shell"]);
    expect(i18n.namespacesForPath("/help")).toContain("pageLabels");
    expect(i18n.namespacesForPath("/help")).not.toContain("reportCenter");
    expect(i18n.namespacesForPath("/dashboard")).toBeNull();
    expect(i18n.isPublicPath("/reset-password?token=x")).toBe(true);
    expect(i18n.isPublicPath("/invoices")).toBe(false);
  });

  it("[D1b] the landing page loads only its namespaces; the first app route loads the rest", async () => {
    const i18n = await import("../../client/src/lib/i18n");
    i18n.setPublicBootScope("/");
    await i18n.loadLocaleForPath("en", "/");
    expect(i18n.t.en["marketing.heroTitleLead"]).toBeTruthy();
    expect(i18n.t.en["shell.skipToContent"]).toBeTruthy();
    expect(i18n.t.en["reportCenter.exportToExcel"]).toBeUndefined();
    expect(i18n.isLocaleLoaded("en")).toBe(false);
    await i18n.loadLocaleForPath("en", "/dashboard");
    expect(i18n.isLocaleLoaded("en")).toBe(true);
    expect(Object.keys(i18n.t.en).some((key) => key.startsWith("reportCenter."))).toBe(true);
  });

  const PUBLIC_PAGES: [string, () => Promise<{ default: () => unknown }>][] = [
    ["/", () => import("../../client/src/pages/MuhasibLanding")],
    ["/pricing", () => import("../../client/src/pages/Pricing")],
    ["/services", () => import("../../client/src/pages/Services")],
    ["/demo", () => import("../../client/src/pages/DemoWorkspace")],
    ["/help", () => import("../../client/src/pages/HelpCenter")],
    ["/trust", () => import("../../client/src/pages/TrustSecurity")],
    ["/migration-guides", () => import("../../client/src/pages/MigrationGuides")],
    ["/privacy", () => import("../../client/src/pages/PrivacyPolicy")],
    ["/terms", () => import("../../client/src/pages/TermsOfService")],
    ["/cookies", () => import("../../client/src/pages/CookiePolicy")],
    ["/login", () => import("../../client/src/pages/Login")],
    ["/register", () => import("../../client/src/pages/Register")],
    ["/forgot-password", () => import("../../client/src/pages/ForgotPassword")],
    ["/reset-password", () => import("../../client/src/pages/ResetPassword")],
  ];

  for (const locale of ["en", "ar"] as const) {
    it(`[D1b] every public page renders identically from its route namespaces (${locale})`, async () => {
      const i18n = await import("../../client/src/lib/i18n");
      const { default: PublicProviders } =
        await import("../../client/src/components/marketing/PublicProviders");
      act(() => i18n.useI18n.getState().setLocale(locale));
      const scoped: Record<string, string> = {};
      for (const [path, load] of PUBLIC_PAGES) {
        window.history.replaceState(null, "", path);
        i18n.setPublicBootScope(path);
        await i18n.loadLocaleForPath(locale, path);
        const { default: Page } = await load();
        await act(async () =>
          root.render(createElement(PublicProviders, null, createElement(Page as never)))
        );
        await settle(2);
        scoped[path] = pageText();
        act(() => root.unmount());
        root = createRoot(container);
      }
      await i18n.loadLocale(locale);
      for (const [path, load] of PUBLIC_PAGES) {
        window.history.replaceState(null, "", path);
        const { default: Page } = await load();
        await act(async () =>
          root.render(createElement(PublicProviders, null, createElement(Page as never)))
        );
        await settle(2);
        const full = pageText();
        if (full !== scoped[path]) {
          let i = 0;
          while (i < full.length && full[i] === scoped[path][i]) i += 1;
          expect(scoped[path].slice(Math.max(0, i - 40), i + 80), `${path} (${locale})`).toBe(
            full.slice(Math.max(0, i - 40), i + 80)
          );
        }
        act(() => root.unmount());
        root = createRoot(container);
      }
    }, 60_000);
  }
});

describe("D1b PublicApp", () => {
  it("[D1b] renders the landing page without loading the signed-in app, then hands over", async () => {
    const i18n = await import("../../client/src/lib/i18n");
    i18n.setPublicBootScope("/");
    await i18n.loadLocaleForPath("en", "/");
    const { default: PublicApp } = await import("../../client/src/PublicApp");
    await act(async () => root.render(createElement(PublicApp)));
    await settle();
    expect(container.querySelector("h1")?.textContent).toContain(
      i18n.t.en["marketing.heroTitleLead"]
    );
    expect(appLoads).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="full-app"]')).toBeNull();

    // Signing in (or any app link) navigates away from the public pages.
    await act(async () => {
      window.history.pushState(null, "", "/dashboard");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await settle();
    expect(appLoads).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="full-app"]')).not.toBeNull();

    // The full app keeps the session even when the visitor returns to a public page.
    await act(async () => {
      window.history.pushState(null, "", "/pricing");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await settle();
    expect(container.querySelector('[data-testid="full-app"]')).not.toBeNull();
  });
});
