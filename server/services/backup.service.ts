/**
 * Full-company backups (W5-B, R19-06, R19-07, R17-08, R17-22, R19-17).
 *
 * Manifest: derived from the live schema at runtime — every table with a
 * `company_id` column, plus every table reachable from those through a
 * foreign key (journal_lines, invoice_lines, bill_line_items, payroll_items,
 * ...). Raw-SQL tables (vendor_bills, employees, payroll_runs, fixed_assets,
 * budgets, expense_claims) are covered the same way. A small, explicit
 * exclusion list (each with a reason) keeps audit trails, credentials, access
 * control and billing state out of a restore. tests/db/backup-*.test.ts fails
 * when a company-scoped table is neither captured nor explicitly excluded.
 *
 * Snapshot: JSON rows exactly as Postgres renders them (to_jsonb), gzip,
 * AES-256-GCM through the secret vault (key from TOKEN_ENCRYPTION_KEY or
 * SESSION_SECRET), SHA-256 checksum of the plaintext, verified before restore.
 *
 * Restore (always transactional, under a per-company advisory lock):
 *   merge    insert rows that are missing; existing rows are left as they are
 *   replace  automatic pre-restore backup, then: delete rows created after the
 *            snapshot (reverse FK order) and upsert every snapshot row (FK
 *            order) — the company's data equals the snapshot afterwards
 *   dryRun   either mode, computed and rolled back: per-table insert / update / delete counts
 * Append-only tables (einvoice_archive, tax_return_archive) are only ever
 * topped up, never rewritten. The audit entry is written after the commit.
 *
 * Point-in-time recovery is a database-host setting (WAL archiving / PITR on
 * the managed Postgres) and an off-site copy of these snapshots is an
 * external bucket — both are EXTERNAL actions documented in docs/api/backups.md.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";
import { pool } from "../db";
import { pq, type Queryable } from "./connectors/pq";
import { decryptSecret, encryptSecret } from "./secret-vault";
import { DomainError } from "../errors";
import { createLogger } from "../config/logger";

const log = createLogger("backup-service");

export const BACKUP_FORMAT_VERSION = "2.0";

/** Company-scoped tables deliberately NOT in a backup, and why. */
export const BACKUP_EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  backups: "the backups themselves",
  backup_schedules: "backup configuration",
  activity_logs: "audit trail: must survive every restore",
  company_users: "access control: a restore must not lock out or revive members",
  invitations: "access control",
  company_invitations: "access control",
  api_keys: "credentials: a restore must never revive a revoked key",
  bank_feed_oauth_states: "short-lived OAuth state",
  portal_login_codes: "short-lived credentials",
  portal_access_tokens: "credentials",
  payslip_tokens: "credentials",
  portal_access_log: "access log (audit)",
  analytics_events: "product telemetry",
  ai_usage_events: "metering telemetry",
  usage_counters: "billing meter",
  subscriptions: "billing state is owned by the billing provider",
  billing_credits: "billing state",
  billing_documents: "billing state",
  email_outbox: "delivery queue (re-sending on restore would spam customers)",
  email_outbox_attachments: "delivery queue",
  email_delivery_events: "delivery log",
  webhook_deliveries: "delivery log",
  company_report_delivery_scheduler_scans: "scheduler telemetry",
  company_report_delivery_runs: "delivery log",
  whatsapp_bridge_jobs: "transient bridge state",
  whatsapp_bridge_sessions: "transient bridge state",
  import_jobs: "migration staging data",
  notifications: "per-user inbox",
  user_feedback: "product feedback",
  firm_alerts: "owned by the NR firm workspace",
  firm_growth_opportunities: "owned by the NR firm workspace",
  firm_growth_actions: "owned by the NR firm workspace",
  firm_leads: "owned by the NR firm workspace",
  firm_staff_assignments: "owned by the NR firm workspace",
  engagements: "owned by the NR firm workspace",
};

/** Excluded by name pattern (tamper-evident audit tables added by other modules). */
const EXCLUDED_PATTERNS: Array<[RegExp, string]> = [
  [/^audit_|_audit$|_audit_log$|_audit_chain$/, "audit trail: must survive every restore"],
];

/** Captured, but restore only adds missing rows (rows are immutable by trigger / law). */
export const APPEND_ONLY_TABLES = new Set(["einvoice_archive", "tax_return_archive"]);

