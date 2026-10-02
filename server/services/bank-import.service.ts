// ONE path for every statement line that enters bank_transactions: an uploaded CSV / OFX / MT940 / CAMT.053 file,
// a committed PDF review grid, or a bank-feed sync. Parsing happens elsewhere (bank-statement-parsers); this module
// validates the file against the bank account, de-duplicates (bank-dedupe.ts) and inserts under the account's import
// lock so two uploads of one file cannot both think a line is new.

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  bankStatementImports,
  bankTransactions,
  type BankAccount,
  type BankStatementImport,
} from "../../shared/schema";
import { AppError } from "../errors";
import { createLogger } from "../config/logger";
import { storage } from "../storage";
import { dedupeKey, planBankInsert } from "./bank-dedupe";
import { LOCK_NS, withDocumentLock } from "./document-lock";
import { recordStoredFile } from "./document-upload.service";
import { saveDocument } from "./fileStorage";
import {
  parseStatement,
  StatementParseError,
  type ParsedStatement,
  type ParsedStatementLine,
  type RequestedFormat,
} from "./bank-statement-parsers";
import { looksLikeIban, sameAccountId } from "./bank-statement-parsers/numbers";

const log = createLogger("bank-import");

export type ImportSource = "csv" | "ofx" | "mt940" | "camt053" | "pdf" | "feed";

export const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;
export const MAX_COMMIT_ROWS = 2000;

export interface StatementSummary {
  from: string | null;
  to: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  currency: string | null;
}

export interface ImportOutcome {
  importId: string;
  format: ImportSource;
  imported: number;
  duplicates: number;
  skippedDuplicates: number;
  statement: StatementSummary;
  warnings: string[];
  insertedIds: string[];
}

const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export function unprocessable(code: string, message: string, details?: unknown): AppError {
  return new AppError({ message, statusCode: 422, code, details });
}

/** Parse a text statement; a parser refusal becomes 422 STATEMENT_PARSE_ERROR with the line or tag at fault. */
export function parseStatementOrThrow(content: string, format: RequestedFormat): ParsedStatement {
  if (Buffer.byteLength(content, "utf8") > MAX_STATEMENT_BYTES) {
    throw new AppError({ message: "The statement file is larger than 5 MB.", statusCode: 413, code: "STATEMENT_TOO_LARGE" });
  }
  try {
    return parseStatement(content, format);
  } catch (err) {
    if (err instanceof StatementParseError) {
      throw unprocessable("STATEMENT_PARSE_ERROR", err.message, err.where);
    }
    throw err;
  }
}

/** The file must belong to the bank account it is uploaded to (currency, IBAN). */
export function assertStatementMatchesAccount(parsed: Pick<ParsedStatement, "currency" | "accountId">, account: BankAccount): string[] {
  const warnings: string[] = [];
  const currency = (account.currency || "AED").toUpperCase();
  if (parsed.currency && parsed.currency.toUpperCase() !== currency) {
    throw unprocessable(
      "STATEMENT_CURRENCY_MISMATCH",
      `The statement is in ${parsed.currency.toUpperCase()} but this bank account is in ${currency}.`
    );
  }
  if (parsed.accountId && looksLikeIban(parsed.accountId)) {
    if (account.iban && looksLikeIban(account.iban)) {
      if (!sameAccountId(parsed.accountId, account.iban)) {
        throw unprocessable("STATEMENT_ACCOUNT_MISMATCH", "The statement is for a different account (IBAN) than the one selected.");
      }
    } else {
      warnings.push("This bank account has no IBAN on file, so the statement's account could not be checked.");
    }
  }
  return warnings;
}

interface InsertArgs {
  companyId: string;
  userId: string | null;
  account: BankAccount;
  source: ImportSource;
  lines: ParsedStatementLine[];
  summary: StatementSummary;
  filename?: string | null;
  parser?: string | null;
  storedFileKey?: string | null;
  warnings?: string[];
  /** An existing staged import row to finish (PDF commit); otherwise a new committed row is written. */
  stagedImportId?: string | null;
}

