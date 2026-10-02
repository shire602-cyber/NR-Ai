// The realised exchange gain or loss a foreign-currency receipt or payment will book, shown before it is posted.
//
// A receipt on a customer invoice: AR is carried at the invoice's rate, the bank gets the money at the receipt-day rate,
// so a higher rate on the day is a gain. A payment of a supplier bill is the mirror: the payable is carried at the
// bill's rate, so a higher rate on the day is a loss.

export type FxKind = "receipt" | "payment";

export interface FxPreview {
  /** What the amount is worth in AED on the document (the receivable or payable that is cleared). */
  aedAtBook: number;
  /** What it is worth in AED on the payment day (what the bank gets or gives). */
  aedAtPayment: number;
  /** Positive is a gain (credit 4090), negative a loss (debit 5140). */
  gainLoss: number;
}

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function realisedFx(args: { kind: FxKind; amount: number; bookRate: number; paymentRate: number }): FxPreview | null {
  const { amount, bookRate, paymentRate } = args;
  if (![amount, bookRate, paymentRate].every((n) => Number.isFinite(n) && n > 0)) return null;
  const aedAtBook = r2(amount * bookRate);
  const aedAtPayment = r2(amount * paymentRate);
  const gainLoss = args.kind === "receipt" ? r2(aedAtPayment - aedAtBook) : r2(aedAtBook - aedAtPayment);
  return { aedAtBook, aedAtPayment, gainLoss };
}

/** The rate text a person typed, as a number: positive, at most 6 decimals; null when it is not usable. */
export function parseRate(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}
