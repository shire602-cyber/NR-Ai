import { PageHeader } from '@/components/ui/page-header';
import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { useSubscription } from '@/hooks/useSubscription';
import { UpgradePrompt } from '@/components/UpgradePrompt';
import { formatCurrency, formatDate } from '@/lib/format';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Plus, CalendarIcon, Trash2, Download, Edit, MoreHorizontal, ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

const quoteLineSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  quantity: z.coerce.number().min(0.01, 'Quantity must be positive'),
  unitPrice: z.coerce.number().min(0, 'Price must be positive'),
  vatRate: z.coerce.number().default(0.05),
});

const quoteSchema = z.object({
  companyId: z.string().uuid(),
  number: z.string().min(1, 'Quote number is required'),
  customerName: z.string().min(1, 'Customer name is required'),
  customerTrn: z.string().optional(),
  date: z.date(),
  expiryDate: z.date(),
  currency: z.string().default('AED'),
  notes: z.string().optional(),
  lines: z.array(quoteLineSchema).min(1, 'At least one line item is required'),
});

type QuoteFormData = z.infer<typeof quoteSchema>;

interface Quote {
  id: string;
  companyId: string;
  number: string;
  customerName: string;
  customerTrn?: string;
  date: string;
  expiryDate: string;
  currency: string;
  notes?: string;
  lines: Array<{ description: string; quantity: number; unitPrice: number; vatRate: number }>;
  subtotal: number;
  vatAmount: number;
  total: number;
  status: string;
}

