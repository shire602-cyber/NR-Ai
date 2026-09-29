import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatCurrency } from "@/lib/format";
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
} from "lucide-react";
import { messages as pageMessages } from "./CashFlowForecast.i18n";

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
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [forecastDays, setForecastDays] = useState("90");

  const {
    data: forecast,
    isLoading: isLoadingForecast,
    refetch: refetchForecast,
    isFetching: isFetchingForecast,
  } = useQuery<ForecastData>({
    queryKey: [`/api/companies/${companyId}/cashflow/forecast?days=${forecastDays}`],
    enabled: !!companyId,
  });

  const { data: history, isLoading: isLoadingHistory } = useQuery<MonthlyCashHistory[]>({
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
            <p className="text-muted-foreground text-center">{tr("pleaseCreateACompanyFirstTo")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getInsightIcon = (insight: string) => {
    const lower = insight.toLowerCase();
    if (lower.includes("warning") || lower.includes("negative") || lower.includes("drop below")) {
      return <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />;
    }
    if (lower.includes("positive") || lower.includes("improve")) {
      return <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />;
    }
    return <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />;
  };

  const getInsightBadge = (insight: string) => {
    const lower = insight.toLowerCase();
    if (lower.includes("warning") || lower.includes("negative")) {
      return (
        <Badge variant="destructive" className="text-xs">
          {tr("risk")}
        </Badge>
      );
    }
    if (lower.includes("positive") || lower.includes("improve")) {
      return (
        <Badge className="bg-success-subtle text-success-subtle-foreground text-xs">
          {tr("positive")}
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="text-xs">
        {tr("info")}
      </Badge>
    );
  };

  // Calculate summary stats from projections
  const totalProjectedInflows =
    forecast?.projections.reduce((s, p) => s + p.expectedInflows, 0) || 0;
  const totalProjectedOutflows =
    forecast?.projections.reduce((s, p) => s + p.expectedOutflows, 0) || 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <TrendingUp className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{tr("cashFlowForecast")}</h1>
            <p className="text-muted-foreground text-sm">{tr("aiPoweredProjectionsBasedOnYour")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={forecastDays} onValueChange={setForecastDays}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">{tr("n30Days")}</SelectItem>
              <SelectItem value="60">{tr("n60Days")}</SelectItem>
              <SelectItem value="90">{tr("n90Days")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchForecast()}
            disabled={isFetchingForecast}
          >
            <RefreshCw className={`h-4 w-4 me-2 ${isFetchingForecast ? "animate-spin" : ""}`} />
            {tr("refresh")}
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
                {tr("currentBalance")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={`text-3xl font-bold ${forecast.currentBalance >= 0 ? "text-success" : "text-destructive"}`}
              >
                {formatCurrency(forecast.currentBalance, "AED", locale)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-success" />
                {tr("projectedInflowsD", { forecastDays })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-success">
                {formatCurrency(totalProjectedInflows, "AED", locale)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <ArrowDownRight className="h-4 w-4 text-destructive" />
                {tr("projectedOutflowsD", { forecastDays })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">
                {formatCurrency(totalProjectedOutflows, "AED", locale)}
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
              {tr("aiInsights")}
            </CardTitle>
            <CardDescription>{tr("keyObservationsAndRecommendationsFromYour")}</CardDescription>
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
            {tr("weeklyProjections")}
          </CardTitle>
          <CardDescription>
            {tr("projectedCashInflowsAndOutflowsFor", { forecastDays })}
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
                    <TableHead>{tr("week")}</TableHead>
                    <TableHead>{tr("period")}</TableHead>
                    <TableHead className="text-end">{tr("expectedIn")}</TableHead>
                    <TableHead className="text-end">{tr("expectedOut")}</TableHead>
                    <TableHead className="text-end">{tr("projectedBalance")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {forecast.projections.map((proj) => (
                    <TableRow key={proj.week}>
                      <TableCell className="font-medium">
                        {tr("week2", { week: proj.week })}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {proj.weekStart} - {proj.weekEnd}
                      </TableCell>
                      <TableCell className="text-end">
                        <span className="text-success flex items-center justify-end gap-1">
                          <TrendingUp className="h-3 w-3" />
                          {formatCurrency(proj.expectedInflows, "AED", locale)}
                        </span>
                      </TableCell>
                      <TableCell className="text-end">
                        <span className="text-destructive flex items-center justify-end gap-1">
                          <TrendingDown className="h-3 w-3" />
                          {formatCurrency(proj.expectedOutflows, "AED", locale)}
                        </span>
                      </TableCell>
                      <TableCell className="text-end">
                        <span
                          className={`font-semibold ${
                            proj.projectedBalance >= 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {formatCurrency(proj.projectedBalance, "AED", locale)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              {tr("noProjectionDataAvailableAddJournal")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Cash Flow History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            {tr("cashFlowHistoryLast6Months")}
          </CardTitle>
          <CardDescription>{tr("actualMonthlyCashInflowsAndOutflows")}</CardDescription>
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
                    <TableHead>{tr("month")}</TableHead>
                    <TableHead className="text-end">{tr("totalInflows")}</TableHead>
                    <TableHead className="text-end">{tr("totalOutflows")}</TableHead>
                    <TableHead className="text-end">{tr("netCashFlow")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={`${h.year}-${h.monthNum}`}>
                      <TableCell className="font-medium">
                        {h.month} {h.year}
                      </TableCell>
                      <TableCell className="text-end text-success">
                        {formatCurrency(h.totalInflows, "AED", locale)}
                      </TableCell>
                      <TableCell className="text-end text-destructive">
                        {formatCurrency(h.totalOutflows, "AED", locale)}
                      </TableCell>
                      <TableCell className="text-end">
                        <span
                          className={`font-semibold ${
                            h.netCashFlow >= 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {formatCurrency(h.netCashFlow, "AED", locale)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              {tr("noHistoricalDataAvailableYetPost")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
