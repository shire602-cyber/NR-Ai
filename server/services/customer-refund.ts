// Pure rules and journal math for customer refunds (cash paid back against a credit note).
// No database or framework imports: the money logic is unit-tested on its own; the database half is
// customer-refund.service.ts.
//
// What can be refunded. A credit note reduces what the customer owes. When the invoice was already paid
// (or the credit is larger than the unpaid rest) the receivable ends up with a CREDIT balance: the
// customer is owed money. A refund pays that out:
//
//   Dr  Accounts receivable (1040)          amount x credit-note rate   (clears the credit, at the rate it was booked)
//   Dr/Cr  FX loss / FX gain                the difference, when the cash rate differs
//   Cr  bank account                        amount x refund-date rate
//
// A refund reduces the credit note's refundable amount exactly the way it reduces the ledger: the amount
// left to refund on a credit note is the smaller of
//   (a) the credit note's total minus its live (not voided) refunds, and
//   (b) the credit the receivable still holds for the invoice (AED, net of every refund).
// (b) is read from the ledger, so a credit note on an UNPAID invoice (which only reduces what is owed)
// has nothing to refund, and the second of two refunds can never take more than the first left.

import Decimal from "decimal.js";
import { round2, type JournalLine } from "./invoice-lifecycle";

const D = (n: number | string) => new Decimal(n);
const TOLERANCE_AED = 0.01;

export type RefundFailure = { ok: false; status: number; code: string; message: string };

export interface RefundableInput {
  /** Absolute total of the credit note, document currency. */
  creditNoteTotal: number;
  /** Sum of the credit note's live (not voided) refunds, document currency. */
  refundedLive: number;
  /** Credit the receivable holds for the invoice and its credit notes, AED, net of refunds (>= 0). */
  receivableCreditAed: number;
  /** AED per unit the credit note was booked at (the invoice's rate). */
  creditNoteRate: number;
}

export interface Refundable {
  /** Credit note total minus its live refunds. */
  creditNoteRemaining: number;
  /** What may still be paid out, document currency (never above creditNoteRemaining). */
  refundable: number;
}

export function computeRefundable(input: RefundableInput): Refundable {
  const rate = input.creditNoteRate > 0 ? input.creditNoteRate : 1;
  const creditNoteRemaining = Decimal.max(0, D(input.creditNoteTotal).minus(input.refundedLive));
  const ledgerCredit = Decimal.max(0, D(input.receivableCreditAed)).div(rate);
  const refundable = Decimal.min(creditNoteRemaining, ledgerCredit).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return {
    creditNoteRemaining: creditNoteRemaining.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    refundable: refundable.toNumber(),
  };
}

const fail = (status: number, code: string, message: string): RefundFailure => ({ ok: false, status, code, message });

export interface EvaluateRefundInput extends RefundableInput {
  creditNoteStatus: string;
  creditNoteType: string;
  /** Calendar day (YYYY-MM-DD) of the credit note and of the refund. */
  creditNoteDate: string;
  refundDate: string;
  amount: number;
}

