/**
 * A3 accounting audit (financial statements / IFRS): C5, H1, H3, H4, H5, H6, H10, H11, M5.
 * Every scenario is posted through the real API (Bearer client) and asserts the exact journal
 * lines and statement figures of the golden scenarios in the audit (S1, S3, S7, S10).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accountByCode, postJournalEntry, useHarness, type Tenant } from "./harness";
import { repoRoot } from "./pg-admin";

const h = useHarness();
const TRN = "100000000000003";

async function tenant(name: string): Promise<Tenant> {
  return h.createTenant({
    name,
    planId: "professional",
    companyColumns: { trn_vat_number: TRN, emirate: "dubai" },
  });
}

async function get(t: Tenant, url: string) {
  const r = await t.as.get(url);
  expect(r.status, `${url}: ${r.text.slice(0, 300)}`).toBe(200);
  return r.body;
}

/** {code: [debit, credit]} of one journal entry. */
async function linesOf(entryId: string): Promise<Record<string, [number, number]>> {
  const rows = await h.sql<{ code: string; d: string; c: string }>(
    `SELECT a.code, SUM(jl.debit)::text AS d, SUM(jl.credit)::text AS c
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.entry_id = $1 GROUP BY a.code ORDER BY a.code`,
    [entryId]
  );
  return Object.fromEntries(rows.map((r) => [r.code, [Number(r.d), Number(r.c)]]));
}

