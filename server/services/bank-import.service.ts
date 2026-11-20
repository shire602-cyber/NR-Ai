import { storage } from "../storage";
import { db } from "../db";
import { createLogger } from "../config/logger";
import { DomainError, errorMessage } from "../errors";
import { bankImportBatches, type BankTransaction } from "../../shared/schema";
import { filsToNumber, tryToFils } from "../../shared/money";
import { parseIsoDate } from "../../shared/validators/primitives";
import {
  importSourceFor,
  parseBankCsvText,
  parseBankOfx,
  planBankImport,
  type BankFileKind,
  type ImportPlan,
  type ParsedBankRow,
} from "./bank-statement-parser.service";
import {
  continuityWarning,
  dbFils,
  previousClosingBalanceFils,
} from "./bank-reconciliation.service";

const log = createLogger("bank-import");

export interface ParsedTransaction {
  transactionDate: Date;
  description: string;
  amount: number; // positive = credit, negative = debit
  reference?: string;
}

function toParsedTransactions(rows: ParsedBankRow[]): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  for (const row of rows) {
    if (row.errors.length > 0 || !row.date) {
      log.warn({ row: row.rowIndex, errors: row.errors }, "Skipping malformed statement row");
      continue;
    }
    out.push({
      transactionDate: row.date,
      description: row.description,
      amount: row.amount,
      reference: row.reference ?? undefined,
    });
  }
  return out;
}

/**
 * Parse a CSV bank statement into structured transactions.
 * Delegates to the shared parser (bank-statement-parser.service.ts) so header detection, locale
 * handling and date validation behave exactly like the statement import endpoint.
 */
export async function parseCSVBankStatement(
  csvContent: string,
  _bankName?: string
): Promise<ParsedTransaction[]> {
  const result = parseBankCsvText(csvContent);
  if (result.rows.length === 0 && result.ignored.length === 0) {
    throw new Error("CSV file must contain a header row and at least one data row");
  }
  return toParsedTransactions(result.rows);
}

/**
 * Parse OFX (Open Financial Exchange) bank statement.
 * Handles basic OFX/QFX format used by many banks.
 */
export async function parseOFXStatement(ofxContent: string): Promise<ParsedTransaction[]> {
  return toParsedTransactions(parseBankOfx(ofxContent).rows);
}

/**
 * Import parsed transactions into the database.
 * Identical rows inside one batch are all kept; rows the account already has (same date, amount,
 * description and reference) are skipped one-for-one, so re-importing a batch is idempotent.
 */
export async function importBankStatement(
  companyId: string,
  connectionId: string,
  parsedTransactions: ParsedTransaction[],
  opts: { bankAccountId?: string | null; actorId?: string | null } = {}
): Promise<{ imported: number; duplicates: number; errors: string[] }> {
  // W3-C (R06-01/R06-12): rows land on the connection's managed bank account so they can be
  // reconciled; the GL account is resolved from that account at reconcile time.
  const bankAccount = opts.bankAccountId
    ? await storage.getBankAccountById(opts.bankAccountId, companyId)
    : undefined;
  const existing = (await storage.getBankTransactionsByCompanyId(companyId)).filter((t) =>
    bankAccount ? t.bankStatementAccountId === bankAccount.id : t.bankConnectionId === connectionId
  );

  const rows: ParsedBankRow[] = parsedTransactions.map((tx, index) => ({
    rowIndex: index + 1,
    raw: `${tx.transactionDate.toISOString().slice(0, 10)} ${tx.description} ${tx.amount}`,
    date: tx.transactionDate,
    description: tx.description,
    debit: tx.amount < 0 ? Math.abs(tx.amount) : 0,
    credit: tx.amount > 0 ? tx.amount : 0,
    amount: tx.amount,
    balance: null,
    reference: tx.reference ?? null,
    errors: [],
  }));

  const plan = planBankImport(
    rows,
    existing.map((t) => ({
      date: t.transactionDate,
      amount: Number(t.amount),
      description: t.description,
      reference: t.reference,
      importSource: t.importSource,
    })),
    { fileFingerprint: "", kind: "csv" }
  );

  let imported = 0;
  const errors: string[] = [];

  for (const row of plan.toInsert) {
    try {
      await storage.createBankTransaction({
        companyId,
        transactionDate: row.date as Date,
        description: row.description,
        amount: row.amount,
        reference: row.reference,
        importSource: "csv",
        bankConnectionId: connectionId,
        bankStatementAccountId: bankAccount?.id ?? null,
        bankAccountId: bankAccount?.glAccountId ?? null,
        isReconciled: false,
      });
      imported++;
    } catch (err: unknown) {
      errors.push(`Row: ${row.description} — ${errorMessage(err)}`);
    }
  }
  const duplicates = plan.skipped.filter((s) => s.reason !== "invalid_row").length;

  // Update connection sync time
  await storage.updateBankConnection(connectionId, {
    lastSyncedAt: new Date(),
  });

  log.info(
    { companyId, connectionId, imported, duplicates, errors: errors.length },
    "Bank statement import complete"
  );

  return { imported, duplicates, errors };
}

// ─── W3-C: one import pipeline for statement files, AI/PDF rows and feeds ──────

export interface ImportStatementRowsInput {
  companyId: string;
  bankAccountId: string;
  rows: ParsedBankRow[];
  kind: BankFileKind;
  fileFingerprint: string;
  /** Stored on each row (e.g. "csv:<fp>", "pdf_ai:<fp>"). Default importSourceFor(kind, fp). */
  importSource?: string;
  source: string;
  fileName?: string | null;
  format?: string | null;
  actorId: string;
  allowDuplicates?: boolean;
}

