// Response and request shapes of the Phase 8 banking, cash-flow and fixed-asset APIs (design D3, section 5).
// Plain types plus a few pure helpers; no React and no fetching, so the screens and the unit tests share them.

export type ImportSource = "csv" | "ofx" | "mt940" | "camt053" | "pdf" | "feed";
export type RequestedStatementFormat = "auto" | "csv" | "ofx" | "mt940" | "camt053";

export interface BankAccount {
  id: string;
  nameEn: string;
  bankName: string;
  accountNumber: string | null;
  iban: string | null;
  currency: string;
  glAccountId: string | null;
  reconcileFrom?: string | null;
  /** "credit_card" accounts are liabilities in the books; "bank" (and missing) are assets. */
  accountKind?: "bank" | "credit_card";
  isActive: boolean;
}

export interface BankTransaction {
  id: string;
  companyId: string;
  bankAccountId: string | null;
  bankStatementAccountId: string | null;
  transactionDate: string;
  description: string;
  amount: number;
  balance: number | null;
  reference: string | null;
  category: string | null;
  matchStatus: "unmatched" | "suggested" | "matched" | string;
  isReconciled: boolean;
  matchedJournalEntryId: string | null;
  matchedReceiptId: string | null;
  matchedInvoiceId: string | null;
  matchedBillId?: string | null;
  matchConfidence: number | null;
  importSource: string | null;
  reconciliationId?: string | null;
  createdAt: string;
}

// ─── Statement import ──────────────────────────────────────────────────────

export interface StatementSummary {
  from: string | null;
  to: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  currency: string | null;
}

export interface StatementImportResult {
  importId: string;
  format: ImportSource;
  detectedFormat?: ImportSource;
  imported: number;
  duplicates: number;
  skippedDuplicates: number;
  statement: StatementSummary;
  warnings: string[];
}

/** A row of a staged PDF import as the server returns it. */
export interface StagedStatementRow {
  date: string;
  valueDate?: string | null;
  description: string;
  reference: string | null;
  amount: number;
  balance: number | null;
  issues?: string[];
}

export interface StagedPdfImport {
  importId: string;
  status: "staged";
  parser: "text" | "ai";
  rows: StagedStatementRow[];
  statement: StatementSummary;
  warnings: string[];
}

export interface StatementImportRecord {
  id: string;
  bankAccountId: string;
  source: ImportSource;
  status: "staged" | "committed" | "discarded";
  filename: string | null;
  parser: string | null;
  currency: string | null;
  statementFrom: string | null;
  statementTo: string | null;
  openingBalance: number | string | null;
  closingBalance: number | string | null;
  rowCount: number | null;
  importedCount: number | null;
  duplicateCount: number | null;
  warnings: string[];
  createdAt: string | null;
  committedAt: string | null;
}

export interface StatementSettings {
  pdfAiFallback: boolean;
  aiConfigured: boolean;
  maxAiPages: number;
}

// ─── Matching ──────────────────────────────────────────────────────────────

export type SuggestionKind = "invoice" | "invoices" | "bill" | "journal" | "receipt" | "rule" | "account" | "transfer";

export type ReasonCode =
  | "AMOUNT_EXACT"
  | "AMOUNT_WITHIN_1_PCT"
  | "AMOUNT_WITHIN_5_PCT"
  | "DATE_SAME_DAY"
  | "DATE_WITHIN_3_DAYS"
  | "DATE_WITHIN_7_DAYS"
  | "DATE_WITHIN_30_DAYS"
  | "DOCUMENT_NUMBER_IN_TEXT"
  | "NAME_STRONG"
  | "NAME_PARTIAL"
  | "RULE_MATCH"
  | "CLEARING_BALANCE_EQUALS_AMOUNT";

export interface ProposedLine {
  accountId: string;
  accountCode: string | null;
  accountName: string | null;
  debit: number;
  credit: number;
  description?: string | null;
}

export interface MatchSuggestion {
  transactionId: string;
  kind: SuggestionKind;
  targetId: string;
  /** For "invoices": every invoice one receipt settles, in order. */
  targetIds?: string[];
  confidence: number;
  reasons: ReasonCode[];
  label: string;
  amount: number;
  date: string;
  proposedLines: ProposedLine[];
  posts: boolean;
  /** Invoice or bill: the bank amount equals what is still open. */
  amountMatches?: boolean;
  ruleId?: string;
}

