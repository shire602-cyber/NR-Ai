import { useState, type Dispatch, type SetStateAction } from "react";
import { invoiceTotals, moneyPlain, parseQty, parseUnitFils, type InvoiceTotals } from "./model";
import { INVOICE_LINES, type SampleLine } from "./sample";

export interface DocLine {
  line: SampleLine;
  qty: number;
  unitFils: number;
  amountFils: number;
}

/**
 * The sample invoice, owned by `ProductTour` so it survives tab switches: what the visitor types in
 * "Create an invoice" is what the VAT 201 tab adds up.
 */
export interface TourInvoice {
  qty: string[];
  price: string[];
  setQty: Dispatch<SetStateAction<string[]>>;
  setPrice: Dispatch<SetStateAction<string[]>>;
  lines: DocLine[];
  totals: InvoiceTotals;
}

export function useTourInvoice(): TourInvoice {
  const [qty, setQty] = useState(() => INVOICE_LINES.map((l) => String(l.qty)));
  const [price, setPrice] = useState(() => INVOICE_LINES.map((l) => moneyPlain(l.unitFils)));
  const lines: DocLine[] = INVOICE_LINES.map((line, i) => {
    const q = parseQty(qty[i] ?? "");
    const unitFils = parseUnitFils(price[i] ?? "");
    return { line, qty: q, unitFils, amountFils: q * unitFils };
  });
  return { qty, price, setQty, setPrice, lines, totals: invoiceTotals(lines) };
}
