// Pure math for the sales line model (Phase 8 D1), shared by server and client.
//
// Every VAT engine computes `quantity x unit_price` per line and groups by VAT
// rate / supply type (vat-sales-lines.ts, vat-autopilot, firm workpaper,
// revenue allocation). Discounts, shipping and advance deductions are therefore
// stored as SERVER-DERIVED SIGNED LINES that the engines net unchanged:
//
//   item        client      qty x price
//   discount    server      quantity 1 x unit price -amount   (child of a line, or one per VAT bucket)
//   shipping    client      amount, at the dominant item VAT rate by default
//   advance     server      quantity 1 x unit price -net       (a deducted customer advance)
//
// No imports from the server: this file is bundled into the client as well.

import Decimal from "decimal.js";

export type SalesLineKind = "item" | "discount" | "shipping" | "advance" | "late_fee";
export type DiscountType = "percent" | "amount";

const STANDARD_RATE = 0.05;

const D = (n: number | string) => new Decimal(n);
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const num2 = (d: Decimal) => r2(d).toNumber();

export interface SalesLineInput {
  kind: "item" | "shipping";
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  vatSupplyType?: string | null;
  discountType?: DiscountType | null;
  discountValue?: number | null;
  /** Anything else the caller carries on the line (product, revenue account, ...) rides along in `source`. */
  [extra: string]: unknown;
}

export interface AdvanceDeduction {
  advanceId: string;
  /** Line text, e.g. "Less advance ADV-2026-00001 (INV-2026-00007)". */
  description: string;
  /** Positive net being deducted, document currency. */
  net: number;
  vatRate: number;
  vatSupplyType?: string | null;
  applicationId?: string | null;
}

export interface DerivedSalesLine {
  lineKind: SalesLineKind;
  /** Index into the INPUT `lines` for item and shipping lines. */
  sourceIndex?: number;
  /** Index into the OUTPUT lines of the parent item (line-level discounts). */
  parentIndex?: number;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  vatSupplyType: string;
  discountType?: DiscountType | null;
  discountValue?: number | null;
  customerAdvanceId?: string;
  applicationId?: string | null;
}

export type DeriveError = {
  ok: false;
  code:
    | "DISCOUNT_EXCEEDS_LINE"
    | "DISCOUNT_EXCEEDS_SUBTOTAL"
    | "DISCOUNT_INVALID"
    | "SHIPPING_LINE_LIMIT"
    | "ADVANCE_EXCEEDS_INVOICE";
  message: string;
};

export interface DerivedSales {
  ok: true;
  lines: DerivedSalesLine[];
  /** Item net after line and document discounts. */
  itemsSubtotal: number;
  /** All discounts (line + document), positive. */
  discountAmount: number;
  shippingAmount: number;
  /** Net of every line, advance deductions included. */
  subtotal: number;
  vatAmount: number;
  total: number;
}

const supplyTypeOf = (rate: number, explicit?: string | null): string => {
  if (rate > 0) return "standard_rated";
  return explicit === "exempt" || explicit === "out_of_scope" ? explicit : "zero_rated";
};

const bucketKey = (rate: number, supply: string) => `${rate}|${supply}`;

export function amountDiscountToPercent(amount: number, gross: number): number {
  if (!(gross > 0)) return 0;
  return D(amount).div(gross).times(100).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber();
}

function discountOf(
  gross: Decimal,
  type: DiscountType | null | undefined,
  value: number | null | undefined
): { ok: true; amount: Decimal } | { ok: false } {
  if (!type || value === null || value === undefined || !(value > 0)) return { ok: true, amount: D(0) };
  if (type === "percent") {
    if (value > 100) return { ok: false };
    return { ok: true, amount: r2(gross.times(value).div(100)) };
  }
  const amount = r2(D(value));
  if (amount.gt(gross)) return { ok: false };
  return { ok: true, amount };
}

/**
 * Rebuild the signed lines of a sales document from what the client sent
 * (item and shipping lines, discount inputs) and what the server holds (advance
 * deductions). Totals come from the derived lines exactly as the VAT engines
 * add them: sum of quantity x price, VAT at each line's own rate.
 */
