import { describe, expect, it } from "vitest";
import { buildBankEntryLines, reverseLines } from "../../server/services/bank-entry-lines";

const sum = (lines: Array<{ debit: number; credit: number }>) => ({
  dr: Math.round(lines.reduce((a, l) => a + l.debit, 0) * 100) / 100,
  cr: Math.round(lines.reduce((a, l) => a + l.credit, 0) * 100) / 100,
});

describe("bank entry lines", () => {
  it("outflow: Dr contra, Cr bank", () => {
    const lines = buildBankEntryLines({ amount: -1050, bankGlAccountId: "bank", contra: [{ accountId: "exp", amount: 1000 }, { accountId: "vat", amount: 50 }], currency: "AED", rate: 1, description: "DEWA" });
    expect(lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([["exp", 1000, 0], ["vat", 50, 0], ["bank", 0, 1050]]);
  });

  it("inflow: Dr bank, Cr contra", () => {
    const lines = buildBankEntryLines({ amount: 500, bankGlAccountId: "bank", contra: [{ accountId: "rev", amount: 500 }], currency: "AED", rate: 1, description: "x" });
    expect(lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([["bank", 500, 0], ["rev", 0, 500]]);
  });

  it("a USD account converts at the rate, keeps the foreign amount on the bank line and balances with the residue on the largest line", () => {
    const lines = buildBankEntryLines({ amount: -100.01, bankGlAccountId: "bank", contra: [{ accountId: "a", amount: 33.33 }, { accountId: "b", amount: 33.33 }, { accountId: "c", amount: 33.35 }], currency: "USD", rate: 3.6725, description: "x" });
    const t = sum(lines);
    expect(t.dr).toBe(t.cr);
    const bank = lines.find((l) => l.accountId === "bank")!;
    expect(bank.credit).toBe(367.29);
    expect(bank.foreignCurrency).toBe("USD");
    expect(bank.foreignCredit).toBe(100.01);
    expect(bank.exchangeRate).toBe(3.6725);
  });

  it("refuses contra lines that do not add up", () => {
    expect(() => buildBankEntryLines({ amount: -100, bankGlAccountId: "b", contra: [{ accountId: "a", amount: 99 }], currency: "AED", rate: 1, description: "x" })).toThrow(/add up/);
  });

  it("reversal swaps debit, credit and the foreign amounts", () => {
    const r = reverseLines([{ accountId: "bank", debit: 0, credit: 367.29, foreignCurrency: "USD", foreignDebit: 0, foreignCredit: 100.01, exchangeRate: 3.6725 }], "Unmatched");
    expect(r[0]).toMatchObject({ debit: 367.29, credit: 0, foreignDebit: 100.01, foreignCredit: 0 });
  });
});
