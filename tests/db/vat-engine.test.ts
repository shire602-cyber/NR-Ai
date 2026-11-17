/**
 * W4-E VAT engine on the real app + Postgres. Issue ids in test names:
 * R07-02 (emirate per supply), R07-03 (one engine), R07-07 (periods), R07-08 / R07-15
 * (boxes 2/6/7, bad-debt relief, amended returns, VAT group, FTA export), R07-10 (fils
 * rounding), R12-03 / R12-08b (VAT-to-GL reconciliation), R05-28 (blocked input VAT).
 */
import { describe, expect, it } from "vitest";
import { accountByCode, postJournalEntry, useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";
const Q3 = { periodStart: "2026-07-01", periodEnd: "2026-09-30" };

async function vatTenant(columns: Record<string, unknown> = {}) {
  return h.createTenant({
    companyColumns: {
      trn_vat_number: TRN,
      emirate: "sharjah",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
      ...columns,
    },
  });
}

async function issuedInvoice(
  t: Tenant,
  lines: Array<Record<string, unknown>>,
  over: Record<string, unknown> = {}
) {
  const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Acme LLC",
    date: "2026-08-10",
    lines,
    ...over,
  });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return c.body as { id: string; number: string };
}

async function approvedBill(t: Tenant, over: Record<string, unknown> = {}) {
  const b = await t.as.post(`/api/companies/${t.company.id}/bills`, {
    vendor_name: "Local Supplies LLC",
    vendor_trn: TRN,
    bill_number: `B-${Math.random().toString(36).slice(2, 8)}`,
    bill_date: "2026-08-12",
    due_date: "2026-09-12",
    line_items: [{ description: "Supplies", quantity: 1, unit_price: 400, vat_rate: 5 }],
    ...over,
  });
  expect(b.status, b.text).toBe(200);
  const a = await t.as.post(`/api/bills/${b.body.id}/approve`, {});
  expect(a.status, a.text).toBe(200);
  return a.body;
}

/** Report 07 scenario: Sharjah company, mixed invoice, local bill, USD reverse-charge bill. */
async function report07(t: Tenant) {
  await issuedInvoice(t, [
    { description: "Standard", quantity: 1, unitPrice: 1000, vatRate: 5 },
    { description: "Export", quantity: 1, unitPrice: 500, vatRate: 0, vatSupplyType: "zero_rated" },
    { description: "Rent", quantity: 1, unitPrice: 250, vatRate: 0, vatSupplyType: "exempt" },
    {
      description: "Abroad",
      quantity: 1,
      unitPrice: 100,
      vatRate: 0,
      vatSupplyType: "out_of_scope",
    },
  ]);
  await approvedBill(t);
  const r = await t.as.post(`/api/companies/${t.company.id}/exchange-rates`, {
    fromCurrency: "USD",
    rate: 3.6725,
    effectiveDate: "2026-08-01",
  });
  expect(r.status, r.text).toBeLessThan(300);
  await approvedBill(t, {
    vendor_name: "Foreign SaaS Inc",
    vendor_trn: null,
    currency: "USD",
    reverse_charge: true,
    bill_date: "2026-08-14",
    line_items: [{ description: "SaaS", quantity: 1, unit_price: 1000, vat_rate: 5 }],
  });
}

const EXPECTED_07 = {
  box1cSharjahAmount: 1000,
  box1cSharjahVat: 50,
  box1bDubaiAmount: 0,
  box4ZeroRatedAmount: 500,
  box5ExemptAmount: 250,
  box3ReverseChargeAmount: 3672.5,
  box3ReverseChargeVat: 183.63,
  box8TotalAmount: 5422.5,
  box8TotalVat: 233.63,
  box9ExpensesAmount: 400,
  box9ExpensesVat: 20,
  box10ReverseChargeAmount: 3672.5,
  box10ReverseChargeVat: 183.63,
  box11TotalVat: 203.63,
  box12TotalDueTax: 233.63,
  box13RecoverableTax: 203.63,
  box14PayableTax: 30,
};

