import { expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const date = "2026-01-20";
const base = (t: Tenant) => `/api/companies/${t.company.id}`;
const standard = (price: number) => ({
  description: "Local services",
  quantity: 1,
  unitPrice: price,
  vatRate: 5,
});
const exported = (price: number) => ({
  description: "Exports",
  quantity: 1,
  unitPrice: price,
  vatRate: 0,
  vatSupplyType: "zero_rated",
});

async function issue(
  t: Tenant,
  lines: Record<string, unknown>[],
  other: Record<string, unknown> = {}
): Promise<string> {
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme",
    date,
    placeOfSupplyEmirate: "dubai",
    lines,
    ...other,
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);
  return draft.body.id;
}

async function pay(t: Tenant, invoice: string, amount: number, allowCredit = false) {
  const bank = await accountByCode(t, "1020");
  const response = await t.as.post(`${base(t)}/invoices/${invoice}/payments`, {
    date,
    amount,
    exchangeRate: 3.67,
    paymentAccountId: bank.id,
    allowCredit,
  });
  expect(response.status, response.text).toBe(201);
  return response.body;
}

it("clears each VAT 201 box on the remaining credit of a partly credited mixed-supply invoice", async () => {
  const t = await h.createTenant({ companyColumns: { emirate: "dubai" } });
  const id = await issue(t, [standard(100), exported(100)]);
  const url = `${base(t)}/invoices/${id}/credit-note`;
  const partial = await t.as.post(url, { date, lines: [exported(40)] });
  expect(partial.status, partial.text).toBe(201);
  const remaining = await t.as.post(url, { date });
  expect(remaining.status, remaining.text).toBe(201);
  expect(Number(remaining.body.total)).toBe(-165);
  const report = await t.as.get(`${base(t)}/reports/vat-return?from=2026-01-01&to=2026-03-31`);
  expect(report.status, report.text).toBe(200);
  // All sales are credited. Both the taxable AED 100 + 5 and the zero-rated AED 100 must wash out.
  expect(report.body.boxes).toMatchObject({
    box1bDubaiAmount: 0,
    box1bDubaiVat: 0,
    box4ZeroRatedAmount: 0,
    box14PayableTax: 0,
  });
});

it("fully settles a foreign invoice after an earlier part payment was reversed at the same rate", async () => {
  const t = await h.createTenant();
  const id = await issue(t, [exported(100)], { currency: "USD", exchangeRate: 3.67 });
  const first = await pay(t, id, 40);
  const { reverseInvoicePayment } = await import("../../server/services/invoice-payment.service");
  const reversed = await reverseInvoicePayment({
    companyId: t.company.id,
    paymentId: first.payment.id,
    actorId: t.user.id,
    reason: "Undo part payment before recording the correct receipt",
    date,
  });
  expect(reversed.reversed).toBe(true);
  expect((await pay(t, id, 100)).status).toBe("paid");
  const rows = await h.sql<{ code: string; net: number }>(
    `SELECT a.code, SUM(jl.debit - jl.credit)::float8 AS net
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
       JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code IN ('1040', '4090')
      GROUP BY a.code`,
    [t.company.id]
  );
  const balances = new Map(rows.map((r) => [r.code, r.net]));
  expect({ receivables: balances.get("1040"), fxGain: balances.get("4090") ?? 0 }).toEqual({
    receivables: 0,
    fxGain: 0,
  });
});

it("shows a USD overpayment liability in the USD trial balance", async () => {
  const t = await h.createTenant();
  const id = await issue(t, [exported(100)], { currency: "USD", exchangeRate: 3.67 });
  await pay(t, id, 150, true);
  const credits = await t.as.get(`${base(t)}/customer-credits`);
  expect(credits.status, credits.text).toBe(200);
  expect(credits.body).toContainEqual(expect.objectContaining({ currency: "USD", remaining: 50 }));
  const tb = await t.as.get(`${base(t)}/reports/trial-balance-by-currency?to=${date}`);
  expect(tb.status, tb.text).toBe(200);
  const usd = tb.body.currencies.find((c: { currency: string }) => c.currency === "USD");
  const credit = usd.rows.find((r: { accountCode: string }) => r.accountCode === "2055");
  expect(credit).toMatchObject({ credit: 50, baseCredit: 183.5 });
});

it("debits the cost centre named on a partial credit for a specific invoice line", async () => {
  const t = await h.createTenant({ planId: "enterprise" });
  async function center(code: string): Promise<string> {
    const response = await t.as.post(`${base(t)}/cost-centers`, { code, name: code });
    expect(response.status, response.text).toBe(201);
    return response.body.id;
  }
  const a = await center("Job-A");
  const b = await center("Job-B");
  const jobA = { ...standard(100), description: "Job A", costCenterId: a };
  const jobB = { ...standard(100), description: "Job B", costCenterId: b };
  const revenueAccountId = (await accountByCode(t, "4010")).id;
  const id = await issue(
    t,
    [jobA, jobB].map((line) => ({ ...line, revenueAccountId }))
  );
  const cn = await t.as.post(`${base(t)}/invoices/${id}/credit-note`, { date, lines: [jobA] });
  expect(cn.status, cn.text).toBe(201);
  const ledger = await h.sql<{ code: string; debit: number }>(
    `SELECT cc.code, jl.debit::float8 AS debit
       FROM journal_lines jl JOIN cost_centers cc ON cc.id = jl.cost_center_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE jl.entry_id = $1 AND a.code = '4010' ORDER BY cc.code`,
    [cn.body.journalEntryId]
  );
  expect(ledger).toEqual([{ code: "Job-A", debit: 100 }]);
});

it("uses the refund date's exchange rate for a foreign customer credit paid from an AED bank", async () => {
  const t = await h.createTenant();
  const invoice = await issue(t, [exported(100)], { currency: "USD", exchangeRate: 3.67 });
  await pay(t, invoice, 100);
  const cn = await t.as.post(`${base(t)}/invoices/${invoice}/credit-note`, { date });
  expect(cn.status, cn.text).toBe(201);
  const refundDate = "2026-01-21";
  const rate = await t.as.post(`${base(t)}/exchange-rates`, {
    fromCurrency: "USD",
    toCurrency: "AED",
    rate: 3.8,
    effectiveDate: refundDate,
  });
  expect(rate.status, rate.text).toBe(201);
  const bank = await accountByCode(t, "1020");
  const refund = await t.as.post(
    `${base(t)}/customer-credits/${cn.body.customerCredit.id}/refund`,
    {
      amount: 100,
      date: refundDate,
      paymentAccountId: bank.id,
    }
  );
  expect(refund.status, refund.text).toBe(201);
  const lines = await h.sql<{ code: string; net: number }>(
    `SELECT a.code, (jl.debit - jl.credit)::float8 AS net FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1`,
    [refund.body.journalEntryId]
  );
  // Clear the booked liability of AED 367. The bank pays AED 380 and the AED 13 difference is a loss.
  expect(Object.fromEntries(lines.map((r) => [r.code, r.net]))).toEqual({
    "1020": -380,
    "2055": 367,
    "5140": 13,
  });
});
