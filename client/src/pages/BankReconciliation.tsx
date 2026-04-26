import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { TableSkeleton } from '@/components/ui/loading-skeletons';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatCurrency } from '@/lib/format';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import Tesseract from 'tesseract.js';
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  Link2,
  Unlink,
  Search,
  RefreshCw,
  Building2,
  ArrowRightLeft,
  Sparkles,
  FileSpreadsheet,
  BookOpen,
  Receipt,
  Check,
  AlertTriangle,
  BarChart3,
  ChevronRight,
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// ─── Types ─────────────────────────────────────────────────────────────────

interface BankTransaction {
  id: string;
  companyId: string;
  bankAccountId: string | null;
  bankStatementAccountId: string | null;
  transactionDate: string;
  description: string;
  amount: number;
  balance: number | null;
  reference: string | null;
  category: string | null;
  matchStatus: string;
  isReconciled: boolean;
  matchedJournalEntryId: string | null;
  matchedReceiptId: string | null;
  matchedInvoiceId: string | null;
  matchConfidence: number | null;
  importSource: string | null;
  createdAt: string;
}

interface BankAccount {
  id: string;
  nameEn: string;
  bankName: string;
  accountNumber: string | null;
  iban: string | null;
  currency: string;
  glAccountId: string | null;
  isActive: boolean;
}

interface MatchSuggestion {
  bankTransactionId: string;
  matchedType: 'journal_entry' | 'invoice' | 'receipt';
  matchedId: string;
  confidence: number;
  matchReason: string;
  bankDescription?: string;
  bankAmount?: number;
  bankDate?: string;
  matchedDescription?: string;
  matchedAmount?: number;
  matchedDate?: string;
}

interface ReportData {
  summary: {
    totalTransactions: number;
    reconciledCount: number;
    unreconciledCount: number;
    suggestedCount: number;
    reconciledPct: number;
  };
  amounts: {
    totalCredits: number;
    totalDebits: number;
    netAmount: number;
    reconciledCredits: number;
    reconciledDebits: number;
    unreconciledCredits: number;
    unreconciledDebits: number;
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const matchTypeConfig = {
  journal_entry: { icon: BookOpen, label: 'Journal Entry', color: 'text-[hsl(var(--chart-3))]', bg: 'bg-[hsl(var(--chart-3)/0.10)]' },
  invoice: { icon: FileText, label: 'Invoice', color: 'text-[hsl(var(--chart-1))]', bg: 'bg-[hsl(var(--chart-1)/0.10)]' },
  receipt: { icon: Receipt, label: 'Receipt', color: 'text-[hsl(var(--chart-5))]', bg: 'bg-[hsl(var(--chart-5)/0.10)]' },
};

function confidenceLabel(score: number): { label: string; color: string; bg: string } {
  if (score >= 80) return { label: 'High', color: 'text-[hsl(var(--chart-5))]', bg: 'bg-[hsl(var(--chart-5)/0.15)]' };
  if (score >= 60) return { label: 'Medium', color: 'text-[hsl(var(--chart-4))]', bg: 'bg-[hsl(var(--chart-4)/0.15)]' };
  return { label: 'Low', color: 'text-destructive', bg: 'bg-destructive/15' };
}

function formatDate(dateStr: string) {
  try {
    return format(parseISO(dateStr), 'dd MMM yyyy');
  } catch {
    return dateStr;
  }
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function BankReconciliation() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();

  const [selectedBankAccount, setSelectedBankAccount] = useState<string>('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<BankTransaction | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showReconciled, setShowReconciled] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');

  // ─── Queries ──────────────────────────────────────────────────────────────

  const { data: bankAccounts, isLoading: isLoadingBankAccounts } = useQuery<BankAccount[]>({
    queryKey: ['/api/companies', companyId, 'bank-accounts'],
    enabled: !!companyId,
  });

  const { data: transactions, isLoading: isLoadingTransactions } = useQuery<BankTransaction[]>({
    queryKey: ['/api/companies', companyId, 'bank-statements', 'transactions'],
    enabled: !!companyId,
  });

  const { data: matchSuggestions, isLoading: isLoadingMatches } = useQuery<MatchSuggestion[]>({
    queryKey: ['/api/companies', companyId, 'bank-statements', selectedTransaction?.id, 'suggestions'],
    enabled: !!selectedTransaction?.id && matchDialogOpen,
  });

  const { data: reportData, isLoading: isLoadingReport } = useQuery<ReportData>({
    queryKey: ['/api/companies', companyId, 'bank-statements', 'report', selectedBankAccount || 'all'],
    enabled: !!companyId && reportDialogOpen,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBankAccount) params.set('bankAccountId', selectedBankAccount);
      return apiRequest('GET', `/api/companies/${companyId}/bank-statements/report?${params}`);
    },
  });

