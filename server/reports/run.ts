// runReport (Phase 8 D4): the one place a report is executed. It opens ONE read-only REPEATABLE READ transaction so the
// rows, the totals and the comparison columns come from a single snapshot even while invoices are posting, runs the
// definition for the current window (and the comparison window), merges comparison columns, totals over the FULL set,
// and paginates the JSON form.

import Decimal from "decimal.js";
import type { ReportColumn, ReportResult, ReportRow } from "../../shared/report-result";
import { pool } from "../db";
import { AppError } from "../errors";
import { mergeComparison, mergeTotals, withComparisonColumns } from "./compare";
import { comparisonWindow, type ResolvedParams } from "./params";
import {
  MAX_REPORT_ROWS,
  type ReportCompany,
  type ReportContext,
  type ReportOutput,
  type ReportWindow,
  type RegisteredReport,
} from "./registry";

type Cells = Record<string, string | number | null>;

export interface RunInput {
  report: RegisteredReport;
  company: ReportCompany;
  params: ResolvedParams;
  now?: Date;
  userId?: string;
  /** JSON pages the rows (offset / limit); file formats pass false and receive every row. */
  paginate: boolean;
  canAccessCompany?: (companyId: string) => Promise<boolean>;
}

/** Totals of the `sum` columns over detail rows, exact in fils. */
export function sumDetailRows(columns: { key: string; sum?: boolean }[], rows: ReportRow[]): Cells | undefined {
  const sumColumns = columns.filter((c) => c.sum);
  if (sumColumns.length === 0) return undefined;
  const totals: Cells = {};
  for (const c of sumColumns) {
    let total = new Decimal(0);
    for (const r of rows) {
      if (r.kind !== "detail") continue;
      const v = r.cells[c.key];
      if (typeof v === "number" && Number.isFinite(v)) total = total.plus(v);
    }
    totals[c.key] = total.toDecimalPlaces(2).toNumber();
  }
  return totals;
}

function tooLarge(): AppError {
  return new AppError({
    message: `This report has more than ${MAX_REPORT_ROWS.toLocaleString("en-US")} rows. Narrow the date range or add a filter.`,
    statusCode: 422,
    code: "REPORT_TOO_LARGE",
  });
}

async function runPass(report: RegisteredReport, ctx: ReportContext): Promise<ReportOutput & { totals?: Cells }> {
  const out = await report.run(ctx);
  // A page read in SQL is bounded by its limit; the cap is for whole reports (exports, comparisons).
  if (out.total === undefined && out.rows.length > MAX_REPORT_ROWS) throw tooLarge();
  const totals = out.totals ?? sumDetailRows(out.columns ?? report.columns, out.rows);
  return { ...out, totals };
}

export async function runReport(input: RunInput): Promise<ReportResult> {
  const { report, company, params } = input;
  const now = input.now ?? new Date();
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const base: Omit<ReportContext, "window" | "isComparison"> = {
      companyId: company.id,
      company,
      q: client,
      params,
      now,
      userId: input.userId,
      maxRows: MAX_REPORT_ROWS,
      canAccessCompany: input.canAccessCompany ?? (async (id) => id === company.id),
    };
    const currentWindow: ReportWindow = { from: params.from, to: params.to, asOf: params.asOf };
    const pageWanted = input.paginate && report.paged === true && params.compare.mode === "none" && !report.defaultCompare;
    const current = await runPass(report, {
      ...base,
      window: currentWindow,
      isComparison: false,
      ...(pageWanted ? { page: { offset: params.offset, limit: params.limit } } : {}),
    });

    let compare = params.compare;
    if (compare.mode === "none" && report.defaultCompare) {
      compare = comparisonWindow(currentWindow, report.defaultCompare);
    }
    const comparing =
      !report.ownComparison && (compare.mode === "priorPeriod" || compare.mode === "priorYear" || compare.mode === "custom");

    let columns: ReportColumn[] = (current.columns ?? report.columns).map(({ sum: _sum, ...c }) => c);
    let rows = current.rows;
    let totals = current.totals;
    const warnings = [...(current.warnings ?? [])];

    if (comparing) {
      const prior = await runPass(report, {
        ...base,
        window: { from: compare.from, to: compare.to, asOf: compare.asOf },
        isComparison: true,
      });
      rows = mergeComparison(columns, current.rows, prior.rows);
      totals = mergeTotals(columns, current.totals, prior.totals);
      columns = withComparisonColumns(columns);
      for (const w of prior.warnings ?? []) if (!warnings.includes(w)) warnings.push(w);
    }
    await client.query("COMMIT");

    const paged = current.total !== undefined;
    const total = paged ? (current.total as number) : rows.length;
    const page = input.paginate ? { offset: params.offset, limit: params.limit, total } : undefined;
    const visible = page && !paged ? rows.slice(page.offset, page.offset + page.limit) : rows;
    return {
      reportId: report.id,
      title: report.title,
      companyId: company.id,
      currency: "AED",
      params: {
        ...(params.from ? { from: params.from } : {}),
        ...(params.to ? { to: params.to } : {}),
        ...(params.asOf ? { asOf: params.asOf } : {}),
        ...(comparing || (report.ownComparison && compare.mode !== "none") || compare.mode === "budget"
          ? { compare: { mode: compare.mode, from: compare.from, to: compare.to, asOf: compare.asOf } }
          : {}),
      },
      columns,
      rows: visible,
      ...(totals ? { totals } : {}),
      ...(page ? { page } : {}),
      ...(warnings.length ? { warnings } : {}),
      generatedAt: now.toISOString(),
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* the connection is released below either way */
    }
    throw err;
  } finally {
    client.release();
  }
}
