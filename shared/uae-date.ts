/**
 * Today's UAE calendar date (Asia/Dubai, UTC+4, no DST) as YYYY-MM-DD, the date the server's
 * posting kernel and period lock use (`uaeToday` in server/reporting/dates.ts). A default
 * posting date taken from the browser's UTC date is a day early between 00:00 and 04:00 UAE.
 * Client-safe (no imports).
 */
export function uaeToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
}
