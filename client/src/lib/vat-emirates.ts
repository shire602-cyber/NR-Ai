// The VAT 201 box 1 split by emirate (1a to 1g): read from any object that carries the box fields (a return, the
// Autopilot's vat201, a workpaper's totals), so every screen lists the same rows from the same numbers.

import { EMIRATE_LABELS } from "./enum-labels";

export interface EmirateBox {
  /** "1a" ... "1g" */
  box: string;
  slug: string;
  /** Field prefix on the return: box1aAbuDhabi + Amount / Vat / Adj. */
  prefix: string;
}

export const EMIRATE_BOXES: readonly EmirateBox[] = [
  { box: "1a", slug: "abu_dhabi", prefix: "box1aAbuDhabi" },
  { box: "1b", slug: "dubai", prefix: "box1bDubai" },
  { box: "1c", slug: "sharjah", prefix: "box1cSharjah" },
  { box: "1d", slug: "ajman", prefix: "box1dAjman" },
  { box: "1e", slug: "umm_al_quwain", prefix: "box1eUmmAlQuwain" },
  { box: "1f", slug: "ras_al_khaimah", prefix: "box1fRasAlKhaimah" },
  { box: "1g", slug: "fujairah", prefix: "box1gFujairah" },
] as const;

export interface EmirateRow extends EmirateBox {
  amount: number;
  vat: number;
  adjustment: number;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

/** The emirates that have anything in them, in box order. */
export function emirateRows(boxes: Record<string, unknown> | null | undefined): EmirateRow[] {
  if (!boxes) return [];
  return EMIRATE_BOXES.map((e) => ({
    ...e,
    amount: num(boxes[`${e.prefix}Amount`]),
    vat: num(boxes[`${e.prefix}Vat`]),
    adjustment: num(boxes[`${e.prefix}Adj`]),
  })).filter((r) => r.amount !== 0 || r.vat !== 0 || r.adjustment !== 0);
}

export const emirateBoxLabel = (row: EmirateBox, locale: string): string => {
  const label = EMIRATE_LABELS[row.slug];
  return `${row.box} ${locale === "ar" ? label.ar : label.en}`;
};

/** Do the emirate rows add up to the single standard-rated figure (amount and VAT)? Cents-tolerant. */
export function emirateRowsTie(
  rows: EmirateRow[],
  standardAmount: number,
  standardVat: number,
  tolerance = 0.01
): boolean {
  const amount = rows.reduce((s, r) => s + r.amount, 0);
  const vat = rows.reduce((s, r) => s + r.vat, 0);
  return Math.abs(amount - standardAmount) <= tolerance && Math.abs(vat - standardVat) <= tolerance;
}
