/**
 * Exact money arithmetic in integer fils (1 AED = 100 fils).
 *
 * Every amount column in the schema is `numeric(15,2)`, so the representable
 * range is ±9,999,999,999,999.99 — i.e. ±999,999,999,999,999 fils, which fits
 * comfortably inside Number.MAX_SAFE_INTEGER (≈9.007e15). Fils are therefore
 * plain JS integers: safe to add/compare with `+` / `===` and to serialise as
 * JSON without precision loss.
 *
 * Policy (frozen contract — later modules rely on it):
 *   - No tolerance anywhere. 100.01 !== 100.00; there is no epsilon compare.
 *   - Parsing is strict by default: more than 2 decimal places is rejected.
 *     Callers that *mean* to round must opt in with `{ rounding: "halfUp" }`.
 *   - Rounding is ROUND_HALF_UP in the decimal.js sense: ties round AWAY from
 *     zero (2.345 → 2.35, -2.345 → -2.35).
 *   - Anything outside numeric(15,2) throws MoneyError("MONEY_OUT_OF_RANGE").
 *   - Decimal maths uses decimal.js, never binary floating point.
 */
import Decimal from "decimal.js";

/** Largest absolute value numeric(15,2) can hold, in fils. */
export const MAX_FILS = 999_999_999_999_999;

/** FX rates are carried to 6 decimal places (half-up) before multiplication. */
export const RATE_DECIMALS = 6;

export type MoneyErrorCode =
  | "MONEY_INVALID"
  | "MONEY_NOT_FINITE"
  | "MONEY_TOO_PRECISE"
  | "MONEY_OUT_OF_RANGE"
  | "MONEY_INVALID_RATE"
  | "MONEY_INVALID_RATIOS";

/**
 * Thrown for any money input that cannot be represented exactly. The server's
 * global error handler maps this to HTTP 400 with `code`.
 */
export class MoneyError extends Error {
  readonly code: MoneyErrorCode;
  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = "MoneyError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type Rounding = "reject" | "halfUp";

export interface ToFilsOptions {
  /** "reject" (default): >2dp throws. "halfUp": round half away from zero to 2dp. */
  rounding?: Rounding;
}

/** Plain decimal literal: optional sign, digits, optional fraction. No exponent, no grouping. */
const DECIMAL_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

// Isolated Decimal constructor so global Decimal config elsewhere cannot leak in.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

function toDecimal(input: unknown): Decimal {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new MoneyError("MONEY_NOT_FINITE", `Amount must be a finite number, got ${input}`);
    }
    // Number#toString gives the shortest round-tripping representation, so
    // 0.1 → "0.1" (not 0.1000000000000000055…), while 0.1 + 0.2 stays
    // 0.30000000000000004 and is rejected by the precision check below.
    return new D(input.toString());
  }
  if (typeof input === "string") {
    const s = input.trim();
    if (!DECIMAL_LITERAL.test(s)) {
      throw new MoneyError("MONEY_INVALID", `Amount "${input}" is not a plain decimal number`);
    }
    return new D(s);
  }
  if (typeof input === "bigint") return new D(input.toString());
  throw new MoneyError("MONEY_INVALID", "Amount must be a number or decimal string");
}

function assertRange(fils: Decimal | number): void {
  const abs = typeof fils === "number" ? Math.abs(fils) : fils.abs().toNumber();
  if (abs > MAX_FILS) {
    throw new MoneyError(
      "MONEY_OUT_OF_RANGE",
      "Amount exceeds the numeric(15,2) range (±9,999,999,999,999.99)"
    );
  }
}

function assertFils(fils: number, label = "fils"): void {
  if (!Number.isSafeInteger(fils)) {
    throw new MoneyError("MONEY_INVALID", `${label} must be a safe integer, got ${fils}`);
  }
  assertRange(fils);
}

/** Round a decimal value half-up (away from zero) to 2dp and return the decimal string. */
export function roundHalfUp(input: number | string, decimals = 2): string {
  return toDecimal(input).toDecimalPlaces(decimals, D.ROUND_HALF_UP).toFixed(decimals);
}

/**
 * Parse a major-unit amount (e.g. "1234.50" or 1234.5) into integer fils.
 * Throws MoneyError on NaN/Infinity, non-decimal strings, >2dp (unless
 * rounding: "halfUp"), and values outside numeric(15,2).
 */
