import { useState, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import {
  Wallet,
  Plus,
  Edit,
  Trash2,
  CheckCircle,
  FileSpreadsheet,
  BarChart3,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatCurrency } from '@/lib/format';

// ─── Types ───────────────────────────────────────────────

interface BudgetPlan {
  id: string;
  company_id: string;
  name: string;
  fiscal_year: number;
  start_date: string;
  end_date: string;
  status: string;
  notes: string | null;
  created_at: string;
  total_budget?: string;
}

interface BudgetLine {
  id: string;
  budget_id: string;
  account_id: string | null;
  category: string;
  description: string | null;
  jan: string;
  feb: string;
  mar: string;
  apr: string;
  may: string;
  jun: string;
  jul: string;
  aug: string;
  sep: string;
  oct: string;
  nov: string;
  dec: string;
  annual_total: string;
  created_at: string;
}

interface VarianceMonth {
  budget: number;
  actual: number;
  variance: number;
  variancePercent: number;
}

interface VarianceLine {
  id: string;
  category: string;
  description: string | null;
  accountId: string | null;
  months: Record<string, VarianceMonth>;
  totals: {
    budget: number;
    actual: number;
    variance: number;
    variancePercent: number;
  };
}

interface VarianceData {
  budget: {
    id: string;
    name: string;
    fiscalYear: number;
    startDate: string;
    endDate: string;
    status: string;
  };
  varianceLines: VarianceLine[];
}

// ─── Schemas ─────────────────────────────────────────────

const budgetFormSchema = z.object({
  name: z.string().min(1, 'Budget name is required'),
  fiscalYear: z.coerce.number().int().min(2000).max(2100),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  notes: z.string().optional().nullable(),
});

type BudgetFormData = z.infer<typeof budgetFormSchema>;

const budgetLineFormSchema = z.object({
  category: z.string().min(1, 'Category is required'),
  description: z.string().optional().nullable(),
  jan: z.coerce.number().min(0).optional(),
  feb: z.coerce.number().min(0).optional(),
  mar: z.coerce.number().min(0).optional(),
  apr: z.coerce.number().min(0).optional(),
  may: z.coerce.number().min(0).optional(),
  jun: z.coerce.number().min(0).optional(),
  jul: z.coerce.number().min(0).optional(),
  aug: z.coerce.number().min(0).optional(),
  sep: z.coerce.number().min(0).optional(),
  oct: z.coerce.number().min(0).optional(),
  nov: z.coerce.number().min(0).optional(),
  dec: z.coerce.number().min(0).optional(),
});

type BudgetLineFormData = z.infer<typeof budgetLineFormSchema>;

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const BUDGET_CATEGORIES = [
  'Revenue', 'Cost of Goods Sold', 'Salaries & Wages', 'Rent & Utilities',
  'Marketing', 'Travel & Entertainment', 'Office Supplies', 'Professional Services',
  'Insurance', 'Depreciation', 'Technology', 'Miscellaneous', 'Other'
];

// ─── Component ───────────────────────────────────────────

export default function Budgets() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();

  const [activeTab, setActiveTab] = useState('budgets');
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetPlan | null>(null);
  const [selectedBudget, setSelectedBudget] = useState<BudgetPlan | null>(null);
  const [addLineDialogOpen, setAddLineDialogOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<BudgetLine | null>(null);
  const [budgetToDelete, setBudgetToDelete] = useState<string | null>(null);
  const [lineToDelete, setLineToDelete] = useState<string | null>(null);

  // ─── Queries ────────────────────────────────────────────

  const { data: budgetPlans = [], isLoading: isLoadingBudgets } = useQuery<BudgetPlan[]>({
    queryKey: [`/api/companies/${companyId}/budget-plans`],
    enabled: !!companyId,
  });

  const { data: budgetLines = [], isLoading: isLoadingLines } = useQuery<BudgetLine[]>({
    queryKey: [`/api/budget-plans/${selectedBudget?.id}/lines`],
    enabled: !!selectedBudget?.id,
  });

  const { data: varianceData, isLoading: isLoadingVariance } = useQuery<VarianceData>({
    queryKey: [`/api/budget-plans/${selectedBudget?.id}/variance`],
    enabled: !!selectedBudget?.id && activeTab === 'variance',
  });

  // ─── Forms ──────────────────────────────────────────────

  const budgetForm = useForm<BudgetFormData>({
    resolver: zodResolver(budgetFormSchema),
    defaultValues: {
      name: '',
      fiscalYear: new Date().getFullYear(),
      startDate: '',
      endDate: '',
      notes: '',
    },
  });

  const lineForm = useForm<BudgetLineFormData>({
    resolver: zodResolver(budgetLineFormSchema),
    defaultValues: {
      category: '',
      description: '',
      jan: 0, feb: 0, mar: 0, apr: 0, may: 0, jun: 0,
      jul: 0, aug: 0, sep: 0, oct: 0, nov: 0, dec: 0,
    },
  });

  // ─── Mutations ──────────────────────────────────────────

  const createBudgetMutation = useMutation({
    mutationFn: (data: BudgetFormData) =>
      apiRequest('POST', `/api/companies/${companyId}/budget-plans`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({ title: 'Budget Created', description: 'The budget plan has been created successfully.' });
      setBudgetDialogOpen(false);
      budgetForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const updateBudgetMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BudgetFormData> }) =>
      apiRequest('PATCH', `/api/budget-plans/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({ title: 'Budget Updated', description: 'The budget plan has been updated.' });
      setBudgetDialogOpen(false);
      setEditingBudget(null);
      budgetForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const deleteBudgetMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/budget-plans/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({ title: 'Budget Deleted', description: 'The budget plan has been deleted.' });
      if (selectedBudget) setSelectedBudget(null);
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const approveBudgetMutation = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/budget-plans/${id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({ title: 'Budget Approved', description: 'The budget has been approved.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const addLineMutation = useMutation({
    mutationFn: (data: BudgetLineFormData) =>
      apiRequest('POST', `/api/budget-plans/${selectedBudget?.id}/lines`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/budget-plans/${selectedBudget?.id}/lines`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({ title: 'Line Added', description: 'Budget line has been added.' });
      setAddLineDialogOpen(false);
      setEditingLine(null);
      lineForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const updateLineMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BudgetLineFormData> }) =>
      apiRequest('PATCH', `/api/budget-lines/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/budget-plans/${selectedBudget?.id}/lines`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({ title: 'Line Updated', description: 'Budget line has been updated.' });
      setAddLineDialogOpen(false);
      setEditingLine(null);
      lineForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/budget-lines/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/budget-plans/${selectedBudget?.id}/lines`] });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({ title: 'Line Deleted', description: 'Budget line has been removed.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  // ─── Handlers ───────────────────────────────────────────

  const handleOpenCreateBudget = () => {
    setEditingBudget(null);
    const year = new Date().getFullYear();
    budgetForm.reset({
      name: '',
      fiscalYear: year,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      notes: '',
    });
    setBudgetDialogOpen(true);
  };

  const handleOpenEditBudget = (budget: BudgetPlan) => {
    setEditingBudget(budget);
    budgetForm.reset({
      name: budget.name,
      fiscalYear: budget.fiscal_year,
      startDate: budget.start_date ? format(new Date(budget.start_date), 'yyyy-MM-dd') : '',
      endDate: budget.end_date ? format(new Date(budget.end_date), 'yyyy-MM-dd') : '',
      notes: budget.notes || '',
    });
    setBudgetDialogOpen(true);
  };

  const handleBudgetSubmit = (data: BudgetFormData) => {
    if (editingBudget) {
      updateBudgetMutation.mutate({ id: editingBudget.id, data });
    } else {
      createBudgetMutation.mutate(data);
    }
  };

  const handleSelectBudget = (budget: BudgetPlan) => {
    setSelectedBudget(budget);
    setActiveTab('detail');
  };

  const handleBackToBudgets = () => {
    setSelectedBudget(null);
    setActiveTab('budgets');
  };

  const handleOpenAddLine = () => {
    setEditingLine(null);
    lineForm.reset({
      category: '',
      description: '',
      jan: 0, feb: 0, mar: 0, apr: 0, may: 0, jun: 0,
      jul: 0, aug: 0, sep: 0, oct: 0, nov: 0, dec: 0,
    });
    setAddLineDialogOpen(true);
  };

  const handleOpenEditLine = (line: BudgetLine) => {
    setEditingLine(line);
    lineForm.reset({
      category: line.category,
      description: line.description || '',
      jan: parseFloat(line.jan || '0'),
      feb: parseFloat(line.feb || '0'),
      mar: parseFloat(line.mar || '0'),
      apr: parseFloat(line.apr || '0'),
      may: parseFloat(line.may || '0'),
      jun: parseFloat(line.jun || '0'),
      jul: parseFloat(line.jul || '0'),
      aug: parseFloat(line.aug || '0'),
      sep: parseFloat(line.sep || '0'),
      oct: parseFloat(line.oct || '0'),
      nov: parseFloat(line.nov || '0'),
      dec: parseFloat(line.dec || '0'),
    });
    setAddLineDialogOpen(true);
  };

  const handleLineSubmit = (data: BudgetLineFormData) => {
    if (editingLine) {
      updateLineMutation.mutate({ id: editingLine.id, data });
    } else {
      addLineMutation.mutate(data);
    }
  };

  // Watch all month fields to compute annual total in the form
  const watchedMonths = lineForm.watch([...MONTH_KEYS]);
  const computedAnnualTotal = MONTH_KEYS.reduce((sum, key, idx) => {
    const val = parseFloat(String(watchedMonths[idx] || 0));
    return sum + (isNaN(val) ? 0 : val);
  }, 0);

  // ─── Helpers ────────────────────────────────────────────

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="secondary">Draft</Badge>;
      case 'approved':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Approved</Badge>;
      case 'closed':
        return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100">Closed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getVarianceColor = (variance: number) => {
    if (variance > 0) return 'text-green-600';
    if (variance < 0) return 'text-red-600';
    return '';
  };

  // Compute totals row for budget lines
  const lineTotals = useCallback(() => {
    const totals: Record<string, number> = {};
    MONTH_KEYS.forEach(key => { totals[key] = 0; });
    totals.annual = 0;

    budgetLines.forEach(line => {
      MONTH_KEYS.forEach(key => {
        totals[key] += parseFloat((line as any)[key] || '0');
      });
      totals.annual += parseFloat(line.annual_total || '0');
    });

    return totals;
  }, [budgetLines]);

  // ─── Loading State ─────────────────────────────────────

  if (isLoadingCompany) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">{t.loading || 'Loading...'}</div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Please create a company first.</div>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {selectedBudget && (
            <Button variant="ghost" size="sm" onClick={handleBackToBudgets}>
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          )}
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Wallet className="w-8 h-8" />
              {selectedBudget ? selectedBudget.name : 'Budgets'}
            </h1>
            <p className="text-muted-foreground mt-1">
              {selectedBudget
                ? `FY ${selectedBudget.fiscal_year} - ${getStatusBadge(selectedBudget.status).props.children}`
                : 'Plan, track, and analyze your budgets'}
            </p>
          </div>
        </div>
        {!selectedBudget && (
          <Button onClick={handleOpenCreateBudget} className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Budget
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="budgets" className="flex items-center gap-2">
            <Wallet className="w-4 h-4" />
            Budgets
          </TabsTrigger>
          {selectedBudget && (
            <>
              <TabsTrigger value="detail" className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                Budget Detail
              </TabsTrigger>
              <TabsTrigger value="variance" className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Variance
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* ─── Budgets List Tab ──────────────────────────── */}
        <TabsContent value="budgets">
          <Card>
            <CardHeader>
              <CardTitle>Budget Plans</CardTitle>
              <CardDescription>
                {budgetPlans.length} budget plan{budgetPlans.length !== 1 ? 's' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingBudgets ? (
                <div className="text-center py-8 text-muted-foreground">{t.loading || 'Loading...'}</div>
              ) : budgetPlans.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No budget plans yet. Create your first budget to get started.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Year</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total Budget</TableHead>
                        <TableHead className="text-right">{t.actions || 'Actions'}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {budgetPlans.map((budget) => (
                        <TableRow
                          key={budget.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleSelectBudget(budget)}
                        >
                          <TableCell className="font-medium">{budget.name}</TableCell>
                          <TableCell>{budget.fiscal_year}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {budget.start_date ? format(new Date(budget.start_date), 'MMM yyyy') : '-'}
                            {' - '}
                            {budget.end_date ? format(new Date(budget.end_date), 'MMM yyyy') : '-'}
                          </TableCell>
                          <TableCell>{getStatusBadge(budget.status)}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(parseFloat(budget.total_budget || '0'), 'AED', locale)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              {budget.status === 'draft' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => approveBudgetMutation.mutate(budget.id)}
                                  title="Approve"
                                  className="text-green-600 hover:text-green-700"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEditBudget(budget)}
                                title="Edit"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setBudgetToDelete(budget.id)}
                                title="Delete"
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Budget Detail Tab (Spreadsheet Grid) ─────── */}
        {selectedBudget && (
          <TabsContent value="detail">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Budget Lines - {selectedBudget.name}</CardTitle>
                    <CardDescription>
                      Monthly budget allocation by category. Click a row to edit.
                    </CardDescription>
                  </div>
                  <Button onClick={handleOpenAddLine} className="flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    Add Line
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingLines ? (
                  <div className="text-center py-8 text-muted-foreground">{t.loading || 'Loading...'}</div>
                ) : budgetLines.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No budget lines yet. Add categories and monthly allocations.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky left-0 bg-background z-10 min-w-[160px]">Category</TableHead>
                          {MONTH_LABELS.map((label) => (
                            <TableHead key={label} className="text-right min-w-[90px]">{label}</TableHead>
                          ))}
                          <TableHead className="text-right min-w-[110px] font-bold">Annual Total</TableHead>
                          <TableHead className="text-right min-w-[80px]">{t.actions || 'Actions'}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {budgetLines.map((line) => (
                          <TableRow
                            key={line.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => handleOpenEditLine(line)}
                          >
                            <TableCell className="sticky left-0 bg-background z-10 font-medium">
                              <div>
                                {line.category}
                                {line.description && (
                                  <div className="text-xs text-muted-foreground">{line.description}</div>
                                )}
                              </div>
                            </TableCell>
                            {MONTH_KEYS.map((key) => (
                              <TableCell key={key} className="text-right font-mono text-sm">
                                {formatCurrency(parseFloat((line as any)[key] || '0'), 'AED', locale)}
                              </TableCell>
                            ))}
                            <TableCell className="text-right font-mono font-bold text-sm">
                              {formatCurrency(parseFloat(line.annual_total || '0'), 'AED', locale)}
                            </TableCell>
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setLineToDelete(line.id)}
                                title="Delete"
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="bg-muted/50 font-bold">
                          <TableCell className="sticky left-0 bg-muted/50 z-10">TOTAL</TableCell>
                          {MONTH_KEYS.map((key) => (
                            <TableCell key={key} className="text-right font-mono text-sm">
                              {formatCurrency(lineTotals()[key], 'AED', locale)}
                            </TableCell>
                          ))}
                          <TableCell className="text-right font-mono text-sm">
                            {formatCurrency(lineTotals().annual, 'AED', locale)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ─── Variance Tab ────────────────────────────── */}
        {selectedBudget && (
          <TabsContent value="variance">
            <Card>
              <CardHeader>
                <CardTitle>Budget vs Actual Variance - {selectedBudget.name}</CardTitle>
                <CardDescription>
                  Comparing budgeted amounts against actual journal entries. Green = under budget, Red = over budget.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingVariance ? (
                  <div className="text-center py-8 text-muted-foreground">{t.loading || 'Loading...'}</div>
                ) : !varianceData || varianceData.varianceLines.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No variance data available. Add budget lines with account links to compare against actuals.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky left-0 bg-background z-10 min-w-[160px]">Category</TableHead>
                          {MONTH_LABELS.map((label) => (
                            <TableHead key={label} className="text-center min-w-[200px]">
                              <div>{label}</div>
                              <div className="flex text-xs text-muted-foreground mt-1">
                                <span className="flex-1 text-right pr-1">Budget</span>
                                <span className="flex-1 text-right pr-1">Actual</span>
                                <span className="flex-1 text-right">Var</span>
                              </div>
                            </TableHead>
                          ))}
                          <TableHead className="text-center min-w-[200px]">
                            <div>Annual</div>
                            <div className="flex text-xs text-muted-foreground mt-1">
                              <span className="flex-1 text-right pr-1">Budget</span>
                              <span className="flex-1 text-right pr-1">Actual</span>
                              <span className="flex-1 text-right">Var %</span>
                            </div>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {varianceData.varianceLines.map((line) => (
                          <TableRow key={line.id}>
                            <TableCell className="sticky left-0 bg-background z-10 font-medium">
                              <div>
                                {line.category}
                                {line.description && (
                                  <div className="text-xs text-muted-foreground">{line.description}</div>
                                )}
                              </div>
                            </TableCell>
                            {MONTH_KEYS.map((key) => {
                              const m = line.months[key];
                              return (
                                <TableCell key={key} className="text-right">
                                  <div className="flex text-xs font-mono">
                                    <span className="flex-1 text-right pr-1">{m.budget.toFixed(0)}</span>
                                    <span className="flex-1 text-right pr-1">{m.actual.toFixed(0)}</span>
                                    <span className={`flex-1 text-right font-semibold ${getVarianceColor(m.variance)}`}>
                                      {m.variance >= 0 ? '+' : ''}{m.variance.toFixed(0)}
                                    </span>
                                  </div>
                                </TableCell>
                              );
                            })}
                            <TableCell className="text-right">
                              <div className="flex text-xs font-mono">
                                <span className="flex-1 text-right pr-1">{line.totals.budget.toFixed(0)}</span>
                                <span className="flex-1 text-right pr-1">{line.totals.actual.toFixed(0)}</span>
                                <span className={`flex-1 text-right font-bold ${getVarianceColor(line.totals.variance)}`}>
                                  {line.totals.variancePercent >= 0 ? '+' : ''}{line.totals.variancePercent.toFixed(1)}%
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Variance Summary Cards */}
                {varianceData && varianceData.varianceLines.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Total Budget</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {formatCurrency(
                            varianceData.varianceLines.reduce((s, l) => s + l.totals.budget, 0),
                            'AED',
                            locale
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Total Actual</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {formatCurrency(
                            varianceData.varianceLines.reduce((s, l) => s + l.totals.actual, 0),
                            'AED',
                            locale
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Total Variance</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {(() => {
                          const totalVar = varianceData.varianceLines.reduce((s, l) => s + l.totals.variance, 0);
                          return (
                            <div className={`text-2xl font-bold flex items-center gap-2 ${getVarianceColor(totalVar)}`}>
                              {totalVar >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                              {formatCurrency(Math.abs(totalVar), 'AED', locale)}
                              <span className="text-sm font-normal">
                                {totalVar >= 0 ? 'under budget' : 'over budget'}
                              </span>
                            </div>
                          );
                        })()}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* ─── Budget Create/Edit Dialog ─────────────────── */}
      <Dialog open={budgetDialogOpen} onOpenChange={setBudgetDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingBudget ? 'Edit Budget Plan' : 'Create Budget Plan'}</DialogTitle>
            <DialogDescription>
              {editingBudget ? 'Update budget details.' : 'Create a new annual budget plan.'}
            </DialogDescription>
          </DialogHeader>

          <Form {...budgetForm}>
            <form onSubmit={budgetForm.handleSubmit(handleBudgetSubmit)} className="space-y-4">
              <FormField
                control={budgetForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Budget Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., FY 2026 Operating Budget" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={budgetForm.control}
                name="fiscalYear"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fiscal Year *</FormLabel>
                    <FormControl>
                      <Input type="number" min="2000" max="2100" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={budgetForm.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={budgetForm.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Date *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={budgetForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Optional notes" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setBudgetDialogOpen(false)}>
                  {t.cancel || 'Cancel'}
                </Button>
                <Button
                  type="submit"
                  disabled={createBudgetMutation.isPending || updateBudgetMutation.isPending}
                >
                  {(createBudgetMutation.isPending || updateBudgetMutation.isPending)
                    ? (t.loading || 'Loading...')
                    : editingBudget
                      ? (t.save || 'Save')
                      : 'Create Budget'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Budget Line Add/Edit Dialog ───────────────── */}
      <Dialog open={addLineDialogOpen} onOpenChange={setAddLineDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingLine ? 'Edit Budget Line' : 'Add Budget Line'}</DialogTitle>
            <DialogDescription>
              {editingLine ? 'Update monthly allocations.' : 'Add a category with monthly budget amounts.'}
            </DialogDescription>
          </DialogHeader>

          <Form {...lineForm}>
            <form onSubmit={lineForm.handleSubmit(handleLineSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={lineForm.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {BUDGET_CATEGORIES.map((cat) => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={lineForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Input placeholder="Optional detail" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="border rounded-lg p-4">
                <h4 className="font-medium mb-3">Monthly Amounts (AED)</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {MONTH_KEYS.map((key, idx) => (
                    <FormField
                      key={key}
                      control={lineForm.control}
                      name={key}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">{MONTH_LABELS[idx]}</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="0" {...field} className="text-sm" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t flex justify-between items-center">
                  <span className="font-medium text-sm">Annual Total:</span>
                  <span className="font-bold text-lg">{formatCurrency(computedAnnualTotal, 'AED', locale)}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setAddLineDialogOpen(false)}>
                  {t.cancel || 'Cancel'}
                </Button>
                <Button
                  type="submit"
                  disabled={addLineMutation.isPending || updateLineMutation.isPending}
                >
                  {(addLineMutation.isPending || updateLineMutation.isPending)
                    ? (t.loading || 'Loading...')
                    : editingLine
                      ? (t.save || 'Save')
                      : 'Add Line'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!budgetToDelete} onOpenChange={(open) => { if (!open) setBudgetToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Budget Plan?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this budget plan and all its lines. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (budgetToDelete) {
                  deleteBudgetMutation.mutate(budgetToDelete);
                  setBudgetToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!lineToDelete} onOpenChange={(open) => { if (!open) setLineToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Budget Line?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this budget line. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (lineToDelete) {
                  deleteLineMutation.mutate(lineToDelete);
                  setLineToDelete(null);
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
