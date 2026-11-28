/**
 * Receipt amount reconciliation in integer fils (shared/money.ts policy).
 *
 * OCR/AI extraction often returns only some of subtotal / VAT / total. This fills the gaps so
 * that, whenever the helper has to derive a figure, subtotal + VAT === total exactly to the fil.
 *
 * Rounding rule: ROUND_HALF_UP (ties away from zero), same as shared/money.ts `toFils`/`mulRate`.
 * The receipt posting path (server/services/receipt-posting.service.ts) does not recompute VAT:
 * it books the saved net `amount` and `vatAmount` with `toFils` (strict 2dp), so the previewed
 * figures are exactly what gets booked as long as they are 2dp, which this guarantees.
 *
 * Inputs of 0 / invalid mean "missing" (so refunds / credit notes with negative amounts are out of
 * scope: they are treated as missing). Figures the caller supplied are only normalised to whole
 * fils (a value with more than 2 decimals, e.g. 10.005, is rounded half-up to 10.01); a supplied
 * set that is itself inconsistent stays inconsistent and is reported through `mismatch`.
 *
 * Missing VAT with both subtotal and total present (never pre-fill VAT the receipt does not show):
 * - gap (total - subtotal) is 0: VAT 0, no mismatch (no VAT charged).
 * - gap within VAT_GAP_TOLERANCE_FILS of `vatPercentage` x subtotal: VAT = gap, no mismatch.
 * - gap < 0 (discount): VAT 0, mismatch.
 * - any other gap > 0 (service charge, fee, tip, zero-rated): VAT = rate x subtotal, mismatch.
 * The total stays as given. Subtotal only: VAT = rate x subtotal and total = subtotal + VAT.
 * Total only: subtotal is backed out of the VAT-inclusive total at the rate.
 */
import Decimal from "decimal.js";
import { filsToNumber, tryToFils } from "./money";

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

function fils(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return tryToFils(v, { rounding: "halfUp" }) ?? 0;
}

function pctOf(base: number, pct: number): number {
  if (!(pct > 0) || base <= 0) return 0;
  return new D(base).times(pct).div(100).toDecimalPlaces(0, D.ROUND_HALF_UP).toNumber();
}

/** Net portion of a VAT-inclusive gross at `pct` percent, rounded half-up to the fil. */
function netOfGross(gross: number, pct: number): number {
  if (!(pct > 0) || gross <= 0) return gross;
  return new D(gross)
    .times(100)
    .div(new D(100).plus(pct))
    .toDecimalPlaces(0, D.ROUND_HALF_UP)
    .toNumber();
}

export interface ReceiptAmountsInput {
  subtotal: number;
  vatAmount: number;
  total: number;
  /** VAT percentage (e.g. 5); 0 = zero-rated. */
  vatPercentage: number;
}

/** Rounding allowance when checking that (total - subtotal) is VAT at the stated rate. */
export const VAT_GAP_TOLERANCE_FILS = 1;

export function reconcileReceiptAmounts(input: ReceiptAmountsInput): {
  subtotal: number;
  vatAmount: number;
  total: number;
  /** True when subtotal + VAT does not equal total (beyond rounding) in the returned figures. */
  mismatch: boolean;
} {
  let s = fils(input.subtotal);
  let v = fils(input.vatAmount);
  let t = fils(input.total);
  const pct = input.vatPercentage;

  if (s === 0 && t > 0) {
    s = v > 0 && v < t ? t - v : netOfGross(t, pct);
  }
  if (v === 0) {
    const expected = pctOf(s, pct);
    if (t > 0 && s > 0) {
      const gap = t - s;
      if (gap === 0) {
        v = 0; // total equals subtotal: no VAT was charged (exempt / out of scope / unregistered)
      } else if (gap > 0 && Math.abs(gap - expected) <= VAT_GAP_TOLERANCE_FILS) {
        v = gap;
      } else {
        // Unsupported gap: a discount (gap < 0) never invents VAT; a surplus is assumed to carry
        // VAT at the rate on the subtotal. Both are flagged through `mismatch` below.
        v = gap < 0 ? 0 : expected;
      }
    } else {
      v = expected; // subtotal only (total derived below) or nothing to compare against
    }
  }
  if (t === 0) t = s + v;

  const mismatch = s > 0 && t > 0 && Math.abs(s + v - t) > VAT_GAP_TOLERANCE_FILS;
  return {
    subtotal: filsToNumber(s),
    vatAmount: filsToNumber(v),
    total: filsToNumber(t),
    mismatch,
  };
}

/**
 * Which single figure the receipt gave when `reconcileReceiptAmounts` had to work VAT out from
 * the rate: "subtotal" (VAT added on top) or "total" (VAT backed out of the total). Null when a
 * VAT figure was read, both subtotal and total were given, or the rate is 0. The caller adds a
 * review note: the VAT is an assumption, not a read figure. For a total-only receipt it matters
 * most, because an unregistered supplier's receipt would otherwise book a 5% input-VAT claim.
 */
export function vatDerivedSource(input: ReceiptAmountsInput): "subtotal" | "total" | null {
  if (fils(input.vatAmount) > 0 || !(input.vatPercentage > 0)) return null;
  const s = fils(input.subtotal);
  const t = fils(input.total);
  if (s > 0 && t === 0) return "subtotal";
  if (t > 0 && s === 0) return "total";
  return null;
}

/** True when VAT was calculated from the rate (see `vatDerivedSource`). */
export function isVatDerived(input: ReceiptAmountsInput): boolean {
  return vatDerivedSource(input) !== null;
}

/** True when a VAT figure was supplied, measured in whole fils like the reconciler. */
export function hasVatFigure(vatAmount: number): boolean {
  return fils(vatAmount) > 0;
}
function money2(n: number): string {
  return n.toFixed(2);
}

/**
 * Review note for a `mismatch` result; worded to fit a surcharge, a discount or a VAT-free gap.
 * `vatRead` is true when the receipt (or the caller) supplied a VAT figure, so the note does not
 * claim the receipt has no VAT line.
 */
export function amountMismatchMessage(
  subtotal: number,
  vatAmount: number,
  total: number,
  vatPercentage: number,
  vatRead = false
): string {
  const base = `Subtotal ${money2(subtotal)} + VAT ${money2(vatAmount)} does not equal total ${money2(total)}`;
  if (vatRead) return `${base}. Check all three figures against the receipt.`;
  if (vatPercentage > 0) {
    return `${base}. The difference is not ${vatPercentage}% VAT on the subtotal; check for a service charge, fee or discount.`;
  }
  return `${base}. This receipt is zero-rated, so the total should equal the subtotal; check for a fee or discount.`;
}

/**
 * Review note when VAT was calculated from the rate because the receipt gave no VAT figure:
 * from the subtotal (no VAT or total shown) or worked back from a total-only receipt.
 */
export function vatDerivedMessage(
  vatAmount: number,
  vatPercentage: number,
  source: "subtotal" | "total" = "subtotal"
): string {
  const how =
    source === "total"
      ? `worked back from the total at ${vatPercentage}% because the receipt shows no VAT or subtotal`
      : `calculated at ${vatPercentage}% of the subtotal because the receipt shows no VAT or total`;
  return `VAT ${money2(vatAmount)} was ${how}. Check it against the receipt and confirm the supplier charged VAT (look for their TRN on it).`;
}
