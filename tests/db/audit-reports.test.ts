import { expect, it } from "vitest";
import { accountByCode, useHarness } from "./harness";

const h = useHarness();

it("keeps general-ledger closing balances tied to the trial balance above the detail limit", async () => {
  const t = await h.createTenant();
  const bank = await accountByCode(t, "1020");
  const sales = await accountByCode(t, "4010");
  // A bulk fixture keeps the large-ledger case practical: each posted AED 1 sale is balanced.
  await h.sql(
    `WITH entries AS (
       INSERT INTO journal_entries (company_id, entry_number, date, created_by, status)
       SELECT $1, 'AUDIT-' || n, '2025-02-01', $2, 'posted' FROM generate_series(1, 25001) n
       RETURNING id
     )
     INSERT INTO journal_lines (entry_id, account_id, debit, credit)
     SELECT e.id, leg.account_id, leg.debit, leg.credit
       FROM entries e CROSS JOIN (VALUES ($3::uuid,1,0), ($4::uuid,0,1)) leg(account_id,debit,credit)`,
    [t.company.id, t.user.id, bank.id, sales.id]
  );
  const { balanceSheet, generalLedger, profitAndLoss, trialBalance } =
    await import("../../server/reporting/statements");
  const period = { companyId: t.company.id, from: "2025-02-01", to: "2025-02-28" };
  const tb = await trialBalance(period);
  expect(tb.totals).toMatchObject({ sumDebits: 25001, sumCredits: 25001, difference: 0 });
  const pl = await profitAndLoss(period);
  const bs = await balanceSheet({ companyId: t.company.id, asOf: period.to });
  expect(pl.netProfit).toBe(25001);
  expect(bs.equity.currentYearEarnings).toBe(pl.netProfit);
  expect(bs.totalAssets).toBe(25001);
  expect(bs.isBalanced).toBe(true);
  const gl = await generalLedger(period);
  expect(gl.accounts.find((a) => a.accountId === bank.id)?.closingBalance).toBe(25001);
  expect(gl.totals).toEqual({ debit: 25001, credit: 25001 });
});

it("counts each budgeted month once when the P&L covers more than one year", async () => {
  const t = await h.createTenant({ planId: "professional" });
  const base = `/api/companies/${t.company.id}`;
  const plan = await t.as.post(`${base}/budget-plans`, {
    name: "2025 sales plan",
    fiscalYear: 2025,
    startDate: "2025-01-01",
    endDate: "2025-12-31",
  });
  expect(plan.status, plan.text).toBe(201);
  const sales = await accountByCode(t, "4010");
  const planUrl = `/api/budget-plans/${plan.body.id}`;
  const line = await t.as.post(`${planUrl}/lines`, {
    category: "Sales",
    accountId: sales.id,
    jan: 1000,
  });
  expect(line.status, line.text).toBe(201);
  const budget = await t.as.get(`${planUrl}/variance`);
  expect(budget.status, budget.text).toBe(200);
  expect(budget.body.varianceLines[0].totals.budget).toBe(1000);

  // The selected plan funds January 2025 once. January 2026 has no allocation from it.
  const pl = await t.as.get(
    `${base}/reports/profit-loss?from=2025-01-01&to=2026-01-31&compareTo=budget&budgetId=${plan.body.id}`
  );
  expect(pl.status, pl.text).toBe(200);
  expect(pl.body.comparison.totals.revenue).toBe(budget.body.varianceLines[0].totals.budget);
});
