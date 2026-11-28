/**
 * D5c: ONE settlement rule ("what is still owed") that matches the ledger, used by every reader.
 *
 * A company whose invoices are settled by a payment, a partial payment, a credit-note invoice,
 * an applied customer credit (from an overpayment), a consolidated legacy credit note, and a
 * USD invoice — and whose bills are settled by payments, a fully and a partly applied debit
 * note, a prepayment and a USD part-payment — must show the SAME open balance in: the invoice
 * list, AR aging, the dashboard, the GL control account (1040 A/R, 2010 A/P), the bill summary,
 * statements, FX exposure and the cash forecast. Every figure is posted through the real API.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";
import { dubaiIso } from "../helpers/dates";

const h = useHarness();
let t: Tenant;
const daysAgo = (n: number) => dubaiIso(new Date(Date.now() - n * 86_400_000));
const base = () => `/api/companies/${t.company.id}`;
const RATE = 3.6725;
const ids: Record<string, string> = {};
let contactId = "";
let vendorId = "";

/** Natural balance of an account code over posted entries (debit − credit, or the reverse). */
async function gl(code: string, side: "debit" | "credit") {
  const [r] = await h.sql<{ d: string; c: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.debit * 100)), 0)::bigint AS d,
            COALESCE(SUM(ROUND(jl.credit * 100)), 0)::bigint AS c
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  const fils = side === "debit" ? Number(r.d) - Number(r.c) : Number(r.c) - Number(r.d);
  return fils / 100;
}

async function issued(label: string, over: Record<string, unknown> = {}, unitPrice = 1000) {
  const c = await t.as.post(`${base()}/invoices`, {
    customerName: "Acme LLC",
    contactId,
    date: daysAgo(20),
    dueDate: daysAgo(5),
    lines: [{ description: "Consulting", quantity: 1, unitPrice, vatRate: 5 }],
    ...over,
  });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  ids[label] = c.body.id;
  return c.body.id as string;
}

async function pay(invoiceId: string, amount: number, extra: Record<string, unknown> = {}) {
  const bank = await accountByCode(t, "1020");
  const p = await t.as.post(`/api/companies/${t.company.id}/invoices/${invoiceId}/payments`, {
    date: daysAgo(10),
    method: "bank",
    paymentAccountId: bank.id,
    amount,
    ...extra,
  });
  expect(p.status, p.text).toBe(201);
  return p.body;
}

async function approvedBill(number: string, over: Record<string, unknown> = {}) {
  const b = await t.as.post(`${base()}/bills`, {
    vendor_name: "Acme Hosting LLC",
    vendor_trn: "100000000000003",
    bill_number: number,
    bill_date: daysAgo(20),
    due_date: daysAgo(5),
    line_items: [{ description: "Hosting", quantity: 1, unit_price: 1000, vat_rate: 5 }],
    ...over,
  });
  expect(b.status, b.text).toBe(200);
  const a = await t.as.post(`/api/bills/${b.body.id}/approve`, {});
  expect(a.status, a.text).toBe(200);
  ids[number] = b.body.id;
  return b.body.id as string;
}

async function payBill(billId: string, amount: number) {
  const p = await t.as.post(`/api/bills/${billId}/payments`, {
    payment_date: daysAgo(10),
    amount,
  });
  expect(p.status, p.text).toBeLessThan(300);
}

