import { storage } from "../storage";
import { createLogger } from "../config/logger";
import {
  parseBankCsvText,
  parseBankOfx,
  planBankImport,
  type ParsedBankRow,
} from "./bank-statement-parser.service";

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
  parsedTransactions: ParsedTransaction[]
): Promise<{ imported: number; duplicates: number; errors: string[] }> {
  const existing = (await storage.getBankTransactionsByCompanyId(companyId)).filter(
    (t) => t.bankConnectionId === connectionId
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
        isReconciled: false,
      });
      imported++;
    } catch (err: any) {
      errors.push(`Row: ${row.description} — ${err.message}`);
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
