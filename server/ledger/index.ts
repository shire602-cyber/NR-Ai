/**
 * Ledger posting kernel — FROZEN public API (W2-A). Later workstreams code
 * against exactly these exports; see server/ledger/README.md.
 */
export {
  postJournal,
  postDraft,
  reverseEntry,
  voidEntry,
  reverseBySource,
  submitForApproval,
  updateDraftEntry,
  deleteDraft,
  describeReversal,
} from "./kernel";
export { withLedgerTx, type LedgerTxHooks } from "./tx";
export {
  defineMachine,
  assertTransition,
  transitionRow,
  journalMachine,
  journalLifecycle,
  JOURNAL_LIFECYCLE_STATES,
  type Machine,
  type MachineSpec,
  type StatusTable,
  type TransitionOptions,
  type JournalLifecycleState,
} from "./state-machines";
export { previewEntryNumber } from "./numbering";
export {
  ENTRY_KINDS,
  type EntryKind,
  type LedgerAmount,
  type LedgerContext,
  type LedgerTx,
  type PostDraftOptions,
  type PostJournalInput,
  type PostJournalLineInput,
  type PostJournalResult,
  type ReverseOptions,
  type ReverseResult,
} from "./types";
export {
  DEFAULT_BASE_CURRENCY,
  VAT_FILING_CURRENCY,
  baseCurrencyOf,
  documentCurrency,
  isForeignCurrency,
  loadBaseCurrency,
} from "./currency";
