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
 * topped up, never rewritten. Restore receipts and audit events commit with the data.
 *
 * Point-in-time recovery is a database-host setting (WAL archiving / PITR on
 * the managed Postgres) and an off-site copy of these snapshots is an
 * external bucket — both are EXTERNAL actions documented in docs/api/backups.md.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";
import { pool } from "../db";
import { pq, type Queryable } from "./connectors/pq";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secret-vault";
import { DomainError, errorCode } from "../errors";
import { createLogger } from "../config/logger";
import { createDefaultAccountsForCompany } from "../defaultChartOfAccounts";
import { recordAudit } from "./audit.service";
import type { Request } from "express";

const log = createLogger("backup-service");

export const BACKUP_FORMAT_VERSION = "2.0";
const BANK_GL_MIGRATION_FINDINGS = "bank_gl_migration_findings";

/** Company-scoped tables deliberately NOT in a backup, and why. */
export const BACKUP_EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  backups: "the backups themselves",
  backup_schedules: "backup configuration",
  activity_logs: "audit trail: must survive every restore",
  company_users: "access control: a restore must not lock out or revive members",
  company_security_policies: "access control: company MFA requirements remain in effect",
  firm_client_links: "access control: firm links follow the current client relationship",
  firm_company_grants: "access control: firm grants follow current staff access",
  invitations: "access control",
  company_invitations: "access control",
  api_keys: "credentials: a restore must never revive a revoked key",
  bank_feed_oauth_states: "short-lived OAuth state",
  [BANK_GL_MIGRATION_FINDINGS]:
    "operator-only migration diagnostics can contain references to other companies and must survive tenant restores",
  customer_portal_accounts: "access control: portal bindings follow current grants",
  customer_portal_invitations: "access control: portal invitations follow current grants",
  company_groups: "group-wide data",
  company_group_members: "group-wide data",
  intercompany_account_maps: "group-wide data",
  elimination_journals: "group-wide data",
  elimination_lines: "group-wide data",
  consolidation_runs: "group-wide data",
  ledger_repair_findings: "operator-only migration diagnostics",
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
  domain_event_outbox: "event dispatch queue",
  domain_event_deliveries: "event handler delivery receipts",
  ai_gl_queue: "processing queue",
  payment_links: "public tokens and payment lifecycle state must survive every restore",
  payment_gateway_events: "provider event processing receipts",
  einvoice_documents: "external transmission state",
  einvoice_approver_links: "access control: revocable approval links",
  einvoice_document_events: "external transmission history",
  einvoice_provider_events: "provider event processing queue and receipts",
  einvoice_legal_entities: "external provider provisioning state",
  payroll_expiry_alerts: "alert emission receipts",
  email_outbox: "delivery queue (re-sending on restore would spam customers)",
  email_outbox_attachments: "delivery queue",
  email_delivery_events: "delivery log",
  reminder_logs: "customer reminder delivery history",
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
  notNull: string[];
  required: string[]; // NOT NULL without a database default
  protectedFromDelete?: string;
  /** FK columns inserted NULL first and set afterwards (breaks FK cycles). */
  deferred: string[];
  appendOnly: boolean;
}

export interface BackupManifest {
  tables: ManifestTable[]; // FK-safe insert order
  fks: FkRow[];
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

const EXCLUDED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  customer_contacts: ["portal_access_token", "portal_access_expires_at"],
  compliance_calendar: ["reminders_sent"],
};

const EINVOICE_HISTORY_TABLES = ["einvoice_documents", "einvoice_document_events"];

const PAYSLIP_ITEM_PARENT_COLUMNS: Readonly<Record<string, string>> = {
  payroll_runs: "payroll_run_id",
  employees: "employee_id",
};

interface FkRow {
  table_name: string;
  column_name: string;
  ref_table: string;
  ref_column: string;
  is_nullable: string;
  columns: string[];
  ref_columns: string[];
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
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT table_name, column_name, is_generated, identity_generation, is_nullable, column_default
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
              CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
              ARRAY(SELECT attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num, ord)
                    JOIN pg_attribute ON attrelid = c.conrelid AND attnum = k.num ORDER BY k.ord) AS columns,
              ARRAY(SELECT attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num, ord)
                    JOIN pg_attribute ON attrelid = c.confrelid AND attnum = k.num ORDER BY k.ord) AS ref_columns
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
         JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
        WHERE c.contype = 'f'
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
  const notNullOf = new Map<string, string[]>();
  const requiredOf = new Map<string, string[]>();
  const hasCompanyId = new Set<string>();
  for (const c of cols) {
    if (c.column_name === "company_id") hasCompanyId.add(c.table_name);
    if (c.is_generated === "ALWAYS" || c.identity_generation === "ALWAYS") continue;
    if (EXCLUDED_COLUMNS[c.table_name]?.includes(c.column_name)) continue;
    if (c.is_nullable === "NO") {
      notNullOf.set(c.table_name, [...(notNullOf.get(c.table_name) ?? []), c.column_name]);
      if (c.column_default === null && c.identity_generation === null) {
        requiredOf.set(c.table_name, [...(requiredOf.get(c.table_name) ?? []), c.column_name]);
      }
    }
    const list = colsOf.get(c.table_name) ?? [];
    list.push(c.column_name);
    colsOf.set(c.table_name, list);
  }
  const pkOf = new Map<string, string[]>();
  for (const p of pks) pkOf.set(p.table_name, [...(pkOf.get(p.table_name) ?? []), p.column_name]);

  const included = new Map<string, ManifestTable>();
  const columnInfo = (name: string) => ({
    pk: pkOf.get(name) ?? [],
    columns: colsOf.get(name) ?? [],
    notNull: notNullOf.get(name) ?? [],
    required: requiredOf.get(name) ?? [],
    deferred: [] as string[],
    appendOnly: APPEND_ONLY_TABLES.has(name),
  });
  for (const t of tables) {
    if (!hasCompanyId.has(t) || exclusionReason(t)) continue;
    included.set(t, {
      name: t,
      scope: "company",
      // Generated obligations are recomputed by the scheduler and track reminders.
      predicate:
        t === "compliance_calendar"
          ? "t.company_id = $1 AND t.source <> 'generated'"
          : "t.company_id = $1",
      ...columnInfo(t),
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
          return `(${f.columns.map((c) => `t.${q(c)}`).join(", ")}) IN
            (SELECT ${f.ref_columns.map((c) => `p.${q(c)}`).join(", ")} FROM ${q(f.ref_table)} p WHERE ${inner})`;
        })
        .join(" OR ");
      included.set(t, {
        name: t,
        scope: "child",
        predicate: `(${predicate})`,
        ...columnInfo(t),
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
        (e) =>
          remaining.has(e.table_name) &&
          remaining.has(e.ref_table) &&
          e.is_nullable === "YES" &&
          !included.get(e.table_name)!.pk.includes(e.column_name)
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
  return { tables: order.map((t) => included.get(t)!), fks };
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
  schema?: Record<string, { columns: string[]; primaryKey: string[] }>;
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
      `SELECT COALESCE(json_agg(to_jsonb(t) - $2::text[]), '[]'::json) AS data FROM ${q(t.name)} t WHERE ${t.predicate}`,
      [companyId, EXCLUDED_COLUMNS[t.name] ?? []],
      client
    );
    tables[t.name] = rows[0]?.data ?? [];
  }
  return {
    version: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    companyId,
    tables,
    schema: Object.fromEntries(
      m.tables.map((t) => [t.name, { columns: t.columns, primaryKey: t.pk }])
    ),
  };
}

