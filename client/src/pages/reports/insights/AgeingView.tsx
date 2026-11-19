// Insights > Receivables and payables ageing (spec 3.11). Figures come from the settlement-based
// aged receivables / payables kernel (server/reporting/aging.ts), as of the chosen date.
import { EmptyState } from "@/components/ui/empty-state";
import { Scale } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "wouter";
import { DatePicker } from "@/components/ui/date-picker";
import { Money, MoneyCell } from "@/components/ui/money";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/lib/i18n";
import {
  ChartCard,
  ControlsRow,
  ExportMenu,
  InsightsSkeleton,
  InsightsTooltip,
  SeriesKey,
  SmallEmpty,
} from "./shared";
import { chartAnimates, compactAxisValue, insightsChart } from "./chartStyle";
import { todayIso } from "./model";

type Bucket = "current" | "days30" | "days60" | "days90" | "over90";
const BUCKETS: Bucket[] = ["current", "days30", "days60", "days90", "over90"];

interface AgingRow extends Record<Bucket, number> {
  id: string;
  name: string;
  total: number;
}

interface AgingReport {
  asOf: string;
  rows: AgingRow[];
  totals: Record<Bucket, number> & { total: number };
  documents: unknown[];
}

const TABLE_LIMIT = 10;

/** Settlement-based aged receivables / payables (reports.routes registers aged-${kind}). */
function agedReportUrl(companyId: string, kind: "receivables" | "payables", asOf: string) {
  return `/api/companies/${companyId}/reports/aged-${kind}?asOf=${asOf}`;
}

