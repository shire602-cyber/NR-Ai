/**
 * A1 accounting audit (VAT), on the real app + Postgres. Every scenario posts through the API
 * and asserts the exact journal lines and VAT 201 box figures.
 *   C1  a submitted / filed VAT return closes its period for VAT-affecting postings
 *   C2  supplier debit notes follow the original bill's VAT treatment (blocked, reverse charge)
 *   C6  partial exemption: direct attribution, standard-method apportionment, GL posting
 *   H7  VAT on bank-line expenses in Box 9's ordinary columns, not "Adjustments"
 *   M7  Box 6 = customs value + duty from the import declaration
 *   M8  exempt interest created from a bank line lands in Box 5
 *   M9  a standard-rated asset disposal needs the company emirate
 * Companies set TRN + emirate explicitly (VAT-registered fixture).
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";

async function vatTenant(columns: Record<string, unknown> = {}) {
  return h.createTenant({
    companyColumns: {
      trn_vat_number: TRN,
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
      ...columns,
    },
  });
}

const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function invoice(t: Tenant, date: string, lines: Array<Record<string, unknown>>) {
  const c = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme LLC",
    customerTrn: "100000000000011",
    date,
    placeOfSupplyEmirate: "dubai",
    lines,
  });
  expect(c.status, c.text).toBe(200);
  return c.body as { id: string; number: string };
}

async function issue(id: string, t: Tenant) {
  return t.as.patch(`/api/invoices/${id}/status`, { status: "sent" });
}

async function bill(t: Tenant, over: Record<string, unknown>) {
  const b = await t.as.post(`${base(t)}/bills`, {
    vendor_name: "Supplier LLC",
    vendor_trn: "100000000000029",
    bill_number: `B-${Math.random().toString(36).slice(2, 8)}`,
    due_date: "2026-12-31",
    ...over,
  });
  expect(b.status, b.text).toBe(200);
  return b.body as { id: string };
}

async function approve(t: Tenant, id: string) {
  return t.as.post(`/api/bills/${id}/approve`, {});
}

async function vat(t: Tenant, from: string, to: string) {
  const r = await t.as.get(`${base(t)}/reports/vat-return?from=${from}&to=${to}`);
  expect(r.status, r.text).toBe(200);
  return r.body as { boxes: Record<string, number>; reconciliation: any; partialExemption?: any };
}

async function compute(t: Tenant, from: string, to: string) {
  const r = await t.as.get(`${base(t)}/vat/compute?from=${from}&to=${to}`);
  expect(r.status, r.text).toBe(200);
  return r.body;
}

/** Journal lines of one source document as [code, debit, credit] (AED), sorted. */
async function linesOf(companyId: string, source: string, sourceId?: string) {
  const rows = await h.sql<{ code: string; debit: string; credit: string }>(
    `SELECT a.code, SUM(jl.debit)::text AS debit, SUM(jl.credit)::text AS credit
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = $2 AND ($3::uuid IS NULL OR je.source_id = $3::uuid)
        AND je.status = 'posted'
      GROUP BY a.code ORDER BY a.code`,
    [companyId, source, sourceId ?? null]
  );
  return rows.map((r) => [r.code, Number(r.debit), Number(r.credit)]);
}

async function fileReturn(t: Tenant, periodStart: string, periodEnd: string) {
  const gen = await t.as.post(`${base(t)}/vat-returns/generate`, { periodStart, periodEnd });
  expect(gen.status, gen.text).toBe(201);
  const sub = await t.as.post(`/api/vat-returns/${gen.body.id}/submit`, {
    ftaReferenceNumber: "FTA-123",
  });
  expect(sub.status, sub.text).toBe(200);
  expect(sub.body.status).toBe("filed");
  return gen.body as { id: string };
}

