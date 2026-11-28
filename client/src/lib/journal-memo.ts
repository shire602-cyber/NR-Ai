// The renderer lives in shared/ so the server (GL PDF / Excel) renders the same Arabic text.
export {
  localizeJournalLine,
  localizeJournalMemo,
  type JournalLineSource,
  type JournalMemoSource,
} from "@shared/journal-memo-render";
