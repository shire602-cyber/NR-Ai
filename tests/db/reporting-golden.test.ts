/**
 * W2-B reporting kernel against the report-11 golden books (FY2025 + FY2026).
 * Every statement endpoint is served by server/reporting and returns
 * isBalanced; numbers are the hand calculations in GOLDEN_EXPECTED.
 */
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { postJournalEntry, useHarness, type Tenant } from "./harness";
import { GOLDEN_EXPECTED as G, seedGoldenBooksFY2025_2026 } from "./golden/seed";

const h = useHarness();
let t: Tenant;
let base: string;

beforeAll(async () => {
  t = await h.createTenant({ name: "GoldenW2B", planId: "professional" });
  await seedGoldenBooksFY2025_2026(t);
  base = `/api/companies/${t.company.id}`;
});

async function get(url: string) {
  const r = await t.as.get(url);
  expect(r.status, `${url}: ${r.text.slice(0, 300)}`).toBe(200);
  return r.body;
}

const twoDp = (n: number) => Math.round(n * 100) / 100 === n;

describe("balance sheet roll-forward", () => {
  it("[R11-01] FY2025 balance sheet: assets 125,600 = liabilities 4,400 + equity 121,200", async () => {
    const bs = await get(`${base}/reports/balance-sheet?startDate=2025-01-01&endDate=2025-12-31`);
    expect(bs.totalAssets).toBe(G.fy2025.totalAssets);
    expect(bs.totalLiabilities).toBe(G.fy2025.totalLiabilities);
    expect(bs.totalEquity).toBe(G.fy2025.totalEquity);
    expect(bs.isBalanced).toBe(true);
  });

  it("[R11-01][R11-06] year-2 balance sheet balances with RE b/f 21,200 + current year 5,730.25", async () => {
    const bs = await get(`${base}/reports/balance-sheet?startDate=2026-01-01&endDate=2026-12-31`);
    expect(bs.totalAssets).toBe(G.cumulative20261231.totalAssets);
    expect(bs.totalLiabilities).toBe(G.cumulative20261231.totalLiabilities);
    expect(bs.totalEquity).toBe(G.cumulative20261231.totalEquity);
    expect(bs.retainedEarningsBroughtForward).toBe(21_200);
    expect(bs.currentYearEarnings).toBe(G.fy2026.netIncome);
    expect(bs.isBalanced).toBe(true);
    expect(bs.difference).toBe(0);
    const names = bs.equity.map((e: any) => e.accountName);
    expect(names).toContain("Retained earnings brought forward");
    expect(names).toContain("Current year earnings");
    const capital = bs.equity.find((e: any) => e.accountCode === "3010");
    expect(capital.amount).toBe(G.fy2025.capital);
  });

  it("[R11-01] every preset range (month, quarter, year, custom) balances", async () => {
    const ranges = [
      ["2025-03-01", "2025-03-31"],
      ["2025-04-01", "2025-06-30"],
      ["2025-07-01", "2025-09-30"],
      ["2026-01-01", "2026-03-31"],
      ["2026-04-01", "2026-04-30"],
      ["2026-01-01", "2026-12-31"],
      ["2025-02-15", "2026-05-20"],
      ["2026-06-01", "2026-06-30"],
    ];
    for (const [from, to] of ranges) {
      const bs = await get(`${base}/reports/balance-sheet?startDate=${from}&endDate=${to}`);
      expect(bs.isBalanced, `BS ${from}..${to}`).toBe(true);
      expect(Math.round((bs.totalLiabilities + bs.totalEquity) * 100)).toBe(
        Math.round(bs.totalAssets * 100)
      );
      const tb = await get(`${base}/reports/trial-balance?from=${from}&to=${to}`);
      expect(tb.isBalanced, `TB ${from}..${to}`).toBe(true);
      expect(tb.totals.sumDebits).toBe(tb.totals.sumCredits);
    }
    const asOf = await get(`${base}/reports/balance-sheet?endDate=2025-03-31`);
    expect(asOf.totalAssets).toBe(G.asOf20250331Total);
    expect(asOf.totalLiabilitiesAndEquity).toBe(G.asOf20250331Total);
  });

  it("[R11-05] financial-statements and reports balance sheets come from one implementation", async () => {
    const a = await get(`${base}/reports/balance-sheet?endDate=2026-12-31`);
    const b = await get(`${base}/financial-statements/balance-sheet?asOfDate=2026-12-31`);
    expect(b.assets.total).toBe(a.totalAssets);
    expect(b.liabilities.total).toBe(a.totalLiabilities);
    expect(b.equity.total).toBe(a.totalEquity);
    expect(b.isBalanced).toBe(true);
    expect(b.equity.retainedEarningsBroughtForward).toBe(21_200);
    expect(b.equity.currentYearEarnings).toBe(G.fy2026.netIncome);
  });

  it("[R11-17] current vs non-current subtotals and comparatives on the balance sheet", async () => {
    const b = await get(
      `${base}/financial-statements/balance-sheet?asOfDate=2026-12-31&compareTo=prior_year`
    );
    expect(b.assets.current.total).toBe(G.cumulative20261231.totalAssets);
    expect(b.assets.nonCurrent.total).toBe(0);
    expect(b.liabilities.current.total).toBe(G.cumulative20261231.totalLiabilities);
    expect(b.statement.comparison.asOf).toBe("2025-12-31");
    expect(b.statement.comparison.totalAssets).toBe(G.fy2025.totalAssets);
    expect(b.statement.comparison.isBalanced).toBe(true);
  });
});