beforeAll(async () => {
  t = await h.createTenant();
  const rate = await t.as.post(`${base()}/exchange-rates`, {
    fromCurrency: "USD",
    rate: RATE,
    effectiveDate: daysAgo(40),
  });
  expect(rate.status, rate.text).toBeLessThan(300);
  const contact = await t.as.post(`${base()}/customer-contacts`, { name: "Acme LLC" });
  expect(contact.status, contact.text).toBeLessThan(300);
  contactId = contact.body.id;

  // ── Receivables ──────────────────────────────────────────────────────────
  // INV-1 1,050: overpaid 1,100 → paid, 50 customer credit (2050).
  const inv1 = await issued("INV-1");
  await pay(inv1, 1100, { allowCredit: true });
  // INV-2 1,050: part-paid 400 → 650 open.
  await pay(await issued("INV-2"), 400);
  // INV-3 1,050: credit-note invoice of 210 → 840 open.
  const inv3 = await issued("INV-3");
  const cn = await t.as.post(`${base()}/invoices/${inv3}/credit-note`, {
    lines: [{ description: "Discount", quantity: 1, unitPrice: 200, vatRate: 5 }],
  });
  expect(cn.status, cn.text).toBe(201);
  // INV-4 1,050: the 50 customer credit applied → 1,000 open.
  const inv4 = await issued("INV-4");
  const credits = await t.as.get(`${base()}/customer-credits`);
  const credit = credits.body.find((c: { sourceType: string }) => c.sourceType === "overpayment");
  expect(Number(credit.remaining)).toBe(50);
  const apply = await t.as.post(`${base()}/customer-credits/${credit.id}/apply`, {
    invoiceId: inv4,
    amount: 50,
  });
  expect(apply.status, apply.text).toBe(201);
  // INV-5 1,050: legacy credit note 105 (credit_notes table), consolidated by the 0081 backfill
  // into a credit-note invoice with its own A/R journal → 945 open (counted once, not twice).
  const inv5 = await issued("INV-5");
  await h.sql(
    `INSERT INTO credit_notes (company_id, number, customer_name, invoice_id, date, currency,
        subtotal, vat_amount, total, status)
     VALUES ($1, 'LCN-1', 'Acme LLC', $2, $3, 'AED', 100, 5, 105, 'issued')`,
    [t.company.id, inv5, `${daysAgo(15)}T00:00:00Z`]
  );
  const { backfillStandaloneCreditNotes } = await import("./legacy-credit-note-backfill");
  const res = await backfillStandaloneCreditNotes({
    query: async (text: string, values?: unknown[]) => ({ rows: await h.sql(text, values) }),
  });
  expect(res.insertedInvoiceCount).toBe(1);
  expect(res.postedJournalCount).toBe(1);
  // INV-6 USD 105 @3.6725 (AED 385.61): USD 40 paid → USD 65 open = AED 238.71.
  await pay(await issued("INV-6", { currency: "USD", exchangeRate: RATE }, 100), 40);
  // INV-7: fully settled by a full credit note → paid, 0 open.
  const inv7 = await issued("INV-7");
  const full = await t.as.post(`${base()}/invoices/${inv7}/credit-note`, {});
  expect(full.status, full.text).toBe(201);

  // ── Payables ─────────────────────────────────────────────────────────────
  const vendor = await t.as.post(`${base()}/vendors`, {
    name: "Acme Hosting LLC",
    trn: "100000000000003",
  });
  expect(vendor.status, vendor.text).toBeLessThan(300);
  await payBill(await approvedBill("B-1"), 1050); // paid
  await payBill(await approvedBill("B-2"), 300); // 750 open
  const b3 = await approvedBill("B-3"); // debit note 210 fully applied → 840 open
  const dn3 = await t.as.post(`${base()}/debit-notes`, {
    bill_id: b3,
    note_date: daysAgo(12),
    reason: "Service credit",
    lines: [{ description: "Downtime", amount: 200, vat_rate: 5 }],
  });
  expect(dn3.status, dn3.text).toBe(201);
  const ap3 = await t.as.post(`${base()}/debit-notes/${dn3.body.id}/apply`, {
    bill_id: b3,
    amount: 210,
    date: daysAgo(11),
  });
  expect(ap3.status, ap3.text).toBe(200);
  const b4 = await approvedBill("B-4"); // debit note 105, 50 applied → 1,000 open, 55 unapplied
  const dn4 = await t.as.post(`${base()}/debit-notes`, {
    bill_id: b4,
    note_date: daysAgo(12),
    reason: "Partial credit",
    lines: [{ description: "Credit", amount: 100, vat_rate: 5 }],
  });
  expect(dn4.status, dn4.text).toBe(201);
  const ap4 = await t.as.post(`${base()}/debit-notes/${dn4.body.id}/apply`, {
    bill_id: b4,
    amount: 50,
    date: daysAgo(11),
  });
  expect(ap4.status, ap4.text).toBe(200);
  const b5 = await approvedBill("B-5"); // prepayment 200 applied → 850 open
  const pre = await t.as.post(`${base()}/vendor-prepayments`, {
    vendor_name: "Acme Hosting LLC",
    payment_date: daysAgo(25),
    amount: 200,
  });
  expect(pre.status, pre.text).toBe(201);
  const pa = await t.as.post(`${base()}/vendor-prepayments/${pre.body.id}/apply`, {
    bill_id: b5,
    amount: 200,
    date: daysAgo(11),
  });
  expect(pa.status, pa.text).toBe(200);
  // B-6 USD 105 @3.6725: USD 40 paid → USD 65 open = AED 238.71.
  await payBill(
    await approvedBill("B-6", {
      currency: "USD",
      line_items: [{ description: "SaaS", quantity: 1, unit_price: 100, vat_rate: 5 }],
    }),
    40
  );
});

