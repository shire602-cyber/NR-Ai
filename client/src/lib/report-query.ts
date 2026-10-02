// Query building for the server report engine (Phase 8 D4): turn the viewer's choices into the run route's query string.
// Pure (no network or browser imports) so the unit tests and the integration suite run it under Node. The calls
// themselves are in reportRunApi.ts.
// The run route refuses unknown keys, so a query only carries what the report declared in its catalog entry
// (`params`) and in report-ui-rules.ts (filters).

import type {
  ReportComparisonMode,
  ReportFileFormat,
  ReportFormat,
  ReportParamKind,
  ReportResult,
} from "@shared/report-result";
import {
  AS_OF_PRESETS,
  RANGE_PRESETS,
  isYmd,
  resolveAsOfPreset,
  resolveRangePreset,
  type AsOfPreset,
  type RangePreset,
} from "./report-presets";
import { reportUiRule, type ReportFilterKey } from "./report-ui-rules";

export type { ReportResult } from "@shared/report-result";

export type ViewComparison = Extract<
  ReportComparisonMode,
  "none" | "priorPeriod" | "priorYear" | "custom"
>;

/** What the person chose in the parameter bar. Presets stay presets until a query is built, so "today" is today. */
export interface ReportViewState {
  rangePreset: RangePreset | "custom";
  from: string;
  to: string;
  asOfPreset: AsOfPreset | "custom";
  asOf: string;
  compare: ViewComparison;
  compareFrom: string;
  compareTo: string;
  compareAsOf: string;
  filters: Partial<Record<ReportFilterKey, string>>;
}

export interface ReportViewDefaults {
  fiscalStartMonth?: number;
  now?: Date;
}

/** Fresh state for a report: this fiscal year to date, as of today, no comparison unless the report always compares. */
export function defaultViewState(
  reportId: string,
  defaults: ReportViewDefaults = {}
): ReportViewState {
  const rule = reportUiRule(reportId);
  const now = defaults.now ?? new Date();
  const range = resolveRangePreset("thisYear", now, defaults.fiscalStartMonth ?? 1);
  return {
    rangePreset: "thisYear",
    from: range.from,
    to: range.to,
    asOfPreset: "today",
    asOf: resolveAsOfPreset("today", now, defaults.fiscalStartMonth ?? 1),
    compare: rule.ownComparison ? "priorPeriod" : "none",
    compareFrom: "",
    compareTo: "",
    compareAsOf: "",
    filters: reportId === "consolidated-statements" ? { statement: "pl" } : {},
  };
}

/** Pick a range preset: the days are resolved now (Dubai time) and kept, so a reload shows the same days. */
export function withRangePreset(
  state: ReportViewState,
  preset: RangePreset,
  defaults: ReportViewDefaults = {}
): ReportViewState {
  const range = resolveRangePreset(
    preset,
    defaults.now ?? new Date(),
    defaults.fiscalStartMonth ?? 1
  );
  return { ...state, rangePreset: preset, from: range.from, to: range.to };
}

export function withAsOfPreset(
  state: ReportViewState,
  preset: AsOfPreset,
  defaults: ReportViewDefaults = {}
): ReportViewState {
  return {
    ...state,
    asOfPreset: preset,
    asOf: resolveAsOfPreset(preset, defaults.now ?? new Date(), defaults.fiscalStartMonth ?? 1),
  };
}

export interface BuildQueryOptions {
  lang: "en" | "ar";
  format?: ReportFormat;
  limit?: number;
  offset?: number;
}

/** The comparison modes a report offers. Reports with their own comparison never offer "none". */
export function comparisonChoices(
  reportId: string,
  kinds: readonly ReportParamKind[]
): ViewComparison[] {
  if (!kinds.includes("comparison")) return [];
  const rule = reportUiRule(reportId);
  return rule.ownComparison
    ? ["priorPeriod", "priorYear", "custom"]
    : ["none", "priorPeriod", "priorYear", "custom"];
}

/**
 * The run route's query for a report. Only sends the date selections the report takes, only its own filters, and only
 * a comparison the report supports. A half-filled custom comparison is left out rather than sent invalid.
 */
export function buildRunQuery(
  reportId: string,
  kinds: readonly ReportParamKind[],
  state: ReportViewState,
  options: BuildQueryOptions
): string {
  const rule = reportUiRule(reportId);
  const q = new URLSearchParams();
  const hasRange = kinds.includes("range");
  const hasAsOf = kinds.includes("asOf");
  if (hasRange) {
    if (isYmd(state.from)) q.set("from", state.from);
    if (isYmd(state.to)) q.set("to", state.to);
  }
  if (hasAsOf && isYmd(state.asOf)) q.set("asOf", state.asOf);

  if (kinds.includes("comparison") && state.compare !== "none") {
    if (state.compare === "custom") {
      if (hasRange && isYmd(state.compareFrom) && isYmd(state.compareTo)) {
        q.set("compare", "custom");
        q.set("compareFrom", state.compareFrom);
        q.set("compareTo", state.compareTo);
      } else if (hasAsOf && !hasRange && isYmd(state.compareAsOf)) {
        q.set("compare", "custom");
        q.set("compareAsOf", state.compareAsOf);
      }
    } else {
      q.set("compare", state.compare);
    }
  }

  for (const key of rule.filters) {
    const value = state.filters[key];
    if (value !== undefined && value !== "") q.set(key, value);
  }
  if (rule.strict && state.filters.strict === "1") q.set("strict", "1");
  if (options.format && options.format !== "json") q.set("format", options.format);
  q.set("lang", options.lang);
  if (options.limit !== undefined) q.set("limit", String(options.limit));
  if (options.offset !== undefined && options.offset > 0) q.set("offset", String(options.offset));
  return q.toString();
}

