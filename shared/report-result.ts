// The one shape every server report returns (Phase 8 D4). The report engine in server/reports builds it,
// the run route serialises it as JSON, and the CSV / XLSX / PDF renderers and the client viewer read it.
// Money cells are numbers rounded to fils (AED unless the column says otherwise); date cells are
// YYYY-MM-DD strings in Dubai calendar days; labels carry both languages so the viewer never translates.

export type ReportColumnType = "text" | "money" | "date" | "number" | "percent";

export interface LocalizedText {
  en: string;
  ar: string;
}

export interface ReportColumn {
  key: string;
  label: LocalizedText;
  type: ReportColumnType;
  /** True on a column that gets `<key>__cmp`, `<key>__delta` and `<key>__pct` when a comparison is asked for. */
  comparable?: boolean;
}

export type ReportRowKind = "detail" | "section" | "subtotal";

/** Where a row leads when clicked. The viewer maps `target` to a page (client/src/lib/report-drill.ts). */
export interface ReportDrill {
  target: ReportDrillTarget;
  id: string;
}

export interface ReportRow {
  /** Stable key: rows of the current and the comparison run are matched on it. */
  key: string;
  kind: ReportRowKind;
  depth?: number;
  cells: Record<string, string | number | null>;
  drill?: ReportDrill;
}

export type ReportComparisonMode = "none" | "priorPeriod" | "priorYear" | "budget" | "custom";

export interface ReportParamsEcho {
  from?: string;
  to?: string;
  asOf?: string;
  compare?: { mode: ReportComparisonMode; from?: string; to?: string; asOf?: string };
}

export interface ReportResult {
  reportId: string;
  title: LocalizedText;
  companyId: string;
  currency: "AED";
  params: ReportParamsEcho;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: Record<string, string | number | null>;
  page?: { offset: number; limit: number; total: number };
  warnings?: string[];
  generatedAt: string;
}

/** What a report's date selection looks like: a from/to range, an as-of day, and/or a comparison. */
export const REPORT_PARAM_KINDS = ["range", "asOf", "comparison"] as const;
export type ReportParamKind = (typeof REPORT_PARAM_KINDS)[number];

/** Row-click targets. A catalog entry names its main one; a row carries its own in `drill`. */
export const REPORT_DRILL_TARGETS = [
  "account",
  "journal_entry",
  "invoice",
  "bill",
  "payment",
  "credit_note",
  "refund",
  "quote",
  "purchase_order",
  "vendor_credit",
  "bank_txn",
  "product",
  "asset",
  "employee",
  "payslip",
  "expense_claim",
  "activity",
  "customer",
  "vendor",
  "company",
  "report",
  // Wave 2 (rows over the D1-D3 tables)
  "sales_order",
  "advance",
  "project",
  "approval",
  "loan",
  "bank_account",
  "receipt",
] as const;
export type ReportDrillTarget = (typeof REPORT_DRILL_TARGETS)[number];

export const REPORT_FORMATS = ["json", "csv", "xlsx", "pdf"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export type ReportFileFormat = Exclude<ReportFormat, "json">;
export const REPORT_FILE_FORMATS = ["pdf", "csv", "xlsx"] as const;

/** Suffixes the comparison merge adds to a comparable column key. */
export const REPORT_CMP_SUFFIX = "__cmp";
export const REPORT_DELTA_SUFFIX = "__delta";
export const REPORT_PCT_SUFFIX = "__pct";
