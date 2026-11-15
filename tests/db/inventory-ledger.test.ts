/**
 * W4-B inventory accounting against the real ledger: R10-01, R10-02, R10-09, R10-14, R10-15,
 * R10-16. Every assertion reads journal_lines × accounts of a fresh tenant.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

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

const move = (t: Tenant, id: string, body: Record<string, unknown>) =>
  t.as.post(`/api/products/${id}/movements`, body);

/** Natural (debit − credit) balance in fils for an account code. */
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

async function invoice(t: Tenant, lines: Record<string, unknown>[]) {
  const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Acme LLC",
    date: today(),
    lines,
  });
  expect(c.status, c.text).toBe(200);
  return c.body as { id: string };
}
const issue = (t: Tenant, id: string) =>
  t.as.patch(`/api/invoices/${id}/status`, { status: "sent" });

async function approvedBill(t: Tenant, lines: Record<string, unknown>[]) {
  const b = await t.as.post(`/api/companies/${t.company.id}/bills`, {
    vendor_name: "Stock Supplier LLC",
    vendor_trn: "100000000000003",
    bill_number: `B-${Math.random().toString(36).slice(2, 8)}`,
    bill_date: today(),
    line_items: lines,
  });
  expect(b.status, b.text).toBe(200);
  const a = await t.as.post(`/api/bills/${b.body.id}/approve`, {});
  expect(a.status, a.text).toBe(200);
  return a.body as { id: string };
}

