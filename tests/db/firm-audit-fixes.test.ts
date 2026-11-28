/**
 * Firm and accountant tools audit (2026-11-19): assignments shown from firm_staff_assignments,
 * client links scoped like the client list, firm A/R from the settlement rule in AED, a projected
 * and batched client list, one VAT-due definition, issued-by-date counts, 404 for another
 * firm's client, and the last-login stamp.
 */
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";
import { dubaiIso } from "../helpers/dates";

const h = useHarness();
const DAY = 86_400_000;
const iso = (offsetDays: number) => dubaiIso(new Date(Date.now() + offsetDays * DAY));

async function nrOwner() {
  return h.createTenant({ name: "FirmAuditOwner", firmRole: "firm_owner" });
}

async function nrPreparer(name: string) {
  const t = await h.createTenant({ name });
  await h.sql(`UPDATE users SET firm_role = 'preparer' WHERE id = $1`, [t.user.id]);
  return t;
}

async function createClient(owner: Tenant, name: string, extra: Record<string, unknown> = {}) {
  const r = await owner.as.post("/api/firm/clients", { name, ...extra });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string; name: string };
}

async function contactFor(owner: Tenant, companyId: string) {
  const c = await owner.as.post(`/api/companies/${companyId}/customer-contacts`, {
    name: "Audit Customer",
    email: "ap@audit-customer.example",
  });
  expect(c.status, c.text).toBeLessThan(300);
  return c.body.id as string;
}

