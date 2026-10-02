import { apiRequest } from "./queryClient";
import type { DryRunSummary, ImportEntity, ImportJob, ImportOptions, ImportSource, UploadResult } from "./import-wizard";

export interface RowResult {
  rowNumber: number;
  raw: Record<string, unknown>;
  normalized: Record<string, unknown> | null;
  errors: Array<{ field?: string; code: string; message: string }>;
  action: "create" | "skip_duplicate" | "error";
}

export interface OpeningPreviewResponse {
  preview: {
    ok: boolean;
    errors: Array<{ code: string; row?: number; message: string }>;
    warnings: Array<{ code: string; message: string }>;
    totals: {
      debit: number;
      credit: number;
      balancingSide: "credit" | "debit" | "none";
      balancingAmount: number;
      ar: number;
      ap: number;
      openInvoicesTotal: number;
      openBillsTotal: number;
    } | null;
  };
  summary: { asOfDate: string; accounts: number; openInvoices: number; openBills: number; foldedProfitAndLoss: number };
}

export interface OpeningJobs {
  tbJobId: string;
  invoicesJobId?: string;
  billsJobId?: string;
  asOfDate?: string;
}

const base = (companyId: string) => `/api/companies/${companyId}`;

export const importJobsKey = (companyId: string) => ["/api/companies", companyId, "import-jobs"] as const;

export const uploadImport = (companyId: string, body: { source: ImportSource; entity: ImportEntity; filename: string; contentBase64: string }): Promise<UploadResult> =>
  apiRequest("POST", `${base(companyId)}/import-jobs`, body);

export const saveImportMapping = (companyId: string, jobId: string, body: { mapping: Record<string, string>; options: ImportOptions }): Promise<ImportJob> =>
  apiRequest("PUT", `${base(companyId)}/import-jobs/${jobId}/mapping`, body);

export const dryRunImport = (companyId: string, jobId: string): Promise<{ job: ImportJob; summary: DryRunSummary }> =>
  apiRequest("POST", `${base(companyId)}/import-jobs/${jobId}/dry-run`);

export const commitImport = (companyId: string, jobId: string): Promise<{ job: ImportJob; result: { created: number; skippedDuplicates: number; errors: number } }> =>
  apiRequest("POST", `${base(companyId)}/import-jobs/${jobId}/commit`);

export const importRows = (companyId: string, jobId: string, status: "error" | "duplicate", perPage = 50): Promise<RowResult[]> =>
  apiRequest("GET", `${base(companyId)}/import-jobs/${jobId}/rows?status=${status}&perPage=${perPage}`);

export const previewOpening = (companyId: string, body: OpeningJobs): Promise<OpeningPreviewResponse> =>
  apiRequest("POST", `${base(companyId)}/import-opening`, body);

export const commitOpening = (companyId: string, body: OpeningJobs): Promise<{ result: unknown; asOfDate: string; jobs: string[] }> =>
  apiRequest("POST", `${base(companyId)}/import-opening?commit=1`, body);
