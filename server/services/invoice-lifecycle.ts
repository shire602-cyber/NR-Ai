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

import { DomainError } from "../errors";
import { fromFils } from "../../shared/money";
import { UAE_STANDARD_VAT_RATE, type SupplyType } from "../../shared/vat-classification";
import {
  computeSalesDocument,
  DocumentTotalsError,
  type SalesDocumentTotals,
} from "./document-totals.service";
import { journalLine } from "@shared/journal-memo";

export type JournalLine = {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
  /** System line description key + params (shared/journal-memo.ts), stored on the journal line. */
  lineKey?: string;
  lineParams?: Record<string, string>;
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

export type Decision = { ok: true } | { ok: false; status: number; code: string; message: string };

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
export function evaluateVoidRequest(args: { targetStatus: string; paidTotal: number }): Decision {
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
  const requested = args.requestedAmount == null ? remaining : round2(args.requestedAmount);
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
 * A-B12: Split an incoming payment into the portion that settles the
 * outstanding receivable and any excess that should be parked as a customer
 * credit (a liability), instead of rejecting overpayments outright.
 *
 * `excess` within `tolerance` (legitimate 2dp rounding) is absorbed into the
 * receivable rather than creating a sub-cent liability.
 */
export function allocatePayment(args: { amount: number; remaining: number; tolerance?: number }): {
  appliedToReceivable: number;
  customerCredit: number;
} {
  const tol = args.tolerance ?? 0.005;
  const amount = args.amount;
  const remaining = Math.max(0, args.remaining);
  const excess = amount - remaining;
  if (excess <= tol) {
    return { appliedToReceivable: round2(amount), customerCredit: 0 };
  }
  return { appliedToReceivable: round2(remaining), customerCredit: round2(excess) };
}

/**
 * A-B5: Realised FX on settling a foreign-currency invoice. The receivable was
 * booked (and is cleared) at the invoice rate; the cash is received at the
 * payment-date rate. The AED difference on the applied portion is a realised
 * gain (cash worth more than the AR being cleared) or loss. All outputs AED.
 */
export function computeRealisedFx(args: {
  appliedForeign: number; // portion of the payment applied to the receivable, in invoice currency
  invoiceRate: number; // AED per unit at which AR was booked
  paymentRate: number; // AED per unit on the payment date
}): { arClearedAed: number; cashAed: number; realisedGainLoss: number } {
  const inv = args.invoiceRate > 0 ? args.invoiceRate : 1;
  const pay = args.paymentRate > 0 ? args.paymentRate : inv;
  const arClearedAed = round2(args.appliedForeign * inv);
  const cashAed = round2(args.appliedForeign * pay);
  return { arClearedAed, cashAed, realisedGainLoss: round2(cashAed - arClearedAed) };
}

/**
 * Build the balanced journal legs for an invoice payment, including A-B12
 * overpayment (customer credit) and A-B5 realised FX. Pure so the money math
 * is fully unit-tested independently of the SQL insert path:
 *   Dr  payment account (cash)                 (applied + credit) * paymentRate
 *   Cr  receivable                             applied * invoiceRate
 *   Cr  customer credit (overpayment)          credit * paymentRate   [if any]
 *   Cr/Dr FX gain/loss                          realised FX            [if any]
 * With paymentRate == invoiceRate (the default, no rate supplied) there is no
 * FX leg and the result is identical to the original two-leg entry.
 */
export function buildPaymentJournalLines(args: {
  appliedToReceivable: number; // foreign currency
  customerCredit: number; // foreign currency
  invoiceRate: number;
  paymentRate: number;
  paymentAccountId: string;
  receivableAccountId: string;
  customerCreditAccountId?: string | null;
  fxGainAccountId?: string | null;
  fxLossAccountId?: string | null;
  /** Invoice number (or id) the payment settles; the line descriptions name it. */
  ref?: string;
  /** W3-A: AED to clear from A/R when this payment settles the invoice in
   *  full — the exact residual on the ledger, so rate rounding on earlier
   *  credits / part-payments never leaves a fils on A/R (goes to FX). */
  receivableCreditAedOverride?: number | null;
}):
  | { ok: true; lines: JournalLine[]; realisedFx: number }
  | { ok: false; code: string; message: string } {
  const invRate = args.invoiceRate > 0 ? args.invoiceRate : 1;
  const payRate = args.paymentRate > 0 ? args.paymentRate : invRate;
  const lineParams = { ref: args.ref ?? "payment" };
  const arCreditAed =
    args.receivableCreditAedOverride != null && args.receivableCreditAedOverride > 0
      ? round2(args.receivableCreditAedOverride)
      : round2(args.appliedToReceivable * invRate);
  const custCreditAed = round2(args.customerCredit * payRate);
  const bankDebitAed = round2((args.appliedToReceivable + args.customerCredit) * payRate);
  const realisedFx = round2(bankDebitAed - arCreditAed - custCreditAed);

  if (custCreditAed > 0 && !args.customerCreditAccountId) {
    return {
      ok: false,
      code: "CUSTOMER_CREDIT_ACCOUNT_MISSING",
      message: "Customer-credit account is required for the overpayment.",
    };
  }
  if (realisedFx > 0 && !args.fxGainAccountId) {
    return {
      ok: false,
      code: "REALISED_FX_ACCOUNT_MISSING",
      message: "FX Gain account is required for realised FX.",
    };
  }
  if (realisedFx < 0 && !args.fxLossAccountId) {
    return {
      ok: false,
      code: "REALISED_FX_ACCOUNT_MISSING",
      message: "FX Loss account is required for realised FX.",
    };
  }

  const lines: JournalLine[] = [
    {
      accountId: args.paymentAccountId,
      debit: bankDebitAed,
      credit: 0,
      ...journalLine("paymentCashReceived", lineParams),
    },
    {
      accountId: args.receivableAccountId,
      debit: 0,
      credit: arCreditAed,
      ...journalLine("paymentClearAr", lineParams),
    },
  ];
  if (custCreditAed > 0 && args.customerCreditAccountId) {
    lines.push({
      accountId: args.customerCreditAccountId,
      debit: 0,
      credit: custCreditAed,
      ...journalLine("paymentCustomerCredit", lineParams),
    });
  }
  if (realisedFx > 0 && args.fxGainAccountId) {
    lines.push({
      accountId: args.fxGainAccountId,
      debit: 0,
      credit: realisedFx,
      ...journalLine("paymentFxGain", lineParams),
    });
  } else if (realisedFx < 0 && args.fxLossAccountId) {
    lines.push({
      accountId: args.fxLossAccountId,
      debit: -realisedFx,
      credit: 0,
      ...journalLine("paymentFxLoss", lineParams),
    });
  }

  const dr = round2(lines.reduce((s, l) => s + l.debit, 0));
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) > 0.01) {
    return {
      ok: false,
      code: "UNBALANCED_PAYMENT",
      message: `Payment entry unbalanced (${dr} vs ${cr}).`,
    };
  }
  return { ok: true, lines, realisedFx };
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
    lines.push({
      accountId: accounts.vatPayableId,
      debit: vatAmount,
      credit: 0,
      description: labels.vat,
    });
  }
  lines.push({
    accountId: accounts.accountsReceivableId,
    debit: 0,
    credit: total,
    description: labels.ar,
  });

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

