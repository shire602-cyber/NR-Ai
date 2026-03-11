import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Loader2, Play, Clock, CheckCircle, XCircle, AlertTriangle, RefreshCw, Activity, Send, Inbox, Timer } from 'lucide-react';

interface SchedulerJob {
  jobName: string;
  cronSchedule: string;
  status: 'running' | 'completed' | 'failed' | 'idle';
  lastRunAt: string | null;
  lastError: string | null;
  nextRunAt: string | null;
}

interface QueueStats {
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  totalToday: number;
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(Math.abs(diffMs) / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  const isFuture = diffMs < 0;

  if (diffSeconds < 60) {
    return isFuture ? `in ${diffSeconds}s` : `${diffSeconds}s ago`;
  }
  if (diffMinutes < 60) {
    return isFuture ? `in ${diffMinutes} min` : `${diffMinutes} min ago`;
  }
  if (diffHours < 24) {
    return isFuture ? `in ${diffHours}h` : `${diffHours}h ago`;
  }
  return isFuture ? `in ${diffDays}d` : `${diffDays}d ago`;
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'running':
      return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">running</Badge>;
    case 'completed':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">completed</Badge>;
    case 'failed':
      return <Badge variant="destructive">failed</Badge>;
    case 'idle':
    default:
      return <Badge variant="outline">idle</Badge>;
  }
}

export default function AdminScheduler() {
  const { toast } = useToast();
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);

  const { data: jobs = [], isLoading } = useQuery<SchedulerJob[]>({
    queryKey: ['/api/admin/scheduler/jobs'],
    refetchInterval: 10000,
  });

  const { data: stats } = useQuery<QueueStats>({
    queryKey: ['/api/admin/scheduler/queue/stats'],
    refetchInterval: 10000,
  });

  const triggerMutation = useMutation({
    mutationFn: (name: string) => apiRequest('POST', `/api/admin/scheduler/jobs/${name}/trigger`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scheduler/jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scheduler/queue/stats'] });
      toast({ title: 'Job Triggered', description: 'Job has been started' });
      setTriggeringJob(null);
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
      setTriggeringJob(null);
    },
  });

  const handleTrigger = (jobName: string) => {
    setTriggeringJob(jobName);
    triggerMutation.mutate(jobName);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/admin/scheduler/jobs'] });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/scheduler/queue/stats'] });
  };

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
          <h1 className="text-3xl font-bold">Scheduler Dashboard</h1>
          <p className="text-muted-foreground">Background job management</p>
        </div>
        <Button variant="outline" onClick={handleRefresh}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Pending Messages</CardTitle>
            <Inbox className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.pending ?? 0}</div>
            <p className="text-xs text-muted-foreground">Waiting to be sent</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Sending Now</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.sending ?? 0}</div>
            <p className="text-xs text-muted-foreground">Currently in progress</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Sent Today</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.sent ?? 0}</div>
            <p className="text-xs text-muted-foreground">Successfully delivered</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.failed ?? 0}</div>
            <p className="text-xs text-muted-foreground">Errors today</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Scheduled Jobs
          </CardTitle>
          <CardDescription>Background jobs and their current status</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job Name</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Next Run</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    <Timer className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No scheduled jobs found</p>
                  </TableCell>
                </TableRow>
              )}
              {jobs.map((job) => (
                <TableRow key={job.jobName}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{job.jobName}</span>
                      {job.lastError && (
                        <span className="text-xs text-red-500 flex items-center gap-1 mt-1">
                          <XCircle className="h-3 w-3" />
                          {job.lastError}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-2 py-1 rounded flex items-center gap-1 w-fit">
                      <Clock className="h-3 w-3" />
                      {job.cronSchedule}
                    </code>
                  </TableCell>
                  <TableCell>{getStatusBadge(job.status)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelativeTime(job.lastRunAt)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelativeTime(job.nextRunAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTrigger(job.jobName)}
                      disabled={triggeringJob === job.jobName}
                    >
                      {triggeringJob === job.jobName ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4 mr-1" />
                      )}
                      Trigger
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
