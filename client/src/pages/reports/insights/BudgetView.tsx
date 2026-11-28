// Insights > Budget vs actual (spec 3.11). Lines come from the approved-budget variance service
// (server/services/budget-variance.service.ts); headline totals from the kernel P&L compared
// with the same budget. The UI never adds amounts up.
import { useQuery } from "@tanstack/react-query";
import { PiggyBank } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/ui/empty-state";
import { Money, MoneyCell } from "@/components/ui/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
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
import { formatMessage, useTranslation } from "@/lib/i18n";
import { type ComparisonMetric, comparisonDelta } from "./model";
import {
  ChartCard,
  ControlsRow,
  InsightsLoadError,
  InsightsSkeleton,
  InsightsStaleNotice,
  InsightsTooltip,
  SeriesKey,
} from "./shared";
import { chartAnimates, compactAxisValue, insightsChart } from "./chartStyle";

interface BudgetActualRow {
  budgetId: string;
  lineId: string;
  accountName: string;
  accountNameAr: string | null;
  category: string;
  budgeted: number;
  actual: number;
  variance: number;
  variancePercent: number;
  favourable: boolean;
}

interface BudgetVariance {
  budget: { id: string; name: string; startDate: string; endDate: string };
}

interface ComparisonResponse {
  metrics: ComparisonMetric[];
}

const CHART_LINES = 6;

