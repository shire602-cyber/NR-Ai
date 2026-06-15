import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatNumber } from "@/lib/format";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import {
  exportToExcel,
  exportToGoogleSheets,
  downloadReportPackRunExcel,
  type ExportData,
  prepareProfitLossForExport,
  prepareBalanceSheetForExport,
  prepareVATSummaryForExport,
} from "@/lib/export";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileText,
  Landmark,
  Package,
  ReceiptText,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SiGooglesheets } from "react-icons/si";

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

interface VATSummaryReport {
  period: string;
  salesSubtotal: number;
  salesVAT: number;
  purchasesSubtotal: number;
  purchasesVAT: number;
  netVATPayable: number;
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

interface VATReturnReport {
  period: { from: string; to: string };
  box1_standardRatedSupplies: number;
  box2_zeroRatedSupplies: number;
  box3_exemptSupplies: number;
  box4_totalSupplies: number;
  box5_outputVat: number;
  box6_standardRatedExpenses: number;
  box7_inputVatRecoverable: number;
  box8_netVatDue: number;
}

interface FxGainLossItem {
  entityType: "invoice" | "payable";
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
  receivables: FxGainLossItem[];
  payables: FxGainLossItem[];
  totalUnrealizedGain: number;
  totalUnrealizedLoss: number;
  netUnrealizedGainLoss: number;
}

interface CashFlowData {
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

interface CashFlowForecastProjection {
  week: number;
  weekStart: string;
  weekEnd: string;
  expectedInflows: number;
  expectedOutflows: number;
  projectedBalance: number;
}

interface CashFlowForecastReport {
  currentBalance: number;
  projections: CashFlowForecastProjection[];
  insights: string[];
}

interface MonthEndCloseChecklistItem {
  id: number;
  title: string;
  description: string;
  status: "complete" | "incomplete";
  details?: string;
}

interface MonthEndCloseReport {
  period: string;
  periodStart: string;
  periodEnd: string;
  checklist: MonthEndCloseChecklistItem[];
}

interface MonthEndCloseRecord {
  id: string;
  companyId: string;
  periodEnd: string;
  status: string;
  closedBy: string | null;
  closedByEmail?: string | null;
  closedAt: string | null;
  closingEntryId: string | null;
  createdAt: string;
}

interface AgingItem {
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

interface PeriodComparison {
  metric: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

interface GeneralLedgerTransaction {
  lineId: string;
  entryId: string;
  entryNumber: string;
  date: string;
  source: string;
  sourceId: string | null;
  memo: string | null;
  description: string | null;
  debit: number;
  credit: number;
  foreignCurrency: string | null;
  foreignDebit: number | null;
  foreignCredit: number | null;
  exchangeRate: number | null;
  balance: number;
}

interface GeneralLedgerAccount {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  transactionCount: number;
  transactions: GeneralLedgerTransaction[];
}

interface GeneralLedgerReport {
  reportCurrency: string;
  period: { from: string | null; to: string | null };
  accounts: GeneralLedgerAccount[];
  totals: {
    totalDebits: number;
    totalCredits: number;
    accountCount: number;
    transactionCount: number;
  };
}

interface BalanceSummaryRow {
  customerName?: string;
  vendorName?: string;
  invoiceCount?: number;
  billCount?: number;
  openInvoiceCount?: number;
  openBillCount?: number;
  overdueInvoiceCount?: number;
  overdueBillCount?: number;
  totalInvoiced?: number;
  totalBilled?: number;
  paidAmount: number;
  openBalance: number;
  overdueBalance: number;
  currentBalance: number;
  lastInvoiceDate?: string | null;
  lastBillDate?: string | null;
  lastPaymentDate?: string | null;
  nextDueDate?: string | null;
  chaseSuggested?: boolean;
  paymentSuggested?: boolean;
}

interface CustomerBalanceReport {
  reportCurrency: string;
  period: { from: string | null; to: string | null; asOf: string };
  rows: BalanceSummaryRow[];
  totals: {
    customerCount: number;
    invoiceCount: number;
    openInvoiceCount: number;
    overdueInvoiceCount: number;
    totalInvoiced: number;
    paidAmount: number;
    openBalance: number;
    overdueBalance: number;
  };
}

interface VendorBalanceReport {
  reportCurrency: string;
  period: { from: string | null; to: string | null; asOf: string };
  rows: BalanceSummaryRow[];
  totals: {
    vendorCount: number;
    billCount: number;
    openBillCount: number;
    overdueBillCount: number;
    totalBilled: number;
    paidAmount: number;
    openBalance: number;
    overdueBalance: number;
  };
}

interface RevenueByCustomerRow {
  customerName: string;
  invoiceCount: number;
  revenue: number;
  vatAmount: number;
  totalAmount: number;
  previousRevenue: number;
  change: number;
  changePercent: number;
  averageInvoiceValue: number;
  revenueShare: number;
  lastInvoiceDate: string | null;
  concentrationRisk: boolean;
}

interface RevenueByCustomerReport {
  reportCurrency: string;
  period: { from: string | null; to: string | null; asOf: string };
  rows: RevenueByCustomerRow[];
  totals: {
    customerCount: number;
    invoiceCount: number;
    revenue: number;
    previousRevenue: number;
    vatAmount: number;
    totalAmount: number;
  };
}

interface SalesByServiceRow {
  serviceName: string;
  quantity: number;
  lineCount: number;
  revenue: number;
  vatAmount: number;
  previousRevenue: number;
  change: number;
  changePercent: number;
  averageUnitRevenue: number;
  lastSoldDate: string | null;
  marginReviewSuggested: boolean;
}

interface SalesByServiceReport {
  reportCurrency: string;
  period: { from: string | null; to: string | null; asOf: string };
  rows: SalesByServiceRow[];
  totals: {
    serviceCount: number;
    lineCount: number;
    quantity: number;
    revenue: number;
    previousRevenue: number;
    vatAmount: number;
  };
}

interface ExpenseAnalysisRow {
  vendorName?: string;
  categoryName?: string;
  receiptCount: number;
  expenseAmount: number;
  vatAmount: number;
  totalSpend: number;
  previousExpenseAmount: number;
  change: number;
  changePercent: number;
  averageReceiptValue: number;
  lastReceiptDate: string | null;
  spendReviewSuggested?: boolean;
  budgetReviewSuggested?: boolean;
}

interface ExpenseAnalysisReport {
  reportCurrency: string;
  period: { from: string | null; to: string | null; asOf: string };
  rows: ExpenseAnalysisRow[];
  totals: {
    vendorCount?: number;
    categoryCount?: number;
    receiptCount: number;
    expenseAmount: number;
    previousExpenseAmount: number;
    vatAmount: number;
    totalSpend: number;
  };
}

interface InvoiceStatusRow {
  status: string;
  invoiceCount: number;
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  paidAmount: number;
  openBalance: number;
  overdueBalance: number;
  reminderQueue: number;
  previousTotalAmount: number;
  change: number;
  changePercent: number;
}

interface InvoiceStatusReport {
  reportCurrency: string;
  period: { from: string | null; to: string | null; asOf: string };
  rows: InvoiceStatusRow[];
  totals: {
    invoiceCount: number;
    subtotal: number;
    vatAmount: number;
    totalAmount: number;
    paidAmount: number;
    openBalance: number;
    overdueBalance: number;
    reminderQueue: number;
  };
}

interface BudgetVsActualRow {
  id: string;
  category: string;
  description: string | null;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  accountType: string | null;
  monthCount: number;
  budget: number;
  actual: number;
  variance: number;
  variancePercent: number;
  varianceTone: "favorable" | "unfavorable" | "neutral";
  unfavorable: boolean;
  automationSuggested: boolean;
}

interface BudgetVsActualReport {
  reportCurrency: string;
  budgetAvailable: boolean;
  budget: {
    id: string;
    name: string;
    fiscalYear: number;
    startDate: string;
    endDate: string;
    status: string;
  } | null;
  period: { from: string; to: string | null; asOf: string };
  rows: BudgetVsActualRow[];
  totals: {
    lineCount: number;
    budget: number;
    actual: number;
    variance: number;
    variancePercent: number;
    favorableCount: number;
    unfavorableCount: number;
    automationCount: number;
    unmappedLineCount: number;
  };
}

interface PayrollSummaryRow {
  runId: string;
  periodMonth: number;
  periodYear: number;
  periodLabel: string;
  runDate: string | null;
  employeeCount: number;
  totalBasic: number;
  totalAllowances: number;
  totalDeductions: number;
  totalNet: number;
  totalPensionEmployee: number;
  totalPensionEmployer: number;
  totalGratuityAccrual: number;
  totalEmployerCost: number;
  status: string;
  sifGenerated: boolean;
  wpsReady: boolean;
  journalEntryId: string | null;
  approvedAt: string | null;
  needsApproval: boolean;
  sifSuggested: boolean;
  postingSuggested: boolean;
}

interface PayrollSummaryReport {
  reportCurrency: string;
  period: {
    from: string;
    to: string | null;
    asOf: string;
    previousFrom: string;
    previousTo: string;
  };
  rows: PayrollSummaryRow[];
  totals: {
    runCount: number;
    employeeCount: number;
    totalBasic: number;
    totalAllowances: number;
    totalDeductions: number;
    totalNet: number;
    totalPensionEmployee: number;
    totalPensionEmployer: number;
    totalGratuityAccrual: number;
    totalEmployerCost: number;
    approvedRunCount: number;
    pendingApprovalCount: number;
    sifGeneratedCount: number;
    sifPendingCount: number;
    journalMissingCount: number;
    previousTotalNet: number;
    netChange: number;
    netChangePercent: number;
  };
}

interface CorporateTaxEstimateReport {
  reportCurrency: string;
  period: { from: string; to: string | null; asOf: string };
  rows: Array<{ type: string; accountCount: number; amount: number }>;
  totals: {
    totalRevenue: number;
    totalExpenses: number;
    taxableIncome: number;
    exemptionThreshold: number;
    taxableAmount: number;
    taxRate: number;
    taxPayable: number;
    journalEntriesProcessed: number;
    filingReviewSuggested: boolean;
  };
}

interface FixedAssetRegisterRow {
  assetId: string;
  assetName: string;
  assetNumber: string | null;
  category: string | null;
  status: string | null;
  purchaseDate: string;
  purchaseCost: number;
  salvageValue: number;
  usefulLifeYears: number | null;
  depreciationMethod: string | null;
  accumulatedDepreciation: number;
  netBookValue: number;
  location: string | null;
  needsCapitalizationJe: boolean;
}

interface FixedAssetRegisterReport {
  reportCurrency: string;
  tableAvailable: boolean;
  period: { asOf: string };
  rows: FixedAssetRegisterRow[];
  totals: {
    assetCount: number;
    purchaseCost: number;
    accumulatedDepreciation: number;
    netBookValue: number;
    capitalizationQueue: number;
  };
}

interface DepreciationScheduleRow {
  scheduleId: string;
  assetId: string;
  assetName: string;
  assetNumber: string | null;
  category: string | null;
  periodYear: number;
  periodMonth: number;
  periodLabel: string;
  amount: number;
  journalEntryId: string | null;
  posted: boolean;
}

interface DepreciationScheduleReport {
  reportCurrency: string;
  tableAvailable: boolean;
  period: { from: string; to: string | null; asOf: string };
  rows: DepreciationScheduleRow[];
  totals: {
    scheduleCount: number;
    postedCount: number;
    unpostedCount: number;
    depreciationAmount: number;
    postingQueue: number;
  };
}

interface InventoryValuationRow {
  productId: string;
  productName: string;
  sku: string | null;
  unit: string;
  stockOnHand: number;
  unitCost: number;
  unitPrice: number;
  inventoryValue: number;
  retailValue: number;
  grossMarginValue: number;
  grossMarginPercent: number;
  lowStockThreshold: number;
  lowStock: boolean;
  negativeStock: boolean;
  reorderSuggested: boolean;
  movementCount: number;
  lastMovementAt: string | null;
}

interface InventoryValuationReport {
  reportCurrency: string;
  period: { asOf: string };
  rows: InventoryValuationRow[];
  totals: {
    productCount: number;
    stockUnits: number;
    inventoryValue: number;
    retailValue: number;
    grossMarginValue: number;
    lowStockCount: number;
    negativeStockCount: number;
    reorderSuggestions: number;
    movementCount: number;
  };
}

type ReportPersona = "owner" | "freelancer" | "accountant";
type PersonaFilter = "all" | ReportPersona;
type ReportStatus = "live" | "workspace" | "api" | "planned";
type ReportTab =
  | "pl"
  | "bs"
  | "cashFlow"
  | "cashFlowForecast"
  | "vat"
  | "trial"
  | "ledger"
  | "vatReturn"
  | "aging"
  | "customers"
  | "vendors"
  | "revenueCustomers"
  | "salesServices"
  | "expenseVendors"
  | "expenseCategories"
  | "invoiceStatus"
  | "budgetActual"
  | "payrollSummary"
  | "corpTax"
  | "fixedAssets"
  | "depreciation"
  | "inventoryValuation"
  | "monthEndClose"
  | "comparison"
  | "fx";
type ReportPeriod = "month" | "quarter" | "year";

interface ReportCatalogItem {
  name: string;
  category: string;
  status: ReportStatus;
  personas: ReportPersona[];
  comparison: string;
  automation: string;
  icon: LucideIcon;
  tab?: ReportTab;
  href?: string;
}

interface ReportPackAction {
  label: string;
  href: string;
}

interface ReportPackDefinition {
  id: string;
  title: string;
  persona: ReportPersona;
  summary: string;
  cadence: string;
  delivery: string;
  reportNames: string[];
  actions: ReportPackAction[];
}

interface ReportPackSummary extends ReportPackDefinition {
  reports: ReportCatalogItem[];
  liveCount: number;
  readyCount: number;
  plannedCount: number;
  primaryTab?: ReportTab;
}

type ReportPackCadence = "weekly" | "monthly" | "quarterly";
type ReportPackChannel = "email" | "whatsapp" | "both";

interface ReportPackSchedule {
  packId: string;
  enabled: boolean;
  cadence: ReportPackCadence;
  channel: ReportPackChannel;
  recipients: string[];
  includeComparison: boolean;
  nextRunDate: string | null;
  updatedAt: string | null;
  lastPreparedAt: string | null;
  lastPreparedBy: string | null;
  isDue?: boolean;
  daysUntilRun?: number | null;
}

interface ReportPackScheduleDraft {
  cadence: ReportPackCadence;
  channel: ReportPackChannel;
  recipientsText: string;
  includeComparison: boolean;
}

interface ReportPackRunResult {
  notificationCount: number;
  deliveryCount: number;
  sentCount: number;
  queuedCount: number;
  failedCount: number;
}

interface ReportPackDeliveryHistoryItem {
  id: string;
  runId: string | null;
  packId: string | null;
  packTitle: string;
  channel: "email" | "whatsapp";
  status: string;
  recipient: string;
  subject: string | null;
  sentAt: string;
  preparedAt: string | null;
  cadence: string | null;
  includeComparison: boolean | null;
  provider: string | null;
  error: string | null;
}

type AutomationPriority = "high" | "medium" | "low";

interface ReportPackRecommendation {
  id: string;
  title: string;
  description: string;
  priority: AutomationPriority;
  actionLabel: string;
  actionUrl: string;
  sourceMetricKey?: string;
}

interface ReportPackRunHistoryItem {
  id: string;
  packId: string;
  packTitle: string;
  persona: ReportPersona;
  preparedAt: string;
  preparedBy: string | null;
  cadence: ReportPackCadence;
  channel: ReportPackChannel;
  recipients: string[];
  includeComparison: boolean;
  reportNames: string[];
  automationActions: string[];
  snapshotMetrics: Array<{
    key: string;
    label: string;
    value: number | string;
    type: "currency" | "number" | "percent" | "text";
    description: string;
    tone?: "positive" | "warning" | "danger" | "neutral";
  }>;
  recommendations: ReportPackRecommendation[];
  nextRunDate: string | null;
  notificationCount: number;
  deliveryCount: number;
  sentCount: number;
  queuedCount: number;
  failedCount: number;
}

interface AutomationQueueItem {
  id: string;
  title: string;
  description: string;
  source: string;
  personas: ReportPersona[];
  priority: AutomationPriority;
  count: number;
  impact: number;
  tab?: ReportTab;
  href?: string;
  actionLabel: string;
}

const personaFilters: Array<{ id: PersonaFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "owner", label: "Owner" },
  { id: "freelancer", label: "Freelancer" },
  { id: "accountant", label: "Accountant" },
];

const reportStatusMeta = {
  live: { label: "Live", variant: "success" as const },
  workspace: { label: "Workspace", variant: "info" as const },
  api: { label: "API ready", variant: "warning" as const },
  planned: { label: "Planned", variant: "neutral" as const },
};

const automationPriorityMeta: Record<
  AutomationPriority,
  { label: string; variant: "danger" | "warning" | "neutral" }
> = {
  high: { label: "High", variant: "danger" },
  medium: { label: "Medium", variant: "warning" },
  low: { label: "Monitor", variant: "neutral" },
};

const automationPriorityWeight: Record<AutomationPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const reportPeriodOptions: Array<{ id: ReportPeriod; label: string }> = [
  { id: "month", label: "Monthly" },
  { id: "quarter", label: "Quarterly" },
  { id: "year", label: "Yearly" },
];

const reportPackCadenceOptions: Array<{ id: ReportPackCadence; label: string }> = [
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "Quarterly" },
];

const reportPackChannelOptions: Array<{ id: ReportPackChannel; label: string }> = [
  { id: "email", label: "Email" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "both", label: "Both" },
];

const reportCatalog: ReportCatalogItem[] = [
  {
    name: "Profit & Loss",
    category: "Financial Statements",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Period, budget",
    automation: "Margin review",
    icon: BarChart3,
    tab: "pl",
  },
  {
    name: "Balance Sheet",
    category: "Financial Statements",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Prior period",
    automation: "Risk flags",
    icon: Landmark,
    tab: "bs",
  },
  {
    name: "Cash Flow Statement",
    category: "Financial Statements",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Monthly, quarterly",
    automation: "Cash actions",
    icon: TrendingUp,
    tab: "cashFlow",
  },
  {
    name: "Trial Balance",
    category: "Financial Statements",
    status: "live",
    personas: ["accountant"],
    comparison: "Period close",
    automation: "Out-of-balance flags",
    icon: ClipboardCheck,
    tab: "trial",
  },
  {
    name: "General Ledger",
    category: "Financial Statements",
    status: "live",
    personas: ["accountant"],
    comparison: "Account history",
    automation: "Reclassification hints",
    icon: BookOpen,
    tab: "ledger",
  },
  {
    name: "Account Transactions",
    category: "Financial Statements",
    status: "workspace",
    personas: ["accountant"],
    comparison: "Account history",
    automation: "Source drill-down",
    icon: BookOpen,
    href: "/accounts",
  },
  {
    name: "VAT Summary",
    category: "Tax",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Tax period",
    automation: "VAT readiness",
    icon: ShieldCheck,
    tab: "vat",
  },
  {
    name: "VAT Return",
    category: "Tax",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Tax period",
    automation: "FTA checklist",
    icon: ShieldCheck,
    tab: "vatReturn",
  },
  {
    name: "Corporate Tax Estimate",
    category: "Tax",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Year to date",
    automation: "Filing checklist",
    icon: Landmark,
    tab: "corpTax",
  },
  {
    name: "A/R Aging",
    category: "Sales",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Aging buckets",
    automation: "Payment chasing",
    icon: Users,
    tab: "aging",
  },
  {
    name: "A/P Aging",
    category: "Purchases",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Aging buckets",
    automation: "Payment scheduling",
    icon: ReceiptText,
    tab: "aging",
  },
  {
    name: "Customer Balance Summary",
    category: "Sales",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Prior period",
    automation: "Chase priority",
    icon: Users,
    tab: "customers",
  },
  {
    name: "Vendor Balance Summary",
    category: "Purchases",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Prior period",
    automation: "Due-date alerts",
    icon: Briefcase,
    tab: "vendors",
  },
  {
    name: "Invoice Status",
    category: "Sales",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Open, overdue, paid",
    automation: "Reminder queue",
    icon: FileText,
    tab: "invoiceStatus",
  },
  {
    name: "Period Comparison",
    category: "Management",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Month, quarter, year",
    automation: "Variance review",
    icon: TrendingUp,
    tab: "comparison",
  },
  {
    name: "Budget vs Actual",
    category: "Management",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Budget",
    automation: "Variance alerts",
    icon: BarChart3,
    tab: "budgetActual",
  },
  {
    name: "Cash Flow Forecast",
    category: "Management",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Forecast",
    automation: "Cash warnings",
    icon: Sparkles,
    tab: "cashFlowForecast",
  },
  {
    name: "Revenue by Customer",
    category: "Sales",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Period, year",
    automation: "Client insights",
    icon: Users,
    tab: "revenueCustomers",
  },
  {
    name: "Sales by Product/Service",
    category: "Sales",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Period, margin",
    automation: "Margin alerts",
    icon: Package,
    tab: "salesServices",
  },
  {
    name: "Expenses by Vendor",
    category: "Purchases",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Period, vendor",
    automation: "Spend review",
    icon: Briefcase,
    tab: "expenseVendors",
  },
  {
    name: "Expenses by Category",
    category: "Purchases",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Period, budget",
    automation: "Cost alerts",
    icon: ReceiptText,
    tab: "expenseCategories",
  },
  {
    name: "FX Gains and Losses",
    category: "Financial Statements",
    status: "live",
    personas: ["accountant"],
    comparison: "As of date",
    automation: "Exposure flags",
    icon: Landmark,
    tab: "fx",
  },
  {
    name: "Inventory Valuation",
    category: "Inventory",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "As of date",
    automation: "Stock risk",
    icon: Package,
    tab: "inventoryValuation",
  },
  {
    name: "Inventory Movement",
    category: "Inventory",
    status: "workspace",
    personas: ["owner", "accountant"],
    comparison: "Period movement",
    automation: "Reorder alerts",
    icon: Package,
    href: "/inventory",
  },
  {
    name: "Fixed Asset Register",
    category: "Assets",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "As of date",
    automation: "Capitalization review",
    icon: Building2,
    tab: "fixedAssets",
  },
  {
    name: "Depreciation Schedule",
    category: "Assets",
    status: "live",
    personas: ["accountant"],
    comparison: "Period, asset",
    automation: "Posting suggestions",
    icon: Building2,
    tab: "depreciation",
  },
  {
    name: "Payroll Summary",
    category: "Payroll",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Pay period",
    automation: "Variance checks",
    icon: Users,
    tab: "payrollSummary",
  },
  {
    name: "WPS / SIF Summary",
    category: "Payroll",
    status: "workspace",
    personas: ["owner", "accountant"],
    comparison: "Pay run",
    automation: "WPS readiness",
    icon: ShieldCheck,
    href: "/payroll",
  },
  {
    name: "Expense Claims",
    category: "Purchases",
    status: "workspace",
    personas: ["owner", "accountant"],
    comparison: "Claim status",
    automation: "Approval routing",
    icon: ReceiptText,
    href: "/expense-claims",
  },
  {
    name: "Month-End Close Status",
    category: "Accountant Tools",
    status: "live",
    personas: ["accountant"],
    comparison: "Close period",
    automation: "Close checklist",
    icon: ClipboardCheck,
    tab: "monthEndClose",
  },
  {
    name: "Audit Trail",
    category: "Accountant Tools",
    status: "workspace",
    personas: ["accountant"],
    comparison: "Activity period",
    automation: "Risk summary",
    icon: ClipboardCheck,
    href: "/history",
  },
  {
    name: "Consolidated Statements",
    category: "Accountant Tools",
    status: "planned",
    personas: ["accountant"],
    comparison: "Multi-company",
    automation: "Report packs",
    icon: Building2,
  },
];

const reportPackDefinitions: ReportPackDefinition[] = [
  {
    id: "owner-command-pack",
    title: "Owner Command Pack",
    persona: "owner",
    summary: "Cash, profit, receivables, taxes, and spend in one repeatable pack.",
    cadence: "Weekly cash review, monthly close, quarterly tax",
    delivery: "Excel now; scheduled email/WhatsApp queued",
    reportNames: [
      "Profit & Loss",
      "Balance Sheet",
      "Cash Flow Statement",
      "Invoice Status",
      "A/R Aging",
      "A/P Aging",
      "Expenses by Category",
      "VAT Summary",
      "Corporate Tax Estimate",
      "Period Comparison",
      "Budget vs Actual",
      "Payroll Summary",
      "Inventory Valuation",
      "Cash Flow Forecast",
    ],
    actions: [
      { label: "Chase payments", href: "/payment-chasing" },
      { label: "Forecast cash", href: "/cashflow-forecast" },
      { label: "Review VAT", href: "/vat-autopilot" },
    ],
  },
  {
    id: "freelancer-control-pack",
    title: "Freelancer Control Pack",
    persona: "freelancer",
    summary: "Client income, unpaid invoices, expense leakage, and tax set-aside.",
    cadence: "Monthly client review and tax-ready snapshot",
    delivery: "Excel now; client statement delivery queued",
    reportNames: [
      "Profit & Loss",
      "Cash Flow Statement",
      "Invoice Status",
      "Customer Balance Summary",
      "Revenue by Customer",
      "Expenses by Category",
      "VAT Summary",
      "Period Comparison",
      "Cash Flow Forecast",
    ],
    actions: [
      { label: "Send reminders", href: "/payment-chasing" },
      { label: "Capture receipts", href: "/receipt-autopilot" },
      { label: "Set recurring work", href: "/recurring-invoices" },
    ],
  },
  {
    id: "accountant-close-pack",
    title: "Accountant Close Pack",
    persona: "accountant",
    summary: "Close-ready financials, ledgers, tax workpapers, assets, and review queues.",
    cadence: "Month-end close and quarterly compliance",
    delivery: "Excel now; bulk client packs queued",
    reportNames: [
      "Trial Balance",
      "General Ledger",
      "Profit & Loss",
      "Balance Sheet",
      "VAT Return",
      "Corporate Tax Estimate",
      "Customer Balance Summary",
      "Vendor Balance Summary",
      "A/P Aging",
      "Budget vs Actual",
      "Payroll Summary",
      "Inventory Valuation",
      "Fixed Asset Register",
      "Depreciation Schedule",
      "FX Gains and Losses",
      "Month-End Close Status",
      "Audit Trail",
    ],
    actions: [
      { label: "Close month", href: "/month-end" },
      { label: "Chase documents", href: "/firm/document-chasing" },
      { label: "Review anomalies", href: "/anomaly-detection" },
    ],
  },
];

function amountForExport(value: number | undefined | null): string {
  return (value ?? 0).toFixed(2);
}

function prepareTrialBalanceForExport(report: TrialBalanceReport): ExportData {
  return {
    sheetName: "Trial Balance",
    columns: [
      { header: "Code", key: "code", width: 12 },
      { header: "Account", key: "account", width: 34 },
      { header: "Type", key: "type", width: 14 },
      { header: "Debit", key: "debit", width: 15 },
      { header: "Credit", key: "credit", width: 15 },
      { header: "Balance", key: "balance", width: 15 },
      { header: "Foreign Lines", key: "foreignLines", width: 14 },
    ],
    rows: [
      ...report.rows.map((row) => ({
        code: row.accountCode || "",
        account: row.accountName,
        type: row.accountType,
        debit: amountForExport(row.totalDebit),
        credit: amountForExport(row.totalCredit),
        balance: amountForExport(row.balance),
        foreignLines: row.hasForeignLines ? "Yes" : "No",
      })),
      {
        code: "",
        account: "TOTAL",
        type: "",
        debit: amountForExport(report.totals.sumDebits),
        credit: amountForExport(report.totals.sumCredits),
        balance: `Difference: ${amountForExport(report.totals.difference)}`,
        foreignLines: "",
      },
    ],
  };
}

function prepareVATReturnForExport(report: VATReturnReport): ExportData {
  return {
    sheetName: "VAT Return",
    columns: [
      { header: "Box", key: "box", width: 12 },
      { header: "Description", key: "description", width: 38 },
      { header: "Amount (AED)", key: "amount", width: 16 },
    ],
    rows: [
      {
        box: "Box 1",
        description: "Standard-rated supplies",
        amount: amountForExport(report.box1_standardRatedSupplies),
      },
      {
        box: "Box 2",
        description: "Zero-rated supplies",
        amount: amountForExport(report.box2_zeroRatedSupplies),
      },
      {
        box: "Box 3",
        description: "Exempt supplies",
        amount: amountForExport(report.box3_exemptSupplies),
      },
      {
        box: "Box 4",
        description: "Total supplies",
        amount: amountForExport(report.box4_totalSupplies),
      },
      {
        box: "Box 5",
        description: "Output VAT",
        amount: amountForExport(report.box5_outputVat),
      },
      {
        box: "Box 6",
        description: "Standard-rated expenses",
        amount: amountForExport(report.box6_standardRatedExpenses),
      },
      {
        box: "Box 7",
        description: "Input VAT recoverable",
        amount: amountForExport(report.box7_inputVatRecoverable),
      },
      {
        box: "Box 8",
        description: "Net VAT due",
        amount: amountForExport(report.box8_netVatDue),
      },
    ],
  };
}

function prepareFxGainsLossesForExport(report: FxGainsLossesReport): ExportData {
  const items = [...report.receivables, ...report.payables];
  return {
    sheetName: "FX Gains Losses",
    columns: [
      { header: "Type", key: "type", width: 12 },
      { header: "Number", key: "number", width: 18 },
      { header: "Counterparty", key: "counterparty", width: 28 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Foreign Amount", key: "foreignAmount", width: 16 },
      { header: "Transaction Rate", key: "transactionRate", width: 16 },
      { header: "Current Rate", key: "currentRate", width: 16 },
      { header: "Book Value AED", key: "bookValueAed", width: 16 },
      { header: "Current Value AED", key: "currentValueAed", width: 18 },
      { header: "Gain/Loss AED", key: "gainLoss", width: 16 },
    ],
    rows: [
      ...items.map((item) => ({
        type: item.entityType,
        number: item.entityNumber,
        counterparty: item.counterparty,
        currency: item.currency,
        foreignAmount: amountForExport(item.foreignAmount),
        transactionRate: amountForExport(item.transactionRate),
        currentRate: amountForExport(item.currentRate),
        bookValueAed: amountForExport(item.bookValueAed),
        currentValueAed: amountForExport(item.currentValueAed),
        gainLoss: amountForExport(item.unrealizedGainLoss),
      })),
      {
        type: "",
        number: "",
        counterparty: "TOTAL UNREALIZED GAIN",
        currency: "AED",
        foreignAmount: "",
        transactionRate: "",
        currentRate: "",
        bookValueAed: "",
        currentValueAed: "",
        gainLoss: amountForExport(report.totalUnrealizedGain),
      },
      {
        type: "",
        number: "",
        counterparty: "TOTAL UNREALIZED LOSS",
        currency: "AED",
        foreignAmount: "",
        transactionRate: "",
        currentRate: "",
        bookValueAed: "",
        currentValueAed: "",
        gainLoss: amountForExport(report.totalUnrealizedLoss),
      },
      {
        type: "",
        number: "",
        counterparty: "NET UNREALIZED GAIN/LOSS",
        currency: "AED",
        foreignAmount: "",
        transactionRate: "",
        currentRate: "",
        bookValueAed: "",
        currentValueAed: "",
        gainLoss: amountForExport(report.netUnrealizedGainLoss),
      },
    ],
  };
}

function prepareCashFlowForExport(data: CashFlowData[]): ExportData {
  return {
    sheetName: "Cash Flow",
    columns: [
      { header: "Period", key: "period", width: 14 },
      { header: "Operating Inflow", key: "operatingInflow", width: 18 },
      { header: "Operating Outflow", key: "operatingOutflow", width: 18 },
      { header: "Operating Net", key: "operatingNet", width: 16 },
      { header: "Investing Net", key: "investingNet", width: 16 },
      { header: "Financing Net", key: "financingNet", width: 16 },
      { header: "Net Cash Flow", key: "netCashFlow", width: 16 },
      { header: "Ending Balance", key: "endingBalance", width: 18 },
    ],
    rows: data.map((row) => ({
      period: row.period,
      operatingInflow: amountForExport(row.operatingInflow),
      operatingOutflow: amountForExport(row.operatingOutflow),
      operatingNet: amountForExport(row.operatingInflow - row.operatingOutflow),
      investingNet: amountForExport(row.investingInflow - row.investingOutflow),
      financingNet: amountForExport(row.financingInflow - row.financingOutflow),
      netCashFlow: amountForExport(row.netCashFlow),
      endingBalance: amountForExport(row.endingBalance),
    })),
  };
}

function prepareCashFlowForecastForExport(report: CashFlowForecastReport): ExportData {
  return {
    sheetName: "Cash Flow Forecast",
    columns: [
      { header: "Week", key: "week", width: 12 },
      { header: "Start", key: "start", width: 14 },
      { header: "End", key: "end", width: 14 },
      { header: "Expected Inflows", key: "expectedInflows", width: 18 },
      { header: "Expected Outflows", key: "expectedOutflows", width: 18 },
      { header: "Net Movement", key: "netMovement", width: 16 },
      { header: "Projected Balance", key: "projectedBalance", width: 18 },
      { header: "Risk", key: "risk", width: 14 },
      { header: "Insight", key: "insight", width: 64 },
    ],
    rows: [
      {
        week: "Current",
        start: "",
        end: "",
        expectedInflows: "",
        expectedOutflows: "",
        netMovement: "",
        projectedBalance: amountForExport(report.currentBalance),
        risk: report.currentBalance < 0 ? "Negative" : report.currentBalance < 10000 ? "Low" : "",
        insight: "",
      },
      ...report.projections.map((row) => {
        const netMovement = row.expectedInflows - row.expectedOutflows;
        return {
          week: row.week,
          start: formatDateForExport(row.weekStart),
          end: formatDateForExport(row.weekEnd),
          expectedInflows: amountForExport(row.expectedInflows),
          expectedOutflows: amountForExport(row.expectedOutflows),
          netMovement: amountForExport(netMovement),
          projectedBalance: amountForExport(row.projectedBalance),
          risk: row.projectedBalance < 0 ? "Negative" : row.projectedBalance < 10000 ? "Low" : "",
          insight: "",
        };
      }),
      ...report.insights.map((insight, index) => ({
        week: `Insight ${index + 1}`,
        start: "",
        end: "",
        expectedInflows: "",
        expectedOutflows: "",
        netMovement: "",
        projectedBalance: "",
        risk: insight.toLowerCase().includes("warning") ? "Risk" : "Info",
        insight,
      })),
    ],
  };
}

function prepareMonthEndCloseForExport(
  report: MonthEndCloseReport,
  history: MonthEndCloseRecord[] = []
): ExportData {
  const periodHistory = history.filter((record) =>
    formatDateForExport(record.periodEnd).startsWith(report.period)
  );

  return {
    sheetName: "Month-End Close",
    columns: [
      { header: "Section", key: "section", width: 16 },
      { header: "Period", key: "period", width: 14 },
      { header: "Item", key: "item", width: 34 },
      { header: "Status", key: "status", width: 14 },
      { header: "Details", key: "details", width: 52 },
      { header: "Closed By", key: "closedBy", width: 28 },
      { header: "Closed At", key: "closedAt", width: 18 },
      { header: "Closing Entry", key: "closingEntry", width: 18 },
    ],
    rows: [
      ...report.checklist.map((item) => ({
        section: "Checklist",
        period: report.period,
        item: item.title,
        status: item.status,
        details: item.details || item.description,
        closedBy: "",
        closedAt: "",
        closingEntry: "",
      })),
      ...(periodHistory.length
        ? periodHistory
        : [
            {
              id: "current-open",
              companyId: "",
              periodEnd: report.periodEnd,
              status: "open",
              closedBy: null,
              closedByEmail: null,
              closedAt: null,
              closingEntryId: null,
              createdAt: "",
            },
          ]
      ).map((record) => ({
        section: "Close History",
        period: formatDateForExport(record.periodEnd).slice(0, 7) || report.period,
        item: "Period status",
        status: record.status,
        details:
          record.status === "locked"
            ? "Period locked against further posting"
            : "No locked close record for this period",
        closedBy: record.closedByEmail || record.closedBy || "",
        closedAt: formatDateForExport(record.closedAt),
        closingEntry: record.closingEntryId || "",
      })),
    ],
  };
}

function prepareAgingForExport(data: AgingItem[]): ExportData {
  return {
    sheetName: "A/R and A/P Aging",
    columns: [
      { header: "Name", key: "name", width: 30 },
      { header: "Type", key: "type", width: 14 },
      { header: "Current", key: "current", width: 14 },
      { header: "1-30", key: "days30", width: 14 },
      { header: "31-60", key: "days60", width: 14 },
      { header: "61-90", key: "days90", width: 14 },
      { header: ">90", key: "over90", width: 14 },
      { header: "Total", key: "total", width: 16 },
    ],
    rows: data.map((row) => ({
      name: row.name,
      type: row.type,
      current: amountForExport(row.current),
      days30: amountForExport(row.days30),
      days60: amountForExport(row.days60),
      days90: amountForExport(row.days90),
      over90: amountForExport(row.over90),
      total: amountForExport(row.total),
    })),
  };
}

function preparePeriodComparisonForExport(data: PeriodComparison[]): ExportData {
  return {
    sheetName: "Period Comparison",
    columns: [
      { header: "Metric", key: "metric", width: 24 },
      { header: "Current", key: "current", width: 16 },
      { header: "Previous", key: "previous", width: 16 },
      { header: "Change", key: "change", width: 16 },
      { header: "Change %", key: "changePercent", width: 12 },
    ],
    rows: data.map((row) => ({
      metric: row.metric,
      current: comparisonAmountForExport(row.metric, row.current),
      previous: comparisonAmountForExport(row.metric, row.previous),
      change: comparisonAmountForExport(row.metric, row.change),
      changePercent: `${row.changePercent.toFixed(1)}%`,
    })),
  };
}

function prepareGeneralLedgerForExport(report: GeneralLedgerReport): ExportData {
  return {
    sheetName: "General Ledger",
    columns: [
      { header: "Account Code", key: "accountCode", width: 14 },
      { header: "Account", key: "account", width: 30 },
      { header: "Type", key: "type", width: 14 },
      { header: "Date", key: "date", width: 14 },
      { header: "Entry", key: "entry", width: 18 },
      { header: "Source", key: "source", width: 14 },
      { header: "Description", key: "description", width: 36 },
      { header: "Debit", key: "debit", width: 14 },
      { header: "Credit", key: "credit", width: 14 },
      { header: "Running Balance", key: "balance", width: 18 },
      { header: "Closing Balance", key: "closingBalance", width: 18 },
    ],
    rows: report.accounts.flatMap((account) => {
      if (account.transactions.length === 0) {
        return [
          {
            accountCode: account.accountCode,
            account: account.accountName,
            type: account.accountType,
            date: "",
            entry: "",
            source: "",
            description: "No period transactions",
            debit: amountForExport(account.periodDebit),
            credit: amountForExport(account.periodCredit),
            balance: amountForExport(account.openingBalance),
            closingBalance: amountForExport(account.closingBalance),
          },
        ];
      }

      return account.transactions.map((transaction) => ({
        accountCode: account.accountCode,
        account: account.accountName,
        type: account.accountType,
        date: formatDateForExport(transaction.date),
        entry: transaction.entryNumber,
        source: transaction.source,
        description: transaction.description || transaction.memo || "",
        debit: amountForExport(transaction.debit),
        credit: amountForExport(transaction.credit),
        balance: amountForExport(transaction.balance),
        closingBalance: amountForExport(account.closingBalance),
      }));
    }),
  };
}

function prepareCustomerBalancesForExport(report: CustomerBalanceReport): ExportData {
  return {
    sheetName: "Customer Balances",
    columns: [
      { header: "Customer", key: "name", width: 30 },
      { header: "Invoices", key: "count", width: 12 },
      { header: "Open Invoices", key: "openCount", width: 14 },
      { header: "Overdue Invoices", key: "overdueCount", width: 16 },
      { header: "Total Invoiced", key: "total", width: 16 },
      { header: "Paid", key: "paid", width: 16 },
      { header: "Current", key: "current", width: 16 },
      { header: "Overdue", key: "overdue", width: 16 },
      { header: "Open Balance", key: "open", width: 16 },
      { header: "Automation", key: "automation", width: 18 },
    ],
    rows: report.rows.map((row) => ({
      name: row.customerName || "",
      count: row.invoiceCount ?? 0,
      openCount: row.openInvoiceCount ?? 0,
      overdueCount: row.overdueInvoiceCount ?? 0,
      total: amountForExport(row.totalInvoiced),
      paid: amountForExport(row.paidAmount),
      current: amountForExport(row.currentBalance),
      overdue: amountForExport(row.overdueBalance),
      open: amountForExport(row.openBalance),
      automation: row.chaseSuggested ? "Chase suggested" : "",
    })),
  };
}

function prepareVendorBalancesForExport(report: VendorBalanceReport): ExportData {
  return {
    sheetName: "Vendor Balances",
    columns: [
      { header: "Vendor", key: "name", width: 30 },
      { header: "Bills", key: "count", width: 12 },
      { header: "Open Bills", key: "openCount", width: 14 },
      { header: "Overdue Bills", key: "overdueCount", width: 16 },
      { header: "Total Billed", key: "total", width: 16 },
      { header: "Paid", key: "paid", width: 16 },
      { header: "Current", key: "current", width: 16 },
      { header: "Overdue", key: "overdue", width: 16 },
      { header: "Open Balance", key: "open", width: 16 },
      { header: "Automation", key: "automation", width: 18 },
    ],
    rows: report.rows.map((row) => ({
      name: row.vendorName || "",
      count: row.billCount ?? 0,
      openCount: row.openBillCount ?? 0,
      overdueCount: row.overdueBillCount ?? 0,
      total: amountForExport(row.totalBilled),
      paid: amountForExport(row.paidAmount),
      current: amountForExport(row.currentBalance),
      overdue: amountForExport(row.overdueBalance),
      open: amountForExport(row.openBalance),
      automation: row.paymentSuggested ? "Payment review" : "",
    })),
  };
}

function prepareRevenueByCustomerForExport(report: RevenueByCustomerReport): ExportData {
  return {
    sheetName: "Revenue by Customer",
    columns: [
      { header: "Customer", key: "name", width: 30 },
      { header: "Invoices", key: "count", width: 12 },
      { header: "Revenue", key: "revenue", width: 16 },
      { header: "Previous Revenue", key: "previous", width: 18 },
      { header: "Change", key: "change", width: 16 },
      { header: "Change %", key: "changePercent", width: 12 },
      { header: "Average Invoice", key: "average", width: 16 },
      { header: "Share %", key: "share", width: 12 },
      { header: "Automation", key: "automation", width: 20 },
    ],
    rows: report.rows.map((row) => ({
      name: row.customerName,
      count: row.invoiceCount,
      revenue: amountForExport(row.revenue),
      previous: amountForExport(row.previousRevenue),
      change: amountForExport(row.change),
      changePercent: `${row.changePercent.toFixed(1)}%`,
      average: amountForExport(row.averageInvoiceValue),
      share: `${row.revenueShare.toFixed(1)}%`,
      automation: row.concentrationRisk ? "Concentration review" : "",
    })),
  };
}

function prepareSalesByServiceForExport(report: SalesByServiceReport): ExportData {
  return {
    sheetName: "Sales by Service",
    columns: [
      { header: "Product/Service", key: "name", width: 34 },
      { header: "Quantity", key: "quantity", width: 12 },
      { header: "Lines", key: "lines", width: 12 },
      { header: "Revenue", key: "revenue", width: 16 },
      { header: "Previous Revenue", key: "previous", width: 18 },
      { header: "Change", key: "change", width: 16 },
      { header: "Change %", key: "changePercent", width: 12 },
      { header: "Avg Unit Revenue", key: "average", width: 18 },
      { header: "Automation", key: "automation", width: 18 },
    ],
    rows: report.rows.map((row) => ({
      name: row.serviceName,
      quantity: amountForExport(row.quantity),
      lines: row.lineCount,
      revenue: amountForExport(row.revenue),
      previous: amountForExport(row.previousRevenue),
      change: amountForExport(row.change),
      changePercent: `${row.changePercent.toFixed(1)}%`,
      average: amountForExport(row.averageUnitRevenue),
      automation: row.marginReviewSuggested ? "Margin review" : "",
    })),
  };
}

function prepareExpensesByVendorForExport(report: ExpenseAnalysisReport): ExportData {
  return prepareExpenseAnalysisForExport(report, "Expenses by Vendor", "Vendor", "vendorName");
}

function prepareExpensesByCategoryForExport(report: ExpenseAnalysisReport): ExportData {
  return prepareExpenseAnalysisForExport(
    report,
    "Expenses by Category",
    "Category",
    "categoryName"
  );
}

function prepareExpenseAnalysisForExport(
  report: ExpenseAnalysisReport,
  sheetName: string,
  label: string,
  nameKey: "vendorName" | "categoryName"
): ExportData {
  return {
    sheetName,
    columns: [
      { header: label, key: "name", width: 30 },
      { header: "Receipts", key: "count", width: 12 },
      { header: "Expense", key: "expense", width: 16 },
      { header: "Previous Expense", key: "previous", width: 18 },
      { header: "Change", key: "change", width: 16 },
      { header: "Change %", key: "changePercent", width: 12 },
      { header: "VAT", key: "vat", width: 14 },
      { header: "Total Spend", key: "total", width: 16 },
      { header: "Automation", key: "automation", width: 18 },
    ],
    rows: report.rows.map((row) => ({
      name: row[nameKey] || "",
      count: row.receiptCount,
      expense: amountForExport(row.expenseAmount),
      previous: amountForExport(row.previousExpenseAmount),
      change: amountForExport(row.change),
      changePercent: `${row.changePercent.toFixed(1)}%`,
      vat: amountForExport(row.vatAmount),
      total: amountForExport(row.totalSpend),
      automation: row.spendReviewSuggested || row.budgetReviewSuggested ? "Review suggested" : "",
    })),
  };
}

function prepareInvoiceStatusForExport(report: InvoiceStatusReport): ExportData {
  return {
    sheetName: "Invoice Status",
    columns: [
      { header: "Status", key: "status", width: 16 },
      { header: "Invoices", key: "count", width: 12 },
      { header: "Subtotal", key: "subtotal", width: 16 },
      { header: "VAT", key: "vat", width: 14 },
      { header: "Total", key: "total", width: 16 },
      { header: "Paid", key: "paid", width: 16 },
      { header: "Open", key: "open", width: 16 },
      { header: "Overdue", key: "overdue", width: 16 },
      { header: "Previous", key: "previous", width: 16 },
      { header: "Change %", key: "changePercent", width: 12 },
      { header: "Reminder Queue", key: "reminderQueue", width: 16 },
    ],
    rows: report.rows.map((row) => ({
      status: row.status,
      count: row.invoiceCount,
      subtotal: amountForExport(row.subtotal),
      vat: amountForExport(row.vatAmount),
      total: amountForExport(row.totalAmount),
      paid: amountForExport(row.paidAmount),
      open: amountForExport(row.openBalance),
      overdue: amountForExport(row.overdueBalance),
      previous: amountForExport(row.previousTotalAmount),
      changePercent: `${row.changePercent.toFixed(1)}%`,
      reminderQueue: row.reminderQueue,
    })),
  };
}

function prepareBudgetVsActualForExport(report: BudgetVsActualReport): ExportData {
  return {
    sheetName: "Budget vs Actual",
    columns: [
      { header: "Category", key: "category", width: 28 },
      { header: "Account", key: "account", width: 30 },
      { header: "Type", key: "type", width: 14 },
      { header: "Months", key: "months", width: 10 },
      { header: "Budget", key: "budget", width: 16 },
      { header: "Actual", key: "actual", width: 16 },
      { header: "Variance", key: "variance", width: 16 },
      { header: "Variance %", key: "variancePercent", width: 12 },
      { header: "Tone", key: "tone", width: 14 },
      { header: "Automation", key: "automation", width: 22 },
    ],
    rows: report.rows.map((row) => ({
      category: row.category,
      account: row.accountName || "",
      type: row.accountType || "",
      months: row.monthCount,
      budget: amountForExport(row.budget),
      actual: amountForExport(row.actual),
      variance: amountForExport(row.variance),
      variancePercent: `${row.variancePercent.toFixed(1)}%`,
      tone: row.varianceTone,
      automation: row.automationSuggested ? "Variance review" : "",
    })),
  };
}

function preparePayrollSummaryForExport(report: PayrollSummaryReport): ExportData {
  return {
    sheetName: "Payroll Summary",
    columns: [
      { header: "Period", key: "period", width: 12 },
      { header: "Status", key: "status", width: 14 },
      { header: "Employees", key: "employees", width: 12 },
      { header: "Basic", key: "basic", width: 16 },
      { header: "Allowances", key: "allowances", width: 16 },
      { header: "Deductions", key: "deductions", width: 16 },
      { header: "Net Pay", key: "netPay", width: 16 },
      { header: "Employer Pension", key: "employerPension", width: 18 },
      { header: "Gratuity Accrual", key: "gratuity", width: 18 },
      { header: "Employer Cost", key: "employerCost", width: 18 },
      { header: "SIF Generated", key: "sif", width: 14 },
      { header: "Journal Posted", key: "journal", width: 14 },
      { header: "Automation", key: "automation", width: 24 },
    ],
    rows: report.rows.map((row) => ({
      period: row.periodLabel,
      status: row.status,
      employees: row.employeeCount,
      basic: amountForExport(row.totalBasic),
      allowances: amountForExport(row.totalAllowances),
      deductions: amountForExport(row.totalDeductions),
      netPay: amountForExport(row.totalNet),
      employerPension: amountForExport(row.totalPensionEmployer),
      gratuity: amountForExport(row.totalGratuityAccrual),
      employerCost: amountForExport(row.totalEmployerCost),
      sif: row.sifGenerated ? "Yes" : "No",
      journal: row.journalEntryId ? "Yes" : "No",
      automation: [
        row.needsApproval ? "Approval review" : "",
        row.sifSuggested ? "Generate SIF" : "",
        row.postingSuggested ? "Posting review" : "",
      ]
        .filter(Boolean)
        .join(", "),
    })),
  };
}

function prepareCorporateTaxEstimateForExport(report: CorporateTaxEstimateReport): ExportData {
  return {
    sheetName: "Corporate Tax Estimate",
    columns: [
      { header: "Metric", key: "metric", width: 28 },
      { header: "Amount", key: "amount", width: 18 },
    ],
    rows: [
      { metric: "Total Revenue", amount: amountForExport(report.totals.totalRevenue) },
      { metric: "Total Expenses", amount: amountForExport(report.totals.totalExpenses) },
      { metric: "Taxable Income", amount: amountForExport(report.totals.taxableIncome) },
      { metric: "Exemption Threshold", amount: amountForExport(report.totals.exemptionThreshold) },
      { metric: "Taxable Amount", amount: amountForExport(report.totals.taxableAmount) },
      { metric: "Tax Rate", amount: `${(report.totals.taxRate * 100).toFixed(1)}%` },
      { metric: "Tax Payable", amount: amountForExport(report.totals.taxPayable) },
      {
        metric: "Journal Entries Processed",
        amount: String(report.totals.journalEntriesProcessed),
      },
      {
        metric: "Automation",
        amount: report.totals.filingReviewSuggested ? "Filing review suggested" : "Clear",
      },
    ],
  };
}

function prepareFixedAssetRegisterForExport(report: FixedAssetRegisterReport): ExportData {
  return {
    sheetName: "Fixed Asset Register",
    columns: [
      { header: "Asset", key: "asset", width: 28 },
      { header: "Number", key: "number", width: 16 },
      { header: "Category", key: "category", width: 18 },
      { header: "Status", key: "status", width: 14 },
      { header: "Purchase Date", key: "purchaseDate", width: 14 },
      { header: "Cost", key: "cost", width: 16 },
      { header: "Accumulated Depreciation", key: "accDep", width: 24 },
      { header: "Net Book Value", key: "nbv", width: 18 },
      { header: "Method", key: "method", width: 18 },
      { header: "Automation", key: "automation", width: 22 },
    ],
    rows: report.rows.map((row) => ({
      asset: row.assetName,
      number: row.assetNumber || "",
      category: row.category || "",
      status: row.status || "",
      purchaseDate: formatDateForExport(row.purchaseDate),
      cost: amountForExport(row.purchaseCost),
      accDep: amountForExport(row.accumulatedDepreciation),
      nbv: amountForExport(row.netBookValue),
      method: row.depreciationMethod || "",
      automation: row.needsCapitalizationJe ? "Capitalization review" : "",
    })),
  };
}

function prepareDepreciationScheduleForExport(report: DepreciationScheduleReport): ExportData {
  return {
    sheetName: "Depreciation Schedule",
    columns: [
      { header: "Asset", key: "asset", width: 28 },
      { header: "Number", key: "number", width: 16 },
      { header: "Category", key: "category", width: 18 },
      { header: "Period", key: "period", width: 12 },
      { header: "Amount", key: "amount", width: 16 },
      { header: "Posted", key: "posted", width: 12 },
      { header: "Journal Entry", key: "journalEntry", width: 36 },
    ],
    rows: report.rows.map((row) => ({
      asset: row.assetName,
      number: row.assetNumber || "",
      category: row.category || "",
      period: row.periodLabel,
      amount: amountForExport(row.amount),
      posted: row.posted ? "Yes" : "No",
      journalEntry: row.journalEntryId || "",
    })),
  };
}

function prepareInventoryValuationForExport(report: InventoryValuationReport): ExportData {
  return {
    sheetName: "Inventory Valuation",
    columns: [
      { header: "Product", key: "product", width: 30 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "Unit", key: "unit", width: 10 },
      { header: "Stock On Hand", key: "stock", width: 16 },
      { header: "Unit Cost", key: "unitCost", width: 14 },
      { header: "Inventory Value", key: "inventoryValue", width: 18 },
      { header: "Retail Value", key: "retailValue", width: 16 },
      { header: "Gross Margin", key: "grossMargin", width: 16 },
      { header: "Margin %", key: "marginPercent", width: 12 },
      { header: "Low Stock Threshold", key: "threshold", width: 18 },
      { header: "Movements", key: "movementCount", width: 12 },
      { header: "Last Movement", key: "lastMovement", width: 16 },
      { header: "Automation", key: "automation", width: 22 },
    ],
    rows: report.rows.map((row) => ({
      product: row.productName,
      sku: row.sku || "",
      unit: row.unit,
      stock: amountForExport(row.stockOnHand),
      unitCost: amountForExport(row.unitCost),
      inventoryValue: amountForExport(row.inventoryValue),
      retailValue: amountForExport(row.retailValue),
      grossMargin: amountForExport(row.grossMarginValue),
      marginPercent: `${row.grossMarginPercent.toFixed(1)}%`,
      threshold: amountForExport(row.lowStockThreshold),
      movementCount: row.movementCount,
      lastMovement: formatDateForExport(row.lastMovementAt),
      automation: row.negativeStock
        ? "Negative stock review"
        : row.reorderSuggested
          ? "Reorder suggested"
          : "",
    })),
  };
}

function isCountMetric(metric: string): boolean {
  return metric.toLowerCase().includes("count");
}

function comparisonAmountForExport(metric: string, value: number): string {
  return isCountMetric(metric) ? value.toFixed(0) : amountForExport(value);
}

function formatDateForExport(value: string | null | undefined): string {
  return value ? format(new Date(value), "yyyy-MM-dd") : "";
}

function recipientsFromText(value: string): string[] {
  return value
    .split(/[,\n]/u)
    .map((recipient) => recipient.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function classifyRecipient(value: string): "email" | "phone" | "invalid" {
  const recipient = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(recipient)) return "email";
  if (recipient.replace(/\D/gu, "").length >= 7) return "phone";
  return "invalid";
}

function compatibleRecipientCount(channel: ReportPackChannel, recipients: string[]): number {
  return recipients.filter((recipient) => {
    const kind = classifyRecipient(recipient);
    if (channel === "email") return kind === "email";
    if (channel === "whatsapp") return kind === "phone";
    return kind === "email" || kind === "phone";
  }).length;
}

function scheduleDraftFromSchedule(
  schedule: ReportPackSchedule | undefined,
  fallbackRecipient?: string | null
): ReportPackScheduleDraft {
  return {
    cadence: schedule?.cadence ?? "monthly",
    channel: schedule?.channel ?? "email",
    recipientsText:
      schedule?.recipients.join(", ") || (fallbackRecipient ? fallbackRecipient.trim() : ""),
    includeComparison: schedule?.includeComparison ?? true,
  };
}

function formatScheduleDate(value: string | null | undefined): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return format(date, "MMM d, yyyy");
}

function formatDeliveryDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return format(date, "MMM d, yyyy HH:mm");
}

function deliveryStatusVariant(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "sent" || status === "delivered" || status === "read") return "success";
  if (status === "queued" || status === "pending") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

function formatSnapshotMetricValue(
  metric: ReportPackRunHistoryItem["snapshotMetrics"][number],
  locale: string
): string {
  if (typeof metric.value === "string") return metric.value;
  if (metric.type === "currency") return formatCurrency(metric.value, "AED", locale);
  if (metric.type === "percent") return `${formatNumber(metric.value, locale)}%`;
  return formatNumber(metric.value, locale);
}

export default function Reports() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId, company } = useDefaultCompany();
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [activeTab, setActiveTab] = useState<ReportTab>("pl");
  const [isExporting, setIsExporting] = useState(false);
  const [personaFilter, setPersonaFilter] = useState<PersonaFilter>("all");
  const [reportSearch, setReportSearch] = useState("");
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("quarter");
  const [reportPackScheduleDrafts, setReportPackScheduleDrafts] = useState<
    Record<string, ReportPackScheduleDraft>
  >({});
  const [savingReportPackId, setSavingReportPackId] = useState<string | null>(null);
  const [preparingReportPackId, setPreparingReportPackId] = useState<string | null>(null);
  const hasDateRange = Boolean(dateRange.from && dateRange.to);
  const closePeriodDate = dateRange.to ?? new Date();
  const closePeriod = format(closePeriodDate, "yyyy-MM");
  const closePeriodLabel = format(closePeriodDate, "MMMM yyyy");