export interface ImportStatementRowsResult {
  batchId: string | null;
  imported: BankTransaction[];
  plan: ImportPlan;
  continuityWarning: string | null;
}

/**
 * Dedupe against the account's existing rows (planBankImport), insert the new rows tagged with
 * an import batch (history + undo), and check opening-balance continuity (R06-12, R06-22).
 */
export async function importStatementRows(
  input: ImportStatementRowsInput
): Promise<ImportStatementRowsResult> {
  const bankAccount = await storage.getBankAccountById(input.bankAccountId, input.companyId);
  if (!bankAccount)
    throw new DomainError("BANK_ACCOUNT_NOT_FOUND", 404, undefined, "Bank account not found");
  const existing = (await storage.getBankTransactionsByCompanyId(input.companyId)).filter(
    (t) => t.bankStatementAccountId === bankAccount.id
  );
  const plan = planBankImport(
    input.rows,
    existing.map((t) => ({
      date: t.transactionDate,
      amount: Number(t.amount),
      description: t.description,
      reference: t.reference,
      importSource: t.importSource,
    })),
    {
      fileFingerprint: input.fileFingerprint,
      kind: input.kind,
      allowDuplicates: Boolean(input.allowDuplicates),
    }
  );

  // Continuity: the first new row's running balance must follow the last known balance.
  const ordered = [...plan.toInsert].sort(
    (a, b) => (a.date as Date).getTime() - (b.date as Date).getTime() || a.rowIndex - b.rowIndex
  );
  const first = ordered[0];
  let previous = first
    ? await previousClosingBalanceFils(input.companyId, bankAccount.id, first.date as Date)
    : null;
  if (previous === null && first && existing.length === 0 && bankAccount.openingBalanceDate) {
    previous = dbFils(bankAccount.openingBalance);
  }
  const warning = continuityWarning({
    previousBalanceFils: previous,
    firstRow: first
      ? {
          amountFils: dbFils(first.amount),
          balanceFils: first.balance === null ? null : dbFils(first.balance),
        }
      : null,
  });

  if (plan.toInsert.length === 0) {
    return { batchId: null, imported: [], plan, continuityWarning: warning };
  }
  const [batch] = await db
    .insert(bankImportBatches)
    .values({
      companyId: input.companyId,
      bankAccountId: bankAccount.id,
      source: input.source,
      fileName: input.fileName ?? null,
      fileFingerprint: input.fileFingerprint,
      format: input.format ?? null,
      rowCount: input.rows.length,
      importedCount: plan.toInsert.length,
      skippedCount: plan.skipped.length,
      continuityWarning: warning,
      createdBy: input.actorId,
    })
    .returning();
  const importSource = input.importSource ?? importSourceFor(input.kind, input.fileFingerprint);
  const imported = await storage.bulkCreateBankTransactions(
    plan.toInsert.map((row) => ({
      companyId: input.companyId,
      // Cached copy of the account's current GL link; reconcile resolves it again (R06-01).
      bankAccountId: bankAccount.glAccountId ?? null,
      bankStatementAccountId: bankAccount.id,
      transactionDate: row.date as Date,
      description: row.description,
      amount: row.amount,
      balance: row.balance,
      reference: row.reference,
      category: null,
      matchStatus: "unmatched",
      isReconciled: false,
      importSource,
      importBatchId: batch.id,
    }))
  );
  return { batchId: batch.id, imported, plan, continuityWarning: warning };
}

function cleanNumber(v: number | string): number | string {
  return typeof v === "string" ? v.trim().replace(/,/g, "") : v;
}

/**
 * AI/PDF extracted rows -> parser row shape. Strict: a bad date, a non-numeric or >2dp amount or
 * an empty description becomes a row error (never NaN, never a guess) (R06-12).
 */
export function aiRowsToParsedRows(
  rows: Array<{
    date: string;
    description: string;
    amount: number | string;
    reference?: string | null;
    balance?: number | string | null;
  }>
): ParsedBankRow[] {
  return rows.map((r, i) => {
    const errors: string[] = [];
    const iso = parseIsoDate(String(r.date ?? "").trim());
    if (!iso) errors.push(`Invalid date "${String(r.date).slice(0, 40)}" (expected YYYY-MM-DD)`);
    const fils = tryToFils(cleanNumber(r.amount));
    if (fils === null) errors.push(`Invalid amount "${String(r.amount).slice(0, 40)}"`);
    else if (fils === 0) errors.push("Amount is zero");
    let balance: number | null = null;
    if (r.balance !== null && r.balance !== undefined && r.balance !== "") {
      const b = tryToFils(cleanNumber(r.balance));
      if (b === null) errors.push(`Invalid balance "${String(r.balance).slice(0, 40)}"`);
      else balance = filsToNumber(b);
    }
    const description = String(r.description ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    if (!description) errors.push("Description is empty");
    const amount = fils === null ? 0 : filsToNumber(fils);
    return {
      rowIndex: i + 1,
      raw: `${r.date} ${r.description} ${r.amount}`.slice(0, 500),
      date: iso ? new Date(`${iso}T00:00:00.000Z`) : null,
      description,
      debit: amount < 0 ? Math.abs(amount) : 0,
      credit: amount > 0 ? amount : 0,
      amount,
      balance,
      reference: r.reference ? String(r.reference).trim().slice(0, 120) || null : null,
      errors,
    };
  });
}
