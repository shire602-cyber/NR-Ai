// Reports page module-level types, constants and helpers (W5-A, R20-09: split out of Reports.tsx).
import type { BadgeProps } from "@/components/ui/badge";
import { Briefcase, ClipboardCheck, type LucideIcon, Users } from "lucide-react";
import type { DateRange } from "@/components/DateRangeFilter";
import type { PlSectionsPayload } from "./StatementParts";
import {
  type ReportAutomationTriggerSeverity,
  type ReportCatalogItem,
  type ReportDeliveryAutomationCommand,
  type ReportEvidenceCheckpointStatus,
  type ReportPersona,
  type ReportProductDepthStatus,
  type ReportStatus,
  type ReportTab,
  type ReportWorkflowGapFilter,
  type ReportWorkspaceIcon,
  getPreferredReportWorkflowGapFilter,
  normalizeReportWorkflowSearch,
  parseReportPersona,
  parseReportWorkflowGapFilter,
  readyReportCatalog,
  reportPersonas,
  reportTabs,
} from "@/lib/reportCatalog";
import type { Vat201ExportReturn } from "@/lib/vat201-export";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/format";

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

export function reportWorkflowCue(
  result: ReportWorkflowFinderResult,
  cueId: ReportWorkflowCoverageCueId
): ReportWorkflowCoverageCue | undefined {
  return result.coverageCues.find((cue) => cue.id === cueId);
}

export function matchesReportWorkflowGapFilter(
  result: ReportWorkflowFinderResult,
  filterType: ReportWorkflowFinderGapFilter
): boolean {
  if (filterType === "all") return true;

  if (filterType === "report-gaps") {
    return (
      result.type === "Report" &&
      (result.badgeVariant !== "success" ||
        result.coverageCues.some((cue) => cue.label.startsWith("No ")))
    );
  }

  if (filterType === "rule-gaps") {
    const alertCue = reportWorkflowCue(result, "alert");
    return (
      alertCue?.label === "No alert" ||
      (result.type === "Automation" && result.badgeVariant === "warning")
    );
  }

  const scheduleCue = reportWorkflowCue(result, "schedule");
  const deliveryCue = reportWorkflowCue(result, "delivery");
  return (
    scheduleCue?.label === "No schedule" ||
    deliveryCue?.label === "No delivery" ||
    (deliveryCue?.id === "delivery" && deliveryCue.variant !== "success")
  );
}

export interface AutomationQueueItem {
  id: string;
  title: string;
  signal: string;
  detail: string;
  count: number;
  amount?: number;
  currency?: string;
  personas: ReportPersona[];
  icon: LucideIcon;
  actionLabel: string;
  tab?: ReportTab;
  href?: string;
}

export interface ComparisonRange {
  from: Date;
  to: Date;
}

export interface ComparisonMetricRow {
  id: string;
  label: string;
  current: number;
  previous: number;
  delta: number;
  percentChange: number | null;
  currentLabel?: string;
  previousLabel?: string;
  currency: string;
  signal: string;
  favorable: "increase" | "decrease" | "neutral";
  personas: ReportPersona[];
  tab: ReportTab;
}

export interface ReportCoverageCategory {
  category: string;
  reports: ReportCatalogItem[];
  liveCount: number;
  apiReadyCount: number;
  plannedCount: number;
  workbookCount: number;
  comparisonTypes: string[];
  automationHooks: string[];
  personas: ReportPersona[];
}

export const reportStatusMeta: Record<
  ReportStatus,
  { label: string; variant: BadgeProps["variant"] }
> = {
  live: { label: "Live", variant: "success" },
  api: { label: "API ready", variant: "info" },
  planned: { label: "Planned", variant: "neutral" },
};

export const roadmapImpactMeta = {
  high: { label: "High impact", variant: "warning" },
  medium: { label: "Medium impact", variant: "info" },
  low: { label: "Low impact", variant: "neutral" },
} as const satisfies Record<string, { label: string; variant: BadgeProps["variant"] }>;

export const triggerSeverityMeta = {
  critical: { label: "Critical", variant: "danger" },
  review: { label: "Review", variant: "warning" },
  info: { label: "Monitor", variant: "info" },
} as const satisfies Record<
  ReportAutomationTriggerSeverity,
  { label: string; variant: BadgeProps["variant"] }
>;

export const productDepthStatusMeta = {
  working: { label: "Working", variant: "success" },
  hardening: { label: "Hardening", variant: "warning" },
  "data-needed": { label: "Data needed", variant: "info" },
} as const satisfies Record<
  ReportProductDepthStatus,
  { label: string; variant: BadgeProps["variant"] }
>;

export const productDepthEvidenceCheckpointStatusMeta = {
  "current-proxy": { label: "Current proxy", variant: "neutral" },
  "missing-source": { label: "Missing source", variant: "warning" },
  guardrail: { label: "Guardrail", variant: "info" },
} as const satisfies Record<
  ReportEvidenceCheckpointStatus,
  { label: string; variant: BadgeProps["variant"] }
>;

export const personaFilters: Array<{ id: PersonaFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "owner", label: "Owner" },
  { id: "freelancer", label: "Freelancer" },
  { id: "accountant", label: "Accountant" },
];

export const reportViewerCategoryLabels: Record<string, string> = {
  "Financial Statements": "Financial Statements",
  "Sales & Receivables": "Sales & Receivables",
  "Purchases & Payables": "Purchases & Payables",
  Payroll: "Payroll",
  "Accountant & Taxes": "Accountant & Taxes",
  "Inventory & Assets": "Inventory & Assets",
  "Management & Planning": "Management & Planning",
};

