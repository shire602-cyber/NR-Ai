import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { format, parseISO, startOfQuarter, endOfQuarter, addQuarters, subQuarters } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatCurrency } from '@/lib/format';
import { 
  FileText, 
  Download, 
  Upload,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calculator,
  Send,
  FileCheck,
  Loader2,
  ChevronRight,
  Building2,
  Calendar,
  RefreshCw
} from 'lucide-react';
import jsPDF from 'jspdf';

interface VATReturn {
  id: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: string;
  box1SalesStandard: number;
  box2SalesOtherEmirates: number;
  box3SalesTaxExempt: number;
  box4SalesExempt: number;
  box5TotalOutputTax: number;
  box6ExpensesStandard: number;
  box7ExpensesTouristRefund: number;
  box8TotalInputTax: number;
  box9NetTax: number;
  adjustmentAmount: number | null;
  adjustmentReason: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  ftaReferenceNumber: string | null;
  paymentStatus: string | null;
  paymentAmount: number | null;
  paymentDate: string | null;
  notes: string | null;
  createdAt: string;
}

interface Company {
  id: string;
  name: string;
  trnVatNumber: string | null;
  vatFilingFrequency: string | null;
}

export default function VATFiling() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState<VATReturn | null>(null);
  const [newPeriodStart, setNewPeriodStart] = useState('');
  const [newPeriodEnd, setNewPeriodEnd] = useState('');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [notes, setNotes] = useState('');

  const { data: company } = useQuery<Company>({
    queryKey: ['/api/companies', companyId],
    enabled: !!companyId,
  });

  const { data: vatReturns, isLoading: isLoadingReturns } = useQuery<VATReturn[]>({
    queryKey: ['/api/companies', companyId, 'vat-returns'],
    enabled: !!companyId,
  });

  const generateMutation = useMutation({
    mutationFn: ({ periodStart, periodEnd }: { periodStart: string; periodEnd: string }) =>
      apiRequest('POST', `/api/companies/${companyId}/vat-returns/generate`, { periodStart, periodEnd }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'vat-returns'] });
      toast({
        title: 'VAT Return Generated',
        description: 'Review the calculated amounts before submitting.',
      });
      setCreateDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Generation Failed',
        description: error.message || 'Failed to generate VAT return',
      });
    },
  });

  const submitMutation = useMutation({
    mutationFn: ({ id, adjustmentAmount, adjustmentReason, notes }: { id: string; adjustmentAmount?: number; adjustmentReason?: string; notes?: string }) =>
      apiRequest('POST', `/api/vat-returns/${id}/submit`, { adjustmentAmount, adjustmentReason, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'vat-returns'] });
      toast({
        title: 'VAT Return Submitted',
        description: 'Your VAT return is ready for FTA filing.',
      });
      setReviewDialogOpen(false);
      setSelectedReturn(null);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Submission Failed',
        description: error.message || 'Failed to submit VAT return',
      });
    },
  });

  const stats = useMemo(() => {
    if (!vatReturns) return { total: 0, pending: 0, submitted: 0, filed: 0 };
    
    return {
      total: vatReturns.length,
      pending: vatReturns.filter(r => r.status === 'draft' || r.status === 'pending_review').length,
      submitted: vatReturns.filter(r => r.status === 'submitted').length,
      filed: vatReturns.filter(r => r.status === 'filed').length,
    };
  }, [vatReturns]);

  const currentQuarter = useMemo(() => {
    const now = new Date();
    return {
      start: startOfQuarter(now),
      end: endOfQuarter(now),
    };
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Draft</Badge>;
      case 'pending_review':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800"><AlertTriangle className="w-3 h-3 mr-1" />Review</Badge>;
      case 'submitted':
        return <Badge variant="default" className="bg-blue-100 text-blue-800"><Send className="w-3 h-3 mr-1" />Submitted</Badge>;
      case 'filed':
        return <Badge variant="default" className="bg-green-100 text-green-800"><CheckCircle2 className="w-3 h-3 mr-1" />Filed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleCreateReturn = () => {
    setNewPeriodStart(format(currentQuarter.start, 'yyyy-MM-dd'));
    setNewPeriodEnd(format(currentQuarter.end, 'yyyy-MM-dd'));
    setCreateDialogOpen(true);
  };

  const handleGenerateReturn = () => {
    generateMutation.mutate({
      periodStart: newPeriodStart,
      periodEnd: newPeriodEnd,
    });
  };

  const handleReviewReturn = (vatReturn: VATReturn) => {
    setSelectedReturn(vatReturn);
    setAdjustmentAmount(vatReturn.adjustmentAmount?.toString() || '');
    setAdjustmentReason(vatReturn.adjustmentReason || '');
    setNotes(vatReturn.notes || '');
    setReviewDialogOpen(true);
  };

  const handleSubmitReturn = () => {
    if (!selectedReturn) return;
    submitMutation.mutate({
      id: selectedReturn.id,
      adjustmentAmount: adjustmentAmount ? parseFloat(adjustmentAmount) : undefined,
      adjustmentReason: adjustmentReason || undefined,
      notes: notes || undefined,
    });
  };

  const handleExportPDF = (vatReturn: VATReturn) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    doc.setFontSize(20);
    doc.text('UAE VAT Return', pageWidth / 2, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.text(`Company: ${company?.name || 'N/A'}`, 14, 35);
    doc.text(`TRN: ${company?.trnVatNumber || 'N/A'}`, 14, 42);
    doc.text(`Period: ${format(parseISO(vatReturn.periodStart), 'dd MMM yyyy')} - ${format(parseISO(vatReturn.periodEnd), 'dd MMM yyyy')}`, 14, 49);
    doc.text(`Status: ${vatReturn.status}`, 14, 56);
    
    doc.setFontSize(14);
    doc.text('Output Tax (Sales)', 14, 70);
    doc.setFontSize(10);
    
    let y = 80;
    doc.text(`Box 1 - Standard rated supplies (Abu Dhabi): AED ${vatReturn.box1SalesStandard.toFixed(2)}`, 20, y);
    y += 7;
    doc.text(`Box 2 - Standard rated supplies (Other Emirates): AED ${vatReturn.box2SalesOtherEmirates.toFixed(2)}`, 20, y);
    y += 7;
    doc.text(`Box 3 - Zero rated supplies: AED ${vatReturn.box3SalesTaxExempt.toFixed(2)}`, 20, y);
    y += 7;
    doc.text(`Box 4 - Exempt supplies: AED ${vatReturn.box4SalesExempt.toFixed(2)}`, 20, y);
    y += 7;
    doc.setFontSize(11);
    doc.text(`Box 5 - Total Output Tax: AED ${vatReturn.box5TotalOutputTax.toFixed(2)}`, 20, y);
    
    y += 15;
    doc.setFontSize(14);
    doc.text('Input Tax (Purchases)', 14, y);
    doc.setFontSize(10);
    y += 10;
    doc.text(`Box 6 - Standard rated expenses: AED ${vatReturn.box6ExpensesStandard.toFixed(2)}`, 20, y);
    y += 7;
    doc.text(`Box 7 - Tourist refund: AED ${vatReturn.box7ExpensesTouristRefund.toFixed(2)}`, 20, y);
    y += 7;
    doc.setFontSize(11);
    doc.text(`Box 8 - Total Recoverable Tax: AED ${vatReturn.box8TotalInputTax.toFixed(2)}`, 20, y);
    
    y += 15;
    doc.setFontSize(14);
    doc.text('Net Tax', 14, y);
    doc.setFontSize(12);
    y += 10;
    const netTax = vatReturn.box9NetTax + (vatReturn.adjustmentAmount || 0);
    doc.text(`Box 9 - Net Tax ${netTax >= 0 ? 'Payable' : 'Refundable'}: AED ${Math.abs(netTax).toFixed(2)}`, 20, y);
    
    if (vatReturn.adjustmentAmount) {
      y += 10;
      doc.setFontSize(10);
      doc.text(`Adjustment: AED ${vatReturn.adjustmentAmount.toFixed(2)}`, 20, y);
      if (vatReturn.adjustmentReason) {
        y += 7;
        doc.text(`Reason: ${vatReturn.adjustmentReason}`, 20, y);
      }
    }
    
    y += 20;
    doc.setFontSize(8);
    doc.text(`Generated on ${format(new Date(), 'dd MMM yyyy HH:mm')}`, 14, y);
    doc.text('This is a system-generated document for FTA VAT filing purposes.', 14, y + 5);
    
    doc.save(`VAT-Return-${format(parseISO(vatReturn.periodStart), 'yyyy-Q')}.pdf`);
    
    toast({
      title: 'PDF Exported',
      description: 'VAT return has been downloaded.',
    });
  };

  if (isLoadingCompany) {
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
            {locale === 'ar' ? 'إقرارات ضريبة القيمة المضافة' : 'UAE VAT Filing'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'ar' 
              ? 'إنشاء وتقديم إقرارات ضريبة القيمة المضافة وفقاً لمتطلبات الهيئة الاتحادية للضرائب'
              : 'Generate and submit VAT returns compliant with FTA requirements'}
          </p>
        </div>
        <Button onClick={handleCreateReturn} data-testid="button-create-return">
          <Calculator className="w-4 h-4 mr-2" />
          {locale === 'ar' ? 'إنشاء إقرار' : 'Generate Return'}
        </Button>
      </div>

      {!company?.trnVatNumber && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800">
                  {locale === 'ar' ? 'رقم التسجيل الضريبي غير مكتمل' : 'Tax Registration Number Missing'}
                </p>
                <p className="text-sm text-amber-700">
                  {locale === 'ar' 
                    ? 'يرجى إضافة رقم التسجيل الضريبي في إعدادات الشركة للتمكن من تقديم الإقرارات.'
                    : 'Please add your TRN in Company Profile to enable VAT filing.'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {locale === 'ar' ? 'إجمالي الإقرارات' : 'Total Returns'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {locale === 'ar' ? 'قيد المراجعة' : 'Pending Review'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats.pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {locale === 'ar' ? 'تم التقديم' : 'Submitted'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.submitted}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {locale === 'ar' ? 'مقدمة للهيئة' : 'Filed with FTA'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.filed}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{locale === 'ar' ? 'سجل الإقرارات' : 'VAT Returns History'}</CardTitle>
          <CardDescription>
            {locale === 'ar' 
              ? 'جميع إقرارات ضريبة القيمة المضافة المسجلة'
              : 'All your VAT return submissions and drafts'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingReturns ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : !vatReturns || vatReturns.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {locale === 'ar' 
                  ? 'لا توجد إقرارات. أنشئ أول إقرار ضريبي.'
                  : 'No VAT returns yet. Generate your first VAT return.'}
              </p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{locale === 'ar' ? 'الفترة' : 'Period'}</TableHead>
                    <TableHead>{locale === 'ar' ? 'تاريخ الاستحقاق' : 'Due Date'}</TableHead>
                    <TableHead className="text-right">{locale === 'ar' ? 'ضريبة المخرجات' : 'Output Tax'}</TableHead>
                    <TableHead className="text-right">{locale === 'ar' ? 'ضريبة المدخلات' : 'Input Tax'}</TableHead>
                    <TableHead className="text-right">{locale === 'ar' ? 'صافي الضريبة' : 'Net Tax'}</TableHead>
                    <TableHead>{locale === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                    <TableHead className="text-right">{locale === 'ar' ? 'الإجراءات' : 'Actions'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vatReturns.map(vatReturn => (
                    <TableRow key={vatReturn.id} data-testid={`row-return-${vatReturn.id}`}>
                      <TableCell className="font-medium">
                        {format(parseISO(vatReturn.periodStart), 'MMM yyyy')} - {format(parseISO(vatReturn.periodEnd), 'MMM yyyy')}
                      </TableCell>
                      <TableCell>
                        {format(parseISO(vatReturn.dueDate), 'dd MMM yyyy')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(vatReturn.box5TotalOutputTax)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(vatReturn.box8TotalInputTax)}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-medium ${vatReturn.box9NetTax >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {vatReturn.box9NetTax >= 0 ? '' : '('}{formatCurrency(Math.abs(vatReturn.box9NetTax))}{vatReturn.box9NetTax >= 0 ? '' : ')'}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(vatReturn.status)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {(vatReturn.status === 'draft' || vatReturn.status === 'pending_review') && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReviewReturn(vatReturn)}
                              data-testid={`button-review-${vatReturn.id}`}
                            >
                              <FileCheck className="w-4 h-4 mr-1" />
                              {locale === 'ar' ? 'مراجعة' : 'Review'}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleExportPDF(vatReturn)}
                            data-testid={`button-export-${vatReturn.id}`}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'إنشاء إقرار ضريبي' : 'Generate VAT Return'}</DialogTitle>
            <DialogDescription>
              {locale === 'ar' 
                ? 'حدد الفترة الضريبية لإنشاء الإقرار'
                : 'Select the tax period to generate the VAT return'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'من تاريخ' : 'Period Start'}</Label>
                <Input
                  type="date"
                  value={newPeriodStart}
                  onChange={(e) => setNewPeriodStart(e.target.value)}
                  data-testid="input-period-start"
                />
              </div>
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'إلى تاريخ' : 'Period End'}</Label>
                <Input
                  type="date"
                  value={newPeriodEnd}
                  onChange={(e) => setNewPeriodEnd(e.target.value)}
                  data-testid="input-period-end"
                />
              </div>
            </div>
            <div className="bg-muted/50 p-3 rounded-md text-sm">
              <p className="font-medium mb-1">{locale === 'ar' ? 'ملاحظة:' : 'Note:'}</p>
              <p className="text-muted-foreground">
                {locale === 'ar' 
                  ? 'سيتم حساب المبالغ تلقائياً من الفواتير والمصروفات المسجلة.'
                  : 'Amounts will be calculated automatically from your recorded invoices and expenses.'}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button 
              onClick={handleGenerateReturn} 
              disabled={generateMutation.isPending || !newPeriodStart || !newPeriodEnd}
              data-testid="button-confirm-generate"
            >
              {generateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {locale === 'ar' ? 'إنشاء' : 'Generate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'مراجعة الإقرار الضريبي' : 'Review VAT Return'}</DialogTitle>
            <DialogDescription>
              {selectedReturn && (
                <span>
                  {format(parseISO(selectedReturn.periodStart), 'MMM yyyy')} - {format(parseISO(selectedReturn.periodEnd), 'MMM yyyy')}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedReturn && (
            <div className="space-y-6">
              <div className="space-y-4">
                <h4 className="font-medium">{locale === 'ar' ? 'ضريبة المخرجات (المبيعات)' : 'Output Tax (Sales)'}</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Box 1 - Standard (Abu Dhabi)</span>
                    <span className="font-mono">{formatCurrency(selectedReturn.box1SalesStandard)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Box 2 - Standard (Other)</span>
                    <span className="font-mono">{formatCurrency(selectedReturn.box2SalesOtherEmirates)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Box 3 - Zero Rated</span>
                    <span className="font-mono">{formatCurrency(selectedReturn.box3SalesTaxExempt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Box 4 - Exempt</span>
                    <span className="font-mono">{formatCurrency(selectedReturn.box4SalesExempt)}</span>
                  </div>
                </div>
                <div className="flex justify-between font-medium border-t pt-2">
                  <span>Box 5 - Total Output Tax</span>
                  <span className="font-mono">{formatCurrency(selectedReturn.box5TotalOutputTax)}</span>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h4 className="font-medium">{locale === 'ar' ? 'ضريبة المدخلات (المشتريات)' : 'Input Tax (Purchases)'}</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Box 6 - Standard Rated</span>
                    <span className="font-mono">{formatCurrency(selectedReturn.box6ExpensesStandard)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Box 7 - Tourist Refund</span>
                    <span className="font-mono">{formatCurrency(selectedReturn.box7ExpensesTouristRefund)}</span>
                  </div>
                </div>
                <div className="flex justify-between font-medium border-t pt-2">
                  <span>Box 8 - Total Recoverable Tax</span>
                  <span className="font-mono">{formatCurrency(selectedReturn.box8TotalInputTax)}</span>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="flex justify-between text-lg font-bold">
                  <span>Box 9 - Net Tax {selectedReturn.box9NetTax >= 0 ? 'Payable' : 'Refundable'}</span>
                  <span className={`font-mono ${selectedReturn.box9NetTax >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(Math.abs(selectedReturn.box9NetTax))}
                  </span>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h4 className="font-medium">{locale === 'ar' ? 'تعديلات' : 'Adjustments'}</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{locale === 'ar' ? 'مبلغ التعديل' : 'Adjustment Amount'}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={adjustmentAmount}
                      onChange={(e) => setAdjustmentAmount(e.target.value)}
                      placeholder="0.00"
                      data-testid="input-adjustment-amount"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{locale === 'ar' ? 'سبب التعديل' : 'Adjustment Reason'}</Label>
                    <Input
                      value={adjustmentReason}
                      onChange={(e) => setAdjustmentReason(e.target.value)}
                      placeholder={locale === 'ar' ? 'أدخل السبب' : 'Enter reason'}
                      data-testid="input-adjustment-reason"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{locale === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={locale === 'ar' ? 'ملاحظات إضافية...' : 'Additional notes...'}
                    rows={3}
                    data-testid="input-notes"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => handleExportPDF(selectedReturn!)}>
              <Download className="w-4 h-4 mr-2" />
              {locale === 'ar' ? 'تصدير PDF' : 'Export PDF'}
            </Button>
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>
              {locale === 'ar' ? 'إغلاق' : 'Close'}
            </Button>
            <Button 
              onClick={handleSubmitReturn} 
              disabled={submitMutation.isPending}
              data-testid="button-submit-return"
            >
              {submitMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Send className="w-4 h-4 mr-2" />
              {locale === 'ar' ? 'تقديم' : 'Submit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
