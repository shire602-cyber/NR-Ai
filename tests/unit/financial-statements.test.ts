import { describe, it, expect } from "vitest";
import {
  classifyBalanceSheetAccount,
  computeCashFlow,
  revalueForeignBalance,
  buildFxRevaluationLines,
  type CFAccount,
} from "../../server/services/financial-statements";

describe("buildFxRevaluationLines (A-B8)", () => {
  const accounts = { arId: "ar", apId: "ap", fxGainId: "gain", fxLossId: "loss" };

  it("posts a net AR gain to FX gain, balanced", () => {
    const r = buildFxRevaluationLines({ receivableRevalAed: 80, payableRevalAed: 0, accounts });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines).toContainEqual(expect.objectContaining({ accountId: "ar", debit: 80, credit: 0 }));
      expect(r.lines).toContainEqual(expect.objectContaining({ accountId: "gain", debit: 0, credit: 80 }));
      const dr = r.lines.reduce((s, l) => s + l.debit, 0);
      const cr = r.lines.reduce((s, l) => s + l.credit, 0);
      expect(dr).toBe(cr);
    }
  });

  it("nets a mixed AR gain + AP loss to the correct P&L side, balanced", () => {
    // AR gain 100 (Dr AR), AP loss -30 (Cr AP) -> net +70 -> Cr FX gain 70.
    const r = buildFxRevaluationLines({ receivableRevalAed: 100, payableRevalAed: -30, accounts });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const dr = r.lines.reduce((s, l) => s + l.debit, 0);
      const cr = r.lines.reduce((s, l) => s + l.credit, 0);
      expect(dr).toBe(100);
      expect(cr).toBe(100);
      expect(r.lines.find((l) => l.accountId === "gain")?.credit).toBe(70);
    }
  });

  it("posts a net loss to FX loss", () => {
    const r = buildFxRevaluationLines({ receivableRevalAed: -50, payableRevalAed: 0, accounts });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines.find((l) => l.accountId === "loss")?.debit).toBe(50);
  });

  it("returns NO_REVALUATION when nothing is open", () => {
    const r = buildFxRevaluationLines({ receivableRevalAed: 0, payableRevalAed: 0, accounts });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_REVALUATION");
  });
});

describe("revalueForeignBalance (A-B4: AED-per-foreign convention)", () => {
  it("values a receivable as foreignAmount * rate (multiply, never divide)", () => {
    // 1,000 USD booked at 3.67, now 3.75 -> gain of 80 AED.
    const r = revalueForeignBalance({
      foreignAmount: 1000,
      bookRateAedPerUnit: 3.67,
      currentRateAedPerUnit: 3.75,
      kind: "receivable",
    });
    expect(r.bookValueAed).toBe(3670);
    expect(r.currentValueAed).toBe(3750);
    expect(r.unrealizedGainLoss).toBe(80);
  });

  it("flips the sign for a payable", () => {
    const r = revalueForeignBalance({
      foreignAmount: 1000,
      bookRateAedPerUnit: 3.67,
      currentRateAedPerUnit: 3.75,
      kind: "payable",
    });
    expect(r.unrealizedGainLoss).toBe(-80); // higher AED cost = loss on a payable
  });
});

describe("classifyBalanceSheetAccount (A-2: abnormal-balance reclassification)", () => {
  it("keeps a normal-balance asset in assets", () => {
    expect(classifyBalanceSheetAccount({ type: "asset", debitTotal: 5000, creditTotal: 0 })).toEqual({
      section: "asset",
      amount: 5000,
    });
  });

  it("reclassifies a net-credit receivable to liabilities (the void-AR case)", () => {
    // AR after a voided paid invoice: Dr 5250 / Cr 10500 -> net credit 5250.
    expect(
      classifyBalanceSheetAccount({ type: "asset", debitTotal: 5250, creditTotal: 10500 })
    ).toEqual({ section: "liability", amount: 5250 });
  });

  it("keeps a normal-balance liability in liabilities", () => {
    expect(classifyBalanceSheetAccount({ type: "liability", debitTotal: 0, creditTotal: 250 })).toEqual(
      { section: "liability", amount: 250 }
    );
  });

  it("reclassifies a net-debit payable to assets", () => {
    expect(classifyBalanceSheetAccount({ type: "liability", debitTotal: 100, creditTotal: 0 })).toEqual(
      { section: "asset", amount: 100 }
    );
  });

  it("rolls income and expense out as retained-earnings contributions", () => {
    expect(classifyBalanceSheetAccount({ type: "income", debitTotal: 0, creditTotal: 5000 })).toEqual({
      section: "income",
      amount: 5000,
    });
    expect(classifyBalanceSheetAccount({ type: "expense", debitTotal: 1000, creditTotal: 0 })).toEqual({
      section: "expense",
      amount: -1000,
    });
  });
});

