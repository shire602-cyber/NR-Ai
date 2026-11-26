// Shared line-based document money math (F01).
//
// One rounding rule for every surface that computes document totals from
// lines: the invoice/quote/PO/credit-note editors, the create/update API, the
// PDF VAT breakdown, the PINT-AE payload tax subtotals and the VAT autopilot
// reconciliation.
//
// Rule (FTA Executive Regulation Art. 30 permits line- or invoice-level
// rounding; we use LINE level):
//   1. line net   = quantity × unit price, kept in full precision for the
//                   multiplication, rounded half-up to 2 dp (fils);
//   2. line VAT   = rounded line net × rate, rounded half-up to 2 dp;
//   3. subtotal   = Σ rounded line nets;
//      VAT        = Σ rounded line VAT;
//      total      = subtotal + VAT (exact — no further rounding needed).
//
// Example control case: two lines of AED 0.10 at 5% → 0.01 VAT each,
// AED 0.02 document VAT, AED 0.22 gross.
//
// Quantities and unit prices are NOT rounded — only the money results are.
// Issued historical documents keep their persisted subtotal/vatAmount/total;
// callers rendering an issued document must read the persisted columns rather
// than recompute through this module.

import Decimal from "decimal.js";

export const UAE_STANDARD_VAT_RATE = 0.05;

export interface DocumentTotalsLine {
  quantity: number | string;
  unitPrice: number | string;
  vatRate?: number | string | null;
}

/** Normalise a VAT rate to decimal form; accepts 5 (percent) or 0.05. */
export function normaliseVatRate(raw: number | string | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") return UAE_STANDARD_VAT_RATE;
  const n = Number(raw);
  if (!Number.isFinite(n)) return UAE_STANDARD_VAT_RATE;
  return n === 5 ? UAE_STANDARD_VAT_RATE : n;
}

function toDecimal(raw: number | string | null | undefined): Decimal {
  if (raw === null || raw === undefined) return new Decimal(0);
  const text = String(raw).trim();
  if (text === "" || !Number.isFinite(Number(text))) return new Decimal(0);
  return new Decimal(text);
}

function roundFils(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Round a money amount half-up to fils (2 dp). */
export function roundMoney(n: number | string): number {
  return roundFils(toDecimal(n)).toNumber();
}

/** Rounded line net (qty × price) in fils. */
export function lineNetAmount(line: Pick<DocumentTotalsLine, "quantity" | "unitPrice">): number {
  return roundFils(toDecimal(line.quantity).times(toDecimal(line.unitPrice))).toNumber();
}

/**
 * Rounded line VAT. `rateOverride` lets callers that already resolved the
 * effective rate (e.g. a zero-rated/exempt supply type forcing 0) pass it in.
 */
export function lineVatAmount(line: DocumentTotalsLine, rateOverride?: number): number {
  const net = new Decimal(lineNetAmount(line));
  const rate = rateOverride ?? normaliseVatRate(line.vatRate);
  return roundFils(net.times(rate)).toNumber();
}

export interface DocumentTotals {
  subtotal: number;
  vatAmount: number;
  total: number;
}

export function calculateDocumentTotals(
  lines: readonly DocumentTotalsLine[] | undefined | null
): DocumentTotals {
  let subtotal = new Decimal(0);
  let vat = new Decimal(0);
  for (const line of lines ?? []) {
    subtotal = subtotal.plus(lineNetAmount(line));
    vat = vat.plus(lineVatAmount(line));
  }
  return {
    subtotal: subtotal.toNumber(),
    vatAmount: vat.toNumber(),
    total: subtotal.plus(vat).toNumber(),
  };
}
