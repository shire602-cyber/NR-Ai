// Client side of the server report engine (Phase 8 D4): call the run route and save its files. The query itself is
// built in report-query.ts (pure).

import type { ReportFileFormat, ReportParamKind, ReportResult } from "@shared/report-result";
import { downloadAuthenticatedFile } from "./file-upload";
import { apiRequest } from "./queryClient";
import { buildRunQuery, reportRunPath, type ReportViewState } from "./report-query";

export * from "./report-query";

export function fetchReportPage(
  companyId: string,
  reportId: string,
  query: string
): Promise<ReportResult> {
  return apiRequest("GET", reportRunPath(companyId, reportId, query));
}

const FILE_EXTENSION: Record<ReportFileFormat, string> = { pdf: "pdf", csv: "csv", xlsx: "xlsx" };

/** Save the report as a file through the run route (the server renders it; nothing is computed in the browser). */
export function downloadReportFile(
  companyId: string,
  reportId: string,
  kinds: readonly ReportParamKind[],
  state: ReportViewState,
  format: ReportFileFormat,
  lang: "en" | "ar"
): Promise<void> {
  const query = buildRunQuery(reportId, kinds, state, { lang, format });
  return downloadAuthenticatedFile(
    reportRunPath(companyId, reportId, query),
    `${reportId}.${FILE_EXTENSION[format]}`
  );
}
