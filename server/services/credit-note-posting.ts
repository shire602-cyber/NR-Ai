// F07 — credit-note reversal amounts in the AED ledger.
//
// The ledger is AED. Invoices post at their stored transaction-date rate
// (invoice-posting.service), splitting revenue between the standard-rated
// revenue account and the Zero-Rated Sales account. A credit note must reverse
// the SAME legs at the SAME rate:
//
//   * Rate: the original invoice's exchange rate. Reversing part of a sale is
//     not a settlement, so it produces no exchange difference; genuine FX
//     gains/losses arise only on settlement / revaluation, never here.
//   * Tax treatment: the zero-rated portion reverses Zero-Rated Sales, the
//     standard portion reverses revenue, VAT reverses Output VAT.
//   * Final credit: when this credit clears the remaining document balance,
//     each leg reverses exactly what is still posted on it (original posting
//     less prior credit-note reversals), so no fils residue is left on A/R,
//     revenue, zero-rated sales or Output VAT. Rounding residuals are absorbed
//     here, never presented as exchange differences.
//
// Previously the reversal posted DOCUMENT-currency amounts straight into the
// AED ledger (USD 1,050 credit reversed AED 1,050 against an AED 3,856.13
// posting) and always debited the standard revenue account (zero-rated sales
// were never reversed).

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ReversalLegs {
  /** A/R credited on the credit note (AED). */
  ar: number;
  /** Standard-rated revenue debited (AED). */
  standardRevenue: number;
  /** Zero-rated sales debited (AED). */
  zeroRated: number;
  /** Output VAT debited (AED). */
  vat: number;
}

export const ZERO_LEGS: ReversalLegs = { ar: 0, standardRevenue: 0, zeroRated: 0, vat: 0 };

export function planCreditNoteReversal(args: {
  /** AED per document-currency unit on the ORIGINAL invoice (1 for AED). */
  rate: number;
  /** Positive document-currency credit amounts. */
  doc: { subtotal: number; vatAmount: number; total: number };
  /** Zero-rated portion of doc.subtotal (document currency). */
  zeroRatedNetDoc: number;
  /** True when this credit clears the remaining document balance. */
  isFinal: boolean;
  /** AED legs posted by the original invoice journal (null if none found). */
  originalPosted: ReversalLegs | null;
  /** AED legs already reversed by earlier credit notes. */
  priorReversed: ReversalLegs;
}): ReversalLegs {
  const rate = args.rate > 0 ? args.rate : 1;

  if (args.isFinal && args.originalPosted) {
    const rem = (k: keyof ReversalLegs) =>
      Math.max(0, round2(args.originalPosted![k] - args.priorReversed[k]));
    const standardRevenue = rem("standardRevenue");
    const zeroRated = rem("zeroRated");
    const vat = rem("vat");
    // A/R is the sum of the debit legs so the entry always balances; on a
    // consistent ledger it also equals the remaining posted A/R.
    return { standardRevenue, zeroRated, vat, ar: round2(standardRevenue + zeroRated + vat) };
  }

  const zeroDoc = Math.min(Math.max(0, args.zeroRatedNetDoc), args.doc.subtotal);
  const standardDoc = round2(args.doc.subtotal - zeroDoc);
  let standardRevenue = round2(standardDoc * rate);
  let zeroRated = round2(zeroDoc * rate);
  let vat = round2(args.doc.vatAmount * rate);

  // Never reverse more than is still posted on a leg (protects against a
  // partial credit's independent rounding overshooting the remaining balance).
  if (args.originalPosted) {
    const cap = (k: keyof ReversalLegs, v: number) =>
      Math.min(v, Math.max(0, round2(args.originalPosted![k] - args.priorReversed[k])));
    standardRevenue = cap("standardRevenue", standardRevenue);
    zeroRated = cap("zeroRated", zeroRated);
    vat = cap("vat", vat);
  }
  return { standardRevenue, zeroRated, vat, ar: round2(standardRevenue + zeroRated + vat) };
}

export interface LedgerLineLike {
  accountId: string;
  debit: number | string | null;
  credit: number | string | null;
}

/**
 * Sum journal lines into reversal legs. `side` is the side the ORIGINAL
 * invoice used for revenue/VAT ("credit"); credit notes use "debit".
 */
export function sumLegs(
  lines: readonly LedgerLineLike[],
  accounts: { ar?: string; revenue?: string; zeroRated?: string; vat?: string },
  revenueSide: "credit" | "debit"
): ReversalLegs {
  const legs = { ...ZERO_LEGS };
  const arSide = revenueSide === "credit" ? "debit" : "credit";
  for (const l of lines) {
    const amt = (side: "debit" | "credit") => Number(l[side]) || 0;
    if (l.accountId === accounts.ar) legs.ar += amt(arSide) - amt(revenueSide);
    else if (l.accountId === accounts.revenue)
      legs.standardRevenue += amt(revenueSide) - amt(arSide);
    else if (accounts.zeroRated && l.accountId === accounts.zeroRated)
      legs.zeroRated += amt(revenueSide) - amt(arSide);
    else if (accounts.vat && l.accountId === accounts.vat) legs.vat += amt(revenueSide) - amt(arSide);
  }
  return {
    ar: round2(legs.ar),
    standardRevenue: round2(legs.standardRevenue),
    zeroRated: round2(legs.zeroRated),
    vat: round2(legs.vat),
  };
}

export function addLegs(a: ReversalLegs, b: ReversalLegs): ReversalLegs {
  return {
    ar: round2(a.ar + b.ar),
    standardRevenue: round2(a.standardRevenue + b.standardRevenue),
    zeroRated: round2(a.zeroRated + b.zeroRated),
    vat: round2(a.vat + b.vat),
  };
}
