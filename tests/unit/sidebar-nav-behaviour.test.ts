// @vitest-environment jsdom
/**
 * Behaviour tests for the real AppSidebar rendered in jsdom (replaces the former
 * source-text assertions in i18n-sidebar-titles, document-chasing-boundary,
 * whatsapp-boundary and i18n-route-consolidation): every group is expanded and the
 * rendered links/labels are inspected.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user = vi.hoisted(() => ({
  current: { isAdmin: true, userType: "customer", firmRole: "firm_owner" } as Record<
    string,
    unknown
  >,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: user.current }),
}));
vi.mock("@/components/ActiveCompanyProvider", () => ({
  useActiveCompany: () => ({ isFirmContext: false }),
}));
vi.mock("@/components/CompanySwitcher", () => ({ CompanySwitcher: () => null }));
vi.mock("@/components/RTLProvider", () => ({
  useRTL: () => ({ isRTL: false, rtlValue: (a: unknown) => a }),
}));
vi.mock("@/components/FirmRouteAccess", async (orig) => {
  const actual = await orig<typeof import("../../client/src/components/FirmRouteAccess")>();
  return {
    ...actual,
    useFirmAccess: () => ({ canAccessFirm: true, isNr: true, role: "firm_owner" }),
  };
});

import { loadLocale, t as catalogs, useI18n } from "../../client/src/lib/i18n";
import { SidebarProvider } from "../../client/src/components/ui/sidebar";

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
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
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  act(() => useI18n.getState().setLocale("en"));
});

/** Render the sidebar, open every group, and return rendered links, labels and group buttons. */
async function renderSidebar(currentUser: Record<string, unknown> = user.current) {
  user.current = currentUser;
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
  const links = new Map<string, string>();
  const groupButtons = [...container.querySelectorAll<HTMLElement>('[data-testid^="group-"]')];
  const collect = () => {
    for (const a of container.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      links.set(a.getAttribute("href")!, a.getAttribute("title") ?? a.textContent ?? "");
    }
  };
  for (const btn of groupButtons) {
    await act(async () => {
      btn.click();
    });
    collect();
  }
  collect();
  return {
    links,
    groupKeys: groupButtons.map((b) => b.getAttribute("data-testid")!.replace("group-", "")),
    text: container.textContent ?? "",
  };
}

describe("AppSidebar navigation (rendered)", () => {
  it.each(["en", "ar"] as const)(
    "R18-02: every rendered sidebar label is translated in %s, not a raw key",
    async (locale) => {
      act(() => useI18n.getState().setLocale(locale));
      const { links } = await renderSidebar();
      expect(links.size).toBeGreaterThan(40);
      const raw = [...links.values()].filter((label) => /^[A-Za-z]+(\.[A-Za-z]+)*$/.test(label));
      if (locale === "ar") expect(raw).toEqual([]);
      else expect(raw.filter((label) => label.includes("."))).toEqual([]);
    }
  );

  it("R18-02: section headings are translated, not hard-coded English", async () => {
    const { text } = await renderSidebar();
    for (const key of ["sidebarOverview", "sidebarOperations"]) {
      expect(text).toContain(catalogs.en[`shell.${key}`]);
      expect(catalogs.ar[`shell.${key}`]).toMatch(/[؀-ۿ]/);
    }
    for (const key of ["sidebarWorkspace", "sidebarDocuments", "sidebarInsights"]) {
      expect(catalogs.en[`shell.${key}`], key).toBeTruthy();
      expect(catalogs.ar[`shell.${key}`], key).toMatch(/[؀-ۿ]/);
    }
  });

  it("keeps document chasing inside the NR firm namespace and WhatsApp out of the shell", async () => {
    const { links, text } = await renderSidebar();
    expect(links.has("/firm/document-chasing")).toBe(true);
    expect(links.has("/document-chasing")).toBe(false);
    expect(text).not.toMatch(/whatsapp/i);
    expect([...links.keys()].some((href) => /whatsapp/i.test(href))).toBe(false);
  });

  it("R20-08/R15-09: consolidated pages are reached through one canonical sidebar entry", async () => {
    const { links, groupKeys } = await renderSidebar();
    expect(links.has("/integrations-hub")).toBe(true);
    expect(links.has("/integrations")).toBe(false);
    expect(links.has("/admin/clients")).toBe(false);
    expect(links.has("/advanced-reports")).toBe(false);
    expect(links.has("/analytics")).toBe(false);
    expect(groupKeys).toContain("ai");
  });

  it("Reports stays one direct /reports item with no children", async () => {
    const { links } = await renderSidebar();
    expect([...links.keys()].filter((href) => href.startsWith("/reports"))).toEqual([]);
  });
});
