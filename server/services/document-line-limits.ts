// Single source of truth for the numeric limits of a document line, shared by
// invoices, credit notes, quotes, purchase orders and recurring templates.
//
// Storage: quantity is numeric(15,4) (largest value 9,999,999,999.9999) and
// unit price is numeric(19,6) (largest value 9,999,999,999,999.999999). zod used
// to allow up to 1e12 for both, so a quantity between 1e11 and 1e12 passed
// validation and Postgres answered "numeric field overflow" (HTTP 500).
//
// Values are also normalised to the STORED precision (price 6dp, quantity 4dp,
// half-up) at the input boundary, before totals are computed, so the document
// totals, the VAT return and the revenue allocation all see exactly what is
// persisted.

import Decimal from "decimal.js";
import { z } from "zod";
import { MAX_LINE_QUANTITY as MAX_QUANTITY_LIMIT, MAX_UNIT_PRICE as MAX_PRICE_LIMIT } from "../../shared/line-limits";

export const QUANTITY_DECIMALS = 4;
export const UNIT_PRICE_DECIMALS = 6;

// The two limits live in ONE shared constants file (decimal strings, because
// 9,999,999,999,999.999999 is not exactly representable as a JS number).
export { MAX_LINE_QUANTITY, MAX_UNIT_PRICE } from "../../shared/line-limits";

const MAX_LINE_QUANTITY_EXACT = new Decimal(MAX_QUANTITY_LIMIT);
const MAX_LINE_UNIT_PRICE_EXACT = new Decimal(MAX_PRICE_LIMIT);

export function normalizeQuantity(value: number): number {
  return new Decimal(value).toDecimalPlaces(QUANTITY_DECIMALS, Decimal.ROUND_HALF_UP).toNumber();
}

export function normalizeUnitPrice(value: number): number {
  return new Decimal(value).toDecimalPlaces(UNIT_PRICE_DECIMALS, Decimal.ROUND_HALF_UP).toNumber();
}

const boundedNumber = (label: string, max: Decimal, tooLarge: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number` })
    .finite(`${label} must be a number`)
    .refine((v) => new Decimal(v).abs().lte(max), { message: tooLarge });

const quantityBase = boundedNumber(
  "Line quantity",
  MAX_LINE_QUANTITY_EXACT,
  "Line quantity is too large (maximum 9,999,999,999.9999)"
);
const unitPriceBase = boundedNumber(
  "Line unit price",
  MAX_LINE_UNIT_PRICE_EXACT,
  "Line unit price is too large (maximum 9,999,999,999,999.999999)"
);

/** Invoice / credit-note line quantity: > 0, capped, rounded to 4dp. */
export const requiredQuantity = quantityBase
  .refine((v) => v > 0, { message: "Line quantity must be greater than 0" })
  .transform(normalizeQuantity)
  .refine((v) => v > 0, { message: "Line quantity is too small (minimum 0.0001)" });

/** Invoice / credit-note line unit price: > 0, capped, rounded to 6dp. */
export const requiredUnitPrice = unitPriceBase
  .refine((v) => v > 0, { message: "Line unit price must be greater than 0" })
  .transform(normalizeUnitPrice)
  .refine((v) => v > 0, { message: "Line unit price is too small (minimum 0.000001)" });

// Quote / purchase-order / recurring lines have no zod schema of their own and
// legitimately allow zero-priced lines, so they only get the cap + rounding.
const looseLineSchema = z
  .object({
    quantity: quantityBase.transform(normalizeQuantity).optional(),
    unitPrice: unitPriceBase.transform(normalizeUnitPrice).optional(),
  })
  .passthrough();

/**
 * Cap and round the quantity / unit price of free-form document lines.
 * Throws a ZodError (the central handler renders it as HTTP 400) when a value
 * is too large to store; every other property is passed through untouched.
 */
export function normalizeDocumentLines<T extends Record<string, any>>(lines: T[]): T[] {
  return z.array(looseLineSchema).parse(lines) as unknown as T[];
}
