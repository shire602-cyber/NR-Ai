// Query parsing, Dubai presets and comparison windows for the report engine (Phase 8 D4).
// Pure: no I/O, `now` and the company's fiscal-year start month are passed in, so it is unit tested.

import {
  REPORT_FORMATS,
  type ReportComparisonMode,
  type ReportFormat,
  type ReportParamKind,
} from "../../shared/report-result";
import {
  addDays,
  addMonths,
  addMonthsKeepEnd,
  daysBetween,
  endOfMonth,
  fiscalYearStart,
  isMonthEnd,
  isYmd,
  minusOneYear,
  startOfMonth,
  startOfQuarter,
  todayYmd,
} from "./dates";

export const DEFAULT_PAGE_LIMIT = 500;
export const MAX_PAGE_LIMIT = 1000;
export const MAX_RANGE_DAYS = 366 * 5 + 1; // five years
export const MAX_COMPANIES = 25;

const BASE_KEYS = [
  "from",
  "to",
  "asOf",
  "compare",
  "compareFrom",
  "compareTo",
  "compareAsOf",
  "format",
  "lang",
  "limit",
  "offset",
] as const;

/** Every per-definition filter a report may accept; a definition lists the subset it takes. */
export const FILTER_KEYS = [
  "accountId",
  "contactId",
  "bankAccountId",
  "source",
  "userId",
  "entityType",
  "action",
  "budgetPlanId",
  "costCenterId",
  "taxYear",
  "payrollRunId",
  "companyIds",
  "statement",
  "projectId",
  "employeeId",
  "strict",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

const UUID_FILTERS = new Set<string>(["accountId", "contactId", "projectId", "employeeId", "bankAccountId", "userId", "budgetPlanId", "costCenterId", "payrollRunId"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPARE_MODES: readonly ReportComparisonMode[] = ["none", "priorPeriod", "priorYear", "budget", "custom"];

export interface ParamIssue {
  status: 400 | 404 | 409 | 422;
  code: string;
  message: string;
}

export interface ComparisonWindow {
  mode: ReportComparisonMode;
  from?: string;
  to?: string;
  asOf?: string;
}

export interface ResolvedParams {
  from?: string;
  to?: string;
  asOf?: string;
  compare: ComparisonWindow;
  filters: Partial<Record<FilterKey, string>>;
  limit: number;
  offset: number;
  format: ReportFormat;
  lang: "en" | "ar";
}

export interface ParamRules {
  kinds: readonly ReportParamKind[];
  filters: readonly FilterKey[];
  /** An as-of day after today is refused (ageing). */
  noFutureAsOf?: boolean;
  /** compare=budget is a meaningful mode for this report (Budget vs Actual carries its own budget column). */
  budgetComparison?: boolean;
}

type Result<T> = { ok: true; value: T } | { ok: false; issue: ParamIssue };
const bad = (code: string, message: string, status: ParamIssue["status"] = 400): { ok: false; issue: ParamIssue } => ({
  ok: false,
  issue: { status, code, message },
});

// ---------------------------------------------------------------------------------------------------------------
// Presets (scheduled reports store a preset, resolved on every run in Dubai time)
// ---------------------------------------------------------------------------------------------------------------

export const RANGE_PRESETS = [
  "thisMonth",
  "lastMonth",
  "thisQuarter",
  "lastQuarter",
  "thisYear",
  "lastYear",
  "last30Days",
  "last90Days",
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const AS_OF_PRESETS = ["today", "lastMonthEnd", "lastQuarterEnd", "lastYearEnd"] as const;
export type AsOfPreset = (typeof AS_OF_PRESETS)[number];

export function resolveRangePreset(
  preset: RangePreset,
  now: Date,
  fiscalStartMonth = 1
): { from: string; to: string } {
  const today = todayYmd(now);
  switch (preset) {
    case "thisMonth":
      return { from: startOfMonth(today), to: today };
    case "lastMonth": {
      const prev = addMonthsKeepEnd(startOfMonth(today), -1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case "thisQuarter":
      return { from: startOfQuarter(today), to: today };
    case "lastQuarter": {
      const start = addMonthsKeepEnd(startOfQuarter(today), -3);
      return { from: start, to: addDays(startOfQuarter(today), -1) };
    }
    case "thisYear":
      return { from: fiscalYearStart(today, fiscalStartMonth), to: today };
    case "lastYear": {
      const thisStart = fiscalYearStart(today, fiscalStartMonth);
      return { from: minusOneYear(thisStart), to: addDays(thisStart, -1) };
    }
    case "last30Days":
      return { from: addDays(today, -29), to: today };
    case "last90Days":
      return { from: addDays(today, -89), to: today };
  }
}

export function resolveAsOfPreset(preset: AsOfPreset, now: Date, fiscalStartMonth = 1): string {
  const today = todayYmd(now);
  switch (preset) {
    case "today":
      return today;
    case "lastMonthEnd":
      return addDays(startOfMonth(today), -1);
    case "lastQuarterEnd":
      return addDays(startOfQuarter(today), -1);
    case "lastYearEnd":
      return addDays(fiscalYearStart(today, fiscalStartMonth), -1);
  }
}

/** Turn a stored schedule `params` object (presets + compare + filters) into a run-query of concrete days. */
export function resolveSchedulePreset(
  stored: Record<string, unknown>,
  now: Date,
  fiscalStartMonth = 1
): Record<string, string> {
  const out: Record<string, string> = {};
  const rangePreset = stored.rangePreset;
  if (typeof rangePreset === "string" && (RANGE_PRESETS as readonly string[]).includes(rangePreset)) {
    const r = resolveRangePreset(rangePreset as RangePreset, now, fiscalStartMonth);
    out.from = r.from;
    out.to = r.to;
  }
  const asOfPreset = stored.asOfPreset;
  if (typeof asOfPreset === "string" && (AS_OF_PRESETS as readonly string[]).includes(asOfPreset)) {
    out.asOf = resolveAsOfPreset(asOfPreset as AsOfPreset, now, fiscalStartMonth);
  }
  if (typeof stored.compare === "string" && stored.compare !== "none") out.compare = stored.compare;
  const filters = stored.filters;
  if (filters && typeof filters === "object") {
    for (const [k, v] of Object.entries(filters as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Comparison windows
// ---------------------------------------------------------------------------------------------------------------

/** The prior as-of day: one month earlier (month-end to month-end). */
export function priorAsOf(asOf: string): string {
  return addMonthsKeepEnd(asOf, -1);
}

/**
 * The window a comparison column is read over.
 *  - priorPeriod (range): the same number of days immediately before `from`; (as-of): one month earlier;
 *  - priorYear: the same days one year earlier (29 Feb becomes 28 Feb);
 *  - custom: the caller's own compareFrom/compareTo (range) or compareAsOf (as-of).
 */
export function comparisonWindow(
  base: { from?: string; to?: string; asOf?: string },
  mode: ReportComparisonMode,
  custom: { from?: string; to?: string; asOf?: string } = {}
): ComparisonWindow {
  if (mode === "none" || mode === "budget") return { mode };
  if (mode === "custom") return { mode, ...custom };
  const out: ComparisonWindow = { mode };
  if (base.from && base.to) {
    if (mode === "priorYear") {
      out.from = minusOneYear(base.from);
      out.to = minusOneYear(base.to);
    } else if (base.from.endsWith("-01") && isMonthEnd(base.to)) {
      // Whole calendar months (a month, a quarter, a half year): the same number of calendar months before.
      const months = (Number(base.to.slice(0, 4)) - Number(base.from.slice(0, 4))) * 12 + Number(base.to.slice(5, 7)) - Number(base.from.slice(5, 7)) + 1;
      out.from = addMonths(base.from, -months);
      out.to = endOfMonth(addMonths(base.to, -months));
    } else {
      const length = daysBetween(base.from, base.to) + 1;
      out.to = addDays(base.from, -1);
      out.from = addDays(out.to, -(length - 1));
    }
  }
  if (base.asOf) out.asOf = mode === "priorYear" ? minusOneYear(base.asOf) : priorAsOf(base.asOf);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------------------------------------------

function one(value: unknown): string | undefined | "ARRAY" {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) return "ARRAY";
  return String(value);
}

/**
 * Validate a run query against a definition's rules and resolve defaults: a range report defaults to the fiscal year
 * to date, an as-of report to today (Dubai). Unknown keys are refused (400 INVALID_PARAMS).
 */
export function parseRunQuery(
  query: Record<string, unknown>,
  rules: ParamRules,
  ctx: { now?: Date; fiscalStartMonth?: number } = {}
): Result<ResolvedParams> {
  const now = ctx.now ?? new Date();
  // `strict` (refuse instead of warning on unmatched intercompany balances) is an API option any run may carry; only the consolidation reads it.
  const allowed = new Set<string>([...BASE_KEYS, ...rules.filters, "strict"]);
  for (const key of Object.keys(query)) {
    if (!allowed.has(key)) return bad("UNKNOWN_PARAM", `Unknown parameter "${key}" for this report.`);
  }
  // A date key the report does not take is as unknown as a misspelt one: a range report has no asOf, an as-of report no range.
  const rangeKeys = ["from", "to", "compareFrom", "compareTo"];
  const asOfKeys = ["asOf", "compareAsOf"];
  for (const key of Object.keys(query)) {
    if (rangeKeys.includes(key) && !rules.kinds.includes("range")) return bad("UNKNOWN_PARAM", `"${key}" does not apply to this report (it has no date range).`);
    if (asOfKeys.includes(key) && !rules.kinds.includes("asOf")) return bad("UNKNOWN_PARAM", `"${key}" does not apply to this report (it has no as-of day).`);
  }
  const text: Record<string, string | undefined> = {};
  for (const key of allowed) {
    const v = one(query[key]);
    if (v === "ARRAY") return bad("INVALID_PARAMS", `Parameter "${key}" was given more than once.`);
    text[key] = v;
  }

  for (const key of ["from", "to", "asOf", "compareFrom", "compareTo", "compareAsOf"]) {
    if (text[key] !== undefined && !isYmd(text[key])) return bad("INVALID_PARAMS", `${key} must be a calendar date (YYYY-MM-DD).`);
  }

  const format = (text.format ?? "json") as ReportFormat;
  if (!(REPORT_FORMATS as readonly string[]).includes(format)) return bad("INVALID_PARAMS", "format must be json, csv, xlsx or pdf.");
  const lang = text.lang ?? "en";
  if (lang !== "en" && lang !== "ar") return bad("INVALID_PARAMS", "lang must be en or ar.");

  let limit = DEFAULT_PAGE_LIMIT;
  if (text.limit !== undefined) {
    const n = Number(text.limit);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_LIMIT) return bad("INVALID_PARAMS", `limit must be a whole number from 1 to ${MAX_PAGE_LIMIT}.`);
    limit = n;
  }
  let offset = 0;
  if (text.offset !== undefined) {
    const n = Number(text.offset);
    if (!Number.isInteger(n) || n < 0) return bad("INVALID_PARAMS", "offset must be a whole number of 0 or more.");
    offset = n;
  }

  const filters: Partial<Record<FilterKey, string>> = {};
  for (const key of [...rules.filters, "strict" as FilterKey]) {
    const v = text[key];
    if (v === undefined) continue;
    if (UUID_FILTERS.has(key) && !UUID.test(v)) return bad("INVALID_PARAMS", `${key} must be an id.`);
    if (key === "companyIds") {
      const ids = v.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.some((id) => !UUID.test(id))) return bad("INVALID_PARAMS", "companyIds must be a comma-separated list of ids.");
      if (ids.length > MAX_COMPANIES) return bad("TOO_MANY_COMPANIES", `At most ${MAX_COMPANIES} companies can be consolidated.`, 422);
    }
    if (key === "statement" && v !== "pl" && v !== "bs") return bad("INVALID_PARAMS", "statement must be pl or bs.");
    if (key === "strict" && v !== "1" && v !== "0") return bad("INVALID_PARAMS", "strict must be 1 or 0.");
    if (key === "taxYear" && !/^\d{4}$/.test(v)) return bad("INVALID_PARAMS", "taxYear must be a four-digit year.");
    if (v.length > 200) return bad("INVALID_PARAMS", `${key} is too long.`);
    filters[key] = v;
  }

  const hasRange = rules.kinds.includes("range");
  const hasAsOf = rules.kinds.includes("asOf");
  const today = todayYmd(now);
  const params: ResolvedParams = { compare: { mode: "none" }, filters, limit, offset, format: format, lang };

  if (hasRange) {
    const from = text.from ?? fiscalYearStart(today, ctx.fiscalStartMonth ?? 1);
    const to = text.to ?? today;
    if (from > to) return bad("INVALID_RANGE", "from must be on or before to.", 422);
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return bad("RANGE_TOO_LONG", "The date range cannot be longer than five years.", 422);
    params.from = from;
    params.to = to;
  }
  if (hasAsOf) {
    const asOf = text.asOf ?? today;
    if (rules.noFutureAsOf && asOf > today) return bad("AS_OF_IN_FUTURE", `asOf ${asOf} is in the future. Use today or an earlier day.`, 422);
    params.asOf = asOf;
  }

  const mode = (text.compare ?? "none") as ReportComparisonMode;
  if (!COMPARE_MODES.includes(mode)) return bad("INVALID_PARAMS", "compare must be none, priorPeriod, priorYear, budget or custom.");
  const comparable = rules.kinds.includes("comparison");
  if (mode !== "none" && !comparable) {
    if (!(mode === "budget" && rules.budgetComparison)) return bad("COMPARISON_NOT_SUPPORTED", "This report does not support a comparison.", 422);
  }
  if (mode === "budget" && !rules.budgetComparison) return bad("COMPARISON_NOT_SUPPORTED", "Only Budget vs Actual compares against a budget.", 422);
  if (mode === "custom") {
    const custom: { from?: string; to?: string; asOf?: string } = {};
    if (hasRange) {
      if (!text.compareFrom || !text.compareTo) return bad("INVALID_PARAMS", "compare=custom needs compareFrom and compareTo.");
      if (text.compareFrom > text.compareTo) return bad("INVALID_RANGE", "compareFrom must be on or before compareTo.", 422);
      custom.from = text.compareFrom;
      custom.to = text.compareTo;
    }
    if (hasAsOf && !hasRange) {
      if (!text.compareAsOf) return bad("INVALID_PARAMS", "compare=custom needs compareAsOf.");
      custom.asOf = text.compareAsOf;
    }
    params.compare = comparisonWindow(params, "custom", custom);
  } else if (mode !== "none") {
    params.compare = comparisonWindow(params, mode);
  }
  return { ok: true, value: params };
}
