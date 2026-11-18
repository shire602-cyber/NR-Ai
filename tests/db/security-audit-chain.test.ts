/**
 * W5-E tamper-evident audit log and security events (R02-17, R17-23, R01-16).
 */
import { describe, expect, it } from "vitest";
import { useHarness, postJournalEntry } from "./harness";

const h = useHarness();

async function tamper(sqlText: string, params: unknown[]): Promise<void> {
  // The append-only trigger refuses UPDATE/DELETE unless a maintenance session opts in;
  // a direct database edit like this is exactly what the chain must expose.
  const { pool } = await import("../../server/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL muhasib.audit_maintenance = 'on'");
    await client.query(sqlText, params);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
}

describe("W5-E audit hash chain", () => {
  it("[R02-17] postings and account lifecycle events form a verifiable chain with before/after", async () => {
    const t = await h.createTenant({ name: "Chain" });
    await postJournalEntry(t, {
      date: "2026-01-15",
      lines: [
        { code: "1020", debit: 100 },
        { code: "3010", credit: 100 },
      ],
    });
    const acc = await t.as.post(`/api/companies/${t.company.id}/accounts`, {
      code: "6199",
      nameEn: "Chain test expense",
      type: "expense",
    });
    expect(acc.status, acc.text).toBe(201);

    const verify = await t.as.get(`/api/companies/${t.company.id}/audit-log/verify`);
    expect(verify.status).toBe(200);
    expect(verify.body.ok).toBe(true);
    expect(verify.body.checked).toBeGreaterThanOrEqual(2);
    expect(verify.body.firstBroken).toBeNull();

    const rows = await h.sql(
      `SELECT seq, prev_hash, hash, action FROM audit_logs WHERE company_id = $1 ORDER BY seq`,
      [t.company.id]
    );
    expect(rows[0].seq).toBe("1");
    expect(rows[0].prev_hash).toBe("0".repeat(64));
    for (let i = 1; i < rows.length; i++) expect(rows[i].prev_hash).toBe(rows[i - 1].hash);

    const list = await t.as.get(`/api/companies/${t.company.id}/audit-log?category=accounts`);
    expect(list.status).toBe(200);
    const created = list.body.events.find((e: { action: string }) => e.action === "account.create");
    expect(created.after).toMatchObject({ code: "6199", type: "expense" });
    expect(created.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[R17-23] editing a row is detected at its seq; append-only refuses plain UPDATE/DELETE", async () => {
    const t = await h.createTenant({ name: "Tamper" });
    for (const code of ["6191", "6192", "6193"]) {
      const r = await t.as.post(`/api/companies/${t.company.id}/accounts`, {
        code,
        nameEn: `Tamper ${code}`,
        type: "expense",
      });
      expect(r.status).toBe(201);
    }
    await expect(
      h.sql(`UPDATE audit_logs SET action = 'x' WHERE company_id = $1`, [t.company.id])
    ).rejects.toThrow(/append-only/);
    await expect(
      h.sql(`DELETE FROM audit_logs WHERE company_id = $1`, [t.company.id])
    ).rejects.toThrow(/append-only/);

    const [second] = await h.sql(
      `SELECT id, seq FROM audit_logs WHERE company_id = $1 ORDER BY seq OFFSET 1 LIMIT 1`,
      [t.company.id]
    );
    await tamper(`UPDATE audit_logs SET action = action || '-edited' WHERE id = $1`, [second.id]);
    const verify = await t.as.get(`/api/companies/${t.company.id}/audit-log/verify`);
    expect(verify.body.ok).toBe(false);
    expect(verify.body.firstBroken).toMatchObject({
      seq: Number(second.seq),
      id: second.id,
      reason: "hash_mismatch",
    });

    // Deleting a row is a sequence gap at the missing seq.
    const t2 = await h.createSecondTenant({ name: "Gap" });
    for (const code of ["6194", "6195", "6196"]) {
      await t2.as.post(`/api/companies/${t2.company.id}/accounts`, {
        code,
        nameEn: `Gap ${code}`,
        type: "expense",
      });
    }
    const [mid] = await h.sql(
      `SELECT id, seq FROM audit_logs WHERE company_id = $1 ORDER BY seq OFFSET 1 LIMIT 1`,
      [t2.company.id]
    );
    await tamper(`DELETE FROM audit_logs WHERE id = $1`, [mid.id]);
    const gap = await t2.as.get(`/api/companies/${t2.company.id}/audit-log/verify`);
    expect(gap.body.ok).toBe(false);
    expect(gap.body.firstBroken).toMatchObject({ seq: Number(mid.seq), reason: "sequence_gap" });
  });

  it("[R02-17] concurrent inserts keep one unbroken chain", async () => {
    const t = await h.createTenant({ name: "Concurrent" });
    const { recordAudit } = await import("../../server/services/audit.service");
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        recordAudit({
          userId: t.user.id,
          companyId: t.company.id,
          action: "test.concurrent",
          entityType: "test",
          entityId: String(i),
          after: { i },
        })
      )
    );
    const rows = await h.sql(
      `SELECT seq FROM audit_logs WHERE company_id = $1 AND action = 'test.concurrent'`,
      [t.company.id]
    );
    expect(rows).toHaveLength(40);
    const all = await h.sql(
      `SELECT seq::int AS seq FROM audit_logs WHERE company_id = $1 ORDER BY seq`,
      [t.company.id]
    );
    expect(all.map((r) => r.seq)).toEqual(all.map((_, i) => i + 1));
    const verify = await t.as.get(`/api/companies/${t.company.id}/audit-log/verify`);
    expect(verify.body, JSON.stringify(verify.body)).toMatchObject({ ok: true, firstBroken: null });
  });

  it("[R17-23] export carries hashes and before/after; audit routes are owner/admin and tenant scoped", async () => {
    const a = await h.createTenant({ name: "Export" });
    const b = await h.createSecondTenant({ name: "ExportOther" });
    await a.as.post(`/api/companies/${a.company.id}/accounts`, {
      code: "6197",
      nameEn: "Export test",
      type: "expense",
    });
    const csv = await a.as.get(`/api/companies/${a.company.id}/audit-log/export?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(csv.text.split("\r\n")[0]).toBe(
      "seq,id,created_at,user_id,action,resource_type,resource_id,ip_address,user_agent,before,after,prev_hash,hash,legacy"
    );
    expect(csv.text).toContain("account.create");
    expect(csv.headers.get("x-audit-chain-verified")).toBe("true");
    const json = await a.as.get(`/api/companies/${a.company.id}/audit-log/export?format=json`);
    expect(json.body.verification.ok).toBe(true);
    expect(json.body.rows[0].hash).toMatch(/^[0-9a-f]{64}$/);

    for (const path of ["audit-log", "audit-log/verify", "audit-log/export", "security/policy"]) {
      const leak = await b.as.get(`/api/companies/${a.company.id}/${path}`);
      expect([403, 404]).toContain(leak.status);
    }
    const viewer = await h.createTenant({ name: "ExportViewer" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      a.company.id,
      viewer.user.id,
    ]);
    const denied = await viewer.as.get(`/api/companies/${a.company.id}/audit-log`);
    expect(denied.status).toBe(403);
    const bad = await a.as.get(`/api/companies/${a.company.id}/audit-log?limit=abc`);
    expect(bad.status).toBe(400);
  });
});

describe("W5-E audit chain lock never deadlocks", () => {
  it("[R02-17] an audit insert on another connection while a transaction holds the chain lock completes and is sealed after commit", async () => {
    const t = await h.createTenant({ name: "NoDeadlock" });
    const { pool } = await import("../../server/db");
    const { recordAudit } = await import("../../server/services/audit.service");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Like a ledger posting: the open transaction writes its own audit row first.
      await client.query(
        `INSERT INTO audit_logs (user_id, company_id, action, resource_type, resource_id, details)
         VALUES ($1, $2, 'journal.create_posted', 'journal_entry', 'je-1', '{}')`,
        [t.user.id, t.company.id]
      );
      // ...then something inside it calls recordAudit on the shared pool.
      const started = Date.now();
      await recordAudit({
        userId: t.user.id,
        companyId: t.company.id,
        action: "test.inside_open_tx",
        entityType: "test",
        entityId: "x",
      });
      expect(Date.now() - started).toBeLessThan(3000);
      const [pending] = await h.sql(
        `SELECT seq, hash FROM audit_logs WHERE company_id = $1 AND action = 'test.inside_open_tx'`,
        [t.company.id]
      );
      expect(pending.seq).toBeNull();
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const verify = await t.as.get(`/api/companies/${t.company.id}/audit-log/verify`);
    expect(verify.body).toMatchObject({ ok: true, firstBroken: null, pendingRows: 0 });
    const [sealed] = await h.sql(
      `SELECT seq, hash FROM audit_logs WHERE company_id = $1 AND action = 'test.inside_open_tx'`,
      [t.company.id]
    );
    expect(sealed.hash).toMatch(/^[0-9a-f]{64}$/);
    // The sealer cannot be abused to rewrite content.
    await expect(
      h.sql(
        `BEGIN; SET LOCAL muhasib.audit_sealing = 'on';
         UPDATE audit_logs SET action = 'forged' WHERE company_id = '${t.company.id}'; COMMIT;`
      )
    ).rejects.toThrow(/append-only/);
    await h.sql("ROLLBACK").catch(() => undefined);
  });
});

describe("W5-E security events", () => {
  it("[R01-16] sign-in success/failure, lockout and password change are recorded; a new device+network raises a suspicious-login alert", async () => {
    const t = await h.createTenant({ name: "Events" });
    const { onDomainEvent, drainDomainEvents } =
      await import("../../server/platform/domain-events");
    const alerts: string[] = [];
    const off = onDomainEvent("security.suspicious_login", (e) => {
      alerts.push(e.payload.entityId);
    });

    const failed = await h.anon.post("/api/auth/login", {
      email: t.email,
      password: "Wrong9Pass!",
    });
    expect(failed.status).toBe(401);
    // Same device (node fetch) and network: not suspicious.
    const again = await h.anon.post("/api/auth/login", { email: t.email, password: t.password });
    expect(again.status).toBe(200);
    // New browser on a new network.
    const strange = await h.anon.post(
      "/api/auth/login",
      { email: t.email, password: t.password },
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/131.0",
          "X-Forwarded-For": "203.0.113.77",
        },
      }
    );
    expect(strange.status).toBe(200);
    await drainDomainEvents();
    off();
    const dbg = await h.sql(
      `SELECT action, ip_address, user_agent FROM audit_logs WHERE user_id = $1`,
      [t.user.id]
    );
    expect(alerts, JSON.stringify(dbg)).toEqual([t.user.id]);

    const actions = (
      await h.sql(`SELECT action FROM audit_logs WHERE user_id = $1 ORDER BY created_at, seq`, [
        t.user.id,
      ])
    ).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(["auth.login_failure", "auth.login_success", "auth.suspicious_login"])
    );
    const notes = await h.sql(`SELECT title FROM notifications WHERE user_id = $1`, [t.user.id]);
    expect(notes.map((n) => n.title)).toContain("New sign-in to your account");

    const history = await t.as.get("/api/auth/login-history");
    expect(history.status).toBe(200);
    expect(history.body.events.map((e: { action: string }) => e.action)).toContain(
      "auth.suspicious_login"
    );

    // The global (no-company) chain verifies for platform admins only.
    const admin = await h.createTenant({ name: "EventsAdmin", isAdmin: true });
    const global = await admin.as.get("/api/admin/audit-log/verify");
    expect(global.status).toBe(200);
    expect(global.body.chainKey).toBe("global");
    expect(global.body.ok).toBe(true);
    const notAdmin = await t.as.get("/api/admin/audit-log/verify");
    expect(notAdmin.status).toBe(403);
  });
});