// R18-10: statements and tax first for an SMB owner.
export const reportViewerCategoryOrder = [
  "Financial Statements",
  "Accountant & Taxes",
  "Sales & Receivables",
  "Purchases & Payables",
  "Payroll",
  "Inventory & Assets",
  "Management & Planning",
] as const;

export const reportViewerCategoryByReportId: Record<string, string> = {
  "ar-aging": "Sales & Receivables",
  "customer-balances": "Sales & Receivables",
  "invoice-status": "Sales & Receivables",
  "revenue-customer": "Sales & Receivables",
  "sales-product-service": "Sales & Receivables",
  "ap-aging": "Purchases & Payables",
  "vendor-balances": "Purchases & Payables",
  "expenses-vendor": "Purchases & Payables",
  "expenses-category": "Purchases & Payables",
  "expense-claims": "Purchases & Payables",
  "vat-summary": "Accountant & Taxes",
  "vat-return": "Accountant & Taxes",
  "corporate-tax-estimate": "Accountant & Taxes",
  "trial-balance": "Accountant & Taxes",
  "bank-reconciliation-report": "Accountant & Taxes",
  "general-ledger": "Accountant & Taxes",
  "account-transactions": "Accountant & Taxes",
  "month-end-close-status": "Accountant & Taxes",
  "audit-trail": "Accountant & Taxes",
  "inventory-valuation": "Inventory & Assets",
  "inventory-movement": "Inventory & Assets",
  "fixed-asset-register": "Inventory & Assets",
  "depreciation-schedule": "Inventory & Assets",
  "budget-actual": "Management & Planning",
  "cash-flow-forecast": "Management & Planning",
  "cost-center-profitability": "Management & Planning",
  "period-comparison": "Management & Planning",
  "consolidated-statements": "Management & Planning",
};

export const reportViewerPersonaPriority: ReportPersona[] = ["owner", "freelancer", "accountant"];
export const ledgerDetailPageSize = 50;

export interface ReportViewerOption {
  id: string;
  label: string;
  description: string;
  category: string;
  categoryLabel: string;
  status: ReportStatus;
  order: number;
  reportId?: string;
  tab?: ReportTab;
  href?: string;
  persona?: ReportPersona;
}

export interface ReportViewerGroup {
  category: string;
  label: string;
  rank: number;
  options: ReportViewerOption[];
}

export function reportViewerCategoryLabel(category: string): string {
  return reportViewerCategoryLabels[category] ?? category;
}

export function reportViewerCategoryForReport(report: ReportCatalogItem): string {
  return reportViewerCategoryByReportId[report.id] ?? report.category;
}

export function reportViewerCategoryRank(category: string): number {
  const index = reportViewerCategoryOrder.indexOf(
    category as (typeof reportViewerCategoryOrder)[number]
  );
  return index === -1 ? reportViewerCategoryOrder.length : index;
}

export function reportViewerPersonaForReport(
  report: ReportCatalogItem,
  currentPersona: ReportPersona
): ReportPersona | undefined {
  if (report.personas.includes(currentPersona)) return currentPersona;
  return reportViewerPersonaPriority.find((persona) => report.personas.includes(persona));
}

export type ReportWorkspaceTab =
  | "home"
  | "reports"
  | "suites"
  | "comparisons"
  | "automation"
  | "delivery"
  | "setup";

export const reportWorkspaceTabs: Array<{
  id: ReportWorkspaceTab;
  label: string;
  description: string;
}> = [
  {
    id: "home",
    label: "Home",
    description: "Top reports and next action",
  },
  {
    id: "reports",
    label: "Reports",
    description: "Library, saved views, statements",
  },
  {
    id: "suites",
    label: "Suites",
    description: "Management packs and bundles",
  },
  {
    id: "comparisons",
    label: "Compare",
    description: "Period movement and snapshots",
  },
  {
    id: "automation",
    label: "Automate",
    description: "Rules, queues, command center",
  },
  {
    id: "delivery",
    label: "Delivery",
    description: "Schedules, packs, handoff",
  },
  {
    id: "setup",
    label: "Setup",
    description: "Role workflows and roadmap",
  },
];

