import { parseISO } from 'date-fns';

/**
 * Safe date-parsing helpers. API payloads and form data regularly contain
 * null, empty strings, Date objects already, or malformed strings. Using
 * `new Date(x)` or `parseISO(x)` directly can throw or silently produce an
 * Invalid Date that crashes subsequent `.toISOString()` / `differenceInDays`
 * calls. Every page that renders a date should go through these.
 */

export function toDate(input: unknown): Date | null {
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === 'number' && Number.isFinite(input)) {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof input === 'string' && input.length > 0) {
    // Try ISO 8601 first (most API responses); fall back to Date ctor for
    // looser formats ("2026-04-19", "Apr 19 2026", etc).
    try {
      const iso = parseISO(input);
      if (!isNaN(iso.getTime())) return iso;
    } catch {
      // parseISO can throw on some inputs; fall through to Date ctor.
    }
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatDateSafe(
  input: unknown,
  formatter: (d: Date) => string,
  fallback = '—'
): string {
  const d = toDate(input);
  if (!d) return fallback;
  try {
    return formatter(d);
  } catch {
    return fallback;
  }
}

export function isBefore(a: unknown, b: unknown): boolean | null {
  const ad = toDate(a);
  const bd = toDate(b);
  if (!ad || !bd) return null;
  return ad.getTime() < bd.getTime();
}

export function daysBetween(a: unknown, b: unknown): number | null {
  const ad = toDate(a);
  const bd = toDate(b);
  if (!ad || !bd) return null;
  return Math.floor((ad.getTime() - bd.getTime()) / (1000 * 60 * 60 * 24));
}