async function glBalance(t: Tenant, code: string, to?: string): Promise<number> {
  const rows = await h.sql<{ n: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100)), 0)::bigint::text AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2
        AND ($3::date IS NULL OR ((je.date + interval '4 hours')::date) <= $3::date)`,
    [t.company.id, code, to ?? null]
  );
  return Number(rows[0].n) / 100;
}

async function issuedInvoice(t: Tenant, body: Record<string, unknown>) {
  const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Acme LLC",
    placeOfSupplyEmirate: "dubai",
    ...body,
  });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return c.body as { id: string; number: string };
}

describe("A3 S7 fixed assets: revaluation, impairment, disposal and the cash flow", () => {
  it("[C5][H4][H5][H11] IAS 7 indirect cash flow, IAS 36 impairment via surplus, OCI and register", async () => {
    const t = await tenant("A3S7");
    const cid = t.company.id;
    const bank = await accountByCode(t, "1020");
    const server = await t.as.post(`/api/companies/${cid}/fixed-assets`, {
      assetName: "Server rack",
      category: "computers",
      purchaseDate: "2026-01-01",
      purchaseCost: 36000,
      salvageValue: 0,
      usefulLifeYears: 3,
      depreciationMethod: "straight_line",
      paymentAccountId: bank.id,
      inputVat: 1800,
    });
    expect(server.status, server.text).toBe(201);
    const furniture = await t.as.post(`/api/companies/${cid}/fixed-assets`, {
      assetName: "Office furniture",
      category: "furniture",
      purchaseDate: "2026-01-01",
      purchaseCost: 10000,
      usefulLifeYears: 5,
      depreciationMethod: "declining_balance",
      paymentAccountId: bank.id,
    });
    expect(furniture.status, furniture.text).toBe(201);
    for (let month = 1; month <= 10; month++) {
      const run = await t.as.post(`/api/companies/${cid}/fixed-assets/run-depreciation`, {
        month,
        year: 2026,
      });
      expect(run.status, run.text).toBe(200);
    }
    const before = await get(t, `/api/fixed-assets/${furniture.body.id}`);
    expect(Number(before.accumulated_depreciation)).toBe(2875.28);

    const reval = await t.as.post(`/api/fixed-assets/${furniture.body.id}/revalue`, {
      date: "2026-10-31",
      fairValue: 8000,
    });
    expect(reval.status, reval.text).toBeLessThan(300);
    // IAS 16.35(b) (A4 L7): accumulated depreciation 2,875.28 is eliminated against the gross
    // amount, which is then restated to fair value 8,000 (net Cr 1220 2,000; surplus 875.28).
    // B1 (M3): furniture sits on 1220 Furniture & Fixtures, computers on 1230.
    expect(await linesOf(reval.body.journalEntryId)).toEqual({
      "1220": [0, 2000],
      "1240": [2875.28, 0],
      "3050": [0, 875.28],
    });

    // H4: the impairment of a revalued asset is charged to its surplus (IAS 36.60-61).
    const imp = await t.as.post(`/api/fixed-assets/${furniture.body.id}/impair`, {
      date: "2026-10-31",
      amount: 500,
    });
    expect(imp.status, imp.text).toBeLessThan(300);
    expect(await linesOf(imp.body.journalEntryId)).toEqual({
      "1240": [0, 500],
      "3050": [500, 0],
    });
    expect(imp.body).toMatchObject({ chargedToRevaluationSurplus: 500, chargedToProfitOrLoss: 0 });

    const sale = await t.as.post(`/api/fixed-assets/${server.body.id}/dispose`, {
      disposalDate: "2026-10-31",
      disposalAmount: 20000,
      proceedsAccountId: bank.id,
      vatTreatment: "standard",
    });
    expect(sale.status, sale.text).toBeLessThan(300);
    expect(await linesOf(sale.body.journalEntryId)).toEqual({
      "1020": [21000, 0],
      "1230": [0, 36000],
      "1240": [10000, 0],
      "2020": [0, 1000],
      "5130": [6000, 0],
    });

    // C5: operating -800, investing -26,000 (purchases -46,000, proceeds +20,000), financing 0.
    const cf = await get(
      t,
      `/api/companies/${cid}/financial-statements/cash-flow?startDate=2026-01-01&endDate=2026-10-31`
    );
    expect(cf.netIncome).toBe(-18875.28);
    expect(cf.operating.total).toBe(-800);
    expect(cf.investing.total).toBe(-26000);
    expect(cf.financing.total).toBe(0);
    expect(cf.fxEffect.total).toBe(0);
    expect(cf.netCashChange).toBe(-26800);
    expect(cf.cashProof.isBalanced).toBe(true);
    const op = Object.fromEntries(
      cf.operating.breakdown.map((l: any) => [`${l.kind}:${l.accountCode}`, l.amount])
    );
    expect(op).toEqual({
      "net_income:": -18875.28,
      "non_cash:5100": 12875.28,
      "non_cash:5130": 6000,
      "balance_change:1050": -1800,
      "balance_change:2020": 1000,
    });
    // B1 (M3): purchases and proceeds per class of PPE (IAS 7.21 gross; IAS 16.37 classes).
    expect(
      cf.investing.breakdown
        .map((l: any) => [l.kind, l.accountCode, l.amount, l.accountName])
        .sort((x: any[], y: any[]) => `${x[0]}${x[1]}`.localeCompare(`${y[0]}${y[1]}`))
    ).toEqual([
      ["proceeds", "1230", 20000, "Proceeds from disposal of Computers & Software"],
      ["purchase", "1220", -10000, "Purchase of Furniture & Fixtures"],
      ["purchase", "1230", -36000, "Purchase of Computers & Software"],
    ]);
    expect(cf.financing.breakdown).toEqual([]);

    // H11: OCI (875.28 - 500) and total comprehensive income on the P&L.
    const pl = await get(
      t,
      `/api/companies/${cid}/reports/profit-loss?from=2026-01-01&to=2026-10-31`
    );
    expect(pl.netProfit).toBe(-18875.28);
    expect(pl.otherComprehensiveIncome).toBe(375.28);
    expect(pl.totalComprehensiveIncome).toBe(-18500);
    expect(pl.sections.otherComprehensiveIncome.lines.map((l: any) => l.accountCode)).toEqual([
      "3050",
    ]);
    const ce = await get(
      t,
      `/api/companies/${cid}/reports/changes-in-equity?from=2026-01-01&to=2026-10-31`
    );
    expect(ce).toMatchObject({
      profitForPeriod: -18875.28,
      otherComprehensiveIncome: 375.28,
      totalComprehensiveIncome: -18500,
      capitalMovements: 0,
      reserveTransfers: 0,
      ties: true,
    });
    expect(ce.closing.revaluationReserve).toBe(375.28);
    expect(ce.closing.capital).toBe(0);
    const bs = await get(t, `/api/companies/${cid}/reports/balance-sheet?asOf=2026-10-31`);
    expect(bs.isBalanced).toBe(true);

    // H5: register ties to GL; the schedule projects from the revised carrying amount.
    const reg = await get(t, `/api/fixed-assets/${furniture.body.id}`);
    expect(Number(reg.gross_carrying_amount)).toBe(8000);
    expect(Number(reg.accumulated_depreciation_and_impairment)).toBe(500);
    expect(Number(reg.revaluation_reserve)).toBe(375.28);
    expect(await glBalance(t, "1220")).toBe(8000);
    expect(await glBalance(t, "1230")).toBe(0);
    expect(await glBalance(t, "1240")).toBe(-500);
    const schedule = await get(t, `/api/fixed-assets/${furniture.body.id}/schedule`);
    const nov = schedule.book.find((p: any) => p.year === 2026 && p.month === 11);
    expect(nov).toMatchObject({ amount: 250, posted: false });
    expect(schedule.book.filter((p: any) => p.posted)).toHaveLength(10);
  });
});

describe("A3 S10 corporate tax presentation", () => {
  it("[H3] income tax is presented after profit before tax, not in operating expenses", async () => {
    const t = await tenant("A3S10");
    const cid = t.company.id;
    const mk = async (code: string, nameEn: string, type: string, subType?: string) => {
      const r = await t.as.post(`/api/companies/${cid}/accounts`, { code, nameEn, type, subType });
      expect(r.status, r.text).toBeLessThan(300);
    };
    await mk("4045", "Dividend Income (UAE subsidiary)", "income", "other_income");
    await mk("5200", "Corporate Tax Expense", "expense");
    await mk("2060", "Corporate Tax Payable", "liability", "current_liability");
    await postJournalEntry(t, {
      date: "2025-06-30",
      lines: [
        { code: "1020", debit: 1_020_000 },
        { code: "4020", credit: 1_000_000 },
        { code: "4045", credit: 20_000 },
      ],
    });
    await postJournalEntry(t, {
      date: "2025-06-30",
      lines: [
        { code: "5020", debit: 345_000 },
        { code: "1020", credit: 345_000 },
      ],
    });
    await postJournalEntry(t, {
      date: "2025-12-31",
      lines: [
        { code: "5200", debit: 27_450 },
        { code: "2060", credit: 27_450 },
      ],
    });
    const pl = await get(
      t,
      `/api/companies/${cid}/reports/profit-loss?from=2025-01-01&to=2025-12-31`
    );
    expect(pl.operatingExpenses).toBe(345_000);
    expect(pl.operatingProfit).toBe(655_000);
    expect(pl.otherIncome).toBe(20_000);
    expect(pl.profitBeforeTax).toBe(675_000);
    expect(pl.incomeTaxExpense).toBe(27_450);
    expect(pl.netProfit).toBe(647_550);
    expect(pl.totalIncome - pl.totalExpenses).toBe(pl.netProfit);
    expect(pl.sections.operatingExpenses.lines.map((l: any) => l.accountCode)).not.toContain(
      "5200"
    );
    expect(pl.sections.incomeTax.lines.map((l: any) => l.accountCode)).toEqual(["5200"]);
    const legacy = await get(
      t,
      `/api/companies/${cid}/financial-statements/profit-loss?startDate=2025-01-01&endDate=2025-12-31`
    );
    expect(legacy.revenue - legacy.expenses).toBe(legacy.netIncome);
    expect(legacy.statement.sections.operatingExpenses.total).toBe(345_000);
  });
});

describe("A3 S3 foreign currency: aging after revaluation and FX effect on cash", () => {
  it("[H6][C5] aging ties to GL through the revaluation line; cash flow shows the FX effect", async () => {
    const t = await tenant("A3S3");
    const cid = t.company.id;
    const usdBank = await t.as.post(`/api/companies/${cid}/bank-accounts`, {
      nameEn: "USD account",
      bankName: "FAB",
      currency: "USD",
    });
    expect(usdBank.status, usdBank.text).toBe(201);
    const rate = async (r: number, effectiveDate: string) => {
      const x = await t.as.post(`/api/companies/${cid}/exchange-rates`, {
        fromCurrency: "USD",
        rate: r,
        effectiveDate,
      });
      expect(x.status, x.text).toBeLessThan(300);
    };
    await rate(3.6725, "2026-10-01");
    const inv = await issuedInvoice(t, {
      date: "2026-10-02",
      currency: "USD",
      exchangeRate: 3.6725,
      lines: [
        {
          description: "Export consulting",
          quantity: 1,
          unitPrice: 1000,
          vatRate: 0,
          vatSupplyType: "zero_rated",
        },
      ],
    });
    const pay = await t.as.post(`/api/companies/${cid}/invoices/${inv.id}/payments`, {
      amount: 600,
      date: "2026-10-20",
      paymentAccountId: usdBank.body.glAccountId,
      exchangeRate: 3.68,
    });
    expect(pay.status, pay.text).toBe(201);
    await rate(3.69, "2026-10-31");
    const run = await t.as.post(`/api/companies/${cid}/exchange-rates/revalue`, {
      asOf: "2026-10-31",
    });
    expect(run.status, run.text).toBe(201);

    // AR: 400 USD at 3.6725 = 1,469.00 in the aging; GL carries +7.00 revaluation.
    const ar = await get(t, `/api/companies/${cid}/reports/aged-receivables?asOf=2026-10-31`);
    expect(ar.totals.total).toBe(1469);
    expect(ar.fxRevaluation).toBe(7);
    expect(ar.reconciliation).toMatchObject({
      glBalance: 1476,
      agingTotal: 1469,
      adjustedAgingTotal: 1476,
      difference: 0,
      isReconciled: true,
    });
    expect(ar.reconciliation.reconcilingItems).toEqual([
      expect.objectContaining({ key: "fx_revaluation", amount: 7 }),
    ]);
    const nov = await get(t, `/api/companies/${cid}/reports/aged-receivables?asOf=2026-11-01`);
    expect(nov.fxRevaluation).toBe(0);
    expect(nov.reconciliation.isReconciled).toBe(true);

    // Cash: 2,208 received, +6.00 revaluation (600 USD at 3.69 = 2,214) is the FX effect.
    const cf = await get(
      t,
      `/api/companies/${cid}/reports/cash-flow?from=2026-10-01&to=2026-10-31`
    );
    expect(cf.fxEffect.total).toBe(6);
    expect(cf.operating.total).toBe(2208);
    expect(cf.investing.total).toBe(0);
    expect(cf.financing.total).toBe(0);
    expect(cf.netCashChange).toBe(2214);
    expect(cf.cashProof.isBalanced).toBe(true);
    const unrealised = cf.operating.breakdown.find(
      (l: any) => l.accountId === "noncash:fx-unrealised-cash"
    );
    expect(unrealised.amount).toBe(-6);
    const direct = await get(
      t,
      `/api/companies/${cid}/reports/cash-flow?from=2026-10-01&to=2026-10-31&method=direct`
    );
    expect(direct.fxEffect.total).toBe(6);
    expect(direct.cashProof.isBalanced).toBe(true);
  });
});

describe("A3 S1 bad debts: write-off, VAT relief and the allowance", () => {
  it("[H1] prorates bad-debt relief to the exact fil below a half-fil boundary", async () => {
    const t = await tenant("A3ExactBadDebt");
    const cid = t.company.id;
    const bank = await accountByCode(t, "1020");
    const inv = await issuedInvoice(t, {
      date: "2026-03-01",
      dueDate: "2026-03-31",
      lines: [
        { description: "Consulting", quantity: 1, unitPrice: 1_000_000_000_000.01, vatRate: 5 },
      ],
    });
    const part = await t.as.post(`/api/companies/${cid}/invoices/${inv.id}/payments`, {
      amount: 524_999_999_998.85,
      date: "2026-04-01",
      paymentAccountId: bank.id,
    });
    expect(part.status, part.text).toBe(201);
    const writtenOff = await t.as.post(`/api/companies/${cid}/invoices/${inv.id}/write-off`, {
      date: "2026-10-15",
      reason: "Customer in liquidation",
    });
    expect(writtenOff.status, writtenOff.text).toBe(201);
    const claim = await t.as.post(`/api/companies/${cid}/vat/bad-debt-relief`, {
      invoiceId: inv.id,
      claimDate: "2026-10-20",
      writtenOff: true,
      customerNotified: true,
    });
    expect(claim.status, claim.text).toBe(201);
    expect(Number(claim.body.vatAmount)).toBe(25_000_000_000.05);
    expect(await linesOf(claim.body.journalEntryId)).toEqual({
      "2020": [25_000_000_000.05, 0],
      "5120": [0, 25_000_000_000.05],
    });
  });

  it("[H1][M5] write-off settles the invoice, Art. 64 relief on the written-off amount, allowance reconciles", async () => {
    const t = await tenant("A3S1");
    const cid = t.company.id;
    const bank = await accountByCode(t, "1020");
    const inv = await issuedInvoice(t, {
      date: "2026-03-01",
      dueDate: "2026-03-31",
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 2000, vatRate: 5 }],
    });
    const part = await t.as.post(`/api/companies/${cid}/invoices/${inv.id}/payments`, {
      amount: 1050,
      date: "2026-04-01",
      paymentAccountId: bank.id,
    });
    expect(part.status, part.text).toBe(201);

    // Relief needs an actual write-off (Art. 64(1)(b)).
    const early = await t.as.post(`/api/companies/${cid}/vat/bad-debt-relief`, {
      invoiceId: inv.id,
      claimDate: "2026-10-20",
      writtenOff: true,
      customerNotified: true,
    });
    expect(early.status).toBe(422);
    expect(early.body.code).toBe("BAD_DEBT_NOT_WRITTEN_OFF");

    const wo = await t.as.post(`/api/companies/${cid}/invoices/${inv.id}/write-off`, {
      date: "2026-10-15",
      reason: "Customer in liquidation",
    });
    expect(wo.status, wo.text).toBe(201);
    expect(wo.body.invoice.status).toBe("paid");
    expect(await linesOf(wo.body.journalEntryId)).toEqual({
      "1040": [0, 1050],
      "5120": [1050, 0],
    });
    const claim = await t.as.post(`/api/companies/${cid}/vat/bad-debt-relief`, {
      invoiceId: inv.id,
      claimDate: "2026-10-20",
      writtenOff: true,
      customerNotified: true,
      customerNotifiedAt: "2026-10-19",
    });
    expect(claim.status, claim.text).toBe(201);
    expect(Number(claim.body.vatAmount)).toBe(50);
    expect(await linesOf(claim.body.journalEntryId)).toEqual({
      "2020": [50, 0],
      "5120": [0, 50],
    });
    expect(await glBalance(t, "5120")).toBe(1000);
    const ar = await get(t, `/api/companies/${cid}/reports/aged-receivables?asOf=2026-10-31`);
    expect(ar.totals.total).toBe(0);
    expect(ar.reconciliation.glBalance).toBe(0);
    expect(ar.reconciliation.isReconciled).toBe(true);
    // Writing off more than is open is refused; a reserved method cannot be used as a payment.
    const again = await t.as.post(`/api/companies/${cid}/invoices/${inv.id}/write-off`, {
      date: "2026-10-16",
      reason: "Duplicate",
    });
    expect(again.status).toBe(409);

    // Allowance (IFRS 9 simplified approach) on a second invoice: aging still ties to GL 1040.
    const inv2 = await issuedInvoice(t, {
      date: "2026-09-01",
      dueDate: "2026-09-30",
      lines: [{ description: "Support", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    const allow = await t.as.post(`/api/companies/${cid}/receivables/allowance`, {
      date: "2026-10-31",
      targetBalance: 300,
      memo: "Lifetime ECL, over-30 bucket",
    });
    expect(allow.status, allow.text).toBe(201);
    expect(await linesOf(allow.body.journalEntryId)).toEqual({
      "1045": [0, 300],
      "5120": [300, 0],
    });
    const ar2 = await get(t, `/api/companies/${cid}/reports/aged-receivables?asOf=2026-10-31`);
    expect(ar2.totals.total).toBe(1050);
    expect(ar2.allowanceForDoubtfulDebts).toBe(300);
    expect(ar2.netCarryingAmount).toBe(750);
    expect(ar2.reconciliation).toMatchObject({ glBalance: 1050, isReconciled: true });
    const bs = await get(t, `/api/companies/${cid}/reports/balance-sheet?asOf=2026-10-31`);
    const allowanceLine = bs.statement.assets.current.lines.find(
      (l: any) => l.accountCode === "1045"
    );
    expect(allowanceLine.amount).toBe(-300);
    expect(bs.isBalanced).toBe(true);
    const allowGet = await get(t, `/api/companies/${cid}/receivables/allowance?asOf=2026-10-31`);
    expect(allowGet.balance).toBe(300);

    // Write off 200 of inv2 against the allowance: Dr 1045 / Cr 1040.
    const wo2 = await t.as.post(`/api/companies/${cid}/invoices/${inv2.id}/write-off`, {
      date: "2026-11-02",
      amount: 200,
      against: "allowance",
      reason: "Agreed settlement discount not recoverable",
    });
    expect(wo2.status, wo2.text).toBe(201);
    expect(await linesOf(wo2.body.journalEntryId)).toEqual({
      "1040": [0, 200],
      "1045": [200, 0],
    });
    expect(wo2.body.invoice.status).toBe("partial");

    // Recovery: the customer pays the written-off 1,050 on invoice 1. The write-off is reinstated,
    // the payment settles and the bad-debt relief is reversed (Art. 64(3)).
    const pay = await t.as.post(`/api/companies/${cid}/invoices/${inv.id}/payments`, {
      amount: 1050,
      date: "2026-11-05",
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBe(201);
    expect(pay.body.status).toBe("paid");
    let status = "claimed";
    for (let i = 0; i < 40 && status !== "reversed"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const rows = await h.sql<{ status: string }>(
        `SELECT status FROM bad_debt_relief_claims WHERE id = $1`,
        [claim.body.id]
      );
      status = rows[0].status;
    }
    expect(status).toBe("reversed");
    expect(await glBalance(t, "5120")).toBe(300);
    const ar3 = await get(t, `/api/companies/${cid}/reports/aged-receivables?asOf=2026-11-05`);
    expect(ar3.reconciliation.isReconciled).toBe(true);
    expect(ar3.totals.total).toBe(850);

    const reserved = await t.as.post(`/api/companies/${cid}/invoices/${inv2.id}/payments`, {
      amount: 10,
      date: "2026-11-05",
      method: "write_off",
      paymentAccountId: bank.id,
    });
    expect(reserved.status).toBe(422);
    expect(reserved.body.code).toBe("PAYMENT_METHOD_RESERVED");
  });

  it("[H1] RBAC: a viewer cannot write off or set the allowance", async () => {
    const t = await h.createTenant({ name: "A3Viewer", role: "viewer" });
    const cid = t.company.id;
    const r = await t.as.post(`/api/companies/${cid}/receivables/allowance`, {
      date: "2026-10-31",
      targetBalance: 100,
    });
    expect(r.status).toBe(403);
  });
});

describe("A3 gratuity provision classification", () => {
  it("[H10] 2036 is non-current; only known leavers' provision is current; 0119 reclassifies safely", async () => {
    const t = await tenant("A3Grat");
    const cid = t.company.id;
    const acct = await h.sql<{ sub_type: string }>(
      `SELECT sub_type FROM accounts WHERE company_id = $1 AND code = '2036'`,
      [cid]
    );
    expect(acct[0].sub_type).toBe("long_term_liability");
    await postJournalEntry(t, {
      date: "2026-10-31",
      lines: [
        { code: "5028", debit: 10_000 },
        { code: "2036", credit: 10_000 },
      ],
    });
    await h.sql(
      `INSERT INTO employees (company_id, full_name, join_date, termination_date, opening_gratuity_provision)
       VALUES ($1, 'Leaver', '2020-01-01', '2027-01-31', 4000),
              ($1, 'Stayer', '2020-01-01', NULL, 6000)`,
      [cid]
    );
    const bs = await get(t, `/api/companies/${cid}/reports/balance-sheet?asOf=2026-10-31`);
    const cur = bs.statement.liabilities.current.lines.find((l: any) => l.accountCode === "2036");
    const non = bs.statement.liabilities.nonCurrent.lines.find(
      (l: any) => l.accountCode === "2036"
    );
    expect(cur.amount).toBe(4000);
    expect(cur.accountName).toMatch(/current portion/);
    expect(non.amount).toBe(6000);
    expect(bs.isBalanced).toBe(true);

    // Existing companies: 0119 moves only account metadata, never a journal.
    await h.sql(
      `UPDATE accounts SET sub_type = 'current_liability' WHERE company_id = $1 AND code = '2036'`,
      [cid]
    );
    const before = await h.sql<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = $1`,
      [cid]
    );
    const file = fs.readFileSync(path.join(repoRoot, "migrations/0119_a3_chart.sql"), "utf8");
    for (const stmt of file.split("--> statement-breakpoint")) {
      await h.sql(stmt);
      await h.sql(stmt); // idempotent
    }
    const after = await h.sql<{ sub_type: string }>(
      `SELECT sub_type FROM accounts WHERE company_id = $1 AND code = '2036'`,
      [cid]
    );
    expect(after[0].sub_type).toBe("long_term_liability");
    const n = await h.sql<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = $1`,
      [cid]
    );
    expect(n[0].n).toBe(before[0].n);
  });
});
