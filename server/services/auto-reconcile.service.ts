import { storage } from '../storage';
import type { BankTransaction, JournalEntry, JournalLine, Invoice, Receipt, Account } from '../../shared/schema';

interface ReconcileMatch {
  bankTransactionId: string;
  matchedType: 'journal_entry' | 'invoice' | 'receipt';
  matchedId: string;
  confidence: number;
  matchReason: string;
}

interface AutoReconcileResult {
  matches: ReconcileMatch[];
  autoMatchedCount: number;
  manualReviewCount: number;
  totalUnreconciled: number;
}

/**
 * Simple keyword-based text similarity.
 * Returns a score from 0 to 1 based on overlapping meaningful words.
 */
function textSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;

  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'at', 'by', 'from']);

  const tokenize = (text: string): Set<string> => {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w))
    );
  };

  const words1 = tokenize(text1);
  const words2 = tokenize(text2);

  if (words1.size === 0 || words2.size === 0) return 0;

  let overlap = 0;
  for (const word of words1) {
    if (words2.has(word)) overlap++;
  }

  return (2 * overlap) / (words1.size + words2.size);
}

/**
 * Check if two dates are within a given number of days of each other.
 */
function datesWithinDays(date1: Date, date2: Date, days: number): boolean {
  const diffMs = Math.abs(date1.getTime() - date2.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}

/**
 * Calculate a confidence score for a potential match between a bank transaction
 * and a candidate record (journal entry, invoice, or receipt).
 */
function calculateConfidence(
  bankAmount: number,
  candidateAmount: number,
  bankDate: Date,
  candidateDate: Date,
  bankDesc: string,
  candidateDesc: string
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Exact amount match
  if (Math.abs(bankAmount - candidateAmount) < 0.01) {
    score += 50;
    reasons.push('Exact amount match');
  }
  // Amount within 1% tolerance
  else if (candidateAmount > 0 && Math.abs(bankAmount - candidateAmount) / candidateAmount <= 0.01) {
    score += 35;
    reasons.push('Amount within 1% tolerance');
  }
  // Amount within 5% tolerance
  else if (candidateAmount > 0 && Math.abs(bankAmount - candidateAmount) / candidateAmount <= 0.05) {
    score += 15;
    reasons.push('Amount within 5% tolerance');
  } else {
    // Amounts don't match closely enough
    return { score: 0, reasons: [] };
  }

  // Date proximity
  if (datesWithinDays(bankDate, candidateDate, 0)) {
    score += 30;
    reasons.push('Same date');
  } else if (datesWithinDays(bankDate, candidateDate, 1)) {
    score += 25;
    reasons.push('Dates within 1 day');
  } else if (datesWithinDays(bankDate, candidateDate, 3)) {
    score += 15;
    reasons.push('Dates within 3 days');
  } else if (datesWithinDays(bankDate, candidateDate, 7)) {
    score += 5;
    reasons.push('Dates within 7 days');
  }

  // Text similarity
  const similarity = textSimilarity(bankDesc, candidateDesc);
  if (similarity >= 0.5) {
    score += 15;
    reasons.push('Strong description match');
  } else if (similarity >= 0.25) {
    score += 10;
    reasons.push('Partial description match');
  } else if (similarity > 0) {
    score += 5;
    reasons.push('Weak description match');
  }

  // Cap at 100
  score = Math.min(score, 100);

  return { score, reasons };
}

/**
 * Automatically reconcile unreconciled bank transactions by finding matches
 * in journal entries, invoices, and receipts.
 */
export async function autoReconcileTransactions(companyId: string): Promise<AutoReconcileResult> {
  // Fetch unreconciled bank transactions and all potential match candidates
  const [unreconciledTxns, journalEntries, invoices, receipts, accounts] = await Promise.all([
    storage.getUnreconciledBankTransactions(companyId),
    storage.getJournalEntriesByCompanyId(companyId),
    storage.getInvoicesByCompanyId(companyId),
    storage.getReceiptsByCompanyId(companyId),
    storage.getAccountsByCompanyId(companyId),
  ]);

  const accountMap = new Map<string, Account>();
  for (const acc of accounts) {
    accountMap.set(acc.id, acc);
  }

  // Pre-compute journal entry totals
  const journalTotals = new Map<string, { totalDebit: number; totalCredit: number; description: string }>();
  const postedEntries = journalEntries.filter((e) => e.status === 'posted');

  for (const entry of postedEntries) {
    const lines = await storage.getJournalLinesByEntryId(entry.id);
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      totalDebit += line.debit || 0;
      totalCredit += line.credit || 0;
    }
    journalTotals.set(entry.id, {
      totalDebit,
      totalCredit,
      description: entry.memo || entry.entryNumber,
    });
  }

  const matches: ReconcileMatch[] = [];
  const matchedCandidates = new Set<string>(); // Prevent double-matching

  // Auto-reconciliation confidence threshold
  const AUTO_MATCH_THRESHOLD = 75;

  for (const txn of unreconciledTxns) {
    const bankAmount = Math.abs(txn.amount);
    const bankDate = new Date(txn.transactionDate);
    const bankDesc = txn.description + (txn.reference ? ' ' + txn.reference : '');
    const isCredit = txn.amount > 0; // Positive = credit (inflow)

    let bestMatch: ReconcileMatch | null = null;
    let bestScore = 0;

    // Match against journal entries
    for (const entry of postedEntries) {
      const key = `je-${entry.id}`;
      if (matchedCandidates.has(key)) continue;

      const totals = journalTotals.get(entry.id);
      if (!totals) continue;

      // Use the relevant total based on transaction direction
      const candidateAmount = isCredit ? totals.totalDebit : totals.totalCredit;
      if (candidateAmount === 0) continue;

      const entryDate = new Date(entry.date);
      const entryDesc = totals.description;

      const { score, reasons } = calculateConfidence(
        bankAmount, candidateAmount, bankDate, entryDate, bankDesc, entryDesc
      );

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          bankTransactionId: txn.id,
          matchedType: 'journal_entry',
          matchedId: entry.id,
          confidence: score,
          matchReason: reasons.join('; '),
        };
      }
    }

    // Match against invoices (typically for inflows / credits)
    if (isCredit) {
      for (const inv of invoices) {
        const key = `inv-${inv.id}`;
        if (matchedCandidates.has(key)) continue;
        if (inv.status === 'void') continue;

        const invAmount = inv.total;
        const invDate = new Date(inv.date);
        const invDesc = `Invoice ${inv.number} ${inv.customerName}`;

        const { score, reasons } = calculateConfidence(
          bankAmount, invAmount, bankDate, invDate, bankDesc, invDesc
        );

        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            bankTransactionId: txn.id,
            matchedType: 'invoice',
            matchedId: inv.id,
            confidence: score,
            matchReason: reasons.join('; '),
          };
        }
      }
    }

    // Match against receipts (typically for outflows / debits)
    if (!isCredit) {
      for (const receipt of receipts) {
        const key = `rcpt-${receipt.id}`;
        if (matchedCandidates.has(key)) continue;
        if (!receipt.amount || receipt.amount <= 0) continue;

        const rcptAmount = receipt.amount;
        const rcptDate = receipt.date ? new Date(receipt.date) : new Date(receipt.createdAt);
        const rcptDesc = `${receipt.merchant || ''} ${receipt.category || ''}`.trim();

        const { score, reasons } = calculateConfidence(
          bankAmount, rcptAmount, bankDate, rcptDate, bankDesc, rcptDesc
        );

        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            bankTransactionId: txn.id,
            matchedType: 'receipt',
            matchedId: receipt.id,
            confidence: score,
            matchReason: reasons.join('; '),
          };
        }
      }
    }

    if (bestMatch && bestScore > 0) {
      matches.push(bestMatch);
      // Mark as used to prevent double matching
      const prefix = bestMatch.matchedType === 'journal_entry' ? 'je'
        : bestMatch.matchedType === 'invoice' ? 'inv' : 'rcpt';
      matchedCandidates.add(`${prefix}-${bestMatch.matchedId}`);
    }
  }

  // Sort by confidence descending
  matches.sort((a, b) => b.confidence - a.confidence);

  const autoMatchedCount = matches.filter((m) => m.confidence >= AUTO_MATCH_THRESHOLD).length;
  const manualReviewCount = matches.filter((m) => m.confidence < AUTO_MATCH_THRESHOLD && m.confidence > 0).length;

  return {
    matches,
    autoMatchedCount,
    manualReviewCount,
    totalUnreconciled: unreconciledTxns.length,
  };
}

/**
 * Apply a set of reconciliation matches by updating bank transactions.
 */
export async function applyReconcileMatches(
  companyId: string,
  matchIds: { bankTransactionId: string; matchedType: string; matchedId: string }[]
): Promise<{ applied: number; errors: string[] }> {
  let applied = 0;
  const errors: string[] = [];

  for (const match of matchIds) {
    try {
      await storage.reconcileBankTransaction(
        match.bankTransactionId,
        match.matchedId,
        match.matchedType as 'journal' | 'receipt' | 'invoice'
      );
      applied++;
    } catch (err: any) {
      errors.push(`Failed to reconcile ${match.bankTransactionId}: ${err.message || 'Unknown error'}`);
    }
  }

  return { applied, errors };
}