export interface BulkMatchItem {
  transactionId: string;
  kind: SuggestionKind;
  targetId: string;
  targetIds?: string[];
  paymentDate?: string | null;
}

export interface BulkMatchResult {
  applied: number;
  dryRun?: boolean;
  results: Array<{
    index?: number;
    transactionId: string;
    kind?: SuggestionKind;
    targetId?: string;
    journalEntryId?: string | null;
    receiptId?: string | null;
  }>;
}

/** `details` of a 409 BULK_MATCH_PARTIAL: what was applied before one item failed. */
export interface BulkPartialDetails {
  applied: string[];
  failed?: BulkMatchError;
}

export interface BulkMatchError {
  index?: number;
  transactionId?: string;
  code: string;
  message: string;
}

// ─── Rules ─────────────────────────────────────────────────────────────────

export type RuleMatchType = "contains" | "equals" | "starts_with" | "regex";
export type RuleMatchField = "description" | "reference" | "amount";
export type RuleDirection = "any" | "inflow" | "outflow";

export interface RuleSplitLine {
  accountId: string;
  percent: number;
  description?: string;
}

export interface ReconciliationRule {
  id: string;
  companyId: string;
  name: string;
  priority: number | null;
  matchField: RuleMatchField;
  matchType: RuleMatchType;
  matchValue: string;
  direction: RuleDirection;
  bankAccountId: string | null;
  amountMin: number | string | null;
  amountMax: number | string | null;
  splitLines: RuleSplitLine[];
  vatRate: number | string | null;
  category: string | null;
  memo: string | null;
  isActive: boolean | null;
  timesApplied: number | null;
  createdAt: string;
}

export interface RulePreviewItem {
  transactionId: string;
  ruleId: string;
  ruleName: string;
  proposedLines: ProposedLine[];
}

export interface RuleApplyResult {
  applied: number;
  results: Array<{ transactionId: string; ruleId: string; journalEntryId?: string | null; receiptId?: string | null; error?: { code: string; message: string } }>;
}

export interface LedgerAccount {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  type: string;
  isActive?: boolean | null;
  isArchived?: boolean | null;
}

// ─── Reconciliation ────────────────────────────────────────────────────────

export interface StatementItem {
  transactionId: string;
  date: string;
  description: string;
  reference: string | null;
  amount: number;
}

export interface LedgerItem {
  entryId: string;
  entryNumber: string;
  date: string;
  memo: string | null;
  source: string;
  sourceId: string | null;
  amount: number;
}

export type StatementBalanceSource = "param" | "session" | "import" | "running_balance" | null;

export interface ReconciliationStatement {
  bankAccountId: string;
  asOf: string;
  currency: string;
  statementBalance: number | null;
  statementBalanceSource: StatementBalanceSource;
  ledgerBalance: number;
  unreconciledCredits: number;
  unreconciledDebits: number;
  depositsInTransit: number;
  outstandingPayments: number;
  adjustedStatementBalance: number | null;
  adjustedLedgerBalance: number;
  difference: number | null;
  items: {
    unreconciledCredits: StatementItem[];
    unreconciledDebits: StatementItem[];
    depositsInTransit: LedgerItem[];
    outstandingPayments: LedgerItem[];
  };
}

export interface BankReconciliationSession {
  id: string;
  bankAccountId: string;
  statementDate: string;
  statementBalance: number | string;
  ledgerBalance: number | string;
  status: "completed" | "reopened" | string;
  completedAt: string | null;
  reopenedAt: string | null;
}

// ─── Feeds ─────────────────────────────────────────────────────────────────

export interface ProvidersResponse {
  providers: string[];
  isConfigured: boolean;
  environment?: string | null;
}

export interface PublicBankConnection {
  id: string;
  provider: string;
  connectionType: string;
  bankName: string | null;
  accountName: string | null;
  bankAccountId: string | null;
  externalAccountId: string | null;
  accountNumberLast4: string | null;
  iban: string | null;
  autoSync: boolean;
  status: "active" | "error" | "disconnected" | string;
  lastError: string | null;
  lastSyncedAt: string | null;
  environment: string | null;
  consecutiveFailures: number;
}

