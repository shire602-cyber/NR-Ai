import { T } from "@/components/layout/T";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatDate } from "@/lib/format";
import { ErrorState } from "@/components/ui/error-state";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { StaleDataNotice } from "@/components/ui/stale-data-notice";
import { hasReadData, queryReadState, type QueryReadState } from "@/lib/queryReadState";
import { classifyLoadError } from "@/lib/loadError";

/** Offline and server failures can be fixed by a retry; forbidden and not-found cannot. */
function isRetryableLoadError(error: unknown): boolean {
  const kind = classifyLoadError(error);
  return kind === "offline" || kind === "server";
}
import {
  FileText,
  Upload,
  ShieldCheck,
  ListTodo,
  Activity,
  ArrowRight,
  BarChart3,
  FileArchive,
  ListChecks,
} from "lucide-react";

export default function ClientDashboard() {
  const { t, locale } = useTranslation();
  const { data: user } = useCurrentUser();
  const userName = user?.name || user?.email || t["dashboard.clientFallbackName"];
  const { companyId, companyListState, retryCompanyList } = useDefaultCompany();

  // Fetch documents count
  const documentsQuery = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "documents"],
    enabled: !!companyId,
  });

  // Compliance tasks feed both the deadline card and the pending-task count.
  const tasksQuery = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "compliance-tasks"],
    enabled: !!companyId,
  });

  // Fetch activity logs
  const activityQuery = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "journal"],
    enabled: !!companyId,
  });

  const reads = [documentsQuery, tasksQuery, activityQuery].map((query) => ({
    query,
    state: queryReadState(query),
  }));
  const [documentsState, tasksState, activityState] = reads.map((r) => r.state);
  const failedReads = reads.filter((r) => r.state === "error");
  const staleReads = reads.filter((r) => r.state === "stale");

  // Counts and lists exist only for data that actually loaded.
  const documents = hasReadData(documentsState) ? (documentsQuery.data ?? []) : [];
  const complianceTasks = hasReadData(tasksState) ? (tasksQuery.data ?? []) : [];
  const activityLogs = hasReadData(activityState) ? (activityQuery.data ?? []) : [];

  // Compute derived data
  const pendingTasks = complianceTasks.filter(
    (task: any) => task.status !== "completed" && task.status !== "cancelled"
  );

  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentActivityItems = activityLogs.filter((item: any) => {
    const date = item.createdAt ? new Date(item.createdAt) : item.date ? new Date(item.date) : null;
    return date && date >= oneWeekAgo;
  });

  // Find next compliance deadline
  const upcomingDeadlines = complianceTasks
    .filter((task: any) => {
      if (task.status === "completed" || task.status === "cancelled") return false;
      const dueDate = task.dueDate ? new Date(task.dueDate) : null;
      return dueDate && dueDate >= now;
    })
    .sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const nextDeadline = upcomingDeadlines[0];
  const daysUntilDeadline = nextDeadline
    ? Math.ceil((new Date(nextDeadline.dueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Compliance status badge color
  const getComplianceBadge = () => {
    if (!nextDeadline)
      return {
        color: "bg-success-subtle text-success border-success/30",
        label: t["pages.allClear"],
      };
    if (daysUntilDeadline !== null && daysUntilDeadline <= 7)
      return {
        color: "bg-danger-subtle text-destructive border-destructive/30",
        label: t["dashboard.clientUrgent"],
      };
    if (daysUntilDeadline !== null && daysUntilDeadline <= 30)
      return {
        color: "bg-warning-subtle text-warning border-warning/30",
        label: t["dashboard.clientUpcoming"],
      };
    return {
      color: "bg-success-subtle text-success border-success/30",
      label: t["pageLabels.onTrack"],
    };
  };

  const complianceBadge = getComplianceBadge();

  // Recent updates feed data
  const recentUpdates = activityLogs.slice(0, 5).map((item: any) => ({
    id: item.id,
    description: item.description || item.memo || t["dashboard.clientActivityLogged"],
    date: item.createdAt || item.date,
  }));

  /** A card figure: a skeleton while loading, a dash after a failed load, else the number. */
  const figure = (state: QueryReadState, value: number, testId: string) =>
    state === "pending" ? (
      <Skeleton className="h-8 w-16" />
    ) : (
      <div className="text-2xl font-bold" data-testid={testId}>
        {hasReadData(state) ? value : "—"}
      </div>
    );

  if (!companyId) {
    if (companyListState === "error") {
      return <ErrorState onRetry={retryCompanyList} testId="client-dashboard-company-error" />;
    }
    if (companyListState === "loading" || companyListState === "waiting") {
      return (
        <div className="max-w-5xl mx-auto space-y-4" data-testid="client-dashboard-loading">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full" />
        </div>
      );
    }
    return (
      <div className="p-6 text-muted-foreground" data-testid="client-dashboard-no-company">
        <T k="pages.noCompanySelected" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {failedReads.length > 0 && (
        <LoadErrorState
          compact
          error={
            (failedReads.find((r) => isRetryableLoadError(r.query.error)) ?? failedReads[0]).query
              .error
          }
          onRetry={() => failedReads.forEach((r) => void r.query.refetch())}
          testId="client-dashboard-load-error"
        />
      )}
      {staleReads.length > 0 && (
        <StaleDataNotice
          onRetry={() => staleReads.forEach((r) => void r.query.refetch())}
          testId="client-dashboard-stale"
        />
      )}

      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl p-8 border border-primary/10">
        <div className="relative z-10">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">
            <T k="pageLabels.welcomeBack" />
            <span className="text-primary">{userName}</span>
          </h1>
          <p className="text-muted-foreground text-lg">
            {t["clientDashboard.yourMuhasibAiClientPortal"]}
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* My Documents */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              <T k="pageLabels.myDocuments" />
            </CardTitle>
            <div className="w-9 h-9 rounded-lg bg-info-subtle flex items-center justify-center">
              <Upload className="w-4 h-4 text-info " />
            </div>
          </CardHeader>
          <CardContent>
            {figure(documentsState, documents.length, "client-documents-count")}
            <p className="text-xs text-muted-foreground mt-1">{t["dashboard.clientDocsInVault"]}</p>
            <Link href="/document-vault">
              <Button variant="ghost" size="sm" className="px-0 mt-2 text-primary gap-1">
                <T k="pageLabels.viewAll" />
                <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Compliance Status */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              <T k="pageLabels.complianceStatus" />
            </CardTitle>
            <div className="w-9 h-9 rounded-lg bg-success-subtle flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-success " />
            </div>
          </CardHeader>
          <CardContent>
            {tasksState === "pending" ? (
              <Skeleton className="h-8 w-full" />
            ) : tasksState === "error" ? (
              <div className="text-sm font-semibold">—</div>
            ) : nextDeadline ? (
              <>
                <div className="text-sm font-semibold">
                  {nextDeadline.title || t["dashboard.clientUpcomingDeadline"]}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatMessage(t["dashboard.clientDueInDays"], { count: daysUntilDeadline ?? 0 })}
                </p>
              </>
            ) : (
              <div className="text-sm font-semibold">
                <T k="pageLabels.noUpcomingDeadlines" />
              </div>
            )}
            {hasReadData(tasksState) && (
              <Badge variant="outline" className={`mt-2 text-xs ${complianceBadge.color}`}>
                {complianceBadge.label}
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* Pending Tasks */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              <T k="pageLabels.pendingTasks" />
            </CardTitle>
            <div className="w-9 h-9 rounded-lg bg-warning-subtle flex items-center justify-center">
              <ListTodo className="w-4 h-4 text-warning " />
            </div>
          </CardHeader>
          <CardContent>
            {figure(tasksState, pendingTasks.length, "client-tasks-count")}
            <p className="text-xs text-muted-foreground mt-1">
              {t["dashboard.clientTasksIncomplete"]}
            </p>
            <Link href="/compliance-calendar">
              <Button variant="ghost" size="sm" className="px-0 mt-2 text-primary gap-1">
                <T k="pageLabels.viewTasks" />
                <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              <T k="pages.recentActivity" />
            </CardTitle>
            <div className="w-9 h-9 rounded-lg bg-chart-5/10 flex items-center justify-center">
              <Activity className="w-4 h-4 text-chart-5 " />
            </div>
          </CardHeader>
          <CardContent>
            {figure(activityState, recentActivityItems.length, "client-activity-count")}
            <p className="text-xs text-muted-foreground mt-1">
              {t["dashboard.clientItemsThisWeek"]}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-xl font-semibold mb-4">
          <T k="pageLabels.quickActions" />
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/document-vault">
            <Button
              variant="outline"
              className="w-full h-auto py-6 flex flex-col gap-3 hover:border-primary hover:bg-primary/5 transition-colors"
            >
              <Upload className="w-7 h-7 text-info" />
              <span className="font-medium">
                <T k="pages.uploadDocument" />
              </span>
            </Button>
          </Link>
          <Link href="/reports">
            <Button
              variant="outline"
              className="w-full h-auto py-6 flex flex-col gap-3 hover:border-primary hover:bg-primary/5 transition-colors"
            >
              <BarChart3 className="w-7 h-7 text-success" />
              <span className="font-medium">
                <T k="onboarding.step.reports.action" />
              </span>
            </Button>
          </Link>
          <Link href="/tax-return-archive">
            <Button
              variant="outline"
              className="w-full h-auto py-6 flex flex-col gap-3 hover:border-primary hover:bg-primary/5 transition-colors"
            >
              <FileArchive className="w-7 h-7 text-chart-5" />
              <span className="font-medium">
                <T k="pageLabels.viewTaxReturns" />
              </span>
            </Button>
          </Link>
          <Link href="/task-center">
            <Button
              variant="outline"
              className="w-full h-auto py-6 flex flex-col gap-3 hover:border-primary hover:bg-primary/5 transition-colors"
            >
              <ListChecks className="w-7 h-7 text-success" />
              <span className="font-medium">
                <T k="pageLabels.openTaskCenter" />
              </span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Recent Updates Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="w-5 h-5" />
            <T k="pageLabels.recentUpdates" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activityState === "pending" ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : activityState === "error" ? (
            <p className="text-center py-8 text-muted-foreground">—</p>
          ) : recentUpdates.length > 0 ? (
            <div className="space-y-3">
              {recentUpdates.map((update: any) => (
                <div
                  key={update.id}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30"
                >
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{update.description}</p>
                    {update.date && (
                      <p className="text-xs text-muted-foreground">
                        {formatDate(update.date, locale)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">
                <T k="pageLabels.noRecentUpdatesYet" />
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