const retiredBankCredentialColumns = [
  "access_token",
  "refresh_token",
  "token_expires_at",
  "consent_id",
] as const;

function withoutRetiredBankCredentials(snapshot: CompanySnapshot): CompanySnapshot {
  const connections = snapshot.tables.bank_connections;
  if (!connections) return snapshot;
  let changed = false;
  const rows = connections.map((row) => {
    if (!row || typeof row !== "object") return row;
    const connection = row as Record<string, unknown>;
    if (
      !connection.auto_sync &&
      retiredBankCredentialColumns.every((key) => connection[key] == null)
    )
      return row;
    changed = true;
    const sanitized: Record<string, unknown> = { ...connection, auto_sync: false };
    for (const column of retiredBankCredentialColumns) sanitized[column] = null;
    return sanitized;
  });
  return changed
    ? { ...snapshot, tables: { ...snapshot.tables, bank_connections: rows } }
    : snapshot;
}

function snapshotChecksum(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function sealSnapshotJson(json: string): string {
  const gz = zlib.gzipSync(Buffer.from(json, "utf8")).toString("base64");
  return encryptSecret(`gz1:${gz}`)!;
}

export function sealSnapshot(snapshot: CompanySnapshot): {
  sealed: string;
  checksum: string;
  sizeBytes: number;
  counts: Record<string, number>;
} {
  const json = JSON.stringify(withoutRetiredBankCredentials(snapshot));
  const checksum = snapshotChecksum(json);
  const sealed = sealSnapshotJson(json);
  const counts = Object.fromEntries(Object.entries(snapshot.tables).map(([k, v]) => [k, v.length]));
  return { sealed, checksum, sizeBytes: Buffer.byteLength(sealed, "utf8"), counts };
}

/** Decrypt + verify. Legacy v1 backups (plaintext JSON) are read as-is. */
export function openSnapshot(
  stored: string,
  checksum: string | null
): { json: string; snapshot: CompanySnapshot | LegacySnapshot; redacted?: CompanySnapshot } {
  let json: string;
  if (isEncryptedSecret(stored)) {
    const plain = decryptSecret(stored) ?? "";
    json = plain.startsWith("gz1:")
      ? zlib.gunzipSync(Buffer.from(plain.slice(4), "base64")).toString("utf8")
      : plain;
  } else {
    json = stored;
  }
  if (checksum) {
    if (snapshotChecksum(json) !== checksum) {
      throw new DomainError(
        "BACKUP_INTEGRITY_FAILED",
        409,
        undefined,
        "Backup integrity check failed (checksum mismatch). Nothing was restored."
      );
    }
  }
  const snapshot = JSON.parse(json) as CompanySnapshot | LegacySnapshot;
  if ("tables" in snapshot) {
    const redacted = withoutRetiredBankCredentials(snapshot);
    if (redacted !== snapshot)
      return { json: JSON.stringify(redacted), snapshot: redacted, redacted };
  }
  return { json, snapshot };
}

/** Produce both download formats from the same sanitized, verified snapshot. */
export function exportBackupSnapshot(
  stored: string,
  checksum: string | null,
  encrypted: boolean
): { body: string; exportChecksum: string; contentDigest?: string } {
  const { json, snapshot, redacted } = openSnapshot(stored, checksum);
  const tables = "tables" in snapshot ? snapshot.tables : snapshot.data;
  let filtered = false;
  for (const table of Object.keys(tables ?? {})) {
    if (exclusionReason(table)) {
      delete tables[table];
      if ("schema" in snapshot && snapshot.schema) delete snapshot.schema[table];
      filtered = true;
      continue;
    }
    for (const row of tables[table]) {
      for (const column of EXCLUDED_COLUMNS[table] ?? []) {
        if (row && typeof row === "object" && Object.hasOwn(row, column)) {
          delete (row as Record<string, unknown>)[column];
          filtered = true;
        }
      }
    }
  }
  const plaintext = filtered ? JSON.stringify(snapshot) : json;
  const sanitized = filtered || !!redacted;
  const body = encrypted
    ? !sanitized && isEncryptedSecret(stored)
      ? stored
      : sealSnapshotJson(plaintext)
    : plaintext;
  const exportChecksum = snapshotChecksum(body);
  const contentDigest =
    !encrypted && sanitized
      ? `sha-256=:${Buffer.from(exportChecksum, "hex").toString("base64")}:`
      : undefined;
  return { body, exportChecksum, ...(contentDigest ? { contentDigest } : {}) };
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

interface CreateCompanyBackupArgs {
  companyId: string;
  userId: string | null;
  name?: string | null;
  description?: string | null;
  backupType: "manual" | "scheduled" | "pre_restore";
  retentionDays?: number;
}

async function captureConsistentSnapshot(companyId: string): Promise<CompanySnapshot> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = await captureSnapshot(companyId, client);
    await client.query("COMMIT");
    return snapshot;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function createCompanyBackup(
  args: CreateCompanyBackupArgs,
  transaction?: { client: Queryable; manifest: BackupManifest }
): Promise<BackupRecord & Record<string, unknown>> {
  const executor = transaction?.client ?? pool;
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
    ],
    executor
  );
  const backup = rows[0];
  try {
    const snapshot = transaction
      ? await captureSnapshot(args.companyId, transaction.client, transaction.manifest)
      : await captureConsistentSnapshot(args.companyId);
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
      ],
      executor
    );
    return done[0] as BackupRecord & Record<string, unknown>;
  } catch (err) {
    if (!transaction) {
      await pq(`UPDATE backups SET status = 'failed' WHERE id = $1`, [backup.id]).catch(
        () => undefined
      );
    }
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

function preservesPortalValue(table: ManifestTable, column: string): boolean {
  return table.name === "customer_contacts" && ["email", "is_active"].includes(column);
}

async function diffTable(
  client: Queryable,
  t: ManifestTable,
  companyId: string,
  rowsJson: string
): Promise<TableDiff> {
  const snap = `json_populate_recordset(NULL::${q(t.name)}, $2::json)`;
  const changed = t.columns
    .map((c) => {
      const differs = `to_jsonb(cur.${q(c)}) IS DISTINCT FROM to_jsonb(s.${q(c)})`;
      return preservesPortalValue(t, c) ? `(cur.backup_can_delete AND ${differs})` : differs;
    })
    .join(" OR ");
  const canDelete = t.protectedFromDelete ? `NOT (${t.protectedFromDelete})` : "true";
  if (!t.pk.length) {
    const { rows } = await pq<{ s: string; c: string }>(
      `SELECT (SELECT count(*) FROM ${snap}) AS s,
              (SELECT count(*) FROM ${q(t.name)} t WHERE ${deletionScope(t)}) AS c`,
      [companyId, rowsJson],
      client
    );
    const s = Number(rows[0].s);
    const c = Number(rows[0].c);
    return { table: t.name, snapshotRows: s, currentRows: c, insert: s, update: 0, delete: c };
  }
  const { rows } = await pq<Record<string, string>>(
    `WITH s AS (SELECT * FROM ${snap}),
          cur AS (SELECT t.*, ${canDelete} AS backup_can_delete FROM ${q(t.name)} t WHERE ${t.predicate})
     SELECT (SELECT count(*) FROM s) AS snapshot_rows,
            (SELECT count(*) FROM cur) AS current_rows,
            (SELECT count(*) FROM s WHERE NOT EXISTS (SELECT 1 FROM ${q(t.name)} x WHERE ${pkMatch(t, "x", "s")})) AS ins,
            (SELECT count(*) FROM s JOIN cur ON ${pkMatch(t, "cur", "s")} WHERE ${changed || "false"}) AS upd,
            (SELECT count(*) FROM cur WHERE backup_can_delete AND NOT EXISTS (SELECT 1 FROM s WHERE ${pkMatch(t, "cur", "s")})) AS del`,
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

interface RestoreTable {
  table: ManifestTable;
  json: string;
  rowCount: number;
}

function incompatible(table: string, reason: string): never {
  throw new DomainError(
    "BACKUP_SCHEMA_INCOMPATIBLE",
    422,
    { table, reason },
    `The backup cannot be safely restored into the current schema (${table}: ${reason}).`
  );
}

function planRestore(
  snapshot: CompanySnapshot,
  manifest: BackupManifest,
  included: ManifestTable[]
): RestoreTable[] {
  const represented = included.filter((t) => Object.hasOwn(snapshot.tables, t.name));
  const plan = represented.map((t) => {
    const archived = snapshot.tables[t.name] as Record<string, unknown>[];
    if (
      !Array.isArray(archived) ||
      archived.some((row) => !row || typeof row !== "object" || Array.isArray(row))
    ) {
      incompatible(t.name, "invalid snapshot rows");
    }
    const rows =
      t.name === "compliance_calendar"
        ? archived.filter((row) => row.source !== "generated")
        : archived;
    const schema = snapshot.schema?.[t.name];
    if (
      snapshot.schema &&
      (!schema || JSON.stringify(schema.primaryKey) !== JSON.stringify(t.pk))
    ) {
      incompatible(t.name, "primary key changed or table schema is missing");
    }

    // Legacy v2 records have all their original columns on each row. An empty
    // array is still an explicit instruction to replace the represented table.
    const captured = new Set(schema?.columns ?? rows.flatMap((row) => Object.keys(row)));
    const columns = t.columns.filter((c) => captured.has(c));
    if (rows.length) {
      for (const c of [...t.pk, ...t.required]) {
        if (!columns.includes(c)) incompatible(t.name, `missing required column ${c}`);
      }
      for (const c of columns) {
        if (
          rows.some((row) => !Object.hasOwn(row, c) || (row[c] === null && t.notNull.includes(c)))
        ) {
          incompatible(t.name, `missing or invalid value for ${c}`);
        }
      }
    }

    return {
      table: { ...t, columns, deferred: t.deferred.filter((c) => columns.includes(c)) },
      json: JSON.stringify(rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c]])))),
      rowCount: rows.length,
    };
  });
  const replaced = new Map(
    plan.filter(({ table }) => !table.appendOnly).map(({ table }) => [table.name, table])
  );
  for (const { table } of plan) {
    // Live grants, group references and tables or FK columns added since the
    // backup can still depend on a row the snapshot would otherwise delete.
    const protections = manifest.fks
      .filter((f) => {
        if (f.ref_table !== table.name) return false;
        const child = replaced.get(f.table_name);
        return (
          !child || (child.columns.length > 0 && f.columns.some((c) => !child.columns.includes(c)))
        );
      })
      .map(
        (f) =>
          `EXISTS (SELECT 1 FROM ${q(f.table_name)} d WHERE ${f.columns
            .map((c, i) => `d.${q(c)} = t.${q(f.ref_columns[i])}`)
            .join(" AND ")})`
      );
    const payslipParentColumn = PAYSLIP_ITEM_PARENT_COLUMNS[table.name];
    if (payslipParentColumn) {
      // A payslip-protected item still needs its run and employee. Deleting
      // the run cascades through the item, while the employee FK restricts deletion.
      protections.push(`EXISTS (
        SELECT 1 FROM payroll_items i JOIN payslip_tokens p ON p.payroll_item_id = i.id
        WHERE i.${q(payslipParentColumn)} = t.id
      )`);
    }
    table.protectedFromDelete = protections.join(" OR ");
  }
  return plan;
}

