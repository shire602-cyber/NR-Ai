/**
 * S2 final sweep — purchases, inventory and claims residuals (issue ids in test names):
 *   R10-11 bill line cost centres · R05-28 blocked input VAT on bills · INT-W3 voidBillPayment
 *   audit after commit · W4-C inbound supplier credit note -> vendor credit · R04-20 claims
 *   reimbursed through payroll · W3-B claim-number duplicate repair (0111) · W4-B opening-stock
 *   valuation backfill and GRNI when a PO line is billed before receipt and the bill is voided.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";
import { repoRoot } from "./pg-admin";
import { PINT_AE_FIXTURES, fixtureCompany, type PintAeFixture } from "../fixtures/pint-ae/fixtures";
import { dubaiToday } from "../helpers/dates";

const h = useHarness();
const TRN = "100000000000003";
/** WQ2 (4.7): a supplier's TRN differs from the company's own (a self-TRN bill is refused). */
const SUPPLIER_TRN = "100222333400003";
const BUYER_TRN = "100555666700003";
const today = () => dubaiToday();

type BillSvc = typeof import("../../server/services/bill-payment.service");
type Ledger = typeof import("../../server/ledger");
type Payslip = typeof import("../../server/services/payroll/payslip");
type Generate = typeof import("../../server/services/einvoice.service").generateEInvoiceXML;
let billSvc: BillSvc;
let ledger: Ledger;
let payslip: Payslip;
let generateEInvoiceXML: Generate;
beforeAll(async () => {
  // Server modules load after the harness bound this file's database.
  billSvc = await import("../../server/services/bill-payment.service");
  ledger = await import("../../server/ledger");
  payslip = await import("../../server/services/payroll/payslip");
  ({ generateEInvoiceXML } = await import("../../server/services/einvoice.service"));
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function createBill(t: Tenant, over: Record<string, unknown> = {}) {
  return t.as.post(`/api/companies/${t.company.id}/bills`, {
    vendor_name: "Acme Hosting LLC",
    vendor_trn: SUPPLIER_TRN,
    bill_number: `B-${Math.random().toString(36).slice(2, 8)}`,
    bill_date: "2026-08-15",
    line_items: [{ description: "Hosting", quantity: 1, unit_price: 1000, vat_rate: 5 }],
    ...over,
  });
}

async function approve(t: Tenant, billId: string) {
  const a = await t.as.post(`/api/bills/${billId}/approve`, {});
  expect(a.status, a.text).toBe(200);
  return a.body;
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, tries = 60): Promise<T> {
  let v = await fn();
  for (let i = 0; i < tries && !ok(v); i++) {
    await sleep(50);
    v = await fn();
  }
  return v;
}

// ─── Bills ────────────────────────────────────────────────────────────────

describe("S2 bills", () => {
  it("[R10-11] bill create/update accept cost_center_id per line; the posted line carries it; a foreign cost centre is 404", async () => {
    const t = await h.createTenant({ planId: "enterprise" });
    const other = await h.createSecondTenant({ planId: "enterprise" });
    const cc = await t.as.post(`/api/companies/${t.company.id}/cost-centers`, {
      code: "DXB",
      name: "Dubai",
    });
    expect(cc.status, cc.text).toBe(201);
    const foreign = await other.as.post(`/api/companies/${other.company.id}/cost-centers`, {
      code: "AUH",
      name: "Abu Dhabi",
    });
    expect(foreign.status, foreign.text).toBe(201);

    const bad = await createBill(t, {
      line_items: [
        { description: "Rent", unit_price: 100, vat_rate: 5, cost_center_id: foreign.body.id },
      ],
    });
    expect(bad.status, bad.text).toBe(404);
    expect(bad.body.code).toBe("COST_CENTER_NOT_FOUND");

    const b = await createBill(t, {
      line_items: [
        { description: "Rent", unit_price: 100, vat_rate: 5, cost_center_id: cc.body.id },
        { description: "Other", unit_price: 50, vat_rate: 5 },
      ],
    });
    expect(b.status, b.text).toBe(200);
    const stored = await h.sql<{ description: string; cost_center_id: string | null }>(
      `SELECT description, cost_center_id FROM bill_line_items WHERE bill_id = $1 ORDER BY description`,
      [b.body.id]
    );
    expect(stored).toEqual([
      { description: "Other", cost_center_id: null },
      { description: "Rent", cost_center_id: cc.body.id },
    ]);
    // PATCH keeps / changes it.
    const p = await t.as.patch(`/api/bills/${b.body.id}`, {
      line_items: [
        { description: "Rent", unit_price: 120, vat_rate: 5, cost_center_id: cc.body.id },
      ],
    });
    expect(p.status, p.text).toBe(200);
    await approve(t, b.body.id);
    const lines = await h.sql<{ cost_center_id: string | null; debit: string }>(
      `SELECT jl.cost_center_id, jl.debit::text AS debit FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.source = 'bill' AND je.source_id = $1 AND jl.debit > 0 AND a.code <> '1050'`,
      [b.body.id]
    );
    expect(lines).toEqual([{ cost_center_id: cc.body.id, debit: "120.00" }]);
  });

  it("[R05-28] at the default 100% an entertainment bill's VAT is blocked into the expense; Box 9 excludes it and VAT ties to GL", async () => {
    const t = await h.createTenant({
      companyColumns: {
        trn_vat_number: TRN,
        emirate: "sharjah",
        vat_filing_frequency: "Quarterly",
        vat_period_start_month: 1,
      },
    });
    const ent = await createBill(t, {
      category: "Entertainment",
      line_items: [{ description: "Client dinner", unit_price: 1000, vat_rate: 5 }],
    });
    expect(ent.status, ent.text).toBe(200);
    await approve(t, ent.body.id);
    expect(await bal(t, "1050")).toBe(0);
    expect(await bal(t, "2010")).toBe(-105_000);
    const row = await h.sql<{ v: string | null }>(
      `SELECT recoverable_vat_base::text AS v FROM vendor_bills WHERE id = $1`,
      [ent.body.id]
    );
    expect(row[0].v).toBe("0.00");
    const exp = await h.sql<{ debit: string }>(
      `SELECT jl.debit::text AS debit FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.source = 'bill' AND je.source_id = $1 AND jl.debit > 0`,
      [ent.body.id]
    );
    expect(exp.map((e) => e.debit)).toEqual(["1050.00"]);

    // An ordinary bill still recovers; an explicit bill-level percentage still wins.
    const ok = await createBill(t);
    await approve(t, ok.body.id);
    const half = await createBill(t, { recoverable_vat_percent: 50 });
    await approve(t, half.body.id);
    expect(await bal(t, "1050")).toBe(5_000 + 2_500);
    const halfRow = await h.sql<{ v: string | null }>(
      `SELECT recoverable_vat_base::text AS v FROM vendor_bills WHERE id = $1`,
      [half.body.id]
    );
    expect(halfRow[0].v).toBeNull();

    const c = await t.as.get(
      `/api/companies/${t.company.id}/vat/compute?from=2026-07-01&to=2026-09-30`
    );
    expect(c.status, c.text).toBe(200);
    expect(c.body.boxes.box9ExpensesAmount).toBe(2_000);
    expect(c.body.boxes.box9ExpensesVat).toBe(75);
    expect(c.body.reconciliation.hasUnexplainedDifference).toBe(false);
  });

  it("[INT-W3] voidBillPayment writes its audit row only after the outer transaction commits", async () => {
    const t = await h.createTenant();
    const b = await createBill(t);
    await approve(t, b.body.id);
    const pay = async () => {
      const r = await t.as.post(`/api/bills/${b.body.id}/payments`, {
        payment_date: "2026-08-20",
        amount: 100,
      });
      expect(r.status, r.text).toBeLessThan(300);
      const rows = await h.sql<{ id: string }>(
        `SELECT id FROM bill_payments WHERE bill_id = $1 AND kind <> 'reversal' AND status = 'active'
          ORDER BY created_at DESC LIMIT 1`,
        [b.body.id]
      );
      return rows[0].id;
    };
    const audits = async () =>
      (
        await h.sql<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'bill.payment.void' AND resource_id = $1`,
          [b.body.id]
        )
      )[0].n;

    const p1 = await pay();
    await expect(
      ledger.withLedgerTx(async (tx) => {
        await billSvc.voidBillPayment({
          billId: b.body.id,
          paymentId: p1,
          companyId: t.company.id,
          actorId: t.user.id,
          reason: "bank unmatch",
          tx,
        });
        // Inside the transaction nothing is audited yet.
        expect(await audits()).toBe(0);
        throw new Error("compensation failed");
      })
    ).rejects.toThrow("compensation failed");
    await sleep(150);
    expect(await audits()).toBe(0);
    const still = await h.sql<{ status: string }>(
      `SELECT status FROM bill_payments WHERE id = $1`,
      [p1]
    );
    expect(still[0].status).toBe("active");

    await ledger.withLedgerTx((tx) =>
      billSvc.voidBillPayment({
        billId: b.body.id,
        paymentId: p1,
        companyId: t.company.id,
        actorId: t.user.id,
        reason: "bank unmatch",
        tx,
      })
    );
    expect(await waitFor(audits, (n) => n === 1)).toBe(1);
  });
});

// ─── Inbound supplier credit note ─────────────────────────────────────────

function signInbound(raw: Buffer, ts: string, companyId: string, secret: string): string {
  const mac = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${companyId}.`)
    .update(raw)
    .digest("hex");
  return `sha256=${mac}`;
}

describe("S2 inbound supplier credit notes", () => {
  const SECRET = "inbound-test-secret-0123456789abcdef";
  afterEach(() => {
    delete process.env.EINVOICE_INBOUND_WEBHOOK_SECRET;
  });

  it("[W4-C] a reviewed supplier credit note becomes one vendor debit note through the bills service", async () => {
    process.env.EINVOICE_INBOUND_WEBHOOK_SECRET = SECRET;
    const t = await h.createTenant({ companyColumns: { trn_vat_number: BUYER_TRN } });
    const f = PINT_AE_FIXTURES.find((x) => x.name === "credit note") as PintAeFixture;
    const customer = { ...f.customer, trn: BUYER_TRN, endpointId: BUYER_TRN.slice(0, 10) };
    const { xml } = generateEInvoiceXML(f.invoice, f.lines, fixtureCompany, customer, f.opts);
    const ts = String(Math.floor(Date.now() / 1000));
    const raw = Buffer.from(xml, "utf8");
    const received = await h.anon.post(
      `/api/webhooks/einvoice/${t.company.id}/inbound`,
      undefined,
      {
        raw,
        headers: {
          "Content-Type": "application/xml",
          "x-einvoice-timestamp": ts,
          "x-einvoice-signature": signInbound(raw, ts, t.company.id, SECRET),
        },
      }
    );
    expect(received.status, received.text).toBe(202);
    const inboundId = received.body.id as string;
    expect(
      (await h.sql(`SELECT 1 FROM vendor_debit_notes WHERE company_id = $1`, [t.company.id])).length
    ).toBe(0);

    const other = await h.createSecondTenant();
    const leak = await other.as.post(
      `/api/companies/${other.company.id}/bills/inbound/${inboundId}/vendor-credit`,
      {}
    );
    expect(leak.status).toBe(404);

    const conv = await t.as.post(
      `/api/companies/${t.company.id}/bills/inbound/${inboundId}/vendor-credit`,
      { reason: "Service credit reviewed" }
    );
    expect(conv.status, conv.text).toBe(201);
    const notes = await h.sql<{ id: string; total: string; number: string; vendor: string }>(
      `SELECT id, total_amount::text AS total, debit_note_number AS number, vendor_name AS vendor
         FROM vendor_debit_notes WHERE company_id = $1`,
      [t.company.id]
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].total).toBe("525.00");
    expect(notes[0].number).toBe("CN-2027-0001");
    expect(await bal(t, "2010")).toBe(52_500);
    expect(await bal(t, "1050")).toBe(-2_500);
    const inbound = await h.sql<{ status: string; debit_note_id: string }>(
      `SELECT status, debit_note_id FROM einvoice_inbound_documents WHERE id = $1`,
      [inboundId]
    );
    expect(inbound[0]).toEqual({ status: "credit_created", debit_note_id: notes[0].id });

    const again = await t.as.post(
      `/api/companies/${t.company.id}/bills/inbound/${inboundId}/vendor-credit`,
      {}
    );
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("INBOUND_ALREADY_CONVERTED");
    expect(
      (await h.sql(`SELECT 1 FROM vendor_debit_notes WHERE company_id = $1`, [t.company.id])).length
    ).toBe(1);
  });
});

// ─── Expense claims ───────────────────────────────────────────────────────

const claimItem = {
  expense_date: "2026-01-10",
  category: "Travel",
  description: "Taxi to client",
  amount: 100,
  vat_amount: 5,
  has_tax_invoice: true,
};

describe("S2 expense claims", () => {
  it("[R04-20] an approved claim is reimbursed on the next payroll run: payslip line, 2045 cleared by the salary payment", async () => {
    const t = await h.createTenant({ name: "ClaimsPayroll" });
    const emp = await t.as.post(`/api/companies/${t.company.id}/employees`, {
      fullName: "Rahul Nair",
      nationality: "IN",
      joinDate: "2018-01-01",
      basicSalary: "10000.00",
      housingAllowance: "3000.00",
      openingGratuityProvision: "0.00",
      molPersonId: "10012345678902",
      routingCode: "602620101",
      iban: "AE690260001015123456701",
      email: t.user.email,
    });
    expect(emp.status, emp.text).toBe(201);
    const c = await t.as.post(`/api/companies/${t.company.id}/expense-claims`, {
      title: "January travel",
      items: [claimItem],
    });
    expect(c.status, c.text).toBe(200);
    const claimId = c.body.id as string;
    expect((await t.as.post(`/api/expense-claims/${claimId}/submit`, {})).status).toBe(200);

    // Only approved claims can be queued.
    const early = await t.as.post(`/api/expense-claims/${claimId}/payroll-reimbursement`, {
      enabled: true,
    });
    expect(early.status).toBe(409);
    const ap = await t.as.post(`/api/expense-claims/${claimId}/approve`, {});
    expect(ap.status, ap.text).toBe(200);
    expect(await bal(t, "2045")).toBe(-10_500);

    const q = await t.as.post(`/api/expense-claims/${claimId}/payroll-reimbursement`, {
      enabled: true,
    });
    expect(q.status, q.text).toBe(200);
    expect(q.body.employee_id).toBe(emp.body.id);
    expect(q.body.reimburse_via_payroll).toBe(true);

    const run = await t.as.post(`/api/companies/${t.company.id}/payroll-runs`, {
      periodMonth: 1,
      periodYear: 2026,
    });
    expect(run.status, run.text).toBe(201);
    const runId = run.body.id as string;
    const calc = await t.as.post(`/api/payroll-runs/${runId}/calculate`, {});
    expect(calc.status, calc.text).toBe(200);
    const items = await h.sql<{ id: string; expense_reimbursement: string; net_salary: string }>(
      `SELECT id, expense_reimbursement::text, net_salary::text FROM payroll_items WHERE payroll_run_id = $1`,
      [runId]
    );
    expect(items).toHaveLength(1);
    expect(items[0].expense_reimbursement).toBe("105.00");
    const runRow = await h.sql<{ r: string }>(
      `SELECT total_expense_reimbursement::text AS r FROM payroll_runs WHERE id = $1`,
      [runId]
    );
    expect(runRow[0].r).toBe("105.00");

    // The claim is on the run: manual reimbursement would pay it twice.
    const manual = await t.as.post(`/api/expense-claims/${claimId}/mark-paid`, {});
    expect(manual.status).toBe(409);
    expect(manual.body.code).toBe("CLAIM_IN_PAYROLL");

    expect((await t.as.post(`/api/payroll-runs/${runId}/approve`, {})).status).toBe(200);
    // The accrual does not expense the claim again.
    expect(await bal(t, "2045")).toBe(-10_500);
    const slip = await payslip.loadPayslip(items[0].id, t.company.id);
    expect(slip.lines.expenseReimbursement).toBe("105.00");
    expect(Number(slip.lines.totalPaid)).toBeCloseTo(Number(items[0].net_salary) + 105, 2);

    const bank = await accountByCode(t, "1020");
    const bankBefore = await bal(t, "1020");
    const pay = await t.as.post(`/api/payroll-runs/${runId}/pay`, {
      paymentAccountId: bank.id,
      paymentDate: "2026-02-03",
    });
    expect(pay.status, pay.text).toBe(200);
    expect(await bal(t, "2045")).toBe(0);
    expect(await bal(t, "2030")).toBe(0);
    const netFils = Math.round(Number(items[0].net_salary) * 100);
    expect(bankBefore - (await bal(t, "1020"))).toBe(netFils + 10_500);
    const paid = await h.sql<{ status: string; payroll_run_id: string }>(
      `SELECT status, payroll_run_id FROM expense_claims WHERE id = $1`,
      [claimId]
    );
    expect(paid[0]).toEqual({ status: "paid", payroll_run_id: runId });

    // Reversing the salary payment makes the claim owed again.
    const unpay = await t.as.post(`/api/payroll-runs/${runId}/unpay`, { reason: "Wrong bank" });
    expect(unpay.status, unpay.text).toBe(200);
    expect(await bal(t, "2045")).toBe(-10_500);
    const reopened = await h.sql<{ status: string }>(
      `SELECT status FROM expense_claims WHERE id = $1`,
      [claimId]
    );
    expect(reopened[0].status).toBe("approved");
  });

  it("[W3-B] 0111 renumbers duplicate claim numbers with an audit trail, then creates the unique index", async () => {
    const t = await h.createTenant();
    await h.sql(`DROP INDEX IF EXISTS uniq_expense_claims_company_number`);
    const ins = (n: string, at: string) =>
      h.sql<{ id: string }>(
        `INSERT INTO expense_claims (company_id, submitted_by, claim_number, title, total_amount, currency, status, created_at)
         VALUES ($1, $2, $3, 'Legacy', 10, 'AED', 'draft', $4::timestamp) RETURNING id`,
        [t.company.id, t.user.id, n, at]
      );
    const keep = (await ins("EXP-0007", "2025-01-01"))[0].id;
    const dup1 = (await ins("EXP-0007", "2025-01-02"))[0].id;
    const dup2 = (await ins("EXP-0007", "2025-01-03"))[0].id;
    await ins("EXP-0007-R1", "2025-01-04"); // the first free suffix is skipped
    const sql = fs.readFileSync(path.join(repoRoot, "migrations/0111_s2_purchases.sql"), "utf8");
    await h.sql(sql);
    await h.sql(sql); // idempotent
    const rows = await h.sql<{ id: string; claim_number: string; from: string | null }>(
      `SELECT id, claim_number, claim_number_renumbered_from AS from FROM expense_claims
        WHERE id = ANY($1::uuid[]) ORDER BY created_at`,
      [[keep, dup1, dup2]]
    );
    expect(rows).toEqual([
      { id: keep, claim_number: "EXP-0007", from: null },
      { id: dup1, claim_number: "EXP-0007-R2", from: "EXP-0007" },
      { id: dup2, claim_number: "EXP-0007-R3", from: "EXP-0007" },
    ]);
    const audit = await h.sql<{ resource_id: string; details: string }>(
      `SELECT resource_id, details FROM audit_logs WHERE action = 'expense_claim.renumber'
        AND resource_id = ANY($1::text[]) ORDER BY resource_id`,
      [[dup1, dup2]]
    );
    expect(audit).toHaveLength(2);
    expect(JSON.parse(audit[0].details).before.claimNumber).toBe("EXP-0007");
    const idx = await h.sql(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'uniq_expense_claims_company_number'`
    );
    expect(idx).toHaveLength(1);
    await expect(ins("EXP-0007", "2025-02-01")).rejects.toThrow();
  });
});

// ─── Inventory ────────────────────────────────────────────────────────────

async function product(t: Tenant, over: Record<string, unknown> = {}) {
  const r = await t.as.post(`/api/companies/${t.company.id}/products`, {
    name: `Widget ${Math.random().toString(36).slice(2, 7)}`,
    unitPrice: 100,
    costPrice: 0,
    ...over,
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

async function grni(poLineId: string) {
  const r = await h.sql<{ received_qty: number; received_value: string; billed_ahead_qty: number }>(
    `SELECT received_qty, received_value::text, billed_ahead_qty FROM inventory_grni
      WHERE purchase_order_line_id = $1`,
    [poLineId]
  );
  return r[0]
    ? {
        received: Number(r[0].received_qty),
        value: Number(r[0].received_value),
        ahead: Number(r[0].billed_ahead_qty),
      }
    : null;
}

async function billedAheadPo(t: Tenant, productId: string) {
  const po = await t.as.post(`/api/companies/${t.company.id}/purchase-orders`, {
    vendorName: "PO Supplier",
    date: today(),
    lines: [{ description: "Widget", quantity: 4, unitPrice: 25, vatRate: 5, productId }],
  });
  expect([200, 201], po.text).toContain(po.status);
  expect((await t.as.post(`/api/purchase-orders/${po.body.id}/approve`, {})).status).toBe(200);
  const conv = await t.as.post(`/api/purchase-orders/${po.body.id}/convert-to-bill`, {});
  expect(conv.status, conv.text).toBe(201);
  await approve(t, conv.body.bill.id);
  const line = await h.sql<{ id: string }>(
    `SELECT id FROM purchase_order_lines WHERE purchase_order_id = $1`,
    [po.body.id]
  );
  return { poId: po.body.id as string, billId: conv.body.bill.id as string, lineId: line[0].id };
}

describe("S2 inventory", () => {
  it("[W4-B] GRNI: PO line billed before receipt, received, then the bill is voided -> goods stay on hand against GRNI", async () => {
    const t = await h.createTenant();
    const p = await product(t);
    const { poId, billId, lineId } = await billedAheadPo(t, p.id);
    expect(await stock(p.id)).toEqual({ qty: 4, value: 100 });
    expect(await grni(lineId)).toMatchObject({ ahead: 4 });

    const rec = await t.as.post(`/api/purchase-orders/${poId}/receive`, {});
    expect(rec.status, rec.text).toBe(200);
    expect(
      await waitFor(
        () => grni(lineId),
        (g) => g?.ahead === 0
      )
    ).toMatchObject({ ahead: 0 });
    expect(await stock(p.id)).toEqual({ qty: 4, value: 100 });
    expect(await bal(t, "2015")).toBe(0);

    const v = await t.as.post(`/api/bills/${billId}/void`, { reason: "Wrong supplier invoice" });
    expect(v.status, v.text).toBe(200);
    expect(await stock(p.id)).toEqual({ qty: 4, value: 100 });
    expect(await bal(t, "1070")).toBe(10_000);
    expect(await bal(t, "2015")).toBe(-10_000);
    expect(await bal(t, "2010")).toBe(0);
    expect(await grni(lineId)).toEqual({ received: 4, value: 100, ahead: 0 });
  });

  it("[W4-B] GRNI: billed ahead and voided before receipt -> stock leaves; the later receipt books it against GRNI", async () => {
    const t = await h.createTenant();
    const p = await product(t);
    const { poId, billId, lineId } = await billedAheadPo(t, p.id);
    const v = await t.as.post(`/api/bills/${billId}/void`, { reason: "Duplicate" });
    expect(v.status, v.text).toBe(200);
    expect(await stock(p.id)).toEqual({ qty: 0, value: 0 });
    expect(await grni(lineId)).toMatchObject({ ahead: 0 });
    expect(await bal(t, "1070")).toBe(0);

    const rec = await t.as.post(`/api/purchase-orders/${poId}/receive`, {});
    expect(rec.status, rec.text).toBe(200);
    expect(
      await waitFor(
        () => stock(p.id),
        (s) => s.qty === 4
      )
    ).toEqual({ qty: 4, value: 100 });
    expect(await bal(t, "1070")).toBe(10_000);
    expect(await bal(t, "2015")).toBe(-10_000);
  });

  it("[W4-B] opening-stock valuation backfill: reviewable proposal, posts Dr 1070 / Cr 3040 once", async () => {
    const t = await h.createTenant();
    const costed = await product(t, { costPrice: 12.5 });
    const uncosted = await product(t, { costPrice: 0 });
    // Pre-W4-B data: a quantity with no value, no layers, no journal.
    await h.sql(`UPDATE products SET current_stock = 10, stock_value = 0 WHERE id = $1`, [
      costed.id,
    ]);
    await h.sql(`UPDATE products SET current_stock = 3, stock_value = 0 WHERE id = $1`, [
      uncosted.id,
    ]);
    const url = `/api/companies/${t.company.id}/inventory/opening-backfill`;
    const proposal = await t.as.get(url);
    expect(proposal.status, proposal.text).toBe(200);
    const byId = new Map(
      (proposal.body.items as Array<{ productId: string }>).map((i) => [i.productId, i])
    );
    expect(byId.get(costed.id)).toMatchObject({
      quantity: 10,
      unitCost: "12.50",
      proposedValue: "125.00",
      needsCost: false,
    });
    expect(byId.get(uncosted.id)).toMatchObject({ quantity: 3, needsCost: true });
    // GET posts nothing.
    expect(await bal(t, "1070")).toBe(0);

    const missing = await t.as.post(url, {
      date: today(),
      items: [{ productId: uncosted.id }],
    });
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe("OPENING_COST_REQUIRED");

    const ok = await t.as.post(url, {
      date: today(),
      items: [{ productId: costed.id }, { productId: uncosted.id, unitCost: 20 }],
    });
    expect(ok.status, ok.text).toBe(201);
    expect(await stock(costed.id)).toEqual({ qty: 10, value: 125 });
    expect(await stock(uncosted.id)).toEqual({ qty: 3, value: 60 });
    expect(await bal(t, "1070")).toBe(12_500 + 6_000);
    expect(await bal(t, "3040")).toBe(-(12_500 + 6_000));

    const again = await t.as.post(url, { date: today(), items: [{ productId: costed.id }] });
    expect(again.status).toBe(409);
    expect(await bal(t, "1070")).toBe(18_500);

    // The valued stock now issues at its cost.
    const sale = await t.as.post(`/api/products/${costed.id}/movements`, {
      type: "sale",
      quantity: 2,
    });
    expect(sale.status, sale.text).toBe(200);
    expect(await stock(costed.id)).toEqual({ qty: 8, value: 100 });
    expect(await bal(t, "1070")).toBe(18_500 - 2_500);
  });
});
