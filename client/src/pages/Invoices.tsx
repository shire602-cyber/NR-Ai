import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, isWithinInterval, parseISO, startOfDay, endOfDay } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency, formatDate } from '@/lib/format';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { DateRangeFilter, type DateRange } from '@/components/DateRangeFilter';
import { EmptyState } from '@/components/ui/empty-state';
import { TableSkeleton } from '@/components/ui/loading-skeletons';
import { exportToExcel, exportToGoogleSheets, prepareInvoicesForExport } from '@/lib/export';
import { Plus, FileText, FileCode, CalendarIcon, Trash2, Download, Edit, Palette, Save, Info, XCircle, AlertCircle, FileSpreadsheet, Send, DollarSign, RefreshCw, RotateCcw } from 'lucide-react';
import { SiGooglesheets, SiWhatsapp } from 'react-icons/si';
import type { Invoice, Company, CustomerContact, InvoicePayment } from '@shared/schema';
import { MESSAGE_TEMPLATES, fillTemplate, pickWhatsAppNumber } from '@/lib/whatsapp-templates';
import { WhatsAppComposer } from '@/components/WhatsAppComposer';
import { cn } from '@/lib/utils';
import { downloadInvoicePDF } from '@/lib/pdf-invoice';

const invoiceLineSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  quantity: z.coerce.number().min(0.01, 'Quantity must be positive'),
  unitPrice: z.coerce.number().min(0, 'Price must be positive'),
  vatRate: z.coerce.number().default(0.05),
});

const invoiceSchema = z.object({
  companyId: z.string().uuid(),
  number: z.string().min(1, 'Invoice number is required'),
  customerName: z.string().min(1, 'Customer name is required'),
  customerTrn: z.string().optional(),
  date: z.date(),
  currency: z.string().default('AED'),
  lines: z.array(invoiceLineSchema).min(1, 'At least one line item is required'),
});

const invoiceBrandingSchema = z.object({
  invoiceShowLogo: z.boolean().default(true),
  invoiceShowAddress: z.boolean().default(true),
  invoiceShowPhone: z.boolean().default(true),
  invoiceShowEmail: z.boolean().default(true),
  invoiceShowWebsite: z.boolean().default(false),
  invoiceCustomTitle: z.string().transform(val => val || undefined).optional(),
  invoiceFooterNote: z.string().transform(val => val || undefined).optional(),
});

type InvoiceFormData = z.infer<typeof invoiceSchema>;
type InvoiceBrandingFormData = z.infer<typeof invoiceBrandingSchema>;