describe("W4-E VAT engine: report 07 scenario", () => {
  it("[R07-03][R07-02][R07-10][R07-01] generate, autopilot and reports return identical boxes; out of scope is in no box", async () => {
    const t = await vatTenant();
    await report07(t);

    const gen = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, Q3);
    expect(gen.status, gen.text).toBe(201);
    expect(gen.body).toMatchObject(EXPECTED_07);
    expect(gen.body._metadata.excluded.outOfScopeAmount).toBe(100);
    expect(gen.body.dueDate.slice(0, 10)).toBe("2026-10-28");
    // R07-10: every stored box is exact to the fil and the totals add up.
    expect(gen.body.box8TotalVat).toBe(
      Math.round((gen.body.box1cSharjahVat + gen.body.box3ReverseChargeVat) * 100) / 100
    );

    const auto = await t.as.get(
      `/api/vat/autopilot/calculate/${t.company.id}?periodStart=2026-07-01&periodEnd=2026-09-30&persist=false`
    );
    expect(auto.status, auto.text).toBe(200);
    expect(auto.body.fullBoxes).toMatchObject(EXPECTED_07);
    expect(auto.body.vat201.box1cSharjahAmount).toBe(1000);
    expect(auto.body.boxes.netVatPayable).toBe(30);

    const rep = await t.as.get(
      `/api/companies/${t.company.id}/reports/vat-return?from=2026-07-01&to=2026-09-30`
    );
    expect(rep.status, rep.text).toBe(200);
    expect(rep.body.boxes).toMatchObject(EXPECTED_07);
    expect(rep.body.box8_netVatDue).toBe(30);

    const sum = await t.as.get(
      `/api/companies/${t.company.id}/reports/vat-summary?from=2026-07-01&to=2026-09-30`
    );
    expect(sum.status, sum.text).toBe(200);
    expect(sum.body.netVATPayable).toBe(30);
    expect(sum.body.salesVAT).toBe(233.63);

    // The ledger agrees: no unexplained difference (R12-08b).
    expect(gen.body._metadata.reconciliation.hasUnexplainedDifference).toBe(false);
    expect(gen.body._metadata.reconciliation.ledgerOutputVatFils).toBe(23_363);
    expect(gen.body._metadata.reconciliation.ledgerInputVatFils).toBe(20_363);

    // FTA portal-order export (preparation file; never a submission).
    const csv = await t.as.get(`/api/vat-returns/${gen.body.id}/export?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("1c,Amount");
    expect(csv.text).toContain("Not transmitted to the FTA");
    const xlsx = await t.as.get(`/api/vat-returns/${gen.body.id}/export`);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get("content-type")).toContain("spreadsheetml");
  });

  it("[R07-02] a Sharjah company's Dubai place-of-supply invoice lands in Box 1b", async () => {
    const t = await vatTenant();
    await issuedInvoice(
      t,
      [{ description: "Dubai job", quantity: 1, unitPrice: 2000, vatRate: 5 }],
      {
        placeOfSupplyEmirate: "dubai",
      }
    );
    await issuedInvoice(t, [{ description: "Local job", quantity: 1, unitPrice: 300, vatRate: 5 }]);
    const gen = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, Q3);
    expect(gen.status, gen.text).toBe(201);
    expect(gen.body.box1bDubaiAmount).toBe(2000);
    expect(gen.body.box1bDubaiVat).toBe(100);
    expect(gen.body.box1cSharjahAmount).toBe(300);
  });

  it("[R07-02] a standard-rated invoice with no emirate is 422 listing the invoice, never a default", async () => {
    const t = await h.createTenant();
    const inv = await issuedInvoice(t, [
      { description: "Job", quantity: 1, unitPrice: 1000, vatRate: 5 },
    ]);
    await h.sql(
      `UPDATE companies SET trn_vat_number = $2, emirate = 'dubai', vat_filing_frequency = 'Quarterly' WHERE id = $1`,
      [t.company.id, TRN]
    );
    await h.sql(`UPDATE invoices SET place_of_supply_emirate = NULL WHERE id = $1`, [inv.id]);
    const gen = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, Q3);
    expect(gen.status, gen.text).toBe(422);
    expect(gen.body.code).toBe("EMIRATE_MISSING");
    expect(gen.body.details.documents.map((d: { documentId: string }) => d.documentId)).toContain(
      inv.id
    );
    // Reports never default either: the supply is flagged, not filed under Dubai.
    const rep = await t.as.get(
      `/api/companies/${t.company.id}/reports/vat-return?from=2026-07-01&to=2026-09-30`
    );
    expect(rep.status).toBe(200);
    expect(rep.body.boxes.box1bDubaiAmount).toBe(0);
    expect(rep.body.issues[0].code).toBe("EMIRATE_MISSING");
  });

  it("[R07-07] periods must align to the stagger; due date is 28 days after period end", async () => {
    const t = await vatTenant();
    const half = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, {
      periodStart: "2026-01-01",
      periodEnd: "2026-06-30",
    });
    expect(half.status, half.text).toBe(422);
    expect(half.body.code).toBe("PERIOD_NOT_ALIGNED");
    const shifted = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, {
      periodStart: "2026-02-01",
      periodEnd: "2026-04-30",
    });
    expect(shifted.status).toBe(422);
    const auto = await t.as.get(
      `/api/vat/autopilot/calculate/${t.company.id}?periodStart=2026-01-01&periodEnd=2026-06-30&persist=false`
    );
    expect(auto.status).toBe(422);
    expect(auto.body.code).toBe("PERIOD_NOT_ALIGNED");
    // A company on a Feb/May/Aug/Nov stagger files Feb-Apr.
    const stag = await vatTenant({ vat_period_start_month: 2 });
    const ok = await stag.as.post(`/api/companies/${stag.company.id}/vat-returns/generate`, {
      periodStart: "2026-02-01",
      periodEnd: "2026-04-30",
    });
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body.dueDate.slice(0, 10)).toBe("2026-05-28");
    const monthly = await vatTenant({ vat_filing_frequency: "Monthly" });
    const m = await monthly.as.post(`/api/companies/${monthly.company.id}/vat-returns/generate`, {
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });
    expect(m.status, m.text).toBe(201);
  });

  it("[R12-03][R12-08b] a manual journal's VAT reaches the return as an adjustment; zero unexplained difference", async () => {
    const t = await vatTenant();
    await postJournalEntry(t, {
      date: "2026-08-15",
      lines: [
        { code: "1020", debit: 1050 },
        { code: "4010", credit: 1000 },
        { code: "2020", credit: 50 },
      ],
    });
    const rep = await t.as.get(
      `/api/companies/${t.company.id}/reports/vat-return?from=2026-07-01&to=2026-09-30`
    );
    expect(rep.status, rep.text).toBe(200);
    expect(rep.body.box5_outputVat).toBe(50);
    expect(rep.body.boxes.box1cSharjahAdj).toBe(50);
    expect(rep.body.reconciliation.hasUnexplainedDifference).toBe(false);
    const row = rep.body.reconciliation.byCategory.find(
      (r: { category: string }) => r.category === "journal:manual"
    );
    expect(row.ledgerOutputFils).toBe(5_000);
    expect(row.outputDifferenceFils).toBe(0);
    const recon = await t.as.get(
      `/api/companies/${t.company.id}/vat/reconciliation?from=2026-07-01&to=2026-09-30`
    );
    expect(recon.body.ledgerOutputVatFils).toBe(5_000);
  });

  it("[R10-08][R07-03] a fixed-asset disposal's output VAT reaches Box 1 of the company emirate and reconciles to 2020", async () => {
    const t = await vatTenant();
    const bank = await accountByCode(t, "1020");
    const asset = async (name: string) => {
      const r = await t.as.post(`/api/companies/${t.company.id}/fixed-assets`, {
        assetName: name,
        category: "Computer Equipment",
        purchaseDate: "2026-01-15",
        purchaseCost: 12000,
        usefulLifeYears: 5,
        paymentAccountId: bank.id,
      });
      expect(r.status, r.text).toBe(201);
      return r.body.id as string;
    };
    const standard = await asset("Laptop");
    const d = await t.as.post(`/api/fixed-assets/${standard}/dispose`, {
      disposalDate: "2026-08-10",
      disposalAmount: 9000,
      proceedsAccountId: bank.id,
      buyerName: "Second Hand LLC",
    });
    expect(d.status, d.text).toBe(200);
    expect(d.body.vatAmount).toBe(450);
    // Zero-rated (export) disposal → Box 4; out-of-scope → no box.
    const exported = await asset("Server");
    const z = await t.as.post(`/api/fixed-assets/${exported}/dispose`, {
      disposalDate: "2026-08-20",
      disposalAmount: 2000,
      proceedsAccountId: bank.id,
      vatTreatment: "zero_rated",
    });
    expect(z.status, z.text).toBe(200);
    const abroad = await asset("Drone");
    const o = await t.as.post(`/api/fixed-assets/${abroad}/dispose`, {
      disposalDate: "2026-08-25",
      disposalAmount: 700,
      proceedsAccountId: bank.id,
      vatTreatment: "out_of_scope",
    });
    expect(o.status, o.text).toBe(200);
    // Disposals outside the period are not reported.
    const later = await asset("Phone");
    const l = await t.as.post(`/api/fixed-assets/${later}/dispose`, {
      disposalDate: "2026-10-05",
      disposalAmount: 300,
      proceedsAccountId: bank.id,
    });
    expect(l.status, l.text).toBe(200);

    const rep = await t.as.get(
      `/api/companies/${t.company.id}/reports/vat-return?from=2026-07-01&to=2026-09-30`
    );
    expect(rep.status, rep.text).toBe(200);
    expect(rep.body.boxes.box1cSharjahAmount).toBe(9000);
    expect(rep.body.boxes.box1cSharjahVat).toBe(450);
    expect(rep.body.boxes.box1cSharjahAdj).toBe(0);
    expect(rep.body.boxes.box4ZeroRatedAmount).toBe(2000);
    expect(rep.body.box5_outputVat).toBe(450);
    expect(rep.body.reconciliation.hasUnexplainedDifference).toBe(false);
    const row = rep.body.reconciliation.byCategory.find(
      (r: { category: string }) => r.category === "fixed_asset_disposals"
    );
    expect(row).toMatchObject({
      engineOutputFils: 45_000,
      ledgerOutputFils: 45_000,
      outputDifferenceFils: 0,
    });
    // Not double counted as a manual journal adjustment.
    expect(
      rep.body.reconciliation.byCategory.some(
        (r: { category: string }) => r.category === "journal:fixed_asset"
      )
    ).toBe(false);

    // generate uses the same engine.
    const gen = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, Q3);
    expect(gen.status, gen.text).toBe(201);
    expect(gen.body._metadata.reconciliation.hasUnexplainedDifference).toBe(false);
  });

  it("[R12-03] an unexplained VAT-to-GL difference blocks ready/submit unless overridden with an audited reason", async () => {
    const t = await vatTenant();
    const inv = await issuedInvoice(t, [
      { description: "Job", quantity: 1, unitPrice: 1000, vatRate: 5 },
    ]);
    // Legacy damage: the document no longer agrees with its journal (GL carries VAT 50).
    await h.sql(
      `UPDATE invoice_lines SET unit_price = 2000, net_amount = 2000 WHERE invoice_id = $1`,
      [inv.id]
    );
    const gen = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, Q3);
    expect(gen.status, gen.text).toBe(201);
    expect(gen.body._metadata.reconciliation.hasUnexplainedDifference).toBe(true);
    const blocked = await t.as.post(`/api/vat-returns/${gen.body.id}/ready`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("VAT_RECONCILIATION_DIFFERENCE");
    const submit = await t.as.post(`/api/vat-returns/${gen.body.id}/submit`, {});
    expect(submit.status).toBe(409);
    const ok = await t.as.post(`/api/vat-returns/${gen.body.id}/ready`, {
      overrideReason: "Invoice journal restored next period by the accountant",
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.status).toBe("ready");
    expect(ok.body.reconciliationOverrideReason).toContain("restored");
    const audit = await h.sql(
      `SELECT 1 FROM audit_logs WHERE action = 'vat_return.reconciliation_override' AND resource_id = $1`,
      [gen.body.id]
    );
    expect(audit.length).toBe(1);
    const sub = await t.as.post(`/api/vat-returns/${gen.body.id}/submit`, {});
    expect(sub.status, sub.text).toBe(200);
    expect(sub.body.status).toBe("submitted");
    expect(sub.body.filing.transmittedByMuhasib).toBe(false);
  });
});

describe("W4-E purchases, adjustments and amendments", () => {
  it("[R05-28] an entertainment receipt posts its VAT to the expense, not Input VAT, and stays out of Box 9", async () => {
    const t = await vatTenant();
    const expense = await accountByCode(t, "5000");
    const bank = await accountByCode(t, "1020");
    const r = await t.as.post(`/api/companies/${t.company.id}/receipts`, {
      merchant: "Client Dinner LLC",
      date: "2026-08-20",
      amount: 200,
      vatAmount: 10,
      currency: "AED",
      category: "Entertainment",
    });
    expect(r.status, r.text).toBeLessThan(300);
    const p = await t.as.post(`/api/receipts/${r.body.id}/post`, {
      accountId: expense.id,
      paymentAccountId: bank.id,
    });
    expect(p.status, p.text).toBe(200);
    const lines = await h.sql<{ code: string; debit: string }>(
      `SELECT a.code, jl.debit::text AS debit FROM journal_lines jl
         JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = $1 ORDER BY a.code`,
      [p.body.journalEntryId]
    );
    expect(lines.find((l) => l.code === "1050")).toBeUndefined();
    expect(Number(lines.find((l) => l.code === "5000")!.debit)).toBe(210);
    const tr = await h.sql<{ non_recoverable_vat: string }>(
      `SELECT non_recoverable_vat::text FROM receipt_vat_treatments WHERE receipt_id = $1`,
      [r.body.id]
    );
    expect(Number(tr[0].non_recoverable_vat)).toBe(10);
    // An ordinary receipt still recovers its VAT.
    const ok = await t.as.post(`/api/companies/${t.company.id}/receipts`, {
      merchant: "Stationery LLC",
      date: "2026-08-21",
      amount: 100,
      vatAmount: 5,
      currency: "AED",
      category: "Office",
    });
    await t.as.post(`/api/receipts/${ok.body.id}/post`, {
      accountId: expense.id,
      paymentAccountId: bank.id,
    });
    const c = await t.as.get(
      `/api/companies/${t.company.id}/vat/compute?from=2026-07-01&to=2026-09-30`
    );
    expect(c.body.boxes.box9ExpensesAmount).toBe(100);
    expect(c.body.boxes.box9ExpensesVat).toBe(5);
    expect(c.body.reconciliation.hasUnexplainedDifference).toBe(false);
    // Zero-rated purchase cannot carry VAT.
    const bad = await t.as.post(`/api/companies/${t.company.id}/receipts`, {
      merchant: "X",
      date: "2026-08-22",
      amount: 100,
      vatAmount: 5,
      currency: "AED",
    });
    const rej = await t.as.post(`/api/receipts/${bad.body.id}/post`, {
      accountId: expense.id,
      paymentAccountId: bank.id,
      vatSupplyType: "zero_rated",
    });
    expect(rej.status).toBe(422);
    expect(rej.body.code).toBe("SUPPLY_TYPE_RATE_MISMATCH");
  });

  it("[R07-08] imports report customs VAT in Box 6 and recover it in Box 10", async () => {
    const t = await vatTenant();
    await approvedBill(t, {
      vendor_name: "Overseas Goods Co",
      vendor_trn: null,
      is_import: true,
      customs_declaration_no: "SHJ-2026-0042",
      import_vat_amount: 60,
      place_of_supply: "sharjah",
      line_items: [{ description: "Goods", quantity: 1, unit_price: 1000, vat_rate: 5 }],
    });
    const c = await t.as.get(
      `/api/companies/${t.company.id}/vat/compute?from=2026-07-01&to=2026-09-30`
    );
    expect(c.status, c.text).toBe(200);
    // A1 (M7): Box 6 is the value customs assessed VAT on (customs value + duty, FDL Art. 38).
    // With no customs value recorded it is the value implied by the import VAT: 60 / 5% = 1,200
    // (was the supplier's invoice net, 1,000).
    expect(c.body.boxes.box6ImportsAmount).toBe(1200);
    expect(c.body.boxes.box6ImportsVat).toBe(60);
    expect(c.body.boxes.box10ReverseChargeVat).toBe(60);
    expect(c.body.boxes.box14PayableTax).toBe(0);
    expect(c.body.reconciliation.hasUnexplainedDifference).toBe(false);
  });

  it("[R07-08][R07-15] bad-debt relief reduces output tax and reverses when the customer later pays", async () => {
    const t = await vatTenant();
    const inv = await issuedInvoice(
      t,
      [{ description: "Job", quantity: 1, unitPrice: 1000, vatRate: 5 }],
      { date: "2026-01-10", dueDate: "2026-02-09" }
    );
    const early = await t.as.post(`/api/companies/${t.company.id}/vat/bad-debt-relief`, {
      invoiceId: inv.id,
      claimDate: "2026-07-15",
      writtenOff: true,
      customerNotified: true,
    });
    expect(early.status).toBe(422);
    expect(early.body.code).toBe("BAD_DEBT_TOO_EARLY");
    const claim = await t.as.post(`/api/companies/${t.company.id}/vat/bad-debt-relief`, {
      invoiceId: inv.id,
      claimDate: "2026-08-20",
      writtenOff: true,
      customerNotified: true,
      customerNotifiedAt: "2026-08-19",
    });
    expect(claim.status, claim.text).toBe(201);
    expect(Number(claim.body.vatAmount)).toBe(50);
    const q3 = await t.as.get(
      `/api/companies/${t.company.id}/vat/compute?from=2026-07-01&to=2026-09-30`
    );
    expect(q3.body.boxes.box1cSharjahAdj).toBe(-50);
    expect(q3.body.boxes.box12TotalDueTax).toBe(-50);
    expect(q3.body.reconciliation.hasUnexplainedDifference).toBe(false);

    const bank = await accountByCode(t, "1020");
    const pay = await t.as.post(`/api/companies/${t.company.id}/invoices/${inv.id}/payments`, {
      amount: 1050,
      date: "2026-10-05",
      method: "bank",
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBeLessThan(300);
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
    const q4 = await t.as.get(
      `/api/companies/${t.company.id}/vat/compute?from=2026-10-01&to=2026-12-31`
    );
    expect(q4.body.boxes.box1cSharjahAdj).toBe(50);
    expect(q4.body.reconciliation.hasUnexplainedDifference).toBe(false);
  });

  it("[R07-15] tourist refunds (Box 2) and import adjustments (Box 7) change the return as explained differences", async () => {
    const t = await vatTenant();
    const a = await t.as.post(`/api/companies/${t.company.id}/vat/adjustments`, {
      ...Q3,
      kind: "tourist_refund",
      amount: 200,
      vatAmount: 10,
      reason: "Planet tax-free refunds for Q3",
    });
    expect(a.status, a.text).toBe(201);
    const b = await t.as.post(`/api/companies/${t.company.id}/vat/adjustments`, {
      ...Q3,
      kind: "import_adjustment",
      amount: 100,
      vatAmount: 5,
      reason: "Customs reassessment",
    });
    expect(b.status, b.text).toBe(201);
    const c = await t.as.get(
      `/api/companies/${t.company.id}/vat/compute?from=2026-07-01&to=2026-09-30`
    );
    expect(c.body.boxes.box2TouristRefundAmount).toBe(-200);
    expect(c.body.boxes.box2TouristRefundVat).toBe(-10);
    expect(c.body.boxes.box7ImportsAdjVat).toBe(5);
    expect(c.body.boxes.box12TotalDueTax).toBe(-5);
    expect(c.body.reconciliation.hasUnexplainedDifference).toBe(false);
    expect(c.body.reconciliation.explainedOutputFils).toBe(-500);
  });

  it("[R07-15] an amended return references the original and carries a box-by-box diff", async () => {
    const t = await vatTenant();
    await issuedInvoice(t, [{ description: "Job", quantity: 1, unitPrice: 1000, vatRate: 5 }]);
    const gen = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, Q3);
    expect(gen.status, gen.text).toBe(201);
    const early = await t.as.post(`/api/vat-returns/${gen.body.id}/amend`, {
      reason: "Missed invoice",
    });
    expect(early.status).toBe(409);
    const sub = await t.as.post(`/api/vat-returns/${gen.body.id}/submit`, {});
    expect(sub.status, sub.text).toBe(200);
    const regen = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, Q3);
    expect(regen.status).toBe(409);
    expect(regen.body.code).toBe("VAT_RETURN_EXISTS");
    // A1 (C1): the submitted period is closed, so the late invoice cannot be issued into it
    // until a voluntary disclosure (amendment) re-opens it.
    const lateDraft = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Acme LLC",
      date: "2026-09-20",
      lines: [{ description: "Late job", quantity: 1, unitPrice: 400, vatRate: 5 }],
    });
    expect(lateDraft.status, lateDraft.text).toBe(200);
    const blocked = await t.as.patch(`/api/invoices/${lateDraft.body.id}/status`, {
      status: "sent",
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("VAT_PERIOD_FILED");
    const amend = await t.as.post(`/api/vat-returns/${gen.body.id}/amend`, {
      reason: "Invoice INV for 20 Sep was missed",
    });
    expect(amend.status, amend.text).toBe(201);
    expect(amend.body.amendsReturnId).toBe(gen.body.id);
    expect(amend.body.box1cSharjahAmount).toBe(1000);
    const issued = await t.as.patch(`/api/invoices/${lateDraft.body.id}/status`, {
      status: "sent",
    });
    expect(issued.status, issued.text).toBe(200);
    const refreshed = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, Q3);
    expect(refreshed.status, refreshed.text).toBe(201);
    expect(refreshed.body.id).toBe(amend.body.id);
    expect(refreshed.body.box1cSharjahAmount).toBe(1400);
    const d = refreshed.body.amendmentDiff.boxes.find(
      (x: { box: string }) => x.box === "box1cSharjahVat"
    );
    expect(d).toEqual({ box: "box1cSharjahVat", previous: 50, amended: 70, difference: 20 });
    expect(refreshed.body.amendmentDiff.netChange).toBe(20);
    const orig = await h.sql<{ status: string }>(`SELECT status FROM vat_returns WHERE id = $1`, [
      gen.body.id,
    ]);
    expect(orig[0].status).toBe("amended");
  });

  it("[R07-15] a VAT group return aggregates members and eliminates intra-group supplies", async () => {
    const rep = await vatTenant();
    const member = await vatTenant({ trn_vat_number: "100000000000011", emirate: "dubai" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      member.company.id,
      rep.user.id,
    ]);
    const g = await rep.as.put(`/api/companies/${rep.company.id}/vat/group`, {
      name: "Acme Group",
      groupTrn: "100000000000029",
      memberCompanyIds: [member.company.id],
    });
    expect(g.status, g.text).toBe(200);
    await issuedInvoice(rep, [{ description: "Ext", quantity: 1, unitPrice: 1000, vatRate: 5 }]);
    await issuedInvoice(member, [{ description: "Ext", quantity: 1, unitPrice: 600, vatRate: 5 }]);
    // Intra-group: member invoices the representative (customer TRN = representative's TRN).
    await issuedInvoice(
      member,
      [{ description: "Mgmt fee", quantity: 1, unitPrice: 5000, vatRate: 5 }],
      { customerName: "Rep", customerTrn: TRN }
    );
    const c = await rep.as.get(
      `/api/companies/${rep.company.id}/vat/compute?from=2026-07-01&to=2026-09-30`
    );
    expect(c.status, c.text).toBe(200);
    expect(c.body.boxes.box1cSharjahAmount).toBe(1000);
    expect(c.body.boxes.box1bDubaiAmount).toBe(600);
    expect(c.body.excluded.intraGroup).toHaveLength(1);
    expect(c.body.group.groupTrn).toBe("100000000000029");
    const badTrn = await rep.as.put(`/api/companies/${rep.company.id}/vat/group`, {
      name: "Bad",
      groupTrn: "12345",
      memberCompanyIds: [],
    });
    expect(badTrn.status).toBe(400);
  });
});
