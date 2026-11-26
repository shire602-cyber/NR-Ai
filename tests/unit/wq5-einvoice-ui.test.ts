// @vitest-environment jsdom
/**
 * WQ5 client behaviour: the first-invoice e-invoice details prompt (shown once, only the
 * missing fields), the partner card (both partners offered, no default, verify only when the
 * chosen partner is connected, "confirmed by you, not yet verified"), the no-login approver page
 * (no TRN, Done), the firm console cell and the contact form body (en and ar).
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stripBidiControls } from "../../client/src/lib/format-money";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c-1", company: { id: "c-1" }, isLoading: false }),
}));
vi.mock("@/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ can: () => true, gate: () => ({}) }),
}));
vi.mock("wouter", async (orig) => ({
  ...(await orig<typeof import("wouter")>()),
  useParams: () => ({ token: "tok_" + "a".repeat(40) }),
}));

let container: HTMLDivElement;
let root: Root;
let calls: Array<{ method: string; url: string; body: unknown }> = [];
let routes: Record<string, (body: unknown) => { status?: number; body: unknown }> = {};

const IDENTITY = {
  legalName: null,
  legalNameAr: null,
  displayName: "Pearl Trading",
  einvoiceTin: null,
  effectiveTin: null,
  tinSuggestion: "1001234567",
  tinSource: "ct_trn",
  sellerIdType: null,
  sellerIdNumber: null,
  sellerIdCountry: null,
  tradeLicenceAuthority: null,
  sellerLegalId: { type: "TL", number: "CN-1" },
  addressStreet: "Office 1",
  addressDistrict: null,
  addressCity: "Dubai",
  addressPoBox: null,
  addressAr: null,
  emirate: null,
  missing: ["tin", "emirate"],
};

const PARTNERS = {
  partners: [
    {
      id: "p-one",
      displayName: "Partner One",
      legalName: "Partner One LLC",
      accreditationNumber: "111",
      website: "",
      emaraTaxListing: "",
      live: false,
    },
    {
      id: "p-two",
      displayName: "Partner Two",
      legalName: "Partner Two LLC",
      accreditationNumber: "222",
      website: "",
      emaraTaxListing: "",
      live: false,
    },
  ],
  chosen: null as string | null,
  liveProvider: null,
  verifyAvailable: false,
  appointment: { state: "not_started", confirmedAt: null, legalEntityStatus: null },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  // jsdom has no ResizeObserver (Radix checkbox inside a form measures itself).
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      for (const [key, fn] of Object.entries(routes)) {
        const [m, path] = key.split(" ");
        if (m === method && url.includes(path)) {
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
  for (let i = 0; i < 8; i++) {
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

async function setLocale(locale: "en" | "ar") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  await act(async () => useI18n.getState().setLocale(locale));
}

describe("tax-ready prompt", () => {
  it("decides to open only when the server says so and fields are missing", async () => {
    const { shouldOpenTaxReady } =
      await import("../../client/src/components/einvoice/use-tax-ready-prompt");
    expect(shouldOpenTaxReady(undefined)).toBe(false);
    expect(shouldOpenTaxReady({ show: true, missing: ["tin"] } as never)).toBe(true);
    expect(shouldOpenTaxReady({ show: false, missing: ["tin"] } as never)).toBe(false);
    expect(shouldOpenTaxReady({ show: true, missing: [] } as never)).toBe(false);
  });

  async function renderPrompt() {
    const { TaxReadyModal } = await import("../../client/src/components/einvoice/TaxReadyModal");
    const { useTaxReadyPrompt } =
      await import("../../client/src/components/einvoice/use-tax-ready-prompt");

    function Editor() {
      const p = useTaxReadyPrompt("c-1", { enabled: true });
      return createElement(TaxReadyModal, p.modalProps);
    }
    await mount(createElement(Editor));
  }

  it("asks only for the missing fields, prefilled from the CT TRN, and Later marks it shown", async () => {
    routes["GET /einvoicing/tax-ready"] = () => ({
      body: { show: true, missing: ["tin", "emirate"], promptedAt: null, identity: IDENTITY },
    });
    routes["POST /einvoicing/tax-ready/shown"] = () => ({
      body: { show: false, missing: ["tin", "emirate"], promptedAt: "x", identity: IDENTITY },
    });
    await renderPrompt();
    const modal = document.querySelector('[data-testid="tax-ready-modal"]');
    expect(modal).not.toBeNull();
    expect(modal!.textContent).toContain("Add your e-invoice details");
    expect((document.querySelector('[data-testid="tax-id-tin"]') as HTMLInputElement).value).toBe(
      "1001234567"
    );
    expect(document.querySelector('[data-testid="tax-id-emirate"]')).not.toBeNull();
    // Not asked: things that are already there.
    expect(document.querySelector('[data-testid="tax-id-street"]')).toBeNull();
    expect(document.querySelector('[data-testid="tax-id-type"]')).toBeNull();
    expect(document.querySelector('[data-testid="tax-id-legal-name-ar"]')).toBeNull();

    await act(async () => {
      (document.querySelector('[data-testid="tax-ready-later"]') as HTMLButtonElement).click();
    });
    await flush();
    expect(calls.some((c) => c.method === "POST" && c.url.includes("tax-ready/shown"))).toBe(true);
    expect(document.querySelector('[data-testid="tax-ready-modal"]')).toBeNull();
  });

  it("Save sends only the asked fields", async () => {
    routes["GET /einvoicing/tax-ready"] = () => ({
      body: { show: true, missing: ["tin"], promptedAt: null, identity: IDENTITY },
    });
    routes["PUT /einvoicing/identity"] = () => ({ body: { ...IDENTITY, missing: [] } });
    routes["POST /einvoicing/tax-ready/shown"] = () => ({
      body: { show: false, missing: [], promptedAt: "x", identity: IDENTITY },
    });
    await renderPrompt();
    await act(async () => {
      (document.querySelector('[data-testid="tax-ready-save"]') as HTMLButtonElement).click();
    });
    await flush();
    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/einvoicing/identity"));
    expect(put?.body).toEqual({ einvoiceTin: "1001234567" });
  });

  it("keeps the TIN when typed with Arabic digits and saves it in ASCII", async () => {
    await setLocale("ar");
    routes["GET /einvoicing/tax-ready"] = () => ({
      body: { show: true, missing: ["tin"], identity: { ...IDENTITY, tinSuggestion: null } },
    });
    routes["PUT /einvoicing/identity"] = () => ({ body: { ...IDENTITY, missing: [] } });
    await renderPrompt();
    const input = document.querySelector<HTMLInputElement>('[data-testid="tax-id-tin"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, "١٠٠١٢٣٤٥٦٧");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("1001234567");

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="tax-ready-save"]')!.click();
    });
    await flush();
    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/einvoicing/identity"));
    expect(put?.body).toEqual({ einvoiceTin: "1001234567" });
  });

  it("does not open when nothing is missing, and reads in Arabic", async () => {
    routes["GET /einvoicing/tax-ready"] = () => ({
      body: { show: false, missing: [], promptedAt: null, identity: IDENTITY },
    });
    await renderPrompt();
    expect(document.querySelector('[data-testid="tax-ready-modal"]')).toBeNull();

    await setLocale("ar");
    routes["GET /einvoicing/tax-ready"] = () => ({
      body: { show: true, missing: ["emirate"], promptedAt: null, identity: IDENTITY },
    });
    await renderPrompt();
    const text = document.querySelector('[data-testid="tax-ready-modal"]')!.textContent ?? "";
    expect(text).toContain("أضف بيانات الفاتورة الإلكترونية");
    expect(text).not.toMatch(/Add your e-invoice details|Later|Save details/);
  });
});

describe("partner card", () => {
  async function renderCard() {
    const { EInvoicePartnerCard } =
      await import("../../client/src/components/einvoice/EInvoicePartnerCard");
    await mount(createElement(EInvoicePartnerCard, { companyId: "c-1", companyName: "Pearl" }));
  }

  it("offers both partners, picks none by default, and says not connected", async () => {
    routes["GET /einvoicing/partner"] = () => ({ body: PARTNERS });
    routes["GET /einvoicing/identity"] = () => ({ body: IDENTITY });
    await renderCard();
    const one = container.querySelector('[data-testid="einvoice-partner-option-p-one"]')!;
    const two = container.querySelector('[data-testid="einvoice-partner-option-p-two"]')!;
    expect(one.getAttribute("aria-checked")).toBe("false");
    expect(two.getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).toContain("Not connected");
    expect(container.querySelector('[data-testid="partner-step-verify"]')).toBeNull();
    // INTEGRATE-I: a partner's legal name is a proper name, kept out of translation (and out of
    // the Arabic runtime crawl's English-line count).
    const legal = [...one.querySelectorAll("p")].find((p) => p.textContent === "Partner One LLC");
    expect(legal?.getAttribute("translate")).toBe("no");

    routes["PUT /einvoicing/partner"] = (b) => ({
      body: { ...PARTNERS, chosen: (b as { partner: string }).partner },
    });
    await act(async () => (two as HTMLButtonElement).click());
    await flush();
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ partner: "p-two" });
    expect(container.querySelector('[data-testid="partner-verify"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="partner-verify-unavailable"]')!.textContent
    ).toContain("Partner Two is not connected");
    // No provider route was called.
    expect(calls.some((c) => c.url.includes("/sync"))).toBe(false);
  });

  it("shows 'Confirmed by you, not yet verified' and the verify step only when live", async () => {
    routes["GET /einvoicing/partner"] = () => ({
      body: {
        ...PARTNERS,
        chosen: "p-one",
        appointment: {
          state: "self_confirmed",
          confirmedAt: "2026-11-18T00:00:00Z",
          legalEntityStatus: null,
        },
      },
    });
    routes["GET /einvoicing/identity"] = () => ({ body: IDENTITY });
    await renderCard();
    expect(container.querySelector('[data-testid="einvoice-appointment-state"]')!.textContent).toBe(
      "Confirmed by you, not yet verified"
    );

    routes["GET /einvoicing/partner"] = () => ({
      body: {
        ...PARTNERS,
        partners: PARTNERS.partners.map((p) => ({ ...p, live: p.id === "p-one" })),
        chosen: "p-one",
        liveProvider: "p-one",
        verifyAvailable: true,
      },
    });
    await renderCard();
    expect(container.querySelector('[data-testid="partner-verify"]')).not.toBeNull();
  });

  it("someone else approves: creates a link and shows it once", async () => {
    routes["GET /einvoicing/partner"] = () => ({ body: { ...PARTNERS, chosen: "p-one" } });
    routes["GET /einvoicing/identity"] = () => ({ body: IDENTITY });
    routes["POST /einvoicing/approver-links"] = () => ({
      status: 201,
      body: {
        id: "l1",
        state: "active",
        expiresAt: "2026-12-02T00:00:00Z",
        url: "https://app.example/portal/einvoicing-approve/abc",
        emailQueued: false,
      },
    });
    await renderCard();
    await act(async () =>
      (container.querySelector('[data-testid="appoint-someone"]') as HTMLButtonElement).click()
    );
    await act(async () =>
      (container.querySelector('[data-testid="approver-link-create"]') as HTMLButtonElement).click()
    );
    await flush();
    const shown = container.querySelector(
      '[data-testid="approver-link-created"] input'
    ) as HTMLInputElement;
    expect(shown.value).toBe("https://app.example/portal/einvoicing-approve/abc");
  });
});

describe("no-login approver page", () => {
  it("shows the company name and steps, no TRN, and Done records it", async () => {
    routes["GET /api/portal/einvoicing-approve/"] = () => ({
      body: {
        state: "active",
        companyName: "Pearl Trading",
        approverName: "Huda",
        expiresAt: "2026-12-02T00:00:00Z",
        completedAt: null,
        partner: {
          displayName: "Partner One",
          legalName: "Partner One LLC",
          accreditationNumber: "111",
          emaraTaxListing: "",
        },
      },
    });
    routes["POST /done"] = () => ({
      body: {
        state: "completed",
        companyName: "Pearl Trading",
        approverName: "Huda",
        expiresAt: "2026-12-02T00:00:00Z",
        completedAt: "2026-11-18T00:00:00Z",
        partner: null,
      },
    });
    const { default: Page } = await import("../../client/src/pages/EInvoicingApprove");
    await mount(createElement(Page));
    // Names are bidi-isolated (FSI/PDI) so they keep their direction inside Arabic text.
    const text = stripBidiControls(container.textContent ?? "");
    expect(text).toContain("Approve the e-invoicing partner for Pearl Trading");
    expect(text).toContain("Partner One");
    expect(container.querySelectorAll('[data-testid="emaratax-steps"] li').length).toBe(5);
    await act(async () =>
      (container.querySelector('[data-testid="approve-done"]') as HTMLButtonElement).click()
    );
    await flush();
    expect(container.querySelector('[data-testid="approve-completed"]')).not.toBeNull();
  });

  it("Done on a link that expired meanwhile shows the expired state, not a retry error", async () => {
    let expired = false;
    routes["GET /api/portal/einvoicing-approve/"] = () =>
      expired
        ? { status: 410, body: { state: "expired" } }
        : {
            body: {
              state: "active",
              companyName: "Pearl Trading",
              approverName: null,
              expiresAt: "2026-12-02T00:00:00Z",
              completedAt: null,
              partner: null,
            },
          };
    routes["POST /done"] = () => {
      expired = true;
      return { status: 410, body: { state: "expired" } };
    };
    const { default: Page } = await import("../../client/src/pages/EInvoicingApprove");
    await mount(createElement(Page));
    await act(async () =>
      (container.querySelector('[data-testid="approve-done"]') as HTMLButtonElement).click()
    );
    await flush();
    expect(container.querySelector('[data-testid="approve-expired"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="approve-done"]')).toBeNull();
  });

  it.each([
    ["expired", "LINK_EXPIRED", "This link has expired"],
    ["revoked", "LINK_REVOKED", "This link was withdrawn"],
  ] as const)(
    "Done applies the %s response immediately when a follow-up read fails",
    async (state, code, heading) => {
      let reads = 0;
      routes["GET /api/portal/einvoicing-approve/"] = () => {
        reads += 1;
        if (reads > 1) return { status: 500, body: { message: "unavailable" } };
        return {
          body: {
            state: "active",
            companyName: "Pearl Trading",
            approverName: null,
            expiresAt: "2026-12-02T00:00:00Z",
            completedAt: null,
            partner: null,
          },
        };
      };
      routes["POST /done"] = () => ({ status: 410, body: { code, state } });
      const { default: Page } = await import("../../client/src/pages/EInvoicingApprove");
      await mount(createElement(Page));
      await act(async () =>
        (container.querySelector('[data-testid="approve-done"]') as HTMLButtonElement).click()
      );
      await flush();
      expect(container.querySelector(`[data-testid="approve-${state}"]`)?.textContent).toContain(
        heading
      );
      expect(container.querySelector('[data-testid="approve-done"]')).toBeNull();
      expect(container.querySelector('[data-testid="approve-retry"]')).toBeNull();
      expect(container.textContent).not.toContain("We could not record that");
      expect(reads).toBe(1);
    }
  );

  it("an expired link says so (Arabic)", async () => {
    await setLocale("ar");
    routes["GET /api/portal/einvoicing-approve/"] = () => ({
      status: 410,
      body: { state: "expired" },
    });
    const { default: Page } = await import("../../client/src/pages/EInvoicingApprove");
    await mount(createElement(Page));
    expect(container.querySelector('[data-testid="approve-expired"]')!.textContent).toContain(
      "انتهت صلاحية هذا الرابط"
    );
  });
});

describe("firm cell and contact form body", () => {
  it("labels each e-invoicing state", async () => {
    const { FirmEInvoicingCell } =
      await import("../../client/src/components/einvoice/FirmEInvoicingCell");
    await mount(
      createElement(FirmEInvoicingCell, {
        value: { state: "identity_missing", missing: 2, partner: null },
      })
    );
    expect(container.textContent).toBe("2 details missing");
    await mount(createElement(FirmEInvoicingCell, { value: null }));
    expect(container.textContent).toBe("—");
  });

  it("sends role, typed registrations, the VAT TRN and a legacy address line", async () => {
    const { contactBodyFromForm } =
      await import("../../client/src/components/contacts/contact-form-model");
    const body = contactBodyFromForm({
      name: "Gulf Hosting",
      nameAr: "",
      email: "a@b.c",
      phone: "",
      address: "",
      addressStreet: "Street 4",
      addressBuilding: "Tower B",
      addressDistrict: "DIC",
      postalCode: "",
      city: "Dubai",
      country: "AE",
      emirate: "dubai",
      paymentTerms: 30,
      isCustomer: false,
      isSupplier: true,
      partyType: "business",
      freeZone: true,
      legalIdType: "PAS",
      legalId: "N1234567",
      legalIdCountry: "IN",
      registrations: [
        { type: "ct", number: "100765432100003" },
        { type: "vat", number: " 100765432100003 " },
        { type: "excise", number: "" },
      ],
      defaultRevenueAccountId: "r1",
      defaultExpenseAccountId: "e1",
      defaultVatTreatment: "",
      defaultCostCenterId: "",
    });
    expect(body).toMatchObject({
      trnNumber: "100765432100003",
      taxRegistrations: [
        { type: "ct", number: "100765432100003" },
        { type: "vat", number: "100765432100003" },
      ],
      address: "Street 4, Tower B, DIC",
      isSupplier: true,
      isCustomer: false,
      legalIdCountry: "IN",
      // A supplier-only contact keeps no revenue default.
      defaultRevenueAccountId: null,
      defaultExpenseAccountId: "e1",
    });
  });
});
