/**
 * Company data export (D5, migration 0120): a ZIP with one CSV per allowlisted
 * table, the company's files, and a manifest with a SHA-256 for every file.
 *
 * Tenant rule: direct tables filter by company_id, child tables are joined
 * through their parent's company_id; no query is built from request input.
 * Secrets: tables that hold credentials are not exported at all, and columns
 * that look like secrets are dropped from the tables that are.
 */
import crypto from "node:crypto";
import archiver from "archiver";
import { and, desc, eq, inArray, lt } from "drizzle-orm";

import { db, pool } from "../db";
import { companyDataExports, storedFiles } from "../../shared/schema";
import { createLogger } from "../config/logger";
import { deleteDocument, readDocument, readReceiptImage, saveDocument } from "./fileStorage";
import { hasEmailProvider, sendGenericEmail } from "./email.service";
import { storage } from "../storage";

const log = createLogger("company-export");

export const EXPORT_TTL_HOURS = 24;
export const STALE_RUNNING_MINUTES = 30;
export const EXPORT_CATEGORY = "company-exports";
const MAX_FILES_BYTES = 150 * 1024 * 1024;

// ───────────────────────── What is exported ─────────────────────────

interface TableSpec {
  name: string;
  /** FROM clause with the exported table aliased `t`. */
  from: string;
  where: string;
  /** Explicit column list (alias.col AS out); default is every column of `name`. */
  select?: string[];
}

const direct = (name: string): TableSpec => ({ name, from: `${name} t`, where: "t.company_id = $1" });
const child = (name: string, parent: string, fk: string): TableSpec => ({
  name,
  from: `${name} t JOIN ${parent} p ON p.id = t.${fk}`,
  where: "p.company_id = $1",
});

/** Tables with a bespoke query (they need a join to be useful or safe). */
const SPECIAL_TABLES: TableSpec[] = [
  { name: "companies", from: "companies t", where: "t.id = $1" },
  {
    name: "company_users",
    from: "company_users t JOIN users u ON u.id = t.user_id",
    where: "t.company_id = $1",
    select: ["t.id AS id", "t.company_id AS company_id", "t.role AS role", "u.email AS user_email", "u.name AS user_name", "t.created_at AS created_at"],
  },
];

/** Child tables without a company_id of their own: joined through the parent's company. */
export const CHILD_TABLES: Array<{ name: string; parent: string; fk: string }> = [
  { name: "invoice_lines", parent: "invoices", fk: "invoice_id" },
  { name: "journal_lines", parent: "journal_entries", fk: "entry_id" },
  { name: "bill_line_items", parent: "vendor_bills", fk: "bill_id" },
  { name: "bill_payments", parent: "vendor_bills", fk: "bill_id" },
  { name: "payroll_items", parent: "payroll_runs", fk: "payroll_run_id" },
  { name: "budget_lines", parent: "budget_plans", fk: "budget_id" },
  { name: "credit_note_lines", parent: "credit_notes", fk: "credit_note_id" },
  { name: "expense_claim_items", parent: "expense_claims", fk: "claim_id" },
  { name: "purchase_order_lines", parent: "purchase_orders", fk: "purchase_order_id" },
  { name: "quote_lines", parent: "quotes", fk: "quote_id" },
  { name: "service_invoice_lines", parent: "service_invoices", fk: "service_invoice_id" },
  { name: "vendor_credit_note_lines", parent: "vendor_credit_notes", fk: "credit_note_id" },
  { name: "sales_order_lines", parent: "sales_orders", fk: "sales_order_id" },
  { name: "sales_order_delivery_lines", parent: "sales_order_deliveries", fk: "delivery_id" },
  { name: "vat_workpaper_attachments", parent: "vat_workpapers", fk: "workpaper_id" },
];

/**
 * Tables that are never exported, with the reason. Everything else that carries a company_id IS
 * exported, so a new company table is picked up automatically; one that must not leave the building
 * has to be named here (the coverage test fails until it is exported or listed).
 */
