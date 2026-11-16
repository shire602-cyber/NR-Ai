// ClientPortfolio module (W5-D split of ClientPortfolio.tsx; no behaviour change).
import { T } from "@/components/layout/T";
import { useMemo, useState } from "react";
import {
  LayoutGrid,
  ChevronRight,
  Users,
  Calendar,
  BookOpen,
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Clock,
  FileText,
  TrendingUp,
  UserCheck,
  Target,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { CLIENT_SERVICE_OPTIONS } from "@shared/client-services";
import type {
  BookkeeperClient,
  BookkeeperDashboard,
  BookkeeperPriority,
  BookkeeperQueueKey,
} from "./types";
import {
  blockerPreview,
  clientIntervention,
  formatAed,
  formatDateShort,
  formatDays,
  hasClientService,
  interventionClass,
  ownerPreview,
  priorityClass,
  priorityScore,
  productionItem,
  queueConfig,
  sortProductionItems,
} from "./helpers";
import { PriorityBadge } from "./badges";

export function BookkeeperCommandCenter({
  dashboard,
  onOpenBooks,
  onViewProfile,
  onOpenBrief,
  onManageStaff,
}: {
  dashboard?: BookkeeperDashboard;
  onOpenBooks: (companyId: string) => void;
  onViewProfile: (companyId: string) => void;
  onOpenBrief: (companyId: string) => void;
  onManageStaff: () => void;
}) {
  const [activeQueue, setActiveQueue] = useState<BookkeeperQueueKey>("vat");
  const dashboardClients = useMemo(() => dashboard?.clients ?? [], [dashboard?.clients]);
  const workloadOwners = useMemo(
    () => dashboard?.workload?.owners ?? [],
    [dashboard?.workload?.owners]
  );
  const priorityClients = dashboardClients.slice(0, 5);
  const activeQueueItems = dashboard?.queues?.[activeQueue] ?? [];
  const productionBuckets = useMemo(() => {
    const deadlineItems = sortProductionItems(
      dashboardClients.map((client) => productionItem(client))
    );
    return [
      {
        key: "overdue",
        title: "Overdue / Due Now",
        icon: AlertTriangle,
        items: deadlineItems
          .filter((item) => item.daysTilDue !== null && item.daysTilDue <= 0)
          .slice(0, 5),
      },
      {
        key: "week",
        title: "This Week",
        icon: Clock,
        items: deadlineItems
          .filter((item) => item.daysTilDue !== null && item.daysTilDue > 0 && item.daysTilDue <= 7)
          .slice(0, 5),
      },
      {
        key: "month",
        title: "Next 28 Days",
        icon: Calendar,
        items: deadlineItems
          .filter(
            (item) => item.daysTilDue !== null && item.daysTilDue > 7 && item.daysTilDue <= 28
          )
          .slice(0, 5),
      },
      {
        key: "blocked",
        title: "Close Blockers",
        icon: TrendingUp,
        items: sortProductionItems(
          dashboardClients
            .filter((client) => client.bookkeeping.status !== "on_track")
            .map((client) => productionItem(client, "Close"))
        ).slice(0, 5),
      },
      {
        key: "unassigned",
        title: "Unassigned",
        icon: UserCheck,
        items: deadlineItems.filter((item) => item.client.assignedStaff.length === 0).slice(0, 5),
      },
    ];
  }, [dashboardClients]);
  const capacityPlanner = useMemo(() => {
    const unassigned = dashboardClients
      .filter((client) => client.assignedStaff.length === 0)
      .sort((a, b) => priorityScore(b.priority) - priorityScore(a.priority))
      .slice(0, 5);
    const overloaded = workloadOwners
      .filter(
        (owner) =>
          owner.staffId !== null &&
          (owner.critical >= 3 || owner.clientCount >= 15 || owner.averageCloseProgress < 60)
      )
      .slice(0, 5);
    const openCapacity = workloadOwners
      .filter(
        (owner) =>
          owner.staffId !== null &&
          owner.clientCount < 10 &&
          owner.critical === 0 &&
          owner.averageCloseProgress >= 70
      )
      .sort(
        (a, b) => a.clientCount - b.clientCount || b.averageCloseProgress - a.averageCloseProgress
      )
      .slice(0, 5);
    return { unassigned, overloaded, openCapacity };
  }, [dashboardClients, workloadOwners]);
  const interventionRadar = useMemo(() => {
    const rankedClients = [...dashboardClients].sort((a, b) => {
      const interventionDelta = clientIntervention(b).score - clientIntervention(a).score;
      if (interventionDelta !== 0) return interventionDelta;
      return priorityScore(b.priority) - priorityScore(a.priority);
    });
    return {
      high: rankedClients
        .filter((client) => clientIntervention(client).level === "high")
        .slice(0, 4),
      watchlist: rankedClients
        .filter((client) => clientIntervention(client).level === "medium")
        .slice(0, 4),
      exposure: rankedClients
        .filter((client) => clientIntervention(client).exposureAed > 0)
        .sort((a, b) => clientIntervention(b).exposureAed - clientIntervention(a).exposureAed)
        .slice(0, 4),
    };
  }, [dashboardClients]);
  const serviceLaneForecast = useMemo(() => {
    const clients = dashboardClients;
    const corporateTaxClients = clients.filter((client) =>
      hasClientService(client, "corporate_tax")
    );
    const bookkeepingClients = clients.filter((client) => hasClientService(client, "bookkeeping"));
    const accountingClients = clients.filter((client) => hasClientService(client, "accounting"));
    const makeRow = (
      label: string,
      rowClients: BookkeeperClient[],
      metric: string,
      action: string,
      risk: BookkeeperPriority | "filed" = "on_track"
    ) => ({
      label,
      count: rowClients.length,
      metric,
      action,
      risk,
      primaryCompanyId: rowClients[0]?.companyId,
      sample: rowClients
        .slice(0, 2)
        .map((client) => client.companyName)
        .join(", "),
    });
    const sortedByIntervention = (rowClients: BookkeeperClient[]) =>
      [...rowClients].sort((a, b) => clientIntervention(b).score - clientIntervention(a).score);
    const ctOpen = corporateTaxClients.filter((client) => client.corporateTax.status !== "filed");
    const bookkeepingBlocked = sortedByIntervention(
      bookkeepingClients.filter((client) => client.bookkeeping.status === "critical")
    );
    const bookkeepingAttention = sortedByIntervention(
      bookkeepingClients.filter((client) => client.bookkeeping.status === "attention")
    );
    const bookkeepingReady = bookkeepingClients
      .filter(
        (client) =>
          client.bookkeeping.status === "on_track" && client.bookkeeping.closeProgress >= 90
      )
      .sort((a, b) => b.bookkeeping.closeProgress - a.bookkeeping.closeProgress);
    const accountingVariance = sortedByIntervention(
      accountingClients.filter((client) => client.accounting.status === "critical")
    );
    const accountingReview = sortedByIntervention(
      accountingClients.filter((client) => client.accounting.status === "attention")
    );
    const accountingClean = accountingClients.filter(
      (client) => client.accounting.status === "on_track"
    );

    return [
      {
        key: "vat",
        title: "VAT Cohorts",
        icon: Calendar,
        rows: (dashboard?.vatCohorts ?? []).slice(0, 3).map((cohort) => ({
          label: cohort.label,
          count: cohort.clientCount,
          metric: `${cohort.dueSoon} due · ${cohort.blocked} blocked`,
          action:
            cohort.blocked > 0
              ? "Clear blockers"
              : cohort.dueSoon > 0
                ? "Prepare returns"
                : "Monitor cohort",
          risk:
            cohort.blocked > 0
              ? ("critical" as const)
              : cohort.dueSoon > 0
                ? ("attention" as const)
                : ("on_track" as const),
          primaryCompanyId: cohort.clients[0]?.companyId,
          sample: cohort.clients
            .slice(0, 2)
            .map((client) => client.companyName)
            .join(", "),
        })),
      },
      {
        key: "ct",
        title: "Corporate Tax",
        icon: Calculator,
        rows: [
          makeRow(
            "Due in 30d",
            sortedByIntervention(
              ctOpen.filter((client) => (client.corporateTax.daysTilDue ?? 9999) <= 30)
            ),
            "urgent filings",
            "Lock filing plan",
            "critical"
          ),
          makeRow(
            "Due in 90d",
            sortedByIntervention(
              ctOpen.filter((client) => {
                const days = client.corporateTax.daysTilDue ?? 9999;
                return days > 30 && days <= 90;
              })
            ),
            "preparation window",
            "Start readiness review",
            "attention"
          ),
          makeRow(
            "Future / parked",
            sortedByIntervention(
              ctOpen.filter((client) => (client.corporateTax.daysTilDue ?? 9999) > 90)
            ),
            "future filings",
            "Monitor readiness"
          ),
        ],
      },
      {
        key: "bookkeeping",
        title: "Bookkeeping Close",
        icon: TrendingUp,
        rows: [
          makeRow(
            "Blocked",
            bookkeepingBlocked,
            "source docs / bank gaps",
            "Clear blockers",
            "critical"
          ),
          makeRow(
            "In progress",
            bookkeepingAttention,
            "needs staff push",
            "Finish close work",
            "attention"
          ),
          makeRow("Review-ready", bookkeepingReady, "90%+ close-ready", "Manager review"),
        ],
      },
      {
        key: "accounting",
        title: "Accounting Review",
        icon: CheckCircle2,
        rows: [
          makeRow(
            "TB variance",
            accountingVariance,
            "requires correction",
            "Review journals",
            "critical"
          ),
          makeRow(
            "Needs journals",
            accountingReview,
            "posting required",
            "Post activity",
            "attention"
          ),
          makeRow("Clean files", accountingClean, "balanced ledgers", "Keep cadence"),
        ],
      },
    ];
  }, [dashboardClients, dashboard?.vatCohorts]);
  const ctClients = dashboardClients
    .filter(
      (client) =>
        hasClientService(client, "corporate_tax") && client.corporateTax.status !== "filed"
    )
    .sort((a, b) => (a.corporateTax.daysTilDue ?? 9999) - (b.corporateTax.daysTilDue ?? 9999))
    .slice(0, 4);
  const closeClients = dashboardClients
    .filter(
      (client) =>
        hasClientService(client, "bookkeeping") && client.bookkeeping.status !== "on_track"
    )
    .slice(0, 4);
  const accountingClients = dashboardClients
    .filter(
      (client) => hasClientService(client, "accounting") && client.accounting.status !== "on_track"
    )
    .slice(0, 4);

  return (
    <section className="space-y-4" data-testid="bookkeeper-command-center">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            <T k="pages.nrBookkeeperCommandCenter" />
          </h2>
          <p className="text-sm text-muted-foreground">
            VAT cohorts, corporate tax deadlines, monthly close blockers, and accounting review
            across the client portfolio.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
            <Clock className="w-3.5 h-3.5" />
            {dashboard?.generatedAt
              ? `Updated ${format(new Date(dashboard.generatedAt), "MMM d, HH:mm")}`
              : "Loading"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                <T k="pages.critical" />
              </p>
              <AlertTriangle className="w-4 h-4 text-destructive" />
            </div>
            <p className="text-2xl font-bold mt-1">{dashboard?.summary.critical ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">VAT due 28d</p>
              <Calendar className="w-4 h-4 text-warning" />
            </div>
            <p className="text-2xl font-bold mt-1">{dashboard?.summary.vatDue28Days ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">CT due 90d</p>
              <Calculator className="w-4 h-4 text-info" />
            </div>
            <p className="text-2xl font-bold mt-1">
              {dashboard?.summary.corporateTaxDue90Days ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                <T k="pages.closeBlocked" />
              </p>
              <FileText className="w-4 h-4 text-warning" />
            </div>
            <p className="text-2xl font-bold mt-1">{dashboard?.summary.bookkeepingBlocked ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                <T k="pages.clientServiceMatrix" />
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Scope every client by service before planning VAT, corporate tax, bookkeeping, or
                accounting work.
              </p>
            </div>
            <Badge variant="outline">{dashboard?.summary.totalClients ?? 0} clients</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {(
              dashboard?.serviceMatrix ??
              CLIENT_SERVICE_OPTIONS.map((option) => ({
                code: option.code,
                label: option.label,
                shortLabel: option.shortLabel,
                clientCount: 0,
                critical: 0,
                attention: 0,
              }))
            ).map((service) => (
              <div key={service.code} className="rounded-md border bg-muted/20 p-3">
                <p className="text-sm font-medium">{service.label}</p>
                <p className="text-2xl font-bold mt-1">{service.clientCount}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {service.critical} critical · {service.attention} attention
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              <T k="pages.productionPlanner" />
            </CardTitle>
            <Badge variant="outline">
              {productionBuckets.reduce((total, bucket) => total + bucket.items.length, 0)} visible
              items
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            {productionBuckets.map((bucket) => {
              const Icon = bucket.icon;
              return (
                <div key={bucket.key} className="rounded-md border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Icon className="w-4 h-4 text-primary" />
                      {bucket.title}
                    </p>
                    <Badge variant="outline">{bucket.items.length}</Badge>
                  </div>
                  <div className="mt-3 space-y-2 min-h-[132px]">
                    {bucket.items.length === 0 && (
                      <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-xs text-muted-foreground text-center">
                        <T k="pages.clear" />
                      </div>
                    )}
                    {bucket.items.map((item) => (
                      <button
                        key={`${bucket.key}-${item.client.companyId}`}
                        type="button"
                        onClick={() => onOpenBrief(item.client.companyId)}
                        className="w-full rounded-md border bg-background px-2.5 py-2 text-start hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {item.client.companyName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {item.label} · {formatDays(item.daysTilDue)}
                            </p>
                          </div>
                          <PriorityBadge priority={item.client.priority} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 truncate">{item.metric}</p>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-primary" />
                <T k="pages.staffCapacityPlanner" />
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Balance owners before VAT, CT, and close work becomes a bottleneck.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={onManageStaff}>
              <Users className="w-4 h-4 me-2" />
              <T k="pages.manageStaff" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  <T k="pages.unassignedIntake" />
                </p>
                <Badge variant={capacityPlanner.unassigned.length > 0 ? "destructive" : "outline"}>
                  {capacityPlanner.unassigned.length}
                </Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[128px]">
                {capacityPlanner.unassigned.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-xs text-muted-foreground text-center">
                    <T k="pages.noUnassignedClients" />
                  </div>
                )}
                {capacityPlanner.unassigned.map((client) => (
                  <div
                    key={`unassigned-${client.companyId}`}
                    className="rounded-md border bg-background px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{client.companyName}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {client.nextBestAction}
                        </p>
                      </div>
                      <PriorityBadge priority={client.priority} />
                    </div>
                    <div className="flex gap-1 mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenBrief(client.companyId)}
                      >
                        <T k="pages.brief" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={onManageStaff}>
                        <T k="pages.assign" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  <T k="pages.overloadedOwners" />
                </p>
                <Badge variant={capacityPlanner.overloaded.length > 0 ? "secondary" : "outline"}>
                  {capacityPlanner.overloaded.length}
                </Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[128px]">
                {capacityPlanner.overloaded.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-xs text-muted-foreground text-center">
                    <T k="pages.noCapacityPressure" />
                  </div>
                )}
                {capacityPlanner.overloaded.map((owner) => (
                  <div
                    key={`overloaded-${owner.staffId}`}
                    className="rounded-md border bg-background px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{owner.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {owner.clientCount} clients · {owner.averageCloseProgress}% avg close
                        </p>
                      </div>
                      <Badge variant={owner.critical > 0 ? "destructive" : "secondary"}>
                        {owner.critical} critical
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2 text-caption text-muted-foreground">
                      <span>{owner.vatDue28Days} VAT</span>
                      <span>{owner.corporateTaxDue90Days} CT</span>
                      <span>{owner.bookkeepingBlocked} close blocked</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  <T k="pages.availableCapacity" />
                </p>
                <Badge variant="outline">{capacityPlanner.openCapacity.length}</Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[128px]">
                {capacityPlanner.openCapacity.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-xs text-muted-foreground text-center">
                    <T k="pages.noLowLoadOwnerFound" />
                  </div>
                )}
                {capacityPlanner.openCapacity.map((owner) => (
                  <div
                    key={`capacity-${owner.staffId}`}
                    className="rounded-md border bg-background px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{owner.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {owner.clientCount} clients · {owner.averageCloseProgress}% avg close
                        </p>
                      </div>
                      <Badge variant="outline">
                        <T k="pages.canTakeWork" />
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {owner.vatDue28Days} VAT due · {owner.bookkeepingBlocked} close blocked
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                <T k="pages.interventionRadar" />
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Prioritize files by deadline pressure, source-document gaps, owner gaps, and
                collection exposure.
              </p>
            </div>
            <div className="flex gap-2">
              <Badge
                variant={
                  (dashboard?.summary.interventionHigh ?? interventionRadar.high.length) > 0
                    ? "destructive"
                    : "outline"
                }
              >
                {dashboard?.summary.interventionHigh ?? interventionRadar.high.length} high
              </Badge>
              <Badge variant="secondary">
                {dashboard?.summary.interventionMedium ?? interventionRadar.watchlist.length}{" "}
                watchlist
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  <T k="pages.escalateToday" />
                </p>
                <Badge variant={interventionRadar.high.length > 0 ? "destructive" : "outline"}>
                  {interventionRadar.high.length}
                </Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[154px]">
                {interventionRadar.high.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-6 text-xs text-muted-foreground text-center">
                    <T k="pages.noHighRiskInterventions" />
                  </div>
                )}
                {interventionRadar.high.map((client) => {
                  const intervention = clientIntervention(client);
                  return (
                    <div
                      key={`intervention-high-${client.companyId}`}
                      className="rounded-md border bg-background px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{client.companyName}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {intervention.title}
                          </p>
                        </div>
                        <Badge className={interventionClass(intervention.level)}>
                          {intervention.score}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        {intervention.deadlineLabel}
                      </p>
                      <p className="text-xs font-medium mt-1">{intervention.ownerAction}</p>
                      <div className="flex gap-1 mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenBrief(client.companyId)}
                        >
                          <T k="pages.brief" />
                        </Button>
                        <Button size="sm" onClick={() => onOpenBooks(client.companyId)}>
                          Open
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  <T k="pages.watchlist" />
                </p>
                <Badge variant="secondary">{interventionRadar.watchlist.length}</Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[154px]">
                {interventionRadar.watchlist.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-6 text-xs text-muted-foreground text-center">
                    <T k="pages.noMediumRiskWatchlist" />
                  </div>
                )}
                {interventionRadar.watchlist.map((client) => {
                  const intervention = clientIntervention(client);
                  return (
                    <button
                      key={`intervention-watch-${client.companyId}`}
                      type="button"
                      onClick={() => onOpenBrief(client.companyId)}
                      className="w-full rounded-md border bg-background px-3 py-2 text-start hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{client.companyName}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {intervention.ownerAction}
                          </p>
                        </div>
                        <Badge className={interventionClass(intervention.level)}>
                          {intervention.score}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 truncate">
                        {intervention.reasons.slice(0, 2).join(" · ")}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  <T k="pages.collectionExposure" />
                </p>
                <Badge variant="outline">{interventionRadar.exposure.length}</Badge>
              </div>
              <div className="mt-3 space-y-2 min-h-[154px]">
                {interventionRadar.exposure.length === 0 && (
                  <div className="rounded-md border border-dashed bg-background/70 px-3 py-6 text-xs text-muted-foreground text-center">
                    <T k="pages.noOpenExposureInRadar" />
                  </div>
                )}
                {interventionRadar.exposure.map((client) => {
                  const intervention = clientIntervention(client);
                  return (
                    <div
                      key={`intervention-exposure-${client.companyId}`}
                      className="rounded-md border bg-background px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{client.companyName}</p>
                          <p className="text-xs text-muted-foreground">
                            {client.bookkeeping.overdueInvoiceCount} overdue invoices
                          </p>
                        </div>
                        <Badge variant="outline">{formatAed(intervention.exposureAed)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 truncate">
                        {intervention.ownerAction}
                      </p>
                      <div className="flex gap-1 mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenBrief(client.companyId)}
                        >
                          <T k="pages.brief" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onViewProfile(client.companyId)}
                        >
                          <T k="pages.profile" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-primary" />
                <T k="pages.serviceLaneForecast" />
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                One portfolio view for VAT cohorts, corporate tax, bookkeeping close, and accounting
                review cadence.
              </p>
            </div>
            <Badge variant="outline">{dashboard?.summary.totalClients ?? 0} clients</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {serviceLaneForecast.map((lane) => {
              const Icon = lane.icon;
              return (
                <div key={lane.key} className="rounded-md border bg-muted/20 p-3">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Icon className="w-4 h-4 text-primary" />
                    {lane.title}
                  </p>
                  <div className="mt-3 space-y-2">
                    {lane.rows.map((row) => (
                      <button
                        key={`${lane.key}-${row.label}`}
                        type="button"
                        onClick={() => row.primaryCompanyId && onOpenBrief(row.primaryCompanyId)}
                        disabled={!row.primaryCompanyId}
                        className="w-full rounded-md border bg-background px-3 py-2 text-start transition-colors enabled:hover:bg-muted/50 disabled:cursor-default"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{row.label}</p>
                            <p className="text-xs text-muted-foreground truncate">{row.metric}</p>
                          </div>
                          <Badge className={priorityClass(row.risk)}>{row.count}</Badge>
                        </div>
                        <p className="text-xs font-medium mt-2 truncate">{row.action}</p>
                        <p className="text-caption text-muted-foreground mt-1 truncate">
                          {row.sample || "No active clients"}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] gap-3">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                <T k="pages.actionQueues" />
              </CardTitle>
              <Badge variant="outline">{activeQueueItems.length} active</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(queueConfig) as BookkeeperQueueKey[]).map((key) => {
                const Icon = queueConfig[key].icon;
                const count = dashboard?.queues?.[key]?.length ?? 0;
                return (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={activeQueue === key ? "secondary" : "outline"}
                    onClick={() => setActiveQueue(key)}
                    className="gap-1.5"
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {queueConfig[key].label}
                    <span className="text-xs text-muted-foreground">{count}</span>
                  </Button>
                );
              })}
            </div>

            <div className="space-y-2">
              {activeQueueItems.length === 0 && (
                <div className="rounded-md border border-dashed bg-muted/20 px-3 py-6 text-center">
                  <p className="text-sm font-medium">
                    <T k="pages.noActiveQueueItems" />
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    <T k="pages.thisLaneIsClearForNow" />
                  </p>
                </div>
              )}
              {activeQueueItems.slice(0, 6).map((item) => (
                <div
                  key={`${activeQueue}-${item.companyId}`}
                  className="rounded-md border px-3 py-2.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-sm truncate">{item.companyName}</p>
                        <PriorityBadge priority={item.priority} />
                        <span className="text-xs text-muted-foreground">{item.metric}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">{item.action}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <UserCheck className="w-3.5 h-3.5" />
                          {ownerPreview(item.ownerNames)}
                        </span>
                        <span>
                          {formatDateShort(item.dueDate)} · {formatDays(item.daysTilDue)}
                        </span>
                        {item.blockers.length > 1 && <span>{item.blockers.length} blockers</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 sm:shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenBrief(item.companyId)}
                      >
                        <T k="pages.brief" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onViewProfile(item.companyId)}
                      >
                        <ChevronRight className="w-3.5 h-3.5 me-1" />
                        <T k="pages.profile" />
                      </Button>
                      <Button size="sm" onClick={() => onOpenBooks(item.companyId)}>
                        <BookOpen className="w-3.5 h-3.5 me-1" />
                        Open
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                <T k="pages.workloadOwnership" />
              </CardTitle>
              {(dashboard?.workload?.unassignedClients ?? 0) > 0 && (
                <Badge variant="destructive">
                  {dashboard?.workload?.unassignedClients} unassigned
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {workloadOwners.length === 0 && (
              <p className="text-sm text-muted-foreground">
                <T k="pages.noStaffWorkloadYet" />
              </p>
            )}
            {workloadOwners.slice(0, 6).map((owner) => (
              <div key={owner.staffId ?? "unassigned"} className="rounded-md border px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{owner.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {owner.clientCount} clients · {owner.averageCloseProgress}% avg close
                    </p>
                  </div>
                  <Badge
                    variant={
                      owner.critical > 0
                        ? "destructive"
                        : owner.attention > 0
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {owner.critical > 0
                      ? `${owner.critical} critical`
                      : `${owner.attention} attention`}
                  </Badge>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${owner.averageCloseProgress}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-2 mt-2 text-caption text-muted-foreground">
                  <span>{owner.vatDue28Days} VAT due</span>
                  <span>{owner.corporateTaxDue90Days} CT due</span>
                  <span>{owner.bookkeepingBlocked} close blocked</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">
              <T k="pages.vatProductionBoard" />
            </CardTitle>
            <Badge variant="outline">{dashboard?.summary.totalClients ?? 0} clients</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            {(dashboard?.vatCohorts ?? []).slice(0, 3).map((cohort, index) => (
              <div key={cohort.key} className="rounded-lg border bg-muted/20 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">Group {index + 1}</p>
                    <p className="text-xs text-muted-foreground">{cohort.label}</p>
                    <p className="text-xs text-muted-foreground">{cohort.clientCount} clients</p>
                  </div>
                  <div className="flex gap-1">
                    {cohort.dueSoon > 0 && (
                      <Badge className="bg-warning-subtle text-warning-subtle-foreground border-warning/30">
                        {cohort.dueSoon} due
                      </Badge>
                    )}
                    {cohort.blocked > 0 && (
                      <Badge variant="destructive">{cohort.blocked} blocked</Badge>
                    )}
                  </div>
                </div>
                <div className="space-y-2 min-h-[132px]">
                  {cohort.clients.length === 0 && (
                    <div className="rounded-md border border-dashed bg-background/70 px-3 py-5 text-sm text-muted-foreground text-center">
                      <T k="pages.noClientsInThisCohort" />
                    </div>
                  )}
                  {cohort.clients.slice(0, 4).map((client) => (
                    <button
                      key={client.companyId}
                      type="button"
                      onClick={() => onOpenBooks(client.companyId)}
                      className="w-full rounded-md border bg-background px-3 py-2 text-start hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{client.companyName}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateShort(client.dueDate)} · {formatDays(client.daysTilDue)}
                          </p>
                        </div>
                        <PriorityBadge priority={client.status} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        {blockerPreview(client.blockers)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              <T k="pages.priorityQueue" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {priorityClients.length === 0 && (
              <p className="text-sm text-muted-foreground">
                <T k="pages.noClientsYet" />
              </p>
            )}
            {priorityClients.map((client) => (
              <button
                key={client.companyId}
                type="button"
                onClick={() => onOpenBooks(client.companyId)}
                className="w-full rounded-md border px-3 py-2 text-start hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{client.companyName}</p>
                  <PriorityBadge priority={client.priority} />
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {client.nextBestAction}
                </p>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Calculator className="w-4 h-4 text-info" />
              <T k="pages.corporateTax" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ctClients.length === 0 && (
              <p className="text-sm text-muted-foreground">
                <T k="pages.noCtDeadlinesRequiringAction" />
              </p>
            )}
            {ctClients.map((client) => (
              <div key={client.companyId} className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{client.companyName}</p>
                  <span className="text-xs text-muted-foreground">
                    {formatDays(client.corporateTax.daysTilDue)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {blockerPreview(client.corporateTax.blockers)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-warning" />
              <T k="pages.bookkeepingClose" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {closeClients.length === 0 && (
              <p className="text-sm text-muted-foreground">
                <T k="pages.monthlyCloseIsOnTrack" />
              </p>
            )}
            {closeClients.map((client) => (
              <div key={client.companyId} className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{client.companyName}</p>
                  <span className="text-xs font-medium">{client.bookkeeping.closeProgress}%</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${client.bookkeeping.closeProgress}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {blockerPreview(client.bookkeeping.blockers)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <T k="pages.accountingReview" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {accountingClients.length === 0 && (
              <p className="text-sm text-muted-foreground">
                <T k="pages.trialBalancesAreClean" />
              </p>
            )}
            {accountingClients.map((client) => (
              <div key={client.companyId} className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{client.companyName}</p>
                  <PriorityBadge priority={client.accounting.status} />
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {blockerPreview(client.accounting.blockers)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
