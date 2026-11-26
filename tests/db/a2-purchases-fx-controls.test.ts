/**
 * A2 accounting round (purchases / inventory / FX / control accounts), posted through the API
 * and asserted on the exact journal lines (issue ids from the golden-scenario accounting audit):
 *   C3  editing a PO-converted bill keeps the PO link: GRNI clears exactly, stock moves once
 *   H2  the purchase-price variance is capitalised for units on hand, COGS for the sold part
 *   C4  a bank account is measured in its own currency (EUR bill from a USD account)
 *   H8  manual journals cannot post to control accounts except as a reasoned adjustment
 *   H9  a bill coded to a fixed-asset account opens a draft register entry
 *   M4  a vendor debit note with a product line takes the goods out of stock at cost
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";
/** WQ2 (4.7): a supplier's TRN differs from the company's own (a self-TRN bill is refused). */
const SUPPLIER_TRN = "100222333400003";
const VAT_CO = { trn_vat_number: TRN, emirate: "dubai" };
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const tenant = (over: Parameters<typeof h.createTenant>[0] = {}) =>
  h.createTenant({ ...over, companyColumns: { ...VAT_CO, ...(over?.companyColumns ?? {}) } });

it.each([
  { documentDate: "2018-01-01", oldCreationDate: false, floor: "creation date" },
  { documentDate: today(), oldCreationDate: true, floor: "document date" },
])(
  "PR #178 enforces the $floor on DELETE of a void bill",
  async ({ documentDate, oldCreationDate }) => {
    const t = await tenant();
    const bill = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Retention supplier",
      vendor_trn: SUPPLIER_TRN,
      bill_number: "RETENTION-178",
      bill_date: documentDate,
      line_items: [{ description: "Supplies", quantity: 1, unit_price: 100, vat_rate: 5 }],
    });
    expect(bill.status, bill.text).toBe(200);
    const path = `/api/bills/${bill.body.id}`;
    await h.sql(
      `UPDATE vendor_bills
        SET status = 'void', approved_at = now(),
            created_at = CASE WHEN $2 THEN '2018-01-01'::timestamp ELSE created_at END
      WHERE id = $1`,
      [bill.body.id, oldCreationDate]
    );
    const deleted = await t.as.delete(path);
    expect(deleted.status, deleted.text).toBe(409);
    expect(deleted.body.code).toBe("RETENTION_NOT_EXPIRED");
    expect(await h.sql("SELECT status FROM vendor_bills WHERE id = $1", [bill.body.id])).toEqual([
      { status: "void" },
    ]);
  }
);

/** Natural debit − credit balance (fils) of an account code. */
async function bal(t: Tenant, code: string): Promise<number> {
  const rows = await h.sql<{ n: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100)), 0)::bigint AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  return Number(rows[0].n);
}

/** Lines of the journals of a source (code → signed fils, debit positive). */
async function lines(t: Tenant, source: string, sourceId: string) {
  const rows = await h.sql<{ code: string; n: string }>(
    `SELECT a.code, SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100))::bigint AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = $2 AND je.source_id = $3 AND je.status = 'posted'
      GROUP BY a.code HAVING SUM(ROUND(jl.debit*100) - ROUND(jl.credit*100)) <> 0
      ORDER BY a.code`,
    [t.company.id, source, sourceId]
  );
  return Object.fromEntries(rows.map((r) => [r.code, Number(r.n)]));
}

async function product(t: Tenant) {
  const r = await t.as.post(`/api/companies/${t.company.id}/products`, {
    name: `Widget ${Math.random().toString(36).slice(2, 7)}`,
    unitPrice: 200,
    costPrice: 0,
  });
  expect(r.status, r.text).toBe(200);
  return r.body as { id: string };
}

async function stock(id: string) {
  const r = await h.sql<{ current_stock: number; stock_value: string }>(
    `SELECT current_stock, stock_value FROM products WHERE id = $1`,
    [id]
  );
  return { qty: Number(r[0].current_stock), value: Number(r[0].stock_value) };
}

