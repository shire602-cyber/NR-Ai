/**
 * W5-C multi-currency balances and the rate feed routes.
 * Issue ids: R14-16 (foreign bank balances, bank revaluation, FX on reimbursement and receipt
 * payment), R11-18 (trial balance by currency), R14-14 (feed writes system rows only).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const AS_OF = daysAgo(1);

async function usdBank(t: Tenant): Promise<{ glId: string; bankId: string }> {
  const gl = await h.sql<{ id: string }>(
    `INSERT INTO accounts (company_id, code, name_en, type, sub_type, is_active)
     VALUES ($1, '1025', 'USD Current Account', 'asset', 'bank', true) RETURNING id`,
    [t.company.id]
  );
  const ba = await h.sql<{ id: string }>(
    `INSERT INTO bank_accounts (company_id, name_en, bank_name, currency, gl_account_id)
     VALUES ($1, 'USD Current', 'FAB', 'USD', $2) RETURNING id`,
    [t.company.id, gl[0].id]
  );
  return { glId: gl[0].id, bankId: ba[0].id };
}

async function rate(t: Tenant, body: Record<string, unknown>) {
  const r = await t.as.post(`/api/companies/${t.company.id}/exchange-rates`, {
    fromCurrency: "USD",
    toCurrency: "AED",
    ...body,
  });
  expect(r.status, r.text).toBe(201);
}

describe("R14-16 / R11-18 foreign-currency bank balances", () => {
  it("R14-16 R11-18: a USD receipt into a USD bank account reports 1,050 USD / 3,832.50 AED, is revalued at the closing rate, and shows in the per-currency trial balance", async () => {
    const t = await h.createTenant({ name: "FxBank" });
    const { glId, bankId } = await usdBank(t);
    await rate(t, { rate: 3.65, effectiveDate: daysAgo(40) });

    const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Globex",
      date: daysAgo(30),
      currency: "USD",
      exchangeRate: 3.65,
      lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);
    expect(
      (await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" })).status
    ).toBe(200);
    const pay = await t.as.post(`/api/companies/${t.company.id}/invoices/${inv.body.id}/payments`, {
      amount: 1050,
      date: daysAgo(20),
      method: "bank",
      paymentAccountId: glId,
      exchangeRate: 3.65,
    });
    expect(pay.status, pay.text).toBe(201);

    const bal = await t.as.get(
      `/api/companies/${t.company.id}/bank-accounts/${bankId}/currency-balance?asOf=${AS_OF}`
    );
    expect(bal.status, bal.text).toBe(200);
    expect(bal.body).toMatchObject({
      currency: "USD",
      baseCurrency: "AED",
      isForeign: true,
      balance: 1050,
      baseBalance: 3832.5,
      revaluedBaseBalance: 3832.5,
    });

    // Closing rate 3.70 → 1,050 × 3.70 = 3,885.00: +52.50 unrealised on the bank account.
    await rate(t, { rate: 3.7, effectiveDate: AS_OF, rateType: "closing" });
    const all = await t.as.get(
      `/api/companies/${t.company.id}/bank-accounts/currency-balances?asOf=${AS_OF}`
    );
    const usd = all.body.accounts.find((a: any) => a.bankAccountId === bankId);
    expect(usd).toMatchObject({ revaluedBaseBalance: 3885, unrealisedGainLoss: 52.5 });

    const run = await t.as.post(`/api/companies/${t.company.id}/exchange-rates/revalue`, {
      asOf: AS_OF,
    });
    expect(run.status, run.text).toBe(201);
    const bankAdj = await h.sql<{ debit: string }>(
      `SELECT jl.debit::text AS debit FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.id = $1 AND jl.account_id = $2`,
      [run.body.journalEntryId, glId]
    );
    expect(bankAdj.map((r) => Number(r.debit))).toEqual([52.5]);

    // Per-currency trial balance (R11-18): USD lines in USD beside their AED values.
    const tb = await t.as.get(
      `/api/companies/${t.company.id}/reports/trial-balance-by-currency?to=${AS_OF}`
    );
    expect(tb.status, tb.text).toBe(200);
    expect(tb.body.reportCurrency).toBe("AED");
    const usdGroup = tb.body.currencies.find((c: any) => c.currency === "USD");
    const bankRow = usdGroup.rows.find((r: any) => r.accountCode === "1025");
    expect(bankRow).toMatchObject({ debit: 1050, balance: 1050, baseBalance: 3832.5 });
    // The revaluation adjustment has no foreign amount, so it sits in the base-currency group.
    const aedGroup = tb.body.currencies.find((c: any) => c.currency === "AED");
    expect(aedGroup.rows.find((r: any) => r.accountCode === "1025")).toMatchObject({
      baseDebit: 52.5,
    });
    const arRow = usdGroup.rows.find((r: any) => r.accountCode === "1040");
    expect(arRow).toMatchObject({ debit: 1050, credit: 1050, balance: 0 });
    expect(tb.body.isBalanced).toBe(true);
    // Another tenant cannot read it.
    const other = await h.createSecondTenant();
    expect(
      [403, 404].includes(
        (await other.as.get(`/api/companies/${t.company.id}/reports/trial-balance-by-currency`))
          .status
      )
    ).toBe(true);
    expect(
      [403, 404].includes(
        (
          await other.as.get(
            `/api/companies/${other.company.id}/bank-accounts/${bankId}/currency-balance`
          )
        ).status
      )
    ).toBe(true);
  });

  it("R14-16: a USD expense claim reimbursed from the USD bank settles at the payment-date rate with realised FX", async () => {
    const t = await h.createTenant({ name: "FxClaim" });
    const { glId } = await usdBank(t);
    await rate(t, { rate: 3.65, effectiveDate: daysAgo(30) });
    const c = await t.as.post(`/api/companies/${t.company.id}/expense-claims`, {
      title: "Trip",
      items: [
        {
          expense_date: daysAgo(25),
          category: "Travel",
          description: "Hotel",
          amount: 100,
          vat_amount: 0,
          currency: "USD",
          has_tax_invoice: false,
        },
      ],
    });
    expect(c.status, c.text).toBe(200);
    expect((await t.as.post(`/api/expense-claims/${c.body.id}/submit`, {})).status).toBe(200);
    const a = await t.as.post(`/api/expense-claims/${c.body.id}/approve`, {});
    expect(a.status, a.text).toBe(200);
    // Accrued 100 USD × 3.65 = 365.00 AED; paid when 1 USD = 3.70 → 370.00 cash, 5.00 FX loss.
    await rate(t, { rate: 3.7, effectiveDate: daysAgo(5) });
    const paid = await t.as.post(`/api/expense-claims/${c.body.id}/mark-paid`, {
      payment_account_id: glId,
      payment_date: daysAgo(5),
    });
    expect(paid.status, paid.text).toBe(200);
    const lines = await h.sql<{
      code: string;
      debit: string;
      credit: string;
      foreign_currency: string | null;
      foreign_credit: string;
    }>(
      `SELECT a.code, jl.debit::text AS debit, jl.credit::text AS credit, jl.foreign_currency,
              jl.foreign_credit::text AS foreign_credit
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.id = $1 ORDER BY a.code`,
      [paid.body.journal_entry_id]
    );
    const byCode = Object.fromEntries(lines.map((l) => [l.code, l]));
    expect(Number(byCode["2045"].debit)).toBe(365);
    expect(Number(byCode["1025"].credit)).toBe(370);
    expect(byCode["1025"].foreign_currency).toBe("USD");
    expect(Number(byCode["1025"].foreign_credit)).toBe(100);
    expect(Number(byCode["5140"].debit)).toBe(5);
  });

  it("R14-16: a foreign receipt left on the default rate takes the receipt-date rate from fx.getRate", async () => {
    const { planReceiptJournal } = await import("../../server/services/receipt-posting.service");
    const { registerFxServices } = await import("../../server/services/fx");
    registerFxServices();
    const t = await h.createTenant({ name: "FxReceipt" });
    await rate(t, { rate: 3.65, effectiveDate: daysAgo(10) });
    const bank = await accountByCode(t, "1020");
    const exp = await accountByCode(t, "5010");
    const plan = await planReceiptJournal(
      {
        id: "00000000-0000-0000-0000-000000000001",
        companyId: t.company.id,
        currency: "USD",
        exchangeRate: 1,
        amount: 100,
        vatAmount: 0,
        date: new Date(`${daysAgo(3)}T00:00:00Z`),
        merchant: "Cloud Co",
        category: "Software",
        accountId: exp.id,
      } as never,
      { paymentAccountId: bank.id, expenseAccountId: exp.id }
    );
    const pay = plan.lines.find((l) => l.accountId === bank.id)!;
    expect(Number(pay.credit)).toBe(365);
    expect(pay.foreignCurrency).toBe("USD");
  });
});

it("posts a USD receipt at the booked USD-to-EUR rate for a EUR company", async () => {
  const t = await h.createTenant({ name: "EUR Receipt" });
  await h.sql(`UPDATE companies SET base_currency = 'EUR' WHERE id = $1`, [t.company.id]);
  await rate(t, { toCurrency: "EUR", rate: 0.9, effectiveDate: daysAgo(10) });
  const expense = await accountByCode(t, "5010");
  const bank = await accountByCode(t, "1020");
  const draft = await t.as.post(`/api/companies/${t.company.id}/receipts`, {
    merchant: "USD vendor",
    date: daysAgo(3),
    currency: "USD",
    amount: 100,
    vatAmount: 5,
    invoiceNumber: "USD-105",
  });
  expect(draft.status, draft.text).toBe(200);
  const url = `/api/receipts/${draft.body.id}/post`;
  const bad = await t.as.post(url, { accountId: expense.id, paymentAccountId: expense.id });
  expect(bad.status).toBe(400);
  const [unposted] = await h.sql(`SELECT exchange_rate, posted FROM receipts WHERE id = $1`, [
    draft.body.id,
  ]);
  expect(Number(unposted.exchange_rate)).toBe(1);
  expect(unposted.posted).toBe(false);

  const posted = await t.as.post(url, { accountId: expense.id, paymentAccountId: bank.id });
  expect(posted.status, posted.text).toBe(200);
  expect(posted.body).toMatchObject({
    exchangeRate: 0.9,
    baseCurrencyAmount: 94.5,
    invoiceNumber: "USD-105",
  });
  const [line] = await h.sql(
    `SELECT credit, foreign_credit, foreign_currency, exchange_rate FROM journal_lines WHERE entry_id = $1 AND account_id = $2`,
    [posted.body.journalEntryId, bank.id]
  );
  expect(Number(line.credit)).toBe(94.5);
  expect(Number(line.foreign_credit)).toBe(105);
  expect(line.foreign_currency).toBe("USD");
  expect(Number(line.exchange_rate)).toBe(0.9);
});

describe("R14-14 rate feed routes", () => {
  it("R14-14: an admin-ingested ECB/CBUAE payload writes system rows only; non-admins 403; unconfigured fetch 503", async () => {
    const admin = await h.createTenant({ name: "FeedAdmin", isAdmin: true });
    const user = await h.createSecondTenant({ name: "FeedUser" });
    const fixture = (n: string) =>
      fs.readFileSync(path.join(__dirname, "..", "fixtures", "fx-feed", n), "utf8");

    const denied = await user.as.post(`/api/exchange-rates/feed/run`, {
      provider: "ecb",
      payload: fixture("ecb-eurofxref-daily.xml"),
    });
    expect(denied.status).toBe(403);

    const ecb = await admin.as.post(`/api/exchange-rates/feed/run`, {
      provider: "ecb",
      payload: fixture("ecb-eurofxref-daily.xml"),
    });
    expect(ecb.status, ecb.text).toBe(201);
    expect(ecb.body).toMatchObject({
      provider: "ecb",
      status: "ok",
      inserted: 5,
      date: "2026-11-13",
    });
    const cb = await admin.as.post(`/api/exchange-rates/feed/run`, {
      provider: "cbuae",
      payload: fixture("cbuae-rates.html"),
    });
    expect(cb.status, cb.text).toBe(201);
    expect(cb.body.inserted).toBe(5);

    const rows = await h.sql<{ company_id: string | null; source: string; rate_type: string }>(
      `SELECT company_id, source, rate_type FROM exchange_rates WHERE source IN ('ecb', 'cbuae')`
    );
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.company_id === null && r.rate_type === "spot")).toBe(true);
    // A company with no own rate now resolves USD→AED from the CBUAE system row.
    const lookup = await user.as.get(
      `/api/companies/${user.company.id}/exchange-rates/lookup?from=USD&to=AED&date=2026-11-14`
    );
    expect(lookup.status, lookup.text).toBe(200);
    expect(lookup.body).toMatchObject({ rate: 3.6725, source: "cbuae", scope: "system" });

    // Without FX_RATE_FEED a fetch is refused honestly.
    const fetchRun = await admin.as.post(`/api/exchange-rates/feed/run`, { provider: "cbuae" });
    expect(fetchRun.status).toBe(503);
    expect(fetchRun.body.code).toBe("FX_RATE_FEED_NOT_CONFIGURED");
    const status = await user.as.get(
      `/api/companies/${user.company.id}/exchange-rates/feed-status`
    );
    expect(status.status, status.text).toBe(200);
    expect(status.body.feed.capability).toBe("requires_external");
    expect(status.body.pairs.some((p: any) => p.pair === "USD/AED" && p.scope === "system")).toBe(
      true
    );

    // CSV import (admin) writes system rows too.
    const csv = await admin.as.post(`/api/exchange-rates/import-csv`, {
      csv: "date,from,to,rate\n2026-11-12,OMR,AED,9.5385\n",
      source: "fta",
    });
    expect(csv.status, csv.text).toBe(201);
    expect(csv.body.inserted).toBe(1);
    const omr = await h.sql(
      `SELECT company_id, source FROM exchange_rates WHERE base_currency = 'OMR'`
    );
    expect(omr).toEqual([{ company_id: null, source: "fta" }]);
    expect((await user.as.post(`/api/exchange-rates/import-csv`, { csv: "x" })).status).toBe(403);
    const runs = await h.sql(`SELECT provider, status FROM fx_rate_feed_runs ORDER BY created_at`);
    expect(runs.map((r: any) => r.provider)).toEqual(["ecb", "cbuae", "csv"]);
  });
});
