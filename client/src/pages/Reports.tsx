import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge, type BadgeProps } from "@/components/ui/badge";
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
  prepareTrialBalanceForExport,
  prepareInvoiceStatusForExport,
  prepareBalanceSummaryReportsForExport,
  prepareExpenseReportsForExport,
  prepareLedgerReportsForExport,
  preparePlanningReportsForExport,
} from "@/lib/export";
import { apiRequest } from "@/lib/queryClient";
import {
  reportCatalog,
  reportAutomationPlaybookHref,
  reportPersonas,
  reportPersonaWorkspaces,
  reportTabs,
  reportHref,
  reportsHref,
  reportWorkspaceHref,
  type ReportPersona,
  type ReportStatus,
  type ReportTab,
  type ReportWorkspaceIcon,
} from "@/lib/reportCatalog";
import {
  AlertTriangle,
  BarChart3,
  Briefcase,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileText,
  Scale,
  Wallet,
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

type PersonaFilter = "all" | ReportPersona;

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

const reportStatusMeta: Record<ReportStatus, { label: string; variant: BadgeProps["variant"] }> = {
  live: { label: "Live", variant: "success" },
  api: { label: "API ready", variant: "info" },
  planned: { label: "Planned", variant: "neutral" },
};

const personaFilters: Array<{ id: PersonaFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "owner", label: "Owner" },
  { id: "freelancer", label: "Freelancer" },
  { id: "accountant", label: "Accountant" },
];

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

function reportTabFromSearch(search: string): ReportTab {
  const tab = new URLSearchParams(search).get("tab");
  return reportTabs.includes(tab as ReportTab) ? (tab as ReportTab) : "pl";
}

function personaFilterFromSearch(search: string): PersonaFilter {
  const persona = new URLSearchParams(search).get("persona");
  return reportPersonas.includes(persona as ReportPersona) ? (persona as ReportPersona) : "all";
}

