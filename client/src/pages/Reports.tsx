import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link, useLocation } from "wouter";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/page-header";
import {
  ReportLaunchPicker,
  type ReportLaunchDeliveryPreview,
} from "@/components/reports/ReportLaunchPicker";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import {
  type ExportData,
  exportToExcel,
  exportToGoogleSheets,
  prepareProfitLossForExport,
  prepareBalanceSheetForExport,
  prepareVATSummaryForExport,
  prepareCorporateTaxEstimateForExport,
  prepareMonthEndCloseStatusForExport,
  prepareAuditTrailForExport,
  prepareTrialBalanceForExport,
  prepareInvoiceStatusForExport,
  prepareBalanceSummaryReportsForExport,
  prepareExpenseReportsForExport,
  preparePayrollReportsForExport,
  prepareLedgerReportsForExport,
  prepareConsolidatedStatementsForExport,
  preparePlanningReportsForExport,
} from "@/lib/export";
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
  buildReportAutomationHealthTrend,
  calculateReportAutomationHealth,
  clearPreferredReportPersona,
  clearPreferredReportWorkflowSearch,
  getPreferredReportDeliveryAutomationCommand,
  getPreferredReportPersona,
  getPreferredReportWorkflowSearch,
  getReportAutomationHealthHistory,
  parseReportDeliveryAutomationCommand,
  recordReportAutomationHealthSnapshots,
  reportComparisonPresetHref,
  reportComparisonPresets,
  reportDecisionShortcutHref,
  reportDecisionShortcuts,
  reportDeliverySubscriptionHref,
  reportDeliverySubscriptions,
  reportCatalog,
  reportAutomationPlaybookHref,
  reportPackTemplateHref,
  reportPackTemplates,
  reportPersonas,
  reportPersonaWorkspaces,
  reportSectionHref,
  reportTabs,
  reportHref,
  reportsHref,
  reportWorkspaceHref,
  setPreferredReportPersona,
  setPreferredReportDeliveryAutomationCommand,
  setPreferredReportWorkflowSearch,
  type ReportCatalogItem,
  type ReportAutomationTriggerSeverity,
  type ReportDeliveryAutomationCommand,
  type ReportPersona,
  type ReportStatus,
  type ReportTab,
  type ReportWorkspaceIcon,
} from "@/lib/reportCatalog";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Briefcase,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileText,
  Send,
  Scale,
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
  reportNames: string[];
  triggerRuleTitles: string[];
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

interface ExpenseSummaryRow {
  label: string;
  receiptCount: number;
  subtotalAed: number;
  vatAed: number;
  totalAed: number;
  unpostedCount: number;
  autoPostedCount: number;
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

interface ReportWorkflowFinderResult {
  id: string;
  type: string;
  title: string;
  description: string;
  meta: string;
  href: string;
  persona: ReportPersona | null;
  badgeVariant: BadgeProps["variant"];
  coverageCues: ReportWorkflowCoverageCue[];
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

const reportStatusMeta: Record<ReportStatus, { label: string; variant: BadgeProps["variant"] }> = {
  live: { label: "Live", variant: "success" },
  api: { label: "API ready", variant: "info" },
  planned: { label: "Planned", variant: "neutral" },
};

const roadmapImpactMeta = {
  high: { label: "High impact", variant: "warning" },
  medium: { label: "Medium impact", variant: "info" },
  low: { label: "Low impact", variant: "neutral" },
} as const satisfies Record<string, { label: string; variant: BadgeProps["variant"] }>;

const triggerSeverityMeta = {
  critical: { label: "Critical", variant: "danger" },
  review: { label: "Review", variant: "warning" },
  info: { label: "Monitor", variant: "info" },
} as const satisfies Record<
  ReportAutomationTriggerSeverity,
  { label: string; variant: BadgeProps["variant"] }
>;

const personaFilters: Array<{ id: PersonaFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "owner", label: "Owner / Solo" },
  { id: "freelancer", label: "Freelancer" },
  { id: "accountant", label: "Accountant" },
];

const reportDeliveryRunStatusFilters: Array<{
  id: ReportDeliveryRunStatusFilter;
  label: string;
}> = [
  { id: "all", label: "All runs" },
  { id: "queued", label: "Queued" },
  { id: "sent", label: "Sent" },
  { id: "failed", label: "Failed" },
];

const reportDeliveryAutomationCommandLabels: Record<ReportDeliveryAutomationCommand, string> = {
  retry: "Retry recovery",
  review: "Review guardrails",
  queue: "Queue next pack",
  comparison: "Open comparison",
};

const reportWorkspaceIcons: Record<ReportWorkspaceIcon, LucideIcon> = {
  briefcase: Briefcase,
  clipboardCheck: ClipboardCheck,
  users: Users,
};

const invoiceStatusLabels: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  posted: "Posted",
  partial: "Partial",
  paid: "Paid",
  void: "Void",
  cancelled: "Cancelled",
};

const inactiveInvoiceStatuses = new Set(["void", "cancelled"]);
const nonRevenueInvoiceStatuses = new Set(["draft", "void", "cancelled"]);