describe("trial balance", () => {
  it("[R11-02] from=2026-01-01 totals 184,288.38 on both sides with RE brought forward", async () => {
    const tb = await get(`${base}/reports/trial-balance?from=2026-01-01&to=2026-12-31`);
    expect(tb.totals.sumDebits).toBe(184_288.38);
    expect(tb.totals.sumCredits).toBe(184_288.38);
    expect(tb.totals.difference).toBe(0);
    expect(tb.isBalanced).toBe(true);
    const re = tb.rows.find((r: any) => r.synthetic);
    expect(re.accountName).toBe("Retained earnings brought forward");
    expect(re.totalCredit).toBe(21_200);
  });

  it("[R11-09] trial balance and balance sheet amounts are rounded to 2 dp (no float artefacts)", async () => {
    const tb = await get(`${base}/reports/trial-balance?from=2026-01-01&to=2026-12-31`);
    for (const r of tb.rows) {
      for (const k of ["totalDebit", "totalCredit", "balance", "debitBalance", "creditBalance"]) {
        expect(twoDp(r[k]), `${r.accountCode} ${k}=${r[k]}`).toBe(true);
      }
    }
    expect(tb.text ?? JSON.stringify(tb)).not.toMatch(/\d\.\d{3,}/);
    const bs = await get(`${base}/reports/balance-sheet?endDate=2026-12-31`);
    expect(JSON.stringify(bs)).not.toMatch(/\d\.\d{3,}/);
  });
});