function matchesReportPersona(personas: ReportPersona[], persona: PersonaFilter): boolean {
  return persona === "all" || personas.includes(persona);
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

export default function Reports() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [location, navigate] = useLocation();
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [isExporting, setIsExporting] = useState(false);

  const locationSearch = useMemo(() => {
    return location.includes("?") ? location.slice(location.indexOf("?")) : "";
  }, [location]);

  const activeTab = useMemo(() => {
    return reportTabFromSearch(locationSearch || window.location.search);
  }, [locationSearch]);

  const personaFilter = useMemo(() => {
    return personaFilterFromSearch(locationSearch || window.location.search);
  }, [locationSearch]);

  const setActiveTab = (tab: ReportTab, persona: PersonaFilter = personaFilter) => {
    navigate(reportsHref({ tab, persona }));
  };

  const setReportPersonaFilter = (persona: PersonaFilter) => {
    navigate(reportsHref({ tab: activeTab, persona }));
  };

  const personaFilterLabel =
    personaFilters.find((filter) => filter.id === personaFilter)?.label ?? "All";
  const personaScopeDescription =
    personaFilter === "all"
      ? "Showing all role signals."
      : `Focused for ${personaFilterLabel.toLowerCase()} workflows.`;

  const filteredReports = useMemo(() => {
    return reportCatalog.filter((report) => {
      return matchesReportPersona(report.personas, personaFilter);
    });
  }, [personaFilter]);

  const reportStats = useMemo(() => {
    const live = reportCatalog.filter((report) => report.status === "live").length;
    const ready = reportCatalog.filter((report) => report.status !== "planned").length;
    const planned = reportCatalog.length - ready;
    return { live, ready, planned, total: reportCatalog.length };
  }, []);

  const workspaceSummaries = useMemo(() => {
    return reportPersonaWorkspaces.map((workspace) => {
      const reports = reportCatalog.filter((report) => report.personas.includes(workspace.persona));
      const readyReports = reports.filter((report) => report.status !== "planned").length;
      const automationCount = workspace.automations.length;
      const topReadyReport = reports.find((report) => report.tab) ?? reports[0];
      return {
        ...workspace,
        icon: reportWorkspaceIcons[workspace.icon],
        reports,
        readyReports,
        automationCount,
        topReadyReport,
        readiness: reports.length ? Math.round((readyReports / reports.length) * 100) : 0,
      };
    });
  }, []);

  const dateParams =
    dateRange.from && dateRange.to
      ? `?startDate=${format(dateRange.from, "yyyy-MM-dd")}&endDate=${format(dateRange.to, "yyyy-MM-dd")}`
      : "";
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

  const { data: overdueReport, isLoading: overdueLoading } = useQuery<OverdueResponse>({
    queryKey: ["/api/chasing/overdue", selectedCompanyId],
    queryFn: () => apiRequest("GET", `/api/chasing/overdue/${selectedCompanyId}`),
    enabled: !!selectedCompanyId,
  });

  const { data: receipts = [], isLoading: receiptsLoading } = useQuery<ReceiptReportRow[]>({
    queryKey: ["/api/companies", selectedCompanyId, "receipts"],
    enabled: !!selectedCompanyId,
  });

  const { data: journalEntries = [], isLoading: journalLoading } = useQuery<
    JournalEntryReportRow[]
  >({
    queryKey: ["/api/companies", selectedCompanyId, "journal"],
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

  const { data: balanceSummaries, isLoading: balancesLoading } = useQuery<BalanceSummaryReport>({
    queryKey: ["/api/companies", selectedCompanyId, "reports", "balance-summaries"],
    queryFn: () =>
      apiRequest("GET", `/api/companies/${selectedCompanyId}/reports/balance-summaries`),
    enabled: !!selectedCompanyId,
  });

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
      invoices: reportInvoices,
    };
  }, [
    customerRevenue,
    overdueCustomerRows,
    overdueReport?.totalOutstanding,
    overdueRows,
    reportInvoices,
    statusSummary,
  ]);

  const salesLoading = invoicesLoading || overdueLoading;

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
    };
  }, [balanceSummaries]);

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
    };
  }, [expenseByCategory, expenseByVendor, reportReceipts]);

  const expensesLoading = receiptsLoading;

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
    invoices,
    journalEntries,
    receipts,
  ]);

  const visibleComparisonRows = useMemo(() => {
    return comparisonRows.filter((row) => matchesReportPersona(row.personas, personaFilter));
  }, [comparisonRows, personaFilter]);

  const comparisonLoading =
    comparisonCurrentPlLoading ||
    comparisonPreviousPlLoading ||
    comparisonCurrentVatLoading ||
    comparisonPreviousVatLoading ||
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
    trialBalanceLoading ||
    ledgerLoading ||
    planningLoading;

  const automationQueue = useMemo<AutomationQueueItem[]>(() => {
    const vatNet = vatSummary?.netVATPayable ?? 0;
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
    expenseReport.unpostedReceipts,
    ledgerReport.reviewEntries,
    planningReport.cashWarning,
    planningReport.overBudgetLines,
    planningReport.variance,
    trialBalanceSummary.isBalanced,
    vatSummary?.netVATPayable,
  ]);

  const visibleAutomationQueue = useMemo(() => {
    return automationQueue.filter((item) => matchesReportPersona(item.personas, personaFilter));
  }, [automationQueue, personaFilter]);

  const automationQueueCount = visibleAutomationQueue.reduce((sum, item) => sum + item.count, 0);

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
    addSheets(["trial-balance"], prepareTrialBalanceForExport(trialBalance));
    addSheets(
      ["invoice-status", "revenue-customer"],
      prepareInvoiceStatusForExport(invoiceStatusReport)
    );
    addSheets(
      ["customer-balances", "vendor-balances"],
      prepareBalanceSummaryReportsForExport(balanceReport)
    );
    addSheets(
      ["expenses-vendor", "expenses-category"],
      prepareExpenseReportsForExport(expenseReport)
    );
    addSheets(
      ["general-ledger", "account-transactions"],
      prepareLedgerReportsForExport(ledgerReport)
    );
    addSheets(
      ["budget-actual", "cash-flow-forecast"],
      preparePlanningReportsForExport(planningReport)
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

    const packIndex: ExportData = {
      sheetName: "Pack Index",
      columns: [
        { header: "Report", key: "report", width: 32 },
        { header: "Status", key: "status", width: 14 },
        { header: "Comparison", key: "comparison", width: 24 },
        { header: "Automation", key: "automation", width: 28 },
        { header: "Delivery", key: "delivery", width: 22 },
        { header: "Workflow", key: "workflow", width: 40 },
      ],
      rows: workspace.reports.map((report) => ({
        report: report.name,
        status: reportStatusMeta[report.status].label,
        comparison: report.comparison,
        automation: report.automation,
        delivery: workbookReportIds.has(report.id) ? "Included in workbook" : "Open workflow",
        workflow: reportHref(report) ?? reportWorkspaceHref(workspace),
      })),
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
        { metric: "Current period", value: comparisonCurrentLabel },
        { metric: "Prior period", value: comparisonPreviousLabel },
        {
          metric: "Pack status",
          value: openPackSignals.length > 0 ? "Review before send" : "Ready to send",
        },
        { metric: "Workspace reports", value: workspace.reports.length },
        { metric: "Ready reports", value: workspace.readyReports },
        { metric: "Workbook sheets", value: workbookSheets.length },
        { metric: "Comparison metrics", value: packComparisonRows.length },
        { metric: "Open automation signals", value: openPackSignals.length },
        { metric: "Open work items", value: openPackWorkItemCount },
        { metric: "Amount at risk", value: `AED ${packAmountAtRisk.toFixed(2)}` },
      ],
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

    const automationPlaybooks: ExportData = {
      sheetName: "Automation Playbooks",
      columns: [
        { header: "Playbook", key: "playbook", width: 34 },
        { header: "Trigger", key: "trigger", width: 42 },
        { header: "Reports", key: "reports", width: 60 },
        { header: "Action", key: "action", width: 24 },
        { header: "Workflow", key: "workflow", width: 40 },
      ],
      rows: workspace.automations.map((playbook) => ({
        playbook: playbook.title,
        trigger: playbook.trigger,
        reports: playbook.reportIds
          .map((reportId) => reportCatalog.find((report) => report.id === reportId)?.name)
          .filter(Boolean)
          .join(", "),
        action: playbook.cta,
        workflow: reportAutomationPlaybookHref(playbook, workspace.persona),
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
      ],
    };

    return [
      packIndex,
      packSummary,
      comparisonSnapshot,
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
      exportToExcel(prepareBalanceSummaryReportsForExport(balanceReport), "balance_summaries");
      toast({ title: "Export successful", description: "Balance summaries exported to Excel" });
    } else if (activeTab === "expenses") {
      exportToExcel(
        prepareExpenseReportsForExport(expenseReport),
        `expense_reports${dateRangeStr}`
      );
      toast({ title: "Export successful", description: "Expense reports exported to Excel" });
    } else if (activeTab === "ledger") {
      exportToExcel(prepareLedgerReportsForExport(ledgerReport), `general_ledger${dateRangeStr}`);
      toast({ title: "Export successful", description: "General Ledger exported to Excel" });
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
        "Balance Summaries",
        selectedCompanyId
      );
    } else if (activeTab === "expenses") {
      result = await exportToGoogleSheets(
        prepareExpenseReportsForExport(expenseReport),
        `Expense Reports${dateRangeStr}`,
        selectedCompanyId
      );
    } else if (activeTab === "ledger") {
      result = await exportToGoogleSheets(
        prepareLedgerReportsForExport(ledgerReport),
        `General Ledger${dateRangeStr}`,
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
          <Badge variant={reportPacksNeedingReview > 0 ? "warning" : "success"} dot>
            {reportPacksNeedingReview} need review
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleReportPackAutomation.map((item) => {
            const workspace = item.workspace;
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
                        <CardDescription>{workspace.packSchedule.cadence}</CardDescription>
                      </div>
                    </div>
                    <Badge variant={item.openSignalCount > 0 ? "warning" : "success"} dot>
                      {item.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
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
              Role-focused report coverage for owners, freelancers, and accountants.
            </p>
          </div>
          <Badge variant="outline">{workspaceSummaries.length} roles</Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {workspaceSummaries.map((workspace) => {
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
                        {workspace.reports.length}
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
          <CardHeader>
            <CardTitle>Report library</CardTitle>
            <CardDescription>
              Status, comparison mode, and automation hook for each report family.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table className="min-w-[860px]">
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
        <TabsList className="grid h-auto w-full max-w-7xl grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
          <TabsTrigger value="pl" data-testid="tab-profit-loss">
            {t.profitLoss}
          </TabsTrigger>
          <TabsTrigger value="bs" data-testid="tab-balance-sheet">
            {t.balanceSheet}
          </TabsTrigger>
          <TabsTrigger value="vat" data-testid="tab-vat-summary">
            {t.vatSummary}
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
          <TabsTrigger value="trial" data-testid="tab-trial-balance">
            {t.trialBalance}
          </TabsTrigger>
          <TabsTrigger value="ledger" data-testid="tab-ledger-reports">
            Ledger
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
              <CardTitle>Balance automation queues</CardTitle>
              <CardDescription>
                Current open-balance signals for collections and payable follow-up.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
