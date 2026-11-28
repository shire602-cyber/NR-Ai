import { afterEach, expect, it, vi } from "vitest";
import { useHarness, accountByCode } from "./harness";
import { dubaiToday } from "../helpers/dates";

const h = useHarness();
afterEach(() => vi.unstubAllEnvs());

async function rentTemplate(t: Awaited<ReturnType<typeof h.createTenant>>, day: string) {
  const base = "/api/companies/" + t.company.id;
  const rec = await t.as.post(base + "/recurring-bills", {
    name: "Rent",
    frequency: "monthly",
    next_run_on: day,
    template: {
      vendor_name: "Landlord",
      line_items: [{ description: "Rent", quantity: 1, unit_price: 100, vat_rate: 5 }],
    },
  });
  expect(rec.status, rec.text).toBe(201);
  return {
    id: rec.body.id,
    run: () => t.as.post(base + "/recurring-bills/" + rec.body.id + "/run", {}),
  };
}

/** A product holding 10 units at AED 20, counted as `countedQty`, then 5 more received. */
async function countThenReceive(countedQty: number) {
  const t = await h.createTenant();
  const base = "/api/companies/" + t.company.id;
  const day = dubaiToday();
  const product = await t.as.post(base + "/products", {
    name: "Counted item",
    unitPrice: 100,
    costPrice: 0,
  });
  expect(product.status, product.text).toBe(200);
  const id = product.body.id;
  const bank = await accountByCode(t, "1020");
  const receive = (quantity: number) =>
    t.as.post("/api/products/" + id + "/movements", {
      type: "purchase",
      quantity,
      unitCost: 20,
      counterAccountId: bank.id,
    });
  expect((await receive(10)).status).toBe(200);
  const count = await t.as.post(base + "/stocktakes", {
    countDate: day,
    lines: [{ productId: id, countedQty }],
  });
  expect(count.status, count.text).toBe(201);
  expect((await receive(5)).status).toBe(200);
  const state = async () => {
    const [stock] = await h.sql(
      "SELECT current_stock, stock_value::text AS stock_value FROM products WHERE id=$1",
      [id]
    );
    const [journal] = await h.sql(
      "SELECT count(*)::int AS n FROM journal_entries WHERE company_id=$1",
      [t.company.id]
    );
    const [stocktake] = await h.sql("SELECT status FROM stocktakes WHERE id=$1", [count.body.id]);
    return {
      stock: [Number(stock.current_stock), Number(stock.stock_value)],
      journals: journal.n,
      status: stocktake.status,
    };
  };
  return {
    state,
    post: () => t.as.post(base + "/stocktakes/" + count.body.id + "/post", {}),
  };
}

it("AU7 preserves goods received after a completed count awaiting posting", async () => {
  const { state, post } = await countThenReceive(10);
  const posted = await post();
  expect(posted.status, posted.text).toBe(200);
  expect(await state()).toMatchObject({ stock: [15, 300], status: "posted" });
});

it("AU7 refuses a variance counted before a later receipt and changes nothing", async () => {
  const { state, post } = await countThenReceive(8);
  const before = await state();
  const posted = await post();
  expect(posted.status, posted.text).toBe(409);
  expect(posted.body.code).toBe("STOCKTAKE_STALE");
  expect(await state()).toEqual(before);
  expect(before).toMatchObject({ stock: [15, 300], status: "draft" });
});

it("AU7 creates and posts stocktakes that list the same products in opposite orders", async () => {
  const t = await h.createTenant();
  const base = "/api/companies/" + t.company.id;
  const countDate = dubaiToday();
  const ids: string[] = [];
  for (const name of ["First item", "Second item"]) {
    const product = await t.as.post(base + "/products", { name, unitPrice: 100, costPrice: 0 });
    expect(product.status, product.text).toBe(200);
    ids.push(product.body.id);
  }
  for (let round = 0; round < 5; round++) {
    const created = await Promise.all(
      [ids, [...ids].reverse()].map((order) =>
        t.as.post(base + "/stocktakes", {
          countDate,
          lines: order.map((productId) => ({ productId, countedQty: 0 })),
        })
      )
    );
    for (const r of created) expect(r.status, r.text).toBe(201);
    const posted = await Promise.all(
      created.map((r) => t.as.post(base + "/stocktakes/" + r.body.id + "/post", {}))
    );
    for (const r of posted) expect(r.status, r.text).toBe(200);
  }
});

it("AU7 keeps the recurring bill date due if creation is blocked by a closed period", async () => {
  vi.stubEnv("TZ", "UTC");
  const t = await h.createTenant();
  const day = "2026-02-01";
  const rec = await rentTemplate(t, day);
  const { lockPeriod } = await import("../../server/services/month-end.service");
  await lockPeriod(t.company.id, "2026-02-28", t.user.id);
  const attempt = await rec.run();
  expect(attempt.status, attempt.text).toBe(403);
  const [v] = await h.sql(
    "SELECT next_run_on::text AS day,last_bill_id FROM recurring_bills WHERE id=$1",
    [rec.id]
  );
  expect(v).toEqual({ day, last_bill_id: null });
});

it("AU7 claims the stored recurring-bill day when the worker runs in Dubai", async () => {
  vi.stubEnv("TZ", "Asia/Dubai");
  const tenant = await h.createTenant();
  const runDay = "2026-02-01";
  const rec = await rentTemplate(tenant, runDay);
  const result = await rec.run();
  expect(result.status, result.text).toBe(200);
  expect(result.body.created).toBe(true);
  const [bill] = await h.sql("SELECT bill_date::date::text AS day FROM vendor_bills WHERE id=$1", [
    result.body.bill.id,
  ]);
  expect(bill.day).toBe(runDay);
});