export function exclusionReason(table: string): string | null {
  if (BACKUP_EXCLUDED_TABLES[table]) return BACKUP_EXCLUDED_TABLES[table];
  for (const [rx, reason] of EXCLUDED_PATTERNS) if (rx.test(table)) return reason;
  return null;
}

// ─── Manifest ────────────────────────────────────────────────────────────────

export interface ManifestTable {
  name: string;
  /** "company" (has company_id) or "child" (reached through FKs). */
  scope: "company" | "child";
  /** SQL predicate on alias `t` selecting this company's rows ($1 = company id). */
  predicate: string;
  pk: string[];
  columns: string[]; // insertable (non-generated) columns
  /** FK columns inserted NULL first and set afterwards (breaks FK cycles). */
  deferred: string[];
  appendOnly: boolean;
}

export interface BackupManifest {
  tables: ManifestTable[]; // FK-safe insert order
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

interface FkRow {
  table_name: string;
  column_name: string;
  ref_table: string;
  ref_column: string;
  is_nullable: string;
}

export async function buildBackupManifest(client: Queryable = pool): Promise<BackupManifest> {
  const tables = (
    await pq<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      [],
      client
    )
  ).rows.map((r) => r.table_name);
  const cols = (
    await pq<{
      table_name: string;
      column_name: string;
      is_generated: string;
      identity_generation: string | null;
    }>(
      `SELECT table_name, column_name, is_generated, identity_generation
         FROM information_schema.columns WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position`,
      [],
      client
    )
  ).rows;
  const pks = (
    await pq<{ table_name: string; column_name: string }>(
      `SELECT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position`,
      [],
      client
    )
  ).rows;
  const fks = (
    await pq<FkRow>(
      `SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name,
              c.confrelid::regclass::text AS ref_table, af.attname AS ref_column,
              CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
        WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
          AND c.connamespace = 'public'::regnamespace`,
      [],
      client
    )
  ).rows.map((r) => ({
    ...r,
    table_name: r.table_name.replace(/^"|"$/g, ""),
    ref_table: r.ref_table.replace(/^"|"$/g, ""),
  }));

  const colsOf = new Map<string, string[]>();
  const hasCompanyId = new Set<string>();
  for (const c of cols) {
    if (c.column_name === "company_id") hasCompanyId.add(c.table_name);
    if (c.is_generated === "ALWAYS" || c.identity_generation === "ALWAYS") continue;
    const list = colsOf.get(c.table_name) ?? [];
    list.push(c.column_name);
    colsOf.set(c.table_name, list);
  }
  const pkOf = new Map<string, string[]>();
  for (const p of pks) pkOf.set(p.table_name, [...(pkOf.get(p.table_name) ?? []), p.column_name]);

  const included = new Map<string, ManifestTable>();
  for (const t of tables) {
    if (!hasCompanyId.has(t) || exclusionReason(t)) continue;
    included.set(t, {
      name: t,
      scope: "company",
      predicate: `t.company_id = $1`,
      pk: pkOf.get(t) ?? [],
      columns: colsOf.get(t) ?? [],
      deferred: [],
      appendOnly: APPEND_ONLY_TABLES.has(t),
    });
  }
  // Children: tables without company_id that reference included tables (to a fixed point).
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of tables) {
      if (included.has(t) || hasCompanyId.has(t) || exclusionReason(t)) continue;
      const parents = fks.filter(
        (f) => f.table_name === t && f.ref_table !== t && included.has(f.ref_table)
      );
      if (!parents.length) continue;
      const predicate = parents
        .map((f) => {
          const parent = included.get(f.ref_table)!;
          const inner = parent.predicate.replace(/\bt\./g, "p.");
          return `t.${q(f.column_name)} IN (SELECT p.${q(f.ref_column)} FROM ${q(f.ref_table)} p WHERE ${inner})`;
        })
        .join(" OR ");
      included.set(t, {
        name: t,
        scope: "child",
        predicate: `(${predicate})`,
        pk: pkOf.get(t) ?? [],
        columns: colsOf.get(t) ?? [],
        deferred: [],
        appendOnly: APPEND_ONLY_TABLES.has(t),
      });
      changed = true;
    }
  }

  // FK order (parents first). Self references are fine within one statement;
  // cross-table cycles are broken by deferring a nullable FK column.
  const edges = fks.filter(
    (f) => included.has(f.table_name) && included.has(f.ref_table) && f.table_name !== f.ref_table
  );
  const order: string[] = [];
  const remaining = new Set(included.keys());
  let active = [...edges];
  while (remaining.size) {
    const ready = [...remaining].filter(
      (t) => !active.some((e) => e.table_name === t && remaining.has(e.ref_table))
    );
    if (ready.length) {
      ready.sort();
      for (const t of ready) {
        order.push(t);
        remaining.delete(t);
      }
      continue;
    }
    // Cycle: defer one nullable edge inside the remaining set.
    const victim =
      active.find(
        (e) => remaining.has(e.table_name) && remaining.has(e.ref_table) && e.is_nullable === "YES"
      ) ?? null;
    if (!victim) {
      // Unbreakable cycle (NOT NULL both ways): emit alphabetically; restore may fail loudly.
      const t = [...remaining].sort()[0];
      order.push(t);
      remaining.delete(t);
      continue;
    }
    included.get(victim.table_name)!.deferred.push(victim.column_name);
    active = active.filter((e) => e !== victim);
  }
  return { tables: order.map((t) => included.get(t)!) };
}