// ─── W3-A: shared sales-document preparation (pure) ─────────────────────────

/** Validated line as accepted by shared/validators/invoices.ts (unit price in fils). */
export interface SalesLineDraft {
  description: string;
  quantity: number;
  unitPrice: number; // fils
  vatRate?: number;
  vatSupplyType?: SupplyType | null;
  discountType?: "amount" | "percent" | null;
  discountValue?: number | null;
  productId?: string | null;
  costCenterId?: string | null;
  /** E3: the income account a standard-rated invoice line posts to (null = by item type). */
  revenueAccountId?: string | null;
  /** S1: profit-margin scheme line (invoices only) and its purchase cost in fils. */
  marginScheme?: boolean | null;
  marginPurchaseCost?: number | null;
}

export interface PreparedSalesLine {
  description: string;
  quantity: number;
  unitPrice: number;
  unitPriceFils: number;
  vatRate: number;
  vatSupplyType: SupplyType;
  discountType: string | null;
  discountValue: number | null;
  discountAmount: number;
  netAmount: number;
  productId: string | null;
  costCenterId: string | null;
  revenueAccountId: string | null;
  marginScheme: boolean;
  /** Major units (invoice_lines.margin_purchase_cost); null unless marginScheme. */
  marginPurchaseCost: number | null;
}

