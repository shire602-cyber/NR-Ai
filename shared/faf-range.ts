/** FTA Audit File range cap, shared by the server (buildFaf) and the Reports date inputs. */
export const FAF_MAX_DAYS = 366;

const DAY_MS = 86_400_000;

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

/** Inclusive number of days from `from` to `to` (YYYY-MM-DD). */
export function fafSpanDays(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from) + 1;
}

/** `iso` shifted by `days` (YYYY-MM-DD, UTC). */
export function fafShiftDay(iso: string, days: number): string {
  return new Date((dayNumber(iso) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** Error code for a FAF range the server would reject, or null when it is acceptable. */
export function fafRangeError(
  from: string,
  to: string
): "INVALID_RANGE" | "FAF_RANGE_TOO_LONG" | null {
  if (from > to) return "INVALID_RANGE";
  return fafSpanDays(from, to) > FAF_MAX_DAYS ? "FAF_RANGE_TOO_LONG" : null;
}
