/**
 * Pure accounting for settling a tax return with the FTA (VAT and corporate tax).
 * No I/O: every function returns balanced journal lines (or a refusal) so the
 * arithmetic is unit-tested; the services only resolve account ids and post.
 *
 * ── VAT design (decision recorded here) ─────────────────────────────────────
 * The output/input VAT accounts are cleared ONCE, when the return is recorded as
 * FILED (the liability/refund becomes a fixed amount owed to / by the FTA), into
 * the "FTA VAT Control Account" (2025). The clearing is driven by the LEDGER
 * balances of the two VAT accounts for the period, so both end at exactly zero,
 * and the FTA control account receives the NET PER THE RETURN (box 14):
 *
 *   payable return   Dr Output VAT (ledger)   Cr Input VAT (ledger)   Cr FTA control (box 14)
 *   refundable       Dr Output VAT (ledger)   Cr Input VAT (ledger)   Dr FTA control (-box 14)
 *
 * The journal then explains every difference between the ledger and the return
 * on the "Irrecoverable VAT expense" account: input VAT the return does not
 * recover (partial exemption), rounding of up to AED 1.00, and manual
 * adjustments recorded on the draft. A larger unexplained gap is refused
 * (VAT_LEDGER_MISMATCH): the books and the return disagree and must be
 * investigated, not written off. (Bills and receipts post ALL their input VAT
 * to 1050; nothing expenses the irrecoverable part at posting time, so this
 * entry is where it is expensed, exactly once.)
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

/** Ledger balances of the two VAT accounts for the period, as positive normal balances. */
export interface LedgerVatBalances {
  /** Net credit balance of the output VAT account(s). */
  outputVat: number;
  /** Net debit balance of the input VAT account(s). */
  inputVat: number;
}

export interface ReturnVatFigures extends VatSettlement {
  /** Input VAT the return does not recover by design (partial exemption, blocked items). */
  expectedIrrecoverable?: number;
  /** Signed change the user recorded by hand on box 12 / box 13 (stored minus computed). */
  manual?: { outputVat: number; inputVat: number; reason: string | null };
}

export interface ClearingAccounts {
  outputId: string;
  inputId: string;
  controlId: string;
  /** "Irrecoverable VAT expense": carries irrecoverable input VAT and rounding. */
  irrecoverableId: string;
  /** "VAT adjustments": carries the declared-more-tax difference of a hand edit (with its reason). */
  adjustmentsId: string;
}

/** A ledger/return gap above AED 1.00 (in fils) is investigated, not written off. */
export const VAT_ROUNDING_TOLERANCE_FILS = 100;

export interface ClearingRefusalDetails {
  ledger: LedgerVatBalances;
  returned: { outputVat: number; inputVat: number; net: number; expectedIrrecoverable: number; manualOutputVat: number; manualInputVat: number };
  differences: { outputVat: number; inputVat: number; unexplained: number };
  toleranceAed: number;
}

export type ClearingResult =
  | { ok: true; lines: JournalLineInput[]; irrecoverable: number; rounding: number; manualAdjustment: number }
  | {
      ok: false;
      code: "VAT_LEDGER_MISMATCH" | "VAT_UNDER_DECLARED";
      message: string;
      details: ClearingRefusalDetails;
    };

/**
 * The journal that clears the VAT accounts at filing. Pure: (ledger balances, return figures).
 *
 *   output ledger  -> debited in full          input ledger -> credited in full
 *   FTA control    -> the return's net (credit if payable, debit if refundable)
 *   expense        -> whatever is left, split into three explained lines:
 *                     irrecoverable input VAT, rounding (both on "Irrecoverable VAT expense"),
 *                     and a hand edit that declares MORE tax than the ledger ("VAT adjustments",
 *                     with the reason). A return may never declare LESS tax than the ledger
 *                     supports: a hand edit that lowers output VAT below the ledger, or raises
 *                     recoverable input VAT above it, is refused (VAT_UNDER_DECLARED) instead of
 *                     being written off to an expense / income account. Credit notes, void
 *                     reversals and VAT adjustment journals are in the ledger AND in the
 *                     computed return, so they never trigger it.
 * For an amendment pass the DIFFERENCES (ledger now - already cleared, return now - base).
 */
