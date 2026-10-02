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
//
// TAXABLE SALES BY JOURNAL (Phase 9): a manual journal that credits a revenue account AND the output VAT
// account in the same entry (Dr 1040 1,050 / Cr 4010 1,000 / Cr 2020 50) is a taxable sale, not a correction
// of tax already declared. It is reported as a supply: its net revenue amount in box 1 of the company's
// emirate and its VAT in box 1 VAT, exactly once (its 2020 line is NOT also an output adjustment). Its
// reversal (the mirror entry, both lines debited) comes back negative in the period it is posted, like a
// credit note. The date is the entry's own date (`date::date`), the way the ledger reads it, so the return
// still equals account 2020. A journal that touches 2020 without a revenue line of the same direction stays
// an adjustment, as before. The net amount is the revenue credited; when that is not what the tax was charged on
// (a fixed-asset disposal credits only the GAIN to revenue, the sale price goes against the asset) the amount is the
// consideration the tax implies (VAT / 5%): the 2,000 of VAT on a van sold for 40,000 is a 40,000 supply.
//
// TAXABLE PURCHASES BY JOURNAL: the same on the input side. A manual journal that debits an expense (or a fixed
// asset, prepayment or stock account) AND the input VAT account (1050) in one entry (Dr 5050 500 / Dr 1050 25 /
// Cr card 525) is a purchase: its net amount goes to box 9 amount and its VAT to box 9 VAT, once, like a bill (and
// through the same partial-exemption apportionment); its 1050 line is not also an adjustment. When the cost
// account is a blocked category (entertainment, Art. 53; blocked-input-vat.ts) the entry is listed but counts
// nowhere: no box 9 amount, no box 9 VAT, no adjustment.

import { UAE_VAT_RATE } from "../constants";
import { isBlockedInputCategory } from "./blocked-input-vat";
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
  /** Account type; income lines are read to recognise a taxable sale, other lines may leave it out. */
  accountType?: string | null;
  /** Account sub type and names: read to tell cost accounts (expense, fixed asset) from settlement accounts, and blocked categories. */
  accountSubType?: string | null;
  accountName?: string | null;
  accountNameAr?: string | null;
  debit: number;
  credit: number;
}

/** A taxable sale recorded by manual journal (see the header). Amounts are AED, signed (a reversal is negative). */
export interface VatJournalSaleLine {
  kind: "journal_sale";
  entryId: string;
  entryNumber: string;
  description: string;
  date: string;
  side: "output";
  /** The box-1 amount column of the company's emirate (box1bDubaiAmount); the VAT goes to the matching Vat column. */
  box: string;
  /** Net revenue of the entry (credit - debit on income accounts). */
  amount: number;
  /** Output VAT of the entry (credit - debit on 2020). */
  vat: number;
}

/** A purchase recorded by manual journal (see the header). AED, signed (a reversal is negative). */
export interface VatJournalPurchaseLine {
  kind: "journal_purchase";
  entryId: string;
  entryNumber: string;
  description: string;
  date: string;
  side: "input";
  /** Always the box 9 amount column; the VAT goes to box 9 VAT. */
  box: "box9ExpensesAmount";
  /** Net cost of the entry (debit - credit on its cost accounts). */
  amount: number;
  /** Input VAT of the entry (debit - credit on 1050). */
  vat: number;
  /** Blocked input VAT (Art. 53): listed, counted nowhere. */
  blocked: boolean;
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
  /** Taxable sales recorded by manual journal: reported in box 1 amount and VAT, never as an adjustment. */
  sales: VatJournalSaleLine[];
  salesAmount: number;
  salesVat: number;
  /** Purchases recorded by manual journal (blocked ones included, flagged): box 9 amount and VAT, never an adjustment. */
  purchases: VatJournalPurchaseLine[];
  /** Totals of the purchases that count (not blocked). */
  purchasesAmount: number;
  purchasesVat: number;
}

/** Tolerance when comparing a line's VAT with 5% of its base: 2 fils (rounding of a hand-typed entry). */
const RATE_TOLERANCE_FILS = 2;

/** The tax-exclusive amount of a supply or purchase: the booked base when the VAT is 5% of it, else what the VAT implies. */
function considerationFils(baseFils: number, vatFils: number): number {
  if (Math.abs(Math.round(baseFils * UAE_VAT_RATE) - vatFils) <= RATE_TOLERANCE_FILS) return baseFils;
  return Math.round(vatFils / UAE_VAT_RATE);
}

const sameDirection = (a: number, b: number) => a !== 0 && b !== 0 && a > 0 === b > 0;

/** The amount column of box 1 that goes with an adjustment column (box1bDubaiAdj -> box1bDubaiAmount). */
export const amountBoxOfAdjustmentBox = (adjBox: string) => adjBox.replace(/Adj$/, "Amount");

/** Entries whose revenue and output-VAT lines run the same way: taxable sales (or their reversals). */
function detectJournalSales(rows: VatJournalLineRow[]) {
  const income = new Map<string, number>();
  const output = new Map<string, number>();
  for (const r of rows) {
    const net = toFils(r.credit) - toFils(r.debit);
    if (r.accountCode === VAT_OUTPUT_ACCOUNT.code) output.set(r.entryId, (output.get(r.entryId) ?? 0) + net);
    else if (r.accountType === "income") income.set(r.entryId, (income.get(r.entryId) ?? 0) + net);
  }
  const sales = new Map<string, { amountFils: number; vatFils: number }>();
  for (const [entryId, vatFils] of output) {
    const amountFils = income.get(entryId) ?? 0;
    if (sameDirection(amountFils, vatFils)) sales.set(entryId, { amountFils: considerationFils(amountFils, vatFils), vatFils });
  }
  return sales;
}

