import { describe, expect, it } from "vitest";
import { operatingExpenseLinesOf } from "../../client/src/pages/financialStatementsLayout";

// F15 N5: cost-of-sales accounts are listed once, not again under expenses.
describe("P&L expense grouping", () => {
  const exp = [
    { accountId: "a1", accountCode: "5005", amount: 40 },
    { accountId: "a2", accountCode: "5007", amount: 10 },
    { accountId: "a3", accountCode: "6010", amount: 25 },
  ];
  it("drops cost-of-sales accounts from the expenses list", () => {
    const rest = operatingExpenseLinesOf(exp, [
      { accountId: "a1", accountCode: "5005" },
      { accountId: "a2", accountCode: "5007" },
    ]);
    expect(rest.map((r) => r.accountCode)).toEqual(["6010"]);
    expect(rest.reduce((s, r) => s + r.amount, 0)).toBe(25);
  });
  it("keeps everything when there is no cost of sales", () => {
    expect(operatingExpenseLinesOf(exp, [])).toHaveLength(3);
    expect(operatingExpenseLinesOf(exp, undefined)).toHaveLength(3);
  });
});
