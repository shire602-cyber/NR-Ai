import { and, eq, isNull } from "drizzle-orm";
import { db, type AppDatabase } from "../db";
import { DomainError } from "../errors";
import {
  bankAccounts,
  bankConnections,
  bankImportBatches,
  bankTransactions,
  type BankAccount,
  type BankTransaction,
} from "../../shared/schema";
import { filsToNumber, tryToFils } from "../../shared/money";
import { parseIsoDate } from "../../shared/validators/primitives";
import {
  decodeStatementBytes,
  detectBankFileKind,
  fingerprintBytes,
  importSourceFor,
  parseBankCsvText,
  planBankImport,
  type BankFileKind,
  type BankParseResult,
  type ImportPlan,
  type ParsedBankRow,
  type ParseOptions,
} from "./bank-statement-parser.service";
import {
  continuityWarning,
  dbFils,
  previousClosingBalanceFils,
} from "./bank-reconciliation.service";

export function parseStatementCsv(bytes: Buffer, options: ParseOptions = {}): BankParseResult {
  const text = decodeStatementBytes(bytes);
  if (detectBankFileKind(bytes, text) !== "csv") {
    throw new DomainError("STATEMENT_CSV_REQUIRED", 400, undefined, "Choose a bank CSV export.");
  }
  return parseBankCsvText(text, options, fingerprintBytes(bytes));
}

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

type BankImportTx = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];
type ImportScope =
  | { account: BankAccount; connectionId?: string }
  | { account: null; connectionId: string };

async function lockBankAccount(tx: BankImportTx, companyId: string, accountId: string) {
  // The account row serializes imports even when no statement rows exist yet. READ COMMITTED
  // gives the duplicate query a fresh snapshot after another importer releases the lock.
  const [account] = await tx
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.id, accountId)))
    .for("update");
  if (!account)
    throw new DomainError("BANK_ACCOUNT_NOT_FOUND", 404, undefined, "Bank account not found");
  return account;
}

/** Decide duplicates, check continuity and write a batch and its rows under the scope lock. */
async function importWithinScope(
  tx: BankImportTx,
  input: Omit<ImportStatementRowsInput, "bankAccountId">,
  { account, connectionId }: ImportScope
): Promise<ImportStatementRowsResult> {
  const existing = await tx
    .select({
      date: bankTransactions.transactionDate,
      amount: bankTransactions.amount,
      description: bankTransactions.description,
      reference: bankTransactions.reference,
      importSource: bankTransactions.importSource,
    })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.companyId, input.companyId),
        isNull(bankTransactions.deletedAt),
        account
          ? eq(bankTransactions.bankStatementAccountId, account.id)
          : eq(bankTransactions.bankConnectionId, connectionId)
      )
    );
  const plan = planBankImport(
    input.rows,
    existing.map((row) => ({ ...row, amount: Number(row.amount) })),
    {
      fileFingerprint: input.fileFingerprint,
      kind: input.kind,
      allowDuplicates: Boolean(input.allowDuplicates),
    }
  );

  const ordered = [...plan.toInsert].sort(
    (a, b) => (a.date as Date).getTime() - (b.date as Date).getTime() || a.rowIndex - b.rowIndex
  );
  const first = ordered[0];
  let previous =
    first && account
      ? await previousClosingBalanceFils(input.companyId, account.id, first.date as Date, tx)
      : null;
  if (previous === null && first && existing.length === 0 && account?.openingBalanceDate) {
    previous = dbFils(account.openingBalance);
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
  const [batch] = await tx
    .insert(bankImportBatches)
    .values({
      companyId: input.companyId,
      bankAccountId: account?.id ?? null,
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
    .returning({ id: bankImportBatches.id });
  const importSource = input.importSource ?? importSourceFor(input.kind, input.fileFingerprint);
  const imported = await tx
    .insert(bankTransactions)
    .values(
      plan.toInsert.map((row) => ({
        companyId: input.companyId,
        // Cached copy of the account's current GL link; reconcile resolves it again (R06-01).
        bankAccountId: account?.glAccountId ?? null,
        bankStatementAccountId: account?.id ?? null,
        bankConnectionId: connectionId ?? null,
        transactionDate: row.date as Date,
        description: row.description,
        amount: row.amount,
        balance: row.balance,
        reference: row.reference,
        matchStatus: "unmatched",
        isReconciled: false,
        importSource,
        importBatchId: batch.id,
      }))
    )
    .returning();
  return { batchId: batch.id, imported, plan, continuityWarning: warning };
}

export async function importStatementRows(
  input: ImportStatementRowsInput
): Promise<ImportStatementRowsResult> {
  return db.transaction(
    async (tx) => {
      const account = await lockBankAccount(tx, input.companyId, input.bankAccountId);
      return importWithinScope(tx, input, { account });
    },
    { isolationLevel: "read committed" }
  );
}

/** Older CSV callers join the same account lock. Unlinked records still serialize on their own row. */
export async function importConnectionStatement(
  companyId: string,
  connectionId: string,
  parsed: BankParseResult,
  actorId: string
): Promise<{ imported: number; duplicates: number; errors: string[] }> {
  return db.transaction(
    async (tx) => {
      const owned = and(
        eq(bankConnections.companyId, companyId),
        eq(bankConnections.id, connectionId)
      );
      const [connection] = await tx
        .select({ bankAccountId: bankConnections.bankAccountId })
        .from(bankConnections)
        .where(owned)
        .for("update");
      if (!connection) throw new DomainError("BANK_CONNECTION_NOT_FOUND", 404);
      const account = connection.bankAccountId
        ? await lockBankAccount(tx, companyId, connection.bankAccountId)
        : null;
      const result = await importWithinScope(
        tx,
        {
          companyId,
          rows: parsed.rows,
          kind: "csv",
          source: "csv",
          format: parsed.format,
          fileFingerprint: parsed.fileFingerprint,
          actorId,
        },
        { account, connectionId }
      );
      const now = new Date();
      await tx.update(bankConnections).set({ lastSyncedAt: now, updatedAt: now }).where(owned);
      return {
        imported: result.imported.length,
        duplicates: result.plan.skipped.filter((row) => row.reason !== "invalid_row").length,
        errors: [],
      };
    },
    { isolationLevel: "read committed" }
  );
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