  const filteredReports = useMemo(() => {
    const query = reportSearch.trim().toLowerCase();
    return reportCatalog.filter((report) => {
      const matchesPersona = personaFilter === "all" || report.personas.includes(personaFilter);
      const matchesQuery =
        !query ||
        report.name.toLowerCase().includes(query) ||
        report.category.toLowerCase().includes(query) ||
        report.automation.toLowerCase().includes(query) ||
        report.comparison.toLowerCase().includes(query);
      return matchesPersona && matchesQuery;
    });
  }, [personaFilter, reportSearch]);

  const reportStats = useMemo(() => {
    const live = reportCatalog.filter((report) => report.status === "live").length;
    const ready = reportCatalog.filter((report) =>
      ["live", "workspace", "api"].includes(report.status)
    ).length;
    const planned = reportCatalog.length - ready;
    return { live, ready, planned, total: reportCatalog.length };
  }, []);

  const reportByName = useMemo(
    () => new Map(reportCatalog.map((report) => [report.name, report])),
    []
  );

  const reportPackSummaries = useMemo<ReportPackSummary[]>(
    () =>
      reportPackDefinitions.map((pack) => {
        const reports = pack.reportNames
          .map((name) => reportByName.get(name))
          .filter((report): report is ReportCatalogItem => Boolean(report));
        const liveCount = reports.filter((report) => report.status === "live").length;
        const readyCount = reports.filter((report) =>
          ["live", "workspace", "api"].includes(report.status)
        ).length;
        const plannedCount = reports.length - readyCount;
        const primaryTab = reports.find((report) => report.tab)?.tab;

        return {
          ...pack,
          reports,
          liveCount,
          readyCount,
          plannedCount,
          primaryTab,
        };
      }),
    [reportByName]
  );
  const fallbackReportPackRecipient = company?.contactEmail ?? undefined;

