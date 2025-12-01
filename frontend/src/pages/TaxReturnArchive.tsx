import { useState } from 'react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatCurrency } from '@/lib/format';
import { 
  FileText, 
  Download, 
  Search, 
  Calendar,
  Loader2,
  Plus,
  Eye,
  Filter,
  Receipt,
  Building2,
  CheckCircle2,
  Clock,
  AlertCircle
} from 'lucide-react';

interface TaxReturn {
  id: string;
  companyId: string;
  returnType: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  filingDate: string;
  ftaReferenceNumber: string | null;
  taxAmount: number;
  paymentStatus: string;
  fileUrl: string | null;
  fileName: string | null;
  notes: string | null;
  filedBy: string | null;
  createdAt: string;
}

const RETURN_TYPES = [
  { value: 'vat', labelEn: 'VAT Return', labelAr: 'إقرار ضريبة القيمة المضافة' },
  { value: 'corporate_tax', labelEn: 'Corporate Tax', labelAr: 'ضريبة الشركات' },
  { value: 'excise_tax', labelEn: 'Excise Tax', labelAr: 'الضريبة الانتقائية' },
];

export default function TaxReturnArchive() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newReturn, setNewReturn] = useState({
    returnType: 'vat',
    periodLabel: '',
    periodStart: '',
    periodEnd: '',
    filingDate: '',
    ftaReferenceNumber: '',
    taxAmount: 0,
    paymentStatus: 'paid',
    notes: '',
  });

  const { data: taxReturns, isLoading } = useQuery<TaxReturn[]>({
    queryKey: ['/api/companies', companyId, 'tax-returns-archive'],
    enabled: !!companyId,
  });

  const addMutation = useMutation({
    mutationFn: async (data: typeof newReturn & { fileName?: string }) => {
      return apiRequest('POST', `/api/companies/${companyId}/tax-returns-archive`, {
        ...data,
        fileUrl: data.fileName ? `/uploads/${data.fileName}` : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'tax-returns-archive'] });
      toast({
        title: locale === 'ar' ? 'تمت الإضافة بنجاح' : 'Added Successfully',
        description: locale === 'ar' ? 'تم حفظ الإقرار الضريبي' : 'Tax return has been saved',
      });
      setAddDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: locale === 'ar' ? 'فشل الإضافة' : 'Failed to Add',
        description: error.message,
      });
    },
  });

  const resetForm = () => {
    setNewReturn({
      returnType: 'vat',
      periodLabel: '',
      periodStart: '',
      periodEnd: '',
      filingDate: '',
      ftaReferenceNumber: '',
      taxAmount: 0,
      paymentStatus: 'paid',
      notes: '',
    });
    setSelectedFile(null);
  };

  const handleSubmit = async () => {
    if (!newReturn.periodLabel || !newReturn.periodStart || !newReturn.periodEnd || !newReturn.filingDate) {
      toast({
        variant: 'destructive',
        title: locale === 'ar' ? 'معلومات ناقصة' : 'Missing Information',
        description: locale === 'ar' ? 'يرجى ملء جميع الحقول المطلوبة' : 'Please fill in all required fields',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await addMutation.mutateAsync({
        ...newReturn,
        fileName: selectedFile?.name,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const years = [...new Set(taxReturns?.map(r => new Date(r.periodEnd).getFullYear()) || [])].sort((a, b) => b - a);

  const filteredReturns = taxReturns?.filter(ret => {
    if (typeFilter !== 'all' && ret.returnType !== typeFilter) return false;
    if (yearFilter !== 'all' && new Date(ret.periodEnd).getFullYear().toString() !== yearFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return ret.periodLabel.toLowerCase().includes(query) || 
             ret.ftaReferenceNumber?.toLowerCase().includes(query);
    }
    return true;
  }) || [];

  const stats = {
    totalReturns: taxReturns?.length || 0,
    vatReturns: taxReturns?.filter(r => r.returnType === 'vat').length || 0,
    corporateTax: taxReturns?.filter(r => r.returnType === 'corporate_tax').length || 0,
    totalTaxPaid: taxReturns?.reduce((sum, r) => sum + (r.taxAmount || 0), 0) || 0,
  };

  if (isLoadingCompany || isLoading) {
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
            {locale === 'ar' ? 'أرشيف الإقرارات الضريبية' : 'Tax Return Archive'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'ar' 
              ? 'عرض جميع الإقرارات الضريبية المقدمة للهيئة الاتحادية للضرائب'
              : 'View all tax returns filed with the Federal Tax Authority'}
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)} data-testid="button-add-return">
          <Plus className="w-4 h-4 mr-2" />
          {locale === 'ar' ? 'إضافة إقرار' : 'Add Return'}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'ar' ? 'إجمالي الإقرارات' : 'Total Returns'}
            </CardTitle>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalReturns}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'ar' ? 'إقرارات ضريبة القيمة المضافة' : 'VAT Returns'}
            </CardTitle>
            <Receipt className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.vatReturns}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'ar' ? 'ضريبة الشركات' : 'Corporate Tax'}
            </CardTitle>
            <Building2 className="w-4 h-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{stats.corporateTax}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'ar' ? 'إجمالي الضرائب المدفوعة' : 'Total Tax Paid'}
            </CardTitle>
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(stats.totalTaxPaid)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder={locale === 'ar' ? 'بحث بالفترة أو رقم المرجع...' : 'Search by period or reference...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-returns"
              />
            </div>
            <div className="flex gap-2">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-type-filter">
                  <SelectValue placeholder={locale === 'ar' ? 'نوع الإقرار' : 'Return Type'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{locale === 'ar' ? 'جميع الأنواع' : 'All Types'}</SelectItem>
                  {RETURN_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {locale === 'ar' ? type.labelAr : type.labelEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger className="w-[140px]" data-testid="select-year-filter">
                  <SelectValue placeholder={locale === 'ar' ? 'السنة' : 'Year'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{locale === 'ar' ? 'جميع السنوات' : 'All Years'}</SelectItem>
                  {years.map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredReturns.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{locale === 'ar' ? 'لا توجد إقرارات ضريبية' : 'No tax returns found'}</p>
              <Button variant="link" onClick={() => setAddDialogOpen(true)}>
                {locale === 'ar' ? 'إضافة أول إقرار' : 'Add your first return'}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{locale === 'ar' ? 'الفترة' : 'Period'}</TableHead>
                    <TableHead>{locale === 'ar' ? 'النوع' : 'Type'}</TableHead>
                    <TableHead>{locale === 'ar' ? 'تاريخ التقديم' : 'Filing Date'}</TableHead>
                    <TableHead>{locale === 'ar' ? 'رقم المرجع' : 'Reference No.'}</TableHead>
                    <TableHead>{locale === 'ar' ? 'المبلغ' : 'Amount'}</TableHead>
                    <TableHead>{locale === 'ar' ? 'حالة الدفع' : 'Payment'}</TableHead>
                    <TableHead className="text-right">{locale === 'ar' ? 'إجراءات' : 'Actions'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReturns.map((ret) => {
                    const returnType = RETURN_TYPES.find(t => t.value === ret.returnType);
                    
                    return (
                      <TableRow key={ret.id} data-testid={`row-return-${ret.id}`}>
                        <TableCell>
                          <div className="font-medium">{ret.periodLabel}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(parseISO(ret.periodStart), 'dd MMM')} - {format(parseISO(ret.periodEnd), 'dd MMM yyyy')}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={ret.returnType === 'vat' ? 'default' : 'secondary'}>
                            {locale === 'ar' ? returnType?.labelAr : returnType?.labelEn}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {format(parseISO(ret.filingDate), 'dd MMM yyyy')}
                          </div>
                        </TableCell>
                        <TableCell>
                          {ret.ftaReferenceNumber || '-'}
                        </TableCell>
                        <TableCell className="font-medium">
                          {formatCurrency(ret.taxAmount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={ret.paymentStatus === 'paid' ? 'default' : ret.paymentStatus === 'partial' ? 'secondary' : 'destructive'}>
                            {ret.paymentStatus === 'paid' && (
                              <><CheckCircle2 className="w-3 h-3 mr-1" />{locale === 'ar' ? 'مدفوع' : 'Paid'}</>
                            )}
                            {ret.paymentStatus === 'partial' && (
                              <><Clock className="w-3 h-3 mr-1" />{locale === 'ar' ? 'جزئي' : 'Partial'}</>
                            )}
                            {ret.paymentStatus === 'unpaid' && (
                              <><AlertCircle className="w-3 h-3 mr-1" />{locale === 'ar' ? 'غير مدفوع' : 'Unpaid'}</>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {ret.fileUrl && (
                              <>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => window.open(ret.fileUrl!, '_blank')}
                                  data-testid={`button-view-${ret.id}`}
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    const link = document.createElement('a');
                                    link.href = ret.fileUrl!;
                                    link.download = ret.fileName || 'tax-return.pdf';
                                    link.click();
                                  }}
                                  data-testid={`button-download-${ret.id}`}
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                              </>
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

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'إضافة إقرار ضريبي' : 'Add Tax Return'}</DialogTitle>
            <DialogDescription>
              {locale === 'ar' 
                ? 'سجل إقراراً ضريبياً تم تقديمه للهيئة الاتحادية للضرائب'
                : 'Record a tax return filed with the Federal Tax Authority'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'نوع الإقرار' : 'Return Type'} *</Label>
                <Select 
                  value={newReturn.returnType} 
                  onValueChange={(val) => setNewReturn({ ...newReturn, returnType: val })}
                >
                  <SelectTrigger data-testid="select-return-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RETURN_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {locale === 'ar' ? type.labelAr : type.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'تسمية الفترة' : 'Period Label'} *</Label>
                <Input
                  value={newReturn.periodLabel}
                  onChange={(e) => setNewReturn({ ...newReturn, periodLabel: e.target.value })}
                  placeholder="Q1 2025"
                  data-testid="input-period-label"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'بداية الفترة' : 'Period Start'} *</Label>
                <Input
                  type="date"
                  value={newReturn.periodStart}
                  onChange={(e) => setNewReturn({ ...newReturn, periodStart: e.target.value })}
                  data-testid="input-period-start"
                />
              </div>
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'نهاية الفترة' : 'Period End'} *</Label>
                <Input
                  type="date"
                  value={newReturn.periodEnd}
                  onChange={(e) => setNewReturn({ ...newReturn, periodEnd: e.target.value })}
                  data-testid="input-period-end"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'تاريخ التقديم' : 'Filing Date'} *</Label>
                <Input
                  type="date"
                  value={newReturn.filingDate}
                  onChange={(e) => setNewReturn({ ...newReturn, filingDate: e.target.value })}
                  data-testid="input-filing-date"
                />
              </div>
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'رقم مرجع الهيئة' : 'FTA Reference No.'}</Label>
                <Input
                  value={newReturn.ftaReferenceNumber}
                  onChange={(e) => setNewReturn({ ...newReturn, ftaReferenceNumber: e.target.value })}
                  placeholder="FTA-VAT-2025-001"
                  data-testid="input-fta-reference"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'مبلغ الضريبة' : 'Tax Amount'}</Label>
                <Input
                  type="number"
                  value={newReturn.taxAmount}
                  onChange={(e) => setNewReturn({ ...newReturn, taxAmount: parseFloat(e.target.value) || 0 })}
                  min="0"
                  step="0.01"
                  data-testid="input-tax-amount"
                />
              </div>
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'حالة الدفع' : 'Payment Status'}</Label>
                <Select 
                  value={newReturn.paymentStatus} 
                  onValueChange={(val) => setNewReturn({ ...newReturn, paymentStatus: val })}
                >
                  <SelectTrigger data-testid="select-payment-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">{locale === 'ar' ? 'مدفوع' : 'Paid'}</SelectItem>
                    <SelectItem value="partial">{locale === 'ar' ? 'جزئي' : 'Partial'}</SelectItem>
                    <SelectItem value="unpaid">{locale === 'ar' ? 'غير مدفوع' : 'Unpaid'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{locale === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
              <Textarea
                value={newReturn.notes}
                onChange={(e) => setNewReturn({ ...newReturn, notes: e.target.value })}
                placeholder={locale === 'ar' ? 'أي ملاحظات إضافية...' : 'Any additional notes...'}
                data-testid="input-notes"
              />
            </div>

            <div className="space-y-2">
              <Label>{locale === 'ar' ? 'ملف الإقرار (PDF)' : 'Return File (PDF)'}</Label>
              <Input
                type="file"
                accept=".pdf"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                data-testid="input-return-file"
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground">
                  {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddDialogOpen(false); resetForm(); }}>
              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} data-testid="button-confirm-add">
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {locale === 'ar' ? 'إضافة' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
