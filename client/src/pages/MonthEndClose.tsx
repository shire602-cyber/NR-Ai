import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  CalendarCheck,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  Sparkles,
  FileText,
  RefreshCw,
  Clock,
  AlertTriangle,
  ArrowRight,
  BookOpen,
} from 'lucide-react';

// ---- Types ----

interface ChecklistItem {
  id: number;
  title: string;
  description: string;
  status: 'complete' | 'incomplete';
  details?: string;
}

interface ChecklistResponse {
  period: string;
  periodStart: string;
  periodEnd: string;
  checklist: ChecklistItem[];
}

interface ValidationResponse {
  period: string;
  ready: boolean;
  summary: string;
  checklist: ChecklistItem[];
}

interface ClosingEntry {
  id: string;
  entryNumber: string;
  date: string;
  memo: string;
  lines: Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
  }>;
  totalDebits: number;
  totalCredits: number;
}

interface CloseRecord {
  id: string;
  companyId: string;
  periodEnd: string;
  status: string;
  closedBy: string | null;
  closedAt: string | null;
  closingEntryId: string | null;
  createdAt: string;
  closedByEmail?: string | null;
}

// ---- Fix routes for incomplete items ----
const fixRoutes: Record<number, string> = {
  1: '/bank-reconciliation',
  2: '/invoices',
  3: '/receipts',
  4: '/anomaly-detection',
  5: '/ai-features',
  6: '/fixed-assets',
  7: '/vat-filing',
};

// ---- Component ----

