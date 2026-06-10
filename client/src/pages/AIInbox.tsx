import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  Brain,
  Check,
  X,
  Pencil,
  Loader2,
  RefreshCw,
  TrendingUp,
  Zap,
  Target,
  Clock,
  BookOpen,
  CheckCircle2,
  XCircle,
  ArrowUpDown,
  BarChart3,
} from 'lucide-react';

// =============================================
// Types
// =============================================

interface AIGLQueueItem {
  id: string;
  company_id: string;
  bank_transaction_id: string | null;
  description: string;
  amount: string;
  transaction_date: string;
  suggested_account_id: string | null;
  suggested_account_name: string | null;
  suggested_account_code: string | null;
  suggested_account_type: string | null;
  suggested_category: string | null;
  ai_confidence: string;
  ai_reason: string | null;
  few_shot_examples_used: number;
  status: string;
  journal_entry_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  user_selected_account_id: string | null;
  user_account_name: string | null;
  user_account_code: string | null;
  created_at: string;
}

interface AIGLStats {
  totalProcessed: number;
  autoPosted: number;
  autoPostedPercent: number;
  accuracy: number;
  pendingReview: number;
  rulesCount: number;
}

interface AccountOption {
  id: string;
  code: string;
  nameEn: string;
  type: string;
}

interface ScanResult {
  message: string;
  scan: {
    scanned: number;
    classified: number;
    ruleMatched: number;
    aiClassified: number;
  };
  autoPost: {
    posted: number;
    errors: string[];
  };
}

// =============================================
// Helpers
// =============================================

function getConfidenceLevel(confidence: number): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive';
  color: string;
} {
  if (confidence >= 0.85)
    return { label: 'High', variant: 'default', color: 'text-green-600' };
  if (confidence >= 0.6)
    return { label: 'Medium', variant: 'secondary', color: 'text-orange-500' };
  return { label: 'Low', variant: 'destructive', color: 'text-red-500' };
}

function getStatusBadge(status: string): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  switch (status) {
    case 'pending_review':
      return { label: 'Pending Review', variant: 'outline' };
    case 'auto_posted':
      return { label: 'Auto-Posted', variant: 'default' };
    case 'accepted':
      return { label: 'Accepted', variant: 'default' };
    case 'rejected':
      return { label: 'Rejected', variant: 'destructive' };
    case 'corrected':
      return { label: 'Corrected', variant: 'secondary' };
    default:
      return { label: status, variant: 'outline' };
  }
}

// =============================================
// Component
// =============================================

