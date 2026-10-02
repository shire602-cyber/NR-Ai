/**
 * Migration-wizard jobs (D5, migration 0121).
 *
 *   uploaded -> mapped -> validated -> committing -> committed | failed
 *
 * Contacts, items and the chart of accounts are committed job by job. The
 * opening position (trial balance + open invoices + open bills) is committed
 * together through opening-balance.service, so the ledger sees ONE balanced
 * opening entry and the AR/AP control accounts tie to the open documents.
 */
import type { Request } from "express";
import { and, asc, eq, sql } from "drizzle-orm";

import { db, pool } from "../../db";
import { importJobRows, importJobs } from "../../../shared/schema";
import { createLogger } from "../../config/logger";
import { AppError } from "../../errors";
import { recordAudit } from "../audit.service";
import { dayBefore } from "../opening-balance";
import { postOpeningBalance, previewOpeningBalance, type OpeningDocInput } from "../opening-balance.service";
import {
  DATE_FORMATS,
  ImportFileError,
  stripNul,
  type RawRow,
  parseImportFile,
} from "./parse";
import {
  ENTITY_FIELDS,
  OPENING_ENTITIES,
  type ImportOptions,
  type RowContext,
  type RowResult,
  insertChunk,
  isNowDuplicate,
  loadExisting,
  normalizeRow,
} from "./entities";
import { IMPORT_ENTITIES, IMPORT_SOURCES, defaultOptionsFor, suggestMapping, type ImportEntity, type ImportSource } from "./presets";

const log = createLogger("import");

const ROW_INSERT_CHUNK = 500;
const COMMIT_CHUNK = 200;
const SAMPLE_ROWS = 10;
const ERROR_SAMPLE = 50;

export class ImportError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

type Job = typeof importJobs.$inferSelect;

async function getJob(companyId: string, jobId: string): Promise<Job> {
  const [job] = /^[0-9a-f-]{36}$/i.test(jobId)
    ? await db.select().from(importJobs).where(and(eq(importJobs.id, jobId), eq(importJobs.companyId, companyId)))
    : [];
  if (!job) throw new ImportError(404, "NOT_FOUND", "Import job not found");
  return job;
}

export function presentJob(job: Job) {
  return {
    id: job.id,
    source: job.source,
    entity: job.entity,
    status: job.status,
    filename: job.filename,
    mapping: job.mapping,
    options: job.options,
    rowCount: job.rowCount,
    errorCount: job.errorCount,
    result: job.result,
    createdAt: job.createdAt,
    committedAt: job.committedAt,
  };
}

const jsonRaw = (row: RawRow): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v]));

// ───────────────────────── 1. Upload ─────────────────────────

export async function createJob(input: {
  companyId: string;
  userId: string;
  source: string;
  entity: string;
  filename: string;
  content: Buffer;
}) {
  if (!(IMPORT_SOURCES as readonly string[]).includes(input.source)) throw new ImportError(400, "SOURCE_INVALID", "Unknown source");
  if (!(IMPORT_ENTITIES as readonly string[]).includes(input.entity)) throw new ImportError(400, "ENTITY_INVALID", "Unknown entity");
  const source = input.source as ImportSource;
  const entity = input.entity as ImportEntity;

  let parsed;
  try {
    parsed = await parseImportFile(input.content, input.filename);
  } catch (err) {
    if (err instanceof ImportFileError) throw new ImportError(err.code === "FILE_TOO_LARGE" ? 413 : 422, err.code, err.message);
    throw err;
  }

  const suggested = suggestMapping(source, entity, parsed.headers);
  const options = { ...defaultOptionsFor(source), currency: "AED", defaultContactType: "customer", foldProfitAndLoss: true } satisfies Partial<ImportOptions>;

  const job = await db.transaction(async (tx: typeof db) => {
    const [j] = await tx
      .insert(importJobs)
      .values({
        companyId: input.companyId,
        createdBy: input.userId,
        source,
        entity,
        status: "uploaded",
        filename: stripNul(input.filename).slice(0, 200),
        mapping: suggested,
        options,
        rowCount: parsed.rows.length,
      })
      .returning();
    for (let i = 0; i < parsed.rows.length; i += ROW_INSERT_CHUNK) {
      const chunk = parsed.rows.slice(i, i + ROW_INSERT_CHUNK);
      await tx.insert(importJobRows).values(chunk.map((row, k) => ({ jobId: j.id, rowNumber: i + k + 1, raw: jsonRaw(row), action: "create" })));
    }
    return j;
  });

  return {
    job: presentJob(job),
    fields: ENTITY_FIELDS[entity],
    detectedColumns: parsed.headers,
    suggestedMapping: suggested,
    sampleRows: parsed.rows.slice(0, SAMPLE_ROWS).map(jsonRaw),
  };
}

