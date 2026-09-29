// Pure aggregation of invoice / credit-note lines into the VAT 201 sales
// buckets used by the return generator (vat.routes.ts). Kept out of the route
// so it can be unit-tested next to the other two engines. Placement is decided
// by classifyVatLineForReturn, shared with the autopilot and the firm workpaper.

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

/**
 * Amounts are converted to AED at the invoice's stored transaction-date rate
 * (`rateByInvoiceId`, default 1). Unrounded: the caller settles to fils.
 */
export function aggregateReturnSalesLines(
  lines: ReturnSalesLine[],
  rateByInvoiceId: Map<string, number>
): ReturnSalesTotals {
  const totals: ReturnSalesTotals = {
    standardRatedAmount: 0,
    standardRatedVat: 0,
    zeroRatedAmount: 0,
    exemptAmount: 0,
  };
  for (const line of lines) {
    const fxRate = rateByInvoiceId.get(line.invoiceId) ?? 1;
    const lineAmount = Number(line.quantity) * Number(line.unitPrice) * fxRate;
    const rate = line.vatRate == null ? UAE_VAT_RATE : Number(line.vatRate);
    switch (classifyVatLineForReturn({ rate: line.vatRate, supplyType: line.vatSupplyType })) {
      case "standard":
        totals.standardRatedAmount += lineAmount;
        totals.standardRatedVat += lineAmount * rate;
        break;
      case "zero_rated":
        totals.zeroRatedAmount += lineAmount;
        break;
      case "exempt":
        totals.exemptAmount += lineAmount;
        break;
      case "excluded":
        break;
    }
  }
  return totals;
}
