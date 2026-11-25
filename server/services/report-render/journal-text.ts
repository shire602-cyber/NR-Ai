// System journal text for server-rendered reports (GL PDF / Excel / packs). The Arabic catalog is
// the same one the UI reads (client/src/locales/ar/journal.json), so a line described by a key
// reads identically in the app, the PDF and the workbook.
import arJournalJson from "../../../client/src/locales/ar/journal.json";
import { localizeJournalLine, localizeJournalMemo } from "../../../shared/journal-memo-render";

export const arJournalCatalog = arJournalJson as Record<string, string>;

export interface JournalTextEntry {
  memo?: string | null;
  memoKey?: string | null;
  memoParams?: Record<string, string> | null;
}

export interface JournalTextLine {
  description?: string | null;
  lineKey?: string | null;
  lineParams?: Record<string, string> | null;
}

/** A journal line's text in the render language: English text as stored, Arabic from the key. */
export function journalLineText(
  locale: "en" | "ar",
  line: JournalTextLine,
  entry: JournalTextEntry
): string {
  const text = line.description ?? entry.memo ?? "";
  if (locale !== "ar") return text;
  // A line with no description of its own shows the entry memo (and its key).
  return localizeJournalLine(
    arJournalCatalog,
    "ar",
    { description: text, lineKey: line.description ? line.lineKey : null, lineParams: line.lineParams },
    line.description ? { memo: entry.memo } : entry
  );
}

/** An entry memo in the render language. */
export function journalMemoText(locale: "en" | "ar", entry: JournalTextEntry): string {
  const memo = entry.memo ?? "";
  return locale === "ar" ? localizeJournalMemo(arJournalCatalog, memo, "ar", entry) : memo;
}
