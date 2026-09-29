// Exact-decimal line maths for vendor bills. Pure module (zod + decimal.js
// only) so it is unit-testable without a database.
//
// Unit price is held to 6dp and quantity to 4dp (the column scales); both are
// rounded BEFORE the line amount is computed so the stored amount always equals
// stored quantity x stored unit price, rounded to 2dp.

import Decimal from "decimal.js";
import { z } from "zod";
import { MAX_LINE_QUANTITY, MAX_UNIT_PRICE } from "../../shared/line-limits";

const QUANTITY_DP = 4;
const UNIT_PRICE_DP = 6;
const AMOUNT_DP = 2;
const STANDARD_VAT_PERCENT = 5;

const groupThousands = (plain: string): string => {
  const [int, frac] = plain.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
};

function toDecimal(value: unknown): Decimal | null {
  if (typeof value === "number") return Number.isFinite(value) ? new Decimal(value) : null;
  if (typeof value === "string" && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(value.trim())) {
    return new Decimal(value.trim());
  }
  return null;
}

function boundedAmount(label: string, dp: number, max: string, allowBlank = false) {
  return z.union([z.number(), z.string()]).superRefine((value, ctx) => {
    if (allowBlank && typeof value === "string" && value.trim() === "") return;
    const d = toDecimal(value);
    if (!d) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a valid number` });
      return;
    }
    // Compare AFTER rounding to the column scale: a value that rounds up past
    // the maximum would overflow the column.
    if (d.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).abs().greaterThan(max)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must not exceed ${groupThousands(max)}`,
      });
    }
  });
}

export const billQuantitySchema = boundedAmount("Quantity", QUANTITY_DP, MAX_LINE_QUANTITY, true);
export const billUnitPriceSchema = boundedAmount("Unit price", UNIT_PRICE_DP, MAX_UNIT_PRICE);

/** VAT rate (stored as percent) honouring explicit zero-rated lines; only a
 * missing/non-numeric value falls back to the UAE standard 5%. */
export function resolveVatRatePercent(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return STANDARD_VAT_PERCENT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return STANDARD_VAT_PERCENT;
  // Normalise decimal form (0.05) to percent form (5).
  return n === 0.05 ? STANDARD_VAT_PERCENT : n;
}

export interface BillLineInput {
  quantity?: number | string | null;
  unit_price: number | string;
  vat_rate?: number | string | null;
}

export interface ComputedBillLine {
  /** 4dp string, ready for the numeric(15,4) column. */
  quantity: string;
  /** 6dp string, ready for the numeric(19,6) column. */
  unitPrice: string;
  /** 2dp string: round(quantity x unitPrice). */
  amount: string;
  vatRatePercent: number;
}

export function computeBillLines(lines: readonly BillLineInput[]): {
  lines: ComputedBillLine[];
  subtotal: string;
  vatAmount: string;
} {
  let subtotal = new Decimal(0);
  let vat = new Decimal(0);
  const out = lines.map((line) => {
    // A blank/zero/unparseable quantity means "1", as before.
    const rawQty = toDecimal(line.quantity);
    const quantity = (rawQty && !rawQty.isZero() ? rawQty : new Decimal(1)).toDecimalPlaces(
      QUANTITY_DP,
      Decimal.ROUND_HALF_UP
    );
    const unitPrice = (toDecimal(line.unit_price) ?? new Decimal(0)).toDecimalPlaces(
      UNIT_PRICE_DP,
      Decimal.ROUND_HALF_UP
    );
    const amount = quantity.times(unitPrice).toDecimalPlaces(AMOUNT_DP, Decimal.ROUND_HALF_UP);
    const vatRatePercent = resolveVatRatePercent(line.vat_rate);
    subtotal = subtotal.plus(amount);
    vat = vat.plus(amount.times(vatRatePercent).div(100));
    return {
      quantity: quantity.toFixed(QUANTITY_DP),
      unitPrice: unitPrice.toFixed(UNIT_PRICE_DP),
      amount: amount.toFixed(AMOUNT_DP),
      vatRatePercent,
    };
  });
  return {
    lines: out,
    subtotal: subtotal.toFixed(AMOUNT_DP),
    vatAmount: vat.toDecimalPlaces(AMOUNT_DP, Decimal.ROUND_HALF_UP).toFixed(AMOUNT_DP),
  };
}
