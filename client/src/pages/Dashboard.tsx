import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency, formatDate } from '@/lib/format';
import { getToken } from '@/lib/auth';
import {
  TrendingUp, TrendingDown, AlertCircle, FileText,
  Plus, Receipt, BookOpen, Sparkles, ArrowRight, Clock, CheckCircle2,
  BarChart3, ArrowUpRight, Wallet, Coins,
} from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, AreaChart, Area, BarChart, Bar,
} from 'recharts';
import { Link } from 'wouter';
import { motion } from 'framer-motion';
import ClientDashboard from './ClientDashboard';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getUserTypeFromToken(): string {
  try {
    const token = getToken();
    if (!token) return 'customer';
    const parts = token.split('.');
    if (parts.length !== 3) return 'customer';
    const payload = JSON.parse(atob(parts[1]));
    return payload.userType || 'customer';
  } catch { return 'customer'; }
}

const CHART_COLORS = {
  primary: 'hsl(var(--chart-1))',
  accent: 'hsl(var(--chart-2))',
  warning: 'hsl(var(--chart-3))',
  info: 'hsl(var(--chart-4))',
  muted: 'hsl(var(--chart-5))',
};

const PIE_PALETTE = [
  CHART_COLORS.accent,
  CHART_COLORS.primary,
  CHART_COLORS.warning,
  CHART_COLORS.info,
  CHART_COLORS.muted,
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const userType = getUserTypeFromToken();
  if (userType === 'client') return <ClientDashboard />;
  return <CustomerDashboard />;
}

// ─── Editorial KPI Card ──────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  delta?: number;
  trend?: 'up' | 'down' | 'flat';
  spark?: number[];
  accent: 'primary' | 'success' | 'warning' | 'info';
  isLoading?: boolean;
  delay?: number;
}