function deletionScope(t: ManifestTable): string {
  return t.protectedFromDelete
    ? `(${t.predicate}) AND NOT (${t.protectedFromDelete})`
    : t.predicate;
}

async function validateSnapshotRows(client: Queryable, plan: RestoreTable[]): Promise<void> {
  for (const { table, json } of plan) {
    if (json === "[]") continue;
    try {
      await client.query(
        `SELECT count(*) FROM json_populate_recordset(NULL::${q(table.name)}, $1::json)`,
        [json]
      );
    } catch (error) {
      if (errorCode(error)?.startsWith("22")) incompatible(table.name, "invalid column value");
      throw error;
    }
  }
}

async function validateReplaceExternalState(
  client: Queryable,
  companyId: string,
  plan: RestoreTable[]
): Promise<void> {
  if (plan.some(({ table }) => !table.appendOnly)) {
    // A paid link and its webhook receipt survive replace. The snapshot can
    // rewind its payment, ledger, credits and invoice independently. Processing
    // links can also be between posting the payment and saving its identifiers.
    const { rows: payments } = await client.query(
      `SELECT 1 FROM payment_links WHERE company_id = $1
          AND (status IN ('paid', 'processing') OR invoice_payment_id IS NOT NULL
               OR fee_journal_entry_id IS NOT NULL)
        LIMIT 1`,
      [companyId]
    );
    if (payments.length) {
      throw new DomainError(
        "BACKUP_RESTORE_CONFLICT",
        409,
        { table: "payment_links" },
        "Replace restore is unavailable while this company has settled or processing payment links."
      );
    }
  }

  const invoices = plan.find(({ table }) => table.name === "invoices");
  if (!invoices) return;
  const history = EINVOICE_HISTORY_TABLES.map(
    (table) => `SELECT invoice_id FROM ${q(table)} WHERE company_id = $1`
  );
  const { rows: transmissions } = await client.query(
    `SELECT 1 FROM (${history.join(" UNION ALL ")}) h
       JOIN invoices i ON i.id = h.invoice_id AND i.company_id = $1
       WHERE NOT EXISTS (
         SELECT 1 FROM json_populate_recordset(NULL::invoices, $2::json) s WHERE s.id = i.id
       )
     LIMIT 1`,
    [companyId, invoices.json]
  );
  if (transmissions.length) {
    throw new DomainError(
      "BACKUP_RESTORE_CONFLICT",
      409,
      { table: "invoices" },
      "Replace restore would remove an invoice with e-invoice transmission history."
    );
  }
}

