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
import { formatMessage, t, useI18n } from "./i18n";

type RawIssue = z.core.$ZodRawIssue;
type Dict = Record<string, string | undefined>;

const KEY_PATTERN = /^(?:forms|components)\.[A-Za-z0-9_.]+$/;

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
export function localizeServerIssue(message: string): string {
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

/**
 * Arabic text for a failed API response, or undefined when the language is English or the body
 * has no code we know (callers then keep the server's own message). Validation errors list each
 * field name with a localised reason; other known codes use `forms.serverErrors.<CODE>`.
 */
export function localizeApiError(body: Record<string, unknown> | undefined): string | undefined {
  const guard = localizeLedgerGuard(body);
  if (guard) return guard;
  if (useI18n.getState().locale !== "ar" || !body) return undefined;
  const code = typeof body.code === "string" ? body.code : undefined;
  const fields = body.fields;
  if (code === "VALIDATION_ERROR" || (fields && typeof fields === "object")) {
    const parts: string[] = [];
    if (fields && typeof fields === "object") {
      for (const [name, msgs] of Object.entries(fields as Record<string, unknown>)) {
        const first = Array.isArray(msgs) ? String(msgs[0] ?? "") : String(msgs ?? "");
        const reason = localizeServerIssue(first);
        parts.push(name === "_root" ? reason : `${name}: ${reason}`);
      }
    }
    return parts.length ? v("serverFields", { fields: parts.join("؛ ") }) : v("serverGeneric");
  }
  if (code) {
    const key = `forms.serverErrors.${code}`;
    if (dict("ar")[key]) return dict("ar")[key];
  }
  return undefined;
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
  if (code === "CONTROL_ACCOUNT_MANUAL_POSTING") {
    const parts = [tr("forms.serverErrors.CONTROL_ACCOUNT_MANUAL_POSTING")];
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
    return dict("en")[key] ? tr(key) : tr("forms.serverErrors.SUBLEDGER_ENTRY");
  }
  if (code === "INVOICE_BILLS_ASSET_DISPOSAL" || code === "VAT_AMENDMENT_NOTHING_TO_SETTLE") {
    return tr(`forms.serverErrors.${code}`);
  }
  return undefined;
}
