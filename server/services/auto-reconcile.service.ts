// Legacy auto-reconcile surface (POST /auto-reconcile and /auto-reconcile/apply), kept as a thin adapter over the new
// matching: suggestions come from bank-matching.service (suggest only), and applying delegates to bulk-match, which
// validates the whole batch, posts through the document services (an invoice payment for an invoice, a bill payment for
// a bill) and never credits a control account without a document.

import { storage } from "../storage";
import { AppError } from "../errors";
import { suggestForTransactions, type Suggestion } from "./bank-matching.service";
import { bulkMatch, type BulkItem } from "./bank-bulk-match.service";
import type { MatchKind } from "./bank-posting.service";

export interface ReconcileMatch {
  bankTransactionId: string;
  matchedType: "journal_entry" | "invoice" | "receipt" | "bill";
  matchedId: string;
  confidence: number;
  matchReason: string;
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

const AUTO_MATCH_THRESHOLD = 80;
const LEGACY_KINDS: Record<string, ReconcileMatch["matchedType"]> = { invoice: "invoice", bill: "bill", receipt: "receipt", journal: "journal_entry" };

export function toLegacyMatch(s: Suggestion, description: string): ReconcileMatch | null {
  const matchedType = LEGACY_KINDS[s.kind];
  if (!matchedType) return null; // rules and clearing accounts have their own screens
  return {
    bankTransactionId: s.transactionId,
    matchedType,
    matchedId: s.targetId,
    confidence: s.confidence,
    matchReason: s.reasons.join("; "),
    bankDescription: description,
    bankAmount: s.amount,
    bankDate: s.date,
    matchedDescription: s.label,
    matchedDate: s.date,
  };
}

/** Best suggestion per open bank line (one-to-one), in the legacy shape. Nothing is posted. */
export async function autoReconcileTransactions(companyId: string): Promise<AutoReconcileResult> {
  const unreconciled = await storage.getUnreconciledBankTransactions(companyId);
  const suggestions = await suggestForTransactions(companyId, unreconciled, 1);
  const byId = new Map(unreconciled.map((t) => [t.id, t]));
  const matches = suggestions
    .map((s) => toLegacyMatch(s, byId.get(s.transactionId)?.description ?? ""))
    .filter((m): m is ReconcileMatch => m !== null)
    .sort((a, b) => b.confidence - a.confidence);
  return {
    matches,
    autoMatchedCount: matches.filter((m) => m.confidence >= AUTO_MATCH_THRESHOLD).length,
    manualReviewCount: matches.filter((m) => m.confidence < AUTO_MATCH_THRESHOLD && m.confidence > 0).length,
    totalUnreconciled: unreconciled.length,
  };
}

const KIND_OF: Record<string, MatchKind> = { invoice: "invoice", bill: "bill", receipt: "receipt", journal: "journal", journal_entry: "journal" };

/**
 * Apply matches through bulk-match. A batch that cannot be applied as a whole comes back as `applied: 0` with the
 * reasons (the 200 + errors shape this endpoint always had); a race that stops the run reports what was applied.
 */
export async function applyReconcileMatches(
  companyId: string,
  matches: { bankTransactionId: string; matchedType: string; matchedId: string }[],
  userId: string
): Promise<{ applied: number; errors: string[] }> {
  const items: BulkItem[] = matches.map((m) => ({ transactionId: m.bankTransactionId, kind: KIND_OF[m.matchedType] ?? "journal", targetId: m.matchedId }));
  try {
    const outcome = await bulkMatch({ companyId, userId }, items);
    return { applied: outcome.applied, errors: [] };
  } catch (err) {
    if (err instanceof AppError && err.code === "BULK_MATCH_INVALID") {
      const errors = ((err.details as { errors?: Array<{ transactionId: string; message: string }> })?.errors ?? []).map((e) => `Failed to reconcile ${e.transactionId}: ${e.message}`);
      return { applied: 0, errors: errors.length ? errors : [err.message] };
    }
    if (err instanceof AppError && err.code === "BULK_MATCH_PARTIAL") {
      const d = err.details as { applied?: string[]; failed?: { transactionId: string; message: string } };
      return { applied: d.applied?.length ?? 0, errors: d.failed ? [`Failed to reconcile ${d.failed.transactionId}: ${d.failed.message}`] : [err.message] };
    }
    throw err;
  }
}