export function reportWorkspaceTabFromLocation(search: string, hash: string): ReportWorkspaceTab {
  const anchor = hash.replace(/^#/, "");
  const params = new URLSearchParams(search);
  const workspace = params.get("workspace");

  if (reportWorkspaceTabs.some((tab) => tab.id === workspace)) {
    return workspace as ReportWorkspaceTab;
  }

  if (
    anchor.startsWith("report-suite") ||
    anchor.startsWith("report-management-brief") ||
    anchor.startsWith("report-pack-template")
  ) {
    return "suites";
  }

  if (
    anchor.startsWith("report-comparison") ||
    anchor === "period-comparison-title" ||
    anchor === "comparison-snapshots-title"
  ) {
    return "comparisons";
  }

  if (
    anchor.startsWith("report-delivery") ||
    anchor.startsWith("pack-readiness") ||
    anchor === "report-accountant-handoff-title" ||
    anchor === "report-pack-readiness-title" ||
    anchor === "report-pack-automation-title"
  ) {
    return "delivery";
  }

  if (
    anchor.startsWith("report-automation") ||
    anchor.startsWith("automation-") ||
    anchor.startsWith("report-trigger-rule") ||
    anchor.startsWith("automation-rule") ||
    anchor === "report-workflow-readiness-title" ||
    anchor === "decision-shortcuts-title" ||
    anchor === "automation-starters-title" ||
    anchor === "trigger-rules-title"
  ) {
    return "automation";
  }

  if (
    anchor.startsWith("report-role") ||
    anchor.startsWith("report-product-depth") ||
    anchor === "report-roadmap-title" ||
    anchor === "persona-workspaces-title"
  ) {
    return "setup";
  }

  if (
    anchor.startsWith("report-quick-access") ||
    anchor.startsWith("report-saved-view") ||
    anchor === "report-workflow-finder-title" ||
    anchor === "reports-catalog-discovery-summary" ||
    anchor === "report-catalog-readiness-title" ||
    anchor === "recommended-reports-title" ||
    anchor === "report-center-title" ||
    anchor === "connected-report-centers-title"
  ) {
    return "reports";
  }

  if (params.has("tab") || params.has("workflowSearch") || params.has("workflowGap")) {
    return "reports";
  }

  return "reports";
}

export function reportsWorkspaceHref({
  persona,
  reportId,
  tab,
  workspace,
}: {
  persona?: PersonaFilter;
  reportId?: string;
  tab?: ReportTab;
  workspace?: ReportWorkspaceTab;
}): string {
  const params = new URLSearchParams();

  if (tab) params.set("tab", tab);
  if (reportId) params.set("report", reportId);
  if (persona && persona !== "all") params.set("persona", persona);
  if (workspace && workspace !== "home" && workspace !== "reports") {
    params.set("workspace", workspace);
  }

  const query = params.toString();
  return query ? `/reports?${query}` : "/reports";
}

export const reportDeliveryRunStatusFilters: Array<{
  id: ReportDeliveryRunStatusFilter;
  label: string;
}> = [
  { id: "all", label: "All runs" },
  { id: "queued", label: "Queued" },
  { id: "sent", label: "Sent" },
  { id: "failed", label: "Failed" },
];

export const reportDeliveryAutomationCommandLabels: Record<
  ReportDeliveryAutomationCommand,
  string
> = {
  retry: "Retry recovery",
  review: "Review guardrails",
  queue: "Queue next pack",
  comparison: "Open comparison",
};

export const reportWorkspaceIcons: Record<ReportWorkspaceIcon, LucideIcon> = {
  briefcase: Briefcase,
  clipboardCheck: ClipboardCheck,
  users: Users,
};

export const invoiceStatusLabels: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  posted: "Posted",
  partial: "Partial",
  paid: "Paid",
  void: "Void",
  cancelled: "Cancelled",
};

export const inactiveInvoiceStatuses = new Set(["void", "cancelled"]);
export const nonRevenueInvoiceStatuses = new Set(["draft", "void", "cancelled"]);
export const inactiveVendorBillStatuses = new Set(["paid", "void", "cancelled"]);
export const nonPayableVendorBillStatuses = new Set(["void", "cancelled"]);

export function amountInAed(invoice: InvoiceReportRow): number {
  return Number(invoice.baseCurrencyAmount ?? invoice.total ?? 0) || 0;
}

export function vendorBillTotalAed(bill: VendorBillReportRow): number {
  const exchangeRate = Number(bill.exchange_rate ?? 1);
  const normalizedExchangeRate =
    Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  return (Number(bill.total_amount) || 0) * normalizedExchangeRate;
}

export function vendorBillOutstandingAed(bill: VendorBillReportRow): number {
  const outstanding = Math.max(
    0,
    (Number(bill.total_amount) || 0) - (Number(bill.amount_paid) || 0)
  );
  const exchangeRate = Number(bill.exchange_rate ?? 1);
  const normalizedExchangeRate =
    Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  return outstanding * normalizedExchangeRate;
}

export function vendorBillPaidAed(bill: VendorBillReportRow): number {
  const total = Math.max(0, Number(bill.total_amount) || 0);
  const paid = Math.min(total, Math.max(0, Number(bill.amount_paid) || 0));
  const exchangeRate = Number(bill.exchange_rate ?? 1);
  const normalizedExchangeRate =
    Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  return paid * normalizedExchangeRate;
}

export function valueInDateRange(value: string | null | undefined, dateRange: DateRange): boolean {
  if (!dateRange.from || !dateRange.to) return true;
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const from = new Date(dateRange.from);
  from.setHours(0, 0, 0, 0);
  const to = new Date(dateRange.to);
  to.setHours(23, 59, 59, 999);
  return date >= from && date <= to;
}

export function invoiceInDateRange(invoice: InvoiceReportRow, dateRange: DateRange): boolean {
  return valueInDateRange(invoice.date, dateRange);
}

export function receiptInDateRange(receipt: ReceiptReportRow, dateRange: DateRange): boolean {
  return valueInDateRange(receipt.date, dateRange);
}

export function vendorBillInDateRange(bill: VendorBillReportRow, dateRange: DateRange): boolean {
  return valueInDateRange(bill.bill_date, dateRange);
}

export function expenseClaimInDateRange(
  claim: ExpenseClaimReportRow,
  dateRange: DateRange
): boolean {
  return valueInDateRange(claim.created_at, dateRange);
}

export function inventoryMovementInDateRange(
  movement: InventoryMovementReportRow,
  dateRange: DateRange
): boolean {
  return valueInDateRange(movement.createdAt, dateRange);
}

export function activityLogInDateRange(log: ActivityLogReportRow, dateRange: DateRange): boolean {
  return valueInDateRange(log.createdAt, dateRange);
}

