/**
 * Keyed, locale-aware lookup for report catalog display strings (R18-02).
 *
 * reportCatalog.ts stays the single source of English labels and ids. Arabic
 * strings live in client/src/locales/ar-catalog/reportCatalog.json under
 * `reportCatalog.<kind>.<id>.<field>` and are merged into the Arabic
 * translation table by `loadLocale("ar")` (lazily, like every other Arabic
 * catalog), so this module carries no strings of its own.
 */
import { useCallback } from "react";
import { useTranslation, type Locale } from "./i18n";

export type CatalogTextKind =
  | "report"
  | "workspace"
  | "suite"
  | "shortcut"
  | "preset"
  | "pack"
  | "starter"
  | "category";

export function catalogTextKey(kind: CatalogTextKind, id: string, field: string): string {
  return `reportCatalog.${kind}.${id}.${field}`;
}

/** Resolve one catalog label; English (or an id without an entry) returns `fallback`. */
export function catalogText(
  table: Record<string, string>,
  locale: Locale,
  kind: CatalogTextKind,
  id: string,
  field: string,
  fallback: string
): string {
  if (locale === "en") return fallback;
  return table[catalogTextKey(kind, id, field)] ?? fallback;
}

/** Hook form: `const ct = useCatalogText(); ct("suite", suite.id, "title", suite.title)`. */
export function useCatalogText() {
  const { t, locale } = useTranslation();
  return useCallback(
    (kind: CatalogTextKind, id: string, field: string, fallback: string) =>
      catalogText(t as Record<string, string>, locale, kind, id, field, fallback),
    [t, locale]
  );
}
