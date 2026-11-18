/**
 * Accounting round C2 (re-audit 2): disposals, the cash-flow statement, the register and the
 * open lows, against real Postgres. Every scenario posts through the public API (Bearer client)
 * and asserts the exact journal lines and the report figures:
 *
 *  RM2  a receipt on a disposal invoice is investing for the net proceeds (IAS 7.16(b)); its VAT
 *       share is operating, in both methods
 *  RM3  a credit note on a disposal invoice changes the loss on disposal and the register's
 *       proceeds, not revenue (IAS 16.68, 16.71); voiding it restores both
 *  RL5  the disposal month is depreciated up to the disposal date before the gain / loss
 *  RL3  the IAS 7.43 list includes non-cash investing entries that also carry a P&L line
 *       (asset bill with an expense line, disposal on credit), never depreciation
 *  RL2  the direct method shows supplier payments / customer receipts at the cash moved, with
 *       the realised exchange difference folded in (no separate 4090 / 5140 line)
 *  RL4  the register's tax columns run through the same months as the book columns at asOf
 *  NL2  the NRV reversal cap follows the units still on hand (IAS 2.33)
 *  NL3  a written-off invoice carries its written-off amount in the invoice list
 *  NL4  the CT calculate estimate applies the tagged add-backs like the return
 *  NL5  current-year dividends are not in retained earnings brought forward
 *  NL8  the bad-debt relief reversal on recovery is synchronous and reported
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

async function glBalance(t: Tenant, code: string, to?: string): Promise<number> {
  const rows = await h.sql<{ n: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100)), 0)::bigint::text AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2
        AND ($3::date IS NULL OR (je.date + interval '4 hours')::date <= $3::date)`,
    [t.company.id, code, to ?? null]
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

async function journal(t: Tenant, date: string, lines: Array<[string, number, number]>) {
  const r = await t.as.post(`${base(t)}/journal`, {
    date,
    memo: "C2 test",
    status: "posted",
    lines: await Promise.all(
      lines.map(async ([code, debit, credit]) => ({
        accountId: (await accountByCode(t, code)).id,
        debit,
        credit,
      }))
    ),
  });
  expect(r.status, r.text).toBeLessThan(300);
  return r.body;
}

async function issuedInvoice(t: Tenant, body: Record<string, unknown>) {
  const c = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme LLC",
    placeOfSupplyEmirate: "dubai",
    ...body,
  });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return c.body as { id: string; number: string };
}

type Line = { accountId: string; accountCode: string; amount: number; kind?: string };
type Cf = {
  operating: { total: number; breakdown: Line[] };
  investing: { total: number; breakdown: Line[] };
  financing: { total: number; breakdown: Line[] };
  fxEffect: { total: number };
  cashProof: { isBalanced: boolean };
  nonCashTransactions: Array<{ source: string; amount: number; memo: string | null }>;
};

async function bothMethods(t: Tenant, from: string, to: string) {
  const url = `${base(t)}/financial-statements/cash-flow?startDate=${from}&endDate=${to}`;
  const indirect = (await get(t, url)) as Cf;
  const direct = (await get(t, `${url}&method=direct`)) as Cf;
  for (const cf of [indirect, direct]) expect(cf.cashProof.isBalanced).toBe(true);
  expect(direct.operating.total).toBe(indirect.operating.total);
  expect(direct.investing.total).toBe(indirect.investing.total);
  expect(direct.financing.total).toBe(indirect.financing.total);
  expect(direct.investing.breakdown).toEqual(indirect.investing.breakdown);
  return { indirect, direct };
}

describe("C2 RM2 / RM3 / RL5 / RL3: a desk sold on credit, credit-noted, then paid", () => {
  it("[RM2][RM3][RL5][RL3] loss 6,944.44, revenue 0, investing proceeds 3,000, VAT 150 operating", async () => {
    const t = await tenant("C2H4");
    const bank = await accountByCode(t, "1020");
    const a = await t.as.post(`${base(t)}/fixed-assets`, {
      assetName: "Desk set",
      category: "furniture",
      purchaseDate: "2026-11-01",
      purchaseCost: 10000,
      usefulLifeYears: 5,
      depreciationMethod: "straight_line",
      paymentAccountId: bank.id,
    });
    expect(a.status, a.text).toBe(201);
    const d = await t.as.post(`/api/fixed-assets/${a.body.id}/dispose`, {
      disposalDate: "2026-11-10",
      disposalAmount: 4000,
      onCredit: true,
      buyerName: "Scrap Buyer LLC",
      vatTreatment: "standard",
    });
    expect(d.status, d.text).toBe(200);
    // RL5: 10 of 30 November days at 166.67 a month = 55.56, dated on the disposal date.
    expect(d.body.catchUpDepreciation).toEqual([
      expect.objectContaining({ year: 2026, month: 11, amount: 55.56 }),
    ]);
    const [dep] = await h.sql<{ id: string; d: string }>(
      `SELECT je.id, to_char(je.date, 'YYYY-MM-DD') AS d FROM journal_entries je
        WHERE je.company_id = $1 AND je.idempotency_key = $2`,
      [t.company.id, `fixed_asset:${a.body.id}:dep:2026-11`]
    );
    expect(dep.d).toBe("2026-11-10");
    expect(await linesOf(dep.id)).toEqual({ "1240": [0, 55.56], "5100": [55.56, 0] });
    expect(d.body).toMatchObject({ netBookValueAtDisposal: 9944.44, gainLoss: -5944.44 });
    expect(await linesOf(d.body.journalEntryId)).toEqual({
      "1220": [0, 10000],
      "1240": [55.56, 0],
      "4010": [4000, 0],
      "5130": [5944.44, 0],
    });

    // RM3: the credit note's sales debit moves to the loss on disposal in the same transaction.
    const cn = await t.as.post(`${base(t)}/invoices/${d.body.invoiceId}/credit-note`, {
      lines: [
        {
          description: "Price reduction",
          quantity: 1,
          unitPrice: 1000,
          vatRate: 0.05,
          vatSupplyType: "standard_rated",
        },
      ],
      reason: "damaged on collection",
      date: "2026-11-12",
    });
    expect(cn.status, cn.text).toBeLessThan(300);
    const cnId = cn.body.creditNote?.id ?? cn.body.id;
    const [adj] = await h.sql<{ id: string }>(
      `SELECT id FROM journal_entries WHERE company_id = $1 AND idempotency_key = $2`,
      [t.company.id, `fixed_asset:${a.body.id}:proceeds-adj:${cnId}`]
    );
    expect(adj, "proceeds adjustment entry").toBeTruthy();
    expect(await linesOf(adj.id)).toEqual({ "4010": [0, 1000], "5130": [1000, 0] });
    expect(await glBalance(t, "4010")).toBe(0);
    expect(await glBalance(t, "5130")).toBe(6944.44);
    const [fa] = await h.sql<{ amt: string; vat: string }>(
      `SELECT disposal_amount::text AS amt, disposal_vat::text AS vat FROM fixed_assets WHERE id = $1`,
      [a.body.id]
    );
    expect([Number(fa.amt), Number(fa.vat)]).toEqual([3000, 150]);
    const reg = await get(t, `${base(t)}/fixed-assets/register?asOf=2026-11-30`);
    expect(reg.rows.find((r: { id: string }) => r.id === a.body.id)).toMatchObject({
      status: "disposed",
      disposalAmount: 3000,
    });

    const receipt = await t.as.post(`${base(t)}/invoices/${d.body.invoiceId}/payments`, {
      amount: 3150,
      date: "2026-11-14",
      paymentAccountId: bank.id,
    });
    expect(receipt.status, receipt.text).toBe(201);

    const pl = await get(
      t,
      `${base(t)}/financial-statements/profit-loss?startDate=2026-11-01&endDate=2026-11-30`
    );
    expect(Number(pl.statement.revenue)).toBe(0);
    expect(Number(pl.statement.netProfit)).toBe(-7000);

    // RM2: investing = purchase -10,000 + proceeds +3,000; operating = the 150 VAT received.
    const { indirect, direct } = await bothMethods(t, "2026-11-01", "2026-11-30");
    expect(direct.investing.total).toBe(-7000);
    expect(direct.operating.total).toBe(150);
    const inv = direct.investing.breakdown.map((l) => [l.kind, l.accountCode, l.amount]).sort();
    expect(inv).toEqual([
      ["proceeds", "1220", 3000],
      ["purchase", "1220", -10000],
    ]);
    expect(direct.operating.breakdown.map((l) => [l.accountCode, l.amount])).toEqual([
      ["1040", 150],
    ]);
    expect(indirect.operating.total).toBe(150);

    // RL3: the disposal on credit is a non-cash investing transaction (carrying amount
    // derecognised 9,944.44); the depreciation entry is not.
    const nonCash = indirect.nonCashTransactions;
    expect(nonCash.filter((n) => n.source === "fixed_asset").map((n) => n.amount)).toEqual([
      9944.44,
    ]);
    expect(nonCash.some((n) => /^Depreciation/.test(n.memo ?? ""))).toBe(false);

    // Voiding the credit note restores the register and the loss (the credit note was not
    // refunded: the 3,150 receipt left 1,050 open again on the invoice).
    const voided = await t.as.post(`/api/credit-notes/${cnId}/void`, {});
    expect(voided.status, voided.text).toBe(200);
    expect(await glBalance(t, "5130")).toBe(5944.44);
    expect(await glBalance(t, "4010")).toBe(0);
    const [fa2] = await h.sql<{ amt: string }>(
      `SELECT disposal_amount::text AS amt FROM fixed_assets WHERE id = $1`,
      [a.body.id]
    );
    expect(Number(fa2.amt)).toBe(4000);
  });

  it("[RL3] an asset bill with a delivery expense line on credit is disclosed for the asset part", async () => {
    const t = await tenant("C2EQ1");
    const bill = await t.as.post(`${base(t)}/bills`, {
      vendor_name: "Equip Vendor",
      vendor_trn: "100000000000029",
      bill_number: "EQ-1",
      bill_date: "2026-11-03",
      due_date: "2026-12-31",
      place_of_supply: "dubai",
      line_items: [
        {
          description: "CNC machine",
          quantity: 1,
          unit_price: 20000,
          vat_rate: 5,
          account_id: (await accountByCode(t, "1210")).id,
        },
        {
          description: "Delivery service",
          quantity: 1,
          unit_price: 1000,
          vat_rate: 5,
          account_id: (await accountByCode(t, "5000")).id,
        },
      ],
    });
    expect(bill.status, bill.text).toBe(200);
    expect((await t.as.post(`/api/bills/${bill.body.id}/approve`, {})).status).toBe(200);
    const { indirect } = await bothMethods(t, "2026-11-01", "2026-11-30");
    expect(indirect.investing.total).toBe(0);
    expect(indirect.nonCashTransactions.map((n) => [n.source, n.amount])).toEqual([
      ["bill", 20000],
    ]);
  });
});

describe("C2 RL2: the direct method shows the cash paid and received", () => {
  it("[RL2] USD bill paid and USD invoice received from an AED bank: no separate FX lines", async () => {
    const t = await tenant("C2RL2");
    const bank = await accountByCode(t, "1020");
    const rate = async (r: number, effectiveDate: string) => {
      const x = await t.as.post(`${base(t)}/exchange-rates`, {
        fromCurrency: "USD",
        rate: r,
        effectiveDate,
      });
      expect(x.status, x.text).toBeLessThan(300);
    };
    await rate(3.6725, "2026-11-01");
    await journal(t, "2026-11-01", [
      ["1020", 20000, 0],
      ["3010", 0, 20000],
    ]);
    const bill = await t.as.post(`${base(t)}/bills`, {
      vendor_name: "US Supplier Inc",
      bill_number: "US-1",
      bill_date: "2026-11-02",
      due_date: "2026-12-31",
      currency: "USD",
      exchange_rate: 3.6725,
      line_items: [
        {
          description: "Software service",
          quantity: 1,
          unit_price: 1000,
          vat_rate: 0,
          account_id: (await accountByCode(t, "5000")).id,
        },
      ],
    });
    expect(bill.status, bill.text).toBe(200);
    expect((await t.as.post(`/api/bills/${bill.body.id}/approve`, {})).status).toBe(200);
    const paid = await t.as.post(`/api/bills/${bill.body.id}/payments`, {
      amount: 1000,
      payment_date: "2026-11-14",
      payment_account_id: bank.id,
      exchange_rate: 3.7,
    });
    expect(paid.status, paid.text).toBeLessThan(300);
    const inv = await issuedInvoice(t, {
      date: "2026-11-03",
      currency: "USD",
      exchangeRate: 3.6725,
      lines: [
        {
          description: "Export consulting",
          quantity: 1,
          unitPrice: 600,
          vatRate: 0,
          vatSupplyType: "zero_rated",
        },
      ],
    });
    const rec = await t.as.post(`${base(t)}/invoices/${inv.id}/payments`, {
      amount: 600,
      date: "2026-11-20",
      paymentAccountId: bank.id,
      exchangeRate: 3.68,
    });
    expect(rec.status, rec.text).toBe(201);
    // Cash: paid 3,700.00 (1,000 x 3.70), received 2,208.00 (600 x 3.68).
    expect(await glBalance(t, "1020")).toBe(20000 - 3700 + 2208);

    const { direct, indirect } = await bothMethods(t, "2026-11-01", "2026-11-30");
    const op = Object.fromEntries(direct.operating.breakdown.map((l) => [l.accountCode, l.amount]));
    expect(op).toEqual({ "1040": 2208, "2010": -3700 });
    expect(direct.operating.total).toBe(-1492);
    expect(indirect.operating.total).toBe(-1492);
    expect(direct.financing.total).toBe(20000);
  });
});

describe("C2 RL4: register tax columns at a mid-month asOf", () => {
  it("[RL4] 30 Oct: tax and book both run through September (no spurious difference)", async () => {
    const t = await tenant("C2RL4");
    const bank = await accountByCode(t, "1020");
    const a = await t.as.post(`${base(t)}/fixed-assets`, {
      assetName: "Server rack",
      category: "computers",
      purchaseDate: "2026-01-01",
      purchaseCost: 36000,
      salvageValue: 0,
      usefulLifeYears: 3,
      depreciationMethod: "straight_line",
      paymentAccountId: bank.id,
    });
    expect(a.status, a.text).toBe(201);
    for (let month = 1; month <= 9; month++) {
      const r = await t.as.post(`/api/fixed-assets/${a.body.id}/depreciate`, {
        month,
        year: 2026,
      });
      expect(r.status, r.text).toBe(200);
    }
    const mid = await get(t, `${base(t)}/fixed-assets/register?asOf=2026-10-30`);
    expect(mid.rows[0]).toMatchObject({
      bookAccumulatedDepreciation: 9000,
      taxAccumulatedDepreciation: 9000,
      bookTaxDifference: 0,
    });
    const end = await get(t, `${base(t)}/fixed-assets/register?asOf=2026-10-31`);
    // At month end the tax schedule includes October; the book entry is not posted yet.
    expect(end.rows[0]).toMatchObject({ taxAccumulatedDepreciation: 10000 });
  });
});

describe("C2 NL2: NRV reversal cap follows the units on hand", () => {
  it("[NL2] 70 written down on 7 units, 2 sold, 30 reversed: 20 left to reverse", async () => {
    const t = await h.createTenant({ name: "C2Nrv" });
    const p = await t.as.post(`${base(t)}/products`, {
      name: "Gadget",
      unitPrice: 200,
      costPrice: 100,
    });
    expect(p.status, p.text).toBe(200);
    const mv = (body: Record<string, unknown>) =>
      t.as.post(`/api/products/${p.body.id}/movements`, body);
    expect((await mv({ type: "purchase", quantity: 7, unitCost: 100 })).status).toBeLessThan(300);
    const down = await t.as.post(`/api/products/${p.body.id}/write-down`, {
      amount: 70,
      reason: "NRV below cost",
    });
    expect(down.status, down.text).toBe(201);
    expect((await mv({ type: "sale", quantity: 2 })).status).toBeLessThan(300);
    const tooMuch = await t.as.post(`/api/products/${p.body.id}/write-down-reversal`, {
      amount: 51,
      reason: "Recovered",
    });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.details).toMatchObject({ reversible: 50 });
    const up = await t.as.post(`/api/products/${p.body.id}/write-down-reversal`, {
      amount: 30,
      reason: "Recovered",
    });
    expect(up.status, up.text).toBe(201);
    expect(up.body.reversibleFils).toBe(2000);
    const more = await t.as.post(`/api/products/${p.body.id}/write-down-reversal`, {
      amount: 21,
      reason: "More",
    });
    expect(more.status).toBe(422);
    expect(more.body.details).toMatchObject({ reversible: 20 });
  });
});

describe("C2 NL3 / NL8: write-off, relief and recovery", () => {
  it("[NL3][NL8] the list shows the written-off amount; recovery reverses relief synchronously", async () => {
    const t = await tenant("C2BDR");
    const cid = t.company.id;
    const bank = await accountByCode(t, "1020");
    const inv = await issuedInvoice(t, {
      date: "2026-03-01",
      dueDate: "2026-03-31",
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    const wo = await t.as.post(`${base(t)}/invoices/${inv.id}/write-off`, {
      date: "2026-10-15",
      reason: "Customer in liquidation",
    });
    expect(wo.status, wo.text).toBe(201);
    const list = await get(t, `${base(t)}/invoices`);
    const row = list.items.find((i: { id: string }) => i.id === inv.id);
    expect(row).toMatchObject({ status: "paid", amountWrittenOff: 1050, openBalance: 0 });

    const claim = await t.as.post(`/api/companies/${cid}/vat/bad-debt-relief`, {
      invoiceId: inv.id,
      claimDate: "2026-10-20",
      writtenOff: true,
      customerNotified: true,
      customerNotifiedAt: "2026-10-19",
    });
    expect(claim.status, claim.text).toBe(201);
    const pay = await t.as.post(`${base(t)}/invoices/${inv.id}/payments`, {
      amount: 1050,
      date: "2026-11-05",
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBe(201);
    expect(pay.body.badDebtReliefReversal).toMatchObject({
      status: "reversed",
      claimId: claim.body.id,
      date: "2026-11-05",
    });
    // No waiting on the async event: the claim is reversed when the receipt returns.
    const [c] = await h.sql<{ status: string }>(
      `SELECT status FROM bad_debt_relief_claims WHERE id = $1`,
      [claim.body.id]
    );
    expect(c.status).toBe("reversed");
    expect(await glBalance(t, "2020")).toBe(-50);
    const list2 = await get(t, `${base(t)}/invoices`);
    expect(list2.items.find((i: { id: string }) => i.id === inv.id)).toMatchObject({
      status: "paid",
      amountWrittenOff: 0,
    });
  });
});

describe("C2 NL4: the CT estimate applies the tagged add-backs", () => {
  it("[NL4] entertainment 10,000 adds back 5,000: tax 10,800 as on the return", async () => {
    const t = await tenant("C2CT");
    const ensure = await t.as.post(`${base(t)}/corporate-tax/account-tags/ensure`, {});
    expect(ensure.status, ensure.text).toBe(200);
    const ent = (ensure.body as Array<{ code: string; taxTag?: string; tax_tag?: string }>).find(
      (a) => (a.taxTag ?? a.tax_tag) === "entertainment"
    );
    expect(ent, "entertainment account").toBeTruthy();
    await journal(t, "2025-06-30", [
      ["1020", 500000, 0],
      ["4010", 0, 500000],
    ]);
    await journal(t, "2025-07-31", [
      [ent!.code, 10000, 0],
      ["1020", 0, 10000],
    ]);
    const est = await get(
      t,
      `${base(t)}/corporate-tax/calculate?startDate=2025-01-01&endDate=2025-12-31`
    );
    // 500,000 - 10,000 + 5,000 = 495,000; (495,000 - 375,000) x 9% = 10,800.
    expect(est).toMatchObject({
      accountingProfit: 490000,
      totalAddBacks: 5000,
      taxableIncome: 495000,
      taxPayable: 10800,
    });
  });
});

describe("C2 NL5: dividends declared this year are a movement, not brought forward", () => {
  it("[NL5] Nov dividend 20,000: RE b/f 0, movement -20,000; equity still balances", async () => {
    const t = await tenant("C2Div");
    await journal(t, "2026-11-10", [
      ["1020", 50000, 0],
      ["3010", 0, 50000],
    ]);
    const acc = await t.as.post(`${base(t)}/accounts`, {
      code: "2115",
      nameEn: "Dividends Payable",
      type: "liability",
      subType: "current_liability",
    });
    expect(acc.status, acc.text).toBeLessThan(300);
    await journal(t, "2026-11-11", [
      ["3020", 20000, 0],
      ["2115", 0, 20000],
    ]);
    const bs = await get(t, `${base(t)}/reports/balance-sheet?asOf=2026-11-30`);
    expect(bs.statement.equity).toMatchObject({
      retainedEarningsBroughtForward: 0,
      retainedEarningsMovements: -20000,
      currentYearEarnings: 0,
      total: 30000,
    });
    expect(bs.isBalanced).toBe(true);
    const fs = await get(
      t,
      `${base(t)}/financial-statements/balance-sheet?asOf=2026-11-30&endDate=2026-11-30`
    );
    expect(fs.equity).toMatchObject({
      retainedEarningsBroughtForward: 0,
      retainedEarningsMovements: -20000,
    });
    // Next fiscal year the dividend is part of the balance brought forward.
    const next = await get(t, `${base(t)}/reports/balance-sheet?asOf=2027-01-31`);
    expect(next.statement.equity).toMatchObject({
      retainedEarningsBroughtForward: -20000,
      retainedEarningsMovements: 0,
    });
    const coe = await get(t, `${base(t)}/reports/changes-in-equity?from=2026-11-01&to=2026-11-30`);
    expect(coe).toMatchObject({ otherRetainedEarningsMovements: -20000, ties: true });
  });
});
