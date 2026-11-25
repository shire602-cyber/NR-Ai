// @vitest-environment jsdom
/**
 * WP-C2 (spec 3.7): quotes, credit notes, recurring invoices, bills and purchase orders are
 * written on full pages (EditorShell) at `<list>/new` and `<list>/:id/edit`, and the list's
 * old dialog entry points (New / Edit) navigate there. Rendered in jsdom inside a wouter
 * memory router so the real route hooks run; the request bodies are covered by
 * d5b-form-payloads (same fields, same payloads, same Arabic validation in f11).
 */
import { createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  COMPANY_ID,
  apiCalls,
  buttonByText,
  byTestId,
  click,
  editorPage,
  flush,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  submit,
  type,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";

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

beforeAll(async () => {
  await loadLocale("en");
  await loadLocale("ar");
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
  useI18n.setState({ locale: "en" });
});
afterEach(async () => {
  await unmountPage();
});

/** Renders `Page` at `path` inside a memory router; returns the router's history. */
async function renderAt(Page: any, path: string) {
  const mem = memoryLocation({ path, record: true });
  await renderPage(() => createElement(Router, { hook: mem.hook }, createElement(Page)));
  return mem;
}

const ID = "d0000000-0000-4000-8000-000000000001";

interface EditorCase {
  name: string;
  base: string;
  testId: string;
  page: () => Promise<any>;
  /** The "new" button on the list. */
  newButton: () => Element | null;
  submitTestId: string;
  nameField: string;
  /** What the edit route loads, as the API returns it. */
  record: { url: string; body: Record<string, unknown> };
  loadedName: string;
  fixtures?: Record<string, unknown>;
}

const line = { description: "Item", quantity: 1, unitPrice: 10, vatRate: 0.05 };
const CASES: EditorCase[] = [
  {
    name: "quote",
    base: "/quotes",
    testId: "dialog-quote-form",
    page: async () => (await import("../../client/src/pages/Quotes")).default,
    newButton: () => buttonByText(/new quote/i),
    submitTestId: "button-submit-quote",
    nameField: "customerName",
    record: {
      url: `/api/quotes/${ID}`,
      body: {
        id: ID,
        companyId: COMPANY_ID,
        number: "QT-1",
        customerName: "Loaded Customer",
        date: "2026-03-01",
        expiryDate: "2026-03-31",
        currency: "AED",
        lines: [line],
      },
    },
    loadedName: "Loaded Customer",
  },
  {
    name: "purchase order",
    base: "/purchase-orders",
    testId: "dialog-po-form",
    page: async () => (await import("../../client/src/pages/PurchaseOrders")).default,
    newButton: () => buttonByText(/new purchase order/i),
    submitTestId: "button-submit-po",
    nameField: "vendorName",
    record: {
      url: `/api/purchase-orders/${ID}`,
      body: {
        id: ID,
        companyId: COMPANY_ID,
        number: "PO-1",
        vendorName: "Loaded Vendor",
        date: "2026-03-01",
        expectedDeliveryDate: "2026-03-31",
        currency: "AED",
        lines: [line],
      },
    },
    loadedName: "Loaded Vendor",
  },
  {
    name: "bill",
    base: "/bill-pay",
    testId: "dialog-bill-form",
    page: async () => (await import("../../client/src/pages/BillPay")).default,
    newButton: () => byTestId("button-new-bill"),
    submitTestId: "button-submit-bill",
    nameField: "vendor_name",
    fixtures: { [`${C}/bills/summary`]: null, [`${C}/bills/aging`]: null },
    record: {
      url: `/api/bills/${ID}`,
      body: {
        id: ID,
        vendor_name: "Loaded Supplier",
        bill_date: "2026-03-01",
        due_date: "2026-03-31",
        status: "pending",
        currency: "AED",
        line_items: [
          {
            description: "Paper",
            quantity: 1,
            unit_price: 10,
            vat_rate: 5,
            vat_supply_type: "standard_rated",
          },
        ],
      },
    },
    loadedName: "Loaded Supplier",
  },
];

describe("[WP-C2] document editors are full pages", () => {
  for (const c of CASES) {
    it(`${c.name}: /new renders the editor page, saves and returns to the list`, async () => {
      setFixtures(c.fixtures ?? {});
      const mem = await renderAt(await c.page(), `${c.base}/new`);
      expect(byTestId(c.testId)).toBeTruthy();
      expect(byTestId("editor-shell-footer")).toBeTruthy();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await type(editorPage().querySelector(`[name="${c.nameField}"]`), "Typed Name");
      await type(editorPage().querySelector('[name$="description"]'), "Thing");
      await submit(byTestId(c.submitTestId));
      expect(apiCalls("POST").length).toBeGreaterThan(0);
      expect(mem.history?.at(-1)).toBe(c.base);
      expect(byTestId(c.testId)).toBeNull();
    });

    it(`${c.name}: /:id/edit loads the record into the editor page`, async () => {
      setFixtures({ ...(c.fixtures ?? {}), [c.record.url]: c.record.body });
      await renderAt(await c.page(), `${c.base}/${ID}/edit`);
      await flush(10);
      expect(byTestId(c.testId)).toBeTruthy();
      const field = editorPage().querySelector(`[name="${c.nameField}"]`) as HTMLInputElement;
      expect(field.value).toBe(c.loadedName);
    });

    it(`${c.name}: the list's New button opens the page route`, async () => {
      setFixtures(c.fixtures ?? {});
      const mem = await renderAt(await c.page(), c.base);
      expect(byTestId(c.testId)).toBeNull();
      await click(c.newButton());
      expect(mem.history?.at(-1)).toBe(`${c.base}/new`);
      expect(byTestId(c.testId)).toBeTruthy();
    });
  }

  it("recurring invoice: /new and /:id/edit render the editor page", async () => {
    const { default: Recurring } = await import("../../client/src/pages/RecurringInvoices");
    const mem = await renderAt(Recurring, "/recurring-invoices/new");
    expect(byTestId("dialog-recurring-form")).toBeTruthy();
    await type(editorPage().querySelector('[name="customerName"]'), "Noor Retail");
    await type(editorPage().querySelector('[name="lines.0.description"]'), "Retainer");
    await submit(byTestId("button-submit-recurring"));
    expect(apiCalls("POST").map((c) => c.url)).toContain(`${C}/recurring-invoices`);
    expect(mem.history?.at(-1)).toBe("/recurring-invoices");
  });

  it("recurring invoice edit route fills the form from the loaded list", async () => {
    const { default: Recurring } = await import("../../client/src/pages/RecurringInvoices");
    setFixtures({
      [`${C}/recurring-invoices`]: [
        {
          id: ID,
          customerName: "Stored Customer",
          currency: "AED",
          frequency: "monthly",
          startDate: "2026-03-01",
          nextRunDate: "2026-04-01",
          status: "active",
          linesJson: JSON.stringify([line]),
        },
      ],
    });
    await renderAt(Recurring, `/recurring-invoices/${ID}/edit`);
    await flush(10);
    const field = editorPage().querySelector('[name="customerName"]') as HTMLInputElement;
    expect(field.value).toBe("Stored Customer");
  });

  it("credit note: /new is the editor page; the number is assigned on save, not typed", async () => {
    const { default: CreditNotes } = await import("../../client/src/pages/CreditNotes");
    setFixtures({ [`${C}/invoices?all=true`]: [] });
    await renderAt(CreditNotes, "/credit-notes/new");
    expect(byTestId("dialog-credit-note-form")).toBeTruthy();
    const number = editorPage().querySelector('[name="number"]') as HTMLInputElement;
    expect(number.readOnly).toBe(true);
    expect(number.value).toBe("");
  });

  it("credit note: the header button opens /credit-notes/new", async () => {
    const { default: CreditNotes } = await import("../../client/src/pages/CreditNotes");
    const mem = await renderAt(CreditNotes, "/credit-notes");
    await click(byTestId("button-new-credit-note"));
    expect(mem.history?.at(-1)).toBe("/credit-notes/new");
  });
});

describe("[WP-C2] Sparkline mirrors itself in Arabic", () => {
  it("draws the same series right to left in ar, left to right in en", async () => {
    const { Sparkline } = await import("../../client/src/components/ui/stat-card");
    const draw = async (locale: "en" | "ar") => {
      useI18n.setState({ locale });
      await renderPage(() => createElement(Sparkline, { values: [1, 2, 9, 4] }));
      const d = document
        .querySelector('[data-testid="stat-sparkline"] path[fill="none"]')!
        .getAttribute("d");
      await unmountPage();
      return d;
    };
    const en = await draw("en");
    const ar = await draw("ar");
    expect(en).not.toBe(ar);
    // Reversing the series draws the identical line as the english one for the mirrored values.
    useI18n.setState({ locale: "en" });
    await renderPage(() => createElement(Sparkline, { values: [4, 9, 2, 1] }));
    const mirrored = document
      .querySelector('[data-testid="stat-sparkline"] path[fill="none"]')!
      .getAttribute("d");
    expect(ar).toBe(mirrored);
  });
});