export function buildClearingLines(
  ledger: LedgerVatBalances,
  figures: ReturnVatFigures,
  accts: ClearingAccounts,
  label = "VAT return"
): ClearingResult {
  const lOut = toFils(ledger.outputVat);
  const lIn = toFils(ledger.inputVat);
  const rOut = toFils(figures.outputVat);
  const rIn = toFils(figures.inputVat);
  const rNet = rOut - rIn; // derived, so the entry always balances exactly
  const expIrr = toFils(figures.expectedIrrecoverable ?? 0);
  const manOut = toFils(figures.manual?.outputVat ?? 0);
  const manIn = toFils(figures.manual?.inputVat ?? 0);

  // Output side: ledger above the return is an unexplained gap unless the user edited box 12.
  const outGap = lOut - rOut + manOut;
  // Input side: the ledger keeps the irrecoverable part the return leaves out.
  const inGap = lIn - rIn - expIrr + manIn;
  // What the entry has to put on the expense account beyond the irrecoverable input VAT.
  const unexplained = inGap - outGap;

  const tooBig = (v: number) => Math.abs(v) > VAT_ROUNDING_TOLERANCE_FILS;
  const scale = (v: number) => fromFils(v);
  const refusal = (): { ledger: LedgerVatBalances; details: ClearingRefusalDetails } => ({
    ledger: { outputVat: scale(lOut), inputVat: scale(lIn) },
    details: {
      ledger: { outputVat: scale(lOut), inputVat: scale(lIn) },
      returned: {
        outputVat: scale(rOut),
        inputVat: scale(rIn),
        net: scale(rNet),
        expectedIrrecoverable: scale(expIrr),
        manualOutputVat: scale(manOut),
        manualInputVat: scale(manIn),
      },
      differences: { outputVat: scale(lOut - rOut), inputVat: scale(lIn - rIn), unexplained: scale(unexplained) },
      toleranceAed: VAT_ROUNDING_TOLERANCE_FILS / 100,
    },
  });
  if (tooBig(outGap) || tooBig(inGap) || tooBig(unexplained)) {
    return {
      ok: false,
      code: "VAT_LEDGER_MISMATCH",
      message:
        `The VAT accounts and the return disagree: output VAT in the ledger is ${scale(lOut).toFixed(2)} against ${scale(rOut).toFixed(2)} on the return, ` +
        `input VAT ${scale(lIn).toFixed(2)} against ${scale(rIn).toFixed(2)}. ` +
        `Differences above AED ${(VAT_ROUNDING_TOLERANCE_FILS / 100).toFixed(2)} that are not explained by partial exemption or a recorded adjustment must be investigated before filing. Nothing was posted.`,
      details: refusal().details,
    };
  }

  // The return may never declare less tax than the ledger supports. At this point every
  // difference above the rounding tolerance is explained by a hand edit, and a hand edit that
  // lowers output VAT below the ledger, or raises recoverable input VAT above it, hides tax.
  if (lOut - rOut > VAT_ROUNDING_TOLERANCE_FILS || rIn - lIn > VAT_ROUNDING_TOLERANCE_FILS) {
    const parts: string[] = [];
    if (lOut - rOut > VAT_ROUNDING_TOLERANCE_FILS) {
      parts.push(`output VAT in the ledger is ${scale(lOut).toFixed(2)} but the return declares ${scale(rOut).toFixed(2)}`);
    }
    if (rIn - lIn > VAT_ROUNDING_TOLERANCE_FILS) {
      parts.push(`the return recovers ${scale(rIn).toFixed(2)} of input VAT but the ledger holds ${scale(lIn).toFixed(2)}`);
    }
    return {
      ok: false,
      code: "VAT_UNDER_DECLARED",
      message:
        `The return declares less tax than the books support: ${parts.join("; ")}. ` +
        `A hand edit cannot lower the tax due or raise the tax recovered below what the ledger holds: that difference would be written off as income. ` +
        `Correct the books with a credit note or a VAT adjustment journal (with a description), or restore the computed figures. Nothing was posted.`,
      details: refusal().details,
    };
  }

  // Expense lines (debit positive). manual: box edits are stored-minus-computed, so a lower box 12
  // (negative) leaves more output VAT in the ledger than the return declares: a credit here.
  const manualExpense = manOut - manIn;
  const rounding = unexplained; // what is left after irrecoverable and manual
  const why = figures.manual?.reason ? `: ${figures.manual.reason}` : "";
  const lines = compact([
    signedLine(accts.outputId, lOut, `Clear output VAT - ${label}`),
    signedLine(accts.inputId, -lIn, `Clear input VAT - ${label}`),
    // payable => credit the control account, refundable => debit it
    signedLine(accts.controlId, -rNet, `VAT due to / (from) the FTA - ${label}`),
    signedLine(accts.irrecoverableId, expIrr, `Irrecoverable input VAT - ${label}`),
    // a hand edit that declares MORE tax than the ledger: its own account, never 5160, with the reason
    signedLine(accts.adjustmentsId, manualExpense, `VAT adjustment (manual edit) - ${label}${why}`),
    signedLine(accts.irrecoverableId, rounding, `VAT rounding - ${label}`),
  ]);
  return {
    ok: true,
    lines,
    irrecoverable: fromFils(expIrr),
    rounding: fromFils(rounding),
    manualAdjustment: fromFils(manualExpense),
  };
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

/**
 * Corporate tax posting for a filing: the accrual (Dr expense / Cr payable) dated the last day
 * of the tax period, and - when the financial year that contains that date has already been
 * closed to retained earnings - a closing line (Dr retained earnings / Cr expense, same date,
 * posted as a year_end_close entry) so the closed year's income and expense accounts still net
 * to zero. A negative amount (an amendment that lowers the tax) reverses both.
 */
export function buildCtAccrualPosting(
  amount: number,
  accts: { expenseId: string; payableId: string; retainedId?: string },
  opts: { yearClosed: boolean; label?: string }
): { accrual: JournalLineInput[]; closing: JournalLineInput[] } {
  const label = opts.label ?? "Corporate tax";
  const accrual = buildCtAccrualLines(amount, accts, label);
  if (accrual.length === 0 || !opts.yearClosed) return { accrual, closing: [] };
  if (!accts.retainedId) {
    throw new Error("A retained earnings account is required to close corporate tax expense into a closed financial year.");
  }
  const amt = toFils(amount);
  return {
    accrual,
    closing: compact([
      signedLine(accts.retainedId, amt, `${label} expense closed to retained earnings`),
      signedLine(accts.expenseId, -amt, `${label} expense closed to retained earnings`),
    ]),
  };
}