export default function BudgetView({ companyId }: { companyId: string }) {
  const { t, locale } = useTranslation();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const rows = useQuery<BudgetActualRow[]>({
    queryKey: [`/api/analytics/budget-vs-actual?companyId=${companyId}&year=${year}&month=all`],
  });
  const budgetId = rows.data?.[0]?.budgetId;
  const plan = useQuery<BudgetVariance>({
    queryKey: [`/api/budget-plans/${budgetId}/variance`],
    enabled: Boolean(budgetId),
  });
  const span = plan.data?.budget;
  const comparison = useQuery<ComparisonResponse>({
    queryKey: [
      `/api/companies/${companyId}/reports/comparison?from=${span?.startDate}&to=${span?.endDate}&compareTo=budget&budgetId=${budgetId}`,
    ],
    enabled: Boolean(budgetId && span),
  });

  const yearSelect = (
    <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
      <SelectTrigger
        className="w-full sm:w-44"
        aria-label={t["analytics.budgetYear"]}
        data-testid="select-insights-budget-year"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[thisYear, thisYear - 1].map((y) => (
          <SelectItem key={y} value={String(y)}>
            {formatMessage(t["analytics.fiscalYear"], { year: y })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (rows.isLoading) return <InsightsSkeleton />;
  if (rows.isLoadingError) {
    return (
      <div className="space-y-6" data-testid="insights-view-budget">
        <ControlsRow start={yearSelect} />
        <InsightsLoadError queries={[rows]} />
      </div>
    );
  }
  const lines = rows.data ?? [];
  if (lines.length === 0) {
    return (
      <div className="space-y-6" data-testid="insights-view-budget">
        <ControlsRow start={yearSelect} />
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={PiggyBank}
            title={t["analytics.noBudgetTitle"]}
            description={t["analytics.noBudgetBody"]}
            action={{
              label: t["analytics.openBudgets"],
              href: "/budgets",
              testId: "button-insights-open-budgets",
            }}
            testId="insights-budget-empty"
          />
        </div>
      </div>
    );
  }

  const metrics = new Map((comparison.data?.metrics ?? []).map((m) => [m.metric, m]));
  const context = span
    ? `${t["analytics.versusBudget"]} · ${formatDateRange(span.startDate, span.endDate, locale)}`
    : t["analytics.versusBudget"];
  const tile = (name: string, labelKey: string, testId: string) => {
    const m = metrics.get(name);
    return (
      <StatCard
        label={t[labelKey]}
        value={<Money amount={m?.current} />}
        delta={m ? comparisonDelta(m, context) : undefined}
        hint={
          m ? (
            <>
              {t["analytics.budgetLabel"]} <Money amount={m.previous} />
            </>
          ) : undefined
        }
        loading={comparison.isLoading || plan.isLoading}
        testId={testId}
      />
    );
  };
  const overBudget = lines.filter((l) => !l.favourable).length;
  const accountLabel = (row: BudgetActualRow) =>
    locale === "ar" && row.accountNameAr ? row.accountNameAr : row.accountName;
  const chartRows = [...lines]
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    .slice(0, CHART_LINES)
    .map((row) => ({ name: accountLabel(row), budget: row.budgeted, actual: row.actual }));
  const seriesLabel = (key: string) =>
    key === "budget" ? t["analytics.budgetLabel"] : t["analytics.actualLabel"];

  return (
    <div className="space-y-6" data-testid="insights-view-budget">
      <ControlsRow
        start={
          <>
            {yearSelect}
            {span ? <span className="text-small text-muted-foreground">{span.name}</span> : null}
          </>
        }
      />

      <InsightsStaleNotice queries={[rows, plan, comparison]} />
      {plan.isLoadingError || comparison.isLoadingError ? (
        <InsightsLoadError queries={[plan, comparison]} testId="insights-budget-detail-error" />
      ) : null}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {tile("Total Revenue", "analytics.metricRevenue", "stat-insights-budget-revenue")}
        {tile("Total Expenses", "analytics.metricExpenses", "stat-insights-budget-expenses")}
        {tile("Net Profit", "analytics.metricNetProfit", "stat-insights-budget-net-profit")}
        <StatCard
          label={t["analytics.linesOverBudget"]}
          value={<span className="money">{overBudget.toLocaleString("en-US")}</span>}
          hint={formatMessage(t["analytics.ofLines"], { n: lines.length })}
          testId="stat-insights-over-budget"
        />
      </div>

      <ChartCard
        title={t["analytics.largestVariances"]}
        description={t["analytics.largestVariancesHint"]}
        testId="insights-budget-chart"
        action={
          <SeriesKey
            items={[
              { label: t["analytics.actualLabel"], color: insightsChart.primary },
              { label: t["analytics.budgetLabel"], color: insightsChart.neutral },
            ]}
          />
        }
      >
        <div dir="ltr" style={{ height: Math.max(160, chartRows.length * 44 + 48) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartRows}
              layout="vertical"
              barCategoryGap="40%"
              margin={{ top: 0, right: 8, left: 8, bottom: 0 }}
            >
              <CartesianGrid horizontal={false} stroke={insightsChart.grid} />
              <XAxis
                type="number"
                tickFormatter={compactAxisValue}
                tick={insightsChart.axisTick}
                axisLine={false}
                tickLine={false}
                reversed={locale === "ar"}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={132}
                tick={insightsChart.axisTick}
                axisLine={false}
                tickLine={false}
                orientation={locale === "ar" ? "right" : "left"}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                content={<InsightsTooltip seriesLabel={seriesLabel} />}
              />
              <Bar
                dataKey="actual"
                fill={insightsChart.primary}
                radius={[0, 4, 4, 0]}
                maxBarSize={14}
                animationDuration={insightsChart.animationDuration}
                isAnimationActive={chartAnimates()}
              />
              <Bar
                dataKey="budget"
                fill={insightsChart.neutral}
                radius={[0, 4, 4, 0]}
                maxBarSize={14}
                animationDuration={insightsChart.animationDuration}
                isAnimationActive={chartAnimates()}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title={t["analytics.budgetLines"]} testId="insights-budget-table">
        <Table density="compact">
          <TableHeader>
            <TableRow>
              <TableHead>{t["analytics.colAccount"]}</TableHead>
              <TableHead className="text-end">{t["analytics.budgetLabel"]}</TableHead>
              <TableHead className="text-end">{t["analytics.actualLabel"]}</TableHead>
              <TableHead className="text-end">{t["analytics.colVariance"]}</TableHead>
              <TableHead className="text-end">{t["analytics.colChangePercent"]}</TableHead>
              <TableHead>{t["analytics.colStatus"]}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((row) => (
              <TableRow key={row.lineId}>
                <TableCell className="max-w-[16rem] truncate font-medium">
                  {accountLabel(row)}
                </TableCell>
                <MoneyCell amount={row.budgeted} showCurrency={false} />
                <MoneyCell amount={row.actual} showCurrency={false} />
                <MoneyCell amount={row.variance} showCurrency={false} signDisplay="always" />
                <TableCell data-numeric="" className="text-end">
                  <span className="money" dir="ltr">
                    {formatPercentDelta(row.variancePercent)}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusBadge tone={row.favourable ? "success" : "danger"}>
                    {row.favourable ? t["analytics.onTrack"] : t["analytics.overBudget"]}
                  </StatusBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ChartCard>
    </div>
  );
}