export default function MonthEndClose() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();

  // Default to previous month
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [selectedYear, setSelectedYear] = useState(String(prevMonth.getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(String(prevMonth.getMonth() + 1));

  const period = useMemo(
    () => `${selectedYear}-${selectedMonth.padStart(2, '0')}`,
    [selectedYear, selectedMonth]
  );

  const periodDates = useMemo(() => {
    const y = parseInt(selectedYear);
    const m = parseInt(selectedMonth);
    const periodStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const periodEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { periodStart, periodEnd };
  }, [selectedYear, selectedMonth]);

  // ---- Queries ----

  const {
    data: checklistData,
    isLoading: isLoadingChecklist,
    refetch: refetchChecklist,
  } = useQuery<ChecklistResponse>({
    queryKey: [`/api/companies/${companyId}/month-end/checklist?period=${period}`],
    enabled: !!companyId,
  });

  const {
    data: historyData,
    isLoading: isLoadingHistory,
  } = useQuery<CloseRecord[]>({
    queryKey: [`/api/companies/${companyId}/month-end/history`],
    enabled: !!companyId,
  });

  // ---- Mutations ----

  const validationMutation = useMutation<ValidationResponse>({
    mutationFn: async () => {
      return apiRequest('GET', `/api/companies/${companyId}/month-end/ai-validation?period=${period}`);
    },
    onError: (error: Error) => {
      toast({ title: 'Validation Error', description: error?.message, variant: 'destructive' });
    },
  });

  const closingEntriesMutation = useMutation<ClosingEntry>({
    mutationFn: async () => {
      return apiRequest('POST', `/api/companies/${companyId}/month-end/generate-closing-entries`, {
        periodStart: periodDates.periodStart,
        periodEnd: periodDates.periodEnd,
      });
    },
    onSuccess: (data) => {
      toast({
        title: 'Closing Entries Created',
        description: `Journal entry ${data.entryNumber} posted with ${data.lines.length} lines.`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/month-end/checklist`] });
      refetchChecklist();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const lockPeriodMutation = useMutation<CloseRecord>({
    mutationFn: async () => {
      return apiRequest('POST', `/api/companies/${companyId}/month-end/lock-period`, {
        periodEnd: periodDates.periodEnd,
      });
    },
    onSuccess: () => {
      toast({
        title: 'Period Locked',
        description: `Period ${formatPeriodLabel(period)} has been locked.`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/month-end/history`] });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  // ---- Helpers ----

  const months = [
    { value: '1', label: 'January' },
    { value: '2', label: 'February' },
    { value: '3', label: 'March' },
    { value: '4', label: 'April' },
    { value: '5', label: 'May' },
    { value: '6', label: 'June' },
    { value: '7', label: 'July' },
    { value: '8', label: 'August' },
    { value: '9', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ];

  const years = Array.from({ length: 5 }, (_, i) => String(now.getFullYear() - i));

  function formatPeriodLabel(p: string): string {
    const [y, m] = p.split('-').map(Number);
    const monthName = months.find((mo) => Number(mo.value) === m)?.label || '';
    return `${monthName} ${y}`;
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('en-AE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  }

  const isCurrentPeriodLocked = historyData?.some(
    (record) =>
      record.status === 'locked' &&
      new Date(record.periodEnd).toISOString().startsWith(
        `${selectedYear}-${selectedMonth.padStart(2, '0')}`
      )
  ) || false;

  const completedCount = checklistData?.checklist.filter((i) => i.status === 'complete').length || 0;
  const totalCount = checklistData?.checklist.length || 7;

  // ---- Loading state ----

  if (isLoadingCompany) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              Please create a company first to use month-end close.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <CalendarCheck className="h-6 w-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Month-End Close</h1>
            <p className="text-muted-foreground text-sm">
              Review, validate, and lock your monthly accounting period
            </p>
          </div>
        </div>

        {isCurrentPeriodLocked && (
          <Badge variant="destructive" className="flex items-center gap-1 text-sm px-3 py-1">
            <Lock className="h-4 w-4" />
            Period Locked
          </Badge>
        )}
      </div>

      {/* Period Selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm font-medium">Period:</span>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchChecklist()}
              disabled={isLoadingChecklist}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingChecklist ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Checklist */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Close Checklist</CardTitle>
              <CardDescription>
                {completedCount}/{totalCount} items complete for {formatPeriodLabel(period)}
              </CardDescription>
            </div>
            <Badge variant={completedCount === totalCount ? 'default' : 'secondary'}>
              {completedCount === totalCount ? 'All Clear' : `${totalCount - completedCount} remaining`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingChecklist ? (
            <div className="space-y-3">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : checklistData ? (
            <div className="space-y-2">
              {checklistData.checklist.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    item.status === 'complete'
                      ? 'bg-green-50 border-green-200'
                      : 'bg-red-50 border-red-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {item.status === 'complete' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.details || item.description}</p>
                    </div>
                  </div>
                  {item.status === 'incomplete' && fixRoutes[item.id] && (
                    <a href={fixRoutes[item.id]}>
                      <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700">
                        Fix <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-6">
              Select a period to load the checklist.
            </p>
          )}
        </CardContent>
      </Card>

      {/* AI Validation Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              <CardTitle className="text-lg">AI Validation</CardTitle>
            </div>
            <Button
              onClick={() => validationMutation.mutate()}
              disabled={validationMutation.isPending}
              variant="outline"
            >
              {validationMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Run Validation
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {validationMutation.data ? (
            <div
              className={`p-4 rounded-lg border ${
                validationMutation.data.ready
                  ? 'bg-green-50 border-green-200'
                  : 'bg-amber-50 border-amber-200'
              }`}
            >
              <div className="flex items-start gap-3">
                {validationMutation.data.ready ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                )}
                <div className="space-y-1">
                  <p className="font-medium text-sm">
                    {validationMutation.data.ready ? 'Ready to Close' : 'Not Ready'}
                  </p>
                  <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-sans">
                    {validationMutation.data.summary}
                  </pre>
                </div>
              </div>
            </div>
          ) : validationMutation.isPending ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span className="text-sm">Running AI validation...</span>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-6">
              Click "Run Validation" to get an AI-powered readiness assessment.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Generate Closing Entries */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              disabled={closingEntriesMutation.isPending || isCurrentPeriodLocked}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {closingEntriesMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileText className="h-4 w-4 mr-2" />
              )}
              Generate Closing Entries
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Generate Closing Entries</AlertDialogTitle>
              <AlertDialogDescription>
                This will create a journal entry that closes all revenue and expense accounts
                for {formatPeriodLabel(period)}, transferring the net result to retained earnings.
                This action posts the entry immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => closingEntriesMutation.mutate()}>
                Generate & Post
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Lock Period */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              disabled={lockPeriodMutation.isPending || isCurrentPeriodLocked}
            >
              {lockPeriodMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Lock className="h-4 w-4 mr-2" />
              )}
              Lock Period
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Lock Period</AlertDialogTitle>
              <AlertDialogDescription>
                Locking {formatPeriodLabel(period)} will prevent any modifications to transactions
                in this period. This is typically done after all closing entries are posted and
                the period has been fully reviewed. This action cannot be easily undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => lockPeriodMutation.mutate()}
                className="bg-red-600 hover:bg-red-700"
              >
                Lock Period
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Closing Entry Result */}
      {closingEntriesMutation.data && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-indigo-600" />
              <CardTitle className="text-lg">Closing Entry Created</CardTitle>
            </div>
            <CardDescription>
              {closingEntriesMutation.data.entryNumber} - {closingEntriesMutation.data.memo}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Debit (AED)</TableHead>
                  <TableHead className="text-right">Credit (AED)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closingEntriesMutation.data.lines.map((line, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <span className="font-mono text-xs mr-2">{line.accountCode}</span>
                      {line.accountName}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.debit > 0 ? line.debit.toLocaleString('en-AE', { minimumFractionDigits: 2 }) : ''}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.credit > 0 ? line.credit.toLocaleString('en-AE', { minimumFractionDigits: 2 }) : ''}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold border-t-2">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">
                    {closingEntriesMutation.data.totalDebits.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    {closingEntriesMutation.data.totalCredits.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* History Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Close History</CardTitle>
          </div>
          <CardDescription>Past month-end closings for this company</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingHistory ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : historyData && historyData.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Closed By</TableHead>
                  <TableHead>Closed At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyData.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">
                      {(() => {
                        try {
                          const d = new Date(record.periodEnd);
                          return d.toLocaleDateString('en-AE', { year: 'numeric', month: 'long' });
                        } catch {
                          return record.periodEnd;
                        }
                      })()}
                    </TableCell>
                    <TableCell>
                      {record.status === 'locked' ? (
                        <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                          <Lock className="h-3 w-3" />
                          Locked
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                          <Unlock className="h-3 w-3" />
                          Open
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {record.closedByEmail || record.closedBy || '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(record.closedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-8">
              No period closings recorded yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
