// @vitest-environment jsdom
/**
 * /view/invoice/:token rendered for real with the API stubbed: the light no-login invoice page
 * (title, landmarks, localized invalid/expired/busy states by HTTP status, language from the
 * customer or company, Pay only with a gateway) and the contact form's language field.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stripBidiControls } from "../../client/src/lib/format-money";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const PAYLOAD = {
  onlinePayment: { available: false, status: "off", provider: null },
  einvoice: null,
  preferredLanguage: null as string | null,
  companyLocale: "en",
  invoice: {
    number: "INV-2026-00007",
    customerName: "Desert Rose Catering",
    customerTrn: null,
    date: "2026-10-01",
    currency: "AED",
    subtotal: 1000,
    vatAmount: 50,
    total: 1050,
    status: "sent",
    invoiceType: "invoice",
    isTaxInvoice: true,
    dueDate: "2026-11-01",
    amountPaid: 0,
    amountDue: 1050,
    paymentStatus: "unpaid",
  },
  lines: [
    { description: "Retainer", quantity: 1, unitPrice: 1000, vatRate: 0.05, vatSupplyType: null },
  ],
  company: {
    name: "Al Noor Trading LLC",
    trnVatNumber: "100123456700003",
    businessAddress: null,
    contactPhone: null,
    contactEmail: null,
    websiteUrl: null,
    logoUrl: null,
  },
};

async function mount(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  );
  const { default: Page } = await import("../../client/src/pages/PublicInvoiceView");
  const { hook } = memoryLocation({ path: "/view/invoice/abc" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          Router,
          { hook },
          createElement(Route, { path: "/view/invoice/:token", component: Page })
        )
      )
    );
  });
  for (let i = 0; i < 6; i++) await act(async () => await new Promise((r) => setTimeout(r, 20)));
}

const text = () => stripBidiControls(container.textContent ?? "");

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(async () => {
  localStorage.clear();
  document.title = "";
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

describe("public invoice page", () => {
  it("renders one h1 and one main, sets the title, hides Pay without a gateway, offers the PDF as a link", async () => {
    await mount(200, PAYLOAD);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(document.title).toBe("Invoice INV-2026-00007 · Al Noor Trading LLC");
    expect(container.querySelector('[data-testid="public-invoice-pay-now"]')).toBeNull();
    const dl = container.querySelector<HTMLAnchorElement>(
      '[data-testid="public-invoice-download"]'
    )!;
    expect(dl.tagName).toBe("A");
    expect(dl.getAttribute("href")).toBe("/api/public/invoices/abc/pdf");
    expect(dl.className).toContain("min-h-11");
  });

  it("shows Pay when a gateway is live", async () => {
    await mount(200, {
      ...PAYLOAD,
      onlinePayment: { available: true, status: "live", provider: "stripe" },
    });
    expect(container.querySelector('[data-testid="public-invoice-pay-now"]')).not.toBeNull();
  });

  it("opens in the customer's language, else the company's", async () => {
    await mount(200, { ...PAYLOAD, preferredLanguage: "ar" });
    expect(document.documentElement.dir).toBe("rtl");
    expect(text()).toContain("فاتورة ضريبية");
    expect(document.title).toBe("فاتورة INV-2026-00007 · Al Noor Trading LLC");
    expect(text()).not.toMatch(/Subtotal|Download/);
  });

  it("an Arabic company's invoice opens in Arabic when the customer has no preference", async () => {
    await mount(200, { ...PAYLOAD, companyLocale: "ar" });
    expect(document.documentElement.dir).toBe("rtl");
  });

  it.each([
    [404, "This link is not valid"],
    [410, "This link has expired"],
    [429, "Too many attempts"],
    [500, "We could not load this page"],
  ])("HTTP %i shows its own localized state (not the server's text)", async (status, title) => {
    await mount(status, { message: "Invoice not found or link is invalid" });
    expect(container.querySelector("h1")!.textContent).toBe(title);
    expect(container.querySelector("main")).not.toBeNull();
    expect(document.title).toBe(title);
    expect(text()).not.toContain("Invoice not found");
  });

  it("the invalid-link state is Arabic when the browser is Arabic", async () => {
    const lang = vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["ar-AE"]);
    await mount(404, {});
    lang.mockRestore();
    expect(document.documentElement.dir).toBe("rtl");
    expect(container.querySelector("h1")!.textContent).toBe("هذا الرابط غير صالح");
  });
});

describe("contact form language", () => {
  it("sends the preferred language, or null for the company default", async () => {
    const { contactBodyFromForm } =
      await import("../../client/src/components/contacts/contact-form-model");
    const base = {
      name: "A",
      nameAr: "",
      email: "",
      phone: "",
      address: "",
      addressStreet: "",
      addressBuilding: "",
      addressDistrict: "",
      postalCode: "",
      city: "",
      country: "AE",
      emirate: "",
      paymentTerms: 30,
      isCustomer: true,
      isSupplier: false,
      partyType: "business" as const,
      freeZone: false,
      legalIdType: "" as const,
      legalId: "",
      legalIdCountry: "",
      registrations: [],
      defaultRevenueAccountId: "",
      defaultExpenseAccountId: "",
      defaultVatTreatment: "",
      defaultCostCenterId: "",
    };
    expect(contactBodyFromForm({ ...base, preferredLanguage: "ar" }).preferredLanguage).toBe("ar");
    expect(contactBodyFromForm({ ...base, preferredLanguage: "en" }).preferredLanguage).toBe("en");
    expect(contactBodyFromForm({ ...base, preferredLanguage: "" }).preferredLanguage).toBeNull();
  });
});