  const {
    data: reportPackSchedules,
    isLoading: reportPackSchedulesLoading,
    refetch: refetchReportPackSchedules,
  } = useQuery<ReportPackSchedule[]>({
    queryKey: ["/api/companies", selectedCompanyId, "report-pack-schedules"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/report-pack-schedules`),
    enabled: !!selectedCompanyId,
  });

  const {
    data: reportPackDeliveries,
    isLoading: reportPackDeliveriesLoading,
    refetch: refetchReportPackDeliveries,
  } = useQuery<ReportPackDeliveryHistoryItem[]>({
    queryKey: ["/api/companies", selectedCompanyId, "report-pack-deliveries"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-pack-deliveries?limit=12`),
    enabled: !!selectedCompanyId,
  });

  const {
    data: reportPackRuns,
    isLoading: reportPackRunsLoading,
    refetch: refetchReportPackRuns,
  } = useQuery<ReportPackRunHistoryItem[]>({
    queryKey: ["/api/companies", selectedCompanyId, "report-pack-runs"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/report-pack-runs?limit=10`),
    enabled: !!selectedCompanyId,
  });

  const scheduleByPackId = useMemo(
    () => new Map((reportPackSchedules ?? []).map((schedule) => [schedule.packId, schedule])),
    [reportPackSchedules]
  );

  useEffect(() => {
    if (!reportPackSchedules) return;
    setReportPackScheduleDrafts((current) => {
      const next = { ...current };
      for (const schedule of reportPackSchedules) {
        next[schedule.packId] = scheduleDraftFromSchedule(schedule, fallbackReportPackRecipient);
      }
      return next;
    });
  }, [fallbackReportPackRecipient, reportPackSchedules]);

  const dateParams =
    dateRange.from && dateRange.to
      ? `?startDate=${format(dateRange.from, "yyyy-MM-dd")}&endDate=${format(dateRange.to, "yyyy-MM-dd")}`
      : "";
  const fromToDateParams =
    dateRange.from && dateRange.to
      ? `?from=${format(dateRange.from, "yyyy-MM-dd")}&to=${format(dateRange.to, "yyyy-MM-dd")}`
      : "";

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

  const { data: trialBalance, isLoading: trialBalanceLoading } = useQuery<TrialBalanceReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "trial-balance", fromToDateParams],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/reports/trial-balance${fromToDateParams}`
      ),
    enabled: !!selectedCompanyId,
  });