const AR_EXPECTED = 0 + 650 + 840 + 1000 + 945 + 238.71 + 0;
const AP_DOCS_EXPECTED = 0 + 750 + 840 + 1000 + 850 + 238.71;
const AP_UNAPPLIED = 55;

describe("D5c receivables: one settlement rule", () => {
  it("invoice list open balances == GL 1040 == AR aging == dashboard outstanding", async () => {
    const list = await t.as.get(`${base()}/invoices?all=true`);
    expect(list.status).toBe(200);
    const by = (n: string) => list.body.find((i: { id: string }) => i.id === ids[n]);
    expect(by("INV-1").openBalance).toBe(0);
    expect(by("INV-2").openBalance).toBe(650);
    expect(by("INV-3").openBalance).toBe(840);
    expect(by("INV-4").openBalance).toBe(1000);
    expect(by("INV-5").openBalance).toBe(945);
    expect(by("INV-6").openBalance).toBe(65);
    expect(by("INV-6").openBalanceBase).toBeCloseTo(238.71, 2);
    expect(by("INV-7").openBalance).toBe(0);
    // Credit-note documents are never open.
    for (const i of list.body.filter(
      (x: { invoiceType: string }) => x.invoiceType === "credit_note"
    ))
      expect(i.openBalance).toBe(0);
    const listTotal =
      Math.round(
        list.body.reduce(
          (s: number, i: { openBalanceBase: number }) => s + i.openBalanceBase * 100,
          0
        )
      ) / 100;

    const glAr = await gl("1040", "debit");
    const aging = await t.as.get(`${base()}/reports/aged-receivables`);
    const stats = await t.as.get(`${base()}/dashboard/stats`);
    expect(aging.status, aging.text).toBe(200);
    expect(glAr).toBeCloseTo(AR_EXPECTED, 2);
    expect(listTotal).toBeCloseTo(glAr, 2);
    expect(aging.body.totals.total).toBeCloseTo(glAr, 2);
    expect(aging.body.unappliedCredits).toBe(0);
    expect(aging.body.netTotal).toBeCloseTo(glAr, 2);
    expect(aging.body.reconciliation.isReconciled).toBe(true);
    expect(stats.body.outstanding).toBeCloseTo(glAr, 2);
  });

  it("status derivation and invoice detail use the same rule", async () => {
    const status = async (n: string) => (await t.as.get(`/api/invoices/${ids[n]}`)).body;
    expect((await status("INV-1")).status).toBe("paid");
    expect((await status("INV-2")).status).toBe("partial");
    expect((await status("INV-3")).status).toBe("partial");
    expect((await status("INV-4")).status).toBe("partial");
    expect((await status("INV-7")).status).toBe("paid");
    expect((await status("INV-5")).settlement.amountDue).toBe("945.00");
    expect((await status("INV-4")).settlement.amountDue).toBe("1000.00");
  });

  it("customer statement, FX exposure and cash forecast inflows agree", async () => {
    const { buildCustomerStatement } =
      await import("../../server/services/customer-statement.service");
    const st = await buildCustomerStatement({ companyId: t.company.id, contactId });
    const aedSection = st.sections.find((s) => s.currency === "AED")!;
    const usdSection = st.sections.find((s) => s.currency === "USD")!;
    expect(aedSection.aging.total).toBeCloseTo(650 + 840 + 1000 + 945, 2);
    expect(usdSection.aging.total).toBeCloseTo(65, 2);
    // The running balance agrees with the open documents (the 50 overpayment was applied).
    expect(aedSection.closingBalance).toBeCloseTo(aedSection.aging.total, 2);

    const fx = await t.as.get(`${base()}/reports/fx-gains-losses?asOf=${daysAgo(0)}`);
    expect(fx.status, fx.text).toBe(200);
    const { computeFxExposure } = await import("../../server/services/fx/exposure");
    const exposure = await computeFxExposure(t.company.id, daysAgo(0));
    const usdInv = exposure.items.find((i) => i.entityId === ids["INV-6"])!;
    expect(usdInv.foreignFils).toBe(6500);

    const { generateCashFlowForecast } =
      await import("../../server/services/cashflow-forecast.service");
    const f = await generateCashFlowForecast(t.company.id, { days: 90 });
    const inflows = f.items
      .filter((i) => i.kind === "receivable")
      .reduce((s, i) => s + Math.round(i.amount * 100), 0);
    expect(inflows / 100).toBeCloseTo(AR_EXPECTED, 2);
  });
});

