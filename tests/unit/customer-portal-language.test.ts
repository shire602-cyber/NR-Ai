// @vitest-environment jsdom
/**
 * Customer portal (/portal/:token): opens in the company's language (Arabic = rtl), and the
 * viewer can switch language on the page. Renders the real page with the portal API stubbed.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const info = (companyLocale: string, preferredLanguage: string | null = null) => ({
  customerName: "Acme",
  customerNameAr: null,
  contactPerson: null,
  companyId: "c1",
  companyName: "Al Noor Trading",
  companyLogo: null,
  preferredLanguage,
  companyLocale,
  onlinePayment: { available: false, status: "off" },
});

function stubApi(portalInfo: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const body = u.endsWith("/overview")
        ? { info: portalInfo, invoices: [] }
        : u.endsWith("/info")
          ? portalInfo
          : u.endsWith("/statement")
          ? { asOf: "2026-01-01", sections: [] }
          : [];
      return new Response(JSON.stringify(body), { status: 200 });
    })
  );
}

async function renderPortal() {
  const { default: CustomerPortal } = await import("../../client/src/pages/CustomerPortal");
  const { hook } = memoryLocation({ path: "/portal/tok123" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          Router,
          { hook },
          createElement(Route, { path: "/portal/:token", component: CustomerPortal })
        )
      )
    );
  });
  // let the info query and the locale effect settle
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 20)));
}

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(async () => {
  localStorage.clear();
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale("en"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("customer portal language", () => {
  it("opens in Arabic, right-to-left, for an Arabic company", async () => {
    stubApi(info("ar"));
    await renderPortal();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
    expect(document.documentElement.dir).toBe("rtl");
    expect(container.textContent).not.toMatch(/Customer portal/);
  });

  it("stays English for an English company and lets the viewer switch to Arabic", async () => {
    stubApi(info("en"));
    await renderPortal();
    expect(container.textContent).toMatch(/Customer portal/);
    const button = container.querySelector<HTMLButtonElement>('[data-testid="portal-language"]');
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(document.documentElement.dir).toBe("rtl");
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/Customer portal/);
  });

  it("does not override a language the viewer already chose", async () => {
    localStorage.setItem("portal-locale-chosen", "1");
    stubApi(info("ar"));
    await renderPortal();
    expect(container.textContent).toMatch(/Customer portal/);
  });
});