async function deleteTableRows(
  client: Queryable,
  { table: t, json }: RestoreTable,
  companyId: string,
  clear: boolean
): Promise<void> {
  const pred = deletionScope(t);
  if (t.deferred.length) {
    await client.query(
      `UPDATE ${q(t.name)} t SET ${t.deferred.map((c) => `${q(c)} = NULL`).join(", ")}
       WHERE ${pred}`,
      [companyId]
    );
  }
  const keep =
    !clear && t.pk.length
      ? `AND NOT EXISTS (
        SELECT 1 FROM json_populate_recordset(NULL::${q(t.name)}, $2::json) s
        WHERE ${pkMatch(t, "t", "s")})`
      : "";
  await client.query(
    `DELETE FROM ${q(t.name)} t WHERE ${pred} ${keep}`,
    keep ? [companyId, json] : [companyId]
  );
}

async function insertTableRows(
  client: Queryable,
  { table: t, json }: RestoreTable,
  replace: boolean,
  clone: boolean
): Promise<unknown[]> {
  if (json === "[]") return [];
  const snap = `json_populate_recordset(NULL::${q(t.name)}, $1::json)`;
  const selectList = t.columns
    .map((c) => (t.deferred.includes(c) ? "NULL" : `s.${q(c)}`))
    .join(", ");
  const update = t.columns.filter((c) => !t.pk.includes(c) && !t.deferred.includes(c));
  if (!update.length && t.deferred.length) update.push(...t.pk);
  const replacement = (column: string) => {
    const incoming = `EXCLUDED.${q(column)}`;
    const current = `t.${q(column)}`;
    if (clone && t.name === CLONE_COUNTERS && column === "last_value") {
      return `GREATEST(${current}, ${incoming})`;
    }
    // Changing these fields can enable or invalidate an existing portal grant.
    if (t.protectedFromDelete && preservesPortalValue(t, column)) {
      return `CASE WHEN ${t.protectedFromDelete} THEN ${current} ELSE ${incoming} END`;
    }
    return incoming;
  };
  const conflict =
    replace && t.pk.length && update.length
      ? `ON CONFLICT (${t.pk.map(q).join(", ")}) DO UPDATE SET
          ${update.map((c) => `${q(c)} = ${replacement(c)}`).join(", ")}`
      : "ON CONFLICT DO NOTHING";
  const sameValues = t.columns
    .map((c) => `to_jsonb(x.${q(c)}) IS NOT DISTINCT FROM to_jsonb(s.${q(c)})`)
    .join(" AND ");
  const missing =
    !replace && !t.pk.length
      ? `WHERE NOT EXISTS (SELECT 1 FROM ${q(t.name)} x WHERE ${sameValues})`
      : "";
  const returning = t.deferred.length && t.pk.length ? `RETURNING ${t.pk.map(q).join(", ")}` : "";
  const { rows } = await client.query(
    `INSERT INTO ${q(t.name)} AS t (${t.columns.map(q).join(", ")})
     SELECT ${selectList} FROM ${snap} s ${missing} ${conflict} ${returning}`,
    [json]
  );
  return rows;
}

