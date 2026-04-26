import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { storage } from '../storage';
import { autoReconcileTransactions, getSuggestionsForTransaction } from '../services/auto-reconcile.service';
import { createLogger } from '../config/logger';
import { createAndEmitNotification } from '../services/socket.service';
import { assertPeriodNotLocked } from '../services/period-lock.service';
import { ACCOUNT_CODES } from '../constants';

const log = createLogger('bank-statements');

// =====================================
// Zod schemas
// =====================================

const UAE_BANKS = ['Emirates NBD', 'ADCB', 'FAB', 'Mashreq', 'Other'] as const;

const bankAccountCreateSchema = z.object({
  nameEn: z.string().min(1, 'nameEn is required').max(255),
  bankName: z.enum(UAE_BANKS, {
    errorMap: () => ({ message: `bankName must be one of: ${UAE_BANKS.join(', ')}` }),
  }),
  accountNumber: z.string().max(64).optional().nullable(),
  iban: z.string().max(64).optional().nullable(),
  currency: z.string().length(3).optional(),
  glAccountId: z.string().uuid().optional().nullable(),
});

const bankAccountUpdateSchema = z.object({
  nameEn: z.string().min(1).max(255).optional(),
  bankName: z.enum(UAE_BANKS).optional(),
  accountNumber: z.string().max(64).optional().nullable(),
  iban: z.string().max(64).optional().nullable(),
  currency: z.string().length(3).optional(),
  glAccountId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
});

const bankStatementImportSchema = z.object({
  bankAccountId: z.string().uuid('bankAccountId must be a valid UUID'),
  csvContent: z.string().min(1, 'csvContent (raw CSV text) is required'),
});

const bankMatchSchema = z.object({
  matchedType: z.enum(['invoice', 'receipt', 'journal']),
  matchedId: z.string().uuid('matchedId must be a valid UUID'),
});

const bankCreateEntrySchema = z.object({
  accountId: z.string().uuid('accountId (GL account to debit/credit) must be a valid UUID'),
  memo: z.string().max(500).optional().nullable(),
});

// ─── UAE Bank CSV Format Detection ─────────────────────────────────────────

interface ParsedTransaction {
  date: Date;
  description: string;
  debit: number;
  credit: number;
  balance: number | null;
  reference: string | null;
}

type BankFormat = 'emiratesnbd' | 'adcb' | 'fab' | 'mashreq' | 'generic';

function detectBankFormat(headers: string[]): BankFormat {
  const h = headers.map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const joined = h.join(',');

  if (joined.includes('valuedate') || joined.includes('narration')) return 'emiratesnbd';
  if (joined.includes('txndate') || joined.includes('particulars')) return 'adcb';
  if (joined.includes('transdate') || joined.includes('chequeno')) return 'fab';
  if (joined.includes('postingdate') || joined.includes('transactiondetails')) return 'mashreq';
  return 'generic';
}

/**
 * Parse a raw CSV string into normalized transaction rows.
 * Handles quoted fields and various line endings.
 */
function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\//g, '-');

  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? null : d;
  }

  // Try DD-MM-YYYY or DD-MMM-YYYY
  const parts = cleaned.split(/[-\/\s]/);
  if (parts.length >= 3) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const day = parseInt(parts[0]);
    const monthStr = parts[1].toLowerCase();
    const month = isNaN(parseInt(parts[1]))
      ? months[monthStr.slice(0, 3)]
      : parseInt(parts[1]) - 1;
    const year = parseInt(parts[2].length === 2 ? '20' + parts[2] : parts[2]);
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  // Remove currency symbols, commas, spaces; handle parentheses as negative
  const negative = raw.trim().startsWith('(') || raw.trim().startsWith('-');
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const val = parseFloat(cleaned) || 0;
  return negative ? -val : val;
}

