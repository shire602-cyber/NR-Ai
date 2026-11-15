// Phase T: fill targeted coverage gaps on the money paths — branches the
// existing invoice-lifecycle / financial-statements suites don't exercise.
import { describe, it, expect } from "vitest";
import {
  sumMoney,
  classifyCounterpart,
  isCashOrBankAccount,
  type CFAccount,
} from "../../server/services/financial-statements";
import { evaluateCreditNoteRequest } from "../../server/services/invoice-lifecycle";

describe("sumMoney (A-B17: fils-exact summation, no float drift)", () => {
  it("sums 0.1 + 0.2 to exactly 0.3 (the classic float trap)", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });

  it("sums one hundred 0.01s to exactly 1.00", () => {
    expect(sumMoney(Array(100).fill(0.01))).toBe(1);
  });

  it("handles negatives (debits/credits netting)", () => {
    expect(sumMoney([100.05, -50.02, -50.03])).toBe(0);
  });

  it("returns 0 for an empty list", () => {
    expect(sumMoney([])).toBe(0);
  });

  it("stays exact across a large mixed list", () => {
    const vals = [1234.56, -1000.0, -234.55, -0.01];
    expect(sumMoney(vals)).toBe(0);
  });
});

describe("classifyCounterpart (cash-flow activity buckets)", () => {
  const acct = (type: string, subType?: string): CFAccount => ({
    id: "x",
    type,
    subType: subType ?? null,
    nameEn: "n",
  });

  it("income → operating", () => {
    expect(classifyCounterpart(acct("income"))).toBe("operating");
  });
  it("expense → operating", () => {
    expect(classifyCounterpart(acct("expense"))).toBe("operating");
  });
  it("fixed-asset → investing", () => {
    expect(classifyCounterpart(acct("asset", "fixed_asset"))).toBe("investing");
  });
  it("working-capital asset (AR/inventory) → operating", () => {
    expect(classifyCounterpart(acct("asset", "current_asset"))).toBe("operating");
  });
  it("long-term liability → financing", () => {
    expect(classifyCounterpart(acct("liability", "long_term_liability"))).toBe("financing");
  });
  it("current liability (AP/VAT) → operating", () => {
    expect(classifyCounterpart(acct("liability", "current_liability"))).toBe("operating");
  });
  it("equity → financing", () => {
    expect(classifyCounterpart(acct("equity"))).toBe("financing");
  });
  it("undefined account → operating (safe default)", () => {
    expect(classifyCounterpart(undefined)).toBe("operating");
  });
});

describe("isCashOrBankAccount", () => {
  it("matches by subType cash/bank", () => {
    expect(isCashOrBankAccount({ subType: "cash" })).toBe(true);
    expect(isCashOrBankAccount({ subType: "bank" })).toBe(true);
  });
  it("matches the 1010–1039 code range, exclusive above", () => {
    expect(isCashOrBankAccount({ code: "1010" })).toBe(true);
    expect(isCashOrBankAccount({ code: "1039" })).toBe(true);
    expect(isCashOrBankAccount({ code: "1040" })).toBe(false);
  });
  it("matches by name (cash/bank/petty)", () => {
    expect(isCashOrBankAccount({ nameEn: "Petty Cash" })).toBe(true);
    expect(isCashOrBankAccount({ nameEn: "Emirates NBD Bank" })).toBe(true);
  });
  it("is false for a plain receivable", () => {
    expect(isCashOrBankAccount({ code: "1100", nameEn: "Accounts Receivable" })).toBe(false);
  });
});

describe("evaluateCreditNoteRequest — invalid-amount branch", () => {
  it("rejects a non-positive requested amount (422)", () => {
    const d = evaluateCreditNoteRequest({
      invoiceType: "invoice",
      originalTotal: 1000,
      alreadyCreditedTotal: 0,
      requestedAmount: 0,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("INVALID_CREDIT_AMOUNT");
  });

  it("defaults to the full remaining balance when no amount is given", () => {
    const d = evaluateCreditNoteRequest({
      invoiceType: "invoice",
      originalTotal: 1000,
      alreadyCreditedTotal: 300,
    });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.creditable).toBe(700);
  });
});
