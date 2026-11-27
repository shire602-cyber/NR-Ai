// F07 — foreign-currency documents post and reverse in AED. Hand-calculated expectations.
// USD invoice @ 3.6725: standard USD 700 (5%) + zero-rated USD 300.
//   AED legs: 4020 (service revenue: unlinked service lines) 2,570.75 · 4060 1,101.75 · 2020 128.54 · 1040 3,801.04
import { expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const date = "2026-01-20";
const base = (t: Tenant) => `/api/companies/${t.company.id}`;
const std = (price: number) => ({
  description: "Services",
  quantity: 1,
  unitPrice: price,
  vatRate: 5,
});
const zero = (price: number) => ({
  description: "Exports",
  quantity: 1,
  unitPrice: price,
  vatRate: 0,
  vatSupplyType: "zero_rated",
});

async function issueUsd(
  t: Tenant,
  lines: Record<string, unknown>[],
  contactId?: string
): Promise<string> {
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme",
    contactId,
    date,
    placeOfSupplyEmirate: "dubai",
    currency: "USD",
    exchangeRate: 3.6725,
    lines,
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);
  return draft.body.id;
}

/** Net debit - credit per account code for the given entries. */
async function legs(entryIds: string[]): Promise<Record<string, number>> {
  const rows = await h.sql<{ code: string; net: number }>(
    `SELECT a.code, SUM(jl.debit - jl.credit)::float8 AS net
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.entry_id = ANY($1::uuid[]) GROUP BY a.code`,
    [entryIds]
  );
  return Object.fromEntries(rows.map((r) => [r.code, Math.round(r.net * 100) / 100]));
}

