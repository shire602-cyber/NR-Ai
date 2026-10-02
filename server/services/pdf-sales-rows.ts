// The printed rows of a sales document (Phase 8 D1). Stored lines are item lines plus SERVER-DERIVED signed lines
// (line discounts, document discounts, shipping, advance deductions). On paper a line discount belongs to its item
// (a "Disc." column and a net amount), document discounts collapse into one row, shipping and each deducted advance
// ("Less advance ADV-... (INV-...)") get their own rows. Pure module: shared by the invoice, quote and sales-order PDFs.

import Decimal from "decimal.js";

export interface PdfSourceLine {
  id?: string;
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  vatRate?: number | string | null;
  lineKind?: string | null;
  parentLineId?: string | null;
  discountType?: string | null;
  discountValue?: number | string | null;
}

export type PdfRowKind = "item" | "discount" | "shipping" | "advance" | "late_fee";

export interface PdfRow {
  kind: PdfRowKind;
  /** English description as stored; `Discount` rows carry no description (the PDF prints a bilingual label). */
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  /** "10%" for a percent discount, the amount for an amount discount, otherwise null. */
  discountLabel: string | null;
  vatRate: number;
  /** Net amount of the row; negative for discounts and advance deductions. */
  amount: number;
}

const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

export function buildPdfRows(lines: PdfSourceLine[]): PdfRow[] {
  const childDiscount = new Map<string, Decimal>();
  for (const l of lines) {
    if (l.lineKind === "discount" && l.parentLineId) {
      childDiscount.set(
        l.parentLineId,
        (childDiscount.get(l.parentLineId) ?? new Decimal(0)).plus(new Decimal(l.quantity).times(l.unitPrice))
      );
    }
  }
  const rows: PdfRow[] = [];
  let docDiscount = new Decimal(0);
  let docDiscountRate: number | null = null;
  const docDiscountAt = rows.length;
  let docDiscountPosition = -1;

  for (const l of lines) {
    const kind = (l.lineKind || "item") as PdfRowKind;
    const vatRate = Number(l.vatRate ?? 0.05);
    const gross = new Decimal(l.quantity).times(l.unitPrice);
    if (kind === "discount") {
      if (l.parentLineId) continue; // folded into its item
      docDiscount = docDiscount.plus(gross);
      docDiscountRate = docDiscountRate === null ? vatRate : docDiscountRate === vatRate ? vatRate : -1;
      if (docDiscountPosition < 0) {
        docDiscountPosition = rows.length;
        rows.push({ kind: "discount", description: "", quantity: null, unitPrice: null, discountLabel: null, vatRate, amount: 0 });
      }
      continue;
    }
    if (kind === "item" || kind === "late_fee") {
      const disc = l.id ? childDiscount.get(l.id) : undefined; // negative
      const label = disc
        ? l.discountType === "percent" && l.discountValue !== null && l.discountValue !== undefined
          ? `${new Decimal(l.discountValue).toDecimalPlaces(2).toString()}%`
          : money(disc.abs()).toFixed(2)
        : null;
      rows.push({
        kind,
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountLabel: label,
        vatRate,
        amount: money(gross.plus(disc ?? 0)),
      });
      continue;
    }
    rows.push({
      kind,
      description: l.description,
      quantity: kind === "shipping" ? Number(l.quantity) : null,
      unitPrice: kind === "shipping" ? Number(l.unitPrice) : null,
      discountLabel: null,
      vatRate,
      amount: money(gross),
    });
  }
  if (docDiscountPosition >= 0) {
    rows[docDiscountPosition] = {
      ...rows[docDiscountPosition],
      vatRate: docDiscountRate !== null && docDiscountRate >= 0 ? docDiscountRate : rows[docDiscountPosition].vatRate,
      amount: money(docDiscount),
    };
  }
  void docDiscountAt;
  return rows;
}

/** Bilingual labels for the derived rows (English / Arabic). */
export const SALES_ROW_LABELS = {
  discount: { en: "Discount", ar: "خصم" },
  shipping: { en: "Delivery", ar: "رسوم التوصيل" },
  advanceLess: { en: "Less advance", ar: "ناقصاً: دفعة مقدمة" },
  discountColumn: { en: "Disc.", ar: "خصم" },
} as const;

export function advanceTitles(invoiceType: string | null | undefined, lines: Array<{ vatSupplyType?: string | null }>) {
  if (invoiceType !== "advance") return null;
  const deposit = lines.length > 0 && lines.every((l) => l.vatSupplyType === "out_of_scope");
  return deposit
    ? { en: "DEPOSIT RECEIPT", ar: "إيصال وديعة" }
    : { en: "ADVANCE TAX INVOICE", ar: "فاتورة ضريبية لدفعة مقدمة" };
}
