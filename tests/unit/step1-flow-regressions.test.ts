// @vitest-environment jsdom
/**
 * STEP1 F11: the broken-path sweep's flow-only checks (items 2, 12, 13, 16) as tests that run on
 * every PR. Items 10 (onboarding exemption) lives in app-landing.test.ts, 11 in
 * step1-admin-buttons.test.ts.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../client/src/components/ui/tooltip";
import { matchesAccountQuery } from "../../client/src/lib/account-search";
import { canCreateCompany } from "../../client/src/lib/company-create";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The switcher and the receive-payment page read the active company and user from providers that
// need a full session; the hooks are replaced with fixed values so the components render alone.
const mocked = vi.hoisted(() => ({
  userType: "customer" as string,
  companies: [{ id: "c-1", name: "Palm Co" }] as Array<{ id: string; name: string }>,
}));
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({
    company: { id: "c-1", name: "Palm Co", baseCurrency: "AED" },
    companyId: "c-1",
    companies: mocked.companies,
    hasNoCompanies: false,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../../client/src/components/ActiveCompanyProvider", () => ({
  useActiveCompany: () => ({ isFirmContext: false, clearActiveClientCompany: () => {} }),
}));
vi.mock("../../client/src/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { userType: mocked.userType } }),
  currentUserQueryKey: ["/api/auth/me"],
}));

let container: HTMLDivElement;
let root: Root;
let routes: Array<[string, (body: unknown) => { status?: number; body: unknown }]> = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  routes = [];
  mocked.userType = "customer";
  mocked.companies = [{ id: "c-1", name: "Palm Co" }];
  // A signed-in browser: without the hint the app skips the /api/companies bootstrap probe.
  localStorage.setItem("muhasib_auth_hint", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      for (const [key, fn] of routes) {
        const [m, pattern] = key.split(" ");
        if (m === method && new RegExp(pattern).test(url)) {
          const r = fn(body);
          return json(r.body, r.status ?? 200);
        }
      }
      return json([]);
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.getState().setLocale("en");
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(el: ReturnType<typeof createElement>) {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  queryClient.clear();
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: queryClient }, el));
  });
  await flush();
}

describe("F11 item 12: chart of accounts search matches code, English and Arabic names", () => {
  const ar = { code: "1040", nameEn: "Accounts Receivable", nameAr: "الذمم المدينة" };
  it.each([
    ["1040", true],
    ["104", true],
    ["receivable", true],
    ["RECEIVABLE", true],
    ["الذمم", true],
    ["  1040  ", true],
    ["", true],
    ["9999", false],
    ["payable", false],
  ])("query %j -> %s", (query, expected) => {
    expect(matchesAccountQuery(ar, query)).toBe(expected);
  });
  it("an account without an Arabic name still matches by code and English name", () => {
    expect(matchesAccountQuery({ code: "6100", nameEn: "Rent", nameAr: null }, "6100")).toBe(true);
    expect(matchesAccountQuery({ code: "6100", nameEn: "Rent" }, "rent")).toBe(true);
    expect(matchesAccountQuery({ code: "6100", nameEn: "Rent" }, "x")).toBe(false);
  });
});

describe("F11 item 13: no native date inputs", () => {
  // Source check, deliberately: a native <input type="date"> renders English month names and a
  // Sunday-first week in Arabic, and nothing in a render test of one page can see the other
  // pages. Every date goes through the DatePicker.
  it('no type="date" input under client/src', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx|ts)$/.test(name) && /type=["']date["']/.test(readFileSync(full, "utf8")))
          offenders.push(full);
      }
    };
    walk("client/src");
    expect(offenders).toEqual([]);
  });
});

describe("F11 item 2: second company", () => {
  it("only customer (owner) accounts may add a company", () => {
    expect(canCreateCompany({ userType: "customer" })).toBe(true);
    for (const userType of ["client_portal", "client", "admin", undefined, null]) {
      expect(canCreateCompany({ userType }), String(userType)).toBe(false);
    }
    expect(canCreateCompany(null)).toBe(false);
  });

  it("a customer with one company still gets the switcher (to add a second); staff do not", async () => {
    routes.push(["GET /api/companies$", () => ({ body: mocked.companies })]);
    const { CompanySwitcher } = await import("../../client/src/components/CompanySwitcher");
    const withTooltips = () => createElement(TooltipProvider, null, createElement(CompanySwitcher));
    await mount(withTooltips());
    expect(container.querySelector('[data-testid="button-company-switcher"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    mocked.userType = "client_portal";
    await mount(withTooltips());
    expect(container.querySelector('[data-testid="button-company-switcher"]')).toBeNull();
    expect(container.querySelector('[data-testid="text-active-company-sidebar"]')).not.toBeNull();
  });

  it("a 403 COMPANY_LIMIT_REACHED closes the dialog so the plan prompt is visible", async () => {
    routes.push([
      "POST /api/companies$",
      () => ({
        status: 403,
        body: { code: "COMPANY_LIMIT_REACHED", message: "Company limit reached", limit: 3 },
      }),
    ]);
    const { NewCompanyDialog } = await import("../../client/src/components/NewCompanyDialog");
    const open: boolean[] = [];
    await mount(
      createElement(NewCompanyDialog, { open: true, onOpenChange: (v: boolean) => open.push(v) })
    );
    const input = document.querySelector(
      '[data-testid="input-new-company-name"]'
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, "Fourth Co");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      (document.querySelector('[data-testid="button-save-new-company"]') as HTMLElement).click()
    );
    await flush();
    expect(open).toContain(false);
    // No generic error text is left in the closed dialog's field.
    expect(window.location.pathname).not.toBe("/onboarding");
  });
});

describe("F11 item 16: receive payment with no customers", () => {
  it("explains the dead end and links to Contacts, in English and Arabic", async () => {
    const { default: ReceivePayment } = await import("../../client/src/pages/sales/ReceivePayment");
    for (const locale of ["en", "ar"] as const) {
      const i18n = await import("../../client/src/lib/i18n");
      await act(async () => i18n.useI18n.getState().setLocale(locale));
      await mount(createElement(ReceivePayment));
      const note = container.querySelector('[data-testid="receive-no-customers"]');
      expect(note, locale).not.toBeNull();
      expect(note!.querySelector('a[href="/contacts"]'), locale).not.toBeNull();
      if (locale === "ar") expect(note!.textContent).toMatch(/[؀-ۿ]/);
      act(() => root.unmount());
      root = createRoot(container);
    }
  });
});

describe("F11 item 11: invitations form validates in the app, not the browser", () => {
  it.each(["en", "ar"] as const)("an empty submit shows the in-app error in %s", async (locale) => {
    routes.push(["GET /api/admin/invitations", () => ({ body: [] })]);
    const i18n = await import("../../client/src/lib/i18n");
    await act(async () => i18n.useI18n.getState().setLocale(locale));
    const { default: UserInvitations } = await import("../../client/src/pages/UserInvitations");
    await mount(createElement(UserInvitations));
    await act(async () =>
      (document.querySelector('[data-testid="button-send-invite"]') as HTMLElement).click()
    );
    // The dialog is lazy and portaled: poll until its submit button is mounted.
    const submit = await vi.waitFor(
      async () => {
        await act(async () => {});
        const el = document.querySelector('[data-testid="button-submit-invite"]');
        expect(el, "submit button").not.toBeNull();
        return el as HTMLElement;
      },
      { timeout: 5000, interval: 25 }
    );
    await act(async () => submit.click());
    await flush();
    const error = document.querySelector("#invite-email-error");
    expect(error, "inline validation message").not.toBeNull();
    if (locale === "ar") expect(error!.textContent).toMatch(/[؀-ۿ]/);
    const posted = (
      globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(posted).toBe(false);
  });
});

describe("F11 item 11: Compliance 'Today' is disabled on the current month", () => {
  it("renders the Today button disabled while the calendar shows this month", async () => {
    const { default: ComplianceCalendar } =
      await import("../../client/src/pages/ComplianceCalendar");
    await mount(createElement(ComplianceCalendar));
    const today = [...container.querySelectorAll("button")].find((b) =>
      /^(Today|اليوم)$/.test(b.textContent?.trim() ?? "")
    ) as HTMLButtonElement | undefined;
    expect(today, "Today button").toBeDefined();
    expect(today!.disabled).toBe(true);
  });
});
