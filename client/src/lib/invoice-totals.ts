/**
 * Invoice-form totals (S1, W5-E follow-up). Pure and isomorphic: the invoice editor shows the
 * same subtotal / VAT / total the server will store, because it follows the same rules as
 * server/services/document-totals.service.ts computeSalesDocument:
 *
 *   gross     = qty × unit price               (integer fils, rounded half-up)
 *   line disc = gross × pct / 100              (half-up, never more than gross)
 *   net       = gross − line disc
 *   VAT       = Σ net × charged rate, rounded ONCE at document level (A-B13)
 *   total     = Σ net + VAT
 *
 * Only standard-rated lines charge VAT (at the UAE standard rate, 5%);
 * zero-rated, exempt, out-of-scope and reverse-charge lines charge 0%.
 *
 * Profit-margin scheme lines (S8, R07-15; second-hand goods, standard-rated only): the price is
 * VAT-inclusive and VAT is the tax fraction of the margin over the purchase cost, rounded per
 * line: VAT = halfUp(max(0, price − cost) × r / (1 + r)), net = price − VAT.
 * tests/unit/s1-sales-tax.test.ts checks it against the server engine.
 */

export type InvoiceFormSupplyType =
  | "standard_rated"
  | "zero_rated"
  | "exempt"
  | "out_of_scope"
  | "reverse_charge";

export interface InvoiceFormLine {
  quantity: number | string;
  /** Major units (e.g. AED), as typed in the form. */
  unitPrice: number | string;
  vatSupplyType?: InvoiceFormSupplyType | string | null;
  /** Line discount in percent, 0..100. */
  discountPercent?: number | string | null;
  /** Profit-margin scheme line (second-hand goods): price includes VAT on the margin only. */
  marginScheme?: boolean | null;
  /** Purchase cost of the whole line, major units (margin-scheme lines). */
  marginPurchaseCost?: number | string | null;
}

export interface InvoiceFormLineTotals {
  grossFils: number;
  discountFils: number;
  netFils: number;
  vatFils: number;
  vatRate: number;
  /** net + line VAT, major units (row display). */
  lineTotal: number;
  /** Margin-scheme lines: VAT-exclusive margin in fils (VAT 201 Box 1); null otherwise. */
  marginFils: number | null;
}

export interface InvoiceFormTotals {
  lines: InvoiceFormLineTotals[];
  subtotalFils: number;
  vatFils: number;
  totalFils: number;
  subtotal: number;
  vatAmount: number;
  total: number;
  /** Rates actually charged on the document, for the "VAT (5%)" label. */
  ratesCharged: number[];
}

export const UAE_STANDARD_RATE = 0.05;

/** Half-up rounding to an integer, robust to binary-float noise (e.g. 4999.4999999). */
function halfUp(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const cleaned = Number(x.toFixed(6));
  const n = cleaned < 0 ? -Math.round(-cleaned) : Math.round(cleaned);
  return Object.is(n, -0) ? 0 : n;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** VAT rate charged by a line's supply type. */
export function lineVatRate(
  supplyType: InvoiceFormSupplyType | string | null | undefined,
  standardRate = UAE_STANDARD_RATE
): number {
  return (supplyType ?? "standard_rated") === "standard_rated" ? standardRate : 0;
}

/** Compute one line (row display) without document-level rounding. */
export function computeInvoiceFormLine(
  line: InvoiceFormLine,
  standardRate = UAE_STANDARD_RATE
): InvoiceFormLineTotals {
  const qty = Math.max(0, num(line.quantity));
  const unitFils = halfUp(Math.max(0, num(line.unitPrice)) * 100);
  const grossFils = halfUp(qty * unitFils);
  const pct = Math.min(100, Math.max(0, num(line.discountPercent)));
  const discountFils = Math.min(grossFils, halfUp((grossFils * pct) / 100));
  const netFils = grossFils - discountFils;
  const vatRate = lineVatRate(line.vatSupplyType, standardRate);
  if (line.marginScheme && vatRate > 0) {
    const priceFils = grossFils - discountFils;
    const costFils = halfUp(Math.abs(num(line.marginPurchaseCost)) * 100);
    const margin = Math.max(0, priceFils - costFils);
    const marginVat = halfUp((margin * vatRate) / (1 + vatRate));
    return {
      grossFils,
      discountFils,
      netFils: priceFils - marginVat,
      vatFils: marginVat,
      vatRate,
      lineTotal: priceFils / 100,
      marginFils: margin - marginVat,
    };
  }
  const vatFils = halfUp(netFils * vatRate);
  return {
    grossFils,
    discountFils,
    netFils,
    vatFils,
    vatRate,
    lineTotal: (netFils + vatFils) / 100,
    marginFils: null,
  };
}

/** Compute the whole form (document-level VAT rounding, like the server). */
export function computeInvoiceFormTotals(
  lines: InvoiceFormLine[] | null | undefined,
  standardRate = UAE_STANDARD_RATE
): InvoiceFormTotals {
  const out = (lines ?? []).map((l) => computeInvoiceFormLine(l, standardRate));
  const subtotalFils = out.reduce((s, l) => s + l.netFils, 0);
  // Margin lines carry their per-line rounded VAT; other lines are rounded once below.
  const vatExact = out.reduce(
    (s, l) => s + (l.marginFils !== null ? l.vatFils : l.netFils * l.vatRate),
    0
  );
  const vatFils = halfUp(vatExact);
  const totalFils = subtotalFils + vatFils;
  const ratesCharged = [...new Set(out.filter((l) => l.netFils > 0).map((l) => l.vatRate))].sort(
    (a, b) => b - a
  );
  return {
    lines: out,
    subtotalFils,
    vatFils,
    totalFils,
    subtotal: subtotalFils / 100,
    vatAmount: vatFils / 100,
    total: totalFils / 100,
    ratesCharged,
  };
}
