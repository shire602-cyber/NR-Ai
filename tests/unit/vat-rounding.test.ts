import { describe, it, expect } from "vitest";
import { aggregateReturnSalesLines, allocateReturnSalesLines } from "../../server/services/vat-sales-lines";
import { calculateDocumentTotals } from "../../server/services/document-totals.service";
import { toBaseCurrencyAmount } from "../../server/services/invoice-fx";

// Phase 8 D4: one rounding rule for the VAT return, the ledger and the VAT Audit report. A document is rounded once, in its
// own currency, and posts to the ledger at round(document VAT x rate); the return must add up exactly that.

const RATE = 3.6725;
const prices = [123.4567, 87.6543, 245.1111, 59.9999, 311.2222, 17.1717, 402.0505];
const invoices = prices.map((unitPrice, i) => ({ id: `u${i}`, unitPrice }));
const lines = invoices.map((inv) => ({ invoiceId: inv.id, quantity: 1, unitPrice: inv.unitPrice, vatRate: 0.05, vatSupplyType: "standard_rated" }));
const rates = new Map(invoices.map((inv) => [inv.id, RATE]));

/** What the ledger holds for the invoice: Cr 2020 = round(document VAT (rounded once) x rate). */
const ledgerVat = (unitPrice: number) => toBaseCurrencyAmount(calculateDocumentTotals([{ unitPrice, quantity: 1, vatRate: 0.05 }]).vatAmount, RATE);

describe("USD invoices: return = ledger = audit rows", () => {
  it("a single USD invoice: 123.4567 x 5% = 6.17 USD = 22.66 AED, not the 22.67 of an unrounded line", () => {
    const out = allocateReturnSalesLines([lines[0]], rates);
    expect(out[0].vatAed).toBe(22.66);
    expect(ledgerVat(123.4567)).toBe(22.66);
    // the old per-return rounding: 6.172835 x 3.6725 = 22.67
    expect(Math.round(123.4567 * 0.05 * RATE * 100) / 100).toBe(22.67);
  });

  it("box 1 VAT equals the sum of the ledger postings of the invoices", () => {
    const totals = aggregateReturnSalesLines(lines, rates);
    const ledger = Math.round(prices.reduce((s, p) => s + Math.round(ledgerVat(p) * 100), 0)) / 100;
    expect(totals.standardRatedVat).toBe(ledger);
  });

  it("the audit rows (allocated lines) add up to box 1 and every figure is exact fils", () => {
    const rows = allocateReturnSalesLines(lines, rates);
    const sumFils = rows.reduce((s, r) => s + Math.round(r.vatAed * 100), 0);
    expect(sumFils / 100).toBe(aggregateReturnSalesLines(lines, rates).standardRatedVat);
    for (const r of rows) {
      expect(Math.round(r.vatAed * 100) / 100).toBe(r.vatAed);
      expect(Math.round(r.amountAed * 100) / 100).toBe(r.amountAed);
    }
  });

  it("a document with several lines is rounded once and spread over its lines", () => {
    const multi = [
      { invoiceId: "m", quantity: 1, unitPrice: 33.3333, vatRate: 0.05, vatSupplyType: "standard_rated" },
      { invoiceId: "m", quantity: 1, unitPrice: 33.3333, vatRate: 0.05, vatSupplyType: "standard_rated" },
      { invoiceId: "m", quantity: 1, unitPrice: 33.3334, vatRate: 0.05, vatSupplyType: "standard_rated" },
    ];
    const rows = allocateReturnSalesLines(multi, new Map([["m", RATE]]));
    const total = rows.reduce((s, r) => s + Math.round(r.vatAed * 100), 0) / 100;
    const doc = calculateDocumentTotals(multi.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity, vatRate: l.vatRate })));
    expect(total).toBe(toBaseCurrencyAmount(doc.vatAmount, RATE));
    expect(doc.vatAmount).toBe(5);
  });

  it("zero-rated and exempt lines carry amounts and no VAT; categories of one invoice are allocated apart", () => {
    const mixed = [
      { invoiceId: "x", quantity: 1, unitPrice: 100.005, vatRate: 0.05, vatSupplyType: "standard_rated" },
      { invoiceId: "x", quantity: 1, unitPrice: 50.005, vatRate: 0, vatSupplyType: "zero_rated" },
      { invoiceId: "x", quantity: 1, unitPrice: 20.005, vatRate: 0, vatSupplyType: "exempt" },
    ];
    const rows = allocateReturnSalesLines(mixed, new Map([["x", RATE]]));
    expect(rows.map((r) => r.category)).toEqual(["standard", "zero_rated", "exempt"]);
    expect(rows[1].vatAed).toBe(0);
    expect(rows[2].vatAed).toBe(0);
  });

  it("an AED invoice (rate 1) and a credit note (negative lines) round the same way", () => {
    const aed = [{ invoiceId: "a", quantity: 3, unitPrice: 33.333333, vatRate: 0.05, vatSupplyType: "standard_rated" }];
    expect(aggregateReturnSalesLines(aed, new Map([["a", 1]])).standardRatedVat).toBe(5);
    const cn = [{ invoiceId: "c", quantity: -1, unitPrice: 123.4567, vatRate: 0.05, vatSupplyType: "standard_rated" }];
    expect(aggregateReturnSalesLines(cn, new Map([["c", RATE]])).standardRatedVat).toBe(-22.66);
  });
});
