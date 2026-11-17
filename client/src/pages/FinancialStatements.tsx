import { operatingExpenseLinesOf } from "./financialStatementsLayout";
import { T } from "@/components/layout/T";
import { PageHeader } from "@/components/ui/page-header";
import { BooksStatusStrip } from "@/components/reports/BooksStatusStrip";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { exportToExcel, type ExportData } from "@/lib/export";
import { formatCurrency, formatDate } from "@/lib/format";
import { Money } from "@/components/ui/money";
import { BarChart3, Scale, Banknote, CheckCircle2, XCircle, Search, Download } from "lucide-react";

// Types matching server response shapes

interface AccountBreakdown {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountNameAr?: string | null;
  amount: number;
}

interface StatementSection {
  total: number;
  lines: AccountBreakdown[];
}

interface ProfitLossData {
  startDate: string;
  endDate: string;
  revenue: number;
  expenses: number;
  netIncome: number;
  breakdown: {
    revenue: AccountBreakdown[];
    expenses: AccountBreakdown[];
  };
  // Reporting kernel statement (sections, gross profit, comparatives).
  statement?: {
    revenue: number;
    costOfSales: number;
    grossProfit: number;
    otherIncome: number;
    netProfit: number;
    sections: {
      revenue: StatementSection;
      costOfSales: StatementSection;
      otherIncome: StatementSection;
    };
    comparison?: {
      label: string;
      totals: { totalIncome: number; totalExpenses: number; netProfit: number };
    };
  };
}

interface BalanceSheetData {
  asOfDate: string;
  assets: {
    total: number;
    breakdown: AccountBreakdown[];
    current?: StatementSection;
    nonCurrent?: StatementSection;
  };
  liabilities: {
    total: number;
    breakdown: AccountBreakdown[];
    current?: StatementSection;
    nonCurrent?: StatementSection;
  };
  equity: {
    total: number;
    breakdown: AccountBreakdown[];
    capital?: StatementSection;
    retainedEarningsBroughtForward?: number;
    currentYearEarnings?: number;
  };
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
  difference?: number;
  statement?: {
    comparison?: {
      asOf: string;
      totalAssets: number;
      totalLiabilities: number;
      totalEquity: number;
    };
  };
}

interface CashFlowData {
  startDate: string;
  endDate: string;
  operating: { total: number; breakdown: AccountBreakdown[] };
  investing: { total: number; breakdown: AccountBreakdown[] };
  financing: { total: number; breakdown: AccountBreakdown[] };
  netCashChange: number;
  openingCash?: number;
  closingCash?: number;
  cashProof?: { isBalanced: boolean; difference: number };
}

/** Prior-year comparative under a summary figure. */
function PriorYear({ value }: { value: number | undefined; locale?: string }) {
  if (value === undefined) return null;
  return (
    <p className="text-xs text-muted-foreground tabular-nums mt-1">
      <T k="statements.priorYear" />: <Money amount={value} currency="AED" />
    </p>
  );
}

/** Section subtotal band inside a statement card: a full-width tinted row, aligned with the table cells. */
function SubtotalRow({ label, amount }: { label: string; amount: number; locale?: string }) {
  return (
    <div className="my-3 flex items-center justify-between gap-4 rounded-md bg-muted/60 px-4 py-2 text-sm font-semibold text-foreground">
      <span>
        <T k={label} />
      </span>
      <span className="tabular-nums">
        <Money amount={amount} currency={"AED"} />
      </span>
    </div>
  );
}

type FinancialStatementTab = "profit-loss" | "balance-sheet" | "cash-flow";

function financialStatementTabFromSearch(search: string): FinancialStatementTab {
  const tab = new URLSearchParams(search).get("tab");
  if (tab === "balance-sheet" || tab === "cash-flow") return tab;
  return "profit-loss";
}

function getDefaultDateRange() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  return {
    startDate: startOfYear.toISOString().slice(0, 10),
    endDate: now.toISOString().slice(0, 10),
  };
}

