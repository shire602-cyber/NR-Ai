/**
 * W3-B procure-to-pay: vendor bills, payments with FX, aging, debit notes, prepayments, vendor
 * master, approval rules. Issue ids in test names.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";
import { has, resolve } from "../../server/platform/service-registry";

const h = useHarness();
const TRN = "100000000000003";

const billsUrl = (t: Tenant) => `/api/companies/${t.company.id}/bills`;

async function createBill(t: Tenant, over: Record<string, unknown> = {}) {
  return t.as.post(billsUrl(t), {
    vendor_name: "Acme Hosting LLC",
    vendor_trn: TRN,
    bill_number: `B-${Math.random().toString(36).slice(2, 8)}`,
    bill_date: "2026-01-15",
    due_date: "2026-02-14",
    line_items: [{ description: "Hosting", quantity: 1, unit_price: 1000, vat_rate: 5 }],
    ...over,
  });
}

async function approvedBill(t: Tenant, over: Record<string, unknown> = {}) {
  const b = await createBill(t, over);
  expect(b.status, b.text).toBe(200);
  const a = await t.as.post(`/api/bills/${b.body.id}/approve`, {});
  expect(a.status, a.text).toBe(200);
  return a.body;
}

/** Natural balance (fils) of an account code: credit − debit for liabilities/income. */
async function balanceFils(t: Tenant, code: string, side: "credit" | "debit" = "credit") {
  const rows = await h.sql<{ c: string; d: string }>(
    `SELECT COALESCE(SUM(ROUND(jl.credit*100)),0)::bigint AS c, COALESCE(SUM(ROUND(jl.debit*100)),0)::bigint AS d
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = $2`,
    [t.company.id, code]
  );
  const c = Number(rows[0].c);
  const d = Number(rows[0].d);
  return side === "credit" ? c - d : d - c;
}

async function addMember(owner: Tenant, member: Tenant, role: string) {
  await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [
    owner.company.id,
    member.user.id,
    role,
  ]);
}

