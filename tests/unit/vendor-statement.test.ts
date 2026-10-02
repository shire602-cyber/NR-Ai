import { describe, it, expect } from "vitest";
import { computeVendorStatement, agingFromRows } from "../../server/services/vendor-statement.service";

const bill = (o: any) => ({ status: "approved", currency: "AED", exchangeRate: 1, dueDate: null, ...o });
const bills = [
  bill({ id: "b0", number: "B-001", date: "2026-07-10", dueDate: "2026-08-09", total: 1000 }),
  bill({ id: "b1", number: "B-002", date: "2026-08-05", dueDate: "2026-09-04", total: 500 }),
  // USD bill: 100 USD at 3.6725
  bill({ id: "b2", number: "B-003", date: "2026-08-20", dueDate: "2026-08-25", total: 100, currency: "USD", exchangeRate: 3.6725 }),
  // not on the ledger: pending, pending_approval, void
  bill({ id: "x1", number: "B-PEND", date: "2026-08-06", total: 9999, status: "pending" }),
  bill({ id: "x2", number: "B-WAIT", date: "2026-08-06", total: 7777, status: "pending_approval" }),
  bill({ id: "x3", number: "B-VOID", date: "2026-08-07", total: 8888, status: "void" }),
];
const credits = [
  { id: "c0", number: "VCN-1", date: "2026-07-25", total: 100, currency: "AED", exchangeRate: 1, status: "approved" },
  { id: "c1", number: "VCN-2", date: "2026-08-12", total: 50, currency: "AED", exchangeRate: 1, status: "approved" },
  { id: "c2", number: "VCN-DRAFT", date: "2026-08-12", total: 999, currency: "AED", exchangeRate: 1, status: "draft" },
  { id: "c3", number: "VCN-VOID", date: "2026-08-12", total: 888, currency: "AED", exchangeRate: 1, status: "void" },
];
const payments = [
  { id: "p0", billId: "b0", amount: 300, date: "2026-07-30", reference: "CHQ-1" },
  { id: "p1", billId: "b1", amount: 200, date: "2026-08-15", reference: "TRF-9" },
  { id: "p2", billId: "x1", amount: 5, date: "2026-08-15", reference: "ORPHAN" },
];

describe("computeVendorStatement", () => {
  const s = computeVendorStatement({ bills, credits, payments, from: "2026-08-01", to: "2026-08-31" });

  it("opening balance = ledger bills - payments - credits before from", () => {
    expect(s.openingBalance).toBe(600); // 1000 - 300 - 100
  });

  it("counts only approved, partial and paid bills and approved credits, chronologically", () => {
    expect(s.lines.map((l) => l.reference)).toEqual(["B-002", "VCN-2", "TRF-9", "B-003"]);
    expect(s.lines.map((l) => l.type)).toEqual(["bill", "vendor_credit", "payment", "bill"]);
  });

  it("a bill raises what we owe (credit column), a payment or credit lowers it (debit column)", () => {
    expect(s.lines[0]).toMatchObject({ credit: 500, debit: 0, balance: 1100 });
    expect(s.lines[1]).toMatchObject({ credit: 0, debit: 50, balance: 1050 });
    expect(s.lines[2]).toMatchObject({ credit: 0, debit: 200, balance: 850 });
  });

  it("values foreign-currency bills in AED at their booking rate and keeps the document amount", () => {
    expect(s.lines[3]).toMatchObject({ currency: "USD", documentAmount: 100, credit: 367.25, balance: 1217.25 });
  });

  it("closing = opening + bills - credits - payments and totals add up", () => {
    expect(s.totalCredits).toBe(867.25);
    expect(s.totalDebits).toBe(250);
    expect(s.closingBalance).toBe(1217.25);
  });

  it("ignores payments of bills that are not on the ledger", () => {
    expect(s.lines.some((l) => l.reference === "ORPHAN")).toBe(false);
  });
});

describe("agingFromRows", () => {
  it("buckets AED outstanding by whole days past due at the as-of day; credits (no due date) are current", () => {
    const a = agingFromRows(
      [
        { outstandingAed: 100, dueDate: "2026-09-30" },
        { outstandingAed: 200, dueDate: "2026-08-25" },
        { outstandingAed: 300, dueDate: "2026-07-20" },
        { outstandingAed: 400, dueDate: "2026-06-15" },
        { outstandingAed: 500, dueDate: "2026-05-01" },
        { outstandingAed: -50, dueDate: null },
      ],
      "2026-08-31"
    );
    expect(a).toEqual({ current: 50, days1to30: 200, days31to60: 300, days61to90: 400, over90: 500, total: 1450 });
  });
});