export function deriveSalesLines(args: {
  lines: SalesLineInput[];
  discountType?: DiscountType | null;
  discountValue?: number | null;
  advances?: AdvanceDeduction[];
}): DerivedSales | DeriveError {
  const out: DerivedSalesLine[] = [];
  const itemBuckets = new Map<string, { rate: number; supply: string; net: Decimal }>();
  let shippingIndex = -1;
  let itemsNet = D(0);
  let lineDiscountTotal = D(0);

  for (let i = 0; i < args.lines.length; i++) {
    const l = args.lines[i];
    if (l.kind === "shipping") {
      if (shippingIndex >= 0) {
        return { ok: false, code: "SHIPPING_LINE_LIMIT", message: "A document can carry only one shipping line." };
      }
      shippingIndex = i;
      continue;
    }
    const rate = Number(l.vatRate);
    const supply = supplyTypeOf(rate, l.vatSupplyType);
    const gross = D(l.quantity).times(l.unitPrice);
    const disc = discountOf(gross, l.discountType, l.discountValue);
    if (!disc.ok) {
      return {
        ok: false,
        code: "DISCOUNT_EXCEEDS_LINE",
        message: `The discount on "${l.description}" is more than the line amount.`,
      };
    }
    const parentIndex = out.length;
    out.push({
      lineKind: "item",
      sourceIndex: i,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRate: rate,
      vatSupplyType: supply,
      discountType: l.discountType && l.discountValue && l.discountValue > 0 ? l.discountType : null,
      discountValue: l.discountType && l.discountValue && l.discountValue > 0 ? l.discountValue : null,
    });
    let netAfter = gross;
    if (disc.amount.gt(0)) {
      out.push({
        lineKind: "discount",
        parentIndex,
        description: `Discount: ${l.description}`,
        quantity: 1,
        unitPrice: -disc.amount.toNumber(),
        vatRate: rate,
        vatSupplyType: supply,
      });
      netAfter = gross.minus(disc.amount);
      lineDiscountTotal = lineDiscountTotal.plus(disc.amount);
    }
    itemsNet = itemsNet.plus(netAfter);
    const key = bucketKey(rate, supply);
    const cur = itemBuckets.get(key) ?? { rate, supply, net: D(0) };
    cur.net = cur.net.plus(netAfter);
    itemBuckets.set(key, cur);
  }

  // Document discount, pro rata per (rate, supply type) bucket of the item net after line discounts.
  let docDiscountTotal = D(0);
  const docType = args.discountType;
  const docValue = args.discountValue;
  if (docType && docValue && docValue > 0) {
    const want = discountOf(itemsNet, docType, docValue);
    if (!want.ok || want.amount.gt(r2(itemsNet))) {
      return {
        ok: false,
        code: "DISCOUNT_EXCEEDS_SUBTOTAL",
        message: "The document discount is more than the total of the items.",
      };
    }
    const total = want.amount;
    if (total.gt(0)) {
      const buckets = [...itemBuckets.values()].filter((b) => b.net.gt(0));
      const parts = buckets.map((b) => ({ b, amount: r2(total.times(b.net).div(itemsNet)) }));
      const assigned = parts.reduce((s, p) => s.plus(p.amount), D(0));
      const residual = total.minus(assigned);
      if (!residual.isZero() && parts.length > 0) {
        const largest = parts.reduce((m, p) => (p.b.net.gt(m.b.net) ? p : m), parts[0]);
        largest.amount = largest.amount.plus(residual);
      }
      for (const p of parts) {
        if (p.amount.lte(0)) continue;
        out.push({
          lineKind: "discount",
          description: "Discount",
          quantity: 1,
          unitPrice: -p.amount.toNumber(),
          vatRate: p.b.rate,
          vatSupplyType: p.b.supply,
        });
      }
      docDiscountTotal = total;
    }
  }

  // Shipping: one line, at the dominant item VAT rate unless the client chose one.
  let shippingAmount = D(0);
  if (shippingIndex >= 0) {
    const l = args.lines[shippingIndex];
    let rate = Number(l.vatRate);
    let supply = supplyTypeOf(rate, l.vatSupplyType);
    if (!Number.isFinite(rate) || l.vatRate === undefined || l.vatRate === null) {
      const dominant = [...itemBuckets.values()].sort((a, b) => b.net.comparedTo(a.net))[0];
      rate = dominant ? dominant.rate : STANDARD_RATE;
      supply = dominant ? dominant.supply : "standard_rated";
    }
    shippingAmount = D(l.quantity).times(l.unitPrice);
    out.push({
      lineKind: "shipping",
      sourceIndex: shippingIndex,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRate: rate,
      vatSupplyType: supply,
    });
  }

  // Advance deductions: each at its own rate, within the item net at that rate (after the discounts).
  const advanceByBucket = new Map<string, Decimal>();
  for (const a of args.advances ?? []) {
    const supply = supplyTypeOf(Number(a.vatRate), a.vatSupplyType);
    const key = bucketKey(Number(a.vatRate), supply);
    const used = (advanceByBucket.get(key) ?? D(0)).plus(a.net);
    const room = itemBuckets.get(key)?.net ?? D(0);
    if (used.gt(r2(room))) {
      return {
        ok: false,
        code: "ADVANCE_EXCEEDS_INVOICE",
        message: "The advance being applied is more than the invoice's items at that VAT rate.",
      };
    }
    advanceByBucket.set(key, used);
    out.push({
      lineKind: "advance",
      description: a.description,
      quantity: 1,
      unitPrice: -D(a.net).toNumber(),
      vatRate: Number(a.vatRate),
      vatSupplyType: supply,
      customerAdvanceId: a.advanceId,
      applicationId: a.applicationId ?? null,
    });
  }

  const totals = totalsOfLines(out);
  const itemsSubtotal = num2(itemsNet.minus(docDiscountTotal));
  return {
    ok: true,
    lines: out,
    itemsSubtotal,
    discountAmount: num2(lineDiscountTotal.plus(docDiscountTotal)),
    shippingAmount: num2(shippingAmount),
    ...totals,
  };
}