async function applyRestore(
  client: Queryable,
  plan: RestoreTable[],
  companyId: string,
  mode: RestoreMode,
  clone = false
): Promise<void> {
  const replaces = (t: ManifestTable) => mode === "replace" && !t.appendOnly;
  for (const entry of [...plan].reverse()) {
    if (replaces(entry.table) && !(clone && entry.table.name === CLONE_COUNTERS))
      await deleteTableRows(client, entry, companyId, clone);
  }
  const deferred: { entry: RestoreTable; keys: unknown[] }[] = [];
  for (const entry of plan) {
    const keys = await insertTableRows(client, entry, replaces(entry.table), clone);
    if (keys.length) deferred.push({ entry, keys });
  }
  for (const {
    entry: { table: t, json },
    keys,
  } of deferred) {
    const records = `json_populate_recordset(NULL::${q(t.name)},`;
    await client.query(
      `UPDATE ${q(t.name)} t SET ${t.deferred.map((c) => `${q(c)} = s.${q(c)}`).join(", ")}
         FROM ${records} $1::json) s JOIN ${records} $2::json) k ON ${pkMatch(t, "s", "k")}
        WHERE ${pkMatch(t, "t", "k")}`,
      [json, JSON.stringify(keys)]
    );
  }
}

function externalCompanyTables(names: string[]) {
  return names.map((name) => ({ name, scope: "company" as const, predicate: "t.company_id = $1" }));
}

async function lockRestoreRows(
  client: Queryable,
  companyId: string,
  { tables, fks }: { tables: Pick<ManifestTable, "name" | "scope" | "predicate">[]; fks: FkRow[] }
) {
  // The company lock conflicts with FK checks on ordinary inserts into the
  // company. Tables without that FK need a table lock to cover the first write.
  const directFks = new Set(
    fks
      .filter(
        (f) =>
          f.ref_table === "companies" &&
          f.column_name === "company_id" &&
          f.ref_column === "id" &&
          f.columns.length === 1
      )
      .map((f) => f.table_name)
  );
  const unguarded = tables
    .filter((t) => t.scope === "company" && !directFks.has(t.name))
    .map((t) => t.name)
    .sort();
  if (unguarded.length) {
    await client.query(`LOCK TABLE ${unguarded.map(q).join(", ")} IN SHARE ROW EXCLUSIVE MODE`);
  }
  // Lock existing parent rows against concurrent changes and new children,
  // including rows referenced by tables outside the accounting snapshot.
  if (tables.length) {
    const lockingReads = tables.map(
      (t) => `SELECT 1 FROM (SELECT 1 FROM ${q(t.name)} t WHERE ${t.predicate} FOR UPDATE) row_lock`
    );
    await client.query(`SELECT count(*) FROM (${lockingReads.join(" UNION ALL ")}) locked`, [
      companyId,
    ]);
  }
}

interface RestoreAuditContext {
  requestKey?: string;
  req?: Request;
}

async function loadRestoreBackup(
  client: Queryable,
  backupId: string,
  companyId: string,
  lock: "" | "FOR UPDATE" | "FOR SHARE"
) {
  const { rows } = await pq<{
    company_id: string;
    status: string;
    data_snapshot: string | null;
    checksum: string | null;
    name: string;
  }>(
    `SELECT id, company_id, status, data_snapshot, checksum, name FROM backups WHERE id = $1 ${lock}`,
    [backupId],
    client
  );
  const backup = rows[0];
  if (!backup || backup.company_id !== companyId) {
    throw new DomainError("NOT_FOUND", 404, undefined, "Backup not found");
  }
  if (backup.status !== "completed" || !backup.data_snapshot) {
    throw new DomainError("BACKUP_NOT_COMPLETE", 409, undefined, "Backup is not complete");
  }
  return { ...backup, data_snapshot: backup.data_snapshot };
}

function snapshotForRestore(backup: {
  company_id: string;
  data_snapshot: string;
  checksum: string | null;
}) {
  const snapshot = asV2(openSnapshot(backup.data_snapshot, backup.checksum).snapshot);
  if (snapshot.companyId !== backup.company_id) {
    throw new DomainError("BACKUP_COMPANY_MISMATCH", 409);
  }
  return snapshot;
}

async function readRestoreReceipt<T>(
  client: Queryable,
  args: RestoreAuditContext & { backupId: string; userId: string },
  companyId: string,
  action: "backup.restore" | "backup.clone",
  mode?: RestoreMode
): Promise<T | undefined> {
  if (!args.requestKey) return;
  const { rows } = await pq<{ result: T }>(
    `SELECT details::jsonb -> 'result' AS result FROM audit_logs
      WHERE resource_id = $1 AND user_id = $2 AND company_id = $3 AND action = $4
        AND details::jsonb ->> 'requestKey' = $5`,
    [args.backupId, args.userId, companyId, action, args.requestKey],
    client
  );
  if (rows[0] && mode && (rows[0].result as RestoreResult).mode !== mode) {
    throw new DomainError("IDEMPOTENCY_KEY_REUSED", 409);
  }
  return rows[0]?.result;
}

