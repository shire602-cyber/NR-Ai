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
 * Inputs of 0 / invalid mean "missing". Figures the caller supplied are never altered; a
 * supplied set that is itself inconsistent stays inconsistent (the validation layer flags it).
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

export function reconcileReceiptAmounts(input: ReceiptAmountsInput): {
  subtotal: number;
  vatAmount: number;
  total: number;
} {
  let s = fils(input.subtotal);
  let v = fils(input.vatAmount);
  let t = fils(input.total);
  const pct = input.vatPercentage;

  if (s === 0 && t > 0) {
    s = v > 0 && v < t ? t - v : netOfGross(t, pct);
  }
  if (v === 0) {
    v = t >= s && t > 0 ? t - s : pctOf(s, pct);
  }
  if (t === 0) t = s + v;

  return { subtotal: filsToNumber(s), vatAmount: filsToNumber(v), total: filsToNumber(t) };
}
