import { describe, expect, it } from "vitest";
import {
  buildYearEndClosingLines,
  fiscalYearContaining,
  fiscalYearRange,
  monthEndsOfFiscalYear,
} from "../../server/services/year-end";

const net = (lines: Array<{ accountId: string; debit: number; credit: number }>, id: string) =>
  Math.round(lines.filter((l) => l.accountId === id).reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100;
const balanced = (lines: Array<{ debit: number; credit: number }>) =>
  Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) === Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100);

describe("fiscalYearRange", () => {
  it("calendar year when the year starts in January", () => {
    expect(fiscalYearRange(1, 2026)).toEqual({ yearStart: "2026-01-01", yearEnd: "2026-12-31" });
  });
  it("a year starting in April ends the following March", () => {
    expect(fiscalYearRange(4, 2026)).toEqual({ yearStart: "2026-04-01", yearEnd: "2027-03-31" });
  });
  it("a September start ends 31 August; leap February is handled", () => {
    expect(fiscalYearRange(9, 2027)).toEqual({ yearStart: "2027-09-01", yearEnd: "2028-08-31" });
    expect(fiscalYearRange(3, 2027)).toEqual({ yearStart: "2027-03-01", yearEnd: "2028-02-29" });
  });
});

describe("fiscalYearContaining", () => {
  it("finds the fiscal year a date falls in", () => {
    expect(fiscalYearContaining(1, "2026-08-15")).toEqual({ yearStart: "2026-01-01", yearEnd: "2026-12-31" });
    expect(fiscalYearContaining(4, "2026-02-10")).toEqual({ yearStart: "2025-04-01", yearEnd: "2026-03-31" });
    expect(fiscalYearContaining(4, "2026-04-01")).toEqual({ yearStart: "2026-04-01", yearEnd: "2027-03-31" });
    expect(fiscalYearContaining(4, "2027-03-31")).toEqual({ yearStart: "2026-04-01", yearEnd: "2027-03-31" });
  });
});

describe("monthEndsOfFiscalYear", () => {
  it("twelve month ends, in order", () => {
    const m = monthEndsOfFiscalYear("2026-04-01", "2027-03-31");
    expect(m).toHaveLength(12);
    expect(m[0]).toBe("2026-04-30");
    expect(m[11]).toBe("2027-03-31");
  });
});

describe("buildYearEndClosingLines", () => {
  const accts = { retainedId: "RE" };

  it("profit: Dr income, Cr expense, balance to retained earnings (credit)", () => {
    const r = buildYearEndClosingLines(
      { income: [{ accountId: "REV", balance: 1000 }], expense: [{ accountId: "EXP", balance: 300 }] },
      accts
    );
    expect(balanced(r.lines)).toBe(true);
    expect(net(r.lines, "REV")).toBe(1000);
    expect(net(r.lines, "EXP")).toBe(-300);
    expect(net(r.lines, "RE")).toBe(-700);
    expect(r.netIncome).toBe(700);
  });

  it("loss: retained earnings is debited", () => {
    const r = buildYearEndClosingLines(
      { income: [{ accountId: "REV", balance: 200 }], expense: [{ accountId: "EXP", balance: 500 }] },
      accts
    );
    expect(balanced(r.lines)).toBe(true);
    expect(net(r.lines, "RE")).toBe(300);
    expect(r.netIncome).toBe(-300);
  });

  it("contra balances (negative income / expense) close on the opposite side", () => {
    const r = buildYearEndClosingLines(
      { income: [{ accountId: "REV", balance: 1000 }, { accountId: "DISC", balance: -100 }], expense: [{ accountId: "EXP", balance: 300 }, { accountId: "REFUND", balance: -20 }] },
      accts
    );
    expect(balanced(r.lines)).toBe(true);
    expect(net(r.lines, "DISC")).toBe(-100); // credited to clear a debit balance
    expect(net(r.lines, "REFUND")).toBe(20);
    expect(r.netIncome).toBe(1000 - 100 - 300 + 20);
  });

  it("zero-balance accounts produce no lines and nothing to close produces none at all", () => {
    expect(buildYearEndClosingLines({ income: [{ accountId: "REV", balance: 0 }], expense: [] }, accts).lines).toEqual([]);
    expect(buildYearEndClosingLines({ income: [], expense: [] }, accts).netIncome).toBe(0);
  });

  it("is exact to the fils for awkward decimals", () => {
    const r = buildYearEndClosingLines(
      { income: [{ accountId: "A", balance: 1234.57 }, { accountId: "B", balance: 0.1 }], expense: [{ accountId: "C", balance: 999.99 }, { accountId: "D", balance: 0.2 }] },
      accts
    );
    expect(balanced(r.lines)).toBe(true);
    expect(r.netIncome).toBe(234.48);
  });

  it("income and expense that net to exactly zero still closes each account, with no retained-earnings line", () => {
    const r = buildYearEndClosingLines({ income: [{ accountId: "REV", balance: 500 }], expense: [{ accountId: "EXP", balance: 500 }] }, accts);
    expect(balanced(r.lines)).toBe(true);
    expect(r.lines.map((l) => l.accountId).sort()).toEqual(["EXP", "REV"]);
    expect(r.netIncome).toBe(0);
  });
});
