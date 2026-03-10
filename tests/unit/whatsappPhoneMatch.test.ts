import { describe, it, expect } from 'vitest';
import { normalizePhoneForMatch } from '../../server/services/whatsappWeb';

describe('WhatsApp Phone Matching', () => {
  describe('normalizePhoneForMatch', () => {
    it('should strip non-digit characters', () => {
      expect(normalizePhoneForMatch('+971 50 123 4567')).toBe('971501234567');
    });

    it('should strip dashes and parentheses', () => {
      expect(normalizePhoneForMatch('(971) 50-123-4567')).toBe('971501234567');
    });

    it('should handle already-clean numbers', () => {
      expect(normalizePhoneForMatch('971501234567')).toBe('971501234567');
    });

    it('should return empty string for non-digit input', () => {
      expect(normalizePhoneForMatch('abc')).toBe('');
    });

    it('should return empty string for empty input', () => {
      expect(normalizePhoneForMatch('')).toBe('');
    });
  });
});