/** A cost account: an expense, or a fixed asset / prepayment / stock (never cash, bank, receivables or the VAT accounts). */
const isCostLine = (r: VatJournalLineRow) =>
  r.accountCode !== VAT_INPUT_ACCOUNT.code &&
  r.accountCode !== VAT_OUTPUT_ACCOUNT.code &&
  (r.accountType === "expense" ||
    (r.accountType === "asset" && (r.accountSubType === "fixed_asset" || r.accountCode === "1060" || r.accountCode === "1070")));

/** Entries whose cost lines and input-VAT line run the same way (both debited, or both credited by a reversal): purchases. */
function detectJournalPurchases(rows: VatJournalLineRow[]) {
  const cost = new Map<string, number>();
  const input = new Map<string, number>();
  const blocked = new Set<string>();
  for (const r of rows) {
    const net = toFils(r.debit) - toFils(r.credit);
    if (r.accountCode === VAT_INPUT_ACCOUNT.code) input.set(r.entryId, (input.get(r.entryId) ?? 0) + net);
    else if (isCostLine(r)) {
      cost.set(r.entryId, (cost.get(r.entryId) ?? 0) + net);
      if ([r.accountName, r.accountNameAr, r.accountSubType].some((c) => isBlockedInputCategory(c))) blocked.add(r.entryId);
    }
  }
  const purchases = new Map<string, { amountFils: number; vatFils: number; blocked: boolean }>();
  for (const [entryId, vatFils] of input) {
    const costFils = cost.get(entryId) ?? 0;
    if (sameDirection(costFils, vatFils)) {
      purchases.set(entryId, { amountFils: considerationFils(costFils, vatFils), vatFils, blocked: blocked.has(entryId) });
    }
  }
  return purchases;
}

export function summariseVatJournalAdjustments(rows: VatJournalLineRow[], emirate: string | null | undefined): VatJournalAdjustments {
  const outputBox = outputAdjustmentBoxForEmirate(emirate);
  const saleEntries = detectJournalSales(rows);
  const purchaseEntries = detectJournalPurchases(rows);
  const purchaseByEntry = new Map<string, VatJournalPurchaseLine>();
  let purchasesAmountFils = 0;
  let purchasesVatFils = 0;
  const byKey = new Map<string, VatJournalAdjustmentLine & { fils: number }>();
  const saleByEntry = new Map<string, VatJournalSaleLine>();
  let salesAmountFils = 0;
  let salesVatFils = 0;
  for (const r of rows) {
    const sale = saleEntries.get(r.entryId);
    if (sale && r.accountCode === VAT_OUTPUT_ACCOUNT.code) {
      // the VAT of a taxable sale is box 1 VAT, not an adjustment: counted once, from the sale
      if (!saleByEntry.has(r.entryId)) {
        saleByEntry.set(r.entryId, {
          kind: "journal_sale",
          entryId: r.entryId,
          entryNumber: r.entryNumber,
          description: (r.description ?? "").trim(),
          date: r.date,
          side: "output",
          box: amountBoxOfAdjustmentBox(outputBox),
          amount: fromFils(sale.amountFils),
          vat: fromFils(sale.vatFils),
        });
        salesAmountFils += sale.amountFils;
        salesVatFils += sale.vatFils;
      }
      continue;
    }
    const purchase = purchaseEntries.get(r.entryId);
    if (purchase && r.accountCode === VAT_INPUT_ACCOUNT.code) {
      // the VAT of a purchase is box 9 VAT (or, when blocked, nowhere), not an adjustment: counted once, from the purchase
      if (!purchaseByEntry.has(r.entryId)) {
        purchaseByEntry.set(r.entryId, {
          kind: "journal_purchase",
          entryId: r.entryId,
          entryNumber: r.entryNumber,
          description: (r.description ?? "").trim(),
          date: r.date,
          side: "input",
          box: "box9ExpensesAmount",
          amount: fromFils(purchase.amountFils),
          vat: fromFils(purchase.vatFils),
          blocked: purchase.blocked,
        });
        if (!purchase.blocked) {
          purchasesAmountFils += purchase.amountFils;
          purchasesVatFils += purchase.vatFils;
        }
      }
      continue;
    }
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
  return {
    lines,
    outputAdjustment: fromFils(out),
    inputAdjustment: fromFils(inp),
    outputBox,
    sales: [...saleByEntry.values()],
    salesAmount: fromFils(salesAmountFils),
    salesVat: fromFils(salesVatFils),
    purchases: [...purchaseByEntry.values()],
    purchasesAmount: fromFils(purchasesAmountFils),
    purchasesVat: fromFils(purchasesVatFils),
  };
}

/** What the return stores and shows as "journal lines behind the boxes": the adjustments plus the journal sales and purchases, in date order. */
export function journalLinesForReturn(
  a: Pick<VatJournalAdjustments, "lines" | "sales"> & Partial<Pick<VatJournalAdjustments, "purchases">>
): Array<VatJournalAdjustmentLine | VatJournalSaleLine | VatJournalPurchaseLine> {
  return [...a.lines, ...a.sales, ...(a.purchases ?? [])].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.entryNumber.localeCompare(y.entryNumber)));
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