async function restoreActivity(
  client: Queryable,
  args: { backupId: string; userId: string },
  companyId: string,
  action: "update" | "export",
  description: string,
  metadata: unknown
) {
  await client.query(
    `INSERT INTO activity_logs (company_id, user_id, action, entity_type, entity_id, description, metadata)
     VALUES ($1, $2, $3, 'backup', $4, $5, $6)`,
    [companyId, args.userId, action, args.backupId, description, JSON.stringify(metadata)]
  );
}

/**
 * Restore (or dry-run) a backup. Throws on checksum mismatch before touching
 * anything. The data, metadata and audit receipt commit together.
 */
export async function restoreCompanyBackup(
  args: {
    backupId: string;
    companyId: string;
    userId: string;
    mode: RestoreMode;
    dryRun: boolean;
  } & RestoreAuditContext
): Promise<RestoreResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `backup-restore:${args.companyId}`,
    ]);
    const backup = await loadRestoreBackup(
      client,
      args.backupId,
      args.companyId,
      args.dryRun ? "" : "FOR UPDATE"
    );
    if (!args.dryRun) {
      const receipt = await readRestoreReceipt<RestoreResult>(
        client,
        args,
        args.companyId,
        "backup.restore",
        args.mode
      );
      if (receipt) {
        await client.query("COMMIT");
        return receipt;
      }
    }
    const snapshot = snapshotForRestore(backup);
    const manifest = await buildBackupManifest(client);
    if (!args.dryRun && args.mode === "replace") {
      await client.query("SELECT id FROM companies WHERE id = $1 FOR UPDATE", [args.companyId]);
      await lockRestoreRows(client, args.companyId, {
        fks: manifest.fks,
        tables: [
          ...externalCompanyTables(["payment_links", ...EINVOICE_HISTORY_TABLES]),
          ...manifest.tables,
        ],
      });
    }
    const plan = planRestore(snapshot, manifest, manifest.tables);
    await validateSnapshotRows(client, plan);
    if (args.mode === "replace") {
      await validateReplaceExternalState(client, args.companyId, plan);
    }
    const diffs: TableDiff[] = [];
    for (const { table, json } of plan) {
      const d = await diffTable(client, table, args.companyId, json);
      const replace = args.mode === "replace" && !table.appendOnly;
      if (d.insert || (replace && (d.update || d.delete))) {
        diffs.push(replace ? d : { ...d, update: 0, delete: 0 });
      }
    }
    const result: RestoreResult = {
      mode: args.mode,
      dryRun: args.dryRun,
      tables: diffs,
      totals: {
        insert: diffs.reduce((s, d) => s + d.insert, 0),
        update: diffs.reduce((s, d) => s + d.update, 0),
        delete: diffs.reduce((s, d) => s + d.delete, 0),
      },
      preRestoreBackupId: null,
    };
    if (!args.dryRun) {
      if (args.mode === "replace") {
        const pre = await createCompanyBackup(
          {
            companyId: args.companyId,
            userId: args.userId,
            name: `Pre-restore backup (before restoring ${backup.name})`,
            description: "Automatic backup created before a replace-mode restore",
            backupType: "pre_restore",
          },
          { client, manifest }
        );
        result.preRestoreBackupId = pre.id;
      }
      await applyRestore(client, plan, args.companyId, args.mode);
      await client.query(
        "UPDATE backups SET last_restore_mode = $2, last_restored_at = now() WHERE id = $1",
        [args.backupId, args.mode]
      );
      const { insert, update, delete: deleted } = result.totals;
      await restoreActivity(
        client,
        args,
        args.companyId,
        "update",
        `Restored from backup "${backup.name}" in ${args.mode} mode (inserted ${insert}, updated ${update}, deleted ${deleted})`,
        { mode: args.mode, totals: result.totals, preRestoreBackupId: result.preRestoreBackupId }
      );
      await recordAudit({
        userId: args.userId,
        companyId: args.companyId,
        action: "backup.restore",
        entityType: "backup",
        entityId: args.backupId,
        before: { preRestoreBackupId: result.preRestoreBackupId },
        after: { mode: args.mode, totals: result.totals },
        req: args.req,
        extra: { requestKey: args.requestKey, result },
        required: true,
        client,
      });
    }
    await client.query(args.dryRun ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    log.warn({ err: (err as Error).message, backupId: args.backupId }, "Restore rolled back");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Restore into another company (clone / template) — S5 ────────────────────
//
// A backup of company A is loaded into company B: every row of the snapshot gets a
// fresh primary key and every reference to an old key (FK columns, JSON payloads,
// keys embedded in text such as source keys) is rewritten, company_id becomes B.
// B must hold no accounting activity yet; its existing company-scoped rows (the
// seeded chart, settings) are replaced by the snapshot's in one transaction after
// an automatic pre-restore backup of B. Nothing in A changes.

/** Tables never cloned into another company (globally unique external identities). */
export const CLONE_SKIPPED_TABLES: Readonly<Record<string, string>> = {
  email_intake_messages: "provider message ids are globally unique",
  ecommerce_transactions: "marketplace transaction ids belong to the source company's store",
  ecommerce_integrations: "store connections are credentials of the source company",
  webhook_endpoints: "outbound destinations and signing secrets belong to each company",
  whatsapp_configs: "messaging credentials and settings belong to each company",
  company_report_delivery_subscriptions: "report delivery recipients belong to each company",
  einvoice_archive: "immutable legal archive of the source company's transmissions",
  tax_return_archive: "immutable legal archive of the source company's filings",
  company_report_delivery_artifacts:
    "delivery files of the source company's delivery log (runs are not cloned; S8)",
};

/** Columns cleared on clone: public/unguessable tokens must not be shared by two companies. */
export const CLONE_CLEARED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  invoices: ["share_token"],
  customer_contacts: ["portal_access_token"],
};

