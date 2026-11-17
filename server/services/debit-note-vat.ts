/**
 * A1 (C2): the VAT treatment of a supplier debit note mirrors the bill it adjusts. Pure.
 *
 *  - standard: the supplier charged VAT. A/P falls by net + VAT; only the part of the VAT that
 *    was recovered on the bill (after blocked / partial-recovery rules, Exec. Reg. Art. 53 / 55)
 *    is reversed from input VAT. The rest was never recovered: it sits in the cost of the line
 *    and is credited back to it (a blocked-VAT car: Dr A/P 1,050 / Cr asset 1,050).
 *  - reverse_charge: the supplier charged no VAT (FDL 8/2017 Art. 48). A/P falls by the net
 *    only; the self-assessed output VAT and the input VAT recovered on it are both reduced
 *    (Exec. Reg. Art. 60: Box 3 and Box 10).
 *  - import: import VAT is assessed by customs on the declaration; a supplier credit does not
 *    change it (a customs refund is an import adjustment, Box 7). No VAT on the note.
 *  - none: a stand-alone note (no bill): standard with full recovery.
 */
import { allocate } from "../../shared/money";

export type DebitNoteVatTreatment = "standard" | "reverse_charge" | "import";

export interface DebitNoteBillVat {
  reverseCharge: boolean;
  isImport: boolean;
  /** Bill VAT in document fils. */
  vatFils: number;
  /** Recoverable input VAT the bill posted (document fils), or null when unknown. */
  recoverableFils: number | null;
}

export interface DebitNoteVatPlan {
  treatment: DebitNoteVatTreatment;
  /** VAT on the note (document fils): charged by the supplier, or self-assessed. */
  vatFils: number;
  /** Input VAT reversed from 1050 (document fils). */
  recoverableFils: number;
  /** VAT that was never recovered, credited back to each line's account (document fils). */
  lineCostFils: number[];
  /** A/P debit in document fils. */
  apFils: number;
}

/** Fraction of the bill's VAT that was recovered, applied to `vatFils` (half-up fils). */
function recoveredShare(vatFils: number, bill: DebitNoteBillVat | null): number {
  if (!bill || bill.recoverableFils === null || bill.vatFils <= 0) return vatFils;
  const rec = Math.min(bill.vatFils, Math.max(0, bill.recoverableFils));
  if (rec >= bill.vatFils) return vatFils;
  if (rec <= 0) return 0;
  return Math.round((vatFils * rec) / bill.vatFils);
}

export function planDebitNoteVat(
  lines: Array<{ amountFils: number; vatFils: number }>,
  bill: DebitNoteBillVat | null
): DebitNoteVatPlan {
  const netFils = lines.reduce((s, l) => s + l.amountFils, 0);
  const weights = lines.map((l) => (netFils > 0 ? l.amountFils : 1));
  if (bill?.isImport) {
    return {
      treatment: "import",
      vatFils: 0,
      recoverableFils: 0,
      lineCostFils: lines.map(() => 0),
      apFils: netFils,
    };
  }
  const vatFils = lines.reduce((s, l) => s + l.vatFils, 0);
  const recoverableFils = recoveredShare(vatFils, bill);
  const nonRecoverable = vatFils - recoverableFils;
  const lineCostFils = nonRecoverable > 0 ? allocate(nonRecoverable, weights) : lines.map(() => 0);
  if (bill?.reverseCharge) {
    return { treatment: "reverse_charge", vatFils, recoverableFils, lineCostFils, apFils: netFils };
  }
  return {
    treatment: "standard",
    vatFils,
    recoverableFils,
    lineCostFils,
    apFils: netFils + vatFils,
  };
}
