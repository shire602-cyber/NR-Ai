import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Plus, BookOpen, Search, Trash2, Edit } from 'lucide-react';
import type { Account } from '@shared/schema';

const accountSchema = z.object({
  companyId: z.string().uuid(),
  nameEn: z.string().min(1, 'Account name (EN) is required'),
  nameAr: z.string().optional(),
  type: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
  isActive: z.boolean().default(true),
});

type AccountFormData = z.infer<typeof accountSchema>;

export default function Accounts() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  const { data: accounts, isLoading } = useQuery<Account[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'accounts'],
    enabled: !!selectedCompanyId,
  });

  const form = useForm<AccountFormData>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      companyId: selectedCompanyId || '',
      nameEn: '',
      nameAr: '',
      type: 'asset',
      isActive: true,
    },
  });

  // Update form's companyId when selectedCompanyId changes
  useEffect(() => {
    if (selectedCompanyId) {
      form.setValue('companyId', selectedCompanyId);
    }
  }, [selectedCompanyId, form]);

  const createMutation = useMutation({
    mutationFn: (data: AccountFormData) => 
      apiRequest('POST', `/api/companies/${data.companyId}/accounts`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'accounts'] });
      toast({
        title: 'Account created',
        description: 'New account has been added to the Chart of Accounts.',
      });
      setDialogOpen(false);
      setEditingAccount(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to create account',
        description: error.message || 'Please try again.',
      });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: AccountFormData }) => 
      apiRequest('PUT', `/api/accounts/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'accounts'] });
      toast({
        title: 'Account updated successfully',
        description: 'Account has been updated in the Chart of Accounts.',
      });
      setDialogOpen(false);
      setEditingAccount(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to update account',
        description: error.message || 'Please try again.',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (accountId: string) => 
      apiRequest('DELETE', `/api/accounts/${accountId}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'accounts'] });
      toast({
        title: 'Account deleted',
        description: 'Account has been removed from the Chart of Accounts.',
      });
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to delete account',
        description: error.message || 'Please try again.',
      });
    },
  });

  const handleEditAccount = (account: Account) => {
    setEditingAccount(account);
    form.reset({
      companyId: account.companyId,
      nameEn: account.nameEn,
      nameAr: account.nameAr || '',
      type: account.type as 'asset' | 'liability' | 'equity' | 'income' | 'expense',
      isActive: account.isActive,
    });
    setDialogOpen(true);
  };

  const onSubmit = (data: AccountFormData) => {
    if (!selectedCompanyId) return;
    if (editingAccount) {
      editMutation.mutate({ id: editingAccount.id, data: { ...data, companyId: selectedCompanyId } });
    } else {
      createMutation.mutate({ ...data, companyId: selectedCompanyId });
    }
  };

  const handleDelete = (accountId: string) => {
    deleteMutation.mutate(accountId);
  };

  const filteredAccounts = accounts?.filter(acc => 
    acc.nameEn.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (acc.nameAr && acc.nameAr.includes(searchTerm))
  );

  const groupedAccounts = filteredAccounts?.reduce((acc, account) => {
    if (!acc[account.type]) {
      acc[account.type] = [];
    }
    acc[account.type].push(account);
    return acc;
  }, {} as Record<string, Account[]>);

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'asset': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400';
      case 'liability': return 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400';
      case 'equity': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400';
      case 'income': return 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400';
      case 'expense': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400';
      default: return 'bg-gray-100 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400';
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-semibold mb-2">{t.accounts}</h1>
          <p className="text-muted-foreground">UAE Chart of Accounts with bilingual support</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingAccount(null);
            form.reset();
          }
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-account">
              <Plus className="w-4 h-4 mr-2" />
              Add Account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingAccount ? 'Edit Account' : 'Add New Account'}</DialogTitle>
              <DialogDescription>
                {editingAccount ? 'Update account details' : 'Create a new account in your Chart of Accounts'}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="nameEn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.accountName} (English)</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Equipment" data-testid="input-account-name-en" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nameAr"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.accountName} (Arabic)</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="معدات" data-testid="input-account-name-ar" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.type}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-account-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="asset">{t.asset}</SelectItem>
                          <SelectItem value="liability">{t.liability}</SelectItem>
                          <SelectItem value="equity">{t.equity}</SelectItem>
                          <SelectItem value="income">{t.income}</SelectItem>
                          <SelectItem value="expense">{t.expense}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="flex-1">
                    {t.cancel}
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending || editMutation.isPending} className="flex-1" data-testid="button-submit-account">
                    {(createMutation.isPending || editMutation.isPending) ? t.loading : t.save}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search accounts..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
          data-testid="input-search"
        />
      </div>

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-semibold">{t.accountName}</TableHead>
                  <TableHead className="font-semibold">{t.type}</TableHead>
                  <TableHead className="text-center font-semibold">Status</TableHead>
                  <TableHead className="text-center font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAccounts && filteredAccounts.length > 0 ? (
                  filteredAccounts.map((account) => (
                    <TableRow key={account.id} data-testid={`account-row-${account.id}`}>
                      <TableCell>
                        {locale === 'ar' && account.nameAr ? account.nameAr : account.nameEn}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getTypeBadgeColor(account.type)}>
                          {t[account.type as keyof typeof t]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={account.isActive ? 'default' : 'secondary'}>
                          {account.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditAccount(account)}
                            data-testid={`button-edit-account-${account.id}`}
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                data-testid={`button-delete-account-${account.id}`}
                                disabled={deleteMutation.isPending}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Account?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete account <strong>{account.nameEn}</strong>? 
                                This action cannot be undone.
                                {account.isActive && (
                                  <span className="block mt-2 text-destructive font-medium">
                                    Note: This account cannot be deleted if it has existing transactions.
                                  </span>
                                )}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => handleDelete(account.id)}
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
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
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