export const DENYLIST: Record<string, string> = {
  api_keys: "credential hashes",
  api_request_log: "operational log",
  idempotency_keys: "stored API responses",
  bank_connections: "bank provider tokens",
  bank_provider_customers: "bank provider identifiers",
  payment_gateway_connections: "payment provider credentials",
  ecommerce_integrations: "store credentials",
  whatsapp_configs: "provider tokens",
  whatsapp_bridge_sessions: "session credentials",
  whatsapp_bridge_jobs: "operational queue",
  webhook_endpoints: "signing secrets",
  webhook_deliveries: "signed payloads",
  invitations: "invitation tokens",
  company_data_exports: "the export machinery itself",
  company_deletion_requests: "deletion bookkeeping",
  import_jobs: "uploaded migration files (the data is exported where it landed)",
  import_job_rows: "uploaded migration files",
  analytics_events: "product analytics, not company records",
  user_feedback: "product feedback, not company records",
  client_notes: "the accounting firm's private notes",
  firm_alerts: "firm-internal",
  firm_growth_opportunities: "firm-internal",
  firm_growth_actions: "firm-internal",
  firm_leads: "firm-internal",
  firm_staff_assignments: "firm-internal",
  engagements: "firm-internal",
  company_report_delivery_scheduler_scans: "scheduler bookkeeping",
};

/** Resolve what to export from the tables that carry a company_id in this database. */
export function resolveExportSpecs(companyTables: string[], existingTables: Set<string>): TableSpec[] {
  const special = new Set(SPECIAL_TABLES.map((t) => t.name));
  const direct_ = companyTables
    .filter((t) => !special.has(t) && !(t in DENYLIST))
    .sort()
    .map(direct);
  const children = CHILD_TABLES.filter((c) => existingTables.has(c.name) && existingTables.has(c.parent) && !(c.name in DENYLIST)).map((c) => child(c.name, c.parent, c.fk));
  return [...SPECIAL_TABLES, ...direct_, ...children];
}

/**
 * Tables the export would silently miss: a table that references an exported table but has no
 * company_id of its own, is not a known child and is not denylisted.
 */
export function findUncoveredChildren(candidates: string[]): string[] {
  const known = new Set([...CHILD_TABLES.map((c) => c.name), ...Object.keys(DENYLIST)]);
  return candidates.filter((t) => !known.has(t));
}

export async function exportCoverage(): Promise<{ exported: number; uncovered: string[] }> {
  const { companyTables, existing } = await loadCompanyTables();
  const exported = new Set(resolveExportSpecs(companyTables, existing).map((t) => t.name));
  const refs = await pool.query(
    `SELECT DISTINCT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
       FROM pg_constraint c WHERE c.contype = 'f'`
  );
  const hasCompanyId = new Set(companyTables);
  const candidates = refs.rows
    .filter((r: any) => exported.has(r.parent) && !hasCompanyId.has(r.child) && r.child !== "users" && !SPECIAL_TABLES.some((t) => t.name === r.child))
    .map((r: any) => r.child as string);
  return { exported: exported.size, uncovered: Array.from(new Set(findUncoveredChildren(candidates))).sort() };
}

async function loadCompanyTables(): Promise<{ companyTables: string[]; existing: Set<string> }> {
  const { rows } = await pool.query(
    `SELECT DISTINCT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'company_id'`
  );
  const all = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
  return { companyTables: rows.map((r: any) => r.table_name as string), existing: new Set(all.rows.map((r: any) => r.table_name as string)) };
}

/** Credentials and large blobs never go into a CSV. (Receipt images travel as files.) */
export const SECRET_COLUMN = /(password|passwd|secret|token|api_?key|key_hash|private_key|credential|access_key|refresh|authorization|encryption|otp|totp|signing)/i;
const BLOB_COLUMNS = new Set(["image_data", "snapshot", "data_snapshot"]);