function KpiCard({ label, value, delta, trend, spark, accent, isLoading, delay = 0 }: KpiCardProps) {
  const accentClasses = {
    primary: 'text-foreground',
    success: 'text-success-subtle-foreground',
    warning: 'text-warning-subtle-foreground',
    info:    'text-info-subtle-foreground',
  }[accent];

  const sparkColor = {
    primary: 'hsl(var(--chart-1))',
    success: 'hsl(var(--success))',
    warning: 'hsl(var(--warning))',
    info:    'hsl(var(--info))',
  }[accent];

  const sparkData = useMemo(
    () => (spark ?? []).map((v, i) => ({ i, v })),
    [spark],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.4, 0, 0.2, 1] }}
    >
      <Card className="group h-full overflow-hidden hover-lift border-card-border">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
              {label}
            </div>
            {delta !== undefined && (
              <div
                className={
                  'inline-flex items-center gap-0.5 text-[11px] font-mono font-semibold tabular-nums px-1.5 py-0.5 rounded ' +
                  (trend === 'up'
                    ? 'bg-success-subtle text-success-subtle-foreground'
                    : trend === 'down'
                      ? 'bg-danger-subtle text-danger-subtle-foreground'
                      : 'bg-neutral-subtle text-neutral-subtle-foreground')
                }
              >
                {trend === 'up'   ? <TrendingUp className="w-3 h-3" /> :
                 trend === 'down' ? <TrendingDown className="w-3 h-3" /> : null}
                {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
              </div>
            )}
          </div>

          <div className="mt-4 flex items-end justify-between gap-3">
            {isLoading ? (
              <Skeleton className="h-9 w-32" />
            ) : (
              <div className={'font-mono font-semibold tracking-tight tabular-nums text-[26px] leading-none ' + accentClasses}
                   data-testid={`text-${label.toLowerCase().replace(/\s+/g,'-')}`}>
                {value}
              </div>
            )}
            {sparkData.length > 1 && (
              <div className="w-20 h-10 -mb-1 opacity-90">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={sparkData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id={`spark-${accent}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={sparkColor} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={sparkColor} stopOpacity={0}    />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke={sparkColor}
                      strokeWidth={1.5}
                      fill={`url(#spark-${accent})`}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

// ─── Quick action ────────────────────────────────────────────────────────────

function QuickAction({ icon: Icon, title, description, href, delay = 0 }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.4, 0, 0.2, 1] }}
    >
      <Link href={href}>
        <div className="group relative h-full p-5 rounded-xl border border-card-border bg-card hover-lift cursor-pointer overflow-hidden transition-colors">
          <div aria-hidden className="absolute -inset-px rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-accent/8 via-transparent to-primary/5 pointer-events-none" />
          <div className="relative">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-foreground/5 text-foreground/80 ring-1 ring-border/60 group-hover:bg-accent/10 group-hover:text-accent group-hover:ring-accent/30 transition-colors">
                <Icon className="w-4 h-4" strokeWidth={2} />
              </div>
              <ArrowUpRight className="ms-auto w-4 h-4 text-muted-foreground/50 group-hover:text-accent group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform duration-200" />
            </div>
            <div className="mt-4 font-semibold text-[14px] tracking-tight text-foreground">{title}</div>
            <div className="mt-1 text-[12.5px] text-muted-foreground leading-snug">{description}</div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────

function SectionHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div>
        {eyebrow && (
          <div className="text-[10.5px] uppercase tracking-[0.16em] font-semibold text-muted-foreground/80">
            {eyebrow}
          </div>
        )}
        <h2 className="mt-1 font-display text-[22px] md:text-[26px] leading-none text-foreground tracking-tight">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

// ─── Customer dashboard ──────────────────────────────────────────────────────

function CustomerDashboard() {
  const { t, locale } = useTranslation();
  const { companyId: selectedCompanyId } = useDefaultCompany();

  const { data: stats, isLoading: statsLoading } = useQuery<any>({
    queryKey: ['/api/companies', selectedCompanyId, 'dashboard/stats'],
    enabled: !!selectedCompanyId,
    retry: 1,
  });

  const { data: recentInvoices, isLoading: invoicesLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'invoices'],
    enabled: !!selectedCompanyId,
  });

  const { data: journalEntries } = useQuery<any[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'journal'],
    enabled: !!selectedCompanyId,
  });

  const { data: expenseData, isLoading: expenseLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'dashboard/expense-breakdown'],
    enabled: !!selectedCompanyId,
  });

  const { data: monthlyTrends, isLoading: trendsLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'dashboard/monthly-trends'],
    enabled: !!selectedCompanyId,
  });

  // Derive deltas + sparklines from monthlyTrends, gracefully handling empty data
  const sparks = useMemo(() => {
    const trends = monthlyTrends ?? [];
    const revenueSeries = trends.map(t => Number(t?.revenue ?? 0));
    const expenseSeries = trends.map(t => Number(t?.expenses ?? 0));
    const profitSeries = trends.map(t => Number(t?.revenue ?? 0) - Number(t?.expenses ?? 0));

    const pctChange = (series: number[]) => {
      if (series.length < 2) return undefined;
      const prev = series[series.length - 2];
      const curr = series[series.length - 1];
      if (!prev) return undefined;
      return ((curr - prev) / Math.abs(prev)) * 100;
    };

    return {
      revenue:  { series: revenueSeries, delta: pctChange(revenueSeries) },
      expenses: { series: expenseSeries, delta: pctChange(expenseSeries) },
      profit:   { series: profitSeries,  delta: pctChange(profitSeries) },
    };
  }, [monthlyTrends]);

  const monthLabel = new Date().toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const profit = (stats?.revenue || 0) - (stats?.expenses || 0);
  const margin = stats?.revenue > 0 ? (profit / stats.revenue) * 100 : 0;

  return (
    <div className="space-y-12">
      {/* ── Editorial Hero ────────────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        className="relative"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
          <div className="lg:col-span-7 xl:col-span-8">
            <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/80 mb-3 flex items-center gap-2">
              <span className="inline-block w-6 h-px bg-foreground/40" />
              <span className="font-mono">{monthLabel}</span>
            </div>
            <h1 className="font-display text-[40px] md:text-[56px] xl:text-[68px] leading-[1.02] tracking-tightest text-foreground">
              Welcome back<span className="text-accent">.</span>
              <br />
              <span className="text-muted-foreground italic">Here is your financial </span>
              <span className="text-foreground italic">overview.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[14.5px] text-muted-foreground leading-relaxed">
              {t.dashboard ?? 'Dashboard'} · A real-time portrait of revenue, expenses, and outstanding receivables — built for UAE businesses.
            </p>
          </div>

          <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-3">
            <div className="rounded-xl border border-card-border bg-card/70 p-5 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                  Net Profit · This Month
                </div>
                <Badge variant={profit >= 0 ? 'success' : 'danger'} dot>
                  {profit >= 0 ? 'Positive' : 'Negative'}
                </Badge>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                {statsLoading ? (
                  <Skeleton className="h-10 w-40" />
                ) : (
                  <>
                    <span className="font-display text-[36px] md:text-[44px] leading-none tracking-tight text-foreground">
                      {formatCurrency(profit, 'AED', locale)}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-2 text-[12px] text-muted-foreground">
                {statsLoading ? null : (
                  <>Margin <span className="font-mono tabular-nums font-medium text-foreground">{margin.toFixed(1)}%</span> · Revenue <span className="font-mono tabular-nums">{formatCurrency(stats?.revenue || 0, 'AED', locale)}</span></>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/invoices">
                  <Button size="sm" variant="default" data-testid="button-quick-invoice">
                    <FileText className="w-3.5 h-3.5" />
                    New Invoice
                  </Button>
                </Link>
                <Link href="/receipts">
                  <Button size="sm" variant="outline" data-testid="button-quick-receipt">
                    <Receipt className="w-3.5 h-3.5" />
                    Scan Receipt
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* ── KPI strip ─────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Revenue"
          value={formatCurrency(stats?.revenue || 0, 'AED', locale)}
          delta={sparks.revenue.delta}
          trend={sparks.revenue.delta === undefined ? undefined : sparks.revenue.delta >= 0 ? 'up' : 'down'}
          spark={sparks.revenue.series}
          accent="success"
          isLoading={statsLoading}
          delay={0.05}
        />
        <KpiCard
          label="Expenses"
          value={formatCurrency(stats?.expenses || 0, 'AED', locale)}
          delta={sparks.expenses.delta}
          trend={sparks.expenses.delta === undefined ? undefined : sparks.expenses.delta >= 0 ? 'down' : 'up'}
          spark={sparks.expenses.series}
          accent="warning"
          isLoading={statsLoading}
          delay={0.1}
        />
        <KpiCard
          label="Profit"
          value={formatCurrency(profit, 'AED', locale)}
          delta={sparks.profit.delta}
          trend={sparks.profit.delta === undefined ? undefined : sparks.profit.delta >= 0 ? 'up' : 'down'}
          spark={sparks.profit.series}
          accent="primary"
          isLoading={statsLoading}
          delay={0.15}
        />
        <KpiCard
          label="Outstanding"
          value={formatCurrency(stats?.outstanding || 0, 'AED', locale)}
          accent="info"
          isLoading={statsLoading}
          delay={0.2}
        />
      </section>

      {/* ── AI Insights — refined ────────────────────────────────────────── */}
      {!statsLoading && stats && (stats.revenue > 0 || stats.expenses > 0 || stats.outstanding > 0) && (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.25 }}
        >
          <Card className="overflow-hidden border-card-border">
            <div className="relative p-5 md:p-6">
              <div aria-hidden className="absolute inset-0 bg-spotlight pointer-events-none" />
              <div className="relative flex items-start gap-4">
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent/15 to-accent/5 ring-1 ring-accent/25 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-accent" />
                  </div>
                  <span aria-hidden className="absolute -inset-1 rounded-xl bg-accent/10 animate-ping-soft opacity-70" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold tracking-tight text-[15px]">Financial Insights</h3>
                    <Badge variant="info" dot>Real-time</Badge>
                  </div>
                  <p className="mt-1.5 text-[13.5px] text-muted-foreground leading-relaxed text-pretty">
                    {stats.revenue > 0 && stats.expenses > 0 && (
                      <>
                        Your profit margin is <span className="font-mono font-semibold text-foreground">{margin.toFixed(1)}%</span>.
                        {stats.outstanding > 0 && (
                          <> You have <span className="font-mono font-semibold text-warning-subtle-foreground">{formatCurrency(stats.outstanding, 'AED', locale)}</span> in outstanding invoices that need attention.</>
                        )}
                      </>
                    )}
                    {stats.revenue === 0 && stats.expenses === 0 && stats.outstanding > 0 && (
                      <>You have <span className="font-mono font-semibold text-warning-subtle-foreground">{formatCurrency(stats.outstanding, 'AED', locale)}</span> in outstanding invoices.</>
                    )}
                  </p>
                  <Link href="/ai-cfo">
                    <Button size="sm" variant="ghost" className="mt-3 -ms-3 gap-1.5 text-accent hover:text-accent">
                      Talk to AI CFO <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </Card>
        </motion.section>
      )}

      {/* ── Charts row ───────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          eyebrow="Trends"
          title="Revenue vs Expenses"
          action={<Badge variant="outline" className="font-mono">Last 6 months</Badge>}
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 border-card-border">
            <CardContent className="p-5">
              {trendsLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : (monthlyTrends && monthlyTrends.length > 0) ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={monthlyTrends} margin={{ top: 12, right: 8, bottom: 0, left: -16 }}>
                    <defs>
                      <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={CHART_COLORS.accent} stopOpacity={0.32} />
                        <stop offset="100%" stopColor={CHART_COLORS.accent} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={CHART_COLORS.warning} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={CHART_COLORS.warning} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="month"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontFamily: 'var(--font-mono)' }}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      tick={{ fontFamily: 'var(--font-mono)' }}
                    />
                    <Tooltip
                      cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1, strokeDasharray: '3 3' }}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--popover-border))',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontFamily: 'var(--font-mono)',
                        boxShadow: 'var(--shadow-md)',
                      }}
                      formatter={(value: any) => formatCurrency(value, 'AED', locale)}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke={CHART_COLORS.accent}
                      strokeWidth={2}
                      fill="url(#rev)"
                      name="Revenue"
                    />
                    <Area
                      type="monotone"
                      dataKey="expenses"
                      stroke={CHART_COLORS.warning}
                      strokeWidth={2}
                      fill="url(#exp)"
                      name="Expenses"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  icon={BarChart3}
                  title="No revenue data yet"
                  body="Issue your first invoice and the trend chart fills in automatically."
                  actionLabel="Create invoice"
                  actionHref="/invoices"
                />
              )}
            </CardContent>
          </Card>

          {/* Expense Breakdown */}
          <Card className="border-card-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px] font-semibold tracking-tight text-muted-foreground uppercase tracking-[0.12em]">
                {t.expenseBreakdown ?? 'Expense Breakdown'}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-3">
              {expenseLoading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : (expenseData && expenseData.length > 0) ? (
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
                          backgroundColor: 'hsl(var(--popover))',
                          border: '1px solid hsl(var(--popover-border))',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontFamily: 'var(--font-mono)',
                          boxShadow: 'var(--shadow-md)',
                        }}
                        formatter={(value: any) => formatCurrency(value, 'AED', locale)}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <ul className="px-2 pb-3 space-y-1.5">
                    {expenseData.slice(0, 5).map((entry: any, i: number) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-[12px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PIE_PALETTE[i % PIE_PALETTE.length] }} />
                          <span className="truncate text-foreground/80">{entry.name}</span>
                        </div>
                        <span className="font-mono tabular-nums text-foreground/90">
                          {formatCurrency(entry.value, 'AED', locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState
                  icon={Coins}
                  title="No expenses tracked"
                  body="Categorize your first expense to see the breakdown."
                  actionLabel="Create journal entry"
                  actionHref="/journal"
                />
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Quick actions ────────────────────────────────────────────────── */}
      <section>
        <SectionHeader eyebrow="Shortcuts" title="Quick actions" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <QuickAction icon={Plus}      title="Create Invoice"  description="Generate UAE-compliant tax invoices in seconds"   href="/invoices" delay={0.05} />
          <QuickAction icon={Receipt}   title="Scan Receipt"    description="OCR receipts straight into your books"            href="/receipts" delay={0.10} />
          <QuickAction icon={BookOpen}  title="Journal Entry"   description="Record manual double-entry transactions"          href="/journal"  delay={0.15} />
          <QuickAction icon={BarChart3} title="View Reports"    description="P&L, balance sheet, cash flow — exportable"      href="/reports"  delay={0.20} />
        </div>
      </section>

      {/* ── Recent activity ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader eyebrow="Activity" title="Recent" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border-card-border">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 border-b border-border/60">
              <CardTitle className="flex items-center gap-2 text-[13px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
                <FileText className="w-3.5 h-3.5" />
                {t.recentInvoices ?? 'Recent invoices'}
              </CardTitle>
              <Link href="/invoices">
                <Button variant="ghost" size="sm" className="gap-1 text-accent hover:text-accent -me-2">
                  View all <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="pt-3">
              {invoicesLoading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              ) : recentInvoices && recentInvoices.length > 0 ? (
                <ul className="divide-y divide-border/50">
                  {recentInvoices.slice(0, 5).map((invoice: any) => (
                    <li
                      key={invoice.id}
                      className="flex items-center justify-between gap-3 py-3 group"
                      data-testid={`invoice-${invoice.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-info-subtle text-info-subtle-foreground flex-shrink-0 group-hover:scale-[1.04] transition-transform">
                          <FileText className="w-4 h-4" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-medium tracking-tight text-foreground truncate">
                            {invoice.customerName}
                          </div>
                          <div className="text-[11.5px] text-muted-foreground font-mono tabular-nums">
                            INV-{invoice.number}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[14px] font-mono font-semibold tabular-nums text-foreground">
                          {formatCurrency(invoice.total, invoice.currency, locale)}
                        </div>
                        <StatusBadge status={invoice.status} className="mt-0.5" />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={FileText}
                  title="No invoices yet"
                  body="Create your first invoice to get started."
                  actionLabel="Create invoice"
                  actionHref="/invoices"
                />
              )}
            </CardContent>
          </Card>

          <Card className="border-card-border">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 border-b border-border/60">
              <CardTitle className="flex items-center gap-2 text-[13px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                Recent activity
              </CardTitle>
              <Link href="/journal">
                <Button variant="ghost" size="sm" className="gap-1 text-accent hover:text-accent -me-2">
                  View all <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="pt-3">
              {journalEntries && journalEntries.length > 0 ? (
                <ul className="divide-y divide-border/50">
                  {journalEntries.slice(0, 5).map((entry: any) => (
                    <li key={entry.id} className="flex items-center gap-3 py-3 group">
                      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-success-subtle text-success-subtle-foreground flex-shrink-0 group-hover:scale-[1.04] transition-transform">
                        <CheckCircle2 className="w-4 h-4" strokeWidth={1.75} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-medium tracking-tight text-foreground truncate">
                          {entry.memo || 'Journal entry'}
                        </div>
                        <div className="text-[11.5px] text-muted-foreground font-mono tabular-nums">
                          {formatDate(entry.date, locale)}
                        </div>
                      </div>
                      <StatusBadge status="posted" />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={BookOpen}
                  title="No transactions yet"
                  body="Your double-entry ledger is waiting for its first entry."
                  actionLabel="Create journal entry"
                  actionHref="/journal"
                />
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({
  icon: Icon, title, body, actionLabel, actionHref,
}: {
  icon: any;
  title: string;
  body: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-muted/60 ring-1 ring-border text-muted-foreground mb-3">
        <Icon className="w-5 h-5" strokeWidth={1.75} />
      </div>
      <div className="text-[14px] font-medium text-foreground tracking-tight">{title}</div>
      <div className="text-[12.5px] text-muted-foreground mt-0.5 max-w-xs leading-relaxed">{body}</div>
      {actionLabel && actionHref && (
        <Link href={actionHref}>
          <Button variant="outline" size="sm" className="gap-1.5 mt-4">
            <Plus className="w-3.5 h-3.5" />
            {actionLabel}
          </Button>
        </Link>
      )}
    </div>
  );
}
