// @vitest-environment jsdom
/**
 * WQ2 purchases, rendered: the bill editor's capture panel fills the form (nothing is saved until
 * the user saves; the file then goes up as the bill attachment), the supplier type-ahead links
 * the supplier record, the Summary / Line items switch, the status tabs with counts and the
 * "waiting for you" marker, and the supplier-credit page prefilled from a bill.
 */
import { createElement } from "react";
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  COMPANY_ID,
  apiCalls,
  byTestId,
  click,
  editorPage,
  flush,
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  setResponse,
  submit,
  type,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import type { BillCaptureResult } from "../../shared/bill-capture";

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
const VENDOR = {
  id: "v0000000-0000-4000-8000-000000000001",
  name: "Gulf Office Supplies LLC",
  trn: "100222333400003",
  paymentTermsDays: 30,
  isActive: true,
};

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
  (URL as any).createObjectURL ??= () => "blob:preview";
  (URL as any).revokeObjectURL ??= () => {};
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

async function renderAt(Page: any, path: string) {
  const mem = memoryLocation({ path, record: true });
  await renderPage(() => createElement(Router, { hook: mem.hook }, createElement(Page)));
  return mem;
}

async function dropFile(input: HTMLInputElement | null, file: File) {
  if (!input) throw new Error("file input not found");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const capture: BillCaptureResult = {
  draft: {
    vendor_id: VENDOR.id,
    vendor_name: VENDOR.name,
    vendor_trn: VENDOR.trn,
    bill_number: "GOS-7781",
    bill_date: "2026-03-10",
    due_date: "2026-04-09",
    currency: "AED",
    reverse_charge: false,
    line_items: [
      {
        description: "A4 paper",
        quantity: 10,
        unit_price: "80.00",
        vat_supply_type: "standard_rated",
      },
      {
        description: "Toner",
        quantity: 2,
        unit_price: "200.00",
        vat_supply_type: "standard_rated",
      },
    ],
  },
  confidence: {
    supplier: "high",
    billNumber: "high",
    billDate: "review",
    currency: "high",
    lines: "high",
    vatTreatment: "high",
    total: "low",
  },
  supplierMatch: "trn",
  totals: { subtotal: "1200.00", vat: "60.00", total: "1260.00" },
  score: 0.9,
  checks: ["AMOUNT_MISMATCH"],
};

describe("[WQ2 8.2] bill editor capture", () => {
  it.each(["AED", "USD"])("reopens and saves 1.234 as a bill quantity in %s", async (currency) => {
    const url = "/api/bills/fractional";
    setFixtures({
      [url]: {
        id: "fractional",
        status: "draft",
        vendor_name: VENDOR.name,
        vendor_trn: VENDOR.trn,
        bill_date: "2026-01-15",
        currency,
        exchange_rate: currency === "USD" ? "3.675123" : "1",
        line_items: [
          {
            description: "Fractional purchase",
            quantity: "1.2340",
            unit_price: "1000.00",
            vat_rate: "5.00",
            vat_supply_type: "standard_rated",
          },
        ],
        payments: [],
      },
    });
    const { default: BillPay } = await import("../../client/src/pages/BillPay");
    await renderAt(BillPay, "/bill-pay/fractional/edit");
    await flushUntil(() => !!byTestId("button-submit-bill"));
    const quantity = editorPage().querySelector<HTMLInputElement>('[name="line_items.0.quantity"]');
    expect(quantity?.value).toBe("1.234");
    expect(quantity?.validity.valid).toBe(true);
    await submit(byTestId("button-submit-bill"));
    await flushUntil(() => apiCalls("PATCH").some((call) => call.url === url));
    expect(apiCalls("PATCH").find((call) => call.url === url)?.body).toMatchObject({
      currency,
      line_items: [{ quantity: 1.234 }],
    });
  });

  it("a dropped invoice fills the form with per-field confidence; saving posts the bill and then the attachment", async () => {
    setFixtures({
      [`${C}/bills/summary`]: null,
      [`${C}/bills/aging`]: null,
      [`${C}/vendors`]: [VENDOR],
      "/api/ocr/status": { aiConfigured: true },
    });
    setResponse(`${C}/bills/capture`, capture);
    const { default: BillPay } = await import("../../client/src/pages/BillPay");
    await renderAt(BillPay, "/bill-pay/new");
    await flushUntil(() => !!byTestId("bill-capture-panel"));

    await dropFile(
      byTestId("bill-capture-input") as HTMLInputElement,
      new File(["%PDF-1.4 test"], "gos.pdf", { type: "application/pdf" })
    );
    await flushUntil(() => !!byTestId("bill-capture-result"));

    // Nothing was saved by the capture itself.
    expect(apiCalls("POST").map((c) => c.url)).toEqual([`${C}/bills/capture`]);
    const page = editorPage();
    expect((page.querySelector('[name="vendor_name"]') as HTMLInputElement).value).toBe(
      VENDOR.name
    );
    expect((page.querySelector('[name="bill_number"]') as HTMLInputElement).value).toBe("GOS-7781");
    expect(byTestId("capture-confidence-total")?.dataset.band).toBe("low");
    expect(byTestId("field-confidence-billDate")?.dataset.band).toBe("review");
    expect(byTestId("bill-capture-result")?.textContent).toMatch(/found by TRN/);
    expect(byTestId("bill-capture-result")?.textContent).toMatch(/do not add up/);
    // Two lines came back, so the editor shows line items (Summary needs one line).
    expect(byTestId("bill-line-mode-summary")?.hasAttribute("disabled")).toBe(true);

    await submit(byTestId("button-submit-bill"));
    await flushUntil(() => apiCalls("POST").length >= 3);
    const posts = apiCalls("POST");
    const bill = posts.find((c) => c.url === `${C}/bills`)!.body as Record<string, any>;
    expect(bill).toMatchObject({
      vendor_id: VENDOR.id,
      vendor_name: VENDOR.name,
      vendor_trn: VENDOR.trn,
      bill_number: "GOS-7781",
      bill_date: "2026-03-10",
      due_date: "2026-04-09",
    });
    expect(bill.line_items.map((l: any) => [l.description, l.quantity, l.unit_price])).toEqual([
      ["A4 paper", 10, 80],
      ["Toner", 2, 200],
    ]);
    const attach = posts.find((c) => c.url === "/api/bills/new-id/attachment")!;
    expect(attach.body).toMatchObject({ filename: "gos.pdf" });
    expect(String((attach.body as { file: string }).file)).toMatch(
      /^data:application\/pdf;base64,/
    );
  });

  it("the supplier type-ahead links the supplier record; Summary mode enters one amount", async () => {
    setFixtures({
      [`${C}/bills/summary`]: null,
      [`${C}/bills/aging`]: null,
      [`${C}/vendors`]: [VENDOR, { id: "v2", name: "Desert Cleaning", isActive: true }],
    });
    const { default: BillPay } = await import("../../client/src/pages/BillPay");
    await renderAt(BillPay, "/bill-pay/new");
    await flushUntil(() => !!byTestId("supplier-picker"));
    await type(byTestId("supplier-picker"), "gulf");
    await flushUntil(() => document.querySelectorAll('[role="option"]').length > 0);
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Gulf Office Supplies LLC"),
      expect.stringContaining("New supplier"),
    ]);
    await click(options[0]);
    await click(byTestId("bill-line-mode-summary"));
    expect(editorPage().querySelector('[name="line_items.0.quantity"]')).toBeNull();
    await type(editorPage().querySelector('[name="line_items.0.description"]'), "Stationery");
    await type(editorPage().querySelector('[name="line_items.0.unit_price"]'), "300");
    await submit(byTestId("button-submit-bill"));
    await flush();
    const bill = apiCalls("POST").find((c) => c.url === `${C}/bills`)!.body as Record<string, any>;
    expect(bill.vendor_id).toBe(VENDOR.id);
    expect(bill.vendor_trn).toBe(VENDOR.trn);
    expect(bill.line_items).toEqual([
      expect.objectContaining({ description: "Stationery", quantity: 1, unit_price: 300 }),
    ]);
    // No file was chosen: no attachment upload.
    expect(apiCalls("POST").some((c) => c.url.endsWith("/attachment"))).toBe(false);
  });
});

