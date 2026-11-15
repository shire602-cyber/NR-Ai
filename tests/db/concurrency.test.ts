/**
 * Concurrency and integrity regressions on the real app + real Postgres
 * (port of tests/integration/concurrency.test.mjs, R20-02).
 *
 * Every case was a real defect found by firing parallel requests at the
 * running app: they only show up when two requests interleave between a
 * check and the write it guards. Rate limits are effectively off in the
 * harness, so no case can be "skipped" by a 429.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { accountByCode, ledgerTotals, useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);
const parallel = <T>(n: number, fn: (i: number) => Promise<T>) =>
  Promise.all(Array.from({ length: n }, (_, i) => fn(i)));

let t: Tenant;

async function mkInvoice(price: number, customerName = "C") {
  const r = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName,
    date: today(),
    lines: [{ description: "x", quantity: 1, unitPrice: price, vatRate: 5 }],
  });
  expect(r.status, r.text).toBe(200);
  return r.body as { id: string; number: string };
}

async function issue(id: string) {
  const r = await t.as.patch(`/api/invoices/${id}/status`, { status: "sent" });
  expect(r.status, r.text).toBeLessThan(300);
}

describe.skipIf(process.env.HARNESS_MODE !== "postgres")("concurrency (real Postgres)", () => {
  beforeAll(async () => {
    t = await h.createTenant({ name: "Conc" });
    const r = await t.as.patch(`/api/companies/${t.company.id}`, {
      trnVatNumber: "100123456700003",
      vatRegistered: true,
      emirate: "dubai",
    });
    expect(r.status, r.text).toBe(200);
  });

  it("20 parallel invoices get unique, gap-free numbers", async () => {
    const res = await parallel(20, (i) =>
      t.as.post(`/api/companies/${t.company.id}/invoices`, {
        customerName: `P${i}`,
        date: today(),
        lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 5 }],
      })
    );
    expect(res.map((r) => r.status)).toEqual(Array(20).fill(200));
    const nums = res.map((r) => r.body.number as string);
    expect(new Set(nums).size).toBe(20);
    const seq = nums.map((x) => Number(String(x).split("-").pop())).sort((a, b) => a - b);
    expect(seq[seq.length - 1] - seq[0]).toBe(19);
  });

  it("10 parallel issues recognise revenue exactly once", async () => {
    const inv = await mkInvoice(500);
    await parallel(10, () => t.as.patch(`/api/invoices/${inv.id}/status`, { status: "sent" }));
    const rows = await h.sql(
      `SELECT id FROM journal_entries WHERE company_id = $1 AND source_id = $2 AND status = 'posted'`,
      [t.company.id, inv.id]
    );
    expect(rows.length).toBe(1);
  });

  it("5 parallel full credit notes produce exactly one", async () => {
    const inv = await mkInvoice(800);
    await issue(inv.id);
    const res = await parallel(5, () =>
      t.as.post(`/api/companies/${t.company.id}/invoices/${inv.id}/credit-note`, {})
    );
    const accepted = res.filter((r) => r.status < 400);
    expect(accepted.length, JSON.stringify(res.map((r) => r.status))).toBe(1);
    expect(res.filter((r) => r.status >= 500)).toEqual([]);
  });

  it("10 parallel full payments accept exactly one", async () => {
    const bank = await accountByCode(t, "1020");
    const inv = await mkInvoice(1000);
    await issue(inv.id);
    const res = await parallel(10, () =>
      t.as.post(`/api/companies/${t.company.id}/invoices/${inv.id}/payments`, {
        amount: 1050,
        date: today(),
        method: "cash",
        paymentAccountId: bank.id,
      })
    );
    const accepted = res.filter((r) => r.status < 400);
    expect(accepted.length, JSON.stringify(res.map((r) => r.status))).toBe(1);
    const paid = await h.sql<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM invoice_payments WHERE invoice_id = $1`,
      [inv.id]
    );
    expect(Number(paid[0].total)).toBeCloseTo(1050, 2);
  });

  it("rejects negative and two-sided journal lines", async () => {
    const bank = await accountByCode(t, "1020");
    let r = await t.as.post(`/api/companies/${t.company.id}/journal`, {
      date: today(),
      description: "neg",
      lines: [
        { accountId: bank.id, debit: -100, credit: 0 },
        { accountId: bank.id, debit: 0, credit: -100 },
      ],
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("NEGATIVE_JOURNAL_AMOUNT");
    r = await t.as.post(`/api/companies/${t.company.id}/journal`, {
      date: today(),
      description: "both",
      lines: [
        { accountId: bank.id, debit: 100, credit: 100 },
        { accountId: bank.id, debit: 0, credit: 0 },
      ],
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("LINE_HAS_BOTH_SIDES");
  });

  it("ignores companyType self-promotion instead of failing", async () => {
    const r = await t.as.patch(`/api/companies/${t.company.id}`, { companyType: "nra" });
    expect(r.status).toBe(200);
    expect(r.body.companyType).not.toBe("nra");
  });

  it("whole ledger still balances after the concurrent abuse", async () => {
    const totals = await ledgerTotals(t.company.id);
    expect(totals.debit).toBeGreaterThan(0);
    expect(Math.abs(totals.debit - totals.credit)).toBeLessThan(0.01);
    const tb = await t.as.get(`/api/companies/${t.company.id}/reports/trial-balance`);
    expect(tb.status).toBe(200);
  });
});

describe.skipIf(process.env.HARNESS_MODE === "postgres")("concurrency (PGlite fallback)", () => {
  it.skip(`skipped: ${process.env.HARNESS_FALLBACK_REASON ?? "PGlite is single-connection"}`, () => {});
});
