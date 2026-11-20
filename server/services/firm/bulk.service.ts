/**
 * Cross-client bulk operations (W5-D, R15-07 / R15-16).
 *
 * One request contract for every /api/firm/bulk/* endpoint (docs/api/firm-bulk.md):
 *
 *   { companyIds?: uuid[1..500], period?: "YYYY-MM" | "YYYY-Qn" | "Qn YYYY" }
 *
 * - companyIds omitted → every client the caller may access (read endpoints);
 *   endpoints that create documents require it.
 * - any listed company outside the caller's scope → 403 BULK_COMPANY_FORBIDDEN
 *   with `rejectedCompanyIds`.
 * - period omitted → the current quarter.
 *
 * Bulk journal import: one CSV for many clients, validated per client, posted
 * through server/ledger (postJournal) with an idempotency key per entry, and
 * reported per row. Cross-client report pack: a zip of trial-balance workbooks.
 */
import ExcelJS from "exceljs";
import { zipSync, strToU8 } from "fflate";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { DomainError } from "../../errors";
import { postJournal } from "../../ledger";
import { trialBalance } from "../../reporting";
import { toFils, tryToFils } from "../../../shared/money";
import { accounts, companies } from "../../../shared/schema";
import { listAccessibleClientIds, type FirmContext } from "./scope";

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$|^(\d{4})-Q([1-4])$|^Q([1-4]) (\d{4})$/;

export const zBulkPeriod = z
  .string()
  .trim()
  .regex(PERIOD_RE, 'period must be "YYYY-MM", "YYYY-Qn" or "Qn YYYY"');

export const zBulkCompanyIds = z
  .array(z.string().guid("companyIds must contain client ids (uuid)"))
  .min(1, "companyIds must list at least one client")
  .max(500, "companyIds is limited to 500 clients per request");

/** The shared contract. Endpoints extend it with their own fields. */
export const bulkScopeSchema = z.object({
  companyIds: zBulkCompanyIds.optional(),
  period: zBulkPeriod.optional(),
});
export type BulkScope = z.output<typeof bulkScopeSchema>;

export interface ResolvedPeriod {
  label: string;
  start: string;
  end: string;
}

function lastDay(y: number, m1: number): string {
  return new Date(Date.UTC(y, m1, 0)).toISOString().slice(0, 10);
}

/** Normalise a contract period (default: current quarter). */
export function resolveBulkPeriod(period?: string, now: Date = new Date()): ResolvedPeriod {
  if (!period) {
    const q = Math.floor(now.getUTCMonth() / 3) + 1;
    return resolveBulkPeriod(`Q${q} ${now.getUTCFullYear()}`);
  }
  const m = PERIOD_RE.exec(period.trim());
  if (!m) throw new DomainError("BULK_VALIDATION_ERROR", 400, { period: ["invalid"] });
  if (m[1]) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return { label: `${m[1]}-${m[2]}`, start: `${m[1]}-${m[2]}-01`, end: lastDay(y, mo) };
  }
  const y = Number(m[3] ?? m[6]);
  const q = Number(m[4] ?? m[5]);
  const startMonth = (q - 1) * 3 + 1;
  return {
    label: `Q${q} ${y}`,
    start: `${y}-${String(startMonth).padStart(2, "0")}-01`,
    end: lastDay(y, startMonth + 2),
  };
}

