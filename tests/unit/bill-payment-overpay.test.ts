// @vitest-environment jsdom
/**
 * Bill payment dialog (AP UX): paying more than the open balance is stopped in the form with a
 * clear message (English and Arabic) and nothing is posted. WQ2 harness copy: the bill editor's capture panel fills the form (nothing is saved until
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
  flushUntil,
  formHarnessCompanyMock,
  formHarnessQueryClientMock,
  renderPage,
  resetHarness,
  setFixtures,
  setResponse,
  type,
  unmountPage,
} from "./helpers/form-harness";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { queryClient } from "../../client/src/lib/queryClient";

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

vi.mock("../../client/src/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({
    can: () => true,
    gate: () => ({}),
    gateApproval: () => ({}),
    known: true,
    role: "owner",
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

async function _unusedDrop(input: HTMLInputElement | null, file: File) {
  if (!input) throw new Error("file input not found");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("[AP-UX] bill payment dialog overpayment guard", () => {
  const bill = {
    id: "b1",
    company_id: COMPANY_ID,
    vendor_name: "Gulf Office Supplies LLC",
    vendor_trn: null,
    bill_number: "GOS-1",
    bill_date: "2026-03-01",
    due_date: "2099-01-01",
    currency: "AED",
    subtotal: "100",
    vat_amount: "5",
    total_amount: "105",
    amount_paid: "5",
    open_balance: 100,
    status: "partial",
    created_at: "2026-03-01",
  };

  /** Render the page with `bill` as the only row and open its payment dialog. */
  async function openPaymentDialog() {
    setFixtures({
      [`${C}/bills/summary`]: null,
      [`${C}/bills/aging`]: null,
      [`${C}/bills`]: [bill],
    });
    const { default: BillPay } = await import("../../client/src/pages/BillPay");
    await renderAt(BillPay, "/bill-pay?status=all");
    await flushUntil(() => !!byTestId("bills-table")?.querySelector("tbody tr"));
    const row = byTestId("bills-table")!.querySelector("tbody tr")!;
    const payBtn = [...row.querySelectorAll("button")].find((b) =>
      /Record payment|تسجيل دفعة|تسجيل الدفع/.test(
        b.textContent + (b.getAttribute("aria-label") ?? "")
      )
    );
    await click(payBtn ?? null);
    await flushUntil(() => !!document.querySelector('[role="dialog"] input'), 40_000);
    return document.querySelector('[role="dialog"] input') as HTMLInputElement;
  }

  for (const [locale, re] of [
    ["en", /more than the open balance/],
    ["ar", /أكبر من الرصيد المستحق/],
  ] as const) {
    it(`blocks an amount above the remaining balance (${locale})`, async () => {
      useI18n.setState({ locale });
      const amount = await openPaymentDialog();
      expect(amount.value).toBe("100");
      await type(amount, "100.01");
      await act(async () => {
        amount.closest("form")!.requestSubmit();
      });
      await flushUntil(
        () => re.test(document.querySelector('[role="dialog"]')?.textContent ?? ""),
        15_000
      );
      expect(document.querySelector('[role="dialog"]')?.textContent ?? "").toMatch(re);
      expect(apiCalls("POST").some((c) => c.url.includes("/payments"))).toBe(false);
    }, 90_000);
  }

  it("uses the server open_balance refetched while the dialog is open", async () => {
    const amount = await openPaymentDialog();
    const dialogText = () => document.querySelector('[role="dialog"]')?.textContent ?? "";
    expect(amount.value).toBe("100");
    expect(dialogText()).toContain("100.00");
    await type(amount, "50");

    // A payment is reversed elsewhere. The balance follows payment events, so the server's
    // open_balance (105) differs from total_amount - amount_paid (103); only the former is right.
    setFixtures({
      [`${C}/bills/summary`]: null,
      [`${C}/bills/aging`]: null,
      [`${C}/bills`]: [{ ...bill, amount_paid: "2", open_balance: 105 }],
    });
    const billsGets = () => apiCalls("GET").filter((c) => c.url === `${C}/bills`).length;
    const getsBefore = billsGets();
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ["/api/companies", COMPANY_ID, "bills"],
        exact: true,
      });
    });
    expect(billsGets()).toBe(getsBefore + 1);

    // Total and remaining both read 105.00; neither the stale 100 nor the derived 103 is shown.
    await flushUntil(() => !dialogText().includes("100.00"), 15_000);
    expect(dialogText().match(/105\.00/g)).toHaveLength(2);
    expect(dialogText()).not.toContain("100.00");
    expect(dialogText()).not.toContain("103.00");
    // The refetch does not overwrite what the user already typed.
    expect(amount.value).toBe("50");

    setResponse("/api/bills/b1/payments", { bill_status: "paid", remaining: 0 });
    await type(amount, "105");
    await act(async () => {
      amount.closest("form")!.requestSubmit();
    });
    const paymentPosts = () => apiCalls("POST").filter((c) => c.url.includes("/payments"));
    await flushUntil(() => paymentPosts().length > 0, 15_000);
    expect(paymentPosts()).toHaveLength(1);
    expect(paymentPosts()[0].url).toBe("/api/bills/b1/payments");
    expect(paymentPosts()[0].body).toMatchObject({ amount: 105 });
  }, 90_000);
});
