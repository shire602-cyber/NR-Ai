import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'wouter';
import { getStoredUser } from '@/lib/auth';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatDate } from '@/lib/format';
import {
  FileText,
  Upload,
  ShieldCheck,
  ListTodo,
  Activity,
  ArrowRight,
  BarChart3,
  FileArchive,
} from 'lucide-react';
import { SiWhatsapp } from 'react-icons/si';
import { formatPhoneForWhatsApp } from '@/lib/whatsapp-templates';

export default function ClientDashboard() {
  const user = getStoredUser();
  const userName = user?.name || user?.email || 'Client';
  const { company, companyId } = useDefaultCompany();
  const contactPhone = company?.contactPhone?.trim() || '';
  const contactPhoneFormatted = contactPhone ? formatPhoneForWhatsApp(contactPhone) : '';
  const contactPhoneAvailable = contactPhoneFormatted.length >= 8;

  // Fetch documents count
  const { data: documents = [], isLoading: docsLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', companyId, 'documents'],
    enabled: !!companyId,
  });

  // Fetch compliance tasks
  const { data: complianceTasks = [], isLoading: complianceLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', companyId, 'compliance-tasks'],
    enabled: !!companyId,
  });

  // Fetch tasks
  const { data: tasks = [], isLoading: tasksLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', companyId, 'compliance-tasks'],
    enabled: !!companyId,
  });

  // Fetch activity logs
  const { data: activityLogs = [], isLoading: activityLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', companyId, 'journal'],
    enabled: !!companyId,
  });

  // Compute derived data
  const pendingTasks = tasks.filter(
    (t: any) => t.status !== 'completed' && t.status !== 'cancelled'
  );

  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentActivityItems = activityLogs.filter((item: any) => {
    const date = item.createdAt ? new Date(item.createdAt) : (item.date ? new Date(item.date) : null);
    return date && date >= oneWeekAgo;
  });

  // Find next compliance deadline
  const upcomingDeadlines = complianceTasks
    .filter((task: any) => {
      if (task.status === 'completed' || task.status === 'cancelled') return false;
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
    if (!nextDeadline) return { color: 'bg-green-100 text-green-700 border-green-200', label: 'All Clear' };
    if (daysUntilDeadline !== null && daysUntilDeadline <= 7)
      return { color: 'bg-red-100 text-red-700 border-red-200', label: 'Urgent' };
    if (daysUntilDeadline !== null && daysUntilDeadline <= 30)
      return { color: 'bg-yellow-100 text-yellow-700 border-yellow-200', label: 'Upcoming' };
    return { color: 'bg-green-100 text-green-700 border-green-200', label: 'On Track' };
  };

  const complianceBadge = getComplianceBadge();

  // Recent updates feed data
  const recentUpdates = activityLogs.slice(0, 5).map((item: any) => ({
    id: item.id,
    description: item.description || item.memo || 'Activity logged',
    date: item.createdAt || item.date,
  }));

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl p-8 bg-gradient-to-br from-primary/10 via-transparent to-accent/5 border border-primary/10">
        <div className="relative z-10">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">
            Welcome back, <span className="text-primary">{userName}</span>
          </h1>
          <p className="text-muted-foreground text-lg">
            Your Muhasib.ai client portal — everything in one place.
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* My Documents */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">My Documents</CardTitle>
            <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
              <Upload className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            {docsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{documents.length}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">documents in vault</p>
            <Link href="/document-vault">
              <Button variant="ghost" size="sm" className="px-0 mt-2 text-primary gap-1">
                View All <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Compliance Status */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Compliance Status</CardTitle>
            <div className="w-9 h-9 rounded-lg bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-green-600 dark:text-green-400" />
            </div>
          </CardHeader>
          <CardContent>
            {complianceLoading ? (
              <Skeleton className="h-8 w-full" />
            ) : nextDeadline ? (
              <>
                <div className="text-sm font-semibold">
                  {nextDeadline.title || 'Upcoming deadline'}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  due in {daysUntilDeadline} day{daysUntilDeadline !== 1 ? 's' : ''}
                </p>
              </>
            ) : (
              <div className="text-sm font-semibold">No upcoming deadlines</div>
            )}
            <Badge variant="outline" className={`mt-2 text-xs ${complianceBadge.color}`}>
              {complianceBadge.label}
            </Badge>
          </CardContent>
        </Card>

        {/* Pending Tasks */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Tasks</CardTitle>
            <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center">
              <ListTodo className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
          </CardHeader>
          <CardContent>
            {tasksLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{pendingTasks.length}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">tasks incomplete</p>
            <Link href="/compliance-calendar">
              <Button variant="ghost" size="sm" className="px-0 mt-2 text-primary gap-1">
                View Tasks <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Recent Activity</CardTitle>
            <div className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-900/20 flex items-center justify-center">
              <Activity className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{recentActivityItems.length}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">items this week</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/document-vault">
            <Button
              variant="outline"
              className="w-full h-auto py-6 flex flex-col gap-3 hover:border-primary hover:bg-primary/5 transition-colors"
            >
              <Upload className="w-7 h-7 text-blue-600" />
              <span className="font-medium">Upload Document</span>
            </Button>
          </Link>
          <Link href="/reports">
            <Button
              variant="outline"
              className="w-full h-auto py-6 flex flex-col gap-3 hover:border-primary hover:bg-primary/5 transition-colors"
            >
              <BarChart3 className="w-7 h-7 text-green-600" />
              <span className="font-medium">View Reports</span>
            </Button>
          </Link>
          <Link href="/tax-return-archive">
            <Button
              variant="outline"
              className="w-full h-auto py-6 flex flex-col gap-3 hover:border-primary hover:bg-primary/5 transition-colors"
            >
              <FileArchive className="w-7 h-7 text-purple-600" />
              <span className="font-medium">View Tax Returns</span>
            </Button>
          </Link>
          {contactPhoneAvailable ? (
            <a
              href={`https://wa.me/${contactPhoneFormatted}`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="link-contact-whatsapp"
            >
              <Button
                variant="outline"
                className="w-full h-auto py-6 flex flex-col gap-3 hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <SiWhatsapp className="w-7 h-7 text-emerald-600" />
                <span className="font-medium">Contact NR Team</span>
              </Button>
            </a>
          ) : (
            <Button
              variant="outline"
              disabled
              title="WhatsApp contact not configured for this company"
              className="w-full h-auto py-6 flex flex-col gap-3 opacity-60"
              data-testid="button-contact-whatsapp-disabled"
            >
              <SiWhatsapp className="w-7 h-7 text-emerald-600" />
              <span className="font-medium">Contact NR Team</span>
            </Button>
          )}
        </div>
      </div>

      {/* Recent Updates Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="w-5 h-5" />
            Recent Updates
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
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
                        {formatDate(update.date, 'en')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No recent updates yet</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
