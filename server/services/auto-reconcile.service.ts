import { storage } from '../storage';
import type { BankTransaction, JournalEntry, JournalLine, Invoice, Receipt, Account } from '../../shared/schema';

export interface ReconcileMatch {
  bankTransactionId: string;
  matchedType: 'journal_entry' | 'invoice' | 'receipt';
  matchedId: string;
  confidence: number;
  matchReason: string;
  // Enriched details for display
  bankDescription?: string;
  bankAmount?: number;
  bankDate?: string;
  matchedDescription?: string;
  matchedAmount?: number;
  matchedDate?: string;
}

export interface AutoReconcileResult {
  matches: ReconcileMatch[];
  autoMatchedCount: number;
  manualReviewCount: number;
  totalUnreconciled: number;
}

/**
 * Extract reference numbers from text: invoice numbers, payment refs, 6+ digit numbers.
 */
function extractReferenceNumbers(text: string): Set<string> {
  const refs = new Set<string>();
  // Patterns: INV-001, RCT-2024-001, PO-123, cheque numbers, 6+ digit numeric refs
  const refPattern = /\b([A-Z]{2,6}[-/]?\d{3,}|\d{6,})\b/gi;
  const matches = text.match(refPattern);
  if (matches) {
    for (const m of matches) refs.add(m.toUpperCase().replace(/[/]/g, '-'));
  }
  return refs;
}

function hasReferenceOverlap(text1: string, text2: string): boolean {
  const refs1 = extractReferenceNumbers(text1);
  if (refs1.size === 0) return false;
  const refs2 = extractReferenceNumbers(text2);
  for (const ref of refs1) {
    if (refs2.has(ref)) return true;
  }
  return false;
}

/**
 * Simple keyword-based text similarity with stop-word filtering.
 * Returns a score from 0 to 1.
 */
function textSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;

  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'at', 'by',
    'from', 'with', 'ltd', 'llc', 'fze', 'pjsc', 'llp', 'inc', 'co', 'payment',
    'transfer', 'bank', 'charge', 'fee', 'aed',
  ]);

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

