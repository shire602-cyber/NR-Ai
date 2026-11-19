// @vitest-environment jsdom
/**
 * Sign-in and recovery forms are phone and password-manager friendly: the e-mail field is the
 * saved "username", the keyboard is the e-mail one, nothing is auto-capitalised or spell-checked,
 * addresses stay left-to-right in Arabic, and the new-password fields say so.
 * Also: the install banner (and framer-motion with it) is not downloaded until the browser offers
 * an install, and the due-amount box keeps readable currency text.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++)
    await act(async () => await new Promise((r) => setTimeout(r, 20)));
}

async function mount(path: string, loader: () => Promise<{ default: React.ComponentType }>) {
  const { default: Page } = await loader();
  const { hook } = memoryLocation({ path });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Router, { hook }, createElement(Page))
      )
    );
  });
  await settle();
}

const input = (testId: string) =>
  container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!;

beforeAll(async () => {
  await import("../../client/src/lib/zod-config");
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            String(url).includes("security/config") ? { captcha: { status: "off" } } : {}
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    )
  );
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

describe("sign-in form", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`e-mail is the username, password is current-password (${locale})`, async () => {
      const { useI18n } = await import("../../client/src/lib/i18n");
      act(() => useI18n.getState().setLocale(locale));
      await mount("/login", () => import("../../client/src/pages/Login"));
      const email = input("input-email");
      expect(email.type).toBe("email");
      expect(email.getAttribute("autocomplete")).toBe("username");
      expect(email.getAttribute("inputmode")).toBe("email");
      expect(email.getAttribute("autocapitalize")).toBe("none");
      expect(email.getAttribute("spellcheck")).toBe("false");
      expect(email.getAttribute("dir")).toBe("ltr");
      expect(email.name).toBe("email");
      const pw = input("input-password");
      expect(pw.type).toBe("password");
      expect(pw.getAttribute("autocomplete")).toBe("current-password");
      expect(pw.name).toBe("password");
      // Every field has a label, and the page has one h1.
      for (const el of [email, pw])
        expect(container.querySelector(`label[for="${el.id}"]`)).not.toBeNull();
      expect(container.querySelectorAll("h1")).toHaveLength(1);
    });
  }
});

describe("forgot and reset password", () => {
  it("forgot-password e-mail field: e-mail keyboard, no capitalisation, left-to-right", async () => {
    await mount("/forgot-password", () => import("../../client/src/pages/ForgotPassword"));
    const email = input("input-email");
    expect(email.getAttribute("autocomplete")).toBe("email");
    expect(email.getAttribute("inputmode")).toBe("email");
    expect(email.getAttribute("autocapitalize")).toBe("none");
    expect(email.getAttribute("dir")).toBe("ltr");
  });

  it("reset-password fields are new-password with a go key on the last one", async () => {
    window.history.replaceState(null, "", "/reset-password?token=" + "a".repeat(40));
    await mount("/reset-password", () => import("../../client/src/pages/ResetPassword"));
    const a = input("input-password");
    const b = input("input-confirm-password");
    expect(a.getAttribute("autocomplete")).toBe("new-password");
    expect(b.getAttribute("autocomplete")).toBe("new-password");
    expect(b.getAttribute("enterkeyhint")).toBe("go");
    expect(a.disabled).toBe(false);
    window.history.replaceState(null, "", "/");
  });
});

describe("due amount box", () => {
  it("the currency code inherits the box colour (white on green), not the muted grey", async () => {
    const { LedgerTotals } = await import("../../client/src/components/documents/LedgerSheet");
    const { Money } = await import("../../client/src/components/ui/money");
    await act(async () => {
      root.render(
        createElement(LedgerTotals, {
          rows: [],
          due: {
            label: "Amount due",
            value: createElement(Money, { amount: 3886.05 }),
            testId: "due",
          },
        })
      );
    });
    const dd = container.querySelector('[data-testid="due"]')!;
    expect(dd.querySelector(".money-currency")).not.toBeNull();
    // jsdom does not apply Tailwind, so the contract is the utility on the box: the axe
    // colour-contrast check in tests/e2e/auth-portal-flow.mjs measures the rendered result.
    expect(dd.className).toContain("[&_.money-currency]:text-inherit");
  });
});

describe("empty state heading level", () => {
  it("defaults to h3 and can be h2 under a page h1", async () => {
    const { EmptyState } = await import("../../client/src/components/ui/empty-state");
    await act(async () => {
      root.render(createElement(EmptyState, { title: "Nothing", description: "x" }));
    });
    expect(container.querySelector("h3")?.textContent).toBe("Nothing");
    await act(async () => {
      root.render(createElement(EmptyState, { title: "Nothing", headingLevel: "h2" }));
    });
    expect(container.querySelector("h2")?.textContent).toBe("Nothing");
    expect(container.querySelector("h3")).toBeNull();
  });
});

describe("install banner", () => {
  it("downloads nothing until the browser offers an install", async () => {
    let loads = 0;
    vi.resetModules();
    vi.doMock("../../client/src/components/PWAInstallPrompt", () => {
      loads += 1;
      return { PWAInstallPrompt: () => createElement("div", { "data-testid": "install-banner" }) };
    });
    // The page has loaded; no `beforeinstallprompt` yet.
    Object.defineProperty(document, "readyState", { value: "complete", configurable: true });
    const pwa = await import("../../client/src/lib/pwa");
    const { DeferredInstallPrompt } =
      await import("../../client/src/components/DeferredInstallPrompt");
    pwa.setupInstallPrompt();
    await act(async () => {
      root.render(createElement(DeferredInstallPrompt));
    });
    await settle();
    expect(loads).toBe(0);
    expect(container.querySelector('[data-testid="install-banner"]')).toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event("beforeinstallprompt"));
    });
    await settle();
    expect(loads).toBe(1);
    expect(container.querySelector('[data-testid="install-banner"]')).not.toBeNull();
    vi.doUnmock("../../client/src/components/PWAInstallPrompt");
  });
});
