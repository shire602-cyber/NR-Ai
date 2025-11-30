import { useQuery } from '@tanstack/react-query';
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
  Activity
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Link } from 'wouter';
import { format } from 'date-fns';
import type { ActivityLog } from '@shared/schema';

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
    queryKey: ['/api/admin/stats'],
  });

  const { data: clients = [] } = useQuery<any[]>({
    queryKey: ['/api/admin/clients'],
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
          <h1 className="text-3xl font-bold" data-testid="text-admin-title">Admin Dashboard</h1>
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
            <div className="text-2xl font-bold" data-testid="text-total-clients">{stats?.totalClients || 0}</div>
            <p className="text-xs text-muted-foreground">Active client companies</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-users">{stats?.totalUsers || 0}</div>
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
            <div className="text-2xl font-bold" data-testid="text-pending-invites">{stats?.pendingInvitations || 0}</div>
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
                    <Button variant="ghost" size="sm" data-testid={`button-view-client-${client.id}`}>
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
                    <Button variant="link" className="mt-2">Add your first client</Button>
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
                    {log.action === 'create' && <CheckCircle className="h-4 w-4 text-green-500" />}
                    {log.action === 'update' && <Clock className="h-4 w-4 text-blue-500" />}
                    {log.action === 'delete' && <AlertCircle className="h-4 w-4 text-red-500" />}
                    {log.action === 'invite' && <Mail className="h-4 w-4 text-purple-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{log.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {log.createdAt && format(new Date(log.createdAt), 'MMM d, yyyy h:mm a')}
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
              <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2" data-testid="button-manage-clients">
                <Building2 className="h-6 w-6" />
                <span>Manage Clients</span>
              </Button>
            </Link>
            <Link href="/admin/invitations">
              <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2" data-testid="button-manage-invitations">
                <UserPlus className="h-6 w-6" />
                <span>Send Invitations</span>
              </Button>
            </Link>
            <Link href="/admin/users">
              <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2" data-testid="button-manage-users">
                <Users className="h-6 w-6" />
                <span>Manage Users</span>
              </Button>
            </Link>
            <Link href="/admin/activity-logs">
              <Button variant="outline" className="w-full h-auto py-4 flex flex-col gap-2" data-testid="button-view-logs">
                <FileText className="h-6 w-6" />
                <span>Activity Logs</span>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
