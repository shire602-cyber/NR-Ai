import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatCurrency } from '@/lib/format';
import {
  Sparkles,
  Link2,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  ArrowRightLeft,
  FileText,
  Receipt,
  BookOpen,
  AlertTriangle,
  Check,
  Unlink,
} from 'lucide-react';

interface ReconcileMatch {
  bankTransactionId: string;
  matchedType: 'journal_entry' | 'invoice' | 'receipt';
  matchedId: string;
  confidence: number;
  matchReason: string;
}

interface AutoReconcileResult {
  matches: ReconcileMatch[];
  autoMatchedCount: number;
  manualReviewCount: number;
  totalUnreconciled: number;
}

const matchTypeConfig = {
  journal_entry: { icon: BookOpen, label: 'Journal Entry', color: 'text-purple-600', bg: 'bg-purple-100' },
  invoice: { icon: FileText, label: 'Invoice', color: 'text-blue-600', bg: 'bg-blue-100' },
  receipt: { icon: Receipt, label: 'Receipt', color: 'text-green-600', bg: 'bg-green-100' },
};

function getConfidenceColor(confidence: number): string {
  if (confidence >= 80) return 'text-green-600';
  if (confidence >= 60) return 'text-orange-500';
  return 'text-red-500';
}

function getConfidenceBadge(confidence: number): { variant: 'default' | 'secondary' | 'destructive'; label: string } {
  if (confidence >= 80) return { variant: 'default', label: 'High' };
  if (confidence >= 60) return { variant: 'secondary', label: 'Medium' };
  return { variant: 'destructive', label: 'Low' };
}

export default function AutoReconcile() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [result, setResult] = useState<AutoReconcileResult | null>(null);
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(new Set());
  const [hasScanned, setHasScanned] = useState(false);

  // Run auto-reconciliation
  const scanMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', `/api/companies/${companyId}/auto-reconcile`);
    },
    onSuccess: (data: AutoReconcileResult) => {
      setResult(data);
      setHasScanned(true);
      // Pre-select high confidence matches
      const highConfidence = new Set<string>();
      data.matches
        .filter((m) => m.confidence >= 75)
        .forEach((m) => highConfidence.add(m.bankTransactionId));
      setSelectedMatches(highConfidence);
      toast({
        title: 'Scan complete',
        description: `Found ${data.matches.length} potential match(es) for ${data.totalUnreconciled} unreconciled transaction(s).`,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Scan failed', description: error?.message, variant: 'destructive' });
    },
  });

  // Apply selected matches
  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!result) return;
      const matchesToApply = result.matches
        .filter((m) => selectedMatches.has(m.bankTransactionId))
        .map((m) => ({
          bankTransactionId: m.bankTransactionId,
          matchedType: m.matchedType,
          matchedId: m.matchedId,
        }));
      return apiRequest('POST', `/api/companies/${companyId}/auto-reconcile/apply`, {
        matches: matchesToApply,
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: 'Reconciliation applied',
        description: data.message,
      });
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'bank-transactions'] });
      // Re-scan to update results
      scanMutation.mutate();
    },
    onError: (error: Error) => {
      toast({ title: 'Apply failed', description: error?.message, variant: 'destructive' });
    },
  });

  const toggleMatch = (bankTransactionId: string) => {
    setSelectedMatches((prev) => {
      const next = new Set(prev);
      if (next.has(bankTransactionId)) {
        next.delete(bankTransactionId);
      } else {
        next.add(bankTransactionId);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (!result) return;
    setSelectedMatches(new Set(result.matches.map((m) => m.bankTransactionId)));
  };

  const deselectAll = () => {
    setSelectedMatches(new Set());
  };

  if (isLoadingCompany) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
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
              Please create a company first to use auto-reconciliation.
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
          <div className="p-2 bg-primary/10 rounded-lg">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AI Auto-Reconciliation</h1>
            <p className="text-muted-foreground text-sm">
              Automatically match bank transactions with journal entries, invoices, and receipts
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
            <ArrowRightLeft className="h-4 w-4 mr-2" />
          )}
          {scanMutation.isPending ? 'Scanning...' : 'Run Auto-Reconcile'}
        </Button>
      </div>

      {/* Summary Cards */}
      {result && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <Unlink className="h-3 w-3" />
                Unreconciled
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold">{result.totalUnreconciled}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <Link2 className="h-3 w-3" />
                Total Matches
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold">{result.matches.length}</div>
            </CardContent>
          </Card>
          <Card className="border-green-200">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                High Confidence
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold text-green-600">{result.autoMatchedCount}</div>
            </CardContent>
          </Card>
          <Card className="border-orange-200">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-orange-500" />
                Needs Review
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold text-orange-600">{result.manualReviewCount}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Matches Table */}
      {result && result.matches.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Link2 className="h-5 w-5 text-primary" />
                  Suggested Matches
                </CardTitle>
                <CardDescription>
                  Review and apply auto-detected reconciliation matches.
                  {selectedMatches.size > 0 && ` ${selectedMatches.size} selected.`}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAll}>
                  Deselect All
                </Button>
                <Button
                  onClick={() => applyMutation.mutate()}
                  disabled={selectedMatches.size === 0 || applyMutation.isPending}
                >
                  {applyMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Apply {selectedMatches.size > 0 ? `(${selectedMatches.size})` : ''}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead>Bank Transaction</TableHead>
                    <TableHead>Matched With</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Match Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.matches.map((match) => {
                    const typeConfig = matchTypeConfig[match.matchedType];
                    const TypeIcon = typeConfig.icon;
                    const confBadge = getConfidenceBadge(match.confidence);

                    return (
                      <TableRow
                        key={match.bankTransactionId}
                        className={selectedMatches.has(match.bankTransactionId) ? 'bg-primary/5' : ''}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedMatches.has(match.bankTransactionId)}
                            onCheckedChange={() => toggleMatch(match.bankTransactionId)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-mono text-xs text-muted-foreground">
                              {match.bankTransactionId.substring(0, 8)}...
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className={`p-1 rounded ${typeConfig.bg}`}>
                              <TypeIcon className={`h-3 w-3 ${typeConfig.color}`} />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm">{typeConfig.label}</span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {match.matchedId.substring(0, 8)}...
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-16">
                              <Progress
                                value={match.confidence}
                                className="h-2"
                              />
                            </div>
                            <span className={`text-sm font-semibold ${getConfidenceColor(match.confidence)}`}>
                              {match.confidence}%
                            </span>
                            <Badge variant={confBadge.variant} className="text-xs">
                              {confBadge.label}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{match.matchReason}</span>
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

      {/* Empty States */}
      {!hasScanned && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-12 space-y-4">
              <ArrowRightLeft className="h-12 w-12 text-muted-foreground mx-auto" />
              <h3 className="text-lg font-semibold">Ready to Reconcile</h3>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Click "Run Auto-Reconcile" to scan your unreconciled bank transactions and
                automatically find matching journal entries, invoices, and receipts.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {hasScanned && result && result.matches.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-12 space-y-4">
              {result.totalUnreconciled === 0 ? (
                <>
                  <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
                  <h3 className="text-lg font-semibold">All Caught Up</h3>
                  <p className="text-muted-foreground text-sm">
                    No unreconciled bank transactions found. All transactions are already matched.
                  </p>
                </>
              ) : (
                <>
                  <XCircle className="h-12 w-12 text-orange-500 mx-auto" />
                  <h3 className="text-lg font-semibold">No Matches Found</h3>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    {result.totalUnreconciled} unreconciled transaction(s) found, but no automatic matches
                    could be determined. Try reconciling these manually in Bank Reconciliation.
                  </p>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
