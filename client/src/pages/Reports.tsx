import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "wouter";
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
  exportToExcel,
  exportToGoogleSheets,
  prepareProfitLossForExport,
  prepareBalanceSheetForExport,
  prepareVATSummaryForExport,
  prepareTrialBalanceForExport,
  prepareInvoiceStatusForExport,
  prepareExpenseReportsForExport,
  prepareLedgerReportsForExport,
  preparePlanningReportsForExport,
} from "@/lib/export";
import { apiRequest } from "@/lib/queryClient";
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

type ReportPersona = "owner" | "freelancer" | "accountant";
type PersonaFilter = "all" | ReportPersona;
type ReportStatus = "live" | "api" | "planned";
type ReportTab = "pl" | "bs" | "vat" | "trial" | "sales" | "expenses" | "ledger" | "planning";

interface ReportCatalogItem {
  name: string;
  category: string;
  status: ReportStatus;
  personas: ReportPersona[];
  comparison: string;
  automation: string;
  tab?: ReportTab;
  href?: string;
}

interface PersonaWorkspace {
  persona: ReportPersona;
  title: string;
  focus: string;
  icon: LucideIcon;
  primaryTab: ReportTab;
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

const personaWorkspaces: PersonaWorkspace[] = [
  {
    persona: "owner",
    title: "Owner workspace",
    focus: "Cash, profit, receivables, tax, and payroll decisions.",
    icon: Briefcase,
    primaryTab: "pl",
  },
  {
    persona: "freelancer",
    title: "Freelancer workspace",
    focus: "Client income, unpaid invoices, expenses, and monthly tax readiness.",
    icon: Users,
    primaryTab: "pl",
  },
  {
    persona: "accountant",
    title: "Accountant workspace",
    focus: "Close workpapers, ledgers, audit trails, tax, and consolidation.",
    icon: ClipboardCheck,
    primaryTab: "trial",
  },
];

const reportCatalog: ReportCatalogItem[] = [
  {
    name: "Profit & Loss",
    category: "Financial Statements",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Date range",
    automation: "Net loss review",
    tab: "pl",
  },
  {
    name: "Balance Sheet",
    category: "Financial Statements",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "As of date",
    automation: "Balance review",
    tab: "bs",
  },
  {
    name: "VAT Summary",
    category: "Tax",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Date range",
    automation: "VAT readiness",
    tab: "vat",
  },
  {
    name: "Cash Flow Statement",
    category: "Financial Statements",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Monthly/quarterly/yearly",
    automation: "Cash pressure",
    href: "/advanced-reports?tab=cashflow",
  },
  {
    name: "A/R Aging",
    category: "Sales",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Aging buckets",
    automation: "Payment chasing",
    href: "/advanced-reports?tab=aging",
  },
  {
    name: "A/P Aging",
    category: "Purchases",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Aging buckets",
    automation: "Payment timing",
    href: "/bill-pay?tab=summary",
  },
  {
    name: "Trial Balance",
    category: "Accountant Tools",
    status: "live",
    personas: ["accountant"],
    comparison: "Date range",
    automation: "Difference flags",
    tab: "trial",
  },
  {
    name: "VAT Return",
    category: "Tax",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Tax period",
    automation: "Filing checklist",
    href: "/vat-filing",
  },
  {
    name: "Period Comparison",
    category: "Management",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Prior period",
    automation: "Variance review",
    href: "/advanced-reports?tab=comparison",
  },
  {
    name: "FX Gains and Losses",
    category: "Financial Statements",
    status: "live",
    personas: ["accountant"],
    comparison: "As of date",
    automation: "Exposure flags",
    href: "/exchange-rates",
  },
  {
    name: "General Ledger",
    category: "Accountant Tools",
    status: "live",
    personas: ["accountant"],
    comparison: "Date range",
    automation: "Reclassification review",
    tab: "ledger",
  },
  {
    name: "Account Transactions",
    category: "Accountant Tools",
    status: "live",
    personas: ["accountant"],
    comparison: "Account drilldown",
    automation: "Missing source review",
    tab: "ledger",
  },
  {
    name: "Corporate Tax Estimate",
    category: "Tax",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "Tax year",
    automation: "Tax liability review",
    href: "/corporate-tax",
  },
  {
    name: "Customer Balance Summary",
    category: "Sales",
    status: "planned",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Open balance",
    automation: "Collections queue",
    href: "/contacts",
  },
  {
    name: "Vendor Balance Summary",
    category: "Purchases",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "Open balance",
    automation: "Bill pay queue",
    href: "/bill-pay",
  },
  {
    name: "Invoice Status",
    category: "Sales",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Status and overdue",
    automation: "Reminder routing",
    tab: "sales",
  },
  {
    name: "Budget vs Actual",
    category: "Management",
    status: "live",
    personas: ["owner", "accountant"],
    comparison: "Budget variance",
    automation: "Spend alerts",
    tab: "planning",
  },
  {
    name: "Cash Flow Forecast",
    category: "Management",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Forecast",
    automation: "Cash warnings",
    tab: "planning",
  },
  {
    name: "Revenue by Customer",
    category: "Sales",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Prior period",
    automation: "Client concentration",
    tab: "sales",
  },
  {
    name: "Sales by Product/Service",
    category: "Sales",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "Margin",
    automation: "Margin alerts",
    href: "/invoices",
  },
  {
    name: "Expenses by Vendor",
    category: "Purchases",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Prior period",
    automation: "Spend review",
    tab: "expenses",
  },
  {
    name: "Expenses by Category",
    category: "Purchases",
    status: "live",
    personas: ["owner", "freelancer", "accountant"],
    comparison: "Budget",
    automation: "Cost alerts",
    tab: "expenses",
  },
  {
    name: "Inventory Valuation",
    category: "Inventory",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "As of date",
    automation: "Stock risk",
    href: "/inventory",
  },
  {
    name: "Inventory Movement",
    category: "Inventory",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "Period movement",
    automation: "Reorder alerts",
    href: "/inventory",
  },
  {
    name: "Fixed Asset Register",
    category: "Assets",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "As of date",
    automation: "Capitalization review",
    href: "/fixed-assets",
  },
  {
    name: "Depreciation Schedule",
    category: "Assets",
    status: "planned",
    personas: ["accountant"],
    comparison: "Period",
    automation: "Posting suggestions",
    href: "/fixed-assets",
  },
  {
    name: "Payroll Summary",
    category: "Payroll",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "Pay period",
    automation: "Variance checks",
    href: "/payroll",
  },
  {
    name: "WPS / SIF Summary",
    category: "Payroll",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "Pay run",
    automation: "WPS readiness",
    href: "/payroll",
  },
  {
    name: "Expense Claims",
    category: "Purchases",
    status: "planned",
    personas: ["owner", "accountant"],
    comparison: "Claim status",
    automation: "Approval routing",
    href: "/expense-claims",
  },
  {
    name: "Month-End Close Status",
    category: "Accountant Tools",
    status: "planned",
    personas: ["accountant"],
    comparison: "Close period",
    automation: "Close checklist",
    href: "/month-end",
  },
  {
    name: "Audit Trail",
    category: "Accountant Tools",
    status: "planned",
    personas: ["accountant"],
    comparison: "Activity period",
    automation: "Risk summary",
    href: "/history",
  },
  {
    name: "Consolidated Statements",
    category: "Accountant Tools",
    status: "planned",
    personas: ["accountant"],
    comparison: "Multi-company",
    automation: "Report packs",
    href: "/financial-statements",
  },
];

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

export default function Reports() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [activeTab, setActiveTab] = useState<ReportTab>("pl");
  const [personaFilter, setPersonaFilter] = useState<PersonaFilter>("all");
  const [isExporting, setIsExporting] = useState(false);

