// @vitest-environment jsdom
/**
 * STEP5 product fixes, rendered: the portal navigation (no nested anchors, icons, one h1), the
 * invoice search field (no `dir=auto` that flips the logical padding), the bulk invite result when
 * no email provider is configured, the access sheet with a pending invitation, the join page note
 * and touch targets, and the prefetch on portal sign-in.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "cd".repeat(32);

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public body?: Record<string, unknown>,
      public rawMessage: string = message
    ) {
      super(message);
    }
  }
  return { ApiError, apiRequest: vi.fn() };
});

vi.mock("../../client/src/lib/queryClient", () => ({
  ApiError: mocks.ApiError,
  apiRequest: mocks.apiRequest,
  queryClient: new (class {})(),
}));
vi.mock("../../client/src/lib/authSession", () => ({
  establishAuthenticatedSession: vi.fn(async () => ({})),
}));
vi.mock("../../client/src/hooks/useSessionActions", () => ({
  useSessionActions: () => ({ signOut: vi.fn(async () => undefined) }),
}));
vi.mock("../../client/src/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ can: () => true, gate: () => ({}) }),
}));

import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { PortalLayout } from "../../client/src/components/layout/PortalLayout";
import { PortalInvoiceList } from "../../client/src/components/portal/PortalInvoiceList";
import { BulkPortalInviteDialog } from "../../client/src/components/portal/BulkPortalInviteDialog";
import { PortalAccessSheet } from "../../client/src/components/portal/PortalAccessSheet";
import PortalJoin from "../../client/src/pages/portal/PortalJoin";
import { prefetchPortalData } from "../../client/src/lib/portal-prefetch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(node: React.ReactElement, client?: QueryClient) {
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, node));
  });
  await flush();
  return qc;
}

const byId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as any).scrollIntoView ??= () => {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
});

beforeEach(() => {
  mocks.apiRequest.mockReset();
  window.sessionStorage.clear();
  document.documentElement.dir = "ltr";
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
});

for (const locale of ["en", "ar"] as const) {
  describe(`STEP5 portal product (${locale})`, () => {
    beforeEach(() => {
      useI18n.setState({ locale });
      document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    });

    it("[S5-P1] the portal navigation has one real anchor per item, an icon each, and no h1 in the top bar", async () => {
      window.history.replaceState(null, "", "/client-portal/invoices");
      mocks.apiRequest.mockImplementation(async (_m: string, url: string) =>
        url.endsWith("/company")
          ? { name: "Gulf Horizon Logistics LLC", logoUrl: null, firmName: null }
          : url.endsWith("/accounts")
            ? [
                {
                  id: "a1",
                  company: { id: "c1", name: "Gulf Horizon Logistics LLC", logoUrl: null },
                  customer: { id: "k1", name: "Buyer", nameAr: null },
                },
                {
                  id: "a2",
                  company: { id: "c2", name: "Second Supplier", logoUrl: null },
                  customer: { id: "k2", name: "Buyer", nameAr: null },
                },
              ]
            : []
      );
      await mount(createElement(PortalLayout, null, createElement("div", null, "body")));
      const navs = [...container.querySelectorAll("nav")];
      expect(navs).toHaveLength(2);
      for (const nav of navs) {
        const anchors = [...nav.querySelectorAll("a")];
        expect(anchors).toHaveLength(6);
        for (const a of anchors) {
          expect(a.querySelector("a")).toBeNull(); // never nested
          expect(a.parentElement?.closest("a")).toBeNull();
          expect(a.querySelector("svg")).toBeTruthy(); // the icon renders inside the link
          expect(a.textContent?.trim().length).toBeGreaterThan(0);
        }
        expect(nav.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
        expect(nav.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe(
          "/client-portal/invoices"
        );
      }
      // The phone pills are separate flex items: each keeps its own width.
      const pills = [...navs[1].querySelectorAll("a")];
      for (const a of pills) expect(a.className).toMatch(/shrink-0/);
      // The top bar is not a heading (each page owns the single h1).
      expect(container.querySelectorAll("h1")).toHaveLength(0);
      // Several suppliers: the supplier name is not repeated in the phone title; the switcher has it.
      const phoneName = container.querySelector("header p span.truncate");
      expect(phoneName?.className).toContain("hidden");
      expect(phoneName?.className).not.toContain("md:hidden");
      expect(byId("portal-supplier-switcher")?.textContent).toContain("Gulf Horizon");
    });

    it("[S5-P3] the invoice search field has no dir=auto, so its logical padding stays on the icon side", async () => {
      await mount(
        createElement(PortalInvoiceList, { invoices: [], loading: false, onlinePayment: false })
      );
      const input = byId("portal-invoice-search") as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.hasAttribute("dir")).toBe(false);
      expect(input.className).toContain("ps-9");
      const icon = input.parentElement!.querySelector("svg")!;
      expect(icon.getAttribute("class")).toContain("start-3");
    });

    it("[S5-P4] bulk invite with no email provider says so and offers each link, copy all and CSV", async () => {
      const contacts = [
        { id: "k1", name: "Al Noor Trading LLC", email: "a@alnoor.test" },
        { id: "k2", name: "Desert Rose", email: "b@rose.test" },
      ];
      mocks.apiRequest.mockImplementation(async (method: string) =>
        method === "POST"
          ? {
              results: [
                {
                  contactId: "k1",
                  outcome: "invited",
                  delivery: "link",
                  inviteUrl: `https://app.test/portal/join#t=${TOKEN}`,
                },
                {
                  contactId: "k2",
                  outcome: "invited",
                  delivery: "link",
                  inviteUrl: `https://app.test/portal/join#t=${"ef".repeat(32)}`,
                },
              ],
            }
          : null
      );
      await mount(
        createElement(BulkPortalInviteDialog, {
          open: true,
          onOpenChange: () => {},
          companyId: "c1",
          contacts,
          summary: {},
        })
      );
      // The help text never promises an email when none is configured.
      const dialog = document.querySelector('[data-testid="bulk-portal-dialog"]')!;
      expect(dialog.textContent).toContain(useI18n.getState().locale === "ar" ? "وإلا" : "If not");
      const send = document.querySelector('[data-testid="bulk-send"]') as HTMLButtonElement;
      await act(async () => {
        send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await flush();
      const panel = document.querySelector('[data-testid="bulk-links-panel"]');
      expect(panel).toBeTruthy();
      expect(panel!.textContent).toContain(
        locale === "ar" ? "البريد الإلكتروني غير مُعدّ" : "Email is not set up"
      );
      expect(document.querySelector('[data-testid="bulk-copy-all"]')).toBeTruthy();
      expect(document.querySelector('[data-testid="bulk-export-links"]')).toBeTruthy();
      expect(document.querySelector('[data-testid="bulk-copy-k1"]')).toBeTruthy();
      expect(document.querySelector('[data-testid="bulk-copy-k2"]')).toBeTruthy();
    });

    it("[S5-P8] the access sheet does not prefill an email that already has a pending invitation", async () => {
      mocks.apiRequest.mockImplementation(async () => null);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(["/api/companies/c1/customer-contacts/k1/portal-access"], {
        contact: { id: "k1", email: "pending@alnoor.test" },
        people: [],
        invitations: [
          {
            id: "i1",
            email: "Pending@AlNoor.test",
            status: "pending",
            expiresAt: "2026-12-01T10:00:00Z",
            lastSentAt: null,
            resendIn: 0,
            language: "en",
          },
        ],
      });
      await mount(
        createElement(PortalAccessSheet, {
          open: true,
          onOpenChange: () => {},
          companyId: "c1",
          supplierName: "Gulf Horizon Logistics LLC",
          contact: { id: "k1", name: "Gulf Horizon Logistics LLC", email: "pending@alnoor.test" },
          onManageLinks: () => {},
        }),
        client
      );
      const email = document.querySelector('[data-testid="pa-email"]') as HTMLInputElement;
      expect(email.value).toBe("");
      expect(document.querySelector('[data-testid="pa-invite-i1"]')).toBeTruthy();
      expect(document.querySelector('[data-testid="pa-email-pending"]')).toBeNull();
      // The contact's name is isolated for mixed-direction text (no bare "LLC." wrapping).
      const desc = document.querySelector('[data-testid="portal-access-sheet"] bdi');
      expect(desc?.textContent).toBe("Gulf Horizon Logistics LLC");
      // The awkward possessive is gone from the sheet copy.
      expect(document.body.textContent).not.toContain("LLC's");
    });
  });
}

describe("STEP5 portal join page product fixes", () => {
  beforeEach(() => {
    useI18n.setState({ locale: "en" });
    window.history.replaceState(null, "", `/portal/join#t=${TOKEN}`);
  });

  const invite = (note: string | null) => ({
    status: "pending",
    supplier: { name: "Desert Rose", logoUrl: null, contactEmail: null },
    customerName: "Al Noor",
    customerNameAr: null,
    email: "layla@alnoor.test",
    name: "Layla",
    language: "en",
    note,
    expiresAt: "2026-12-01T10:00:00Z",
    account: "new",
    signedInAs: null,
    onlinePayment: { available: false },
  });

  it("[S5-P12] shows the personal note as plain text, never markup", async () => {
    mocks.apiRequest.mockResolvedValue(
      invite("Welcome <img src=x onerror=alert(1)>\nhttps://evil.test")
    );
    await mount(createElement(PortalJoin));
    const note = byId("join-note")!;
    expect(note).toBeTruthy();
    expect(note.textContent).toContain("Desert Rose");
    expect(note.querySelector("img")).toBeNull();
    expect(note.querySelector("a")).toBeNull();
    expect(note.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(note.querySelector("blockquote")!.getAttribute("dir")).toBe("auto");
  });

  it("[S5-P12] no note, no block", async () => {
    mocks.apiRequest.mockResolvedValue(invite(null));
    await mount(createElement(PortalJoin));
    expect(byId("join-note")).toBeNull();
  });

  it("[S5-P10] the language toggle and the terms row are 44px touch targets", async () => {
    mocks.apiRequest.mockResolvedValue(invite(null));
    await mount(createElement(PortalJoin));
    for (const l of ["en", "ar"]) expect(byId(`join-lang-${l}`)!.className).toContain("min-h-11");
    const terms = byId("join-terms")!;
    const row = terms.closest("label")!;
    expect(row).toBeTruthy();
    expect(row.className).toContain("min-h-11");
    expect(row.getAttribute("for")).toBe("join-terms");
  });
});

describe("STEP5 portal prefetch", () => {
  it("[S5-P13] warms the dashboard, invoices, documents, company and accounts under the pages' keys", async () => {
    mocks.apiRequest.mockImplementation(async (_m: string, url: string) => ({ url }));
    const qc = new QueryClient();
    prefetchPortalData(qc);
    await flush();
    const paths = mocks.apiRequest.mock.calls.map((c) => c[1]).sort();
    expect(paths).toEqual(
      [
        "/api/client-portal/accounts",
        "/api/client-portal/company",
        "/api/client-portal/dashboard",
        "/api/client-portal/documents",
        "/api/client-portal/invoices",
      ].sort()
    );
    expect(qc.getQueryData(["portal-dashboard"])).toEqual({ url: "/api/client-portal/dashboard" });
    expect(qc.getQueryData(["portal-invoices"])).toEqual({ url: "/api/client-portal/invoices" });
    // A failing prefetch never throws; the page fetches again itself.
    mocks.apiRequest.mockRejectedValue(new Error("down"));
    expect(() => prefetchPortalData(new QueryClient())).not.toThrow();
    await flush();
  });
});
