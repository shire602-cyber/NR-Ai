import { describe, it, expect } from "vitest";
import {
  computeInvoiceBalance,
  sumCreditNotes,
  buildInvoiceBalances,
} from "../../server/services/invoice-outstanding";
import {
  canTransition,
  statusFromBalance,
  statusFromPayments,
  INVOICE_STATUSES,
} from "../../server/services/invoice-state-machine";

describe("computeInvoiceBalance", () => {
  it("paid only: outstanding is total minus payments", () => {
    const b = computeInvoiceBalance({ total: 1050, paid: 250, credited: 0 });
    expect(b.outstanding).toBe(800);
    expect(b.isFullyCredited).toBe(false);
  });

  it("credited only: outstanding is total minus credit notes", () => {
    const b = computeInvoiceBalance({ total: 1050, paid: 0, credited: 400 });
    expect(b.outstanding).toBe(650);
    expect(b.isFullyCredited).toBe(false);
  });

  it("a full credit note brings outstanding to 0 and flags the invoice fully credited", () => {
    const b = computeInvoiceBalance({ total: 1050, paid: 0, credited: 1050 });
    expect(b.outstanding).toBe(0);
    expect(b.isFullyCredited).toBe(true);
  });

  it("mixed: payments and credit notes both reduce the balance", () => {
    const b = computeInvoiceBalance({ total: 1050, paid: 300, credited: 200 });
    expect(b.outstanding).toBe(550);
    expect(b.paid).toBe(300);
    expect(b.credited).toBe(200);
  });

  it("over-credit and over-payment clamp at 0, never negative", () => {
    expect(computeInvoiceBalance({ total: 100, paid: 0, credited: 250 }).outstanding).toBe(0);
    expect(computeInvoiceBalance({ total: 100, paid: 150, credited: 0 }).outstanding).toBe(0);
    expect(computeInvoiceBalance({ total: 100, paid: 60, credited: 60 }).outstanding).toBe(0);
  });

  it("is exact to the fils (no float drift)", () => {
    const b = computeInvoiceBalance({ total: 0.3, paid: 0.1, credited: 0.2 });
    expect(b.outstanding).toBe(0);
    expect(computeInvoiceBalance({ total: 10.1, paid: 3.03, credited: 0.07 }).outstanding).toBe(7);
  });

  it("works in the document currency (foreign): no exchange rate is involved", () => {
    // 100 USD + 5% = 105 USD; 30 USD paid, 20 USD credited -> 55 USD open.
    const b = computeInvoiceBalance({ total: 105, paid: 30, credited: 20 });
    expect(b.outstanding).toBe(55);
    // The base-currency value of what is open is outstanding x the invoice rate.
    expect(Math.round(b.outstanding * 3.6725 * 100) / 100).toBe(201.99);
  });

  it("treats null / NaN inputs as zero", () => {
    const b = computeInvoiceBalance({ total: 100, paid: NaN as any, credited: null as any });
    expect(b.outstanding).toBe(100);
  });
});

describe("sumCreditNotes", () => {
  it("adds the absolute totals of live credit notes", () => {
    expect(
      sumCreditNotes([
        { total: -400, status: "sent" },
        { total: -100.5, status: "sent" },
      ])
    ).toBe(500.5);
  });

  it("ignores void and cancelled credit notes", () => {
    expect(
      sumCreditNotes([
        { total: -400, status: "void" },
        { total: -100, status: "cancelled" },
        { total: -50, status: "sent" },
      ])
    ).toBe(50);
  });
});

describe("buildInvoiceBalances", () => {
  const rows = [
    { id: "inv-1", total: 1050, status: "sent", invoiceType: "invoice", originalInvoiceId: null },
    { id: "inv-2", total: 500, status: "partial", invoiceType: "invoice", originalInvoiceId: null },
    { id: "cn-1", total: -1050, status: "sent", invoiceType: "credit_note", originalInvoiceId: "inv-1" },
    { id: "cn-2", total: -100, status: "void", invoiceType: "credit_note", originalInvoiceId: "inv-2" },
    { id: "cn-3", total: -50, status: "sent", invoiceType: "credit_note", originalInvoiceId: "inv-2" },
  ];
  const payments = [{ invoiceId: "inv-2", amount: 200 }];

  it("nets payments and non-void credit notes per invoice", () => {
    const map = buildInvoiceBalances(rows, payments);
    expect(map.get("inv-1")?.outstanding).toBe(0);
    expect(map.get("inv-1")?.isFullyCredited).toBe(true);
    // 500 - 200 paid - 50 live credit (the void one is ignored)
    expect(map.get("inv-2")?.outstanding).toBe(250);
  });

  it("gives a credit note itself a zero outstanding (it is not a receivable)", () => {
    const map = buildInvoiceBalances(rows, payments);
    expect(map.get("cn-1")?.outstanding).toBe(0);
  });
});

describe("status from balance (credited state)", () => {
  it("credited is a real status", () => {
    expect(INVOICE_STATUSES).toContain("credited");
  });

  it("a fully credited, unpaid invoice becomes credited", () => {
    expect(statusFromBalance("sent", { total: 1050, paid: 0, credited: 1050 })).toBe("credited");
    expect(statusFromBalance("posted", { total: 1050, paid: 0, credited: 1050 })).toBe("credited");
  });

  it("partly paid + partly credited to zero outstanding is settled (paid), not credited", () => {
    expect(statusFromBalance("partial", { total: 1050, paid: 600, credited: 450 })).toBe("paid");
  });

  it("partial credit, no payment: stays open", () => {
    expect(statusFromBalance("sent", { total: 1050, paid: 0, credited: 400 })).toBe("sent");
  });

  it("partial credit plus a payment: partial", () => {
    expect(statusFromBalance("sent", { total: 1050, paid: 100, credited: 400 })).toBe("partial");
  });

  it("voiding the credit note returns a credited invoice to an open status", () => {
    expect(statusFromBalance("credited", { total: 1050, paid: 0, credited: 0 })).toBe("sent");
    expect(statusFromBalance("credited", { total: 1050, paid: 300, credited: 0 })).toBe("partial");
  });

  it("voiding one of two credit notes reopens a settled invoice", () => {
    expect(statusFromBalance("paid", { total: 1050, paid: 600, credited: 0 })).toBe("partial");
  });

  it("never moves draft, void or cancelled", () => {
    expect(statusFromBalance("draft", { total: 1050, paid: 0, credited: 1050 })).toBe("draft");
    expect(statusFromBalance("void", { total: 1050, paid: 0, credited: 0 })).toBe("void");
    expect(statusFromBalance("cancelled", { total: 1050, paid: 0, credited: 0 })).toBe("cancelled");
  });

  it("statusFromPayments counts credit notes when deciding paid", () => {
    // 1050 invoice, 400 credited, 650 paid -> paid
    expect(statusFromPayments("sent", 1050, 650, 400)).toBe("paid");
    expect(statusFromPayments("sent", 1050, 300, 400)).toBe("partial");
  });

  it("credited can only be reached from an open status and can be reopened", () => {
    expect(canTransition("sent", "credited")).toBe(true);
    expect(canTransition("partial", "credited")).toBe(true);
    expect(canTransition("draft", "credited")).toBe(false);
    expect(canTransition("void", "credited")).toBe(false);
    // reopening is the internal status sync's job, never a manual change
    expect(canTransition("credited", "sent")).toBe(false);
    expect(canTransition("credited", "sent", { system: true })).toBe(true);
    expect(canTransition("credited", "paid")).toBe(false);
  });
});