/** PO 10 × 100 for the product, approved and fully received: Dr 1070 / Cr 2015 1,000. */
async function receivedPo(t: Tenant, productId: string) {
  const po = await t.as.post(`/api/companies/${t.company.id}/purchase-orders`, {
    vendorName: "PO Supplier LLC",
    date: today(),
    lines: [{ description: "Widget A", quantity: 10, unitPrice: 100, vatRate: 5, productId }],
  });
  expect([200, 201], po.text).toContain(po.status);
  await t.as.post(`/api/purchase-orders/${po.body.id}/approve`, {});
  const rec = await t.as.post(`/api/purchase-orders/${po.body.id}/receive`, {});
  expect(rec.status, rec.text).toBe(200);
  expect(await bal(t, "2015")).toBe(-100_000);
  const conv = await t.as.post(`/api/purchase-orders/${po.body.id}/convert-to-bill`, {});
  expect(conv.status, conv.text).toBe(201);
  return conv.body.bill as { id: string };
}

async function sell(t: Tenant, productId: string, quantity: number) {
  const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Acme LLC",
    date: today(),
    lines: [{ description: "Widget A", quantity, unitPrice: 200, vatRate: 5, productId }],
  });
  expect(inv.status, inv.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
}

describe("A2 purchases: PO-linked bill edits and purchase-price variance", () => {
  it("[C3][H2] a converted bill edited to 110 keeps its PO link: Dr 2015 1,000 + Dr 1070 100 + Dr 1050 55 / Cr 2010 1,155; stock stays 10", async () => {
    const t = await tenant();
    const p = await product(t);
    const bill = await receivedPo(t, p.id);
    // The edit omits purchase_order_line_id: the line keeps the link it had.
    const edit = await t.as.patch(`/api/bills/${bill.id}`, {
      line_items: [
        { description: "Widget A", quantity: 10, unit_price: 110, vat_rate: 5, product_id: p.id },
      ],
    });
    expect(edit.status, edit.text).toBe(200);
    const linked = await h.sql<{ purchase_order_line_id: string | null }>(
      `SELECT purchase_order_line_id FROM bill_line_items WHERE bill_id = $1`,
      [bill.id]
    );
    expect(linked[0].purchase_order_line_id).toBeTruthy();
    const ap = await t.as.post(`/api/bills/${bill.id}/approve`, {});
    expect(ap.status, ap.text).toBe(200);
    expect(await lines(t, "bill", bill.id)).toEqual({
      "1050": 5_500,
      "1070": 10_000,
      "2010": -115_500,
      "2015": 100_000,
    });
    expect(await bal(t, "2015")).toBe(0);
    expect(await bal(t, "1070")).toBe(110_000);
    expect(await bal(t, "5005")).toBe(0);
    expect(await stock(p.id)).toEqual({ qty: 10, value: 1100 });

    // Voiding the bill puts GRNI back and takes the variance out of stock again.
    const v = await t.as.post(`/api/bills/${bill.id}/void`, { reason: "Wrong price" });
    expect(v.status, v.text).toBe(200);
    expect(await bal(t, "2015")).toBe(-100_000);
    expect(await bal(t, "1070")).toBe(100_000);
    expect(await stock(p.id)).toEqual({ qty: 10, value: 1000 });
  });

  it("[H2] with 4 of the 10 received units sold, the 100 variance splits 60 to inventory and 40 to COGS", async () => {
    const t = await tenant();
    const p = await product(t);
    const bill = await receivedPo(t, p.id);
    await sell(t, p.id, 4);
    expect(await bal(t, "5005")).toBe(40_000);
    const edit = await t.as.patch(`/api/bills/${bill.id}`, {
      line_items: [
        { description: "Widget A", quantity: 10, unit_price: 110, vat_rate: 5, product_id: p.id },
      ],
    });
    expect(edit.status, edit.text).toBe(200);
    expect((await t.as.post(`/api/bills/${bill.id}/approve`, {})).status).toBe(200);
    expect(await lines(t, "bill", bill.id)).toEqual({
      "1050": 5_500,
      "1070": 6_000,
      "2010": -115_500,
      "2015": 100_000,
      "5005": 4_000,
    });
    expect(await bal(t, "1070")).toBe(66_000);
    expect(await bal(t, "5005")).toBe(44_000);
    expect(await stock(p.id)).toEqual({ qty: 6, value: 660 });
  });

  it("[C3] an explicit purchase_order_line_id from another company's PO is 404 PO_LINE_NOT_FOUND", async () => {
    const t = await tenant();
    const p = await product(t);
    const bill = await receivedPo(t, p.id);
    const bad = await t.as.patch(`/api/bills/${bill.id}`, {
      line_items: [
        {
          description: "Widget A",
          quantity: 10,
          unit_price: 110,
          vat_rate: 5,
          product_id: p.id,
          purchase_order_line_id: crypto.randomUUID(),
        },
      ],
    });
    expect(bad.status, bad.text).toBe(404);
    expect(bad.body.code).toBe("PO_LINE_NOT_FOUND");
  });
});

