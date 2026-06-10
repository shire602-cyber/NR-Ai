import { PageHeader } from '@/components/ui/page-header';
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
  Search,
} from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { UpgradePrompt } from '@/components/UpgradePrompt';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { formatCurrency } from '@/lib/format';
import type { Employee } from '@shared/schema';

// ─── Schemas ──────────────────────────────────────────────

const employeeFormSchema = z.object({
  employeeNumber: z.string().min(1, 'Employee number is required'),
  name: z.string().min(1, 'Name is required'),
  nameAr: z.string().optional().nullable(),
  email: z.string().email('Invalid email').optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
  emiratesId: z.string().optional().nullable(),
  passportNumber: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  bankAccountNumber: z.string().optional().nullable(),
  bankIban: z.string().optional().nullable(),
  basicSalary: z.coerce.number().min(0, 'Salary must be >= 0'),
  housingAllowance: z.coerce.number().min(0).optional().nullable(),
  transportAllowance: z.coerce.number().min(0).optional().nullable(),
  otherAllowances: z.coerce.number().min(0).optional().nullable(),
  joinDate: z.string().optional().nullable(),
  status: z.enum(['active', 'on_leave', 'terminated']),
});

type EmployeeFormData = z.infer<typeof employeeFormSchema>;

// ─── Component ────────────────────────────────────────────

