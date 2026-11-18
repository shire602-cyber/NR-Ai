/**
 * PR-65 port: the two cross-tenant write holes fixed on main by
 * `fix/team-member-company-scoping`, re-proved against this line's tenancy
 * helpers (scopedGet / scopedUpdate / scopedDelete; another tenant's row is a
 * 404, never a 403).
 *
 *   1. Team members: PUT/DELETE /api/companies/:companyId/team/:memberId used
 *      to mutate company_users by :memberId alone, so an owner of A could
 *      change or remove a member of B by supplying B's membership row id.
 *   2. Firm client edits: PUT /api/firm/clients/:companyId let a firm_owner
 *      rewrite a self-signup SaaS customer's company (name, TRN, emirate)
 *      because the firm owner's accessible set used to be "all".
 */
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";

async function membershipId(companyId: string, userId: string): Promise<string> {
  const rows = await h.sql(`SELECT id FROM company_users WHERE company_id = $1 AND user_id = $2`, [
    companyId,
    userId,
  ]);
  return rows[0].id;
}

async function addMember(owner: Tenant, role: string, name: string): Promise<string> {
  const t = await h.createTenant({ name });
  await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [
    owner.company.id,
    t.user.id,
    role,
  ]);
  return membershipId(owner.company.id, t.user.id);
}

describe("PR-65 team members are scoped to the company in the URL", () => {
  it("PR-65: owner of A cannot change or remove B's members with B's row ids (404, rows untouched)", async () => {
    const a = await h.createTenant({ name: "P65TeamA" });
    const b = await h.createSecondTenant({ name: "P65TeamB" });
    const bStaff = await addMember(b, "accountant", "P65StaffB");
    const bOwner = await membershipId(b.company.id, b.user.id);

    for (const target of [bStaff, bOwner]) {
      const put = await a.as.put(`/api/companies/${a.company.id}/team/${target}`, {
        role: "owner",
      });
      expect(put.status, put.text).toBe(404);
      const del = await a.as.delete(`/api/companies/${a.company.id}/team/${target}`);
      expect(del.status, del.text).toBe(404);
    }

    const rows = await h.sql(
      `SELECT id, company_id, role FROM company_users WHERE id::text = ANY($1::text[]) ORDER BY role`,
      [[bStaff, bOwner]]
    );
    expect(rows).toEqual([
      { id: bStaff, company_id: b.company.id, role: "accountant" },
      { id: bOwner, company_id: b.company.id, role: "owner" },
    ]);
  });

  it("PR-65: owner of B cannot act on A's team through A's URL (refused, A untouched)", async () => {
    const a = await h.createTenant({ name: "P65OutsiderA" });
    const b = await h.createSecondTenant({ name: "P65OutsiderB" });
    const aStaff = await addMember(a, "employee", "P65StaffA");
    const del = await b.as.delete(`/api/companies/${a.company.id}/team/${aStaff}`);
    expect([403, 404]).toContain(del.status);
    const rows = await h.sql(`SELECT role FROM company_users WHERE id = $1`, [aStaff]);
    expect(rows).toEqual([{ role: "employee" }]);
  });

  it("PR-65: the owner still manages their own team; the last owner cannot be removed", async () => {
    const a = await h.createTenant({ name: "P65Own" });
    const staff = await addMember(a, "employee", "P65OwnStaff");
    const put = await a.as.put(`/api/companies/${a.company.id}/team/${staff}`, {
      role: "accountant",
    });
    expect(put.status, put.text).toBe(200);
    expect(put.body.role).toBe("accountant");
    expect((await a.as.delete(`/api/companies/${a.company.id}/team/${staff}`)).status).toBe(204);

    const owner = await membershipId(a.company.id, a.user.id);
    const last = await a.as.delete(`/api/companies/${a.company.id}/team/${owner}`);
    expect(last.status).toBe(409);
    expect(last.body.code).toBe("LAST_OWNER");
  });

  it("PR-65: a role-change body cannot re-home the membership to another company", async () => {
    const a = await h.createTenant({ name: "P65Rehome" });
    const b = await h.createSecondTenant({ name: "P65RehomeB" });
    const staff = await addMember(a, "employee", "P65RehomeStaff");
    const put = await a.as.put(`/api/companies/${a.company.id}/team/${staff}`, {
      role: "accountant",
      companyId: b.company.id,
    });
    expect(put.status).toBe(400);
    const rows = await h.sql(`SELECT company_id, role FROM company_users WHERE id = $1`, [staff]);
    expect(rows).toEqual([{ company_id: a.company.id, role: "employee" }]);
  });
});

