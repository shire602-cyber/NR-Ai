// Which journal entries may be changed through the generic journal routes (reverse, edit, delete)?
//
// Only entries a user typed in (source "manual"), and the reversal of such an entry (a user
// correcting a correction). Every other entry belongs to the feature that posted it: an invoice,
// a payment, a VAT filing, a year-end close, a corporate-tax accrual, an FX revaluation ... Undoing
// one of those by a bare reversal leaves the document, the filing or the closing out of step with
// the ledger (a reversed VAT clearing entry, for instance, leaves the FTA owed money the books no
// longer show). Each has its own undo, and the message names it. Pure: no I/O.

import { MANUAL_JOURNAL_SOURCE } from "./manual-journal-input";

export const SYSTEM_ENTRY_NOT_REVERSIBLE = "SYSTEM_ENTRY_NOT_REVERSIBLE";
export const SYSTEM_ENTRY_READ_ONLY = "SYSTEM_ENTRY_READ_ONLY";

const REVERSAL_SOURCE = "reversal";

const UNDO_HINTS: Record<string, string> = {
  invoice: "Void the invoice, or issue a credit note against it.",
  payment: "Delete or edit the payment on the invoice or bill it settles.",
  receipt: "Change or delete the receipt it was posted from.",
  bill: "Void the bill, or record a supplier credit note.",
  expense_claim: "Reject or amend the expense claim.",
  expense_claim_payment: "Amend the expense claim payment.",
  vat_filing: "A filed VAT return cannot be undone here. Record an amendment (voluntary disclosure) for that period.",
  vat_payment: "Correct the payment on the filed VAT return it settles.",
  vat_workpaper_row: "Delete or exclude the row in the VAT workpaper.",
  corporate_tax_filing: "A filed corporate tax return cannot be undone here. Record an amendment for that period.",
  corporate_tax_payment: "Correct the payment on the filed corporate tax return it settles.",
  year_end_close: "Reopen the year-end close from the year-end screen.",
  year_end_close_reversal: "Reopen or re-run the year-end close from the year-end screen.",
  opening_balance: "Reverse or re-post the opening balances from the opening balances screen.",
  opening_balance_reversal: "Re-post the opening balances from the opening balances screen.",
  fx_revaluation: "Run the FX revaluation again for the period, or reverse it from the FX revaluation screen.",
  fx_revaluation_reversal: "Run the FX revaluation again from the FX revaluation screen.",
  bank_reconciliation: "Undo the bank reconciliation match or adjustment.",
  reversal: "Reverse the original manual journal instead.",
};
const GENERIC_HINT = "Undo it from the screen or document that created it.";

/** How a user undoes an entry of this source, in one sentence. */
export function systemEntryUndoHint(source: string): string {
  return UNDO_HINTS[source] ?? GENERIC_HINT;
}

export interface ProtectedEntryProblem {
  code: typeof SYSTEM_ENTRY_NOT_REVERSIBLE | typeof SYSTEM_ENTRY_READ_ONLY;
  message: string;
  source: string;
}

type EntryLike = { source?: string | null; reversedEntryId?: string | null };

/** True for a journal a user typed in, or the reversal of one. `original` = the entry a reversal reverses. */
export function isUserJournal(entry: EntryLike, original?: EntryLike | null): boolean {
  const source = entry.source ?? MANUAL_JOURNAL_SOURCE;
  if (source === MANUAL_JOURNAL_SOURCE) return true;
  return source === REVERSAL_SOURCE && !!original && (original.source ?? MANUAL_JOURNAL_SOURCE) === MANUAL_JOURNAL_SOURCE;
}

/** null when the entry may be reversed through the generic route, else the 409 refusal. */
export function reversalRefusal(entry: EntryLike, original?: EntryLike | null): ProtectedEntryProblem | null {
  if (isUserJournal(entry, original)) return null;
  const source = entry.source ?? MANUAL_JOURNAL_SOURCE;
  return {
    code: SYSTEM_ENTRY_NOT_REVERSIBLE,
    source,
    message: `This entry was created by the system (${source}) and cannot be reversed from the journal. ${systemEntryUndoHint(source)}`,
  };
}

/** null when the entry may be edited or deleted through the generic route, else the 409 refusal. */
export function editRefusal(entry: EntryLike, original?: EntryLike | null): ProtectedEntryProblem | null {
  if (isUserJournal(entry, original)) return null;
  const source = entry.source ?? MANUAL_JOURNAL_SOURCE;
  return {
    code: SYSTEM_ENTRY_READ_ONLY,
    source,
    message: `This entry was created by the system (${source}) and cannot be edited or deleted from the journal. ${systemEntryUndoHint(source)}`,
  };
}
