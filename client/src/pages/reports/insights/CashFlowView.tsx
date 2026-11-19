// Insights > Cash flow (spec 3.11): StatCards from the kernel cash-flow statement, the monthly
// cash position from the bucketed kernel, and an optional 90-day projection from the
// document-driven forecast (dashed continuation, 8% band). No figure is computed here.
import { EmptyState } from "@/components/ui/empty-state";
import { Wallet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Label } from "@/components/ui/label";
import { MoneyCell, Money } from "@/components/ui/money";
import { StatCard } from "@/components/ui/stat-card";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMonthYear } from "@/lib/format-date";
import { useTranslation } from "@/lib/i18n";
import {
  ChartCard,
  ControlsRow,
  ExportMenu,
  InsightsSkeleton,
  InsightsTooltip,
  PeriodSelect,
  SmallEmpty,
} from "./shared";
import { chartAnimates, compactAxisValue, insightsChart } from "./chartStyle";
import { trailingYearStart, type InsightsPeriod, periodWindow, todayIso } from "./model";

interface CashFlowStatement {
  openingCash: number;
  closingCash: number;
  netCashChange: number;
  operating: { total: number };
  investing: { total: number };
  financing: { total: number };
}

interface CashFlowBucket {
  period: string;
  from: string;
  to: string;
  operatingInflow: number;
  operatingOutflow: number;
  investingInflow: number;
  investingOutflow: number;
  financingInflow: number;
  financingOutflow: number;
  netCashFlow: number;
  endingBalance: number;
}

interface ForecastProjection {
  week: number;
  weekStart: string;
  weekEnd: string;
  projectedBalance: number;
}

interface ForecastResponse {
  currentBalance: number;
  projections: ForecastProjection[];
  insufficientData: boolean;
}

interface ChartPoint {
  key: string;
  balance?: number;
  projected?: number;
}

