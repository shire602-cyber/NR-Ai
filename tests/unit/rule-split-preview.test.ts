import { describe, expect, it } from "vitest";
import { MAX_SPLIT_LINES, evenSplit, previewPosting, ruleAccountOptions, splitIssues, splitTotal } from "../../client/src/components/banking/rule-split";

const line = (accountId: string, percent: number) => ({ accountId, percent });

describe("splitTotal", () => {
  it("adds percents without float drift", () => {
    expect(splitTotal([line("a", 33.33), line("b", 33.33), line("c", 33.34)])).toBe(100);
    expect(splitTotal([line("a", 0.1), line("b", 0.2)])).toBe(0.3);
    expect(splitTotal([])).toBe(0);
  });
});

describe("splitIssues", () => {
  it("accepts 1 to 10 lines that add up to 100", () => {
    expect(splitIssues([line("a", 100)])).toEqual([]);
    expect(splitIssues([line("a", 90), line("b", 10)])).toEqual([]);
  });
  it("flags an empty split, too many lines, a missing account, a bad percent and a wrong total", () => {
    expect(splitIssues([])).toContain("LINES_COUNT");
    expect(splitIssues(Array.from({ length: MAX_SPLIT_LINES + 1 }, (_, i) => line(`a${i}`, 100 / (MAX_SPLIT_LINES + 1))))).toContain("LINES_COUNT");
    expect(splitIssues([line("", 100)])).toContain("ACCOUNT_MISSING");
    expect(splitIssues([line("a", 0), line("b", 100)])).toContain("PERCENT_RANGE");
    expect(splitIssues([line("a", 60), line("b", 30)])).toContain("TOTAL_NOT_100");
  });
});

describe("evenSplit", () => {
  it("makes percents that add up to 100 exactly", () => {
    const three = evenSplit(["a", "b", "c"]);
    expect(three.map((l) => l.percent)).toEqual([33.34, 33.33, 33.33]);
    expect(splitTotal(three)).toBe(100);
    expect(evenSplit(["a"])).toEqual([{ accountId: "a", percent: 100 }]);
    expect(evenSplit([])).toEqual([]);
  });
});

describe("previewPosting", () => {
  it("carves 5% VAT out of the gross: 1,050 -> VAT 50, net 1,000, split 900/100", () => {
    const p = previewPosting({ gross: 1050, vatRate: 5, lines: [line("a", 90), line("b", 10)] });
    expect(p).toEqual({ gross: 1050, vat: 50, net: 1000, shares: [{ accountId: "a", amount: 900 }, { accountId: "b", amount: 100 }] });
  });
  it("posts the whole amount when there is no VAT", () => {
    const p = previewPosting({ gross: 250, vatRate: 0, lines: [line("a", 100)] });
    expect(p).toMatchObject({ vat: 0, net: 250, shares: [{ accountId: "a", amount: 250 }] });
  });
  it("allocates the cent remainder to the largest fraction (33.33/33.33/33.34 of 100.01 -> 33.33/33.33/33.35)", () => {
    const p = previewPosting({ gross: 100.01, vatRate: 0, lines: [line("a", 33.33), line("b", 33.33), line("c", 33.34)] });
    expect(p.shares.map((s) => s.amount)).toEqual([33.33, 33.33, 33.35]);
    expect(p.shares.reduce((s, x) => s + Math.round(x.amount * 100), 0)).toBe(10001);
  });
  it("rounds VAT half up in cents", () => {
    const p = previewPosting({ gross: 10.5, vatRate: 5, lines: [line("a", 100)] });
    expect(p.vat).toBe(0.5);
    expect(p.net).toBe(10);
  });
});

describe("ruleAccountOptions", () => {
  const acct = (id: string, code: string, nameEn: string, type: string, extra: Record<string, unknown> = {}) => ({ id, code, nameEn, type, ...extra });
  it("drops receivables, payables, VAT, bank and cash accounts and inactive ones", () => {
    const list = [
      acct("1", "1040", "Accounts Receivable", "asset"),
      acct("2", "2010", "Accounts Payable", "liability"),
      acct("3", "1050", "VAT Receivable (Input)", "asset"),
      acct("4", "2020", "VAT Payable (Output)", "liability"),
      acct("5", "1020", "Bank - Current", "asset"),
      acct("6", "1099", "Petty Cash Box", "asset"),
      acct("7", "5030", "Utilities", "expense"),
      acct("8", "5040", "Rent", "expense", { isActive: false }),
      acct("9", "4010", "Sales", "income"),
      acct("10", "1100", "Savings", "asset"),
    ];
    const out = ruleAccountOptions(list, [{ glAccountId: "10" }]).map((a) => a.code);
    expect(out).toEqual(["4010", "5030"]);
  });
});
