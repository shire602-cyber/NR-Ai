import { describe, it, expect } from "vitest";
import {
  evaluateVoidRequest,
  evaluateCreditNoteRequest,
  buildReversalLines,
  allocatePayment,
  computeRealisedFx,
  buildPaymentJournalLines,
  round2,
} from "../../server/services/invoice-lifecycle";

describe("buildPaymentJournalLines (A-B5 + A-B12 wiring)", () => {
  const acc = {
    paymentAccountId: "bank",
    receivableAccountId: "ar",
    customerCreditAccountId: "adv",
    fxGainAccountId: "fxg",
    fxLossAccountId: "fxl",
  };
  const sum = (lines: any[], k: string) => round2(lines.reduce((s, l) => s + l[k], 0));

  it("same-rate full payment = simple 2-leg balanced entry (no FX)", () => {
    const r = buildPaymentJournalLines({
      appliedToReceivable: 5250, customerCredit: 0, invoiceRate: 1, paymentRate: 1, ...acc,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines).toHaveLength(2);
      expect(r.realisedFx).toBe(0);
      expect(sum(r.lines, "debit")).toBe(sum(r.lines, "credit"));
      expect(r.lines.find((l) => l.accountId === "bank")?.debit).toBe(5250);
      expect(r.lines.find((l) => l.accountId === "ar")?.credit).toBe(5250);
    }
  });

  it("foreign payment at a higher rate posts a realised gain, balanced", () => {
    // 1000 USD invoice booked at 3.67, settled at 3.75.
    const r = buildPaymentJournalLines({
      appliedToReceivable: 1000, customerCredit: 0, invoiceRate: 3.67, paymentRate: 3.75, ...acc,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.realisedFx).toBe(80);
      expect(r.lines.find((l) => l.accountId === "bank")?.debit).toBe(3750);
      expect(r.lines.find((l) => l.accountId === "ar")?.credit).toBe(3670);
      expect(r.lines.find((l) => l.accountId === "fxg")?.credit).toBe(80);
      expect(sum(r.lines, "debit")).toBe(sum(r.lines, "credit"));
    }
  });

  it("foreign payment at a lower rate posts a realised loss, balanced", () => {
    const r = buildPaymentJournalLines({
      appliedToReceivable: 1000, customerCredit: 0, invoiceRate: 3.67, paymentRate: 3.6, ...acc,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.realisedFx).toBe(-70);
      expect(r.lines.find((l) => l.accountId === "fxl")?.debit).toBe(70);
      expect(sum(r.lines, "debit")).toBe(sum(r.lines, "credit"));
    }
  });

  it("overpayment + FX: cash at pay rate, AR at invoice rate, credit parked, balanced", () => {
    // applied 1000 + overpay 100, invoice 3.67, pay 3.75
    const r = buildPaymentJournalLines({
      appliedToReceivable: 1000, customerCredit: 100, invoiceRate: 3.67, paymentRate: 3.75, ...acc,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines.find((l) => l.accountId === "adv")?.credit).toBe(375); // 100 * 3.75
      expect(r.lines.find((l) => l.accountId === "ar")?.credit).toBe(3670);
      expect(sum(r.lines, "debit")).toBe(sum(r.lines, "credit"));
    }
  });

  it("fails when realised FX needs an account that is missing", () => {
    const r = buildPaymentJournalLines({
      appliedToReceivable: 1000, customerCredit: 0, invoiceRate: 3.67, paymentRate: 3.75,
      paymentAccountId: "bank", receivableAccountId: "ar", fxGainAccountId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("REALISED_FX_ACCOUNT_MISSING");
  });
});

describe("computeRealisedFx (A-B5)", () => {
  it("is zero when the payment rate equals the invoice rate", () => {
    const r = computeRealisedFx({ appliedForeign: 1000, invoiceRate: 3.67, paymentRate: 3.67 });
    expect(r.realisedGainLoss).toBe(0);
    expect(r.arClearedAed).toBe(r.cashAed);
  });
  it("recognises a gain when the payment rate is higher", () => {
    const r = computeRealisedFx({ appliedForeign: 1000, invoiceRate: 3.67, paymentRate: 3.75 });
    expect(r.arClearedAed).toBe(3670);
    expect(r.cashAed).toBe(3750);
    expect(r.realisedGainLoss).toBe(80);
  });
  it("recognises a loss when the payment rate is lower", () => {
    const r = computeRealisedFx({ appliedForeign: 1000, invoiceRate: 3.67, paymentRate: 3.6 });
    expect(r.realisedGainLoss).toBe(-70);
  });
});

describe("allocatePayment (A-B12: overpayment -> customer credit)", () => {
  it("applies a partial payment entirely to the receivable", () => {
    expect(allocatePayment({ amount: 400, remaining: 1000 })).toEqual({
      appliedToReceivable: 400,
      customerCredit: 0,
    });
  });

  it("applies an exact payment entirely to the receivable", () => {
    expect(allocatePayment({ amount: 1000, remaining: 1000 })).toEqual({
      appliedToReceivable: 1000,
      customerCredit: 0,
    });
  });

  it("splits an overpayment into receivable + customer credit", () => {
    expect(allocatePayment({ amount: 1200, remaining: 1000 })).toEqual({
      appliedToReceivable: 1000,
      customerCredit: 200,
    });
  });

  it("absorbs sub-cent rounding into the receivable", () => {
    expect(allocatePayment({ amount: 1000.004, remaining: 1000 })).toEqual({
      appliedToReceivable: 1000,
      customerCredit: 0,
    });
  });
});

describe("evaluateVoidRequest (A-1: void of a paid invoice)", () => {
  it("allows voiding an unpaid invoice", () => {
    expect(evaluateVoidRequest({ targetStatus: "void", paidTotal: 0 })).toEqual({ ok: true });
  });

  it("blocks voiding an invoice with recorded payments", () => {
    const d = evaluateVoidRequest({ targetStatus: "void", paidTotal: 5250 });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.code).toBe("PAID_INVOICE_CANNOT_VOID");
      expect(d.status).toBe(409);
    }
  });

  it("blocks cancelling a partially paid invoice", () => {
    const d = evaluateVoidRequest({ targetStatus: "cancelled", paidTotal: 100 });
    expect(d.ok).toBe(false);
  });

  it("treats sub-cent dust as unpaid", () => {
    expect(evaluateVoidRequest({ targetStatus: "void", paidTotal: 0.004 })).toEqual({ ok: true });
  });

  it("ignores non-void transitions", () => {
    expect(evaluateVoidRequest({ targetStatus: "paid", paidTotal: 999 })).toEqual({ ok: true });
  });
});

