// Shared money math for line-based documents (quotes, credit notes, purchase
// orders, invoices). The server is the source of truth for totals — clients
// send lines only, and every create/update recomputes from them with
// decimal.js so NUMERIC(15,2) columns never accumulate binary-float drift.

import Decimal from "decimal.js";
import { allocate, sumFils, toFils } from "../../shared/money";
import type { Invoice, InvoiceLine } from "../../shared/schema";
import {
  classifySupply,
  resolveSupplyType,
  type SupplyClassification,
  type SupplyType,
  UAE_STANDARD_VAT_RATE,
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

/** Legacy document-level calculator. Sales documents use computeSalesDocument. */
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
//   VAT        = Σ round(net × charged rate) per line (FTA VATP006)
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
  /**
   * S1 (R07-15): profit-margin scheme (VAT Decree-Law Art. 29, second-hand goods). The line price
   * is VAT-inclusive and VAT is charged on the margin only: VAT = (price − purchase cost) × r/(1+r).
   */
  marginScheme?: boolean | null;
  /** Purchase cost of the whole line in integer fils (margin-scheme lines). */
  marginCostFils?: number | null;
}

export interface SalesLineTotals {
  grossFils: number;
  lineDiscountFils: number;
  documentDiscountFils: number;
  netFils: number;
  /** Rounded tax on this line, included in the document VAT total. */
  vatFils: number;
  vatRate: number;
  classification: SupplyClassification;
  /** Margin-scheme lines: the VAT-exclusive margin reported in VAT 201 Box 1 (else null). */
  marginFils: number | null;
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
          vatRate: line.vatRate ?? UAE_STANDARD_VAT_RATE,
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
    if (line.marginScheme && classification.supplyType !== "standard_rated") {
      throw new DocumentTotalsError(
        "MARGIN_SCHEME_NOT_STANDARD",
        "The profit-margin scheme applies to standard-rated supplies only",
        i
      );
    }
    if (line.marginScheme) {
      const cost = Number(line.marginCostFils);
      if (!Number.isSafeInteger(cost) || cost < 0) {
        throw new DocumentTotalsError(
          "MARGIN_COST_REQUIRED",
          "A profit-margin scheme line needs its purchase cost",
          i
        );
      }
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

  const out: SalesLineTotals[] = prepared.map((p, i) => {
    const rate = p.classification.chargedVatRate;
    if (lines[i].marginScheme) {
      // Price (after discounts) is VAT-inclusive; VAT is the tax fraction of the margin,
      // rounded per line so the margin line's net + VAT equals its price exactly.
      const price = p.afterLine - shares[i];
      const margin = Math.max(0, price - Number(lines[i].marginCostFils ?? 0));
      const vat = halfUp(new Decimal(margin).times(rate).dividedBy(new Decimal(1).plus(rate)));
      return {
        grossFils: p.grossFils,
        lineDiscountFils: p.lineDiscountFils,
        documentDiscountFils: shares[i],
        netFils: price - vat,
        vatFils: vat,
        vatRate: rate,
        classification: p.classification,
        marginFils: margin - vat,
      };
    }
    const netFils = p.afterLine - shares[i];
    const lineVat = new Decimal(netFils).times(rate);
    return {
      grossFils: p.grossFils,
      lineDiscountFils: p.lineDiscountFils,
      documentDiscountFils: shares[i],
      netFils,
      vatFils: halfUp(lineVat),
      vatRate: rate,
      classification: p.classification,
      marginFils: null,
    };
  });

  return sumSalesLines(out);
}

export function sumSalesLines(lines: SalesLineTotals[]): SalesDocumentTotals {
  const subtotalFils = sumFils(lines.map((l) => l.netFils));
  const vatFils = sumFils(lines.map((l) => l.vatFils));
  const lineDiscountFils = sumFils(lines.map((l) => l.lineDiscountFils));
  const documentDiscountFils = sumFils(lines.map((l) => l.documentDiscountFils));
  return {
    lines,
    grossFils: sumFils(lines.map((l) => l.grossFils)),
    lineDiscountFils,
    documentDiscountFils,
    discountFils: lineDiscountFils + documentDiscountFils,
    subtotalFils,
    vatFils,
    totalFils: subtotalFils + vatFils,
  };
}

/** Read posted nets and their VAT without repricing quantities stored as PostgreSQL real. */
export function readStoredInvoiceLineAmounts(
  invoice: Pick<Invoice, "discountType" | "reverseCharge" | "vatAmount">,
  lines: InvoiceLine[]
) {
  const amounts = lines.map((line) => {
    if (line.netAmount == null) return null;
    const netFils = Math.abs(toFils(line.netAmount));
    const classification = classifySupply({
      supplyType: line.vatSupplyType,
      vatRate: line.vatRate,
      reverseCharge: invoice.reverseCharge,
    });
    const vatRate = classification.chargedVatRate;
    const marginFils = line.marginScheme
      ? Math.max(0, netFils - Math.abs(toFils(line.marginPurchaseCost ?? 0)))
      : null;
    const tax = new Decimal(marginFils ?? netFils).times(vatRate);
    if (marginFils === null || marginFils === 0) {
      const vatFils = halfUp(tax);
      return {
        netFils,
        vatFils,
        vatRate,
        classification,
        marginFils,
        minVatFils: vatFils,
        maxVatFils: vatFils,
      };
    }

    // Invert VAT = round((net + VAT - cost) × rate / (1 + rate)).
    // At a rounding boundary two VAT amounts can produce the same stored net.
    const halfStep = new Decimal(1).plus(vatRate).div(2);
    const minVatFils = tax.minus(halfStep).floor().plus(1).toNumber();
    const maxVatFils = tax.plus(halfStep).floor().toNumber();
    let vatFils = minVatFils;
    if (minVatFils !== maxVatFils && !invoice.discountType) {
      // Prefer the stored quantity's result when it distinguishes the two candidates.
      const grossFils = halfUp(
        new Decimal(line.quantity).abs().times(Math.abs(toFils(line.unitPrice)))
      );
      const estimatedVatFils = grossFils - Math.abs(toFils(line.discountAmount ?? 0)) - netFils;
      if (estimatedVatFils === maxVatFils) vatFils = maxVatFils;
    }
    return { netFils, vatFils, vatRate, classification, marginFils, minVatFils, maxVatFils };
  });

  if (amounts.every((amount) => amount !== null)) {
    let remainingVatFils =
      Math.abs(toFils(invoice.vatAmount)) - sumFils(amounts.map((amount) => amount.vatFils));
    for (const amount of amounts) {
      const adjustment = Math.min(
        Math.max(amount.minVatFils - amount.vatFils, remainingVatFils),
        amount.maxVatFils - amount.vatFils
      );
      amount.vatFils += adjustment;
      remainingVatFils -= adjustment;
    }
  }
  return amounts;
}

/** Stored invoice/quote line row → totals input (unit price numeric → fils). */
export function storedLineToTotalsInput(line: {
  quantity: number | string;
  unitPrice: number | string;
  vatRate?: number | string | null;
  vatSupplyType?: string | null;
  discountType?: string | null;
  discountValue?: number | string | null;
  marginScheme?: boolean | null;
  marginPurchaseCost?: number | string | null;
}): SalesLineTotalsInput {
  return {
    quantity: line.quantity,
    unitPriceFils: halfUp(new Decimal(line.unitPrice).times(100)),
    vatRate: line.vatRate,
    vatSupplyType: line.vatSupplyType,
    discountType: line.discountType,
    discountValue: line.discountValue,
    ...(line.marginScheme
      ? {
          marginScheme: true,
          marginCostFils: halfUp(new Decimal(line.marginPurchaseCost ?? 0).abs().times(100)),
        }
      : {}),
  };
}
