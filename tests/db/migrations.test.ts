import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  HARNESS_DB_PREFIX,
  createDatabase,
  databaseUrl,
  dropDatabase,
  migrateDatabase,
  repoRoot,
} from "./pg-admin";
import { useHarness } from "./harness";

const h = useHarness();
const journal = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "migrations/meta/_journal.json"), "utf8")
) as {
  entries: Array<{ idx: number; tag: string; when: number; version: string; breakpoints: boolean }>;
};
const sqlFile = (tag: string) =>
  fs.readFileSync(path.join(repoRoot, "migrations", `${tag}.sql`), "utf8");

describe("migrations", () => {
  it("journal registers 0089-0109 in the existing entry format", () => {
    const tags = journal.entries.map((e) => e.tag);
    for (let n = 89; n <= 109; n++) {
      const prefix = String(n).padStart(4, "0");
      expect(
        tags.some((t) => t.startsWith(`${prefix}_`)),
        prefix
      ).toBe(true);
    }
    journal.entries.forEach((e, i) => {
      expect(e.idx).toBe(i);
      if (i > 0) expect(e.when).toBeGreaterThan(journal.entries[i - 1].when);
    });
    for (const e of journal.entries.filter((x) => x.idx >= 88)) {
      expect(e).toMatchObject({ version: "7", breakpoints: false });
      // Leave the last historical preview timestamp unused so installed preview databases
      // apply every migrated bank entry and the portal catch-up.
      const gaps = {
        "0144_prepare_preview_firm_membership": 5_000,
        "0142_recover_firm_membership_provenance": 5_000,
        "0138_repair_bank_gl_links": 50_000,
      } as Record<string, number>;
      const cadence = gaps[e.tag] ?? 10_000;
      expect(e.when - journal.entries[e.idx - 1].when).toBe(cadence);
    }
    for (const e of journal.entries.filter((x) => x.idx >= 89)) {
      const body = sqlFile(e.tag);
      const sqlBody = body.replace(/^--.*$/gm, "").trim();
      if (/^-- .*reserved placeholder/m.test(body)) {
        // Untouched reservation: a no-op that names its owning workstream.
        expect(body, e.tag).toMatch(/^-- .*owned by workstream W\d-[A-E]/m);
        expect(sqlBody, e.tag).toBe("SELECT 1;");
      } else {
        // Filled by its owning workstream: the header line names the file and the
        // workstream, declares the SQL idempotent, and every DDL statement is re-runnable.
        // Wave workstreams (W1-A ... W5-E) and the final sweep workers (S1 ... S9).
        expect(body, e.tag).toMatch(/^-- \d{4}_\w+\b.*\b(W\d-[A-E]|S\d)\b/m);
        expect(body, e.tag).toMatch(/^-- .*\bIdempotent\b/im);
        expect(sqlBody, e.tag).not.toBe("SELECT 1;");
        expect(sqlBody, e.tag).not.toMatch(
          /CREATE (TABLE|INDEX|UNIQUE INDEX)\s+(?!IF NOT EXISTS)(?!CONCURRENTLY IF NOT EXISTS)/i
        );
        expect(sqlBody, e.tag).not.toMatch(/ADD COLUMN\s+(?!IF NOT EXISTS)/i);
      }
    }
  });

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "apply cleanly to an empty database with runMigrations alone",
    async () => {
      const admin = process.env.HARNESS_ADMIN_URL!;
      const name = `${HARNESS_DB_PREFIX}empty_${process.pid}_${randomBytes(3).toString("hex")}_${Date.now().toString(36)}`;
      await createDatabase(admin, name);
      try {
        migrateDatabase(databaseUrl(admin, name), { criticalSchema: false });
        const client = new pg.Client({ connectionString: databaseUrl(admin, name) });
        await client.connect();
        try {
          const { rows } = await client.query(
            `SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations`
          );
          expect(rows[0].n).toBe(journal.entries.length);
          // Re-running 0089 is a no-op (idempotent).
          await client.query(sqlFile("0089_platform_foundation"));
          await client.query(sqlFile("0089_platform_foundation"));
        } finally {
          await client.end();
        }
      } finally {
        await dropDatabase(admin, name);
      }
    },
    180_000
  );

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "fails the release when the VAT audit membership index cannot be installed, then retries",
    async () => {
      const name = "idx_audit_logs_vat_group_member_ids";
      const runRelease = () =>
        spawnSync(process.execPath, ["--import", "tsx", "server/migrate.ts"], {
          cwd: repoRoot,
          encoding: "utf8",
          env: { ...process.env, DATABASE_URL: h.databaseUrl, LOG_LEVEL: "info" },
          timeout: 25_000,
        });

      await h.sql(`DROP INDEX public.${name}`);
      await h.sql(`CREATE TABLE public.${name} (id integer)`);
      try {
        const { ensureCriticalSchema } = await import("../../server/db");
        await expect(ensureCriticalSchema()).resolves.toBeUndefined();

        const failed = runRelease();
        const output = failed.stdout + failed.stderr;
        expect(failed.error).toBeUndefined();
        expect(failed.status, output).toBe(1);
        expect(output).toContain("Production migration failed");
        expect(output).toContain(name);
      } finally {
        await h.sql(`DROP TABLE public.${name}`);
      }

      const repaired = runRelease();
      const output = repaired.stdout + repaired.stderr;
      expect(repaired.error).toBeUndefined();
      expect(repaired.status, output).toBe(0);
      expect(output).toContain("Production migration completed");
      expect(
        await h.sql(
          `SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass('public.${name}')`
        )
      ).toEqual([{ indisvalid: true }]);
    },
    60_000
  );

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "rejects an audit membership GIN index with the wrong expression or predicate",
    async () => {
      const name = "idx_audit_logs_vat_group_member_ids";
      const { ensureCriticalSchema } = await import("../../server/db");
      const release = () => ensureCriticalSchema({ requireVatGroupAuditMembershipIndex: true });
      const indexDefinition = async () => {
        const [row] = await h.sql<{ definition: string }>(
          `SELECT pg_get_indexdef(to_regclass('public.${name}')) AS definition`
        );
        return row.definition;
      };
      const expected = await indexDefinition();
      const replacements = [
        `CREATE INDEX ${name} ON audit_logs USING gin (to_tsvector('simple', details))
           WHERE resource_type = 'vat_group' AND action = 'vat.group.upsert'`,
        `CREATE INDEX ${name} ON audit_logs USING gin (string_to_array(lower(details), '"'))
           WHERE resource_type = 'vat_group' AND action = 'vat.group.upsert'`,
        expected.replace(/ WHERE .*$/s, ""),
        expected.replace(/\) WHERE /, ' COLLATE "C") WHERE '),
      ];
      await h.sql(`DROP INDEX public.${name}`);
      try {
        for (const ddl of replacements) {
          await h.sql(ddl);
          try {
            const unexpected = await indexDefinition();
            expect(unexpected).not.toBe(expected);
            await expect(ensureCriticalSchema()).resolves.toBeUndefined();
            await expect(release()).rejects.toThrow(
              "Unexpected index definition for idx_audit_logs_vat_group_member_ids"
            );
            expect(await indexDefinition()).toBe(unexpected);
          } finally {
            await h.sql(`DROP INDEX public.${name}`);
          }
        }
      } finally {
        await release();
      }
      expect(await indexDefinition()).toBe(expected);
      await expect(release()).resolves.toBeUndefined();
    },
    60_000
  );

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "repairs an interrupted VAT audit membership index build on the release schema path",
    async () => {
      const indexState = () =>
        h.sql<{ valid: boolean; definition: string }>(`
          SELECT indisvalid AS valid, pg_get_indexdef(indexrelid) AS definition
            FROM pg_index
           WHERE indexrelid = to_regclass('public.idx_audit_logs_vat_group_member_ids')
        `);
      expect(await indexState()).toEqual([
        { valid: true, definition: expect.stringContaining("USING gin") },
      ]);

      await h.sql("DROP INDEX public.idx_audit_logs_vat_group_member_ids");
      await h.sql(`INSERT INTO audit_logs (action, resource_type)
                   VALUES ('schema.test', 'vat_audit_index_test'), ('schema.test', 'vat_audit_index_test')`);
      // PostgreSQL keeps an invalid index when a concurrent unique build finds duplicates.
      await expect(
        h.sql(`CREATE UNIQUE INDEX CONCURRENTLY idx_audit_logs_vat_group_member_ids
                 ON audit_logs (resource_type) WHERE resource_type = 'vat_audit_index_test'`)
      ).rejects.toMatchObject({ code: "23505" });
      expect(await indexState()).toEqual([
        { valid: false, definition: expect.stringContaining("CREATE UNIQUE INDEX") },
      ]);

      const { ensureCriticalSchema } = await import("../../server/db");
      await ensureCriticalSchema();
      expect(await indexState()).toEqual([
        { valid: true, definition: expect.stringContaining("USING gin") },
      ]);
    },
    60_000
  );

  it("0089 creates the platform foundation objects", async () => {
    const cols = await h.sql<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name = 'receipts' AND column_name IN ('supplier_trn','content_sha256','file_mime','file_size'))
            OR (table_name = 'user_onboarding' AND column_name = 'tour_dismissed_at')
            OR table_name IN ('ai_usage_events', 'ai_usage_limits'))`
    );
    const set = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`));
    for (const c of [
      "receipts.supplier_trn",
      "receipts.content_sha256",
      "receipts.file_mime",
      "receipts.file_size",
      "user_onboarding.tour_dismissed_at",
      "ai_usage_events.cost_usd",
      "ai_usage_events.input_tokens",
      "ai_usage_limits.monthly_token_cap",
      "ai_usage_limits.monthly_cost_cap_usd",
    ]) {
      expect(set.has(c), c).toBe(true);
    }
    const idx = await h.sql(
      `SELECT indexname FROM pg_indexes WHERE indexname IN
        ('idx_ai_usage_events_company_created', 'idx_receipts_company_content_sha256')`
    );
    expect(idx).toHaveLength(2);
  });

  it("R17-16: the 0028 test credential is unusable after migrations, even if re-seeded", async () => {
    const check = async () => {
      const rows = await h.sql(
        `SELECT u.password_hash, u.firm_role, u.is_admin,
                (SELECT COUNT(*)::int FROM company_users cu WHERE cu.user_id = u.id) AS memberships
           FROM users u WHERE u.email = 'test_firm_owner@nra.ae'`
      );
      for (const r of rows) {
        expect(r.password_hash).not.toMatch(/^\$2[aby]\$/);
        expect(r.firm_role).toBeNull();
        expect(r.is_admin).toBe(false);
        expect(r.memberships).toBe(0);
      }
      return rows.map((r) => r.password_hash);
    };
    await check();
    await h.createTenant({ name: "Cred" });
    // Simulate an environment that replayed 0028's user upsert after 0051,
    // then 0089 must neutralise it again. (Only the first statement: the
    // company upsert relies on a unique constraint 0029 dropped.)
    await h.sql(sqlFile("0028_fix_test_credentials").split(";")[0]);
    await h.sql(
      `INSERT INTO company_users (company_id, user_id, role)
       SELECT c.id, u.id, 'owner' FROM companies c, users u
        WHERE u.email = 'test_firm_owner@nra.ae' LIMIT 1`
    );
    const seeded = await h.sql(
      `SELECT 1 FROM company_users cu JOIN users u ON u.id = cu.user_id
        WHERE u.email = 'test_firm_owner@nra.ae'`
    );
    expect(seeded.length).toBe(1);
    const replayed = await h.sql(
      `SELECT password_hash FROM users WHERE email = 'test_firm_owner@nra.ae'`
    );
    expect(replayed[0].password_hash).toMatch(/^\$2[aby]\$/);
    await h.sql(sqlFile("0089_platform_foundation"));
    const revoked = await check();
    expect(revoked).toHaveLength(1);
    await h.sql(sqlFile("0089_platform_foundation"));
    expect(await check()).toEqual(revoked);
    const login = await h.anon.post("/api/auth/login", {
      email: "test_firm_owner@nra.ae",
      password: "TestFirmOwner123!",
    });
    expect(login.status).toBeGreaterThanOrEqual(400);
  });

  it("[STEP2] 0133 drops the ZATCA tables, is idempotent, and refuses to drop a table that holds rows", async () => {
    const tables = async () =>
      (
        await h.sql<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name IN ('zatca_egs_units', 'zatca_documents')`
        )
      ).map((r) => r.table_name);
    // Applied by the harness migrations: both tables are gone, and a second run is a no-op.
    expect(await tables()).toEqual([]);
    await h.sql(sqlFile("0133_step2_remove_zatca"));
    await h.sql(sqlFile("0133_step2_remove_zatca"));
    expect(await tables()).toEqual([]);

    // A table that holds a row is never dropped silently.
    await h.sql(`CREATE TABLE zatca_egs_units (id uuid)`);
    await h.sql(`INSERT INTO zatca_egs_units (id) VALUES (gen_random_uuid())`);
    await expect(h.sql(sqlFile("0133_step2_remove_zatca"))).rejects.toThrow(
      /zatca_egs_units holds 1 row/
    );
    expect(await tables()).toEqual(["zatca_egs_units"]);
    await h.sql(`DROP TABLE zatca_egs_units`);

    // An empty table is dropped.
    await h.sql(`CREATE TABLE zatca_documents (id uuid)`);
    await h.sql(`CREATE TABLE zatca_egs_units (id uuid)`);
    await h.sql(sqlFile("0133_step2_remove_zatca"));
    expect(await tables()).toEqual([]);
  });

  it("[STEP3] 0134 drops the price-editor tables, is idempotent, and refuses to drop a table that holds rows", async () => {
    const tables = async () =>
      (
        await h.sql<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('subscription_plans', 'user_subscriptions')
            ORDER BY table_name`
        )
      ).map((r) => r.table_name);
    // Applied by the harness migrations: both tables are gone, and a second run is a no-op.
    expect(await tables()).toEqual([]);
    await h.sql(sqlFile("0134_step3_remove_price_editor"));
    await h.sql(sqlFile("0134_step3_remove_price_editor"));
    expect(await tables()).toEqual([]);

    // A table that holds a row is never dropped silently.
    for (const name of ["subscription_plans", "user_subscriptions"]) {
      await h.sql(`CREATE TABLE ${name} (id uuid)`);
      await h.sql(`INSERT INTO ${name} (id) VALUES (gen_random_uuid())`);
      await expect(h.sql(sqlFile("0134_step3_remove_price_editor"))).rejects.toThrow(
        new RegExp(`${name} holds 1 row`)
      );
      expect(await tables()).toEqual([name]);
      await h.sql(`DROP TABLE ${name}`);
    }

    // Empty tables (with the old foreign key) are dropped.
    await h.sql(`CREATE TABLE subscription_plans (id uuid PRIMARY KEY)`);
    await h.sql(
      `CREATE TABLE user_subscriptions (plan_id uuid REFERENCES subscription_plans (id))`
    );
    await h.sql(sqlFile("0134_step3_remove_price_editor"));
    expect(await tables()).toEqual([]);
  });

  it("[STEP5] 0136 is idempotent and removes client_portal memberships only", async () => {
    const owner = await h.createTenant({ name: "Step5Owner" });
    const portalUser = await h.createSecondTenant({
      userType: "client_portal",
      name: "Step5Portal",
    });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      owner.company.id,
      portalUser.user.id,
    ]);
    const members = async (userId: string) =>
      (await h.sql(`SELECT 1 FROM company_users WHERE user_id = $1`, [userId])).length;
    expect(await members(portalUser.user.id)).toBeGreaterThan(0);
    await h.sql(sqlFile("0136_step5_portal_invitations"));
    await h.sql(sqlFile("0136_step5_portal_invitations"));
    expect(await members(portalUser.user.id)).toBe(0);
    // Real company members are untouched.
    expect(await members(owner.user.id)).toBeGreaterThan(0);
    const cols = await h.sql<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'customer_portal_accounts' AND column_name IN ('invitation_id', 'last_seen_at', 'revoked_by')`
    );
    expect(cols).toHaveLength(3);
    expect(
      await h.sql(
        `SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_portal_invitations'`
      )
    ).toHaveLength(1);
  });

  it("[S5] rerunning 0138 preserves invitations created after the upgrade", async () => {
    const supplier = await h.createTenant();
    const contacts = `/api/companies/${supplier.company.id}/customer-contacts`;
    const contact = await supplier.as.post(contacts, {
      name: "Portal customer",
      email: "migration-portal@example.test",
    });
    expect(contact.status).toBe(200);
    const invitation = await supplier.as.post(
      `${contacts}/${contact.body.id}/portal-invitations`,
      {}
    );
    expect(invitation.status).toBe(201);
    const id = invitation.body.invitation.id;

    await h.sql(sqlFile("0138_secure_portal_invitations"));
    expect(
      await h.sql("SELECT status FROM customer_portal_invitations WHERE id = $1", [id])
    ).toEqual([{ status: "pending" }]);
    expect(
      await h.sql(
        "SELECT html IS NOT NULL AS has_body FROM email_outbox WHERE related_entity_id = $1",
        [id]
      )
    ).toEqual([{ has_body: true }]);
  });

  it("[STEP2] 0133 resets a 15% company default VAT rate to 5% and leaves 0% and 5% alone", async () => {
    const a = await h.createTenant({ name: "Step2Rate15" });
    const b = await h.createTenant({ name: "Step2Rate0" });
    const c = await h.createTenant({ name: "Step2Rate5" });
    await h.sql(`UPDATE companies SET default_vat_rate = 0.15 WHERE id = $1`, [a.company.id]);
    await h.sql(`UPDATE companies SET default_vat_rate = 0 WHERE id = $1`, [b.company.id]);
    await h.sql(sqlFile("0133_step2_remove_zatca"));
    const rate = async (id: string) =>
      Number(
        (
          await h.sql<{ r: string }>(
            `SELECT default_vat_rate::text AS r FROM companies WHERE id = $1`,
            [id]
          )
        )[0].r
      );
    expect(await rate(a.company.id)).toBe(0.05);
    expect(await rate(b.company.id)).toBe(0);
    expect(await rate(c.company.id)).toBe(0.05);
  });
});
