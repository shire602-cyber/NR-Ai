// Manual journals to the VAT accounts are VAT ADJUSTMENTS. A journal typed in by a user (source
// "manual") that debits or credits the output VAT account (2020) or the input VAT account (1050)
// is not a mismatch between the ledger and the return: it belongs in the return's adjustment
// columns, with the journal number and description so the accountant can see what it is.
//
//   output side  -> the adjustment column of the company's own emirate in box 1 (box1bDubaiAdj, ...)
//                   amount = credit - debit of the entry on 2020 (Dr 2020 50 = -50 output tax)
//   input side   -> box 9 adjustment (box9ExpensesAdj)
//                   amount = debit - credit of the entry on 1050 (Dr 1050 30 = +30 recoverable tax)
//
// The adjustments flow into box 8 adjustment, box 11 adjustment and therefore boxes 12 (due tax =
// box 8 VAT + adjustment), 13 (recoverable tax = box 11 VAT + adjustment) and 14, so the return
// equals the ledger with no hand edit. ONE implementation for the VAT 201, the autopilot and the
// firm workpaper pull. Pure: no I/O (the database read is in vat-adjustments.service.ts).

import { fromFils, toFils } from "./tax-filing-core";

export const VAT_OUTPUT_ACCOUNT = { code: "2020", type: "liability" } as const;
export const VAT_INPUT_ACCOUNT = { code: "1050", type: "asset" } as const;
export const INPUT_ADJUSTMENT_BOX = "box9ExpensesAdj";

const OUTPUT_ADJ_BOX_BY_EMIRATE: Record<string, string> = {
  abu_dhabi: "box1aAbuDhabiAdj",
  dubai: "box1bDubaiAdj",
  sharjah: "box1cSharjahAdj",
  ajman: "box1dAjmanAdj",
  umm_al_quwain: "box1eUmmAlQuwainAdj",
  ras_al_khaimah: "box1fRasAlKhaimahAdj",
  fujairah: "box1gFujairahAdj",
};
export const OUTPUT_ADJUSTMENT_BOXES: readonly string[] = Object.values(OUTPUT_ADJ_BOX_BY_EMIRATE);

/** The box-1 adjustment column of an emirate; an unknown one falls back to Dubai, as the return's own switch does. */
export function outputAdjustmentBoxForEmirate(emirate: string | null | undefined): string {
  const key = (emirate || "dubai").toLowerCase().replace(/\s+/g, "_");
  return OUTPUT_ADJ_BOX_BY_EMIRATE[key] ?? OUTPUT_ADJ_BOX_BY_EMIRATE.dubai;
}

/** One journal line on a VAT account (the database read returns these). */
export interface VatJournalLineRow {
  entryId: string;
  entryNumber: string;
  description: string | null;
  date: string;
  accountCode: string;
  debit: number;
  credit: number;
}

export interface VatJournalAdjustmentLine {
  entryId: string;
  entryNumber: string;
  description: string;
  date: string;
  side: "output" | "input";
  box: string;
  /** Signed effect on the tax in the return (output: credit - debit; input: debit - credit). */
  amount: number;
}

export interface VatJournalAdjustments {
  lines: VatJournalAdjustmentLine[];
  outputAdjustment: number;
  inputAdjustment: number;
  outputBox: string;
}

export function summariseVatJournalAdjustments(rows: VatJournalLineRow[], emirate: string | null | undefined): VatJournalAdjustments {
  const outputBox = outputAdjustmentBoxForEmirate(emirate);
  const byKey = new Map<string, VatJournalAdjustmentLine & { fils: number }>();
  for (const r of rows) {
    const side = r.accountCode === VAT_OUTPUT_ACCOUNT.code ? "output" : r.accountCode === VAT_INPUT_ACCOUNT.code ? "input" : null;
    if (!side) continue;
    const key = `${r.entryId}:${side}`;
    const signed = side === "output" ? toFils(r.credit) - toFils(r.debit) : toFils(r.debit) - toFils(r.credit);
    const existing = byKey.get(key);
    if (existing) {
      existing.fils += signed;
    } else {
      byKey.set(key, {
        entryId: r.entryId,
        entryNumber: r.entryNumber,
        description: (r.description ?? "").trim(),
        date: r.date,
        side,
        box: side === "output" ? outputBox : INPUT_ADJUSTMENT_BOX,
        amount: 0,
        fils: signed,
      });
    }
  }
  const lines: VatJournalAdjustmentLine[] = [];
  let out = 0;
  let inp = 0;
  for (const l of byKey.values()) {
    const { fils, ...rest } = l;
    lines.push({ ...rest, amount: fromFils(fils) });
    if (l.side === "output") out += fils;
    else inp += fils;
  }
  return { lines, outputAdjustment: fromFils(out), inputAdjustment: fromFils(inp), outputBox };
}

/**
 * Set the adjustment columns and re-derive boxes 12, 13 and 14 from them:
 *   box 12 = box 8 VAT + box 8 adjustment, box 13 = box 11 VAT + box 11 adjustment, box 14 = 12 - 13.
 * Everything else is untouched. With nothing to adjust the boxes are returned as they came.
 */
export function applyJournalAdjustmentsToBoxes<T extends object>(
  boxes: T,
  adjustments: Pick<VatJournalAdjustments, "outputAdjustment" | "inputAdjustment" | "outputBox">
): T {
  if (toFils(adjustments.outputAdjustment) === 0 && toFils(adjustments.inputAdjustment) === 0) return boxes;
  const next: Record<string, number | undefined> = { ...(boxes as Record<string, number | undefined>) };
  const add = (key: string, delta: number) => {
    next[key] = fromFils(toFils(next[key] ?? 0) + toFils(delta));
  };
  add(adjustments.outputBox, adjustments.outputAdjustment);
  add(INPUT_ADJUSTMENT_BOX, adjustments.inputAdjustment);
  add("box8TotalAdj", adjustments.outputAdjustment);
  add("box11TotalAdj", adjustments.inputAdjustment);
  const box12 = toFils(next.box8TotalVat ?? 0) + toFils(next.box8TotalAdj ?? 0);
  const box13 = toFils(next.box11TotalVat ?? 0) + toFils(next.box11TotalAdj ?? 0);
  next.box12TotalDueTax = fromFils(box12);
  next.box13RecoverableTax = fromFils(box13);
  next.box14PayableTax = fromFils(box12 - box13);
  return next as T;
}

interface AccountLike {
  code?: string | null;
  type?: string | null;
  isVatAccount?: boolean | null;
  vatType?: string | null;
}

/** True when any line posts to an output or input VAT account (such a journal needs a description). */
export function vatAccountTouchedByLines(
  lines: Array<{ accountId?: string | null }>,
  accountsById: Map<string, AccountLike>
): boolean {
  return lines.some((l) => {
    const a = l.accountId ? accountsById.get(l.accountId) : undefined;
    if (!a) return false;
    if (a.code === VAT_OUTPUT_ACCOUNT.code && a.type === VAT_OUTPUT_ACCOUNT.type) return true;
    if (a.code === VAT_INPUT_ACCOUNT.code && a.type === VAT_INPUT_ACCOUNT.type) return true;
    return a.isVatAccount === true && (a.vatType === "output" || a.vatType === "input");
  });
}