export function payrollRunPeriodDate(run: PayrollRunReportRow): Date | null {
  const month = Number(run.period_month);
  const year = Number(run.period_year);
  if (!month || !year) return null;
  const date = new Date(year, month - 1, 1);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function payrollRunInDateRange(run: PayrollRunReportRow, dateRange: DateRange): boolean {
  if (!dateRange.from || !dateRange.to) return true;
  const periodDate = payrollRunPeriodDate(run);
  if (!periodDate) return false;
  return valueInDateRange(periodDate.toISOString(), dateRange);
}

export function receiptExchangeRate(receipt: ReceiptReportRow): number {
  const rate = Number(receipt.exchangeRate ?? 1);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

export function receiptSubtotalAed(receipt: ReceiptReportRow): number {
  const base = Number(receipt.baseCurrencyAmount ?? 0);
  if (Number.isFinite(base) && Math.abs(base) > 0.005) return base;
  return (Number(receipt.amount) || 0) * receiptExchangeRate(receipt);
}

export function receiptVatAed(receipt: ReceiptReportRow): number {
  return (Number(receipt.vatAmount) || 0) * receiptExchangeRate(receipt);
}

export function expenseClaimAmount(claim: ExpenseClaimReportRow): number {
  const amount = Number(claim.total_amount ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function payrollAmount(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function payrollPeriodLabel(run?: PayrollRunReportRow | null): string {
  if (!run) return "-";
  const periodDate = payrollRunPeriodDate(run);
  return periodDate ? format(periodDate, "MMM yyyy") : `${run.period_month}/${run.period_year}`;
}

export function fixedAssetAmount(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function roundReportAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isNonDepreciableFixedAsset(asset: Pick<FixedAssetReportRow, "category">): boolean {
  return asset.category.trim().toLowerCase() === "land";
}

export function startOfReportMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function calendarMonthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

export function daysInReportMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function depreciationStatusLabel(status: DepreciationScheduleStatus): string {
  if (status === "ready") return "Ready to post";
  if (status === "fully_depreciated") return "Fully depreciated";
  if (status === "non_depreciable") return "Non-depreciable";
  if (status === "not_acquired") return "Not acquired";
  return "Review";
}

export function depreciationStatusVariant(
  status: DepreciationScheduleStatus
): BadgeProps["variant"] {
  if (status === "ready") return "success";
  if (status === "review") return "warning";
  if (status === "not_acquired") return "neutral";
  return "info";
}

export function calculateDepreciationScheduleRow(
  asset: FixedAssetValuationRow,
  periodDate: Date
): DepreciationScheduleRow {
  const purchaseDate = new Date(asset.purchase_date);
  const purchaseMonth = Number.isNaN(purchaseDate.getTime())
    ? null
    : startOfReportMonth(purchaseDate);
  const periodMonth = startOfReportMonth(periodDate);
  const method = asset.depreciation_method || "straight_line";
  const rawUsefulLifeYears = Number(asset.useful_life_years ?? 0);
  const usefulLifeYears =
    Number.isFinite(rawUsefulLifeYears) && rawUsefulLifeYears > 0 ? rawUsefulLifeYears : null;
  const usefulLifeMonths = usefulLifeYears ? usefulLifeYears * 12 : 0;
  const depreciableBase = Math.max(0, asset.purchaseCost - asset.salvageValue);
  const remainingDepreciable = Math.max(0, depreciableBase - asset.accumulatedDepreciation);
  const baseRow = {
    assetId: asset.id,
    assetName: asset.asset_name,
    assetNumber: asset.asset_number || asset.serial_number || "",
    category: asset.category,
    purchaseDate: asset.purchase_date,
    method,
    usefulLifeYears,
    purchaseCost: asset.purchaseCost,
    salvageValue: asset.salvageValue,
    accumulatedDepreciation: asset.accumulatedDepreciation,
    netBookValue: asset.netBookValue,
    depreciableBase,
    remainingDepreciable,
    monthsRemaining: usefulLifeMonths,
    prorationFactor: 1,
    monthlyDepreciation: 0,
    annualDepreciation: 0,
    projectedAccumulatedDepreciation: asset.accumulatedDepreciation,
    projectedNetBookValue: asset.netBookValue,
  };

  if (isNonDepreciableFixedAsset(asset)) {
    return {
      ...baseRow,
      status: "non_depreciable",
      statusLabel: depreciationStatusLabel("non_depreciable"),
      reviewReason: "Land and other non-depreciable assets are excluded.",
    };
  }

  if (!purchaseMonth || !asset.purchaseCost || !usefulLifeYears || !usefulLifeMonths) {
    return {
      ...baseRow,
      status: "review",
      statusLabel: depreciationStatusLabel("review"),
      reviewReason: !purchaseMonth
        ? "Purchase date is missing or invalid."
        : !asset.purchaseCost
          ? "Purchase cost is missing."
          : "Useful life is missing.",
    };
  }

  const monthsElapsed = calendarMonthsBetween(purchaseMonth, periodMonth);
  if (monthsElapsed < 0) {
    return {
      ...baseRow,
      status: "not_acquired",
      statusLabel: depreciationStatusLabel("not_acquired"),
      reviewReason: "Asset was not acquired by this report period.",
    };
  }

  if (remainingDepreciable <= 0.005 || asset.netBookValue <= asset.salvageValue + 0.005) {
    return {
      ...baseRow,
      monthsRemaining: 0,
      status: "fully_depreciated",
      statusLabel: depreciationStatusLabel("fully_depreciated"),
      reviewReason: "Net book value is at or below salvage value.",
    };
  }

  const monthsRemaining = Math.max(1, usefulLifeMonths - monthsElapsed);
  const currentNetBookValue = Math.max(0, asset.purchaseCost - asset.accumulatedDepreciation);
  let monthlyDepreciation =
    method === "declining_balance"
      ? (currentNetBookValue * (2 / (usefulLifeMonths / 12))) / 12
      : remainingDepreciable / monthsRemaining;
  let prorationFactor = 1;

  if (monthsElapsed === 0) {
    prorationFactor =
      (daysInReportMonth(purchaseDate) - purchaseDate.getDate() + 1) /
      daysInReportMonth(purchaseDate);
    monthlyDepreciation *= prorationFactor;
  }

  monthlyDepreciation = roundReportAmount(
    Math.min(Math.max(0, monthlyDepreciation), remainingDepreciable)
  );
  const projectedAccumulatedDepreciation = roundReportAmount(
    asset.accumulatedDepreciation + monthlyDepreciation
  );
  const projectedNetBookValue = roundReportAmount(
    Math.max(asset.salvageValue, asset.purchaseCost - projectedAccumulatedDepreciation)
  );

  return {
    ...baseRow,
    monthsRemaining,
    prorationFactor,
    monthlyDepreciation,
    annualDepreciation: roundReportAmount(monthlyDepreciation * 12),
    projectedAccumulatedDepreciation,
    projectedNetBookValue,
    status: monthlyDepreciation > 0 ? "ready" : "review",
    statusLabel: depreciationStatusLabel(monthlyDepreciation > 0 ? "ready" : "review"),
    reviewReason:
      monthlyDepreciation > 0
        ? "Estimated depreciation for the report period."
        : "No depreciation amount calculated for this period.",
  };
}

export function buildDepreciationScheduleReport(
  assets: FixedAssetValuationRow[],
  periodDate: Date
): DepreciationScheduleReport {
  const rows = assets
    .map((asset) => calculateDepreciationScheduleRow(asset, periodDate))
    .sort(
      (a, b) =>
        b.monthlyDepreciation - a.monthlyDepreciation || a.assetName.localeCompare(b.assetName)
    );
  const readyRows = rows.filter((row) => row.status === "ready");
  const reviewRows = rows.filter((row) => row.status === "review");

  return {
    period: format(periodDate, "yyyy-MM"),
    rows,
    readyRows,
    reviewRows,
    assetCount: rows.length,
    depreciableAssetCount: rows.filter((row) => row.status !== "non_depreciable").length,
    readyToPostCount: readyRows.length,
    reviewCount: reviewRows.length,
    reviewValueAed: roundReportAmount(
      reviewRows.reduce((sum, row) => sum + Math.max(0, row.remainingDepreciable), 0)
    ),
    fullyDepreciatedCount: rows.filter((row) => row.status === "fully_depreciated").length,
    nonDepreciableCount: rows.filter((row) => row.status === "non_depreciable").length,
    periodDepreciationAed: roundReportAmount(
      readyRows.reduce((sum, row) => sum + row.monthlyDepreciation, 0)
    ),
    annualDepreciationAed: roundReportAmount(
      readyRows.reduce((sum, row) => sum + row.annualDepreciation, 0)
    ),
    remainingDepreciableAed: roundReportAmount(
      rows.reduce((sum, row) => sum + row.remainingDepreciable, 0)
    ),
  };
}

export function buildConsolidatedStatementsReport(
  sources: ConsolidatedCompanyStatementSource[],
  periodLabel: string,
  currency = "AED"
): ConsolidatedStatementsReport {
  const rows = sources
    .map((source) => {
      const revenue = roundReportAmount(source.profitLoss?.totalRevenue ?? 0);
      const expenses = roundReportAmount(source.profitLoss?.totalExpenses ?? 0);
      const netProfit = roundReportAmount(source.profitLoss?.netProfit ?? 0);
      const currentComparisonRevenue = roundReportAmount(
        source.comparisonCurrentProfitLoss?.totalRevenue ?? 0
      );
      const previousRevenue = roundReportAmount(
        source.comparisonPreviousProfitLoss?.totalRevenue ?? 0
      );
      const currentComparisonExpenses = roundReportAmount(
        source.comparisonCurrentProfitLoss?.totalExpenses ?? 0
      );
      const previousExpenses = roundReportAmount(
        source.comparisonPreviousProfitLoss?.totalExpenses ?? 0
      );
      const currentComparisonNetProfit = roundReportAmount(
        source.comparisonCurrentProfitLoss?.netProfit ?? 0
      );
      const previousNetProfit = roundReportAmount(
        source.comparisonPreviousProfitLoss?.netProfit ?? 0
      );
      const assets = roundReportAmount(source.balanceSheet?.totalAssets ?? 0);
      const liabilities = roundReportAmount(source.balanceSheet?.totalLiabilities ?? 0);
      const equity = roundReportAmount(source.balanceSheet?.totalEquity ?? 0);
      const balanceDifference = roundReportAmount(assets - liabilities - equity);
      const isBalanced = Math.abs(balanceDifference) < 0.01;
      const isMultiCurrency = source.baseCurrency !== currency;
      const reviewReasons: string[] = [];
      let status: ConsolidatedStatementStatus = "included";

      if (source.error) {
        status = "failed";
        reviewReasons.push(source.error);
      } else {
        if (!isBalanced) {
          status = "unbalanced";
          reviewReasons.push(`${currency} ${balanceDifference.toFixed(2)} balance difference.`);
        }
        if (isMultiCurrency) {
          if (status === "included") status = "multi_currency";
          reviewReasons.push(`${source.baseCurrency} needs FX translation review.`);
        }
      }

      return {
        companyId: source.companyId,
        companyName: source.companyName,
        companyType: source.companyType,
        baseCurrency: source.baseCurrency,
        revenue,
        expenses,
        netProfit,
        currentComparisonRevenue,
        previousRevenue,
        currentComparisonExpenses,
        previousExpenses,
        currentComparisonNetProfit,
        previousNetProfit,
        assets,
        liabilities,
        equity,
        balanceDifference,
        isBalanced,
        status,
        statusLabel:
          status === "failed"
            ? "Missing data"
            : status === "unbalanced"
              ? "Balance review"
              : status === "multi_currency"
                ? "FX review"
                : "Included",
        reviewReason: reviewReasons.join(" "),
        workflow: "/financial-statements",
      };
    })
    .sort((a, b) => b.netProfit - a.netProfit || a.companyName.localeCompare(b.companyName));

  const loadedRows = rows.filter((row) => row.status !== "failed");
  const failedEntityCount = rows.length - loadedRows.length;
  const unbalancedEntityCount = loadedRows.filter((row) => !row.isBalanced).length;
  const multiCurrencyEntityCount = loadedRows.filter((row) => row.baseCurrency !== currency).length;
  const singleEntityOnly = rows.length === 1;
  const reviewCount =
    failedEntityCount +
    unbalancedEntityCount +
    multiCurrencyEntityCount +
    (singleEntityOnly ? 1 : 0);

  const totalRevenue = roundReportAmount(loadedRows.reduce((sum, row) => sum + row.revenue, 0));
  const totalExpenses = roundReportAmount(loadedRows.reduce((sum, row) => sum + row.expenses, 0));
  const netProfit = roundReportAmount(loadedRows.reduce((sum, row) => sum + row.netProfit, 0));
  const currentComparisonRevenue = roundReportAmount(
    loadedRows.reduce((sum, row) => sum + row.currentComparisonRevenue, 0)
  );
  const previousRevenue = roundReportAmount(
    loadedRows.reduce((sum, row) => sum + row.previousRevenue, 0)
  );
  const currentComparisonExpenses = roundReportAmount(
    loadedRows.reduce((sum, row) => sum + row.currentComparisonExpenses, 0)
  );
  const previousExpenses = roundReportAmount(
    loadedRows.reduce((sum, row) => sum + row.previousExpenses, 0)
  );
  const currentComparisonNetProfit = roundReportAmount(
    loadedRows.reduce((sum, row) => sum + row.currentComparisonNetProfit, 0)
  );
  const previousNetProfit = roundReportAmount(
    loadedRows.reduce((sum, row) => sum + row.previousNetProfit, 0)
  );
  const totalAssets = roundReportAmount(loadedRows.reduce((sum, row) => sum + row.assets, 0));
  const totalLiabilities = roundReportAmount(
    loadedRows.reduce((sum, row) => sum + row.liabilities, 0)
  );
  const totalEquity = roundReportAmount(loadedRows.reduce((sum, row) => sum + row.equity, 0));
  const balanceDifference = roundReportAmount(totalAssets - totalLiabilities - totalEquity);

  return {
    periodLabel,
    currency,
    consolidationBasis: "Management roll-up of accessible companies; no eliminations applied.",
    rows,
    entityCount: rows.length,
    loadedEntityCount: loadedRows.length,
    failedEntityCount,
    unbalancedEntityCount,
    multiCurrencyEntityCount,
    reviewCount,
    singleEntityOnly,
    totalRevenue,
    totalExpenses,
    netProfit,
    currentComparisonRevenue,
    previousRevenue,
    currentComparisonExpenses,
    previousExpenses,
    currentComparisonNetProfit,
    previousNetProfit,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanceDifference,
    eliminationsApplied: 0,
    statusLabel:
      reviewCount > 0
        ? singleEntityOnly
          ? "Single entity roll-up"
          : "Review before delivery"
        : "Ready for pack",
  };
}

export function inventoryAmount(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function inventoryMovementValue(movement: InventoryMovementReportRow): number {
  return Math.abs(Number(movement.quantity ?? 0) || 0) * inventoryAmount(movement.unitCost);
}

export function journalEntryInDateRange(
  entry: JournalEntryReportRow,
  dateRange: DateRange
): boolean {
  return valueInDateRange(entry.date, dateRange);
}

export function journalAccountName(account?: JournalAccount | null): string {
  return account?.nameEn || account?.nameAr || "Unknown Account";
}

export function journalSourceLabel(source?: string | null): string {
  if (!source) return "Manual / no source";
  return source.replace(/[_-]+/g, " ");
}

export function formatReportDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : format(date, "MMM dd, yyyy");
}

export function consolidatedStatusVariant(
  status: ConsolidatedStatementStatus
): BadgeProps["variant"] {
  if (status === "included") return "success";
  if (status === "multi_currency") return "info";
  if (status === "unbalanced") return "warning";
  return "danger";
}

export function invoiceStatusLabel(status: string): string {
  return invoiceStatusLabels[status] ?? status;
}

export function invoiceStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "paid") return "success";
  if (status === "sent" || status === "posted") return "info";
  if (status === "partial") return "warning";
  if (status === "void" || status === "cancelled") return "danger";
  return "neutral";
}

export function expenseClaimStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "paid") return "success";
  if (status === "approved") return "info";
  if (status === "submitted") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

export function payrollStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "approved" || status === "paid") return "success";
  if (status === "calculated") return "info";
  if (status === "draft") return "warning";
  return "neutral";
}

export function fixedAssetStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "active") return "success";
  if (status === "disposed") return "neutral";
  return "warning";
}

