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
  vatReturnControlSettlement: "VAT return {from} to {to} - VAT control account settlement",
  vatAmendedReturnPayment: "Amended VAT return {from} to {to} - VAT payment",
  vatAmendedReturnRefund: "Amended VAT return {from} to {to} - VAT refund",
  badDebtRelief: "Bad-debt relief (Art. 64) - Invoice {ref}",
  partialExemption: "Irrecoverable input VAT {from} to {to} (partial exemption, Art. 55)",
  // Period end and FX
  yearEndClose: "Year-end close FY {ref}",
  yearEndCloseRange: "Year-end close FY {from} to {to}",
  yearEndCloseReversal: "Reversal of year-end close FY {ref}",
  yearEndCloseReversalRange: "Reversal of year-end close FY {from} to {to}",
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

/**
 * The document a stock line belongs to ("Bill BILL-1", "PO PO-7 receipt"). A line template that
 * carries `{doc}` names it with `docKind` + `ref` parameters, so Arabic renders the document word
 * too (catalog `journal.memo.doc.<kind>`) instead of keeping an English label.
 */
export const JOURNAL_DOC_TEMPLATES = {
  bill: "Bill {ref}",
  invoice: "Invoice {ref}",
  creditNote: "Credit note {ref}",
  debitNote: "Debit note {ref}",
  poReceipt: "PO {ref} receipt",
  reversalBill: "Reversal Bill {ref}",
  reversalInvoice: "Reversal Invoice {ref}",
  reversalCreditNote: "Reversal Credit note {ref}",
  reversalDebitNote: "Reversal Debit note {ref}",
  stocktake: "Stocktake",
  stockPurchase: "Stock purchase",
  stockSale: "Stock sale",
  stockAdjustment: "Stock adjustment",
  stockReturn: "Stock return",
  text: "{ref}",
} as const;

export type JournalDocKind = keyof typeof JOURNAL_DOC_TEMPLATES;

export const journalDocCatalogKey = (kind: string): string => `journal.memo.doc.${kind}`;

/** `{doc}` value of a parameter set that has a `docKind` (English unless `docTemplates` is given). */
function docText(params: JournalMemoParams, docTemplates?: Record<string, string>): string {
  const kind = String(params.docKind ?? "");
  const template =
    docTemplates?.[journalDocCatalogKey(kind)] ??
    (JOURNAL_DOC_TEMPLATES as Record<string, string>)[kind] ??
    "{ref}";
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name] ?? ""));
}