function prepareCashFlowExport(data: CashFlowData): ExportData[] {
  const detailRows = [
    ...data.operating.breakdown.map((item) => ({ activity: "Operating", ...item })),
    ...data.investing.breakdown.map((item) => ({ activity: "Investing", ...item })),
    ...data.financing.breakdown.map((item) => ({ activity: "Financing", ...item })),
  ];

  return [
    {
      sheetName: "Cash Flow Statement",
      columns: [
        { header: "Metric", key: "metric", width: 34 },
        { header: "Amount (AED)", key: "amount", width: 18 },
      ],
      rows: [
        { metric: "Period start", amount: data.startDate },
        { metric: "Period end", amount: data.endDate },
        { metric: "Opening cash", amount: data.openingCash ?? "" },
        { metric: "Net operating cash flow", amount: data.operating.total.toFixed(2) },
        { metric: "Net investing cash flow", amount: data.investing.total.toFixed(2) },
        { metric: "Net financing cash flow", amount: data.financing.total.toFixed(2) },
        { metric: "Net cash change", amount: data.netCashChange.toFixed(2) },
        { metric: "Closing cash", amount: data.closingCash ?? "" },
      ],
    },
    {
      sheetName: "Cash Flow Detail",
      columns: [
        { header: "Activity", key: "activity", width: 16 },
        { header: "Code", key: "accountCode", width: 12 },
        { header: "Account", key: "accountName", width: 34 },
        { header: "Amount (AED)", key: "amount", width: 18 },
      ],
      rows: detailRows.map((row) => ({
        activity: row.activity,
        accountCode: row.accountCode || "",
        accountName: row.accountName || "",
        amount: row.amount.toFixed(2),
      })),
    },
  ];
}

function BreakdownTable({ items, locale }: { items: AccountBreakdown[]; locale?: string }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        <T k="pageLabels.noEntriesFound" />
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <T k="statements.colCode" />
          </TableHead>
          <TableHead>
            <T k="pages.account" />
          </TableHead>
          <TableHead data-numeric>
            <T k="pages.amount" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.accountId}>
            <TableCell className="tabular-nums text-sm">{item.accountCode}</TableCell>
            <TableCell>
              <span dir="auto">
                {locale === "ar" && item.accountNameAr ? item.accountNameAr : item.accountName}
              </span>
            </TableCell>
            <TableCell data-numeric>
              <Money amount={item.amount} currency={"AED"} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ================================
// Profit & Loss Tab
// ================================

