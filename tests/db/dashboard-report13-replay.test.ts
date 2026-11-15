/**
 * W3-E dashboard, analytics and cash forecast on the report 13 books.
 * Issue ids: R13-01, R13-02, R13-05, R13-06, R13-07, R13-08, R13-09, R13-16, R13-19, R13-20,
 * R13-21, R13-22, R13-23, R13-24, R13-25, R13-37, R12-04.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freezeTime, postJournalEntry, useHarness, type Tenant } from "./harness";
import { NOW, insertBill, insertInvoice, seedReport13 } from "./w3e-seed";

const h = useHarness();
let t: Tenant;
let restore: () => void;
const base = () => `/api/companies/${t.company.id}`;

beforeAll(async () => {
  restore = freezeTime(NOW);
  t = await h.createTenant();
  await seedReport13(h.sql, t);
  await insertBill(h.sql, t, {
    vendor: "Landlord LLC",
    number: "B-1",
    date: "2026-11-01",
    due: "2026-12-20",
    subtotal: 1000,
    vat: 50,
  });
  // A draft invoice never reaches AR, aging or the forecast.
  await insertInvoice(h.sql, t, {
    number: "INV-D",
    customer: "Draft Co",
    date: "2026-11-12",
    due: "2026-12-12",
    subtotal: 9000,
    vat: 450,
    status: "draft",
  });
});
afterAll(() => restore());

describe("dashboard stats basis", () => {
  it("R13-02 outstanding is the remaining balance (6,350), matching the GL receivable", async () => {
    const r = await t.as.get(`${base()}/dashboard/stats`);
    expect(r.status).toBe(200);
    expect(r.body.outstanding).toBe(6350);
    expect(r.body.arReconciliation.glBalance).toBe(6350);
    expect(r.body.arReconciliation.isReconciled).toBe(true);
  });

  it("R13-01 cash position is bank/cash accounts only (8,900)", async () => {
    const r = await t.as.get(`${base()}/dashboard/stats`);
    expect(r.body.cashPosition).toBe(8900);
  });

  it("R13-05 hero figures are this month (profit 1,200), not all-time", async () => {
    const r = await t.as.get(`${base()}/dashboard/stats`);
    expect(r.body.period.preset).toBe("month");
    expect(r.body.revenue).toBe(2000);
    expect(r.body.expenses).toBe(800);
    expect(r.body.netProfit).toBe(1200);
    expect(r.body.thisMonth.netProfit).toBe(1200);
    const ytd = await t.as.get(`${base()}/dashboard/stats?preset=ytd`);
    expect(ytd.body.netProfit).toBe(4900);
    expect(ytd.body.margin).toBe(70);
  });

  it("R13-16 aging has a current bucket by due date and AP uses vendor bills", async () => {
    const r = await t.as.get(`${base()}/dashboard/stats`);
    expect(r.body.arAging.current).toBe(2100);
    expect(r.body.arAging.days0to30).toBe(4250);
    expect(r.body.apAging.current).toBe(1050);
    expect(r.body.outstandingPayables).toBe(1050);
  });

  it("R13-20 overdue list holds only the second invoice (4,250); DSO/DPO and cash in/out present", async () => {
    const r = await t.as.get(`${base()}/dashboard/stats`);
    expect(r.body.topOverdue.receivables).toHaveLength(1);
    expect(r.body.topOverdue.receivables[0]).toMatchObject({ number: "INV-2", open: 4250 });
    // DSO = open AR / trailing-90-day revenue x 90 = 6,350 / 7,000 x 90
    expect(r.body.dso).toBe(81.6);
    // DPO = open AP / trailing-90-day expenses x 90 = 1,050 / 2,100 x 90
    expect(r.body.dpo).toBe(45);
    expect(r.body.cashInOut).toHaveLength(6);
    const nov = r.body.cashInOut.at(-1);
    expect(nov.outflow).toBe(800);
    expect(r.body.bankVsGl.glCashTotal).toBe(8900);
  });

  it("R13-19 period selector with prior-period and prior-year comparison", async () => {
    const sep = await t.as.get(
      `${base()}/dashboard/stats?preset=custom&from=2026-09-01&to=2026-09-30`
    );
    expect(sep.status).toBe(200);
    expect(sep.body.revenue).toBe(5000);
    expect(sep.body.prior).toMatchObject({ from: "2026-08-01", to: "2026-08-31", revenue: 0 });
    expect(sep.body.priorYear).toMatchObject({ from: "2025-09-01", revenue: 0 });
    expect(sep.body.changes.vsPrior.revenue).toBeNull();
    const q = await t.as.get(`${base()}/dashboard/stats?preset=quarter`);
    expect(q.body.period.from).toBe("2026-10-01");
    expect((await t.as.get(`${base()}/dashboard/stats?preset=bogus`)).status).toBe(400);
    expect((await t.as.get(`${base()}/dashboard/stats?preset=custom&from=2026-09-01`)).status).toBe(
      400
    );
    expect(
      (await t.as.get(`${base()}/dashboard/stats?preset=custom&from=2026-10-01&to=2026-09-01`))
        .status
    ).toBe(400);
  });

  it("R13-21 every tile carries a drill-through link", async () => {
    const r = await t.as.get(`${base()}/dashboard/stats`);
    for (const key of [
      "revenue",
      "expenses",
      "netProfit",
      "outstanding",
      "payables",
      "cash",
      "vat",
      "corporateTax",
    ]) {
      expect(typeof r.body.links[key]).toBe("string");
      expect(r.body.links[key].startsWith("/")).toBe(true);
    }
  });

  it("R13-22 VAT widget equals the ledger VAT payable on the balance sheet", async () => {
    const stats = await t.as.get(`${base()}/dashboard/stats`);
    const bs = await t.as.get(`${base()}/reports/balance-sheet?asOf=2026-11-15`);
    const vatLine = bs.body.liabilities.find((l: any) => l.accountCode === "2020");
    expect(vatLine.amount).toBe(350);
    expect(stats.body.vat.outputVat).toBe(vatLine.amount);
    expect(stats.body.vat.netPayable).toBe(350);
  });

  it("R13-37 stats are aggregated in SQL (no journal-line loader is used)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("server/services/dashboard-stats.service.ts", "utf8");
    expect(src).not.toMatch(/getJournalLinesByCompanyId|getJournalEntriesByCompanyId/);
    const routes = await fs.readFile("server/routes/dashboard.routes.ts", "utf8");
    expect(routes).not.toMatch(/getJournalLinesByCompanyId/);
  });
});

describe("monthly trends, profit trend and insights", () => {
  it("R13-09 trends use one ledger basis for both series", async () => {
    const r = await t.as.get(`${base()}/dashboard/monthly-trends`);
    expect(r.status).toBe(200);
    const nov = r.body.at(-1);
    expect(nov).toMatchObject({ month: "Nov", revenue: 2000, expenses: 800 });
    const sep = r.body.find((m: any) => m.key === "2026-09");
    expect(sep).toMatchObject({ revenue: 5000, expenses: 700 });
  });

  it("R13-08 profit-trend ignores a draft journal", async () => {
    const draft = await t.as.post(`${base()}/journal`, {
      date: "2026-11-12",
      description: "Draft only",
      status: "draft",
      lines: [
        {
          accountId: (
            await h.sql("SELECT id FROM accounts WHERE company_id=$1 AND code='5020'", [
              t.company.id,
            ])
          )[0].id,
          debit: 9999,
          credit: 0,
        },
        {
          accountId: (
            await h.sql("SELECT id FROM accounts WHERE company_id=$1 AND code='1020'", [
              t.company.id,
            ])
          )[0].id,
          debit: 0,
          credit: 9999,
        },
      ],
    });
    expect(draft.status).toBeLessThan(300);
    const r = await t.as.get(`${base()}/analytics/profit-trend?months=3`);
    const nov = r.body.find((m: any) => m.month === "2026-11");
    expect(nov.expenses).toBe(800);
    expect(nov.netProfit).toBe(1200);
  });

  it("R13-07 insights margin equals the P&L margin and carries no industry-average claim", async () => {
    const r = await t.as.get(`/api/analytics/insights?companyId=${t.company.id}`);
    expect(r.status).toBe(200);
    const pl = await t.as.get(`${base()}/reports/profit-loss?from=2026-01-01&to=2026-11-15`);
    const plMargin = (pl.body.netProfit / pl.body.totalIncome) * 100;
    const margin = r.body.find((i: any) => i.margin !== undefined);
    expect(margin.margin).toBeCloseTo(plMargin, 6);
    expect(JSON.stringify(r.body)).not.toMatch(/industry average/i);
    const collections = r.body.find((i: any) => i.title === "Outstanding Collections");
    expect(collections.description).toContain("6350.00");
  });

  it("R13-02 top customers use remaining balances and exclude drafts", async () => {
    const r = await t.as.get(`${base()}/analytics/top-customers`);
    expect(r.body.map((c: any) => c.name)).not.toContain("Draft Co");
    const beta = r.body.find((c: any) => c.name === "Beta Trading");
    expect(beta).toMatchObject({ total: 5250, paidTotal: 1000, outstanding: 4250 });
  });
});

describe("cash forecast v2", () => {
  it("R13-01 / R13-06 opening cash is 8,900 and receivables are remaining balances by due date", async () => {
    const r = await t.as.get(`${base()}/cashflow/forecast?days=90`);
    expect(r.status).toBe(200);
    expect(r.body.currentBalance).toBe(8900);
    const receivables = r.body.items.filter((i: any) => i.kind === "receivable");
    expect(receivables.map((i: any) => i.amount).sort()).toEqual([2100, 4250]);
    // the draft invoice (9,000) is not in the forecast
    expect(JSON.stringify(r.body.items)).not.toContain("INV-D");
    const notDue = receivables.find((i: any) => i.amount === 2100);
    expect(notDue.date).toBe("2026-12-10");
    expect(r.body.summary.receivablesOverdue).toBe(4250);
    const payable = r.body.items.find((i: any) => i.kind === "payable");
    expect(payable).toMatchObject({ amount: -1050, date: "2026-12-20" });
  });

  it("R13-23 inflows land in the due week, not spread over four weeks", async () => {
    const r = await t.as.get(`${base()}/cashflow/forecast?days=90`);
    const weeks = r.body.projections.filter((p: any) => p.expectedInflows > 0);
    expect(weeks.map((p: any) => p.expectedInflows)).toEqual([4250, 2100]);
  });

  it("R13-24 loan repayments, recurring invoices, payroll and VAT due dates feed the forecast", async () => {
    const loan = await t.as.post(`${base()}/cashflow/items`, {
      kind: "loan_repayment",
      description: "Bank loan instalment",
      amount: 1000,
      dueDate: "2026-12-01",
      repeatMonths: 1,
      occurrences: 3,
    });
    expect(loan.status).toBe(201);
    await h.sql(
      `INSERT INTO recurring_invoices (company_id, customer_name, frequency, start_date, next_run_date, lines_json)
       VALUES ($1,'Retainer Co','monthly','2026-11-01','2026-11-20',$2)`,
      [
        t.company.id,
        JSON.stringify([{ description: "Retainer", quantity: 1, unitPrice: 1000, vatRate: 0.05 }]),
      ]
    );
    await h.sql(
      `INSERT INTO payroll_runs (company_id, period_month, period_year, total_net, status)
       VALUES ($1,10,2026,3000,'paid')`,
      [t.company.id]
    );
    await h.sql(
      `INSERT INTO compliance_calendar (company_id, event_type, description, event_date)
       VALUES ($1,'vat_return','VAT return 2026 Q4','2026-12-28')`,
      [t.company.id]
    );
    const r = await t.as.get(`${base()}/cashflow/forecast?days=90`);
    const kinds = r.body.items.map((i: any) => i.kind);
    expect(kinds.filter((k: string) => k === "loan_repayment")).toHaveLength(3);
    expect(r.body.items.find((i: any) => i.kind === "recurring_invoice")).toMatchObject({
      amount: 1050,
      date: "2026-12-20",
    });
    expect(r.body.items.find((i: any) => i.kind === "payroll")).toMatchObject({
      amount: -3000,
      date: "2026-11-30",
    });
    expect(r.body.items.find((i: any) => i.kind === "vat")).toMatchObject({
      amount: -350,
      date: "2026-12-28",
    });
  });

  it("R13-25 scenarios, what-if adjustments and bank account selection", async () => {
    const base90 = await t.as.get(`${base()}/cashflow/forecast?days=90`);
    const delayed = await t.as.get(`${base()}/cashflow/forecast?days=90&delayReceiptsDays=30`);
    const due = (r: any) =>
      r.body.items.find((i: any) => i.kind === "receivable" && i.amount === 2100).date;
    expect(due(base90)).toBe("2026-12-10");
    expect(due(delayed)).toBe("2027-01-09");
    expect((await t.as.get(`${base()}/cashflow/forecast?scenario=nope`)).status).toBe(400);

    const what = await t.as.post(`${base()}/cashflow/forecast/what-if`, {
      days: 90,
      adjustments: [
        { date: "2026-11-20", amount: 500, direction: "outflow", description: "New laptop" },
      ],
    });
    expect(what.status).toBe(200);
    expect(what.body.items.find((i: any) => i.kind === "what_if")).toMatchObject({ amount: -500 });

    const bank = (
      await h.sql("SELECT id FROM accounts WHERE company_id=$1 AND code='1010'", [t.company.id])
    )[0].id;
    const sel = await t.as.get(`${base()}/cashflow/forecast?accountIds=${bank}`);
    expect(sel.body.currentBalance).toBe(0);
    const bad = await t.as.get(
      `${base()}/cashflow/forecast?accountIds=00000000-0000-4000-8000-000000000000`
    );
    expect(bad.status).toBe(400);
    const junk = await t.as.post(`${base()}/cashflow/forecast/what-if`, { days: 90, evil: true });
    expect(junk.status).toBe(400);
  });
});

describe("cash forecast never fabricates inflows", () => {
  it("R12-04 one historical entry and no open invoices projects zero inflows", async () => {
    const lone = await h.createSecondTenant();
    await postJournalEntry(lone, {
      date: "2026-10-01",
      description: "One-off sale",
      lines: [
        { code: "1020", debit: 500 },
        { code: "4010", credit: 500 },
      ],
    });
    const r = await lone.as.get(`/api/companies/${lone.company.id}/cashflow/forecast?days=90`);
    expect(r.status).toBe(200);
    expect(r.body.currentBalance).toBe(500);
    expect(r.body.insufficientData).toBe(true);
    expect(r.body.projections.every((p: any) => p.expectedInflows === 0)).toBe(true);
    expect(r.body.insights[0]).toMatch(/insufficient data/i);
    expect(JSON.stringify(r.body.insights)).not.toMatch(/improve by/i);
    const gen = await lone.as.post(`/api/analytics/generate-forecast`, {
      companyId: lone.company.id,
    });
    expect(gen.status).toBe(400);
    expect(gen.body.code).toBe("INSUFFICIENT_DATA");
  });
});

describe("R13-22 corporate tax widget", () => {
  it("matches the corporate-tax calculate endpoint for the fiscal year", async () => {
    const co = await h.createSecondTenant();
    await postJournalEntry(co, {
      date: "2026-11-01",
      description: "Large sale",
      lines: [
        { code: "1020", debit: 1000000 },
        { code: "4010", credit: 1000000 },
      ],
    });
    await postJournalEntry(co, {
      date: "2026-11-02",
      description: "Costs",
      lines: [
        { code: "5020", debit: 100000 },
        { code: "1020", credit: 100000 },
      ],
    });
    const stats = await co.as.get(`/api/companies/${co.company.id}/dashboard/stats?preset=ytd`);
    const calc = await co.as.get(
      `/api/companies/${co.company.id}/corporate-tax/calculate?periodStart=2026-01-01&periodEnd=2026-11-15`
    );
    expect(calc.status).toBe(200);
    expect(stats.body.corporateTax.estimatedLiability).toBe(
      calc.body.taxPayable ?? calc.body.taxLiability
    );
    expect(stats.body.corporateTax.estimatedLiability).toBe(47250);
  });
});