async function glNet(t: Tenant, code: string): Promise<number> {
  const [r] = await h.sql<{ net: number }>(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::float8 AS net
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
       JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  return Math.round(r.net * 100) / 100;
}

/** Settlement open balance (AED, the one settlement rule) must tie to GL 1040. */
async function expectSettlementTiesToGl(t: Tenant) {
  const { receivableOpenBaseFilsSql } = await import("../../server/reporting/settlement");
  const [r] = await h.sql<{ open: string }>(
    `SELECT COALESCE(SUM(${receivableOpenBaseFilsSql("i")}), 0)::text AS open
       FROM invoices i WHERE i.company_id = $1 AND i.invoice_type <> 'credit_note'
        AND i.status NOT IN ('draft', 'void', 'cancelled')`,
    [t.company.id]
  );
  expect(Number(r.open) / 100).toBe(await glNet(t, "1040"));
}

async function pay(t: Tenant, invoice: string, amount: number, rate: number, allowCredit = false) {
  const bank = await accountByCode(t, "1020");
  const res = await t.as.post(`${base(t)}/invoices/${invoice}/payments`, {
    date,
    amount,
    exchangeRate: rate,
    paymentAccountId: bank.id,
    allowCredit,
  });
  expect(res.status, res.text).toBe(201);
  const [row] = await h.sql<{ journal_entry_id: string }>(
    "SELECT journal_entry_id FROM invoice_payments WHERE id = $1",
    [res.body.payment.id]
  );
  return { paymentId: res.body.payment.id as string, entryId: row.journal_entry_id };
}

it("A: partial then final credit clears every AED leg to the fil; voids mirror exactly", async () => {
  const t = await h.createTenant({ companyColumns: { emirate: "dubai" } });
  const id = await issueUsd(t, [std(700), zero(300)]);
  const [orig] = await h.sql<{ id: string }>(
    "SELECT id FROM journal_entries WHERE company_id = $1 AND source = 'invoice' AND source_id = $2",
    [t.company.id, id]
  );
  expect(await legs([orig.id])).toEqual({
    "1040": 3801.04,
    "4020": -2570.75,
    "4060": -1101.75,
    "2020": -128.54,
  });

  const url = `${base(t)}/invoices/${id}/credit-note`;
  const partial = await t.as.post(url, { date, lines: [std(350)] });
  expect(partial.status, partial.text).toBe(201);
  // At the ORIGINAL rate, standard revenue only: 350 x 3.6725 = 1,285.38 ; VAT 17.50 x 3.6725 = 64.27
  expect(await legs([partial.body.journalEntryId])).toEqual({
    "1040": -1349.65,
    "4020": 1285.38,
    "2020": 64.27,
  });
  expect(Number(partial.body.exchangeRate)).toBe(3.6725);
  expect(Number(partial.body.baseCurrencyAmount)).toBe(-1349.65);
  await expectSettlementTiesToGl(t);

  const final = await t.as.post(url, { date });
  expect(final.status, final.text).toBe(201);
  expect(await legs([final.body.journalEntryId])).toEqual({
    "1040": -2451.39,
    "4020": 1285.37,
    "4060": 1101.75,
    "2020": 64.27,
  });
  for (const code of ["1040", "4020", "4060", "2020"]) expect(await glNet(t, code)).toBe(0);
  await expectSettlementTiesToGl(t);

  // Void the final credit: the reversal mirrors its AED lines exactly.
  const voided = await t.as.post(`/api/credit-notes/${final.body.id}/void`, {});
  expect(voided.status, voided.text).toBe(200);
  const [rev] = await h.sql<{ id: string }>(
    "SELECT reversed_by_entry_id AS id FROM journal_entries WHERE id = $1",
    [final.body.journalEntryId]
  );
  expect(await legs([rev.id])).toEqual({
    "1040": 2451.39,
    "4020": -1285.37,
    "4060": -1101.75,
    "2020": -64.27,
  });
  expect(await glNet(t, "1040")).toBe(2451.39);

  // Voiding a fresh, untouched foreign invoice nets its legs to zero again.
  const before = await glNet(t, "1040");
  const other = await issueUsd(t, [std(700), zero(300)]);
  expect(await glNet(t, "1040")).toBe(Math.round((before + 3801.04) * 100) / 100);
  const v = await t.as.patch(`/api/invoices/${other}/status`, { status: "void" });
  expect(v.status, v.text).toBe(200);
  expect(await glNet(t, "1040")).toBe(before);
});

it("B: foreign receipts realise FX; overpayment credit refunds at its booked AED; reversal restores", async () => {
  const t = await h.createTenant();
  const mk = () => issueUsd(t, [zero(1000)]);
  const { reverseInvoicePayment } = await import("../../server/services/invoice-payment.service");
  const reverse = (paymentId: string) =>
    reverseInvoicePayment({
      companyId: t.company.id,
      paymentId,
      actorId: t.user.id,
      reason: "test",
      date,
    });

  // (a) full payment at 3.68: bank 3,680 / A/R 3,672.50 / FX gain 7.50
  const a = await mk();
  const pa = await pay(t, a, 1000, 3.68);
  expect(await legs([pa.entryId])).toEqual({ "1020": 3680, "1040": -3672.5, "4090": -7.5 });
  expect(await glNet(t, "1040")).toBe(0);
  await expectSettlementTiesToGl(t);

  // (e) reversing (a) restores A/R and removes the gain exactly
  expect((await reverse(pa.paymentId)).reversed).toBe(true);
  expect(await glNet(t, "4090")).toBe(0);
  expect(await glNet(t, "1040")).toBe(3672.5);
  await expectSettlementTiesToGl(t);
  await pay(t, a, 1000, 3.68); // settle it again

  // (b) payment at 3.66: FX loss 12.50
  const b = await mk();
  const pb = await pay(t, b, 1000, 3.66);
  expect(await legs([pb.entryId])).toEqual({ "1020": 3660, "1040": -3672.5, "5140": 12.5 });

  // (c) overpayment USD 1,100 at 3.68
  const c = await mk();
  const pc = await pay(t, c, 1100, 3.68, true);
  expect(await legs([pc.entryId])).toEqual({
    "1020": 4048,
    "1040": -3672.5,
    "2055": -368,
    "4090": -7.5,
  });
  await expectSettlementTiesToGl(t);

  // (d) refund USD 100 at 3.69: liability cleared at 368.00, cash 369.00, FX loss 1.00
  const credits = await t.as.get(`${base(t)}/customer-credits`);
  const credit = credits.body.find((x: { sourceId: string }) => x.sourceId === pc.paymentId);
  expect(Number(credit.remaining)).toBe(100);
  const bank = await accountByCode(t, "1020");
  const refund = await t.as.post(`${base(t)}/customer-credits/${credit.id}/refund`, {
    amount: 100,
    date,
    paymentAccountId: bank.id,
    exchangeRate: 3.69,
  });
  expect(refund.status, refund.text).toBe(201);
  expect(await legs([refund.body.journalEntryId])).toEqual({
    "2055": 368,
    "1020": -369,
    "5140": 1,
  });

  // Reversing the overpayment receipt is refused once its credit was refunded...
  await expect(reverse(pc.paymentId)).rejects.toMatchObject({ code: "CUSTOMER_CREDIT_USED" });

  // ...and, while the credit is untouched, closes it together with the 2055 liability.
  const d = await mk();
  const pd = await pay(t, d, 1100, 3.68, true);
  const liabilityBefore = await glNet(t, "2055");
  await reverse(pd.paymentId);
  expect(await glNet(t, "2055")).toBe(Math.round((liabilityBefore + 368) * 100) / 100);
  const [closed] = await h.sql<{ status: string; remaining: number }>(
    "SELECT status, remaining::float8 AS remaining FROM customer_credits WHERE source_id = $1",
    [pd.paymentId]
  );
  expect(closed).toEqual({ status: "void", remaining: 0 });
});

it("C: F07 reporting readers (trial balance, customer statement, aged A/R, VAT 201) agree with the GL after partial and final USD credits", async () => {
  const t = await h.createTenant({
    companyColumns: {
      emirate: "dubai",
      trn_vat_number: "100000000000003",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
  const contact = await t.as.post(`${base(t)}/customer-contacts`, { name: "Acme" });
  expect(contact.status, contact.text).toBeLessThan(300);
  const id = await issueUsd(t, [std(700), zero(300)], contact.body.id);
  const url = `${base(t)}/invoices/${id}/credit-note`;
  const codes = ["1040", "4020", "4060", "2020"];
  const r2 = (n: number) => Math.round(n * 100) / 100;

  async function checkReaders(expected: Record<string, number>, usdClosing: number) {
    // GL (SQL) equals the hand-calculated values.
    for (const code of codes) expect(await glNet(t, code), `GL ${code}`).toBe(expected[code]);

    // Trial balance route: debitBalance - creditBalance per account equals the GL net.
    const tb = await t.as.get(
      `${base(t)}/reports/trial-balance?from=2026-01-01&to=2026-01-31&format=json`
    );
    expect(tb.status, tb.text).toBe(200);
    const rows = tb.body.rows as {
      accountCode: string;
      debitBalance: number;
      creditBalance: number;
    }[];
    for (const code of codes) {
      const row = rows.find((r) => r.accountCode === code);
      const net = row ? r2(Number(row.debitBalance) - Number(row.creditBalance)) : 0;
      expect(net, `TB ${code}`).toBe(expected[code]);
    }
    expect(tb.body.isBalanced).toBe(true);
    expect(r2(tb.body.totals.sumDebits)).toBe(r2(tb.body.totals.sumCredits));

    // Customer statement (document currency USD): closing x original rate = GL 1040.
    const st = await t.as.get(`${base(t)}/customer-statements/${contact.body.id}?asOf=2026-01-31`);
    expect(st.status, st.text).toBe(200);
    expect(st.body.sections).toHaveLength(1);
    expect(st.body.sections[0].currency).toBe("USD");
    expect(st.body.sections[0].closingBalance).toBe(usdClosing);
    expect(r2(usdClosing * 3.6725)).toBe(expected["1040"]);

    // Aged receivables (AED): aging total ties to GL 1040.
    const ar = await t.as.get(`${base(t)}/reports/aged-receivables?asOf=2026-01-31`);
    expect(ar.status, ar.text).toBe(200);
    expect(Number(ar.body.reconciliation.glBalance)).toBe(expected["1040"]);
    expect(Number(ar.body.reconciliation.agingTotal)).toBe(expected["1040"]);
    expect(Number(ar.body.reconciliation.difference)).toBe(0);
    await expectSettlementTiesToGl(t);

    // VAT 201 (computeVat201 via generate): Box 1b Dubai vs GL 2020 / 4020, Box 4 vs GL 4060.
    const vat = await t.as.post(`${base(t)}/vat-returns/generate`, {
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    });
    expect(vat.status, vat.text).toBe(201);
    expect(Number(vat.body.box1bDubaiVat), "Box 1 VAT").toBe(-expected["2020"] || 0);
    expect(Number(vat.body.box1bDubaiAmount), "Box 1 amount").toBe(-expected["4020"] || 0);
    expect(Number(vat.body.box4ZeroRatedAmount), "Box 4 amount").toBe(-expected["4060"] || 0);
  }

  // Checkpoint 1: after the partial credit.
  const partial = await t.as.post(url, { date, lines: [std(350)] });
  expect(partial.status, partial.text).toBe(201);
  await checkReaders(
    { "1040": 2451.39, "4020": -1285.37, "4060": -1101.75, "2020": -64.27 },
    667.5
  );

  // Checkpoint 2: after the final credit everything is nil.
  const final = await t.as.post(url, { date });
  expect(final.status, final.text).toBe(201);
  await checkReaders({ "1040": 0, "4020": 0, "4060": 0, "2020": 0 }, 0);
});
