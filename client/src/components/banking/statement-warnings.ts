// The import routes return warnings as English sentences, some prefixed with a code ("AI_EXTRACTED: ...").
// Known codes get a translated sentence; the rest are shown as the server wrote them.

import { messages } from "./StatementReviewGrid.i18n";

const CODE_KEYS = {
  AI_EXTRACTED: "aiExtracted",
  STATEMENT_FILE_NOT_STORED: "fileNotStored",
  PDF_PAGES_NOT_READ: "pagesNotRead",
} as const;

export function warningText(warning: string, locale: string): string {
  const code = /^([A-Z_]+):/.exec(warning)?.[1];
  if (!code || !(code in CODE_KEYS)) return warning;
  const key = CODE_KEYS[code as keyof typeof CODE_KEYS];
  const text = (locale === "ar" ? messages.tables.ar : messages.tables.en)[key];
  if (key === "pagesNotRead") {
    const m = /file has (\d+) pages; the text of (\d+)/.exec(warning);
    if (m) return text.replace("{total}", m[1]).replace("{read}", m[2]);
  }
  return text;
}
