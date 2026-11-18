/**
 * E2 (J3-r2 / J4-r2) launch fixes: budgets, VAT filing, fixed assets, role gating, fiscal-year
 * defaults, payroll UX. Pure-function behaviour tests; page render tests live in
 * tests/unit/e2-launch-ui.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  budgetAccountOptions,
  isIncomeLine,
  planMonths,
  signedLineTotals,
  summariseBudget,
} from "../../client/src/lib/budget-summary";
import { isControlAccount } from "../../shared/control-accounts";
import { budgetLineCreateBody } from "../../shared/validators/budgets";

describe("[E2][J3-r2] budgets: partial-year plans", () => {
  it("a Sep-Nov plan covers three months, keyed like the variance report", () => {
    expect(planMonths("2026-09-01", "2026-11-30")).toEqual([
      { key: "2026-09", column: "sep", month: 9, year: 2026 },
      { key: "2026-10", column: "oct", month: 10, year: 2026 },
      { key: "2026-11", column: "nov", month: 11, year: 2026 },
    ]);
  });
  it("a Nov-Oct fiscal-year plan crosses the calendar year and stops at 12 months", () => {
    const m = planMonths("2025-11-01", "2026-10-31");
    expect(m).toHaveLength(12);
    expect(m[0].key).toBe("2025-11");
    expect(m[11]).toMatchObject({ key: "2026-10", column: "oct" });
    expect(planMonths("2025-01-01", "2027-12-31")).toHaveLength(12);
  });
  it("missing or malformed dates give no months (no crash)", () => {
    expect(planMonths(null, "2026-01-01")).toEqual([]);
    expect(planMonths("garbage", "2026-01-01")).toEqual([]);
  });
});

describe("[E2][J3-r2] budgets: income and expenses are never added together", () => {
  const lines = [
    { category: "Revenue", account_id: "rev", nov: "4500", annual_total: "4500" },
    {
      category: "Salaries & Wages",
      account_id: "sal",
      sep: "77000",
      oct: "72000",
      annual_total: "149000",
    },
  ];
  const types: Record<string, string> = { rev: "income", sal: "expense" };
  it("detail totals split income / expenses and net = income - expenses", () => {
    const t = signedLineTotals(lines, (l) => types[l.account_id]);
    expect(t.income.nov).toBe(4500);
    expect(t.expense.nov).toBe(0);
    expect(t.expense.sep).toBe(77000);
    expect(t.income.annual).toBe(4500);
    expect(t.expense.annual).toBe(149000);
    expect(t.net.annual).toBe(4500 - 149000);
    expect(t.net.nov).toBe(4500);
  });
  it("variance summary: a revenue line counts as income (account type first, then category)", () => {
    const s = summariseBudget([
      { accountType: "income", totals: { budget: 4500, actual: 4500 } },
      { accountType: "expense", totals: { budget: 149000, actual: 149100 } },
      { accountType: null, category: "Revenue", totals: { budget: 100, actual: 0 } },
    ]);
    expect(s.income.budget).toBe(4600);
    expect(s.expense.budget).toBe(149000);
    expect(s.net.budget).toBe(4600 - 149000);
    expect(isIncomeLine({ accountType: "expense", category: "Revenue" })).toBe(false);
  });
});

describe("[E2][J3-r2] budgets: a line needs an income or expense account", () => {
  it("the account picker offers active P&L accounts and no control accounts", () => {
    const accts = [
      { id: "1", code: "4010", type: "income", isActive: true },
      { id: "2", code: "5020", type: "expense", isActive: true },
      { id: "3", code: "1020", type: "asset", isActive: true },
      { id: "4", code: "6000", type: "expense", isActive: false },
      { id: "5", code: "2020", type: "expense", isVatAccount: true },
    ];
    expect(budgetAccountOptions(accts, (a) => isControlAccount(a)).map((a) => a.code)).toEqual([
      "4010",
      "5020",
    ]);
  });
  it("the create validator refuses a line without accountId", () => {
    expect(budgetLineCreateBody.safeParse({ category: "Rent", sep: 10 }).success).toBe(false);
    expect(
      budgetLineCreateBody.safeParse({
        category: "Rent",
        accountId: "11111111-1111-4111-8111-111111111111",
        sep: 10,
      }).success
    ).toBe(true);
  });
});
