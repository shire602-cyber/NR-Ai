/**
 * Vendor debit note void (POST /api/companies/:companyId/debit-notes/:id/void). Mirrors the
 * customer credit-note void: one ledger transaction, kernel mirror reversal (period locks and
 * VAT_PERIOD_FILED enforced there), stock restored, refused while applied, idempotent.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";
import { dubaiToday } from "../helpers/dates";

const h = useHarness();
const TRN = "100000000000003";
const SUPPLIER_TRN = "100222333400003";
const today = () => dubaiToday();

const tenant = () =>
  h.createTenant({
    companyColumns: {
      trn_vat_number: TRN,
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
const base = (t: Tenant) => `/api/companies/${t.company.id}`;

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

async function stock(id: string) {
  const r = await h.sql<{ current_stock: number; stock_value: string }>(
    `SELECT current_stock, stock_value FROM products WHERE id = $1`,
    [id]
  );
  return { qty: Number(r[0].current_stock), value: Number(r[0].stock_value) };
}

async function approvedBill(t: Tenant, date: string, lineItems: Array<Record<string, unknown>>) {
  const b = await t.as.post(`${base(t)}/bills`, {
    vendor_name: "Supplier LLC",
    vendor_trn: SUPPLIER_TRN,
    bill_number: `B-${Math.random().toString(36).slice(2, 8)}`,
    bill_date: date,
    due_date: "2026-12-31",
    line_items: lineItems,
  });
  expect(b.status, b.text).toBe(200);
  const a = await t.as.post(`/api/bills/${b.body.id}/approve`, {});
  expect(a.status, a.text).toBe(200);
  return b.body as { id: string };
}

async function note(
  t: Tenant,
  billId: string,
  date: string,
  lines: Array<Record<string, unknown>>
) {
  const dn = await t.as.post(`${base(t)}/debit-notes`, {
    bill_id: billId,
    note_date: date,
    reason: "Mistaken credit",
    lines,
  });
  expect([200, 201], dn.text).toContain(dn.status);
  return dn.body as { id: string };
}

const voidUrl = (t: Tenant, id: string) => `${base(t)}/debit-notes/${id}/void`;

async function box9(t: Tenant, from: string, to: string) {
  const r = await t.as.get(`${base(t)}/vat/compute?from=${from}&to=${to}`);
  expect(r.status, r.text).toBe(200);
  return [r.body.boxes.box9ExpensesAmount, r.body.boxes.box9ExpensesVat];
}

describe("debit note void", () => {
  it("reverses the GL (1050, 2010) and restores VAT 201 Box 9; second void is idempotent", async () => {
    const t = await tenant();
    const d = today();
    const bill = await approvedBill(t, d, [
      { description: "Supplies", quantity: 1, unit_price: 1000, vat_rate: 5 },
    ]);
    const from = d.slice(0, 4) + "-01-01";
    const to = d.slice(0, 4) + "-12-31";
    const before = {
      ap: await bal(t, "2010"),
      vat: await bal(t, "1050"),
      b9: await box9(t, from, to),
    };
    const dn = await note(t, bill.id, d, [
      {
        description: "Discount",
        amount: 200,
        vat_rate: 5,
        account_id: (await accountByCode(t, "5060")).id,
      },
    ]);
    expect(await bal(t, "2010")).not.toBe(before.ap);
    expect(await box9(t, from, to)).not.toEqual(before.b9);

    const bad = await t.as.post(voidUrl(t, dn.id), {});
    expect(bad.status).toBe(400);
    const v = await t.as.post(voidUrl(t, dn.id), { reason: "Entered in error" });
    expect(v.status, v.text).toBe(200);
    expect(v.body.status).toBe("void");
    expect(await bal(t, "2010")).toBe(before.ap);
    expect(await bal(t, "1050")).toBe(before.vat);
    expect(await box9(t, from, to)).toEqual(before.b9);

    const again = await t.as.post(voidUrl(t, dn.id), { reason: "Entered in error" });
    expect(again.status, again.text).toBe(200);
    expect(await bal(t, "2010")).toBe(before.ap);
    const audit = await h.sql<{ n: string }>(
      `SELECT count(*)::text n FROM audit_logs WHERE company_id = $1 AND action = 'debit_note.void'`,
      [t.company.id]
    );
    expect(Number(audit[0].n)).toBe(1);
    // A void note can no longer be applied.
    const ap = await t.as.post(`${base(t)}/debit-notes/${dn.id}/apply`, {
      bill_id: bill.id,
      amount: "10.00",
    });
    expect(ap.status).toBe(409);
    expect(ap.body.code).toBe("DEBIT_NOTE_VOID");
  });

  it("refuses an applied note with DEBIT_NOTE_APPLIED and leaves the ledger alone", async () => {
    const t = await tenant();
    const d = today();
    const bill = await approvedBill(t, d, [
      { description: "Supplies", quantity: 1, unit_price: 1000, vat_rate: 5 },
    ]);
    const dn = await note(t, bill.id, d, [
      {
        description: "Discount",
        amount: 200,
        vat_rate: 5,
        account_id: (await accountByCode(t, "5060")).id,
      },
    ]);
    const ap = await t.as.post(`${base(t)}/debit-notes/${dn.id}/apply`, {
      bill_id: bill.id,
      amount: "50.00",
      date: d,
    });
    expect(ap.status, ap.text).toBe(200);
    const apBefore = await bal(t, "2010");
    const v = await t.as.post(voidUrl(t, dn.id), { reason: "Mistake" });
    expect(v.status, v.text).toBe(409);
    expect(v.body.code).toBe("DEBIT_NOTE_APPLIED");
    expect(await bal(t, "2010")).toBe(apBefore);
    const row = await h.sql<{ status: string }>(
      `SELECT status FROM vendor_debit_notes WHERE id = $1`,
      [dn.id]
    );
    expect(row[0].status).not.toBe("void");
  });

  it("refuses a note in a filed VAT period with VAT_PERIOD_FILED", async () => {
    const t = await tenant();
    const bill = await approvedBill(t, "2026-02-01", [
      { description: "Supplies", quantity: 1, unit_price: 1000, vat_rate: 5 },
    ]);
    const dn = await note(t, bill.id, "2026-02-10", [
      {
        description: "Discount",
        amount: 200,
        vat_rate: 5,
        account_id: (await accountByCode(t, "5060")).id,
      },
    ]);
    const gen = await t.as.post(`${base(t)}/vat-returns/generate`, {
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    });
    expect(gen.status, gen.text).toBe(201);
    const sub = await t.as.post(`/api/vat-returns/${gen.body.id}/submit`, {
      ftaReferenceNumber: "FTA-1",
    });
    expect(sub.status, sub.text).toBe(200);
    const apBefore = await bal(t, "2010");
    const v = await t.as.post(voidUrl(t, dn.id), { reason: "Mistake" });
    expect(v.status, v.text).toBe(409);
    expect(v.body.code).toBe("VAT_PERIOD_FILED");
    expect(await bal(t, "2010")).toBe(apBefore);
    const row = await h.sql<{ status: string }>(
      `SELECT status FROM vendor_debit_notes WHERE id = $1`,
      [dn.id]
    );
    expect(row[0].status).not.toBe("void");
  });

  it("puts returned stock back", async () => {
    const t = await tenant();
    const d = today();
    const p = await t.as.post(`${base(t)}/products`, {
      name: "Widget",
      unitPrice: 200,
      costPrice: 0,
    });
    expect(p.status, p.text).toBe(200);
    const bill = await approvedBill(t, d, [
      { description: "Widgets", quantity: 10, unit_price: 120, vat_rate: 5, product_id: p.body.id },
    ]);
    expect(await stock(p.body.id)).toEqual({ qty: 10, value: 1200 });
    const inv0 = await bal(t, "1070");
    const dn = await note(t, bill.id, d, [
      { description: "Returned", amount: 120, vat_rate: 5, product_id: p.body.id, quantity: 1 },
    ]);
    expect(await stock(p.body.id)).toEqual({ qty: 9, value: 1080 });
    const v = await t.as.post(voidUrl(t, dn.id), { reason: "Not returned after all" });
    expect(v.status, v.text).toBe(200);
    expect(await stock(p.body.id)).toEqual({ qty: 10, value: 1200 });
    expect(await bal(t, "1070")).toBe(inv0);
  });

  it("another tenant's note is a 404", async () => {
    const a = await tenant();
    const b = await tenant();
    const d = today();
    const bill = await approvedBill(a, d, [
      { description: "Supplies", quantity: 1, unit_price: 1000, vat_rate: 5 },
    ]);
    const dn = await note(a, bill.id, d, [
      {
        description: "Discount",
        amount: 200,
        vat_rate: 5,
        account_id: (await accountByCode(a, "5060")).id,
      },
    ]);
    const r = await b.as.post(voidUrl(b, dn.id), { reason: "x" });
    expect(r.status, r.text).toBe(404);
    expect(r.body.code).toBe("DEBIT_NOTE_NOT_FOUND");
    const cross = await b.as.post(voidUrl(a, dn.id), { reason: "x" });
    expect([403, 404]).toContain(cross.status);
    const row = await h.sql<{ status: string }>(
      `SELECT status FROM vendor_debit_notes WHERE id = $1`,
      [dn.id]
    );
    expect(row[0].status).not.toBe("void");
  });

  it("two parallel voids produce one reversal", async () => {
    const t = await tenant();
    const d = today();
    const bill = await approvedBill(t, d, [
      { description: "Supplies", quantity: 1, unit_price: 1000, vat_rate: 5 },
    ]);
    const before = await bal(t, "2010");
    const dn = await note(t, bill.id, d, [
      {
        description: "Discount",
        amount: 200,
        vat_rate: 5,
        account_id: (await accountByCode(t, "5060")).id,
      },
    ]);
    const rs = await Promise.all([
      t.as.post(voidUrl(t, dn.id), { reason: "dup" }),
      t.as.post(voidUrl(t, dn.id), { reason: "dup" }),
    ]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    const n = await h.sql<{ n: string }>(
      `SELECT count(*)::text n FROM journal_entries
        WHERE company_id = $1 AND reversed_entry_id IN
          (SELECT id FROM journal_entries WHERE source = 'vendor_debit_note' AND source_id = $2)`,
      [t.company.id, dn.id]
    );
    expect(Number(n[0].n)).toBe(1);
    expect(await bal(t, "2010")).toBe(before);
  });
});
