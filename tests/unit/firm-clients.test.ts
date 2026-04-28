import { describe, it, expect } from 'vitest';
import {
  mapImportRow,
  validateImportedClient,
  normaliseEmirate,
  normaliseVatFiling,
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
        registrationNumber: '',
        websiteUrl: '',
      });
      expect(result.ok).toBe(true);
    });
  });
});
