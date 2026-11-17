import { T } from "@/components/layout/T";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Line,
  AreaChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ComposedChart,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import { useTranslation, formatMessage, translateNow } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatCurrency } from "@/lib/format";
import { Money } from "@/components/ui/money";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  TrendingUp,
  BarChart3,
  Brain,
  Wallet,
  Calendar,
  Target,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Minus,
  Sparkles,
  RefreshCw,
  Loader2,
  ChevronRight,
  DollarSign,
  PiggyBank,
  Activity,
  Zap,
} from "lucide-react";

interface CashFlowForecast {
  id: string;
  forecastDate: string;
  predictedInflow: number;
  predictedOutflow: number;
  predictedBalance: number;
  confidenceLevel: number;
}

interface BudgetVsActual {
  accountId: string;
  accountName: string;
  accountType: string;
  budgeted: number;
  actual: number;
  /** Positive = favourable (income above budget, expense below budget). */
  variance: number;
  variancePercent: number;
  favourable: boolean;
}

interface FinancialKPI {
  type: string;
  label: string;
  value: number;
  previousValue: number;
  changePercent: number;
  trend: "up" | "down" | "stable";
  benchmark?: number;
  unit: string;
}

interface AIInsight {
  id: string;
  type: "opportunity" | "warning" | "trend" | "recommendation";
  title: string;
  description: string;
  impact: string;
  priority: "high" | "medium" | "low";
  actionable: boolean;
  action?: string;
}

