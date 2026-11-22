// @vitest-environment jsdom
/**
 * WQ1 (sales documents finished): behaviour of the invoice editor (due date from terms, live
 * Checks tab and Finalise, leave guard, notes / language / cost centre in the payload), the
 * row actions that open the recurring and credit-note editors seeded from the invoice, the
 * source filter, Receive payment's auto apply, and the pure rules behind them.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_ID,
  apiCalls,
  byTestId,
  click,
  flush,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  pickOption,
  renderPage,
  resetHarness,
  setFixtures,
  submit,
  type,
  unmountPage,
} from "./helpers/form-harness";
import { act } from "react";
import { loadLocale } from "../../client/src/lib/i18n";
import {
  autoApplyOldestFirst,
  daysFromTerms,
  dueDateFromTerms,
  termsFromDays,
} from "../../shared/sales-documents";
import {
  blockingCount,
  einvoiceChecks,
  invoiceFormChecks,
} from "../../client/src/lib/invoice-checks";
import { emailStatusKey } from "../../client/src/lib/invoice-documents";

vi.mock("../../client/src/lib/queryClient", () => formHarnessQueryClientMock());
vi.mock("../../client/src/hooks/useDefaultCompany", () => formHarnessCompanyMock());
vi.mock("../../client/src/hooks/useSubscription", () => ({
  useSubscription: () => ({
    subscription: null,
    usage: null,
    limits: null,
    tierName: "enterprise",
    isFreeTier: false,
    canAccess: () => true,
    getRequiredTier: () => "starter",
    isLoading: false,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const C = `/api/companies/${COMPANY_ID}`;
const CONTACT = {
  id: "d0000000-0000-4000-8000-000000000001",
  name: "Gulf Retail LLC",
  trnNumber: "100123456700003",
  emirate: "dubai",
  paymentTerms: 15,
  email: "ap@gulfretail.example",
};
const INVOICE = {
  id: "e0000000-0000-4000-8000-000000000001",
  companyId: COMPANY_ID,
  number: "INV-2026-00007",
  customerName: "Gulf Retail LLC",
  customerTrn: "100123456700003",
  contactId: CONTACT.id,
  placeOfSupplyEmirate: "dubai",
  paymentTerms: "net15",
  date: "2026-03-01",
  dueDate: "2026-03-16",
  currency: "AED",
  status: "sent",
  invoiceType: "invoice",
  total: 1260,
  lines: [
    {
      description: "Consulting",
      quantity: 2,
      unitPrice: 500,
      vatRate: 0.05,
      vatSupplyType: "standard_rated",
    },
    {
      description: "Training (exempt)",
      quantity: 1,
      unitPrice: 200,
      vatRate: 0,
      vatSupplyType: "exempt",
    },
  ],
};

beforeAll(async () => {
  await loadLocale("en");
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as any).scrollIntoView ??= () => {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
  (Element.prototype as any).releasePointerCapture ??= () => {};
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as any;
});
beforeEach(() => {
  resetHarness();
  window.history.replaceState({}, "", "/");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-15T09:00:00Z"));
});
afterEach(async () => {
  await unmountPage();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});

const bodyOf = (method: string, url: string) => {
  const c = apiCalls(method).filter((x) => x.url === url);
  return JSON.parse(JSON.stringify(c[c.length - 1]?.body ?? null));
};

describe("WQ1 pure rules", () => {
  it("due date from terms (7.2b)", () => {
    expect(termsFromDays(0)).toBe("due_on_receipt");
    expect(termsFromDays(15)).toBe("net15");
    expect(termsFromDays(null)).toBeNull();
    expect(daysFromTerms("net45")).toBe(45);
    expect(dueDateFromTerms("2026-03-15", "net15")).toBe("2026-03-30");
    expect(dueDateFromTerms("2026-03-15", "due_on_receipt")).toBe("2026-03-15");
    expect(dueDateFromTerms("2026-12-20", "net30")).toBe("2027-01-19");
    expect(dueDateFromTerms("2026-03-15", "custom")).toBeNull();
  });

  it("auto apply pays the oldest due first and leaves the rest as credit (7.6)", () => {
    const plan = autoApplyOldestFirst(150000, [
      { id: "b", openFils: 52500, dueDate: "2026-04-01", date: "2026-03-01" },
      { id: "a", openFils: 105000, dueDate: "2026-03-10", date: "2026-02-08" },
      { id: "c", openFils: 0, dueDate: "2026-01-01" },
    ]);
    expect(plan.allocations).toEqual([
      { invoiceId: "a", amountFils: 105000 },
      { invoiceId: "b", amountFils: 45000 },
    ]);
    expect(plan.unappliedFils).toBe(0);
    expect(autoApplyOldestFirst(200000, [{ id: "a", openFils: 105000 }]).unappliedFils).toBe(95000);
  });

  it("Checks: counts each missing item and links it to its field (7.3b)", () => {
    const blank = invoiceFormChecks({
      customerName: "",
      lines: [{ description: "", quantity: 1, unitPrice: 0, vatSupplyType: "standard_rated" }],
      vatRegistered: true,
      einvoiceActive: false,
      fallbackEmirate: "dubai",
    });
    expect(blank.map((c) => [c.id, c.field])).toEqual([
      ["customer", "customerName"],
      ["line-0-description", "lines.0.description"],
      ["line-0-price", "lines.0.unitPrice"],
    ]);
    expect(blockingCount(blank)).toBe(3);
    const noTrn = invoiceFormChecks({
      customerName: "Acme",
      customerTrn: "12345",
      lines: [{ description: "Job", quantity: 1, unitPrice: 10, vatSupplyType: "standard_rated" }],
      vatRegistered: false,
      einvoiceActive: true,
      date: new Date("2026-03-15"),
      dueDate: new Date("2026-03-01"),
    });
    expect(noTrn.map((c) => [c.id, c.severity])).toEqual([
      ["customer-trn", "error"],
      ["company-trn", "error"],
      ["due-date", "error"],
    ]);
    expect(noTrn.find((c) => c.id === "company-trn")?.href).toBe("/company-profile");
    const ok = invoiceFormChecks({
      customerName: "Acme",
      lines: [{ description: "Job", quantity: 1, unitPrice: 10, vatSupplyType: "standard_rated" }],
      vatRegistered: true,
      einvoiceActive: false,
      placeOfSupplyEmirate: "dubai",
    });
    expect(ok).toEqual([]);
  });

  it("e-invoice validator findings block Finalise only while e-invoicing is active", () => {
    const issues = [
      { field: "company.trnVatNumber", message: "Seller TRN missing" },
      { field: "lines[0].description", message: "Description required" },
    ];
    const active = einvoiceChecks(issues, true);
    expect(blockingCount(active)).toBe(2);
    expect(active[0].href).toBe("/settings/company");
    expect(active[1].field).toBe("lines.0.description");
    expect(blockingCount(einvoiceChecks(issues, false))).toBe(0);
  });

  it("the sent log never calls a queued email sent (7.25)", () => {
    expect(emailStatusKey({ status: "sent", sent: true })).toBe("invoices.activity.statusSent");
    expect(emailStatusKey({ status: "blocked_no_provider", sent: false })).toBe(
      "invoices.activity.statusNoProvider"
    );
    expect(emailStatusKey({ status: "queued", sent: false })).toBe(
      "invoices.activity.statusQueued"
    );
  });
});

async function openNewInvoice() {
  const { default: Invoices } = await import("../../client/src/pages/Invoices");
  await renderPage(Invoices);
  await click(byTestId("button-create-invoice"));
  // The terms fields load with the editor (lazy chunk).
  await flushUntil(() => !!byTestId("tab-invoice-checks") && !!byTestId("input-invoice-notes"));
}

describe("WQ1 invoice editor", () => {
  it("fills the due date from the contact's terms and sends terms, notes and language", async () => {
    setFixtures({
      [`${C}/invoices?limit=50`]: { items: [], nextCursor: null },
      [`${C}/customer-contacts`]: [CONTACT],
    });
    await openNewInvoice();
    await pickOption(byTestId("select-invoice-contact"), CONTACT.name);
    await type(byTestId("input-line-description-0"), "Consulting");
    await type(byTestId("input-line-price-0"), "1000");
    await type(byTestId("input-invoice-notes"), "Pay to IBAN AE07 0331 2345 6789 0123 456");
    await pickOption(byTestId("select-document-language"), "Arabic");
    await submit(byTestId("button-submit-invoice"));
    expect(bodyOf("POST", `${C}/invoices`)).toMatchObject({
      contactId: CONTACT.id,
      paymentTerms: "net15",
      dueDate: "2026-03-30",
      notes: "Pay to IBAN AE07 0331 2345 6789 0123 456",
      documentLanguage: "ar",
    });
  });

  it("Checks (n) counts what is missing, Finalise waits for them, then saves and issues", async () => {
    setFixtures({ [`${C}/invoices?limit=50`]: { items: [], nextCursor: null } });
    await openNewInvoice();
    expect(byTestId("tab-invoice-checks")?.textContent).toBe("Checks (3)");
    expect((byTestId("button-finalise-invoice") as HTMLButtonElement).disabled).toBe(true);
    // A check links to its field.
    await act(async () => {
      byTestId("tab-invoice-checks")!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 })
      );
    });
    await flushUntil(() => !!byTestId("button-check-fix-customer"));
    await click(byTestId("button-check-fix-customer"));
    expect(document.activeElement).toBe(byTestId("input-customer-name"));

    await type(byTestId("input-customer-name"), "Harbor Design Studio");
    await type(byTestId("input-line-description-0"), "Brand workshop");
    await type(byTestId("input-line-price-0"), "800");
    await flush();
    expect(byTestId("tab-invoice-checks")?.textContent).toBe("Checks (0)");
    const finalise = byTestId("button-finalise-invoice") as HTMLButtonElement;
    expect(finalise.disabled).toBe(false);
    await submit(finalise);
    await flushUntil(() => apiCalls("PATCH").length > 0);
    expect(bodyOf("POST", `${C}/invoices`)).toMatchObject({ customerName: "Harbor Design Studio" });
    expect(apiCalls("PATCH").map((c) => [c.url, c.body])).toEqual([
      ["/api/invoices/new-id/status", { status: "sent" }],
    ]);
  });

  it("asks before leaving with unsaved changes, and leaves at once when clean", async () => {
    setFixtures({ [`${C}/invoices?limit=50`]: { items: [], nextCursor: null } });
    await openNewInvoice();
    await click(byTestId("button-cancel-invoice"));
    expect(byTestId("dialog-leave-without-saving")).toBeNull();
    expect(byTestId("dialog-invoice-form")).toBeNull();

    await click(byTestId("button-create-invoice"));
    await flushUntil(() => !!byTestId("input-customer-name"));
    await type(byTestId("input-customer-name"), "Half-typed customer");
    await flush();
    await click(byTestId("button-cancel-invoice"));
    await flushUntil(() => !!byTestId("dialog-leave-without-saving"));
    expect(byTestId("dialog-leave-without-saving")).not.toBeNull();
    await click(byTestId("button-stay-on-editor"));
    expect(byTestId("dialog-invoice-form")).not.toBeNull();
    await click(byTestId("button-cancel-invoice"));
    await flushUntil(() => !!byTestId("button-leave-without-saving"));
    await click(byTestId("button-leave-without-saving"));
    expect(byTestId("dialog-invoice-form")).toBeNull();
    expect(apiCalls("POST").filter((c) => c.url === `${C}/invoices`)).toEqual([]);
  });

  it("Save and issue on a new invoice first asks for missing e-invoice seller details (WQ5 prompt)", async () => {
    setFixtures({
      [`${C}/invoices?limit=50`]: { items: [], nextCursor: null },
      [`${C}/einvoicing/tax-ready`]: {
        show: true,
        missing: ["tin"],
        promptedAt: null,
        identity: {
          legalName: "Synthetic Trading LLC",
          displayName: "Synthetic Trading LLC",
          einvoiceTin: null,
          effectiveTin: null,
          tinSuggestion: "1000000000",
          tinSource: "ct_trn",
          sellerLegalId: { type: "TL", number: "CN-1" },
          addressStreet: "Office 1",
          addressCity: "Dubai",
          emirate: "dubai",
          missing: ["tin"],
        },
      },
    });
    await openNewInvoice();
    // Not on opening the editor: only when the user issues.
    expect(byTestId("tax-ready-modal")).toBeNull();
    await type(byTestId("input-customer-name"), "Harbor Design Studio");
    await type(byTestId("input-line-description-0"), "Brand workshop");
    await type(byTestId("input-line-price-0"), "800");
    await flush();
    await click(byTestId("button-finalise-invoice"));
    await flushUntil(() => !!byTestId("tax-ready-modal"));
    expect(byTestId("tax-ready-modal")).not.toBeNull();
    expect(apiCalls("POST").filter((c) => c.url === `${C}/invoices`)).toEqual([]);
    // "Later" records it and the issue goes on.
    await click(byTestId("tax-ready-later"));
    await flushUntil(() => apiCalls("PATCH").length > 0);
    expect(apiCalls("PATCH").map((c) => c.url)).toEqual(["/api/invoices/new-id/status"]);
  });

  it("the source filter asks the server for API invoices only (13.5)", async () => {
    setFixtures({
      [`${C}/invoices?limit=50`]: { items: [], nextCursor: null },
      [`${C}/invoices?limit=50&source=api`]: { items: [], nextCursor: null },
    });
    const { default: Invoices } = await import("../../client/src/pages/Invoices");
    await renderPage(Invoices);
    await pickOption(byTestId("select-invoice-source"), "Source: API");
    await flush();
    expect(apiCalls("GET").some((c) => c.url === `${C}/invoices?limit=50&source=api`)).toBe(true);
  });
});

describe("WQ1 row actions open the editors seeded from the invoice", () => {
  it("Make recurring and Credit note go to their editors (no 410 endpoint)", async () => {
    setFixtures({
      [`${C}/invoices?limit=50`]: { items: [INVOICE], nextCursor: null },
      [`${C}/einvoicing/compliance`]: { items: [] },
      [`${C}/einvoicing/documents`]: { items: [] },
    });
    const { default: Invoices } = await import("../../client/src/pages/Invoices");
    await renderPage(Invoices);
    const menu = byTestId(`button-invoice-actions-${INVOICE.id}`)!;
    await act(async () => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    await click(byTestId(`button-set-recurring-${INVOICE.id}`));
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      `/recurring-invoices/new?fromInvoice=${INVOICE.id}`
    );
    expect(apiCalls("POST").some((c) => c.url.includes("set-recurring"))).toBe(false);
  });

  it("the recurring editor is seeded from the invoice and emails automatically (7.13)", async () => {
    window.history.replaceState({}, "", `/recurring-invoices/new?fromInvoice=${INVOICE.id}`);
    setFixtures({
      [`/api/invoices/${INVOICE.id}`]: INVOICE,
      [`${C}/customer-contacts`]: [CONTACT],
    });
    const { default: RecurringInvoices } = await import("../../client/src/pages/RecurringInvoices");
    await renderPage(RecurringInvoices);
    await flushUntil(() => !!byTestId("button-submit-recurring"));
    await flushUntil(
      () =>
        (document.querySelector('[name="customerName"]') as HTMLInputElement | null)?.value ===
        INVOICE.customerName
    );
    await submit(byTestId("button-submit-recurring"));
    expect(bodyOf("POST", `${C}/recurring-invoices`)).toMatchObject({
      contactId: CONTACT.id,
      placeOfSupplyEmirate: "dubai",
      paymentTerms: "net15",
      customerName: INVOICE.customerName,
      frequency: "monthly",
      startDate: "2026-03-15",
      autoIssue: true,
      autoSend: true,
      sendToEmail: CONTACT.email,
      lines: [
        {
          description: "Consulting",
          quantity: 2,
          unitPrice: 500,
          vatRate: 0.05,
          vatSupplyType: "standard_rated",
        },
        {
          description: "Training (exempt)",
          quantity: 1,
          unitPrice: 200,
          vatRate: 0,
          vatSupplyType: "exempt",
        },
      ],
    });
  });

  it("the credit-note editor is prefilled for a partial credit with VAT per line (7.15)", async () => {
    window.history.replaceState({}, "", `/credit-notes/new?invoiceId=${INVOICE.id}`);
    setFixtures({ [`/api/invoices/${INVOICE.id}`]: INVOICE });
    const { default: CreditNotes } = await import("../../client/src/pages/CreditNotes");
    await renderPage(CreditNotes);
    await flushUntil(
      () =>
        (document.querySelector('[name="lines.1.description"]') as HTMLInputElement | null)
          ?.value === "Training (exempt)"
    );
    // Credit one of the two consulting days; the exempt line keeps its treatment.
    await type(document.querySelector('[name="lines.0.quantity"]'), "1");
    await type(document.querySelector('[name="reason"]'), "One day not delivered");
    await submit(byTestId("button-submit-credit-note"));
    expect(bodyOf("POST", `${C}/credit-notes`)).toMatchObject({
      invoiceId: INVOICE.id,
      reason: "One day not delivered",
      lines: [
        {
          description: "Consulting",
          quantity: 1,
          unitPrice: 500,
          vatRate: 0.05,
          vatSupplyType: "standard_rated",
        },
        {
          description: "Training (exempt)",
          quantity: 1,
          unitPrice: 200,
          vatRate: 0,
          vatSupplyType: "exempt",
        },
      ],
    });
  });
});

describe("WQ1 receive payment (7.6)", () => {
  it("auto apply spreads the amount oldest due first and posts the allocations", async () => {
    const BANK = {
      id: "a0000000-0000-4000-8000-000000001021",
      code: "1021",
      nameEn: "Emirates NBD",
      type: "asset",
      subType: "bank",
      isActive: true,
    };
    setFixtures({
      [`${C}/customer-contacts`]: [CONTACT],
      [`${C}/accounts`]: [BANK],
      [`${C}/receive-payments/open-invoices?contactId=${CONTACT.id}`]: [
        {
          id: "inv-old",
          number: "INV-1",
          date: "2026-01-05",
          dueDate: "2026-02-04",
          currency: "AED",
          exchangeRate: 1,
          total: 1050,
          openBalance: 1050,
        },
        {
          id: "inv-new",
          number: "INV-2",
          date: "2026-03-01",
          dueDate: "2026-03-31",
          currency: "AED",
          exchangeRate: 1,
          total: 525,
          openBalance: 525,
        },
      ],
    });
    const { default: ReceivePayment } = await import("../../client/src/pages/sales/ReceivePayment");
    await renderPage(ReceivePayment);
    await pickOption(byTestId("select-receive-customer"), CONTACT.name);
    await flushUntil(() => !!byTestId("receive-row-inv-old"));
    await type(byTestId("input-receive-amount"), "1200");
    await type(byTestId("input-receive-fee"), "5");
    await click(byTestId("button-auto-apply"));
    expect((byTestId("input-apply-inv-old") as HTMLInputElement).value).toBe("1050.00");
    expect((byTestId("input-apply-inv-new") as HTMLInputElement).value).toBe("150.00");
    await submit(byTestId("button-record-receipt"));
    expect(bodyOf("POST", `${C}/receive-payments`)).toEqual({
      contactId: CONTACT.id,
      paymentAccountId: BANK.id,
      date: "2026-03-15",
      amount: "1200.00",
      bankFee: "5.00",
      allocations: [
        { invoiceId: "inv-old", amount: "1050.00" },
        { invoiceId: "inv-new", amount: "150.00" },
      ],
    });
  });
});
