// P3 — completeness for the email-intake pipeline.
//
// OCR can extract only what arrived; it can never flag a document that was never
// sent. A VAT return is correct only when ALL sales and purchases for the period
// are captured. The completeness check pairs intake with bank reconciliation:
// an unmatched bank line is money that moved with no supporting document, i.e.
// "evidence we expect but haven't received" — exactly what to chase before
// filing. This is the control that turns "documents we happened to get" into
// "documents that reconcile to actual cash movement".
//
// Pure + unit-tested. See docs/EMAIL_INTAKE_PILOT.md §4.

export type MatchStatus = "matched" | "suggested" | "unmatched";

/** Subset of a bank_transactions row this module needs. */
export interface BankLine {
  id: string;
  transactionDate: Date | string;
  amount: number; // signed: positive = inflow (credit), negative = outflow (debit)
  description?: string | null;
  matchStatus: MatchStatus;
  matchedReceiptId?: string | null;
  matchedInvoiceId?: string | null;
}

export type EvidenceGapKind = "missing_purchase_evidence" | "missing_sales_evidence";

export interface EvidenceGap {
  bankTransactionId: string;
  date: Date;
  amount: number; // absolute value
  direction: "inflow" | "outflow";
  kind: EvidenceGapKind;
  description: string;
}

export interface CompletenessSummary {
  periodStart: Date;
  periodEnd: Date;
  totalLines: number;
  matchedLines: number;
  unmatchedLines: number;
  /** matched / total in [0,1]; 1 when there are no lines (nothing to reconcile). */
  coverageRatio: number;
  unmatchedOutflowValue: number; // sum |amount| of unmatched outflows (missing purchases)
  unmatchedInflowValue: number; // sum |amount| of unmatched inflows (missing sales)
  gapCount: number;
}

export interface CompletenessResult {
  summary: CompletenessSummary;
  gaps: EvidenceGap[];
}

function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

/** Inclusive of both ends (period boundaries are normalised by the caller). */
export function isWithinPeriod(date: Date, start: Date, end: Date): boolean {
  const t = date.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Compute the completeness gaps for a period.
 *
 * A bank line is a gap when it is NOT matched (status !== "matched" AND no linked
 * receipt/invoice) — "suggested" still counts as a gap because a human hasn't
 * confirmed it. Outflows without evidence are missing *purchase* documents;
 * inflows without evidence are possibly-unrecorded *sales*. Zero-amount lines are
 * ignored.
 */
export function computeCompletenessGaps(args: {
  lines: BankLine[];
  periodStart: Date;
  periodEnd: Date;
}): CompletenessResult {
  const { lines, periodStart, periodEnd } = args;
  const inPeriod = lines.filter((l) => isWithinPeriod(toDate(l.transactionDate), periodStart, periodEnd));

  let matchedLines = 0;
  let unmatchedOutflowValue = 0;
  let unmatchedInflowValue = 0;
  const gaps: EvidenceGap[] = [];

  for (const l of inPeriod) {
    const confirmedMatch =
      l.matchStatus === "matched" || Boolean(l.matchedReceiptId) || Boolean(l.matchedInvoiceId);
    if (confirmedMatch) {
      matchedLines++;
      continue;
    }
    if (!l.amount) continue; // zero lines carry no evidence obligation

    const isOutflow = l.amount < 0;
    const abs = round2(Math.abs(l.amount));
    if (isOutflow) unmatchedOutflowValue = round2(unmatchedOutflowValue + abs);
    else unmatchedInflowValue = round2(unmatchedInflowValue + abs);

    gaps.push({
      bankTransactionId: l.id,
      date: toDate(l.transactionDate),
      amount: abs,
      direction: isOutflow ? "outflow" : "inflow",
      kind: isOutflow ? "missing_purchase_evidence" : "missing_sales_evidence",
      description: (l.description ?? "").slice(0, 200),
    });
  }

  // Largest gaps first — chase the highest-value missing evidence soonest.
  gaps.sort((a, b) => b.amount - a.amount);

  const totalLines = inPeriod.length;
  const unmatchedLines = totalLines - matchedLines;
  const coverageRatio = totalLines === 0 ? 1 : round2(matchedLines / totalLines);

  return {
    summary: {
      periodStart,
      periodEnd,
      totalLines,
      matchedLines,
      unmatchedLines,
      coverageRatio,
      unmatchedOutflowValue,
      unmatchedInflowValue,
      gapCount: gaps.length,
    },
    gaps,
  };
}