describe("D5c payables: one settlement rule", () => {
  it("bill open balances == AP aging; net of unapplied debit notes == GL 2010 == dashboard", async () => {
    const glAp = await gl("2010", "credit");
    expect(glAp).toBeCloseTo(AP_DOCS_EXPECTED - AP_UNAPPLIED, 2);
    const aging = await t.as.get(`${base()}/reports/aged-payables`);
    expect(aging.status, aging.text).toBe(200);
    expect(aging.body.totals.total).toBeCloseTo(AP_DOCS_EXPECTED, 2);
    expect(aging.body.unappliedCredits).toBeCloseTo(AP_UNAPPLIED, 2);
    expect(aging.body.netTotal).toBeCloseTo(glAp, 2);
    expect(aging.body.reconciliation.isReconciled).toBe(true);

    const summary = await t.as.get(`${base()}/bills/summary`);
    expect(summary.body.open.total).toBeCloseTo(AP_DOCS_EXPECTED, 2);
    const stats = await t.as.get(`${base()}/dashboard/stats`);
    expect(stats.body.outstandingPayables).toBeCloseTo(glAp, 2);

    const billsAging = await t.as.get(`${base()}/bills/aging`);
    expect(billsAging.body.unapplied_credits).toBeCloseTo(AP_UNAPPLIED, 2);
    expect(billsAging.body.reconciliation.isReconciled).toBe(true);
  });

  it("supplier statements do not count an applied debit note twice", async () => {
    const [v] = await h.sql<{ vendor_id: string }>(
      `SELECT vendor_id FROM vendor_bills WHERE id = $1`,
      [ids["B-1"]]
    );
    vendorId = v.vendor_id;
    expect(vendorId).toBeTruthy();
    const { buildSupplierStatement } =
      await import("../../server/services/customer-statement.service");
    const st = await buildSupplierStatement({ companyId: t.company.id, vendorId });
    const aed = st.sections.find((s) => s.currency === "AED")!;
    expect(aed.aging.total).toBeCloseTo(750 + 840 + 1000 + 850, 2);
    // Closing = open bills − the unapplied 55 of debit note DN-4.
    expect(aed.closingBalance).toBeCloseTo(aed.aging.total - AP_UNAPPLIED, 2);
    expect(aed.aging.unappliedCredits).toBeCloseTo(-AP_UNAPPLIED, 2);

    const vs = await t.as.get(`${base()}/vendors/${vendorId}/statement`);
    expect(vs.status, vs.text).toBe(200);
    // AED view of the whole vendor: every open bill (incl. USD at its rate) less unapplied credit.
    expect(vs.body.closingBalance).toBeCloseTo(AP_DOCS_EXPECTED - AP_UNAPPLIED, 2);
  });

  it("USD bill exposure uses the same open balance", async () => {
    const { computeFxExposure } = await import("../../server/services/fx/exposure");
    const exposure = await computeFxExposure(t.company.id, daysAgo(0));
    const usdBill = exposure.items.find((i) => i.entityId === ids["B-6"])!;
    expect(usdBill.foreignFils).toBe(6500);
  });

  it("voiding a debit-note application restores the bill and the unapplied credit; still ties to GL", async () => {
    const [app] = await h.sql<{ id: string }>(
      `SELECT id FROM bill_payments WHERE bill_id = $1 AND kind = 'vendor_credit'`,
      [ids["B-4"]]
    );
    const v = await t.as.post(`/api/bills/${ids["B-4"]}/payments/${app.id}/void`, {
      reason: "Applied to the wrong bill",
    });
    expect(v.status, v.text).toBe(200);
    const glAp = await gl("2010", "credit");
    const aging = await t.as.get(`${base()}/reports/aged-payables`);
    expect(aging.body.totals.total).toBeCloseTo(AP_DOCS_EXPECTED + 50, 2);
    expect(aging.body.unappliedCredits).toBeCloseTo(105, 2);
    expect(aging.body.netTotal).toBeCloseTo(glAp, 2);
    expect(aging.body.reconciliation.isReconciled).toBe(true);
    const vs = await t.as.get(`${base()}/vendors/${vendorId}/statement`);
    expect(vs.body.closingBalance).toBeCloseTo(glAp, 2);
  });
});
