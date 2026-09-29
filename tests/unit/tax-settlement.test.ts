import { describe, expect, it } from "vitest";
import {
  buildClearingLines,
  buildCtAccrualLines,
  buildSettlementPaymentLines,
  remainingToSettle,
  settlementFigures,
  vatSettlementFromDifference,
} from "../../server/services/tax-settlement";

const OUT = "acc-output";
const IN = "acc-input";
const CTRL = "acc-control";
const BANK = "acc-bank";

const sum = (lines: Array<{ debit: number; credit: number }>, k: "debit" | "credit") =>
  Math.round(lines.reduce((s, l) => s + l[k], 0) * 100) / 100;
const balanced = (lines: Array<{ debit: number; credit: number }>) => sum(lines, "debit") === sum(lines, "credit");
const net = (lines: Array<{ accountId: string; debit: number; credit: number }>, id: string) =>
  Math.round(lines.filter((l) => l.accountId === id).reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100;

describe("settlementFigures", () => {
  it("reads output, input and net from the filed boxes", () => {
    expect(settlementFigures({ box12TotalDueTax: 150, box13RecoverableTax: 40, box14PayableTax: 110 })).toEqual({
      ok: true, outputVat: 150, inputVat: 40, net: 110,
    });
  });

  it("refuses a return whose box 14 is not box 12 minus box 13 (to the fils)", () => {
    expect(settlementFigures({ box12TotalDueTax: 150, box13RecoverableTax: 40, box14PayableTax: 109.99 })).toMatchObject({
      ok: false, code: "VAT_BOXES_DO_NOT_TIE",
    });
  });

  it("does not trip on float noise", () => {
    expect(settlementFigures({ box12TotalDueTax: 0.3, box13RecoverableTax: 0.1, box14PayableTax: 0.2 }).ok).toBe(true);
  });
});

describe("vatSettlementFromDifference (amendment)", () => {
  it("settles only the difference of output, input and net", () => {
    const orig = { box12TotalDueTax: 100, box13RecoverableTax: 30, box14PayableTax: 70 };
    const amended = { box12TotalDueTax: 125, box13RecoverableTax: 30, box14PayableTax: 95 };
    expect(vatSettlementFromDifference(orig, amended)).toEqual({ ok: true, outputVat: 25, inputVat: 0, net: 25 });
  });

  it("can turn a payable return into an extra refund", () => {
    const orig = { box12TotalDueTax: 100, box13RecoverableTax: 30, box14PayableTax: 70 };
    const amended = { box12TotalDueTax: 100, box13RecoverableTax: 90, box14PayableTax: 10 };
    expect(vatSettlementFromDifference(orig, amended)).toEqual({ ok: true, outputVat: 0, inputVat: 60, net: -60 });
  });
});

describe("buildClearingLines (posted at filing)", () => {
  it("payable return: Dr output, Cr input, Cr FTA control for the net", () => {
    const lines = buildClearingLines({ outputVat: 150, inputVat: 40, net: 110 }, { outputId: OUT, inputId: IN, controlId: CTRL });
    expect(balanced(lines)).toBe(true);
    expect(net(lines, OUT)).toBe(150);
    expect(net(lines, IN)).toBe(-40);
    expect(net(lines, CTRL)).toBe(-110);
  });

  it("refundable return: the mirror, control account carries a debit (refund due)", () => {
    const lines = buildClearingLines({ outputVat: 20, inputVat: 70, net: -50 }, { outputId: OUT, inputId: IN, controlId: CTRL });
    expect(balanced(lines)).toBe(true);
    expect(net(lines, OUT)).toBe(20);
    expect(net(lines, IN)).toBe(-70);
    expect(net(lines, CTRL)).toBe(50);
  });

  it("zero net: output and input clear against each other, no control line", () => {
    const lines = buildClearingLines({ outputVat: 40, inputVat: 40, net: 0 }, { outputId: OUT, inputId: IN, controlId: CTRL });
    expect(balanced(lines)).toBe(true);
    expect(lines.map((l) => l.accountId).sort()).toEqual([IN, OUT]);
  });

  it("nothing to clear produces no lines", () => {
    expect(buildClearingLines({ outputVat: 0, inputVat: 0, net: 0 }, { outputId: OUT, inputId: IN, controlId: CTRL })).toEqual([]);
  });

  it("a negative output total (credit notes exceed sales) is a credit to the output account", () => {
    const lines = buildClearingLines({ outputVat: -10, inputVat: 5, net: -15 }, { outputId: OUT, inputId: IN, controlId: CTRL });
    expect(balanced(lines)).toBe(true);
    expect(net(lines, OUT)).toBe(-10);
  });

  it("balances to the fils for awkward decimals", () => {
    const lines = buildClearingLines({ outputVat: 1234.57, inputVat: 233.33, net: 1001.24 }, { outputId: OUT, inputId: IN, controlId: CTRL });
    expect(balanced(lines)).toBe(true);
  });
});

describe("buildSettlementPaymentLines", () => {
  it("pay the FTA: Dr control, Cr bank", () => {
    const lines = buildSettlementPaymentLines({ direction: "pay", amount: 110, bankId: BANK, controlId: CTRL, label: "VAT" });
    expect(balanced(lines)).toBe(true);
    expect(net(lines, CTRL)).toBe(110);
    expect(net(lines, BANK)).toBe(-110);
  });

  it("receive a refund: Dr bank, Cr control", () => {
    const lines = buildSettlementPaymentLines({ direction: "receive", amount: 50, bankId: BANK, controlId: CTRL, label: "VAT" });
    expect(balanced(lines)).toBe(true);
    expect(net(lines, BANK)).toBe(50);
    expect(net(lines, CTRL)).toBe(-50);
  });
});

describe("remainingToSettle", () => {
  it("payable: net minus payments so far", () => {
    expect(remainingToSettle(110, [40, 30])).toEqual({ direction: "pay", remaining: 40 });
  });

  it("refundable: works on the absolute refund", () => {
    expect(remainingToSettle(-50, [20])).toEqual({ direction: "receive", remaining: 30 });
  });

  it("is exact to the fils across many partial payments", () => {
    expect(remainingToSettle(100, [33.33, 33.33, 33.34])).toEqual({ direction: "pay", remaining: 0 });
    expect(remainingToSettle(0.3, [0.1, 0.2])).toEqual({ direction: "pay", remaining: 0 });
  });

  it("zero net has nothing to settle", () => {
    expect(remainingToSettle(0, [])).toEqual({ direction: "none", remaining: 0 });
  });
});

describe("buildCtAccrualLines (corporate tax at filing)", () => {
  it("Dr Corporate Tax Expense, Cr Corporate Tax Payable", () => {
    const lines = buildCtAccrualLines(4500.5, { expenseId: "exp", payableId: "pay" });
    expect(balanced(lines)).toBe(true);
    expect(net(lines, "exp")).toBe(4500.5);
    expect(net(lines, "pay")).toBe(-4500.5);
  });

  it("an amendment that lowers the tax reverses part of it: Dr payable, Cr expense", () => {
    const lines = buildCtAccrualLines(-300, { expenseId: "exp", payableId: "pay" });
    expect(balanced(lines)).toBe(true);
    expect(net(lines, "exp")).toBe(-300);
    expect(net(lines, "pay")).toBe(300);
  });

  it("nothing to accrue when tax payable is zero", () => {
    expect(buildCtAccrualLines(0, { expenseId: "exp", payableId: "pay" })).toEqual([]);
  });
});