export function inventoryMovementVariant(type: string): BadgeProps["variant"] {
  if (type === "purchase" || type === "return") return "success";
  if (type === "sale") return "info";
  if (type === "adjustment") return "warning";
  return "neutral";
}

export function activityLogLabel(value: string | null | undefined, fallback = "Unknown"): string {
  if (!value) return fallback;
  return value.replace(/[_.-]+/g, " ");
}

export function activityLogRiskLevel(log: ActivityLogReportRow): ActivityLogRiskLevel {
  const signal = `${log.action} ${log.description}`.toLowerCase();
  if (/(delete|void|reject|failed|error|remove|archive)/.test(signal)) return "High";
  if (/(update|approve|post|journal|close|permission|admin|invite)/.test(signal)) return "Medium";
  return "Low";
}

export function activityLogRiskVariant(risk: ActivityLogRiskLevel): BadgeProps["variant"] {
  if (risk === "High") return "danger";
  if (risk === "Medium") return "warning";
  return "success";
}

export function corporateTaxEstimateStatus(report?: CorporateTaxEstimateReport | null): {
  label: string;
  detail: string;
  variant: BadgeProps["variant"];
} {
  if (!report) {
    return {
      label: "Pending estimate",
      detail: "Waiting for posted journal data.",
      variant: "neutral",
    };
  }

  if (report.taxPayable > 0.005) {
    return {
      label: "Tax due",
      detail: "Review the tax workpaper before drafting the return.",
      variant: "warning",
    };
  }

  if (report.taxableIncome <= 0) {
    return {
      label: "No taxable income",
      detail: "The selected period is at or below break-even before adjustments.",
      variant: "success",
    };
  }

  return {
    label: "Below threshold",
    detail: "Taxable income is below the zero-rate band used by the workspace.",
    variant: "success",
  };
}

