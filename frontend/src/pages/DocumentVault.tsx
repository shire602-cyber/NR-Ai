import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { format, differenceInDays, parseISO } from 'date-fns';
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
import { 
  Upload, 
  FileText, 
  Download, 
  Trash2, 
  Search, 
  AlertTriangle,
  Clock,
  CheckCircle2,
  FolderOpen,
  Calendar,
  Loader2,
  Plus,
  Eye,
  Filter
} from 'lucide-react';

interface Document {
  id: string;
  companyId: string;
  name: string;
  nameAr: string | null;
  category: string;
  description: string | null;
  fileUrl: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  expiryDate: string | null;
  reminderDays: number;
  reminderSent: boolean;
  tags: string | null;
  isArchived: boolean;
  uploadedBy: string | null;
  createdAt: string;
}

const DOCUMENT_CATEGORIES = [
  { value: 'invoice', labelEn: 'Invoice', labelAr: 'فاتورة' },
  { value: 'bill', labelEn: 'Bill/Expense', labelAr: 'فاتورة مصروفات' },
  { value: 'receipt', labelEn: 'Receipt', labelAr: 'إيصال' },
  { value: 'quote', labelEn: 'Quote/Quotation', labelAr: 'عرض سعر' },
  { value: 'purchase_order', labelEn: 'Purchase Order', labelAr: 'أمر شراء' },
  { value: 'trade_license', labelEn: 'Trade License', labelAr: 'الرخصة التجارية' },
  { value: 'contract', labelEn: 'Contract', labelAr: 'عقد' },
  { value: 'tax_certificate', labelEn: 'Tax Certificate', labelAr: 'شهادة ضريبية' },
  { value: 'audit_report', labelEn: 'Audit Report', labelAr: 'تقرير التدقيق' },
  { value: 'bank_statement', labelEn: 'Bank Statement', labelAr: 'كشف حساب بنكي' },
  { value: 'insurance', labelEn: 'Insurance', labelAr: 'تأمين' },
  { value: 'visa', labelEn: 'Visa/Emirates ID', labelAr: 'تأشيرة/هوية إماراتية' },
  { value: 'vat_return', labelEn: 'VAT Return', labelAr: 'إقرار ضريبة القيمة المضافة' },
  { value: 'other', labelEn: 'Other', labelAr: 'أخرى' },
];