export interface LeanSession {
  appToken: string;
  customerId: string;
  accessToken: string;
  sandbox: boolean;
  state: string;
}

export interface ProviderAccount {
  externalId: string;
  name?: string | null;
  bankName?: string | null;
  currency: string;
  iban?: string | null;
  last4?: string | null;
}

export interface SyncResult {
  imported: number;
  duplicates: number;
  total: number;
  lastSyncedAt: string | null;
}

/** True when a connection is a live feed (not the manual statement source and not disconnected). */
export function isLiveFeed(connection: Pick<PublicBankConnection, "provider" | "status">): boolean {
  return connection.provider !== "manual" && connection.status !== "disconnected";
}

// ─── Cash-flow forecast ────────────────────────────────────────────────────

export type ForecastItemType = "invoice" | "bill" | "recurring" | "payroll" | "adjustment";

export interface ScenarioAdjustment {
  date: string;
  amount: number;
  label: string;
}

export interface ForecastScenarioFields {
  receiptDelayDays: number;
  paymentDelayDays: number;
  collectionRatePct: number;
  includeRecurring: boolean;
  includePayroll: boolean;
  payrollPayDay: number;
  adjustments: ScenarioAdjustment[];
}

export interface SavedScenario extends ForecastScenarioFields {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface ForecastWeek {
  weekStart: string;
  weekEnd: string;
  inflows: number;
  outflows: number;
  net: number;
  closingBalance: number;
}

export interface ForecastItem {
  date: string;
  type: ForecastItemType;
  sourceId: string | null;
  label: string;
  amount: number;
  originalDate: string;
}

export interface ForecastInsight {
  code: string;
  params: Record<string, number | string>;
}

export interface ForecastResponse {
  asOf: string;
  currency: string;
  openingBalance: number;
  scenario: ForecastScenarioFields;
  scenarioMeta: { id: string; name: string } | null;
  weeks: ForecastWeek[];
  items: ForecastItem[];
  insights: ForecastInsight[];
}

// ─── Fixed assets ──────────────────────────────────────────────────────────

export interface AssetRegisterRow {
  assetId: string;
  number: string | null;
  name: string;
  category: string;
  purchaseDate: string;
  cost: number;
  accumulated: number;
  nbv: number;
  status: string;
  onLedger: boolean;
  /** Tied to the bill or journal that bought it. Falls back to `onLedger` when the server does not send it. */
  linked?: boolean;
  linkedDocument?: { type: "bill" | "journal"; id: string; number: string | null } | null;
}

export interface AssetRegister {
  asOf: string;
  rows: AssetRegisterRow[];
  totals: { cost: number; accumulated: number; nbv: number };
  /** Assets that are on the register but not tied to the books yet: outside `totals`. */
  unlinked?: { count?: number; cost: number; accumulated?: number; nbv?: number };
  glTie: {
    gl1290: number;
    gl1240: number;
    difference: number;
    needsCapitalization: Array<{ assetId: string; number: string | null; name: string; cost: number }>;
  };
}

export interface DepreciationScheduleRow {
  assetId: string;
  number: string | null;
  name: string;
  year: number;
  month: number;
  amount: number;
  accumulated: number;
  nbv: number;
  projected: boolean;
  journalEntryId: string | null;
}

// ─── Bank balance revaluation ──────────────────────────────────────────────

export interface RevaluationPreview {
  bankAccountId: string;
  bankAccountName: string;
  currency: string;
  asOf: string;
  closingRate: number;
  /** The balance in the account's own currency. */
  foreignBalance: number;
  /** What the books carry that balance at (AED). */
  carryingAed: number;
  /** What it is worth at the closing rate (AED). */
  targetAed: number;
  /** target - carrying; positive is an unrealised gain. */
  adjustmentAed: number;
  /** An entry for this account and date already exists. */
  alreadyPosted: boolean;
  existingEntry: { journalEntryId: string; entryNumber: string } | null;
}

export interface RevaluationResult extends RevaluationPreview {
  posted: boolean;
  journalEntryId: string | null;
  reversalEntryId: string | null;
  reversalDate: string | null;
  reason?: string;
}

// ─── Errors ────────────────────────────────────────────────────────────────

/** Server error codes the banking screens turn into their own wording. */
export const BANKING_ERROR_CODES = [
  "STATEMENT_PARSE_ERROR",
  "STATEMENT_EMPTY",
  "STATEMENT_CURRENCY_MISMATCH",
  "STATEMENT_ACCOUNT_MISMATCH",
  "STATEMENT_TOO_LARGE",
  "STATEMENT_ROW_INVALID",
  "STATEMENT_TOO_MANY_ROWS",
  "PDF_NO_TRANSACTIONS",
  "IMPORT_NOT_STAGED",
  "ALREADY_RECONCILED",
  "RECEIPT_NOT_POSTED",
  "FX_RATE_MISSING",
  "BANK_GL_NOT_LINKED",
  "RULE_NOT_APPLICABLE",
  "ACCOUNT_REQUIRES_DOCUMENT",
  "BULK_MATCH_INVALID",
  "BULK_MATCH_PARTIAL",
  "RECONCILIATION_NOT_BALANCED",
  "RECONCILIATION_OUT_OF_ORDER",
  "BANK_TXN_IN_COMPLETED_RECONCILIATION",
  "BANK_PROVIDER_NOT_CONFIGURED",
  "BANK_PROVIDER_ERROR",
  "BANK_ENTITY_NOT_OWNED",
  "SYNC_IN_PROGRESS",
  "ROLE_NOT_ALLOWED",
  "PROCEEDS_ACCOUNT_INVALID",
  "RULE_SPLIT_INVALID",
  "RULE_ACCOUNT_INVALID",
  "RULE_REGEX_UNSAFE",
  "RULE_VAT_INFLOW_UNSUPPORTED",
] as const;

export type BankingErrorCode = (typeof BANKING_ERROR_CODES)[number];

export function isBankingErrorCode(code: unknown): code is BankingErrorCode {
  return typeof code === "string" && (BANKING_ERROR_CODES as readonly string[]).includes(code);
}

/** `details` of a 422 STATEMENT_PARSE_ERROR: the line (CSV/MT940) or tag (CAMT/OFX) that broke the parse. */
export function parseErrorLocation(details: unknown): { line?: number; tag?: string } {
  if (!details || typeof details !== "object") return {};
  const d = details as Record<string, unknown>;
  const out: { line?: number; tag?: string } = {};
  if (typeof d.line === "number") out.line = d.line;
  else if (typeof d.line === "string" && /^\d+$/.test(d.line)) out.line = Number(d.line);
  if (typeof d.tag === "string" && d.tag) out.tag = d.tag;
  return out;
}

/** `details.errors[]` of a 422 BULK_MATCH_INVALID, tolerant of the shape. */
export function bulkErrors(details: unknown): BulkMatchError[] {
  if (!details || typeof details !== "object") return [];
  const list = (details as { errors?: unknown }).errors;
  if (!Array.isArray(list)) return [];
  return list
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      index: typeof e.index === "number" ? e.index : undefined,
      transactionId: typeof e.transactionId === "string" ? e.transactionId : undefined,
      code: typeof e.code === "string" ? e.code : "UNKNOWN",
      message: typeof e.message === "string" ? e.message : "",
    }));
}

/** `details.difference` of a 422 RECONCILIATION_NOT_BALANCED. */
export function reconciliationDifference(details: unknown): number | null {
  if (!details || typeof details !== "object") return null;
  const v = (details as { difference?: unknown }).difference;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** `details` of a 409 BULK_MATCH_PARTIAL. */
export function bulkPartial(details: unknown): BulkPartialDetails {
  if (!details || typeof details !== "object") return { applied: [] };
  const d = details as { applied?: unknown; failed?: unknown };
  const applied = Array.isArray(d.applied) ? d.applied.filter((x): x is string => typeof x === "string") : [];
  const f = d.failed && typeof d.failed === "object" ? (d.failed as Record<string, unknown>) : null;
  return {
    applied,
    failed: f
      ? {
          index: typeof f.index === "number" ? f.index : undefined,
          transactionId: typeof f.transactionId === "string" ? f.transactionId : undefined,
          code: typeof f.code === "string" ? f.code : "UNKNOWN",
          message: typeof f.message === "string" ? f.message : "",
        }
      : undefined,
  };
}
