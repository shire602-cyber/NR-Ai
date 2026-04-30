import { describe, it, expect } from 'vitest';
import { companyPreferencesSchema } from '../../shared/schema';

describe('companyPreferencesSchema', () => {
  it('accepts a complete valid payload', () => {
    const result = companyPreferencesSchema.safeParse({
      name: 'Acme Trading',
      legalName: 'Acme Trading L.L.C',
      trnVatNumber: '100123456789012',
      baseCurrency: 'AED',
      fiscalYearStartMonth: 1,
      defaultVatRate: 0.05,
      addressStreet: 'Sheikh Zayed Rd',
      addressCity: 'Dubai',
      emirate: 'dubai',
      addressCountry: 'AE',
      contactPhone: '+971 4 123 4567',
      contactEmail: 'hello@acme.ae',
      industry: 'Retail',
      logoUrl: 'data:image/png;base64,iVBOR…',
      dateFormat: 'DD/MM/YYYY',
      locale: 'en',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a partial payload (every field optional)', () => {
    const result = companyPreferencesSchema.safeParse({ name: 'Acme' });
    expect(result.success).toBe(true);
  });

  it('rejects company name shorter than 2 characters', () => {
    const result = companyPreferencesSchema.safeParse({ name: 'A' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = result.error.flatten().fieldErrors;
      expect(flat.name?.[0]).toMatch(/at least 2/);
    }
  });

  it('rejects TRN that is not exactly 15 digits', () => {
    const tooShort = companyPreferencesSchema.safeParse({ trnVatNumber: '12345' });
    expect(tooShort.success).toBe(false);

    const nonNumeric = companyPreferencesSchema.safeParse({ trnVatNumber: 'ABCDEFGHIJKLMNO' });
    expect(nonNumeric.success).toBe(false);

    const tooLong = companyPreferencesSchema.safeParse({ trnVatNumber: '1234567890123456' });
    expect(tooLong.success).toBe(false);
  });

  it('coerces empty TRN string to null', () => {
    const result = companyPreferencesSchema.safeParse({ trnVatNumber: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trnVatNumber).toBeNull();
    }
  });

  it('rejects unsupported currency', () => {
    const result = companyPreferencesSchema.safeParse({ baseCurrency: 'XYZ' });
    expect(result.success).toBe(false);
  });

  it('rejects fiscalYearStartMonth outside 1..12', () => {
    expect(companyPreferencesSchema.safeParse({ fiscalYearStartMonth: 0 }).success).toBe(false);
    expect(companyPreferencesSchema.safeParse({ fiscalYearStartMonth: 13 }).success).toBe(false);
    expect(companyPreferencesSchema.safeParse({ fiscalYearStartMonth: 1.5 }).success).toBe(false);
  });

  it('rejects defaultVatRate outside 0..1', () => {
    expect(companyPreferencesSchema.safeParse({ defaultVatRate: -0.01 }).success).toBe(false);
    expect(companyPreferencesSchema.safeParse({ defaultVatRate: 1.5 }).success).toBe(false);
    expect(companyPreferencesSchema.safeParse({ defaultVatRate: 0 }).success).toBe(true);
    expect(companyPreferencesSchema.safeParse({ defaultVatRate: 1 }).success).toBe(true);
  });

  it('rejects malformed contactEmail but accepts empty string', () => {
    expect(companyPreferencesSchema.safeParse({ contactEmail: 'not-an-email' }).success).toBe(false);

    const empty = companyPreferencesSchema.safeParse({ contactEmail: '' });
    expect(empty.success).toBe(true);
    if (empty.success) {
      expect(empty.data.contactEmail).toBeNull();
    }
  });

  it('rejects unknown emirate', () => {
    expect(
      companyPreferencesSchema.safeParse({ emirate: 'tatooine' }).success,
    ).toBe(false);
  });

  it('rejects unknown date format', () => {
    expect(
      companyPreferencesSchema.safeParse({ dateFormat: 'DD-MMM-YY' }).success,
    ).toBe(false);
  });
});
