// Insights > Period comparison (spec 3.11). One server call (kernel P&L with comparison plus
// invoice counts): the UI maps metric names to labels and draws current vs prior.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Money } from "@/components/ui/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateRange } from "@/lib/format-date";
import { formatPercentDelta } from "@/lib/format-money";
import { useTranslation } from "@/lib/i18n";
import {
  COMPARISON_METRIC_KEYS,
  COUNT_METRICS,
  type ComparisonMetric,
  comparisonDelta,
  type InsightsPeriod,
  periodWindow,
} from "./model";
import {
  ChartCard,
  ControlsRow,
  ExportMenu,
  InsightsSkeleton,
  InsightsTooltip,
  PeriodSelect,
  SmallEmpty,
} from "./shared";
import { compactAxisValue, insightsChart } from "./chartStyle";

interface ComparisonResponse {
  current: { from: string; to: string };
  previous: { from: string; to: string };
  metrics: ComparisonMetric[];
}

type CompareTo = "prior_period" | "prior_year";

export default function ComparisonView({ companyId }: { companyId: string }) {
  const { t, locale } = useTranslation();
  const [period, setPeriod] = useState<InsightsPeriod>("quarter");
  const [compareTo, setCompareTo] = useState<CompareTo>("prior_period");
  const window = periodWindow(period);
  const query = useQuery<ComparisonResponse>({
    queryKey: [
      `/api/companies/${companyId}/reports/comparison?from=${window.from}&to=${window.to}&compareTo=${compareTo}`,
    ],
  });
  if (query.isLoading) return <InsightsSkeleton />;

  const metrics = query.data?.metrics ?? [];
  const byName = new Map(metrics.map((m) => [m.metric, m]));
  const label = (name: string) => t[COMPARISON_METRIC_KEYS[name] ?? ""] ?? name;
  const previousRange = query.data
    ? formatDateRange(query.data.previous.from, query.data.previous.to, locale)
    : "";
  const context = previousRange ? `${t["analytics.versus"]} ${previousRange}` : "";
  const value = (name: string) => {
    const m = byName.get(name);
    if (!m) return "—";
    return COUNT_METRICS.has(name) ? (
      <span className="money">{m.current.toLocaleString("en-US")}</span>
    ) : (
      <Money amount={m.current} />
    );
  };
  const tile = (name: string, testId: string) => {
    const m = byName.get(name);
    return (
      <StatCard
        label={label(name)}
        value={value(name)}
        delta={m ? comparisonDelta(m, context) : undefined}
        hint={context}
        testId={testId}
      />
    );
  };
  const moneyMetrics = ["Total Revenue", "Total Expenses", "Net Profit"];
  const chartData = moneyMetrics
    .map((name) => byName.get(name))
    .filter((m): m is ComparisonMetric => Boolean(m))
    .map((m) => ({ metric: m.metric, current: m.current, previous: m.previous }));
  const hasActivity = chartData.some((row) => row.current !== 0 || row.previous !== 0);
  const seriesLabel = (key: string) =>
    key === "previous" ? t["analytics.previousPeriod"] : t["analytics.currentPeriod"];
  const range = `from=${window.from}&to=${window.to}`;

  return (
    <div className="space-y-6" data-testid="insights-view-comparison">
      <ControlsRow
        start={
          <>
            <PeriodSelect value={period} onChange={setPeriod} />
            <Select value={compareTo} onValueChange={(v) => setCompareTo(v as CompareTo)}>
              <SelectTrigger
                className="w-full sm:w-48"
                aria-label={t["analytics.compareWith"]}
                data-testid="select-insights-compare-to"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="prior_period">{t["analytics.comparePriorPeriod"]}</SelectItem>
                <SelectItem value="prior_year">{t["analytics.comparePriorYear"]}</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        end={
          <ExportMenu
            testId="button-insights-export-comparison"
            links={[
              {
                label: t["analytics.exportProfitLossPdf"],
                format: "pdf",
                href: `/api/companies/${companyId}/reports/statements/profit-loss?format=pdf&${range}`,
              },
              {
                label: t["analytics.exportProfitLossExcel"],
                format: "xlsx",
                href: `/api/companies/${companyId}/reports/statements/profit-loss?format=xlsx&${range}`,
              },
            ]}
          />
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {tile("Total Revenue", "stat-insights-revenue")}
        {tile("Total Expenses", "stat-insights-expenses")}
        {tile("Net Profit", "stat-insights-net-profit")}
        {tile("Invoice Count", "stat-insights-invoice-count")}
      </div>

      <ChartCard
        title={t["analytics.comparisonChartTitle"]}
        description={context}
        testId="insights-comparison-chart"
      >
        {!hasActivity ? (
          <SmallEmpty text={t["analytics.noActivityInPeriods"]} />
        ) : (
          <>
            <div className="h-64" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  barCategoryGap="40%"
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} stroke={insightsChart.grid} />
                  <XAxis
                    dataKey="metric"
                    tickFormatter={label}
                    tick={insightsChart.axisTick}
                    axisLine={false}
                    tickLine={false}
                    reversed={locale === "ar"}
                  />
                  <YAxis
                    tickFormatter={compactAxisValue}
                    tick={insightsChart.axisTick}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    orientation={locale === "ar" ? "right" : "left"}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                    content={<InsightsTooltip seriesLabel={seriesLabel} labelFormatter={label} />}
                  />
                  <Bar
                    dataKey="current"
                    fill={insightsChart.primary}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                    animationDuration={insightsChart.animationDuration}
                  />
                  <Bar
                    dataKey="previous"
                    fill={insightsChart.neutral}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                    animationDuration={insightsChart.animationDuration}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-3 flex flex-wrap gap-4 text-caption text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: insightsChart.primary }}
                />
                {t["analytics.currentPeriod"]}
              </li>
              <li className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: insightsChart.neutral }}
                />
                {t["analytics.previousPeriod"]}
              </li>
            </ul>
          </>
        )}
      </ChartCard>

      <ChartCard title={t["analytics.comparisonTableTitle"]} testId="insights-comparison-table">
        <Table density="compact">
          <TableHeader>
            <TableRow>
              <TableHead>{t["analytics.colMetric"]}</TableHead>
              <TableHead className="text-end">{t["analytics.currentPeriod"]}</TableHead>
              <TableHead className="text-end">{t["analytics.previousPeriod"]}</TableHead>
              <TableHead className="text-end">{t["analytics.colChange"]}</TableHead>
              <TableHead className="text-end">{t["analytics.colChangePercent"]}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metrics.map((m) => {
              const count = COUNT_METRICS.has(m.metric);
              const fig = (n: number, signed = false) =>
                count ? (
                  <span className="money">{n.toLocaleString("en-US")}</span>
                ) : (
                  <Money amount={n} showCurrency={false} signDisplay={signed ? "always" : "auto"} />
                );
              return (
                <TableRow key={m.metric}>
                  <TableCell className="font-medium">{label(m.metric)}</TableCell>
                  <TableCell data-numeric="" className="text-end">
                    {fig(m.current)}
                  </TableCell>
                  <TableCell data-numeric="" className="text-end text-muted-foreground">
                    {fig(m.previous)}
                  </TableCell>
                  <TableCell data-numeric="" className="text-end">
                    {fig(m.change, true)}
                  </TableCell>
                  <TableCell data-numeric="" className="text-end">
                    {m.previous ? (
                      <span className="money" dir="ltr">
                        {formatPercentDelta(m.changePercent)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ChartCard>
    </div>
  );
}
