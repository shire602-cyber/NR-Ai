import type * as React from "react";
/**
 * Phase 6: Firm-Wide Command Center
 *
 * Executive dashboard for firm owners with key metrics, client health table,
 * alerts feed, staff workload visualization, period comparison, and batch ops.
 */
import { PracticeNav } from "@/components/firm/PracticeNav";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { StaleDataNotice } from "@/components/ui/stale-data-notice";
import { Skeleton } from "@/components/ui/skeleton";
import { hasReadData, queryReadState } from "@/lib/queryReadState";
import { loadErrorMessage } from "@/lib/loadError";
import { matchesSearchText } from "@shared/arabic-text";
import { PracticePlanTab } from "@/pages/firm/PracticePlanTab";
import { StatCard } from "@/components/ui/stat-card";
import { chartTheme, ChartTooltipContent, formatAxisCompact } from "@/components/ui/chart-theme";
import { T } from "@/components/layout/T";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { formatMessage, useTranslation, translateNow } from "@/lib/i18n";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
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
import {
  FirmEInvoicingCell,
  type FirmEInvoicingValue,
} from "@/components/einvoice/FirmEInvoicingCell";

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
  /** WQ5: e-invoicing state column. */
  einvoicing?: FirmEInvoicingValue | null;
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

/** Spec 2.7: the one KPI tile (StatCard) — no corner icon, no coloured numbers. */
function MetricCard({
  title,
  value,
  subtitle,
  trend,
}: {
  title: string;
  value: React.ReactNode;
  subtitle?: string;
  icon?: unknown;
  trend?: { value: number; label: string };
}) {
  return (
    <StatCard
      label={title}
      value={value}
      hint={subtitle}
      delta={
        trend
          ? {
              label: `${Math.abs(trend.value)}%`,
              direction: trend.value > 0 ? "up" : trend.value < 0 ? "down" : "flat",
              tone: trend.value >= 0 ? "positive" : "negative",
              context: trend.label,
            }
          : undefined
      }
    />
  );
}

// ─── Main page ──────────────────────────────────────────────────────────

const CLIENTS_PAGE_SIZE = 25;

