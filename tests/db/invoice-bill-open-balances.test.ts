/**
 * D5a: the Invoices status tiles (Open / Overdue) and the Bill Pay summary tiles show the
 * remaining balance owed, not document totals, and tie to the dashboard outstanding / AP figures.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freezeTime, useHarness, type Tenant } from "./harness";
import { NOW, insertBill, insertInvoice, insertPayment } from "./w3e-seed";
import { computeInvoiceTiles } from "../../client/src/lib/invoice-tiles";

const h = useHarness();
let t: Tenant;
let restore: () => void;
const base = () => `/api/companies/${t.company.id}`;

beforeAll(async () => {
  restore = freezeTime(NOW);
  t = await h.createTenant();
  // Partially paid, overdue: 5,250 total, 1,000 paid -> 4,250 owed.
  const a = await insertInvoice(h.sql, t, {
    number: "INV-A",
    customer: "Beta Trading",
    date: "2026-09-15",
    due: "2026-10-16",
    subtotal: 5000,
    vat: 250,
    status: "partial",
  });
  await insertPayment(h.sql, t, a, 1000, "2026-10-20");
  // Foreign currency, partially paid, not yet due: USD 1,000 at 3.67, USD 400 paid -> AED 2,202.
  const b = await insertInvoice(h.sql, t, {
    number: "INV-B",
    customer: "Gamma Inc",
    date: "2026-11-10",
    due: "2026-12-10",
    subtotal: 1000,
    vat: 0,
    status: "partial",
  });
  await h.sql(
    `UPDATE invoices SET currency = 'USD', exchange_rate = 3.67, base_currency_amount = 3670 WHERE id = $1`,
    [b]
  );
  await insertPayment(h.sql, t, b, 400, "2026-11-12");
  // Unpaid, sent, due soon.
  await insertInvoice(h.sql, t, {
    number: "INV-C",
    customer: "Alpha Co",
    date: "2026-11-10",
    due: "2026-12-10",
    subtotal: 2000,
    vat: 100,
    status: "sent",
  });
  await insertInvoice(h.sql, t, {
    number: "INV-D",
    customer: "Draft Co",
    date: "2026-11-12",
    due: "2026-12-12",
    subtotal: 9000,
    vat: 450,
    status: "draft",
  });
  const e = await insertInvoice(h.sql, t, {
    number: "INV-E",
    customer: "Paid Co",
    date: "2026-10-01",
    due: "2026-10-31",
    subtotal: 300,
    vat: 0,
    status: "paid",
  });
  await insertPayment(h.sql, t, e, 300, "2026-10-20");

  // Bills: partially paid approved, unpaid overdue approved, pending (not a payable).
  const b1 = await insertBill(h.sql, t, {
    vendor: "Landlord LLC",
    number: "B-1",
    date: "2026-10-01",
    due: "2026-10-31",
    subtotal: 1000,
    vat: 50,
    status: "partial",
  });
  await h.sql(`INSERT INTO bill_payments (bill_id, payment_date, amount) VALUES ($1, $2, 300)`, [
    b1,
    "2026-11-02T00:00:00Z",
  ]);
  await h.sql(`UPDATE vendor_bills SET amount_paid = 300 WHERE id = $1`, [b1]);
  await insertBill(h.sql, t, {
    vendor: "Supplier Co",
    number: "B-2",
    date: "2026-11-01",
    due: "2026-12-20",
    subtotal: 400,
    vat: 20,
    status: "approved",
  });
  await insertBill(h.sql, t, {
    vendor: "Pending Co",
    number: "B-3",
    date: "2026-11-05",
    due: "2026-12-05",
    subtotal: 800,
    vat: 0,
    status: "pending",
  });
});
afterAll(() => restore());

describe("D5a invoice list balances", () => {
  it("?all=true returns amountPaid / openBalance / openBalanceBase per invoice", async () => {
    const r = await t.as.get(`${base()}/invoices?all=true`);
    expect(r.status).toBe(200);
    const by = (n: string) => r.body.find((i: { number: string }) => i.number === n);
    expect(by("INV-A")).toMatchObject({
      amountPaid: 1000,
      openBalance: 4250,
      openBalanceBase: 4250,
    });
    expect(by("INV-B")).toMatchObject({ amountPaid: 400, openBalance: 600 });
    expect(by("INV-B").openBalanceBase).toBeCloseTo(2202, 2);
    expect(by("INV-C")).toMatchObject({ amountPaid: 0, openBalance: 2100 });
    expect(by("INV-D").openBalance).toBe(0);
    // existing fields untouched
    expect(by("INV-A").total).toBe(5250);
    expect(by("INV-A").status).toBe("partial");
  });

  it("paginated list carries the same fields and keeps its envelope", async () => {
    const r = await t.as.get(`${base()}/invoices?limit=2`);
    expect(r.status).toBe(200);
    expect(r.body.limit).toBe(2);
    expect(r.body.items).toHaveLength(2);
    expect(r.body.nextCursor).toBeTruthy();
    for (const i of r.body.items) expect(typeof i.openBalanceBase).toBe("number");
  });

  it("Open + Overdue tile values equal the dashboard outstanding", async () => {
    const list = await t.as.get(`${base()}/invoices?all=true`);
    const stats = await t.as.get(`${base()}/dashboard/stats`);
    const tiles = computeInvoiceTiles(list.body, new Date(NOW));
    const open = tiles.find((x) => x.key === "open")!;
    const overdue = tiles.find((x) => x.key === "overdue")!;
    expect(open.value).toBeCloseTo(4250 + 2202 + 2100, 2);
    expect(open.value).toBeCloseTo(stats.body.outstanding, 2);
    expect(open.count).toBe(3);
    expect(overdue.value).toBeCloseTo(4250, 2);
    expect(overdue.count).toBe(1);
  });
});

describe("D5a bill pay summary", () => {
  it("open / partial / overdue are remaining balances and open equals the dashboard AP", async () => {
    const s = await t.as.get(`${base()}/bills/summary`);
    const stats = await t.as.get(`${base()}/dashboard/stats`);
    expect(s.status).toBe(200);
    // B-1 1,050 total - 300 paid = 750 (overdue, partial); B-2 420 approved; pending excluded.
    expect(s.body.open.total).toBeCloseTo(1170, 2);
    expect(s.body.open.total).toBeCloseTo(stats.body.outstandingPayables, 2);
    expect(s.body.partial).toMatchObject({ count: 1, total: 750, paid: 300 });
    expect(s.body.approved.total).toBeCloseTo(420, 2);
    expect(s.body.overdue).toMatchObject({ count: 1, total: 750 });
    expect(s.body.pending.total).toBe(800);
  });
});
