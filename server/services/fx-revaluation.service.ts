// Unrealised FX revaluation of OPEN foreign-currency balances - pure maths.
//
//   adjustment = outstanding foreign amount x (current rate - booked rate)
//   receivable: gain when the foreign currency strengthened
//   payable:    gain when it weakened (the AED cost of what we owe fell)
//
// "Outstanding" is the shared definition (invoice-outstanding.ts for invoices;
// total - payments for bills): a partly paid, partly credited or settled
// document is revalued on what is still open, never on its full total.
//
// Every run is a FULL recomputation. That is correct because each revaluation
// entry is auto-reversed the next day (see the revalue route), so an earlier
// run is already back at zero when the next one posts - nothing stacks and no
// delta against earlier runs is needed.

import { revalueForeignBalance } from "./financial-statements";

/**
 * Which invoices are candidates for revaluation as of a date: everything that
 * was ever issued. Whether it is still OPEN on that date is decided by the
 * balance as of the date (payments/credits dated after it do not count), never
 * by the status today, so an invoice paid after the date is still revalued.
 */
export function isRevaluationScopeStatus(status: string | null | undefined): boolean {
  return !["draft", "void", "cancelled"].includes(String(status));
}

/** Vendor bills that were approved (posted to A/P), whatever became of them later. */
export function isBillRevaluationScopeStatus(status: string | null | undefined): boolean {
  return ["approved", "partial", "paid", "overdue"].includes(String(status));
}

export interface RevaluationItem {
  id: string;
  kind: "receivable" | "payable";
  currency: string;
  /** Outstanding amount in the document currency. */
  outstandingForeign: number;
  /** AED per 1 unit of foreign currency when the document was booked. */
  bookRate: number;
  /** AED per 1 unit at the revaluation date; null when no rate is available. */
  currentRate: number | null;
  /** Display only. */
  number?: string;
  counterparty?: string;
}

export interface RevaluedItem extends RevaluationItem {
  currentRate: number;
  bookValueAed: number;
  currentValueAed: number;
  /** Positive = gain, negative = loss (AED, signed for the document's side). */
  adjustmentAed: number;
}

export interface RevaluationResult {
  items: RevaluedItem[];
  skipped: Array<{ id: string; reason: "NO_RATE" }>;
  /** Net AED result over receivables (positive = gain). */
  receivableRevalAed: number;
  /** Net AED result over payables, signed so positive = gain. */
  payableRevalAed: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeRevaluation(items: RevaluationItem[]): RevaluationResult {
  const revalued: RevaluedItem[] = [];
  const skipped: RevaluationResult["skipped"] = [];
  let receivableRevalAed = 0;
  let payableRevalAed = 0;

  for (const item of items) {
    if (!(item.outstandingForeign > 0.005)) continue; // nothing open
    if (item.currentRate === null || !(item.currentRate > 0)) {
      skipped.push({ id: item.id, reason: "NO_RATE" });
      continue;
    }
    const { bookValueAed, currentValueAed, unrealizedGainLoss } = revalueForeignBalance({
      foreignAmount: item.outstandingForeign,
      bookRateAedPerUnit: item.bookRate,
      currentRateAedPerUnit: item.currentRate,
      kind: item.kind,
    });
    revalued.push({
      ...item,
      currentRate: item.currentRate,
      bookValueAed,
      currentValueAed,
      adjustmentAed: unrealizedGainLoss,
    });
    if (item.kind === "receivable") receivableRevalAed += unrealizedGainLoss;
    else payableRevalAed += unrealizedGainLoss;
  }

  return {
    items: revalued,
    skipped,
    receivableRevalAed: round2(receivableRevalAed),
    payableRevalAed: round2(payableRevalAed),
  };
}