describe("profit and loss", () => {
  it("[R11-05] Q2-2025 P&L 20,000 / 2,000 / 18,000 on both P&L endpoints", async () => {
    const pl = await get(`${base}/reports/profit-loss?from=2025-04-01&to=2025-06-30`);
    expect(pl.totalIncome).toBe(G.q2_2025.revenue);
    expect(pl.totalExpenses).toBe(G.q2_2025.expenses);
    expect(pl.netProfit).toBe(G.q2_2025.netIncome);
    const legacy = await get(`${base}/reports/pl?startDate=2025-04-01&endDate=2025-06-30`);
    expect(legacy.totalRevenue).toBe(G.q2_2025.revenue);
    expect(legacy.totalExpenses).toBe(G.q2_2025.expenses);
    expect(legacy.netProfit).toBe(G.q2_2025.netIncome);
    const fs = await get(
      `${base}/financial-statements/profit-loss?startDate=2025-04-01&endDate=2025-06-30`
    );
    expect(fs.netIncome).toBe(G.q2_2025.netIncome);
  });

  it("[R11-11] FX gain 57.75 is other income, not revenue; gross profit section exists", async () => {
    const pl = await get(`${base}/reports/profit-loss?from=2026-01-01&to=2026-12-31`);
    expect(pl.revenue).toBe(12_345);
    expect(pl.otherIncome).toBe(G.fy2026.usdInvoice.fxGain);
    expect(pl.sections.otherIncome.lines.map((l: any) => l.accountCode)).toEqual(["4090"]);
    expect(pl.sections.revenue.lines.map((l: any) => l.accountCode)).not.toContain("4090");
    expect(pl.grossProfit).toBe(12_345);
    expect(pl.netProfit).toBe(G.fy2026.netIncome);
  });

  it("[R11-13][R11-17] comparatives (prior year) and monthly / quarterly columns", async () => {
    const pl = await get(
      `${base}/reports/profit-loss?from=2026-01-01&to=2026-12-31&compareTo=prior_year&columns=quarterly`
    );
    expect(pl.comparison.from).toBe("2025-01-01");
    expect(pl.comparison.totals.netProfit).toBe(G.fy2025.netIncome);
    expect(pl.comparison.totals.totalExpenses).toBe(G.fy2025.expenses);
    expect(pl.columns.map((c: any) => c.label)).toEqual([
      "Q1 2026",
      "Q2 2026",
      "Q3 2026",
      "Q4 2026",
    ]);
    const colSum = pl.columns.reduce((s: number, c: any) => s + Math.round(c.netProfit * 100), 0);
    expect(colSum / 100).toBe(G.fy2026.netIncome);
    const monthly = await get(
      `${base}/reports/profit-loss?from=2025-01-01&to=2025-06-30&columns=monthly`
    );
    expect(monthly.columns).toHaveLength(6);
  });

  it("[R11-13] budget comparative column", async () => {
    const acct = await h.sql<{ id: string }>(
      `SELECT id FROM accounts WHERE company_id = $1 AND code = '5020'`,
      [t.company.id]
    );
    const plan = await h.sql<{ id: string }>(
      `INSERT INTO budget_plans (company_id, name, fiscal_year, start_date, end_date)
       VALUES ($1, 'FY26', 2026, '2026-01-01', '2026-12-31') RETURNING id`,
      [t.company.id]
    );
    await h.sql(
      `INSERT INTO budget_lines (budget_id, account_id, category, jun) VALUES ($1, $2, 'Salaries', 2500)`,
      [plan[0].id, acct[0].id]
    );
    const pl = await get(
      `${base}/reports/profit-loss?from=2026-01-01&to=2026-12-31&compareTo=budget&budgetId=${plan[0].id}`
    );
    expect(pl.comparison.label).toBe("Budget");
    expect(pl.comparison.byAccount[acct[0].id]).toBe(2500);
    expect(pl.comparison.totals.totalExpenses).toBe(2500);
  });
});

describe("comparison endpoints on the ledger", () => {
  it("[R11-03][R12-02] FY2026 vs FY2025: expenses 6,672.50, net income 5,730.25 (bills + journals counted)", async () => {
    const c = await get(
      `${base}/reports/comparison?from=2026-01-01&to=2026-12-31&compareTo=prior_year`
    );
    expect(c.current.totalExpenses).toBe(6_672.5);
    expect(c.current.netProfit).toBe(G.fy2026.netIncome);
    expect(c.previous.totalExpenses).toBe(G.fy2025.expenses);
    expect(c.previous.netProfit).toBe(G.fy2025.netIncome);
    const legacy = await get(
      `/api/reports/${t.company.id}/comparison/year?from=2026-01-01&to=2026-12-31`
    );
    const exp = legacy.find((m: any) => m.metric === "Total Expenses");
    const net = legacy.find((m: any) => m.metric === "Net Profit");
    expect(exp.current).toBe(6_672.5);
    expect(exp.previous).toBe(G.fy2025.expenses);
    expect(net.current).toBe(G.fy2026.netIncome);
  });
});