function amountInAed(invoice: InvoiceReportRow): number {
  return Number(invoice.baseCurrencyAmount ?? invoice.total ?? 0) || 0;
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
  if (status === "ready") return "Ready to post";
  if (status === "fully_depreciated") return "Fully depreciated";
  if (status === "non_depreciable") return "Non-depreciable";
  if (status === "not_acquired") return "Not acquired";
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
    consolidationBasis: "Accessible company roll-up; no eliminations applied.",
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
  return account?.nameEn || account?.nameAr || "Unknown Account";
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
  return invoiceStatusLabels[status] ?? status;
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

function reportTabFromSearch(search: string): ReportTab {
  const tab = new URLSearchParams(search).get("tab");
  return reportTabs.includes(tab as ReportTab) ? (tab as ReportTab) : "pl";
}

function personaFilterFromSearch(
  search: string,
  fallbackPersona: ReportPersona | null = null
): PersonaFilter {
  const persona = new URLSearchParams(search).get("persona");
  return reportPersonas.includes(persona as ReportPersona)
    ? (persona as ReportPersona)
    : (fallbackPersona ?? "all");
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

function formatComparisonPercent(value: number | null): string {
  if (value === null) return "New";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
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
  if (!value) return "No runs yet";
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
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId, companies: accessibleCompanies = [] } = useDefaultCompany();
  const [location, navigate] = useLocation();
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [isExporting, setIsExporting] = useState(false);
  const [reportAutomationHealthHistory, setReportAutomationHealthHistory] = useState(() =>
    getReportAutomationHealthHistory()
  );
  const [editingReportDeliverySubscriptionId, setEditingReportDeliverySubscriptionId] = useState<
    string | null
  >(null);
  const [reportDeliveryRunStatusFilter, setReportDeliveryRunStatusFilter] =
    useState<ReportDeliveryRunStatusFilter>("all");
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

  const locationSearch = useMemo(() => {
    return location.includes("?") ? location.slice(location.indexOf("?")) : "";
  }, [location]);

  const activeTab = useMemo(() => {
    return reportTabFromSearch(locationSearch || window.location.search);
  }, [locationSearch]);

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

  const setActiveTab = (tab: ReportTab, persona: PersonaFilter = personaFilter) => {
    navigate(reportsHref({ tab, persona }));
  };

  const setReportPersonaFilter = (persona: PersonaFilter) => {
    if (persona === "all") {
      clearPreferredReportPersona();
      setPreferredReportPersonaState(null);
    } else {
      setPreferredReportPersona(persona);
      setPreferredReportPersonaState(persona);
    }
    navigate(reportsHref({ tab: activeTab, persona }));
  };

  useEffect(() => {
    setReportWorkflowSearch(getPreferredReportWorkflowSearch(personaFilter));
  }, [personaFilter]);

  const personaFilterLabel =
    personaFilters.find((filter) => filter.id === personaFilter)?.label ?? "All";
  const personaScopeDescription =
    personaFilter === "all"
      ? "Showing all role signals."
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
        title: "Could not save automation command",
        description: error?.message || "Failed to save the pinned automation command",
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
        title: "Automation command pinned",
        description: `${reportDeliveryAutomationCommandLabels[parsedCommand]} is pinned for ${personaFilterLabel.toLowerCase()} workflows.`,
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

  const filteredReports = useMemo(() => {
    return reportCatalog.filter((report) => {
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
    });
  }, [matchesReportWorkflowSearch, personaFilter]);

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
      const ready =
        syncedReportCatalogSummary.liveReportCount + syncedReportCatalogSummary.apiReportCount;
      return {
        live: syncedReportCatalogSummary.liveReportCount,
        ready,
        planned: syncedReportCatalogSummary.plannedReportCount,
        total: syncedReportCatalogSummary.reportCount,
        packTemplates: syncedReportCatalogSummary.packTemplateCount,
        comparisonPresets: syncedReportCatalogSummary.comparisonPresetCount,
        deliverySubscriptions: syncedReportCatalogSummary.deliverySubscriptionCount,
        automationStarters: syncedReportCatalogSummary.automationStarterCount,
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
      deliverySubscriptions: reportDeliverySubscriptions.length,
      automationStarters: reportAutomationStarters.length,
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
      const readyReports = syncedSummary?.liveReportCount ?? localReadyReports;
      const plannedReports = reports.filter((report) => report.status === "planned");
      const automationCount =
        syncedSummary?.automationPlaybookCount ?? workspace.automations.length;
      const topReadyReport = reports.find((report) => report.tab) ?? reports[0];
      return {
        ...workspace,
        icon: reportWorkspaceIcons[workspace.icon],
        reports,
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
          primaryReportHref: reportHref(primaryReport) ?? reportDecisionShortcutHref(shortcut),
          comparisonHref: comparisonPreset
            ? reportComparisonPresetHref(comparisonPreset)
            : reportDecisionShortcutHref(shortcut),
          automationHref: automationStarter
            ? reportAutomationStarterHref(automationStarter)
            : reportDecisionShortcutHref(shortcut),
        },
      ];
    });
  }, [workspaceSummaries]);

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
  const consolidatedCompanyIds = useMemo(
    () => accessibleReportCompanies.map((company) => company.id).sort(),
    [accessibleReportCompanies]
  );

  const { data: profitLoss, isLoading: plLoading } = useQuery<ProfitLossReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "pl", dateParams],
    enabled: !!selectedCompanyId,
  });

  const { data: balanceSheet, isLoading: bsLoading } = useQuery<BalanceSheetReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "balance-sheet", dateParams],
    enabled: !!selectedCompanyId,
  });

  const { data: vatSummary, isLoading: vatLoading } = useQuery<VATSummaryReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "vat-summary", dateParams],
    enabled: !!selectedCompanyId,
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
      enabled: !!selectedCompanyId,
    });

  const corporateTaxStatus = useMemo(
    () => corporateTaxEstimateStatus(corporateTaxEstimate),
    [corporateTaxEstimate]
  );

  const corporateTaxBridgeRows = useMemo(
    () => [
      {
        metric: "Revenue",
        amount: corporateTaxEstimate?.totalRevenue ?? 0,
        note: "Posted income accounts in the selected period.",
      },
      {
        metric: "Less: expenses",
        amount: -(corporateTaxEstimate?.totalExpenses ?? 0),
        note: "Posted expense accounts in the selected period.",
      },
      {
        metric: "Gross profit",
        amount: corporateTaxEstimate?.grossProfit ?? 0,
        note: "Revenue less expenses before tax-specific deductions.",
      },
      {
        metric: "Less: deductions",
        amount: -(corporateTaxEstimate?.totalDeductions ?? 0),
        note: "Adjustable in the Corporate Tax workspace.",
      },
      {
        metric: "Taxable income",
        amount: corporateTaxEstimate?.taxableIncome ?? 0,
        note: "Income before applying the zero-rate band.",
      },
      {
        metric: "Less: zero-rate band",
        amount: -(corporateTaxEstimate?.exemptionThreshold ?? 0),
        note: "Threshold returned by the Corporate Tax calculation endpoint.",
      },
      {
        metric: "Income above zero-rate band",
        amount: corporateTaxEstimate?.taxableAmount ?? 0,
        note: "Positive income above the zero-rate band before applying the returned rate.",
      },
      {
        metric: "Corporate tax payable",
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
      enabled: !!selectedCompanyId,
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
      enabled: !!selectedCompanyId,
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
      enabled: !!selectedCompanyId,
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
      enabled: !!selectedCompanyId,
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
              companyName: company.name || company.legalName || "Unnamed company",
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
                error: error?.message || "Financial reports could not be loaded.",
              };
            }
          })
        ),
      enabled: accessibleReportCompanies.length > 0,
    });

  const { data: trialBalance, isLoading: trialBalanceLoading } = useQuery<TrialBalanceReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "trial-balance", trialBalanceParams],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/reports/trial-balance${trialBalanceParams}`
      ),
    enabled: !!selectedCompanyId,
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<InvoiceReportRow[]>({
    queryKey: ["/api/companies", selectedCompanyId, "invoices"],
    enabled: !!selectedCompanyId,
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
      enabled: !!selectedCompanyId,
    });

  const { data: overdueReport, isLoading: overdueLoading } = useQuery<OverdueResponse>({
    queryKey: ["/api/chasing/overdue", selectedCompanyId],
    queryFn: () => apiRequest("GET", `/api/chasing/overdue/${selectedCompanyId}`),
    enabled: !!selectedCompanyId,
  });

  const { data: receipts = [], isLoading: receiptsLoading } = useQuery<ReceiptReportRow[]>({
    queryKey: ["/api/companies", selectedCompanyId, "receipts"],
    enabled: !!selectedCompanyId,
  });

  const { data: expenseClaims = [], isLoading: expenseClaimsLoading } = useQuery<
    ExpenseClaimReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "expense-claims"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/expense-claims`),
    enabled: !!selectedCompanyId,
  });

  const { data: expenseClaimSummary, isLoading: expenseClaimSummaryLoading } =
    useQuery<ExpenseClaimSummaryReport>({
      queryKey: ["/api/companies", selectedCompanyId, "expense-claims", "summary"],
      queryFn: () =>
        apiRequest("GET", `/api/companies/${selectedCompanyId}/expense-claims/summary`),
      enabled: !!selectedCompanyId,
    });

  const { data: payrollRuns = [], isLoading: payrollRunsLoading } = useQuery<PayrollRunReportRow[]>(
    {
      queryKey: ["/api/companies", selectedCompanyId, "payroll-runs"],
      queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/payroll-runs`),
      enabled: !!selectedCompanyId,
    }
  );

  const { data: journalEntries = [], isLoading: journalLoading } = useQuery<
    JournalEntryReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "journal"],
    enabled: !!selectedCompanyId,
  });

  const { data: monthEndCloseStatus, isLoading: monthEndCloseLoading } =
    useQuery<MonthEndCloseStatusReport>({
      queryKey: ["/api/companies", selectedCompanyId, "month-end", "checklist", monthEndPeriod],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/month-end/checklist?period=${monthEndPeriod}`
        ),
      enabled: !!selectedCompanyId,
    });

  const { data: activityLogs = [], isLoading: activityLogsLoading } = useQuery<
    ActivityLogReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "activity-logs"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/activity-logs?limit=200`),
    enabled: !!selectedCompanyId,
  });

  const { data: budgetPlans = [], isLoading: budgetPlansLoading } = useQuery<BudgetPlanReportRow[]>(
    {
      queryKey: ["/api/companies", selectedCompanyId, "budget-plans"],
      enabled: !!selectedCompanyId,
    }
  );

  const selectedBudgetPlan = useMemo(() => {
    return budgetPlans.find((budget) => budget.status === "approved") ?? budgetPlans[0];
  }, [budgetPlans]);

  const { data: varianceReport, isLoading: varianceLoading } = useQuery<VarianceReport>({
    queryKey: ["/api/budget-plans", selectedBudgetPlan?.id, "variance"],
    queryFn: () => apiRequest("GET", `/api/budget-plans/${selectedBudgetPlan?.id}/variance`),
    enabled: !!selectedBudgetPlan?.id,
  });

  const { data: cashFlowForecast, isLoading: cashFlowForecastLoading } =
    useQuery<CashFlowForecastReport>({
      queryKey: ["/api/companies", selectedCompanyId, "cashflow", "forecast", 90],
      queryFn: () =>
        apiRequest("GET", `/api/companies/${selectedCompanyId}/cashflow/forecast?days=90`),
      enabled: !!selectedCompanyId,
    });

  const { data: balanceSummaries, isLoading: balanceSummariesLoading } =
    useQuery<BalanceSummaryReport>({
      queryKey: ["/api/companies", selectedCompanyId, "reports", "balance-summaries"],
      queryFn: () =>
        apiRequest("GET", `/api/companies/${selectedCompanyId}/reports/balance-summaries`),
      enabled: !!selectedCompanyId,
    });

  const { data: fixedAssets = [], isLoading: fixedAssetsLoading } = useQuery<FixedAssetReportRow[]>(
    {
      queryKey: ["/api/companies", selectedCompanyId, "fixed-assets"],
      queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/fixed-assets`),
      enabled: !!selectedCompanyId,
    }
  );

  const { data: fixedAssetSummary, isLoading: fixedAssetSummaryLoading } =
    useQuery<FixedAssetSummaryReport>({
      queryKey: ["/api/companies", selectedCompanyId, "fixed-assets", "summary"],
      queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/fixed-assets/summary`),
      enabled: !!selectedCompanyId,
    });

  const { data: inventoryProducts = [], isLoading: inventoryProductsLoading } = useQuery<
    InventoryProductReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "products"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/products`),
    enabled: !!selectedCompanyId,
  });

  const { data: inventoryMovements = [], isLoading: inventoryMovementsLoading } = useQuery<
    InventoryMovementReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "inventory-movements"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/inventory-movements`),
    enabled: !!selectedCompanyId,
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
    const isBalanced = (trialBalance?.totals.difference ?? 0) < 0.005;
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
      const customerName = invoice.customerName || "Unknown Customer";
      const summary = summaries.get(customerName) ?? {
        customerName,
        invoiceCount: 0,
        amountAed: 0,
      };
      summary.invoiceCount += 1;
      summary.amountAed += amountInAed(invoice);
      summaries.set(customerName, summary);
    }
    return Array.from(summaries.values())
      .sort((a, b) => b.amountAed - a.amountAed)
      .slice(0, 8);
  }, [reportInvoices]);

  const overdueRows = useMemo(() => overdueReport?.rows ?? [], [overdueReport?.rows]);
  const productServiceSalesRows = useMemo(
    () => salesProductServiceReport?.rows ?? [],
    [salesProductServiceReport?.rows]
  );
  const topProductServiceSalesRow = productServiceSalesRows[0];
  const productServiceTopShare = salesProductServiceReport?.totals.topProductServiceShare ?? 0;

  const overdueCustomerRows = useMemo<OverdueCustomerRow[]>(() => {
    const summaries = new Map<string, OverdueCustomerRow>();
    for (const row of overdueRows) {
      const customerName = row.invoice.customerName || "Unknown Customer";
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
    return Array.from(summaries.values())
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 8);
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

    return {
      rows,
      activeRows,
      productCount: rows.length,
      activeProductCount: activeRows.length,
      totalUnits: activeRows.reduce((sum, row) => sum + row.currentStock, 0),
      totalStockValueAed: activeRows.reduce((sum, row) => sum + row.stockValueAed, 0),
      lowStockCount,
      negativeStockCount,
      missingCostCount,
      movementCount: inventoryMovements.length,
      reviewCount: lowStockCount + negativeStockCount + missingCostCount,
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
          productName: product?.name ?? "Unknown product",
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
    const capitalizationReviewCount = activeRows.filter(
      (asset) => asset.needs_capitalization_je
    ).length;
    const depreciationReviewCount = activeRows.filter(
      (asset) =>
        asset.category !== "Land" &&
        Number(asset.useful_life_years ?? 0) > 0 &&
        asset.netBookValue > asset.salvageValue + 0.005
    ).length;

    return {
      rows,
      activeRows,
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
      capitalizationReviewCount,
      depreciationReviewCount,
      reviewCount: capitalizationReviewCount + depreciationReviewCount,
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

  const buildExpenseSummary = useCallback(
    (getLabel: (receipt: ReceiptReportRow) => string) => {
      const summaries = new Map<string, ExpenseSummaryRow>();
      for (const receipt of reportReceipts) {
        const label = getLabel(receipt);
        const summary = summaries.get(label) ?? {
          label,
          receiptCount: 0,
          subtotalAed: 0,
          vatAed: 0,
          totalAed: 0,
          unpostedCount: 0,
          autoPostedCount: 0,
        };
        const subtotalAed = receiptSubtotalAed(receipt);
        const vatAed = receiptVatAed(receipt);
        summary.receiptCount += 1;
        summary.subtotalAed += subtotalAed;
        summary.vatAed += vatAed;
        summary.totalAed += subtotalAed + vatAed;
        if (!receipt.posted) summary.unpostedCount += 1;
        if (receipt.autoPosted) summary.autoPostedCount += 1;
        summaries.set(label, summary);
      }
      return Array.from(summaries.values()).sort((a, b) => b.totalAed - a.totalAed);
    },
    [reportReceipts]
  );

  const expenseByVendor = useMemo(
    () => buildExpenseSummary((receipt) => receipt.merchant || "Unknown Merchant").slice(0, 8),
    [buildExpenseSummary]
  );

  const expenseByCategory = useMemo(
    () => buildExpenseSummary((receipt) => receipt.category || "Uncategorized").slice(0, 8),
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
    const subtotalAed = reportReceipts.reduce(
      (sum, receipt) => sum + receiptSubtotalAed(receipt),
      0
    );
    const vatAed = reportReceipts.reduce((sum, receipt) => sum + receiptVatAed(receipt), 0);
    const unpostedReceipts = reportReceipts.filter((receipt) => !receipt.posted).length;
    const autoPostedReceipts = reportReceipts.filter((receipt) => receipt.autoPosted).length;
    return {
      receiptCount: reportReceipts.length,
      subtotalAed,
      vatAed,
      totalAed: subtotalAed + vatAed,
      unpostedReceipts,
      autoPostedReceipts,
      byVendor: expenseByVendor,
      byCategory: expenseByCategory,
      receipts: reportReceipts,
      claims: expenseClaimReport,
    };
  }, [expenseByCategory, expenseByVendor, expenseClaimReport, reportReceipts]);

  const expensesLoading = receiptsLoading || expenseClaimsLoading || expenseClaimSummaryLoading;

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
    const currentReceipts = receipts.filter((receipt) =>
      receiptInDateRange(receipt, comparisonCurrentRange)
    );
    const previousReceipts = receipts.filter((receipt) =>
      receiptInDateRange(receipt, comparisonPreviousRange)
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
    const currentExpenseValue = currentReceipts.reduce(
      (sum, receipt) => sum + receiptSubtotalAed(receipt) + receiptVatAed(receipt),
      0
    );
    const previousExpenseValue = previousReceipts.reduce(
      (sum, receipt) => sum + receiptSubtotalAed(receipt) + receiptVatAed(receipt),
      0
    );
    const currentPayrollValue = currentPayrollRuns.reduce(
      (sum, run) => sum + payrollAmount(run.total_net),
      0
    );
    const previousPayrollValue = previousPayrollRuns.reduce(
      (sum, run) => sum + payrollAmount(run.total_net),
      0
    );
    const currentInventoryMovementValue = currentInventoryMovements.reduce(
      (sum, movement) => sum + inventoryMovementValue(movement),
      0
    );
    const previousInventoryMovementValue = previousInventoryMovements.reduce(
      (sum, movement) => sum + inventoryMovementValue(movement),
      0
    );
    const ledgerActivityForRange = (range: ComparisonRange) =>
      journalEntries
        .filter((entry) => entry.status === "posted" && valueInDateRange(entry.date, range))
        .reduce(
          (entrySum, entry) =>
            entrySum +
            (entry.lines ?? []).reduce(
              (lineSum, line) =>
                lineSum + Math.max(Number(line.debit) || 0, Number(line.credit) || 0),
              0
            ),
          0
        );
    const currentLedgerActivity = ledgerActivityForRange(comparisonCurrentRange);
    const previousLedgerActivity = ledgerActivityForRange(comparisonPreviousRange);

    return [
      makeComparisonMetric({
        id: "revenue",
        label: "Revenue",
        current: comparisonCurrentProfitLoss?.totalRevenue ?? 0,
        previous: comparisonPreviousProfitLoss?.totalRevenue ?? 0,
        currency: "AED",
        signal: "Growth",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "pl",
      }),
      makeComparisonMetric({
        id: "net-profit",
        label: "Net profit",
        current: comparisonCurrentProfitLoss?.netProfit ?? 0,
        previous: comparisonPreviousProfitLoss?.netProfit ?? 0,
        currency: "AED",
        signal: "Profitability",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "pl",
      }),
      makeComparisonMetric({
        id: "invoice-value",
        label: "Invoice value",
        current: currentInvoiceValue,
        previous: previousInvoiceValue,
        currency: "AED",
        signal: "Sales activity",
        favorable: "increase",
        personas: ["owner", "freelancer", "accountant"],
        tab: "sales",
      }),
      makeComparisonMetric({
        id: "expense-spend",
        label: "Expense spend",
        current: currentExpenseValue,
        previous: previousExpenseValue,
        currency: "AED",
        signal: "Cost pressure",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "expenses",
      }),
      makeComparisonMetric({
        id: "vat-due",
        label: "Net VAT due",
        current: comparisonCurrentVat?.netVATPayable ?? 0,
        previous: comparisonPreviousVat?.netVATPayable ?? 0,
        currency: "AED",
        signal: "Tax cash flow",
        favorable: "decrease",
        personas: ["owner", "freelancer", "accountant"],
        tab: "vat",
      }),
      makeComparisonMetric({
        id: "payroll-cost",
        label: "Payroll cost",
        current: currentPayrollValue,
        previous: previousPayrollValue,
        currency: "AED",
        signal: "Payroll movement",
        favorable: "decrease",
        personas: ["owner", "accountant"],
        tab: "payroll",
      }),
      makeComparisonMetric({
        id: "inventory-movement",
        label: "Inventory movement",
        current: currentInventoryMovementValue,
        previous: previousInventoryMovementValue,
        currency: "AED",
        signal: "Stock movement",
        favorable: "neutral",
        personas: ["owner", "accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "depreciation-estimate",
        label: "Depreciation estimate",
        current: currentDepreciationEstimate,
        previous: previousDepreciationEstimate,
        currency: "AED",
        signal: "Depreciation schedule",
        favorable: "neutral",
        personas: ["accountant"],
        tab: "balances",
      }),
      makeComparisonMetric({
        id: "consolidated-net-profit",
        label: "Consolidated net profit",
        current: consolidatedStatementsReport.currentComparisonNetProfit,
        previous: consolidatedStatementsReport.previousNetProfit,
        currency: "AED",
        signal: "Multi-entity roll-up",
        favorable: "increase",
        personas: ["accountant"],
        tab: "close",
      }),
      makeComparisonMetric({
        id: "ledger-activity",
        label: "Ledger activity",
        current: currentLedgerActivity,
        previous: previousLedgerActivity,
        currency: "AED",
        signal: "Close activity",
        favorable: "neutral",
        personas: ["accountant"],
        tab: "ledger",
      }),
    ];
  }, [
    comparisonCurrentProfitLoss?.netProfit,
    comparisonCurrentProfitLoss?.totalRevenue,
    comparisonCurrentRange,
    comparisonCurrentVat?.netVATPayable,
    comparisonPreviousProfitLoss?.netProfit,
    comparisonPreviousProfitLoss?.totalRevenue,
    comparisonPreviousRange,
    comparisonPreviousVat?.netVATPayable,
    consolidatedStatementsReport.currentComparisonNetProfit,
    consolidatedStatementsReport.previousNetProfit,
    fixedAssetRegisterReport.activeRows,
    invoices,
    inventoryMovements,
    journalEntries,
    payrollRuns,
    receipts,
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
    comparisonCurrentVatLoading ||
    comparisonPreviousVatLoading ||
    consolidatedStatementsLoading ||
    invoicesLoading ||
    journalLoading ||
    receiptsLoading;

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
      : "Latest 200 activity events";

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
    const largestVarianceLines = [...varianceLines]
      .sort((a, b) => Math.abs(b.totals.variance) - Math.abs(a.totals.variance))
      .slice(0, 8);

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
        ? "Negative cash risk"
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
    planningLoading;

  const automationQueue = useMemo<AutomationQueueItem[]>(() => {
    const vatNet = vatSummary?.netVATPayable ?? 0;
    const corporateTaxPayable = corporateTaxEstimate?.taxPayable ?? 0;
    const closeReviewCount = ledgerReport.reviewEntries + (trialBalanceSummary.isBalanced ? 0 : 1);
    const planningRiskCount =
      (planningReport.cashWarning === "On track" ? 0 : 1) + planningReport.overBudgetLines;

    return [
      {
        id: "collections",
        title: "Collections follow-up",
        signal: "Overdue customers",
        detail: "Route overdue receivables into payment chasing.",
        count: balanceReport.overdueCustomerCount,
        amount: balanceReport.customerOverdueAed,
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: Users,
        actionLabel: "Open queue",
        href: "/payment-chasing",
      },
      {
        id: "bill-pay",
        title: "Bill pay timing",
        signal: "Overdue vendors",
        detail: "Review vendor balances and payable timing.",
        count: balanceReport.overdueVendorCount,
        amount: balanceReport.vendorOverdueAed,
        currency: "AED",
        personas: ["owner", "accountant"],
        icon: Wallet,
        actionLabel: "Open bills",
        href: "/bill-pay?tab=summary",
      },
      {
        id: "inventory-risk",
        title: "Inventory valuation",
        signal:
          inventoryValuationReport.reviewCount > 0 ? "Stock review items" : "Inventory valued",
        detail:
          inventoryValuationReport.reviewCount > 0
            ? `${inventoryValuationReport.reviewCount} products need stock, reorder, or costing review.`
            : `${inventoryValuationReport.activeProductCount} active products valued for the balance report.`,
        count: inventoryValuationReport.reviewCount,
        amount: inventoryValuationReport.totalStockValueAed,
        currency: "AED",
        personas: ["owner", "accountant"],
        icon: FileSpreadsheet,
        actionLabel: "Open inventory",
        href: "/inventory",
      },
      {
        id: "inventory-movement-review",
        title: "Inventory movement",
        signal:
          inventoryMovementReport.movementCount > 0 ? "Stock movement posted" : "No stock movement",
        detail:
          inventoryMovementReport.reorderSignalCount > 0
            ? `${inventoryMovementReport.reorderSignalCount} products need reorder or negative-stock review after recent movement.`
            : `${inventoryMovementReport.movementCount} movements across ${inventoryMovementReport.productCount} products in this period.`,
        count: inventoryMovementReport.reorderSignalCount,
        amount: inventoryMovementReport.outboundValueAed,
        currency: "AED",
        personas: ["owner", "accountant"],
        icon: FileSpreadsheet,
        actionLabel: "Open movements",
        href: "/inventory",
      },
      {
        id: "fixed-asset-review",
        title: "Fixed asset register",
        signal:
          fixedAssetRegisterReport.reviewCount > 0 ? "Asset review items" : "Asset register ready",
        detail:
          fixedAssetRegisterReport.capitalizationReviewCount > 0
            ? `${fixedAssetRegisterReport.capitalizationReviewCount} assets need capitalization journal review.`
            : `${fixedAssetRegisterReport.totalAssets} active assets with depreciation and NBV tracked.`,
        count: fixedAssetRegisterReport.reviewCount,
        amount: fixedAssetRegisterReport.totalNetBookValue,
        currency: "AED",
        personas: ["owner", "accountant"],
        icon: Building2,
        actionLabel: "Open fixed assets",
        href: "/fixed-assets",
      },
      {
        id: "depreciation-posting",
        title: "Depreciation schedule",
        signal:
          depreciationScheduleReport.reviewCount > 0
            ? "Depreciation setup review"
            : "Depreciation ready",
        detail:
          depreciationScheduleReport.reviewCount > 0
            ? `${depreciationScheduleReport.reviewCount} assets need useful-life, date, or cost review before posting.`
            : `${depreciationScheduleReport.readyToPostCount} assets have ${monthEndPeriodLabel} depreciation suggestions.`,
        count: depreciationScheduleReport.readyToPostCount + depreciationScheduleReport.reviewCount,
        amount: depreciationScheduleReport.periodDepreciationAed,
        currency: "AED",
        personas: ["accountant"],
        icon: FileSpreadsheet,
        actionLabel: "Open fixed assets",
        href: "/fixed-assets",
      },
      {
        id: "receipt-posting",
        title: "Receipt posting",
        signal: "Receipts waiting",
        detail: "Clear OCR and posting exceptions before close.",
        count: expenseReport.unpostedReceipts,
        personas: ["owner", "freelancer", "accountant"],
        icon: FileSpreadsheet,
        actionLabel: "Open expenses",
        tab: "expenses",
      },
      {
        id: "expense-claims-review",
        title: "Expense claims",
        signal: expenseClaimReport.reviewCount > 0 ? "Claim queue open" : "Expense claims clear",
        detail:
          expenseClaimReport.submittedCount > 0
            ? `${expenseClaimReport.submittedCount} submitted claims need approval.`
            : expenseClaimReport.approvedUnpaidCount > 0
              ? `${expenseClaimReport.approvedUnpaidCount} approved claims are awaiting reimbursement.`
              : "No claims are pending approval or reimbursement.",
        count: expenseClaimReport.reviewCount,
        amount: expenseClaimReport.submittedAmount + expenseClaimReport.approvedUnpaidAmount,
        currency: "AED",
        personas: ["owner", "accountant"],
        icon: ClipboardCheck,
        actionLabel: "Open claims",
        href: "/expense-claims",
      },
      {
        id: "payroll-wps-review",
        title: "Payroll and WPS",
        signal:
          payrollReport.approvalQueueCount > 0 || payrollReport.wpsMissingCount > 0
            ? "Payroll action needed"
            : "Payroll ready",
        detail:
          payrollReport.approvalQueueCount > 0
            ? `${payrollReport.approvalQueueCount} calculated payroll runs need approval.`
            : payrollReport.wpsMissingCount > 0
              ? `${payrollReport.wpsMissingCount} payroll runs need SIF generation.`
              : `${payrollReport.runCount} payroll runs are summarized for owner and accountant review.`,
        count: payrollReport.approvalQueueCount + payrollReport.wpsMissingCount,
        amount: payrollReport.totalNet,
        currency: "AED",
        personas: ["owner", "accountant"],
        icon: DollarSign,
        actionLabel: "Open payroll",
        href: "/payroll",
      },
      {
        id: "vat-readiness",
        title: "VAT readiness",
        signal: vatNet >= 0 ? "VAT payable" : "VAT refund",
        detail: "Check the filing amount and supporting VAT reports.",
        count: Math.abs(vatNet) > 0.005 ? 1 : 0,
        amount: Math.abs(vatNet),
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: FileText,
        actionLabel: "Open filing",
        href: "/vat-filing",
      },
      {
        id: "sales-mix",
        title: "Sales mix concentration",
        signal: topProductServiceSalesRow
          ? `${topProductServiceSalesRow.productService} leads sales`
          : "No line-item sales",
        detail: "Review product/service concentration before forecasting or pricing changes.",
        count: productServiceTopShare >= 50 ? 1 : 0,
        amount: topProductServiceSalesRow?.amountAed ?? 0,
        currency: "AED",
        personas: ["owner", "accountant"],
        icon: BarChart3,
        actionLabel: "Open sales mix",
        tab: "sales",
      },
      {
        id: "corporate-tax",
        title: "Corporate tax estimate",
        signal: corporateTaxPayable > 0.005 ? "Tax payable" : "No current tax due",
        detail: "Review the Corporate Tax estimate and update the workpaper before draft filing.",
        count: corporateTaxPayable > 0.005 ? 1 : 0,
        amount: Math.max(0, corporateTaxPayable),
        currency: "AED",
        personas: ["owner", "accountant"],
        icon: Scale,
        actionLabel: "Open estimate",
        tab: "tax",
      },
      {
        id: "close-review",
        title: "Close review",
        signal: "Review items",
        detail: "Inspect trial-balance differences and manual ledger sources.",
        count: closeReviewCount,
        personas: ["accountant"],
        icon: ClipboardCheck,
        actionLabel: "Open ledger",
        tab: closeReviewCount > 0 && !trialBalanceSummary.isBalanced ? "trial" : "ledger",
      },
      {
        id: "month-end-close",
        title: "Month-end close status",
        signal: "Close checklist",
        detail:
          monthEndReviewChecks > 0
            ? `${monthEndReviewChecks} close checks need review for ${monthEndPeriodLabel}.`
            : `${monthEndPeriodLabel} close checklist is complete.`,
        count: monthEndReviewChecks,
        personas: ["accountant"],
        icon: ClipboardCheck,
        actionLabel: "Open close status",
        tab: "close",
      },
      {
        id: "audit-trail-review",
        title: "Audit trail",
        signal: auditTrailReport.highRiskCount > 0 ? "High-risk activity" : "Activity log reviewed",
        detail:
          auditTrailReport.highRiskCount > 0
            ? `${auditTrailReport.highRiskCount} delete, void, reject, or error events need reviewer attention.`
            : `${auditTrailReport.logCount} activity events summarized for reviewer evidence.`,
        count: auditTrailReport.highRiskCount,
        personas: ["accountant"],
        icon: FileText,
        actionLabel: "Open history",
        href: "/history",
      },
      {
        id: "consolidated-statements-review",
        title: "Consolidated statements",
        signal:
          consolidatedStatementsReport.reviewCount > 0
            ? "Consolidation review"
            : "Multi-entity roll-up ready",
        detail:
          consolidatedStatementsReport.reviewCount > 0
            ? `${consolidatedStatementsReport.reviewCount} entity, balance, or FX checks need review before pack delivery.`
            : `${consolidatedStatementsReport.loadedEntityCount} entities rolled up with no eliminations applied.`,
        count: consolidatedStatementsReport.reviewCount,
        amount: Math.abs(consolidatedStatementsReport.netProfit),
        currency: "AED",
        personas: ["accountant"],
        icon: FileSpreadsheet,
        actionLabel: "Open consolidation",
        tab: "close",
      },
      {
        id: "planning-risk",
        title: "Planning guardrails",
        signal: "Budget and cash alerts",
        detail: "Review cash warnings and budget variance outliers.",
        count: planningRiskCount,
        amount: Math.abs(planningReport.variance),
        currency: "AED",
        personas: ["owner", "freelancer", "accountant"],
        icon: AlertTriangle,
        actionLabel: "Open planning",
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
            ? (reportHref(primaryReport) ?? reportAutomationTriggerRuleHref(rule))
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
    enabled: !!selectedCompanyId,
  });

  const reportDeliveryAutomationPreferencesQuery = useQuery<{
    preferences: ReportDeliveryAutomationPreferenceResponse[];
  }>({
    queryKey: ["/api/companies", selectedCompanyId, "report-delivery", "preferences"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-delivery/preferences`),
    enabled: !!selectedCompanyId,
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
    enabled: !!selectedCompanyId,
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
    enabled: !!selectedCompanyId,
  });

  const latestReportDeliverySchedulerScan =
    reportDeliverySchedulerHealthQuery.data?.latestScan ?? null;
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
              summary: `${subscription.format} to ${subscription.recipients} through ${subscription.channel}.`,
              readinessLabel: "Catalog preview",
              checklist: [
                {
                  label: "Reports",
                  status: readyCount === reports.length ? "ready" : "review",
                  detail: `${readyCount}/${reports.length} reports ready for this pack.`,
                },
                {
                  label: "Guardrail",
                  status: "ready",
                  detail: subscription.deliveryGuardrail,
                },
              ],
              reportNames: reports.map((report) => report.name),
              triggerRuleTitles: triggerRules.map((rule) => rule.title),
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
          label: packTemplate ? "Pack" : "No pack",
          detail: packTemplate?.title ?? "No report pack template covers this workflow yet.",
          variant: packTemplate ? ("success" as const) : ("outline" as const),
        },
        {
          id: "schedule",
          label: deliverySubscription ? "Scheduled" : "No schedule",
          detail: deliverySubscription?.cadence ?? "No scheduled report send covers this workflow.",
          variant: deliverySubscription ? ("info" as const) : ("outline" as const),
        },
        {
          id: "alert",
          label: triggerRule ? "Alert rule" : "No alert",
          detail: triggerRule?.title ?? "No automation trigger rule covers this workflow yet.",
          variant: triggerRule
            ? triggerSeverityMeta[triggerRule.severity].variant
            : ("outline" as const),
        },
        {
          id: "delivery",
          label: deliverySubscription ? "Delivery" : "No delivery",
          detail: deliverySubscription
            ? `${deliverySubscription.channel} · ${deliverySubscription.format}`
            : "No delivery path covers this workflow yet.",
          variant: deliverySubscription?.statusVariant ?? ("outline" as const),
        },
      ];
    };

    const reportResults = filteredReports.map((report) => {
      const reportPersona =
        personaFilter === "all" ? (report.personas[0] ?? "owner") : personaFilter;
      const status = reportStatusMeta[report.status];
      return {
        id: `report-${report.id}`,
        type: "Report",
        title: report.name,
        description: report.decisionQuestion,
        meta: `${report.category} · ${report.comparison}`,
        href:
          report.href ??
          (report.tab
            ? reportsHref({ tab: report.tab, persona: reportPersona })
            : reportsHref({ persona: reportPersona })),
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
      badgeVariant: triggerSeverityMeta[rule.severity].variant,
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
      ...automationStarterResults,
      ...deliveryResults,
      ...triggerRuleResults,
      ...decisionShortcutResults,
    ];
  }, [
    filteredReports,
    personaFilter,
    reportAutomationTriggerRuleSummaries,
    reportDeliverySubscriptionSummaries,
    reportPackTemplateSummaries,
    visibleReportAutomationStarters,
    visibleReportAutomationTriggerRules,
    visibleReportComparisonPresets,
    visibleReportDecisionShortcuts,
    visibleReportDeliverySubscriptions,
    visibleReportPackTemplates,
  ]);

  const reportWorkflowFinderResults = useMemo(() => {
    if (normalizedReportWorkflowSearch) return allReportWorkflowFinderResults.slice(0, 12);

    const preferredTypes = ["Report", "Pack", "Comparison", "Automation", "Delivery", "Question"];
    return preferredTypes
      .flatMap((type) =>
        allReportWorkflowFinderResults.filter((result) => result.type === type).slice(0, 2)
      )
      .slice(0, 12);
  }, [allReportWorkflowFinderResults, normalizedReportWorkflowSearch]);

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
            label: "Retry latest failed delivery",
            detail: `${latestFailedRun.subscriptionTitle} failed ${formatDeliveryRunTimestamp(latestFailedRun.createdAt)}. Retry after confirming recipients and guardrails are still valid.`,
            runId: latestFailedRun.id,
            badge: "Recovery",
            badgeVariant: "destructive" as const,
          }
        : firstReviewSubscription
          ? {
              kind: "open" as const,
              label: "Review delivery guardrails",
              detail: `${firstReviewSubscription.title} needs review before the next automated send.`,
              href: firstReviewSubscription.href,
              badge: "Review",
              badgeVariant: "warning" as const,
            }
          : {
              kind: "ready" as const,
              label: "Keep scheduled sends running",
              detail:
                visibleReportDeliverySubscriptions.length > 0
                  ? `${visibleReportDeliverySubscriptions.length} delivery subscriptions are ready for this view.`
                  : "No delivery subscriptions match this view yet.",
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

  const reportDeliveryLauncherPreviewById = useMemo(() => {
    return reportDeliverySubscriptionSummaries.reduce<Record<string, ReportLaunchDeliveryPreview>>(
      (previews, subscription) => {
        const latestRun = subscription.latestDeliveryRun;
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
              ? (latestRun.errorMessage ?? "Retry after fixing delivery settings or guardrails.")
              : null,
          queueDisabled: !subscription.enabled,
        };
        return previews;
      },
      {}
    );
  }, [reportDeliverySubscriptionSummaries]);

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
        roadmapStatus: workspace.plannedReports.length > 0 ? "Roadmap gaps" : "Coverage complete",
        nextWorkflow:
          nextReports.length > 0
            ? (reportHref(nextReports[0]) ?? reportWorkspaceHref(workspace))
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
          detail: `${row.signal}: ${formatComparisonPercent(row.percentChange)} vs prior period`,
          badge: "Movement",
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
          badge: reportStatusMeta[workspace.topReadyReport.status].label,
          badgeVariant: reportStatusMeta[workspace.topReadyReport.status].variant,
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
          label: "Report data refreshed",
          detail: `${workspace.readyReports} ready/API-backed reports for ${workspace.title}.`,
          status: workspace.readyReports > 0 ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "comparison-snapshot",
          label: "Comparison snapshot attached",
          detail: `${packComparisonRows.length} current-vs-prior signals in the pack.`,
          status: packComparisonRows.length > 0 ? "Ready" : "Review",
          workflow: reportsHref({ tab: workspace.primaryTab, persona: workspace.persona }),
        },
        {
          id: "recommended-actions",
          label: "Recommended actions ranked",
          detail: `${recommendationCount} next-best report actions included.`,
          status: recommendationCount > 0 ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "automation-review",
          label: "Automation exceptions reviewed",
          detail:
            pack.openWorkItemCount > 0
              ? `${pack.openWorkItemCount} open work items before delivery.`
              : "No open automation work items.",
          status: pack.openWorkItemCount > 0 ? "Review" : "Ready",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "delivery-cadence",
          label: "Delivery cadence configured",
          detail: workspace.packSchedule.cadence,
          status: workspace.packSchedule.cadence ? "Ready" : "Review",
          workflow: reportWorkspaceHref(workspace),
        },
        {
          id: "recipients",
          label: "Recipients configured",
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
              label: "Recover failed delivery",
              detail: `${failedRunCount} failed report delivery run${
                failedRunCount === 1 ? "" : "s"
              } can be retried after guardrails are fixed.`,
              href: reportSectionHref(workspace, "delivery-subscriptions"),
              badge: "Recovery",
              badgeVariant: "danger" as const,
            }
          : deliveryIssueCount > 0
            ? {
                label: "Review delivery setup",
                detail: `${deliveryIssueCount} delivery subscription${
                  deliveryIssueCount === 1 ? "" : "s"
                } need setup, guardrail review, or enablement before auto-send.`,
                href: reportSectionHref(workspace, "delivery-subscriptions"),
                badge: "Delivery",
                badgeVariant: "warning" as const,
              }
            : openWorkItemCount > 0
              ? {
                  label: "Clear automation queue",
                  detail: `${openWorkItemCount} open work item${
                    openWorkItemCount === 1 ? "" : "s"
                  } should be resolved before scheduled packs are sent.`,
                  href: reportSectionHref(workspace, "automation-command-center"),
                  badge: "Work queue",
                  badgeVariant: "warning" as const,
                }
              : comparisonWarnings > 0
                ? {
                    label: "Review comparison movement",
                    detail: `${comparisonWarnings} comparison signal${
                      comparisonWarnings === 1 ? "" : "s"
                    } need a note before the next pack delivery.`,
                    href: reportSectionHref(workspace, "recommendations"),
                    badge: "Movement",
                    badgeVariant: "warning" as const,
                  }
                : {
                    label: "Keep automation running",
                    detail: `${readyRuleCount}/${automationRules.length} auto-send rules and ${readyDeliveryCount}/${deliverySubscriptions.length} deliveries are ready.`,
                    href: reportSectionHref(workspace, "automation-command-center"),
                    badge: "Ready",
                    badgeVariant: "success" as const,
                  };

      const status =
        failedRunCount > 0
          ? "Delivery recovery"
          : deliveryIssueCount > 0 || openWorkItemCount > 0 || comparisonWarnings > 0
            ? "Needs review"
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
      const subscriptionTitle = result?.subscription?.title ?? "Report delivery";
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
            ? "Report delivery enabled"
            : "Report delivery paused"
          : "Report delivery settings saved",
        description: `${subscriptionTitle} now uses company delivery settings.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not update report delivery",
        description: error?.message || "Failed to update report delivery settings",
        variant: "destructive",
      });
    },
  });

  const queueReportDeliverySubscription = useMutation({
    mutationFn: (subscriptionId: string) => {
      if (!selectedCompanyId) throw new Error("Select a company before queuing delivery.");
      return apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/report-delivery/subscriptions/${subscriptionId}/queue`
      );
    },
    onSuccess: (result: any) => {
      reportDeliveryPlansQuery.refetch();
      reportDeliveryRunsQuery.refetch();
      reportDeliverySchedulerHealthQuery.refetch();
      const subscriptionTitle = result?.subscription?.title ?? "Report delivery";
      const nextRunLabel = result?.subscription?.nextRunLabel;
      toast({
        title: "Report delivery queued",
        description: nextRunLabel
          ? `${subscriptionTitle} queued for ${nextRunLabel}.`
          : `${subscriptionTitle} queued as an in-app reminder.`,
      });
    },
    onError: (error: any) => {
      reportDeliveryRunsQuery.refetch();
      reportDeliverySchedulerHealthQuery.refetch();
      toast({
        title: "Could not queue report delivery",
        description: error?.message || "Failed to queue report delivery",
        variant: "destructive",
      });
    },
  });

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
      const subscriptionTitle = result?.subscription?.title ?? "Report delivery";
      toast({
        title: "Report delivery retry queued",
        description: `${subscriptionTitle} was requeued after recovery.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not retry report delivery",
        description: error?.message || "Failed to retry report delivery",
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
      if (!reportIds.some((reportId) => workspaceReportIds.has(reportId))) return;
      reportIds.forEach((reportId) => workbookReportIds.add(reportId));
      workbookSheets.push(...(Array.isArray(sheets) ? sheets : [sheets]));
    };

    addSheets(["profit-loss"], prepareProfitLossForExport(profitLoss));
    addSheets(["balance-sheet"], prepareBalanceSheetForExport(balanceSheet));
    addSheets(["vat-summary"], prepareVATSummaryForExport(vatSummary));
    addSheets(
      ["corporate-tax-estimate"],
      prepareCorporateTaxEstimateForExport(corporateTaxEstimate)
    );
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
    const operationsWorkflow = reportSectionHref(workspace, "automation-operations");
    const commandCenterWorkflow = reportSectionHref(workspace, "automation-command-center");
    const deliveryWorkflow = reportSectionHref(workspace, "delivery-subscriptions");

    const packIndex: ExportData = {
      sheetName: "Pack Index",
      columns: [
        { header: "Report", key: "report", width: 32 },
        { header: "Decision Question", key: "decisionQuestion", width: 58 },
        { header: "Status", key: "status", width: 14 },
        { header: "Comparison", key: "comparison", width: 24 },
        { header: "Automation", key: "automation", width: 28 },
        { header: "Delivery", key: "delivery", width: 22 },
        { header: "Workflow", key: "workflow", width: 40 },
      ],
      rows: workspace.reports.map((report) => ({
        report: report.name,
        decisionQuestion: report.decisionQuestion,
        status: reportStatusMeta[report.status].label,
        comparison: report.comparison,
        automation: report.automation,
        delivery: workbookReportIds.has(report.id) ? "Included in workbook" : "Open workflow",
        workflow: reportHref(report) ?? reportWorkspaceHref(workspace),
      })),
    };

    const operationsControl: ExportData = {
      sheetName: "Operations Control",
      columns: [
        { header: "Field", key: "field", width: 34 },
        { header: "Value", key: "value", width: 70 },
        { header: "Workflow", key: "workflow", width: 48 },
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

    const packSummary: ExportData = {
      sheetName: "Pack Summary",
      columns: [
        { header: "Metric", key: "metric", width: 34 },
        { header: "Value", key: "value", width: 80 },
      ],
      rows: [
        { metric: "Workspace", value: workspace.title },
        { metric: "Persona", value: workspace.persona },
        { metric: "Pack automation outcome", value: workspace.automationOutcome },
        { metric: "Current period", value: comparisonCurrentLabel },
        { metric: "Prior period", value: comparisonPreviousLabel },
        {
          metric: "Pack status",
          value: openPackSignals.length > 0 ? "Review before send" : "Ready to send",
        },
        {
          metric: "Operations status",
          value: packOperations?.status ?? "Not available",
        },
        {
          metric: "Operations next action",
          value: packOperations?.nextAction.label ?? "Not available",
        },
        { metric: "Workspace reports", value: workspace.reports.length },
        { metric: "Ready reports", value: workspace.readyReports },
        { metric: "Coverage categories", value: packCoverageMap.length },
        { metric: "Decision shortcuts", value: packDecisionShortcuts.length },
        { metric: "Automation starters", value: packAutomationStarters.length },
        { metric: "Trigger rules", value: packTriggerRules.length },
        { metric: "Delivery subscriptions", value: packDeliverySubscriptions.length },
        { metric: "Pack templates", value: packTemplates.length },
        { metric: "Planned report gaps", value: packRoadmap?.plannedReportCount ?? 0 },
        { metric: "Roadmap prerequisites", value: packRoadmap?.prerequisiteCount ?? 0 },
        { metric: "Roadmap status", value: packRoadmap?.roadmapStatus ?? "Not available" },
        {
          metric: "Top roadmap priority",
          value: packRoadmap?.topPriorityReport
            ? `${packRoadmap.topPriorityReport.name} (${packRoadmap.topPriorityScore})`
            : "Not available",
        },
        { metric: "Workbook sheets", value: workbookSheets.length },
        { metric: "Comparison metrics", value: packComparisonRows.length },
        { metric: "Comparison presets", value: packComparisonPresets.length },
        { metric: "Recommended actions", value: packRecommendations.length },
        { metric: "Auto-send coverage", value: `${packAutoSendCoveragePercent}%` },
        { metric: "Ready auto-send rules", value: packReadyAutomationRules },
        { metric: "Rules needing review", value: packReviewAutomationRules },
        { metric: "Setup-needed rules", value: packSetupAutomationRules },
        { metric: "Delivery checks", value: packReadiness?.checks.length ?? 0 },
        { metric: "Checks needing review", value: packReadiness?.reviewCount ?? 0 },
        {
          metric: "Automation health",
          value: packReadiness
            ? `${packReadiness.automationHealth.score}/100 - ${packReadiness.automationHealth.label}`
            : "Not available",
        },
        {
          metric: "Automation health review signals",
          value: packReadiness?.automationHealth.reviewSignals ?? 0,
        },
        {
          metric: "Automation health trend",
          value: packHealthTrend
            ? `${packHealthTrend.label} (${packHealthTrend.detail})`
            : "Not available",
        },
        { metric: "Open automation signals", value: openPackSignals.length },
        { metric: "Open work items", value: openPackWorkItemCount },
        { metric: "Amount at risk", value: `AED ${packAmountAtRisk.toFixed(2)}` },
      ],
    };

    const coverageMap: ExportData = {
      sheetName: "Coverage Map",
      columns: [
        { header: "Category", key: "category", width: 24 },
        { header: "Reports", key: "reports", width: 14 },
        { header: "Live", key: "live", width: 10 },
        { header: "API Ready", key: "apiReady", width: 12 },
        { header: "Planned", key: "planned", width: 12 },
        { header: "Workbook Sheets", key: "workbookSheets", width: 16 },
        { header: "Comparison Types", key: "comparisonTypes", width: 58 },
        { header: "Automation Hooks", key: "automationHooks", width: 72 },
        { header: "Personas", key: "personas", width: 30 },
        { header: "Report List", key: "reportList", width: 72 },
        { header: "Decision Questions", key: "decisionQuestions", width: 90 },
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
        { header: "Template", key: "template", width: 34 },
        { header: "Audience", key: "audience", width: 42 },
        { header: "Outcome", key: "outcome", width: 70 },
        { header: "Cadence", key: "cadence", width: 34 },
        { header: "Delivery", key: "delivery", width: 38 },
        { header: "Reports", key: "reports", width: 72 },
        { header: "Ready Reports", key: "readyReports", width: 16 },
        { header: "Categories", key: "categories", width: 34 },
        { header: "Comparison Focus", key: "comparisonFocus", width: 58 },
        { header: "Automation Trigger", key: "automationTrigger", width: 70 },
        { header: "Workflow", key: "workflow", width: 42 },
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
        { header: "Question", key: "question", width: 46 },
        { header: "Answer", key: "answer", width: 80 },
        { header: "Primary Report", key: "primaryReport", width: 30 },
        { header: "Reports", key: "reports", width: 72 },
        { header: "Comparison Preset", key: "comparisonPreset", width: 36 },
        { header: "Automation Starter", key: "automationStarter", width: 38 },
        { header: "Report Workflow", key: "reportWorkflow", width: 42 },
        { header: "Shortcut Workflow", key: "shortcutWorkflow", width: 42 },
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
        { header: "Starter", key: "starter", width: 34 },
        { header: "Audience", key: "audience", width: 42 },
        { header: "Outcome", key: "outcome", width: 72 },
        { header: "Setup Time", key: "setupTime", width: 18 },
        { header: "Trigger", key: "trigger", width: 60 },
        { header: "Ready Reports", key: "readyReports", width: 16 },
        { header: "Reports", key: "reports", width: 72 },
        { header: "Playbooks", key: "playbooks", width: 56 },
        { header: "Queue Signals", key: "queueSignals", width: 56 },
        { header: "Open Work Items", key: "openWorkItemCount", width: 18 },
        { header: "Amount At Risk", key: "amountAtRisk", width: 18 },
        { header: "Setup Steps", key: "setupSteps", width: 72 },
        { header: "Primary Action", key: "primaryAction", width: 28 },
        { header: "Workflow", key: "workflow", width: 42 },
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
        { header: "Rule", key: "rule", width: 34 },
        { header: "Severity", key: "severity", width: 16 },
        { header: "Condition", key: "condition", width: 70 },
        { header: "Threshold", key: "threshold", width: 74 },
        { header: "Cadence", key: "cadence", width: 42 },
        { header: "Reports", key: "reports", width: 72 },
        { header: "Decision Shortcut", key: "decisionShortcut", width: 42 },
        { header: "Automation Starter", key: "automationStarter", width: 42 },
        { header: "Open Work Items", key: "openWorkItemCount", width: 18 },
        { header: "Amount At Risk", key: "amountAtRisk", width: 18 },
        { header: "Action", key: "action", width: 28 },
        { header: "Workflow", key: "workflow", width: 42 },
      ],
      rows: packTriggerRules.map((rule) => ({
        rule: rule.title,
        severity: triggerSeverityMeta[rule.severity].label,
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
        { header: "Subscription", key: "subscription", width: 38 },
        { header: "Audience", key: "audience", width: 42 },
        { header: "Cadence", key: "cadence", width: 54 },
        { header: "Channel", key: "channel", width: 36 },
        { header: "Format", key: "format", width: 32 },
        { header: "Recipients", key: "recipients", width: 58 },
        { header: "Pack Template", key: "packTemplate", width: 38 },
        { header: "Ready Reports", key: "readyReports", width: 16 },
        { header: "Trigger Rules", key: "triggerRules", width: 64 },
        { header: "Open Work Items", key: "openWorkItemCount", width: 18 },
        { header: "Amount At Risk", key: "amountAtRisk", width: 18 },
        { header: "Delivery Guardrail", key: "deliveryGuardrail", width: 78 },
        { header: "Workflow", key: "workflow", width: 42 },
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
        { header: "Priority", key: "priority", width: 12 },
        { header: "Action", key: "action", width: 32 },
        { header: "Trigger", key: "trigger", width: 60 },
        { header: "Signal", key: "signal", width: 20 },
        { header: "Amount", key: "amount", width: 18 },
        { header: "Workflow", key: "workflow", width: 40 },
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
        { header: "Report", key: "report", width: 32 },
        { header: "Status", key: "status", width: 18 },
        { header: "Priority Score", key: "priorityScore", width: 16 },
        { header: "Persona Impact", key: "personaImpact", width: 18 },
        { header: "Priority Rationale", key: "priorityRationale", width: 56 },
        { header: "Category", key: "category", width: 24 },
        { header: "Comparison", key: "comparison", width: 28 },
        { header: "Automation Unlock", key: "automation", width: 34 },
        { header: "Data Source Needed", key: "dataSource", width: 46 },
        { header: "Workflow Dependency", key: "workflowDependency", width: 50 },
        { header: "Automation Rule Needed", key: "automationRule", width: 50 },
        { header: "Workflow", key: "workflow", width: 40 },
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
          status: reportStatusMeta[report.status].label,
          priorityScore: report.roadmapPriority?.score ?? "",
          personaImpact: report.roadmapPriority?.impactByPersona[workspace.persona] ?? "",
          priorityRationale: report.roadmapPriority?.rationale ?? "",
          category: report.category,
          comparison: report.comparison,
          automation: report.automation,
          dataSource: report.roadmapPrerequisites?.dataSource ?? "",
          workflowDependency: report.roadmapPrerequisites?.workflowDependency ?? "",
          automationRule: report.roadmapPrerequisites?.automationRule ?? "",
          workflow: reportHref(report) ?? reportWorkspaceHref(workspace),
        })),
    };

    const automationCommandCenter: ExportData = {
      sheetName: "Automation Command Center",
      columns: [
        { header: "Metric", key: "metric", width: 34 },
        { header: "Value", key: "value", width: 80 },
      ],
      rows: [
        { metric: "Workspace", value: workspace.title },
        { metric: "Persona", value: workspace.persona },
        { metric: "Automation outcome", value: workspace.automationOutcome },
        { metric: "Total automation rules", value: packAutomationRules.length },
        { metric: "Delivery subscriptions", value: packDeliverySubscriptions.length },
        { metric: "Ready auto-send rules", value: packReadyAutomationRules },
        { metric: "Rules needing review", value: packReviewAutomationRules },
        { metric: "Setup-needed rules", value: packSetupAutomationRules },
        { metric: "Auto-send coverage", value: `${packAutoSendCoveragePercent}%` },
        { metric: "Open rule work items", value: packRuleOpenWorkItemCount },
        { metric: "Rule amount at risk", value: `AED ${packRuleAmountAtRisk.toFixed(2)}` },
        { metric: "Comparison metrics linked", value: packRuleComparisonMetricCount },
        { metric: "Report bundle coverage", value: packRuleReportBundleCount },
        {
          metric: "Pack delivery status",
          value: packReadiness?.status ?? "Not available",
        },
        {
          metric: "Pack checks needing review",
          value: packReadiness?.reviewCount ?? 0,
        },
      ],
    };

    const automationHealth: ExportData = {
      sheetName: "Automation Health",
      columns: [
        { header: "Metric", key: "metric", width: 34 },
        { header: "Value", key: "value", width: 42 },
      ],
      rows: packReadiness
        ? [
            { metric: "Workspace", value: workspace.title },
            {
              metric: "Score",
              value: `${packReadiness.automationHealth.score}/100`,
            },
            { metric: "Status", value: packReadiness.automationHealth.label },
            {
              metric: "Pack readiness score",
              value: `${packReadiness.automationHealth.readinessScore}/100`,
            },
            {
              metric: "Automation lane score",
              value: `${packReadiness.automationHealth.automationLaneScore}/100`,
            },
            {
              metric: "Comparison signal score",
              value: `${packReadiness.automationHealth.comparisonScore}/100`,
            },
            {
              metric: "Comparison warnings",
              value: packReadiness.automationHealth.comparisonWarnings,
            },
            {
              metric: "Review signals",
              value: packReadiness.automationHealth.reviewSignals,
            },
          ]
        : [],
    };

    const automationHealthTrend: ExportData = {
      sheetName: "Automation Health Trend",
      columns: [
        { header: "Metric", key: "metric", width: 34 },
        { header: "Value", key: "value", width: 52 },
      ],
      rows: packHealthTrend
        ? [
            { metric: "Workspace", value: workspace.title },
            { metric: "Trend", value: packHealthTrend.label },
            { metric: "Current score", value: packHealthTrend.currentScore },
            {
              metric: "Previous score",
              value: packHealthTrend.previousScore ?? "Baseline",
            },
            { metric: "Delta", value: packHealthTrend.delta },
            { metric: "Detail", value: packHealthTrend.detail },
            {
              metric: "Previous captured at",
              value: packHealthTrend.previousCapturedAt ?? "",
            },
          ]
        : [],
    };

    const deliveryChecklist: ExportData = {
      sheetName: "Delivery Checklist",
      columns: [
        { header: "Check", key: "check", width: 34 },
        { header: "Status", key: "status", width: 18 },
        { header: "Detail", key: "detail", width: 70 },
        { header: "Workflow", key: "workflow", width: 40 },
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
        { header: "Metric", key: "metric", width: 28 },
        { header: "Signal", key: "signal", width: 22 },
        { header: "Current", key: "current", width: 18 },
        { header: "Prior", key: "prior", width: 18 },
        { header: "Change", key: "change", width: 18 },
        { header: "Change %", key: "changePercent", width: 16 },
        { header: "Status", key: "status", width: 18 },
        { header: "Workflow", key: "workflow", width: 40 },
      ],
      rows: packComparisonRows.map((row) => {
        const status =
          Math.abs(row.delta) < 0.005
            ? "Stable"
            : row.favorable === "neutral"
              ? "Context"
              : (row.favorable === "increase" ? row.delta > 0 : row.delta < 0)
                ? "Favorable"
                : "Review";

        return {
          metric: row.label,
          signal: row.signal,
          current: `${row.currency} ${row.current.toFixed(2)}`,
          prior: `${row.currency} ${row.previous.toFixed(2)}`,
          change: `${row.currency} ${row.delta.toFixed(2)}`,
          changePercent: formatComparisonPercent(row.percentChange),
          status,
          workflow: reportsHref({ tab: row.tab, persona: workspace.persona }),
        };
      }),
    };

    const comparisonPresetsSheet: ExportData = {
      sheetName: "Comparison Presets",
      columns: [
        { header: "Preset", key: "preset", width: 34 },
        { header: "Question", key: "question", width: 70 },
        { header: "Baseline", key: "baseline", width: 56 },
        { header: "Metrics", key: "metrics", width: 56 },
        { header: "Warnings", key: "warnings", width: 12 },
        { header: "Reports", key: "reports", width: 72 },
        { header: "Automation Trigger", key: "automationTrigger", width: 70 },
        { header: "Workflow", key: "workflow", width: 42 },
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
        { header: "Playbook", key: "playbook", width: 34 },
        { header: "Trigger", key: "trigger", width: 42 },
        { header: "Cadence", key: "cadence", width: 38 },
        { header: "Recipients", key: "recipients", width: 42 },
        { header: "Reports", key: "reports", width: 60 },
        { header: "Rule Status", key: "status", width: 24 },
        { header: "Open Work Items", key: "openWorkItemCount", width: 18 },
        { header: "Amount At Risk", key: "amountAtRisk", width: 18 },
        { header: "Comparison Metrics", key: "comparisonMetricCount", width: 20 },
        { header: "Action", key: "action", width: 24 },
        { header: "Workflow", key: "workflow", width: 40 },
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
        { header: "Signal", key: "signal", width: 26 },
        { header: "Detail", key: "detail", width: 54 },
        { header: "Open Count", key: "count", width: 14 },
        { header: "Amount", key: "amount", width: 18 },
        { header: "Status", key: "status", width: 20 },
        { header: "Workflow", key: "workflow", width: 40 },
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
        { header: "Field", key: "field", width: 24 },
        { header: "Value", key: "value", width: 80 },
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
        title: "Report pack exported",
        description: `${workspace.title} exported to Excel.`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: error?.message || "Failed to export report pack",
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
        title: "Report pack exported",
        description: `${workspace.title} exported to Google Sheets. Opening...`,
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, "_blank");
      }
    } else {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: result?.error || "Failed to export report pack to Google Sheets",
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
      toast({ title: "Export successful", description: "Profit & Loss exported to Excel" });
    } else if (activeTab === "bs" && balanceSheet) {
      exportToExcel([prepareBalanceSheetForExport(balanceSheet)], `balance_sheet${dateRangeStr}`);
      toast({ title: "Export successful", description: "Balance Sheet exported to Excel" });
    } else if (activeTab === "vat" && vatSummary) {
      exportToExcel([prepareVATSummaryForExport(vatSummary)], `vat_summary${dateRangeStr}`);
      toast({ title: "Export successful", description: "VAT Summary exported to Excel" });
    } else if (activeTab === "tax" && corporateTaxEstimate) {
      exportToExcel(
        prepareCorporateTaxEstimateForExport(corporateTaxEstimate),
        `corporate_tax_estimate${dateRangeStr}`
      );
      toast({
        title: "Export successful",
        description: "Corporate Tax Estimate exported to Excel",
      });
    } else if (activeTab === "trial" && trialBalance) {
      exportToExcel([prepareTrialBalanceForExport(trialBalance)], `trial_balance${dateRangeStr}`);
      toast({ title: "Export successful", description: "Trial Balance exported to Excel" });
    } else if (activeTab === "sales") {
      exportToExcel(
        prepareInvoiceStatusForExport(invoiceStatusReport),
        `invoice_status${dateRangeStr}`
      );
      toast({ title: "Export successful", description: "Invoice Status exported to Excel" });
    } else if (activeTab === "balances") {
      exportToExcel(
        prepareBalanceSummaryReportsForExport(balanceReport),
        `balance_reports${dateRangeStr}`
      );
      toast({ title: "Export successful", description: "Balance reports exported to Excel" });
    } else if (activeTab === "expenses") {
      exportToExcel(
        prepareExpenseReportsForExport(expenseReport),
        `expense_reports${dateRangeStr}`
      );
      toast({ title: "Export successful", description: "Expense reports exported to Excel" });
    } else if (activeTab === "payroll") {
      exportToExcel(
        preparePayrollReportsForExport(payrollReport),
        `payroll_reports${dateRangeStr}`
      );
      toast({ title: "Export successful", description: "Payroll reports exported to Excel" });
    } else if (activeTab === "ledger") {
      exportToExcel(prepareLedgerReportsForExport(ledgerReport), `general_ledger${dateRangeStr}`);
      toast({ title: "Export successful", description: "General Ledger exported to Excel" });
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
        title: "Export successful",
        description: "Close reports exported to Excel",
      });
    } else if (activeTab === "planning") {
      exportToExcel(
        preparePlanningReportsForExport(planningReport),
        `planning_reports${dateRangeStr}`
      );
      toast({ title: "Export successful", description: "Planning reports exported to Excel" });
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
        prepareInvoiceStatusForExport(invoiceStatusReport),
        `Invoice Status${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "balances") {
      result = await exportToGoogleSheets(
        prepareBalanceSummaryReportsForExport(balanceReport),
        `Balance Reports${dateRangeStr}`,
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
        title: "Export successful",
        description: "Report exported to Google Sheets. Opening...",
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, "_blank");
      }
    } else {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: result?.error || "Failed to export to Google Sheets",
      });
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Insights"
        title={t.reports}
        description="Financial reports, comparisons, and automation-ready workspaces"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={isExporting} data-testid="button-export">
                <Download className="w-4 h-4 mr-2" />
                {isExporting ? "Exporting..." : t.export}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportExcel} data-testid="menu-export-excel">
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Export to Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportGoogleSheets} data-testid="menu-export-sheets">
                <SiGooglesheets className="w-4 h-4 mr-2" />
                Export to Google Sheets
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <section className="space-y-3" aria-labelledby="role-focus-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="role-focus-title" className="text-xl font-semibold">
              Role focus
            </h2>
            <p className="text-sm text-muted-foreground">{personaScopeDescription}</p>
          </div>
          <Badge variant={personaFilter === "all" ? "outline" : "info"}>{personaFilterLabel}</Badge>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Reporting role focus">
          {personaFilters.map((filter) => (
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
      </section>

      <section
        className="space-y-4"
        aria-labelledby="report-workflow-readiness-title"
        data-testid="report-workflow-readiness"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-workflow-readiness-title" className="text-xl font-semibold">
              Automation readiness
            </h2>
            <p className="text-sm text-muted-foreground">
              Role-specific coverage gaps before report packs, alerts, and delivery automations run.
            </p>
          </div>
          <Badge variant={reportAutomationOperationsNeedingReview > 0 ? "warning" : "success"} dot>
            {reportAutomationOperationsNeedingReview > 0
              ? `${reportAutomationOperationsNeedingReview} need review`
              : "Ready by role"}
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
                    {item.readyReportCount}/{item.reportCount} reports ready
                  </div>
                </div>
                <Badge variant={item.statusVariant} dot>
                  {item.status}
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">Score</div>
                  <div className="mt-1 font-mono text-base font-semibold">
                    {item.automationScore}%
                  </div>
                </div>
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">Rules</div>
                  <div className="mt-1 font-mono text-base font-semibold">
                    {item.readyRuleCount}/{item.automationRuleCount}
                  </div>
                </div>
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">Delivery</div>
                  <div className="mt-1 font-mono text-base font-semibold">
                    {item.readyDeliveryCount}/{item.deliverySubscriptionCount}
                  </div>
                </div>
              </div>

              <div
                className="mt-3 text-xs text-muted-foreground"
                data-testid={`report-workflow-readiness-gap-${item.workspace.persona}`}
              >
                {item.reportGapCount} report gaps · {item.automationRuleGapCount} rule gaps ·{" "}
                {item.deliveryGapCount} delivery gaps
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
        className="space-y-4"
        aria-labelledby="report-workflow-finder-title"
        id="report-workflow-finder"
        data-testid="report-workflow-finder"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="report-workflow-finder-title" className="text-xl font-semibold">
              Workflow finder
            </h2>
            <p className="text-sm text-muted-foreground">
              Reports, packs, comparisons, delivery routes, and automations for{" "}
              {personaFilterLabel.toLowerCase()}.
            </p>
          </div>
          <Badge variant="info" dot data-testid="report-workflow-finder-count">
            {allReportWorkflowFinderResults.length} matches
          </Badge>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={reportWorkflowSearch}
              onChange={(event) => updateReportWorkflowSearch(event.target.value)}
              placeholder="Search reports, packs, comparisons, automations"
              className="pl-9"
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
              Clear
            </Button>
          ) : null}
        </div>

        {reportWorkflowFinderResults.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {reportWorkflowFinderResults.map((result) => (
              <Link key={result.id} href={result.href}>
                <div
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
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div
            className="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
            data-testid="report-workflow-finder-empty"
          >
            No report workflows match the current role and search.
          </div>
        )}
      </section>

      <section
        className="space-y-4"
        aria-labelledby="report-catalog-readiness-title"
        data-testid="reports-catalog-discovery-summary"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-catalog-readiness-title" className="text-xl font-semibold">
              Catalog readiness
            </h2>
            <p className="text-sm text-muted-foreground">
              API-synced report library coverage for high-level reports, comparison packs, delivery
              subscriptions, and automation starters. {personaScopeDescription}
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
              ? "Syncing catalog"
              : reportCatalogDiscoveryQuery.isError
                ? "Local catalog fallback"
                : "Catalog synced"}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Reports ready</div>
            <div className="mt-1 font-mono text-2xl font-semibold">
              {reportStats.ready}/{reportStats.total}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {reportStats.live} live · {reportStats.planned} planned
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Pack templates</div>
            <div className="mt-1 font-mono text-2xl font-semibold">{reportStats.packTemplates}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {reportStats.deliverySubscriptions} delivery subscriptions
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Comparison presets</div>
            <div className="mt-1 font-mono text-2xl font-semibold">
              {reportStats.comparisonPresets}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Current-vs-prior review paths</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Automation starters</div>
            <div className="mt-1 font-mono text-2xl font-semibold">
              {reportStats.automationStarters}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {reportStats.automationPlaybooks} playbooks
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
                      <div className="text-muted-foreground">Packs</div>
                      <div className="mt-1 font-mono font-semibold">
                        {workspace.packTemplateCount}
                      </div>
                    </div>
                    <div className="rounded-md bg-secondary/40 p-2">
                      <div className="text-muted-foreground">Comps</div>
                      <div className="mt-1 font-mono font-semibold">
                        {workspace.comparisonPresetCount}
                      </div>
                    </div>
                    <div className="rounded-md bg-secondary/40 p-2">
                      <div className="text-muted-foreground">Starters</div>
                      <div className="mt-1 font-mono font-semibold">
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

      <section className="space-y-4" aria-labelledby="report-automation-operations-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-automation-operations-title" className="text-xl font-semibold">
              Report automation operations
            </h2>
            <p className="text-sm text-muted-foreground">
              One operating view for report readiness, auto-send rules, delivery recovery, and next
              actions across owner, freelancer, and accountant workspaces. {personaScopeDescription}
            </p>
          </div>
          <Badge variant={reportAutomationOperationsNeedingReview > 0 ? "warning" : "success"} dot>
            {reportAutomationOperationsNeedingReview} need action
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
                        <div className="text-xs text-muted-foreground">Health</div>
                        <div className="mt-1 flex items-baseline gap-1">
                          <span className="font-mono text-lg font-semibold">
                            {item.automationScore}
                          </span>
                          <span className="text-xs text-muted-foreground">/100</span>
                        </div>
                        <Badge variant={item.automationHealthVariant} dot className="mt-2">
                          Automation
                        </Badge>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">Reports ready</div>
                        <div className="mt-1 font-mono text-lg font-semibold">
                          {item.readyReportCount}/{item.reportCount}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {item.recommendationCount} recommended actions
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">Auto-send rules</div>
                        <div className="mt-1 font-mono text-lg font-semibold">
                          {item.readyRuleCount}/{item.automationRuleCount}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {item.openWorkItemCount} open work items
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">Deliveries ready</div>
                        <div className="mt-1 font-mono text-lg font-semibold">
                          {item.readyDeliveryCount}/{item.deliverySubscriptionCount}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {item.failedRunCount} failed runs
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-medium uppercase text-muted-foreground">
                          Next action
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
                          <Link href={item.nextAction.href}>Open action</Link>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={personaFilter === workspace.persona ? "default" : "ghost"}
                          onClick={() => setReportPersonaFilter(workspace.persona)}
                        >
                          Set focus
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-muted/30 p-2">
                        <div className="text-muted-foreground">Amount at risk</div>
                        <div className="mt-1 truncate font-mono font-semibold text-foreground">
                          {formatCurrency(item.amountAtRisk, "AED", locale)}
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/30 p-2">
                        <div className="text-muted-foreground">Comparison warnings</div>
                        <div className="mt-1 font-mono font-semibold text-foreground">
                          {item.comparisonWarnings}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={reportSectionHref(workspace, "automation-command-center")}>
                          Open command center
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={reportSectionHref(workspace, "delivery-subscriptions")}>
                          Open delivery
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

      <section className="space-y-4" aria-labelledby="decision-shortcuts-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="decision-shortcuts-title" className="text-xl font-semibold">
              Decision shortcuts
            </h2>
            <p className="text-sm text-muted-foreground">
              Business questions that route owners, freelancers, and accountants to the right
              reports, comparisons, and automation starter. {personaScopeDescription}
            </p>
          </div>
          <Badge variant="info" dot>
            {visibleReportDecisionShortcuts.length} questions
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
                      <div className="text-muted-foreground">Primary report</div>
                      <div className="mt-1 font-medium text-foreground">
                        {shortcut.primaryReport.name}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-muted-foreground">Report bundle</div>
                      <div className="mt-1 font-mono text-base font-semibold">
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
                        <span className="font-medium text-foreground">Comparison:</span>{" "}
                        {shortcut.comparisonPreset.title}
                      </div>
                    ) : null}
                    {shortcut.automationStarter ? (
                      <div>
                        <span className="font-medium text-foreground">Automation:</span>{" "}
                        {shortcut.automationStarter.title}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link href={shortcut.primaryReportHref}>Open report</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={shortcut.comparisonHref}>Open comparison</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={shortcut.automationHref}>Open automation</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="automation-starters-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="automation-starters-title" className="text-xl font-semibold">
              Automation starters
            </h2>
            <p className="text-sm text-muted-foreground">
              Persona-specific setup paths for turning report packs, comparisons, and open queues
              into automated workflows. {personaScopeDescription}
            </p>
          </div>
          <Badge variant="info" dot>
            {visibleReportAutomationStarters.length} starters
          </Badge>
        </div>

        <div
          className="grid grid-cols-2 gap-2 text-xs lg:grid-cols-5"
          data-testid="report-delivery-scheduler-health"
        >
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-muted-foreground">Last scan</div>
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
                {latestReportDeliverySchedulerScan?.status ?? "pending"}
              </Badge>
            </div>
            <div className="mt-1 font-medium text-foreground">
              {formatDeliveryRunTimestamp(latestReportDeliverySchedulerScan?.finishedAt)}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">Queued by scan</div>
            <div className="mt-1 font-mono text-base font-semibold">
              {latestReportDeliverySchedulerScan?.queuedRuns ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">Guardrail skips</div>
            <div className="mt-1 font-mono text-base font-semibold">
              {reportDeliverySchedulerGuardrailSkips}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">Actor skips</div>
            <div className="mt-1 font-mono text-base font-semibold">
              {latestReportDeliverySchedulerScan?.skippedNoActor ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">Scan errors</div>
            <div className="mt-1 font-mono text-base font-semibold">
              {latestReportDeliverySchedulerScan?.errors ?? 0}
            </div>
          </div>
        </div>

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
                          ? `${starter.openWorkItemCount} open`
                          : "Ready"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">{starter.outcome}</p>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Setup</div>
                        <div className="font-medium text-foreground">{starter.setupTime}</div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Ready reports</div>
                        <div className="font-mono text-base font-semibold">
                          {starter.readyCount}/{starter.reports.length}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Playbooks</div>
                        <div className="font-mono text-base font-semibold">
                          {starter.playbooks.length}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">At risk</div>
                        <div className="truncate font-mono text-sm font-semibold">
                          {formatCurrency(starter.amountAtRisk, "AED", locale)}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Trigger:</span>{" "}
                      {starter.trigger}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        Setup checklist
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
                        Filter workspace
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="trigger-rules-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="trigger-rules-title" className="text-xl font-semibold">
              Trigger rules
            </h2>
            <p className="text-sm text-muted-foreground">
              Report-driven thresholds that route cash, tax, close, and advisory signals into
              automation. {personaScopeDescription}
            </p>
          </div>
          <Badge variant="info" dot>
            {visibleReportAutomationTriggerRules.length} rules
          </Badge>
        </div>

        {automationLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {visibleReportAutomationTriggerRules.map((rule) => {
              const WorkspaceIcon = rule.workspace.icon;
              const severity = triggerSeverityMeta[rule.severity];

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
                        <span className="font-medium text-foreground">Threshold:</span>{" "}
                        {rule.threshold}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Cadence</div>
                        <div className="mt-1 font-medium text-foreground">{rule.cadence}</div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Open work</div>
                        <div className="mt-1 font-mono text-base font-semibold">
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
                          <span className="font-medium text-foreground">Question:</span>{" "}
                          {rule.decisionShortcut.question}
                        </div>
                      ) : null}
                      {rule.automationStarter ? (
                        <div>
                          <span className="font-medium text-foreground">Automation:</span>{" "}
                          {rule.automationStarter.title}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link href={rule.primaryReportHref}>{rule.actionLabel}</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={rule.decisionShortcutHref}>Open question</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={rule.automationStarterHref}>Open automation</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="report-delivery-subscriptions-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-delivery-subscriptions-title" className="text-xl font-semibold">
              Delivery subscriptions
            </h2>
            <p className="text-sm text-muted-foreground">
              Scheduled report packs that define cadence, recipients, channel, and guardrails before
              auto-send. {personaScopeDescription}
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
            {visibleReportDeliverySubscriptions.length} subscriptions
          </Badge>
        </div>

        <ReportLaunchPicker
          persona={reportDeliveryLauncherPersona}
          mode="delivery"
          onQueueDeliverySubscription={(subscriptionId) =>
            queueReportDeliverySubscription.mutate(subscriptionId)
          }
          onRetryDeliveryRun={(runId) => retryReportDeliveryRun.mutate(runId)}
          queueingDeliverySubscriptionId={
            queueReportDeliverySubscription.isPending
              ? (queueReportDeliverySubscription.variables ?? null)
              : null
          }
          retryingDeliveryRunId={
            retryReportDeliveryRun.isPending ? (retryReportDeliveryRun.variables ?? null) : null
          }
          deliveryQueueDisabled={!selectedCompanyId || queueReportDeliverySubscription.isPending}
          deliveryRetryDisabled={!selectedCompanyId || retryReportDeliveryRun.isPending}
          deliverySubscriptionPreviewById={reportDeliveryLauncherPreviewById}
          preferredDeliveryAutomationCommand={pinnedReportDeliveryAutomationCommand}
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
                Automation recovery
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Failed delivery recovery and review queue for the current{" "}
                {personaFilterLabel.toLowerCase()} reporting view.
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
              <div className="text-muted-foreground">Failed runs</div>
              <div className="mt-1 font-mono text-base font-semibold text-foreground">
                {reportDeliveryRecoverySummary.failedRunCount}
              </div>
            </div>
            <div
              className="rounded-md bg-secondary/40 p-2"
              data-testid="report-delivery-recovery-retryable-subscriptions"
            >
              <div className="text-muted-foreground">Retryable subscriptions</div>
              <div className="mt-1 font-mono text-base font-semibold text-foreground">
                {reportDeliveryRecoverySummary.retryableSubscriptionCount}
              </div>
            </div>
            <div
              className="rounded-md bg-secondary/40 p-2"
              data-testid="report-delivery-recovery-review-subscriptions"
            >
              <div className="text-muted-foreground">Needs review</div>
              <div className="mt-1 font-mono text-base font-semibold text-foreground">
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
                Retry latest
              </Button>
            ) : reportDeliveryRecoverySummary.nextAction.kind === "open" ? (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={reportDeliveryRecoverySummary.nextAction.href}
                  data-testid="report-delivery-recovery-open-review"
                >
                  Open review
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
              <div className="text-sm font-semibold text-foreground">Automation command strip</div>
              <p className="mt-1 text-xs text-muted-foreground">
                One-click recovery, guardrail review, delivery queueing, and comparison paths for{" "}
                {personaFilterLabel.toLowerCase()} workflows.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={pinnedReportDeliveryAutomationCommand ? "success" : "neutral"}
                dot
                data-testid="report-delivery-command-pinned"
              >
                {pinnedReportDeliveryAutomationCommand
                  ? `Pinned: ${reportDeliveryAutomationCommandLabels[pinnedReportDeliveryAutomationCommand]}`
                  : "No pinned command"}
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
                  Retry recovery
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
                Requeue the latest failed scheduled report pack.
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
                Retry now
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
                  Review guardrails
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
                Open the first delivery needing setup, enablement, or review.
              </div>
              {reportDeliveryAutomationCommandTargets.reviewSubscription ? (
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link
                    href={reportDeliveryAutomationCommandTargets.reviewSubscription.href}
                    data-testid="report-delivery-command-review"
                  >
                    Open review
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
                  No review
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
                  Queue next pack
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
                Queue the next enabled delivery subscription for this role.
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
                  queueReportDeliverySubscription.mutate(subscriptionId);
                }}
                data-testid="report-delivery-command-queue"
              >
                Queue pack
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
                  Open comparison
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
                Review the highest-priority comparison pack for this persona.
              </div>
              {reportDeliveryAutomationCommandTargets.comparisonPreset ? (
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link
                    href={reportDeliveryAutomationCommandTargets.comparisonPreset.href}
                    data-testid="report-delivery-command-comparison"
                  >
                    Open comparison
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
                  No comparison
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
                Delivery run timeline
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Filter queued, sent, and failed report-pack automations within the current{" "}
                {personaFilterLabel.toLowerCase()} view.
              </p>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Delivery run status">
              {reportDeliveryRunStatusFilters.map((filter) => (
                <Button
                  key={filter.id}
                  type="button"
                  size="sm"
                  variant={reportDeliveryRunStatusFilter === filter.id ? "default" : "outline"}
                  onClick={() => setReportDeliveryRunStatusFilter(filter.id)}
                  data-testid={`report-delivery-run-filter-${filter.id}`}
                >
                  {filter.label}
                  <span className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[10px]">
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
                    Scheduled {formatDeliveryRunTimestamp(run.scheduledFor)} -{" "}
                    {run.readyReportCount}/{run.reportCount} reports - {run.channel}
                  </div>
                  {run.errorMessage ? (
                    <div className="mt-1 text-destructive">{run.errorMessage}</div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={run.subscriptionHref}>Open subscription</Link>
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
                        Retry delivery
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
                ? `No delivery runs match this ${personaFilterLabel.toLowerCase()} view yet.`
                : `No ${reportDeliveryRunStatusFilter} delivery runs match this ${personaFilterLabel.toLowerCase()} view yet.`}
            </div>
          )}
        </div>

        {automationLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {visibleReportDeliverySubscriptions.map((subscription) => {
              const WorkspaceIcon = subscription.workspace.icon;
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
                        <div className="text-muted-foreground">Cadence</div>
                        <div className="mt-1 font-medium text-foreground">
                          {subscription.cadence}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Channel</div>
                        <div className="mt-1 font-medium text-foreground">
                          {subscription.channel}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Ready reports</div>
                        <div className="mt-1 font-mono text-base font-semibold">
                          {subscription.readyCount}/{subscription.reports.length}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Open work</div>
                        <div className="mt-1 font-mono text-base font-semibold">
                          {subscription.openWorkItemCount}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Next delivery</div>
                        <div className="mt-1 font-medium text-foreground">
                          {subscription.enabled
                            ? subscription.nextRunLabel || "Calculated on queue"
                            : "Paused"}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Settings</div>
                        <div className="mt-1 font-medium capitalize text-foreground">
                          {subscription.settingsSource}
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
                              Cadence
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
                              Channel
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
                              Format
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
                              Recipients
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
                              Guardrail
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
                            Save delivery settings
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isSavingThisDeliverySubscription}
                            onClick={() => setEditingReportDeliverySubscriptionId(null)}
                          >
                            <X className="h-4 w-4" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border p-3 text-xs text-muted-foreground">
                        <div>
                          <span className="font-medium text-foreground">Format:</span>{" "}
                          {subscription.format}
                        </div>
                        <div className="mt-1">
                          <span className="font-medium text-foreground">Recipients:</span>{" "}
                          {subscription.recipients}
                        </div>
                        <div className="mt-1">
                          <span className="font-medium text-foreground">Guardrail:</span>{" "}
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
                          <div className="font-medium text-foreground">Pack preview</div>
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
                    </div>

                    <div
                      className="rounded-md border p-3 text-xs"
                      data-testid={`report-delivery-run-history-${subscription.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-foreground">Recent delivery runs</div>
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
                                  Scheduled {formatDeliveryRunTimestamp(run.scheduledFor)} -{" "}
                                  {run.readyReportCount}/{run.reportCount} reports - {run.channel}
                                </div>
                                {run.status === "failed" ? (
                                  <div className="mt-1 text-destructive">
                                    {run.errorMessage ??
                                      "Retry after fixing delivery settings or guardrails."}
                                  </div>
                                ) : null}
                                {run.retriedFromRunId ? (
                                  <div className="mt-1 text-muted-foreground">
                                    Requeued from a failed delivery run.
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
                                    Retry delivery
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 rounded-md bg-secondary/40 p-2 text-muted-foreground">
                          No queued delivery runs yet.
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        Trigger rules
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {subscription.triggerRules.map((rule) => (
                          <Badge key={rule.id} variant={triggerSeverityMeta[rule.severity].variant}>
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
                        <Link href={subscription.href}>Open subscription</Link>
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
                        onClick={() => queueReportDeliverySubscription.mutate(subscription.id)}
                      >
                        Queue delivery
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
                          Edit settings
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
                        {subscription.enabled ? "Pause delivery" : "Enable delivery"}
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={subscription.packTemplateHref}>Open pack</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={subscription.automationStarterHref}>Open automation</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="recommended-reports-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="recommended-reports-title" className="text-xl font-semibold">
              Recommended reports
            </h2>
            <p className="text-sm text-muted-foreground">
              Next-best report actions based on open automation queues and current-vs-prior
              movement. {personaScopeDescription}
            </p>
          </div>
          <Badge variant="info" dot>
            {visiblePersonaRecommendations.length} role views
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
                      <Badge variant="outline">{workspace.readyReports} ready</Badge>
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
                              <div className="font-mono text-xs text-muted-foreground">
                                {formatCurrency(recommendation.amount, "AED", locale)}
                              </div>
                            ) : null}
                          </div>

                          {recommendation.href ? (
                            <Button asChild size="sm" variant="outline">
                              <Link href={recommendation.href}>Open</Link>
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => recommendation.tab && setActiveTab(recommendation.tab)}
                            >
                              Open
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

      <section className="space-y-4" aria-labelledby="report-pack-readiness-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-pack-readiness-title" className="text-xl font-semibold">
              Report pack readiness
            </h2>
            <p className="text-sm text-muted-foreground">
              Delivery checks for scheduled packs before they reach owners, freelancers, or
              accountants. {personaScopeDescription}
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
            {visibleReportPackReadiness.reduce((sum, item) => sum + item.reviewCount, 0)} review
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
                          Automation health
                        </div>
                        <div className="mt-1 font-mono text-2xl font-semibold">
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
                        <div className="text-muted-foreground">Pack</div>
                        <div className="font-mono font-semibold">
                          {item.automationHealth.readinessScore}%
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Lanes</div>
                        <div className="font-mono font-semibold">
                          {item.automationHealth.automationLaneScore}%
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Review</div>
                        <div className="font-mono font-semibold">
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
                          <div className="text-xs font-medium">Health trend</div>
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
                          <Link href={check.workflow}>Open</Link>
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

      <section className="space-y-4" aria-labelledby="period-comparison-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="period-comparison-title" className="text-xl font-semibold">
              Period comparison
            </h2>
            <p className="text-sm text-muted-foreground">
              {comparisonCurrentLabel} compared with {comparisonPreviousLabel}.{" "}
              {personaScopeDescription}
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
                ? "Custom range"
                : "Month to date"
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
                      {preset.warningCount > 0 ? `${preset.warningCount} review` : "Clear"}
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
                      <Link href={preset.href}>Open preset</Link>
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
                      <div className="text-xs text-muted-foreground">Current</div>
                      <div className="font-mono text-lg font-semibold">
                        {formatCurrency(row.current, row.currency, locale)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Previous</div>
                      <div className="font-mono text-lg font-semibold">
                        {formatCurrency(row.previous, row.currency, locale)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">Movement</div>
                      <div className="truncate font-mono text-sm font-semibold">
                        {formatCurrency(row.delta, row.currency, locale)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveTab(row.tab)}
                    >
                      Open
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="automation-queues-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="automation-queues-title" className="text-xl font-semibold">
              Automation queues
            </h2>
            <p className="text-sm text-muted-foreground">
              Live report signals routed to the next workflow. {personaScopeDescription}
            </p>
          </div>
          <Badge variant={automationQueueCount > 0 ? "warning" : "success"} dot>
            {automationQueueCount} open
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
                        {hasAction ? "Review" : "Clear"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{item.signal}</div>
                        <div className="font-mono text-2xl font-semibold">{item.count}</div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">Amount</div>
                        <div className="font-mono text-lg font-semibold">
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

      <section className="space-y-4" aria-labelledby="automation-coverage-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="automation-coverage-title" className="text-xl font-semibold">
              Automation coverage
            </h2>
            <p className="text-sm text-muted-foreground">
              Role coverage across live reports, comparison lenses, workflow links, and pack
              cadence. {personaScopeDescription}
            </p>
          </div>
          <Badge variant="info" dot>
            {visibleAutomationCoverage.length} role views
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
                        <div className="text-xs text-muted-foreground">Live reports</div>
                        <div className="font-mono text-lg font-semibold">
                          {item.liveReportCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">Automations</div>
                        <div className="font-mono text-lg font-semibold">
                          {item.automatedSignalCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">Comparisons</div>
                        <div className="font-mono text-lg font-semibold">
                          {item.comparisonTypeCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">Workflows</div>
                        <div className="font-mono text-lg font-semibold">
                          {item.workflowReportCount}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium uppercase text-muted-foreground">
                          Open work
                        </span>
                        <span className="font-mono">
                          {item.openWorkItemCount} items -{" "}
                          {formatCurrency(item.amountAtRisk, "AED", locale)}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        Signal coverage
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
                        <span className="font-medium text-foreground">Pack cadence:</span>{" "}
                        {workspace.packSchedule.cadence}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium text-foreground">Pack automation:</span>{" "}
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
                        Open workspace
                      </Button>
                      <Badge variant="outline">{item.playbookCount} playbooks</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="automation-command-center-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="automation-command-center-title" className="text-xl font-semibold">
              Automation command center
            </h2>
            <p className="text-sm text-muted-foreground">
              Auto-send readiness across report rules, blocker queues, and pack delivery.{" "}
              {personaScopeDescription}
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
            {reportAutomationCommandCenter.autoSendCoveragePercent}% auto-send coverage
          </Badge>
        </div>

        {automationLoading || comparisonLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Card data-testid="automation-command-center">
            <CardHeader className="space-y-3 pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">Auto-send readiness</CardTitle>
                  <CardDescription>
                    Rule coverage and open work before scheduled report packs are sent.
                  </CardDescription>
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
                  {reportAutomationCommandCenter.readyRuleCount}/
                  {reportAutomationCommandCenter.ruleCount} rules ready
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-5">
                {[
                  {
                    label: "Automation rules",
                    value: reportAutomationCommandCenter.ruleCount,
                  },
                  {
                    label: "Ready auto-send",
                    value: reportAutomationCommandCenter.readyRuleCount,
                  },
                  {
                    label: "Need review",
                    value: reportAutomationCommandCenter.reviewRuleCount,
                  },
                  {
                    label: "Setup needed",
                    value: reportAutomationCommandCenter.setupRuleCount,
                  },
                  {
                    label: "Open work",
                    value: reportAutomationCommandCenter.openWorkItemCount,
                  },
                  {
                    label: "Amount at risk",
                    value: formatCurrency(
                      reportAutomationCommandCenter.amountAtRisk,
                      "AED",
                      locale
                    ),
                    className: "text-sm",
                  },
                  {
                    label: "Comparisons linked",
                    value: reportAutomationCommandCenter.comparisonMetricCount,
                  },
                  {
                    label: "Report bundle",
                    value: reportAutomationCommandCenter.reportBundleCount,
                  },
                  {
                    label: "Packs ready",
                    value: reportAutomationCommandCenter.readyPackCount,
                  },
                  {
                    label: "Packs in review",
                    value: reportAutomationCommandCenter.reviewPackCount,
                  },
                ].map((metric) => (
                  <div key={metric.label} className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{metric.label}</div>
                    <div
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
                    Top blockers
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
                            {rule.workspace.title} - {rule.openWorkItemCount} open work items -{" "}
                            {formatCurrency(rule.amountAtRisk, "AED", locale)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {rule.liveReportCount}/{rule.reportCount} reports live with{" "}
                            {rule.comparisonMetricCount} linked comparisons.
                          </div>
                        </div>
                        <Button asChild size="sm" variant="outline">
                          <Link href={rule.targetWorkflow}>{rule.playbook.cta}</Link>
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border p-3 text-sm text-muted-foreground">
                      All visible rules are ready for auto-send when pack delivery runs.
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    Pack delivery readiness
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
                          {item.reviewCount} checks need review - health{" "}
                          {item.automationHealth.score}/100
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

      <section className="space-y-4" aria-labelledby="report-automation-rules-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-automation-rules-title" className="text-xl font-semibold">
              Report automation rules
            </h2>
            <p className="text-sm text-muted-foreground">
              Role-specific pack rules that connect triggers, reports, recipients, and next
              workflows. {personaScopeDescription}
            </p>
          </div>
          <Badge variant={reportAutomationRuleReviewCount > 0 ? "warning" : "success"} dot>
            {reportAutomationRuleReviewCount} need review
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
                        <div className="text-xs text-muted-foreground">Reports</div>
                        <div className="font-mono text-lg font-semibold">
                          {rule.liveReportCount}/{rule.reportCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">Comparisons</div>
                        <div className="font-mono text-lg font-semibold">
                          {rule.comparisonMetricCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">Open work</div>
                        <div className="font-mono text-lg font-semibold">
                          {rule.openWorkItemCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">Amount</div>
                        <div className="truncate font-mono text-sm font-semibold">
                          {formatCurrency(rule.amountAtRisk, "AED", locale)}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3 text-xs text-muted-foreground">
                      <div>
                        <span className="font-medium text-foreground">Trigger:</span>{" "}
                        {rule.playbook.trigger}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium text-foreground">Cadence:</span>{" "}
                        {workspace.packSchedule.cadence}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium text-foreground">Recipients:</span>{" "}
                        {workspace.packSchedule.recipients}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        Report bundle
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
                        Rule signals
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
                              {signal.count > 0 ? signal.count : "Clear"}
                            </Badge>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-md border p-3 text-sm text-muted-foreground">
                          No live exceptions currently map to this rule.
                        </div>
                      )}
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

      <section className="space-y-4" aria-labelledby="report-roadmap-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-roadmap-title" className="text-xl font-semibold">
              Report roadmap
            </h2>
            <p className="text-sm text-muted-foreground">
              Planned report gaps by role, with the automation unlocks each workspace gains next.{" "}
              {personaScopeDescription}
            </p>
          </div>
          <Badge variant={visiblePlannedReportCount > 0 ? "warning" : "success"} dot>
            {visiblePlannedReportCount} planned
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
                      <div className="text-xs text-muted-foreground">Live now</div>
                      <div className="font-mono text-lg font-semibold">{item.liveReportCount}</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Planned</div>
                      <div className="font-mono text-lg font-semibold">
                        {item.plannedReportCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Categories</div>
                      <div className="font-mono text-lg font-semibold">
                        {item.plannedCategories.length}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Prereqs</div>
                      <div className="font-mono text-lg font-semibold">
                        {item.prerequisiteCount}
                      </div>
                    </div>
                  </div>

                  {item.topPriorityReport ? (
                    <div className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-medium uppercase text-muted-foreground">
                            Top roadmap priority
                          </div>
                          <div className="mt-1 text-sm font-medium">
                            {item.topPriorityReport.name}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="warning">{item.topPriorityScore}</Badge>
                          {item.topPriorityImpact ? (
                            <Badge variant={roadmapImpactMeta[item.topPriorityImpact].variant} dot>
                              {roadmapImpactMeta[item.topPriorityImpact].label}
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
                      Next report unlocks
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
                                  <Badge variant={roadmapImpactMeta[impact].variant} dot>
                                    {roadmapImpactMeta[impact].label}
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
                                      Data source:
                                    </span>{" "}
                                    {report.roadmapPrerequisites.dataSource}
                                  </div>
                                  <div>
                                    <span className="font-medium text-foreground">
                                      Workflow dependency:
                                    </span>{" "}
                                    {report.roadmapPrerequisites.workflowDependency}
                                  </div>
                                  <div>
                                    <span className="font-medium text-foreground">
                                      Automation rule:
                                    </span>{" "}
                                    {report.roadmapPrerequisites.automationRule}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <Button asChild size="sm" variant="outline">
                              <Link href={reportHref(report) ?? reportWorkspaceHref(workspace)}>
                                Open area
                              </Link>
                            </Button>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-md border p-3 text-sm text-muted-foreground">
                        All target reports for this workspace are live or API-backed.
                      </div>
                    )}
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Automation unlocks
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(item.plannedAutomationHooks.length > 0
                        ? item.plannedAutomationHooks
                        : ["No planned automation gaps"]
                      ).map((hook) => (
                        <Badge key={hook} variant="outline">
                          {hook}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Workflow dependencies
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(item.plannedWorkflowDependencies.length > 0
                        ? item.plannedWorkflowDependencies
                        : ["No planned workflow dependencies"]
                      ).map((dependency) => (
                        <Badge key={dependency} variant="outline">
                          {dependency}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <Button asChild size="sm" variant="outline">
                    <Link href={item.nextWorkflow}>Open next workflow</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="report-pack-automation-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-pack-automation-title" className="text-xl font-semibold">
              Report pack automation
            </h2>
            <p className="text-sm text-muted-foreground">
              Scheduled workspace packs with live report signals before delivery.{" "}
              {personaScopeDescription}
            </p>
          </div>
          <Badge variant={reportPackReviewCount > 0 ? "warning" : "success"} dot>
            {reportPackReviewCount} need review
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
                      <div className="text-xs text-muted-foreground">Health</div>
                      <div className="font-mono text-lg font-semibold">
                        {automationHealth?.score ?? 0}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Open signals</div>
                      <div className="font-mono text-lg font-semibold">{item.openSignalCount}</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Work items</div>
                      <div className="font-mono text-lg font-semibold">
                        {item.openWorkItemCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Amount</div>
                      <div className="truncate font-mono text-sm font-semibold">
                        {formatCurrency(item.amountAtRisk, "AED", locale)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border p-3 text-xs text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">Delivery:</span>{" "}
                      {workspace.packSchedule.delivery}
                    </div>
                    <div className="mt-1">
                      <span className="font-medium text-foreground">Recipients:</span>{" "}
                      {workspace.packSchedule.recipients}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Report pack readiness
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
                      Live signals
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
                          {signal.count > 0 ? signal.count : "Clear"}
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
                      Open workspace
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isExporting || !selectedCompanyId}
                      onClick={() => handleExportWorkspacePackToSheets(workspace)}
                    >
                      <SiGooglesheets className="mr-2 h-4 w-4" />
                      Send pack
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="comparison-snapshots-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="comparison-snapshots-title" className="text-xl font-semibold">
              Comparison snapshots
            </h2>
            <p className="text-sm text-muted-foreground">
              {comparisonCurrentLabel} vs {comparisonPreviousLabel}. {personaScopeDescription}
            </p>
          </div>
          <Badge variant={personaFilter === "all" ? "outline" : "info"}>
            {personaFilter === "all"
              ? comparisonRanges.isCustom
                ? "Selected range"
                : "Month to date"
              : personaFilterLabel}
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Current vs prior period</CardTitle>
            <CardDescription>
              High-level movement across revenue, profit, sales, spend, and tax cash flow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {comparisonLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[920px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric</TableHead>
                      <TableHead>Signal</TableHead>
                      <TableHead className="text-right">Current</TableHead>
                      <TableHead className="text-right">Prior</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead className="text-right">Open</TableHead>
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
                        <TableCell className="text-right font-mono">
                          {formatCurrency(row.current, row.currency, locale)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(row.previous, row.currency, locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-mono font-medium">
                            {formatCurrency(row.delta, row.currency, locale)}
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
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setActiveTab(row.tab)}
                          >
                            Open
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

      <section className="space-y-4" aria-labelledby="persona-workspaces-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="persona-workspaces-title" className="text-xl font-semibold">
              Workspaces
            </h2>
            <p className="text-sm text-muted-foreground">
              Role-focused report coverage for owners, solo entrepreneurs, freelancers, and
              accountants.
            </p>
          </div>
          <Badge variant="outline">{visibleWorkspaceSummaries.length} roles</Badge>
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
                      {workspace.readyReports} ready
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Reports</div>
                      <div className="font-mono text-lg font-semibold">
                        {workspace.catalogReportCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Ready</div>
                      <div className="font-mono text-lg font-semibold">
                        {workspace.readyReports}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Automations</div>
                      <div className="font-mono text-lg font-semibold">
                        {workspace.automationCount}
                      </div>
                    </div>
                  </div>

                  <div
                    className="grid grid-cols-3 gap-2 text-xs"
                    data-testid={`report-workspace-catalog-metadata-${workspace.persona}`}
                  >
                    <div className="rounded-md border p-3">
                      <div className="text-muted-foreground">Packs</div>
                      <div className="mt-1 font-mono text-base font-semibold">
                        {workspace.packTemplateCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-muted-foreground">Comparisons</div>
                      <div className="mt-1 font-mono text-base font-semibold">
                        {workspace.comparisonPresetCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-muted-foreground">Starters</div>
                      <div className="mt-1 font-mono text-base font-semibold">
                        {workspace.automationStarterCount}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">Readiness</span>
                      <span className="font-mono">{workspace.readiness}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${workspace.readiness}%` }}
                      />
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Primary signal</div>
                    <div className="text-sm font-medium">{workspace.topReadyReport?.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {workspace.topReadyReport?.automation}
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Automation outcome
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {workspace.automationOutcome}
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Report pack cadence
                    </div>
                    <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                      <div>
                        <span className="font-medium text-foreground">Cadence:</span>{" "}
                        {workspace.packSchedule.cadence}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Delivery:</span>{" "}
                        {workspace.packSchedule.delivery}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Automation:</span>{" "}
                        {workspace.packSchedule.automation}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Automation playbooks
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
                                Trigger: {playbook.trigger}
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
                      Open reports
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={reportSectionHref(workspace, "automation-command-center")}
                        data-testid={`button-open-automation-center-${workspace.persona}`}
                      >
                        Open automations
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setReportPersonaFilter(workspace.persona)}
                    >
                      Filter library
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isExporting}
                      onClick={() => handleExportWorkspacePack(workspace)}
                      data-testid={`button-export-workspace-pack-${workspace.persona}`}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Export pack
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isExporting || !selectedCompanyId}
                      onClick={() => handleExportWorkspacePackToSheets(workspace)}
                      data-testid={`button-export-workspace-pack-sheets-${workspace.persona}`}
                    >
                      <SiGooglesheets className="mr-2 h-4 w-4" />
                      Sheets pack
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="report-pack-templates-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-pack-templates-title" className="text-xl font-semibold">
              Report pack templates
            </h2>
            <p className="text-sm text-muted-foreground">
              Ready-made packs for recurring owner, freelancer, and accountant decisions.
            </p>
          </div>
          <Badge variant="outline">{visibleReportPackTemplates.length} templates</Badge>
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
                      <div className="font-medium text-foreground">Cadence</div>
                      <div className="mt-1 text-muted-foreground">{template.cadence}</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="font-medium text-foreground">Ready reports</div>
                      <div className="mt-1 font-mono text-base font-semibold">
                        {template.readyCount}/{template.reports.length}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">Comparisons:</span>{" "}
                      {template.comparisonFocus}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Automation:</span>{" "}
                      {template.automationTrigger}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Delivery:</span>{" "}
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
                      <Link href={template.href}>Open template</Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setReportPersonaFilter(template.persona)}
                    >
                      Filter library
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="report-center-title">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-center-title" className="text-xl font-semibold">
              Report center
            </h2>
            <p className="text-sm text-muted-foreground">
              {reportStats.ready} ready/API-backed reports from a {reportStats.total}-report target
              catalog.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Report persona filter">
            {personaFilters.map((filter) => (
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
                Inline reports
              </CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-semibold">{reportStats.live}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Ready/API-backed
              </CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-semibold">{reportStats.ready}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Target catalog
              </CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-semibold">{reportStats.total}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Report coverage map</CardTitle>
                <CardDescription>
                  Category-level view of report depth, comparison coverage, and automation hooks.
                </CardDescription>
              </div>
              <Badge variant="outline">{reportCoverageMap.length} categories</Badge>
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
                          {coverage.reports.length} reports for {coverage.personas.join(", ")}
                        </div>
                      </div>
                      <Badge variant={coverage.plannedCount > 0 ? "warning" : "success"} dot>
                        {readyCount} ready
                      </Badge>
                    </div>

                    <dl className="grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md bg-muted/40 p-2">
                        <dt className="text-muted-foreground">Live</dt>
                        <dd className="font-mono text-base font-semibold">{coverage.liveCount}</dd>
                      </div>
                      <div className="rounded-md bg-muted/40 p-2">
                        <dt className="text-muted-foreground">API</dt>
                        <dd className="font-mono text-base font-semibold">
                          {coverage.apiReadyCount}
                        </dd>
                      </div>
                      <div className="rounded-md bg-muted/40 p-2">
                        <dt className="text-muted-foreground">Planned</dt>
                        <dd className="font-mono text-base font-semibold">
                          {coverage.plannedCount}
                        </dd>
                      </div>
                    </dl>

                    <div className="space-y-2 text-xs text-muted-foreground">
                      <div className="break-words">
                        <span className="font-medium text-foreground">Comparisons:</span>{" "}
                        {coverage.comparisonTypes.slice(0, 3).join(", ")}
                      </div>
                      <div className="break-words">
                        <span className="font-medium text-foreground">Automations:</span>{" "}
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
            <CardTitle>Report library</CardTitle>
            <CardDescription>
              Decision question, status, comparison mode, and automation hook for each report
              family.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table className="min-w-[960px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Report</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Comparison</TableHead>
                    <TableHead>Automation</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReports.map((report) => {
                    const status = reportStatusMeta[report.status];
                    return (
                      <TableRow key={report.name}>
                        <TableCell>
                          <div className="font-medium">{report.name}</div>
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
                        <TableCell className="text-right">
                          {report.tab ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setActiveTab(report.tab!)}
                            >
                              Open
                            </Button>
                          ) : report.href ? (
                            <Button asChild size="sm" variant="outline">
                              <Link href={report.href}>
                                {report.status === "planned" ? "Open area" : "Open"}
                              </Link>
                            </Button>
                          ) : (
                            <Button type="button" size="sm" variant="ghost" disabled>
                              Queued
                            </Button>
                          )}
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
                  Connected report centers
                </h3>
                <p className="text-sm text-muted-foreground">
                  Live report families served by adjacent workspaces, kept discoverable from this
                  report center.
                </p>
              </div>
              <Badge variant="outline">{connectedReportCenters.length} connected</Badge>
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
                      <Badge variant={reportStatusMeta[report.status].variant} dot>
                        {reportStatusMeta[report.status].label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-md border p-3 text-xs text-muted-foreground">
                      <div>
                        <span className="font-medium text-foreground">Comparison:</span>{" "}
                        {report.comparison}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium text-foreground">Automation:</span>{" "}
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
                      <Link href={report.href}>Open report center</Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ) : null}
      </section>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm font-medium">Filter by date:</span>
            <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
          </div>
        </CardContent>
      </Card>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ReportTab)}
        className="space-y-6"
      >
        <TabsList className="grid h-auto w-full max-w-7xl grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-12">
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
            Corporate Tax
          </TabsTrigger>
          <TabsTrigger value="sales" data-testid="tab-invoice-status">
            Sales
          </TabsTrigger>
          <TabsTrigger value="balances" data-testid="tab-balance-summaries">
            Balances
          </TabsTrigger>
          <TabsTrigger value="expenses" data-testid="tab-expense-reports">
            Expenses
          </TabsTrigger>
          <TabsTrigger value="payroll" data-testid="tab-payroll-reports">
            Payroll
          </TabsTrigger>
          <TabsTrigger value="trial" data-testid="tab-trial-balance">
            {t.trialBalance}
          </TabsTrigger>
          <TabsTrigger value="ledger" data-testid="tab-ledger-reports">
            Ledger
          </TabsTrigger>
          <TabsTrigger value="close" data-testid="tab-month-end-close-status">
            Close
          </TabsTrigger>
          <TabsTrigger value="planning" data-testid="tab-planning-reports">
            Planning
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pl" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                <div className="w-8 h-8 rounded-md bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
              </CardHeader>
              <CardContent>
                {plLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold font-mono" data-testid="text-total-revenue">
                    {formatCurrency(profitLoss?.totalRevenue || 0, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                <div className="w-8 h-8 rounded-md bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                  <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
                </div>
              </CardHeader>
              <CardContent>
                {plLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold font-mono" data-testid="text-total-expenses">
                    {formatCurrency(profitLoss?.totalExpenses || 0, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
                <div className="w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                  <DollarSign className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
              </CardHeader>
              <CardContent>
                {plLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-bold font-mono" data-testid="text-net-profit">
                    {formatCurrency(profitLoss?.netProfit || 0, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t.profitLoss} Statement</CardTitle>
              <CardDescription>
                {dateRange.from && dateRange.to
                  ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                  : "All time"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {plLoading ? (
                <Skeleton className="h-64" />
              ) : (
                <div className="space-y-6">
                  <div>
                    <h3 className="font-semibold mb-3 text-green-600 dark:text-green-400">
                      Revenue
                    </h3>
                    <Table>
                      <TableBody>
                        {profitLoss?.revenue?.map((item, index) => (
                          <TableRow key={item.accountCode || `revenue-${index}`}>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {item.accountCode || "-"}
                            </TableCell>
                            <TableCell>{item.accountName || "Unknown Account"}</TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatCurrency(item.amount ?? 0, "AED", locale)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2">
                          <TableCell colSpan={2} className="font-semibold">
                            Total Revenue
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatCurrency(profitLoss?.totalRevenue || 0, "AED", locale)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-3 text-red-600 dark:text-red-400">Expenses</h3>
                    <Table>
                      <TableBody>
                        {profitLoss?.expenses?.map((item, index) => (
                          <TableRow key={item.accountCode || `expense-${index}`}>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {item.accountCode || "-"}
                            </TableCell>
                            <TableCell>{item.accountName || "Unknown Account"}</TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatCurrency(item.amount ?? 0, "AED", locale)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2">
                          <TableCell colSpan={2} className="font-semibold">
                            Total Expenses
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatCurrency(profitLoss?.totalExpenses || 0, "AED", locale)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  <div className="border-t-4 pt-4">
                    <div className="flex justify-between items-center text-lg font-semibold">
                      <span>Net Profit</span>
                      <span
                        className={`font-mono ${(profitLoss?.netProfit ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
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
                  ? `As of ${format(dateRange.to, "MMM dd, yyyy")}`
                  : "Assets, liabilities, and equity as of today"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {bsLoading ? (
                <Skeleton className="h-96" />
              ) : (
                <div className="space-y-6">
                  <div>
                    <h3 className="font-semibold mb-3 text-blue-600 dark:text-blue-400">Assets</h3>
                    <Table>
                      <TableBody>
                        {balanceSheet?.assets?.map((item, index) => (
                          <TableRow key={item.accountCode || `asset-${index}`}>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {item.accountCode || "-"}
                            </TableCell>
                            <TableCell>{item.accountName || "Unknown Account"}</TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatCurrency(item.amount ?? 0, "AED", locale)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2">
                          <TableCell colSpan={2} className="font-semibold">
                            Total Assets
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatCurrency(balanceSheet?.totalAssets || 0, "AED", locale)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-3 text-red-600 dark:text-red-400">
                      Liabilities
                    </h3>
                    <Table>
                      <TableBody>
                        {balanceSheet?.liabilities?.map((item, index) => (
                          <TableRow key={item.accountCode || `liability-${index}`}>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {item.accountCode || "-"}
                            </TableCell>
                            <TableCell>{item.accountName || "Unknown Account"}</TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatCurrency(item.amount ?? 0, "AED", locale)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2">
                          <TableCell colSpan={2} className="font-semibold">
                            Total Liabilities
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatCurrency(balanceSheet?.totalLiabilities || 0, "AED", locale)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-3 text-purple-600 dark:text-purple-400">
                      Equity
                    </h3>
                    <Table>
                      <TableBody>
                        {balanceSheet?.equity?.map((item, index) => (
                          <TableRow key={item.accountCode || `equity-${index}`}>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {item.accountCode || "-"}
                            </TableCell>
                            <TableCell>{item.accountName || "Unknown Account"}</TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatCurrency(item.amount ?? 0, "AED", locale)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2">
                          <TableCell colSpan={2} className="font-semibold">
                            Total Equity
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
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
                  : "UAE VAT (5%) summary for the current period"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {vatLoading ? (
                <Skeleton className="h-64" />
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h3 className="font-semibold text-green-600 dark:text-green-400">
                        Sales (Output VAT)
                      </h3>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Subtotal</span>
                          <span className="font-mono">
                            {formatCurrency(vatSummary?.salesSubtotal || 0, "AED", locale)}
                          </span>
                        </div>
                        <div className="flex justify-between font-medium">
                          <span>VAT Collected (5%)</span>
                          <span className="font-mono">
                            {formatCurrency(vatSummary?.salesVAT || 0, "AED", locale)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="font-semibold text-blue-600 dark:text-blue-400">
                        Purchases (Input VAT)
                      </h3>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Subtotal</span>
                          <span className="font-mono">
                            {formatCurrency(vatSummary?.purchasesSubtotal || 0, "AED", locale)}
                          </span>
                        </div>
                        <div className="flex justify-between font-medium">
                          <span>VAT Paid (5%)</span>
                          <span className="font-mono">
                            {formatCurrency(vatSummary?.purchasesVAT || 0, "AED", locale)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t-4 pt-6">
                    <div className="flex justify-between items-center text-lg font-semibold">
                      <span>Net VAT Payable to FTA</span>
                      <span
                        className={`font-mono ${(vatSummary?.netVATPayable ?? 0) >= 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
                      >
                        {formatCurrency(Math.abs(vatSummary?.netVATPayable ?? 0), "AED", locale)}
                        {(vatSummary?.netVATPayable ?? 0) < 0 && " (Refund)"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {(vatSummary?.netVATPayable ?? 0) >= 0
                        ? "Amount to be paid to the Federal Tax Authority"
                        : "Amount to be refunded by the Federal Tax Authority"}
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
                <CardTitle className="text-sm font-medium">Tax Payable</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <Scale className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {corporateTaxLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div
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
                <CardTitle className="text-sm font-medium">Taxable Income</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {corporateTaxLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {formatCurrency(corporateTaxEstimate?.taxableIncome ?? 0, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Above Band</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {corporateTaxLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <>
                    <div className="font-mono text-2xl font-bold">
                      {formatCurrency(corporateTaxEstimate?.taxableAmount ?? 0, "AED", locale)}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {((corporateTaxEstimate?.taxRate ?? 0) * 100).toFixed(2)}% returned rate
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Posted Journals</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {corporateTaxLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
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
                  <CardTitle>Corporate Tax Estimate</CardTitle>
                  <CardDescription>
                    {corporateTaxEstimate
                      ? `${formatReportDate(corporateTaxEstimate.periodStart)} - ${formatReportDate(corporateTaxEstimate.periodEnd)}`
                      : corporateTaxPeriodLabel}
                  </CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/corporate-tax">Open Corporate Tax</Link>
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
                      Estimate only. Open Corporate Tax to adjust the workpaper or save a draft;
                      this report does not submit to the FTA or post accounting entries.
                    </p>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bridge</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Note</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {corporateTaxBridgeRows.map((row) => (
                        <TableRow key={row.metric}>
                          <TableCell className="font-medium">{row.metric}</TableCell>
                          <TableCell className="text-right font-mono">
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
          <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Invoice Value</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {salesLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {formatCurrency(invoiceStatusReport.invoiceValueAed, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Active Invoices</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {salesLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {invoiceStatusReport.activeInvoiceCount}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Unpaid Invoices</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
              </CardHeader>
              <CardContent>
                {salesLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {invoiceStatusReport.unpaidCount}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Overdue Outstanding</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
              </CardHeader>
              <CardContent>
                {salesLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : invoiceStatusReport.overdueCurrency ? (
                  <div className="font-mono text-2xl font-bold">
                    {formatCurrency(
                      invoiceStatusReport.overdueOutstanding,
                      invoiceStatusReport.overdueCurrency,
                      locale
                    )}
                  </div>
                ) : (
                  <div className="text-sm font-medium">Mixed currencies</div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Sales by product/service</CardTitle>
                  <CardDescription>
                    Line-item sales mix, AED value, VAT, and service concentration.
                  </CardDescription>
                </div>
                <Badge
                  variant={productServiceTopShare >= 50 ? "warning" : "success"}
                  dot={productServiceSalesRows.length > 0}
                >
                  {productServiceSalesRows.length
                    ? `${productServiceTopShare.toFixed(1)}% top share`
                    : "No line items"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {salesProductServiceLoading ? (
                <Skeleton className="h-64" />
              ) : productServiceSalesRows.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product / service</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="text-right">VAT</TableHead>
                      <TableHead className="text-right">Avg unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productServiceSalesRows.slice(0, 12).map((row) => (
                      <TableRow key={row.productService}>
                        <TableCell>
                          <div className="font-medium">{row.productService}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.lineCount} lines - {row.supplyTypes.join(", ")}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">{row.invoiceCount}</TableCell>
                        <TableCell className="text-right font-mono">
                          {row.quantity.toLocaleString(locale, { maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatCurrency(row.amountAed, "AED", locale)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(row.vatAed, "AED", locale)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(row.averageUnitPriceAed, "AED", locale)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No invoice line-item sales found for this period.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Invoice status</CardTitle>
                <CardDescription>Status mix and AED-equivalent invoice value.</CardDescription>
              </CardHeader>
              <CardContent>
                {salesLoading ? (
                  <Skeleton className="h-64" />
                ) : statusSummary.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Invoices</TableHead>
                        <TableHead className="text-right">Value</TableHead>
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
                          <TableCell className="text-right font-mono">{row.count}</TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(row.amountAed, "AED", locale)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No invoices found for this period.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Revenue by customer</CardTitle>
                <CardDescription>Top customers by issued invoice value.</CardDescription>
              </CardHeader>
              <CardContent>
                {salesLoading ? (
                  <Skeleton className="h-64" />
                ) : customerRevenue.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-right">Invoices</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerRevenue.map((row) => (
                        <TableRow key={row.customerName}>
                          <TableCell className="font-medium">{row.customerName}</TableCell>
                          <TableCell className="text-right font-mono">{row.invoiceCount}</TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(row.amountAed, "AED", locale)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No issued customer revenue found for this period.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Reminder routing</CardTitle>
                  <CardDescription>
                    Overdue customer balances grouped by recommended chase level.
                  </CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/payment-chasing">Open chasing queue</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {salesLoading ? (
                <Skeleton className="h-64" />
              ) : overdueCustomerRows.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      <TableHead className="text-right">Oldest</TableHead>
                      <TableHead className="text-right">Next level</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overdueCustomerRows.map((row) => (
                      <TableRow key={`${row.customerName}-${row.currency}`}>
                        <TableCell className="font-medium">{row.customerName}</TableCell>
                        <TableCell className="text-right font-mono">{row.invoiceCount}</TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatCurrency(row.outstanding, row.currency, locale)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.maxDaysOverdue} days
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="warning">Level {row.recommendedLevel}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No overdue invoices in the reminder queue.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invoice detail</CardTitle>
              <CardDescription>
                {dateRange.from && dateRange.to
                  ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                  : "All invoice dates"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {salesLoading ? (
                <Skeleton className="h-96" />
              ) : reportInvoices.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Issue date</TableHead>
                        <TableHead>Due date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">AED value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportInvoices.slice(0, 25).map((invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell className="font-mono font-medium">{invoice.number}</TableCell>
                          <TableCell>{invoice.customerName || "Unknown Customer"}</TableCell>
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
                          <TableCell className="text-right font-mono">
                            {formatCurrency(invoice.total ?? 0, invoice.currency || "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(amountInAed(invoice), "AED", locale)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No invoices found for this period.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="balances" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Customer Open Balance</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
              </CardHeader>
              <CardContent>
                {balancesLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {formatCurrency(balanceReport.customerOpenAed, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Customer Overdue</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
              </CardHeader>
              <CardContent>
                {balancesLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="space-y-1">
                    <div className="font-mono text-2xl font-bold">
                      {formatCurrency(balanceReport.customerOverdueAed, "AED", locale)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {balanceReport.overdueCustomerCount} customers
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Vendor Open Balance</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
              </CardHeader>
              <CardContent>
                {balancesLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {formatCurrency(balanceReport.vendorOpenAed, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Net AR Less AP</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <Scale className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {balancesLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {formatCurrency(balanceReport.netBalanceAed, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Customer balance summary</CardTitle>
                    <CardDescription>
                      Current open receivables from issued invoices, net of recorded payments.
                    </CardDescription>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/payment-chasing">Open collections</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {balancesLoading ? (
                  <Skeleton className="h-72" />
                ) : balanceReport.customers.length ? (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[760px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Customer</TableHead>
                          <TableHead className="text-right">Invoices</TableHead>
                          <TableHead className="text-right">Open</TableHead>
                          <TableHead className="text-right">Overdue</TableHead>
                          <TableHead className="text-right">Oldest</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {balanceReport.customers.slice(0, 10).map((row) => (
                          <TableRow key={`${row.name}-${row.currency}`}>
                            <TableCell>
                              <div className="font-medium">{row.name}</div>
                              <Badge
                                className="mt-1"
                                variant={row.overdueBalanceAed > 0 ? "warning" : "success"}
                                dot
                              >
                                {row.overdueBalanceAed > 0 ? "Collections" : "Current"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {row.invoiceCount}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="font-mono font-medium">
                                {formatCurrency(row.openBalance, row.currency, locale)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatCurrency(row.openBalanceAed, "AED", locale)}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="font-mono font-medium">
                                {formatCurrency(row.overdueBalance, row.currency, locale)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatCurrency(row.overdueBalanceAed, "AED", locale)}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {row.maxDaysOverdue} days
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No open customer balances.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Vendor balance summary</CardTitle>
                    <CardDescription>
                      Current open payables from vendor bills, net of recorded payments.
                    </CardDescription>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/bill-pay?tab=summary">Open bill pay</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {balancesLoading ? (
                  <Skeleton className="h-72" />
                ) : balanceReport.vendors.length ? (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[760px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Vendor</TableHead>
                          <TableHead className="text-right">Bills</TableHead>
                          <TableHead className="text-right">Open</TableHead>
                          <TableHead className="text-right">Overdue</TableHead>
                          <TableHead className="text-right">Oldest</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {balanceReport.vendors.slice(0, 10).map((row) => (
                          <TableRow key={`${row.name}-${row.currency}`}>
                            <TableCell>
                              <div className="font-medium">{row.name}</div>
                              <Badge
                                className="mt-1"
                                variant={row.overdueBalanceAed > 0 ? "warning" : "success"}
                                dot
                              >
                                {row.overdueBalanceAed > 0 ? "Pay queue" : "Current"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono">{row.billCount}</TableCell>
                            <TableCell className="text-right">
                              <div className="font-mono font-medium">
                                {formatCurrency(row.openBalance, row.currency, locale)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatCurrency(row.openBalanceAed, "AED", locale)}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="font-mono font-medium">
                                {formatCurrency(row.overdueBalance, row.currency, locale)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatCurrency(row.overdueBalanceAed, "AED", locale)}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {row.maxDaysOverdue} days
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No open vendor balances.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Inventory valuation</CardTitle>
                  <CardDescription>
                    Stock quantity, cost value, reorder risk, and costing exceptions.
                  </CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/inventory">Open inventory</Link>
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
                      <div className="text-xs text-muted-foreground">Active products</div>
                      <div className="font-mono text-2xl font-semibold">
                        {inventoryValuationReport.activeProductCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Stock value</div>
                      <div className="font-mono text-2xl font-semibold">
                        {formatCurrency(inventoryValuationReport.totalStockValueAed, "AED", locale)}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Low stock</div>
                      <div className="font-mono text-2xl font-semibold">
                        {inventoryValuationReport.lowStockCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Costing review</div>
                      <div className="font-mono text-2xl font-semibold">
                        {inventoryValuationReport.missingCostCount}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <Table className="min-w-[940px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Stock</TableHead>
                          <TableHead className="text-right">Unit cost</TableHead>
                          <TableHead className="text-right">Value</TableHead>
                          <TableHead className="text-right">Movements</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {inventoryValuationReport.rows.slice(0, 12).map((product) => (
                          <TableRow key={product.id}>
                            <TableCell>
                              <div className="font-medium">{product.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {product.sku || "No SKU"}
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
                                  ? "Negative stock"
                                  : product.isMissingCost
                                    ? "Missing cost"
                                    : product.isLowStock
                                      ? "Low stock"
                                      : product.isActive
                                        ? "Valued"
                                        : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {product.currentStock.toLocaleString(locale)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(product.unitCost, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatCurrency(product.stockValueAed, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
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
                  No inventory products found yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Inventory movement</CardTitle>
                  <CardDescription>
                    Stock receipts, sales, returns, and adjustments for the selected period.
                  </CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/inventory">Open movements</Link>
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
                      <div className="text-xs text-muted-foreground">Movements</div>
                      <div className="font-mono text-2xl font-semibold">
                        {inventoryMovementReport.movementCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Inbound units</div>
                      <div className="font-mono text-2xl font-semibold">
                        {inventoryMovementReport.inboundUnits.toLocaleString(locale)}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Outbound units</div>
                      <div className="font-mono text-2xl font-semibold">
                        {inventoryMovementReport.outboundUnits.toLocaleString(locale)}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Movement value</div>
                      <div className="font-mono text-2xl font-semibold">
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
                        <div className="font-medium">Movement type mix</div>
                        <div className="text-xs text-muted-foreground">
                          Quantity and value by movement type.
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
                                {row.count} movements / {row.quantity.toLocaleString(locale)} units
                              </div>
                            </div>
                            <div className="text-right font-mono">
                              {formatCurrency(row.valueAed, "AED", locale)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <Table className="min-w-[920px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Product</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead className="text-right">Quantity</TableHead>
                            <TableHead className="text-right">Unit cost</TableHead>
                            <TableHead className="text-right">Value</TableHead>
                            <TableHead>Reference</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {inventoryMovementReport.rows.slice(0, 12).map((movement) => (
                            <TableRow key={movement.id}>
                              <TableCell className="whitespace-nowrap text-muted-foreground">
                                {formatReportDate(movement.createdAt)}
                              </TableCell>
                              <TableCell>
                                <div className="font-medium">{movement.productName}</div>
                                <div className="text-xs text-muted-foreground">
                                  {movement.sku || movement.unit || "No SKU"}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={inventoryMovementVariant(movement.type)} dot>
                                  {movement.type}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {movement.type === "sale" ? "-" : "+"}
                                {Math.abs(movement.quantity).toLocaleString(locale)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {movement.unitCost
                                  ? formatCurrency(movement.unitCost, "AED", locale)
                                  : "-"}
                              </TableCell>
                              <TableCell className="text-right font-mono font-medium">
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
                  No inventory movements found for this period.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Depreciation schedule</CardTitle>
                  <CardDescription>
                    Estimated depreciation for {format(depreciationPeriodDate, "MMMM yyyy")} from
                    the fixed asset register.
                  </CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/fixed-assets">Open fixed assets</Link>
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
                      <div className="text-xs text-muted-foreground">Period depreciation</div>
                      <div className="font-mono text-2xl font-semibold">
                        {formatCurrency(
                          depreciationScheduleReport.periodDepreciationAed,
                          "AED",
                          locale
                        )}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Annual run-rate</div>
                      <div className="font-mono text-2xl font-semibold">
                        {formatCurrency(
                          depreciationScheduleReport.annualDepreciationAed,
                          "AED",
                          locale
                        )}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Ready to post</div>
                      <div className="font-mono text-2xl font-semibold">
                        {depreciationScheduleReport.readyToPostCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Setup review</div>
                      <div className="font-mono text-2xl font-semibold">
                        {depreciationScheduleReport.reviewCount}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <Table className="min-w-[980px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Asset</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead className="text-right">Remaining</TableHead>
                          <TableHead className="text-right">Monthly depreciation</TableHead>
                          <TableHead className="text-right">Projected NBV</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {depreciationScheduleReport.rows.slice(0, 12).map((row) => (
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
                            <TableCell className="text-right font-mono">
                              {formatCurrency(row.remainingDepreciable, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatCurrency(row.monthlyDepreciation, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
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
                  No active fixed assets available for depreciation.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Fixed asset register</CardTitle>
                  <CardDescription>
                    Asset cost, accumulated depreciation, net book value, and capitalization review.
                  </CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/fixed-assets">Open fixed assets</Link>
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
                      <div className="text-xs text-muted-foreground">Active assets</div>
                      <div className="font-mono text-2xl font-semibold">
                        {fixedAssetRegisterReport.totalAssets}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Asset cost</div>
                      <div className="font-mono text-2xl font-semibold">
                        {formatCurrency(fixedAssetRegisterReport.totalCost, "AED", locale)}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Net book value</div>
                      <div className="font-mono text-2xl font-semibold">
                        {formatCurrency(fixedAssetRegisterReport.totalNetBookValue, "AED", locale)}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Review items</div>
                      <div className="font-mono text-2xl font-semibold">
                        {fixedAssetRegisterReport.reviewCount}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.8fr]">
                    <div className="overflow-x-auto">
                      <Table className="min-w-[960px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Asset</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Purchase date</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Cost</TableHead>
                            <TableHead className="text-right">Depreciation</TableHead>
                            <TableHead className="text-right">NBV</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {fixedAssetRegisterReport.rows.slice(0, 12).map((asset) => (
                            <TableRow key={asset.id}>
                              <TableCell>
                                <div className="font-medium">{asset.asset_name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {asset.asset_number || asset.serial_number || "No asset number"}
                                </div>
                              </TableCell>
                              <TableCell>{asset.category}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {formatReportDate(asset.purchase_date)}
                              </TableCell>
                              <TableCell>
                                <Badge variant={fixedAssetStatusVariant(asset.status)} dot>
                                  {asset.needs_capitalization_je
                                    ? "Capitalization review"
                                    : asset.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(asset.purchaseCost, "AED", locale)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(asset.accumulatedDepreciation, "AED", locale)}
                              </TableCell>
                              <TableCell className="text-right font-mono font-medium">
                                {formatCurrency(asset.netBookValue, "AED", locale)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="rounded-md border p-4">
                      <div className="mb-3">
                        <div className="font-medium">Category valuation</div>
                        <div className="text-xs text-muted-foreground">
                          Active assets grouped by category.
                        </div>
                      </div>
                      <div className="space-y-3">
                        {fixedAssetRegisterReport.byCategory.length ? (
                          fixedAssetRegisterReport.byCategory.slice(0, 8).map((category) => (
                            <div
                              key={category.category}
                              className="flex items-center justify-between gap-4 text-sm"
                            >
                              <div>
                                <div className="font-medium">{category.category}</div>
                                <div className="text-xs text-muted-foreground">
                                  {category.count} assets
                                </div>
                              </div>
                              <div className="text-right font-mono">
                                {formatCurrency(category.totalNetBookValue, "AED", locale)}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-muted-foreground">
                            No active asset categories.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No fixed assets registered yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Balance automation queues</CardTitle>
              <CardDescription>
                Current open-balance signals for collections and payable follow-up.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Collections queue</div>
                  <div className="font-mono text-2xl font-semibold">
                    {balanceReport.overdueCustomerCount}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Bill pay queue</div>
                  <div className="font-mono text-2xl font-semibold">
                    {balanceReport.overdueVendorCount}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Inventory review</div>
                  <div className="font-mono text-2xl font-semibold">
                    {inventoryValuationReport.reviewCount}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Asset review</div>
                  <div className="font-mono text-2xl font-semibold">
                    {fixedAssetRegisterReport.reviewCount}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Last refreshed</div>
                  <div className="text-sm font-medium">
                    {formatReportDate(balanceReport.generatedAt)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenses" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Spend</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
              </CardHeader>
              <CardContent>
                {expensesLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {formatCurrency(expenseReport.totalAed, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Expense Subtotal</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {expensesLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {formatCurrency(expenseReport.subtotalAed, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Input VAT</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {expensesLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {formatCurrency(expenseReport.vatAed, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Posting Queue</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
              </CardHeader>
              <CardContent>
                {expensesLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="space-y-1">
                    <div className="font-mono text-2xl font-bold">
                      {expenseReport.unpostedReceipts}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {expenseReport.autoPostedReceipts} auto-posted
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Expenses by vendor</CardTitle>
                <CardDescription>Top merchants by AED-equivalent total spend.</CardDescription>
              </CardHeader>
              <CardContent>
                {expensesLoading ? (
                  <Skeleton className="h-64" />
                ) : expenseReport.byVendor.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead className="text-right">Receipts</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Unposted</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenseReport.byVendor.map((row) => (
                        <TableRow key={row.label}>
                          <TableCell className="font-medium">{row.label}</TableCell>
                          <TableCell className="text-right font-mono">{row.receiptCount}</TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(row.totalAed, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {row.unpostedCount}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No expenses found for this period.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Expenses by category</CardTitle>
                <CardDescription>Cost groups for spend review and alerting.</CardDescription>
              </CardHeader>
              <CardContent>
                {expensesLoading ? (
                  <Skeleton className="h-64" />
                ) : expenseReport.byCategory.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Receipts</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                        <TableHead className="text-right">VAT</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenseReport.byCategory.map((row) => (
                        <TableRow key={row.label}>
                          <TableCell className="font-medium">{row.label}</TableCell>
                          <TableCell className="text-right font-mono">{row.receiptCount}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.subtotalAed, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.vatAed, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(row.totalAed, "AED", locale)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No categorized expenses found for this period.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Expense claims</CardTitle>
                  <CardDescription>
                    Claim status, approval routing, and reimbursement queue.
                  </CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/expense-claims">Open claims</Link>
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
                      <div className="text-xs text-muted-foreground">Claims</div>
                      <div className="font-mono text-2xl font-semibold">
                        {expenseClaimReport.claimCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Claim value</div>
                      <div className="font-mono text-2xl font-semibold">
                        {formatCurrency(expenseClaimReport.totalAmount, "AED", locale)}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Needs approval</div>
                      <div className="font-mono text-2xl font-semibold">
                        {expenseClaimReport.submittedCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Approved unpaid</div>
                      <div className="font-mono text-2xl font-semibold">
                        {expenseClaimReport.approvedUnpaidCount}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.8fr_1.2fr]">
                    <div className="rounded-md border p-4">
                      <div className="mb-3">
                        <div className="font-medium">Claim status mix</div>
                        <div className="text-xs text-muted-foreground">
                          Current date-range claims by workflow status.
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
                                {row.count} claims
                              </div>
                            </div>
                            <div className="text-right font-mono">
                              {formatCurrency(row.totalAmount, "AED", locale)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <Table className="min-w-[880px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Claim</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead>Submitted</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {expenseClaimReport.claims.slice(0, 12).map((claim) => (
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
                              <TableCell className="text-right font-mono font-medium">
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
                  No expense claims found for this period.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Posting automation</CardTitle>
                  <CardDescription>
                    Receipts ready for review, posting, and autopilot follow-up.
                  </CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/receipts">Open receipts</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Captured receipts</div>
                  <div className="font-mono text-2xl font-semibold">
                    {expenseReport.receiptCount}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Auto-posted</div>
                  <div className="font-mono text-2xl font-semibold">
                    {expenseReport.autoPostedReceipts}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Needs posting</div>
                  <div className="font-mono text-2xl font-semibold">
                    {expenseReport.unpostedReceipts}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Claims review</div>
                  <div className="font-mono text-2xl font-semibold">
                    {expenseClaimReport.reviewCount}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Expense detail</CardTitle>
              <CardDescription>
                {dateRange.from && dateRange.to
                  ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                  : "All receipt dates"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {expensesLoading ? (
                <Skeleton className="h-96" />
              ) : reportReceipts.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                        <TableHead className="text-right">VAT</TableHead>
                        <TableHead className="text-right">Total AED</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportReceipts.slice(0, 25).map((receipt) => {
                        const subtotalAed = receiptSubtotalAed(receipt);
                        const vatAed = receiptVatAed(receipt);
                        return (
                          <TableRow key={receipt.id}>
                            <TableCell className="font-medium">
                              {receipt.merchant || "Unknown Merchant"}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatReportDate(receipt.date)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{receipt.category || "Uncategorized"}</Badge>
                            </TableCell>
                            <TableCell>
                              {receipt.autoPosted ? (
                                <Badge variant="success" dot>
                                  Auto-posted
                                </Badge>
                              ) : receipt.posted ? (
                                <Badge variant="info" dot>
                                  Posted
                                </Badge>
                              ) : (
                                <Badge variant="warning" dot>
                                  Needs posting
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(subtotalAed, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(vatAed, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {formatCurrency(subtotalAed + vatAed, "AED", locale)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No receipts found for this period.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payroll" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Net payroll</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {payrollLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {formatCurrency(payrollReport.totalNet, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Payroll runs</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {payrollLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="font-mono text-2xl font-bold">{payrollReport.runCount}</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Needs approval</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {payrollLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {payrollReport.approvalQueueCount}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Needs SIF</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {payrollLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {payrollReport.wpsMissingCount}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Payroll Summary</CardTitle>
                  <CardDescription>
                    Pay-period totals, approval state, and WPS/SIF readiness.
                  </CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/payroll">Open payroll</Link>
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
                        <div className="font-medium">Payroll status mix</div>
                        <div className="text-xs text-muted-foreground">
                          Current date-range payroll by workflow status.
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
                                {row.count} runs / {row.employeeCount} employees
                              </div>
                            </div>
                            <div className="text-right font-mono">
                              {formatCurrency(row.totalNet, "AED", locale)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <Table className="min-w-[920px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Period</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Employees</TableHead>
                            <TableHead className="text-right">Basic</TableHead>
                            <TableHead className="text-right">Allowances</TableHead>
                            <TableHead className="text-right">Deductions</TableHead>
                            <TableHead className="text-right">Net</TableHead>
                            <TableHead>SIF</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {payrollReport.runs.slice(0, 12).map((run) => (
                            <TableRow key={run.id}>
                              <TableCell className="font-medium">
                                {payrollPeriodLabel(run)}
                              </TableCell>
                              <TableCell>
                                <Badge variant={payrollStatusVariant(run.status)} dot>
                                  {run.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {run.employee_count}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(payrollAmount(run.total_basic), "AED", locale)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(payrollAmount(run.total_allowances), "AED", locale)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(payrollAmount(run.total_deductions), "AED", locale)}
                              </TableCell>
                              <TableCell className="text-right font-mono font-medium">
                                {formatCurrency(payrollAmount(run.total_net), "AED", locale)}
                              </TableCell>
                              <TableCell>
                                <Badge variant={run.sif_file_content ? "success" : "warning"} dot>
                                  {run.sif_file_content ? "Generated" : "Needed"}
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
                  No payroll runs found for this period.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>WPS / SIF readiness</CardTitle>
              <CardDescription>
                Generated SIF files and approved payroll runs ready for UAE WPS processing.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">SIF generated</div>
                  <div className="font-mono text-2xl font-semibold">
                    {payrollReport.sifGeneratedCount}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">WPS ready</div>
                  <div className="font-mono text-2xl font-semibold">
                    {payrollReport.wpsReadyCount}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Approved runs</div>
                  <div className="font-mono text-2xl font-semibold">
                    {payrollReport.approvedCount}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Latest period</div>
                  <div className="font-mono text-2xl font-semibold">
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
                <CardTitle className="text-sm font-medium">Debit / Credit Status</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  {trialBalanceSummary.isBalanced ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {trialBalanceLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="space-y-1">
                    <div
                      className="font-mono text-2xl font-bold"
                      data-testid="text-trial-balance-difference"
                    >
                      {formatCurrency(
                        trialBalance?.totals.difference ?? 0,
                        trialBalance?.reportCurrency ?? "AED",
                        locale
                      )}
                    </div>
                    <Badge variant={trialBalanceSummary.isBalanced ? "success" : "warning"} dot>
                      {trialBalanceSummary.isBalanced ? "Balanced" : "Needs review"}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Active Accounts</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <Scale className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {trialBalanceLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {trialBalanceSummary.activeAccounts}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">FX Accounts</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {trialBalanceLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
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
                      : "Posted account balances through today"}
                  </CardDescription>
                </div>
                {!trialBalanceLoading && (
                  <Badge variant={trialBalanceSummary.isBalanced ? "success" : "warning"} dot>
                    {trialBalanceSummary.isBalanced ? "Ready for close" : "Difference flagged"}
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
                        <TableHead>Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead>Flags</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {trialBalance.rows.map((row) => (
                        <TableRow key={row.accountId}>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {row.accountCode || "-"}
                          </TableCell>
                          <TableCell className="font-medium">
                            {row.accountName || "Unknown Account"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {row.accountType}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.totalDebit ?? 0,
                              trialBalance.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.totalCredit ?? 0,
                              trialBalance.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(row.balance ?? 0, trialBalance.reportCurrency, locale)}
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
                          Totals
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {formatCurrency(
                            trialBalance.totals.sumDebits,
                            trialBalance.reportCurrency,
                            locale
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {formatCurrency(
                            trialBalance.totals.sumCredits,
                            trialBalance.reportCurrency,
                            locale
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {formatCurrency(
                            trialBalance.totals.difference,
                            trialBalance.reportCurrency,
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
                  No posted accounts found for this period.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ledger" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Posted Entries</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {ledgerLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="font-mono text-2xl font-bold">{ledgerReport.entryCount}</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Debit / Credit Difference</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  {ledgerReport.difference < 0.005 ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {ledgerLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="space-y-1">
                    <div className="font-mono text-2xl font-bold">
                      {formatCurrency(ledgerReport.difference, "AED", locale)}
                    </div>
                    <Badge variant={ledgerReport.difference < 0.005 ? "success" : "warning"} dot>
                      {ledgerReport.difference < 0.005 ? "Balanced" : "Needs review"}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Accounts Touched</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <Scale className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {ledgerLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="font-mono text-2xl font-bold">{ledgerReport.accountCount}</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Review Queue</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {ledgerLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="space-y-1">
                    <div className="font-mono text-2xl font-bold">{ledgerReport.reviewEntries}</div>
                    <div className="text-xs text-muted-foreground">
                      {ledgerReport.foreignCurrencyLines} FX lines
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Account transactions</CardTitle>
                <CardDescription>Account-level debit, credit, and activity totals.</CardDescription>
              </CardHeader>
              <CardContent>
                {ledgerLoading ? (
                  <Skeleton className="h-64" />
                ) : accountActivity.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Lines</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {accountActivity.slice(0, 10).map((row) => (
                        <TableRow key={row.accountId}>
                          <TableCell>
                            <div className="font-medium">{row.accountName}</div>
                            <div className="font-mono text-xs text-muted-foreground">
                              {row.accountCode || "-"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {row.accountType}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">{row.lineCount}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.debit, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.credit, "AED", locale)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No posted account activity found for this period.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Source review</CardTitle>
                <CardDescription>Automation routing by journal entry source.</CardDescription>
              </CardHeader>
              <CardContent>
                {ledgerLoading ? (
                  <Skeleton className="h-64" />
                ) : ledgerSourceRows.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Entries</TableHead>
                        <TableHead className="text-right">Lines</TableHead>
                        <TableHead className="text-right">Activity</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerSourceRows.map((row) => (
                        <TableRow key={row.source}>
                          <TableCell className="capitalize">{row.source}</TableCell>
                          <TableCell className="text-right font-mono">{row.entryCount}</TableCell>
                          <TableCell className="text-right font-mono">{row.lineCount}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.amountAed, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={row.needsReview ? "warning" : "success"} dot>
                              {row.needsReview ? "Review" : "Linked"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No journal sources found for this period.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>General ledger detail</CardTitle>
                  <CardDescription>
                    {dateRange.from && dateRange.to
                      ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                      : "All posted journal entry dates"}
                  </CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/journal">Open journal</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {ledgerLoading ? (
                <Skeleton className="h-96" />
              ) : ledgerLines.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[980px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Entry</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Memo</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                        <TableHead>Flags</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerLines.slice(0, 50).map((line) => (
                        <TableRow key={line.id}>
                          <TableCell className="font-mono font-medium">
                            {line.entryNumber}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatReportDate(line.date)}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{line.accountName}</div>
                            <div className="font-mono text-xs text-muted-foreground">
                              {line.accountCode || "-"}
                            </div>
                          </TableCell>
                          <TableCell className="capitalize">{line.source}</TableCell>
                          <TableCell className="max-w-[240px] truncate text-muted-foreground">
                            {line.memo || "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {line.debit > 0 ? formatCurrency(line.debit, "AED", locale) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {line.credit > 0 ? formatCurrency(line.credit, "AED", locale) : "-"}
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
              ) : (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No posted journal lines found for this period.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="close" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Close Readiness</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {monthEndCloseLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="font-mono text-2xl font-bold">{monthEndReadinessPercent}%</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Completed</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
              </CardHeader>
              <CardContent>
                {monthEndCloseLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="font-mono text-2xl font-bold">{monthEndCompletedChecks}</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Needs Review</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
              </CardHeader>
              <CardContent>
                {monthEndCloseLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="font-mono text-2xl font-bold">{monthEndReviewChecks}</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Close Period</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="font-mono text-2xl font-bold">{monthEndPeriod}</div>
                <p className="mt-1 text-xs text-muted-foreground">{monthEndPeriodLabel}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Month-End Close Status</CardTitle>
                  <CardDescription>
                    {monthEndCloseStatus
                      ? `${formatReportDate(monthEndCloseStatus.periodStart)} - ${formatReportDate(monthEndCloseStatus.periodEnd)}`
                      : monthEndPeriodLabel}
                  </CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/month-end">Open month-end</Link>
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
                      <TableHead>Check</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthEndChecklist.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.title}</TableCell>
                        <TableCell>
                          <Badge variant={item.status === "complete" ? "success" : "warning"} dot>
                            {item.status === "complete" ? "Complete" : "Needs review"}
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
                  No month-end close checks found for this period.
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Audit Trail</CardTitle>
                  <CardDescription>{auditTrailPeriodLabel}</CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/history">Open history</Link>
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
                      <div className="text-xs text-muted-foreground">Events</div>
                      <div className="font-mono text-xl font-semibold">
                        {auditTrailReport.logCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">High risk</div>
                      <div className="font-mono text-xl font-semibold">
                        {auditTrailReport.highRiskCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Posting actions</div>
                      <div className="font-mono text-xl font-semibold">
                        {auditTrailReport.postingActionCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Users</div>
                      <div className="font-mono text-xl font-semibold">
                        {auditTrailReport.userCount}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <div className="space-y-3">
                      <div className="text-sm font-medium">Activity by action</div>
                      {auditTrailReport.actionRows.slice(0, 6).length ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Action</TableHead>
                              <TableHead className="text-right">Events</TableHead>
                              <TableHead>Latest</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {auditTrailReport.actionRows.slice(0, 6).map((row) => (
                              <TableRow key={row.key}>
                                <TableCell className="capitalize">{row.label}</TableCell>
                                <TableCell className="text-right font-mono">{row.count}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {formatReportDate(row.latestAt)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                          No activity actions found for this period.
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div className="text-sm font-medium">Activity by record type</div>
                      {auditTrailReport.entityRows.slice(0, 6).length ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Record type</TableHead>
                              <TableHead className="text-right">Events</TableHead>
                              <TableHead>Latest</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {auditTrailReport.entityRows.slice(0, 6).map((row) => (
                              <TableRow key={row.key}>
                                <TableCell className="capitalize">{row.label}</TableCell>
                                <TableCell className="text-right font-mono">{row.count}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {formatReportDate(row.latestAt)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                          No audited record types found for this period.
                        </div>
                      )}
                    </div>
                  </div>

                  {auditTrailReport.rows.length ? (
                    <div className="overflow-x-auto">
                      <Table className="min-w-[920px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Action</TableHead>
                            <TableHead>Record</TableHead>
                            <TableHead>Risk</TableHead>
                            <TableHead>Description</TableHead>
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
                                <div className="font-mono text-xs text-muted-foreground">
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
                      No activity logs found for this period.
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Consolidated statements</CardTitle>
                  <CardDescription>
                    {consolidatedStatementsReport.periodLabel}. Multi-entity roll-up; no
                    eliminations applied.
                  </CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/financial-statements">Open statements</Link>
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
                      <div className="text-xs text-muted-foreground">Entities</div>
                      <div className="font-mono text-xl font-semibold">
                        {consolidatedStatementsReport.loadedEntityCount}/
                        {consolidatedStatementsReport.entityCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Revenue</div>
                      <div className="font-mono text-xl font-semibold">
                        {formatCurrency(consolidatedStatementsReport.totalRevenue, "AED", locale)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Net profit</div>
                      <div className="font-mono text-xl font-semibold">
                        {formatCurrency(consolidatedStatementsReport.netProfit, "AED", locale)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Assets</div>
                      <div className="font-mono text-xl font-semibold">
                        {formatCurrency(consolidatedStatementsReport.totalAssets, "AED", locale)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Review items</div>
                      <div className="font-mono text-xl font-semibold">
                        {consolidatedStatementsReport.reviewCount}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={consolidatedStatementsReport.reviewCount > 0 ? "warning" : "success"}
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
                            <TableHead>Company</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead className="text-right">Revenue</TableHead>
                            <TableHead className="text-right">Net profit</TableHead>
                            <TableHead className="text-right">Assets</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Review</TableHead>
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
                              <TableCell className="text-right font-mono">
                                {formatCurrency(row.revenue, "AED", locale)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(row.netProfit, "AED", locale)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(row.assets, "AED", locale)}
                              </TableCell>
                              <TableCell>
                                <Badge variant={consolidatedStatusVariant(row.status)} dot>
                                  {row.statusLabel}
                                </Badge>
                              </TableCell>
                              <TableCell className="max-w-[360px] text-sm text-muted-foreground">
                                {row.reviewReason || "Ready for accountant pack."}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                      No accessible companies found for consolidation.
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="planning" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Budget</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {planningLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {formatCurrency(planningReport.budgetTotal, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Actual</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {planningLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="font-mono text-2xl font-bold">
                    {formatCurrency(planningReport.actualTotal, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Variance</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  {planningReport.variance >= 0 ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {planningLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="space-y-1">
                    <div className="font-mono text-2xl font-bold">
                      {formatCurrency(planningReport.variance, "AED", locale)}
                    </div>
                    <Badge variant={planningReport.variance >= 0 ? "success" : "warning"} dot>
                      {planningReport.variance >= 0 ? "Under budget" : "Over budget"}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Projected Cash</CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                {planningLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="space-y-1">
                    <div className="font-mono text-2xl font-bold">
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
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Budget vs actual</CardTitle>
                    <CardDescription>
                      {planningReport.budget
                        ? `${planningReport.budget.name} (${planningReport.budget.fiscalYear})`
                        : "Create a budget to compare actuals."}
                    </CardDescription>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/budgets">Open budgets</Link>
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
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Budget</TableHead>
                        <TableHead className="text-right">Actual</TableHead>
                        <TableHead className="text-right">Variance</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {planningReport.largestVarianceLines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell className="font-medium">{line.category}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(line.totals.budget, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(line.totals.actual, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(line.totals.variance, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={line.totals.variance >= 0 ? "success" : "warning"} dot>
                              {line.totals.variance >= 0 ? "Under" : "Over"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No budget variance data available.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Cash flow forecast</CardTitle>
                    <CardDescription>
                      90-day projected inflows, outflows, and balance.
                    </CardDescription>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/cashflow-forecast">Open forecast</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {planningLoading ? (
                  <Skeleton className="h-64" />
                ) : planningReport.projections.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Week</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">In</TableHead>
                        <TableHead className="text-right">Out</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {planningReport.projections.slice(0, 8).map((row) => (
                        <TableRow key={row.week}>
                          <TableCell className="font-medium">Week {row.week}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.weekStart} - {row.weekEnd}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.expectedInflows, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.expectedOutflows, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(row.projectedBalance, "AED", locale)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No cash flow projection data available.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Planning automation</CardTitle>
              <CardDescription>
                Signals that should drive alerts and follow-up workflows.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Over-budget lines</div>
                  <div className="font-mono text-2xl font-semibold">
                    {planningReport.overBudgetLines}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Cash movement</div>
                  <div className="font-mono text-2xl font-semibold">
                    {formatCurrency(planningReport.cashMovement, "AED", locale)}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Forecast insights</div>
                  <div className="font-mono text-2xl font-semibold">
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
    </div>
  );
}
