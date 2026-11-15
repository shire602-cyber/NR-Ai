/**
 * W2-C identity: accounts, registration, password policy, /health, migration
 * 0092 (R01-05, R01-07, R01-08, R17-13, R17-14, R01-04).
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";
import { repoRoot } from "./pg-admin";

const h = useHarness();
const uniq = () => randomBytes(4).toString("hex");
const STRONG = "Harness9Strong!";

async function register(body: Record<string, unknown>) {
  return h.anon.post("/api/auth/register", body);
}

describe("R01-05 case-insensitive emails", () => {
  it("R01-05: AGENT@X after agent@x does not create a second account (conflict)", async () => {
    const local = `agent-${uniq()}`;
    const first = await register({
      name: "Agent",
      email: `${local}@example.test`,
      password: STRONG,
    });
    expect(first.status).toBe(200);
    expect(first.body.token).toBeUndefined(); // W5-E: never a session from register

    const second = await register({
      name: "Agent Upper",
      email: `${local.toUpperCase()}@EXAMPLE.TEST`,
      password: STRONG,
    });
    expect(second.status).toBe(200);
    expect(second.body.token).toBeUndefined();
    const rows = await h.sql(`SELECT email FROM users WHERE lower(email) = lower($1)`, [
      `${local}@example.test`,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(`${local}@example.test`);

    // The database refuses a case-variant duplicate as well.
    await expect(
      h.sql(`INSERT INTO users (email, name, password_hash) VALUES ($1, 'x', 'x')`, [
        `${local.toUpperCase()}@example.test`,
      ])
    ).rejects.toMatchObject({ code: "23505" });

    // Login is case-insensitive.
    const login = await h.anon.post("/api/auth/login", {
      email: `${local.toUpperCase()}@Example.Test`,
      password: STRONG,
    });
    expect(login.status).toBe(200);
  });
});

describe("R17-14 registration does not reveal existing emails", () => {
  it("R17-14: a taken email gets the same status and message as a new one", async () => {
    const t = await h.createTenant({ name: "Enum" });
    const fresh = await register({
      name: "New",
      email: `new-${uniq()}@example.test`,
      password: STRONG,
    });
    const taken = await register({ name: "Dup", email: t.email, password: STRONG });
    expect(taken.status).toBe(fresh.status);
    expect(taken.body.message).toBe(fresh.body.message);
    expect(taken.text).not.toMatch(/already registered/i);
    // The original account is untouched.
    const login = await h.anon.post("/api/auth/login", { email: t.email, password: t.password });
    expect(login.status).toBe(200);
  });
});

describe("R01-07 registration honours companyName", () => {
  it("R01-07: the company is named after the supplied companyName", async () => {
    const email = `co-${uniq()}@example.test`;
    const r = await register({
      name: "Owner",
      email,
      password: STRONG,
      companyName: "A13 Trading LLC",
    });
    expect(r.status).toBe(200);
    // W5-E: no session or company in the response (R17-14); read it from the database.
    const rows = await h.sql(
      `SELECT c.name FROM companies c JOIN company_users cu ON cu.company_id = c.id
         JOIN users u ON u.id = cu.user_id WHERE u.email = $1`,
      [email]
    );
    expect(rows[0].name).toBe("A13 Trading LLC");
  });

  it("rejects unknown registration fields (strictBody)", async () => {
    const r = await register({
      name: "Owner",
      email: `x-${uniq()}@example.test`,
      password: STRONG,
      isAdmin: true,
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("R01-08 common-password check", () => {
  it("R01-08: 'Password1' is rejected as a common password", async () => {
    const r = await register({
      name: "Weak",
      email: `weak-${uniq()}@example.test`,
      password: "Password1",
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(r.body.fields.password)).toMatch(/too common/i);
    const users = await h.sql(`SELECT 1 FROM users WHERE email LIKE 'weak-%'`);
    expect(users).toHaveLength(0);
  });
});

describe("R17-13 /health", () => {
  async function withHealthServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
    const express = (await import("express")).default;
    const { createHealthHandler } = await import("../../server/routes/admin-health.routes");
    const app = express();
    app.get("/health", createHealthHandler("test"));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("R17-13: anonymous /health returns status only; admins get diagnostics", async () => {
    const admin = await h.createTenant({ name: "HealthAdmin", isAdmin: true });
    const user = await h.createTenant({ name: "HealthUser" });
    await withHealthServer(async (base) => {
      const anon = await (await fetch(`${base}/health`)).json();
      expect(anon).toEqual({ status: "ok" });
      const asUser = await (
        await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${user.token}` } })
      ).json();
      expect(Object.keys(asUser)).toEqual(["status"]);
      const asAdmin = await (
        await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${admin.token}` } })
      ).json();
      expect(asAdmin.pid).toBeTypeOf("number");
      expect(asAdmin.memory).toBeTruthy();
    });
  });
});

describe("0092 migration", () => {
  const migration = fs.readFileSync(
    path.join(repoRoot, "migrations", "0092_w2c_identity.sql"),
    "utf8"
  );

  it("R01-05/R01-04: records case duplicates, skips the index, maps roles and converts placeholders", async () => {
    const owner = await h.createTenant({ name: "MigOwner" });
    const dup = `dup-${uniq()}`;
    const ph = `ph-${uniq()}@example.test`;
    await h.sql(`DROP INDEX IF EXISTS users_email_lower_unique`);
    await h.sql(`ALTER TABLE company_users DROP CONSTRAINT IF EXISTS company_users_role_check`);
    await h.sql(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, 'a', 'x'), ($2, 'b', 'x'), ($3, 'p', '')`,
      [`${dup}@example.test`, `${dup.toUpperCase()}@Example.test`, ph]
    );
    const [phUser] = await h.sql(`SELECT id FROM users WHERE email = $1`, [ph]);
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'cfo')`, [
      owner.company.id,
      phUser.id,
    ]);
    const extra = await h.createTenant({ name: "MigRole" });
    await h.sql(`UPDATE company_users SET role = 'superadmin' WHERE user_id = $1`, [extra.user.id]);

    await h.sql(migration);

    const findings = await h.sql(
      `SELECT detail FROM identity_migration_findings WHERE kind = 'case_duplicate_email' AND detail->>'email' = $1`,
      [`${dup}@example.test`]
    );
    expect(findings).toHaveLength(1);
    expect(
      await h.sql(`SELECT 1 FROM pg_indexes WHERE indexname = 'users_email_lower_unique'`)
    ).toHaveLength(0);
    const [mapped] = await h.sql(`SELECT role FROM company_users WHERE user_id = $1`, [
      extra.user.id,
    ]);
    expect(mapped.role).toBe("employee");
    // Placeholder: membership became a pending invitation (role cfo -> admin); user is gone.
    const inv = await h.sql(
      `SELECT role, status FROM company_invitations WHERE company_id = $1 AND email = $2`,
      [owner.company.id, ph]
    );
    expect(inv).toEqual([{ role: "admin", status: "pending" }]);
    expect(await h.sql(`SELECT 1 FROM users WHERE email = $1`, [ph])).toHaveLength(0);
    await expect(
      h.sql(`UPDATE company_users SET role = 'superadmin' WHERE user_id = $1`, [extra.user.id])
    ).rejects.toMatchObject({ code: "23514" });

    // Once the duplicate is resolved, re-running builds the index (idempotent).
    await h.sql(`DELETE FROM users WHERE email = $1`, [`${dup.toUpperCase()}@Example.test`]);
    await h.sql(migration);
    await h.sql(migration);
    expect(
      await h.sql(`SELECT 1 FROM pg_indexes WHERE indexname = 'users_email_lower_unique'`)
    ).toHaveLength(1);
  });
});