export default function CashFlowView({ companyId }: { companyId: string }) {
  const { t, locale } = useTranslation();
  const [period, setPeriod] = useState<InsightsPeriod>("quarter");
  const [showProjection, setShowProjection] = useState(false);
  const window = periodWindow(period);
  const historyFrom = useMemo(() => trailingYearStart(), []);
  const historyTo = todayIso();

  const statement = useQuery<CashFlowStatement>({
    queryKey: [`/api/companies/${companyId}/reports/cash-flow?from=${window.from}&to=${window.to}`],
  });
  const buckets = useQuery<CashFlowBucket[]>({
    queryKey: [`/api/reports/${companyId}/cash-flow/month?from=${historyFrom}&to=${historyTo}`],
  });
  const forecast = useQuery<ForecastResponse>({
    queryKey: [`/api/companies/${companyId}/cashflow/forecast?days=90&scenario=base`],
    enabled: showProjection,
  });

  // Months before the first cash movement add nothing (a flat zero line and rows of 0.00).
  const shownBuckets = useMemo(() => {
    const rows = buckets.data ?? [];
    const first = rows.findIndex(
      (b) =>
        b.endingBalance ||
        b.operatingInflow ||
        b.operatingOutflow ||
        b.investingInflow ||
        b.investingOutflow ||
        b.financingInflow ||
        b.financingOutflow
    );
    return first === -1 ? [] : rows.slice(first);
  }, [buckets.data]);

  const points = useMemo<ChartPoint[]>(() => {
    const actual: ChartPoint[] = shownBuckets.map((b) => ({
      key: b.to,
      balance: b.endingBalance,
    }));
    if (!showProjection || !forecast.data || forecast.data.insufficientData) return actual;
    const projected: ChartPoint[] = [
      { key: historyTo, projected: forecast.data.currentBalance },
      ...forecast.data.projections.map((p) => ({ key: p.weekEnd, projected: p.projectedBalance })),
    ];
    return [...actual, ...projected];
  }, [shownBuckets, forecast.data, showProjection, historyTo]);

  const seriesLabel = (key: string) =>
    key === "projected" ? t["analytics.cashProjected"] : t["analytics.cashPosition"];
  const exportRange = `from=${window.from}&to=${window.to}`;

  if (statement.isLoading && buckets.isLoading) return <InsightsSkeleton />;
  const s = statement.data;
  const actualCount = shownBuckets.length;
  // Spec 2.6: a company with no cash movement sees guidance, not a KPI row of zeros.
  const hasCashActivity =
    Boolean(s && (s.closingCash || s.operating.total || s.investing.total || s.financing.total)) ||
    (buckets.data ?? []).some((b) => b.endingBalance || b.netCashFlow);

  return (
    <div className="space-y-6" data-testid="insights-view-cash-flow">
      <ControlsRow
        start={
          <>
            <PeriodSelect value={period} onChange={setPeriod} />
            <div className="flex items-center gap-2">
              <Switch
                id="insights-projection"
                checked={showProjection}
                onCheckedChange={setShowProjection}
                data-testid="switch-insights-projection"
              />
              <Label htmlFor="insights-projection" className="text-small font-normal">
                {t["analytics.showProjection"]}
              </Label>
            </div>
          </>
        }
        end={
          <ExportMenu
            testId="button-insights-export-cash-flow"
            links={[
              {
                label: t["analytics.exportPdf"],
                format: "pdf",
                href: `/api/companies/${companyId}/reports/statements/cash-flow?format=pdf&lang=${locale}&${exportRange}`,
              },
              {
                label: t["analytics.exportExcel"],
                format: "xlsx",
                href: `/api/companies/${companyId}/reports/statements/cash-flow?format=xlsx&lang=${locale}&${exportRange}`,
              },
            ]}
          />
        }
      />

      {!hasCashActivity && !statement.isLoading && !buckets.isLoading ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={Wallet}
            title={t["analytics.noCashTitle"]}
            description={t["analytics.noCashBody"]}
            action={{ label: t["analytics.openBankAccounts"], href: "/bank-accounts" }}
            testId="insights-cash-empty"
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard
              label={t["analytics.operatingCash"]}
              value={<Money amount={s?.operating.total} />}
              hint={t["analytics.operatingCashHint"]}
              loading={statement.isLoading}
              testId="stat-insights-operating"
            />
            <StatCard
              label={t["analytics.investingCash"]}
              value={<Money amount={s?.investing.total} />}
              hint={t["analytics.investingCashHint"]}
              loading={statement.isLoading}
              testId="stat-insights-investing"
            />
            <StatCard
              label={t["analytics.financingCash"]}
              value={<Money amount={s?.financing.total} />}
              hint={t["analytics.financingCashHint"]}
              loading={statement.isLoading}
              testId="stat-insights-financing"
            />
            <StatCard
              label={t["analytics.closingCash"]}
              value={<Money amount={s?.closingCash} />}
              hint={s ? formatDate(window.to, locale) : undefined}
              loading={statement.isLoading}
              testId="stat-insights-closing-cash"
            />
          </div>

          <ChartCard
            title={t["analytics.cashPositionTitle"]}
            description={t["analytics.cashPositionHint"]}
            testId="insights-cash-chart"
          >
            {actualCount < 2 ? (
              <SmallEmpty text={t["analytics.notEnoughHistory"]} />
            ) : (
              <div className="h-64" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={insightsChart.grid} />
                    <XAxis
                      dataKey="key"
                      tickFormatter={(v: string) => formatMonthYear(v, locale)}
                      tick={insightsChart.axisTick}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={24}
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
                      content={
                        <InsightsTooltip
                          seriesLabel={seriesLabel}
                          labelFormatter={(v) => formatDate(v, locale)}
                        />
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="balance"
                      stroke={insightsChart.primary}
                      strokeWidth={1.5}
                      fill={insightsChart.primary}
                      fillOpacity={0.08}
                      dot={false}
                      activeDot={{ r: 3 }}
                      animationDuration={insightsChart.animationDuration}
                      isAnimationActive={chartAnimates()}
                      connectNulls
                    />
                    {showProjection ? (
                      <Area
                        type="monotone"
                        dataKey="projected"
                        stroke={insightsChart.primary}
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        fill={insightsChart.primary}
                        fillOpacity={0.08}
                        dot={false}
                        activeDot={{ r: 3 }}
                        animationDuration={insightsChart.animationDuration}
                        isAnimationActive={chartAnimates()}
                        connectNulls
                      />
                    ) : null}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
            {showProjection && forecast.data?.insufficientData ? (
              <p className="mt-3 text-small text-muted-foreground">
                {t["analytics.projectionUnavailable"]}
              </p>
            ) : null}
          </ChartCard>

          <ChartCard title={t["analytics.cashByMonth"]} testId="insights-cash-table">
            {actualCount === 0 ? (
              <SmallEmpty text={t["analytics.noCashMovement"]} />
            ) : (
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t["analytics.colPeriod"]}</TableHead>
                    <TableHead className="text-end">{t["analytics.colOperatingIn"]}</TableHead>
                    <TableHead className="text-end">{t["analytics.colOperatingOut"]}</TableHead>
                    <TableHead className="text-end">{t["analytics.colInvesting"]}</TableHead>
                    <TableHead className="text-end">{t["analytics.colFinancing"]}</TableHead>
                    <TableHead className="text-end">{t["analytics.colNet"]}</TableHead>
                    <TableHead className="text-end">{t["analytics.colClosing"]}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownBuckets.map((b) => (
                    <TableRow key={b.from}>
                      <TableCell className="whitespace-nowrap">
                        {formatMonthYear(b.from, locale)}
                      </TableCell>
                      <MoneyCell amount={b.operatingInflow} showCurrency={false} />
                      <MoneyCell amount={b.operatingOutflow} showCurrency={false} />
                      <InOutCell inflow={b.investingInflow} outflow={b.investingOutflow} />
                      <InOutCell inflow={b.financingInflow} outflow={b.financingOutflow} />
                      <MoneyCell amount={b.netCashFlow} showCurrency={false} tone="auto" />
                      <MoneyCell amount={b.endingBalance} showCurrency={false} />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ChartCard>
        </>
      )}
    </div>
  );
}

/** Investing / financing columns show the server's inflow and outflow, stacked (no netting). */
function InOutCell({ inflow, outflow }: { inflow: number; outflow: number }) {
  return (
    <TableCell data-numeric="" className="text-end">
      <span className="block">
        <Money amount={inflow} showCurrency={false} />
      </span>
      {outflow ? (
        <span className="block text-caption text-muted-foreground">
          <Money amount={-Math.abs(outflow)} showCurrency={false} />
        </span>
      ) : null}
    </TableCell>
  );
}
