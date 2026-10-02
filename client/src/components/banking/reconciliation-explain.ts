// Turns the statement-versus-ledger report into the list a reviewer reads: every reconciling item with its type, its
// document and its amount, and a verdict that never says "balanced" while an item still needs an explanation.
//
// An item the books already have and the statement also has (same amount, one in each list) is not a timing
// difference: it is one transaction that was never matched. Those pairs are called out so they get matched, not signed off.

import type { LedgerItem, ReconciliationStatement, StatementItem } from "@/lib/banking-api-types";

export type ItemType = "DEPOSIT_IN_TRANSIT" | "OUTSTANDING_PAYMENT" | "STATEMENT_CREDIT" | "STATEMENT_DEBIT";

export interface ExplainedItem {
  key: string;
  type: ItemType;
  date: string;
  /** The document behind the item: the ledger entry's source and number, or the statement line's reference. */
  document: { source: string | null; number: string | null; reference: string | null };
  description: string;
  /** Always positive; the type says which way it moves. */
  amount: number;
  /** The key of the item on the other side that looks like the same transaction. */
  pairedWith: string | null;
}

const same = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

function fromLedger(item: LedgerItem, type: ItemType): ExplainedItem {
  return {
    key: `L:${item.entryId}`,
    type,
    date: item.date,
    document: { source: item.source, number: item.entryNumber, reference: null },
    description: item.memo || item.entryNumber,
    amount: Math.abs(item.amount),
    pairedWith: null,
  };
}

function fromStatement(item: StatementItem, type: ItemType): ExplainedItem {
  return {
    key: `S:${item.transactionId}`,
    type,
    date: item.date,
    document: { source: null, number: null, reference: item.reference },
    description: item.description,
    amount: Math.abs(item.amount),
    pairedWith: null,
  };
}

function pair(ledger: ExplainedItem[], statement: ExplainedItem[]): void {
  const taken = new Set<string>();
  for (const l of ledger) {
    const match = statement.find((s) => !taken.has(s.key) && same(s.amount, l.amount));
    if (match) {
      taken.add(match.key);
      l.pairedWith = match.key;
      match.pairedWith = l.key;
    }
  }
}

export function explainItems(report: ReconciliationStatement): ExplainedItem[] {
  const deposits = report.items.depositsInTransit.map((i) => fromLedger(i, "DEPOSIT_IN_TRANSIT"));
  const outstanding = report.items.outstandingPayments.map((i) => fromLedger(i, "OUTSTANDING_PAYMENT"));
  const credits = report.items.unreconciledCredits.map((i) => fromStatement(i, "STATEMENT_CREDIT"));
  const debits = report.items.unreconciledDebits.map((i) => fromStatement(i, "STATEMENT_DEBIT"));
  pair(deposits, credits);
  pair(outstanding, debits);
  return [...deposits, ...outstanding, ...credits, ...debits].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

export type Verdict = "balanced" | "balanced_with_unmatched" | "not_balanced" | "needs_statement_balance";

export interface ReconciliationVerdict {
  verdict: Verdict;
  /** Items whose twin is on the other side: matching them is what removes them from the list. */
  unmatchedPairs: number;
  items: ExplainedItem[];
}

/** "balanced" only when the difference is 0 and no item is half of an unmatched pair. */
export function reconciliationVerdict(report: ReconciliationStatement): ReconciliationVerdict {
  const items = explainItems(report);
  const unmatchedPairs = items.filter((i) => i.pairedWith && i.key.startsWith("L:")).length;
  if (report.difference === null || report.difference === undefined) return { verdict: "needs_statement_balance", unmatchedPairs, items };
  if (Math.abs(report.difference) >= 0.005) return { verdict: "not_balanced", unmatchedPairs, items };
  return { verdict: unmatchedPairs > 0 ? "balanced_with_unmatched" : "balanced", unmatchedPairs, items };
}
