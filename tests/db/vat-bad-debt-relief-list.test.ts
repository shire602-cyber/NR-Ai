/**
 * VAT bad-debt relief screen endpoints (FDL 8/2017 Art. 64): the claims list returns invoice number,
 * customer and the relief still to be added back (the VAT return each date lands in is covered by
 * vat-bad-debt-relief-return-attribution.test.ts), and the eligible invoices list offers
 * written-off invoices without an active claim. Both are tenant-scoped.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

const WRITTEN_OFF = "2026-08-18";
const CLAIMED = "2026-08-20";

async function setup(name: string) {
  const t = await h.createTenant({ name, planId: "professional" });
  const c = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
    name: "Acme LLC",
    email: "ap@acme.example",
  });
  expect(c.status, c.text).toBeLessThan(300);
  const i = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    contactId: c.body.id,
    placeOfSupplyEmirate: "dubai",
    date: "2026-01-10",
    lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(i.status, i.text).toBe(200);
  expect((await t.as.patch(`/api/invoices/${i.body.id}/status`, { status: "sent" })).status).toBe(
    200
  );
  const w = await t.as.post(`/api/companies/${t.company.id}/invoices/${i.body.id}/write-off`, {
    date: WRITTEN_OFF,
    reason: "Insolvency",
  });
  expect(w.status, w.text).toBe(201);
  return { t, invoiceId: i.body.id as string, number: i.body.number as string };
}

async function claim(t: Tenant, invoiceId: string) {
  const r = await t.as.post(`/api/companies/${t.company.id}/vat/bad-debt-relief`, {
    invoiceId,
    claimDate: CLAIMED,
    writtenOff: true,
    customerNotified: true,
    customerNotifiedAt: "2026-08-19",
  });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string };
}

const list = (t: Tenant, companyId = t.company.id) =>
  t.as.get(`/api/companies/${companyId}/vat/bad-debt-relief`);
const eligible = (t: Tenant, companyId = t.company.id) =>
  t.as.get(`/api/companies/${companyId}/vat/bad-debt-relief/eligible-invoices`);

async function insertFiledReturn(t: Tenant, from: string, to: string) {
  await h.sql(
    `INSERT INTO vat_returns (company_id, period_start, period_end, due_date, status, created_by)
     VALUES ($1, $2::date, $3::date, ($3::date + 28), 'filed', $4)`,
    [t.company.id, from, to, t.user.id]
  );
}

describe("bad-debt relief claims list and eligible invoices", () => {
  it("offers a written-off invoice until it is claimed", async () => {
    const { t, invoiceId, number } = await setup("BDR-eligible");
    const before = await eligible(t);
    expect(before.status, before.text).toBe(200);
    expect(before.body.map((r: { id: string }) => r.id)).toEqual([invoiceId]);
    expect(before.body[0]).toMatchObject({ number, customerName: "Acme LLC" });
    await claim(t, invoiceId);
    expect((await eligible(t)).body).toEqual([]);
  });

  it("returns invoice, customer and remaining relief, with a forecast return when none is recorded", async () => {
    const { t, invoiceId, number } = await setup("BDR-list");
    const c = await claim(t, invoiceId);
    const r = await list(t);
    expect(r.status, r.text).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({
      id: c.id,
      invoiceNumber: number,
      customerName: "Acme LLC",
      remainingRelief: 50,
    });
    // Exact attribution has its own file (vat-bad-debt-relief-return-attribution.test.ts).
    expect(r.body[0].claimReturn).toMatchObject({ status: "forecast", source: "forecast" });
    expect(r.body[0].reversalReturns).toEqual([]);
  });

  it("refuses a reversal dated in a filed period with the server's VAT_PERIOD_FILED error", async () => {
    const { t, invoiceId } = await setup("BDR-locked");
    const c = await claim(t, invoiceId);
    await insertFiledReturn(t, "2026-07-01", "2026-09-30");
    const rev = await t.as.post(
      `/api/companies/${t.company.id}/vat/bad-debt-relief/${c.id}/reverse`,
      { date: "2026-09-10", reason: "Customer paid" }
    );
    expect(rev.status, rev.text).toBe(409);
    expect(rev.body.code ?? rev.body.error?.code).toBe("VAT_PERIOD_FILED");
    // The claim stays active with its full remaining relief.
    const r = await list(t);
    expect(r.body[0]).toMatchObject({ status: "claimed", remainingRelief: 50 });
    // The same reversal dated in the next, open period is accepted.
    const ok = await t.as.post(
      `/api/companies/${t.company.id}/vat/bad-debt-relief/${c.id}/reverse`,
      { date: "2026-10-05", reason: "Customer paid" }
    );
    expect(ok.status, ok.text).toBe(200);
    expect((await list(t)).body[0]).toMatchObject({ status: "reversed", remainingRelief: null });
  });

  it("reports only the relief not yet recovered through customer part-payments", async () => {
    const { t, invoiceId } = await setup("BDR-remaining");
    await claim(t, invoiceId);
    const bank = await accountByCode(t, "1020");
    const pay = await t.as.post(`/api/companies/${t.company.id}/invoices/${invoiceId}/payments`, {
      amount: 300,
      date: "2026-09-01",
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBe(201);
    const r = await list(t);
    const row = r.body[0];
    expect(row.status).toBe("claimed");
    // 300 of 1,050 paid recovers 14.29 of the 50.00 relief, leaving exactly 35.71.
    expect(row.remainingRelief).toBe(35.71);
    const restored = await h.sql<{ f: string }>(
      `SELECT COALESCE(SUM(ROUND((jl.credit - jl.debit) * 100)), 0)::text AS f
         FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
        WHERE je.company_id = $1 AND je.source = 'vat_bad_debt_relief' AND jl.system_vat
          AND je.status = 'posted' AND je.reversed_by_entry_id IS NULL
          AND split_part(je.idempotency_key, ':', 3) = 'recover'`,
      [t.company.id]
    );
    expect(Math.round(row.remainingRelief * 100)).toBe(5000 - Number(restored[0].f));

    // Reversing posts exactly the remaining figure the screen showed, to the fil.
    const rev = await t.as.post(
      `/api/companies/${t.company.id}/vat/bad-debt-relief/${row.id}/reverse`,
      { date: "2026-09-15", reason: "Customer paid" }
    );
    expect(rev.status, rev.text).toBe(200);
    const manual = await h.sql<{ f: string }>(
      `SELECT COALESCE(SUM(ROUND((jl.credit - jl.debit) * 100)), 0)::text AS f
         FROM bad_debt_relief_claims c
         JOIN journal_lines jl ON jl.entry_id = c.reversal_entry_id
        WHERE c.id = $1 AND jl.system_vat`,
      [row.id]
    );
    expect(Number(manual[0].f)).toBe(3571);
  });

  it("answers 404 when another tenant reverses a claim it does not own", async () => {
    const a = await setup("BDR-rev-a");
    const c = await claim(a.t, a.invoiceId);
    const b = await h.createTenant({ name: "BDR-rev-b", planId: "professional" });
    const rev = await b.as.post(
      `/api/companies/${b.company.id}/vat/bad-debt-relief/${c.id}/reverse`,
      { date: "2026-10-05", reason: "Not mine" }
    );
    expect(rev.status, rev.text).toBe(404);
    expect((await list(a.t)).body[0]).toMatchObject({ status: "claimed", remainingRelief: 50 });
  });

  it("never exposes another tenant's claims or invoices", async () => {
    const a = await setup("BDR-iso-a");
    await claim(a.t, a.invoiceId);
    const b = await h.createTenant({ name: "BDR-iso-b", planId: "professional" });
    for (const get of [list, eligible]) {
      const cross = await get(b, a.t.company.id);
      expect([403, 404]).toContain(cross.status);
      expect(cross.text).not.toContain(a.invoiceId);
    }
    expect((await list(b)).body).toEqual([]);
    expect((await eligible(b)).body).toEqual([]);
  });
});
