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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency, formatDate, formatNumber } from '@/lib/format';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Plus, BookMarked, CalendarIcon, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const journalLineSchema = z.object({
  accountId: z.string().uuid('Please select an account'),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
});

const journalSchema = z.object({
  companyId: z.string().uuid(),
  date: z.date(),
  memo: z.string().optional(),
  lines: z.array(journalLineSchema).min(2, 'At least two line items are required'),
}).refine((data) => {
  const totalDebit = data.lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = data.lines.reduce((sum, line) => sum + line.credit, 0);
  return Math.abs(totalDebit - totalCredit) < 0.01;
}, {
  message: 'Total debits must equal total credits',
  path: ['lines'],
});

type JournalFormData = z.infer<typeof journalSchema>;

export default function Journal() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: accounts } = useQuery<any[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'accounts'],
    enabled: !!selectedCompanyId,
  });

  const { data: entries, isLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'journal'],
    enabled: !!selectedCompanyId,
  });

  const form = useForm<JournalFormData>({
    resolver: zodResolver(journalSchema),
    defaultValues: {
      companyId: selectedCompanyId || '',
      date: new Date(),
      memo: '',
      lines: [
        { accountId: '', debit: 0, credit: 0 },
        { accountId: '', debit: 0, credit: 0 },
      ],
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
    mutationFn: (data: JournalFormData) => 
      apiRequest('POST', `/api/companies/${selectedCompanyId}/journal`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'journal'] });
      toast({
        title: 'Journal entry posted',
        description: 'Your double-entry journal has been recorded.',
      });
      setDialogOpen(false);
      form.reset({
        companyId: selectedCompanyId,
        date: new Date(),
        memo: '',
        lines: [
          { accountId: '', debit: 0, credit: 0 },
          { accountId: '', debit: 0, credit: 0 },
        ],
      });
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to post entry',
        description: error.message || 'Please check that debits equal credits.',
      });
    },
  });

  const onSubmit = (data: JournalFormData) => {
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

  // Calculate balance
  const watchLines = form.watch('lines');
  const totalDebit = watchLines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  const totalCredit = watchLines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-semibold mb-2">{t.journal}</h1>
          <p className="text-muted-foreground">Double-entry journal with automatic balance validation</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-entry">
              <Plus className="w-4 h-4 mr-2" />
              {t.newEntry}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t.newEntry}</DialogTitle>
              <DialogDescription>
                Create a balanced double-entry journal entry
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
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
                  <FormField
                    control={form.control}
                    name="memo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t.memo}</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Optional description" data-testid="input-memo" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Journal Lines</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => append({ accountId: '', debit: 0, credit: 0 })}
                      data-testid="button-add-line"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Line
                    </Button>
                  </div>
                  
                  <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-muted-foreground px-3 pb-2">
                    <div className="col-span-5">Account</div>
                    <div className="col-span-3 text-right">{t.debit}</div>
                    <div className="col-span-3 text-right">{t.credit}</div>
                    <div className="col-span-1"></div>
                  </div>

                  {fields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-12 gap-2 items-start p-3 border rounded-md">
                      <div className="col-span-5">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.accountId`}
                          render={({ field }) => (
                            <FormItem>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger data-testid={`select-account-${index}`}>
                                    <SelectValue placeholder="Select account" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {accounts?.map((acc: any) => (
                                    <SelectItem key={acc.id} value={acc.id}>
                                      <span className="font-mono text-xs mr-2">{acc.code}</span>
                                      {locale === 'ar' && acc.nameAr ? acc.nameAr : acc.nameEn}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-3">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.debit`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  type="number" 
                                  step="0.01" 
                                  placeholder="0.00" 
                                  className="font-mono text-right" 
                                  data-testid={`input-debit-${index}`}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-3">
                        <FormField
                          control={form.control}
                          name={`lines.${index}.credit`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  type="number" 
                                  step="0.01" 
                                  placeholder="0.00" 
                                  className="font-mono text-right" 
                                  data-testid={`input-credit-${index}`}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-1 flex items-center justify-center">
                        {fields.length > 2 && (
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

                <div className="border-t pt-4 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total {t.debit}</span>
                    <span className="font-mono font-medium">{formatNumber(totalDebit, locale)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total {t.credit}</span>
                    <span className="font-mono font-medium">{formatNumber(totalCredit, locale)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="font-semibold">{t.balance}</span>
                    <div className="flex items-center gap-2">
                      {isBalanced ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                          <Badge variant="outline" className="bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                            {t.balanced}
                          </Badge>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-destructive" />
                          <Badge variant="outline" className="bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                            {t.notBalanced} ({formatNumber(Math.abs(totalDebit - totalCredit), locale)})
                          </Badge>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="flex-1">
                    {t.cancel}
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={!isBalanced || createMutation.isPending} 
                    className="flex-1" 
                    data-testid="button-submit-entry"
                  >
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
      ) : entries && entries.length > 0 ? (
        <div className="space-y-4">
          {entries.map((entry: any) => (
            <Card key={entry.id}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="text-sm text-muted-foreground">{formatDate(entry.date, locale)}</div>
                    {entry.memo && <div className="font-medium mt-1">{entry.memo}</div>}
                  </div>
                  <Badge variant="outline" className="bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                    {t.balanced}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {entry.lines?.map((line: any, idx: number) => (
                    <div key={idx} className="grid grid-cols-12 gap-4 text-sm py-2 border-b last:border-0">
                      <div className="col-span-6 flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{line.account?.code}</span>
                        <span>{line.account?.nameEn}</span>
                      </div>
                      <div className="col-span-3 text-right font-mono">
                        {line.debit > 0 ? formatNumber(line.debit, locale) : '-'}
                      </div>
                      <div className="col-span-3 text-right font-mono">
                        {line.credit > 0 ? formatNumber(line.credit, locale) : '-'}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <BookMarked className="w-16 h-16 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">No journal entries yet</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Create your first double-entry journal
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              {t.newEntry}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