function ProfitLossTab({ companyId, locale }: { companyId: string; locale: string }) {
  const defaults = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [queryDates, setQueryDates] = useState(defaults);

  const { data, isLoading, error } = useQuery<ProfitLossData>({
    queryKey: [
      `/api/companies/${companyId}/financial-statements/profit-loss?startDate=${queryDates.startDate}&endDate=${queryDates.endDate}&compareTo=prior_year`,
    ],
    enabled: !!companyId,
  });

  const handleGenerate = () => {
    setQueryDates({ startDate, endDate });
  };
  const operatingExpenseLines = data
    ? operatingExpenseLinesOf(data.breakdown.expenses, data.statement?.sections.costOfSales.lines)
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_auto] items-end">
            <div className="space-y-2">
              <Label>
                <T k="pages.startDate" />
              </Label>
              <DatePicker value={startDate} onChange={setStartDate} />
            </div>
            <div className="space-y-2">
              <Label>
                <T k="pages.endDate" />
              </Label>
              <DatePicker value={endDate} onChange={setEndDate} />
            </div>
            <Button onClick={handleGenerate} className="md:justify-self-end">
              <Search className="h-4 w-4 me-2" />
              <T k="pages.generate" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">
              <T k="statements.loadFailed" />
            </p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  <T k="pages.totalRevenue" />
                </CardDescription>
                <CardTitle className="text-h1 font-semibold">
                  <Money amount={data.revenue} currency={"AED"} />
                </CardTitle>
                <PriorYear value={data.statement?.comparison?.totals.totalIncome} locale={locale} />
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  <T k="pages.totalExpenses" />
                </CardDescription>
                <CardTitle className="text-h1 font-semibold">
                  <Money amount={data.expenses} currency={"AED"} />
                </CardTitle>
                <PriorYear
                  value={data.statement?.comparison?.totals.totalExpenses}
                  locale={locale}
                />
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  <T k="pages.netIncome" />
                </CardDescription>
                <CardTitle
                  className={`text-h1 font-semibold ${data.netIncome >= 0 ? "text-foreground" : "text-negative"}`}
                >
                  <Money amount={data.netIncome} currency={"AED"} />
                </CardTitle>
                <PriorYear value={data.statement?.comparison?.totals.netProfit} locale={locale} />
              </CardHeader>
            </Card>
          </div>

          {/* Revenue Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                <T k="pages.revenue" />
              </CardTitle>
              <CardDescription>
                {formatDate(data.startDate, locale)} - {formatDate(data.endDate, locale)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* N5: revenue rows, total revenue, then cost of sales and gross profit, then
                  expenses. Cost-of-sales accounts are shown once (not again under expenses). */}
              <BreakdownTable
                items={data.statement?.sections.revenue.lines ?? data.breakdown.revenue}
                locale={locale}
              />
              {data.statement && data.statement.otherIncome !== 0 && (
                <>
                  <SubtotalRow
                    label="statements.otherIncome"
                    amount={data.statement.otherIncome}
                    locale={locale}
                  />
                  <BreakdownTable
                    items={data.statement.sections.otherIncome.lines}
                    locale={locale}
                  />
                </>
              )}
              <Separator className="my-2" />
              <div
                className="flex justify-between items-center font-bold py-2"
                data-testid="pl-total-revenue"
              >
                <span>
                  <T k="pages.totalRevenue" />
                </span>
                <span className="tabular-nums">
                  <Money amount={data.revenue} currency={"AED"} />
                </span>
              </div>
              {data.statement && data.statement.costOfSales !== 0 && (
                <>
                  <SubtotalRow
                    label="statements.costOfSales"
                    amount={data.statement.costOfSales}
                    locale={locale}
                  />
                  <BreakdownTable
                    items={data.statement.sections.costOfSales.lines}
                    locale={locale}
                  />
                </>
              )}
              {data.statement && (
                <SubtotalRow
                  label="statements.grossProfit"
                  amount={data.statement.grossProfit}
                  locale={locale}
                />
              )}
            </CardContent>
          </Card>

          {/* Expense Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                <T k="pages.expenses" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={operatingExpenseLines} locale={locale} />
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>
                  <T k={data.statement ? "statements.operatingExpenses" : "pages.totalExpenses"} />
                </span>
                <span className="tabular-nums">
                  <Money
                    amount={
                      data.statement ? data.expenses - data.statement.costOfSales : data.expenses
                    }
                    currency={"AED"}
                  />
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ================================
// Balance Sheet Tab
// ================================

function BalanceSheetTab({ companyId, locale }: { companyId: string; locale: string }) {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  const [asOfDate, setAsOfDate] = useState(today);
  const [queryDate, setQueryDate] = useState(today);

  const { data, isLoading, error } = useQuery<BalanceSheetData>({
    queryKey: [
      `/api/companies/${companyId}/financial-statements/balance-sheet?asOfDate=${queryDate}&compareTo=prior_year`,
    ],
    enabled: !!companyId,
  });

  const handleGenerate = () => {
    setQueryDate(asOfDate);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto] items-end">
            <div className="space-y-2">
              <Label>
                <T k="statements.asOfDate" />
              </Label>
              <DatePicker value={asOfDate} onChange={setAsOfDate} />
            </div>
            <Button onClick={handleGenerate} className="md:justify-self-end">
              <Search className="h-4 w-4 me-2" />
              <T k="pages.generate" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">
              <T k="statements.loadFailed" />
            </p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Balance Check */}
          <div className="flex items-center gap-2">
            {data.isBalanced ? (
              <Badge variant="success" dot>
                <T k="statements.balanced" />
              </Badge>
            ) : (
              <Badge variant="danger" dot>
                <T k="statements.notBalanced" />
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">
              {formatMessage(t["statements.asOf"], { date: formatDate(data.asOfDate, locale) })}
            </span>
          </div>
          {!data.isBalanced && (
            <div
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger-subtle p-3 text-small text-danger-subtle-foreground"
              data-testid="banner-out-of-balance"
            >
              {formatMessage(t["statements.outOfBalance"], {
                amount: formatCurrency(data.difference ?? 0, "AED", locale),
              })}
            </div>
          )}

          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  <T k="pages.totalAssets" />
                </CardDescription>
                <CardTitle className="text-2xl">
                  <Money amount={data.assets.total} currency={"AED"} />
                </CardTitle>
                <PriorYear value={data.statement?.comparison?.totalAssets} locale={locale} />
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  <T k="pages.totalLiabilities" />
                </CardDescription>
                <CardTitle className="text-2xl">
                  <Money amount={data.liabilities.total} currency={"AED"} />
                </CardTitle>
                <PriorYear value={data.statement?.comparison?.totalLiabilities} locale={locale} />
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  <T k="pages.totalEquity" />
                </CardDescription>
                <CardTitle className="text-2xl">
                  <Money amount={data.equity.total} currency={"AED"} />
                </CardTitle>
                <PriorYear value={data.statement?.comparison?.totalEquity} locale={locale} />
              </CardHeader>
            </Card>
          </div>

          {/* Assets */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                <T k="pages.assets" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.assets.breakdown} locale={locale} />
              {data.assets.current && data.assets.nonCurrent && (
                <>
                  <SubtotalRow
                    label="statements.currentAssets"
                    amount={data.assets.current.total}
                    locale={locale}
                  />
                  <SubtotalRow
                    label="statements.nonCurrentAssets"
                    amount={data.assets.nonCurrent.total}
                    locale={locale}
                  />
                </>
              )}
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>
                  <T k="pages.totalAssets" />
                </span>
                <span className="tabular-nums">
                  <Money amount={data.assets.total} currency={"AED"} />
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Liabilities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                <T k="pages.liabilities" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.liabilities.breakdown} locale={locale} />
              {data.liabilities.current && data.liabilities.nonCurrent && (
                <>
                  <SubtotalRow
                    label="statements.currentLiabilities"
                    amount={data.liabilities.current.total}
                    locale={locale}
                  />
                  <SubtotalRow
                    label="statements.nonCurrentLiabilities"
                    amount={data.liabilities.nonCurrent.total}
                    locale={locale}
                  />
                </>
              )}
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>
                  <T k="pages.totalLiabilities" />
                </span>
                <span className="tabular-nums">
                  <Money amount={data.liabilities.total} currency={"AED"} />
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Equity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                <T k="pages.equity" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* R11-06: capital, retained earnings brought forward and current
                  year earnings are separate lines. */}
              <BreakdownTable
                items={data.equity.capital?.lines ?? data.equity.breakdown}
                locale={locale}
              />
              {data.equity.retainedEarningsBroughtForward !== undefined && (
                <SubtotalRow
                  label="statements.retainedEarningsBf"
                  amount={data.equity.retainedEarningsBroughtForward}
                  locale={locale}
                />
              )}
              {data.equity.currentYearEarnings !== undefined && (
                <SubtotalRow
                  label="statements.currentYearEarnings"
                  amount={data.equity.currentYearEarnings}
                  locale={locale}
                />
              )}
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>
                  <T k="pages.totalEquity" />
                </span>
                <span className="tabular-nums">
                  <Money amount={data.equity.total} currency={"AED"} />
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Accounting Equation */}
          <Card className="border-border-strong">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between text-lg">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">
                    <T k="pages.assets" />
                  </p>
                  <p className="font-bold">
                    <Money amount={data.assets.total} currency={"AED"} />
                  </p>
                </div>
                <Scale className="h-6 w-6 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">
                    <T k="statements.liabilitiesAndEquity" />
                  </p>
                  <p className="font-bold">
                    <Money amount={data.totalLiabilitiesAndEquity} currency={"AED"} />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ================================