describe("computeCashFlow (A-3: direct method ties to cash movement)", () => {
  const accounts: CFAccount[] = [
    { id: "bank", type: "asset", subType: "current_asset", code: "1020", nameEn: "Bank Accounts" },
    { id: "ar", type: "asset", subType: "current_asset", code: "1040", nameEn: "Accounts Receivable" },
    { id: "rev", type: "income", subType: null, code: "4010", nameEn: "Product Sales" },
    { id: "vat", type: "liability", subType: "current_liability", code: "2020", nameEn: "VAT Payable" },
    { id: "cap", type: "equity", subType: null, code: "3010", nameEn: "Owner's Capital" },
    { id: "equip", type: "asset", subType: "fixed_asset", code: "1210", nameEn: "Equipment" },
  ];

  it("excludes the cash account as a line and ties net change to cash movement", () => {
    const entries = [
      // Unpaid invoice — no cash, must be ignored entirely.
      { lines: [
        { accountId: "ar", debit: 5250, credit: 0 },
        { accountId: "rev", debit: 0, credit: 5000 },
        { accountId: "vat", debit: 0, credit: 250 },
      ] },
      // Payment received — Dr Bank / Cr AR.
      { lines: [
        { accountId: "bank", debit: 5250, credit: 0 },
        { accountId: "ar", debit: 0, credit: 5250 },
      ] },
      // Owner capital injection — Dr Bank / Cr Capital.
      { lines: [
        { accountId: "bank", debit: 100, credit: 0 },
        { accountId: "cap", debit: 0, credit: 100 },
      ] },
    ];
    const cf = computeCashFlow({ entries, accounts });
    expect(cf.operating.total).toBe(5250); // collection of receivable
    expect(cf.financing.total).toBe(100); // capital
    expect(cf.investing.total).toBe(0);
    expect(cf.netCashChange).toBe(5350); // == actual bank movement
    // No bank/cash account appears as a breakdown line anywhere.
    const allLines = [
      ...cf.operating.breakdown,
      ...cf.investing.breakdown,
      ...cf.financing.breakdown,
    ];
    expect(allLines.some((l) => l.accountId === "bank")).toBe(false);
  });

  it("classifies a cash fixed-asset purchase as investing outflow", () => {
    const entries = [
      { lines: [
        { accountId: "equip", debit: 1000, credit: 0 },
        { accountId: "bank", debit: 0, credit: 1000 },
      ] },
    ];
    const cf = computeCashFlow({ entries, accounts });
    expect(cf.investing.total).toBe(-1000);
    expect(cf.netCashChange).toBe(-1000);
  });
});

describe("contra-asset presentation", () => {
  it("keeps Accumulated Depreciation inside assets as a negative, not as a liability", () => {
    // 1240 normally carries a credit balance. Presenting it as a liability
    // overstated assets AND liabilities and hid net book value.
    const r = classifyBalanceSheetAccount({
      type: "asset",
      code: "1240",
      debitTotal: 0,
      creditTotal: 1000,
    });
    expect(r.section).toBe("asset");
    expect(r.amount).toBe(-1000);
  });

  it("still reclassifies a genuinely abnormal asset balance as a liability", () => {
    // A receivable in credit really is a customer-credit liability.
    const r = classifyBalanceSheetAccount({
      type: "asset",
      code: "1040",
      debitTotal: 0,
      creditTotal: 500,
    });
    expect(r.section).toBe("liability");
    expect(r.amount).toBe(500);
  });

  it("nets fixed assets against accumulated depreciation to book value", () => {
    const cost = classifyBalanceSheetAccount({ type: "asset", code: "1290", debitTotal: 36000, creditTotal: 0 });
    const accDep = classifyBalanceSheetAccount({ type: "asset", code: "1240", debitTotal: 0, creditTotal: 1000 });
    expect(cost.section).toBe("asset");
    expect(accDep.section).toBe("asset");
    expect(cost.amount + accDep.amount).toBe(35000); // net book value
  });
});