const CLONE_COUNTERS = "invoice_number_sequences";

// Integration settings and delivery artifacts can exist without accounting activity.
const CLONE_TARGET_IGNORED_TABLES = new Set([
  "ecommerce_integrations",
  "webhook_endpoints",
  "whatsapp_configs",
  "company_report_delivery_subscriptions",
  "company_report_delivery_artifacts",
]);

async function countCloneTarget(
  client: Queryable,
  tables: Pick<ManifestTable, "name" | "predicate">[],
  companyId: string
): Promise<number> {
  // Counters can be reserved before the first document is saved. Preserve
  // them and take the greater value if the source has the same counter.
  const checked = tables.filter((t) => t.name !== CLONE_COUNTERS);
  if (!checked.length) return 0;
  const counts = checked.map(
    (t, idx) => `SELECT ${idx} AS idx, count(*) AS n FROM ${q(t.name)} t WHERE ${t.predicate}`
  );
  const { rows } = await pq<{ idx: number; n: string }>(
    `SELECT idx, n FROM (${counts.join(" UNION ALL ")}) AS clone_rows WHERE n > 0 ORDER BY idx`,
    [companyId],
    client
  );
  let replacedRows = 0;
  for (const { idx, n } of rows) {
    const t = checked[idx];
    const count = Number(n);
    if (t.name === "accounts") {
      const seeds = createDefaultAccountsForCompany(companyId).map((a) => ({
        code: a.code,
        name_en: a.nameEn,
        name_ar: a.nameAr ?? null,
        description: a.description ?? null,
        type: a.type,
        sub_type: a.subType ?? null,
        is_vat_account: a.isVatAccount,
        vat_type: a.vatType ?? null,
        is_system_account: a.isSystemAccount,
        is_active: a.isActive,
        is_archived: a.isArchived,
        parent_id: null,
        tax_tag: null,
        updated_at: null,
      }));
      const { rows: custom } = await pq<{ present: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM accounts t WHERE t.company_id = $1
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements($2::jsonb) seed
                            WHERE to_jsonb(t) - ARRAY['id', 'company_id', 'created_at'] = seed)) AS present`,
        [companyId, JSON.stringify(seeds)],
        client
      );
      if (!custom[0].present) {
        replacedRows += count;
        continue;
      }
    }
    throw new DomainError(
      "CLONE_TARGET_NOT_EMPTY",
      409,
      { table: t.name, rows: count },
      "The target company already has accounting activity. Clone only into a new, empty company."
    );
  }
  return replacedRows;
}

/** Skipped tables plus child tables reached only through skipped parents (to a fixed point). */
export function cloneSkipReasons(
  tables: Pick<ManifestTable, "name" | "scope" | "predicate">[]
): Map<string, string> {
  const skip = new Map<string, string>(
    tables
      .filter((t) => CLONE_SKIPPED_TABLES[t.name])
      .map((t) => [t.name, CLONE_SKIPPED_TABLES[t.name]])
  );
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of tables) {
      if (skip.has(t.name) || t.scope !== "child") continue;
      const parents = [...t.predicate.matchAll(/FROM "([^"]+)" p/g)].map((m) => m[1]);
      if (parents.length && parents.every((p) => skip.has(p))) {
        skip.set(t.name, `belongs to ${parents.join(", ")} (not cloned)`);
        changed = true;
      }
    }
  }
  return skip;
}

const UUID_RX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Rewrite a snapshot for `targetCompanyId`: fresh uuid primary keys, every occurrence of an
 * old key (anywhere in the JSON, including nested payloads and embedded in strings) replaced,
 * and the source company id replaced by the target. Pure; exported for unit tests.
 */
export function remapSnapshotForClone(
  tables: Record<string, unknown[]>,
  manifest: Pick<ManifestTable, "name" | "pk">[],
  sourceCompanyId: string,
  targetCompanyId: string,
  newId: () => string = () => crypto.randomUUID()
): { tables: Record<string, unknown[]>; remapped: number } {
  const map = new Map<string, string>();
  map.set(sourceCompanyId.toLowerCase(), targetCompanyId);
  for (const t of manifest) {
    if (t.pk.length !== 1) continue;
    for (const row of (tables[t.name] ?? []) as Array<Record<string, unknown>>) {
      const v = row?.[t.pk[0]];
      if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) && !map.has(v.toLowerCase())) {
        map.set(v.toLowerCase(), newId());
      }
    }
  }
  const out: Record<string, unknown[]> = {};
  for (const [name, rows] of Object.entries(tables)) {
    const cleared = CLONE_CLEARED_COLUMNS[name] ?? [];
    const json = JSON.stringify(rows ?? []).replace(UUID_RX, (m) => map.get(m.toLowerCase()) ?? m);
    const parsed = JSON.parse(json) as Array<Record<string, unknown>>;
    for (const row of parsed) for (const c of cleared) if (c in row) row[c] = null;
    out[name] = parsed;
  }
  return { tables: out, remapped: map.size - 1 };
}

export interface CloneResult {
  dryRun: boolean;
  sourceCompanyId: string;
  targetCompanyId: string;
  tables: Array<{ table: string; rows: number }>;
  totals: { insert: number; replacedTargetRows: number };
  skippedTables: Array<{ table: string; reason: string; rows: number }>;
  preRestoreBackupId: string | null;
}

/**
 * Restore (or dry-run) `backupId` into a different company. The caller checks permissions
 * (backups.manage in both companies) and fresh MFA. Both companies' audit
 * events commit in the same transaction as the load.
 */
export async function restoreBackupIntoCompany(
  args: {
    backupId: string;
    sourceCompanyId: string;
    targetCompanyId: string;
    userId: string;
    dryRun: boolean;
  } & RestoreAuditContext
): Promise<CloneResult> {
  if (args.sourceCompanyId === args.targetCompanyId) {
    throw new DomainError(
      "CLONE_TARGET_IS_SOURCE",
      422,
      undefined,
      "Choose a different company; use restore to roll this company back."
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `backup-restore:${args.targetCompanyId}`,
    ]);
    const backup = await loadRestoreBackup(
      client,
      args.backupId,
      args.sourceCompanyId,
      args.dryRun ? "" : "FOR SHARE"
    );
    if (!args.dryRun) {
      const receipt = await readRestoreReceipt<CloneResult>(
        client,
        args,
        args.targetCompanyId,
        "backup.clone"
      );
      if (receipt) {
        await client.query("COMMIT");
        return receipt;
      }
    }
    const snapshot = snapshotForRestore(backup);
    const {
      rows: [dst],
    } = await pq<{ name: string; base_currency: string | null }>(
      `SELECT name, base_currency FROM companies WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [args.targetCompanyId],
      client
    );
    if (!dst) throw new DomainError("NOT_FOUND", 404, undefined, "Target company not found");
    const {
      rows: [src],
    } = await pq<{ base_currency: string | null }>(
      `SELECT base_currency FROM companies WHERE id = $1 AND deleted_at IS NULL`,
      [args.sourceCompanyId],
      client
    );
    if (src && (src.base_currency || "AED") !== (dst.base_currency || "AED")) {
      throw new DomainError(
        "BASE_CURRENCY_MISMATCH",
        422,
        { source: src.base_currency, target: dst.base_currency },
        "The target company must use the same base currency as the backup's company."
      );
    }
    const full = await buildBackupManifest(client);
    const skip = cloneSkipReasons(full.tables);
    const skippedTables = full.tables
      .filter((t) => skip.has(t.name))
      .map((t) => ({
        table: t.name,
        reason: skip.get(t.name)!,
        rows: (snapshot.tables[t.name] ?? []).length,
      }));
    const cloneTables = full.tables.filter((t) => !skip.has(t.name));
    const targetTables = [
      ...full.tables.filter((t) => !CLONE_TARGET_IGNORED_TABLES.has(t.name)),
      // Transmission history remains live outside the backup manifest.
      ...externalCompanyTables(EINVOICE_HISTORY_TABLES),
    ];
    if (!args.dryRun) {
      await lockRestoreRows(client, args.targetCompanyId, { ...full, tables: targetTables });
    }

    // A clone's seed exceptions apply only to the target's chart and counters.
    // Check all other accounting tables, including those absent in old backups.
    const seedRows = await countCloneTarget(client, targetTables, args.targetCompanyId);
    const { tables } = remapSnapshotForClone(
      Object.fromEntries(
        cloneTables
          .filter((t) => Object.hasOwn(snapshot.tables, t.name))
          .map((t) => [t.name, snapshot.tables[t.name]])
      ),
      cloneTables,
      args.sourceCompanyId,
      args.targetCompanyId
    );
    const plan = planRestore({ ...snapshot, tables }, full, cloneTables);
    await validateSnapshotRows(client, plan);
    const counts = plan
      .map(({ table, rowCount }) => ({ table: table.name, rows: rowCount }))
      .filter((entry) => entry.rows > 0);
    const result: CloneResult = {
      dryRun: args.dryRun,
      sourceCompanyId: args.sourceCompanyId,
      targetCompanyId: args.targetCompanyId,
      tables: counts,
      totals: {
        insert: counts.reduce((sum, c) => sum + c.rows, 0),
        replacedTargetRows: plan.some(({ table }) => table.name === "accounts") ? seedRows : 0,
      },
      skippedTables: skippedTables.filter((t) => t.rows > 0),
      preRestoreBackupId: null,
    };
    if (!args.dryRun) {
      const pre = await createCompanyBackup(
        {
          companyId: args.targetCompanyId,
          userId: args.userId,
          name: `Pre-clone backup (before loading ${backup.name})`,
          description: "Automatic backup created before restoring another company's backup here",
          backupType: "pre_restore",
        },
        { client, manifest: full }
      );
      result.preRestoreBackupId = pre.id;
      await applyRestore(client, plan, args.targetCompanyId, "replace", true);
      const detail = `inserted ${result.totals.insert} row(s), replaced ${result.totals.replacedTargetRows}`;
      await restoreActivity(
        client,
        args,
        args.targetCompanyId,
        "update",
        `Loaded backup "${backup.name}" from another company (${detail})`,
        { sourceCompanyId: args.sourceCompanyId, totals: result.totals, preRestoreBackupId: pre.id }
      );
      await restoreActivity(
        client,
        args,
        args.sourceCompanyId,
        "export",
        `Backup "${backup.name}" was loaded into company "${dst.name}"`,
        { targetCompanyId: args.targetCompanyId }
      );
      // Acquire the audit-chain locks in stable order across concurrent clones.
      for (const companyId of [args.sourceCompanyId, args.targetCompanyId].sort()) {
        await recordAudit({
          userId: args.userId,
          companyId,
          action: "backup.clone",
          entityType: "backup",
          entityId: args.backupId,
          before: { preRestoreBackupId: pre.id },
          after: {
            sourceCompanyId: args.sourceCompanyId,
            targetCompanyId: args.targetCompanyId,
            totals: result.totals,
            skippedTables: result.skippedTables.map((t) => t.table),
          },
          req: args.req,
          extra:
            companyId === args.targetCompanyId
              ? { requestKey: args.requestKey, result }
              : undefined,
          required: true,
          client,
        });
      }
    }
    await client.query(args.dryRun ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    log.warn(
      { err: (err as Error).message, backupId: args.backupId, target: args.targetCompanyId },
      "Clone restore rolled back"
    );
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