describe("PR-65 firm staff may only edit the firm's own clients", () => {
  it("PR-65: a firm_owner cannot read, switch into or rewrite a self-signup SaaS company (404, row untouched)", async () => {
    const owner = await h.createTenant({ name: "P65FirmOwner", firmRole: "firm_owner" });
    const saas = await h.createSecondTenant({ name: "P65SaasCustomer" });
    const before = await h.sql(
      `SELECT name, trn_vat_number, emirate, company_type FROM companies WHERE id = $1`,
      [saas.company.id]
    );
    expect(before[0].company_type).not.toBe("client");

    const put = await owner.as.put(`/api/firm/clients/${saas.company.id}`, {
      name: "Hijacked LLC",
      trnVatNumber: TRN,
      emirate: "sharjah",
    });
    expect(put.status, put.text).toBe(404);
    expect((await owner.as.get(`/api/firm/clients/${saas.company.id}/summary`)).status).toBe(404);
    expect((await owner.as.post(`/api/firm/clients/${saas.company.id}/switch`)).status).toBe(404);
    expect((await owner.as.delete(`/api/firm/clients/${saas.company.id}`)).status).toBe(404);

    const after = await h.sql(
      `SELECT name, trn_vat_number, emirate, company_type, deleted_at FROM companies WHERE id = $1`,
      [saas.company.id]
    );
    expect(after[0]).toEqual({ ...before[0], deleted_at: null });
  });

  it("PR-65: an archived NR client is outside the firm's set: edits are 404", async () => {
    const owner = await h.createTenant({ name: "P65ArchOwner", firmRole: "firm_owner" });
    const created = await owner.as.post("/api/firm/clients", {
      name: "P65 Archived Client LLC",
      trnVatNumber: TRN,
    });
    expect(created.status, created.text).toBe(201);
    const id = created.body.id as string;
    expect((await owner.as.delete(`/api/firm/clients/${id}`)).status).toBe(200);
    const put = await owner.as.put(`/api/firm/clients/${id}`, { name: "Revived LLC" });
    expect(put.status, put.text).toBe(404);
    const rows = await h.sql(`SELECT name FROM companies WHERE id = $1`, [id]);
    expect(rows[0].name).toBe("P65 Archived Client LLC");
  });

  it("PR-65: the firm_owner can still edit an active NR client", async () => {
    const owner = await h.createTenant({ name: "P65EditOwner", firmRole: "firm_owner" });
    const created = await owner.as.post("/api/firm/clients", {
      name: "P65 Active Client LLC",
      trnVatNumber: TRN,
    });
    expect(created.status, created.text).toBe(201);
    const put = await owner.as.put(`/api/firm/clients/${created.body.id}`, { industry: "Retail" });
    expect(put.status, put.text).toBe(200);
  });
});

describe("PR-62 member lists never expose credentials", () => {
  it("PR-62: firm client summary and admin client detail return a public user projection", async () => {
    const owner = await h.createTenant({ name: "P62FirmOwner", firmRole: "firm_owner" });
    const created = await owner.as.post("/api/firm/clients", {
      name: "P62 Projection Client LLC",
      trnVatNumber: TRN,
    });
    expect(created.status, created.text).toBe(201);
    const id = created.body.id as string;
    const member = await h.createTenant({ name: "P62Member" });
    await h.sql(
      `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant')`,
      [id, member.user.id]
    );

    const summary = await owner.as.get(`/api/firm/clients/${id}/summary`);
    expect(summary.status, summary.text).toBe(200);
    const admin = await h.createTenant({ name: "P62Admin", isAdmin: true });
    const detail = await admin.as.get(`/api/admin/clients/${id}`);
    expect(detail.status, detail.text).toBe(200);

    for (const text of [summary.text, detail.text]) {
      expect(text).toContain(member.user.email);
      expect(text).not.toMatch(/passwordHash|password_hash|tokenVersion|\$2[aby]\$/);
    }
    const listed = summary.body.companyUsers.find(
      (m: { userId: string }) => m.userId === member.user.id
    );
    expect(Object.keys(listed.user).sort()).toEqual([
      "avatarUrl",
      "createdAt",
      "email",
      "emailVerified",
      "id",
      "lastLoginAt",
      "name",
      "userType",
    ]);
  });
});
