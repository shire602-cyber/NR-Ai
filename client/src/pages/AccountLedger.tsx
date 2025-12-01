import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRoute, useLocation, Link } from 'wouter';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { DateRangeFilter, type DateRange } from '@/components/DateRangeFilter';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/format';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { getAuthHeaders } from '@/lib/auth';
import type { Account } from '@shared/schema';
import jsPDF from 'jspdf';
import { 
  ArrowLeft, 
  Search, 
  Download, 
  FileText,
  FileSpreadsheet,
  RotateCcw,
  BookOpen,
  Calendar,
  Filter,
  ChevronLeft,
  ChevronRight,
  RefreshCw
} from 'lucide-react';

interface LedgerEntry {
  id: string;
  date: Date;
  entryNumber: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  journalEntryId: string;
  journalLineId: string;
  memo: string | null;
  source: string;
  status: string;
}

interface LedgerResponse {
  entries: LedgerEntry[];
  allEntries: LedgerEntry[];
  account: Account;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  totalCount: number;
}

export default function AccountLedger() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [match, params] = useRoute('/accounts/:id/ledger');
  const accountId = params?.id;
  const { companyId: selectedCompanyId } = useDefaultCompany();

  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [isExporting, setIsExporting] = useState(false);
  const [reversalDialogOpen, setReversalDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const entriesPerPage = 25;

  const { data: ledger, isLoading, refetch } = useQuery<LedgerResponse>({
    queryKey: ['/api/accounts', accountId, 'ledger', { dateRange, searchQuery, currentPage }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange.from) params.set('dateStart', format(dateRange.from, 'yyyy-MM-dd'));
      if (dateRange.to) params.set('dateEnd', format(dateRange.to, 'yyyy-MM-dd'));
      if (searchQuery) params.set('search', searchQuery);
      params.set('limit', String(entriesPerPage));
      params.set('offset', String((currentPage - 1) * entriesPerPage));
      
      const url = `/api/accounts/${accountId}/ledger?${params.toString()}`;
      const response = await fetch(url, {
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch ledger');
      return response.json();
    },
    enabled: !!accountId,
  });

  const reversalMutation = useMutation({
    mutationFn: async ({ entryId, reason }: { entryId: string; reason: string }) => {
      return await apiRequest('POST', `/api/journal/${entryId}/reverse`, { reason });
    },
    onSuccess: () => {
      toast({
        title: locale === 'ar' ? 'تم عكس القيد بنجاح' : 'Entry reversed successfully',
        description: locale === 'ar' 
          ? 'تم إنشاء قيد عكسي جديد' 
          : 'A new reversing entry has been created',
      });
      setReversalDialogOpen(false);
      setSelectedEntry(null);
      setReversalReason('');
      queryClient.invalidateQueries({ queryKey: ['/api/accounts', accountId, 'ledger'] });
    },
    onError: (error: any) => {
      toast({
        title: locale === 'ar' ? 'فشل عكس القيد' : 'Reversal failed',
        description: error.message || 'An error occurred',
        variant: 'destructive',
      });
    },
  });

  const totalPages = Math.ceil((ledger?.totalCount || 0) / entriesPerPage);
  
  const paginatedEntries = ledger?.entries || [];

  const handleExportCSV = () => {
    if (!ledger) return;
    
    const exportEntries = ledger.allEntries || ledger.entries;
    const headers = ['Date', 'Entry #', 'Description', 'Debit', 'Credit', 'Balance'];
    const rows = exportEntries.map(entry => [
      format(new Date(entry.date), 'yyyy-MM-dd'),
      entry.entryNumber,
      entry.description || entry.memo || '',
      entry.debit.toFixed(2),
      entry.credit.toFixed(2),
      entry.runningBalance.toFixed(2)
    ]);

    const csvContent = [
      [`Account Ledger: ${ledger.account.nameEn}`],
      [`Opening Balance: ${ledger.openingBalance.toFixed(2)}`],
      [],
      headers,
      ...rows,
      [],
      [`Total Debit: ${ledger.totalDebit.toFixed(2)}`],
      [`Total Credit: ${ledger.totalCredit.toFixed(2)}`],
      [`Closing Balance: ${ledger.closingBalance.toFixed(2)}`]
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `ledger_${ledger.account.nameEn.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.csv`;
    link.click();

    toast({
      title: locale === 'ar' ? 'تم التصدير' : 'Export complete',
      description: locale === 'ar' ? 'تم تحميل ملف CSV' : 'CSV file downloaded',
    });
  };

  const handleExportPDF = () => {
    if (!ledger) return;
    setIsExporting(true);

    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      
      doc.setFontSize(18);
      doc.text(`Account Ledger: ${ledger.account.nameEn}`, 14, 22);
      
      doc.setFontSize(10);
      doc.text(`Generated: ${format(new Date(), 'MMM dd, yyyy HH:mm')}`, 14, 30);
      doc.text(`Opening Balance: AED ${ledger.openingBalance.toFixed(2)}`, 14, 36);
      
      const dateRangeStr = dateRange.from && dateRange.to 
        ? `Period: ${format(dateRange.from, 'MMM dd, yyyy')} - ${format(dateRange.to, 'MMM dd, yyyy')}`
        : 'Period: All time';
      doc.text(dateRangeStr, 14, 42);

      let yPos = 52;
      const colWidths = [25, 25, 65, 25, 25, 25];
      const headers = ['Date', 'Entry #', 'Description', 'Debit', 'Credit', 'Balance'];
      
      doc.setFillColor(240, 240, 240);
      doc.rect(14, yPos - 4, pageWidth - 28, 8, 'F');
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      
      let xPos = 14;
      headers.forEach((header, i) => {
        doc.text(header, xPos, yPos);
        xPos += colWidths[i];
      });
      
      yPos += 8;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);

      const exportEntries = ledger.allEntries || ledger.entries;
      exportEntries.forEach((entry) => {
        if (yPos > 280) {
          doc.addPage();
          yPos = 20;
        }

        xPos = 14;
        const rowData = [
          format(new Date(entry.date), 'MMM dd'),
          entry.entryNumber.slice(-8),
          (entry.description || entry.memo || '').slice(0, 40),
          entry.debit > 0 ? entry.debit.toFixed(2) : '-',
          entry.credit > 0 ? entry.credit.toFixed(2) : '-',
          entry.runningBalance.toFixed(2)
        ];

        rowData.forEach((cell, i) => {
          doc.text(cell, xPos, yPos);
          xPos += colWidths[i];
        });

        yPos += 6;
      });

      yPos += 8;
      doc.setFont('helvetica', 'bold');
      doc.text(`Total Debit: AED ${ledger.totalDebit.toFixed(2)}`, 14, yPos);
      doc.text(`Total Credit: AED ${ledger.totalCredit.toFixed(2)}`, 90, yPos);
      doc.text(`Closing Balance: AED ${ledger.closingBalance.toFixed(2)}`, 14, yPos + 6);

      doc.save(`ledger_${ledger.account.nameEn.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`);

      toast({
        title: locale === 'ar' ? 'تم التصدير' : 'Export complete',
        description: locale === 'ar' ? 'تم تحميل ملف PDF' : 'PDF file downloaded',
      });
    } catch (error) {
      toast({
        title: locale === 'ar' ? 'فشل التصدير' : 'Export failed',
        description: 'Could not generate PDF',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleReverseEntry = (entry: LedgerEntry) => {
    setSelectedEntry(entry);
    setReversalDialogOpen(true);
  };

  const confirmReversal = () => {
    if (!selectedEntry) return;
    reversalMutation.mutate({
      entryId: selectedEntry.journalEntryId,
      reason: reversalReason
    });
  };

  if (!accountId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
        <BookOpen className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Account Not Found</h2>
        <Button onClick={() => navigate('/chart-of-accounts')} variant="outline">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Chart of Accounts
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate('/chart-of-accounts')}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight" data-testid="text-account-name">
              {isLoading ? (
                <Skeleton className="h-8 w-48" />
              ) : (
                locale === 'ar' && ledger?.account.nameAr 
                  ? ledger.account.nameAr 
                  : ledger?.account.nameEn || 'Account Ledger'
              )}
            </h1>
            {isLoading ? (
              <Skeleton className="h-4 w-32 mt-1" />
            ) : (
              <p className="text-muted-foreground mt-1">
                <Badge variant="outline" className="mr-2">
                  {ledger?.account.type}
                </Badge>
                {locale === 'ar' ? 'دفتر الأستاذ' : 'General Ledger'}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleExportCSV}
            disabled={!ledger || isExporting}
            data-testid="button-export-csv"
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            CSV
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleExportPDF}
            disabled={!ledger || isExporting}
            data-testid="button-export-pdf"
          >
            <FileText className="h-4 w-4 mr-2" />
            PDF
          </Button>
          <Button 
            variant="outline" 
            size="icon"
            onClick={() => refetch()}
            data-testid="button-refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!isLoading && ledger && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'الرصيد الافتتاحي' : 'Opening Balance'}
              </p>
              <p className="text-2xl font-mono font-bold" data-testid="text-opening-balance">
                {formatCurrency(ledger.openingBalance)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'إجمالي المدين' : 'Total Debit'}
              </p>
              <p className="text-2xl font-mono font-bold text-emerald-600" data-testid="text-total-debit">
                {formatCurrency(ledger.totalDebit)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'إجمالي الدائن' : 'Total Credit'}
              </p>
              <p className="text-2xl font-mono font-bold text-rose-600" data-testid="text-total-credit">
                {formatCurrency(ledger.totalCredit)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">
                {locale === 'ar' ? 'الرصيد الختامي' : 'Closing Balance'}
              </p>
              <p className={`text-2xl font-mono font-bold ${
                ledger.closingBalance >= 0 ? 'text-foreground' : 'text-destructive'
              }`} data-testid="text-closing-balance">
                {formatCurrency(Math.abs(ledger.closingBalance))}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-5 w-5" />
              {locale === 'ar' ? 'الفلاتر' : 'Filters'}
            </CardTitle>
            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
              <div className="relative flex-1 sm:flex-none sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={locale === 'ar' ? 'بحث...' : 'Search entries...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-ledger"
                />
              </div>
              <DateRangeFilter
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
              />
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !ledger?.entries?.length ? (
            <div className="p-8 text-center">
              <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {locale === 'ar' ? 'لا توجد قيود' : 'No entries found'}
              </h3>
              <p className="text-muted-foreground">
                {locale === 'ar' 
                  ? 'لا توجد حركات لهذا الحساب بناءً على الفلاتر المحددة'
                  : 'No transactions found for this account with the selected filters'
                }
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">
                        {locale === 'ar' ? 'التاريخ' : 'Date'}
                      </TableHead>
                      <TableHead className="w-[120px]">
                        {locale === 'ar' ? 'رقم القيد' : 'Entry #'}
                      </TableHead>
                      <TableHead className="min-w-[200px]">
                        {locale === 'ar' ? 'الوصف' : 'Description'}
                      </TableHead>
                      <TableHead className="text-right w-[100px]">
                        {locale === 'ar' ? 'مدين' : 'Debit'}
                      </TableHead>
                      <TableHead className="text-right w-[100px]">
                        {locale === 'ar' ? 'دائن' : 'Credit'}
                      </TableHead>
                      <TableHead className="text-right w-[120px]">
                        {locale === 'ar' ? 'الرصيد' : 'Balance'}
                      </TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedEntries.map((entry, index) => (
                      <motion.tr
                        key={entry.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.02 }}
                        className="group hover-elevate"
                        data-testid={`row-entry-${entry.id}`}
                      >
                        <TableCell className="font-medium">
                          {format(new Date(entry.date), 'MMM dd, yyyy')}
                        </TableCell>
                        <TableCell>
                          <Link 
                            href={`/journal/${entry.journalEntryId}`}
                            className="text-primary hover:underline"
                          >
                            {entry.entryNumber.slice(-12)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="truncate max-w-[300px]">
                              {entry.description || entry.memo || '-'}
                            </span>
                            <Badge variant="outline" className="shrink-0 text-xs">
                              {entry.source}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-emerald-600">
                          {entry.debit > 0 ? formatCurrency(entry.debit) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-rose-600">
                          {entry.credit > 0 ? formatCurrency(entry.credit) : '-'}
                        </TableCell>
                        <TableCell className={`text-right font-mono font-medium ${
                          entry.runningBalance >= 0 ? 'text-foreground' : 'text-destructive'
                        }`}>
                          {formatCurrency(Math.abs(entry.runningBalance))}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleReverseEntry(entry)}
                            title={locale === 'ar' ? 'عكس القيد' : 'Reverse entry'}
                            data-testid={`button-reverse-${entry.id}`}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </motion.tr>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-sm text-muted-foreground">
                    {locale === 'ar' 
                      ? `عرض ${(currentPage - 1) * entriesPerPage + 1} - ${Math.min(currentPage * entriesPerPage, ledger.totalCount)} من ${ledger.totalCount}`
                      : `Showing ${(currentPage - 1) * entriesPerPage + 1} - ${Math.min(currentPage * entriesPerPage, ledger.totalCount)} of ${ledger.totalCount}`
                    }
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      data-testid="button-prev-page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">
                      {currentPage} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      data-testid="button-next-page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={reversalDialogOpen} onOpenChange={setReversalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {locale === 'ar' ? 'عكس القيد المحاسبي' : 'Reverse Journal Entry'}
            </DialogTitle>
            <DialogDescription>
              {locale === 'ar' 
                ? 'سيتم إنشاء قيد عكسي جديد لإلغاء تأثير هذا القيد. هذا الإجراء لا يمكن التراجع عنه.'
                : 'This will create a new reversing entry to cancel the effect of this entry. This action cannot be undone.'
              }
            </DialogDescription>
          </DialogHeader>
          
          {selectedEntry && (
            <div className="py-4 space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    {locale === 'ar' ? 'رقم القيد' : 'Entry Number'}
                  </span>
                  <span className="font-mono">{selectedEntry.entryNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    {locale === 'ar' ? 'التاريخ' : 'Date'}
                  </span>
                  <span>{format(new Date(selectedEntry.date), 'MMM dd, yyyy')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    {locale === 'ar' ? 'المبلغ' : 'Amount'}
                  </span>
                  <span className="font-mono">
                    {formatCurrency(selectedEntry.debit || selectedEntry.credit)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reversal-reason">
                  {locale === 'ar' ? 'سبب العكس (اختياري)' : 'Reversal reason (optional)'}
                </Label>
                <Textarea
                  id="reversal-reason"
                  placeholder={locale === 'ar' ? 'أدخل سبب العكس...' : 'Enter reason for reversal...'}
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  rows={3}
                  data-testid="input-reversal-reason"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setReversalDialogOpen(false)}
              data-testid="button-cancel-reversal"
            >
              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button 
              variant="destructive"
              onClick={confirmReversal}
              disabled={reversalMutation.isPending}
              data-testid="button-confirm-reversal"
            >
              {reversalMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {locale === 'ar' ? 'جاري العكس...' : 'Reversing...'}
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  {locale === 'ar' ? 'تأكيد العكس' : 'Confirm Reversal'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
