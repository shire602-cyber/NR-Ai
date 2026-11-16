// @vitest-environment jsdom
/**
 * S2 client behaviour: Bill Pay ?status= drill-through filters (W3-E residual), the receipt
 * split-lines / revise / split-into-receipts dialog (R05-19b) and the inbound supplier credit
 * note review list (W4-C residual).
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocale } from "../../client/src/lib/i18n";
import {
  billPayTabFromSearch,
  billStatusFilterFromSearch,
  filterBills,
  pendingSupplierCreditNotes,
} from "../../client/src/lib/bill-filters";
import {
  buildLinesRequest,
  buildSplitRequest,
  linesFromReceipt,
  linesTotals,
  toFilsInput,
} from "../../client/src/lib/receipt-split";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("[W3-E] Bill Pay reads ?status= / ?tab= from dashboard links", () => {
  const bills = [
    { status: "approved", due_date: "2026-01-01", vendor_name: "Acme", bill_number: "B-1" },
    { status: "partial", due_date: "2026-12-31", vendor_name: "Globex", bill_number: "B-2" },
    { status: "paid", due_date: "2026-01-01", vendor_name: "Acme", bill_number: "B-3" },
    { status: "pending", due_date: null, vendor_name: "Initech", bill_number: null },
    { status: "overdue", due_date: "2025-12-01", vendor_name: "Umbrella", bill_number: "B-5" },
  ];

  it("parses the dashboard drill-through query and ignores unknown values", () => {
    expect(billStatusFilterFromSearch("?tab=bills&status=open")).toBe("open");
    expect(billStatusFilterFromSearch("tab=bills&status=overdue")).toBe("overdue");
    expect(billStatusFilterFromSearch("?status=drop%20table")).toBe("all");
    expect(billStatusFilterFromSearch("")).toBe("all");
    expect(billPayTabFromSearch("?tab=summary")).toBe("summary");
    expect(billPayTabFromSearch("?tab=nope")).toBe("bills");
  });

  it("open = payable bills; overdue = stored overdue or payable past due; search matches vendor and number", () => {
    const today = "2026-06-01";
    expect(filterBills(bills, "open", "", today).map((b) => b.bill_number)).toEqual([
      "B-1",
      "B-2",
      "B-5",
    ]);
    expect(filterBills(bills, "overdue", "", today).map((b) => b.bill_number)).toEqual([
      "B-1",
      "B-5",
    ]);
    expect(filterBills(bills, "paid", "", today)).toHaveLength(1);
    expect(filterBills(bills, "all", "acme", today)).toHaveLength(2);
    expect(filterBills(bills, "all", "b-2", today)).toHaveLength(1);
  });
});

describe("[R05-19b] receipt split helpers", () => {
  it("parses amounts to integer fils and totals lines exactly", () => {
    expect(toFilsInput("12.5")).toBe(1250);
    expect(toFilsInput("0.1")).toBe(10);
    expect(toFilsInput("1.234")).toBeNull();
    expect(toFilsInput("-1")).toBeNull();
    const t = linesTotals([
      { accountId: "a", amount: "0.10", vatAmount: "0.01", description: "" },
      { accountId: "b", amount: "0.20", vatAmount: "0.01", description: "" },
    ]);
    expect(t).toEqual({ netFils: 30, vatFils: 2, grossFils: 32 });
  });

  it("seeds one line from the receipt header (amount is net, VAT separate)", () => {
    expect(linesFromReceipt({ accountId: "x", amount: 200, vatAmount: 10 })).toEqual([
      { accountId: "x", amount: "200.00", vatAmount: "10.00", description: "" },
    ]);
  });

  it("unposted -> PUT lines; posted -> POST /revise and needs a reason", () => {
    const lines = [
      { accountId: "a", amount: "60", vatAmount: "3", description: "Fuel" },
      { accountId: "b", amount: "40", vatAmount: "2", description: "" },
    ];
    const put = buildLinesRequest({ id: "r1", posted: false }, lines, "");
    expect(put).toMatchObject({ ok: true, method: "PUT", url: "/api/receipts/r1" });
    expect(put.ok && put.body.lines).toEqual([
      { accountId: "a", amount: 60, vatAmount: 3, description: "Fuel" },
      { accountId: "b", amount: 40, vatAmount: 2, description: null },
    ]);
    expect(buildLinesRequest({ id: "r1", posted: true }, lines, " ")).toEqual({
      ok: false,
      error: { index: -1, code: "REASON_REQUIRED" },
    });
    expect(buildLinesRequest({ id: "r1", posted: true }, lines, "Wrong split")).toMatchObject({
      ok: true,
      method: "POST",
      url: "/api/receipts/r1/revise",
      body: { reason: "Wrong split" },
    });
    expect(
      buildLinesRequest(
        { id: "r1" },
        [{ accountId: "a", amount: "5", vatAmount: "6", description: "" }],
        ""
      )
    ).toEqual({ ok: false, error: { index: 0, code: "LINE_VAT_EXCEEDS_AMOUNT" } });
  });

  it("split parts must be 2+ and add up to the receipt amount", () => {
    const part = (amount: string) => ({ merchant: "M", amount, vatAmount: "0", category: "" });
    expect(buildSplitRequest({ id: "r", amount: 100 }, [part("100")])).toMatchObject({
      ok: false,
      error: { code: "PARTS_REQUIRED" },
    });
    expect(buildSplitRequest({ id: "r", amount: 100 }, [part("60"), part("30")])).toMatchObject({
      ok: false,
      error: { code: "PARTS_TOTAL_MISMATCH" },
    });
    const ok = buildSplitRequest({ id: "r", amount: 100 }, [part("60"), part("40")]);
    expect(ok).toMatchObject({ ok: true, url: "/api/receipts/r/split" });
    expect(ok.ok && ok.body.parts).toHaveLength(2);
  });
});

describe("[W4-C] inbound supplier credit notes waiting for review", () => {
  it("lists only received credit notes (UBL 381) without a bill", () => {
    const base = { supplierName: "S", documentNumber: "N", receivedAt: "", billId: null };
    const items = [
      { ...base, id: "1", documentType: "381", status: "received" },
      { ...base, id: "2", documentType: "380", status: "received" },
      { ...base, id: "3", documentType: "381", status: "credit_created" },
    ];
    expect(pendingSupplierCreditNotes(items).map((d) => d.id)).toEqual(["1"]);
  });
});

// ─── Dialog behaviour (real component in jsdom) ─────────────────────────────

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function setValue(el: Element | null, value: string) {
  if (!el) throw new Error("element not found");
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(
    new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true })
  );
}

const byId = (id: string) => document.getElementById(id);
const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`);

async function renderDialog(props: Record<string, unknown>) {
  const { ReceiptLinesDialog } =
    await import("../../client/src/components/receipts/ReceiptLinesDialog");
  await act(async () => {
    root.render(
      createElement(ReceiptLinesDialog, {
        open: true,
        onOpenChange: () => {},
        mode: "lines",
        accounts: [
          { id: "acc-fuel", code: "5090", nameEn: "Travel", type: "expense" },
          { id: "acc-office", code: "5050", nameEn: "Office", type: "expense" },
        ],
        onSaved: () => {},
        ...props,
      } as never)
    );
  });
}

describe("[R05-19b] ReceiptLinesDialog", () => {
  // S5 code-splits the namespace catalogs; the dialog reads purchases.* keys.
  beforeAll(async () => {
    await loadLocale("en");
  });

  it("splits an unposted receipt into two account lines and PUTs them", async () => {
    const request = vi.fn().mockResolvedValue({ id: "r1" });
    const onSaved = vi.fn();
    await renderDialog({
      receipt: { id: "r1", posted: false, amount: 100, vatAmount: 5, accountId: "acc-fuel" },
      request,
      onSaved,
    });
    expect(byTestId("receipt-lines-dialog")).not.toBeNull();
    await act(async () => setValue(byId("rl-amount-0"), "60"));
    await act(async () => setValue(byId("rl-vat-0"), "3"));
    const addLine = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Add line")
    )!;
    await act(async () => addLine.click());
    await act(async () => setValue(byId("rl-account-1"), "acc-office"));
    await act(async () => setValue(byId("rl-amount-1"), "40"));
    await act(async () => setValue(byId("rl-vat-1"), "2"));
    expect(byTestId("receipt-lines-total")?.textContent).toContain("105.00");
    await act(async () => (byTestId("receipt-lines-save") as HTMLButtonElement).click());
    expect(request).toHaveBeenCalledWith("PUT", "/api/receipts/r1", {
      lines: [
        { accountId: "acc-fuel", amount: 60, vatAmount: 3, description: null },
        { accountId: "acc-office", amount: 40, vatAmount: 2, description: null },
      ],
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("a posted receipt is revised (reversal + repost) only with a reason", async () => {
    const request = vi.fn().mockResolvedValue({});
    await renderDialog({
      receipt: { id: "r2", posted: true, amount: 200, vatAmount: 10, accountId: "acc-fuel" },
      request,
    });
    await act(async () => (byTestId("receipt-lines-save") as HTMLButtonElement).click());
    expect(request).not.toHaveBeenCalled();
    expect(byTestId("receipt-lines-error")?.textContent).toMatch(/reason/i);
    await act(async () => setValue(byId("rl-reason"), "Wrong account"));
    await act(async () => setValue(byId("rl-account-0"), "acc-office"));
    await act(async () => (byTestId("receipt-lines-save") as HTMLButtonElement).click());
    expect(request).toHaveBeenCalledWith("POST", "/api/receipts/r2/revise", {
      lines: [{ accountId: "acc-office", amount: 200, vatAmount: 10, description: null }],
      reason: "Wrong account",
    });
  });

  it("splits an upload into separate receipts that add up to the total", async () => {
    const request = vi.fn().mockResolvedValue({ receipts: [] });
    await renderDialog({
      mode: "split",
      receipt: { id: "r3", posted: false, amount: 100, merchant: "Multi", category: "Travel" },
      request,
    });
    await act(async () => setValue(byId("rp-amount-0"), "70"));
    await act(async () => setValue(byId("rp-amount-1"), "20"));
    await act(async () => (byTestId("receipt-lines-save") as HTMLButtonElement).click());
    expect(request).not.toHaveBeenCalled();
    await act(async () => setValue(byId("rp-amount-1"), "30"));
    await act(async () => setValue(byId("rp-merchant-1"), "Second shop"));
    await act(async () => (byTestId("receipt-lines-save") as HTMLButtonElement).click());
    expect(request).toHaveBeenCalledWith("POST", "/api/receipts/r3/split", {
      parts: [
        { merchant: "Multi", amount: 70, vatAmount: 0, category: "Travel" },
        { merchant: "Second shop", amount: 30, vatAmount: 0, category: "Travel" },
      ],
    });
  });
});