// Cash Flow Tab
// ================================

function CashFlowTab({ companyId, locale }: { companyId: string; locale: string }) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const defaults = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [queryDates, setQueryDates] = useState(defaults);

  const { data, isLoading, error } = useQuery<CashFlowData>({
    queryKey: [
      `/api/companies/${companyId}/financial-statements/cash-flow?startDate=${queryDates.startDate}&endDate=${queryDates.endDate}`,
    ],
    enabled: !!companyId,
  });

  const handleGenerate = () => {
    setQueryDates({ startDate, endDate });
  };

  const handleExport = async () => {
    if (!data) return;

    try {
      await exportToExcel(
        prepareCashFlowExport(data),
        `cash-flow-statement-${data.startDate}-to-${data.endDate}`
      );
      toast({
        title: translateNow("toasts.cashFlowExported"),
        description: translateNow("toasts.theStatementWorkbookHasBeenDownloadedFor"),
      });
    } catch (exportError: any) {
      toast({
        variant: "destructive",
        title: translateNow("toasts.exportFailed"),
        description:
          exportError?.message || translateNow("toasts.couldNotExportTheCashFlowStatement"),
      });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-4 items-end">
            <div className="space-y-2">
              <Label>
                <T k="pages.startDate" />
              </Label>
              <DatePicker value={startDate} onChange={setStartDate} />
            </div>
            <div className="space-y-2">
              <Label>
                <T k="pages.endDate" />
              </Label>
              <DatePicker value={endDate} onChange={setEndDate} />
            </div>
            <Button onClick={handleGenerate} className="md:justify-self-end">
              <Search className="h-4 w-4 me-2" />
              <T k="pages.generate" />
            </Button>
            <Button variant="outline" onClick={() => void handleExport()} disabled={!data}>
              <Download className="h-4 w-4 me-2" />
              <T k="pages.export" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">
              <T k="pageLabels.failedToLoadCashFlowStatement" />
            </p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* R11-08: opening and closing cash with a proof against the cash/bank accounts */}
          {data.openingCash !== undefined && data.closingCash !== undefined && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>
                    <T k="statements.openingCash" />
                  </CardDescription>
                  <CardTitle className="text-xl">
                    <Money amount={data.openingCash} currency={"AED"} />
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>
                    <T k="statements.closingCash" />
                  </CardDescription>
                  <CardTitle className="text-xl">
                    <Money amount={data.closingCash} currency={"AED"} />
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardContent className="pt-6 text-sm">
                  {data.cashProof?.isBalanced !== false ? (
                    <span className="text-success flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      <T k="statements.cashProofOk" />
                    </span>
                  ) : (
                    <span className="text-destructive flex items-center gap-2" role="alert">
                      <XCircle className="h-4 w-4" />
                      {formatMessage(t["statements.cashProofFail"], {
                        amount: formatCurrency(data.cashProof.difference, "AED", locale),
                      })}
                    </span>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  <T k="pageLabels.operating" />
                </CardDescription>
                <CardTitle
                  className={`text-h2 font-semibold ${data.operating.total >= 0 ? "text-foreground" : "text-negative"}`}
                >
                  <Money amount={data.operating.total} currency={"AED"} />
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  <T k="pageLabels.investing" />
                </CardDescription>
                <CardTitle
                  className={`text-h2 font-semibold ${data.investing.total >= 0 ? "text-foreground" : "text-negative"}`}
                >
                  <Money amount={data.investing.total} currency={"AED"} />
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  <T k="pageLabels.financing" />
                </CardDescription>
                <CardTitle
                  className={`text-h2 font-semibold ${data.financing.total >= 0 ? "text-foreground" : "text-negative"}`}
                >
                  <Money amount={data.financing.total} currency={"AED"} />
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="border-border-strong">
              <CardHeader className="pb-2">
                <CardDescription>
                  <T k="pageLabels.netCashChange" />
                </CardDescription>
                <CardTitle
                  className={`text-h2 font-semibold ${data.netCashChange >= 0 ? "text-foreground" : "text-negative"}`}
                >
                  <Money amount={data.netCashChange} currency={"AED"} />
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Operating Activities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                <T k="pageLabels.operatingActivities" />
              </CardTitle>
              <CardDescription>
                <T k="pageLabels.cashFromDayToDayBusinessOperations" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.operating.breakdown} locale={locale} />
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>
                  <T k="pageLabels.netOperatingCashFlow" />
                </span>
                <span className="tabular-nums">
                  <Money amount={data.operating.total} currency={"AED"} />
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Investing Activities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                <T k="pageLabels.investingActivities" />
              </CardTitle>
              <CardDescription>Cash from buying/selling long-term assets</CardDescription>
            </CardHeader>
            <CardContent>
              {data.investing.breakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  <T k="pageLabels.noInvestingActivitiesInThisPeriod" />
                </p>
              ) : (
                <BreakdownTable items={data.investing.breakdown} locale={locale} />
              )}
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>
                  <T k="pageLabels.netInvestingCashFlow" />
                </span>
                <span className="tabular-nums">
                  <Money amount={data.investing.total} currency={"AED"} />
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Financing Activities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                <T k="pageLabels.financingActivities" />
              </CardTitle>
              <CardDescription>
                <T k="pageLabels.cashFromDebtEquityAndDividends" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.financing.breakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  <T k="pageLabels.noFinancingActivitiesInThisPeriod" />
                </p>
              ) : (
                <BreakdownTable items={data.financing.breakdown} locale={locale} />
              )}
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>
                  <T k="pageLabels.netFinancingCashFlow" />
                </span>
                <span className="tabular-nums">
                  <Money amount={data.financing.total} currency={"AED"} />
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ================================
// Main Page Component
// ================================