export function reportTabFromSearch(search: string): ReportTab {
  const tab = new URLSearchParams(search).get("tab");
  return reportTabs.includes(tab as ReportTab) ? (tab as ReportTab) : "pl";
}

export function reportIdFromSearch(search: string): string | null {
  const reportId = new URLSearchParams(search).get("report");
  return readyReportCatalog.some((report) => report.id === reportId) ? reportId : null;
}

export function personaFilterFromSearch(
  search: string,
  fallbackPersona: ReportPersona | null = null
): PersonaFilter {
  const persona = new URLSearchParams(search).get("persona");
  if (persona === "all") return "all";
  return reportPersonas.includes(persona as ReportPersona)
    ? (persona as ReportPersona)
    : (fallbackPersona ?? "all");
}

export function reportWorkflowSearchFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("workflowSearch");
  return value === null ? null : normalizeReportWorkflowSearch(value);
}

export function reportWorkflowGapFilterFromSearch(
  search: string,
  fallbackPersona: PersonaFilter
): ReportWorkflowGapFilterState {
  const params = new URLSearchParams(search);
  const type = parseReportWorkflowGapFilter(params.get("workflowGap"));
  const persona =
    parseReportPersona(params.get("workflowGapPersona")) ??
    (fallbackPersona === "all" ? null : fallbackPersona);

  if (!persona) {
    return { type: "all", persona: null };
  }

  const preferredType = type ?? getPreferredReportWorkflowGapFilter(persona);
  return preferredType ? { type: preferredType, persona } : { type: "all", persona: null };
}

