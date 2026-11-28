/**
 * Business-date helpers for tests. The server (posting kernel, period lock, fx.getRate, A/R
 * ageing) works on the Dubai calendar day (UTC+4), so a test that builds "today" or "N days ago"
 * from `toISOString().slice(0, 10)` (the UTC day) is a day behind between 20:00 and 24:00 UTC.
 * These delegate to `uaeToday` in shared/uae-date.ts so the definition cannot drift.
 */
import { uaeToday } from "../../shared/uae-date";

/** The Dubai calendar day of an instant, as YYYY-MM-DD. */
export const dubaiIso = (d: Date = new Date()): string => uaeToday(d);

/** Today in Dubai. */
export const dubaiToday = (): string => uaeToday(new Date());

/** The Dubai calendar day `n` days before now (negative n: in the future). */
export const dubaiDaysAgo = (n: number): string => uaeToday(new Date(Date.now() - n * 86_400_000));

/** The Dubai calendar day `n` days after now. */
export const dubaiInDays = (n: number): string => dubaiDaysAgo(-n);