describe("W4-B inventory ledger", () => {
  it("[R10-01] manual purchase and sale post Inventory / GRNI and COGS / Inventory at weighted average", async () => {
    const t = await h.createTenant();
    const p = await product(t);
    expect((await move(t, p.id, { type: "purchase", quantity: 10, unitCost: 50 })).status).toBe(
      200
    );
    expect((await move(t, p.id, { type: "purchase", quantity: 10, unitCost: 70 })).status).toBe(
      200
    );
    const s = await move(t, p.id, { type: "sale", quantity: 5 });
    expect(s.status, s.text).toBe(200);
    expect(s.body.journalEntryId).toBeTruthy();
    expect(await bal(t, "1070")).toBe(90_000);
    expect(await bal(t, "5005")).toBe(30_000);
    expect(await bal(t, "2015")).toBe(-120_000);
    expect(await stock(p.id)).toEqual({ qty: 15, value: 900 });
  });

  it("[R10-14] FIFO costing per company: COGS 250, inventory 950", async () => {
    const t = await h.createTenant();
    const set = await t.as.put(`/api/companies/${t.company.id}/inventory/settings`, {
      costingMethod: "fifo",
    });
    expect(set.status, set.text).toBe(200);
    const p = await product(t);
    await move(t, p.id, { type: "purchase", quantity: 10, unitCost: 50 });
    await move(t, p.id, { type: "purchase", quantity: 10, unitCost: 70 });
    await move(t, p.id, { type: "sale", quantity: 5 });
    expect(await bal(t, "5005")).toBe(25_000);
    expect(await bal(t, "1070")).toBe(95_000);
    const bogus = await t.as.put(`/api/companies/${t.company.id}/inventory/settings`, {
      costingMethod: "lifo",
    });
    expect(bogus.status).toBe(400);
  });

  it("[R10-02][R10-15] an approved bill with a product line debits 1070 (not expense) and increases stock; void restores both", async () => {
    const t = await h.createTenant();
    const p = await product(t);
    const bill = await approvedBill(t, [
      { description: "Widgets", quantity: 10, unit_price: 50, vat_rate: 5, product_id: p.id },
      { description: "Freight", quantity: 1, unit_price: 20, vat_rate: 5 },
    ]);
    expect(await bal(t, "1070")).toBe(50_000);
    expect(await bal(t, "5000")).toBe(2_000);
    expect(await bal(t, "2010")).toBe(-(52_000 + 2_600));
    expect(await stock(p.id)).toEqual({ qty: 10, value: 500 });
    const mv = await h.sql(
      `SELECT journal_entry_id FROM inventory_movements WHERE source_type = 'bill' AND source_id = $1`,
      [bill.id]
    );
    expect(mv).toHaveLength(1);
    expect(mv[0].journal_entry_id).toBeTruthy();
    const v = await t.as.post(`/api/bills/${bill.id}/void`, { reason: "Wrong supplier" });
    expect(v.status, v.text).toBe(200);
    expect(await bal(t, "1070")).toBe(0);
    expect(await stock(p.id)).toEqual({ qty: 0, value: 0 });
  });

  it("[R10-02] issuing an invoice with a product line reduces stock and posts COGS in the same transaction; void restores both", async () => {
    const t = await h.createTenant();
    const p = await product(t);
    await move(t, p.id, { type: "purchase", quantity: 10, unitCost: 40 });
    const inv = await invoice(t, [
      { description: "Widget", quantity: 3, unitPrice: 100, vatRate: 5, productId: p.id },
    ]);
    // Draft: no stock moves yet.
    expect((await stock(p.id)).qty).toBe(10);
    const s = await issue(t, inv.id);
    expect(s.status, s.text).toBe(200);
    expect(await stock(p.id)).toEqual({ qty: 7, value: 280 });
    expect(await bal(t, "5005")).toBe(12_000);
    expect(await bal(t, "4010")).toBe(-30_000);
    const cogs = await h.sql(
      `SELECT je.id FROM journal_entries je WHERE je.source = 'invoice_cogs' AND je.source_id = $1`,
      [inv.id]
    );
    expect(cogs).toHaveLength(1);
    const v = await t.as.patch(`/api/invoices/${inv.id}/status`, { status: "void" });
    expect(v.status, v.text).toBe(200);
    expect(await stock(p.id)).toEqual({ qty: 10, value: 400 });
    expect(await bal(t, "5005")).toBe(0);
    expect(await bal(t, "1070")).toBe(40_000);
  });

  it("[R10-02] over-selling on an invoice is 422 INSUFFICIENT_STOCK with no movement and the invoice stays draft", async () => {
    const t = await h.createTenant();
    const p = await product(t);
    await move(t, p.id, { type: "purchase", quantity: 2, unitCost: 40 });
    const inv = await invoice(t, [
      { description: "Widget", quantity: 5, unitPrice: 100, vatRate: 5, productId: p.id },
    ]);
    const s = await issue(t, inv.id);
    expect(s.status, s.text).toBe(422);
    expect(s.body.code).toBe("INSUFFICIENT_STOCK");
    const mv = await h.sql(`SELECT 1 FROM inventory_movements WHERE source_id = $1`, [inv.id]);
    expect(mv).toHaveLength(0);
    const row = await h.sql(`SELECT status FROM invoices WHERE id = $1`, [inv.id]);
    expect(row[0].status).toBe("draft");
    expect(await bal(t, "4010")).toBe(0);
  });

  it("[R10-09] an adjustment below zero is blocked by default; allowed with a warning when the company enables negative stock", async () => {
    const t = await h.createTenant();
    const p = await product(t, { costPrice: 10 });
    await move(t, p.id, { type: "purchase", quantity: 5, unitCost: 10 });
    const blocked = await move(t, p.id, { type: "adjustment", quantity: -10 });
    expect(blocked.status, blocked.text).toBe(422);
    expect(blocked.body.code).toBe("INSUFFICIENT_STOCK");
    expect((await stock(p.id)).qty).toBe(5);
    await t.as.put(`/api/companies/${t.company.id}/inventory/settings`, {
      allowNegativeStock: true,
    });
    const ok = await move(t, p.id, { type: "adjustment", quantity: -10 });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.newStock).toBe(-5);
    expect(ok.body.warnings).toContain("NEGATIVE_STOCK");
    expect(await bal(t, "5007")).toBe(10_000);
  });

  it("[R10-15] valuation report equals GL 1070 after purchases, sales, a bill, a write-down and a credit note", async () => {
    const t = await h.createTenant();
    const p = await product(t);
    await move(t, p.id, { type: "purchase", quantity: 7, unitCost: 33.33 });
    await approvedBill(t, [
      { description: "More", quantity: 3, unit_price: 41, vat_rate: 5, product_id: p.id },
    ]);
    const inv = await invoice(t, [
      { description: "Widget", quantity: 4, unitPrice: 90, vatRate: 5, productId: p.id },
    ]);
    expect((await issue(t, inv.id)).status).toBe(200);
    const wd = await t.as.post(`/api/products/${p.id}/write-down`, {
      amount: 12.34,
      reason: "Obsolete",
    });
    expect(wd.status, wd.text).toBe(201);
    const cn = await t.as.post(`/api/companies/${t.company.id}/invoices/${inv.id}/credit-note`, {
      lines: [{ description: "Widget", quantity: 1, unitPrice: 90, vatRate: 5, productId: p.id }],
    });
    expect(cn.status, cn.text).toBe(201);
    expect((await stock(p.id)).qty).toBe(7);
    const val = await t.as.get(`/api/companies/${t.company.id}/inventory/valuation`);
    expect(val.status, val.text).toBe(200);
    expect(val.body.reconciled).toBe(true);
    expect(val.body.difference).toBe("0.00");
    expect(Math.round(Number(val.body.glBalance) * 100)).toBe(await bal(t, "1070"));
    const age = await t.as.get(`/api/companies/${t.company.id}/inventory/ageing`);
    expect(age.status).toBe(200);
    expect(age.body.totals[0].qty).toBe(7);
  });

  it("[R10-16] a transfer between warehouses leaves the total unchanged; a stocktake variance posts to 5007", async () => {
    const t = await h.createTenant();
    const p = await product(t);
    await move(t, p.id, { type: "purchase", quantity: 10, unitCost: 20 });
    const list = await t.as.get(`/api/companies/${t.company.id}/warehouses`);
    const main = list.body.find((w: { is_default: boolean }) => w.is_default);
    const dxb = await t.as.post(`/api/companies/${t.company.id}/warehouses`, {
      code: "DXB",
      name: "Dubai store",
      nameAr: "متجر دبي",
    });
    expect(dxb.status, dxb.text).toBe(201);
    const tr = await t.as.post(`/api/companies/${t.company.id}/inventory/transfers`, {
      productId: p.id,
      fromWarehouseId: main.id,
      toWarehouseId: dxb.body.id,
      quantity: 4,
    });
    expect(tr.status, tr.text).toBe(201);
    expect(tr.body).toMatchObject({ fromLevel: 6, toLevel: 4 });
    expect(await stock(p.id)).toEqual({ qty: 10, value: 200 });
    const tooMany = await t.as.post(`/api/companies/${t.company.id}/inventory/transfers`, {
      productId: p.id,
      fromWarehouseId: dxb.body.id,
      toWarehouseId: main.id,
      quantity: 5,
    });
    expect(tooMany.status).toBe(422);
    // Count 3 in Dubai (system 4): shortage of 1 @20.
    const st = await t.as.post(`/api/companies/${t.company.id}/stocktakes`, {
      warehouseId: dxb.body.id,
      countDate: today(),
      lines: [{ productId: p.id, countedQty: 3 }],
    });
    expect(st.status, st.text).toBe(201);
    const posted = await t.as.post(
      `/api/companies/${t.company.id}/stocktakes/${st.body.id}/post`,
      {}
    );
    expect(posted.status, posted.text).toBe(200);
    expect(await bal(t, "5007")).toBe(2_000);
    expect(await stock(p.id)).toEqual({ qty: 9, value: 180 });
    const again = await t.as.post(
      `/api/companies/${t.company.id}/stocktakes/${st.body.id}/post`,
      {}
    );
    expect(again.status).toBe(409);
  });

  it("[R10-16] selling a bundle consumes its components at cost; reorder list flags low stock", async () => {
    const t = await h.createTenant();
    const a = await product(t, { reorderPoint: 5 });
    const b = await product(t);
    await move(t, a.id, { type: "purchase", quantity: 10, unitCost: 10 });
    await move(t, b.id, { type: "purchase", quantity: 10, unitCost: 5 });
    const kit = await product(t, { productType: "bundle", name: "Kit" });
    const comp = await t.as.put(`/api/products/${kit.id}/components`, {
      components: [
        { productId: a.id, quantity: 2 },
        { productId: b.id, quantity: 1 },
      ],
    });
    expect(comp.status, comp.text).toBe(200);
    const inv = await invoice(t, [
      { description: "Kit", quantity: 3, unitPrice: 100, vatRate: 5, productId: kit.id },
    ]);
    expect((await issue(t, inv.id)).status).toBe(200);
    expect((await stock(a.id)).qty).toBe(4);
    expect((await stock(b.id)).qty).toBe(7);
    expect(await bal(t, "5005")).toBe(6 * 1000 + 3 * 500);
    const re = await t.as.get(`/api/companies/${t.company.id}/inventory/reorder`);
    expect(re.body.map((r: { productId: string }) => r.productId)).toEqual([a.id]);
  });

  it("[R10-02] purchase-order receipt books stock against GRNI; the converted bill clears GRNI", async () => {
    const t = await h.createTenant();
    const p = await product(t);
    const po = await t.as.post(`/api/companies/${t.company.id}/purchase-orders`, {
      vendorName: "PO Supplier",
      date: today(),
      lines: [{ description: "Widget", quantity: 4, unitPrice: 25, vatRate: 5, productId: p.id }],
    });
    if (po.status !== 200 && po.status !== 201) {
      throw new Error(`PO create failed ${po.status} ${po.text}`);
    }
    await t.as.post(`/api/purchase-orders/${po.body.id}/approve`, {});
    const rec = await t.as.post(`/api/purchase-orders/${po.body.id}/receive`, {});
    expect(rec.status, rec.text).toBe(200);
    expect(rec.body.inventoryUpdated).toBe(true);
    // The hand-off runs after the PO commit.
    for (let i = 0; i < 40 && (await stock(p.id)).qty === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(await stock(p.id)).toEqual({ qty: 4, value: 100 });
    expect(await bal(t, "2015")).toBe(-10_000);
    const conv = await t.as.post(`/api/purchase-orders/${po.body.id}/convert-to-bill`, {});
    expect(conv.status, conv.text).toBe(201);
    const ap = await t.as.post(`/api/bills/${conv.body.bill.id}/approve`, {});
    expect(ap.status, ap.text).toBe(200);
    expect(await bal(t, "2015")).toBe(0);
    expect(await stock(p.id)).toEqual({ qty: 4, value: 100 });
    expect(await bal(t, "1070")).toBe(10_000);
  });

  it("[R10-01] opening stock on product creation posts Inventory / Opening Balance Equity", async () => {
    const t = await h.createTenant();
    const p = await product(t, { currentStock: 6, costPrice: 12.5 });
    expect(await stock(p.id)).toEqual({ qty: 6, value: 75 });
    expect(await bal(t, "1070")).toBe(7_500);
    expect(await bal(t, "3040")).toBe(-7_500);
    const bank = await accountByCode(t, "1020");
    const r = await move(t, p.id, {
      type: "purchase",
      quantity: 1,
      unitCost: 12.5,
      counterAccountId: bank.id,
    });
    expect(r.status, r.text).toBe(200);
    expect(await bal(t, "1020")).toBe(-1_250);
  });
});
