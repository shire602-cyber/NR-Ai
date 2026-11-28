/**
 * W5-C golden test: a USD-functional company runs invoice → payment → bill → statements end to
 * end with a hand-computed trial balance. Issue id: R14-19.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";
import type { FxToVatFilingCurrency } from "../../server/services/fx";
import { dubaiIso, dubaiToday } from "../helpers/dates";

const h = useHarness();
const daysAgo = (n: number) => dubaiIso(new Date(Date.now() - n * 86_400_000));
const today = () => dubaiToday();

async function issuedInvoice(t: Tenant, body: Record<string, unknown>) {
  const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Globex Inc",
    date: daysAgo(5),
    lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    ...body,
  });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return c.body as {
    id: string;
    exchangeRate: number;
    currency: string;
    baseCurrencyAmount: number;
  };
}

async function linesOf(t: Tenant, sourceId: string) {
  return h.sql<{
    code: string;
    debit: string;
    credit: string;
    foreign_currency: string | null;
    foreign_debit: string;
    exchange_rate: string;
  }>(
    `SELECT a.code, jl.debit::text AS debit, jl.credit::text AS credit, jl.foreign_currency,
            jl.foreign_debit::text AS foreign_debit, jl.exchange_rate::text AS exchange_rate
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source_id = $2 AND je.status = 'posted'
      ORDER BY a.code`,
    [t.company.id, sourceId]
  );
}

describe("R14-19 non-AED functional currency", () => {
  it("R14-19: a USD-base company: USD invoice unconverted, AED invoice converted, payment, bill, statements in USD; trial balance matches the hand calculation", async () => {
    const u = await h.createTenant({ name: "UsdCo", companyColumns: { base_currency: "USD" } });

    // Rate entered on the company: 1 AED = 0.25 USD (stored canonically as (AED, USD)).
    const rate = await u.as.post(`/api/companies/${u.company.id}/exchange-rates`, {
      fromCurrency: "AED",
      rate: 0.25,
      effectiveDate: daysAgo(10),
    });
    expect(rate.status, rate.text).toBe(201);
    expect(rate.body).toMatchObject({ fromCurrency: "AED", toCurrency: "USD" });

    // 1) USD invoice: document currency = base currency → no conversion, no foreign tags.
    const usd = await issuedInvoice(u, { currency: "USD" });
    expect(Number(usd.exchangeRate)).toBe(1);
    expect(Number(usd.baseCurrencyAmount)).toBe(1050);
    const usdLines = await linesOf(u, usd.id);
    expect(usdLines.map((l) => [l.code, Number(l.debit), Number(l.credit)])).toEqual([
      ["1040", 1050, 0],
      ["2020", 0, 50],
      ["4020", 0, 1000],
    ]);
    expect(usdLines.every((l) => l.foreign_currency === null)).toBe(true);

    // 2) AED invoice: 400 + 5% VAT = 420 AED at 0.25 → 105.00 USD, tagged AED.
    const aed = await issuedInvoice(u, {
      currency: "AED",
      lines: [{ description: "Local work", quantity: 1, unitPrice: 400, vatRate: 5 }],
    });
    expect(Number(aed.exchangeRate)).toBe(0.25);
    const aedLines = await linesOf(u, aed.id);
    expect(aedLines.map((l) => [l.code, Number(l.debit), Number(l.credit)])).toEqual([
      ["1040", 105, 0],
      ["2020", 0, 5],
      ["4020", 0, 100],
    ]);
    const ar = aedLines.find((l) => l.code === "1040")!;
    expect(ar.foreign_currency).toBe("AED");
    expect(Number(ar.foreign_debit)).toBe(420);

    // 3) Payment of the USD invoice: same currency, no FX lines.
    const bank = await accountByCode(u, "1020");
    const pay = await u.as.post(`/api/companies/${u.company.id}/invoices/${usd.id}/payments`, {
      amount: 1050,
      date: daysAgo(2),
      method: "bank",
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBe(201);
    const payLines = await h.sql<{ code: string }>(
      `SELECT a.code FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.source = 'payment' AND je.source_id = $2`,
      [u.company.id, usd.id]
    );
    expect(payLines.map((l) => l.code).sort()).toEqual(["1020", "1040"]);

    // 4) USD bill 200 + 5% VAT, approved and paid in full.
    const bill = await u.as.post(`/api/companies/${u.company.id}/bills`, {
      vendor_name: "Hosting Corp",
      bill_number: "USD-B-1",
      bill_date: daysAgo(4),
      due_date: today(),
      currency: "USD",
      line_items: [{ description: "Hosting", quantity: 1, unit_price: 200, vat_rate: 5 }],
    });
    expect(bill.status, bill.text).toBe(200);
    expect(Number(bill.body.exchange_rate)).toBe(1);
    const appr = await u.as.post(`/api/bills/${bill.body.id}/approve`, {});
    expect(appr.status, appr.text).toBe(200);
    const bp = await u.as.post(`/api/bills/${bill.body.id}/payments`, {
      payment_date: daysAgo(1),
      amount: 210,
    });
    expect(bp.status, bp.text).toBe(200);

    // 5) Statements are labelled USD; the trial balance matches the hand calculation:
    //    Bank 1,050 − 210 = 840 Dr; A/R 105 Dr; input VAT 10 Dr; expense 200 Dr;
    //    revenue 1,000 + 100 = 1,100 Cr; output VAT 50 + 5 = 55 Cr; A/P 210 − 210 = 0.
    const tb = await u.as.get(`/api/companies/${u.company.id}/reports/trial-balance?to=${today()}`);
    expect(tb.status, tb.text).toBe(200);
    expect(tb.body.reportCurrency).toBe("USD");
    const net = Object.fromEntries(
      (tb.body.rows as Array<{ accountCode: string; debitBalance: number; creditBalance: number }>)
        .filter((r) => r.debitBalance || r.creditBalance)
        .map((r) => [r.accountCode, r.debitBalance - r.creditBalance])
    );
    expect(net).toEqual({
      "1020": 840,
      "1040": 105,
      "1050": 10,
      "5000": 200,
      "4020": -1100,
      "2020": -55,
    });
    expect(tb.body.isBalanced).toBe(true);
    expect(tb.body.totals.sumDebitBalances).toBe(1155);
    expect(tb.body.totals.sumCreditBalances).toBe(1155);

    const pl = await u.as.get(
      `/api/companies/${u.company.id}/reports/profit-loss?from=${daysAgo(30)}&to=${today()}`
    );
    expect(pl.status, pl.text).toBe(200);
    expect(pl.body.reportCurrency).toBe("USD");
    expect(pl.body.netProfit).toBe(900);
    const bs = await u.as.get(
      `/api/companies/${u.company.id}/reports/balance-sheet?asOf=${today()}`
    );
    expect(bs.status, bs.text).toBe(200);
    expect(bs.body.reportCurrency).toBe("USD");
    expect(bs.body.isBalanced).toBe(true);

    // Per-currency view: AED-transacted lines show their AED amounts beside USD.
    const byCur = await u.as.get(
      `/api/companies/${u.company.id}/reports/trial-balance-by-currency?to=${today()}`
    );
    expect(byCur.status, byCur.text).toBe(200);
    expect(byCur.body.reportCurrency).toBe("USD");
    const aedGroup = byCur.body.currencies.find((c: any) => c.currency === "AED");
    const aedAr = aedGroup.rows.find((r: any) => r.accountCode === "1040");
    expect(aedAr).toMatchObject({ debit: 420, baseDebit: 105 });
    expect(byCur.body.currencies[0]).toMatchObject({ currency: "USD", isBase: true });
    expect(byCur.body.isBalanced).toBe(true);

    // VAT is filed in AED: a USD amount converts at the document-date rate (1 USD = 4 AED here).
    const { resolve } = await import("../../server/platform/service-registry");
    const toVat = resolve<FxToVatFilingCurrency>("fx.toVatFilingCurrency");
    expect(await toVat(u.company.id, 5_500, daysAgo(1))).toMatchObject({
      filingCurrency: "AED",
      baseCurrency: "USD",
      fils: 22_000,
    });
  });
});