export default function Invoices() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { company, companyId: selectedCompanyId } = useDefaultCompany();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [activeTab, setActiveTab] = useState('invoices');
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [invoiceForPayment, setInvoiceForPayment] = useState<Invoice | null>(null);
  const [selectedPaymentAccount, setSelectedPaymentAccount] = useState<string>('');
  const [similarWarningOpen, setSimilarWarningOpen] = useState(false);
  const [similarInvoices, setSimilarInvoices] = useState<any[]>([]);
  const [pendingInvoiceData, setPendingInvoiceData] = useState<any>(null);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [isExporting, setIsExporting] = useState(false);

  // Virtual scrolling for large invoice lists.
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // Recurring invoice dialog state
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);
  const [invoiceForRecurring, setInvoiceForRecurring] = useState<Invoice | null>(null);
  const [recurringEnabled, setRecurringEnabled] = useState(false);
  const [recurringInterval, setRecurringInterval] = useState('monthly');
  const [recurringNextDate, setRecurringNextDate] = useState<Date | undefined>(undefined);
  const [recurringEndDate, setRecurringEndDate] = useState<Date | undefined>(undefined);

  // Payment tracking dialog state
  const [addPaymentDialogOpen, setAddPaymentDialogOpen] = useState(false);
  const [viewPaymentsDialogOpen, setViewPaymentsDialogOpen] = useState(false);
  const [invoiceForPaymentDetail, setInvoiceForPaymentDetail] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentAccountForAdd, setPaymentAccountForAdd] = useState('');
  const [invoicePayments, setInvoicePayments] = useState<InvoicePayment[]>([]);

  // WhatsApp composer state. We open this with a pre-filled message rather
  // than redirecting to wa.me directly, so the user can review/edit before
  // sending — important when share links are baked into the body.
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerRecipient, setComposerRecipient] = useState<{ name?: string | null; phone?: string | null; whatsappNumber?: string | null } | null>(null);
  const [composerMessage, setComposerMessage] = useState('');

  const { data: invoices, isLoading } = useQuery<Invoice[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'invoices'],
    enabled: !!selectedCompanyId,
  });

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'accounts'],
    enabled: !!selectedCompanyId,
  });

  const { data: customers = [] } = useQuery<CustomerContact[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'customer-contacts'],
    queryFn: () => apiRequest('GET', `/api/companies/${selectedCompanyId}/customer-contacts`),
    enabled: !!selectedCompanyId,
  });

  const form = useForm<InvoiceFormData>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      companyId: selectedCompanyId || '',
      number: `INV-${Date.now()}`,
      customerName: '',
      customerTrn: '',
      date: new Date(),
      currency: 'AED',
      lines: [{ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    },
  });

  // Update form's companyId when selectedCompanyId changes
  useEffect(() => {
    if (selectedCompanyId) {
      form.setValue('companyId', selectedCompanyId);
    }
  }, [selectedCompanyId, form]);

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'lines',
  });

  const createMutation = useMutation({
    mutationFn: (data: InvoiceFormData) => 
      apiRequest('POST', `/api/companies/${selectedCompanyId}/invoices`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'invoices'] });
      toast({
        title: 'Invoice created',
        description: 'Your invoice has been created with VAT calculation.',
      });
      setDialogOpen(false);
      setEditingInvoice(null);
      form.reset({
        companyId: selectedCompanyId,
        number: `INV-${Date.now()}`,
        customerName: '',
        customerTrn: '',
        date: new Date(),
        currency: 'AED',
        lines: [{ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 }],
      });
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to create invoice',
        description: error?.message || 'Please try again.',
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: InvoiceFormData }) => 
      apiRequest('PUT', `/api/invoices/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'invoices'] });
      toast({
        title: 'Invoice updated successfully',
        description: 'Your invoice has been updated.',
      });
      setDialogOpen(false);
      setEditingInvoice(null);
      form.reset({
        companyId: selectedCompanyId,
        number: `INV-${Date.now()}`,
        customerName: '',
        customerTrn: '',
        date: new Date(),
        currency: 'AED',
        lines: [{ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 }],
      });
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to update invoice',
        description: error?.message || 'Please try again.',
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status, paymentAccountId }: { id: string; status: string; paymentAccountId?: string }) =>
      apiRequest('PATCH', `/api/invoices/${id}/status`, { status, paymentAccountId }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['/api/companies', selectedCompanyId, 'invoices'] });
      const previous = queryClient.getQueryData<Invoice[]>(['/api/companies', selectedCompanyId, 'invoices']);
      queryClient.setQueryData<Invoice[]>(
        ['/api/companies', selectedCompanyId, 'invoices'],
        (old) => old?.map((inv) => inv.id === id ? { ...inv, status: status as any } : inv) ?? []
      );
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'invoices'] });
      toast({
        title: 'Status updated',
        description: 'Invoice status has been updated successfully.',
      });
      setPaymentDialogOpen(false);
      setInvoiceForPayment(null);
      setSelectedPaymentAccount('');
    },
    onError: (error: any, _vars, context: any) => {
      if (context?.previous) {
        queryClient.setQueryData(['/api/companies', selectedCompanyId, 'invoices'], context.previous);
      }
      toast({
        variant: 'destructive',
        title: 'Failed to update status',
        description: error?.message || 'Please try again.',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/invoices/${id}`),
    onMutate: async (id: string) => {
      const queryKey = ['/api/companies', selectedCompanyId, 'invoices'] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Invoice[]>(queryKey);
      queryClient.setQueryData<Invoice[]>(queryKey, (old) => old?.filter((inv) => inv.id !== id) ?? []);
      return { previous, queryKey };
    },
    onSuccess: () => {
      toast({
        title: t.invoiceDeleted,
        description: t.invoiceDeletedDesc,
      });
    },
    onError: (error: any, _id, context: any) => {
      if (context?.previous && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      toast({
        variant: 'destructive',
        title: t.deleteFailed,
        description: error?.message || t.tryAgain,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'invoices'] });
    },
  });

  const checkSimilarMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest('POST', `/api/companies/${selectedCompanyId}/invoices/check-similar`, data),
  });

  const setRecurringMutation = useMutation({
    mutationFn: ({ invoiceId, data }: { invoiceId: string; data: any }) =>
      apiRequest('POST', `/api/companies/${selectedCompanyId}/invoices/${invoiceId}/set-recurring`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'invoices'] });
      toast({ title: 'Recurring settings saved' });
      setRecurringDialogOpen(false);
      setInvoiceForRecurring(null);
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to save recurring settings', description: error?.message });
    },
  });

  const addPaymentMutation = useMutation({
    mutationFn: ({ invoiceId, data }: { invoiceId: string; data: any }) =>
      apiRequest('POST', `/api/companies/${selectedCompanyId}/invoices/${invoiceId}/payments`, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'invoices'] });
      toast({ title: 'Payment recorded', description: `Status updated to ${result.status}` });
      setAddPaymentDialogOpen(false);
      setInvoiceForPaymentDetail(null);
      setPaymentAmount('');
      setPaymentReference('');
      setPaymentNotes('');
      setPaymentAccountForAdd('');
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to record payment', description: error?.message });
    },
  });

  const createCreditNoteMutation = useMutation({
    mutationFn: (invoiceId: string) =>
      apiRequest('POST', `/api/companies/${selectedCompanyId}/invoices/${invoiceId}/credit-note`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'invoices'] });
      toast({ title: 'Credit note created', description: 'A credit note has been created and the journal entry reversed.' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to create credit note', description: error?.message });
    },
  });

  const handleStatusChange = (invoice: Invoice, newStatus: string) => {
    if (newStatus === 'paid' && invoice.status !== 'paid') {
      // Show payment account selection dialog
      setInvoiceForPayment(invoice);
      setPaymentDialogOpen(true);
    } else {
      // For other status changes, proceed directly
      updateStatusMutation.mutate({ id: invoice.id, status: newStatus });
    }
  };

  const handleConfirmPayment = () => {
    if (!selectedPaymentAccount || !invoiceForPayment) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please select a payment account.',
      });
      return;
    }
    updateStatusMutation.mutate({ 
      id: invoiceForPayment.id, 
      status: 'paid',
      paymentAccountId: selectedPaymentAccount 
    });
  };

  // Get cash and bank accounts for payment selection
  const paymentAccounts = accounts.filter(acc => {
    const name = (acc.nameEn || '').toLowerCase();
    const nameAr = (acc.nameAr || '').toLowerCase();
    return (
      acc.type === 'asset' && (
        name.includes('bank') || 
        name.includes('cash') || 
        name.includes('cheque') ||
        nameAr.includes('بنك') ||
        nameAr.includes('نقد') ||
        nameAr.includes('شيك')
      )
    );
  });

  const handleEditInvoice = async (invoice: Invoice) => {
    try {
      const fullInvoice = await apiRequest('GET', `/api/invoices/${invoice.id}`);
      setEditingInvoice(fullInvoice);
      form.reset({
        companyId: fullInvoice.companyId,
        number: fullInvoice.number,
        customerName: fullInvoice.customerName,
        customerTrn: fullInvoice.customerTrn || '',
        date: new Date(fullInvoice.date),
        currency: fullInvoice.currency,
        lines: fullInvoice.lines || [{ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 }],
      });
      setDialogOpen(true);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error?.message || 'Failed to load invoice details.',
      });
    }
  };

  const resetForm = () => {
    form.reset({
      companyId: selectedCompanyId,
      number: `INV-${Date.now()}`,
      customerName: '',
      customerTrn: '',
      date: new Date(),
      currency: 'AED',
      lines: [{ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    });
    setEditingInvoice(null);
  };

  const onSubmit = async (data: InvoiceFormData) => {
    try {
      const invoiceData = {
        ...data,
        companyId: selectedCompanyId!,
        lines: fields.map(line => ({
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          vatRate: Number(line.vatRate),
        })),
      };

      // Proceed with save directly - similar check removed for better UX
      await performInvoiceSave(invoiceData, editingInvoice);
    } catch (error) {
      // Error is handled by mutation callbacks
    }
  };

  const performInvoiceSave = async (invoiceData: any, editing: any) => {
    if (editing) {
      await editMutation.mutateAsync({ id: editing.id, data: invoiceData });
    } else {
      await createMutation.mutateAsync(invoiceData);
    }

    setDialogOpen(false);
    resetForm();
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400';
      case 'partial': return 'bg-teal-100 text-teal-700 dark:bg-teal-900/20 dark:text-teal-400';
      case 'sent': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400';
      case 'void': return 'bg-gray-100 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400';
      default: return 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400';
    }
  };

  // Calculate totals for preview
  const watchLines = form.watch('lines');
  const subtotal = watchLines.reduce((sum, line) => sum + (line.quantity * line.unitPrice), 0);
  const vatAmount = watchLines.reduce((sum, line) => sum + (line.quantity * line.unitPrice * line.vatRate), 0);
  const total = subtotal + vatAmount;

  // Invoice Branding Form
  const brandingForm = useForm<InvoiceBrandingFormData>({
    resolver: zodResolver(invoiceBrandingSchema),
    defaultValues: {
      invoiceShowLogo: true,
      invoiceShowAddress: true,
      invoiceShowPhone: true,
      invoiceShowEmail: true,
      invoiceShowWebsite: false,
      invoiceCustomTitle: '',
      invoiceFooterNote: '',
    },
  });

  // Load company branding settings into form
  useEffect(() => {
    if (company) {
      brandingForm.reset({
        invoiceShowLogo: company.invoiceShowLogo ?? true,
        invoiceShowAddress: company.invoiceShowAddress ?? true,
        invoiceShowPhone: company.invoiceShowPhone ?? true,
        invoiceShowEmail: company.invoiceShowEmail ?? true,
        invoiceShowWebsite: company.invoiceShowWebsite ?? false,
        invoiceCustomTitle: company.invoiceCustomTitle || '',
        invoiceFooterNote: company.invoiceFooterNote || '',
      });
    }
  }, [company, brandingForm]);

  const updateBrandingMutation = useMutation({
    mutationFn: (data: InvoiceBrandingFormData) => {
      return apiRequest('PATCH', `/api/companies/${selectedCompanyId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId] });
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
      toast({
        title: 'Invoice branding updated',
        description: 'Your invoice customization settings have been saved successfully.',
      });
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to update branding',
        description: error?.message || 'Please try again.',
      });
    },
  });

  const onBrandingSubmit = (data: InvoiceBrandingFormData) => {
    updateBrandingMutation.mutate(data);
  };

  const isVATRegistered = company?.trnVatNumber && company?.trnVatNumber.length > 0;

  const filteredInvoices = useMemo(() => {
    if (!invoices || invoices.length === 0) return [];
    if (!dateRange.from && !dateRange.to) return invoices;
    
    const fromDate = dateRange.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange.to ? endOfDay(dateRange.to) : null;
    
    return invoices.filter(invoice => {
      if (!invoice.date) return false;
      
      const invoiceDate = typeof invoice.date === 'string' 
        ? parseISO(invoice.date) 
        : new Date(invoice.date);
      
      if (fromDate && toDate) {
        return isWithinInterval(invoiceDate, { start: fromDate, end: toDate });
      }
      if (fromDate) {
        return invoiceDate >= fromDate;
      }
      if (toDate) {
        return invoiceDate <= toDate;
      }
      return true;
    });
  }, [invoices, dateRange.from, dateRange.to]);

  const handleExportExcel = () => {
    if (!filteredInvoices.length) {
      toast({ variant: 'destructive', title: 'No data', description: 'No invoices to export' });
      return;
    }
    
    const dateRangeStr = dateRange.from && dateRange.to 
      ? `_${format(dateRange.from, 'yyyy-MM-dd')}_to_${format(dateRange.to, 'yyyy-MM-dd')}`
      : '';
    
    exportToExcel([prepareInvoicesForExport(filteredInvoices, locale)], `invoices${dateRangeStr}`);
    toast({ title: 'Export successful', description: `${filteredInvoices.length} invoices exported to Excel` });
  };

  const handleExportGoogleSheets = async () => {
    if (!selectedCompanyId || !filteredInvoices.length) {
      toast({ variant: 'destructive', title: 'No data', description: 'No invoices to export' });
      return;
    }
    
    setIsExporting(true);
    const dateRangeStr = dateRange.from && dateRange.to 
      ? ` (${format(dateRange.from, 'MMM dd, yyyy')} - ${format(dateRange.to, 'MMM dd, yyyy')})`
      : '';

    const result = await exportToGoogleSheets(
      [prepareInvoicesForExport(filteredInvoices, locale)],
      `Invoices${dateRangeStr}`,
      selectedCompanyId
    );

    setIsExporting(false);

    if (result.success) {
      toast({ 
        title: 'Export successful', 
        description: `${filteredInvoices.length} invoices exported to Google Sheets` 
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, '_blank');
      }
    } else {
      toast({ 
        variant: 'destructive',
        title: 'Export failed', 
        description: result.error || 'Failed to export to Google Sheets' 
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold mb-2">{t.invoices}</h1>
        <p className="text-muted-foreground">Manage invoices and customize their appearance</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="invoices" data-testid="tab-invoices">
            <FileText className="w-4 h-4 mr-2" />
            Invoices
          </TabsTrigger>
          <TabsTrigger value="branding" data-testid="tab-branding">
            <Palette className="w-4 h-4 mr-2" />
            Invoice Branding
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-6 mt-0">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-sm font-medium">Filter by date:</span>
                  <DateRangeFilter 
                    dateRange={dateRange} 
                    onDateRangeChange={setDateRange} 
                  />
                </div>
                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" disabled={isExporting} data-testid="button-export-invoices">
                        <Download className="w-4 h-4 mr-2" />
                        {isExporting ? 'Exporting...' : t.export}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleExportExcel} data-testid="menu-export-invoices-excel">
                        <FileSpreadsheet className="w-4 h-4 mr-2" />
                        Export to Excel
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleExportGoogleSheets} data-testid="menu-export-invoices-sheets">
                        <SiGooglesheets className="w-4 h-4 mr-2" />
                        Export to Google Sheets
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end flex-wrap gap-4">
            <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingInvoice(null);
            form.reset({
              companyId: selectedCompanyId,
              number: `INV-${Date.now()}`,
              customerName: '',
              customerTrn: '',
              date: new Date(),
              currency: 'AED',
              lines: [{ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 }],
            });
          }
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-invoice">
              <Plus className="w-4 h-4 mr-2" />
              {t.newInvoice}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingInvoice ? 'Edit Invoice' : t.newInvoice}</DialogTitle>
              <DialogDescription>
                {editingInvoice ? 'Update invoice details' : 'Create a new invoice with automatic VAT calculation'}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.invoiceNumber}</FormLabel>
                        <FormControl>
                          <Input {...field} className="font-mono" data-testid="input-invoice-number" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.date}</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  'w-full justify-start text-left font-normal',
                                  !field.value && 'text-muted-foreground'
                                )}
                                data-testid="button-date-picker"
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0">
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={field.onChange}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="customerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.customerName}</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-customer-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="customerTrn"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.customerTRN}</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Optional" className="font-mono" data-testid="input-customer-trn" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Line Items</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => append({ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 })}
                      data-testid="button-add-line"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {t.addLine}
                    </Button>
                  </div>

                  {fields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-12 gap-2 items-start p-3 border rounded-md">
                      <div className="col-span-4">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.description`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input {...field} placeholder={t.description} data-testid={`input-line-description-${index}`} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-1.5">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.quantity`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input 
                                  type="number" 
                                  step="0.01" 
                                  placeholder="Qty" 
                                  className="font-mono"
                                  value={field.value ?? ''} 
                                  onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : '')}
                                  data-testid={`input-line-quantity-${index}`} 
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-1.5">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.unitPrice`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input 
                                  type="number" 
                                  step="0.01" 
                                  placeholder="Price" 
                                  className="font-mono"
                                  value={field.value ?? ''} 
                                  onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : '')}
                                  data-testid={`input-line-price-${index}`} 
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-1.5">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.vatRate`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Select value={String(field.value * 100)} onValueChange={(val) => field.onChange(parseFloat(val) / 100)}>
                                  <SelectTrigger className="font-mono" data-testid={`select-line-vat-${index}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="0">0%</SelectItem>
                                    <SelectItem value="5">5%</SelectItem>
                                    <SelectItem value="10">10%</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-2">
                        <div className="h-10 flex items-center justify-end font-mono text-sm">
                          {formatCurrency((watchLines[index]?.quantity || 0) * (watchLines[index]?.unitPrice || 0) * (1 + (watchLines[index]?.vatRate || 0)), 'AED', locale)}
                        </div>
                      </div>
                      <div className="col-span-1 flex items-center justify-center">
                        {fields.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => remove(index)}
                            data-testid={`button-remove-line-${index}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t.subtotal}</span>
                    <span className="font-mono font-medium">{formatCurrency(subtotal, 'AED', locale)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {t.vat} ({watchLines.some(line => line.vatRate !== 0) ? `avg ${Math.round(watchLines.reduce((sum, line) => sum + line.vatRate, 0) / Math.max(1, watchLines.filter(l => l.vatRate > 0).length) * 100)}%` : '0%'})
                    </span>
                    <span className="font-mono font-medium">{formatCurrency(vatAmount, 'AED', locale)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-semibold pt-2 border-t">
                    <span>{t.total}</span>
                    <span className="font-mono">{formatCurrency(total, 'AED', locale)}</span>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="flex-1">
                    {t.cancel}
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending || editMutation.isPending || checkSimilarMutation.isPending} className="flex-1" data-testid="button-submit-invoice">
                    {(createMutation.isPending || editMutation.isPending || checkSimilarMutation.isPending) ? t.loading : t.save}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <TableSkeleton rows={8} columns={6} />
      ) : (
        <Card>
          <div
            ref={tableScrollRef}
            className={cn(
              'overflow-auto',
              filteredInvoices && filteredInvoices.length > 100 && 'max-h-[720px]',
            )}
            style={filteredInvoices && filteredInvoices.length > 100 ? { contain: 'strict' } : undefined}
          >
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="font-semibold">{t.invoiceNumber}</TableHead>
                  <TableHead className="font-semibold">{t.customerName}</TableHead>
                  <TableHead className="font-semibold">{t.date}</TableHead>
                  <TableHead className="font-semibold text-right">{t.total}</TableHead>
                  <TableHead className="font-semibold text-center">{t.status}</TableHead>
                  <TableHead className="font-semibold text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <VirtualizedInvoiceRows
                invoices={filteredInvoices || []}
                scrollRef={tableScrollRef}
                renderRow={(invoice) => (
                    <TableRow key={invoice.id} data-testid={`invoice-row-${invoice.id}`}>
                      <TableCell className="font-mono font-medium">{invoice.number}</TableCell>
                      <TableCell>{invoice.customerName}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(invoice.date, locale)}</TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatCurrency(invoice.total, invoice.currency, locale)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Select
                          value={invoice.status}
                          onValueChange={(newStatus) => handleStatusChange(invoice, newStatus)}
                          disabled={updateStatusMutation.isPending}
                        >
                          <SelectTrigger 
                            className={cn("w-32 border-0", getStatusBadgeColor(invoice.status))}
                            data-testid={`select-status-${invoice.id}`}
                          >
                            <SelectValue>
                              {t[invoice.status as keyof typeof t]}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft" data-testid={`status-option-draft-${invoice.id}`}>
                              {t.draft}
                            </SelectItem>
                            <SelectItem value="sent" data-testid={`status-option-sent-${invoice.id}`}>
                              {t.sent}
                            </SelectItem>
                            <SelectItem value="paid" data-testid={`status-option-paid-${invoice.id}`}>
                              {t.paid}
                            </SelectItem>
                            <SelectItem value="partial" data-testid={`status-option-partial-${invoice.id}`}>
                              Partial
                            </SelectItem>
                            <SelectItem value="void" data-testid={`status-option-void-${invoice.id}`}>
                              {t.void}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {(invoice as any).einvoiceStatus && (
                          <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 bg-blue-50 text-blue-700 border-blue-200">
                            E
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditInvoice(invoice)}
                            data-testid={`button-edit-invoice-${invoice.id}`}
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                            try {
                              // Fetch full invoice details with lines using apiRequest
                              const invoiceDetails = await apiRequest('GET', `/api/invoices/${invoice.id}`);

                              // Check if company is VAT registered
                              const isVATRegistered = !!(company?.trnVatNumber && company.trnVatNumber.length > 0);

                              await downloadInvoicePDF({
                                invoiceNumber: invoiceDetails.number,
                                date: invoiceDetails.date.toString(),
                                customerName: invoiceDetails.customerName,
                                customerTRN: invoiceDetails.customerTrn || undefined,
                                companyName: company?.name || 'Your Company',
                                companyTRN: company?.trnVatNumber || undefined,
                                companyAddress: company?.businessAddress || undefined,
                                companyPhone: company?.contactPhone || undefined,
                                companyEmail: company?.contactEmail || undefined,
                                companyWebsite: company?.websiteUrl || undefined,
                                companyLogo: company?.logoUrl || undefined,
                                lines: invoiceDetails.lines || [],
                                subtotal: invoiceDetails.subtotal,
                                vatAmount: invoiceDetails.vatAmount,
                                total: invoiceDetails.total,
                                currency: invoiceDetails.currency,
                                locale,
                                // Invoice customization settings
                                showLogo: company?.invoiceShowLogo !== undefined ? company.invoiceShowLogo : true,
                                showAddress: company?.invoiceShowAddress !== undefined ? company.invoiceShowAddress : true,
                                showPhone: company?.invoiceShowPhone !== undefined ? company.invoiceShowPhone : true,
                                showEmail: company?.invoiceShowEmail !== undefined ? company.invoiceShowEmail : true,
                                showWebsite: company?.invoiceShowWebsite === true ? true : undefined,
                                customTitle: company?.invoiceCustomTitle || undefined,
                                footerNote: company?.invoiceFooterNote || undefined,
                                isVATRegistered,
                              });

                              toast({
                                title: 'PDF Downloaded',
                                description: 'Invoice PDF has been downloaded successfully',
                              });
                            } catch (error: any) {
                              toast({
                                title: 'Error',
                                description: error?.message || 'Failed to generate PDF',
                                variant: 'destructive',
                              });
                            }
                            }}
                            data-testid={`button-download-pdf-${invoice.id}`}
                          >
                            <Download className="w-4 h-4 mr-2" />
                            PDF
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-green-600 hover:text-green-700"
                            title="Send via WhatsApp"
                            onClick={async () => {
                              try {
                                const customer = customers.find(c => c.name === invoice.customerName);
                                const recipientNumber = customer ? pickWhatsAppNumber(customer) : null;
                                if (!customer || !recipientNumber) {
                                  toast({
                                    title: 'No WhatsApp number',
                                    description: `No phone or WhatsApp number found for ${invoice.customerName}. Add one in Customer Contacts.`,
                                    variant: 'destructive',
                                  });
                                  return;
                                }

                                const shareResult = await apiRequest('POST', `/api/invoices/${invoice.id}/share`);
                                const shareUrl = `${window.location.origin}${shareResult.shareUrl}`;

                                const invoiceDate = new Date(invoice.date);
                                const paymentTerms = customer.paymentTerms || 30;
                                const dueDate = new Date(invoiceDate);
                                dueDate.setDate(dueDate.getDate() + paymentTerms);

                                const tpl = MESSAGE_TEMPLATES.find(t => t.id === 'invoice_with_link');
                                const templateStr = locale === 'en' ? (tpl?.template || '') : (tpl?.templateAr || '');
                                const message = fillTemplate(templateStr, {
                                  customer_name: invoice.customerName,
                                  invoice_number: invoice.number,
                                  amount: `${invoice.currency} ${invoice.total.toFixed(2)}`,
                                  due_date: dueDate.toLocaleDateString(locale === 'en' ? 'en-AE' : 'ar-AE'),
                                  link: shareUrl,
                                  company_name: company?.name || '',
                                });

                                setComposerRecipient({
                                  name: customer.name,
                                  phone: customer.phone,
                                  whatsappNumber: customer.whatsappNumber,
                                });
                                setComposerMessage(message);
                                setComposerOpen(true);

                                // Mark drafts as sent — opening composer is intent enough.
                                if (invoice.status === 'draft') {
                                  apiRequest('PATCH', `/api/invoices/${invoice.id}/status`, { status: 'sent' })
                                    .then(() => queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'invoices'] }))
                                    .catch(() => {});
                                }
                              } catch (error: any) {
                                toast({
                                  title: 'Error',
                                  description: error?.message || 'Failed to prepare WhatsApp message',
                                  variant: 'destructive',
                                });
                              }
                            }}
                            data-testid={`button-whatsapp-invoice-${invoice.id}`}
                          >
                            <SiWhatsapp className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              try {
                                const result = await apiRequest('POST', `/api/invoices/${invoice.id}/generate-einvoice`);
                                toast({ title: 'E-Invoice generated', description: `UUID: ${result.uuid}` });
                                queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'invoices'] });
                              } catch (error: any) {
                                toast({ title: 'Error', description: error?.message, variant: 'destructive' });
                              }
                            }}
                            title="Generate E-Invoice"
                            data-testid={`button-einvoice-${invoice.id}`}
                          >
                            <FileCode className="w-4 h-4 text-blue-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Add Payment"
                            onClick={() => {
                              setInvoiceForPaymentDetail(invoice);
                              setPaymentAmount('');
                              setPaymentAccountForAdd('');
                              setPaymentMethod('bank');
                              setPaymentReference('');
                              setPaymentNotes('');
                              setAddPaymentDialogOpen(true);
                            }}
                            data-testid={`button-add-payment-${invoice.id}`}
                          >
                            <DollarSign className="w-4 h-4 text-green-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="View Payments"
                            onClick={async () => {
                              setInvoiceForPaymentDetail(invoice);
                              try {
                                const payments = await apiRequest('GET', `/api/companies/${selectedCompanyId}/invoices/${invoice.id}/payments`);
                                setInvoicePayments(payments);
                                setViewPaymentsDialogOpen(true);
                              } catch (e: any) {
                                toast({ variant: 'destructive', title: 'Error', description: e?.message });
                              }
                            }}
                            data-testid={`button-view-payments-${invoice.id}`}
                          >
                            <FileText className="w-4 h-4 text-blue-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Set Recurring"
                            onClick={() => {
                              setInvoiceForRecurring(invoice);
                              setRecurringEnabled((invoice as any).isRecurring || false);
                              setRecurringInterval((invoice as any).recurringInterval || 'monthly');
                              const next = (invoice as any).nextRecurringDate;
                              setRecurringNextDate(next ? new Date(next) : undefined);
                              const end = (invoice as any).recurringEndDate;
                              setRecurringEndDate(end ? new Date(end) : undefined);
                              setRecurringDialogOpen(true);
                            }}
                            data-testid={`button-set-recurring-${invoice.id}`}
                          >
                            <RefreshCw className={`w-4 h-4 ${(invoice as any).isRecurring ? 'text-purple-500' : 'text-muted-foreground'}`} />
                          </Button>
                          {(invoice as any).invoiceType !== 'credit_note' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Create Credit Note"
                              onClick={() => {
                                if (window.confirm(`Create a credit note for Invoice ${invoice.number}? This will reverse the journal entry.`)) {
                                  createCreditNoteMutation.mutate(invoice.id);
                                }
                              }}
                              disabled={createCreditNoteMutation.isPending}
                              data-testid={`button-credit-note-${invoice.id}`}
                            >
                              <RotateCcw className="w-4 h-4 text-orange-500" />
                            </Button>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={deleteMutation.isPending}
                                data-testid={`button-delete-invoice-${invoice.id}`}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Invoice {invoice.number}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete this invoice. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(invoice.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                emptyState={
                  <TableBody>
                    <TableRow>
                      <TableCell colSpan={6} className="p-0">
                        <EmptyState
                          icon={FileText}
                          title={dateRange.from || dateRange.to ? 'No invoices in this date range' : 'No invoices yet'}
                          description={
                            dateRange.from || dateRange.to
                              ? 'Try widening the date filter or clearing it to see all invoices.'
                              : 'Create your first invoice — VAT, sequential numbering, and PDFs are handled automatically.'
                          }
                          action={
                            !dateRange.from && !dateRange.to
                              ? {
                                  label: 'New invoice',
                                  icon: Plus,
                                  onClick: () => setDialogOpen(true),
                                  testId: 'button-create-first-invoice',
                                }
                              : undefined
                          }
                          secondaryAction={
                            dateRange.from || dateRange.to
                              ? {
                                  label: 'Clear filter',
                                  onClick: () => setDateRange({ from: undefined, to: undefined }),
                                }
                              : undefined
                          }
                          testId="empty-state-invoices"
                        />
                      </TableCell>
                    </TableRow>
                  </TableBody>
                }
              />
            </Table>
          </div>
        </Card>
      )}
        </TabsContent>

        <TabsContent value="branding" className="space-y-6 mt-0">
          {isLoading ? (
            <Skeleton className="h-96" />
          ) : !company ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Company not found</p>
            </div>
          ) : (
            <div className="space-y-6 max-w-3xl">
              {isVATRegistered && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Your company is VAT registered. All invoices will automatically display your TRN ({company.trnVatNumber}) 
                    and be labeled as "Tax Invoice" to comply with UAE FTA requirements.
                  </AlertDescription>
                </Alert>
              )}

              <Form {...brandingForm}>
                <form onSubmit={brandingForm.handleSubmit(onBrandingSubmit)} className="space-y-8">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="w-5 h-5" />
                        Company Details Display
                      </CardTitle>
                      <CardDescription>
                        Choose which company information to display on invoices
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <FormField
                        control={brandingForm.control}
                        name="invoiceShowLogo"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Show Company Logo</FormLabel>
                              <FormDescription>
                                Display your company logo at the top of invoices
                                {!company.logoUrl && (
                                  <span className="block text-xs text-amber-600 dark:text-amber-400 mt-1">
                                    Note: Set your logo in Company Profile first
                                  </span>
                                )}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={!company.logoUrl}
                                data-testid="switch-show-logo"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={brandingForm.control}
                        name="invoiceShowAddress"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Show Business Address</FormLabel>
                              <FormDescription>
                                Display your business address on invoices
                                {!company.businessAddress && (
                                  <span className="block text-xs text-amber-600 dark:text-amber-400 mt-1">
                                    Note: Set your address in Company Profile first
                                  </span>
                                )}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={!company.businessAddress}
                                data-testid="switch-show-address"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={brandingForm.control}
                        name="invoiceShowPhone"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Show Phone Number</FormLabel>
                              <FormDescription>
                                Display your business phone number on invoices
                                {!company.contactPhone && (
                                  <span className="block text-xs text-amber-600 dark:text-amber-400 mt-1">
                                    Note: Set your phone in Company Profile first
                                  </span>
                                )}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={!company.contactPhone}
                                data-testid="switch-show-phone"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={brandingForm.control}
                        name="invoiceShowEmail"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Show Email Address</FormLabel>
                              <FormDescription>
                                Display your business email on invoices
                                {!company.contactEmail && (
                                  <span className="block text-xs text-amber-600 dark:text-amber-400 mt-1">
                                    Note: Set your email in Company Profile first
                                  </span>
                                )}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={!company.contactEmail}
                                data-testid="switch-show-email"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={brandingForm.control}
                        name="invoiceShowWebsite"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">Show Website</FormLabel>
                              <FormDescription>
                                Display your website URL on invoices
                                {!company.websiteUrl && (
                                  <span className="block text-xs text-amber-600 dark:text-amber-400 mt-1">
                                    Note: Set your website in Company Profile first
                                  </span>
                                )}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={!company.websiteUrl}
                                data-testid="switch-show-website"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Invoice Customization</CardTitle>
                      <CardDescription>
                        Customize the appearance and text of your invoices
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <FormField
                        control={brandingForm.control}
                        name="invoiceCustomTitle"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Invoice Title</FormLabel>
                            <FormControl>
                              <Input
                                placeholder={isVATRegistered ? "Tax Invoice (default)" : "Invoice (default)"}
                                {...field}
                                data-testid="input-invoice-title"
                              />
                            </FormControl>
                            <FormDescription>
                              {isVATRegistered 
                                ? 'For VAT-registered companies, invoices default to "Tax Invoice". You can customize this, but it must comply with FTA regulations.'
                                : 'Custom title for your invoices. Leave blank to use "Invoice".'
                              }
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={brandingForm.control}
                        name="invoiceFooterNote"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Footer Note</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Thank you for your business"
                                className="resize-none"
                                rows={3}
                                {...field}
                                data-testid="textarea-footer-note"
                              />
                            </FormControl>
                            <FormDescription>
                              Add a custom message at the bottom of your invoices (e.g., payment terms, thank you message)
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      disabled={updateBrandingMutation.isPending}
                      data-testid="button-save-branding"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      {updateBrandingMutation.isPending ? 'Saving...' : 'Save Settings'}
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Similar Invoices Warning Dialog */}
      <Dialog open={similarWarningOpen} onOpenChange={setSimilarWarningOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-yellow-500" />
              Similar Invoices Found
            </DialogTitle>
            <DialogDescription>
              We found similar invoices that might be duplicates. Review them before proceeding.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {similarInvoices.map((invoice, idx) => (
                <div key={idx} className="p-3 border rounded-md bg-muted/50">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{invoice.number}</p>
                      <p className="text-sm">{invoice.customerName}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(invoice.date, locale)}</p>
                      <Badge variant="outline" className="mt-1">{invoice.status}</Badge>
                    </div>
                    <p className="font-mono font-semibold">
                      {formatCurrency(invoice.total || 0, 'AED', locale)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setSimilarWarningOpen(false);
                  setPendingInvoiceData(null);
                  setSimilarInvoices([]);
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  setSimilarWarningOpen(false);
                  if (pendingInvoiceData) {
                    await performInvoiceSave(pendingInvoiceData, editingInvoice);
                  }
                  setPendingInvoiceData(null);
                  setSimilarInvoices([]);
                }}
                className="flex-1"
              >
                Create Anyway
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Set Recurring Dialog */}
      <Dialog open={recurringDialogOpen} onOpenChange={setRecurringDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-purple-500" />
              Recurring Invoice Settings
            </DialogTitle>
            <DialogDescription>
              Configure automatic recurring copies for Invoice {invoiceForRecurring?.number}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="font-medium">Enable Recurring</p>
                <p className="text-sm text-muted-foreground">Automatically create new invoice copies on schedule</p>
              </div>
              <Switch checked={recurringEnabled} onCheckedChange={setRecurringEnabled} />
            </div>

            {recurringEnabled && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Frequency</label>
                  <Select value={recurringInterval} onValueChange={setRecurringInterval}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Next Run Date</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {recurringNextDate ? format(recurringNextDate, 'PPP') : 'Pick a date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={recurringNextDate} onSelect={setRecurringNextDate} initialFocus />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">End Date (optional)</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {recurringEndDate ? format(recurringEndDate, 'PPP') : 'No end date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={recurringEndDate} onSelect={setRecurringEndDate} initialFocus />
                    </PopoverContent>
                  </Popover>
                  {recurringEndDate && (
                    <Button variant="ghost" size="sm" onClick={() => setRecurringEndDate(undefined)} className="text-xs text-muted-foreground">
                      Clear end date
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setRecurringDialogOpen(false)} className="flex-1">Cancel</Button>
            <Button
              onClick={() => {
                if (!invoiceForRecurring) return;
                setRecurringMutation.mutate({
                  invoiceId: invoiceForRecurring.id,
                  data: {
                    isRecurring: recurringEnabled,
                    recurringInterval: recurringEnabled ? recurringInterval : null,
                    nextRecurringDate: recurringEnabled && recurringNextDate ? recurringNextDate.toISOString() : null,
                    recurringEndDate: recurringEndDate ? recurringEndDate.toISOString() : null,
                  },
                });
              }}
              disabled={setRecurringMutation.isPending || (recurringEnabled && !recurringNextDate)}
              className="flex-1"
            >
              {setRecurringMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Payment Dialog */}
      <Dialog open={addPaymentDialogOpen} onOpenChange={setAddPaymentDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-green-600" />
              Record Payment
            </DialogTitle>
            <DialogDescription>
              Record a payment received for Invoice {invoiceForPaymentDetail?.number} (Total: {invoiceForPaymentDetail ? formatCurrency(invoiceForPaymentDetail.total, invoiceForPaymentDetail.currency, locale) : ''})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Amount</label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                className="font-mono"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Payment Method</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="online">Online Payment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Deposit Account</label>
              {paymentAccounts.length > 0 ? (
                <Select value={paymentAccountForAdd} onValueChange={setPaymentAccountForAdd}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select account..." />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.code} — {acc.nameEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>No cash/bank accounts found. Create one in Chart of Accounts.</AlertDescription>
                </Alert>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Reference (optional)</label>
              <Input placeholder="e.g. Bank ref, cheque no." value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Notes (optional)</label>
              <Input placeholder="Additional notes" value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setAddPaymentDialogOpen(false)} className="flex-1">Cancel</Button>
            <Button
              onClick={() => {
                if (!invoiceForPaymentDetail || !paymentAmount || !paymentAccountForAdd) return;
                addPaymentMutation.mutate({
                  invoiceId: invoiceForPaymentDetail.id,
                  data: {
                    amount: parseFloat(paymentAmount),
                    method: paymentMethod,
                    paymentAccountId: paymentAccountForAdd,
                    reference: paymentReference || undefined,
                    notes: paymentNotes || undefined,
                    date: new Date().toISOString(),
                  },
                });
              }}
              disabled={addPaymentMutation.isPending || !paymentAmount || !paymentAccountForAdd}
              className="flex-1"
            >
              {addPaymentMutation.isPending ? 'Recording...' : 'Record Payment'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Payments Dialog */}
      <Dialog open={viewPaymentsDialogOpen} onOpenChange={setViewPaymentsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Payment History — Invoice {invoiceForPaymentDetail?.number}</DialogTitle>
            <DialogDescription>
              All payments recorded for this invoice
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {invoicePayments.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">No payments recorded yet.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoicePayments.map((p: InvoicePayment) => (
                      <TableRow key={p.id}>
                        <TableCell>{formatDate(p.date, locale)}</TableCell>
                        <TableCell className="capitalize">{p.method}</TableCell>
                        <TableCell className="text-muted-foreground">{p.reference || '—'}</TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatCurrency(p.amount, invoiceForPaymentDetail?.currency || 'AED', locale)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-between pt-2 border-t font-semibold">
                  <span>Total Paid</span>
                  <span className="font-mono">
                    {formatCurrency(
                      invoicePayments.reduce((s: number, p: InvoicePayment) => s + p.amount, 0),
                      invoiceForPaymentDetail?.currency || 'AED',
                      locale
                    )}
                  </span>
                </div>
              </>
            )}
          </div>
          <Button variant="outline" onClick={() => setViewPaymentsDialogOpen(false)} className="w-full mt-2">Close</Button>
        </DialogContent>
      </Dialog>

      {/* Payment Account Selection Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select Payment Account</DialogTitle>
            <DialogDescription>
              Choose where the payment for invoice {invoiceForPayment?.number} was deposited
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {paymentAccounts.length > 0 ? (
              <div className="space-y-2">
                {paymentAccounts.map((account) => (
                  <Card
                    key={account.id}
                    className={cn(
                      "cursor-pointer transition-all hover-elevate",
                      selectedPaymentAccount === account.id && "ring-2 ring-primary"
                    )}
                    onClick={() => setSelectedPaymentAccount(account.id)}
                    data-testid={`select-payment-account-${account.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">
                            {locale === 'ar' && account.nameAr ? account.nameAr : account.nameEn}
                          </div>
                          <div className="text-sm text-muted-foreground font-mono">
                            {account.code}
                          </div>
                        </div>
                        {selectedPaymentAccount === account.id && (
                          <div className="text-primary">✓</div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    You need to create at least one bank or cash account before marking invoices as paid.
                  </AlertDescription>
                </Alert>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPaymentDialogOpen(false);
                    window.location.href = '/chart-of-accounts';
                  }}
                  className="w-full"
                  data-testid="button-create-payment-account"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create Bank/Cash Account
                </Button>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setPaymentDialogOpen(false);
                setSelectedPaymentAccount('');
              }}
              className="flex-1"
              data-testid="button-cancel-payment"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmPayment}
              disabled={!selectedPaymentAccount || updateStatusMutation.isPending}
              className="flex-1"
              data-testid="button-confirm-payment"
            >
              {updateStatusMutation.isPending ? 'Processing...' : 'Mark as Paid'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <WhatsAppComposer
        open={composerOpen}
        onOpenChange={(open) => {
          setComposerOpen(open);
          if (!open) {
            setComposerMessage('');
            setComposerRecipient(null);
          }
        }}
        recipient={composerRecipient}
        defaultMessage={composerMessage}
        allowedCategories={["invoice", "payment", "alert"]}
      />
    </div>
  );
}

const VIRTUALIZE_THRESHOLD = 100;
const ROW_ESTIMATE = 64;

interface VirtualizedInvoiceRowsProps {
  invoices: Invoice[];
  scrollRef: React.RefObject<HTMLDivElement>;
  renderRow: (invoice: Invoice) => React.ReactElement;
  emptyState: React.ReactNode;
}

function VirtualizedInvoiceRows({ invoices, scrollRef, renderRow, emptyState }: VirtualizedInvoiceRowsProps) {
  const virtualizer = useVirtualizer({
    count: invoices.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 10,
  });

  if (invoices.length === 0) {
    return <>{emptyState}</>;
  }

  // Below the threshold, the cost of measuring exceeds the benefit — render normally.
  if (invoices.length < VIRTUALIZE_THRESHOLD) {
    return <TableBody>{invoices.map((invoice) => renderRow(invoice))}</TableBody>;
  }

  const totalSize = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  return (
    <TableBody>
      {paddingTop > 0 && (
        <tr aria-hidden="true">
          <td colSpan={6} style={{ height: paddingTop, padding: 0, border: 0 }} />
        </tr>
      )}
      {virtualItems.map((virtualRow) => renderRow(invoices[virtualRow.index]))}
      {paddingBottom > 0 && (
        <tr aria-hidden="true">
          <td colSpan={6} style={{ height: paddingBottom, padding: 0, border: 0 }} />
        </tr>
      )}
    </TableBody>
  );
}