import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link, useLocation, useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/page-header";
import {
  ReportLaunchPicker,
  type ReportLaunchDeliveryPreview,
} from "@/components/reports/ReportLaunchPicker";
import { useTranslation } from "@/lib/i18n";
import { reportNameAr, reportQuestionAr, reportCategoryAr } from "@/lib/reportCatalogI18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { evidenceSectionHref, evidenceSourceHref } from "@/lib/evidenceLinks";
import {
  type ExportData,
  exportToExcel,
  exportToGoogleSheets,
  prepareProfitLossForExport,
  prepareCostCenterProfitabilityForExport,
  prepareBalanceSheetForExport,
  prepareVATSummaryForExport,
  prepareCorporateTaxEstimateForExport,
  prepareMonthEndCloseStatusForExport,
  prepareAuditTrailForExport,
  prepareTrialBalanceForExport,
  prepareInvoiceStatusForExport,
  prepareBalanceSummaryReportsForExport,
  prepareCashFlowStatementForExport,
  prepareAgingReportsForExport,
  prepareExpenseReportsForExport,
  prepareFxGainsLossesForExport,
  preparePayrollReportsForExport,
  preparePeriodComparisonForExport,
  prepareLedgerReportsForExport,
  prepareConsolidatedStatementsForExport,
  preparePlanningReportsForExport,
} from "@/lib/export";
import { prepareVat201ForExport, type Vat201ExportReturn } from "@/lib/vat201-export";
import { apiRequest } from "@/lib/queryClient";
import {
  fetchReportCatalogDiscovery,
  reportCatalogDiscoveryQueryKey,
  type ReportCatalogDiscovery,
} from "@/lib/reportCatalogApi";
import {
  reportAutomationTriggerRuleHref,
  reportAutomationTriggerRules,
  reportAutomationStarterHref,
  reportAutomationStarters,
  calculateReportAutomationImpact,
  buildReportAutomationHealthTrend,
  buildReportAutomationRunbookSteps,
  calculateReportAutomationHealth,
  clearPreferredReportPersona,
  clearPreferredReportWorkflowGapFilter,
  clearPreferredReportWorkflowSearch,
  getPreferredReportDeliveryAutomationCommand,
  getPreferredReportPersona,
  getPreferredReportWorkflowGapFilter,
  getPreferredReportWorkflowSearch,
  getFavoriteReportIds,
  getReportAutomationHealthHistory,
  normalizeReportWorkflowSearch,
  parseReportDeliveryAutomationCommand,
  parseReportPersona,
  parseReportWorkflowGapFilter,
  recordReportAutomationHealthSnapshots,
  reportComparisonPresetHref,
  reportComparisonPresets,
  reportAutomationImpactProfiles,
  reportDecisionShortcutHref,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  readyReportCatalog,
  reportCatalog,
  reportAutomationPlaybookHref,
  reportManagementBriefHref,
  reportManagementBriefProfiles,
  reportPackTemplateHref,
  reportPackTemplates,
  reportPersonaHref,
  reportPersonas,
  reportPersonaWorkspaces,
  reportProductDepthAreaHref,
  reportProductDepthAreas,
  reportProductDepthSubgoalHref,
  reportQuickAccessProfiles,
  reportRoleWorkflowStepHref,
  reportSavedViewHref,
  reportSavedViewProfiles,
  reportSectionHref,
  reportSuiteHref,
  reportSuiteProfiles,
  reportTabs,
  reportWorkflowGapFilterLabels,
  reportWorkflowContextHref,
  reportHref,
  reportsHref,
  reportWorkspaceHref,
  setPreferredReportPersona,
  setPreferredReportDeliveryAutomationCommand,
  setPreferredReportWorkflowGapFilter,
  setPreferredReportWorkflowSearch,
  toggleFavoriteReportId,
  type ReportCatalogItem,
  type ReportAutomationTriggerSeverity,
  type ReportDeliveryAutomationCommand,
  type ReportEvidenceCheckpointStatus,
  type ReportPersona,
  type ReportProductDepthStatus,
  type ReportStatus,
  type ReportTab,
  type ReportWorkflowGapFilter,
  type ReportWorkspaceIcon,
} from "@/lib/reportCatalog";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileText,
  Send,
  Scale,
  Sparkles,
  Wallet,
  TrendingUp,
  TrendingDown,
  DollarSign,
  ListFilter,
  Pencil,
  Pin,
  RotateCcw,
  Save,
  Search,
  X,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SiGooglesheets } from "react-icons/si";
import type { Company } from "@shared/schema";
import { messages as pageMessages } from "./Reports.i18n";

interface AccountLineItem {
  accountCode?: string;
  accountName: string;
  amount: number;
}

interface ProfitLossReport {
  revenue: AccountLineItem[];
  expenses: AccountLineItem[];
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
}

interface CostCenterProfitabilityRow {
  costCenterId: string;
  code: string;
  name: string;
  isActive: boolean;
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  lineCount: number;
}

interface CostCenterProfitabilityReport {
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

interface BalanceSheetReport {
  assets: AccountLineItem[];
  liabilities: AccountLineItem[];
  equity: AccountLineItem[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

interface ConsolidatedCompanyStatementSource {
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

interface ReportDeliverySettingsDraft {
  cadence: string;
  channel: string;
  format: string;
  recipients: string;
  deliveryGuardrail: string;
}

interface SaveReportDeliverySubscriptionSettingsInput {
  subscriptionId: string;
  enabled?: boolean;
  cadence?: string | null;
  channel?: string | null;
  format?: string | null;
  recipients?: string | null;
  deliveryGuardrail?: string | null;
}

interface SaveReportDeliveryAutomationPreferenceInput {
  persona: ReportPersona;
  command: ReportDeliveryAutomationCommand;
}

interface ReportDeliveryAutomationPreferenceResponse {
  persona: ReportPersona;
  preferredDeliveryAutomationCommand: ReportDeliveryAutomationCommand | null;
}

interface ReportDeliveryPlanPreview {
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

interface ReportDeliveryPlanResponse {
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

interface ReportDeliveryRunSummary {
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
  createdAt: string;
}

type ReportDeliveryRunStatusFilter = "all" | "queued" | "sent" | "failed";

interface ReportDeliverySchedulerHandoffReview {
  subscriptionId: string;
  gap: ReportWorkflowGapFilter;
  message?: string;
  detail: string;
  latestRunId?: string | null;
}

interface ReportDeliverySchedulerScanSnapshot {
  skippedHandoff?: number;
  handoffReviews?: ReportDeliverySchedulerHandoffReview[];
  skippedSubscriptionIds?: Partial<
    Record<"paused" | "setup" | "not_due" | "handoff" | "no_actor", string[]>
  >;
}

interface ReportDeliverySchedulerScanSummary {
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

type ConsolidatedStatementStatus = "included" | "unbalanced" | "multi_currency" | "failed";

interface ConsolidatedStatementEntityRow {
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

interface ConsolidatedStatementsReport {
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

interface VATSummaryReport {
  period: string;
  salesSubtotal: number;
  salesVAT: number;
  purchasesSubtotal: number;
  purchasesVAT: number;
  netVATPayable: number;
}

interface CashFlowStatementRow {
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

interface AgingReportItem {
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

interface BillAgingBucket {
  amount: number;
  count: number;
}

interface BillAgingReport {
  current: BillAgingBucket;
  days_1_30: BillAgingBucket;
  days_31_60: BillAgingBucket;
  days_61_90: BillAgingBucket;
  days_90_plus: BillAgingBucket;
}

interface AdvancedPeriodComparisonRow {
  metric: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

interface FxGainsLossesItem {
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

interface FxGainsLossesReport {
  asOf: string;
  baseCurrency: string;
  receivables: FxGainsLossesItem[];
  payables: FxGainsLossesItem[];
  totalUnrealizedGain: number;
  totalUnrealizedLoss: number;
  netUnrealizedGainLoss: number;
}

type VATReturnReportRow = Vat201ExportReturn & {
  id: string;
  submittedAt?: string | null;
  ftaReferenceNumber?: string | null;
  paymentStatus?: string | null;
  paymentAmount?: number | null;
  paymentDate?: string | null;
};

interface CorporateTaxEstimateReport {
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

interface TrialBalanceRow {
  accountId: string;
  accountName: string;
  accountCode?: string | null;
  accountType: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
  hasForeignLines: boolean;
}

interface TrialBalanceReport {
  reportCurrency: string;
  rows: TrialBalanceRow[];
  totals: {
    sumDebits: number;
    sumCredits: number;
    difference: number;
  };
}

interface InvoiceReportRow {
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

interface OverdueInvoiceRow {
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

interface OverdueResponse {
  rows: OverdueInvoiceRow[];
  totalOutstanding: number;
}

interface VendorBillReportRow {
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

interface InvoiceStatusSummaryRow {
  status: string;
  count: number;
  amountAed: number;
}

interface CustomerRevenueRow {
  customerName: string;
  invoiceCount: number;
  amountAed: number;
}

interface ProductServiceSalesRow {
  productService: string;
  invoiceCount: number;
  lineCount: number;
  quantity: number;
  amountAed: number;
  vatAed: number;
  averageUnitPriceAed: number;
  supplyTypes: string[];
}

interface SalesProductServiceReport {
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

interface OverdueCustomerRow {
  customerName: string;
  currency: string;
  invoiceCount: number;
  outstanding: number;
  maxDaysOverdue: number;
  recommendedLevel: number;
}

interface ReceiptReportRow {
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

interface BankTransactionReportRow {
  id: string;
  transactionDate: string;
  amount: number | string;
  matchStatus: string;
  isReconciled: boolean;
}

interface ExpenseSummaryRow {
  label: string;
  entryCount: number;
  lineCount: number;
  debitAed: number;
  creditAed: number;
  netExpenseAed: number;
}

interface ExpenseClaimReportRow {
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

interface ExpenseClaimSummaryBucket {
  count: number;
  total: number;
}

interface ExpenseClaimSummaryReport {
  all: Record<string, ExpenseClaimSummaryBucket>;
  thisMonth: Record<string, ExpenseClaimSummaryBucket>;
}

interface ExpenseClaimStatusRow {
  status: string;
  count: number;
  totalAmount: number;
}

interface PayrollRunReportRow {
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

interface PayrollStatusReportRow {
  status: string;
  count: number;
  employeeCount: number;
  totalNet: number;
}

interface JournalAccount {
  id: string;
  code?: string | null;
  nameEn?: string | null;
  nameAr?: string | null;
  type?: string | null;
}

interface JournalLineReportRow {
  id: string;
  entryId: string;
  accountId: string;
  debit: number;
  credit: number;
  memo?: string | null;
  foreignCurrency?: string | null;
  account?: JournalAccount | null;
}

interface JournalEntryReportRow {
  id: string;
  entryNumber: string;
  date: string;
  memo?: string | null;
  source?: string | null;
  sourceId?: string | null;
  status: string;
  lines?: JournalLineReportRow[];
}

interface LedgerLineRow {
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

interface AccountActivityRow {
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

interface LedgerSourceRow {
  source: string;
  entryCount: number;
  lineCount: number;
  amountAed: number;
  needsReview: boolean;
}

interface MonthEndChecklistItem {
  id: number;
  title: string;
  description: string;
  status: "complete" | "incomplete";
  details?: string;
}

interface MonthEndCloseStatusReport {
  period: string;
  periodStart: string;
  periodEnd: string;
  checklist: MonthEndChecklistItem[];
}

interface ActivityLogReportRow {
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

type ActivityLogRiskLevel = "High" | "Medium" | "Low";

interface AuditTrailSummaryRow {
  key: string;
  label: string;
  count: number;
  latestAt: string | null;
}

interface BudgetPlanReportRow {
  id: string;
  name: string;
  fiscal_year: number;
  start_date: string;
  end_date: string;
  status: string;
  total_budget?: string | number | null;
}

interface VarianceMonth {
  budget: number;
  actual: number;
  variance: number;
  variancePercent: number;
}

interface VarianceLine {
  id: string;
  category: string;
  description: string | null;
  accountId: string | null;
  months: Record<string, VarianceMonth>;
  totals: {
    budget: number;
    actual: number;
    variance: number;
    variancePercent: number;
  };
}

interface VarianceReport {
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

interface CashFlowProjection {
  week: number;
  weekStart: string;
  weekEnd: string;
  expectedInflows: number;
  expectedOutflows: number;
  projectedBalance: number;
}

interface CashFlowForecastReport {
  currentBalance: number;
  projections: CashFlowProjection[];
  insights: string[];
}

interface CustomerBalanceRow {
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

interface VendorBalanceRow {
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

interface BalanceSummaryReport {
  generatedAt: string;
  customers: CustomerBalanceRow[];
  vendors: VendorBalanceRow[];
}

interface FixedAssetReportRow {
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

interface FixedAssetCategorySummaryRow {
  category: string;
  count: number;
  totalCost: number;
  totalAccumulatedDepreciation: number;
  totalNetBookValue: number;
}

interface FixedAssetSummaryReport {
  totalAssets: number;
  totalCost: number;
  totalAccumulatedDepreciation: number;
  totalNetBookValue: number;
  byCategory: FixedAssetCategorySummaryRow[];
}

interface FixedAssetValuationRow extends FixedAssetReportRow {
  purchaseCost: number;
  salvageValue: number;
  accumulatedDepreciation: number;
  netBookValue: number;
}

type DepreciationScheduleStatus =
  | "ready"
  | "review"
  | "fully_depreciated"
  | "non_depreciable"
  | "not_acquired";

interface DepreciationScheduleRow {
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

interface DepreciationScheduleReport {
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

interface InventoryProductReportRow {
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

interface InventoryMovementReportRow {
  id: string;
  productId: string;
  type: "purchase" | "sale" | "adjustment" | "return";
  quantity: number;
  unitCost: string | number | null;
  reference: string | null;
  notes?: string | null;
  createdAt: string | null;
}

interface InventoryMovementTypeRow {
  type: string;
  count: number;
  quantity: number;
  valueAed: number;
}

type PersonaFilter = "all" | ReportPersona;
type ReportWorkflowFinderGapFilter = "all" | ReportWorkflowGapFilter;
type ReportWorkflowCoverageCueId = "pack" | "schedule" | "alert" | "delivery";

interface ReportWorkflowCoverageCue {
  id: ReportWorkflowCoverageCueId;
  label: string;
  detail: string;
  variant: BadgeProps["variant"];
}

interface ReportWorkflowCoverageContext {
  persona: ReportPersona;
  reportIds: string[];
  packTemplateId?: string;
  automationStarterId?: string;
  triggerRuleIds?: string[];
  deliverySubscriptionId?: string;
}

interface ReportWorkflowFinderAction {
  href: string;
  label: string;
  testId: string;
}

interface ReportWorkflowFinderResult {
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

interface ReportWorkflowGapFilterState {
  type: ReportWorkflowFinderGapFilter;
  persona: ReportPersona | null;
}

function reportWorkflowCue(
  result: ReportWorkflowFinderResult,
  cueId: ReportWorkflowCoverageCueId
): ReportWorkflowCoverageCue | undefined {
  return result.coverageCues.find((cue) => cue.id === cueId);
}

function matchesReportWorkflowGapFilter(
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

interface AutomationQueueItem {
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

interface ComparisonRange {
  from: Date;
  to: Date;
}

interface ComparisonMetricRow {
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

interface ReportCoverageCategory {
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

const getReportStatusMeta = (): Record<
  ReportStatus,
  { label: string; variant: BadgeProps["variant"] }
> => ({
  live: { label: pageMessages.t("live"), variant: "success" },
  api: { label: pageMessages.t("apiReady"), variant: "info" },
  planned: { label: pageMessages.t("planned"), variant: "neutral" },
});

const getRoadmapImpactMeta = () =>
  ({
    high: { label: pageMessages.t("highImpact"), variant: "warning" },
    medium: { label: pageMessages.t("mediumImpact"), variant: "info" },
    low: { label: pageMessages.t("lowImpact"), variant: "neutral" },
  }) as const satisfies Record<string, { label: string; variant: BadgeProps["variant"] }>;

const getTriggerSeverityMeta = () =>
  ({
    critical: { label: pageMessages.t("critical"), variant: "danger" },
    review: { label: pageMessages.t("review"), variant: "warning" },
    info: { label: pageMessages.t("monitor"), variant: "info" },
  }) as const satisfies Record<
    ReportAutomationTriggerSeverity,
    { label: string; variant: BadgeProps["variant"] }
  >;

const getProductDepthStatusMeta = () =>
  ({
    working: { label: pageMessages.t("working"), variant: "success" },
    hardening: { label: pageMessages.t("hardening"), variant: "warning" },
    "data-needed": { label: pageMessages.t("dataNeeded"), variant: "info" },
  }) as const satisfies Record<
    ReportProductDepthStatus,
    { label: string; variant: BadgeProps["variant"] }
  >;

const getProductDepthEvidenceCheckpointStatusMeta = () =>
  ({
    "current-proxy": { label: pageMessages.t("currentProxy"), variant: "neutral" },
    "missing-source": { label: pageMessages.t("missingSource"), variant: "warning" },
    guardrail: { label: pageMessages.t("guardrail"), variant: "info" },
  }) as const satisfies Record<
    ReportEvidenceCheckpointStatus,
    { label: string; variant: BadgeProps["variant"] }
  >;

const getPersonaFilters = (): Array<{ id: PersonaFilter; label: string }> => [
  { id: "all", label: pageMessages.t("all") },
  { id: "owner", label: pageMessages.t("owner") },
  { id: "freelancer", label: pageMessages.t("freelancer") },
  { id: "accountant", label: pageMessages.t("accountant") },
];

const getReportViewerCategoryLabels = (): Record<string, string> => ({
  "Financial Statements": pageMessages.t("financialStatements"),
  "Sales & Receivables": pageMessages.t("salesReceivables"),
  "Purchases & Payables": pageMessages.t("purchasesPayables"),
  Payroll: pageMessages.t("payroll"),
  "Accountant & Taxes": pageMessages.t("accountantTaxes"),
  "Inventory & Assets": pageMessages.t("inventoryAssets"),
  "Management & Planning": pageMessages.t("managementPlanning"),
});

// i18n-ignore-start: category identifiers matched against the report catalog; display labels are translated in reportViewerCategoryLabels
const reportViewerCategoryOrder = [
  "Financial Statements",
  "Sales & Receivables",
  "Purchases & Payables",
  "Payroll",
  "Accountant & Taxes",
  "Inventory & Assets",
  "Management & Planning",
] as const;

const reportViewerCategoryByReportId: Record<string, string> = {
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
// i18n-ignore-end

const reportViewerPersonaPriority: ReportPersona[] = ["owner", "freelancer", "accountant"];
const ledgerDetailPageSize = 50;

interface ReportViewerOption {
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

interface ReportViewerGroup {
  category: string;
  label: string;
  rank: number;
  options: ReportViewerOption[];
}

function reportViewerCategoryLabel(category: string): string {
  return getReportViewerCategoryLabels()[category] ?? category;
}

function reportViewerCategoryForReport(report: ReportCatalogItem): string {
  return reportViewerCategoryByReportId[report.id] ?? report.category;
}

function reportViewerCategoryRank(category: string): number {
  const index = reportViewerCategoryOrder.indexOf(
    category as (typeof reportViewerCategoryOrder)[number]
  );
  return index === -1 ? reportViewerCategoryOrder.length : index;
}

function reportViewerPersonaForReport(
  report: ReportCatalogItem,
  currentPersona: ReportPersona
): ReportPersona | undefined {
  if (report.personas.includes(currentPersona)) return currentPersona;
  return reportViewerPersonaPriority.find((persona) => report.personas.includes(persona));
}

type ReportWorkspaceTab =
  | "home"
  | "reports"
  | "suites"
  | "comparisons"
  | "automation"
  | "delivery"
  | "setup";

const getReportWorkspaceTabs = (): Array<{
  id: ReportWorkspaceTab;
  label: string;
  description: string;
}> => [
  {
    id: "home",
    label: pageMessages.t("home"),
    description: pageMessages.t("topReportsAndNextAction"),
  },
  {
    id: "reports",
    label: pageMessages.t("reports"),
    description: pageMessages.t("librarySavedViewsStatements"),
  },
  {
    id: "suites",
    label: pageMessages.t("suites"),
    description: pageMessages.t("managementPacksAndBundles"),
  },
  {
    id: "comparisons",
    label: pageMessages.t("compare"),
    description: pageMessages.t("periodMovementAndSnapshots"),
  },
  {
    id: "automation",
    label: pageMessages.t("automate"),
    description: pageMessages.t("rulesQueuesCommandCenter"),
  },
  {
    id: "delivery",
    label: pageMessages.t("delivery"),
    description: pageMessages.t("schedulesPacksHandoff"),
  },
  {
    id: "setup",
    label: pageMessages.t("setup"),
    description: pageMessages.t("roleWorkflowsAndRoadmap"),
  },
];

function reportWorkspaceTabFromLocation(search: string, hash: string): ReportWorkspaceTab {
  const anchor = hash.replace(/^#/, "");
  const params = new URLSearchParams(search);
  const workspace = params.get("workspace");

  if (getReportWorkspaceTabs().some((tab) => tab.id === workspace)) {
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

function reportsWorkspaceHref({
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

const getReportDeliveryRunStatusFilters = (): Array<{
  id: ReportDeliveryRunStatusFilter;
  label: string;
}> => [
  { id: "all", label: pageMessages.t("allRuns") },
  { id: "queued", label: pageMessages.t("queued") },
  { id: "sent", label: pageMessages.t("sent") },
  { id: "failed", label: pageMessages.t("failed") },
];

const getReportDeliveryAutomationCommandLabels = (): Record<
  ReportDeliveryAutomationCommand,
  string
> => ({
  retry: pageMessages.t("retryRecovery"),
  review: pageMessages.t("reviewGuardrails"),
  queue: pageMessages.t("queueNextPack"),
  comparison: pageMessages.t("openComparison"),
});

const reportWorkspaceIcons: Record<ReportWorkspaceIcon, LucideIcon> = {
  briefcase: Briefcase,
  clipboardCheck: ClipboardCheck,
  users: Users,
};

const getInvoiceStatusLabels = (): Record<string, string> => ({
  draft: pageMessages.t("draft"),
  sent: pageMessages.t("sent"),
  posted: pageMessages.t("posted"),
  partial: pageMessages.t("partial"),
  paid: pageMessages.t("paid"),
  void: pageMessages.t("void"),
  cancelled: pageMessages.t("cancelled"),
});

const inactiveInvoiceStatuses = new Set(["void", "cancelled"]);
const nonRevenueInvoiceStatuses = new Set(["draft", "void", "cancelled"]);
const inactiveVendorBillStatuses = new Set(["paid", "void", "cancelled"]);
const nonPayableVendorBillStatuses = new Set(["void", "cancelled"]);

function amountInAed(invoice: InvoiceReportRow): number {
  return Number(invoice.baseCurrencyAmount ?? invoice.total ?? 0) || 0;
}

function vendorBillTotalAed(bill: VendorBillReportRow): number {
  const exchangeRate = Number(bill.exchange_rate ?? 1);
  const normalizedExchangeRate =
    Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  return (Number(bill.total_amount) || 0) * normalizedExchangeRate;
}

function vendorBillOutstandingAed(bill: VendorBillReportRow): number {
  const outstanding = Math.max(
    0,
    (Number(bill.total_amount) || 0) - (Number(bill.amount_paid) || 0)
  );
  const exchangeRate = Number(bill.exchange_rate ?? 1);
  const normalizedExchangeRate =
    Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  return outstanding * normalizedExchangeRate;
}

function vendorBillPaidAed(bill: VendorBillReportRow): number {
  const total = Math.max(0, Number(bill.total_amount) || 0);
  const paid = Math.min(total, Math.max(0, Number(bill.amount_paid) || 0));
  const exchangeRate = Number(bill.exchange_rate ?? 1);
  const normalizedExchangeRate =
    Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  return paid * normalizedExchangeRate;
}

function valueInDateRange(value: string | null | undefined, dateRange: DateRange): boolean {
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

function invoiceInDateRange(invoice: InvoiceReportRow, dateRange: DateRange): boolean {
  return valueInDateRange(invoice.date, dateRange);
}

function receiptInDateRange(receipt: ReceiptReportRow, dateRange: DateRange): boolean {
  return valueInDateRange(receipt.date, dateRange);
}

function vendorBillInDateRange(bill: VendorBillReportRow, dateRange: DateRange): boolean {
  return valueInDateRange(bill.bill_date, dateRange);
}

function expenseClaimInDateRange(claim: ExpenseClaimReportRow, dateRange: DateRange): boolean {
  return valueInDateRange(claim.created_at, dateRange);
}

function inventoryMovementInDateRange(
  movement: InventoryMovementReportRow,
  dateRange: DateRange
): boolean {
  return valueInDateRange(movement.createdAt, dateRange);
}

function activityLogInDateRange(log: ActivityLogReportRow, dateRange: DateRange): boolean {
  return valueInDateRange(log.createdAt, dateRange);
}

function payrollRunPeriodDate(run: PayrollRunReportRow): Date | null {
  const month = Number(run.period_month);
  const year = Number(run.period_year);
  if (!month || !year) return null;
  const date = new Date(year, month - 1, 1);
  return Number.isNaN(date.getTime()) ? null : date;
}

function payrollRunInDateRange(run: PayrollRunReportRow, dateRange: DateRange): boolean {
  if (!dateRange.from || !dateRange.to) return true;
  const periodDate = payrollRunPeriodDate(run);
  if (!periodDate) return false;
  return valueInDateRange(periodDate.toISOString(), dateRange);
}

function receiptExchangeRate(receipt: ReceiptReportRow): number {
  const rate = Number(receipt.exchangeRate ?? 1);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

function receiptSubtotalAed(receipt: ReceiptReportRow): number {
  const base = Number(receipt.baseCurrencyAmount ?? 0);
  if (Number.isFinite(base) && Math.abs(base) > 0.005) return base;
  return (Number(receipt.amount) || 0) * receiptExchangeRate(receipt);
}

function receiptVatAed(receipt: ReceiptReportRow): number {
  return (Number(receipt.vatAmount) || 0) * receiptExchangeRate(receipt);
}

function expenseClaimAmount(claim: ExpenseClaimReportRow): number {
  const amount = Number(claim.total_amount ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function payrollAmount(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function payrollPeriodLabel(run?: PayrollRunReportRow | null): string {
  if (!run) return "-";
  const periodDate = payrollRunPeriodDate(run);
  return periodDate ? format(periodDate, "MMM yyyy") : `${run.period_month}/${run.period_year}`;
}

function fixedAssetAmount(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function roundReportAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

function isNonDepreciableFixedAsset(asset: Pick<FixedAssetReportRow, "category">): boolean {
  return asset.category.trim().toLowerCase() === "land";
}

function startOfReportMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function calendarMonthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function daysInReportMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function depreciationStatusLabel(status: DepreciationScheduleStatus): string {
  if (status === "ready") return pageMessages.t("readyToPost");
  if (status === "fully_depreciated") return pageMessages.t("fullyDepreciated");
  if (status === "non_depreciable") return pageMessages.t("nonDepreciable");
  if (status === "not_acquired") return pageMessages.t("notAcquired");
  return "Review";
}

function depreciationStatusVariant(status: DepreciationScheduleStatus): BadgeProps["variant"] {
  if (status === "ready") return "success";
  if (status === "review") return "warning";
  if (status === "not_acquired") return "neutral";
  return "info";
}

function calculateDepreciationScheduleRow(
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
      reviewReason: pageMessages.t("landAndOtherNonDepreciableAssets"),
    };
  }

  if (!purchaseMonth || !asset.purchaseCost || !usefulLifeYears || !usefulLifeMonths) {
    return {
      ...baseRow,
      status: "review",
      statusLabel: depreciationStatusLabel("review"),
      reviewReason: !purchaseMonth
        ? pageMessages.t("purchaseDateIsMissingOrInvalid")
        : !asset.purchaseCost
          ? pageMessages.t("purchaseCostIsMissing")
          : pageMessages.t("usefulLifeIsMissing"),
    };
  }

  const monthsElapsed = calendarMonthsBetween(purchaseMonth, periodMonth);
  if (monthsElapsed < 0) {
    return {
      ...baseRow,
      status: "not_acquired",
      statusLabel: depreciationStatusLabel("not_acquired"),
      reviewReason: pageMessages.t("assetWasNotAcquiredByThis"),
    };
  }

  if (remainingDepreciable <= 0.005 || asset.netBookValue <= asset.salvageValue + 0.005) {
    return {
      ...baseRow,
      monthsRemaining: 0,
      status: "fully_depreciated",
      statusLabel: depreciationStatusLabel("fully_depreciated"),
      reviewReason: pageMessages.t("netBookValueIsAtOr"),
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
        ? pageMessages.t("estimatedDepreciationForTheReportPeriod")
        : pageMessages.t("noDepreciationAmountCalculatedForThis"),
  };
}

function buildDepreciationScheduleReport(
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

function buildConsolidatedStatementsReport(
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
            ? pageMessages.t("missingData")
            : status === "unbalanced"
              ? pageMessages.t("balanceReview")
              : status === "multi_currency"
                ? pageMessages.t("fxReview")
                : pageMessages.t("included"),
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
    consolidationBasis: pageMessages.t("managementRollUpOfAccessibleCompanies"),
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
          ? pageMessages.t("singleEntityRollUp")
          : pageMessages.t("reviewBeforeDelivery")
        : pageMessages.t("readyForPack"),
  };
}

function inventoryAmount(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function inventoryMovementValue(movement: InventoryMovementReportRow): number {
  return Math.abs(Number(movement.quantity ?? 0) || 0) * inventoryAmount(movement.unitCost);
}

function journalEntryInDateRange(entry: JournalEntryReportRow, dateRange: DateRange): boolean {
  return valueInDateRange(entry.date, dateRange);
}

function journalAccountName(account?: JournalAccount | null): string {
  return account?.nameEn || account?.nameAr || pageMessages.t("unknownAccount");
}

function journalSourceLabel(source?: string | null): string {
  if (!source) return "Manual / no source";
  return source.replace(/[_-]+/g, " ");
}

function formatReportDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : format(date, "MMM dd, yyyy");
}

function consolidatedStatusVariant(status: ConsolidatedStatementStatus): BadgeProps["variant"] {
  if (status === "included") return "success";
  if (status === "multi_currency") return "info";
  if (status === "unbalanced") return "warning";
  return "danger";
}

function invoiceStatusLabel(status: string): string {
  return getInvoiceStatusLabels()[status] ?? status;
}

function invoiceStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "paid") return "success";
  if (status === "sent" || status === "posted") return "info";
  if (status === "partial") return "warning";
  if (status === "void" || status === "cancelled") return "danger";
  return "neutral";
}

function expenseClaimStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "paid") return "success";
  if (status === "approved") return "info";
  if (status === "submitted") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

function payrollStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "approved" || status === "paid") return "success";
  if (status === "calculated") return "info";
  if (status === "draft") return "warning";
  return "neutral";
}

function fixedAssetStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "active") return "success";
  if (status === "disposed") return "neutral";
  return "warning";
}

function inventoryMovementVariant(type: string): BadgeProps["variant"] {
  if (type === "purchase" || type === "return") return "success";
  if (type === "sale") return "info";
  if (type === "adjustment") return "warning";
  return "neutral";
}

function activityLogLabel(value: string | null | undefined, fallback = "Unknown"): string {
  if (!value) return fallback;
  return value.replace(/[_.-]+/g, " ");
}

function activityLogRiskLevel(log: ActivityLogReportRow): ActivityLogRiskLevel {
  const signal = `${log.action} ${log.description}`.toLowerCase();
  if (/(delete|void|reject|failed|error|remove|archive)/.test(signal)) return "High";
  if (/(update|approve|post|journal|close|permission|admin|invite)/.test(signal)) return "Medium";
  return "Low";
}

function activityLogRiskVariant(risk: ActivityLogRiskLevel): BadgeProps["variant"] {
  if (risk === "High") return "danger";
  if (risk === "Medium") return "warning";
  return "success";
}

function corporateTaxEstimateStatus(report?: CorporateTaxEstimateReport | null): {
  label: string;
  detail: string;
  variant: BadgeProps["variant"];
} {
  if (!report) {
    return {
      label: pageMessages.t("pendingEstimate"),
      detail: pageMessages.t("waitingForPostedJournalData"),
      variant: "neutral",
    };
  }

  if (report.taxPayable > 0.005) {
    return {
      label: pageMessages.t("taxDue"),
      detail: pageMessages.t("reviewTheTaxWorkpaperBeforeDrafting"),
      variant: "warning",
    };
  }

  if (report.taxableIncome <= 0) {
    return {
      label: pageMessages.t("noTaxableIncome"),
      detail: pageMessages.t("theSelectedPeriodIsAtOr"),
      variant: "success",
    };
  }

  return {
    label: pageMessages.t("belowThreshold"),
    detail: pageMessages.t("taxableIncomeIsBelowTheZero"),
    variant: "success",
  };
}

function reportTabFromSearch(search: string): ReportTab {
  const tab = new URLSearchParams(search).get("tab");
  return reportTabs.includes(tab as ReportTab) ? (tab as ReportTab) : "pl";
}

function reportIdFromSearch(search: string): string | null {
  const reportId = new URLSearchParams(search).get("report");
  return readyReportCatalog.some((report) => report.id === reportId) ? reportId : null;
}

function personaFilterFromSearch(
  search: string,
  fallbackPersona: ReportPersona | null = null
): PersonaFilter {
  const persona = new URLSearchParams(search).get("persona");
  if (persona === "all") return "all";
  return reportPersonas.includes(persona as ReportPersona)
    ? (persona as ReportPersona)
    : (fallbackPersona ?? "all");
}

function reportWorkflowSearchFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("workflowSearch");
  return value === null ? null : normalizeReportWorkflowSearch(value);
}

function reportWorkflowGapFilterFromSearch(
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

function matchesReportPersona(personas: ReportPersona[], persona: PersonaFilter): boolean {
  return persona === "all" || personas.includes(persona);
}

function uniqueSorted<T extends string>(values: Iterable<T>): T[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function buildReportCoverageMap(
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

function startOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function inclusiveDayCount(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(
    1,
    Math.round((startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) / msPerDay) + 1
  );
}

function averageDaysOverdue<T>(
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

function dueWithinDaysAfterRangeEnd<T>(
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

function buildComparisonRanges(dateRange: DateRange): {
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

function comparisonParams(range: ComparisonRange): string {
  return `?startDate=${format(range.from, "yyyy-MM-dd")}&endDate=${format(range.to, "yyyy-MM-dd")}`;
}

function percentageChange(current: number, previous: number): number | null {
  if (Math.abs(previous) < 0.005) return Math.abs(current) < 0.005 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function normalizeMonthlyBurn(totalRevenue: number, totalExpenses: number, days: number): number {
  const dailyBurn = Math.max(0, totalExpenses - totalRevenue) / Math.max(1, days);
  return Math.round(dailyBurn * 30 * 100) / 100;
}

function runwayCoverageDays(cashBalance: number, monthlyBurn: number, horizonDays = 90): number {
  if (monthlyBurn <= 0.005) return horizonDays;
  if (cashBalance <= 0) return 0;
  const dailyBurn = monthlyBurn / 30;
  return Math.round(Math.min(horizonDays, cashBalance / dailyBurn) * 10) / 10;
}

function ratioPercent(numerator: number, denominator: number): number {
  if (Math.abs(denominator) <= 0.005) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function averageAvailablePercent(values: Array<number | null | undefined>): number {
  const available = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (available.length === 0) return 0;

  return (
    Math.round((available.reduce((sum, value) => sum + value, 0) / available.length) * 100) / 100
  );
}

function formatComparisonPercent(value: number | null): string {
  if (value === null) return pageMessages.t("new");
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatComparisonValue(row: ComparisonMetricRow, value: number, locale: string): string {
  if (row.currency === "%") return `${value.toFixed(1)}%`;
  if (row.currency === "days") return `${value.toFixed(1)} days`;
  if (row.currency === "count") {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  }
  return formatCurrency(value, row.currency, locale);
}

function formatComparisonExportValue(row: ComparisonMetricRow, value: number): string {
  if (row.currency === "%") return `${value.toFixed(1)}%`;
  if (row.currency === "days") return `${value.toFixed(1)} days`;
  if (row.currency === "count") return `${Math.round(value)}`;
  return `${row.currency} ${value.toFixed(2)}`;
}

function comparisonBadgeVariant(row: ComparisonMetricRow): BadgeProps["variant"] {
  if (Math.abs(row.delta) < 0.005) return "neutral";
  if (row.favorable === "neutral") return row.delta >= 0 ? "info" : "neutral";
  const improved = row.favorable === "increase" ? row.delta > 0 : row.delta < 0;
  return improved ? "success" : "warning";
}

function makeComparisonMetric(
  input: Omit<ComparisonMetricRow, "delta" | "percentChange">
): ComparisonMetricRow {
  const delta = input.current - input.previous;
  return {
    ...input,
    delta,
    percentChange: percentageChange(input.current, input.previous),
  };
}

function normalizeDeliverySetting(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatDeliveryRunTimestamp(value: string | null | undefined): string {
  if (!value) return pageMessages.t("noRunsYet");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, "MMM d, HH:mm");
}

function deliveryRunStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "sent") return "success";
  if (status === "failed" || status === "cancelled") return "destructive";
  return "info";
}

function matchesReportDeliveryRunStatusFilter(
  status: string,
  filter: ReportDeliveryRunStatusFilter
): boolean {
  if (filter === "all") return true;
  return status === filter;
}

function reportDeliveryAutomationCommandCardClass(
  command: ReportDeliveryAutomationCommand,
  pinnedCommand: ReportDeliveryAutomationCommand | null
): string {
  return [
    "rounded-md border p-2",
    command === pinnedCommand ? "border-accent bg-accent/5" : "border-transparent bg-secondary/40",
  ].join(" ");
}

function deliveryPreviewCheckVariant(
  status: ReportDeliveryPlanPreview["checklist"][number]["status"]
): BadgeProps["variant"] {
  if (status === "ready") return "success";
  if (status === "paused") return "neutral";
  return "warning";
}

export default function Reports() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId, companies: accessibleCompanies = [] } = useDefaultCompany();
  const [location, navigate] = useLocation();
  const search = useSearch();
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [isExporting, setIsExporting] = useState(false);
  const [ledgerDetailPage, setLedgerDetailPage] = useState(1);
  const [reportAutomationHealthHistory, setReportAutomationHealthHistory] = useState(() =>
    getReportAutomationHealthHistory()
  );
  const [editingReportDeliverySubscriptionId, setEditingReportDeliverySubscriptionId] = useState<
    string | null
  >(null);
  const [reportDeliveryRunStatusFilter, setReportDeliveryRunStatusFilter] =
    useState<ReportDeliveryRunStatusFilter>("all");
  const [acknowledgedReportDeliveryHandoffGaps, setAcknowledgedReportDeliveryHandoffGaps] =
    useState<Record<string, true>>({});
  const [pinnedReportDeliveryAutomationCommands, setPinnedReportDeliveryAutomationCommands] =
    useState<Record<ReportPersona, ReportDeliveryAutomationCommand | null>>(() => ({
      owner: getPreferredReportDeliveryAutomationCommand("owner"),
      freelancer: getPreferredReportDeliveryAutomationCommand("freelancer"),
      accountant: getPreferredReportDeliveryAutomationCommand("accountant"),
    }));
  const [reportDeliverySettingsDraft, setReportDeliverySettingsDraft] =
    useState<ReportDeliverySettingsDraft>({
      cadence: "",
      channel: "",
      format: "",
      recipients: "",
      deliveryGuardrail: "",
    });

  const locationSearch = useMemo(() => (search ? `?${search}` : ""), [search]);

  const activeTab = useMemo(
    () =>
      reportTabFromSearch(
        locationSearch || (typeof window === "undefined" ? "" : window.location.search)
      ),
    [locationSearch]
  );
  const activeReportId = useMemo(
    () =>
      reportIdFromSearch(
        locationSearch || (typeof window === "undefined" ? "" : window.location.search)
      ),
    [locationSearch]
  );
  const [activeReportWorkspaceTab, setActiveReportWorkspaceTabState] = useState<ReportWorkspaceTab>(
    () =>
      reportWorkspaceTabFromLocation(
        typeof window === "undefined" ? "" : window.location.search,
        typeof window === "undefined" ? "" : window.location.hash
      )
  );

  const [preferredReportPersona, setPreferredReportPersonaState] = useState<ReportPersona | null>(
    () => getPreferredReportPersona()
  );

  const personaFilter = useMemo(() => {
    return personaFilterFromSearch(
      locationSearch || window.location.search,
      preferredReportPersona
    );
  }, [locationSearch, preferredReportPersona]);
  const [reportWorkflowSearch, setReportWorkflowSearch] = useState(() =>
    getPreferredReportWorkflowSearch(personaFilter)
  );
  const [reportWorkflowGapFilter, setReportWorkflowGapFilter] =
    useState<ReportWorkflowGapFilterState>(() =>
      reportWorkflowGapFilterFromSearch(locationSearch || window.location.search, personaFilter)
    );
  const reportCatalogDiscoveryPersona: ReportPersona | null =
    personaFilter === "all" ? null : personaFilter;
  const reportCatalogDiscoveryQuery = useQuery<ReportCatalogDiscovery>({
    queryKey: reportCatalogDiscoveryQueryKey(reportCatalogDiscoveryPersona),
    queryFn: () => fetchReportCatalogDiscovery(reportCatalogDiscoveryPersona),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const syncedReportCatalogSummary = reportCatalogDiscoveryQuery.data?.summary;
  const syncedReportPersonaSummaries = reportCatalogDiscoveryQuery.data?.personaSummaries;
  const reportActionContextByPersonaReportId = useMemo(() => {
    return new Map(
      (reportCatalogDiscoveryQuery.data?.reportActionContexts ?? []).map((context) => [
        `${context.persona}:${context.reportId}`,
        context,
      ])
    );
  }, [reportCatalogDiscoveryQuery.data?.reportActionContexts]);

  const setActiveTab = useCallback(
    (tab: ReportTab, persona: PersonaFilter = personaFilter) => {
      setActiveReportWorkspaceTabState("reports");
      navigate(reportsWorkspaceHref({ tab, persona, workspace: "reports" }));
    },
    [navigate, personaFilter]
  );

  const setReportWorkspaceTab = (tab: ReportWorkspaceTab) => {
    setActiveReportWorkspaceTabState(tab);
    navigate(
      reportsWorkspaceHref({
        tab: tab === "reports" ? activeTab : undefined,
        persona: personaFilter,
        workspace: tab,
      })
    );
  };

  const setReportPersonaFilter = (persona: PersonaFilter) => {
    if (persona === "all") {
      clearPreferredReportPersona();
      setPreferredReportPersonaState(null);
    } else {
      setPreferredReportPersona(persona);
      setPreferredReportPersonaState(persona);
    }
    navigate(
      reportsWorkspaceHref({
        tab: activeReportWorkspaceTab === "reports" ? activeTab : undefined,
        persona,
        workspace: activeReportWorkspaceTab,
      })
    );
  };

  const effectiveReportPersona: ReportPersona =
    personaFilter === "all" ? (preferredReportPersona ?? "owner") : personaFilter;
  const reportViewerOptions = useMemo(() => {
    const isAr = locale === "ar";
    const catLabel = (category: string) =>
      isAr
        ? (reportCategoryAr[category] ?? reportViewerCategoryLabel(category))
        : reportViewerCategoryLabel(category);

    const statementCenterOption: ReportViewerOption = {
      id: "financial-statements-center",
      label: isAr ? (t as any).financialStatementsCenter : tr("financialStatementsCenter"),
      description: isAr
        ? (t as any).financialStatementsCenterDesc
        : tr("openTheCleanStatementWorkspaceFor"),
      category: "Financial Statements",
      categoryLabel: catLabel("Financial Statements"),
      status: "live",
      order: -1,
      href: "/financial-statements",
    };

    const catalogOptions = readyReportCatalog.map((report, index): ReportViewerOption => {
      const persona = reportViewerPersonaForReport(report, effectiveReportPersona);
      const category = reportViewerCategoryForReport(report);
      const href =
        report.href ??
        (report.tab && persona
          ? reportsWorkspaceHref({
              tab: report.tab,
              reportId: report.id,
              persona,
              workspace: "reports",
            })
          : undefined);

      return {
        id: report.id,
        reportId: report.id,
        label: isAr ? (reportNameAr[report.id] ?? report.name) : report.name,
        description: isAr
          ? (reportQuestionAr[report.id] ?? report.decisionQuestion)
          : report.decisionQuestion,
        category,
        categoryLabel: catLabel(category),
        status: report.status,
        order: index,
        tab: report.tab,
        href,
        persona,
      };
    });

    return [statementCenterOption, ...catalogOptions].sort((a, b) => {
      const categoryDelta =
        reportViewerCategoryRank(a.category) - reportViewerCategoryRank(b.category);
      if (categoryDelta !== 0) return categoryDelta;
      if (a.order !== b.order) return a.order - b.order;
      return a.label.localeCompare(b.label);
    });
  }, [effectiveReportPersona, locale, t]);
  const reportViewerOptionById = useMemo(
    () => new Map(reportViewerOptions.map((option) => [option.id, option])),
    [reportViewerOptions]
  );
  const reportViewerGroups = useMemo<ReportViewerGroup[]>(() => {
    const groups = new Map<string, ReportViewerGroup>();

    reportViewerOptions.forEach((option) => {
      const group = groups.get(option.category) ?? {
        category: option.category,
        label: option.categoryLabel,
        rank: reportViewerCategoryRank(option.category),
        options: [],
      };
      group.options.push(option);
      groups.set(option.category, group);
    });

    return Array.from(groups.values()).sort(
      (a, b) => a.rank - b.rank || a.label.localeCompare(b.label)
    );
  }, [reportViewerOptions]);
  const activeReportViewerOption =
    (activeReportId ? reportViewerOptionById.get(activeReportId) : undefined) ??
    reportViewerOptions.find(
      (option) => option.tab === activeTab && option.persona === effectiveReportPersona
    ) ??
    reportViewerOptions.find((option) => option.tab === activeTab) ??
    reportViewerOptions[0];
  const selectedReportId = activeReportViewerOption?.reportId ?? null;
  const hasFocusedReportSelection = Boolean(activeReportId && selectedReportId);
  const reportViewerTitle = hasFocusedReportSelection
    ? (activeReportViewerOption?.label ?? tr("reports"))
    : ((t as any).reportCenter ?? tr("reportCenter"));
  const reportViewerDescription = hasFocusedReportSelection
    ? (activeReportViewerOption?.description ?? tr("reviewThisReportForTheSelected"))
    : ((t as any).chooseOneReport ?? tr("chooseOneReportFromACategory"));
  const reportViewerMenuLabel = hasFocusedReportSelection
    ? (activeReportViewerOption?.label ?? (t as any).chooseAReport ?? tr("chooseAReport"))
    : ((t as any).chooseAReport ?? tr("chooseAReport"));
  const reportViewerMenuDescription = hasFocusedReportSelection
    ? (activeReportViewerOption?.categoryLabel ??
      (t as any).groupedByCategory ??
      tr("groupedByCategory"))
    : ((t as any).groupedByCategory ?? tr("groupedByCategory"));

  const openReportViewerOption = useCallback(
    (optionId: string) => {
      const option = reportViewerOptionById.get(optionId);
      if (!option) return;

      setActiveReportWorkspaceTabState("reports");

      if (option.href) {
        navigate(option.href);
        return;
      }

      if (option.tab) {
        navigate(
          reportsWorkspaceHref({
            tab: option.tab,
            reportId: option.reportId,
            persona: option.persona ?? effectiveReportPersona,
            workspace: "reports",
          })
        );
      }
    },
    [effectiveReportPersona, navigate, reportViewerOptionById]
  );

  const showReportSection = useCallback(
    (...reportIds: string[]) =>
      !hasFocusedReportSelection ||
      (selectedReportId !== null && reportIds.includes(selectedReportId)),
    [hasFocusedReportSelection, selectedReportId]
  );
  const reportSectionClass = useCallback(
    (reportIds: string[], className?: string) =>
      cn(className, !showReportSection(...reportIds) && "hidden"),
    [showReportSection]
  );

  useEffect(() => {
    if (activeReportWorkspaceTab !== "reports" || reportViewerOptions.length === 0) return;
    if (
      activeReportId &&
      activeReportViewerOption?.tab &&
      activeReportViewerOption.tab !== activeTab
    ) {
      navigate(
        reportsWorkspaceHref({
          tab: activeReportViewerOption.tab,
          reportId: activeReportViewerOption.reportId,
          persona: activeReportViewerOption.persona ?? effectiveReportPersona,
          workspace: "reports",
        })
      );
      return;
    }

    if (reportViewerOptions.some((option) => option.tab === activeTab)) return;
  }, [
    activeReportId,
    activeReportViewerOption,
    activeReportWorkspaceTab,
    activeTab,
    effectiveReportPersona,
    navigate,
    reportViewerOptions,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncWorkspaceTabFromLocation = () => {
      setActiveReportWorkspaceTabState(
        reportWorkspaceTabFromLocation(
          locationSearch || window.location.search,
          window.location.hash
        )
      );
    };

    syncWorkspaceTabFromLocation();
    window.addEventListener("hashchange", syncWorkspaceTabFromLocation);

    return () => {
      window.removeEventListener("hashchange", syncWorkspaceTabFromLocation);
    };
  }, [locationSearch]);

  useEffect(() => {
    setLedgerDetailPage(1);
  }, [activeReportId, dateRange.from, dateRange.to, selectedCompanyId]);

  useEffect(() => {
    const currentSearch = locationSearch || window.location.search;
    const urlWorkflowSearch = reportWorkflowSearchFromSearch(currentSearch);
    if (urlWorkflowSearch !== null) {
      setReportWorkflowSearch(urlWorkflowSearch);
      setPreferredReportWorkflowSearch(urlWorkflowSearch, personaFilter);
      return;
    }

    setReportWorkflowSearch(getPreferredReportWorkflowSearch(personaFilter));
  }, [locationSearch, personaFilter]);

  useEffect(() => {
    const currentSearch = locationSearch || window.location.search;
    const nextFilter = reportWorkflowGapFilterFromSearch(currentSearch, personaFilter);
    const urlGapFilter = parseReportWorkflowGapFilter(
      new URLSearchParams(currentSearch).get("workflowGap")
    );
    if (urlGapFilter && nextFilter.persona) {
      setPreferredReportWorkflowGapFilter(nextFilter.persona, urlGapFilter);
    }

    setReportWorkflowGapFilter((current) => {
      if (current.type === nextFilter.type && current.persona === nextFilter.persona) {
        return current;
      }

      return nextFilter;
    });
  }, [locationSearch, personaFilter]);

  const personaFilterLabel =
    getPersonaFilters().find((filter) => filter.id === personaFilter)?.label ?? tr("all");
  const personaScopeDescription =
    personaFilter === "all"
      ? tr("showingAllRoleSignals")
      : `Focused for ${personaFilterLabel.toLowerCase()} workflows.`;
  const normalizedReportWorkflowSearch = reportWorkflowSearch.trim().toLowerCase();
  const matchesReportWorkflowSearch = useCallback(
    (values: Array<string | number | null | undefined>) => {
      if (!normalizedReportWorkflowSearch) return true;
      return values
        .filter((value): value is string | number => value !== null && value !== undefined)
        .map((value) => String(value))
        .join(" ")
        .toLowerCase()
        .includes(normalizedReportWorkflowSearch);
    },
    [normalizedReportWorkflowSearch]
  );
  const updateReportWorkflowSearch = useCallback(
    (value: string) => {
      setReportWorkflowSearch(value);
      setPreferredReportWorkflowSearch(value, personaFilter);
    },
    [personaFilter]
  );
  const clearReportWorkflowSearch = useCallback(() => {
    setReportWorkflowSearch("");
    clearPreferredReportWorkflowSearch(personaFilter);
  }, [personaFilter]);
  const applyReportWorkflowGapFilter = useCallback(
    (type: Exclude<ReportWorkflowFinderGapFilter, "all">, persona: ReportPersona) => {
      setReportWorkflowSearch("");
      if (reportWorkflowGapFilter.type === type && reportWorkflowGapFilter.persona === persona) {
        clearPreferredReportWorkflowGapFilter(persona);
        setReportWorkflowGapFilter({ type: "all", persona: null });
        return;
      }

      setPreferredReportWorkflowGapFilter(persona, type);
      setReportWorkflowGapFilter({ type, persona });
    },
    [reportWorkflowGapFilter.persona, reportWorkflowGapFilter.type]
  );
  const clearReportWorkflowGapFilter = useCallback(() => {
    if (reportWorkflowGapFilter.persona) {
      clearPreferredReportWorkflowGapFilter(reportWorkflowGapFilter.persona);
    }
    setReportWorkflowGapFilter({ type: "all", persona: null });
  }, [reportWorkflowGapFilter.persona]);
  const resetReportWorkflowContext = useCallback(() => {
    const personasToClear = new Set<ReportPersona>();
    if (personaFilter !== "all") personasToClear.add(personaFilter);
    if (reportWorkflowGapFilter.persona) {
      personasToClear.add(reportWorkflowGapFilter.persona);
    }

    personasToClear.forEach((persona) => {
      clearPreferredReportWorkflowGapFilter(persona);
      clearPreferredReportWorkflowSearch(persona);
    });
    clearPreferredReportWorkflowSearch("all");
    clearPreferredReportPersona();
    setPreferredReportPersonaState(null);
    setReportWorkflowSearch("");
    setReportWorkflowGapFilter({ type: "all", persona: null });
    navigate(
      reportsWorkspaceHref({
        tab: activeReportWorkspaceTab === "reports" ? activeTab : undefined,
        persona: "all",
        workspace: activeReportWorkspaceTab,
      })
    );
  }, [
    activeReportWorkspaceTab,
    activeTab,
    navigate,
    personaFilter,
    reportWorkflowGapFilter.persona,
  ]);
  const reportDeliveryLauncherPersona: ReportPersona =
    personaFilter === "all" ? (preferredReportPersona ?? "owner") : personaFilter;
  const pinnedReportDeliveryAutomationCommand =
    pinnedReportDeliveryAutomationCommands[reportDeliveryLauncherPersona];
  const saveReportDeliveryAutomationPreference = useMutation({
    mutationFn: ({ persona, command }: SaveReportDeliveryAutomationPreferenceInput) => {
      if (!selectedCompanyId) throw new Error("Select a company before saving automation.");
      return apiRequest(
        "PATCH",
        `/api/companies/${selectedCompanyId}/report-delivery/preferences/${persona}`,
        { preferredDeliveryAutomationCommand: command }
      );
    },
    onError: (error: any) => {
      toast({
        title: tr("couldNotSaveAutomationCommand"),
        description: error?.message || tr("failedToSaveThePinnedAutomation"),
        variant: "destructive",
      });
    },
  });
  const pinReportDeliveryAutomationCommand = useCallback(
    (command: ReportDeliveryAutomationCommand) => {
      const parsedCommand = parseReportDeliveryAutomationCommand(command);
      if (!parsedCommand) return;

      setPreferredReportDeliveryAutomationCommand(reportDeliveryLauncherPersona, parsedCommand);
      setPinnedReportDeliveryAutomationCommands((current) => ({
        ...current,
        [reportDeliveryLauncherPersona]: parsedCommand,
      }));
      if (selectedCompanyId) {
        saveReportDeliveryAutomationPreference.mutate({
          persona: reportDeliveryLauncherPersona,
          command: parsedCommand,
        });
      }
      toast({
        title: tr("automationCommandPinned"),
        description: tr("isPinnedForWorkflows", {
          value: getReportDeliveryAutomationCommandLabels()[parsedCommand],
          personaFilterLabel: personaFilterLabel.toLowerCase(),
        }),
      });
    },
    [
      personaFilterLabel,
      reportDeliveryLauncherPersona,
      saveReportDeliveryAutomationPreference,
      selectedCompanyId,
      toast,
    ]
  );
  const [favoriteReportIds, setFavoriteReportIdsState] = useState<string[]>(() =>
    getFavoriteReportIds(personaFilter)
  );

  useEffect(() => {
    setFavoriteReportIdsState(getFavoriteReportIds(personaFilter));
  }, [personaFilter]);

  const favoriteReportIdSet = useMemo(() => new Set(favoriteReportIds), [favoriteReportIds]);
  const toggleReportFavorite = useCallback(
    (report: ReportCatalogItem) => {
      const nextFavoriteIds = toggleFavoriteReportId(report.id, personaFilter);
      setFavoriteReportIdsState(nextFavoriteIds);
      const isPinned = nextFavoriteIds.includes(report.id);

      toast({
        title: isPinned ? tr("reportPinned") : tr("reportUnpinned"),
        description: `${report.name} ${
          isPinned
            ? "will appear first in this report library."
            : "was removed from pinned reports."
        }`,
      });
    },
    [personaFilter, toast]
  );

  const filteredReports = useMemo(() => {
    return reportCatalog
      .filter((report) => {
        return (
          matchesReportPersona(report.personas, personaFilter) &&
          matchesReportWorkflowSearch([
            report.name,
            report.category,
            report.status,
            report.comparison,
            report.automation,
            report.decisionQuestion,
            report.commandKeywords,
            report.personas.join(" "),
          ])
        );
      })
      .sort((a, b) => {
        const aFavorite = favoriteReportIdSet.has(a.id) ? 0 : 1;
        const bFavorite = favoriteReportIdSet.has(b.id) ? 0 : 1;
        return aFavorite - bFavorite || a.name.localeCompare(b.name);
      });
  }, [favoriteReportIdSet, matchesReportWorkflowSearch, personaFilter]);

  const favoriteReports = useMemo(() => {
    return reportCatalog.filter(
      (report) =>
        favoriteReportIdSet.has(report.id) && matchesReportPersona(report.personas, personaFilter)
    );
  }, [favoriteReportIdSet, personaFilter]);

  const connectedReportCenters = useMemo(() => {
    return filteredReports.filter(
      (report): report is (typeof reportCatalog)[number] & { href: string } =>
        Boolean(report.href && !report.tab)
    );
  }, [filteredReports]);

  const reportCoverageMap = useMemo(() => {
    return buildReportCoverageMap(filteredReports);
  }, [filteredReports]);

  const reportStats = useMemo(() => {
    if (syncedReportCatalogSummary) {
      return {
        live: syncedReportCatalogSummary.liveReportCount,
        ready: syncedReportCatalogSummary.readyReportCount,
        planned: syncedReportCatalogSummary.plannedReportCount,
        total: syncedReportCatalogSummary.reportCount,
        packTemplates: syncedReportCatalogSummary.packTemplateCount,
        comparisonPresets: syncedReportCatalogSummary.comparisonPresetCount,
        reportSuites: syncedReportCatalogSummary.reportSuiteCount,
        deliverySubscriptions: syncedReportCatalogSummary.deliverySubscriptionCount,
        automationStarters: syncedReportCatalogSummary.automationStarterCount,
        quickAccessProfiles: syncedReportCatalogSummary.quickAccessProfileCount,
        savedViews: syncedReportCatalogSummary.savedViewCount,
        managementBriefs: syncedReportCatalogSummary.managementBriefCount,
        automationImpactProfiles: syncedReportCatalogSummary.automationImpactProfileCount,
        workflowSteps: syncedReportCatalogSummary.workflowStepCount,
        automationPlaybooks: syncedReportCatalogSummary.automationPlaybookCount,
      };
    }

    const live = reportCatalog.filter((report) => report.status === "live").length;
    const ready = reportCatalog.filter((report) => report.status !== "planned").length;
    const planned = reportCatalog.length - ready;
    return {
      live,
      ready,
      planned,
      total: reportCatalog.length,
      packTemplates: reportPackTemplates.length,
      comparisonPresets: reportComparisonPresets.length,
      reportSuites: reportSuiteProfiles.length,
      deliverySubscriptions: reportDeliverySubscriptions.length,
      automationStarters: reportAutomationStarters.length,
      quickAccessProfiles: reportQuickAccessProfiles.length,
      savedViews: reportSavedViewProfiles.length,
      managementBriefs: reportManagementBriefProfiles.length,
      automationImpactProfiles: reportAutomationImpactProfiles.length,
      workflowSteps: reportPersonaWorkspaces.reduce(
        (sum, workspace) => sum + workspace.workflowSteps.length,
        0
      ),
      automationPlaybooks: reportPersonaWorkspaces.reduce(
        (sum, workspace) => sum + workspace.automations.length,
        0
      ),
    };
  }, [syncedReportCatalogSummary]);

  const workspaceSummaries = useMemo(() => {
    return reportPersonaWorkspaces.map((workspace) => {
      const reports = reportCatalog.filter((report) => report.personas.includes(workspace.persona));
      const localReadyReports = reports.filter((report) => report.status !== "planned").length;
      const syncedSummary = syncedReportPersonaSummaries?.find(
        (summary) => summary.persona === workspace.persona
      );
      const catalogReportCount = syncedSummary?.reportCount ?? reports.length;
      const readyReports = syncedSummary?.readyReportCount ?? localReadyReports;
      const plannedReports = reports.filter((report) => report.status === "planned");
      const automationCount =
        syncedSummary?.automationPlaybookCount ?? workspace.automations.length;
      const topReadyReport = reports.find((report) => report.tab) ?? reports[0];
      const setupChecklist = workspace.setupChecklist.map((step) => {
        const linkedReports = step.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));

        return {
          ...step,
          reports: linkedReports,
          href: reportSectionHref(workspace, step.section),
        };
      });
      const workflowSteps = workspace.workflowSteps.map((step) => {
        const linkedReports = step.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const comparisonPreset = reportComparisonPresets.find(
          (preset) => preset.id === step.comparisonPresetId
        );
        const automationStarter = reportAutomationStarters.find(
          (starter) => starter.id === step.automationStarterId
        );
        const deliverySubscription = reportDeliverySubscriptions.find(
          (subscription) => subscription.id === step.deliverySubscriptionId
        );
        const decisionShortcut = reportDecisionShortcuts.find(
          (shortcut) => shortcut.id === step.decisionShortcutId
        );
        const savedView = reportSavedViewProfiles.find((view) => view.id === step.savedViewId);
        const reportSuite = reportSuiteProfiles.find((suite) => suite.id === step.reportSuiteId);

        return {
          ...step,
          reports: linkedReports,
          href: reportRoleWorkflowStepHref(workspace, step),
          sectionHref: reportSectionHref(workspace, step.section),
          comparisonPreset,
          comparisonHref: comparisonPreset
            ? reportComparisonPresetHref(comparisonPreset)
            : reportSectionHref(workspace, "recommendations"),
          automationStarter,
          automationHref: automationStarter
            ? reportAutomationStarterHref(automationStarter)
            : reportSectionHref(workspace, "automation-starters"),
          deliverySubscription,
          deliveryHref: deliverySubscription
            ? reportDeliverySubscriptionHref(deliverySubscription)
            : reportSectionHref(workspace, "delivery-subscriptions"),
          decisionShortcut,
          decisionHref: decisionShortcut
            ? reportDecisionShortcutHref(decisionShortcut)
            : reportSectionHref(workspace, "decision-shortcuts"),
          savedView,
          savedViewHref: savedView
            ? reportSavedViewHref(savedView)
            : reportSectionHref(workspace, "saved-views"),
          defaultViewLabel: savedView?.title ?? tr("roleSavedView"),
          defaultViewHref: savedView
            ? reportSavedViewHref(savedView)
            : reportSectionHref(workspace, "saved-views"),
          handoffRecipients: deliverySubscription?.recipients ?? workspace.packSchedule.recipients,
          handoffGuardrail:
            deliverySubscription?.deliveryGuardrail ?? workspace.packSchedule.automation,
          reportSuite,
          reportSuiteHref: reportSuite
            ? reportSuiteHref(reportSuite)
            : reportSectionHref(workspace, "report-suites"),
        };
      });
      return {
        ...workspace,
        icon: reportWorkspaceIcons[workspace.icon],
        reports,
        roleSetupHref: reportSectionHref(workspace, "role-setup"),
        roleWorkflowHref: reportSectionHref(workspace, "role-workflows"),
        managementBriefsHref: reportSectionHref(workspace, "management-briefs"),
        setupChecklist,
        setupStepCount: syncedSummary?.setupStepCount ?? setupChecklist.length,
        workflowSteps,
        workflowStepCount: syncedSummary?.workflowStepCount ?? workflowSteps.length,
        catalogReportCount,
        readyReports,
        plannedReports,
        automationCount,
        decisionShortcutCount:
          syncedSummary?.decisionShortcutCount ??
          reportDecisionShortcuts.filter((shortcut) => shortcut.persona === workspace.persona)
            .length,
        automationStarterCount:
          syncedSummary?.automationStarterCount ??
          reportAutomationStarters.filter((starter) => starter.persona === workspace.persona)
            .length,
        triggerRuleCount:
          syncedSummary?.triggerRuleCount ??
          reportAutomationTriggerRules.filter((rule) => rule.persona === workspace.persona).length,
        deliverySubscriptionCount:
          syncedSummary?.deliverySubscriptionCount ??
          reportDeliverySubscriptions.filter(
            (subscription) => subscription.persona === workspace.persona
          ).length,
        packTemplateCount:
          syncedSummary?.packTemplateCount ??
          reportPackTemplates.filter((template) => template.persona === workspace.persona).length,
        comparisonPresetCount:
          syncedSummary?.comparisonPresetCount ??
          reportComparisonPresets.filter((preset) => preset.persona === workspace.persona).length,
        reportSuiteCount:
          syncedSummary?.reportSuiteCount ??
          reportSuiteProfiles.filter((suite) => suite.persona === workspace.persona).length,
        managementBriefCount:
          syncedSummary?.managementBriefCount ??
          reportManagementBriefProfiles.filter((brief) => brief.persona === workspace.persona)
            .length,
        quickAccessProfileCount:
          syncedSummary?.quickAccessProfileCount ??
          reportQuickAccessProfiles.filter((profile) => profile.persona === workspace.persona)
            .length,
        savedViewCount:
          syncedSummary?.savedViewCount ??
          reportSavedViewProfiles.filter((view) => view.persona === workspace.persona).length,
        automationImpactProfileCount:
          syncedSummary?.automationImpactProfileCount ??
          reportAutomationImpactProfiles.filter((profile) => profile.persona === workspace.persona)
            .length,
        topReadyReport,
        readiness: catalogReportCount ? Math.round((readyReports / catalogReportCount) * 100) : 0,
      };
    });
  }, [syncedReportPersonaSummaries]);

  const visibleWorkspaceSummaries = useMemo(() => {
    return workspaceSummaries.filter((workspace) =>
      matchesReportPersona([workspace.persona], personaFilter)
    );
  }, [personaFilter, workspaceSummaries]);

  const reportQuickAccessSummaries = useMemo(() => {
    return reportQuickAccessProfiles.flatMap((profile) => {
      const workspace = workspaceSummaries.find((item) => item.persona === profile.persona);
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === profile.comparisonPresetId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === profile.automationStarterId
      );
      const deliverySubscription = reportDeliverySubscriptions.find(
        (subscription) => subscription.id === profile.deliverySubscriptionId
      );
      if (!workspace || !comparisonPreset || !automationStarter || !deliverySubscription) {
        return [];
      }

      const reports = profile.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const reportEntries = reports.map((report) => {
        const context = reportActionContextByPersonaReportId.get(`${profile.persona}:${report.id}`);
        return {
          report,
          context,
          href:
            context?.reportHref ??
            reportPersonaHref(report, profile.persona) ??
            reportWorkspaceHref(workspace),
          workflowHref:
            context?.workflowHref ??
            reportWorkflowContextHref({
              persona: profile.persona,
              tab: report.tab ?? workspace.primaryTab,
              search: report.name,
            }),
          comparisonHref: context?.comparisonPresets[0]?.href,
          deliveryHref: context?.deliverySubscriptions[0]?.href,
        };
      });
      const readyCount = reports.filter((report) => report.status !== "planned").length;

      return [
        {
          ...profile,
          workspace,
          reports,
          primaryReports: reportEntries.slice(0, 6),
          additionalReports: reportEntries.slice(6),
          readyCount,
          href: reportSectionHref(workspace, "quick-access"),
          comparisonPreset,
          comparisonHref: reportComparisonPresetHref(comparisonPreset),
          automationStarter,
          automationHref: reportAutomationStarterHref(automationStarter),
          deliverySubscription,
          deliveryHref: reportDeliverySubscriptionHref(deliverySubscription),
        },
      ];
    });
  }, [reportActionContextByPersonaReportId, workspaceSummaries]);

  const visibleReportQuickAccessSummaries = useMemo(() => {
    return reportQuickAccessSummaries.filter(
      (profile) =>
        matchesReportPersona([profile.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          profile.title,
          profile.outcome,
          profile.commandKeywords,
          profile.reports.map((report) => report.name).join(" "),
          profile.comparisonPreset.title,
          profile.automationStarter.title,
          profile.deliverySubscription.title,
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportQuickAccessSummaries]);

  const reportSavedViewSummaries = useMemo(() => {
    return reportSavedViewProfiles.flatMap((view) => {
      const workspace = workspaceSummaries.find((item) => item.persona === view.persona);
      const report = reportCatalog.find((item) => item.id === view.reportId);
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === view.comparisonPresetId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === view.automationStarterId
      );
      if (!workspace || !report || !comparisonPreset || !automationStarter) return [];
      const context = reportActionContextByPersonaReportId.get(`${view.persona}:${report.id}`);

      return [
        {
          ...view,
          workspace,
          report,
          comparisonPreset,
          automationStarter,
          href: reportSavedViewHref(view),
          reportHref:
            context?.reportHref ??
            reportPersonaHref(report, view.persona) ??
            reportWorkspaceHref(workspace),
          workflowHref:
            context?.workflowHref ??
            reportWorkflowContextHref({
              persona: view.persona,
              tab: report.tab ?? workspace.primaryTab,
              search: view.title,
            }),
          comparisonHref: reportComparisonPresetHref(comparisonPreset),
          automationHref: reportAutomationStarterHref(automationStarter),
        },
      ];
    });
  }, [reportActionContextByPersonaReportId, workspaceSummaries]);

  const visibleReportSavedViewSummaries = useMemo(() => {
    return reportSavedViewSummaries.filter(
      (view) =>
        matchesReportPersona([view.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          view.title,
          view.description,
          view.dateRangePreset,
          view.comparisonPeriod,
          view.basis,
          view.currency,
          view.dimension,
          view.exportFormat,
          view.automationTrigger,
          view.commandKeywords,
          view.report.name,
          view.comparisonPreset.title,
          view.automationStarter.title,
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportSavedViewSummaries]);

  const reportSuiteSummaries = useMemo(() => {
    return reportSuiteProfiles.flatMap((suite) => {
      const workspace = workspaceSummaries.find((item) => item.persona === suite.persona);
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === suite.comparisonPresetId
      );
      const packTemplate = reportPackTemplates.find(
        (template) => template.id === suite.packTemplateId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === suite.automationStarterId
      );
      const deliverySubscription = reportDeliverySubscriptions.find(
        (subscription) => subscription.id === suite.deliverySubscriptionId
      );
      const triggerRules = suite.triggerRuleIds
        .map((ruleId) => reportAutomationTriggerRules.find((rule) => rule.id === ruleId))
        .filter((rule): rule is (typeof reportAutomationTriggerRules)[number] => Boolean(rule));
      const decisionShortcut = reportDecisionShortcuts.find(
        (shortcut) => shortcut.id === suite.decisionShortcutId
      );
      if (
        !workspace ||
        !comparisonPreset ||
        !packTemplate ||
        !automationStarter ||
        !deliverySubscription ||
        !decisionShortcut
      ) {
        return [];
      }

      const reports = suite.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const savedViews = suite.savedViewIds
        .map((viewId) => reportSavedViewSummaries.find((view) => view.id === viewId))
        .filter((view): view is (typeof reportSavedViewSummaries)[number] => Boolean(view));

      return [
        {
          ...suite,
          workspace,
          reports,
          readyCount: reports.filter((report) => report.status !== "planned").length,
          comparisonPreset,
          comparisonHref: reportComparisonPresetHref(comparisonPreset),
          packTemplate,
          packHref: reportPackTemplateHref(packTemplate),
          automationStarter,
          automationHref: reportAutomationStarterHref(automationStarter),
          deliverySubscription,
          deliveryHref: reportDeliverySubscriptionHref(deliverySubscription),
          triggerRules,
          triggerRuleHref: triggerRules[0]
            ? reportAutomationTriggerRuleHref(triggerRules[0])
            : null,
          decisionShortcut,
          decisionHref: reportDecisionShortcutHref(decisionShortcut),
          savedViews,
          href: reportSuiteHref(suite),
          categories: uniqueSorted(reports.map((report) => report.category)),
        },
      ];
    });
  }, [reportSavedViewSummaries, workspaceSummaries]);

  const visibleReportSuiteSummaries = useMemo(() => {
    return reportSuiteSummaries.filter(
      (suite) =>
        matchesReportPersona([suite.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          suite.title,
          suite.outcome,
          suite.workflow,
          suite.primaryAction,
          suite.commandKeywords,
          suite.reports.map((report) => report.name).join(" "),
          suite.comparisonPreset.title,
          suite.packTemplate.title,
          suite.automationStarter.title,
          suite.deliverySubscription.title,
          suite.triggerRules.map((rule) => rule.title).join(" "),
          suite.decisionShortcut.question,
          suite.savedViews.map((view) => view.title).join(" "),
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportSuiteSummaries]);

  const reportManagementBriefSummaries = useMemo(() => {
    return reportManagementBriefProfiles.flatMap((brief) => {
      const workspace = workspaceSummaries.find((item) => item.persona === brief.persona);
      const reportSuite = reportSuiteSummaries.find((suite) => suite.id === brief.reportSuiteId);
      const packTemplate = reportPackTemplates.find(
        (template) => template.id === brief.packTemplateId
      );
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === brief.comparisonPresetId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === brief.automationStarterId
      );
      const deliverySubscription = reportDeliverySubscriptions.find(
        (subscription) => subscription.id === brief.deliverySubscriptionId
      );
      const decisionShortcut = reportDecisionShortcuts.find(
        (shortcut) => shortcut.id === brief.decisionShortcutId
      );
      const savedView = reportSavedViewProfiles.find((view) => view.id === brief.savedViewId);

      if (
        !workspace ||
        !reportSuite ||
        !packTemplate ||
        !comparisonPreset ||
        !automationStarter ||
        !deliverySubscription ||
        !decisionShortcut ||
        !savedView
      ) {
        return [];
      }

      const reports = brief.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const readyCount = reports.filter((report) => report.status !== "planned").length;

      return [
        {
          ...brief,
          workspace,
          reports,
          readyCount,
          reportSuite,
          suiteHref: reportSuiteHref(reportSuite),
          packTemplate,
          packHref: reportPackTemplateHref(packTemplate),
          comparisonPreset,
          comparisonHref: reportComparisonPresetHref(comparisonPreset),
          automationStarter,
          automationHref: reportAutomationStarterHref(automationStarter),
          deliverySubscription,
          deliveryHref: reportDeliverySubscriptionHref(deliverySubscription),
          decisionShortcut,
          decisionHref: reportDecisionShortcutHref(decisionShortcut),
          savedView,
          savedViewHref: reportSavedViewHref(savedView),
          href: reportManagementBriefHref(brief),
        },
      ];
    });
  }, [reportSuiteSummaries, workspaceSummaries]);

  const visibleReportManagementBriefSummaries = useMemo(() => {
    return reportManagementBriefSummaries.filter(
      (brief) =>
        matchesReportPersona([brief.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          brief.title,
          brief.audience,
          brief.outcome,
          brief.commandKeywords,
          brief.reports.map((report) => report.name).join(" "),
          brief.kpiMetricIds.join(" "),
          brief.narrativeSections.map((section) => section.title).join(" "),
          brief.narrativeSections.map((section) => section.prompt).join(" "),
          brief.dimensionBreakdowns.map((dimension) => dimension.label).join(" "),
          brief.dimensionBreakdowns.map((dimension) => dimension.dimension).join(" "),
          brief.batchAction?.label ?? "",
          brief.reportSuite.title,
          brief.packTemplate.title,
          brief.comparisonPreset.title,
          brief.deliverySubscription.title,
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportManagementBriefSummaries]);

  const reportPackTemplateSummaries = useMemo(() => {
    return reportPackTemplates.flatMap((template) => {
      const workspace = workspaceSummaries.find((item) => item.persona === template.persona);
      if (!workspace) return [];

      const reports = template.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const readyCount = reports.filter((report) => report.status !== "planned").length;

      return [
        {
          ...template,
          workspace,
          reports,
          readyCount,
          href: reportPackTemplateHref(template),
          categories: uniqueSorted(reports.map((report) => report.category)),
          comparisonTypes: uniqueSorted(reports.map((report) => report.comparison)),
          automationHooks: uniqueSorted(reports.map((report) => report.automation)),
        },
      ];
    });
  }, [workspaceSummaries]);

  const visibleReportPackTemplates = useMemo(() => {
    return reportPackTemplateSummaries.filter(
      (template) =>
        matchesReportPersona([template.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          template.title,
          template.audience,
          template.outcome,
          template.cadence,
          template.delivery,
          template.comparisonFocus,
          template.automationTrigger,
          template.commandKeywords,
          template.reports.map((report) => report.name).join(" "),
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportPackTemplateSummaries]);

  const reportDecisionShortcutSummaries = useMemo(() => {
    return reportDecisionShortcuts.flatMap((shortcut) => {
      const workspace = workspaceSummaries.find((item) => item.persona === shortcut.persona);
      const primaryReport = reportCatalog.find((report) => report.id === shortcut.primaryReportId);
      if (!workspace || !primaryReport) return [];
      const context = reportActionContextByPersonaReportId.get(
        `${shortcut.persona}:${primaryReport.id}`
      );

      const reports = shortcut.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const comparisonPreset = reportComparisonPresets.find(
        (preset) => preset.id === shortcut.comparisonPresetId
      );
      const automationStarter = reportAutomationStarters.find(
        (starter) => starter.id === shortcut.automationStarterId
      );

      return [
        {
          ...shortcut,
          workspace,
          primaryReport,
          reports,
          comparisonPreset,
          automationStarter,
          href: reportDecisionShortcutHref(shortcut),
          primaryReportHref:
            context?.reportHref ??
            reportPersonaHref(primaryReport, shortcut.persona) ??
            reportDecisionShortcutHref(shortcut),
          workflowHref:
            context?.workflowHref ??
            reportWorkflowContextHref({
              persona: shortcut.persona,
              tab: primaryReport.tab ?? workspace.primaryTab,
              search: shortcut.question,
            }),
          comparisonHref: comparisonPreset
            ? reportComparisonPresetHref(comparisonPreset)
            : reportDecisionShortcutHref(shortcut),
          automationHref: automationStarter
            ? reportAutomationStarterHref(automationStarter)
            : reportDecisionShortcutHref(shortcut),
        },
      ];
    });
  }, [reportActionContextByPersonaReportId, workspaceSummaries]);

  const visibleReportDecisionShortcuts = useMemo(() => {
    return reportDecisionShortcutSummaries.filter(
      (shortcut) =>
        matchesReportPersona([shortcut.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          shortcut.question,
          shortcut.answer,
          shortcut.commandKeywords,
          shortcut.primaryReport.name,
          shortcut.reports.map((report) => report.name).join(" "),
          shortcut.comparisonPreset?.title,
          shortcut.automationStarter?.title,
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportDecisionShortcutSummaries]);

  const dateParams =
    dateRange.from && dateRange.to
      ? `?startDate=${format(dateRange.from, "yyyy-MM-dd")}&endDate=${format(dateRange.to, "yyyy-MM-dd")}`
      : "";
  const salesProductServiceParams = dateParams;
  const trialBalanceParams =
    dateRange.from && dateRange.to
      ? `?from=${format(dateRange.from, "yyyy-MM-dd")}&to=${format(dateRange.to, "yyyy-MM-dd")}`
      : "";
  const comparisonRanges = useMemo(() => buildComparisonRanges(dateRange), [dateRange]);
  const comparisonCurrentParams = comparisonParams(comparisonRanges.current);
  const comparisonPreviousParams = comparisonParams(comparisonRanges.previous);
  const comparisonCurrentLabel = `${format(comparisonRanges.current.from, "MMM dd, yyyy")} - ${format(
    comparisonRanges.current.to,
    "MMM dd, yyyy"
  )}`;
  const comparisonPreviousLabel = `${format(
    comparisonRanges.previous.from,
    "MMM dd, yyyy"
  )} - ${format(comparisonRanges.previous.to, "MMM dd, yyyy")}`;
  const comparisonCurrentRange = comparisonRanges.current;
  const comparisonPreviousRange = comparisonRanges.previous;
  const corporateTaxPeriodStart = format(comparisonCurrentRange.from, "yyyy-MM-dd");
  const corporateTaxPeriodEnd = format(comparisonCurrentRange.to, "yyyy-MM-dd");
  const corporateTaxParams = `?periodStart=${corporateTaxPeriodStart}&periodEnd=${corporateTaxPeriodEnd}`;
  const corporateTaxPreviousPeriodStart = format(comparisonPreviousRange.from, "yyyy-MM-dd");
  const corporateTaxPreviousPeriodEnd = format(comparisonPreviousRange.to, "yyyy-MM-dd");
  const corporateTaxPreviousParams = `?periodStart=${corporateTaxPreviousPeriodStart}&periodEnd=${corporateTaxPreviousPeriodEnd}`;
  const corporateTaxPeriodLabel = `${format(comparisonCurrentRange.from, "MMM dd, yyyy")} - ${format(
    comparisonCurrentRange.to,
    "MMM dd, yyyy"
  )}`;
  const monthEndPeriodAnchor = useMemo(() => dateRange.to ?? new Date(), [dateRange.to]);
  const monthEndPeriod = format(monthEndPeriodAnchor, "yyyy-MM");
  const monthEndPeriodLabel = format(monthEndPeriodAnchor, "MMMM yyyy");
  const depreciationPeriodDate = useMemo(
    () => startOfReportMonth(monthEndPeriodAnchor),
    [monthEndPeriodAnchor]
  );
  const accessibleReportCompanies = useMemo(() => {
    const seen = new Set<string>();
    return accessibleCompanies.filter((company): company is Company => {
      if (!company?.id || seen.has(company.id)) return false;
      seen.add(company.id);
      return true;
    });
  }, [accessibleCompanies]);
  const selectedCompany = useMemo(
    () => accessibleReportCompanies.find((company) => company.id === selectedCompanyId) ?? null,
    [accessibleReportCompanies, selectedCompanyId]
  );
  const consolidatedCompanyIds = useMemo(
    () => accessibleReportCompanies.map((company) => company.id).sort(),
    [accessibleReportCompanies]
  );
  const advancedReportPeriod = "quarter";
  const reportQueryOptions = {
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  } as const;
  const shouldLoadReportData = (...reportIds: string[]) =>
    Boolean(selectedCompanyId) &&
    (activeReportWorkspaceTab !== "reports" ||
      (hasFocusedReportSelection &&
        selectedReportId !== null &&
        reportIds.includes(selectedReportId)));
  const shouldLoadWorkflowData =
    Boolean(selectedCompanyId) && activeReportWorkspaceTab !== "reports";
  const shouldLoadReportDeliveryData =
    Boolean(selectedCompanyId) &&
    ["home", "automation", "delivery", "suites"].includes(activeReportWorkspaceTab);

  const { data: profitLoss, isLoading: plLoading } = useQuery<ProfitLossReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "pl", dateParams],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("profit-loss"),
  });

  const { data: costCenterProfitability, isLoading: costCenterProfitabilityLoading } =
    useQuery<CostCenterProfitabilityReport>({
      queryKey: ["/api/companies", selectedCompanyId, "cost-centers", "profitability", dateParams],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/cost-centers/profitability${dateParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("cost-center-profitability"),
    });

  const { data: balanceSheet, isLoading: bsLoading } = useQuery<BalanceSheetReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "balance-sheet", dateParams],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("balance-sheet"),
  });

  const { data: vatSummary, isLoading: vatLoading } = useQuery<VATSummaryReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "vat-summary", dateParams],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("vat-summary"),
  });

  const { data: cashFlowStatement = [], isLoading: cashFlowStatementLoading } = useQuery<
    CashFlowStatementRow[]
  >({
    queryKey: ["/api/reports", selectedCompanyId, "cash-flow", advancedReportPeriod],
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });

  const { data: agingReport = [], isLoading: agingReportLoading } = useQuery<AgingReportItem[]>({
    queryKey: ["/api/reports", selectedCompanyId, "aging"],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("ar-aging"),
  });

  const { data: billAgingReport, isLoading: billAgingLoading } = useQuery<BillAgingReport>({
    queryKey: ["/api/companies", selectedCompanyId, "bills", "aging"],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("ap-aging"),
  });

  const { data: vendorBills = [], isLoading: vendorBillsLoading } = useQuery<VendorBillReportRow[]>(
    {
      queryKey: ["/api/companies", selectedCompanyId, "bills"],
      ...reportQueryOptions,
      enabled: shouldLoadReportData(
        "ap-aging",
        "vendor-balances",
        "expenses-vendor",
        "expenses-category"
      ),
    }
  );

  const { data: advancedPeriodComparison = [], isLoading: advancedPeriodComparisonLoading } =
    useQuery<AdvancedPeriodComparisonRow[]>({
      queryKey: ["/api/reports", selectedCompanyId, "comparison", advancedReportPeriod],
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });

  const { data: fxGainsLosses, isLoading: fxGainsLossesLoading } = useQuery<FxGainsLossesReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "fx-gains-losses"],
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });

  const { data: vatReturns = [], isLoading: vatReturnsLoading } = useQuery<VATReturnReportRow[]>({
    queryKey: ["/api/companies", selectedCompanyId, "vat-returns"],
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });

  const { data: corporateTaxEstimate, isLoading: corporateTaxLoading } =
    useQuery<CorporateTaxEstimateReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "corporate-tax",
        "calculate",
        corporateTaxPeriodStart,
        corporateTaxPeriodEnd,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/corporate-tax/calculate${corporateTaxParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("corporate-tax-estimate"),
    });

  const corporateTaxStatus = useMemo(
    () => corporateTaxEstimateStatus(corporateTaxEstimate),
    [corporateTaxEstimate]
  );

  const {
    data: comparisonPreviousCorporateTaxEstimate,
    isLoading: comparisonPreviousCorporateTaxLoading,
  } = useQuery<CorporateTaxEstimateReport>({
    queryKey: [
      "/api/companies",
      selectedCompanyId,
      "corporate-tax",
      "comparison",
      "previous",
      corporateTaxPreviousPeriodStart,
      corporateTaxPreviousPeriodEnd,
    ],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/corporate-tax/calculate${corporateTaxPreviousParams}`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });

  const corporateTaxBridgeRows = useMemo(
    () => [
      {
        metric: tr("revenue"),
        amount: corporateTaxEstimate?.totalRevenue ?? 0,
        note: tr("postedIncomeAccountsInTheSelected"),
      },
      {
        metric: tr("lessExpenses"),
        amount: -(corporateTaxEstimate?.totalExpenses ?? 0),
        note: tr("postedExpenseAccountsInTheSelected"),
      },
      {
        metric: tr("grossProfit"),
        amount: corporateTaxEstimate?.grossProfit ?? 0,
        note: tr("revenueLessExpensesBeforeTaxSpecific"),
      },
      {
        metric: tr("lessDeductions"),
        amount: -(corporateTaxEstimate?.totalDeductions ?? 0),
        note: tr("adjustableInTheCorporateTaxWorkspace"),
      },
      {
        metric: tr("taxableIncome"),
        amount: corporateTaxEstimate?.taxableIncome ?? 0,
        note: tr("incomeBeforeApplyingTheZeroRate"),
      },
      {
        metric: tr("lessZeroRateBand"),
        amount: -(corporateTaxEstimate?.exemptionThreshold ?? 0),
        note: tr("thresholdReturnedByTheCorporateTax"),
      },
      {
        metric: tr("incomeAboveZeroRateBand"),
        amount: corporateTaxEstimate?.taxableAmount ?? 0,
        note: tr("positiveIncomeAboveTheZeroRate"),
      },
      {
        metric: tr("corporateTaxPayable"),
        amount: corporateTaxEstimate?.taxPayable ?? 0,
        note: corporateTaxStatus.detail,
      },
    ],
    [corporateTaxEstimate, corporateTaxStatus.detail]
  );

  const { data: comparisonCurrentProfitLoss, isLoading: comparisonCurrentPlLoading } =
    useQuery<ProfitLossReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "comparison",
        "pl",
        comparisonCurrentParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/pl${comparisonCurrentParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });

  const { data: comparisonPreviousProfitLoss, isLoading: comparisonPreviousPlLoading } =
    useQuery<ProfitLossReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "comparison",
        "pl",
        comparisonPreviousParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/pl${comparisonPreviousParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });

  const { data: comparisonCurrentBalanceSheet, isLoading: comparisonCurrentBalanceSheetLoading } =
    useQuery<BalanceSheetReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "comparison",
        "balance-sheet",
        comparisonCurrentParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/balance-sheet${comparisonCurrentParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });

  const { data: comparisonPreviousBalanceSheet, isLoading: comparisonPreviousBalanceSheetLoading } =
    useQuery<BalanceSheetReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "comparison",
        "balance-sheet",
        comparisonPreviousParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/balance-sheet${comparisonPreviousParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });

  const {
    data: comparisonCurrentSalesProductService,
    isLoading: comparisonCurrentSalesProductServiceLoading,
  } = useQuery<SalesProductServiceReport>({
    queryKey: [
      "/api/companies",
      selectedCompanyId,
      "reports",
      "comparison",
      "sales-product-service",
      comparisonCurrentParams,
    ],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/reports/sales-product-service${comparisonCurrentParams}`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });

  const {
    data: comparisonPreviousSalesProductService,
    isLoading: comparisonPreviousSalesProductServiceLoading,
  } = useQuery<SalesProductServiceReport>({
    queryKey: [
      "/api/companies",
      selectedCompanyId,
      "reports",
      "comparison",
      "sales-product-service",
      comparisonPreviousParams,
    ],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/reports/sales-product-service${comparisonPreviousParams}`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });

  const {
    data: comparisonCurrentCostCenterProfitability,
    isLoading: comparisonCurrentCostCenterLoading,
  } = useQuery<CostCenterProfitabilityReport>({
    queryKey: [
      "/api/companies",
      selectedCompanyId,
      "cost-centers",
      "comparison",
      "profitability",
      comparisonCurrentParams,
    ],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/cost-centers/profitability${comparisonCurrentParams}`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });

  const {
    data: comparisonPreviousCostCenterProfitability,
    isLoading: comparisonPreviousCostCenterLoading,
  } = useQuery<CostCenterProfitabilityReport>({
    queryKey: [
      "/api/companies",
      selectedCompanyId,
      "cost-centers",
      "comparison",
      "profitability",
      comparisonPreviousParams,
    ],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/cost-centers/profitability${comparisonPreviousParams}`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });

  const { data: comparisonCurrentVat, isLoading: comparisonCurrentVatLoading } =
    useQuery<VATSummaryReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "comparison",
        "vat-summary",
        comparisonCurrentParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/vat-summary${comparisonCurrentParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });

  const { data: comparisonPreviousVat, isLoading: comparisonPreviousVatLoading } =
    useQuery<VATSummaryReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "comparison",
        "vat-summary",
        comparisonPreviousParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/vat-summary${comparisonPreviousParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadWorkflowData,
    });

  const { data: consolidatedStatementSources = [], isLoading: consolidatedStatementsLoading } =
    useQuery<ConsolidatedCompanyStatementSource[]>({
      queryKey: [
        "/api/companies",
        "reports",
        "consolidated-statements",
        consolidatedCompanyIds,
        dateParams,
        comparisonCurrentParams,
        comparisonPreviousParams,
      ],
      queryFn: () =>
        Promise.all(
          accessibleReportCompanies.map(async (company) => {
            const base = {
              companyId: company.id,
              companyName: company.name || company.legalName || tr("unnamedCompany"),
              companyType: company.companyType || "company",
              baseCurrency: company.baseCurrency || "AED",
            };

            try {
              const [
                companyProfitLoss,
                companyBalanceSheet,
                companyComparisonCurrentProfitLoss,
                companyComparisonPreviousProfitLoss,
              ] = await Promise.all([
                apiRequest("GET", `/api/companies/${company.id}/reports/pl${dateParams}`),
                apiRequest(
                  "GET",
                  `/api/companies/${company.id}/reports/balance-sheet${dateParams}`
                ),
                apiRequest(
                  "GET",
                  `/api/companies/${company.id}/reports/pl${comparisonCurrentParams}`
                ),
                apiRequest(
                  "GET",
                  `/api/companies/${company.id}/reports/pl${comparisonPreviousParams}`
                ),
              ]);

              return {
                ...base,
                profitLoss: companyProfitLoss,
                balanceSheet: companyBalanceSheet,
                comparisonCurrentProfitLoss: companyComparisonCurrentProfitLoss,
                comparisonPreviousProfitLoss: companyComparisonPreviousProfitLoss,
                error: null,
              };
            } catch (error: any) {
              return {
                ...base,
                profitLoss: null,
                balanceSheet: null,
                comparisonCurrentProfitLoss: null,
                comparisonPreviousProfitLoss: null,
                error: error?.message || tr("financialReportsCouldNotBeLoaded"),
              };
            }
          })
        ),
      ...reportQueryOptions,
      enabled:
        accessibleReportCompanies.length > 0 &&
        (shouldLoadWorkflowData || shouldLoadReportData("consolidated-statements")),
    });

  const { data: trialBalance, isLoading: trialBalanceLoading } = useQuery<TrialBalanceReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "trial-balance", trialBalanceParams],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/reports/trial-balance${trialBalanceParams}`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("trial-balance"),
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<InvoiceReportRow[]>({
    queryKey: ["/api/companies", selectedCompanyId, "invoices"],
    ...reportQueryOptions,
    enabled: shouldLoadReportData(
      "ar-aging",
      "customer-balances",
      "invoice-status",
      "revenue-customer",
      "sales-product-service"
    ),
  });

  const { data: salesProductServiceReport, isLoading: salesProductServiceLoading } =
    useQuery<SalesProductServiceReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "sales-product-service",
        salesProductServiceParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/sales-product-service${salesProductServiceParams}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("sales-product-service"),
    });

  const { data: overdueReport, isLoading: overdueLoading } = useQuery<OverdueResponse>({
    queryKey: ["/api/chasing/overdue", selectedCompanyId],
    queryFn: () => apiRequest("GET", `/api/chasing/overdue/${selectedCompanyId}`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("ar-aging", "invoice-status"),
  });

  const { data: receipts = [], isLoading: receiptsLoading } = useQuery<ReceiptReportRow[]>({
    queryKey: ["/api/companies", selectedCompanyId, "receipts"],
    ...reportQueryOptions,
    enabled: shouldLoadReportData("expenses-vendor", "expenses-category"),
  });

  const { data: bankTransactions = [], isLoading: bankTransactionsLoading } = useQuery<
    BankTransactionReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "bank-statements", "transactions"],
    ...reportQueryOptions,
    enabled: shouldLoadWorkflowData,
  });

  const { data: expenseClaims = [], isLoading: expenseClaimsLoading } = useQuery<
    ExpenseClaimReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "expense-claims"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/expense-claims`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("expense-claims"),
  });

  const { data: expenseClaimSummary, isLoading: expenseClaimSummaryLoading } =
    useQuery<ExpenseClaimSummaryReport>({
      queryKey: ["/api/companies", selectedCompanyId, "expense-claims", "summary"],
      queryFn: () =>
        apiRequest("GET", `/api/companies/${selectedCompanyId}/expense-claims/summary`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("expense-claims"),
    });

  const { data: payrollRuns = [], isLoading: payrollRunsLoading } = useQuery<PayrollRunReportRow[]>(
    {
      queryKey: ["/api/companies", selectedCompanyId, "payroll-runs"],
      queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/payroll-runs`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("payroll-summary", "wps-sif-summary"),
    }
  );

  const { data: journalEntries = [], isLoading: journalLoading } = useQuery<
    JournalEntryReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "journal"],
    ...reportQueryOptions,
    enabled: shouldLoadReportData(
      "general-ledger",
      "account-transactions",
      "expenses-vendor",
      "expenses-category",
      "month-end-close-status",
      "audit-trail"
    ),
  });

  const { data: monthEndCloseStatus, isLoading: monthEndCloseLoading } =
    useQuery<MonthEndCloseStatusReport>({
      queryKey: ["/api/companies", selectedCompanyId, "month-end", "checklist", monthEndPeriod],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/month-end/checklist?period=${monthEndPeriod}`
        ),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("month-end-close-status"),
    });

  const { data: activityLogs = [], isLoading: activityLogsLoading } = useQuery<
    ActivityLogReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "activity-logs"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/activity-logs?limit=200`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("audit-trail"),
  });

  const { data: budgetPlans = [], isLoading: budgetPlansLoading } = useQuery<BudgetPlanReportRow[]>(
    {
      queryKey: ["/api/companies", selectedCompanyId, "budget-plans"],
      ...reportQueryOptions,
      enabled: shouldLoadReportData("budget-actual", "cash-flow-forecast"),
    }
  );

  const selectedBudgetPlan = useMemo(() => {
    return budgetPlans.find((budget) => budget.status === "approved") ?? budgetPlans[0];
  }, [budgetPlans]);

  const { data: varianceReport, isLoading: varianceLoading } = useQuery<VarianceReport>({
    queryKey: ["/api/budget-plans", selectedBudgetPlan?.id, "variance"],
    queryFn: () => apiRequest("GET", `/api/budget-plans/${selectedBudgetPlan?.id}/variance`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("budget-actual") && !!selectedBudgetPlan?.id,
  });

  const { data: cashFlowForecast, isLoading: cashFlowForecastLoading } =
    useQuery<CashFlowForecastReport>({
      queryKey: ["/api/companies", selectedCompanyId, "cashflow", "forecast", 90],
      queryFn: () =>
        apiRequest("GET", `/api/companies/${selectedCompanyId}/cashflow/forecast?days=90`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("cash-flow-forecast"),
    });

  const { data: balanceSummaries, isLoading: balanceSummariesLoading } =
    useQuery<BalanceSummaryReport>({
      queryKey: ["/api/companies", selectedCompanyId, "reports", "balance-summaries"],
      queryFn: () =>
        apiRequest("GET", `/api/companies/${selectedCompanyId}/reports/balance-summaries`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("customer-balances", "vendor-balances"),
    });

  const { data: fixedAssets = [], isLoading: fixedAssetsLoading } = useQuery<FixedAssetReportRow[]>(
    {
      queryKey: ["/api/companies", selectedCompanyId, "fixed-assets"],
      queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/fixed-assets`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("fixed-asset-register", "depreciation-schedule"),
    }
  );

  const { data: fixedAssetSummary, isLoading: fixedAssetSummaryLoading } =
    useQuery<FixedAssetSummaryReport>({
      queryKey: ["/api/companies", selectedCompanyId, "fixed-assets", "summary"],
      queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/fixed-assets/summary`),
      ...reportQueryOptions,
      enabled: shouldLoadReportData("fixed-asset-register", "depreciation-schedule"),
    });

  const { data: inventoryProducts = [], isLoading: inventoryProductsLoading } = useQuery<
    InventoryProductReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "products"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/products`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("inventory-valuation", "inventory-movement"),
  });

  const { data: inventoryMovements = [], isLoading: inventoryMovementsLoading } = useQuery<
    InventoryMovementReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "inventory-movements"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/inventory-movements`),
    ...reportQueryOptions,
    enabled: shouldLoadReportData("inventory-movement"),
  });

  const balancesLoading =
    balanceSummariesLoading ||
    fixedAssetsLoading ||
    fixedAssetSummaryLoading ||
    inventoryProductsLoading ||
    inventoryMovementsLoading;

  const trialBalanceSummary = useMemo(() => {
    const rows = trialBalance?.rows ?? [];
    const activeAccounts = rows.filter((row) => Math.abs(row.balance) > 0.005).length;
    const foreignCurrencyAccounts = rows.filter((row) => row.hasForeignLines).length;
    const isBalanced = (trialBalance?.totals?.difference ?? 0) < 0.005;
    return { activeAccounts, foreignCurrencyAccounts, isBalanced };
  }, [trialBalance]);

  const reportInvoices = useMemo(() => {
    return invoices.filter((invoice) => invoiceInDateRange(invoice, dateRange));
  }, [dateRange, invoices]);

  const statusSummary = useMemo<InvoiceStatusSummaryRow[]>(() => {
    const summaries = new Map<string, InvoiceStatusSummaryRow>();
    for (const invoice of reportInvoices) {
      const status = invoice.status || "unknown";
      const summary = summaries.get(status) ?? { status, count: 0, amountAed: 0 };
      summary.count += 1;
      summary.amountAed += amountInAed(invoice);
      summaries.set(status, summary);
    }
    return Array.from(summaries.values()).sort((a, b) => b.amountAed - a.amountAed);
  }, [reportInvoices]);

  const customerRevenue = useMemo<CustomerRevenueRow[]>(() => {
    const summaries = new Map<string, CustomerRevenueRow>();
    for (const invoice of reportInvoices) {
      if (nonRevenueInvoiceStatuses.has(invoice.status)) continue;
      const customerName = invoice.customerName || tr("unknownCustomer");
      const summary = summaries.get(customerName) ?? {
        customerName,
        invoiceCount: 0,
        amountAed: 0,
      };
      summary.invoiceCount += 1;
      summary.amountAed += amountInAed(invoice);
      summaries.set(customerName, summary);
    }
    return Array.from(summaries.values()).sort((a, b) => b.amountAed - a.amountAed);
  }, [reportInvoices]);

  const overdueRows = useMemo(() => overdueReport?.rows ?? [], [overdueReport?.rows]);
  const productServiceSalesRows = useMemo(
    () => salesProductServiceReport?.rows ?? [],
    [salesProductServiceReport?.rows]
  );
  const topProductServiceSalesRow = productServiceSalesRows[0];
  const productServiceTopShare = salesProductServiceReport?.totals?.topProductServiceShare ?? 0;

  const overdueCustomerRows = useMemo<OverdueCustomerRow[]>(() => {
    const summaries = new Map<string, OverdueCustomerRow>();
    for (const row of overdueRows) {
      const customerName = row.invoice.customerName || tr("unknownCustomer");
      const currency = row.invoice.currency || "AED";
      const key = `${customerName}::${currency}`;
      const summary = summaries.get(key) ?? {
        customerName,
        currency,
        invoiceCount: 0,
        outstanding: 0,
        maxDaysOverdue: 0,
        recommendedLevel: 1,
      };
      summary.invoiceCount += 1;
      summary.outstanding += Number(row.outstanding) || 0;
      summary.maxDaysOverdue = Math.max(summary.maxDaysOverdue, row.daysOverdue);
      summary.recommendedLevel = Math.max(summary.recommendedLevel, row.recommendedLevel);
      summaries.set(key, summary);
    }
    return Array.from(summaries.values()).sort((a, b) => b.outstanding - a.outstanding);
  }, [overdueRows]);

  const invoiceStatusReport = useMemo(() => {
    const activeInvoices = reportInvoices.filter(
      (invoice) => !inactiveInvoiceStatuses.has(invoice.status)
    );
    const invoiceValueAed = activeInvoices.reduce((sum, invoice) => sum + amountInAed(invoice), 0);
    const unpaidCount = activeInvoices.filter((invoice) =>
      ["sent", "posted", "partial"].includes(invoice.status)
    ).length;
    const overdueCurrencies = new Set(overdueRows.map((row) => row.invoice.currency || "AED"));
    const overdueCurrency =
      overdueCurrencies.size === 1 ? Array.from(overdueCurrencies)[0] : undefined;
    return {
      invoiceCount: reportInvoices.length,
      activeInvoiceCount: activeInvoices.length,
      unpaidCount,
      invoiceValueAed,
      overdueRows,
      overdueCustomerRows,
      overdueCurrency,
      overdueOutstanding: overdueReport?.totalOutstanding ?? 0,
      statusSummary,
      customerRevenue,
      productServiceRows: productServiceSalesRows,
      productServiceTotals: salesProductServiceReport?.totals ?? {
        productServiceCount: 0,
        invoiceCount: 0,
        lineCount: 0,
        quantity: 0,
        amountAed: 0,
        vatAed: 0,
        topProductServiceShare: 0,
      },
      invoices: reportInvoices,
    };
  }, [
    customerRevenue,
    overdueCustomerRows,
    overdueReport?.totalOutstanding,
    overdueRows,
    productServiceSalesRows,
    reportInvoices,
    salesProductServiceReport?.totals,
    statusSummary,
  ]);

  const salesLoading = invoicesLoading || overdueLoading;

  const inventoryValuationReport = useMemo(() => {
    const movementCountByProduct = new Map<string, number>();
    for (const movement of inventoryMovements) {
      movementCountByProduct.set(
        movement.productId,
        (movementCountByProduct.get(movement.productId) ?? 0) + 1
      );
    }

    const rows = inventoryProducts
      .map((product) => {
        const currentStock = Number(product.currentStock ?? 0) || 0;
        const unitCost = inventoryAmount(product.costPrice);
        const unitPrice = inventoryAmount(product.unitPrice);
        const stockValueAed = currentStock * unitCost;
        const lowStockThreshold = product.lowStockThreshold;
        return {
          ...product,
          currentStock,
          lowStockThreshold,
          unitCost,
          unitPrice,
          grossMarginAed: unitPrice - unitCost,
          stockValueAed,
          movementCount: movementCountByProduct.get(product.id) ?? 0,
          isLowStock:
            lowStockThreshold !== null &&
            lowStockThreshold !== undefined &&
            currentStock <= lowStockThreshold,
          isNegativeStock: currentStock < 0,
          isMissingCost: currentStock !== 0 && unitCost <= 0,
        };
      })
      .sort((a, b) => b.stockValueAed - a.stockValueAed || a.name.localeCompare(b.name));

    const activeRows = rows.filter((row) => row.isActive);
    const lowStockCount = activeRows.filter((row) => row.isLowStock).length;
    const negativeStockCount = activeRows.filter((row) => row.isNegativeStock).length;
    const missingCostCount = activeRows.filter((row) => row.isMissingCost).length;
    const reviewRows = activeRows.filter(
      (row) => row.isLowStock || row.isNegativeStock || row.isMissingCost
    );

    return {
      rows,
      activeRows,
      reviewRows,
      productCount: rows.length,
      activeProductCount: activeRows.length,
      totalUnits: activeRows.reduce((sum, row) => sum + row.currentStock, 0),
      totalStockValueAed: activeRows.reduce((sum, row) => sum + row.stockValueAed, 0),
      reviewValueAed: reviewRows.reduce((sum, row) => sum + Math.abs(row.stockValueAed), 0),
      lowStockCount,
      negativeStockCount,
      missingCostCount,
      movementCount: inventoryMovements.length,
      reviewCount: reviewRows.length,
    };
  }, [inventoryMovements, inventoryProducts]);

  const reportInventoryMovements = useMemo(() => {
    return inventoryMovements.filter((movement) =>
      inventoryMovementInDateRange(movement, dateRange)
    );
  }, [dateRange, inventoryMovements]);

  const inventoryMovementReport = useMemo(() => {
    const productById = new Map(inventoryProducts.map((product) => [product.id, product]));
    const typeRows = new Map<string, InventoryMovementTypeRow>();
    const rows = reportInventoryMovements
      .map((movement) => {
        const product = productById.get(movement.productId);
        const quantity = Number(movement.quantity ?? 0) || 0;
        const unitCost = inventoryAmount(movement.unitCost);
        const valueAed = Math.abs(quantity) * unitCost;
        const type = movement.type || "adjustment";
        const typeSummary = typeRows.get(type) ?? { type, count: 0, quantity: 0, valueAed: 0 };
        typeSummary.count += 1;
        typeSummary.quantity += Math.abs(quantity);
        typeSummary.valueAed += valueAed;
        typeRows.set(type, typeSummary);
        return {
          ...movement,
          type,
          quantity,
          unitCost,
          valueAed,
          productName: product?.name ?? tr("unknownProduct"),
          sku: product?.sku ?? "",
          unit: product?.unit ?? "",
        };
      })
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime || a.productName.localeCompare(b.productName);
      });
    const inboundTypes = new Set(["purchase", "return"]);
    const outboundTypes = new Set(["sale"]);
    const inboundUnits = rows
      .filter((row) => inboundTypes.has(row.type))
      .reduce((sum, row) => sum + Math.abs(row.quantity), 0);
    const outboundUnits = rows
      .filter((row) => outboundTypes.has(row.type))
      .reduce((sum, row) => sum + Math.abs(row.quantity), 0);
    const adjustmentUnits = rows
      .filter((row) => row.type === "adjustment")
      .reduce((sum, row) => sum + Math.abs(row.quantity), 0);
    const totalMovementValueAed = rows.reduce((sum, row) => sum + row.valueAed, 0);
    const outboundValueAed = rows
      .filter((row) => outboundTypes.has(row.type))
      .reduce((sum, row) => sum + row.valueAed, 0);

    return {
      rows,
      typeRows: Array.from(typeRows.values()).sort(
        (a, b) => b.valueAed - a.valueAed || a.type.localeCompare(b.type)
      ),
      movementCount: rows.length,
      inboundUnits,
      outboundUnits,
      adjustmentUnits,
      totalMovementValueAed,
      outboundValueAed,
      productCount: new Set(rows.map((row) => row.productId)).size,
      reorderSignalCount:
        inventoryValuationReport.lowStockCount + inventoryValuationReport.negativeStockCount,
    };
  }, [
    inventoryProducts,
    inventoryValuationReport.lowStockCount,
    inventoryValuationReport.negativeStockCount,
    reportInventoryMovements,
  ]);

  const fixedAssetRegisterReport = useMemo(() => {
    const rows: FixedAssetValuationRow[] = fixedAssets
      .map((asset) => ({
        ...asset,
        purchaseCost: fixedAssetAmount(asset.purchase_cost),
        salvageValue: fixedAssetAmount(asset.salvage_value),
        accumulatedDepreciation: fixedAssetAmount(asset.accumulated_depreciation),
        netBookValue: fixedAssetAmount(asset.net_book_value),
      }))
      .sort((a, b) => b.netBookValue - a.netBookValue || a.asset_name.localeCompare(b.asset_name));
    const activeRows = rows.filter((asset) => asset.status === "active");
    const capitalizationReviewRows = activeRows.filter((asset) => asset.needs_capitalization_je);
    const depreciationReviewRows = activeRows.filter(
      (asset) =>
        asset.category !== "Land" &&
        Number(asset.useful_life_years ?? 0) > 0 &&
        asset.netBookValue > asset.salvageValue + 0.005
    );
    const reviewRows = activeRows.filter(
      (asset) =>
        asset.needs_capitalization_je ||
        (asset.category !== "Land" &&
          Number(asset.useful_life_years ?? 0) > 0 &&
          asset.netBookValue > asset.salvageValue + 0.005)
    );

    return {
      rows,
      activeRows,
      reviewRows,
      byCategory: fixedAssetSummary?.byCategory ?? [],
      totalAssets: fixedAssetSummary?.totalAssets ?? activeRows.length,
      totalCost:
        fixedAssetSummary?.totalCost ??
        activeRows.reduce((sum, asset) => sum + asset.purchaseCost, 0),
      totalAccumulatedDepreciation:
        fixedAssetSummary?.totalAccumulatedDepreciation ??
        activeRows.reduce((sum, asset) => sum + asset.accumulatedDepreciation, 0),
      totalNetBookValue:
        fixedAssetSummary?.totalNetBookValue ??
        activeRows.reduce((sum, asset) => sum + asset.netBookValue, 0),
      disposedAssetCount: rows.filter((asset) => asset.status !== "active").length,
      capitalizationReviewCount: capitalizationReviewRows.length,
      depreciationReviewCount: depreciationReviewRows.length,
      reviewValueAed: reviewRows.reduce((sum, asset) => sum + Math.max(0, asset.netBookValue), 0),
      reviewCount: reviewRows.length,
    };
  }, [fixedAssetSummary, fixedAssets]);

  const depreciationScheduleReport = useMemo(
    () =>
      buildDepreciationScheduleReport(fixedAssetRegisterReport.activeRows, depreciationPeriodDate),
    [depreciationPeriodDate, fixedAssetRegisterReport.activeRows]
  );

  const balanceReport = useMemo(() => {
    const customers = balanceSummaries?.customers ?? [];
    const vendors = balanceSummaries?.vendors ?? [];
    const customerOpenAed = customers.reduce((sum, row) => sum + row.openBalanceAed, 0);
    const customerOverdueAed = customers.reduce((sum, row) => sum + row.overdueBalanceAed, 0);
    const vendorOpenAed = vendors.reduce((sum, row) => sum + row.openBalanceAed, 0);
    const vendorOverdueAed = vendors.reduce((sum, row) => sum + row.overdueBalanceAed, 0);
    return {
      generatedAt: balanceSummaries?.generatedAt,
      customers,
      vendors,
      customerCount: customers.length,
      vendorCount: vendors.length,
      customerOpenAed,
      customerOverdueAed,
      vendorOpenAed,
      vendorOverdueAed,
      netBalanceAed: customerOpenAed - vendorOpenAed,
      overdueCustomerCount: customers.filter((row) => row.overdueBalanceAed > 0).length,
      overdueVendorCount: vendors.filter((row) => row.overdueBalanceAed > 0).length,
      inventory: {
        ...inventoryValuationReport,
        movementCount: inventoryMovementReport.movementCount,
        movementRows: inventoryMovementReport.rows,
        movementTypeRows: inventoryMovementReport.typeRows,
        productMovementCount: inventoryMovementReport.productCount,
        movementInboundUnits: inventoryMovementReport.inboundUnits,
        movementOutboundUnits: inventoryMovementReport.outboundUnits,
        movementAdjustmentUnits: inventoryMovementReport.adjustmentUnits,
        totalMovementValueAed: inventoryMovementReport.totalMovementValueAed,
        outboundMovementValueAed: inventoryMovementReport.outboundValueAed,
      },
      fixedAssets: {
        ...fixedAssetRegisterReport,
        depreciation: depreciationScheduleReport,
      },
    };
  }, [
    balanceSummaries,
    depreciationScheduleReport,
    fixedAssetRegisterReport,
    inventoryMovementReport,
    inventoryValuationReport,
  ]);

  const receivableAgingRows = useMemo(
    () =>
      agingReport
        .filter((row) => row.type === "receivable")
        .slice()
        .sort((a, b) => b.total - a.total),
    [agingReport]
  );

  const receivableAgingSummary = useMemo(
    () => ({
      current: receivableAgingRows.reduce((sum, row) => sum + row.current, 0),
      overdue: receivableAgingRows.reduce(
        (sum, row) => sum + row.days30 + row.days60 + row.days90 + row.over90,
        0
      ),
      over90: receivableAgingRows.reduce((sum, row) => sum + row.over90, 0),
      total: receivableAgingRows.reduce((sum, row) => sum + row.total, 0),
    }),
    [receivableAgingRows]
  );

  const payableAgingBuckets = useMemo(
    () => [
      {
        label: tr("current"),
        count: billAgingReport?.current?.count ?? 0,
        amount: billAgingReport?.current?.amount ?? 0,
      },
      {
        label: "1-30",
        count: billAgingReport?.days_1_30?.count ?? 0,
        amount: billAgingReport?.days_1_30?.amount ?? 0,
      },
      {
        label: "31-60",
        count: billAgingReport?.days_31_60?.count ?? 0,
        amount: billAgingReport?.days_31_60?.amount ?? 0,
      },
      {
        label: "61-90",
        count: billAgingReport?.days_61_90?.count ?? 0,
        amount: billAgingReport?.days_61_90?.amount ?? 0,
      },
      {
        label: "90+",
        count: billAgingReport?.days_90_plus?.count ?? 0,
        amount: billAgingReport?.days_90_plus?.amount ?? 0,
      },
    ],
    [billAgingReport]
  );

  const payableAgingSummary = useMemo(() => {
    const overdueBuckets = payableAgingBuckets.slice(1);
    return {
      current: payableAgingBuckets[0]?.amount ?? 0,
      overdue: overdueBuckets.reduce((sum, bucket) => sum + bucket.amount, 0),
      over90: payableAgingBuckets[4]?.amount ?? 0,
      total: payableAgingBuckets.reduce((sum, bucket) => sum + bucket.amount, 0),
      billCount: payableAgingBuckets.reduce((sum, bucket) => sum + bucket.count, 0),
    };
  }, [payableAgingBuckets]);

  const agingExportSheets = useMemo(
    () => prepareAgingReportsForExport({ receivables: agingReport, payables: billAgingReport }),
    [agingReport, billAgingReport]
  );
  const receivableAgingExportSheets = useMemo(
    () => agingExportSheets.filter((sheet) => sheet.sheetName === "A/R Aging"),
    [agingExportSheets]
  );
  const payableAgingExportSheets = useMemo(
    () => agingExportSheets.filter((sheet) => sheet.sheetName === "A/P Aging"),
    [agingExportSheets]
  );

  const consolidatedStatementsReport = useMemo(
    () =>
      buildConsolidatedStatementsReport(
        consolidatedStatementSources,
        dateRange.from && dateRange.to
          ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
          : "All posted activity",
        "AED"
      ),
    [consolidatedStatementSources, dateRange.from, dateRange.to]
  );

  const reportReceipts = useMemo(() => {
    return receipts.filter((receipt) => receiptInDateRange(receipt, dateRange));
  }, [dateRange, receipts]);

  const receiptVendorById = useMemo(() => {
    return new Map(
      receipts.map((receipt) => [receipt.id, receipt.merchant || tr("unknownReceiptVendor")])
    );
  }, [receipts]);

  const vendorBillVendorById = useMemo(() => {
    return new Map(
      vendorBills.map((bill) => [bill.id, bill.vendor_name || tr("unknownBillVendor")])
    );
  }, [vendorBills]);

  const reportExpenseJournalEntries = useMemo(() => {
    return journalEntries.filter(
      (entry) => entry.status === "posted" && journalEntryInDateRange(entry, dateRange)
    );
  }, [dateRange, journalEntries]);

  const expenseVendorLabel = useCallback(
    (entry: JournalEntryReportRow) => {
      const source = (entry.source || "").toLowerCase();
      if (source === "bill" && entry.sourceId) {
        return vendorBillVendorById.get(entry.sourceId) ?? tr("unknownBillVendor");
      }
      if (source === "receipt" && entry.sourceId) {
        return receiptVendorById.get(entry.sourceId) ?? tr("unknownReceiptVendor");
      }
      return tr("manualNoVendor");
    },
    [receiptVendorById, vendorBillVendorById]
  );

  const buildExpenseSummary = useCallback(
    (getLabel: (entry: JournalEntryReportRow, line: JournalLineReportRow) => string) => {
      const summaries = new Map<string, ExpenseSummaryRow & { entryIds: Set<string> }>();
      for (const entry of reportExpenseJournalEntries) {
        for (const line of entry.lines ?? []) {
          if (line.account?.type !== "expense") continue;
          const debitAed = Number(line.debit) || 0;
          const creditAed = Number(line.credit) || 0;
          if (Math.abs(debitAed) < 0.005 && Math.abs(creditAed) < 0.005) continue;
          const label = getLabel(entry, line);
          const summary = summaries.get(label) ?? {
            label,
            entryCount: 0,
            lineCount: 0,
            debitAed: 0,
            creditAed: 0,
            netExpenseAed: 0,
            entryIds: new Set<string>(),
          };
          summary.entryIds.add(entry.id);
          summary.lineCount += 1;
          summary.debitAed += debitAed;
          summary.creditAed += creditAed;
          summary.netExpenseAed += debitAed - creditAed;
          summaries.set(label, summary);
        }
      }
      return Array.from(summaries.values())
        .map(({ entryIds, ...summary }) => ({
          ...summary,
          entryCount: entryIds.size,
        }))
        .sort((a, b) => Math.abs(b.netExpenseAed) - Math.abs(a.netExpenseAed));
    },
    [reportExpenseJournalEntries]
  );

  const expenseByVendor = useMemo(
    () => buildExpenseSummary((entry) => expenseVendorLabel(entry)),
    [buildExpenseSummary, expenseVendorLabel]
  );

  const expenseByCategory = useMemo(
    () => buildExpenseSummary((_entry, line) => journalAccountName(line.account)),
    [buildExpenseSummary]
  );

  const reportExpenseClaims = useMemo(() => {
    return expenseClaims.filter((claim) => expenseClaimInDateRange(claim, dateRange));
  }, [dateRange, expenseClaims]);

  const expenseClaimReport = useMemo(() => {
    const statusRows = new Map<string, ExpenseClaimStatusRow>();
    for (const claim of reportExpenseClaims) {
      const status = claim.status || "draft";
      const summary = statusRows.get(status) ?? { status, count: 0, totalAmount: 0 };
      summary.count += 1;
      summary.totalAmount += expenseClaimAmount(claim);
      statusRows.set(status, summary);
    }
    const claimStatusRows = Array.from(statusRows.values()).sort(
      (a, b) => b.totalAmount - a.totalAmount || a.status.localeCompare(b.status)
    );
    const submittedClaims = reportExpenseClaims.filter((claim) => claim.status === "submitted");
    const approvedClaims = reportExpenseClaims.filter((claim) => claim.status === "approved");
    const paidClaims = reportExpenseClaims.filter((claim) => claim.status === "paid");
    const totalAmount = reportExpenseClaims.reduce(
      (sum, claim) => sum + expenseClaimAmount(claim),
      0
    );
    const submittedAmount = submittedClaims.reduce(
      (sum, claim) => sum + expenseClaimAmount(claim),
      0
    );
    const approvedAmount = approvedClaims.reduce(
      (sum, claim) => sum + expenseClaimAmount(claim),
      0
    );
    const thisMonthTotal = Object.values(expenseClaimSummary?.thisMonth ?? {}).reduce(
      (sum, bucket) => sum + Number(bucket.total ?? 0),
      0
    );

    return {
      claims: reportExpenseClaims,
      statusRows: claimStatusRows,
      claimCount: reportExpenseClaims.length,
      totalAmount,
      submittedCount: submittedClaims.length,
      submittedAmount,
      approvedUnpaidCount: approvedClaims.length,
      approvedUnpaidAmount: approvedAmount,
      paidCount: paidClaims.length,
      thisMonthTotal,
      reviewCount: submittedClaims.length + approvedClaims.length,
      summary: expenseClaimSummary ?? { all: {}, thisMonth: {} },
    };
  }, [expenseClaimSummary, reportExpenseClaims]);

  const expenseReport = useMemo(() => {
    const capturedReceiptSubtotalAed = reportReceipts.reduce(
      (sum, receipt) => sum + receiptSubtotalAed(receipt),
      0
    );
    const capturedReceiptVatAed = reportReceipts.reduce(
      (sum, receipt) => sum + receiptVatAed(receipt),
      0
    );
    const unpostedReceipts = reportReceipts.filter((receipt) => !receipt.posted).length;
    const autoPostedReceipts = reportReceipts.filter((receipt) => receipt.autoPosted).length;
    const debitAed = expenseByCategory.reduce((sum, row) => sum + row.debitAed, 0);
    const creditAed = expenseByCategory.reduce((sum, row) => sum + row.creditAed, 0);
    const totalAed = expenseByCategory.reduce((sum, row) => sum + row.netExpenseAed, 0);
    const expenseEntryIds = new Set<string>();
    for (const entry of reportExpenseJournalEntries) {
      if ((entry.lines ?? []).some((line) => line.account?.type === "expense")) {
        expenseEntryIds.add(entry.id);
      }
    }
    const expenseLines = reportExpenseJournalEntries
      .flatMap((entry) =>
        (entry.lines ?? [])
          .filter((line) => line.account?.type === "expense")
          .map((line) => {
            const debitAed = Number(line.debit) || 0;
            const creditAed = Number(line.credit) || 0;
            return {
              id: line.id,
              date: entry.date,
              entryNumber: entry.entryNumber,
              vendor: expenseVendorLabel(entry),
              accountName: journalAccountName(line.account),
              accountCode: line.account?.code || "",
              source: journalSourceLabel(entry.source),
              memo: line.memo || entry.memo || "",
              debitAed,
              creditAed,
              netExpenseAed: debitAed - creditAed,
            };
          })
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return {
      basis:
        "Posted journal lines where the linked chart-of-account type is expense. Input VAT and unposted receipts are shown separately as source-workflow context.",
      entryCount: expenseEntryIds.size,
      lineCount: expenseByCategory.reduce((sum, row) => sum + row.lineCount, 0),
      receiptCount: reportReceipts.length,
      subtotalAed: debitAed,
      vatAed: capturedReceiptVatAed,
      totalAed,
      debitAed,
      creditAed,
      receiptSpendAed: capturedReceiptSubtotalAed + capturedReceiptVatAed,
      unpostedReceipts,
      autoPostedReceipts,
      byVendor: expenseByVendor,
      byCategory: expenseByCategory,
      lines: expenseLines,
      receipts: reportReceipts,
      claims: expenseClaimReport,
    };
  }, [
    expenseByCategory,
    expenseByVendor,
    expenseVendorLabel,
    expenseClaimReport,
    reportExpenseJournalEntries,
    reportReceipts,
  ]);

  const expensesLoading =
    receiptsLoading || expenseClaimsLoading || expenseClaimSummaryLoading || journalLoading;

  const reportPayrollRuns = useMemo(() => {
    return payrollRuns.filter((run) => payrollRunInDateRange(run, dateRange));
  }, [dateRange, payrollRuns]);

  const payrollReport = useMemo(() => {
    const statusRows = new Map<string, PayrollStatusReportRow>();
    for (const run of reportPayrollRuns) {
      const status = run.status || "draft";
      const summary = statusRows.get(status) ?? {
        status,
        count: 0,
        employeeCount: 0,
        totalNet: 0,
      };
      summary.count += 1;
      summary.employeeCount += Number(run.employee_count ?? 0);
      summary.totalNet += payrollAmount(run.total_net);
      statusRows.set(status, summary);
    }

    const calculatedRuns = reportPayrollRuns.filter((run) => run.status === "calculated");
    const approvedRuns = reportPayrollRuns.filter((run) => run.status === "approved");
    const draftRuns = reportPayrollRuns.filter((run) => run.status === "draft");
    const sifEligibleRuns = reportPayrollRuns.filter(
      (run) => run.status === "calculated" || run.status === "approved"
    );
    const sifGeneratedRuns = reportPayrollRuns.filter((run) => Boolean(run.sif_file_content));
    const wpsMissingRuns = sifEligibleRuns.filter((run) => !run.sif_file_content);
    const latestRun = [...reportPayrollRuns].sort(
      (a, b) =>
        b.period_year - a.period_year ||
        b.period_month - a.period_month ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];

    return {
      runs: reportPayrollRuns,
      statusRows: Array.from(statusRows.values()).sort(
        (a, b) => b.totalNet - a.totalNet || a.status.localeCompare(b.status)
      ),
      runCount: reportPayrollRuns.length,
      employeeCount: reportPayrollRuns.reduce(
        (sum, run) => sum + Number(run.employee_count ?? 0),
        0
      ),
      totalBasic: reportPayrollRuns.reduce((sum, run) => sum + payrollAmount(run.total_basic), 0),
      totalAllowances: reportPayrollRuns.reduce(
        (sum, run) => sum + payrollAmount(run.total_allowances),
        0
      ),
      totalDeductions: reportPayrollRuns.reduce(
        (sum, run) => sum + payrollAmount(run.total_deductions),
        0
      ),
      totalNet: reportPayrollRuns.reduce((sum, run) => sum + payrollAmount(run.total_net), 0),
      approvedCount: approvedRuns.length,
      calculatedCount: calculatedRuns.length,
      draftCount: draftRuns.length,
      approvalQueueCount: calculatedRuns.length,
      sifGeneratedCount: sifGeneratedRuns.length,
      wpsReadyCount: approvedRuns.filter((run) => Boolean(run.sif_file_content)).length,
      wpsMissingCount: wpsMissingRuns.length,
      latestRun,
    };
  }, [reportPayrollRuns]);

  const payrollLoading = payrollRunsLoading;

  const comparisonRows = useMemo<ComparisonMetricRow[]>(() => {
    const currentInvoices = invoices.filter(
      (invoice) =>
        !inactiveInvoiceStatuses.has(invoice.status) &&
        invoiceInDateRange(invoice, comparisonCurrentRange)
    );
    const previousInvoices = invoices.filter(
      (invoice) =>
        !inactiveInvoiceStatuses.has(invoice.status) &&
        invoiceInDateRange(invoice, comparisonPreviousRange)
    );
    const currentVendorBillDocuments = vendorBills.filter(
      (bill) =>
        !nonPayableVendorBillStatuses.has(bill.status) &&
        vendorBillInDateRange(bill, comparisonCurrentRange)
    );
    const previousVendorBillDocuments = vendorBills.filter(
      (bill) =>
        !nonPayableVendorBillStatuses.has(bill.status) &&
        vendorBillInDateRange(bill, comparisonPreviousRange)
    );
    const currentVendorBills = currentVendorBillDocuments.filter(
      (bill) => !inactiveVendorBillStatuses.has(bill.status)
    );
    const previousVendorBills = previousVendorBillDocuments.filter(
      (bill) => !inactiveVendorBillStatuses.has(bill.status)
    );
    const currentReceipts = receipts.filter((receipt) =>
      receiptInDateRange(receipt, comparisonCurrentRange)
    );
    const previousReceipts = receipts.filter((receipt) =>
      receiptInDateRange(receipt, comparisonPreviousRange)
    );
    const currentBankTransactions = bankTransactions.filter((transaction) =>
      valueInDateRange(transaction.transactionDate, comparisonCurrentRange)
    );
    const previousBankTransactions = bankTransactions.filter((transaction) =>
      valueInDateRange(transaction.transactionDate, comparisonPreviousRange)
    );
    const currentExpenseClaims = expenseClaims.filter((claim) =>
      expenseClaimInDateRange(claim, comparisonCurrentRange)
    );
    const previousExpenseClaims = expenseClaims.filter((claim) =>
      expenseClaimInDateRange(claim, comparisonPreviousRange)
    );
    const currentPayrollRuns = payrollRuns.filter((run) =>
      payrollRunInDateRange(run, comparisonCurrentRange)
    );
    const previousPayrollRuns = payrollRuns.filter((run) =>
      payrollRunInDateRange(run, comparisonPreviousRange)
    );
    const currentInventoryMovements = inventoryMovements.filter((movement) =>
      inventoryMovementInDateRange(movement, comparisonCurrentRange)
    );
    const previousInventoryMovements = inventoryMovements.filter((movement) =>
      inventoryMovementInDateRange(movement, comparisonPreviousRange)
    );
    const currentActivityLogs = activityLogs.filter((log) =>
      activityLogInDateRange(log, comparisonCurrentRange)
    );
    const previousActivityLogs = activityLogs.filter((log) =>
      activityLogInDateRange(log, comparisonPreviousRange)
    );
    const currentDepreciationEstimate = buildDepreciationScheduleReport(
      fixedAssetRegisterReport.activeRows,
      comparisonCurrentRange.to
    ).periodDepreciationAed;
    const previousDepreciationEstimate = buildDepreciationScheduleReport(
      fixedAssetRegisterReport.activeRows,
      comparisonPreviousRange.to
    ).periodDepreciationAed;
    const currentInvoiceValue = currentInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const previousInvoiceValue = previousInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const revenueInvoiceRows = (rows: InvoiceReportRow[]) =>
      rows.filter((invoice) => !nonRevenueInvoiceStatuses.has(invoice.status));
    const currentRevenueInvoices = revenueInvoiceRows(currentInvoices);
    const previousRevenueInvoices = revenueInvoiceRows(previousInvoices);
    const currentRevenueInvoiceValue = currentRevenueInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const previousRevenueInvoiceValue = previousRevenueInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const openReceivableRows = (rows: InvoiceReportRow[]) =>
      rows.filter(
        (invoice) => !nonRevenueInvoiceStatuses.has(invoice.status) && invoice.status !== "paid"
      );
    const currentOpenReceivableInvoices = openReceivableRows(currentInvoices);
    const previousOpenReceivableInvoices = openReceivableRows(previousInvoices);
    const currentOpenReceivableValue = currentOpenReceivableInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const previousOpenReceivableValue = previousOpenReceivableInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const currentOpenInvoiceValueShare = ratioPercent(
      currentOpenReceivableValue,
      currentRevenueInvoiceValue
    );
    const previousOpenInvoiceValueShare = ratioPercent(
      previousOpenReceivableValue,
      previousRevenueInvoiceValue
    );
    const currentAverageOpenInvoiceValue =
      currentOpenReceivableInvoices.length > 0
        ? Math.round((currentOpenReceivableValue / currentOpenReceivableInvoices.length) * 100) /
          100
        : 0;
    const previousAverageOpenInvoiceValue =
      previousOpenReceivableInvoices.length > 0
        ? Math.round((previousOpenReceivableValue / previousOpenReceivableInvoices.length) * 100) /
          100
        : 0;
    const currentOpenInvoiceShare = ratioPercent(
      currentOpenReceivableInvoices.length,
      currentRevenueInvoices.length
    );
    const previousOpenInvoiceShare = ratioPercent(
      previousOpenReceivableInvoices.length,
      previousRevenueInvoices.length
    );
    const currentDueSoonReceivableInvoices = dueWithinDaysAfterRangeEnd(
      currentOpenReceivableInvoices,
      (invoice) => invoice.dueDate,
      comparisonCurrentRange
    );
    const previousDueSoonReceivableInvoices = dueWithinDaysAfterRangeEnd(
      previousOpenReceivableInvoices,
      (invoice) => invoice.dueDate,
      comparisonPreviousRange
    );
    const currentDueSoonReceivableValue = currentDueSoonReceivableInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const previousDueSoonReceivableValue = previousDueSoonReceivableInvoices.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const currentAverageDueSoonInvoiceValue =
      currentDueSoonReceivableInvoices.length > 0
        ? Math.round(
            (currentDueSoonReceivableValue / currentDueSoonReceivableInvoices.length) * 100
          ) / 100
        : 0;
    const previousAverageDueSoonInvoiceValue =
      previousDueSoonReceivableInvoices.length > 0
        ? Math.round(
            (previousDueSoonReceivableValue / previousDueSoonReceivableInvoices.length) * 100
          ) / 100
        : 0;
    const currentDueSoonInvoiceShare = ratioPercent(
      currentDueSoonReceivableInvoices.length,
      currentOpenReceivableInvoices.length
    );
    const previousDueSoonInvoiceShare = ratioPercent(
      previousDueSoonReceivableInvoices.length,
      previousOpenReceivableInvoices.length
    );
    const isDueByRangeEnd = (invoice: InvoiceReportRow, range: ComparisonRange) => {
      if (!invoice.dueDate) return false;
      const dueDate = new Date(invoice.dueDate);
      if (Number.isNaN(dueDate.getTime())) return false;
      const rangeEnd = new Date(range.to);
      rangeEnd.setHours(23, 59, 59, 999);
      return dueDate <= rangeEnd;
    };
    const overdueReceivableRows = (rows: InvoiceReportRow[], range: ComparisonRange) =>
      rows.filter(
        (invoice) =>
          !nonRevenueInvoiceStatuses.has(invoice.status) &&
          invoice.status !== "paid" &&
          isDueByRangeEnd(invoice, range)
      );
    const currentOverdueReceivables = overdueReceivableRows(
      currentInvoices,
      comparisonCurrentRange
    );
    const previousOverdueReceivables = overdueReceivableRows(
      previousInvoices,
      comparisonPreviousRange
    );
    const currentOverdueReceivableValue = currentOverdueReceivables.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const previousOverdueReceivableValue = previousOverdueReceivables.reduce(
      (sum, invoice) => sum + amountInAed(invoice),
      0
    );
    const currentOverdueInvoiceCount = currentOverdueReceivables.length;
    const previousOverdueInvoiceCount = previousOverdueReceivables.length;
    const currentAverageOverdueInvoiceDays = averageDaysOverdue(
      currentOverdueReceivables,
      (invoice) => invoice.dueDate,
      comparisonCurrentRange
    );
    const previousAverageOverdueInvoiceDays = averageDaysOverdue(
      previousOverdueReceivables,
      (invoice) => invoice.dueDate,
      comparisonPreviousRange
    );
    const currentAverageOverdueInvoiceValue =
      currentOverdueInvoiceCount > 0
        ? Math.round((currentOverdueReceivableValue / currentOverdueInvoiceCount) * 100) / 100
        : 0;
    const previousAverageOverdueInvoiceValue =
      previousOverdueInvoiceCount > 0
        ? Math.round((previousOverdueReceivableValue / previousOverdueInvoiceCount) * 100) / 100
        : 0;
    const currentOverdueReceivableShare = ratioPercent(
      currentOverdueReceivableValue,
      currentOpenReceivableValue
    );
    const previousOverdueReceivableShare = ratioPercent(
      previousOverdueReceivableValue,
      previousOpenReceivableValue
    );
    const currentOverdueInvoiceShare = ratioPercent(
      currentOverdueInvoiceCount,
      currentOpenReceivableInvoices.length
    );
    const previousOverdueInvoiceShare = ratioPercent(
      previousOverdueInvoiceCount,
      previousOpenReceivableInvoices.length
    );
    const paidInvoiceShare = (rows: InvoiceReportRow[]) => {
      const revenueRows = revenueInvoiceRows(rows);
      const total = revenueRows.reduce((sum, invoice) => sum + amountInAed(invoice), 0);
      if (total <= 0.005) return 0;

      const paidTotal = revenueRows
        .filter((invoice) => invoice.status === "paid")
        .reduce((sum, invoice) => sum + amountInAed(invoice), 0);
      return Math.round((paidTotal / total) * 10000) / 100;
    };
    const currentPaidInvoiceShare = paidInvoiceShare(currentInvoices);
    const previousPaidInvoiceShare = paidInvoiceShare(previousInvoices);
    const averageInvoiceValue = (rows: InvoiceReportRow[]) => {
      const revenueRows = revenueInvoiceRows(rows);
      if (revenueRows.length === 0) return 0;

      const total = revenueRows.reduce((sum, invoice) => sum + amountInAed(invoice), 0);
      return Math.round((total / revenueRows.length) * 100) / 100;
    };
    const currentAverageInvoiceValue = averageInvoiceValue(currentInvoices);
    const previousAverageInvoiceValue = averageInvoiceValue(previousInvoices);
    const currentOpenPayableValue = currentVendorBills.reduce(
      (sum, bill) => sum + vendorBillOutstandingAed(bill),
      0
    );
    const previousOpenPayableValue = previousVendorBills.reduce(
      (sum, bill) => sum + vendorBillOutstandingAed(bill),
      0
    );
    const currentOpenCashGap = currentOpenPayableValue - currentOpenReceivableValue;
    const previousOpenCashGap = previousOpenPayableValue - previousOpenReceivableValue;
    const currentOpenCashCoverage = ratioPercent(
      currentOpenReceivableValue,
      currentOpenPayableValue
    );
    const previousOpenCashCoverage = ratioPercent(
      previousOpenReceivableValue,
      previousOpenPayableValue
    );
    const currentOpenWorkloadGap = currentVendorBills.length - currentOpenReceivableInvoices.length;
    const previousOpenWorkloadGap =
      previousVendorBills.length - previousOpenReceivableInvoices.length;
    const currentAverageOpenBillValue =
      currentVendorBills.length > 0
        ? Math.round((currentOpenPayableValue / currentVendorBills.length) * 100) / 100
        : 0;
    const previousAverageOpenBillValue =
      previousVendorBills.length > 0
        ? Math.round((previousOpenPayableValue / previousVendorBills.length) * 100) / 100
        : 0;
    const currentOpenBillShare = ratioPercent(
      currentVendorBills.length,
      currentVendorBillDocuments.length
    );
    const previousOpenBillShare = ratioPercent(
      previousVendorBills.length,
      previousVendorBillDocuments.length
    );
    const currentDueSoonBills = dueWithinDaysAfterRangeEnd(
      currentVendorBills,
      (bill) => bill.due_date,
      comparisonCurrentRange
    );
    const previousDueSoonBills = dueWithinDaysAfterRangeEnd(
      previousVendorBills,
      (bill) => bill.due_date,
      comparisonPreviousRange
    );
    const currentDueSoonBillValue = currentDueSoonBills.reduce(
      (sum, bill) => sum + vendorBillOutstandingAed(bill),
      0
    );
    const previousDueSoonBillValue = previousDueSoonBills.reduce(
      (sum, bill) => sum + vendorBillOutstandingAed(bill),
      0
    );
    const currentAverageDueSoonBillValue =
      currentDueSoonBills.length > 0
        ? Math.round((currentDueSoonBillValue / currentDueSoonBills.length) * 100) / 100
        : 0;
    const previousAverageDueSoonBillValue =
      previousDueSoonBills.length > 0
        ? Math.round((previousDueSoonBillValue / previousDueSoonBills.length) * 100) / 100
        : 0;
    const currentDueSoonBillShare = ratioPercent(
      currentDueSoonBills.length,
      currentVendorBills.length
    );
    const previousDueSoonBillShare = ratioPercent(
      previousDueSoonBills.length,
      previousVendorBills.length
    );
    const currentDueSoonCashGap = currentDueSoonBillValue - currentDueSoonReceivableValue;
    const previousDueSoonCashGap = previousDueSoonBillValue - previousDueSoonReceivableValue;
    const currentDueSoonCashCoverage = ratioPercent(
      currentDueSoonReceivableValue,
      currentDueSoonBillValue
    );
    const previousDueSoonCashCoverage = ratioPercent(
      previousDueSoonReceivableValue,
      previousDueSoonBillValue
    );
    const currentDueSoonWorkloadGap =
      currentDueSoonBills.length - currentDueSoonReceivableInvoices.length;
    const previousDueSoonWorkloadGap =
      previousDueSoonBills.length - previousDueSoonReceivableInvoices.length;
    const isBillDueByRangeEnd = (bill: VendorBillReportRow, range: ComparisonRange) => {
      if (!bill.due_date) return false;
      const dueDate = new Date(bill.due_date);
      if (Number.isNaN(dueDate.getTime())) return false;
      const rangeEnd = new Date(range.to);
      rangeEnd.setHours(23, 59, 59, 999);
      return dueDate <= rangeEnd;
    };
    const overduePayableRows = (rows: VendorBillReportRow[], range: ComparisonRange) =>
      rows.filter((bill) => isBillDueByRangeEnd(bill, range));
    const currentOverduePayables = overduePayableRows(currentVendorBills, comparisonCurrentRange);
    const previousOverduePayables = overduePayableRows(
      previousVendorBills,
      comparisonPreviousRange
    );
    const currentOverduePayableValue = currentOverduePayables.reduce(
      (sum, bill) => sum + vendorBillOutstandingAed(bill),
      0
    );
    const previousOverduePayableValue = previousOverduePayables.reduce(
      (sum, bill) => sum + vendorBillOutstandingAed(bill),
      0
    );
    const currentOverdueCashGap = currentOverduePayableValue - currentOverdueReceivableValue;
    const previousOverdueCashGap = previousOverduePayableValue - previousOverdueReceivableValue;
    const currentOverdueCashCoverage = ratioPercent(
      currentOverdueReceivableValue,
      currentOverduePayableValue
    );
    const previousOverdueCashCoverage = ratioPercent(
      previousOverdueReceivableValue,
      previousOverduePayableValue
    );
    const currentOverdueBillCount = currentOverduePayables.length;
    const previousOverdueBillCount = previousOverduePayables.length;
    const currentOverdueWorkloadGap = currentOverdueBillCount - currentOverdueInvoiceCount;
    const previousOverdueWorkloadGap = previousOverdueBillCount - previousOverdueInvoiceCount;
    const currentAverageOverdueBillDays = averageDaysOverdue(
      currentOverduePayables,
      (bill) => bill.due_date,
      comparisonCurrentRange
    );
    const previousAverageOverdueBillDays = averageDaysOverdue(
      previousOverduePayables,
      (bill) => bill.due_date,
      comparisonPreviousRange
    );
    const currentAverageOverdueBillValue =
      currentOverdueBillCount > 0
        ? Math.round((currentOverduePayableValue / currentOverdueBillCount) * 100) / 100
        : 0;
    const previousAverageOverdueBillValue =
      previousOverdueBillCount > 0
        ? Math.round((previousOverduePayableValue / previousOverdueBillCount) * 100) / 100
        : 0;
    const currentOverdueBillShare = ratioPercent(
      currentOverdueBillCount,
      currentVendorBills.length
    );
    const previousOverdueBillShare = ratioPercent(
      previousOverdueBillCount,
      previousVendorBills.length
    );
    const currentOverduePayableShare = ratioPercent(
      currentOverduePayableValue,
      currentOpenPayableValue
    );
    const previousOverduePayableShare = ratioPercent(
      previousOverduePayableValue,
      previousOpenPayableValue
    );
    const currentWorkingCapitalProxy = currentOpenReceivableValue - currentOpenPayableValue;
    const previousWorkingCapitalProxy = previousOpenReceivableValue - previousOpenPayableValue;
    const currentVendorBillValue = currentVendorBillDocuments.reduce(
      (sum, bill) => sum + vendorBillTotalAed(bill),
      0
    );
    const previousVendorBillValue = previousVendorBillDocuments.reduce(
      (sum, bill) => sum + vendorBillTotalAed(bill),
      0
    );
    const currentAverageVendorBillValue =
      currentVendorBillDocuments.length > 0
        ? Math.round((currentVendorBillValue / currentVendorBillDocuments.length) * 100) / 100
        : 0;
    const previousAverageVendorBillValue =
      previousVendorBillDocuments.length > 0
        ? Math.round((previousVendorBillValue / previousVendorBillDocuments.length) * 100) / 100
        : 0;
    const currentPaidVendorBillValue = currentVendorBillDocuments.reduce(
      (sum, bill) => sum + vendorBillPaidAed(bill),
      0
    );
    const previousPaidVendorBillValue = previousVendorBillDocuments.reduce(
      (sum, bill) => sum + vendorBillPaidAed(bill),
      0
    );
    const currentPaidVendorBillShare = ratioPercent(
      currentPaidVendorBillValue,
      currentVendorBillValue
    );
    const previousPaidVendorBillShare = ratioPercent(
      previousPaidVendorBillValue,
      previousVendorBillValue
    );
    const currentOpenBillValueShare = ratioPercent(currentOpenPayableValue, currentVendorBillValue);
    const previousOpenBillValueShare = ratioPercent(
      previousOpenPayableValue,
      previousVendorBillValue
    );
    const topVendorShare = (rows: VendorBillReportRow[]) => {
      const total = rows.reduce((sum, bill) => sum + vendorBillTotalAed(bill), 0);
      if (total <= 0.005) return 0;

      const byVendor = new Map<string, number>();
      for (const bill of rows) {
        const vendorName = bill.vendor_name || tr("unknownVendor");
        byVendor.set(vendorName, (byVendor.get(vendorName) ?? 0) + vendorBillTotalAed(bill));
      }

      const topVendorSpend = Math.max(0, ...Array.from(byVendor.values()));
      return Math.round((topVendorSpend / total) * 10000) / 100;
    };
    const currentTopVendorShare = topVendorShare(currentVendorBillDocuments);
    const previousTopVendorShare = topVendorShare(previousVendorBillDocuments);
    const currentComparisonDays = inclusiveDayCount(
      comparisonCurrentRange.from,
      comparisonCurrentRange.to
    );
    const previousComparisonDays = inclusiveDayCount(
      comparisonPreviousRange.from,
      comparisonPreviousRange.to
    );
    const currentCollectionDays =
      currentInvoiceValue > 0.005
        ? Math.round(
            (currentOpenReceivableValue / currentInvoiceValue) * currentComparisonDays * 10
          ) / 10
        : 0;
    const previousCollectionDays =
      previousInvoiceValue > 0.005
        ? Math.round(
            (previousOpenReceivableValue / previousInvoiceValue) * previousComparisonDays * 10
          ) / 10
        : 0;
    const currentPayableDays =
      currentVendorBillValue > 0.005
        ? Math.round(
            (currentOpenPayableValue / currentVendorBillValue) * currentComparisonDays * 10
          ) / 10
        : 0;
    const previousPayableDays =
      previousVendorBillValue > 0.005
        ? Math.round(
            (previousOpenPayableValue / previousVendorBillValue) * previousComparisonDays * 10
          ) / 10
        : 0;
    const currentCashConversionGap =
      Math.round((currentCollectionDays - currentPayableDays) * 10) / 10;
    const previousCashConversionGap =
      Math.round((previousCollectionDays - previousPayableDays) * 10) / 10;
    const topCustomerShare = (rows: InvoiceReportRow[]) => {
      const revenueRows = rows.filter((invoice) => !nonRevenueInvoiceStatuses.has(invoice.status));
      const total = revenueRows.reduce((sum, invoice) => sum + amountInAed(invoice), 0);
      if (total <= 0.005) return 0;

      const byCustomer = new Map<string, number>();
      for (const invoice of revenueRows) {
        const customerName = invoice.customerName || tr("unknownCustomer");
        byCustomer.set(customerName, (byCustomer.get(customerName) ?? 0) + amountInAed(invoice));
      }

      const topCustomerRevenue = Math.max(0, ...Array.from(byCustomer.values()));
      return Math.round((topCustomerRevenue / total) * 10000) / 100;
    };
    const currentTopCustomerShare = topCustomerShare(currentInvoices);
    const previousTopCustomerShare = topCustomerShare(previousInvoices);
    const currentExpenseValue = currentReceipts.reduce(
      (sum, receipt) => sum + receiptSubtotalAed(receipt) + receiptVatAed(receipt),
      0
    );
    const previousExpenseValue = previousReceipts.reduce(
      (sum, receipt) => sum + receiptSubtotalAed(receipt) + receiptVatAed(receipt),
      0
    );
    const currentAverageReceiptValue =
      currentReceipts.length > 0
        ? Math.round((currentExpenseValue / currentReceipts.length) * 100) / 100
        : 0;
    const previousAverageReceiptValue =
      previousReceipts.length > 0
        ? Math.round((previousExpenseValue / previousReceipts.length) * 100) / 100
        : 0;
    const expenseClaimReviewRows = (rows: ExpenseClaimReportRow[]) =>
      rows.filter((claim) => claim.status === "submitted" || claim.status === "approved");
    const submittedExpenseClaimRows = (rows: ExpenseClaimReportRow[]) =>
      rows.filter((claim) => claim.status === "submitted");
    const approvedExpenseClaimRows = (rows: ExpenseClaimReportRow[]) =>
      rows.filter((claim) => claim.status === "approved");
    const expenseClaimReviewValue = (rows: ExpenseClaimReportRow[]) =>
      expenseClaimReviewRows(rows).reduce((sum, claim) => sum + expenseClaimAmount(claim), 0);
    const submittedExpenseClaimValue = (rows: ExpenseClaimReportRow[]) =>
      submittedExpenseClaimRows(rows).reduce((sum, claim) => sum + expenseClaimAmount(claim), 0);
    const approvedExpenseClaimValue = (rows: ExpenseClaimReportRow[]) =>
      approvedExpenseClaimRows(rows).reduce((sum, claim) => sum + expenseClaimAmount(claim), 0);
    const currentExpenseClaimReviewValue = expenseClaimReviewValue(currentExpenseClaims);
    const previousExpenseClaimReviewValue = expenseClaimReviewValue(previousExpenseClaims);
    const currentSubmittedExpenseClaimValue = submittedExpenseClaimValue(currentExpenseClaims);
    const previousSubmittedExpenseClaimValue = submittedExpenseClaimValue(previousExpenseClaims);
    const currentApprovedExpenseClaimValue = approvedExpenseClaimValue(currentExpenseClaims);
    const previousApprovedExpenseClaimValue = approvedExpenseClaimValue(previousExpenseClaims);
    const currentExpenseClaimReviewCount = expenseClaimReviewRows(currentExpenseClaims).length;
    const previousExpenseClaimReviewCount = expenseClaimReviewRows(previousExpenseClaims).length;
    const currentSubmittedExpenseClaimCount =
      submittedExpenseClaimRows(currentExpenseClaims).length;
    const previousSubmittedExpenseClaimCount =
      submittedExpenseClaimRows(previousExpenseClaims).length;
    const currentApprovedExpenseClaimCount = approvedExpenseClaimRows(currentExpenseClaims).length;
    const previousApprovedExpenseClaimCount =
      approvedExpenseClaimRows(previousExpenseClaims).length;
    const receiptTotalAed = (receipt: ReceiptReportRow) =>
      receiptSubtotalAed(receipt) + receiptVatAed(receipt);
    const unpostedReceiptRows = (rows: ReceiptReportRow[]) =>
      rows.filter((receipt) => !receipt.posted);
    const unpostedReceiptValue = (rows: ReceiptReportRow[]) =>
      unpostedReceiptRows(rows).reduce((sum, receipt) => sum + receiptTotalAed(receipt), 0);
    const currentUnpostedReceiptValue = unpostedReceiptValue(currentReceipts);
    const previousUnpostedReceiptValue = unpostedReceiptValue(previousReceipts);
    const unpostedExpenseShare = (rows: ReceiptReportRow[]) => {
      const total = rows.reduce((sum, receipt) => sum + receiptTotalAed(receipt), 0);
      if (total <= 0.005) return 0;

      const unpostedTotal = unpostedReceiptValue(rows);
      return Math.round((unpostedTotal / total) * 10000) / 100;
    };
    const currentUnpostedExpenseShare = unpostedExpenseShare(currentReceipts);
    const previousUnpostedExpenseShare = unpostedExpenseShare(previousReceipts);
    const currentUnpostedReceiptCount = unpostedReceiptRows(currentReceipts).length;
    const previousUnpostedReceiptCount = unpostedReceiptRows(previousReceipts).length;
    const autoPostedReceiptRows = (rows: ReceiptReportRow[]) =>
      rows.filter((receipt) => receipt.autoPosted);
    const autoPostedReceiptValue = (rows: ReceiptReportRow[]) =>
      autoPostedReceiptRows(rows).reduce((sum, receipt) => sum + receiptTotalAed(receipt), 0);
    const currentAutoPostedReceiptCount = autoPostedReceiptRows(currentReceipts).length;
    const previousAutoPostedReceiptCount = autoPostedReceiptRows(previousReceipts).length;
    const currentAutoPostedReceiptValue = autoPostedReceiptValue(currentReceipts);
    const previousAutoPostedReceiptValue = autoPostedReceiptValue(previousReceipts);
    const receiptAutomationCoverage = (rows: ReceiptReportRow[]) => {
      if (rows.length === 0) return 0;

      return Math.round((autoPostedReceiptRows(rows).length / rows.length) * 10000) / 100;
    };
    const currentReceiptAutomationCoverage = receiptAutomationCoverage(currentReceipts);
    const previousReceiptAutomationCoverage = receiptAutomationCoverage(previousReceipts);
    const receiptAutomationValueCoverage = (rows: ReceiptReportRow[]) => {
      const total = rows.reduce((sum, receipt) => sum + receiptTotalAed(receipt), 0);
      if (total <= 0.005) return 0;

      return Math.round((autoPostedReceiptValue(rows) / total) * 10000) / 100;
    };
    const currentReceiptAutomationValueCoverage = receiptAutomationValueCoverage(currentReceipts);
    const previousReceiptAutomationValueCoverage = receiptAutomationValueCoverage(previousReceipts);
    const bankReconciliationCoverage = (rows: BankTransactionReportRow[]) => {
      if (rows.length === 0) return 0;

      const reconciledRows = rows.filter((transaction) => transaction.isReconciled).length;
      return Math.round((reconciledRows / rows.length) * 10000) / 100;
    };
    const currentBankReconciliationCoverage = bankReconciliationCoverage(currentBankTransactions);
    const previousBankReconciliationCoverage = bankReconciliationCoverage(previousBankTransactions);
    const bankTransactionReviewValue = (transaction: BankTransactionReportRow) =>
      Math.abs(Number(transaction.amount) || 0);
    const reconciledBankTransactionRows = (rows: BankTransactionReportRow[]) =>
      rows.filter((transaction) => transaction.isReconciled);
    const currentReconciledBankCount =
      reconciledBankTransactionRows(currentBankTransactions).length;
    const previousReconciledBankCount =
      reconciledBankTransactionRows(previousBankTransactions).length;
    const currentReconciledBankValue = reconciledBankTransactionRows(
      currentBankTransactions
    ).reduce((sum, transaction) => sum + bankTransactionReviewValue(transaction), 0);
    const previousReconciledBankValue = reconciledBankTransactionRows(
      previousBankTransactions
    ).reduce((sum, transaction) => sum + bankTransactionReviewValue(transaction), 0);
    const currentUnreconciledBankCount = currentBankTransactions.filter(
      (transaction) => !transaction.isReconciled
    ).length;
    const previousUnreconciledBankCount = previousBankTransactions.filter(
      (transaction) => !transaction.isReconciled
    ).length;
    const currentUnreconciledBankValue = currentBankTransactions
      .filter((transaction) => !transaction.isReconciled)
      .reduce((sum, transaction) => sum + bankTransactionReviewValue(transaction), 0);
    const previousUnreconciledBankValue = previousBankTransactions
      .filter((transaction) => !transaction.isReconciled)
      .reduce((sum, transaction) => sum + bankTransactionReviewValue(transaction), 0);
    const bankSuggestedMatchRows = (rows: BankTransactionReportRow[]) =>
      rows.filter(
        (transaction) => !transaction.isReconciled && transaction.matchStatus === "suggested"
      );
    const currentSuggestedBankMatchCount = bankSuggestedMatchRows(currentBankTransactions).length;
    const previousSuggestedBankMatchCount = bankSuggestedMatchRows(previousBankTransactions).length;
    const currentSuggestedBankMatchValue = bankSuggestedMatchRows(currentBankTransactions).reduce(
      (sum, transaction) => sum + bankTransactionReviewValue(transaction),
      0
    );
    const previousSuggestedBankMatchValue = bankSuggestedMatchRows(previousBankTransactions).reduce(
      (sum, transaction) => sum + bankTransactionReviewValue(transaction),
      0
    );
    const currentBankMatchSuggestionCoverage = ratioPercent(
      currentSuggestedBankMatchCount,
      currentUnreconciledBankCount
    );
    const previousBankMatchSuggestionCoverage = ratioPercent(
      previousSuggestedBankMatchCount,
      previousUnreconciledBankCount
    );
    const currentBankMatchSuggestionValueCoverage = ratioPercent(
      currentSuggestedBankMatchValue,
      currentUnreconciledBankValue
    );
    const previousBankMatchSuggestionValueCoverage = ratioPercent(
      previousSuggestedBankMatchValue,
      previousUnreconciledBankValue
    );
    const bankAssistedTransactionRows = (rows: BankTransactionReportRow[]) =>
      rows.filter(
        (transaction) =>
          transaction.isReconciled ||
          (!transaction.isReconciled && transaction.matchStatus === "suggested")
      );
    const bankAssistedTransactionValue = (rows: BankTransactionReportRow[]) =>
      bankAssistedTransactionRows(rows).reduce(
        (sum, transaction) => sum + bankTransactionReviewValue(transaction),
        0
      );
    const currentBankAssistedTransactionCount =
      bankAssistedTransactionRows(currentBankTransactions).length;
    const previousBankAssistedTransactionCount =
      bankAssistedTransactionRows(previousBankTransactions).length;
    const currentBankAssistedTransactionValue =
      bankAssistedTransactionValue(currentBankTransactions);
    const previousBankAssistedTransactionValue =
      bankAssistedTransactionValue(previousBankTransactions);
    const bankAssistedTransactionCoverage = (rows: BankTransactionReportRow[]) => {
      if (rows.length === 0) return null;

      return ratioPercent(bankAssistedTransactionRows(rows).length, rows.length);
    };
    const currentBankAssistedTransactionCoverage =
      bankAssistedTransactionCoverage(currentBankTransactions);
    const previousBankAssistedTransactionCoverage =
      bankAssistedTransactionCoverage(previousBankTransactions);
    const bankAssistedTransactionValueCoverage = (rows: BankTransactionReportRow[]) => {
      const total = rows.reduce(
        (sum, transaction) => sum + bankTransactionReviewValue(transaction),
        0
      );
      if (total <= 0.005) return null;

      return ratioPercent(bankAssistedTransactionValue(rows), total);
    };
    const currentBankAssistedTransactionValueCoverage =
      bankAssistedTransactionValueCoverage(currentBankTransactions);
    const previousBankAssistedTransactionValueCoverage =
      bankAssistedTransactionValueCoverage(previousBankTransactions);
    const currentAutomationWorkQueueCount =
      currentOverdueInvoiceCount +
      currentDueSoonReceivableInvoices.length +
      currentOverdueBillCount +
      currentDueSoonBills.length +
      currentUnpostedReceiptCount +
      currentExpenseClaimReviewCount +
      currentSuggestedBankMatchCount;
    const previousAutomationWorkQueueCount =
      previousOverdueInvoiceCount +
      previousDueSoonReceivableInvoices.length +
      previousOverdueBillCount +
      previousDueSoonBills.length +
      previousUnpostedReceiptCount +
      previousExpenseClaimReviewCount +
      previousSuggestedBankMatchCount;
    const currentAutomationWorkQueueValue =
      currentOverdueReceivableValue +
      currentDueSoonReceivableValue +
      currentOverduePayableValue +
      currentDueSoonBillValue +
      currentUnpostedReceiptValue +
      currentExpenseClaimReviewValue +
      currentSuggestedBankMatchValue;
    const previousAutomationWorkQueueValue =
      previousOverdueReceivableValue +
      previousDueSoonReceivableValue +
      previousOverduePayableValue +
      previousDueSoonBillValue +
      previousUnpostedReceiptValue +
      previousExpenseClaimReviewValue +
      previousSuggestedBankMatchValue;
    const currentPayrollValue = currentPayrollRuns.reduce(
      (sum, run) => sum + payrollAmount(run.total_net),
      0
    );
    const previousPayrollValue = previousPayrollRuns.reduce(
      (sum, run) => sum + payrollAmount(run.total_net),
      0
    );
    const payrollGrossValue = (rows: PayrollRunReportRow[]) =>
      rows.reduce(
        (sum, run) => sum + payrollAmount(run.total_basic) + payrollAmount(run.total_allowances),
        0
      );
    const payrollDeductionValue = (rows: PayrollRunReportRow[]) =>
      rows.reduce((sum, run) => sum + payrollAmount(run.total_deductions), 0);
    const currentPayrollGrossValue = payrollGrossValue(currentPayrollRuns);
    const previousPayrollGrossValue = payrollGrossValue(previousPayrollRuns);
    const currentPayrollDeductionValue = payrollDeductionValue(currentPayrollRuns);
    const previousPayrollDeductionValue = payrollDeductionValue(previousPayrollRuns);
    const currentPayrollDeductionShare = ratioPercent(
      currentPayrollDeductionValue,
      currentPayrollGrossValue
    );
    const previousPayrollDeductionShare = ratioPercent(
      previousPayrollDeductionValue,
      previousPayrollGrossValue
    );
    const currentAveragePayrollRunValue =
      currentPayrollRuns.length > 0
        ? Math.round((currentPayrollValue / currentPayrollRuns.length) * 100) / 100
        : 0;
    const previousAveragePayrollRunValue =
      previousPayrollRuns.length > 0
        ? Math.round((previousPayrollValue / previousPayrollRuns.length) * 100) / 100
        : 0;
    const currentPayrollCoveredEmployees = currentPayrollRuns.reduce(
      (sum, run) => sum + Number(run.employee_count ?? 0),
      0
    );
    const previousPayrollCoveredEmployees = previousPayrollRuns.reduce(
      (sum, run) => sum + Number(run.employee_count ?? 0),
      0
    );
    const currentPayrollCostPerCoveredEmployee =
      currentPayrollCoveredEmployees > 0
        ? Math.round((currentPayrollValue / currentPayrollCoveredEmployees) * 100) / 100
        : 0;
    const previousPayrollCostPerCoveredEmployee =
      previousPayrollCoveredEmployees > 0
        ? Math.round((previousPayrollValue / previousPayrollCoveredEmployees) * 100) / 100
        : 0;
    const payrollApprovalQueueRows = (rows: PayrollRunReportRow[]) =>
      rows.filter((run) => run.status === "calculated");
    const payrollApprovalQueueCount = (rows: PayrollRunReportRow[]) =>
      payrollApprovalQueueRows(rows).length;
    const payrollApprovalQueueValue = (rows: PayrollRunReportRow[]) =>
      payrollApprovalQueueRows(rows).reduce((sum, run) => sum + payrollAmount(run.total_net), 0);
    const wpsMissingRunRows = (rows: PayrollRunReportRow[]) =>
      rows.filter(
        (run) => (run.status === "calculated" || run.status === "approved") && !run.sif_file_content
      );
    const wpsMissingRunCount = (rows: PayrollRunReportRow[]) => wpsMissingRunRows(rows).length;
    const wpsMissingRunValue = (rows: PayrollRunReportRow[]) =>
      wpsMissingRunRows(rows).reduce((sum, run) => sum + payrollAmount(run.total_net), 0);
    const currentPayrollApprovalQueueCount = payrollApprovalQueueCount(currentPayrollRuns);
    const previousPayrollApprovalQueueCount = payrollApprovalQueueCount(previousPayrollRuns);
    const currentPayrollApprovalQueueValue = payrollApprovalQueueValue(currentPayrollRuns);
    const previousPayrollApprovalQueueValue = payrollApprovalQueueValue(previousPayrollRuns);
    const currentWpsMissingRunCount = wpsMissingRunCount(currentPayrollRuns);
    const previousWpsMissingRunCount = wpsMissingRunCount(previousPayrollRuns);
    const currentWpsMissingRunValue = wpsMissingRunValue(currentPayrollRuns);
    const previousWpsMissingRunValue = wpsMissingRunValue(previousPayrollRuns);
    const currentPayrollReadinessQueueCount =
      currentPayrollApprovalQueueCount + currentWpsMissingRunCount;
    const previousPayrollReadinessQueueCount =
      previousPayrollApprovalQueueCount + previousWpsMissingRunCount;
    const currentPayrollReadinessQueueValue =
      currentPayrollApprovalQueueValue + currentWpsMissingRunValue;
    const previousPayrollReadinessQueueValue =
      previousPayrollApprovalQueueValue + previousWpsMissingRunValue;
    const wpsReadyShare = (rows: PayrollRunReportRow[]) => {
      const eligibleRuns = rows.filter(
        (run) => run.status === "calculated" || run.status === "approved"
      );
      if (eligibleRuns.length === 0) return 0;

      const readyRuns = eligibleRuns.filter((run) => Boolean(run.sif_file_content)).length;
      return Math.round((readyRuns / eligibleRuns.length) * 10000) / 100;
    };
    const currentWpsReadyShare = wpsReadyShare(currentPayrollRuns);
    const previousWpsReadyShare = wpsReadyShare(previousPayrollRuns);
    const currentInventoryMovementValue = currentInventoryMovements.reduce(
      (sum, movement) => sum + inventoryMovementValue(movement),
      0
    );
    const previousInventoryMovementValue = previousInventoryMovements.reduce(
      (sum, movement) => sum + inventoryMovementValue(movement),
      0
    );
    const ledgerActivityBreakdownForRange = (range: ComparisonRange) => {
      const postedEntries = journalEntries.filter(
        (entry) => entry.status === "posted" && valueInDateRange(entry.date, range)
      );
      return postedEntries.reduce(
        (summary, entry) => {
          const entryActivity = (entry.lines ?? []).reduce(
            (lineSum, line) =>
              lineSum + Math.max(Number(line.debit) || 0, Number(line.credit) || 0),
            0
          );
          summary.totalActivity += entryActivity;
          if (!entry.source || entry.source === "manual") {
            summary.manualActivity += entryActivity;
          }
          return summary;
        },
        { totalActivity: 0, manualActivity: 0 }
      );
    };
    const currentLedgerActivityBreakdown = ledgerActivityBreakdownForRange(comparisonCurrentRange);
    const previousLedgerActivityBreakdown =
      ledgerActivityBreakdownForRange(comparisonPreviousRange);
    const currentLedgerActivity = currentLedgerActivityBreakdown.totalActivity;
    const previousLedgerActivity = previousLedgerActivityBreakdown.totalActivity;
    const currentManualLedgerShare = ratioPercent(
      currentLedgerActivityBreakdown.manualActivity,
      currentLedgerActivityBreakdown.totalActivity
    );
    const previousManualLedgerShare = ratioPercent(
      previousLedgerActivityBreakdown.manualActivity,
      previousLedgerActivityBreakdown.totalActivity
    );
    const currentManualLedgerActivity = currentLedgerActivityBreakdown.manualActivity;
    const previousManualLedgerActivity = previousLedgerActivityBreakdown.manualActivity;
    const automatedLedgerActivity = (summary: { totalActivity: number; manualActivity: number }) =>
      Math.max(0, summary.totalActivity - summary.manualActivity);
    const currentAutomatedLedgerActivity = automatedLedgerActivity(currentLedgerActivityBreakdown);
    const previousAutomatedLedgerActivity = automatedLedgerActivity(
      previousLedgerActivityBreakdown
    );
    const currentHighRiskActivityCount = currentActivityLogs.filter(
      (log) => activityLogRiskLevel(log) === "High"
    ).length;
    const previousHighRiskActivityCount = previousActivityLogs.filter(
      (log) => activityLogRiskLevel(log) === "High"
    ).length;
    const currentHighRiskActivityShare = ratioPercent(
      currentHighRiskActivityCount,
      currentActivityLogs.length
    );
    const previousHighRiskActivityShare = ratioPercent(
      previousHighRiskActivityCount,
      previousActivityLogs.length
    );
    const currentReviewActivityCount = currentActivityLogs.filter(
      (log) => activityLogRiskLevel(log) !== "Low"
    ).length;
    const previousReviewActivityCount = previousActivityLogs.filter(
      (log) => activityLogRiskLevel(log) !== "Low"
    ).length;
    const currentReviewActivityShare = ratioPercent(
      currentReviewActivityCount,
      currentActivityLogs.length
    );
    const previousReviewActivityShare = ratioPercent(
      previousReviewActivityCount,
      previousActivityLogs.length
    );
    const currentFxUnrealizedExposure =
      Math.abs(fxGainsLosses?.totalUnrealizedGain ?? 0) +
      Math.abs(fxGainsLosses?.totalUnrealizedLoss ?? 0);
    const currentLedgerAutomationCoverage =
      currentLedgerActivityBreakdown.totalActivity > 0.005 ? 100 - currentManualLedgerShare : null;
    const previousLedgerAutomationCoverage =
      previousLedgerActivityBreakdown.totalActivity > 0.005
        ? 100 - previousManualLedgerShare
        : null;
    const currentLedgerAutomationShare = currentLedgerAutomationCoverage ?? 0;
    const previousLedgerAutomationShare = previousLedgerAutomationCoverage ?? 0;
    const currentAutomationAdoptionIndex = averageAvailablePercent([
      currentReceipts.length > 0 ? currentReceiptAutomationCoverage : null,
      currentBankAssistedTransactionCoverage,
      currentLedgerAutomationCoverage,
    ]);
    const previousAutomationAdoptionIndex = averageAvailablePercent([
      previousReceipts.length > 0 ? previousReceiptAutomationCoverage : null,
      previousBankAssistedTransactionCoverage,
      previousLedgerAutomationCoverage,
    ]);
    const currentAutomationValueAdoptionIndex = averageAvailablePercent([
      currentExpenseValue > 0.005 ? currentReceiptAutomationValueCoverage : null,
      currentBankAssistedTransactionValueCoverage,
      currentLedgerAutomationCoverage,
    ]);
    const previousAutomationValueAdoptionIndex = averageAvailablePercent([
      previousExpenseValue > 0.005 ? previousReceiptAutomationValueCoverage : null,
      previousBankAssistedTransactionValueCoverage,
      previousLedgerAutomationCoverage,
    ]);
    const currentBurnRate = normalizeMonthlyBurn(
      comparisonCurrentProfitLoss?.totalRevenue ?? 0,
      comparisonCurrentProfitLoss?.totalExpenses ?? 0,
      currentComparisonDays
    );
    const previousBurnRate = normalizeMonthlyBurn(
      comparisonPreviousProfitLoss?.totalRevenue ?? 0,
      comparisonPreviousProfitLoss?.totalExpenses ?? 0,
      previousComparisonDays
    );
    const currentRunwayDays = runwayCoverageDays(
      cashFlowForecast?.currentBalance ?? 0,
      currentBurnRate
    );
    const previousRunwayDays = runwayCoverageDays(
      cashFlowForecast?.currentBalance ?? 0,
      previousBurnRate
    );
    const cashForecastProjections = cashFlowForecast?.projections ?? [];
    const lowestForecastBalance = cashForecastProjections.length
      ? Math.min(...cashForecastProjections.map((projection) => projection.projectedBalance))
      : (cashFlowForecast?.currentBalance ?? 0);
    const currentProjectedCashShortfall = Math.max(0, -lowestForecastBalance);
    const currentCashRiskWeekCount = cashForecastProjections.filter(
      (projection) => projection.projectedBalance < 0
    ).length;
    const currentNetMargin = ratioPercent(
      comparisonCurrentProfitLoss?.netProfit ?? 0,
      comparisonCurrentProfitLoss?.totalRevenue ?? 0
    );
    const previousNetMargin = ratioPercent(
      comparisonPreviousProfitLoss?.netProfit ?? 0,
      comparisonPreviousProfitLoss?.totalRevenue ?? 0
    );
    const currentExpenseRatio = ratioPercent(
      comparisonCurrentProfitLoss?.totalExpenses ?? 0,
      comparisonCurrentProfitLoss?.totalRevenue ?? 0
    );
    const previousExpenseRatio = ratioPercent(
      comparisonPreviousProfitLoss?.totalExpenses ?? 0,
      comparisonPreviousProfitLoss?.totalRevenue ?? 0
    );
    const currentRevenueExpenseCoverage = ratioPercent(
      comparisonCurrentProfitLoss?.totalRevenue ?? 0,
      comparisonCurrentProfitLoss?.totalExpenses ?? 0
    );
    const previousRevenueExpenseCoverage = ratioPercent(
      comparisonPreviousProfitLoss?.totalRevenue ?? 0,
      comparisonPreviousProfitLoss?.totalExpenses ?? 0
    );
    const currentConsolidatedMargin = ratioPercent(
      consolidatedStatementsReport.currentComparisonNetProfit,
      consolidatedStatementsReport.currentComparisonRevenue
    );
    const previousConsolidatedMargin = ratioPercent(
      consolidatedStatementsReport.previousNetProfit,
      consolidatedStatementsReport.previousRevenue
    );
    const currentBreakEvenGap = Math.max(
      0,
      (comparisonCurrentProfitLoss?.totalExpenses ?? 0) -
        (comparisonCurrentProfitLoss?.totalRevenue ?? 0)
    );
    const previousBreakEvenGap = Math.max(
      0,
      (comparisonPreviousProfitLoss?.totalExpenses ?? 0) -
        (comparisonPreviousProfitLoss?.totalRevenue ?? 0)
    );
    const currentPayrollExpenseShare = ratioPercent(
      currentPayrollValue,
      comparisonCurrentProfitLoss?.totalExpenses ?? 0
    );
    const previousPayrollExpenseShare = ratioPercent(
      previousPayrollValue,
      comparisonPreviousProfitLoss?.totalExpenses ?? 0
    );
    const operatingCashFlowForRow = (row: CashFlowStatementRow | undefined) =>
      (row?.operatingInflow ?? 0) - (row?.operatingOutflow ?? 0);
    const currentOperatingCashFlow = operatingCashFlowForRow(cashFlowStatement.at(-1));
    const previousOperatingCashFlow = operatingCashFlowForRow(cashFlowStatement.at(-2));
    const currentLiabilityAssetRatio = ratioPercent(
      comparisonCurrentBalanceSheet?.totalLiabilities ?? 0,
      comparisonCurrentBalanceSheet?.totalAssets ?? 0
    );
    const previousLiabilityAssetRatio = ratioPercent(
      comparisonPreviousBalanceSheet?.totalLiabilities ?? 0,
      comparisonPreviousBalanceSheet?.totalAssets ?? 0
    );
    const currentDebtEquityRatio = ratioPercent(
      comparisonCurrentBalanceSheet?.totalLiabilities ?? 0,
      comparisonCurrentBalanceSheet?.totalEquity ?? 0
    );
    const previousDebtEquityRatio = ratioPercent(
      comparisonPreviousBalanceSheet?.totalLiabilities ?? 0,
      comparisonPreviousBalanceSheet?.totalEquity ?? 0
    );
    const budgetComparisonLines = varianceReport?.varianceLines ?? [];
    const currentBudgetActualValue = budgetComparisonLines.reduce(
      (sum, line) => sum + line.totals.actual,
      0
    );
    const currentBudgetBaselineValue = budgetComparisonLines.reduce(
      (sum, line) => sum + line.totals.budget,
      0
    );
    const currentTotalTaxExposure =
      (comparisonCurrentVat?.netVATPayable ?? 0) + (corporateTaxEstimate?.taxPayable ?? 0);
    const previousTotalTaxExposure =
      (comparisonPreviousVat?.netVATPayable ?? 0) +
      (comparisonPreviousCorporateTaxEstimate?.taxPayable ?? 0);
    const currentTaxExposureRate = ratioPercent(
      currentTotalTaxExposure,
      comparisonCurrentProfitLoss?.totalRevenue ?? 0
    );
    const previousTaxExposureRate = ratioPercent(
      previousTotalTaxExposure,
      comparisonPreviousProfitLoss?.totalRevenue ?? 0
    );
    const currentAvailableTaxCash = Math.max(0, cashFlowForecast?.currentBalance ?? 0);
    const currentTaxReserveNeed = Math.max(0, currentTotalTaxExposure);
    const currentTaxReserveCoverage =
      currentTaxReserveNeed > 0.005
        ? ratioPercent(
            Math.min(currentAvailableTaxCash, currentTaxReserveNeed),
            currentTaxReserveNeed
          )
        : 100;
    const currentTaxFundingGap = Math.max(0, currentTaxReserveNeed - currentAvailableTaxCash);
    const currentTaxAdjustedRunwayDays = runwayCoverageDays(
      Math.max(0, currentAvailableTaxCash - currentTaxReserveNeed),
      currentBurnRate
    );
    const monthEndChecklistItems = monthEndCloseStatus?.checklist ?? [];
    const currentMonthEndOpenChecks = monthEndChecklistItems.filter(
      (item) => item.status !== "complete"
    ).length;
    const currentMonthEndReadiness = monthEndChecklistItems.length
      ? ratioPercent(
          monthEndChecklistItems.length - currentMonthEndOpenChecks,
          monthEndChecklistItems.length
        )
      : 100;

    return [
      makeComparisonMetric({
        id: "revenue",
        label: tr("revenue"),
        current: comparisonCurrentProfitLoss?.totalRevenue ?? 0,
        previous: comparisonPreviousProfitLoss?.totalRevenue ?? 0,
        currency: "AED",
        signal: tr("growth"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "pl",
      }),
      makeComparisonMetric({
        id: "net-profit",
        label: tr("netProfit"),
        current: comparisonCurrentProfitLoss?.netProfit ?? 0,
        previous: comparisonPreviousProfitLoss?.netProfit ?? 0,
        currency: "AED",
        signal: tr("profitability"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "pl",
      }),
      makeComparisonMetric({
        id: "net-margin",
        label: tr("netMargin"),
        current: currentNetMargin,
        previous: previousNetMargin,
        currency: "%",
        signal: tr("profitEfficiency"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "pl",
      }),
      makeComparisonMetric({
        id: "expense-ratio",
        label: tr("expenseRatio"),
        current: currentExpenseRatio,
        previous: previousExpenseRatio,
        currency: "%",
        signal: tr("costEfficiency"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "pl",
      }),
      makeComparisonMetric({
        id: "revenue-expense-coverage",
        label: tr("revenueExpenseCoverage"),
        current: currentRevenueExpenseCoverage,
        previous: previousRevenueExpenseCoverage,
        currency: "%",
        signal: tr("revenueCoversExpenses"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "pl",
      }),
      makeComparisonMetric({
        id: "break-even-gap",
        label: tr("breakEvenGap"),
        current: currentBreakEvenGap,
        previous: previousBreakEvenGap,
        currency: "AED",
        signal: tr("breakEvenShortfall"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "pl",
      }),
      makeComparisonMetric({
        id: "invoice-value",
        label: tr("invoiceValue"),
        current: currentInvoiceValue,
        previous: previousInvoiceValue,
        currency: "AED",
        signal: tr("salesActivity"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "sales",
      }),
      makeComparisonMetric({
        id: "invoice-count",
        label: tr("invoiceCount"),
        current: currentInvoices.length,
        previous: previousInvoices.length,
        currency: "count",
        signal: tr("invoiceVolume"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "sales",
      }),
      makeComparisonMetric({
        id: "paid-invoice-share",
        label: tr("paidInvoiceShare"),
        current: currentPaidInvoiceShare,
        previous: previousPaidInvoiceShare,
        currency: "%",
        signal: tr("collectionsEffectiveness"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "sales",
      }),
      makeComparisonMetric({
        id: "average-invoice-value",
        label: tr("averageInvoiceValue"),
        current: currentAverageInvoiceValue,
        previous: previousAverageInvoiceValue,
        currency: "AED",
        signal: tr("dealSize"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "sales",
      }),
      makeComparisonMetric({
        id: "liability-asset-ratio",
        label: tr("liabilitiesToAssets"),
        current: currentLiabilityAssetRatio,
        previous: previousLiabilityAssetRatio,
        currency: "%",
        signal: tr("balanceLeverage"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "bs",
      }),
      makeComparisonMetric({
        id: "debt-to-equity-ratio",
        label: tr("debtToEquity"),
        current: currentDebtEquityRatio,
        previous: previousDebtEquityRatio,
        currency: "%",
        signal: tr("capitalStructure"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "bs",
      }),
      makeComparisonMetric({
        id: "burn-rate",
        label: tr("monthlyBurnRate"),
        current: currentBurnRate,
        previous: previousBurnRate,
        currency: "AED",
        signal: tr("cashPressure"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "cash-runway-days",
        label: tr("cashRunwayCoverage"),
        current: currentRunwayDays,
        previous: previousRunwayDays,
        currency: "days",
        signal: tr("n90DayRunway"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "projected-cash-shortfall",
        label: tr("projectedCashShortfall"),
        current: currentProjectedCashShortfall,
        previous: 0,
        currentLabel: tr("forecast"),
        previousLabel: tr("zeroShortfall"),
        currency: "AED",
        signal: tr("negativeCashRisk"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "cash-risk-week-count",
        label: tr("cashRiskWeekCount"),
        current: currentCashRiskWeekCount,
        previous: 0,
        currentLabel: tr("forecast"),
        previousLabel: tr("clearWeeks"),
        currency: "count",
        signal: tr("forecastRiskWeeks"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "operating-cash-flow",
        label: tr("operatingCashFlow"),
        current: currentOperatingCashFlow,
        previous: previousOperatingCashFlow,
        currency: "AED",
        signal: tr("cashMovement"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "budget-actual-variance",
        label: tr("budgetActualVariance"),
        current: currentBudgetActualValue,
        previous: currentBudgetBaselineValue,
        currentLabel: tr("actual"),
        previousLabel: tr("budget"),
        currency: "AED",
        signal: tr("budgetVsActual"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "open-receivables",
        label: tr("openReceivables"),
        current: currentOpenReceivableValue,
        previous: previousOpenReceivableValue,
        currency: "AED",
        signal: tr("collectionsPressure"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "open-invoice-count",
        label: tr("openInvoiceCount"),
        current: currentOpenReceivableInvoices.length,
        previous: previousOpenReceivableInvoices.length,
        currency: "count",
        signal: tr("collectionsWorkload"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-open-invoice-value",
        label: tr("averageOpenInvoiceValue"),
        current: currentAverageOpenInvoiceValue,
        previous: previousAverageOpenInvoiceValue,
        currency: "AED",
        signal: tr("openInvoiceSize"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "open-invoice-value-share",
        label: tr("openInvoiceValueShare"),
        current: currentOpenInvoiceValueShare,
        previous: previousOpenInvoiceValueShare,
        currency: "%",
        signal: tr("collectionsValueMix"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "due-soon-invoice-count",
        label: tr("invoicesDueSoon"),
        current: currentDueSoonReceivableInvoices.length,
        previous: previousDueSoonReceivableInvoices.length,
        currency: "count",
        signal: tr("n7DayCollectionsQueue"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "due-soon-invoice-value",
        label: tr("valueDueSoon"),
        current: currentDueSoonReceivableValue,
        previous: previousDueSoonReceivableValue,
        currency: "AED",
        signal: tr("n7DayCashCollection"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-due-soon-invoice-value",
        label: tr("averageDueSoonInvoiceValue"),
        current: currentAverageDueSoonInvoiceValue,
        previous: previousAverageDueSoonInvoiceValue,
        currency: "AED",
        signal: tr("n7DayInvoiceSize"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "due-soon-invoice-share",
        label: tr("dueSoonInvoiceShare"),
        current: currentDueSoonInvoiceShare,
        previous: previousDueSoonInvoiceShare,
        currency: "%",
        signal: tr("n7DayCollectionsMix"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "open-invoice-share",
        label: tr("openInvoiceShare"),
        current: currentOpenInvoiceShare,
        previous: previousOpenInvoiceShare,
        currency: "%",
        signal: tr("collectionsWorkloadMix"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-receivables",
        label: tr("overdueReceivables"),
        current: currentOverdueReceivableValue,
        previous: previousOverdueReceivableValue,
        currency: "AED",
        signal: tr("aRAtRisk"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-receivable-share",
        label: tr("overdueReceivableShare"),
        current: currentOverdueReceivableShare,
        previous: previousOverdueReceivableShare,
        currency: "%",
        signal: tr("aROverdueMix"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-invoice-count",
        label: tr("overdueInvoiceCount"),
        current: currentOverdueInvoiceCount,
        previous: previousOverdueInvoiceCount,
        currency: "count",
        signal: tr("customerFollowUps"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-overdue-invoice-value",
        label: tr("averageOverdueInvoiceValue"),
        current: currentAverageOverdueInvoiceValue,
        previous: previousAverageOverdueInvoiceValue,
        currency: "AED",
        signal: tr("overdueInvoiceSize"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-overdue-invoice-days",
        label: tr("averageOverdueInvoiceAge"),
        current: currentAverageOverdueInvoiceDays,
        previous: previousAverageOverdueInvoiceDays,
        currency: "days",
        signal: tr("overdueAging"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-invoice-share",
        label: tr("overdueInvoiceShare"),
        current: currentOverdueInvoiceShare,
        previous: previousOverdueInvoiceShare,
        currency: "%",
        signal: tr("overdueWorkloadMix"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "vendor-bill-value",
        label: tr("vendorBillValue"),
        current: currentVendorBillValue,
        previous: previousVendorBillValue,
        currency: "AED",
        signal: tr("supplierSpend"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "vendor-bill-count",
        label: tr("vendorBillCount"),
        current: currentVendorBillDocuments.length,
        previous: previousVendorBillDocuments.length,
        currency: "count",
        signal: tr("supplierBillVolume"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-bill-value",
        label: tr("averageBillValue"),
        current: currentAverageVendorBillValue,
        previous: previousAverageVendorBillValue,
        currency: "AED",
        signal: tr("supplierBillSize"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "top-vendor-share",
        label: tr("topVendorShare"),
        current: currentTopVendorShare,
        previous: previousTopVendorShare,
        currency: "%",
        signal: tr("supplierConcentration"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "paid-bill-share",
        label: tr("paidBillShare"),
        current: currentPaidVendorBillShare,
        previous: previousPaidVendorBillShare,
        currency: "%",
        signal: tr("supplierPaymentCoverage"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "open-payables",
        label: tr("openPayables"),
        current: currentOpenPayableValue,
        previous: previousOpenPayableValue,
        currency: "AED",
        signal: tr("billPayPressure"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "open-bill-value-share",
        label: tr("openBillValueShare"),
        current: currentOpenBillValueShare,
        previous: previousOpenBillValueShare,
        currency: "%",
        signal: tr("billPayValueMix"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "open-cash-gap",
        label: tr("openCashGap"),
        current: currentOpenCashGap,
        previous: previousOpenCashGap,
        currency: "AED",
        signal: tr("netUnpaidPressure"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "open-cash-coverage",
        label: tr("openCashCoverage"),
        current: currentOpenCashCoverage,
        previous: previousOpenCashCoverage,
        currency: "%",
        signal: tr("openBillCoverage"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "open-workload-gap",
        label: tr("openWorkloadGap"),
        current: currentOpenWorkloadGap,
        previous: previousOpenWorkloadGap,
        currency: "count",
        signal: tr("netUnpaidWorkload"),
        favorable: "neutral",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "open-bill-count",
        label: tr("openBillCount"),
        current: currentVendorBills.length,
        previous: previousVendorBills.length,
        currency: "count",
        signal: tr("billPayWorkload"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-open-bill-value",
        label: tr("averageOpenBillValue"),
        current: currentAverageOpenBillValue,
        previous: previousAverageOpenBillValue,
        currency: "AED",
        signal: tr("openBillSize"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "due-soon-bill-count",
        label: tr("billsDueSoon"),
        current: currentDueSoonBills.length,
        previous: previousDueSoonBills.length,
        currency: "count",
        signal: tr("n7DayBillPayQueue"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "due-soon-bill-value",
        label: tr("valueDueSoon"),
        current: currentDueSoonBillValue,
        previous: previousDueSoonBillValue,
        currency: "AED",
        signal: tr("n7DayCashNeed"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-due-soon-bill-value",
        label: tr("averageDueSoonBillValue"),
        current: currentAverageDueSoonBillValue,
        previous: previousAverageDueSoonBillValue,
        currency: "AED",
        signal: tr("n7DayBillSize"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "due-soon-bill-share",
        label: tr("dueSoonBillShare"),
        current: currentDueSoonBillShare,
        previous: previousDueSoonBillShare,
        currency: "%",
        signal: tr("n7DayBillPayMix"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "due-soon-cash-gap",
        label: tr("dueSoonCashGap"),
        current: currentDueSoonCashGap,
        previous: previousDueSoonCashGap,
        currency: "AED",
        signal: tr("n7DayNetCashNeed"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "due-soon-cash-coverage",
        label: tr("dueSoonCashCoverage"),
        current: currentDueSoonCashCoverage,
        previous: previousDueSoonCashCoverage,
        currency: "%",
        signal: tr("n7DayBillCoverage"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "due-soon-workload-gap",
        label: tr("dueSoonWorkloadGap"),
        current: currentDueSoonWorkloadGap,
        previous: previousDueSoonWorkloadGap,
        currency: "count",
        signal: tr("n7DayNetWorkload"),
        favorable: "neutral",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "open-bill-share",
        label: tr("openBillShare"),
        current: currentOpenBillShare,
        previous: previousOpenBillShare,
        currency: "%",
        signal: tr("billPayWorkloadMix"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-payables",
        label: tr("overduePayables"),
        current: currentOverduePayableValue,
        previous: previousOverduePayableValue,
        currency: "AED",
        signal: tr("aPAtRisk"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-cash-gap",
        label: tr("overdueCashGap"),
        current: currentOverdueCashGap,
        previous: previousOverdueCashGap,
        currency: "AED",
        signal: tr("netOverduePressure"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "overdue-cash-coverage",
        label: tr("overdueCashCoverage"),
        current: currentOverdueCashCoverage,
        previous: previousOverdueCashCoverage,
        currency: "%",
        signal: tr("overdueBillCoverage"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "overdue-workload-gap",
        label: tr("overdueWorkloadGap"),
        current: currentOverdueWorkloadGap,
        previous: previousOverdueWorkloadGap,
        currency: "count",
        signal: tr("netOverdueWorkload"),
        favorable: "neutral",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "overdue-payable-share",
        label: tr("overduePayableShare"),
        current: currentOverduePayableShare,
        previous: previousOverduePayableShare,
        currency: "%",
        signal: tr("aPOverdueMix"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-bill-count",
        label: tr("overdueBillCount"),
        current: currentOverdueBillCount,
        previous: previousOverdueBillCount,
        currency: "count",
        signal: tr("vendorFollowUps"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-overdue-bill-value",
        label: tr("averageOverdueBillValue"),
        current: currentAverageOverdueBillValue,
        previous: previousAverageOverdueBillValue,
        currency: "AED",
        signal: tr("overdueBillSize"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "average-overdue-bill-days",
        label: tr("averageOverdueBillAge"),
        current: currentAverageOverdueBillDays,
        previous: previousAverageOverdueBillDays,
        currency: "days",
        signal: tr("overdueAging"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "overdue-bill-share",
        label: tr("overdueBillShare"),
        current: currentOverdueBillShare,
        previous: previousOverdueBillShare,
        currency: "%",
        signal: tr("overdueBillMix"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "working-capital-proxy",
        label: tr("workingCapitalProxy"),
        current: currentWorkingCapitalProxy,
        previous: previousWorkingCapitalProxy,
        currency: "AED",
        signal: tr("aRLessAP"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "collection-days",
        label: tr("collectionDays"),
        current: currentCollectionDays,
        previous: previousCollectionDays,
        currency: "days",
        signal: tr("dsoProxy"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "payable-days",
        label: tr("payableDays"),
        current: currentPayableDays,
        previous: previousPayableDays,
        currency: "days",
        signal: tr("dpoProxy"),
        favorable: "neutral",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "cash-conversion-gap",
        label: tr("cashConversionGap"),
        current: currentCashConversionGap,
        previous: previousCashConversionGap,
        currency: "days",
        signal: tr("dsoLessDpo"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "top-customer-share",
        label: tr("topCustomerShare"),
        current: currentTopCustomerShare,
        previous: previousTopCustomerShare,
        currency: "%",
        signal: tr("clientConcentration"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "sales",
      }),
      makeComparisonMetric({
        id: "top-product-service-share",
        label: tr("topProductServiceShare"),
        current: comparisonCurrentSalesProductService?.totals?.topProductServiceShare ?? 0,
        previous: comparisonPreviousSalesProductService?.totals?.topProductServiceShare ?? 0,
        currency: "%",
        signal: tr("salesMixConcentration"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "sales",
      }),
      makeComparisonMetric({
        id: "expense-spend",
        label: tr("expenseSpend"),
        current: currentExpenseValue,
        previous: previousExpenseValue,
        currency: "AED",
        signal: tr("costPressure"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "receipt-count",
        label: tr("receiptCount"),
        current: currentReceipts.length,
        previous: previousReceipts.length,
        currency: "count",
        signal: tr("receiptWorkload"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "average-receipt-value",
        label: tr("averageReceiptValue"),
        current: currentAverageReceiptValue,
        previous: previousAverageReceiptValue,
        currency: "AED",
        signal: tr("receiptSize"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "expense-claim-review-value",
        label: tr("expenseClaimReviewValue"),
        current: currentExpenseClaimReviewValue,
        previous: previousExpenseClaimReviewValue,
        currency: "AED",
        signal: tr("claimsQueue"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "expense-claim-review-count",
        label: tr("expenseClaimReviewCount"),
        current: currentExpenseClaimReviewCount,
        previous: previousExpenseClaimReviewCount,
        currency: "count",
        signal: tr("claimsAwaitingReview"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "submitted-expense-claim-count",
        label: tr("submittedExpenseClaimCount"),
        current: currentSubmittedExpenseClaimCount,
        previous: previousSubmittedExpenseClaimCount,
        currency: "count",
        signal: tr("claimApprovals"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "submitted-expense-claim-value",
        label: tr("submittedExpenseClaimValue"),
        current: currentSubmittedExpenseClaimValue,
        previous: previousSubmittedExpenseClaimValue,
        currency: "AED",
        signal: tr("claimApprovalValue"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "approved-expense-claim-count",
        label: tr("approvedExpenseClaimCount"),
        current: currentApprovedExpenseClaimCount,
        previous: previousApprovedExpenseClaimCount,
        currency: "count",
        signal: tr("reimbursementFollowUp"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "approved-expense-claim-value",
        label: tr("approvedExpenseClaimValue"),
        current: currentApprovedExpenseClaimValue,
        previous: previousApprovedExpenseClaimValue,
        currency: "AED",
        signal: tr("reimbursementValue"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "unposted-expense-share",
        label: tr("unpostedExpenseShare"),
        current: currentUnpostedExpenseShare,
        previous: previousUnpostedExpenseShare,
        currency: "%",
        signal: tr("bookkeepingBacklog"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "unposted-receipt-count",
        label: tr("unpostedReceiptCount"),
        current: currentUnpostedReceiptCount,
        previous: previousUnpostedReceiptCount,
        currency: "count",
        signal: tr("postingQueue"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "unposted-receipt-value",
        label: tr("unpostedReceiptValue"),
        current: currentUnpostedReceiptValue,
        previous: previousUnpostedReceiptValue,
        currency: "AED",
        signal: tr("postingValue"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "auto-posted-receipt-count",
        label: tr("autoPostedReceiptCount"),
        current: currentAutoPostedReceiptCount,
        previous: previousAutoPostedReceiptCount,
        currency: "count",
        signal: tr("receiptsAutomated"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "auto-posted-receipt-value",
        label: tr("autoPostedReceiptValue"),
        current: currentAutoPostedReceiptValue,
        previous: previousAutoPostedReceiptValue,
        currency: "AED",
        signal: tr("automatedExpenseValue"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "receipt-automation-coverage",
        label: tr("receiptAutomationCoverage"),
        current: currentReceiptAutomationCoverage,
        previous: previousReceiptAutomationCoverage,
        currency: "%",
        signal: tr("autoPostCoverage"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "receipt-automation-value-coverage",
        label: tr("receiptAutomationValueCoverage"),
        current: currentReceiptAutomationValueCoverage,
        previous: previousReceiptAutomationValueCoverage,
        currency: "%",
        signal: tr("autoPostedValue"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "bank-reconciliation-coverage",
        label: tr("bankReconciliationCoverage"),
        current: currentBankReconciliationCoverage,
        previous: previousBankReconciliationCoverage,
        currency: "%",
        signal: tr("bankAutomationCoverage"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "reconciled-bank-count",
        label: tr("reconciledBankCount"),
        current: currentReconciledBankCount,
        previous: previousReconciledBankCount,
        currency: "count",
        signal: tr("bankTransactionsCleared"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "reconciled-bank-value",
        label: tr("reconciledBankValue"),
        current: currentReconciledBankValue,
        previous: previousReconciledBankValue,
        currency: "AED",
        signal: tr("bankValueCleared"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "unreconciled-bank-count",
        label: tr("unreconciledBankCount"),
        current: currentUnreconciledBankCount,
        previous: previousUnreconciledBankCount,
        currency: "count",
        signal: tr("bankReviewQueue"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "unreconciled-bank-value",
        label: tr("unreconciledBankValue"),
        current: currentUnreconciledBankValue,
        previous: previousUnreconciledBankValue,
        currency: "AED",
        signal: tr("bankValueAtReview"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "bank-match-suggestion-coverage",
        label: tr("bankMatchSuggestionCoverage"),
        current: currentBankMatchSuggestionCoverage,
        previous: previousBankMatchSuggestionCoverage,
        currency: "%",
        signal: tr("suggestedMatchCoverage"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "bank-match-suggestion-value-coverage",
        label: tr("bankMatchSuggestionValueCoverage"),
        current: currentBankMatchSuggestionValueCoverage,
        previous: previousBankMatchSuggestionValueCoverage,
        currency: "%",
        signal: tr("suggestedMatchValue"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "suggested-bank-match-count",
        label: tr("suggestedBankMatchCount"),
        current: currentSuggestedBankMatchCount,
        previous: previousSuggestedBankMatchCount,
        currency: "count",
        signal: tr("reviewReadyMatches"),
        favorable: "neutral",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "bank-assisted-transaction-count",
        label: tr("bankAssistedTransactionCount"),
        current: currentBankAssistedTransactionCount,
        previous: previousBankAssistedTransactionCount,
        currency: "count",
        signal: tr("bankWorkAssisted"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "bank-assisted-transaction-value",
        label: tr("bankAssistedTransactionValue"),
        current: currentBankAssistedTransactionValue,
        previous: previousBankAssistedTransactionValue,
        currency: "AED",
        signal: tr("assistedBankValue"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "bank-assisted-transaction-coverage",
        label: tr("bankAssistedTransactionCoverage"),
        current: currentBankAssistedTransactionCoverage ?? 0,
        previous: previousBankAssistedTransactionCoverage ?? 0,
        currency: "%",
        signal: tr("bankWorkCoverage"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "bank-assisted-transaction-value-coverage",
        label: tr("bankAssistedTransactionValueCoverage"),
        current: currentBankAssistedTransactionValueCoverage ?? 0,
        previous: previousBankAssistedTransactionValueCoverage ?? 0,
        currency: "%",
        signal: tr("assistedBankValueCoverage"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "automation-work-queue-count",
        label: tr("automationWorkQueueCount"),
        current: currentAutomationWorkQueueCount,
        previous: previousAutomationWorkQueueCount,
        currency: "count",
        signal: tr("actionQueue"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "automation-work-queue-value",
        label: tr("automationWorkQueueValue"),
        current: currentAutomationWorkQueueValue,
        previous: previousAutomationWorkQueueValue,
        currency: "AED",
        signal: tr("queueValue"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "ledger-automation-share",
        label: tr("ledgerAutomationShare"),
        current: currentLedgerAutomationShare,
        previous: previousLedgerAutomationShare,
        currency: "%",
        signal: tr("ledgerAutomationCoverage"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "manual-ledger-activity",
        label: tr("manualLedgerActivity"),
        current: currentManualLedgerActivity,
        previous: previousManualLedgerActivity,
        currency: "AED",
        signal: tr("manualLedgerValue"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "automated-ledger-activity",
        label: tr("automatedLedgerActivity"),
        current: currentAutomatedLedgerActivity,
        previous: previousAutomatedLedgerActivity,
        currency: "AED",
        signal: tr("automatedLedgerValue"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "automation-adoption-index",
        label: tr("automationAdoptionIndex"),
        current: currentAutomationAdoptionIndex,
        previous: previousAutomationAdoptionIndex,
        currency: "%",
        signal: tr("automationAdoption"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "automation-value-adoption-index",
        label: tr("automationValueAdoptionIndex"),
        current: currentAutomationValueAdoptionIndex,
        previous: previousAutomationValueAdoptionIndex,
        currency: "%",
        signal: tr("automationValueAdoption"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "planning",
      }),
      makeComparisonMetric({
        id: "cost-center-net-income",
        label: tr("costCenterNetIncome"),
        current: comparisonCurrentCostCenterProfitability?.totals?.netIncome ?? 0,
        previous: comparisonPreviousCostCenterProfitability?.totals?.netIncome ?? 0,
        currency: "AED",
        signal: tr("departmentProfitability"),
        favorable: "increase",
        personas: ["owner", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "cost-center-expenses",
        label: tr("costCenterExpenses"),
        current: comparisonCurrentCostCenterProfitability?.totals?.totalExpenses ?? 0,
        previous: comparisonPreviousCostCenterProfitability?.totals?.totalExpenses ?? 0,
        currency: "AED",
        signal: tr("departmentCostPressure"),
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "vat-due",
        label: tr("netVatDue"),
        current: comparisonCurrentVat?.netVATPayable ?? 0,
        previous: comparisonPreviousVat?.netVATPayable ?? 0,
        currency: "AED",
        signal: tr("taxCashFlow"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "vat",
      }),
      makeComparisonMetric({
        id: "corporate-tax-payable",
        label: tr("corporateTaxPayable"),
        current: corporateTaxEstimate?.taxPayable ?? 0,
        previous: comparisonPreviousCorporateTaxEstimate?.taxPayable ?? 0,
        currency: "AED",
        signal: tr("taxExposure"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "tax",
      }),
      makeComparisonMetric({
        id: "total-tax-exposure",
        label: tr("totalTaxExposure"),
        current: currentTotalTaxExposure,
        previous: previousTotalTaxExposure,
        currency: "AED",
        signal: tr("vatPlusCorporateTax"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "tax",
      }),
      makeComparisonMetric({
        id: "tax-exposure-rate",
        label: tr("taxExposureRate"),
        current: currentTaxExposureRate,
        previous: previousTaxExposureRate,
        currency: "%",
        signal: tr("taxLoad"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "tax",
      }),
      makeComparisonMetric({
        id: "tax-reserve-coverage",
        label: tr("taxReserveCoverage"),
        current: currentTaxReserveCoverage,
        previous: 100,
        currentLabel: tr("currentCash"),
        previousLabel: tr("fullyFunded"),
        currency: "%",
        signal: tr("taxCashCoverage"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "tax",
      }),
      makeComparisonMetric({
        id: "tax-funding-gap",
        label: tr("taxFundingGap"),
        current: currentTaxFundingGap,
        previous: 0,
        currentLabel: tr("currentGap"),
        previousLabel: tr("zeroGap"),
        currency: "AED",
        signal: tr("taxCashGap"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "tax",
      }),
      makeComparisonMetric({
        id: "tax-adjusted-runway-days",
        label: tr("taxAdjustedRunway"),
        current: currentTaxAdjustedRunwayDays,
        previous: currentRunwayDays,
        currentLabel: tr("afterTaxReserve"),
        previousLabel: tr("beforeTaxReserve"),
        currency: "days",
        signal: tr("postTaxRunway"),
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "tax",
      }),
      makeComparisonMetric({
        id: "payroll-cost",
        label: tr("payrollCost"),
        current: currentPayrollValue,
        previous: previousPayrollValue,
        currency: "AED",
        signal: tr("payrollMovement"),
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-run-count",
        label: tr("payrollRunCount"),
        current: currentPayrollRuns.length,
        previous: previousPayrollRuns.length,
        currency: "count",
        signal: tr("payrollRunVolume"),
        favorable: "neutral",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-deduction-share",
        label: tr("payrollDeductionShare"),
        current: currentPayrollDeductionShare,
        previous: previousPayrollDeductionShare,
        currency: "%",
        signal: tr("grossToNetPayroll"),
        favorable: "neutral",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "average-payroll-run-value",
        label: tr("averagePayrollRunValue"),
        current: currentAveragePayrollRunValue,
        previous: previousAveragePayrollRunValue,
        currency: "AED",
        signal: tr("payrollRunSize"),
        favorable: "neutral",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-covered-employees",
        label: tr("payrollCoveredEmployees"),
        current: currentPayrollCoveredEmployees,
        previous: previousPayrollCoveredEmployees,
        currency: "count",
        signal: tr("payrollHeadcount"),
        favorable: "neutral",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-cost-per-covered-employee",
        label: tr("payrollCostPerCoveredEmployee"),
        current: currentPayrollCostPerCoveredEmployee,
        previous: previousPayrollCostPerCoveredEmployee,
        currency: "AED",
        signal: tr("payrollUnitCost"),
        favorable: "neutral",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-approval-queue-count",
        label: tr("payrollApprovalQueue"),
        current: currentPayrollApprovalQueueCount,
        previous: previousPayrollApprovalQueueCount,
        currency: "count",
        signal: tr("payrollApprovals"),
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-approval-queue-value",
        label: tr("payrollApprovalQueueValue"),
        current: currentPayrollApprovalQueueValue,
        previous: previousPayrollApprovalQueueValue,
        currency: "AED",
        signal: tr("payrollApprovalValue"),
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-readiness-queue-count",
        label: tr("payrollReadinessQueue"),
        current: currentPayrollReadinessQueueCount,
        previous: previousPayrollReadinessQueueCount,
        currency: "count",
        signal: tr("payrollApprovalsAndWps"),
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-readiness-queue-value",
        label: tr("payrollReadinessQueueValue"),
        current: currentPayrollReadinessQueueValue,
        previous: previousPayrollReadinessQueueValue,
        currency: "AED",
        signal: tr("payrollReadinessValue"),
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "wps-missing-run-count",
        label: tr("wpsMissingRunCount"),
        current: currentWpsMissingRunCount,
        previous: previousWpsMissingRunCount,
        currency: "count",
        signal: tr("wpsFileGap"),
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "wps-missing-run-value",
        label: tr("wpsMissingRunValue"),
        current: currentWpsMissingRunValue,
        previous: previousWpsMissingRunValue,
        currency: "AED",
        signal: tr("wpsFileValueGap"),
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "payroll-expense-share",
        label: tr("payrollExpenseShare"),
        current: currentPayrollExpenseShare,
        previous: previousPayrollExpenseShare,
        currency: "%",
        signal: tr("payrollBurden"),
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "wps-ready-share",
        label: tr("wpsReadyShare"),
        current: currentWpsReadyShare,
        previous: previousWpsReadyShare,
        currency: "%",
        signal: tr("payrollFileReadiness"),
        favorable: "increase",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "inventory-movement",
        label: tr("inventoryMovement"),
        current: currentInventoryMovementValue,
        previous: previousInventoryMovementValue,
        currency: "AED",
        signal: tr("stockMovement"),
        favorable: "neutral",
        personas: ["owner", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "inventory-review-items",
        label: tr("inventoryReviewItems"),
        current: inventoryValuationReport.reviewCount,
        previous: 0,
        currentLabel: tr("reviewItems"),
        previousLabel: tr("clearBaseline"),
        currency: "count",
        signal: tr("stockReviewQueue"),
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "inventory-review-share",
        label: tr("inventoryReviewShare"),
        current: ratioPercent(
          inventoryValuationReport.reviewCount,
          inventoryValuationReport.activeProductCount
        ),
        previous: 0,
        currentLabel: tr("reviewShare"),
        previousLabel: tr("clearBaseline"),
        currency: "%",
        signal: tr("stockReviewMix"),
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "inventory-review-value",
        label: tr("inventoryReviewValue"),
        current: inventoryValuationReport.reviewValueAed,
        previous: 0,
        currentLabel: tr("reviewValue"),
        previousLabel: tr("clearBaseline"),
        currency: "AED",
        signal: tr("stockValueAtReview"),
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "fixed-asset-review-items",
        label: tr("fixedAssetReviewItems"),
        current: fixedAssetRegisterReport.reviewCount,
        previous: 0,
        currentLabel: tr("reviewItems"),
        previousLabel: tr("clearBaseline"),
        currency: "count",
        signal: tr("assetReviewQueue"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "fixed-asset-review-share",
        label: tr("fixedAssetReviewShare"),
        current: ratioPercent(
          fixedAssetRegisterReport.reviewCount,
          fixedAssetRegisterReport.activeRows.length
        ),
        previous: 0,
        currentLabel: tr("reviewShare"),
        previousLabel: tr("clearBaseline"),
        currency: "%",
        signal: tr("assetReviewMix"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "fixed-asset-review-value",
        label: tr("fixedAssetReviewValue"),
        current: fixedAssetRegisterReport.reviewValueAed,
        previous: 0,
        currentLabel: tr("reviewValue"),
        previousLabel: tr("clearBaseline"),
        currency: "AED",
        signal: tr("assetValueAtReview"),
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "depreciation-review-items",
        label: tr("depreciationReviewItems"),
        current: depreciationScheduleReport.reviewCount,
        previous: 0,
        currentLabel: tr("reviewItems"),
        previousLabel: tr("clearBaseline"),
        currency: "count",
        signal: tr("depreciationSetupQueue"),
        favorable: "decrease",
        personas: ["freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "depreciation-review-value",
        label: tr("depreciationReviewValue"),
        current: depreciationScheduleReport.reviewValueAed,
        previous: 0,
        currentLabel: tr("reviewValue"),
        previousLabel: tr("clearBaseline"),
        currency: "AED",
        signal: tr("depreciableValueAtReview"),
        favorable: "decrease",
        personas: ["freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "depreciation-ready-items",
        label: tr("depreciationReadyItems"),
        current: depreciationScheduleReport.readyToPostCount,
        previous: 0,
        currentLabel: tr("readyItems"),
        previousLabel: tr("clearBaseline"),
        currency: "count",
        signal: tr("depreciationPostingQueue"),
        favorable: "decrease",
        personas: ["freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "depreciation-ready-share",
        label: tr("depreciationReadyShare"),
        current: ratioPercent(
          depreciationScheduleReport.readyToPostCount,
          depreciationScheduleReport.readyToPostCount + depreciationScheduleReport.reviewCount
        ),
        previous: 100,
        currentLabel: tr("readyShare"),
        previousLabel: tr("ready"),
        currency: "%",
        signal: tr("depreciationReadiness"),
        favorable: "increase",
        personas: ["freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "depreciation-estimate",
        label: tr("depreciationEstimate"),
        current: currentDepreciationEstimate,
        previous: previousDepreciationEstimate,
        currency: "AED",
        signal: tr("depreciationSchedule"),
        favorable: "neutral",
        personas: ["freelancer", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "consolidated-revenue",
        label: tr("rollUpRevenue"),
        current: consolidatedStatementsReport.currentComparisonRevenue,
        previous: consolidatedStatementsReport.previousRevenue,
        currency: "AED",
        signal: tr("groupRevenue"),
        favorable: "increase",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "consolidated-expenses",
        label: tr("rollUpExpenses"),
        current: consolidatedStatementsReport.currentComparisonExpenses,
        previous: consolidatedStatementsReport.previousExpenses,
        currency: "AED",
        signal: tr("groupExpenses"),
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "consolidated-net-profit",
        label: tr("rollUpNetProfit"),
        current: consolidatedStatementsReport.currentComparisonNetProfit,
        previous: consolidatedStatementsReport.previousNetProfit,
        currency: "AED",
        signal: tr("multiEntityRollUp"),
        favorable: "increase",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "consolidated-margin",
        label: tr("rollUpMargin"),
        current: currentConsolidatedMargin,
        previous: previousConsolidatedMargin,
        currency: "%",
        signal: tr("groupProfitability"),
        favorable: "increase",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "consolidation-review-items",
        label: tr("consolidationReviewItems"),
        current: consolidatedStatementsReport.reviewCount,
        previous: 0,
        currentLabel: tr("reviewItems"),
        previousLabel: tr("clearBaseline"),
        currency: "count",
        signal: tr("consolidationReviewQueue"),
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "month-end-open-checks",
        label: tr("monthEndOpenChecks"),
        current: currentMonthEndOpenChecks,
        previous: 0,
        currentLabel: tr("openChecks"),
        previousLabel: tr("clearBaseline"),
        currency: "count",
        signal: tr("closeChecklist"),
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "month-end-readiness",
        label: tr("monthEndReadiness"),
        current: currentMonthEndReadiness,
        previous: 100,
        currentLabel: tr("checklist"),
        previousLabel: tr("ready"),
        currency: "%",
        signal: tr("closeReadiness"),
        favorable: "increase",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "audit-high-risk-event-count",
        label: tr("auditHighRiskEvents"),
        current: currentHighRiskActivityCount,
        previous: previousHighRiskActivityCount,
        currency: "count",
        signal: tr("riskyAuditActivity"),
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "audit-high-risk-event-share",
        label: tr("auditHighRiskEventShare"),
        current: currentHighRiskActivityShare,
        previous: previousHighRiskActivityShare,
        currency: "%",
        signal: tr("riskyActivityMix"),
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "audit-review-event-count",
        label: tr("auditReviewEvents"),
        current: currentReviewActivityCount,
        previous: previousReviewActivityCount,
        currency: "count",
        signal: tr("auditReviewWorkload"),
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "audit-review-event-share",
        label: tr("auditReviewEventShare"),
        current: currentReviewActivityShare,
        previous: previousReviewActivityShare,
        currency: "%",
        signal: tr("auditReviewMix"),
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "fx-unrealized-exposure",
        label: tr("fxUnrealizedExposure"),
        current: currentFxUnrealizedExposure,
        previous: 0,
        currentLabel: tr("exposure"),
        previousLabel: tr("clearBaseline"),
        currency: "AED",
        signal: tr("fxExposureAtReview"),
        favorable: "decrease",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "manual-ledger-share",
        label: tr("manualLedgerShare"),
        current: currentManualLedgerShare,
        previous: previousManualLedgerShare,
        currency: "%",
        signal: tr("manualSourceCoverage"),
        favorable: "decrease",
        personas: ["accountant"],
        tab: "ledger",
      }),
      makeComparisonMetric({
        id: "ledger-activity",
        label: tr("ledgerActivity"),
        current: currentLedgerActivity,
        previous: previousLedgerActivity,
        currency: "AED",
        signal: tr("closeActivity"),
        favorable: "neutral",
        personas: ["accountant"],
        tab: "ledger",
      }),
    ];
  }, [
    comparisonCurrentProfitLoss?.netProfit,
    comparisonCurrentProfitLoss?.totalExpenses,
    comparisonCurrentProfitLoss?.totalRevenue,
    comparisonCurrentBalanceSheet?.totalAssets,
    comparisonCurrentBalanceSheet?.totalEquity,
    comparisonCurrentBalanceSheet?.totalLiabilities,
    comparisonCurrentCostCenterProfitability?.totals?.netIncome,
    comparisonCurrentCostCenterProfitability?.totals?.totalExpenses,
    comparisonCurrentRange,
    comparisonCurrentSalesProductService?.totals?.topProductServiceShare,
    comparisonCurrentVat?.netVATPayable,
    comparisonPreviousCostCenterProfitability?.totals?.netIncome,
    comparisonPreviousCostCenterProfitability?.totals?.totalExpenses,
    comparisonPreviousCorporateTaxEstimate?.taxPayable,
    comparisonPreviousProfitLoss?.netProfit,
    comparisonPreviousProfitLoss?.totalExpenses,
    comparisonPreviousProfitLoss?.totalRevenue,
    comparisonPreviousBalanceSheet?.totalAssets,
    comparisonPreviousBalanceSheet?.totalEquity,
    comparisonPreviousBalanceSheet?.totalLiabilities,
    comparisonPreviousRange,
    comparisonPreviousSalesProductService?.totals?.topProductServiceShare,
    comparisonPreviousVat?.netVATPayable,
    consolidatedStatementsReport.currentComparisonExpenses,
    consolidatedStatementsReport.currentComparisonNetProfit,
    consolidatedStatementsReport.currentComparisonRevenue,
    consolidatedStatementsReport.previousExpenses,
    consolidatedStatementsReport.previousNetProfit,
    consolidatedStatementsReport.previousRevenue,
    consolidatedStatementsReport.reviewCount,
    activityLogs,
    bankTransactions,
    cashFlowForecast?.currentBalance,
    cashFlowForecast?.projections,
    cashFlowStatement,
    corporateTaxEstimate?.taxPayable,
    depreciationScheduleReport.readyToPostCount,
    depreciationScheduleReport.reviewCount,
    depreciationScheduleReport.reviewValueAed,
    expenseClaims,
    fixedAssetRegisterReport.activeRows,
    fixedAssetRegisterReport.reviewCount,
    fixedAssetRegisterReport.reviewValueAed,
    fxGainsLosses?.totalUnrealizedGain,
    fxGainsLosses?.totalUnrealizedLoss,
    invoices,
    inventoryMovements,
    inventoryValuationReport.reviewCount,
    inventoryValuationReport.reviewValueAed,
    journalEntries,
    monthEndCloseStatus?.checklist,
    payrollRuns,
    receipts,
    varianceReport?.varianceLines,
    vendorBills,
  ]);

  const visibleComparisonRows = useMemo(() => {
    return comparisonRows.filter(
      (row) =>
        matchesReportPersona(row.personas, personaFilter) &&
        matchesReportWorkflowSearch([
          row.label,
          row.signal,
          row.currency,
          row.personas.join(" "),
          row.tab,
        ])
    );
  }, [comparisonRows, matchesReportWorkflowSearch, personaFilter]);

  const reportComparisonPresetSummaries = useMemo(() => {
    return reportComparisonPresets.flatMap((preset) => {
      const workspace = workspaceSummaries.find((item) => item.persona === preset.persona);
      if (!workspace) return [];

      const reports = preset.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const metrics = preset.metricIds
        .map((metricId) => comparisonRows.find((row) => row.id === metricId))
        .filter((row): row is ComparisonMetricRow => Boolean(row));
      const warningCount = metrics.filter(
        (row) => comparisonBadgeVariant(row) === "warning"
      ).length;

      return [
        {
          ...preset,
          workspace,
          reports,
          metrics,
          warningCount,
          href: reportComparisonPresetHref(preset),
        },
      ];
    });
  }, [comparisonRows, workspaceSummaries]);

  const visibleReportComparisonPresets = useMemo(() => {
    return reportComparisonPresetSummaries.filter(
      (preset) =>
        matchesReportPersona([preset.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          preset.title,
          preset.question,
          preset.baseline,
          preset.automationTrigger,
          preset.commandKeywords,
          preset.reports.map((report) => report.name).join(" "),
          preset.metrics.map((metric) => metric.label).join(" "),
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportComparisonPresetSummaries]);

  const comparisonLoading =
    comparisonCurrentPlLoading ||
    comparisonPreviousPlLoading ||
    comparisonCurrentBalanceSheetLoading ||
    comparisonPreviousBalanceSheetLoading ||
    comparisonCurrentSalesProductServiceLoading ||
    comparisonPreviousSalesProductServiceLoading ||
    comparisonCurrentVatLoading ||
    comparisonPreviousVatLoading ||
    comparisonCurrentCostCenterLoading ||
    comparisonPreviousCostCenterLoading ||
    corporateTaxLoading ||
    comparisonPreviousCorporateTaxLoading ||
    consolidatedStatementsLoading ||
    cashFlowForecastLoading ||
    varianceLoading ||
    expenseClaimsLoading ||
    invoicesLoading ||
    journalLoading ||
    monthEndCloseLoading ||
    receiptsLoading ||
    bankTransactionsLoading ||
    vendorBillsLoading;

  const reportJournalEntries = useMemo(() => {
    return journalEntries.filter(
      (entry) => entry.status === "posted" && journalEntryInDateRange(entry, dateRange)
    );
  }, [dateRange, journalEntries]);

  const ledgerLines = useMemo<LedgerLineRow[]>(() => {
    return reportJournalEntries
      .flatMap((entry) =>
        (entry.lines ?? []).map((line) => ({
          id: line.id,
          entryId: entry.id,
          entryNumber: entry.entryNumber,
          date: entry.date,
          memo: line.memo || entry.memo || "",
          source: journalSourceLabel(entry.source),
          accountId: line.accountId,
          accountCode: line.account?.code || "",
          accountName: journalAccountName(line.account),
          accountType: line.account?.type || "unknown",
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          hasForeignCurrency: Boolean(line.foreignCurrency),
        }))
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [reportJournalEntries]);

  const accountActivity = useMemo<AccountActivityRow[]>(() => {
    const summaries = new Map<string, AccountActivityRow>();
    for (const line of ledgerLines) {
      const summary = summaries.get(line.accountId) ?? {
        accountId: line.accountId,
        accountCode: line.accountCode,
        accountName: line.accountName,
        accountType: line.accountType,
        lineCount: 0,
        debit: 0,
        credit: 0,
        netActivity: 0,
        lastActivity: line.date,
      };
      summary.lineCount += 1;
      summary.debit += line.debit;
      summary.credit += line.credit;
      summary.netActivity = summary.debit - summary.credit;
      if (new Date(line.date) > new Date(summary.lastActivity)) {
        summary.lastActivity = line.date;
      }
      summaries.set(line.accountId, summary);
    }
    return Array.from(summaries.values()).sort(
      (a, b) => Math.abs(b.netActivity) - Math.abs(a.netActivity)
    );
  }, [ledgerLines]);

  const ledgerSourceRows = useMemo<LedgerSourceRow[]>(() => {
    const sourceEntries = new Map<string, Set<string>>();
    const summaries = new Map<string, LedgerSourceRow>();
    for (const line of ledgerLines) {
      const source = line.source;
      const entryIds = sourceEntries.get(source) ?? new Set<string>();
      entryIds.add(line.entryId);
      sourceEntries.set(source, entryIds);

      const summary = summaries.get(source) ?? {
        source,
        entryCount: 0,
        lineCount: 0,
        amountAed: 0,
        needsReview: source === "Manual / no source" || source === "manual",
      };
      summary.lineCount += 1;
      summary.amountAed += Math.max(line.debit, line.credit);
      summaries.set(source, summary);
    }
    for (const [source, summary] of summaries) {
      summary.entryCount = sourceEntries.get(source)?.size ?? 0;
    }
    return Array.from(summaries.values()).sort((a, b) => b.amountAed - a.amountAed);
  }, [ledgerLines]);

  const ledgerReport = useMemo(() => {
    const totalDebit = ledgerLines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = ledgerLines.reduce((sum, line) => sum + line.credit, 0);
    const reviewEntries = reportJournalEntries.filter(
      (entry) => !entry.source || entry.source === "manual"
    ).length;
    return {
      entryCount: reportJournalEntries.length,
      lineCount: ledgerLines.length,
      accountCount: accountActivity.length,
      totalDebit,
      totalCredit,
      difference: Math.abs(totalDebit - totalCredit),
      reviewEntries,
      foreignCurrencyLines: ledgerLines.filter((line) => line.hasForeignCurrency).length,
      lines: ledgerLines,
      accountActivity,
      sourceRows: ledgerSourceRows,
    };
  }, [accountActivity, ledgerLines, ledgerSourceRows, reportJournalEntries]);

  const ledgerLoading = journalLoading;
  const ledgerDetailPageCount = Math.max(1, Math.ceil(ledgerLines.length / ledgerDetailPageSize));
  const ledgerDetailCurrentPage = Math.min(ledgerDetailPage, ledgerDetailPageCount);
  const ledgerDetailStartIndex = (ledgerDetailCurrentPage - 1) * ledgerDetailPageSize;
  const ledgerDetailPageLines = ledgerLines.slice(
    ledgerDetailStartIndex,
    ledgerDetailStartIndex + ledgerDetailPageSize
  );

  const reportActivityLogs = useMemo(() => {
    return activityLogs.filter((log) => activityLogInDateRange(log, dateRange));
  }, [activityLogs, dateRange]);

  const auditTrailReport = useMemo(() => {
    const actionRows = new Map<string, AuditTrailSummaryRow>();
    const entityRows = new Map<string, AuditTrailSummaryRow>();
    const rows = reportActivityLogs
      .map((log) => ({
        ...log,
        actionLabel: activityLogLabel(log.action),
        entityLabel: activityLogLabel(log.entityType),
        riskLevel: activityLogRiskLevel(log),
      }))
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });

    for (const row of rows) {
      const actionKey = row.action || "unknown";
      const actionSummary = actionRows.get(actionKey) ?? {
        key: actionKey,
        label: row.actionLabel,
        count: 0,
        latestAt: null,
      };
      actionSummary.count += 1;
      if (
        row.createdAt &&
        (!actionSummary.latestAt || new Date(row.createdAt) > new Date(actionSummary.latestAt))
      ) {
        actionSummary.latestAt = row.createdAt;
      }
      actionRows.set(actionKey, actionSummary);

      const entityKey = row.entityType || "unknown";
      const entitySummary = entityRows.get(entityKey) ?? {
        key: entityKey,
        label: row.entityLabel,
        count: 0,
        latestAt: null,
      };
      entitySummary.count += 1;
      if (
        row.createdAt &&
        (!entitySummary.latestAt || new Date(row.createdAt) > new Date(entitySummary.latestAt))
      ) {
        entitySummary.latestAt = row.createdAt;
      }
      entityRows.set(entityKey, entitySummary);
    }

    const postingActionCount = rows.filter((row) =>
      /(approve|post|journal|close|reconcile)/.test(row.action.toLowerCase())
    ).length;

    return {
      rows,
      actionRows: Array.from(actionRows.values()).sort(
        (a, b) => b.count - a.count || a.label.localeCompare(b.label)
      ),
      entityRows: Array.from(entityRows.values()).sort(
        (a, b) => b.count - a.count || a.label.localeCompare(b.label)
      ),
      logCount: rows.length,
      highRiskCount: rows.filter((row) => row.riskLevel === "High").length,
      mediumRiskCount: rows.filter((row) => row.riskLevel === "Medium").length,
      postingActionCount,
      userCount: new Set(rows.map((row) => row.userId).filter(Boolean)).size,
      latestLog: rows[0] ?? null,
    };
  }, [reportActivityLogs]);

  const auditTrailPeriodLabel =
    dateRange.from && dateRange.to
      ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
      : tr("latest200ActivityEvents");

  const auditTrailLoading = activityLogsLoading;

  const monthEndChecklist = useMemo(
    () => monthEndCloseStatus?.checklist ?? [],
    [monthEndCloseStatus?.checklist]
  );
  const monthEndCompletedChecks = monthEndChecklist.filter(
    (item) => item.status === "complete"
  ).length;
  const monthEndReviewChecks = Math.max(0, monthEndChecklist.length - monthEndCompletedChecks);
  const monthEndReadinessPercent = monthEndChecklist.length
    ? Math.round((monthEndCompletedChecks / monthEndChecklist.length) * 100)
    : 0;
  const monthEndCloseExportReport = useMemo(
    () => ({
      ...(monthEndCloseStatus ?? {
        period: monthEndPeriod,
        periodStart: "",
        periodEnd: "",
        checklist: [],
      }),
      completedChecks: monthEndCompletedChecks,
      reviewChecks: monthEndReviewChecks,
      readinessPercent: monthEndReadinessPercent,
    }),
    [
      monthEndCloseStatus,
      monthEndCompletedChecks,
      monthEndPeriod,
      monthEndReadinessPercent,
      monthEndReviewChecks,
    ]
  );

  const planningReport = useMemo(() => {
    const varianceLines = varianceReport?.varianceLines ?? [];
    const budgetTotal = varianceLines.reduce((sum, line) => sum + line.totals.budget, 0);
    const actualTotal = varianceLines.reduce((sum, line) => sum + line.totals.actual, 0);
    const variance = budgetTotal - actualTotal;
    const variancePercent = budgetTotal !== 0 ? (variance / budgetTotal) * 100 : 0;
    const overBudgetLines = varianceLines.filter((line) => line.totals.variance < 0).length;
    const largestVarianceLines = [...varianceLines].sort(
      (a, b) => Math.abs(b.totals.variance) - Math.abs(a.totals.variance)
    );

    const projections = cashFlowForecast?.projections ?? [];
    const projectedInflows = projections.reduce((sum, row) => sum + row.expectedInflows, 0);
    const projectedOutflows = projections.reduce((sum, row) => sum + row.expectedOutflows, 0);
    const endingProjection = projections[projections.length - 1];
    const lowestProjection = projections.reduce<CashFlowProjection | undefined>((lowest, row) => {
      if (!lowest || row.projectedBalance < lowest.projectedBalance) return row;
      return lowest;
    }, undefined);
    const projectedEndingBalance =
      endingProjection?.projectedBalance ?? cashFlowForecast?.currentBalance ?? 0;
    const currentBalance = cashFlowForecast?.currentBalance ?? 0;
    const cashMovement = projectedEndingBalance - currentBalance;
    const cashWarning =
      lowestProjection && lowestProjection.projectedBalance < 0
        ? tr("negativeCashRisk")
        : lowestProjection && lowestProjection.projectedBalance < 10000
          ? "Low cash warning"
          : "On track";

    return {
      budget: varianceReport?.budget ?? null,
      budgetPlans,
      varianceLines,
      budgetTotal,
      actualTotal,
      variance,
      variancePercent,
      overBudgetLines,
      largestVarianceLines,
      forecast: cashFlowForecast ?? null,
      projections,
      projectedInflows,
      projectedOutflows,
      projectedEndingBalance,
      currentBalance,
      cashMovement,
      cashWarning,
      lowestProjection,
      insights: cashFlowForecast?.insights ?? [],
    };
  }, [budgetPlans, cashFlowForecast, varianceReport]);

  const planningLoading = budgetPlansLoading || varianceLoading || cashFlowForecastLoading;
  const advancedReportsLoading =
    cashFlowStatementLoading ||
    agingReportLoading ||
    billAgingLoading ||
    advancedPeriodComparisonLoading ||
    fxGainsLossesLoading ||
    vatReturnsLoading ||
    costCenterProfitabilityLoading;

  const automationLoading =
    balancesLoading ||
    expensesLoading ||
    vatLoading ||
    corporateTaxLoading ||
    trialBalanceLoading ||
    ledgerLoading ||
    monthEndCloseLoading ||
    auditTrailLoading ||
    consolidatedStatementsLoading ||
    payrollLoading ||
    planningLoading ||
    advancedReportsLoading;

  const automationQueue = useMemo<AutomationQueueItem[]>(() => {
    const vatNet = vatSummary?.netVATPayable ?? 0;
    const corporateTaxPayable = corporateTaxEstimate?.taxPayable ?? 0;
    const closeReviewCount = ledgerReport.reviewEntries + (trialBalanceSummary.isBalanced ? 0 : 1);
    const planningRiskCount =
      (planningReport.cashWarning === "On track" ? 0 : 1) + planningReport.overBudgetLines;

    return [
      {
        id: "collections",
        title: tr("collectionsFollowUp"),
        signal: tr("overdueCustomers"),
        detail: tr("routeOverdueReceivablesIntoPaymentChasing"),
        count: balanceReport.overdueCustomerCount,
        amount: balanceReport.customerOverdueAed,
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: Users,
        actionLabel: tr("openQueue"),
        href: "/payment-chasing",
      },
      {
        id: "bill-pay",
        title: tr("billPayTiming"),
        signal: tr("overdueVendors"),
        detail: tr("reviewVendorBalancesAndPayableTiming"),
        count: balanceReport.overdueVendorCount,
        amount: balanceReport.vendorOverdueAed,
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: Wallet,
        actionLabel: tr("openBills"),
        href: "/bill-pay?tab=summary",
      },
      {
        id: "inventory-risk",
        title: tr("inventoryValuation"),
        signal:
          inventoryValuationReport.reviewCount > 0 ? tr("stockReviewItems") : tr("inventoryValued"),
        detail:
          inventoryValuationReport.reviewCount > 0
            ? tr("productsNeedStockReorderOrCosting", {
                reviewCount: inventoryValuationReport.reviewCount,
              })
            : tr("activeProductsValuedForTheBalance", {
                activeProductCount: inventoryValuationReport.activeProductCount,
              }),
        count: inventoryValuationReport.reviewCount,
        amount: inventoryValuationReport.totalStockValueAed,
        currency: "AED",
        personas: ["owner", "accountant"],
        icon: FileSpreadsheet,
        actionLabel: tr("openInventory"),
        href: "/inventory",
      },
      {
        id: "inventory-movement-review",
        title: tr("inventoryMovement"),
        signal:
          inventoryMovementReport.movementCount > 0
            ? tr("stockMovementPosted")
            : tr("noStockMovement"),
        detail:
          inventoryMovementReport.reorderSignalCount > 0
            ? tr("productsNeedReorderOrNegativeStock", {
                reorderSignalCount: inventoryMovementReport.reorderSignalCount,
              })
            : tr("movementsAcrossProductsInThisPeriod", {
                movementCount: inventoryMovementReport.movementCount,
                productCount: inventoryMovementReport.productCount,
              }),
        count: inventoryMovementReport.reorderSignalCount,
        amount: inventoryMovementReport.outboundValueAed,
        currency: "AED",
        personas: ["owner", "accountant"],
        icon: FileSpreadsheet,
        actionLabel: tr("openMovements"),
        href: "/inventory",
      },
      {
        id: "fixed-asset-review",
        title: tr("fixedAssetRegister"),
        signal:
          fixedAssetRegisterReport.reviewCount > 0
            ? tr("assetReviewItems")
            : tr("assetRegisterReady"),
        detail:
          fixedAssetRegisterReport.capitalizationReviewCount > 0
            ? tr("assetsNeedCapitalizationJournalReview", {
                capitalizationReviewCount: fixedAssetRegisterReport.capitalizationReviewCount,
              })
            : tr("activeAssetsWithDepreciationAndNbv", {
                totalAssets: fixedAssetRegisterReport.totalAssets,
              }),
        count: fixedAssetRegisterReport.reviewCount,
        amount: fixedAssetRegisterReport.totalNetBookValue,
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: Building2,
        actionLabel: tr("openFixedAssets"),
        href: "/fixed-assets",
      },
      {
        id: "depreciation-posting",
        title: tr("depreciationSchedule"),
        signal:
          depreciationScheduleReport.reviewCount > 0
            ? tr("depreciationSetupReview")
            : tr("depreciationReady"),
        detail:
          depreciationScheduleReport.reviewCount > 0
            ? tr("assetsNeedUsefulLifeDateOr", {
                reviewCount: depreciationScheduleReport.reviewCount,
              })
            : tr("assetsHaveDepreciationSuggestions", {
                readyToPostCount: depreciationScheduleReport.readyToPostCount,
                monthEndPeriodLabel,
              }),
        count: depreciationScheduleReport.readyToPostCount + depreciationScheduleReport.reviewCount,
        amount: depreciationScheduleReport.periodDepreciationAed,
        currency: "AED",
        personas: ["freelancer", "accountant"],
        icon: FileSpreadsheet,
        actionLabel: tr("openFixedAssets"),
        href: "/fixed-assets",
      },
      {
        id: "receipt-posting",
        title: tr("receiptPosting"),
        signal: tr("receiptsWaiting"),
        detail: tr("clearOcrAndPostingExceptionsBefore"),
        count: expenseReport.unpostedReceipts,
        personas: ["owner", "freelancer", "accountant"],
        icon: FileSpreadsheet,
        actionLabel: tr("openExpenses"),
        tab: "expenses",
      },
      {
        id: "expense-claims-review",
        title: tr("expenseClaims"),
        signal:
          expenseClaimReport.reviewCount > 0 ? tr("claimQueueOpen") : tr("expenseClaimsClear"),
        detail:
          expenseClaimReport.submittedCount > 0
            ? tr("submittedClaimsNeedApproval", {
                submittedCount: expenseClaimReport.submittedCount,
              })
            : expenseClaimReport.approvedUnpaidCount > 0
              ? tr("approvedClaimsAreAwaitingReimbursement", {
                  approvedUnpaidCount: expenseClaimReport.approvedUnpaidCount,
                })
              : tr("noClaimsArePendingApprovalOr"),
        count: expenseClaimReport.reviewCount,
        amount: expenseClaimReport.submittedAmount + expenseClaimReport.approvedUnpaidAmount,
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: ClipboardCheck,
        actionLabel: tr("openClaims"),
        href: "/expense-claims",
      },
      {
        id: "payroll-wps-review",
        title: tr("payrollAndWps"),
        signal:
          payrollReport.approvalQueueCount > 0 || payrollReport.wpsMissingCount > 0
            ? tr("payrollActionNeeded")
            : tr("payrollReady"),
        detail:
          payrollReport.approvalQueueCount > 0
            ? tr("calculatedPayrollRunsNeedApproval", {
                approvalQueueCount: payrollReport.approvalQueueCount,
              })
            : payrollReport.wpsMissingCount > 0
              ? tr("payrollRunsNeedSifGeneration", {
                  wpsMissingCount: payrollReport.wpsMissingCount,
                })
              : tr("payrollRunsAreSummarizedForOwner", { runCount: payrollReport.runCount }),
        count: payrollReport.approvalQueueCount + payrollReport.wpsMissingCount,
        amount: payrollReport.totalNet,
        currency: "AED",
        personas: ["owner", "accountant"],
        icon: DollarSign,
        actionLabel: tr("openPayroll"),
        href: "/payroll",
      },
      {
        id: "vat-readiness",
        title: tr("vatReadiness"),
        signal: vatNet >= 0 ? tr("vatPayable") : tr("vatRefund"),
        detail: tr("checkTheFilingAmountAndSupporting"),
        count: Math.abs(vatNet) > 0.005 ? 1 : 0,
        amount: Math.abs(vatNet),
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: FileText,
        actionLabel: tr("openFiling"),
        href: "/vat-filing",
      },
      {
        id: "sales-mix",
        title: tr("salesMixConcentration"),
        signal: topProductServiceSalesRow
          ? `${topProductServiceSalesRow.productService} leads sales`
          : tr("noLineItemSales"),
        detail: tr("reviewProductServiceConcentrationBeforeForecasti"),
        count: productServiceTopShare >= 50 ? 1 : 0,
        amount: topProductServiceSalesRow?.amountAed ?? 0,
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: BarChart3,
        actionLabel: tr("openSalesMix"),
        tab: "sales",
      },
      {
        id: "corporate-tax",
        title: tr("corporateTaxEstimate"),
        signal: corporateTaxPayable > 0.005 ? tr("taxPayable") : tr("noCurrentTaxDue"),
        detail: tr("reviewTheCorporateTaxEstimateAnd"),
        count: corporateTaxPayable > 0.005 ? 1 : 0,
        amount: Math.max(0, corporateTaxPayable),
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: Scale,
        actionLabel: tr("openEstimate"),
        tab: "tax",
      },
      {
        id: "close-review",
        title: tr("closeReview"),
        signal: tr("reviewItems"),
        detail: tr("inspectTrialBalanceDifferencesAndManual"),
        count: closeReviewCount,
        personas: ["accountant"],
        icon: ClipboardCheck,
        actionLabel: tr("openLedger"),
        tab: closeReviewCount > 0 && !trialBalanceSummary.isBalanced ? "trial" : "ledger",
      },
      {
        id: "month-end-close",
        title: tr("monthEndCloseStatus"),
        signal: tr("closeChecklist"),
        detail:
          monthEndReviewChecks > 0
            ? tr("closeChecksNeedReviewFor", { monthEndReviewChecks, monthEndPeriodLabel })
            : tr("closeChecklistIsComplete", { monthEndPeriodLabel }),
        count: monthEndReviewChecks,
        personas: ["accountant"],
        icon: ClipboardCheck,
        actionLabel: tr("openCloseStatus"),
        tab: "close",
      },
      {
        id: "audit-trail-review",
        title: tr("auditTrail"),
        signal:
          auditTrailReport.highRiskCount > 0 ? tr("highRiskActivity") : tr("activityLogReviewed"),
        detail:
          auditTrailReport.highRiskCount > 0
            ? tr("deleteVoidRejectOrErrorEvents", { highRiskCount: auditTrailReport.highRiskCount })
            : tr("activityEventsSummarizedForReviewerEvidence", {
                logCount: auditTrailReport.logCount,
              }),
        count: auditTrailReport.highRiskCount,
        personas: ["accountant"],
        icon: FileText,
        actionLabel: tr("openHistory"),
        href: "/history",
      },
      {
        id: "consolidated-statements-review",
        title: tr("managementRollUp"),
        signal:
          consolidatedStatementsReport.reviewCount > 0
            ? tr("consolidationReview")
            : tr("multiEntityRollUpReady"),
        detail:
          consolidatedStatementsReport.reviewCount > 0
            ? tr("entityBalanceOrFxChecksNeed", {
                reviewCount: consolidatedStatementsReport.reviewCount,
              })
            : tr("entitiesRolledUpWithNoEliminations", {
                loadedEntityCount: consolidatedStatementsReport.loadedEntityCount,
              }),
        count: consolidatedStatementsReport.reviewCount,
        amount: Math.abs(consolidatedStatementsReport.netProfit),
        currency: "AED",
        personas: ["accountant"],
        icon: FileSpreadsheet,
        actionLabel: tr("openRollUp"),
        tab: "close",
      },
      {
        id: "planning-risk",
        title: tr("planningGuardrails"),
        signal: tr("budgetAndCashAlerts"),
        detail: tr("reviewCashWarningsAndBudgetVariance"),
        count: planningRiskCount,
        amount: Math.abs(planningReport.variance),
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: AlertTriangle,
        actionLabel: tr("openPlanning"),
        tab: "planning",
      },
    ];
  }, [
    balanceReport.customerOverdueAed,
    balanceReport.overdueCustomerCount,
    balanceReport.overdueVendorCount,
    balanceReport.vendorOverdueAed,
    consolidatedStatementsReport.loadedEntityCount,
    consolidatedStatementsReport.netProfit,
    consolidatedStatementsReport.reviewCount,
    corporateTaxEstimate?.taxPayable,
    depreciationScheduleReport.periodDepreciationAed,
    depreciationScheduleReport.readyToPostCount,
    depreciationScheduleReport.reviewCount,
    expenseClaimReport.approvedUnpaidAmount,
    expenseClaimReport.approvedUnpaidCount,
    expenseClaimReport.reviewCount,
    expenseClaimReport.submittedAmount,
    expenseClaimReport.submittedCount,
    expenseReport.unpostedReceipts,
    fixedAssetRegisterReport.capitalizationReviewCount,
    fixedAssetRegisterReport.reviewCount,
    fixedAssetRegisterReport.totalAssets,
    fixedAssetRegisterReport.totalNetBookValue,
    inventoryValuationReport.activeProductCount,
    inventoryValuationReport.reviewCount,
    inventoryValuationReport.totalStockValueAed,
    inventoryMovementReport.movementCount,
    inventoryMovementReport.outboundValueAed,
    inventoryMovementReport.productCount,
    inventoryMovementReport.reorderSignalCount,
    ledgerReport.reviewEntries,
    monthEndPeriodLabel,
    monthEndReviewChecks,
    auditTrailReport.highRiskCount,
    auditTrailReport.logCount,
    payrollReport.approvalQueueCount,
    payrollReport.runCount,
    payrollReport.totalNet,
    payrollReport.wpsMissingCount,
    planningReport.cashWarning,
    planningReport.overBudgetLines,
    planningReport.variance,
    productServiceTopShare,
    topProductServiceSalesRow,
    trialBalanceSummary.isBalanced,
    vatSummary?.netVATPayable,
  ]);

  const visibleAutomationQueue = useMemo(() => {
    return automationQueue.filter((item) => matchesReportPersona(item.personas, personaFilter));
  }, [automationQueue, personaFilter]);

  const automationQueueCount = visibleAutomationQueue.reduce((sum, item) => sum + item.count, 0);

  const reportAutomationStarterSummaries = useMemo(() => {
    return reportAutomationStarters.flatMap((starter) => {
      const workspace = workspaceSummaries.find((item) => item.persona === starter.persona);
      if (!workspace) return [];

      const reports = starter.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const playbooks = starter.playbookIds
        .map((playbookId) => workspace.automations.find((playbook) => playbook.id === playbookId))
        .filter((playbook): playbook is (typeof workspace.automations)[number] =>
          Boolean(playbook)
        );
      const queueSignals = automationQueue.filter((item) => starter.queueIds.includes(item.id));
      const openSignals = queueSignals.filter((item) => item.count > 0);
      const openWorkItemCount = openSignals.reduce((sum, item) => sum + item.count, 0);
      const amountAtRisk = openSignals.reduce((sum, item) => sum + (item.amount ?? 0), 0);
      const readyCount = reports.filter((report) => report.status !== "planned").length;

      return [
        {
          ...starter,
          workspace,
          reports,
          playbooks,
          queueSignals,
          openSignals,
          openWorkItemCount,
          amountAtRisk,
          readyCount,
          href: reportAutomationStarterHref(starter),
        },
      ];
    });
  }, [automationQueue, workspaceSummaries]);

  const visibleReportAutomationStarters = useMemo(() => {
    return reportAutomationStarterSummaries.filter(
      (starter) =>
        matchesReportPersona([starter.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          starter.title,
          starter.audience,
          starter.outcome,
          starter.setupTime,
          starter.trigger,
          starter.primaryAction,
          starter.commandKeywords,
          starter.reports.map((report) => report.name).join(" "),
          starter.playbooks.map((playbook) => playbook.title).join(" "),
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportAutomationStarterSummaries]);

  const reportAutomationTriggerRuleSummaries = useMemo(() => {
    return reportAutomationTriggerRules.flatMap((rule) => {
      const workspace = workspaceSummaries.find((item) => item.persona === rule.persona);
      if (!workspace) return [];

      const reports = rule.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const primaryReport = reports[0] ?? null;
      const automationStarter =
        reportAutomationStarterSummaries.find(
          (starter) => starter.id === rule.automationStarterId
        ) ?? null;
      const decisionShortcut =
        reportDecisionShortcutSummaries.find(
          (shortcut) => shortcut.id === rule.decisionShortcutId
        ) ?? null;
      const queueSignals =
        automationStarter?.queueSignals.filter((signal) =>
          matchesReportPersona(signal.personas, rule.persona)
        ) ?? [];
      const openSignals = queueSignals.filter((signal) => signal.count > 0);
      const openWorkItemCount = queueSignals.reduce((sum, signal) => sum + signal.count, 0);
      const amountAtRisk = queueSignals.reduce((sum, signal) => sum + (signal.amount ?? 0), 0);

      return [
        {
          ...rule,
          workspace,
          reports,
          primaryReport,
          automationStarter,
          decisionShortcut,
          queueSignals,
          openSignals,
          openWorkItemCount,
          amountAtRisk,
          href: reportAutomationTriggerRuleHref(rule),
          primaryReportHref: primaryReport
            ? (reportPersonaHref(primaryReport, rule.persona) ??
              reportAutomationTriggerRuleHref(rule))
            : reportAutomationTriggerRuleHref(rule),
          automationStarterHref: automationStarter?.href ?? reportAutomationTriggerRuleHref(rule),
          decisionShortcutHref: decisionShortcut?.href ?? reportAutomationTriggerRuleHref(rule),
        },
      ];
    });
  }, [reportAutomationStarterSummaries, reportDecisionShortcutSummaries, workspaceSummaries]);

  const visibleReportAutomationTriggerRules = useMemo(() => {
    return reportAutomationTriggerRuleSummaries.filter(
      (rule) =>
        matchesReportPersona([rule.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          rule.title,
          rule.condition,
          rule.threshold,
          rule.cadence,
          rule.actionLabel,
          rule.commandKeywords,
          rule.reports.map((report) => report.name).join(" "),
          rule.decisionShortcut?.question,
          rule.automationStarter?.title,
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportAutomationTriggerRuleSummaries]);

  const reportDeliveryPlansQuery = useQuery<{
    subscriptions: ReportDeliveryPlanResponse[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "subscriptions"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/subscriptions`),
    ...reportQueryOptions,
    enabled: shouldLoadReportDeliveryData,
  });

  const reportDeliveryAutomationPreferencesQuery = useQuery<{
    preferences: ReportDeliveryAutomationPreferenceResponse[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "preferences"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/preferences`),
    ...reportQueryOptions,
    enabled: shouldLoadReportDeliveryData,
  });

  useEffect(() => {
    const preferences = reportDeliveryAutomationPreferencesQuery.data?.preferences;
    if (!preferences?.length) return;

    setPinnedReportDeliveryAutomationCommands((current) => {
      const next = { ...current };
      for (const preference of preferences) {
        next[preference.persona] = parseReportDeliveryAutomationCommand(
          preference.preferredDeliveryAutomationCommand
        );
      }
      return next;
    });
  }, [reportDeliveryAutomationPreferencesQuery.data?.preferences]);

  const reportDeliveryRunsQuery = useQuery<{
    runs: ReportDeliveryRunSummary[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "runs"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/runs?limit=30`),
    ...reportQueryOptions,
    enabled: shouldLoadReportDeliveryData,
  });

  const reportDeliverySchedulerHealthQuery = useQuery<{
    latestScan: ReportDeliverySchedulerScanSummary | null;
    recentScans: ReportDeliverySchedulerScanSummary[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "scheduler-health"],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/report-delivery/scheduler-health?limit=5`
      ),
    ...reportQueryOptions,
    enabled: shouldLoadReportDeliveryData,
  });

  const latestReportDeliverySchedulerScan =
    reportDeliverySchedulerHealthQuery.data?.latestScan ?? null;
  const reportDeliverySchedulerHandoffSkipCount =
    latestReportDeliverySchedulerScan?.snapshot?.skippedHandoff ??
    latestReportDeliverySchedulerScan?.snapshot?.skippedSubscriptionIds?.handoff?.length ??
    latestReportDeliverySchedulerScan?.snapshot?.handoffReviews?.length ??
    0;
  const reportDeliverySchedulerGuardrailSkips = latestReportDeliverySchedulerScan
    ? latestReportDeliverySchedulerScan.skippedPaused +
      latestReportDeliverySchedulerScan.skippedSetup
    : 0;

  const reportDeliveryPlanById = useMemo(() => {
    return new Map(
      (reportDeliveryPlansQuery.data?.subscriptions ?? []).map((plan) => [plan.id, plan])
    );
  }, [reportDeliveryPlansQuery.data?.subscriptions]);

  const reportDeliveryRunsBySubscriptionId = useMemo(() => {
    const runsBySubscription = new Map<string, ReportDeliveryRunSummary[]>();
    for (const run of reportDeliveryRunsQuery.data?.runs ?? []) {
      const existing = runsBySubscription.get(run.subscriptionId) ?? [];
      existing.push(run);
      runsBySubscription.set(run.subscriptionId, existing);
    }
    return runsBySubscription;
  }, [reportDeliveryRunsQuery.data?.runs]);

  const reportDeliverySubscriptionSummaries = useMemo(() => {
    return reportDeliverySubscriptions.flatMap((subscription) => {
      const workspace = workspaceSummaries.find((item) => item.persona === subscription.persona);
      if (!workspace) return [];
      const deliveryPlan = reportDeliveryPlanById.get(subscription.id);
      const deliveryRuns = reportDeliveryRunsBySubscriptionId.get(subscription.id) ?? [];
      const reportSuites = reportSuiteSummaries.filter(
        (suite) => suite.deliverySubscriptionId === subscription.id
      );
      const plannedReportSuites =
        deliveryPlan?.reportSuites ??
        reportSuites.map((suite) => ({
          id: suite.id,
          title: suite.title,
          workflow: suite.workflow,
          href: suite.href,
        }));

      const reports = subscription.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const readyCount = reports.filter((report) => report.status !== "planned").length;
      const packTemplate =
        reportPackTemplateSummaries.find(
          (template) => template.id === subscription.packTemplateId
        ) ?? null;
      const triggerRules = subscription.triggerRuleIds
        .map((ruleId) => reportAutomationTriggerRuleSummaries.find((rule) => rule.id === ruleId))
        .filter((rule): rule is (typeof reportAutomationTriggerRuleSummaries)[number] =>
          Boolean(rule)
        );
      const automationStarter =
        reportAutomationStarterSummaries.find(
          (starter) => starter.id === subscription.automationStarterId
        ) ?? null;
      const decisionShortcut =
        reportDecisionShortcutSummaries.find(
          (shortcut) => shortcut.id === subscription.decisionShortcutId
        ) ?? null;
      const openWorkItemCount = triggerRules.reduce((sum, rule) => sum + rule.openWorkItemCount, 0);
      const amountAtRisk = triggerRules.reduce((sum, rule) => sum + rule.amountAtRisk, 0);
      const enabled = deliveryPlan?.enabled ?? true;
      const status = !enabled
        ? "Paused"
        : openWorkItemCount > 0
          ? "Review before send"
          : (deliveryPlan?.status ?? "ready") === "setup"
            ? "Setup needed"
            : readyCount === reports.length
              ? "Ready to send"
              : "Setup needed";

      return [
        {
          ...subscription,
          enabled,
          workspace,
          reports,
          readyCount,
          packTemplate,
          triggerRules,
          automationStarter,
          decisionShortcut,
          reportSuites: plannedReportSuites,
          suiteCount: deliveryPlan?.suiteCount ?? plannedReportSuites.length,
          openWorkItemCount,
          amountAtRisk,
          cadence: deliveryPlan?.cadence ?? subscription.cadence,
          channel: deliveryPlan?.channel ?? subscription.channel,
          format: deliveryPlan?.format ?? subscription.format,
          recipients: deliveryPlan?.recipients ?? subscription.recipients,
          deliveryGuardrail: deliveryPlan?.deliveryGuardrail ?? subscription.deliveryGuardrail,
          nextRunLabel: deliveryPlan?.nextRunLabel ?? "",
          settingsSource: deliveryPlan?.settingsSource ?? "catalog",
          preview:
            deliveryPlan?.preview ??
            ({
              summary: tr("toThrough", {
                format: subscription.format,
                recipients: subscription.recipients,
                channel: subscription.channel,
              }),
              readinessLabel: tr("catalogPreview"),
              checklist: [
                {
                  label: tr("reports"),
                  status: readyCount === reports.length ? "ready" : "review",
                  detail: tr("reportsReadyForThisPack", {
                    readyCount,
                    reportsCount: reports.length,
                  }),
                },
                {
                  label: tr("guardrail"),
                  status: "ready",
                  detail: subscription.deliveryGuardrail,
                },
              ],
              reportNames: reports.map((report) => report.name),
              triggerRuleTitles: triggerRules.map((rule) => rule.title),
              suiteTitles: plannedReportSuites.map((suite) => suite.title),
            } satisfies ReportDeliveryPlanPreview),
          deliveryRuns,
          latestDeliveryRun: deliveryRuns[0] ?? null,
          href: reportDeliverySubscriptionHref(subscription),
          packTemplateHref: packTemplate?.href ?? reportDeliverySubscriptionHref(subscription),
          automationStarterHref:
            automationStarter?.href ?? reportDeliverySubscriptionHref(subscription),
          decisionShortcutHref:
            decisionShortcut?.href ?? reportDeliverySubscriptionHref(subscription),
          status,
          statusVariant:
            status === "Ready to send"
              ? ("success" as const)
              : status === "Review before send"
                ? ("warning" as const)
                : ("neutral" as const),
        },
      ];
    });
  }, [
    reportDeliveryPlanById,
    reportDeliveryRunsBySubscriptionId,
    reportAutomationStarterSummaries,
    reportAutomationTriggerRuleSummaries,
    reportDecisionShortcutSummaries,
    reportPackTemplateSummaries,
    reportSuiteSummaries,
    workspaceSummaries,
  ]);

  const reportDeliverySchedulerHandoffReviews = useMemo(() => {
    const reviews = latestReportDeliverySchedulerScan?.snapshot?.handoffReviews ?? [];
    return reviews
      .map((review) => {
        const subscription =
          reportDeliverySubscriptionSummaries.find((item) => item.id === review.subscriptionId) ??
          null;
        const workspace =
          subscription?.workspace ??
          workspaceSummaries.find((item) => item.persona === (subscription?.persona ?? "owner")) ??
          workspaceSummaries[0] ??
          null;
        if (!workspace) return null;
        const title = subscription?.title ?? review.subscriptionId;
        const href = reportWorkflowContextHref({
          persona: workspace.persona,
          tab: workspace.primaryTab,
          search: title,
          gap: review.gap,
        });

        return {
          ...review,
          title,
          href,
          subscriptionHref: subscription?.href ?? href,
          persona: workspace.persona,
          gapLabel: reportWorkflowGapFilterLabels[review.gap],
        };
      })
      .filter((review): review is NonNullable<typeof review> => Boolean(review))
      .filter(
        (review) =>
          matchesReportPersona([review.persona], personaFilter) &&
          matchesReportWorkflowSearch([
            review.title,
            review.gapLabel,
            review.detail,
            review.message,
            review.subscriptionId,
          ])
      );
  }, [
    latestReportDeliverySchedulerScan?.snapshot?.handoffReviews,
    matchesReportWorkflowSearch,
    personaFilter,
    reportDeliverySubscriptionSummaries,
    workspaceSummaries,
  ]);

  const visibleReportDeliverySubscriptions = useMemo(() => {
    return reportDeliverySubscriptionSummaries.filter(
      (subscription) =>
        matchesReportPersona([subscription.persona], personaFilter) &&
        matchesReportWorkflowSearch([
          subscription.title,
          subscription.audience,
          subscription.cadence,
          subscription.channel,
          subscription.format,
          subscription.recipients,
          subscription.deliveryGuardrail,
          subscription.commandKeywords,
          subscription.reports.map((report) => report.name).join(" "),
          subscription.packTemplate?.title,
          subscription.automationStarter?.title,
          subscription.decisionShortcut?.question,
          subscription.reportSuites.map((suite) => `${suite.title} ${suite.workflow}`).join(" "),
          subscription.preview.suiteTitles.join(" "),
        ])
    );
  }, [matchesReportWorkflowSearch, personaFilter, reportDeliverySubscriptionSummaries]);

  const allReportWorkflowFinderResults = useMemo<ReportWorkflowFinderResult[]>(() => {
    const reportIdsOverlap = (left: string[], right: string[]) => {
      return left.some((reportId) => right.includes(reportId));
    };
    const buildReportWorkflowCoverageCues = ({
      persona,
      reportIds,
      packTemplateId,
      automationStarterId,
      triggerRuleIds = [],
      deliverySubscriptionId,
    }: ReportWorkflowCoverageContext): ReportWorkflowCoverageCue[] => {
      const packTemplate =
        reportPackTemplateSummaries.find(
          (template) =>
            template.persona === persona &&
            (template.id === packTemplateId || reportIdsOverlap(template.reportIds, reportIds))
        ) ?? null;
      const triggerRule =
        reportAutomationTriggerRuleSummaries.find(
          (rule) =>
            rule.persona === persona &&
            (triggerRuleIds.includes(rule.id) ||
              rule.automationStarterId === automationStarterId ||
              reportIdsOverlap(rule.reportIds, reportIds))
        ) ?? null;
      const deliverySubscription =
        reportDeliverySubscriptionSummaries.find(
          (subscription) =>
            subscription.persona === persona &&
            (subscription.id === deliverySubscriptionId ||
              subscription.packTemplateId === packTemplateId ||
              subscription.automationStarterId === automationStarterId ||
              triggerRuleIds.some((ruleId) => subscription.triggerRuleIds.includes(ruleId)) ||
              reportIdsOverlap(subscription.reportIds, reportIds))
        ) ?? null;

      return [
        {
          id: "pack",
          label: packTemplate ? tr("pack") : tr("noPack"),
          detail: packTemplate?.title ?? tr("noReportPackTemplateCoversThis"),
          variant: packTemplate ? ("success" as const) : ("outline" as const),
        },
        {
          id: "schedule",
          label: deliverySubscription ? tr("scheduled") : tr("noSchedule"),
          detail: deliverySubscription?.cadence ?? tr("noScheduledReportSendCoversThis"),
          variant: deliverySubscription ? ("info" as const) : ("outline" as const),
        },
        {
          id: "alert",
          label: triggerRule ? tr("alertRule") : tr("noAlert"),
          detail: triggerRule?.title ?? tr("noAutomationTriggerRuleCoversThis"),
          variant: triggerRule
            ? getTriggerSeverityMeta()[triggerRule.severity].variant
            : ("outline" as const),
        },
        {
          id: "delivery",
          label: deliverySubscription ? tr("delivery") : tr("noDelivery"),
          detail: deliverySubscription
            ? `${deliverySubscription.channel} · ${deliverySubscription.format}`
            : tr("noDeliveryPathCoversThisWorkflow"),
          variant: deliverySubscription?.statusVariant ?? ("outline" as const),
        },
      ];
    };

    const reportResults = filteredReports.map((report) => {
      const reportPersona =
        personaFilter === "all" ? (report.personas[0] ?? "owner") : personaFilter;
      const context = reportActionContextByPersonaReportId.get(`${reportPersona}:${report.id}`);
      const status = getReportStatusMeta()[report.status];
      const localReportHref =
        report.href ??
        (report.tab
          ? reportsHref({ tab: report.tab, persona: reportPersona })
          : reportsHref({ persona: reportPersona }));
      const reportActionLinks: ReportWorkflowFinderAction[] = [
        {
          href:
            context?.workflowHref ??
            reportWorkflowContextHref({
              persona: reportPersona,
              tab: report.tab,
              search: report.name,
            }),
          label: tr("automate"),
          testId: `report-workflow-finder-result-automation-${report.id}`,
        },
      ];
      if (context?.comparisonPresets[0]) {
        reportActionLinks.push({
          href: context.comparisonPresets[0].href,
          label: tr("compare"),
          testId: `report-workflow-finder-result-comparison-${report.id}`,
        });
      }
      if (context?.deliverySubscriptions[0]) {
        reportActionLinks.push({
          href: context.deliverySubscriptions[0].href,
          label: tr("schedule"),
          testId: `report-workflow-finder-result-delivery-${report.id}`,
        });
      }

      return {
        id: `report-${report.id}`,
        type: "Report",
        title: report.name,
        description: report.decisionQuestion,
        meta: `${report.category} · ${report.comparison}`,
        href: context?.reportHref ?? localReportHref,
        actionLinks: reportActionLinks,
        persona: reportPersona,
        badgeVariant: status.variant,
        coverageCues: buildReportWorkflowCoverageCues({
          persona: reportPersona,
          reportIds: [report.id],
        }),
      };
    });

    const packTemplateResults = visibleReportPackTemplates.map((template) => ({
      id: `pack-template-${template.id}`,
      type: "Pack",
      title: template.title,
      description: template.outcome,
      meta: `${template.cadence} · ${template.delivery}`,
      href: template.href,
      persona: template.persona,
      badgeVariant: "outline" as const,
      coverageCues: buildReportWorkflowCoverageCues({
        persona: template.persona,
        reportIds: template.reportIds,
        packTemplateId: template.id,
      }),
    }));

    const comparisonResults = visibleReportComparisonPresets.map((preset) => ({
      id: `comparison-preset-${preset.id}`,
      type: "Comparison",
      title: preset.title,
      description: preset.question,
      meta: `${preset.baseline} · ${preset.metrics.length} metrics`,
      href: preset.href,
      persona: preset.persona,
      badgeVariant: preset.warningCount > 0 ? ("warning" as const) : ("success" as const),
      coverageCues: buildReportWorkflowCoverageCues({
        persona: preset.persona,
        reportIds: preset.reportIds,
      }),
    }));

    const suiteResults = visibleReportSuiteSummaries.map((suite) => ({
      id: `report-suite-${suite.id}`,
      type: "Suite",
      title: suite.title,
      description: suite.outcome,
      meta: `${suite.workflow} · ${suite.readyCount}/${suite.reports.length} reports`,
      href: suite.href,
      persona: suite.persona,
      badgeVariant:
        suite.readyCount === suite.reports.length ? ("success" as const) : ("warning" as const),
      coverageCues: buildReportWorkflowCoverageCues({
        persona: suite.persona,
        reportIds: suite.reportIds,
        packTemplateId: suite.packTemplateId,
        automationStarterId: suite.automationStarterId,
        triggerRuleIds: suite.triggerRuleIds,
        deliverySubscriptionId: suite.deliverySubscriptionId,
      }),
    }));

    const managementBriefResults = visibleReportManagementBriefSummaries.map((brief) => ({
      id: `management-brief-${brief.id}`,
      type: "Brief",
      title: brief.title,
      description: brief.outcome,
      meta: `${brief.kpiMetricIds.length} KPIs · ${brief.dimensionBreakdowns.length} dimensions`,
      href: brief.href,
      persona: brief.persona,
      badgeVariant:
        brief.readyCount === brief.reports.length ? ("success" as const) : ("warning" as const),
      coverageCues: buildReportWorkflowCoverageCues({
        persona: brief.persona,
        reportIds: brief.reportIds,
        packTemplateId: brief.packTemplateId,
        automationStarterId: brief.automationStarterId,
        triggerRuleIds: brief.reportSuite.triggerRuleIds,
        deliverySubscriptionId: brief.deliverySubscriptionId,
      }),
    }));

    const savedViewResults = visibleReportSavedViewSummaries.map((view) => ({
      id: `saved-view-${view.id}`,
      type: "Saved view",
      title: view.title,
      description: view.description,
      meta: `${view.dateRangePreset} · ${view.comparisonPeriod} · ${view.currency}`,
      href: view.href,
      persona: view.persona,
      badgeVariant: "info" as const,
      coverageCues: buildReportWorkflowCoverageCues({
        persona: view.persona,
        reportIds: [view.reportId],
        automationStarterId: view.automationStarterId,
      }),
    }));

    const automationStarterResults = visibleReportAutomationStarters.map((starter) => ({
      id: `automation-starter-${starter.id}`,
      type: "Automation",
      title: starter.title,
      description: starter.outcome,
      meta: `${starter.setupTime} · ${starter.primaryAction}`,
      href: starter.href,
      persona: starter.persona,
      badgeVariant: starter.openWorkItemCount > 0 ? ("warning" as const) : ("success" as const),
      coverageCues: buildReportWorkflowCoverageCues({
        persona: starter.persona,
        reportIds: starter.reportIds,
        automationStarterId: starter.id,
      }),
    }));

    const deliveryResults = visibleReportDeliverySubscriptions.map((subscription) => ({
      id: `delivery-subscription-${subscription.id}`,
      type: "Delivery",
      title: subscription.title,
      description: subscription.deliveryGuardrail,
      meta: `${subscription.cadence} · ${subscription.channel}`,
      href: subscription.href,
      persona: subscription.persona,
      badgeVariant: subscription.statusVariant,
      coverageCues: buildReportWorkflowCoverageCues({
        persona: subscription.persona,
        reportIds: subscription.reportIds,
        packTemplateId: subscription.packTemplateId,
        automationStarterId: subscription.automationStarterId,
        triggerRuleIds: subscription.triggerRuleIds,
        deliverySubscriptionId: subscription.id,
      }),
    }));

    const triggerRuleResults = visibleReportAutomationTriggerRules.map((rule) => ({
      id: `trigger-rule-${rule.id}`,
      type: "Trigger",
      title: rule.title,
      description: rule.condition,
      meta: `${rule.cadence} · ${rule.actionLabel}`,
      href: rule.href,
      persona: rule.persona,
      badgeVariant: getTriggerSeverityMeta()[rule.severity].variant,
      coverageCues: buildReportWorkflowCoverageCues({
        persona: rule.persona,
        reportIds: rule.reportIds,
        automationStarterId: rule.automationStarterId,
        triggerRuleIds: [rule.id],
      }),
    }));

    const decisionShortcutResults = visibleReportDecisionShortcuts.map((shortcut) => ({
      id: `decision-shortcut-${shortcut.id}`,
      type: "Question",
      title: shortcut.question,
      description: shortcut.answer,
      meta: shortcut.primaryReport.name,
      href: shortcut.href,
      persona: shortcut.persona,
      badgeVariant: "info" as const,
      coverageCues: buildReportWorkflowCoverageCues({
        persona: shortcut.persona,
        reportIds: shortcut.reportIds,
        automationStarterId: shortcut.automationStarterId,
      }),
    }));

    return [
      ...reportResults,
      ...packTemplateResults,
      ...comparisonResults,
      ...suiteResults,
      ...managementBriefResults,
      ...savedViewResults,
      ...automationStarterResults,
      ...deliveryResults,
      ...triggerRuleResults,
      ...decisionShortcutResults,
    ];
  }, [
    filteredReports,
    personaFilter,
    reportAutomationTriggerRuleSummaries,
    reportActionContextByPersonaReportId,
    reportDeliverySubscriptionSummaries,
    reportPackTemplateSummaries,
    visibleReportAutomationStarters,
    visibleReportAutomationTriggerRules,
    visibleReportComparisonPresets,
    visibleReportDecisionShortcuts,
    visibleReportDeliverySubscriptions,
    visibleReportManagementBriefSummaries,
    visibleReportPackTemplates,
    visibleReportSavedViewSummaries,
    visibleReportSuiteSummaries,
  ]);

  const filteredReportWorkflowFinderResults = useMemo(() => {
    if (reportWorkflowGapFilter.type === "all") return allReportWorkflowFinderResults;

    return allReportWorkflowFinderResults.filter((result) => {
      return (
        result.persona === reportWorkflowGapFilter.persona &&
        matchesReportWorkflowGapFilter(result, reportWorkflowGapFilter.type)
      );
    });
  }, [allReportWorkflowFinderResults, reportWorkflowGapFilter]);

  const activeReportWorkflowGapFilterLabel = useMemo(() => {
    if (reportWorkflowGapFilter.type === "all" || !reportWorkflowGapFilter.persona) return "";
    const workspace = reportPersonaWorkspaces.find(
      (item) => item.persona === reportWorkflowGapFilter.persona
    );
    return `${reportWorkflowGapFilterLabels[reportWorkflowGapFilter.type]} · ${
      workspace?.navLabel ?? reportWorkflowGapFilter.persona
    }`;
  }, [reportWorkflowGapFilter]);
  const reportWorkflowContextSearchLabel = reportWorkflowSearch.trim();
  const hasReportWorkflowContextFilters =
    personaFilter !== "all" ||
    Boolean(reportWorkflowContextSearchLabel) ||
    reportWorkflowGapFilter.type !== "all";
  const reportWorkflowContextSharePersona: PersonaFilter =
    reportWorkflowGapFilter.persona ?? personaFilter;
  const reportWorkflowContextShareHref = useMemo(
    () =>
      reportWorkflowContextHref({
        persona: reportWorkflowContextSharePersona,
        tab: activeTab,
        search: reportWorkflowContextSearchLabel,
        gap: reportWorkflowGapFilter.type === "all" ? null : reportWorkflowGapFilter.type,
      }),
    [
      activeTab,
      reportWorkflowContextSearchLabel,
      reportWorkflowContextSharePersona,
      reportWorkflowGapFilter.type,
    ]
  );
  const reportWorkflowFinderResults = useMemo(() => {
    if (normalizedReportWorkflowSearch || reportWorkflowGapFilter.type !== "all") {
      return filteredReportWorkflowFinderResults.slice(0, 12);
    }

    const preferredTypes = [
      "Report",
      tr("pack"),
      tr("brief"),
      tr("comparison"),
      "Automation",
      tr("delivery"),
      tr("question"),
    ];
    return preferredTypes
      .flatMap((type) =>
        filteredReportWorkflowFinderResults.filter((result) => result.type === type).slice(0, 2)
      )
      .slice(0, 12);
  }, [
    filteredReportWorkflowFinderResults,
    normalizedReportWorkflowSearch,
    reportWorkflowGapFilter.type,
  ]);

  const reportDeliveryRunStatusCounts = useMemo(() => {
    const counts: Record<ReportDeliveryRunStatusFilter, number> = {
      all: 0,
      queued: 0,
      sent: 0,
      failed: 0,
    };

    for (const subscription of visibleReportDeliverySubscriptions) {
      for (const run of subscription.deliveryRuns) {
        counts.all += 1;
        if (run.status === "queued" || run.status === "sent" || run.status === "failed") {
          counts[run.status] += 1;
        }
      }
    }

    return counts;
  }, [visibleReportDeliverySubscriptions]);

  const reportDeliveryRunTimelineRows = useMemo(() => {
    return visibleReportDeliverySubscriptions
      .flatMap((subscription) =>
        subscription.deliveryRuns.map((run) => ({
          ...run,
          persona: subscription.persona,
          workspaceLabel: subscription.workspace.navLabel,
          subscriptionTitle: subscription.title,
          subscriptionHref: subscription.href,
        }))
      )
      .filter((run) =>
        matchesReportDeliveryRunStatusFilter(run.status, reportDeliveryRunStatusFilter)
      )
      .sort(
        (first, second) =>
          new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()
      )
      .slice(0, 6);
  }, [reportDeliveryRunStatusFilter, visibleReportDeliverySubscriptions]);

  const reportDeliveryRecoverySummary = useMemo(() => {
    const failedRuns = visibleReportDeliverySubscriptions
      .flatMap((subscription) =>
        subscription.deliveryRuns
          .filter((run) => run.status === "failed")
          .map((run) => ({
            ...run,
            subscriptionTitle: subscription.title,
            subscriptionHref: subscription.href,
          }))
      )
      .sort(
        (first, second) =>
          new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()
      );
    const retryableSubscriptionCount = new Set(failedRuns.map((run) => run.subscriptionId)).size;
    const reviewSubscriptions = visibleReportDeliverySubscriptions.filter(
      (subscription) => subscription.status !== "Ready to send"
    );
    const latestFailedRun = failedRuns[0] ?? null;
    const firstReviewSubscription = reviewSubscriptions[0] ?? null;

    return {
      failedRunCount: failedRuns.length,
      retryableSubscriptionCount,
      reviewSubscriptionCount: reviewSubscriptions.length,
      nextAction: latestFailedRun
        ? {
            kind: "retry" as const,
            label: tr("retryLatestFailedDelivery"),
            detail: tr("failedRetryAfterConfirmingRecipientsAnd", {
              subscriptionTitle: latestFailedRun.subscriptionTitle,
              formatDeliveryRunTimestamp: formatDeliveryRunTimestamp(latestFailedRun.createdAt),
            }),
            runId: latestFailedRun.id,
            badge: tr("recovery"),
            badgeVariant: "destructive" as const,
          }
        : firstReviewSubscription
          ? {
              kind: "open" as const,
              label: tr("reviewDeliveryGuardrails"),
              detail: tr("needsReviewBeforeTheNextAutomated", {
                title: firstReviewSubscription.title,
              }),
              href: firstReviewSubscription.href,
              badge: "Review",
              badgeVariant: "warning" as const,
            }
          : {
              kind: "ready" as const,
              label: tr("keepScheduledSendsRunning"),
              detail:
                visibleReportDeliverySubscriptions.length > 0
                  ? tr("deliverySubscriptionsAreReadyForThis", {
                      visibleReportDeliverySubscriptionsCount:
                        visibleReportDeliverySubscriptions.length,
                    })
                  : tr("noDeliverySubscriptionsMatchThisView"),
              badge: "Ready",
              badgeVariant: "success" as const,
            },
    };
  }, [visibleReportDeliverySubscriptions]);

  const reportDeliveryAutomationCommandTargets = useMemo(() => {
    const nextAction = reportDeliveryRecoverySummary.nextAction;
    const reviewSubscription =
      visibleReportDeliverySubscriptions.find(
        (subscription) => subscription.status !== "Ready to send"
      ) ?? null;
    const queueSubscription =
      visibleReportDeliverySubscriptions.find(
        (subscription) => subscription.enabled && subscription.status === "Ready to send"
      ) ??
      visibleReportDeliverySubscriptions.find((subscription) => subscription.enabled) ??
      null;
    const comparisonPreset =
      visibleReportComparisonPresets
        .slice()
        .sort(
          (first, second) =>
            second.warningCount - first.warningCount || first.title.localeCompare(second.title)
        )[0] ?? null;

    return {
      retryRunId: nextAction.kind === "retry" ? (nextAction.runId ?? null) : null,
      reviewSubscription,
      queueSubscription,
      comparisonPreset,
    };
  }, [
    reportDeliveryRecoverySummary.nextAction,
    visibleReportComparisonPresets,
    visibleReportDeliverySubscriptions,
  ]);

  const startEditingReportDeliverySubscription = useCallback(
    (subscription: (typeof reportDeliverySubscriptionSummaries)[number]) => {
      setEditingReportDeliverySubscriptionId(subscription.id);
      setReportDeliverySettingsDraft({
        cadence: subscription.cadence,
        channel: subscription.channel,
        format: subscription.format,
        recipients: subscription.recipients,
        deliveryGuardrail: subscription.deliveryGuardrail,
      });
    },
    []
  );

  const updateReportDeliverySettingsDraft = useCallback(
    (field: keyof ReportDeliverySettingsDraft, value: string) => {
      setReportDeliverySettingsDraft((current) => ({ ...current, [field]: value }));
    },
    []
  );

  const reportPackAutomationQueue = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const signals = automationQueue.filter((item) =>
        matchesReportPersona(item.personas, workspace.persona)
      );
      const openSignals = signals.filter((item) => item.count > 0);
      const openWorkItemCount = signals.reduce((sum, item) => sum + item.count, 0);
      const amountAtRisk = signals.reduce((sum, item) => sum + (item.amount ?? 0), 0);

      return {
        workspace,
        signals,
        openSignals,
        openSignalCount: openSignals.length,
        openWorkItemCount,
        amountAtRisk,
        status: openSignals.length > 0 ? "Review before send" : "Ready to send",
      };
    });
  }, [automationQueue, workspaceSummaries]);

  const visibleReportPackAutomation = useMemo(() => {
    return reportPackAutomationQueue.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportPackAutomationQueue]);

  const reportPacksNeedingReview = visibleReportPackAutomation.filter(
    (item) => item.openSignalCount > 0
  ).length;

  const automationCoverageSummary = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const liveReports = workspace.reports.filter((report) => report.status === "live");
      const automatedSignals = Array.from(new Set(liveReports.map((report) => report.automation)));
      const comparisonTypes = new Set(liveReports.map((report) => report.comparison));
      const workflowReportCount = liveReports.filter((report) => reportHref(report)).length;
      const queueSignals = automationQueue.filter((item) =>
        matchesReportPersona(item.personas, workspace.persona)
      );
      const openSignals = queueSignals.filter((item) => item.count > 0);
      const openWorkItemCount = queueSignals.reduce((sum, item) => sum + item.count, 0);
      const amountAtRisk = queueSignals.reduce((sum, item) => sum + (item.amount ?? 0), 0);

      return {
        workspace,
        liveReportCount: liveReports.length,
        comparisonTypeCount: comparisonTypes.size,
        automatedSignalCount: automatedSignals.length,
        workflowReportCount,
        playbookCount: workspace.automations.length,
        openSignalCount: openSignals.length,
        openWorkItemCount,
        amountAtRisk,
        topSignals: automatedSignals.slice(0, 4),
        status: openSignals.length > 0 ? "Needs review" : "Ready",
      };
    });
  }, [automationQueue, workspaceSummaries]);

  const visibleAutomationCoverage = useMemo(() => {
    return automationCoverageSummary.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [automationCoverageSummary, personaFilter]);

  const reportRoadmap = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const prioritizedPlannedReports = workspace.plannedReports
        .slice()
        .sort(
          (a, b) =>
            (b.roadmapPriority?.score ?? 0) - (a.roadmapPriority?.score ?? 0) ||
            a.name.localeCompare(b.name)
        );
      const plannedAutomationHooks = Array.from(
        new Set(prioritizedPlannedReports.map((report) => report.automation))
      );
      const plannedCategories = Array.from(
        new Set(prioritizedPlannedReports.map((report) => report.category))
      );
      const plannedWorkflowDependencies = Array.from(
        new Set(
          prioritizedPlannedReports
            .map((report) => report.roadmapPrerequisites?.workflowDependency)
            .filter((dependency): dependency is string => Boolean(dependency))
        )
      );
      const nextReports = prioritizedPlannedReports.slice(0, 4);
      const topPriorityReport = nextReports[0] ?? null;
      const topPriorityImpact =
        topPriorityReport?.roadmapPriority?.impactByPersona[workspace.persona];

      return {
        workspace,
        plannedReports: prioritizedPlannedReports,
        nextReports,
        plannedAutomationHooks,
        plannedCategories,
        plannedWorkflowDependencies,
        topPriorityReport,
        topPriorityImpact,
        topPriorityScore: topPriorityReport?.roadmapPriority?.score ?? 0,
        liveReportCount: workspace.reports.length - workspace.plannedReports.length,
        plannedReportCount: workspace.plannedReports.length,
        prerequisiteCount: workspace.plannedReports.filter((report) => report.roadmapPrerequisites)
          .length,
        roadmapStatus:
          workspace.plannedReports.length > 0 ? tr("roadmapGaps") : tr("coverageComplete"),
        nextWorkflow:
          nextReports.length > 0
            ? (reportPersonaHref(nextReports[0], workspace.persona) ??
              reportWorkspaceHref(workspace))
            : reportWorkspaceHref(workspace),
      };
    });
  }, [workspaceSummaries]);

  const visibleReportRoadmap = useMemo(() => {
    return reportRoadmap.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportRoadmap]);

  const visiblePlannedReportCount = visibleReportRoadmap.reduce(
    (sum, item) => sum + item.plannedReportCount,
    0
  );

  const localReportProductDepthAreas = useMemo<ReportCatalogDiscovery["productDepthAreas"]>(() => {
    return reportProductDepthAreas.map((area) => ({
      ...area,
      href: reportProductDepthAreaHref(area),
      subgoals: area.subgoals.map((subgoal) => ({
        ...subgoal,
        href: reportProductDepthSubgoalHref(area, subgoal),
      })),
    }));
  }, []);

  const reportProductDepthCoverage: ReportCatalogDiscovery["productDepthAreas"] =
    reportCatalogDiscoveryQuery.data?.productDepthAreas ?? localReportProductDepthAreas;

  const visibleReportProductDepthAreas = useMemo<
    ReportCatalogDiscovery["productDepthAreas"]
  >(() => {
    return reportProductDepthCoverage
      .map((area) => ({
        ...area,
        subgoals: area.subgoals
          .filter((subgoal) => matchesReportPersona(subgoal.personas, personaFilter))
          .map((subgoal) => ({
            ...subgoal,
            sourceDrilldownTargets: subgoal.sourceDrilldownTargets?.filter((target) =>
              matchesReportPersona(target.personas, personaFilter)
            ),
          })),
      }))
      .filter((area) => area.subgoals.length > 0);
  }, [personaFilter, reportProductDepthCoverage]);

  const visibleReportProductDepthSubgoalCount = visibleReportProductDepthAreas.reduce(
    (sum, area) => sum + area.subgoals.length,
    0
  );

  const personaReportRecommendations = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const recommendations: Array<{
        id: string;
        title: string;
        detail: string;
        badge: string;
        badgeVariant: BadgeProps["variant"];
        amount?: number;
        tab?: ReportTab;
        href?: string;
      }> = [];

      const queueItems = automationQueue
        .filter((item) => matchesReportPersona(item.personas, workspace.persona))
        .filter((item) => item.count > 0)
        .sort((a, b) => {
          const amountDelta = (b.amount ?? 0) - (a.amount ?? 0);
          return Math.abs(amountDelta) > 0.005 ? amountDelta : b.count - a.count;
        });

      for (const item of queueItems.slice(0, 2)) {
        recommendations.push({
          id: `queue-${workspace.persona}-${item.id}`,
          title: item.title,
          detail: item.detail,
          badge: `${item.count} open`,
          badgeVariant: "warning",
          amount: item.amount,
          tab: item.tab,
          href: item.href,
        });
      }

      const comparisonItems = comparisonRows
        .filter((row) => matchesReportPersona(row.personas, workspace.persona))
        .filter((row) => Math.abs(row.delta) > 0.005)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

      for (const row of comparisonItems) {
        if (recommendations.length >= 3) break;
        if (recommendations.some((item) => item.tab === row.tab && !item.href)) continue;

        recommendations.push({
          id: `comparison-${workspace.persona}-${row.id}`,
          title: row.label,
          detail: tr("vsBaseline", {
            signal: row.signal,
            formatComparisonPercent: formatComparisonPercent(row.percentChange),
          }),
          badge: tr("movement"),
          badgeVariant: comparisonBadgeVariant(row),
          amount: row.delta,
          tab: row.tab,
        });
      }

      if (workspace.topReadyReport && recommendations.length < 3) {
        recommendations.push({
          id: `primary-${workspace.persona}-${workspace.topReadyReport.id}`,
          title: workspace.topReadyReport.name,
          detail: workspace.topReadyReport.automation,
          badge: getReportStatusMeta()[workspace.topReadyReport.status].label,
          badgeVariant: getReportStatusMeta()[workspace.topReadyReport.status].variant,
          tab: workspace.topReadyReport.tab,
          href: workspace.topReadyReport.href,
        });
      }

      return {
        workspace,
        recommendations: recommendations.slice(0, 3),
      };
    });
  }, [automationQueue, comparisonRows, workspaceSummaries]);

  const visiblePersonaRecommendations = useMemo(() => {
    return personaReportRecommendations.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, personaReportRecommendations]);

  const reportPackDeliveryReadiness = useMemo(() => {
    return reportPackAutomationQueue.map((pack) => {
      const workspace = pack.workspace;
      const packComparisonRows = comparisonRows.filter((row) =>
        matchesReportPersona(row.personas, workspace.persona)
      );
      const comparisonWarnings = packComparisonRows.filter(
        (row) => comparisonBadgeVariant(row) === "warning"
      ).length;
      const recommendationCount =
        personaReportRecommendations.find((item) => item.workspace.persona === workspace.persona)
          ?.recommendations.length ?? 0;
      const plannedReportCount = workspace.reports.length - workspace.readyReports;
      const checks = [
        {
          id: "ready-reports",
          label: tr("reportDataRefreshed"),
          detail: tr("readyApiBackedReportsFor", {
            readyReports: workspace.readyReports,
            title: workspace.title,
          }),
          status: workspace.readyReports > 0 ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "comparison-snapshot",
          label: tr("comparisonSnapshotAttached"),
          detail: tr("currentVsPriorSignalsInThe", {
            packComparisonRowsCount: packComparisonRows.length,
          }),
          status: packComparisonRows.length > 0 ? "Ready" : "Review",
          workflow: reportsHref({ tab: workspace.primaryTab, persona: workspace.persona }),
        },
        {
          id: "recommended-actions",
          label: tr("recommendedActionsRanked"),
          detail: tr("nextBestReportActionsIncluded", { recommendationCount }),
          status: recommendationCount > 0 ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "automation-review",
          label: tr("automationExceptionsReviewed"),
          detail:
            pack.openWorkItemCount > 0
              ? tr("openWorkItemsBeforeDelivery", { openWorkItemCount: pack.openWorkItemCount })
              : tr("noOpenAutomationWorkItems"),
          status: pack.openWorkItemCount > 0 ? "Review" : "Ready",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "delivery-cadence",
          label: tr("deliveryCadenceConfigured"),
          detail: workspace.packSchedule.cadence,
          status: workspace.packSchedule.cadence ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "recipients",
          label: tr("recipientsConfigured"),
          detail: workspace.packSchedule.recipients,
          status: workspace.packSchedule.recipients ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
      ];
      const reviewCount = checks.filter((check) => check.status === "Review").length;
      const automationHealth = calculateReportAutomationHealth({
        readinessPercent: workspace.readiness,
        automationLaneCount: workspace.automationCount,
        comparisonMetricCount: packComparisonRows.length,
        comparisonWarningCount: comparisonWarnings,
        plannedReportCount,
        reviewSignalCount: reviewCount + comparisonWarnings + plannedReportCount,
      });

      return {
        workspace,
        checks,
        reviewCount,
        automationHealth,
        status: reviewCount > 0 ? "Review before send" : "Ready to send",
      };
    });
  }, [comparisonRows, personaReportRecommendations, reportPackAutomationQueue]);

  useEffect(() => {
    if (!reportPackDeliveryReadiness.length) return;

    const timer = window.setTimeout(() => {
      setReportAutomationHealthHistory(
        recordReportAutomationHealthSnapshots(
          reportPackDeliveryReadiness.map((item) => ({
            persona: item.workspace.persona,
            health: item.automationHealth,
          }))
        )
      );
    }, 0);

    return () => window.clearTimeout(timer);
  }, [reportPackDeliveryReadiness]);

  const reportAutomationHealthTrends = useMemo(() => {
    return reportPackDeliveryReadiness.map((item) => ({
      workspace: item.workspace,
      trend: buildReportAutomationHealthTrend(
        reportAutomationHealthHistory,
        item.workspace.persona,
        item.automationHealth
      ),
    }));
  }, [reportAutomationHealthHistory, reportPackDeliveryReadiness]);

  const visibleReportPackReadiness = useMemo(() => {
    return reportPackDeliveryReadiness.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportPackDeliveryReadiness]);

  const visibleReportAutomationHealthTrends = useMemo(() => {
    return reportAutomationHealthTrends.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportAutomationHealthTrends]);

  const reportAutomationRules = useMemo(() => {
    return workspaceSummaries.flatMap((workspace) => {
      const workspaceSignals = automationQueue.filter((item) =>
        matchesReportPersona(item.personas, workspace.persona)
      );

      return workspace.automations.map((playbook) => {
        const linkedReports = playbook.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId))
          .filter((report): report is (typeof reportCatalog)[number] => Boolean(report));
        const liveReportCount = linkedReports.filter((report) => report.status === "live").length;
        const targetWorkflow = reportAutomationPlaybookHref(playbook, workspace.persona);
        const runbookSteps = buildReportAutomationRunbookSteps(workspace, playbook);
        const matchingSignals = workspaceSignals.filter((signal) => {
          if (playbook.href && signal.href === playbook.href) return true;
          if (playbook.tab && signal.tab === playbook.tab) return true;
          return linkedReports.some((report) => report.tab && report.tab === signal.tab);
        });
        const openSignals = matchingSignals.filter((signal) => signal.count > 0);
        const openWorkItemCount = matchingSignals.reduce((sum, signal) => sum + signal.count, 0);
        const amountAtRisk = matchingSignals.reduce((sum, signal) => sum + (signal.amount ?? 0), 0);
        const comparisonMetricCount = comparisonRows.filter(
          (row) =>
            matchesReportPersona(row.personas, workspace.persona) &&
            linkedReports.some((report) => report.tab === row.tab)
        ).length;
        const status =
          openWorkItemCount > 0
            ? "Review before auto-send"
            : liveReportCount === linkedReports.length
              ? "Ready to auto-send"
              : "Setup needed";

        return {
          id: `${workspace.persona}-${playbook.id}`,
          workspace,
          playbook,
          linkedReports,
          liveReportCount,
          reportCount: linkedReports.length,
          matchingSignals,
          openSignals,
          runbookSteps,
          openWorkItemCount,
          amountAtRisk,
          comparisonMetricCount,
          targetWorkflow,
          status,
          statusVariant:
            status === "Ready to auto-send"
              ? ("success" as const)
              : status === "Review before auto-send"
                ? ("warning" as const)
                : ("neutral" as const),
        };
      });
    });
  }, [automationQueue, comparisonRows, workspaceSummaries]);

  const visibleReportAutomationRules = useMemo(() => {
    return reportAutomationRules.filter((rule) =>
      matchesReportPersona([rule.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportAutomationRules]);

  const reportAutomationRuleReviewCount = visibleReportAutomationRules.filter(
    (rule) => rule.openWorkItemCount > 0 || rule.status === "Setup needed"
  ).length;

  const reportAutomationCommandCenter = useMemo(() => {
    const readyRuleCount = visibleReportAutomationRules.filter(
      (rule) => rule.status === "Ready to auto-send"
    ).length;
    const reviewRuleCount = visibleReportAutomationRules.filter(
      (rule) => rule.openWorkItemCount > 0
    ).length;
    const setupRuleCount = visibleReportAutomationRules.filter(
      (rule) => rule.status === "Setup needed"
    ).length;
    const openWorkItemCount = visibleReportAutomationRules.reduce(
      (sum, rule) => sum + rule.openWorkItemCount,
      0
    );
    const amountAtRisk = visibleReportAutomationRules.reduce(
      (sum, rule) => sum + rule.amountAtRisk,
      0
    );
    const comparisonMetricCount = visibleReportAutomationRules.reduce(
      (sum, rule) => sum + rule.comparisonMetricCount,
      0
    );
    const reportBundleCount = new Set(
      visibleReportAutomationRules.flatMap((rule) => rule.linkedReports.map((report) => report.id))
    ).size;
    const autoSendCoveragePercent =
      visibleReportAutomationRules.length > 0
        ? Math.round((readyRuleCount / visibleReportAutomationRules.length) * 100)
        : 0;
    const readyPackCount = visibleReportPackReadiness.filter(
      (item) => item.reviewCount === 0
    ).length;
    const reviewPackCount = visibleReportPackReadiness.filter(
      (item) => item.reviewCount > 0
    ).length;
    const topReviewRules = visibleReportAutomationRules
      .filter((rule) => rule.openWorkItemCount > 0 || rule.status === "Setup needed")
      .sort(
        (a, b) =>
          b.openWorkItemCount - a.openWorkItemCount ||
          b.amountAtRisk - a.amountAtRisk ||
          a.playbook.title.localeCompare(b.playbook.title)
      )
      .slice(0, 4);

    return {
      ruleCount: visibleReportAutomationRules.length,
      readyRuleCount,
      reviewRuleCount,
      setupRuleCount,
      openWorkItemCount,
      amountAtRisk,
      comparisonMetricCount,
      reportBundleCount,
      autoSendCoveragePercent,
      readyPackCount,
      reviewPackCount,
      topReviewRules,
    };
  }, [visibleReportAutomationRules, visibleReportPackReadiness]);

  const reportAutomationOperationSummaries = useMemo(() => {
    return workspaceSummaries.map((workspace) => {
      const packReadiness = reportPackDeliveryReadiness.find(
        (item) => item.workspace.persona === workspace.persona
      );
      const deliverySubscriptions = reportDeliverySubscriptionSummaries.filter(
        (subscription) => subscription.persona === workspace.persona
      );
      const automationRules = reportAutomationRules.filter(
        (rule) => rule.workspace.persona === workspace.persona
      );
      const recommendations =
        personaReportRecommendations.find((item) => item.workspace.persona === workspace.persona)
          ?.recommendations ?? [];
      const failedRunCount = deliverySubscriptions.reduce(
        (sum, subscription) =>
          sum + subscription.deliveryRuns.filter((run) => run.status === "failed").length,
        0
      );
      const pausedDeliveryCount = deliverySubscriptions.filter(
        (subscription) => !subscription.enabled
      ).length;
      const setupDeliveryCount = deliverySubscriptions.filter(
        (subscription) => subscription.status === "Setup needed"
      ).length;
      const readyDeliveryCount = deliverySubscriptions.filter(
        (subscription) => subscription.status === "Ready to send"
      ).length;
      const reviewDeliveryCount = deliverySubscriptions.filter(
        (subscription) => subscription.status === "Review before send"
      ).length;
      const readyRuleCount = automationRules.filter(
        (rule) => rule.status === "Ready to auto-send"
      ).length;
      const openWorkItemCount = automationRules.reduce(
        (sum, rule) => sum + rule.openWorkItemCount,
        0
      );
      const amountAtRisk = automationRules.reduce((sum, rule) => sum + rule.amountAtRisk, 0);
      const comparisonWarnings = comparisonRows.filter(
        (row) =>
          matchesReportPersona(row.personas, workspace.persona) &&
          comparisonBadgeVariant(row) === "warning"
      ).length;
      const reportCount = workspace.reports.length;
      const reportGapCount = Math.max(0, reportCount - workspace.readyReports);
      const deliveryIssueCount =
        failedRunCount + pausedDeliveryCount + setupDeliveryCount + reviewDeliveryCount;
      const automationScore = packReadiness?.automationHealth.score ?? workspace.readiness;
      const automationHealthVariant =
        packReadiness?.automationHealth.variant ??
        (workspace.readiness >= 85 ? "success" : workspace.readiness >= 60 ? "warning" : "danger");

      const nextAction =
        failedRunCount > 0
          ? {
              label: tr("recoverFailedDelivery"),
              detail: tr.plural("failedRunsCanBeRetried", failedRunCount),
              href: reportSectionHref(workspace, "delivery-subscriptions"),
              badge: tr("recovery"),
              badgeVariant: "danger" as const,
            }
          : deliveryIssueCount > 0
            ? {
                label: tr("reviewDeliverySetup"),
                detail: tr.plural("deliverySubscriptionsNeedSetup", deliveryIssueCount),
                href: reportSectionHref(workspace, "delivery-subscriptions"),
                badge: tr("delivery"),
                badgeVariant: "warning" as const,
              }
            : openWorkItemCount > 0
              ? {
                  label: tr("clearAutomationQueue"),
                  detail: tr.plural("openWorkItemsShouldBeResolved", openWorkItemCount),
                  href: reportSectionHref(workspace, "automation-command-center"),
                  badge: tr("workQueue"),
                  badgeVariant: "warning" as const,
                }
              : comparisonWarnings > 0
                ? {
                    label: tr("reviewComparisonMovement"),
                    detail: tr.plural("comparisonSignalsNeedNote", comparisonWarnings),
                    href: reportSectionHref(workspace, "recommendations"),
                    badge: tr("movement"),
                    badgeVariant: "warning" as const,
                  }
                : {
                    label: tr("keepAutomationRunning"),
                    detail: tr("autoSendRulesAndDeliveriesAre", {
                      readyRuleCount,
                      automationRulesCount: automationRules.length,
                      readyDeliveryCount,
                      deliverySubscriptionsCount: deliverySubscriptions.length,
                    }),
                    href: reportSectionHref(workspace, "automation-command-center"),
                    badge: "Ready",
                    badgeVariant: "success" as const,
                  };

      const status =
        failedRunCount > 0
          ? "Delivery recovery"
          : deliveryIssueCount > 0 || openWorkItemCount > 0 || comparisonWarnings > 0
            ? tr("needsReview")
            : "Ready to automate";

      return {
        workspace,
        reportCount,
        readyReportCount: workspace.readyReports,
        automationScore,
        automationHealthVariant,
        automationRuleCount: automationRules.length,
        readyRuleCount,
        automationRuleGapCount: Math.max(0, automationRules.length - readyRuleCount),
        deliverySubscriptionCount: deliverySubscriptions.length,
        readyDeliveryCount,
        deliveryGapCount: Math.max(0, deliverySubscriptions.length - readyDeliveryCount),
        reportGapCount,
        failedRunCount,
        openWorkItemCount,
        amountAtRisk,
        comparisonWarnings,
        recommendationCount: recommendations.length,
        nextAction,
        status,
        statusVariant:
          status === "Ready to automate"
            ? ("success" as const)
            : status === "Delivery recovery"
              ? ("destructive" as const)
              : ("warning" as const),
      };
    });
  }, [
    comparisonRows,
    personaReportRecommendations,
    reportAutomationRules,
    reportDeliverySubscriptionSummaries,
    reportPackDeliveryReadiness,
    workspaceSummaries,
  ]);

  const visibleReportAutomationOperations = useMemo(() => {
    return reportAutomationOperationSummaries.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportAutomationOperationSummaries]);
  const reportAutomationOperationsNeedingReview = visibleReportAutomationOperations.filter(
    (item) => item.status !== "Ready to automate"
  ).length;
  const reportHomeQuickReports = useMemo(() => {
    const seenReportIds = new Set<string>();

    return visibleReportQuickAccessSummaries
      .flatMap((profile) =>
        profile.primaryReports.flatMap((entry) => {
          const key = `${profile.persona}:${entry.report.id}`;
          if (seenReportIds.has(key)) return [];
          seenReportIds.add(key);
          return [{ ...entry, profile }];
        })
      )
      .slice(0, 6);
  }, [visibleReportQuickAccessSummaries]);
  const reportHomeSuites = visibleReportSuiteSummaries.slice(0, personaFilter === "all" ? 3 : 2);
  const reportHomeSavedViews = visibleReportSavedViewSummaries.slice(0, 3);
  const reportHomeAutomationOperation = visibleReportAutomationOperations[0] ?? null;

  const reportAutomationImpactSummaries = useMemo(() => {
    return reportAutomationImpactProfiles.flatMap((profile) => {
      const workspace = workspaceSummaries.find((item) => item.persona === profile.persona);
      if (!workspace) return [];

      const operation = reportAutomationOperationSummaries.find(
        (item) => item.workspace.persona === profile.persona
      );
      const profileReports = profile.reportIds
        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
        .filter((report): report is ReportCatalogItem => Boolean(report));
      const starters = profile.automationStarterIds
        .map((starterId) => reportAutomationStarters.find((starter) => starter.id === starterId))
        .filter((starter): starter is (typeof reportAutomationStarters)[number] =>
          Boolean(starter)
        );
      const triggerRules = profile.triggerRuleIds
        .map((ruleId) => reportAutomationTriggerRules.find((rule) => rule.id === ruleId))
        .filter((rule): rule is (typeof reportAutomationTriggerRules)[number] => Boolean(rule));
      const estimate = calculateReportAutomationImpact(profile, {
        readyRuleCount: operation?.readyRuleCount ?? 0,
        readyDeliveryCount: operation?.readyDeliveryCount ?? 0,
        readyReportCount:
          operation?.readyReportCount ??
          profileReports.filter((report) => report.status !== "planned").length,
        openWorkItemCount: operation?.openWorkItemCount ?? 0,
        recommendationCount: operation?.recommendationCount ?? 0,
        amountAtRisk: operation?.amountAtRisk ?? 0,
      });

      return [
        {
          profile,
          workspace,
          estimate,
          reports: profileReports,
          starters,
          triggerRules,
          href: reportSectionHref(workspace, "automation-impact"),
          commandCenterHref: reportSectionHref(workspace, "automation-command-center"),
          starterHref: starters[0]
            ? reportAutomationStarterHref(starters[0])
            : reportWorkspaceHref(workspace),
        },
      ];
    });
  }, [reportAutomationOperationSummaries, workspaceSummaries]);
  const visibleReportAutomationImpactSummaries = useMemo(() => {
    return reportAutomationImpactSummaries.filter((item) =>
      matchesReportPersona([item.workspace.persona], personaFilter)
    );
  }, [personaFilter, reportAutomationImpactSummaries]);
  const reportAutomationImpactTotals = useMemo(() => {
    return visibleReportAutomationImpactSummaries.reduce(
      (totals, item) => ({
        estimatedMonthlyHoursSaved:
          totals.estimatedMonthlyHoursSaved + item.estimate.estimatedMonthlyHoursSaved,
        estimatedAutomatedItemCount:
          totals.estimatedAutomatedItemCount + item.estimate.estimatedAutomatedItemCount,
        reviewItemCount: totals.reviewItemCount + item.estimate.reviewItemCount,
        amountAtRisk: totals.amountAtRisk + item.estimate.amountAtRisk,
      }),
      {
        estimatedMonthlyHoursSaved: 0,
        estimatedAutomatedItemCount: 0,
        reviewItemCount: 0,
        amountAtRisk: 0,
      }
    );
  }, [visibleReportAutomationImpactSummaries]);
  const reportAccountantHandoffSummaries = useMemo(() => {
    return visibleReportAutomationOperations.map((item) => {
      const workspace = item.workspace;
      const priorityGap: ReportWorkflowGapFilter | null =
        item.failedRunCount > 0 || item.deliveryGapCount > 0
          ? "delivery-gaps"
          : item.automationRuleGapCount > 0 || item.openWorkItemCount > 0
            ? "rule-gaps"
            : item.reportGapCount > 0
              ? "report-gaps"
              : null;

      return {
        ...item,
        shareHref: reportWorkflowContextHref({
          persona: workspace.persona,
          tab: workspace.primaryTab,
          search: reportWorkflowContextSearchLabel,
          gap: priorityGap,
        }),
        gapHref: priorityGap
          ? reportWorkflowContextHref({
              persona: workspace.persona,
              tab: workspace.primaryTab,
              search: reportWorkflowContextSearchLabel,
              gap: priorityGap,
            })
          : reportWorkflowContextHref({
              persona: workspace.persona,
              tab: workspace.primaryTab,
              search: reportWorkflowContextSearchLabel,
            }),
        priorityGap,
        priorityGapLabel: priorityGap
          ? reportWorkflowGapFilterLabels[priorityGap]
          : tr("noOpenGap"),
      };
    });
  }, [reportWorkflowContextSearchLabel, visibleReportAutomationOperations]);
  const reportDeliveryHandoffPreviewByPersona = useMemo(() => {
    return reportAccountantHandoffSummaries.reduce<
      Partial<Record<ReportPersona, NonNullable<ReportDeliveryPlanPreview["handoffRows"]>>>
    >((previews, item) => {
      previews[item.workspace.persona] = [
        {
          label: tr("sharedContext"),
          value: item.status,
          status: item.status === "Ready to automate" ? "ready" : "review",
          detail: tr("reportsRulesDeliveriesReady", {
            readyReportCount: item.readyReportCount,
            reportCount: item.reportCount,
            readyRuleCount: item.readyRuleCount,
            automationRuleCount: item.automationRuleCount,
            readyDeliveryCount: item.readyDeliveryCount,
            deliverySubscriptionCount: item.deliverySubscriptionCount,
          }),
          href: item.shareHref,
        },
        {
          label: tr("priorityGap"),
          value: item.priorityGapLabel,
          status: item.priorityGap ? "review" : "ready",
          detail: tr("reportGapsRuleGapsDeliveryGaps", {
            reportGapCount: item.reportGapCount,
            automationRuleGapCount: item.automationRuleGapCount,
            deliveryGapCount: item.deliveryGapCount,
          }),
          href: item.gapHref,
        },
        {
          label: tr("nextAction"),
          value: item.nextAction.label,
          status: item.nextAction.badgeVariant === "success" ? "ready" : "review",
          detail: item.nextAction.detail,
          href: item.nextAction.href,
        },
      ];
      return previews;
    }, {});
  }, [reportAccountantHandoffSummaries]);
  const reportDeliverySubscriptionHasReviewHandoff = useCallback(
    (subscriptionId: string) => {
      const subscription = reportDeliverySubscriptionSummaries.find(
        (item) => item.id === subscriptionId
      );
      if (!subscription) return false;
      const handoffRows =
        reportDeliveryHandoffPreviewByPersona[subscription.persona] ??
        subscription.preview.handoffRows ??
        [];
      return handoffRows.some((row) => row.status === "review");
    },
    [reportDeliveryHandoffPreviewByPersona, reportDeliverySubscriptionSummaries]
  );
  const isReportDeliveryHandoffAcknowledged = useCallback(
    (subscriptionId: string) => Boolean(acknowledgedReportDeliveryHandoffGaps[subscriptionId]),
    [acknowledgedReportDeliveryHandoffGaps]
  );
  const reportDeliveryLauncherPreviewById = useMemo(() => {
    return reportDeliverySubscriptionSummaries.reduce<Record<string, ReportLaunchDeliveryPreview>>(
      (previews, subscription) => {
        const latestRun = subscription.latestDeliveryRun;
        const handoffRows = reportDeliveryHandoffPreviewByPersona[subscription.persona];
        const requiresHandoffAcknowledgement =
          handoffRows?.some((row) => row.status === "review") ?? false;
        previews[subscription.id] = {
          status: subscription.status,
          statusVariant: subscription.statusVariant,
          enabled: subscription.enabled,
          nextRunLabel: subscription.nextRunLabel,
          channel: subscription.channel,
          format: subscription.format,
          recipients: subscription.recipients,
          deliveryGuardrail: subscription.deliveryGuardrail,
          summary: subscription.preview.summary,
          suiteTitles:
            subscription.preview.suiteTitles.length > 0
              ? subscription.preview.suiteTitles
              : subscription.reportSuites.map((suite) => suite.title),
          handoffRows,
          handoffRequiresAcknowledgement: requiresHandoffAcknowledgement,
          handoffAcknowledged: Boolean(acknowledgedReportDeliveryHandoffGaps[subscription.id]),
          latestRunStatus: latestRun?.status,
          latestRunStatusVariant: latestRun
            ? deliveryRunStatusVariant(latestRun.status)
            : undefined,
          latestRunId: latestRun?.id,
          latestRunLabel: latestRun ? formatDeliveryRunTimestamp(latestRun.createdAt) : undefined,
          latestRunDetail: latestRun
            ? `Scheduled ${formatDeliveryRunTimestamp(latestRun.scheduledFor)} - ${latestRun.readyReportCount}/${latestRun.reportCount} reports - ${latestRun.channel}`
            : undefined,
          latestRunError:
            latestRun?.status === "failed"
              ? (latestRun.errorMessage ?? tr("retryAfterFixingDeliverySettingsOr"))
              : null,
          queueDisabled: !subscription.enabled,
        };
        return previews;
      },
      {}
    );
  }, [
    acknowledgedReportDeliveryHandoffGaps,
    reportDeliveryHandoffPreviewByPersona,
    reportDeliverySubscriptionSummaries,
  ]);
  const reportAutomationOperationsLoading =
    automationLoading ||
    comparisonLoading ||
    reportDeliveryPlansQuery.isLoading ||
    reportDeliveryRunsQuery.isLoading;

  const reportPackReadinessNeedingReview = visibleReportPackReadiness.filter(
    (item) => item.reviewCount > 0
  ).length;
  const reportPackReviewCount = Math.max(
    reportPacksNeedingReview,
    reportPackReadinessNeedingReview
  );

  const saveReportDeliverySubscriptionSettings = useMutation({
    mutationFn: ({ subscriptionId, ...settings }: SaveReportDeliverySubscriptionSettingsInput) => {
      if (!selectedCompanyId) throw new Error("Select a company before updating delivery.");
      return apiRequest(
        "PATCH",
        `/api/companies/${selectedCompanyId}/report-delivery/subscriptions/${subscriptionId}/settings`,
        settings
      );
    },
    onSuccess: (result: any, variables) => {
      reportDeliveryPlansQuery.refetch();
      if (variables.subscriptionId === editingReportDeliverySubscriptionId) {
        setEditingReportDeliverySubscriptionId(null);
      }
      const subscriptionTitle = result?.subscription?.title ?? tr("reportDelivery");
      const onlyToggledEnabled =
        variables.enabled !== undefined &&
        variables.cadence === undefined &&
        variables.channel === undefined &&
        variables.format === undefined &&
        variables.recipients === undefined &&
        variables.deliveryGuardrail === undefined;
      toast({
        title: onlyToggledEnabled
          ? result?.subscription?.enabled
            ? tr("reportDeliveryEnabled")
            : tr("reportDeliveryPaused")
          : tr("reportDeliverySettingsSaved"),
        description: tr("nowUsesCompanyDeliverySettings", { subscriptionTitle }),
      });
    },
    onError: (error: any) => {
      toast({
        title: tr("couldNotUpdateReportDelivery"),
        description: error?.message || tr("failedToUpdateReportDeliverySettings"),
        variant: "destructive",
      });
    },
  });

  const queueReportDeliverySubscription = useMutation({
    mutationFn: ({
      subscriptionId,
      acknowledgeHandoffGaps,
    }: {
      subscriptionId: string;
      acknowledgeHandoffGaps?: boolean;
    }) => {
      if (!selectedCompanyId) throw new Error("Select a company before queuing delivery.");
      return apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/report-delivery/subscriptions/${subscriptionId}/queue`,
        acknowledgeHandoffGaps ? { acknowledgeHandoffGaps: true } : undefined
      );
    },
    onSuccess: (result: any) => {
      reportDeliveryPlansQuery.refetch();
      reportDeliveryRunsQuery.refetch();
      reportDeliverySchedulerHealthQuery.refetch();
      const subscriptionTitle = result?.subscription?.title ?? tr("reportDelivery");
      const nextRunLabel = result?.subscription?.nextRunLabel;
      toast({
        title: tr("reportDeliveryQueued"),
        description: nextRunLabel
          ? tr("queuedFor", { subscriptionTitle, nextRunLabel })
          : tr("queuedAsAnInAppReminder", { subscriptionTitle }),
      });
    },
    onError: (error: any) => {
      reportDeliveryRunsQuery.refetch();
      reportDeliverySchedulerHealthQuery.refetch();
      toast({
        title: tr("couldNotQueueReportDelivery"),
        description: error?.message || tr("failedToQueueReportDelivery"),
        variant: "destructive",
      });
    },
  });
  const queueReportDeliverySubscriptionWithHandoffGuard = useCallback(
    (subscriptionId: string) => {
      if (
        reportDeliverySubscriptionHasReviewHandoff(subscriptionId) &&
        !isReportDeliveryHandoffAcknowledged(subscriptionId)
      ) {
        const subscription = reportDeliverySubscriptionSummaries.find(
          (item) => item.id === subscriptionId
        );
        setAcknowledgedReportDeliveryHandoffGaps((current) => ({
          ...current,
          [subscriptionId]: true,
        }));
        toast({
          title: tr("handoffGapsAcknowledged"),
          description: tr("hasReviewGapsInTheAccountant", {
            value: subscription?.title ?? "This report delivery",
          }),
        });
        return;
      }

      queueReportDeliverySubscription.mutate({
        subscriptionId,
        acknowledgeHandoffGaps: isReportDeliveryHandoffAcknowledged(subscriptionId),
      });
    },
    [
      isReportDeliveryHandoffAcknowledged,
      queueReportDeliverySubscription,
      reportDeliverySubscriptionHasReviewHandoff,
      reportDeliverySubscriptionSummaries,
      toast,
    ]
  );
  const commandQueueSubscriptionRequiresHandoffAcknowledgement = Boolean(
    reportDeliveryAutomationCommandTargets.queueSubscription &&
    reportDeliverySubscriptionHasReviewHandoff(
      reportDeliveryAutomationCommandTargets.queueSubscription.id
    ) &&
    !isReportDeliveryHandoffAcknowledged(
      reportDeliveryAutomationCommandTargets.queueSubscription.id
    )
  );

  const retryReportDeliveryRun = useMutation({
    mutationFn: (runId: string) => {
      if (!selectedCompanyId) throw new Error("Select a company before retrying delivery.");
      return apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/report-delivery/runs/${runId}/retry`
      );
    },
    onSuccess: (result: any) => {
      reportDeliveryPlansQuery.refetch();
      reportDeliveryRunsQuery.refetch();
      reportDeliverySchedulerHealthQuery.refetch();
      const subscriptionTitle = result?.subscription?.title ?? tr("reportDelivery");
      toast({
        title: tr("reportDeliveryRetryQueued"),
        description: tr("wasRequeuedAfterRecovery", { subscriptionTitle }),
      });
    },
    onError: (error: any) => {
      toast({
        title: tr("couldNotRetryReportDelivery"),
        description: error?.message || tr("failedToRetryReportDelivery"),
        variant: "destructive",
      });
    },
  });

  const exportDateRangeSuffix =
    dateRange.from && dateRange.to
      ? `_${format(dateRange.from, "yyyy-MM-dd")}_to_${format(dateRange.to, "yyyy-MM-dd")}`
      : "";

  const buildWorkspaceReportPack = (
    workspace: (typeof workspaceSummaries)[number]
  ): ExportData[] => {
    const workspaceReportIds = new Set(workspace.reports.map((report) => report.id));
    const workbookReportIds = new Set<string>();
    const workbookSheets: ExportData[] = [];

    const addSheets = (reportIds: string[], sheets: ExportData | ExportData[]) => {
      const includedReportIds = reportIds.filter((reportId) => workspaceReportIds.has(reportId));
      if (!includedReportIds.length) return;
      includedReportIds.forEach((reportId) => workbookReportIds.add(reportId));
      workbookSheets.push(...(Array.isArray(sheets) ? sheets : [sheets]));
    };

    const latestVatReturn =
      vatReturns
        .slice()
        .sort((a, b) => new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime())[0] ??
      null;
    const vatReturnRegister: ExportData = {
      sheetName: "VAT Return Register",
      columns: [
        { header: tr("periodStart"), key: "periodStart", width: 14 },
        { header: tr("periodEnd"), key: "periodEnd", width: 14 },
        { header: tr("dueDate"), key: "dueDate", width: 14 },
        { header: tr("status"), key: "status", width: 16 },
        { header: tr("outputVatAed"), key: "outputVat", width: 18 },
        { header: tr("recoverableVatAed"), key: "recoverableVat", width: 20 },
        { header: tr("payableVatAed"), key: "payableVat", width: 18 },
        { header: tr("ftaReference"), key: "ftaReference", width: 24 },
        { header: tr("paymentStatus"), key: "paymentStatus", width: 18 },
        { header: tr("paymentAmountAed"), key: "paymentAmount", width: 22 },
      ],
      rows: vatReturns.map((vatReturn) => ({
        periodStart: vatReturn.periodStart,
        periodEnd: vatReturn.periodEnd,
        dueDate: vatReturn.dueDate,
        status: vatReturn.status,
        outputVat: vatReturn.box12TotalDueTax,
        recoverableVat: vatReturn.box13RecoverableTax,
        payableVat: vatReturn.box14PayableTax,
        ftaReference: vatReturn.ftaReferenceNumber ?? "",
        paymentStatus: vatReturn.paymentStatus ?? "",
        paymentAmount: vatReturn.paymentAmount ?? "",
      })),
    };
    const periodComparisonRows = comparisonRows.filter((row) =>
      matchesReportPersona(row.personas, workspace.persona)
    );

    addSheets(["profit-loss"], prepareProfitLossForExport(profitLoss));
    addSheets(
      ["cost-center-profitability"],
      prepareCostCenterProfitabilityForExport(costCenterProfitability)
    );
    addSheets(["balance-sheet"], prepareBalanceSheetForExport(balanceSheet));
    addSheets(["cash-flow"], prepareCashFlowStatementForExport(cashFlowStatement));
    addSheets(["vat-summary"], prepareVATSummaryForExport(vatSummary));
    addSheets(
      ["vat-return"],
      [
        vatReturnRegister,
        ...(latestVatReturn ? prepareVat201ForExport(latestVatReturn, selectedCompany) : []),
      ]
    );
    addSheets(
      ["period-comparison"],
      preparePeriodComparisonForExport(
        periodComparisonRows.length ? periodComparisonRows : advancedPeriodComparison
      )
    );
    addSheets(
      ["ar-aging", "ap-aging"],
      prepareAgingReportsForExport({ receivables: agingReport, payables: billAgingReport })
    );
    addSheets(
      ["corporate-tax-estimate"],
      prepareCorporateTaxEstimateForExport(corporateTaxEstimate)
    );
    addSheets(["fx-gains-losses"], prepareFxGainsLossesForExport(fxGainsLosses));
    addSheets(["trial-balance"], prepareTrialBalanceForExport(trialBalance));
    addSheets(
      ["invoice-status", "revenue-customer", "sales-product-service"],
      prepareInvoiceStatusForExport(invoiceStatusReport)
    );
    addSheets(
      [
        "customer-balances",
        "vendor-balances",
        "inventory-valuation",
        "inventory-movement",
        "fixed-asset-register",
        "depreciation-schedule",
      ],
      prepareBalanceSummaryReportsForExport(balanceReport)
    );
    addSheets(
      ["expenses-vendor", "expenses-category", "expense-claims"],
      prepareExpenseReportsForExport(expenseReport)
    );
    addSheets(
      ["payroll-summary", "wps-sif-summary"],
      preparePayrollReportsForExport(payrollReport)
    );
    addSheets(
      ["general-ledger", "account-transactions"],
      prepareLedgerReportsForExport(ledgerReport)
    );
    addSheets(
      ["month-end-close-status"],
      prepareMonthEndCloseStatusForExport(monthEndCloseExportReport)
    );
    addSheets(["audit-trail"], prepareAuditTrailForExport(auditTrailReport));
    addSheets(
      ["consolidated-statements"],
      prepareConsolidatedStatementsForExport(consolidatedStatementsReport)
    );
    addSheets(
      ["budget-actual", "cash-flow-forecast"],
      preparePlanningReportsForExport(planningReport)
    );

    const packCoverageMap = buildReportCoverageMap(workspace.reports, workbookReportIds);
    const packDecisionShortcuts = reportDecisionShortcutSummaries.filter(
      (shortcut) => shortcut.persona === workspace.persona
    );
    const packTemplates = reportPackTemplateSummaries.filter(
      (template) => template.persona === workspace.persona
    );
    const packAutomationStarters = reportAutomationStarterSummaries.filter(
      (starter) => starter.persona === workspace.persona
    );
    const packTriggerRules = reportAutomationTriggerRuleSummaries.filter(
      (rule) => rule.persona === workspace.persona
    );
    const packDeliverySubscriptions = reportDeliverySubscriptionSummaries.filter(
      (subscription) => subscription.persona === workspace.persona
    );
    const packSignals = automationQueue.filter((item) =>
      matchesReportPersona(item.personas, workspace.persona)
    );
    const openPackSignals = packSignals.filter((item) => item.count > 0);
    const openPackWorkItemCount = packSignals.reduce((sum, item) => sum + item.count, 0);
    const packAmountAtRisk = packSignals.reduce((sum, item) => sum + (item.amount ?? 0), 0);
    const packComparisonRows = comparisonRows.filter((row) =>
      matchesReportPersona(row.personas, workspace.persona)
    );
    const packComparisonPresets = reportComparisonPresetSummaries.filter(
      (preset) => preset.persona === workspace.persona
    );
    const packRecommendations =
      personaReportRecommendations.find((item) => item.workspace.persona === workspace.persona)
        ?.recommendations ?? [];
    const packAutomationRules = reportAutomationRules.filter(
      (rule) => rule.workspace.persona === workspace.persona
    );
    const packReadiness =
      reportPackDeliveryReadiness.find((item) => item.workspace.persona === workspace.persona) ??
      null;
    const packHealthTrend = packReadiness
      ? buildReportAutomationHealthTrend(
          reportAutomationHealthHistory,
          workspace.persona,
          packReadiness.automationHealth
        )
      : null;
    const packRoadmap =
      reportRoadmap.find((item) => item.workspace.persona === workspace.persona) ?? null;
    const packReadyAutomationRules = packAutomationRules.filter(
      (rule) => rule.status === "Ready to auto-send"
    ).length;
    const packReviewAutomationRules = packAutomationRules.filter(
      (rule) => rule.openWorkItemCount > 0
    ).length;
    const packSetupAutomationRules = packAutomationRules.filter(
      (rule) => rule.status === "Setup needed"
    ).length;
    const packRuleOpenWorkItemCount = packAutomationRules.reduce(
      (sum, rule) => sum + rule.openWorkItemCount,
      0
    );
    const packRuleAmountAtRisk = packAutomationRules.reduce(
      (sum, rule) => sum + rule.amountAtRisk,
      0
    );
    const packRuleComparisonMetricCount = packAutomationRules.reduce(
      (sum, rule) => sum + rule.comparisonMetricCount,
      0
    );
    const packRuleReportBundleCount = new Set(
      packAutomationRules.flatMap((rule) => rule.linkedReports.map((report) => report.id))
    ).size;
    const packAutoSendCoveragePercent =
      packAutomationRules.length > 0
        ? Math.round((packReadyAutomationRules / packAutomationRules.length) * 100)
        : 0;
    const packOperations =
      reportAutomationOperationSummaries.find(
        (item) => item.workspace.persona === workspace.persona
      ) ?? null;
    const packHandoff =
      reportAccountantHandoffSummaries.find(
        (item) => item.workspace.persona === workspace.persona
      ) ?? null;
    const packPriorityGap: ReportWorkflowGapFilter | null =
      packHandoff?.priorityGap ??
      (packOperations
        ? packOperations.failedRunCount > 0 || packOperations.deliveryGapCount > 0
          ? "delivery-gaps"
          : packOperations.automationRuleGapCount > 0 || packOperations.openWorkItemCount > 0
            ? "rule-gaps"
            : packOperations.reportGapCount > 0
              ? "report-gaps"
              : null
        : null);
    const packSharedContextHref =
      packHandoff?.shareHref ??
      reportWorkflowContextHref({
        persona: workspace.persona,
        tab: workspace.primaryTab,
        search: reportWorkflowContextSearchLabel,
        gap: packPriorityGap,
      });
    const packGapHref =
      packHandoff?.gapHref ??
      reportWorkflowContextHref({
        persona: workspace.persona,
        tab: workspace.primaryTab,
        search: reportWorkflowContextSearchLabel,
        gap: packPriorityGap,
      });
    const packPriorityGapLabel =
      packHandoff?.priorityGapLabel ??
      (packPriorityGap ? reportWorkflowGapFilterLabels[packPriorityGap] : tr("noOpenGap"));
    const operationsWorkflow = reportSectionHref(workspace, "automation-operations");
    const commandCenterWorkflow = reportSectionHref(workspace, "automation-command-center");
    const deliveryWorkflow = reportSectionHref(workspace, "delivery-subscriptions");

    const packIndex: ExportData = {
      sheetName: "Pack Index",
      columns: [
        { header: tr("report"), key: "report", width: 32 },
        { header: tr("decisionQuestion"), key: "decisionQuestion", width: 58 },
        { header: tr("status"), key: "status", width: 14 },
        { header: tr("comparison"), key: "comparison", width: 24 },
        { header: tr("automation"), key: "automation", width: 28 },
        { header: tr("delivery"), key: "delivery", width: 22 },
        { header: tr("workflow"), key: "workflow", width: 40 },
      ],
      rows: workspace.reports.map((report) => ({
        report: report.name,
        decisionQuestion: report.decisionQuestion,
        status: getReportStatusMeta()[report.status].label,
        comparison: report.comparison,
        automation: report.automation,
        delivery: workbookReportIds.has(report.id) ? tr("includedInWorkbook") : tr("openWorkflow"),
        workflow: reportPersonaHref(report, workspace.persona) ?? reportWorkspaceHref(workspace),
      })),
    };

    const operationsControl: ExportData = {
      sheetName: "Operations Control",
      columns: [
        { header: tr("field"), key: "field", width: 34 },
        { header: tr("value"), key: "value", width: 70 },
        { header: tr("workflow"), key: "workflow", width: 48 },
      ],
      rows: [
        { field: "Workspace", value: workspace.title, workflow: reportWorkspaceHref(workspace) },
        { field: "Persona", value: workspace.persona, workflow: operationsWorkflow },
        {
          field: "Operations status",
          value: packOperations?.status ?? "Not available",
          workflow: operationsWorkflow,
        },
        {
          field: "Next action",
          value: packOperations?.nextAction.label ?? "Not available",
          workflow: packOperations?.nextAction.href ?? operationsWorkflow,
        },
        {
          field: "Next action detail",
          value: packOperations?.nextAction.detail ?? "Not available",
          workflow: packOperations?.nextAction.href ?? operationsWorkflow,
        },
        {
          field: "Automation health",
          value: packOperations
            ? `${packOperations.automationScore}/100`
            : packReadiness
              ? `${packReadiness.automationHealth.score}/100`
              : "Not available",
          workflow: operationsWorkflow,
        },
        {
          field: "Reports ready",
          value: packOperations
            ? `${packOperations.readyReportCount}/${packOperations.reportCount}`
            : `${workspace.readyReports}/${workspace.reports.length}`,
          workflow: reportWorkspaceHref(workspace),
        },
        {
          field: "Auto-send rules ready",
          value: packOperations
            ? `${packOperations.readyRuleCount}/${packOperations.automationRuleCount}`
            : `${packReadyAutomationRules}/${packAutomationRules.length}`,
          workflow: commandCenterWorkflow,
        },
        {
          field: "Deliveries ready",
          value: packOperations
            ? `${packOperations.readyDeliveryCount}/${packOperations.deliverySubscriptionCount}`
            : `${
                packDeliverySubscriptions.filter(
                  (subscription) => subscription.status === "Ready to send"
                ).length
              }/${packDeliverySubscriptions.length}`,
          workflow: deliveryWorkflow,
        },
        {
          field: "Failed delivery runs",
          value: packOperations?.failedRunCount ?? 0,
          workflow: deliveryWorkflow,
        },
        {
          field: "Open work items",
          value: packOperations?.openWorkItemCount ?? packRuleOpenWorkItemCount,
          workflow: commandCenterWorkflow,
        },
        {
          field: "Amount at risk",
          value: `AED ${(packOperations?.amountAtRisk ?? packRuleAmountAtRisk).toFixed(2)}`,
          workflow: commandCenterWorkflow,
        },
        {
          field: "Comparison warnings",
          value:
            packOperations?.comparisonWarnings ??
            packReadiness?.automationHealth.comparisonWarnings ??
            0,
          workflow: reportSectionHref(workspace, "recommendations"),
        },
        {
          field: "Recommended actions",
          value: packOperations?.recommendationCount ?? packRecommendations.length,
          workflow: reportSectionHref(workspace, "recommendations"),
        },
      ],
    };

    const accountantHandoff: ExportData = {
      sheetName: "Accountant Handoff",
      columns: [
        { header: tr("workspace"), key: "workspace", width: 30 },
        { header: tr("persona"), key: "persona", width: 18 },
        { header: tr("status"), key: "status", width: 24 },
        { header: tr("priorityGap2"), key: "priorityGap", width: 24 },
        { header: tr("reportsReady"), key: "reportsReady", width: 18 },
        { header: tr("rulesReady"), key: "rulesReady", width: 18 },
        { header: tr("deliveriesReady"), key: "deliveriesReady", width: 18 },
        { header: tr("amountAtRisk"), key: "amountAtRisk", width: 18 },
        { header: tr("sharedContext2"), key: "sharedContext", width: 54 },
        { header: tr("gapWorkflow"), key: "gapWorkflow", width: 54 },
        { header: tr("nextAction2"), key: "nextAction", width: 30 },
        { header: tr("nextActionDetail"), key: "nextActionDetail", width: 78 },
        { header: tr("nextActionWorkflow"), key: "nextActionWorkflow", width: 54 },
      ],
      rows: [
        {
          workspace: workspace.title,
          persona: workspace.persona,
          status: packOperations?.status ?? "Not available",
          priorityGap: packPriorityGapLabel,
          reportsReady: packOperations
            ? `${packOperations.readyReportCount}/${packOperations.reportCount}`
            : `${workspace.readyReports}/${workspace.reports.length}`,
          rulesReady: packOperations
            ? `${packOperations.readyRuleCount}/${packOperations.automationRuleCount}`
            : `${packReadyAutomationRules}/${packAutomationRules.length}`,
          deliveriesReady: packOperations
            ? `${packOperations.readyDeliveryCount}/${packOperations.deliverySubscriptionCount}`
            : `${
                packDeliverySubscriptions.filter(
                  (subscription) => subscription.status === "Ready to send"
                ).length
              }/${packDeliverySubscriptions.length}`,
          amountAtRisk: `AED ${(packOperations?.amountAtRisk ?? packRuleAmountAtRisk).toFixed(2)}`,
          sharedContext: packSharedContextHref,
          gapWorkflow: packGapHref,
          nextAction: packOperations?.nextAction.label ?? tr("notAvailable"),
          nextActionDetail: packOperations?.nextAction.detail ?? tr("notAvailable"),
          nextActionWorkflow: packOperations?.nextAction.href ?? operationsWorkflow,
        },
      ],
    };

    const packSummary: ExportData = {
      sheetName: "Pack Summary",
      columns: [
        { header: tr("metric"), key: "metric", width: 34 },
        { header: tr("value"), key: "value", width: 80 },
      ],
      rows: [
        { metric: tr("workspace"), value: workspace.title },
        { metric: tr("persona"), value: workspace.persona },
        { metric: tr("packAutomationOutcome"), value: workspace.automationOutcome },
        { metric: tr("currentPeriod"), value: comparisonCurrentLabel },
        { metric: tr("priorPeriod"), value: comparisonPreviousLabel },
        {
          metric: tr("packStatus"),
          value: openPackSignals.length > 0 ? "Review before send" : "Ready to send",
        },
        {
          metric: tr("operationsStatus"),
          value: packOperations?.status ?? "Not available",
        },
        {
          metric: tr("operationsNextAction"),
          value: packOperations?.nextAction.label ?? "Not available",
        },
        { metric: tr("workspaceReports"), value: workspace.reports.length },
        { metric: tr("readyReports"), value: workspace.readyReports },
        { metric: tr("coverageCategories"), value: packCoverageMap.length },
        { metric: tr("decisionShortcuts"), value: packDecisionShortcuts.length },
        { metric: tr("automationStarters"), value: packAutomationStarters.length },
        { metric: tr("triggerRules"), value: packTriggerRules.length },
        { metric: tr("deliverySubscriptions"), value: packDeliverySubscriptions.length },
        { metric: tr("packTemplates"), value: packTemplates.length },
        { metric: tr("plannedReportGaps"), value: packRoadmap?.plannedReportCount ?? 0 },
        { metric: tr("roadmapPrerequisites"), value: packRoadmap?.prerequisiteCount ?? 0 },
        { metric: tr("roadmapStatus"), value: packRoadmap?.roadmapStatus ?? "Not available" },
        {
          metric: tr("topRoadmapPriority"),
          value: packRoadmap?.topPriorityReport
            ? `${packRoadmap.topPriorityReport.name} (${packRoadmap.topPriorityScore})`
            : "Not available",
        },
        { metric: tr("workbookSheets"), value: workbookSheets.length },
        { metric: tr("comparisonMetrics"), value: packComparisonRows.length },
        { metric: tr("comparisonPresets"), value: packComparisonPresets.length },
        { metric: tr("recommendedActions"), value: packRecommendations.length },
        { metric: tr("autoSendCoverage"), value: `${packAutoSendCoveragePercent}%` },
        { metric: tr("readyAutoSendRules"), value: packReadyAutomationRules },
        { metric: tr("rulesNeedingReview"), value: packReviewAutomationRules },
        { metric: tr("setupNeededRules"), value: packSetupAutomationRules },
        { metric: tr("deliveryChecks"), value: packReadiness?.checks.length ?? 0 },
        { metric: tr("checksNeedingReview"), value: packReadiness?.reviewCount ?? 0 },
        {
          metric: tr("automationHealth"),
          value: packReadiness
            ? `${packReadiness.automationHealth.score}/100 - ${packReadiness.automationHealth.label}`
            : "Not available",
        },
        {
          metric: tr("automationHealthReviewSignals"),
          value: packReadiness?.automationHealth.reviewSignals ?? 0,
        },
        {
          metric: tr("automationHealthTrend"),
          value: packHealthTrend
            ? `${packHealthTrend.label} (${packHealthTrend.detail})`
            : "Not available",
        },
        { metric: tr("openAutomationSignals"), value: openPackSignals.length },
        { metric: tr("openWorkItems"), value: openPackWorkItemCount },
        { metric: tr("amountAtRisk2"), value: `AED ${packAmountAtRisk.toFixed(2)}` },
      ],
    };

    const coverageMap: ExportData = {
      sheetName: "Coverage Map",
      columns: [
        { header: tr("category"), key: "category", width: 24 },
        { header: tr("reports"), key: "reports", width: 14 },
        { header: tr("live"), key: "live", width: 10 },
        { header: tr("apiReady2"), key: "apiReady", width: 12 },
        { header: tr("planned"), key: "planned", width: 12 },
        { header: tr("workbookSheets2"), key: "workbookSheets", width: 16 },
        { header: tr("comparisonTypes"), key: "comparisonTypes", width: 58 },
        { header: tr("automationHooks"), key: "automationHooks", width: 72 },
        { header: tr("personas"), key: "personas", width: 30 },
        { header: tr("reportList"), key: "reportList", width: 72 },
        { header: tr("decisionQuestions"), key: "decisionQuestions", width: 90 },
      ],
      rows: packCoverageMap.map((coverage) => ({
        category: coverage.category,
        reports: coverage.reports.length,
        live: coverage.liveCount,
        apiReady: coverage.apiReadyCount,
        planned: coverage.plannedCount,
        workbookSheets: coverage.workbookCount,
        comparisonTypes: coverage.comparisonTypes.join(", "),
        automationHooks: coverage.automationHooks.join(", "),
        personas: coverage.personas.join(", "),
        reportList: coverage.reports.map((report) => report.name).join(", "),
        decisionQuestions: coverage.reports.map((report) => report.decisionQuestion).join(" | "),
      })),
    };

    const packTemplatesSheet: ExportData = {
      sheetName: "Pack Templates",
      columns: [
        { header: tr("template"), key: "template", width: 34 },
        { header: tr("audience"), key: "audience", width: 42 },
        { header: tr("outcome"), key: "outcome", width: 70 },
        { header: tr("cadence"), key: "cadence", width: 34 },
        { header: tr("delivery"), key: "delivery", width: 38 },
        { header: tr("reports"), key: "reports", width: 72 },
        { header: tr("readyReports2"), key: "readyReports", width: 16 },
        { header: tr("categories"), key: "categories", width: 34 },
        { header: tr("comparisonFocus"), key: "comparisonFocus", width: 58 },
        { header: tr("automationTrigger"), key: "automationTrigger", width: 70 },
        { header: tr("workflow"), key: "workflow", width: 42 },
      ],
      rows: packTemplates.map((template) => ({
        template: template.title,
        audience: template.audience,
        outcome: template.outcome,
        cadence: template.cadence,
        delivery: template.delivery,
        reports: template.reports.map((report) => report.name).join(", "),
        readyReports: `${template.readyCount}/${template.reports.length}`,
        categories: template.categories.join(", "),
        comparisonFocus: template.comparisonFocus,
        automationTrigger: template.automationTrigger,
        workflow: template.href,
      })),
    };

    const decisionShortcutsSheet: ExportData = {
      sheetName: "Decision Shortcuts",
      columns: [
        { header: tr("question"), key: "question", width: 46 },
        { header: tr("answer"), key: "answer", width: 80 },
        { header: tr("primaryReport"), key: "primaryReport", width: 30 },
        { header: tr("reports"), key: "reports", width: 72 },
        { header: tr("comparisonPreset"), key: "comparisonPreset", width: 36 },
        { header: tr("automationStarter"), key: "automationStarter", width: 38 },
        { header: tr("reportWorkflow"), key: "reportWorkflow", width: 42 },
        { header: tr("shortcutWorkflow"), key: "shortcutWorkflow", width: 42 },
      ],
      rows: packDecisionShortcuts.map((shortcut) => ({
        question: shortcut.question,
        answer: shortcut.answer,
        primaryReport: shortcut.primaryReport.name,
        reports: shortcut.reports.map((report) => report.name).join(", "),
        comparisonPreset: shortcut.comparisonPreset?.title ?? "",
        automationStarter: shortcut.automationStarter?.title ?? "",
        reportWorkflow: shortcut.primaryReportHref,
        shortcutWorkflow: shortcut.href,
      })),
    };

    const automationStartersSheet: ExportData = {
      sheetName: "Automation Starters",
      columns: [
        { header: tr("starter"), key: "starter", width: 34 },
        { header: tr("audience"), key: "audience", width: 42 },
        { header: tr("outcome"), key: "outcome", width: 72 },
        { header: tr("setupTime"), key: "setupTime", width: 18 },
        { header: tr("trigger"), key: "trigger", width: 60 },
        { header: tr("readyReports2"), key: "readyReports", width: 16 },
        { header: tr("reports"), key: "reports", width: 72 },
        { header: tr("playbooks"), key: "playbooks", width: 56 },
        { header: tr("queueSignals"), key: "queueSignals", width: 56 },
        { header: tr("openWorkItems2"), key: "openWorkItemCount", width: 18 },
        { header: tr("amountAtRisk"), key: "amountAtRisk", width: 18 },
        { header: tr("setupSteps"), key: "setupSteps", width: 72 },
        { header: tr("primaryAction"), key: "primaryAction", width: 28 },
        { header: tr("workflow"), key: "workflow", width: 42 },
      ],
      rows: packAutomationStarters.map((starter) => ({
        starter: starter.title,
        audience: starter.audience,
        outcome: starter.outcome,
        setupTime: starter.setupTime,
        trigger: starter.trigger,
        readyReports: `${starter.readyCount}/${starter.reports.length}`,
        reports: starter.reports.map((report) => report.name).join(", "),
        playbooks: starter.playbooks.map((playbook) => playbook.title).join(", "),
        queueSignals: starter.queueSignals.map((signal) => signal.title).join(", "),
        openWorkItemCount: starter.openWorkItemCount,
        amountAtRisk: `AED ${starter.amountAtRisk.toFixed(2)}`,
        setupSteps: starter.setupSteps.join(" | "),
        primaryAction: starter.primaryAction,
        workflow: starter.href,
      })),
    };

    const triggerRulesSheet: ExportData = {
      sheetName: "Trigger Rules",
      columns: [
        { header: tr("rule"), key: "rule", width: 34 },
        { header: tr("severity"), key: "severity", width: 16 },
        { header: tr("condition"), key: "condition", width: 70 },
        { header: tr("threshold"), key: "threshold", width: 74 },
        { header: tr("cadence"), key: "cadence", width: 42 },
        { header: tr("reports"), key: "reports", width: 72 },
        { header: tr("decisionShortcut"), key: "decisionShortcut", width: 42 },
        { header: tr("automationStarter"), key: "automationStarter", width: 42 },
        { header: tr("openWorkItems2"), key: "openWorkItemCount", width: 18 },
        { header: tr("amountAtRisk"), key: "amountAtRisk", width: 18 },
        { header: tr("action"), key: "action", width: 28 },
        { header: tr("workflow"), key: "workflow", width: 42 },
      ],
      rows: packTriggerRules.map((rule) => ({
        rule: rule.title,
        severity: getTriggerSeverityMeta()[rule.severity].label,
        condition: rule.condition,
        threshold: rule.threshold,
        cadence: rule.cadence,
        reports: rule.reports.map((report) => report.name).join(", "),
        decisionShortcut: rule.decisionShortcut?.question ?? "",
        automationStarter: rule.automationStarter?.title ?? "",
        openWorkItemCount: rule.openWorkItemCount,
        amountAtRisk: `AED ${rule.amountAtRisk.toFixed(2)}`,
        action: rule.actionLabel,
        workflow: rule.href,
      })),
    };

    const deliverySubscriptionsSheet: ExportData = {
      sheetName: "Delivery Subscriptions",
      columns: [
        { header: tr("subscription"), key: "subscription", width: 38 },
        { header: tr("audience"), key: "audience", width: 42 },
        { header: tr("cadence"), key: "cadence", width: 54 },
        { header: tr("channel"), key: "channel", width: 36 },
        { header: tr("format"), key: "format", width: 32 },
        { header: tr("recipients"), key: "recipients", width: 58 },
        { header: tr("packTemplate"), key: "packTemplate", width: 38 },
        { header: tr("readyReports2"), key: "readyReports", width: 16 },
        { header: tr("triggerRules2"), key: "triggerRules", width: 64 },
        { header: tr("openWorkItems2"), key: "openWorkItemCount", width: 18 },
        { header: tr("amountAtRisk"), key: "amountAtRisk", width: 18 },
        { header: tr("deliveryGuardrail"), key: "deliveryGuardrail", width: 78 },
        { header: tr("workflow"), key: "workflow", width: 42 },
      ],
      rows: packDeliverySubscriptions.map((subscription) => ({
        subscription: subscription.title,
        audience: subscription.audience,
        cadence: subscription.cadence,
        channel: subscription.channel,
        format: subscription.format,
        recipients: subscription.recipients,
        packTemplate: subscription.packTemplate?.title ?? "",
        readyReports: `${subscription.readyCount}/${subscription.reports.length}`,
        triggerRules: subscription.triggerRules.map((rule) => rule.title).join(", "),
        openWorkItemCount: subscription.openWorkItemCount,
        amountAtRisk: `AED ${subscription.amountAtRisk.toFixed(2)}`,
        deliveryGuardrail: subscription.deliveryGuardrail,
        workflow: subscription.href,
      })),
    };

    const recommendedActions: ExportData = {
      sheetName: "Recommended Actions",
      columns: [
        { header: tr("priority"), key: "priority", width: 12 },
        { header: tr("action"), key: "action", width: 32 },
        { header: tr("trigger"), key: "trigger", width: 60 },
        { header: tr("signal"), key: "signal", width: 20 },
        { header: tr("amount"), key: "amount", width: 18 },
        { header: tr("workflow"), key: "workflow", width: 40 },
      ],
      rows: packRecommendations.map((recommendation, index) => ({
        priority: index + 1,
        action: recommendation.title,
        trigger: recommendation.detail,
        signal: recommendation.badge,
        amount:
          typeof recommendation.amount === "number"
            ? `AED ${recommendation.amount.toFixed(2)}`
            : "",
        workflow:
          recommendation.href ??
          (recommendation.tab
            ? reportsHref({ tab: recommendation.tab, persona: workspace.persona })
            : reportWorkspaceHref(workspace)),
      })),
    };

    const reportRoadmapSheet: ExportData = {
      sheetName: "Report Roadmap",
      columns: [
        { header: tr("report"), key: "report", width: 32 },
        { header: tr("status"), key: "status", width: 18 },
        { header: tr("priorityScore"), key: "priorityScore", width: 16 },
        { header: tr("personaImpact"), key: "personaImpact", width: 18 },
        { header: tr("priorityRationale"), key: "priorityRationale", width: 56 },
        { header: tr("category"), key: "category", width: 24 },
        { header: tr("comparison"), key: "comparison", width: 28 },
        { header: tr("automationUnlock"), key: "automation", width: 34 },
        { header: tr("dataSourceNeeded"), key: "dataSource", width: 46 },
        { header: tr("workflowDependency"), key: "workflowDependency", width: 50 },
        { header: tr("automationRuleNeeded"), key: "automationRule", width: 50 },
        { header: tr("workflow"), key: "workflow", width: 40 },
      ],
      rows: workspace.reports
        .slice()
        .sort((a, b) => {
          const aPlanned = a.status === "planned" ? 0 : 1;
          const bPlanned = b.status === "planned" ? 0 : 1;
          return (
            aPlanned - bPlanned ||
            (b.roadmapPriority?.score ?? 0) - (a.roadmapPriority?.score ?? 0) ||
            a.name.localeCompare(b.name)
          );
        })
        .map((report) => ({
          report: report.name,
          status: getReportStatusMeta()[report.status].label,
          priorityScore: report.roadmapPriority?.score ?? "",
          personaImpact: report.roadmapPriority?.impactByPersona[workspace.persona] ?? "",
          priorityRationale: report.roadmapPriority?.rationale ?? "",
          category: report.category,
          comparison: report.comparison,
          automation: report.automation,
          dataSource: report.roadmapPrerequisites?.dataSource ?? "",
          workflowDependency: report.roadmapPrerequisites?.workflowDependency ?? "",
          automationRule: report.roadmapPrerequisites?.automationRule ?? "",
          workflow: reportPersonaHref(report, workspace.persona) ?? reportWorkspaceHref(workspace),
        })),
    };

    const automationCommandCenter: ExportData = {
      sheetName: "Automation Command Center",
      columns: [
        { header: tr("metric"), key: "metric", width: 34 },
        { header: tr("value"), key: "value", width: 80 },
      ],
      rows: [
        { metric: tr("workspace"), value: workspace.title },
        { metric: tr("persona"), value: workspace.persona },
        { metric: tr("automationOutcome"), value: workspace.automationOutcome },
        { metric: tr("totalAutomationRules"), value: packAutomationRules.length },
        { metric: tr("deliverySubscriptions"), value: packDeliverySubscriptions.length },
        { metric: tr("readyAutoSendRules"), value: packReadyAutomationRules },
        { metric: tr("rulesNeedingReview"), value: packReviewAutomationRules },
        { metric: tr("setupNeededRules"), value: packSetupAutomationRules },
        { metric: tr("autoSendCoverage"), value: `${packAutoSendCoveragePercent}%` },
        { metric: tr("openRuleWorkItems"), value: packRuleOpenWorkItemCount },
        { metric: tr("ruleAmountAtRisk"), value: `AED ${packRuleAmountAtRisk.toFixed(2)}` },
        { metric: tr("comparisonMetricsLinked"), value: packRuleComparisonMetricCount },
        { metric: tr("reportBundleCoverage"), value: packRuleReportBundleCount },
        {
          metric: tr("packDeliveryStatus"),
          value: packReadiness?.status ?? "Not available",
        },
        {
          metric: tr("packChecksNeedingReview"),
          value: packReadiness?.reviewCount ?? 0,
        },
      ],
    };

    const automationHealth: ExportData = {
      sheetName: "Automation Health",
      columns: [
        { header: tr("metric"), key: "metric", width: 34 },
        { header: tr("value"), key: "value", width: 42 },
      ],
      rows: packReadiness
        ? [
            { metric: tr("workspace"), value: workspace.title },
            {
              metric: tr("score"),
              value: `${packReadiness.automationHealth.score}/100`,
            },
            { metric: tr("status"), value: packReadiness.automationHealth.label },
            {
              metric: tr("packReadinessScore"),
              value: `${packReadiness.automationHealth.readinessScore}/100`,
            },
            {
              metric: tr("automationLaneScore"),
              value: `${packReadiness.automationHealth.automationLaneScore}/100`,
            },
            {
              metric: tr("comparisonSignalScore"),
              value: `${packReadiness.automationHealth.comparisonScore}/100`,
            },
            {
              metric: tr("comparisonWarnings"),
              value: packReadiness.automationHealth.comparisonWarnings,
            },
            {
              metric: tr("reviewSignals"),
              value: packReadiness.automationHealth.reviewSignals,
            },
          ]
        : [],
    };

    const automationHealthTrend: ExportData = {
      sheetName: "Automation Health Trend",
      columns: [
        { header: tr("metric"), key: "metric", width: 34 },
        { header: tr("value"), key: "value", width: 52 },
      ],
      rows: packHealthTrend
        ? [
            { metric: tr("workspace"), value: workspace.title },
            { metric: tr("trend"), value: packHealthTrend.label },
            { metric: tr("currentScore"), value: packHealthTrend.currentScore },
            {
              metric: tr("previousScore"),
              value: packHealthTrend.previousScore ?? "Baseline",
            },
            { metric: tr("delta"), value: packHealthTrend.delta },
            { metric: tr("detail"), value: packHealthTrend.detail },
            {
              metric: tr("previousCapturedAt"),
              value: packHealthTrend.previousCapturedAt ?? "",
            },
          ]
        : [],
    };

    const deliveryChecklist: ExportData = {
      sheetName: "Delivery Checklist",
      columns: [
        { header: tr("check"), key: "check", width: 34 },
        { header: tr("status"), key: "status", width: 18 },
        { header: tr("detail"), key: "detail", width: 70 },
        { header: tr("workflow"), key: "workflow", width: 40 },
      ],
      rows:
        packReadiness?.checks.map((check) => ({
          check: check.label,
          status: check.status,
          detail: check.detail,
          workflow: check.workflow,
        })) ?? [],
    };

    const comparisonSnapshot: ExportData = {
      sheetName: "Comparison Snapshot",
      columns: [
        { header: tr("metric"), key: "metric", width: 28 },
        { header: tr("signal"), key: "signal", width: 22 },
        { header: tr("current"), key: "current", width: 18 },
        { header: tr("baseline"), key: "prior", width: 18 },
        { header: tr("change"), key: "change", width: 18 },
        { header: tr("change2"), key: "changePercent", width: 16 },
        { header: tr("status"), key: "status", width: 18 },
        { header: tr("workflow"), key: "workflow", width: 40 },
      ],
      rows: packComparisonRows.map((row) => {
        const status =
          Math.abs(row.delta) < 0.005
            ? tr("stable")
            : row.favorable === "neutral"
              ? tr("context")
              : (row.favorable === "increase" ? row.delta > 0 : row.delta < 0)
                ? tr("favorable")
                : "Review";

        return {
          metric: row.label,
          signal: row.signal,
          current: formatComparisonExportValue(row, row.current),
          prior: formatComparisonExportValue(row, row.previous),
          change: formatComparisonExportValue(row, row.delta),
          changePercent: formatComparisonPercent(row.percentChange),
          status,
          workflow: reportsHref({ tab: row.tab, persona: workspace.persona }),
        };
      }),
    };

    const comparisonPresetsSheet: ExportData = {
      sheetName: "Comparison Presets",
      columns: [
        { header: tr("preset"), key: "preset", width: 34 },
        { header: tr("question"), key: "question", width: 70 },
        { header: tr("baseline"), key: "baseline", width: 56 },
        { header: tr("metrics"), key: "metrics", width: 56 },
        { header: tr("warnings"), key: "warnings", width: 12 },
        { header: tr("reports"), key: "reports", width: 72 },
        { header: tr("automationTrigger"), key: "automationTrigger", width: 70 },
        { header: tr("workflow"), key: "workflow", width: 42 },
      ],
      rows: packComparisonPresets.map((preset) => ({
        preset: preset.title,
        question: preset.question,
        baseline: preset.baseline,
        metrics: preset.metrics.map((row) => row.label).join(", "),
        warnings: preset.warningCount,
        reports: preset.reports.map((report) => report.name).join(", "),
        automationTrigger: preset.automationTrigger,
        workflow: preset.href,
      })),
    };

    const automationPlaybooks: ExportData = {
      sheetName: "Automation Playbooks",
      columns: [
        { header: tr("playbook"), key: "playbook", width: 34 },
        { header: tr("trigger"), key: "trigger", width: 42 },
        { header: tr("cadence"), key: "cadence", width: 38 },
        { header: tr("recipients"), key: "recipients", width: 42 },
        { header: tr("reports"), key: "reports", width: 60 },
        { header: tr("ruleStatus"), key: "status", width: 24 },
        { header: tr("openWorkItems2"), key: "openWorkItemCount", width: 18 },
        { header: tr("amountAtRisk"), key: "amountAtRisk", width: 18 },
        { header: tr("comparisonMetrics2"), key: "comparisonMetricCount", width: 20 },
        { header: tr("action"), key: "action", width: 24 },
        { header: tr("workflow"), key: "workflow", width: 40 },
      ],
      rows: packAutomationRules.map((rule) => ({
        playbook: rule.playbook.title,
        trigger: rule.playbook.trigger,
        cadence: workspace.packSchedule.cadence,
        recipients: workspace.packSchedule.recipients,
        reports: rule.linkedReports.map((report) => report.name).join(", "),
        status: rule.status,
        openWorkItemCount: rule.openWorkItemCount,
        amountAtRisk: `AED ${rule.amountAtRisk.toFixed(2)}`,
        comparisonMetricCount: rule.comparisonMetricCount,
        action: rule.playbook.cta,
        workflow: rule.targetWorkflow,
      })),
    };

    const packAutomationStatus: ExportData = {
      sheetName: "Pack Automation Status",
      columns: [
        { header: tr("signal"), key: "signal", width: 26 },
        { header: tr("detail"), key: "detail", width: 54 },
        { header: tr("openCount"), key: "count", width: 14 },
        { header: tr("amount"), key: "amount", width: 18 },
        { header: tr("status"), key: "status", width: 20 },
        { header: tr("workflow"), key: "workflow", width: 40 },
      ],
      rows: packSignals.map((item) => ({
        signal: item.title,
        detail: item.detail,
        count: item.count,
        amount:
          typeof item.amount === "number"
            ? `${item.currency ?? "AED"} ${item.amount.toFixed(2)}`
            : "",
        status: item.count > 0 ? "Review before send" : "Clear",
        workflow:
          item.href ?? (item.tab ? reportsHref({ tab: item.tab, persona: workspace.persona }) : ""),
      })),
    };

    const packCadence: ExportData = {
      sheetName: "Pack Cadence",
      columns: [
        { header: tr("field"), key: "field", width: 24 },
        { header: tr("value"), key: "value", width: 80 },
      ],
      rows: [
        { field: "Workspace", value: workspace.title },
        { field: "Persona", value: workspace.persona },
        { field: "Cadence", value: workspace.packSchedule.cadence },
        { field: "Delivery", value: workspace.packSchedule.delivery },
        { field: "Recipients", value: workspace.packSchedule.recipients },
        { field: "Refresh trigger", value: workspace.packSchedule.trigger },
        { field: "Automation rule", value: workspace.packSchedule.automation },
        { field: "Automation outcome", value: workspace.automationOutcome },
      ],
    };

    return [
      packIndex,
      packSummary,
      operationsControl,
      accountantHandoff,
      coverageMap,
      decisionShortcutsSheet,
      packTemplatesSheet,
      automationStartersSheet,
      triggerRulesSheet,
      deliverySubscriptionsSheet,
      recommendedActions,
      reportRoadmapSheet,
      automationCommandCenter,
      automationHealth,
      automationHealthTrend,
      deliveryChecklist,
      comparisonSnapshot,
      comparisonPresetsSheet,
      packCadence,
      packAutomationStatus,
      automationPlaybooks,
      ...workbookSheets,
    ];
  };

  const handleExportWorkspacePack = async (workspace: (typeof workspaceSummaries)[number]) => {
    setIsExporting(true);
    try {
      await exportToExcel(
        buildWorkspaceReportPack(workspace),
        `${workspace.persona}_report_pack${exportDateRangeSuffix}`
      );
      toast({
        title: tr("reportPackExported"),
        description: tr("exportedToExcel", { title: workspace.title }),
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: tr("exportFailed"),
        description: error?.message || tr("failedToExportReportPack"),
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportWorkspacePackToSheets = async (
    workspace: (typeof workspaceSummaries)[number]
  ) => {
    if (!selectedCompanyId) return;

    setIsExporting(true);
    const dateRangeTitle =
      dateRange.from && dateRange.to
        ? ` (${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")})`
        : "";

    const result = await exportToGoogleSheets(
      buildWorkspaceReportPack(workspace),
      `${workspace.title}${dateRangeTitle}`,
      selectedCompanyId
    );

    setIsExporting(false);

    if (result?.success) {
      toast({
        title: tr("reportPackExported"),
        description: tr("exportedToGoogleSheetsOpening", { title: workspace.title }),
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, "_blank");
      }
    } else {
      toast({
        variant: "destructive",
        title: tr("exportFailed"),
        description: result?.error || tr("failedToExportReportPackTo"),
      });
    }
  };

  const handleExportExcel = () => {
    const dateRangeStr =
      dateRange.from && dateRange.to
        ? `_${format(dateRange.from, "yyyy-MM-dd")}_to_${format(dateRange.to, "yyyy-MM-dd")}`
        : "";

    if (activeTab === "pl" && profitLoss) {
      exportToExcel([prepareProfitLossForExport(profitLoss)], `profit_loss${dateRangeStr}`);
      toast({ title: tr("exportSuccessful"), description: tr("profitLossExportedToExcel") });
    } else if (activeTab === "bs" && balanceSheet) {
      exportToExcel([prepareBalanceSheetForExport(balanceSheet)], `balance_sheet${dateRangeStr}`);
      toast({ title: tr("exportSuccessful"), description: tr("balanceSheetExportedToExcel") });
    } else if (activeTab === "vat" && vatSummary) {
      exportToExcel([prepareVATSummaryForExport(vatSummary)], `vat_summary${dateRangeStr}`);
      toast({ title: tr("exportSuccessful"), description: tr("vatSummaryExportedToExcel") });
    } else if (activeTab === "tax" && corporateTaxEstimate) {
      exportToExcel(
        prepareCorporateTaxEstimateForExport(corporateTaxEstimate),
        `corporate_tax_estimate${dateRangeStr}`
      );
      toast({
        title: tr("exportSuccessful"),
        description: tr("corporateTaxEstimateExportedToExcel"),
      });
    } else if (activeTab === "trial" && trialBalance) {
      exportToExcel([prepareTrialBalanceForExport(trialBalance)], `trial_balance${dateRangeStr}`);
      toast({ title: tr("exportSuccessful"), description: tr("trialBalanceExportedToExcel") });
    } else if (activeTab === "sales") {
      if (selectedReportId === "ar-aging") {
        exportToExcel(receivableAgingExportSheets, `ar_aging${dateRangeStr}`);
        toast({ title: tr("exportSuccessful"), description: tr("aRAgingExportedToExcel") });
      } else {
        exportToExcel(
          prepareInvoiceStatusForExport(invoiceStatusReport),
          `invoice_status${dateRangeStr}`
        );
        toast({ title: tr("exportSuccessful"), description: tr("invoiceStatusExportedToExcel") });
      }
    } else if (activeTab === "balances") {
      if (selectedReportId === "ap-aging") {
        exportToExcel(payableAgingExportSheets, `ap_aging${dateRangeStr}`);
        toast({ title: tr("exportSuccessful"), description: tr("aPAgingExportedToExcel") });
      } else {
        exportToExcel(
          prepareBalanceSummaryReportsForExport(balanceReport),
          `balance_reports${dateRangeStr}`
        );
        toast({ title: tr("exportSuccessful"), description: tr("balanceReportsExportedToExcel") });
      }
    } else if (activeTab === "expenses") {
      exportToExcel(
        prepareExpenseReportsForExport(expenseReport),
        `expense_reports${dateRangeStr}`
      );
      toast({ title: tr("exportSuccessful"), description: tr("expenseReportsExportedToExcel") });
    } else if (activeTab === "payroll") {
      exportToExcel(
        preparePayrollReportsForExport(payrollReport),
        `payroll_reports${dateRangeStr}`
      );
      toast({ title: tr("exportSuccessful"), description: tr("payrollReportsExportedToExcel") });
    } else if (activeTab === "ledger") {
      exportToExcel(prepareLedgerReportsForExport(ledgerReport), `general_ledger${dateRangeStr}`);
      toast({ title: tr("exportSuccessful"), description: tr("generalLedgerExportedToExcel") });
    } else if (activeTab === "close") {
      exportToExcel(
        [
          ...prepareMonthEndCloseStatusForExport(monthEndCloseExportReport),
          ...prepareAuditTrailForExport(auditTrailReport),
          ...prepareConsolidatedStatementsForExport(consolidatedStatementsReport),
        ],
        `close_reports_${monthEndPeriod}${dateRangeStr}`
      );
      toast({
        title: tr("exportSuccessful"),
        description: tr("closeReportsExportedToExcel"),
      });
    } else if (activeTab === "planning") {
      exportToExcel(
        preparePlanningReportsForExport(planningReport),
        `planning_reports${dateRangeStr}`
      );
      toast({ title: tr("exportSuccessful"), description: tr("planningReportsExportedToExcel") });
    }
  };

  const handleExportGoogleSheets = async () => {
    if (!selectedCompanyId) return;

    setIsExporting(true);
    const dateRangeStr =
      dateRange.from && dateRange.to
        ? ` (${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")})`
        : "";

    let result;
    if (activeTab === "pl" && profitLoss) {
      result = await exportToGoogleSheets(
        [prepareProfitLossForExport(profitLoss)],
        `Profit & Loss${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "bs" && balanceSheet) {
      result = await exportToGoogleSheets(
        [prepareBalanceSheetForExport(balanceSheet)],
        `Balance Sheet${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "vat" && vatSummary) {
      result = await exportToGoogleSheets(
        [prepareVATSummaryForExport(vatSummary)],
        `VAT Summary${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "tax" && corporateTaxEstimate) {
      result = await exportToGoogleSheets(
        prepareCorporateTaxEstimateForExport(corporateTaxEstimate),
        `Corporate Tax Estimate${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "trial" && trialBalance) {
      result = await exportToGoogleSheets(
        [prepareTrialBalanceForExport(trialBalance)],
        `Trial Balance${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "sales") {
      result = await exportToGoogleSheets(
        selectedReportId === "ar-aging"
          ? receivableAgingExportSheets
          : prepareInvoiceStatusForExport(invoiceStatusReport),
        `${selectedReportId === "ar-aging" ? "A/R Aging" : "Invoice Status"}${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "balances") {
      result = await exportToGoogleSheets(
        selectedReportId === "ap-aging"
          ? payableAgingExportSheets
          : prepareBalanceSummaryReportsForExport(balanceReport),
        `${selectedReportId === "ap-aging" ? "A/P Aging" : "Balance Reports"}${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "expenses") {
      result = await exportToGoogleSheets(
        prepareExpenseReportsForExport(expenseReport),
        `Expense Reports${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "payroll") {
      result = await exportToGoogleSheets(
        preparePayrollReportsForExport(payrollReport),
        `Payroll Reports${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "ledger") {
      result = await exportToGoogleSheets(
        prepareLedgerReportsForExport(ledgerReport),
        `General Ledger${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "close") {
      result = await exportToGoogleSheets(
        [
          ...prepareMonthEndCloseStatusForExport(monthEndCloseExportReport),
          ...prepareAuditTrailForExport(auditTrailReport),
          ...prepareConsolidatedStatementsForExport(consolidatedStatementsReport),
        ],
        `Close Reports (${monthEndPeriodLabel})`,
        selectedCompanyId
      );
    } else if (activeTab === "planning") {
      result = await exportToGoogleSheets(
        preparePlanningReportsForExport(planningReport),
        `Planning Reports${dateRangeStr}`,
        selectedCompanyId
      );
    }

    setIsExporting(false);

    if (result?.success) {
      toast({
        title: tr("exportSuccessful"),
        description: tr("reportExportedToGoogleSheetsOpening"),
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, "_blank");
      }
    } else {
      toast({
        variant: "destructive",
        title: tr("exportFailed"),
        description: result?.error || tr("failedToExportToGoogleSheets"),
      });
    }
  };

  const reportWorkspacePanelClass = (tab: ReportWorkspaceTab, className: string) =>
    activeReportWorkspaceTab === tab ? className : `${className} hidden`;
  const reportDiscoveryPanelClass = (className: string) => `${className} hidden`;
  const backToReportsHref = reportsWorkspaceHref({
    persona: activeReportViewerOption?.persona ?? effectiveReportPersona,
    workspace: "reports",
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={tr("insights")}
        title={t.reports}
        description={
          (t as any).financialReportsSubtitle ?? tr("financialReportsComparisonsAndAutomationReady")
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" data-testid="button-report-proof-trail">
              <Link href={evidenceSectionHref("proof-drilldown")}>
                <FileText className="w-4 h-4 me-2" />
                {(t as any).viewProof ?? tr("viewProof")}
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={isExporting} data-testid="button-export">
                  <Download className="w-4 h-4 me-2" />
                  {isExporting ? tr("exporting") : t.export}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportExcel} data-testid="menu-export-excel">
                  <FileSpreadsheet className="w-4 h-4 me-2" />
                  {tr("exportToExcel")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleExportGoogleSheets}
                  data-testid="menu-export-sheets"
                >
                  <SiGooglesheets className="w-4 h-4 me-2" />
                  {tr("exportToGoogleSheets")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {activeReportWorkspaceTab === "reports" ? (
        <section
          className="rounded-lg border border-border/70 bg-card p-4 shadow-sm"
          aria-labelledby="report-viewer-title"
        >
          <div className="flex flex-col gap-4">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                {hasFocusedReportSelection ? (
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                    data-testid="button-back-to-report-center"
                  >
                    <Link href={backToReportsHref}>
                      <ArrowLeft className="h-3.5 w-3.5" />
                      {tr("backToReports")}
                    </Link>
                  </Button>
                ) : null}
                {hasFocusedReportSelection && activeReportViewerOption?.categoryLabel ? (
                  <span>{activeReportViewerOption.categoryLabel}</span>
                ) : null}
              </div>
              <div>
                <h2 id="report-viewer-title" className="text-2xl font-semibold tracking-tight">
                  {reportViewerTitle}
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  {reportViewerDescription}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(16rem,24rem)_minmax(20rem,1fr)]">
            <div className="space-y-1.5">
              <Label>{(t as any).reportCenter ?? tr("reportCenter")}</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-10 w-full justify-between gap-3 px-3 py-2 text-start"
                    data-testid="button-report-viewer-menu"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {reportViewerMenuLabel}
                      </span>
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {reportViewerMenuDescription}
                      </span>
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-72"
                  data-testid="menu-report-viewer"
                >
                  <DropdownMenuLabel>
                    {(t as any).reportCenter ?? tr("reportCenter")}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {reportViewerGroups.map((group) => (
                    <DropdownMenuSub key={group.category}>
                      <DropdownMenuSubTrigger>
                        <span className="min-w-0 flex-1 truncate">{group.label}</span>
                        <span className="me-2 text-xs font-normal text-muted-foreground">
                          {group.options.length}
                        </span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] w-80 overflow-y-auto">
                        {group.options.map((option) => (
                          <DropdownMenuItem
                            key={option.id}
                            disabled={!option.href && !option.tab}
                            onSelect={() => openReportViewerOption(option.id)}
                            className="items-start py-2"
                            data-testid={`menu-report-viewer-${option.id}`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{option.label}</span>
                              <span className="block line-clamp-2 text-xs leading-snug text-muted-foreground">
                                {option.description}
                              </span>
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="space-y-1.5">
              <Label>{(t as any).period ?? tr("period")}</Label>
              <div className="rounded-md border bg-background p-2">
                <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeReportWorkspaceTab !== "reports" ? (
        <>
          <section className="space-y-3" aria-labelledby="role-focus-title">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="role-focus-title" className="text-xl font-semibold">
                  {tr("roleFocus")}
                </h2>
                <p className="text-sm text-muted-foreground">{personaScopeDescription}</p>
              </div>
              <Badge
                variant={personaFilter === "all" ? "outline" : "info"}
                className="hidden sm:inline-flex"
              >
                {personaFilterLabel}
              </Badge>
            </div>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label={tr("reportingRoleFocus")}
            >
              {getPersonaFilters().map((filter) => (
                <Button
                  key={filter.id}
                  type="button"
                  size="sm"
                  variant={personaFilter === filter.id ? "default" : "outline"}
                  onClick={() => setReportPersonaFilter(filter.id)}
                  data-testid={`button-role-focus-${filter.id}`}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
            <div
              className="rounded-md border border-border/70 bg-muted/20 p-3"
              data-testid="reports-workflow-context-summary"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                    {tr("savedReportingContext")}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="info" data-testid="reports-workflow-context-role">
                      {tr("role", { personaFilterLabel })}
                    </Badge>
                    {reportWorkflowContextSearchLabel ? (
                      <Badge variant="outline" data-testid="reports-workflow-context-search">
                        <span className="max-w-[14rem] truncate">
                          {tr("search", { reportWorkflowContextSearchLabel })}
                        </span>
                      </Badge>
                    ) : (
                      <Badge variant="outline">{tr("noSavedSearch")}</Badge>
                    )}
                    {activeReportWorkflowGapFilterLabel ? (
                      <Badge variant="outline" data-testid="reports-workflow-context-gap">
                        <span className="max-w-[14rem] truncate">
                          {tr("gap", { activeReportWorkflowGapFilterLabel })}
                        </span>
                      </Badge>
                    ) : (
                      <Badge variant="outline">{tr("noGapFilter")}</Badge>
                    )}
                  </div>
                </div>
                {hasReportWorkflowContextFilters ? (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={reportWorkflowContextShareHref}
                        data-testid="button-open-report-workflow-context-link"
                      >
                        {tr("openShareLink")}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={resetReportWorkflowContext}
                      data-testid="button-reset-report-workflow-context"
                    >
                      <X className="h-3.5 w-3.5" />
                      {tr("resetContext")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <Tabs
              value={activeReportWorkspaceTab}
              onValueChange={(value) => setReportWorkspaceTab(value as ReportWorkspaceTab)}
            >
              <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg p-1">
                {getReportWorkspaceTabs().map((tab) => (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="h-10 min-w-[7.25rem] flex-none px-3 py-2 text-center lg:min-w-0 lg:flex-1 xl:h-auto xl:flex-col xl:gap-0.5"
                    data-testid={`reports-workspace-tab-${tab.id}`}
                  >
                    <span className="text-sm font-semibold">{tab.label}</span>
                    <span className="hidden text-[11px] font-normal text-muted-foreground xl:block">
                      {tab.description}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </>
      ) : null}

      {activeReportWorkspaceTab === "home" ? (
        <section className="space-y-4" aria-labelledby="reports-home-title">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]">
            <Card className="border-card-border">
              <CardHeader className="space-y-3 pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle id="reports-home-title" className="text-xl">
                      {tr("reportingCommandCenter")}
                    </CardTitle>
                    <CardDescription>{personaScopeDescription}</CardDescription>
                  </div>
                  <Badge
                    variant={reportAutomationOperationsNeedingReview > 0 ? "warning" : "success"}
                    dot
                    className="w-fit"
                  >
                    {reportAutomationOperationsNeedingReview > 0
                      ? tr("needAction", { reportAutomationOperationsNeedingReview })
                      : tr("ready")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{tr("readyReports")}</div>
                    <div dir="ltr" className="mt-1 font-mono text-2xl font-semibold">
                      {reportStats.ready}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{tr("liveReports")}</div>
                    <div dir="ltr" className="mt-1 font-mono text-2xl font-semibold">
                      {reportStats.live}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{tr("automations")}</div>
                    <div dir="ltr" className="mt-1 font-mono text-2xl font-semibold">
                      {reportStats.automationStarters}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{tr("openQueue")}</div>
                    <div dir="ltr" className="mt-1 font-mono text-2xl font-semibold">
                      {automationQueueCount}
                    </div>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={reportWorkflowSearch}
                      onChange={(event) => updateReportWorkflowSearch(event.target.value)}
                      placeholder={tr("searchReportsPacksComparisonsAutomations")}
                      className="ps-9"
                      data-testid="input-report-home-search"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReportWorkspaceTab("reports")}
                    data-testid="button-report-home-search-open"
                  >
                    {tr("searchLibrary")}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start"
                    onClick={() => setReportWorkspaceTab("reports")}
                  >
                    <FileText className="h-4 w-4" />
                    {tr("reports")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start"
                    onClick={() => setReportWorkspaceTab("comparisons")}
                  >
                    <BarChart3 className="h-4 w-4" />
                    {tr("compare")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start"
                    onClick={() => setReportWorkspaceTab("automation")}
                  >
                    <Sparkles className="h-4 w-4" />
                    {tr("automate")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start"
                    onClick={() => setReportWorkspaceTab("delivery")}
                  >
                    <Send className="h-4 w-4" />
                    {tr("delivery")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-card-border">
              <CardHeader className="space-y-3 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{tr("nextAutomation")}</CardTitle>
                    <CardDescription>
                      {reportHomeAutomationOperation?.workspace.title ?? personaFilterLabel}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={reportHomeAutomationOperation?.statusVariant ?? "neutral"}
                    dot
                    className="w-fit"
                  >
                    {reportHomeAutomationOperation?.status ?? tr("noRoleSelected")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {reportHomeAutomationOperation ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("health")}</div>
                        <div dir="ltr" className="mt-1 font-mono text-lg font-semibold">
                          {reportHomeAutomationOperation.automationScore}/100
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("atRisk")}</div>
                        <div dir="ltr" className="mt-1 truncate font-mono text-sm font-semibold">
                          {formatCurrency(
                            reportHomeAutomationOperation.amountAtRisk,
                            "AED",
                            locale
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-md border p-3 text-sm">
                      <div className="font-medium text-foreground">
                        {reportHomeAutomationOperation.nextAction.label}
                      </div>
                      <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {reportHomeAutomationOperation.nextAction.detail}
                      </div>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href={reportHomeAutomationOperation.nextAction.href}>
                        {tr("openAction")} <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </>
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    {tr("selectARoleToShowThe")}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">{tr("topReports")}</h2>
                <p className="text-sm text-muted-foreground">
                  {tr("shortcutsFromTheActiveQuickAccess", { personaFilterLabel })}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setReportWorkspaceTab("reports")}
              >
                {tr("allReports")}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>

            {reportHomeQuickReports.length ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {reportHomeQuickReports.map(
                  ({ report, href, workflowHref, comparisonHref, deliveryHref, profile }) => (
                    <Card key={`${profile.persona}-${report.id}`} className="border-card-border">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-foreground">
                              {report.name}
                            </div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">
                              {report.category} · {profile.workspace.navLabel}
                            </div>
                          </div>
                          <Badge variant={report.status === "planned" ? "warning" : "success"} dot>
                            {getReportStatusMeta()[report.status].label}
                          </Badge>
                        </div>
                        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {report.decisionQuestion}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button asChild size="sm">
                            <Link href={href}>{tr("open")}</Link>
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <Link href={workflowHref}>{tr("automate")}</Link>
                          </Button>
                          {comparisonHref ? (
                            <Button asChild size="sm" variant="ghost">
                              <Link href={comparisonHref}>{tr("compare")}</Link>
                            </Button>
                          ) : null}
                          {deliveryHref ? (
                            <Button asChild size="sm" variant="ghost">
                              <Link href={deliveryHref}>{tr("schedule")}</Link>
                            </Button>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  )
                )}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {tr("noQuickAccessReportsMatchThe")}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="border-card-border">
              <CardHeader className="space-y-2 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{tr("suites")}</CardTitle>
                    <CardDescription>{tr("reportPacksReadyForRecurringReview")}</CardDescription>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setReportWorkspaceTab("suites")}
                  >
                    {tr("openSuites")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {reportHomeSuites.map((suite) => (
                  <div
                    key={suite.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{suite.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{suite.workflow}</div>
                    </div>
                    <Badge
                      variant={suite.readyCount === suite.reports.length ? "success" : "warning"}
                      dot
                    >
                      {suite.readyCount}/{suite.reports.length}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-card-border">
              <CardHeader className="space-y-2 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{tr("savedViews")}</CardTitle>
                    <CardDescription>{tr("reusableFiltersAndComparisonPresets")}</CardDescription>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setReportWorkspaceTab("reports")}
                  >
                    {tr("openViews")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {reportHomeSavedViews.length ? (
                  reportHomeSavedViews.map((view) => (
                    <Link key={view.id} href={view.href}>
                      <div className="rounded-md border p-3 text-sm transition-colors hover:bg-accent/5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{view.title}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {view.report.name} · {view.comparisonPeriod}
                            </div>
                          </div>
                          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    {tr("noSavedViewsMatchTheCurrent")}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}

      <section
        className={reportWorkspacePanelClass("suites", "space-y-4")}
        aria-labelledby="report-suites-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-suites-title" className="text-xl font-semibold">
              {tr("reportSuites")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("roleBasedBundlesThatCombineReports")}
            </p>
          </div>
          <Badge variant="info" dot>
            {tr("suites2", {
              visibleReportSuiteSummariesCount: visibleReportSuiteSummaries.length,
            })}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3" data-testid="report-suites">
          {visibleReportSuiteSummaries.map((suite) => {
            const WorkspaceIcon = suite.workspace.icon;
            const suiteDeliverySubscription = reportDeliverySubscriptionSummaries.find(
              (subscription) => subscription.id === suite.deliverySubscriptionId
            );
            const suiteRequiresHandoffAcknowledgement =
              reportDeliverySubscriptionHasReviewHandoff(suite.deliverySubscriptionId) &&
              !isReportDeliveryHandoffAcknowledged(suite.deliverySubscriptionId);
            const isQueueingThisSuiteDelivery =
              queueReportDeliverySubscription.isPending &&
              queueReportDeliverySubscription.variables?.subscriptionId ===
                suite.deliverySubscriptionId;
            const isSuiteDeliveryPaused = suiteDeliverySubscription?.enabled === false;
            const suiteQueueLabel = isQueueingThisSuiteDelivery
              ? tr("queueing")
              : suiteRequiresHandoffAcknowledgement
                ? tr("acknowledgeHandoff")
                : isSuiteDeliveryPaused
                  ? "Paused"
                  : tr("queueDelivery");

            return (
              <Card
                key={suite.id}
                id={`report-suite-${suite.id}`}
                data-testid={`report-suite-${suite.id}`}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">{suite.title}</CardTitle>
                        <CardDescription>{suite.workflow}</CardDescription>
                      </div>
                    </div>
                    <Badge
                      variant={suite.readyCount === suite.reports.length ? "success" : "warning"}
                      dot
                    >
                      {suite.readyCount}/{suite.reports.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">{suite.outcome}</p>

                  <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">{tr("comparison")}</div>
                      <div className="mt-1 truncate font-medium text-foreground">
                        {suite.comparisonPreset.title}
                      </div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">{tr("pack")}</div>
                      <div className="mt-1 truncate font-medium text-foreground">
                        {suite.packTemplate.cadence}
                      </div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">{tr("automation")}</div>
                      <div className="mt-1 truncate font-medium text-foreground">
                        {suite.automationStarter.setupTime}
                      </div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">{tr("triggerRules")}</div>
                      <div dir="ltr" className="mt-1 font-mono font-medium text-foreground">
                        {suite.triggerRules.length}
                      </div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">{tr("delivery")}</div>
                      <div className="mt-1 truncate font-medium text-foreground">
                        {suite.deliverySubscription.channel}
                      </div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">{tr("savedViews")}</div>
                      <div dir="ltr" className="mt-1 font-mono font-medium text-foreground">
                        {suite.savedViews.length}
                      </div>
                    </div>
                  </div>

                  <div
                    className="rounded-md border border-border/70 bg-secondary/30 p-3 text-xs"
                    data-testid={`report-suite-delivery-readiness-${suite.id}`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="font-medium text-foreground">{tr("deliveryReadiness")}</div>
                        <div className="mt-1 text-muted-foreground">
                          {suiteDeliverySubscription
                            ? `${suiteDeliverySubscription.channel} · ${
                                suiteDeliverySubscription.nextRunLabel ||
                                "Next run calculated on queue"
                              }`
                            : suite.deliverySubscription.channel}
                        </div>
                      </div>
                      <Badge
                        variant={suiteDeliverySubscription?.statusVariant ?? "neutral"}
                        dot
                        className="w-fit"
                      >
                        {suiteRequiresHandoffAcknowledgement
                          ? tr("handoffReview")
                          : (suiteDeliverySubscription?.status ?? tr("catalog"))}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {suite.reports.slice(0, 5).map((report) => (
                      <Badge key={report.id} variant="outline">
                        {report.name}
                      </Badge>
                    ))}
                    {suite.reports.length > 5 ? (
                      <Badge variant="neutral">+{suite.reports.length - 5}</Badge>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    <Button asChild size="sm" variant="outline" className="justify-start">
                      <Link href={suite.comparisonHref}>
                        <BarChart3 className="h-3.5 w-3.5" />
                        {tr("compare")}
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="justify-start">
                      <Link href={suite.packHref}>
                        <FileText className="h-3.5 w-3.5" />
                        {tr("pack")}
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost" className="justify-start text-accent">
                      <Link href={suite.automationHref}>
                        <Sparkles className="h-3.5 w-3.5" />
                        {tr("autopilot")}
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost" className="justify-start text-accent">
                      <Link href={suite.deliveryHref}>
                        <Send className="h-3.5 w-3.5" />
                        {tr("delivery")}
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="justify-start"
                      disabled={
                        !selectedCompanyId ||
                        queueReportDeliverySubscription.isPending ||
                        isSuiteDeliveryPaused
                      }
                      onClick={() =>
                        queueReportDeliverySubscriptionWithHandoffGuard(
                          suite.deliverySubscriptionId
                        )
                      }
                      data-testid={`report-suite-queue-delivery-${suite.id}`}
                    >
                      <Send className="h-3.5 w-3.5" />
                      {suiteQueueLabel}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section
        className={reportWorkspacePanelClass("suites", "space-y-4")}
        aria-labelledby="report-management-briefs-title"
        data-testid="report-management-briefs"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-management-briefs-title" className="text-xl font-semibold">
              {tr("managementPackBriefs")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("advisoryReadyKpiNarrativeDimensionalAnd", { personaScopeDescription })}
            </p>
          </div>
          <Badge variant="info" dot>
            {tr("briefs", {
              visibleReportManagementBriefSummariesCount:
                visibleReportManagementBriefSummaries.length,
            })}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleReportManagementBriefSummaries.map((brief) => {
            const WorkspaceIcon = brief.workspace.icon;

            return (
              <Card
                key={brief.id}
                id={`report-management-brief-${brief.id}`}
                data-testid={`report-management-brief-${brief.id}`}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">{brief.title}</CardTitle>
                        <CardDescription>{brief.audience}</CardDescription>
                      </div>
                    </div>
                    <Badge
                      variant={brief.readyCount === brief.reports.length ? "success" : "warning"}
                      dot
                    >
                      {brief.readyCount}/{brief.reports.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">{brief.outcome}</p>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">{tr("kpis")}</div>
                      <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
                        {brief.kpiMetricIds.length}
                      </div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">{tr("narratives")}</div>
                      <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
                        {brief.narrativeSections.length}
                      </div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">{tr("dimensions")}</div>
                      <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
                        {brief.dimensionBreakdowns.length}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      {tr("kpiWidgets")}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {brief.kpiWidgets.map((widget) => (
                        <div
                          key={widget.id}
                          className="rounded-md border p-2 text-xs"
                          data-testid={`report-management-brief-kpi-${widget.id}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-foreground">{widget.label}</div>
                            <Badge variant="outline">{widget.display}</Badge>
                          </div>
                          <div className="mt-1 text-muted-foreground">{widget.question}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      {tr("narrativeSections")}
                    </div>
                    {brief.narrativeSections.map((section) => (
                      <div
                        key={section.id}
                        className="rounded-md border p-3"
                        data-testid={`report-management-brief-narrative-${section.id}`}
                      >
                        <div className="text-sm font-medium text-foreground">{section.title}</div>
                        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {section.prompt}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge variant="outline">
                            {tr("reports2", {
                              sourceReportIdsCount: section.sourceReportIds.length,
                            })}
                          </Badge>
                          <Badge variant="outline">
                            {tr("metrics2", {
                              comparisonMetricIdsCount: section.comparisonMetricIds.length,
                            })}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      {tr("dimensionalLenses")}
                    </div>
                    <div className="grid gap-2">
                      {brief.dimensionBreakdowns.map((dimension) => (
                        <div
                          key={dimension.id}
                          className="rounded-md bg-muted/30 p-2 text-xs"
                          data-testid={`report-management-brief-dimension-${dimension.id}`}
                        >
                          <div className="font-medium text-foreground">{dimension.label}</div>
                          <div className="mt-1 text-muted-foreground">
                            {dimension.dimension} · {dimension.question}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {brief.batchAction ? (
                    <div
                      className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs"
                      data-testid={`report-management-brief-batch-${brief.id}`}
                    >
                      <div className="font-medium text-foreground">{brief.batchAction.label}</div>
                      <div className="mt-1 text-muted-foreground">{brief.batchAction.detail}</div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link href={brief.href}>
                        {tr("openBrief")} <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={brief.suiteHref}>{tr("openSuite")}</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={brief.deliveryHref}>{tr("openDelivery")}</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section
        className={reportDiscoveryPanelClass("space-y-4")}
        aria-labelledby="report-quick-access-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-quick-access-title" className="text-xl font-semibold">
              {tr("quickAccessReports")}
            </h2>
            <p className="text-sm text-muted-foreground">{tr("roleSpecificLaunchBoardsForThe")}</p>
          </div>
          <Badge variant="info" dot>
            {tr("boards", {
              visibleReportQuickAccessSummariesCount: visibleReportQuickAccessSummaries.length,
            })}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3" data-testid="report-quick-access">
          {visibleReportQuickAccessSummaries.map((profile) => {
            const WorkspaceIcon = profile.workspace.icon;

            return (
              <Card
                key={profile.id}
                id={`report-quick-access-${profile.id}`}
                data-testid={`report-quick-access-${profile.persona}`}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">{profile.title}</CardTitle>
                        <CardDescription>{profile.outcome}</CardDescription>
                      </div>
                    </div>
                    <Badge
                      variant={
                        profile.readyCount === profile.reports.length ? "success" : "warning"
                      }
                      dot
                    >
                      {profile.readyCount}/{profile.reports.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    {profile.primaryReports.map(
                      ({ report, href, workflowHref, comparisonHref, deliveryHref }) => (
                        <div
                          key={report.id}
                          className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                          data-testid={`report-quick-access-report-${report.id}`}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">
                              {report.name}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {report.category} · {report.comparison}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                            <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                              <Link href={href}>{tr("open")}</Link>
                            </Button>
                            <Button asChild size="sm" variant="outline" className="h-7 px-2">
                              <Link
                                href={workflowHref}
                                data-testid={`report-quick-access-report-automation-${report.id}`}
                              >
                                {tr("automate")}
                              </Link>
                            </Button>
                            {comparisonHref ? (
                              <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                                <Link
                                  href={comparisonHref}
                                  data-testid={`report-quick-access-report-comparison-${report.id}`}
                                >
                                  {tr("compare")}
                                </Link>
                              </Button>
                            ) : null}
                            {deliveryHref ? (
                              <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                                <Link
                                  href={deliveryHref}
                                  data-testid={`report-quick-access-report-delivery-${report.id}`}
                                >
                                  {tr("schedule")}
                                </Link>
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      )
                    )}
                  </div>

                  {profile.additionalReports.length > 0 ? (
                    <div
                      className="rounded-md border bg-muted/20 p-3"
                      data-testid={`report-quick-access-more-${profile.persona}`}
                    >
                      <div className="text-[11px] font-semibold uppercase text-muted-foreground">
                        {tr("moreReports")}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {profile.additionalReports.map(({ report, href }) => (
                          <Button
                            key={report.id}
                            asChild
                            size="sm"
                            variant="secondary"
                            className="h-7 max-w-full justify-start px-2"
                          >
                            <Link href={href}>
                              <span className="truncate">{report.name}</span>
                            </Link>
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                    <Button asChild size="sm" variant="outline" className="h-auto justify-start">
                      <Link href={profile.comparisonHref}>
                        <BarChart3 className="h-3.5 w-3.5" />
                        {tr("comparison")}
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="h-auto justify-start">
                      <Link href={profile.automationHref}>
                        <Sparkles className="h-3.5 w-3.5" />
                        {tr("autopilot")}
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="h-auto justify-start">
                      <Link href={profile.deliveryHref}>
                        <Send className="h-3.5 w-3.5" />
                        {tr("delivery")}
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section
        className={reportDiscoveryPanelClass("space-y-4")}
        aria-labelledby="report-saved-views-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-saved-views-title" className="text-xl font-semibold">
              {tr("savedReportViews")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("prebuiltReportViewPresetsWithDate")}
            </p>
          </div>
          <Badge variant="info" dot>
            {tr("views", {
              visibleReportSavedViewSummariesCount: visibleReportSavedViewSummaries.length,
            })}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="report-saved-views">
          {visibleReportSavedViewSummaries.map((view) => (
            <Card
              key={view.id}
              id={`report-saved-view-${view.id}`}
              data-testid={`report-saved-view-${view.id}`}
            >
              <CardHeader className="space-y-3 pb-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <CardTitle className="text-base font-semibold">{view.title}</CardTitle>
                    <CardDescription>{view.description}</CardDescription>
                  </div>
                  <Badge variant="info" className="capitalize">
                    {view.persona}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
                  {[
                    [tr("dateRange"), view.dateRangePreset],
                    [tr("comparison"), view.comparisonPeriod],
                    [tr("basis"), view.basis],
                    [tr("currency"), view.currency],
                    [tr("dimension"), view.dimension],
                    [tr("export"), view.exportFormat],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border p-2">
                      <div className="text-muted-foreground">{label}</div>
                      <div className="mt-1 truncate font-medium text-foreground">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-md bg-muted/30 p-3 text-xs leading-relaxed">
                  <div className="font-medium text-foreground">{view.report.name}</div>
                  <div className="mt-1 text-muted-foreground">{view.automationTrigger}</div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={view.reportHref}>{tr("openReport")}</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href={view.comparisonHref}>{tr("openComparison")}</Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost" className="text-accent">
                    <Link
                      href={view.workflowHref}
                      data-testid={`report-saved-view-automation-${view.id}`}
                    >
                      {tr("openAutomation")} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section
        className={reportWorkspacePanelClass("delivery", "space-y-4")}
        aria-labelledby="report-accountant-handoff-title"
        data-testid="report-accountant-handoff"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-accountant-handoff-title" className="text-xl font-semibold">
              {tr("accountantHandoff")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("shareRoleSpecificReportContextReadiness")}
            </p>
          </div>
          <Badge variant={reportAutomationOperationsNeedingReview > 0 ? "warning" : "success"} dot>
            {reportAutomationOperationsNeedingReview > 0
              ? tr("handoffsNeedAction", { reportAutomationOperationsNeedingReview })
              : tr("handoffsReady")}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {reportAccountantHandoffSummaries.map((item) => (
            <Card
              key={item.workspace.persona}
              data-testid={`report-accountant-handoff-${item.workspace.persona}`}
            >
              <CardHeader className="space-y-3 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base font-semibold">
                      {item.workspace.navLabel}
                    </CardTitle>
                    <CardDescription>{item.workspace.automationOutcome}</CardDescription>
                  </div>
                  <Badge variant={item.statusVariant} dot>
                    {item.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">{tr("reports")}</div>
                    <div dir="ltr" className="mt-1 font-mono font-semibold text-foreground">
                      {item.readyReportCount}/{item.reportCount}
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">{tr("rules")}</div>
                    <div dir="ltr" className="mt-1 font-mono font-semibold text-foreground">
                      {item.readyRuleCount}/{item.automationRuleCount}
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">{tr("delivery")}</div>
                    <div dir="ltr" className="mt-1 font-mono font-semibold text-foreground">
                      {item.readyDeliveryCount}/{item.deliverySubscriptionCount}
                    </div>
                  </div>
                </div>

                <div className="rounded-md bg-muted/30 p-3 text-xs leading-relaxed">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{item.priorityGapLabel}</span>
                    <Badge variant={item.nextAction.badgeVariant}>{item.nextAction.badge}</Badge>
                  </div>
                  <p className="mt-2 text-muted-foreground">{item.nextAction.detail}</p>
                  <div className="mt-2 text-muted-foreground">
                    {tr("amountAtRisk3")}
                    <span dir="ltr" className="font-mono text-foreground">
                      {formatCurrency(item.amountAtRisk, "AED", locale)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={item.shareHref}
                      data-testid={`report-accountant-handoff-share-${item.workspace.persona}`}
                    >
                      {tr("openSharedView")}
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={item.gapHref}
                      data-testid={`report-accountant-handoff-gap-${item.workspace.persona}`}
                    >
                      {item.priorityGap ? tr("reviewGap") : tr("openFinder")}
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost" className="text-accent">
                    <Link
                      href={item.nextAction.href}
                      data-testid={`report-accountant-handoff-action-${item.workspace.persona}`}
                    >
                      {tr("nextAction")}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="report-workflow-readiness-title"
        data-testid="report-workflow-readiness"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-workflow-readiness-title" className="text-xl font-semibold">
              {tr("automationReadiness")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("roleSpecificCoverageGapsBeforeReport")}
            </p>
          </div>
          <Badge variant={reportAutomationOperationsNeedingReview > 0 ? "warning" : "success"} dot>
            {reportAutomationOperationsNeedingReview > 0
              ? tr("needReview", { reportAutomationOperationsNeedingReview })
              : tr("readyByRole")}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {visibleReportAutomationOperations.map((item) => (
            <div
              key={item.workspace.persona}
              className="rounded-md border border-border/70 p-4"
              data-testid={`report-workflow-readiness-${item.workspace.persona}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {item.workspace.navLabel}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {tr("reportsReady2", {
                      readyReportCount: item.readyReportCount,
                      reportCount: item.reportCount,
                    })}
                  </div>
                </div>
                <Badge variant={item.statusVariant} dot>
                  {item.status}
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">{tr("score")}</div>
                  <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
                    {item.automationScore}%
                  </div>
                </div>
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">{tr("rules")}</div>
                  <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
                    {item.readyRuleCount}/{item.automationRuleCount}
                  </div>
                </div>
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">{tr("delivery")}</div>
                  <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
                    {item.readyDeliveryCount}/{item.deliverySubscriptionCount}
                  </div>
                </div>
              </div>

              <div
                className="mt-3 text-xs text-muted-foreground"
                data-testid={`report-workflow-readiness-gap-${item.workspace.persona}`}
              >
                {tr("reportGapsRuleGapsDeliveryGaps2", {
                  reportGapCount: item.reportGapCount,
                  automationRuleGapCount: item.automationRuleGapCount,
                  deliveryGapCount: item.deliveryGapCount,
                })}
              </div>

              <div
                className="mt-3 flex flex-wrap gap-2"
                data-testid={`report-workflow-readiness-filters-${item.workspace.persona}`}
              >
                <Button
                  type="button"
                  size="sm"
                  variant={
                    reportWorkflowGapFilter.type === "report-gaps" &&
                    reportWorkflowGapFilter.persona === item.workspace.persona
                      ? "default"
                      : "outline"
                  }
                  className="h-7 px-2"
                  disabled={item.reportGapCount === 0}
                  onClick={() =>
                    applyReportWorkflowGapFilter("report-gaps", item.workspace.persona)
                  }
                  data-testid={`report-workflow-filter-report-gaps-${item.workspace.persona}`}
                >
                  {tr("reportGaps")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    reportWorkflowGapFilter.type === "rule-gaps" &&
                    reportWorkflowGapFilter.persona === item.workspace.persona
                      ? "default"
                      : "outline"
                  }
                  className="h-7 px-2"
                  disabled={item.automationRuleGapCount === 0}
                  onClick={() => applyReportWorkflowGapFilter("rule-gaps", item.workspace.persona)}
                  data-testid={`report-workflow-filter-rule-gaps-${item.workspace.persona}`}
                >
                  {tr("ruleGaps")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    reportWorkflowGapFilter.type === "delivery-gaps" &&
                    reportWorkflowGapFilter.persona === item.workspace.persona
                      ? "default"
                      : "outline"
                  }
                  className="h-7 px-2"
                  disabled={item.deliveryGapCount === 0}
                  onClick={() =>
                    applyReportWorkflowGapFilter("delivery-gaps", item.workspace.persona)
                  }
                  data-testid={`report-workflow-filter-delivery-gaps-${item.workspace.persona}`}
                >
                  {tr("deliveryGaps")}
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Badge variant={item.nextAction.badgeVariant}>{item.nextAction.badge}</Badge>
                <Button asChild size="sm" variant="outline" className="h-7 px-2">
                  <Link
                    href={item.nextAction.href}
                    data-testid={`report-workflow-readiness-action-${item.workspace.persona}`}
                  >
                    {item.nextAction.label}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        className={reportDiscoveryPanelClass("space-y-4")}
        aria-labelledby="report-workflow-finder-title"
        id="report-workflow-finder"
        data-testid="report-workflow-finder"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="report-workflow-finder-title" className="text-xl font-semibold">
              {tr("workflowFinder")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("reportsPacksComparisonsDeliveryRoutesAnd", {
                personaFilterLabel: personaFilterLabel.toLowerCase(),
              })}
            </p>
          </div>
          <Badge variant="info" dot data-testid="report-workflow-finder-count">
            {tr("matches", {
              filteredReportWorkflowFinderResultsCount: filteredReportWorkflowFinderResults.length,
            })}
          </Badge>
        </div>

        {activeReportWorkflowGapFilterLabel ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" data-testid="report-workflow-active-gap-filter">
              {activeReportWorkflowGapFilterLabel}
            </Badge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2"
              onClick={clearReportWorkflowGapFilter}
              data-testid="button-clear-report-workflow-gap-filter"
            >
              <X className="h-3.5 w-3.5" />
              {tr("clearFilter")}
            </Button>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={reportWorkflowSearch}
              onChange={(event) => updateReportWorkflowSearch(event.target.value)}
              placeholder={tr("searchReportsPacksComparisonsAutomations")}
              className="ps-9"
              data-testid="input-report-workflow-search"
            />
          </div>
          {reportWorkflowSearch ? (
            <Button
              type="button"
              variant="outline"
              onClick={clearReportWorkflowSearch}
              data-testid="button-clear-report-workflow-search"
            >
              <X className="h-4 w-4" />
              {tr("clear")}
            </Button>
          ) : null}
        </div>

        {reportWorkflowFinderResults.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {reportWorkflowFinderResults.map((result) => (
              <div
                key={result.id}
                className="rounded-md border border-border/70 p-4 transition-colors hover:bg-accent/5"
                data-testid={`report-workflow-finder-result-${result.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={result.badgeVariant}>{result.type}</Badge>
                      {result.persona ? (
                        <Badge variant="outline" className="capitalize">
                          {result.persona}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 truncate text-sm font-semibold text-foreground">
                      {result.title}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {result.description}
                    </p>
                  </div>
                </div>
                <div className="mt-3 truncate text-xs text-muted-foreground">{result.meta}</div>
                <div
                  className="mt-3 flex flex-wrap gap-1.5"
                  data-testid={`report-workflow-coverage-${result.id}`}
                >
                  {result.coverageCues.map((cue) => (
                    <Badge
                      key={cue.id}
                      variant={cue.variant}
                      title={cue.detail}
                      data-testid={`report-workflow-coverage-${result.id}-${cue.id}`}
                    >
                      {cue.label}
                    </Badge>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={result.href}
                      data-testid={`report-workflow-finder-result-open-${result.id}`}
                    >
                      {tr("open")}
                    </Link>
                  </Button>
                  {result.actionLinks?.map((action) => (
                    <Button key={action.testId} asChild size="sm" variant="outline">
                      <Link href={action.href} data-testid={action.testId}>
                        {action.label}
                      </Link>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
            data-testid="report-workflow-finder-empty"
          >
            {tr("noReportWorkflowsMatchTheCurrent")}
          </div>
        )}
      </section>

      <section
        className={reportDiscoveryPanelClass("space-y-4")}
        aria-labelledby="report-catalog-readiness-title"
        data-testid="reports-catalog-discovery-summary"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-catalog-readiness-title" className="text-xl font-semibold">
              {tr("catalogReadiness")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("apiSyncedReportLibraryCoverageFor", { personaScopeDescription })}
            </p>
          </div>
          <Badge
            variant={
              reportCatalogDiscoveryQuery.isLoading
                ? "neutral"
                : reportCatalogDiscoveryQuery.isError
                  ? "warning"
                  : "success"
            }
            dot
            data-testid="reports-catalog-discovery-status"
          >
            {reportCatalogDiscoveryQuery.isLoading
              ? tr("syncingCatalog")
              : reportCatalogDiscoveryQuery.isError
                ? tr("localCatalogFallback")
                : tr("catalogSynced")}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{tr("reportsReady3")}</div>
            <div dir="ltr" className="mt-1 font-mono text-2xl font-semibold">
              {reportStats.ready}/{reportStats.total}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {tr("livePlanned", { live: reportStats.live, planned: reportStats.planned })}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{tr("packTemplates")}</div>
            <div dir="ltr" className="mt-1 font-mono text-2xl font-semibold">
              {reportStats.packTemplates}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {tr("suitesDelivery", {
                reportSuites: reportStats.reportSuites,
                deliverySubscriptions: reportStats.deliverySubscriptions,
              })}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{tr("comparisonPresets")}</div>
            <div dir="ltr" className="mt-1 font-mono text-2xl font-semibold">
              {reportStats.comparisonPresets}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {tr("quickBoardsCurrentVsPriorPaths", {
                quickAccessProfiles: reportStats.quickAccessProfiles,
              })}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{tr("automationStarters")}</div>
            <div dir="ltr" className="mt-1 font-mono text-2xl font-semibold">
              {reportStats.automationStarters}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {tr("playbooksImpactProfiles", {
                automationPlaybooks: reportStats.automationPlaybooks,
                automationImpactProfiles: reportStats.automationImpactProfiles,
              })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {visibleWorkspaceSummaries.map((workspace) => {
            const WorkspaceIcon = workspace.icon;
            return (
              <Link key={workspace.persona} href={reportWorkspaceHref(workspace)}>
                <div
                  className="rounded-md border border-border/70 p-4 transition-colors hover:bg-accent/5"
                  data-testid={`reports-catalog-persona-summary-${workspace.persona}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {workspace.title}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {workspace.focus}
                        </div>
                      </div>
                    </div>
                    <Badge variant={workspace.readyReports > 0 ? "success" : "neutral"} dot>
                      {workspace.readyReports}/{workspace.catalogReportCount}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-md bg-secondary/40 p-2">
                      <div className="text-muted-foreground">{tr("packs")}</div>
                      <div dir="ltr" className="mt-1 font-mono font-semibold">
                        {workspace.packTemplateCount}
                      </div>
                    </div>
                    <div className="rounded-md bg-secondary/40 p-2">
                      <div className="text-muted-foreground">{tr("comps")}</div>
                      <div dir="ltr" className="mt-1 font-mono font-semibold">
                        {workspace.comparisonPresetCount}
                      </div>
                    </div>
                    <div className="rounded-md bg-secondary/40 p-2">
                      <div className="text-muted-foreground">{tr("starters")}</div>
                      <div dir="ltr" className="mt-1 font-mono font-semibold">
                        {workspace.automationStarterCount}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section
        className={reportWorkspacePanelClass("setup", "space-y-4")}
        aria-labelledby="report-role-setup-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-role-setup-title" className="text-xl font-semibold">
              {tr("roleSetupPaths")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("firstRunChecklistsForOwnersSolo", { personaScopeDescription })}
            </p>
          </div>
          <Badge variant="outline">
            {visibleWorkspaceSummaries.reduce(
              (total, workspace) => total + workspace.setupStepCount,
              0
            )}{" "}
            {tr("steps")}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleWorkspaceSummaries.map((workspace) => (
            <Card key={workspace.persona} data-testid={`report-role-setup-${workspace.persona}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-semibold">{workspace.navLabel}</CardTitle>
                    <CardDescription>{workspace.automationOutcome}</CardDescription>
                  </div>
                  <Badge variant="info">
                    {tr("steps2", { setupStepCount: workspace.setupStepCount })}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {workspace.setupChecklist.map((step, index) => (
                  <Link key={step.id} href={step.href}>
                    <div
                      className="rounded-md border p-3 transition-colors hover:bg-accent/5"
                      data-testid={`report-role-setup-step-${step.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{step.title}</div>
                          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {step.outcome}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Badge variant="outline">
                              {tr("reports3", { reportsCount: step.reports.length })}
                            </Badge>
                            <Badge variant="outline">{step.command}</Badge>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section
        className={reportWorkspacePanelClass("setup", "space-y-4")}
        aria-labelledby="report-role-workflows-title"
        data-testid="report-role-workflows"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-role-workflows-title" className="text-xl font-semibold">
              {tr("roleWorkflowChecklist")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("recurringReportRoutinesForOwnerFreelancer", { personaScopeDescription })}
            </p>
          </div>
          <Badge variant="info">
            {visibleWorkspaceSummaries.reduce(
              (total, workspace) => total + workspace.workflowStepCount,
              0
            )}{" "}
            {tr("workflows")}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleWorkspaceSummaries.map((workspace) => {
            const WorkspaceIcon = workspace.icon;

            return (
              <Card
                key={workspace.persona}
                data-testid={`report-role-workflows-${workspace.persona}`}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">
                          {workspace.navLabel}
                        </CardTitle>
                        <CardDescription>{workspace.focus}</CardDescription>
                      </div>
                    </div>
                    <Badge variant="outline">
                      {tr("workflows2", { workflowStepCount: workspace.workflowStepCount })}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {workspace.workflowSteps.map((step, index) => (
                    <div
                      key={step.id}
                      id={`report-role-workflow-step-${step.id}`}
                      className="rounded-md border p-3"
                      data-testid={`report-role-workflow-step-${step.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold">
                          {index + 1}
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground">
                                {step.title}
                              </div>
                              <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                {step.outcome}
                              </div>
                            </div>
                            <Badge variant="neutral">{step.cadence}</Badge>
                          </div>

                          <div className="flex flex-wrap gap-1">
                            <Badge variant="outline">
                              {tr("reports3", { reportsCount: step.reports.length })}
                            </Badge>
                            {step.reportSuite ? (
                              <Badge variant="outline">{step.reportSuite.workflow}</Badge>
                            ) : null}
                            {step.savedView ? (
                              <Badge variant="outline">{step.savedView.dateRangePreset}</Badge>
                            ) : null}
                          </div>

                          <div
                            className="grid grid-cols-1 gap-2 rounded-md bg-secondary/30 p-2 text-xs md:grid-cols-2"
                            data-testid={`report-role-workflow-defaults-${step.id}`}
                          >
                            <div>
                              <div className="font-medium text-foreground">{tr("defaultView")}</div>
                              <Link
                                href={step.defaultViewHref}
                                className="mt-1 block text-muted-foreground hover:text-primary"
                              >
                                {step.defaultViewLabel}
                              </Link>
                            </div>
                            <div>
                              <div className="font-medium text-foreground">
                                {tr("handoffGuardrail")}
                              </div>
                              <div className="mt-1 text-muted-foreground">
                                {step.handoffGuardrail}
                              </div>
                              <div className="mt-1 text-muted-foreground">
                                {tr("recipients2", { handoffRecipients: step.handoffRecipients })}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button asChild size="sm">
                              <Link href={step.href}>
                                {step.primaryAction} <ArrowRight className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                            <Button asChild size="sm" variant="outline">
                              <Link href={step.automationHref}>{tr("openAutomation")}</Link>
                            </Button>
                            <Button asChild size="sm" variant="outline">
                              <Link href={step.deliveryHref}>{tr("openDelivery")}</Link>
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="report-automation-operations-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-automation-operations-title" className="text-xl font-semibold">
              {tr("reportAutomationOperations")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("oneOperatingViewForReportReadiness", { personaScopeDescription })}
            </p>
          </div>
          <Badge variant={reportAutomationOperationsNeedingReview > 0 ? "warning" : "success"} dot>
            {tr("needAction", { reportAutomationOperationsNeedingReview })}
          </Badge>
        </div>

        {reportAutomationOperationsLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {visibleReportAutomationOperations.map((item) => {
              const workspace = item.workspace;
              const WorkspaceIcon = workspace.icon;

              return (
                <Card
                  key={workspace.persona}
                  data-testid={`report-automation-operations-${workspace.persona}`}
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">
                            {workspace.title}
                          </CardTitle>
                          <CardDescription>{workspace.automationOutcome}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={item.statusVariant} dot>
                        {item.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{tr("health")}</div>
                        <div className="mt-1 flex items-baseline gap-1">
                          <span dir="ltr" className="font-mono text-lg font-semibold">
                            {item.automationScore}
                          </span>
                          <span className="text-xs text-muted-foreground">/100</span>
                        </div>
                        <Badge variant={item.automationHealthVariant} dot className="mt-2">
                          {tr("automation")}
                        </Badge>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{tr("reportsReady3")}</div>
                        <div dir="ltr" className="mt-1 font-mono text-lg font-semibold">
                          {item.readyReportCount}/{item.reportCount}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {tr("recommendedActions2", {
                            recommendationCount: item.recommendationCount,
                          })}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{tr("autoSendRules")}</div>
                        <div dir="ltr" className="mt-1 font-mono text-lg font-semibold">
                          {item.readyRuleCount}/{item.automationRuleCount}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {tr("openWorkItems3", { openWorkItemCount: item.openWorkItemCount })}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          {tr("deliveriesReady2")}
                        </div>
                        <div dir="ltr" className="mt-1 font-mono text-lg font-semibold">
                          {item.readyDeliveryCount}/{item.deliverySubscriptionCount}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {tr("failedRuns", { failedRunCount: item.failedRunCount })}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-medium uppercase text-muted-foreground">
                          {tr("nextAction")}
                        </div>
                        <Badge variant={item.nextAction.badgeVariant} dot>
                          {item.nextAction.badge}
                        </Badge>
                      </div>
                      <div className="mt-2 text-sm font-semibold text-foreground">
                        {item.nextAction.label}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {item.nextAction.detail}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link href={item.nextAction.href}>{tr("openAction")}</Link>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={personaFilter === workspace.persona ? "default" : "ghost"}
                          onClick={() => setReportPersonaFilter(workspace.persona)}
                        >
                          {tr("setFocus")}
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-muted/30 p-2">
                        <div className="text-muted-foreground">{tr("amountAtRisk2")}</div>
                        <div
                          dir="ltr"
                          className="mt-1 truncate font-mono font-semibold text-foreground"
                        >
                          {formatCurrency(item.amountAtRisk, "AED", locale)}
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/30 p-2">
                        <div className="text-muted-foreground">{tr("comparisonWarnings")}</div>
                        <div dir="ltr" className="mt-1 font-mono font-semibold text-foreground">
                          {item.comparisonWarnings}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={reportSectionHref(workspace, "automation-command-center")}>
                          {tr("openCommandCenter")}
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={reportSectionHref(workspace, "delivery-subscriptions")}>
                          {tr("openDelivery")}
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="report-automation-impact-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-automation-impact-title" className="text-xl font-semibold">
              {tr("automationImpact")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("estimatedMonthlyWorkRemovedByReady", { personaScopeDescription })}
            </p>
          </div>
          <Badge
            variant={reportAutomationImpactTotals.reviewItemCount > 0 ? "warning" : "success"}
            dot
          >
            {tr("hrsSavedMo", {
              estimatedMonthlyHoursSaved: reportAutomationImpactTotals.estimatedMonthlyHoursSaved,
            })}
          </Badge>
        </div>

        {reportAutomationOperationsLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div
            className="grid grid-cols-1 gap-3 xl:grid-cols-3"
            data-testid="report-automation-impact"
          >
            {visibleReportAutomationImpactSummaries.map((item) => {
              const workspace = item.workspace;
              const WorkspaceIcon = workspace.icon;
              const impactVariant =
                item.estimate.status === "compounding"
                  ? "success"
                  : item.estimate.status === "review"
                    ? "warning"
                    : "neutral";

              return (
                <Card
                  key={workspace.persona}
                  data-testid={`report-automation-impact-${workspace.persona}`}
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">
                            {item.profile.title}
                          </CardTitle>
                          <CardDescription>{item.profile.outcome}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={impactVariant} dot>
                        {item.estimate.statusLabel}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("hoursSaved")}</div>
                        <div dir="ltr" className="mt-1 font-mono text-lg font-semibold">
                          {item.estimate.estimatedMonthlyHoursSaved}
                        </div>
                        <div className="mt-1 text-muted-foreground">{tr("estimatedMonth")}</div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("automatedItems")}</div>
                        <div dir="ltr" className="mt-1 font-mono text-lg font-semibold">
                          {item.estimate.estimatedAutomatedItemCount}
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {item.profile.itemUnitLabel}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("coverage")}</div>
                        <div dir="ltr" className="mt-1 font-mono text-lg font-semibold">
                          {item.estimate.coverageScore}%
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {tr("triggerRules3", { triggerRulesCount: item.triggerRules.length })}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("amountWatched")}</div>
                        <div dir="ltr" className="mt-1 truncate font-mono text-sm font-semibold">
                          {formatCurrency(item.estimate.amountAtRisk, "AED", locale)}
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {tr("reviewItems2", { reviewItemCount: item.estimate.reviewItemCount })}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3 text-xs">
                      <div className="font-medium text-foreground">
                        {item.profile.manualWorkLabel}
                      </div>
                      <p className="mt-1 text-muted-foreground">{item.estimate.summary}</p>
                    </div>

                    <div className="space-y-2">
                      {item.profile.evidence.map((evidence) => (
                        <div key={evidence.label} className="rounded-md bg-muted/30 p-2 text-xs">
                          <div className="font-medium text-foreground">{evidence.label}</div>
                          <div className="mt-1 text-muted-foreground">{evidence.detail}</div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        {tr("outcomeSignals")}
                      </div>
                      {item.profile.outcomeSignals.map((signal) => (
                        <div
                          key={signal.id}
                          className="rounded-md border p-2 text-xs"
                          data-testid={`report-automation-outcome-signal-${signal.id}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-foreground">{signal.label}</div>
                            <Badge variant="info">{tr("proxy")}</Badge>
                          </div>
                          <div className="mt-1 text-muted-foreground">{signal.currentProxy}</div>
                          <div className="mt-2 rounded-md bg-secondary/40 p-2 text-muted-foreground">
                            {tr("missingCounter", { missingCounter: signal.missingCounter })}
                          </div>
                          <div className="mt-1 text-muted-foreground">{signal.guardrail}</div>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {item.reports.slice(0, 4).map((report) => (
                        <Badge key={report.id} variant="outline">
                          {report.name}
                        </Badge>
                      ))}
                      {item.reports.length > 4 ? (
                        <Badge variant="neutral">+{item.reports.length - 4}</Badge>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={item.commandCenterHref}>{tr("openCommandCenter")}</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={item.starterHref}>{tr("openAutopilot")}</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="decision-shortcuts-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="decision-shortcuts-title" className="text-xl font-semibold">
              {tr("decisionShortcuts")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("businessQuestionsThatRouteOwnersFreelancers", { personaScopeDescription })}
            </p>
          </div>
          <Badge variant="info" dot>
            {tr("questions", {
              visibleReportDecisionShortcutsCount: visibleReportDecisionShortcuts.length,
            })}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {visibleReportDecisionShortcuts.map((shortcut) => {
            const WorkspaceIcon = shortcut.workspace.icon;

            return (
              <Card
                key={shortcut.id}
                id={`report-decision-shortcut-${shortcut.id}`}
                data-testid={`report-decision-shortcut-${shortcut.id}`}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">
                          {shortcut.question}
                        </CardTitle>
                        <CardDescription>{shortcut.workspace.title}</CardDescription>
                      </div>
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {shortcut.persona}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{shortcut.answer}</p>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border p-3">
                      <div className="text-muted-foreground">{tr("primaryReport2")}</div>
                      <div className="mt-1 font-medium text-foreground">
                        {shortcut.primaryReport.name}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-muted-foreground">{tr("reportBundle")}</div>
                      <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
                        {shortcut.reports.length}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {shortcut.reports.slice(0, 4).map((report) => (
                      <Badge key={report.id} variant="outline">
                        {report.name}
                      </Badge>
                    ))}
                    {shortcut.reports.length > 4 ? (
                      <Badge variant="neutral">+{shortcut.reports.length - 4}</Badge>
                    ) : null}
                  </div>

                  <div className="space-y-2 text-xs text-muted-foreground">
                    {shortcut.comparisonPreset ? (
                      <div>
                        <span className="font-medium text-foreground">{tr("comparison2")}</span>{" "}
                        {shortcut.comparisonPreset.title}
                      </div>
                    ) : null}
                    {shortcut.automationStarter ? (
                      <div>
                        <span className="font-medium text-foreground">{tr("automation2")}</span>{" "}
                        {shortcut.automationStarter.title}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link href={shortcut.primaryReportHref}>{tr("openReport")}</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={shortcut.comparisonHref}>{tr("openComparison")}</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={shortcut.workflowHref}
                        data-testid={`report-decision-shortcut-automation-${shortcut.id}`}
                      >
                        {tr("openAutomation")}
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="automation-starters-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="automation-starters-title" className="text-xl font-semibold">
              {tr("automationStarters")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("personaSpecificSetupPathsForTurning", { personaScopeDescription })}
            </p>
          </div>
          <Badge variant="info" dot>
            {tr("starters2", {
              visibleReportAutomationStartersCount: visibleReportAutomationStarters.length,
            })}
          </Badge>
        </div>

        <div
          className="grid grid-cols-2 gap-2 text-xs lg:grid-cols-6"
          data-testid="report-delivery-scheduler-health"
        >
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-muted-foreground">{tr("lastScan")}</div>
              <Badge
                variant={
                  latestReportDeliverySchedulerScan?.status === "error"
                    ? "danger"
                    : latestReportDeliverySchedulerScan
                      ? "success"
                      : "neutral"
                }
                dot
              >
                {latestReportDeliverySchedulerScan?.status ?? tr("pending")}
              </Badge>
            </div>
            <div className="mt-1 font-medium text-foreground">
              {formatDeliveryRunTimestamp(latestReportDeliverySchedulerScan?.finishedAt)}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">{tr("queuedByScan")}</div>
            <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
              {latestReportDeliverySchedulerScan?.queuedRuns ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">{tr("guardrailSkips")}</div>
            <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
              {reportDeliverySchedulerGuardrailSkips}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">{tr("handoffSkips")}</div>
            <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
              {reportDeliverySchedulerHandoffSkipCount}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">{tr("actorSkips")}</div>
            <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
              {latestReportDeliverySchedulerScan?.skippedNoActor ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">{tr("scanErrors")}</div>
            <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
              {latestReportDeliverySchedulerScan?.errors ?? 0}
            </div>
          </div>
        </div>

        {reportDeliverySchedulerHandoffReviews.length > 0 ? (
          <div
            className="rounded-md border border-warning/40 bg-warning/5 p-3"
            data-testid="report-delivery-scheduler-handoff-skips"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {tr("scheduledSendsHeldForHandoff")}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tr("theseDueReportPacksWereNot")}
                </p>
              </div>
              <Badge variant="warning" dot>
                {tr("held", {
                  reportDeliverySchedulerHandoffReviewsCount:
                    reportDeliverySchedulerHandoffReviews.length,
                })}
              </Badge>
            </div>
            <div className="mt-3 grid gap-2">
              {reportDeliverySchedulerHandoffReviews.slice(0, 3).map((review) => (
                <div
                  key={`${review.subscriptionId}-${review.latestRunId ?? review.gap}`}
                  className="flex flex-col gap-2 rounded-md bg-background/70 p-2 text-xs sm:flex-row sm:items-start sm:justify-between"
                  data-testid={`report-delivery-scheduler-handoff-${review.subscriptionId}`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{review.title}</span>
                      <Badge variant="warning">{review.gapLabel}</Badge>
                    </div>
                    <div className="mt-1 text-muted-foreground">{review.detail}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline" className="h-7 px-2">
                      <Link href={review.href}>
                        {tr("openHandoff")} <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                      <Link href={review.subscriptionHref}>{tr("openDelivery")}</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {automationLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {visibleReportAutomationStarters.map((starter) => {
              const WorkspaceIcon = starter.workspace.icon;

              return (
                <Card
                  key={starter.id}
                  id={`report-automation-starter-${starter.id}`}
                  data-testid={`report-automation-starter-${starter.id}`}
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">{starter.title}</CardTitle>
                          <CardDescription>{starter.audience}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={starter.openWorkItemCount > 0 ? "warning" : "success"} dot>
                        {starter.openWorkItemCount > 0
                          ? tr("open2", { openWorkItemCount: starter.openWorkItemCount })
                          : tr("ready")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">{starter.outcome}</p>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("setup")}</div>
                        <div className="font-medium text-foreground">{starter.setupTime}</div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("readyReports")}</div>
                        <div dir="ltr" className="font-mono text-base font-semibold">
                          {starter.readyCount}/{starter.reports.length}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("playbooks")}</div>
                        <div dir="ltr" className="font-mono text-base font-semibold">
                          {starter.playbooks.length}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("atRisk")}</div>
                        <div dir="ltr" className="truncate font-mono text-sm font-semibold">
                          {formatCurrency(starter.amountAtRisk, "AED", locale)}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{tr("trigger2")}</span>{" "}
                      {starter.trigger}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        {tr("setupChecklist")}
                      </div>
                      {starter.setupSteps.map((step) => (
                        <div key={step} className="flex gap-2 text-xs text-muted-foreground">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {starter.reports.slice(0, 4).map((report) => (
                        <Badge key={report.id} variant="outline">
                          {report.name}
                        </Badge>
                      ))}
                      {starter.reports.length > 4 ? (
                        <Badge variant="neutral">+{starter.reports.length - 4}</Badge>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link href={starter.href}>{starter.primaryAction}</Link>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setReportPersonaFilter(starter.persona)}
                      >
                        {tr("filterWorkspace")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="trigger-rules-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="trigger-rules-title" className="text-xl font-semibold">
              {tr("triggerRules")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("reportDrivenThresholdsThatRouteCash", { personaScopeDescription })}
            </p>
          </div>
          <Badge variant="info" dot>
            {tr("rules2", {
              visibleReportAutomationTriggerRulesCount: visibleReportAutomationTriggerRules.length,
            })}
          </Badge>
        </div>

        {automationLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {visibleReportAutomationTriggerRules.map((rule) => {
              const WorkspaceIcon = rule.workspace.icon;
              const severity = getTriggerSeverityMeta()[rule.severity];

              return (
                <Card
                  key={rule.id}
                  id={`report-trigger-rule-${rule.id}`}
                  data-testid={`report-trigger-rule-${rule.id}`}
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">{rule.title}</CardTitle>
                          <CardDescription>{rule.workspace.title}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={severity.variant} dot>
                        {severity.label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>{rule.condition}</p>
                      <div className="rounded-md border p-3 text-xs">
                        <span className="font-medium text-foreground">{tr("threshold2")}</span>{" "}
                        {rule.threshold}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("cadence")}</div>
                        <div className="mt-1 font-medium text-foreground">{rule.cadence}</div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("openWork")}</div>
                        <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
                          {rule.openWorkItemCount}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {rule.reports.slice(0, 4).map((report) => (
                        <Badge key={report.id} variant="outline">
                          {report.name}
                        </Badge>
                      ))}
                      {rule.reports.length > 4 ? (
                        <Badge variant="neutral">+{rule.reports.length - 4}</Badge>
                      ) : null}
                    </div>

                    <div className="space-y-2 text-xs text-muted-foreground">
                      {rule.decisionShortcut ? (
                        <div>
                          <span className="font-medium text-foreground">{tr("question2")}</span>{" "}
                          {rule.decisionShortcut.question}
                        </div>
                      ) : null}
                      {rule.automationStarter ? (
                        <div>
                          <span className="font-medium text-foreground">{tr("automation2")}</span>{" "}
                          {rule.automationStarter.title}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link href={rule.primaryReportHref}>{rule.actionLabel}</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={rule.decisionShortcutHref}>{tr("openQuestion")}</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={rule.automationStarterHref}>{tr("openAutomation")}</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section
        className={reportWorkspacePanelClass("delivery", "space-y-4")}
        aria-labelledby="report-delivery-subscriptions-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-delivery-subscriptions-title" className="text-xl font-semibold">
              {tr("deliverySubscriptions")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("scheduledReportPacksThatDefineCadence", { personaScopeDescription })}
            </p>
          </div>
          <Badge
            variant={
              visibleReportDeliverySubscriptions.some(
                (subscription) => subscription.status !== "Ready to send"
              )
                ? "warning"
                : "success"
            }
            dot
          >
            {tr("subscriptions", {
              visibleReportDeliverySubscriptionsCount: visibleReportDeliverySubscriptions.length,
            })}
          </Badge>
        </div>

        <ReportLaunchPicker
          persona={reportDeliveryLauncherPersona}
          mode="delivery"
          onQueueDeliverySubscription={(subscriptionId) =>
            queueReportDeliverySubscriptionWithHandoffGuard(subscriptionId)
          }
          onRetryDeliveryRun={(runId) => retryReportDeliveryRun.mutate(runId)}
          queueingDeliverySubscriptionId={
            queueReportDeliverySubscription.isPending
              ? (queueReportDeliverySubscription.variables?.subscriptionId ?? null)
              : null
          }
          retryingDeliveryRunId={
            retryReportDeliveryRun.isPending ? (retryReportDeliveryRun.variables ?? null) : null
          }
          deliveryQueueDisabled={!selectedCompanyId || queueReportDeliverySubscription.isPending}
          deliveryRetryDisabled={!selectedCompanyId || retryReportDeliveryRun.isPending}
          deliverySubscriptionPreviewById={reportDeliveryLauncherPreviewById}
          preferredDeliveryAutomationCommand={pinnedReportDeliveryAutomationCommand}
          loadDeliveryAutomationPreferences={activeReportWorkspaceTab === "delivery"}
          companyId={selectedCompanyId}
          className="shadow-none"
        />

        <div
          className="rounded-md border border-border/70 p-3"
          data-testid="report-delivery-recovery-summary"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                {tr("automationRecovery")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {tr("failedDeliveryRecoveryAndReviewQueue", {
                  personaFilterLabel: personaFilterLabel.toLowerCase(),
                })}
              </p>
            </div>
            <Badge variant={reportDeliveryRecoverySummary.nextAction.badgeVariant} dot>
              {reportDeliveryRecoverySummary.nextAction.badge}
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
            <div
              className="rounded-md bg-secondary/40 p-2"
              data-testid="report-delivery-recovery-failed-runs"
            >
              <div className="text-muted-foreground">{tr("failedRuns2")}</div>
              <div dir="ltr" className="mt-1 font-mono text-base font-semibold text-foreground">
                {reportDeliveryRecoverySummary.failedRunCount}
              </div>
            </div>
            <div
              className="rounded-md bg-secondary/40 p-2"
              data-testid="report-delivery-recovery-retryable-subscriptions"
            >
              <div className="text-muted-foreground">{tr("retryableSubscriptions")}</div>
              <div dir="ltr" className="mt-1 font-mono text-base font-semibold text-foreground">
                {reportDeliveryRecoverySummary.retryableSubscriptionCount}
              </div>
            </div>
            <div
              className="rounded-md bg-secondary/40 p-2"
              data-testid="report-delivery-recovery-review-subscriptions"
            >
              <div className="text-muted-foreground">{tr("needsReview")}</div>
              <div dir="ltr" className="mt-1 font-mono text-base font-semibold text-foreground">
                {reportDeliveryRecoverySummary.reviewSubscriptionCount}
              </div>
            </div>
          </div>

          <div
            className="mt-3 flex flex-col gap-2 rounded-md bg-secondary/40 p-2 text-xs sm:flex-row sm:items-center sm:justify-between"
            data-testid="report-delivery-recovery-next-action"
          >
            <div>
              <div className="font-medium text-foreground">
                {reportDeliveryRecoverySummary.nextAction.label}
              </div>
              <div className="mt-1 text-muted-foreground">
                {reportDeliveryRecoverySummary.nextAction.detail}
              </div>
            </div>
            {reportDeliveryRecoverySummary.nextAction.kind === "retry" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!selectedCompanyId || retryReportDeliveryRun.isPending}
                onClick={() => {
                  const runId = reportDeliveryRecoverySummary.nextAction.runId;
                  if (!runId) return;
                  retryReportDeliveryRun.mutate(runId);
                }}
                data-testid="report-delivery-recovery-retry-latest"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {tr("retryLatest")}
              </Button>
            ) : reportDeliveryRecoverySummary.nextAction.kind === "open" ? (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={reportDeliveryRecoverySummary.nextAction.href}
                  data-testid="report-delivery-recovery-open-review"
                >
                  {tr("openReview")}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>

        <div
          className="rounded-md border border-border/70 p-3"
          data-testid="report-delivery-command-strip"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-foreground">
                {tr("automationCommandStrip")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {tr("oneClickRecoveryGuardrailReviewDelivery", {
                  personaFilterLabel: personaFilterLabel.toLowerCase(),
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={pinnedReportDeliveryAutomationCommand ? "success" : "neutral"}
                dot
                data-testid="report-delivery-command-pinned"
              >
                {pinnedReportDeliveryAutomationCommand
                  ? tr("pinned", {
                      value:
                        getReportDeliveryAutomationCommandLabels()[
                          pinnedReportDeliveryAutomationCommand
                        ],
                    })
                  : tr("noPinnedCommand")}
              </Badge>
              <Badge variant="info" dot>
                {personaFilterLabel}
              </Badge>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-2 xl:grid-cols-4">
            <div
              className={reportDeliveryAutomationCommandCardClass(
                "retry",
                pinnedReportDeliveryAutomationCommand
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                  {tr("retryRecovery")}
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={pinnedReportDeliveryAutomationCommand === "retry" ? "default" : "ghost"}
                  aria-pressed={pinnedReportDeliveryAutomationCommand === "retry"}
                  onClick={() => pinReportDeliveryAutomationCommand("retry")}
                  data-testid="report-delivery-command-pin-retry"
                >
                  <Pin className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-1 text-muted-foreground">
                {tr("requeueTheLatestFailedScheduledReport")}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={
                  !selectedCompanyId ||
                  retryReportDeliveryRun.isPending ||
                  !reportDeliveryAutomationCommandTargets.retryRunId
                }
                onClick={() => {
                  const runId = reportDeliveryAutomationCommandTargets.retryRunId;
                  if (!runId) return;
                  retryReportDeliveryRun.mutate(runId);
                }}
                data-testid="report-delivery-command-retry"
              >
                {tr("retryNow")}
              </Button>
            </div>

            <div
              className={reportDeliveryAutomationCommandCardClass(
                "review",
                pinnedReportDeliveryAutomationCommand
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
                  {tr("reviewGuardrails")}
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={pinnedReportDeliveryAutomationCommand === "review" ? "default" : "ghost"}
                  aria-pressed={pinnedReportDeliveryAutomationCommand === "review"}
                  onClick={() => pinReportDeliveryAutomationCommand("review")}
                  data-testid="report-delivery-command-pin-review"
                >
                  <Pin className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-1 text-muted-foreground">
                {tr("openTheFirstDeliveryNeedingSetup")}
              </div>
              {reportDeliveryAutomationCommandTargets.reviewSubscription ? (
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link
                    href={reportDeliveryAutomationCommandTargets.reviewSubscription.href}
                    data-testid="report-delivery-command-review"
                  >
                    {tr("openReview")}
                  </Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled
                  data-testid="report-delivery-command-review"
                >
                  {tr("noReview")}
                </Button>
              )}
            </div>

            <div
              className={reportDeliveryAutomationCommandCardClass(
                "queue",
                pinnedReportDeliveryAutomationCommand
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Send className="h-3.5 w-3.5 text-muted-foreground" />
                  {tr("queueNextPack")}
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={pinnedReportDeliveryAutomationCommand === "queue" ? "default" : "ghost"}
                  aria-pressed={pinnedReportDeliveryAutomationCommand === "queue"}
                  onClick={() => pinReportDeliveryAutomationCommand("queue")}
                  data-testid="report-delivery-command-pin-queue"
                >
                  <Pin className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-1 text-muted-foreground">
                {tr("queueTheNextEnabledDeliverySubscription")}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={
                  !selectedCompanyId ||
                  queueReportDeliverySubscription.isPending ||
                  !reportDeliveryAutomationCommandTargets.queueSubscription
                }
                onClick={() => {
                  const subscriptionId =
                    reportDeliveryAutomationCommandTargets.queueSubscription?.id;
                  if (!subscriptionId) return;
                  queueReportDeliverySubscriptionWithHandoffGuard(subscriptionId);
                }}
                data-testid="report-delivery-command-queue"
              >
                {commandQueueSubscriptionRequiresHandoffAcknowledgement
                  ? tr("acknowledgeHandoff")
                  : tr("queuePack")}
              </Button>
            </div>

            <div
              className={reportDeliveryAutomationCommandCardClass(
                "comparison",
                pinnedReportDeliveryAutomationCommand
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                  {tr("openComparison")}
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={
                    pinnedReportDeliveryAutomationCommand === "comparison" ? "default" : "ghost"
                  }
                  aria-pressed={pinnedReportDeliveryAutomationCommand === "comparison"}
                  onClick={() => pinReportDeliveryAutomationCommand("comparison")}
                  data-testid="report-delivery-command-pin-comparison"
                >
                  <Pin className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-1 text-muted-foreground">
                {tr("reviewTheHighestPriorityComparisonPack")}
              </div>
              {reportDeliveryAutomationCommandTargets.comparisonPreset ? (
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link
                    href={reportDeliveryAutomationCommandTargets.comparisonPreset.href}
                    data-testid="report-delivery-command-comparison"
                  >
                    {tr("openComparison")}
                  </Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled
                  data-testid="report-delivery-command-comparison"
                >
                  {tr("noComparison")}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div
          className="rounded-md border border-border/70 p-3"
          data-testid="report-delivery-run-timeline"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ListFilter className="h-4 w-4 text-muted-foreground" />
                {tr("deliveryRunTimeline")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {tr("filterQueuedSentAndFailedReport", {
                  personaFilterLabel: personaFilterLabel.toLowerCase(),
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label={tr("deliveryRunStatus")}>
              {getReportDeliveryRunStatusFilters().map((filter) => (
                <Button
                  key={filter.id}
                  type="button"
                  size="sm"
                  variant={reportDeliveryRunStatusFilter === filter.id ? "default" : "outline"}
                  onClick={() => setReportDeliveryRunStatusFilter(filter.id)}
                  data-testid={`report-delivery-run-filter-${filter.id}`}
                >
                  {filter.label}
                  <span
                    dir="ltr"
                    className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[10px]"
                  >
                    {reportDeliveryRunStatusCounts[filter.id]}
                  </span>
                </Button>
              ))}
            </div>
          </div>

          {reportDeliveryRunTimelineRows.length > 0 ? (
            <div
              className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2"
              data-testid="report-delivery-run-timeline-rows"
            >
              {reportDeliveryRunTimelineRows.map((run) => (
                <div
                  key={run.id}
                  className="rounded-md bg-secondary/40 p-2 text-xs"
                  data-testid={`report-delivery-run-timeline-${run.id}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={deliveryRunStatusVariant(run.status)} dot>
                        {run.status}
                      </Badge>
                      <span className="font-medium text-foreground">
                        {formatDeliveryRunTimestamp(run.createdAt)}
                      </span>
                    </div>
                    <Badge variant="outline">{run.workspaceLabel}</Badge>
                  </div>
                  <div className="mt-2 font-medium text-foreground">{run.subscriptionTitle}</div>
                  <div className="mt-1 text-muted-foreground">
                    {tr("scheduledReports", {
                      formatDeliveryRunTimestamp: formatDeliveryRunTimestamp(run.scheduledFor),
                      readyReportCount: run.readyReportCount,
                      reportCount: run.reportCount,
                      channel: run.channel,
                    })}
                  </div>
                  {run.errorMessage ? (
                    <div className="mt-1 text-destructive">{run.errorMessage}</div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={run.subscriptionHref}>{tr("openSubscription")}</Link>
                    </Button>
                    {run.status === "failed" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!selectedCompanyId || retryReportDeliveryRun.isPending}
                        onClick={() => retryReportDeliveryRun.mutate(run.id)}
                        data-testid={`report-delivery-run-timeline-retry-${run.id}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {tr("retryDelivery")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="mt-3 rounded-md bg-secondary/40 p-3 text-xs text-muted-foreground"
              data-testid="report-delivery-run-timeline-empty"
            >
              {reportDeliveryRunStatusFilter === "all"
                ? tr("noDeliveryRunsMatchThisView", {
                    personaFilterLabel: personaFilterLabel.toLowerCase(),
                  })
                : tr("noDeliveryRunsMatchThisView2", {
                    reportDeliveryRunStatusFilter,
                    personaFilterLabel: personaFilterLabel.toLowerCase(),
                  })}
            </div>
          )}
        </div>

        {automationLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {visibleReportDeliverySubscriptions.map((subscription) => {
              const WorkspaceIcon = subscription.workspace.icon;
              const subscriptionHandoffRows =
                reportDeliveryHandoffPreviewByPersona[subscription.persona] ??
                subscription.preview.handoffRows ??
                [];
              const subscriptionRequiresHandoffAcknowledgement =
                subscriptionHandoffRows.some((row) => row.status === "review") &&
                !isReportDeliveryHandoffAcknowledged(subscription.id);
              const isEditingDeliverySettings =
                editingReportDeliverySubscriptionId === subscription.id;
              const isSavingThisDeliverySubscription =
                saveReportDeliverySubscriptionSettings.isPending &&
                saveReportDeliverySubscriptionSettings.variables?.subscriptionId ===
                  subscription.id;

              return (
                <Card
                  key={subscription.id}
                  id={`report-delivery-subscription-${subscription.id}`}
                  data-testid={`report-delivery-subscription-${subscription.id}`}
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">
                            {subscription.title}
                          </CardTitle>
                          <CardDescription>{subscription.audience}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={subscription.statusVariant} dot>
                        {subscription.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("cadence")}</div>
                        <div className="mt-1 font-medium text-foreground">
                          {subscription.cadence}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("channel")}</div>
                        <div className="mt-1 font-medium text-foreground">
                          {subscription.channel}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("readyReports")}</div>
                        <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
                          {subscription.readyCount}/{subscription.reports.length}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("openWork")}</div>
                        <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
                          {subscription.openWorkItemCount}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("nextDelivery")}</div>
                        <div className="mt-1 font-medium text-foreground">
                          {subscription.enabled
                            ? subscription.nextRunLabel || tr("calculatedOnQueue")
                            : tr("paused")}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("settings")}</div>
                        <div className="mt-1 font-medium capitalize text-foreground">
                          {subscription.settingsSource}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">{tr("suite")}</div>
                        <div className="mt-1 font-medium text-foreground">
                          {subscription.reportSuites[0]?.title ?? tr("notLinked")}
                        </div>
                      </div>
                    </div>

                    {isEditingDeliverySettings ? (
                      <div
                        className="rounded-md border p-3"
                        data-testid={`report-delivery-settings-editor-${subscription.id}`}
                      >
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label
                              htmlFor={`report-delivery-cadence-${subscription.id}`}
                              className="text-xs"
                            >
                              {tr("cadence")}
                            </Label>
                            <Input
                              id={`report-delivery-cadence-${subscription.id}`}
                              data-testid={`report-delivery-cadence-${subscription.id}`}
                              maxLength={500}
                              value={reportDeliverySettingsDraft.cadence}
                              onChange={(event) =>
                                updateReportDeliverySettingsDraft("cadence", event.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor={`report-delivery-channel-${subscription.id}`}
                              className="text-xs"
                            >
                              {tr("channel")}
                            </Label>
                            <Input
                              id={`report-delivery-channel-${subscription.id}`}
                              data-testid={`report-delivery-channel-${subscription.id}`}
                              maxLength={500}
                              value={reportDeliverySettingsDraft.channel}
                              onChange={(event) =>
                                updateReportDeliverySettingsDraft("channel", event.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor={`report-delivery-format-${subscription.id}`}
                              className="text-xs"
                            >
                              {tr("format")}
                            </Label>
                            <Input
                              id={`report-delivery-format-${subscription.id}`}
                              data-testid={`report-delivery-format-${subscription.id}`}
                              maxLength={500}
                              value={reportDeliverySettingsDraft.format}
                              onChange={(event) =>
                                updateReportDeliverySettingsDraft("format", event.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor={`report-delivery-recipients-${subscription.id}`}
                              className="text-xs"
                            >
                              {tr("recipients")}
                            </Label>
                            <Input
                              id={`report-delivery-recipients-${subscription.id}`}
                              data-testid={`report-delivery-recipients-${subscription.id}`}
                              maxLength={500}
                              value={reportDeliverySettingsDraft.recipients}
                              onChange={(event) =>
                                updateReportDeliverySettingsDraft("recipients", event.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label
                              htmlFor={`report-delivery-guardrail-${subscription.id}`}
                              className="text-xs"
                            >
                              {tr("guardrail")}
                            </Label>
                            <Textarea
                              id={`report-delivery-guardrail-${subscription.id}`}
                              data-testid={`report-delivery-guardrail-${subscription.id}`}
                              maxLength={500}
                              rows={3}
                              value={reportDeliverySettingsDraft.deliveryGuardrail}
                              onChange={(event) =>
                                updateReportDeliverySettingsDraft(
                                  "deliveryGuardrail",
                                  event.target.value
                                )
                              }
                            />
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={!selectedCompanyId || isSavingThisDeliverySubscription}
                            onClick={() =>
                              saveReportDeliverySubscriptionSettings.mutate({
                                subscriptionId: subscription.id,
                                enabled: subscription.enabled,
                                cadence: normalizeDeliverySetting(
                                  reportDeliverySettingsDraft.cadence
                                ),
                                channel: normalizeDeliverySetting(
                                  reportDeliverySettingsDraft.channel
                                ),
                                format: normalizeDeliverySetting(
                                  reportDeliverySettingsDraft.format
                                ),
                                recipients: normalizeDeliverySetting(
                                  reportDeliverySettingsDraft.recipients
                                ),
                                deliveryGuardrail: normalizeDeliverySetting(
                                  reportDeliverySettingsDraft.deliveryGuardrail
                                ),
                              })
                            }
                          >
                            <Save className="h-4 w-4" />
                            {tr("saveDeliverySettings")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isSavingThisDeliverySubscription}
                            onClick={() => setEditingReportDeliverySubscriptionId(null)}
                          >
                            <X className="h-4 w-4" />
                            {tr("cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border p-3 text-xs text-muted-foreground">
                        <div>
                          <span className="font-medium text-foreground">{tr("format2")}</span>{" "}
                          {subscription.format}
                        </div>
                        <div className="mt-1">
                          <span className="font-medium text-foreground">{tr("recipients3")}</span>{" "}
                          {subscription.recipients}
                        </div>
                        <div className="mt-1">
                          <span className="font-medium text-foreground">{tr("guardrail2")}</span>{" "}
                          {subscription.deliveryGuardrail}
                        </div>
                      </div>
                    )}

                    <div
                      className="rounded-md border p-3 text-xs"
                      data-testid={`report-delivery-preview-${subscription.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-foreground">{tr("packPreview")}</div>
                          <p className="mt-1 text-muted-foreground">
                            {subscription.preview.summary}
                          </p>
                        </div>
                        <Badge
                          variant={
                            subscription.preview.readinessLabel === "Ready for queue"
                              ? "success"
                              : subscription.preview.readinessLabel === "Paused"
                                ? "neutral"
                                : "warning"
                          }
                        >
                          {subscription.preview.readinessLabel}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {subscription.preview.reportNames.slice(0, 4).map((reportName) => (
                          <Badge key={reportName} variant="outline">
                            {reportName}
                          </Badge>
                        ))}
                        {subscription.preview.reportNames.length > 4 ? (
                          <Badge variant="neutral">
                            +{subscription.preview.reportNames.length - 4}
                          </Badge>
                        ) : null}
                      </div>
                      {subscription.preview.suiteTitles.length > 0 ? (
                        <div
                          className="mt-3 flex flex-wrap gap-1"
                          data-testid={`report-delivery-preview-suites-${subscription.id}`}
                        >
                          {subscription.preview.suiteTitles.map((suiteTitle) => (
                            <Badge key={suiteTitle} variant="info">
                              {suiteTitle}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-3 grid gap-2">
                        {subscription.preview.checklist.slice(0, 3).map((check) => (
                          <div
                            key={check.label}
                            className="flex items-start justify-between gap-2 rounded-md bg-secondary/40 p-2"
                          >
                            <div>
                              <div className="font-medium text-foreground">{check.label}</div>
                              <div className="mt-0.5 text-muted-foreground">{check.detail}</div>
                            </div>
                            <Badge variant={deliveryPreviewCheckVariant(check.status)}>
                              {check.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                      {subscriptionHandoffRows.length ? (
                        <div
                          className="mt-3 grid gap-2"
                          data-testid={`report-delivery-preview-handoff-${subscription.id}`}
                        >
                          {subscriptionHandoffRows.slice(0, 3).map((row) => (
                            <div
                              key={row.label}
                              className="flex items-start justify-between gap-2 rounded-md bg-muted/30 p-2"
                            >
                              <div>
                                <div className="font-medium text-foreground">{row.label}</div>
                                <div className="mt-0.5 text-muted-foreground">
                                  {row.value} - {row.detail}
                                </div>
                              </div>
                              <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                                <Link href={row.href}>{tr("open")}</Link>
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {subscriptionRequiresHandoffAcknowledgement ? (
                        <Badge
                          variant="warning"
                          data-testid={`report-delivery-handoff-acknowledgement-${subscription.id}`}
                        >
                          {tr("acknowledgeHandoffGapsBeforeQueueing")}
                        </Badge>
                      ) : null}
                    </div>

                    <div
                      className="rounded-md border p-3 text-xs"
                      data-testid={`report-delivery-run-history-${subscription.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-foreground">
                          {tr("recentDeliveryRuns")}
                        </div>
                        <Badge variant="neutral">{subscription.deliveryRuns.length}</Badge>
                      </div>
                      {subscription.latestDeliveryRun ? (
                        <div className="mt-3 space-y-2">
                          {subscription.deliveryRuns.slice(0, 2).map((run) => (
                            <div
                              key={run.id}
                              className="flex flex-col gap-2 rounded-md bg-secondary/40 p-2 sm:flex-row sm:items-start sm:justify-between"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1">
                                  <Badge variant={deliveryRunStatusVariant(run.status)} dot>
                                    {run.status}
                                  </Badge>
                                  <span className="font-medium text-foreground">
                                    {formatDeliveryRunTimestamp(run.createdAt)}
                                  </span>
                                </div>
                                <div className="mt-1 text-muted-foreground">
                                  {tr("scheduledReports", {
                                    formatDeliveryRunTimestamp: formatDeliveryRunTimestamp(
                                      run.scheduledFor
                                    ),
                                    readyReportCount: run.readyReportCount,
                                    reportCount: run.reportCount,
                                    channel: run.channel,
                                  })}
                                </div>
                                {run.status === "failed" ? (
                                  <div className="mt-1 text-destructive">
                                    {run.errorMessage ?? tr("retryAfterFixingDeliverySettingsOr")}
                                  </div>
                                ) : null}
                                {run.retriedFromRunId ? (
                                  <div className="mt-1 text-muted-foreground">
                                    {tr("requeuedFromAFailedDeliveryRun")}
                                  </div>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                                <Badge
                                  variant={
                                    run.readinessStatus === "ready"
                                      ? "success"
                                      : run.readinessStatus === "paused"
                                        ? "neutral"
                                        : "warning"
                                  }
                                >
                                  {run.readinessStatus}
                                </Badge>
                                {run.status === "failed" ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      !selectedCompanyId || retryReportDeliveryRun.isPending
                                    }
                                    onClick={() => retryReportDeliveryRun.mutate(run.id)}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    {tr("retryDelivery")}
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 rounded-md bg-secondary/40 p-2 text-muted-foreground">
                          {tr("noQueuedDeliveryRunsYet")}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        {tr("triggerRules")}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {subscription.triggerRules.map((rule) => (
                          <Badge
                            key={rule.id}
                            variant={getTriggerSeverityMeta()[rule.severity].variant}
                          >
                            {rule.title}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {subscription.reports.slice(0, 5).map((report) => (
                        <Badge key={report.id} variant="outline">
                          {report.name}
                        </Badge>
                      ))}
                      {subscription.reports.length > 5 ? (
                        <Badge variant="neutral">+{subscription.reports.length - 5}</Badge>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link href={subscription.href}>{tr("openSubscription")}</Link>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          !selectedCompanyId ||
                          !subscription.enabled ||
                          queueReportDeliverySubscription.isPending
                        }
                        onClick={() =>
                          queueReportDeliverySubscriptionWithHandoffGuard(subscription.id)
                        }
                      >
                        {subscriptionRequiresHandoffAcknowledgement
                          ? tr("acknowledgeHandoff")
                          : tr("queueDelivery")}
                      </Button>
                      {!isEditingDeliverySettings ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={
                            !selectedCompanyId || saveReportDeliverySubscriptionSettings.isPending
                          }
                          onClick={() => startEditingReportDeliverySubscription(subscription)}
                        >
                          <Pencil className="h-4 w-4" />
                          {tr("editSettings")}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          !selectedCompanyId || saveReportDeliverySubscriptionSettings.isPending
                        }
                        onClick={() =>
                          saveReportDeliverySubscriptionSettings.mutate({
                            subscriptionId: subscription.id,
                            enabled: !subscription.enabled,
                          })
                        }
                      >
                        {subscription.enabled ? tr("pauseDelivery") : tr("enableDelivery")}
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={subscription.packTemplateHref}>{tr("openPack")}</Link>
                      </Button>
                      {subscription.reportSuites[0] ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={subscription.reportSuites[0].href}>{tr("openSuite")}</Link>
                        </Button>
                      ) : null}
                      <Button asChild size="sm" variant="outline">
                        <Link href={subscription.automationStarterHref}>
                          {tr("openAutomation")}
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section
        className={reportDiscoveryPanelClass("space-y-4")}
        aria-labelledby="recommended-reports-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="recommended-reports-title" className="text-xl font-semibold">
              {tr("recommendedReports")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("nextBestReportActionsBasedOn", { personaScopeDescription })}
            </p>
          </div>
          <Badge variant="info" dot>
            {tr("roleViews", {
              visiblePersonaRecommendationsCount: visiblePersonaRecommendations.length,
            })}
          </Badge>
        </div>

        {automationLoading || comparisonLoading ? (
          <Skeleton className="h-52 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {visiblePersonaRecommendations.map((item) => {
              const workspace = item.workspace;
              const WorkspaceIcon = workspace.icon;

              return (
                <Card
                  key={workspace.persona}
                  data-testid={`recommended-reports-${workspace.persona}`}
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">
                            {workspace.title}
                          </CardTitle>
                          <CardDescription>{workspace.focus}</CardDescription>
                        </div>
                      </div>
                      <Badge variant="outline">
                        {tr("ready2", { readyReports: workspace.readyReports })}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {item.recommendations.map((recommendation) => (
                      <div key={recommendation.id} className="rounded-md border p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-medium">{recommendation.title}</div>
                              <Badge variant={recommendation.badgeVariant} dot>
                                {recommendation.badge}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {recommendation.detail}
                            </div>
                            {typeof recommendation.amount === "number" ? (
                              <div dir="ltr" className="font-mono text-xs text-muted-foreground">
                                {formatCurrency(recommendation.amount, "AED", locale)}
                              </div>
                            ) : null}
                          </div>

                          {recommendation.href ? (
                            <Button asChild size="sm" variant="outline">
                              <Link href={recommendation.href}>{tr("open")}</Link>
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => recommendation.tab && setActiveTab(recommendation.tab)}
                            >
                              {tr("open")}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section
        className={reportWorkspacePanelClass("setup", "space-y-4")}
        aria-labelledby="report-product-depth-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-product-depth-title" className="text-xl font-semibold">
              {tr("reportingWorkflowMap")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("openTheReportingWorkThatIs", { personaScopeDescription })}
            </p>
          </div>
          <Badge variant="info" dot data-testid="report-product-depth-count">
            {tr("subgoals", { visibleReportProductDepthSubgoalCount })}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {visibleReportProductDepthAreas.map((area) => {
            const areaStatus = getProductDepthStatusMeta()[area.status];

            return (
              <Card
                key={area.id}
                id={`report-product-depth-${area.id}`}
                data-testid={`report-product-depth-${area.id}`}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <CardTitle className="text-base font-semibold">{area.title}</CardTitle>
                      <CardDescription>{area.objective}</CardDescription>
                    </div>
                    <Badge variant={areaStatus.variant} dot>
                      {areaStatus.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {area.subgoals.map((subgoal) => {
                    const subgoalStatus = getProductDepthStatusMeta()[subgoal.status];

                    return (
                      <div
                        key={subgoal.id}
                        id={`report-product-depth-subgoal-${subgoal.id}`}
                        data-testid={`report-product-depth-subgoal-${subgoal.id}`}
                        className="rounded-md border p-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-medium">{subgoal.title}</div>
                              <Badge variant={subgoalStatus.variant} dot>
                                {subgoalStatus.label}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{subgoal.outcome}</p>
                            <div className="text-xs text-muted-foreground">{subgoal.evidence}</div>
                            {subgoal.dataDependency ? (
                              <div className="rounded-md bg-secondary/40 p-2 text-xs text-muted-foreground">
                                {subgoal.dataDependency}
                              </div>
                            ) : null}
                          </div>
                          <Button asChild size="sm" variant="outline">
                            <Link href={subgoal.href}>{tr("openWorkflow")}</Link>
                          </Button>
                        </div>

                        {subgoal.sourceDrilldownTargets?.length ? (
                          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
                            {subgoal.sourceDrilldownTargets.map((target) => (
                              <div
                                key={target.id}
                                data-testid={`report-source-drilldown-target-${target.id}`}
                                className="rounded-md border bg-secondary/20 p-3"
                              >
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <div className="text-xs font-medium">{target.title}</div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {target.availableEvidence}
                                    </p>
                                  </div>
                                  <Button
                                    asChild
                                    size="sm"
                                    variant="outline"
                                    className="h-7 shrink-0 px-2"
                                  >
                                    <Link href={target.href}>{tr("openTarget")}</Link>
                                  </Button>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  <Badge variant="outline">
                                    {tr("reports4", { reportIdsCount: target.reportIds.length })}
                                  </Badge>
                                  {target.sourceEntities.slice(0, 3).map((entity) => (
                                    <Badge key={entity} variant="neutral">
                                      {entity}
                                    </Badge>
                                  ))}
                                </div>
                                <div className="mt-2 rounded-md bg-background/60 p-2 text-xs text-muted-foreground">
                                  {target.universalLinkGap}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {subgoal.evidenceCheckpoints?.length ? (
                          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-3">
                            {subgoal.evidenceCheckpoints.map((checkpoint) => {
                              const checkpointStatus =
                                getProductDepthEvidenceCheckpointStatusMeta()[checkpoint.status];

                              return (
                                <div
                                  key={checkpoint.id}
                                  data-testid={`report-evidence-checkpoint-${checkpoint.id}`}
                                  className="rounded-md border bg-secondary/20 p-2"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-xs font-medium">{checkpoint.label}</div>
                                    <Badge variant={checkpointStatus.variant} dot>
                                      {checkpointStatus.label}
                                    </Badge>
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {checkpoint.detail}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}

                        {subgoal.requiredSourceRecords?.length ? (
                          <div className="mt-3 space-y-2">
                            <div className="text-xs font-medium uppercase text-muted-foreground">
                              {tr("requiredSourceRecords")}
                            </div>
                            <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
                              {subgoal.requiredSourceRecords.map((record) => (
                                <div
                                  key={record.id}
                                  className="rounded-md border p-2 text-xs"
                                  data-testid={`report-required-source-record-${record.id}`}
                                >
                                  <div className="font-medium text-foreground">{record.label}</div>
                                  <div className="mt-1 text-muted-foreground">
                                    {record.systemOfRecord}
                                  </div>
                                  <div className="mt-2 rounded-md bg-secondary/40 p-2 text-muted-foreground">
                                    {tr("unlocks", { unlocks: record.unlocks })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-1">
                          <Badge variant="outline">
                            {tr("reports4", { reportIdsCount: subgoal.reportIds.length })}
                          </Badge>
                          <Badge variant="outline">
                            {tr("comparisons", {
                              comparisonPresetIdsCount: subgoal.comparisonPresetIds.length,
                            })}
                          </Badge>
                          <Badge variant="outline">
                            {tr("automations2", {
                              automationStarterIdsCount: subgoal.automationStarterIds.length,
                            })}
                          </Badge>
                          <Badge variant="outline">
                            {tr("deliveries", {
                              deliverySubscriptionIdsCount: subgoal.deliverySubscriptionIds.length,
                            })}
                          </Badge>
                          <Badge variant="outline">
                            {tr("questions2", {
                              decisionShortcutIdsCount: subgoal.decisionShortcutIds.length,
                            })}
                          </Badge>
                        </div>

                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-xs text-muted-foreground">
                            {tr("next", { nextAction: subgoal.nextAction })}
                          </div>
                          <Button asChild size="sm" variant="ghost" className="justify-start">
                            <Link href={area.href}>{tr("openHeader")}</Link>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section
        className={reportWorkspacePanelClass("delivery", "space-y-4")}
        aria-labelledby="report-pack-readiness-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-pack-readiness-title" className="text-xl font-semibold">
              {tr("reportPackReadiness")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("deliveryChecksForScheduledPacksBefore", { personaScopeDescription })}
            </p>
          </div>
          <Badge
            variant={
              visibleReportPackReadiness.some((item) => item.reviewCount > 0)
                ? "warning"
                : "success"
            }
            dot
          >
            {visibleReportPackReadiness.reduce((sum, item) => sum + item.reviewCount, 0)}{" "}
            {tr("review2")}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleReportPackReadiness.map((item) => {
            const workspace = item.workspace;
            const WorkspaceIcon = workspace.icon;
            const healthTrend = visibleReportAutomationHealthTrends.find(
              (entry) => entry.workspace.persona === workspace.persona
            )?.trend;

            return (
              <Card key={workspace.persona} data-testid={`pack-readiness-${workspace.persona}`}>
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">{workspace.title}</CardTitle>
                        <CardDescription>{workspace.packSchedule.delivery}</CardDescription>
                      </div>
                    </div>
                    <Badge variant={item.reviewCount > 0 ? "warning" : "success"} dot>
                      {item.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div
                    className="rounded-md border p-3"
                    data-testid={`pack-automation-health-${workspace.persona}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium uppercase text-muted-foreground">
                          {tr("automationHealth")}
                        </div>
                        <div dir="ltr" className="mt-1 font-mono text-2xl font-semibold">
                          {item.automationHealth.score}
                          <span className="text-xs font-normal text-muted-foreground">/100</span>
                        </div>
                      </div>
                      <Badge variant={item.automationHealth.variant} dot>
                        {item.automationHealth.label}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">{tr("pack")}</div>
                        <div dir="ltr" className="font-mono font-semibold">
                          {item.automationHealth.readinessScore}%
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">{tr("lanes")}</div>
                        <div dir="ltr" className="font-mono font-semibold">
                          {item.automationHealth.automationLaneScore}%
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">{tr("review")}</div>
                        <div dir="ltr" className="font-mono font-semibold">
                          {item.automationHealth.reviewSignals}
                        </div>
                      </div>
                    </div>
                    {healthTrend ? (
                      <div
                        className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 p-2"
                        data-testid={`automation-health-trend-${item.workspace.persona}`}
                      >
                        <div>
                          <div className="text-xs font-medium">{tr("healthTrend")}</div>
                          <div className="text-xs text-muted-foreground">{healthTrend.detail}</div>
                        </div>
                        <Badge variant={healthTrend.variant} dot>
                          {healthTrend.label}
                        </Badge>
                      </div>
                    ) : null}
                  </div>

                  {item.checks.map((check) => (
                    <div
                      key={check.id}
                      className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="text-sm font-medium">{check.label}</div>
                        <div className="text-xs text-muted-foreground">{check.detail}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={check.status === "Ready" ? "success" : "warning"} dot>
                          {check.status}
                        </Badge>
                        <Button asChild size="sm" variant="outline">
                          <Link href={check.workflow}>{tr("open")}</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section
        className={reportWorkspacePanelClass("comparisons", "space-y-4")}
        aria-labelledby="period-comparison-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="period-comparison-title" className="text-xl font-semibold">
              {tr("periodComparison")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("comparedWith", {
                comparisonCurrentLabel,
                comparisonPreviousLabel,
                personaScopeDescription,
              })}
            </p>
          </div>
          <Badge
            variant={
              personaFilter === "all" ? (comparisonRanges.isCustom ? "info" : "neutral") : "info"
            }
            dot
          >
            {personaFilter === "all"
              ? comparisonRanges.isCustom
                ? tr("customRange")
                : tr("monthToDate")
              : personaFilterLabel}
          </Badge>
        </div>

        {visibleReportComparisonPresets.length ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {visibleReportComparisonPresets.map((preset) => (
              <Card
                key={preset.id}
                id={`report-comparison-preset-${preset.id}`}
                data-testid={`report-comparison-preset-${preset.id}`}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base font-semibold">{preset.title}</CardTitle>
                      <CardDescription>{preset.baseline}</CardDescription>
                    </div>
                    <Badge variant={preset.warningCount > 0 ? "warning" : "success"} dot>
                      {preset.warningCount > 0
                        ? tr("review3", { warningCount: preset.warningCount })
                        : tr("clear")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{preset.question}</p>

                  <div className="space-y-2">
                    {preset.metrics.map((metric) => (
                      <div
                        key={metric.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">{metric.label}</div>
                          <div className="text-muted-foreground">{metric.signal}</div>
                        </div>
                        <Badge variant={comparisonBadgeVariant(metric)}>
                          {formatComparisonPercent(metric.percentChange)}
                        </Badge>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {preset.reports.slice(0, 4).map((report) => (
                      <Badge key={report.id} variant="outline">
                        {report.name}
                      </Badge>
                    ))}
                    {preset.reports.length > 4 ? (
                      <Badge variant="neutral">+{preset.reports.length - 4}</Badge>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs leading-relaxed text-muted-foreground">
                      {preset.automationTrigger}
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href={preset.href}>{tr("openPreset")}</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        {comparisonLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-5">
            {visibleComparisonRows.map((row) => (
              <Card key={row.id}>
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base font-semibold">{row.label}</CardTitle>
                      <CardDescription>{row.signal}</CardDescription>
                    </div>
                    <Badge variant={comparisonBadgeVariant(row)} dot>
                      {formatComparisonPercent(row.percentChange)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        {row.currentLabel ?? tr("current")}
                      </div>
                      <div dir="ltr" className="font-mono text-lg font-semibold">
                        {formatComparisonValue(row, row.current, locale)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        {row.previousLabel ?? tr("previous")}
                      </div>
                      <div dir="ltr" className="font-mono text-lg font-semibold">
                        {formatComparisonValue(row, row.previous, locale)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">{tr("movement")}</div>
                      <div dir="ltr" className="truncate font-mono text-sm font-semibold">
                        {formatComparisonValue(row, row.delta, locale)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveTab(row.tab)}
                    >
                      {tr("open")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="automation-queues-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="automation-queues-title" className="text-xl font-semibold">
              {tr("automationQueues")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("liveReportSignalsRoutedToThe", { personaScopeDescription })}
            </p>
          </div>
          <Badge variant={automationQueueCount > 0 ? "warning" : "success"} dot>
            {tr("open3", { automationQueueCount })}
          </Badge>
        </div>

        {automationLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {visibleAutomationQueue.map((item) => {
              const Icon = item.icon;
              const hasAction = item.count > 0;
              return (
                <Card key={item.id}>
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">{item.title}</CardTitle>
                          <CardDescription>{item.detail}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={hasAction ? "warning" : "success"} dot>
                        {hasAction ? tr("review") : tr("clear")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{item.signal}</div>
                        <div dir="ltr" className="font-mono text-2xl font-semibold">
                          {item.count}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{tr("amount")}</div>
                        <div dir="ltr" className="font-mono text-lg font-semibold">
                          {typeof item.amount === "number"
                            ? formatCurrency(item.amount, item.currency ?? "AED", locale)
                            : "-"}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {item.personas.map((persona) => (
                        <Badge key={persona} variant="outline" className="capitalize">
                          {persona}
                        </Badge>
                      ))}
                    </div>

                    {item.href ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={item.href}>{item.actionLabel}</Link>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => item.tab && setActiveTab(item.tab)}
                      >
                        {item.actionLabel}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="automation-coverage-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="automation-coverage-title" className="text-xl font-semibold">
              {tr("automationCoverage")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("roleCoverageAcrossLiveReportsComparison", { personaScopeDescription })}
            </p>
          </div>
          <Badge variant="info" dot>
            {tr("roleViews2", { visibleAutomationCoverageCount: visibleAutomationCoverage.length })}
          </Badge>
        </div>

        {automationLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {visibleAutomationCoverage.map((item) => {
              const workspace = item.workspace;
              const WorkspaceIcon = workspace.icon;

              return (
                <Card
                  key={workspace.persona}
                  data-testid={`automation-coverage-${workspace.persona}`}
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">
                            {workspace.title}
                          </CardTitle>
                          <CardDescription>{workspace.focus}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={item.openSignalCount > 0 ? "warning" : "success"} dot>
                        {item.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-2">
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{tr("liveReports")}</div>
                        <div dir="ltr" className="font-mono text-lg font-semibold">
                          {item.liveReportCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{tr("automations")}</div>
                        <div dir="ltr" className="font-mono text-lg font-semibold">
                          {item.automatedSignalCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{tr("comparisons2")}</div>
                        <div dir="ltr" className="font-mono text-lg font-semibold">
                          {item.comparisonTypeCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{tr("workflows3")}</div>
                        <div dir="ltr" className="font-mono text-lg font-semibold">
                          {item.workflowReportCount}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium uppercase text-muted-foreground">
                          {tr("openWork")}
                        </span>
                        <span dir="ltr" className="font-mono">
                          {tr("items", {
                            openWorkItemCount: item.openWorkItemCount,
                            formatCurrency: formatCurrency(item.amountAtRisk, "AED", locale),
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        {tr("signalCoverage")}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {item.topSignals.map((signal) => (
                          <Badge key={signal} variant="outline">
                            {signal}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-md border p-3 text-xs text-muted-foreground">
                      <div>
                        <span className="font-medium text-foreground">{tr("packCadence")}</span>{" "}
                        {workspace.packSchedule.cadence}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium text-foreground">{tr("packAutomation")}</span>{" "}
                        {workspace.packSchedule.automation}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(reportWorkspaceHref(workspace))}
                      >
                        {tr("openWorkspace")}
                      </Button>
                      <Badge variant="outline">
                        {tr("playbooks2", { playbookCount: item.playbookCount })}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="automation-command-center-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="automation-command-center-title" className="text-xl font-semibold">
              {tr("automationCommandCenter")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("autoSendReadinessAcrossReportRules", { personaScopeDescription })}
            </p>
          </div>
          <Badge
            variant={
              reportAutomationCommandCenter.reviewRuleCount +
                reportAutomationCommandCenter.setupRuleCount >
              0
                ? "warning"
                : "success"
            }
            dot
          >
            {tr("autoSendCoverage2", {
              autoSendCoveragePercent: reportAutomationCommandCenter.autoSendCoveragePercent,
            })}
          </Badge>
        </div>

        {automationLoading || comparisonLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Card data-testid="automation-command-center">
            <CardHeader className="space-y-3 pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">
                    {tr("autoSendReadiness")}
                  </CardTitle>
                  <CardDescription>{tr("ruleCoverageAndOpenWorkBefore")}</CardDescription>
                </div>
                <Badge
                  variant={
                    reportAutomationCommandCenter.reviewRuleCount +
                      reportAutomationCommandCenter.setupRuleCount >
                    0
                      ? "warning"
                      : "success"
                  }
                  dot
                >
                  {tr("rulesReady2", {
                    readyRuleCount: reportAutomationCommandCenter.readyRuleCount,
                    ruleCount: reportAutomationCommandCenter.ruleCount,
                  })}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-5">
                {[
                  {
                    label: tr("automationRules"),
                    value: reportAutomationCommandCenter.ruleCount,
                  },
                  {
                    label: tr("readyAutoSend"),
                    value: reportAutomationCommandCenter.readyRuleCount,
                  },
                  {
                    label: tr("needReview2"),
                    value: reportAutomationCommandCenter.reviewRuleCount,
                  },
                  {
                    label: tr("setupNeeded"),
                    value: reportAutomationCommandCenter.setupRuleCount,
                  },
                  {
                    label: tr("openWork"),
                    value: reportAutomationCommandCenter.openWorkItemCount,
                  },
                  {
                    label: tr("amountAtRisk2"),
                    value: formatCurrency(
                      reportAutomationCommandCenter.amountAtRisk,
                      "AED",
                      locale
                    ),
                    className: "text-sm",
                  },
                  {
                    label: tr("comparisonsLinked"),
                    value: reportAutomationCommandCenter.comparisonMetricCount,
                  },
                  {
                    label: tr("reportBundle"),
                    value: reportAutomationCommandCenter.reportBundleCount,
                  },
                  {
                    label: tr("packsReady"),
                    value: reportAutomationCommandCenter.readyPackCount,
                  },
                  {
                    label: tr("packsInReview"),
                    value: reportAutomationCommandCenter.reviewPackCount,
                  },
                ].map((metric) => (
                  <div key={metric.label} className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{metric.label}</div>
                    <div
                      dir="ltr"
                      className={`truncate font-mono text-lg font-semibold ${
                        metric.className ?? ""
                      }`}
                    >
                      {metric.value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    {tr("topBlockers")}
                  </div>
                  {reportAutomationCommandCenter.topReviewRules.length ? (
                    reportAutomationCommandCenter.topReviewRules.map((rule) => (
                      <div
                        key={rule.id}
                        data-testid={`automation-command-center-blocker-${rule.id}`}
                        className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium">{rule.playbook.title}</div>
                            <Badge variant={rule.statusVariant} dot>
                              {rule.status}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {tr("openWorkItems4", {
                              title: rule.workspace.title,
                              openWorkItemCount: rule.openWorkItemCount,
                              formatCurrency: formatCurrency(rule.amountAtRisk, "AED", locale),
                            })}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {tr("reportsLiveWithLinkedComparisons", {
                              liveReportCount: rule.liveReportCount,
                              reportCount: rule.reportCount,
                              comparisonMetricCount: rule.comparisonMetricCount,
                            })}
                          </div>
                        </div>
                        <Button asChild size="sm" variant="outline">
                          <Link href={rule.targetWorkflow}>{rule.playbook.cta}</Link>
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border p-3 text-sm text-muted-foreground">
                      {tr("allVisibleRulesAreReadyFor")}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    {tr("packDeliveryReadiness")}
                  </div>
                  {visibleReportPackReadiness.map((item) => (
                    <div
                      key={item.workspace.persona}
                      data-testid={`automation-command-center-pack-${item.workspace.persona}`}
                      className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium">{item.workspace.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {tr("checksNeedReviewHealth100", {
                            reviewCount: item.reviewCount,
                            score: item.automationHealth.score,
                          })}
                        </div>
                      </div>
                      <Badge variant={item.reviewCount > 0 ? "warning" : "success"} dot>
                        {item.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="report-automation-rules-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-automation-rules-title" className="text-xl font-semibold">
              {tr("reportAutomationRules")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("roleSpecificPackRulesThatConnect", { personaScopeDescription })}
            </p>
          </div>
          <Badge variant={reportAutomationRuleReviewCount > 0 ? "warning" : "success"} dot>
            {tr("needReview3", { reportAutomationRuleReviewCount })}
          </Badge>
        </div>

        {automationLoading || comparisonLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {visibleReportAutomationRules.map((rule) => {
              const workspace = rule.workspace;
              const WorkspaceIcon = workspace.icon;

              return (
                <Card key={rule.id} data-testid={`automation-rule-${rule.id}`}>
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">
                            {rule.playbook.title}
                          </CardTitle>
                          <CardDescription>{workspace.title}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={rule.statusVariant} dot>
                        {rule.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{tr("reports")}</div>
                        <div dir="ltr" className="font-mono text-lg font-semibold">
                          {rule.liveReportCount}/{rule.reportCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{tr("comparisons2")}</div>
                        <div dir="ltr" className="font-mono text-lg font-semibold">
                          {rule.comparisonMetricCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{tr("openWork")}</div>
                        <div dir="ltr" className="font-mono text-lg font-semibold">
                          {rule.openWorkItemCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{tr("amount")}</div>
                        <div dir="ltr" className="truncate font-mono text-sm font-semibold">
                          {formatCurrency(rule.amountAtRisk, "AED", locale)}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3 text-xs text-muted-foreground">
                      <div>
                        <span className="font-medium text-foreground">{tr("trigger2")}</span>{" "}
                        {rule.playbook.trigger}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium text-foreground">{tr("cadence2")}</span>{" "}
                        {workspace.packSchedule.cadence}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium text-foreground">{tr("recipients3")}</span>{" "}
                        {workspace.packSchedule.recipients}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        {tr("reportBundle")}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {rule.linkedReports.slice(0, 5).map((report) => (
                          <Badge key={report.id} variant="outline">
                            {report.name}
                          </Badge>
                        ))}
                        {rule.linkedReports.length > 5 ? (
                          <Badge variant="outline">+{rule.linkedReports.length - 5}</Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        {tr("ruleSignals")}
                      </div>
                      {rule.matchingSignals.length ? (
                        rule.matchingSignals.slice(0, 3).map((signal) => (
                          <div
                            key={signal.id}
                            className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                          >
                            <div className="min-w-0">
                              <div className="font-medium">{signal.title}</div>
                              <div className="text-xs text-muted-foreground">{signal.signal}</div>
                            </div>
                            <Badge variant={signal.count > 0 ? "warning" : "success"} dot>
                              {signal.count > 0 ? signal.count : tr("clear")}
                            </Badge>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-md border p-3 text-sm text-muted-foreground">
                          {tr("noLiveExceptionsCurrentlyMapTo")}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        {tr("automationRunbook")}
                      </div>
                      {rule.runbookSteps.map((step, index) => (
                        <div
                          key={step.id}
                          className="rounded-md border p-3"
                          data-testid={`automation-rule-runbook-${rule.id}-${step.phase}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold">
                              {index + 1}
                            </div>
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-foreground">
                                    {step.title}
                                  </div>
                                  <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                    {step.outcome}
                                  </div>
                                </div>
                                <Badge variant="outline">{step.phase}</Badge>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                <Badge variant="outline">
                                  {tr("reports4", { reportIdsCount: step.reportIds.length })}
                                </Badge>
                                <Badge variant="outline">
                                  {tr("rules3", {
                                    triggerRuleIdsCount: step.triggerRuleIds.length,
                                  })}
                                </Badge>
                                <Badge variant="outline">
                                  {tr("deliveries", {
                                    deliverySubscriptionIdsCount:
                                      step.deliverySubscriptionIds.length,
                                  })}
                                </Badge>
                              </div>
                              <Button asChild size="sm" variant="outline">
                                <Link href={step.href}>
                                  {step.actionLabel} <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <Button asChild size="sm" variant="outline">
                      <Link href={rule.targetWorkflow}>{rule.playbook.cta}</Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section
        className={reportWorkspacePanelClass("setup", "space-y-4")}
        aria-labelledby="report-roadmap-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-roadmap-title" className="text-xl font-semibold">
              {tr("reportRoadmap")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("plannedReportGapsByRoleWith", { personaScopeDescription })}
            </p>
          </div>
          <Badge variant={visiblePlannedReportCount > 0 ? "warning" : "success"} dot>
            {tr("planned2", { visiblePlannedReportCount })}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleReportRoadmap.map((item) => {
            const workspace = item.workspace;
            const WorkspaceIcon = workspace.icon;

            return (
              <Card key={workspace.persona} data-testid={`report-roadmap-${workspace.persona}`}>
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">{workspace.title}</CardTitle>
                        <CardDescription>{workspace.focus}</CardDescription>
                      </div>
                    </div>
                    <Badge variant={item.plannedReportCount > 0 ? "warning" : "success"} dot>
                      {item.roadmapStatus}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{tr("liveNow")}</div>
                      <div dir="ltr" className="font-mono text-lg font-semibold">
                        {item.liveReportCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{tr("planned")}</div>
                      <div dir="ltr" className="font-mono text-lg font-semibold">
                        {item.plannedReportCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{tr("categories")}</div>
                      <div dir="ltr" className="font-mono text-lg font-semibold">
                        {item.plannedCategories.length}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{tr("prereqs")}</div>
                      <div dir="ltr" className="font-mono text-lg font-semibold">
                        {item.prerequisiteCount}
                      </div>
                    </div>
                  </div>

                  {item.topPriorityReport ? (
                    <div className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-medium uppercase text-muted-foreground">
                            {tr("topRoadmapPriority")}
                          </div>
                          <div className="mt-1 text-sm font-medium">
                            {item.topPriorityReport.name}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="warning">{item.topPriorityScore}</Badge>
                          {item.topPriorityImpact ? (
                            <Badge
                              variant={getRoadmapImpactMeta()[item.topPriorityImpact].variant}
                              dot
                            >
                              {getRoadmapImpactMeta()[item.topPriorityImpact].label}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {item.topPriorityReport.roadmapPriority?.rationale}
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      {tr("nextReportUnlocks")}
                    </div>
                    {item.nextReports.length > 0 ? (
                      item.nextReports.map((report) => {
                        const impact = report.roadmapPriority?.impactByPersona[workspace.persona];
                        return (
                          <div
                            key={report.id}
                            className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-medium">{report.name}</div>
                                <Badge variant="outline">{report.category}</Badge>
                                {typeof report.roadmapPriority?.score === "number" ? (
                                  <Badge variant="warning">{report.roadmapPriority.score}</Badge>
                                ) : null}
                                {impact ? (
                                  <Badge variant={getRoadmapImpactMeta()[impact].variant} dot>
                                    {getRoadmapImpactMeta()[impact].label}
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {report.comparison} - {report.automation}
                              </div>
                              {report.roadmapPriority?.rationale ? (
                                <div className="text-xs text-muted-foreground">
                                  {report.roadmapPriority.rationale}
                                </div>
                              ) : null}
                              {report.roadmapPrerequisites ? (
                                <div className="grid gap-2 pt-2 text-xs text-muted-foreground">
                                  <div>
                                    <span className="font-medium text-foreground">
                                      {tr("dataSource")}
                                    </span>{" "}
                                    {report.roadmapPrerequisites.dataSource}
                                  </div>
                                  <div>
                                    <span className="font-medium text-foreground">
                                      {tr("workflowDependency2")}
                                    </span>{" "}
                                    {report.roadmapPrerequisites.workflowDependency}
                                  </div>
                                  <div>
                                    <span className="font-medium text-foreground">
                                      {tr("automationRule")}
                                    </span>{" "}
                                    {report.roadmapPrerequisites.automationRule}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <Button asChild size="sm" variant="outline">
                              <Link
                                href={
                                  reportPersonaHref(report, workspace.persona) ??
                                  reportWorkspaceHref(workspace)
                                }
                              >
                                {tr("openArea")}
                              </Link>
                            </Button>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-md border p-3 text-sm text-muted-foreground">
                        {tr("allTargetReportsForThisWorkspace")}
                      </div>
                    )}
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      {tr("automationUnlocks")}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(item.plannedAutomationHooks.length > 0
                        ? item.plannedAutomationHooks
                        : [tr("noPlannedAutomationGaps")]
                      ).map((hook) => (
                        <Badge key={hook} variant="outline">
                          {hook}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      {tr("workflowDependencies")}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(item.plannedWorkflowDependencies.length > 0
                        ? item.plannedWorkflowDependencies
                        : [tr("noPlannedWorkflowDependencies")]
                      ).map((dependency) => (
                        <Badge key={dependency} variant="outline">
                          {dependency}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <Button asChild size="sm" variant="outline">
                    <Link href={item.nextWorkflow}>{tr("openNextWorkflow")}</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section
        className={reportWorkspacePanelClass("delivery", "space-y-4")}
        aria-labelledby="report-pack-automation-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-pack-automation-title" className="text-xl font-semibold">
              {tr("reportPackAutomation")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("scheduledWorkspacePacksWithLiveReport", { personaScopeDescription })}
            </p>
          </div>
          <Badge variant={reportPackReviewCount > 0 ? "warning" : "success"} dot>
            {tr("needReview4", { reportPackReviewCount })}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleReportPackAutomation.map((item) => {
            const workspace = item.workspace;
            const WorkspaceIcon = workspace.icon;
            const readiness = visibleReportPackReadiness.find(
              (entry) => entry.workspace.persona === workspace.persona
            );
            const automationHealth = readiness?.automationHealth;

            return (
              <Card key={workspace.persona}>
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">{workspace.title}</CardTitle>
                        <CardDescription>{workspace.packSchedule.cadence}</CardDescription>
                      </div>
                    </div>
                    <Badge variant={(readiness?.reviewCount ?? 0) > 0 ? "warning" : "success"} dot>
                      {readiness?.status ?? item.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{tr("health")}</div>
                      <div dir="ltr" className="font-mono text-lg font-semibold">
                        {automationHealth?.score ?? 0}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{tr("openSignals")}</div>
                      <div dir="ltr" className="font-mono text-lg font-semibold">
                        {item.openSignalCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{tr("workItems")}</div>
                      <div dir="ltr" className="font-mono text-lg font-semibold">
                        {item.openWorkItemCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{tr("amount")}</div>
                      <div dir="ltr" className="truncate font-mono text-sm font-semibold">
                        {formatCurrency(item.amountAtRisk, "AED", locale)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border p-3 text-xs text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">{tr("delivery2")}</span>{" "}
                      {workspace.packSchedule.delivery}
                    </div>
                    <div className="mt-1">
                      <span className="font-medium text-foreground">{tr("recipients3")}</span>{" "}
                      {workspace.packSchedule.recipients}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      {tr("reportPackReadiness")}
                    </div>
                    {readiness?.checks.slice(0, 4).map((check) => (
                      <div
                        key={check.id}
                        className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">{check.label}</div>
                          <div className="text-xs text-muted-foreground">{check.detail}</div>
                        </div>
                        <Badge variant={check.status === "Ready" ? "success" : "warning"} dot>
                          {check.status}
                        </Badge>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      {tr("liveSignals")}
                    </div>
                    {item.signals.slice(0, 3).map((signal) => (
                      <div
                        key={signal.id}
                        className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">{signal.title}</div>
                          <div className="text-xs text-muted-foreground">{signal.detail}</div>
                        </div>
                        <Badge variant={signal.count > 0 ? "warning" : "success"} dot>
                          {signal.count > 0 ? signal.count : tr("clear")}
                        </Badge>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(reportWorkspaceHref(workspace))}
                    >
                      {tr("openWorkspace")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isExporting || !selectedCompanyId}
                      onClick={() => handleExportWorkspacePackToSheets(workspace)}
                    >
                      <SiGooglesheets className="me-2 h-4 w-4" />
                      {tr("sendPack")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section
        className={reportWorkspacePanelClass("comparisons", "space-y-4")}
        aria-labelledby="comparison-snapshots-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="comparison-snapshots-title" className="text-xl font-semibold">
              {tr("comparisonSnapshots")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {comparisonCurrentLabel} vs {comparisonPreviousLabel}. {personaScopeDescription}
            </p>
          </div>
          <Badge variant={personaFilter === "all" ? "outline" : "info"}>
            {personaFilter === "all"
              ? comparisonRanges.isCustom
                ? tr("selectedRange")
                : tr("monthToDate")
              : personaFilterLabel}
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{tr("currentVsPriorPeriod")}</CardTitle>
            <CardDescription>{tr("highLevelMovementAcrossRevenueProfit")}</CardDescription>
          </CardHeader>
          <CardContent>
            {comparisonLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[920px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("metric")}</TableHead>
                      <TableHead>{tr("signal")}</TableHead>
                      <TableHead className="text-end">{tr("current")}</TableHead>
                      <TableHead className="text-end">{tr("baseline")}</TableHead>
                      <TableHead className="text-end">{tr("change")}</TableHead>
                      <TableHead>{tr("roles")}</TableHead>
                      <TableHead className="text-end">{tr("open")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleComparisonRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell>
                          <Badge variant={comparisonBadgeVariant(row)} dot>
                            {row.signal}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-end font-mono">
                          {formatComparisonValue(row, row.current, locale)}
                        </TableCell>
                        <TableCell className="text-end font-mono">
                          {formatComparisonValue(row, row.previous, locale)}
                        </TableCell>
                        <TableCell className="text-end">
                          <div dir="ltr" className="font-mono font-medium">
                            {formatComparisonValue(row, row.delta, locale)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatComparisonPercent(row.percentChange)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {row.personas.map((persona) => (
                              <Badge key={persona} variant="outline" className="capitalize">
                                {persona}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setActiveTab(row.tab)}
                          >
                            {tr("open")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section
        className={reportWorkspacePanelClass("setup", "space-y-4")}
        aria-labelledby="persona-workspaces-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="persona-workspaces-title" className="text-xl font-semibold">
              {tr("workspaces")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("roleFocusedReportCoverageForOwners")}
            </p>
          </div>
          <Badge variant="outline">
            {tr("roles2", { visibleWorkspaceSummariesCount: visibleWorkspaceSummaries.length })}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleWorkspaceSummaries.map((workspace) => {
            const WorkspaceIcon = workspace.icon;
            return (
              <Card key={workspace.persona}>
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">{workspace.title}</CardTitle>
                        <CardDescription>{workspace.focus}</CardDescription>
                      </div>
                    </div>
                    <Badge variant={workspace.readyReports > 0 ? "success" : "neutral"} dot>
                      {tr("ready2", { readyReports: workspace.readyReports })}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{tr("reports")}</div>
                      <div dir="ltr" className="font-mono text-lg font-semibold">
                        {workspace.catalogReportCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{tr("ready")}</div>
                      <div dir="ltr" className="font-mono text-lg font-semibold">
                        {workspace.readyReports}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{tr("automations")}</div>
                      <div dir="ltr" className="font-mono text-lg font-semibold">
                        {workspace.automationCount}
                      </div>
                    </div>
                  </div>

                  <div
                    className="grid grid-cols-3 gap-2 text-xs"
                    data-testid={`report-workspace-catalog-metadata-${workspace.persona}`}
                  >
                    <div className="rounded-md border p-3">
                      <div className="text-muted-foreground">{tr("packs")}</div>
                      <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
                        {workspace.packTemplateCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-muted-foreground">{tr("comparisons2")}</div>
                      <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
                        {workspace.comparisonPresetCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-muted-foreground">{tr("starters")}</div>
                      <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
                        {workspace.automationStarterCount}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{tr("readiness")}</span>
                      <span dir="ltr" className="font-mono">
                        {workspace.readiness}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${workspace.readiness}%` }}
                      />
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{tr("primarySignal")}</div>
                    <div className="text-sm font-medium">{workspace.topReadyReport?.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {workspace.topReadyReport?.automation}
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      {tr("automationOutcome")}
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {workspace.automationOutcome}
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      {tr("reportPackCadence")}
                    </div>
                    <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                      <div>
                        <span className="font-medium text-foreground">{tr("cadence2")}</span>{" "}
                        {workspace.packSchedule.cadence}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">{tr("delivery2")}</span>{" "}
                        {workspace.packSchedule.delivery}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">{tr("automation2")}</span>{" "}
                        {workspace.packSchedule.automation}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      {tr("automationPlaybooks")}
                    </div>
                    {workspace.automations.map((playbook) => {
                      const linkedReports = playbook.reportIds
                        .map((reportId) => reportCatalog.find((report) => report.id === reportId))
                        .filter((report): report is (typeof reportCatalog)[number] =>
                          Boolean(report)
                        );

                      return (
                        <div key={playbook.id} className="rounded-md border p-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 space-y-1">
                              <div className="text-sm font-medium">{playbook.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {tr("trigger3", { trigger: playbook.trigger })}
                              </div>
                              <div className="flex flex-wrap gap-1 pt-1">
                                {linkedReports.slice(0, 3).map((report) => (
                                  <Badge key={report.id} variant="outline">
                                    {report.name}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <Button asChild size="sm" variant="outline">
                              <Link
                                href={reportAutomationPlaybookHref(playbook, workspace.persona)}
                              >
                                {playbook.cta}
                              </Link>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        navigate(reportWorkspaceHref(workspace));
                      }}
                      data-testid={`button-open-workspace-${workspace.persona}`}
                    >
                      {tr("openReports")}
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={reportSectionHref(workspace, "automation-command-center")}
                        data-testid={`button-open-automation-center-${workspace.persona}`}
                      >
                        {tr("openAutomations")}
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setReportPersonaFilter(workspace.persona)}
                    >
                      {tr("filterLibrary")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isExporting}
                      onClick={() => handleExportWorkspacePack(workspace)}
                      data-testid={`button-export-workspace-pack-${workspace.persona}`}
                    >
                      <Download className="me-2 h-4 w-4" />
                      {tr("exportPack")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isExporting || !selectedCompanyId}
                      onClick={() => handleExportWorkspacePackToSheets(workspace)}
                      data-testid={`button-export-workspace-pack-sheets-${workspace.persona}`}
                    >
                      <SiGooglesheets className="me-2 h-4 w-4" />
                      {tr("sheetsPack")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section
        className={reportWorkspacePanelClass("suites", "space-y-4")}
        aria-labelledby="report-pack-templates-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-pack-templates-title" className="text-xl font-semibold">
              {tr("reportPackTemplates")}
            </h2>
            <p className="text-sm text-muted-foreground">{tr("readyMadePacksForRecurringOwner")}</p>
          </div>
          <Badge variant="outline">
            {tr("templates", {
              visibleReportPackTemplatesCount: visibleReportPackTemplates.length,
            })}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {visibleReportPackTemplates.map((template) => {
            const TemplateIcon = template.workspace.icon;

            return (
              <Card
                key={template.id}
                id={`report-pack-template-${template.id}`}
                data-testid={`report-pack-template-${template.id}`}
              >
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base">{template.title}</CardTitle>
                      <CardDescription>{template.audience}</CardDescription>
                    </div>
                    <TemplateIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  </div>
                  <Badge variant="outline" className="w-fit capitalize">
                    {template.persona}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{template.outcome}</p>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border p-3">
                      <div className="font-medium text-foreground">{tr("cadence")}</div>
                      <div className="mt-1 text-muted-foreground">{template.cadence}</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="font-medium text-foreground">{tr("readyReports")}</div>
                      <div dir="ltr" className="mt-1 font-mono text-base font-semibold">
                        {template.readyCount}/{template.reports.length}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">{tr("comparisons3")}</span>{" "}
                      {template.comparisonFocus}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">{tr("automation2")}</span>{" "}
                      {template.automationTrigger}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">{tr("delivery2")}</span>{" "}
                      {template.delivery}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {template.reports.slice(0, 5).map((report) => (
                      <Badge key={report.id} variant="outline">
                        {report.name}
                      </Badge>
                    ))}
                    {template.reports.length > 5 ? (
                      <Badge variant="neutral">+{template.reports.length - 5}</Badge>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link href={template.href}>{tr("openTemplate")}</Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setReportPersonaFilter(template.persona)}
                    >
                      {tr("filterLibrary")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section
        className={reportDiscoveryPanelClass("space-y-4")}
        aria-labelledby="report-center-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-center-title" className="text-xl font-semibold">
              {tr("reportCenter2")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tr("readyApiBackedReportsFromA", {
                ready: reportStats.ready,
                total: reportStats.total,
              })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={tr("reportPersonaFilter")}>
            {getPersonaFilters().map((filter) => (
              <Button
                key={filter.id}
                type="button"
                size="sm"
                variant={personaFilter === filter.id ? "default" : "outline"}
                onClick={() => setReportPersonaFilter(filter.id)}
                data-testid={`button-report-filter-${filter.id}`}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tr("inlineReports")}
              </CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div dir="ltr" className="font-mono text-2xl font-semibold">
                {reportStats.live}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tr("readyApiBacked")}
              </CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div dir="ltr" className="font-mono text-2xl font-semibold">
                {reportStats.ready}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tr("targetCatalog")}
              </CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div dir="ltr" className="font-mono text-2xl font-semibold">
                {reportStats.total}
              </div>
            </CardContent>
          </Card>
        </div>

        {favoriteReports.length > 0 ? (
          <Card data-testid="favorite-report-shortcuts">
            <CardHeader className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>{tr("pinnedReports")}</CardTitle>
                  <CardDescription>{tr("reportShortcutsSavedForTheCurrent")}</CardDescription>
                </div>
                <Badge variant="success" dot>
                  {tr("pinned2", { favoriteReportsCount: favoriteReports.length })}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {favoriteReports.map((report) => {
                  const favoritePersona =
                    personaFilter === "all" ? (report.personas[0] ?? "owner") : personaFilter;
                  const openHref =
                    reportPersonaHref(report, favoritePersona) ?? reportHref(report) ?? "/reports";

                  return (
                    <div key={report.id} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{report.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {report.category} · {report.automation}
                          </div>
                        </div>
                        <Pin className="h-4 w-4 shrink-0 text-accent" />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link href={openHref}>{tr("open")}</Link>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleReportFavorite(report)}
                          data-testid={`report-favorite-shortcut-toggle-${report.id}`}
                        >
                          {tr("unpin")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card data-testid="favorite-report-shortcuts-empty">
            <CardContent className="flex flex-col gap-2 p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>{tr("pinReportsFromTheLibraryTo")}</span>
              <Badge variant="neutral">{tr("noPinnedReports")}</Badge>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>{tr("reportCoverageMap")}</CardTitle>
                <CardDescription>{tr("categoryLevelViewOfReportDepth")}</CardDescription>
              </div>
              <Badge variant="outline">
                {tr("categories2", { reportCoverageMapCount: reportCoverageMap.length })}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {reportCoverageMap.map((coverage) => {
                const categoryId = coverage.category
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "");
                const readyCount = coverage.liveCount + coverage.apiReadyCount;

                return (
                  <div
                    key={coverage.category}
                    className="space-y-3 rounded-md border p-4"
                    data-testid={`report-coverage-${categoryId}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{coverage.category}</div>
                        <div className="text-xs text-muted-foreground">
                          {tr("reportsFor", {
                            reportsCount: coverage.reports.length,
                            personas: coverage.personas.join(", "),
                          })}
                        </div>
                      </div>
                      <Badge variant={coverage.plannedCount > 0 ? "warning" : "success"} dot>
                        {tr("ready3", { readyCount })}
                      </Badge>
                    </div>

                    <dl className="grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md bg-muted/40 p-2">
                        <dt className="text-muted-foreground">{tr("live")}</dt>
                        <dd dir="ltr" className="font-mono text-base font-semibold">
                          {coverage.liveCount}
                        </dd>
                      </div>
                      <div className="rounded-md bg-muted/40 p-2">
                        <dt className="text-muted-foreground">API</dt>
                        <dd dir="ltr" className="font-mono text-base font-semibold">
                          {coverage.apiReadyCount}
                        </dd>
                      </div>
                      <div className="rounded-md bg-muted/40 p-2">
                        <dt className="text-muted-foreground">{tr("planned")}</dt>
                        <dd dir="ltr" className="font-mono text-base font-semibold">
                          {coverage.plannedCount}
                        </dd>
                      </div>
                    </dl>

                    <div className="space-y-2 text-xs text-muted-foreground">
                      <div className="break-words">
                        <span className="font-medium text-foreground">{tr("comparisons3")}</span>{" "}
                        {coverage.comparisonTypes.slice(0, 3).join(", ")}
                      </div>
                      <div className="break-words">
                        <span className="font-medium text-foreground">{tr("automations3")}</span>{" "}
                        {coverage.automationHooks.slice(0, 3).join(", ")}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {coverage.reports.slice(0, 4).map((report) => (
                        <Badge key={report.id} variant="outline">
                          {report.name}
                        </Badge>
                      ))}
                      {coverage.reports.length > 4 ? (
                        <Badge variant="neutral">+{coverage.reports.length - 4}</Badge>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tr("reportLibrary")}</CardTitle>
            <CardDescription>{tr("decisionQuestionStatusComparisonModeAnd")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table className="min-w-[960px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("report")}</TableHead>
                    <TableHead>{tr("category")}</TableHead>
                    <TableHead>{tr("status")}</TableHead>
                    <TableHead>{tr("comparison")}</TableHead>
                    <TableHead>{tr("automation")}</TableHead>
                    <TableHead className="text-end">{tr("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReports.map((report) => {
                    const status = getReportStatusMeta()[report.status];
                    const isFavoriteReport = favoriteReportIdSet.has(report.id);
                    const reportPersona =
                      personaFilter === "all" ? (report.personas[0] ?? "owner") : personaFilter;
                    const context = reportActionContextByPersonaReportId.get(
                      `${reportPersona}:${report.id}`
                    );
                    const localReportHref =
                      report.href ??
                      (report.tab
                        ? reportsHref({ tab: report.tab, persona: reportPersona })
                        : null);
                    const openHref = context?.reportHref ?? localReportHref;
                    const workflowHref =
                      context?.workflowHref ??
                      reportWorkflowContextHref({
                        persona: reportPersona,
                        tab: report.tab,
                        search: report.name,
                      });
                    const comparisonHref = context?.comparisonPresets[0]?.href;
                    const deliveryHref = context?.deliverySubscriptions[0]?.href;

                    return (
                      <TableRow key={report.name}>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium">{report.name}</div>
                            {isFavoriteReport ? (
                              <Badge variant="success" dot>
                                {tr("pinned3")}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {report.decisionQuestion}
                          </div>
                          <div className="flex flex-wrap gap-1 pt-1">
                            {report.personas.map((persona) => (
                              <Badge key={persona} variant="outline" className="capitalize">
                                {persona}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>{report.category}</TableCell>
                        <TableCell>
                          <Badge variant={status.variant} dot>
                            {status.label}
                          </Badge>
                        </TableCell>
                        <TableCell>{report.comparison}</TableCell>
                        <TableCell>{report.automation}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={isFavoriteReport ? "default" : "outline"}
                              aria-pressed={isFavoriteReport}
                              onClick={() => toggleReportFavorite(report)}
                              data-testid={`report-library-favorite-${report.id}`}
                            >
                              <Pin className="h-3.5 w-3.5" />
                              {isFavoriteReport ? tr("pinned3") : tr("pin")}
                            </Button>
                            {openHref ? (
                              <Button asChild size="sm" variant="outline">
                                <Link href={openHref}>
                                  {report.status === "planned" ? tr("openArea") : tr("open")}
                                </Link>
                              </Button>
                            ) : (
                              <Button type="button" size="sm" variant="ghost" disabled>
                                {tr("queued")}
                              </Button>
                            )}
                            <Button asChild size="sm" variant="outline">
                              <Link
                                href={workflowHref}
                                data-testid={`report-library-automation-${report.id}`}
                              >
                                {tr("automate")}
                              </Link>
                            </Button>
                            {comparisonHref ? (
                              <Button asChild size="sm" variant="outline">
                                <Link
                                  href={comparisonHref}
                                  data-testid={`report-library-comparison-${report.id}`}
                                >
                                  {tr("compare")}
                                </Link>
                              </Button>
                            ) : null}
                            {deliveryHref ? (
                              <Button asChild size="sm" variant="outline">
                                <Link
                                  href={deliveryHref}
                                  data-testid={`report-library-delivery-${report.id}`}
                                >
                                  {tr("schedule")}
                                </Link>
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {connectedReportCenters.length ? (
          <section className="space-y-3" aria-labelledby="connected-report-centers-title">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 id="connected-report-centers-title" className="text-lg font-semibold">
                  {tr("connectedReportCenters")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {tr("liveReportFamiliesServedByAdjacent")}
                </p>
              </div>
              <Badge variant="outline">
                {tr("connected", { connectedReportCentersCount: connectedReportCenters.length })}
              </Badge>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {connectedReportCenters.map((report) => (
                <Card key={report.id}>
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">{report.name}</CardTitle>
                        <CardDescription>{report.category}</CardDescription>
                      </div>
                      <Badge variant={getReportStatusMeta()[report.status].variant} dot>
                        {getReportStatusMeta()[report.status].label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-md border p-3 text-xs text-muted-foreground">
                      <div>
                        <span className="font-medium text-foreground">{tr("comparison2")}</span>{" "}
                        {report.comparison}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium text-foreground">{tr("automation2")}</span>{" "}
                        {report.automation}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {report.personas.map((persona) => (
                        <Badge key={persona} variant="outline" className="capitalize">
                          {persona}
                        </Badge>
                      ))}
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href={report.href}>{tr("openReportCenter")}</Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ) : null}
      </section>

      <div className={reportWorkspacePanelClass("reports", "space-y-6")}>
        {!hasFocusedReportSelection ? (
          <section
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            aria-label={tr("reportCenter")}
          >
            {reportViewerGroups.map((group) => (
              <Card key={group.category} className="overflow-hidden">
                <CardHeader className="border-b bg-muted/20 pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">{group.label}</CardTitle>
                    <Badge variant="outline">{group.options.length}</Badge>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {(t as any).reportCategoryCardDesc ?? tr("openAReportFromThisCategory")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="divide-y p-0">
                  {group.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      disabled={!option.href && !option.tab}
                      onClick={() => openReportViewerOption(option.id)}
                      className="flex w-full items-start justify-between gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid={`button-report-center-${option.id}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{option.label}</span>
                        <span className="mt-1 block line-clamp-2 text-xs leading-snug text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </CardContent>
              </Card>
            ))}
          </section>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as ReportTab, effectiveReportPersona)}
            className="space-y-6"
          >
            <TabsList className="sr-only">
              <TabsTrigger value="pl" data-testid="tab-profit-loss">
                {t.profitLoss}
              </TabsTrigger>
              <TabsTrigger value="bs" data-testid="tab-balance-sheet">
                {t.balanceSheet}
              </TabsTrigger>
              <TabsTrigger value="vat" data-testid="tab-vat-summary">
                {t.vatSummary}
              </TabsTrigger>
              <TabsTrigger value="tax" data-testid="tab-corporate-tax">
                {tr("corporateTax")}
              </TabsTrigger>
              <TabsTrigger value="sales" data-testid="tab-invoice-status">
                {tr("sales")}
              </TabsTrigger>
              <TabsTrigger value="balances" data-testid="tab-balance-summaries">
                {tr("balances")}
              </TabsTrigger>
              <TabsTrigger value="expenses" data-testid="tab-expense-reports">
                {tr("expenses")}
              </TabsTrigger>
              <TabsTrigger value="payroll" data-testid="tab-payroll-reports">
                {tr("payroll")}
              </TabsTrigger>
              <TabsTrigger value="trial" data-testid="tab-trial-balance">
                {t.trialBalance}
              </TabsTrigger>
              <TabsTrigger value="ledger" data-testid="tab-ledger-reports">
                {tr("ledger")}
              </TabsTrigger>
              <TabsTrigger value="close" data-testid="tab-month-end-close-status">
                {tr("close")}
              </TabsTrigger>
              <TabsTrigger value="planning" data-testid="tab-planning-reports">
                {tr("planning")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pl" className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("totalRevenue")}</CardTitle>
                    <div className="w-8 h-8 rounded-md bg-success-subtle flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 text-success " />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {plLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div
                        dir="ltr"
                        className="text-2xl font-bold font-mono"
                        data-testid="text-total-revenue"
                      >
                        {formatCurrency(profitLoss?.totalRevenue || 0, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("totalExpenses")}</CardTitle>
                    <div className="w-8 h-8 rounded-md bg-danger-subtle flex items-center justify-center">
                      <TrendingDown className="w-4 h-4 text-destructive " />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {plLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div
                        dir="ltr"
                        className="text-2xl font-bold font-mono"
                        data-testid="text-total-expenses"
                      >
                        {formatCurrency(profitLoss?.totalExpenses || 0, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("netProfit2")}</CardTitle>
                    <div className="w-8 h-8 rounded-md bg-info-subtle flex items-center justify-center">
                      <DollarSign className="w-4 h-4 text-info " />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {plLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div
                        dir="ltr"
                        className="text-2xl font-bold font-mono"
                        data-testid="text-net-profit"
                      >
                        {formatCurrency(profitLoss?.netProfit || 0, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>{tr("statement", { profitLoss: t.profitLoss })}</CardTitle>
                  <CardDescription>
                    {dateRange.from && dateRange.to
                      ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                      : tr("allTime")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {plLoading ? (
                    <Skeleton className="h-64" />
                  ) : (
                    <div className="space-y-6">
                      <div>
                        <h3 className="font-semibold mb-3 text-success ">{tr("revenue")}</h3>
                        <Table>
                          <TableBody>
                            {profitLoss?.revenue?.map((item, index) => (
                              <TableRow key={item.accountCode || `revenue-${index}`}>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {item.accountCode || "-"}
                                </TableCell>
                                <TableCell>{item.accountName || tr("unknownAccount")}</TableCell>
                                <TableCell className="text-end font-mono font-medium">
                                  {formatCurrency(item.amount ?? 0, "AED", locale)}
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="border-t-2">
                              <TableCell colSpan={2} className="font-semibold">
                                {tr("totalRevenue")}
                              </TableCell>
                              <TableCell className="text-end font-mono font-semibold">
                                {formatCurrency(profitLoss?.totalRevenue || 0, "AED", locale)}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>

                      <div>
                        <h3 className="font-semibold mb-3 text-destructive ">{tr("expenses")}</h3>
                        <Table>
                          <TableBody>
                            {profitLoss?.expenses?.map((item, index) => (
                              <TableRow key={item.accountCode || `expense-${index}`}>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {item.accountCode || "-"}
                                </TableCell>
                                <TableCell>{item.accountName || tr("unknownAccount")}</TableCell>
                                <TableCell className="text-end font-mono font-medium">
                                  {formatCurrency(item.amount ?? 0, "AED", locale)}
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="border-t-2">
                              <TableCell colSpan={2} className="font-semibold">
                                {tr("totalExpenses")}
                              </TableCell>
                              <TableCell className="text-end font-mono font-semibold">
                                {formatCurrency(profitLoss?.totalExpenses || 0, "AED", locale)}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>

                      <div className="border-t-4 pt-4">
                        <div className="flex justify-between items-center text-lg font-semibold">
                          <span>{tr("netProfit2")}</span>
                          <span
                            dir="ltr"
                            className={`font-mono ${(profitLoss?.netProfit ?? 0) >= 0 ? "text-success " : "text-destructive "}`}
                          >
                            {formatCurrency(profitLoss?.netProfit ?? 0, "AED", locale)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="bs">
              <Card>
                <CardHeader>
                  <CardTitle>{t.balanceSheet}</CardTitle>
                  <CardDescription>
                    {dateRange.from && dateRange.to
                      ? tr("asOf", { format: format(dateRange.to, "MMM dd, yyyy") })
                      : tr("assetsLiabilitiesAndEquityAsOf")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {bsLoading ? (
                    <Skeleton className="h-96" />
                  ) : (
                    <div className="space-y-6">
                      <div>
                        <h3 className="font-semibold mb-3 text-info ">{tr("assets")}</h3>
                        <Table>
                          <TableBody>
                            {balanceSheet?.assets?.map((item, index) => (
                              <TableRow key={item.accountCode || `asset-${index}`}>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {item.accountCode || "-"}
                                </TableCell>
                                <TableCell>{item.accountName || tr("unknownAccount")}</TableCell>
                                <TableCell className="text-end font-mono font-medium">
                                  {formatCurrency(item.amount ?? 0, "AED", locale)}
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="border-t-2">
                              <TableCell colSpan={2} className="font-semibold">
                                {tr("totalAssets")}
                              </TableCell>
                              <TableCell className="text-end font-mono font-semibold">
                                {formatCurrency(balanceSheet?.totalAssets || 0, "AED", locale)}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>

                      <div>
                        <h3 className="font-semibold mb-3 text-destructive ">
                          {tr("liabilities")}
                        </h3>
                        <Table>
                          <TableBody>
                            {balanceSheet?.liabilities?.map((item, index) => (
                              <TableRow key={item.accountCode || `liability-${index}`}>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {item.accountCode || "-"}
                                </TableCell>
                                <TableCell>{item.accountName || tr("unknownAccount")}</TableCell>
                                <TableCell className="text-end font-mono font-medium">
                                  {formatCurrency(item.amount ?? 0, "AED", locale)}
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="border-t-2">
                              <TableCell colSpan={2} className="font-semibold">
                                {tr("totalLiabilities")}
                              </TableCell>
                              <TableCell className="text-end font-mono font-semibold">
                                {formatCurrency(balanceSheet?.totalLiabilities || 0, "AED", locale)}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>

                      <div>
                        <h3 className="font-semibold mb-3 text-chart-5 ">{tr("equity")}</h3>
                        <Table>
                          <TableBody>
                            {balanceSheet?.equity?.map((item, index) => (
                              <TableRow key={item.accountCode || `equity-${index}`}>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                  {item.accountCode || "-"}
                                </TableCell>
                                <TableCell>{item.accountName || tr("unknownAccount")}</TableCell>
                                <TableCell className="text-end font-mono font-medium">
                                  {formatCurrency(item.amount ?? 0, "AED", locale)}
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="border-t-2">
                              <TableCell colSpan={2} className="font-semibold">
                                {tr("totalEquity")}
                              </TableCell>
                              <TableCell className="text-end font-mono font-semibold">
                                {formatCurrency(balanceSheet?.totalEquity || 0, "AED", locale)}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="vat">
              <Card>
                <CardHeader>
                  <CardTitle>{t.vatSummary}</CardTitle>
                  <CardDescription>
                    {dateRange.from && dateRange.to
                      ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                      : tr("uaeVat5SummaryForThe")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {vatLoading ? (
                    <Skeleton className="h-64" />
                  ) : (
                    <div className="space-y-6">
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <h3 className="font-semibold text-success ">{tr("salesOutputVat")}</h3>
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">{tr("subtotal")}</span>
                              <span dir="ltr" className="font-mono">
                                {formatCurrency(vatSummary?.salesSubtotal || 0, "AED", locale)}
                              </span>
                            </div>
                            <div className="flex justify-between font-medium">
                              <span>{tr("vatCollected5")}</span>
                              <span dir="ltr" className="font-mono">
                                {formatCurrency(vatSummary?.salesVAT || 0, "AED", locale)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h3 className="font-semibold text-info ">{tr("purchasesInputVat")}</h3>
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">{tr("subtotal")}</span>
                              <span dir="ltr" className="font-mono">
                                {formatCurrency(vatSummary?.purchasesSubtotal || 0, "AED", locale)}
                              </span>
                            </div>
                            <div className="flex justify-between font-medium">
                              <span>{tr("vatPaid5")}</span>
                              <span dir="ltr" className="font-mono">
                                {formatCurrency(vatSummary?.purchasesVAT || 0, "AED", locale)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="border-t-4 pt-6">
                        <div className="flex justify-between items-center text-lg font-semibold">
                          <span>{tr("netVatPayableToFta")}</span>
                          <span
                            dir="ltr"
                            className={`font-mono ${(vatSummary?.netVATPayable ?? 0) >= 0 ? "text-destructive " : "text-success "}`}
                          >
                            {formatCurrency(
                              Math.abs(vatSummary?.netVATPayable ?? 0),
                              "AED",
                              locale
                            )}
                            {(vatSummary?.netVATPayable ?? 0) < 0 && tr("refund")}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          {(vatSummary?.netVATPayable ?? 0) >= 0
                            ? tr("amountToBePaidToThe")
                            : tr("amountToBeRefundedByThe")}
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="tax" className="space-y-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("taxPayable2")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <Scale className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {corporateTaxLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div
                        dir="ltr"
                        className="font-mono text-2xl font-bold"
                        data-testid="text-corporate-tax-payable"
                      >
                        {formatCurrency(corporateTaxEstimate?.taxPayable ?? 0, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("taxableIncome2")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {corporateTaxLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {formatCurrency(corporateTaxEstimate?.taxableIncome ?? 0, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("aboveBand")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {corporateTaxLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <>
                        <div dir="ltr" className="font-mono text-2xl font-bold">
                          {formatCurrency(corporateTaxEstimate?.taxableAmount ?? 0, "AED", locale)}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {tr("returnedRate", {
                            value: ((corporateTaxEstimate?.taxRate ?? 0) * 100).toFixed(2),
                          })}
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("postedJournals")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {corporateTaxLoading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {corporateTaxEstimate?.journalEntriesProcessed ?? 0}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("corporateTaxEstimate2")}</CardTitle>
                      <CardDescription>
                        {corporateTaxEstimate
                          ? `${formatReportDate(corporateTaxEstimate.periodStart)} - ${formatReportDate(corporateTaxEstimate.periodEnd)}`
                          : corporateTaxPeriodLabel}
                      </CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/corporate-tax">{tr("openCorporateTax")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {corporateTaxLoading ? (
                    <Skeleton className="h-80" />
                  ) : (
                    <div className="space-y-6">
                      <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <Badge variant={corporateTaxStatus.variant} dot>
                            {corporateTaxStatus.label}
                          </Badge>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {corporateTaxStatus.detail}
                          </p>
                        </div>
                        <p className="max-w-md text-sm text-muted-foreground">
                          {tr("estimateOnlyOpenCorporateTaxTo")}
                        </p>
                      </div>

                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{tr("bridge")}</TableHead>
                            <TableHead className="text-end">{tr("amount")}</TableHead>
                            <TableHead>{tr("note")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {corporateTaxBridgeRows.map((row) => (
                            <TableRow key={row.metric}>
                              <TableCell className="font-medium">{row.metric}</TableCell>
                              <TableCell className="text-end font-mono">
                                {formatCurrency(row.amount, "AED", locale)}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {row.note}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="sales" className="space-y-6">
              <div
                className={reportSectionClass(
                  ["ar-aging", "invoice-status", "revenue-customer", "sales-product-service"],
                  "grid grid-cols-1 gap-6 md:grid-cols-4"
                )}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("invoiceValue2")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {salesLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {formatCurrency(invoiceStatusReport.invoiceValueAed, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("activeInvoices")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {salesLoading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {invoiceStatusReport.activeInvoiceCount}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("unpaidInvoices")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <AlertTriangle className="h-4 w-4 text-warning " />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {salesLoading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {invoiceStatusReport.unpaidCount}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">
                      {tr("overdueOutstanding")}
                    </CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <TrendingDown className="h-4 w-4 text-destructive " />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {salesLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : invoiceStatusReport.overdueCurrency ? (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {formatCurrency(
                          invoiceStatusReport.overdueOutstanding,
                          invoiceStatusReport.overdueCurrency,
                          locale
                        )}
                      </div>
                    ) : (
                      <div className="text-sm font-medium">{tr("mixedCurrencies")}</div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className={reportSectionClass(["ar-aging"])}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("aRAging")}</CardTitle>
                      <CardDescription>{tr("openCustomerInvoicesAgedFromDue")}</CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/payment-chasing">{tr("openCollections")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {agingReportLoading ? (
                    <Skeleton className="h-80" />
                  ) : receivableAgingRows.length ? (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("current")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {formatCurrency(receivableAgingSummary.current, "AED", locale)}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("overdue")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {formatCurrency(receivableAgingSummary.overdue, "AED", locale)}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("over90Days")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {formatCurrency(receivableAgingSummary.over90, "AED", locale)}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">
                            {tr("totalReceivable")}
                          </div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {formatCurrency(receivableAgingSummary.total, "AED", locale)}
                          </div>
                        </div>
                      </div>

                      <div className="max-h-[520px] overflow-auto rounded-md border">
                        <Table className="min-w-[920px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>{tr("customer")}</TableHead>
                              <TableHead className="text-end">{tr("current")}</TableHead>
                              <TableHead className="text-end">1-30</TableHead>
                              <TableHead className="text-end">31-60</TableHead>
                              <TableHead className="text-end">61-90</TableHead>
                              <TableHead className="text-end">90+</TableHead>
                              <TableHead className="text-end">{tr("total")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {receivableAgingRows.map((row) => (
                              <TableRow key={row.id}>
                                <TableCell className="font-medium">{row.name}</TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(row.current, "AED", locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(row.days30, "AED", locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(row.days60, "AED", locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(row.days90, "AED", locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(row.over90, "AED", locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono font-medium">
                                  {formatCurrency(row.total, "AED", locale)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noOpenReceivablesFoundForAging")}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className={reportSectionClass(["sales-product-service"])}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("salesByProductService")}</CardTitle>
                      <CardDescription>{tr("lineItemSalesMixAedValue")}</CardDescription>
                    </div>
                    <Badge
                      variant={productServiceTopShare >= 50 ? "warning" : "success"}
                      dot={productServiceSalesRows.length > 0}
                    >
                      {productServiceSalesRows.length
                        ? tr("topShare", {
                            productServiceTopShare: productServiceTopShare.toFixed(1),
                          })
                        : tr("noLineItems")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {salesProductServiceLoading ? (
                    <Skeleton className="h-64" />
                  ) : productServiceSalesRows.length ? (
                    <div className="max-h-[460px] overflow-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{tr("productService")}</TableHead>
                            <TableHead className="text-end">{tr("invoices")}</TableHead>
                            <TableHead className="text-end">{tr("quantity")}</TableHead>
                            <TableHead className="text-end">{tr("sales")}</TableHead>
                            <TableHead className="text-end">{tr("vat")}</TableHead>
                            <TableHead className="text-end">{tr("avgUnit")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {productServiceSalesRows.map((row) => (
                            <TableRow key={row.productService}>
                              <TableCell>
                                <div className="font-medium">{row.productService}</div>
                                <div className="text-xs text-muted-foreground">
                                  {tr("lines", {
                                    lineCount: row.lineCount,
                                    supplyTypes: row.supplyTypes.join(", "),
                                  })}
                                </div>
                              </TableCell>
                              <TableCell className="text-end font-mono">
                                {row.invoiceCount}
                              </TableCell>
                              <TableCell className="text-end font-mono">
                                {row.quantity.toLocaleString(locale, { maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="text-end font-mono font-medium">
                                {formatCurrency(row.amountAed, "AED", locale)}
                              </TableCell>
                              <TableCell className="text-end font-mono">
                                {formatCurrency(row.vatAed, "AED", locale)}
                              </TableCell>
                              <TableCell className="text-end font-mono">
                                {formatCurrency(row.averageUnitPriceAed, "AED", locale)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noInvoiceLineItemSalesFound")}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <Card className={reportSectionClass(["invoice-status"])}>
                  <CardHeader>
                    <CardTitle>{tr("invoiceStatus")}</CardTitle>
                    <CardDescription>{tr("statusMixAndAedEquivalentInvoice")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {salesLoading ? (
                      <Skeleton className="h-64" />
                    ) : statusSummary.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{tr("status")}</TableHead>
                            <TableHead className="text-end">{tr("invoices")}</TableHead>
                            <TableHead className="text-end">{tr("value")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {statusSummary.map((row) => (
                            <TableRow key={row.status}>
                              <TableCell>
                                <Badge variant={invoiceStatusVariant(row.status)} dot>
                                  {invoiceStatusLabel(row.status)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-end font-mono">{row.count}</TableCell>
                              <TableCell className="text-end font-mono font-medium">
                                {formatCurrency(row.amountAed, "AED", locale)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                        {tr("noInvoicesFoundForThisPeriod")}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className={reportSectionClass(["revenue-customer"])}>
                  <CardHeader>
                    <CardTitle>{tr("revenueByCustomer")}</CardTitle>
                    <CardDescription>{tr("issuedInvoiceValueByCustomerShown")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {salesLoading ? (
                      <Skeleton className="h-64" />
                    ) : customerRevenue.length ? (
                      <div className="max-h-[420px] overflow-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{tr("customer")}</TableHead>
                              <TableHead className="text-end">{tr("invoices")}</TableHead>
                              <TableHead className="text-end">{tr("value")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {customerRevenue.map((row) => (
                              <TableRow key={row.customerName}>
                                <TableCell className="font-medium">{row.customerName}</TableCell>
                                <TableCell className="text-end font-mono">
                                  {row.invoiceCount}
                                </TableCell>
                                <TableCell className="text-end font-mono font-medium">
                                  {formatCurrency(row.amountAed, "AED", locale)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                        {tr("noIssuedCustomerRevenueFoundFor")}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className={reportSectionClass(["invoice-status"])}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("reminderRouting")}</CardTitle>
                      <CardDescription>
                        {tr("overdueCustomerBalancesGroupedByRecommended")}
                      </CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/payment-chasing">{tr("openChasingQueue")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {salesLoading ? (
                    <Skeleton className="h-64" />
                  ) : overdueCustomerRows.length ? (
                    <div className="max-h-[420px] overflow-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{tr("customer")}</TableHead>
                            <TableHead className="text-end">{tr("invoices")}</TableHead>
                            <TableHead className="text-end">{tr("outstanding")}</TableHead>
                            <TableHead className="text-end">{tr("oldest")}</TableHead>
                            <TableHead className="text-end">{tr("nextLevel")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {overdueCustomerRows.map((row) => (
                            <TableRow key={`${row.customerName}-${row.currency}`}>
                              <TableCell className="font-medium">{row.customerName}</TableCell>
                              <TableCell className="text-end font-mono">
                                {row.invoiceCount}
                              </TableCell>
                              <TableCell className="text-end font-mono font-medium">
                                {formatCurrency(row.outstanding, row.currency, locale)}
                              </TableCell>
                              <TableCell className="text-end font-mono">
                                {tr("days", { maxDaysOverdue: row.maxDaysOverdue })}
                              </TableCell>
                              <TableCell className="text-end">
                                <Badge variant="warning">
                                  {tr("level", { recommendedLevel: row.recommendedLevel })}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noOverdueInvoicesInTheReminder")}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className={reportSectionClass(["invoice-status"])}>
                <CardHeader>
                  <CardTitle>{tr("invoiceDetail")}</CardTitle>
                  <CardDescription>
                    {dateRange.from && dateRange.to
                      ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                      : tr("allInvoiceDates")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {salesLoading ? (
                    <Skeleton className="h-96" />
                  ) : reportInvoices.length ? (
                    <div className="max-h-[520px] overflow-auto rounded-md border">
                      <Table className="min-w-[900px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>{tr("invoice")}</TableHead>
                            <TableHead>{tr("customer")}</TableHead>
                            <TableHead>{tr("issueDate")}</TableHead>
                            <TableHead>{tr("dueDate2")}</TableHead>
                            <TableHead>{tr("status")}</TableHead>
                            <TableHead className="text-end">{tr("amount")}</TableHead>
                            <TableHead className="text-end">{tr("aedValue")}</TableHead>
                            <TableHead className="text-end">{tr("proof")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reportInvoices.map((invoice) => (
                            <TableRow key={invoice.id}>
                              <TableCell className="font-mono font-medium">
                                {invoice.number}
                              </TableCell>
                              <TableCell>{invoice.customerName || tr("unknownCustomer")}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {formatReportDate(invoice.date)}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {formatReportDate(invoice.dueDate)}
                              </TableCell>
                              <TableCell>
                                <Badge variant={invoiceStatusVariant(invoice.status)} dot>
                                  {invoiceStatusLabel(invoice.status)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-end font-mono">
                                {formatCurrency(
                                  invoice.total ?? 0,
                                  invoice.currency || "AED",
                                  locale
                                )}
                              </TableCell>
                              <TableCell className="text-end font-mono font-medium">
                                {formatCurrency(amountInAed(invoice), "AED", locale)}
                              </TableCell>
                              <TableCell className="text-end">
                                <Button asChild size="sm" variant="outline">
                                  <Link href={evidenceSourceHref("invoice", invoice.id)}>
                                    {tr("proof")}
                                  </Link>
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noInvoicesFoundForThisPeriod")}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="balances" className="space-y-6">
              <div
                className={reportSectionClass(
                  [
                    "customer-balances",
                    "ap-aging",
                    "vendor-balances",
                    "inventory-valuation",
                    "inventory-movement",
                    "depreciation-schedule",
                    "fixed-asset-register",
                  ],
                  "grid grid-cols-1 gap-6 md:grid-cols-4"
                )}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">
                      {tr("customerOpenBalance")}
                    </CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <TrendingUp className="h-4 w-4 text-success " />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {balancesLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {formatCurrency(balanceReport.customerOpenAed, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("customerOverdue")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <AlertTriangle className="h-4 w-4 text-warning " />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {balancesLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div className="space-y-1">
                        <div dir="ltr" className="font-mono text-2xl font-bold">
                          {formatCurrency(balanceReport.customerOverdueAed, "AED", locale)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {tr("customers", {
                            overdueCustomerCount: balanceReport.overdueCustomerCount,
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("vendorOpenBalance")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <TrendingDown className="h-4 w-4 text-destructive " />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {balancesLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {formatCurrency(balanceReport.vendorOpenAed, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("netArLessAp")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <Scale className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {balancesLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {formatCurrency(balanceReport.netBalanceAed, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className={reportSectionClass(["ap-aging"])}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("aPAging")}</CardTitle>
                      <CardDescription>{tr("openVendorBillsAgedFromDue")}</CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/bill-pay?tab=summary">{tr("openBillPay")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {billAgingLoading || balancesLoading ? (
                    <Skeleton className="h-80" />
                  ) : payableAgingSummary.total > 0 || balanceReport.vendors.length ? (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("current")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {formatCurrency(payableAgingSummary.current, "AED", locale)}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("overdue")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {formatCurrency(payableAgingSummary.overdue, "AED", locale)}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("over90Days")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {formatCurrency(payableAgingSummary.over90, "AED", locale)}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("openBills")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {payableAgingSummary.billCount.toLocaleString(locale)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.8fr_1.2fr]">
                        <div className="rounded-md border p-4">
                          <div className="mb-3">
                            <div className="font-medium">{tr("agingBuckets")}</div>
                            <div className="text-xs text-muted-foreground">
                              {tr("billCountAndOpenAedBalance")}
                            </div>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>{tr("bucket")}</TableHead>
                                <TableHead className="text-end">{tr("bills")}</TableHead>
                                <TableHead className="text-end">{tr("amount")}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {payableAgingBuckets.map((bucket) => (
                                <TableRow key={bucket.label}>
                                  <TableCell className="font-medium">{bucket.label}</TableCell>
                                  <TableCell className="text-end font-mono">
                                    {bucket.count.toLocaleString(locale)}
                                  </TableCell>
                                  <TableCell className="text-end font-mono font-medium">
                                    {formatCurrency(bucket.amount, "AED", locale)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        <div className="max-h-[520px] overflow-auto rounded-md border">
                          <Table className="min-w-[760px]">
                            <TableHeader>
                              <TableRow>
                                <TableHead>{tr("vendor")}</TableHead>
                                <TableHead className="text-end">{tr("bills")}</TableHead>
                                <TableHead className="text-end">{tr("open")}</TableHead>
                                <TableHead className="text-end">{tr("overdue")}</TableHead>
                                <TableHead className="text-end">{tr("oldest")}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {balanceReport.vendors.map((row) => (
                                <TableRow key={`${row.name}-${row.currency}`}>
                                  <TableCell>
                                    <div className="font-medium">{row.name}</div>
                                    <Badge
                                      className="mt-1"
                                      variant={row.overdueBalanceAed > 0 ? "warning" : "success"}
                                      dot
                                    >
                                      {row.overdueBalanceAed > 0 ? tr("payQueue") : tr("current")}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-end font-mono">
                                    {row.billCount}
                                  </TableCell>
                                  <TableCell className="text-end">
                                    <div dir="ltr" className="font-mono font-medium">
                                      {formatCurrency(row.openBalance, row.currency, locale)}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {formatCurrency(row.openBalanceAed, "AED", locale)}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-end">
                                    <div dir="ltr" className="font-mono font-medium">
                                      {formatCurrency(row.overdueBalance, row.currency, locale)}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {formatCurrency(row.overdueBalanceAed, "AED", locale)}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-end font-mono">
                                    {tr("days", { maxDaysOverdue: row.maxDaysOverdue })}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noOpenPayablesFoundForAging")}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <Card className={reportSectionClass(["customer-balances"])}>
                  <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <CardTitle>{tr("customerBalanceSummary")}</CardTitle>
                        <CardDescription>
                          {tr("currentOpenReceivablesFromIssuedInvoices")}
                        </CardDescription>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link href="/payment-chasing">{tr("openCollections")}</Link>
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {balancesLoading ? (
                      <Skeleton className="h-72" />
                    ) : balanceReport.customers.length ? (
                      <div className="max-h-[460px] overflow-auto rounded-md border">
                        <Table className="min-w-[760px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>{tr("customer")}</TableHead>
                              <TableHead className="text-end">{tr("invoices")}</TableHead>
                              <TableHead className="text-end">{tr("open")}</TableHead>
                              <TableHead className="text-end">{tr("overdue")}</TableHead>
                              <TableHead className="text-end">{tr("oldest")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {balanceReport.customers.map((row) => (
                              <TableRow key={`${row.name}-${row.currency}`}>
                                <TableCell>
                                  <div className="font-medium">{row.name}</div>
                                  <Badge
                                    className="mt-1"
                                    variant={row.overdueBalanceAed > 0 ? "warning" : "success"}
                                    dot
                                  >
                                    {row.overdueBalanceAed > 0 ? tr("collections") : tr("current")}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {row.invoiceCount}
                                </TableCell>
                                <TableCell className="text-end">
                                  <div dir="ltr" className="font-mono font-medium">
                                    {formatCurrency(row.openBalance, row.currency, locale)}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatCurrency(row.openBalanceAed, "AED", locale)}
                                  </div>
                                </TableCell>
                                <TableCell className="text-end">
                                  <div dir="ltr" className="font-mono font-medium">
                                    {formatCurrency(row.overdueBalance, row.currency, locale)}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatCurrency(row.overdueBalanceAed, "AED", locale)}
                                  </div>
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {tr("days", { maxDaysOverdue: row.maxDaysOverdue })}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                        {tr("noOpenCustomerBalances")}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className={reportSectionClass(["vendor-balances"])}>
                  <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <CardTitle>{tr("vendorBalanceSummary")}</CardTitle>
                        <CardDescription>
                          {tr("currentOpenPayablesFromVendorBills")}
                        </CardDescription>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link href="/bill-pay?tab=summary">{tr("openBillPay")}</Link>
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {balancesLoading ? (
                      <Skeleton className="h-72" />
                    ) : balanceReport.vendors.length ? (
                      <div className="max-h-[460px] overflow-auto rounded-md border">
                        <Table className="min-w-[760px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>{tr("vendor")}</TableHead>
                              <TableHead className="text-end">{tr("bills")}</TableHead>
                              <TableHead className="text-end">{tr("open")}</TableHead>
                              <TableHead className="text-end">{tr("overdue")}</TableHead>
                              <TableHead className="text-end">{tr("oldest")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {balanceReport.vendors.map((row) => (
                              <TableRow key={`${row.name}-${row.currency}`}>
                                <TableCell>
                                  <div className="font-medium">{row.name}</div>
                                  <Badge
                                    className="mt-1"
                                    variant={row.overdueBalanceAed > 0 ? "warning" : "success"}
                                    dot
                                  >
                                    {row.overdueBalanceAed > 0 ? tr("payQueue") : tr("current")}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {row.billCount}
                                </TableCell>
                                <TableCell className="text-end">
                                  <div dir="ltr" className="font-mono font-medium">
                                    {formatCurrency(row.openBalance, row.currency, locale)}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatCurrency(row.openBalanceAed, "AED", locale)}
                                  </div>
                                </TableCell>
                                <TableCell className="text-end">
                                  <div dir="ltr" className="font-mono font-medium">
                                    {formatCurrency(row.overdueBalance, row.currency, locale)}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatCurrency(row.overdueBalanceAed, "AED", locale)}
                                  </div>
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {tr("days", { maxDaysOverdue: row.maxDaysOverdue })}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                        {tr("noOpenVendorBalances")}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className={reportSectionClass(["inventory-valuation"])}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("inventoryValuation")}</CardTitle>
                      <CardDescription>{tr("stockQuantityCostValueReorderRisk")}</CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/inventory">{tr("openInventory")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {balancesLoading ? (
                    <Skeleton className="h-80" />
                  ) : inventoryValuationReport.rows.length ? (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">
                            {tr("activeProducts")}
                          </div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {inventoryValuationReport.activeProductCount}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("stockValue")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {formatCurrency(
                              inventoryValuationReport.totalStockValueAed,
                              "AED",
                              locale
                            )}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("lowStock")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {inventoryValuationReport.lowStockCount}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("costingReview")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {inventoryValuationReport.missingCostCount}
                          </div>
                        </div>
                      </div>

                      <div className="max-h-[520px] overflow-auto rounded-md border">
                        <Table className="min-w-[940px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>{tr("product")}</TableHead>
                              <TableHead>{tr("unit")}</TableHead>
                              <TableHead>{tr("status")}</TableHead>
                              <TableHead className="text-end">{tr("stock")}</TableHead>
                              <TableHead className="text-end">{tr("unitCost")}</TableHead>
                              <TableHead className="text-end">{tr("value")}</TableHead>
                              <TableHead className="text-end">{tr("movements")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {inventoryValuationReport.rows.map((product) => (
                              <TableRow key={product.id}>
                                <TableCell>
                                  <div className="font-medium">{product.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {product.sku || tr("noSku")}
                                  </div>
                                </TableCell>
                                <TableCell>{product.unit}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      product.isNegativeStock || product.isMissingCost
                                        ? "warning"
                                        : product.isLowStock
                                          ? "info"
                                          : product.isActive
                                            ? "success"
                                            : "neutral"
                                    }
                                    dot
                                  >
                                    {product.isNegativeStock
                                      ? tr("negativeStock")
                                      : product.isMissingCost
                                        ? tr("missingCost")
                                        : product.isLowStock
                                          ? tr("lowStock")
                                          : product.isActive
                                            ? tr("valued")
                                            : tr("inactive")}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {product.currentStock.toLocaleString(locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(product.unitCost, "AED", locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono font-medium">
                                  {formatCurrency(product.stockValueAed, "AED", locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {product.movementCount}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noInventoryProductsFoundYet")}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className={reportSectionClass(["inventory-movement"])}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("inventoryMovement")}</CardTitle>
                      <CardDescription>
                        {tr("stockReceiptsSalesReturnsAndAdjustments")}
                      </CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/inventory">{tr("openMovements")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {balancesLoading ? (
                    <Skeleton className="h-80" />
                  ) : inventoryMovementReport.movementCount ? (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("movements")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {inventoryMovementReport.movementCount}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("inboundUnits")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {inventoryMovementReport.inboundUnits.toLocaleString(locale)}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("outboundUnits")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {inventoryMovementReport.outboundUnits.toLocaleString(locale)}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("movementValue")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {formatCurrency(
                              inventoryMovementReport.totalMovementValueAed,
                              "AED",
                              locale
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.75fr_1.25fr]">
                        <div className="rounded-md border p-4">
                          <div className="mb-3">
                            <div className="font-medium">{tr("movementTypeMix")}</div>
                            <div className="text-xs text-muted-foreground">
                              {tr("quantityAndValueByMovementType")}
                            </div>
                          </div>
                          <div className="space-y-3">
                            {inventoryMovementReport.typeRows.map((row) => (
                              <div
                                key={row.type}
                                className="flex items-center justify-between gap-4 text-sm"
                              >
                                <div>
                                  <Badge variant={inventoryMovementVariant(row.type)} dot>
                                    {row.type}
                                  </Badge>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {tr("movementsUnits", {
                                      count: row.count,
                                      quantity: row.quantity.toLocaleString(locale),
                                    })}
                                  </div>
                                </div>
                                <div className="text-end font-mono">
                                  {formatCurrency(row.valueAed, "AED", locale)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="max-h-[520px] overflow-auto rounded-md border">
                          <Table className="min-w-[920px]">
                            <TableHeader>
                              <TableRow>
                                <TableHead>{tr("date")}</TableHead>
                                <TableHead>{tr("product")}</TableHead>
                                <TableHead>{tr("type")}</TableHead>
                                <TableHead className="text-end">{tr("quantity")}</TableHead>
                                <TableHead className="text-end">{tr("unitCost")}</TableHead>
                                <TableHead className="text-end">{tr("value")}</TableHead>
                                <TableHead>{tr("reference")}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {inventoryMovementReport.rows.map((movement) => (
                                <TableRow key={movement.id}>
                                  <TableCell className="whitespace-nowrap text-muted-foreground">
                                    {formatReportDate(movement.createdAt)}
                                  </TableCell>
                                  <TableCell>
                                    <div className="font-medium">{movement.productName}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {movement.sku || movement.unit || tr("noSku")}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={inventoryMovementVariant(movement.type)} dot>
                                      {movement.type}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-end font-mono">
                                    {movement.type === "sale" ? "-" : "+"}
                                    {Math.abs(movement.quantity).toLocaleString(locale)}
                                  </TableCell>
                                  <TableCell className="text-end font-mono">
                                    {movement.unitCost
                                      ? formatCurrency(movement.unitCost, "AED", locale)
                                      : "-"}
                                  </TableCell>
                                  <TableCell className="text-end font-mono font-medium">
                                    {formatCurrency(movement.valueAed, "AED", locale)}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground">
                                    {movement.reference || "-"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noInventoryMovementsFoundForThis")}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className={reportSectionClass(["depreciation-schedule"])}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("depreciationSchedule")}</CardTitle>
                      <CardDescription>
                        {tr("estimatedDepreciationForFromTheFixed", {
                          format: format(depreciationPeriodDate, "MMMM yyyy"),
                        })}
                      </CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/fixed-assets">{tr("openFixedAssets")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {balancesLoading ? (
                    <Skeleton className="h-80" />
                  ) : depreciationScheduleReport.rows.length ? (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">
                            {tr("periodDepreciation")}
                          </div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {formatCurrency(
                              depreciationScheduleReport.periodDepreciationAed,
                              "AED",
                              locale
                            )}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("annualRunRate")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {formatCurrency(
                              depreciationScheduleReport.annualDepreciationAed,
                              "AED",
                              locale
                            )}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("readyToPost")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {depreciationScheduleReport.readyToPostCount}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("setupReview")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {depreciationScheduleReport.reviewCount}
                          </div>
                        </div>
                      </div>

                      <div className="max-h-[520px] overflow-auto rounded-md border">
                        <Table className="min-w-[980px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>{tr("asset")}</TableHead>
                              <TableHead>{tr("method")}</TableHead>
                              <TableHead className="text-end">{tr("remaining")}</TableHead>
                              <TableHead className="text-end">
                                {tr("monthlyDepreciation")}
                              </TableHead>
                              <TableHead className="text-end">{tr("projectedNbv")}</TableHead>
                              <TableHead>{tr("status")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {depreciationScheduleReport.rows.map((row) => (
                              <TableRow key={row.assetId}>
                                <TableCell>
                                  <div className="font-medium">{row.assetName}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {row.assetNumber || row.category}
                                  </div>
                                </TableCell>
                                <TableCell className="capitalize">
                                  {row.method.replace(/_/g, " ")}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(row.remainingDepreciable, "AED", locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono font-medium">
                                  {formatCurrency(row.monthlyDepreciation, "AED", locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(row.projectedNetBookValue, "AED", locale)}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={depreciationStatusVariant(row.status)} dot>
                                    {row.statusLabel}
                                  </Badge>
                                  {row.status !== "ready" && (
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {row.reviewReason}
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noActiveFixedAssetsAvailableFor")}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className={reportSectionClass(["fixed-asset-register"])}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("fixedAssetRegister")}</CardTitle>
                      <CardDescription>
                        {tr("assetCostAccumulatedDepreciationNetBook")}
                      </CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/fixed-assets">{tr("openFixedAssets")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {balancesLoading ? (
                    <Skeleton className="h-96" />
                  ) : fixedAssetRegisterReport.rows.length ? (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("activeAssets")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {fixedAssetRegisterReport.totalAssets}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("assetCost")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {formatCurrency(fixedAssetRegisterReport.totalCost, "AED", locale)}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("netBookValue")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {formatCurrency(
                              fixedAssetRegisterReport.totalNetBookValue,
                              "AED",
                              locale
                            )}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("reviewItems")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {fixedAssetRegisterReport.reviewCount}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.8fr]">
                        <div className="max-h-[520px] overflow-auto rounded-md border">
                          <Table className="min-w-[960px]">
                            <TableHeader>
                              <TableRow>
                                <TableHead>{tr("asset")}</TableHead>
                                <TableHead>{tr("category")}</TableHead>
                                <TableHead>{tr("purchaseDate")}</TableHead>
                                <TableHead>{tr("status")}</TableHead>
                                <TableHead className="text-end">{tr("cost")}</TableHead>
                                <TableHead className="text-end">{tr("depreciation")}</TableHead>
                                <TableHead className="text-end">NBV</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {fixedAssetRegisterReport.rows.map((asset) => (
                                <TableRow key={asset.id}>
                                  <TableCell>
                                    <div className="font-medium">{asset.asset_name}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {asset.asset_number ||
                                        asset.serial_number ||
                                        tr("noAssetNumber")}
                                    </div>
                                  </TableCell>
                                  <TableCell>{asset.category}</TableCell>
                                  <TableCell className="text-muted-foreground">
                                    {formatReportDate(asset.purchase_date)}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={fixedAssetStatusVariant(asset.status)} dot>
                                      {asset.needs_capitalization_je
                                        ? tr("capitalizationReview")
                                        : asset.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-end font-mono">
                                    {formatCurrency(asset.purchaseCost, "AED", locale)}
                                  </TableCell>
                                  <TableCell className="text-end font-mono">
                                    {formatCurrency(asset.accumulatedDepreciation, "AED", locale)}
                                  </TableCell>
                                  <TableCell className="text-end font-mono font-medium">
                                    {formatCurrency(asset.netBookValue, "AED", locale)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        <div className="rounded-md border p-4">
                          <div className="mb-3">
                            <div className="font-medium">{tr("categoryValuation")}</div>
                            <div className="text-xs text-muted-foreground">
                              {tr("activeAssetsGroupedByCategory")}
                            </div>
                          </div>
                          <div className="max-h-[420px] space-y-3 overflow-auto pe-1">
                            {fixedAssetRegisterReport.byCategory.length ? (
                              fixedAssetRegisterReport.byCategory.map((category) => (
                                <div
                                  key={category.category}
                                  className="flex items-center justify-between gap-4 text-sm"
                                >
                                  <div>
                                    <div className="font-medium">{category.category}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {tr("assets2", { count: category.count })}
                                    </div>
                                  </div>
                                  <div className="text-end font-mono">
                                    {formatCurrency(category.totalNetBookValue, "AED", locale)}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-sm text-muted-foreground">
                                {tr("noActiveAssetCategories")}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noFixedAssetsRegisteredYet")}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className={cn(hasFocusedReportSelection && "hidden")}>
                <CardHeader>
                  <CardTitle>{tr("balanceAutomationQueues")}</CardTitle>
                  <CardDescription>{tr("currentOpenBalanceSignalsForCollections")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("collectionsQueue")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {balanceReport.overdueCustomerCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("billPayQueue")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {balanceReport.overdueVendorCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("inventoryReview")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {inventoryValuationReport.reviewCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("assetReview")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {fixedAssetRegisterReport.reviewCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("lastRefreshed")}</div>
                      <div className="text-sm font-medium">
                        {formatReportDate(balanceReport.generatedAt)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="expenses" className="space-y-6">
              <div
                className={reportSectionClass(
                  ["expenses-vendor", "expenses-category"],
                  "rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground"
                )}
              >
                <span className="font-medium text-foreground">{tr("sourceBasis")}</span>{" "}
                {expenseReport.basis}
              </div>
              <div
                className={reportSectionClass(
                  ["expenses-vendor", "expenses-category", "expense-claims"],
                  "grid grid-cols-1 gap-6 md:grid-cols-4"
                )}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("postedExpenses")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <TrendingDown className="h-4 w-4 text-destructive " />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {expensesLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {formatCurrency(expenseReport.totalAed, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">
                      {tr("grossExpenseDebits")}
                    </CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {expensesLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {formatCurrency(expenseReport.subtotalAed, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">
                      {tr("receiptVatCaptured")}
                    </CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {expensesLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {formatCurrency(expenseReport.vatAed, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("postingQueue2")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <AlertTriangle className="h-4 w-4 text-warning " />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {expensesLoading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : (
                      <div className="space-y-1">
                        <div dir="ltr" className="font-mono text-2xl font-bold">
                          {expenseReport.unpostedReceipts}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {tr("autoPosted", {
                            autoPostedReceipts: expenseReport.autoPostedReceipts,
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <Card className={reportSectionClass(["expenses-vendor"])}>
                  <CardHeader>
                    <CardTitle>{tr("expensesByVendor")}</CardTitle>
                    <CardDescription>{tr("postedExpenseAccountActivityGroupedBy")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {expensesLoading ? (
                      <Skeleton className="h-64" />
                    ) : expenseReport.byVendor.length ? (
                      <div className="max-h-[420px] overflow-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{tr("vendor")}</TableHead>
                              <TableHead className="text-end">{tr("entries")}</TableHead>
                              <TableHead className="text-end">{tr("lines2")}</TableHead>
                              <TableHead className="text-end">{tr("netExpense")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {expenseReport.byVendor.map((row) => (
                              <TableRow key={row.label}>
                                <TableCell className="font-medium">{row.label}</TableCell>
                                <TableCell className="text-end font-mono">
                                  {row.entryCount}
                                </TableCell>
                                <TableCell className="text-end font-mono font-medium">
                                  {row.lineCount}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(row.netExpenseAed, "AED", locale)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                        {tr("noExpensesFoundForThisPeriod")}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className={reportSectionClass(["expenses-category"])}>
                  <CardHeader>
                    <CardTitle>{tr("expensesByCategory")}</CardTitle>
                    <CardDescription>
                      {tr("postedExpenseAccountActivityGroupedBy2")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {expensesLoading ? (
                      <Skeleton className="h-64" />
                    ) : expenseReport.byCategory.length ? (
                      <div className="max-h-[420px] overflow-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{tr("category")}</TableHead>
                              <TableHead className="text-end">{tr("lines2")}</TableHead>
                              <TableHead className="text-end">{tr("debit")}</TableHead>
                              <TableHead className="text-end">{tr("credit")}</TableHead>
                              <TableHead className="text-end">{tr("netExpense")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {expenseReport.byCategory.map((row) => (
                              <TableRow key={row.label}>
                                <TableCell className="font-medium">{row.label}</TableCell>
                                <TableCell className="text-end font-mono">
                                  {row.lineCount}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(row.debitAed, "AED", locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(row.creditAed, "AED", locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono font-medium">
                                  {formatCurrency(row.netExpenseAed, "AED", locale)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                        {tr("noCategorizedExpensesFoundForThis")}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className={reportSectionClass(["expense-claims"])}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("expenseClaims")}</CardTitle>
                      <CardDescription>
                        {tr("claimStatusApprovalRoutingAndReimbursement")}
                      </CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/expense-claims">{tr("openClaims")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {expensesLoading ? (
                    <Skeleton className="h-80" />
                  ) : expenseClaimReport.claimCount ? (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("claims")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {expenseClaimReport.claimCount}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("claimValue")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {formatCurrency(expenseClaimReport.totalAmount, "AED", locale)}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">{tr("needsApproval")}</div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {expenseClaimReport.submittedCount}
                          </div>
                        </div>
                        <div className="rounded-md border p-4">
                          <div className="text-xs text-muted-foreground">
                            {tr("approvedUnpaid")}
                          </div>
                          <div dir="ltr" className="font-mono text-2xl font-semibold">
                            {expenseClaimReport.approvedUnpaidCount}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.8fr_1.2fr]">
                        <div className="rounded-md border p-4">
                          <div className="mb-3">
                            <div className="font-medium">{tr("claimStatusMix")}</div>
                            <div className="text-xs text-muted-foreground">
                              {tr("currentDateRangeClaimsByWorkflow")}
                            </div>
                          </div>
                          <div className="space-y-3">
                            {expenseClaimReport.statusRows.map((row) => (
                              <div
                                key={row.status}
                                className="flex items-center justify-between gap-4 text-sm"
                              >
                                <div>
                                  <Badge variant={expenseClaimStatusVariant(row.status)} dot>
                                    {row.status}
                                  </Badge>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {tr("claims2", { count: row.count })}
                                  </div>
                                </div>
                                <div className="text-end font-mono">
                                  {formatCurrency(row.totalAmount, "AED", locale)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="max-h-[420px] overflow-auto rounded-md border">
                          <Table className="min-w-[880px]">
                            <TableHeader>
                              <TableRow>
                                <TableHead>{tr("claim")}</TableHead>
                                <TableHead>{tr("status")}</TableHead>
                                <TableHead>{tr("created")}</TableHead>
                                <TableHead>{tr("submitted")}</TableHead>
                                <TableHead className="text-end">{tr("amount")}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {expenseClaimReport.claims.map((claim) => (
                                <TableRow key={claim.id}>
                                  <TableCell>
                                    <div className="font-medium">{claim.title}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {claim.claim_number}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={expenseClaimStatusVariant(claim.status)} dot>
                                      {claim.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-muted-foreground">
                                    {formatReportDate(claim.created_at)}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground">
                                    {formatReportDate(claim.submitted_at)}
                                  </TableCell>
                                  <TableCell className="text-end font-mono font-medium">
                                    {formatCurrency(
                                      expenseClaimAmount(claim),
                                      claim.currency || "AED",
                                      locale
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noExpenseClaimsFoundForThis")}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className={cn(hasFocusedReportSelection && "hidden")}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("postingAutomation")}</CardTitle>
                      <CardDescription>{tr("receiptsReadyForReviewPostingAnd")}</CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/receipts">{tr("openReceipts")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("capturedReceipts")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {expenseReport.receiptCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("autoPosted2")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {expenseReport.autoPostedReceipts}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("needsPosting")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {expenseReport.unpostedReceipts}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("claimsReview")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {expenseClaimReport.reviewCount}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className={reportSectionClass(["expenses-vendor", "expenses-category"])}>
                <CardHeader>
                  <CardTitle>{tr("postedExpenseDetail")}</CardTitle>
                  <CardDescription>
                    {dateRange.from && dateRange.to
                      ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                      : tr("allPostedJournalEntryDates")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {expensesLoading ? (
                    <Skeleton className="h-96" />
                  ) : expenseReport.lines.length ? (
                    <div className="max-h-[520px] overflow-auto rounded-md border">
                      <Table className="min-w-[980px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>{tr("entry")}</TableHead>
                            <TableHead>{tr("date")}</TableHead>
                            <TableHead>{tr("vendor")}</TableHead>
                            <TableHead>{tr("expenseAccount")}</TableHead>
                            <TableHead>{tr("source")}</TableHead>
                            <TableHead className="text-end">{tr("debit")}</TableHead>
                            <TableHead className="text-end">{tr("credit")}</TableHead>
                            <TableHead className="text-end">{tr("netExpense")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {expenseReport.lines.map((line) => (
                            <TableRow key={line.id}>
                              <TableCell className="font-mono font-medium">
                                {line.entryNumber}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {formatReportDate(line.date)}
                              </TableCell>
                              <TableCell className="font-medium">{line.vendor}</TableCell>
                              <TableCell>
                                <div className="font-medium">{line.accountName}</div>
                                <div dir="ltr" className="font-mono text-xs text-muted-foreground">
                                  {line.accountCode || "-"}
                                </div>
                              </TableCell>
                              <TableCell className="capitalize">{line.source}</TableCell>
                              <TableCell className="text-end font-mono">
                                {line.debitAed > 0
                                  ? formatCurrency(line.debitAed, "AED", locale)
                                  : "-"}
                              </TableCell>
                              <TableCell className="text-end font-mono">
                                {line.creditAed > 0
                                  ? formatCurrency(line.creditAed, "AED", locale)
                                  : "-"}
                              </TableCell>
                              <TableCell className="text-end font-mono font-medium">
                                {formatCurrency(line.netExpenseAed, "AED", locale)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noPostedExpenseAccountJournalLines")}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="payroll" className="space-y-6">
              <div
                className={reportSectionClass(
                  ["payroll-summary", "wps-sif-summary"],
                  "grid grid-cols-1 gap-6 md:grid-cols-4"
                )}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("netPayroll")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {payrollLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {formatCurrency(payrollReport.totalNet, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("payrollRuns")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {payrollLoading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {payrollReport.runCount}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("needsApproval")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {payrollLoading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {payrollReport.approvalQueueCount}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("needsSif")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {payrollLoading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {payrollReport.wpsMissingCount}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className={reportSectionClass(["payroll-summary"])}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("payrollSummary")}</CardTitle>
                      <CardDescription>{tr("payPeriodTotalsApprovalStateAnd")}</CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/payroll">{tr("openPayroll")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {payrollLoading ? (
                    <Skeleton className="h-80" />
                  ) : payrollReport.runCount ? (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.8fr_1.2fr]">
                        <div className="rounded-md border p-4">
                          <div className="mb-3">
                            <div className="font-medium">{tr("payrollStatusMix")}</div>
                            <div className="text-xs text-muted-foreground">
                              {tr("currentDateRangePayrollByWorkflow")}
                            </div>
                          </div>
                          <div className="space-y-3">
                            {payrollReport.statusRows.map((row) => (
                              <div
                                key={row.status}
                                className="flex items-center justify-between gap-4 text-sm"
                              >
                                <div>
                                  <Badge variant={payrollStatusVariant(row.status)} dot>
                                    {row.status}
                                  </Badge>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {tr("runsEmployees", {
                                      count: row.count,
                                      employeeCount: row.employeeCount,
                                    })}
                                  </div>
                                </div>
                                <div className="text-end font-mono">
                                  {formatCurrency(row.totalNet, "AED", locale)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="max-h-[520px] overflow-auto rounded-md border">
                          <Table className="min-w-[920px]">
                            <TableHeader>
                              <TableRow>
                                <TableHead>{tr("period")}</TableHead>
                                <TableHead>{tr("status")}</TableHead>
                                <TableHead className="text-end">{tr("employees")}</TableHead>
                                <TableHead className="text-end">{tr("basic")}</TableHead>
                                <TableHead className="text-end">{tr("allowances")}</TableHead>
                                <TableHead className="text-end">{tr("deductions")}</TableHead>
                                <TableHead className="text-end">{tr("net")}</TableHead>
                                <TableHead>SIF</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {payrollReport.runs.map((run) => (
                                <TableRow key={run.id}>
                                  <TableCell className="font-medium">
                                    {payrollPeriodLabel(run)}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={payrollStatusVariant(run.status)} dot>
                                      {run.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-end font-mono">
                                    {run.employee_count}
                                  </TableCell>
                                  <TableCell className="text-end font-mono">
                                    {formatCurrency(payrollAmount(run.total_basic), "AED", locale)}
                                  </TableCell>
                                  <TableCell className="text-end font-mono">
                                    {formatCurrency(
                                      payrollAmount(run.total_allowances),
                                      "AED",
                                      locale
                                    )}
                                  </TableCell>
                                  <TableCell className="text-end font-mono">
                                    {formatCurrency(
                                      payrollAmount(run.total_deductions),
                                      "AED",
                                      locale
                                    )}
                                  </TableCell>
                                  <TableCell className="text-end font-mono font-medium">
                                    {formatCurrency(payrollAmount(run.total_net), "AED", locale)}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={run.sif_file_content ? "success" : "warning"}
                                      dot
                                    >
                                      {run.sif_file_content ? tr("generated") : tr("needed")}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noPayrollRunsFoundForThis")}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className={reportSectionClass(["wps-sif-summary"])}>
                <CardHeader>
                  <CardTitle>{tr("wpsSifReadiness")}</CardTitle>
                  <CardDescription>{tr("generatedSifFilesAndApprovedPayroll")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("sifGenerated")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {payrollReport.sifGeneratedCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("wpsReady")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {payrollReport.wpsReadyCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("approvedRuns")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {payrollReport.approvedCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("latestPeriod")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {payrollPeriodLabel(payrollReport.latestRun)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatReportDate(payrollReport.latestRun?.approved_at)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="trial" className="space-y-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("debitCreditStatus")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      {trialBalanceSummary.isBalanced ? (
                        <CheckCircle2 className="h-4 w-4 text-success " />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-warning " />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {trialBalanceLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div className="space-y-1">
                        <div
                          dir="ltr"
                          className="font-mono text-2xl font-bold"
                          data-testid="text-trial-balance-difference"
                        >
                          {formatCurrency(
                            trialBalance?.totals?.difference ?? 0,
                            trialBalance?.reportCurrency ?? "AED",
                            locale
                          )}
                        </div>
                        <Badge variant={trialBalanceSummary.isBalanced ? "success" : "warning"} dot>
                          {trialBalanceSummary.isBalanced ? tr("balanced") : tr("needsReview")}
                        </Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("activeAccounts")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <Scale className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {trialBalanceLoading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {trialBalanceSummary.activeAccounts}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("fxAccounts")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {trialBalanceLoading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {trialBalanceSummary.foreignCurrencyAccounts}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{t.trialBalance}</CardTitle>
                      <CardDescription>
                        {dateRange.from && dateRange.to
                          ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                          : tr("postedAccountBalancesThroughToday")}
                      </CardDescription>
                    </div>
                    {!trialBalanceLoading && (
                      <Badge variant={trialBalanceSummary.isBalanced ? "success" : "warning"} dot>
                        {trialBalanceSummary.isBalanced
                          ? tr("readyForClose")
                          : tr("differenceFlagged")}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {trialBalanceLoading ? (
                    <Skeleton className="h-96" />
                  ) : trialBalance?.rows?.length ? (
                    <div className="overflow-x-auto">
                      <Table className="min-w-[900px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>{tr("code")}</TableHead>
                            <TableHead>{tr("account")}</TableHead>
                            <TableHead>{tr("type")}</TableHead>
                            <TableHead className="text-end">{tr("debit")}</TableHead>
                            <TableHead className="text-end">{tr("credit")}</TableHead>
                            <TableHead className="text-end">{tr("balance")}</TableHead>
                            <TableHead>{tr("flags")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {trialBalance.rows.map((row) => (
                            <TableRow key={row.accountId}>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {row.accountCode || "-"}
                              </TableCell>
                              <TableCell className="font-medium">
                                {row.accountName || tr("unknownAccount")}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="capitalize">
                                  {row.accountType}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-end font-mono">
                                {formatCurrency(
                                  row.totalDebit ?? 0,
                                  trialBalance.reportCurrency,
                                  locale
                                )}
                              </TableCell>
                              <TableCell className="text-end font-mono">
                                {formatCurrency(
                                  row.totalCredit ?? 0,
                                  trialBalance.reportCurrency,
                                  locale
                                )}
                              </TableCell>
                              <TableCell className="text-end font-mono font-medium">
                                {formatCurrency(
                                  row.balance ?? 0,
                                  trialBalance.reportCurrency,
                                  locale
                                )}
                              </TableCell>
                              <TableCell>
                                {row.hasForeignLines ? (
                                  <Badge variant="info">FX</Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">-</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="border-t-2">
                            <TableCell colSpan={3} className="font-semibold">
                              {tr("totals")}
                            </TableCell>
                            <TableCell className="text-end font-mono font-semibold">
                              {formatCurrency(
                                trialBalance.totals?.sumDebits ?? 0,
                                trialBalance.reportCurrency ?? "AED",
                                locale
                              )}
                            </TableCell>
                            <TableCell className="text-end font-mono font-semibold">
                              {formatCurrency(
                                trialBalance.totals?.sumCredits ?? 0,
                                trialBalance.reportCurrency ?? "AED",
                                locale
                              )}
                            </TableCell>
                            <TableCell className="text-end font-mono font-semibold">
                              {formatCurrency(
                                trialBalance.totals?.difference ?? 0,
                                trialBalance.reportCurrency ?? "AED",
                                locale
                              )}
                            </TableCell>
                            <TableCell />
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noPostedAccountsFoundForThis")}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ledger" className="space-y-6">
              <div
                className={reportSectionClass(
                  ["general-ledger", "account-transactions"],
                  "grid grid-cols-1 gap-6 md:grid-cols-4"
                )}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("postedEntries")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {ledgerLoading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {ledgerReport.entryCount}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">
                      {tr("debitCreditDifference")}
                    </CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      {ledgerReport.difference < 0.005 ? (
                        <CheckCircle2 className="h-4 w-4 text-success " />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-warning " />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {ledgerLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div className="space-y-1">
                        <div dir="ltr" className="font-mono text-2xl font-bold">
                          {formatCurrency(ledgerReport.difference, "AED", locale)}
                        </div>
                        <Badge
                          variant={ledgerReport.difference < 0.005 ? "success" : "warning"}
                          dot
                        >
                          {ledgerReport.difference < 0.005 ? tr("balanced") : tr("needsReview")}
                        </Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("accountsTouched")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <Scale className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {ledgerLoading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {ledgerReport.accountCount}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("reviewQueue")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {ledgerLoading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : (
                      <div className="space-y-1">
                        <div dir="ltr" className="font-mono text-2xl font-bold">
                          {ledgerReport.reviewEntries}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {tr("fxLines", {
                            foreignCurrencyLines: ledgerReport.foreignCurrencyLines,
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <Card className={reportSectionClass(["account-transactions"])}>
                  <CardHeader>
                    <CardTitle>{tr("accountTransactions")}</CardTitle>
                    <CardDescription>{tr("accountLevelDebitCreditAndActivity")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {ledgerLoading ? (
                      <Skeleton className="h-64" />
                    ) : accountActivity.length ? (
                      <div className="max-h-[520px] overflow-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{tr("account")}</TableHead>
                              <TableHead>{tr("type")}</TableHead>
                              <TableHead className="text-end">{tr("lines2")}</TableHead>
                              <TableHead className="text-end">{tr("debit")}</TableHead>
                              <TableHead className="text-end">{tr("credit")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {accountActivity.map((row) => (
                              <TableRow key={row.accountId}>
                                <TableCell>
                                  <div className="font-medium">{row.accountName}</div>
                                  <div
                                    dir="ltr"
                                    className="font-mono text-xs text-muted-foreground"
                                  >
                                    {row.accountCode || "-"}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="capitalize">
                                    {row.accountType}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {row.lineCount}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(row.debit, "AED", locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(row.credit, "AED", locale)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                        {tr("noPostedAccountActivityFoundFor")}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className={reportSectionClass(["general-ledger"])}>
                  <CardHeader>
                    <CardTitle>{tr("sourceReview")}</CardTitle>
                    <CardDescription>{tr("automationRoutingByJournalEntrySource")}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {ledgerLoading ? (
                      <Skeleton className="h-64" />
                    ) : ledgerSourceRows.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{tr("source")}</TableHead>
                            <TableHead className="text-end">{tr("entries")}</TableHead>
                            <TableHead className="text-end">{tr("lines2")}</TableHead>
                            <TableHead className="text-end">{tr("activity")}</TableHead>
                            <TableHead className="text-end">{tr("status")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ledgerSourceRows.map((row) => (
                            <TableRow key={row.source}>
                              <TableCell className="capitalize">{row.source}</TableCell>
                              <TableCell className="text-end font-mono">{row.entryCount}</TableCell>
                              <TableCell className="text-end font-mono">{row.lineCount}</TableCell>
                              <TableCell className="text-end font-mono">
                                {formatCurrency(row.amountAed, "AED", locale)}
                              </TableCell>
                              <TableCell className="text-end">
                                <Badge variant={row.needsReview ? "warning" : "success"} dot>
                                  {row.needsReview ? tr("review") : tr("linked")}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                        {tr("noJournalSourcesFoundForThis")}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className={reportSectionClass(["general-ledger"])}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("generalLedgerDetail")}</CardTitle>
                      <CardDescription>
                        {dateRange.from && dateRange.to
                          ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                          : tr("allPostedJournalEntryDates")}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {tr("rowsPageOf", {
                          ledgerLinesCount: ledgerLines.length,
                          ledgerDetailCurrentPage,
                          ledgerDetailPageCount,
                        })}
                      </Badge>
                      <Button asChild size="sm" variant="outline">
                        <Link href="/journal">{tr("openJournal")}</Link>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {ledgerLoading ? (
                    <Skeleton className="h-96" />
                  ) : ledgerLines.length ? (
                    <div className="space-y-3">
                      <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                        {tr("showingRows", { value: ledgerDetailStartIndex + 1 })}
                        {Math.min(
                          ledgerDetailStartIndex + ledgerDetailPageSize,
                          ledgerLines.length
                        )}{" "}
                        {tr("ofExcelAndGoogleSheetsExports", {
                          ledgerLinesCount: ledgerLines.length,
                        })}
                      </div>
                      <div className="overflow-x-auto rounded-md border">
                        <Table className="min-w-[980px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>{tr("entry")}</TableHead>
                              <TableHead>{tr("date")}</TableHead>
                              <TableHead>{tr("account")}</TableHead>
                              <TableHead>{tr("source")}</TableHead>
                              <TableHead>{tr("memo")}</TableHead>
                              <TableHead className="text-end">{tr("debit")}</TableHead>
                              <TableHead className="text-end">{tr("credit")}</TableHead>
                              <TableHead>{tr("flags")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {ledgerDetailPageLines.map((line) => (
                              <TableRow key={line.id}>
                                <TableCell className="font-mono font-medium">
                                  {line.entryNumber}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {formatReportDate(line.date)}
                                </TableCell>
                                <TableCell>
                                  <div className="font-medium">{line.accountName}</div>
                                  <div
                                    dir="ltr"
                                    className="font-mono text-xs text-muted-foreground"
                                  >
                                    {line.accountCode || "-"}
                                  </div>
                                </TableCell>
                                <TableCell className="capitalize">{line.source}</TableCell>
                                <TableCell className="max-w-[240px] truncate text-muted-foreground">
                                  {line.memo || "-"}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {line.debit > 0 ? formatCurrency(line.debit, "AED", locale) : "-"}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {line.credit > 0
                                    ? formatCurrency(line.credit, "AED", locale)
                                    : "-"}
                                </TableCell>
                                <TableCell>
                                  {line.hasForeignCurrency ? (
                                    <Badge variant="info">FX</Badge>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-muted-foreground">
                          {tr("tableIsPaginatedForReadabilityExports")}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={ledgerDetailCurrentPage <= 1}
                            onClick={() => setLedgerDetailPage((page) => Math.max(1, page - 1))}
                          >
                            <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
                            {tr("previous")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={ledgerDetailCurrentPage >= ledgerDetailPageCount}
                            onClick={() =>
                              setLedgerDetailPage((page) =>
                                Math.min(ledgerDetailPageCount, page + 1)
                              )
                            }
                          >
                            {tr("next2")}
                            <ArrowRight className="ms-1.5 h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noPostedJournalLinesFoundFor")}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="close" className="space-y-6">
              <div
                className={reportSectionClass(
                  ["month-end-close-status", "audit-trail", "consolidated-statements"],
                  "grid grid-cols-1 gap-6 md:grid-cols-4"
                )}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("closeReadiness2")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {monthEndCloseLoading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {monthEndReadinessPercent}%
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("completed")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <CheckCircle2 className="h-4 w-4 text-success " />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {monthEndCloseLoading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {monthEndCompletedChecks}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("needsReview2")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <AlertTriangle className="h-4 w-4 text-warning " />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {monthEndCloseLoading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {monthEndReviewChecks}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("closePeriod")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div dir="ltr" className="font-mono text-2xl font-bold">
                      {monthEndPeriod}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{monthEndPeriodLabel}</p>
                  </CardContent>
                </Card>
              </div>

              <Card className={reportSectionClass(["month-end-close-status"])}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("monthEndCloseStatus2")}</CardTitle>
                      <CardDescription>
                        {monthEndCloseStatus
                          ? `${formatReportDate(monthEndCloseStatus.periodStart)} - ${formatReportDate(monthEndCloseStatus.periodEnd)}`
                          : monthEndPeriodLabel}
                      </CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/month-end">{tr("openMonthEnd")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {monthEndCloseLoading ? (
                    <Skeleton className="h-80" />
                  ) : monthEndChecklist.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{tr("check")}</TableHead>
                          <TableHead>{tr("status")}</TableHead>
                          <TableHead>{tr("description")}</TableHead>
                          <TableHead>{tr("details")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {monthEndChecklist.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium">{item.title}</TableCell>
                            <TableCell>
                              <Badge
                                variant={item.status === "complete" ? "success" : "warning"}
                                dot
                              >
                                {item.status === "complete" ? tr("complete") : tr("needsReview")}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {item.description}
                            </TableCell>
                            <TableCell className="text-sm">{item.details}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      {tr("noMonthEndCloseChecksFound")}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card className={reportSectionClass(["audit-trail"])}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle id="audit-trail-title">{tr("auditTrail2")}</CardTitle>
                      <CardDescription>{auditTrailPeriodLabel}</CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/history">{tr("openHistory")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {auditTrailLoading ? (
                    <Skeleton className="h-80" />
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">{tr("events")}</div>
                          <div dir="ltr" className="font-mono text-xl font-semibold">
                            {auditTrailReport.logCount}
                          </div>
                        </div>
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">{tr("highRisk")}</div>
                          <div dir="ltr" className="font-mono text-xl font-semibold">
                            {auditTrailReport.highRiskCount}
                          </div>
                        </div>
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">
                            {tr("postingActions")}
                          </div>
                          <div dir="ltr" className="font-mono text-xl font-semibold">
                            {auditTrailReport.postingActionCount}
                          </div>
                        </div>
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">{tr("users")}</div>
                          <div dir="ltr" className="font-mono text-xl font-semibold">
                            {auditTrailReport.userCount}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <div className="space-y-3">
                          <div className="text-sm font-medium">{tr("activityByAction")}</div>
                          {auditTrailReport.actionRows.slice(0, 6).length ? (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{tr("action")}</TableHead>
                                  <TableHead className="text-end">{tr("events")}</TableHead>
                                  <TableHead>{tr("latest")}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {auditTrailReport.actionRows.slice(0, 6).map((row) => (
                                  <TableRow key={row.key}>
                                    <TableCell className="capitalize">{row.label}</TableCell>
                                    <TableCell className="text-end font-mono">
                                      {row.count}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                      {formatReportDate(row.latestAt)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          ) : (
                            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                              {tr("noActivityActionsFoundForThis")}
                            </div>
                          )}
                        </div>

                        <div className="space-y-3">
                          <div className="text-sm font-medium">{tr("activityByRecordType")}</div>
                          {auditTrailReport.entityRows.slice(0, 6).length ? (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{tr("recordType")}</TableHead>
                                  <TableHead className="text-end">{tr("events")}</TableHead>
                                  <TableHead>{tr("latest")}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {auditTrailReport.entityRows.slice(0, 6).map((row) => (
                                  <TableRow key={row.key}>
                                    <TableCell className="capitalize">{row.label}</TableCell>
                                    <TableCell className="text-end font-mono">
                                      {row.count}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                      {formatReportDate(row.latestAt)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          ) : (
                            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                              {tr("noAuditedRecordTypesFoundFor")}
                            </div>
                          )}
                        </div>
                      </div>

                      {auditTrailReport.rows.length ? (
                        <div className="overflow-x-auto">
                          <Table className="min-w-[920px]">
                            <TableHeader>
                              <TableRow>
                                <TableHead>{tr("date")}</TableHead>
                                <TableHead>{tr("action")}</TableHead>
                                <TableHead>{tr("record")}</TableHead>
                                <TableHead>{tr("risk")}</TableHead>
                                <TableHead>{tr("description")}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {auditTrailReport.rows.slice(0, 20).map((row) => (
                                <TableRow key={row.id}>
                                  <TableCell className="text-muted-foreground">
                                    {formatReportDate(row.createdAt)}
                                  </TableCell>
                                  <TableCell className="capitalize">{row.actionLabel}</TableCell>
                                  <TableCell>
                                    <div className="capitalize">{row.entityLabel}</div>
                                    <div
                                      dir="ltr"
                                      className="font-mono text-xs text-muted-foreground"
                                    >
                                      {row.entityId || "-"}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={activityLogRiskVariant(row.riskLevel)} dot>
                                      {row.riskLevel}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="max-w-[360px] truncate">
                                    {row.description}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                          {tr("noActivityLogsFoundForThis")}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
              <Card className={reportSectionClass(["consolidated-statements"])}>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{tr("managementRollUp")}</CardTitle>
                      <CardDescription>
                        {tr("accessibleCompanyManagementViewNoEliminations", {
                          periodLabel: consolidatedStatementsReport.periodLabel,
                        })}
                      </CardDescription>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/financial-statements">{tr("openStatements")}</Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {consolidatedStatementsLoading ? (
                    <Skeleton className="h-80" />
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">{tr("entities")}</div>
                          <div dir="ltr" className="font-mono text-xl font-semibold">
                            {consolidatedStatementsReport.loadedEntityCount}/
                            {consolidatedStatementsReport.entityCount}
                          </div>
                        </div>
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">{tr("revenue")}</div>
                          <div dir="ltr" className="font-mono text-xl font-semibold">
                            {formatCurrency(
                              consolidatedStatementsReport.totalRevenue,
                              "AED",
                              locale
                            )}
                          </div>
                        </div>
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">{tr("netProfit")}</div>
                          <div dir="ltr" className="font-mono text-xl font-semibold">
                            {formatCurrency(consolidatedStatementsReport.netProfit, "AED", locale)}
                          </div>
                        </div>
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">{tr("assets")}</div>
                          <div dir="ltr" className="font-mono text-xl font-semibold">
                            {formatCurrency(
                              consolidatedStatementsReport.totalAssets,
                              "AED",
                              locale
                            )}
                          </div>
                        </div>
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">{tr("reviewItems")}</div>
                          <div dir="ltr" className="font-mono text-xl font-semibold">
                            {consolidatedStatementsReport.reviewCount}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            consolidatedStatementsReport.reviewCount > 0 ? "warning" : "success"
                          }
                          dot
                        >
                          {consolidatedStatementsReport.statusLabel}
                        </Badge>
                        <Badge variant="outline">
                          {consolidatedStatementsReport.consolidationBasis}
                        </Badge>
                      </div>

                      {consolidatedStatementsReport.rows.length ? (
                        <div className="overflow-x-auto">
                          <Table className="min-w-[980px]">
                            <TableHeader>
                              <TableRow>
                                <TableHead>{tr("company")}</TableHead>
                                <TableHead>{tr("type")}</TableHead>
                                <TableHead className="text-end">{tr("revenue")}</TableHead>
                                <TableHead className="text-end">{tr("netProfit")}</TableHead>
                                <TableHead className="text-end">{tr("assets")}</TableHead>
                                <TableHead>{tr("status")}</TableHead>
                                <TableHead>{tr("review")}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {consolidatedStatementsReport.rows.map((row) => (
                                <TableRow key={row.companyId}>
                                  <TableCell>
                                    <div className="font-medium">{row.companyName}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {row.baseCurrency}
                                    </div>
                                  </TableCell>
                                  <TableCell className="capitalize">{row.companyType}</TableCell>
                                  <TableCell className="text-end font-mono">
                                    {formatCurrency(row.revenue, "AED", locale)}
                                  </TableCell>
                                  <TableCell className="text-end font-mono">
                                    {formatCurrency(row.netProfit, "AED", locale)}
                                  </TableCell>
                                  <TableCell className="text-end font-mono">
                                    {formatCurrency(row.assets, "AED", locale)}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={consolidatedStatusVariant(row.status)} dot>
                                      {row.statusLabel}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="max-w-[360px] text-sm text-muted-foreground">
                                    {row.reviewReason || tr("readyForAccountantPack")}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                          {tr("noAccessibleCompaniesFoundForThis")}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="planning" className="space-y-6">
              <div
                className={reportSectionClass(
                  ["budget-actual", "cash-flow-forecast"],
                  "grid grid-cols-1 gap-6 md:grid-cols-4"
                )}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("budget")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {planningLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {formatCurrency(planningReport.budgetTotal, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("actual")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {planningLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div dir="ltr" className="font-mono text-2xl font-bold">
                        {formatCurrency(planningReport.actualTotal, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("variance")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      {planningReport.variance >= 0 ? (
                        <CheckCircle2 className="h-4 w-4 text-success " />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-warning " />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {planningLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div className="space-y-1">
                        <div dir="ltr" className="font-mono text-2xl font-bold">
                          {formatCurrency(planningReport.variance, "AED", locale)}
                        </div>
                        <Badge variant={planningReport.variance >= 0 ? "success" : "warning"} dot>
                          {planningReport.variance >= 0 ? tr("underBudget") : tr("overBudget")}
                        </Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">{tr("projectedCash")}</CardTitle>
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {planningLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div className="space-y-1">
                        <div dir="ltr" className="font-mono text-2xl font-bold">
                          {formatCurrency(planningReport.projectedEndingBalance, "AED", locale)}
                        </div>
                        <Badge
                          variant={
                            planningReport.cashWarning === "On track"
                              ? "success"
                              : planningReport.cashWarning === "Low cash warning"
                                ? "warning"
                                : "danger"
                          }
                          dot
                        >
                          {planningReport.cashWarning}
                        </Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <Card className={reportSectionClass(["budget-actual"])}>
                  <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <CardTitle>{tr("budgetVsActual")}</CardTitle>
                        <CardDescription>
                          {planningReport.budget
                            ? `${planningReport.budget.name} (${planningReport.budget.fiscalYear})`
                            : tr("createABudgetToCompareActuals")}
                        </CardDescription>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link href="/budgets">{tr("openBudgets")}</Link>
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {planningLoading ? (
                      <Skeleton className="h-64" />
                    ) : planningReport.largestVarianceLines.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{tr("category")}</TableHead>
                            <TableHead className="text-end">{tr("budget")}</TableHead>
                            <TableHead className="text-end">{tr("actual")}</TableHead>
                            <TableHead className="text-end">{tr("variance")}</TableHead>
                            <TableHead className="text-end">{tr("status")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {planningReport.largestVarianceLines.map((line) => (
                            <TableRow key={line.id}>
                              <TableCell className="font-medium">{line.category}</TableCell>
                              <TableCell className="text-end font-mono">
                                {formatCurrency(line.totals.budget, "AED", locale)}
                              </TableCell>
                              <TableCell className="text-end font-mono">
                                {formatCurrency(line.totals.actual, "AED", locale)}
                              </TableCell>
                              <TableCell className="text-end font-mono font-medium">
                                {formatCurrency(line.totals.variance, "AED", locale)}
                              </TableCell>
                              <TableCell className="text-end">
                                <Badge
                                  variant={line.totals.variance >= 0 ? "success" : "warning"}
                                  dot
                                >
                                  {line.totals.variance >= 0 ? tr("under") : tr("over")}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                        {tr("noBudgetVarianceDataAvailable")}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className={reportSectionClass(["cash-flow-forecast"])}>
                  <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <CardTitle>{tr("cashFlowForecast")}</CardTitle>
                        <CardDescription>{tr("n90DayProjectedInflowsOutflowsAnd")}</CardDescription>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link href="/cashflow-forecast">{tr("openForecast")}</Link>
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {planningLoading ? (
                      <Skeleton className="h-64" />
                    ) : planningReport.projections.length ? (
                      <div className="max-h-[520px] overflow-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{tr("week")}</TableHead>
                              <TableHead>{tr("period")}</TableHead>
                              <TableHead className="text-end">{tr("in")}</TableHead>
                              <TableHead className="text-end">{tr("out")}</TableHead>
                              <TableHead className="text-end">{tr("balance")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {planningReport.projections.map((row) => (
                              <TableRow key={row.week}>
                                <TableCell className="font-medium">
                                  {tr("week2", { week: row.week })}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {row.weekStart} - {row.weekEnd}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(row.expectedInflows, "AED", locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono">
                                  {formatCurrency(row.expectedOutflows, "AED", locale)}
                                </TableCell>
                                <TableCell className="text-end font-mono font-medium">
                                  {formatCurrency(row.projectedBalance, "AED", locale)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                        {tr("noCashFlowProjectionDataAvailable")}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className={cn(hasFocusedReportSelection && "hidden")}>
                <CardHeader>
                  <CardTitle>{tr("planningAutomation")}</CardTitle>
                  <CardDescription>{tr("signalsThatShouldDriveAlertsAnd")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("overBudgetLines")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {planningReport.overBudgetLines}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("cashMovement")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {formatCurrency(planningReport.cashMovement, "AED", locale)}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">{tr("forecastInsights")}</div>
                      <div dir="ltr" className="font-mono text-2xl font-semibold">
                        {planningReport.insights.length}
                      </div>
                    </div>
                  </div>
                  {planningReport.insights.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {planningReport.insights.slice(0, 3).map((insight) => (
                        <div key={insight} className="rounded-md border p-3 text-sm">
                          {insight}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
