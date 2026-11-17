/**
 * Keyed, locale-aware lookup for report catalog display strings (R18-02, F14).
 *
 * reportCatalog.ts stays the single source of English labels and ids. Arabic
 * strings live in client/src/locales/ar-catalog/reportCatalog.json under
 * `reportCatalog.<kind>.<id>.<field>` and are merged into the Arabic
 * translation table by `loadLocale("ar")` (lazily, like every other Arabic
 * catalog), so this module carries no strings of its own beyond the keys of
 * the generated sentences (`reportCatalog.tpl.*`).
 *
 * `ct(kind, id, field, fallback)` resolves one keyed field. `ct.cx(english)`
 * resolves a catalog string a surface only holds as a value (it is derived from
 * the same keyed overlay through `catalogTextEntries()`), and the `ct.*` helpers
 * localize the sentences reportCatalog.ts builds at runtime (runbook steps,
 * impact estimates, automation health and trend labels).
 */
import { useMemo } from "react";
import { formatMessage, t as translations, useI18n, useTranslation, type Locale } from "./i18n";
import { formatDate, formatDateRange, formatMonthYear } from "./format-date";
import { catalogTextEntries } from "./reportCatalogFields";
import { localizeReportDeliveryText } from "@shared/server-copy";
import { REPORT_PATTERNS, REPORT_UI_TEXT } from "./reportCatalogGenerated";

export type CatalogTextKind =
  | "report"
  | "workspace"
  | "suite"
  | "shortcut"
  | "preset"
  | "pack"
  | "starter"
  | "delivery"
  | "category"
  | "setupStep"
  | "workflowStep"
  | "playbook"
  | "quickAccess"
  | "savedView"
  | "brief"
  | "impact"
  | "rule"
  | "depthArea"
  | "subgoal"
  | "metric";

export function catalogTextKey(kind: CatalogTextKind, id: string, field: string): string {
  return `reportCatalog.${kind}.${id}.${field}`;
}

/** Resolve one catalog label; English (or an id without an entry) returns `fallback`. */
export function catalogText(
  table: Record<string, string>,
  locale: Locale,
  kind: CatalogTextKind,
  id: string,
  field: string,
  fallback: string
): string {
  if (locale === "en") return fallback;
  return table[catalogTextKey(kind, id, field)] ?? fallback;
}

/**
 * English sentences that reportCatalog.ts (and the Reports page hooks) generate at runtime, with
 * the overlay key that carries their Arabic. Templates with `{placeholders}` are rendered through
 * `catalogTemplate`.
 */
export const GENERATED_TEXT_KEYS = {
  "Detect report signal": "reportCatalog.tpl.runbookSignalTitle",
  "Review linked workflow": "reportCatalog.tpl.runbookReviewTitle",
  "Queue guarded delivery": "reportCatalog.tpl.runbookDeliverTitle",
  "Open delivery guardrail": "reportCatalog.tpl.runbookDeliverAction",
  "Open the delivery workflow to finish scheduling and guardrails.":
    "reportCatalog.tpl.runbookDeliverFallback",
  "Impact compounding": "reportCatalog.tpl.impactCompounding",
  "Review impact": "reportCatalog.tpl.impactReview",
  "Setup needed": "reportCatalog.tpl.impactSetup",
  "Ready to automate": "reportCatalog.tpl.healthReady",
  "Review signals": "reportCatalog.tpl.healthReview",
  "Needs setup": "reportCatalog.tpl.healthSetup",
  "Baseline captured": "reportCatalog.tpl.trendBaseline",
  "First saved automation-health snapshot for this workspace.":
    "reportCatalog.tpl.trendBaselineDetail",
  Improved: "reportCatalog.tpl.trendImproved",
  "Needs attention": "reportCatalog.tpl.trendAttention",
  Stable: "reportCatalog.tpl.trendStable",
} as const;

const OVERLAY_SENTINEL_KEY = "reportCatalog.tpl.healthReady";
interface EnglishIndex {
  exact: Map<string, string>;
  /** Lower-cased aliases, used only inside generated sentences. */
  lower: Map<string, string>;
}

const indexCache = new WeakMap<object, EnglishIndex>();

