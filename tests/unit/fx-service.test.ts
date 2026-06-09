import { describe, it, expect } from 'vitest';
import {
  positiveExchangeRate,
  toBaseCurrencyAmount,
  withForeignAmount,
} from '../../server/services/fx.service';
import { assertBalancedJournalLines } from '../../server/services/journal-balance.service';

describe('positiveExchangeRate', () => {
  it('accepts a positive numeric rate', () => {
    expect(positiveExchangeRate(3.6725)).toBeCloseTo(3.6725, 4);
  });

  it('defaults to 1 when input is undefined/null/missing', () => {
    expect(positiveExchangeRate(undefined)).toBe(1);
    expect(positiveExchangeRate(null)).toBe(1);
  });

  it('rejects zero, negative, NaN, and non-numeric', () => {
    expect(() => positiveExchangeRate(0)).toThrow(/positive/i);
    expect(() => positiveExchangeRate(-2)).toThrow(/positive/i);
    expect(() => positiveExchangeRate(NaN)).toThrow(/positive/i);
    expect(() => positiveExchangeRate('not-a-number')).toThrow(/positive/i);
  });
});

describe('toBaseCurrencyAmount', () => {
  it('is a no-op for AED', () => {
    expect(toBaseCurrencyAmount(1234.5678, 'AED', 1)).toBe(1234.57);
  });

  it('multiplies non-AED by rate and rounds to 2dp', () => {
    expect(toBaseCurrencyAmount(100, 'EUR', 3.95)).toBe(395);
    expect(toBaseCurrencyAmount(100.005, 'USD', 3.6725)).toBeCloseTo(367.27, 2);
  });

  it('treats missing currency as AED', () => {
    expect(toBaseCurrencyAmount(50, '', 5)).toBe(50);
  });
});

describe('withForeignAmount', () => {
  it('returns zeroed FX fields when currency is AED', () => {
    expect(withForeignAmount('AED', 1, 100, 0)).toEqual({
      foreignDebit: 0,
      foreignCredit: 0,
      exchangeRate: 1,
    });
  });

  it('preserves foreign amounts and rate for non-AED', () => {
    expect(withForeignAmount('EUR', 3.95, 100, 0)).toEqual({
      foreignCurrency: 'EUR',
      foreignDebit: 100,
      foreignCredit: 0,
      exchangeRate: 3.95,
    });
  });
});

describe('assertBalancedJournalLines', () => {
  it('accepts a balanced entry within 1-cent tolerance', () => {
    expect(() => assertBalancedJournalLines([
      { debit: 100.00, credit: 0 },
      { debit: 0, credit: 100.005 },
    ])).not.toThrow();
  });

  it('rejects a clearly unbalanced entry', () => {
    expect(() => assertBalancedJournalLines([
      { debit: 100, credit: 0 },
      { debit: 0, credit: 90 },
    ])).toThrow(/unbalanced/i);
  });

  it('handles FX-rounded multi-line entries (sum-of-rounded-credits = debit)', () => {
    // Mirrors the invoice posting shape: AR debit = revenue + VAT credits.
    expect(() => assertBalancedJournalLines([
      { debit: 525.00, credit: 0 },     // AR
      { debit: 0, credit: 500.00 },     // Revenue
      { debit: 0, credit: 25.00 },      // VAT
    ])).not.toThrow();
  });

  it('treats missing fields as 0', () => {
    expect(() => assertBalancedJournalLines([
      { debit: 100, credit: 0 } as any,
      { credit: 100 } as any,
    ])).not.toThrow();
  });
});
