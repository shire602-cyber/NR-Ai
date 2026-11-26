/**
 * PR175 audit: a stocktake locks its products in id order (zero variance included) while an
 * invoice locked them in line order, so a zero-variance stocktake and a reverse-order invoice
 * deadlocked (40P01). Invoice issue (and the other multi-product entry points) now take the
 * product locks in the same id order first. Demo data only.
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

async function stockedProduct(t: Tenant, name: string): Promise<string> {
  const p = await t.as.post(`/api/companies/${t.company.id}/products`, {
    name,
    unitPrice: 100,
    costPrice: 0,
  });
  expect(p.status, p.text).toBe(200);
  const bought = await t.as.post(`/api/products/${p.body.id}/movements`, {
    type: "purchase",
    quantity: 10,
    unitCost: 40,
    counterAccountId: (await accountByCode(t, "1020")).id,
  });
  expect(bought.status, bought.text).toBe(200);
  return p.body.id as string;
}

/** Wait until another backend is blocked by `pid`; fails after the deadline. */
async function waitUntilBlocking(pid: number, deadlineMs = 15_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const [row] = await h.sql<{ blocked: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))
       ) AS blocked`,
      [pid]
    );
    if (row.blocked) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("the invoice never blocked on the stocktake's product lock");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("inventory product lock order", () => {
  it("a zero-variance stocktake and a reverse-order invoice do not deadlock", async (ctx) => {
    // PGlite is single-connection: this needs real Postgres.
    if (!h.concurrencySupported) ctx.skip();
    const t = await h.createTenant();
    const base = `/api/companies/${t.company.id}`;
    const [low, high] = [
      await stockedProduct(t, "Demo item A"),
      await stockedProduct(t, "Demo item B"),
    ].sort();

    const stocktake = await t.as.post(`${base}/stocktakes`, {
      countDate: today(),
      lines: [
        { productId: low, countedQty: 10 },
        { productId: high, countedQty: 10 },
      ],
    });
    expect(stocktake.status, stocktake.text).toBe(201);

    const draft = await t.as.post(`${base}/invoices`, {
      customerName: "Demo Customer LLC",
      date: today(),
      lines: [high, low].map((productId) => ({
        description: "Demo item",
        quantity: 1,
        unitPrice: 100,
        vatRate: 5,
        productId,
      })),
    });
    expect(draft.status, draft.text).toBe(200);
    const [invoiceRow] = await h.sql<{ id: string; companyId: string; number: string }>(
      `SELECT id, company_id AS "companyId", number FROM invoices WHERE id = $1`,
      [draft.body.id]
    );
    const lineRows = await h.sql<{ id: string; productId: string; quantity: number }>(
      `SELECT id, product_id AS "productId", quantity FROM invoice_lines WHERE invoice_id = $1`,
      [draft.body.id]
    );
    // Reverse of the stocktake's id order, whatever order the rows come back in.
    const lines = [high, low].map((id) => lineRows.find((l) => l.productId === id)!);

    const { withLedgerTx } = await import("../../server/ledger");
    const { lockProduct, q } = await import("../../server/services/inventory/store");
    const { postStocktake } = await import("../../server/services/inventory/manual");
    const { onInvoiceIssued } = await import("../../server/services/inventory/documents");

    const locked = deferred<number>();
    const proceed = deferred<void>();
    const stocktakeRun = withLedgerTx(async (tx) => {
      await lockProduct(tx, t.company.id, low);
      const [backend] = await q<{ pid: number }>(tx, sql`SELECT pg_backend_pid() AS pid`);
      locked.resolve(Number(backend.pid));
      await proceed.promise;
      return postStocktake(tx, {
        companyId: t.company.id,
        stocktakeId: stocktake.body.id,
        actorId: t.user.id,
      });
    });
    stocktakeRun.catch((err) => locked.reject(err));
    const stocktakeDone = Promise.allSettled([stocktakeRun]);

    const pid = await locked.promise;
    const invoiceRun = withLedgerTx((tx, { afterCommit }) =>
      onInvoiceIssued(tx, {
        invoice: { ...invoiceRow, date: today(), invoiceType: "invoice" },
        lines,
        userId: t.user.id,
        afterCommit,
      })
    );
    const invoiceDone = Promise.allSettled([invoiceRun]);

    try {
      await waitUntilBlocking(pid);
      proceed.resolve();
    } catch (err) {
      proceed.reject(err); // rolls the stocktake back and releases its lock
      await Promise.all([stocktakeDone, invoiceDone]);
      throw err;
    }

    const [[s], [i]] = await Promise.all([stocktakeDone, invoiceDone]);
    expect(s.status === "rejected" ? s.reason : null).toBeNull();
    expect(i.status === "rejected" ? i.reason : null).toBeNull();

    const [posted] = await h.sql<{ status: string }>(
      `SELECT status FROM stocktakes WHERE id = $1`,
      [stocktake.body.id]
    );
    expect(posted.status).toBe("posted");
    const products = await h.sql<{ current_stock: number }>(
      `SELECT current_stock FROM products WHERE id IN ($1, $2)`,
      [low, high]
    );
    expect(products.map((p) => Number(p.current_stock))).toEqual([9, 9]);
    const movements = await h.sql<{ product_id: string; journal_entry_id: string | null }>(
      `SELECT product_id, journal_entry_id FROM inventory_movements
        WHERE source_type = 'invoice' AND source_id = $1`,
      [invoiceRow.id]
    );
    expect(movements.map((m) => m.product_id).sort()).toEqual([low, high]);
    expect(movements.every((m) => m.journal_entry_id)).toBe(true);
  });
});