export default function Employees() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // ─── Queries ──────────────────────────────────────────

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: [`/api/companies/${companyId}/employees`],
    enabled: !!companyId,
  });

  // ─── Form ─────────────────────────────────────────────

  const form = useForm<EmployeeFormData>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      employeeNumber: '',
      name: '',
      nameAr: '',
      email: '',
      phone: '',
      position: '',
      department: '',
      nationality: '',
      emiratesId: '',
      passportNumber: '',
      bankName: '',
      bankAccountNumber: '',
      bankIban: '',
      basicSalary: 0,
      housingAllowance: 0,
      transportAllowance: 0,
      otherAllowances: 0,
      joinDate: '',
      status: 'active',
    },
  });

  // ─── Mutations ────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: EmployeeFormData) =>
      apiRequest('POST', `/api/companies/${companyId}/employees`, {
        ...data,
        joinDate: data.joinDate ? new Date(data.joinDate).toISOString() : null,
        email: data.email || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/employees`] });
      toast({ title: 'Employee Created', description: 'Employee has been added successfully.' });
      setDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EmployeeFormData> }) =>
      apiRequest('PUT', `/api/employees/${id}`, {
        ...data,
        joinDate: data.joinDate ? new Date(data.joinDate).toISOString() : null,
        email: data.email || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/employees`] });
      toast({ title: 'Employee Updated', description: 'Employee details have been updated.' });
      setDialogOpen(false);
      setEditingEmployee(null);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/employees/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/employees`] });
      toast({ title: 'Employee Deleted', description: 'Employee has been removed.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error?.message, variant: 'destructive' });
    },
  });

  // ─── Handlers ─────────────────────────────────────────

  const handleOpenCreateDialog = () => {
    setEditingEmployee(null);
    form.reset({
      employeeNumber: '',
      name: '',
      nameAr: '',
      email: '',
      phone: '',
      position: '',
      department: '',
      nationality: '',
      emiratesId: '',
      passportNumber: '',
      bankName: '',
      bankAccountNumber: '',
      bankIban: '',
      basicSalary: 0,
      housingAllowance: 0,
      transportAllowance: 0,
      otherAllowances: 0,
      joinDate: '',
      status: 'active',
    });
    setDialogOpen(true);
  };

  const handleOpenEditDialog = (employee: Employee) => {
    setEditingEmployee(employee);
    form.reset({
      employeeNumber: employee.employeeNumber,
      name: employee.name,
      nameAr: employee.nameAr || '',
      email: employee.email || '',
      phone: employee.phone || '',
      position: employee.position || '',
      department: employee.department || '',
      nationality: employee.nationality || '',
      emiratesId: employee.emiratesId || '',
      passportNumber: employee.passportNumber || '',
      bankName: employee.bankName || '',
      bankAccountNumber: employee.bankAccountNumber || '',
      bankIban: employee.bankIban || '',
      basicSalary: employee.basicSalary || 0,
      housingAllowance: employee.housingAllowance || 0,
      transportAllowance: employee.transportAllowance || 0,
      otherAllowances: employee.otherAllowances || 0,
      joinDate: employee.joinDate ? format(new Date(employee.joinDate), 'yyyy-MM-dd') : '',
      status: (employee.status as 'active' | 'on_leave' | 'terminated') || 'active',
    });
    setDialogOpen(true);
  };

  const handleSubmit = (data: EmployeeFormData) => {
    if (editingEmployee) {
      updateMutation.mutate({ id: editingEmployee.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  // ─── Helpers ──────────────────────────────────────────

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>;
      case 'on_leave':
        return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">On Leave</Badge>;
      case 'terminated':
        return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Terminated</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const filteredEmployees = employees.filter((emp) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      emp.name.toLowerCase().includes(q) ||
      emp.employeeNumber.toLowerCase().includes(q) ||
      (emp.department?.toLowerCase().includes(q) ?? false) ||
      (emp.position?.toLowerCase().includes(q) ?? false)
    );
  });

  const activeCount = employees.filter(e => e.status === 'active').length;
  const onLeaveCount = employees.filter(e => e.status === 'on_leave').length;
  const terminatedCount = employees.filter(e => e.status === 'terminated').length;

  if (!canAccess('payroll')) {
    return <UpgradePrompt feature="payroll" requiredTier={getRequiredTier('payroll')} />;
  }

  if (isLoadingCompany || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        eyebrow="Operations"
        title="Employees"
        description="Manage your workforce and employee records"
        actions={
          <Button onClick={handleOpenCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Add Employee
          </Button>
        }
      />

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Employees</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{employees.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{activeCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">On Leave</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{onLeaveCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Terminated</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{terminatedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search employees..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee #</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Basic Salary</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEmployees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {searchQuery ? 'No employees match your search' : 'No employees yet. Add your first employee to get started.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredEmployees.map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell className="font-mono text-sm">{emp.employeeNumber}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{emp.name}</div>
                        {emp.nameAr && <div className="text-sm text-muted-foreground" dir="rtl">{emp.nameAr}</div>}
                      </div>
                    </TableCell>
                    <TableCell>{emp.position || '-'}</TableCell>
                    <TableCell>{emp.department || '-'}</TableCell>
                    <TableCell>{getStatusBadge(emp.status)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(emp.basicSalary || 0, 'AED', locale)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleOpenEditDialog(emp)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (window.confirm('Are you sure you want to delete this employee?')) {
                              deleteMutation.mutate(emp.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEmployee ? 'Edit Employee' : 'Add Employee'}</DialogTitle>
            <DialogDescription>
              {editingEmployee ? 'Update employee details below.' : 'Fill in the details to add a new employee.'}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
              <Tabs defaultValue="personal" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="personal">Personal Info</TabsTrigger>
                  <TabsTrigger value="documents">Documents & Bank</TabsTrigger>
                  <TabsTrigger value="salary">Salary</TabsTrigger>
                </TabsList>

                {/* Personal Info Tab */}
                <TabsContent value="personal" className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="employeeNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Employee Number *</FormLabel>
                          <FormControl>
                            <Input placeholder="EMP-001" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select status" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="on_leave">On Leave</SelectItem>
                              <SelectItem value="terminated">Terminated</SelectItem>
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
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name (English) *</FormLabel>
                          <FormControl>
                            <Input placeholder="John Doe" {...field} />
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
                          <FormLabel>Full Name (Arabic)</FormLabel>
                          <FormControl>
                            <Input dir="rtl" placeholder="الاسم بالعربي" {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="john@example.com" {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input placeholder="+971 50 123 4567" {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="position"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Position</FormLabel>
                          <FormControl>
                            <Input placeholder="Accountant" {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="department"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Department</FormLabel>
                          <FormControl>
                            <Input placeholder="Finance" {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="nationality"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nationality</FormLabel>
                          <FormControl>
                            <Input placeholder="UAE" {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
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
                </TabsContent>

                {/* Documents & Bank Tab */}
                <TabsContent value="documents" className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="emiratesId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Emirates ID</FormLabel>
                          <FormControl>
                            <Input placeholder="784-XXXX-XXXXXXX-X" {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="passportNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Passport Number</FormLabel>
                          <FormControl>
                            <Input placeholder="AB1234567" {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="bankName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bank Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Emirates NBD" {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="bankAccountNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bank Account Number</FormLabel>
                          <FormControl>
                            <Input placeholder="1234567890" {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="bankIban"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>IBAN</FormLabel>
                        <FormControl>
                          <Input placeholder="AE070331234567890123456" {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>

                {/* Salary Tab */}
                <TabsContent value="salary" className="space-y-4 pt-4">
                  <FormField
                    control={form.control}
                    name="basicSalary"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Basic Salary (AED) *</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" min="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="housingAllowance"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Housing Allowance (AED)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="0" {...field} value={field.value ?? 0} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="transportAllowance"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Transport Allowance (AED)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="0" {...field} value={field.value ?? 0} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="otherAllowances"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Other Allowances (AED)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="0" {...field} value={field.value ?? 0} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Salary Summary */}
                  <Card className="bg-muted/50">
                    <CardContent className="pt-4">
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span>Basic Salary</span>
                          <span className="font-mono">{formatCurrency(form.watch('basicSalary') || 0, 'AED', locale)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Housing Allowance</span>
                          <span className="font-mono">{formatCurrency(form.watch('housingAllowance') || 0, 'AED', locale)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Transport Allowance</span>
                          <span className="font-mono">{formatCurrency(form.watch('transportAllowance') || 0, 'AED', locale)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Other Allowances</span>
                          <span className="font-mono">{formatCurrency(form.watch('otherAllowances') || 0, 'AED', locale)}</span>
                        </div>
                        <div className="border-t pt-2 flex justify-between font-bold">
                          <span>Total Package</span>
                          <span className="font-mono">
                            {formatCurrency(
                              (form.watch('basicSalary') || 0) +
                              (form.watch('housingAllowance') || 0) +
                              (form.watch('transportAllowance') || 0) +
                              (form.watch('otherAllowances') || 0),
                              'AED',
                              locale,
                            )}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  )}
                  {editingEmployee ? 'Update Employee' : 'Add Employee'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
