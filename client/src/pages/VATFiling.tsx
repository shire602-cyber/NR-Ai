import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { format, parseISO, startOfQuarter, endOfQuarter } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatCurrency } from '@/lib/format';
import VAT201Form from '@/components/VAT201Form';
import { 
  FileText, 
  Download, 
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calculator,
  Send,
  FileCheck,
  Loader2,
  Eye,
  Edit3
} from 'lucide-react';
import jsPDF from 'jspdf';

interface VATReturn {
  id: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  taxYearEnd: string | null;
  vatStagger: string | null;
  status: string;
  box1aAbuDhabiAmount: number;
  box1aAbuDhabiVat: number;
  box1aAbuDhabiAdj: number;
  box1bDubaiAmount: number;
  box1bDubaiVat: number;
  box1bDubaiAdj: number;
  box1cSharjahAmount: number;
  box1cSharjahVat: number;
  box1cSharjahAdj: number;
  box1dAjmanAmount: number;
  box1dAjmanVat: number;
  box1dAjmanAdj: number;
  box1eUmmAlQuwainAmount: number;
  box1eUmmAlQuwainVat: number;
  box1eUmmAlQuwainAdj: number;
  box1fRasAlKhaimahAmount: number;
  box1fRasAlKhaimahVat: number;
  box1fRasAlKhaimahAdj: number;
  box1gFujairahAmount: number;
  box1gFujairahVat: number;
  box1gFujairahAdj: number;
  box2TouristRefundAmount: number;
  box2TouristRefundVat: number;
  box3ReverseChargeAmount: number;
  box3ReverseChargeVat: number;
  box4ZeroRatedAmount: number;
  box5ExemptAmount: number;
  box6ImportsAmount: number;
  box6ImportsVat: number;
  box7ImportsAdjAmount: number;
  box7ImportsAdjVat: number;
  box8TotalAmount: number;
  box8TotalVat: number;
  box8TotalAdj: number;
  box9ExpensesAmount: number;
  box9ExpensesVat: number;
  box9ExpensesAdj: number;
  box10ReverseChargeAmount: number;
  box10ReverseChargeVat: number;
  box11TotalAmount: number;
  box11TotalVat: number;
  box11TotalAdj: number;
  box12TotalDueTax: number;
  box13RecoverableTax: number;
  box14PayableTax: number;
  adjustmentAmount: number | null;
  adjustmentReason: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  ftaReferenceNumber: string | null;
  paymentStatus: string | null;
  paymentAmount: number | null;
  paymentDate: string | null;
  notes: string | null;
  declarantName: string | null;
  declarantPosition: string | null;
  declarationDate: string | null;
  createdAt: string;
}

interface Company {
  id: string;
  name: string;
  nameAr: string | null;
  trnVatNumber: string | null;
  vatFilingFrequency: string | null;
  address: string | null;
  phone: string | null;
}

const DEFAULT_VAT_DATA = {
  box1aAbuDhabiAmount: 0, box1aAbuDhabiVat: 0, box1aAbuDhabiAdj: 0,
  box1bDubaiAmount: 0, box1bDubaiVat: 0, box1bDubaiAdj: 0,
  box1cSharjahAmount: 0, box1cSharjahVat: 0, box1cSharjahAdj: 0,
  box1dAjmanAmount: 0, box1dAjmanVat: 0, box1dAjmanAdj: 0,
  box1eUmmAlQuwainAmount: 0, box1eUmmAlQuwainVat: 0, box1eUmmAlQuwainAdj: 0,
  box1fRasAlKhaimahAmount: 0, box1fRasAlKhaimahVat: 0, box1fRasAlKhaimahAdj: 0,
  box1gFujairahAmount: 0, box1gFujairahVat: 0, box1gFujairahAdj: 0,
  box2TouristRefundAmount: 0, box2TouristRefundVat: 0,
  box3ReverseChargeAmount: 0, box3ReverseChargeVat: 0,
  box4ZeroRatedAmount: 0, box5ExemptAmount: 0,
  box6ImportsAmount: 0, box6ImportsVat: 0,
  box7ImportsAdjAmount: 0, box7ImportsAdjVat: 0,
  box9ExpensesAmount: 0, box9ExpensesVat: 0, box9ExpensesAdj: 0,
  box10ReverseChargeAmount: 0, box10ReverseChargeVat: 0,
};

