// Shared money math for line-based documents (quotes, credit notes, purchase
// orders, invoices). The server is the source of truth for totals — clients
// send lines only, and every create/update recomputes from them with
// decimal.js so NUMERIC(15,2) columns never accumulate binary-float drift.

import Decimal from "decimal.js";
import { allocate, sumFils } from "../../shared/money";
import {
  classifySupply,
  resolveSupplyType,
  type SupplyClassification,
  type SupplyType,
} from "../../shared/vat-classification";

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

/**
 * A-B13 — VAT rounding convention (deliberate, documented):
 * VAT is computed per line in full precision (Decimal), accumulated, and
 * rounded ONCE at the document level (FTA Executive Regulation Art. 30 permits
 * rounding at the line OR the invoice level). We use invoice-level rounding so
 * the document total always equals subtotal + VAT to the fil, and the VAT
 * autopilot rounds the same way (per bucket once) so its reconciliation agrees.
 * Do not switch to per-line rounding without aligning the autopilot tolerance.
 */
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

// ─── W3-A: sales documents in integer fils, with discounts and supply types ──
//
// One function computes every sales document (invoice, credit note, debit
// note, quote, recurring template) so the stored totals, the GL posting and
// the PDF can never disagree (R03-07, R03-12, R07-01).
//
//   gross      = qty × unit price                 (rounded half-up to fils)
//   line disc  = amount, or gross × pct / 100     (rounded half-up, ≤ gross)
//   doc disc   = amount, or Σ(gross−line disc) × pct / 100, allocated pro-rata
//                over lines with shared/money.allocate (parts sum exactly)
//   net        = gross − line disc − allocated doc disc
//   VAT        = Σ net × charged rate, rounded ONCE at document level (A-B13)
//   total      = Σ net + VAT

export type DiscountType = "amount" | "percent";

export interface SalesLineTotalsInput {
  quantity: number | string;
  /** Unit price in integer fils. */
  unitPriceFils: number;
  vatRate?: number | string | null;
  vatSupplyType?: SupplyType | string | null;
  discountType?: DiscountType | string | null;
  discountValue?: number | string | null;
}

export interface SalesLineTotals {
  grossFils: number;
  lineDiscountFils: number;
  documentDiscountFils: number;
  netFils: number;
  /** Per-line VAT for display; the document VAT is rounded once (vatFils). */
  vatFils: number;
  vatRate: number;
  classification: SupplyClassification;
}

export interface SalesDocumentTotals {
  lines: SalesLineTotals[];
  grossFils: number;
  lineDiscountFils: number;
  documentDiscountFils: number;
  discountFils: number;
  subtotalFils: number;
  vatFils: number;
  totalFils: number;
}

export class DocumentTotalsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly lineIndex?: number
  ) {
    super(message);
    this.name = "DocumentTotalsError";
  }
}

function halfUp(d: Decimal): number {
  const n = d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return Object.is(n, -0) ? 0 : n;
}

function discountFils(
  baseFils: number,
  type: string | null | undefined,
  value: number | string | null | undefined,
  lineIndex?: number
): number {
  if (!type || value === null || value === undefined || value === "") return 0;
  const v = new Decimal(value);
  if (!v.isFinite() || v.isNeg()) {
    throw new DocumentTotalsError("INVALID_DISCOUNT", "Discount must be zero or more", lineIndex);
  }
  let fils: number;
  if (type === "percent") {
    if (v.gt(100)) {
      throw new DocumentTotalsError("INVALID_DISCOUNT", "Percent discount above 100", lineIndex);
    }
    fils = halfUp(new Decimal(baseFils).times(v).dividedBy(100));
  } else if (type === "amount") {
    fils = halfUp(v.times(100));
  } else {
    throw new DocumentTotalsError("INVALID_DISCOUNT", `Unknown discount type ${type}`, lineIndex);
  }
  if (fils > baseFils) {
    throw new DocumentTotalsError(
      "DISCOUNT_EXCEEDS_AMOUNT",
      "Discount cannot exceed the amount it applies to",
      lineIndex
    );
  }
  return fils;
}

