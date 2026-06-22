import { describe, it, expect } from "vitest";
import {
  classifyBalanceSheetAccount,
  computeCashFlow,
  revalueForeignBalance,
  type CFAccount,
} from "../../server/services/financial-statements";

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
