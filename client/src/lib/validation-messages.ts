/**
 * F11: localised form validation messages.
 *
 * - Client schemas carry catalog KEYS as their custom messages (`.min(1, "forms.errors.nameRequired")`);
 *   `localizeMessage` resolves them against the active language at render/resolve time.
 * - `zodErrorMap` is passed per parse (see lib/zod-resolver.ts). It localises zod's default issue
 *   messages in Arabic and returns undefined in English so the shared English defaults
 *   (shared/zod-config.ts, which the server also uses) stay exactly as they were.
 * - `localizeServerValidation` turns the server's 400 VALIDATION_ERROR body (English zod messages,
 *   dotted field paths) into Arabic text that keeps the field names.
 */
import type { z } from "zod";
import { bankStatementCopy } from "@shared/bank-statement-copy";
import { formatMessage, loadNamespaces, t, useI18n } from "./i18n";

type RawIssue = z.core.$ZodRawIssue;
type Dict = Record<string, string | undefined>;

const KEY_PATTERN = /^(?:forms|components)\.[A-Za-z0-9_.]+$/;

/**
 * E3 (J2-r3): namespaces this module reads besides `components` (always loaded). A component on a
 * signed-out public route that shows these messages declares them: `useTranslation(VALIDATION_NAMESPACES)`.
 */
export const VALIDATION_NAMESPACES = ["forms"] as const;

/**
 * G3: the per-code server error copy (`serverErrors.<CODE>`) and the form field labels live in the
 * `serverErrors` catalog, which is loaded where API errors are turned into text (queryClient,
 * failed downloads); the sign-in forms only need `forms`.
 */
export const SERVER_ERROR_NAMESPACES = [...VALIDATION_NAMESPACES, "serverErrors"] as const;

function dict(locale: "en" | "ar"): Dict {
  return t[locale] as unknown as Dict;
}

/** Catalog lookup for the active language (English fallback), with `{name}` interpolation. */
export function tr(key: string, vars?: Record<string, string | number>): string {
  const { locale } = useI18n.getState();
  const text = dict(locale)[key] ?? dict("en")[key] ?? key;
  return vars ? formatMessage(text, vars) : text;
}

/** English messages of schemas shared with the server (shared/schema-values.ts) -> catalog keys. */
const SHARED_MESSAGE_KEYS: Record<string, string> = {
  "Company name must be at least 2 characters": "forms.errors.companyNameMin2",
  "TRN must be exactly 15 digits": "forms.errors.trn15Digits",
  "Invalid email address": "forms.errors.emailAddressInvalid",
  "Logo must be 1 MB or smaller": "forms.errors.logoTooLarge",
  "Logo must be an https:// URL or a PNG/JPEG/GIF/WebP image": "forms.errors.logoFormat",
};

/**
 * Resolve a catalog key used as a schema message; English messages of shared (server) schemas
 * are mapped to their catalog key in Arabic; any other text is returned unchanged.
 */
export function localizeMessage(message: string): string {
  if (KEY_PATTERN.test(message)) return tr(message);
  const shared = SHARED_MESSAGE_KEYS[message];
  if (shared && useI18n.getState().locale === "ar") return tr(shared);
  return message;
}

/** Recursively localise `message` on a react-hook-form error tree (mutates and returns it). */
export function localizeFieldErrors<T>(errors: T): T {
  const seen = new Set<unknown>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const rec = node as Record<string, unknown>;
    // `ref` points at DOM nodes; never descend into it.
    if (typeof rec.message === "string") rec.message = localizeMessage(rec.message);
    for (const [k, v] of Object.entries(rec)) if (k !== "ref" && k !== "types") walk(v);
  };
  walk(errors);
  return errors;
}

const v = (key: string, vars?: Record<string, string | number>) =>
  tr(`components.validation.${key}`, vars);