async function sentInvoice(
  owner: Tenant,
  companyId: string,
  contactId: string,
  opts: { unitPrice: number; date?: number; due?: number; currency?: string; rate?: number }
) {
  const r = await owner.as.post(`/api/companies/${companyId}/invoices`, {
    contactId,
    date: iso(opts.date ?? -60),
    dueDate: iso(opts.due ?? -30),
    ...(opts.currency ? { currency: opts.currency, exchangeRate: opts.rate } : {}),
    lines: [{ description: "Retainer", quantity: 1, unitPrice: opts.unitPrice, vatRate: 5 }],
  });
  expect(r.status, r.text).toBe(200);
  const s = await owner.as.patch(`/api/invoices/${r.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return r.body.id as string;
}

describe("firm audit fixes (2026-11-19)", () => {
  it("[defect 1] assigned staff come from firm_staff_assignments in the client list and the bookkeeper dashboard", async () => {
    const owner = await nrOwner();
    const staff = await nrPreparer("AssignedStaff");
    const c1 = await createClient(owner, "Assign Client One LLC");
    const c2 = await createClient(owner, "Assign Client Two LLC");
    const a = await owner.as.post(`/api/firm/clients/${c1.id}/assign-staff`, {
      staffUserId: staff.user.id,
      action: "assign",
    });
    expect(a.status, a.text).toBe(200);

    const list = await owner.as.get("/api/firm/clients");
    expect(list.status).toBe(200);
    const row1 = list.body.find((c: { id: string }) => c.id === c1.id);
    const row2 = list.body.find((c: { id: string }) => c.id === c2.id);
    expect(row1.assignedStaff.map((s: { id: string }) => s.id)).toEqual([staff.user.id]);
    expect(row2.assignedStaff).toEqual([]);

    const bk = await owner.as.get("/api/firm/bookkeeper-dashboard");
    expect(bk.status).toBe(200);
    const b1 = bk.body.clients.find((c: { companyId: string }) => c.companyId === c1.id);
    expect(b1.assignedStaff.map((s: { id: string }) => s.id)).toEqual([staff.user.id]);
    expect(bk.body.workload.unassignedClients).toBeGreaterThanOrEqual(1);

    // The staffer sees their own assignment on their own client.
    const mine = await staff.as.get("/api/firm/clients");
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].assignedStaff[0].id).toBe(staff.user.id);

    const un = await owner.as.post(`/api/firm/clients/${c1.id}/assign-staff`, {
      staffUserId: staff.user.id,
      action: "unassign",
    });
    expect(un.status, un.text).toBe(200);
    const after = await owner.as.get("/api/firm/clients");
    expect(after.body.find((c: { id: string }) => c.id === c1.id).assignedStaff).toEqual([]);
  });

  it("[defect 2] /firm/client-links shows unassigned staff nothing about clients they cannot see", async () => {
    const owner = await nrOwner();
    const assigned = await nrPreparer("LinksAssigned");
    const unassigned = await nrPreparer("LinksUnassigned");
    const mine = await createClient(owner, "Links Mine LLC");
    const other = await createClient(owner, "Links Secret Client LLC");
    await owner.as.post(`/api/firm/clients/${mine.id}/assign-staff`, {
      staffUserId: assigned.user.id,
      action: "assign",
    });

    const all = await owner.as.get("/api/firm/client-links");
    expect(all.status).toBe(200);
    const ids = all.body.links.map((l: { companyId: string }) => l.companyId);
    expect(ids).toEqual(expect.arrayContaining([mine.id, other.id]));

    const a = await assigned.as.get("/api/firm/client-links");
    expect(a.status).toBe(200);
    expect(a.body.links.map((l: { companyId: string }) => l.companyId)).toEqual([mine.id]);
    expect(a.text).not.toContain("Links Secret Client");

    const u = await unassigned.as.get("/api/firm/client-links");
    expect(u.status).toBe(200);
    expect(u.body.links).toEqual([]);
    expect(u.text).not.toContain(other.id);
  });

  it("[defect 4] firm A/R comes from the settlement rule in AED: partial payment, credit note and USD invoice", async () => {
    const owner = await nrOwner();
    const client = await createClient(owner, "AR Settlement Client LLC", {
      trnVatNumber: "100000000000003",
    });
    const contactId = await contactFor(owner, client.id);

    // 1,050 total, 400 paid, overdue -> 650 open.
    const partId = await sentInvoice(owner, client.id, contactId, { unitPrice: 1000 });
    const accts = await owner.as.get(`/api/companies/${client.id}/accounts`);
    const bankId = accts.body.find((a: { code: string }) => a.code === "1020")?.id as string;
    const pay = await owner.as.post(`/api/companies/${client.id}/invoices/${partId}/payments`, {
      date: iso(-10),
      method: "bank",
      paymentAccountId: bankId,
      amount: 400,
    });
    expect(pay.status, pay.text).toBe(201);

    // Fully credited -> 0 open (status forced back to sent so only the settlement rule can tell).
    const cnInv = await sentInvoice(owner, client.id, contactId, { unitPrice: 1000 });
    const cn = await owner.as.post(`/api/companies/${client.id}/invoices/${cnInv}/credit-note`, {});
    expect(cn.status, cn.text).toBe(201);
    await h.sql(`UPDATE invoices SET status = 'sent' WHERE id = $1`, [cnInv]);

    // USD 1,050 at 3.6725 -> 3,856.125 AED, rounded per document to fils.
    await sentInvoice(owner, client.id, contactId, {
      unitPrice: 1000,
      currency: "USD",
      rate: 3.6725,
    });

    const expectedOpen = 650 + 3856.13;
    const list = await owner.as.get("/api/firm/clients");
    const row = list.body.find((c: { id: string }) => c.id === client.id);
    expect(row.outstandingAr).toBeCloseTo(expectedOpen, 2);

    const overview = await owner.as.get("/api/firm/overview");
    expect(overview.body.overdueAr).toBeCloseTo(expectedOpen, 2);

    const cc = await owner.as.get("/api/firm/command-center/dashboard");
    expect(cc.status, cc.text).toBe(200);
    expect(cc.body.summary.totalOutstandingAr).toBeCloseTo(expectedOpen, 2);

    // Ties to the aging report (the same settlement fragments the GL 1040 control reconciles to).
    const { agedReceivables } = await import("../../server/reporting/aging");
    const aging = await agedReceivables({ companyId: client.id, asOf: iso(0) });
    expect(aging.totals.total).toBeCloseTo(expectedOpen, 2);
  });

  it("[defect 7] the client list is projected, sortable, pageable and uses a fixed number of queries", async () => {
    const owner = await nrOwner();
    const names = ["Zeta Co LLC", "Alpha Co LLC", "Mid Co LLC", "النور للتجارة", "Delta Co LLC"];
    const made: { id: string }[] = [];
    for (const n of names) made.push(await createClient(owner, n));
    await h
      .sql(
        `UPDATE companies SET wps_employer_iban = 'AE070331234567890123456', einvoice_payee_iban = 'AE070331234567890123457' WHERE id = ANY($1::uuid[])`,
        [made.map((m) => m.id)]
      )
      .catch(() => undefined);

    const { pool } = await import("../../server/db");
    const spy = (await import("vitest")).vi.spyOn(pool, "query");
    const res = await owner.as.get("/api/firm/clients");
    const statements = spy.mock.calls.length;
    spy.mockRestore();
    expect(res.status).toBe(200);
    const mine = res.body.filter((c: { id: string }) => made.some((m) => m.id === c.id));
    expect(mine).toHaveLength(5);
    // Auth + scope + a handful of grouped statements, not six per client.
    expect(statements).toBeLessThanOrEqual(20);
    expect(res.text).not.toMatch(/iban|wps/i);

    const sorted = await owner.as.get("/api/firm/clients?sort=name&order=asc&limit=2&offset=1");
    expect(sorted.headers.get("x-total-count")).toBe(String(res.body.length));
    expect(sorted.body.map((c: { name: string }) => c.name)).toHaveLength(2);
    const byName = (await owner.as.get("/api/firm/clients?sort=name&order=asc")).body.map(
      (c: { name: string }) => c.name.toLowerCase()
    );
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b)));

    const found = await owner.as.get(`/api/firm/clients?q=${encodeURIComponent("نور")}`);
    expect(found.body.map((c: { name: string }) => c.name)).toContain("النور للتجارة");

    const lite = await owner.as.get("/api/firm/clients?view=names");
    expect(Object.keys(lite.body[0]).sort()).toEqual(["id", "name"]);
  });

  it("[defect 9] one VAT-due count and invoices issued this month count by issue date", async () => {
    const owner = await nrOwner();
    const c = await createClient(owner, "Consistency Client LLC", {
      trnVatNumber: "100000000000003",
    });
    const contactId = await contactFor(owner, c.id);
    // Back-dated invoice created today: must not count as issued this month.
    await sentInvoice(owner, c.id, contactId, { unitPrice: 100, date: -70, due: -40 });
    await sentInvoice(owner, c.id, contactId, { unitPrice: 100, date: 0, due: 30 });

    const cc = await owner.as.get("/api/firm/command-center/dashboard");
    expect(cc.status, cc.text).toBe(200);
    expect(cc.body.summary.invoicesIssuedThisMonth).toBe(1);

    const bk = await owner.as.get("/api/firm/bookkeeper-dashboard");
    const overview = await owner.as.get("/api/firm/overview");
    expect(overview.body.vatDueThisMonth).toBe(bk.body.summary.vatDue28Days);
  });

  it("[defect 11] another firm's client is a 404, not a 403, on health, comms log and email intake", async () => {
    const owner = await nrOwner();
    const stranger = await h.createTenant({ name: "SaasCompany" });
    for (const url of [
      `/api/firm/command-center/clients/${stranger.company.id}/health`,
      `/api/firm/comms/log/${stranger.company.id}`,
      `/api/firm/email-intake/completeness/${stranger.company.id}?periodStart=2026-01-01&periodEnd=2026-03-31`,
    ]) {
      const r = await owner.as.get(url);
      expect(r.status, url).toBe(404);
    }
    // An own-firm client the preparer is not assigned to stays a 403.
    const staff = await nrPreparer("Unassigned403");
    const mine = await createClient(owner, "Own Firm Unassigned LLC");
    const r = await staff.as.get(`/api/firm/comms/log/${mine.id}`);
    expect(r.status).toBe(403);
  });

  it("[defect 17] a successful password sign-in stamps last login for staff management", async () => {
    const owner = await nrOwner();
    const staff = await nrPreparer("LoginStamp");
    await h.sql(`UPDATE users SET last_login_at = NULL WHERE id = $1`, [staff.user.id]);
    const before = await owner.as.get("/api/firm/staff");
    const row0 = before.body.find((s: { id: string }) => s.id === staff.user.id);
    expect(row0.lastLoginAt ?? null).toBeNull();
    const login = await h.anon.post("/api/auth/login", {
      email: staff.email,
      password: staff.password,
    });
    expect(login.status, login.text).toBe(200);
    const after = await owner.as.get("/api/firm/staff");
    const row1 = after.body.find((s: { id: string }) => s.id === staff.user.id);
    expect(row1.lastLoginAt).toBeTruthy();
  });
});
