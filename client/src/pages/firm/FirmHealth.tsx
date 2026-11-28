import { T } from "@/components/layout/T";
import { PracticeNav } from "@/components/firm/PracticeNav";
import { PageHeader } from "@/components/ui/page-header";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Calendar,
  Building2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format-date";
import { formatMessage, useTranslation } from "@/lib/i18n";

// ─── Types ─────────────────────────────────────────────────────────────────────

type HealthStatus = "healthy" | "attention" | "critical";
type VatStatus = "on-track" | "due-soon" | "overdue";
type DeadlineStatus = "upcoming" | "due-soon" | "overdue";

interface ClientHealth {
  companyId: string;
  companyName: string;
  trn: string | null;
  vatStatus: {
    nextDueDate: string | null;
    daysTilDue: number | null;
    lastFiledDate: string | null;
    status: VatStatus;
  };
  arHealth: {
    totalOutstanding: number;
    overdueAmount: number;
    overdueCount: number;
    status: HealthStatus;
  };
  bankRecStatus: {
    lastRecDate: string | null;
    daysSinceRec: number | null;
    unreconciledCount: number;
    status: HealthStatus;
  };
  trialBalanceStatus: {
    balanced: boolean;
    discrepancy: number;
    status: HealthStatus;
  };
  lastActivity: string | null;
  overallHealth: HealthStatus;
}

interface HealthSummary {
  totalClients: number;
  healthy: number;
  attention: number;
  critical: number;
}

interface HealthData {
  clients: ClientHealth[];
  summary: HealthSummary;
}

interface Deadline {
  companyId: string;
  companyName: string;
  type: "vat" | "corporate-tax" | "audit";
  dueDate: string;
  daysTilDue: number;
  status: DeadlineStatus;
}

interface DeadlinesData {
  deadlines: Deadline[];
}

type SortField = "health" | "name" | "ar" | "vat";
type SortDir = "asc" | "desc";

// ─── Sub-components ────────────────────────────────────────────────────────────