describe("A2 purchase returns", () => {
  it("[M4] a debit note returning 1 of 10 units bought at 120: Dr 2010 126 / Cr 1070 120 / Cr 1050 6; stock 10 → 9", async () => {
    const t = await tenant();
    const p = await product(t);
    const b = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Stock Supplier LLC",
      vendor_trn: SUPPLIER_TRN,
      bill_number: "B-M4",
      bill_date: today(),
      line_items: [
        { description: "Widgets", quantity: 10, unit_price: 120, vat_rate: 5, product_id: p.id },
      ],
    });
    expect(b.status, b.text).toBe(200);
    expect((await t.as.post(`/api/bills/${b.body.id}/approve`, {})).status).toBe(200);
    const dn = await t.as.post(`/api/companies/${t.company.id}/debit-notes`, {
      bill_id: b.body.id,
      note_date: today(),
      reason: "Damaged unit returned",
      lines: [
        { description: "Widget returned", amount: 120, vat_rate: 5, product_id: p.id, quantity: 1 },
      ],
    });
    expect([200, 201], dn.text).toContain(dn.status);
    const noteId = (dn.body.debitNote ?? dn.body.debit_note ?? dn.body).id as string;
    expect(await lines(t, "vendor_debit_note", noteId)).toEqual({
      "1050": -600,
      "1070": -12_000,
      "2010": 12_600,
    });
    expect(await stock(p.id)).toEqual({ qty: 9, value: 1080 });
    expect(await bal(t, "5000")).toBe(0);
    // Valuation still ties to GL 1070.
    expect(await bal(t, "1070")).toBe(108_000);
  });
});