function mapRow(
  fields: string[],
  headers: string[],
  format: BankFormat
): ParsedTransaction | null {
  const get = (key: string): string => {
    const idx = headers.findIndex(
      (h) => h.toLowerCase().replace(/[^a-z0-9]/g, '') === key.toLowerCase().replace(/[^a-z0-9]/g, '')
    );
    return idx >= 0 ? (fields[idx] || '').trim() : '';
  };

  let dateStr = '';
  let description = '';
  let debitStr = '';
  let creditStr = '';
  let balanceStr = '';
  let reference = '';

  if (format === 'emiratesnbd') {
    dateStr = get('ValueDate') || get('Date') || get('TransactionDate');
    description = get('Narration') || get('Description') || get('Details');
    debitStr = get('Debit') || get('Withdrawal');
    creditStr = get('Credit') || get('Deposit');
    balanceStr = get('Balance') || get('RunningBalance');
    reference = get('ChequeNo') || get('Reference') || get('Ref');
  } else if (format === 'adcb') {
    dateStr = get('TxnDate') || get('Date') || get('TransactionDate');
    description = get('Particulars') || get('Description') || get('Details');
    debitStr = get('Debit') || get('Withdrawal') || get('Dr');
    creditStr = get('Credit') || get('Deposit') || get('Cr');
    balanceStr = get('Balance') || get('ClosingBalance');
    reference = get('Reference') || get('Ref') || get('ChequeNo');
  } else if (format === 'fab') {
    dateStr = get('TransDate') || get('Date') || get('ValueDate');
    description = get('Description') || get('Details') || get('Narration');
    debitStr = get('Debit') || get('Withdrawal') || get('Dr');
    creditStr = get('Credit') || get('Deposit') || get('Cr');
    balanceStr = get('Balance') || get('RunningBalance');
    reference = get('ChequeNo') || get('Reference') || get('TxnRef');
  } else if (format === 'mashreq') {
    dateStr = get('PostingDate') || get('Date') || get('ValueDate');
    description = get('TransactionDetails') || get('Description') || get('Narration');
    debitStr = get('Debit') || get('Withdrawal') || get('Dr');
    creditStr = get('Credit') || get('Deposit') || get('Cr');
    balanceStr = get('Balance') || get('AvailableBalance');
    reference = get('Reference') || get('Ref') || get('ChequeNo');
  } else {
    // Generic: try common column names
    dateStr = get('Date') || get('TransactionDate') || get('ValueDate') || get('TxnDate');
    description = get('Description') || get('Details') || get('Narration') || get('Particulars');
    debitStr = get('Debit') || get('Withdrawal') || get('Dr') || get('Amount');
    creditStr = get('Credit') || get('Deposit') || get('Cr');
    balanceStr = get('Balance') || get('RunningBalance') || get('ClosingBalance');
    reference = get('Reference') || get('Ref') || get('ChequeNo');

    // If there's a single amount column with +/- signs
    if (!debitStr && !creditStr) {
      const amtStr = get('Amount') || get('Debit/Credit');
      const amt = parseAmount(amtStr);
      if (amt < 0) debitStr = String(Math.abs(amt));
      else creditStr = String(amt);
    }
  }

  const txnDate = parseDate(dateStr);
  if (!txnDate) return null;

  const debit = parseAmount(debitStr);
  const credit = parseAmount(creditStr);
  const balance = balanceStr ? parseAmount(balanceStr) : null;

  // Skip rows with no monetary value
  if (debit === 0 && credit === 0) return null;

  const cleanedDesc = description.replace(/\s+/g, ' ').trim();
  if (!cleanedDesc) return null;

  return {
    date: txnDate,
    description: cleanedDesc,
    debit,
    credit,
    balance: balance !== 0 ? balance : null,
    reference: reference || null,
  };
}

/**
 * Parse CSV content and return normalized transactions.
 * Skips header-only detection rows and blank lines.
 */