export default function FirmCommandCenter() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
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
      toast({ title: t["firmCommandCenter.alertsRefreshed"] });
    },
    onError: (e: Error) =>
      toast({
        title: translateNow("toasts.refreshFailed"),
        description: loadErrorMessage(e, t),
        variant: "destructive",
      }),
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
        title: translateNow("toasts.batchVatCalcComplete"),
        description: formatMessage(translateNow("toasts.clientsCalculated"), {
          count: data.results?.length ?? 0,
        }),
      });
      setSelectedClients(new Set());
    },
    onError: (e: Error) =>
      toast({
        title: translateNow("toasts.batchVatFailed"),
        description: loadErrorMessage(e, t),
        variant: "destructive",
      }),
  });

  const batchChasePayments = useMutation({
    mutationFn: (companyIds: string[]) =>
      apiRequest("POST", "/api/firm/command-center/batch/chase-payments", { companyIds }),
    onSuccess: (data: { chasedInvoiceCount?: number }) => {
      toast({
        title: translateNow("toasts.paymentChaseQueued"),
        description: formatMessage(translateNow("toasts.invoicesQueued"), {
          chasedInvoiceCount: data.chasedInvoiceCount ?? 0,
        }),
      });
      setSelectedClients(new Set());
    },
    onError: (e: Error) =>
      toast({
        title: translateNow("toasts.chaseFailed"),
        description: loadErrorMessage(e, t),
        variant: "destructive",
      }),
  });

  const batchChaseDocuments = useMutation({
    mutationFn: (companyIds: string[]) =>
      apiRequest("POST", "/api/firm/command-center/batch/chase-documents", { companyIds }),
    onSuccess: (data: { chasedClientCount?: number }) => {
      qc.invalidateQueries({ queryKey: ["/api/firm/command-center/alerts"] });
      toast({
        title: translateNow("toasts.documentChaseQueued"),
        description: formatMessage(translateNow("toasts.clientsNotified"), {
          chasedClientCount: data.chasedClientCount ?? 0,
        }),
      });
      setSelectedClients(new Set());
    },
    onError: (e: Error) =>
      toast({
        title: translateNow("toasts.chaseFailed"),
        description: loadErrorMessage(e, t),
        variant: "destructive",
      }),
  });

  // ─── Derived data ──────────────────────────────────────────────────
  const dashboardState = queryReadState(dashboardQuery);
  const healthState = queryReadState(healthQuery);
  const alertsState = queryReadState(alertsQuery);
  const workloadState = queryReadState(workloadQuery);
  const comparisonState = queryReadState(comparisonQuery);
  const alerts = hasReadData(alertsState) ? (alertsQuery.data ?? []) : [];
  const workload = hasReadData(workloadState) ? (workloadQuery.data ?? []) : [];
  const comparison = hasReadData(comparisonState) ? comparisonQuery.data : undefined;
  const summary = dashboardQuery.data?.summary;
  const allClients = useMemo(
    () => (hasReadData(healthState) ? (healthQuery.data ?? []) : []),
    [healthState, healthQuery.data]
  );
  const filteredClients = useMemo(
    () => allClients.filter((c) => matchesSearchText(search, c.companyName)),
    [allClients, search]
  );
  // Page resets to 1 whenever the search or ranking changes (derived, no effect).
  const resetKey = `${search}|${rankBy}`;
  const [pageState, setPageState] = useState({ page: 1, key: resetKey });
  const page = pageState.key === resetKey ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ page: next, key: resetKey });
  const pageCount = Math.max(1, Math.ceil(filteredClients.length / CLIENTS_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedClients = filteredClients.slice(
    (currentPage - 1) * CLIENTS_PAGE_SIZE,
    currentPage * CLIENTS_PAGE_SIZE
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

  const workloadChartData = workload.map((w) => ({
    name: w.userName,
    clients: w.clientCount,
  }));

  const comparisonChartData = useMemo(() => {
    const c = comparison;
    if (!c) return [];
    return [
      {
        name: t["firmOps.periodPrevious"],
        revenue: c.previous.revenue,
        invoices: c.previous.invoices,
        receipts: c.previous.receipts,
      },
      {
        name: t["firmOps.periodCurrent"],
        revenue: c.current.revenue,
        invoices: c.current.invoices,
        receipts: c.current.receipts,
      },
    ];
  }, [comparison, t]);

  // ─── Render ────────────────────────────────────────────────────────
  if (dashboardState === "error") {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Firm"
          title={t["firmCommandCenter.firmCommandCenter"]}
          testId="page-title"
        />
        <LoadErrorState
          error={dashboardQuery.error}
          onRetry={() => void dashboardQuery.refetch()}
          title={t["pages.failedToLoadFirmDashboard"]}
          testId="firm-command-center-error"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Firm"
        title={t["firmCommandCenter.firmCommandCenter"]}
        testId="page-title"
        description={t["firmCommandCenter.birdSEyeViewAcross"]}
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
            {t["firmCommandCenter.refreshAlerts"]}
          </Button>
        }
      />
      <PracticeNav />

      {dashboardState === "stale" && (
        <StaleDataNotice
          onRetry={() => void dashboardQuery.refetch()}
          testId="firm-command-center-stale"
        />
      )}

      {/* Metrics row */}
      <div className="mobile-keep-cols grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <MetricCard
          title={t["firmCommandCenter.totalClients"]}
          value={summary ? `${summary.totalClients}` : "—"}
          subtitle={
            summary
              ? formatMessage(t["firmCommandCenter.countActive"], { count: summary.activeClients })
              : undefined
          }
          icon={Building2}
        />
        <MetricCard
          title={t["pages.outstandingAr"]}
          value={summary ? <Money amount={summary.totalOutstandingAr} currency="AED" /> : "—"}
          icon={DollarSign}
        />
        <MetricCard
          title={t["firmCommandCenter.vatLiability"]}
          value={summary ? <Money amount={summary.totalVatLiability} currency="AED" /> : "—"}
          subtitle={t["firmCommandCenter.acrossUnfiledReturns"]}
          icon={Calculator}
        />
        <MetricCard
          title={t["firmCommandCenter.receiptsThisMonth"]}
          value={summary ? `${summary.receiptsProcessedThisMonth}` : "—"}
          subtitle={
            summary
              ? formatMessage(t["firmCommandCenter.countInvoicesIssued"], {
                  count: summary.invoicesIssuedThisMonth,
                })
              : undefined
          }
          icon={Activity}
        />
      </div>

      {/* Health summary, folded into one line (spec 3.17: no second tile row). */}
      {summary && (
        <p className="text-small text-muted-foreground" data-testid="command-center-health-line">
          <T k="pages.averageHealthScore" />{" "}
          <span className="font-medium tabular-nums text-foreground">
            {summary.averageHealthScore}
          </span>
          {" · "}
          <T k="pages.criticalAlerts" />{" "}
          <span
            className={`font-medium tabular-nums ${summary.criticalAlertCount ? "text-danger" : "text-foreground"}`}
          >
            {summary.criticalAlertCount}
          </span>
          {" · "}
          <T k="pages.warnings" />{" "}
          <span className="font-medium tabular-nums text-foreground">
            {summary.warningAlertCount}
          </span>
        </p>
      )}

      <Tabs defaultValue="clients" className="space-y-4">
        <TabsList>
          <TabsTrigger value="clients">
            <T k="pages.clientHealth" />
          </TabsTrigger>
          <TabsTrigger value="alerts">
            <T k="pages.alerts" />
          </TabsTrigger>
          <TabsTrigger value="staff">
            <T k="pages.staffWorkload" />
          </TabsTrigger>
          <TabsTrigger value="comparison">
            <T k="pages.periodComparison" />
          </TabsTrigger>
          <TabsTrigger value="plan" data-testid="command-center-tab-plan">
            {t["firmOps.tabPlan"]}
          </TabsTrigger>
        </TabsList>

        {/* ─── Client health tab ─── */}
        <TabsContent value="clients" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2 flex-1 max-w-md">
                  <Search className="w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={t["firmCommandCenter.searchClients"]}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    data-testid="input-search-clients"
                  />
                </div>
                <Select value={rankBy} onValueChange={(v) => setRankBy(v as RankBy)}>
                  <SelectTrigger
                    className="w-[200px]"
                    aria-label={t["firmOps.ariaRankBy"]}
                    data-testid="select-rank-by"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="health">
                      <T k="pages.sortByHealth" />
                    </SelectItem>
                    <SelectItem value="revenue">
                      <T k="pages.sortByRevenue" />
                    </SelectItem>
                    <SelectItem value="overdue">
                      <T k="pages.sortByOverdueAr" />
                    </SelectItem>
                    <SelectItem value="compliance">
                      <T k="pages.sortByCompliance" />
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {healthState === "stale" && (
                <div className="mb-3">
                  <StaleDataNotice
                    onRetry={() => void healthQuery.refetch()}
                    testId="clients-health-stale"
                  />
                </div>
              )}
              {selectedCount > 0 && (
                <div className="flex items-center gap-2 mb-3 p-3 rounded-md bg-muted">
                  <span className="text-sm font-medium">
                    {formatMessage(t["firm.selectedCount"], { count: selectedCount })}
                  </span>
                  <div className="ms-auto flex gap-2">
                    <BatchActionButton
                      label={t["firmCommandCenter.runVatCalc"]}
                      icon={Calculator}
                      onConfirm={() => batchVat.mutate(selectedIds)}
                      pending={batchVat.isPending}
                      description={formatMessage(t["firmOps.batchVatDescription"], {
                        count: selectedCount,
                      })}
                    />
                    <BatchActionButton
                      label={t["firmCommandCenter.chasePayments"]}
                      icon={Mail}
                      onConfirm={() => batchChasePayments.mutate(selectedIds)}
                      pending={batchChasePayments.isPending}
                      description={formatMessage(t["firmOps.batchChasePaymentsDescription"], {
                        count: selectedCount,
                      })}
                    />
                    <BatchActionButton
                      label={t["firmCommandCenter.chaseDocuments"]}
                      icon={FileSearch}
                      onConfirm={() => batchChaseDocuments.mutate(selectedIds)}
                      pending={batchChaseDocuments.isPending}
                      description={formatMessage(t["firmOps.batchChaseDocumentsDescription"], {
                        count: selectedCount,
                      })}
                    />
                  </div>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        touchTarget
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label={t["firmCommandCenter.selectAll"]}
                      />
                    </TableHead>
                    <TableHead>
                      <T k="pages.client" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.health" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.rating" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pages.revenue" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pages.overdueAr" />
                    </TableHead>
                    <TableHead>VAT</TableHead>
                    <TableHead>{t["firm.einvoicingState.column"]}</TableHead>
                    <TableHead>
                      <T k="pages.lastActivity" />
                    </TableHead>
                    <TableHead>
                      <span className="sr-only">
                        <T k="pages.openClient" />
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedClients.map((c) => (
                    <TableRow key={c.companyId} data-testid={`row-client-${c.companyId}`}>
                      <TableCell>
                        <Checkbox
                          touchTarget
                          checked={selectedClients.has(c.companyId)}
                          onCheckedChange={() => toggleClient(c.companyId)}
                          aria-label={formatMessage(t["firmOps.selectClient"], {
                            name: c.companyName,
                          })}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{c.companyName}</TableCell>
                      <TableCell className="tabular-nums">{c.score}</TableCell>
                      <TableCell>
                        <Badge className={ratingColor(c.rating)}>
                          <T
                            k={`firm.rating${c.rating.charAt(0).toUpperCase()}${c.rating.slice(1)}`}
                          />
                        </Badge>
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={c.revenue} currency="AED" />
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={c.overdueBalance} currency="AED" />
                      </TableCell>
                      <TableCell>
                        {c.factors.vatOverdue ? (
                          <Badge variant="danger">
                            <T k="pages.overdue" />
                          </Badge>
                        ) : (
                          <Badge variant="success">
                            <T k="firm.vatOk" />
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <FirmEInvoicingCell value={c.einvoicing} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.factors.daysSinceActivity === null
                          ? "—"
                          : formatMessage(t["firm.daysAgo"], {
                              days: c.factors.daysSinceActivity,
                            })}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/firm/clients/${c.companyId}`)}
                          data-testid={`button-jump-${c.companyId}`}
                        >
                          <T k="pages.open" />
                          <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {healthState === "pending" && (
                    <TableRow>
                      <TableCell colSpan={10}>
                        <Skeleton className="h-24 w-full" data-testid="clients-health-loading" />
                      </TableCell>
                    </TableRow>
                  )}
                  {healthState === "error" && (
                    <TableRow>
                      <TableCell colSpan={10}>
                        <LoadErrorState
                          compact
                          error={healthQuery.error}
                          onRetry={() => void healthQuery.refetch()}
                          testId="clients-health-error"
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredClients.length === 0 && hasReadData(healthState) && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                        {search
                          ? t["firmCommandCenter.noClientsMatchYourSearch"]
                          : t["pages.noClientsYet"]}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {pageCount > 1 && (
                <nav
                  className="mt-3 flex items-center justify-between gap-3"
                  aria-label={t["firm.pageOf"]}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage <= 1}
                    onClick={() => setPage(currentPage - 1)}
                    data-testid="cc-clients-prev"
                  >
                    {t["firm.previousPage"]}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {formatMessage(t["firm.pageOf"], { page: currentPage, pages: pageCount })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage >= pageCount}
                    onClick={() => setPage(currentPage + 1)}
                    data-testid="cc-clients-next"
                  >
                    {t["firm.nextPage"]}
                  </Button>
                </nav>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Alerts tab ─── */}
        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>
                  <T k="pages.alertFeed" />
                </CardTitle>
                <Select
                  value={severityFilter}
                  onValueChange={(v) => setSeverityFilter(v as Severity | "all")}
                >
                  <SelectTrigger
                    className="w-[180px]"
                    aria-label={t["firmOps.ariaSeverityFilter"]}
                    data-testid="select-severity-filter"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <T k="pages.allSeverities" />
                    </SelectItem>
                    <SelectItem value="critical">
                      <T k="pages.critical" />
                    </SelectItem>
                    <SelectItem value="warning">
                      <T k="pages.warning" />
                    </SelectItem>
                    <SelectItem value="info">{t["firm.anomalySeverityInfo"]}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {alertsState === "stale" && (
                  <StaleDataNotice
                    onRetry={() => void alertsQuery.refetch()}
                    testId="alerts-stale"
                  />
                )}
                {alertsState === "pending" && (
                  <Skeleton className="h-24 w-full" data-testid="alerts-loading" />
                )}
                {alerts.map((a) => (
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
                          <T k="pages.markRead" />
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
                          <CheckCircle2 className="w-4 h-4 me-1" /> <T k="pages.resolve" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {alertsState === "error" && (
                  <LoadErrorState
                    compact
                    error={alertsQuery.error}
                    onRetry={() => void alertsQuery.refetch()}
                    testId="alerts-error"
                  />
                )}
                {alerts.length === 0 && hasReadData(alertsState) && (
                  <div className="text-center text-muted-foreground py-8">
                    {t["firmCommandCenter.noActiveAlertsClickRefresh"]}
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
                <Users className="w-4 h-4" /> <T k="pages.staffWorkloadDistribution" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {workloadState === "stale" && (
                <StaleDataNotice
                  onRetry={() => void workloadQuery.refetch()}
                  testId="workload-stale"
                />
              )}
              {workloadState === "pending" ? (
                <Skeleton className="h-24 w-full" data-testid="workload-loading" />
              ) : workloadState === "error" ? (
                <LoadErrorState
                  compact
                  error={workloadQuery.error}
                  onRetry={() => void workloadQuery.refetch()}
                  testId="workload-error"
                />
              ) : workloadChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={workloadChartData}>
                    <CartesianGrid {...chartTheme.grid} />
                    <XAxis dataKey="name" {...chartTheme.xAxis} />
                    <YAxis {...chartTheme.yAxis} allowDecimals={false} />
                    <RechartsTooltip {...chartTheme.tooltip} content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="clients"
                      {...chartTheme.bar("brand")}
                      name={t["firmOps.chartClientsAssigned"]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  {t["firmOps.noFirmAdminStaff"]}
                </p>
              )}
              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="pages.staff" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.email" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pages.clients" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.roles" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workload.map((w) => (
                    <TableRow key={w.userId}>
                      <TableCell className="font-medium">{w.userName}</TableCell>
                      <TableCell className="text-muted-foreground">{w.userEmail}</TableCell>
                      <TableCell data-numeric>{w.clientCount}</TableCell>
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
                <CardTitle>
                  <T k="pages.periodComparison" />
                </CardTitle>
                <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
                  <SelectTrigger
                    className="w-[160px]"
                    aria-label={t["firmOps.ariaGranularity"]}
                    data-testid="select-granularity"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">
                      <T k="pages.monthOverMonth" />
                    </SelectItem>
                    <SelectItem value="quarter">
                      <T k="pages.quarterOverQuarter" />
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {comparisonState === "stale" && (
                <div className="mb-3">
                  <StaleDataNotice
                    onRetry={() => void comparisonQuery.refetch()}
                    testId="comparison-stale"
                  />
                </div>
              )}
              {comparisonState === "pending" && (
                <Skeleton className="h-24 w-full" data-testid="comparison-loading" />
              )}
              {comparisonState === "error" && (
                <LoadErrorState
                  compact
                  error={comparisonQuery.error}
                  onRetry={() => void comparisonQuery.refetch()}
                  testId="comparison-error"
                />
              )}
              {comparison && (
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <DeltaCard label={t["pages.revenue"]} value={comparison.deltas.revenuePct} />
                  <DeltaCard
                    label={t["shell.nav.receipts"]}
                    value={comparison.deltas.receiptsPct}
                  />
                  <DeltaCard
                    label={t["shell.nav.invoices"]}
                    value={comparison.deltas.invoicesPct}
                  />
                </div>
              )}
              {comparison && (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={comparisonChartData}>
                    <CartesianGrid {...chartTheme.grid} />
                    <XAxis dataKey="name" {...chartTheme.xAxis} />
                    <YAxis {...chartTheme.yAxis} tickFormatter={formatAxisCompact} />
                    <RechartsTooltip {...chartTheme.tooltip} content={<ChartTooltipContent />} />
                    <Legend />
                    <Bar
                      dataKey="revenue"
                      {...chartTheme.bar("brand")}
                      name={t["firmOps.chartRevenue"]}
                    />
                    <Bar
                      dataKey="invoices"
                      {...chartTheme.bar("slate")}
                      name={t["firmOps.chartInvoices"]}
                    />
                    <Bar
                      dataKey="receipts"
                      {...chartTheme.bar("ochre")}
                      name={t["firmOps.chartReceipts"]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Service plan tab (matrix, planner, VAT workspace; moved off /firm/clients) ─── */}
        <TabsContent value="plan">
          <PracticePlanTab />
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
  const { t } = useTranslation();
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
          <AlertDialogTitle>
            {formatMessage(t["firmOps.confirmAction"], { action: label })}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <T k="pages.cancel" />
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            <T k="pages.confirm" />
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