/**
 * Resolve supply types (0% needs an explicit type — 400 SUPPLY_TYPE_REQUIRED),
 * apply discounts and compute totals in fils. The rows are ready for
 * invoice_lines / quote_lines.
 */
export function prepareSalesLines(
  lines: SalesLineDraft[],
  opts: {
    discountType?: string | null;
    discountValue?: number | null;
    reverseCharge?: boolean | null;
  } = {}
): { rows: PreparedSalesLine[]; totals: SalesDocumentTotals } {
  let totals: SalesDocumentTotals;
  try {
    totals = computeSalesDocument(
      lines.map((l) => ({
        quantity: l.quantity,
        unitPriceFils: l.unitPrice,
        vatRate: l.vatRate ?? UAE_STANDARD_VAT_RATE,
        vatSupplyType: l.vatSupplyType ?? null,
        discountType: l.discountType ?? null,
        discountValue: l.discountValue ?? null,
        marginScheme: l.marginScheme ?? false,
        marginCostFils: l.marginScheme ? (l.marginPurchaseCost ?? null) : null,
      })),
      { ...opts, resolve: true }
    );
  } catch (err) {
    if (err instanceof DocumentTotalsError) {
      const field =
        err.lineIndex === undefined
          ? "discountValue"
          : `lines.${err.lineIndex}.${
              err.code.startsWith("SUPPLY") || err.code === "INVALID_VAT_RATE"
                ? "vatSupplyType"
                : err.code.startsWith("MARGIN")
                  ? "marginScheme"
                  : "discountValue"
            }`;
      throw new DomainError(err.code, 400, { fields: { [field]: [err.message] } }, err.message);
    }
    throw err;
  }
  if (totals.totalFils > 900_000_000_000_000) {
    throw new DomainError(
      "AMOUNT_OUT_OF_RANGE",
      422,
      undefined,
      "Document total is too large to record."
    );
  }
  const rows = lines.map((l, i) => {
    const t = totals.lines[i];
    return {
      description: l.description,
      quantity: l.quantity,
      unitPrice: Number(fromFils(l.unitPrice)),
      unitPriceFils: l.unitPrice,
      vatRate: t.vatRate,
      vatSupplyType: t.classification.supplyType,
      discountType: l.discountType ?? null,
      discountValue: l.discountType ? Number(l.discountValue) : null,
      discountAmount: Number(fromFils(t.lineDiscountFils)),
      netAmount: Number(fromFils(t.netFils)),
      productId: l.productId ?? null,
      costCenterId: l.costCenterId ?? null,
      revenueAccountId: l.revenueAccountId ?? null,
      marginScheme: !!l.marginScheme,
      marginPurchaseCost: l.marginScheme ? Number(fromFils(l.marginPurchaseCost ?? 0)) : null,
    };
  });
  return { rows, totals };
}

/** Due date implied by payment terms ("net30" → +30 days; due_on_receipt → same day). */
export function dueDateFromTerms(dateIso: string, terms: string | null | undefined): string | null {
  if (!terms) return null;
  let days: number | null = null;
  if (terms === "due_on_receipt") days = 0;
  const m = /^net(\d{1,3})$/.exec(terms);
  if (m) days = Number(m[1]);
  if (days === null) return null;
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Contact payment terms are stored in days (integer). */
export function termsFromDays(days: number | null | undefined): string | null {
  if (days === null || days === undefined || !Number.isFinite(days) || days < 0) return null;
  return days === 0 ? "due_on_receipt" : `net${Math.round(days)}`;
}
