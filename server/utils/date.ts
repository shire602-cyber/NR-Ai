// UAE is UTC+4 with no DST. A bare 'YYYY-MM-DD' parsed with `new Date()` is
// interpreted as UTC midnight, which sits 4 hours inside the previous UAE day.
// This helper produces the correct UTC instant for the start/end of a UAE
// calendar day, so report period filters bucket transactions by the UAE day
// the user actually transacted in.

const UAE_OFFSET_MS = 4 * 60 * 60 * 1000;

/**
 * Returns the UTC instant corresponding to 00:00:00 in UAE time on the given
 * 'YYYY-MM-DD' date. Accepts a Date or string; if a Date is given its UTC
 * Y/M/D components are taken as the UAE calendar date.
 */
export function uaeDayStart(date: string | Date): Date {
  const ymd = toYmd(date);
  return new Date(Date.parse(ymd + 'T00:00:00Z') - UAE_OFFSET_MS);
}

/**
 * Returns the UTC instant corresponding to 23:59:59.999 in UAE time on the
 * given 'YYYY-MM-DD' date.
 */
export function uaeDayEnd(date: string | Date): Date {
  const ymd = toYmd(date);
  return new Date(Date.parse(ymd + 'T00:00:00Z') + 24 * 60 * 60 * 1000 - 1 - UAE_OFFSET_MS);
}

function toYmd(date: string | Date): string {
  if (typeof date === 'string') {
    // Allow full ISO strings — keep only the date portion.
    return date.length >= 10 ? date.slice(0, 10) : date;
  }
  // Use UTC components so parsing 'YYYY-MM-DD' (which becomes UTC midnight)
  // round-trips back to the same date.
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
