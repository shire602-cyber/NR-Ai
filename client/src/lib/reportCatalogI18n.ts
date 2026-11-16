/**
 * Arabic localization for the report catalog.
 *
 * The English catalog in reportCatalog.ts is the single source of truth for
 * structure, ids, links, personas, automation metadata and English copy and is
 * deliberately NOT modified. Arabic display strings live in
 * client/src/locales/ar-catalog/reportCatalog.json, keyed
 * `reportCatalog.<kind>.<id>.<field>` (kind: report, workspace, suite,
 * shortcut, preset, pack, starter, category). That file is merged into the
 * Arabic translation table by `loadLocale("ar")`, so any component can resolve
 * a label with `catalogText(...)` / `useCatalogText()` from reportCatalogText.ts
 * without importing the overlay itself. English
 * (and any id without an Arabic entry) falls back to the catalog value.
 */
import arCatalog from "../locales/ar-catalog/reportCatalog.json";
import type { CatalogTextKind } from "./reportCatalogText";

const overlay = arCatalog as Record<string, string>;

function pick(kind: CatalogTextKind, field: string): Record<string, string> {
  const prefix = `reportCatalog.${kind}.`;
  const suffix = `.${field}`;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(overlay)) {
    if (key.startsWith(prefix) && key.endsWith(suffix)) {
      out[key.slice(prefix.length, key.length - suffix.length)] = value;
    }
  }
  return out;
}

/** Arabic report display names, keyed by report id. */
export const reportNameAr: Record<string, string> = pick("report", "name");

/** Arabic decision questions, keyed by report id. */
export const reportQuestionAr: Record<string, string> = pick("report", "decisionQuestion");

/** Arabic Report Center category labels, keyed by the English category key. */
export const reportCategoryAr: Record<string, string> = {
  "Financial Statements": "البيانات المالية",
  "Sales & Receivables": "المبيعات والذمم المدينة",
  "Purchases & Payables": "المشتريات والذمم الدائنة",
  Payroll: "الرواتب",
  "Accountant & Taxes": "المحاسب والضرائب",
  "Inventory & Assets": "المخزون والأصول",
  "Management & Planning": "الإدارة والتخطيط",
};
