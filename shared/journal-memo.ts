// System journal descriptions: one registry of templates shared by the server and the client.
//
// The server writes the English text into `journal_entries.memo` (audit trail) and ALSO stores the
// template key and its parameters (`memo_key`, `memo_params`). The UI renders the entry from the
// key in the user's language (catalog key `journal.memo.<key>`), so no English text has to be
// rebuilt by pattern matching. Rows posted before migration 0131 have no key and fall back to the
// client pattern matcher over the English memo (client/src/lib/journal-memo.ts).
//
// Add a template here, add `journal.memo.<key>` to BOTH catalogs (en and ar), then call
// `journalMemo("<key>", { ... })` where the entry is posted. tests/unit/journal-memo-registry.test.ts
// fails when a key lacks Arabic or a server posting still writes a raw English `memo:` template.

export type JournalMemoParams = Record<string, unknown>;

/** English text of every system journal description. `{name}` marks a parameter. */
export const JOURNAL_MEMO_TEMPLATES = {
  // Sales
  salesInvoice: "Sales Invoice {ref} - {party}",
  debitNote: "Debit Note {ref} - {party}",
  paymentReceived: "Payment received for Invoice {ref} - {method}",
  cogs: "Cost of goods sold - Invoice {ref}",
  creditNote: "Credit note {ref} - {party}",
  creditNoteReversal: "Credit Note {ref} - reversal of Invoice {invoice}",
  creditNotePartial: "Credit Note {ref} - partial credit of Invoice {invoice}",
  customerDeposit: "Customer deposit {ref} - {party}",
  depositApplied: "Deposit {ref} applied to {invoice}",
  creditApplied: "Credit applied to {invoice}",
  refundDeposit: "Refund of customer deposit ({party})",
  refundCredit: "Refund of customer credit ({party})",
  allowanceIncrease: "Increase in allowance for doubtful debts",
  allowanceIncreaseNote: "Increase in allowance for doubtful debts: {note}",
  allowanceRelease: "Release of allowance for doubtful debts",
  allowanceReleaseNote: "Release of allowance for doubtful debts: {note}",
  badDebtWriteOff: "Bad debt written off - {invoice}: {reason}",
  bankFee: "Bank fee on customer receipt",
  bankFeeRef: "Bank fee on customer receipt {ref}",
  // Purchases
  vendorBill: "Vendor Bill {ref} - {party}",
  billPayment: "Payment - Bill {ref} - {party}",
  billPaymentBackfill: "Payment - Bill {ref} (backfill)",
  advanceToVendor: "Advance to {party}",
  prepaymentApplied: "Prepayment applied to bill {ref}",
  vendorDebitNote: "Debit note {ref} - {party}",
  fxOnDebitNote: "FX on debit note {ref} applied",
  receipt: "Receipt: {party}",
  receiptAutopilot: "Receipt Autopilot: {party} ({method}, {pct}% conf)",
  expenseClaimApproved: "Expense claim {ref} approved",
  expenseClaimReimbursed: "Expense claim {ref} reimbursed",
  // AI bookkeeping
  aiDraft: "AI Draft (review required): {party}",
  aiReviewed: "AI GL (reviewed): {party}",
  // Banking and payments
  transferFrom: "Transfer from {account}: {description}",
  transferTo: "Transfer to {account}: {description}",
  gatewayFee: "Payment gateway fee ({provider}) for link {link}",
  // Inventory
  inventoryPurchase: "Inventory purchase - {ref}",
  inventorySale: "Inventory sale - {ref}",
  inventoryAdjustment: "Inventory adjustment - {ref}",
  inventoryReturn: "Inventory return - {ref}",
  inventoryOpening: "Inventory opening - {ref}",
  inventoryReversalAdjustment: "Inventory reversal adjustment - {ref}",
  inventoryWriteDown: "Inventory write-down - {ref}: {reason}",
  inventoryWriteDownReversal: "Inventory write-down reversal - {ref}: {reason}",
  openingStock: "Opening stock - {ref}",
  openingStockValuation: "Opening stock valuation - {ref}",
  stockReturned: "Stock returned - Credit note {ref}",
  goodsReceived: "Goods received - PO {ref}",
  stocktakeVariance: "Stocktake variance",
  // Fixed assets
  capitalization: "Capitalization: {ref}",
  depreciation: "Depreciation: {party}",
  depreciationMonth: "Depreciation: {asset} ({month}/{year})",
  depreciationCatchUp: "Depreciation: {asset} ({month}/{year}, catch-up)",
  depreciationProrated: "Depreciation: {asset} ({month}/{year}, prorated {pct}%)",
  depreciationProratedCatchUp: "Depreciation: {asset} ({month}/{year}, prorated {pct}%, catch-up)",
  depreciationToDisposal: "Depreciation: {asset} ({month}/{year}, to disposal on {date})",
  revaluation: "Revaluation: {asset}",
  impairment: "Impairment: {asset}",
  disposal: "Disposal: {asset}",
  disposalTo: "Disposal: {asset} to {buyer}",
  disposalProceedsAdjusted: "Disposal proceeds adjusted: {asset} ({ref})",
  // Payroll
  payrollRun: "Payroll {label} - {n} employee(s)",
  salaryPayment: "Salary payment - payroll {label}",
  eosSettlement: "End-of-service settlement - {party}",
  eosSettlementPayment: "End-of-service settlement payment - {party}",
  pensionPayment: "Pension contribution payment - {label}",
  openingGratuity: "Opening gratuity provision at {date} ({n} employee(s))",
  // Tax
  corporateTaxProvision: "Corporate tax provision {from} to {to}",
  corporateTaxAccrual: "Corporate tax accrual (year end) {from} to {to}",
  corporateTaxTrueUp: "Corporate tax true-up on filing {from} to {to}",
  deferredTax: "Deferred tax adjustment at {date}",
  deferredTaxNote: "Deferred tax adjustment at {date} - {note}",
  vatReturnPayment: "VAT return {from} to {to} - VAT payment",
  vatReturnRefund: "VAT return {from} to {to} - VAT refund",
  vatAmendedReturnPayment: "Amended VAT return {from} to {to} - VAT payment",
  vatAmendedReturnRefund: "Amended VAT return {from} to {to} - VAT refund",
  badDebtRelief: "Bad-debt relief (Art. 64) - Invoice {ref}",
  partialExemption: "Irrecoverable input VAT {from} to {to} (partial exemption, Art. 55)",
  // Period end and FX
  yearEndClose: "Year-end close FY {ref}",
  yearEndCloseReversal: "Reversal of year-end close FY {ref}",
  computedClose: "Computed close for {from} to {to}",
  fxRevaluation: "Unrealised FX revaluation {date}",
  fxRevaluationReversal: "Automatic reversal of unrealised FX revaluation {date}",
  fxRevaluationUndo: "Undo of unrealised FX revaluation {date}",
  // Migration
  openingBalances: "Opening balances ({system} trial balance)",
  openingBalancesFile: "Opening balances ({system} trial balance: {file})",
  openingReceivable: "Opening A/R: invoice {ref} ({party})",
  openingPayable: "Opening A/P: bill {ref} ({party})",
  // Ledger kernel
  reversalOf: "Reversal of {entry}",
  reversalOfReason: "Reversal of {entry}: {reason}",
  voidOf: "Void of {entry}",
  voidOfReason: "Void of {entry}: {reason}",
} as const;

