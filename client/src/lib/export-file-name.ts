import { translateNow } from "@/lib/i18n";
import { catalogTextNow } from "@/lib/reportCatalogText";

/** Characters that are reserved in Windows/macOS/Linux file names (and control characters). */
// eslint-disable-next-line no-control-regex
const RESERVED = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** Makes a report name safe to use as a file or spreadsheet name: reserved characters become "-". */
export function safeExportFileName(name: string): string {
  const cleaned = name.replace(RESERVED, "-").replace(/\s+/g, " ").trim();
  return cleaned || "report";
}

const CATALOG_IDS = {
  "ar-aging": "A/R Aging",
  "ap-aging": "A/P Aging",
  "invoice-status": "Invoice Status",
} as const;

export type ExportNameReport = keyof typeof CATALOG_IDS | "balance-reports";

/** Locale-aware, filesystem-safe base name for a report export (the catalog label in the current language). */
export function reportExportBaseName(report: ExportNameReport): string {
  const label =
    report === "balance-reports"
      ? translateNow("reportCenter.balanceReportsFileName")
      : catalogTextNow("report", report, "name", CATALOG_IDS[report]);
  return safeExportFileName(label);
}
