import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
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
import { formatDate } from '@/lib/format';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Plus, CalendarIcon, Trash2, Edit, MoreHorizontal, Pause, Play, CalendarDays } from 'lucide-react';
import type { RecurringInvoice } from '@shared/schema';
import { cn } from '@/lib/utils';

const lineItemSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  quantity: z.coerce.number().min(0.01, 'Quantity must be positive'),
  unitPrice: z.coerce.number().min(0, 'Price must be positive'),
  vatRate: z.coerce.number().default(0.05),
});

const recurringInvoiceSchema = z.object({
  customerName: z.string().min(1, 'Customer name is required'),
  customerTrn: z.string().optional(),
  currency: z.string().default('AED'),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  startDate: z.date(),
  endDate: z.date().optional().nullable(),
  lines: z.array(lineItemSchema).min(1, 'At least one line item is required'),
});

type RecurringInvoiceFormData = z.infer<typeof recurringInvoiceSchema>;

const frequencyLabels: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

const frequencyLabelsAr: Record<string, string> = {
  weekly: 'اسبوعي',
  monthly: 'شهري',
  quarterly: 'ربع سنوي',
  yearly: 'سنوي',
};

export default function RecurringInvoices() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<RecurringInvoice | null>(null);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const { data: recurringInvoices, isLoading } = useQuery<RecurringInvoice[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'recurring-invoices'],
    enabled: !!selectedCompanyId,
  });

  const form = useForm<RecurringInvoiceFormData>({
    resolver: zodResolver(recurringInvoiceSchema),
    defaultValues: {
      customerName: '',
      customerTrn: '',
      currency: 'AED',
      frequency: 'monthly',
      startDate: new Date(),
      endDate: null,
      lines: [{ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'lines',
  });

  const createMutation = useMutation({
    mutationFn: async (data: RecurringInvoiceFormData) => {
      return await apiRequest('POST', `/api/companies/${selectedCompanyId}/recurring-invoices`, {
        customerName: data.customerName,
        customerTrn: data.customerTrn || null,
        currency: data.currency,
        frequency: data.frequency,
        startDate: data.startDate.toISOString(),
        endDate: data.endDate ? data.endDate.toISOString() : null,
        linesJson: JSON.stringify(data.lines),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'recurring-invoices'] });
      setDialogOpen(false);
      form.reset();
      toast({ title: 'Recurring invoice created', description: 'The recurring invoice template has been created.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: RecurringInvoiceFormData }) => {
      return await apiRequest('PATCH', `/api/recurring-invoices/${id}`, {
        customerName: data.customerName,
        customerTrn: data.customerTrn || null,
        currency: data.currency,
        frequency: data.frequency,
        startDate: data.startDate.toISOString(),
        nextRunDate: data.startDate.toISOString(),
        endDate: data.endDate ? data.endDate.toISOString() : null,
        linesJson: JSON.stringify(data.lines),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'recurring-invoices'] });
      setDialogOpen(false);
      setEditingItem(null);
      form.reset();
      toast({ title: 'Recurring invoice updated', description: 'The recurring invoice template has been updated.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest('PATCH', `/api/recurring-invoices/${id}/toggle`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'recurring-invoices'] });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest('DELETE', `/api/recurring-invoices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'recurring-invoices'] });
      toast({ title: 'Deleted', description: 'Recurring invoice has been deleted.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const handleCreate = () => {
    setEditingItem(null);
    form.reset({
      customerName: '',
      customerTrn: '',
      currency: 'AED',
      frequency: 'monthly',
      startDate: new Date(),
      endDate: null,
      lines: [{ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 }],
    });
    setDialogOpen(true);
  };

  const handleEdit = (item: RecurringInvoice) => {
    setEditingItem(item);
    let parsedLines = [{ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 }];
    try {
      parsedLines = JSON.parse(item.linesJson);
    } catch {
      // keep default
    }
    form.reset({
      customerName: item.customerName,
      customerTrn: item.customerTrn || '',
      currency: item.currency,
      frequency: item.frequency as 'weekly' | 'monthly' | 'quarterly' | 'yearly',
      startDate: new Date(item.startDate),
      endDate: item.endDate ? new Date(item.endDate) : null,
      lines: parsedLines,
    });
    setDialogOpen(true);
  };

  const onSubmit = (data: RecurringInvoiceFormData) => {
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const getFreqLabel = (freq: string) => {
    if (locale === 'ar') return frequencyLabelsAr[freq] || freq;
    return frequencyLabels[freq] || freq;
  };

  if (!selectedCompanyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">{t.noData || 'No data available'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <CalendarDays className="w-8 h-8" />
            {(t as any).recurringInvoices || 'Recurring Invoices'}
          </h1>
          <p className="text-muted-foreground mt-1">
            {locale === 'ar'
              ? 'ادارة قوالب الفواتير المتكررة'
              : 'Manage recurring invoice templates'}
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleCreate}>
              <Plus className="w-4 h-4 mr-2" />
              {locale === 'ar' ? 'فاتورة متكررة جديدة' : 'New Recurring Invoice'}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingItem
                  ? (locale === 'ar' ? 'تعديل الفاتورة المتكررة' : 'Edit Recurring Invoice')
                  : (locale === 'ar' ? 'فاتورة متكررة جديدة' : 'New Recurring Invoice')}
              </DialogTitle>
              <DialogDescription>
                {locale === 'ar'
                  ? 'حدد تفاصيل قالب الفاتورة المتكررة'
                  : 'Define the recurring invoice template details'}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="customerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.customerName || 'Customer Name'}</FormLabel>
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
                        <FormLabel>{t.customerTRN || 'Customer TRN'}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="currency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{locale === 'ar' ? 'العملة' : 'Currency'}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
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
                  <FormField
                    control={form.control}
                    name="frequency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{locale === 'ar' ? 'التكرار' : 'Frequency'}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="weekly">{locale === 'ar' ? 'اسبوعي' : 'Weekly'}</SelectItem>
                            <SelectItem value="monthly">{locale === 'ar' ? 'شهري' : 'Monthly'}</SelectItem>
                            <SelectItem value="quarterly">{locale === 'ar' ? 'ربع سنوي' : 'Quarterly'}</SelectItem>
                            <SelectItem value="yearly">{locale === 'ar' ? 'سنوي' : 'Yearly'}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>{locale === 'ar' ? 'تاريخ البدء' : 'Start Date'}</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  'w-full pl-3 text-left font-normal',
                                  !field.value && 'text-muted-foreground'
                                )}
                              >
                                {field.value ? format(field.value, 'PPP') : (locale === 'ar' ? 'اختر التاريخ' : 'Pick a date')}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
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
                  <FormField
                    control={form.control}
                    name="endDate"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>{locale === 'ar' ? 'تاريخ الانتهاء (اختياري)' : 'End Date (optional)'}</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  'w-full pl-3 text-left font-normal',
                                  !field.value && 'text-muted-foreground'
                                )}
                              >
                                {field.value ? format(field.value, 'PPP') : (locale === 'ar' ? 'غير محدد' : 'Indefinite')}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value || undefined}
                              onSelect={(date) => field.onChange(date || null)}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Line Items */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-base font-semibold">
                      {locale === 'ar' ? 'بنود الفاتورة' : 'Line Items'}
                    </FormLabel>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => append({ description: '', quantity: 1, unitPrice: 0, vatRate: 0.05 })}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      {t.addLine || 'Add Line'}
                    </Button>
                  </div>
                  {fields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-12 gap-2 items-start">
                      <div className="col-span-5">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.description`}
                          render={({ field }) => (
                            <FormItem>
                              {index === 0 && <FormLabel>{t.description || 'Description'}</FormLabel>}
                              <FormControl>
                                <Input {...field} placeholder={t.description || 'Description'} />
                              </FormControl>
                              <FormMessage />
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
                              {index === 0 && <FormLabel>{t.quantity || 'Qty'}</FormLabel>}
                              <FormControl>
                                <Input {...field} type="number" step="0.01" />
                              </FormControl>
                              <FormMessage />
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
                              {index === 0 && <FormLabel>{t.unitPrice || 'Price'}</FormLabel>}
                              <FormControl>
                                <Input {...field} type="number" step="0.01" />
                              </FormControl>
                              <FormMessage />
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
                              {index === 0 && <FormLabel>{t.vat || 'VAT'}</FormLabel>}
                              <Select
                                onValueChange={(val) => field.onChange(parseFloat(val))}
                                defaultValue={String(field.value)}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="0.05">5%</SelectItem>
                                  <SelectItem value="0">0%</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-1 flex items-end">
                        {fields.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => remove(index)}
                            className={cn(index === 0 && 'mt-6')}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    {t.cancel || 'Cancel'}
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                    {(createMutation.isPending || updateMutation.isPending)
                      ? (t.loading || 'Loading...')
                      : (t.save || 'Save')}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{(t as any).recurringInvoices || 'Recurring Invoices'}</CardTitle>
          <CardDescription>
            {locale === 'ar'
              ? 'قوالب الفواتير التي يتم إنشاؤها تلقائيا'
              : 'Invoice templates that are automatically generated'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !recurringInvoices || recurringInvoices.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CalendarDays className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">
                {locale === 'ar'
                  ? 'لا توجد فواتير متكررة بعد'
                  : 'No recurring invoices yet'}
              </p>
              <p className="text-sm mt-1">
                {locale === 'ar'
                  ? 'انشئ قالب فاتورة متكررة للبدء'
                  : 'Create a recurring invoice template to get started'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.customerName || 'Customer'}</TableHead>
                  <TableHead>{locale === 'ar' ? 'التكرار' : 'Frequency'}</TableHead>
                  <TableHead>{locale === 'ar' ? 'التشغيل التالي' : 'Next Run Date'}</TableHead>
                  <TableHead>{t.status || 'Status'}</TableHead>
                  <TableHead>{locale === 'ar' ? 'تم التوليد' : 'Generated'}</TableHead>
                  <TableHead className="text-right">{t.actions || 'Actions'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recurringInvoices.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.customerName}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {getFreqLabel(item.frequency)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {formatDate(item.nextRunDate, locale)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={item.isActive ? 'default' : 'outline'}
                        className={cn(
                          item.isActive
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                        )}
                      >
                        {item.isActive
                          ? (locale === 'ar' ? 'نشط' : 'Active')
                          : (locale === 'ar' ? 'متوقف' : 'Paused')}
                      </Badge>
                    </TableCell>
                    <TableCell>{item.totalGenerated}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(item)}>
                            <Edit className="w-4 h-4 mr-2" />
                            {t.edit || 'Edit'}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleMutation.mutate(item.id)}>
                            {item.isActive ? (
                              <>
                                <Pause className="w-4 h-4 mr-2" />
                                {locale === 'ar' ? 'ايقاف مؤقت' : 'Pause'}
                              </>
                            ) : (
                              <>
                                <Play className="w-4 h-4 mr-2" />
                                {locale === 'ar' ? 'استئناف' : 'Resume'}
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setItemToDelete(item.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {t.delete || 'Delete'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!itemToDelete} onOpenChange={(open) => { if (!open) setItemToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recurring Invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this recurring invoice schedule. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (itemToDelete) {
                  deleteMutation.mutate(itemToDelete);
                  setItemToDelete(null);
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
