// Report display labels in the reader's language (Step 1 / F2).
//
// The report models keep machine codes (journal source, tax category, status, movement type) and
// a few English sentences because exports and the pack builders read them. The screens show them
// through this module, which reads the catalogs (`reportCenter.code.*`, `reportCenter.text.*`)
// via `translateNow`. The Reports page shell remounts on a locale or catalog change
// (`pages/Reports.tsx`), so the memoised models never show a stale language.
import { formatDate, formatDateRange, formatMonthYear, type DateInput } from "@/lib/format-date";
import { formatMessage, translateNow, useI18n } from "@/lib/i18n";

/** The UI language right now (report models run outside React). */
export function reportLocale(): string {
  return useI18n.getState().locale;
}

/** `date` as "16 Nov 2026" / "16 نوفمبر 2026" ("-" for an empty or invalid value). */
export function reportDate(value: DateInput): string {
  return formatDate(value, reportLocale()) || "-";
}

/** A period as "1–16 Nov 2026" / "1–16 نوفمبر 2026". */
export function reportDateRange(from: DateInput, to: DateInput): string {
  return formatDateRange(from, to, reportLocale());
}

/** "November 2026" / "نوفمبر 2026". */
export function reportMonthYear(value: DateInput): string {
  return formatMonthYear(value, reportLocale());
}

const normCode = (code: string) =>
  code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const humanise = (code: string) => {
  const spaced = code.replace(/[._-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : code;
};

/**
 * Label of a machine code or stored English word: a journal source (`bill_payment`, "Manual / no
 * source"), a tax category (`zero_rated`), a status (`calculated`), a movement type
 * (`stock count`), an account type (`income`). Unknown codes read as spaced words.
 */
export function reportCodeLabel(code: string | null | undefined): string {
  if (!code) return "-";
  const norm = normCode(code);
  return translateNow(`reportCenter.code.${norm}`) !== `reportCenter.code.${norm}`
    ? translateNow(`reportCenter.code.${norm}`)
    : translateNow(`common.status.${norm}`) !== `common.status.${norm}`
      ? translateNow(`common.status.${norm}`)
      : humanise(code);
}

/**
 * A fixed report sentence in the reader's language: catalog key `reportCenter.text.<id>`, the
 * English default when the catalog has not loaded (unit tests, first paint). `{name}` and ICU
 * plural placeholders take `values`.
 */
export function reportText(
  id: string,
  english: string,
  values?: Record<string, string | number>
): string {
  const full = `reportCenter.text.${id}`;
  const template = translateNow(full);
  return formatMessage(template === full ? english : template, values ?? {});
}
