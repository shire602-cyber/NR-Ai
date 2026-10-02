import { PageHeader } from "@/components/ui/page-header";
import { todayYmd, toYmd } from "@/lib/calendar-date";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { exportToExcel, type ExportData } from "@/lib/export";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  Scale,
  Banknote,
  CheckCircle2,
  XCircle,
  Search,
  Download,
} from "lucide-react";
import { messages as pageMessages } from "./FinancialStatements.i18n";

// Types matching server response shapes

interface AccountBreakdown {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number;
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
}

interface BalanceSheetData {
  asOfDate: string;
  assets: { total: number; breakdown: AccountBreakdown[] };
  liabilities: { total: number; breakdown: AccountBreakdown[] };
  equity: { total: number; breakdown: AccountBreakdown[] };
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
}

interface CashFlowData {
  startDate: string;
  endDate: string;
  operating: { total: number; breakdown: AccountBreakdown[] };
  investing: { total: number; breakdown: AccountBreakdown[] };
  financing: { total: number; breakdown: AccountBreakdown[] };
  netCashChange: number;
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
    startDate: toYmd(startOfYear),
    endDate: todayYmd(now),
  };
}

function prepareCashFlowExport(data: CashFlowData): ExportData[] {
  const detailRows = [
    ...data.operating.breakdown.map((item) => ({ activity: pageMessages.t("operating"), ...item })),
    ...data.investing.breakdown.map((item) => ({ activity: pageMessages.t("investing"), ...item })),
    ...data.financing.breakdown.map((item) => ({ activity: pageMessages.t("financing"), ...item })),
  ];

  return [
    {
      sheetName: "Cash Flow Statement",
      columns: [
        { header: pageMessages.t("metric"), key: "metric", width: 34 },
        { header: pageMessages.t("amountAed"), key: "amount", width: 18 },
      ],
      rows: [
        { metric: pageMessages.t("periodStart"), amount: data.startDate },
        { metric: pageMessages.t("periodEnd"), amount: data.endDate },
        { metric: pageMessages.t("netOperatingCashFlow"), amount: data.operating.total.toFixed(2) },
        { metric: pageMessages.t("netInvestingCashFlow"), amount: data.investing.total.toFixed(2) },
        { metric: pageMessages.t("netFinancingCashFlow"), amount: data.financing.total.toFixed(2) },
        { metric: pageMessages.t("netCashChange"), amount: data.netCashChange.toFixed(2) },
      ],
    },
    {
      sheetName: "Cash Flow Detail",
      columns: [
        { header: pageMessages.t("activity"), key: "activity", width: 16 },
        { header: pageMessages.t("code"), key: "accountCode", width: 12 },
        { header: pageMessages.t("account"), key: "accountName", width: 34 },
        { header: pageMessages.t("amountAed"), key: "amount", width: 18 },
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

function BreakdownTable({ items, locale }: { items: AccountBreakdown[]; locale: string }) {
  const tr = pageMessages.useT();

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">{tr("noEntriesFound")}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{tr("code")}</TableHead>
          <TableHead>{tr("account")}</TableHead>
          <TableHead className="text-end">{tr("amount")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.accountId}>
            <TableCell className="font-mono text-sm">{item.accountCode}</TableCell>
            <TableCell>{item.accountName}</TableCell>
            <TableCell className="text-end font-mono">
              {formatCurrency(item.amount, "AED", locale)}
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
  const tr = pageMessages.useT();

  const defaults = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [queryDates, setQueryDates] = useState(defaults);

  const { data, isLoading, error } = useQuery<ProfitLossData>({
    queryKey: [
      `/api/companies/${companyId}/financial-statements/profit-loss?startDate=${queryDates.startDate}&endDate=${queryDates.endDate}`,
    ],
    enabled: !!companyId,
  });

  const handleGenerate = () => {
    setQueryDates({ startDate, endDate });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Label>{tr("startDate")}</Label>
              <Input type="date" aria-label={tr("startDate")} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{tr("endDate")}</Label>
              <Input type="date" aria-label={tr("endDate")} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <Button onClick={handleGenerate}>
              <Search className="h-4 w-4 me-2" />
              {tr("generate")}
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
            <p className="text-destructive">{tr("failedToLoadProfitLossStatement")}</p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{tr("totalRevenue")}</CardDescription>
                <CardTitle className="text-2xl text-success flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  {formatCurrency(data.revenue, "AED", locale)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{tr("totalExpenses")}</CardDescription>
                <CardTitle className="text-2xl text-destructive flex items-center gap-2">
                  <TrendingDown className="h-5 w-5" />
                  {formatCurrency(data.expenses, "AED", locale)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{tr("netIncome")}</CardDescription>
                <CardTitle
                  className={`text-2xl flex items-center gap-2 ${data.netIncome >= 0 ? "text-success" : "text-destructive"}`}
                >
                  <BarChart3 className="h-5 w-5" />
                  {formatCurrency(data.netIncome, "AED", locale)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Revenue Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{tr("revenue")}</CardTitle>
              <CardDescription>
                {formatDate(data.startDate, locale)} - {formatDate(data.endDate, locale)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.breakdown.revenue} locale={locale} />
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>{tr("totalRevenue")}</span>
                <span dir="ltr" className="font-mono">
                  {formatCurrency(data.revenue, "AED", locale)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Expense Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{tr("expenses")}</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.breakdown.expenses} locale={locale} />
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>{tr("totalExpenses")}</span>
                <span dir="ltr" className="font-mono">
                  {formatCurrency(data.expenses, "AED", locale)}
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
  const tr = pageMessages.useT();

  const today = todayYmd();
  const [asOfDate, setAsOfDate] = useState(today);
  const [queryDate, setQueryDate] = useState(today);

  const { data, isLoading, error } = useQuery<BalanceSheetData>({
    queryKey: [
      `/api/companies/${companyId}/financial-statements/balance-sheet?asOfDate=${queryDate}`,
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div className="space-y-2">
              <Label>{tr("asOfDate")}</Label>
              <Input type="date" aria-label={tr("asOfDate")} value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
            </div>
            <Button onClick={handleGenerate}>
              <Search className="h-4 w-4 me-2" />
              {tr("generate")}
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
            <p className="text-destructive">{tr("failedToLoadBalanceSheet")}</p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Balance Check */}
          <div className="flex items-center gap-2">
            {data.isBalanced ? (
              <Badge variant="outline" className="text-success border-success">
                <CheckCircle2 className="h-3 w-3 me-1" />
                {tr("balanced")}
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 me-1" />
                {tr("notBalanced")}
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">
              {tr("asOf", { formatDate: formatDate(data.asOfDate, locale) })}
            </span>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{tr("totalAssets")}</CardDescription>
                <CardTitle className="text-2xl">
                  {formatCurrency(data.assets.total, "AED", locale)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{tr("totalLiabilities")}</CardDescription>
                <CardTitle className="text-2xl">
                  {formatCurrency(data.liabilities.total, "AED", locale)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{tr("totalEquity")}</CardDescription>
                <CardTitle className="text-2xl">
                  {formatCurrency(data.equity.total, "AED", locale)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Assets */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{tr("assets")}</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.assets.breakdown} locale={locale} />
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>{tr("totalAssets")}</span>
                <span dir="ltr" className="font-mono">
                  {formatCurrency(data.assets.total, "AED", locale)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Liabilities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{tr("liabilities")}</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.liabilities.breakdown} locale={locale} />
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>{tr("totalLiabilities")}</span>
                <span dir="ltr" className="font-mono">
                  {formatCurrency(data.liabilities.total, "AED", locale)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Equity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{tr("equity")}</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.equity.breakdown} locale={locale} />
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>{tr("totalEquity")}</span>
                <span dir="ltr" className="font-mono">
                  {formatCurrency(data.equity.total, "AED", locale)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Accounting Equation */}
          <Card className="border-2">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between text-lg">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">{tr("assets")}</p>
                  <p className="font-bold">{formatCurrency(data.assets.total, "AED", locale)}</p>
                </div>
                <Scale className="h-6 w-6 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">{tr("liabilitiesEquity")}</p>
                  <p className="font-bold">
                    {formatCurrency(data.totalLiabilitiesAndEquity, "AED", locale)}
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
  const tr = pageMessages.useT();

  const { toast } = useToast();
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
        title: tr("cashFlowExported"),
        description: tr("theStatementWorkbookHasBeenDownloaded"),
      });
    } catch (exportError: any) {
      toast({
        variant: "destructive",
        title: tr("exportFailed"),
        description: exportError?.message || tr("couldNotExportTheCashFlow"),
      });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-4 items-end">
            <div className="space-y-2">
              <Label>{tr("startDate")}</Label>
              <Input type="date" aria-label={tr("startDate")} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{tr("endDate")}</Label>
              <Input type="date" aria-label={tr("endDate")} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <Button onClick={handleGenerate}>
              <Search className="h-4 w-4 me-2" />
              {tr("generate")}
            </Button>
            <Button variant="outline" onClick={() => void handleExport()} disabled={!data}>
              <Download className="h-4 w-4 me-2" />
              {tr("export")}
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
            <p className="text-destructive">{tr("failedToLoadCashFlowStatement")}</p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{tr("operating")}</CardDescription>
                <CardTitle
                  className={`text-xl ${data.operating.total >= 0 ? "text-success" : "text-destructive"}`}
                >
                  {formatCurrency(data.operating.total, "AED", locale)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{tr("investing")}</CardDescription>
                <CardTitle
                  className={`text-xl ${data.investing.total >= 0 ? "text-success" : "text-destructive"}`}
                >
                  {formatCurrency(data.investing.total, "AED", locale)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{tr("financing")}</CardDescription>
                <CardTitle
                  className={`text-xl ${data.financing.total >= 0 ? "text-success" : "text-destructive"}`}
                >
                  {formatCurrency(data.financing.total, "AED", locale)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="border-2">
              <CardHeader className="pb-2">
                <CardDescription>{tr("netCashChange2")}</CardDescription>
                <CardTitle
                  className={`text-xl flex items-center gap-2 ${data.netCashChange >= 0 ? "text-success" : "text-destructive"}`}
                >
                  <Banknote className="h-5 w-5" />
                  {formatCurrency(data.netCashChange, "AED", locale)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Operating Activities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{tr("operatingActivities")}</CardTitle>
              <CardDescription>{tr("cashFromDayToDayBusiness")}</CardDescription>
            </CardHeader>
            <CardContent>
              <BreakdownTable items={data.operating.breakdown} locale={locale} />
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>{tr("netOperatingCashFlow2")}</span>
                <span dir="ltr" className="font-mono">
                  {formatCurrency(data.operating.total, "AED", locale)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Investing Activities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{tr("investingActivities")}</CardTitle>
              <CardDescription>{tr("cashFromBuyingSellingLongTerm")}</CardDescription>
            </CardHeader>
            <CardContent>
              {data.investing.breakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  {tr("noInvestingActivitiesInThisPeriod")}
                </p>
              ) : (
                <BreakdownTable items={data.investing.breakdown} locale={locale} />
              )}
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>{tr("netInvestingCashFlow2")}</span>
                <span dir="ltr" className="font-mono">
                  {formatCurrency(data.investing.total, "AED", locale)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Financing Activities */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{tr("financingActivities")}</CardTitle>
              <CardDescription>{tr("cashFromDebtEquityAndDividends")}</CardDescription>
            </CardHeader>
            <CardContent>
              {data.financing.breakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  {tr("noFinancingActivitiesInThisPeriod")}
                </p>
              ) : (
                <BreakdownTable items={data.financing.breakdown} locale={locale} />
              )}
              <Separator className="my-2" />
              <div className="flex justify-between items-center font-bold py-2">
                <span>{tr("netFinancingCashFlow2")}</span>
                <span dir="ltr" className="font-mono">
                  {formatCurrency(data.financing.total, "AED", locale)}
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
  const tr = pageMessages.useT();

  const { locale } = useTranslation();
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
        <p className="text-muted-foreground">{tr("noCompanyFoundPleaseCreateA")}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow={tr("accounting")}
        title={tr("financialStatements")}
        description={tr("generateProfitLossBalanceSheetAnd")}
        backHref="/reports"
        backLabel={tr("backToReports")}
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="profit-loss" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            {tr("profitLoss")}
          </TabsTrigger>
          <TabsTrigger value="balance-sheet" className="flex items-center gap-2">
            <Scale className="h-4 w-4" />
            {tr("balanceSheet")}
          </TabsTrigger>
          <TabsTrigger value="cash-flow" className="flex items-center gap-2">
            <Banknote className="h-4 w-4" />
            {tr("cashFlow")}
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
