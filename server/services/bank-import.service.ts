import { storage } from '../storage';
import { createLogger } from '../config/logger';

const log = createLogger('bank-import');

export interface ParsedTransaction {
  transactionDate: Date;
  description: string;
  amount: number; // positive = credit, negative = debit
  reference?: string;
}

/**
 * Parse a CSV bank statement into structured transactions.
 * Supports common UAE bank formats with auto-detection.
 */
export async function parseCSVBankStatement(
  csvContent: string,
  _bankName?: string
): Promise<ParsedTransaction[]> {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('CSV file must contain a header row and at least one data row');
  }

  const header = lines[0].toLowerCase();
  const columns = parseCSVLine(lines[0]);
  const headerLower = columns.map(c => c.toLowerCase().trim());

  // Auto-detect column indices
  const dateIdx = headerLower.findIndex(h =>
    h.includes('date') || h.includes('تاريخ')
  );
  const descIdx = headerLower.findIndex(h =>
    h.includes('description') || h.includes('detail') || h.includes('narration') ||
    h.includes('memo') || h.includes('particulars') || h.includes('وصف')
  );
  const amountIdx = headerLower.findIndex(h =>
    h === 'amount' || h.includes('مبلغ')
  );
  const debitIdx = headerLower.findIndex(h =>
    h.includes('debit') || h.includes('withdrawal') || h.includes('مدين')
  );
  const creditIdx = headerLower.findIndex(h =>
    h.includes('credit') || h.includes('deposit') || h.includes('دائن')
  );
  const refIdx = headerLower.findIndex(h =>
    h.includes('reference') || h.includes('ref') || h.includes('cheque') || h.includes('مرجع')
  );

  if (dateIdx === -1) {
    throw new Error('Could not detect date column. Expected header containing "date".');
  }
  if (descIdx === -1 && amountIdx === -1 && debitIdx === -1) {
    throw new Error('Could not detect description or amount columns.');
  }

  const hasSeparateDebitCredit = debitIdx !== -1 && creditIdx !== -1;
  const hasAmount = amountIdx !== -1;

  if (!hasSeparateDebitCredit && !hasAmount) {
    throw new Error('Could not detect amount columns. Expected "amount" or "debit"/"credit" columns.');
  }

  const transactions: ParsedTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line);

    try {
      const dateStr = cols[dateIdx]?.trim();
      if (!dateStr) continue;

      const date = parseDate(dateStr);
      if (!date) continue;

      const description = descIdx !== -1 ? (cols[descIdx]?.trim() || 'No description') : 'No description';
      const reference = refIdx !== -1 ? cols[refIdx]?.trim() : undefined;

      let amount = 0;
      if (hasSeparateDebitCredit) {
        const debit = parseNumber(cols[debitIdx]);
        const credit = parseNumber(cols[creditIdx]);
        amount = credit - debit; // credits positive, debits negative
      } else if (hasAmount) {
        amount = parseNumber(cols[amountIdx]);
      }

      if (amount === 0 && !description) continue;

      transactions.push({ transactionDate: date, description, amount, reference });
    } catch (err) {
      log.warn({ line: i + 1, error: err }, 'Skipping malformed CSV row');
    }
  }

  return transactions;
}

/**
 * Parse OFX (Open Financial Exchange) bank statement.
 * Handles basic OFX/QFX format used by many banks.
 */
export async function parseOFXStatement(ofxContent: string): Promise<ParsedTransaction[]> {
  const transactions: ParsedTransaction[] = [];

  // Extract all STMTTRN blocks
  const txRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match;

  while ((match = txRegex.exec(ofxContent)) !== null) {
    const block = match[1];

    const amount = extractOFXField(block, 'TRNAMT');
    const dateStr = extractOFXField(block, 'DTPOSTED');
    const name = extractOFXField(block, 'NAME') || extractOFXField(block, 'MEMO') || 'No description';
    const refNum = extractOFXField(block, 'FITID') || extractOFXField(block, 'CHECKNUM');

    if (!amount || !dateStr) continue;

    const date = parseOFXDate(dateStr);
    if (!date) continue;

    transactions.push({
      transactionDate: date,
      description: name.trim(),
      amount: parseFloat(amount),
      reference: refNum || undefined,
    });
  }

  return transactions;
}

/**
 * Import parsed transactions into the database.
 * Deduplicates based on date + amount + description.
 */
export async function importBankStatement(
  companyId: string,
  connectionId: string,
  parsedTransactions: ParsedTransaction[]
): Promise<{ imported: number; duplicates: number; errors: string[] }> {
  // Get existing transactions for dedup
  const existing = await storage.getBankTransactionsByCompanyId(companyId);
  const existingKeys = new Set(
    existing.map(t =>
      `${new Date(t.transactionDate).toISOString().slice(0, 10)}|${t.amount}|${t.description.slice(0, 50)}`
    )
  );

  let imported = 0;
  let duplicates = 0;
  const errors: string[] = [];

  for (const tx of parsedTransactions) {
    const key = `${tx.transactionDate.toISOString().slice(0, 10)}|${tx.amount}|${tx.description.slice(0, 50)}`;

    if (existingKeys.has(key)) {
      duplicates++;
      continue;
    }

    try {
      await storage.createBankTransaction({
        companyId,
        transactionDate: tx.transactionDate,
        description: tx.description,
        amount: tx.amount,
        reference: tx.reference || null,
        importSource: 'csv',
        bankConnectionId: connectionId,
        isReconciled: false,
      });
      imported++;
      existingKeys.add(key); // Prevent dupes within same batch
    } catch (err: any) {
      errors.push(`Row: ${tx.description} — ${err.message}`);
    }
  }

  // Update connection sync time
  await storage.updateBankConnection(connectionId, {
    lastSyncAt: new Date(),
  });

  log.info({ companyId, connectionId, imported, duplicates, errors: errors.length }, 'Bank statement import complete');

  return { imported, duplicates, errors };
}

// ─── Helpers ─────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseNumber(str: string | undefined): number {
  if (!str) return 0;
  // Remove currency symbols, commas, spaces
  const cleaned = str.replace(/[^\d.\-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseDate(str: string): Date | null {
  // Try common formats
  // DD/MM/YYYY
  let match = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  // YYYY-MM-DD
  match = str.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (match) {
    const [, year, month, day] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }

  // DD/MM/YY
  match = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/);
  if (match) {
    const [, day, month, year] = match;
    const fullYear = parseInt(year) > 50 ? 1900 + parseInt(year) : 2000 + parseInt(year);
    return new Date(fullYear, parseInt(month) - 1, parseInt(day));
  }

  // Fallback: Date.parse
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function extractOFXField(block: string, field: string): string | null {
  // OFX format: <FIELDNAME>value or <FIELDNAME>value\n
  const regex = new RegExp(`<${field}>([^<\\n\\r]+)`, 'i');
  const match = block.match(regex);
  return match ? match[1].trim() : null;
}

function parseOFXDate(str: string): Date | null {
  // OFX date format: YYYYMMDD or YYYYMMDDHHMMSS
  const match = str.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
}
