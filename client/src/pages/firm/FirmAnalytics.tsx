import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  BarChart2,
  Heart,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/lib/i18n';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RevenueData {
  totalMRR: number;
  revenueByClient: { companyId: string; companyName: string; totalRevenue: number }[];
  revenueGrowthPercent: number;
  avgRevenuePerClient: number;
}

interface UtilizationData {
  staffCount: number;
  clientsPerStaff: number;
  avgClientsPerAdmin: number;
  totalClients: number;
}

interface HealthSummaryData {
  healthDistribution: { healthy: number; attention: number; critical: number };
  topIssues: { type: string; count: number; affectedClients: number }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAed(amount: number) {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

const HEALTH_COLORS = {
  healthy: '#22c55e',
  attention: '#f59e0b',
  critical: '#ef4444',
};

const ISSUE_LABELS: Record<string, string> = {
  overdue_invoices: 'Overdue Invoices',
  overdue_vat: 'Overdue VAT Returns',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: number;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs mt-1 ${trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span>{Math.abs(trend)}% vs last month</span>
          </div>
        )}
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FirmAnalytics() {
  const { t } = useTranslation();

  const { data: revenue, isLoading: revLoading } = useQuery<RevenueData>({
    queryKey: ['/api/firm/analytics/revenue'],
  });

  const { data: utilization, isLoading: utilLoading } = useQuery<UtilizationData>({
    queryKey: ['/api/firm/analytics/utilization'],
  });

  const { data: health, isLoading: healthLoading } = useQuery<HealthSummaryData>({
    queryKey: ['/api/firm/analytics/client-health-summary'],
  });

  const isLoading = revLoading || utilLoading || healthLoading;

  const healthPieData = health
    ? [
        { name: (t as any).healthyClients || 'Healthy', value: health.healthDistribution.healthy, color: HEALTH_COLORS.healthy },
        { name: (t as any).attentionClients || 'Needs Attention', value: health.healthDistribution.attention, color: HEALTH_COLORS.attention },
        { name: (t as any).criticalClients || 'Critical', value: health.healthDistribution.critical, color: HEALTH_COLORS.critical },
      ].filter(d => d.value > 0)
    : [];

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-32 rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{(t as any).firmAnalytics || 'Firm Analytics'}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {(t as any).firmAnalyticsDesc || 'Revenue, utilization, and client health overview'}
        </p>
      </div>

      {/* Revenue cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          title={(t as any).totalMRR || 'Total MRR'}
          value={formatAed(revenue?.totalMRR ?? 0)}
          icon={DollarSign}
          trend={revenue?.revenueGrowthPercent}
        />
        <MetricCard
          title={(t as any).revenueGrowth || 'Revenue Growth'}
          value={`${revenue?.revenueGrowthPercent ?? 0}%`}
          subtitle={(t as any).vsLastMonth || 'vs. last 30 days'}
          icon={TrendingUp}
        />
        <MetricCard
          title={(t as any).avgRevenuePerClient || 'Avg Revenue / Client'}
          value={formatAed(revenue?.avgRevenuePerClient ?? 0)}
          icon={BarChart2}
        />
        <MetricCard
          title={(t as any).totalClients || 'Total Clients'}
          value={String(utilization?.totalClients ?? 0)}
          subtitle={`${utilization?.staffCount ?? 0} ${(t as any).staffMembers || 'staff members'}`}
          icon={Users}
        />
      </div>

      {/* Revenue by client + Health donut */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Bar chart: revenue by client */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{(t as any).revenueByClient || 'Revenue by Client (Top 10)'}</CardTitle>
          </CardHeader>
          <CardContent>
            {(revenue?.revenueByClient?.length ?? 0) === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                {t.noData}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={revenue!.revenueByClient.map(r => ({
                    name: r.companyName.length > 14 ? r.companyName.slice(0, 14) + '…' : r.companyName,
                    revenue: r.totalRevenue,
                  }))}
                  margin={{ top: 4, right: 16, left: 0, bottom: 24 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    angle={-30}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip formatter={(v: number) => formatAed(v)} />
                  <Bar dataKey="revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Donut: client health */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{(t as any).clientHealthSummary || 'Client Health'}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            {healthPieData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                {t.noData}
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={healthPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={56}
                      outerRadius={88}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {healthPieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-1 w-full">
                  {healthPieData.map(d => (
                    <div key={d.name} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full"
                          style={{ background: d.color }}
                        />
                        {d.name}
                      </span>
                      <Badge variant="outline">{d.value}</Badge>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Top issues */}
            {(health?.topIssues?.length ?? 0) > 0 && (
              <div className="w-full border-t pt-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {(t as any).topIssues || 'Top Issues'}
                </p>
                {health!.topIssues.map(issue => (
                  <div key={issue.type} className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <span>
                      <span className="font-medium">{ISSUE_LABELS[issue.type] ?? issue.type}</span>
                      <span className="text-muted-foreground ml-1">
                        — {issue.count} total, {issue.affectedClients} clients
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Staff utilization */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{(t as any).staffUtilization || 'Staff Utilization'}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-amber-600">{utilization?.staffCount ?? 0}</div>
              <div className="text-sm text-muted-foreground mt-1">{(t as any).totalStaff || 'Total Staff'}</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-amber-600">{utilization?.clientsPerStaff ?? 0}</div>
              <div className="text-sm text-muted-foreground mt-1">{(t as any).clientsPerStaff || 'Clients / Staff'}</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-amber-600">{utilization?.avgClientsPerAdmin ?? 0}</div>
              <div className="text-sm text-muted-foreground mt-1">{(t as any).avgClientsPerAdmin || 'Avg Clients / Admin'}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