/** English -> Arabic index over every keyed catalog field the overlay translates. */
function englishIndex(table: Record<string, string>): EnglishIndex {
  const cached = indexCache.get(table);
  if (cached) return cached;
  const index = new Map<string, string>();
  // The overlay is merged into the table as one file: until it lands there is nothing to index
  // (and nothing to cache, so the next render after the merge builds the real index).
  if (!table[OVERLAY_SENTINEL_KEY]) return { exact: index, lower: new Map() };
  for (const entry of catalogTextEntries()) {
    const value = table[entry.key];
    if (value && !index.has(entry.english)) index.set(entry.english, value);
  }
  for (const [english, key] of Object.entries(GENERATED_TEXT_KEYS)) {
    const value = table[key];
    if (value) index.set(english, value);
  }
  for (const [id, english] of Object.entries(REPORT_UI_TEXT)) {
    const value = table[`reportCatalog.ui.${id}`];
    if (value && !index.has(english)) index.set(english, value);
  }
  // Lower-cased aliases: the models lower-case catalog labels inside sentences ("owner / solo reports").
  const lower = new Map<string, string>();
  for (const [english, arabic] of index.entries()) {
    const key = english.toLowerCase();
    if (!lower.has(key)) lower.set(key, arabic);
  }
  const built = { exact: index, lower };
  indexCache.set(table, built);
  return built;
}

const NUMERIC_GROUP = /^[\d.,/%+-]+$/;

const EN_SHORT_DATE = "[A-Z][a-z]{2} \\d{1,2}, \\d{4}";
const DATE_RANGE = new RegExp(`^(${EN_SHORT_DATE}) - (${EN_SHORT_DATE})$`);
const SHORT_DATE = new RegExp(`^${EN_SHORT_DATE}$`);
const MONTH_YEAR = /^([A-Z][a-z]{2,8}) (\d{4})$/;
const DAY_TIME = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{2}:\d{2})$/;

/** English date labels the report hooks build ("Nov 01, 2026 - Nov 16, 2026", "November 2026"). */
function translateDateText(english: string, locale: Locale): string | null {
  const range = DATE_RANGE.exec(english);
  if (range) return formatDateRange(new Date(range[1]), new Date(range[2]), locale);
  if (SHORT_DATE.test(english)) return formatDate(new Date(english), locale);
  const monthYear = MONTH_YEAR.exec(english);
  if (monthYear) {
    const parsed = new Date(`${monthYear[1]} 1, ${monthYear[2]}`);
    return Number.isNaN(parsed.getTime()) ? null : formatMonthYear(parsed, locale);
  }
  const dayTime = DAY_TIME.exec(english);
  if (dayTime) {
    const parsed = new Date(`${dayTime[1]} ${dayTime[2]}, 2000`);
    if (Number.isNaN(parsed.getTime())) return null;
    return `${formatDate(parsed, locale).replace(/\s*2000$/, "")} ${dayTime[3]}`;
  }
  return null;
}

/** Translate one English display string: exact catalog/UI text, then generated sentence patterns. */
function translateEnglish(
  table: Record<string, string>,
  english: string,
  locale: Locale,
  depth = 0
): string {
  const index = englishIndex(table);
  // Lower-case aliases only apply inside sentences (depth > 0): a whole value such as the raw
  // status "failed" must stay as the code uses it.
  const exact =
    index.exact.get(english) ?? (depth > 0 ? index.lower.get(english.toLowerCase()) : undefined);
  if (exact !== undefined) return exact;
  const dated = translateDateText(english, locale);
  if (dated) return dated;
  if (depth > 2) return english;
  for (const pattern of REPORT_PATTERNS) {
    const match = pattern.re.exec(english);
    if (!match) continue;
    const template = table[`reportCatalog.pat.${pattern.id}`];
    if (!template) continue;
    const values: Record<string, string> = {};
    match.slice(1).forEach((group, index) => {
      const text = group ?? "";
      values[String(index + 1)] = NUMERIC_GROUP.test(text)
        ? text
        : translateEnglish(table, text, locale, depth + 1);
    });
    return formatMessage(template, values);
  }
  // Server-written delivery run errors / handoff sentences (shared/server-copy templates).
  const delivery = localizeReportDeliveryText(english, table);
  if (delivery !== english) return delivery;
  if (english.includes(" · ")) {
    const parts = english.split(" · ");
    const translated = parts.map((part) => translateEnglish(table, part, locale, depth + 1));
    if (translated.some((part, index) => part !== parts[index])) return translated.join(" · ");
  }
  return english;
}

/** Translate a catalog (or generated-label) string held as a value; unknown text is unchanged. */
export function catalogTextByEnglish(
  table: Record<string, string>,
  locale: Locale,
  english: string
): string {
  if (locale === "en" || !english) return english;
  return translateEnglish(table, english, locale);
}

const DEEP_MAX_DEPTH = 14;

/** Localized copies of model objects already walked, with the depth they were walked from. */
type DeepCache = WeakMap<object, { depth: number; out: unknown }>;

