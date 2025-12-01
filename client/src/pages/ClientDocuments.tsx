import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams, Link } from 'wouter';
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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
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
  Filter,
  ArrowLeft
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

interface Company {
  id: string;
  name: string;
}

const DOCUMENT_CATEGORIES = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'bill', label: 'Bill/Expense' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'quote', label: 'Quote/Quotation' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'trade_license', label: 'Trade License' },
  { value: 'contract', label: 'Contract' },
  { value: 'tax_certificate', label: 'Tax Certificate' },
  { value: 'audit_report', label: 'Audit Report' },
  { value: 'bank_statement', label: 'Bank Statement' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'visa', label: 'Visa/Emirates ID' },
  { value: 'vat_return', label: 'VAT Return' },
  { value: 'other', label: 'Other' },
];

export default function ClientDocuments() {
  const { id: clientId } = useParams<{ id: string }>();
  const { toast } = useToast();
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

  const { data: clientData } = useQuery<{ company: Company }>({
    queryKey: [`/api/admin/clients/${clientId}`],
    enabled: !!clientId,
  });
  const company = clientData?.company;

  const { data: documents, isLoading } = useQuery<Document[]>({
    queryKey: [`/api/companies/${clientId}/documents`],
    enabled: !!clientId,
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
      return apiRequest('POST', `/api/companies/${clientId}/documents`, {
        ...data,
        fileUrl: `/uploads/${data.fileName}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${clientId}/documents`] });
      toast({
        title: 'Upload Successful',
        description: 'Document has been saved',
      });
      setUploadDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Upload Failed',
        description: error.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => 
      apiRequest('DELETE', `/api/documents/${documentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${clientId}/documents`] });
      toast({
        title: 'Deleted',
        description: 'Document has been deleted',
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
        title: 'Missing Information',
        description: 'Please enter document name',
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

  if (isLoading) {
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
        <div className="flex items-center gap-4">
          <Link href="/admin/clients">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">
              Documents - {company?.name || 'Client'}
            </h1>
            <p className="text-muted-foreground">
              Manage documents for this client
            </p>
          </div>
        </div>
        <Button onClick={() => setUploadDialogOpen(true)} data-testid="button-upload-document">
          <Plus className="w-4 h-4 mr-2" />
          Upload Document
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Documents</CardTitle>
            <FolderOpen className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{documents?.length || 0}</div>
          </CardContent>
        </Card>

        <Card className={expiringDocs.length > 0 ? 'border-yellow-500' : ''}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
            <Clock className="w-4 h-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{expiringDocs.length}</div>
            <p className="text-xs text-muted-foreground">Within 30 days</p>
          </CardContent>
        </Card>

        <Card className={expiredDocs.length > 0 ? 'border-red-500' : ''}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expired</CardTitle>
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{expiredDocs.length}</div>
            <p className="text-xs text-muted-foreground">Need renewal</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-documents"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-category-filter">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {DOCUMENT_CATEGORIES.map(cat => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
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
              <p>No documents found</p>
              <Button variant="ghost" onClick={() => setUploadDialogOpen(true)}>
                Upload first document
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Expiry Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Upload Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
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
                              <div className="font-medium">{doc.name}</div>
                              <div className="text-xs text-muted-foreground">{doc.fileName}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{category?.label}</Badge>
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
                              {expiryStatus.status === 'expired' && `Expired ${expiryStatus.days}d ago`}
                              {expiryStatus.status === 'expiring_soon' && `Expires in ${expiryStatus.days}d`}
                              {expiryStatus.status === 'valid' && (
                                <><CheckCircle2 className="w-3 h-3 mr-1" />Valid</>
                              )}
                            </Badge>
                          ) : (
                            <Badge variant="outline">No Expiry</Badge>
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
                                if (confirm('Are you sure you want to delete this document?')) {
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
            <DialogTitle>Upload New Document</DialogTitle>
            <DialogDescription>
              Upload an important document like trade license or contracts
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Document Name (English)</Label>
                <Input
                  value={newDocument.name}
                  onChange={(e) => setNewDocument({ ...newDocument, name: e.target.value })}
                  placeholder="Trade License 2025"
                  data-testid="input-document-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Document Name (Arabic)</Label>
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
              <Label>Category</Label>
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
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Description (Optional)</Label>
              <Textarea
                value={newDocument.description}
                onChange={(e) => setNewDocument({ ...newDocument, description: e.target.value })}
                placeholder="Add notes about this document..."
                data-testid="input-document-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Expiry Date (Optional)</Label>
                <Input
                  type="date"
                  value={newDocument.expiryDate}
                  onChange={(e) => setNewDocument({ ...newDocument, expiryDate: e.target.value })}
                  data-testid="input-expiry-date"
                />
              </div>
              <div className="space-y-2">
                <Label>Remind Before (Days)</Label>
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
              <Label>File</Label>
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                data-testid="input-document-file"
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground">
                  Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUploadDialogOpen(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={isUploading} data-testid="button-submit-upload">
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}