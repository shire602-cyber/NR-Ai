/**
 * F2 (G4): after-commit hooks must not carry work that has to be atomic with the document.
 *
 * - PO receipt: stock, GRNI and the inventory journal post inside the receipt's transaction, so
 *   the response is only sent after both commit and an inventory failure rolls the receipt back.
 * - Audit rows that used to be written by a detached after-commit callback are written inside the
 *   document's transaction (savepoint): they commit or roll back with it, and a failing audit
 *   insert still never aborts the business operation.
 */
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";
import { provide, resolve } from "../../server/platform/service-registry";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

async function product(t: Tenant) {
  const r = await t.as.post(`/api/companies/${t.company.id}/products`, {
    name: `Widget ${Math.random().toString(36).slice(2, 7)}`,
    unitPrice: 100,
    costPrice: 0,
  });
  expect(r.status, r.text).toBe(200);
  return r.body as { id: string };
}

async function approvedPo(t: Tenant, productId: string, quantity = 4) {
  const po = await t.as.post(`/api/companies/${t.company.id}/purchase-orders`, {
    vendorName: "PO Supplier",
    date: today(),
    lines: [{ description: "Widget", quantity, unitPrice: 25, vatRate: 5, productId }],
  });
  expect([200, 201], po.text).toContain(po.status);
  const ap = await t.as.post(`/api/purchase-orders/${po.body.id}/approve`, {});
  expect(ap.status, ap.text).toBe(200);
  return { id: po.body.id as string, lineId: po.body.lines[0].id as string };
}

async function receiptState(t: Tenant, poId: string, productId: string) {
  const [receipts, line, stock, movements, entries, grni] = await Promise.all([
    h.sql(`SELECT id FROM purchase_order_receipts WHERE purchase_order_id = $1`, [poId]),
    h.sql<{ quantity_received: string }>(
      `SELECT quantity_received FROM purchase_order_lines WHERE purchase_order_id = $1`,
      [poId]
    ),
    h.sql<{ current_stock: number }>(`SELECT current_stock FROM products WHERE id = $1`, [
      productId,
    ]),
    h.sql(
      `SELECT id FROM inventory_movements WHERE company_id = $1 AND source_type = 'po_receipt'`,
      [t.company.id]
    ),
    h.sql(`SELECT id FROM journal_entries WHERE company_id = $1 AND source = 'po_receipt'`, [
      t.company.id,
    ]),
    h.sql(`SELECT received_qty FROM inventory_grni WHERE company_id = $1`, [t.company.id]),
  ]);
  const po = await h.sql<{ status: string }>(`SELECT status FROM purchase_orders WHERE id = $1`, [
    poId,
  ]);
  return {
    receipts: receipts.length,
    received: Number(line[0].quantity_received),
    stock: Number(stock[0].current_stock),
    movements: movements.length,
    entries: entries.length,
    grniRows: grni.length,
    status: po[0].status,
  };
}

describe("F2 PO receipt posts stock + GRNI in the receipt transaction", () => {
  it("[G4] stock, GRNI and the journal exist when the 200 is returned, posted by the receiving user", async () => {
    const t = await h.createTenant();
    const p = await product(t);
    const po = await approvedPo(t, p.id);
    const rec = await t.as.post(`/api/purchase-orders/${po.id}/receive`, {});
    expect(rec.status, rec.text).toBe(200);
    expect(rec.body.inventoryUpdated).toBe(true);
    // No polling: the hand-off is no longer a detached after-commit callback.
    expect(await receiptState(t, po.id, p.id)).toEqual({
      receipts: 1,
      received: 4,
      stock: 4,
      movements: 1,
      entries: 1,
      grniRows: 1,
      status: "received",
    });
    const je = await h.sql<{ created_by: string | null }>(
      `SELECT created_by FROM journal_entries WHERE company_id = $1 AND source = 'po_receipt'`,
      [t.company.id]
    );
    expect(je[0].created_by).toBe(t.user.id);
  });

  it("[G4] an inventory failure (fractional stock quantity) is an error and rolls the receipt back", async () => {
    const t = await h.createTenant();
    const p = await product(t);
    const po = await approvedPo(t, p.id);
    const rec = await t.as.post(`/api/purchase-orders/${po.id}/receive`, {
      lines: [{ lineId: po.lineId, quantity: 1.5 }],
    });
    expect(rec.status, rec.text).toBe(422);
    expect(rec.body.code).toBe("FRACTIONAL_STOCK_QUANTITY");
    expect(await receiptState(t, po.id, p.id)).toEqual({
      receipts: 0,
      received: 0,
      stock: 0,
      movements: 0,
      entries: 0,
      grniRows: 0,
      status: "approved",
    });
    // The PO is still receivable in whole units afterwards.
    const ok = await t.as.post(`/api/purchase-orders/${po.id}/receive`, {
      lines: [{ lineId: po.lineId, quantity: 2 }],
    });
    expect(ok.status, ok.text).toBe(200);
    expect((await receiptState(t, po.id, p.id)).stock).toBe(2);
  });

  it("[G4] an injected failure after stock + GRNI were written rolls back the receipt, the stock and the journal", async () => {
    const t = await h.createTenant();
    const p = await product(t);
    const po = await approvedPo(t, p.id);
    const real = resolve<(e: unknown, outer?: unknown) => Promise<unknown>>(
      "inventory.onGoodsReceived"
    );
    provide(
      "inventory.onGoodsReceived",
      async (e: unknown, outer?: unknown) => {
        await real(e, outer);
        throw new Error("injected inventory failure");
      },
      { replace: true }
    );
    try {
      const rec = await t.as.post(`/api/purchase-orders/${po.id}/receive`, {});
      expect(rec.status).toBe(500);
    } finally {
      provide("inventory.onGoodsReceived", real, { replace: true });
    }
    expect(await receiptState(t, po.id, p.id)).toEqual({
      receipts: 0,
      received: 0,
      stock: 0,
      movements: 0,
      entries: 0,
      grniRows: 0,
      status: "approved",
    });
  });
});