/** null when the refund may be posted, else the refusal. */
export function evaluateRefund(input: EvaluateRefundInput): RefundFailure | null {
  if (input.creditNoteType !== "credit_note") {
    return fail(422, "NOT_A_CREDIT_NOTE", "Only a credit note can be refunded.");
  }
  if (input.creditNoteStatus === "void" || input.creditNoteStatus === "cancelled") {
    return fail(409, "CREDIT_NOTE_VOID", "This credit note is void: nothing can be refunded against it.");
  }
  if (input.creditNoteStatus === "draft") {
    return fail(409, "CREDIT_NOTE_NOT_ISSUED", "This credit note is not issued yet: issue it before refunding.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return fail(422, "INVALID_REFUND_AMOUNT", "Refund amount must be a positive number.");
  }
  if (input.refundDate < input.creditNoteDate) {
    return fail(
      422,
      "REFUND_BEFORE_CREDIT_NOTE",
      `Refund date ${input.refundDate} is before the credit note date ${input.creditNoteDate}.`
    );
  }
  const { refundable, creditNoteRemaining } = computeRefundable(input);
  const rate = input.creditNoteRate > 0 ? input.creditNoteRate : 1;
  const amountAed = D(input.amount).times(rate);
  const withinCreditNote = D(input.amount).lte(creditNoteRemaining.toFixed(2)) || D(input.amount).minus(creditNoteRemaining).abs().lte(0.005);
  const withinLedger = amountAed.lte(D(Math.max(0, input.receivableCreditAed)).plus(TOLERANCE_AED));
  if (!withinCreditNote || !withinLedger) {
    const why =
      creditNoteRemaining <= 0
        ? "this credit note has already been refunded in full"
        : refundable <= 0
          ? "the customer has no credit to refund (the credit note only reduced what the invoice still owed)"
          : `the most that can be refunded is ${refundable.toFixed(2)}`;
    return fail(
      422,
      "REFUND_EXCEEDS_REMAINING",
      `Cannot refund ${round2(input.amount).toFixed(2)}: ${why}.`
    );
  }
  return null;
}

export interface RefundJournalArgs {
  /** Document currency. */
  amount: number;
  /** AED per unit the receivable was booked at (the credit note's / invoice's rate). */
  creditNoteRate: number;
  /** AED per unit on the refund date; equals creditNoteRate when no separate rate was given. */
  refundRate: number;
  bankAccountId: string;
  receivableAccountId: string;
  fxGainAccountId?: string | null;
  fxLossAccountId?: string | null;
  currency?: string;
  label: string;
}

export type RefundLine = JournalLine & { foreignCurrency?: string; exchangeRate?: number; foreignDebit?: number };

export type RefundJournal = { ok: true; lines: RefundLine[]; realisedFx: number } | RefundFailure;

/** Balanced legs of a refund. With refundRate == creditNoteRate there is no FX leg. */
export function buildRefundJournalLines(args: RefundJournalArgs): RefundJournal {
  const bookRate = args.creditNoteRate > 0 ? args.creditNoteRate : 1;
  const cashRate = args.refundRate > 0 ? args.refundRate : bookRate;
  const arDebit = round2(D(args.amount).times(bookRate).toNumber());
  const bankCredit = round2(D(args.amount).times(cashRate).toNumber());
  const fx = round2(bankCredit - arDebit); // > 0: paid out more AED than the receivable cleared = loss
  if (fx > 0 && !args.fxLossAccountId) {
    return fail(422, "REALISED_FX_ACCOUNT_MISSING", "FX Loss account is required for the realised FX on this refund.");
  }
  if (fx < 0 && !args.fxGainAccountId) {
    return fail(422, "REALISED_FX_ACCOUNT_MISSING", "FX Gain account is required for the realised FX on this refund.");
  }
  const currency = (args.currency || "AED").toUpperCase();
  const foreign = currency !== "AED" && bookRate !== 1;
  const lines: RefundLine[] = [
    {
      accountId: args.receivableAccountId,
      debit: arDebit,
      credit: 0,
      description: `${args.label} - clear customer credit`,
      ...(foreign ? { foreignCurrency: currency, exchangeRate: bookRate, foreignDebit: round2(args.amount) } : {}),
    },
  ];
  if (fx > 0) lines.push({ accountId: args.fxLossAccountId!, debit: fx, credit: 0, description: `${args.label} - realised FX loss` });
  if (fx < 0) lines.push({ accountId: args.fxGainAccountId!, debit: 0, credit: -fx, description: `${args.label} - realised FX gain` });
  lines.push({ accountId: args.bankAccountId, debit: 0, credit: bankCredit, description: `${args.label} - cash refunded` });

  const dr = round2(lines.reduce((s, l) => s + l.debit, 0));
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) > 0.005) {
    return fail(500, "UNBALANCED_REFUND", `Refund entry unbalanced (${dr} vs ${cr}).`);
  }
  return { ok: true, lines, realisedFx: fx };
}

/** The reversal of a refund's posted lines: every leg negated, so each account lands back on its old balance. */
export function buildRefundReversalLines(
  posted: Array<{ accountId: string; debit: number; credit: number; description?: string | null }>,
  label: string
): JournalLine[] {
  return posted
    .map((l) => ({
      accountId: l.accountId,
      debit: round2(Number(l.credit) || 0),
      credit: round2(Number(l.debit) || 0),
      description: `${label} - reversal${l.description ? `: ${l.description}` : ""}`,
    }))
    .filter((l) => l.debit > 0 || l.credit > 0);
}