export default function AIInbox() {
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [activeTab, setActiveTab] = useState('pending');
  const [correctDialogOpen, setCorrectDialogOpen] = useState(false);
  const [correctingItem, setCorrectingItem] = useState<AIGLQueueItem | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  // ---- Queries ----

  const statsQuery = useQuery<AIGLStats>({
    queryKey: ['/api/companies', companyId, 'ai-gl', 'stats'],
    enabled: !!companyId,
  });

  const pendingQuery = useQuery<AIGLQueueItem[]>({
    queryKey: ['/api/companies', companyId, 'ai-gl', 'queue?status=pending_review'],
    enabled: !!companyId && activeTab === 'pending',
  });

  const autoPostedQuery = useQuery<AIGLQueueItem[]>({
    queryKey: ['/api/companies', companyId, 'ai-gl', 'queue?status=auto_posted'],
    enabled: !!companyId && activeTab === 'autoposted',
  });

  const historyQuery = useQuery<AIGLQueueItem[]>({
    queryKey: ['/api/companies', companyId, 'ai-gl', 'queue'],
    enabled: !!companyId && activeTab === 'history',
  });

  const accountsQuery = useQuery<AccountOption[]>({
    queryKey: ['/api/companies', companyId, 'accounts'],
    enabled: !!companyId,
  });

  // ---- Mutations ----

  const scanMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', `/api/companies/${companyId}/ai-gl/scan`);
    },
    onSuccess: (data: ScanResult) => {
      toast({
        title: 'Scan Complete',
        description: data.message,
      });
      invalidateAll();
    },
    onError: (error: Error) => {
      toast({
        title: 'Scan Failed',
        description: error?.message,
        variant: 'destructive',
      });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async (itemId: string) => {
      return apiRequest(
        'POST',
        `/api/companies/${companyId}/ai-gl/queue/${itemId}/accept`
      );
    },
    onSuccess: (_data: any, itemId: string) => {
      toast({ title: 'Accepted', description: 'Transaction posted to GL.' });
      invalidateAll();
    },
    onError: (error: Error) => {
      toast({
        title: 'Accept Failed',
        description: error?.message,
        variant: 'destructive',
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (itemId: string) => {
      return apiRequest(
        'POST',
        `/api/companies/${companyId}/ai-gl/queue/${itemId}/reject`
      );
    },
    onSuccess: () => {
      toast({ title: 'Rejected', description: 'Transaction rejected.' });
      invalidateAll();
    },
    onError: (error: Error) => {
      toast({
        title: 'Reject Failed',
        description: error?.message,
        variant: 'destructive',
      });
    },
  });

  const correctMutation = useMutation({
    mutationFn: async ({
      itemId,
      accountId,
    }: {
      itemId: string;
      accountId: string;
    }) => {
      return apiRequest(
        'POST',
        `/api/companies/${companyId}/ai-gl/queue/${itemId}/correct`,
        { accountId }
      );
    },
    onSuccess: () => {
      toast({
        title: 'Corrected',
        description: 'Transaction corrected and posted to GL.',
      });
      setCorrectDialogOpen(false);
      setCorrectingItem(null);
      setSelectedAccountId('');
      invalidateAll();
    },
    onError: (error: Error) => {
      toast({
        title: 'Correction Failed',
        description: error?.message,
        variant: 'destructive',
      });
    },
  });

  const bulkAcceptMutation = useMutation({
    mutationFn: async (items: AIGLQueueItem[]) => {
      const results = [];
      for (const item of items) {
        try {
          await apiRequest(
            'POST',
            `/api/companies/${companyId}/ai-gl/queue/${item.id}/accept`
          );
          results.push({ id: item.id, success: true });
        } catch (err: any) {
          results.push({ id: item.id, success: false, error: err?.message });
        }
      }
      return results;
    },
    onSuccess: (results: any[]) => {
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;
      toast({
        title: 'Bulk Accept Complete',
        description: `${successCount} accepted${failCount > 0 ? `, ${failCount} failed` : ''}.`,
      });
      invalidateAll();
    },
    onError: (error: Error) => {
      toast({
        title: 'Bulk Accept Failed',
        description: error?.message,
        variant: 'destructive',
      });
    },
  });

  function invalidateAll() {
    queryClient.invalidateQueries({
      queryKey: ['/api/companies', companyId, 'ai-gl'],
    });
    queryClient.invalidateQueries({
      queryKey: ['/api/companies', companyId, 'bank-transactions'],
    });
  }

  function openCorrectDialog(item: AIGLQueueItem) {
    setCorrectingItem(item);
    setSelectedAccountId('');
    setCorrectDialogOpen(true);
  }

  // ---- Loading / Empty states ----

  if (isLoadingCompany) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              Please create a company first to use the AI Inbox.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = statsQuery.data;
  const pendingItems = pendingQuery.data || [];
  const autoPostedItems = autoPostedQuery.data || [];
  const historyItems = historyQuery.data || [];
  const accounts = accountsQuery.data || [];

  const highConfidencePending = pendingItems.filter(
    (item) => parseFloat(item.ai_confidence) >= 0.85 && item.suggested_account_id
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AI Inbox</h1>
            <p className="text-muted-foreground text-sm">
              Autonomous GL Engine — AI categorizes and posts bank transactions
            </p>
          </div>
        </div>
        <Button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          size="lg"
        >
          {scanMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {scanMutation.isPending ? 'Scanning...' : 'Run Scan'}
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <BarChart3 className="h-3 w-3" />
                Total Processed
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold">{stats.totalProcessed}</div>
            </CardContent>
          </Card>
          <Card className="border-blue-200">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <Zap className="h-3 w-3 text-blue-500" />
                Auto-Posted %
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold text-blue-600">
                {stats.autoPostedPercent}%
              </div>
            </CardContent>
          </Card>
          <Card className="border-green-200">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <Target className="h-3 w-3 text-green-500" />
                Accuracy %
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold text-green-600">
                {stats.accuracy}%
              </div>
            </CardContent>
          </Card>
          <Card className="border-orange-200">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <Clock className="h-3 w-3 text-orange-500" />
                Pending Review
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold text-orange-600">
                {stats.pendingReview}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <BookOpen className="h-3 w-3" />
                Active Rules
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold">{stats.rulesCount}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending" className="gap-1">
            <Clock className="h-4 w-4" />
            Pending Review
            {stats && stats.pendingReview > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {stats.pendingReview}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="autoposted" className="gap-1">
            <Zap className="h-4 w-4" />
            Auto-Posted
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1">
            <ArrowUpDown className="h-4 w-4" />
            History
          </TabsTrigger>
        </TabsList>

        {/* Pending Review Tab */}
        <TabsContent value="pending" className="space-y-4">
          {highConfidencePending.length > 0 && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => bulkAcceptMutation.mutate(highConfidencePending)}
                disabled={bulkAcceptMutation.isPending}
              >
                {bulkAcceptMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Bulk Accept High Confidence ({highConfidencePending.length})
              </Button>
            </div>
          )}

          {pendingQuery.isLoading ? (
            <Skeleton className="h-64" />
          ) : pendingItems.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-12 space-y-4">
                  <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
                  <h3 className="text-lg font-semibold">All Clear</h3>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    No transactions pending review. Click "Run Scan" to check for
                    new unreconciled bank transactions.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Suggested Account</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>AI Reason</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingItems.map((item) => {
                        const confidence = parseFloat(item.ai_confidence);
                        const confLevel = getConfidenceLevel(confidence);
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="whitespace-nowrap text-sm">
                              {formatDate(item.transaction_date)}
                            </TableCell>
                            <TableCell>
                              <span className="text-sm font-medium">
                                {item.description}
                              </span>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap font-mono text-sm">
                              {formatCurrency(parseFloat(item.amount))}
                            </TableCell>
                            <TableCell>
                              {item.suggested_account_name ? (
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium">
                                    {item.suggested_account_name}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {item.suggested_account_code}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  No suggestion
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2 min-w-[140px]">
                                <div className="w-16">
                                  <Progress
                                    value={confidence * 100}
                                    className="h-2"
                                  />
                                </div>
                                <span
                                  className={`text-sm font-semibold ${confLevel.color}`}
                                >
                                  {Math.round(confidence * 100)}%
                                </span>
                                <Badge
                                  variant={confLevel.variant}
                                  className="text-xs"
                                >
                                  {confLevel.label}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-muted-foreground line-clamp-2 max-w-[200px]">
                                {item.ai_reason || 'N/A'}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                                  onClick={() => acceptMutation.mutate(item.id)}
                                  disabled={
                                    acceptMutation.isPending ||
                                    !item.suggested_account_id
                                  }
                                  title="Accept"
                                >
                                  <Check className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => rejectMutation.mutate(item.id)}
                                  disabled={rejectMutation.isPending}
                                  title="Reject"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                  onClick={() => openCorrectDialog(item)}
                                  title="Correct"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Auto-Posted Tab */}
        <TabsContent value="autoposted" className="space-y-4">
          {autoPostedQuery.isLoading ? (
            <Skeleton className="h-64" />
          ) : autoPostedItems.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-12 space-y-4">
                  <Zap className="h-12 w-12 text-muted-foreground mx-auto" />
                  <h3 className="text-lg font-semibold">No Auto-Posted Items</h3>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    High-confidence transactions will be automatically posted here
                    when scanned.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>Journal Entry</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {autoPostedItems.map((item) => {
                        const confidence = parseFloat(item.ai_confidence);
                        const confLevel = getConfidenceLevel(confidence);
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="whitespace-nowrap text-sm">
                              {formatDate(item.transaction_date)}
                            </TableCell>
                            <TableCell>
                              <span className="text-sm font-medium">
                                {item.description}
                              </span>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap font-mono text-sm">
                              {formatCurrency(parseFloat(item.amount))}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="text-sm font-medium">
                                  {item.suggested_account_name || 'N/A'}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {item.suggested_account_code}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-sm font-semibold ${confLevel.color}`}
                                >
                                  {Math.round(confidence * 100)}%
                                </span>
                                <Badge
                                  variant={confLevel.variant}
                                  className="text-xs"
                                >
                                  {confLevel.label}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell>
                              {item.journal_entry_id ? (
                                <a
                                  href={`/journal/${item.journal_entry_id}`}
                                  className="text-sm text-primary hover:underline font-mono"
                                >
                                  {item.journal_entry_id.substring(0, 8)}...
                                </a>
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  N/A
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-4">
          {historyQuery.isLoading ? (
            <Skeleton className="h-64" />
          ) : historyItems.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-12 space-y-4">
                  <ArrowUpDown className="h-12 w-12 text-muted-foreground mx-auto" />
                  <h3 className="text-lg font-semibold">No History</h3>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    Transaction history will appear here after items are processed.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Reviewed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyItems.map((item) => {
                        const confidence = parseFloat(item.ai_confidence);
                        const confLevel = getConfidenceLevel(confidence);
                        const statusBadge = getStatusBadge(item.status);
                        const displayAccount =
                          item.user_account_name || item.suggested_account_name;
                        const displayCode =
                          item.user_account_code || item.suggested_account_code;

                        return (
                          <TableRow key={item.id}>
                            <TableCell className="whitespace-nowrap text-sm">
                              {formatDate(item.transaction_date)}
                            </TableCell>
                            <TableCell>
                              <span className="text-sm font-medium">
                                {item.description}
                              </span>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap font-mono text-sm">
                              {formatCurrency(parseFloat(item.amount))}
                            </TableCell>
                            <TableCell>
                              {displayAccount ? (
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium">
                                    {displayAccount}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {displayCode}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  N/A
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <span
                                className={`text-sm font-semibold ${confLevel.color}`}
                              >
                                {Math.round(confidence * 100)}%
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusBadge.variant}>
                                {statusBadge.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {item.reviewed_at ? (
                                <span className="text-xs text-muted-foreground">
                                  {formatDate(item.reviewed_at)}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  --
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Correct Dialog */}
      <Dialog open={correctDialogOpen} onOpenChange={setCorrectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct Account Assignment</DialogTitle>
            <DialogDescription>
              Choose the correct account for this transaction. This will create a
              new rule so similar transactions are categorized correctly in the
              future.
            </DialogDescription>
          </DialogHeader>
          {correctingItem && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-muted p-3 space-y-1">
                <p className="text-sm font-medium">{correctingItem.description}</p>
                <p className="text-sm text-muted-foreground">
                  Amount: {formatCurrency(parseFloat(correctingItem.amount))}
                </p>
                {correctingItem.suggested_account_name && (
                  <p className="text-xs text-muted-foreground">
                    AI suggested: {correctingItem.suggested_account_code}{' '}
                    {correctingItem.suggested_account_name}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Select Account</label>
                <Select
                  value={selectedAccountId}
                  onValueChange={setSelectedAccountId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an account..." />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.code} — {acc.nameEn} ({acc.type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCorrectDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (correctingItem && selectedAccountId) {
                  correctMutation.mutate({
                    itemId: correctingItem.id,
                    accountId: selectedAccountId,
                  });
                }
              }}
              disabled={!selectedAccountId || correctMutation.isPending}
            >
              {correctMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Confirm Correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