  // ─── Derived state ────────────────────────────────────────────────────────

  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter((tx) => {
      if (!showReconciled && tx.isReconciled) return false;
      if (selectedBankAccount && tx.bankStatementAccountId !== selectedBankAccount) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          tx.description.toLowerCase().includes(q) ||
          tx.reference?.toLowerCase().includes(q) ||
          String(Math.abs(tx.amount)).includes(q)
        );
      }
      return true;
    });
  }, [transactions, showReconciled, selectedBankAccount, searchQuery]);

  const stats = useMemo(() => {
    if (!transactions) return { total: 0, reconciled: 0, unreconciled: 0, suggested: 0, totalAmount: 0 };
    const reconciled = transactions.filter((t) => t.isReconciled).length;
    const suggested = transactions.filter((t) => !t.isReconciled && t.matchStatus === 'suggested').length;
    const totalAmount = transactions.reduce((s, t) => s + t.amount, 0);
    return { total: transactions.length, reconciled, unreconciled: transactions.length - reconciled, suggested, totalAmount };
  }, [transactions]);

  // ─── Mutations ────────────────────────────────────────────────────────────

  const importMutation = useMutation({
    mutationFn: async (payload: { bankAccountId: string; csvContent: string }) =>
      apiRequest('POST', `/api/companies/${companyId}/bank-statements/import`, payload),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'bank-statements'] });
      toast({ title: 'Import Successful', description: `Imported ${data.imported ?? 0} transactions` });
      setImportDialogOpen(false);
      setImportFile(null);
      setPdfProgress(0);
      setProcessingStatus('');
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Import Failed', description: error?.message });
    },
  });

  const matchMutation = useMutation({
    mutationFn: ({ transactionId, matchedId, matchedType }: { transactionId: string; matchedId: string; matchedType: string }) =>
      apiRequest('POST', `/api/companies/${companyId}/bank-statements/${transactionId}/match`, {
        matchedType: matchedType === 'journal_entry' ? 'journal' : matchedType,
        matchedId,
      }),
    onMutate: async ({ transactionId, matchedId, matchedType }) => {
      const queryKey = ['/api/companies', companyId, 'bank-statements'] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<any[]>(queryKey);
      queryClient.setQueryData<any[]>(queryKey, (old) =>
        old?.map((tx: any) =>
          tx.id === transactionId
            ? { ...tx, matchedId, matchedType: matchedType === 'journal_entry' ? 'journal' : matchedType, status: 'matched' }
            : tx,
        ) ?? [],
      );
      return { previous, queryKey };
    },
    onSuccess: () => {
      toast({ title: 'Transaction Reconciled', description: 'Bank transaction matched successfully.' });
      setMatchDialogOpen(false);
      setSelectedTransaction(null);
    },
    onError: (error: any, _vars, context: any) => {
      if (context?.previous && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      toast({ variant: 'destructive', title: 'Reconciliation Failed', description: error?.message });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'bank-statements'] });
    },
  });

  const unmatchMutation = useMutation({
    mutationFn: (transactionId: string) =>
      apiRequest('DELETE', `/api/companies/${companyId}/bank-statements/${transactionId}/match`),
    onMutate: async (transactionId: string) => {
      const queryKey = ['/api/companies', companyId, 'bank-statements'] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<any[]>(queryKey);
      queryClient.setQueryData<any[]>(queryKey, (old) =>
        old?.map((tx: any) =>
          tx.id === transactionId ? { ...tx, matchedId: null, matchedType: null, status: 'unmatched' } : tx,
        ) ?? [],
      );
      return { previous, queryKey };
    },
    onSuccess: () => {
      toast({ title: 'Match Removed', description: 'Transaction reset to unmatched.' });
    },
    onError: (error: any, _id, context: any) => {
      if (context?.previous && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      toast({ variant: 'destructive', title: 'Error', description: error?.message });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'bank-statements'] });
    },
  });

  const autoReconcileMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/companies/${companyId}/auto-reconcile`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'bank-statements'] });
      toast({
        title: 'Auto-Reconciliation Complete',
        description: `Found ${data.matches?.length ?? 0} potential matches`,
      });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Auto-Reconciliation Failed', description: error?.message });
    },
  });

  // ─── File import handlers ─────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setImportFile(file); setPdfProgress(0); setProcessingStatus(''); }
  };

  const convertPdfPageToImage = async (page: any): Promise<Blob> => {
    const scale = 2;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: context, viewport, canvas } as any).promise;
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'));
  };

  const extractTransactionsFromText = async (text: string): Promise<any[]> => {
    try {
      const response = await apiRequest('POST', '/api/ai/parse-bank-statement', { text });
      return response.transactions || [];
    } catch {
      return [];
    }
  };

  const handleImport = async () => {
    if (!importFile || !selectedBankAccount) {
      toast({ variant: 'destructive', title: 'Missing Information', description: 'Select a bank account and upload a file' });
      return;
    }

    setIsImporting(true);

    try {
      if (importFile.type === 'application/pdf') {
        // PDF → text → AI parse → import as JSON
        setProcessingStatus('Converting PDF pages...');
        const arrayBuffer = await importFile.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = Math.min(pdf.numPages, 10);
        let allText = '';

        for (let p = 1; p <= totalPages; p++) {
          setProcessingStatus(`Processing page ${p} of ${totalPages}...`);
          setPdfProgress((p / totalPages) * 50);
          const page = await pdf.getPage(p);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((i: any) => i.str).join(' ');
          if (pageText.trim().length > 50) {
            allText += pageText + '\n';
          } else {
            setProcessingStatus(`Running OCR on page ${p}...`);
            const imageBlob = await convertPdfPageToImage(page);
            const result = await Tesseract.recognize(imageBlob, 'eng');
            allText += result.data.text + '\n';
          }
        }

        setProcessingStatus('Extracting transactions...');
        setPdfProgress(75);
        const txns = await extractTransactionsFromText(allText);
        setPdfProgress(100);

        if (txns.length === 0) {
          toast({ variant: 'destructive', title: 'No transactions found', description: 'Try a different format.' });
          return;
        }

        // For PDFs, fall back to old JSON import endpoint
        await apiRequest('POST', `/api/companies/${companyId}/bank-transactions/import`, {
          transactions: txns,
          bankAccountId: selectedBankAccount,
        });
        queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'bank-statements'] });
        toast({ title: 'Import Successful', description: `Imported ${txns.length} transactions` });
        setImportDialogOpen(false);
        setImportFile(null);
      } else {
        // CSV — send raw content to the proper endpoint
        const csvContent = await importFile.text();
        await importMutation.mutateAsync({ bankAccountId: selectedBankAccount, csvContent });
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Import Failed', description: error?.message });
    } finally {
      setIsImporting(false);
      setProcessingStatus('');
      setPdfProgress(0);
    }
  };

  // ─── Render helpers ───────────────────────────────────────────────────────

  const handleOpenMatch = (transaction: BankTransaction) => {
    setSelectedTransaction(transaction);
    setMatchDialogOpen(true);
  };

  const handleAcceptSuggestion = (tx: BankTransaction) => {
    if (!tx.matchedJournalEntryId && !tx.matchedInvoiceId && !tx.matchedReceiptId) return;
    const matchedId = tx.matchedJournalEntryId ?? tx.matchedInvoiceId ?? tx.matchedReceiptId!;
    const matchedType = tx.matchedJournalEntryId ? 'journal' : tx.matchedInvoiceId ? 'invoice' : 'receipt';
    matchMutation.mutate({ transactionId: tx.id, matchedId, matchedType });
  };

  if (isLoadingCompany || isLoadingBankAccounts) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            {t.bankReconciliation}
          </h1>
          <p className="text-muted-foreground text-sm">{t.bankReconciliationDescription}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setReportDialogOpen(true)}>
            <BarChart3 className="w-4 h-4 mr-2" />
            Report
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => autoReconcileMutation.mutate()}
            disabled={autoReconcileMutation.isPending}
            data-testid="button-auto-reconcile"
          >
            {autoReconcileMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            {t.autoMatch}
          </Button>
          <Button onClick={() => setImportDialogOpen(true)} size="sm" data-testid="button-import-transactions">
            <Upload className="w-4 h-4 mr-2" />
            {t.importCsv}
          </Button>
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card className="border-[hsl(var(--chart-5)/0.30)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-[hsl(var(--chart-5))]" />
              Reconciled
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[hsl(var(--chart-5))]">{stats.reconciled}</div>
            {stats.total > 0 && (
              <Progress value={(stats.reconciled / stats.total) * 100} className="h-1 mt-2" />
            )}
          </CardContent>
        </Card>
        <Card className="border-[hsl(var(--chart-4)/0.30)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-[hsl(var(--chart-4))]" />
              Suggested
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[hsl(var(--chart-4))]">{stats.suggested}</div>
            <p className="text-xs text-muted-foreground mt-1">Pending review</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Net Amount
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.totalAmount >= 0 ? 'text-[hsl(var(--chart-5))]' : 'text-destructive'}`}>
              {formatCurrency(stats.totalAmount)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Transactions table ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle>{t.bankTransactions}</CardTitle>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-reconciled"
                  checked={showReconciled}
                  onCheckedChange={(c) => setShowReconciled(c as boolean)}
                />
                <Label htmlFor="show-reconciled" className="text-sm cursor-pointer">
                  Show reconciled
                </Label>
              </div>
              <Select
                value={selectedBankAccount || 'all'}
                onValueChange={(v) => setSelectedBankAccount(v === 'all' ? '' : v)}
              >
                <SelectTrigger className="w-44" data-testid="select-bank-account">
                  <SelectValue placeholder="All accounts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {bankAccounts?.map((acct) => (
                    <SelectItem key={acct.id} value={acct.id}>
                      {acct.nameEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-56"
                  data-testid="input-search"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingTransactions ? (
            <TableSkeleton rows={6} columns={6} />
          ) : filteredTransactions.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No bank transactions"
              description={t.noTransactionsFound || 'Import a bank statement (CSV or PDF) to start matching transactions to journal entries.'}
              action={{ label: 'Import bank statement', icon: Upload, variant: 'outline', onClick: () => setImportDialogOpen(true) }}
              testId="empty-state-bank-transactions"
            />
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-28">Reference</TableHead>
                    <TableHead className="text-right w-32">Amount</TableHead>
                    <TableHead className="w-40">Status</TableHead>
                    <TableHead className="text-right w-36">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.map((tx) => {
                    const conf = tx.matchConfidence != null ? Math.round(tx.matchConfidence * 100) : null;
                    const confMeta = conf != null ? confidenceLabel(conf) : null;
                    return (
                      <TableRow
                        key={tx.id}
                        data-testid={`row-transaction-${tx.id}`}
                        className={tx.matchStatus === 'suggested' ? 'bg-[hsl(var(--chart-4)/0.06)]' : ''}
                      >
                        <TableCell className="font-mono text-sm">
                          {formatDate(tx.transactionDate)}
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <div className="truncate font-medium">{tx.description}</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {tx.reference || '—'}
                        </TableCell>
                        <TableCell className={`text-right font-mono font-medium ${tx.amount >= 0 ? 'text-[hsl(var(--chart-5))]' : 'text-destructive'}`}>
                          {formatCurrency(tx.amount)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {tx.isReconciled ? (
                              <StatusBadge tone="success" className="w-fit">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Reconciled
                              </StatusBadge>
                            ) : tx.matchStatus === 'suggested' ? (
                              <StatusBadge tone="warning" className="w-fit">
                                <Sparkles className="w-3 h-3 mr-1" />
                                Suggested
                              </StatusBadge>
                            ) : (
                              <StatusBadge tone="neutral" className="w-fit">
                                <XCircle className="w-3 h-3 mr-1" />
                                Unmatched
                              </StatusBadge>
                            )}
                            {confMeta && !tx.isReconciled && (
                              <span className={`text-xs font-medium ${confMeta.color}`}>
                                {conf}% {confMeta.label}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {tx.isReconciled ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-muted-foreground h-7 px-2"
                                onClick={() => unmatchMutation.mutate(tx.id)}
                                disabled={unmatchMutation.isPending}
                                title="Unmatch"
                              >
                                <Unlink className="w-3.5 h-3.5" />
                              </Button>
                            ) : tx.matchStatus === 'suggested' ? (
                              <>
                                <Button
                                  size="sm"
                                  className="h-7 px-2 bg-[hsl(var(--chart-5))] hover:bg-[hsl(var(--chart-5)/0.85)] text-primary-foreground"
                                  onClick={() => handleAcceptSuggestion(tx)}
                                  disabled={matchMutation.isPending}
                                  title="Accept suggested match"
                                >
                                  <Check className="w-3.5 h-3.5 mr-1" />
                                  Accept
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2"
                                  onClick={() => handleOpenMatch(tx)}
                                  title="Review or change match"
                                >
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7"
                                onClick={() => handleOpenMatch(tx)}
                                data-testid={`button-match-${tx.id}`}
                              >
                                <Link2 className="w-3.5 h-3.5 mr-1" />
                                Match
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Match Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={matchDialogOpen} onOpenChange={(open) => { setMatchDialogOpen(open); if (!open) setSelectedTransaction(null); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Match Transaction</DialogTitle>
            <DialogDescription>
              {selectedTransaction && (
                <span>
                  {selectedTransaction.description} &mdash; {formatCurrency(selectedTransaction.amount)} on {formatDate(selectedTransaction.transactionDate)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Side-by-side layout */}
          <div className="grid grid-cols-2 gap-4 mt-2">
            {/* Left: Bank transaction */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bank Transaction</p>
              {selectedTransaction && (
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="font-medium">{formatDate(selectedTransaction.transactionDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Description</p>
                    <p className="font-medium text-sm">{selectedTransaction.description}</p>
                  </div>
                  {selectedTransaction.reference && (
                    <div>
                      <p className="text-xs text-muted-foreground">Reference</p>
                      <p className="font-mono text-sm">{selectedTransaction.reference}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Amount</p>
                    <p className={`text-xl font-bold ${selectedTransaction.amount >= 0 ? 'text-[hsl(var(--chart-5))]' : 'text-destructive'}`}>
                      {formatCurrency(selectedTransaction.amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Direction</p>
                    <Badge variant="outline" className="text-xs">
                      {selectedTransaction.amount >= 0 ? '↑ Credit / Inflow' : '↓ Debit / Outflow'}
                    </Badge>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Match suggestions */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested Matches</p>
              {isLoadingMatches ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
                </div>
              ) : matchSuggestions && matchSuggestions.length > 0 ? (
                <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                  {matchSuggestions.map((s) => {
                    const typeCfg = matchTypeConfig[s.matchedType];
                    const TypeIcon = typeCfg.icon;
                    const confMeta = confidenceLabel(s.confidence);
                    return (
                      <div
                        key={`${s.matchedType}-${s.matchedId}`}
                        className="rounded-lg border bg-card p-3 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                        onClick={() => matchMutation.mutate({
                          transactionId: selectedTransaction!.id,
                          matchedId: s.matchedId,
                          matchedType: s.matchedType,
                        })}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`p-1.5 rounded shrink-0 ${typeCfg.bg}`}>
                              <TypeIcon className={`w-3.5 h-3.5 ${typeCfg.color}`} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-muted-foreground">{typeCfg.label}</p>
                              <p className="text-sm font-medium truncate">{s.matchedDescription || s.matchedId.slice(0, 8)}</p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono font-semibold text-sm">
                              {s.matchedAmount != null ? formatCurrency(s.matchedAmount) : '—'}
                            </p>
                            <span className={`text-xs font-medium ${confMeta.color}`}>
                              {s.confidence}% {confMeta.label}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2">
                          <Progress value={s.confidence} className="h-1" />
                        </div>
                        {s.matchedDate && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDate(s.matchedDate)}
                          </p>
                        )}
                        {s.matchReason && (
                          <p className="text-xs text-muted-foreground mt-1 italic">{s.matchReason}</p>
                        )}
                        <div className="mt-2 flex justify-end">
                          <Badge variant="outline" className="text-xs">
                            Click to match
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <ArrowRightLeft className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">No matches found</p>
                  <p className="text-xs mt-1">Try reconciling manually via journal entries</p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMatchDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Import Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.importBankStatement}</DialogTitle>
            <DialogDescription>{t.uploadBankStatement}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Bank Account</Label>
              <Select value={selectedBankAccount} onValueChange={setSelectedBankAccount}>
                <SelectTrigger data-testid="select-import-bank-account">
                  <SelectValue placeholder="Select account..." />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts?.map((acct) => (
                    <SelectItem key={acct.id} value={acct.id}>
                      {acct.nameEn} — {acct.bankName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(!bankAccounts || bankAccounts.length === 0) && (
                <p className="text-xs text-[hsl(var(--chart-4))]">
                  No bank accounts configured. Create one under Settings → Bank Accounts.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Statement File</Label>
              <Input
                type="file"
                accept=".csv,.pdf,application/pdf"
                onChange={handleFileChange}
                disabled={isImporting}
                data-testid="input-bank-statement-file"
              />
              {importFile && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {importFile.type === 'application/pdf' ? (
                    <FileText className="w-4 h-4 text-destructive" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4 text-[hsl(var(--chart-5))]" />
                  )}
                  <span>{importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)</span>
                </div>
              )}
              {isImporting && pdfProgress > 0 && (
                <div className="space-y-1">
                  <Progress value={pdfProgress} className="h-2" />
                  <p className="text-xs text-muted-foreground">{processingStatus}</p>
                </div>
              )}
            </div>
            <div className="bg-muted/50 p-3 rounded-md text-sm space-y-1.5">
              <p className="font-medium text-xs uppercase tracking-wide">Supported formats</p>
              <div className="flex items-center gap-2 text-xs">
                <FileSpreadsheet className="w-3.5 h-3.5 text-[hsl(var(--chart-5))]" />
                <span>CSV — Emirates NBD, ADCB, FAB, Mashreq, generic</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <FileText className="w-3.5 h-3.5 text-destructive" />
                <span>PDF — text extraction with OCR fallback</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)} disabled={isImporting}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={isImporting || !importFile || !selectedBankAccount}
              data-testid="button-confirm-import"
            >
              {isImporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Report Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Reconciliation Report
            </DialogTitle>
            <DialogDescription>
              Summary of matched and unmatched transactions
              {selectedBankAccount && bankAccounts?.find((a) => a.id === selectedBankAccount)
                ? ` for ${bankAccounts.find((a) => a.id === selectedBankAccount)!.nameEn}`
                : ' across all accounts'}
            </DialogDescription>
          </DialogHeader>
          {isLoadingReport ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : reportData ? (
            <div className="space-y-4">
              {/* Status breakdown */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Status</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border p-3 text-center">
                    <div className="text-2xl font-bold">{reportData.summary.totalTransactions}</div>
                    <div className="text-xs text-muted-foreground mt-1">Total</div>
                  </div>
                  <div className="rounded-lg border border-[hsl(var(--chart-5)/0.30)] bg-[hsl(var(--chart-5)/0.10)] p-3 text-center">
                    <div className="text-2xl font-bold text-[hsl(var(--chart-5))]">{reportData.summary.reconciledCount}</div>
                    <div className="text-xs text-muted-foreground mt-1">Reconciled</div>
                  </div>
                  <div className="rounded-lg border border-[hsl(var(--chart-4)/0.30)] bg-[hsl(var(--chart-4)/0.10)] p-3 text-center">
                    <div className="text-2xl font-bold text-[hsl(var(--chart-4))]">{reportData.summary.unreconciledCount}</div>
                    <div className="text-xs text-muted-foreground mt-1">Unreconciled</div>
                  </div>
                </div>
                {reportData.summary.totalTransactions > 0 && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Completion</span>
                      <span className="font-medium">{reportData.summary.reconciledPct}%</span>
                    </div>
                    <Progress value={reportData.summary.reconciledPct} className="h-2" />
                  </div>
                )}
              </div>

              <Separator />

              {/* Amount breakdown */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Amounts</p>
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Total Credits</span>
                    <span className="font-mono font-medium text-[hsl(var(--chart-5))]">{formatCurrency(reportData.amounts.totalCredits)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Total Debits</span>
                    <span className="font-mono font-medium text-destructive">{formatCurrency(reportData.amounts.totalDebits)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Reconciled Credits</span>
                    <span className="font-mono text-[hsl(var(--chart-5))]">{formatCurrency(reportData.amounts.reconciledCredits)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Reconciled Debits</span>
                    <span className="font-mono text-destructive">{formatCurrency(reportData.amounts.reconciledDebits)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center text-sm font-semibold">
                    <span>Unreconciled Credits</span>
                    <span className="font-mono text-[hsl(var(--chart-4))]">{formatCurrency(reportData.amounts.unreconciledCredits)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm font-semibold">
                    <span>Unreconciled Debits</span>
                    <span className="font-mono text-[hsl(var(--chart-4))]">{formatCurrency(reportData.amounts.unreconciledDebits)}</span>
                  </div>
                </div>
              </div>

              {reportData.summary.suggestedCount > 0 && (
                <>
                  <Separator />
                  <div className="flex items-center gap-2 rounded-lg bg-[hsl(var(--chart-4)/0.10)] border border-[hsl(var(--chart-4)/0.30)] p-3">
                    <Sparkles className="w-4 h-4 text-[hsl(var(--chart-4))] shrink-0" />
                    <p className="text-sm text-foreground">
                      <strong>{reportData.summary.suggestedCount}</strong> transaction(s) have suggested matches
                      waiting for your review.
                    </p>
                  </div>
                </>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
