// @vitest-environment jsdom
/**
 * Staging accessibility pass (axe best-practice `region` and `heading-order`): the sidebar brand,
 * trial banner and sign-in footnote sit inside landmarks, the invoice editor's first section is an
 * h2, and the command palette hands focus back to whatever opened it.
 */
import { createElement, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { isAdmin: true, userType: "customer", firmRole: "firm_owner" } }),
}));
vi.mock("@/components/ActiveCompanyProvider", () => ({
  useActiveCompany: () => ({ isFirmContext: false, company: { addressCountry: "AE" } }),
}));
vi.mock("@/components/CompanySwitcher", () => ({
  CompanySwitcher: () => createElement("button", { "data-testid": "company-switcher" }, "Company"),
}));
vi.mock("@/components/RTLProvider", () => ({
  useRTL: () => ({ isRTL: false, rtlValue: (a: unknown) => a }),
}));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ trial: null }) }));
vi.mock("@/components/marketing/MarketingLayout", () => ({
  PublicChrome: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));
vi.mock("@/components/marketing/hooks", () => ({
  useLightPublicTheme: () => undefined,
  useMarketingPage: () => undefined,
}));

import { loadLocale, t as catalogs } from "../../client/src/lib/i18n";
import { SidebarProvider } from "../../client/src/components/ui/sidebar";

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  await loadLocale("en");
  window.scrollTo = () => undefined;
  window.matchMedia =
    window.matchMedia ||
    ((q: string) =>
      ({
        matches: false,
        media: q,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList);
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => undefined;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("landmarks", () => {
  it("puts the sidebar brand and company switcher inside a labelled complementary landmark", async () => {
    const { AppSidebar } = await import("../../client/src/components/layout/AppSidebar");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(SidebarProvider, null, createElement(AppSidebar))
        )
      );
    });
    const landmark = container.querySelector("aside");
    expect(landmark?.getAttribute("aria-label")).toBe(catalogs.en["components.sidebarTitle"]);
    const header = container.querySelector('[data-sidebar="header"]');
    expect(header).not.toBeNull();
    expect(header!.closest("aside")).toBe(landmark);
    expect(container.querySelector('[data-testid="company-switcher"]')!.closest("aside")).toBe(
      landmark
    );
    expect(container.querySelectorAll("aside")).toHaveLength(1);
  });

  it("renders the trial banner as a labelled region", async () => {
    const { TrialBanner } = await import("../../client/src/components/TrialBanner");
    await act(async () => {
      root.render(createElement(TrialBanner, { trial: { ended: false, daysLeft: 9 } as never }));
    });
    const banner = container.querySelector('[data-testid="trial-banner"]');
    expect(banner?.getAttribute("role")).toBe("region");
    expect(banner?.getAttribute("aria-label")).toBe(catalogs.en["marketing.trialBannerLabel"]);
    expect(catalogs.en["marketing.trialBannerLabel"]).toBeTruthy();
  });

  it("puts the sign-in footnote in a complementary landmark, outside main", async () => {
    const { AuthLayout } = await import("../../client/src/components/auth/AuthLayout");
    await act(async () => {
      root.render(createElement(AuthLayout, { variant: "login" }, createElement("form")));
    });
    const foot = container.querySelector(".mk-auth__foot");
    expect(foot).not.toBeNull();
    expect(foot!.tagName).toBe("ASIDE");
    expect(foot!.closest("main")).toBeNull();
  });
});

describe("heading order", () => {
  it("lets a form section render as an h2 and defaults to h3", async () => {
    const { FormSection } = await import("../../client/src/components/ui/form-layout");
    await act(async () => {
      root.render(
        createElement(
          "div",
          null,
          createElement(FormSection, { title: "First", headingLevel: 2 }),
          createElement(FormSection, { title: "Second" })
        )
      );
    });
    const first = container.querySelector("h2");
    expect(first?.textContent).toBe("First");
    expect(first?.className).toContain("text-h3");
    expect(container.querySelector("h3")?.textContent).toBe("Second");
  });
});

describe("command palette focus", () => {
  it("returns focus to the element that had it when the palette closes", async () => {
    const { CommandDialog, CommandInput } = await import("../../client/src/components/ui/command");
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const show = (open: boolean) =>
      act(async () => {
        root.render(createElement(CommandDialog, { open }, createElement(CommandInput)));
      });
    await show(true);
    expect(document.activeElement).not.toBe(opener);
    await show(false);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
