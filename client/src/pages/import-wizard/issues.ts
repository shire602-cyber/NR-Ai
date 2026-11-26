/**
 * Import issue codes (server/services/migration-import): which recovery step each error calls
 * for, and the catalog copy of each issue. Validation codes carry a `V_` prefix.
 */
import { formatMessage, type Locale } from "@/lib/i18n";
import type { Issue, Job } from "../ImportWizard";

type Catalog = Record<string, string>;

/** Recovery step -> the error codes it resolves. Catalog key: `importWizard.fix<Step>`. */
const FIX_STEPS: Record<string, string[]> = {
  Csv: [
    "COLUMN_MISSING",
    "CODE_REQUIRED",
    "NAME_REQUIRED",
    "UNKNOWN_ACCOUNT_TYPE",
    "INVALID_AMOUNT",
    "NUMBER_REQUIRED",
    "INVALID_DATE",
    "CONTACT_REQUIRED",
    "INVALID_TOTAL",
    "DUE_EXCEEDS_TOTAL",
    "INVALID_CURRENCY",
    "INVALID_EXCHANGE_RATE",
    "V_DUPLICATE_CODE",
    "V_DUPLICATE_NUMBER",
    "V_AFTER_CUT_OVER",
    "V_UNBALANCED",
    "V_AR_CONTROL_MISMATCH",
    "V_AP_CONTROL_MISMATCH",
    "V_CONTROL_TOTAL_MISMATCH",
    "V_VAT_IN_OPENING",
    "V_GRNI_IN_OPENING",
    "V_PAYROLL_PAYABLE_IN_OPENING",
  ],
  CutOver: ["CUT_OVER_REQUIRED"],
  CutOverFuture: ["V_CUT_OVER_IN_FUTURE"],
  CutOverMismatch: ["V_CUT_OVER_MISMATCH"],
  DocumentsMode: [
    "V_DOCUMENTS_ALREADY_IMPORTED",
    "V_AR_WITHOUT_DOCUMENTS",
    "V_AP_WITHOUT_DOCUMENTS",
  ],
  AlreadyImported: ["V_OPENING_ALREADY_IMPORTED", "V_CONTROL_IN_OPENING_BALANCE"],
  Chart: ["V_UNKNOWN_ACCOUNT", "V_ACCOUNT_INACTIVE", "V_CONTROL_ACCOUNT_MISSING"],
  ExchangeRate: ["V_NO_EXCHANGE_RATE"],
  Gratuity: ["V_GRATUITY_WITHOUT_EMPLOYEES"],
  Assets: ["V_PPE_REGISTER_MISMATCH", "V_PPE_WITHOUT_REGISTER"],
  Stock: ["V_INVENTORY_WITHOUT_STOCK"],
};

const STATUSES = ["previewed", "validated", "committed", "failed", "committing"];

/** Catalog label of a job status; a status the client does not know is shown as sent. */
export function statusLabel(status: string, t: Catalog): string {
  return STATUSES.includes(status) ? t[`importWizard.status.${status}`] : status;
}

/** The file really holds no data (a missing column also yields zero rows, with data present). */
export function hasNoData(job: Job): boolean {
  return job.issues.some((i) => i.code === "NO_ROWS") && !(Number(job.summary.detectedRows) > 0);
}

/** Catalog keys of the recovery steps for the job's errors, without repeats. */
export function fixStepKeys(job: Job): string[] {
  const errors = job.issues.filter((i) => i.level === "error");
  const steps = errors.map((issue) => {
    if (issue.code === "NO_ROWS") return hasNoData(job) ? "Csv" : "NoUsableRows";
    return Object.keys(FIX_STEPS).find((s) => FIX_STEPS[s].includes(issue.code)) ?? "Other";
  });
  return [...new Set(steps)].map((s) => `importWizard.fix${s}`);
}

/**
 * The few server message details the Arabic copy keeps, as named groups: a missing column's field
 * and headers, account codes and the cut-over date. Other copy under `importWizard.issue.<code>`
 * is fixed; this stays small for the wizard's bundle budget.
 */
const DETAILS =
  /"(?<field>.*?)"\. Headers seen: (?<headers>.*)|^(?:Account|Code|Control accounts?) (?<code>.*?) (?:is |already |appears |cannot)|date (?<date>\S+)$/s;

/** Keep codes, amounts and file text in their own direction inside an Arabic sentence. */
const isolate = (value: string) => `⁨${value}⁩`;

/**
 * English shows the server's message. Arabic uses the catalog; an unknown code, or a message that
 * no longer yields an expected detail, falls back to a sentence naming the code.
 * A NO_ROWS issue on a file with detected data rows (`detectedRows` > 0) uses the catalog copy in
 * both locales, since the server's "no data rows" text would contradict the file.
 */
export function issueText(issue: Issue, locale: Locale, t: Catalog, detectedRows = 0): string {
  if (locale !== "ar") {
    const notUsable = issue.code === "NO_ROWS" && detectedRows > 0;
    return (notUsable && t["importWizard.issue.NO_ROWS"]) || issue.message;
  }
  const template = t[`importWizard.issue.${issue.code}`];
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(DETAILS.exec(issue.message)?.groups ?? {})) {
    if (value !== undefined) values[name] = isolate(value);
  }
  if (!template || template.match(/\w+(?=\})/g)?.some((name) => !(name in values))) {
    return formatMessage(t["importWizard.issueUnknown"], { code: isolate(issue.code) });
  }
  return formatMessage(template, values);
}