  const filteredReports = useMemo(() => {
    return reportCatalog.filter((report) => {
      return personaFilter === "all" || report.personas.includes(personaFilter);
    });
  }, [personaFilter]);

  const reportStats = useMemo(() => {
    const live = reportCatalog.filter((report) => report.status === "live").length;
    const ready = reportCatalog.filter((report) => report.status !== "planned").length;
    const planned = reportCatalog.length - ready;
    return { live, ready, planned, total: reportCatalog.length };
  }, []);

  const workspaceSummaries = useMemo(() => {
    return personaWorkspaces.map((workspace) => {
      const reports = reportCatalog.filter((report) => report.personas.includes(workspace.persona));
      const readyReports = reports.filter((report) => report.status !== "planned").length;
      const automationCount = reports.filter((report) => report.automation).length;
      const topReadyReport = reports.find((report) => report.tab) ?? reports[0];
      return {
        ...workspace,
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

  const reportReceipts = useMemo(() => {
    return receipts.filter((receipt) => receiptInDateRange(receipt, dateRange));
  }, [dateRange, receipts]);

  const buildExpenseSummary = (getLabel: (receipt: ReceiptReportRow) => string) => {
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
  };

  const expenseByVendor = useMemo(
    () => buildExpenseSummary((receipt) => receipt.merchant || "Unknown Merchant").slice(0, 8),
    [reportReceipts]
  );

  const expenseByCategory = useMemo(
    () => buildExpenseSummary((receipt) => receipt.category || "Uncategorized").slice(0, 8),
    [reportReceipts]
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

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setPersonaFilter(workspace.persona);
                        setActiveTab(workspace.primaryTab);
                      }}
                      data-testid={`button-open-workspace-${workspace.persona}`}
                    >
                      Open reports
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setPersonaFilter(workspace.persona)}
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
                onClick={() => setPersonaFilter(filter.id)}
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
        <TabsList className="grid h-auto w-full max-w-6xl grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
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
