/**
 * Accounting round B2 (re-audit): statements presentation and VAT settlement.
 *   NC2  the cash flow is classified from cash legs: an asset bought on credit, a debit note on
 *        it, a declared-unpaid dividend and an opening provision charged to retained earnings are
 *        non-cash (excluded, disclosed: IAS 7.43); the later payment is investing / financing.
 *   NM1  direct and indirect methods agree on every subtotal; PPE purchases and proceeds gross
 *        (IAS 7.21); VAT on the asset purchase and disposal in operating in both.
 *   NM4  4091 unrealised FX gain is other income, not revenue (P&L and dashboard trends).
 *   NH4  settling an amended VAT return settles only the difference; 2020 / 1050 end at zero.
 *   NL1  a VAT settlement (and its reversal) is not refused by a later filed period.
 *   NM2  a debit note on a bill-sourced asset re-costs the register entry (ties to GL).
 *   FA   straight line after a revaluation to exactly the original cost is re-based; the
 *        register's book columns follow asOf; NL9 the register shows the revaluation reserve.
 * Every scenario posts through the API (Bearer client).
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";

async function tenant(name: string): Promise<Tenant> {
  return h.createTenant({
    name,
    planId: "professional",
    companyColumns: {
      trn_vat_number: TRN,
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
}

const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function get(t: Tenant, url: string) {
  const r = await t.as.get(url);
  expect(r.status, `${url}: ${r.text.slice(0, 300)}`).toBe(200);
  return r.body;
}

async function glBalance(t: Tenant, code: string): Promise<number> {
  const rows = await h.sql<{ n: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100)), 0)::bigint::text AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  return Number(rows[0].n) / 100;
}

async function linesOf(entryId: string) {
  const rows = await h.sql<{ code: string; d: string; c: string }>(
    `SELECT a.code, SUM(jl.debit)::text AS d, SUM(jl.credit)::text AS c
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.entry_id = $1 GROUP BY a.code ORDER BY a.code`,
    [entryId]
  );
  return Object.fromEntries(rows.map((r) => [r.code, [Number(r.d), Number(r.c)]]));
}

async function journal(
  t: Tenant,
  date: string,
  lines: Array<[string, number, number]>,
  extra: Record<string, unknown> = {}
) {
  const body = {
    date,
    memo: "B2 test",
    status: "posted",
    lines: await Promise.all(
      lines.map(async ([code, debit, credit]) => ({
        accountId: (await accountByCode(t, code)).id,
        debit,
        credit,
      }))
    ),
    ...extra,
  };
  const r = await t.as.post(`${base(t)}/journal`, body);
  expect(r.status, r.text).toBeLessThan(300);
  return r.body;
}

type Cf = {
  operating: { total: number; breakdown: Array<Record<string, any>> };
  investing: { total: number; breakdown: Array<Record<string, any>> };
  financing: { total: number; breakdown: Array<Record<string, any>> };
  fxEffect: { total: number };
  netCashChange: number;
  cashProof: { isBalanced: boolean };
  nonCashTransactions: Array<{ source: string; amount: number }>;
};

async function bothMethods(t: Tenant, from: string, to: string) {
  const url = `${base(t)}/financial-statements/cash-flow?startDate=${from}&endDate=${to}`;
  const indirect = (await get(t, url)) as Cf;
  const direct = (await get(t, `${url}&method=direct`)) as Cf;
  for (const cf of [indirect, direct]) expect(cf.cashProof.isBalanced).toBe(true);
  // NM1: one classification, so every subtotal agrees.
  expect(direct.operating.total).toBe(indirect.operating.total);
  expect(direct.investing.total).toBe(indirect.investing.total);
  expect(direct.financing.total).toBe(indirect.financing.total);
  expect(direct.fxEffect.total).toBe(indirect.fxEffect.total);
  expect(direct.investing.breakdown).toEqual(indirect.investing.breakdown);
  return { indirect, direct };
}

const subtotals = (cf: Cf) => ({
  operating: cf.operating.total,
  investing: cf.investing.total,
  financing: cf.financing.total,
});

describe("B2 NC2 / NM2: an asset bought on credit is not a cash flow", () => {
  it("[NC2][NM2] S2 car on credit with a debit note: Oct operating -4,050, investing 0; Nov payment is investing; register ties to GL", async () => {
    const t = await tenant("B2S2");
    const vehicles = await accountByCode(t, "1250");
    const bank = await accountByCode(t, "1020");
    const car = await t.as.post(`${base(t)}/bills`, {
      vendor_name: "Auto Dealer LLC",
      vendor_trn: "100000000000029",
      bill_number: "CAR-1",
      bill_date: "2026-10-05",
      due_date: "2026-12-31",
      category: "motor vehicle personal",
      line_items: [
        {
          description: "Saloon car",
          quantity: 1,
          unit_price: 80000,
          vat_rate: 5,
          account_id: vehicles.id,
        },
      ],
    });
    expect(car.status, car.text).toBe(200);
    expect((await t.as.post(`/api/bills/${car.body.id}/approve`, {})).status).toBe(200);
    // Blocked VAT (Exec. Reg. Art. 53(1)(b)) is part of the cost: Dr 1250 84,000 / Cr 2010.
    expect(await glBalance(t, "1250")).toBe(84000);

    const dn = await t.as.post(`${base(t)}/debit-notes`, {
      bill_id: car.body.id,
      note_date: "2026-10-20",
      reason: "Price reduction",
      lines: [{ description: "Saloon car", amount: 1000, vat_rate: 5, account_id: vehicles.id }],
    });
    expect(dn.status, dn.text).toBeLessThan(300);
    const [dnEntry] = await h.sql<{ id: string }>(
      `SELECT id FROM journal_entries WHERE source = 'vendor_debit_note' AND source_id = $1`,
      [dn.body.id]
    );
    expect(await linesOf(dnEntry.id)).toEqual({
      "1250": [0, 1050],
      "2010": [1050, 0],
    });
    // NM2: the register entry the bill opened is re-costed with the GL (84,000 - 1,050).
    const [fa] = await h.sql<{ id: string; purchase_cost: string; status: string }>(
      `SELECT id, purchase_cost::text, status FROM fixed_assets WHERE source_bill_id = $1`,
      [car.body.id]
    );
    expect(fa.purchase_cost).toBe("82950.00");
    expect(await glBalance(t, "1250")).toBe(82950);
    const done = await t.as.patch(`/api/fixed-assets/${fa.id}`, { usefulLifeYears: 5 });
    expect(done.status, done.text).toBe(200);
    const reg = await get(t, `${base(t)}/fixed-assets/register?asOf=2026-10-31`);
    const row = reg.rows.find((r: { id: string }) => r.id === fa.id);
    expect(row).toMatchObject({ cost: 82950, grossCarryingAmount: 82950, bookNetBookValue: 82950 });

    // The month's only cash: rent paid 4,050.
    await journal(t, "2026-10-25", [
      ["5010", 4050, 0],
      ["1020", 0, 4050],
    ]);

    const oct = await bothMethods(t, "2026-10-01", "2026-10-31");
    // Hand: operating -4,050, investing 0 (car unpaid), financing 0 (was +78,900 / -82,950).
    expect(subtotals(oct.indirect)).toEqual({ operating: -4050, investing: 0, financing: 0 });
    expect(oct.indirect.operating.breakdown.map((l) => [l.kind, l.amount])).toEqual([
      ["net_income", -4050],
    ]);
    // IAS 7.43: the credit purchase and the debit note are disclosed, not presented.
    expect(oct.indirect.nonCashTransactions.map((n) => [n.source, n.amount]).sort()).toEqual([
      ["bill", 84000],
      ["vendor_debit_note", 1050],
    ]);

    // Paying the car in November is the investing outflow (IAS 7.16(a)).
    const pay = await t.as.post(`/api/bills/${car.body.id}/payments`, {
      payment_date: "2026-11-10",
      amount: 82950,
      payment_account_id: bank.id,
    });
    expect(pay.status, pay.text).toBe(200);
    const nov = await bothMethods(t, "2026-11-01", "2026-11-30");
    expect(subtotals(nov.indirect)).toEqual({ operating: 0, investing: -82950, financing: 0 });
    expect(nov.indirect.investing.breakdown.map((l) => [l.kind, l.accountCode, l.amount])).toEqual([
      ["purchase", "1250", -82950],
    ]);
  });
});

describe("B2 NC2: non-cash equity and financing transactions", () => {
  it("[NC2] S5 opening gratuity charged to RE and X1 declared-unpaid dividend are not cash flows; paying the dividend is financing", async () => {
    const t = await tenant("B2X1");
    const created = await t.as.post(`${base(t)}/accounts`, {
      code: "2115",
      nameEn: "Dividends Payable",
      nameAr: "توزيعات أرباح مستحقة الدفع",
      type: "liability",
      subType: "current_liability",
    });
    expect(created.status, created.text).toBeLessThan(300);
    await journal(t, "2026-09-01", [
      ["1020", 100000, 0],
      ["3010", 0, 100000],
    ]);
    await journal(
      t,
      "2026-09-30",
      [
        ["3020", 42452.05, 0],
        ["2036", 0, 42452.05],
      ],
      { controlAdjustment: { reason: "Opening gratuity provision at go-live" } }
    );
    await journal(t, "2026-10-15", [
      ["3020", 20000, 0],
      ["2115", 0, 20000],
    ]);

    const sep = await bothMethods(t, "2026-09-01", "2026-09-30");
    // Capital paid in is financing; the go-live provision is not a cash flow (was -42,452.05).
    expect(subtotals(sep.indirect)).toEqual({ operating: 0, investing: 0, financing: 100000 });
    expect(sep.indirect.nonCashTransactions.map((n) => n.amount)).toEqual([42452.05]);

    const oct = await bothMethods(t, "2026-10-01", "2026-10-31");
    // Was operating +20,000 / financing -20,000.
    expect(subtotals(oct.indirect)).toEqual({ operating: 0, investing: 0, financing: 0 });
    expect(oct.indirect.nonCashTransactions.map((n) => n.amount)).toEqual([20000]);

    await journal(t, "2026-11-05", [
      ["2115", 20000, 0],
      ["1020", 0, 20000],
    ]);
    const nov = await bothMethods(t, "2026-11-01", "2026-11-30");
    // Dividends paid are financing (IAS 7.34).
    expect(subtotals(nov.indirect)).toEqual({ operating: 0, investing: 0, financing: -20000 });
    expect(nov.indirect.financing.breakdown.map((l) => [l.accountCode, l.amount])).toEqual([
      ["2115", -20000],
    ]);

    // YTD: the cash is capital in, dividend out.
    const ytd = await bothMethods(t, "2026-01-01", "2026-11-30");
    expect(subtotals(ytd.indirect)).toEqual({ operating: 0, investing: 0, financing: 80000 });
  });
});

describe("B2 NM1: direct method presents the S7 flows gross, VAT in operating", () => {
  it("[NM1] purchase -36,000 and proceeds +20,000 gross; VAT -1,800 / +1,000 operating in both methods", async () => {
    const t = await tenant("B2S7");
    const bank = await accountByCode(t, "1020");
    const server = await t.as.post(`${base(t)}/fixed-assets`, {
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
    const dep = await t.as.post(`/api/fixed-assets/${server.body.id}/depreciate`, {
      month: 1,
      year: 2026,
    });
    expect(dep.status, dep.text).toBe(200);
    const sale = await t.as.post(`/api/fixed-assets/${server.body.id}/dispose`, {
      disposalDate: "2026-02-28",
      disposalAmount: 20000,
      proceedsAccountId: bank.id,
      vatTreatment: "standard",
    });
    expect(sale.status, sale.text).toBeLessThan(300);
    expect(await linesOf(sale.body.journalEntryId)).toEqual({
      "1020": [21000, 0],
      "1240": [1000, 0],
      "1290": [0, 36000],
      "2020": [0, 1000],
      "5130": [15000, 0],
    });
    const { indirect, direct } = await bothMethods(t, "2026-01-01", "2026-02-28");
    expect(subtotals(indirect)).toEqual({ operating: -800, investing: -16000, financing: 0 });
    expect(indirect.investing.breakdown.map((l) => [l.kind, l.accountCode, l.amount])).toEqual([
      ["purchase", "1290", -36000],
      ["proceeds", "1290", 20000],
    ]);
    expect(
      Object.fromEntries(
        indirect.operating.breakdown.map((l) => [`${l.kind}:${l.accountCode}`, l.amount])
      )
    ).toEqual({
      "net_income:": -16000,
      "non_cash:5100": 1000,
      "non_cash:5130": 15000,
      "balance_change:1050": -1800,
      "balance_change:2020": 1000,
    });
    // Direct: operating is the VAT paid and collected (was 0, with VAT inside investing).
    expect(direct.operating.breakdown.map((l) => [l.accountCode, l.amount])).toEqual([
      ["1050", -1800],
      ["2020", 1000],
    ]);
  });
});

describe("B2 NM4: unrealised FX gain is other income", () => {
  it("[NM4] S3: 4091 from the period-end revaluation is presented in other income, not revenue", async () => {
    const t = await tenant("B2S3");
    const cid = t.company.id;
    const usdBank = await t.as.post(`${base(t)}/bank-accounts`, {
      nameEn: "USD account",
      bankName: "FAB",
      currency: "USD",
    });
    expect(usdBank.status, usdBank.text).toBe(201);
    const rate = async (r: number, effectiveDate: string) => {
      const x = await t.as.post(`${base(t)}/exchange-rates`, {
        fromCurrency: "USD",
        rate: r,
        effectiveDate,
      });
      expect(x.status, x.text).toBeLessThan(300);
    };
    await rate(3.6725, "2026-10-01");
    const inv = await t.as.post(`${base(t)}/invoices`, {
      customerName: "Export Customer LLC",
      placeOfSupplyEmirate: "dubai",
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
    expect(inv.status, inv.text).toBe(200);
    expect(
      (await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" })).status
    ).toBe(200);
    const pay = await t.as.post(`${base(t)}/invoices/${inv.body.id}/payments`, {
      amount: 600,
      date: "2026-10-20",
      paymentAccountId: usdBank.body.glAccountId,
      exchangeRate: 3.68,
    });
    expect(pay.status, pay.text).toBe(201);
    await rate(3.69, "2026-10-31");
    const run = await t.as.post(`${base(t)}/exchange-rates/revalue`, { asOf: "2026-10-31" });
    expect(run.status, run.text).toBe(201);
    // AR 400 USD +7.00, bank 600 USD +6.00 -> Cr 4091 13.00 on 31 Oct (reversed on 1 Nov).
    const acct = await h.sql<{ sub_type: string | null }>(
      `SELECT sub_type FROM accounts WHERE company_id = $1 AND code = '4091'`,
      [cid]
    );
    expect(acct[0].sub_type).toBe("other_income");

    const pl = await get(t, `${base(t)}/reports/profit-loss?from=2026-10-01&to=2026-10-31`);
    // Revenue is the invoice only (1,000 x 3.6725); FX realised 4.50 + unrealised 13.00.
    expect(pl.revenue).toBe(3672.5);
    expect(pl.otherIncome).toBe(17.5);
    expect(pl.sections.revenue.lines.map((l: any) => l.accountCode)).not.toContain("4091");
    expect(pl.sections.otherIncome.lines.map((l: any) => [l.accountCode, l.amount]).sort()).toEqual(
      [
        ["4090", 4.5],
        ["4091", 13],
      ]
    );
    expect(pl.netProfit).toBe(3690);
    const trends = await get(t, `${base(t)}/dashboard/monthly-trends`);
    const octTrend = trends.find((p: { key: string }) => p.key === "2026-10");
    if (octTrend) {
      expect(octTrend).toMatchObject({ revenue: 3672.5, otherIncome: 17.5, netProfit: 3690 });
    }
  });
});

describe("B2 NH4 / NL1: settling an amended VAT return", () => {
  it("[NH4][NL1] the amendment settles only the difference; 2020 / 1050 end at zero; reversal stays consistent", async () => {
    const t = await tenant("B2X3");
    const bank = await accountByCode(t, "1020");
    const invoice = async (date: string, amount: number) => {
      const c = await t.as.post(`${base(t)}/invoices`, {
        customerName: "Acme LLC",
        customerTrn: "100000000000011",
        date,
        placeOfSupplyEmirate: "dubai",
        lines: [{ description: "Job", quantity: 1, unitPrice: amount, vatRate: 5 }],
      });
      expect(c.status, c.text).toBe(200);
      return c.body as { id: string };
    };
    const issue = (id: string) => t.as.patch(`/api/invoices/${id}/status`, { status: "sent" });
    const q1 = await invoice("2026-02-01", 9000);
    expect((await issue(q1.id)).status).toBe(200);
    const bill = await t.as.post(`${base(t)}/bills`, {
      vendor_name: "Supplier LLC",
      vendor_trn: "100000000000029",
      bill_number: "B-NH4",
      bill_date: "2026-03-10",
      due_date: "2026-12-31",
      line_items: [{ description: "Supplies", quantity: 1, unit_price: 4600, vat_rate: 5 }],
    });
    expect(bill.status, bill.text).toBe(200);
    expect((await t.as.post(`/api/bills/${bill.body.id}/approve`, {})).status).toBe(200);

    const gen = await t.as.post(`${base(t)}/vat-returns/generate`, {
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    });
    expect(gen.status, gen.text).toBe(201);
    const sub = await t.as.post(`/api/vat-returns/${gen.body.id}/submit`, {
      ftaReferenceNumber: "FTA-1",
    });
    expect(sub.status, sub.text).toBe(200);
    const paid = await t.as.post(`/api/vat-returns/${gen.body.id}/settlement`, {
      date: "2026-04-20",
      paymentAccountId: bank.id,
    });
    expect(paid.status, paid.text).toBe(201);
    // Output 450, input 230, paid 220.
    expect(await linesOf(paid.body.journalEntryId)).toEqual({
      "1020": [0, 220],
      "1050": [0, 230],
      "2020": [450, 0],
    });

    // Voluntary disclosure: a missed 1,000 + 50 invoice of 15 Feb.
    const amend = await t.as.post(`/api/vat-returns/${gen.body.id}/amend`, {
      reason: "Invoice of 15 Feb was missed",
    });
    expect(amend.status, amend.text).toBe(201);
    const late = await invoice("2026-02-15", 1000);
    expect((await issue(late.id)).status).toBe(200);
    const regen = await t.as.post(`${base(t)}/vat-returns/generate`, {
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    });
    expect(regen.status, regen.text).toBe(201);
    expect(regen.body.id).toBe(amend.body.id);
    const sub2 = await t.as.post(`/api/vat-returns/${amend.body.id}/submit`, {
      ftaReferenceNumber: "FTA-2",
    });
    expect(sub2.status, sub2.text).toBe(200);

    // NL1: Q2 is filed before the amendment's payment is recorded; a settlement changes no box,
    // so dating it in Q2 is not refused by the Q2 lock.
    const q2 = await t.as.post(`${base(t)}/vat-returns/generate`, {
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
    });
    expect(q2.status, q2.text).toBe(201);
    const q2sub = await t.as.post(`/api/vat-returns/${q2.body.id}/submit`, {
      ftaReferenceNumber: "FTA-3",
    });
    expect(q2sub.status, q2sub.text).toBe(200);

    const url = `/api/vat-returns/${amend.body.id}/settlement`;
    const delta = await t.as.post(url, { date: "2026-05-10", paymentAccountId: bank.id });
    expect(delta.status, delta.text).toBe(201);
    // Only the difference: Dr 2020 50 / Cr bank 50 (was Dr 2020 500 / Cr 1050 230 / Cr bank 270).
    expect(await linesOf(delta.body.journalEntryId)).toEqual({
      "1020": [0, 50],
      "2020": [50, 0],
    });
    expect(delta.body).toMatchObject({
      outputVat: 50,
      inputVat: 0,
      netPayable: 50,
      previouslySettled: { outputVat: 450, inputVat: 230, netPaid: 220 },
    });
    expect(await glBalance(t, "2020")).toBe(0);
    expect(await glBalance(t, "1050")).toBe(0);
    expect(await glBalance(t, "1020")).toBe(-270);

    // NL1: reversing the original settlement after Q2 is filed is allowed (dated in an open
    // period); the period's VAT is then unpaid again by exactly the original 220.
    const rev = await t.as.post(`/api/vat-returns/${gen.body.id}/settlement/reverse`, {
      date: "2026-07-05",
      reason: "Payment returned by the bank",
    });
    expect(rev.status, rev.text).toBe(200);
    expect(await glBalance(t, "2020")).toBe(-450);
    expect(await glBalance(t, "1050")).toBe(230);
    // The amendment's delta settlement is still live: settling again is refused, and once it is
    // reversed the amendment settles in full (nothing else is live on the chain).
    expect((await t.as.post(url, { date: "2026-07-06", paymentAccountId: bank.id })).status).toBe(
      409
    );
    const rev2 = await t.as.post(`${url}/reverse`, { date: "2026-07-06", reason: "Re-settle" });
    expect(rev2.status, rev2.text).toBe(200);
    const full = await t.as.post(url, { date: "2026-07-07", paymentAccountId: bank.id });
    expect(full.status, full.text).toBe(201);
    expect(await linesOf(full.body.journalEntryId)).toEqual({
      "1020": [0, 270],
      "1050": [0, 230],
      "2020": [500, 0],
    });
    expect(await glBalance(t, "2020")).toBe(0);
    expect(await glBalance(t, "1050")).toBe(0);
    expect(await glBalance(t, "1020")).toBe(-270);
  });
});

describe("B2 fixed-asset follow-ups", () => {
  it("[FA][NL9] revaluation to exactly the original cost re-bases straight line; register book columns follow asOf and show the reserve", async () => {
    const t = await tenant("B2FA");
    const bank = await accountByCode(t, "1020");
    const a = await t.as.post(`${base(t)}/fixed-assets`, {
      assetName: "Printer",
      category: "equipment",
      purchaseDate: "2026-01-01",
      purchaseCost: 12000,
      salvageValue: 0,
      usefulLifeYears: 1,
      depreciationMethod: "straight_line",
      paymentAccountId: bank.id,
    });
    expect(a.status, a.text).toBe(201);
    for (const month of [1, 2, 3]) {
      const d = await t.as.post(`/api/fixed-assets/${a.body.id}/depreciate`, { month, year: 2026 });
      expect(d.status, d.text).toBe(200);
    }
    // NBV 9,000 after 3 x 1,000; revalue to fair value 12,000 = original cost: the surplus
    // column nets to 0 (AD 3,000 eliminated, +3,000 restated) and AD restarts at 0.
    const rev = await t.as.post(`/api/fixed-assets/${a.body.id}/revalue`, {
      date: "2026-03-31",
      fairValue: 12000,
    });
    expect(rev.status, rev.text).toBe(201);
    expect(await linesOf(rev.body.journalEntryId)).toEqual({
      "1240": [3000, 0],
      "3050": [0, 3000],
    });
    // IAS 16.50: 12,000 over the remaining 9 months = 1,333.33 (the fixed schedule would post
    // 1,000 and leave 4,000 for December).
    const apr = await t.as.post(`/api/fixed-assets/${a.body.id}/depreciate`, {
      month: 4,
      year: 2026,
    });
    expect(apr.status, apr.text).toBe(200);
    expect(apr.body.monthlyDepreciation).toBe(1333.33);

    // Register at 28 Feb: before the revaluation, 2 months of depreciation.
    const feb = await get(t, `${base(t)}/fixed-assets/register?asOf=2026-02-28`);
    expect(feb.rows.find((r: { id: string }) => r.id === a.body.id)).toMatchObject({
      cost: 12000,
      revaluationSurplus: 0,
      revaluationReserve: 0,
      bookAccumulatedDepreciation: 2000,
      grossCarryingAmount: 12000,
      accumulatedDepreciationAndImpairment: 2000,
      bookNetBookValue: 10000,
    });
    // Register at 30 Apr: after the revaluation, the reserve 3,000 and April's depreciation.
    const aprReg = await get(t, `${base(t)}/fixed-assets/register?asOf=2026-04-30`);
    expect(aprReg.rows.find((r: { id: string }) => r.id === a.body.id)).toMatchObject({
      cost: 12000,
      revaluationReserve: 3000,
      bookAccumulatedDepreciation: 1333.33,
      grossCarryingAmount: 12000,
      bookNetBookValue: 10666.67,
    });
    expect(await glBalance(t, "1240")).toBe(-1333.33);
  });
});

describe("B2 NM2: debit note after depreciation started", () => {
  it("[NM2] re-costs the bill's asset and depreciates the reduced carrying amount over the remaining life", async () => {
    const t = await tenant("B2NM2");
    const office = await accountByCode(t, "1210");
    const b = await t.as.post(`${base(t)}/bills`, {
      vendor_name: "Office Supplies LLC",
      vendor_trn: "100000000000029",
      bill_number: "FA-NM2",
      bill_date: "2026-01-01",
      due_date: "2026-12-31",
      line_items: [
        { description: "Desk", quantity: 1, unit_price: 6000, vat_rate: 5, account_id: office.id },
      ],
    });
    expect(b.status, b.text).toBe(200);
    expect((await t.as.post(`/api/bills/${b.body.id}/approve`, {})).status).toBe(200);
    const [fa] = await h.sql<{ id: string }>(
      `SELECT id FROM fixed_assets WHERE source_bill_id = $1`,
      [b.body.id]
    );
    expect((await t.as.patch(`/api/fixed-assets/${fa.id}`, { usefulLifeYears: 1 })).status).toBe(
      200
    );
    const jan = await t.as.post(`/api/fixed-assets/${fa.id}/depreciate`, { month: 1, year: 2026 });
    expect(jan.status, jan.text).toBe(200);
    expect(jan.body.monthlyDepreciation).toBe(500);

    const dn = await t.as.post(`${base(t)}/debit-notes`, {
      bill_id: b.body.id,
      note_date: "2026-02-10",
      reason: "Damaged on delivery",
      lines: [{ description: "Desk", amount: 1200, vat_rate: 5, account_id: office.id }],
    });
    expect(dn.status, dn.text).toBeLessThan(300);
    expect(await glBalance(t, "1210")).toBe(4800);
    const row = (await get(t, `${base(t)}/fixed-assets/register?asOf=2026-02-28`)).rows.find(
      (r: { id: string }) => r.id === fa.id
    );
    expect(row).toMatchObject({ cost: 4800, grossCarryingAmount: 4800, bookNetBookValue: 4300 });
    // The register before the debit note still shows the original cost.
    const janRow = (await get(t, `${base(t)}/fixed-assets/register?asOf=2026-01-31`)).rows.find(
      (r: { id: string }) => r.id === fa.id
    );
    expect(janRow).toMatchObject({ cost: 6000, grossCarryingAmount: 6000, bookNetBookValue: 5500 });
    // IAS 8.36: 4,300 over the remaining 11 months.
    const feb = await t.as.post(`/api/fixed-assets/${fa.id}/depreciate`, { month: 2, year: 2026 });
    expect(feb.status, feb.text).toBe(200);
    expect(feb.body.monthlyDepreciation).toBe(390.91);
  });
});