/** Count-and-insert under the bank account's import lock. */
export async function insertStatementLines(args: InsertArgs): Promise<ImportOutcome> {
  const { companyId, account, lines } = args;
  const warnings = [...(args.warnings ?? [])];

  const usable = lines.filter((l) => {
    if (!Number.isFinite(l.amount) || Math.abs(l.amount) < 0.005) {
      warnings.push(`A zero-amount line on ${ymd(l.date)} was skipped.`);
      return false;
    }
    return true;
  });
  if (usable.length === 0) throw unprocessable("STATEMENT_EMPTY", "The statement has no transactions to import.");

  const keys = Array.from(new Set(usable.map((l) => dedupeKey(l.date, l.amount))));
  const ids = Array.from(new Set(usable.map((l) => l.externalId).filter((v): v is string => !!v)));

  return await withDocumentLock(account.id, LOCK_NS.BANK_ACCOUNT_IMPORT, async (tx) => {
    const filter = ids.length
      ? sql`(${bankTransactions.dedupeKey} IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)}) OR ${bankTransactions.externalId} IN (${sql.join(ids.map((k) => sql`${k}`), sql`, `)}))`
      : sql`${bankTransactions.dedupeKey} IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`;
    const existing = await tx
      .select({ dedupeKey: bankTransactions.dedupeKey, externalId: bankTransactions.externalId })
      .from(bankTransactions)
      .where(and(eq(bankTransactions.companyId, companyId), eq(bankTransactions.bankStatementAccountId, account.id), filter));

    const plan = planBankInsert(existing, usable);

    const [importRow] = args.stagedImportId
      ? await tx
          .update(bankStatementImports)
          .set({
            status: "committed",
            committedAt: new Date(),
            rowCount: usable.length,
            importedCount: plan.insert.length,
            duplicateCount: plan.duplicates.length,
            stagedRows: null,
            warnings,
            openingBalance: args.summary.openingBalance,
            closingBalance: args.summary.closingBalance,
            statementFrom: args.summary.from,
            statementTo: args.summary.to,
          })
          .where(and(eq(bankStatementImports.id, args.stagedImportId), eq(bankStatementImports.companyId, companyId)))
          .returning()
      : await tx
          .insert(bankStatementImports)
          .values({
            companyId,
            bankAccountId: account.id,
            source: args.source,
            status: "committed",
            storedFileKey: args.storedFileKey ?? null,
            filename: args.filename ?? null,
            parser: args.parser ?? args.source,
            currency: args.summary.currency ?? account.currency,
            statementFrom: args.summary.from,
            statementTo: args.summary.to,
            openingBalance: args.summary.openingBalance,
            closingBalance: args.summary.closingBalance,
            rowCount: usable.length,
            importedCount: plan.insert.length,
            duplicateCount: plan.duplicates.length,
            warnings,
            createdBy: args.userId,
            committedAt: new Date(),
          })
          .returning();

    const rows = plan.insert.map((i) => {
      const l = usable[i];
      return {
        companyId,
        bankAccountId: account.glAccountId ?? null,
        bankStatementAccountId: account.id,
        transactionDate: l.date,
        valueDate: ymd(l.valueDate),
        description: l.description.slice(0, 500),
        amount: l.amount,
        balance: l.balance,
        reference: l.reference ? l.reference.slice(0, 120) : null,
        externalId: l.externalId,
        dedupeKey: dedupeKey(l.date, l.amount),
        importId: importRow.id,
        category: null,
        matchStatus: "unmatched",
        isReconciled: false,
        importSource: args.source,
      };
    });
    const inserted = rows.length ? await tx.insert(bankTransactions).values(rows).returning({ id: bankTransactions.id }) : [];

    return {
      importId: importRow.id,
      format: args.source,
      imported: inserted.length,
      duplicates: plan.duplicates.length,
      skippedDuplicates: plan.duplicates.length,
      statement: args.summary,
      warnings,
      insertedIds: inserted.map((r: { id: string }) => r.id),
    };
  });
}

