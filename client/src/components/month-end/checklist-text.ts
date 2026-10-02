// The month-end checklist comes from the server as English sentences with the figures inside them. This maps each
// item (by its id) and each known "details" sentence to a message key plus its figures, so the checklist reads in the
// reader's language. A sentence it does not know is shown as the server wrote it.

export interface ChecklistItemLike {
  id: number;
  title: string;
  description: string;
  details?: string;
}

export type CheckKey =
  | "title1"
  | "title2"
  | "title3"
  | "title4"
  | "title5"
  | "title6"
  | "title7"
  | "title8"
  | "desc1"
  | "desc2"
  | "desc3"
  | "desc4"
  | "desc5"
  | "desc6"
  | "desc7"
  | "desc8"
  | "dNoBank"
  | "dBank"
  | "dNoInvoices"
  | "dInvoices"
  | "dNoReceipts"
  | "dReceipts"
  | "dScanClean"
  | "dScanCritical"
  | "dScanFailed"
  | "dAiClear"
  | "dAiPending"
  | "dNoAssets"
  | "dAssets"
  | "dVatCovered"
  | "dNoVat"
  | "dVatNotEnded"
  | "dVatExists"
  | "dVatNotLast"
  | "dVatNoReturn"
  | "dBankDone"
  | "dBankLoose"
  | "dNoForeign"
  | "dFxNotEnded"
  | "dFxDone"
  | "dFxOpen"
  | "dVatNotApplicable";

export interface Resolved {
  key: CheckKey;
  params: Record<string, string | number>;
}

const EXACT: Array<[string, CheckKey]> = [
  ["No bank transactions in this period", "dNoBank"],
  ["No invoices in this period", "dNoInvoices"],
  ["No receipts in this period", "dNoReceipts"],
  ["Unable to run anomaly scan", "dScanFailed"],
  ["All AI suggestions processed", "dAiClear"],
  ["No depreciable fixed assets", "dNoAssets"],
  ["No VAT return prepared for this period", "dNoVat"],
  ["No VAT to report for this month (not VAT-registered, or no VAT postings)", "dVatNotApplicable"],
  ["No foreign-currency bank accounts", "dNoForeign"],
  [
    "The month has not ended: foreign-currency bank accounts are revalued at the month end",
    "dFxNotEnded",
  ],
  [
    "This month falls inside a VAT period that has not ended: its return is prepared after the period closes",
    "dVatNotEnded",
  ],
];

const PATTERNS: Array<[RegExp, CheckKey, string[]]> = [
  [
    /^(\d+)\/(\d+) bank accounts have a completed reconciliation as at (\S+) \((\d+) lines unreconciled\)$/,
    "dBank",
    ["done", "total", "date", "lines"],
  ],
  [/^(\d+)\/(\d+) posted \((\d+) drafts remaining\)$/, "dInvoices", ["done", "total", "left"]],
  [/^(\d+)\/(\d+) categorized \((\d+) remaining\)$/, "dReceipts", ["done", "total", "left"]],
  [/^Scan clean \((\d+) non-critical items\)$/, "dScanClean", ["count"]],
  [/^(\d+) critical anomalies require attention$/, "dScanCritical", ["count"]],
  [/^(\d+) (?:items|classifications) pending review$/, "dAiPending", ["count"]],
  [/^(\d+)\/(\d+) assets depreciated through (\S+)$/, "dAssets", ["done", "total", "month"]],
  [/^(\d+) VAT return\(s\) cover this period$/, "dVatCovered", ["count"]],
  [
    /^VAT return for (\S+) – (\S+) exists \((.+)\)\.$/,
    "dVatExists",
    ["periodStart", "periodEnd", "status"],
  ],
  [
    /^Not the last month of the VAT period; the return is due with the period ending (\S+)\.$/,
    "dVatNotLast",
    ["periodEnd"],
  ],
  [
    /^The VAT period ending (\S+) has no return yet\. Create the return, or lock with an override\.$/,
    "dVatNoReturn",
    ["periodEnd"],
  ],
  [/^(\d+)\/(\d+) bank accounts reconciled as at (\S+)$/, "dBankDone", ["done", "total", "date"]],
  [/^(\d+) lines without a bank account are unreconciled$/, "dBankLoose", ["count"]],
  [/^(\d+) foreign-currency bank account\(s\) revalued at (\S+)$/, "dFxDone", ["count", "date"]],
  [/^Not revalued at (\S+): (.+)$/, "dFxOpen", ["date", "names"]],
];

export function resolveTitle(item: ChecklistItemLike): Resolved | null {
  return item.id >= 1 && item.id <= 8 ? { key: `title${item.id}` as CheckKey, params: {} } : null;
}

export function resolveDescription(item: ChecklistItemLike): Resolved | null {
  return item.id >= 1 && item.id <= 8 ? { key: `desc${item.id}` as CheckKey, params: {} } : null;
}

/** The translated form of the item's details sentence, or null when it is not one this knows. */
export function resolveDetails(details: string | undefined): Resolved | null {
  if (!details) return null;
  for (const [text, key] of EXACT) if (details === text) return { key, params: {} };
  for (const [re, key, names] of PATTERNS) {
    const m = re.exec(details);
    if (m) return { key, params: Object.fromEntries(names.map((n, i) => [n, m[i + 1]])) };
  }
  return null;
}
