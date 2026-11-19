// i18n-ignore-file: workbook cell text for downloads; Arabic strings live in `export-ar.ts`.
// Report workbooks follow the language of the user who exports (Step 1 / E1): sheet names,
// column headings, metric labels, status/type codes and dates come out in Arabic with a
// right-to-left sheet for an Arabic user. The builders in `export.ts` write English labels (one
// source, also used by Google Sheets and the report pack); this module localises the result just
// before it leaves the browser. User data (names, memos, numbers, amounts, codes such as account
// numbers) is never touched: only exact label matches, catalog codes and machine dates change.
import { formatEmbeddedDates } from "./format-date";
import { t as catalogs, useI18n } from "./i18n";
import type { ExportData } from "./export";

export type ExportLocale = "en" | "ar";

/** The language of the signed-in user right now (the app locale). */
export function currentExportLocale(): ExportLocale {
  return useI18n.getState().locale === "ar" ? "ar" : "en";
}

/** Excel refuses sheet names longer than 31 characters. */
const SHEET_NAME_MAX = 31;

/** Columns whose cell text is a machine code or stored English word (`paid`, `equity`, `asset`). */
const CODE_COLUMNS = new Set([
  "type",
  "accountType",
  "status",
  "source",
  "risk",
  "method",
  "recommendedLevel",
  "companyType",
  "supplyTypes",
  "currentStatus",
]);

/** Fixed English cells that carry a number: "3/5 active". */
const PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/^(\d+)\/(\d+) active$/, (m) => `${m[1]}/${m[2]} نشط`],
];

const AED_SUFFIX = " (AED)";
const AED_SUFFIX_AR = " (درهم)";

const normCode = (code: string) =>
  code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Arabic label of a machine code from the app catalogs; null when the catalog has none. */
function catalogCode(code: string): string | null {
  const norm = normCode(code);
  if (!norm) return null;
  const ar = catalogs.ar;
  return ar[`reportCenter.code.${norm}`] ?? ar[`common.status.${norm}`] ?? null;
}

function translateLabel(text: string, dict: Record<string, string>): string | null {
  const direct = dict[text];
  if (direct) return direct;
  if (text.endsWith(AED_SUFFIX)) {
    const base = dict[text.slice(0, -AED_SUFFIX.length)];
    if (base) return `${base}${AED_SUFFIX_AR}`;
  }
  return null;
}

function translateCell(value: unknown, key: string, dict: Record<string, string>): unknown {
  if (typeof value !== "string" || !value) return value;
  const label = translateLabel(value, dict);
  if (label) return label;
  for (const [pattern, render] of PATTERNS) {
    const m = pattern.exec(value);
    if (m) return render(m);
  }
  if (CODE_COLUMNS.has(key) && /^[A-Za-z0-9_ ./,-]+$/.test(value)) {
    const parts = value.split(", ");
    const mapped = parts.map((part) => translateLabel(part, dict) ?? catalogCode(part) ?? part);
    if (mapped.some((part, i) => part !== parts[i])) return mapped.join("، ");
  }
  // Machine dates inside text ("2026-11", "2026-11-01 to 2026-11-30") read as Arabic dates.
  return formatEmbeddedDates(value, "ar");
}

/**
 * Localise workbook sheets for `locale`. English sheets pass through unchanged; Arabic sheets get
 * Arabic names, headings, labels and codes, plus `rtl: true`. `dict` is the English → Arabic
 * label table (`EXPORT_AR`).
 */
export function localizeExportSheetsWith(
  sheets: ExportData[],
  locale: ExportLocale,
  dict: Record<string, string>
): ExportData[] {
  if (locale !== "ar") return sheets;
  return sheets.map((sheet) => ({
    ...sheet,
    rtl: true,
    sheetName: sheet.sheetName
      ? (translateLabel(sheet.sheetName, dict) ?? sheet.sheetName).slice(0, SHEET_NAME_MAX)
      : sheet.sheetName,
    columns: sheet.columns.map((column) => ({
      ...column,
      header: translateLabel(column.header, dict) ?? column.header,
    })),
    rows: sheet.rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) out[key] = translateCell(value, key, dict);
      return out;
    }),
  }));
}

/** `localizeExportSheetsWith` for the current user's language; loads the Arabic table on demand. */
export async function localizeExportSheets(
  sheets: ExportData[],
  locale: ExportLocale = currentExportLocale()
): Promise<ExportData[]> {
  if (locale !== "ar") return sheets;
  const { EXPORT_AR } = await import("./export-ar");
  return localizeExportSheetsWith(sheets, locale, EXPORT_AR);
}