export default function FinancialStatements() {
  const { t, locale } = useTranslation();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const search = useSearch();
  const [, navigate] = useLocation();
  const activeTab = financialStatementTabFromSearch(search ? `?${search}` : "");

  const handleTabChange = (value: string) => {
    const nextTab = financialStatementTabFromSearch(`?tab=${value}`);
    navigate(
      nextTab === "profit-loss" ? "/financial-statements" : `/financial-statements?tab=${nextTab}`
    );
  };

  if (isLoadingCompany) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">
          <T k="pages.noCompanyFoundPleaseCreateACompanyFirst" />
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Accounting"
        title={t["statements.pageTitle"]}
        description={t["statements.pageDesc"]}
        backHref="/reports"
        backLabel={t["reportCenter.backToReports"]}
      />
      <BooksStatusStrip companyId={companyId} />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList>
          <TabsTrigger value="profit-loss" className="flex items-center gap-2">
            <BarChart3 className="hidden h-4 w-4 sm:block" />
            <span className="sm:hidden">{t["statements.tabShortPl"]}</span>
            <span className="hidden sm:inline">
              <T k="pageLabels.profitAndLoss" />
            </span>
          </TabsTrigger>
          <TabsTrigger value="balance-sheet" className="flex items-center gap-2">
            <Scale className="hidden h-4 w-4 sm:block" />
            <span className="sm:hidden">{t["statements.tabShortBs"]}</span>
            <span className="hidden sm:inline">
              <T k="pages.balanceSheet" />
            </span>
          </TabsTrigger>
          <TabsTrigger value="cash-flow" className="flex items-center gap-2">
            <Banknote className="hidden h-4 w-4 sm:block" />
            <span className="sm:hidden">{t["statements.tabShortCf"]}</span>
            <span className="hidden sm:inline">
              <T k="pages.cashFlow" />
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profit-loss">
          <ProfitLossTab companyId={companyId} locale={locale} />
        </TabsContent>

        <TabsContent value="balance-sheet">
          <BalanceSheetTab companyId={companyId} locale={locale} />
        </TabsContent>

        <TabsContent value="cash-flow">
          <CashFlowTab companyId={companyId} locale={locale} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