export type JournalMemoKey = keyof typeof JOURNAL_MEMO_TEMPLATES;

export const journalMemoCatalogKey = (key: string): string => `journal.memo.${key}`;

export function isJournalMemoKey(key: unknown): key is JournalMemoKey {
  return (
    typeof key === "string" && Object.prototype.hasOwnProperty.call(JOURNAL_MEMO_TEMPLATES, key)
  );
}

export interface JournalMemoFields {
  memo: string;
  memoKey: JournalMemoKey;
  memoParams: Record<string, string>;
}

/** Fill `{name}` placeholders; a missing parameter reads as empty. */
export function fillJournalMemo(template: string, params: JournalMemoParams): string {
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name] ?? ""));
}

/**
 * The English memo plus the key and parameters to store beside it. Spread into the posting input:
 * `postJournal({ ...journalMemo("customerDeposit", { ref, party }), ... })`.
 */
export function journalMemo(
  key: JournalMemoKey,
  params: JournalMemoParams = {}
): JournalMemoFields {
  const memoParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) memoParams[k] = String(v ?? "");
  return {
    memo: fillJournalMemo(JOURNAL_MEMO_TEMPLATES[key], memoParams).slice(0, 500),
    memoKey: key,
    memoParams,
  };
}

/**
 * Line descriptions of system postings that are not an entry memo (shown in the GL and account
 * ledger beside the entry). English text; matched only, to rebuild the Arabic wording of rows that
 * carry no key. `journal.memo.line.<key>` in the catalogs.
 */
export const JOURNAL_LINE_TEMPLATES = {
  depositContractLiability: "Customer deposit {ref} - {party} (contract liability)",
  depositVatOnReceipt: "Customer deposit {ref} - {party} (VAT on receipt)",
  depositAppliedLine: "Deposit applied to {invoice}",
} as const;
