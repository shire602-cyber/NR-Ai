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
  return renderServerMessage(message, anomaly.description, t, locale, {
    param: (name, value) =>
      (name === "merchant" || name === "vendor") && value === "Unknown"
        ? t["firmOps.unknownMerchant"]
        : undefined,
  });
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