/** The choices as a bookmarkable query (no language, format or paging): the viewer keeps it in the address bar. */
export function buildShareQuery(
  reportId: string,
  kinds: readonly ReportParamKind[],
  state: ReportViewState
): string {
  const q = new URLSearchParams(buildRunQuery(reportId, kinds, state, { lang: "en" }));
  q.delete("lang");
  return q.toString();
}

/** Read the choices back from an address-bar query. Unknown or malformed values are ignored (defaults stay). */
export function stateFromSearch(
  reportId: string,
  kinds: readonly ReportParamKind[],
  search: string,
  defaults: ReportViewDefaults = {}
): ReportViewState {
  const base = defaultViewState(reportId, defaults);
  const q = new URLSearchParams(search);
  const rule = reportUiRule(reportId);
  const next: ReportViewState = { ...base, filters: { ...base.filters } };
  const day = (key: string): string | null => {
    const v = q.get(key);
    return v && isYmd(v) ? v : null;
  };
  if (kinds.includes("range")) {
    const from = day("from");
    const to = day("to");
    if (from && to) {
      const preset = RANGE_PRESETS.find((p) => {
        const r = resolveRangePreset(p, defaults.now ?? new Date(), defaults.fiscalStartMonth ?? 1);
        return r.from === from && r.to === to;
      });
      Object.assign(next, { rangePreset: preset ?? "custom", from, to });
    }
  }
  const asOf = day("asOf");
  if (kinds.includes("asOf") && asOf) {
    const preset = AS_OF_PRESETS.find(
      (p) =>
        resolveAsOfPreset(p, defaults.now ?? new Date(), defaults.fiscalStartMonth ?? 1) === asOf
    );
    Object.assign(next, { asOfPreset: preset ?? "custom", asOf });
  }
  const compare = q.get("compare");
  if (
    kinds.includes("comparison") &&
    (compare === "none" ||
      compare === "priorPeriod" ||
      compare === "priorYear" ||
      compare === "custom")
  ) {
    if (!(compare === "none" && rule.ownComparison)) next.compare = compare;
    next.compareFrom = day("compareFrom") ?? "";
    next.compareTo = day("compareTo") ?? "";
    next.compareAsOf = day("compareAsOf") ?? "";
  }
  for (const key of rule.filters) {
    const v = q.get(key);
    if (v) next.filters[key] = v.slice(0, 200);
  }
  if (rule.strict && q.get("strict") === "1") next.filters.strict = "1";
  return next;
}

/** Reports whose as-of day is the ageing date the Reports page keeps for them. */
const AGEING_AS_OF_REPORTS = new Set([
  "ar-aging",
  "ap-aging",
  "customer-balances",
  "vendor-balances",
]);

/**
 * The viewer's choices for a report the Reports page shows in a tab: the tab's own date range (a start and end day, or
 * none), and its ageing date. Reports with an as-of day use the range's end day, as the balance sheet tab does.
 */
export function stateForTabReport(
  reportId: string,
  tab: { from?: string; to?: string; agingAsOf?: string },
  defaults: ReportViewDefaults = {}
): ReportViewState {
  const base = defaultViewState(reportId, defaults);
  const today = resolveAsOfPreset(
    "today",
    defaults.now ?? new Date(),
    defaults.fiscalStartMonth ?? 1
  );
  const next: ReportViewState = { ...base };
  if (tab.from && tab.to && isYmd(tab.from) && isYmd(tab.to))
    Object.assign(next, { rangePreset: "custom", from: tab.from, to: tab.to });
  const asOf = AGEING_AS_OF_REPORTS.has(reportId) ? tab.agingAsOf : tab.to;
  if (asOf && isYmd(asOf)) Object.assign(next, { asOfPreset: "custom", asOf });
  else next.asOf = today;
  return next;
}

export const reportRunPath = (companyId: string, reportId: string, query: string): string =>
  `/api/companies/${companyId}/reports/run/${reportId}${query ? `?${query}` : ""}`;

/** Link to the viewer for a report, optionally carrying a few choices (bookmarkable). */
export function reportViewerHref(reportId: string, query = ""): string {
  return `/reports/run/${encodeURIComponent(reportId)}${query ? `?${query}` : ""}`;
}

export const REPORT_VIEWER_INDEX = "/reports/run";
export const REPORT_SCHEDULES_HREF = "/reports/schedules";

/** Which API error codes the viewer explains in its own words (the rest show the server's message). */
export const KNOWN_REPORT_ERRORS = [
  "ROLE_FORBIDDEN",
  "REPORT_NOT_AVAILABLE",
  "INVALID_RANGE",
  "RANGE_TOO_LONG",
  "AS_OF_IN_FUTURE",
  "REPORT_TOO_LARGE",
  "MIXED_BASE_CURRENCY",
  "TOO_MANY_COMPANIES",
  "UNMATCHED_INTERCOMPANY",
  "COMPARISON_NOT_SUPPORTED",
] as const;