export default function AdvancedAnalytics() {
  const { t } = useTranslation();
  const { t: _t, locale } = useTranslation();
  const isRTL = locale === "ar";
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [forecastPeriod, setForecastPeriod] = useState("3months");
  const [budgetYear, setBudgetYear] = useState(new Date().getFullYear());
  const [budgetMonth, setBudgetMonth] = useState(new Date().getMonth() + 1);

  // Fetch forecasts
  const { data: forecasts, isLoading: forecastsLoading } = useQuery<CashFlowForecast[]>({
    queryKey: ["/api/analytics/forecasts", companyId, forecastPeriod],
    queryFn: () => {
      const params = new URLSearchParams({
        companyId: companyId ?? "",
        period: forecastPeriod,
      });
      return apiRequest("GET", `/api/analytics/forecasts?${params}`);
    },
    enabled: !!companyId,
  });

  // Fetch budget vs actual
  const { data: budgetData, isLoading: budgetLoading } = useQuery<BudgetVsActual[]>({
    queryKey: ["/api/analytics/budget-vs-actual", companyId, budgetYear, budgetMonth],
    queryFn: () => {
      const params = new URLSearchParams({
        companyId: companyId ?? "",
        year: String(budgetYear),
        month: String(budgetMonth),
      });
      return apiRequest("GET", `/api/analytics/budget-vs-actual?${params}`);
    },
    enabled: !!companyId,
  });

  // Fetch KPIs
  const { data: kpis, isLoading: kpisLoading } = useQuery<FinancialKPI[]>({
    queryKey: ["/api/analytics/kpis", companyId],
    queryFn: () => {
      const params = new URLSearchParams({ companyId: companyId ?? "" });
      return apiRequest("GET", `/api/analytics/kpis?${params}`);
    },
    enabled: !!companyId,
  });

  // Fetch AI insights
  const { data: insights, isLoading: insightsLoading } = useQuery<AIInsight[]>({
    queryKey: ["/api/analytics/insights", companyId],
    queryFn: () => {
      const params = new URLSearchParams({ companyId: companyId ?? "" });
      return apiRequest("GET", `/api/analytics/insights?${params}`);
    },
    enabled: !!companyId,
  });

  // Generate forecast mutation
  const generateForecastMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/analytics/generate-forecast", {
        companyId,
        period: forecastPeriod,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/analytics/forecasts", companyId, forecastPeriod],
      });
      toast({
        title: translateNow("toasts.forecastGenerated"),
        description: translateNow("toasts.cashFlowProjectedFromOpenInvoicesVendor"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.error"),
        description: error?.message || translateNow("toasts.failedToGenerateForecast"),
      });
    },
  });

  const forecastRows = (forecasts ?? []).map((forecast) => ({
    month: new Date(forecast.forecastDate).toLocaleDateString("en-AE", { month: "short" }),
    inflow: Number(forecast.predictedInflow) || 0,
    outflow: Number(forecast.predictedOutflow) || 0,
    balance: Number(forecast.predictedBalance) || 0,
    confidence: Number(forecast.confidenceLevel) || 0,
  }));
  const hasForecastRows = forecastRows.length > 0;
  const forecastSummary = forecastRows.reduce(
    (summary, row) => ({
      inflow: summary.inflow + row.inflow,
      outflow: summary.outflow + row.outflow,
      balance: row.balance,
      confidence: summary.confidence + row.confidence,
    }),
    { inflow: 0, outflow: 0, balance: 0, confidence: 0 }
  );
  const _averageForecastConfidence = hasForecastRows
    ? Math.round((forecastSummary.confidence / forecastRows.length) * 100)
    : 0;

  const budgetRows = (budgetData ?? []).map((item) => ({
    category: item.accountName,
    budgeted: Number(item.budgeted) || 0,
    actual: Number(item.actual) || 0,
    variance: Number(item.variance) || 0,
  }));
  const hasBudgetRows = budgetRows.length > 0;
  const budgetSummary = budgetRows.reduce(
    (summary, row) => ({
      budgeted: summary.budgeted + row.budgeted,
      actual: summary.actual + row.actual,
      variance: summary.variance + row.variance,
    }),
    { budgeted: 0, actual: 0, variance: 0 }
  );

  const kpiRows = kpis ?? [];
  const insightRows = insights ?? [];

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case "up":
        return <ArrowUp className="w-4 h-4 text-success " />;
      case "down":
        return <ArrowDown className="w-4 h-4 text-destructive " />;
      default:
        return <Minus className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getInsightIcon = (type: string) => {
    switch (type) {
      case "opportunity":
        return <TrendingUp className="w-5 h-5 text-success " />;
      case "warning":
        return <AlertTriangle className="w-5 h-5 text-warning " />;
      case "trend":
        return <Activity className="w-5 h-5 text-info " />;
      case "recommendation":
        return <Sparkles className="w-5 h-5 text-chart-5 " />;
      default:
        return <Brain className="w-5 h-5" />;
    }
  };

  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  return (
    <div className="space-y-6" dir={isRTL ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="relative overflow-hidden rounded-lg border border-info/20 p-8">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-lg bg-info/20">
              <BarChart3 className="w-6 h-6 text-info" />
            </div>
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-analytics-title">
                <T k="pageLabels.advancedAnalyticsAndForecasts" />
              </h1>
              <p className="text-muted-foreground mt-1">
                {t["advancedAnalytics.aiPoweredFinancialIntelligenceFor"]}
              </p>
            </div>
          </div>
        </div>
        <div className="absolute top-0 end-0 w-64 h-64 bg-info/5 rounded-full -me-32 -mt-32 blur-3xl" />
        <div className="absolute bottom-0 start-0 w-48 h-48 bg-chart-5/5 rounded-full -ms-24 -mb-24 blur-3xl" />
      </div>

      <Tabs defaultValue="forecasts" className="space-y-6">
        <TabsList>
          <TabsTrigger value="forecasts" className="gap-2" data-testid="tab-forecasts">
            <TrendingUp className="w-4 h-4" />
            <span className="hidden sm:inline">
              <T k="pages.cashFlow" />
            </span>
          </TabsTrigger>
          <TabsTrigger value="budget" className="gap-2" data-testid="tab-budget">
            <Target className="w-4 h-4" />
            <span className="hidden sm:inline">
              <T k="pages.budget" />
            </span>
          </TabsTrigger>
          <TabsTrigger value="kpis" className="gap-2" data-testid="tab-kpis">
            <Activity className="w-4 h-4" />
            <span className="hidden sm:inline">KPIs</span>
          </TabsTrigger>
          <TabsTrigger value="insights" className="gap-2" data-testid="tab-insights">
            <Brain className="w-4 h-4" />
            <span className="hidden sm:inline">
              <T k="pages.aiInsights" />
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Cash Flow Forecasting */}
        <TabsContent value="forecasts" className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Select value={forecastPeriod} onValueChange={setForecastPeriod}>
                <SelectTrigger className="w-40" data-testid="select-forecast-period">
                  <SelectValue placeholder={t["forms.section.period"]} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3months">{t["advancedAnalytics.3Months"]}</SelectItem>
                  <SelectItem value="6months">{t["advancedAnalytics.6Months"]}</SelectItem>
                  <SelectItem value="12months">{t["advancedAnalytics.12Months"]}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => generateForecastMutation.mutate()}
              disabled={generateForecastMutation.isPending}
              data-testid="button-generate-forecast"
            >
              {generateForecastMutation.isPending ? (
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 me-2" />
              )}
              {t["aIFeatures.generateForecast"]}
            </Button>
          </div>

          {/* Forecast Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">
                  <T k="pageLabels.projectedInflow" />
                </CardTitle>
                <ArrowUp className="w-4 h-4 text-success " />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums text-success ">
                  <Money amount={forecastSummary.inflow} currency={"AED"} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatMessage(t["advancedAnalytics.nextCountMonths"], {
                    count: forecastPeriod === "3months" ? 3 : forecastPeriod === "6months" ? 6 : 12,
                  })}
                </p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">
                  <T k="pageLabels.projectedOutflow" />
                </CardTitle>
                <ArrowDown className="w-4 h-4 text-info " />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums text-info ">
                  <Money amount={forecastSummary.outflow} currency={"AED"} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  <T k="pageLabels.estimatedExpenses" />
                </p>
              </CardContent>
            </Card>

            <Card className="hover-elevate border-success/30 ">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">
                  <T k="pageLabels.netCashPosition" />
                </CardTitle>
                <Wallet className="w-4 h-4 text-success " />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums text-success ">
                  <Money amount={forecastSummary.balance} currency={"AED"} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  <T k="pageLabels.projectedBalance" />
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Forecast Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <T k="pages.cashFlowForecast" />
              </CardTitle>
              <CardDescription>
                <T k="pageLabels.aIPredictedInflowsAndOutflowsWithConfidenceBands" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              {forecastsLoading ? (
                <Skeleton className="h-[350px] w-full" />
              ) : hasForecastRows ? (
                <ResponsiveContainer width="100%" height={350}>
                  <AreaChart data={forecastRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={(value) => `${value / 1000}k`} />
                    <Tooltip formatter={(value) => formatCurrency(value as number, "AED")} />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="inflow"
                      stackId="1"
                      stroke="hsl(142, 76%, 36%)"
                      fill="hsl(142, 76%, 36%)"
                      fillOpacity={0.3}
                      name="Inflow"
                    />
                    <Area
                      type="monotone"
                      dataKey="outflow"
                      stackId="2"
                      stroke="hsl(221, 83%, 53%)"
                      fill="hsl(221, 83%, 53%)"
                      fillOpacity={0.3}
                      name="Outflow"
                    />
                    <Line
                      type="monotone"
                      dataKey="balance"
                      stroke="hsl(262, 83%, 58%)"
                      strokeWidth={2}
                      dot={{ fill: "hsl(262, 83%, 58%)" }}
                      name="Net Balance"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[350px] flex flex-col items-center justify-center text-center text-muted-foreground">
                  <Calendar className="w-8 h-8 mb-3" />
                  <p className="font-medium">
                    <T k="pageLabels.noForecastGeneratedYet" />
                  </p>
                  <p className="text-sm">{t["advancedAnalytics.generateAForecastOnceInvoices"]}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Forecast basis */}
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Brain className="w-4 h-4 text-primary" />
                <T k="pageLabels.howThisForecastIsBuilt" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {hasForecastRows
                  ? "Monthly totals of open invoices by due date, approved vendor bills, payroll, tax dates and scheduled items. No averages are extrapolated and no confidence score is claimed."
                  : t["advancedAnalytics.addInvoicesVendorBillsOr"]}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Budget vs Actual */}
        <TabsContent value="budget" className="space-y-6">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={budgetYear.toString()} onValueChange={(v) => setBudgetYear(parseInt(v))}>
              <SelectTrigger className="w-28" data-testid="select-budget-year">
                <SelectValue placeholder={t["hr.year"]} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2024">2024</SelectItem>
                <SelectItem value="2025">2025</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={budgetMonth.toString()}
              onValueChange={(v) => setBudgetMonth(parseInt(v))}
            >
              <SelectTrigger className="w-36" data-testid="select-budget-month">
                <SelectValue placeholder={t["hr.month"]} />
              </SelectTrigger>
              <SelectContent>
                {months.map((m, i) => (
                  <SelectItem key={i + 1} value={(i + 1).toString()}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Budget Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">
                  <T k="pageLabels.totalBudgeted" />
                </CardTitle>
                <Target className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  <Money amount={budgetSummary.budgeted} currency={"AED"} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatMessage(t["advancedAnalytics.plannedForMonthYear"], {
                    month: months[budgetMonth - 1],
                    year: budgetYear,
                  })}
                </p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">
                  <T k="pages.totalActual" />
                </CardTitle>
                <DollarSign className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  <Money amount={budgetSummary.actual} currency={"AED"} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  <T k="pageLabels.recordedTransactions" />
                </p>
              </CardContent>
            </Card>

            <Card className="hover-elevate border-success/30 ">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">
                  <T k="pageLabels.netVariance" />
                </CardTitle>
                <PiggyBank className="w-4 h-4 text-success " />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold tabular-nums ${budgetSummary.variance < 0 ? "text-destructive " : "text-success "}`}
                >
                  <Money amount={budgetSummary.variance} currency={"AED"} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {budgetSummary.variance < 0
                    ? t["advancedAnalytics.unfavourableToBudget"]
                    : t["advancedAnalytics.favourableOrOnBudget"]}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Budget vs Actual Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <T k="pageLabels.budgetVsActualComparison" />
              </CardTitle>
              <CardDescription>
                <T k="pageLabels.categoryWiseBreakdownOfPlannedVsActualSpending" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              {budgetLoading ? (
                <Skeleton className="h-[350px] w-full" />
              ) : hasBudgetRows ? (
                <ResponsiveContainer width="100%" height={350}>
                  <ComposedChart data={budgetRows} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(value) => `${value / 1000}k`} />
                    <YAxis type="category" dataKey="category" width={100} />
                    <Tooltip formatter={(value) => formatCurrency(value as number, "AED")} />
                    <Legend />
                    <Bar dataKey="budgeted" fill="hsl(var(--muted))" name="Budgeted" barSize={20} />
                    <Bar dataKey="actual" fill="hsl(var(--primary))" name="Actual" barSize={20} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[350px] flex flex-col items-center justify-center text-center text-muted-foreground">
                  <Target className="w-8 h-8 mb-3" />
                  <p className="font-medium">
                    <T k="pageLabels.noBudgetDataYet" />
                  </p>
                  <p className="text-sm">
                    {t["advancedAnalytics.createBudgetsAndPostTransactions"]}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Variance Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <T k="pageLabels.varianceAnalysis" />
              </CardTitle>
              <CardDescription>
                <T k="pageLabels.detailedBreakdownByCategory" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {budgetRows.length === 0 && !budgetLoading && (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    <T k="pageLabels.noVarianceAnalysisIsAvailableYet" />
                  </div>
                )}
                {budgetRows.map((item, idx) => {
                  const isOverBudget = item.variance < 0; // unfavourable
                  const variancePercent =
                    item.budgeted > 0 ? Math.abs((item.variance / item.budgeted) * 100) : 0;

                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover-elevate"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-8 rounded-full ${isOverBudget ? "bg-destructive" : item.variance === 0 ? "bg-muted-foreground/30" : "bg-success"}`}
                        />
                        <div>
                          <p className="font-medium">{item.category}</p>
                          <p className="text-xs text-muted-foreground">
                            Budget: {formatCurrency(item.budgeted, "AED")} | Actual:{" "}
                            <Money amount={item.actual} currency={"AED"} />
                          </p>
                        </div>
                      </div>
                      <div className="text-end">
                        <p
                          className={`tabular-nums font-bold ${isOverBudget ? "text-destructive " : item.variance === 0 ? "text-muted-foreground" : "text-success "}`}
                        >
                          {item.variance > 0 ? "+" : ""}
                          <Money amount={item.variance} currency={"AED"} />
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {variancePercent.toFixed(1)}%{" "}
                          {isOverBudget
                            ? "unfavourable"
                            : item.variance === 0
                              ? "on target"
                              : "favourable"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Real-time KPIs */}
        <TabsContent value="kpis" className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              <T k="pageLabels.realTimeFinancialIndicatorsUpdatedAutomatically" />
            </p>
            <Button variant="outline" size="sm" data-testid="button-refresh-kpis">
              <RefreshCw className="w-4 h-4 me-2" />
              <T k="pages.refresh" />
            </Button>
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {kpisLoading &&
              Array.from({ length: 3 }).map((_, idx) => (
                <Skeleton key={idx} className="h-40 w-full" />
              ))}
            {!kpisLoading && kpiRows.length === 0 && (
              <Card className="md:col-span-2 lg:col-span-3">
                <CardContent className="py-10 text-center text-muted-foreground">
                  <Activity className="w-8 h-8 mx-auto mb-3" />
                  <p className="font-medium">
                    <T k="pageLabels.noKPIHistoryYet" />
                  </p>
                  <p className="text-sm">
                    <T k="pageLabels.kPIsWillAppearAfterFinancialActivityIsRecorded" />
                  </p>
                </CardContent>
              </Card>
            )}
            {kpiRows.map((kpi, idx) => {
              const isPositiveTrend =
                kpi.type === "expense_ratio" || kpi.type === "dso"
                  ? kpi.trend === "down"
                  : kpi.trend === "up";
              const meetsOrExceedsBenchmark = kpi.benchmark
                ? kpi.type === "expense_ratio" || kpi.type === "dso"
                  ? kpi.value <= kpi.benchmark
                  : kpi.value >= kpi.benchmark
                : true;

              return (
                <Card key={idx} className="hover-elevate relative overflow-hidden">
                  <div
                    className={`absolute top-0 end-0 w-24 h-24 rounded-full blur-2xl opacity-20
                    ${isPositiveTrend ? "bg-success" : "bg-destructive"}`}
                  />
                  <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 gap-2">
                    <div>
                      <CardTitle className="text-sm font-medium">{kpi.label}</CardTitle>
                      {kpi.benchmark && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Benchmark: {kpi.benchmark}
                          {kpi.unit}
                        </p>
                      )}
                    </div>
                    {meetsOrExceedsBenchmark ? (
                      <Badge variant="secondary" className="bg-success-subtle text-success ">
                        <T k="pageLabels.onTrack" />
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-warning-subtle text-warning ">
                        <T k="pageLabels.belowTarget" />
                      </Badge>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end justify-between">
                      <div>
                        <p
                          className={`text-3xl font-bold ${isPositiveTrend ? "text-success " : "text-destructive "}`}
                        >
                          {kpi.value.toFixed(1)}
                          <span className="text-lg">{kpi.unit}</span>
                        </p>
                        <div className="flex items-center gap-1 mt-2">
                          {getTrendIcon(kpi.trend)}
                          <span
                            className={`text-xs font-medium ${isPositiveTrend ? "text-success " : "text-destructive "}`}
                          >
                            {Math.abs(kpi.changePercent).toFixed(1)}% vs last period
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* KPI Trends Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <T k="pageLabels.kPITrendsOverTime" />
              </CardTitle>
              <CardDescription>
                <T k="pageLabels.historicalPerformanceOfKeyFinancialIndicators" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] flex flex-col items-center justify-center text-center text-muted-foreground">
                <BarChart3 className="w-8 h-8 mb-3" />
                <p className="font-medium">
                  <T k="pageLabels.trendHistoryIsNotAvailableYet" />
                </p>
                <p className="text-sm">{t["advancedAnalytics.thisChartWillPopulateOnce"]}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Insights */}
        <TabsContent value="insights" className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {t["advancedAnalytics.ruleBasedInsightsComputedFrom"]}
            </p>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              <Sparkles className="w-3 h-3 me-1" />
              {insightRows.length} Active Insights
            </Badge>
          </div>

          <div className="grid gap-4">
            {insightsLoading &&
              Array.from({ length: 2 }).map((_, idx) => (
                <Skeleton key={idx} className="h-32 w-full" />
              ))}
            {!insightsLoading && insightRows.length === 0 && (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  <Brain className="w-8 h-8 mx-auto mb-3" />
                  <p className="font-medium">
                    <T k="pageLabels.noInsightsYet" />
                  </p>
                  <p className="text-sm">{t["advancedAnalytics.insightsWillAppearWhenReal"]}</p>
                </CardContent>
              </Card>
            )}
            {insightRows.map((insight) => {
              const priorityColors = {
                high: "border-destructive/30 bg-danger-subtle/50 ",
                medium: "border-warning/30 bg-warning-subtle/50 ",
                low: "border-info/30 bg-info-subtle/50 ",
              };

              return (
                <Card
                  key={insight.id}
                  className={`hover-elevate border-2 ${priorityColors[insight.priority]}`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        {getInsightIcon(insight.type)}
                        <div>
                          <CardTitle className="text-base">{insight.title}</CardTitle>
                          <CardDescription className="mt-1">{insight.description}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={insight.priority === "high" ? "destructive" : "secondary"}>
                        {insight.priority === "high"
                          ? t["advancedAnalytics.highPriority"]
                          : insight.priority === "medium"
                            ? "Medium"
                            : "Low"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium">{insight.impact}</span>
                      </div>
                      {insight.actionable && insight.action && (
                        <Button variant="outline" size="sm" className="gap-1">
                          {insight.action}
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Brain className="w-4 h-4 text-primary" />
                <T k="pageLabels.howInsightsAreComputed" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Insights are fixed rules over your posted ledger (profit margin, fiscal year to
                date) and the remaining balances of issued invoices. They use the same figures as
                the dashboard and the profit and loss report, and they make no benchmark claims.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
