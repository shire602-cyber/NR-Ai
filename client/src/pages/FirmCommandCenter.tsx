/**
 * Phase 6: Firm-Wide Command Center
 *
 * Executive dashboard for firm owners with key metrics, client health table,
 * alerts feed, staff workload visualization, period comparison, and batch ops.
 */
import { PageHeader } from "@/components/ui/page-header";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { messages as pageMessages } from "./FirmCommandCenter.i18n";

// ─── Types (mirror server) ──────────────────────────────────────────────

type Severity = "critical" | "warning" | "info";
type RankBy = "health" | "revenue" | "overdue" | "compliance";
type Granularity = "month" | "quarter";

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
  rating: "excellent" | "good" | "fair" | "poor" | "critical";
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
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function ratingColor(rating: ClientHealthRow["rating"]): string {
  switch (rating) {
    case "excellent":
      return "bg-success-subtle text-success-subtle-foreground";
    case "good":
      return "bg-success-subtle text-success-subtle-foreground";
    case "fair":
      return "bg-warning-subtle text-warning-subtle-foreground";
    case "poor":
      return "bg-warning-subtle text-warning-subtle-foreground";
    case "critical":
      return "bg-danger-subtle text-danger-subtle-foreground";
  }
}

function severityColor(s: Severity): string {
  switch (s) {
    case "critical":
      return "bg-danger-subtle text-danger-subtle-foreground border-destructive/30";
    case "warning":
      return "bg-warning-subtle text-warning-subtle-foreground border-warning/30";
    case "info":
      return "bg-info-subtle text-info-subtle-foreground border-info/30";
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
              isUp ? "text-success" : "text-destructive"
            }`}
          >
            {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            <span>
              {trend.value > 0 ? "+" : ""}
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
  const tr = pageMessages.useT();

  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [rankBy, setRankBy] = useState<RankBy>("health");
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");

  // ─── Queries ───────────────────────────────────────────────────────
  const dashboardQuery = useQuery<{
    summary: DashboardSummary;
    healthScores: ClientHealthRow[];
  }>({
    queryKey: ["/api/firm/command-center/dashboard"],
  });

  const healthQuery = useQuery<ClientHealthRow[]>({
    queryKey: ["/api/firm/command-center/clients/health", rankBy],
    queryFn: () =>
      apiRequest("GET", `/api/firm/command-center/clients/health?by=${rankBy}&dir=desc`),
  });

  const alertsQuery = useQuery<FirmAlertRow[]>({
    queryKey: ["/api/firm/command-center/alerts", severityFilter],
    queryFn: () => {
      const url =
        severityFilter === "all"
          ? "/api/firm/command-center/alerts"
          : `/api/firm/command-center/alerts?severity=${severityFilter}`;
      return apiRequest("GET", url);
    },
  });

  const workloadQuery = useQuery<StaffWorkloadRow[]>({
    queryKey: ["/api/firm/command-center/staff/workload"],
  });

  const comparisonQuery = useQuery<ComparisonResponse>({
    queryKey: ["/api/firm/command-center/metrics/comparison", granularity],
    queryFn: () =>
      apiRequest("GET", `/api/firm/command-center/metrics/comparison?granularity=${granularity}`),
  });

  // ─── Mutations ─────────────────────────────────────────────────────
  const refreshAlerts = useMutation({
    mutationFn: () => apiRequest("POST", "/api/firm/command-center/alerts/refresh"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/firm/command-center/alerts"] });
      toast({ title: tr("alertsRefreshed") });
    },
    onError: (e: Error) =>
      toast({ title: tr("refreshFailed"), description: e.message, variant: "destructive" }),
  });

  const markRead = useMutation({
    mutationFn: (alertId: string) =>
      apiRequest("PATCH", `/api/firm/command-center/alerts/${alertId}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/firm/command-center/alerts"] }),
  });

  const resolveAlert = useMutation({
    mutationFn: (alertId: string) =>
      apiRequest("PATCH", `/api/firm/command-center/alerts/${alertId}/resolve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/firm/command-center/alerts"] }),
  });

  const batchVat = useMutation({
    mutationFn: (companyIds: string[]) =>
      apiRequest("POST", "/api/firm/command-center/batch/vat-calculate", { companyIds }),
    onSuccess: (data: { results?: unknown[] }) => {
      toast({
        title: tr("batchVatCalcComplete"),
        description: tr("clientsCalculated", { value: data.results?.length ?? 0 }),
      });
      setSelectedClients(new Set());
    },
    onError: (e: Error) =>
      toast({ title: tr("batchVatFailed"), description: e.message, variant: "destructive" }),
  });

  const batchChasePayments = useMutation({
    mutationFn: (companyIds: string[]) =>
      apiRequest("POST", "/api/firm/command-center/batch/chase-payments", { companyIds }),
    onSuccess: (data: { chasedInvoiceCount?: number }) => {
      toast({
        title: tr("paymentChaseQueued"),
        description: tr("invoicesQueued", { value: data.chasedInvoiceCount ?? 0 }),
      });
      setSelectedClients(new Set());
    },
    onError: (e: Error) =>
      toast({ title: tr("chaseFailed"), description: e.message, variant: "destructive" }),
  });

  const batchChaseDocuments = useMutation({
    mutationFn: (companyIds: string[]) =>
      apiRequest("POST", "/api/firm/command-center/batch/chase-documents", { companyIds }),
    onSuccess: (data: { chasedClientCount?: number }) => {
      qc.invalidateQueries({ queryKey: ["/api/firm/command-center/alerts"] });
      toast({
        title: tr("documentChaseQueued"),
        description: tr("clientsNotified", { value: data.chasedClientCount ?? 0 }),
      });
      setSelectedClients(new Set());
    },
    onError: (e: Error) =>
      toast({ title: tr("chaseFailed"), description: e.message, variant: "destructive" }),
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

  const allSelected =
    filteredClients.length > 0 && filteredClients.every((c) => selectedClients.has(c.companyId));

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
      {
        name: "Previous",
        revenue: c.previous.revenue,
        invoices: c.previous.invoices,
        receipts: c.previous.receipts,
      },
      {
        name: "Current",
        revenue: c.current.revenue,
        invoices: c.current.invoices,
        receipts: c.current.receipts,
      },
    ];
  }, [comparisonQuery.data]);

  // ─── Render ────────────────────────────────────────────────────────
  if (dashboardQuery.isError) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-danger-subtle p-6 text-sm"
        data-testid="firm-command-center-error"
      >
        <div className="font-medium mb-1">{tr("failedToLoadFirmDashboard")}</div>
        <div className="text-muted-foreground">
          {dashboardQuery.error instanceof Error
            ? dashboardQuery.error.message
            : tr("anUnexpectedErrorOccurred")}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => dashboardQuery.refetch()}
        >
          {tr("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("firm")}
        title={tr("firmCommandCenter")}
        testId="page-title"
        description={tr("birdSEyeViewAcrossAll")}
        actions={
          <Button
            variant="outline"
            onClick={() => refreshAlerts.mutate()}
            disabled={refreshAlerts.isPending}
            data-testid="button-refresh-alerts"
          >
            {refreshAlerts.isPending ? (
              <Loader2 className="w-4 h-4 me-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 me-2" />
            )}
            {tr("refreshAlerts")}
          </Button>
        }
      />

      {/* Metrics row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title={tr("totalClients")}
          value={summary ? `${summary.totalClients}` : "—"}
          subtitle={summary ? tr("active", { activeClients: summary.activeClients }) : undefined}
          icon={Building2}
        />
        <MetricCard
          title={tr("outstandingAr")}
          value={summary ? formatAed(summary.totalOutstandingAr) : "—"}
          icon={DollarSign}
        />
        <MetricCard
          title={tr("vatLiability")}
          value={summary ? formatAed(summary.totalVatLiability) : "—"}
          subtitle={tr("acrossUnfiledReturns")}
          icon={Calculator}
        />
        <MetricCard
          title={tr("receiptsThisMonth")}
          value={summary ? `${summary.receiptsProcessedThisMonth}` : "—"}
          subtitle={
            summary
              ? tr("invoicesIssued", { invoicesIssuedThisMonth: summary.invoicesIssuedThisMonth })
              : undefined
          }
          icon={Activity}
        />
      </div>

      {/* Health summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{tr("averageHealthScore")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{summary?.averageHealthScore ?? "—"}</div>
            <p className="text-xs text-muted-foreground mt-1">{tr("acrossAllManagedClients")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              {tr("criticalAlerts")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-destructive">
              {summary?.criticalAlertCount ?? "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Bell className="w-4 h-4 text-warning" />
              {tr("warnings")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-warning">
              {summary?.warningAlertCount ?? "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="clients" className="space-y-4">
        <TabsList>
          <TabsTrigger value="clients">{tr("clientHealth")}</TabsTrigger>
          <TabsTrigger value="alerts">{tr("alerts")}</TabsTrigger>
          <TabsTrigger value="staff">{tr("staffWorkload")}</TabsTrigger>
          <TabsTrigger value="comparison">{tr("periodComparison")}</TabsTrigger>
        </TabsList>

        {/* ─── Client health tab ─── */}
        <TabsContent value="clients" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2 flex-1 max-w-md">
                  <Search className="w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={tr("searchClients")}
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
                    <SelectItem value="health">{tr("sortByHealth")}</SelectItem>
                    <SelectItem value="revenue">{tr("sortByRevenue")}</SelectItem>
                    <SelectItem value="overdue">{tr("sortByOverdueAr")}</SelectItem>
                    <SelectItem value="compliance">{tr("sortByCompliance")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {selectedCount > 0 && (
                <div className="flex items-center gap-2 mb-3 p-3 rounded-md bg-muted">
                  <span className="text-sm font-medium">{tr("selected", { selectedCount })}</span>
                  <div className="ms-auto flex gap-2">
                    <BatchActionButton
                      label={tr("runVatCalc")}
                      icon={Calculator}
                      onConfirm={() => batchVat.mutate(selectedIds)}
                      pending={batchVat.isPending}
                      description={tr.plural("runVatCalculationForClients", selectedCount)}
                    />
                    <BatchActionButton
                      label={tr("chasePayments")}
                      icon={Mail}
                      onConfirm={() => batchChasePayments.mutate(selectedIds)}
                      pending={batchChasePayments.isPending}
                      description={tr.plural("queuePaymentChaseAcrossClients", selectedCount)}
                    />
                    <BatchActionButton
                      label={tr("chaseDocuments")}
                      icon={FileSearch}
                      onConfirm={() => batchChaseDocuments.mutate(selectedIds)}
                      pending={batchChaseDocuments.isPending}
                      description={tr.plural("queueDocumentChaseForClients", selectedCount)}
                    />
                  </div>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label={tr("selectAll")}
                      />
                    </TableHead>
                    <TableHead>{tr("client")}</TableHead>
                    <TableHead>{tr("health")}</TableHead>
                    <TableHead>{tr("rating")}</TableHead>
                    <TableHead className="text-end">{tr("revenue")}</TableHead>
                    <TableHead className="text-end">{tr("overdueAr")}</TableHead>
                    <TableHead>{tr("vat")}</TableHead>
                    <TableHead>{tr("lastActivity")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{tr("openClient")}</span>
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
                          aria-label={tr("select", { companyName: c.companyName })}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{c.companyName}</TableCell>
                      <TableCell className="font-mono">{c.score}</TableCell>
                      <TableCell>
                        <Badge className={ratingColor(c.rating)}>{c.rating}</Badge>
                      </TableCell>
                      <TableCell className="text-end">{formatAed(c.revenue)}</TableCell>
                      <TableCell className="text-end">{formatAed(c.overdueBalance)}</TableCell>
                      <TableCell>
                        {c.factors.vatOverdue ? (
                          <Badge variant="destructive">{tr("overdue")}</Badge>
                        ) : (
                          <Badge variant="secondary">OK</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.factors.daysSinceActivity === null
                          ? "—"
                          : tr("dAgo", { daysSinceActivity: c.factors.daysSinceActivity })}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/firm/clients/${c.companyId}`)}
                          data-testid={`button-jump-${c.companyId}`}
                        >
                          {tr("open")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredClients.length === 0 && !healthQuery.isLoading && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                        {search ? tr("noClientsMatchYourSearch") : tr("noClientsYet")}
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
                <CardTitle>{tr("alertFeed")}</CardTitle>
                <Select
                  value={severityFilter}
                  onValueChange={(v) => setSeverityFilter(v as Severity | "all")}
                >
                  <SelectTrigger className="w-[180px]" data-testid="select-severity-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tr("allSeverities")}</SelectItem>
                    <SelectItem value="critical">{tr("critical")}</SelectItem>
                    <SelectItem value="warning">{tr("warning")}</SelectItem>
                    <SelectItem value="info">{tr("info")}</SelectItem>
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
                      a.isRead ? "opacity-60" : ""
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
                          {tr("markRead")}
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
                          <CheckCircle2 className="w-4 h-4 me-1" /> {tr("resolve")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {(alertsQuery.data ?? []).length === 0 && !alertsQuery.isLoading && (
                  <div className="text-center text-muted-foreground py-8">
                    {tr("noActiveAlertsClickRefreshAlerts")}
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
                <Users className="w-4 h-4" /> {tr("staffWorkloadDistribution")}
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
                  {tr("noFirmAdminStaffConfiguredYet")}
                </p>
              )}
              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("staff")}</TableHead>
                    <TableHead>{tr("email")}</TableHead>
                    <TableHead className="text-end">{tr("clients")}</TableHead>
                    <TableHead>{tr("roles")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(workloadQuery.data ?? []).map((w) => (
                    <TableRow key={w.userId}>
                      <TableCell className="font-medium">{w.userName}</TableCell>
                      <TableCell className="text-muted-foreground">{w.userEmail}</TableCell>
                      <TableCell className="text-end">{w.clientCount}</TableCell>
                      <TableCell>
                        {Object.entries(w.rolesByName).map(([role, n]) => (
                          <Badge key={role} variant="outline" className="me-1">
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
                <CardTitle>{tr("periodComparison")}</CardTitle>
                <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
                  <SelectTrigger className="w-[160px]" data-testid="select-granularity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">{tr("monthOverMonth")}</SelectItem>
                    <SelectItem value="quarter">{tr("quarterOverQuarter")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <DeltaCard
                  label={tr("revenue")}
                  value={comparisonQuery.data?.deltas.revenuePct ?? 0}
                />
                <DeltaCard
                  label={tr("receipts")}
                  value={comparisonQuery.data?.deltas.receiptsPct ?? 0}
                />
                <DeltaCard
                  label={tr("invoices")}
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
            positive ? "text-success" : "text-destructive"
          }`}
        >
          {positive ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
          {value > 0 ? "+" : ""}
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
  const tr = pageMessages.useT();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          disabled={pending}
          data-testid={`button-batch-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {pending ? (
            <Loader2 className="w-4 h-4 me-1 animate-spin" />
          ) : (
            <Icon className="w-4 h-4 me-1" />
          )}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tr("confirm", { label })}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{tr("confirm2")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
