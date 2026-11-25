/**
 * W2-C RBAC + tenancy: team IDOR, role enum, central permission policy
 * (R01-01, R01-02, R01-03, R01-14).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { useHarness, type Tenant } from "./harness";
import { insertRow } from "./row-factory";

const h = useHarness();

async function membershipId(companyId: string, userId: string): Promise<string> {
  const rows = await h.sql(`SELECT id FROM company_users WHERE company_id = $1 AND user_id = $2`, [
    companyId,
    userId,
  ]);
  return rows[0].id;
}

/** A user whose membership in `owner`'s company has the given role. */
async function memberOf(owner: Tenant, role: string, name = role): Promise<Tenant> {
  const t = await h.createTenant({ name: `M${name}` });
  await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [
    owner.company.id,
    t.user.id,
    role,
  ]);
  return t;
}

describe("R01-01 team routes are tenant-scoped", () => {
  it("R01-01: A cannot PUT or DELETE B's membership via A's company; B's row is unchanged", async () => {
    const a = await h.createTenant({ name: "IdorA" });
    const b = await h.createSecondTenant({ name: "IdorB" });
    const bMember = await membershipId(b.company.id, b.user.id);

    const put = await a.as.put(`/api/companies/${a.company.id}/team/${bMember}`, {
      role: "employee",
    });
    expect(put.status).toBe(404);
    const del = await a.as.delete(`/api/companies/${a.company.id}/team/${bMember}`);
    expect(del.status).toBe(404);

    const rows = await h.sql(`SELECT role FROM company_users WHERE id = $1`, [bMember]);
    expect(rows).toEqual([{ role: "owner" }]);
  });

  it("R01-01: the owner can change and remove members of their own company", async () => {
    const a = await h.createTenant({ name: "OwnTeam" });
    const m = await memberOf(a, "employee", "own");
    const mid = await membershipId(a.company.id, m.user.id);
    const put = await a.as.put(`/api/companies/${a.company.id}/team/${mid}`, {
      role: "accountant",
    });
    expect(put.status, put.text).toBe(200);
    expect(put.body.role).toBe("accountant");
    const list = await a.as.get(`/api/companies/${a.company.id}/team`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|password_hash/);
    const del = await a.as.delete(`/api/companies/${a.company.id}/team/${mid}`);
    expect(del.status).toBe(204);
  });

  it("the last owner cannot be demoted", async () => {
    const a = await h.createTenant({ name: "LastOwner" });
    const mid = await membershipId(a.company.id, a.user.id);
    const r = await a.as.put(`/api/companies/${a.company.id}/team/${mid}`, { role: "viewer" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("LAST_OWNER");
  });
});

describe("R01-03 role enum", () => {
  it("R01-03: role 'superadmin' is rejected on role change and invite", async () => {
    const a = await h.createTenant({ name: "Enum" });
    const m = await memberOf(a, "employee", "enum");
    const mid = await membershipId(a.company.id, m.user.id);
    const put = await a.as.put(`/api/companies/${a.company.id}/team/${mid}`, {
      role: "superadmin",
    });
    expect(put.status).toBe(400);
    expect(put.body.code).toBe("VALIDATION_ERROR");
    const inv = await a.as.post(`/api/companies/${a.company.id}/team/invite`, {
      email: `x-${randomUUID()}@example.test`,
      role: "superadmin",
    });
    expect(inv.status).toBe(400);
    const rows = await h.sql(`SELECT role FROM company_users WHERE id = $1`, [mid]);
    expect(rows[0].role).toBe("employee");
  });

  it("R01-03: the database refuses free-text roles", async () => {
    const a = await h.createTenant({ name: "EnumDb" });
    await expect(
      h.sql(`UPDATE company_users SET role = 'superadmin' WHERE company_id = $1`, [a.company.id])
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("R01-02 central permission policy", () => {
  it("checks legacy and canonical company identifiers at the authorization boundary", async () => {
    const owner = await h.createTenant({ name: "CanonicalCompany" });
    const viewer = await memberOf(owner, "viewer", "spaced");
    const legacy = await viewer.as.post("/api/period-lock/unlock", {
      companyId: ` ${owner.company.id.toUpperCase()} `,
      period: "2025-08",
      reason: "Validation regression test",
    });
    expect(legacy.status).toBe(403);
    expect(legacy.body.code).toBe("PERMISSION_DENIED");

    const invalid = await owner.as.get(`/api/invoices/invalid?companyId=${owner.company.id}`);
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("INVALID_ID");
    const other = await h.createSecondTenant();
    const foreignId = await insertRow(h.sql, "invoices", {
      companyId: other.company.id,
      userId: other.user.id,
    });
    for (const id of [randomUUID(), foreignId]) {
      const result = await owner.as.get(`/api/invoices/${id}`);
      expect(result.status).toBe(404);
      expect(result.body).toEqual({
        code: "NOT_FOUND",
        message: "Not found",
        requestId: expect.any(String),
      });
    }
    const missingBodyId = await owner.as.post(
      `/api/period-lock/unlock?companyId=${owner.company.id}`,
      { period: "2025-08", reason: "Validation regression test" }
    );
    expect(missingBodyId.status).toBe(400);
    expect(missingBodyId.body.code).toBe("INVALID_ID");

    const encoded = encodeURIComponent(` ${owner.company.id.toUpperCase()} `);
    for (const path of [
      `/api/companies/${encoded}/period-lock`,
      `/api/period-lock/list?companyId=${encoded}`,
      `/api/vat/autopilot/periods/${encoded}`,
      `/api/integrations/ecommerce/transactions?companyId=${encoded}`,
    ]) {
      expect((await owner.as.get(path)).status, path).toBe(200);
    }

    for (const path of ["/api/reports/catalog", "/api/api-keys/scopes", "/api/webhooks/events"]) {
      expect((await owner.as.get(path)).status, path).toBe(200);
    }
  });

  it("leaves email delivery callbacks at their signed boundary after a customer trial expires", async () => {
    const owner = await h.createTenant({ name: "ExpiredCallback" });
    await h.sql(
      `UPDATE subscriptions SET created_at = now() - interval '30 days', trial_ends_at = NULL
       WHERE company_id = $1`,
      [owner.company.id]
    );
    await h.sql("UPDATE companies SET created_at = now() - interval '30 days' WHERE id = $1", [
      owner.company.id,
    ]);
    vi.stubEnv("BILLING_ENFORCEMENT", "true");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", undefined);
    vi.stubEnv("EMAIL_DSN_WEBHOOK_SECRET", undefined);
    try {
      expect((await owner.as.get(`/api/companies/${owner.company.id}/accounts`)).status).toBe(200);
      for (const provider of ["resend", "smtp-dsn"]) {
        const result = await owner.as.post(`/api/webhooks/email-events/${provider}`, {});
        expect(result.status).toBe(503);
        expect(result.body.code).toBe("WEBHOOK_NOT_CONFIGURED");
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("R01-02: an employee cannot rename the company; the owner can", async () => {
    const a = await h.createTenant({ name: "PolicyOwner" });
    const emp = await memberOf(a, "employee", "emp");
    const denied = await emp.as.put(`/api/companies/${a.company.id}`, { name: "pwned" });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("PERMISSION_DENIED");
    const [row] = await h.sql(`SELECT name FROM companies WHERE id = $1`, [a.company.id]);
    expect(row.name).not.toBe("pwned");
    // Employees still record documents.
    const read = await emp.as.get(`/api/companies/${a.company.id}/accounts`);
    expect(read.status).toBe(200);

    const allowed = await a.as.put(`/api/companies/${a.company.id}`, { name: "Renamed Co" });
    expect(allowed.status, allowed.text).toBe(200);
  });

  it("R01-02/R01-14: a viewer is blocked on every company mutation in the policy table", async () => {
    const { resolvePermission } = await import("../../server/middleware/companyRolePolicy");
    const { roleHasAnyPermission } = await import("../../shared/permissions");
    const a = await h.createTenant({ name: "ViewOwner" });
    const viewer = await memberOf(a, "viewer", "view");

    const ctx = { companyId: a.company.id, userId: a.user.id };
    const rowFor: Record<string, string> = {
      invoices: await insertRow(h.sql, "invoices", ctx),
      journal: await insertRow(h.sql, "journal_entries", ctx),
      receipts: await insertRow(h.sql, "receipts", ctx),
      accounts: await insertRow(h.sql, "accounts", ctx, { code: `9${Date.now() % 100000}` }),
    };

    const mutations = h
      .routes()
      .filter((r) => r.method !== "GET")
      .filter((r) =>
        /^\/api\/(companies\/:(companyId|id)|invoices\/:id|journal\/:id|receipts\/:id|accounts\/:id)(\/|$)/.test(
          r.path
        )
      );
    expect(mutations.length).toBeGreaterThan(100);

    const failures: string[] = [];
    let checked = 0;
    for (const route of mutations) {
      const rel = route.path.replace(/^\/api/, "");
      const perms = resolvePermission(route.method, rel);
      if (!perms || roleHasAnyPermission("viewer", perms)) continue;
      const first = rel.split("/")[1];
      const url =
        "/api" +
        rel
          .split("/")
          .map((seg, i, all) => {
            if (!seg.startsWith(":")) return seg;
            if (all[i - 1] === "companies") return a.company.id;
            if (i === 2 && rowFor[first]) return rowFor[first];
            return randomUUID();
          })
          .join("/");
      const res = await viewer.as.request(route.method, url, {});
      checked++;
      if (res.status !== 403 || res.body?.code !== "PERMISSION_DENIED") {
        failures.push(`${route.method} ${route.path} -> ${res.status} ${res.body?.code ?? ""}`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(failures).toEqual([]);

    const read = await viewer.as.get(`/api/companies/${a.company.id}/accounts`);
    expect(read.status).toBe(200);
  });

  it("R01-14: granular roles — bookkeeper cannot approve, approver cannot post", async () => {
    const a = await h.createTenant({ name: "Granular" });
    const bk = await memberOf(a, "bookkeeper", "bk");
    const ap = await memberOf(a, "approver", "ap");
    const ctx = { companyId: a.company.id, userId: a.user.id };
    const bill = await insertRow(h.sql, "vendor_bills", ctx);
    const r1 = await bk.as.post(`/api/bills/${bill}/approve`, {});
    expect(r1.status).toBe(403);
    expect(r1.body.details.permission).toBe("documents.approve");
    const r2 = await ap.as.post(`/api/companies/${a.company.id}/journal`, {
      date: "2026-01-15",
      description: "x",
      lines: [],
    });
    expect(r2.status).toBe(403);
    expect(r2.body.details.permission).toBe("ledger.post");
  });

  it("R01-02: a non-member naming another company is refused centrally", async () => {
    const a = await h.createTenant({ name: "NonMemberA" });
    const b = await h.createSecondTenant({ name: "NonMemberB" });
    const r = await b.as.put(`/api/companies/${a.company.id}`, { name: "x" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("COMPANY_ACCESS_DENIED");
  });

  it("RBAC_ENFORCE=report logs instead of denying (staged rollout)", async () => {
    const a = await h.createTenant({ name: "Report" });
    const emp = await memberOf(a, "employee", "rep");
    const prev = process.env.RBAC_ENFORCE;
    process.env.RBAC_ENFORCE = "report";
    try {
      const r = await emp.as.get(`/api/companies/${a.company.id}/team/me`);
      expect(r.status).toBe(200);
      const put = await emp.as.put(`/api/companies/${a.company.id}`, { name: "Report Mode" });
      expect(put.body?.code).not.toBe("PERMISSION_DENIED");
    } finally {
      if (prev === undefined) delete process.env.RBAC_ENFORCE;
      else process.env.RBAC_ENFORCE = prev;
    }
  });

  it("team/me exposes the caller's role and permissions for UI gating", async () => {
    const a = await h.createTenant({ name: "Me" });
    const v = await memberOf(a, "viewer", "me");
    const r = await v.as.get(`/api/companies/${a.company.id}/team/me`);
    expect(r.status).toBe(200);
    expect(r.body.role).toBe("viewer");
    expect(r.body.permissions).toEqual(["reports.read"]);
    expect(r.body.grantableRoles).toEqual([]);
  });
});

describe("J4: status transitions need the posting permission", () => {
  it("J4: an employee cannot issue an invoice via PATCH /status; a bookkeeper can and the GL is written once", async () => {
    const a = await h.createTenant({ name: "StatusGate" });
    const emp = await memberOf(a, "employee", "sg-emp");
    const bk = await memberOf(a, "bookkeeper", "sg-bk");
    const today = new Date().toISOString().slice(0, 10);
    const created = await emp.as.post(`/api/companies/${a.company.id}/invoices`, {
      customerName: "Gate Co",
      date: today,
      lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 5 }],
    });
    expect(created.status, created.text).toBe(200);
    const id = created.body.id as string;

    const denied = await emp.as.patch(`/api/invoices/${id}/status`, { status: "sent" });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("PERMISSION_DENIED");
    const none = await h.sql(
      `SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1`,
      [a.company.id]
    );
    expect(none[0].n).toBe(0);

    const ok = await bk.as.patch(`/api/invoices/${id}/status`, { status: "sent" });
    expect(ok.status, ok.text).toBe(200);
    const posted = await h.sql(
      `SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1`,
      [a.company.id]
    );
    expect(posted[0].n).toBe(1);
  });

  it("J4: Activity History follows the audit-log audience: viewers and employees are refused, the owner and accountants read it", async () => {
    const a = await h.createTenant({ name: "ActGate" });
    const viewer = await memberOf(a, "viewer", "act-v");
    const emp = await memberOf(a, "employee", "act-e");
    const acct = await memberOf(a, "accountant", "act-a");
    const url = `/api/companies/${a.company.id}/activity-logs`;
    expect((await viewer.as.get(url)).status).toBe(403);
    expect((await emp.as.get(url)).status).toBe(403);
    expect((await acct.as.get(url)).status).toBe(200);
    expect((await a.as.get(url)).status).toBe(200);
    // The audit-log API itself stays admin-only (accountants included).
    expect((await viewer.as.get(`/api/companies/${a.company.id}/audit-log`)).status).toBe(403);
  });
});