// ───────────────────────── 2. Mapping ─────────────────────────

export interface MappingInput {
  mapping: Record<string, string>;
  options?: Partial<{
    dateFormat: string;
    numberFormat: string;
    goLiveDate: string;
    currency: string;
    defaultContactType: string;
    foldProfitAndLoss: boolean;
  }>;
}

export async function saveMapping(companyId: string, jobId: string, input: MappingInput) {
  const job = await getJob(companyId, jobId);
  if (job.status === "committing" || job.status === "committed") throw new ImportError(409, "IMPORT_ALREADY_COMMITTED", "This import was already committed");
  const entity = job.entity as ImportEntity;
  const fields = new Set(ENTITY_FIELDS[entity].map((f) => f.key));

  const { rows: columnRows } = await pool.query(`SELECT raw FROM import_job_rows WHERE job_id = $1 ORDER BY row_number LIMIT 1`, [jobId]);
  const detected = new Set(Object.keys(columnRows[0]?.raw ?? {}));
  const mapping: Record<string, string> = {};
  for (const [field, column] of Object.entries(input.mapping ?? {})) {
    if (!fields.has(field)) throw new ImportError(400, "MAPPING_FIELD_UNKNOWN", `"${field}" is not a field of ${entity}`);
    if (column === "" || column === null) continue;
    if (!detected.has(column)) throw new ImportError(400, "MAPPING_COLUMN_UNKNOWN", `The file has no column "${column}"`);
    mapping[field] = column;
  }
  const missing = ENTITY_FIELDS[entity].filter((f) => f.required && !mapping[f.key]).map((f) => f.key);
  if (missing.length) throw new ImportError(422, "MAPPING_INCOMPLETE", `Map the required fields: ${missing.join(", ")}`, { missing });
  if (entity === "opening_tb") {
    if (!mapping.accountCode && !mapping.accountName) throw new ImportError(422, "MAPPING_INCOMPLETE", "Map an account code or an account name", { missing: ["accountCode"] });
    if (!mapping.balance && !(mapping.debit || mapping.credit)) throw new ImportError(422, "MAPPING_INCOMPLETE", "Map debit and credit columns, or a balance column", { missing: ["debit", "credit"] });
  }

  const current = (job.options ?? {}) as Partial<ImportOptions>;
  const o = input.options ?? {};
  if (o.dateFormat !== undefined && !(DATE_FORMATS as readonly string[]).includes(o.dateFormat)) throw new ImportError(400, "OPTION_INVALID", "Unknown date format");
  if (o.numberFormat !== undefined && !["us", "eu"].includes(o.numberFormat)) throw new ImportError(400, "OPTION_INVALID", "Number format must be us or eu");
  if (o.goLiveDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(o.goLiveDate)) throw new ImportError(400, "OPTION_INVALID", "goLiveDate must be YYYY-MM-DD");
  if (o.currency !== undefined && !/^[A-Za-z]{3}$/.test(o.currency)) throw new ImportError(400, "OPTION_INVALID", "currency must be a 3-letter code");
  if (o.defaultContactType !== undefined && !["customer", "vendor", "both"].includes(o.defaultContactType)) throw new ImportError(400, "OPTION_INVALID", "defaultContactType must be customer, vendor or both");
  const options: Partial<ImportOptions> = {
    ...current,
    ...(o.dateFormat ? { dateFormat: o.dateFormat as ImportOptions["dateFormat"] } : {}),
    ...(o.numberFormat ? { numberFormat: o.numberFormat as ImportOptions["numberFormat"] } : {}),
    ...(o.goLiveDate ? { goLiveDate: o.goLiveDate } : {}),
    ...(o.currency ? { currency: o.currency.toUpperCase() } : {}),
    ...(o.defaultContactType ? { defaultContactType: o.defaultContactType as ImportOptions["defaultContactType"] } : {}),
    ...(o.foldProfitAndLoss !== undefined ? { foldProfitAndLoss: o.foldProfitAndLoss } : {}),
  };

  // A new mapping invalidates any earlier validation.
  await db.transaction(async (tx: typeof db) => {
    await tx.update(importJobs).set({ mapping, options, status: "mapped", errorCount: 0, result: null }).where(eq(importJobs.id, jobId));
    await tx.update(importJobRows).set({ normalized: null, errors: null, action: "create" }).where(eq(importJobRows.jobId, jobId));
  });
  return presentJob(await getJob(companyId, jobId));
}