/** Keep the uploaded file (FTA record keeping). A storage outage must not block the import: it becomes a warning. */
export async function keepStatementFile(args: {
  companyId: string;
  userId: string | null;
  filename: string;
  content: string | Buffer;
  contentType: string;
}): Promise<{ key: string | null; warning?: string }> {
  try {
    const buffer = typeof args.content === "string" ? Buffer.from(args.content, "utf8") : args.content;
    const saved = await saveDocument({
      companyId: args.companyId,
      category: "bank-statements",
      filename: args.filename,
      contentType: args.contentType,
      buffer,
    });
    await recordStoredFile({
      companyId: args.companyId,
      key: saved.key,
      category: "bank-statements",
      filename: args.filename,
      contentType: args.contentType,
      sizeBytes: saved.sizeBytes,
      uploadedBy: args.userId,
    });
    return { key: saved.key };
  } catch (err) {
    log.warn({ err: (err as Error).message, companyId: args.companyId }, "Statement file could not be stored");
    return { key: null, warning: "STATEMENT_FILE_NOT_STORED: the transactions were imported but the original file could not be kept." };
  }
}

const CONTENT_TYPES: Record<string, string> = {
  csv: "text/csv",
  ofx: "application/x-ofx",
  mt940: "text/plain",
  camt053: "application/xml",
  pdf: "application/pdf",
};

/** Import an uploaded text statement end to end. */
export async function importStatementFile(args: {
  companyId: string;
  userId: string;
  account: BankAccount;
  content: string;
  fileName?: string | null;
  format: RequestedFormat;
}): Promise<ImportOutcome> {
  const parsed = parseStatementOrThrow(args.content, args.format);
  const accountWarnings = assertStatementMatchesAccount(parsed, args.account);
  if (parsed.lines.length === 0) throw unprocessable("STATEMENT_EMPTY", "The statement has no transactions.");

  const format = parsed.format as ImportSource;
  const stored = await keepStatementFile({
    companyId: args.companyId,
    userId: args.userId,
    filename: args.fileName?.trim() || `statement.${format === "camt053" ? "xml" : format === "mt940" ? "sta" : format}`,
    content: args.content,
    contentType: CONTENT_TYPES[format] ?? "text/plain",
  });

  return await insertStatementLines({
    companyId: args.companyId,
    userId: args.userId,
    account: args.account,
    source: format,
    lines: parsed.lines,
    summary: {
      from: ymd(parsed.statementFrom),
      to: ymd(parsed.statementTo),
      openingBalance: parsed.openingBalance,
      closingBalance: parsed.closingBalance,
      currency: parsed.currency ?? args.account.currency,
    },
    filename: args.fileName ?? null,
    parser: format,
    storedFileKey: stored.key,
    warnings: [...parsed.warnings, ...accountWarnings, ...(stored.warning ? [stored.warning] : [])],
  });
}

// ─── PDF: staged, reviewed, then committed ───────────────────────────────────

export interface StagedRow {
  date: string;
  valueDate?: string | null;
  description: string;
  reference: string | null;
  amount: number;
  balance: number | null;
  issues?: string[];
}

export async function createStagedImport(args: {
  companyId: string;
  userId: string;
  account: BankAccount;
  filename: string;
  parser: "text" | "ai";
  rows: StagedRow[];
  summary: StatementSummary;
  storedFileKey: string | null;
  warnings: string[];
}): Promise<BankStatementImport> {
  const [row] = await db
    .insert(bankStatementImports)
    .values({
      companyId: args.companyId,
      bankAccountId: args.account.id,
      source: "pdf",
      status: "staged",
      storedFileKey: args.storedFileKey,
      filename: args.filename,
      parser: args.parser,
      currency: args.summary.currency ?? args.account.currency,
      statementFrom: args.summary.from,
      statementTo: args.summary.to,
      openingBalance: args.summary.openingBalance,
      closingBalance: args.summary.closingBalance,
      rowCount: args.rows.length,
      stagedRows: args.rows,
      warnings: args.warnings,
      createdBy: args.userId,
    })
    .returning();
  return row;
}

export async function getImport(companyId: string, importId: string): Promise<BankStatementImport | undefined> {
  const [row] = await db
    .select()
    .from(bankStatementImports)
    .where(and(eq(bankStatementImports.id, importId), eq(bankStatementImports.companyId, companyId)));
  return row;
}

export async function listImports(companyId: string, bankAccountId?: string): Promise<Array<Omit<BankStatementImport, "stagedRows">>> {
  const rows = await db
    .select()
    .from(bankStatementImports)
    .where(
      bankAccountId
        ? and(eq(bankStatementImports.companyId, companyId), eq(bankStatementImports.bankAccountId, bankAccountId))
        : eq(bankStatementImports.companyId, companyId)
    )
    .orderBy(desc(bankStatementImports.createdAt))
    .limit(200);
  return rows.map((row: BankStatementImport) => {
    const { stagedRows: _staged, ...rest } = row;
    return rest;
  });
}

