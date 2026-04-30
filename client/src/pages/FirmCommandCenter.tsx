/**
 * Phase 6: Firm-Wide Command Center
 *
 * Executive dashboard for firm owners with key metrics, client health table,
 * alerts feed, staff workload visualization, period comparison, and batch ops.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  DollarSign,
  Mail,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
  Calculator,
  FileSearch,
  Building2,
  Loader2,
  Activity,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

// ─── Types (mirror server) ──────────────────────────────────────────────

type Severity = 'critical' | 'warning' | 'info';
type RankBy = 'health' | 'revenue' | 'overdue' | 'compliance';
type Granularity = 'month' | 'quarter';

interface DashboardSummary {
  totalClients: number;
  activeClients: number;
  totalRevenue: number;
  totalOutstandingAr: number;
  totalVatLiability: number;
  receiptsProcessedThisMonth: number;
  invoicesIssuedThisMonth: number;
  criticalAlertCount: number;
  warningAlertCount: number;
  averageHealthScore: number;
}

interface ClientHealthRow {
  companyId: string;
  companyName: string;
  score: number;
  rating: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  healthScore: number;
  revenue: number;
  overdueBalance: number;
  complianceScore: number;
  factors: {
    overdueBalance: number;
    overdueInvoiceCount: number;
    vatOverdue: boolean;
    receiptBacklog: number;
    daysSinceActivity: number | null;
  };
}

interface FirmAlertRow {
  id: string;
  companyId: string | null;
  alertType: string;
  severity: Severity;
  message: string;
  isRead: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

interface StaffWorkloadRow {
  userId: string;
  userName: string;
  userEmail: string;
  clientCount: number;
  rolesByName: Record<string, number>;
}

interface ComparisonResponse {
  granularity: Granularity;
  current: { start: string; end: string; revenue: number; receipts: number; invoices: number };
  previous: { start: string; end: string; revenue: number; receipts: number; invoices: number };
  deltas: { revenuePct: number; receiptsPct: number; invoicesPct: number };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatAed(n: number): string {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function ratingColor(rating: ClientHealthRow['rating']): string {
  switch (rating) {
    case 'excellent':
      return 'bg-emerald-100 text-emerald-800';
    case 'good':
      return 'bg-green-100 text-green-800';
    case 'fair':
      return 'bg-amber-100 text-amber-800';
    case 'poor':
      return 'bg-orange-100 text-orange-800';
    case 'critical':
      return 'bg-red-100 text-red-800';
  }
}

function severityColor(s: Severity): string {
  switch (s) {
    case 'critical':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'warning':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    case 'info':
      return 'bg-blue-100 text-blue-800 border-blue-300';
  }
}

// ─── Sub-components ─────────────────────────────────────────────────────

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
  icon: typeof TrendingUp;
  trend?: { value: number; label: string };
}) {
  const isUp = (trend?.value ?? 0) >= 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        {trend && (
          <div
            className={`text-xs mt-2 flex items-center gap-1 ${
              isUp ? 'text-emerald-600' : 'text-red-600'
            }`}
          >
            {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            <span>
              {trend.value > 0 ? '+' : ''}
              {trend.value}% {trend.label}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────

export default function FirmCommandCenter() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [rankBy, setRankBy] = useState<RankBy>('health');
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');

  // ─── Queries ───────────────────────────────────────────────────────
  const dashboardQuery = useQuery<{
    summary: DashboardSummary;
    healthScores: ClientHealthRow[];
  }>({
    queryKey: ['/api/firm/command-center/dashboard'],
  });

  const healthQuery = useQuery<ClientHealthRow[]>({
    queryKey: ['/api/firm/command-center/clients/health', rankBy],
    queryFn: () =>
      apiRequest('GET', `/api/firm/command-center/clients/health?by=${rankBy}&dir=desc`),
  });

  const alertsQuery = useQuery<FirmAlertRow[]>({
    queryKey: ['/api/firm/command-center/alerts', severityFilter],
    queryFn: () => {
      const url =
        severityFilter === 'all'
          ? '/api/firm/command-center/alerts'
          : `/api/firm/command-center/alerts?severity=${severityFilter}`;
      return apiRequest('GET', url);
    },
  });

  const workloadQuery = useQuery<StaffWorkloadRow[]>({
    queryKey: ['/api/firm/command-center/staff/workload'],
  });

  const comparisonQuery = useQuery<ComparisonResponse>({
    queryKey: ['/api/firm/command-center/metrics/comparison', granularity],
    queryFn: () =>
      apiRequest(
        'GET',
        `/api/firm/command-center/metrics/comparison?granularity=${granularity}`
      ),
  });

  // ─── Mutations ─────────────────────────────────────────────────────
  const refreshAlerts = useMutation({
    mutationFn: () => apiRequest('POST', '/api/firm/command-center/alerts/refresh'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/firm/command-center/alerts'] });
      toast({ title: 'Alerts refreshed' });
    },
    onError: (e: Error) => toast({ title: 'Refresh failed', description: e.message, variant: 'destructive' }),
  });

  const markRead = useMutation({
    mutationFn: (alertId: string) =>
      apiRequest('PATCH', `/api/firm/command-center/alerts/${alertId}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/firm/command-center/alerts'] }),
  });

  const resolveAlert = useMutation({
    mutationFn: (alertId: string) =>
      apiRequest('PATCH', `/api/firm/command-center/alerts/${alertId}/resolve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/firm/command-center/alerts'] }),
  });

  const batchVat = useMutation({
    mutationFn: (companyIds: string[]) =>
      apiRequest('POST', '/api/firm/command-center/batch/vat-calculate', { companyIds }),
    onSuccess: (data: { results?: unknown[] }) => {
      toast({
        title: 'Batch VAT calc complete',
        description: `${data.results?.length ?? 0} clients calculated.`,
      });
      setSelectedClients(new Set());
    },
    onError: (e: Error) =>
      toast({ title: 'Batch VAT failed', description: e.message, variant: 'destructive' }),
  });

  const batchChasePayments = useMutation({
    mutationFn: (companyIds: string[]) =>
      apiRequest('POST', '/api/firm/command-center/batch/chase-payments', { companyIds }),
    onSuccess: (data: { chasedInvoiceCount?: number }) => {
      toast({
        title: 'Payment chase queued',
        description: `${data.chasedInvoiceCount ?? 0} invoices queued.`,
      });
      setSelectedClients(new Set());
    },
    onError: (e: Error) =>
      toast({ title: 'Chase failed', description: e.message, variant: 'destructive' }),
  });

  const batchChaseDocuments = useMutation({
    mutationFn: (companyIds: string[]) =>
      apiRequest('POST', '/api/firm/command-center/batch/chase-documents', { companyIds }),
    onSuccess: (data: { chasedClientCount?: number }) => {
      qc.invalidateQueries({ queryKey: ['/api/firm/command-center/alerts'] });
      toast({
        title: 'Document chase queued',
        description: `${data.chasedClientCount ?? 0} clients notified.`,
      });
      setSelectedClients(new Set());
    },
    onError: (e: Error) =>
      toast({ title: 'Chase failed', description: e.message, variant: 'destructive' }),
  });

  // ─── Derived data ──────────────────────────────────────────────────
  const summary = dashboardQuery.data?.summary;
  const allClients = healthQuery.data ?? [];
  const filteredClients = useMemo(
    () =>
      allClients.filter((c) =>
        search ? c.companyName.toLowerCase().includes(search.toLowerCase()) : true
      ),
    [allClients, search]
  );

  const allSelected = filteredClients.length > 0 && filteredClients.every((c) => selectedClients.has(c.companyId));

  const toggleClient = (id: string) => {
    setSelectedClients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (allSelected) setSelectedClients(new Set());
    else setSelectedClients(new Set(filteredClients.map((c) => c.companyId)));
  };

  const selectedIds = Array.from(selectedClients);
  const selectedCount = selectedIds.length;

  const workloadChartData = useMemo(
    () =>
      (workloadQuery.data ?? []).map((w) => ({
        name: w.userName,
        clients: w.clientCount,
      })),
    [workloadQuery.data]
  );

  const comparisonChartData = useMemo(() => {
    const c = comparisonQuery.data;
    if (!c) return [];
    return [
      { name: 'Previous', revenue: c.previous.revenue, invoices: c.previous.invoices, receipts: c.previous.receipts },
      { name: 'Current', revenue: c.current.revenue, invoices: c.current.invoices, receipts: c.current.receipts },
    ];
  }, [comparisonQuery.data]);

  // ─── Render ────────────────────────────────────────────────────────
  if (dashboardQuery.isError) {
    return (
      <div
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-900 p-6 text-sm"
        data-testid="firm-command-center-error"
      >
        <div className="font-medium mb-1">Failed to load firm dashboard.</div>
        <div className="text-muted-foreground">
          {dashboardQuery.error instanceof Error
            ? dashboardQuery.error.message
            : 'An unexpected error occurred.'}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => dashboardQuery.refetch()}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="page-title">
            Firm Command Center
          </h1>
          <p className="text-muted-foreground">
            Bird's-eye view across all clients with actionable insights and batch operations.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => refreshAlerts.mutate()}
          disabled={refreshAlerts.isPending}
          data-testid="button-refresh-alerts"
        >
          {refreshAlerts.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Refresh alerts
        </Button>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total clients"
          value={summary ? `${summary.totalClients}` : '—'}
          subtitle={summary ? `${summary.activeClients} active` : undefined}
          icon={Building2}
        />
        <MetricCard
          title="Outstanding AR"
          value={summary ? formatAed(summary.totalOutstandingAr) : '—'}
          icon={DollarSign}
        />
        <MetricCard
          title="VAT liability"
          value={summary ? formatAed(summary.totalVatLiability) : '—'}
          subtitle="Across unfiled returns"
          icon={Calculator}
        />
        <MetricCard
          title="Receipts this month"
          value={summary ? `${summary.receiptsProcessedThisMonth}` : '—'}
          subtitle={summary ? `${summary.invoicesIssuedThisMonth} invoices issued` : undefined}
          icon={Activity}
        />
      </div>

      {/* Health summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Average health score</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{summary?.averageHealthScore ?? '—'}</div>
            <p className="text-xs text-muted-foreground mt-1">across all managed clients</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              Critical alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-red-600">
              {summary?.criticalAlertCount ?? '—'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-600" />
              Warnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-amber-600">
              {summary?.warningAlertCount ?? '—'}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="clients" className="space-y-4">
        <TabsList>
          <TabsTrigger value="clients">Client health</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="staff">Staff workload</TabsTrigger>
          <TabsTrigger value="comparison">Period comparison</TabsTrigger>
        </TabsList>

        {/* ─── Client health tab ─── */}
        <TabsContent value="clients" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2 flex-1 max-w-md">
                  <Search className="w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search clients..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    data-testid="input-search-clients"
                  />
                </div>
                <Select value={rankBy} onValueChange={(v) => setRankBy(v as RankBy)}>
                  <SelectTrigger className="w-[200px]" data-testid="select-rank-by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="health">Sort by health</SelectItem>
                    <SelectItem value="revenue">Sort by revenue</SelectItem>
                    <SelectItem value="overdue">Sort by overdue AR</SelectItem>
                    <SelectItem value="compliance">Sort by compliance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {selectedCount > 0 && (
                <div className="flex items-center gap-2 mb-3 p-3 rounded-md bg-muted">
                  <span className="text-sm font-medium">
                    {selectedCount} selected
                  </span>
                  <div className="ml-auto flex gap-2">
                    <BatchActionButton
                      label="Run VAT calc"
                      icon={Calculator}
                      onConfirm={() => batchVat.mutate(selectedIds)}
                      pending={batchVat.isPending}
                      description={`Run VAT calculation for ${selectedCount} client${selectedCount === 1 ? '' : 's'}.`}
                    />
                    <BatchActionButton
                      label="Chase payments"
                      icon={Mail}
                      onConfirm={() => batchChasePayments.mutate(selectedIds)}
                      pending={batchChasePayments.isPending}
                      description={`Queue payment chase for overdue invoices across ${selectedCount} client${selectedCount === 1 ? '' : 's'}.`}
                    />
                    <BatchActionButton
                      label="Chase documents"
                      icon={FileSearch}
                      onConfirm={() => batchChaseDocuments.mutate(selectedIds)}
                      pending={batchChaseDocuments.isPending}
                      description={`Queue document chase for ${selectedCount} client${selectedCount === 1 ? '' : 's'}.`}
                    />
                  </div>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                    </TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Overdue AR</TableHead>
                    <TableHead>VAT</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead>
                      <span className="sr-only">Open client</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClients.map((c) => (
                    <TableRow key={c.companyId} data-testid={`row-client-${c.companyId}`}>
                      <TableCell>
                        <Checkbox
                          checked={selectedClients.has(c.companyId)}
                          onCheckedChange={() => toggleClient(c.companyId)}
                          aria-label={`Select ${c.companyName}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{c.companyName}</TableCell>
                      <TableCell className="font-mono">{c.score}</TableCell>
                      <TableCell>
                        <Badge className={ratingColor(c.rating)}>{c.rating}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatAed(c.revenue)}</TableCell>
                      <TableCell className="text-right">{formatAed(c.overdueBalance)}</TableCell>
                      <TableCell>
                        {c.factors.vatOverdue ? (
                          <Badge variant="destructive">Overdue</Badge>
                        ) : (
                          <Badge variant="secondary">OK</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.factors.daysSinceActivity === null
                          ? '—'
                          : `${c.factors.daysSinceActivity}d ago`}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/firm/clients/${c.companyId}`)}
                          data-testid={`button-jump-${c.companyId}`}
                        >
                          Open →
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredClients.length === 0 && !healthQuery.isLoading && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                        {search ? 'No clients match your search.' : 'No clients yet.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Alerts tab ─── */}
        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Alert feed</CardTitle>
                <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as Severity | 'all')}>
                  <SelectTrigger className="w-[180px]" data-testid="select-severity-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All severities</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(alertsQuery.data ?? []).map((a) => (
                  <div
                    key={a.id}
                    className={`p-3 border rounded-md flex items-center justify-between gap-3 ${
                      a.isRead ? 'opacity-60' : ''
                    }`}
                    data-testid={`alert-${a.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge className={severityColor(a.severity)}>{a.severity}</Badge>
                      <span className="text-sm flex-1 truncate">{a.message}</span>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {!a.isRead && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markRead.mutate(a.id)}
                          disabled={markRead.isPending}
                          data-testid={`button-mark-read-${a.id}`}
                        >
                          Mark read
                        </Button>
                      )}
                      {!a.resolvedAt && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => resolveAlert.mutate(a.id)}
                          disabled={resolveAlert.isPending}
                          data-testid={`button-resolve-${a.id}`}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1" /> Resolve
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {(alertsQuery.data ?? []).length === 0 && !alertsQuery.isLoading && (
                  <div className="text-center text-muted-foreground py-8">
                    No active alerts. Click "Refresh alerts" above to scan all clients.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Staff workload tab ─── */}
        <TabsContent value="staff" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-4 h-4" /> Staff workload distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {workloadChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={workloadChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RechartsTooltip />
                    <Bar dataKey="clients" fill="#3b82f6" name="Clients assigned" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No firm_admin staff configured yet.
                </p>
              )}
              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-right">Clients</TableHead>
                    <TableHead>Roles</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(workloadQuery.data ?? []).map((w) => (
                    <TableRow key={w.userId}>
                      <TableCell className="font-medium">{w.userName}</TableCell>
                      <TableCell className="text-muted-foreground">{w.userEmail}</TableCell>
                      <TableCell className="text-right">{w.clientCount}</TableCell>
                      <TableCell>
                        {Object.entries(w.rolesByName).map(([role, n]) => (
                          <Badge key={role} variant="outline" className="mr-1">
                            {role} × {n}
                          </Badge>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Period comparison tab ─── */}
        <TabsContent value="comparison" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Period comparison</CardTitle>
                <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
                  <SelectTrigger className="w-[160px]" data-testid="select-granularity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Month-over-month</SelectItem>
                    <SelectItem value="quarter">Quarter-over-quarter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <DeltaCard
                  label="Revenue"
                  value={comparisonQuery.data?.deltas.revenuePct ?? 0}
                />
                <DeltaCard
                  label="Receipts"
                  value={comparisonQuery.data?.deltas.receiptsPct ?? 0}
                />
                <DeltaCard
                  label="Invoices"
                  value={comparisonQuery.data?.deltas.invoicesPct ?? 0}
                />
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={comparisonChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <RechartsTooltip />
                  <Legend />
                  <Bar dataKey="revenue" fill="#10b981" name="Revenue (AED)" />
                  <Bar dataKey="invoices" fill="#3b82f6" name="Invoices" />
                  <Bar dataKey="receipts" fill="#f59e0b" name="Receipts" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function DeltaCard({ label, value }: { label: string; value: number }) {
  const positive = value >= 0;
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div
          className={`text-2xl font-bold flex items-center gap-1 ${
            positive ? 'text-emerald-600' : 'text-red-600'
          }`}
        >
          {positive ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
          {value > 0 ? '+' : ''}
          {value}%
        </div>
      </CardContent>
    </Card>
  );
}

function BatchActionButton({
  label,
  icon: Icon,
  onConfirm,
  pending,
  description,
}: {
  label: string;
  icon: typeof TrendingUp;
  onConfirm: () => void;
  pending: boolean;
  description: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" disabled={pending} data-testid={`button-batch-${label.toLowerCase().replace(/\s+/g, '-')}`}>
          {pending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Icon className="w-4 h-4 mr-1" />}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm: {label}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
