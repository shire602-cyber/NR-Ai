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
  status = "filed",
  filingMemberIds?: string[]
) {
  // A closed group return carries its frozen filing scope, as the filing flow records it.
  const snapshot =
    groupId && filingMemberIds
      ? {
          filingVatGroup: {
            groupId,
            name: "Group",
            groupTrn: GROUP_TRN,
            memberIds: filingMemberIds,
            provenance: "recorded",
            memberAuthority: "settings.company",
          },
        }
      : null;
  await h.sql(
    `INSERT INTO vat_returns (company_id, period_start, period_end, due_date, status, vat_group_id, created_by, reconciliation_snapshot)
     VALUES ($1, $2::date, $3::date, ($3::date + 28), $6, $4, $5, $7::jsonb)`,
    [
      companyId,
      from,
      to,
      groupId ?? null,
      t.user.id,
      status,
      snapshot ? JSON.stringify(snapshot) : null,
    ]
  );
}

const GROUP_TRN = "100000000000003";

async function createGroup(rep: Tenant, members: Tenant[]) {
  const g = await h.sql<{ id: string }>(
    `INSERT INTO vat_groups (representative_company_id, name, group_trn)
     VALUES ($1, 'Group', $2) RETURNING id`,
    [rep.company.id, GROUP_TRN]
  );
  for (const m of members) {
    await h.sql(`INSERT INTO vat_group_members (group_id, company_id) VALUES ($1, $2)`, [
      g[0].id,
      m.company.id,
    ]);
  }
  return g[0].id;
}

/** What the ledger lock says closes this date: the screen must name the same return. */
async function lockPeriod(companyId: string, date: string) {
  const { db } = await import("../../server/db");
  const { findFiledVatPeriod } = await import("../../server/ledger/vat-lock");
  const closure = await findFiledVatPeriod(db, companyId, date);
  return closure && typeof closure === "object"
    ? { from: closure.periodStart, to: closure.periodEnd, status: closure.status }
    : null;
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

  it("shows the representative's filed group return when its frozen scope lists the member", async () => {
    const rep = await h.createTenant({ name: "BDR-rep", planId: "professional" });
    const { t, invoiceId } = await setup("BDR-member");
    // Claimed before the returns are filed: a closed period refuses new claims.
    await claim(t, invoiceId);
    const gid = await createGroup(rep, [t]);
    await insertReturn(rep, rep.company.id, "2026-08-01", "2026-08-31", gid, "filed", [
      rep.company.id,
      t.company.id,
    ]);
    const r = await list(t);
    expect(r.body[0].claimReturnPeriod).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      status: "filed",
      source: "group",
    });
    expect(await lockPeriod(t.company.id, CLAIMED)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      status: "filed",
    });
  });

  it("shows the member's own return when it joined after the group return was filed without it", async () => {
    const rep = await h.createTenant({ name: "BDR-rep-late", planId: "professional" });
    const { t, invoiceId } = await setup("BDR-member-late");
    // Claimed before the returns are filed: a closed period refuses new claims.
    await claim(t, invoiceId);
    const gid = await createGroup(rep, []);
    // Filed August group return: the member was not part of it.
    await insertReturn(rep, rep.company.id, "2026-08-01", "2026-08-31", gid, "filed", [
      rep.company.id,
    ]);
    await insertReturn(t, t.company.id, "2026-07-01", "2026-09-30", undefined, "filed");
    // The member joins afterwards.
    await h.sql(`INSERT INTO vat_group_members (group_id, company_id) VALUES ($1, $2)`, [
      gid,
      t.company.id,
    ]);
    const r = await list(t);
    expect(r.body[0].claimReturnPeriod).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
      status: "filed",
      source: "company",
    });
    expect(await lockPeriod(t.company.id, CLAIMED)).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
      status: "filed",
    });
  });

  it("keeps the group return for a member that left the group after the filing", async () => {
    const rep = await h.createTenant({ name: "BDR-rep-left", planId: "professional" });
    const { t, invoiceId } = await setup("BDR-member-left");
    // Claimed before the returns are filed: a closed period refuses new claims.
    await claim(t, invoiceId);
    const gid = await createGroup(rep, [t]);
    await insertReturn(rep, rep.company.id, "2026-07-01", "2026-09-30", gid, "filed", [
      rep.company.id,
      t.company.id,
    ]);
    await h.sql(`DELETE FROM vat_group_members WHERE group_id = $1 AND company_id = $2`, [
      gid,
      t.company.id,
    ]);
    const r = await list(t);
    expect(r.body[0].claimReturnPeriod).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
      status: "filed",
      source: "group",
    });
    const locked = await lockPeriod(t.company.id, CLAIMED);
    expect(locked).toEqual({ from: "2026-07-01", to: "2026-09-30", status: "filed" });
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
