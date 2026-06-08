import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs,TabsContent,TabsList,TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';
import { apiRequest,queryClient } from '@/lib/queryClient';
import { useMutation,useQuery } from '@tanstack/react-query';
import {
Activity,
AlertTriangle,
ArrowDown,
ArrowUp,
BarChart3,
Brain,
Calendar,
ChevronRight,
DollarSign,
Loader2,
Minus,
PiggyBank,
RefreshCw,
Sparkles,
Target,
TrendingUp,
Wallet,
Zap
} from 'lucide-react';
import { useState } from 'react';
import { Area,AreaChart,Bar,CartesianGrid,ComposedChart,Legend,Line,ResponsiveContainer,Tooltip,XAxis,YAxis } from 'recharts';

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
  variance: number;
  variancePercent: number;
}

interface FinancialKPI {
  type: string;
  label: string;
  value: number;
  previousValue: number;
  changePercent: number;
  trend: 'up' | 'down' | 'stable';
  benchmark?: number;
  unit: string;
}

interface AIInsight {
  id: string;
  type: 'opportunity' | 'warning' | 'trend' | 'recommendation';
  title: string;
  description: string;
  impact: string;
  priority: 'high' | 'medium' | 'low';
  actionable: boolean;
  action?: string;
}

export default function AdvancedAnalytics() {
  const { t: _t, locale } = useTranslation();
  const isRTL = locale === 'ar';
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [forecastPeriod, setForecastPeriod] = useState('3months');
  const [budgetYear, setBudgetYear] = useState(new Date().getFullYear());
  const [budgetMonth, setBudgetMonth] = useState(new Date().getMonth() + 1);

  // Fetch forecasts
  const { data: forecasts, isLoading: forecastsLoading } = useQuery<CashFlowForecast[]>({
    queryKey: ['/api/analytics/forecasts', companyId, forecastPeriod],
    queryFn: () => {
      const params = new URLSearchParams({
        companyId: companyId ?? '',
        period: forecastPeriod,
      });
      return apiRequest('GET', `/api/analytics/forecasts?${params}`);
    },
    enabled: !!companyId,
  });

  // Fetch budget vs actual
  const { data: budgetData, isLoading: budgetLoading } = useQuery<BudgetVsActual[]>({
    queryKey: ['/api/analytics/budget-vs-actual', companyId, budgetYear, budgetMonth],
    queryFn: () => {
      const params = new URLSearchParams({
        companyId: companyId ?? '',
        year: String(budgetYear),
        month: String(budgetMonth),
      });
      return apiRequest('GET', `/api/analytics/budget-vs-actual?${params}`);
    },
    enabled: !!companyId,
  });

  // Fetch KPIs
  const { data: kpis, isLoading: kpisLoading } = useQuery<FinancialKPI[]>({
    queryKey: ['/api/analytics/kpis', companyId],
    queryFn: () => {
      const params = new URLSearchParams({ companyId: companyId ?? '' });
      return apiRequest('GET', `/api/analytics/kpis?${params}`);
    },
    enabled: !!companyId,
  });

  // Fetch AI insights
  const { data: insights, isLoading: insightsLoading } = useQuery<AIInsight[]>({
    queryKey: ['/api/analytics/insights', companyId],
    queryFn: () => {
      const params = new URLSearchParams({ companyId: companyId ?? '' });
      return apiRequest('GET', `/api/analytics/insights?${params}`);
    },
    enabled: !!companyId,
  });

  // Generate forecast mutation
  const generateForecastMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/analytics/generate-forecast', {
        companyId,
        period: forecastPeriod,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/analytics/forecasts', companyId, forecastPeriod] });
      toast({ title: 'Forecast Generated', description: 'AI has generated new cash flow predictions' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Error', description: error?.message || 'Failed to generate forecast' });
    },
  });

  const forecastRows = (forecasts ?? []).map((forecast) => ({
    month: new Date(forecast.forecastDate).toLocaleDateString('en-AE', { month: 'short' }),
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
    { inflow: 0, outflow: 0, balance: 0, confidence: 0 },
  );
  const averageForecastConfidence = hasForecastRows
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
    { budgeted: 0, actual: 0, variance: 0 },
  );

  const kpiRows = kpis ?? [];
  const insightRows = insights ?? [];

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up': return <ArrowUp className="w-4 h-4 text-green-600 dark:text-green-400" />;
      case 'down': return <ArrowDown className="w-4 h-4 text-red-600 dark:text-red-400" />;
      default: return <Minus className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'opportunity': return <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-400" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />;
      case 'trend': return <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />;
      case 'recommendation': return <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />;
      default: return <Brain className="w-5 h-5" />;
    }
  };

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="relative overflow-hidden rounded-lg bg-gradient-to-br from-blue-600/10 via-purple-600/5 to-transparent border border-blue-600/20 p-8">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-lg bg-blue-600/20">
              <BarChart3 className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-analytics-title">Advanced Analytics & Forecasts</h1>
              <p className="text-muted-foreground mt-1">
                AI-powered financial intelligence for strategic decision making
              </p>
            </div>
          </div>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/5 rounded-full -mr-32 -mt-32 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-purple-600/5 rounded-full -ml-24 -mb-24 blur-3xl" />
      </div>

      <Tabs defaultValue="forecasts" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-fit">
          <TabsTrigger value="forecasts" className="gap-2" data-testid="tab-forecasts">
            <TrendingUp className="w-4 h-4" />
            <span className="hidden sm:inline">Cash Flow</span>
          </TabsTrigger>
          <TabsTrigger value="budget" className="gap-2" data-testid="tab-budget">
            <Target className="w-4 h-4" />
            <span className="hidden sm:inline">Budget</span>
          </TabsTrigger>
          <TabsTrigger value="kpis" className="gap-2" data-testid="tab-kpis">
            <Activity className="w-4 h-4" />
            <span className="hidden sm:inline">KPIs</span>
          </TabsTrigger>
          <TabsTrigger value="insights" className="gap-2" data-testid="tab-insights">
            <Brain className="w-4 h-4" />
            <span className="hidden sm:inline">AI Insights</span>
          </TabsTrigger>
        </TabsList>

        {/* Cash Flow Forecasting */}
        <TabsContent value="forecasts" className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Select value={forecastPeriod} onValueChange={setForecastPeriod}>
                <SelectTrigger className="w-40" data-testid="select-forecast-period">
                  <SelectValue placeholder="Period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3months">3 Months</SelectItem>
                  <SelectItem value="6months">6 Months</SelectItem>
                  <SelectItem value="12months">12 Months</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => generateForecastMutation.mutate()}
              disabled={generateForecastMutation.isPending}
              data-testid="button-generate-forecast"
            >
              {generateForecastMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              Generate AI Forecast
            </Button>
          </div>

          {/* Forecast Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Projected Inflow</CardTitle>
                <ArrowUp className="w-4 h-4 text-green-600 dark:text-green-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono text-green-600 dark:text-green-400">
                  {formatCurrency(forecastSummary.inflow, 'AED')}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Next {forecastPeriod === '3months' ? '3' : forecastPeriod === '6months' ? '6' : '12'} months</p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Projected Outflow</CardTitle>
                <ArrowDown className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono text-blue-600 dark:text-blue-400">
                  {formatCurrency(forecastSummary.outflow, 'AED')}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Estimated expenses</p>
              </CardContent>
            </Card>

            <Card className="hover-elevate border-green-200 dark:border-green-900">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Net Cash Position</CardTitle>
                <Wallet className="w-4 h-4 text-green-600 dark:text-green-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono text-green-600 dark:text-green-400">
                  {formatCurrency(forecastSummary.balance, 'AED')}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Projected balance</p>
              </CardContent>
            </Card>
          </div>

          {/* Forecast Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cash Flow Forecast</CardTitle>
              <CardDescription>AI-predicted inflows and outflows with confidence bands</CardDescription>
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
                    <Tooltip formatter={(value) => formatCurrency(value as number, 'AED')} />
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
                      dot={{ fill: 'hsl(262, 83%, 58%)' }}
                      name="Net Balance"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[350px] flex flex-col items-center justify-center text-center text-muted-foreground">
                  <Calendar className="w-8 h-8 mb-3" />
                  <p className="font-medium">No forecast generated yet</p>
                  <p className="text-sm">Generate a forecast once invoices, receipts, or journals exist.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* AI Confidence */}
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Brain className="w-4 h-4 text-primary" />
                AI Forecast Confidence
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">
                  {hasForecastRows ? 'Based on generated forecast history' : 'Needs transaction history before confidence is meaningful'}
                </span>
                <span className="font-mono font-bold text-primary">{averageForecastConfidence}%</span>
              </div>
              <Progress value={averageForecastConfidence} className="h-2" />
              <p className="text-xs text-muted-foreground mt-2">
                Confidence increases with more transaction history. Empty demo data is not shown as a real forecast.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Budget vs Actual */}
        <TabsContent value="budget" className="space-y-6">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={budgetYear.toString()} onValueChange={(v) => setBudgetYear(parseInt(v))}>
              <SelectTrigger className="w-28" data-testid="select-budget-year">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2024">2024</SelectItem>
                <SelectItem value="2025">2025</SelectItem>
              </SelectContent>
            </Select>
            <Select value={budgetMonth.toString()} onValueChange={(v) => setBudgetMonth(parseInt(v))}>
              <SelectTrigger className="w-36" data-testid="select-budget-month">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                {months.map((m, i) => (
                  <SelectItem key={i + 1} value={(i + 1).toString()}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Budget Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Budgeted</CardTitle>
                <Target className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono">
                  {formatCurrency(budgetSummary.budgeted, 'AED')}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Planned for {months[budgetMonth - 1]} {budgetYear}</p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Total Actual</CardTitle>
                <DollarSign className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-mono">
                  {formatCurrency(budgetSummary.actual, 'AED')}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Recorded transactions</p>
              </CardContent>
            </Card>

            <Card className="hover-elevate border-green-200 dark:border-green-900">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                <CardTitle className="text-sm font-medium">Net Variance</CardTitle>
                <PiggyBank className="w-4 h-4 text-green-600 dark:text-green-400" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold font-mono ${budgetSummary.variance > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                  {formatCurrency(budgetSummary.variance, 'AED')}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {budgetSummary.variance > 0 ? 'Over budget' : 'Under or on budget'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Budget vs Actual Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Budget vs Actual Comparison</CardTitle>
              <CardDescription>Category-wise breakdown of planned vs actual spending</CardDescription>
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
                    <Tooltip formatter={(value) => formatCurrency(value as number, 'AED')} />
                    <Legend />
                    <Bar dataKey="budgeted" fill="hsl(var(--muted))" name="Budgeted" barSize={20} />
                    <Bar dataKey="actual" fill="hsl(var(--primary))" name="Actual" barSize={20} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[350px] flex flex-col items-center justify-center text-center text-muted-foreground">
                  <Target className="w-8 h-8 mb-3" />
                  <p className="font-medium">No budget data yet</p>
                  <p className="text-sm">Create budgets and post transactions to compare planned versus actual performance.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Variance Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Variance Analysis</CardTitle>
              <CardDescription>Detailed breakdown by category</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {budgetRows.length === 0 && !budgetLoading && (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No variance analysis is available yet.
                  </div>
                )}
                {budgetRows.map((item, idx) => {
                  const isOverBudget = item.variance > 0;
                  const variancePercent = item.budgeted > 0
                    ? Math.abs((item.variance / item.budgeted) * 100)
                    : 0;

                  return (
                    <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover-elevate">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-8 rounded-full ${isOverBudget ? 'bg-red-500' : item.variance === 0 ? 'bg-gray-400' : 'bg-green-500'}`} />
                        <div>
                          <p className="font-medium">{item.category}</p>
                          <p className="text-xs text-muted-foreground">
                            Budget: {formatCurrency(item.budgeted, 'AED')} | Actual: {formatCurrency(item.actual, 'AED')}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-mono font-bold ${isOverBudget ? 'text-red-600 dark:text-red-400' : item.variance === 0 ? 'text-muted-foreground' : 'text-green-600 dark:text-green-400'}`}>
                          {item.variance > 0 ? '+' : ''}{formatCurrency(item.variance, 'AED')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {variancePercent.toFixed(1)}% {isOverBudget ? 'over' : item.variance === 0 ? 'on target' : 'under'}
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
              Real-time financial indicators updated automatically
            </p>
            <Button variant="outline" size="sm" data-testid="button-refresh-kpis">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {kpisLoading && Array.from({ length: 3 }).map((_, idx) => (
              <Skeleton key={idx} className="h-40 w-full" />
            ))}
            {!kpisLoading && kpiRows.length === 0 && (
              <Card className="md:col-span-2 lg:col-span-3">
                <CardContent className="py-10 text-center text-muted-foreground">
                  <Activity className="w-8 h-8 mx-auto mb-3" />
                  <p className="font-medium">No KPI history yet</p>
                  <p className="text-sm">KPIs will appear after financial activity is recorded.</p>
                </CardContent>
              </Card>
            )}
            {kpiRows.map((kpi, idx) => {
              const isPositiveTrend = (kpi.type === 'expense_ratio' || kpi.type === 'dso')
                ? kpi.trend === 'down'
                : kpi.trend === 'up';
              const meetsOrExceedsBenchmark = kpi.benchmark
                ? (kpi.type === 'expense_ratio' || kpi.type === 'dso' ? kpi.value <= kpi.benchmark : kpi.value >= kpi.benchmark)
                : true;

              return (
                <Card key={idx} className="hover-elevate relative overflow-hidden">
                  <div className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl opacity-20
                    ${isPositiveTrend ? 'bg-green-500' : 'bg-red-500'}`} />
                  <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 gap-2">
                    <div>
                      <CardTitle className="text-sm font-medium">{kpi.label}</CardTitle>
                      {kpi.benchmark && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Benchmark: {kpi.benchmark}{kpi.unit}
                        </p>
                      )}
                    </div>
                    {meetsOrExceedsBenchmark ? (
                      <Badge variant="secondary" className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                        On Track
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                        Below Target
                      </Badge>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end justify-between">
                      <div>
                        <p className={`text-3xl font-bold ${isPositiveTrend ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {kpi.value.toFixed(1)}<span className="text-lg">{kpi.unit}</span>
                        </p>
                        <div className="flex items-center gap-1 mt-2">
                          {getTrendIcon(kpi.trend)}
                          <span className={`text-xs font-medium ${isPositiveTrend ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
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
              <CardTitle className="text-base">KPI Trends Over Time</CardTitle>
              <CardDescription>Historical performance of key financial indicators</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] flex flex-col items-center justify-center text-center text-muted-foreground">
                <BarChart3 className="w-8 h-8 mb-3" />
                <p className="font-medium">Trend history is not available yet</p>
                <p className="text-sm">This chart will populate once periodic KPI snapshots are recorded.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Insights */}
        <TabsContent value="insights" className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              AI-generated insights based on your financial data patterns
            </p>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              <Sparkles className="w-3 h-3 mr-1" />
              {insightRows.length} Active Insights
            </Badge>
          </div>

          <div className="grid gap-4">
            {insightsLoading && Array.from({ length: 2 }).map((_, idx) => (
              <Skeleton key={idx} className="h-32 w-full" />
            ))}
            {!insightsLoading && insightRows.length === 0 && (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  <Brain className="w-8 h-8 mx-auto mb-3" />
                  <p className="font-medium">No AI insights yet</p>
                  <p className="text-sm">Insights will appear when real invoices, expenses, and patterns exist.</p>
                </CardContent>
              </Card>
            )}
            {insightRows.map((insight) => {
              const priorityColors = {
                high: 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20',
                medium: 'border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20',
                low: 'border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20',
              };

              return (
                <Card key={insight.id} className={`hover-elevate border-2 ${priorityColors[insight.priority]}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        {getInsightIcon(insight.type)}
                        <div>
                          <CardTitle className="text-base">{insight.title}</CardTitle>
                          <CardDescription className="mt-1">{insight.description}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={insight.priority === 'high' ? 'destructive' : 'secondary'}>
                        {insight.priority === 'high' ? 'High Priority' : insight.priority === 'medium' ? 'Medium' : 'Low'}
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
                How AI Insights Work
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Our AI analyzes your transaction patterns, compares against industry benchmarks, and identifies opportunities and risks.
                Insights are updated daily as new data comes in. More transaction history improves accuracy.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