export default function AgeingView({ companyId }: { companyId: string }) {
  const { t, locale } = useTranslation();
  const [asOf, setAsOf] = useState(todayIso);
  const [side, setSide] = useState<"receivables" | "payables">("receivables");
  const receivables = useQuery<AgingReport>({
    queryKey: [agedReportUrl(companyId, "receivables", asOf)],
  });
  const payables = useQuery<AgingReport>({
    queryKey: [agedReportUrl(companyId, "payables", asOf)],
  });
  if (receivables.isLoading && payables.isLoading) return <InsightsSkeleton />;

  const bucketLabel: Record<Bucket, string> = {
    current: t["analytics.bucketCurrent"],
    days30: t["analytics.bucket30"],
    days60: t["analytics.bucket60"],
    days90: t["analytics.bucket90"],
    over90: t["analytics.bucketOver90"],
  };
  const ar = receivables.data?.totals;
  const ap = payables.data?.totals;
  const chartData = BUCKETS.map((bucket) => ({
    bucket,
    receivables: ar?.[bucket] ?? 0,
    payables: ap?.[bucket] ?? 0,
  }));
  const hasBalances = Boolean(ar?.total || ap?.total);
  const active = side === "receivables" ? receivables.data : payables.data;
  const rows = [...(active?.rows ?? [])].sort((a, b) => b.total - a.total).slice(0, TABLE_LIMIT);
  const seriesLabel = (key: string) =>
    key === "payables" ? t["analytics.payables"] : t["analytics.receivables"];
  const fullReportHref =
    side === "receivables" ? "/reports?report=ar-aging" : "/reports?report=ap-aging";

  return (
    <div className="space-y-6" data-testid="insights-view-ageing">
      <ControlsRow
        start={
          <div className="w-full sm:w-48">
            <DatePicker
              value={asOf}
              onChange={setAsOf}
              aria-label={t["analytics.asOf"]}
              data-testid="input-insights-as-of"
            />
          </div>
        }
        end={
          <ExportMenu
            testId="button-insights-export-ageing"
            links={[
              {
                label: t["analytics.exportReceivablesPdf"],
                format: "pdf",
                href: `/api/companies/${companyId}/reports/statements/ar-aging?format=pdf&lang=${locale}&to=${asOf}`,
              },
              {
                label: t["analytics.exportPayablesPdf"],
                format: "pdf",
                href: `/api/companies/${companyId}/reports/statements/ap-aging?format=pdf&lang=${locale}&to=${asOf}`,
              },
              {
                label: t["analytics.exportReceivablesExcel"],
                format: "xlsx",
                href: `/api/companies/${companyId}/reports/statements/ar-aging?format=xlsx&lang=${locale}&to=${asOf}`,
              },
              {
                label: t["analytics.exportPayablesExcel"],
                format: "xlsx",
                href: `/api/companies/${companyId}/reports/statements/ap-aging?format=xlsx&lang=${locale}&to=${asOf}`,
              },
            ]}
          />
        }
      />

      {!hasBalances && !receivables.isLoading && !payables.isLoading ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={Scale}
            title={t["analytics.nothingOpenTitle"]}
            description={t["analytics.nothingOpen"]}
            testId="insights-ageing-empty"
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard
              label={t["analytics.receivablesOpen"]}
              value={<Money amount={ar?.total} />}
              hint={t["analytics.receivablesOpenHint"]}
              loading={receivables.isLoading}
              testId="stat-insights-receivables"
            />
            <StatCard
              label={t["analytics.receivablesOver90"]}
              value={<Money amount={ar?.over90} />}
              hint={t["analytics.over90Hint"]}
              loading={receivables.isLoading}
              testId="stat-insights-receivables-90"
            />
            <StatCard
              label={t["analytics.payablesOpen"]}
              value={<Money amount={ap?.total} />}
              hint={t["analytics.payablesOpenHint"]}
              loading={payables.isLoading}
              testId="stat-insights-payables"
            />
            <StatCard
              label={t["analytics.payablesOver90"]}
              value={<Money amount={ap?.over90} />}
              hint={t["analytics.over90Hint"]}
              loading={payables.isLoading}
              testId="stat-insights-payables-90"
            />
          </div>

          <ChartCard
            title={t["analytics.ageingByBucket"]}
            description={t["analytics.ageingByBucketHint"]}
            testId="insights-ageing-chart"
            action={
              <SeriesKey
                items={[
                  { label: t["analytics.receivables"], color: insightsChart.primary },
                  { label: t["analytics.payables"], color: insightsChart.neutral },
                ]}
              />
            }
          >
            {!hasBalances ? (
              <SmallEmpty text={t["analytics.nothingOpen"]} />
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
                        dataKey="bucket"
                        tickFormatter={(b: Bucket) => bucketLabel[b]}
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
                        content={
                          <InsightsTooltip
                            seriesLabel={seriesLabel}
                            labelFormatter={(b) => bucketLabel[b as Bucket] ?? b}
                          />
                        }
                      />
                      <Bar
                        dataKey="receivables"
                        fill={insightsChart.primary}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                        animationDuration={insightsChart.animationDuration}
                        isAnimationActive={chartAnimates()}
                      />
                      <Bar
                        dataKey="payables"
                        fill={insightsChart.neutral}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                        animationDuration={insightsChart.animationDuration}
                        isAnimationActive={chartAnimates()}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </ChartCard>

          <ChartCard
            title={
              side === "receivables" ? t["analytics.topCustomers"] : t["analytics.topSuppliers"]
            }
            action={
              <Tabs value={side} onValueChange={(v) => setSide(v as typeof side)}>
                <TabsList>
                  <TabsTrigger value="receivables" data-testid="tab-insights-receivables">
                    {t["analytics.receivables"]}
                  </TabsTrigger>
                  <TabsTrigger value="payables" data-testid="tab-insights-payables">
                    {t["analytics.payables"]}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            }
            testId="insights-ageing-table"
          >
            {rows.length === 0 ? (
              <SmallEmpty text={t["analytics.nothingOpenSide"]} />
            ) : (
              <>
                <Table density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t["analytics.colName"]}</TableHead>
                      {BUCKETS.map((b) => (
                        <TableHead key={b} className="text-end">
                          {bucketLabel[b]}
                        </TableHead>
                      ))}
                      <TableHead className="text-end">{t["analytics.colTotal"]}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="max-w-[16rem] truncate font-medium">
                          {row.name}
                        </TableCell>
                        {BUCKETS.map((b) => (
                          <MoneyCell key={b} amount={row[b]} showCurrency={false} />
                        ))}
                        <MoneyCell
                          amount={row.total}
                          showCurrency={false}
                          className="font-medium"
                        />
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Link
                  href={fullReportHref}
                  className="mt-3 inline-block text-small font-medium text-accent hover:underline"
                  data-testid="link-insights-full-ageing"
                >
                  {t["analytics.openFullReport"]}
                </Link>
              </>
            )}
          </ChartCard>
        </>
      )}
    </div>
  );
}
