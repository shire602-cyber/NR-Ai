import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/ui/money";
import { formatCurrency, formatMonthKey } from "@/lib/format";
import { BarChart3, Coins } from "lucide-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
  CartesianGrid,
  Legend,
} from "recharts";
import { CHART_COLORS, CHART_TOOLTIP_STYLE, PIE_PALETTE } from "./chart-colors";
import { SectionHeader } from "./Layout";
import { EmptyState } from "./EmptyState";
import type { DashboardModel } from "./useCustomerDashboardModel";

export function DashboardCharts({ m }: { m: DashboardModel }) {
  const { t, locale, expenseData, expenseLoading, monthlyTrends, trendsLoading } = m;
  return (
    <>
      {/* ── Charts row ───────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title={t["dashboard.trendsTitle"]}
          action={
            <span className="text-caption text-muted-foreground">
              {t["dashboard.lastSixMonths"]}
            </span>
          }
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardContent className="p-5 md:p-6">
              {trendsLoading ? (
                <Skeleton className="h-[224px] w-full" />
              ) : monthlyTrends && monthlyTrends.length > 0 ? (
                // Linear series (no overshoot on sparse months), 1.5px strokes, area fill
                // at most 8%, dashed horizontal gridlines only; revenue brand, expenses
                // neutral, amber stays reserved for warnings (CTO 6).
                <ResponsiveContainer width="100%" height={224}>
                  <AreaChart
                    data={monthlyTrends}
                    margin={
                      locale === "ar"
                        ? { top: 8, right: 8, bottom: 0, left: 8 }
                        : { top: 8, right: 8, bottom: 0, left: -12 }
                    }
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="hsl(var(--border))"
                      strokeDasharray="3 4"
                    />
                    <XAxis
                      dataKey="key"
                      reversed={locale === "ar"}
                      tickFormatter={(key: string) => formatMonthKey(key, locale)}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      orientation={locale === "ar" ? "right" : "left"}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      width={44}
                    />
                    <Tooltip
                      cursor={{
                        stroke: "hsl(var(--border))",
                        strokeWidth: 1,
                        strokeDasharray: "3 3",
                      }}
                      contentStyle={CHART_TOOLTIP_STYLE}
                      formatter={(value: any) => formatCurrency(value, "AED", locale)}
                      labelFormatter={(key: any) => formatMonthKey(String(key), locale)}
                    />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="plainline"
                      iconSize={14}
                      height={28}
                      wrapperStyle={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}
                    />
                    <Area
                      type="linear"
                      dataKey="revenue"
                      stroke={CHART_COLORS.accent}
                      strokeWidth={1.5}
                      fill={CHART_COLORS.accent}
                      fillOpacity={0.08}
                      dot={false}
                      activeDot={{ r: 3 }}
                      name={t.revenue}
                    />
                    <Area
                      type="linear"
                      dataKey="expenses"
                      stroke={CHART_COLORS.neutral}
                      strokeWidth={1.5}
                      fill={CHART_COLORS.neutral}
                      fillOpacity={0.05}
                      dot={false}
                      activeDot={{ r: 3 }}
                      name={t.expenses}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  icon={BarChart3}
                  title={t["dashboard.emptyRevenueTitle"]}
                  body={t["dashboard.emptyRevenueBody"]}
                  actionLabel={t["dashboard.emptyInvoicesAction"]}
                  actionHref="/invoices"
                />
              )}
            </CardContent>
          </Card>

          {/* Expense Breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>{t.expenseBreakdown}</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pt-0 md:px-4 md:pt-0">
              {expenseLoading ? (
                <Skeleton className="h-[240px] w-full" />
              ) : expenseData && expenseData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={168}>
                    <PieChart>
                      <Pie
                        data={expenseData}
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={76}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="hsl(var(--card))"
                        strokeWidth={2}
                      >
                        {expenseData.map((_, i) => (
                          <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(value: any) => formatCurrency(value, "AED", locale)}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <ul className="space-y-1.5 px-2 pb-3">
                    {expenseData.slice(0, 5).map((entry: any, i: number) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-small">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: PIE_PALETTE[i % PIE_PALETTE.length] }}
                          />
                          <span className="truncate text-muted-foreground" dir="auto">
                            {locale === "ar" && entry.nameAr ? entry.nameAr : entry.name}
                          </span>
                        </div>
                        <Money
                          amount={Number(entry.value)}
                          className="font-medium text-foreground"
                        />
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState
                  icon={Coins}
                  title={t["dashboard.emptyExpensesTitle"]}
                  body={t["dashboard.emptyExpensesBody"]}
                  actionLabel={t["dashboard.createJournalEntry"]}
                  actionHref="/journal"
                />
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}