// ───────────────────────── 3. Dry run ─────────────────────────

export async function dryRun(companyId: string, jobId: string) {
  const job = await getJob(companyId, jobId);
  if (job.status === "committing" || job.status === "committed") throw new ImportError(409, "IMPORT_ALREADY_COMMITTED", "This import was already committed");
  if (job.status === "uploaded") throw new ImportError(409, "MAPPING_REQUIRED", "Confirm the column mapping first");
  const entity = job.entity as ImportEntity;
  const mapping = (job.mapping ?? {}) as Record<string, string>;
  const options = job.options as ImportOptions;

  const ctx: RowContext = { options, existing: await loadExisting(entity, companyId), seen: new Set() };
  const rows = await db.select().from(importJobRows).where(eq(importJobRows.jobId, jobId)).orderBy(asc(importJobRows.rowNumber));
  let errorCount = 0;
  let duplicates = 0;
  let creatable = 0;
  const errorSample: Array<{ row: number; errors: unknown }> = [];
  let totalDebit = 0;
  let totalCredit = 0;

  const results: Array<{ id: string; r: RowResult }> = rows.map((row: any) => {
    const r = normalizeRow(entity, row.raw as RawRow, mapping, ctx);
    if (r.action === "error") {
      errorCount++;
      if (errorSample.length < ERROR_SAMPLE) errorSample.push({ row: row.rowNumber, errors: r.errors });
    } else if (r.action === "skip_duplicate") duplicates++;
    else {
      creatable++;
      if (entity === "opening_tb" && r.normalized) {
        totalDebit += Number(r.normalized.debit);
        totalCredit += Number(r.normalized.credit);
      }
    }
    return { id: row.id as string, r };
  });

  // One batched UPDATE per chunk instead of a round trip per row.
  for (let i = 0; i < results.length; i += 500) {
    const chunk = results.slice(i, i + 500);
    await pool.query(
      `UPDATE import_job_rows AS t SET normalized = v.normalized::jsonb, errors = v.errors::jsonb, action = v.action
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS normalized, unnest($3::text[]) AS errors, unnest($4::text[]) AS action) v
        WHERE t.id = v.id`,
      [chunk.map((c) => c.id), chunk.map((c) => (c.r.normalized ? JSON.stringify(c.r.normalized) : null)), chunk.map((c) => JSON.stringify(c.r.errors)), chunk.map((c) => c.r.action)]
    );
  }
  await db.update(importJobs).set({ status: "validated", errorCount, result: null }).where(eq(importJobs.id, jobId));

  const summary: Record<string, unknown> = {
    rowCount: rows.length,
    toCreate: creatable,
    duplicates,
    errors: errorCount,
    errorSample,
    created: 0,
  };
  if (entity === "opening_tb") {
    summary.totalDebit = Math.round(totalDebit * 100) / 100;
    summary.totalCredit = Math.round(totalCredit * 100) / 100;
    summary.balanced = Math.abs(totalDebit - totalCredit) < 0.005;
  }
  return { job: presentJob(await getJob(companyId, jobId)), summary };
}