describe("aging as of a date", () => {
  it("[R11-07][R11-15] A/R aging as of 2025-12-31 = GL A/R 13,000; A/P rounded to fils", async () => {
    const ar = await get(`${base}/reports/aged-receivables?asOf=2025-12-31`);
    expect(ar.totals.total).toBe(G.fy2025.accountsReceivable);
    expect(ar.reconciliation.glBalance).toBe(G.fy2025.accountsReceivable);
    expect(ar.reconciliation.isReconciled).toBe(true);
    const ap = await get(`${base}/reports/aged-payables?asOf=2026-12-31`);
    expect(ap.totals.total).toBe(2_100 + G.fy2026.usdBill.ap);
    expect(ap.reconciliation.isReconciled).toBe(true);
    for (const r of ap.rows) expect(twoDp(r.total)).toBe(true);
    const legacy = await get(`/api/reports/${t.company.id}/aging?asOf=2026-12-31`);
    const usVendor = legacy.find((r: any) => r.name === "USVendor");
    expect(usVendor.total).toBe(G.fy2026.usdBill.ap);
    const arNow = legacy.filter((r: any) => r.type === "receivable");
    expect(arNow.reduce((s: number, r: any) => s + r.total, 0)).toBe(G.arAgingTotal);
  });
});

describe("cash flow", () => {
  it("[R11-08][R11-16] indirect FY2026: net 4,770, opening 112,200, closing 116,970 with cash proof", async () => {
    const cf = await get(`${base}/reports/cash-flow?from=2026-01-01&to=2026-12-31`);
    expect(cf.method).toBe("indirect");
    expect(cf.netCashChange).toBe(G.fy2026.netCashChange);
    expect(cf.openingCash).toBe(G.fy2025.bank);
    expect(cf.closingCash).toBe(116_970);
    expect(cf.cashProof.isBalanced).toBe(true);
    expect(cf.operating.breakdown[0]).toMatchObject({
      accountName: "Net income",
      amount: G.fy2026.netIncome,
    });
    const direct = await get(
      `${base}/reports/cash-flow?from=2026-01-01&to=2026-12-31&method=direct`
    );
    expect(direct.netCashChange).toBe(G.fy2026.netCashChange);
    const fs = await get(
      `${base}/financial-statements/cash-flow?startDate=2026-01-01&endDate=2026-12-31`
    );
    expect(fs.openingCash).toBe(G.fy2025.bank);
    expect(fs.closingCash).toBe(116_970);
  });
});

describe("general ledger and exports", () => {
  it("[R11-16] general ledger across all accounts with opening balances", async () => {
    const gl = await get(`${base}/reports/general-ledger?from=2026-01-01&to=2026-12-31`);
    const bank = gl.accounts.find((a: any) => a.accountCode === "1020");
    expect(bank.openingBalance).toBe(G.fy2025.bank);
    expect(bank.closingBalance).toBe(116_970);
    const salaries = gl.accounts.find((a: any) => a.accountCode === "5020");
    expect(salaries.openingBalance).toBe(0); // P&L accounts reset each fiscal year
    expect(gl.totals.debit).toBe(gl.totals.credit);
  });

  it("[R02-20][R11-10] account ledger export: xlsx numeric cells and csv", async () => {
    const bank = await h.sql<{ id: string }>(
      `SELECT id FROM accounts WHERE company_id = $1 AND code = '1020'`,
      [t.company.id]
    );
    const res = await fetch(
      `${h.baseUrl}${base}/reports/general-ledger/export?accountIds=${bank[0].id}&from=2026-01-01&to=2026-12-31&format=xlsx`,
      { headers: { Authorization: `Bearer ${t.token}` } }
    );
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const balances: unknown[] = [];
    ws.eachRow((row, i) => {
      if (i > 1) balances.push(row.getCell(7).value);
    });
    expect(balances.length).toBeGreaterThan(2);
    for (const v of balances) expect(typeof v).toBe("number");
    expect(balances[balances.length - 1]).toBe(116_970);

    const csv = await t.as.get(
      `${base}/reports/general-ledger/export?accountIds=${bank[0].id}&format=csv`
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.text).toContain("Opening balance");
  });

  it("[R11-10] generic Excel export writes money strings as numbers", async () => {
    const res = await fetch(`${h.baseUrl}/api/export/excel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        sheets: [
          {
            sheetName: "TB",
            columns: [
              { header: "Code", key: "code" },
              { header: "Amount", key: "amount" },
            ],
            rows: [{ code: "1020", amount: "112200.00" }],
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const row = wb.worksheets[0].getRow(2);
    expect(row.getCell(1).value).toBe("1020");
    expect(row.getCell(2).value).toBe(112_200);
  });

  it("[STEP1-C] generic Excel export takes the 15-sheet Balance Reports workbook, Arabic and RTL", async () => {
    // Customer balances, inventory and fixed assets download one workbook of 15 sheets; the
    // route used to refuse more than 10 ("Array must contain at most 10 element(s)").
    const sheets = Array.from({ length: 15 }, (_, i) => ({
      sheetName: `ورقة ${i + 1}`,
      rtl: true,
      columns: [
        { header: "المقياس", key: "metric" },
        { header: "القيمة", key: "value" },
      ],
      rows: [{ metric: "الإجمالي", value: "10.50" }],
    }));
    const res = await fetch(`${h.baseUrl}/api/export/excel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sheets }),
    });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    expect(wb.worksheets).toHaveLength(15);
    expect(wb.worksheets[14].name).toBe("ورقة 15");
    expect(wb.worksheets.every((sheet) => sheet.views[0]?.rightToLeft === true)).toBe(true);
    expect(wb.worksheets[0].getRow(2).getCell(2).value).toBe(10.5);
  });
});

