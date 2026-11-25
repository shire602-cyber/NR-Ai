/**
 * S5 backups (W5-B R19-06/R19-07/R19-17; S5 restore into another company): manifest
 * derivation, snapshot sealing, clone remapping and the restore/clone orchestration against a
 * fake pg pool. Real-Postgres behaviour is covered by tests/db/backup-full-restore.test.ts and
 * tests/db/s5-platform.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CO = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const INV = "33333333-3333-4333-8333-333333333333";
const LINE = "44444444-4444-4444-8444-444444444444";
const LINK = "55555555-5555-4555-8555-555555555555";

const schema = {
  tables: [
    "companies",
    "invoices",
    "invoice_lines",
    "payment_links",
    "link_events",
    "webhook_endpoints",
    "backups",
    "audit_logs",
    "notes",
  ],
  cols: [
    ["invoices", "id"],
    ["invoices", "company_id"],
    ["invoices", "number"],
    ["invoices", "share_token"],
    ["invoices", "credit_of"],
    ["invoice_lines", "id"],
    ["invoice_lines", "invoice_id"],
    ["invoice_lines", "amount"],
    ["payment_links", "id"],
    ["payment_links", "company_id"],
    ["link_events", "id"],
    ["link_events", "link_id"],
    ["webhook_endpoints", "company_id"],
    ["backups", "id"],
    ["backups", "company_id"],
    ["audit_logs", "id"],
    ["audit_logs", "company_id"],
    ["notes", "company_id"],
    ["notes", "body"],
  ],
  pks: [
    ["invoices", "id"],
    ["invoice_lines", "id"],
    ["payment_links", "id"],
    ["link_events", "id"],
    ["backups", "id"],
    ["audit_logs", "id"],
  ],
  fks: [
    {
      table_name: "invoice_lines",
      column_name: "invoice_id",
      ref_table: "invoices",
      ref_column: "id",
      is_nullable: "NO",
    },
    {
      table_name: "invoices",
      column_name: "credit_of",
      ref_table: "invoice_lines",
      ref_column: "id",
      is_nullable: "YES",
    },
    {
      table_name: "link_events",
      column_name: "link_id",
      ref_table: "payment_links",
      ref_column: "id",
      is_nullable: "NO",
    },
    {
      table_name: '"invoices"',
      column_name: "company_id",
      ref_table: "companies",
      ref_column: "id",
      is_nullable: "NO",
    },
  ],
};

const snapshotTables: Record<string, unknown[]> = {
  invoices: [{ id: INV, company_id: CO, number: "INV-1", share_token: "tok", credit_of: LINE }],
  invoice_lines: [{ id: LINE, invoice_id: INV, amount: 10, memo: `see ${INV}` }],
  payment_links: [{ id: LINK, company_id: CO }],
  link_events: [{ id: "66666666-6666-4666-8666-666666666666", link_id: LINK }],
  webhook_endpoints: [{ company_id: CO }],
  notes: [{ company_id: CO, body: "no pk" }],
};

const log: string[] = [];
let backupRow: Record<string, unknown> | null = null;
let targetActivity = 0;
let schedules: Array<Record<string, unknown>> = [];

function answer(text: string, params: unknown[] = []) {
  const sql = text.replace(/\s+/g, " ").trim();
  log.push(sql);
  const out = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  if (sql.includes("information_schema.tables t") && sql.includes("column_name = 'company_id'"))
    return out(
      ["invoices", "payment_links", "backups", "audit_logs", "notes"].map((t) => ({
        table_name: t,
      }))
    );
  if (sql.includes("FROM information_schema.tables"))
    return out(schema.tables.map((t) => ({ table_name: t })));
  if (sql.includes("FROM information_schema.columns"))
    return out(
      schema.cols.map(([t, c]) => ({
        table_name: t,
        column_name: c,
        is_generated: "NEVER",
        identity_generation: null,
      }))
    );
  if (sql.includes("constraint_type = 'PRIMARY KEY'"))
    return out(schema.pks.map(([t, c]) => ({ table_name: t, column_name: c })));
  if (sql.includes("FROM pg_constraint"))
    return out(
      schema.fks.map((f) => ({
        ...f,
        columns: [f.column_name],
        ref_columns: [f.ref_column],
      }))
    );
  const agg = sql.match(
    /json_agg\(to_jsonb\(t\) - \$2::text\[\]\), '\[\]'::json\) AS data FROM "([^"]+)"/
  );
  if (agg) return out([{ data: snapshotTables[agg[1]] ?? [] }]);
  if (sql.startsWith("INSERT INTO backups"))
    return out([{ id: "bk-new", company_id: params[0], name: params[1], status: "in_progress" }]);
  if (sql.startsWith("UPDATE backups SET status = 'completed'")) {
    backupRow = { ...(backupRow ?? {}), data_snapshot: params[1], checksum: params[2] };
    return out([{ id: params[0], status: "completed", table_counts: params[4] }]);
  }
  if (sql.startsWith("SELECT id, company_id, status, data_snapshot, checksum, name FROM backups"))
    return out(backupRow ? [backupRow] : []);
  if (sql.includes("FROM companies WHERE id = $1 AND deleted_at IS NULL"))
    return out([{ base_currency: "AED" }]);
  if (sql.includes("AS clone_rows"))
    return out(targetActivity ? [{ idx: 0, n: String(targetActivity) }] : []);
  if (sql.startsWith('INSERT INTO "invoices"') && sql.includes("RETURNING"))
    return out([{ id: INV }]);
  if (sql.includes("AS snapshot_rows"))
    return out([{ snapshot_rows: "1", current_rows: "1", ins: "1", upd: "1", del: "1" }]);
  if (sql.includes("(SELECT count(*) FROM json_populate_recordset"))
    return out([{ s: "1", c: "3" }]);
  if (sql.includes("FROM backup_schedules")) return out(schedules);
  return out([]);
}

const fakeClient = {
  query: vi.fn(async (text: string, params?: unknown[]) => answer(text, params)),
  release: vi.fn(),
};
vi.mock("../../server/db", () => ({
  pool: {
    query: vi.fn(async (text: string, params?: unknown[]) => answer(text, params)),
    connect: vi.fn(async () => fakeClient),
  },
  db: {},
}));

// The SQL transaction path must write the audit row through the fake pg client.
vi.mock("../../server/storage", () => ({ storage: {} }));

beforeEach(() => {
  log.length = 0;
  backupRow = null;
  targetActivity = 0;
  schedules = [];
});

async function svc() {
  return import("../../server/services/backup.service");
}

async function sealedBackup(companyId = CO) {
  const s = await svc();
  const sealed = s.sealSnapshot({
    version: s.BACKUP_FORMAT_VERSION,
    createdAt: "2026-01-01T00:00:00.000Z",
    companyId,
    tables: snapshotTables,
  });
  backupRow = {
    id: "bk-1",
    company_id: CO,
    status: "completed",
    data_snapshot: sealed.sealed,
    checksum: sealed.checksum,
    name: "Snap",
  };
  return sealed;
}

describe("S5 backup manifest + snapshot (unit)", () => {
  it("derives company and child tables, excludes by name/pattern, orders parents first and breaks FK cycles", async () => {
    const s = await svc();
    const m = await s.buildBackupManifest();
    const names = m.tables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["invoices", "invoice_lines", "webhook_endpoints", "notes"])
    );
    expect(names).not.toContain("payment_links");
    expect(names).not.toContain("link_events");
    expect(names).not.toContain("backups");
    expect(names).not.toContain("audit_logs");
    expect(s.exclusionReason("audit_logs")).toMatch(/audit/);
    expect(s.exclusionReason("invoices")).toBeNull();
    const lines = m.tables.find((t) => t.name === "invoice_lines")!;
    expect(lines.scope).toBe("child");
    expect(lines.predicate).toContain('FROM "invoices" p');
    // invoices <-> invoice_lines cycle: the nullable credit_of is deferred.
    expect(m.tables.find((t) => t.name === "invoices")!.deferred).toEqual(["credit_of"]);
    expect(names.indexOf("invoices")).toBeLessThan(names.indexOf("invoice_lines"));
    expect(await s.companyScopedTables()).toContain("notes");
  });

  it("seals with encryption + checksum, opens and verifies, and refuses a tampered or legacy snapshot", async () => {
    const s = await svc();
    const snap = await s.captureSnapshot(CO);
    expect(snap.tables.invoices).toHaveLength(1);
    expect(snap.tables).not.toHaveProperty("payment_links");
    const sealed = s.sealSnapshot(snap);
    expect(sealed.sealed).toMatch(/^enc:v1:/);
    expect(sealed.counts.invoices).toBe(1);
    const opened = s.openSnapshot(sealed.sealed, sealed.checksum);
    expect((opened.snapshot as { companyId: string }).companyId).toBe(CO);
    expect(() => s.openSnapshot(sealed.sealed, "0".repeat(64))).toThrow(/checksum/);
    const legacyJson = JSON.stringify({ version: "1", companyId: CO, data: {} }, null, 2);
    const legacy = s.openSnapshot(legacyJson, null);
    expect((legacy.snapshot as { data: unknown }).data).toEqual({});
    expect(s.exportBackupSnapshot(legacyJson, null, false)).toMatchObject({ body: legacyJson });
    const legacyEncrypted = s.exportBackupSnapshot(legacyJson, null, true);
    expect(legacyEncrypted.body).toMatch(/^enc:v1:/);
    expect(legacyEncrypted.contentDigest).toBeUndefined();
    expect(s.openSnapshot(legacyEncrypted.body, null).json).toBe(legacyJson);
  });
});

describe("S5 clone remapping (unit)", () => {
  it("gives every row a fresh id, rewrites references everywhere and clears shared tokens", async () => {
    const s = await svc();
    let n = 0;
    const ids = () => `99999999-9999-4999-8999-${String(++n).padStart(12, "0")}`;
    const { tables, remapped } = s.remapSnapshotForClone(
      snapshotTables,
      [
        { name: "invoices", pk: ["id"] },
        { name: "invoice_lines", pk: ["id"] },
        { name: "notes", pk: [] },
      ],
      CO,
      TARGET,
      ids
    );
    expect(remapped).toBe(2);
    const inv = tables.invoices[0] as Record<string, unknown>;
    const line = tables.invoice_lines[0] as Record<string, unknown>;
    expect(inv.id).not.toBe(INV);
    expect(inv.company_id).toBe(TARGET);
    expect(inv.share_token).toBeNull();
    expect(inv.credit_of).toBe(line.id);
    expect(line.invoice_id).toBe(inv.id);
    expect(line.memo).toBe(`see ${inv.id}`);
    expect((tables.notes[0] as Record<string, unknown>).company_id).toBe(TARGET);
    // Input is not mutated.
    expect((snapshotTables.invoices[0] as Record<string, unknown>).id).toBe(INV);
  });

  it("skips provider-bound tables and children reached only through them", async () => {
    const s = await svc();
    const skip = s.cloneSkipReasons([
      { name: "ecommerce_integrations", scope: "company", predicate: "t.company_id = $1" },
      {
        name: "integration_events",
        scope: "child",
        predicate:
          '(t."integration_id" IN (SELECT p."id" FROM "ecommerce_integrations" p WHERE p.company_id = $1))',
      },
      {
        name: "invoice_lines",
        scope: "child",
        predicate: '(t."invoice_id" IN (SELECT p."id" FROM "invoices" p WHERE p.company_id = $1))',
      },
    ]);
    expect([...skip.keys()].sort()).toEqual(["ecommerce_integrations", "integration_events"]);
    expect(skip.get("integration_events")).toMatch(/ecommerce_integrations/);
  });
});

describe("S5 restore + clone orchestration (fake pool)", () => {
  it("creates a backup: in_progress row, consistent read, sealed completion", async () => {
    const s = await svc();
    const b = await s.createCompanyBackup({ companyId: CO, userId: "u", backupType: "manual" });
    expect(b.status).toBe("completed");
    expect(log.some((q) => q.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"))).toBe(
      true
    );
  });

  it("restore dry run diffs every table and rolls back; replace takes a pre-restore backup", async () => {
    const s = await svc();
    await sealedBackup();
    const dry = await s.restoreCompanyBackup({
      backupId: "bk-1",
      companyId: CO,
      userId: "u",
      mode: "merge",
      dryRun: true,
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.totals.update).toBe(0); // merge never updates or deletes
    expect(log).toContain("ROLLBACK");
    await sealedBackup();
    const rep = await s.restoreCompanyBackup({
      backupId: "bk-1",
      companyId: CO,
      userId: "u",
      mode: "replace",
      dryRun: false,
    });
    expect(rep.preRestoreBackupId).toBe("bk-new");
    expect(rep.totals.delete).toBeGreaterThan(0);
    const audit = log.findIndex((q) => q.startsWith("INSERT INTO audit_logs"));
    expect(audit).toBeGreaterThan(-1);
    expect(log.indexOf("COMMIT")).toBeGreaterThan(audit);
    expect(log.some((q) => q.startsWith('DELETE FROM "invoices"'))).toBe(true);
    expect(
      log.some((q) => q.startsWith('UPDATE "invoices" t SET "credit_of" = s."credit_of"'))
    ).toBe(true);
    await expect(
      s.restoreCompanyBackup({
        backupId: "bk-1",
        companyId: TARGET,
        userId: "u",
        mode: "merge",
        dryRun: true,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("clone: refuses self and non-empty targets, dry-runs with skips, and loads remapped rows", async () => {
    const s = await svc();
    await sealedBackup();
    await expect(
      s.restoreBackupIntoCompany({
        backupId: "bk-1",
        sourceCompanyId: CO,
        targetCompanyId: CO,
        userId: "u",
        dryRun: true,
      })
    ).rejects.toMatchObject({ code: "CLONE_TARGET_IS_SOURCE" });
    targetActivity = 1;
    await expect(
      s.restoreBackupIntoCompany({
        backupId: "bk-1",
        sourceCompanyId: CO,
        targetCompanyId: TARGET,
        userId: "u",
        dryRun: true,
      })
    ).rejects.toMatchObject({ code: "CLONE_TARGET_NOT_EMPTY" });
    targetActivity = 0;
    const dry = await s.restoreBackupIntoCompany({
      backupId: "bk-1",
      sourceCompanyId: CO,
      targetCompanyId: TARGET,
      userId: "u",
      dryRun: true,
    });
    expect(dry.skippedTables.map((t) => t.table)).toEqual(["webhook_endpoints"]);
    expect(dry.tables.find((t) => t.table === "invoices")).toEqual({ table: "invoices", rows: 1 });
    expect(dry.preRestoreBackupId).toBeNull();
    await sealedBackup();
    const done = await s.restoreBackupIntoCompany({
      backupId: "bk-1",
      sourceCompanyId: CO,
      targetCompanyId: TARGET,
      userId: "u",
      dryRun: false,
    });
    expect(done.preRestoreBackupId).toBe("bk-new");
    const insert = log.find((q) => q.startsWith('INSERT INTO "invoices"'));
    expect(insert).toBeTruthy();
    expect(log.some((q) => q.startsWith('INSERT INTO "payment_links"'))).toBe(false);
  });

  it("runs due schedules and expires old scheduled backups", async () => {
    const s = await svc();
    schedules = [
      {
        company_id: CO,
        frequency: "daily",
        retention_days: 30,
        last_run_at: null,
        created_by: "u",
      },
      {
        company_id: TARGET,
        frequency: "weekly",
        retention_days: 30,
        last_run_at: new Date(),
        created_by: "u",
      },
    ];
    expect(await s.runScheduledBackups()).toBe(1);
    expect(
      log.some((q) => q.startsWith("DELETE FROM backups WHERE backup_type = 'scheduled'"))
    ).toBe(true);
  });
});
