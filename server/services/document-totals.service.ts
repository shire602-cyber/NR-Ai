// Shared money math for line-based documents (quotes, credit notes, purchase
// orders, invoices). The server is the source of truth for totals — clients
// send lines only, and every create/update recomputes from them with
// decimal.js so NUMERIC(15,2) columns never accumulate binary-float drift.

import Decimal from "decimal.js";

export interface DocumentLineInput {
  quantity: number | string;
  unitPrice: number | string;
  vatRate?: number | string | null;
}

const UAE_STANDARD_RATE = 0.05;

/** Normalise a VAT rate to decimal form; accepts 5 (percent) or 0.05. */
export function normaliseVatRate(raw: number | string | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") return UAE_STANDARD_RATE;
  const n = Number(raw);
  if (!Number.isFinite(n)) return UAE_STANDARD_RATE;
  return n === 5 ? UAE_STANDARD_RATE : n;
}

export function calculateDocumentTotals(lines: DocumentLineInput[] | undefined | null): {
  subtotal: number;
  vatAmount: number;
  total: number;
} {
  let subtotalD = new Decimal(0);
  let vatAmountD = new Decimal(0);

  for (const line of lines ?? []) {
    const lineTotal = new Decimal(Number(line.unitPrice) || 0).times(Number(line.quantity) || 0);
    subtotalD = subtotalD.plus(lineTotal);
    vatAmountD = vatAmountD.plus(lineTotal.times(normaliseVatRate(line.vatRate)));
  }

  return {
    subtotal: subtotalD.toDecimalPlaces(2).toNumber(),
    vatAmount: vatAmountD.toDecimalPlaces(2).toNumber(),
    total: subtotalD.plus(vatAmountD).toDecimalPlaces(2).toNumber(),
  };
}
