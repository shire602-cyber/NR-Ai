import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import {
  Users,
  Plus,
  Edit,
  Trash2,
  Calculator,
  CheckCircle,
  Download,
  FileText,
  Banknote,
  ChevronLeft,
  Eye,
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
import { Separator } from '@/components/ui/separator';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatCurrency } from '@/lib/format';
import { getAuthHeaders } from '@/lib/auth';
import { apiUrl } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────

interface Employee {
  id: string;
  company_id: string;
  employee_number: string | null;
  full_name: string;
  full_name_ar: string | null;
  nationality: string | null;
  passport_number: string | null;
  visa_number: string | null;
  labor_card_number: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  iban: string | null;
  routing_code: string | null;
  department: string | null;
  designation: string | null;
  join_date: string | null;
  basic_salary: string;
  housing_allowance: string;
  transport_allowance: string;
  other_allowance: string;
  total_salary: string;
  status: string;
  created_at: string;
}

interface PayrollRun {
  id: string;
  company_id: string;
  period_month: number;
  period_year: number;
  run_date: string | null;
  total_basic: string;
  total_allowances: string;
  total_deductions: string;
  total_net: string;
  employee_count: number;
  status: string;
  sif_file_content: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

interface PayrollItem {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  employee_name: string;
  employee_name_ar: string | null;
  employee_number: string | null;
  department: string | null;
  designation: string | null;
  basic_salary: string;
  housing_allowance: string;
  transport_allowance: string;
  other_allowance: string;
  overtime: string;
  deductions: string;
  deduction_notes: string | null;
  net_salary: string;
  payment_mode: string;
  status: string;
  created_at: string;
}

interface GratuityResult {
  employeeId: string;
  employeeName: string;
  joinDate: string;
  terminationDate: string;
  yearsOfService: number;
  basicSalary: number;
  dailyWage: number;
  firstFiveYears?: number;
  remainingYears?: number;
  firstFiveYearsGratuity: number;
  remainingYearsGratuity: number;
  totalGratuity: number;
  uncappedGratuity?: number;
  maxGratuity?: number;
  isCapped?: boolean;
  note?: string;
}

// ─── Schemas ─────────────────────────────────────────────

const employeeFormSchema = z.object({
  employeeNumber: z.string().optional(),
  fullName: z.string().min(1, 'Full name is required'),
  fullNameAr: z.string().optional(),
  nationality: z.string().optional(),
  passportNumber: z.string().optional(),
  visaNumber: z.string().optional(),
  laborCardNumber: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  iban: z.string().optional(),
  routingCode: z.string().optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  joinDate: z.string().optional(),
  basicSalary: z.coerce.number().min(0, 'Basic salary must be >= 0'),
  housingAllowance: z.coerce.number().min(0).default(0),
  transportAllowance: z.coerce.number().min(0).default(0),
  otherAllowance: z.coerce.number().min(0).default(0),
  status: z.string().default('active'),
});

type EmployeeFormData = z.infer<typeof employeeFormSchema>;

const payrollRunFormSchema = z.object({
  periodMonth: z.coerce.number().min(1).max(12),
  periodYear: z.coerce.number().min(2020).max(2099),
});

type PayrollRunFormData = z.infer<typeof payrollRunFormSchema>;

const payrollItemEditSchema = z.object({
  overtime: z.coerce.number().min(0).default(0),
  deductions: z.coerce.number().min(0).default(0),
  deductionNotes: z.string().optional(),
});

type PayrollItemEditData = z.infer<typeof payrollItemEditSchema>;

// ─── Month names ─────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─── Component ───────────────────────────────────────────

export default function Payroll() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();

