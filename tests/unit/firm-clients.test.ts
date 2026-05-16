import { describe, it, expect } from 'vitest';
import {
  mapImportRow,
  validateImportedClient,
  normaliseEmirate,
  normaliseFiscalYearStartMonth,
  normaliseVatCloseGroup,
  normaliseVatFiling,
  corporateTaxWindow,
  currentVatPeriodForCompany,
  nextCorporateTaxFilingWindow,
  vatCohortFromPeriodStart,
} from '../../server/services/firm-clients.service';

describe('firm-clients.service: import mapping', () => {
  describe('mapImportRow', () => {
    it('extracts the company name from a canonical column', () => {
      const result = mapImportRow({ name: 'Al Majid Trading LLC' });
      if ('error' in result) throw new Error('expected mapped row');
      expect(result.name).toBe('Al Majid Trading LLC');
    });

    it('falls back to common header variations', () => {
      const cases = [
        { 'Company Name': 'Acme LLC' },
        { 'company_name': 'Acme LLC' },
        { 'Client Name': 'Acme LLC' },
        { 'Business Name': 'Acme LLC' },
      ];
      for (const row of cases) {
        const result = mapImportRow(row);
        if ('error' in result) throw new Error(`mapping failed for ${JSON.stringify(row)}`);
        expect(result.name).toBe('Acme LLC');
      }
    });

    it('returns an error when the name is missing', () => {
      const result = mapImportRow({ email: 'a@b.com' });
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toMatch(/name is required/i);
      }
    });

    it('returns an error for whitespace-only names', () => {
      const result = mapImportRow({ name: '   ' });
      expect('error' in result).toBe(true);
    });

    it('trims whitespace from extracted values', () => {
      const result = mapImportRow({ name: '  Acme LLC  ', email: '  a@b.com  ' });
      if ('error' in result) throw new Error('expected mapped row');
      expect(result.name).toBe('Acme LLC');
      expect(result.contactEmail).toBe('a@b.com');
    });

    it('maps the broad column-header alias set', () => {
      const result = mapImportRow({
        'Company Name': 'Acme LLC',
        'TRN': '100200300400500',
        'Phone': '+971501234567',
        'E-mail': 'ops@acme.ae',
        'Address': 'Dubai',
        'Industry': 'Construction',
        'Website': 'https://acme.ae',
        'VAT Close Group': 'Jan / Apr / Jul / Oct',
        'Financial Year Start': 'April',
        'Corporate Tax ID': 'CT-1002345678',
      });
      if ('error' in result) throw new Error('expected mapped row');
      expect(result).toMatchObject({
        name: 'Acme LLC',
        trnVatNumber: '100200300400500',
        contactPhone: '+971501234567',
        contactEmail: 'ops@acme.ae',
        businessAddress: 'Dubai',
        industry: 'Construction',
        websiteUrl: 'https://acme.ae',
        vatPeriodStartMonth: 11,
        fiscalYearStartMonth: 4,
        corporateTaxId: 'CT-1002345678',
      });
    });
  });

  describe('normaliseEmirate', () => {
    it('passes canonical values through', () => {
      expect(normaliseEmirate('dubai')).toBe('dubai');
      expect(normaliseEmirate('abu_dhabi')).toBe('abu_dhabi');
    });

    it('converts spaces to underscores and lowercases', () => {
      expect(normaliseEmirate('Abu Dhabi')).toBe('abu_dhabi');
      expect(normaliseEmirate('  Ras Al Khaimah ')).toBe('ras_al_khaimah');
    });

    it('returns empty for unknown emirates so callers can default', () => {
      expect(normaliseEmirate('Riyadh')).toBe('');
      expect(normaliseEmirate('')).toBe('');
    });
  });

  describe('normaliseVatFiling', () => {
    it('passes canonical values through', () => {
      expect(normaliseVatFiling('monthly')).toBe('monthly');
      expect(normaliseVatFiling('quarterly')).toBe('quarterly');
    });

    it('lowercases mixed-case input', () => {
      expect(normaliseVatFiling('Quarterly')).toBe('quarterly');
    });

    it('drops unknown frequencies', () => {
      expect(normaliseVatFiling('weekly')).toBe('');
    });
  });

  describe('bulk-import tax month normalisers', () => {
    it('maps the three VAT close groups to the stored VAT period start month', () => {
      expect(normaliseVatCloseGroup('Jan / Apr / Jul / Oct')).toBe(11);
      expect(normaliseVatCloseGroup('Feb, May, Aug, Nov')).toBe(12);
      expect(normaliseVatCloseGroup('Mar Jun Sep Dec')).toBe(1);
    });

    it('maps a single close month to its VAT close group', () => {
      expect(normaliseVatCloseGroup('January')).toBe(11);
      expect(normaliseVatCloseGroup('May')).toBe(12);
      expect(normaliseVatCloseGroup('September')).toBe(1);
    });

    it('parses financial year start month names and numbers', () => {
      expect(normaliseFiscalYearStartMonth('April')).toBe(4);
      expect(normaliseFiscalYearStartMonth('Sep')).toBe(9);
      expect(normaliseFiscalYearStartMonth('12')).toBe(12);
      expect(normaliseFiscalYearStartMonth('Not a month')).toBeUndefined();
    });
  });

  describe('validateImportedClient', () => {
    it('accepts a valid mapped row', () => {
      const result = validateImportedClient({
        name: 'Acme LLC',
        trnVatNumber: '',
        industry: '',
        legalStructure: '',
        contactEmail: '',
        contactPhone: '',
        businessAddress: '',
        emirate: '',
        vatFilingFrequency: '',
        vatPeriodStartMonth: undefined,
        fiscalYearStartMonth: undefined,
        corporateTaxId: '',
        registrationNumber: '',
        websiteUrl: '',
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.name).toBe('Acme LLC');
    });

    it('rejects rows with an invalid email', () => {
      const result = validateImportedClient({
        name: 'Acme LLC',
        contactEmail: 'not-an-email',
        trnVatNumber: '',
        industry: '',
        legalStructure: '',
        contactPhone: '',
        businessAddress: '',
        emirate: '',
        vatFilingFrequency: '',
        vatPeriodStartMonth: undefined,
        fiscalYearStartMonth: undefined,
        corporateTaxId: '',
        registrationNumber: '',
        websiteUrl: '',
      });
      expect(result.ok).toBe(false);
    });

    it('treats empty strings as acceptable absence', () => {
      const result = validateImportedClient({
        name: 'Acme LLC',
        trnVatNumber: '',
        industry: '',
        legalStructure: '',
        contactEmail: '',
        contactPhone: '',
        businessAddress: '',
        emirate: '',
        vatFilingFrequency: '',
        vatPeriodStartMonth: undefined,
        fiscalYearStartMonth: undefined,
        corporateTaxId: '',
        registrationNumber: '',
        websiteUrl: '',
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('VAT cohort and filing windows', () => {
    it('maps quarterly clients into the three FTA closing cohorts', () => {
      expect(vatCohortFromPeriodStart(11, 'quarterly')).toMatchObject({
        key: 'jan_apr_jul_oct',
        label: 'Jan / Apr / Jul / Oct',
        closeMonths: [1, 4, 7, 10],
      });
      expect(vatCohortFromPeriodStart(12, 'quarterly')).toMatchObject({
        key: 'feb_may_aug_nov',
        label: 'Feb / May / Aug / Nov',
        closeMonths: [2, 5, 8, 11],
      });
      expect(vatCohortFromPeriodStart(1, 'quarterly')).toMatchObject({
        key: 'mar_jun_sep_dec',
        label: 'Mar / Jun / Sep / Dec',
        closeMonths: [3, 6, 9, 12],
      });
    });

    it('keeps monthly filers separate from the quarterly production board', () => {
      expect(vatCohortFromPeriodStart(1, 'monthly')).toMatchObject({
        key: 'monthly',
        label: 'Monthly',
        closeMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      });
    });

    it('calculates the active VAT period and 28-day due date', () => {
      const window = currentVatPeriodForCompany(new Date('2026-05-16T12:00:00Z'), 1, 'quarterly');
      expect(window.periodStart.toISOString()).toBe('2026-04-01T00:00:00.000Z');
      expect(window.periodEnd.toISOString()).toBe('2026-06-30T00:00:00.000Z');
      expect(window.dueDate.toISOString()).toBe('2026-07-28T00:00:00.000Z');
    });

    it('handles VAT periods that start in the prior calendar year', () => {
      const window = currentVatPeriodForCompany(new Date('2026-01-15T12:00:00Z'), 11, 'quarterly');
      expect(window.periodStart.toISOString()).toBe('2025-11-01T00:00:00.000Z');
      expect(window.periodEnd.toISOString()).toBe('2026-01-31T00:00:00.000Z');
      expect(window.dueDate.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    });
  });

  describe('corporate tax filing windows', () => {
    it('calculates the financial-year end and nine-month filing due date', () => {
      const window = corporateTaxWindow(new Date('2026-05-16T12:00:00Z'), 1);
      expect(window.periodStart.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(window.periodEnd.toISOString()).toBe('2026-12-31T00:00:00.000Z');
      expect(window.dueDate.toISOString()).toBe('2027-09-30T00:00:00.000Z');
    });

    it('uses the previous financial year when the start month has not arrived yet', () => {
      const window = corporateTaxWindow(new Date('2026-02-15T12:00:00Z'), 4);
      expect(window.periodStart.toISOString()).toBe('2025-04-01T00:00:00.000Z');
      expect(window.periodEnd.toISOString()).toBe('2026-03-31T00:00:00.000Z');
      expect(window.dueDate.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    });

    it('surfaces the latest completed tax period until its filing deadline passes', () => {
      const window = nextCorporateTaxFilingWindow(new Date('2026-05-16T12:00:00Z'), 1);
      expect(window.periodStart.toISOString()).toBe('2025-01-01T00:00:00.000Z');
      expect(window.periodEnd.toISOString()).toBe('2025-12-31T00:00:00.000Z');
      expect(window.dueDate.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    });
  });
});