function toLine(row: StagedRow, index: number): ParsedStatementLine {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? new Date(`${row.date}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== row.date) {
    throw unprocessable("STATEMENT_ROW_INVALID", `Row ${index + 1}: the date must be a real YYYY-MM-DD date.`, { row: index + 1 });
  }
  if (typeof row.amount !== "number" || !Number.isFinite(row.amount) || Math.abs(row.amount) < 0.005) {
    throw unprocessable("STATEMENT_ROW_INVALID", `Row ${index + 1}: the amount must be a non-zero number.`, { row: index + 1 });
  }
  const description = (row.description ?? "").trim();
  if (!description) throw unprocessable("STATEMENT_ROW_INVALID", `Row ${index + 1}: the description is empty.`, { row: index + 1 });
  const valueDate = row.valueDate && /^\d{4}-\d{2}-\d{2}$/.test(row.valueDate) ? new Date(`${row.valueDate}T00:00:00Z`) : null;
  return {
    date,
    valueDate,
    amount: Math.round(row.amount * 100) / 100,
    description,
    reference: row.reference?.trim() || null,
    externalId: null,
    balance: typeof row.balance === "number" && Number.isFinite(row.balance) ? row.balance : null,
  };
}

/** Commit the reviewed rows of a staged PDF import. 409 IMPORT_NOT_STAGED when it was already committed or discarded. */
export async function commitStagedImport(args: {
  companyId: string;
  userId: string;
  importId: string;
  rows: StagedRow[];
}): Promise<ImportOutcome> {
  const staged = await getImport(args.companyId, args.importId);
  if (!staged) throw new AppError({ message: "Import not found", statusCode: 404, code: "IMPORT_NOT_FOUND" });
  if (staged.status !== "staged") {
    throw new AppError({ message: "This import is not waiting for review.", statusCode: 409, code: "IMPORT_NOT_STAGED" });
  }
  if (args.rows.length === 0) throw unprocessable("STATEMENT_EMPTY", "Nothing to commit: every row was excluded.");
  if (args.rows.length > MAX_COMMIT_ROWS) {
    throw unprocessable("STATEMENT_TOO_MANY_ROWS", `A statement import takes at most ${MAX_COMMIT_ROWS} rows.`);
  }
  const account = await storage.getBankAccountById(staged.bankAccountId);
  if (!account || account.companyId !== args.companyId) {
    throw new AppError({ message: "Bank account not found", statusCode: 404, code: "BANK_ACCOUNT_NOT_FOUND" });
  }
  const lines = args.rows.map(toLine);
  const times = lines.map((l) => l.date.getTime());

  // The rows decide the period; the balances the person confirmed in the grid are the staged ones.
  return await insertStatementLines({
    companyId: args.companyId,
    userId: args.userId,
    account,
    source: "pdf",
    lines,
    summary: {
      from: ymd(new Date(Math.min(...times))),
      to: ymd(new Date(Math.max(...times))),
      openingBalance: staged.openingBalance ?? null,
      closingBalance: staged.closingBalance ?? null,
      currency: staged.currency ?? account.currency,
    },
    warnings: Array.isArray(staged.warnings) ? (staged.warnings as string[]) : [],
    stagedImportId: staged.id,
  });
}

export async function discardStagedImport(companyId: string, importId: string): Promise<void> {
  const res = await db
    .update(bankStatementImports)
    .set({ status: "discarded", stagedRows: null })
    .where(
      and(
        eq(bankStatementImports.id, importId),
        eq(bankStatementImports.companyId, companyId),
        eq(bankStatementImports.status, "staged")
      )
    )
    .returning({ id: bankStatementImports.id });
  if (res.length === 0) {
    const row = await getImport(companyId, importId);
    if (!row) throw new AppError({ message: "Import not found", statusCode: 404, code: "IMPORT_NOT_FOUND" });
    throw new AppError({ message: "This import is not waiting for review.", statusCode: 409, code: "IMPORT_NOT_STAGED" });
  }
}

