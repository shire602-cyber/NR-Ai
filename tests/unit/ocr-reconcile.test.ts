import { describe, it, expect } from 'vitest';
import { reconcileReceiptAmounts } from '../../server/routes/ocr.routes';

describe('reconcileReceiptAmounts', () => {
  it('preserves zero-rated receipts where total === subtotal and no VAT line is present', () => {
    // Bug regression: previously synthesized 5% VAT (0.50) when the OCR
    // returned subtotal=10, total=10, vatAmount=0, producing the impossible
    // state subtotal=10, vat=0.50, total=10 (10 + 0.50 != 10).
    const r = reconcileReceiptAmounts({ subtotal: 10, vatAmount: 0, vatPercentage: 5, total: 10 });
    expect(r.subtotal).toBe(10);
    expect(r.vatAmount).toBe(0);
    expect(r.total).toBe(10);
    expect(r.subtotal + r.vatAmount).toBeCloseTo(r.total, 2);
  });

  it('derives missing VAT as the gap when both subtotal and total are explicit', () => {
    const r = reconcileReceiptAmounts({ subtotal: 100, vatAmount: 0, vatPercentage: 5, total: 105 });
    expect(r.subtotal).toBe(100);
    expect(r.vatAmount).toBe(5);
    expect(r.total).toBe(105);
  });

  it('trusts an explicit non-zero vatAmount even when total/subtotal disagree slightly', () => {
    // Receipt printed with rounded VAT line — keep what the receipt says.
    const r = reconcileReceiptAmounts({ subtotal: 100, vatAmount: 5, vatPercentage: 5, total: 105 });
    expect(r.subtotal).toBe(100);
    expect(r.vatAmount).toBe(5);
    expect(r.total).toBe(105);
  });

  it('synthesizes VAT and total when only subtotal is known', () => {
    const r = reconcileReceiptAmounts({ subtotal: 100, vatPercentage: 5, total: 0 });
    expect(r.subtotal).toBe(100);
    expect(r.vatAmount).toBe(5);
    expect(r.total).toBe(105);
  });

  it('backs out subtotal from total at the configured rate when only total is known', () => {
    const r = reconcileReceiptAmounts({ subtotal: 0, vatPercentage: 5, total: 105 });
    expect(r.subtotal).toBe(100);
    expect(r.vatAmount).toBe(5);
    expect(r.total).toBe(105);
  });

  it('uses an explicit vatAmount to back out subtotal when only total + VAT are known', () => {
    const r = reconcileReceiptAmounts({ subtotal: 0, vatAmount: 7, vatPercentage: 5, total: 107 });
    expect(r.subtotal).toBe(100);
    expect(r.vatAmount).toBe(7);
    expect(r.total).toBe(107);
  });

  it('treats explicit vatPercentage=0 as zero-rated when only total is provided', () => {
    const r = reconcileReceiptAmounts({ subtotal: 0, vatAmount: 0, vatPercentage: 0, total: 50 });
    expect(r.subtotal).toBe(50);
    expect(r.vatAmount).toBe(0);
    expect(r.total).toBe(50);
  });

  it('returns all zeros when nothing is extractable', () => {
    const r = reconcileReceiptAmounts({});
    expect(r.subtotal).toBe(0);
    expect(r.vatAmount).toBe(0);
    expect(r.total).toBe(0);
  });

  it('rounds to 2 decimals on derived values for AED', () => {
    // 100 / 1.05 = 95.2380952... → 95.24, then VAT = 100 - 95.24 = 4.76
    const r = reconcileReceiptAmounts({ subtotal: 0, vatPercentage: 5, total: 100 });
    expect(r.subtotal).toBe(95.24);
    expect(r.vatAmount).toBe(4.76);
    expect(r.total).toBe(100);
    // Internal consistency must hold within 1 fils.
    expect(Math.abs(r.subtotal + r.vatAmount - r.total)).toBeLessThanOrEqual(0.01);
  });

  it('clamps negative VAT to zero if total < subtotal (data inconsistency)', () => {
    const r = reconcileReceiptAmounts({ subtotal: 100, vatPercentage: 5, total: 90 });
    expect(r.vatAmount).toBe(0);
  });

  it('parses string inputs with thousands separators', () => {
    const r = reconcileReceiptAmounts({ subtotal: '1,000', vatAmount: '50', vatPercentage: 5, total: '1,050' });
    expect(r.subtotal).toBe(1000);
    expect(r.vatAmount).toBe(50);
    expect(r.total).toBe(1050);
  });

  it('treats null vatPercentage as default 5%', () => {
    const r = reconcileReceiptAmounts({ subtotal: 100, vatPercentage: null, total: 0 });
    expect(r.vatPercentage).toBe(5);
    expect(r.vatAmount).toBe(5);
    expect(r.total).toBe(105);
  });
});
