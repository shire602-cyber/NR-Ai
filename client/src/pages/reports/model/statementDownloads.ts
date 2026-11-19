// Server-rendered statement downloads (PDF / Excel) and their language (Step 1 / E3).
// `GET /api/companies/:id/reports/statements/:kind?format=pdf|xlsx&lang=ar|en`: the document is
// written in the requested language (Arabic-first titles, account names `nameAr`, RTL sheet) and
// defaults to the reader's UI language. Figures are the same either way.

export type StatementLang = "ar" | "en";

export interface PdfLanguageOption {
  lang: StatementLang;
  /** Catalog key of the menu label: "PDF (العربية)" / "PDF (English)". */
  labelKey: string;
}

/** The PDF languages on offer, the reader's own first. */
export function pdfLanguageOptions(locale: string): PdfLanguageOption[] {
  const options: PdfLanguageOption[] = [
    { lang: "ar", labelKey: "reportCenter.downloadPdfArabic" },
    { lang: "en", labelKey: "reportCenter.downloadPdfEnglish" },
  ];
  return locale === "ar" ? options : [options[1], options[0]];
}

/** `lang` query value for the reader's UI language. */
export function statementLang(locale: string): StatementLang {
  return locale === "ar" ? "ar" : "en";
}

/** Download URL path for a statement. `range` is `&from=..&to=..` (or empty). */
export function statementDownloadPath(
  base: string,
  format: "pdf" | "xlsx",
  lang: StatementLang,
  range = ""
): string {
  return `${base}?format=${format}&lang=${lang}${range}`;
}