describe("W3-B bills: state machine", () => {
  it("[R04-01] paying a pending bill is 409 and writes nothing", async () => {
    const t = await h.createTenant();
    const b = await createBill(t);
    expect(b.status).toBe(200);
    expect(b.body.status).toBe("pending");
    const p = await t.as.post(`/api/bills/${b.body.id}/payments`, {
      payment_date: "2026-01-20",
      amount: 100,
    });
    expect(p.status, p.text).toBe(409);
    expect(p.body.code).toBe("BILL_NOT_PAYABLE");
    const rows = await h.sql(`SELECT 1 FROM bill_payments WHERE bill_id = $1`, [b.body.id]);
    expect(rows).toHaveLength(0);
    // The bill can still be approved afterwards.
    const a = await t.as.post(`/api/bills/${b.body.id}/approve`, {});
    expect(a.status, a.text).toBe(200);
    expect(a.body.status).toBe("approved");
    expect(await balanceFils(t, "2010")).toBe(105_000);
  });

  it("[R04-02] approved bill: PATCH is 409; revise reverses and reposts so GL equals the sub-ledger", async () => {
    const t = await h.createTenant();
    const bill = await approvedBill(t);
    expect(await balanceFils(t, "2010")).toBe(105_000);
    const patch = await t.as.patch(`/api/bills/${bill.id}`, {
      line_items: [{ description: "Hosting", quantity: 1, unit_price: 5000, vat_rate: 5 }],
    });
    expect(patch.status).toBe(409);
    expect(patch.body.code).toBe("BILL_LOCKED");
    const noReason = await t.as.post(`/api/bills/${bill.id}/revise`, {
      line_items: [{ description: "Hosting", quantity: 1, unit_price: 5000, vat_rate: 5 }],
    });
    expect(noReason.status).toBe(400);
    const rev = await t.as.post(`/api/bills/${bill.id}/revise`, {
      reason: "Vendor corrected the invoice",
      line_items: [{ description: "Hosting", quantity: 1, unit_price: 5000, vat_rate: 5 }],
    });
    expect(rev.status, rev.text).toBe(200);
    expect(rev.body.total_amount).toBe("5250.00");
    expect(rev.body.revision).toBe(1);
    expect(await balanceFils(t, "2010")).toBe(525_000);
    expect(await balanceFils(t, "1050", "debit")).toBe(25_000);
    const audit = await h.sql(
      `SELECT 1 FROM audit_logs WHERE action = 'bill.revise' AND resource_id = $1`,
      [bill.id]
    );
    expect(audit.length).toBe(1);
    // Revise is blocked once payments exist.
    await t.as.post(`/api/bills/${bill.id}/payments`, { payment_date: "2026-01-20", amount: 100 });
    const blocked = await t.as.post(`/api/bills/${bill.id}/revise`, {
      reason: "again",
      line_items: [{ description: "Hosting", quantity: 1, unit_price: 10, vat_rate: 5 }],
    });
    expect(blocked.status).toBe(409);
  });

  it("[R04-04] PATCH of a reverse-charge bill 2000 → 3000 keeps the total VAT-exclusive (3000); both VAT legs post", async () => {
    const t = await h.createTenant();
    const b = await createBill(t, {
      vendor_trn: null,
      reverse_charge: true,
      line_items: [{ description: "Imported service", quantity: 1, unit_price: 2000, vat_rate: 5 }],
    });
    expect(b.body.total_amount).toBe("2000.00");
    const p = await t.as.patch(`/api/bills/${b.body.id}`, {
      line_items: [{ description: "Imported service", quantity: 1, unit_price: 3000, vat_rate: 5 }],
    });
    expect(p.status, p.text).toBe(200);
    expect(p.body.total_amount).toBe("3000.00");
    expect(p.body.vat_amount).toBe("150.00");
    const off = await t.as.patch(`/api/bills/${b.body.id}`, { reverse_charge: false });
    expect(off.body.total_amount).toBe("3150.00");
    const on = await t.as.patch(`/api/bills/${b.body.id}`, { reverse_charge: true });
    expect(on.body.total_amount).toBe("3000.00");
    expect((await t.as.post(`/api/bills/${b.body.id}/approve`, {})).status).toBe(200);
    expect(await balanceFils(t, "2010")).toBe(300_000);
    expect(await balanceFils(t, "2020")).toBe(15_000);
    expect(await balanceFils(t, "1050", "debit")).toBe(15_000);
  });

  it("[R04-05] foreign-currency bills resolve the company rate via fx.getRate; the UI carries RC/FX/bank/import fields", async () => {
    const t = await h.createTenant();
    // E1: a company with no FX rows books a USD bill at the CBUAE peg.
    const pegged = await createBill(t, { currency: "USD" });
    expect(pegged.status, pegged.text).toBe(200);
    expect(Number(pegged.body.exchange_rate)).toBeCloseTo(3.6725, 6);
    // Another pair has no default: still a 422.
    const noRate = await createBill(t, { currency: "GBP" });
    expect(noRate.status).toBe(422);
    expect(noRate.body.code).toBe("NO_EXCHANGE_RATE");
    const r = await t.as.post(`/api/companies/${t.company.id}/exchange-rates`, {
      fromCurrency: "USD",
      rate: 3.6725,
      effectiveDate: "2026-01-14",
    });
    expect(r.status, r.text).toBeLessThan(300);
    const ok = await createBill(t, { currency: "USD" });
    expect(ok.status, ok.text).toBe(200);
    expect(Number(ok.body.exchange_rate)).toBeCloseTo(3.6725, 6);
    const src = fs.readFileSync(path.join(__dirname, "../../client/src/pages/BillPay.tsx"), "utf8");
    for (const field of [
      "reverse_charge",
      "exchange_rate",
      "payment_account_id",
      "is_import",
      "vat_supply_type",
    ]) {
      expect(src, field).toContain(field);
    }
  });

  it("[R04-06] negative amounts are rejected (bill price, quantity, payment)", async () => {
    const t = await h.createTenant();
    const neg = await createBill(t, {
      line_items: [{ description: "Credit", quantity: 1, unit_price: -1000, vat_rate: 5 }],
    });
    expect(neg.status).toBe(400);
    const negQty = await createBill(t, {
      line_items: [{ description: "Credit", quantity: -2, unit_price: 10, vat_rate: 5 }],
    });
    expect(negQty.status).toBe(400);
    const bad = await createBill(t, {
      line_items: [{ description: "x", quantity: 1, unit_price: 10, vat_rate: 7 }],
    });
    expect(bad.status).toBe(400);
    const bill = await approvedBill(t);
    const negPay = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: "2026-01-20",
      amount: -5,
    });
    expect(negPay.status).toBe(400);
    expect(
      (await h.sql(`SELECT 1 FROM vendor_bills WHERE company_id = $1`, [t.company.id])).length
    ).toBe(1);
  });

  it("[R04-08] a never-approved bill can be deleted; void reverses an approved bill's journal", async () => {
    const t = await h.createTenant();
    const b = await createBill(t);
    const del = await t.as.delete(`/api/bills/${b.body.id}`);
    expect(del.status, del.text).toBe(200);
    expect(await h.sql(`SELECT 1 FROM vendor_bills WHERE id = $1`, [b.body.id])).toHaveLength(0);

    const bill = await approvedBill(t);
    expect((await t.as.delete(`/api/bills/${bill.id}`)).status).toBe(409);
    const v = await t.as.post(`/api/bills/${bill.id}/void`, { reason: "Duplicate" });
    expect(v.status, v.text).toBe(200);
    expect(v.body.status).toBe("void");
    expect(v.body.reversal_entry_ids).toHaveLength(1);
    expect(await balanceFils(t, "2010")).toBe(0);
    expect(await balanceFils(t, "1050", "debit")).toBe(0);
    const pay = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: "2026-01-20",
      amount: 1,
    });
    expect(pay.status).toBe(409);

    const pending = await createBill(t);
    const rej = await t.as.post(`/api/bills/${pending.body.id}/reject`, { reason: "Wrong vendor" });
    expect(rej.status).toBe(200);
    expect(rej.body.status).toBe("rejected");
    expect((await t.as.post(`/api/bills/${pending.body.id}/void`, {})).status).toBe(409);
  });

  it("[R11-04] an uncategorised bill posts to 5000 General Expenses, never 5130", async () => {
    const t = await h.createTenant();
    await approvedBill(t);
    expect(await balanceFils(t, "5000", "debit")).toBe(100_000);
    expect(await balanceFils(t, "5130", "debit")).toBe(0);
    const drift = fs.readFileSync(
      path.join(__dirname, "../../scripts/qa/find-purchases-ledger-drift.mjs"),
      "utf8"
    );
    expect(drift).toContain("5130");
  });
});

