/**
 * Pure accounting for settling a tax return with the FTA (VAT and corporate tax).
 * No I/O: every function returns balanced journal lines (or a refusal) so the
 * arithmetic is unit-tested; the services only resolve account ids and post.
 *
 * ── VAT design (decision recorded here) ─────────────────────────────────────
 * The output/input VAT accounts are cleared ONCE, when the return is recorded as
 * FILED (the liability/refund becomes a fixed amount owed to / by the FTA), into
 * the "FTA VAT Control Account" (2025):
 *
 *   payable return   Dr Output VAT (box 12)   Cr Input VAT (box 13)   Cr FTA control (box 14)
 *   refundable       Dr Output VAT (box 12)   Dr FTA control (-box 14) Cr Input VAT (box 13)
 *
 * Payments (any number, partial allowed) then only move the control account:
 *
 *   pay the FTA      Dr FTA control   Cr Bank
 *   refund received  Dr Bank          Cr FTA control
 *
 * Clearing at filing (not at first payment) keeps a partial payment from
 * having to invent a residual balance, and makes the three control accounts
 * tie to zero the moment the last fils is settled. An amendment clears and
 * settles only the DIFFERENCE against the return it amends.
 * VAT is always AED: there is no foreign-currency leg here.
 */

import { fromFils, round2, toFils } from "./tax-filing-core";

export interface JournalLineInput {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
}

export interface VatSettlement {
  outputVat: number;
  inputVat: number;
  /** >0 payable, <0 refundable. */
  net: number;
}

type Boxes = Record<string, number>;
const box = (b: Boxes, key: string) => Number(b[key] ?? 0);

export type SettlementFiguresResult =
  | ({ ok: true } & VatSettlement)
  | { ok: false; code: string; message: string };

/** Output (box 12), input (box 13) and net (box 14) of a return, verified to tie to the fils. */
export function settlementFigures(boxes: Boxes): SettlementFiguresResult {
  const outputVat = round2(box(boxes, "box12TotalDueTax"));
  const inputVat = round2(box(boxes, "box13RecoverableTax"));
  const net = round2(box(boxes, "box14PayableTax"));
  if (toFils(outputVat) - toFils(inputVat) !== toFils(net)) {
    return {
      ok: false,
      code: "VAT_BOXES_DO_NOT_TIE",
      message: `Box 14 (${net.toFixed(2)}) is not box 12 (${outputVat.toFixed(2)}) minus box 13 (${inputVat.toFixed(2)}). Correct the return before recording it as filed.`,
    };
  }
  return { ok: true, outputVat, inputVat, net };
}

/** Amendment: settle only the change in output, input and net against the amended return. */
export function vatSettlementFromDifference(filed: Boxes, amended: Boxes): SettlementFiguresResult {
  const a = settlementFigures(filed);
  if (!a.ok) return a;
  const b = settlementFigures(amended);
  if (!b.ok) return b;
  return {
    ok: true,
    outputVat: fromFils(toFils(b.outputVat) - toFils(a.outputVat)),
    inputVat: fromFils(toFils(b.inputVat) - toFils(a.inputVat)),
    net: fromFils(toFils(b.net) - toFils(a.net)),
  };
}

/** Positive amount = debit, negative = credit, in fils to stay exact. */
function signedLine(accountId: string, amountFils: number, description: string): JournalLineInput | null {
  if (amountFils === 0) return null;
  return amountFils > 0
    ? { accountId, debit: fromFils(amountFils), credit: 0, description }
    : { accountId, debit: 0, credit: fromFils(-amountFils), description };
}

const compact = (lines: Array<JournalLineInput | null>): JournalLineInput[] =>
  lines.filter((l): l is JournalLineInput => l !== null);

export function buildClearingLines(
  fig: VatSettlement,
  accts: { outputId: string; inputId: string; controlId: string },
  label = "VAT return"
): JournalLineInput[] {
  const out = toFils(fig.outputVat);
  const inn = toFils(fig.inputVat);
  const netFils = out - inn; // derived, so the entry always balances exactly
  return compact([
    signedLine(accts.outputId, out, `Clear output VAT - ${label}`),
    signedLine(accts.inputId, -inn, `Clear input VAT - ${label}`),
    // payable => credit the control account, refundable => debit it
    signedLine(accts.controlId, -netFils, `VAT due to / (from) the FTA - ${label}`),
  ]);
}

export function buildSettlementPaymentLines(input: {
  direction: "pay" | "receive";
  amount: number;
  bankId: string;
  controlId: string;
  label: string;
}): JournalLineInput[] {
  const amt = toFils(input.amount);
  if (amt <= 0) return [];
  const bankAmount = input.direction === "pay" ? -amt : amt;
  return compact([
    signedLine(input.controlId, -bankAmount, `Settlement - ${input.label}`),
    signedLine(input.bankId, bankAmount, `Settlement - ${input.label}`),
  ]);
}

export interface RemainingResult {
  direction: "pay" | "receive" | "none";
  remaining: number;
}

/** What is still owed (or to be received) after the payments recorded so far, exact to the fils. */
export function remainingToSettle(net: number, payments: number[]): RemainingResult {
  const netFils = toFils(net);
  if (netFils === 0) return { direction: "none", remaining: 0 };
  const paid = payments.reduce((s, p) => s + toFils(p), 0);
  const remainingFils = Math.max(0, Math.abs(netFils) - paid);
  return { direction: netFils > 0 ? "pay" : "receive", remaining: fromFils(remainingFils) };
}

/**
 * Corporate tax accrual posted when the return is filed: Dr expense, Cr payable.
 * A negative amount (an amendment that lowers the tax) reverses part of it.
 */
export function buildCtAccrualLines(
  amount: number,
  accts: { expenseId: string; payableId: string },
  label = "Corporate tax"
): JournalLineInput[] {
  const amt = toFils(amount);
  if (amt === 0) return [];
  return compact([
    signedLine(accts.expenseId, amt, `${label} expense`),
    signedLine(accts.payableId, -amt, `${label} payable`),
  ]);
}