export default function VATFiling() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState<VATReturn | null>(null);
  const [newPeriodStart, setNewPeriodStart] = useState('');
  const [newPeriodEnd, setNewPeriodEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [vatFormData, setVatFormData] = useState(DEFAULT_VAT_DATA);

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

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiRequest('PATCH', `/api/vat-returns/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'vat-returns'] });
      toast({
        title: 'VAT Return Updated',
        description: 'Your changes have been saved.',
      });
      setEditDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: error.message || 'Failed to update VAT return',
      });
    },
  });

  const submitMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiRequest('POST', `/api/vat-returns/${id}/submit`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'vat-returns'] });
      toast({
        title: 'VAT Return Submitted',
        description: 'Your VAT return is ready for FTA filing.',
      });
      setEditDialogOpen(false);
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
    if (!vatReturns) return { total: 0, pending: 0, submitted: 0, filed: 0, totalPayable: 0 };
    
    return {
      total: vatReturns.length,
      pending: vatReturns.filter(r => r.status === 'draft' || r.status === 'pending_review').length,
      submitted: vatReturns.filter(r => r.status === 'submitted').length,
      filed: vatReturns.filter(r => r.status === 'filed').length,
      totalPayable: vatReturns.reduce((sum, r) => sum + (r.box14PayableTax || 0), 0),
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

  const handleViewReturn = (vatReturn: VATReturn) => {
    setSelectedReturn(vatReturn);
    setVatFormData({
      box1aAbuDhabiAmount: vatReturn.box1aAbuDhabiAmount || 0,
      box1aAbuDhabiVat: vatReturn.box1aAbuDhabiVat || 0,
      box1aAbuDhabiAdj: vatReturn.box1aAbuDhabiAdj || 0,
      box1bDubaiAmount: vatReturn.box1bDubaiAmount || 0,
      box1bDubaiVat: vatReturn.box1bDubaiVat || 0,
      box1bDubaiAdj: vatReturn.box1bDubaiAdj || 0,
      box1cSharjahAmount: vatReturn.box1cSharjahAmount || 0,
      box1cSharjahVat: vatReturn.box1cSharjahVat || 0,
      box1cSharjahAdj: vatReturn.box1cSharjahAdj || 0,
      box1dAjmanAmount: vatReturn.box1dAjmanAmount || 0,
      box1dAjmanVat: vatReturn.box1dAjmanVat || 0,
      box1dAjmanAdj: vatReturn.box1dAjmanAdj || 0,
      box1eUmmAlQuwainAmount: vatReturn.box1eUmmAlQuwainAmount || 0,
      box1eUmmAlQuwainVat: vatReturn.box1eUmmAlQuwainVat || 0,
      box1eUmmAlQuwainAdj: vatReturn.box1eUmmAlQuwainAdj || 0,
      box1fRasAlKhaimahAmount: vatReturn.box1fRasAlKhaimahAmount || 0,
      box1fRasAlKhaimahVat: vatReturn.box1fRasAlKhaimahVat || 0,
      box1fRasAlKhaimahAdj: vatReturn.box1fRasAlKhaimahAdj || 0,
      box1gFujairahAmount: vatReturn.box1gFujairahAmount || 0,
      box1gFujairahVat: vatReturn.box1gFujairahVat || 0,
      box1gFujairahAdj: vatReturn.box1gFujairahAdj || 0,
      box2TouristRefundAmount: vatReturn.box2TouristRefundAmount || 0,
      box2TouristRefundVat: vatReturn.box2TouristRefundVat || 0,
      box3ReverseChargeAmount: vatReturn.box3ReverseChargeAmount || 0,
      box3ReverseChargeVat: vatReturn.box3ReverseChargeVat || 0,
      box4ZeroRatedAmount: vatReturn.box4ZeroRatedAmount || 0,
      box5ExemptAmount: vatReturn.box5ExemptAmount || 0,
      box6ImportsAmount: vatReturn.box6ImportsAmount || 0,
      box6ImportsVat: vatReturn.box6ImportsVat || 0,
      box7ImportsAdjAmount: vatReturn.box7ImportsAdjAmount || 0,
      box7ImportsAdjVat: vatReturn.box7ImportsAdjVat || 0,
      box9ExpensesAmount: vatReturn.box9ExpensesAmount || 0,
      box9ExpensesVat: vatReturn.box9ExpensesVat || 0,
      box9ExpensesAdj: vatReturn.box9ExpensesAdj || 0,
      box10ReverseChargeAmount: vatReturn.box10ReverseChargeAmount || 0,
      box10ReverseChargeVat: vatReturn.box10ReverseChargeVat || 0,
    });
    setNotes(vatReturn.notes || '');
    setViewDialogOpen(true);
  };

  const handleEditReturn = (vatReturn: VATReturn) => {
    setSelectedReturn(vatReturn);
    setVatFormData({
      box1aAbuDhabiAmount: vatReturn.box1aAbuDhabiAmount || 0,
      box1aAbuDhabiVat: vatReturn.box1aAbuDhabiVat || 0,
      box1aAbuDhabiAdj: vatReturn.box1aAbuDhabiAdj || 0,
      box1bDubaiAmount: vatReturn.box1bDubaiAmount || 0,
      box1bDubaiVat: vatReturn.box1bDubaiVat || 0,
      box1bDubaiAdj: vatReturn.box1bDubaiAdj || 0,
      box1cSharjahAmount: vatReturn.box1cSharjahAmount || 0,
      box1cSharjahVat: vatReturn.box1cSharjahVat || 0,
      box1cSharjahAdj: vatReturn.box1cSharjahAdj || 0,
      box1dAjmanAmount: vatReturn.box1dAjmanAmount || 0,
      box1dAjmanVat: vatReturn.box1dAjmanVat || 0,
      box1dAjmanAdj: vatReturn.box1dAjmanAdj || 0,
      box1eUmmAlQuwainAmount: vatReturn.box1eUmmAlQuwainAmount || 0,
      box1eUmmAlQuwainVat: vatReturn.box1eUmmAlQuwainVat || 0,
      box1eUmmAlQuwainAdj: vatReturn.box1eUmmAlQuwainAdj || 0,
      box1fRasAlKhaimahAmount: vatReturn.box1fRasAlKhaimahAmount || 0,
      box1fRasAlKhaimahVat: vatReturn.box1fRasAlKhaimahVat || 0,
      box1fRasAlKhaimahAdj: vatReturn.box1fRasAlKhaimahAdj || 0,
      box1gFujairahAmount: vatReturn.box1gFujairahAmount || 0,
      box1gFujairahVat: vatReturn.box1gFujairahVat || 0,
      box1gFujairahAdj: vatReturn.box1gFujairahAdj || 0,
      box2TouristRefundAmount: vatReturn.box2TouristRefundAmount || 0,
      box2TouristRefundVat: vatReturn.box2TouristRefundVat || 0,
      box3ReverseChargeAmount: vatReturn.box3ReverseChargeAmount || 0,
      box3ReverseChargeVat: vatReturn.box3ReverseChargeVat || 0,
      box4ZeroRatedAmount: vatReturn.box4ZeroRatedAmount || 0,
      box5ExemptAmount: vatReturn.box5ExemptAmount || 0,
      box6ImportsAmount: vatReturn.box6ImportsAmount || 0,
      box6ImportsVat: vatReturn.box6ImportsVat || 0,
      box7ImportsAdjAmount: vatReturn.box7ImportsAdjAmount || 0,
      box7ImportsAdjVat: vatReturn.box7ImportsAdjVat || 0,
      box9ExpensesAmount: vatReturn.box9ExpensesAmount || 0,
      box9ExpensesVat: vatReturn.box9ExpensesVat || 0,
      box9ExpensesAdj: vatReturn.box9ExpensesAdj || 0,
      box10ReverseChargeAmount: vatReturn.box10ReverseChargeAmount || 0,
      box10ReverseChargeVat: vatReturn.box10ReverseChargeVat || 0,
    });
    setNotes(vatReturn.notes || '');
    setEditDialogOpen(true);
  };

  const handleSaveReturn = () => {
    if (!selectedReturn) return;
    updateMutation.mutate({
      id: selectedReturn.id,
      data: { ...vatFormData, notes },
    });
  };

  const handleSubmitReturn = () => {
    if (!selectedReturn) return;
    submitMutation.mutate({ id: selectedReturn.id });
  };

  const handleExportPDF = (vatReturn: VATReturn) => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    let y = 15;
    
    const formatNum = (num: number) => num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    
    doc.setFillColor(0, 100, 0);
    doc.rect(0, 0, pageWidth, 25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text('VAT RETURN - VAT 201', pageWidth / 2, 12, { align: 'center' });
    doc.setFontSize(10);
    doc.text('Federal Tax Authority | الهيئة الاتحادية للضرائب', pageWidth / 2, 20, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);
    y = 35;
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('TAXPAYER INFORMATION', margin, y);
    y += 6;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`TRN: ${company?.trnVatNumber || 'N/A'}`, margin, y);
    doc.text(`VAT Period: ${format(parseISO(vatReturn.periodStart), 'dd/MM/yyyy')} - ${format(parseISO(vatReturn.periodEnd), 'dd/MM/yyyy')}`, pageWidth / 2, y);
    y += 5;
    doc.text(`Legal Name: ${company?.name || 'N/A'}`, margin, y);
    doc.text(`Due Date: ${format(parseISO(vatReturn.dueDate), 'dd/MM/yyyy')}`, pageWidth / 2, y);
    y += 5;
    doc.text(`Address: ${company?.address || 'N/A'}`, margin, y);
    y += 8;
    
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, y, pageWidth - 2 * margin, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.text('VAT ON SALES AND ALL OTHER OUTPUTS', margin + 2, y + 5);
    y += 12;
    
    doc.setFont('helvetica', 'normal');
    const salesHeaders = ['Description', 'Amount (AED)', 'VAT (AED)', 'Adjustment'];
    const colWidths = [80, 35, 35, 30];
    let x = margin;
    salesHeaders.forEach((h, i) => {
      doc.text(h, x, y);
      x += colWidths[i];
    });
    y += 4;
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
    
    const emirates = [
      { name: '1a. Abu Dhabi', a: vatReturn.box1aAbuDhabiAmount, v: vatReturn.box1aAbuDhabiVat, adj: vatReturn.box1aAbuDhabiAdj },
      { name: '1b. Dubai', a: vatReturn.box1bDubaiAmount, v: vatReturn.box1bDubaiVat, adj: vatReturn.box1bDubaiAdj },
      { name: '1c. Sharjah', a: vatReturn.box1cSharjahAmount, v: vatReturn.box1cSharjahVat, adj: vatReturn.box1cSharjahAdj },
      { name: '1d. Ajman', a: vatReturn.box1dAjmanAmount, v: vatReturn.box1dAjmanVat, adj: vatReturn.box1dAjmanAdj },
      { name: '1e. Umm Al Quwain', a: vatReturn.box1eUmmAlQuwainAmount, v: vatReturn.box1eUmmAlQuwainVat, adj: vatReturn.box1eUmmAlQuwainAdj },
      { name: '1f. Ras Al Khaimah', a: vatReturn.box1fRasAlKhaimahAmount, v: vatReturn.box1fRasAlKhaimahVat, adj: vatReturn.box1fRasAlKhaimahAdj },
      { name: '1g. Fujairah', a: vatReturn.box1gFujairahAmount, v: vatReturn.box1gFujairahVat, adj: vatReturn.box1gFujairahAdj },
    ];
    
    emirates.forEach(e => {
      x = margin;
      doc.text(e.name, x, y);
      doc.text(formatNum(e.a || 0), x + colWidths[0] + colWidths[1] - 5, y, { align: 'right' });
      doc.text(formatNum(e.v || 0), x + colWidths[0] + colWidths[1] + colWidths[2] - 5, y, { align: 'right' });
      doc.text(formatNum(e.adj || 0), x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] - 5, y, { align: 'right' });
      y += 5;
    });
    
    const otherSales = [
      { name: '2. Tourist Refunds', a: vatReturn.box2TouristRefundAmount, v: vatReturn.box2TouristRefundVat },
      { name: '3. Reverse Charge', a: vatReturn.box3ReverseChargeAmount, v: vatReturn.box3ReverseChargeVat },
      { name: '4. Zero Rated', a: vatReturn.box4ZeroRatedAmount, v: 0 },
      { name: '5. Exempt', a: vatReturn.box5ExemptAmount, v: 0 },
      { name: '6. Imports', a: vatReturn.box6ImportsAmount, v: vatReturn.box6ImportsVat },
      { name: '7. Import Adjustments', a: vatReturn.box7ImportsAdjAmount, v: vatReturn.box7ImportsAdjVat },
    ];
    
    otherSales.forEach(e => {
      x = margin;
      doc.text(e.name, x, y);
      doc.text(formatNum(e.a || 0), x + colWidths[0] + colWidths[1] - 5, y, { align: 'right' });
      if (e.v !== null) doc.text(formatNum(e.v || 0), x + colWidths[0] + colWidths[1] + colWidths[2] - 5, y, { align: 'right' });
      y += 5;
    });
    
    y += 2;
    doc.setFont('helvetica', 'bold');
    doc.setFillColor(230, 230, 230);
    doc.rect(margin, y - 4, pageWidth - 2 * margin, 6, 'F');
    doc.text('8. TOTAL OUTPUT', margin + 2, y);
    doc.text(formatNum(vatReturn.box8TotalAmount || 0), margin + colWidths[0] + colWidths[1] - 5, y, { align: 'right' });
    doc.text(formatNum(vatReturn.box8TotalVat || 0), margin + colWidths[0] + colWidths[1] + colWidths[2] - 5, y, { align: 'right' });
    y += 10;
    
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, y, pageWidth - 2 * margin, 7, 'F');
    doc.text('VAT ON EXPENSES AND ALL OTHER INPUTS', margin + 2, y + 5);
    y += 12;
    
    doc.setFont('helvetica', 'normal');
    x = margin;
    salesHeaders.forEach((h, i) => {
      doc.text(h, x, y);
      x += colWidths[i];
    });
    y += 4;
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
    
    const expenses = [
      { name: '9. Standard Rated Expenses', a: vatReturn.box9ExpensesAmount, v: vatReturn.box9ExpensesVat, adj: vatReturn.box9ExpensesAdj },
      { name: '10. Reverse Charge (Input)', a: vatReturn.box10ReverseChargeAmount, v: vatReturn.box10ReverseChargeVat, adj: 0 },
    ];
    
    expenses.forEach(e => {
      x = margin;
      doc.text(e.name, x, y);
      doc.text(formatNum(e.a || 0), x + colWidths[0] + colWidths[1] - 5, y, { align: 'right' });
      doc.text(formatNum(e.v || 0), x + colWidths[0] + colWidths[1] + colWidths[2] - 5, y, { align: 'right' });
      doc.text(formatNum(e.adj || 0), x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] - 5, y, { align: 'right' });
      y += 5;
    });
    
    y += 2;
    doc.setFont('helvetica', 'bold');
    doc.setFillColor(230, 230, 230);
    doc.rect(margin, y - 4, pageWidth - 2 * margin, 6, 'F');
    doc.text('11. TOTAL INPUT', margin + 2, y);
    doc.text(formatNum(vatReturn.box11TotalAmount || 0), margin + colWidths[0] + colWidths[1] - 5, y, { align: 'right' });
    doc.text(formatNum(vatReturn.box11TotalVat || 0), margin + colWidths[0] + colWidths[1] + colWidths[2] - 5, y, { align: 'right' });
    y += 12;
    
    doc.setFillColor(0, 100, 0);
    doc.rect(margin, y, pageWidth - 2 * margin, 25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    y += 6;
    doc.text('NET VAT DUE', margin + 2, y);
    y += 6;
    doc.text(`12. Total Due Tax: AED ${formatNum(vatReturn.box12TotalDueTax || 0)}`, margin + 5, y);
    y += 5;
    doc.text(`13. Recoverable Tax: AED ${formatNum(vatReturn.box13RecoverableTax || 0)}`, margin + 5, y);
    y += 5;
    doc.setFontSize(12);
    const netTax = vatReturn.box14PayableTax || 0;
    doc.text(`14. ${netTax >= 0 ? 'Payable' : 'Refundable'}: AED ${formatNum(Math.abs(netTax))}`, margin + 5, y);
    
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(7);
    doc.text(`Generated: ${format(new Date(), 'dd/MM/yyyy HH:mm')} | www.tax.gov.ae`, pageWidth / 2, 285, { align: 'center' });
    
    doc.save(`VAT201-${format(parseISO(vatReturn.periodStart), 'yyyy-MM')}.pdf`);
    
    toast({
      title: 'PDF Exported',
      description: 'VAT 201 return has been downloaded.',
    });
  };

  if (isLoadingCompany) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            {locale === 'ar' ? 'إقرار ضريبة القيمة المضافة 201' : 'UAE VAT 201 Return'}
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
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  {locale === 'ar' ? 'رقم التسجيل الضريبي غير مكتمل' : 'Tax Registration Number Missing'}
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
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
              {locale === 'ar' ? 'مقدمة للهيئة' : 'Filed with FTA'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.filed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {locale === 'ar' ? 'إجمالي المستحق' : 'Total Payable'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.totalPayable >= 0 ? 'text-red-600' : 'text-green-600'}`}>
              {formatCurrency(Math.abs(stats.totalPayable))}
            </div>
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
                        {formatCurrency(vatReturn.box12TotalDueTax || vatReturn.box8TotalVat || 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(vatReturn.box13RecoverableTax || vatReturn.box11TotalVat || 0)}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-medium ${(vatReturn.box14PayableTax || 0) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {(vatReturn.box14PayableTax || 0) >= 0 ? '' : '('}{formatCurrency(Math.abs(vatReturn.box14PayableTax || 0))}{(vatReturn.box14PayableTax || 0) >= 0 ? '' : ')'}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(vatReturn.status)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleViewReturn(vatReturn)}
                            data-testid={`button-view-${vatReturn.id}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {(vatReturn.status === 'draft' || vatReturn.status === 'pending_review') && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEditReturn(vatReturn)}
                              data-testid={`button-edit-${vatReturn.id}`}
                            >
                              <Edit3 className="w-4 h-4 mr-1" />
                              {locale === 'ar' ? 'تحرير' : 'Edit'}
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

      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'عرض الإقرار الضريبي' : 'View VAT 201 Return'}</DialogTitle>
            <DialogDescription>
              {selectedReturn && (
                <span>
                  {format(parseISO(selectedReturn.periodStart), 'MMM yyyy')} - {format(parseISO(selectedReturn.periodEnd), 'MMM yyyy')}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedReturn && company && (
            <VAT201Form
              data={vatFormData}
              onChange={() => {}}
              companyInfo={{
                nameEn: company.name,
                nameAr: company.nameAr || undefined,
                trnNumber: company.trnVatNumber || undefined,
                address: company.address || undefined,
                phone: company.phone || undefined,
              }}
              periodInfo={{
                periodStart: format(parseISO(selectedReturn.periodStart), 'dd/MM/yyyy'),
                periodEnd: format(parseISO(selectedReturn.periodEnd), 'dd/MM/yyyy'),
                dueDate: format(parseISO(selectedReturn.dueDate), 'dd/MM/yyyy'),
                taxYearEnd: selectedReturn.taxYearEnd ? format(parseISO(selectedReturn.taxYearEnd), 'dd/MM/yyyy') : undefined,
                vatStagger: selectedReturn.vatStagger || 'Quarterly',
              }}
              readOnly={true}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              {locale === 'ar' ? 'إغلاق' : 'Close'}
            </Button>
            <Button onClick={() => selectedReturn && handleExportPDF(selectedReturn)}>
              <Download className="w-4 h-4 mr-2" />
              {locale === 'ar' ? 'تحميل PDF' : 'Download PDF'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'تحرير الإقرار الضريبي' : 'Edit VAT 201 Return'}</DialogTitle>
            <DialogDescription>
              {selectedReturn && (
                <span>
                  {format(parseISO(selectedReturn.periodStart), 'MMM yyyy')} - {format(parseISO(selectedReturn.periodEnd), 'MMM yyyy')}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedReturn && company && (
            <>
              <VAT201Form
                data={vatFormData}
                onChange={setVatFormData}
                companyInfo={{
                  nameEn: company.name,
                  nameAr: company.nameAr || undefined,
                  trnNumber: company.trnVatNumber || undefined,
                  address: company.address || undefined,
                  phone: company.phone || undefined,
                }}
                periodInfo={{
                  periodStart: format(parseISO(selectedReturn.periodStart), 'dd/MM/yyyy'),
                  periodEnd: format(parseISO(selectedReturn.periodEnd), 'dd/MM/yyyy'),
                  dueDate: format(parseISO(selectedReturn.dueDate), 'dd/MM/yyyy'),
                  taxYearEnd: selectedReturn.taxYearEnd ? format(parseISO(selectedReturn.taxYearEnd), 'dd/MM/yyyy') : undefined,
                  vatStagger: selectedReturn.vatStagger || 'Quarterly',
                }}
                readOnly={false}
              />
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={locale === 'ar' ? 'أضف ملاحظات...' : 'Add notes...'}
                  className="min-h-20"
                />
              </div>
            </>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button 
              variant="secondary" 
              onClick={handleSaveReturn}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {locale === 'ar' ? 'حفظ المسودة' : 'Save Draft'}
            </Button>
            <Button 
              onClick={handleSubmitReturn}
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Send className="w-4 h-4 mr-2" />
              {locale === 'ar' ? 'تقديم للمراجعة' : 'Submit for Filing'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