export default function Quotes() {
  const { locale } = useTranslation();
  const { toast } = useToast();
  const { company, companyId: selectedCompanyId } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);

  const { data: quotes, isLoading } = useQuery<Quote[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'quotes'],
    enabled: !!selectedCompanyId,
  });

  const form = useForm<QuoteFormData>({
    resolver: zodResolver(quoteSchema),
    defaultValues: {
      companyId: selectedCompanyId || '',
      number: `QT-${Date.now()}`,
      customerName: '',
      customerTrn: '',
      date: new Date(),
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      currency: 'AED',
      notes: '',
      lines: [{ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    },
  });

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
    mutationFn: (data: QuoteFormData) =>
      apiRequest('POST', `/api/companies/${selectedCompanyId}/quotes`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'quotes'] });
      toast({ title: 'Quote created', description: 'Your quote has been created successfully.' });
      setDialogOpen(false);
      setEditingQuote(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to create quote', description: error?.message || 'Please try again.' });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: QuoteFormData }) =>
      apiRequest('PUT', `/api/quotes/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'quotes'] });
      toast({ title: 'Quote updated', description: 'Your quote has been updated successfully.' });
      setDialogOpen(false);
      setEditingQuote(null);
      resetForm();
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to update quote', description: error?.message || 'Please try again.' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/quotes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'quotes'] });
      toast({ title: 'Quote deleted', description: 'The quote has been deleted.' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to delete quote', description: error?.message || 'Please try again.' });
    },
  });

  const convertMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/quotes/${id}/convert-to-invoice`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'quotes'] });
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'invoices'] });
      toast({ title: 'Quote converted', description: 'The quote has been converted to an invoice.' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to convert quote', description: error?.message || 'Please try again.' });
    },
  });

  const resetForm = () => {
    form.reset({
      companyId: selectedCompanyId || '',
      number: `QT-${Date.now()}`,
      customerName: '',
      customerTrn: '',
      date: new Date(),
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      currency: 'AED',
      notes: '',
      lines: [{ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    });
    setEditingQuote(null);
  };

  const handleEditQuote = async (quote: Quote) => {
    try {
      const fullQuote = await apiRequest('GET', `/api/quotes/${quote.id}`);
      setEditingQuote(fullQuote);
      form.reset({
        companyId: fullQuote.companyId,
        number: fullQuote.number,
        customerName: fullQuote.customerName,
        customerTrn: fullQuote.customerTrn || '',
        date: new Date(fullQuote.date),
        expiryDate: new Date(fullQuote.expiryDate),
        currency: fullQuote.currency,
        notes: fullQuote.notes || '',
        lines: fullQuote.lines || [{ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 }],
      });
      setDialogOpen(true);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error?.message || 'Failed to load quote details.' });
    }
  };

  const onSubmit = async (data: QuoteFormData) => {
    const quoteData = {
      ...data,
      companyId: selectedCompanyId!,
      lines: fields.map((_, index) => ({
        description: data.lines[index].description,
        quantity: Number(data.lines[index].quantity),
        unitPrice: Number(data.lines[index].unitPrice),
        vatRate: Number(data.lines[index].vatRate),
      })),
    };

    if (editingQuote) {
      editMutation.mutate({ id: editingQuote.id, data: quoteData });
    } else {
      createMutation.mutate(quoteData);
    }
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400';
      case 'sent': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400';
      case 'accepted': return 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400';
      case 'rejected': return 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400';
      case 'expired': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400';
      case 'converted': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400';
      default: return 'bg-gray-100 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400';
    }
  };

  const watchLines = form.watch('lines');
  const subtotal = watchLines.reduce((sum, line) => sum + (line.quantity * line.unitPrice), 0);
  const vatAmount = watchLines.reduce((sum, line) => sum + (line.quantity * line.unitPrice * line.vatRate), 0);
  const total = subtotal + vatAmount;

  if (!canAccess('quotes')) {
    return <UpgradePrompt feature="quotes" requiredTier={getRequiredTier('quotes')} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Quotes"
        description="Create and manage quotes for your customers"
      />

      <div className="flex items-center justify-end flex-wrap gap-4">
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Quote
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingQuote ? 'Edit Quote' : 'New Quote'}</DialogTitle>
              <DialogDescription>
                {editingQuote ? 'Update quote details' : 'Create a new quote with automatic VAT calculation'}
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
                        <FormLabel>Quote Number</FormLabel>
                        <FormControl>
                          <Input {...field} className="font-mono" />
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
                        <FormLabel>Date</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn('w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0">
                            <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
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
                        <FormLabel>Customer Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
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
                        <FormLabel>Customer TRN</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Optional" className="font-mono" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="expiryDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Expiry Date</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn('w-full justify-start text-left font-normal', !field.value && 'text-muted-foreground')}
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0">
                            <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="currency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Currency</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select currency" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="AED">AED</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                            <SelectItem value="GBP">GBP</SelectItem>
                            <SelectItem value="SAR">SAR</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="Optional notes for the customer" rows={3} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Line Items</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => append({ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 })}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Line
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
                                <Input {...field} placeholder="Description" />
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
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder="Qty"
                                  className="font-mono"
                                  value={field.value ?? ''}
                                  onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : '')}
                                />
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
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder="Price"
                                  className="font-mono"
                                  value={field.value ?? ''}
                                  onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : '')}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-2">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.vatRate`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Select value={String(field.value * 100)} onValueChange={(val) => field.onChange(parseFloat(val) / 100)}>
                                  <SelectTrigger className="font-mono">
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
                      <div className="col-span-1">
                        <div className="h-10 flex items-center justify-end font-mono text-sm">
                          {formatCurrency((watchLines[index]?.quantity || 0) * (watchLines[index]?.unitPrice || 0) * (1 + (watchLines[index]?.vatRate || 0)), 'AED', locale)}
                        </div>
                      </div>
                      <div className="col-span-1 flex items-center justify-center">
                        {fields.length > 1 && (
                          <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-mono font-medium">{formatCurrency(subtotal, 'AED', locale)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">VAT</span>
                    <span className="font-mono font-medium">{formatCurrency(vatAmount, 'AED', locale)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-semibold pt-2 border-t">
                    <span>Total</span>
                    <span className="font-mono">{formatCurrency(total, 'AED', locale)}</span>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending || editMutation.isPending} className="flex-1">
                    {(createMutation.isPending || editMutation.isPending) ? 'Saving...' : 'Save'}
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
                  <TableHead className="font-semibold">Number</TableHead>
                  <TableHead className="font-semibold">Customer</TableHead>
                  <TableHead className="font-semibold">Date</TableHead>
                  <TableHead className="font-semibold">Expiry</TableHead>
                  <TableHead className="font-semibold text-right">Total</TableHead>
                  <TableHead className="font-semibold text-center">Status</TableHead>
                  <TableHead className="font-semibold text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes && quotes.length > 0 ? (
                  quotes.map((quote) => (
                    <TableRow key={quote.id}>
                      <TableCell className="font-mono font-medium">{quote.number}</TableCell>
                      <TableCell>{quote.customerName}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(quote.date, locale)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(quote.expiryDate, locale)}</TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatCurrency(quote.total, quote.currency, locale)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className={cn('capitalize', getStatusBadgeColor(quote.status))}>
                          {quote.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEditQuote(quote)}>
                              <Edit className="w-4 h-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => convertMutation.mutate(quote.id)}
                              disabled={quote.status === 'converted'}
                            >
                              <ArrowRightLeft className="w-4 h-4 mr-2" />
                              Convert to Invoice
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => window.open(`/api/quotes/${quote.id}/pdf`, '_blank')}>
                              <Download className="w-4 h-4 mr-2" />
                              Download PDF
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                if (window.confirm('Are you sure you want to delete this quote?')) {
                                  deleteMutation.mutate(quote.id);
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No quotes yet. Create your first quote to get started.
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