/**
 * Compute a sales document. `resolve: true` resolves (and validates) each
 * line's supply type from its rate (new input); otherwise stored rows are
 * classified as-is.
 */
export function computeSalesDocument(
  lines: SalesLineTotalsInput[],
  opts: {
    discountType?: DiscountType | string | null;
    discountValue?: number | string | null;
    reverseCharge?: boolean | null;
    resolve?: boolean;
  } = {}
): SalesDocumentTotals {
  const prepared = lines.map((line, i) => {
    let classification: SupplyClassification;
    if (opts.resolve) {
      let type: SupplyType;
      try {
        type = resolveSupplyType({
          supplyType: (line.vatSupplyType as SupplyType | null | undefined) ?? null,
          vatRate: line.vatRate ?? 0.05,
          reverseCharge: opts.reverseCharge,
        });
      } catch (err) {
        const e = err as { code?: string; message?: string };
        throw new DocumentTotalsError(e.code ?? "INVALID_SUPPLY_TYPE", e.message ?? "", i);
      }
      classification = classifySupply({ supplyType: type });
    } else {
      classification = classifySupply({
        supplyType: line.vatSupplyType,
        vatRate: line.vatRate,
        reverseCharge: opts.reverseCharge,
      });
    }
    const grossFils = halfUp(new Decimal(line.quantity).times(line.unitPriceFils));
    const lineDiscountFils = discountFils(grossFils, line.discountType, line.discountValue, i);
    return { classification, grossFils, lineDiscountFils, afterLine: grossFils - lineDiscountFils };
  });

  const afterLineTotal = sumFils(prepared.map((p) => p.afterLine));
  const documentDiscountFils = discountFils(afterLineTotal, opts.discountType, opts.discountValue);
  const shares =
    documentDiscountFils > 0 && afterLineTotal > 0
      ? allocate(
          documentDiscountFils,
          prepared.map((p) => p.afterLine)
        )
      : prepared.map(() => 0);

  let vatExact = new Decimal(0);
  const out: SalesLineTotals[] = prepared.map((p, i) => {
    const netFils = p.afterLine - shares[i];
    const rate = p.classification.chargedVatRate;
    const lineVat = new Decimal(netFils).times(rate);
    vatExact = vatExact.plus(lineVat);
    return {
      grossFils: p.grossFils,
      lineDiscountFils: p.lineDiscountFils,
      documentDiscountFils: shares[i],
      netFils,
      vatFils: halfUp(lineVat),
      vatRate: rate,
      classification: p.classification,
    };
  });

  const subtotalFils = sumFils(out.map((l) => l.netFils));
  const vatFils = halfUp(vatExact);
  const lineDiscountTotal = sumFils(out.map((l) => l.lineDiscountFils));
  return {
    lines: out,
    grossFils: sumFils(out.map((l) => l.grossFils)),
    lineDiscountFils: lineDiscountTotal,
    documentDiscountFils,
    discountFils: lineDiscountTotal + documentDiscountFils,
    subtotalFils,
    vatFils,
    totalFils: subtotalFils + vatFils,
  };
}

/** Stored invoice/quote line row → totals input (unit price numeric → fils). */
export function storedLineToTotalsInput(line: {
  quantity: number | string;
  unitPrice: number | string;
  vatRate?: number | string | null;
  vatSupplyType?: string | null;
  discountType?: string | null;
  discountValue?: number | string | null;
}): SalesLineTotalsInput {
  return {
    quantity: line.quantity,
    unitPriceFils: halfUp(new Decimal(line.unitPrice).times(100)),
    vatRate: line.vatRate,
    vatSupplyType: line.vatSupplyType,
    discountType: line.discountType,
    discountValue: line.discountValue,
  };
}
