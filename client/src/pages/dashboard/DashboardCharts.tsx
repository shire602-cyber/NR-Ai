import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
} from "recharts";
import { CHART_COLORS, PIE_PALETTE } from "./chart-colors";
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
          eyebrow={t["dashboard.trendsEyebrow"]}
          title={t["dashboard.trendsTitle"]}
          action={
            <Badge variant="outline" className="font-mono">
              {t["dashboard.lastSixMonths"]}
            </Badge>
          }
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 border-card-border">
            <CardContent className="p-5">
              {trendsLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : monthlyTrends && monthlyTrends.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart
                    data={monthlyTrends}
                    margin={{ top: 12, right: 8, bottom: 0, left: -16 }}
                  >
                    <defs>
                      <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_COLORS.accent} stopOpacity={0.32} />
                        <stop offset="100%" stopColor={CHART_COLORS.accent} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_COLORS.warning} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={CHART_COLORS.warning} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="key"
                      tickFormatter={(key: string) => formatMonthKey(key, locale)}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontFamily: "var(--font-mono)" }}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      tick={{ fontFamily: "var(--font-mono)" }}
                    />
                    <Tooltip
                      cursor={{
                        stroke: "hsl(var(--border))",
                        strokeWidth: 1,
                        strokeDasharray: "3 3",
                      }}
                      contentStyle={{
                        backgroundColor: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--popover-border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontFamily: "var(--font-mono)",
                        boxShadow: "var(--shadow-md)",
                      }}
                      formatter={(value: any) => formatCurrency(value, "AED", locale)}
                      labelFormatter={(key: any) => formatMonthKey(String(key), locale)}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke={CHART_COLORS.accent}
                      strokeWidth={2}
                      fill="url(#rev)"
                      name={t.revenue}
                    />
                    <Area
                      type="monotone"
                      dataKey="expenses"
                      stroke={CHART_COLORS.warning}
                      strokeWidth={2}
                      fill="url(#exp)"
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
          <Card className="border-card-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px] font-semibold tracking-tight text-muted-foreground uppercase tracking-[0.12em]">
                {t.expenseBreakdown}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-3">
              {expenseLoading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : expenseData && expenseData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={expenseData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
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
                        contentStyle={{
                          backgroundColor: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--popover-border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontFamily: "var(--font-mono)",
                          boxShadow: "var(--shadow-md)",
                        }}
                        formatter={(value: any) => formatCurrency(value, "AED", locale)}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <ul className="px-2 pb-3 space-y-1.5">
                    {expenseData.slice(0, 5).map((entry: any, i: number) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-[12px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: PIE_PALETTE[i % PIE_PALETTE.length] }}
                          />
                          <span className="truncate text-foreground/80">{entry.name}</span>
                        </div>
                        <span className="font-mono tabular-nums text-foreground/90">
                          {formatCurrency(entry.value, "AED", locale)}
                        </span>
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
