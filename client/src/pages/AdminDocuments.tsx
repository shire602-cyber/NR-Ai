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
  FolderOpen,
  Calendar,
  Loader2,
  Plus,
  Eye,
  Filter,
  Building2,
  FileUp
} from 'lucide-react';

interface Company {
  id: string;
  nameEn: string;
  nameAr: string | null;
  trnNumber: string | null;
}

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
  { value: 'invoice', labelEn: 'Invoice' },
  { value: 'bill', labelEn: 'Bill/Expense' },
  { value: 'receipt', labelEn: 'Receipt' },
  { value: 'quote', labelEn: 'Quote/Quotation' },
  { value: 'purchase_order', labelEn: 'Purchase Order' },
  { value: 'trade_license', labelEn: 'Trade License' },
  { value: 'contract', labelEn: 'Contract' },
  { value: 'tax_certificate', labelEn: 'Tax Certificate' },
  { value: 'audit_report', labelEn: 'Audit Report' },
  { value: 'bank_statement', labelEn: 'Bank Statement' },
  { value: 'insurance', labelEn: 'Insurance' },
  { value: 'visa', labelEn: 'Visa/Emirates ID' },
  { value: 'vat_return', labelEn: 'VAT Return' },
  { value: 'other', labelEn: 'Other' },
];