function parseBankCsv(csvContent: string): { transactions: ParsedTransaction[]; format: BankFormat; errors: string[] } {
  const lines = csvContent
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    return { transactions: [], format: 'generic', errors: ['CSV has no data rows'] };
  }

  // Find header row — first row with more than 2 comma-separated fields
  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const fields = parseCsvRow(lines[i]);
    if (fields.length >= 3) {
      headerIdx = i;
      break;
    }
  }

  const headers = parseCsvRow(lines[headerIdx]);
  const format = detectBankFormat(headers);
  const transactions: ParsedTransaction[] = [];
  const errors: string[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const fields = parseCsvRow(lines[i]);
    if (fields.every((f) => !f)) continue; // blank row

    try {
      const txn = mapRow(fields, headers, format);
      if (txn) {
        transactions.push(txn);
      }
    } catch (err: any) {
      errors.push(`Row ${i + 1}: ${err.message}`);
    }
  }

  return { transactions, format, errors };
}

// ─── AI Transaction Matching ────────────────────────────────────────────────

/**
 * After bulk import, attempt to auto-match each new transaction to
 * existing invoices/receipts using the auto-reconcile service.
 * Updates matchStatus to 'suggested' for confident matches.
 */
async function autoMatchImportedTransactions(companyId: string): Promise<void> {
  try {
    const result = await autoReconcileTransactions(companyId);
    // Apply high-confidence suggestions (>=75%) as 'suggested' status
    for (const match of result.matches) {
      if (match.confidence >= 75) {
        await storage.updateBankTransaction(match.bankTransactionId, companyId, {
          matchStatus: 'suggested',
          matchConfidence: match.confidence / 100,
          ...(match.matchedType === 'journal_entry' && { matchedJournalEntryId: match.matchedId }),
          ...(match.matchedType === 'receipt' && { matchedReceiptId: match.matchedId }),
          ...(match.matchedType === 'invoice' && { matchedInvoiceId: match.matchedId }),
        });
      }
    }
  } catch (err: any) {
    log.warn({ err: err.message }, 'Auto-matching failed after import, continuing without matches');
  }
}

// ─── Route Registration ──────────────────────────────────────────────────────

