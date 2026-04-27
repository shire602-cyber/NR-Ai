import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  ArrowRightLeft,
  FileText,
  Receipt,
  BookOpen,
  AlertTriangle,
  Check,
  Unlink,
  ChevronRight,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ReconcileMatch {
  bankTransactionId: string;
  matchedType: 'journal_entry' | 'invoice' | 'receipt';
  matchedId: string;
  confidence: number;
  matchReason: string;
  // Enriched display fields from the service
  bankDescription?: string;
  bankAmount?: number;
  bankDate?: string;
  matchedDescription?: string;
  matchedAmount?: number;
  matchedDate?: string;
}

interface AutoReconcileResult {
  matches: ReconcileMatch[];
  autoMatchedCount: number;
  manualReviewCount: number;
  totalUnreconciled: number;
}

// ─── Config ────────────────────────────────────────────────────────────────

const matchTypeConfig = {
  journal_entry: { icon: BookOpen, label: 'Journal Entry', color: 'text-purple-600', bg: 'bg-purple-100' },
  invoice: { icon: FileText, label: 'Invoice', color: 'text-blue-600', bg: 'bg-blue-100' },
  receipt: { icon: Receipt, label: 'Receipt', color: 'text-green-600', bg: 'bg-green-100' },
};

function getConfidenceStyle(confidence: number) {
  if (confidence >= 80) return { textColor: 'text-green-600', barClass: '[&>div]:bg-green-500', badge: 'bg-green-100 text-green-800', label: 'High' };
  if (confidence >= 60) return { textColor: 'text-amber-600', barClass: '[&>div]:bg-amber-500', badge: 'bg-amber-100 text-amber-800', label: 'Medium' };
  return { textColor: 'text-red-500', barClass: '[&>div]:bg-red-500', badge: 'bg-red-100 text-red-800', label: 'Low' };
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '—';
  try { return format(parseISO(dateStr), 'dd MMM yyyy'); } catch { return dateStr; }
}

// ─── Component ────────────────────────────────────────────────────────────

