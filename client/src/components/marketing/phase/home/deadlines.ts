/**
 * UAE e-invoicing deadlines (pure logic, no React). All calendar maths use the Asia/Dubai calendar
 * day (UTC+4, no daylight saving), so a visitor in any timezone sees the same countdown.
 * Facts: Ministerial Decision 244 of 2025, as amended; see docs/site-rebuild/COMPETITOR-AUDIT.md.
 */

export type DeadlineSegment = "large" | "small" | "government";
export type MilestoneKey = "appoint" | "live";

export const DEADLINE_SEGMENTS: readonly DeadlineSegment[] = ["large", "small", "government"];
export const DEFAULT_SEGMENT: DeadlineSegment = "small";

export interface DeadlineConfig {
  /** Last day to appoint an accredited service provider (YYYY-MM-DD, Dubai calendar). */
  appoint: string;
  /** Day e-invoicing becomes mandatory (YYYY-MM-DD, Dubai calendar). */
  live: string;
}

export const DEADLINES: Record<DeadlineSegment, DeadlineConfig> = {
  // Annual revenue AED 50m or more.
  large: { appoint: "2026-10-30", live: "2027-01-01" },
  // Annual revenue under AED 50m.
  small: { appoint: "2027-03-31", live: "2027-07-01" },
  government: { appoint: "2027-03-31", live: "2027-10-01" },
};

/**
 * Administrative penalty (UAE Ministry of Finance, 30 Oct 2026): AED 5,000 for the initial
 * violation, then AED 5,000 for each month or part thereof that non-compliance continues, capped
 * at AED 50,000 in any 12 consecutive months.
 */
export const PENALTY_AED_PER_MONTH = 5000;
export const PENALTY_AED_CAP = 50000;

/** Locale placeholders for every penalty sentence (`{amount}`, `{penalty}`, `{cap}`). */
export const PENALTY_TEXT_VARS = {
  amount: PENALTY_AED_PER_MONTH.toLocaleString("en-US"),
  penalty: PENALTY_AED_PER_MONTH.toLocaleString("en-US"),
  cap: PENALTY_AED_CAP.toLocaleString("en-US"),
} as const;

/** Official sources, shown as footnote links. The decision name itself lives in a locale string. */
export const DEADLINE_SOURCES = {
  fta: "https://tax.gov.ae/en/taxes/Vat/uae.einvoicing.aspx",
  mof: "https://mof.gov.ae/en/about-us/initiatives/einvoicing/",
  scope: {
    en: "https://mof.gov.ae/en/news/ministry-of-finance-amends-electronic-invoicing-regulations-to-ease-the-burden-on-businesses/",
    ar: "https://mof.gov.ae/ar/news/ministry-of-finance-amends-electronic-invoicing-regulations-to-ease-the-burden-on-businesses/",
  },
  penalty:
    "https://mof.gov.ae/en/news/mof-announces-updated-administrative-penalties-related-to-the-uae-einvoicing-system-to-enhance-clarity-and-support-business-compliance/",
} as const;

const DAY_MS = 86_400_000;
const DUBAI_OFFSET_MS = 4 * 3_600_000;

export interface CalendarDate {
  y: number;
  m: number;
  d: number;
}

/** The calendar date in Asia/Dubai at `now`. */
export function dubaiToday(now: Date): CalendarDate {
  const shifted = new Date(now.getTime() + DUBAI_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/** Parse `YYYY-MM-DD`. */
export function parseISODate(iso: string): CalendarDate {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

/** Whole days since the epoch for a calendar date (timezone independent). */
export function dayNumber({ y, m, d }: CalendarDate): number {
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Whole Dubai calendar days from today to `dateISO`: 0 on the day, negative afterwards. */
export function daysUntil(dateISO: string, now: Date): number {
  return dayNumber(parseISODate(dateISO)) - dayNumber(dubaiToday(now));
}

export interface MilestoneState {
  key: MilestoneKey;
  date: string;
  daysLeft: number;
  /** True only once the Dubai calendar day of the deadline has ended. */
  passed: boolean;
}

export interface DeadlineState {
  appoint: MilestoneState;
  live: MilestoneState;
  /** The first milestone that has not passed, or null when both have. */
  next: MilestoneState | null;
}

function milestone(key: MilestoneKey, date: string, now: Date): MilestoneState {
  const daysLeft = daysUntil(date, now);
  return { key, date, daysLeft, passed: daysLeft < 0 };
}

export function deadlineState(segment: DeadlineSegment, now: Date): DeadlineState {
  const config = DEADLINES[segment];
  const appoint = milestone("appoint", config.appoint, now);
  const live = milestone("live", config.live, now);
  return { appoint, live, next: !appoint.passed ? appoint : !live.passed ? live : null };
}

/**
 * Timeline geometry as percentages (0-100) along the track. The track runs from a little before
 * the earlier of today and the first deadline to a little after go-live, so both milestones and
 * the "today" marker always sit inside it.
 */
export function timelineLayout(segment: DeadlineSegment, now: Date) {
  const config = DEADLINES[segment];
  const appoint = dayNumber(parseISODate(config.appoint));
  const live = dayNumber(parseISODate(config.live));
  const today = dayNumber(dubaiToday(now));
  const start = Math.min(today, appoint) - 45;
  const end = Math.max(today, live) + 45;
  const pct = (day: number) => Math.round(((day - start) / (end - start)) * 1000) / 10;
  return { appoint: pct(appoint), live: pct(live), today: pct(today) };
}

/** `31 March 2027` / `31 مارس 2027`, always with Western digits. */
export function formatDeadlineDate(dateISO: string, locale: "en" | "ar"): string {
  const { y, m, d } = parseISODate(dateISO);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    numberingSystem: "latn",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