export function isExcludedColumn(name: string): boolean {
  return SECRET_COLUMN.test(name) || BLOB_COLUMNS.has(name);
}

// ───────────────────────── CSV ─────────────────────────

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Quote for CSV and defuse spreadsheet formulas: a text cell starting = + - @ gets a leading '. */
export function csvCell(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  let v = String(raw);
  if (/^[=+\-@\t\r]/.test(v) && !NUMERIC.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function csvLine(cells: Array<string | null | undefined>): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

// ───────────────────────── Build ─────────────────────────

export interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
  rows?: number;
}
export interface ExportManifest {
  version: 1;
  companyId: string;
  generatedAt: string;
  tables: ManifestFile[];
  files: Array<ManifestFile & { source: string }>;
  skipped: Array<{ what: string; reason: string }>;
  excludedColumns: Record<string, string[]>;
}

const sha256 = (buf: Buffer | string) => crypto.createHash("sha256").update(buf).digest("hex");
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "file";

export async function buildCompanyExport(companyId: string): Promise<{ zip: Buffer; manifest: ExportManifest }> {
  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    archive.on("error", reject);
    archive.on("end", () => resolve());
  });

  const manifest: ExportManifest = {
    version: 1,
    companyId,
    generatedAt: new Date().toISOString(),
    tables: [],
    files: [],
    skipped: [],
    excludedColumns: {},
  };

  // 1. Tables
  const { companyTables, existing } = await loadCompanyTables();
  const specs = resolveExportSpecs(companyTables, existing);
  const names = specs.map((t) => t.name);
  const cols = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name, ordinal_position`,
    [names]
  );
  const columnsByTable = new Map<string, string[]>();
  for (const r of cols.rows) {
    const list = columnsByTable.get(r.table_name) ?? [];
    list.push(r.column_name);
    columnsByTable.set(r.table_name, list);
  }

  for (const spec of specs) {
    const available = columnsByTable.get(spec.name);
    if (!available) {
      manifest.skipped.push({ what: spec.name, reason: "table_missing" });
      continue;
    }
    const kept = available.filter((c) => !isExcludedColumn(c));
    const dropped = available.filter((c) => isExcludedColumn(c));
    if (dropped.length) manifest.excludedColumns[spec.name] = dropped;
    const header = spec.select ? spec.select.map((s) => s.split(" AS ")[1]) : kept;
    const selectList = spec.select
      ? spec.select.map((s) => {
          const [expr, alias] = s.split(" AS ");
          return `${expr}::text AS "${alias}"`;
        })
      : kept.map((c) => `t."${c}"::text AS "${c}"`);
    const { rows } = await pool.query(`SELECT ${selectList.join(", ")} FROM ${spec.from} WHERE ${spec.where} ORDER BY t.ctid`, [companyId]);
    const text = csvLine(header) + rows.map((r: Record<string, string | null>) => csvLine(header.map((h) => r[h]))).join("");
    const buf = Buffer.from("﻿" + text, "utf8");
    const path = `data/${spec.name}.csv`;
    archive.append(buf, { name: path });
    manifest.tables.push({ path, bytes: buf.length, sha256: sha256(buf), rows: rows.length });
  }

  // 2. Files: documents, stored files, receipt images, tax evidence
  let fileBytes = 0;
  const seenKeys = new Set<string>();
  const addFile = async (path: string, source: string, load: () => Promise<Buffer | null>) => {
    const buf = await load();
    if (!buf) return void manifest.skipped.push({ what: source, reason: "file_not_found" });
    if (fileBytes + buf.length > MAX_FILES_BYTES) return void manifest.skipped.push({ what: source, reason: "size_cap_reached" });
    fileBytes += buf.length;
    archive.append(buf, { name: path });
    manifest.files.push({ path, bytes: buf.length, sha256: sha256(buf), source });
  };
  const byKey = (key: string) => async () => (await readDocument(key))?.buffer ?? null;

  const docs = await pool.query(`SELECT id, file_url, file_name FROM documents WHERE company_id = $1 AND file_url IS NOT NULL`, [companyId]);
  for (const d of docs.rows) {
    if (seenKeys.has(d.file_url)) continue;
    seenKeys.add(d.file_url);
    await addFile(`documents/${d.id}-${safeName(d.file_name ?? "document")}`, `documents.file_url:${d.id}`, byKey(d.file_url));
  }
  const evidence = await pool.query(`SELECT id, storage_key, filename FROM tax_filing_evidence WHERE company_id = $1 AND storage_key IS NOT NULL`, [companyId]);
  for (const e of evidence.rows) {
    if (seenKeys.has(e.storage_key)) continue;
    seenKeys.add(e.storage_key);
    await addFile(`tax-evidence/${e.id}-${safeName(e.filename ?? "evidence")}`, `tax_filing_evidence:${e.id}`, byKey(e.storage_key));
  }
  const stored = await pool.query(`SELECT id, storage_key, filename FROM stored_files WHERE company_id = $1 AND category <> $2`, [companyId, EXPORT_CATEGORY]);
  for (const f of stored.rows) {
    if (seenKeys.has(f.storage_key)) continue;
    seenKeys.add(f.storage_key);
    await addFile(`files/${f.id}-${safeName(f.filename)}`, `stored_files:${f.id}`, byKey(f.storage_key));
  }
  const receipts = await pool.query(`SELECT id, image_path, image_data FROM receipts WHERE company_id = $1 AND (image_path IS NOT NULL OR image_data IS NOT NULL)`, [companyId]);
  for (const r of receipts.rows) {
    if (r.image_path && seenKeys.has(r.image_path)) continue;
    if (r.image_path) seenKeys.add(r.image_path);
    await addFile(`receipts/${r.id}.jpg`, `receipts.image:${r.id}`, async () => {
      if (r.image_path) {
        const got = await readReceiptImage(r.image_path).catch(() => null);
        if (got) return got.buffer;
      }
      if (typeof r.image_data === "string" && r.image_data.length > 0) {
        return Buffer.from(r.image_data.replace(/^data:[^;]+;base64,/, ""), "base64");
      }
      return null;
    });
  }

  archive.append(Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), { name: "manifest.json" });
  await archive.finalize();
  await done;
  return { zip: Buffer.concat(chunks), manifest };
}

// ───────────────────────── Job lifecycle ─────────────────────────

export class ExportInProgressError extends Error {
  code = "EXPORT_IN_PROGRESS";
}

function isUniqueViolation(err: unknown): boolean {
  let cur: any = err;
  for (let i = 0; i < 4 && cur; i++, cur = cur.cause) if (cur.code === "23505") return true;
  return false;
}

export async function requestExport(companyId: string, userId: string, retried = false): Promise<typeof companyDataExports.$inferSelect> {
  try {
    const [row] = await db.insert(companyDataExports).values({ companyId, requestedBy: userId, status: "queued" }).returning();
    // In-process, after the 202: the job survives only as long as this server does, and boot marks
    // a job that was running when the process died as failed.
    setImmediate(() => void runExportJob(row.id));
    return row;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // A claim older than 30 minutes belongs to a dead process: clear it once and try again.
    if (!retried && (await failStaleExports()) > 0) return requestExport(companyId, userId, true);
    throw new ExportInProgressError("An export is already running for this company");
  }
}

export async function runExportJob(exportId: string): Promise<void> {
  const [job] = await db.select().from(companyDataExports).where(eq(companyDataExports.id, exportId));
  if (!job || job.status !== "queued") return;
  await db.update(companyDataExports).set({ status: "running" }).where(eq(companyDataExports.id, exportId));
  try {
    const { zip, manifest } = await buildCompanyExport(job.companyId);
    const stamp = new Date().toISOString().slice(0, 10);
    const saved = await saveDocument({
      companyId: job.companyId,
      category: EXPORT_CATEGORY,
      filename: `muhasib-export-${stamp}.zip`,
      contentType: "application/zip",
      buffer: zip,
    });
    const [file] = await db
      .insert(storedFiles)
      .values({
        companyId: job.companyId,
        storageKey: saved.key,
        category: EXPORT_CATEGORY,
        filename: `muhasib-export-${stamp}.zip`,
        contentType: "application/zip",
        sizeBytes: zip.length,
        uploadedBy: job.requestedBy,
      })
      .returning();
    await db
      .update(companyDataExports)
      .set({
        status: "ready",
        storedFileId: file.id,
        sha256: sha256(zip),
        sizeBytes: zip.length,
        manifest: manifest as unknown as Record<string, unknown>,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + EXPORT_TTL_HOURS * 3600 * 1000),
      })
      .where(eq(companyDataExports.id, exportId));
    void notifyExportReady(job.requestedBy, job.companyId);
  } catch (err) {
    log.error({ err, exportId }, "Company export failed");
    await db
      .update(companyDataExports)
      .set({ status: "failed", error: err instanceof Error ? err.message.slice(0, 500) : "Export failed", completedAt: new Date() })
      .where(eq(companyDataExports.id, exportId));
  }
}

async function notifyExportReady(userId: string | null, companyId: string): Promise<void> {
  if (!userId || !hasEmailProvider()) return;
  try {
    const user = await storage.getUser(userId);
    if (!user) return;
    await sendGenericEmail(
      user.email,
      "Your company data export is ready",
      `Your export is ready. Download it from Settings > Data & privacy within ${EXPORT_TTL_HOURS} hours; after that the link expires and you can request a new one.`,
      "Muhasib.ai"
    );
  } catch (err) {
    log.warn({ err, companyId }, "Export-ready email failed");
  }
}

export async function listExports(companyId: string) {
  return db.select().from(companyDataExports).where(eq(companyDataExports.companyId, companyId)).orderBy(desc(companyDataExports.createdAt)).limit(50);
}

export async function getExport(companyId: string, id: string) {
  const [row] = await db.select().from(companyDataExports).where(and(eq(companyDataExports.id, id), eq(companyDataExports.companyId, companyId)));
  return row;
}

/** Boot recovery: a job "running" for over 30 minutes died with its process. */
export async function failStaleExports(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MINUTES * 60 * 1000);
  const rows = await db
    .update(companyDataExports)
    .set({ status: "failed", error: "Interrupted: the server restarted while the export was running", completedAt: new Date() })
    .where(and(inArray(companyDataExports.status, ["running", "queued"]), lt(companyDataExports.createdAt, cutoff)))
    .returning({ id: companyDataExports.id });
  return rows.length;
}

/** Daily: a ready export past its 24 h link is expired and its file deleted. */
export async function expireOldExports(): Promise<number> {
  const due = await db
    .select()
    .from(companyDataExports)
    .where(and(eq(companyDataExports.status, "ready"), lt(companyDataExports.expiresAt, new Date())));
  for (const row of due) {
    if (row.storedFileId) {
      const [file] = await db.select().from(storedFiles).where(eq(storedFiles.id, row.storedFileId));
      if (file) {
        await deleteDocument(file.storageKey).catch(() => undefined);
        await db.delete(storedFiles).where(eq(storedFiles.id, file.id));
      }
    }
    await db.update(companyDataExports).set({ status: "expired", storedFileId: null }).where(eq(companyDataExports.id, row.id));
  }
  return due.length;
}

export async function readExportZip(row: { storedFileId: string | null }): Promise<Buffer | null> {
  if (!row.storedFileId) return null;
  const [file] = await db.select().from(storedFiles).where(eq(storedFiles.id, row.storedFileId));
  if (!file) return null;
  return (await readDocument(file.storageKey))?.buffer ?? null;
}

