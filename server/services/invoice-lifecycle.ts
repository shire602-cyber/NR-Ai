// Pure decision logic for invoice lifecycle transitions (void / cancel /
// credit note) and the journal-entry reversal legs they produce.
//
// These functions are intentionally side-effect free so they can be unit
// tested without a database. The route handlers fetch the data (paid totals,
// account ids, existing credit notes) and delegate the *decisions* and the
// *journal math* here. Centralising this removes the previously duplicated —
// and divergent — reversal builders in the void and credit-note paths.
//
// Fixes: A-1 (void of a paid invoice), A-B2 (unbalanced reversal when a VAT
// account is missing), A-B3 (credit-note dedup / cap).

export type JournalLine = {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
};

export type ReversalAccountRefs = {
  accountsReceivableId?: string | null;
  salesRevenueId?: string | null;
  vatPayableId?: string | null;
};

export type ReversalAmounts = {
  subtotal: number;
  vatAmount: number;
  total: number;
};

export type Decision =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

/** Round to 2 decimals, guarding against binary-float drift. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * A-1: An invoice with recorded payments must not be voided/cancelled
 * directly, because the void only reverses revenue/VAT/AR and would leave the
 * cash already received unmatched (orphaned bank balance + abnormal credit AR).
 * The correct path is a credit note plus a refund.
 */
export function evaluateVoidRequest(args: {
  targetStatus: string;
  paidTotal: number;
}): Decision {
  const { targetStatus, paidTotal } = args;
  if (targetStatus !== "void" && targetStatus !== "cancelled") return { ok: true };
  if (round2(paidTotal) > 0) {
    return {
      ok: false,
      status: 409,
      code: "PAID_INVOICE_CANNOT_VOID",
      message:
        "This invoice has recorded payments and cannot be voided directly. " +
        "Issue a credit note (and a refund if cash was received) so the cash " +
        "already collected is properly accounted for.",
    };
  }
  return { ok: true };
}

/**
 * A-B3: Cap and de-duplicate credit notes so the cumulative credited amount
 * can never exceed the original invoice total. Without this, issuing two full
 * credit notes double-reverses AR and drives it negative.
 */
export function evaluateCreditNoteRequest(args: {
  invoiceType: string;
  originalTotal: number; // signed original total (positive for an invoice)
  alreadyCreditedTotal: number; // sum of |total| of existing credit notes
  requestedAmount?: number; // absolute amount to credit; defaults to remaining
}): Decision & { creditable?: number } {
  if (args.invoiceType === "credit_note") {
    return {
      ok: false,
      status: 400,
      code: "CN_OF_CN",
      message: "Cannot create a credit note of a credit note.",
    };
  }
  const originalAbs = Math.abs(round2(args.originalTotal));
  const remaining = round2(originalAbs - round2(args.alreadyCreditedTotal));
  if (remaining <= 0) {
    return {
      ok: false,
      status: 409,
      code: "FULLY_CREDITED",
      message: "This invoice has already been fully credited.",
    };
  }
  const requested =
    args.requestedAmount == null ? remaining : round2(args.requestedAmount);
  if (requested <= 0) {
    return {
      ok: false,
      status: 422,
      code: "INVALID_CREDIT_AMOUNT",
      message: "Credit amount must be a positive number.",
    };
  }
  if (requested > remaining) {
    return {
      ok: false,
      status: 409,
      code: "CREDIT_EXCEEDS_REMAINING",
      message: `Credit amount ${requested} exceeds the remaining creditable balance ${remaining}.`,
    };
  }
  return { ok: true, creditable: requested };
}

/**
 * A-B2: Build the reversal journal legs shared by void and credit-note.
 * Fails hard (422) when a required account is missing instead of silently
 * dropping a leg and posting an unbalanced entry (which previously 500'd deep
 * inside the posting engine). Also asserts the result is balanced.
 *
 * Produces: Dr Revenue (subtotal), Dr VAT (vatAmount, if any), Cr AR (total).
 */
export function buildReversalLines(args: {
  amounts: ReversalAmounts;
  accounts: ReversalAccountRefs;
  labels: { revenue: string; vat: string; ar: string };
}):
  | { ok: true; lines: JournalLine[] }
  | { ok: false; status: number; code: string; message: string } {
  const subtotal = round2(args.amounts.subtotal);
  const vatAmount = round2(args.amounts.vatAmount);
  const total = round2(args.amounts.total);
  const { accounts, labels } = args;

  if (!accounts.accountsReceivableId || !accounts.salesRevenueId) {
    return {
      ok: false,
      status: 422,
      code: "CHART_OF_ACCOUNTS_MISSING",
      message:
        "Cannot post reversal: Accounts Receivable or Revenue account is " +
        "missing. Seed the default chart of accounts first.",
    };
  }
  if (vatAmount > 0 && !accounts.vatPayableId) {
    return {
      ok: false,
      status: 422,
      code: "VAT_ACCOUNT_MISSING",
      message:
        "Cannot post reversal: output VAT was charged but the VAT Payable " +
        "account is missing from the chart of accounts.",
    };
  }

  const lines: JournalLine[] = [
    { accountId: accounts.salesRevenueId, debit: subtotal, credit: 0, description: labels.revenue },
  ];
  if (vatAmount > 0 && accounts.vatPayableId) {
    lines.push({ accountId: accounts.vatPayableId, debit: vatAmount, credit: 0, description: labels.vat });
  }
  lines.push({ accountId: accounts.accountsReceivableId, debit: 0, credit: total, description: labels.ar });

  const dr = round2(lines.reduce((s, l) => s + l.debit, 0));
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) > 0.01) {
    return {
      ok: false,
      status: 500,
      code: "UNBALANCED_REVERSAL",
      message: `Reversal entry is unbalanced (debits ${dr} vs credits ${cr}).`,
    };
  }
  return { ok: true, lines };
}