/** Resolve the target clients of a bulk request against the caller's scope. */
export async function resolveBulkTargets(
  ctx: FirmContext,
  requested: string[] | undefined,
  opts: { required?: boolean } = {}
): Promise<string[]> {
  const accessible = await listAccessibleClientIds(ctx);
  if (!requested || requested.length === 0) {
    if (opts.required) {
      throw new DomainError("BULK_VALIDATION_ERROR", 400, {
        companyIds: ["companyIds must list at least one client"],
      });
    }
    return accessible;
  }
  const allowed = new Set(accessible);
  const rejected = requested.filter((id) => !allowed.has(id));
  if (rejected.length > 0) {
    throw new DomainError(
      "BULK_COMPANY_FORBIDDEN",
      403,
      { rejectedCompanyIds: rejected },
      `Access denied to company ${rejected[0]}`
    );
  }
  return [...new Set(requested)];
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const HEADER_ALIASES: Record<string, string> = {
  company: "company",
  company_id: "company",
  client: "company",
  client_id: "company",
  entry: "entry",
  entry_ref: "entry",
  reference: "entry",
  ref: "entry",
  date: "date",
  account: "account",
  account_code: "account",
  description: "description",
  memo: "description",
  debit: "debit",
  credit: "credit",
};

export interface JournalImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface JournalImportEntryResult {
  companyId: string | null;
  company: string;
  entryRef: string;
  status: "posted" | "replayed" | "invalid" | "failed" | "validated";
  entryId?: string;
  entryNumber?: string;
  rows: number[];
  errors: JournalImportRowError[];
}

interface ParsedLine {
  row: number;
  company: string;
  entry: string;
  date: string;
  account: string;
  description: string;
  debitFils: number;
  creditFils: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Import journal entries for many clients from one CSV. Columns (header row,
 * case-insensitive): company (client id or exact client name), entry_ref,
 * date (YYYY-MM-DD), account_code, description, debit, credit.
 *
 * Every entry is validated on its own (client in scope, accounts exist in that
 * client, one side per line, balanced to the fils); valid entries are posted
 * through the ledger kernel, invalid ones are reported and skipped. Re-running
 * the same file replays (idempotency key per firm/client/entry_ref).
 */
export async function importJournalsAcrossClients(
  ctx: FirmContext,
  csv: string,
  opts: { dryRun?: boolean; req?: import("express").Request } = {}
): Promise<{
  summary: { entries: number; posted: number; replayed: number; invalid: number; failed: number };
  entries: JournalImportEntryResult[];
  rowErrors: JournalImportRowError[];
}> {
  const table = parseCsv(csv);
  if (table.length < 2) {
    throw new DomainError("BULK_VALIDATION_ERROR", 400, {
      csv: ["CSV needs a header row and at least one line"],
    });
  }
  if (table.length > 5001) {
    throw new DomainError("BULK_VALIDATION_ERROR", 400, { csv: ["CSV is limited to 5,000 lines"] });
  }
  const header = table[0].map(
    (h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/\s+/g, "_")] ?? ""
  );
  for (const required of ["company", "entry", "date", "account", "debit", "credit"]) {
    if (!header.includes(required)) {
      throw new DomainError("BULK_VALIDATION_ERROR", 400, {
        csv: [`Missing column "${required}"`],
      });
    }
  }
  const col = (r: string[], name: string) => (r[header.indexOf(name)] ?? "").trim();

  const rowErrors: JournalImportRowError[] = [];
  const lines: ParsedLine[] = [];
  table.slice(1).forEach((r, i) => {
    const row = i + 2; // spreadsheet row number (header is row 1)
    const debitRaw = col(r, "debit");
    const creditRaw = col(r, "credit");
    const debitFils = debitRaw === "" ? 0 : tryToFils(debitRaw.replace(/,/g, ""));
    const creditFils = creditRaw === "" ? 0 : tryToFils(creditRaw.replace(/,/g, ""));
    const errs: JournalImportRowError[] = [];
    if (!col(r, "company")) errs.push({ row, field: "company", message: "Company is required" });
    if (!col(r, "entry"))
      errs.push({ row, field: "entry_ref", message: "Entry reference is required" });
    if (!DATE_RE.test(col(r, "date")))
      errs.push({ row, field: "date", message: "Date must be YYYY-MM-DD" });
    if (!col(r, "account"))
      errs.push({ row, field: "account_code", message: "Account code is required" });
    if (debitFils === null || debitFils < 0)
      errs.push({
        row,
        field: "debit",
        message: "Debit must be a positive amount with at most 2 decimals",
      });
    if (creditFils === null || creditFils < 0)
      errs.push({
        row,
        field: "credit",
        message: "Credit must be a positive amount with at most 2 decimals",
      });
    if (debitFils !== null && creditFils !== null && debitFils > 0 === creditFils > 0) {
      errs.push({ row, field: "debit", message: "Each line needs exactly one of debit or credit" });
    }
    lines.push({
      row,
      company: col(r, "company"),
      entry: col(r, "entry"),
      date: col(r, "date"),
      account: col(r, "account"),
      description: col(r, "description"),
      debitFils: debitFils ?? 0,
      creditFils: creditFils ?? 0,
    });
    rowErrors.push(...errs);
  });

  // Resolve companies within scope: by id, or by exact (case-insensitive) client name.
  const accessible = await listAccessibleClientIds(ctx);
  const clientRows = accessible.length
    ? ((await db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(inArray(companies.id, accessible))) as Array<{ id: string; name: string }>)
    : [];
  const byId = new Map(clientRows.map((c) => [c.id.toLowerCase(), c]));
  const byName = new Map(clientRows.map((c) => [c.name.trim().toLowerCase(), c]));
  const resolveCompany = (ref: string) =>
    byId.get(ref.toLowerCase()) ?? byName.get(ref.toLowerCase()) ?? null;

  const groups = new Map<string, ParsedLine[]>();
  for (const l of lines) {
    const key = `${l.company.toLowerCase()}\u0000${l.entry}`;
    const g = groups.get(key) ?? [];
    g.push(l);
    groups.set(key, g);
  }

  const accountCache = new Map<string, Map<string, string>>();
  async function accountMap(companyId: string) {
    let m = accountCache.get(companyId);
    if (!m) {
      const rows = (await db
        .select({ id: accounts.id, code: accounts.code })
        .from(accounts)
        .where(and(eq(accounts.companyId, companyId), eq(accounts.isActive, true)))) as Array<{
        id: string;
        code: string;
      }>;
      m = new Map(rows.map((a) => [a.code, a.id]));
      accountCache.set(companyId, m);
    }
    return m;
  }

  const results: JournalImportEntryResult[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const rowsInGroup = group.map((l) => l.row);
    const errors: JournalImportRowError[] = rowErrors.filter((e) => rowsInGroup.includes(e.row));
    const company = resolveCompany(first.company);
    if (!company) {
      errors.push({ row: first.row, field: "company", message: "Client not found in your firm" });
    }
    if (group.some((l) => l.date !== first.date)) {
      errors.push({
        row: first.row,
        field: "date",
        message: "All lines of an entry must share one date",
      });
    }
    if (company) {
      const map = await accountMap(company.id);
      for (const l of group) {
        if (l.account && !map.has(l.account)) {
          errors.push({
            row: l.row,
            field: "account_code",
            message: `Account ${l.account} not found for ${company.name}`,
          });
        }
      }
    }
    const debit = group.reduce((a, l) => a + l.debitFils, 0);
    const credit = group.reduce((a, l) => a + l.creditFils, 0);
    if (group.length < 2) {
      errors.push({ row: first.row, message: "An entry needs at least two lines" });
    } else if (debit !== credit) {
      errors.push({
        row: first.row,
        message: `Entry is not balanced: debits ${(debit / 100).toFixed(2)} vs credits ${(credit / 100).toFixed(2)}`,
      });
    }
    const base: JournalImportEntryResult = {
      companyId: company?.id ?? null,
      company: company?.name ?? first.company,
      entryRef: first.entry,
      status: "invalid",
      rows: rowsInGroup,
      errors,
    };
    if (errors.length > 0 || !company) {
      results.push(base);
      continue;
    }
    if (opts.dryRun) {
      results.push({ ...base, status: "validated" });
      continue;
    }
    const map = await accountMap(company.id);
    try {
      const posted = await postJournal(
        {
          companyId: company.id,
          date: first.date,
          memo: first.description || `Bulk import ${first.entry}`,
          source: "firm_bulk_import",
          reference: first.entry,
          idempotencyKey: `firm-bulk:${ctx.firmId}:${company.id}:${first.entry}`,
          status: "posted",
          lines: group.map((l) => ({
            accountId: map.get(l.account)!,
            debitFils: l.debitFils > 0 ? l.debitFils : undefined,
            creditFils: l.creditFils > 0 ? l.creditFils : undefined,
            description: l.description || null,
          })),
        },
        { actorId: ctx.userId, req: opts.req, audit: true }
      );
      results.push({
        ...base,
        status: posted.replayed ? "replayed" : "posted",
        entryId: posted.entry.id,
        entryNumber: posted.entry.entryNumber,
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      results.push({
        ...base,
        status: "failed",
        errors: [
          {
            row: first.row,
            message: `${e.code ?? "POST_FAILED"}: ${e.message ?? "posting failed"}`,
          },
        ],
      });
    }
  }

  const count = (s: JournalImportEntryResult["status"]) =>
    results.filter((r) => r.status === s).length;
  return {
    summary: {
      entries: results.length,
      posted: count("posted"),
      replayed: count("replayed"),
      invalid: count("invalid"),
      failed: count("failed"),
    },
    entries: results,
    rowErrors,
  };
}

// ─── Cross-client report pack ────────────────────────────────────────────────

/** Zip of one trial-balance workbook per client for the period. */
export async function buildReportPack(
  ctx: FirmContext,
  companyIds: string[],
  period: ResolvedPeriod
): Promise<{ zip: Uint8Array; files: string[] }> {
  void ctx;
  const rows = (await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(inArray(companies.id, companyIds))) as Array<{ id: string; name: string }>;
  const files: Record<string, Uint8Array> = {};
  const index: string[] = ["client,company_id,file,balanced,total_debits,total_credits"];
  for (const c of rows.sort((a, b) => a.name.localeCompare(b.name))) {
    const tb = await trialBalance({ companyId: c.id, from: period.start, to: period.end });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Trial balance");
    ws.addRow([c.name]);
    ws.addRow([`Trial balance ${period.start} to ${period.end} (${tb.reportCurrency})`]);
    ws.addRow([]);
    ws.addRow(["Code", "Account", "Type", "Debit", "Credit"]);
    for (const r of tb.rows) {
      if (r.debitBalance === 0 && r.creditBalance === 0) continue;
      ws.addRow([r.accountCode, r.accountName, r.accountType, r.debitBalance, r.creditBalance]);
    }
    ws.addRow(["", "Total", "", tb.totals.sumDebitBalances, tb.totals.sumCreditBalances]);
    const safe = c.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60) || c.id;
    const file = `${safe}-${c.id.slice(0, 8)}-trial-balance.xlsx`;
    files[file] = new Uint8Array(await wb.xlsx.writeBuffer());
    index.push(
      [
        JSON.stringify(c.name),
        c.id,
        file,
        tb.isBalanced,
        tb.totals.sumDebitBalances,
        tb.totals.sumCreditBalances,
      ].join(",")
    );
  }
  files["index.csv"] = strToU8(index.join("\n") + "\n");
  return { zip: zipSync(files), files: Object.keys(files) };
}

/** Exposed for tests: fils parse with the import's rules. */
export function importAmountFils(raw: string): number | null {
  if (raw.trim() === "") return 0;
  try {
    return toFils(raw.replace(/,/g, ""));
  } catch {
    return null;
  }
}
