import { describe, it, expect } from 'vitest';
import {
  TRN_REGEX,
  trnSchema,
  optionalTrnSchema,
  phoneSchema,
  moneySchema,
  positiveMoneySchema,
  vatRateSchema,
  quantitySchema,
  isoDateSchema,
  isUnsafePath,
} from '../../shared/validators';

describe('TRN validation', () => {
  it('matches a 15-digit numeric string', () => {
    expect(TRN_REGEX.test('123456789012345')).toBe(true);
  });

  it('rejects fewer or more than 15 digits', () => {
    expect(TRN_REGEX.test('12345678901234')).toBe(false);
    expect(TRN_REGEX.test('1234567890123456')).toBe(false);
  });

  it('rejects strings with non-digit characters', () => {
    expect(TRN_REGEX.test('1234567890ABCDE')).toBe(false);
    expect(TRN_REGEX.test('123-456-789-012345')).toBe(false);
  });

  it('trnSchema parses valid TRN', () => {
    expect(trnSchema.parse('  123456789012345  ')).toBe('123456789012345');
  });

  it('trnSchema rejects invalid TRN', () => {
    expect(() => trnSchema.parse('not-a-trn')).toThrow();
    expect(() => trnSchema.parse('')).toThrow();
  });

  it('optionalTrnSchema treats empty string as undefined', () => {
    expect(optionalTrnSchema.parse('')).toBeUndefined();
    expect(optionalTrnSchema.parse(undefined)).toBeUndefined();
    expect(optionalTrnSchema.parse('123456789012345')).toBe('123456789012345');
  });

  it('optionalTrnSchema rejects malformed non-empty input', () => {
    expect(() => optionalTrnSchema.parse('123')).toThrow();
    expect(() => optionalTrnSchema.parse('abc456789012345')).toThrow();
  });
});

describe('phone validation', () => {
  it('accepts UAE-style numbers', () => {
    expect(phoneSchema.parse('+971501234567')).toBe('+971501234567');
    expect(phoneSchema.parse('971501234567')).toBe('971501234567');
  });

  it('accepts foreign numbers in E.164', () => {
    expect(phoneSchema.parse('+14155552671')).toBe('+14155552671');
  });

  it('rejects letters and short strings', () => {
    expect(() => phoneSchema.parse('not-a-phone')).toThrow();
    expect(() => phoneSchema.parse('123')).toThrow();
  });
});

describe('money validation', () => {
  it('moneySchema accepts non-negative finite numbers', () => {
    expect(moneySchema.parse(0)).toBe(0);
    expect(moneySchema.parse(123.45)).toBe(123.45);
  });

  it('moneySchema rejects negatives, NaN and Infinity', () => {
    expect(() => moneySchema.parse(-1)).toThrow();
    expect(() => moneySchema.parse(Number.NaN)).toThrow();
    expect(() => moneySchema.parse(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('positiveMoneySchema requires > 0', () => {
    expect(() => positiveMoneySchema.parse(0)).toThrow();
    expect(positiveMoneySchema.parse(0.01)).toBe(0.01);
  });
});

describe('vatRate and quantity', () => {
  it('vatRateSchema bounds [0,1]', () => {
    expect(vatRateSchema.parse(0)).toBe(0);
    expect(vatRateSchema.parse(0.05)).toBe(0.05);
    expect(() => vatRateSchema.parse(-0.01)).toThrow();
    expect(() => vatRateSchema.parse(1.5)).toThrow();
  });

  it('quantitySchema requires positive', () => {
    expect(() => quantitySchema.parse(0)).toThrow();
    expect(() => quantitySchema.parse(-1)).toThrow();
    expect(quantitySchema.parse(2)).toBe(2);
  });
});

describe('isoDateSchema', () => {
  it('accepts ISO strings and Date objects', () => {
    const d = isoDateSchema().parse('2024-05-01T00:00:00Z');
    expect(d).toBeInstanceOf(Date);
  });

  it('rejects invalid date strings', () => {
    expect(() => isoDateSchema().parse('not-a-date')).toThrow();
  });

  it('rejects future dates when noFuture is set', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(() => isoDateSchema({ noFuture: true }).parse(future)).toThrow();
  });

  it('accepts past dates when noFuture is set', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isoDateSchema({ noFuture: true }).parse(past)).toBeInstanceOf(Date);
  });
});

describe('isUnsafePath', () => {
  it('rejects parent traversal', () => {
    expect(isUnsafePath('../etc/passwd')).toBe(true);
    expect(isUnsafePath('foo/../bar')).toBe(true);
    expect(isUnsafePath('foo\\..\\bar')).toBe(true);
  });

  it('rejects absolute paths and NUL', () => {
    expect(isUnsafePath('/etc/passwd')).toBe(true);
    expect(isUnsafePath('\\windows\\foo')).toBe(true);
    expect(isUnsafePath('foo\0bar')).toBe(true);
  });

  it('accepts safe relative paths', () => {
    expect(isUnsafePath('receipts/abc.jpg')).toBe(false);
    expect(isUnsafePath('document.pdf')).toBe(false);
  });
});
