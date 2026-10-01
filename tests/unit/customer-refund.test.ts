import { describe, expect, it } from "vitest";
import {
  buildRefundJournalLines,
  buildRefundReversalLines,
  computeRefundable,
  evaluateRefund,
} from "../../server/services/customer-refund";
import { parseAgingAsOf } from "../../server/services/aging-as-of.service";

const base = {
  creditNoteStatus: "sent",
  creditNoteType: "credit_note",
  creditNoteDate: "2026-09-01",
  refundDate: "2026-09-10",
  creditNoteTotal: 1050,
  refundedLive: 0,
  receivableCreditAed: 1050,
  creditNoteRate: 1,
  amount: 1050,
};

describe("computeRefundable", () => {
  it("is the credit note total when the receivable holds that much credit", () => {
    expect(computeRefundable(base)).toEqual({ creditNoteRemaining: 1050, refundable: 1050 });
  });
  it("is capped by the credit the ledger holds (credit note on an unpaid invoice has none)", () => {
    expect(computeRefundable({ ...base, receivableCreditAed: 0 })).toEqual({ creditNoteRemaining: 1050, refundable: 0 });
    expect(computeRefundable({ ...base, receivableCreditAed: 400 }).refundable).toBe(400);
  });
  it("a refund reduces what is left on the credit note", () => {
    expect(computeRefundable({ ...base, refundedLive: 300, receivableCreditAed: 750 })).toEqual({
      creditNoteRemaining: 750,
      refundable: 750,
    });
  });
  it("converts the ledger credit to document currency at the credit note rate", () => {
    expect(computeRefundable({ ...base, creditNoteTotal: 100, receivableCreditAed: 367.25, creditNoteRate: 3.6725 }).refundable).toBe(100);
  });
  it("never goes negative", () => {
    expect(computeRefundable({ ...base, refundedLive: 2000 }).refundable).toBe(0);
  });
});

describe("evaluateRefund", () => {
  it("accepts a refund of the whole remaining credit", () => {
    expect(evaluateRefund(base)).toBeNull();
  });
  it("refuses a zero, negative or non-numeric amount", () => {
    expect(evaluateRefund({ ...base, amount: 0 })?.code).toBe("INVALID_REFUND_AMOUNT");
    expect(evaluateRefund({ ...base, amount: -5 })?.code).toBe("INVALID_REFUND_AMOUNT");
    expect(evaluateRefund({ ...base, amount: Number.NaN })?.code).toBe("INVALID_REFUND_AMOUNT");
  });
  it("refuses more than the credit note has left (422)", () => {
    const r = evaluateRefund({ ...base, refundedLive: 1050, receivableCreditAed: 0, amount: 1 });
    expect(r).toMatchObject({ status: 422, code: "REFUND_EXCEEDS_REMAINING" });
    expect(evaluateRefund({ ...base, amount: 1050.02 })?.code).toBe("REFUND_EXCEEDS_REMAINING");
  });
  it("refuses a refund the ledger holds no credit for", () => {
    expect(evaluateRefund({ ...base, receivableCreditAed: 0 })?.code).toBe("REFUND_EXCEEDS_REMAINING");
  });
  it("refuses void, cancelled and draft credit notes and non credit notes", () => {
    expect(evaluateRefund({ ...base, creditNoteStatus: "void" })?.code).toBe("CREDIT_NOTE_VOID");
    expect(evaluateRefund({ ...base, creditNoteStatus: "cancelled" })?.code).toBe("CREDIT_NOTE_VOID");
    expect(evaluateRefund({ ...base, creditNoteStatus: "draft" })?.code).toBe("CREDIT_NOTE_NOT_ISSUED");
    expect(evaluateRefund({ ...base, creditNoteType: "invoice" })?.code).toBe("NOT_A_CREDIT_NOTE");
  });
  it("refuses a refund dated before the credit note", () => {
    expect(evaluateRefund({ ...base, refundDate: "2026-08-31" })?.code).toBe("REFUND_BEFORE_CREDIT_NOTE");
  });
});

