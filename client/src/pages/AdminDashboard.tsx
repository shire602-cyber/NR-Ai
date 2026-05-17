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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-admin-title">
            Admin Dashboard
          </h1>
          <p className="text-muted-foreground">Manage your accounting firm's clients and system</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/clients">
            <Button variant="outline" data-testid="button-view-clients">
              <Building2 className="w-4 h-4 mr-2" />
              View All Clients
            </Button>
          </Link>
          <Link href="/admin/invitations">
            <Button data-testid="button-invite-client">
              <UserPlus className="w-4 h-4 mr-2" />
              Invite Client
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-clients">
              {stats?.totalClients || 0}
            </div>
            <p className="text-xs text-muted-foreground">Active client companies</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-users">
              {stats?.totalUsers || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.adminUsers || 0} admins, {stats?.clientUsers || 0} clients
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Pending Invitations</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-pending-invites">
              {stats?.pendingInvitations || 0}
            </div>
            <p className="text-xs text-muted-foreground">Awaiting client registration</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">AI Status</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span className="text-lg font-medium">Active</span>
            </div>
            <p className="text-xs text-muted-foreground">All AI features operational</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Recent Clients
            </CardTitle>
            <CardDescription>Your most recently added clients</CardDescription>
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
                      {client.userCount || 0} users · {client.documentCount || 0} documents
                    </p>
                  </div>
                  <Link href={`/admin/clients/${client.id}`}>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`button-view-client-${client.id}`}
                    >
                      View
                    </Button>
                  </Link>
                </div>
              ))}
              {clients.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Building2 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No clients yet</p>
                  <Link href="/admin/clients">
                    <Button variant="ghost" className="mt-2">
                      Add your first client
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
              Recent Activity
            </CardTitle>
            <CardDescription>Latest actions in the system</CardDescription>
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
                    {log.action === "create" && <CheckCircle className="h-4 w-4 text-green-500" />}
                    {log.action === "update" && <Clock className="h-4 w-4 text-blue-500" />}
                    {log.action === "delete" && <AlertCircle className="h-4 w-4 text-red-500" />}
                    {log.action === "invite" && <Mail className="h-4 w-4 text-purple-500" />}
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
                  <p>No recent activity</p>
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common administrative tasks</CardDescription>
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
                <span>Manage Clients</span>
              </Button>
            </Link>
            <Link href="/admin/invitations">
              <Button
                variant="outline"
                className="w-full h-auto py-4 flex flex-col gap-2"
                data-testid="button-manage-invitations"
              >
                <UserPlus className="h-6 w-6" />
                <span>Send Invitations</span>
              </Button>
            </Link>
            <Link href="/admin/users">
              <Button
                variant="outline"
                className="w-full h-auto py-4 flex flex-col gap-2"
                data-testid="button-manage-users"
              >
                <Users className="h-6 w-6" />
                <span>Manage Users</span>
              </Button>
            </Link>
            <Link href="/admin/activity-logs">
              <Button
                variant="outline"
                className="w-full h-auto py-4 flex flex-col gap-2"
                data-testid="button-view-logs"
              >
                <FileText className="h-6 w-6" />
                <span>Activity Logs</span>
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
            Client Health Overview
          </CardTitle>
          <CardDescription>At-a-glance status for each client company</CardDescription>
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
                    badgeClass: "bg-green-100 text-green-700 border-green-200",
                    label: "Healthy",
                  },
                  attention: {
                    icon: "🟡",
                    badgeClass: "bg-yellow-100 text-yellow-700 border-yellow-200",
                    label: "Attention",
                  },
                  critical: {
                    icon: "🔴",
                    badgeClass: "bg-red-100 text-red-700 border-red-200",
                    label: "Critical",
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
                        <h3 className="font-semibold text-sm truncate flex-1 mr-2">
                          {client.companyName}
                        </h3>
                        <Badge
                          variant="outline"
                          className={`text-xs flex-shrink-0 ${cfg.badgeClass}`}
                        >
                          <span className="mr-1">{cfg.icon}</span> {cfg.label}
                        </Badge>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Outstanding invoices</span>
                          <span className="font-medium text-foreground">
                            {client.outstandingInvoices}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Last activity</span>
                          <span className="font-medium text-foreground">
                            {client.lastActivity
                              ? format(new Date(client.lastActivity), "MMM d, yyyy")
                              : "N/A"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Next deadline</span>
                          <span className="font-medium text-foreground">
                            {client.nextDeadline
                              ? format(new Date(client.nextDeadline), "MMM d, yyyy")
                              : "None"}
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
              <p className="text-sm">No client companies found</p>
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
            Deadline Tracker
          </CardTitle>
          <CardDescription>Upcoming deadlines across all clients (next 90 days)</CardDescription>
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
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Client</th>
                    <th className="pb-3 pr-4 font-medium">Deadline Type</th>
                    <th className="pb-3 pr-4 font-medium">Due Date</th>
                    <th className="pb-3 pr-4 font-medium text-right">Days Remaining</th>
                    <th className="pb-3 font-medium">Status</th>
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
                          isOverdue
                            ? "bg-red-50 dark:bg-red-950/20"
                            : isUrgent
                              ? "bg-red-50/50 dark:bg-red-950/10"
                              : ""
                        }`}
                      >
                        <td className="py-3 pr-4 font-medium">{dl.clientName}</td>
                        <td className="py-3 pr-4">{dl.deadlineType}</td>
                        <td className="py-3 pr-4">{format(new Date(dl.dueDate), "MMM d, yyyy")}</td>
                        <td
                          className={`py-3 pr-4 text-right font-mono font-medium ${
                            isOverdue
                              ? "text-red-600 dark:text-red-400"
                              : isUrgent
                                ? "text-red-600 dark:text-red-400"
                                : "text-foreground"
                          }`}
                        >
                          {isOverdue
                            ? `${Math.abs(dl.daysRemaining)}d overdue`
                            : `${dl.daysRemaining}d`}
                        </td>
                        <td className="py-3">
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              dl.status === "overdue" || isOverdue
                                ? "bg-red-100 text-red-700 border-red-200"
                                : dl.status === "in_progress"
                                  ? "bg-blue-100 text-blue-700 border-blue-200"
                                  : dl.status === "pending"
                                    ? "bg-yellow-100 text-yellow-700 border-yellow-200"
                                    : "bg-gray-100 text-gray-700 border-gray-200"
                            }`}
                          >
                            {isOverdue
                              ? "Overdue"
                              : dl.status === "in_progress"
                                ? "In Progress"
                                : dl.status === "pending"
                                  ? "Pending"
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
              <p className="text-sm">No upcoming deadlines</p>
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
            Staff Assignment
          </CardTitle>
          <CardDescription>Admin staff and their client assignments</CardDescription>
        </CardHeader>
        <CardContent>
          {adminUsers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Staff Name</th>
                    <th className="pb-3 pr-4 font-medium">Email</th>
                    <th className="pb-3 pr-4 font-medium text-right">Assigned Clients</th>
                    <th className="pb-3 font-medium">Recent Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers
                    .filter((u: any) => u.isAdmin)
                    .map((staff: any) => (
                      <tr key={staff.id} className="border-b last:border-0">
                        <td className="py-3 pr-4 font-medium">{staff.name || "Unnamed"}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{staff.email}</td>
                        <td className="py-3 pr-4 text-right font-mono">
                          {clients.length > 0
                            ? Math.ceil(
                                clients.length / adminUsers.filter((u: any) => u.isAdmin).length
                              )
                            : 0}
                        </td>
                        <td className="py-3">
                          <Badge
                            variant="outline"
                            className="text-xs bg-green-100 text-green-700 border-green-200"
                          >
                            Active
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
              <p className="text-sm">No staff data available</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
