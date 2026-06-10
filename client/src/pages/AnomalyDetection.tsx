import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatCurrency } from '@/lib/format';
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Info,
  Scan,
  X,
  RefreshCw,
  Clock,
  DollarSign,
  Copy,
  CalendarOff,
  Hash,
  UserX,
  TrendingUp,
} from 'lucide-react';

type AnomalySeverity = 'critical' | 'warning' | 'info';

interface Anomaly {
  id: string;
  type: string;
  severity: AnomalySeverity;
  description: string;
  amount: number;
  date: string;
  relatedId: string;
  relatedType: 'journal_entry' | 'receipt' | 'invoice';
}

interface AnomalySummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

interface AnomalyResult {
  anomalies: Anomaly[];
  summary: AnomalySummary;
  scannedAt: string;
}

const severityConfig: Record<AnomalySeverity, { color: string; bg: string; icon: typeof AlertTriangle; label: string }> = {
  critical: { color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: AlertCircle, label: 'Critical' },
  warning: { color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200', icon: AlertTriangle, label: 'Warning' },
  info: { color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', icon: Info, label: 'Info' },
};

const typeIcons: Record<string, typeof Copy> = {
  duplicate_amount: Copy,
  unusual_amount: DollarSign,
  weekend_transaction: CalendarOff,
  round_number: Hash,
  duplicate_vendor: UserX,
  expense_spike: TrendingUp,
};

export default function AnomalyDetection() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [severityFilter, setSeverityFilter] = useState<string>('all');

  const {
    data: result,
    isLoading,
    refetch,
    isFetching,
  } = useQuery<AnomalyResult>({
    queryKey: [`/api/companies/${companyId}/anomalies`],
    enabled: !!companyId,
  });

  const dismissMutation = useMutation({
    mutationFn: async (anomalyId: string) => {
      return apiRequest('POST', `/api/companies/${companyId}/anomalies/${anomalyId}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/anomalies`] });
      toast({ title: 'Anomaly dismissed', description: 'The anomaly has been removed from the list.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  if (isLoadingCompany) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              Please create a company first to use anomaly detection.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredAnomalies = result?.anomalies.filter(
    (a) => severityFilter === 'all' || a.severity === severityFilter
  ) || [];

  const formatAnomalyDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-AE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-100 rounded-lg">
            <ShieldAlert className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AI Anomaly Detection</h1>
            <p className="text-muted-foreground text-sm">
              Automatically scan transactions for irregularities and potential issues
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {result?.scannedAt && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Last scanned: {new Date(result.scannedAt).toLocaleString()}
            </span>
          )}
          <Button
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Scan className="h-4 w-4 mr-2" />
            )}
            {isFetching ? 'Scanning...' : 'Run Scan'}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : result ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setSeverityFilter('all')}
          >
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs">Total Anomalies</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold">{result.summary.total}</div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow border-red-200"
            onClick={() => setSeverityFilter('critical')}
          >
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <AlertCircle className="h-3 w-3 text-red-500" />
                Critical
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold text-red-600">{result.summary.critical}</div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow border-orange-200"
            onClick={() => setSeverityFilter('warning')}
          >
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-orange-500" />
                Warning
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold text-orange-600">{result.summary.warning}</div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow border-blue-200"
            onClick={() => setSeverityFilter('info')}
          >
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <Info className="h-3 w-3 text-blue-500" />
                Info
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold text-blue-600">{result.summary.info}</div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Filter:</span>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        {severityFilter !== 'all' && (
          <Button variant="ghost" size="sm" onClick={() => setSeverityFilter('all')}>
            Clear filter
          </Button>
        )}
      </div>

      {/* Anomaly List */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : filteredAnomalies.length > 0 ? (
        <div className="space-y-3">
          {filteredAnomalies.map((anomaly) => {
            const config = severityConfig[anomaly.severity];
            const SeverityIcon = config.icon;
            const TypeIcon = typeIcons[anomaly.type] || Info;

            return (
              <Card key={anomaly.id} className={`${config.bg} border`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={`mt-0.5 ${config.color}`}>
                        <SeverityIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant={anomaly.severity === 'critical' ? 'destructive' : 'secondary'}
                            className="text-xs"
                          >
                            {config.label}
                          </Badge>
                          <Badge variant="outline" className="text-xs flex items-center gap-1">
                            <TypeIcon className="h-3 w-3" />
                            {anomaly.type.replace(/_/g, ' ')}
                          </Badge>
                          {anomaly.amount > 0 && (
                            <span className="text-sm font-medium">
                              {formatCurrency(anomaly.amount, 'AED', locale)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm">{anomaly.description}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatAnomalyDate(anomaly.date)}
                          {anomaly.relatedType && (
                            <>
                              <span className="mx-1">|</span>
                              <span className="capitalize">{anomaly.relatedType.replace(/_/g, ' ')}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => dismissMutation.mutate(anomaly.id)}
                      disabled={dismissMutation.isPending}
                      className="shrink-0"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Dismiss
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : result ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8 space-y-3">
              <ShieldAlert className="h-12 w-12 text-green-500 mx-auto" />
              <h3 className="text-lg font-semibold">No Anomalies Found</h3>
              <p className="text-muted-foreground text-sm">
                {severityFilter !== 'all'
                  ? `No ${severityFilter} anomalies detected. Try changing the filter.`
                  : 'Your transactions look clean. No irregularities detected in the latest scan.'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
