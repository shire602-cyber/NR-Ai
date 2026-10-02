// The report registry (Phase 8 D4): a map of thin definitions keyed by catalog id. A definition says which
// columns it has, which filters it takes and how to read its rows; everything else (parameter parsing, the
// snapshot transaction, comparison columns, pagination, CSV / XLSX / PDF) is shared. `params` and `drillTarget`
// come from the catalog entry, the single source, and registration throws when the entry is missing or lacks them.

import {
  REPORT_DRILL_TARGETS,
  REPORT_PARAM_KINDS,
  type LocalizedText,
  type ReportColumn,
  type ReportDrillTarget,
  type ReportParamKind,
  type ReportRow,
} from "../../shared/report-result";
import { reportCatalog, type ReportCatalogItem } from "../../client/src/lib/reportCatalog";
import { reportNameAr } from "../../client/src/lib/reportCatalogI18n";
import type { FilterKey, ResolvedParams } from "./params";
import type { Queryable } from "./ledger";

export const MAX_REPORT_ROWS = 50_000;

export interface ReportCompany {
  id: string;
  name: string;
  baseCurrency: string;
  fiscalYearStartMonth: number;
  trn: string | null;
  emirate: string | null;
}

/** The days a definition reads: the current window, or the comparison window on the second pass. */
export interface ReportWindow {
  from?: string;
  to?: string;
  asOf?: string;
}

export interface ReportContext {
  companyId: string;
  company: ReportCompany;
  /** One snapshot connection (REPEATABLE READ, read only) shared by every query of the run. */
  q: Queryable;
  params: ResolvedParams;
  /** The window to read now. */
  window: ReportWindow;
  /** True on the comparison pass of a comparison run. */
  isComparison: boolean;
  now: Date;
  /** The requesting user (or a schedule's creator); VAT return computation records it. */
  userId?: string;
  /**
   * Set when the JSON page is wanted and the definition is `paged`: the definition then returns ONLY that window of rows (read
   * with OFFSET / LIMIT in SQL) plus `total` and totals computed by a separate aggregate, never from the rows it returned.
   */
  page?: { offset: number; limit: number };
  /** Hard cap: a definition stops reading at `maxRows + 1` rows and run.ts refuses the report as too large. */
  maxRows: number;
  /** Whether the requesting user may open another company (consolidation); defined by the route. */
  canAccessCompany: (companyId: string) => Promise<boolean>;
}

export interface ReportOutput {
  /** Rows of the whole report when the definition paged in SQL (`rows` is then only the requested window). */
  total?: number;
  /** Columns that depend on the data (one per consolidated entity); otherwise the definition's own. */
  columns?: DefColumn[];
  rows: ReportRow[];
  totals?: Record<string, string | number | null>;
  warnings?: string[];
}

export type DefColumn = ReportColumn & {
  /** Add the column up over detail rows into `totals` (unless the definition returns its own totals). */
  sum?: boolean;
};

export interface ReportDefinition {
  id: string;
  columns: DefColumn[];
  /** Per-definition filters the query may carry. */
  filters?: readonly FilterKey[];
  /** Owner / accountant / CFO or firm staff only. */
  sensitive?: boolean;
  /** An as-of day after today is refused (ageing). */
  noFutureAsOf?: boolean;
  /** `compare=budget` is meaningful (the report has its own budget column). */
  budgetComparison?: boolean;
  /** The definition can read one window of its rows in SQL (general ledger, account transactions, journal report) when `ctx.page` is set. */
  paged?: boolean;
  /** The definition reads `ctx.params.compare` itself (Comparative Trial Balance, Budget vs Actual): no second pass or merge. */
  ownComparison?: boolean;
  /** Without an explicit compare, run as if this mode were asked for (Period Comparison). */
  defaultCompare?: "priorPeriod" | "priorYear";
  run: (ctx: ReportContext) => Promise<ReportOutput>;
}

export interface RegisteredReport extends ReportDefinition {
  title: LocalizedText;
  params: readonly ReportParamKind[];
  drillTarget: ReportDrillTarget;
  catalog: ReportCatalogItem;
}

const registry = new Map<string, RegisteredReport>();

export function registerReport(def: ReportDefinition): void {
  const entry = reportCatalog.find((r) => r.id === def.id);
  if (!entry) throw new Error(`Report "${def.id}" has no catalog entry`);
  if (!entry.params || entry.params.length === 0 || !entry.params.every((p) => (REPORT_PARAM_KINDS as readonly string[]).includes(p))) {
    throw new Error(`Catalog entry "${def.id}" has no valid params`);
  }
  if (!entry.drillTarget || !(REPORT_DRILL_TARGETS as readonly string[]).includes(entry.drillTarget)) {
    throw new Error(`Catalog entry "${def.id}" has no valid drillTarget`);
  }
  if (registry.has(def.id)) throw new Error(`Report "${def.id}" is registered twice`);
  registry.set(def.id, {
    ...def,
    title: { en: entry.name, ar: reportNameAr[def.id] ?? entry.name },
    params: entry.params,
    drillTarget: entry.drillTarget,
    catalog: entry,
  });
}

export function getReport(id: string): RegisteredReport | undefined {
  return registry.get(id);
}

export function listReports(): RegisteredReport[] {
  return [...registry.values()];
}

/** Test hook: ids registered so far. */
export function registeredReportIds(): string[] {
  return [...registry.keys()];
}
