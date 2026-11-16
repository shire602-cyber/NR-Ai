// Reports page data types: statement, document, delivery, workflow and asset report rows.
// Split from shared.tsx (R20-09); shared.tsx re-exports this module.
import type { BadgeProps } from "@/components/ui/badge";
import type { PlSectionsPayload } from "../StatementParts";
import type {
  ReportDeliveryAutomationCommand,
  ReportPersona,
  ReportWorkflowGapFilter,
} from "@/lib/reportCatalog";
import type { Vat201ExportReturn } from "@/lib/vat201-export";

export interface AccountLineItem {
  accountCode?: string;
  accountName: string;
  amount: number;
}

export interface ProfitLossReport extends PlSectionsPayload {
  revenue: AccountLineItem[];
  expenses: AccountLineItem[];
  /** Legacy: total income (operating revenue + other income). */
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
}

export interface CostCenterProfitabilityRow {
  costCenterId: string;
  code: string;
  name: string;
  isActive: boolean;
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  lineCount: number;
}

export interface CostCenterProfitabilityReport {
  periodStart: string | null;
  periodEnd: string | null;
  costCenters: CostCenterProfitabilityRow[];
  totals: {
    costCenterCount: number;
    activeCostCenterCount: number;
    allocatedLineCount: number;
    totalIncome: number;
    totalExpenses: number;
    netIncome: number;
  };
}

