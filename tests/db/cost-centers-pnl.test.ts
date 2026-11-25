/**
 * W4-B cost centres: R10-10 (Unallocated row reconciles to the company P&L), R10-11 (cost centre
 * flows from invoice / bill / depreciation lines into journal lines), R10-18 (hierarchy roll-up,
 * types, budgets), R10-19 (Arabic name).
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

async function center(t: Tenant, body: Record<string, unknown>) {
  const r = await t.as.post(`/api/companies/${t.company.id}/cost-centers`, body);
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string };
}

describe("W4-B cost centres", () => {
  it("[R10-19][R10-18] cost centres carry an Arabic name and a type (cost_centre | project | job); a cycle is refused", async () => {
    const t = await h.createTenant({ planId: "enterprise" });
    const p = await center(t, { code: "DXB", name: "Dubai", nameAr: "دبي" });
    const job = await center(t, { code: "J-1", name: "Fit-out job", type: "job", parentId: p.id });
    const row = await h.sql(`SELECT name_ar, type FROM cost_centers WHERE id = $1`, [p.id]);
    expect(row[0]).toEqual({ name_ar: "دبي", type: "cost_centre" });
    const bad = await t.as.post(`/api/companies/${t.company.id}/cost-centers`, {
      code: "X",
      name: "X",
      type: "department",
    });
    expect(bad.status).toBe(400);
    const cycle = await t.as.put(`/api/cost-centers/${p.id}`, { parentId: job.id });
    expect(cycle.status).toBe(422);
    expect(cycle.body.code).toBe("COST_CENTER_CYCLE");
  });

  it("[CI-C1] GET /cost-centers/:id/report answers 200 (an id array was bound as a tuple, giving 400 INVALID_IDENTIFIER)", async () => {
    const t = await h.createTenant({ planId: "enterprise" });
    const parent = await center(t, { code: "HQ", name: "Head office" });
    const child = await center(t, { code: "HQ-1", name: "Branch", parentId: parent.id });
    const single = await t.as.get(
      `/api/companies/${t.company.id}/cost-centers/${parent.id}/report`
    );
    expect(single.status, single.text).toBe(200);
    expect(single.body.includedCostCenterIds).toEqual([parent.id]);
    const rolled = await t.as.get(
      `/api/companies/${t.company.id}/cost-centers/${parent.id}/report?includeChildren=true`
    );
    expect(rolled.status, rolled.text).toBe(200);
    expect(rolled.body.includedCostCenterIds).toEqual([parent.id, child.id]);
  });

  it("[R10-11] invoice lines and tagged bill lines carry their cost centre into the journal", async () => {
    const t = await h.createTenant({ planId: "enterprise" });
    const cc = await center(t, { code: "AUH", name: "Abu Dhabi" });
    const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Acme",
      date: today(),
      lines: [
        { description: "Work", quantity: 1, unitPrice: 1000, vatRate: 5, costCenterId: cc.id },
      ],
    });
    expect(inv.status, inv.text).toBe(200);
    expect(
      (await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" })).status
    ).toBe(200);
    const invLines = await h.sql(
      `SELECT jl.cost_center_id FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.source_id = $1 AND a.code = '4020'`,
      [inv.body.id]
    );
    expect(invLines[0].cost_center_id).toBe(cc.id);
    const bill = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Supplier",
      vendor_trn: "100000000000003",
      bill_number: "B-CC-1",
      bill_date: today(),
      line_items: [{ description: "Rent share", quantity: 1, unit_price: 400, vat_rate: 5 }],
    });
    expect(bill.status, bill.text).toBe(200);
    const lineIds = (
      await h.sql(`SELECT id FROM bill_line_items WHERE bill_id = $1`, [bill.body.id])
    ).map((r) => r.id);
    const tag = await t.as.post(`/api/companies/${t.company.id}/cost-centers/tag-lines`, {
      documentType: "bill",
      documentId: bill.body.id,
      lineIds,
      costCenterId: cc.id,
    });
    expect(tag.status, tag.text).toBe(200);
    expect((await t.as.post(`/api/bills/${bill.body.id}/approve`, {})).status).toBe(200);
    const billLines = await h.sql(
      `SELECT jl.cost_center_id FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.source = 'bill' AND je.source_id = $1 AND jl.debit > 0 AND jl.cost_center_id IS NOT NULL`,
      [bill.body.id]
    );
    expect(billLines).toHaveLength(1);
    // Once posted the tag is locked.
    const late = await t.as.post(`/api/companies/${t.company.id}/cost-centers/tag-lines`, {
      documentType: "bill",
      documentId: bill.body.id,
      lineIds,
      costCenterId: null,
    });
    expect(late.status).toBe(409);
  });

  it("[R10-10][R10-18] profitability has an Unallocated row so totals equal the company P&L; parents roll up children", async () => {
    const t = await h.createTenant({ planId: "enterprise" });
    const region = await center(t, { code: "UAE", name: "UAE" });
    const child = await center(t, {
      code: "DXB",
      name: "Dubai",
      parentId: region.id,
      type: "project",
    });
    const bank = await accountByCode(t, "1020");
    const sales = await accountByCode(t, "4010");
    const rent = await accountByCode(t, "5010");
    const post = (lines: Array<Record<string, unknown>>) =>
      t.as.post(`/api/companies/${t.company.id}/journal`, {
        date: today(),
        description: "cc test",
        status: "posted",
        lines,
      });
    const r1 = await post([
      { accountId: bank.id, debit: 1000, credit: 0 },
      { accountId: sales.id, debit: 0, credit: 1000, costCenterId: child.id },
    ]);
    expect([200, 201]).toContain(r1.status);
    const r2 = await post([
      { accountId: rent.id, debit: 400, credit: 0, costCenterId: region.id },
      { accountId: bank.id, debit: 0, credit: 400 },
    ]);
    expect([200, 201]).toContain(r2.status);
    const r3 = await post([
      { accountId: rent.id, debit: 50, credit: 0 },
      { accountId: bank.id, debit: 0, credit: 50 },
    ]);
    expect([200, 201]).toContain(r3.status);
    const p = await t.as.get(`/api/companies/${t.company.id}/cost-centers/profitability`);
    expect(p.status, p.text).toBe(200);
    const un = p.body.costCenters.find((r: { isUnallocated?: boolean }) => r.isUnallocated);
    expect(un).toMatchObject({ name: "Unallocated", totalExpenses: 50, netIncome: -50 });
    expect(p.body.totals.netIncome).toBe(550);
    expect(p.body.reconciliation).toMatchObject({
      companyNetProfit: 550,
      difference: 0,
      reconciled: true,
    });
    const pl = await t.as.get(`/api/companies/${t.company.id}/reports/profit-loss?to=${today()}`);
    expect(pl.status).toBe(200);
    expect(Number(pl.body.netProfit)).toBe(p.body.totals.netIncome);
    const parent = p.body.costCenters.find(
      (r: { costCenterId: string }) => r.costCenterId === region.id
    );
    expect(parent.netIncome).toBe(-400);
    expect(parent.rollup).toEqual({ totalIncome: 1000, totalExpenses: 400, netIncome: 600 });
    expect(
      p.body.costCenters.find((r: { costCenterId: string }) => r.costCenterId === child.id).depth
    ).toBe(1);
    // Budgets by cost centre (budget plan lines tagged with the centre).
    const y = Number(today().slice(0, 4));
    const m = Number(today().slice(5, 7));
    const col = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ][m - 1];
    const plan = await h.sql<{ id: string }>(
      `INSERT INTO budget_plans (company_id, name, fiscal_year, start_date, end_date)
       VALUES ($1, 'FY', $2, $3, $4) RETURNING id`,
      [t.company.id, y, `${y}-01-01`, `${y}-12-31`]
    );
    await h.sql(
      `INSERT INTO budget_lines (budget_id, account_id, category, cost_center_id, ${col}) VALUES ($1, $2, 'Rent', $3, 300)`,
      [plan[0].id, rent.id, region.id]
    );
    const withBudget = await t.as.get(
      `/api/companies/${t.company.id}/cost-centers/profitability?budgetId=${plan[0].id}&startDate=${today().slice(0, 8)}01&endDate=${today()}`
    );
    expect(withBudget.status, withBudget.text).toBe(200);
    const pb = withBudget.body.costCenters.find(
      (r: { costCenterId: string }) => r.costCenterId === region.id
    );
    expect(pb.budget).toEqual({ income: 0, expenses: 300, netIncome: -300, expenseVariance: 100 });
  });
});