/** Arabic replacements for zod's default issue messages (undefined = keep the English default). */
export function zodErrorMap(iss: RawIssue): string | undefined {
  if (useI18n.getState().locale !== "ar") return undefined;
  switch (iss.code) {
    case "invalid_type":
      if (iss.input === undefined || iss.input === null) return v("required");
      if (iss.expected === "number" || iss.expected === "int" || iss.expected === "bigint")
        return v("invalidNumber");
      if (iss.expected === "date") return v("invalidDate");
      return v("invalid");
    case "invalid_value":
      return iss.input === undefined ? v("required") : v("invalidChoice");
    case "invalid_format":
      switch (iss.format) {
        case "email":
          return v("emailInvalid");
        case "url":
          return v("invalidUrl");
        case "guid":
        case "uuid":
          return v("invalidChoice");
        case "regex":
          return v("invalidFormat");
        default:
          return v("invalid");
      }
    case "too_small": {
      const n = Number(iss.minimum);
      if (iss.origin === "string")
        return iss.exact
          ? v("stringExact", { n })
          : n <= 1 && iss.inclusive
            ? v("required")
            : v("stringMin", { n });
      if (iss.origin === "array" || iss.origin === "set")
        return n <= 1 && iss.inclusive ? v("required") : v("arrayMin", { n });
      if (iss.origin === "date") return v("invalidDate");
      return iss.inclusive ? v("numberMin", { n }) : v("numberGt", { n });
    }
    case "too_big": {
      const n = Number(iss.maximum);
      if (iss.origin === "string")
        return iss.exact ? v("stringExact", { n }) : v("stringMax", { n });
      if (iss.origin === "array" || iss.origin === "set") return v("arrayMax", { n });
      if (iss.origin === "date") return v("invalidDate");
      return iss.inclusive ? v("numberMax", { n }) : v("numberLt", { n });
    }
    case "not_multiple_of":
      return v("notMultiple", { n: Number(iss.divisor) });
    case "unrecognized_keys":
      return v("unknownField");
    default:
      return v("invalid");
  }
}

/**
 * Translate one server (English, zod 3 style) field message. Only used in Arabic; unknown
 * messages fall back to the generic "invalid value" text, never to raw English.
 */
/** Catalog key of a server field message ("TRN must start with 100" -> serverErrors.issue.trn_must_start_with_100). */
export function issueSlug(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 70);
}

export function localizeServerIssue(message: string): string {
  if (message === bankStatementCopy.en) return bankStatementCopy.ar;
  const issue = dict("ar")[`serverErrors.issue.${issueSlug(message)}`];
  if (issue) return issue;
  const shared = SHARED_MESSAGE_KEYS[message];
  if (shared) return tr(shared);
  if (message === "Required") return v("required");
  if (message === "Unknown field") return v("unknownField");
  if (/^Invalid (email|uuid)/i.test(message))
    return /email/i.test(message) ? v("emailInvalid") : v("invalidChoice");
  let m = /^String must contain (?:at least|over) (\d+)/.exec(message);
  if (m) return Number(m[1]) <= 1 ? v("required") : v("stringMin", { n: Number(m[1]) });
  m = /^String must contain (?:at most|under) (\d+)/.exec(message);
  if (m) return v("stringMax", { n: Number(m[1]) });
  m = /^Number must be greater than or equal to (-?[\d.]+)/.exec(message);
  if (m) return v("numberMin", { n: m[1] });
  m = /^Number must be greater than (-?[\d.]+)/.exec(message);
  if (m) return v("numberGt", { n: m[1] });
  m = /^Number must be less than or equal to (-?[\d.]+)/.exec(message);
  if (m) return v("numberMax", { n: m[1] });
  m = /^Number must be less than (-?[\d.]+)/.exec(message);
  if (m) return v("numberLt", { n: m[1] });
  if (/^Expected number/.test(message)) return v("invalidNumber");
  if (/^Array must contain at least (\d+)/.test(message))
    return v("arrayMin", { n: Number(/(\d+)/.exec(message)?.[1]) });
  return v("invalid");
}