export interface BalanceSheetReport {
  assets: AccountLineItem[];
  liabilities: AccountLineItem[];
  equity: AccountLineItem[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  /** Kernel balance check (W2-B): assets = liabilities + equity. */
  isBalanced?: boolean;
  difference?: number;
}

export interface ConsolidatedCompanyStatementSource {
  companyId: string;
  companyName: string;
  companyType: string;
  baseCurrency: string;
  profitLoss: ProfitLossReport | null;
  balanceSheet: BalanceSheetReport | null;
  comparisonCurrentProfitLoss: ProfitLossReport | null;
  comparisonPreviousProfitLoss: ProfitLossReport | null;
  error: string | null;
}

export interface ReportDeliverySettingsDraft {
  cadence: string;
  channel: string;
  format: string;
  recipients: string;
  deliveryGuardrail: string;
}

export interface SaveReportDeliverySubscriptionSettingsInput {
  subscriptionId: string;
  enabled?: boolean;
  cadence?: string | null;
  channel?: string | null;
  format?: string | null;
  recipients?: string | null;
  deliveryGuardrail?: string | null;
}

export interface SaveReportDeliveryAutomationPreferenceInput {
  persona: ReportPersona;
  command: ReportDeliveryAutomationCommand;
}

export interface ReportDeliveryAutomationPreferenceResponse {
  persona: ReportPersona;
  preferredDeliveryAutomationCommand: ReportDeliveryAutomationCommand | null;
}

export interface ReportDeliveryPlanPreview {
  summary: string;
  readinessLabel: string;
  checklist: Array<{
    label: string;
    status: "ready" | "review" | "paused";
    detail: string;
  }>;
  handoffRows?: Array<{
    label: string;
    value: string;
    status: "ready" | "review" | "paused";
    detail: string;
    href: string;
  }>;
  reportNames: string[];
  triggerRuleTitles: string[];
  suiteTitles: string[];
}

export interface ReportDeliveryPlanResponse {
  id: string;
  enabled: boolean;
  status: "ready" | "setup" | "paused";
  cadence: string;
  channel: string;
  format: string;
  recipients: string;
  deliveryGuardrail: string;
  nextRunLabel: string;
  settingsSource: "catalog" | "company";
  suiteCount: number;
  reportSuites: Array<{
    id: string;
    title: string;
    workflow: string;
    href: string;
  }>;
  preview: ReportDeliveryPlanPreview;
}

export interface ReportDeliveryRunSummary {
  id: string;
  subscriptionId: string;
  status: string;
  readinessStatus: "ready" | "setup" | "paused";
  scheduledFor: string;
  channel: string;
  format: string;
  recipients: string;
  reportCount: number;
  readyReportCount: number;
  triggerRuleCount: number;
  retriedFromRunId: string | null;
  errorMessage: string | null;
  /** W5-A: blocked runs say why (no_email_provider | no_recipients | handoff_review). */
  blockedReason?: string | null;
  artifactCount?: number;
  recipientAddresses?: string[];
  sentAt?: string | null;
  retryScheduledAt?: string | null;
  createdAt: string;
}

export type ReportDeliveryRunStatusFilter = "all" | "queued" | "sent" | "failed";

export interface ReportDeliverySchedulerHandoffReview {
  subscriptionId: string;
  gap: ReportWorkflowGapFilter;
  message?: string;
  detail: string;
  latestRunId?: string | null;
}

export interface ReportDeliverySchedulerScanSnapshot {
  skippedHandoff?: number;
  handoffReviews?: ReportDeliverySchedulerHandoffReview[];
  skippedSubscriptionIds?: Partial<
    Record<"paused" | "setup" | "not_due" | "handoff" | "no_actor", string[]>
  >;
}

export interface ReportDeliverySchedulerScanSummary {
  id: string;
  status: "success" | "error";
  startedAt: string;
  finishedAt: string;
  scannedSubscriptions: number;
  queuedRuns: number;
  skippedPaused: number;
  skippedSetup: number;
  skippedNotDue: number;
  skippedNoActor: number;
  errors: number;
  message: string | null;
  snapshot?: ReportDeliverySchedulerScanSnapshot | null;
}

export type ConsolidatedStatementStatus = "included" | "unbalanced" | "multi_currency" | "failed";

export interface ConsolidatedStatementEntityRow {
  companyId: string;
  companyName: string;
  companyType: string;
  baseCurrency: string;
  revenue: number;
  expenses: number;
  netProfit: number;
  currentComparisonRevenue: number;
  previousRevenue: number;
  currentComparisonExpenses: number;
  previousExpenses: number;
  currentComparisonNetProfit: number;
  previousNetProfit: number;
  assets: number;
  liabilities: number;
  equity: number;
  balanceDifference: number;
  isBalanced: boolean;
  status: ConsolidatedStatementStatus;
  statusLabel: string;
  reviewReason: string;
  workflow: string;
}

export interface ConsolidatedStatementsReport {
  periodLabel: string;
  currency: string;
  consolidationBasis: string;
  rows: ConsolidatedStatementEntityRow[];
  entityCount: number;
  loadedEntityCount: number;
  failedEntityCount: number;
  unbalancedEntityCount: number;
  multiCurrencyEntityCount: number;
  reviewCount: number;
  singleEntityOnly: boolean;
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  currentComparisonRevenue: number;
  previousRevenue: number;
  currentComparisonExpenses: number;
  previousExpenses: number;
  currentComparisonNetProfit: number;
  previousNetProfit: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  balanceDifference: number;
  eliminationsApplied: number;
  statusLabel: string;
}

export interface VATSummaryReport {
  period: string;
  salesSubtotal: number;
  salesVAT: number;
  purchasesSubtotal: number;
  purchasesVAT: number;
  netVATPayable: number;
}

export interface CashFlowStatementRow {
  period: string;
  operatingInflow: number;
  operatingOutflow: number;
  investingInflow: number;
  investingOutflow: number;
  financingInflow: number;
  financingOutflow: number;
  netCashFlow: number;
  endingBalance: number;
}

export interface AgingReportItem {
  id: string;
  name: string;
  type: "receivable" | "payable";
  current: number;
  days30: number;
  days60: number;
  days90: number;
  over90: number;
  total: number;
}

export interface BillAgingBucket {
  amount: number;
  count: number;
}

export interface BillAgingReport {
  current: BillAgingBucket;
  days_1_30: BillAgingBucket;
  days_31_60: BillAgingBucket;
  days_61_90: BillAgingBucket;
  days_90_plus: BillAgingBucket;
}

export interface AdvancedPeriodComparisonRow {
  metric: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

export interface FxGainsLossesItem {
  entityType: string;
  entityId: string;
  entityNumber: string;
  counterparty: string;
  currency: string;
  foreignAmount: number;
  transactionRate: number;
  currentRate: number;
  bookValueAed: number;
  currentValueAed: number;
  unrealizedGainLoss: number;
}

export interface FxGainsLossesReport {
  asOf: string;
  baseCurrency: string;
  receivables: FxGainsLossesItem[];
  payables: FxGainsLossesItem[];
  totalUnrealizedGain: number;
  totalUnrealizedLoss: number;
  netUnrealizedGainLoss: number;
}

export type VATReturnReportRow = Vat201ExportReturn & {
  id: string;
  submittedAt?: string | null;
  ftaReferenceNumber?: string | null;
  paymentStatus?: string | null;
  paymentAmount?: number | null;
  paymentDate?: string | null;
};

export interface CorporateTaxEstimateReport {
  periodStart: string;
  periodEnd: string;
  totalRevenue: number;
  totalExpenses: number;
  grossProfit: number;
  totalDeductions: number;
  taxableIncome: number;
  exemptionThreshold: number;
  taxableAmount: number;
  taxRate: number;
  taxPayable: number;
  journalEntriesProcessed: number;
}

export interface TrialBalanceRow {
  accountId: string;
  accountName: string;
  accountCode?: string | null;
  accountType: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
  hasForeignLines: boolean;
}

export interface TrialBalanceReport {
  reportCurrency: string;
  rows: TrialBalanceRow[];
  totals: {
    sumDebits: number;
    sumCredits: number;
    difference: number;
  };
}

export interface InvoiceReportRow {
  id: string;
  number: string;
  customerName: string;
  date: string;
  dueDate: string | null;
  currency: string;
  baseCurrencyAmount: number;
  total: number;
  status: string;
  reminderCount: number;
  lastReminderSentAt: string | null;
  invoiceType: string;
  /** Server open balance in base currency (settlement rule: payments + credit notes + credits). */
  openBalanceBase?: number;
}

export interface OverdueInvoiceRow {
  invoice: {
    id: string;
    number: string;
    customerName: string;
    currency: string;
    total: number;
    dueDate: string | null;
    status: string;
  };
  paidAmount: number;
  outstanding: number;
  daysOverdue: number;
  bucket: "current" | "1-7" | "8-30" | "31-60" | "60+";
  recommendedLevel: number;
}

export interface OverdueResponse {
  rows: OverdueInvoiceRow[];
  totalOutstanding: number;
}

export interface VendorBillReportRow {
  id: string;
  vendor_name?: string | null;
  bill_date: string;
  due_date: string | null;
  currency: string;
  total_amount: number | string;
  amount_paid: number | string | null;
  exchange_rate?: number | string | null;
  status: string;
  /** Server open balance (document / base currency) from the settlement rule. */
  open_balance?: number | string | null;
  open_balance_base?: number | string | null;
}

export interface InvoiceStatusSummaryRow {
  status: string;
  count: number;
  amountAed: number;
}

export interface CustomerRevenueRow {
  customerName: string;
  invoiceCount: number;
  amountAed: number;
}

export interface ProductServiceSalesRow {
  productService: string;
  invoiceCount: number;
  lineCount: number;
  quantity: number;
  amountAed: number;
  vatAed: number;
  averageUnitPriceAed: number;
  supplyTypes: string[];
}

export interface SalesProductServiceReport {
  period: {
    startDate: string | null;
    endDate: string | null;
  };
  totals: {
    productServiceCount: number;
    invoiceCount: number;
    lineCount: number;
    quantity: number;
    amountAed: number;
    vatAed: number;
    topProductServiceShare: number;
  };
  rows: ProductServiceSalesRow[];
}

export interface OverdueCustomerRow {
  customerName: string;
  currency: string;
  invoiceCount: number;
  outstanding: number;
  maxDaysOverdue: number;
  recommendedLevel: number;
}

export interface ReceiptReportRow {
  id: string;
  merchant: string | null;
  date: string | null;
  amount: number | null;
  vatAmount: number | null;
  currency: string | null;
  exchangeRate: number;
  baseCurrencyAmount: number;
  category: string | null;
  posted: boolean;
  autoPosted: boolean;
}

export interface BankTransactionReportRow {
  id: string;
  transactionDate: string;
  amount: number | string;
  matchStatus: string;
  isReconciled: boolean;
}

export interface ExpenseSummaryRow {
  label: string;
  entryCount: number;
  lineCount: number;
  debitAed: number;
  creditAed: number;
  netExpenseAed: number;
}

export interface ExpenseClaimReportRow {
  id: string;
  claim_number: string;
  title: string;
  description: string | null;
  total_amount: string | number;
  currency: string | null;
  status: string;
  submitted_by: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  created_at: string;
}

export interface ExpenseClaimSummaryBucket {
  count: number;
  total: number;
}

export interface ExpenseClaimSummaryReport {
  all: Record<string, ExpenseClaimSummaryBucket>;
  thisMonth: Record<string, ExpenseClaimSummaryBucket>;
}

export interface ExpenseClaimStatusRow {
  status: string;
  count: number;
  totalAmount: number;
}

export interface PayrollRunReportRow {
  id: string;
  company_id: string;
  period_month: number;
  period_year: number;
  run_date: string | null;
  total_basic: string | number;
  total_allowances: string | number;
  total_deductions: string | number;
  total_net: string | number;
  employee_count: number;
  status: string;
  sif_file_content: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface PayrollStatusReportRow {
  status: string;
  count: number;
  employeeCount: number;
  totalNet: number;
}

export interface JournalAccount {
  id: string;
  code?: string | null;
  nameEn?: string | null;
  nameAr?: string | null;
  type?: string | null;
}

export interface JournalLineReportRow {
  id: string;
  entryId: string;
  accountId: string;
  debit: number;
  credit: number;
  memo?: string | null;
  foreignCurrency?: string | null;
  account?: JournalAccount | null;
}

export interface JournalEntryReportRow {
  id: string;
  entryNumber: string;
  date: string;
  memo?: string | null;
  source?: string | null;
  sourceId?: string | null;
  status: string;
  lines?: JournalLineReportRow[];
}

export interface LedgerLineRow {
  id: string;
  entryId: string;
  entryNumber: string;
  date: string;
  memo: string;
  source: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
  hasForeignCurrency: boolean;
}

export interface AccountActivityRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  lineCount: number;
  debit: number;
  credit: number;
  netActivity: number;
  lastActivity: string;
}

export interface LedgerSourceRow {
  source: string;
  entryCount: number;
  lineCount: number;
  amountAed: number;
  needsReview: boolean;
}

export interface MonthEndChecklistItem {
  id: number;
  title: string;
  description: string;
  status: "complete" | "incomplete";
  details?: string;
}

export interface MonthEndCloseStatusReport {
  period: string;
  periodStart: string;
  periodEnd: string;
  checklist: MonthEndChecklistItem[];
}

export interface ActivityLogReportRow {
  id: string;
  userId: string | null;
  companyId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  description: string;
  metadata: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string | null;
}

export type ActivityLogRiskLevel = "High" | "Medium" | "Low";

export interface AuditTrailSummaryRow {
  key: string;
  label: string;
  count: number;
  latestAt: string | null;
}

export interface BudgetPlanReportRow {
  id: string;
  name: string;
  fiscal_year: number;
  start_date: string;
  end_date: string;
  status: string;
  total_budget?: string | number | null;
}

export interface VarianceMonth {
  budget: number;
  actual: number;
  variance: number;
  variancePercent: number;
}

export interface VarianceLine {
  id: string;
  category: string;
  description: string | null;
  accountId: string | null;
  /** W3-E: variance is signed by account type (positive = favourable). */
  accountType?: string | null;
  months: Record<string, VarianceMonth>;
  totals: {
    budget: number;
    actual: number;
    variance: number;
    variancePercent: number;
    favourable?: boolean;
  };
}

export interface VarianceReport {
  budget: {
    id: string;
    name: string;
    fiscalYear: number;
    startDate: string;
    endDate: string;
    status: string;
  };
  varianceLines: VarianceLine[];
}

export interface CashFlowProjection {
  week: number;
  weekStart: string;
  weekEnd: string;
  expectedInflows: number;
  expectedOutflows: number;
  projectedBalance: number;
}

export interface CashFlowForecastReport {
  currentBalance: number;
  projections: CashFlowProjection[];
  insights: string[];
}

export interface CustomerBalanceRow {
  name: string;
  currency: string;
  invoiceCount: number;
  totalInvoiced: number;
  paidAmount: number;
  openBalance: number;
  openBalanceAed: number;
  overdueBalance: number;
  overdueBalanceAed: number;
  maxDaysOverdue: number;
}

export interface VendorBalanceRow {
  name: string;
  currency: string;
  billCount: number;
  totalBilled: number;
  paidAmount: number;
  openBalance: number;
  openBalanceAed: number;
  overdueBalance: number;
  overdueBalanceAed: number;
  maxDaysOverdue: number;
}

export interface BalanceSummaryReport {
  generatedAt: string;
  customers: CustomerBalanceRow[];
  vendors: VendorBalanceRow[];
}

export interface FixedAssetReportRow {
  id: string;
  asset_name: string;
  asset_number: string | null;
  category: string;
  purchase_date: string;
  purchase_cost: string | number;
  salvage_value: string | number | null;
  useful_life_years: number | null;
  depreciation_method: string | null;
  accumulated_depreciation: string | number;
  net_book_value: string | number;
  location: string | null;
  serial_number: string | null;
  status: string;
  disposal_date: string | null;
  disposal_amount: string | number | null;
  needs_capitalization_je?: boolean;
}

export interface FixedAssetCategorySummaryRow {
  category: string;
  count: number;
  totalCost: number;
  totalAccumulatedDepreciation: number;
  totalNetBookValue: number;
}

export interface FixedAssetSummaryReport {
  totalAssets: number;
  totalCost: number;
  totalAccumulatedDepreciation: number;
  totalNetBookValue: number;
  byCategory: FixedAssetCategorySummaryRow[];
}

export interface FixedAssetValuationRow extends FixedAssetReportRow {
  purchaseCost: number;
  salvageValue: number;
  accumulatedDepreciation: number;
  netBookValue: number;
}

export type DepreciationScheduleStatus =
  | "ready"
  | "review"
  | "fully_depreciated"
  | "non_depreciable"
  | "not_acquired";

export interface DepreciationScheduleRow {
  assetId: string;
  assetName: string;
  assetNumber: string;
  category: string;
  purchaseDate: string;
  method: string;
  usefulLifeYears: number | null;
  purchaseCost: number;
  salvageValue: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  depreciableBase: number;
  remainingDepreciable: number;
  monthsRemaining: number;
  prorationFactor: number;
  monthlyDepreciation: number;
  annualDepreciation: number;
  projectedAccumulatedDepreciation: number;
  projectedNetBookValue: number;
  status: DepreciationScheduleStatus;
  statusLabel: string;
  reviewReason: string;
}

export interface DepreciationScheduleReport {
  period: string;
  rows: DepreciationScheduleRow[];
  readyRows: DepreciationScheduleRow[];
  reviewRows: DepreciationScheduleRow[];
  assetCount: number;
  depreciableAssetCount: number;
  readyToPostCount: number;
  reviewCount: number;
  reviewValueAed: number;
  fullyDepreciatedCount: number;
  nonDepreciableCount: number;
  periodDepreciationAed: number;
  annualDepreciationAed: number;
  remainingDepreciableAed: number;
}

export interface InventoryProductReportRow {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  unitPrice: string | number;
  costPrice: string | number | null;
  currentStock: number;
  lowStockThreshold: number | null;
  isActive: boolean;
}

export interface InventoryMovementReportRow {
  id: string;
  productId: string;
  type: "purchase" | "sale" | "adjustment" | "return";
  quantity: number;
  unitCost: string | number | null;
  reference: string | null;
  notes?: string | null;
  createdAt: string | null;
}

export interface InventoryMovementTypeRow {
  type: string;
  count: number;
  quantity: number;
  valueAed: number;
}

export type PersonaFilter = "all" | ReportPersona;

export type ReportWorkflowFinderGapFilter = "all" | ReportWorkflowGapFilter;

export type ReportWorkflowCoverageCueId = "pack" | "schedule" | "alert" | "delivery";

export interface ReportWorkflowCoverageCue {
  id: ReportWorkflowCoverageCueId;
  label: string;
  detail: string;
  variant: BadgeProps["variant"];
}

export interface ReportWorkflowCoverageContext {
  persona: ReportPersona;
  reportIds: string[];
  packTemplateId?: string;
  automationStarterId?: string;
  triggerRuleIds?: string[];
  deliverySubscriptionId?: string;
}

export interface ReportWorkflowFinderAction {
  href: string;
  label: string;
  testId: string;
}

export interface ReportWorkflowFinderResult {
  id: string;
  type: string;
  title: string;
  description: string;
  meta: string;
  href: string;
  actionLinks?: ReportWorkflowFinderAction[];
  persona: ReportPersona | null;
  badgeVariant: BadgeProps["variant"];
  coverageCues: ReportWorkflowCoverageCue[];
}

export interface ReportWorkflowGapFilterState {
  type: ReportWorkflowFinderGapFilter;
  persona: ReportPersona | null;
}
