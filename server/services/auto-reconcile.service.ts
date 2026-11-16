import type { Request } from "express";
import { storage } from "../storage";
import { pool } from "../db";
import { has } from "../platform/service-registry";
import { PAYABLE_BILL_STATES } from "./bill-posting.service";
import type { BankTransaction, JournalEntry, Invoice, Receipt } from "../../shared/schema";
import {
  applyMatch,
  dbFils,
  publicErrorMessage,
  type MatchTarget,
} from "./bank-reconciliation.service";

export interface ReconcileMatch {
  bankTransactionId: string;
  matchedType: "journal_entry" | "invoice" | "receipt" | "bill";
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
    for (const m of matches) refs.add(m.toUpperCase().replace(/[/]/g, "-"));
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
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "to",
    "in",
    "for",
    "on",
    "at",
    "by",
    "from",
    "with",
    "ltd",
    "llc",
    "fze",
    "pjsc",
    "llp",
    "inc",
    "co",
    "payment",
    "transfer",
    "bank",
    "charge",
    "fee",
    "aed",
  ]);

  const tokenize = (text: string): Set<string> => {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
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
    reasons.push("Exact amount match");
  } else if (
    candidateAmount > 0 &&
    Math.abs(bankAmount - candidateAmount) / candidateAmount <= 0.01
  ) {
    score += 35;
    reasons.push("Amount within 1%");
  } else if (
    candidateAmount > 0 &&
    Math.abs(bankAmount - candidateAmount) / candidateAmount <= 0.05
  ) {
    score += 15;
    reasons.push("Amount within 5%");
  } else {
    return { score: 0, reasons: [] };
  }

  // Date proximity
  if (datesWithinDays(bankDate, candidateDate, 0)) {
    score += 30;
    reasons.push("Same date");
  } else if (datesWithinDays(bankDate, candidateDate, 1)) {
    score += 25;
    reasons.push("Within 1 day");
  } else if (datesWithinDays(bankDate, candidateDate, 3)) {
    score += 15;
    reasons.push("Within 3 days");
  } else if (datesWithinDays(bankDate, candidateDate, 7)) {
    score += 5;
    reasons.push("Within 7 days");
  }

  // Reference number overlap (invoice #, cheque #, payment ref)
  if (hasReferenceOverlap(bankDesc, candidateDesc)) {
    score += 20;
    reasons.push("Reference number match");
  }

  // Keyword text similarity
  const similarity = textSimilarity(bankDesc, candidateDesc);
  if (similarity >= 0.5) {
    score += 15;
    reasons.push("Strong description match");
  } else if (similarity >= 0.25) {
    score += 10;
    reasons.push("Partial description match");
  } else if (similarity > 0) {
    score += 5;
    reasons.push("Weak description match");
  }

  return { score: Math.min(score, 100), reasons };
}

// ─── Shared data loading ────────────────────────────────────────────────────

/**
 * Candidate pool (W3-C, R06-03). Journal entries are offered only when they carry a line on the
 * bank line's OWN GL account for the same amount and direction (a cash-side entry that is not
 * already matched). A sales/revenue entry (Dr AR / Cr revenue) never qualifies: the invoice is
 * offered instead, at its unpaid remainder, and matching it records the payment.
 */
interface CandidatePool {
  postedEntries: JournalEntry[];
  /** entryId -> accountId -> net fils (debit - credit). */
  entryNets: Map<string, Map<string, number>>;
  entryMemo: Map<string, string>;
  invoices: Array<Invoice & { remainingFils: number }>;
  receipts: Receipt[];
  bills: Array<{ id: string; label: string; date: Date; remainingFils: number }>;
  /** managed bank account id -> GL account id */
  bankGl: Map<string, string>;
  matchedEntryIds: Set<string>;
}

const OPEN_INVOICE_STATUSES = new Set(["sent", "posted", "partial", "overdue"]);