  // Dialog states
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [payrollRunDialogOpen, setPayrollRunDialogOpen] = useState(false);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemDialogOpen, setEditItemDialogOpen] = useState(false);

  // Gratuity
  const [gratuityEmployeeId, setGratuityEmployeeId] = useState<string>('');
  const [gratuityTerminationDate, setGratuityTerminationDate] = useState<string>('');
  const [gratuityResult, setGratuityResult] = useState<GratuityResult | null>(null);

  // Search
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeToDelete, setEmployeeToDelete] = useState<string | null>(null);

  // ─── Queries ─────────────────────────────────────────

  const { data: employees = [], isLoading: isLoadingEmployees } = useQuery<Employee[]>({
    queryKey: [`/api/companies/${companyId}/employees`],
    enabled: !!companyId,
  });

  const { data: payrollRuns = [], isLoading: isLoadingRuns } = useQuery<PayrollRun[]>({
    queryKey: [`/api/companies/${companyId}/payroll-runs`],
    enabled: !!companyId,
  });

  const { data: payrollItems = [], isLoading: isLoadingItems } = useQuery<PayrollItem[]>({
    queryKey: [`/api/payroll-runs/${viewingRunId}/items`],
    enabled: !!viewingRunId,
  });

  const viewingRun = payrollRuns.find(r => r.id === viewingRunId);

  // ─── Forms ───────────────────────────────────────────

  const employeeForm = useForm<EmployeeFormData>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      employeeNumber: '',
      fullName: '',
      fullNameAr: '',
      nationality: '',
      passportNumber: '',
      visaNumber: '',
      laborCardNumber: '',
      bankName: '',
      bankAccountNumber: '',
      iban: '',
      routingCode: '',
      department: '',
      designation: '',
      joinDate: '',
      basicSalary: 0,
      housingAllowance: 0,
      transportAllowance: 0,
      otherAllowance: 0,
      status: 'active',
    },
  });

  const payrollRunForm = useForm<PayrollRunFormData>({
    resolver: zodResolver(payrollRunFormSchema),
    defaultValues: {
      periodMonth: new Date().getMonth() + 1,
      periodYear: new Date().getFullYear(),
    },
  });

  const payrollItemForm = useForm<PayrollItemEditData>({
    resolver: zodResolver(payrollItemEditSchema),
    defaultValues: {
      overtime: 0,
      deductions: 0,
      deductionNotes: '',
    },
  });

  // ─── Mutations ─────────────────────────────────────

  const createEmployeeMutation = useMutation({
    mutationFn: (data: EmployeeFormData) =>
      apiRequest('POST', `/api/companies/${companyId}/employees`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/employees`] });
      toast({ title: 'Employee Created', description: 'The employee has been added successfully.' });
      setEmployeeDialogOpen(false);
      employeeForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const updateEmployeeMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EmployeeFormData> }) =>
      apiRequest('PATCH', `/api/employees/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/employees`] });
      toast({ title: 'Employee Updated', description: 'The employee has been updated successfully.' });
      setEmployeeDialogOpen(false);
      setEditingEmployee(null);
      employeeForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const deleteEmployeeMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/employees/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/employees`] });
      toast({ title: 'Employee Deleted', description: 'The employee has been removed.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const createPayrollRunMutation = useMutation({
    mutationFn: (data: PayrollRunFormData) =>
      apiRequest('POST', `/api/companies/${companyId}/payroll-runs`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/payroll-runs`] });
      toast({ title: 'Payroll Run Created', description: 'The payroll run has been created as draft.' });
      setPayrollRunDialogOpen(false);
      payrollRunForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const calculatePayrollMutation = useMutation({
    mutationFn: (runId: string) =>
      apiRequest('POST', `/api/payroll-runs/${runId}/calculate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/payroll-runs`] });
      if (viewingRunId) {
        queryClient.invalidateQueries({ queryKey: [`/api/payroll-runs/${viewingRunId}/items`] });
      }
      toast({ title: 'Payroll Calculated', description: 'Payroll items have been generated from active employees.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const approvePayrollMutation = useMutation({
    mutationFn: (runId: string) =>
      apiRequest('POST', `/api/payroll-runs/${runId}/approve`),
    onMutate: async (runId: string) => {
      const queryKey = [`/api/companies/${companyId}/payroll-runs`] as const;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<any[]>(queryKey);
      queryClient.setQueryData<any[]>(queryKey, (old) =>
        old?.map((run: any) => (run.id === runId ? { ...run, status: 'approved' } : run)) ?? [],
      );
      return { previous, queryKey };
    },
    onSuccess: () => {
      if (viewingRunId) {
        queryClient.invalidateQueries({ queryKey: [`/api/payroll-runs/${viewingRunId}/items`] });
      }
      toast({ title: 'Payroll Approved', description: 'The payroll run has been approved and items marked as paid.' });
    },
    onError: (error: Error, _runId, context: any) => {
      if (context?.previous && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/payroll-runs`] });
    },
  });

  const updatePayrollItemMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PayrollItemEditData }) =>
      apiRequest('PATCH', `/api/payroll-items/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/payroll-runs`] });
      if (viewingRunId) {
        queryClient.invalidateQueries({ queryKey: [`/api/payroll-runs/${viewingRunId}/items`] });
      }
      toast({ title: 'Item Updated', description: 'Payroll item has been updated.' });
      setEditItemDialogOpen(false);
      setEditingItemId(null);
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const calculateGratuityMutation = useMutation({
    mutationFn: (data: { employeeId: string; terminationDate?: string }) =>
      apiRequest('POST', `/api/companies/${companyId}/payroll/gratuity-calculator`, data),
    onSuccess: (data: GratuityResult) => {
      setGratuityResult(data);
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  // ─── Handlers ──────────────────────────────────────

  const handleOpenCreateEmployee = () => {
    setEditingEmployee(null);
    employeeForm.reset({
      employeeNumber: '',
      fullName: '',
      fullNameAr: '',
      nationality: '',
      passportNumber: '',
      visaNumber: '',
      laborCardNumber: '',
      bankName: '',
      bankAccountNumber: '',
      iban: '',
      routingCode: '',
      department: '',
      designation: '',
      joinDate: '',
      basicSalary: 0,
      housingAllowance: 0,
      transportAllowance: 0,
      otherAllowance: 0,
      status: 'active',
    });
    setEmployeeDialogOpen(true);
  };

  const handleOpenEditEmployee = (emp: Employee) => {
    setEditingEmployee(emp);
    employeeForm.reset({
      employeeNumber: emp.employee_number || '',
      fullName: emp.full_name,
      fullNameAr: emp.full_name_ar || '',
      nationality: emp.nationality || '',
      passportNumber: emp.passport_number || '',
      visaNumber: emp.visa_number || '',
      laborCardNumber: emp.labor_card_number || '',
      bankName: emp.bank_name || '',
      bankAccountNumber: emp.bank_account_number || '',
      iban: emp.iban || '',
      routingCode: emp.routing_code || '',
      department: emp.department || '',
      designation: emp.designation || '',
      joinDate: emp.join_date ? emp.join_date.split('T')[0] : '',
      basicSalary: parseFloat(emp.basic_salary) || 0,
      housingAllowance: parseFloat(emp.housing_allowance) || 0,
      transportAllowance: parseFloat(emp.transport_allowance) || 0,
      otherAllowance: parseFloat(emp.other_allowance) || 0,
      status: emp.status,
    });
    setEmployeeDialogOpen(true);
  };

  const handleEmployeeSubmit = (data: EmployeeFormData) => {
    if (editingEmployee) {
      updateEmployeeMutation.mutate({ id: editingEmployee.id, data });
    } else {
      createEmployeeMutation.mutate(data);
    }
  };

  const handlePayrollRunSubmit = (data: PayrollRunFormData) => {
    createPayrollRunMutation.mutate(data);
  };

  const handleOpenEditItem = (item: PayrollItem) => {
    setEditingItemId(item.id);
    payrollItemForm.reset({
      overtime: parseFloat(item.overtime) || 0,
      deductions: parseFloat(item.deductions) || 0,
      deductionNotes: item.deduction_notes || '',
    });
    setEditItemDialogOpen(true);
  };

  const handleItemEditSubmit = (data: PayrollItemEditData) => {
    if (!editingItemId) return;
    updatePayrollItemMutation.mutate({ id: editingItemId, data });
  };

  const handleDownloadSIF = async (runId: string) => {
    try {
      const response = await fetch(apiUrl(`/api/payroll-runs/${runId}/generate-sif`), {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err?.message || 'Failed to generate SIF');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition');
      const filenameMatch = disposition?.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : 'payroll.SIF';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: 'SIF Downloaded', description: 'WPS SIF file has been downloaded.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message, variant: 'destructive' });
    }
  };

  const handleCalculateGratuity = () => {
    if (!gratuityEmployeeId) {
      toast({ title: 'Error', description: 'Please select an employee.', variant: 'destructive' });
      return;
    }
    calculateGratuityMutation.mutate({
      employeeId: gratuityEmployeeId,
      terminationDate: gratuityTerminationDate || undefined,
    });
  };

  // ─── Helpers ───────────────────────────────────────

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>;
      case 'inactive':
        return <Badge variant="secondary">Inactive</Badge>;
      case 'draft':
        return <Badge variant="outline">Draft</Badge>;
      case 'calculated':
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Calculated</Badge>;
      case 'approved':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Approved</Badge>;
      case 'pending':
        return <Badge variant="outline">Pending</Badge>;
      case 'paid':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Paid</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const filteredEmployees = employees.filter(emp => {
    if (!employeeSearch) return true;
    const q = employeeSearch.toLowerCase();
    return (
      emp.full_name.toLowerCase().includes(q) ||
      (emp.employee_number && emp.employee_number.toLowerCase().includes(q)) ||
      (emp.department && emp.department.toLowerCase().includes(q)) ||
      (emp.full_name_ar && emp.full_name_ar.includes(q))
    );
  });

  // ─── Loading / Guard ───────────────────────────────

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

  // ─── Render: Run detail view ───────────────────────

  if (viewingRunId && viewingRun) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => setViewingRunId(null)}>
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back to Payroll Runs
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  Payroll Run: {MONTHS[(viewingRun.period_month || 1) - 1]} {viewingRun.period_year}
                </CardTitle>
                <CardDescription className="mt-1 space-x-4">
                  <span>{viewingRun.employee_count} employees</span>
                  <span>Net: {formatCurrency(parseFloat(viewingRun.total_net) || 0, 'AED', locale)}</span>
                  <span>{getStatusBadge(viewingRun.status)}</span>
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {viewingRun.status === 'draft' && (
                  <Button
                    onClick={() => calculatePayrollMutation.mutate(viewingRunId)}
                    disabled={calculatePayrollMutation.isPending}
                    className="flex items-center gap-2"
                  >
                    <Calculator className="w-4 h-4" />
                    {calculatePayrollMutation.isPending ? 'Calculating...' : 'Calculate'}
                  </Button>
                )}
                {viewingRun.status === 'calculated' && (
                  <>
                    <Button
                      onClick={() => calculatePayrollMutation.mutate(viewingRunId)}
                      variant="outline"
                      disabled={calculatePayrollMutation.isPending}
                      className="flex items-center gap-2"
                    >
                      <Calculator className="w-4 h-4" />
                      Recalculate
                    </Button>
                    <Button
                      onClick={() => approvePayrollMutation.mutate(viewingRunId)}
                      disabled={approvePayrollMutation.isPending}
                      className="flex items-center gap-2 bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="w-4 h-4" />
                      {approvePayrollMutation.isPending ? 'Approving...' : 'Approve'}
                    </Button>
                  </>
                )}
                {(viewingRun.status === 'calculated' || viewingRun.status === 'approved') && (
                  <Button
                    variant="outline"
                    onClick={() => handleDownloadSIF(viewingRunId)}
                    className="flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Download SIF
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          {/* Summary cards */}
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="rounded-lg border p-3">
                <div className="text-sm text-muted-foreground">Total Basic</div>
                <div className="text-lg font-semibold">{formatCurrency(parseFloat(viewingRun.total_basic) || 0, 'AED', locale)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-sm text-muted-foreground">Total Allowances</div>
                <div className="text-lg font-semibold">{formatCurrency(parseFloat(viewingRun.total_allowances) || 0, 'AED', locale)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-sm text-muted-foreground">Total Deductions</div>
                <div className="text-lg font-semibold text-red-600">{formatCurrency(parseFloat(viewingRun.total_deductions) || 0, 'AED', locale)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-sm text-muted-foreground">Total Net Pay</div>
                <div className="text-lg font-semibold text-green-600">{formatCurrency(parseFloat(viewingRun.total_net) || 0, 'AED', locale)}</div>
              </div>
            </div>

            <Separator className="my-4" />

            {/* Payroll items table */}
            {isLoadingItems ? (
              <div className="text-center py-8 text-muted-foreground">Loading payroll items...</div>
            ) : payrollItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No payroll items yet. Click "Calculate" to auto-populate from active employees.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead className="text-right">Basic</TableHead>
                      <TableHead className="text-right">Allowances</TableHead>
                      <TableHead className="text-right">Overtime</TableHead>
                      <TableHead className="text-right">Deductions</TableHead>
                      <TableHead className="text-right">Net Salary</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payrollItems.map((item) => {
                      const allowances = (parseFloat(item.housing_allowance) || 0) +
                        (parseFloat(item.transport_allowance) || 0) +
                        (parseFloat(item.other_allowance) || 0);
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            <div>
                              {item.employee_name}
                              {item.employee_number && (
                                <div className="text-xs text-muted-foreground">#{item.employee_number}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{item.department || '-'}</TableCell>
                          <TableCell className="text-right">{formatCurrency(parseFloat(item.basic_salary) || 0, 'AED', locale)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(allowances, 'AED', locale)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(parseFloat(item.overtime) || 0, 'AED', locale)}</TableCell>
                          <TableCell className="text-right text-red-600">{formatCurrency(parseFloat(item.deductions) || 0, 'AED', locale)}</TableCell>
                          <TableCell className="text-right font-semibold">{formatCurrency(parseFloat(item.net_salary) || 0, 'AED', locale)}</TableCell>
                          <TableCell>{getStatusBadge(item.status)}</TableCell>
                          <TableCell className="text-right">
                            {viewingRun.status !== 'approved' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEditItem(item)}
                                title="Edit overtime/deductions"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                            )}
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

        {/* Edit payroll item dialog */}
        <Dialog open={editItemDialogOpen} onOpenChange={setEditItemDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Payroll Item</DialogTitle>
              <DialogDescription>Adjust overtime and deductions for this employee.</DialogDescription>
            </DialogHeader>

            <Form {...payrollItemForm}>
              <form onSubmit={payrollItemForm.handleSubmit(handleItemEditSubmit)} className="space-y-4">
                <FormField
                  control={payrollItemForm.control}
                  name="overtime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Overtime (AED)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={payrollItemForm.control}
                  name="deductions"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Deductions (AED)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={payrollItemForm.control}
                  name="deductionNotes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Deduction Notes</FormLabel>
                      <FormControl>
                        <Input placeholder="Reason for deduction" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setEditItemDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={updatePayrollItemMutation.isPending}>
                    {updatePayrollItemMutation.isPending ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ─── Render: Main tabbed view ──────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Banknote className="w-8 h-8" />
            Payroll & WPS
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage employee payroll, WPS compliance, and end-of-service gratuity
          </p>
        </div>
      </div>

      <Tabs defaultValue="employees" className="space-y-4">
        <TabsList>
          <TabsTrigger value="employees" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Employees
          </TabsTrigger>
          <TabsTrigger value="payroll-runs" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Payroll Runs
          </TabsTrigger>
          <TabsTrigger value="gratuity" className="flex items-center gap-2">
            <Calculator className="w-4 h-4" />
            Gratuity Calculator
          </TabsTrigger>
        </TabsList>

        {/* ─── Employees Tab ────────────────────────────── */}
        <TabsContent value="employees">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Employees</CardTitle>
                  <CardDescription>
                    {employees.length} employee{employees.length !== 1 ? 's' : ''} registered
                  </CardDescription>
                </div>
                <Button onClick={handleOpenCreateEmployee} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Add Employee
                </Button>
              </div>
              <div className="mt-4">
                <Input
                  placeholder="Search employees by name, number, or department..."
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  className="max-w-sm"
                />
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingEmployees ? (
                <div className="text-center py-8 text-muted-foreground">Loading employees...</div>
              ) : filteredEmployees.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {employeeSearch ? 'No employees match your search.' : 'No employees yet. Add your first employee to get started.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Employee #</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Designation</TableHead>
                        <TableHead className="text-right">Total Salary</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEmployees.map((emp) => (
                        <TableRow key={emp.id}>
                          <TableCell className="font-medium">
                            <div>
                              {emp.full_name}
                              {emp.full_name_ar && (
                                <div className="text-xs text-muted-foreground">{emp.full_name_ar}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{emp.employee_number || '-'}</TableCell>
                          <TableCell>{emp.department || '-'}</TableCell>
                          <TableCell>{emp.designation || '-'}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(parseFloat(emp.total_salary) || 0, 'AED', locale)}
                          </TableCell>
                          <TableCell>{getStatusBadge(emp.status)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEditEmployee(emp)}
                                title="Edit"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEmployeeToDelete(emp.id)}
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

        {/* ─── Payroll Runs Tab ─────────────────────────── */}
        <TabsContent value="payroll-runs">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Payroll Runs</CardTitle>
                  <CardDescription>
                    {payrollRuns.length} payroll run{payrollRuns.length !== 1 ? 's' : ''}
                  </CardDescription>
                </div>
                <Button onClick={() => setPayrollRunDialogOpen(true)} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  New Payroll Run
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingRuns ? (
                <div className="text-center py-8 text-muted-foreground">Loading payroll runs...</div>
              ) : payrollRuns.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No payroll runs yet. Create your first payroll run to get started.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Employees</TableHead>
                        <TableHead className="text-right">Total Net</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollRuns.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell className="font-medium">
                            {MONTHS[(run.period_month || 1) - 1]} {run.period_year}
                          </TableCell>
                          <TableCell className="text-right">{run.employee_count}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(parseFloat(run.total_net) || 0, 'AED', locale)}
                          </TableCell>
                          <TableCell>{getStatusBadge(run.status)}</TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {run.created_at ? format(new Date(run.created_at), 'MMM dd, yyyy') : '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewingRunId(run.id)}
                                title="View Details"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              {run.status === 'draft' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => calculatePayrollMutation.mutate(run.id)}
                                  disabled={calculatePayrollMutation.isPending}
                                  title="Calculate"
                                >
                                  <Calculator className="w-4 h-4" />
                                </Button>
                              )}
                              {run.status === 'calculated' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => approvePayrollMutation.mutate(run.id)}
                                  disabled={approvePayrollMutation.isPending}
                                  title="Approve"
                                  className="text-green-600 hover:text-green-700"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </Button>
                              )}
                              {(run.status === 'calculated' || run.status === 'approved') && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDownloadSIF(run.id)}
                                  title="Download SIF"
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                              )}
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

        {/* ─── Gratuity Calculator Tab ──────────────────── */}
        <TabsContent value="gratuity">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="w-5 h-5" />
                  End-of-Service Gratuity
                </CardTitle>
                <CardDescription>
                  Calculate gratuity per UAE labor law. 21 days per year for the first 5 years,
                  30 days per year thereafter. Maximum 2 years total salary.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Select Employee</label>
                  <Select
                    value={gratuityEmployeeId}
                    onValueChange={(v) => {
                      setGratuityEmployeeId(v);
                      setGratuityResult(null);
                    }}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Choose an employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.full_name} {emp.employee_number ? `(#${emp.employee_number})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium">Termination Date (optional)</label>
                  <Input
                    type="date"
                    value={gratuityTerminationDate}
                    onChange={(e) => setGratuityTerminationDate(e.target.value)}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Leave empty to calculate as of today.
                  </p>
                </div>

                <Button
                  onClick={handleCalculateGratuity}
                  disabled={calculateGratuityMutation.isPending || !gratuityEmployeeId}
                  className="w-full flex items-center gap-2"
                >
                  <Calculator className="w-4 h-4" />
                  {calculateGratuityMutation.isPending ? 'Calculating...' : 'Calculate Gratuity'}
                </Button>
              </CardContent>
            </Card>

            {gratuityResult && (
              <Card>
                <CardHeader>
                  <CardTitle>Gratuity Breakdown</CardTitle>
                  <CardDescription>For {gratuityResult.employeeName}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {gratuityResult.note ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      {gratuityResult.note}
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="text-muted-foreground">Join Date</div>
                        <div className="font-medium">{gratuityResult.joinDate ? format(new Date(gratuityResult.joinDate), 'MMM dd, yyyy') : '-'}</div>

                        <div className="text-muted-foreground">Termination Date</div>
                        <div className="font-medium">{format(new Date(gratuityResult.terminationDate), 'MMM dd, yyyy')}</div>

                        <div className="text-muted-foreground">Years of Service</div>
                        <div className="font-medium">{gratuityResult.yearsOfService} years</div>

                        <div className="text-muted-foreground">Basic Salary</div>
                        <div className="font-medium">{formatCurrency(gratuityResult.basicSalary, 'AED', locale)}</div>

                        <div className="text-muted-foreground">Daily Wage (Basic / 30)</div>
                        <div className="font-medium">{formatCurrency(gratuityResult.dailyWage, 'AED', locale)}</div>
                      </div>

                      <Separator />

                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="text-muted-foreground">First 5 years ({gratuityResult.firstFiveYears} yrs x 21 days)</div>
                        <div className="font-medium">{formatCurrency(gratuityResult.firstFiveYearsGratuity, 'AED', locale)}</div>

                        <div className="text-muted-foreground">After 5 years ({gratuityResult.remainingYears} yrs x 30 days)</div>
                        <div className="font-medium">{formatCurrency(gratuityResult.remainingYearsGratuity, 'AED', locale)}</div>
                      </div>

                      <Separator />

                      <div className="grid grid-cols-2 gap-2">
                        <div className="text-lg font-semibold">Total Gratuity</div>
                        <div className="text-lg font-bold text-green-600">
                          {formatCurrency(gratuityResult.totalGratuity, 'AED', locale)}
                        </div>
                      </div>

                      {gratuityResult.isCapped && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                          Gratuity capped at 2 years total salary ({formatCurrency(gratuityResult.maxGratuity || 0, 'AED', locale)}).
                          Uncapped amount: {formatCurrency(gratuityResult.uncappedGratuity || 0, 'AED', locale)}.
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ─── Employee Create/Edit Dialog ──────────────── */}
      <Dialog open={employeeDialogOpen} onOpenChange={setEmployeeDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEmployee ? 'Edit Employee' : 'Add Employee'}</DialogTitle>
            <DialogDescription>
              {editingEmployee ? 'Update employee details.' : 'Add a new employee to payroll.'}
            </DialogDescription>
          </DialogHeader>

          <Form {...employeeForm}>
            <form onSubmit={employeeForm.handleSubmit(handleEmployeeSubmit)} className="space-y-4">
              {/* Personal Information */}
              <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Personal Information</div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={employeeForm.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Full name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={employeeForm.control}
                  name="fullNameAr"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name (Arabic)</FormLabel>
                      <FormControl>
                        <Input placeholder="الاسم الكامل" dir="rtl" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={employeeForm.control}
                  name="employeeNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employee Number</FormLabel>
                      <FormControl>
                        <Input placeholder="EMP-001" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={employeeForm.control}
                  name="nationality"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nationality</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., UAE" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={employeeForm.control}
                  name="joinDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Join Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Work Information */}
              <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-2">Work Information</div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={employeeForm.control}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Finance" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={employeeForm.control}
                  name="designation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Designation</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Accountant" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Identity Documents */}
              <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-2">Identity & Documents</div>
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={employeeForm.control}
                  name="passportNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Passport Number</FormLabel>
                      <FormControl>
                        <Input placeholder="Passport #" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={employeeForm.control}
                  name="visaNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Visa Number</FormLabel>
                      <FormControl>
                        <Input placeholder="Visa #" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={employeeForm.control}
                  name="laborCardNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Labor Card Number</FormLabel>
                      <FormControl>
                        <Input placeholder="Labor Card #" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Banking Details */}
              <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-2">Banking Details</div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={employeeForm.control}
                  name="bankName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bank Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Emirates NBD" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={employeeForm.control}
                  name="bankAccountNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Number</FormLabel>
                      <FormControl>
                        <Input placeholder="Account #" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={employeeForm.control}
                  name="iban"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>IBAN</FormLabel>
                      <FormControl>
                        <Input placeholder="AE..." {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={employeeForm.control}
                  name="routingCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Routing Code</FormLabel>
                      <FormControl>
                        <Input placeholder="Bank routing code" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Salary */}
              <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-2">Salary Details (AED)</div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={employeeForm.control}
                  name="basicSalary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Basic Salary *</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={employeeForm.control}
                  name="housingAllowance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Housing Allowance</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={employeeForm.control}
                  name="transportAllowance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Transport Allowance</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={employeeForm.control}
                  name="otherAllowance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Other Allowance</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Status */}
              <FormField
                control={employeeForm.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setEmployeeDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createEmployeeMutation.isPending || updateEmployeeMutation.isPending}
                >
                  {(createEmployeeMutation.isPending || updateEmployeeMutation.isPending)
                    ? 'Saving...'
                    : editingEmployee
                      ? 'Save Changes'
                      : 'Add Employee'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Create Payroll Run Dialog ───────────────── */}
      <Dialog open={payrollRunDialogOpen} onOpenChange={setPayrollRunDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Payroll Run</DialogTitle>
            <DialogDescription>
              Create a new payroll run for a specific month and year.
            </DialogDescription>
          </DialogHeader>

          <Form {...payrollRunForm}>
            <form onSubmit={payrollRunForm.handleSubmit(handlePayrollRunSubmit)} className="space-y-4">
              <FormField
                control={payrollRunForm.control}
                name="periodMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Month *</FormLabel>
                    <Select onValueChange={(v) => field.onChange(parseInt(v))} value={String(field.value)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select month" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MONTHS.map((month, index) => (
                          <SelectItem key={index + 1} value={String(index + 1)}>
                            {month}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={payrollRunForm.control}
                name="periodYear"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Year *</FormLabel>
                    <FormControl>
                      <Input type="number" min="2020" max="2099" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setPayrollRunDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createPayrollRunMutation.isPending}>
                  {createPayrollRunMutation.isPending ? 'Creating...' : 'Create Run'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!employeeToDelete} onOpenChange={(open) => { if (!open) setEmployeeToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Employee?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this employee record. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (employeeToDelete) {
                  deleteEmployeeMutation.mutate(employeeToDelete);
                  setEmployeeToDelete(null);
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
