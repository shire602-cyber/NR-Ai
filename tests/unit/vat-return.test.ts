import { describe, it, expect } from 'vitest';
import {
  aggregateVatReturnTotals,
  type VatReturnInvoice,
  type VatReturnInvoiceLine,
  type VatReturnReceipt,
} from '../../server/services/vat-return.service';

describe('aggregateVatReturnTotals', () => {
  it('produces zero totals for empty inputs', () => {
    const totals = aggregateVatReturnTotals([], new Map(), []);
    expect(totals.standardRatedAmount).toBe(0);
    expect(totals.standardRatedVat).toBe(0);
    expect(totals.ordinaryExpenses).toBe(0);
    expect(totals.ordinaryInputVatGross).toBe(0);
    expect(totals.reverseChargeAmount).toBe(0);
    expect(totals.reverseChargeVatGross).toBe(0);
  });

  it('classifies standard / zero-rated / exempt invoice lines correctly', () => {
    const invoice: VatReturnInvoice = { id: 'inv-1', exchangeRate: 1 };
    const lines: VatReturnInvoiceLine[] = [
      { invoiceId: 'inv-1', quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: 'standard_rated' },
      { invoiceId: 'inv-1', quantity: 2, unitPrice: 50, vatRate: 0, vatSupplyType: 'zero_rated' },
      { invoiceId: 'inv-1', quantity: 1, unitPrice: 200, vatRate: 0.05, vatSupplyType: 'exempt' },
    ];

    const totals = aggregateVatReturnTotals([invoice], new Map([['inv-1', lines]]), []);

    expect(totals.standardRatedAmount).toBe(100);
    expect(totals.standardRatedVat).toBeCloseTo(5, 2);
    expect(totals.zeroRatedAmount).toBe(100);
    expect(totals.exemptAmount).toBe(200);
  });

  it('treats vatRate=0 as zero-rated even without explicit supplyType', () => {
    const invoice: VatReturnInvoice = { id: 'inv-1', exchangeRate: 1 };
    const lines: VatReturnInvoiceLine[] = [
      { invoiceId: 'inv-1', quantity: 1, unitPrice: 100, vatRate: 0, vatSupplyType: null },
    ];
    const totals = aggregateVatReturnTotals([invoice], new Map([['inv-1', lines]]), []);
    expect(totals.zeroRatedAmount).toBe(100);
    expect(totals.standardRatedAmount).toBe(0);
  });

  it('converts foreign-currency invoices to AED via exchangeRate', () => {
    // Bug regression: previously summed line.quantity * line.unitPrice without
    // applying invoice.exchangeRate, mixing AED and USD amounts in the FTA 201.
    const usdInvoice: VatReturnInvoice = { id: 'usd-1', exchangeRate: 3.6725 };
    const lines: VatReturnInvoiceLine[] = [
      { invoiceId: 'usd-1', quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: 'standard_rated' },
    ];

    const totals = aggregateVatReturnTotals([usdInvoice], new Map([['usd-1', lines]]), []);

    // 100 USD * 3.6725 = 367.25 AED, VAT = 367.25 * 0.05 = 18.3625 AED.
    expect(totals.standardRatedAmount).toBeCloseTo(367.25, 4);
    expect(totals.standardRatedVat).toBeCloseTo(18.3625, 4);
  });

  it('converts foreign-currency receipts to AED via exchangeRate', () => {
    const receipts: VatReturnReceipt[] = [
      // 100 USD subtotal + 5 USD VAT * rate 3.6725 = 367.25 AED + 18.3625 AED.
      { amount: 100, vatAmount: 5, exchangeRate: 3.6725, reverseCharge: false },
    ];

    const totals = aggregateVatReturnTotals([], new Map(), receipts);

    expect(totals.ordinaryExpenses).toBeCloseTo(367.25, 4);
    expect(totals.ordinaryInputVatGross).toBeCloseTo(18.3625, 4);
  });

  it('separates reverse-charge receipts from ordinary receipts', () => {
    const receipts: VatReturnReceipt[] = [
      { amount: 1000, vatAmount: 50, exchangeRate: 1, reverseCharge: false },
      { amount: 500, vatAmount: 25, exchangeRate: 1, reverseCharge: true },
    ];

    const totals = aggregateVatReturnTotals([], new Map(), receipts);

    expect(totals.ordinaryExpenses).toBe(1000);
    expect(totals.ordinaryInputVatGross).toBe(50);
    expect(totals.reverseChargeAmount).toBe(500);
    expect(totals.reverseChargeVatGross).toBe(25);
  });

  it('falls back to exchangeRate=1 when null/undefined', () => {
    const invoice: VatReturnInvoice = { id: 'inv-1' };
    const lines: VatReturnInvoiceLine[] = [
      { invoiceId: 'inv-1', quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: 'standard_rated' },
    ];
    const totals = aggregateVatReturnTotals([invoice], new Map([['inv-1', lines]]), []);
    expect(totals.standardRatedAmount).toBe(100);
  });

  it('uses default UAE_VAT_RATE (5%) when line.vatRate is missing', () => {
    const invoice: VatReturnInvoice = { id: 'inv-1', exchangeRate: 1 };
    const lines: VatReturnInvoiceLine[] = [
      { invoiceId: 'inv-1', quantity: 1, unitPrice: 100, vatRate: null, vatSupplyType: 'standard_rated' },
    ];
    const totals = aggregateVatReturnTotals([invoice], new Map([['inv-1', lines]]), []);
    expect(totals.standardRatedVat).toBeCloseTo(5, 2);
  });

  it('aggregates across multiple invoices with mixed currencies', () => {
    const aedInvoice: VatReturnInvoice = { id: 'aed-1', exchangeRate: 1 };
    const usdInvoice: VatReturnInvoice = { id: 'usd-1', exchangeRate: 3.6725 };
    const lines = new Map<string, VatReturnInvoiceLine[]>([
      ['aed-1', [{ invoiceId: 'aed-1', quantity: 1, unitPrice: 1000, vatRate: 0.05, vatSupplyType: 'standard_rated' }]],
      ['usd-1', [{ invoiceId: 'usd-1', quantity: 1, unitPrice: 100, vatRate: 0.05, vatSupplyType: 'standard_rated' }]],
    ]);

    const totals = aggregateVatReturnTotals([aedInvoice, usdInvoice], lines, []);

    // 1000 AED + 367.25 AED = 1367.25 AED.
    expect(totals.standardRatedAmount).toBeCloseTo(1367.25, 4);
    expect(totals.standardRatedVat).toBeCloseTo(68.3625, 4);
  });

  it('ignores invoices with no lines', () => {
    const invoice: VatReturnInvoice = { id: 'inv-1', exchangeRate: 1 };
    const totals = aggregateVatReturnTotals([invoice], new Map(), []);
    expect(totals.standardRatedAmount).toBe(0);
  });
});
