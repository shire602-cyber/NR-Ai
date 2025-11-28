import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency, formatDate } from '@/lib/format';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Plus, FileText, CalendarIcon, Trash2, Download, Edit, Palette, Save, Info, XCircle } from 'lucide-react';
import type { Invoice, Company } from '@shared/schema';
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

  const { data: invoices, isLoading } = useQuery<Invoice[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'invoices'],
    enabled: !!selectedCompanyId,
  });

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'accounts'],
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
        description: error.message || 'Please try again.',
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
        description: error.message || 'Please try again.',
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status, paymentAccountId }: { id: string; status: string; paymentAccountId?: string }) =>
      apiRequest('PATCH', `/api/invoices/${id}/status`, { status, paymentAccountId }),
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
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to update status',
        description: error.message || 'Please try again.',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/invoices/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'invoices'] });
      toast({
        title: t.invoiceDeleted,
        description: t.invoiceDeletedDesc,
      });
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: t.deleteFailed,
        description: error.message || t.tryAgain,
      });
    },
  });

  const checkSimilarMutation = useMutation({
    mutationFn: (data: any) => 
      apiRequest('POST', `/api/companies/${selectedCompanyId}/invoices/check-similar`, data),
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
  const paymentAccounts = accounts.filter(acc => 
    ['1000', '1100'].includes(acc.code)
  );

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
        description: error.message || 'Failed to load invoice details.',
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
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          vatRate: line.vatRate,
        })),
      };

      // Check for similar invoices only when creating new (not editing)
      if (!editingInvoice) {
        const total = fields.reduce((sum, line) => {
          const lineTotal = line.quantity * line.unitPrice;
          return sum + lineTotal + (lineTotal * line.vatRate);
        }, 0);

        try {
          const checkResult = await checkSimilarMutation.mutateAsync({
            customerName: data.customerName,
            total: total,
            date: data.date,
          });

          if (checkResult.hasSimilar && checkResult.similarInvoices.length > 0) {
            setSimilarInvoices(checkResult.similarInvoices);
            setPendingInvoiceData(invoiceData);
            setSimilarWarningOpen(true);
            return;
          }
        } catch (error) {
          console.error('Error checking for similar invoices:', error);
          // Continue with save if check fails
        }
      }

      // Proceed with save
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
        description: error.message || 'Please try again.',
      });
    },
  });

  const onBrandingSubmit = (data: InvoiceBrandingFormData) => {
    updateBrandingMutation.mutate(data);
  };

  const isVATRegistered = company?.trnVatNumber && company?.trnVatNumber.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">{t.invoices}</h1>
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
                      <div className="col-span-5">
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
                      <div className="col-span-2">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.quantity`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input {...field} type="number" step="0.01" placeholder="Qty" className="font-mono" data-testid={`input-line-quantity-${index}`} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-2">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.unitPrice`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input {...field} type="number" step="0.01" placeholder="Price" className="font-mono" data-testid={`input-line-price-${index}`} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-2">
                        <div className="h-10 flex items-center justify-end font-mono text-sm">
                          {formatCurrency((watchLines[index]?.quantity || 0) * (watchLines[index]?.unitPrice || 0), 'AED', locale)}
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
                    <span className="text-muted-foreground">{t.vat} (5%)</span>
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
        <Skeleton className="h-96" />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-semibold">{t.invoiceNumber}</TableHead>
                  <TableHead className="font-semibold">{t.customerName}</TableHead>
                  <TableHead className="font-semibold">{t.date}</TableHead>
                  <TableHead className="font-semibold text-right">{t.total}</TableHead>
                  <TableHead className="font-semibold text-center">{t.status}</TableHead>
                  <TableHead className="font-semibold text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices && invoices.length > 0 ? (
                  invoices.map((invoice) => (
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
                            <SelectItem value="void" data-testid={`status-option-void-${invoice.id}`}>
                              {t.void}
                            </SelectItem>
                          </SelectContent>
                        </Select>
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
                                description: error.message || 'Failed to generate PDF',
                                variant: 'destructive',
                              });
                            }
                            }}
                            data-testid={`button-download-pdf-${invoice.id}`}
                          >
                            <Download className="w-4 h-4 mr-2" />
                            PDF
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {t.noData}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
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
              <Alert>
                <AlertDescription>
                  No cash or bank accounts found. Please create a cash or bank account first.
                </AlertDescription>
              </Alert>
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
    </div>
  );
}