/**
 * PERF-AGING: GET /bills/aging (and the other aged receivables / payables reads) got faster
 * (payables use one query and independent receivable reads run together) with
 * byte-identical output.
 *
 * The golden file was written by the code before the change (commit 97ffb62) on the books seeded
 * here: open and part-paid invoices and bills, a USD invoice and a EUR bill revalued at period
 * end (the FX reconciling line), manual control-account adjustments on 1040 and 2010, an
 * unapplied debit note, vendors with ids and name-only bills. Ids (uuids) are replaced by their
 * order of first appearance. Regenerate only for a deliberate output change:
 * PERF_AGING_WRITE_GOLDEN=1 npx vitest run --config tests/db/vitest.config.ts <this file>.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accountByCode, freezeTime, useHarness, type Tenant } from "./harness";
import { PERF_DASH_NOW, seedPerfDashBooks } from "./perf-dash-fixtures";

const h = useHarness();
const GOLDEN = path.join(__dirname, "golden", "perf-aging.golden.json");
const WRITE = process.env.PERF_AGING_WRITE_GOLDEN === "1";
let a: Tenant;
let b: Tenant;
let fx: Tenant;
let restore: () => void;

async function ok<T = any>(r: { status: number; text: string; body: T }, what: string): Promise<T> {
  expect(r.status, `${what}: ${r.text.slice(0, 400)}`).toBeLessThan(300);
  return r.body;
}

async function seedFx(): Promise<Tenant> {
  const t = await h.createTenant({
    name: "PerfAging FX",
    planId: "professional",
    companyColumns: { trn_vat_number: "100000000000003", emirate: "dubai" },
  });
  const cid = t.company.id;
  const rate = async (from: string, r: number, effectiveDate: string) =>
    ok(
      await t.as.post(`/api/companies/${cid}/exchange-rates`, {
        fromCurrency: from,
        rate: r,
        effectiveDate,
      }),
      `rate ${from}`
    );
  await rate("USD", 3.6725, "2026-09-01");
  await rate("EUR", 4.0, "2026-09-01");
  const usdBank = await ok(
    await t.as.post(`/api/companies/${cid}/bank-accounts`, {
      nameEn: "USD account",
      bankName: "FAB",
      currency: "USD",
    }),
    "usd bank"
  );

  // Receivables: a USD invoice part paid, an AED invoice overdue, one not yet due.
  const invoice = async (o: Record<string, unknown>) => {
    const c = await ok(
      await t.as.post(`/api/companies/${cid}/invoices`, {
        customerName: "Acme LLC",
        placeOfSupplyEmirate: "dubai",
        ...o,
      }),
      "invoice"
    );
    await ok(await t.as.patch(`/api/invoices/${c.id}/status`, { status: "sent" }), "sent");
    return c as { id: string };
  };
  const line = (unitPrice: number) => [
    { description: "Work", quantity: 1, unitPrice, vatRate: 0, vatSupplyType: "zero_rated" },
  ];
  const usdInv = await invoice({
    date: "2026-09-02",
    currency: "USD",
    exchangeRate: 3.6725,
    lines: line(1000),
  });
  await ok(
    await t.as.post(`/api/companies/${cid}/invoices/${usdInv.id}/payments`, {
      amount: 600,
      date: "2026-09-20",
      paymentAccountId: usdBank.glAccountId,
      exchangeRate: 3.68,
    }),
    "usd payment"
  );
  await invoice({
    customerName: "Globex FZE",
    date: "2026-06-15",
    lines: line(2500),
  });
  await invoice({ customerName: "Globex FZE", date: "2026-10-25", lines: line(900) });
  await invoice({ customerName: "Initech", date: "2026-03-01", lines: line(4000) });

  // Payables: vendors with ids, a name-only bill, a EUR bill, a part-paid bill.
  const vendor = async (name: string) =>
    (await ok(await t.as.post(`/api/companies/${cid}/vendors`, { name }), `vendor ${name}`)) as {
      id: string;
    };
  const v1 = await vendor("Landlord LLC");
  const v2 = await vendor("Cloud Hosting Co");
  const bill = async (o: Record<string, unknown>) => {
    const c = await ok(
      await t.as.post(`/api/companies/${cid}/bills`, {
        bill_date: "2026-09-10",
        line_items: [{ description: "Svc", quantity: 1, unit_price: 1000, vat_rate: 5 }],
        ...o,
      }),
      "bill"
    );
    await ok(await t.as.post(`/api/bills/${c.id}/approve`, {}), "approve");
    return c as { id: string };
  };
  const billA = await bill({
    vendor_id: v1.id,
    vendor_name: "Landlord LLC",
    bill_number: "L-1",
    bill_date: "2026-07-01",
    due_date: "2026-08-01",
  });
  await bill({
    vendor_id: v1.id,
    vendor_name: "Landlord LLC",
    bill_number: "L-2",
    bill_date: "2026-10-01",
    due_date: "2026-11-30",
  });
  const billB = await bill({
    vendor_id: v2.id,
    vendor_name: "Cloud Hosting Co",
    bill_number: "C-1",
    bill_date: "2026-09-01",
    due_date: "2026-10-01",
  });
  await bill({ vendor_name: "Walk-in Supplies", bill_number: "W-1", bill_date: "2026-10-05" });
  await bill({
    vendor_name: "Euro Vendor GmbH",
    bill_number: "EUR-1",
    bill_date: "2026-09-05",
    currency: "EUR",
    exchange_rate: "4",
    line_items: [{ description: "Consulting", quantity: 1, unit_price: 1000, vat_rate: 5 }],
  });
  const cash = await accountByCode(t, "1010");
  await ok(
    await t.as.post(`/api/bills/${billB.id}/payments`, {
      payment_date: "2026-10-10",
      amount: 400,
      payment_account_id: cash.id,
    }),
    "bill payment"
  );
  // A draft bill and a voided one never age.
  await t.as.post(`/api/companies/${cid}/bills`, {
    vendor_name: "Draft Vendor",
    bill_number: "D-1",
    bill_date: "2026-10-12",
    line_items: [{ description: "Svc", quantity: 1, unit_price: 50, vat_rate: 5 }],
  });
  // A debit note that no bill absorbs reduces A/P without settling a document.
  await ok(
    await t.as.post(`/api/companies/${cid}/debit-notes`, {
      vendor_id: v1.id,
      note_date: "2026-10-20",
      reason: "Overcharge refund",
      lines: [{ description: "Refund", amount: 200, vat_rate: 5 }],
    }),
    "debit note"
  );
  void billA;

  // Period-end revaluation of the USD receivable and the EUR payable (the FX reconciling line).
  await rate("USD", 3.69, "2026-10-31");
  await rate("EUR", 4.1, "2026-10-31");
  await ok(
    await t.as.post(`/api/companies/${cid}/exchange-rates/revalue`, { asOf: "2026-10-31" }),
    "revalue"
  );

  // Manual control-account adjustments (A2 H8) on 1040 and 2010.
  const ar = await accountByCode(t, "1040");
  const ap = await accountByCode(t, "2010");
  const eq = await accountByCode(t, "3010");
  await ok(
    await t.as.post(`/api/companies/${cid}/journal`, {
      date: "2026-10-28",
      status: "posted",
      controlAdjustment: { reason: "Opening A/R not loaded as documents" },
      lines: [
        { accountId: ar.id, debit: 500 },
        { accountId: eq.id, credit: 500 },
      ],
    }),
    "ar adjustment"
  );
  await ok(
    await t.as.post(`/api/companies/${cid}/journal`, {
      date: "2026-11-02",
      status: "posted",
      controlAdjustment: { reason: "Opening A/P not loaded as documents" },
      lines: [
        { accountId: ap.id, credit: 320 },
        { accountId: eq.id, debit: 320 },
      ],
    }),
    "ap adjustment"
  );
  return t;
}

beforeAll(async () => {
  restore = freezeTime(PERF_DASH_NOW);
  ({ a, b } = await seedPerfDashBooks(h));
  fx = await seedFx();
});
afterAll(() => restore());

const AS_OF = ["", "?as_of=2026-10-31", "?as_of=2026-12-31", "?as_of=2026-01-15"];
const REPORT_AS_OF = ["2026-10-31", "2026-11-15", "2026-12-31", "2026-01-15"];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
function normalise(body: unknown): string {
  const ids = new Map<string, string>();
  return JSON.stringify(body).replace(UUID, (id) => {
    if (!ids.has(id)) ids.set(id, `<id${ids.size + 1}>`);
    return ids.get(id)!;
  });
}

async function responses(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, t] of Object.entries({ a, b, fx })) {
    const cid = t.company.id;
    const get = async (key: string, url: string) => {
      const r = await t.as.get(url);
      expect(r.status, `${name} ${key}: ${r.text.slice(0, 300)}`).toBe(200);
      out[`${name} ${key}`] = normalise(r.body);
    };
    for (const q of AS_OF) {
      await get(`bills/aging${q}`, `/api/companies/${cid}/bills/aging${q}`);
      await get(`vendors/aging${q}`, `/api/companies/${cid}/vendors/aging${q}`);
    }
    for (const d of REPORT_AS_OF) {
      await get(`aged-payables ${d}`, `/api/companies/${cid}/reports/aged-payables?asOf=${d}`);
      await get(
        `aged-receivables ${d}`,
        `/api/companies/${cid}/reports/aged-receivables?asOf=${d}`
      );
      await get(`legacy aging ${d}`, `/api/reports/${cid}/aging?asOf=${d}`);
    }
  }
  return out;
}

describe("PERF-AGING aging output is unchanged", () => {
  it("every AP / AR aging response is byte-identical to the golden file", async () => {
    const got = await responses();
    if (WRITE) {
      fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + "\n");
      return;
    }
    const want = JSON.parse(fs.readFileSync(GOLDEN, "utf8")) as Record<string, string>;
    expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
    for (const k of Object.keys(want)) expect(got[k], k).toBe(want[k]);
    // The FX books exercise the reconciling line, the control adjustments and unapplied credits.
    const parse = (k: string) => JSON.parse(want[k]);
    const ap = parse("fx aged-payables 2026-10-31");
    const ar = parse("fx aged-receivables 2026-10-31");
    expect(ap.reconciliation.reconcilingItems.length).toBe(1);
    expect(ap.unappliedCredits).toBeGreaterThan(0);
    expect(ar.reconciliation.reconcilingItems.length).toBe(1);
    expect(ar.reconciliation.controlAdjustments).not.toBe(0);
    expect(parse("fx aged-payables 2026-11-15").reconciliation.controlAdjustments).not.toBe(0);
    const bills = JSON.parse(want["fx bills/aging?as_of=2026-12-31"]);
    expect(bills.by_vendor.some((v: any) => v.vendorId)).toBe(true);
    expect(bills.by_vendor.some((v: any) => !v.vendorId)).toBe(true);
  });

  it("a chart without 1040 / 2010 falls back to the receivable / payable account by name, VAT and tax accounts excluded", async () => {
    if (WRITE) return;
    const t = await h.createTenant({ name: "PerfAging Chart" });
    await h.sql(
      `UPDATE accounts SET code = CASE code WHEN '1040' THEN '1041' WHEN '2010' THEN '2011' ELSE code END
        WHERE company_id = $1`,
      [t.company.id]
    );
    const { agedPayables, agedReceivables } = await import("../../server/reporting");
    const ar = await agedReceivables({ companyId: t.company.id, asOf: "2026-11-15" });
    const ap = await agedPayables({ companyId: t.company.id, asOf: "2026-11-15" });
    expect(ar.reconciliation.controlAccountCode).toBe("1041");
    expect(ar.reconciliation.controlAccountName).toBe("Accounts Receivable");
    expect(ap.reconciliation.controlAccountCode).toBe("2011");
    expect(ap.reconciliation.controlAccountName).toBe("Accounts Payable");
  });

  it("checks membership against the company in the bill aging path", async () => {
    const allowed = await a.as.get(`/api/companies/${a.company.id}/bills/aging`);
    expect(allowed.status).toBe(200);

    const denied = await a.as.get(
      `/api/companies/${b.company.id}/bills/aging?companyId=${a.company.id}`
    );
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("COMPANY_ACCESS_DENIED");
  });

  it("loads the bills/aging report with one database query per company", async () => {
    if (WRITE) return;
    const { pool } = await import("../../server/db");
    const { payablesAging } = await import("../../server/services/vendor.service");
    const { agedReceivables } = await import("../../server/reporting");
    for (const t of [a, b, fx]) {
      const spy = vi.spyOn(pool, "query");
      try {
        await payablesAging(t.company.id, "2026-11-15");
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockClear();
        await agedReceivables({ companyId: t.company.id, asOf: "2026-11-15" });
        expect(spy.mock.calls.length).toBeLessThanOrEqual(5);
      } finally {
        spy.mockRestore();
      }
    }
  });
});
