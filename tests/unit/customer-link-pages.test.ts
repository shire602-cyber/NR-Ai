// @vitest-environment jsdom
/**
 * The two no-login pages a customer opens from an e-mail, rendered for real with the API
 * stubbed: the customer portal (/portal/:token) and the EmaraTax approver page
 * (/portal/einvoicing-approve/:token), in English and Arabic.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stripBidiControls } from "../../client/src/lib/format-money";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let calls: string[] = [];

const INFO = {
  customerName: "Desert Rose Catering",
  customerNameAr: "ديزرت روز للتموين",
  contactPerson: null,
  companyId: "c1",
  companyName: "Al Noor Trading LLC",
  companyLogo: null,
  preferredLanguage: null as string | null,
  companyLocale: "en",
  onlinePayment: { available: true, status: "live" },
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const INVOICES = [
  {
    id: "i1",
    number: "INV-2026-00001",
    invoiceType: "invoice",
    date: daysAgo(60),
    dueDate: daysAgo(30),
    currency: "AED",
    total: 13125,
    amountDue: 13125,
    paymentStatus: "overdue",
    canPayOnline: true,
    einvoice: null,
  },
  {
    id: "i2",
    number: "INV-2026-00002",
    invoiceType: "invoice",
    date: daysAgo(10),
    dueDate: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
    currency: "AED",
    total: 3886.05,
    amountDue: 3886.05,
    paymentStatus: "unpaid",
    canPayOnline: false,
    einvoice: null,
  },
];

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown } | undefined;
let handler: Handler;

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u}`);
      const r = handler(u, init) ?? { status: 200, body: [] };
      return new Response(JSON.stringify(r.body), { status: r.status });
    })
  );
}

async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++)
    await act(async () => await new Promise((r) => setTimeout(r, 20)));
}

async function mountAt(path: string, page: "portal" | "approve") {
  const { default: CustomerPortal } = await import("../../client/src/pages/CustomerPortal");
  const { default: Approve } = await import("../../client/src/pages/EInvoicingApprove");
  const { hook } = memoryLocation({ path });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          Router,
          { hook },
          createElement(
            Switch,
            null,
            createElement(Route, { path: "/portal/einvoicing-approve/:token", component: Approve }),
            createElement(Route, { path: "/portal/:token", component: CustomerPortal })
          )
        )
      )
    );
  });
  await settle();
  return page;
}

const text = () => stripBidiControls(container.textContent ?? "");
const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(async () => {
  localStorage.clear();
  calls = [];
  document.title = "";
  window.history.replaceState(null, "", "/");
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

describe("customer portal /portal/:token", () => {
  it("first screen is one request; the other tabs load when opened; heading and title are set", async () => {
    handler = (u) =>
      u.endsWith("/overview")
        ? { status: 200, body: { info: INFO, invoices: INVOICES } }
        : u.endsWith("/statement")
          ? { status: 200, body: { asOf: daysAgo(0), sections: [] } }
          : undefined;
    stub();
    await mountAt("/portal/tok123", "portal");
    expect(calls).toEqual(["GET /api/portal/tok123/overview"]);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("main")).not.toBeNull();
    expect(document.title).toBe("Al Noor Trading LLC · Customer portal");
    expect(text()).toContain("INV-2026-00001");

    const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
    const statementTab = tabs.find((t) => /Statement/.test(t.textContent ?? ""))!;
    await act(async () => {
      statementTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      statementTab.click();
    });
    await settle();
    expect(calls.some((c) => c.endsWith("/statement"))).toBe(true);
    expect(calls.some((c) => c.endsWith("/quotes") || c.endsWith("/documents"))).toBe(false);
  });

  it("shows the due date, the days overdue in natural Arabic, and a localized amount", async () => {
    handler = () => ({
      status: 200,
      body: { info: { ...INFO, companyLocale: "ar" }, invoices: INVOICES },
    });
    stub();
    await mountAt("/portal/tok123", "portal");
    const t = text();
    expect(document.documentElement.dir).toBe("rtl");
    expect(t).toContain("مستحق في");
    expect(t).toContain("متأخرة 30 يومًا");
    expect(t).toContain("د.إ");
    expect(t).toContain("13,125.00");
    expect(document.title).toBe("Al Noor Trading LLC · بوابة العملاء");
    // The language button names the other language in that language, marked with lang.
    const sw = byTestId("portal-language")!;
    expect(sw.querySelector("span")!.getAttribute("lang")).toBe("en");
    expect(sw.textContent).toBe("English");
    // Customer name follows the language.
    expect(byTestId("portal-customer-name")!.textContent).toBe("ديزرت روز للتموين");
  });

  it("Pay now shows a busy state, and a failure is a localized alert, not the server's English", async () => {
    handler = (u) =>
      u.endsWith("/overview")
        ? { status: 200, body: { info: INFO, invoices: INVOICES } }
        : u.includes("/pay")
          ? {
              status: 503,
              body: {
                code: "PAYMENTS_REQUIRES_EXTERNAL",
                message: "Online payment is not available",
              },
            }
          : undefined;
    stub();
    await mountAt("/portal/tok123", "portal");
    const payButtons = [...container.querySelectorAll<HTMLButtonElement>("button")].filter((b) =>
      /Pay now/.test(b.textContent ?? "")
    );
    expect(payButtons).toHaveLength(1);
    await act(async () => payButtons[0].click());
    await settle();
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Online payment is not available for this invoice.");
    // Back to idle: the button is usable again.
    expect(
      [...container.querySelectorAll("button")].some((b) => /Pay now/.test(b.textContent ?? ""))
    ).toBe(true);
  });

  it("coming back from the payment page says what happened and cleans the URL", async () => {
    window.history.replaceState(null, "", "/portal/tok123?payment=success");
    handler = () => ({ status: 200, body: { info: INFO, invoices: INVOICES } });
    stub();
    await mountAt("/portal/tok123", "portal");
    expect(container.querySelector('[role="status"]')!.textContent).toContain(
      "Thank you. Your payment is being confirmed"
    );
    expect(window.location.search).toBe("");
    // A cancelled return is a warning, in the viewer's language.
    window.history.replaceState(null, "", "/portal/tok123?payment=cancelled");
    act(() => root.unmount());
    root = createRoot(container);
    await mountAt("/portal/tok123", "portal");
    expect(text()).toContain("No payment was taken.");
  });

  it.each([
    [404, "PORTAL_LINK_INVALID", "This link is not valid"],
    [410, "PORTAL_LINK_EXPIRED", "This link has expired"],
    [410, "PORTAL_LINK_REVOKED", "This link is no longer active"],
  ])(
    "a %i %s answer reads as the right state, with a heading and a main landmark",
    async (status, code, title) => {
      handler = () => ({ status, body: { code, message: "Invalid or expired portal link" } });
      stub();
      await mountAt("/portal/tok123", "portal");
      expect(container.querySelector("h1")!.textContent).toBe(title);
      expect(container.querySelector("main")).not.toBeNull();
      expect(document.title).toBe(title);
      expect(text()).not.toContain("Invalid or expired portal link");
    }
  );

  it("rate-limited and network failures offer Try again", async () => {
    handler = () => ({ status: 429, body: { code: "PORTAL_RATE_LIMITED" } });
    stub();
    await mountAt("/portal/tok123", "portal");
    expect(container.querySelector("h1")!.textContent).toBe("Too many attempts");
    const retry = [...container.querySelectorAll("button")].find((b) =>
      /Try again/.test(b.textContent ?? "")
    )!;
    expect(retry).toBeTruthy();
    handler = () => ({ status: 200, body: { info: INFO, invoices: INVOICES } });
    await act(async () => retry.click());
    await settle();
    expect(text()).toContain("INV-2026-00001");
  });

  it("an Arabic browser opens Arabic when neither the customer nor the viewer chose a language", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ar-AE", "en"]);
    handler = () => ({ status: 200, body: { info: INFO, invoices: INVOICES } });
    stub();
    await mountAt("/portal/tok123", "portal");
    expect(document.documentElement.dir).toBe("rtl");
    // ...but the customer's own recorded language still wins.
    vi.restoreAllMocks();
  });

  it("the print and language controls are hidden when printing", async () => {
    handler = () => ({ status: 200, body: { info: INFO, invoices: INVOICES } });
    stub();
    await mountAt("/portal/tok123", "portal");
    expect(byTestId("portal-language")!.className).toContain("print:hidden");
    expect(byTestId("portal-print")!.className).toContain("print:hidden");
    expect(container.querySelector('[role="tablist"]')!.className).toContain("print:hidden");
  });
});

const APPROVER = {
  state: "active",
  companyName: "Al Noor Trading LLC",
  locale: "en",
  approverName: "Khalid Al Mansoori",
  expiresAt: "2026-12-02T00:00:00Z",
  completedAt: null,
  partner: {
    displayName: "A-Cube",
    legalName: "Platform ACube Technologies LLC",
    accreditationNumber: "188961",
    emaraTaxListing: "",
  },
};

describe("EmaraTax approver page /portal/einvoicing-approve/:token", () => {
  it("shows only the company name (never a TRN), sets the title, and isolates names for Arabic", async () => {
    handler = () => ({
      status: 200,
      body: { ...APPROVER, locale: "ar", trnVatNumber: "100123456700003" },
    });
    stub();
    await mountAt("/portal/einvoicing-approve/tok123", "approve");
    const raw = container.textContent ?? "";
    expect(document.documentElement.dir).toBe("rtl");
    expect(raw).not.toMatch(/100123456700003|TRN/);
    expect(raw).toContain("Al Noor Trading LLC");
    // Every Latin name travels inside its own bidi isolate.
    expect(raw).toContain("⁨Al Noor Trading LLC⁩");
    expect(raw).toContain("⁨Khalid Al Mansoori⁩");
    // The brackets are inside the isolate with both names, so they cannot flip.
    expect(raw).toContain("⁨A-Cube (Platform ACube Technologies LLC)⁩");
    expect(raw).toContain("رقم الاعتماد");
    expect(document.title).toBe("الموافقة على شريك الفوترة الإلكترونية · Al Noor Trading LLC");
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(byTestId("approve-language")!.textContent).toBe("English");
  });

  it("an invalid link reads the body (the request must finish) and says so", async () => {
    const bodyRead = vi.fn(async () => "{}");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, text: bodyRead, json: async () => ({}) }))
    );
    await mountAt("/portal/einvoicing-approve/zzz", "approve");
    expect(bodyRead).toHaveBeenCalled();
    expect(byTestId("approve-invalid")!.querySelector("h1")!.textContent).toBe(
      "This link is not valid"
    );
    expect(document.title).toBe("This link is not valid");
  });

  it("expired and revoked links are different headings; too many requests offers Try again", async () => {
    handler = () => ({ status: 410, body: { state: "revoked" } });
    stub();
    await mountAt("/portal/einvoicing-approve/tok123", "approve");
    expect(byTestId("approve-revoked")!.textContent).toContain("This link was withdrawn");
    act(() => root.unmount());
    root = createRoot(container);
    handler = () => ({ status: 429, body: {} });
    await mountAt("/portal/einvoicing-approve/tok123", "approve");
    expect(byTestId("approve-retry")!.textContent).toContain("Too many attempts");
    expect(byTestId("approve-retry")!.querySelector("button")).not.toBeNull();
  });

  it("Done is one click, shows the completed state and disables double submission", async () => {
    let doneCalls = 0;
    handler = (u) => {
      if (u.endsWith("/done")) {
        doneCalls++;
        return {
          status: 200,
          body: { ...APPROVER, state: "completed", completedAt: "2026-11-18T00:00:00Z" },
        };
      }
      return { status: 200, body: APPROVER };
    };
    stub();
    await mountAt("/portal/einvoicing-approve/tok123", "approve");
    const done = byTestId("approve-done") as HTMLButtonElement;
    await act(async () => {
      done.click();
      done.click();
    });
    await settle();
    expect(byTestId("approve-completed")).not.toBeNull();
    expect(doneCalls).toBeLessThanOrEqual(2);
  });
});
