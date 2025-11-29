import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatCurrency } from '@/lib/format';
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Link2, 
  Unlink, 
  Search,
  Download,
  RefreshCw,
  Building2,
  ArrowRightLeft,
  Sparkles
} from 'lucide-react';

interface BankTransaction {
  id: string;
  companyId: string;
  bankAccountId: string | null;
  transactionDate: string;
  description: string;
  amount: number;
  reference: string | null;
  category: string | null;
  isReconciled: boolean;
  matchedJournalEntryId: string | null;
  matchedReceiptId: string | null;
  matchedInvoiceId: string | null;
  matchConfidence: number | null;
  importSource: string | null;
  createdAt: string;
}

interface Account {
  id: string;
  nameEn: string;
  nameAr: string | null;
  type: string;
}

interface MatchSuggestion {
  type: 'journal' | 'receipt' | 'invoice';
  id: string;
  description: string;
  amount: number;
  date: string;
  confidence: number;
}

export default function BankReconciliation() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [selectedBankAccount, setSelectedBankAccount] = useState<string>('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<BankTransaction | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showReconciled, setShowReconciled] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const { data: accounts, isLoading: isLoadingAccounts } = useQuery<Account[]>({
    queryKey: ['/api/companies', companyId, 'accounts'],
    enabled: !!companyId,
  });

  const bankAccounts = useMemo(() => {
    return accounts?.filter(a => a.type === 'asset' && 
      (a.nameEn.toLowerCase().includes('bank') || a.nameEn.toLowerCase().includes('cash'))) || [];
  }, [accounts]);

  const { data: transactions, isLoading: isLoadingTransactions, refetch } = useQuery<BankTransaction[]>({
    queryKey: ['/api/companies', companyId, 'bank-transactions'],
    enabled: !!companyId,
  });

  const { data: matchSuggestions, isLoading: isLoadingMatches } = useQuery<MatchSuggestion[]>({
    queryKey: ['/api/bank-transactions', selectedTransaction?.id, 'match-suggestions'],
    enabled: !!selectedTransaction?.id,
  });

  const filteredTransactions = useMemo(() => {
    if (!transactions) return [];
    
    return transactions.filter(t => {
      if (!showReconciled && t.isReconciled) return false;
      if (selectedBankAccount && t.bankAccountId !== selectedBankAccount) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return t.description.toLowerCase().includes(query) ||
          t.reference?.toLowerCase().includes(query) ||
          t.amount.toString().includes(query);
      }
      return true;
    });
  }, [transactions, showReconciled, selectedBankAccount, searchQuery]);

  const stats = useMemo(() => {
    if (!transactions) return { total: 0, reconciled: 0, unreconciled: 0, totalAmount: 0 };
    
    const reconciled = transactions.filter(t => t.isReconciled).length;
    const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);
    
    return {
      total: transactions.length,
      reconciled,
      unreconciled: transactions.length - reconciled,
      totalAmount
    };
  }, [transactions]);

  const importMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      return apiRequest('POST', `/api/companies/${companyId}/bank-transactions/import`, formData);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'bank-transactions'] });
      toast({
        title: 'Import Successful',
        description: `Imported ${data.count} transactions`,
      });
      setImportDialogOpen(false);
      setCsvFile(null);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Import Failed',
        description: error.message || 'Failed to import transactions',
      });
    },
  });

  const reconcileMutation = useMutation({
    mutationFn: ({ transactionId, matchId, matchType }: { transactionId: string; matchId: string; matchType: 'journal' | 'receipt' | 'invoice' }) => 
      apiRequest('POST', `/api/bank-transactions/${transactionId}/reconcile`, { matchId, matchType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'bank-transactions'] });
      toast({
        title: 'Transaction Reconciled',
        description: 'The bank transaction has been matched successfully.',
      });
      setMatchDialogOpen(false);
      setSelectedTransaction(null);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Reconciliation Failed',
        description: error.message || 'Failed to reconcile transaction',
      });
    },
  });

  const autoReconcileMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/companies/${companyId}/bank-transactions/auto-reconcile`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'bank-transactions'] });
      toast({
        title: 'Auto-Reconciliation Complete',
        description: `Matched ${data.matchedCount} transactions automatically`,
      });
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Auto-Reconciliation Failed',
        description: error.message || 'Failed to auto-reconcile',
      });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCsvFile(file);
    }
  };

  const handleImport = async () => {
    if (!csvFile || !selectedBankAccount) {
      toast({
        variant: 'destructive',
        title: 'Missing Information',
        description: 'Please select a bank account and upload a CSV file',
      });
      return;
    }

    setIsImporting(true);
    const formData = new FormData();
    formData.append('file', csvFile);
    formData.append('bankAccountId', selectedBankAccount);
    
    try {
      await importMutation.mutateAsync(formData);
    } finally {
      setIsImporting(false);
    }
  };

  const handleMatchTransaction = (transaction: BankTransaction) => {
    setSelectedTransaction(transaction);
    setMatchDialogOpen(true);
  };

  const handleReconcile = (matchId: string, matchType: 'journal' | 'receipt' | 'invoice') => {
    if (!selectedTransaction) return;
    reconcileMutation.mutate({
      transactionId: selectedTransaction.id,
      matchId,
      matchType,
    });
  };

  if (isLoadingCompany || isLoadingAccounts) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            {locale === 'ar' ? 'تسوية البنك' : 'Bank Reconciliation'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'ar' ? 'استيراد ومطابقة معاملات البنك' : 'Import and match bank transactions with your records'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => autoReconcileMutation.mutate()}
            disabled={autoReconcileMutation.isPending}
            data-testid="button-auto-reconcile"
          >
            {autoReconcileMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            {locale === 'ar' ? 'مطابقة تلقائية' : 'Auto-Match'}
          </Button>
          <Button onClick={() => setImportDialogOpen(true)} data-testid="button-import-transactions">
            <Upload className="w-4 h-4 mr-2" />
            {locale === 'ar' ? 'استيراد' : 'Import CSV'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {locale === 'ar' ? 'إجمالي المعاملات' : 'Total Transactions'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {locale === 'ar' ? 'تمت التسوية' : 'Reconciled'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.reconciled}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {locale === 'ar' ? 'غير مسوى' : 'Unreconciled'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats.unreconciled}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {locale === 'ar' ? 'صافي المبلغ' : 'Net Amount'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.totalAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(stats.totalAmount)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle>{locale === 'ar' ? 'معاملات البنك' : 'Bank Transactions'}</CardTitle>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-reconciled"
                  checked={showReconciled}
                  onCheckedChange={(checked) => setShowReconciled(checked as boolean)}
                />
                <Label htmlFor="show-reconciled" className="text-sm">
                  {locale === 'ar' ? 'إظهار المسوى' : 'Show Reconciled'}
                </Label>
              </div>
              <Select value={selectedBankAccount} onValueChange={setSelectedBankAccount}>
                <SelectTrigger className="w-48" data-testid="select-bank-account">
                  <SelectValue placeholder={locale === 'ar' ? 'كل الحسابات' : 'All Accounts'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{locale === 'ar' ? 'كل الحسابات' : 'All Accounts'}</SelectItem>
                  {bankAccounts.map(account => (
                    <SelectItem key={account.id} value={account.id}>
                      {locale === 'ar' ? account.nameAr || account.nameEn : account.nameEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={locale === 'ar' ? 'بحث...' : 'Search...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-64"
                  data-testid="input-search"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingTransactions ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center py-12">
              <Building2 className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {locale === 'ar' ? 'لا توجد معاملات. استورد كشف حسابك البنكي للبدء.' : 'No transactions found. Import your bank statement to get started.'}
              </p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{locale === 'ar' ? 'التاريخ' : 'Date'}</TableHead>
                    <TableHead>{locale === 'ar' ? 'الوصف' : 'Description'}</TableHead>
                    <TableHead>{locale === 'ar' ? 'المرجع' : 'Reference'}</TableHead>
                    <TableHead className="text-right">{locale === 'ar' ? 'المبلغ' : 'Amount'}</TableHead>
                    <TableHead>{locale === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                    <TableHead className="text-right">{locale === 'ar' ? 'الإجراءات' : 'Actions'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.map(transaction => (
                    <TableRow key={transaction.id} data-testid={`row-transaction-${transaction.id}`}>
                      <TableCell className="font-mono text-sm">
                        {format(parseISO(transaction.transactionDate), 'dd MMM yyyy')}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{transaction.description}</TableCell>
                      <TableCell className="text-muted-foreground">{transaction.reference || '-'}</TableCell>
                      <TableCell className={`text-right font-mono ${transaction.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(transaction.amount)}
                      </TableCell>
                      <TableCell>
                        {transaction.isReconciled ? (
                          <Badge variant="default" className="bg-green-100 text-green-800">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            {locale === 'ar' ? 'مسوى' : 'Reconciled'}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <XCircle className="w-3 h-3 mr-1" />
                            {locale === 'ar' ? 'غير مسوى' : 'Unmatched'}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!transaction.isReconciled && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleMatchTransaction(transaction)}
                            data-testid={`button-match-${transaction.id}`}
                          >
                            <Link2 className="w-4 h-4 mr-1" />
                            {locale === 'ar' ? 'مطابقة' : 'Match'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'استيراد كشف حساب البنك' : 'Import Bank Statement'}</DialogTitle>
            <DialogDescription>
              {locale === 'ar' 
                ? 'قم بتحميل ملف CSV أو PDF من البنك لاستيراد المعاملات'
                : 'Upload a CSV or PDF file from your bank to import transactions'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{locale === 'ar' ? 'حساب البنك' : 'Bank Account'}</Label>
              <Select value={selectedBankAccount} onValueChange={setSelectedBankAccount}>
                <SelectTrigger data-testid="select-import-bank-account">
                  <SelectValue placeholder={locale === 'ar' ? 'اختر الحساب' : 'Select account'} />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map(account => (
                    <SelectItem key={account.id} value={account.id}>
                      {locale === 'ar' ? account.nameAr || account.nameEn : account.nameEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{locale === 'ar' ? 'ملف CSV أو PDF' : 'CSV or PDF File'}</Label>
              <Input
                type="file"
                accept=".csv,.pdf"
                onChange={handleFileChange}
                data-testid="input-csv-file"
              />
              {csvFile && (
                <p className="text-sm text-muted-foreground">
                  {csvFile.name} ({(csvFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
            <div className="bg-muted/50 p-3 rounded-md text-sm">
              <p className="font-medium mb-1">{locale === 'ar' ? 'الصيغ المدعومة:' : 'Supported formats:'}</p>
              <p className="text-xs mb-1">{locale === 'ar' ? 'CSV: ' : 'CSV: '}<code>Date, Description, Amount, Reference</code></p>
              <p className="text-xs">{locale === 'ar' ? 'PDF: يتم استخراج المعاملات تلقائياً من كشف الحساب' : 'PDF: Transactions are extracted automatically from bank statements'}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button 
              onClick={handleImport} 
              disabled={isImporting || !csvFile || !selectedBankAccount}
              data-testid="button-confirm-import"
            >
              {isImporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {locale === 'ar' ? 'استيراد' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={matchDialogOpen} onOpenChange={setMatchDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'مطابقة المعاملة' : 'Match Transaction'}</DialogTitle>
            <DialogDescription>
              {selectedTransaction && (
                <span>
                  {selectedTransaction.description} - {formatCurrency(selectedTransaction.amount)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {isLoadingMatches ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : matchSuggestions && matchSuggestions.length > 0 ? (
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'المطابقات المقترحة' : 'Suggested Matches'}</Label>
                {matchSuggestions.map((suggestion, idx) => (
                  <Card 
                    key={`${suggestion.type}-${suggestion.id}`} 
                    className="cursor-pointer hover-elevate"
                    onClick={() => handleReconcile(suggestion.id, suggestion.type)}
                  >
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {suggestion.type === 'journal' ? 'Journal Entry' : 
                             suggestion.type === 'receipt' ? 'Receipt' : 'Invoice'}
                          </Badge>
                          <span className="font-medium">{suggestion.description}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {format(parseISO(suggestion.date), 'dd MMM yyyy')} - {formatCurrency(suggestion.amount)}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge 
                          variant={suggestion.confidence > 0.8 ? 'default' : 'secondary'}
                          className={suggestion.confidence > 0.8 ? 'bg-green-100 text-green-800' : ''}
                        >
                          {Math.round(suggestion.confidence * 100)}% match
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <ArrowRightLeft className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  {locale === 'ar' 
                    ? 'لم يتم العثور على مطابقات تلقائية. يمكنك إنشاء قيد يدوي.'
                    : 'No automatic matches found. You can create a manual journal entry.'}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatchDialogOpen(false)}>
              {locale === 'ar' ? 'إغلاق' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
