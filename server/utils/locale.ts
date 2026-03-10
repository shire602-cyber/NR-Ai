/**
 * Shared Locale & Formatting Utilities
 * ─────────────────────────────────────
 * Single source of truth for locale mapping, phone formatting,
 * and date formatting across all scheduler jobs and services.
 */

/** Supported message languages */
export type MessageLanguage = 'en' | 'ar' | 'so';

/** All supported locale values that map to message languages */
const LOCALE_MAP: Record<string, MessageLanguage> = {
  en: 'en',
  english: 'en',
  ar: 'ar',
  arabic: 'ar',
  'ar-ae': 'ar',
  'ar-sa': 'ar',
  so: 'so',
  som: 'so',
  somali: 'so',
  'so-so': 'so',
};

/**
 * Map a company locale to a supported message language.
 * Falls back to English for unknown locales.
 */
export function mapLocaleToLanguage(locale: string | null | undefined): MessageLanguage {
  if (!locale) return 'en';
  return LOCALE_MAP[locale.toLowerCase().trim()] ?? 'en';
}

/**
 * Clean and normalize a phone number for WhatsApp.
 * Strips spaces, dashes, parentheses, and leading '+'.
 * Returns null if the result is not a valid phone number.
 */
export function cleanPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
  // Must be at least 7 digits and all numeric
  if (cleaned.length < 7 || !/^\d+$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Format a date for display in messages.
 * Returns a human-readable date string like "March 15, 2026".
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return 'N/A';
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Calculate the number of days between now and a target date.
 * Returns positive for future dates, negative for past dates.
 */
export function daysUntil(date: Date | string): number {
  const target = new Date(date);
  if (isNaN(target.getTime())) return 0;
  return Math.ceil((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/**
 * Determine message priority based on days remaining.
 * Lower number = higher priority.
 */
export function priorityFromDays(daysRemaining: number): number {
  if (daysRemaining <= 2) return 1;  // Urgent
  if (daysRemaining <= 5) return 3;  // High
  if (daysRemaining <= 14) return 5; // Normal
  return 7;                          // Low
}

/**
 * Escape a string for safe use in a regex pattern.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitize user-facing text before passing to AI prompts.
 * Strips common prompt injection patterns while preserving meaningful content.
 *
 * Use this for any user/DB-sourced text that enters an AI prompt:
 * - News article content (from RSS/web scraping)
 * - Company names (user-set)
 * - Translation input text
 */
export function sanitizeForAI(text: string, maxLength = 10000): string {
  let clean = text;

  // Remove system/assistant role injection attempts
  clean = clean.replace(/\b(system|assistant|user)\s*:/gi, '$1 -');

  // Remove markdown code fences that could hide instructions
  clean = clean.replace(/```[\s\S]*?```/g, '[code block removed]');

  // Remove obvious instruction injection patterns
  clean = clean.replace(
    /\b(ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?))/gi,
    '[filtered]',
  );
  clean = clean.replace(
    /\b(forget\s+(everything|all|your)\s+(instructions?|rules?))/gi,
    '[filtered]',
  );
  clean = clean.replace(
    /\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be|your\s+new\s+role)\b/gi,
    '[filtered]',
  );

  // Truncate overly long input
  if (clean.length > maxLength) {
    clean = clean.substring(0, maxLength) + '... [truncated]';
  }

  return clean;
}

/**
 * Build a Map<companyId, Company> for O(1) lookup.
 * Fetches all companies in a single query to avoid N+1 queries in loops.
 *
 * Shared by: documentReminders, paymentReminders, and any job
 * that iterates over entities with a companyId FK.
 */
export async function buildCompanyMap(): Promise<Map<string, any>> {
  // Lazy import to avoid circular dependency with storage
  const { storage } = await import('../storage');
  const companies = await storage.getAllCompaniesWithContacts();
  const map = new Map<string, any>();
  for (const company of companies) {
    map.set(company.id, company);
  }
  return map;
}

/**
 * Resolve template placeholders like {{key}} with values.
 * Uses literal string matching (no regex injection risk).
 */
export function resolveTemplatePlaceholders(
  template: string,
  placeholders: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(placeholders)) {
    // Use split/join for safe literal replacement (no regex)
    result = result.split(`{{${key}}}`).join(value);
  }
  return result;
}