/** Fill `{name}` placeholders; a missing parameter reads as empty. */
export function fillJournalMemo(
  template: string,
  params: JournalMemoParams,
  docTemplates?: Record<string, string>
): string {
  const values: JournalMemoParams =
    template.includes("{doc}") && params.docKind
      ? { ...params, doc: docText(params, docTemplates) }
      : params;
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(values[name] ?? ""));
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
  salesRevenue: "Sales revenue - {ref}",
  zeroRatedSales: "Zero-rated sales - {ref}",
  exemptSales: "Exempt sales - {ref}",
  outOfScopeRevenue: "Out-of-scope revenue - {ref}",
  vatOutput: "VAT output - {ref}",
  invoiceReceivable: "Invoice {ref} - {party}",
  invoiceReceivableFx: "Invoice {ref} - {party} ({currency} {amount} @ {rate})",
  reverseVat: "Reverse VAT - {ref}",
  reverseRevenue: "Reverse revenue - {ref}",
  reduceReceivable: "Reduce A/R - {ref}",
  customerCreditLine: "Customer credit - {ref}",
  billLine: "Bill {ref} - {text}",
  billInputVat: "Input VAT - Bill {ref}",
  billReverseChargeVat: "Reverse-charge output VAT - Bill {ref}",
  billWithholding: "Withholding - Bill {ref}",
  billPayable: "A/P - {party} - Bill {ref}",
  billSettleAp: "Settle A/P - Bill {ref} - {party}",
  billPaymentTo: "Payment to {party} - Bill {ref}",
  billFxLoss: "Realised FX loss - Bill {ref}",
  billFxGain: "Realised FX gain - Bill {ref}",
  vendorAdvance: "Advance - {party}",
  vendorAdvancePaid: "Advance paid - {party}",
  prepaymentAppliedLine: "Prepayment applied - {party}",
  realisedFxLoss: "Realised FX loss",
  realisedFxGain: "Realised FX gain",
  debitNoteLine: "Debit note {ref} - {text}",
  inputVatReversal: "Input VAT reversal - {ref}",
  rcOutputVatReversal: "Reverse-charge output VAT reversal - {ref}",
  debitNotePayable: "A/P - debit note {ref}",
  depositReceived: "Customer deposit {ref} - {party}",
  depositAppliedContract: "Deposit applied to {invoice} (contract liability)",
  depositAppliedVatReversed: "Deposit applied to {invoice} (advance VAT reversed: charged on the invoice)",
  refundDepositContract: "Refund of customer deposit ({party}) (contract liability)",
  refundDepositVatReversed: "Refund of customer deposit ({party}) (advance VAT reversed: charged on the invoice)",
  creditApplied: "Credit applied to {invoice}",
  refundDeposit: "Refund of customer deposit ({party})",
  refundCredit: "Refund of customer credit ({party})",
  creditAppliedFxGain: "Credit applied to {invoice} — realised FX gain",
  creditAppliedFxLoss: "Credit applied to {invoice} — realised FX loss",
  refundDepositFxGain: "Refund of customer deposit ({party}) — realised FX gain",
  refundDepositFxLoss: "Refund of customer deposit ({party}) — realised FX loss",
  refundCreditFxGain: "Refund of customer credit ({party}) — realised FX gain",
  refundCreditFxLoss: "Refund of customer credit ({party}) — realised FX loss",
  badDebtWriteOff: "Bad debt written off - {invoice}",
  badDebtWriteOffAllowanceUsed: "Bad debt written off - {invoice} (allowance used)",
  allowanceIncreaseLine: "Increase in allowance for doubtful debts",
  allowanceReleaseLine: "Release of allowance for doubtful debts",
  paymentCashReceived: "Invoice {ref} — cash received",
  paymentClearAr: "Invoice {ref} — clear A/R",
  paymentCustomerCredit: "Invoice {ref} — customer credit (overpayment)",
  paymentFxGain: "Invoice {ref} — realised FX gain",
  paymentFxLoss: "Invoice {ref} — realised FX loss",
  bankFeeLine: "Bank fee on customer receipt",
  payrollSalaries: "Salaries & wages - payroll {label}{rest}",
  payrollEmployerPension: "Employer pension contribution (GPSSA / ADPF) - payroll {label}{rest}",
  payrollGratuityAccrual: "End-of-service gratuity accrual - payroll {label}{rest}",
  payrollNetPayable: "Net salaries payable - payroll {label}",
  payrollPensionPayable: "Pension payable (GPSSA / ADPF, employee + employer) - payroll {label}",
  payrollDeductionsPayable: "Payroll deductions payable - payroll {label}",
  payrollGratuityProvision: "End-of-service gratuity provision - payroll {label}",
  payrollNetPaid: "Net salaries paid - payroll {label}",
  payrollReimbursements: "Expense claim reimbursements - payroll {label}",
  salaryPaymentLine: "Salary payment - payroll {label}",
  settlementProvisionCleared: "Gratuity provision cleared - {party}",
  settlementGratuityAbove: "End-of-service gratuity above provision - {party}",
  settlementProvisionReleased: "Excess gratuity provision released - {party}",
  settlementNoticeLeave: "Notice pay, leave encashment and additions - {party}",
  settlementDeductions: "Final settlement deductions - {party}",
  settlementPayable: "Final settlement payable - {party}",
  settlementPaid: "Final settlement paid - {party}",
  settlementPayment: "Final settlement payment - {party}",
  openingGratuityEquity: "Opening balance: gratuity provision brought forward",
  openingGratuityProvision: "Opening gratuity provision (employees' service before go-live)",
  pensionPayableCleared: "Pension payable cleared - {fund} contributions{period}",
  pensionPaidTo: "Paid to {fund} contributions{period}",
  gatewayFeeLine: "Gateway processing fee",
  fxRevalAr: "Unrealised FX revaluation — A/R",
  fxRevalAp: "Unrealised FX revaluation — A/P",
  fxRevalBank: "Unrealised FX revaluation — bank",
  fxUnrealisedGain: "Unrealised FX gain",
  fxUnrealisedLoss: "Unrealised FX loss",
  fxUndoRevalAr: "Undo — Unrealised FX revaluation — A/R",
  fxUndoRevalAp: "Undo — Unrealised FX revaluation — A/P",
  fxUndoRevalBank: "Undo — Unrealised FX revaluation — bank",
  fxUndoUnrealisedGain: "Undo — Unrealised FX gain",
  fxUndoUnrealisedLoss: "Undo — Unrealised FX loss",
  assetCapitalize: "Capitalize {asset}",
  assetInputVat: "Input VAT - {asset}",
  assetOpeningAccumulated: "Opening accumulated depreciation - {asset}",
  assetOpeningBalance: "Opening balance - {asset}",
  assetPayment: "Payment for {asset}",
  assetDepreciation: "Depreciation - {asset}",
  assetAccumulatedDepreciation: "Accumulated depreciation - {asset}",
  assetEliminateAccumulated: "Eliminate accumulated depreciation on revaluation - {asset}",
  assetRevaluationSurplus: "Revaluation surplus - {asset}",
  assetReverseSurplus: "Reverse surplus - {asset}",
  assetRevaluationLoss: "Revaluation loss - {asset}",
  assetRevaluation: "Revaluation - {asset}",
  assetImpairmentSurplus: "Impairment charged to revaluation surplus - {asset}",
  assetImpairment: "Impairment - {asset}",
  assetAccumulatedImpairment: "Accumulated impairment - {asset}",
  assetInvoicedProceeds: "Invoiced proceeds moved to disposal of {asset}",
  assetDisposalProceeds: "Proceeds from disposal of {asset}",
  assetReverseAccumulated: "Reverse accumulated depreciation on {asset}",
  assetDisposalLoss: "Loss on disposal of {asset}",
  assetRemoveCost: "Remove cost of {asset}",
  assetDisposalOutputVat: "Output VAT 5% - disposal of {asset}",
  assetDisposalGain: "Gain on disposal of {asset}",
  assetRealiseSurplus: "Realise revaluation surplus - {asset}",
  assetRealisedSurplus: "Realised revaluation surplus - {asset}",
  disposalProceedsReduced: "Disposal proceeds reduced by {ref} - {asset}",
  disposalLossIncreased: "Loss on disposal increased by {ref} - {asset}",
  disposalInvoiceMoved: "{ref} on a disposal invoice moved to the disposal result",
  disposalLossReduced: "Loss on disposal reduced by {ref} - {asset}",
  disposalProceedsIncreased: "Disposal proceeds increased by {ref} - {asset}",
  invStockTrueUp: "{doc} - stock true-up",
  invCostTrueUp: "{doc} - cost true-up",
  docVoidedKept: "{doc} voided - received goods kept in stock",
  docVoidedGrni: "{doc} voided - goods received not invoiced",
  docClearGrni: "{doc} - clear goods received not invoiced",
  docPpvOnHand: "{doc} - purchase price variance on stock on hand",
  docPpvSold: "{doc} - purchase price variance on stock sold",
  docStockItem: "{doc} - stock {item}",
  docReturned: "{doc} - returned {item}",
  docPurchaseReturnDiff: "{doc} - purchase return price difference",
  invoiceCogsLine: "COGS - Invoice {ref} - {item}",
  invoiceStockOutLine: "Stock out - Invoice {ref}",
  creditNoteRestock: "Restock - {ref}",
  creditNoteReverseCogs: "Reverse COGS - {ref}",
  docStockIn: "{doc} - stock in",
  docStockOut: "{doc} - stock out",
  docGrni: "{doc} - goods received not invoiced",
  docOnly: "{doc}",
  openingStockLine: "Opening stock",
  openingStockBackfillLine: "Opening stock valuation backfill",
  openingStockValuationLine: "Opening stock valuation",
  writeDownExpense: "Write-down - {reason}",
  writeDownInventory: "Write-down",
  writeDownReversalInventory: "Write-down reversal",
  writeDownReversalExpense: "Write-down reversal - {reason}",
  stocktakeSurplus: "Stocktake surplus",
  stocktakeShortage: "Stocktake shortage",
  receiptLabel: "{merchant} - {category}",
  receiptLabelNoCategory: "{merchant} - General",
  receiptLabelNoMerchant: "Expense - {category}",
  receiptLabelBare: "Expense - General",
  receiptInputVat: "Input VAT - {merchant}",
  receiptInputVatNoMerchant: "Input VAT - expense",
  receiptInputVatRc: "Input VAT (reverse-charge) - {merchant}",
  receiptInputVatRcNoMerchant: "Input VAT (reverse-charge) - expense",
  receiptOutputVatRc: "Output VAT (reverse-charge) - {merchant}",
  receiptOutputVatRcNoMerchant: "Output VAT (reverse-charge) - expense",
  receiptPayment: "Payment for {merchant}",
  receiptPaymentNoMerchant: "Payment for expense",
  bankFeeOn: "Bank fee: {text}",
  fxDifference: "FX difference",
  bankOutputVat: "Output VAT 5%: {text}",
  bankInputVat: "Input VAT 5%: {text}",
  yearEndCloseLine: "Year-end close - {account}",
  yearEndCloseReversalLine: "Reversal - Year-end close - {account}",
  vatReturnOutput: "VAT return {from} to {to}: output VAT",
  vatReturnInput: "VAT return {from} to {to}: input VAT",
  vatReturnPaid: "VAT return {from} to {to}: VAT paid to the FTA",
  vatReturnRefund: "VAT return {from} to {to}: VAT refund from the FTA",
  vatAmendedReturnOutput: "Amended VAT return {from} to {to}: output VAT",
  vatAmendedReturnInput: "Amended VAT return {from} to {to}: input VAT",
  vatAmendedReturnPaid: "Amended VAT return {from} to {to}: VAT paid to the FTA",
  vatAmendedReturnRefund: "Amended VAT return {from} to {to}: VAT refund from the FTA",
  vatSettlementFxGain: "VAT return {from} to {to}: realized exchange gain",
  vatSettlementFxLoss: "VAT return {from} to {to}: realized exchange loss",
  vatGroupIntercompany: "VAT return {from} to {to}: balance with VAT group members",
  vatReliefOutput: "Output VAT relief - {ref}",
  vatReliefRecovered: "VAT recovered on bad debt - {ref}",
  irrecoverableInputVat: "Irrecoverable input VAT",
  inputVatApportioned: "Input VAT apportioned",
  ctExpense: "Corporate tax expense",
  ctPayable: "Corporate tax payable",
  ctExpenseUnderProvision: "Corporate tax expense - under-provision on filing",
  ctPayableUnderProvision: "Corporate tax payable - under-provision on filing",
  ctExpenseOverProvision: "Corporate tax expense - over-provision on filing",
  ctPayableOverProvision: "Corporate tax payable - over-provision on filing",
  ctExpenseAccrual: "Corporate tax expense - year-end accrual",
  ctPayableAccrual: "Corporate tax payable - year-end accrual",
  dtaIncrease: "Deferred tax asset increase",
  dtaDecrease: "Deferred tax asset decrease",
  dtlIncrease: "Deferred tax liability increase",
  dtlDecrease: "Deferred tax liability decrease",
  deferredTaxExpense: "Deferred tax expense",
  deferredTaxIncome: "Deferred tax income",
  openingBalanceLine: "Opening balance",
  openingCarriedByDocuments: "A/R and A/P carried by open documents",
  openingCarriedByStock: "Inventory carried by opening stock",
  openingAr: "Opening A/R {ref}",
  openingAp: "Opening A/P {ref}",
  claimExpense: "Expense claim — {code}",
  claimInputVat: "Expense claim — recoverable input VAT",
  claimOwed: "Expense claim — owed to employee",
  reimbursementClear: "Reimbursement {ref} — clear employee payable",
  reimbursementPaid: "Reimbursement {ref} — paid to employee",
  reimbursementPaidFx: "Reimbursement {ref} — paid to employee ({currency})",
  reimbursementFxLoss: "Realised FX loss — reimbursement {ref}",
  reimbursementFxGain: "Realised FX gain — reimbursement {ref}",
  vwExpense: "{label} — expense",
  vwInputVat: "{label} — input VAT",
  vwPayable: "{label} — payable",
  vwInputVatRecoverable: "{label} — input VAT (recoverable)",
  vwOutputVatSelf: "{label} — output VAT (self-assessed)",
  vwReceivable: "{label} — receivable",
  vwRevenue: "{label} — revenue",
  vwOutputVat: "{label} — output VAT",
  vwZeroRatedRevenue: "{label} — zero-rated revenue",
  vwExemptRevenue: "{label} — exempt revenue",
  autopilotInputVat: "Input VAT — {merchant}",
} as const;

export type JournalLineKey = keyof typeof JOURNAL_LINE_TEMPLATES;

export const journalLineCatalogKey = (key: string): string => `journal.memo.line.${key}`;

export function isJournalLineKey(key: unknown): key is JournalLineKey {
  return (
    typeof key === "string" && Object.prototype.hasOwnProperty.call(JOURNAL_LINE_TEMPLATES, key)
  );
}

/**
 * A system line description: the English text for the audit trail plus the key and parameters to
 * store on the journal line (`line_key`, `line_params`, migration 0132). Spread into a posting
 * line: `{ accountId, debitFils, ...journalLine("vatOutput", { ref }) }`.
 */
export interface JournalLineFields {
  description: string;
  lineKey: JournalLineKey;
  lineParams: Record<string, string>;
}

export function journalLine(
  key: JournalLineKey,
  params: JournalMemoParams = {},
  maxLength = 500
): JournalLineFields {
  const lineParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) lineParams[k] = String(v ?? "");
  return {
    description: fillJournalMemo(JOURNAL_LINE_TEMPLATES[key], lineParams).slice(0, maxLength),
    lineKey: key,
    lineParams,
  };
}