export default function DocumentVault() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [newDocument, setNewDocument] = useState({
    name: '',
    nameAr: '',
    category: 'other',
    description: '',
    expiryDate: '',
    reminderDays: 30,
  });

  const { data: documents, isLoading } = useQuery<Document[]>({
    queryKey: ['/api/companies', companyId, 'documents'],
    enabled: !!companyId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      nameAr: string;
      category: string;
      description: string;
      expiryDate: string;
      reminderDays: number;
      fileName: string;
      fileSize: number;
      mimeType: string;
    }) => {
      return apiRequest('POST', `/api/companies/${companyId}/documents`, {
        ...data,
        fileUrl: `/uploads/${data.fileName}`, // Placeholder - in production would be cloud storage URL
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'documents'] });
      toast({
        title: locale === 'ar' ? 'تم الرفع بنجاح' : 'Upload Successful',
        description: locale === 'ar' ? 'تم حفظ المستند' : 'Document has been saved',
      });
      setUploadDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: locale === 'ar' ? 'فشل الرفع' : 'Upload Failed',
        description: error.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => 
      apiRequest('DELETE', `/api/documents/${documentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'documents'] });
      toast({
        title: locale === 'ar' ? 'تم الحذف' : 'Deleted',
        description: locale === 'ar' ? 'تم حذف المستند' : 'Document has been deleted',
      });
    },
  });

  const resetForm = () => {
    setNewDocument({
      name: '',
      nameAr: '',
      category: 'other',
      description: '',
      expiryDate: '',
      reminderDays: 30,
    });
    setSelectedFile(null);
  };

  const handleUpload = async () => {
    if (!newDocument.name) {
      toast({
        variant: 'destructive',
        title: locale === 'ar' ? 'معلومات ناقصة' : 'Missing Information',
        description: locale === 'ar' ? 'يرجى إدخال اسم المستند' : 'Please enter document name',
      });
      return;
    }

    setIsUploading(true);
    try {
      await uploadMutation.mutateAsync({
        name: newDocument.name,
        nameAr: newDocument.nameAr,
        category: newDocument.category,
        description: newDocument.description,
        expiryDate: newDocument.expiryDate,
        reminderDays: newDocument.reminderDays,
        fileName: selectedFile?.name || 'document.pdf',
        fileSize: selectedFile?.size || 0,
        mimeType: selectedFile?.type || 'application/pdf',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const getExpiryStatus = (expiryDate: string | null) => {
    if (!expiryDate) return null;
    const days = differenceInDays(parseISO(expiryDate), new Date());
    if (days < 0) return { status: 'expired', color: 'destructive', days: Math.abs(days) };
    if (days <= 30) return { status: 'expiring_soon', color: 'warning', days };
    return { status: 'valid', color: 'default', days };
  };

  const filteredDocuments = documents?.filter(doc => {
    if (doc.isArchived) return false;
    if (categoryFilter !== 'all' && doc.category !== categoryFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return doc.name.toLowerCase().includes(query) || 
             doc.fileName.toLowerCase().includes(query) ||
             doc.description?.toLowerCase().includes(query);
    }
    return true;
  }) || [];

  const expiringDocs = documents?.filter(doc => {
    if (!doc.expiryDate || doc.isArchived) return false;
    const days = differenceInDays(parseISO(doc.expiryDate), new Date());
    return days >= 0 && days <= 30;
  }) || [];

  const expiredDocs = documents?.filter(doc => {
    if (!doc.expiryDate || doc.isArchived) return false;
    return differenceInDays(parseISO(doc.expiryDate), new Date()) < 0;
  }) || [];

  if (isLoadingCompany || isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
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
            {locale === 'ar' ? 'خزنة المستندات' : 'Document Vault'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'ar' 
              ? 'قم بتخزين وإدارة مستنداتك المهمة مع تنبيهات انتهاء الصلاحية'
              : 'Store and manage your important documents with expiry alerts'}
          </p>
        </div>
        <Button onClick={() => setUploadDialogOpen(true)} data-testid="button-upload-document">
          <Plus className="w-4 h-4 mr-2" />
          {locale === 'ar' ? 'رفع مستند' : 'Upload Document'}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'ar' ? 'إجمالي المستندات' : 'Total Documents'}
            </CardTitle>
            <FolderOpen className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{documents?.length || 0}</div>
          </CardContent>
        </Card>

        <Card className={expiringDocs.length > 0 ? 'border-yellow-500' : ''}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'ar' ? 'تنتهي قريباً' : 'Expiring Soon'}
            </CardTitle>
            <Clock className="w-4 h-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{expiringDocs.length}</div>
            <p className="text-xs text-muted-foreground">
              {locale === 'ar' ? 'خلال 30 يوم' : 'Within 30 days'}
            </p>
          </CardContent>
        </Card>

        <Card className={expiredDocs.length > 0 ? 'border-red-500' : ''}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'ar' ? 'منتهية الصلاحية' : 'Expired'}
            </CardTitle>
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{expiredDocs.length}</div>
            <p className="text-xs text-muted-foreground">
              {locale === 'ar' ? 'تحتاج إلى تجديد' : 'Need renewal'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder={locale === 'ar' ? 'بحث في المستندات...' : 'Search documents...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-documents"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-category-filter">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder={locale === 'ar' ? 'تصفية حسب الفئة' : 'Filter by category'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{locale === 'ar' ? 'جميع الفئات' : 'All Categories'}</SelectItem>
                {DOCUMENT_CATEGORIES.map(cat => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {locale === 'ar' ? cat.labelAr : cat.labelEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filteredDocuments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{locale === 'ar' ? 'لا توجد مستندات' : 'No documents found'}</p>
              <Button variant="link" onClick={() => setUploadDialogOpen(true)}>
                {locale === 'ar' ? 'رفع أول مستند' : 'Upload your first document'}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{locale === 'ar' ? 'اسم المستند' : 'Document Name'}</TableHead>
                    <TableHead>{locale === 'ar' ? 'الفئة' : 'Category'}</TableHead>
                    <TableHead>{locale === 'ar' ? 'تاريخ الانتهاء' : 'Expiry Date'}</TableHead>
                    <TableHead>{locale === 'ar' ? 'الحالة' : 'Status'}</TableHead>
                    <TableHead>{locale === 'ar' ? 'تاريخ الرفع' : 'Upload Date'}</TableHead>
                    <TableHead className="text-right">{locale === 'ar' ? 'إجراءات' : 'Actions'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDocuments.map((doc) => {
                    const expiryStatus = getExpiryStatus(doc.expiryDate);
                    const category = DOCUMENT_CATEGORIES.find(c => c.value === doc.category);
                    
                    return (
                      <TableRow key={doc.id} data-testid={`row-document-${doc.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <div className="font-medium">{locale === 'ar' && doc.nameAr ? doc.nameAr : doc.name}</div>
                              <div className="text-xs text-muted-foreground">{doc.fileName}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {locale === 'ar' ? category?.labelAr : category?.labelEn}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {doc.expiryDate ? (
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {format(parseISO(doc.expiryDate), 'dd MMM yyyy')}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {expiryStatus ? (
                            <Badge variant={expiryStatus.status === 'expired' ? 'destructive' : expiryStatus.status === 'expiring_soon' ? 'secondary' : 'default'}>
                              {expiryStatus.status === 'expired' && (
                                <>{locale === 'ar' ? `منتهي منذ ${expiryStatus.days} يوم` : `Expired ${expiryStatus.days}d ago`}</>
                              )}
                              {expiryStatus.status === 'expiring_soon' && (
                                <>{locale === 'ar' ? `ينتهي خلال ${expiryStatus.days} يوم` : `Expires in ${expiryStatus.days}d`}</>
                              )}
                              {expiryStatus.status === 'valid' && (
                                <><CheckCircle2 className="w-3 h-3 mr-1" />{locale === 'ar' ? 'صالح' : 'Valid'}</>
                              )}
                            </Badge>
                          ) : (
                            <Badge variant="outline">{locale === 'ar' ? 'بدون انتهاء' : 'No Expiry'}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {format(parseISO(doc.createdAt), 'dd MMM yyyy')}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => window.open(doc.fileUrl, '_blank')}
                              data-testid={`button-view-${doc.id}`}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                const link = document.createElement('a');
                                link.href = doc.fileUrl;
                                link.download = doc.fileName;
                                link.click();
                              }}
                              data-testid={`button-download-${doc.id}`}
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => {
                                if (confirm(locale === 'ar' ? 'هل أنت متأكد من حذف هذا المستند؟' : 'Are you sure you want to delete this document?')) {
                                  deleteMutation.mutate(doc.id);
                                }
                              }}
                              data-testid={`button-delete-${doc.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
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

      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'رفع مستند جديد' : 'Upload New Document'}</DialogTitle>
            <DialogDescription>
              {locale === 'ar' 
                ? 'ارفع مستنداً مهماً مثل الرخصة التجارية أو العقود'
                : 'Upload an important document like trade license or contracts'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'اسم المستند (إنجليزي)' : 'Document Name (English)'}</Label>
                <Input
                  value={newDocument.name}
                  onChange={(e) => setNewDocument({ ...newDocument, name: e.target.value })}
                  placeholder="Trade License 2025"
                  data-testid="input-document-name"
                />
              </div>
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'اسم المستند (عربي)' : 'Document Name (Arabic)'}</Label>
                <Input
                  value={newDocument.nameAr}
                  onChange={(e) => setNewDocument({ ...newDocument, nameAr: e.target.value })}
                  placeholder="الرخصة التجارية 2025"
                  dir="rtl"
                  data-testid="input-document-name-ar"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{locale === 'ar' ? 'الفئة' : 'Category'}</Label>
              <Select 
                value={newDocument.category} 
                onValueChange={(val) => setNewDocument({ ...newDocument, category: val })}
              >
                <SelectTrigger data-testid="select-document-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_CATEGORIES.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {locale === 'ar' ? cat.labelAr : cat.labelEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{locale === 'ar' ? 'الوصف (اختياري)' : 'Description (Optional)'}</Label>
              <Textarea
                value={newDocument.description}
                onChange={(e) => setNewDocument({ ...newDocument, description: e.target.value })}
                placeholder={locale === 'ar' ? 'أضف ملاحظات حول هذا المستند...' : 'Add notes about this document...'}
                data-testid="input-document-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'تاريخ الانتهاء (اختياري)' : 'Expiry Date (Optional)'}</Label>
                <Input
                  type="date"
                  value={newDocument.expiryDate}
                  onChange={(e) => setNewDocument({ ...newDocument, expiryDate: e.target.value })}
                  data-testid="input-expiry-date"
                />
              </div>
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'تذكير قبل (أيام)' : 'Remind Before (Days)'}</Label>
                <Input
                  type="number"
                  value={newDocument.reminderDays}
                  onChange={(e) => setNewDocument({ ...newDocument, reminderDays: parseInt(e.target.value) || 30 })}
                  min="1"
                  max="365"
                  data-testid="input-reminder-days"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{locale === 'ar' ? 'الملف' : 'File'}</Label>
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                data-testid="input-document-file"
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground">
                  {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUploadDialogOpen(false); resetForm(); }}>
              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button onClick={handleUpload} disabled={isUploading} data-testid="button-confirm-upload">
              {isUploading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {locale === 'ar' ? 'رفع' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
