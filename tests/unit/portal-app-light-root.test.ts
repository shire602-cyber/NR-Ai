// @vitest-environment jsdom
/**
 * The signed-in client portal (/client-portal/*) renders through its own light root, PortalApp,
 * not the whole accounting app: one h1 per page, a localized state when the PDF download fails,
 * the app handed over for anyone who is not a portal client, and only the catalogs the portal
 * reads are loaded for it.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isPortalAppPath, namespacesForPath, setPublicBootScope } from "../../client/src/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The full app is a different root; a marker is enough to see that the hand-over happened.
vi.mock("../../client/src/App", () => ({
  default: () => createElement("div", { "data-testid": "full-app" }, "full app"),
}));

let container: HTMLDivElement;
let root: Root;
let calls: string[] = [];
let me: { status: number; body: unknown } = { status: 200, body: {} };
let pdfStatus = 200;

const INVOICES = [
  {
    id: "i1",
    number: "INV-2026-00001",
    date: "2026-10-01",
    dueDate: "2026-10-31",
    currency: "AED",
    total: 13125,
    amountDue: 13125,
    paymentStatus: "overdue",
  },
];

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (u.includes("/api/auth/me")) return json(me.status, me.body);
      if (u.includes("/api/client-portal/company"))
        return json(200, {
          id: "c1",
          name: "Al Noor Trading LLC",
          logoUrl: null,
          firmName: null,
          customer: { id: "k1", name: "Desert Rose", nameAr: "ديزرت روز" },
        });
      if (u.includes("/api/client-portal/dashboard"))
        return json(200, {
          invoices: { total: 1, outstanding: 1, outstandingTotal: 13125, overdue: 1, paid: 0 },
          documents: { total: 0 },
          recentInvoices: INVOICES,
        });
      if (u.includes("/pdf")) return pdfStatus === 200 ? new Response("%PDF") : json(pdfStatus, {});
      if (u.includes("/api/client-portal/invoices")) return json(200, INVOICES);
      if (u.includes("/api/client-portal/documents")) return json(200, []);
      if (u.includes("/api/client-portal/messages")) return json(200, []);
      return json(200, []);
    })
  );
}

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++)
    await act(async () => await new Promise((r) => setTimeout(r, 25)));
}

async function mountAt(path: string) {
  window.history.replaceState(null, "", path);
  const { default: PortalApp } = await import("../../client/src/PortalApp");
  await act(async () => {
    root.render(createElement(PortalApp));
  });
  await settle();
}

const text = () => container.textContent ?? "";

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem("muhasib_auth_hint", "1");
  calls = [];
  pdfStatus = 200;
  me = { status: 200, body: { id: "u1", email: "c@example.com", userType: "client_portal" } };
  const { useI18n } = await import("../../client/src/lib/i18n");
  const { queryClient } = await import("../../client/src/lib/queryClient");
  queryClient.clear();
  act(() => useI18n.getState().setLocale("en"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  stub();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("client portal light root", () => {
  it("renders the dashboard with exactly one h1 and the stacked-card table", async () => {
    await mountAt("/client-portal/dashboard");
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")!.textContent).toBe("Overview");
    expect(text()).toContain("INV-2026-00001");
    expect(container.querySelector("table.row-cards")).not.toBeNull();
    // The tab is named after the page and the company, not the marketing default.
    expect(document.title).toBe("Dashboard · Al Noor Trading LLC");
    expect(container.querySelector('[data-testid="full-app"]')).toBeNull();
  });

  it("empty pages put their title under the page h1 as an h2 (no skipped level)", async () => {
    await mountAt("/client-portal/documents");
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h3")).toBeNull();
    expect(container.querySelector("h2")!.textContent).toMatch(/No documents/i);
  });

  it("mirrors in Arabic and keeps Arabic copy", async () => {
    const { useI18n } = await import("../../client/src/lib/i18n");
    act(() => useI18n.getState().setLocale("ar"));
    await mountAt("/client-portal/invoices");
    expect(document.documentElement.dir).toBe("rtl");
    expect(text()).toContain("د.إ");
    expect(text()).not.toMatch(/Invoice number|Download PDF/);
  });

  it("a failed PDF download is a localized toast, not silence", async () => {
    pdfStatus = 500;
    const { useI18n } = await import("../../client/src/lib/i18n");
    act(() => useI18n.getState().setLocale("ar"));
    await mountAt("/client-portal/invoices");
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
    const dl = buttons.find((b) => /PDF/.test(b.getAttribute("aria-label") ?? b.textContent ?? ""));
    expect(dl).toBeTruthy();
    await act(async () => dl!.click());
    await settle();
    expect(document.body.textContent).toContain("تعذّر تنزيل ملف PDF");
  });

  it("hands the page to the full app for a signed-out visitor and for staff", async () => {
    me = { status: 401, body: {} };
    // refresh endpoint also refuses
    await mountAt("/client-portal/dashboard");
    expect(container.querySelector('[data-testid="full-app"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    me = { status: 200, body: { id: "u2", userType: "customer", isAdmin: false } };
    const { queryClient } = await import("../../client/src/lib/queryClient");
    queryClient.clear();
    await mountAt("/client-portal/dashboard");
    expect(container.querySelector('[data-testid="full-app"]')).not.toBeNull();
  });
});

describe("portal route scoping", () => {
  it("only the five portal pages use the light root and the portal catalogs", () => {
    for (const p of ["dashboard", "invoices", "documents", "statements", "messages"])
      expect(isPortalAppPath(`/client-portal/${p}`)).toBe(true);
    expect(isPortalAppPath("/client-portal/unknown")).toBe(false);
    expect(isPortalAppPath("/client-portal")).toBe(false);
    expect(namespacesForPath("/client-portal/invoices")).toEqual(
      expect.arrayContaining(["portal", "shell", "components", "toasts"])
    );
    // Not the whole app: report, firm and admin catalogs stay out.
    expect(namespacesForPath("/client-portal/invoices")).not.toContain("reportCenter");
    expect(namespacesForPath("/client-portal/invoices")!.length).toBeLessThan(10);
    setPublicBootScope("/client-portal/invoices");
  });

  it("sign-in and recovery forms skip the help, legal and invoice catalogs", () => {
    for (const p of ["/login", "/forgot-password", "/reset-password"]) {
      const ns = namespacesForPath(p)!;
      expect(ns).toEqual(expect.arrayContaining(["marketing", "components", "shell", "security"]));
      expect(ns).not.toContain("banking");
      expect(ns).not.toContain("invoices");
    }
    // Registration is a different workstream: its catalogs are unchanged.
    expect(namespacesForPath("/register")).toContain("banking");
  });
});