function TrafficDot({ status }: { status: HealthStatus | VatStatus | DeadlineStatus }) {
  const colorMap: Record<string, string> = {
    healthy: "bg-success",
    "on-track": "bg-success",
    upcoming: "bg-success",
    attention: "bg-warning",
    "due-soon": "bg-warning",
    critical: "bg-destructive",
    overdue: "bg-destructive",
  };
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${colorMap[status] ?? "bg-muted-foreground/30"}`}
      aria-hidden
    />
  );
}

function HealthBadge({ status }: { status: HealthStatus }) {
  if (status === "healthy") {
    return (
      <Badge className="bg-success-subtle text-success-subtle-foreground border-success/30 gap-1">
        <CheckCircle2 className="w-3 h-3" />
        <T k="pages.healthy" />
      </Badge>
    );
  }
  if (status === "attention") {
    return (
      <Badge className="bg-warning-subtle text-warning-subtle-foreground border-warning/30 gap-1">
        <AlertTriangle className="w-3 h-3" />
        <T k="pages.attention" />
      </Badge>
    );
  }
  return (
    <Badge className="bg-danger-subtle text-danger-subtle-foreground border-destructive/30 gap-1">
      <XCircle className="w-3 h-3" />
      <T k="pages.critical" />
    </Badge>
  );
}

function DeadlineBadge({ status, daysTilDue }: { status: DeadlineStatus; daysTilDue: number }) {
  const { t } = useTranslation();
  const n = Math.abs(daysTilDue);
  if (status === "overdue") {
    return (
      <Badge className="bg-danger-subtle text-danger-subtle-foreground border-destructive/30">
        {formatMessage(t["firmOps.healthDaysOverdue"], { n })}
      </Badge>
    );
  }
  if (status === "due-soon") {
    return (
      <Badge className="bg-warning-subtle text-warning-subtle-foreground border-warning/30">
        {formatMessage(t["firmOps.healthDueInDays"], { n })}
      </Badge>
    );
  }
  return <Badge variant="outline">{formatMessage(t["firmOps.healthInDays"], { n })}</Badge>;
}

function SortIcon({
  field,
  sortField,
  sortDir,
}: {
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
}) {
  if (field !== sortField) return <ChevronsUpDown className="w-3 h-3 ms-1 text-muted-foreground" />;
  return sortDir === "asc" ? (
    <ChevronUp className="w-3 h-3 ms-1" />
  ) : (
    <ChevronDown className="w-3 h-3 ms-1" />
  );
}

const HEALTH_ORDER: Record<HealthStatus, number> = { critical: 0, attention: 1, healthy: 2 };
const VAT_ORDER: Record<VatStatus, number> = { overdue: 0, "due-soon": 1, "on-track": 2 };

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function FirmHealth() {
  const [, navigate] = useLocation();
  const { t, locale } = useTranslation();
  const [sortField, setSortField] = useState<SortField>("health");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const {
    data: healthData,
    isLoading,
    isError: healthFailed,
    error: healthError,
    refetch: refetchHealth,
    isFetching: healthFetching,
  } = useQuery<HealthData>({
    queryKey: ["/api/firm/health"],
  });

  const {
    data: deadlinesData,
    isError: deadlinesFailed,
    error: deadlinesError,
    refetch: refetchDeadlines,
    isFetching: deadlinesFetching,
  } = useQuery<DeadlinesData>({
    queryKey: ["/api/firm/health/deadlines"],
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sortedClients = [...(healthData?.clients ?? [])].sort((a, b) => {
    let cmp = 0;
    if (sortField === "health") {
      cmp = HEALTH_ORDER[a.overallHealth] - HEALTH_ORDER[b.overallHealth];
    } else if (sortField === "name") {
      cmp = a.companyName.localeCompare(b.companyName);
    } else if (sortField === "ar") {
      cmp = a.arHealth.totalOutstanding - b.arHealth.totalOutstanding;
    } else if (sortField === "vat") {
      cmp = VAT_ORDER[a.vatStatus.status] - VAT_ORDER[b.vatStatus.status];
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const summary = healthData?.summary;
  const deadlines = deadlinesData?.deadlines ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">{t.loading}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow={t["firm.firmLabel"]}
        title={t.healthDashboard}
        description={t.healthDashboardDesc}
      />
      <PracticeNav />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-small font-medium text-muted-foreground">
              {t.totalClients}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-h1 font-semibold tabular-nums">
              {healthFailed ? (
                <>
                  <span aria-hidden>—</span>
                  <span className="sr-only">{t["firm.notAvailable"]}</span>
                </>
              ) : (
                (summary?.totalClients ?? 0)
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-small font-medium text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
              {t.healthy}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-h1 font-semibold tabular-nums">
              {healthFailed ? (
                <>
                  <span aria-hidden>—</span>
                  <span className="sr-only">{t["firm.notAvailable"]}</span>
                </>
              ) : (
                (summary?.healthy ?? 0)
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-small font-medium text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
              {t.needsAttention}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-h1 font-semibold tabular-nums">
              {healthFailed ? (
                <>
                  <span aria-hidden>—</span>
                  <span className="sr-only">{t["firm.notAvailable"]}</span>
                </>
              ) : (
                (summary?.attention ?? 0)
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-small font-medium text-muted-foreground">
              <XCircle className="h-4 w-4 text-danger" aria-hidden />
              {t.critical}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-h1 font-semibold tabular-nums">
              {healthFailed ? (
                <>
                  <span aria-hidden>—</span>
                  <span className="sr-only">{t["firm.notAvailable"]}</span>
                </>
              ) : (
                (summary?.critical ?? 0)
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Client health table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.clientHealthTable}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {healthFailed ? (
            <LoadErrorState
              error={healthError}
              onRetry={() => void refetchHealth()}
              retrying={healthFetching}
              testId="firm-health-load-error"
            />
          ) : sortedClients.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Building2 className="w-10 h-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">{t.noClients}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => handleSort("health")}
                    >
                      <span className="flex items-center">
                        {t.overallHealth}
                        <SortIcon field="health" sortField={sortField} sortDir={sortDir} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => handleSort("name")}
                    >
                      <span className="flex items-center">
                        {t.client}
                        <SortIcon field="name" sortField={sortField} sortDir={sortDir} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => handleSort("vat")}
                    >
                      <span className="flex items-center">
                        {t.vatStatus}
                        <SortIcon field="vat" sortField={sortField} sortDir={sortDir} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => handleSort("ar")}
                    >
                      <span className="flex items-center">
                        {t.arHealth}
                        <SortIcon field="ar" sortField={sortField} sortDir={sortDir} />
                      </span>
                    </TableHead>
                    <TableHead>{t.bankRec}</TableHead>
                    <TableHead>{t.trialBalance}</TableHead>
                    <TableHead>{t.lastActivity}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedClients.map((client) => (
                    <TableRow
                      key={client.companyId}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/firm/clients/${client.companyId}`)}
                    >
                      <TableCell>
                        <HealthBadge status={client.overallHealth} />
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{client.companyName}</p>
                          {client.trn && (
                            <p className="text-xs text-muted-foreground">
                              {formatMessage(t["firmOps.healthTrn"], { trn: client.trn })}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TrafficDot status={client.vatStatus.status} />
                          <span className="text-sm">
                            {client.vatStatus.nextDueDate
                              ? formatDate(client.vatStatus.nextDueDate, locale)
                              : "—"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TrafficDot status={client.arHealth.status} />
                          <span className="text-sm">
                            {client.arHealth.overdueCount > 0
                              ? formatMessage(t["firmOps.healthOverdueCount"], {
                                  n: client.arHealth.overdueCount,
                                })
                              : t["firmOps.healthClear"]}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TrafficDot status={client.bankRecStatus.status} />
                          <span className="text-sm">
                            {client.bankRecStatus.unreconciledCount > 0
                              ? formatMessage(t["firmOps.healthUnmatchedCount"], {
                                  n: client.bankRecStatus.unreconciledCount,
                                })
                              : t["firmOps.healthClear"]}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TrafficDot status={client.trialBalanceStatus.status} />
                          <span className="text-sm">
                            {client.trialBalanceStatus.balanced
                              ? t["firmOps.healthBalanced"]
                              : t["firmOps.healthOff"]}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {client.lastActivity ? formatDate(client.lastActivity, locale) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deadline timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            {t.upcomingDeadlines}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deadlinesFailed ? (
            <LoadErrorState
              error={deadlinesError}
              onRetry={() => void refetchDeadlines()}
              retrying={deadlinesFetching}
              testId="firm-deadlines-load-error"
            />
          ) : deadlines.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 className="w-8 h-8 text-success mb-2" />
              <p className="text-muted-foreground">{t.noDeadlines}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {deadlines.map((dl, idx) => (
                <div
                  key={`${dl.companyId}-${dl.type}-${idx}`}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/40 cursor-pointer transition-colors"
                  onClick={() => navigate(`/firm/clients/${dl.companyId}`)}
                >
                  <div className="flex items-center gap-3">
                    <TrafficDot status={dl.status} />
                    <div>
                      <p className="font-medium text-sm">{dl.companyName}</p>
                      <p className="text-xs text-muted-foreground">
                        {t["firmOps.healthDeadlineVat"]}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      {formatDate(dl.dueDate, locale)}
                    </span>
                    <DeadlineBadge status={dl.status} daysTilDue={dl.daysTilDue} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
