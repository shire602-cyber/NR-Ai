import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency, formatDate } from '@/lib/format';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Plus, FileText, CalendarIcon, Trash2, Download } from 'lucide-react';
import type { Invoice } from '@shared/schema';
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

type InvoiceFormData = z.infer<typeof invoiceSchema>;

export default function Invoices() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { company, companyId: selectedCompanyId } = useDefaultCompany();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: invoices, isLoading } = useQuery<Invoice[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'invoices'],
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

  const onSubmit = (data: InvoiceFormData) => {
    if (!selectedCompanyId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Company not found. Please refresh the page.',
      });
      return;
    }
    createMutation.mutate({ ...data, companyId: selectedCompanyId });
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

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-semibold mb-2">{t.invoices}</h1>
          <p className="text-muted-foreground">Manage invoices with automatic UAE VAT (5%) calculation</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-invoice">
              <Plus className="w-4 h-4 mr-2" />
              {t.newInvoice}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t.newInvoice}</DialogTitle>
              <DialogDescription>
                Create a new invoice with automatic VAT calculation
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
                  <Button type="submit" disabled={createMutation.isPending} className="flex-1" data-testid="button-submit-invoice">
                    {createMutation.isPending ? t.loading : t.save}
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
                        <Badge variant="outline" className={getStatusBadgeColor(invoice.status)}>
                          {t[invoice.status as keyof typeof t]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              // Fetch full invoice details with lines using apiRequest
                              const invoiceDetails = await apiRequest('GET', `/api/invoices/${invoice.id}`);
                              
                              // Check if company is VAT registered
                              const isVATRegistered = company?.trnVatNumber && company.trnVatNumber.length > 0;
                              
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
                                showLogo: company?.invoiceShowLogo ?? true,
                                showAddress: company?.invoiceShowAddress ?? true,
                                showPhone: company?.invoiceShowPhone ?? true,
                                showEmail: company?.invoiceShowEmail ?? true,
                                showWebsite: company?.invoiceShowWebsite ?? false,
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
    </div>
  );
}
