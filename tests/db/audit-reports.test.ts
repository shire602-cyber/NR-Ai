import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

async function aging(t: Tenant, type: "receivables" | "payables", asOf: string) {
  const response = await t.as.get(
    `/api/companies/${t.company.id}/reports/aged-${type}?asOf=${asOf}`
  );
  expect(response.status, response.text).toBe(200);
  return response.body.reconciliation;
}

async function paidAssetBill(t: Tenant) {
  const asset = await accountByCode(t, "1250");
  const bank = await accountByCode(t, "1020");
  const bill = await t.as.post(`/api/companies/${t.company.id}/bills`, {
    vendor_name: "Vehicle dealer",
    bill_number: "CAR-1",
    bill_date: "2025-01-10",
    line_items: [
      { description: "Vehicle", quantity: 1, unit_price: 1000, vat_rate: 0, account_id: asset.id },
    ],
  });
  expect(bill.status, bill.text).toBe(200);
  const billUrl = `/api/bills/${bill.body.id}`;
  const approved = await t.as.post(`${billUrl}/approve`, {});
  expect(approved.status, approved.text).toBe(200);
  const paid = await t.as.post(`${billUrl}/payments`, {
    payment_date: "2025-02-10",
    amount: 1000,
    payment_account_id: bank.id,
  });
  expect(paid.status, paid.text).toBe(200);
  return `${billUrl}/payments/${paid.body.payment.id}/void`;
}

describe("Accounting audit: dated reversals and report tie-outs", () => {
  it("preserves the receivable written off at a month-end after a later reinstatement", async () => {
    const t = await h.createTenant({ planId: "professional" });
    const url = `/api/companies/${t.company.id}/invoices`;
    const invoice = await t.as.post(url, {
      date: "2025-01-10",
      dueDate: "2025-01-31",
      customerName: "Audit Customer",
      placeOfSupplyEmirate: "dubai",
      lines: [{ description: "Services", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(invoice.status, invoice.text).toBe(200);
    const id = invoice.body.id;
    const issued = await t.as.patch(`/api/invoices/${id}/status`, { status: "sent" });
    expect(issued.status, issued.text).toBe(200);
    const writeOff = await t.as.post(`${url}/${id}/write-off`, {
      date: "2025-06-05",
      reason: "Customer in liquidation",
    });
    expect(writeOff.status, writeOff.text).toBe(201);
    const before = await aging(t, "receivables", "2025-06-30");
    expect(before).toMatchObject({ glBalance: 0, agingTotal: 0, isReconciled: true });

    const restored = await t.as.post(`${url}/${id}/write-off/reinstate`, {
      date: "2025-07-10",
      reason: "Customer resumed trading",
    });
    expect(restored.status, restored.text).toBe(200);
    expect(await aging(t, "receivables", "2025-07-31")).toMatchObject({
      glBalance: 1050,
      agingTotal: 1050,
      isReconciled: true,
    });
    expect(await aging(t, "receivables", "2025-06-30")).toMatchObject({
      glBalance: 0,
      agingTotal: 0,
      isReconciled: true,
    });
  });

  it("voids an old bill payment on the same effective date in A/P aging and GL 2010", async () => {
    const t = await h.createTenant({ planId: "professional" });
    const voidUrl = await paidAssetBill(t);
    expect(await aging(t, "payables", "2025-02-28")).toMatchObject({
      glBalance: 0,
      agingTotal: 0,
      isReconciled: true,
    });
    const reversal = await t.as.post(voidUrl, { reason: "Payment returned" });
    expect(reversal.status, reversal.text).toBe(200);
    const after = await aging(t, "payables", "2025-02-28");
    expect(after.glBalance).toBe(1000);
    expect(after.agingTotal).toBe(after.glBalance);
  });

  it("nets a capital-asset bill payment and its void in the same cash-flow activity", async () => {
    const t = await h.createTenant({ planId: "professional" });
    const voidUrl = await paidAssetBill(t);
    const cf = `/api/companies/${t.company.id}/financial-statements/cash-flow?from=2025-02-01&to=2025-02-28`;
    const paid = await t.as.get(cf);
    expect(paid.status, paid.text).toBe(200);
    expect(paid.body).toMatchObject({ investing: { total: -1000 }, operating: { total: 0 } });
    const reversal = await t.as.post(voidUrl, { reason: "Payment returned" });
    expect(reversal.status, reversal.text).toBe(200);
    for (const method of ["direct", "indirect"]) {
      const reversed = await t.as.get(`${cf}&method=${method}`);
      expect(reversed.status, reversed.text).toBe(200);
      expect(reversed.body.cashProof).toMatchObject({ isBalanced: true, netCashChange: 0 });
      expect.soft(reversed.body, method).toMatchObject({
        operating: { total: 0 },
        investing: { total: 0 },
      });
    }
  });
});

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
