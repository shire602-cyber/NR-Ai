/**
 * S-H3: migration 0054 no longer promotes a hardcoded personal account, a database that
 * already applied the old 0054 is neither re-run nor rejected by the migrator, and the
 * platform owner is granted / revoked only through the explicit, opt-in ops service
 * (scripts/ops/platform-owner.ts).
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { freezeTime, useHarness } from "./harness";
import { migrateDatabase, repoRoot } from "./pg-admin";

const h = useHarness();
const FILE = path.join(repoRoot, "migrations/0054_promote_shire602_firm_owner.sql");
const NR_FIRM_ID = "00000000-0000-4000-8000-000000000001";
// The content production applied before S-H3 (hash recorded in its ledger).
const ORIGINAL_0054 = `-- One-time owner access repair requested for the existing production account.
-- This does not create a user and does not set password material.
UPDATE users
SET
  is_admin = true,
  user_type = 'admin',
  firm_role = 'firm_owner',
  email_verified = true
WHERE lower(email) = 'shire602@gmail.com';
`;

async function insertUser(email: string) {
  const id = randomUUID();
  await h.sql(
    `INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, 'Owner', 'x-not-a-hash')`,
    [id, email]
  );
  return id;
}

async function state(id: string) {
  const [u] = await h.sql(
    `SELECT u.is_admin, u.user_type, u.firm_role,
            (SELECT role FROM firm_members fm WHERE fm.user_id = u.id AND fm.firm_id = $2) AS nr_member
       FROM users u WHERE u.id = $1`,
    [id, NR_FIRM_ID]
  );
  return u;
}

describe("S-H3 migration 0054 is neutralised", () => {
  it("S-H3: 0054 is a no-op: running it promotes nobody", async () => {
    const body = fs.readFileSync(FILE, "utf8");
    const id = await insertUser("shire602@gmail.com");
    await h.sql(body);
    expect(await state(id)).toEqual({
      is_admin: false,
      user_type: "customer",
      firm_role: null,
      nr_member: null,
    });
    await h.sql(`DELETE FROM users WHERE id = $1`, [id]);
  });

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "S-H3: a database that applied the original 0054 re-migrates cleanly and keeps its state",
    async () => {
      const id = await insertUser("shire602@gmail.com");
      await h.sql(ORIGINAL_0054);
      const ledgerBefore = await h.sql(
        `SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`
      );
      // Make the ledger look like production's: 0054's row carries the ORIGINAL file's hash.
      const journal = JSON.parse(
        fs.readFileSync(path.join(repoRoot, "migrations/meta/_journal.json"), "utf8")
      );
      const entry = journal.entries.find(
        (e: { tag: string }) => e.tag === "0054_promote_shire602_firm_owner"
      );
      const oldHash = createHash("sha256").update(ORIGINAL_0054).digest("hex");
      const newHash = createHash("sha256").update(fs.readFileSync(FILE, "utf8")).digest("hex");
      expect(oldHash).not.toBe(newHash);
      await h.sql(`UPDATE drizzle.__drizzle_migrations SET hash = $1 WHERE created_at = $2`, [
        oldHash,
        entry.when,
      ]);

      migrateDatabase(h.databaseUrl, { criticalSchema: false });

      const ledgerAfter = await h.sql(
        `SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`
      );
      expect(ledgerAfter[0].n).toBe(ledgerBefore[0].n);
      const [row] = await h.sql(
        `SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at = $1`,
        [entry.when]
      );
      expect(row.hash).toBe(oldHash);
      // The owner's existing promotion is untouched (no lock-out in production).
      expect(await state(id)).toMatchObject({ is_admin: true, firm_role: "firm_owner" });
      await h.sql(`DELETE FROM users WHERE id = $1`, [id]);
    },
    180_000
  );
});

describe("S-H3 opt-in platform owner grant / revoke", () => {
  it("settles an authorized timer when revoking and rolls back both changes if the audit insert fails", async () => {
    const { grantPlatformOwner, revokePlatformOwner } =
      await import("../../server/services/platform-owner.service");
    const candidate = await h.createTenant();
    const { email } = candidate;
    const options = { confirm: email };
    const replacement = await insertUser(`replacement-${randomUUID()}@example.test`);
    await h.sql("UPDATE users SET firm_role = 'firm_owner' WHERE id = $1", [replacement]);
    expect(await grantPlatformOwner(email, options)).toMatchObject({ ok: true, changed: true });

    const client = await candidate.as.post("/api/firm/clients", { name: "Platform timer client" });
    expect(client.status, client.text).toBe(201);
    const started = await candidate.as.post("/api/firm/time-entries/start", {
      companyId: client.body.id,
      hourlyRate: 60,
    });
    expect(started.status, started.text).toBe(201);
    const entryId = started.body.entry.id as string;
    const cutoff = new Date();
    await h.sql("UPDATE firm_time_entries SET started_at = $2 WHERE id = $1", [
      entryId,
      new Date(cutoff.getTime() - 13 * 60_000).toISOString(),
    ]);
    const timers = () =>
      h.sql(
        "SELECT status, minutes, billable, stopped_at = $2::timestamp AS stopped_at_cutoff FROM firm_time_entries WHERE id = $1",
        [entryId, cutoff.toISOString()]
      );
    await h.sql(`CREATE FUNCTION refuse_platform_owner_revoke_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'platform_owner.revoke' THEN RAISE EXCEPTION 'Injected platform audit failure'; END IF;
        RETURN NEW;
      END $$`);
    await h.sql(`CREATE TRIGGER refuse_platform_owner_revoke_audit BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION refuse_platform_owner_revoke_audit()`);
    const restore = freezeTime(cutoff);
    try {
      try {
        await expect(revokePlatformOwner(email, options)).rejects.toThrow();
        expect(await state(candidate.user.id)).toMatchObject({
          is_admin: true,
          firm_role: "firm_owner",
        });
        expect(await timers()).toEqual([
          expect.objectContaining({ status: "running", minutes: 0 }),
        ]);
      } finally {
        await h.sql("DROP TRIGGER refuse_platform_owner_revoke_audit ON audit_logs");
        await h.sql("DROP FUNCTION refuse_platform_owner_revoke_audit()");
      }
      expect(await revokePlatformOwner(email, options)).toMatchObject({ ok: true, changed: true });
      expect(await timers()).toEqual([
        { status: "logged", minutes: 13, billable: true, stopped_at_cutoff: true },
      ]);
    } finally {
      restore();
    }
  });

  it("S-H3: grant needs a matching confirmation and an existing account; it is idempotent and audited", async () => {
    const svc = await import("../../server/services/platform-owner.service");
    const email = `owner-${randomUUID().slice(0, 8)}@example.test`;

    expect(await svc.grantPlatformOwner(email, { confirm: email })).toEqual({
      ok: false,
      code: "USER_NOT_FOUND",
    });
    const id = await insertUser(email);
    expect(await svc.grantPlatformOwner(email, { confirm: "someone@else.test" })).toEqual({
      ok: false,
      code: "CONFIRMATION_MISMATCH",
    });
    expect((await state(id)).is_admin).toBe(false);

    const granted = await svc.grantPlatformOwner(email.toUpperCase(), { confirm: ` ${email} ` });
    expect(granted).toMatchObject({ ok: true, changed: true });
    expect(await state(id)).toEqual({
      is_admin: true,
      user_type: "admin",
      firm_role: "firm_owner",
      nr_member: "firm_owner",
    });
    expect(await svc.grantPlatformOwner(email, { confirm: email })).toMatchObject({
      ok: true,
      changed: false,
    });

    const replacementId = await insertUser(`replacement-${randomUUID()}@example.test`);
    await h.sql(`UPDATE users SET firm_role = 'firm_owner' WHERE id = $1`, [replacementId]);
    const revoked = await svc.revokePlatformOwner(email, { confirm: email });
    expect(revoked).toMatchObject({ ok: true, changed: true });
    expect(await state(id)).toEqual({
      is_admin: false,
      user_type: "customer",
      firm_role: null,
      nr_member: null,
    });
    expect(await svc.revokePlatformOwner(email, { confirm: email })).toMatchObject({
      ok: true,
      changed: false,
    });

    const audits = await h.sql(
      `SELECT action FROM audit_logs WHERE resource_id = $1 ORDER BY created_at, seq`,
      [id]
    );
    expect(audits.map((a: { action: string }) => a.action)).toEqual([
      "platform_owner.grant",
      "platform_owner.revoke",
    ]);
  });

  it("S-H3: a staff member of another firm is never moved into the NR firm", async () => {
    const svc = await import("../../server/services/platform-owner.service");
    const t = await h.createTenant({ name: "OtherFirmStaff" });
    const firmId = randomUUID();
    await h.sql(
      `INSERT INTO firms (id, name, slug, status) VALUES ($1, 'Other Firm LLC', $2, 'active')`,
      [firmId, `other-firm-${firmId.slice(0, 8)}`]
    );
    await h.sql(`INSERT INTO firm_members (firm_id, user_id, role) VALUES ($1, $2, 'preparer')`, [
      firmId,
      t.user.id,
    ]);
    const r = await svc.grantPlatformOwner(t.user.email, { confirm: t.user.email });
    expect(r).toEqual({ ok: false, code: "MEMBER_OF_OTHER_FIRM" });
    expect((await state(t.user.id)).is_admin).toBe(false);
  });
});
