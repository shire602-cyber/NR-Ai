import { PageHeader } from "@/components/ui/page-header";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Users,
  UserPlus,
  Clock,
  FileText,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Mail,
  Activity,
  HeartPulse,
  CalendarClock,
  UserCog,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "wouter";
import { format } from "date-fns";
import type { ActivityLog } from "@shared/schema";
import { messages as pageMessages } from "./AdminDashboard.i18n";

interface ClientHealth {
  companyId: string;
  companyName: string;
  status: "healthy" | "attention" | "critical";
  outstandingInvoices: number;
  lastActivity: string | null;
  nextDeadline: string | null;
}

interface Deadline {
  clientName: string;
  companyId: string;
  deadlineType: string;
  dueDate: string;
  daysRemaining: number;
  status: string;
}

interface AdminStats {
  totalClients: number;
  totalUsers: number;
  adminUsers: number;
  clientUsers: number;
  pendingInvitations: number;
  recentActivity: ActivityLog[];
}

export default function AdminDashboard() {
  const tr = pageMessages.useT();

  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
  });

  const { data: clients = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/clients"],
  });

  const { data: healthOverview = [], isLoading: healthLoading } = useQuery<ClientHealth[]>({
    queryKey: ["/api/admin/clients/health-overview"],
  });

  const { data: deadlines = [], isLoading: deadlinesLoading } = useQuery<Deadline[]>({
    queryKey: ["/api/admin/deadlines"],
  });

  const { data: adminUsers = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("admin")}
        title={tr("adminDashboard")}
        testId="text-admin-title"
        description={tr("manageYourAccountingFirmSClients")}
        actions={
          <>
            <Link href="/admin/clients">
              <Button variant="outline" data-testid="button-view-clients">
                <Building2 className="w-4 h-4 me-2" />
                {tr("viewAllClients")}
              </Button>
            </Link>
            <Link href="/admin/invitations">
              <Button data-testid="button-invite-client">
                <UserPlus className="w-4 h-4 me-2" />
                {tr("inviteClient")}
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">{tr("totalClients")}</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-clients">
              {stats?.totalClients || 0}
            </div>
            <p className="text-xs text-muted-foreground">{tr("activeClientCompanies")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">{tr("totalUsers")}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-users">
              {stats?.totalUsers || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.adminUsers || 0} {tr("admins")} {stats?.clientUsers || 0} {tr("clients")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">{tr("pendingInvitations")}</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-pending-invites">
              {stats?.pendingInvitations || 0}
            </div>
            <p className="text-xs text-muted-foreground">{tr("awaitingClientRegistration")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">{tr("aiStatus")}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-success" />
              <span className="text-lg font-medium">{tr("active")}</span>
            </div>
            <p className="text-xs text-muted-foreground">{tr("allAiFeaturesOperational")}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {tr("recentClients")}
            </CardTitle>
            <CardDescription>{tr("yourMostRecentlyAddedClients")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              {clients.slice(0, 10).map((client: any) => (
                <div
                  key={client.id}
                  className="flex items-center justify-between p-3 border-b last:border-0"
                  data-testid={`client-row-${client.id}`}
                >
                  <div>
                    <p className="font-medium">{client.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {client.userCount || 0} {tr("users")} {client.documentCount || 0}{" "}
                      {tr("documents")}
                    </p>
                  </div>
                  <Link href={`/admin/clients/${client.id}`}>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`button-view-client-${client.id}`}
                    >
                      {tr("view")}
                    </Button>
                  </Link>
                </div>
              ))}
              {clients.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Building2 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>{tr("noClientsYet")}</p>
                  <Link href="/admin/clients">
                    <Button variant="ghost" className="mt-2">
                      {tr("addYourFirstClient")}
                    </Button>
                  </Link>
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              {tr("recentActivity")}
            </CardTitle>
            <CardDescription>{tr("latestActionsInTheSystem")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              {(stats?.recentActivity || []).map((log: ActivityLog) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 p-3 border-b last:border-0"
                  data-testid={`activity-row-${log.id}`}
                >
                  <div className="mt-1">
                    {log.action === "create" && <CheckCircle className="h-4 w-4 text-success" />}
                    {log.action === "update" && <Clock className="h-4 w-4 text-info" />}
                    {log.action === "delete" && (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    )}
                    {log.action === "invite" && <Mail className="h-4 w-4 text-chart-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{log.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {log.createdAt && format(new Date(log.createdAt), "MMM d, yyyy h:mm a")}
                    </p>
                  </div>
                </div>
              ))}
              {(!stats?.recentActivity || stats.recentActivity.length === 0) && (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>{tr("noRecentActivity")}</p>
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tr("quickActions")}</CardTitle>
          <CardDescription>{tr("commonAdministrativeTasks")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <Link href="/admin/clients">
              <Button
                variant="outline"
                className="w-full h-auto py-4 flex flex-col gap-2"
                data-testid="button-manage-clients"
              >
                <Building2 className="h-6 w-6" />
                <span>{tr("manageClients")}</span>
              </Button>
            </Link>
            <Link href="/admin/invitations">
              <Button
                variant="outline"
                className="w-full h-auto py-4 flex flex-col gap-2"
                data-testid="button-manage-invitations"
              >
                <UserPlus className="h-6 w-6" />
                <span>{tr("sendInvitations")}</span>
              </Button>
            </Link>
            <Link href="/admin/users">
              <Button
                variant="outline"
                className="w-full h-auto py-4 flex flex-col gap-2"
                data-testid="button-manage-users"
              >
                <Users className="h-6 w-6" />
                <span>{tr("manageUsers")}</span>
              </Button>
            </Link>
            <Link href="/admin/activity-logs">
              <Button
                variant="outline"
                className="w-full h-auto py-4 flex flex-col gap-2"
                data-testid="button-view-logs"
              >
                <FileText className="h-6 w-6" />
                <span>{tr("activityLogs")}</span>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* ──────────────────────────────────────────────── */}
      {/* Client Health Overview                           */}
      {/* ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5" />
            {tr("clientHealthOverview")}
          </CardTitle>
          <CardDescription>{tr("atAGlanceStatusForEach")}</CardDescription>
        </CardHeader>
        <CardContent>
          {healthLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 rounded-lg border animate-pulse bg-muted/50" />
              ))}
            </div>
          ) : healthOverview.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {healthOverview.map((client) => {
                const statusConfig = {
                  healthy: {
                    icon: "🟢",
                    badgeClass: "bg-success-subtle text-success border-success/30",
                    label: tr("healthy"),
                  },
                  attention: {
                    icon: "🟡",
                    badgeClass: "bg-warning-subtle text-warning border-warning/30",
                    label: tr("attention"),
                  },
                  critical: {
                    icon: "🔴",
                    badgeClass: "bg-danger-subtle text-destructive border-destructive/30",
                    label: tr("critical"),
                  },
                };
                const cfg = statusConfig[client.status] || statusConfig.attention;

                return (
                  <Link key={client.companyId} href={`/admin/clients/${client.companyId}`}>
                    <div
                      className="p-4 rounded-lg border hover:shadow-md hover:border-primary/30 transition-all cursor-pointer"
                      data-testid={`health-card-${client.companyId}`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-sm truncate flex-1 me-2">
                          {client.companyName}
                        </h3>
                        <Badge
                          variant="outline"
                          className={`text-xs flex-shrink-0 ${cfg.badgeClass}`}
                        >
                          <span className="me-1">{cfg.icon}</span> {cfg.label}
                        </Badge>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                          <span>{tr("outstandingInvoices")}</span>
                          <span className="font-medium text-foreground">
                            {client.outstandingInvoices}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>{tr("lastActivity")}</span>
                          <span className="font-medium text-foreground">
                            {client.lastActivity
                              ? format(new Date(client.lastActivity), "MMM d, yyyy")
                              : "N/A"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>{tr("nextDeadline")}</span>
                          <span className="font-medium text-foreground">
                            {client.nextDeadline
                              ? format(new Date(client.nextDeadline), "MMM d, yyyy")
                              : tr("none")}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <HeartPulse className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{tr("noClientCompaniesFound")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ──────────────────────────────────────────────── */}
      {/* Deadline Tracker                                 */}
      {/* ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            {tr("deadlineTracker")}
          </CardTitle>
          <CardDescription>{tr("upcomingDeadlinesAcrossAllClientsNext")}</CardDescription>
        </CardHeader>
        <CardContent>
          {deadlinesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 rounded border animate-pulse bg-muted/50" />
              ))}
            </div>
          ) : deadlines.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-muted-foreground">
                    <th className="pb-3 pe-4 font-medium">{tr("client")}</th>
                    <th className="pb-3 pe-4 font-medium">{tr("deadlineType")}</th>
                    <th className="pb-3 pe-4 font-medium">{tr("dueDate")}</th>
                    <th className="pb-3 pe-4 font-medium text-end">{tr("daysRemaining")}</th>
                    <th className="pb-3 font-medium">{tr("status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {deadlines.slice(0, 20).map((dl, idx) => {
                    const isUrgent = dl.daysRemaining <= 7;
                    const isOverdue = dl.daysRemaining < 0;

                    return (
                      <tr
                        key={`${dl.companyId}-${dl.deadlineType}-${idx}`}
                        className={`border-b last:border-0 transition-colors ${
                          isOverdue ? "bg-danger-subtle " : isUrgent ? "bg-danger-subtle/50 " : ""
                        }`}
                      >
                        <td className="py-3 pe-4 font-medium">{dl.clientName}</td>
                        <td className="py-3 pe-4">{dl.deadlineType}</td>
                        <td className="py-3 pe-4">{format(new Date(dl.dueDate), "MMM d, yyyy")}</td>
                        <td
                          className={`py-3 pe-4 text-end font-mono font-medium ${
                            isOverdue
                              ? "text-destructive "
                              : isUrgent
                                ? "text-destructive "
                                : "text-foreground"
                          }`}
                        >
                          {isOverdue
                            ? tr("dOverdue", { abs: Math.abs(dl.daysRemaining) })
                            : `${dl.daysRemaining}d`}
                        </td>
                        <td className="py-3">
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              dl.status === "overdue" || isOverdue
                                ? "bg-danger-subtle text-destructive border-destructive/30"
                                : dl.status === "in_progress"
                                  ? "bg-info-subtle text-info border-info/30"
                                  : dl.status === "pending"
                                    ? "bg-warning-subtle text-warning border-warning/30"
                                    : "bg-muted text-foreground border-border"
                            }`}
                          >
                            {isOverdue
                              ? tr("overdue")
                              : dl.status === "in_progress"
                                ? tr("inProgress")
                                : dl.status === "pending"
                                  ? tr("pending")
                                  : dl.status}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <CalendarClock className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{tr("noUpcomingDeadlines")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ──────────────────────────────────────────────── */}
      {/* Staff Assignment                                 */}
      {/* ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            {tr("staffAssignment")}
          </CardTitle>
          <CardDescription>{tr("adminStaffAndTheirClientAssignments")}</CardDescription>
        </CardHeader>
        <CardContent>
          {adminUsers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-muted-foreground">
                    <th className="pb-3 pe-4 font-medium">{tr("staffName")}</th>
                    <th className="pb-3 pe-4 font-medium">{tr("email")}</th>
                    <th className="pb-3 pe-4 font-medium text-end">{tr("assignedClients")}</th>
                    <th className="pb-3 font-medium">{tr("recentActivity")}</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers
                    .filter((u: any) => u.isAdmin)
                    .map((staff: any) => (
                      <tr key={staff.id} className="border-b last:border-0">
                        <td className="py-3 pe-4 font-medium">{staff.name || tr("unnamed")}</td>
                        <td className="py-3 pe-4 text-muted-foreground">{staff.email}</td>
                        <td className="py-3 pe-4 text-end font-mono">
                          {clients.length > 0
                            ? Math.ceil(
                                clients.length / adminUsers.filter((u: any) => u.isAdmin).length
                              )
                            : 0}
                        </td>
                        <td className="py-3">
                          <Badge
                            variant="outline"
                            className="text-xs bg-success-subtle text-success border-success/30"
                          >
                            {tr("active")}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <UserCog className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{tr("noStaffDataAvailable")}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