/** Document totals from lines, the way the VAT engines add them. */
export function totalsOfLines(lines: Array<{ quantity: number | string; unitPrice: number | string; vatRate: number | string }>): {
  subtotal: number;
  vatAmount: number;
  total: number;
} {
  let sub = D(0);
  let vat = D(0);
  for (const l of lines) {
    const net = D(l.quantity).times(l.unitPrice);
    sub = sub.plus(net);
    vat = vat.plus(net.times(l.vatRate));
  }
  // Total = rounded subtotal + rounded VAT, because that is what the revenue journal posts to
  // receivables (invoice-posting: subtotal + VAT), so AR always equals the document total.
  const subtotal = r2(sub);
  const vatAmount = r2(vat);
  return { subtotal: subtotal.toNumber(), vatAmount: vatAmount.toNumber(), total: r2(subtotal.plus(vatAmount)).toNumber() };
}

/** A gross amount at one VAT rate -> net and VAT (VAT is the remainder, so net + VAT = gross). */
export function splitGross(gross: number, vatRate: number): { net: number; vat: number } {
  const g = D(gross);
  const net = r2(g.div(D(1).plus(vatRate)));
  return { net: net.toNumber(), vat: r2(g.minus(net)).toNumber() };
}

export interface VatBucketAmounts {
  vatRate: number;
  vatSupplyType: string;
  net: number;
  vat: number;
}

/**
 * Split a gross refund over the VAT buckets of the invoice, pro rata to each
 * bucket's gross. The parts add up to the refund exactly (residual on the
 * largest bucket) and never exceed a bucket. Refunding the whole gross returns
 * the buckets unchanged.
 */
export function splitGrossRefund(refundGross: number, buckets: VatBucketAmounts[]): VatBucketAmounts[] {
  const gross = buckets.reduce((s, b) => s.plus(b.net).plus(b.vat), D(0));
  const refund = D(refundGross);
  if (refund.lte(0) || refund.gt(r2(gross))) {
    throw new Error("Refund is outside the invoice amount");
  }
  if (refund.eq(r2(gross))) return buckets.map((b) => ({ ...b }));
  const parts = buckets.map((b) => {
    const bg = D(b.net).plus(b.vat);
    const share = r2(refund.times(bg).div(gross));
    const split = b.vat === 0 || b.net === 0 ? { net: share, vat: D(0) } : splitGrossDecimal(share, D(b.vat).div(b.net));
    return { b, bg, net: split.net, vat: split.vat };
  });
  const assigned = parts.reduce((s, p) => s.plus(p.net).plus(p.vat), D(0));
  const residual = r2(refund.minus(assigned));
  if (!residual.isZero()) {
    const largest = parts.reduce((m, p) => (p.bg.gt(m.bg) ? p : m), parts[0]);
    // The VAT of a bucket follows its rate, so a residual fil goes to the net side.
    largest.net = largest.net.plus(residual);
  }
  return parts.map((p) => ({
    vatRate: p.b.vatRate,
    vatSupplyType: p.b.vatSupplyType,
    net: num2(p.net),
    vat: num2(p.vat),
  }));
}

function splitGrossDecimal(gross: Decimal, ratio: Decimal): { net: Decimal; vat: Decimal } {
  const net = r2(gross.div(D(1).plus(ratio)));
  return { net, vat: r2(gross.minus(net)) };
}
