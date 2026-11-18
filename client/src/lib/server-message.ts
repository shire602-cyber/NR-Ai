// Render server-written sentences (anomaly checks, value programmes, categoriser reasons) from the
// catalogs. The API keeps the English sentence for compatibility and adds the same sentence as
// `{ key, params }`; rows stored before that are mapped back with the shared `describe*` parsers.
import {
  describeAnomalyText,
  describeCategorisationReason,
  describeValueOpsText,
  renderDescriptor,
  type CopyDescriptor,
} from "@shared/server-copy";
import { formatDate } from "@/lib/format-date";

type Catalog = Record<string, string | undefined>;

const DATE_PARAMS = new Set(["date", "from", "to"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** Dates become `17 Nov 2026` / `17 نوفمبر 2026`; every other param is shown as given. */
function localizeParams(
  params: Record<string, string>,
  locale: string,
  extra?: (name: string, value: string) => string | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) {
    if (DATE_PARAMS.has(name) && ISO_DAY.test(value)) {
      out[name] = formatDate(value.slice(0, 10), locale);
      continue;
    }
    out[name] = extra?.(name, value) ?? value;
  }
  return out;
}

export interface ServerMessageOptions {
  /** Translate a param value (a status word, an "Unknown" merchant). */
  param?: (name: string, value: string) => string | undefined;
}

/** A descriptor rendered in the reader's language; the English sentence when a key is missing. */
export function renderServerMessage(
  message: CopyDescriptor | null | undefined,
  fallback: string,
  t: Catalog,
  locale: string,
  options: ServerMessageOptions = {}
): string {
  if (!message) return fallback;
  return renderDescriptor(
    message.key,
    localizeParams(message.params, locale, options.param),
    fallback,
    t
  );
}

/** Anomaly sentence: the key + params the API sent, else the stored English parsed back. */
export function anomalyMessage(
  anomaly: { description: string; message?: CopyDescriptor | null },
  t: Catalog,
  locale: string
): string {
  const message = anomaly.message ?? describeAnomalyText(anomaly.description);
  return withoutRecordIds(
    renderServerMessage(message, anomaly.description, t, locale, {
      param: (name, value) =>
        (name === "merchant" || name === "vendor") && value === "Unknown"
          ? t["firmOps.unknownMerchant"]
          : undefined,
    })
  );
}

const RECORD_ID =
  /\s*(?:with\s+)?(?:ID\s*)?['"‘’]?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"‘’]?/gi;

/**
 * Broken-path sweep: AI-written anomaly text stored before the server fix quotes raw record ids
 * ("Invoice with ID '77cb…'"). They mean nothing to the reader and are left out.
 */
export function withoutRecordIds(text: string): string {
  return text
    .replace(RECORD_ID, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Value-programme sentence (action, review item, audit pack line); unknown text is unchanged. */
export function valueOpsMessage(
  text: string | null | undefined,
  t: Catalog,
  locale: string,
  statusLabel: (value: string) => string = (v) => v
): string {
  if (!text) return "";
  const message = describeValueOpsText(text) ?? describeAnomalyText(text);
  return renderServerMessage(message, text, t, locale, {
    param: (name, value) => (name === "status" ? statusLabel(value) : undefined),
  });
}

/**
 * Reason on a categoriser queue row. Operator notes (provider not configured, provider error)
 * are never shown; a matched-rule sentence is rendered from the catalogs; the model's own text
 * (requested in the company language) is shown as written.
 */
export function categorisationReason(
  row: { ai_reason: string | null; ai_reason_message?: CopyDescriptor | null },
  t: Catalog,
  locale: string
): string | null {
  if (!row.ai_reason) return null;
  const message = row.ai_reason_message ?? describeCategorisationReason(row.ai_reason);
  if (!message) return row.ai_reason;
  if (message.key.startsWith("categorise.operator.")) return null;
  return renderServerMessage(message, row.ai_reason, t, locale);
}

/**
 * Props for free text an AI model wrote (anomaly findings, categorisation reasons). It stays in
 * the language the model wrote it in; in the Arabic UI an English sentence is marked as English
 * (`lang`, `dir`) so screen readers and the layout treat it as such (broken-path sweep).
 */
export function writtenLanguageProps(text: string, locale: string): { lang?: string; dir?: "ltr" } {
  return locale === "ar" && text && !/[\u0600-\u06FF]/.test(text) ? { lang: "en", dir: "ltr" } : {};
}