describe("[WQ2 8.15] bill status tabs", () => {
  it("tabs show their counts; To approve marks the bills waiting for this user", async () => {
    const bill = (id: string, status: string, due: string | null) => ({
      id,
      company_id: COMPANY_ID,
      vendor_name: `Vendor ${id}`,
      vendor_trn: null,
      bill_number: `B-${id}`,
      bill_date: "2026-03-01",
      due_date: due,
      currency: "AED",
      subtotal: "100",
      vat_amount: "5",
      total_amount: "105",
      amount_paid: "0",
      status,
      created_at: "2026-03-01",
    });
    setFixtures({
      [`${C}/bills/summary`]: null,
      [`${C}/bills/aging`]: null,
      [`${C}/bills`]: [
        bill("1", "draft", null),
        bill("2", "pending", "2099-01-01"),
        bill("3", "pending", "2099-01-01"),
        bill("4", "approved", "2000-01-01"),
        bill("5", "paid", "2000-01-01"),
      ],
      [`${C}/bills/approval-queue`]: [
        { bill_id: "2", awaiting_me: true },
        { bill_id: "3", awaiting_me: false },
      ],
    });
    const { default: BillPay } = await import("../../client/src/pages/BillPay");
    await renderAt(BillPay, "/bill-pay?status=pending");
    await flushUntil(() => !!byTestId("bill-tab-count-to_approve"));
    expect(byTestId("bill-tab-count-to_complete")?.textContent).toBe("1");
    expect(byTestId("bill-tab-count-to_approve")?.textContent).toBe("2");
    expect(byTestId("bill-tab-count-to_pay")?.textContent).toBe("1");
    expect(byTestId("bill-tab-count-overdue")?.textContent).toBe("1");
    expect(byTestId("bill-awaiting-me")?.textContent).toMatch(/^1 waiting for your approval/);
    const rows = [...byTestId("bills-table")!.querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.textContent?.includes("Waiting for you"))).toEqual([true, false]);
  });
});

