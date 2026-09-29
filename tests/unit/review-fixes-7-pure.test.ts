import { describe, it, expect } from "vitest";
import {
  balanceAsOf,
  receivableOutstanding,
  invoiceBalanceFields,
} from "../../server/services/invoice-outstanding";
import { canTransition } from "../../server/services/invoice-state-machine";
import {
  isRevaluationScopeStatus,
  isBillRevaluationScopeStatus,
} from "../../server/services/fx-revaluation.service";

const asOf = new Date("2026-09-12T00:00:00.000Z");

describe("B1: outstanding as of a past date", () => {
  it("a payment dated after the as-of date does not reduce the balance", () => {
    const b = balanceAsOf(
      { total: 1000, payments: [{ amount: 1000, date: "2026-09-20" }], creditNotes: [] },
      asOf
    );
    expect(b.outstanding).toBe(1000);
    expect(b.paid).toBe(0);
  });

  it("a payment dated on the as-of day counts", () => {
    const b = balanceAsOf(
      { total: 1000, payments: [{ amount: 400, date: "2026-09-12T18:00:00Z" }], creditNotes: [] },
      asOf
    );
    expect(b.outstanding).toBe(600);
  });

  it("credit notes count only when dated on or before, and never when void", () => {
    const b = balanceAsOf(
      {
        total: 1000,
        payments: [],
        creditNotes: [
          { total: -100, status: "posted", date: "2026-09-01" },
          { total: -200, status: "void", date: "2026-09-01" },
          { total: -300, status: "posted", date: "2026-09-13" },
        ],
      },
      asOf
    );
    expect(b.credited).toBe(100);
    expect(b.outstanding).toBe(900);
  });

  it("fully paid before the as-of date is not outstanding", () => {
    const b = balanceAsOf(
      { total: 500, payments: [{ amount: 500, date: "2026-09-01" }], creditNotes: [] },
      asOf
    );
    expect(b.outstanding).toBe(0);
  });

  it("scope: drafts, void and cancelled invoices are out; paid and credited are in", () => {
    for (const s of ["sent", "posted", "partial", "paid", "credited"]) {
      expect(isRevaluationScopeStatus(s)).toBe(true);
    }
    for (const s of ["draft", "void", "cancelled"]) expect(isRevaluationScopeStatus(s)).toBe(false);
  });

  it("scope: only approved bills (any later state) are in", () => {
    for (const s of ["approved", "partial", "paid", "overdue"]) expect(isBillRevaluationScopeStatus(s)).toBe(true);
    for (const s of ["pending", null, "rejected"]) expect(isBillRevaluationScopeStatus(s as any)).toBe(false);
  });
});

describe("B3: a credited invoice cannot be reopened by hand", () => {
  it("manual transitions out of credited are refused", () => {
    for (const to of ["sent", "posted", "partial", "paid", "draft"]) {
      expect(canTransition("credited", to)).toBe(false);
    }
  });

  it("the internal status sync may reopen it", () => {
    for (const to of ["sent", "posted", "partial"]) {
      expect(canTransition("credited", to, { system: true })).toBe(true);
    }
    expect(canTransition("credited", "paid", { system: true })).toBe(false);
  });
});

describe("B5: nothing is receivable until an invoice is posted", () => {
  const balance = { outstanding: 1050, paid: 0, credited: 0, isFullyCredited: false };
  it("draft, void and cancelled report 0 outstanding", () => {
    for (const status of ["draft", "void", "cancelled"]) {
      expect(receivableOutstanding({ status, invoiceType: "invoice" }, balance)).toBe(0);
      expect(invoiceBalanceFields({ status, invoiceType: "invoice" }, balance).outstandingAmount).toBe(0);
    }
  });
  it("issued invoices keep their real outstanding; credit notes are 0", () => {
    expect(receivableOutstanding({ status: "sent", invoiceType: "invoice" }, balance)).toBe(1050);
    expect(receivableOutstanding({ status: "sent", invoiceType: "credit_note" }, balance)).toBe(0);
    expect(receivableOutstanding({ status: "sent", invoiceType: "invoice" }, undefined)).toBe(0);
  });
});