export function matchesReportPersona(personas: ReportPersona[], persona: PersonaFilter): boolean {
  return persona === "all" || personas.includes(persona);
}

export function uniqueSorted<T extends string>(values: Iterable<T>): T[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export function buildReportCoverageMap(
  reports: readonly ReportCatalogItem[],
  workbookReportIds: ReadonlySet<string> = new Set<string>()
): ReportCoverageCategory[] {
  const byCategory = new Map<
    string,
    {
      category: string;
      reports: ReportCatalogItem[];
      liveCount: number;
      apiReadyCount: number;
      plannedCount: number;
      workbookCount: number;
      comparisonTypes: Set<string>;
      automationHooks: Set<string>;
      personas: Set<ReportPersona>;
    }
  >();

  for (const report of reports) {
    const bucket = byCategory.get(report.category) ?? {
      category: report.category,
      reports: [],
      liveCount: 0,
      apiReadyCount: 0,
      plannedCount: 0,
      workbookCount: 0,
      comparisonTypes: new Set<string>(),
      automationHooks: new Set<string>(),
      personas: new Set<ReportPersona>(),
    };

    bucket.reports.push(report);
    if (report.status === "live") bucket.liveCount += 1;
    if (report.status === "api") bucket.apiReadyCount += 1;
    if (report.status === "planned") bucket.plannedCount += 1;
    if (workbookReportIds.has(report.id)) bucket.workbookCount += 1;
    bucket.comparisonTypes.add(report.comparison);
    bucket.automationHooks.add(report.automation);
    report.personas.forEach((persona) => bucket.personas.add(persona));
    byCategory.set(report.category, bucket);
  }

  return Array.from(byCategory.values())
    .map((bucket) => ({
      category: bucket.category,
      reports: bucket.reports,
      liveCount: bucket.liveCount,
      apiReadyCount: bucket.apiReadyCount,
      plannedCount: bucket.plannedCount,
      workbookCount: bucket.workbookCount,
      comparisonTypes: uniqueSorted(bucket.comparisonTypes),
      automationHooks: uniqueSorted(bucket.automationHooks),
      personas: uniqueSorted(bucket.personas),
    }))
    .sort(
      (a, b) =>
        b.reports.length - a.reports.length ||
        b.workbookCount - a.workbookCount ||
        a.category.localeCompare(b.category)
    );
}

export function startOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function inclusiveDayCount(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(
    1,
    Math.round((startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) / msPerDay) + 1
  );
}

export function averageDaysOverdue<T>(
  rows: T[],
  dueDateForRow: (row: T) => string | null,
  range: ComparisonRange
): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const rangeEnd = startOfLocalDay(range.to);
  const overdueDays = rows
    .map((row) => {
      const dueDateValue = dueDateForRow(row);
      if (!dueDateValue) return null;
      const dueDate = new Date(dueDateValue);
      if (Number.isNaN(dueDate.getTime())) return null;
      return Math.max(
        0,
        Math.floor((rangeEnd.getTime() - startOfLocalDay(dueDate).getTime()) / msPerDay)
      );
    })
    .filter((days): days is number => typeof days === "number");

  if (overdueDays.length === 0) return 0;

  return (
    Math.round((overdueDays.reduce((sum, days) => sum + days, 0) / overdueDays.length) * 10) / 10
  );
}