describe("route naming and params (R12-05)", () => {
  it("[R12-05] canonical routes exist, aliases carry Deprecation, params unified", async () => {
    const gl = await t.as.get(
      `${base}/reports/general-ledger?startDate=2026-01-01&endDate=2026-01-31`
    );
    expect(gl.status).toBe(200);
    const pl = await t.as.get(
      `${base}/reports/profit-loss?startDate=2025-04-01&endDate=2025-06-30`
    );
    expect(pl.body.netProfit).toBe(G.q2_2025.netIncome);
    const fs = await t.as.get(
      `${base}/financial-statements/profit-loss?from=2025-04-01&to=2025-06-30`
    );
    expect(fs.status).toBe(200);
    expect(fs.headers.get("deprecation")).toBe("true");
    expect(fs.headers.get("link")).toContain("/reports/profit-loss");
    const vat = await t.as.get(
      `${base}/reports/vat-return?startDate=2025-01-01&endDate=2025-12-31`
    );
    expect(vat.status).toBe(200);
    const ct = await t.as.get(`${base}/corporate-tax/calculate?from=2025-01-01&to=2025-12-31`);
    expect(ct.status).toBe(200);
    expect(ct.body.totalRevenue).toBe(G.fy2025.revenue);
    const alias = await t.as.get(
      `/api/reports/${t.company.id}/vat-summary?from=2025-01-01&to=2025-12-31`
    );
    expect(alias.status).toBe(307);
    expect(alias.headers.get("location")).toBe(
      `/api/companies/${t.company.id}/reports/vat-summary?startDate=2025-01-01&endDate=2025-12-31`
    );
    expect((await t.as.get(alias.headers.get("location")!)).status).toBe(200);
    const bad = await t.as.get(`${base}/reports/trial-balance?from=2026-13-01`);
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_REPORT_DATE");
  });

  it("[R11-01] a later-posted prior-year adjustment still balances the year-2 statements", async () => {
    await postJournalEntry(t, {
      date: "2025-11-30",
      description: "Late FY2025 accrual",
      lines: [
        { code: "5070", debit: 1_000 },
        { code: "2040", credit: 1_000 },
      ],
    });
    const bs = await get(`${base}/reports/balance-sheet?startDate=2026-01-01&endDate=2026-12-31`);
    expect(bs.retainedEarningsBroughtForward).toBe(20_200);
    expect(bs.isBalanced).toBe(true);
    const tb = await get(`${base}/reports/trial-balance?from=2026-01-01&to=2026-12-31`);
    expect(tb.isBalanced).toBe(true);
  });
});