function datesWithinDays(date1: Date, date2: Date, days: number): boolean {
  const diffMs = Math.abs(date1.getTime() - date2.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}

/**
 * Calculate a confidence score (0-100) for a potential match.
 *
 * Scoring breakdown (max 100):
 *   Amount:      exact=50, within 1%=35, within 5%=15, else reject (score=0)
 *   Date:        same=30, ≤1d=25, ≤3d=15, ≤7d=5
 *   Reference#:  overlap=20
 *   Text sim:    strong(≥50%)=15, partial(≥25%)=10, weak>0=5
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

  // Amount matching (gate — if amounts don't match at all, skip)
  if (Math.abs(bankAmount - candidateAmount) < 0.01) {
    score += 50;
    reasons.push('Exact amount match');
  } else if (candidateAmount > 0 && Math.abs(bankAmount - candidateAmount) / candidateAmount <= 0.01) {
    score += 35;
    reasons.push('Amount within 1%');
  } else if (candidateAmount > 0 && Math.abs(bankAmount - candidateAmount) / candidateAmount <= 0.05) {
    score += 15;
    reasons.push('Amount within 5%');
  } else {
    return { score: 0, reasons: [] };
  }

  // Date proximity
  if (datesWithinDays(bankDate, candidateDate, 0)) {
    score += 30;
    reasons.push('Same date');
  } else if (datesWithinDays(bankDate, candidateDate, 1)) {
    score += 25;
    reasons.push('Within 1 day');
  } else if (datesWithinDays(bankDate, candidateDate, 3)) {
    score += 15;
    reasons.push('Within 3 days');
  } else if (datesWithinDays(bankDate, candidateDate, 7)) {
    score += 5;
    reasons.push('Within 7 days');
  }

  // Reference number overlap (invoice #, cheque #, payment ref)
  if (hasReferenceOverlap(bankDesc, candidateDesc)) {
    score += 20;
    reasons.push('Reference number match');
  }

  // Keyword text similarity
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

  return { score: Math.min(score, 100), reasons };
}

// ─── Shared data loading ────────────────────────────────────────────────────

interface CandidatePool {
  postedEntries: JournalEntry[];
  journalTotals: Map<string, { totalDebit: number; totalCredit: number; description: string }>;
  invoices: Invoice[];
  receipts: Receipt[];
}

async function loadCandidatePool(companyId: string): Promise<CandidatePool> {
  const [journalEntries, invoices, receipts] = await Promise.all([
    storage.getJournalEntriesByCompanyId(companyId),
    storage.getInvoicesByCompanyId(companyId),
    storage.getReceiptsByCompanyId(companyId),
  ]);

  const postedEntries = journalEntries.filter((e) => e.status === 'posted');

  const journalTotals = new Map<string, { totalDebit: number; totalCredit: number; description: string }>();
  await Promise.all(
    postedEntries.map(async (entry) => {
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
    })
  );

  return { postedEntries, journalTotals, invoices, receipts };
}

/**
 * Find the best match candidates for a single bank transaction.
 * Returns up to `limit` matches sorted by confidence descending.
 */
function matchTransaction(
  txn: BankTransaction,
  pool: CandidatePool,
  usedCandidates?: Set<string>,
  limit = 5
): ReconcileMatch[] {
  const bankAmount = Math.abs(txn.amount);
  const bankDate = new Date(txn.transactionDate);
  const bankDesc = txn.description + (txn.reference ? ' ' + txn.reference : '');
  const isCredit = txn.amount > 0;

  const candidates: ReconcileMatch[] = [];

  // Journal entries (match both directions)
  for (const entry of pool.postedEntries) {
    const key = `je-${entry.id}`;
    if (usedCandidates?.has(key)) continue;

    const totals = pool.journalTotals.get(entry.id);
    if (!totals) continue;

    const candidateAmount = isCredit ? totals.totalDebit : totals.totalCredit;
    if (candidateAmount === 0) continue;

    const entryDate = new Date(entry.date);
    const { score, reasons } = calculateConfidence(
      bankAmount, candidateAmount, bankDate, entryDate, bankDesc, totals.description
    );

    if (score > 0) {
      candidates.push({
        bankTransactionId: txn.id,
        matchedType: 'journal_entry',
        matchedId: entry.id,
        confidence: score,
        matchReason: reasons.join('; '),
        bankDescription: txn.description,
        bankAmount: txn.amount,
        bankDate: txn.transactionDate instanceof Date
          ? txn.transactionDate.toISOString()
          : String(txn.transactionDate),
        matchedDescription: totals.description,
        matchedAmount: candidateAmount,
        matchedDate: entry.date instanceof Date
          ? entry.date.toISOString()
          : String(entry.date),
      });
    }
  }

  // Invoices (credit/inflow transactions)
  if (isCredit) {
    for (const inv of pool.invoices) {
      const key = `inv-${inv.id}`;
      if (usedCandidates?.has(key)) continue;
      if (inv.status === 'void') continue;

      const invDesc = `Invoice ${inv.number} ${(inv as any).customerName || ''}`.trim();
      const { score, reasons } = calculateConfidence(
        bankAmount, inv.total, bankDate, new Date(inv.date), bankDesc, invDesc
      );

      if (score > 0) {
        candidates.push({
          bankTransactionId: txn.id,
          matchedType: 'invoice',
          matchedId: inv.id,
          confidence: score,
          matchReason: reasons.join('; '),
          bankDescription: txn.description,
          bankAmount: txn.amount,
          bankDate: txn.transactionDate instanceof Date
            ? txn.transactionDate.toISOString()
            : String(txn.transactionDate),
          matchedDescription: invDesc,
          matchedAmount: inv.total,
          matchedDate: inv.date instanceof Date
            ? inv.date.toISOString()
            : String(inv.date),
        });
      }
    }
  }

  // Receipts (debit/outflow transactions)
  if (!isCredit) {
    for (const receipt of pool.receipts) {
      const key = `rcpt-${receipt.id}`;
      if (usedCandidates?.has(key)) continue;
      if (!receipt.amount || receipt.amount <= 0) continue;

      const rcptDate = receipt.date ? new Date(receipt.date) : new Date(receipt.createdAt);
      const rcptDesc = `${(receipt as any).merchant || ''} ${receipt.category || ''}`.trim();

      const { score, reasons } = calculateConfidence(
        bankAmount, receipt.amount, bankDate, rcptDate, bankDesc, rcptDesc
      );

      if (score > 0) {
        candidates.push({
          bankTransactionId: txn.id,
          matchedType: 'receipt',
          matchedId: receipt.id,
          confidence: score,
          matchReason: reasons.join('; '),
          bankDescription: txn.description,
          bankAmount: txn.amount,
          bankDate: txn.transactionDate instanceof Date
            ? txn.transactionDate.toISOString()
            : String(txn.transactionDate),
          matchedDescription: rcptDesc || 'Receipt',
          matchedAmount: receipt.amount,
          matchedDate: rcptDate.toISOString(),
        });
      }
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, limit);
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Find the best match candidates for a single bank transaction (for the match dialog).
 */
export async function getSuggestionsForTransaction(
  companyId: string,
  transactionId: string,
  limit = 5
): Promise<ReconcileMatch[]> {
  const txn = await storage.getBankTransactionById(transactionId);
  if (!txn || txn.companyId !== companyId) return [];

  const pool = await loadCandidatePool(companyId);
  return matchTransaction(txn, pool, undefined, limit);
}

/**
 * Scan all unreconciled bank transactions and find their best matches.
 */
export async function autoReconcileTransactions(companyId: string): Promise<AutoReconcileResult> {
  const [unreconciledTxns, pool] = await Promise.all([
    storage.getUnreconciledBankTransactions(companyId),
    loadCandidatePool(companyId),
  ]);

  const matches: ReconcileMatch[] = [];
  const matchedCandidates = new Set<string>();
  const AUTO_MATCH_THRESHOLD = 75;

  for (const txn of unreconciledTxns) {
    const candidates = matchTransaction(txn, pool, matchedCandidates, 1);
    if (candidates.length > 0) {
      const best = candidates[0];
      matches.push(best);
      const prefix = best.matchedType === 'journal_entry' ? 'je'
        : best.matchedType === 'invoice' ? 'inv' : 'rcpt';
      matchedCandidates.add(`${prefix}-${best.matchedId}`);
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence);

  return {
    matches,
    autoMatchedCount: matches.filter((m) => m.confidence >= AUTO_MATCH_THRESHOLD).length,
    manualReviewCount: matches.filter((m) => m.confidence < AUTO_MATCH_THRESHOLD && m.confidence > 0).length,
    totalUnreconciled: unreconciledTxns.length,
  };
}

/**
 * Apply a set of reconciliation matches.
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
