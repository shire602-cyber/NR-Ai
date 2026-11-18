/**
 * WQ2 (8.16): the supplier-credit (debit note) form. Pure helpers, so the prefill from a bill and
 * the totals are unit-tested. The figures shown are a preview: the server recomputes VAT from the
 * bill's VAT treatment (blocked / partial recovery / reverse charge) when the note is posted.
 */
import { fromFils, toFils } from "@shared/money";

export interface DebitNoteDraftLine {
  description: string;
  /** Amount before VAT (bill currency), as typed. */
  amount: string;
  vatRate: 0 | 5;
  accountId: string;
  /** A returned stock item (leaves inventory at cost on the server). */
  productId: string | null;
  quantity: number;
}

const filsOrZero = (v: string | number | null | undefined) => {
  const s = String(v ?? "").trim();
  if (!s || !Number.isFinite(Number(s)) || Number(s) < 0) return 0;
  return toFils(s, { rounding: "halfUp" });
};

/** One credit line per bill line, at the bill line's net amount (the user lowers it). */
export function linesFromBill(
  lines: ReadonlyArray<{
    description: string;
    amount: string | number;
    vat_rate: string | number;
    vat_supply_type?: string | null;
    account_id: string | null;
    product_id?: string | null;
    quantity?: string | number | null;
  }>
): DebitNoteDraftLine[] {
  return lines.map((l) => ({
    description: l.description,
    amount: fromFils(filsOrZero(l.amount)),
    vatRate:
      Number(l.vat_rate) === 0 ||
      ["zero_rated", "exempt", "out_of_scope"].includes(String(l.vat_supply_type))
        ? 0
        : 5,
    accountId: l.account_id ?? "",
    productId: l.product_id ?? null,
    quantity: Math.max(1, Math.round(Number(l.quantity) || 1)),
  }));
}

/** Net, VAT (5% per line, rounded per line like the server) and total, in AED units. */
export function debitNoteTotals(lines: readonly DebitNoteDraftLine[]) {
  let net = 0;
  let vat = 0;
  for (const l of lines) {
    const f = filsOrZero(l.amount);
    net += f;
    if (l.vatRate === 5) vat += Math.round(f * 0.05);
  }
  return { subtotal: net / 100, vat: vat / 100, total: (net + vat) / 100 };
}

/** What is left of a note to apply to bills. */
export function debitNoteRemaining(n: {
  total_amount: string | number;
  amount_applied?: string | number | null;
}): number {
  return Math.max(0, (filsOrZero(n.total_amount) - filsOrZero(n.amount_applied)) / 100);
}
