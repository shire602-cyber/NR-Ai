import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { RankedBars } from "@/components/ui/ranked-bars";
import { chartTheme, ChartTooltipContent, formatAxisCompact } from "@/components/ui/chart-theme";
import { formatMonthKey } from "@/lib/format";
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
  CartesianGrid,
} from "recharts";
import { dashboardPeriodLabel } from "./period";
import type { DashboardModel } from "./useCustomerDashboardModel";

/** Chart height; the breakdown card beside it matches it (spec 3.6: no blank band). */
const CHART_HEIGHT = 320;

/** Direct end-of-line labels instead of a legend for two series (spec 2.7). */
function SeriesKey({
  items,
}: {
  items: Array<{ label: string; dashed?: boolean; color: string }>;
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-caption text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <svg width="16" height="2" aria-hidden className="shrink-0">
            <line
              x1="0"
              y1="1"
              x2="16"
              y2="1"
              stroke={item.color}
              strokeWidth="2"
              strokeDasharray={item.dashed ? "4 3" : undefined}
            />
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function DashboardCharts({ m }: { m: DashboardModel }) {
  const { t, locale, expenseData, expenseLoading, monthlyTrends, trendsLoading } = m;
  const tt = t as Record<string, string>;
  const trendPoints = monthlyTrends?.length ?? 0;
  const seriesLabel = (key: string) => (key === "revenue" ? t.revenue : t.expenses);

  return (
    // Fable P20: chart cards in one row share a height (spec 2.2 exception for charts).
    <section className="grid grid-cols-1 items-start gap-stack lg:grid-cols-3 lg:items-stretch">
      <Card className="lg:col-span-2" data-testid="dashboard-trends">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-x-6 gap-y-2 space-y-0 pb-4">
          <div className="min-w-0">
            <CardTitle>{tt["dashboard.trendsCardTitle"]}</CardTitle>
            <p className="text-caption text-muted-foreground">{t["dashboard.lastSixMonths"]}</p>
          </div>
          {trendPoints >= 2 && (
            <SeriesKey
              items={[
                { label: t.revenue, color: chartTheme.colors.brand },
                { label: t.expenses, color: chartTheme.colors.neutral, dashed: true },
              ]}
            />
          )}
        </CardHeader>
        <CardContent className="pt-2">
          {trendsLoading ? (
            <Skeleton className="w-full" style={{ height: CHART_HEIGHT }} />
          ) : trendPoints >= 2 ? (
            // Revenue is the brand area; expenses the neutral dashed comparison line.
            <div dir="ltr" style={{ height: CHART_HEIGHT }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyTrends} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...chartTheme.grid} />
                  <XAxis
                    dataKey="key"
                    reversed={locale === "ar"}
                    tickFormatter={(key: string) => formatMonthKey(key, locale)}
                    {...chartTheme.xAxis}
                  />
                  <YAxis
                    orientation={locale === "ar" ? "right" : "left"}
                    tickFormatter={formatAxisCompact}
                    {...chartTheme.yAxis}
                  />
                  <Tooltip
                    {...chartTheme.tooltip}
                    content={
                      <ChartTooltipContent
                        currency="AED"
                        seriesLabel={seriesLabel}
                        labelFormatter={(key) => formatMonthKey(String(key), locale)}
                      />
                    }
                  />
                  <Area
                    dataKey="revenue"
                    name={t.revenue}
                    {...chartTheme.area("brand")}
                    isAnimationActive={chartTheme.animate()}
                  />
                  <Area
                    dataKey="expenses"
                    name={t.expenses}
                    {...chartTheme.comparisonLine}
                    fill="none"
                    isAnimationActive={chartTheme.animate()}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState size="sm" title={tt["dashboard.chartNotEnoughData"]} />
          )}
        </CardContent>
      </Card>

      <Card data-testid="dashboard-expense-breakdown">
        <CardHeader className="pb-2">
          <CardTitle>{tt["dashboard.expenseBreakdownTitle"]}</CardTitle>
          {m.stats && (
            <p className="text-caption text-muted-foreground">
              {dashboardPeriodLabel(m.stats.period, locale)}
            </p>
          )}
        </CardHeader>
        <CardContent className="pt-2">
          {expenseLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            // Spec 2.7: no donut for money; a ranked list, one hue, top 5 + Other.
            <RankedBars
              aria-label={tt["dashboard.expenseBreakdownTitle"]}
              items={(expenseData ?? []).map((entry: any) => ({
                id: String(entry.name),
                label: (
                  <span dir="auto">
                    {locale === "ar" && entry.nameAr ? entry.nameAr : entry.name}
                  </span>
                ),
                value: Number(entry.value),
              }))}
              limit={5}
              currency="AED"
              otherLabel={tt["dashboard.expenseOther"]}
              emptyLabel={t["dashboard.emptyExpensesBody"]}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