/** Same wording as the server's `DomainError` default: "COST_CENTER_INACTIVE" -> "Cost center inactive". */
function humanizeCode(code: string): string {
  const words = code.toLowerCase().replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

/** Catalog sentence for an error code in a language: `forms.serverErrors.<CODE>` or `serverErrors.<CODE>`. */
export function serverErrorCopy(locale: "en" | "ar", code: string): string | undefined {
  const d = dict(locale);
  return d[`forms.serverErrors.${code}`] ?? d[`serverErrors.${code}`];
}

/** "dueDate" -> "Due date" (English fallback for a field without a catalog label). */
function humanizeField(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

/**
 * The label of a validation field path ("lines.0.amount" -> "Lines - #1 - Amount") in the active
 * language. A field without a label is humanised in English and named "Field" in Arabic: the raw
 * id is never shown.
 */
export function fieldLabel(path: string): string {
  const { locale } = useI18n.getState();
  const d = dict(locale);
  const out: string[] = [];
  for (const part of path.split(".")) {
    if (/^\d+$/.test(part)) {
      out.push(`#${Number(part) + 1}`);
      continue;
    }
    const label =
      d[`serverErrors.field.${part}`] ??
      (locale === "en" ? humanizeField(part) : d["serverErrors.field._unknown"]);
    if (label && out[out.length - 1] !== label) out.push(label);
  }
  return out.join(" - ") || (d["serverErrors.field._unknown"] ?? "Field");
}

function validationText(body: Record<string, unknown>, locale: "en" | "ar"): string | undefined {
  const code = typeof body.code === "string" ? body.code : undefined;
  const fields = body.fields;
  const hasFields = !!fields && typeof fields === "object";
  if (code !== "VALIDATION_ERROR" && !hasFields) return undefined;
  const parts: string[] = [];
  if (hasFields) {
    for (const [name, msgs] of Object.entries(fields as Record<string, unknown>)) {
      const first = Array.isArray(msgs) ? String(msgs[0] ?? "") : String(msgs ?? "");
      const reason = locale === "ar" ? localizeServerIssue(first) : first;
      parts.push(name === "_root" ? reason : `${fieldLabel(name)}: ${reason}`);
    }
  }
  return parts.length
    ? v("serverFields", { fields: parts.join(locale === "ar" ? "؛ " : "; ") })
    : v("serverGeneric");
}

/**
 * Text for a failed API response in the active language, or undefined when the server's own
 * message should be kept. Validation errors list each field by its form label with a reason;
 * a coded error uses its catalog copy (Arabic always; English when the server only sent the
 * generic words of the code). Field ids and English server text never reach an Arabic user.
 */
export function localizeApiError(body: Record<string, unknown> | undefined): string | undefined {
  const guard = localizeLedgerGuard(body);
  if (guard) return guard;
  if (!body) return undefined;
  const { locale } = useI18n.getState();
  const code = typeof body.code === "string" ? body.code : undefined;
  if (locale !== "ar") {
    if (!code) return undefined;
    const hasFields = !!body.fields && typeof body.fields === "object";
    // A specific server sentence ("Invoice must have lines") beats the field list.
    if (hasFields || (code === "VALIDATION_ERROR" && body.message === "Validation error")) {
      return validationText(body, "en");
    }
    // A DomainError sent without its own sentence only carries "Receipt not found"-style words.
    if (body.message === humanizeCode(code)) return serverErrorCopy("en", code);
    return undefined;
  }
  // B14: throttles and lockouts name their sentence by catalog key (`messageKey`).
  const messageKey = typeof body.messageKey === "string" ? body.messageKey : undefined;
  if (messageKey && KEY_PATTERN.test(messageKey) && dict("ar")[messageKey]) {
    return dict("ar")[messageKey];
  }
  const validation = validationText(body, "ar");
  if (validation) return validation;
  return code ? serverErrorCopy("ar", code) : undefined;
}

const HAS_ARABIC = /[\u0600-\u06FF]/;

/**
 * Arabic sentence for a failed response whose code has no catalog copy: never the server's raw
 * English (which may even name a field id). Chosen by HTTP status; undefined in English, and when
 * the server's own message is already Arabic.
 */
export function localizeApiErrorByStatus(status: number, message: string): string | undefined {
  if (useI18n.getState().locale !== "ar") return undefined;
  if (HAS_ARABIC.test(message)) return undefined;
  const bucket =
    status >= 500
      ? "5xx"
      : [400, 401, 403, 404, 409, 413, 422, 429].includes(status)
        ? String(status)
        : "other";
  return tr(`forms.serverErrors.status.${bucket}`);
}

/**
 * The text of a failed `fetch` (file downloads, plain fetch calls): catalog copy for the code in
 * the active language, else a sentence for the status in Arabic, else the server's message.
 */
export async function failedResponseMessage(
  status: number,
  body: unknown,
  fallback: string
): Promise<string> {
  await loadNamespaces(useI18n.getState().locale, SERVER_ERROR_NAMESPACES).catch(() => undefined);
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
  return localizeApiError(record) ?? localizeApiErrorByStatus(status, fallback) ?? fallback;
}

/**
 * Sentence for a failed response read with plain `fetch` (sign-in, password reset), in the
 * active language (B14): the catalog entry the server named in `messageKey` (rate limits and
 * lockouts), else a localised code, else the server's message, else `fallback`.
 */
export function serverErrorMessage(body: unknown, fallback: string): string {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
  const key = typeof record?.messageKey === "string" ? record.messageKey : undefined;
  if (key && KEY_PATTERN.test(key) && dict("en")[key]) return tr(key);
  const localized = localizeApiError(record);
  if (localized) return localized;
  return typeof record?.message === "string" && record.message ? record.message : fallback;
}

const CONTROL_LEDGERS = new Set(["receivables", "payables", "inventory", "vat", "grni", "payroll"]);

/**
 * Ledger-kernel refusals (B1 / B2) in both languages, from the code and its details: every
 * entry point (bank-line create entry, editors, journal reverse / void, VAT settlement) shows
 * the same sentence and, for a control account, the sub-ledger flow that records it instead.
 * The server's English text names internal endpoints, so it is not shown for these codes.
 */
export function localizeLedgerGuard(body: Record<string, unknown> | undefined): string | undefined {
  const code = typeof body?.code === "string" ? body.code : undefined;
  if (!code) return undefined;
  const details = (body?.details ?? {}) as Record<string, unknown>;
  if (code === "CONTROL_ACCOUNT_MANUAL_POSTING" || code === "CONTROL_ACCOUNT_NOT_ALLOWED") {
    const parts = [tr(`forms.serverErrors.${code}`)];
    const accounts = Array.isArray(details.accounts) ? details.accounts : [];
    const codes = accounts
      .map((a) => (a && typeof a === "object" ? (a as { code?: unknown }).code : undefined))
      .filter((c): c is string => typeof c === "string" && c.length > 0);
    if (codes.length)
      parts.push(tr("forms.serverErrors.controlAccounts", { codes: codes.join(", ") }));
    const paths = Array.isArray(details.paths) ? details.paths : [];
    for (const p of paths) {
      const ledger = p && typeof p === "object" ? (p as { ledger?: unknown }).ledger : undefined;
      if (typeof ledger === "string" && CONTROL_LEDGERS.has(ledger))
        parts.push(tr(`forms.serverErrors.controlPath.${ledger}`));
    }
    return parts.join(" ");
  }
  if (code === "SUBLEDGER_ENTRY") {
    const doc = typeof details.document === "string" ? details.document : "";
    const key = `forms.serverErrors.SUBLEDGER_ENTRY.${doc}`;
    return dict(useI18n.getState().locale)[key]
      ? tr(key)
      : tr("forms.serverErrors.SUBLEDGER_ENTRY");
  }
  if (code === "INVOICE_BILLS_ASSET_DISPOSAL" || code === "VAT_AMENDMENT_NOTHING_TO_SETTLE") {
    return tr(`forms.serverErrors.${code}`);
  }
  return undefined;
}

/**
 * A warning a server importer attached to a parsed file ({ code, message }): in Arabic the
 * catalog sentence for its code (the server text is English and may carry counts), else the
 * server's own message.
 */
export function localizeServerWarning(w: { code: string; message: string }): string {
  if (useI18n.getState().locale !== "ar") return w.message;
  return serverErrorCopy("ar", w.code) ?? tr("forms.serverErrors.status.other");
}