async function loadCandidatePool(companyId: string): Promise<CandidatePool> {
  const [entriesWithLines, invoices, receipts, managedBankAccounts] = await Promise.all([
    storage.getPostedJournalEntriesWithLines(companyId),
    storage.getInvoicesByCompanyId(companyId),
    storage.getReceiptsByCompanyId(companyId),
    storage.getBankAccountsByCompanyId(companyId),
  ]);
  const bankGl = new Map<string, string>();
  for (const b of managedBankAccounts) if (b.glAccountId) bankGl.set(b.id, b.glAccountId);

  const postedEntries: JournalEntry[] = [];
  const entryNets = new Map<string, Map<string, number>>();
  const entryMemo = new Map<string, string>();
  for (const { entry, lines } of entriesWithLines) {
    if (entry.reversedByEntryId || entry.entryKind === "reversal") continue;
    postedEntries.push(entry);
    const nets = new Map<string, number>();
    for (const line of lines) {
      nets.set(
        line.accountId,
        (nets.get(line.accountId) ?? 0) + dbFils(line.debit) - dbFils(line.credit)
      );
    }
    entryNets.set(entry.id, nets);
    entryMemo.set(entry.id, entry.memo || entry.entryNumber);
  }

  const { rows: paidRows } = await pool.query(
    `SELECT invoice_id, COALESCE(SUM(amount), 0)::text AS paid FROM invoice_payments
      WHERE company_id = $1 GROUP BY invoice_id`,
    [companyId]
  );
  const paid = new Map<string, number>(
    (paidRows as Array<{ invoice_id: string; paid: string }>).map((r) => [
      r.invoice_id,
      dbFils(r.paid),
    ])
  );
  const openInvoices = invoices
    .filter((inv) => OPEN_INVOICE_STATUSES.has(inv.status))
    .map((inv) => ({ ...inv, remainingFils: dbFils(inv.total) - (paid.get(inv.id) ?? 0) }))
    .filter((inv) => inv.remainingFils > 0);

  let bills: CandidatePool["bills"] = [];
  if (has("bills.recordPayment")) {
    const { rows } = await pool.query(
      `SELECT id, COALESCE(bill_number, '') AS bill_number, vendor_name, bill_date,
              (COALESCE(total_amount, 0) - COALESCE(amount_paid, 0))::text AS remaining
         FROM vendor_bills
        WHERE company_id = $1 AND status = ANY($2::text[])`,
      // Only bills a payment can be recorded against (approved / overdue / partial): a bill
      // still pending approval is not a payable yet, and applying it would 409 BILL_NOT_PAYABLE.
      [companyId, [...PAYABLE_BILL_STATES]]
    );
    bills = (
      rows as Array<{
        id: string;
        bill_number: string;
        vendor_name: string;
        bill_date: Date;
        remaining: string;
      }>
    )
      .map((b) => ({
        id: b.id,
        label: `Bill ${b.bill_number} ${b.vendor_name}`.trim(),
        date: new Date(b.bill_date),
        remainingFils: dbFils(b.remaining),
      }))
      .filter((b) => b.remainingFils > 0);
  }

  const { rows: matchedRows } = await pool.query(
    `SELECT DISTINCT journal_entry_id FROM bank_transaction_matches
      WHERE company_id = $1 AND status IN ('active', 'pending') AND journal_entry_id IS NOT NULL`,
    [companyId]
  );
  const matchedEntryIds = new Set(
    (matchedRows as Array<{ journal_entry_id: string }>).map((r) => r.journal_entry_id)
  );

  return {
    postedEntries,
    entryNets,
    entryMemo,
    invoices: openInvoices,
    receipts,
    bills,
    bankGl,
    matchedEntryIds,
  };
}