describe("[WQ2 8.16] supplier credit from a bill", () => {
  it("/debit-notes/new?billId= prefills the bill's supplier and lines and posts through the debit-note route", async () => {
    const BILL = "b0000000-0000-4000-8000-000000000001";
    setFixtures({
      [`${C}/bills`]: [
        {
          id: BILL,
          vendor_id: VENDOR.id,
          vendor_name: VENDOR.name,
          bill_number: "GOS-7781",
          currency: "AED",
          status: "approved",
          total_amount: "2100",
          open_balance: 2100,
        },
      ],
      [`/api/bills/${BILL}`]: {
        id: BILL,
        vendor_id: VENDOR.id,
        vendor_name: VENDOR.name,
        bill_number: "GOS-7781",
        currency: "AED",
        status: "approved",
        total_amount: "2100",
        line_items: [
          {
            description: "Chairs",
            amount: "2000.00",
            vat_rate: "5",
            account_id: "acc-1",
            quantity: "4",
          },
        ],
      },
      [`${C}/vendors`]: [VENDOR],
    });
    setResponse(`${C}/debit-notes`, { id: "dn-1", total_amount: "525.00" });
    const { default: DebitNotes } = await import("../../client/src/pages/DebitNotes");
    await renderAt(DebitNotes, `/debit-notes/new?billId=${BILL}`);
    await flushUntil(
      () => (byTestId("debit-note-amount-0") as HTMLInputElement | null)?.value === "2000.00"
    );
    expect((byTestId("debit-note-supplier") as HTMLInputElement).value).toBe(VENDOR.name);
    await type(byTestId("debit-note-amount-0"), "500");
    await type(byTestId("debit-note-reason"), "One chair returned");
    await click(byTestId("button-save-debit-note"));
    await flushUntil(() => apiCalls("POST").length >= 2);
    const [create, apply] = apiCalls("POST");
    expect(create.url).toBe(`${C}/debit-notes`);
    expect(create.body).toMatchObject({
      bill_id: BILL,
      vendor_id: VENDOR.id,
      reason: "One chair returned",
      lines: [{ description: "Chairs", amount: "500", vat_rate: 5, account_id: "acc-1" }],
    });
    expect(apply.url).toBe(`${C}/debit-notes/dn-1/apply`);
    expect(apply.body).toMatchObject({ bill_id: BILL, amount: "525.00" });
  });
});
