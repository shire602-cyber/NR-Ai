// @vitest-environment jsdom
/**
 * STEP5 re-audit (R5-n), rendered: honest "not sent" states in the access sheet and the contact
 * chip, the removed-access page (names the supplier, no dead nav, offers the chooser and sign
 * out), the resend countdown, the bilingual preview direction, the phone invoice due date, the
 * single overdue icon and the 44px phone row checkbox.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  const apiRequest = vi.fn();
  const portalQuery = (path: string, selection: string | null = null) => ({
    queryKey: [path.replace(/^\/api\/client-portal\//, "portal-"), selection] as const,
    queryFn: () => apiRequest("GET", path),
  });
  return { ApiError, apiRequest, portalQuery, signOut: vi.fn(async () => undefined) };
});

vi.mock("../../client/src/lib/queryClient", () => ({
  ApiError: mocks.ApiError,
  apiRequest: mocks.apiRequest,
  portalQuery: mocks.portalQuery,
  queryClient: new (class {})(),
}));
vi.mock("../../client/src/hooks/useSessionActions", () => ({
  useSessionActions: () => ({ signOut: mocks.signOut }),
}));
vi.mock("../../client/src/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ can: () => true, gate: () => ({}) }),
}));

import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { PortalLayout } from "../../client/src/components/layout/PortalLayout";
import { PortalInvoiceList } from "../../client/src/components/portal/PortalInvoiceList";
import { PortalAccessSheet } from "../../client/src/components/portal/PortalAccessSheet";
import { PortalStatusChip } from "../../client/src/components/portal/PortalStatusChip";
import { PortalAccountScope } from "../../client/src/lib/portal-scope";
import { setSelectedPortalAccount } from "../../client/src/lib/portal-state";

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

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

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
  mocks.signOut.mockClear();
  window.localStorage.clear();
  document.documentElement.dir = "ltr";
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
});

const PENDING = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  email: "buyer@alnoor.test",
  status: "pending",
  expiresAt: "2026-12-01T10:00:00Z",
  lastSentAt: null,
  resendIn: 0,
  language: "en",
  emailSent: false,
  ...over,
});

function sheetClient(invitations: unknown[], configured: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["/api/companies/c1/customer-contacts/k1/portal-access"], {
    contact: { id: "k1", email: null },
    people: [],
    invitations,
  });
  client.setQueryData(["/api/companies", "c1", "email-outbox", "status"], { configured });
  return client;
}

const sheet = (client: QueryClient) =>
  mount(
    createElement(PortalAccessSheet, {
      open: true,
      onOpenChange: () => {},
      companyId: "c1",
      supplierName: "Gulf Horizon Logistics LLC",
      contact: { id: "k1", name: "Gulf Horizon Logistics LLC", email: null },
      onManageLinks: () => {},
    }),
    client
  );

for (const locale of ["en", "ar"] as const) {
  describe(`STEP5 re-audit UI (${locale})`, () => {
    beforeEach(() => {
      useI18n.setState({ locale });
      document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    });

    it("[R5-2] with no email provider the sheet warns once and the invitation reads Not sent, never Invited", async () => {
      await sheet(sheetClient([PENDING()], false));
      const banner = byId("pa-email-off");
      expect(banner).toBeTruthy();
      expect(banner!.textContent).toContain(
        locale === "ar" ? "البريد الإلكتروني غير مُعدّ" : "Email is not set up"
      );
      const card = byId("pa-invite-i1")!;
      expect(byId("pa-notsent-i1")?.textContent).toBe(locale === "ar" ? "لم تُرسل" : "Not sent");
      expect(card.textContent).not.toContain(locale === "ar" ? "مدعو" : "Invited");
    });

    it("[R5-2] a sent invitation keeps the Invited badge and shows no warning", async () => {
      await sheet(sheetClient([PENDING({ emailSent: true })], true));
      expect(byId("pa-email-off")).toBeNull();
      expect(byId("pa-notsent-i1")).toBeNull();
      expect(byId("pa-invite-i1")!.textContent).toContain(locale === "ar" ? "مدعو" : "Invited");
    });

    it("[R5-2] the contact chip says the invitation was not sent", async () => {
      await mount(
        createElement(PortalStatusChip, {
          contactId: "k1",
          entry: { active: 0, state: "invited", expiresAt: "2026-12-01T10:00:00Z", notSent: true },
        })
      );
      const chip = byId("portal-chip-k1")!;
      expect(chip.textContent).toBe(locale === "ar" ? "لم تُرسل الدعوة" : "Invite not sent");
      expect(chip.textContent).not.toMatch(/until|حتى/);
    });

    it("[R5-10] the resend countdown reads minutes:seconds, not 61s", async () => {
      await sheet(sheetClient([PENDING({ resendIn: 61, emailSent: true })], true));
      const resend = byId("pa-resend-i1")!;
      expect(resend.textContent).toContain("1:01");
      expect(resend.textContent).not.toMatch(/61/);
    });

    it("[R5-10] the English line of the bilingual preview keeps its own direction and alignment", async () => {
      await sheet(sheetClient([], true));
      await act(async () => {
        byId("pa-lang-bilingual")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      const en = byId("pa-preview-en")!;
      expect(en.getAttribute("dir")).toBe("ltr");
      expect(en.className).toContain("text-start");
      expect(byId("pa-preview-ar")!.getAttribute("dir")).toBe("rtl");
    });

    it("[R5-7] the removed page names the supplier, hides the dead nav and offers the chooser and sign out", async () => {
      window.history.replaceState(null, "", "/client-portal/dashboard");
      mocks.apiRequest.mockImplementation(async (_m: string, url: string) => {
        if (url.endsWith("/accounts")) {
          return [
            {
              id: "a2",
              company: { id: "c2", name: "Second Supplier", logoUrl: null },
              customer: { id: "k2", name: "Buyer", nameAr: null },
            },
          ];
        }
        throw new mocks.ApiError("removed", 403, {
          code: "PORTAL_ACCESS_REVOKED",
          supplierName: "Gulf Horizon Logistics LLC",
        });
      });
      await mount(createElement(PortalLayout, null, createElement("div", null, "body")));
      const removed = byId("portal-access-removed")!;
      expect(removed).toBeTruthy();
      expect(removed.textContent).toContain("Gulf Horizon Logistics LLC");
      expect(removed.textContent).toContain(locale === "ar" ? "اختر مورّدًا" : "Choose a supplier");
      // No navigation that leads nowhere, no generic "My company" header.
      expect(container.querySelectorAll("nav")).toHaveLength(0);
      expect(container.textContent).not.toContain(locale === "ar" ? "شركتي" : "My company");
      // The chooser and sign out are both there.
      const buttons = [...removed.querySelectorAll("button")].map((b) => b.textContent?.trim());
      expect(buttons).toContain("Second Supplier");
      expect(buttons.length).toBe(2);
    });

    it("[R5-7] with no other supplier the removed page says so and offers sign out only", async () => {
      window.history.replaceState(null, "", "/client-portal/dashboard");
      mocks.apiRequest.mockImplementation(async (_m: string, url: string) => {
        if (url.endsWith("/accounts")) return [];
        throw new mocks.ApiError("removed", 403, {
          code: "PORTAL_ACCESS_REVOKED",
          supplierName: "Gulf Horizon Logistics LLC",
        });
      });
      await mount(createElement(PortalLayout, null, createElement("div", null, "body")));
      const removed = byId("portal-access-removed")!;
      expect(removed.textContent).toContain("Gulf Horizon Logistics LLC");
      expect(removed.textContent).toContain(
        locale === "ar" ? "أُزيل وصولك" : "Your access was removed"
      );
      expect(removed.querySelectorAll("button")).toHaveLength(1);
      expect(container.querySelectorAll("nav")).toHaveLength(0);
    });

    it("[R5-10] a phone invoice card carries the due date next to the issue date", async () => {
      await mount(
        createElement(
          PortalAccountScope.Provider,
          { value: "a1" },
          createElement(PortalInvoiceList, {
            invoices: [
              {
                id: "i1",
                number: "INV-1",
                date: "2026-10-01",
                dueDate: "2026-10-31",
                currency: "AED",
                total: 100,
                amountDue: 100,
                paymentStatus: "unpaid",
              },
              {
                id: "c1",
                number: "CN-1",
                date: "2026-10-02",
                dueDate: null,
                currency: "AED",
                total: -50,
                amountDue: 0,
                paymentStatus: "credit",
              },
            ] as never,
            loading: false,
            onlinePayment: false,
          })
        )
      );
      // Invoice: issue date + due date. Credit note: issue date only (no empty "—" cell on a phone).
      const metas = [...container.querySelectorAll('td[data-cell="meta"]')];
      expect(metas).toHaveLength(3);
      expect(metas[1].textContent).toContain(locale === "ar" ? "الاستحقاق" : "Due");
      expect(metas[1].hasAttribute("data-keep")).toBe(true);
    });
  });
}

describe("STEP5 re-audit UI (R5-7 selection)", () => {
  it("remembers the removed supplier's name once the chooser takes over the selection", async () => {
    const { clearRevokedPortalSelection, getRemovedPortalSupplier } =
      await import("../../client/src/lib/portal-state");
    setSelectedPortalAccount("a1");
    clearRevokedPortalSelection("a1", "Gulf Horizon Logistics LLC");
    expect(getRemovedPortalSupplier()).toBe("Gulf Horizon Logistics LLC");
    setSelectedPortalAccount("a2");
    expect(getRemovedPortalSupplier()).toBeNull();
  });
});

describe("STEP5 re-audit UI (R5-6)", () => {
  // Source inspection on purpose: rendering the 1,500-line Contacts page needs a dozen query
  // fixtures; the real tap-target size is measured by the Playwright matrix (select-contact-*).
  it("the phone row checkbox sits in a 44px label that targets it", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("client/src/pages/CustomerContacts.tsx", "utf8");
    const label =
      /<label\s+htmlFor=\{`select-contact-\$\{contact\.id\}`\}[^>]*className="([^"]*)"/.exec(src);
    expect(label?.[1]).toContain("h-11");
    expect(label?.[1]).toContain("w-11");
    expect(src).toContain("id={`select-contact-${contact.id}`}");
  });
});