describe("buildRefundJournalLines", () => {
  const accounts = { bankAccountId: "bank", receivableAccountId: "ar", fxGainAccountId: "gain", fxLossAccountId: "loss" };
  it("posts Dr receivable / Cr bank, balanced, with no FX leg at the same rate", () => {
    const r = buildRefundJournalLines({ amount: 1050, creditNoteRate: 1, refundRate: 1, label: "CN-1", ...accounts });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      ["ar", 1050, 0],
      ["bank", 0, 1050],
    ]);
    expect(r.realisedFx).toBe(0);
  });
  it("books the difference to FX loss when more AED leaves the bank than the receivable clears", () => {
    const r = buildRefundJournalLines({ amount: 100, creditNoteRate: 3.6725, refundRate: 3.7, label: "CN-2", currency: "USD", ...accounts });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      ["ar", 367.25, 0],
      ["loss", 2.75, 0],
      ["bank", 0, 370],
    ]);
    expect(r.lines[0]).toMatchObject({ foreignCurrency: "USD", foreignDebit: 100, exchangeRate: 3.6725 });
  });
  it("books the difference to FX gain when less AED leaves the bank", () => {
    const r = buildRefundJournalLines({ amount: 100, creditNoteRate: 3.6725, refundRate: 3.65, label: "CN-3", currency: "USD", ...accounts });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      ["ar", 367.25, 0],
      ["gain", 0, 2.25],
      ["bank", 0, 365],
    ]);
  });
  it("refuses an FX difference without the FX account", () => {
    const r = buildRefundJournalLines({ amount: 100, creditNoteRate: 3.6725, refundRate: 3.7, label: "x", ...accounts, fxLossAccountId: null });
    expect(r).toMatchObject({ ok: false, code: "REALISED_FX_ACCOUNT_MISSING" });
  });
});

describe("buildRefundReversalLines", () => {
  it("negates every leg", () => {
    const out = buildRefundReversalLines(
      [
        { accountId: "ar", debit: 367.25, credit: 0, description: "a" },
        { accountId: "loss", debit: 2.75, credit: 0 },
        { accountId: "bank", debit: 0, credit: 370, description: "b" },
      ],
      "Void refund"
    );
    expect(out.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      ["ar", 0, 367.25],
      ["loss", 0, 2.75],
      ["bank", 370, 0],
    ]);
    const dr = out.reduce((s, l) => s + l.debit, 0);
    const cr = out.reduce((s, l) => s + l.credit, 0);
    expect(Math.round(dr * 100)).toBe(Math.round(cr * 100));
  });
});

describe("parseAgingAsOf", () => {
  const now = new Date("2026-10-01T10:00:00Z");
  it("treats an absent or blank value as the default report", () => {
    expect(parseAgingAsOf(undefined, now)).toEqual({ ok: true, asOf: null });
    expect(parseAgingAsOf("  ", now)).toEqual({ ok: true, asOf: null });
  });
  it("accepts a calendar day and gives the end of that UAE day as UTC wall clock", () => {
    expect(parseAgingAsOf("2026-09-30", now)).toEqual({ ok: true, asOf: { ymd: "2026-09-30", dayEnd: "2026-09-30T19:59:59.999" } });
  });
  it("accepts today (UAE) even when UTC is still yesterday", () => {
    const lateUtc = new Date("2026-09-30T21:00:00Z"); // 01:00 on 1 Oct in the UAE
    expect(parseAgingAsOf("2026-10-01", lateUtc).ok).toBe(true);
  });
  it("refuses garbage, impossible dates and the future", () => {
    expect(parseAgingAsOf("tomorrow", now)).toMatchObject({ ok: false, code: "INVALID_AS_OF" });
    expect(parseAgingAsOf("2026-02-30", now)).toMatchObject({ ok: false, code: "INVALID_AS_OF" });
    expect(parseAgingAsOf(["2026-09-01"], now)).toMatchObject({ ok: false, code: "INVALID_AS_OF" });
    expect(parseAgingAsOf("2026-10-02", now)).toMatchObject({ ok: false, code: "AS_OF_IN_FUTURE" });
  });
});