// ───────────────────────── 4. Commit (contacts, items, accounts) ─────────────────────────

export async function commitJob(companyId: string, jobId: string, user: { id: string }, req?: Request) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new ImportError(404, "NOT_FOUND", "Import job not found");
  // Lock the job row and claim it: exactly one caller moves validated -> committing.
  const client = await pool.connect();
  let job: any;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT id, entity, status FROM import_jobs WHERE id = $1 AND company_id = $2 FOR UPDATE`, [jobId, companyId]);
    job = rows[0];
    if (!job) {
      await client.query("ROLLBACK");
      throw new ImportError(404, "NOT_FOUND", "Import job not found");
    }
    if (OPENING_ENTITIES.has(job.entity)) {
      await client.query("ROLLBACK");
      throw new ImportError(409, "USE_IMPORT_OPENING", "Opening balances, open invoices and open bills are committed together with the import-opening step");
    }
    if (job.status === "committed" || job.status === "committing") {
      await client.query("ROLLBACK");
      throw new ImportError(409, job.status === "committed" ? "IMPORT_ALREADY_COMMITTED" : "IMPORT_IN_PROGRESS", job.status === "committed" ? "This import was already committed" : "This import is being committed");
    }
    if (job.status !== "validated" && job.status !== "failed") {
      await client.query("ROLLBACK");
      throw new ImportError(409, "IMPORT_NOT_VALIDATED", "Run the dry run before committing");
    }
    await client.query(`UPDATE import_jobs SET status = 'committing' WHERE id = $1`, [jobId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  const entity = job.entity as ImportEntity;
  let created = 0;
  let skipped = 0;
  try {
    for (;;) {
      // Rows not yet written: a crash resumes here without duplicating what is already created.
      const pending = await db
        .select()
        .from(importJobRows)
        .where(and(eq(importJobRows.jobId, jobId), eq(importJobRows.action, "create"), sql`${importJobRows.createdEntityId} IS NULL`))
        .orderBy(asc(importJobRows.rowNumber))
        .limit(COMMIT_CHUNK);
      if (!pending.length) break;
      const fresh: typeof pending = [];
      for (const row of pending) {
        if (await isNowDuplicate(entity, companyId, row.normalized as Record<string, any>)) {
          await db.update(importJobRows).set({ action: "skip_duplicate", errors: [{ code: "DUPLICATE_AT_COMMIT", message: "Created by someone else after the dry run" }] }).where(eq(importJobRows.id, row.id));
          skipped++;
        } else fresh.push(row);
      }
      if (!fresh.length) continue;
      await db.transaction(async (tx: typeof db) => {
        const ids = await insertChunk(entity, companyId, fresh.map((r: any) => ({ id: r.id, normalized: r.normalized as Record<string, any> })), tx);
        for (const [rowId, entityId] of ids) await tx.update(importJobRows).set({ createdEntityId: entityId }).where(eq(importJobRows.id, rowId));
        created += ids.size;
      });
    }
    const counts = await pool.query(
      `SELECT count(*) FILTER (WHERE created_entity_id IS NOT NULL)::int AS created,
              count(*) FILTER (WHERE action = 'skip_duplicate')::int AS skipped,
              count(*) FILTER (WHERE action = 'error')::int AS errors
         FROM import_job_rows WHERE job_id = $1`,
      [jobId]
    );
    const result = { created: counts.rows[0].created, skippedDuplicates: counts.rows[0].skipped, errors: counts.rows[0].errors };
    await db.update(importJobs).set({ status: "committed", committedAt: new Date(), result }).where(eq(importJobs.id, jobId));
    await recordAudit({ userId: user.id, companyId, action: "import.commit", entityType: "import_job", entityId: jobId, after: { entity, ...result }, req });
    return { job: presentJob(await getJob(companyId, jobId)), result };
  } catch (err) {
    log.error({ err, jobId }, "Import commit failed");
    await db
      .update(importJobs)
      .set({ status: "failed", result: { error: err instanceof Error ? err.message.slice(0, 300) : "failed", createdSoFar: created } })
      .where(eq(importJobs.id, jobId));
    throw new ImportError(500, "IMPORT_FAILED", "The import stopped part-way; run commit again to resume without duplicates");
  }
}

// ───────────────────────── Rows and listing ─────────────────────────

export async function listRows(companyId: string, jobId: string, opts: { status?: string; page: number; perPage: number }) {
  await getJob(companyId, jobId);
  const filters = [sql`job_id = ${jobId}`];
  if (opts.status === "error") filters.push(sql`action = 'error'`);
  else if (opts.status === "duplicate") filters.push(sql`action = 'skip_duplicate'`);
  else if (opts.status === "create") filters.push(sql`action = 'create'`);
  const where = sql.join(filters, sql` AND `);
  const res: any = await db.execute(
    sql`SELECT row_number, raw, normalized, errors, action, created_entity_id FROM import_job_rows WHERE ${where} ORDER BY row_number LIMIT ${opts.perPage} OFFSET ${(opts.page - 1) * opts.perPage}`
  );
  const total: any = await db.execute(sql`SELECT count(*)::int AS n FROM import_job_rows WHERE ${where}`);
  return {
    total: (total.rows ?? total)[0].n as number,
    rows: (res.rows ?? res).map((r: any) => ({
      rowNumber: r.row_number,
      raw: r.raw,
      normalized: r.normalized,
      errors: r.errors ?? [],
      action: r.action,
      createdEntityId: r.created_entity_id,
    })),
  };
}

export async function listJobs(companyId: string) {
  const res: any = await db.execute(sql`SELECT * FROM import_jobs WHERE company_id = ${companyId} ORDER BY created_at DESC LIMIT 100`);
  return (res.rows ?? res).map((r: any) =>
    presentJob({
      id: r.id, companyId: r.company_id, createdBy: r.created_by, source: r.source, entity: r.entity, status: r.status, storedFileId: r.stored_file_id,
      filename: r.filename, mapping: r.mapping, options: r.options, rowCount: r.row_count, errorCount: r.error_count, result: r.result,
      createdAt: r.created_at, committedAt: r.committed_at,
    } as Job)
  );
}

export const getJobForCompany = getJob;

// ───────────────────────── Opening position ─────────────────────────

interface OpeningInputs {
  asOfDate: string;
  rows: Array<{ accountCode: string; debit: number; credit: number }>;
  invoices: OpeningDocInput[];
  bills: OpeningDocInput[];
  jobs: Job[];
  foldedPl: number;
  totalDebit: number;
  totalCredit: number;
}

async function loadValidatedRows(jobId: string) {
  return db.select().from(importJobRows).where(and(eq(importJobRows.jobId, jobId), eq(importJobRows.action, "create"))).orderBy(asc(importJobRows.rowNumber));
}

async function resolveOpeningJob(companyId: string, id: unknown, entity: ImportEntity, required: boolean): Promise<Job | null> {
  if (id === undefined || id === null || id === "") {
    if (required) throw new ImportError(400, "JOB_REQUIRED", `A validated ${entity} job is required`);
    return null;
  }
  if (typeof id !== "string") throw new ImportError(400, "JOB_INVALID", "Job ids must be strings");
  const job = await getJob(companyId, id);
  if (job.entity !== entity) throw new ImportError(422, "JOB_WRONG_ENTITY", `Job ${id} is a ${job.entity} job, not ${entity}`);
  if (job.status === "committed") throw new ImportError(409, "IMPORT_ALREADY_COMMITTED", `Job ${id} was already committed`);
  if (job.status !== "validated") throw new ImportError(409, "IMPORT_NOT_VALIDATED", `Run the dry run for job ${id} first`);
  if (job.errorCount > 0) throw new ImportError(422, "IMPORT_HAS_ERRORS", `Job ${id} still has ${job.errorCount} row error(s); fix the file and upload it again`, { errorCount: job.errorCount });
  return job;
}

async function gatherOpening(companyId: string, body: { tbJobId?: unknown; invoicesJobId?: unknown; billsJobId?: unknown; asOfDate?: unknown }): Promise<OpeningInputs> {
  const tb = (await resolveOpeningJob(companyId, body.tbJobId, "opening_tb", true))!;
  const inv = await resolveOpeningJob(companyId, body.invoicesJobId, "open_invoices", false);
  const bil = await resolveOpeningJob(companyId, body.billsJobId, "open_bills", false);

  const options = tb.options as ImportOptions;
  let asOfDate = typeof body.asOfDate === "string" && body.asOfDate ? body.asOfDate : null;
  if (!asOfDate && options.goLiveDate) asOfDate = dayBefore(options.goLiveDate);
  if (!asOfDate) throw new ImportError(400, "AS_OF_REQUIRED", "Send asOfDate, or set the go-live date in the trial balance options");

  // Trial balance rows; income and expense accounts fold into retained earnings.
  const tbRows = await loadValidatedRows(tb.id);
  const byCode = new Map<string, { debit: number; credit: number }>();
  let foldedNet = 0;
  let foldedRows = 0;
  for (const row of tbRows as any[]) {
    const n = row.normalized as Record<string, any>;
    if (n.foldedIntoRetainedEarnings) {
      foldedNet += Number(n.debit) - Number(n.credit);
      foldedRows++;
      continue;
    }
    byCode.set(n.accountCode, { debit: Number(n.debit), credit: Number(n.credit) });
  }
  // Income and expense balances only belong in retained earnings when they are the CLOSED prior
  // years' result, i.e. the books open on the first day of a fiscal year. Mid-year, the year's
  // P&L to date has to be carried as P&L, which an opening entry cannot do.
  if (foldedRows > 0) {
    const { rows: fy } = await pool.query(`SELECT fiscal_year_start_month AS m FROM companies WHERE id = $1`, [companyId]);
    const month = Number(fy[0]?.m ?? 1);
    const goLive = options.goLiveDate ?? null;
    const [, mm, dd] = goLive ? goLive.split("-").map(Number) : [0, 0, 0];
    if (!goLive || dd !== 1 || mm !== month) {
      throw new ImportError(
        422,
        "GO_LIVE_MID_YEAR",
        `The trial balance contains income or expense accounts, so the go-live date must be the first day of your fiscal year (month ${month}). Go live on that date with a trial balance as at the prior year end, or remove the profit and loss rows and enter year-to-date figures as journals.`,
        { goLiveDate: goLive, fiscalYearStartMonth: month }
      );
    }
  }
  if (Math.abs(foldedNet) >= 0.005) {
    const { rows: re } = await pool.query(
      `SELECT code FROM accounts WHERE company_id = $1 AND type = 'equity' AND COALESCE(is_archived, false) = false AND (lower(name_en) LIKE '%retained%' OR code = '3020') ORDER BY (code = '3020') DESC, code LIMIT 1`,
      [companyId]
    );
    if (!re[0]) throw new ImportError(422, "RETAINED_EARNINGS_MISSING", "The chart has no retained earnings account to roll profit and loss into");
    const cur = byCode.get(re[0].code) ?? { debit: 0, credit: 0 };
    const net = cur.debit - cur.credit + foldedNet;
    byCode.set(re[0].code, { debit: net > 0 ? Math.round(net * 100) / 100 : 0, credit: net < 0 ? Math.round(-net * 100) / 100 : 0 });
  }
  const rows = Array.from(byCode, ([accountCode, v]) => ({ accountCode, debit: v.debit, credit: v.credit }));
  const totalDebit = Math.round(rows.reduce((s, r) => s + r.debit, 0) * 100) / 100;
  const totalCredit = Math.round(rows.reduce((s, r) => s + r.credit, 0) * 100) / 100;
  if (Math.abs(totalDebit - totalCredit) >= 0.005) {
    throw new ImportError(422, "TB_UNBALANCED", `The trial balance does not balance: debits ${totalDebit.toFixed(2)} against credits ${totalCredit.toFixed(2)}. A balancing plug would hide a mistake, so fix the file.`, {
      totalDebit,
      totalCredit,
      difference: Math.round((totalDebit - totalCredit) * 100) / 100,
    });
  }

  const docs = async (job: Job | null): Promise<OpeningDocInput[]> =>
    job ? ((await loadValidatedRows(job.id)) as any[]).map((r) => r.normalized as OpeningDocInput) : [];
  return {
    asOfDate,
    rows,
    invoices: await docs(inv),
    bills: await docs(bil),
    jobs: [tb, inv, bil].filter((j): j is Job => !!j),
    foldedPl: foldedNet,
    totalDebit,
    totalCredit,
  };
}

export async function previewOpening(companyId: string, body: Parameters<typeof gatherOpening>[1]) {
  const g = await gatherOpening(companyId, body);
  const preview = await previewOpeningBalance(companyId, { asOfDate: g.asOfDate, rows: g.rows, invoices: g.invoices, bills: g.bills });
  return { preview, summary: { asOfDate: g.asOfDate, accounts: g.rows.length, openInvoices: g.invoices.length, openBills: g.bills.length, foldedProfitAndLoss: Math.round(g.foldedPl * 100) / 100 } };
}

export async function commitOpening(companyId: string, body: Parameters<typeof gatherOpening>[1], user: { id: string; isAdmin?: boolean; firmRole?: string | null }, req?: Request) {
  // Lock the participating jobs in id order so two commits cannot interleave.
  const g = await gatherOpening(companyId, body);
  const ids = g.jobs.map((j) => j.id).sort();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(`SELECT id, status FROM import_jobs WHERE id = ANY($1) AND company_id = $2 ORDER BY id FOR UPDATE`, [ids, companyId]);
    if (locked.rows.some((r: any) => r.status !== "validated")) {
      await client.query("ROLLBACK");
      throw new ImportError(409, "IMPORT_ALREADY_COMMITTED", "One of these imports was already committed or is being committed");
    }
    await client.query(`UPDATE import_jobs SET status = 'committing' WHERE id = ANY($1)`, [ids]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  try {
    const result = await postOpeningBalance({
      user,
      companyId,
      input: { asOfDate: g.asOfDate, rows: g.rows, invoices: g.invoices, bills: g.bills },
      req,
    });
    await pool.query(`UPDATE import_jobs SET status = 'committed', committed_at = (now() AT TIME ZONE 'UTC'), result = $2::jsonb WHERE id = ANY($1)`, [
      ids,
      JSON.stringify({ openingBalanceId: (result as any).id, journalEntryId: (result as any).journalEntryId }),
    ]);
    await recordAudit({ userId: user.id, companyId, action: "import.commit_opening", entityType: "import_job", entityId: ids[0], after: { jobs: ids, asOfDate: g.asOfDate }, req });
    return { result, asOfDate: g.asOfDate, jobs: ids };
  } catch (err) {
    // Nothing was posted (postOpeningBalance is one transaction): the jobs go back to validated so the user can fix and retry.
    await pool.query(`UPDATE import_jobs SET status = 'validated' WHERE id = ANY($1)`, [ids]);
    if (err instanceof AppError) throw err;
    throw err;
  }
}
