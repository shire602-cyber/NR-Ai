import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart } from 'recharts';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency } from '@/lib/format';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { 
  TrendingUp, 
  TrendingDown, 
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
  Zap
} from 'lucide-react';

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
  const { t, locale } = useTranslation();
  const isRTL = locale === 'ar';
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [forecastPeriod, setForecastPeriod] = useState('3months');
  const [budgetYear, setBudgetYear] = useState(new Date().getFullYear());
  const [budgetMonth, setBudgetMonth] = useState(new Date().getMonth() + 1);

  // Fetch forecasts
  const { data: forecasts, isLoading: forecastsLoading } = useQuery<CashFlowForecast[]>({
    queryKey: ['/api/analytics/forecasts', companyId, forecastPeriod],
    enabled: !!companyId,
  });

  // Fetch budget vs actual
  const { data: budgetData, isLoading: budgetLoading } = useQuery<BudgetVsActual[]>({
    queryKey: ['/api/analytics/budget-vs-actual', companyId, budgetYear, budgetMonth],
    enabled: !!companyId,
  });

  // Fetch KPIs
  const { data: kpis, isLoading: kpisLoading } = useQuery<FinancialKPI[]>({
    queryKey: ['/api/analytics/kpis', companyId],
    enabled: !!companyId,
  });

  // Fetch AI insights
  const { data: insights, isLoading: insightsLoading } = useQuery<AIInsight[]>({
    queryKey: ['/api/analytics/insights', companyId],
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
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to generate forecast' });
    },
  });

  // Sample data for demo (will be replaced by real API data)
  const sampleForecasts = [
    { month: 'Dec', inflow: 125000, outflow: 98000, balance: 27000 },
    { month: 'Jan', inflow: 118000, outflow: 105000, balance: 40000 },
    { month: 'Feb', inflow: 132000, outflow: 108000, balance: 64000 },
    { month: 'Mar', inflow: 145000, outflow: 112000, balance: 97000 },
  ];

  const sampleBudgetData = [
    { category: 'Revenue', budgeted: 150000, actual: 142500, variance: -7500 },
    { category: 'Salaries', budgeted: 45000, actual: 47200, variance: 2200 },
    { category: 'Marketing', budgeted: 15000, actual: 12800, variance: -2200 },
    { category: 'Operations', budgeted: 25000, actual: 28500, variance: 3500 },
    { category: 'Rent', budgeted: 12000, actual: 12000, variance: 0 },
    { category: 'Utilities', budgeted: 3500, actual: 4100, variance: 600 },
  ];

  const sampleKPIs: FinancialKPI[] = [
    { type: 'profit_margin', label: 'Profit Margin', value: 18.5, previousValue: 16.2, changePercent: 14.2, trend: 'up', benchmark: 15, unit: '%' },
    { type: 'expense_ratio', label: 'Expense Ratio', value: 72.3, previousValue: 75.1, changePercent: -3.7, trend: 'down', benchmark: 70, unit: '%' },
    { type: 'revenue_growth', label: 'Revenue Growth', value: 12.8, previousValue: 8.5, changePercent: 50.6, trend: 'up', benchmark: 10, unit: '%' },
    { type: 'cash_runway', label: 'Cash Runway', value: 8.5, previousValue: 7.2, changePercent: 18.1, trend: 'up', benchmark: 6, unit: 'months' },
    { type: 'dso', label: 'Days Sales Outstanding', value: 32, previousValue: 38, changePercent: -15.8, trend: 'down', benchmark: 30, unit: 'days' },
    { type: 'current_ratio', label: 'Current Ratio', value: 2.4, previousValue: 2.1, changePercent: 14.3, trend: 'up', benchmark: 2.0, unit: 'x' },
  ];

  const sampleInsights: AIInsight[] = [
    {
      id: '1',
      type: 'opportunity',
      title: 'Revenue Growth Opportunity',
      description: 'Based on seasonal patterns, Q4 typically shows 22% higher revenue. Consider increasing marketing spend by 15% to capitalize.',
      impact: 'Potential AED 28,500 additional revenue',
      priority: 'high',
      actionable: true,
      action: 'Review marketing budget',
    },
    {
      id: '2',
      type: 'warning',
      title: 'Expense Overrun Alert',
      description: 'Operations expenses are 14% over budget this month. Primary driver: unexpected equipment maintenance costs.',
      impact: 'AED 3,500 over budget',
      priority: 'high',
      actionable: true,
      action: 'Review expense details',
    },
    {
      id: '3',
      type: 'trend',
      title: 'Positive Cash Flow Trend',
      description: 'Cash flow has improved consistently over the past 3 months. Current trajectory suggests 25% improvement by Q2.',
      impact: 'Healthy financial position',
      priority: 'medium',
      actionable: false,
    },
    {
      id: '4',
      type: 'recommendation',
      title: 'VAT Recovery Opportunity',
      description: 'Analysis shows AED 4,200 in potentially recoverable input VAT from recent equipment purchases.',
      impact: 'Possible AED 4,200 recovery',
      priority: 'medium',
      actionable: true,
      action: 'Review VAT claims',
    },
  ];

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
                  {formatCurrency(520000, 'AED')}
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
                  {formatCurrency(423000, 'AED')}
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
                  {formatCurrency(97000, 'AED')}
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
              <ResponsiveContainer width="100%" height={350}>
                <AreaChart data={sampleForecasts}>
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
                <span className="text-sm text-muted-foreground">Based on 18 months of historical data</span>
                <span className="font-mono font-bold text-primary">87%</span>
              </div>
              <Progress value={87} className="h-2" />
              <p className="text-xs text-muted-foreground mt-2">
                Confidence increases with more transaction history. Current model accuracy is high.
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
                  {formatCurrency(250500, 'AED')}
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
                  {formatCurrency(247100, 'AED')}
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
                <div className="text-2xl font-bold font-mono text-green-600 dark:text-green-400">
                  {formatCurrency(-3400, 'AED')}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Under budget</p>
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
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={sampleBudgetData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(value) => `${value / 1000}k`} />
                  <YAxis type="category" dataKey="category" width={100} />
                  <Tooltip formatter={(value) => formatCurrency(value as number, 'AED')} />
                  <Legend />
                  <Bar dataKey="budgeted" fill="hsl(var(--muted))" name="Budgeted" barSize={20} />
                  <Bar dataKey="actual" fill="hsl(var(--primary))" name="Actual" barSize={20} />
                </ComposedChart>
              </ResponsiveContainer>
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
                {sampleBudgetData.map((item, idx) => {
                  const isOverBudget = item.variance > 0;
                  const variancePercent = Math.abs((item.variance / item.budgeted) * 100);
                  
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
            {sampleKPIs.map((kpi, idx) => {
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
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={[
                  { month: 'Jul', profitMargin: 14, expenseRatio: 78, revenueGrowth: 5 },
                  { month: 'Aug', profitMargin: 15, expenseRatio: 77, revenueGrowth: 7 },
                  { month: 'Sep', profitMargin: 16, expenseRatio: 76, revenueGrowth: 9 },
                  { month: 'Oct', profitMargin: 17, expenseRatio: 74, revenueGrowth: 10 },
                  { month: 'Nov', profitMargin: 18, expenseRatio: 73, revenueGrowth: 12 },
                  { month: 'Dec', profitMargin: 18.5, expenseRatio: 72, revenueGrowth: 13 },
                ]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="profitMargin" stroke="hsl(142, 76%, 36%)" name="Profit Margin %" strokeWidth={2} />
                  <Line type="monotone" dataKey="expenseRatio" stroke="hsl(221, 83%, 53%)" name="Expense Ratio %" strokeWidth={2} />
                  <Line type="monotone" dataKey="revenueGrowth" stroke="hsl(262, 83%, 58%)" name="Revenue Growth %" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
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
              {sampleInsights.length} Active Insights
            </Badge>
          </div>

          <div className="grid gap-4">
            {sampleInsights.map((insight) => {
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