export function registerBankStatementRoutes(app: Express) {
  // ─────────────────────────────────────────────────────────────
  // Bank Account Management
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /api/companies/:companyId/bank-accounts
   * List all managed bank accounts for a company.
   */
  app.get(
    '/api/companies/:companyId/bank-accounts',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      const accounts = await storage.getBankAccountsByCompanyId(companyId);
      res.json(accounts);
    })
  );

  /**
   * POST /api/companies/:companyId/bank-accounts
   * Create a new managed bank account linked to a GL account.
   * Body: { nameEn, bankName, accountNumber?, iban?, currency?, glAccountId? }
   */
  app.post(
    '/api/companies/:companyId/bank-accounts',
    authMiddleware,
    requireCustomer,
    validate({ body: bankAccountCreateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      const { nameEn, bankName, accountNumber, iban, currency, glAccountId } = req.body;

      const account = await storage.createBankAccount({
        companyId,
        nameEn,
        bankName,
        accountNumber: accountNumber || null,
        iban: iban || null,
        currency: currency || 'AED',
        glAccountId: glAccountId || null,
        isActive: true,
      });

      res.status(201).json(account);
    })
  );

  /**
   * PATCH /api/companies/:companyId/bank-accounts/:accountId
   * Update a bank account (e.g., link to GL account).
   */
  app.patch(
    '/api/companies/:companyId/bank-accounts/:accountId',
    authMiddleware,
    requireCustomer,
    validate({ body: bankAccountUpdateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, accountId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      const existing = await storage.getBankAccountById(accountId);
      if (!existing || existing.companyId !== companyId) {
        return res.status(404).json({ message: 'Bank account not found' });
      }

      const { nameEn, bankName, accountNumber, iban, currency, glAccountId, isActive } = req.body;
      const updated = await storage.updateBankAccount(accountId, {
        ...(nameEn !== undefined && { nameEn }),
        ...(bankName !== undefined && { bankName }),
        ...(accountNumber !== undefined && { accountNumber }),
        ...(iban !== undefined && { iban }),
        ...(currency !== undefined && { currency }),
        ...(glAccountId !== undefined && { glAccountId }),
        ...(isActive !== undefined && { isActive }),
      });

      res.json(updated);
    })
  );

  // ─────────────────────────────────────────────────────────────
  // Bank Statement Import
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /api/companies/:companyId/bank-statements/import
   * Import bank statement rows from a CSV.
   *
   * Body: {
   *   bankAccountId: string  (from bank_accounts table),
   *   csvContent: string     (raw CSV text),
   * }
   *
   * Supports UAE bank formats: Emirates NBD, ADCB, FAB, Mashreq, generic.
   * Columns: date, description, debit, credit, balance (bank-specific headers auto-detected).
   * After import, runs AI auto-matching against existing invoices/receipts.
   */
  app.post(
    '/api/companies/:companyId/bank-statements/import',
    authMiddleware,
    requireCustomer,
    validate({ body: bankStatementImportSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      const { bankAccountId, csvContent } = req.body;

      // Validate bank account belongs to this company
      const bankAccount = await storage.getBankAccountById(bankAccountId);
      if (!bankAccount || bankAccount.companyId !== companyId) {
        return res.status(404).json({ message: 'Bank account not found' });
      }

      // Parse CSV
      const { transactions: parsed, format, errors: parseErrors } = parseBankCsv(csvContent);

      if (parsed.length === 0) {
        return res.status(400).json({
          message: 'No valid transactions found in CSV',
          parseErrors,
          detectedFormat: format,
        });
      }

      // Map parsed rows to insert records
      const allRows = parsed.map((txn) => ({
        companyId,
        bankAccountId: bankAccount.glAccountId || null,
        bankStatementAccountId: bankAccountId,
        transactionDate: txn.date,
        description: txn.description,
        // amount: positive = credit (inflow), negative = debit (outflow)
        amount: txn.credit > 0 ? txn.credit : -txn.debit,
        balance: txn.balance,
        reference: txn.reference,
        category: null,
        matchStatus: 'unmatched' as const,
        isReconciled: false,
        importSource: 'csv',
      }));

      // Dedupe against existing transactions on the same managed bank account.
      // Re-importing the same statement (or overlapping date ranges) is common,
      // and bulk-inserting duplicates would corrupt the reconciliation worklist.
      const existing = await storage.getBankTransactionsByCompanyId(companyId);
      const dedupeKey = (t: { transactionDate: Date | string; amount: number; reference: string | null }) => {
        const dateStr = (t.transactionDate instanceof Date ? t.transactionDate : new Date(t.transactionDate))
          .toISOString()
          .slice(0, 10);
        return `${dateStr}|${Number(t.amount).toFixed(2)}|${t.reference ?? ''}`;
      };
      const existingKeys = new Set(
        existing
          .filter((t) => t.bankStatementAccountId === bankAccountId)
          .map(dedupeKey)
      );
      const toInsert: typeof allRows = [];
      let skippedDuplicates = 0;
      for (const row of allRows) {
        const key = dedupeKey(row);
        if (existingKeys.has(key)) {
          skippedDuplicates++;
          continue;
        }
        existingKeys.add(key); // also dedupe within this batch
        toInsert.push(row);
      }

      const created = toInsert.length > 0
        ? await storage.bulkCreateBankTransactions(toInsert)
        : [];

      // Run AI auto-matching in background (non-blocking)
      autoMatchImportedTransactions(companyId).catch(() => {});

      createAndEmitNotification({
        userId,
        companyId,
        type: 'bank_import',
        title: 'Bank statement imported',
        message: `${created.length} transaction(s) imported from ${bankAccount.bankName} (${format} format)`,
        priority: 'normal',
        relatedEntityType: 'bank_statement',
        actionUrl: '/bank-reconciliation',
      }).catch(() => {});

      res.status(201).json({
        imported: created.length,
        skippedDuplicates,
        detectedFormat: format,
        parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
        message: skippedDuplicates > 0
          ? `Imported ${created.length} new transaction(s); skipped ${skippedDuplicates} duplicate(s). Auto-matching running in background.`
          : `Imported ${created.length} transaction(s). Auto-matching running in background.`,
      });
    })
  );

  // ─────────────────────────────────────────────────────────────
  // Reconciliation Endpoints
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /api/companies/:companyId/bank-statements/unreconciled
   * Return all unmatched/unreconciled bank transactions.
   * Optional query param: bankAccountId — filter by managed bank account.
   */
  app.get(
    '/api/companies/:companyId/bank-statements/unreconciled',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { bankAccountId } = req.query;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      let transactions = await storage.getUnreconciledBankTransactions(companyId);

      if (bankAccountId && typeof bankAccountId === 'string') {
        transactions = transactions.filter(
          (t) => t.bankStatementAccountId === bankAccountId
        );
      }

      res.json(transactions);
    })
  );

  /**
   * POST /api/companies/:companyId/bank-statements/:tid/match
   * Manually match a bank transaction to an invoice or receipt.
   * Body: { matchedType: 'invoice' | 'receipt' | 'journal', matchedId: string }
   */
  app.post(
    '/api/companies/:companyId/bank-statements/:tid/match',
    authMiddleware,
    requireCustomer,
    validate({ body: bankMatchSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      const txn = await storage.getBankTransactionById(tid, companyId);
      if (!txn) {
        return res.status(404).json({ message: 'Bank transaction not found' });
      }

      const { matchedType, matchedId } = req.body;

      // Manual reconciliation flips a transaction inside a period to matched —
      // refuse to mutate reconciliation state inside a locked period.
      await assertPeriodNotLocked(companyId, txn.transactionDate);

      let updated;

      if (matchedType === 'invoice') {
        // Matching against an invoice means the customer has paid: we must
        // record the payment so the invoice's status/totalPaid update and a
        // proper double-entry JE is posted (Dr Bank, Cr A/R). Just flipping
        // the bank transaction's columns (the previous behaviour) left
        // invoices stuck on 'sent' indefinitely.
        const invoice = await storage.getInvoice(matchedId, companyId);
        if (!invoice) {
          return res.status(404).json({ message: 'Invoice not found' });
        }

        if (!txn.bankAccountId) {
          return res.status(400).json({
            message: 'Bank transaction has no linked GL bank account; cannot post payment journal entry.',
          });
        }

        const accounts = await storage.getAccountsByCompanyId(companyId);
        const accountsReceivable = accounts.find(
          (a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount
        );
        if (!accountsReceivable) {
          return res.status(500).json({ message: 'Accounts Receivable account not found' });
        }

        const paymentAccount = await storage.getAccount(txn.bankAccountId, companyId);
        if (!paymentAccount) {
          return res.status(400).json({ message: 'Bank GL account not found' });
        }

        // Match the unpaid remainder (or what the bank says, whichever is smaller).
        const previouslyPaid = await storage.getInvoicePaidTotal(matchedId);
        const remaining = Number(invoice.total) - previouslyPaid;
        const bankAbs = Math.abs(Number(txn.amount));
        const paymentAmount = Math.min(remaining, bankAbs);

        let journalEntryId: string | null = null;
        if (paymentAmount > 0.005) {
          try {
            const result = await storage.recordInvoicePayment({
              invoiceId: matchedId,
              companyId,
              amount: paymentAmount,
              date: new Date(txn.transactionDate),
              method: 'bank_reconciliation',
              reference: txn.reference,
              notes: `Reconciled from bank statement: ${txn.description}`.slice(0, 500),
              paymentAccountId: txn.bankAccountId,
              paymentAccountCurrency: (paymentAccount as any).currency ?? null,
              receivableAccountId: accountsReceivable.id,
              createdBy: userId,
            });
            journalEntryId = result.journalEntryId;
          } catch (err: any) {
            if (err?.code === 'CURRENCY_MISMATCH' || err?.code === 'OVERPAYMENT' || err?.code === 'INVOICE_TERMINAL') {
              return res.status(422).json({ message: err.message, code: err.code });
            }
            throw err;
          }
        }

        // Link the bank transaction to the invoice + the payment JE.
        // Bypass storage.reconcileBankTransaction here so we don't create a
        // second JE (recordInvoicePayment already posted the canonical one).
        updated = await storage.updateBankTransaction(tid, companyId, {
          isReconciled: true,
          matchStatus: 'matched',
          matchedInvoiceId: matchedId,
          ...(journalEntryId ? { matchedJournalEntryId: journalEntryId } : {}),
        });
      } else {
        updated = await storage.reconcileBankTransaction(
          tid,
          companyId,
          matchedId,
          matchedType as 'journal' | 'receipt' | 'invoice',
          userId,
        );
        updated = await storage.updateBankTransaction(tid, companyId, { matchStatus: 'matched' });
      }

      const { recordAudit } = await import('../services/audit.service');
      await recordAudit({
        userId,
        companyId,
        action: 'bank.reconcile',
        entityType: 'bank_transaction',
        entityId: tid,
        before: { matchStatus: txn.matchStatus },
        after: { matchedType, matchedId, matchStatus: 'matched' },
        req,
      });

      res.json({ ...updated, matchStatus: 'matched' });
    })
  );

  /**
   * POST /api/companies/:companyId/bank-statements/:tid/create-entry
   * Create a journal entry from an unmatched bank transaction.
   * Body: { accountId: string, memo?: string }
   * The bank account's GL account is the contra entry.
   */
  app.post(
    '/api/companies/:companyId/bank-statements/:tid/create-entry',
    authMiddleware,
    requireCustomer,
    validate({ body: bankCreateEntrySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      const txn = await storage.getBankTransactionById(tid, companyId);
      if (!txn) {
        return res.status(404).json({ message: 'Bank transaction not found' });
      }

      const { accountId, memo } = req.body;

      // Determine debit/credit based on transaction direction
      // Positive amount = credit to bank (inflow) → debit bank GL, credit the specified account
      // Negative amount = debit from bank (outflow) → credit bank GL, debit the specified account
      const absAmount = Math.abs(txn.amount);
      const isInflow = txn.amount > 0;

      const bankGlAccountId = txn.bankAccountId;
      if (!bankGlAccountId) {
        return res.status(400).json({
          message: 'Cannot create journal entry: bank transaction has no associated bank account (bankAccountId is null). Link the transaction to a bank account first.',
        });
      }

      // Block creating reconciliation journal entries into a locked period.
      await assertPeriodNotLocked(companyId, txn.transactionDate);

      const entryNumber = await storage.generateEntryNumber(companyId, new Date(txn.transactionDate));

      const entry = await storage.createJournalEntry(
        {
          companyId,
          entryNumber,
          date: new Date(txn.transactionDate),
          memo: memo || txn.description,
          status: 'posted',
          source: 'bank_reconciliation',
          sourceId: txn.id,
          createdBy: userId,
          postedBy: userId,
          postedAt: new Date(),
        },
        [
          {
            accountId: bankGlAccountId,
            debit: isInflow ? absAmount : 0,
            credit: isInflow ? 0 : absAmount,
            description: txn.description,
          },
          {
            accountId,
            debit: isInflow ? 0 : absAmount,
            credit: isInflow ? absAmount : 0,
            description: txn.description,
          },
        ]
      );

      // Mark transaction as matched to this journal entry
      const updated = await storage.reconcileBankTransaction(tid, companyId, entry.id, 'journal');
      await storage.updateBankTransaction(tid, companyId, { matchStatus: 'matched' });

      res.status(201).json({
        journalEntry: entry,
        bankTransaction: { ...updated, matchStatus: 'matched' },
      });
    })
  );

  /**
   * GET /api/companies/:companyId/bank-statements/transactions
   * Return all bank transactions for a company (optionally filter by bankAccountId).
   */
  app.get(
    '/api/companies/:companyId/bank-statements/transactions',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { bankAccountId } = req.query;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      let transactions = await storage.getBankTransactionsByCompanyId(companyId);

      if (bankAccountId && typeof bankAccountId === 'string') {
        transactions = transactions.filter(
          (t) => t.bankStatementAccountId === bankAccountId
        );
      }

      res.json(transactions);
    })
  );

  /**
   * GET /api/companies/:companyId/bank-statements/:tid/suggestions
   * Return top match suggestions for a single bank transaction.
   */
  app.get(
    '/api/companies/:companyId/bank-statements/:tid/suggestions',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      const txn = await storage.getBankTransactionById(tid, companyId);
      if (!txn) {
        return res.status(404).json({ message: 'Bank transaction not found' });
      }

      const suggestions = await getSuggestionsForTransaction(companyId, tid, 5);
      res.json(suggestions);
    })
  );

  /**
   * DELETE /api/companies/:companyId/bank-statements/:tid/match
   * Unmatch a reconciled transaction, resetting it to unmatched status.
   */
  app.delete(
    '/api/companies/:companyId/bank-statements/:tid/match',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, tid } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      const txn = await storage.getBankTransactionById(tid, companyId);
      if (!txn) {
        return res.status(404).json({ message: 'Bank transaction not found' });
      }

      // Unmatching reverses reconciliation state on the transaction's date —
      // refuse if that date is inside a locked period.
      await assertPeriodNotLocked(companyId, txn.transactionDate);

      const updated = await storage.updateBankTransaction(tid, companyId, {
        isReconciled: false,
        matchStatus: 'unmatched',
        matchedJournalEntryId: null,
        matchedReceiptId: null,
        matchedInvoiceId: null,
        matchConfidence: null,
      });

      res.json(updated);
    })
  );

  /**
   * GET /api/companies/:companyId/bank-statements/report
   * Reconciliation summary report — totals and counts by status.
   * Optional query params: from (ISO date), to (ISO date), bankAccountId.
   */
  app.get(
    '/api/companies/:companyId/bank-statements/report',
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { from, to, bankAccountId } = req.query;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

      let transactions = await storage.getBankTransactionsByCompanyId(companyId);

      // Optional filters
      if (bankAccountId && typeof bankAccountId === 'string') {
        transactions = transactions.filter((t) => t.bankStatementAccountId === bankAccountId);
      }
      if (from && typeof from === 'string') {
        const fromDate = new Date(from);
        transactions = transactions.filter((t) => new Date(t.transactionDate) >= fromDate);
      }
      if (to && typeof to === 'string') {
        const toDate = new Date(to);
        transactions = transactions.filter((t) => new Date(t.transactionDate) <= toDate);
      }

      const reconciled = transactions.filter((t) => t.isReconciled);
      const unreconciled = transactions.filter((t) => !t.isReconciled);
      const suggested = unreconciled.filter((t) => t.matchStatus === 'suggested');

      const totalCredits = transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const totalDebits = transactions.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
      const reconciledCredits = reconciled.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const reconciledDebits = reconciled.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

      res.json({
        period: {
          from: from || null,
          to: to || null,
        },
        summary: {
          totalTransactions: transactions.length,
          reconciledCount: reconciled.length,
          unreconciledCount: unreconciled.length,
          suggestedCount: suggested.length,
          reconciledPct: transactions.length > 0
            ? Math.round((reconciled.length / transactions.length) * 100)
            : 0,
        },
        amounts: {
          totalCredits,
          totalDebits,
          netAmount: totalCredits - totalDebits,
          reconciledCredits,
          reconciledDebits,
          unreconciledCredits: totalCredits - reconciledCredits,
          unreconciledDebits: totalDebits - reconciledDebits,
        },
      });
    })
  );
}