  const { data: vatReturn, isLoading: vatReturnLoading } = useQuery<VATReturnReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "vat-return", fromToDateParams],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/reports/vat-return${fromToDateParams}`
      ),
    enabled: !!selectedCompanyId && hasDateRange,
  });

  const { data: fxGainsLosses, isLoading: fxLoading } = useQuery<FxGainsLossesReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "fx-gains-losses"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/reports/fx-gains-losses`),
    enabled: !!selectedCompanyId,
  });

  const { data: cashFlowData, isLoading: cashFlowLoading } = useQuery<CashFlowData[]>({
    queryKey: ["/api/reports", selectedCompanyId, "cash-flow", reportPeriod],
    queryFn: () => apiRequest("GET", `/api/reports/${selectedCompanyId}/cash-flow/${reportPeriod}`),
    enabled: !!selectedCompanyId,
  });

  const { data: cashFlowForecast, isLoading: cashFlowForecastLoading } =
    useQuery<CashFlowForecastReport>({
      queryKey: ["/api/companies", selectedCompanyId, "cashflow", "forecast", 90],
      queryFn: () =>
        apiRequest("GET", `/api/companies/${selectedCompanyId}/cashflow/forecast?days=90`),
      enabled: !!selectedCompanyId,
    });

  const { data: monthEndClose, isLoading: monthEndCloseLoading } = useQuery<MonthEndCloseReport>({
    queryKey: ["/api/companies", selectedCompanyId, "month-end", "checklist", closePeriod],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/month-end/checklist?period=${closePeriod}`
      ),
    enabled: !!selectedCompanyId,
  });

  const { data: monthEndCloseHistory, isLoading: monthEndCloseHistoryLoading } = useQuery<
    MonthEndCloseRecord[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "month-end", "history"],
    queryFn: () => apiRequest("GET", `/api/companies/${selectedCompanyId}/month-end/history`),
    enabled: !!selectedCompanyId,
  });

  const { data: agingData, isLoading: agingLoading } = useQuery<AgingItem[]>({
    queryKey: ["/api/reports", selectedCompanyId, "aging"],
    queryFn: () => apiRequest("GET", `/api/reports/${selectedCompanyId}/aging`),
    enabled: !!selectedCompanyId,
  });

  const { data: comparisonData, isLoading: comparisonLoading } = useQuery<PeriodComparison[]>({
    queryKey: ["/api/reports", selectedCompanyId, "comparison", reportPeriod],
    queryFn: () =>
      apiRequest("GET", `/api/reports/${selectedCompanyId}/comparison/${reportPeriod}`),
    enabled: !!selectedCompanyId,
  });

  const { data: generalLedger, isLoading: ledgerLoading } = useQuery<GeneralLedgerReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "general-ledger", fromToDateParams],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/reports/general-ledger${fromToDateParams}`
      ),
    enabled: !!selectedCompanyId,
  });

  const { data: customerBalances, isLoading: customerBalancesLoading } =
    useQuery<CustomerBalanceReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "customer-balances",
        fromToDateParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/customer-balances${fromToDateParams}`
        ),
      enabled: !!selectedCompanyId,
    });

  const { data: vendorBalances, isLoading: vendorBalancesLoading } = useQuery<VendorBalanceReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "vendor-balances", fromToDateParams],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/reports/vendor-balances${fromToDateParams}`
      ),
    enabled: !!selectedCompanyId,
  });

  const { data: revenueByCustomer, isLoading: revenueByCustomerLoading } =
    useQuery<RevenueByCustomerReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "revenue-by-customer",
        fromToDateParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/revenue-by-customer${fromToDateParams}`
        ),
      enabled: !!selectedCompanyId,
    });

  const { data: salesByService, isLoading: salesByServiceLoading } = useQuery<SalesByServiceReport>(
    {
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "sales-by-service",
        fromToDateParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/sales-by-service${fromToDateParams}`
        ),
      enabled: !!selectedCompanyId,
    }
  );

  const { data: expensesByVendor, isLoading: expensesByVendorLoading } =
    useQuery<ExpenseAnalysisReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "expenses-by-vendor",
        fromToDateParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/expenses-by-vendor${fromToDateParams}`
        ),
      enabled: !!selectedCompanyId,
    });

  const { data: expensesByCategory, isLoading: expensesByCategoryLoading } =
    useQuery<ExpenseAnalysisReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "expenses-by-category",
        fromToDateParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/expenses-by-category${fromToDateParams}`
        ),
      enabled: !!selectedCompanyId,
    });

  const { data: invoiceStatus, isLoading: invoiceStatusLoading } = useQuery<InvoiceStatusReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "invoice-status", fromToDateParams],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${selectedCompanyId}/reports/invoice-status${fromToDateParams}`
      ),
    enabled: !!selectedCompanyId,
  });

  const { data: budgetVsActual, isLoading: budgetVsActualLoading } = useQuery<BudgetVsActualReport>(
    {
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "budget-vs-actual",
        fromToDateParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/budget-vs-actual${fromToDateParams}`
        ),
      enabled: !!selectedCompanyId,
    }
  );

  const { data: payrollSummary, isLoading: payrollSummaryLoading } = useQuery<PayrollSummaryReport>(
    {
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "payroll-summary",
        fromToDateParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/payroll-summary${fromToDateParams}`
        ),
      enabled: !!selectedCompanyId,
    }
  );

  const { data: corporateTaxEstimate, isLoading: corporateTaxLoading } =
    useQuery<CorporateTaxEstimateReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "corporate-tax-estimate",
        fromToDateParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/corporate-tax-estimate${fromToDateParams}`
        ),
      enabled: !!selectedCompanyId,
    });

  const { data: fixedAssetRegister, isLoading: fixedAssetsLoading } =
    useQuery<FixedAssetRegisterReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "fixed-asset-register",
        fromToDateParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/fixed-asset-register${fromToDateParams}`
        ),
      enabled: !!selectedCompanyId,
    });

  const { data: depreciationSchedule, isLoading: depreciationLoading } =
    useQuery<DepreciationScheduleReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "depreciation-schedule",
        fromToDateParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/depreciation-schedule${fromToDateParams}`
        ),
      enabled: !!selectedCompanyId,
    });

  const { data: inventoryValuation, isLoading: inventoryValuationLoading } =
    useQuery<InventoryValuationReport>({
      queryKey: [
        "/api/companies",
        selectedCompanyId,
        "reports",
        "inventory-valuation",
        fromToDateParams,
      ],
      queryFn: () =>
        apiRequest(
          "GET",
          `/api/companies/${selectedCompanyId}/reports/inventory-valuation${fromToDateParams}`
        ),
      enabled: !!selectedCompanyId,
    });

  const vatReturnRows = useMemo(() => {
    if (!vatReturn) return [];
    return [
      {
        box: "Box 1",
        description: "Standard-rated supplies",
        amount: vatReturn.box1_standardRatedSupplies,
      },
      {
        box: "Box 2",
        description: "Zero-rated supplies",
        amount: vatReturn.box2_zeroRatedSupplies,
      },
      { box: "Box 3", description: "Exempt supplies", amount: vatReturn.box3_exemptSupplies },
      { box: "Box 4", description: "Total supplies", amount: vatReturn.box4_totalSupplies },
      { box: "Box 5", description: "Output VAT", amount: vatReturn.box5_outputVat },
      {
        box: "Box 6",
        description: "Standard-rated expenses",
        amount: vatReturn.box6_standardRatedExpenses,
      },
      {
        box: "Box 7",
        description: "Input VAT recoverable",
        amount: vatReturn.box7_inputVatRecoverable,
      },
      { box: "Box 8", description: "Net VAT due", amount: vatReturn.box8_netVatDue },
    ];
  }, [vatReturn]);

  const fxReportItems = useMemo(
    () => [...(fxGainsLosses?.receivables ?? []), ...(fxGainsLosses?.payables ?? [])],
    [fxGainsLosses]
  );

  const cashFlowSummary = useMemo(() => {
    const rows = cashFlowData ?? [];
    const latest = rows[rows.length - 1];
    return rows.reduce(
      (summary, row) => {
        summary.operating += row.operatingInflow - row.operatingOutflow;
        summary.investing += row.investingInflow - row.investingOutflow;
        summary.financing += row.financingInflow - row.financingOutflow;
        summary.net += row.netCashFlow;
        return summary;
      },
      {
        operating: 0,
        investing: 0,
        financing: 0,
        net: 0,
        endingBalance: latest?.endingBalance ?? 0,
      }
    );
  }, [cashFlowData]);

  const cashFlowForecastSummary = useMemo(() => {
    const rows = cashFlowForecast?.projections ?? [];
    const currentBalance = cashFlowForecast?.currentBalance ?? 0;
    const finalBalance = rows[rows.length - 1]?.projectedBalance ?? currentBalance;
    const minBalance = rows.reduce(
      (lowest, row) => Math.min(lowest, row.projectedBalance),
      currentBalance
    );
    const totalInflows = rows.reduce((sum, row) => sum + row.expectedInflows, 0);
    const totalOutflows = rows.reduce((sum, row) => sum + row.expectedOutflows, 0);
    const lowBalanceWeeks = rows.filter((row) => row.projectedBalance < 10000).length;
    const negativeBalanceWeeks = rows.filter((row) => row.projectedBalance < 0).length;

    return {
      currentBalance,
      finalBalance,
      minBalance,
      totalInflows,
      totalOutflows,
      netMovement: finalBalance - currentBalance,
      lowBalanceWeeks,
      negativeBalanceWeeks,
    };
  }, [cashFlowForecast]);

  const monthEndCloseSummary = useMemo(() => {
    const checklist = monthEndClose?.checklist ?? [];
    const completedCount = checklist.filter((item) => item.status === "complete").length;
    const incompleteItems = checklist.filter((item) => item.status === "incomplete");
    const totalCount = checklist.length;
    const lockedRecord = (monthEndCloseHistory ?? []).find(
      (record) =>
        record.status === "locked" && formatDateForExport(record.periodEnd).startsWith(closePeriod)
    );

    return {
      completedCount,
      totalCount,
      incompleteCount: incompleteItems.length,
      incompleteItems,
      completionPercent: totalCount ? Math.round((completedCount / totalCount) * 100) : 0,
      lockedRecord,
      isLocked: Boolean(lockedRecord),
    };
  }, [closePeriod, monthEndClose, monthEndCloseHistory]);

  const agingSummary = useMemo(() => {
    const empty = { current: 0, overdue: 0, total: 0 };
    const totals = {
      receivables: { ...empty },
      payables: { ...empty },
    };

    for (const row of agingData ?? []) {
      const bucket = row.type === "payable" ? totals.payables : totals.receivables;
      bucket.current += row.current;
      bucket.overdue += row.days30 + row.days60 + row.days90 + row.over90;
      bucket.total += row.total;
    }

    return totals;
  }, [agingData]);

  const agingBucketRows = useMemo(() => {
    const rows = agingData ?? [];
    const totalFor = (
      type: AgingItem["type"],
      key: keyof Omit<AgingItem, "id" | "name" | "type">
    ) =>
      rows.filter((row) => row.type === type).reduce((sum, row) => sum + Number(row[key] ?? 0), 0);

    return [
      {
        bucket: "Current",
        receivables: totalFor("receivable", "current"),
        payables: totalFor("payable", "current"),
      },
      {
        bucket: "1-30",
        receivables: totalFor("receivable", "days30"),
        payables: totalFor("payable", "days30"),
      },
      {
        bucket: "31-60",
        receivables: totalFor("receivable", "days60"),
        payables: totalFor("payable", "days60"),
      },
      {
        bucket: "61-90",
        receivables: totalFor("receivable", "days90"),
        payables: totalFor("payable", "days90"),
      },
      {
        bucket: ">90",
        receivables: totalFor("receivable", "over90"),
        payables: totalFor("payable", "over90"),
      },
    ];
  }, [agingData]);

  const comparisonByMetric = useMemo(
    () => new Map((comparisonData ?? []).map((row) => [row.metric, row])),
    [comparisonData]
  );
  const revenueComparison = comparisonByMetric.get("Total Revenue");
  const expenseComparison = comparisonByMetric.get("Total Expenses");
  const profitComparison = comparisonByMetric.get("Net Profit");
  const ledgerRecentTransactions = useMemo(() => {
    return (generalLedger?.accounts ?? [])
      .flatMap((account) =>
        account.transactions.map((transaction) => ({
          account,
          transaction,
        }))
      )
      .sort(
        (a, b) =>
          new Date(b.transaction.date).getTime() - new Date(a.transaction.date).getTime() ||
          b.transaction.entryNumber.localeCompare(a.transaction.entryNumber)
      )
      .slice(0, 50);
  }, [generalLedger]);
  const customerAutomationCount =
    customerBalances?.rows.filter((row) => row.chaseSuggested).length ?? 0;
  const vendorAutomationCount =
    vendorBalances?.rows.filter((row) => row.paymentSuggested).length ?? 0;
  const revenueConcentrationCount =
    revenueByCustomer?.rows.filter((row) => row.concentrationRisk).length ?? 0;
  const serviceMarginReviewCount =
    salesByService?.rows.filter((row) => row.marginReviewSuggested).length ?? 0;
  const vendorSpendReviewCount =
    expensesByVendor?.rows.filter((row) => row.spendReviewSuggested).length ?? 0;
  const categoryBudgetReviewCount =
    expensesByCategory?.rows.filter((row) => row.budgetReviewSuggested).length ?? 0;
  const invoiceReminderQueue = invoiceStatus?.totals.reminderQueue ?? 0;
  const apAgingOverdue = agingSummary.payables.overdue;
  const budgetVarianceQueue = budgetVsActual?.totals.automationCount ?? 0;
  const cashFlowForecastRiskQueue = cashFlowForecastSummary.lowBalanceWeeks;
  const cashFlowForecastExposure =
    cashFlowForecastSummary.minBalance < 0
      ? Math.abs(cashFlowForecastSummary.minBalance)
      : cashFlowForecastSummary.minBalance < 10000
        ? 10000 - cashFlowForecastSummary.minBalance
        : 0;
  const payrollAutomationQueue =
    (payrollSummary?.totals.pendingApprovalCount ?? 0) +
    (payrollSummary?.totals.sifPendingCount ?? 0) +
    (payrollSummary?.totals.journalMissingCount ?? 0);
  const fixedAssetCapitalizationQueue = fixedAssetRegister?.totals.capitalizationQueue ?? 0;
  const depreciationPostingQueue = depreciationSchedule?.totals.postingQueue ?? 0;
  const inventoryReorderQueue = inventoryValuation?.totals.reorderSuggestions ?? 0;
  const inventoryNegativeStockQueue = inventoryValuation?.totals.negativeStockCount ?? 0;
  const monthEndCloseQueue = monthEndCloseSummary.isLocked
    ? 0
    : monthEndCloseSummary.incompleteCount;
  const automationQueueItems = useMemo<AutomationQueueItem[]>(() => {
    const vatExposure = Math.abs(vatSummary?.netVATPayable ?? 0);
    const taxPayable = corporateTaxEstimate?.totals.taxPayable ?? 0;
    const cashPressure = Math.max(
      cashFlowSummary.net < 0 ? Math.abs(cashFlowSummary.net) : 0,
      cashFlowSummary.endingBalance < 0 ? Math.abs(cashFlowSummary.endingBalance) : 0
    );
    const netLoss =
      profitLoss?.netProfit && profitLoss.netProfit < 0 ? Math.abs(profitLoss.netProfit) : 0;
    const spendExposure = Math.max(
      expensesByVendor?.totals.totalSpend ?? 0,
      expensesByCategory?.totals.totalSpend ?? 0
    );

    const items: AutomationQueueItem[] = [
      {
        id: "invoice-reminders",
        title: "Send overdue invoice reminders",
        description: "Invoices are overdue and ready for payment-chasing automation.",
        source: "Invoice Status",
        personas: ["owner", "freelancer", "accountant"],
        priority: invoiceReminderQueue > 0 ? "high" : "low",
        count: invoiceReminderQueue,
        impact: invoiceStatus?.totals.overdueBalance ?? 0,
        tab: "invoiceStatus",
        href: "/payment-chasing",
        actionLabel: "Open chasing",
      },
      {
        id: "customer-chase",
        title: "Prioritize customer collections",
        description: "Customer balances have chase flags from open or overdue invoices.",
        source: "Customer Balance Summary",
        personas: ["owner", "freelancer", "accountant"],
        priority: customerAutomationCount > 0 ? "high" : "low",
        count: customerAutomationCount,
        impact: customerBalances?.totals.overdueBalance ?? 0,
        tab: "customers",
        href: "/payment-chasing",
        actionLabel: "Review queue",
      },
      {
        id: "vendor-payments",
        title: "Review vendor payment timing",
        description: "Vendor balances are ready for payment scheduling and cash impact review.",
        source: "Vendor Balance Summary",
        personas: ["owner", "accountant"],
        priority: vendorAutomationCount > 0 ? "medium" : "low",
        count: vendorAutomationCount,
        impact: vendorBalances?.totals.openBalance ?? 0,
        tab: "vendors",
        href: "/bill-pay",
        actionLabel: "Schedule payables",
      },
      {
        id: "ap-aging-payment-plan",
        title: "Plan overdue payables",
        description: "A/P aging has overdue vendor balances that need payment timing review.",
        source: "A/P Aging",
        personas: ["owner", "accountant"],
        priority: apAgingOverdue > 0 ? "medium" : "low",
        count: apAgingOverdue > 0 ? 1 : 0,
        impact: apAgingOverdue,
        tab: "aging",
        href: "/bill-pay",
        actionLabel: "Open bill pay",
      },
      {
        id: "vat-readiness",
        title: "Prepare VAT review",
        description: "VAT exposure is available for autopilot review and evidence checks.",
        source: "VAT Summary",
        personas: ["owner", "freelancer", "accountant"],
        priority: vatExposure > 0 ? "medium" : "low",
        count: vatExposure > 0 ? 1 : 0,
        impact: vatExposure,
        tab: "vat",
        href: "/vat-autopilot",
        actionLabel: "Review VAT",
      },
      {
        id: "corporate-tax",
        title: "Review corporate tax estimate",
        description: "Taxable income or filing readiness needs review before the next deadline.",
        source: "Corporate Tax Estimate",
        personas: ["owner", "accountant"],
        priority: corporateTaxEstimate?.totals.filingReviewSuggested ? "high" : "medium",
        count: taxPayable > 0 || corporateTaxEstimate?.totals.filingReviewSuggested ? 1 : 0,
        impact: taxPayable,
        tab: "corpTax",
        href: "/corporate-tax",
        actionLabel: "Open tax center",
      },
      {
        id: "cash-pressure",
        title: "Review cash pressure",
        description: "Cash flow is negative or the latest ending balance needs attention.",
        source: "Cash Flow Statement",
        personas: ["owner", "freelancer", "accountant"],
        priority: cashPressure > 0 ? "high" : "low",
        count: cashPressure > 0 ? 1 : 0,
        impact: cashPressure,
        tab: "cashFlow",
        href: "/cashflow-forecast",
        actionLabel: "Forecast cash",
      },
      {
        id: "cash-flow-forecast-risk",
        title: "Review forecasted cash risk",
        description: "Projected balances fall below the working cash threshold in the forecast.",
        source: "Cash Flow Forecast",
        personas: ["owner", "freelancer", "accountant"],
        priority:
          cashFlowForecastSummary.negativeBalanceWeeks > 0
            ? "high"
            : cashFlowForecastRiskQueue > 0
              ? "medium"
              : "low",
        count: cashFlowForecastRiskQueue,
        impact: cashFlowForecastExposure,
        tab: "cashFlowForecast",
        href: "/cashflow-forecast",
        actionLabel: "Open forecast",
      },
      {
        id: "profit-review",
        title: "Investigate net loss",
        description: "Profit and loss is negative for the loaded reporting period.",
        source: "Profit & Loss",
        personas: ["owner", "freelancer", "accountant"],
        priority: netLoss > 0 ? "high" : "low",
        count: netLoss > 0 ? 1 : 0,
        impact: netLoss,
        tab: "pl",
        href: "/ai-cfo",
        actionLabel: "Ask AI CFO",
      },
      {
        id: "revenue-concentration",
        title: "Review customer concentration",
        description: "Revenue is concentrated enough to warrant client-risk review.",
        source: "Revenue by Customer",
        personas: ["owner", "freelancer", "accountant"],
        priority: revenueConcentrationCount > 0 ? "medium" : "low",
        count: revenueConcentrationCount,
        impact: revenueByCustomer?.totals.revenue ?? 0,
        tab: "revenueCustomers",
        href: "/contacts",
        actionLabel: "Review customers",
      },
      {
        id: "service-margin",
        title: "Review service margin",
        description: "Products or services have margin-review flags from sales analysis.",
        source: "Sales by Product/Service",
        personas: ["owner", "accountant"],
        priority: serviceMarginReviewCount > 0 ? "medium" : "low",
        count: serviceMarginReviewCount,
        impact: salesByService?.totals.revenue ?? 0,
        tab: "salesServices",
        href: "/invoices",
        actionLabel: "Review services",
      },
      {
        id: "spend-review",
        title: "Review spend and budget drift",
        description: "Vendor or category spend has review flags against the prior period.",
        source: "Expenses by Vendor/Category",
        personas: ["owner", "freelancer", "accountant"],
        priority: vendorSpendReviewCount + categoryBudgetReviewCount > 0 ? "medium" : "low",
        count: vendorSpendReviewCount + categoryBudgetReviewCount,
        impact: spendExposure,
        tab: "expenseCategories",
        href: "/budgets",
        actionLabel: "Review budgets",
      },
      {
        id: "budget-variance",
        title: "Review budget variances",
        description: "Budget lines have unfavorable variance flags against posted actuals.",
        source: "Budget vs Actual",
        personas: ["owner", "accountant"],
        priority: budgetVarianceQueue > 0 ? "medium" : "low",
        count: budgetVarianceQueue,
        impact:
          budgetVarianceQueue > 0 ? Math.abs(Math.min(budgetVsActual?.totals.variance ?? 0, 0)) : 0,
        tab: "budgetActual",
        href: "/budgets",
        actionLabel: "Open budgets",
      },
      {
        id: "payroll-readiness",
        title: "Review payroll readiness",
        description: "Payroll runs need approval, WPS SIF generation, or posting review.",
        source: "Payroll Summary",
        personas: ["owner", "accountant"],
        priority: payrollAutomationQueue > 0 ? "medium" : "low",
        count: payrollAutomationQueue,
        impact: payrollSummary?.totals.totalEmployerCost ?? 0,
        tab: "payrollSummary",
        href: "/payroll",
        actionLabel: "Open payroll",
      },
      {
        id: "asset-capitalization",
        title: "Post asset capitalization entries",
        description: "Fixed assets are waiting for capitalization journal-entry review.",
        source: "Fixed Asset Register",
        personas: ["owner", "accountant"],
        priority: fixedAssetCapitalizationQueue > 0 ? "medium" : "low",
        count: fixedAssetCapitalizationQueue,
        impact: fixedAssetRegister?.totals.purchaseCost ?? 0,
        tab: "fixedAssets",
        href: "/fixed-assets",
        actionLabel: "Open assets",
      },
      {
        id: "depreciation-posting",
        title: "Post depreciation schedule",
        description: "Depreciation schedule rows are unposted and ready for accountant review.",
        source: "Depreciation Schedule",
        personas: ["accountant"],
        priority: depreciationPostingQueue > 0 ? "medium" : "low",
        count: depreciationPostingQueue,
        impact: depreciationSchedule?.totals.depreciationAmount ?? 0,
        tab: "depreciation",
        href: "/fixed-assets",
        actionLabel: "Open assets",
      },
      {
        id: "inventory-stock-risk",
        title: "Review inventory stock risk",
        description: "Inventory valuation has low-stock or negative-stock products to review.",
        source: "Inventory Valuation",
        personas: ["owner", "accountant"],
        priority:
          inventoryNegativeStockQueue > 0 ? "high" : inventoryReorderQueue > 0 ? "medium" : "low",
        count: inventoryReorderQueue + inventoryNegativeStockQueue,
        impact:
          inventoryReorderQueue + inventoryNegativeStockQueue > 0
            ? (inventoryValuation?.totals.inventoryValue ?? 0)
            : 0,
        tab: "inventoryValuation",
        href: "/inventory",
        actionLabel: "Open inventory",
      },
      {
        id: "month-end-close",
        title: "Complete month-end close",
        description: "The selected close period has unresolved checklist items before lock.",
        source: "Month-End Close Status",
        personas: ["accountant"],
        priority: monthEndCloseQueue > 0 ? "medium" : "low",
        count: monthEndCloseQueue,
        impact: 0,
        tab: "monthEndClose",
        href: "/month-end",
        actionLabel: "Open close",
      },
    ];

    return items
      .filter((item) => item.count > 0 || item.impact > 0)
      .sort(
        (a, b) =>
          automationPriorityWeight[b.priority] - automationPriorityWeight[a.priority] ||
          b.impact - a.impact ||
          b.count - a.count
      );
  }, [
    apAgingOverdue,
    budgetVarianceQueue,
    budgetVsActual,
    cashFlowSummary,
    cashFlowForecastExposure,
    cashFlowForecastRiskQueue,
    cashFlowForecastSummary,
    categoryBudgetReviewCount,
    corporateTaxEstimate,
    customerAutomationCount,
    customerBalances,
    depreciationPostingQueue,
    depreciationSchedule,
    expensesByCategory,
    expensesByVendor,
    fixedAssetCapitalizationQueue,
    fixedAssetRegister,
    inventoryNegativeStockQueue,
    inventoryReorderQueue,
    inventoryValuation,
    invoiceReminderQueue,
    invoiceStatus,
    monthEndCloseQueue,
    payrollAutomationQueue,
    payrollSummary,
    profitLoss,
    revenueByCustomer,
    revenueConcentrationCount,
    salesByService,
    serviceMarginReviewCount,
    vatSummary,
    vendorAutomationCount,
    vendorBalances,
    vendorSpendReviewCount,
  ]);
  const visibleAutomationQueueItems = automationQueueItems.slice(0, 8);
  const automationQueueTotals = automationQueueItems.reduce(
    (totals, item) => {
      totals.count += item.count;
      totals.impact += item.impact;
      return totals;
    },
    { count: 0, impact: 0 }
  );
  const periodLabel =
    reportPeriodOptions.find((option) => option.id === reportPeriod)?.label ?? "Quarterly";
  const formatComparisonValue = (metric: string, value: number) =>
    isCountMetric(metric) ? formatNumber(value, locale) : formatCurrency(value, "AED", locale);

  const updateReportPackScheduleDraft = (
    packId: string,
    patch: Partial<ReportPackScheduleDraft>
  ) => {
    setReportPackScheduleDrafts((current) => ({
      ...current,
      [packId]: {
        ...scheduleDraftFromSchedule(scheduleByPackId.get(packId), fallbackReportPackRecipient),
        ...current[packId],
        ...patch,
      },
    }));
  };

  const handleSaveReportPackSchedule = async (pack: ReportPackSummary, enabled: boolean) => {
    if (!selectedCompanyId) return;

    const draft =
      reportPackScheduleDrafts[pack.id] ??
      scheduleDraftFromSchedule(scheduleByPackId.get(pack.id), fallbackReportPackRecipient);
    const recipients = recipientsFromText(draft.recipientsText);

    if (enabled && recipients.length === 0) {
      toast({
        variant: "destructive",
        title: "Recipient required",
        description: "Add at least one email or WhatsApp recipient before enabling this pack.",
      });
      return;
    }

    if (enabled && compatibleRecipientCount(draft.channel, recipients) === 0) {
      toast({
        variant: "destructive",
        title: "Recipient does not match channel",
        description:
          draft.channel === "email"
            ? "Add at least one email address for email delivery."
            : draft.channel === "whatsapp"
              ? "Add at least one WhatsApp phone number for WhatsApp delivery."
              : "Add at least one email address or WhatsApp phone number.",
      });
      return;
    }

    setSavingReportPackId(pack.id);
    try {
      await apiRequest(
        "PUT",
        `/api/companies/${selectedCompanyId}/report-pack-schedules/${pack.id}`,
        {
          enabled,
          cadence: draft.cadence,
          channel: draft.channel,
          recipients,
          includeComparison: draft.includeComparison,
        }
      );
      await refetchReportPackSchedules();
      toast({
        title: enabled ? "Report pack scheduled" : "Report pack paused",
        description: enabled
          ? `${pack.title} will be prepared ${draft.cadence} for ${recipients.length} recipient${
              recipients.length === 1 ? "" : "s"
            }.`
          : `${pack.title} scheduled delivery is paused.`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Schedule update failed",
        description: error?.message || "Could not save this report pack schedule.",
      });
    } finally {
      setSavingReportPackId(null);
    }
  };

  const handlePrepareReportPackNow = async (pack: ReportPackSummary) => {
    if (!selectedCompanyId) return;

    setPreparingReportPackId(pack.id);
    try {
      const result = await apiRequest(
        "POST",
        `/api/companies/${selectedCompanyId}/report-pack-schedules/${pack.id}/prepare`
      );
      await Promise.all([
        refetchReportPackSchedules(),
        refetchReportPackDeliveries(),
        refetchReportPackRuns(),
      ]);
      const run = result.run as ReportPackRunResult | undefined;
      const notificationCount = run?.notificationCount ?? 0;
      const deliverySummary = run
        ? ` ${run.deliveryCount} delivery record${run.deliveryCount === 1 ? "" : "s"}: ${
            run.sentCount
          } sent, ${run.queuedCount} queued, ${run.failedCount} failed.`
        : "";
      toast({
        title: "Report pack prepared",
        description: `${pack.title} is ready. ${notificationCount} notification${
          notificationCount === 1 ? "" : "s"
        } created.${deliverySummary}`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Report pack preparation failed",
        description: error?.message || "Could not prepare this report pack.",
      });
    } finally {
      setPreparingReportPackId(null);
    }
  };

  const handleExportReportPackRun = async (run: ReportPackRunHistoryItem) => {
    if (!selectedCompanyId) return;

    setIsExporting(true);
    try {
      await downloadReportPackRunExcel(selectedCompanyId, run.id);
      toast({
        title: "Report pack run exported",
        description: `${run.packTitle} run workbook is ready.`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Run export failed",
        description: error?.message || "Could not export this report pack run.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const getReportExportData = (tab: ReportTab): ExportData | null => {
    if (tab === "pl" && profitLoss) return prepareProfitLossForExport(profitLoss);
    if (tab === "bs" && balanceSheet) return prepareBalanceSheetForExport(balanceSheet);
    if (tab === "vat" && vatSummary) return prepareVATSummaryForExport(vatSummary);
    if (tab === "trial" && trialBalance) return prepareTrialBalanceForExport(trialBalance);
    if (tab === "ledger" && generalLedger) return prepareGeneralLedgerForExport(generalLedger);
    if (tab === "cashFlow" && cashFlowData) return prepareCashFlowForExport(cashFlowData);
    if (tab === "cashFlowForecast" && cashFlowForecast)
      return prepareCashFlowForecastForExport(cashFlowForecast);
    if (tab === "vatReturn" && hasDateRange && vatReturn)
      return prepareVATReturnForExport(vatReturn);
    if (tab === "fx" && fxGainsLosses) return prepareFxGainsLossesForExport(fxGainsLosses);
    if (tab === "aging" && agingData) return prepareAgingForExport(agingData);
    if (tab === "customers" && customerBalances)
      return prepareCustomerBalancesForExport(customerBalances);
    if (tab === "vendors" && vendorBalances) return prepareVendorBalancesForExport(vendorBalances);
    if (tab === "revenueCustomers" && revenueByCustomer)
      return prepareRevenueByCustomerForExport(revenueByCustomer);
    if (tab === "salesServices" && salesByService)
      return prepareSalesByServiceForExport(salesByService);
    if (tab === "expenseVendors" && expensesByVendor)
      return prepareExpensesByVendorForExport(expensesByVendor);
    if (tab === "expenseCategories" && expensesByCategory)
      return prepareExpensesByCategoryForExport(expensesByCategory);
    if (tab === "invoiceStatus" && invoiceStatus)
      return prepareInvoiceStatusForExport(invoiceStatus);
    if (tab === "budgetActual" && budgetVsActual)
      return prepareBudgetVsActualForExport(budgetVsActual);
    if (tab === "payrollSummary" && payrollSummary)
      return preparePayrollSummaryForExport(payrollSummary);
    if (tab === "corpTax" && corporateTaxEstimate)
      return prepareCorporateTaxEstimateForExport(corporateTaxEstimate);
    if (tab === "fixedAssets" && fixedAssetRegister)
      return prepareFixedAssetRegisterForExport(fixedAssetRegister);
    if (tab === "depreciation" && depreciationSchedule)
      return prepareDepreciationScheduleForExport(depreciationSchedule);
    if (tab === "inventoryValuation" && inventoryValuation)
      return prepareInventoryValuationForExport(inventoryValuation);
    if (tab === "monthEndClose" && monthEndClose)
      return prepareMonthEndCloseForExport(monthEndClose, monthEndCloseHistory ?? []);
    if (tab === "comparison" && comparisonData)
      return preparePeriodComparisonForExport(comparisonData);
    return null;
  };

  const handleOpenReportPack = (pack: ReportPackSummary) => {
    setPersonaFilter(pack.persona);
    setReportSearch("");
    if (pack.primaryTab) {
      setActiveTab(pack.primaryTab);
    }
  };

  const handleExportReportPackExcel = async (pack: ReportPackSummary) => {
    const sheets = pack.reports
      .map((report) => (report.tab ? getReportExportData(report.tab) : null))
      .filter((sheet): sheet is ExportData => Boolean(sheet));

    if (sheets.length === 0) {
      toast({
        variant: "destructive",
        title: "Report pack unavailable",
        description: "The live reports in this pack are still loading or need a date range.",
      });
      return;
    }

    const dateRangeStr =
      dateRange.from && dateRange.to
        ? `_${format(dateRange.from, "yyyy-MM-dd")}_to_${format(dateRange.to, "yyyy-MM-dd")}`
        : "";

    try {
      await exportToExcel(sheets, `${pack.id}${dateRangeStr}`);
      toast({
        title: "Report pack exported",
        description: `${sheets.length} sheets exported for ${pack.title}.`,
      });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Export failed", description: error?.message });
    }
  };

  const handleExportExcel = async () => {
    const dateRangeStr =
      dateRange.from && dateRange.to
        ? `_${format(dateRange.from, "yyyy-MM-dd")}_to_${format(dateRange.to, "yyyy-MM-dd")}`
        : "";

    try {
      if (activeTab === "pl" && profitLoss) {
        await exportToExcel([prepareProfitLossForExport(profitLoss)], `profit_loss${dateRangeStr}`);
        toast({ title: "Export successful", description: "Profit & Loss exported to Excel" });
      } else if (activeTab === "bs" && balanceSheet) {
        await exportToExcel(
          [prepareBalanceSheetForExport(balanceSheet)],
          `balance_sheet${dateRangeStr}`
        );
        toast({ title: "Export successful", description: "Balance Sheet exported to Excel" });
      } else if (activeTab === "vat" && vatSummary) {
        await exportToExcel([prepareVATSummaryForExport(vatSummary)], `vat_summary${dateRangeStr}`);
        toast({ title: "Export successful", description: "VAT Summary exported to Excel" });
      } else if (activeTab === "trial" && trialBalance) {
        await exportToExcel(
          [prepareTrialBalanceForExport(trialBalance)],
          `trial_balance${dateRangeStr}`
        );
        toast({ title: "Export successful", description: "Trial Balance exported to Excel" });
      } else if (activeTab === "ledger" && generalLedger) {
        await exportToExcel(
          [prepareGeneralLedgerForExport(generalLedger)],
          `general_ledger${dateRangeStr}`
        );
        toast({ title: "Export successful", description: "General Ledger exported to Excel" });
      } else if (activeTab === "cashFlow" && cashFlowData) {
        await exportToExcel([prepareCashFlowForExport(cashFlowData)], `cash_flow_${reportPeriod}`);
        toast({ title: "Export successful", description: "Cash Flow exported to Excel" });
      } else if (activeTab === "cashFlowForecast" && cashFlowForecast) {
        await exportToExcel(
          [prepareCashFlowForecastForExport(cashFlowForecast)],
          "cash_flow_forecast_90_days"
        );
        toast({
          title: "Export successful",
          description: "Cash Flow Forecast exported to Excel",
        });
      } else if (activeTab === "vatReturn") {
        if (!hasDateRange) {
          toast({
            variant: "destructive",
            title: "Date range required",
            description: "Select a from and to date before exporting the VAT Return.",
          });
          return;
        }
        if (vatReturn) {
          await exportToExcel([prepareVATReturnForExport(vatReturn)], `vat_return${dateRangeStr}`);
          toast({ title: "Export successful", description: "VAT Return exported to Excel" });
        }
      } else if (activeTab === "fx" && fxGainsLosses) {
        await exportToExcel(
          [prepareFxGainsLossesForExport(fxGainsLosses)],
          `fx_gains_losses${dateRangeStr}`
        );
        toast({ title: "Export successful", description: "FX Gains/Losses exported to Excel" });
      } else if (activeTab === "aging" && agingData) {
        await exportToExcel([prepareAgingForExport(agingData)], "ar_ap_aging");
        toast({ title: "Export successful", description: "A/R and A/P Aging exported to Excel" });
      } else if (activeTab === "customers" && customerBalances) {
        await exportToExcel(
          [prepareCustomerBalancesForExport(customerBalances)],
          `customer_balances${dateRangeStr}`
        );
        toast({
          title: "Export successful",
          description: "Customer Balance Summary exported to Excel",
        });
      } else if (activeTab === "vendors" && vendorBalances) {
        await exportToExcel(
          [prepareVendorBalancesForExport(vendorBalances)],
          `vendor_balances${dateRangeStr}`
        );
        toast({
          title: "Export successful",
          description: "Vendor Balance Summary exported to Excel",
        });
      } else if (activeTab === "revenueCustomers" && revenueByCustomer) {
        await exportToExcel(
          [prepareRevenueByCustomerForExport(revenueByCustomer)],
          `revenue_by_customer${dateRangeStr}`
        );
        toast({ title: "Export successful", description: "Revenue by Customer exported to Excel" });
      } else if (activeTab === "salesServices" && salesByService) {
        await exportToExcel(
          [prepareSalesByServiceForExport(salesByService)],
          `sales_by_service${dateRangeStr}`
        );
        toast({
          title: "Export successful",
          description: "Sales by Product/Service exported to Excel",
        });
      } else if (activeTab === "expenseVendors" && expensesByVendor) {
        await exportToExcel(
          [prepareExpensesByVendorForExport(expensesByVendor)],
          `expenses_by_vendor${dateRangeStr}`
        );
        toast({ title: "Export successful", description: "Expenses by Vendor exported to Excel" });
      } else if (activeTab === "expenseCategories" && expensesByCategory) {
        await exportToExcel(
          [prepareExpensesByCategoryForExport(expensesByCategory)],
          `expenses_by_category${dateRangeStr}`
        );
        toast({
          title: "Export successful",
          description: "Expenses by Category exported to Excel",
        });
      } else if (activeTab === "invoiceStatus" && invoiceStatus) {
        await exportToExcel(
          [prepareInvoiceStatusForExport(invoiceStatus)],
          `invoice_status${dateRangeStr}`
        );
        toast({ title: "Export successful", description: "Invoice Status exported to Excel" });
      } else if (activeTab === "budgetActual" && budgetVsActual) {
        await exportToExcel(
          [prepareBudgetVsActualForExport(budgetVsActual)],
          `budget_vs_actual${dateRangeStr}`
        );
        toast({ title: "Export successful", description: "Budget vs Actual exported to Excel" });
      } else if (activeTab === "payrollSummary" && payrollSummary) {
        await exportToExcel(
          [preparePayrollSummaryForExport(payrollSummary)],
          `payroll_summary${dateRangeStr}`
        );
        toast({ title: "Export successful", description: "Payroll Summary exported to Excel" });
      } else if (activeTab === "corpTax" && corporateTaxEstimate) {
        await exportToExcel(
          [prepareCorporateTaxEstimateForExport(corporateTaxEstimate)],
          `corporate_tax_estimate${dateRangeStr}`
        );
        toast({
          title: "Export successful",
          description: "Corporate Tax Estimate exported to Excel",
        });
      } else if (activeTab === "fixedAssets" && fixedAssetRegister) {
        await exportToExcel(
          [prepareFixedAssetRegisterForExport(fixedAssetRegister)],
          `fixed_asset_register${dateRangeStr}`
        );
        toast({
          title: "Export successful",
          description: "Fixed Asset Register exported to Excel",
        });
      } else if (activeTab === "depreciation" && depreciationSchedule) {
        await exportToExcel(
          [prepareDepreciationScheduleForExport(depreciationSchedule)],
          `depreciation_schedule${dateRangeStr}`
        );
        toast({
          title: "Export successful",
          description: "Depreciation Schedule exported to Excel",
        });
      } else if (activeTab === "inventoryValuation" && inventoryValuation) {
        await exportToExcel(
          [prepareInventoryValuationForExport(inventoryValuation)],
          `inventory_valuation${dateRangeStr}`
        );
        toast({
          title: "Export successful",
          description: "Inventory Valuation exported to Excel",
        });
      } else if (activeTab === "monthEndClose" && monthEndClose) {
        await exportToExcel(
          [prepareMonthEndCloseForExport(monthEndClose, monthEndCloseHistory ?? [])],
          `month_end_close_${closePeriod}`
        );
        toast({
          title: "Export successful",
          description: "Month-End Close Status exported to Excel",
        });
      } else if (activeTab === "comparison" && comparisonData) {
        await exportToExcel(
          [preparePeriodComparisonForExport(comparisonData)],
          `period_comparison_${reportPeriod}`
        );
        toast({ title: "Export successful", description: "Period Comparison exported to Excel" });
      } else {
        toast({
          variant: "destructive",
          title: "Export unavailable",
          description: "This report is still loading or is not available yet.",
        });
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Export failed", description: error?.message });
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
    } else if (activeTab === "trial" && trialBalance) {
      result = await exportToGoogleSheets(
        [prepareTrialBalanceForExport(trialBalance)],
        `Trial Balance${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "ledger" && generalLedger) {
      result = await exportToGoogleSheets(
        [prepareGeneralLedgerForExport(generalLedger)],
        `General Ledger${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "cashFlow" && cashFlowData) {
      result = await exportToGoogleSheets(
        [prepareCashFlowForExport(cashFlowData)],
        `Cash Flow ${periodLabel}`,
        selectedCompanyId
      );
    } else if (activeTab === "cashFlowForecast" && cashFlowForecast) {
      result = await exportToGoogleSheets(
        [prepareCashFlowForecastForExport(cashFlowForecast)],
        "Cash Flow Forecast 90 Days",
        selectedCompanyId
      );
    } else if (activeTab === "vatReturn") {
      if (!hasDateRange) {
        setIsExporting(false);
        toast({
          variant: "destructive",
          title: "Date range required",
          description: "Select a from and to date before exporting the VAT Return.",
        });
        return;
      }
      if (vatReturn) {
        result = await exportToGoogleSheets(
          [prepareVATReturnForExport(vatReturn)],
          `VAT Return${dateRangeStr}`,
          selectedCompanyId
        );
      }
    } else if (activeTab === "fx" && fxGainsLosses) {
      result = await exportToGoogleSheets(
        [prepareFxGainsLossesForExport(fxGainsLosses)],
        `FX Gains Losses${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "aging" && agingData) {
      result = await exportToGoogleSheets(
        [prepareAgingForExport(agingData)],
        "A/R and A/P Aging",
        selectedCompanyId
      );
    } else if (activeTab === "customers" && customerBalances) {
      result = await exportToGoogleSheets(
        [prepareCustomerBalancesForExport(customerBalances)],
        `Customer Balances${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "vendors" && vendorBalances) {
      result = await exportToGoogleSheets(
        [prepareVendorBalancesForExport(vendorBalances)],
        `Vendor Balances${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "revenueCustomers" && revenueByCustomer) {
      result = await exportToGoogleSheets(
        [prepareRevenueByCustomerForExport(revenueByCustomer)],
        `Revenue by Customer${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "salesServices" && salesByService) {
      result = await exportToGoogleSheets(
        [prepareSalesByServiceForExport(salesByService)],
        `Sales by Service${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "expenseVendors" && expensesByVendor) {
      result = await exportToGoogleSheets(
        [prepareExpensesByVendorForExport(expensesByVendor)],
        `Expenses by Vendor${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "expenseCategories" && expensesByCategory) {
      result = await exportToGoogleSheets(
        [prepareExpensesByCategoryForExport(expensesByCategory)],
        `Expenses by Category${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "invoiceStatus" && invoiceStatus) {
      result = await exportToGoogleSheets(
        [prepareInvoiceStatusForExport(invoiceStatus)],
        `Invoice Status${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "budgetActual" && budgetVsActual) {
      result = await exportToGoogleSheets(
        [prepareBudgetVsActualForExport(budgetVsActual)],
        `Budget vs Actual${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "payrollSummary" && payrollSummary) {
      result = await exportToGoogleSheets(
        [preparePayrollSummaryForExport(payrollSummary)],
        `Payroll Summary${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "corpTax" && corporateTaxEstimate) {
      result = await exportToGoogleSheets(
        [prepareCorporateTaxEstimateForExport(corporateTaxEstimate)],
        `Corporate Tax Estimate${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "fixedAssets" && fixedAssetRegister) {
      result = await exportToGoogleSheets(
        [prepareFixedAssetRegisterForExport(fixedAssetRegister)],
        `Fixed Asset Register${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "depreciation" && depreciationSchedule) {
      result = await exportToGoogleSheets(
        [prepareDepreciationScheduleForExport(depreciationSchedule)],
        `Depreciation Schedule${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "inventoryValuation" && inventoryValuation) {
      result = await exportToGoogleSheets(
        [prepareInventoryValuationForExport(inventoryValuation)],
        `Inventory Valuation${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "monthEndClose" && monthEndClose) {
      result = await exportToGoogleSheets(
        [prepareMonthEndCloseForExport(monthEndClose, monthEndCloseHistory ?? [])],
        `Month-End Close ${closePeriod}`,
        selectedCompanyId
      );
    } else if (activeTab === "comparison" && comparisonData) {
      result = await exportToGoogleSheets(
        [preparePeriodComparisonForExport(comparisonData)],
        `Period Comparison ${periodLabel}`,
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
        description: result?.error || "This report is still loading or is not available yet.",
      });
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-semibold mb-2">{t.reports}</h1>
          <p className="text-muted-foreground">
            Financial statements, tax reports, and management views
          </p>
        </div>
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
      </div>

      <section className="space-y-4" aria-labelledby="report-center-title">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="report-center-title" className="text-xl font-semibold">
              Report center
            </h2>
            <p className="text-sm text-muted-foreground">
              {reportStats.ready} ready or connected reports from a {reportStats.total}-report
              catalog
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={reportSearch}
                onChange={(event) => setReportSearch(event.target.value)}
                placeholder="Search reports"
                className="pl-9"
                data-testid="input-report-search"
              />
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Report persona filter">
              {personaFilters.map((filter) => (
                <Button
                  key={filter.id}
                  type="button"
                  size="sm"
                  variant={personaFilter === filter.id ? "default" : "outline"}
                  onClick={() => setPersonaFilter(filter.id)}
                  data-testid={`button-report-filter-${filter.id}`}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Inline views
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold font-mono">{reportStats.live}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Ready/connected
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold font-mono">{reportStats.ready}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Roadmap</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold font-mono">{reportStats.planned}</div>
            </CardContent>
          </Card>
        </div>

        <section className="space-y-4" aria-labelledby="automation-queue-title">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 id="automation-queue-title" className="text-lg font-semibold">
                Automation queue
              </h3>
              <p className="text-sm text-muted-foreground">
                Report-driven actions NR-Ai can help move next.
              </p>
            </div>
            <Badge variant={automationQueueItems.length > 0 ? "warning" : "success"} dot>
              {automationQueueItems.length > 0 ? "Needs review" : "Clear"}
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Active actions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-mono text-2xl font-semibold">
                  {formatNumber(automationQueueItems.length, locale)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Queue items
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-mono text-2xl font-semibold">
                  {formatNumber(automationQueueTotals.count, locale)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Tracked exposure
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-mono text-2xl font-semibold">
                  {formatCurrency(automationQueueTotals.impact, "AED", locale)}
                </div>
              </CardContent>
            </Card>
          </div>

          {visibleAutomationQueueItems.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {visibleAutomationQueueItems.map((item) => {
                const priority = automationPriorityMeta[item.priority];
                return (
                  <Card key={item.id}>
                    <CardHeader className="space-y-3 pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">{item.title}</CardTitle>
                          <CardDescription>{item.source}</CardDescription>
                        </div>
                        <Badge variant={priority.variant} dot>
                          {priority.label}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">Count</div>
                          <div className="font-mono text-lg font-semibold">
                            {formatNumber(item.count, locale)}
                          </div>
                        </div>
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">Impact</div>
                          <div className="font-mono text-lg font-semibold">
                            {formatCurrency(item.impact, "AED", locale)}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {item.personas.map((persona) => (
                          <Badge key={persona} variant="outline" className="capitalize">
                            {persona}
                          </Badge>
                        ))}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {item.tab && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setActiveTab(item.tab!)}
                            data-testid={`button-open-automation-report-${item.id}`}
                          >
                            Open report
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {item.href && (
                          <Button asChild size="sm">
                            <Link href={item.href}>
                              {item.actionLabel}
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col gap-2 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium">
                    No active automation actions from loaded reports
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Select a date range or open report tabs to load more automation signals.
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={() => setActiveTab("comparison")}>
                  Review comparisons
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          )}
        </section>

        <section className="space-y-4" aria-labelledby="report-packs-title">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 id="report-packs-title" className="text-lg font-semibold">
                Automation report packs
              </h3>
              <p className="text-sm text-muted-foreground">
                Persona-ready bundles for owners, freelancers, and accountants.
              </p>
            </div>
            <Badge variant="outline">{reportPackSummaries.length} packs</Badge>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {reportPackSummaries.map((pack) => {
              const completion = pack.reports.length
                ? Math.round((pack.liveCount / pack.reports.length) * 100)
                : 0;
              const visibleReports = pack.reports.slice(0, 6);
              const remainingReports = Math.max(pack.reports.length - visibleReports.length, 0);
              const schedule = scheduleByPackId.get(pack.id);
              const draft =
                reportPackScheduleDrafts[pack.id] ??
                scheduleDraftFromSchedule(schedule, fallbackReportPackRecipient);
              const isSavingSchedule = savingReportPackId === pack.id;
              const isPreparingPack = preparingReportPackId === pack.id;
              const draftRecipients = recipientsFromText(draft.recipientsText);
              const compatibleRecipients = compatibleRecipientCount(draft.channel, draftRecipients);

              return (
                <Card key={pack.id} className="min-h-[340px]">
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <Sparkles className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">{pack.title}</CardTitle>
                          <CardDescription className="capitalize">{pack.persona}</CardDescription>
                        </div>
                      </div>
                      <Badge variant="success" dot>
                        {pack.liveCount} live
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          schedule?.isDue ? "warning" : schedule?.enabled ? "success" : "neutral"
                        }
                        dot
                      >
                        {schedule?.isDue
                          ? "Due now"
                          : schedule?.enabled
                            ? "Scheduled"
                            : "Not scheduled"}
                      </Badge>
                      {schedule?.enabled && (
                        <span className="text-xs text-muted-foreground">
                          {schedule.cadence} via {schedule.channel}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{pack.summary}</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-md border p-2">
                        <div className="font-mono text-lg font-semibold">{pack.reports.length}</div>
                        <div className="text-xs text-muted-foreground">Reports</div>
                      </div>
                      <div className="rounded-md border p-2">
                        <div className="font-mono text-lg font-semibold">{pack.readyCount}</div>
                        <div className="text-xs text-muted-foreground">Ready</div>
                      </div>
                      <div className="rounded-md border p-2">
                        <div className="font-mono text-lg font-semibold">{pack.plannedCount}</div>
                        <div className="text-xs text-muted-foreground">Queued</div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">Live coverage</span>
                        <span className="font-mono">{completion}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-secondary">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${completion}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                      <div>
                        <div className="font-medium">Cadence</div>
                        <div className="text-muted-foreground">{pack.cadence}</div>
                      </div>
                      <div>
                        <div className="font-medium">Delivery</div>
                        <div className="text-muted-foreground">{pack.delivery}</div>
                      </div>
                      <div>
                        <div className="font-medium">Next run</div>
                        <div className="text-muted-foreground">
                          {formatScheduleDate(schedule?.nextRunDate)}
                        </div>
                      </div>
                      <div>
                        <div className="font-medium">Last prepared</div>
                        <div className="text-muted-foreground">
                          {formatScheduleDate(schedule?.lastPreparedAt)}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-md border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-medium">Scheduled delivery</div>
                          <div className="text-xs text-muted-foreground">
                            Save this pack for recurring email or WhatsApp delivery.
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Compare</span>
                          <Switch
                            checked={draft.includeComparison}
                            onCheckedChange={(checked) =>
                              updateReportPackScheduleDraft(pack.id, {
                                includeComparison: checked,
                              })
                            }
                            data-testid={`switch-report-pack-comparison-${pack.id}`}
                          />
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                        <div className="space-y-1">
                          <div className="text-xs font-medium">Cadence</div>
                          <Select
                            value={draft.cadence}
                            onValueChange={(value) =>
                              updateReportPackScheduleDraft(pack.id, {
                                cadence: value as ReportPackCadence,
                              })
                            }
                          >
                            <SelectTrigger data-testid={`select-report-pack-cadence-${pack.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {reportPackCadenceOptions.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-medium">Channel</div>
                          <Select
                            value={draft.channel}
                            onValueChange={(value) =>
                              updateReportPackScheduleDraft(pack.id, {
                                channel: value as ReportPackChannel,
                              })
                            }
                          >
                            <SelectTrigger data-testid={`select-report-pack-channel-${pack.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {reportPackChannelOptions.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-xs font-medium">Recipients</div>
                        <Input
                          value={draft.recipientsText}
                          onChange={(event) =>
                            updateReportPackScheduleDraft(pack.id, {
                              recipientsText: event.target.value,
                            })
                          }
                          placeholder="email or WhatsApp, comma separated"
                          data-testid={`input-report-pack-recipients-${pack.id}`}
                        />
                        {draftRecipients.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {compatibleRecipients} of {draftRecipients.length} recipient
                            {draftRecipients.length === 1 ? "" : "s"} match {draft.channel}{" "}
                            delivery.
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleSaveReportPackSchedule(pack, true)}
                          disabled={isSavingSchedule || reportPackSchedulesLoading}
                          data-testid={`button-save-report-pack-schedule-${pack.id}`}
                        >
                          {isSavingSchedule ? "Saving..." : "Schedule pack"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleSaveReportPackSchedule(pack, false)}
                          disabled={isSavingSchedule || reportPackSchedulesLoading}
                          data-testid={`button-pause-report-pack-schedule-${pack.id}`}
                        >
                          Pause
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handlePrepareReportPackNow(pack)}
                          disabled={isPreparingPack || reportPackSchedulesLoading}
                          data-testid={`button-prepare-report-pack-${pack.id}`}
                        >
                          {isPreparingPack ? "Preparing..." : "Prepare now"}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium">Included reports</div>
                      <div className="flex flex-wrap gap-1.5">
                        {visibleReports.map((report) => {
                          const status = reportStatusMeta[report.status];
                          return (
                            <Badge
                              key={report.name}
                              variant={status.variant}
                              className="max-w-full"
                            >
                              <span className="truncate">{report.name}</span>
                            </Badge>
                          );
                        })}
                        {remainingReports > 0 && (
                          <Badge variant="outline">+{remainingReports} more</Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {pack.actions.map((action) => (
                        <Button key={action.href} asChild size="sm" variant="outline">
                          <Link href={action.href}>
                            {action.label}
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleOpenReportPack(pack)}
                        disabled={!pack.primaryTab}
                        data-testid={`button-open-report-pack-${pack.id}`}
                      >
                        Open pack
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleExportReportPackExcel(pack)}
                        data-testid={`button-export-report-pack-${pack.id}`}
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        Export pack
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Prepared pack runs</CardTitle>
                <CardDescription>
                  Durable run summaries with included reports, recommendations, and delivery counts.
                </CardDescription>
              </div>
              <Badge variant="outline">
                {reportPackRunsLoading ? "Loading" : `${reportPackRuns?.length ?? 0} runs`}
              </Badge>
            </CardHeader>
            <CardContent>
              {reportPackRunsLoading ? (
                <div className="text-sm text-muted-foreground">Loading prepared runs...</div>
              ) : !reportPackRuns?.length ? (
                <div className="text-sm text-muted-foreground">
                  No prepared report-pack runs yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pack</TableHead>
                        <TableHead>Prepared</TableHead>
                        <TableHead>Reports</TableHead>
                        <TableHead>Snapshot</TableHead>
                        <TableHead>Recommendations</TableHead>
                        <TableHead>Delivery</TableHead>
                        <TableHead>Next run</TableHead>
                        <TableHead className="text-right">Export</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportPackRuns.map((run) => (
                        <TableRow key={run.id} data-testid={`row-report-pack-run-${run.id}`}>
                          <TableCell className="min-w-[170px]">
                            <div className="font-medium">{run.packTitle}</div>
                            <div className="text-xs capitalize text-muted-foreground">
                              {run.persona} - {run.cadence} via {run.channel}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[140px]">
                            {formatDeliveryDate(run.preparedAt)}
                          </TableCell>
                          <TableCell className="min-w-[120px]">
                            <div className="font-mono text-sm">{run.reportNames.length}</div>
                            <div className="text-xs text-muted-foreground">
                              {run.includeComparison ? "Comparisons on" : "No comparisons"}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[220px]">
                            {run.snapshotMetrics.length > 0 ? (
                              <div className="space-y-1">
                                {run.snapshotMetrics.slice(0, 3).map((metric) => (
                                  <div
                                    key={`${run.id}-${metric.key}`}
                                    className="flex items-center justify-between gap-3 text-xs"
                                  >
                                    <span className="truncate text-muted-foreground">
                                      {metric.label}
                                    </span>
                                    <span className="shrink-0 font-mono font-medium">
                                      {formatSnapshotMetricValue(metric, locale)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">No snapshot</span>
                            )}
                          </TableCell>
                          <TableCell className="min-w-[270px]">
                            {run.recommendations?.length ? (
                              <div className="space-y-2">
                                {run.recommendations.slice(0, 2).map((recommendation) => {
                                  const priority = automationPriorityMeta[recommendation.priority];
                                  return (
                                    <div
                                      key={`${run.id}-${recommendation.id}`}
                                      className="space-y-1 text-sm"
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <span className="font-medium leading-snug">
                                          {recommendation.title}
                                        </span>
                                        <Badge variant={priority.variant} dot>
                                          {priority.label}
                                        </Badge>
                                      </div>
                                      <p className="line-clamp-2 text-xs text-muted-foreground">
                                        {recommendation.description}
                                      </p>
                                      <Link
                                        href={recommendation.actionUrl}
                                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                      >
                                        {recommendation.actionLabel}
                                        <ArrowUpRight className="h-3 w-3" />
                                      </Link>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                No recommendations
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="min-w-[180px]">
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="success">{run.sentCount} sent</Badge>
                              <Badge variant="warning">{run.queuedCount} queued</Badge>
                              {run.failedCount > 0 && (
                                <Badge variant="danger">{run.failedCount} failed</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[120px]">
                            {formatScheduleDate(run.nextRunDate)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleExportReportPackRun(run)}
                              disabled={isExporting}
                              data-testid={`button-export-report-pack-run-${run.id}`}
                            >
                              <FileSpreadsheet className="h-3.5 w-3.5" />
                              Export
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

          <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Recent pack deliveries</CardTitle>
                <CardDescription>
                  Email sends, WhatsApp queues, and failed delivery attempts from prepared packs.
                </CardDescription>
              </div>
              <Badge variant="outline">
                {reportPackDeliveriesLoading
                  ? "Loading"
                  : `${reportPackDeliveries?.length ?? 0} records`}
              </Badge>
            </CardHeader>
            <CardContent>
              {reportPackDeliveriesLoading ? (
                <div className="text-sm text-muted-foreground">Loading delivery history...</div>
              ) : !reportPackDeliveries?.length ? (
                <div className="text-sm text-muted-foreground">
                  No report-pack delivery history yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pack</TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Channel</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Prepared</TableHead>
                        <TableHead>Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportPackDeliveries.map((delivery) => (
                        <TableRow
                          key={delivery.id}
                          data-testid={`row-report-pack-delivery-${delivery.id}`}
                        >
                          <TableCell className="min-w-[160px] font-medium">
                            {delivery.packTitle}
                          </TableCell>
                          <TableCell className="min-w-[180px]">
                            <span className="break-all">{delivery.recipient}</span>
                          </TableCell>
                          <TableCell className="capitalize">{delivery.channel}</TableCell>
                          <TableCell>
                            <Badge variant={deliveryStatusVariant(delivery.status)} dot>
                              {delivery.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="min-w-[140px]">
                            {formatDeliveryDate(delivery.preparedAt ?? delivery.sentAt)}
                          </TableCell>
                          <TableCell className="min-w-[180px] text-sm text-muted-foreground">
                            {delivery.error
                              ? delivery.error
                              : delivery.provider
                                ? `Provider: ${delivery.provider}`
                                : delivery.cadence
                                  ? `${delivery.cadence} pack`
                                  : "Recorded"}
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

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {filteredReports.map((report) => {
            const Icon = report.icon;
            const status = reportStatusMeta[report.status];
            const reportTab = report.tab;
            return (
              <Card key={report.name} className="min-h-[184px]">
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="truncate text-sm font-semibold">
                          {report.name}
                        </CardTitle>
                        <CardDescription className="truncate text-xs">
                          {report.category}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge variant={status.variant} dot className="shrink-0">
                      {status.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="text-muted-foreground">Compare</div>
                      <div className="truncate font-medium">{report.comparison}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-muted-foreground">Automation</div>
                      <div className="truncate font-medium">{report.automation}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {report.personas.map((persona) => (
                        <Badge key={persona} variant="outline" className="capitalize">
                          {persona}
                        </Badge>
                      ))}
                    </div>
                    {reportTab ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setActiveTab(reportTab)}
                        data-testid={`button-open-report-${reportTab}`}
                      >
                        Open
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Button>
                    ) : report.href ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={report.href}>
                          Open
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="ghost" disabled>
                        Queued
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm font-medium">Filter by date:</span>
              <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Cash/comparison cadence:</span>
              {reportPeriodOptions.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  size="sm"
                  variant={reportPeriod === option.id ? "default" : "outline"}
                  onClick={() => setReportPeriod(option.id)}
                  data-testid={`button-report-period-${option.id}`}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ReportTab)}
        className="space-y-6"
      >
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="pl" data-testid="tab-profit-loss">
            {t.profitLoss}
          </TabsTrigger>
          <TabsTrigger value="bs" data-testid="tab-balance-sheet">
            {t.balanceSheet}
          </TabsTrigger>
          <TabsTrigger value="cashFlow" data-testid="tab-cash-flow">
            Cash Flow
          </TabsTrigger>
          <TabsTrigger value="cashFlowForecast" data-testid="tab-cash-flow-forecast">
            Forecast
          </TabsTrigger>
          <TabsTrigger value="vat" data-testid="tab-vat-summary">
            {t.vatSummary}
          </TabsTrigger>
          <TabsTrigger value="trial" data-testid="tab-trial-balance">
            Trial Balance
          </TabsTrigger>
          <TabsTrigger value="ledger" data-testid="tab-general-ledger">
            Ledger
          </TabsTrigger>
          <TabsTrigger value="vatReturn" data-testid="tab-vat-return">
            VAT Return
          </TabsTrigger>
          <TabsTrigger value="aging" data-testid="tab-aging">
            Aging
          </TabsTrigger>
          <TabsTrigger value="customers" data-testid="tab-customer-balances">
            Customers
          </TabsTrigger>
          <TabsTrigger value="vendors" data-testid="tab-vendor-balances">
            Vendors
          </TabsTrigger>
          <TabsTrigger value="revenueCustomers" data-testid="tab-revenue-by-customer">
            Revenue
          </TabsTrigger>
          <TabsTrigger value="salesServices" data-testid="tab-sales-by-service">
            Services
          </TabsTrigger>
          <TabsTrigger value="expenseVendors" data-testid="tab-expenses-by-vendor">
            Vendor Spend
          </TabsTrigger>
          <TabsTrigger value="expenseCategories" data-testid="tab-expenses-by-category">
            Categories
          </TabsTrigger>
          <TabsTrigger value="invoiceStatus" data-testid="tab-invoice-status">
            Invoices
          </TabsTrigger>
          <TabsTrigger value="budgetActual" data-testid="tab-budget-vs-actual">
            Budget
          </TabsTrigger>
          <TabsTrigger value="payrollSummary" data-testid="tab-payroll-summary">
            Payroll
          </TabsTrigger>
          <TabsTrigger value="corpTax" data-testid="tab-corporate-tax-estimate">
            Corp Tax
          </TabsTrigger>
          <TabsTrigger value="fixedAssets" data-testid="tab-fixed-asset-register">
            Assets
          </TabsTrigger>
          <TabsTrigger value="depreciation" data-testid="tab-depreciation-schedule">
            Depreciation
          </TabsTrigger>
          <TabsTrigger value="inventoryValuation" data-testid="tab-inventory-valuation">
            Inventory
          </TabsTrigger>
          <TabsTrigger value="monthEndClose" data-testid="tab-month-end-close">
            Close
          </TabsTrigger>
          <TabsTrigger value="comparison" data-testid="tab-comparison">
            Compare
          </TabsTrigger>
          <TabsTrigger value="fx" data-testid="tab-fx-gains-losses">
            FX
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
            <CardContent className="overflow-x-auto">
              {plLoading ? (
                <Skeleton className="h-64" />
              ) : (
                <div className="space-y-6 min-w-[520px]">
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
            <CardContent className="overflow-x-auto">
              {bsLoading ? (
                <Skeleton className="h-96" />
              ) : (
                <div className="space-y-6 min-w-[520px]">
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

        <TabsContent value="cashFlow" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Operating Cash Flow
                </CardTitle>
              </CardHeader>
              <CardContent>
                {cashFlowLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div
                    className={`text-2xl font-semibold font-mono ${cashFlowSummary.operating >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  >
                    {formatCurrency(cashFlowSummary.operating, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Investing Cash Flow
                </CardTitle>
              </CardHeader>
              <CardContent>
                {cashFlowLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div
                    className={`text-2xl font-semibold font-mono ${cashFlowSummary.investing >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  >
                    {formatCurrency(cashFlowSummary.investing, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Financing Cash Flow
                </CardTitle>
              </CardHeader>
              <CardContent>
                {cashFlowLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div
                    className={`text-2xl font-semibold font-mono ${cashFlowSummary.financing >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  >
                    {formatCurrency(cashFlowSummary.financing, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Ending Cash Balance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {cashFlowLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(cashFlowSummary.endingBalance, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Cash Flow Statement</CardTitle>
              <CardDescription>
                {periodLabel} cash movement across operating, investing, and financing activity.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {cashFlowLoading ? (
                <Skeleton className="h-96" />
              ) : cashFlowData?.length ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Operating In</TableHead>
                        <TableHead className="text-right">Operating Out</TableHead>
                        <TableHead className="text-right">Operating Net</TableHead>
                        <TableHead className="text-right">Investing Net</TableHead>
                        <TableHead className="text-right">Financing Net</TableHead>
                        <TableHead className="text-right">Net Cash Flow</TableHead>
                        <TableHead className="text-right">Ending Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cashFlowData.map((row) => {
                        const operatingNet = row.operatingInflow - row.operatingOutflow;
                        const investingNet = row.investingInflow - row.investingOutflow;
                        const financingNet = row.financingInflow - row.financingOutflow;
                        return (
                          <TableRow key={row.period}>
                            <TableCell className="font-medium">{row.period}</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(row.operatingInflow, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(row.operatingOutflow, "AED", locale)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono ${operatingNet >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                            >
                              {formatCurrency(operatingNet, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(investingNet, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(financingNet, "AED", locale)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono font-medium ${row.netCashFlow >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                            >
                              {formatCurrency(row.netCashFlow, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(row.endingBalance, "AED", locale)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No cash flow activity found for this cadence.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cashFlowForecast" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Current Balance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {cashFlowForecastLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div
                    className={`text-2xl font-semibold font-mono ${cashFlowForecastSummary.currentBalance >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  >
                    {formatCurrency(cashFlowForecastSummary.currentBalance, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  90-Day Net Movement
                </CardTitle>
              </CardHeader>
              <CardContent>
                {cashFlowForecastLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div
                    className={`text-2xl font-semibold font-mono ${cashFlowForecastSummary.netMovement >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  >
                    {formatCurrency(cashFlowForecastSummary.netMovement, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Projected Balance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {cashFlowForecastLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div
                    className={`text-2xl font-semibold font-mono ${cashFlowForecastSummary.finalBalance >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  >
                    {formatCurrency(cashFlowForecastSummary.finalBalance, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Forecast Actions
                </CardTitle>
                <Badge variant={cashFlowForecastRiskQueue > 0 ? "warning" : "success"} dot>
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {cashFlowForecastLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <div className="text-2xl font-semibold font-mono">
                      {formatNumber(cashFlowForecastRiskQueue, locale)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {cashFlowForecastSummary.negativeBalanceWeeks > 0
                        ? `${formatNumber(cashFlowForecastSummary.negativeBalanceWeeks, locale)} negative weeks`
                        : "Low-balance weeks"}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {cashFlowForecast?.insights?.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Forecast Insights</CardTitle>
                <CardDescription>
                  Cash risk and collection signals from the 90-day forecast.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {cashFlowForecast.insights.map((insight, index) => {
                    const lower = insight.toLowerCase();
                    const variant =
                      lower.includes("warning") ||
                      lower.includes("negative") ||
                      lower.includes("drop below")
                        ? "danger"
                        : lower.includes("positive") || lower.includes("improve")
                          ? "success"
                          : "info";

                    return (
                      <div
                        key={`${index}-${insight}`}
                        className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <p className="text-sm">{insight}</p>
                        <Badge variant={variant} className="self-start">
                          {variant === "danger"
                            ? "Risk"
                            : variant === "success"
                              ? "Positive"
                              : "Info"}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Cash Flow Forecast</CardTitle>
              <CardDescription>
                Weekly projected inflows, outflows, and ending cash balance for the next 90 days.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {cashFlowForecastLoading ? (
                <Skeleton className="h-96" />
              ) : cashFlowForecast?.projections?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[920px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Week</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Expected Inflows</TableHead>
                        <TableHead className="text-right">Expected Outflows</TableHead>
                        <TableHead className="text-right">Net Movement</TableHead>
                        <TableHead className="text-right">Projected Balance</TableHead>
                        <TableHead className="text-right">Risk</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cashFlowForecast.projections.map((row) => {
                        const netMovement = row.expectedInflows - row.expectedOutflows;
                        const riskVariant =
                          row.projectedBalance < 0
                            ? "danger"
                            : row.projectedBalance < 10000
                              ? "warning"
                              : "success";

                        return (
                          <TableRow key={row.week}>
                            <TableCell className="font-mono">{row.week}</TableCell>
                            <TableCell>
                              {formatDateForExport(row.weekStart)} -{" "}
                              {formatDateForExport(row.weekEnd)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(row.expectedInflows, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(row.expectedOutflows, "AED", locale)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono ${netMovement >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                            >
                              {formatCurrency(netMovement, "AED", locale)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono font-medium ${row.projectedBalance >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                            >
                              {formatCurrency(row.projectedBalance, "AED", locale)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant={riskVariant}>
                                {riskVariant === "danger"
                                  ? "Negative"
                                  : riskVariant === "warning"
                                    ? "Low"
                                    : "Clear"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No cash flow forecast is available yet.
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

        <TabsContent value="trial" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Debits
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trialBalanceLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      trialBalance?.totals.sumDebits ?? 0,
                      trialBalance?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Credits
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trialBalanceLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      trialBalance?.totals.sumCredits ?? 0,
                      trialBalance?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Difference
                </CardTitle>
                <Badge
                  variant={(trialBalance?.totals.difference ?? 0) < 0.01 ? "success" : "danger"}
                  dot
                >
                  {(trialBalance?.totals.difference ?? 0) < 0.01 ? "Balanced" : "Review"}
                </Badge>
              </CardHeader>
              <CardContent>
                {trialBalanceLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      trialBalance?.totals.difference ?? 0,
                      trialBalance?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Trial Balance</CardTitle>
              <CardDescription>
                {dateRange.from && dateRange.to
                  ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                  : "All posted activity through today"}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {trialBalanceLoading ? (
                <Skeleton className="h-96" />
              ) : trialBalance?.rows?.length ? (
                <Table className="min-w-[860px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Flags</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trialBalance.rows.map((row) => (
                      <TableRow key={row.accountId}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.accountCode || "-"}
                        </TableCell>
                        <TableCell>{row.accountName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {row.accountType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(row.totalDebit, trialBalance.reportCurrency, locale)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(row.totalCredit, trialBalance.reportCurrency, locale)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono ${row.balance < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                        >
                          {formatCurrency(row.balance, trialBalance.reportCurrency, locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.hasForeignLines ? <Badge variant="info">FX</Badge> : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No trial balance rows found for this company.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ledger" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Period Debits
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ledgerLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      generalLedger?.totals.totalDebits ?? 0,
                      generalLedger?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Period Credits
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ledgerLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      generalLedger?.totals.totalCredits ?? 0,
                      generalLedger?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Active Accounts
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ledgerLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(generalLedger?.totals.accountCount ?? 0, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Posted Lines
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ledgerLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(generalLedger?.totals.transactionCount ?? 0, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>General Ledger</CardTitle>
              <CardDescription>
                Posted account activity with opening, period movement, and closing balances.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ledgerLoading ? (
                <Skeleton className="h-96" />
              ) : generalLedger?.accounts?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[880px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Opening</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                        <TableHead className="text-right">Closing</TableHead>
                        <TableHead className="text-right">Lines</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {generalLedger.accounts.map((account) => (
                        <TableRow key={account.accountId}>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {account.accountCode || "-"}
                          </TableCell>
                          <TableCell>{account.accountName}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {account.accountType}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              account.openingBalance,
                              generalLedger.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              account.periodDebit,
                              generalLedger.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              account.periodCredit,
                              generalLedger.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono font-medium ${account.closingBalance < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                          >
                            {formatCurrency(
                              account.closingBalance,
                              generalLedger.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(account.transactionCount, locale)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No posted ledger activity found for this period.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Ledger Lines</CardTitle>
              <CardDescription>
                Latest posted journal lines for source drill-down and reclassification review.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ledgerLoading ? (
                <Skeleton className="h-96" />
              ) : ledgerRecentTransactions.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[960px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Entry</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerRecentTransactions.map(({ account, transaction }) => (
                        <TableRow key={transaction.lineId}>
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(transaction.date), "MMM dd, yyyy")}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {transaction.entryNumber}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{account.accountName}</div>
                            <div className="text-xs text-muted-foreground">
                              {account.accountCode}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {transaction.source}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-sm truncate">
                            {transaction.description || transaction.memo || "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              transaction.debit,
                              generalLedger?.reportCurrency ?? "AED",
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              transaction.credit,
                              generalLedger?.reportCurrency ?? "AED",
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(
                              transaction.balance,
                              generalLedger?.reportCurrency ?? "AED",
                              locale
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No recent ledger lines found.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vatReturn" className="space-y-6">
          {!hasDateRange ? (
            <Card>
              <CardHeader>
                <CardTitle>VAT Return</CardTitle>
                <CardDescription>
                  Select a from and to date above to generate the UAE VAT return boxes.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Output VAT
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {vatReturnLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div className="text-2xl font-semibold font-mono">
                        {formatCurrency(vatReturn?.box5_outputVat ?? 0, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Recoverable Input VAT
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {vatReturnLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div className="text-2xl font-semibold font-mono">
                        {formatCurrency(vatReturn?.box7_inputVatRecoverable ?? 0, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Net VAT Due
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {vatReturnLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div
                        className={`text-2xl font-semibold font-mono ${(vatReturn?.box8_netVatDue ?? 0) >= 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
                      >
                        {formatCurrency(Math.abs(vatReturn?.box8_netVatDue ?? 0), "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>VAT Return</CardTitle>
                  <CardDescription>
                    {dateRange.from && dateRange.to
                      ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                      : "Selected tax period"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {vatReturnLoading ? (
                    <Skeleton className="h-72" />
                  ) : vatReturnRows.length ? (
                    <Table className="min-w-[580px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Box</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {vatReturnRows.map((row) => (
                          <TableRow key={row.box}>
                            <TableCell className="font-medium">{row.box}</TableCell>
                            <TableCell>{row.description}</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(row.amount, "AED", locale)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="py-12 text-center text-sm text-muted-foreground">
                      No VAT return data found for this period.
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="aging" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Current A/R
                </CardTitle>
              </CardHeader>
              <CardContent>
                {agingLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono text-green-600 dark:text-green-400">
                    {formatCurrency(agingSummary.receivables.current, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Overdue A/R
                </CardTitle>
              </CardHeader>
              <CardContent>
                {agingLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono text-red-600 dark:text-red-400">
                    {formatCurrency(agingSummary.receivables.overdue, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total A/R
                </CardTitle>
              </CardHeader>
              <CardContent>
                {agingLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(agingSummary.receivables.total, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total A/P
                </CardTitle>
              </CardHeader>
              <CardContent>
                {agingLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(agingSummary.payables.total, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>A/R and A/P Aging</CardTitle>
              <CardDescription>
                Open customer and vendor balances by due-date bucket, ready for payment and
                collection automation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {agingLoading ? (
                <Skeleton className="h-72" />
              ) : agingBucketRows.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[860px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bucket</TableHead>
                        <TableHead className="text-right">Receivables</TableHead>
                        <TableHead className="text-right">Payables</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {agingBucketRows.map((row) => (
                        <TableRow key={row.bucket}>
                          <TableCell className="font-medium">{row.bucket}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.receivables, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.payables, "AED", locale)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No open receivable or payable balances found.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Aging Details</CardTitle>
              <CardDescription>
                Customer and vendor balances that can feed reminders, payments, and close review.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {agingLoading ? (
                <Skeleton className="h-96" />
              ) : agingData?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Current</TableHead>
                        <TableHead className="text-right">1-30</TableHead>
                        <TableHead className="text-right">31-60</TableHead>
                        <TableHead className="text-right">61-90</TableHead>
                        <TableHead className="text-right">&gt;90</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {agingData.map((row) => (
                        <TableRow key={`${row.type}-${row.id}-${row.name}`}>
                          <TableCell className="font-medium">{row.name}</TableCell>
                          <TableCell>
                            <Badge variant={row.type === "receivable" ? "info" : "warning"}>
                              {row.type === "receivable" ? "A/R" : "A/P"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.current, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.days30, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.days60, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.days90, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-red-600 dark:text-red-400">
                            {formatCurrency(row.over90, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(row.total, "AED", locale)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No aging detail rows found.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customers" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Open Customer Balance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {customerBalancesLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      customerBalances?.totals.openBalance ?? 0,
                      customerBalances?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Overdue Customer Balance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {customerBalancesLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono text-red-600 dark:text-red-400">
                    {formatCurrency(
                      customerBalances?.totals.overdueBalance ?? 0,
                      customerBalances?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Open Invoices
                </CardTitle>
              </CardHeader>
              <CardContent>
                {customerBalancesLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(customerBalances?.totals.openInvoiceCount ?? 0, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Chase Queue
                </CardTitle>
                <Badge variant={customerAutomationCount > 0 ? "warning" : "success"} dot>
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {customerBalancesLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(customerAutomationCount, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Customer Balance Summary</CardTitle>
              <CardDescription>
                Open and overdue customer balances with payment-chasing automation flags.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {customerBalancesLoading ? (
                <Skeleton className="h-96" />
              ) : customerBalances?.rows?.length ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-right">Invoices</TableHead>
                        <TableHead className="text-right">Open</TableHead>
                        <TableHead className="text-right">Overdue</TableHead>
                        <TableHead className="text-right">Current</TableHead>
                        <TableHead className="text-right">Open Balance</TableHead>
                        <TableHead>Last Invoice</TableHead>
                        <TableHead className="text-right">Automation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerBalances.rows.map((row) => (
                        <TableRow key={row.customerName}>
                          <TableCell className="font-medium">{row.customerName}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(row.invoiceCount ?? 0, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(row.openInvoiceCount ?? 0, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.overdueBalance,
                              customerBalances.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.currentBalance,
                              customerBalances.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(
                              row.openBalance,
                              customerBalances.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell>
                            {row.lastInvoiceDate
                              ? format(new Date(row.lastInvoiceDate), "MMM dd, yyyy")
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.chaseSuggested ? (
                              <Badge variant="warning">Chase</Badge>
                            ) : (
                              <Badge variant="outline">Clear</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No customer balances found.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vendors" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Open Vendor Balance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {vendorBalancesLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      vendorBalances?.totals.openBalance ?? 0,
                      vendorBalances?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Overdue Vendor Balance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {vendorBalancesLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono text-red-600 dark:text-red-400">
                    {formatCurrency(
                      vendorBalances?.totals.overdueBalance ?? 0,
                      vendorBalances?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Open Bills
                </CardTitle>
              </CardHeader>
              <CardContent>
                {vendorBalancesLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(vendorBalances?.totals.openBillCount ?? 0, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Payment Review
                </CardTitle>
                <Badge variant={vendorAutomationCount > 0 ? "warning" : "success"} dot>
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {vendorBalancesLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(vendorAutomationCount, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Vendor Balance Summary</CardTitle>
              <CardDescription>
                Open and overdue vendor bill balances for payment scheduling automation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {vendorBalancesLoading ? (
                <Skeleton className="h-96" />
              ) : vendorBalances?.rows?.length ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead className="text-right">Bills</TableHead>
                        <TableHead className="text-right">Open</TableHead>
                        <TableHead className="text-right">Overdue</TableHead>
                        <TableHead className="text-right">Current</TableHead>
                        <TableHead className="text-right">Open Balance</TableHead>
                        <TableHead>Next Due</TableHead>
                        <TableHead className="text-right">Automation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vendorBalances.rows.map((row) => (
                        <TableRow key={row.vendorName}>
                          <TableCell className="font-medium">{row.vendorName}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(row.billCount ?? 0, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(row.openBillCount ?? 0, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.overdueBalance,
                              vendorBalances.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.currentBalance,
                              vendorBalances.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(row.openBalance, vendorBalances.reportCurrency, locale)}
                          </TableCell>
                          <TableCell>
                            {row.nextDueDate
                              ? format(new Date(row.nextDueDate), "MMM dd, yyyy")
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.paymentSuggested ? (
                              <Badge variant="warning">Review</Badge>
                            ) : (
                              <Badge variant="outline">Clear</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No vendor balances found.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="revenueCustomers" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Customer Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                {revenueByCustomerLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      revenueByCustomer?.totals.revenue ?? 0,
                      revenueByCustomer?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Previous Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                {revenueByCustomerLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono text-muted-foreground">
                    {formatCurrency(
                      revenueByCustomer?.totals.previousRevenue ?? 0,
                      revenueByCustomer?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Customers
                </CardTitle>
              </CardHeader>
              <CardContent>
                {revenueByCustomerLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(revenueByCustomer?.totals.customerCount ?? 0, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Concentration Review
                </CardTitle>
                <Badge variant={revenueConcentrationCount > 0 ? "warning" : "success"} dot>
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {revenueByCustomerLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(revenueConcentrationCount, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Revenue by Customer</CardTitle>
              <CardDescription>
                Customer revenue ranked by period sales, prior-period movement, and concentration
                risk.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {revenueByCustomerLoading ? (
                <Skeleton className="h-96" />
              ) : revenueByCustomer?.rows?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[920px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-right">Invoices</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">Previous</TableHead>
                        <TableHead className="text-right">Change</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                        <TableHead className="text-right">Average</TableHead>
                        <TableHead className="text-right">Automation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {revenueByCustomer.rows.map((row) => (
                        <TableRow key={row.customerName}>
                          <TableCell className="font-medium">{row.customerName}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(row.invoiceCount, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.revenue, revenueByCustomer.reportCurrency, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {formatCurrency(
                              row.previousRevenue,
                              revenueByCustomer.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono ${row.change >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            {formatCurrency(row.change, revenueByCustomer.reportCurrency, locale)}
                            <div className="text-xs">{row.changePercent.toFixed(1)}%</div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {row.revenueShare.toFixed(1)}%
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.averageInvoiceValue,
                              revenueByCustomer.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.concentrationRisk ? (
                              <Badge variant="warning">Review</Badge>
                            ) : (
                              <Badge variant="outline">Clear</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No customer revenue found for this period.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="salesServices" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Service Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                {salesByServiceLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      salesByService?.totals.revenue ?? 0,
                      salesByService?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Previous Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                {salesByServiceLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono text-muted-foreground">
                    {formatCurrency(
                      salesByService?.totals.previousRevenue ?? 0,
                      salesByService?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Services
                </CardTitle>
              </CardHeader>
              <CardContent>
                {salesByServiceLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(salesByService?.totals.serviceCount ?? 0, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Margin Review
                </CardTitle>
                <Badge variant={serviceMarginReviewCount > 0 ? "warning" : "success"} dot>
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {salesByServiceLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(serviceMarginReviewCount, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Sales by Product/Service</CardTitle>
              <CardDescription>
                Invoice-line revenue grouped by product or service description with period movement.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {salesByServiceLoading ? (
                <Skeleton className="h-96" />
              ) : salesByService?.rows?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[920px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product/Service</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">Previous</TableHead>
                        <TableHead className="text-right">Change</TableHead>
                        <TableHead className="text-right">Avg Unit</TableHead>
                        <TableHead>Last Sold</TableHead>
                        <TableHead className="text-right">Automation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {salesByService.rows.map((row) => (
                        <TableRow key={row.serviceName}>
                          <TableCell className="font-medium">{row.serviceName}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(row.quantity, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.revenue, salesByService.reportCurrency, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {formatCurrency(
                              row.previousRevenue,
                              salesByService.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono ${row.change >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            {formatCurrency(row.change, salesByService.reportCurrency, locale)}
                            <div className="text-xs">{row.changePercent.toFixed(1)}%</div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.averageUnitRevenue,
                              salesByService.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell>
                            {row.lastSoldDate
                              ? format(new Date(row.lastSoldDate), "MMM dd, yyyy")
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.marginReviewSuggested ? (
                              <Badge variant="warning">Review</Badge>
                            ) : (
                              <Badge variant="outline">Clear</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No product or service sales found for this period.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenseVendors" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Vendor Expense
                </CardTitle>
              </CardHeader>
              <CardContent>
                {expensesByVendorLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      expensesByVendor?.totals.expenseAmount ?? 0,
                      expensesByVendor?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Previous Expense
                </CardTitle>
              </CardHeader>
              <CardContent>
                {expensesByVendorLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono text-muted-foreground">
                    {formatCurrency(
                      expensesByVendor?.totals.previousExpenseAmount ?? 0,
                      expensesByVendor?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Vendors</CardTitle>
              </CardHeader>
              <CardContent>
                {expensesByVendorLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(expensesByVendor?.totals.vendorCount ?? 0, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Spend Review
                </CardTitle>
                <Badge variant={vendorSpendReviewCount > 0 ? "warning" : "success"} dot>
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {expensesByVendorLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(vendorSpendReviewCount, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Expenses by Vendor</CardTitle>
              <CardDescription>
                Posted receipt expenses grouped by vendor, with prior-period spend movement.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {expensesByVendorLoading ? (
                <Skeleton className="h-96" />
              ) : expensesByVendor?.rows?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[920px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead className="text-right">Receipts</TableHead>
                        <TableHead className="text-right">Expense</TableHead>
                        <TableHead className="text-right">Previous</TableHead>
                        <TableHead className="text-right">Change</TableHead>
                        <TableHead className="text-right">VAT</TableHead>
                        <TableHead className="text-right">Total Spend</TableHead>
                        <TableHead className="text-right">Automation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expensesByVendor.rows.map((row) => (
                        <TableRow key={row.vendorName}>
                          <TableCell className="font-medium">{row.vendorName}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(row.receiptCount, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.expenseAmount,
                              expensesByVendor.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {formatCurrency(
                              row.previousExpenseAmount,
                              expensesByVendor.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono ${row.change <= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            {formatCurrency(row.change, expensesByVendor.reportCurrency, locale)}
                            <div className="text-xs">{row.changePercent.toFixed(1)}%</div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.vatAmount, expensesByVendor.reportCurrency, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(
                              row.totalSpend,
                              expensesByVendor.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.spendReviewSuggested ? (
                              <Badge variant="warning">Review</Badge>
                            ) : (
                              <Badge variant="outline">Clear</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No posted vendor expenses found for this period.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenseCategories" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Category Expense
                </CardTitle>
              </CardHeader>
              <CardContent>
                {expensesByCategoryLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      expensesByCategory?.totals.expenseAmount ?? 0,
                      expensesByCategory?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Previous Expense
                </CardTitle>
              </CardHeader>
              <CardContent>
                {expensesByCategoryLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono text-muted-foreground">
                    {formatCurrency(
                      expensesByCategory?.totals.previousExpenseAmount ?? 0,
                      expensesByCategory?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Categories
                </CardTitle>
              </CardHeader>
              <CardContent>
                {expensesByCategoryLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(expensesByCategory?.totals.categoryCount ?? 0, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Budget Review
                </CardTitle>
                <Badge variant={categoryBudgetReviewCount > 0 ? "warning" : "success"} dot>
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {expensesByCategoryLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(categoryBudgetReviewCount, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Expenses by Category</CardTitle>
              <CardDescription>
                Posted receipt expenses grouped by category, with budget-review automation flags.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {expensesByCategoryLoading ? (
                <Skeleton className="h-96" />
              ) : expensesByCategory?.rows?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[920px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Receipts</TableHead>
                        <TableHead className="text-right">Expense</TableHead>
                        <TableHead className="text-right">Previous</TableHead>
                        <TableHead className="text-right">Change</TableHead>
                        <TableHead className="text-right">VAT</TableHead>
                        <TableHead className="text-right">Total Spend</TableHead>
                        <TableHead className="text-right">Automation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expensesByCategory.rows.map((row) => (
                        <TableRow key={row.categoryName}>
                          <TableCell className="font-medium">{row.categoryName}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(row.receiptCount, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.expenseAmount,
                              expensesByCategory.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {formatCurrency(
                              row.previousExpenseAmount,
                              expensesByCategory.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono ${row.change <= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            {formatCurrency(row.change, expensesByCategory.reportCurrency, locale)}
                            <div className="text-xs">{row.changePercent.toFixed(1)}%</div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.vatAmount,
                              expensesByCategory.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(
                              row.totalSpend,
                              expensesByCategory.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.budgetReviewSuggested ? (
                              <Badge variant="warning">Review</Badge>
                            ) : (
                              <Badge variant="outline">Clear</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No posted category expenses found for this period.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoiceStatus" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Invoice Total
                </CardTitle>
              </CardHeader>
              <CardContent>
                {invoiceStatusLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      invoiceStatus?.totals.totalAmount ?? 0,
                      invoiceStatus?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Open Balance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {invoiceStatusLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      invoiceStatus?.totals.openBalance ?? 0,
                      invoiceStatus?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Overdue Balance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {invoiceStatusLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono text-red-600 dark:text-red-400">
                    {formatCurrency(
                      invoiceStatus?.totals.overdueBalance ?? 0,
                      invoiceStatus?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Reminder Queue
                </CardTitle>
                <Badge variant={invoiceReminderQueue > 0 ? "warning" : "success"} dot>
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {invoiceStatusLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(invoiceReminderQueue, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Invoice Status</CardTitle>
              <CardDescription>
                Invoice totals by status with open balances, overdue exposure, and reminder queue.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {invoiceStatusLoading ? (
                <Skeleton className="h-96" />
              ) : invoiceStatus?.rows?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[860px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Invoices</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead className="text-right">Open</TableHead>
                        <TableHead className="text-right">Overdue</TableHead>
                        <TableHead className="text-right">Change</TableHead>
                        <TableHead className="text-right">Automation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoiceStatus.rows.map((row) => (
                        <TableRow key={row.status}>
                          <TableCell>
                            <Badge
                              variant={row.status === "overdue" ? "danger" : "outline"}
                              className="capitalize"
                            >
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(row.invoiceCount, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.totalAmount, invoiceStatus.reportCurrency, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.paidAmount, invoiceStatus.reportCurrency, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.openBalance, invoiceStatus.reportCurrency, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-red-600 dark:text-red-400">
                            {formatCurrency(
                              row.overdueBalance,
                              invoiceStatus.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono ${row.change >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            {formatCurrency(row.change, invoiceStatus.reportCurrency, locale)}
                            <div className="text-xs">{row.changePercent.toFixed(1)}%</div>
                          </TableCell>
                          <TableCell className="text-right">
                            {row.reminderQueue > 0 ? (
                              <Badge variant="warning">{row.reminderQueue} reminders</Badge>
                            ) : (
                              <Badge variant="outline">Clear</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No issued invoices found for this period.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="budgetActual" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Budget</CardTitle>
              </CardHeader>
              <CardContent>
                {budgetVsActualLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      budgetVsActual?.totals.budget ?? 0,
                      budgetVsActual?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Actual</CardTitle>
              </CardHeader>
              <CardContent>
                {budgetVsActualLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      budgetVsActual?.totals.actual ?? 0,
                      budgetVsActual?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Variance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {budgetVsActualLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div
                    className={`text-2xl font-semibold font-mono ${(budgetVsActual?.totals.variance ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  >
                    {formatCurrency(
                      budgetVsActual?.totals.variance ?? 0,
                      budgetVsActual?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Variance Alerts
                </CardTitle>
                <Badge variant={budgetVarianceQueue > 0 ? "warning" : "success"} dot>
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {budgetVsActualLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(budgetVarianceQueue, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Budget vs Actual</CardTitle>
              <CardDescription>
                {budgetVsActual?.budget
                  ? `${budgetVsActual.budget.name} compared with posted actuals for the selected period.`
                  : "No overlapping budget plan found for the selected period."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {budgetVsActualLoading ? (
                <Skeleton className="h-96" />
              ) : budgetVsActual?.rows?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[960px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Budget</TableHead>
                        <TableHead className="text-right">Actual</TableHead>
                        <TableHead className="text-right">Variance</TableHead>
                        <TableHead className="text-right">Variance %</TableHead>
                        <TableHead className="text-right">Automation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {budgetVsActual.rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <div className="font-medium">{row.category}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.monthCount} month{row.monthCount === 1 ? "" : "s"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>{row.accountName || "Unmapped"}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.accountCode || row.accountType || "-"}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.budget, budgetVsActual.reportCurrency, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.actual, budgetVsActual.reportCurrency, locale)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono ${row.varianceTone === "favorable" ? "text-green-600 dark:text-green-400" : row.varianceTone === "unfavorable" ? "text-red-600 dark:text-red-400" : ""}`}
                          >
                            {formatCurrency(row.variance, budgetVsActual.reportCurrency, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {row.variancePercent.toFixed(1)}%
                          </TableCell>
                          <TableCell className="text-right">
                            {row.automationSuggested ? (
                              <Badge variant="warning">Review</Badge>
                            ) : row.unfavorable ? (
                              <Badge variant="outline">Watch</Badge>
                            ) : (
                              <Badge variant="success">Clear</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No budget variance lines found for this period.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payrollSummary" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Net Pay</CardTitle>
              </CardHeader>
              <CardContent>
                {payrollSummaryLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      payrollSummary?.totals.totalNet ?? 0,
                      payrollSummary?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Employer Cost
                </CardTitle>
              </CardHeader>
              <CardContent>
                {payrollSummaryLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      payrollSummary?.totals.totalEmployerCost ?? 0,
                      payrollSummary?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Net Pay Change
                </CardTitle>
              </CardHeader>
              <CardContent>
                {payrollSummaryLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <>
                    <div
                      className={`text-2xl font-semibold font-mono ${(payrollSummary?.totals.netChange ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                    >
                      {formatCurrency(
                        payrollSummary?.totals.netChange ?? 0,
                        payrollSummary?.reportCurrency ?? "AED",
                        locale
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(payrollSummary?.totals.netChangePercent ?? 0).toFixed(1)}% vs prior period
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Payroll Actions
                </CardTitle>
                <Badge variant={payrollAutomationQueue > 0 ? "warning" : "success"} dot>
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {payrollSummaryLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(payrollAutomationQueue, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Payroll Summary</CardTitle>
              <CardDescription>
                Payroll runs, WPS readiness, employer cost, and posting status for the selected
                period.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {payrollSummaryLoading ? (
                <Skeleton className="h-96" />
              ) : payrollSummary?.rows?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[1040px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Employees</TableHead>
                        <TableHead className="text-right">Basic</TableHead>
                        <TableHead className="text-right">Allowances</TableHead>
                        <TableHead className="text-right">Deductions</TableHead>
                        <TableHead className="text-right">Net Pay</TableHead>
                        <TableHead className="text-right">Employer Cost</TableHead>
                        <TableHead className="text-right">Automation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollSummary.rows.map((row) => (
                        <TableRow key={row.runId}>
                          <TableCell className="font-mono">{row.periodLabel}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                row.status === "approved" || row.status === "paid"
                                  ? "success"
                                  : row.status === "calculated"
                                    ? "warning"
                                    : "outline"
                              }
                              className="capitalize"
                            >
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(row.employeeCount, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.totalBasic, payrollSummary.reportCurrency, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.totalAllowances,
                              payrollSummary.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.totalDeductions,
                              payrollSummary.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(row.totalNet, payrollSummary.reportCurrency, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.totalEmployerCost,
                              payrollSummary.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              {row.needsApproval && <Badge variant="warning">Approve</Badge>}
                              {row.sifSuggested && <Badge variant="warning">SIF</Badge>}
                              {row.postingSuggested && <Badge variant="warning">Post</Badge>}
                              {!row.needsApproval && !row.sifSuggested && !row.postingSuggested && (
                                <Badge variant="outline">Clear</Badge>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No payroll runs found for this period.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="corpTax" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Taxable Income
                </CardTitle>
              </CardHeader>
              <CardContent>
                {corporateTaxLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      corporateTaxEstimate?.totals.taxableIncome ?? 0,
                      corporateTaxEstimate?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Taxable Amount
                </CardTitle>
              </CardHeader>
              <CardContent>
                {corporateTaxLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      corporateTaxEstimate?.totals.taxableAmount ?? 0,
                      corporateTaxEstimate?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Tax Payable
                </CardTitle>
              </CardHeader>
              <CardContent>
                {corporateTaxLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono text-red-600 dark:text-red-400">
                    {formatCurrency(
                      corporateTaxEstimate?.totals.taxPayable ?? 0,
                      corporateTaxEstimate?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Filing Review
                </CardTitle>
                <Badge
                  variant={
                    corporateTaxEstimate?.totals.filingReviewSuggested ? "warning" : "success"
                  }
                  dot
                >
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {corporateTaxLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(
                      corporateTaxEstimate?.totals.journalEntriesProcessed ?? 0,
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Corporate Tax Estimate</CardTitle>
              <CardDescription>
                UAE corporate tax estimate using posted income and expense activity.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {corporateTaxLoading ? (
                <Skeleton className="h-72" />
              ) : corporateTaxEstimate ? (
                <Table>
                  <TableBody>
                    {[
                      ["Total Revenue", corporateTaxEstimate.totals.totalRevenue],
                      ["Total Expenses", corporateTaxEstimate.totals.totalExpenses],
                      ["Taxable Income", corporateTaxEstimate.totals.taxableIncome],
                      ["Exemption Threshold", corporateTaxEstimate.totals.exemptionThreshold],
                      ["Taxable Amount", corporateTaxEstimate.totals.taxableAmount],
                      ["Tax Payable", corporateTaxEstimate.totals.taxPayable],
                    ].map(([label, amount]) => (
                      <TableRow key={String(label)}>
                        <TableCell className="font-medium">{label}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(
                            Number(amount),
                            corporateTaxEstimate.reportCurrency,
                            locale
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="font-medium">Tax Rate</TableCell>
                      <TableCell className="text-right font-mono">
                        {(corporateTaxEstimate.totals.taxRate * 100).toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Corporate tax estimate is not available.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fixedAssets" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Asset Cost
                </CardTitle>
              </CardHeader>
              <CardContent>
                {fixedAssetsLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      fixedAssetRegister?.totals.purchaseCost ?? 0,
                      fixedAssetRegister?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Accumulated Depreciation
                </CardTitle>
              </CardHeader>
              <CardContent>
                {fixedAssetsLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      fixedAssetRegister?.totals.accumulatedDepreciation ?? 0,
                      fixedAssetRegister?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Net Book Value
                </CardTitle>
              </CardHeader>
              <CardContent>
                {fixedAssetsLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      fixedAssetRegister?.totals.netBookValue ?? 0,
                      fixedAssetRegister?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Capitalization Queue
                </CardTitle>
                <Badge variant={fixedAssetCapitalizationQueue > 0 ? "warning" : "success"} dot>
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {fixedAssetsLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(fixedAssetCapitalizationQueue, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Fixed Asset Register</CardTitle>
              <CardDescription>
                Asset cost, accumulated depreciation, carrying value, and capitalization review.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {fixedAssetsLoading ? (
                <Skeleton className="h-96" />
              ) : fixedAssetRegister?.rows?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[920px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">Accum. Dep.</TableHead>
                        <TableHead className="text-right">NBV</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead className="text-right">Automation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fixedAssetRegister.rows.map((row) => (
                        <TableRow key={row.assetId}>
                          <TableCell>
                            <div className="font-medium">{row.assetName}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.assetNumber || "-"}
                            </div>
                          </TableCell>
                          <TableCell>{row.category || "-"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {row.status || "active"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.purchaseCost,
                              fixedAssetRegister.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.accumulatedDepreciation,
                              fixedAssetRegister.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(
                              row.netBookValue,
                              fixedAssetRegister.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell>{row.depreciationMethod || "-"}</TableCell>
                          <TableCell className="text-right">
                            {row.needsCapitalizationJe ? (
                              <Badge variant="warning">Capitalize</Badge>
                            ) : (
                              <Badge variant="outline">Clear</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No fixed assets found.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="depreciation" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Depreciation Amount
                </CardTitle>
              </CardHeader>
              <CardContent>
                {depreciationLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      depreciationSchedule?.totals.depreciationAmount ?? 0,
                      depreciationSchedule?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Schedule Rows
                </CardTitle>
              </CardHeader>
              <CardContent>
                {depreciationLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(depreciationSchedule?.totals.scheduleCount ?? 0, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Posted</CardTitle>
              </CardHeader>
              <CardContent>
                {depreciationLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(depreciationSchedule?.totals.postedCount ?? 0, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Posting Queue
                </CardTitle>
                <Badge variant={depreciationPostingQueue > 0 ? "warning" : "success"} dot>
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {depreciationLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(depreciationPostingQueue, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Depreciation Schedule</CardTitle>
              <CardDescription>
                Depreciation schedule rows by asset and period with posting status.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {depreciationLoading ? (
                <Skeleton className="h-96" />
              ) : depreciationSchedule?.rows?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[820px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {depreciationSchedule.rows.map((row) => (
                        <TableRow key={row.scheduleId}>
                          <TableCell>
                            <div className="font-medium">{row.assetName}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.assetNumber || "-"}
                            </div>
                          </TableCell>
                          <TableCell>{row.category || "-"}</TableCell>
                          <TableCell className="font-mono">{row.periodLabel}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.amount,
                              depreciationSchedule.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.posted ? (
                              <Badge variant="success">Posted</Badge>
                            ) : (
                              <Badge variant="warning">Queue</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No depreciation schedule rows found for this period.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventoryValuation" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Inventory Value
                </CardTitle>
              </CardHeader>
              <CardContent>
                {inventoryValuationLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      inventoryValuation?.totals.inventoryValue ?? 0,
                      inventoryValuation?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Retail Value
                </CardTitle>
              </CardHeader>
              <CardContent>
                {inventoryValuationLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      inventoryValuation?.totals.retailValue ?? 0,
                      inventoryValuation?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Gross Margin
                </CardTitle>
              </CardHeader>
              <CardContent>
                {inventoryValuationLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatCurrency(
                      inventoryValuation?.totals.grossMarginValue ?? 0,
                      inventoryValuation?.reportCurrency ?? "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Stock Actions
                </CardTitle>
                <Badge
                  variant={
                    inventoryNegativeStockQueue > 0
                      ? "danger"
                      : inventoryReorderQueue > 0
                        ? "warning"
                        : "success"
                  }
                  dot
                >
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {inventoryValuationLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="text-2xl font-semibold font-mono">
                    {formatNumber(inventoryReorderQueue + inventoryNegativeStockQueue, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Inventory Valuation</CardTitle>
              <CardDescription>
                Stock on hand, carrying value, retail value, margin, and reorder flags as of the
                selected end date.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {inventoryValuationLoading ? (
                <Skeleton className="h-96" />
              ) : inventoryValuation?.rows?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[1040px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead className="text-right">Stock</TableHead>
                        <TableHead className="text-right">Unit Cost</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead className="text-right">Retail</TableHead>
                        <TableHead className="text-right">Margin</TableHead>
                        <TableHead className="text-right">Movements</TableHead>
                        <TableHead className="text-right">Automation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inventoryValuation.rows.map((row) => (
                        <TableRow key={row.productId}>
                          <TableCell>
                            <div className="font-medium">{row.productName}</div>
                            <div className="text-xs text-muted-foreground">{row.sku || "-"}</div>
                          </TableCell>
                          <TableCell>{row.unit}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(row.stockOnHand, locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.unitCost,
                              inventoryValuation.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(
                              row.inventoryValue,
                              inventoryValuation.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(
                              row.retailValue,
                              inventoryValuation.reportCurrency,
                              locale
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="font-mono">
                              {formatCurrency(
                                row.grossMarginValue,
                                inventoryValuation.reportCurrency,
                                locale
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {row.grossMarginPercent.toFixed(1)}%
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(row.movementCount, locale)}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.negativeStock ? (
                              <Badge variant="danger">Negative stock</Badge>
                            ) : row.reorderSuggested ? (
                              <Badge variant="warning">Reorder</Badge>
                            ) : (
                              <Badge variant="outline">Clear</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No inventory products found.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="monthEndClose" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Close Progress
                </CardTitle>
              </CardHeader>
              <CardContent>
                {monthEndCloseLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <div className="text-2xl font-semibold font-mono">
                      {formatNumber(monthEndCloseSummary.completionPercent, locale)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatNumber(monthEndCloseSummary.completedCount, locale)}/
                      {formatNumber(monthEndCloseSummary.totalCount, locale)} checks complete
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Open Items
                </CardTitle>
              </CardHeader>
              <CardContent>
                {monthEndCloseLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div
                    className={`text-2xl font-semibold font-mono ${monthEndCloseQueue > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}
                  >
                    {formatNumber(monthEndCloseQueue, locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Period Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                {monthEndCloseHistoryLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={monthEndCloseSummary.isLocked ? "success" : "warning"} dot>
                      {monthEndCloseSummary.isLocked ? "Locked" : "Open"}
                    </Badge>
                    <span className="text-sm text-muted-foreground">{closePeriodLabel}</span>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Close Actions
                </CardTitle>
                <Badge variant={monthEndCloseQueue > 0 ? "warning" : "success"} dot>
                  Automation
                </Badge>
              </CardHeader>
              <CardContent>
                {monthEndCloseLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <div className="text-2xl font-semibold font-mono">
                      {formatNumber(monthEndCloseQueue, locale)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {monthEndCloseSummary.isLocked ? "Period locked" : "Ready to route"}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Month-End Close Status</CardTitle>
              <CardDescription>
                Close checklist for {closePeriodLabel}, driven by reconciliation, posting, AI
                review, depreciation, and VAT readiness.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {monthEndCloseLoading ? (
                <Skeleton className="h-96" />
              ) : monthEndClose?.checklist?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Check</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Details</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthEndClose.checklist.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="font-medium">{item.title}</div>
                            <div className="text-xs text-muted-foreground">Step {item.id}</div>
                          </TableCell>
                          <TableCell>{item.description}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {item.details || "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={item.status === "complete" ? "success" : "warning"}
                              className="capitalize"
                            >
                              {item.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No close checklist found for {closePeriodLabel}.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Close History</CardTitle>
              <CardDescription>
                Recent locked or open month-end records for this company.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {monthEndCloseHistoryLoading ? (
                <Skeleton className="h-64" />
              ) : monthEndCloseHistory?.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[780px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Closed By</TableHead>
                        <TableHead>Closed At</TableHead>
                        <TableHead>Closing Entry</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthEndCloseHistory.slice(0, 8).map((record) => (
                        <TableRow key={record.id}>
                          <TableCell className="font-mono">
                            {formatDateForExport(record.periodEnd).slice(0, 7) || "-"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={record.status === "locked" ? "success" : "outline"}
                              className="capitalize"
                            >
                              {record.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{record.closedByEmail || record.closedBy || "-"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {record.closedAt ? formatDeliveryDate(record.closedAt) : "-"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {record.closingEntryId || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No month-end close history recorded yet.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="comparison" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { label: "Revenue Change", item: revenueComparison, favorablePositive: true },
              { label: "Expense Change", item: expenseComparison, favorablePositive: false },
              { label: "Profit Change", item: profitComparison, favorablePositive: true },
            ].map(({ label, item, favorablePositive }) => {
              const change = item?.change ?? 0;
              const isFavorable = favorablePositive ? change >= 0 : change <= 0;
              return (
                <Card key={label}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {label}
                    </CardTitle>
                    <Badge variant={isFavorable ? "success" : "danger"} dot>
                      {(item?.changePercent ?? 0) >= 0 ? "+" : ""}
                      {(item?.changePercent ?? 0).toFixed(1)}%
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    {comparisonLoading ? (
                      <Skeleton className="h-8 w-32" />
                    ) : (
                      <div
                        className={`text-2xl font-semibold font-mono ${isFavorable ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                      >
                        {formatCurrency(change, "AED", locale)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Period Comparison</CardTitle>
              <CardDescription>
                {periodLabel} operating metrics compared with the previous matching period.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {comparisonLoading ? (
                <Skeleton className="h-96" />
              ) : comparisonData?.length ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Metric</TableHead>
                        <TableHead className="text-right">Current</TableHead>
                        <TableHead className="text-right">Previous</TableHead>
                        <TableHead className="text-right">Change</TableHead>
                        <TableHead className="text-right">Change %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {comparisonData.map((row) => (
                        <TableRow key={row.metric}>
                          <TableCell className="font-medium">{row.metric}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatComparisonValue(row.metric, row.current)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {formatComparisonValue(row.metric, row.previous)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono ${row.change >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            {formatComparisonValue(row.metric, row.change)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono ${row.changePercent >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            {row.changePercent >= 0 ? "+" : ""}
                            {row.changePercent.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No comparison data found for this cadence.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fx" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Unrealized Gain
                </CardTitle>
              </CardHeader>
              <CardContent>
                {fxLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono text-green-600 dark:text-green-400">
                    {formatCurrency(fxGainsLosses?.totalUnrealizedGain ?? 0, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Unrealized Loss
                </CardTitle>
              </CardHeader>
              <CardContent>
                {fxLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-2xl font-semibold font-mono text-red-600 dark:text-red-400">
                    {formatCurrency(
                      Math.abs(fxGainsLosses?.totalUnrealizedLoss ?? 0),
                      "AED",
                      locale
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Net FX Exposure
                </CardTitle>
              </CardHeader>
              <CardContent>
                {fxLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div
                    className={`text-2xl font-semibold font-mono ${(fxGainsLosses?.netUnrealizedGainLoss ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  >
                    {formatCurrency(fxGainsLosses?.netUnrealizedGainLoss ?? 0, "AED", locale)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">As Of</CardTitle>
              </CardHeader>
              <CardContent>
                {fxLoading ? (
                  <Skeleton className="h-8 w-32" />
                ) : (
                  <div className="text-lg font-semibold">
                    {fxGainsLosses?.asOf
                      ? format(new Date(fxGainsLosses.asOf), "MMM dd, yyyy")
                      : "-"}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>FX Gains and Losses</CardTitle>
              <CardDescription>
                Unrealized gains and losses on open foreign-currency receivables and payables.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {fxLoading ? (
                <Skeleton className="h-96" />
              ) : fxReportItems.length ? (
                <Table className="min-w-[1080px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Number</TableHead>
                      <TableHead>Counterparty</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead className="text-right">Foreign Amount</TableHead>
                      <TableHead className="text-right">Tx Rate</TableHead>
                      <TableHead className="text-right">Current Rate</TableHead>
                      <TableHead className="text-right">Book Value</TableHead>
                      <TableHead className="text-right">Current Value</TableHead>
                      <TableHead className="text-right">Gain/Loss</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fxReportItems.map((item) => (
                      <TableRow key={`${item.entityType}-${item.entityId}`}>
                        <TableCell>
                          <Badge variant={item.entityType === "invoice" ? "info" : "warning"}>
                            {item.entityType === "invoice" ? "Receivable" : "Payable"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{item.entityNumber}</TableCell>
                        <TableCell>{item.counterparty}</TableCell>
                        <TableCell>{item.currency}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(item.foreignAmount, item.currency, locale)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNumber(item.transactionRate, locale)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNumber(item.currentRate, locale)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(item.bookValueAed, "AED", locale)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(item.currentValueAed, "AED", locale)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono font-medium ${item.unrealizedGainLoss >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                        >
                          {formatCurrency(item.unrealizedGainLoss, "AED", locale)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No open foreign-currency receivables or payables found.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