describe("F2 audit rows commit with their document", () => {
  it("[G4] voiding a bill payment inside a caller transaction that rolls back leaves no audit row", async () => {
    const t = await h.createTenant();
    const b = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_name: "Acme Hosting LLC",
      vendor_trn: "100000000000003",
      bill_number: `B-${Math.random().toString(36).slice(2, 8)}`,
      bill_date: today(),
      line_items: [{ description: "Hosting", quantity: 1, unit_price: 1000, vat_rate: 5 }],
    });
    expect(b.status, b.text).toBe(200);
    expect((await t.as.post(`/api/bills/${b.body.id}/approve`, {})).status).toBe(200);
    const pay = await t.as.post(`/api/bills/${b.body.id}/payments`, {
      payment_date: today(),
      amount: 100,
    });
    expect(pay.status, pay.text).toBe(200);
    const [payment] = await h.sql<{ id: string }>(
      `SELECT id FROM bill_payments WHERE bill_id = $1`,
      [b.body.id]
    );

    const { db } = await import("../../server/db");
    const { voidBillPayment } = await import("../../server/services/bill-payment.service");
    const rollback = new Error("caller rolls back");
    await expect(
      db.transaction(async (tx) => {
        await voidBillPayment({
          billId: b.body.id,
          paymentId: payment.id,
          companyId: t.company.id,
          actorId: t.user.id,
          reason: "compensation",
          tx: tx as never,
        });
        throw rollback;
      })
    ).rejects.toBe(rollback);
    // A detached callback would have fired on the next tick regardless of the rollback.
    await new Promise((r) => setTimeout(r, 100));
    const audits = await h.sql(
      `SELECT id FROM audit_logs WHERE action = 'bill.payment.void' AND resource_id = $1`,
      [b.body.id]
    );
    expect(audits).toHaveLength(0);
    const still = await h.sql<{ status: string }>(
      `SELECT status FROM bill_payments WHERE id = $1`,
      [payment.id]
    );
    expect(still).toHaveLength(1);

    // Committed: the audit row is there as soon as the call returns.
    await voidBillPayment({
      billId: b.body.id,
      paymentId: payment.id,
      companyId: t.company.id,
      actorId: t.user.id,
      reason: "real void",
    });
    const after = await h.sql(
      `SELECT id FROM audit_logs WHERE action = 'bill.payment.void' AND resource_id = $1`,
      [b.body.id]
    );
    expect(after).toHaveLength(1);
  });

  it("[G4] recordAudit({ tx }) rolls back with the transaction and a failing audit insert never aborts it", async () => {
    const t = await h.createTenant();
    const { withLedgerTx } = await import("../../server/ledger");
    const { recordAudit } = await import("../../server/services/audit.service");
    const marker = `f2-${Math.random().toString(36).slice(2, 8)}`;

    // Rolled back with the document.
    await expect(
      withLedgerTx(async (tx) => {
        await recordAudit({
          userId: t.user.id,
          companyId: t.company.id,
          action: "f2.test",
          entityType: "test",
          entityId: `${marker}-rolled-back`,
          tx,
        });
        throw new Error("rollback");
      })
    ).rejects.toThrow("rollback");

    // A failing audit insert (unknown user FK) is contained in its savepoint.
    await withLedgerTx(async (tx) => {
      await recordAudit({
        userId: "00000000-0000-4000-8000-000000000000",
        companyId: t.company.id,
        action: "f2.test",
        entityType: "test",
        entityId: `${marker}-bad`,
        tx,
      });
      await recordAudit({
        userId: t.user.id,
        companyId: t.company.id,
        action: "f2.test",
        entityType: "test",
        entityId: `${marker}-ok`,
        tx,
      });
    });
    const rows = await h.sql<{ resource_id: string }>(
      `SELECT resource_id FROM audit_logs WHERE action = 'f2.test' AND resource_id LIKE $1`,
      [`${marker}%`]
    );
    expect(rows.map((r) => r.resource_id)).toEqual([`${marker}-ok`]);
  });
});