describe("evaluateCreditNoteRequest (A-B3: dedup / cap)", () => {
  it("rejects a credit note of a credit note", () => {
    const d = evaluateCreditNoteRequest({
      invoiceType: "credit_note",
      originalTotal: 100,
      alreadyCreditedTotal: 0,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("CN_OF_CN");
  });

  it("allows a first full credit note and returns the creditable amount", () => {
    const d = evaluateCreditNoteRequest({
      invoiceType: "invoice",
      originalTotal: 5250,
      alreadyCreditedTotal: 0,
    });
    expect(d.ok).toBe(true);
    expect(d.creditable).toBe(5250);
  });

  it("blocks a second full credit note (would double-reverse AR)", () => {
    const d = evaluateCreditNoteRequest({
      invoiceType: "invoice",
      originalTotal: 5250,
      alreadyCreditedTotal: 5250,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("FULLY_CREDITED");
  });

  it("allows a partial credit up to the remaining balance", () => {
    const d = evaluateCreditNoteRequest({
      invoiceType: "invoice",
      originalTotal: 1000,
      alreadyCreditedTotal: 400,
      requestedAmount: 600,
    });
    expect(d.ok).toBe(true);
    expect(d.creditable).toBe(600);
  });

  it("rejects a credit that exceeds the remaining balance", () => {
    const d = evaluateCreditNoteRequest({
      invoiceType: "invoice",
      originalTotal: 1000,
      alreadyCreditedTotal: 400,
      requestedAmount: 700,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("CREDIT_EXCEEDS_REMAINING");
  });
});

describe("buildReversalLines (A-B2: balanced, fail-hard on missing accounts)", () => {
  const accounts = { accountsReceivableId: "ar", salesRevenueId: "rev", vatPayableId: "vat" };
  const labels = { revenue: "Reverse revenue", vat: "Reverse VAT", ar: "Reverse A/R" };

  it("produces a balanced 3-leg reversal for a standard-rated invoice", () => {
    const r = buildReversalLines({
      amounts: { subtotal: 5000, vatAmount: 250, total: 5250 },
      accounts,
      labels,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const dr = r.lines.reduce((s, l) => s + l.debit, 0);
      const cr = r.lines.reduce((s, l) => s + l.credit, 0);
      expect(round2(dr)).toBe(round2(cr));
      expect(r.lines).toHaveLength(3);
    }
  });

  it("omits the VAT leg for a zero-rated invoice and stays balanced", () => {
    const r = buildReversalLines({
      amounts: { subtotal: 5000, vatAmount: 0, total: 5000 },
      accounts,
      labels,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines).toHaveLength(2);
      const dr = r.lines.reduce((s, l) => s + l.debit, 0);
      const cr = r.lines.reduce((s, l) => s + l.credit, 0);
      expect(round2(dr)).toBe(round2(cr));
    }
  });

  it("fails hard when VAT was charged but the VAT account is missing", () => {
    const r = buildReversalLines({
      amounts: { subtotal: 5000, vatAmount: 250, total: 5250 },
      accounts: { accountsReceivableId: "ar", salesRevenueId: "rev", vatPayableId: null },
      labels,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("VAT_ACCOUNT_MISSING");
      expect(r.status).toBe(422);
    }
  });

  it("fails when AR or revenue account is missing", () => {
    const r = buildReversalLines({
      amounts: { subtotal: 5000, vatAmount: 250, total: 5250 },
      accounts: { accountsReceivableId: null, salesRevenueId: "rev", vatPayableId: "vat" },
      labels,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CHART_OF_ACCOUNTS_MISSING");
  });
});
