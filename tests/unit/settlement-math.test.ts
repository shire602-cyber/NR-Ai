import { describe, it, expect } from "vitest";
import { computeSettlement } from "../../server/services/settlement-math";

const base = { gratuityAmount: 15750, provisionDefault: 10500, provisionBalance: 10500, basic: 6000, leaveDays: 4, loanOutstanding: 0, otherDeductions: 0 };

describe("computeSettlement (D2-9)", () => {
  it("true-up = gratuity - provision; leave encashment = days x basic/30; net = gratuity + leave - loan - other", () => {
    const r = computeSettlement({ ...base, provisionOverride: 10500 });
    expect(r).toEqual({ ok: true, gratuityAmount: 15750, provisionUsed: 10500, gratuityTrueUp: 5250, leaveEncashment: 800, loanRecovered: 0, otherDeductions: 0, netPayable: 16550 });
  });

  it("an over-accrued provision releases the difference (negative true-up)", () => {
    const r = computeSettlement({ ...base, gratuityAmount: 9000, provisionOverride: 10500 });
    expect(r).toMatchObject({ ok: true, gratuityTrueUp: -1500, netPayable: 9800 });
  });

  it("the provision used defaults to the accrual to date, never more than the 2036 balance", () => {
    expect(computeSettlement({ ...base }).provisionUsed).toBe(10500);
    expect(computeSettlement({ ...base, provisionDefault: 12000, provisionBalance: 9000 }).provisionUsed).toBe(9000);
  });

  it("an override above the 2036 balance is refused", () => {
    expect(computeSettlement({ ...base, provisionOverride: 11000 })).toMatchObject({ ok: false, code: "PROVISION_EXCEEDS_BALANCE" });
  });

  it("the loan still owed and other deductions come off the net; a negative net is refused", () => {
    const r = computeSettlement({ ...base, loanOutstanding: 3000, otherDeductions: 250 });
    expect(r).toMatchObject({ ok: true, loanRecovered: 3000, otherDeductions: 250, netPayable: 13300 });
    expect(computeSettlement({ ...base, loanOutstanding: 20000 })).toMatchObject({ ok: false, code: "SETTLEMENT_NEGATIVE" });
  });

  it("a GCC national has no gratuity: only leave and deductions", () => {
    const r = computeSettlement({ ...base, gratuityAmount: 0, provisionDefault: 0, provisionBalance: 0 });
    expect(r).toMatchObject({ ok: true, provisionUsed: 0, gratuityTrueUp: 0, netPayable: 800 });
  });
});