describe("A1 C1: a filed VAT return locks its period for VAT-affecting postings", () => {
  it("[C1] a back-dated invoice into a filed quarter is refused with 409 and the correction paths; the next period and the voluntary-disclosure path work", async () => {
    const t = await vatTenant();
    const q1 = await invoice(t, "2026-02-01", [
      { description: "Job", quantity: 1, unitPrice: 2000, vatRate: 5 },
    ]);
    expect((await issue(q1.id, t)).status).toBe(200);
    const filed = await fileReturn(t, "2026-01-01", "2026-03-31");

    // A draft dated in the filed period is fine (it reports nothing); issuing it is refused.
    const late = await invoice(t, "2026-02-15", [
      { description: "Late job", quantity: 1, unitPrice: 1000, vatRate: 5 },
    ]);
    const refused = await issue(late.id, t);
    expect(refused.status, refused.text).toBe(409);
    expect(refused.body.code).toBe("VAT_PERIOD_FILED");
    expect(refused.body.message).toContain("Art. 70");
    const details = refused.body.details ?? refused.body;
    expect(JSON.stringify(details)).toContain("2026-04-01");
    expect(JSON.stringify(details)).toContain(`/api/vat-returns/${filed.id}/amend`);
    const inv = await h.sql<{ status: string }>(`SELECT status FROM invoices WHERE id = $1`, [
      late.id,
    ]);
    expect(inv[0].status).toBe("draft");

    // The filed quarter still computes what was filed.
    const q1Now = await compute(t, "2026-01-01", "2026-03-31");
    expect(q1Now.boxes.box1bDubaiAmount).toBe(2000);
    expect(q1Now.boxes.box1bDubaiVat).toBe(100);

    // A bill dated in the filed quarter cannot be approved either (input VAT, Box 9).
    const b = await bill(t, {
      bill_date: "2026-03-10",
      line_items: [{ description: "Supplies", quantity: 1, unit_price: 400, vat_rate: 5 }],
    });
    const ap = await approve(t, b.id);
    expect(ap.status, ap.text).toBe(409);
    expect(ap.body.code).toBe("VAT_PERIOD_FILED");

    // Voiding the filed-period invoice would change the filed return: refused too.
    const voided = await t.as.patch(`/api/invoices/${q1.id}/status`, { status: "void" });
    expect(voided.status, voided.text).toBe(409);
    expect(voided.body.code).toBe("VAT_PERIOD_FILED");

    // Correction path 1: date it in the open period; it is in the next return.
    const fixed = await invoice(t, "2026-04-10", [
      { description: "Late job (corrected)", quantity: 1, unitPrice: 1000, vatRate: 5 },
    ]);
    expect((await issue(fixed.id, t)).status).toBe(200);
    expect((await compute(t, "2026-04-01", "2026-06-30")).boxes.box1bDubaiVat).toBe(50);

    // Correction path 2: voluntary disclosure. The amendment draft re-opens the period.
    const amend = await t.as.post(`/api/vat-returns/${filed.id}/amend`, {
      reason: "Invoice of 15 Feb was missed",
    });
    expect(amend.status, amend.text).toBe(201);
    expect((await issue(late.id, t)).status).toBe(200);
    const regen = await t.as.post(`${base(t)}/vat-returns/generate`, {
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    });
    expect(regen.status, regen.text).toBe(201);
    expect(regen.body.id).toBe(amend.body.id);
    expect(regen.body.box1bDubaiVat).toBe(150);
    const diff = regen.body.amendmentDiff.boxes.find(
      (d: { box: string }) => d.box === "box1bDubaiVat"
    );
    expect(diff).toEqual({ box: "box1bDubaiVat", previous: 100, amended: 150, difference: 50 });
    expect(regen.body.amendmentDiff.netChange).toBe(50);

    // Payments carry no VAT: a receipt dated in a filed period is still allowed.
    const bank = await accountByCode(t, "1020");
    const pay = await t.as.post(`${base(t)}/invoices/${q1.id}/payments`, {
      amount: 2100,
      date: "2026-03-20",
      method: "bank_transfer",
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBeLessThan(300);
  });
});

describe("A1 C2: supplier debit notes follow the bill's VAT treatment", () => {
  it("[C2] blocked-VAT car bill: no input VAT reversed; reverse-charge bill: Box 3 and Box 10 fall, A/P falls by the net only", async () => {
    const t = await vatTenant();
    const asset = await accountByCode(t, "1210");
    const marketing = await accountByCode(t, "5060");
    const car = await bill(t, {
      bill_date: "2026-10-05",
      category: "motor vehicle personal",
      line_items: [
        {
          description: "Saloon car",
          quantity: 1,
          unit_price: 80000,
          vat_rate: 5,
          account_id: asset.id,
        },
      ],
    });
    expect((await approve(t, car.id)).status).toBe(200);
    expect(await linesOf(t.company.id, "bill", car.id)).toEqual([
      ["1210", 84000, 0],
      ["2010", 0, 84000],
    ]);
    const google = await bill(t, {
      vendor_name: "Google Ireland",
      vendor_trn: null,
      bill_date: "2026-10-06",
      reverse_charge: true,
      line_items: [
        {
          description: "Ads",
          quantity: 1,
          unit_price: 2000,
          vat_rate: 5,
          account_id: marketing.id,
        },
      ],
    });
    expect((await approve(t, google.id)).status).toBe(200);
    expect(await linesOf(t.company.id, "bill", google.id)).toEqual([
      ["1050", 100, 0],
      ["2010", 0, 2000],
      ["2020", 0, 100],
      ["5060", 2000, 0],
    ]);

    const dn1 = await t.as.post(`${base(t)}/debit-notes`, {
      bill_id: car.id,
      note_date: "2026-10-20",
      reason: "Price reduction",
      lines: [{ description: "Discount", amount: 1000, vat_rate: 5, account_id: asset.id }],
    });
    expect(dn1.status, dn1.text).toBeLessThan(300);
    expect(await linesOf(t.company.id, "vendor_debit_note", dn1.body.id)).toEqual([
      ["1210", 0, 1050],
      ["2010", 1050, 0],
    ]);
    const dn2 = await t.as.post(`${base(t)}/debit-notes`, {
      bill_id: google.id,
      note_date: "2026-10-21",
      reason: "Credit for invalid clicks",
      lines: [{ description: "Credit", amount: 200, vat_rate: 5, account_id: marketing.id }],
    });
    expect(dn2.status, dn2.text).toBeLessThan(300);
    expect(await linesOf(t.company.id, "vendor_debit_note", dn2.body.id)).toEqual([
      ["1050", 0, 10],
      ["2010", 200, 0],
      ["2020", 10, 0],
      ["5060", 0, 200],
    ]);
    const note = await h.sql<{ total_amount: string; vat_treatment: string }>(
      `SELECT total_amount::text, vat_treatment FROM vendor_debit_notes WHERE id = $1`,
      [dn2.body.id]
    );
    expect(note[0]).toEqual({ total_amount: "200.00", vat_treatment: "reverse_charge" });

    const r = await vat(t, "2026-10-01", "2026-12-31");
    expect(r.boxes).toMatchObject({
      box3ReverseChargeAmount: 1800,
      box3ReverseChargeVat: 90,
      box9ExpensesAmount: 0,
      box9ExpensesVat: 0,
      box10ReverseChargeAmount: 1800,
      box10ReverseChargeVat: 90,
      box14PayableTax: 0,
    });
    expect(r.reconciliation.hasUnexplainedDifference).toBe(false);
  });
});

describe("A1 H7 / M8: VAT on entries created from bank lines", () => {
  it("[H7][M8] a VAT-inclusive bank fee lands in Box 9's amount and VAT columns; exempt interest in Box 5", async () => {
    const t = await vatTenant();
    const ba = await t.as.post(`${base(t)}/bank-accounts`, {
      nameEn: "Main current",
      bankName: "Emirates NBD",
      currency: "AED",
    });
    expect(ba.status, ba.text).toBe(201);
    const csv = [
      "Date,Description,Debit,Credit",
      "2026-10-05,BANK FEE,26.25,",
      "2026-10-06,INTEREST CREDIT,,12.50",
    ].join("\n");
    const imp = await t.as.post(`${base(t)}/bank-statements/import`, {
      bankAccountId: ba.body.id,
      csvContent: csv,
      acknowledgeAmbiguity: true,
    });
    expect(imp.status, imp.text).toBe(201);
    const txns = await t.as.get(
      `${base(t)}/bank-statements/transactions?bankAccountId=${ba.body.id}`
    );
    const fee = txns.body.find((l: { description: string }) => l.description === "BANK FEE");
    const interest = txns.body.find(
      (l: { description: string }) => l.description === "INTEREST CREDIT"
    );
    const feeAcc = await accountByCode(t, "5110");
    const other = await t.as.post(`${base(t)}/accounts`, {
      code: "4045",
      nameEn: "Interest income",
      nameAr: "إيرادات الفوائد",
      type: "income",
    });
    const incomeId = other.status < 300 ? other.body.id : (await accountByCode(t, "4010")).id;
    const e1 = await t.as.post(`${base(t)}/bank-statements/${fee.id}/create-entry`, {
      accountId: feeAcc.id,
      vatTreatment: "standard",
    });
    expect(e1.status, e1.text).toBe(201);
    const e2 = await t.as.post(`${base(t)}/bank-statements/${interest.id}/create-entry`, {
      accountId: incomeId,
      vatTreatment: "exempt",
    });
    expect(e2.status, e2.text).toBe(201);
    const r = await vat(t, "2026-10-01", "2026-12-31");
    expect(r.boxes).toMatchObject({
      box9ExpensesAmount: 25,
      box9ExpensesVat: 1.25,
      box9ExpensesAdj: 0,
      box5ExemptAmount: 12.5,
      box13RecoverableTax: 1.25,
    });
    expect(r.reconciliation.hasUnexplainedDifference).toBe(false);

    // Unmatching the fee takes it back out of the return.
    const un = await t.as.delete(`${base(t)}/bank-statements/${fee.id}/match`);
    expect(un.status, un.text).toBeLessThan(300);
    const after = await vat(t, "2026-10-01", "2026-12-31");
    expect(after.boxes.box9ExpensesVat).toBe(0);
    expect(after.boxes.box9ExpensesAdj).toBe(0);
  });
});

describe("A1 M7: Box 6 import value", () => {
  it("[M7] Box 6 reports the customs value incl. duty; without it, the value implied by the import VAT", async () => {
    const t = await vatTenant();
    const declared = await bill(t, {
      vendor_name: "Overseas Goods Co",
      vendor_trn: null,
      bill_date: "2026-10-08",
      is_import: true,
      customs_declaration_no: "CD-1",
      import_vat_amount: 525,
      customs_value: 10000,
      customs_duty_amount: 500,
      line_items: [{ description: "Goods", quantity: 1, unit_price: 10000, vat_rate: 5 }],
    });
    expect((await approve(t, declared.id)).status).toBe(200);
    const implied = await bill(t, {
      vendor_name: "Overseas Goods Co",
      vendor_trn: null,
      bill_date: "2026-10-09",
      is_import: true,
      customs_declaration_no: "CD-2",
      import_vat_amount: 105,
      line_items: [{ description: "Goods", quantity: 1, unit_price: 2000, vat_rate: 5 }],
    });
    expect((await approve(t, implied.id)).status).toBe(200);
    const r = await vat(t, "2026-10-01", "2026-12-31");
    expect(r.boxes).toMatchObject({
      box6ImportsAmount: 12600,
      box6ImportsVat: 630,
      box10ReverseChargeAmount: 12600,
      box10ReverseChargeVat: 630,
    });
    expect(r.reconciliation.hasUnexplainedDifference).toBe(false);
  });
});

describe("A1 M9: asset disposal needs the company emirate", () => {
  it("[M9] a standard-rated disposal without a company emirate is refused with a clear 422; with one it reaches Box 1", async () => {
    const t = await vatTenant({ emirate: null });
    const bank = await accountByCode(t, "1020");
    const a = await t.as.post(`${base(t)}/fixed-assets`, {
      assetName: "Server",
      category: "Computer Equipment",
      purchaseDate: "2026-01-15",
      purchaseCost: 36000,
      usefulLifeYears: 3,
      paymentAccountId: bank.id,
    });
    expect(a.status, a.text).toBe(201);
    const refused = await t.as.post(`/api/fixed-assets/${a.body.id}/dispose`, {
      disposalDate: "2026-10-10",
      disposalAmount: 20000,
      proceedsAccountId: bank.id,
    });
    expect(refused.status, refused.text).toBe(422);
    expect(refused.body.code).toBe("COMPANY_EMIRATE_REQUIRED");
    await h.sql(`UPDATE companies SET emirate = 'abu_dhabi' WHERE id = $1`, [t.company.id]);
    const ok = await t.as.post(`/api/fixed-assets/${a.body.id}/dispose`, {
      disposalDate: "2026-10-10",
      disposalAmount: 20000,
      proceedsAccountId: bank.id,
    });
    expect(ok.status, ok.text).toBe(200);
    const r = await vat(t, "2026-10-01", "2026-12-31");
    expect(r.boxes.box1aAbuDhabiAmount).toBe(20000);
    expect(r.boxes.box1aAbuDhabiVat).toBe(1000);
  });
});

describe("A1 C6: partial exemption (Exec. Reg. Art. 55)", () => {
  it("[C6] direct attribution first, residual apportioned by the period's standard ratio, irrecoverable VAT posted to GL at ready", async () => {
    const t = await vatTenant({ partial_exemption_enabled: true });
    // Supplies: 8,000 standard + 2,000 exempt. Input attribution determines the recovery rate.
    const s = await invoice(t, "2026-07-10", [
      { description: "Consulting", quantity: 1, unitPrice: 8000, vatRate: 5 },
      {
        description: "Residential rent",
        quantity: 1,
        unitPrice: 2000,
        vatRate: 0,
        vatSupplyType: "exempt",
      },
    ]);
    expect((await issue(s.id, t)).status).toBe(200);
    const line = (price: number) => [
      { description: "Purchase", quantity: 1, unit_price: price, vat_rate: 5 },
    ];
    // Wholly taxable: 1,000 + 50 recovered in full.
    const b1 = await bill(t, {
      bill_date: "2026-07-11",
      input_vat_attribution: "taxable",
      line_items: line(1000),
    });
    // Wholly exempt: 400 + 20 not recoverable.
    const b2 = await bill(t, {
      bill_date: "2026-07-12",
      input_vat_attribution: "exempt",
      line_items: line(400),
    });
    // Residual VAT: 100 × round(50 / (50 + 20) × 100)% = 71.
    const b3 = await bill(t, { bill_date: "2026-07-13", line_items: line(2000) });
    for (const b of [b1, b2, b3]) expect((await approve(t, b.id)).status).toBe(200);

    const c = await compute(t, "2026-07-01", "2026-09-30");
    expect(c.boxes.box9ExpensesVat).toBe(121); // 50 + 0 + 71
    expect(c.boxes.box13RecoverableTax).toBe(121);
    expect(c.partialExemption).toMatchObject({
      enabled: true,
      method: "standard",
      recoverableRatio: 0.71,
      grossInputVatFils: 17_000,
      directTaxableFils: 5_000,
      directExemptFils: 2_000,
      residualFils: 10_000,
      apportionedFils: 4_900,
      postedFils: 0,
    });

    const gen = await t.as.post(`${base(t)}/vat-returns/generate`, {
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
    });
    expect(gen.status, gen.text).toBe(201);
    expect(gen.body.box9ExpensesVat).toBe(121);
    const ready = await t.as.post(`/api/vat-returns/${gen.body.id}/ready`, {});
    expect(ready.status, ready.text).toBe(200);
    // Dr 5160 irrecoverable input VAT 49 / Cr 1050 49, dated at period end.
    expect(await linesOf(t.company.id, "vat_partial_exemption")).toEqual([
      ["1050", 0, 49],
      ["5160", 49, 0],
    ]);
    const after = await vat(t, "2026-07-01", "2026-09-30");
    expect(after.boxes.box9ExpensesVat).toBe(121);
    expect(after.reconciliation.hasUnexplainedDifference).toBe(false);
    // Readiness is idempotent: nothing more is posted.
    const sub = await t.as.post(`/api/vat-returns/${gen.body.id}/submit`, {});
    expect(sub.status, sub.text).toBe(200);
    expect(await linesOf(t.company.id, "vat_partial_exemption")).toEqual([
      ["1050", 0, 49],
      ["5160", 49, 0],
    ]);
  });

  it("[C6] partial exemption off: exempt supplies only raise an advisory, input VAT is recovered in full", async () => {
    const t = await vatTenant();
    const s = await invoice(t, "2026-07-10", [
      { description: "Rent", quantity: 1, unitPrice: 2000, vatRate: 0, vatSupplyType: "exempt" },
    ]);
    expect((await issue(s.id, t)).status).toBe(200);
    const b = await bill(t, {
      bill_date: "2026-07-13",
      line_items: [{ description: "Purchase", quantity: 1, unit_price: 2000, vat_rate: 5 }],
    });
    expect((await approve(t, b.id)).status).toBe(200);
    const c = await compute(t, "2026-07-01", "2026-09-30");
    expect(c.boxes.box9ExpensesVat).toBe(100);
    expect(c.partialExemption.advisory).toBe("PARTIAL_EXEMPTION_NOT_ENABLED");
  });

  it("[C6] group submission apportions input VAT in the enabled member's books and rolls back on stale figures", async () => {
    const representative = await vatTenant({ partial_exemption_enabled: false });
    const member = await vatTenant({
      trn_vat_number: "100000000000037",
      partial_exemption_enabled: true,
      exempt_supply_ratio: 0.2,
    });
    await h.sql("INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')", [
      member.company.id,
      representative.user.id,
    ]);
    const group = await representative.as.put(`${base(representative)}/vat/group`, {
      name: "Partial exemption group",
      groupTrn: "100000000000053",
      memberCompanyIds: [member.company.id],
    });
    expect(group.status, group.text).toBe(200);

    const representativeSale = await invoice(representative, "2026-07-10", [
      { description: "Consulting", quantity: 1, unitPrice: 2000, vatRate: 5 },
    ]);
    expect((await issue(representativeSale.id, representative)).status).toBe(200);
    const memberSale = await invoice(member, "2026-07-10", [
      { description: "Consulting", quantity: 1, unitPrice: 8000, vatRate: 5 },
      {
        description: "Residential rent",
        quantity: 1,
        unitPrice: 2000,
        vatRate: 0,
        vatSupplyType: "exempt",
      },
    ]);
    expect((await issue(memberSale.id, member)).status).toBe(200);
    for (const [tenant, amount] of [
      [representative, 1000],
      [member, 2000],
    ] as const) {
      const purchase = await bill(tenant, {
        bill_date: "2026-07-13",
        line_items: [{ description: "Overhead", quantity: 1, unit_price: amount, vat_rate: 5 }],
      });
      const approved = await approve(representative, purchase.id);
      expect(approved.status, approved.text).toBe(200);
    }

    const generate = () =>
      representative.as.post(`${base(representative)}/vat-returns/generate`, {
        periodStart: "2026-07-01",
        periodEnd: "2026-09-30",
      });
    const draft = await generate();
    expect(draft.status, draft.text).toBe(201);
    expect(draft.body).toMatchObject({
      box12TotalDueTax: 500,
      box13RecoverableTax: 130,
      box14PayableTax: 370,
    });
    const submit = () => representative.as.post(`/api/vat-returns/${draft.body.id}/submit`, {});
    const memberApportionment = () =>
      linesOf(member.company.id, "vat_partial_exemption", draft.body.id);

    const lateSale = await invoice(representative, "2026-07-20", [
      { description: "Late consulting invoice", quantity: 1, unitPrice: 1000, vatRate: 5 },
    ]);
    expect((await issue(lateSale.id, representative)).status).toBe(200);
    const stale = await submit();
    expect(stale.status, stale.text).toBe(409);
    expect(stale.body.code).toBe("VAT_RETURN_STALE");
    expect(await memberApportionment()).toEqual([]);
    expect(await h.sql("SELECT status FROM vat_returns WHERE id = $1", [draft.body.id])).toEqual([
      { status: "draft" },
    ]);

    const regenerated = await generate();
    expect(regenerated.status, regenerated.text).toBe(201);
    expect(regenerated.body.id).toBe(draft.body.id);
    const submitted = await submit();
    expect(submitted.status, submitted.text).toBe(200);
    expect(await linesOf(representative.company.id, "vat_partial_exemption")).toEqual([]);
    expect(await memberApportionment()).toEqual([
      ["1050", 0, 20],
      ["5160", 20, 0],
    ]);
    expect(submitted.body).toMatchObject({
      status: "submitted",
      vatGroupId: group.body.id,
      box12TotalDueTax: 550,
      box13RecoverableTax: 130,
      box14PayableTax: 420,
      reconciliationSnapshot: {
        filingReconciliation: {
          hasUnexplainedDifference: false,
          ledgerInputVatFils: 13_000,
          members: expect.arrayContaining([
            expect.objectContaining({
              companyId: representative.company.id,
              ledgerInputBaseFils: 5_000,
            }),
            expect.objectContaining({ companyId: member.company.id, ledgerInputBaseFils: 8_000 }),
          ]),
        },
      },
    });
    const replay = await submit();
    expect(replay.status, replay.text).toBe(200);
    expect(replay.body.id).toBe(draft.body.id);
    expect(await memberApportionment()).toEqual([
      ["1050", 0, 20],
      ["5160", 20, 0],
    ]);
  });
});