describe("A2 bank currency", () => {
  async function usdBank(t: Tenant, currency = "USD") {
    const gl = await h.sql<{ id: string }>(
      `INSERT INTO accounts (company_id, code, name_en, type, sub_type, is_active)
       VALUES ($1, '1026', $2, 'asset', 'bank', true) RETURNING id`,
      [t.company.id, `${currency} Current Account`]
    );
    await h.sql(
      `INSERT INTO bank_accounts (company_id, name_en, bank_name, currency, gl_account_id)
       VALUES ($1, $3, 'FAB', $2, $4)`,
      [t.company.id, currency, `${currency} Current`, gl[0].id]
    );
    return gl[0].id;
  }
  async function rate(t: Tenant, from: string, r: number, date: string) {
    const res = await t.as.post(`/api/companies/${t.company.id}/exchange-rates`, {
      fromCurrency: from,
      toCurrency: "AED",
      rate: r,
      effectiveDate: date,
    });
    expect(res.status, res.text).toBe(201);
  }

  it("[C4] a EUR 1,000 bill paid from a USD account debits USD 1,065.39 (EUR 3.92 → AED 3,920 → USD at 3.6794); no phantom unrealised gain", async () => {
    const t = await tenant();
    const usdGl = await usdBank(t);
    const d = daysAgo(5);
    await rate(t, "EUR", 4.0, daysAgo(10));
    await rate(t, "EUR", 3.92, d);
    await rate(t, "USD", 3.6794, d);
    const b = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Euro Vendor GmbH",
      bill_number: "EUR-1",
      bill_date: daysAgo(10),
      currency: "EUR",
      exchange_rate: "4",
      reverse_charge: true,
      line_items: [{ description: "Consulting", quantity: 1, unit_price: 1000, vat_rate: 5 }],
    });
    expect(b.status, b.text).toBe(200);
    expect((await t.as.post(`/api/bills/${b.body.id}/approve`, {})).status).toBe(200);
    const pay = await t.as.post(`/api/bills/${b.body.id}/payments`, {
      payment_date: d,
      amount: 1000,
      payment_account_id: usdGl,
      exchange_rate: "3.92",
    });
    expect(pay.status, pay.text).toBe(200);
    const cash = await h.sql<{
      credit: string;
      foreign_currency: string;
      foreign_credit: string;
      exchange_rate: string;
    }>(
      `SELECT jl.credit::text AS credit, jl.foreign_currency, jl.foreign_credit::text AS foreign_credit,
              jl.exchange_rate::text AS exchange_rate
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.source = 'bill_payment' AND je.company_id = $1 AND jl.account_id = $2`,
      [t.company.id, usdGl]
    );
    // AED 3,920.00 / 3.6794 = USD 1,065.39 (half-up on fils).
    expect(cash).toHaveLength(1);
    expect(cash[0].credit).toBe("3920.00");
    expect(cash[0].foreign_currency).toBe("USD");
    expect(cash[0].foreign_credit).toBe("1065.39");
    expect(Number(cash[0].exchange_rate)).toBeCloseTo(3.6794, 6);
    // Dr AP 4,000 at the bill rate / Cr USD bank 3,920 / Cr realised FX gain 80.
    expect(await lines(t, "bill_payment", pay.body.payment.id)).toEqual({
      "1026": -392_000,
      "2010": 400_000,
      "4090": -8_000,
    });
    const balances = await t.as.get(
      `/api/companies/${t.company.id}/bank-accounts/currency-balances?asOf=${d}`
    );
    expect(balances.status, balances.text).toBe(200);
    const usd = balances.body.accounts.find((a: { currency: string }) => a.currency === "USD");
    expect(usd.balance).toBe(-1065.39);
    expect(usd.baseBalance).toBe(-3920);
    // Remeasured at the same day's rate: -1,065.39 × 3.6794 = -3,919.99; never the old 3,922.
    expect(Math.abs(usd.unrealisedGainLoss)).toBeLessThan(0.02);
  });

  it("[C4][E1 peg] a EUR bill paid from a USD account with no USD rate on file measures the USD leg at the CBUAE peg", async () => {
    // INTEGRATE-G: E1's AED/USD peg default composes with the bank-currency rule: the USD
    // account's rate resolves to 3.6725 instead of BANK_CURRENCY_RATE_REQUIRED.
    const t = await tenant();
    const usdGl = await usdBank(t);
    const d = daysAgo(5);
    await rate(t, "EUR", 4.0, daysAgo(10));
    await rate(t, "EUR", 3.92, d);
    const b = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Euro Vendor GmbH",
      bill_number: "EUR-PEG",
      bill_date: daysAgo(10),
      currency: "EUR",
      exchange_rate: "4",
      reverse_charge: true,
      line_items: [{ description: "Consulting", quantity: 1, unit_price: 1000, vat_rate: 5 }],
    });
    expect(b.status, b.text).toBe(200);
    expect((await t.as.post(`/api/bills/${b.body.id}/approve`, {})).status).toBe(200);
    const pay = await t.as.post(`/api/bills/${b.body.id}/payments`, {
      payment_date: d,
      amount: 1000,
      payment_account_id: usdGl,
      exchange_rate: "3.92",
    });
    expect(pay.status, pay.text).toBe(200);
    const cash = await h.sql<{ credit: string; foreign_credit: string; exchange_rate: string }>(
      `SELECT jl.credit::text AS credit, jl.foreign_credit::text AS foreign_credit,
              jl.exchange_rate::text AS exchange_rate
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.source = 'bill_payment' AND je.company_id = $1 AND jl.account_id = $2`,
      [t.company.id, usdGl]
    );
    // AED 3,920.00 / 3.6725 = USD 1,067.39 (half-up on fils).
    expect(cash).toHaveLength(1);
    expect(cash[0].credit).toBe("3920.00");
    expect(cash[0].foreign_credit).toBe("1067.39");
    expect(Number(cash[0].exchange_rate)).toBeCloseTo(3.6725, 6);
    expect(await lines(t, "bill_payment", pay.body.payment.id)).toEqual({
      "1026": -392_000,
      "2010": 400_000,
      "4090": -8_000,
    });
  });

  it("[C4] a third-currency payment with no rate for the bank currency is refused with BANK_CURRENCY_RATE_REQUIRED", async () => {
    const t = await tenant();
    // E1: USD/AED resolves at the CBUAE peg with no stored rate, so the refusal is shown with a
    // bank currency that has no default (GBP).
    const usdGl = await usdBank(t, "GBP");
    await rate(t, "EUR", 4.0, daysAgo(10));
    const b = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Euro Vendor GmbH",
      bill_number: "EUR-2",
      bill_date: daysAgo(10),
      currency: "EUR",
      exchange_rate: "4",
      reverse_charge: true,
      line_items: [{ description: "Consulting", quantity: 1, unit_price: 100, vat_rate: 5 }],
    });
    expect((await t.as.post(`/api/bills/${b.body.id}/approve`, {})).status).toBe(200);
    const pay = await t.as.post(`/api/bills/${b.body.id}/payments`, {
      payment_date: daysAgo(5),
      amount: 100,
      payment_account_id: usdGl,
      exchange_rate: "3.92",
    });
    expect(pay.status, pay.text).toBe(422);
    expect(pay.body.code).toBe("BANK_CURRENCY_RATE_REQUIRED");
    const paid = await h.sql(`SELECT 1 FROM bill_payments WHERE bill_id = $1`, [b.body.id]);
    expect(paid).toHaveLength(0);
  });

  it("[C4][L4] a EUR bill paid from the AED bank tags no foreign amount on the AED bank line", async () => {
    const t = await tenant();
    await rate(t, "EUR", 4.0, daysAgo(10));
    const b = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Euro Vendor GmbH",
      bill_number: "EUR-3",
      bill_date: daysAgo(10),
      currency: "EUR",
      exchange_rate: "4",
      reverse_charge: true,
      line_items: [{ description: "Consulting", quantity: 1, unit_price: 2000, vat_rate: 5 }],
    });
    expect((await t.as.post(`/api/bills/${b.body.id}/approve`, {})).status).toBe(200);
    const bank = await accountByCode(t, "1020");
    const pay = await t.as.post(`/api/bills/${b.body.id}/payments`, {
      payment_date: daysAgo(5),
      amount: 2000,
      payment_account_id: bank.id,
      exchange_rate: "3.95",
    });
    expect(pay.status, pay.text).toBe(200);
    expect(await lines(t, "bill_payment", pay.body.payment.id)).toEqual({
      "1020": -790_000,
      "2010": 800_000,
      "4090": -10_000,
    });
    const tag = await h.sql<{ foreign_currency: string | null }>(
      `SELECT jl.foreign_currency FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.source = 'bill_payment' AND je.company_id = $1 AND jl.account_id = $2`,
      [t.company.id, bank.id]
    );
    expect(tag[0].foreign_currency).toBeNull();
  });
});

