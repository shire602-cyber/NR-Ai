/**
 * VAT bad-debt relief screen endpoints (FDL 8/2017 Art. 64): the claims list returns invoice number,
 * customer, the relief still to be added back and the VAT return period each date actually falls
 * in (taken from the company's returns, or the representative's group return), and the eligible
 * invoices list offers written-off invoices without an active claim. Both are tenant-scoped.
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

async function insertReturn(
  t: Tenant,
  companyId: string,
  from: string,
  to: string,
  groupId?: string,
  status = "filed"
) {
  await h.sql(
    `INSERT INTO vat_returns (company_id, period_start, period_end, due_date, status, vat_group_id, created_by)
     VALUES ($1, $2::date, $3::date, ($3::date + 28), $6, $4, $5)`,
    [companyId, from, to, groupId ?? null, t.user.id, status]
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

  it("returns invoice, customer, remaining relief and a null period when no return exists", async () => {
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
      claimReturnPeriod: null,
      reversalReturnPeriod: null,
    });
  });

  it("takes the period from the company's actual return, not from its current settings", async () => {
    const { t, invoiceId } = await setup("BDR-period");
    // A return that does not follow the default stagger: it still decides the label.
    await insertReturn(t, t.company.id, "2026-07-01", "2026-09-30", undefined, "draft");
    const c = await claim(t, invoiceId);
    let r = await list(t);
    expect(r.body[0].claimReturnPeriod).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
      status: "draft",
      source: "company",
    });
    await insertReturn(t, t.company.id, "2026-10-01", "2026-12-31", undefined, "draft");
    const rev = await t.as.post(
      `/api/companies/${t.company.id}/vat/bad-debt-relief/${c.id}/reverse`,
      { date: "2026-11-05", reason: "Customer paid" }
    );
    expect(rev.status, rev.text).toBe(200);
    r = await list(t);
    expect(r.body[0].status).toBe("reversed");
    expect(r.body[0].remainingRelief).toBeNull();
    expect(r.body[0].reversalReturnPeriod).toMatchObject({ from: "2026-10-01", to: "2026-12-31" });
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
    expect(row.remainingRelief).toBeGreaterThan(0);
    expect(row.remainingRelief).toBeLessThan(50);
    const restored = await h.sql<{ f: string }>(
      `SELECT COALESCE(SUM(ROUND((jl.credit - jl.debit) * 100)), 0)::text AS f
         FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
        WHERE je.company_id = $1 AND je.source = 'vat_bad_debt_relief' AND jl.system_vat
          AND je.status = 'posted' AND je.reversed_by_entry_id IS NULL
          AND split_part(je.idempotency_key, ':', 3) = 'recover'`,
      [t.company.id]
    );
    expect(Math.round(row.remainingRelief * 100)).toBe(5000 - Number(restored[0].f));
  });

  it("shows the representative's group return for a VAT group member", async () => {
    const rep = await h.createTenant({ name: "BDR-rep", planId: "professional" });
    const { t, invoiceId } = await setup("BDR-member");
    const g = await h.sql<{ id: string }>(
      `INSERT INTO vat_groups (representative_company_id, name, group_trn)
       VALUES ($1, 'Group', '100000000000003') RETURNING id`,
      [rep.company.id]
    );
    await h.sql(`INSERT INTO vat_group_members (group_id, company_id) VALUES ($1, $2)`, [
      g[0].id,
      t.company.id,
    ]);
    await insertReturn(rep, rep.company.id, "2026-08-01", "2026-08-31", g[0].id);
    await claim(t, invoiceId);
    const r = await list(t);
    expect(r.body[0].claimReturnPeriod).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      status: "filed",
      source: "group",
    });
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