function iso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
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
  const bankFils = dbFils(bankAmount);
  const bankDate = new Date(txn.transactionDate);
  const bankDesc = txn.description + (txn.reference ? " " + txn.reference : "");
  const isCredit = txn.amount > 0;
  const bankGlId =
    (txn.bankStatementAccountId && pool.bankGl.get(txn.bankStatementAccountId)) ||
    txn.bankAccountId ||
    null;

  const candidates: ReconcileMatch[] = [];
  const base = {
    bankTransactionId: txn.id,
    bankDescription: txn.description,
    bankAmount: txn.amount,
    bankDate: iso(txn.transactionDate),
  };

  // Cash-side journal entries on this bank's GL account, same direction and exact amount.
  if (bankGlId) {
    for (const entry of pool.postedEntries) {
      const key = `je-${entry.id}`;
      if (usedCandidates?.has(key) || pool.matchedEntryIds.has(entry.id)) continue;
      const net = pool.entryNets.get(entry.id)?.get(bankGlId) ?? 0;
      if (net === 0 || (isCredit ? net <= 0 : net >= 0) || Math.abs(net) !== bankFils) continue;
      const description = pool.entryMemo.get(entry.id) ?? "";
      const { score, reasons } = calculateConfidence(
        bankAmount,
        Math.abs(net) / 100,
        bankDate,
        new Date(entry.date),
        bankDesc,
        description
      );
      if (score > 0) {
        candidates.push({
          ...base,
          matchedType: "journal_entry",
          matchedId: entry.id,
          confidence: score,
          matchReason: [...reasons, "Entry on this bank account"].join("; "),
          matchedDescription: description,
          matchedAmount: Math.abs(net) / 100,
          matchedDate: iso(entry.date),
        });
      }
    }
  }

  // Open invoices at their unpaid remainder (money in).
  if (isCredit) {
    for (const inv of pool.invoices) {
      const key = `inv-${inv.id}`;
      if (usedCandidates?.has(key)) continue;
      const invDesc = `Invoice ${inv.number} ${inv.customerName || ""}`.trim();
      const remaining = inv.remainingFils / 100;
      const { score, reasons } = calculateConfidence(
        bankAmount,
        remaining,
        bankDate,
        new Date(inv.date),
        bankDesc,
        invDesc
      );
      if (score > 0) {
        candidates.push({
          ...base,
          matchedType: "invoice",
          matchedId: inv.id,
          confidence: score,
          matchReason: reasons.join("; "),
          matchedDescription: invDesc,
          matchedAmount: remaining,
          matchedDate: iso(inv.date),
        });
      }
    }
  }

  if (!isCredit) {
    // Open vendor bills (only when the bill payment service is available).
    for (const bill of pool.bills) {
      const key = `bill-${bill.id}`;
      if (usedCandidates?.has(key)) continue;
      const remaining = bill.remainingFils / 100;
      const { score, reasons } = calculateConfidence(
        bankAmount,
        remaining,
        bankDate,
        bill.date,
        bankDesc,
        bill.label
      );
      if (score > 0) {
        candidates.push({
          ...base,
          matchedType: "bill",
          matchedId: bill.id,
          confidence: score,
          matchReason: reasons.join("; "),
          matchedDescription: bill.label,
          matchedAmount: remaining,
          matchedDate: bill.date.toISOString(),
        });
      }
    }

    // Posted receipts paid from this bank account.
    for (const receipt of pool.receipts) {
      const key = `rcpt-${receipt.id}`;
      if (usedCandidates?.has(key)) continue;
      if (!receipt.posted || !receipt.journalEntryId) continue;
      if (pool.matchedEntryIds.has(receipt.journalEntryId)) continue;
      if (bankGlId && receipt.paymentAccountId && receipt.paymentAccountId !== bankGlId) continue;
      if (!receipt.amount || receipt.amount <= 0) continue;
      const rcptDate = receipt.date ? new Date(receipt.date) : new Date(receipt.createdAt);
      const rcptDesc = `${receipt.merchant || ""} ${receipt.category || ""}`.trim();
      const receiptGross = receipt.amount + (receipt.vatAmount || 0);
      const { score, reasons } = calculateConfidence(
        bankAmount,
        receiptGross,
        bankDate,
        rcptDate,
        bankDesc,
        rcptDesc
      );
      if (score > 0) {
        candidates.push({
          ...base,
          matchedType: "receipt",
          matchedId: receipt.id,
          confidence: score,
          matchReason: reasons.join("; "),
          matchedDescription: rcptDesc || "Receipt",
          matchedAmount: receiptGross,
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
  const txn = await storage.getBankTransactionById(transactionId, companyId);
  if (!txn) return [];

  const pool = await loadCandidatePool(companyId);
  return matchTransaction(txn, pool, undefined, limit);
}

const PREFIX: Record<ReconcileMatch["matchedType"], string> = {
  journal_entry: "je",
  invoice: "inv",
  receipt: "rcpt",
  bill: "bill",
};

/**
 * Scan all unreconciled bank transactions and find their best matches. Read-only: nothing is
 * reconciled until the user applies a suggestion.
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
      matchedCandidates.add(`${PREFIX[best.matchedType]}-${best.matchedId}`);
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence);

  return {
    matches,
    autoMatchedCount: matches.filter((m) => m.confidence >= AUTO_MATCH_THRESHOLD).length,
    manualReviewCount: matches.filter(
      (m) => m.confidence < AUTO_MATCH_THRESHOLD && m.confidence > 0
    ).length,
    totalUnreconciled: unreconciledTxns.length,
  };
}

/**
 * Apply a set of reconciliation matches through the one match service (R06-05): invoices record
 * a payment, journals must be cash-side, every apply is conditional on the line being
 * unreconciled and checks the period lock. Errors carry a code and a message, never SQL (R06-16).
 */
export async function applyReconcileMatches(
  companyId: string,
  matchIds: { bankTransactionId: string; matchedType: string; matchedId: string }[],
  userId: string,
  req?: Request
): Promise<{
  applied: number;
  skipped: number;
  errors: string[];
  results: Array<{ bankTransactionId: string; status: string; code?: string; message?: string }>;
}> {
  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];
  const results: Array<{
    bankTransactionId: string;
    status: string;
    code?: string;
    message?: string;
  }> = [];

  for (const match of matchIds) {
    const type = match.matchedType === "journal_entry" ? "journal" : match.matchedType;
    const target: MatchTarget =
      type === "invoice"
        ? { kind: "invoice", id: match.matchedId }
        : type === "bill"
          ? { kind: "bill", id: match.matchedId }
          : type === "receipt"
            ? { kind: "receipt", id: match.matchedId }
            : { kind: "journal", id: match.matchedId };
    try {
      const r = await applyMatch({
        companyId,
        transactionId: match.bankTransactionId,
        actorId: userId,
        target,
        req,
      });
      if (r.status === "replayed") skipped++;
      else applied++;
      results.push({ bankTransactionId: match.bankTransactionId, status: r.status });
    } catch (err) {
      const e = publicErrorMessage(err);
      if (e.code === "ALREADY_RECONCILED") skipped++;
      errors.push(`Failed to reconcile ${match.bankTransactionId}: ${e.message}`);
      results.push({ bankTransactionId: match.bankTransactionId, status: "error", ...e });
    }
  }

  return { applied, skipped, errors, results };
}
