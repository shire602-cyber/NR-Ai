import { describe, expect, it } from "vitest";
import {
  allocateByPercent,
  computeRulePosting,
  isRegexSafe,
  ruleMatches,
  validateSplitShape,
} from "../../server/services/bank-rule-split";

describe("bank rule split", () => {
  it("D3-6: 1,050 with 5% VAT splits 900 / 100 and carves out 50 VAT", () => {
    const p = computeRulePosting({ gross: 1050, vatRate: 5, splitLines: [{ accountId: "a", percent: 90 }, { accountId: "b", percent: 10 }] });
    expect(p.vat).toBe(50);
    expect(p.net).toBe(1000);
    expect(p.shares.map((s) => s.amount)).toEqual([900, 100]);
  });

  it("33.33 / 33.33 / 33.34 of 100.01 adds up to the cent", () => {
    const p = computeRulePosting({ gross: 100.01, vatRate: 0, splitLines: [{ accountId: "a", percent: 33.33 }, { accountId: "b", percent: 33.33 }, { accountId: "c", percent: 33.34 }] });
    expect(p.shares.map((s) => s.amount)).toEqual([33.33, 33.33, 33.35]);
    expect(Math.round(p.shares.reduce((a, s) => a + s.amount, 0) * 100)).toBe(10001);
  });

  it("allocation never loses a fils", () => {
    for (const total of [1, 7, 99, 10001, 123457]) {
      const parts = allocateByPercent(total, [33.33, 33.33, 33.34]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
    expect(allocateByPercent(100, [50, 50])).toEqual([50, 50]);
  });

  it("validates the split shape", () => {
    expect(validateSplitShape([{ accountId: "a", percent: 100 }])).toBeNull();
    expect(validateSplitShape([])).toMatch(/1 to 10/);
    expect(validateSplitShape([{ accountId: "a", percent: 60 }, { accountId: "b", percent: 30 }])).toMatch(/add up/);
    expect(validateSplitShape([{ accountId: "a", percent: 0 }, { accountId: "b", percent: 100 }])).toMatch(/above 0/);
    expect(validateSplitShape(Array.from({ length: 11 }, () => ({ accountId: "a", percent: 100 / 11 })))).toMatch(/1 to 10/);
  });

  it("refuses regexes that can backtrack catastrophically", () => {
    expect(isRegexSafe("(a+)+$")).toBe(false);
    expect(isRegexSafe("(a|aa)+")).toBe(false);
    expect(isRegexSafe("(.*)*")).toBe(false);
    expect(isRegexSafe("(a)\\1")).toBe(false);
    expect(isRegexSafe("(")).toBe(false);
    expect(isRegexSafe("x".repeat(65))).toBe(false);
    expect(isRegexSafe("^DEWA.*\\d{4}$")).toBe(true);
    expect(isRegexSafe("(DEWA|ADDC) bill")).toBe(true);
    expect(isRegexSafe("[a+]+")).toBe(true);
  });

  const rule = { matchField: "description", matchType: "contains", matchValue: "dewa", direction: "outflow" } as const;
  const txn = { description: "DEWA payment", reference: null, amount: -1050, bankStatementAccountId: "ba1" };

  it("matches by field, type, direction, account and amount range", () => {
    expect(ruleMatches(rule, txn)).toBe(true);
    expect(ruleMatches({ ...rule, direction: "inflow" }, txn)).toBe(false);
    expect(ruleMatches({ ...rule, bankAccountId: "other" }, txn)).toBe(false);
    expect(ruleMatches({ ...rule, bankAccountId: "ba1", amountMin: 1000, amountMax: 1100 }, txn)).toBe(true);
    expect(ruleMatches({ ...rule, amountMax: 500 }, txn)).toBe(false);
    expect(ruleMatches({ ...rule, matchType: "starts_with", matchValue: "dew" }, txn)).toBe(true);
    expect(ruleMatches({ ...rule, matchType: "equals", matchValue: "dewa payment" }, txn)).toBe(true);
    expect(ruleMatches({ ...rule, matchType: "regex", matchValue: "^dewa\\s+pay" }, txn)).toBe(true);
    expect(ruleMatches({ ...rule, matchType: "regex", matchValue: "(a+)+$" }, { ...txn, description: "a".repeat(40) + "!" })).toBe(false);
  });

  it("a VAT rule never applies to an inflow", () => {
    expect(ruleMatches({ ...rule, direction: "any", vatRate: 5 }, { ...txn, amount: 100 })).toBe(false);
  });
});

import { ruleInputSchema } from "../../server/services/bank-rules.service";

describe("rule input without split lines", () => {
  it("defaults to a category-only rule (no lines) so older clients keep working", () => {
    const r = ruleInputSchema.parse({ name: "Salaries", matchValue: "SALARY", category: "Payroll" });
    expect(r.splitLines).toEqual([]);
    expect(r.vatRate).toBe(0);
  });
  it("still validates lines when they are sent", () => {
    expect(ruleInputSchema.safeParse({ name: "x", matchValue: "y", splitLines: Array.from({ length: 11 }, () => ({ accountId: "00000000-0000-4000-8000-000000000000", percent: 9 })) }).success).toBe(false);
  });
});