describe("A2 control accounts", () => {
  it("[H8] a manual Dr 5120 / Cr 1040 is 422 CONTROL_ACCOUNT_MANUAL_POSTING and A/R aging still ties to GL", async () => {
    const t = await tenant();
    const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Acme LLC",
      date: today(),
      lines: [{ description: "Service", quantity: 1, unitPrice: 2000, vatRate: 5 }],
    });
    expect(
      (await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" })).status
    ).toBe(200);
    const ar = await accountByCode(t, "1040");
    const exp = await accountByCode(t, "5120");
    const body = {
      date: today(),
      memo: "Write off",
      status: "posted",
      lines: [
        { accountId: exp.id, debit: 1000 },
        { accountId: ar.id, credit: 1000 },
      ],
    };
    const refused = await t.as.post(`/api/companies/${t.company.id}/journal`, body);
    expect(refused.status, refused.text).toBe(422);
    expect(refused.body.code).toBe("CONTROL_ACCOUNT_MANUAL_POSTING");
    const aging = await t.as.get(
      `/api/companies/${t.company.id}/reports/aged-receivables?asOf=${today()}`
    );
    expect(aging.status, aging.text).toBe(200);
    expect(aging.body.reconciliation).toMatchObject({
      glBalance: 2100,
      agingTotal: 2100,
      difference: 0,
      isReconciled: true,
      controlAdjustments: 0,
      unexplainedDifference: 0,
    });
    // A draft is refused too, and so is posting a recurring template to 1040.
    const draft = await t.as.post(`/api/companies/${t.company.id}/journal`, {
      ...body,
      status: "draft",
    });
    expect(draft.status).toBe(422);
    const tpl = await t.as.post(`/api/companies/${t.company.id}/journal-templates`, {
      name: "Monthly AR",
      frequency: "monthly",
      lines: body.lines,
    });
    expect(tpl.status, tpl.text).toBe(422);
    expect(tpl.body.code).toBe("CONTROL_ACCOUNT_MANUAL_POSTING");
  });

  it("[H8] an owner's adjustment with a reason posts, is stamped, and shows as a reconciling item", async () => {
    const t = await tenant();
    const ar = await accountByCode(t, "1040");
    const eq = await accountByCode(t, "3010");
    const short = await t.as.post(`/api/companies/${t.company.id}/journal`, {
      date: today(),
      status: "posted",
      controlAdjustment: { reason: "x" },
      lines: [
        { accountId: ar.id, debit: 500 },
        { accountId: eq.id, credit: 500 },
      ],
    });
    expect(short.status).toBe(400);
    const ok = await t.as.post(`/api/companies/${t.company.id}/journal`, {
      date: today(),
      status: "posted",
      controlAdjustment: { reason: "Opening A/R not loaded as documents" },
      lines: [
        { accountId: ar.id, debit: 500 },
        { accountId: eq.id, credit: 500 },
      ],
    });
    expect(ok.status, ok.text).toBe(200);
    const stamped = await h.sql<{
      control_adjustment_reason: string;
      control_adjustment_by: string;
    }>(
      `SELECT control_adjustment_reason, control_adjustment_by FROM journal_entries WHERE id = $1`,
      [ok.body.id]
    );
    expect(stamped[0]).toEqual({
      control_adjustment_reason: "Opening A/R not loaded as documents",
      control_adjustment_by: t.user.id,
    });
    const aging = await t.as.get(
      `/api/companies/${t.company.id}/reports/aged-receivables?asOf=${today()}`
    );
    expect(aging.body.reconciliation).toMatchObject({
      glBalance: 500,
      agingTotal: 0,
      difference: 500,
      isReconciled: false,
      controlAdjustments: 500,
      unexplainedDifference: 0,
    });
  });

  it("[H8] an employee cannot adjust a control account (403); a draft without a reason cannot be posted", async () => {
    const t = await tenant({ role: "accountant" });
    const ap = await accountByCode(t, "2010");
    const exp = await accountByCode(t, "5000");
    const draft = await t.as.post(`/api/companies/${t.company.id}/journal`, {
      date: today(),
      status: "draft",
      controlAdjustment: { reason: "Vendor statement difference" },
      lines: [
        { accountId: exp.id, debit: 75 },
        { accountId: ap.id, credit: 75 },
      ],
    });
    expect(draft.status, draft.text).toBe(200);
    // Clearing the reason on the draft makes it unpostable.
    const cleared = await t.as.put(`/api/journal/${draft.body.id}`, {
      date: today(),
      controlAdjustment: null,
      lines: [
        { accountId: exp.id, debit: 75 },
        { accountId: ap.id, credit: 75 },
      ],
    });
    expect(cleared.status).toBe(422);
    const posted = await t.as.post(`/api/journal/${draft.body.id}/post`, {});
    expect(posted.status, posted.text).toBe(200);

    const emp = await tenant({ role: "employee" });
    const ap2 = await accountByCode(emp, "2010");
    const exp2 = await accountByCode(emp, "5000");
    const denied = await emp.as.post(`/api/companies/${emp.company.id}/journal`, {
      date: today(),
      status: "draft",
      controlAdjustment: { reason: "Vendor statement difference" },
      lines: [
        { accountId: exp2.id, debit: 75 },
        { accountId: ap2.id, credit: 75 },
      ],
    });
    expect([403], denied.text).toContain(denied.status);
  });
});

