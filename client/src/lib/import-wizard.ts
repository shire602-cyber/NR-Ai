/**
 * Pure helpers for the migration wizard (client side). The server is the
 * source of truth for parsing and validation; these only keep the UI honest:
 * they stop obviously unfinishable steps and guess the date format.
 */

export const IMPORT_SOURCES = ["zoho", "quickbooks", "xero", "generic"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const IMPORT_ENTITIES = ["contacts", "items", "accounts", "opening_tb", "open_invoices", "open_bills"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const OPENING_ENTITIES: readonly ImportEntity[] = ["opening_tb", "open_invoices", "open_bills"];
export const isOpeningEntity = (entity: ImportEntity): boolean => OPENING_ENTITIES.includes(entity);

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = [".csv", ".xlsx"] as const;

export const DATE_FORMATS = ["yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy", "dd-MM-yyyy", "dd.MM.yyyy", "d MMM yyyy"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export const NUMBER_FORMATS = ["us", "eu"] as const;

export interface FieldDef {
  key: string;
  required?: boolean;
  description: string;
}

export interface ImportJob {
  id: string;
  source: ImportSource;
  entity: ImportEntity;
  status: "uploaded" | "mapped" | "validated" | "committing" | "committed" | "failed";
  filename: string;
  mapping: Record<string, string> | null;
  options: ImportOptions | null;
  rowCount: number;
  errorCount: number;
  result: Record<string, unknown> | null;
  createdAt: string;
  committedAt: string | null;
}

export interface ImportOptions {
  dateFormat?: DateFormat;
  numberFormat?: "us" | "eu";
  goLiveDate?: string;
  currency?: string;
  defaultContactType?: "customer" | "vendor" | "both";
  foldProfitAndLoss?: boolean;
}

export interface UploadResult {
  job: ImportJob;
  fields: FieldDef[];
  detectedColumns: string[];
  suggestedMapping: Record<string, string>;
  sampleRows: Array<Record<string, unknown>>;
}

export type UploadProblem = "extension" | "empty" | "tooLarge";

export function validateUpload(filename: string, size: number): UploadProblem | null {
  const lower = filename.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "extension";
  if (size <= 0) return "empty";
  if (size > MAX_IMPORT_BYTES) return "tooLarge";
  return null;
}

/** Base64 of a file without the data: prefix, in chunks so a 5 MB file does not blow the call stack. */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Required fields that have no column yet, mirroring the server's mapping rules. */
export function missingMapping(entity: ImportEntity, fields: readonly FieldDef[], mapping: Record<string, string>): string[] {
  const has = (key: string) => !!mapping[key];
  const missing = fields.filter((f) => f.required && !has(f.key)).map((f) => f.key);
  if (entity === "opening_tb") {
    if (!has("accountCode") && !has("accountName")) missing.push("accountCode");
    if (!has("balance") && !(has("debit") || has("credit"))) missing.push("debit");
  }
  return missing;
}

/** Columns chosen for more than one field (usually a mistake). */
export function duplicateColumns(mapping: Record<string, string>): string[] {
  const seen = new Map<string, number>();
  for (const column of Object.values(mapping)) if (column) seen.set(column, (seen.get(column) ?? 0) + 1);
  return Array.from(seen).filter(([, n]) => n > 1).map(([column]) => column);
}

/** The PUT body: empty choices dropped, options only for what the entity uses. Returns a new object. */
export function buildMappingBody(entity: ImportEntity, mapping: Record<string, string>, options: ImportOptions) {
  const cleaned = Object.fromEntries(Object.entries(mapping).filter(([, column]) => !!column));
  const opts: ImportOptions = {};
  if (options.dateFormat) opts.dateFormat = options.dateFormat;
  if (options.numberFormat) opts.numberFormat = options.numberFormat;
  if (options.currency) opts.currency = options.currency.trim().toUpperCase();
  if (entity === "contacts" && options.defaultContactType) opts.defaultContactType = options.defaultContactType;
  if (isOpeningEntity(entity) && options.goLiveDate) opts.goLiveDate = options.goLiveDate;
  if (entity === "opening_tb" && options.foldProfitAndLoss !== undefined) opts.foldProfitAndLoss = options.foldProfitAndLoss;
  return { mapping: cleaned, options: opts };
}

/**
 * Guess dd/MM vs MM/dd from sample cells: a first part above 12 means day first,
 * a second part above 12 means month first. null when the samples cannot tell
 * (every value could be either), so the UI asks instead of assuming.
 */
export function guessSlashDateFormat(samples: ReadonlyArray<unknown>): "dd/MM/yyyy" | "MM/dd/yyyy" | null {
  let dayFirst = false;
  let monthFirst = false;
  for (const sample of samples) {
    const m = /^\s*(\d{1,2})\/(\d{1,2})\/\d{4}\s*$/.exec(String(sample ?? ""));
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return "dd/MM/yyyy";
  if (monthFirst && !dayFirst) return "MM/dd/yyyy";
  return null;
}

/** Jobs that can be combined into the opening position: validated, clean, per entity. */
export function eligibleOpeningJobs(jobs: readonly ImportJob[] | undefined): Record<"opening_tb" | "open_invoices" | "open_bills", ImportJob[]> {
  const out = { opening_tb: [] as ImportJob[], open_invoices: [] as ImportJob[], open_bills: [] as ImportJob[] };
  for (const job of jobs ?? []) {
    if (job.status !== "validated" || job.errorCount > 0) continue;
    if (job.entity === "opening_tb" || job.entity === "open_invoices" || job.entity === "open_bills") out[job.entity].push(job);
  }
  return out;
}

export interface DryRunSummary {
  rowCount: number;
  toCreate: number;
  duplicates: number;
  errors: number;
  errorSample: Array<{ row: number; errors: Array<{ field?: string; code: string; message: string }> }>;
  created: number;
  totalDebit?: number;
  totalCredit?: number;
  balanced?: boolean;
}

/** Commit is offered when something is left to create (rows with errors are skipped, and the UI says so). */
export function canCommit(summary: DryRunSummary | null): boolean {
  return !!summary && summary.toCreate > 0 && summary.balanced !== false;
}

export type WizardStep = "source" | "entity" | "upload" | "mapping" | "review" | "done";
export const WIZARD_STEPS: readonly WizardStep[] = ["source", "entity", "upload", "mapping", "review", "done"];

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}