export function toFils(input: number | string, opts: ToFilsOptions = {}): number {
  let d = toDecimal(input);
  if (d.decimalPlaces() > 2) {
    if ((opts.rounding ?? "reject") === "reject") {
      throw new MoneyError(
        "MONEY_TOO_PRECISE",
        `Amount "${String(input)}" has more than 2 decimal places`
      );
    }
    d = d.toDecimalPlaces(2, D.ROUND_HALF_UP);
  }
  const fils = d.times(100);
  assertRange(fils);
  const n = fils.toNumber();
  return Object.is(n, -0) ? 0 : n;
}

/** Non-throwing variant of toFils. */
export function tryToFils(input: unknown, opts: ToFilsOptions = {}): number | null {
  if (typeof input !== "number" && typeof input !== "string") return null;
  try {
    return toFils(input, opts);
  } catch {
    return null;
  }
}

/** Integer fils → exact 2dp decimal string ("1234.50"), suitable for numeric columns. */
export function fromFils(fils: number): string {
  assertFils(fils);
  return new D(fils).dividedBy(100).toFixed(2);
}

/** Integer fils → JS number in major units. Only for legacy callers/charts; prefer fromFils. */
export function filsToNumber(fils: number): number {
  return Number(fromFils(fils));
}

/** Exact sum of fils values; throws if the total leaves numeric(15,2). */
export function sumFils(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) {
    assertFils(v);
    total += v;
    // Each addend ≤ MAX_FILS so the running sum stays a safe integer between checks.
    assertRange(total);
  }
  return total;
}

/**
 * Multiply an amount by a rate (FX rate, VAT rate, percentage as a fraction).
 * The rate is rounded half-up to 6dp first, then the product is rounded
 * half-up to whole fils. Rates must be finite and > 0.
 */
export function mulRate(fils: number, rate: number | string): number {
  assertFils(fils);
  let r: Decimal;
  try {
    r = toDecimal(rate);
  } catch {
    throw new MoneyError("MONEY_INVALID_RATE", `Rate "${String(rate)}" is not a valid number`);
  }
  if (r.lte(0)) throw new MoneyError("MONEY_INVALID_RATE", "Rate must be greater than zero");
  r = r.toDecimalPlaces(RATE_DECIMALS, D.ROUND_HALF_UP);
  const product = new D(fils).times(r).toDecimalPlaces(0, D.ROUND_HALF_UP);
  assertRange(product);
  const n = product.toNumber();
  return Object.is(n, -0) ? 0 : n;
}

/**
 * Split `fils` across `ratios` so the parts always sum back to `fils` exactly.
 * Each part gets floor(share); leftover fils go one at a time to the parts with
 * the largest fractional remainder (ties → earlier index). Negative totals are
 * allocated on the absolute value and negated.
 */
export function allocate(fils: number, ratios: ReadonlyArray<number | string>): number[] {
  assertFils(fils);
  if (ratios.length === 0) throw new MoneyError("MONEY_INVALID_RATIOS", "No ratios given");
  const rs = ratios.map((r) => {
    const d = toDecimal(r);
    if (d.isNeg()) throw new MoneyError("MONEY_INVALID_RATIOS", "Ratios must be >= 0");
    return d;
  });
  const total = rs.reduce((a, b) => a.plus(b), new D(0));
  if (total.isZero()) throw new MoneyError("MONEY_INVALID_RATIOS", "Ratios must not all be zero");

  const sign = fils < 0 ? -1 : 1;
  const abs = Math.abs(fils);
  const exact = rs.map((r) => new D(abs).times(r).dividedBy(total));
  const parts = exact.map((e) => e.floor().toNumber());
  let remainder = abs - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e.minus(e.floor()) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length) {
    // Never hand a leftover fils to a zero-ratio part.
    if (!rs[order[k].i].isZero()) {
      parts[order[k].i] += 1;
      remainder -= 1;
    }
  }
  return parts.map((p) => (p === 0 ? 0 : p * sign));
}

export interface FormatFilsOptions {
  /** Currency code prefix, e.g. "AED". Pass null for a bare number. Default "AED". */
  currency?: string | null;
  /** Insert thousands separators. Default true. */
  grouping?: boolean;
}

/** Format fils for display without floating point: "AED 1,234.50", "-AED 5.00". */
export function formatFils(fils: number, opts: FormatFilsOptions = {}): string {
  const { currency = "AED", grouping = true } = opts;
  const str = fromFils(Math.abs(fils));
  const [intPart, frac] = str.split(".");
  const grouped = grouping ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : intPart;
  const body = currency ? `${currency} ${grouped}.${frac}` : `${grouped}.${frac}`;
  return fils < 0 ? `-${body}` : body;
}
