import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  Activity, AlertTriangle, CheckCircle2, XCircle,
  ChevronUp, ChevronDown, ChevronsUpDown, Calendar,
  Building2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { useTranslation } from '@/lib/i18n';

// ─── Types ─────────────────────────────────────────────────────────────────────

type HealthStatus = 'healthy' | 'attention' | 'critical';
type VatStatus = 'on-track' | 'due-soon' | 'overdue';
type DeadlineStatus = 'upcoming' | 'due-soon' | 'overdue';

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
  type: 'vat' | 'corporate-tax' | 'audit';
  dueDate: string;
  daysTilDue: number;
  status: DeadlineStatus;
}

interface DeadlinesData {
  deadlines: Deadline[];
}

type SortField = 'health' | 'name' | 'ar' | 'vat';
type SortDir = 'asc' | 'desc';

// ─── Sub-components ────────────────────────────────────────────────────────────

function TrafficDot({ status }: { status: HealthStatus | VatStatus | DeadlineStatus }) {
  const colorMap: Record<string, string> = {
    healthy: 'bg-green-500',
    'on-track': 'bg-green-500',
    upcoming: 'bg-green-500',
    attention: 'bg-yellow-500',
    'due-soon': 'bg-yellow-500',
    critical: 'bg-red-500',
    overdue: 'bg-red-500',
  };
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${colorMap[status] ?? 'bg-gray-400'}`}
      title={status}
    />
  );
}

function HealthBadge({ status }: { status: HealthStatus }) {
  if (status === 'healthy') {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 gap-1">
        <CheckCircle2 className="w-3 h-3" />
        Healthy
      </Badge>
    );
  }
  if (status === 'attention') {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 gap-1">
        <AlertTriangle className="w-3 h-3" />
        Attention
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-800 border-red-200 gap-1">
      <XCircle className="w-3 h-3" />
      Critical
    </Badge>
  );
}

function DeadlineBadge({ status, daysTilDue }: { status: DeadlineStatus; daysTilDue: number }) {
  if (status === 'overdue') {
    return <Badge className="bg-red-100 text-red-800 border-red-200">{Math.abs(daysTilDue)}d overdue</Badge>;
  }
  if (status === 'due-soon') {
    return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Due in {daysTilDue}d</Badge>;
  }
  return <Badge variant="outline">In {daysTilDue}d</Badge>;
}

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) return <ChevronsUpDown className="w-3 h-3 ml-1 text-muted-foreground" />;
  return sortDir === 'asc'
    ? <ChevronUp className="w-3 h-3 ml-1" />
    : <ChevronDown className="w-3 h-3 ml-1" />;
}

const HEALTH_ORDER: Record<HealthStatus, number> = { critical: 0, attention: 1, healthy: 2 };
const VAT_ORDER: Record<VatStatus, number> = { overdue: 0, 'due-soon': 1, 'on-track': 2 };

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function FirmHealth() {
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const [sortField, setSortField] = useState<SortField>('health');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const { data: healthData, isLoading } = useQuery<HealthData>({
    queryKey: ['/api/firm/health'],
  });

  const { data: deadlinesData } = useQuery<DeadlinesData>({
    queryKey: ['/api/firm/health/deadlines'],
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortedClients = [...(healthData?.clients ?? [])].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'health') {
      cmp = HEALTH_ORDER[a.overallHealth] - HEALTH_ORDER[b.overallHealth];
    } else if (sortField === 'name') {
      cmp = a.companyName.localeCompare(b.companyName);
    } else if (sortField === 'ar') {
      cmp = a.arHealth.totalOutstanding - b.arHealth.totalOutstanding;
    } else if (sortField === 'vat') {
      cmp = VAT_ORDER[a.vatStatus.status] - VAT_ORDER[b.vatStatus.status];
    }
    return sortDir === 'asc' ? cmp : -cmp;
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-6 h-6 text-amber-600" />
          {t.healthDashboard}
        </h1>
        <p className="text-muted-foreground mt-1">{t.healthDashboardDesc}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t.totalClients}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{summary?.totalClients ?? 0}</p>
          </CardContent>
        </Card>

        <Card className="border-green-200 bg-green-50/40 dark:bg-green-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-700 dark:text-green-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              {t.healthy}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-700 dark:text-green-400">{summary?.healthy ?? 0}</p>
          </CardContent>
        </Card>

        <Card className="border-yellow-200 bg-yellow-50/40 dark:bg-yellow-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-yellow-700 dark:text-yellow-400 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              {t.needsAttention}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-yellow-700 dark:text-yellow-400">{summary?.attention ?? 0}</p>
          </CardContent>
        </Card>

        <Card className="border-red-200 bg-red-50/40 dark:bg-red-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-700 dark:text-red-400 flex items-center gap-1.5">
              <XCircle className="w-4 h-4" />
              {t.critical}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-red-700 dark:text-red-400">{summary?.critical ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Client health table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.clientHealthTable}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sortedClients.length === 0 ? (
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
                      onClick={() => handleSort('health')}
                    >
                      <span className="flex items-center">
                        {t.overallHealth}
                        <SortIcon field="health" sortField={sortField} sortDir={sortDir} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => handleSort('name')}
                    >
                      <span className="flex items-center">
                        {t.client}
                        <SortIcon field="name" sortField={sortField} sortDir={sortDir} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => handleSort('vat')}
                    >
                      <span className="flex items-center">
                        {t.vatStatus}
                        <SortIcon field="vat" sortField={sortField} sortDir={sortDir} />
                      </span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => handleSort('ar')}
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
                  {sortedClients.map(client => (
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
                            <p className="text-xs text-muted-foreground">TRN: {client.trn}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TrafficDot status={client.vatStatus.status} />
                          <span className="text-sm">
                            {client.vatStatus.nextDueDate
                              ? format(new Date(client.vatStatus.nextDueDate), 'MMM d')
                              : '—'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TrafficDot status={client.arHealth.status} />
                          <span className="text-sm">
                            {client.arHealth.overdueCount > 0
                              ? `${client.arHealth.overdueCount} overdue`
                              : 'Clear'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TrafficDot status={client.bankRecStatus.status} />
                          <span className="text-sm">
                            {client.bankRecStatus.unreconciledCount > 0
                              ? `${client.bankRecStatus.unreconciledCount} unmatched`
                              : 'Clear'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TrafficDot status={client.trialBalanceStatus.status} />
                          <span className="text-sm">
                            {client.trialBalanceStatus.balanced ? 'Balanced' : 'Off'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {client.lastActivity
                          ? format(new Date(client.lastActivity), 'MMM d, yyyy')
                          : '—'}
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
          {deadlines.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 className="w-8 h-8 text-green-500 mb-2" />
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
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">{dl.type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      {format(new Date(dl.dueDate), 'MMM d, yyyy')}
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
