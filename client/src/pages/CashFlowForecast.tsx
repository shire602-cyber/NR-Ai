import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency } from '@/lib/format';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Info,
  RefreshCw,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
} from 'lucide-react';

interface WeeklyProjection {
  week: number;
  weekStart: string;
  weekEnd: string;
  expectedInflows: number;
  expectedOutflows: number;
  projectedBalance: number;
}

interface ForecastData {
  currentBalance: number;
  projections: WeeklyProjection[];
  insights: string[];
}

interface MonthlyCashHistory {
  month: string;
  year: number;
  monthNum: number;
  totalInflows: number;
  totalOutflows: number;
  netCashFlow: number;
}

export default function CashFlowForecast() {
  const { t, locale } = useTranslation();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [forecastDays, setForecastDays] = useState('90');

  const {
    data: forecast,
    isLoading: isLoadingForecast,
    refetch: refetchForecast,
    isFetching: isFetchingForecast,
  } = useQuery<ForecastData>({
    queryKey: [`/api/companies/${companyId}/cashflow/forecast?days=${forecastDays}`],
    enabled: !!companyId,
  });

  const {
    data: history,
    isLoading: isLoadingHistory,
  } = useQuery<MonthlyCashHistory[]>({
    queryKey: [`/api/companies/${companyId}/cashflow/history?months=6`],
    enabled: !!companyId,
  });

  if (isLoadingCompany) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              Please create a company first to use cash flow forecasting.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getInsightIcon = (insight: string) => {
    const lower = insight.toLowerCase();
    if (lower.includes('warning') || lower.includes('negative') || lower.includes('drop below')) {
      return <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />;
    }
    if (lower.includes('positive') || lower.includes('improve')) {
      return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />;
    }
    return <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />;
  };

  const getInsightBadge = (insight: string) => {
    const lower = insight.toLowerCase();
    if (lower.includes('warning') || lower.includes('negative')) {
      return <Badge variant="destructive" className="text-xs">Risk</Badge>;
    }
    if (lower.includes('positive') || lower.includes('improve')) {
      return <Badge className="bg-green-100 text-green-800 text-xs">Positive</Badge>;
    }
    return <Badge variant="secondary" className="text-xs">Info</Badge>;
  };

  // Calculate summary stats from projections
  const totalProjectedInflows = forecast?.projections.reduce((s, p) => s + p.expectedInflows, 0) || 0;
  const totalProjectedOutflows = forecast?.projections.reduce((s, p) => s + p.expectedOutflows, 0) || 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <TrendingUp className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cash Flow Forecast</h1>
            <p className="text-muted-foreground text-sm">
              AI-powered projections based on your financial history
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={forecastDays} onValueChange={setForecastDays}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 Days</SelectItem>
              <SelectItem value="60">60 Days</SelectItem>
              <SelectItem value="90">90 Days</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchForecast()}
            disabled={isFetchingForecast}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetchingForecast ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Current Balance + Summary Cards */}
      {isLoadingForecast ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : forecast ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-2 border-primary/20">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                Current Balance
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${forecast.currentBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(forecast.currentBalance, 'AED', locale)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-green-500" />
                Projected Inflows ({forecastDays}d)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {formatCurrency(totalProjectedInflows, 'AED', locale)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <ArrowDownRight className="h-4 w-4 text-red-500" />
                Projected Outflows ({forecastDays}d)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {formatCurrency(totalProjectedOutflows, 'AED', locale)}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* AI Insights */}
      {forecast && forecast.insights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              AI Insights
            </CardTitle>
            <CardDescription>
              Key observations and recommendations from your financial data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {forecast.insights.map((insight, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border"
                >
                  {getInsightIcon(insight)}
                  <span className="text-sm flex-1">{insight}</span>
                  {getInsightBadge(insight)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Projection Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Weekly Projections
          </CardTitle>
          <CardDescription>
            Projected cash inflows and outflows for the next {forecastDays} days
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingForecast ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : forecast && forecast.projections.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Week</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Expected In</TableHead>
                    <TableHead className="text-right">Expected Out</TableHead>
                    <TableHead className="text-right">Projected Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {forecast.projections.map((proj) => (
                    <TableRow key={proj.week}>
                      <TableCell className="font-medium">Week {proj.week}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {proj.weekStart} - {proj.weekEnd}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-green-600 flex items-center justify-end gap-1">
                          <TrendingUp className="h-3 w-3" />
                          {formatCurrency(proj.expectedInflows, 'AED', locale)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-red-600 flex items-center justify-end gap-1">
                          <TrendingDown className="h-3 w-3" />
                          {formatCurrency(proj.expectedOutflows, 'AED', locale)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`font-semibold ${
                            proj.projectedBalance >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {formatCurrency(proj.projectedBalance, 'AED', locale)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No projection data available. Add journal entries and invoices to generate forecasts.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Cash Flow History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Cash Flow History (Last 6 Months)
          </CardTitle>
          <CardDescription>
            Actual monthly cash inflows and outflows from posted journal entries
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingHistory ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : history && history.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Total Inflows</TableHead>
                    <TableHead className="text-right">Total Outflows</TableHead>
                    <TableHead className="text-right">Net Cash Flow</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={`${h.year}-${h.monthNum}`}>
                      <TableCell className="font-medium">
                        {h.month} {h.year}
                      </TableCell>
                      <TableCell className="text-right text-green-600">
                        {formatCurrency(h.totalInflows, 'AED', locale)}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {formatCurrency(h.totalOutflows, 'AED', locale)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`font-semibold ${
                            h.netCashFlow >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {formatCurrency(h.netCashFlow, 'AED', locale)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No historical data available yet. Post journal entries to build cash flow history.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