describe("A2 fixed assets bought on a bill", () => {
  it("[H9] a bill line coded to 1210 opens a draft register entry; depreciation waits for its life; completing it activates it; void releases it", async () => {
    const t = await tenant();
    const office = await accountByCode(t, "1210");
    const b = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Office Supplies LLC",
      vendor_trn: SUPPLIER_TRN,
      bill_number: "FA-1",
      bill_date: "2026-01-15",
      line_items: [
        {
          description: "Laser printer",
          quantity: 1,
          unit_price: 12000,
          vat_rate: 5,
          account_id: office.id,
        },
      ],
    });
    expect(b.status, b.text).toBe(200);
    expect((await t.as.post(`/api/bills/${b.body.id}/approve`, {})).status).toBe(200);
    expect(await lines(t, "bill", b.body.id)).toEqual({
      "1050": 60_000,
      "1210": 1_200_000,
      "2010": -1_260_000,
    });
    const fa = await h.sql<{
      id: string;
      status: string;
      purchase_cost: string;
      cost_account_id: string;
      source_bill_id: string;
      capitalization_entry_id: string | null;
      useful_life_years: number | null;
    }>(
      `SELECT id, status, purchase_cost::text AS purchase_cost, cost_account_id, source_bill_id,
              capitalization_entry_id, useful_life_years
         FROM fixed_assets WHERE company_id = $1`,
      [t.company.id]
    );
    expect(fa).toHaveLength(1);
    expect(fa[0]).toMatchObject({
      status: "draft",
      purchase_cost: "12000.00",
      cost_account_id: office.id,
      source_bill_id: b.body.id,
      useful_life_years: null,
    });
    expect(fa[0].capitalization_entry_id).toBeTruthy();

    const run = await t.as.post(`/api/companies/${t.company.id}/fixed-assets/run-depreciation`, {
      month: 2,
      year: 2026,
    });
    expect(run.status, run.text).toBe(200);
    expect(JSON.stringify(run.body)).toContain("ASSET_DRAFT");
    expect(await bal(t, "5100")).toBe(0);

    // The register entry cannot be deleted while the bill capitalises it.
    const del = await t.as.delete(`/api/fixed-assets/${fa[0].id}`);
    expect(del.status, del.text).toBe(409);
    expect(del.body.code).toBe("ASSET_FROM_BILL");

    const done = await t.as.patch(`/api/fixed-assets/${fa[0].id}`, { usefulLifeYears: 5 });
    expect(done.status, done.text).toBe(200);
    expect(done.body.status).toBe("active");

    // Voiding the bill (no depreciation yet) removes the register entry with it.
    const v = await t.as.post(`/api/bills/${b.body.id}/void`, { reason: "Duplicate" });
    expect(v.status, v.text).toBe(200);
    const after = await h.sql(`SELECT 1 FROM fixed_assets WHERE company_id = $1`, [t.company.id]);
    expect(after).toHaveLength(0);
    expect(await bal(t, "1210")).toBe(0);
  });

  it("[H9] once depreciated, voiding the bill is refused with BILL_ASSET_IN_USE", async () => {
    const t = await tenant();
    const office = await accountByCode(t, "1210");
    const b = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Office Supplies LLC",
      vendor_trn: SUPPLIER_TRN,
      bill_number: "FA-2",
      bill_date: "2026-01-15",
      line_items: [
        { description: "Desk", quantity: 1, unit_price: 6000, vat_rate: 5, account_id: office.id },
      ],
    });
    expect((await t.as.post(`/api/bills/${b.body.id}/approve`, {})).status).toBe(200);
    const [fa] = await h.sql<{ id: string }>(
      `SELECT id FROM fixed_assets WHERE source_bill_id = $1`,
      [b.body.id]
    );
    expect((await t.as.patch(`/api/fixed-assets/${fa.id}`, { usefulLifeYears: 5 })).status).toBe(
      200
    );
    const dep = await t.as.post(`/api/fixed-assets/${fa.id}/depreciate`, { month: 2, year: 2026 });
    expect(dep.status, dep.text).toBe(200);
    expect(await bal(t, "5100")).toBe(10_000);
    const v = await t.as.post(`/api/bills/${b.body.id}/void`, { reason: "Duplicate" });
    expect(v.status, v.text).toBe(409);
    expect(v.body.code).toBe("BILL_ASSET_IN_USE");
  });
});
