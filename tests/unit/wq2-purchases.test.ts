/**
 * WQ2 purchases: the capture mapper (8.2, 4.7), the bill status tabs (8.15) and the debit-note
 * form helpers (8.16). Pure functions, called directly.
 */
import { describe, expect, it } from "vitest";
import {
  isOwnTrn,
  mapExtractionToBillDraft,
  matchSupplier,
  normalizeTrn,
  SelfTrnDocumentError,
} from "../../shared/bill-capture";
import {
  BILL_LIST_TABS,
  billTabCounts,
  billTabForFilter,
  billStatusFilterFromSearch,
  filterBills,
} from "../../client/src/lib/bill-filters";
import {
  debitNoteRemaining,
  debitNoteTotals,
  linesFromBill,
} from "../../client/src/lib/debit-note-form";

const suppliers = [
  { id: "v1", name: "Gulf Office Supplies L.L.C.", trn: "100222333400003", paymentTermsDays: 30 },
  { id: "v2", name: "Desert Cleaning Services", nameAr: "خدمات الصحراء للتنظيف", trn: null },
];

describe("WQ2 capture mapper", () => {
  it("[8.2] matches the supplier by TRN first, then by name with legal suffixes folded", () => {
    expect(matchSupplier(suppliers, "anything", "100 222 333 400 003")).toMatchObject({
      match: "trn",
      supplier: { id: "v1" },
    });
    expect(matchSupplier(suppliers, "GULF OFFICE SUPPLIES LLC", null).match).toBe("name");
    expect(matchSupplier(suppliers, "خدمات الصحراء للتنظيف", null).supplier?.id).toBe("v2");
    expect(matchSupplier(suppliers, "Someone else", null).match).toBe("none");
  });

  it("[8.2] net lines are kept exactly; due date follows the supplier's terms", () => {
    const r = mapExtractionToBillDraft(
      {
        merchant: "Gulf Office Supplies LLC",
        date: "2026-03-10",
        invoiceNumber: "GOS-1",
        subtotal: 1200,
        vatAmount: 60,
        total: 1260,
        currency: "aed",
        supplierTrn: "100222333400003",
        confidence: 0.9,
        lineItems: [
          { description: "Paper", quantity: 10, unitPrice: 80, total: 800 },
          { description: "Toner", quantity: 2, unitPrice: 200, total: 400 },
        ],
      },
      { suppliers }
    );
    expect(r.draft).toMatchObject({
      vendor_id: "v1",
      currency: "AED",
      due_date: "2026-04-09",
      reverse_charge: false,
    });
    expect(r.draft.line_items.map((l) => [l.quantity, l.unit_price])).toEqual([
      [10, "80.00"],
      [2, "200.00"],
    ]);
    expect(r.confidence).toMatchObject({ supplier: "high", lines: "high", total: "high" });
    expect(r.checks).toEqual([]);
  });

  it("[8.2] gross lines are spread over the net in exact fils (they sum to the net)", () => {
    const r = mapExtractionToBillDraft(
      {
        merchant: "Cafe",
        date: "2026-03-10",
        subtotal: 100,
        vatAmount: 5,
        total: 105,
        lineItems: [
          { description: "Coffee", quantity: 1, total: 35 },
          { description: "Cake", quantity: 1, total: 70 },
        ],
        confidence: 0.9,
      },
      { suppliers }
    );
    const fils = r.draft.line_items.map((l) => Math.round(Number(l.unit_price) * 100));
    expect(fils.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(fils).toEqual([3333, 6667]);
  });

  it("[8.2] a total-only receipt derives net and VAT; lines that do not add up become one line, flagged", () => {
    const r = mapExtractionToBillDraft(
      {
        merchant: "Shop",
        total: 210,
        lineItems: [{ description: "Thing", total: 999 }],
        confidence: 0.95,
      },
      { suppliers }
    );
    expect(r.totals).toEqual({ subtotal: "200.00", vat: "10.00", total: "210.00" });
    expect(r.draft.line_items).toHaveLength(1);
    expect(r.draft.line_items[0].unit_price).toBe("200.00");
    expect(r.checks).toEqual(expect.arrayContaining(["LINES_DO_NOT_ADD_UP", "DATE_MISSING"]));
    expect(r.confidence.lines).toBe("low");
    expect(r.confidence.billDate).toBe("low");
    expect(r.confidence.supplier).not.toBe("high");
  });

  it("[8.2] a missing model confidence is low everywhere; reverse charge is carried to the lines", () => {
    const r = mapExtractionToBillDraft(
      {
        merchant: "Cloud Inc",
        date: "2026-03-01",
        subtotal: 500,
        vatAmount: 0,
        total: 500,
        currency: "USD",
        reverseChargeSuggested: true,
      },
      { suppliers }
    );
    expect(r.score).toBeNull();
    expect(r.confidence.total).toBe("low");
    expect(r.draft.reverse_charge).toBe(true);
    expect(r.draft.line_items[0].vat_supply_type).toBe("reverse_charge");
    expect(r.draft.currency).toBe("USD");
  });

  it("[4.7] the company's own TRN as the seller is refused (Arabic-Indic digits folded)", () => {
    expect(normalizeTrn("١٠٠٣٠٠٠٠٠٠٠٠٠٠٣")).toBe("100300000000003");
    expect(isOwnTrn("100-300-000-000-003", "100300000000003")).toBe(true);
    expect(isOwnTrn(null, "100300000000003")).toBe(false);
    expect(() =>
      mapExtractionToBillDraft(
        { merchant: "Us", total: 105, supplierTrn: "100300000000003" },
        { suppliers, companyTrn: "100300000000003" }
      )
    ).toThrow(SelfTrnDocumentError);
  });
});

describe("WQ2 bill status tabs", () => {
  const today = "2026-03-15";
  const bills = [
    { id: "a", status: "draft", due_date: null, vendor_name: "A", bill_number: null },
    { id: "b", status: "rejected", due_date: null, vendor_name: "B", bill_number: null },
    { id: "c", status: "pending", due_date: "2026-04-01", vendor_name: "C", bill_number: "1" },
    { id: "d", status: "pending", due_date: "2026-04-01", vendor_name: "D", bill_number: "2" },
    { id: "e", status: "approved", due_date: "2026-03-01", vendor_name: "E", bill_number: "3" },
    { id: "f", status: "partial", due_date: "2026-04-30", vendor_name: "F", bill_number: "4" },
    { id: "g", status: "paid", due_date: "2026-02-01", vendor_name: "G", bill_number: "5" },
    { id: "h", status: "void", due_date: null, vendor_name: "H", bill_number: "6" },
  ];

  it("[8.15] counts per tab equal the rows each tab shows; awaiting-me counts pending bills only", () => {
    const counts = billTabCounts(
      bills,
      [
        { bill_id: "c", awaiting_me: true },
        { bill_id: "d", awaiting_me: false },
        { bill_id: "e", awaiting_me: true }, // no longer pending: not counted
      ],
      today
    );
    expect(counts).toEqual({
      to_complete: 2,
      to_approve: 2,
      to_pay: 2,
      overdue: 1,
      paid: 1,
      all: 8,
      awaitingMe: 1,
    });
    for (const tab of BILL_LIST_TABS) {
      expect(filterBills(bills, tab.filter, "", today).length, tab.id).toBe(counts[tab.id]);
    }
  });

  it("[8.15] a drill-through status selects its tab; statuses without a tab show under All", () => {
    expect(billTabForFilter(billStatusFilterFromSearch("?status=overdue"))).toBe("overdue");
    expect(billTabForFilter(billStatusFilterFromSearch("?status=open"))).toBe("to_pay");
    expect(billTabForFilter(billStatusFilterFromSearch("?status=pending"))).toBe("to_approve");
    expect(billTabForFilter(billStatusFilterFromSearch("?status=to_complete"))).toBe("to_complete");
    expect(billTabForFilter("approved")).toBe("all");
    expect(BILL_LIST_TABS.filter((t) => t.id !== "all")).toHaveLength(5);
  });
});

describe("WQ2 debit-note form", () => {
  it("[8.16] prefills one line per bill line at its net, keeping the VAT treatment, account and item", () => {
    const lines = linesFromBill([
      { description: "Chairs", amount: "2000.00", vat_rate: "5", account_id: "acc", quantity: "4" },
      {
        description: "Export",
        amount: "100",
        vat_rate: "0",
        vat_supply_type: "zero_rated",
        account_id: null,
        product_id: "p1",
        quantity: "2",
      },
    ]);
    expect(lines).toEqual([
      {
        description: "Chairs",
        amount: "2000.00",
        vatRate: 5,
        accountId: "acc",
        productId: null,
        quantity: 4,
      },
      {
        description: "Export",
        amount: "100.00",
        vatRate: 0,
        accountId: "",
        productId: "p1",
        quantity: 2,
      },
    ]);
    expect(debitNoteTotals(lines)).toEqual({ subtotal: 2100, vat: 100, total: 2200 });
    expect(debitNoteRemaining({ total_amount: "525.00", amount_applied: "200.10" })).toBe(324.9);
    expect(debitNoteRemaining({ total_amount: "525.00", amount_applied: null })).toBe(525);
  });
});