export function dueWithinDaysAfterRangeEnd<T>(
  rows: T[],
  dueDateForRow: (row: T) => string | null,
  range: ComparisonRange,
  daysAfterRangeEnd = 7
): T[] {
  const rangeEnd = startOfLocalDay(range.to);
  const dueSoonEnd = addDays(rangeEnd, daysAfterRangeEnd);

  return rows.filter((row) => {
    const dueDateValue = dueDateForRow(row);
    if (!dueDateValue) return false;
    const dueDate = new Date(dueDateValue);
    if (Number.isNaN(dueDate.getTime())) return false;
    const dueDay = startOfLocalDay(dueDate);
    return dueDay > rangeEnd && dueDay <= dueSoonEnd;
  });
}

export function buildComparisonRanges(dateRange: DateRange): {
  current: ComparisonRange;
  previous: ComparisonRange;
  isCustom: boolean;
} {
  const today = startOfLocalDay(new Date());
  const currentFrom =
    dateRange.from && dateRange.to
      ? startOfLocalDay(dateRange.from)
      : new Date(today.getFullYear(), today.getMonth(), 1);
  const currentTo = dateRange.from && dateRange.to ? startOfLocalDay(dateRange.to) : today;
  const days = inclusiveDayCount(currentFrom, currentTo);
  const previousTo = addDays(currentFrom, -1);
  const previousFrom = addDays(previousTo, -days + 1);

  return {
    current: { from: currentFrom, to: currentTo },
    previous: { from: previousFrom, to: previousTo },
    isCustom: Boolean(dateRange.from && dateRange.to),
  };
}

export function comparisonParams(range: ComparisonRange): string {
  return `?startDate=${format(range.from, "yyyy-MM-dd")}&endDate=${format(range.to, "yyyy-MM-dd")}`;
}

export function percentageChange(current: number, previous: number): number | null {
  if (Math.abs(previous) < 0.005) return Math.abs(current) < 0.005 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function normalizeMonthlyBurn(
  totalRevenue: number,
  totalExpenses: number,
  days: number
): number {
  const dailyBurn = Math.max(0, totalExpenses - totalRevenue) / Math.max(1, days);
  return Math.round(dailyBurn * 30 * 100) / 100;
}

export function runwayCoverageDays(
  cashBalance: number,
  monthlyBurn: number,
  horizonDays = 90
): number {
  if (monthlyBurn <= 0.005) return horizonDays;
  if (cashBalance <= 0) return 0;
  const dailyBurn = monthlyBurn / 30;
  return Math.round(Math.min(horizonDays, cashBalance / dailyBurn) * 10) / 10;
}

export function ratioPercent(numerator: number, denominator: number): number {
  if (Math.abs(denominator) <= 0.005) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

export function averageAvailablePercent(values: Array<number | null | undefined>): number {
  const available = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (available.length === 0) return 0;

  return (
    Math.round((available.reduce((sum, value) => sum + value, 0) / available.length) * 100) / 100
  );
}

export function formatComparisonPercent(value: number | null): string {
  if (value === null) return "New";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function formatComparisonValue(
  row: ComparisonMetricRow,
  value: number,
  locale: string
): string {
  if (row.currency === "%") return `${value.toFixed(1)}%`;
  if (row.currency === "days") return `${value.toFixed(1)} days`;
  if (row.currency === "count") {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  }
  return formatCurrency(value, row.currency, locale);
}

export function formatComparisonExportValue(row: ComparisonMetricRow, value: number): string {
  if (row.currency === "%") return `${value.toFixed(1)}%`;
  if (row.currency === "days") return `${value.toFixed(1)} days`;
  if (row.currency === "count") return `${Math.round(value)}`;
  return `${row.currency} ${value.toFixed(2)}`;
}

export function comparisonBadgeVariant(row: ComparisonMetricRow): BadgeProps["variant"] {
  if (Math.abs(row.delta) < 0.005) return "neutral";
  if (row.favorable === "neutral") return row.delta >= 0 ? "info" : "neutral";
  const improved = row.favorable === "increase" ? row.delta > 0 : row.delta < 0;
  return improved ? "success" : "warning";
}

/** A spend (non-income) line whose actual exceeds its budget (R13 / W3-E sign convention). */
export function isOverBudgetLine(line: Pick<VarianceLine, "accountType" | "totals">): boolean {
  return line.accountType !== "income" && line.totals.actual > line.totals.budget;
}

export function makeComparisonMetric(
  input: Omit<ComparisonMetricRow, "delta" | "percentChange">
): ComparisonMetricRow {
  const delta = input.current - input.previous;
  return {
    ...input,
    delta,
    percentChange: percentageChange(input.current, input.previous),
  };
}

export function normalizeDeliverySetting(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatDeliveryRunTimestamp(value: string | null | undefined): string {
  if (!value) return "No runs yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, "MMM d, HH:mm");
}

export function deliveryRunStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "sent") return "success";
  if (status === "failed" || status === "cancelled") return "destructive";
  if (status === "blocked") return "warning";
  return "info";
}

export function matchesReportDeliveryRunStatusFilter(
  status: string,
  filter: ReportDeliveryRunStatusFilter
): boolean {
  if (filter === "all") return true;
  return status === filter;
}

export function reportDeliveryAutomationCommandCardClass(
  command: ReportDeliveryAutomationCommand,
  pinnedCommand: ReportDeliveryAutomationCommand | null
): string {
  return [
    "rounded-md border p-2",
    command === pinnedCommand ? "border-accent bg-accent/5" : "border-transparent bg-secondary/40",
  ].join(" ");
}

export function deliveryPreviewCheckVariant(
  status: ReportDeliveryPlanPreview["checklist"][number]["status"]
): BadgeProps["variant"] {
  if (status === "ready") return "success";
  if (status === "paused") return "neutral";
  return "warning";
}