function deepLocalize(
  value: unknown,
  cx: (english: string) => string,
  depth: number,
  cache: DeepCache
): unknown {
  if (typeof value === "string") return cx(value);
  if (depth > DEEP_MAX_DEPTH || value === null || typeof value !== "object") return value;
  // The Reports models share sub-objects (the same report, suite or rule appears under many
  // parents); walk each object once. A copy made from a shallower depth saw at least as much of
  // the subtree, so it can be reused deeper down.
  const cached = cache.get(value);
  if (cached && cached.depth <= depth) return cached.out;
  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((item) => deepLocalize(item, cx, depth + 1, cache));
  } else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    if ("$$typeof" in (value as Record<string, unknown>)) return value;
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      copy[key] = deepLocalize(item, cx, depth + 1, cache);
    }
    out = copy;
  }
  cache.set(value, { depth, out });
  return out;
}

export interface CatalogText {
  (kind: CatalogTextKind, id: string, field: string, fallback: string): string;
  locale: Locale;
  /** Translate a catalog string by its English value (keyed overlay, derived index). */
  cx: (english: string) => string;
  /**
   * Translate every string value of a catalog-derived display model (exact catalog text only;
   * ids, hrefs, numbers and unknown text pass through). Used on the render side of the Reports
   * and Dashboard models so exports and API payloads keep the English source.
   */
  deep: <T>(value: T) => T;
  /** Comparison metric row: label and signal by metric id (consolidated rows by their source). */
  metric: <R extends { id: string; label: string; signal: string }>(row: R) => R;
}

/**
 * Per-table memo of English -> display text. The Reports models hold thousands of strings with many
 * repeats (ids, labels, sentences shared by suites, packs and automations); without it, `deep`
 * re-ran every exact lookup, date parse and generated-sentence pattern for each occurrence, which
 * took seconds of main-thread time on /reports in Arabic (WP-D). The memo is dropped whenever the
 * table gains keys (a catalog namespace finished loading), so late catalogs still apply.
 */
const translationMemos = new WeakMap<object, { size: number; memo: Map<string, string> }>();

function translationMemo(table: Record<string, string>): Map<string, string> {
  const size = Object.keys(table).length;
  const existing = translationMemos.get(table);
  if (existing && existing.size === size) return existing.memo;
  const memo = new Map<string, string>();
  translationMemos.set(table, { size, memo });
  return memo;
}

/** Build the locale-bound lookup (also used by the unit tests). */
export function createCatalogText(table: Record<string, string>, locale: Locale): CatalogText {
  const memo = locale === "en" ? null : translationMemo(table);
  const cx = (english: string) => {
    if (!memo || !english) return catalogTextByEnglish(table, locale, english);
    let out = memo.get(english);
    if (out === undefined) {
      out = catalogTextByEnglish(table, locale, english);
      memo.set(english, out);
    }
    return out;
  };
  const lookup = (kind: CatalogTextKind, id: string, field: string, fallback: string) =>
    catalogText(table, locale, kind, id, field, fallback);
  // One object cache per lookup (it lives with the memoized table, like the string memo).
  const deepCache: DeepCache = new WeakMap();
  const deep = <T>(value: T): T =>
    locale === "en" ? value : (deepLocalize(value, cx, 0, deepCache) as T);
  const metric = <R extends { id: string; label: string; signal: string }>(row: R): R => {
    if (locale === "en") return row;
    const rollup = row.id.startsWith("consolidated-") && row.label.startsWith("Roll-up ");
    const labelled = row as R & { currentLabel?: string; previousLabel?: string };
    return {
      ...row,
      label: catalogText(
        table,
        locale,
        "metric",
        row.id,
        rollup ? "labelRollup" : "label",
        row.label
      ),
      signal: catalogText(table, locale, "metric", row.id, "signal", row.signal),
      ...(labelled.currentLabel ? { currentLabel: cx(labelled.currentLabel) } : {}),
      ...(labelled.previousLabel ? { previousLabel: cx(labelled.previousLabel) } : {}),
    };
  };
  return Object.assign(lookup, { locale, cx, deep, metric });
}

/** Hook form: `const ct = useCatalogText(); ct("suite", suite.id, "title", suite.title)`. */
export function useCatalogText(): CatalogText {
  const { t, locale } = useTranslation();
  return useMemo(() => createCatalogText(t as Record<string, string>, locale), [t, locale]);
}

/**
 * Non-hook forms for model/helper code (the Reports page remounts on locale or catalog change, so
 * memoised models can read the current locale like `translateNow` does).
 */
export function catalogTextNow(
  kind: CatalogTextKind,
  id: string,
  field: string,
  fallback: string
): string {
  const locale = useI18n.getState().locale;
  return catalogText(
    translations[locale] as Record<string, string>,
    locale,
    kind,
    id,
    field,
    fallback
  );
}

export function cxNow(english: string): string {
  const locale = useI18n.getState().locale;
  return catalogTextByEnglish(translations[locale] as Record<string, string>, locale, english);
}
