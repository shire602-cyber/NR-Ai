// @vitest-environment jsdom
/**
 * The two no-login pages a customer opens from an e-mail, rendered for real with the API
 * stubbed: the customer portal (/portal/:token) and the EmaraTax approver page
 * (/portal/einvoicing-approve/:token), in English and Arabic.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
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
  vi.useRealTimers();
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
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 20, 12));
    const invoices = [{ ...INVOICES[0], date: "2026-09-21", dueDate: "2026-10-21" }, INVOICES[1]];
    handler = () => ({
      status: 200,
      body: { info: { ...INFO, companyLocale: "ar" }, invoices },
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
    const retry = byTestId("approve-retry")!;
    expect(retry.textContent).toContain("Too many attempts");
    expect(retry.querySelector("h1")!.textContent).toBe("Too many attempts");
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(document.title).toBe("Too many attempts");
    // Try again loads the page.
    handler = () => ({ status: 200, body: APPROVER });
    await act(async () => retry.querySelector("button")!.click());
    await settle();
    expect(byTestId("approve-retry")).toBeNull();
    expect(byTestId("approve-done")).not.toBeNull();
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

  /** Mounts the approver route with a real QueryClient that the test keeps hold of. */
  async function mountApprover(client: QueryClient, path: string) {
    const { default: Approve } = await import("../../client/src/pages/EInvoicingApprove");
    const { hook, navigate } = memoryLocation({ path });
    const tree = createElement(
      QueryClientProvider,
      { client },
      createElement(
        Router,
        { hook },
        createElement(
          Switch,
          null,
          createElement(Route, { path: "/portal/einvoicing-approve/:token", component: Approve })
        )
      )
    );
    await act(async () => root.render(tree));
    await settle();
    return { navigate, tree };
  }

  it("in-app navigation from a link closed by Done (410) to a valid link shows that link's own page", async () => {
    handler = (u) => {
      if (u.endsWith("/tokA/done")) return { status: 410, body: { state: "expired" } };
      return { status: 200, body: APPROVER };
    };
    stub();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { navigate } = await mountApprover(client, "/portal/einvoicing-approve/tokA");
    await act(async () => byTestId("approve-done")!.click());
    await settle();
    expect(byTestId("approve-expired")).not.toBeNull();
    expect(byTestId("approve-done")).toBeNull();

    // The route stays mounted; only the :token parameter changes.
    await act(async () => navigate("/portal/einvoicing-approve/tokB"));
    await settle();
    expect(calls).toContain("GET /api/portal/einvoicing-approve/tokB");
    expect(byTestId("approve-expired")).toBeNull();
    expect(byTestId("approve-title")!.textContent).toContain("Al Noor Trading LLC");
    expect(byTestId("approve-done")).not.toBeNull();
    // Link A's terminal result is still A's alone.
    expect(client.getQueryData(["einvoicing-approve", "tokA"])).toEqual({
      kind: "gone",
      state: "expired",
    });
    expect(client.getQueryData(["einvoicing-approve", "tokB"])).toEqual({
      kind: "ok",
      data: APPROVER,
    });
  });

  it("a reconnect GET carrying the active state that resolves after Done returns 410 cannot reopen the link", async () => {
    let releaseReconnect: () => void = () => {};
    let getCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        calls.push(`${init?.method ?? "GET"} ${u}`);
        if (u.endsWith("/done")) {
          return new Response(JSON.stringify({ state: "revoked" }), { status: 410 });
        }
        getCalls++;
        if (getCalls === 1) return new Response(JSON.stringify(APPROVER), { status: 200 });
        if (getCalls === 2) {
          // The reconnect refetch: held open, then answers with the stale active state.
          await new Promise<void>((resolve) => (releaseReconnect = resolve));
          return new Response(JSON.stringify(APPROVER), { status: 200 });
        }
        // Any later read (the remount refresh) fails, so only the cache can drive the screen.
        throw new TypeError("network down");
      })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["einvoicing-approve", "tokA"];
    const { tree } = await mountApprover(client, "/portal/einvoicing-approve/tokA");
    expect(byTestId("approve-done")).not.toBeNull();

    // Reconnect: a second GET goes in flight and stays pending.
    await act(async () => {
      void client.refetchQueries({ queryKey: key });
    });
    await settle(2);
    expect(getCalls).toBe(2);

    await act(async () => byTestId("approve-done")!.click());
    await settle();
    expect(byTestId("approve-revoked")).not.toBeNull();
    expect(byTestId("approve-done")).toBeNull();

    // The deferred reconnect answer lands after the 410.
    await act(async () => releaseReconnect());
    await settle();
    expect(client.getQueryData(key)).toEqual({ kind: "gone", state: "revoked" });
    expect(byTestId("approve-done")).toBeNull();

    // Remount: the cached terminal result is what renders, never the active page.
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(tree));
    expect(byTestId("approve-done")).toBeNull();
    // The remount refresh really fails: wait for the query's own error, not a timer.
    await vi.waitFor(() => expect(client.getQueryState(key)?.errorUpdateCount).toBeGreaterThan(0));
    await settle(2);
    expect(getCalls).toBeGreaterThanOrEqual(3);
    expect(client.getQueryState(key)?.status).toBe("error");
    expect(client.getQueryState(key)?.fetchStatus).toBe("idle");
    // Terminal screen, no retry panel, and no active page.
    expect(byTestId("approve-revoked")).not.toBeNull();
    expect(byTestId("approve-retry")).toBeNull();
    expect(byTestId("approve-done")).toBeNull();
    expect(client.getQueryData(key)).toEqual({ kind: "gone", state: "revoked" });
  });

  it("a 429 on refresh keeps the cached approver page on screen", async () => {
    let getCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        getCalls++;
        return getCalls === 1
          ? new Response(JSON.stringify(APPROVER), { status: 200 })
          : new Response("{}", { status: 429 });
      })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["einvoicing-approve", "tokA"];
    await mountApprover(client, "/portal/einvoicing-approve/tokA");
    expect(byTestId("approve-done")).not.toBeNull();
    await act(async () => {
      void client.refetchQueries({ queryKey: key });
    });
    await vi.waitFor(() => expect(client.getQueryState(key)?.errorUpdateCount).toBeGreaterThan(0));
    await settle(2);
    expect(client.getQueryState(key)?.fetchStatus).toBe("idle");
    expect(client.getQueryData(key)).toEqual({ kind: "ok", data: APPROVER });
    expect(byTestId("approve-title")!.textContent).toContain("Al Noor Trading LLC");
    expect(byTestId("approve-done")).not.toBeNull();
    // Cached content renders as is: no busy panel, no second heading, title kept.
    expect(byTestId("approve-retry")).toBeNull();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(document.title).toContain("Al Noor Trading LLC");
    expect(text()).not.toContain("Too many attempts");
  });

  it("a cached 410 stays terminal when the refresh on remount is answered 429", async () => {
    let getCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        getCalls++;
        return getCalls === 1
          ? new Response(JSON.stringify({ state: "revoked" }), { status: 410 })
          : new Response("{}", { status: 429 });
      })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["einvoicing-approve", "tokA"];
    const { tree } = await mountApprover(client, "/portal/einvoicing-approve/tokA");
    expect(byTestId("approve-revoked")).not.toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(tree));
    // Wait for the refresh to fail with the query's own error, not a timer.
    await vi.waitFor(() => expect(client.getQueryState(key)?.errorUpdateCount).toBeGreaterThan(0));
    await settle(2);
    expect(getCalls).toBe(2);
    expect(client.getQueryState(key)?.status).toBe("error");
    expect(client.getQueryState(key)?.fetchStatus).toBe("idle");
    expect(client.getQueryData(key)).toEqual({ kind: "gone", state: "revoked" });
    expect(byTestId("approve-revoked")).not.toBeNull();
    expect(byTestId("approve-retry")).toBeNull();
    expect(byTestId("approve-done")).toBeNull();
  });

  /** Runs `fn` with React Query's online manager offline, then restores it. */
  async function whileOffline(fn: () => Promise<void>) {
    const wasOnline = onlineManager.isOnline();
    onlineManager.setOnline(false);
    try {
      expect(onlineManager.isOnline()).toBe(false);
      await fn();
    } finally {
      await act(async () => onlineManager.setOnline(wasOnline));
    }
  }

  it("an offline first load shows a localized waiting state (not the skeleton or Try again) and loads on reconnect", async () => {
    handler = () => ({ status: 200, body: APPROVER });
    stub();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["einvoicing-approve", "tokA"];
    await whileOffline(async () => {
      await mountApprover(client, "/portal/einvoicing-approve/tokA");
      expect(client.getQueryState(key)?.fetchStatus).toBe("paused");
      expect(client.getQueryData(key)).toBeUndefined();
      expect(calls).toEqual([]);
      const waiting = byTestId("approve-waiting")!;
      expect(waiting.getAttribute("role")).toBe("status");
      expect(waiting.getAttribute("aria-live")).toBe("polite");
      expect(waiting.querySelector("h1")!.textContent).toBe("Waiting for your connection");
      expect(document.title).toBe("Waiting for your connection");
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
      expect(byTestId("approve-retry")).toBeNull();
      expect(byTestId("approve-done")).toBeNull();

      // Arabic copy comes from the Arabic catalog.
      const { useI18n } = await import("../../client/src/lib/i18n");
      await act(async () => useI18n.getState().setLocale("ar"));
      expect(byTestId("approve-waiting")!.querySelector("h1")!.textContent).toBe(
        "بانتظار الاتصال بالإنترنت"
      );
      await act(async () => useI18n.getState().setLocale("en"));
    });
    await settle();
    expect(calls).toEqual(["GET /api/portal/einvoicing-approve/tokA"]);
    expect(byTestId("approve-waiting")).toBeNull();
    expect(byTestId("approve-done")).not.toBeNull();
  });

  it("a paused refresh keeps showing the cached approver page, with no waiting state", async () => {
    handler = () => ({ status: 200, body: APPROVER });
    stub();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["einvoicing-approve", "tokA"];
    await mountApprover(client, "/portal/einvoicing-approve/tokA");
    expect(byTestId("approve-done")).not.toBeNull();
    await whileOffline(async () => {
      await act(async () => {
        void client.refetchQueries({ queryKey: key });
      });
      await settle(2);
      expect(client.getQueryState(key)?.fetchStatus).toBe("paused");
      expect(client.getQueryData(key)).toEqual({ kind: "ok", data: APPROVER });
      expect(byTestId("approve-waiting")).toBeNull();
      expect(byTestId("approve-retry")).toBeNull();
      expect(byTestId("approve-done")).not.toBeNull();
      expect(byTestId("approve-title")!.textContent).toContain("Al Noor Trading LLC");
    });
  });
});
