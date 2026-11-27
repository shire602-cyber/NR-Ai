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

  // Checkpoint 0: issuance only — AR 3,801.04 appears on the trial balance before any credit.
  {
    const tb = await t.as.get(
      `${base(t)}/reports/trial-balance?from=2026-01-01&to=2026-01-31&format=json`
    );
    expect(tb.status, tb.text).toBe(200);
    const arRow = (tb.body.rows as Array<{ accountCode: string; debitBalance: number }>).find(
      (r) => r.accountCode === "1040"
    );
    expect(Number(arRow?.debitBalance), "AR 1040 at issuance").toBe(3801.04);
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

it("D: foreign reverse-charge credit — Box 1 is not inflated by the posted revenue remainder", async () => {
  // A domestic reverse-charge credit note is in `foreignCreditIds` when issued in USD.
  // Before the fix, `POSTED_ROLE_FAMILY` mapped the posted revenue account (4020) to `standard`,
  // which added a second Box 1 contribution on top of the reverse_charge family from the lines.
  const t = await h.createTenant({
    companyColumns: {
      emirate: "dubai",
      trn_vat_number: "100000000000003",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });

  // USD 1,000 reverse-charge invoice at 3.6725. Box 1b Dubai Amount = 3,672.50 (no VAT on
  // the supplier side; the recipient self-assesses). Revenue is posted to account 4020.
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Overseas LLC",
    date,
    placeOfSupplyEmirate: "dubai",
    currency: "USD",
    exchangeRate: 3.6725,
    reverseCharge: true,
    lines: [{ description: "RC Services", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);

  // Full credit note clears the reverse-charge amount.
  const cn = await t.as.post(`${base(t)}/invoices/${draft.body.id}/credit-note`, { date });
  expect(cn.status, cn.text).toBe(201);

  // VAT 201: invoice + full credit net to 0 in Box 1 (reverse_charge maps to Box 1 Amount,
  // no VAT). Without the fix the posted remainder adds a second standard-family Box 1
  // contribution, leaving Box 1 Amount = -(3,672.50) instead of 0.
  const vat = await t.as.post(`${base(t)}/vat-returns/generate`, {
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
  });
  expect(vat.status, vat.text).toBe(201);
  expect(Number(vat.body.box1bDubaiAmount), "Box 1 amount must net to 0").toBe(0);
  expect(Number(vat.body.box1bDubaiVat), "Box 1 VAT must be 0").toBe(0);
});

it("E: reverse-charge header flag — split credits tie Box 1 to the fil", async () => {
  // USD 700 reverse-charge invoice at 3.6725. Two credits of USD 350 each.
  // toBaseFils(35000, 3.6725) = 128538 fils for each half; the posted GL clears 128537 on
  // the final credit (257075 − 128538). The remap standard→reverse_charge in postedNet lets
  // the final credit use the GL remainder instead of re-converting USD 350, so Box 1 = 0.
  const t = await h.createTenant({
    companyColumns: {
      emirate: "dubai",
      trn_vat_number: "100000000000004",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Overseas LLC",
    date,
    placeOfSupplyEmirate: "dubai",
    currency: "USD",
    exchangeRate: 3.6725,
    reverseCharge: true,
    lines: [{ description: "RC Services", quantity: 1, unitPrice: 700, vatRate: 5 }],
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);

  const url = `${base(t)}/invoices/${draft.body.id}/credit-note`;
  // Partial credit: USD 350. The RC header is inherited; vatRate:5 matches the original line.
  const cn1 = await t.as.post(url, {
    date,
    lines: [{ description: "RC Services", quantity: 1, unitPrice: 350, vatRate: 5 }],
  });
  expect(cn1.status, cn1.text).toBe(201);
  const cn2 = await t.as.post(url, { date });
  expect(cn2.status, cn2.text).toBe(201);

  const vat = await t.as.post(`${base(t)}/vat-returns/generate`, {
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
  });
  expect(vat.status, vat.text).toBe(201);
  expect(Number(vat.body.box1bDubaiAmount), "Box 1 amount ties to 0 — no -0.01 drift").toBe(0);
  expect(Number(vat.body.box1bDubaiVat), "Box 1 VAT is 0").toBe(0);
});

it("F: explicit reverse_charge supply type (no header flag) — Box 1 not inflated", async () => {
  // vatSupplyType:'reverse_charge' on a line with no reverseCharge header.
  // Before the fix, hasRcLines was false (checked only inv.reverseCharge), so the posted
  // standard-sales remainder was applied and added a second Box 1 Amount contribution.
  // After the fix, classifySupply per line detects the reverse_charge family; the standard
  // entry is remapped to reverse_charge instead of being applied as a separate standard family.
  const t = await h.createTenant({
    companyColumns: {
      emirate: "dubai",
      trn_vat_number: "100000000000005",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Overseas LLC",
    date,
    placeOfSupplyEmirate: "dubai",
    currency: "USD",
    exchangeRate: 3.6725,
    lines: [
      {
        description: "RC Services",
        quantity: 1,
        unitPrice: 1000,
        vatRate: 0,
        vatSupplyType: "reverse_charge",
      },
    ],
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);

  const cn = await t.as.post(`${base(t)}/invoices/${draft.body.id}/credit-note`, { date });
  expect(cn.status, cn.text).toBe(201);

  const vat = await t.as.post(`${base(t)}/vat-returns/generate`, {
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
  });
  expect(vat.status, vat.text).toBe(201);
  expect(Number(vat.body.box1bDubaiAmount), "Box 1 amount nets to 0").toBe(0);
  expect(Number(vat.body.box1bDubaiVat), "Box 1 VAT is 0 (supplier charges no VAT)").toBe(0);
});

it("G: foreign margin-scheme mixed invoice — Box 1 margin/VAT and Box 4 through partial and final credits", async () => {
  // USD margin line (unitPrice:105, cost:84 → VAT-exclusive margin USD 20 = AED 73.45)
  // + zero-rated line (USD 700 = AED 2,570.75) at rate 3.6725.
  // Credit 1: zero-rated USD 350 only. Credit 2: full remainder (margin + zero-rated USD 350).
  // The old code (strip all postedNet when hasMarginScheme) left Box 4 at −AED 0.01 on credit 2
  // because toBaseFils(35000, 3.6725)=128538 while the GL cleared 128537 for the final portion.
  // The new code strips only the standard entry, keeping zero_rated for rounding correction.
  const t = await h.createTenant({
    companyColumns: {
      emirate: "dubai",
      trn_vat_number: "100000000000006",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Margin Co LLC",
    date,
    placeOfSupplyEmirate: "dubai",
    currency: "USD",
    exchangeRate: 3.6725,
    lines: [
      {
        description: "Margin goods",
        quantity: 1,
        unitPrice: 105,
        vatRate: 5,
        marginScheme: true,
        marginPurchaseCost: 84,
      },
      zero(700),
    ],
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);

  const url = `${base(t)}/invoices/${draft.body.id}/credit-note`;
  const vatPeriod = { periodStart: "2026-01-01", periodEnd: "2026-03-31" };

  // Initial: Box 1 = VAT-exclusive margin only (AED 73.45), not full revenue.
  {
    const vatDraft = await t.as.post(`${base(t)}/vat-returns/generate`, vatPeriod);
    expect(vatDraft.status, vatDraft.text).toBe(201);
    expect(Number(vatDraft.body.box1bDubaiAmount), "Box 1b = margin only").toBe(73.45);
    expect(Number(vatDraft.body.box1bDubaiVat), "Box 1b VAT = margin VAT").toBe(3.67);
    expect(Number(vatDraft.body.box4ZeroRatedAmount), "Box 4 = zero-rated amount").toBe(2570.75);
  }

  // Partial credit: zero-rated line USD 350 only. Margin untouched.
  const cn1 = await t.as.post(url, { date, lines: [zero(350)] });
  expect(cn1.status, cn1.text).toBe(201);

  // After partial credit: Box 1 unchanged (margin not credited); Box 4 drops by AED 1,285.38.
  // toBaseFils(35000, 3.6725) = 128538 fils. Net Box 4 = 257075 − 128538 = 128537 = AED 1,285.37.
  {
    const vatMid = await t.as.post(`${base(t)}/vat-returns/generate`, vatPeriod);
    expect(vatMid.status, vatMid.text).toBe(201);
    expect(Number(vatMid.body.box1bDubaiAmount), "Box 1b after partial — margin untouched").toBe(
      73.45
    );
    expect(Number(vatMid.body.box1bDubaiVat), "Box 1b VAT after partial — margin VAT unchanged").toBe(3.67);
    expect(Number(vatMid.body.box4ZeroRatedAmount), "Box 4 after partial credit").toBe(1285.37);
  }

  // Full remainder: margin USD 105 + zero-rated USD 350. hasMarginScheme=true for this
  // credit; zero_rated remainder must still use the GL amount (128537) so Box 4 nets to 0.
  const cn2 = await t.as.post(url, { date });
  expect(cn2.status, cn2.text).toBe(201);

  // After full credit: all boxes net to 0 to the fil.
  {
    const vatFinal = await t.as.post(`${base(t)}/vat-returns/generate`, vatPeriod);
    expect(vatFinal.status, vatFinal.text).toBe(201);
    expect(Number(vatFinal.body.box1bDubaiAmount), "Box 1 = 0 after full credit").toBe(0);
    expect(Number(vatFinal.body.box1bDubaiVat), "Box 1 VAT = 0 after full credit").toBe(0);
    expect(
      Number(vatFinal.body.box4ZeroRatedAmount),
      "Box 4 = 0 — GL remainder used, not re-converted"
    ).toBe(0);
  }
});

it("H: mixed standard + explicit RC lines — full credit ties Box 1 amount and VAT", async () => {
  // USD 100 standard (5%) + USD 100 reverse_charge (0%, no reverseCharge header) at 3.6725.
  // Both lines post to 4020 (standard_sales). rawPostedNet["standard"] bundles both families.
  //
  // Before the fix: unconditional standard→reverse_charge remap used the combined GL value
  //   (AED 734.50) for RC Box 1 while standard doc fils (AED 367.25) added again → net = -AED 367.25.
  // After the fix: rawPostedNet["standard"] is split proportionally by per-CN doc base;
  //   postedRemainderVat is applied to the standard portion for fil-exact VAT tracking.
  //
  // Initial:  std 36725 + rc 36725 = 73450 fils = AED 734.50; VAT 1836 fils = AED 18.36
  // Full CN:  GL = toBaseFils(20000, 3.6725) = 73450; rcGL = 36725, stdGL = 36725 (exact split)
  // Net:      Box 1 = 0, VAT = 0
  const t = await h.createTenant({
    companyColumns: {
      emirate: "dubai",
      trn_vat_number: "100000000000007",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
  const vatPeriod = { periodStart: "2026-01-01", periodEnd: "2026-03-31" };
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Mixed LLC",
    date,
    placeOfSupplyEmirate: "dubai",
    currency: "USD",
    exchangeRate: 3.6725,
    lines: [
      { description: "Standard services", quantity: 1, unitPrice: 100, vatRate: 5 },
      {
        description: "RC services",
        quantity: 1,
        unitPrice: 100,
        vatRate: 0,
        vatSupplyType: "reverse_charge",
      },
    ],
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);

  // Initial state: standard AED 367.25 + RC AED 367.25 = Box 1 AED 734.50; VAT AED 18.36.
  {
    const vatInit = await t.as.post(`${base(t)}/vat-returns/generate`, vatPeriod);
    expect(vatInit.status, vatInit.text).toBe(201);
    expect(Number(vatInit.body.box1bDubaiAmount), "Box 1 initial").toBe(734.5);
    expect(Number(vatInit.body.box1bDubaiVat), "Box 1 VAT initial").toBe(18.36);
  }

  const cn = await t.as.post(`${base(t)}/invoices/${draft.body.id}/credit-note`, { date });
  expect(cn.status, cn.text).toBe(201);

  // After full credit: Box 1 amount = 0, Box 1 VAT = 0.
  {
    const vatFinal = await t.as.post(`${base(t)}/vat-returns/generate`, vatPeriod);
    expect(vatFinal.status, vatFinal.text).toBe(201);
    expect(Number(vatFinal.body.box1bDubaiAmount), "Box 1 = 0 after full credit").toBe(0);
    expect(Number(vatFinal.body.box1bDubaiVat), "Box 1 VAT = 0 after full credit").toBe(0);
  }
});

it("I: mixed standard + explicit RC — split credits tie Box 1 amount and VAT to the fil", async () => {
  // Sol review 6088011118 repro: USD 200 standard (5%) + USD 700 reverse_charge (0%) at 3.6725.
  // Both lines post to 4020. rawPostedNet["standard"] bundles AED (200+700)×3.6725 = AED 3,305.25.
  //
  // Without the proportional split, discarding rawPostedNet["standard"] forces both families to
  // fall back to doc fils. The final credit's doc fils sum to AED 1,652.63 (36725+128538) but the
  // GL cleared only AED 1,652.62 — leaving Box 1 at -AED 0.01. VAT is also off by AED 0.01
  // because two equal USD 5 payments round to AED 18.36 each (total 36.72) but the invoice was
  // AED 36.73.
  //
  // With proportional split:
  //   CN1 (USD 100 std + USD 350 RC): GL = toBaseFils(45000, 3.6725) = 165263 (exact at .5)
  //     rcGL = round(165263×128538/165263) = 128538; stdGL = 36725. Sum = 165263 ✓
  //   CN2 (remainder):                GL remaining = 330525 − 165263 = 165262
  //     rcGL = round(165262×128538/165263) = 128537; stdGL = 36725. Sum = 165262 ✓
  //   Net: (73450+257075) − (36725+128538) − (36725+128537) = 330525−165263−165262 = 0 ✓
  //   VAT: postedRemainderVat for CN1 = 1836 fils; CN2 = 3673−1836 = 1837 fils. Net = 0 ✓
  const t = await h.createTenant({
    companyColumns: {
      emirate: "dubai",
      trn_vat_number: "100000000000008",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
  const vatPeriod = { periodStart: "2026-01-01", periodEnd: "2026-03-31" };
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Mixed Split LLC",
    date,
    placeOfSupplyEmirate: "dubai",
    currency: "USD",
    exchangeRate: 3.6725,
    lines: [
      { description: "Standard services", quantity: 1, unitPrice: 200, vatRate: 5 },
      {
        description: "RC services",
        quantity: 1,
        unitPrice: 700,
        vatRate: 0,
        vatSupplyType: "reverse_charge",
      },
    ],
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);

  const url = `${base(t)}/invoices/${draft.body.id}/credit-note`;

  // Initial: std 73450 + rc 257075 = AED 3,305.25; VAT 3673 fils = AED 36.73.
  {
    const vatInit = await t.as.post(`${base(t)}/vat-returns/generate`, vatPeriod);
    expect(vatInit.status, vatInit.text).toBe(201);
    expect(Number(vatInit.body.box1bDubaiAmount), "Box 1 initial").toBe(3305.25);
    expect(Number(vatInit.body.box1bDubaiVat), "Box 1 VAT initial").toBe(36.73);
  }

  // Partial credit: USD 100 standard + USD 350 RC.
  const cn1 = await t.as.post(url, {
    date,
    lines: [
      { description: "Standard services", quantity: 1, unitPrice: 100, vatRate: 5 },
      {
        description: "RC services",
        quantity: 1,
        unitPrice: 350,
        vatRate: 0,
        vatSupplyType: "reverse_charge",
      },
    ],
  });
  expect(cn1.status, cn1.text).toBe(201);

  // After CN1: GL cleared 165263 fils (exact). Net Box 1 = 330525−165263 = 165262 = AED 1,652.62.
  // VAT: postedRemainderVat for CN1 = 1836 fils. Net VAT = 3673−1836 = 1837 fils = AED 18.37.
  {
    const vatMid = await t.as.post(`${base(t)}/vat-returns/generate`, vatPeriod);
    expect(vatMid.status, vatMid.text).toBe(201);
    expect(Number(vatMid.body.box1bDubaiAmount), "Box 1 after CN1").toBe(1652.62);
    expect(Number(vatMid.body.box1bDubaiVat), "Box 1 VAT after CN1").toBe(18.37);
  }

  // Final credit: remainder (USD 100 standard + USD 350 RC).
  const cn2 = await t.as.post(url, { date });
  expect(cn2.status, cn2.text).toBe(201);

  // After CN2: GL cleared 165262 fils (1 fil less than CN1 due to rounding at .5).
  // Proportional split absorbs the 1-fil difference. Net Box 1 = 0, Net VAT = 0.
  {
    const vatFinal = await t.as.post(`${base(t)}/vat-returns/generate`, vatPeriod);
    expect(vatFinal.status, vatFinal.text).toBe(201);
    expect(Number(vatFinal.body.box1bDubaiAmount), "Box 1 = 0 after final credit").toBe(0);
    expect(Number(vatFinal.body.box1bDubaiVat), "Box 1 VAT = 0 after final credit").toBe(0);
  }
});

it("J: mixed standard + explicit RC — odd-cent split credits tie Box 1 to the fil (Sol repro)", async () => {
  // Sol review 6088308905 exact repro: USD 200 standard (5%) + USD 700 reverse_charge (0%) at 3.6725.
  // Per-family toBaseFils would drift per CN (sum 88148 vs GL 88147 for CN1), leaving Box 1
  // at -AED 0.01 after the final credit. The invoice combined-rounding fix and proportional CN
  // split ensure Box 1 == GL remaining to the fil at every checkpoint.
  //
  // GL: invoice = toBase(90000, 3.6725) = 330525 fils = AED 3,305.25
  // CN1 (40.01+200.01): rawPostedNet = toBase(24002) = 88147; rcGL=73453, stdGL=14694; net=242378
  // CN2 (30+200):       rawPostedNet = toBase(23000) = 84468; rcGL=73450, stdGL=11018; net=157910
  // CN3 (remainder):    rawPostedNet = 157910; net=0
  // VAT: invoice 3673 fils; CN1 735 fils (AED 7.35×5 on 200 fils); CN2 551; CN3 2387. Net=0.
  const t = await h.createTenant({
    companyColumns: {
      emirate: "dubai",
      trn_vat_number: "100000000000009",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
  const vatPeriod = { periodStart: "2026-01-01", periodEnd: "2026-03-31" };
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Odd Cent LLC",
    date,
    placeOfSupplyEmirate: "dubai",
    currency: "USD",
    exchangeRate: 3.6725,
    lines: [
      { description: "Standard services", quantity: 1, unitPrice: 200, vatRate: 5 },
      {
        description: "RC services",
        quantity: 1,
        unitPrice: 700,
        vatRate: 0,
        vatSupplyType: "reverse_charge",
      },
    ],
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);

  const url = `${base(t)}/invoices/${draft.body.id}/credit-note`;

  // Initial: std 73450 + rc 257075 = AED 3,305.25; VAT 3673 fils = AED 36.73.
  {
    const vatInit = await t.as.post(`${base(t)}/vat-returns/generate`, vatPeriod);
    expect(vatInit.status, vatInit.text).toBe(201);
    expect(Number(vatInit.body.box1bDubaiAmount), "Box 1 initial").toBe(3305.25);
    expect(Number(vatInit.body.box1bDubaiVat), "Box 1 VAT initial").toBe(36.73);
  }

  // CN1: USD 40.01 standard + USD 200.01 RC. Per-family fils sum = 88148 but GL = 88147.
  const cn1 = await t.as.post(url, {
    date,
    lines: [
      { description: "Standard services", quantity: 1, unitPrice: 40.01, vatRate: 5 },
      {
        description: "RC services",
        quantity: 1,
        unitPrice: 200.01,
        vatRate: 0,
        vatSupplyType: "reverse_charge",
      },
    ],
  });
  expect(cn1.status, cn1.text).toBe(201);

  // After CN1: GL cleared 88147; Box 1 = 330525-88147 = 242378 = AED 2,423.78.
  // VAT: CN1 posted VAT = toBase(200, 3.6725) = 735 fils; net = 3673-735 = 2938 = AED 29.38.
  {
    const vatMid1 = await t.as.post(`${base(t)}/vat-returns/generate`, vatPeriod);
    expect(vatMid1.status, vatMid1.text).toBe(201);
    expect(Number(vatMid1.body.box1bDubaiAmount), "Box 1 after CN1").toBe(2423.78);
    expect(Number(vatMid1.body.box1bDubaiVat), "Box 1 VAT after CN1").toBe(29.38);
  }

  // CN2: USD 30 standard + USD 200 RC.
  const cn2 = await t.as.post(url, {
    date,
    lines: [
      { description: "Standard services", quantity: 1, unitPrice: 30, vatRate: 5 },
      {
        description: "RC services",
        quantity: 1,
        unitPrice: 200,
        vatRate: 0,
        vatSupplyType: "reverse_charge",
      },
    ],
  });
  expect(cn2.status, cn2.text).toBe(201);

  // After CN2: GL cleared 84468; Box 1 = 242378-84468 = 157910 = AED 1,579.10.
  // VAT: CN2 posted VAT = toBase(150, 3.6725) = 551 fils; net = 2938-551 = 2387 = AED 23.87.
  {
    const vatMid2 = await t.as.post(`${base(t)}/vat-returns/generate`, vatPeriod);
    expect(vatMid2.status, vatMid2.text).toBe(201);
    expect(Number(vatMid2.body.box1bDubaiAmount), "Box 1 after CN2").toBe(1579.1);
    expect(Number(vatMid2.body.box1bDubaiVat), "Box 1 VAT after CN2").toBe(23.87);
  }

  // CN3: remainder.
  const cn3 = await t.as.post(url, { date });
  expect(cn3.status, cn3.text).toBe(201);

  // After CN3: 0/0.
  {
    const vatFinal = await t.as.post(`${base(t)}/vat-returns/generate`, vatPeriod);
    expect(vatFinal.status, vatFinal.text).toBe(201);
    expect(Number(vatFinal.body.box1bDubaiAmount), "Box 1 = 0 after final credit").toBe(0);
    expect(Number(vatFinal.body.box1bDubaiVat), "Box 1 VAT = 0 after final credit").toBe(0);
  }
});

it("K: mixed standard + explicit RC at 3.6725 — per-family rounding diverges from GL, full credit leaves 0", async () => {
  // USD 100.01 standard (5%) + USD 100.01 reverse_charge (0%) at 3.6725.
  // Per-family: toBaseFils(10001)+toBaseFils(10001) = 36729+36729 = 73458 fils.
  // Combined GL: toBase(20002, 3.6725) = Decimal(73457.345).toDP(0, ROUND_HALF_UP) = 73457 fils.
  // Without the invoice combined-rounding fix, the 1-fil gap leaves Box 1 at +AED 0.01 after
  // the full credit. With the fix, invoice Box 1 = 73457 and the full CN clears 73457 → net 0.
  const t = await h.createTenant({
    companyColumns: {
      emirate: "dubai",
      trn_vat_number: "100000000000010",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
  const vatPeriod = { periodStart: "2026-01-01", periodEnd: "2026-03-31" };
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Odd Cent Full LLC",
    date,
    placeOfSupplyEmirate: "dubai",
    currency: "USD",
    exchangeRate: 3.6725,
    lines: [
      { description: "Standard services", quantity: 1, unitPrice: 100.01, vatRate: 5 },
      {
        description: "RC services",
        quantity: 1,
        unitPrice: 100.01,
        vatRate: 0,
        vatSupplyType: "reverse_charge",
      },
    ],
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);

  // Initial: combined 73457 fils = AED 734.57; VAT toBase(500, 3.6725) = 1836 fils = AED 18.36.
  {
    const vatInit = await t.as.post(`${base(t)}/vat-returns/generate`, vatPeriod);
    expect(vatInit.status, vatInit.text).toBe(201);
    expect(Number(vatInit.body.box1bDubaiAmount), "Box 1 initial").toBe(734.57);
    expect(Number(vatInit.body.box1bDubaiVat), "Box 1 VAT initial").toBe(18.36);
  }

  // Full credit note (remaining).
  const cn = await t.as.post(
    `${base(t)}/invoices/${draft.body.id}/credit-note`,
    { date }
  );
  expect(cn.status, cn.text).toBe(201);

  // After full credit: 0/0 — no residual fil.
  {
    const vatFinal = await t.as.post(`${base(t)}/vat-returns/generate`, vatPeriod);
    expect(vatFinal.status, vatFinal.text).toBe(201);
    expect(Number(vatFinal.body.box1bDubaiAmount), "Box 1 = 0 after full credit").toBe(0);
    expect(Number(vatFinal.body.box1bDubaiVat), "Box 1 VAT = 0 after full credit").toBe(0);
  }
});