export default function AutoReconcile() {
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [result, setResult] = useState<AutoReconcileResult | null>(null);
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(new Set());
  const [hasScanned, setHasScanned] = useState(false);

  const scanMutation = useMutation({
    mutationFn: async () => apiRequest('POST', `/api/companies/${companyId}/auto-reconcile`),
    onSuccess: (data: AutoReconcileResult) => {
      setResult(data);
      setHasScanned(true);
      // Pre-select high confidence matches
      const highConf = new Set(data.matches.filter((m) => m.confidence >= 75).map((m) => m.bankTransactionId));
      setSelectedMatches(highConf);
      toast({
        title: 'Scan complete',
        description: `Found ${data.matches.length} potential match(es) for ${data.totalUnreconciled} unreconciled transaction(s).`,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Scan failed', description: error?.message, variant: 'destructive' });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!result) return;
      const matchesToApply = result.matches
        .filter((m) => selectedMatches.has(m.bankTransactionId))
        .map((m) => ({ bankTransactionId: m.bankTransactionId, matchedType: m.matchedType, matchedId: m.matchedId }));
      return apiRequest('POST', `/api/companies/${companyId}/auto-reconcile/apply`, { matches: matchesToApply });
    },
    onSuccess: (data: any) => {
      toast({ title: 'Reconciliation applied', description: data.message });
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'bank-statements'] });
      scanMutation.mutate();
    },
    onError: (error: Error) => {
      toast({ title: 'Apply failed', description: error?.message, variant: 'destructive' });
    },
  });

  const toggleMatch = (id: string) => {
    setSelectedMatches((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => result && setSelectedMatches(new Set(result.matches.map((m) => m.bankTransactionId)));
  const deselectAll = () => setSelectedMatches(new Set());
  const selectHighConf = () => result && setSelectedMatches(new Set(result.matches.filter((m) => m.confidence >= 75).map((m) => m.bankTransactionId)));

  if (isLoadingCompany) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">Please create a company first to use auto-reconciliation.</p>
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
        <Button onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending} size="lg">
          {scanMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <ArrowRightLeft className="h-4 w-4 mr-2" />
          )}
          {scanMutation.isPending ? 'Scanning...' : 'Run Auto-Reconcile'}
        </Button>
      </div>

      {/* Summary cards */}
      {result && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <Unlink className="h-3 w-3" /> Unreconciled
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold">{result.totalUnreconciled}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <Link2 className="h-3 w-3" /> Total Matches
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold">{result.matches.length}</div>
            </CardContent>
          </Card>
          <Card className="border-green-200">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" /> High Confidence
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold text-green-600">{result.autoMatchedCount}</div>
              <p className="text-xs text-muted-foreground mt-1">≥75% — auto-selected</p>
            </CardContent>
          </Card>
          <Card className="border-orange-200">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardDescription className="text-xs flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-orange-500" /> Needs Review
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-3xl font-bold text-orange-600">{result.manualReviewCount}</div>
              <p className="text-xs text-muted-foreground mt-1">&lt;75% confidence</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Matches table */}
      {result && result.matches.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Link2 className="h-5 w-5 text-primary" /> Suggested Matches
                </CardTitle>
                <CardDescription>
                  Review and apply auto-detected reconciliation matches.
                  {selectedMatches.size > 0 && ` ${selectedMatches.size} selected.`}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={selectHighConf}>
                  High Confidence
                </Button>
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAll}>
                  Clear
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
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Bank Transaction</TableHead>
                    <TableHead className="w-8 text-center">
                      <ChevronRight className="h-4 w-4 mx-auto text-muted-foreground" />
                    </TableHead>
                    <TableHead>Matched With</TableHead>
                    <TableHead className="w-48">Confidence</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.matches.map((match) => {
                    const typeConfig = matchTypeConfig[match.matchedType];
                    const TypeIcon = typeConfig.icon;
                    const confStyle = getConfidenceStyle(match.confidence);
                    const isSelected = selectedMatches.has(match.bankTransactionId);

                    return (
                      <TableRow
                        key={match.bankTransactionId}
                        className={isSelected ? 'bg-primary/5' : ''}
                        onClick={() => toggleMatch(match.bankTransactionId)}
                        style={{ cursor: 'pointer' }}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleMatch(match.bankTransactionId)}
                          />
                        </TableCell>

                        {/* Bank transaction details */}
                        <TableCell>
                          <div className="space-y-0.5">
                            <div className="font-medium text-sm truncate max-w-[200px]">
                              {match.bankDescription || match.bankTransactionId.slice(0, 8) + '...'}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{formatDate(match.bankDate)}</span>
                              {match.bankAmount != null && (
                                <span className={`font-mono font-medium ${match.bankAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {formatCurrency(match.bankAmount)}
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>

                        {/* Arrow */}
                        <TableCell className="text-center">
                          <ChevronRight className="h-4 w-4 text-muted-foreground mx-auto" />
                        </TableCell>

                        {/* Matched record details */}
                        <TableCell>
                          <div className="flex items-start gap-2">
                            <div className={`p-1 rounded shrink-0 mt-0.5 ${typeConfig.bg}`}>
                              <TypeIcon className={`h-3 w-3 ${typeConfig.color}`} />
                            </div>
                            <div className="space-y-0.5 min-w-0">
                              <div className="text-xs font-medium text-muted-foreground">{typeConfig.label}</div>
                              <div className="font-medium text-sm truncate max-w-[200px]">
                                {match.matchedDescription || match.matchedId.slice(0, 8) + '...'}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{formatDate(match.matchedDate)}</span>
                                {match.matchedAmount != null && (
                                  <span className="font-mono font-medium">
                                    {formatCurrency(match.matchedAmount)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        {/* Confidence */}
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-bold ${confStyle.textColor}`}>
                                {match.confidence}%
                              </span>
                              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${confStyle.badge}`}>
                                {confStyle.label}
                              </span>
                            </div>
                            <Progress value={match.confidence} className={`h-1.5 ${confStyle.barClass}`} />
                          </div>
                        </TableCell>

                        {/* Reason */}
                        <TableCell>
                          <span className="text-xs text-muted-foreground">{match.matchReason}</span>
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

      {/* Empty states */}
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
                    All bank transactions are already reconciled.
                  </p>
                </>
              ) : (
                <>
                  <XCircle className="h-12 w-12 text-orange-500 mx-auto" />
                  <h3 className="text-lg font-semibold">No Matches Found</h3>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    {result.totalUnreconciled} unreconciled transaction(s) found, but no automatic matches
                    could be determined. Try reconciling manually in Bank Reconciliation.
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
