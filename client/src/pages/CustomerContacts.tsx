import { useState, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Upload,
  FileSpreadsheet,
  Download,
  Plus,
  Search,
  Loader2,
  Mail,
  Phone,
  Building2,
  MapPin,
  Edit,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Link2,
  Copy,
  ExternalLink,
  MessageCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { VirtualTable, type VirtualTableColumn } from '@/components/VirtualTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import type { CustomerContact } from '@shared/schema';
import * as XLSX from 'xlsx';
import { SiWhatsapp } from 'react-icons/si';
import { WhatsAppComposer } from '@/components/WhatsAppComposer';
import { pickWhatsAppNumber } from '@/lib/whatsapp-templates';
import { EmptyState } from '@/components/ui/empty-state';
import { TableSkeleton } from '@/components/ui/loading-skeletons';

interface ImportResult {
  message: string;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export default function CustomerContacts() {
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('list');
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [importResults, setImportResults] = useState<ImportResult | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [editContact, setEditContact] = useState<CustomerContact | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [portalLinkDialog, setPortalLinkDialog] = useState<{ open: boolean; url: string; contactName: string }>({ open: false, url: '', contactName: '' });
  const [contactToDelete, setContactToDelete] = useState<CustomerContact | null>(null);
  const [composerContact, setComposerContact] = useState<CustomerContact | null>(null);
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);
  const [clearAllConfirmation, setClearAllConfirmation] = useState('');

  const { data: contacts = [], isLoading } = useQuery<CustomerContact[]>({
    queryKey: ['/api/companies', companyId, 'customer-contacts'],
    enabled: !!companyId,
  });

  const importMutation = useMutation({
    mutationFn: async (data: any[]) => {
      const response = await apiRequest('POST', `/api/companies/${companyId}/customer-contacts/import`, { 
        contacts: data 
      });
      return response.json();
    },
    onSuccess: (result: ImportResult) => {
      setImportResults(result);
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'customer-contacts'] });
      toast({ 
        title: 'Import completed!', 
        description: result.message,
      });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Import failed', description: error?.message });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest('POST', `/api/companies/${companyId}/customer-contacts`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'customer-contacts'] });
      setShowAddDialog(false);
      toast({ title: 'Contact created successfully' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to create contact', description: error?.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const response = await apiRequest('PUT', `/api/companies/${companyId}/customer-contacts/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'customer-contacts'] });
      setEditContact(null);
      toast({ title: 'Contact updated successfully' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to update contact', description: error?.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest('DELETE', `/api/companies/${companyId}/customer-contacts/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'customer-contacts'] });
      toast({ title: 'Contact deleted successfully' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to delete contact', description: error?.message });
    },
  });

  const { data: clearPreview } = useQuery<{ contactCount: number; linkedInvoiceCount: number }>({
    queryKey: ['/api/companies', companyId, 'customer-contacts/clear-preview'],
    enabled: !!companyId && showClearAllDialog,
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('DELETE', `/api/companies/${companyId}/customer-contacts/clear-all`, {
        confirm: 'DELETE ALL',
      });
    },
    onSuccess: (result: { deletedCount: number; message: string }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'customer-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'customer-contacts/clear-preview'] });
      setShowClearAllDialog(false);
      setClearAllConfirmation('');
      toast({
        title: 'All contacts cleared',
        description: result.message,
      });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to clear contacts', description: error?.message });
    },
  });

  const portalLinkMutation = useMutation({
    mutationFn: async ({ contactId, contactName }: { contactId: string; contactName: string }) => {
      const result = await apiRequest('POST', '/api/portal/generate-access', { contactId });
      return { ...result, contactName };
    },
    onSuccess: (result: any) => {
      const fullUrl = `${window.location.origin}${result.portalUrl}`;
      setPortalLinkDialog({ open: true, url: fullUrl, contactName: result.contactName });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to generate portal link', description: error?.message });
    },
  });

  const handleFileSelect = useCallback((selectedFile: File) => {
    if (!selectedFile.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast({ 
        variant: 'destructive', 
        title: 'Invalid file type', 
        description: 'Please upload an Excel file (.xlsx, .xls) or CSV file' 
      });
      return;
    }

    setFile(selectedFile);
    setPreviewData(null);
    setImportResults(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        const mappedData = jsonData.map((row: any) => ({
          name: row['Name'] || row['name'] || row['Company Name'] || row['company_name'] || '',
          email: row['Email'] || row['email'] || row['E-mail'] || '',
          phone: row['Phone'] || row['phone'] || row['Phone Number'] || row['Mobile'] || '',
          trnNumber: row['TRN'] || row['trn'] || row['TRN Number'] || row['Tax Registration Number'] || '',
          address: row['Address'] || row['address'] || '',
          city: row['City'] || row['city'] || '',
          country: row['Country'] || row['country'] || 'UAE',
        }));
        
        setPreviewData(mappedData);
        toast({ title: `Found ${mappedData.length} contacts in ${selectedFile.name}` });
      } catch (err: any) {
        toast({ variant: 'destructive', title: 'Failed to parse file', description: err?.message });
      }
    };
    reader.readAsBinaryString(selectedFile);
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleImport = () => {
    if (previewData) {
      importMutation.mutate(previewData);
    }
  };

  const resetImport = () => {
    setFile(null);
    setPreviewData(null);
    setImportResults(null);
  };

  const downloadTemplate = () => {
    const template = [
      {
        'Name': 'Example Company LLC',
        'Email': 'contact@example.com',
        'Phone': '+971-50-123-4567',
        'TRN': '100123456700003',
        'Address': '123 Business Bay',
        'City': 'Dubai',
        'Country': 'UAE'
      }
    ];
    
    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
    XLSX.writeFile(wb, 'contact_import_template.xlsx');
    
    toast({ title: 'Template downloaded' });
  };

  const filteredContacts = contacts.filter(contact => 
    contact.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.phone?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const ContactForm = ({ contact, onSubmit, onCancel }: { 
    contact?: CustomerContact | null; 
    onSubmit: (data: any) => void; 
    onCancel: () => void;
  }) => {
    const [formData, setFormData] = useState({
      name: contact?.name || '',
      email: contact?.email || '',
      phone: contact?.phone || '',
      whatsappNumber: contact?.whatsappNumber || '',
      trnNumber: contact?.trnNumber || '',
      address: contact?.address || '',
      city: contact?.city || '',
      country: contact?.country || 'UAE',
    });

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input 
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Company or contact name"
              data-testid="input-contact-name"
            />
          </div>
          <div className="space-y-2">
            <Label>Email *</Label>
            <Input 
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="email@example.com"
              data-testid="input-contact-email"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="+971-50-XXX-XXXX"
              data-testid="input-contact-phone"
            />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <MessageCircle className="w-3.5 h-3.5 text-green-600" />
              WhatsApp Number
            </Label>
            <Input
              value={formData.whatsappNumber}
              onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
              placeholder="971501234567 (defaults to phone)"
              data-testid="input-contact-whatsapp"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>TRN Number</Label>
            <Input
              value={formData.trnNumber}
              onChange={(e) => setFormData({ ...formData, trnNumber: e.target.value })}
              placeholder="100XXXXXXXXX003"
              data-testid="input-contact-trn"
            />
          </div>
          <div />
        </div>
        <div className="space-y-2">
          <Label>Address</Label>
          <Input 
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            placeholder="Street address"
            data-testid="input-contact-address"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>City</Label>
            <Input 
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              placeholder="Dubai"
              data-testid="input-contact-city"
            />
          </div>
          <div className="space-y-2">
            <Label>Country</Label>
            <Input 
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              placeholder="UAE"
              data-testid="input-contact-country"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} data-testid="button-cancel-contact">
            Cancel
          </Button>
          <Button 
            onClick={() => onSubmit(formData)}
            disabled={!formData.name || !formData.email}
            data-testid="button-save-contact"
          >
            {contact ? 'Update' : 'Create'} Contact
          </Button>
        </DialogFooter>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-contacts-title">Customer Contacts</h1>
          <p className="text-muted-foreground">Manage your customers and business contacts for invoicing</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={downloadTemplate} data-testid="button-download-template">
            <Download className="w-4 h-4 mr-2" />
            Download Template
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setClearAllConfirmation('');
              setShowClearAllDialog(true);
            }}
            disabled={contacts.length === 0}
            data-testid="button-clear-all-contacts"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear All
          </Button>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-contact">
                <Plus className="w-4 h-4 mr-2" />
                Add Contact
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Add New Contact</DialogTitle>
                <DialogDescription>Add a new customer or business contact</DialogDescription>
              </DialogHeader>
              <ContactForm 
                onSubmit={(data) => createMutation.mutate(data)}
                onCancel={() => setShowAddDialog(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="list" data-testid="tab-contacts-list">
            <Building2 className="w-4 h-4 mr-2" />
            Contacts ({contacts.length})
          </TabsTrigger>
          <TabsTrigger value="import" data-testid="tab-contacts-import">
            <Upload className="w-4 h-4 mr-2" />
            Import from Excel
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Search contacts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-contacts"
              />
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4">
                  <TableSkeleton rows={6} columns={6} />
                </div>
              ) : filteredContacts.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title={searchTerm ? 'No matching contacts' : 'No contacts yet'}
                  description={
                    searchTerm
                      ? 'Try a different search term or clear the search.'
                      : 'Add your first contact, or import a list from an Excel/CSV file.'
                  }
                  action={
                    searchTerm
                      ? undefined
                      : {
                          label: 'Add contact',
                          onClick: () => setShowAddDialog(true),
                          testId: 'button-add-first-contact',
                        }
                  }
                  secondaryAction={
                    searchTerm
                      ? { label: 'Clear search', onClick: () => setSearchTerm('') }
                      : { label: 'Import from Excel', onClick: () => setActiveTab('import') }
                  }
                />
              ) : (
                <VirtualTable<CustomerContact>
                  rows={filteredContacts}
                  height={500}
                  estimateRowHeight={56}
                  getRowId={(contact) => contact.id}
                  rowTestId={(contact) => `row-contact-${contact.id}`}
                  columns={[
                    {
                      key: 'name',
                      header: 'Name',
                      cell: (contact) => (
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{contact.name}</span>
                        </div>
                      ),
                    },
                    {
                      key: 'email',
                      header: 'Email',
                      cell: (contact) => (
                        <div className="flex items-center gap-2 truncate">
                          <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="truncate">{contact.email}</span>
                        </div>
                      ),
                    },
                    {
                      key: 'phone',
                      header: 'Phone',
                      cell: (contact) =>
                        contact.phone ? (
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-muted-foreground" />
                            {contact.phone}
                          </div>
                        ) : null,
                    },
                    {
                      key: 'trn',
                      header: 'TRN',
                      cell: (contact) =>
                        contact.trnNumber ? (
                          <Badge variant="outline">{contact.trnNumber}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        ),
                    },
                    {
                      key: 'location',
                      header: 'Location',
                      cell: (contact) =>
                        (contact.city || contact.country) ? (
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-muted-foreground" />
                            {[contact.city, contact.country].filter(Boolean).join(', ')}
                          </div>
                        ) : null,
                    },
                    {
                      key: 'actions',
                      header: 'Actions',
                      width: '170px',
                      cell: (contact) => (
                        <div className="flex items-center gap-1">
                          {pickWhatsAppNumber(contact) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Send via WhatsApp"
                              className="text-green-600 hover:text-green-700"
                              onClick={() => setComposerContact(contact)}
                              data-testid={`button-whatsapp-contact-${contact.id}`}
                            >
                              <SiWhatsapp className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Generate Portal Link"
                            onClick={() => portalLinkMutation.mutate({ contactId: contact.id, contactName: contact.name })}
                            disabled={portalLinkMutation.isPending}
                            data-testid={`button-portal-link-${contact.id}`}
                          >
                            <Link2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setEditContact(contact)}
                            data-testid={`button-edit-contact-${contact.id}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setContactToDelete(contact)}
                            data-testid={`button-delete-contact-${contact.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ),
                    },
                  ]}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import" className="space-y-4">
          {!importResults ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileSpreadsheet className="w-5 h-5" />
                    Upload Excel File
                  </CardTitle>
                  <CardDescription>
                    Upload an Excel file (.xlsx, .xls) or CSV containing your customer contacts.
                    We'll automatically map common column names like "Name", "Email", "Phone", "TRN", etc.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div
                    className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                      isDragOver 
                        ? 'border-primary bg-primary/5' 
                        : 'border-muted-foreground/25 hover:border-primary/50'
                    }`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    data-testid="dropzone-file-upload"
                  >
                    {file ? (
                      <div className="flex flex-col items-center gap-3">
                        <FileSpreadsheet className="w-10 h-10 text-green-500" />
                        <p className="font-medium">{file.name}</p>
                        <Button variant="outline" size="sm" onClick={resetImport}>
                          Choose Different File
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <Upload className="w-10 h-10 text-muted-foreground" />
                        <div>
                          <p className="font-medium">Drop your Excel file here</p>
                          <p className="text-sm text-muted-foreground">or click to browse</p>
                        </div>
                        <input
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                          data-testid="input-file-upload"
                        />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {previewData && previewData.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Preview ({previewData.length} contacts)</CardTitle>
                    <CardDescription>
                      Review the data before importing. Contacts with matching emails will be updated.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Phone</TableHead>
                            <TableHead>TRN</TableHead>
                            <TableHead>City</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewData.slice(0, 20).map((row, idx) => (
                            <TableRow key={idx}>
                              <TableCell className={!row.name ? 'text-destructive' : ''}>
                                {row.name || 'Missing'}
                              </TableCell>
                              <TableCell className={!row.email ? 'text-destructive' : ''}>
                                {row.email || 'Missing'}
                              </TableCell>
                              <TableCell>{row.phone || '-'}</TableCell>
                              <TableCell>{row.trnNumber || '-'}</TableCell>
                              <TableCell>{row.city || '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {previewData.length > 20 && (
                        <p className="text-center text-sm text-muted-foreground py-2">
                          ... and {previewData.length - 20} more contacts
                        </p>
                      )}
                    </ScrollArea>

                    <div className="flex justify-end gap-2 mt-4">
                      <Button variant="outline" onClick={resetImport} data-testid="button-cancel-import">
                        Cancel
                      </Button>
                      <Button 
                        onClick={handleImport} 
                        disabled={importMutation.isPending}
                        data-testid="button-confirm-import"
                      >
                        {importMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Importing...
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4 mr-2" />
                            Import {previewData.length} Contacts
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  Import Complete
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-green-500/10 rounded-lg">
                    <p className="text-2xl font-bold text-green-600">{importResults.created}</p>
                    <p className="text-sm text-muted-foreground">Created</p>
                  </div>
                  <div className="text-center p-4 bg-blue-500/10 rounded-lg">
                    <p className="text-2xl font-bold text-blue-600">{importResults.updated}</p>
                    <p className="text-sm text-muted-foreground">Updated</p>
                  </div>
                  <div className="text-center p-4 bg-yellow-500/10 rounded-lg">
                    <p className="text-2xl font-bold text-yellow-600">{importResults.skipped}</p>
                    <p className="text-sm text-muted-foreground">Skipped</p>
                  </div>
                </div>

                {importResults.errors.length > 0 && (
                  <div className="border border-destructive/50 rounded-lg p-4">
                    <p className="font-medium text-destructive flex items-center gap-2 mb-2">
                      <AlertCircle className="w-4 h-4" />
                      {importResults.errors.length} Errors
                    </p>
                    <ScrollArea className="h-[100px]">
                      <ul className="text-sm space-y-1">
                        {importResults.errors.map((err, idx) => (
                          <li key={idx} className="text-muted-foreground">{err}</li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => {
                    resetImport();
                    setActiveTab('list');
                  }} data-testid="button-view-contacts">
                    View Contacts
                  </Button>
                  <Button onClick={resetImport} data-testid="button-import-more">
                    Import More
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!editContact} onOpenChange={(open) => !open && setEditContact(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Contact</DialogTitle>
            <DialogDescription>Update customer contact information</DialogDescription>
          </DialogHeader>
          {editContact && (
            <ContactForm
              contact={editContact}
              onSubmit={(data) => updateMutation.mutate({ id: editContact.id, data })}
              onCancel={() => setEditContact(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Portal Link Dialog */}
      <Dialog open={portalLinkDialog.open} onOpenChange={(open) => !open && setPortalLinkDialog({ open: false, url: '', contactName: '' })}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5" />
              Client Portal Link
            </DialogTitle>
            <DialogDescription>
              Share this link with {portalLinkDialog.contactName} to give them access to view their invoices and download PDFs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={portalLinkDialog.url}
                className="font-mono text-sm"
                data-testid="input-portal-link"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(portalLinkDialog.url);
                  toast({ title: 'Link copied to clipboard' });
                }}
                data-testid="button-copy-portal-link"
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => window.open(portalLinkDialog.url, '_blank')}
                data-testid="button-open-portal"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Open Portal
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  const message = encodeURIComponent(`Here is your client portal link to view invoices and statements:\n${portalLinkDialog.url}`);
                  window.open(`https://wa.me/?text=${message}`, '_blank');
                }}
                data-testid="button-send-whatsapp"
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                Send via WhatsApp
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This link is valid for 1 year. The client can view invoices and download PDFs without needing to log in.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <WhatsAppComposer
        open={!!composerContact}
        onOpenChange={(open) => { if (!open) setComposerContact(null); }}
        recipient={composerContact ? {
          name: composerContact.name,
          phone: composerContact.phone,
          whatsappNumber: composerContact.whatsappNumber,
        } : null}
        defaultTemplateId="general_reminder"
      />

      <AlertDialog
        open={showClearAllDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowClearAllDialog(false);
            setClearAllConfirmation('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              Delete ALL contacts?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  This will permanently delete{' '}
                  <strong>
                    {clearPreview?.contactCount ?? contacts.length} contact
                    {(clearPreview?.contactCount ?? contacts.length) === 1 ? '' : 's'}
                  </strong>{' '}
                  for this company. This action cannot be undone.
                </p>
                {clearPreview && clearPreview.linkedInvoiceCount > 0 && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3">
                    <p className="font-medium text-destructive">
                      {clearPreview.linkedInvoiceCount} invoice
                      {clearPreview.linkedInvoiceCount === 1 ? ' is' : 's are'} linked to these contacts.
                    </p>
                    <p className="text-muted-foreground mt-1">
                      Invoices will be kept, but their customer link will be cleared. You may need to relink
                      them after re-importing your client list.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="clear-all-confirm">
                    Type <strong>DELETE ALL</strong> to confirm:
                  </Label>
                  <Input
                    id="clear-all-confirm"
                    value={clearAllConfirmation}
                    onChange={(e) => setClearAllConfirmation(e.target.value)}
                    placeholder="DELETE ALL"
                    autoComplete="off"
                    data-testid="input-clear-all-confirm"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear-all">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                clearAllMutation.mutate();
              }}
              disabled={clearAllConfirmation !== 'DELETE ALL' || clearAllMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-clear-all"
            >
              {clearAllMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete all contacts'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!contactToDelete} onOpenChange={(open) => { if (!open) setContactToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{contactToDelete?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (contactToDelete) {
                  deleteMutation.mutate(contactToDelete.id);
                  setContactToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