describe("W3-B bills: payments", () => {
  it("pages vendor payment history in bill currency without leaking another company's rows", async () => {
    const t = await h.createTenant();
    const bill = await approvedBill(t, { currency: "USD", exchange_rate: "3.6725" });
    const paymentIds = [];
    for (const amount of [10, 20]) {
      const payment = await t.as.post(`/api/bills/${bill.id}/payments`, {
        payment_date: "2026-02-01",
        amount,
        exchange_rate: "3.6725",
      });
      expect(payment.status, payment.text).toBe(200);
      paymentIds.push(payment.body.payment.id);
    }
    const url = `${billsUrl(t)}/all-payments?limit=1`;
    const first = await t.as.get(url);
    expect(first.status, first.text).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.items[0]).toMatchObject({ bill_id: bill.id, currency: "USD" });
    const second = await t.as.get(`${url}&cursor=${first.body.nextCursor}`);
    expect(second.status, second.text).toBe(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0]).toMatchObject({ bill_id: bill.id, currency: "USD" });
    expect(second.body.nextCursor).toBeNull();
    expect([first.body.items[0].id, second.body.items[0].id]).toEqual(paymentIds.sort().reverse());
    const another = await h.createSecondTenant();
    expect([403, 404]).toContain((await another.as.get(url)).status);
  });

  it("[R04-14] exact fils: overpaying by 0.01 is 400; the chosen bank account is credited", async () => {
    const t = await h.createTenant();
    const bill = await approvedBill(t);
    const over = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: "2026-01-20",
      amount: "1050.01",
    });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe("OVERPAYMENT");
    const petty = await accountByCode(t, "1030");
    const ap = await accountByCode(t, "1050");
    const badAcct = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: "2026-01-20",
      amount: 10,
      payment_account_id: ap.id,
    });
    expect(badAcct.status).toBe(400);
    const pay = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: "2026-01-20",
      amount: "1050.00",
      payment_account_id: petty.id,
    });
    expect(pay.status, pay.text).toBe(200);
    expect(pay.body.bill_status).toBe("paid");
    expect(await balanceFils(t, "1030", "debit")).toBe(-105_000);
    expect(await balanceFils(t, "1020", "debit")).toBe(0);
    expect(await balanceFils(t, "2010")).toBe(0);
  });

  it("[R04-13] a failing payment journal rolls the payment back (no swallow)", async () => {
    const t = await h.createTenant();
    const bill = await approvedBill(t);
    await h.sql(`CREATE OR REPLACE FUNCTION w3b_fail_payment() RETURNS trigger AS $$
      BEGIN IF NEW.source = 'bill_payment' THEN RAISE EXCEPTION 'w3b forced journal failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await h.sql(
      `CREATE TRIGGER w3b_fail_payment BEFORE INSERT ON journal_entries FOR EACH ROW EXECUTE FUNCTION w3b_fail_payment()`
    );
    try {
      const p = await t.as.post(`/api/bills/${bill.id}/payments`, {
        payment_date: "2026-01-20",
        amount: 100,
      });
      expect(p.status).toBeGreaterThanOrEqual(500);
    } finally {
      await h.sql(`DROP TRIGGER w3b_fail_payment ON journal_entries`);
    }
    expect(await h.sql(`SELECT 1 FROM bill_payments WHERE bill_id = $1`, [bill.id])).toHaveLength(
      0
    );
    const row = await h.sql(
      `SELECT status, amount_paid::text AS paid FROM vendor_bills WHERE id = $1`,
      [bill.id]
    );
    expect(row[0]).toEqual({ status: "approved", paid: "0.00" });
  });

  it("[R14-05] USD bill @3.67 paid @3.75 posts realised FX loss and clears A/P exactly", async () => {
    const t = await h.createTenant();
    const bill = await approvedBill(t, {
      currency: "USD",
      exchange_rate: "3.67",
      line_items: [
        {
          description: "SaaS",
          quantity: 1,
          unit_price: 100,
          vat_rate: 0,
          vat_supply_type: "zero_rated",
        },
      ],
    });
    expect(await balanceFils(t, "2010")).toBe(36_700);
    const p = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: "2026-02-01",
      amount: 100,
      exchange_rate: "3.75",
    });
    expect(p.status, p.text).toBe(200);
    expect(p.body.fx_difference).toBe(8);
    expect(await balanceFils(t, "2010")).toBe(0);
    expect(await balanceFils(t, "1020", "debit")).toBe(-37_500);
    expect(await balanceFils(t, "5140", "debit")).toBe(800);
    // Partial payments at a better rate post a gain.
    const b2 = await approvedBill(t, {
      currency: "USD",
      exchange_rate: "3.67",
      line_items: [
        {
          description: "SaaS",
          quantity: 1,
          unit_price: 200,
          vat_rate: 0,
          vat_supply_type: "zero_rated",
        },
      ],
    });
    const p1 = await t.as.post(`/api/bills/${b2.id}/payments`, {
      payment_date: "2026-02-01",
      amount: 50,
      exchange_rate: "3.60",
    });
    expect(p1.body.bill_status).toBe("partial");
    expect(p1.body.fx_difference).toBe(-3.5);
    expect(await balanceFils(t, "4090")).toBe(350);
  });

  it("[R04-13][R04-18] payment void reverses the journal and restores the bill status", async () => {
    const t = await h.createTenant();
    const bill = await approvedBill(t);
    const p = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: "2026-01-20",
      amount: 1050,
    });
    expect(p.body.bill_status).toBe("paid");
    const v = await t.as.post(`/api/bills/${bill.id}/payments/${p.body.payment.id}/void`, {
      reason: "Bounced",
    });
    expect(v.status, v.text).toBe(200);
    expect(v.body.bill_status).toBe("approved");
    const history = await t.as.get(`${billsUrl(t)}/all-payments`);
    expect(history.status, history.text).toBe(200);
    expect(history.body.items).toHaveLength(2);
    expect(history.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: p.body.payment.id, kind: "payment", status: "voided" }),
        expect.objectContaining({ bill_id: bill.id, kind: "reversal", status: "active" }),
      ])
    );
    expect(await balanceFils(t, "2010")).toBe(105_000);
    expect(await balanceFils(t, "1020", "debit")).toBe(0);
    expect(
      (await t.as.post(`/api/bills/${bill.id}/payments/${p.body.payment.id}/void`, {})).status
    ).toBe(409);
  });
});

describe("W3-B aging, summary and VAT data", () => {
  it("[R04-07][R04-22] aging: USD bill converted at the bill rate, equals GL 2010, excludes pending, as-of date", async () => {
    const t = await h.createTenant();
    await approvedBill(t, {
      currency: "USD",
      exchange_rate: "3.67",
      line_items: [{ description: "Licence", quantity: 1, unit_price: 500, vat_rate: 5 }],
    });
    await createBill(t, { bill_date: "2026-01-16" }); // pending, not in A/P
    const aging = await t.as.get(`/api/companies/${t.company.id}/bills/aging?as_of=2026-03-31`);
    expect(aging.status, aging.text).toBe(200);
    const total =
      aging.body.current.amount +
      aging.body.days_1_30.amount +
      aging.body.days_31_60.amount +
      aging.body.days_61_90.amount +
      aging.body.days_90_plus.amount;
    expect(total).toBeCloseTo(1926.75, 2);
    expect(aging.body.reconciliation.isReconciled).toBe(true);
    expect(aging.body.reconciliation.glBalance).toBeCloseTo(1926.75, 2);
    expect(aging.body.by_vendor[0].total).toBeCloseTo(1926.75, 2);
    const early = await t.as.get(`/api/companies/${t.company.id}/bills/aging?as_of=2026-01-10`);
    expect(early.body.reconciliation.agingTotal).toBe(0);
    const summary = await t.as.get(`/api/companies/${t.company.id}/bills/summary`);
    expect(summary.body.currency).toBe("AED");
    expect(summary.body.open.total).toBeCloseTo(1926.75, 2);
    expect(summary.body.pending.inPayables).toBe(false);
    // Overdue is derived from the due date (status stays approved).
    const list = await t.as.get(`${billsUrl(t)}?status=overdue`);
    expect(list.body.length).toBe(1);
    expect(list.body[0].status).toBe("approved");
    expect(list.body[0].display_status).toBe("overdue");
  });

  it("[R04-21] imports use customs VAT (Box 6 data), partial recovery splits VAT, TRN must be 15 digits", async () => {
    const t = await h.createTenant();
    const badTrn = await createBill(t, { vendor_trn: "12345" });
    expect(badTrn.status).toBe(400);
    const imp = await createBill(t, {
      vendor_trn: null,
      is_import: true,
      customs_declaration_no: "DXB-2026-0001",
      import_vat_amount: 60,
      place_of_supply: "dubai",
      line_items: [{ description: "Goods", quantity: 1, unit_price: 1000, vat_rate: 5 }],
    });
    expect(imp.status, imp.text).toBe(200);
    expect(imp.body.reverse_charge).toBe(true);
    expect(imp.body.vat_amount).toBe("60.00");
    expect(imp.body.total_amount).toBe("1000.00");
    expect((await t.as.post(`/api/bills/${imp.body.id}/approve`, {})).status).toBe(200);
    expect(await balanceFils(t, "2020")).toBe(6_000);
    const part = await approvedBill(t, { recoverable_vat_percent: 50 });
    expect(part.total_amount).toBe("1050.00");
    expect(await balanceFils(t, "1050", "debit")).toBe(6_000 + 2_500);
    const zero = await createBill(t, {
      line_items: [
        {
          description: "Exempt",
          quantity: 1,
          unit_price: 100,
          vat_rate: 5,
          vat_supply_type: "exempt",
        },
      ],
    });
    expect(zero.status).toBe(400);
    expect(zero.body.code).toBe("VAT_RATE_SUPPLY_MISMATCH");
  });
});

describe("W3-B debit notes, prepayments, vendors, approval rules, services", () => {
  it("[R04-18] a debit note reduces A/P; applying it settles the bill; aging still reconciles", async () => {
    const t = await h.createTenant();
    const bill = await approvedBill(t);
    const dn = await t.as.post(`/api/companies/${t.company.id}/debit-notes`, {
      bill_id: bill.id,
      note_date: "2026-01-25",
      reason: "Service credit",
      lines: [{ description: "Downtime credit", amount: 200, vat_rate: 5 }],
    });
    expect(dn.status, dn.text).toBe(201);
    expect(dn.body.total_amount).toBe("210.00");
    expect(await balanceFils(t, "2010")).toBe(105_000 - 21_000);
    const aging1 = await t.as.get(`/api/companies/${t.company.id}/bills/aging?as_of=2026-03-31`);
    expect(aging1.body.unapplied_credits).toBe(210);
    expect(aging1.body.reconciliation.isReconciled).toBe(true);
    const ap = await t.as.post(`/api/companies/${t.company.id}/debit-notes/${dn.body.id}/apply`, {
      bill_id: bill.id,
      amount: 210,
      date: "2026-01-26",
    });
    expect(ap.status, ap.text).toBe(200);
    expect(ap.body.bill_status).toBe("partial");
    const pay = await t.as.post(`/api/bills/${bill.id}/payments`, {
      payment_date: "2026-01-27",
      amount: 840,
    });
    expect(pay.body.bill_status).toBe("paid");
    expect(await balanceFils(t, "2010")).toBe(0);
    const aging2 = await t.as.get(`/api/companies/${t.company.id}/bills/aging?as_of=2026-03-31`);
    expect(aging2.body.reconciliation.isReconciled).toBe(true);
    expect(aging2.body.reconciliation.agingTotal).toBe(0);
  });

  it("[R04-18] prepayments, batch export, recurring bills, from-receipt drafts and attachments", async () => {
    const t = await h.createTenant();
    const pre = await t.as.post(`/api/companies/${t.company.id}/vendor-prepayments`, {
      vendor_name: "Acme Hosting LLC",
      payment_date: "2026-01-10",
      amount: 500,
    });
    expect(pre.status, pre.text).toBe(201);
    expect(await balanceFils(t, "1065", "debit")).toBe(50_000);
    const bill = await approvedBill(t);
    const applied = await t.as.post(
      `/api/companies/${t.company.id}/vendor-prepayments/${pre.body.id}/apply`,
      {
        bill_id: bill.id,
        amount: 500,
        date: "2026-01-20",
      }
    );
    expect(applied.status, applied.text).toBe(200);
    expect(applied.body.bill_status).toBe("partial");
    expect(await balanceFils(t, "1065", "debit")).toBe(0);
    expect(await balanceFils(t, "2010")).toBe(55_000);

    const csv = await t.as.post(`/api/companies/${t.company.id}/bills/payment-batch`, {
      bill_ids: [bill.id],
    });
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("amount_due");
    expect(csv.text).toContain("550.00");

    const rec = await t.as.post(`/api/companies/${t.company.id}/recurring-bills`, {
      name: "Office rent",
      frequency: "monthly",
      next_run_on: "2026-02-01",
      end_on: "2026-02-01",
      template: {
        vendor_name: "Landlord LLC",
        category: "rent",
        line_items: [{ description: "Rent", quantity: 1, unit_price: 10000, vat_rate: 5 }],
        due_in_days: 10,
      },
    });
    expect(rec.status, rec.text).toBe(201);
    const [schedule] = await h.sql("SELECT template FROM recurring_bills WHERE id = $1", [
      rec.body.id,
    ]);
    await h.sql("UPDATE recurring_bills SET template = '{}'::jsonb WHERE id = $1", [rec.body.id]);
    const failed = await t.as.post(
      `/api/companies/${t.company.id}/recurring-bills/${rec.body.id}/run`,
      {}
    );
    expect(failed.status).toBeGreaterThanOrEqual(400);
    const [unadvanced] = await h.sql(
      "SELECT next_run_on::text AS date FROM recurring_bills WHERE id = $1",
      [rec.body.id]
    );
    expect(unadvanced.date).toBe("2026-02-01");
    await h.sql("UPDATE recurring_bills SET template = $2 WHERE id = $1", [
      rec.body.id,
      schedule.template,
    ]);
    const run = await t.as.post(
      `/api/companies/${t.company.id}/recurring-bills/${rec.body.id}/run`,
      {}
    );
    expect(run.status, run.text).toBe(200);
    expect(run.body.created).toBe(true);
    expect(run.body.bill.status).toBe("pending");
    const next = await h.sql(`SELECT next_run_on::text AS d FROM recurring_bills WHERE id = $1`, [
      rec.body.id,
    ]);
    expect(next[0].d).toBe("2026-03-01");
    expect(String(run.body.bill.bill_date).slice(0, 10)).toBe("2026-02-01");
    const expired = await t.as.post(
      `/api/companies/${t.company.id}/recurring-bills/${rec.body.id}/run`,
      {}
    );
    expect(expired.body.created).toBe(false);

    const receipt = await h.sql<{ id: string }>(
      `INSERT INTO receipts (company_id, merchant, date, amount, vat_amount, currency, uploaded_by)
       VALUES ($1, 'Stationery LLC', '2026-01-12', 100, 5, 'AED', $2) RETURNING id`,
      [t.company.id, t.user.id]
    );
    const fromRc = await t.as.post(`/api/companies/${t.company.id}/bills/from-receipt`, {
      receipt_id: receipt[0].id,
    });
    expect(fromRc.status, fromRc.text).toBe(201);
    expect(fromRc.body.status).toBe("draft");
    expect(fromRc.body.total_amount).toBe("105.00");
    expect(
      (
        await t.as.post(`/api/companies/${t.company.id}/bills/from-receipt`, {
          receipt_id: receipt[0].id,
        })
      ).status
    ).toBe(409);

    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
    const att = await t.as.post(`/api/bills/${bill.id}/attachment`, {
      file: png,
      filename: "bill.png",
    });
    expect(att.status, att.text).toBe(200);
    const got = await t.as.get(`/api/bills/${bill.id}/attachment`);
    expect(got.status).toBe(200);
  });

  it("[R04-16] vendor master: TRN/name dedupe, bills link vendor_id, statement and vendor aging", async () => {
    const t = await h.createTenant();
    const url = `/api/companies/${t.company.id}/vendors`;
    const v = await t.as.post(url, {
      name: "Acme Hosting LLC",
      trn: TRN,
      payment_terms_days: 15,
      emirate: "dubai",
    });
    expect(v.status, v.text).toBe(201);
    expect((await t.as.post(url, { name: "acme hosting llc" })).status).toBe(409);
    expect((await t.as.post(url, { name: "Other", trn: TRN })).status).toBe(409);
    expect((await t.as.post(url, { name: "Bad", trn: "123" })).status).toBe(400);
    const legacy = await createBill(t, {
      vendor_trn: null,
      vendor_name: "Acme Hosting LLC",
      due_date: null,
    });
    expect(legacy.body.vendor_id).toBe(v.body.id);
    expect(String(legacy.body.due_date).slice(0, 10)).toBe("2026-01-30");
    await t.as.post(`/api/bills/${legacy.body.id}/approve`, {});
    const st = await t.as.get(`${url}/${v.body.id}/statement?to=2026-12-31`);
    expect(st.status, st.text).toBe(200);
    expect(st.body.closingBalance).toBe(1050);
    const ag = await t.as.get(`${url}/aging?as_of=2026-03-31`);
    expect(ag.body.vendors[0]).toMatchObject({ vendorId: v.body.id, total: 1050 });
    const other = await h.createSecondTenant();
    expect(
      (await other.as.get(`/api/companies/${other.company.id}/vendors/${v.body.id}`)).status
    ).toBe(404);
    await h.sql(`UPDATE vendor_bills SET vendor_id = NULL WHERE id = $1`, [legacy.body.id]);
    const headerOnly = await createBill(t, {
      vendor_name: "Acme Hosting LLC",
      bill_number: "LEGACY-HEADER-VAT",
      save_as_draft: true,
    });
    expect(headerOnly.status, headerOnly.text).toBe(200);
    await h.sql("UPDATE vendor_bills SET vendor_id = NULL WHERE id = $1", [headerOnly.body.id]);
    await h.sql("UPDATE bill_line_items SET vat_amount = 0 WHERE bill_id = $1", [
      headerOnly.body.id,
    ]);
    const bf = await t.as.post(`${url}/backfill`, {});
    expect(bf.status, bf.text).toBe(200);
    expect(bf.body.billsLinked).toBe(1);
    expect(bf.body.legacyBillsSkipped).toMatchObject({
      count: 1,
      status: 409,
      code: "LEGACY_BILL_RECLASSIFY_REQUIRED",
      message: expect.any(String),
    });
    expect(
      await h.sql("SELECT vendor_id FROM vendor_bills WHERE id = $1", [headerOnly.body.id])
    ).toEqual([{ vendor_id: null }]);
  });

  it("[R04-11][R04-19] maker-checker on bills and amount rules: '> 10,000 needs approver' blocks others", async () => {
    const owner = await h.createTenant();
    const accountant = await h.createSecondTenant();
    const approver = await h.createTenant({ name: "Approver" });
    const employee = await h.createTenant({ name: "Employee" });
    await addMember(owner, accountant, "accountant");
    await addMember(owner, approver, "approver");
    await addMember(owner, employee, "employee");

    const own = await createBill(owner);
    const self = await owner.as.post(`/api/bills/${own.body.id}/approve`, {});
    expect(self.status).toBe(403);
    expect(self.body.code).toBe("SAME_ACTOR_APPROVAL");

    const rule = await owner.as.post(`/api/companies/${owner.company.id}/approval-rules`, {
      name: "Large bills",
      document_type: "bill",
      min_amount: "10000.01",
      required_role: "approver",
    });
    expect(rule.status, rule.text).toBe(201);
    const big = await createBill(owner, {
      line_items: [{ description: "Fit-out", quantity: 1, unit_price: 12000, vat_rate: 5 }],
    });
    const byAccountant = await accountant.as.post(`/api/bills/${big.body.id}/approve`, {});
    expect(byAccountant.status).toBe(403);
    expect(byAccountant.body.code).toBe("APPROVAL_RULE_DENIED");
    const byEmployee = await employee.as.post(`/api/bills/${big.body.id}/approve`, {});
    expect(byEmployee.status).toBe(403);
    const byApprover = await approver.as.post(`/api/bills/${big.body.id}/approve`, {});
    expect(byApprover.status, byApprover.text).toBe(200);
    expect(byApprover.body.status).toBe("approved");
    const small = await accountant.as.post(`/api/bills/${own.body.id}/approve`, {});
    expect(small.status, small.text).toBe(200);

    // Two-step rule for purchase orders: accountant then approver.
    await owner.as.post(`/api/companies/${owner.company.id}/approval-rules`, {
      name: "PO step 1",
      document_type: "purchase_order",
      min_amount: "0",
      step_order: 1,
    });
    await owner.as.post(`/api/companies/${owner.company.id}/approval-rules`, {
      name: "PO step 2",
      document_type: "purchase_order",
      min_amount: "0",
      step_order: 2,
      required_role: "approver",
    });
    const po = await owner.as.post(`/api/companies/${owner.company.id}/purchase-orders`, {
      vendorName: "Acme",
      date: "2026-01-15",
      lines: [{ description: "Desks", quantity: 2, unitPrice: 100, vatRate: 5 }],
    });
    expect(po.status, po.text).toBe(201);
    const s1 = await accountant.as.post(`/api/purchase-orders/${po.body.id}/approve`, {});
    expect(s1.status, s1.text).toBe(200);
    expect(s1.body.approval.final).toBe(false);
    expect(s1.body.status).toBe("draft");
    const s2 = await approver.as.post(`/api/purchase-orders/${po.body.id}/approve`, {});
    expect(s2.status, s2.text).toBe(200);
    expect(s2.body.status).toBe("approved");
  });

  it("[R14-05] services bills.recordPayment and bills.createDraftFromInbound are registered", async () => {
    expect(has("bills.recordPayment")).toBe(true);
    expect(has("bills.createDraftFromInbound")).toBe(true);
    const t = await h.createTenant();
    const draft = await t.as.post(`/api/companies/${t.company.id}/bills/inbound`, {
      vendorName: "E-Invoice Vendor",
      vendorTrn: TRN,
      billDate: "2026-01-15",
      origin: "einvoice",
      lines: [{ description: "Item", unitPrice: 100, vatRate: 5 }],
    });
    expect(draft.status, draft.text).toBe(201);
    expect(draft.body.status).toBe("draft");
    expect(draft.body.total_amount).toBe("105.00");
    const viaService = resolve<
      (
        c: string,
        u: string,
        raw: unknown
      ) => Promise<{ bill: { status: string; total_amount: string } }>
    >("bills.createDraftFromInbound");
    const svc = await viaService(t.company.id, t.user.id, {
      vendorName: "OCR Vendor",
      billDate: "2026-01-16",
      lines: [{ description: "Scanned", unitPrice: "20.00", vatRate: 5 }],
    });
    expect(svc.bill).toMatchObject({ status: "draft", total_amount: "21.00" });
    await expect(
      viaService(t.company.id, t.user.id, { vendorName: "x", lines: [] })
    ).rejects.toThrow();
    const ledger = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../scripts/guard-baselines/ledger-writes.json"),
        "utf8"
      )
    );
    expect(ledger.files["server/services/bill-posting.service.ts"]).toBeUndefined();
    expect(ledger.files["server/routes/expense-claims.routes.ts"]).toBeUndefined();
  });
});
