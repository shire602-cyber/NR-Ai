// Glue between a request (or a schedule) and the engine: load the company, validate the query against the report's
// rules, run it, and render the chosen format (Phase 8 D4).

import type { ReportResult } from "../../shared/report-result";
import { AppError } from "../errors";
import { pool } from "../db";
import { MIME, reportFileName, type Lang } from "./render/common";
import { renderCsv } from "./render/csv";
import { PDF_MAX_ROWS, renderPdf } from "./render/pdf";
import { renderXlsx } from "./render/xlsx";
import { parseRunQuery, type ParamIssue, type ResolvedParams } from "./params";
import { getReport, type RegisteredReport, type ReportCompany } from "./registry";
import { runReport } from "./run";
import "./definitions";

export async function loadReportCompany(companyId: string): Promise<ReportCompany | null> {
  const { rows } = await pool.query(
    `SELECT id, name, base_currency, fiscal_year_start_month, trn_vat_number, emirate
       FROM companies WHERE id = $1 AND deleted_at IS NULL`,
    [companyId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    name: String(r.name),
    baseCurrency: String(r.base_currency ?? "AED"),
    fiscalYearStartMonth: Number(r.fiscal_year_start_month ?? 1) || 1,
    trn: r.trn_vat_number ?? null,
    emirate: r.emirate ?? null,
  };
}

export type Prepared =
  | { ok: true; report: RegisteredReport; company: ReportCompany; params: ResolvedParams }
  | { ok: false; issue: ParamIssue };

export async function prepareReportRun(
  companyId: string,
  reportId: string,
  query: Record<string, unknown>,
  now: Date = new Date()
): Promise<Prepared> {
  const report = getReport(reportId);
  if (!report) return { ok: false, issue: { status: 404, code: "REPORT_NOT_FOUND", message: "Unknown report." } };
  const company = await loadReportCompany(companyId);
  if (!company) return { ok: false, issue: { status: 404, code: "COMPANY_NOT_FOUND", message: "Company not found." } };
  const parsed = parseRunQuery(
    query,
    {
      kinds: report.params,
      filters: report.filters ?? [],
      noFutureAsOf: report.noFutureAsOf,
      budgetComparison: report.budgetComparison,
    },
    { now, fiscalStartMonth: company.fiscalYearStartMonth }
  );
  if (!parsed.ok) return { ok: false, issue: parsed.issue };
  return { ok: true, report, company, params: parsed.value };
}

export interface RenderedFile {
  buffer: Buffer;
  mime: string;
  fileName: string;
}

/** Turn a full (unpaginated) result into a file. Throws REPORT_TOO_LARGE for a PDF over 5,000 rows. */
export async function renderReportFile(
  result: ReportResult,
  format: "csv" | "xlsx" | "pdf",
  companyName: string,
  lang: Lang
): Promise<RenderedFile> {
  if (format === "pdf" && result.rows.length > PDF_MAX_ROWS) {
    throw new AppError({
      message: `A PDF holds at most ${PDF_MAX_ROWS.toLocaleString("en-US")} rows. Use CSV or XLSX, or narrow the report.`,
      statusCode: 422,
      code: "REPORT_TOO_LARGE",
    });
  }
  const buffer = format === "csv" ? renderCsv(result, lang) : format === "xlsx" ? await renderXlsx(result, lang) : await renderPdf(result, companyName, lang);
  return { buffer, mime: MIME[format], fileName: reportFileName(result, format) };
}

export { runReport };
