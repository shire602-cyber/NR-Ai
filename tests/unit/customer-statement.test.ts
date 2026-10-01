import { describe, it, expect } from "vitest";
import { computeCustomerStatement } from "../../server/services/customer-statement.service";

const inv = (o: any) => ({
  invoiceType: "invoice",
  status: "sent",
  currency: "AED",
  exchangeRate: 1,
  originalInvoiceId: null,
  ...o,
});

const invoices = [
  // before the period: 1000 invoice, partly paid before from (300) => opening 700 less credit 100 = 600
  inv({ id: "i0", number: "INV-001", date: "2026-07-10", dueDate: "2026-08-09", total: 1000, baseCurrencyAmount: 1000 }),
  { ...inv({ id: "c0", number: "CN-001", date: "2026-07-25", total: -100, baseCurrencyAmount: -100 }), invoiceType: "credit_note", originalInvoiceId: "i0" },
  // inside the period
  inv({ id: "i1", number: "INV-002", date: "2026-08-05", dueDate: "2026-09-04", total: 500, baseCurrencyAmount: 500 }),
  // USD invoice: 100 USD at 3.6725
  inv({ id: "i2", number: "INV-003", date: "2026-08-20", dueDate: "2026-08-25", total: 100, currency: "USD", exchangeRate: 3.6725, baseCurrencyAmount: 367.25 }),
  // excluded: draft, void, cancelled
  inv({ id: "d1", number: "INV-DRAFT", date: "2026-08-06", total: 9999, baseCurrencyAmount: 9999, status: "draft" }),
  inv({ id: "v1", number: "INV-VOID", date: "2026-08-07", total: 8888, baseCurrencyAmount: 8888, status: "void" }),
  { ...inv({ id: "c1", number: "CN-002", date: "2026-08-12", total: -50, baseCurrencyAmount: -50 }), invoiceType: "credit_note", originalInvoiceId: "i1" },
  { ...inv({ id: "c2", number: "CN-VOID", date: "2026-08-13", total: -70, baseCurrencyAmount: -70, status: "void" }), invoiceType: "credit_note", originalInvoiceId: "i1" },
];
const payments = [
  { id: "p0", invoiceId: "i0", amount: 300, date: "2026-07-30", reference: "CHQ-1" },
  { id: "p1", invoiceId: "i1", amount: 200, date: "2026-08-15", reference: "TRF-9" },
];

describe("computeCustomerStatement", () => {
  const s = computeCustomerStatement({ invoices, payments, refunds: [], from: "2026-08-01", to: "2026-08-31" });

  it("opening balance = issued invoices - payments - issued credit notes before from", () => {
    expect(s.openingBalance).toBe(600); // 1000 - 300 - 100
  });

  it("lists lines chronologically with a running balance, skipping draft/void documents", () => {
    expect(s.lines.map((l) => l.reference)).toEqual(["INV-002", "CN-002", "TRF-9", "INV-003"]);
    expect(s.lines.map((l) => l.balance)).toEqual([1100, 1050, 850, 1217.25]);
    expect(s.lines[0]).toMatchObject({ type: "invoice", debit: 500, credit: 0, currency: "AED" });
    expect(s.lines[1]).toMatchObject({ type: "credit_note", credit: 50 });
    expect(s.lines[2]).toMatchObject({ type: "payment", debit: 0, credit: 200 });
    expect(s.lines[3]).toMatchObject({ type: "invoice", debit: 367.25, currency: "USD", documentAmount: 100 });
  });

  it("closing balance equals opening + movements", () => {
    expect(s.closingBalance).toBe(1217.25);
    expect(s.totalDebits).toBe(867.25);
    expect(s.totalCredits).toBe(250);
  });

  it("ages open invoices at the end date by days past due", () => {
    // at 2026-08-31: i0 due 08-09 => 22 days past due, outstanding 600
    //                i1 due 09-04 => current, outstanding 500-200-50 = 250
    //                i2 due 08-25 => 6 days, outstanding 367.25
    expect(s.aging.current).toBe(250);
    expect(s.aging.days1to30).toBe(967.25);
    expect(s.aging.days31to60).toBe(0);
    expect(s.aging.days61to90).toBe(0);
    expect(s.aging.over90).toBe(0);
    expect(s.aging.total).toBe(1217.25);
  });

  it("ignores payments recorded after the end date when ageing", () => {
    const late = computeCustomerStatement({
      invoices,
      payments: [...payments, { id: "p2", invoiceId: "i0", amount: 600, date: "2026-09-02" }],
      refunds: [],
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(late.aging.days1to30).toBe(967.25);
    expect(late.closingBalance).toBe(1217.25);
  });

  it("puts old invoices into the 31-60, 61-90 and 90+ buckets", () => {
    const old = computeCustomerStatement({
      invoices: [
        inv({ id: "a", number: "A", date: "2026-05-01", dueDate: "2026-06-01", total: 10, baseCurrencyAmount: 10 }), // 91 days
        inv({ id: "b", number: "B", date: "2026-05-20", dueDate: "2026-06-20", total: 20, baseCurrencyAmount: 20 }), // 72
        inv({ id: "c", number: "C", date: "2026-07-01", dueDate: "2026-07-20", total: 40, baseCurrencyAmount: 40 }), // 42
      ],
      payments: [],
      refunds: [],
      from: "2026-08-01",
      to: "2026-09-01",
    });
    expect(old.openingBalance).toBe(70);
    expect(old.aging).toMatchObject({ current: 0, days1to30: 0, days31to60: 40, days61to90: 20, over90: 10, total: 70 });
  });

  it("customer refunds increase the balance (cash returned after a credit)", () => {
    const r = computeCustomerStatement({
      invoices,
      payments,
      refunds: [{ id: "r1", amount: 50, date: "2026-08-28", currency: "AED", exchangeRate: 1, reference: "RF-1" }],
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(r.lines.at(-1)).toMatchObject({ type: "refund", debit: 50 });
    expect(r.closingBalance).toBe(1267.25);
  });
});