export default function AdminDocuments() {
  const { toast } = useToast();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [newDocument, setNewDocument] = useState({
    name: '',
    nameAr: '',
    category: 'invoice',
    description: '',
    expiryDate: '',
    reminderDays: 30,
  });

  const { data: companies, isLoading: isLoadingCompanies } = useQuery<Company[]>({
    queryKey: ['/api/admin/companies'],
  });

  const { data: documents, isLoading: isLoadingDocs } = useQuery<Document[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'documents'],
    enabled: !!selectedCompanyId,
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
      return apiRequest('POST', `/api/companies/${selectedCompanyId}/documents`, {
        ...data,
        fileUrl: `/uploads/${data.fileName}`,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'documents'] });
      toast({
        title: 'Upload Successful',
        description: 'Document has been saved for the client',
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
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'documents'] });
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
      category: 'invoice',
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

    if (!selectedCompanyId) {
      toast({
        variant: 'destructive',
        title: 'Select Client',
        description: 'Please select a client first',
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
    if (days < 0) return { status: 'expired', color: 'destructive' as const, days: Math.abs(days) };
    if (days <= 30) return { status: 'expiring_soon', color: 'secondary' as const, days };
    return { status: 'valid', color: 'default' as const, days };
  };

  const getCategoryLabel = (category: string) => {
    const cat = DOCUMENT_CATEGORIES.find(c => c.value === category);
    return cat?.labelEn || category;
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

  const selectedCompany = companies?.find(c => c.id === selectedCompanyId);

  if (isLoadingCompanies) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-admin-documents-title">
            Client Document Management
          </h1>
          <p className="text-muted-foreground">
            Upload and manage invoices, bills, and documents for your clients
          </p>
        </div>
        <Button 
          onClick={() => setUploadDialogOpen(true)} 
          disabled={!selectedCompanyId}
          data-testid="button-upload-client-document"
        >
          <Plus className="w-4 h-4 mr-2" />
          Upload Document
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Select Client
          </CardTitle>
          <CardDescription>
            Choose a client to view or upload documents for them
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
            <SelectTrigger className="w-full md:w-[400px]" data-testid="select-client-company">
              <SelectValue placeholder="Select a client company..." />
            </SelectTrigger>
            <SelectContent>
              {companies?.map(company => (
                <SelectItem key={company.id} value={company.id}>
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    <span>{company.nameEn}</span>
                    {company.trnNumber && (
                      <span className="text-muted-foreground text-xs">
                        (TRN: {company.trnNumber})
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedCompanyId && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Documents</CardTitle>
                <FolderOpen className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{documents?.length || 0}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Invoices</CardTitle>
                <FileText className="w-4 h-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">
                  {documents?.filter(d => d.category === 'invoice').length || 0}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Bills/Expenses</CardTitle>
                <FileUp className="w-4 h-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">
                  {documents?.filter(d => d.category === 'bill').length || 0}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
                <Clock className="w-4 h-4 text-yellow-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">
                  {documents?.filter(doc => {
                    if (!doc.expiryDate || doc.isArchived) return false;
                    const days = differenceInDays(parseISO(doc.expiryDate), new Date());
                    return days >= 0 && days <= 30;
                  }).length || 0}
                </div>
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
                    data-testid="input-search-client-documents"
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
                        {cat.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingDocs ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
                </div>
              ) : filteredDocuments.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No documents found for {selectedCompany?.nameEn}</p>
                  <Button variant="link" onClick={() => setUploadDialogOpen(true)}>
                    Upload a document
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Document Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>File</TableHead>
                        <TableHead>Expiry</TableHead>
                        <TableHead>Uploaded</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredDocuments.map((doc) => {
                        const expiryStatus = getExpiryStatus(doc.expiryDate);
                        return (
                          <TableRow key={doc.id} data-testid={`row-document-${doc.id}`}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <FileText className="w-4 h-4 text-muted-foreground" />
                                <div>
                                  <div className="font-medium">{doc.name}</div>
                                  {doc.description && (
                                    <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                      {doc.description}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {getCategoryLabel(doc.category)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <div className="truncate max-w-[150px]">{doc.fileName}</div>
                                {doc.fileSize && (
                                  <div className="text-xs text-muted-foreground">
                                    {(doc.fileSize / 1024).toFixed(1)} KB
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {expiryStatus ? (
                                <div className="flex items-center gap-2">
                                  {expiryStatus.status === 'expired' && (
                                    <AlertTriangle className="w-4 h-4 text-red-500" />
                                  )}
                                  {expiryStatus.status === 'expiring_soon' && (
                                    <Clock className="w-4 h-4 text-yellow-500" />
                                  )}
                                  <Badge variant={expiryStatus.color}>
                                    {expiryStatus.status === 'expired' 
                                      ? `Expired ${expiryStatus.days}d ago`
                                      : expiryStatus.status === 'expiring_soon'
                                      ? `${expiryStatus.days}d left`
                                      : format(parseISO(doc.expiryDate!), 'MMM d, yyyy')}
                                  </Badge>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="text-sm text-muted-foreground">
                                {format(parseISO(doc.createdAt), 'MMM d, yyyy')}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button size="icon" variant="ghost" data-testid={`button-view-${doc.id}`}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button size="icon" variant="ghost" data-testid={`button-download-${doc.id}`}>
                                  <Download className="w-4 h-4" />
                                </Button>
                                <Button 
                                  size="icon" 
                                  variant="ghost" 
                                  onClick={() => deleteMutation.mutate(doc.id)}
                                  data-testid={`button-delete-${doc.id}`}
                                >
                                  <Trash2 className="w-4 h-4 text-red-500" />
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
        </>
      )}

      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload Document for {selectedCompany?.nameEn}
            </DialogTitle>
            <DialogDescription>
              Add an invoice, bill, or other document for this client
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Document Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., Invoice #001"
                  value={newDocument.name}
                  onChange={(e) => setNewDocument({ ...newDocument, name: e.target.value })}
                  data-testid="input-document-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category *</Label>
                <Select 
                  value={newDocument.category} 
                  onValueChange={(value) => setNewDocument({ ...newDocument, category: value })}
                >
                  <SelectTrigger data-testid="select-document-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_CATEGORIES.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Brief description of this document..."
                value={newDocument.description}
                onChange={(e) => setNewDocument({ ...newDocument, description: e.target.value })}
                rows={2}
                data-testid="input-document-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="expiryDate">Expiry Date (if applicable)</Label>
                <Input
                  id="expiryDate"
                  type="date"
                  value={newDocument.expiryDate}
                  onChange={(e) => setNewDocument({ ...newDocument, expiryDate: e.target.value })}
                  data-testid="input-expiry-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reminderDays">Remind Before (days)</Label>
                <Input
                  id="reminderDays"
                  type="number"
                  min="1"
                  max="365"
                  value={newDocument.reminderDays}
                  onChange={(e) => setNewDocument({ ...newDocument, reminderDays: parseInt(e.target.value) || 30 })}
                  data-testid="input-reminder-days"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Upload File</Label>
              <div className="border-2 border-dashed rounded-lg p-6 text-center">
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  data-testid="input-file-upload"
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-2 text-primary">
                      <FileText className="w-8 h-8" />
                      <div>
                        <p className="font-medium">{selectedFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(selectedFile.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-muted-foreground">
                      <Upload className="w-8 h-8 mx-auto mb-2" />
                      <p>Click to upload or drag and drop</p>
                      <p className="text-xs">PDF, DOC, XLS, JPG, PNG (max 10MB)</p>
                    </div>
                  )}
                </label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleUpload} 
              disabled={isUploading || !newDocument.name}
              data-testid="button-submit-upload"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Document
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