/** Company-scoped tables (with company_id) for the coverage test. */
export async function companyScopedTables(client: Queryable = pool): Promise<string[]> {
  const { rows } = await pq<{ table_name: string }>(
    `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND t.table_type = 'BASE TABLE'
      ORDER BY 1`,
    [],
    client
  );
  return rows.map((r) => r.table_name);
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export interface CompanySnapshot {
  version: string;
  createdAt: string;
  companyId: string;
  tables: Record<string, unknown[]>;
}

export async function captureSnapshot(
  companyId: string,
  client: Queryable = pool,
  manifest?: BackupManifest
): Promise<CompanySnapshot> {
  const m = manifest ?? (await buildBackupManifest(client));
  const tables: Record<string, unknown[]> = {};
  for (const t of m.tables) {
    const { rows } = await pq<{ data: unknown[] }>(
      `SELECT COALESCE(json_agg(to_jsonb(t)), '[]'::json) AS data FROM ${q(t.name)} t WHERE ${t.predicate}`,
      [companyId],
      client
    );
    tables[t.name] = rows[0]?.data ?? [];
  }
  return { version: BACKUP_FORMAT_VERSION, createdAt: new Date().toISOString(), companyId, tables };
}

export function sealSnapshot(snapshot: CompanySnapshot): {
  sealed: string;
  checksum: string;
  sizeBytes: number;
  counts: Record<string, number>;
} {
  const json = JSON.stringify(snapshot);
  const checksum = crypto.createHash("sha256").update(json).digest("hex");
  const gz = zlib.gzipSync(Buffer.from(json, "utf8")).toString("base64");
  const sealed = encryptSecret(`gz1:${gz}`)!;
  const counts = Object.fromEntries(Object.entries(snapshot.tables).map(([k, v]) => [k, v.length]));
  return { sealed, checksum, sizeBytes: Buffer.byteLength(sealed, "utf8"), counts };
}

/** Decrypt + verify. Legacy v1 backups (plaintext JSON) are read as-is. */
export function openSnapshot(
  stored: string,
  checksum: string | null
): { json: string; snapshot: CompanySnapshot | LegacySnapshot } {
  let json: string;
  if (stored.startsWith("enc:v1:")) {
    const plain = decryptSecret(stored) ?? "";
    json = plain.startsWith("gz1:")
      ? zlib.gunzipSync(Buffer.from(plain.slice(4), "base64")).toString("utf8")
      : plain;
  } else {
    json = stored;
  }
  if (checksum) {
    const actual = crypto.createHash("sha256").update(json).digest("hex");
    if (actual !== checksum) {
      throw new DomainError(
        "BACKUP_INTEGRITY_FAILED",
        409,
        undefined,
        "Backup integrity check failed (checksum mismatch). Nothing was restored."
      );
    }
  }
  return { json, snapshot: JSON.parse(json) };
}

interface LegacySnapshot {
  version: string;
  companyId: string;
  data: Record<string, unknown[]>;
}

/** v1 snapshots used camelCase drizzle keys for 7 tables; v2 uses table names and raw rows. */
function asV2(s: CompanySnapshot | LegacySnapshot): CompanySnapshot {
  if ((s as CompanySnapshot).tables) return s as CompanySnapshot;
  throw new DomainError(
    "LEGACY_BACKUP_FORMAT",
    422,
    undefined,
    "This backup was made by the old 7-table backup and cannot be restored safely. Download it for reference and create a new full backup."
  );
}

// ─── Create ──────────────────────────────────────────────────────────────────

export interface BackupRecord {
  id: string;
  company_id: string;
  name: string;
  status: string;
}

export async function createCompanyBackup(args: {
  companyId: string;
  userId: string | null;
  name?: string | null;
  description?: string | null;
  backupType: "manual" | "scheduled" | "pre_restore";
  retentionDays?: number;
}): Promise<BackupRecord & Record<string, unknown>> {
  const { rows } = await pq<BackupRecord>(
    `INSERT INTO backups (company_id, name, description, backup_type, status, created_by, format_version, encrypted)
          VALUES ($1, $2, $3, $4, 'in_progress', $5, $6, true) RETURNING id, company_id, name, status`,
    [
      args.companyId,
      args.name || `Backup ${new Date().toISOString().slice(0, 10)}`,
      args.description ?? (args.backupType === "manual" ? "Manual backup" : null),
      args.backupType,
      args.userId,
      BACKUP_FORMAT_VERSION,
    ]
  );
  const backup = rows[0];
  try {
    const client = await pool.connect();
    let snapshot: CompanySnapshot;
    try {
      // One consistent read of every table.
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      snapshot = await captureSnapshot(args.companyId, client);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    const sealed = sealSnapshot(snapshot);
    const c = sealed.counts;
    const { rows: done } = await pq(
      `UPDATE backups SET status = 'completed', data_snapshot = $2, checksum = $3, size_bytes = $4,
              table_counts = $5, accounts_count = $6, journal_entries_count = $7, invoices_count = $8,
              receipts_count = $9, vat_returns_count = $10, completed_at = now(),
              expires_at = now() + ($11::text || ' days')::interval
        WHERE id = $1
        RETURNING id, company_id, name, description, backup_type, status, accounts_count,
                  journal_entries_count, invoices_count, receipts_count, vat_returns_count,
                  checksum, size_bytes, table_counts, encrypted, format_version, created_by,
                  created_at, completed_at, expires_at`,
      [
        backup.id,
        sealed.sealed,
        sealed.checksum,
        sealed.sizeBytes,
        JSON.stringify(c),
        c.accounts ?? 0,
        c.journal_entries ?? 0,
        c.invoices ?? 0,
        c.receipts ?? 0,
        c.vat_returns ?? 0,
        String(args.retentionDays ?? 90),
      ]
    );
    return done[0] as BackupRecord & Record<string, unknown>;
  } catch (err) {
    await pq(`UPDATE backups SET status = 'failed' WHERE id = $1`, [backup.id]).catch(
      () => undefined
    );
    throw err;
  }
}

// ─── Restore ─────────────────────────────────────────────────────────────────

export type RestoreMode = "merge" | "replace";

export interface TableDiff {
  table: string;
  snapshotRows: number;
  currentRows: number;
  insert: number;
  update: number;
  delete: number;
}

export interface RestoreResult {
  mode: RestoreMode;
  dryRun: boolean;
  tables: TableDiff[];
  totals: { insert: number; update: number; delete: number };
  preRestoreBackupId: string | null;
}

function pkMatch(t: ManifestTable, a: string, b: string): string {
  return t.pk.map((c) => `${a}.${q(c)} IS NOT DISTINCT FROM ${b}.${q(c)}`).join(" AND ");
}

async function diffTable(
  client: Queryable,
  t: ManifestTable,
  companyId: string,
  rowsJson: string
): Promise<TableDiff> {
  const snap = `json_populate_recordset(NULL::${q(t.name)}, $2::json)`;
  if (!t.pk.length) {
    const { rows } = await pq<{ s: string; c: string }>(
      `SELECT (SELECT count(*) FROM ${snap}) AS s,
              (SELECT count(*) FROM ${q(t.name)} t WHERE ${t.predicate}) AS c`,
      [companyId, rowsJson],
      client
    );
    const s = Number(rows[0].s);
    const c = Number(rows[0].c);
    return { table: t.name, snapshotRows: s, currentRows: c, insert: s, update: 0, delete: c };
  }
  const { rows } = await pq<Record<string, string>>(
    `WITH s AS (SELECT * FROM ${snap}),
          cur AS (SELECT * FROM ${q(t.name)} t WHERE ${t.predicate})
     SELECT (SELECT count(*) FROM s) AS snapshot_rows,
            (SELECT count(*) FROM cur) AS current_rows,
            (SELECT count(*) FROM s WHERE NOT EXISTS (SELECT 1 FROM ${q(t.name)} x WHERE ${pkMatch(t, "x", "s")})) AS ins,
            (SELECT count(*) FROM s JOIN cur ON ${pkMatch(t, "cur", "s")} WHERE to_jsonb(cur) IS DISTINCT FROM to_jsonb(s)) AS upd,
            (SELECT count(*) FROM cur WHERE NOT EXISTS (SELECT 1 FROM s WHERE ${pkMatch(t, "cur", "s")})) AS del`,
    [companyId, rowsJson],
    client
  );
  const r = rows[0];
  return {
    table: t.name,
    snapshotRows: Number(r.snapshot_rows),
    currentRows: Number(r.current_rows),
    insert: Number(r.ins),
    update: Number(r.upd),
    delete: Number(r.del),
  };
}

async function applyTable(
  client: Queryable,
  t: ManifestTable,
  companyId: string,
  rowsJson: string,
  mode: RestoreMode,
  phase: "delete" | "upsert" | "deferred"
): Promise<void> {
  // Statements bind only the parameters they use: $1 = company (predicate), $2 = rows.
  const snap = `json_populate_recordset(NULL::${q(t.name)}, $2::json)`;
  const snap1 = `json_populate_recordset(NULL::${q(t.name)}, $1::json)`;
  const replace = mode === "replace" && !t.appendOnly;
  if (phase === "delete") {
    if (!replace) return;
    if (t.deferred.length) {
      await client.query(
        `UPDATE ${q(t.name)} t SET ${t.deferred.map((c) => `${q(c)} = NULL`).join(", ")} WHERE ${t.predicate}`,
        [companyId]
      );
    }
    const keep = t.pk.length
      ? `AND NOT EXISTS (SELECT 1 FROM ${snap} s WHERE ${pkMatch(t, "t", "s")})`
      : "";
    await client.query(
      `DELETE FROM ${q(t.name)} t WHERE ${t.predicate} ${keep}`,
      t.pk.length ? [companyId, rowsJson] : [companyId]
    );
    return;
  }
  if (phase === "deferred") {
    if (!t.deferred.length || !t.pk.length) return;
    await client.query(
      `UPDATE ${q(t.name)} t SET ${t.deferred.map((c) => `${q(c)} = s.${q(c)}`).join(", ")}
         FROM ${snap1} s WHERE ${pkMatch(t, "t", "s")}`,
      [rowsJson]
    );
    return;
  }
  // upsert / insert-missing
  const cols = t.columns;
  const insertList = cols.map(q).join(", ");
  const selectList = cols.map((c) => (t.deferred.includes(c) ? "NULL" : `s.${q(c)}`)).join(", ");
  if (!t.pk.length) {
    // No primary key: in replace mode the scoped rows were deleted above; merge adds absent rows.
    const notExists = replace
      ? ""
      : `WHERE NOT EXISTS (SELECT 1 FROM ${q(t.name)} x WHERE to_jsonb(x) = to_jsonb(s))`;
    await client.query(
      `INSERT INTO ${q(t.name)} (${insertList}) SELECT ${selectList} FROM ${snap1} s ${notExists}`,
      [rowsJson]
    );
    return;
  }
  const nonPk = cols.filter((c) => !t.pk.includes(c) && !t.deferred.includes(c));
  const conflict =
    replace && nonPk.length
      ? `ON CONFLICT (${t.pk.map(q).join(", ")}) DO UPDATE SET ${nonPk
          .map((c) => `${q(c)} = EXCLUDED.${q(c)}`)
          .join(", ")}`
      : `ON CONFLICT DO NOTHING`;
  await client.query(
    `INSERT INTO ${q(t.name)} (${insertList}) SELECT ${selectList} FROM ${snap1} s ${conflict}`,
    [rowsJson]
  );
}

/**
 * Restore (or dry-run) a backup. Throws on checksum mismatch before touching
 * anything. The caller writes the audit entry after this resolves.
 */
export async function restoreCompanyBackup(args: {
  backupId: string;
  companyId: string;
  userId: string;
  mode: RestoreMode;
  dryRun: boolean;
}): Promise<RestoreResult> {
  const { rows } = await pq<{
    id: string;
    company_id: string;
    status: string;
    data_snapshot: string | null;
    checksum: string | null;
    name: string;
  }>(`SELECT id, company_id, status, data_snapshot, checksum, name FROM backups WHERE id = $1`, [
    args.backupId,
  ]);
  const backup = rows[0];
  if (!backup || backup.company_id !== args.companyId) {
    throw new DomainError("NOT_FOUND", 404, undefined, "Backup not found");
  }
  if (backup.status !== "completed" || !backup.data_snapshot) {
    throw new DomainError("BACKUP_NOT_COMPLETE", 409, undefined, "Backup is not complete");
  }
  const { snapshot: raw } = openSnapshot(backup.data_snapshot, backup.checksum);
  const snapshot = asV2(raw);
  if (snapshot.companyId !== args.companyId) {
    throw new DomainError("BACKUP_COMPANY_MISMATCH", 409);
  }

  let preRestoreBackupId: string | null = null;
  if (!args.dryRun && args.mode === "replace") {
    const pre = await createCompanyBackup({
      companyId: args.companyId,
      userId: args.userId,
      name: `Pre-restore backup (before restoring ${backup.name})`,
      description: "Automatic backup created before a replace-mode restore",
      backupType: "pre_restore",
    });
    preRestoreBackupId = pre.id;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `backup-restore:${args.companyId}`,
    ]);
    const manifest = await buildBackupManifest(client);
    const json = new Map<string, string>();
    for (const t of manifest.tables)
      json.set(t.name, JSON.stringify(snapshot.tables[t.name] ?? []));

    const diffs: TableDiff[] = [];
    for (const t of manifest.tables) {
      const d = await diffTable(client, t, args.companyId, json.get(t.name)!);
      const replace = args.mode === "replace" && !t.appendOnly;
      diffs.push(replace ? d : { ...d, update: 0, delete: 0 });
    }
    if (!args.dryRun) {
      for (const t of [...manifest.tables].reverse()) {
        await applyTable(client, t, args.companyId, json.get(t.name)!, args.mode, "delete");
      }
      for (const t of manifest.tables) {
        await applyTable(client, t, args.companyId, json.get(t.name)!, args.mode, "upsert");
      }
      for (const t of manifest.tables) {
        await applyTable(client, t, args.companyId, json.get(t.name)!, args.mode, "deferred");
      }
    }
    await client.query(args.dryRun ? "ROLLBACK" : "COMMIT");
    const changed = diffs.filter((d) => d.insert || d.update || d.delete);
    return {
      mode: args.mode,
      dryRun: args.dryRun,
      tables: changed,
      totals: {
        insert: changed.reduce((s, d) => s + d.insert, 0),
        update: changed.reduce((s, d) => s + d.update, 0),
        delete: changed.reduce((s, d) => s + d.delete, 0),
      },
      preRestoreBackupId,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    log.warn({ err: (err as Error).message, backupId: args.backupId }, "Restore rolled back");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Schedules ───────────────────────────────────────────────────────────────

const FREQUENCY_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 };

/** Run every due schedule once and expire old backups. Used by the job registry. */
export async function runScheduledBackups(now = new Date()): Promise<number> {
  const { rows } = await pq<{
    company_id: string;
    frequency: string;
    retention_days: number;
    last_run_at: Date | null;
    created_by: string | null;
  }>(`SELECT company_id, frequency, retention_days, last_run_at, created_by
        FROM backup_schedules WHERE is_active = true`);
  let made = 0;
  for (const s of rows) {
    const days = FREQUENCY_DAYS[s.frequency] ?? 7;
    const due =
      !s.last_run_at ||
      now.getTime() - new Date(s.last_run_at).getTime() >= days * 86_400_000 - 3600_000;
    if (!due) continue;
    try {
      await createCompanyBackup({
        companyId: s.company_id,
        userId: s.created_by,
        name: `Scheduled ${s.frequency} backup ${now.toISOString().slice(0, 10)}`,
        backupType: "scheduled",
        retentionDays: s.retention_days,
      });
      await pq(`UPDATE backup_schedules SET last_run_at = $2 WHERE company_id = $1`, [
        s.company_id,
        now,
      ]);
      made++;
    } catch (err) {
      log.error({ err, companyId: s.company_id }, "Scheduled backup failed");
    }
  }
  await pq(
    `DELETE FROM backups WHERE backup_type = 'scheduled' AND expires_at IS NOT NULL AND expires_at < now()`
  );
  return made;
}
