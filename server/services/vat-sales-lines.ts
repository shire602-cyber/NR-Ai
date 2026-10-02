// Pure aggregation of invoice / credit-note lines into the VAT 201 sales
// buckets used by the return generator (vat.routes.ts). Kept out of the route
// so it can be unit-tested next to the other two engines. Placement is decided
// by classifyVatLineForReturn, shared with the autopilot and the firm workpaper.

import Decimal from "decimal.js";
import { UAE_VAT_RATE } from "../constants";
import { classifyVatLineForReturn } from "./vat-supply-type";

export interface ReturnSalesLine {
  invoiceId: string;
  quantity: number | string;
  unitPrice: number | string;
  vatRate?: number | string | null;
  vatSupplyType?: string | null;
}

export interface ReturnSalesTotals {
  standardRatedAmount: number;
  standardRatedVat: number;
  zeroRatedAmount: number;
  exemptAmount: number;
}

export type ReturnLineCategory = "standard" | "zero_rated" | "exempt" | "excluded";

export interface AllocatedReturnLine {
  /** Position of the line in the input array. */
  index: number;
  category: ReturnLineCategory;
  /** AED, exact fils. */
  amountAed: number;
  /** AED, exact fils (standard-rated lines only). */
  vatAed: number;
}

const D = (v: Decimal.Value) => new Decimal(v);

/**
 * Spread `target` (exact fils) over `values` so the pieces add up to it: round each value down to the fil, then give the
 * remaining fils to the values with the largest fractional parts. Order-stable and deterministic.
 */
function allocateFils(values: Decimal[], target: Decimal): Decimal[] {
  const cents = values.map((v) => v.times(100));
  const floors = cents.map((c) => c.floor());
  let remaining = target.times(100).minus(floors.reduce((a, b) => a.plus(b), D(0))).toNumber();
  const order = cents.map((c, i) => ({ i, frac: c.minus(c.floor()).toNumber() })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = floors.map((f) => f);
  for (let k = 0; remaining > 0 && order.length > 0; k = (k + 1) % order.length, remaining--) out[order[k].i] = out[order[k].i].plus(1);
  for (let k = order.length - 1; remaining < 0 && order.length > 0; k = (k - 1 + order.length) % order.length, remaining++) out[order[k].i] = out[order[k].i].minus(1);
  return out.map((c) => c.div(100));
}

/**
 * The ONE rounding rule of the return, the ledger and the VAT Audit report. A document is rounded once, in its own currency
 * (calculateDocumentTotals), and posted to the ledger at round(document amount x rate) (invoice-posting.service.ts). So each
 * (invoice, VAT category) group is worth round(round(sum of its lines in document currency) x rate) in AED, and that exact
 * figure is spread over its lines (largest remainder). The return adds the lines; the audit report lists them; both equal
 * the ledger to the fil, with no per-line or per-return rounding of their own.
 */
export function allocateReturnSalesLines(lines: ReturnSalesLine[], rateByInvoiceId: Map<string, number>): AllocatedReturnLine[] {
  const groups = new Map<string, number[]>();
  const meta = lines.map((line, index) => {
    const category = classifyVatLineForReturn({ rate: line.vatRate, supplyType: line.vatSupplyType }) as ReturnLineCategory;
    const net = D(line.quantity).times(line.unitPrice);
    const vatRate = line.vatRate == null ? UAE_VAT_RATE : Number(line.vatRate);
    const vat = category === "standard" ? net.times(vatRate) : D(0);
    const key = `${line.invoiceId}|${category}`;
    groups.set(key, [...(groups.get(key) ?? []), index]);
    return { category, net, vat, invoiceId: line.invoiceId };
  });
  const out: AllocatedReturnLine[] = lines.map((_, index) => ({ index, category: meta[index].category, amountAed: 0, vatAed: 0 }));
  for (const indexes of groups.values()) {
    const fx = D(rateByInvoiceId.get(meta[indexes[0]].invoiceId) ?? 1);
    const docNet = indexes.reduce((a, i) => a.plus(meta[i].net), D(0));
    const docVat = indexes.reduce((a, i) => a.plus(meta[i].vat), D(0));
    const targetNet = docNet.toDecimalPlaces(2).times(fx).toDecimalPlaces(2);
    const targetVat = docVat.toDecimalPlaces(2).times(fx).toDecimalPlaces(2);
    const nets = allocateFils(indexes.map((i) => meta[i].net.times(fx)), targetNet);
    const vats = allocateFils(indexes.map((i) => meta[i].vat.times(fx)), targetVat);
    indexes.forEach((lineIndex, k) => {
      out[lineIndex].amountAed = nets[k].toNumber();
      out[lineIndex].vatAed = vats[k].toNumber();
    });
  }
  return out;
}

/**
 * Amounts are converted to AED at the invoice's stored transaction-date rate (`rateByInvoiceId`, default 1) with the
 * document-level rounding of allocateReturnSalesLines, so they are exact fils and equal what the ledger holds.
 */
export function aggregateReturnSalesLines(
  lines: ReturnSalesLine[],
  rateByInvoiceId: Map<string, number>
): ReturnSalesTotals {
  const totals = { standardRatedAmount: D(0), standardRatedVat: D(0), zeroRatedAmount: D(0), exemptAmount: D(0) };
  for (const l of allocateReturnSalesLines(lines, rateByInvoiceId)) {
    switch (l.category) {
      case "standard":
        totals.standardRatedAmount = totals.standardRatedAmount.plus(l.amountAed);
        totals.standardRatedVat = totals.standardRatedVat.plus(l.vatAed);
        break;
      case "zero_rated":
        totals.zeroRatedAmount = totals.zeroRatedAmount.plus(l.amountAed);
        break;
      case "exempt":
        totals.exemptAmount = totals.exemptAmount.plus(l.amountAed);
        break;
      case "excluded":
        break;
    }
  }
  return {
    standardRatedAmount: totals.standardRatedAmount.toNumber(),
    standardRatedVat: totals.standardRatedVat.toNumber(),
    zeroRatedAmount: totals.zeroRatedAmount.toNumber(),
    exemptAmount: totals.exemptAmount.toNumber(),
  };
}
