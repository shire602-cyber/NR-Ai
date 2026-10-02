import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
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
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { getAuthHeaders } from "@/lib/auth";
import { downloadPdf } from "@/lib/download-pdf";
import { apiUrl } from "@/lib/api";
import { LeaveTab } from "@/components/payroll/LeaveTab";
import { LoansTab } from "@/components/payroll/LoansTab";
import { FinalSettlementTab } from "@/components/payroll/FinalSettlementTab";
import { PayrollRegisterDialog } from "@/components/payroll/PayrollRegisterDialog";
import { ApprovalStatusBadge, approverRoleLabel } from "@/components/approvals/ApprovalStatusBadge";
import { messages as approvalMessages } from "@/components/approvals/ApprovalStatusBadge.i18n";
import { useApprovalProgress } from "@/hooks/useApprovalProgress";
import { useMyCompanyRole } from "@/hooks/useMyCompanyRole";
import { failureToast } from "@/lib/approval-feedback";
import { isPendingApprovalBody } from "@/lib/purchasing-hr";
import { messages as pageMessages } from "./Payroll.i18n";

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
  total_leave_deductions?: string;
  total_loan_deductions?: string;
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
  leave_deduction?: string;
  loan_deduction?: string;
  unpaid_leave_days?: string;
  half_pay_leave_days?: string;
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
  fullName: z.string().min(1, pageMessages.marker("fullNameIsRequired")),
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
  basicSalary: z.coerce.number().positive(pageMessages.marker("basicSalaryMustBeGreaterThan")),
  housingAllowance: z.coerce.number().min(0).default(0),
  transportAllowance: z.coerce.number().min(0).default(0),
  otherAllowance: z.coerce.number().min(0).default(0),
  status: z.string().default("active"),
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

const getMonths = () => [
  pageMessages.t("january"),
  pageMessages.t("february"),
  pageMessages.t("march"),
  pageMessages.t("april"),
  pageMessages.t("may"),
  pageMessages.t("june"),
  pageMessages.t("july"),
  pageMessages.t("august"),
  pageMessages.t("september"),
  pageMessages.t("october"),
  pageMessages.t("november"),
  pageMessages.t("december"),
];

// ─── Component ───────────────────────────────────────────

export default function Payroll() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();

  // Dialog states
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [payrollRunDialogOpen, setPayrollRunDialogOpen] = useState(false);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const [registerRunId, setRegisterRunId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemDialogOpen, setEditItemDialogOpen] = useState(false);

  // Gratuity
  const [gratuityEmployeeId, setGratuityEmployeeId] = useState<string>("");
  const [gratuityTerminationDate, setGratuityTerminationDate] = useState<string>("");
  const [gratuityResult, setGratuityResult] = useState<GratuityResult | null>(null);

  // Search
  const [employeeSearch, setEmployeeSearch] = useState("");
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

  const viewingRun = payrollRuns.find((r) => r.id === viewingRunId);
  const { canWriteHr } = useMyCompanyRole(companyId ?? undefined);
  const approvalProgress = useApprovalProgress(companyId ?? undefined, "payroll_run", payrollRuns.some((r) => r.status === "pending_approval"));

  // ─── Forms ───────────────────────────────────────────

  const employeeForm = useForm<EmployeeFormData>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      employeeNumber: "",
      fullName: "",
      fullNameAr: "",
      nationality: "",
      passportNumber: "",
      visaNumber: "",
      laborCardNumber: "",
      bankName: "",
      bankAccountNumber: "",
      iban: "",
      routingCode: "",
      department: "",
      designation: "",
      joinDate: "",
      basicSalary: 0,
      housingAllowance: 0,
      transportAllowance: 0,
      otherAllowance: 0,
      status: "active",
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
      deductionNotes: "",
    },
  });

  // ─── Mutations ─────────────────────────────────────

  const createEmployeeMutation = useMutation({
    mutationFn: (data: EmployeeFormData) =>
      apiRequest("POST", `/api/companies/${companyId}/employees`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/employees`] });
      toast({
        title: tr("employeeCreated"),
        description: tr("theEmployeeHasBeenAddedSuccessfully"),
      });
      setEmployeeDialogOpen(false);
      employeeForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const updateEmployeeMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EmployeeFormData> }) =>
      apiRequest("PATCH", `/api/employees/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/employees`] });
      toast({
        title: tr("employeeUpdated"),
        description: tr("theEmployeeHasBeenUpdatedSuccessfully"),
      });
      setEmployeeDialogOpen(false);
      setEditingEmployee(null);
      employeeForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const deleteEmployeeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/employees/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/employees`] });
      toast({ title: tr("employeeDeleted"), description: tr("theEmployeeHasBeenRemoved") });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const createPayrollRunMutation = useMutation({
    mutationFn: (data: PayrollRunFormData) =>
      apiRequest("POST", `/api/companies/${companyId}/payroll-runs`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/payroll-runs`] });
      toast({
        title: tr("payrollRunCreated"),
        description: tr("thePayrollRunHasBeenCreated"),
      });
      setPayrollRunDialogOpen(false);
      payrollRunForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const calculatePayrollMutation = useMutation({
    mutationFn: (runId: string) => apiRequest("POST", `/api/payroll-runs/${runId}/calculate`),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/payroll-runs`] });
      if (viewingRunId) {
        queryClient.invalidateQueries({ queryKey: [`/api/payroll-runs/${viewingRunId}/items`] });
      }
      const warnings: string[] = Array.isArray(result?.warnings) ? result.warnings : [];
      toast({
        title: tr("payrollCalculated"),
        description:
          warnings.length > 0 ? warnings.join(" ") : tr("payrollItemsHaveBeenGeneratedFrom"),
      });
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const approvePayrollMutation = useMutation({
    mutationFn: (runId: string) => apiRequest("POST", `/api/payroll-runs/${runId}/approve`),
    onSuccess: (body: unknown) => {
      if (viewingRunId) {
        queryClient.invalidateQueries({ queryKey: [`/api/payroll-runs/${viewingRunId}/items`] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "approvals"] });
      if (isPendingApprovalBody(body)) {
        toast({
          title: approvalMessages.t("pendingApprovalSteps", { done: body.approval.completedSteps, total: body.approval.requiredSteps }),
          description: body.approval.nextRole ? approvalMessages.t("nextRole", { role: approverRoleLabel(body.approval.nextRole) }) : undefined,
        });
        return;
      }
      toast({
        title: tr("payrollApproved"),
        description: tr("thePayrollRunHasBeenApproved"),
      });
    },
    onError: (error: Error) => {
      toast(failureToast(error, tr("error")));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/payroll-runs`] });
    },
  });

  const updatePayrollItemMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PayrollItemEditData }) =>
      apiRequest("PATCH", `/api/payroll-items/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/payroll-runs`] });
      if (viewingRunId) {
        queryClient.invalidateQueries({ queryKey: [`/api/payroll-runs/${viewingRunId}/items`] });
      }
      toast({ title: tr("itemUpdated"), description: tr("payrollItemHasBeenUpdated") });
      setEditItemDialogOpen(false);
      setEditingItemId(null);
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  const calculateGratuityMutation = useMutation({
    mutationFn: (data: { employeeId: string; terminationDate?: string }) =>
      apiRequest("POST", `/api/companies/${companyId}/payroll/gratuity-calculator`, data),
    onSuccess: (data: GratuityResult) => {
      setGratuityResult(data);
    },
    onError: (error: Error) => {
      toast({ title: tr("error"), description: error?.message, variant: "destructive" });
    },
  });

  // ─── Handlers ──────────────────────────────────────

  const handleOpenCreateEmployee = () => {
    setEditingEmployee(null);
    employeeForm.reset({
      employeeNumber: "",
      fullName: "",
      fullNameAr: "",
      nationality: "",
      passportNumber: "",
      visaNumber: "",
      laborCardNumber: "",
      bankName: "",
      bankAccountNumber: "",
      iban: "",
      routingCode: "",
      department: "",
      designation: "",
      joinDate: "",
      basicSalary: 0,
      housingAllowance: 0,
      transportAllowance: 0,
      otherAllowance: 0,
      status: "active",
    });
    setEmployeeDialogOpen(true);
  };

  const handleOpenEditEmployee = (emp: Employee) => {
    setEditingEmployee(emp);
    employeeForm.reset({
      employeeNumber: emp.employee_number || "",
      fullName: emp.full_name,
      fullNameAr: emp.full_name_ar || "",
      nationality: emp.nationality || "",
      passportNumber: emp.passport_number || "",
      visaNumber: emp.visa_number || "",
      laborCardNumber: emp.labor_card_number || "",
      bankName: emp.bank_name || "",
      bankAccountNumber: emp.bank_account_number || "",
      iban: emp.iban || "",
      routingCode: emp.routing_code || "",
      department: emp.department || "",
      designation: emp.designation || "",
      joinDate: emp.join_date ? emp.join_date.split("T")[0] : "",
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
      deductionNotes: item.deduction_notes || "",
    });
    setEditItemDialogOpen(true);
  };

  const handleItemEditSubmit = (data: PayrollItemEditData) => {
    if (!editingItemId) return;
    updatePayrollItemMutation.mutate({ id: editingItemId, data });
  };

  const handleDownloadPayslip = async (runId: string, itemId: string) => {
    try {
      await downloadPdf(`/api/payroll-runs/${runId}/payslips/${itemId}/pdf`, "payslip.pdf");
    } catch (err: any) {
      toast({
        title: tr("payslipFailed"),
        description: err?.message,
        variant: "destructive",
      });
    }
  };

  const handleDownloadSIF = async (runId: string) => {
    try {
      const response = await fetch(apiUrl(`/api/payroll-runs/${runId}/generate-sif`), {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err?.message || "Failed to generate SIF");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition");
      const filenameMatch = disposition?.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : "payroll.SIF";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: tr("sifDownloaded"), description: tr("wpsSifFileHasBeenDownloaded") });
    } catch (err: any) {
      toast({ title: tr("error"), description: err?.message, variant: "destructive" });
    }
  };

  const handleCalculateGratuity = () => {
    if (!gratuityEmployeeId) {
      toast({
        title: tr("error"),
        description: tr("pleaseSelectAnEmployee"),
        variant: "destructive",
      });
      return;
    }
    calculateGratuityMutation.mutate({
      employeeId: gratuityEmployeeId,
      terminationDate: gratuityTerminationDate || undefined,
    });
  };

  // ─── Helpers ───────────────────────────────────────

  const getStatusBadge = (status: string, runId?: string) => {
    switch (status) {
      case "pending_approval": {
        const progress = runId ? approvalProgress.get(runId) : undefined;
        return <ApprovalStatusBadge status="pending_approval" completedSteps={progress?.completedSteps} requiredSteps={progress?.requiredSteps} />;
      }
      case "active":
        return (
          <Badge className="bg-success-subtle text-success-subtle-foreground hover:bg-success-subtle">
            {tr("active")}
          </Badge>
        );
      case "inactive":
        return <Badge variant="secondary">{tr("inactive")}</Badge>;
      case "draft":
        return <Badge variant="outline">{tr("draft")}</Badge>;
      case "calculated":
        return (
          <Badge className="bg-info-subtle text-info-subtle-foreground hover:bg-info-subtle">
            {tr("calculated")}
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-success-subtle text-success-subtle-foreground hover:bg-success-subtle">
            {tr("approved")}
          </Badge>
        );
      case "pending":
        return <Badge variant="outline">{tr("pending")}</Badge>;
      case "paid":
        return (
          <Badge className="bg-success-subtle text-success-subtle-foreground hover:bg-success-subtle">
            {tr("paid")}
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const filteredEmployees = employees.filter((emp) => {
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
        <div className="text-muted-foreground">{t.loading || tr("loading")}</div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">{tr("pleaseCreateACompanyFirst")}</div>
      </div>
    );
  }

  // ─── Render: Run detail view ───────────────────────

  if (viewingRunId && viewingRun) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => setViewingRunId(null)}>
            <ChevronLeft className="w-4 h-4 me-1" />
            {tr("backToPayrollRuns")}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  {tr("payrollRun", {
                    value: getMonths()[(viewingRun.period_month || 1) - 1],
                    period_year: viewingRun.period_year,
                  })}
                </CardTitle>
                <CardDescription className="mt-1 space-x-4">
                  <span>{tr("employees", { employee_count: viewingRun.employee_count })}</span>
                  <span>
                    {tr("net", {
                      formatCurrency: formatCurrency(
                        parseFloat(viewingRun.total_net) || 0,
                        "AED",
                        locale
                      ),
                    })}
                  </span>
                  <span>{getStatusBadge(viewingRun.status, viewingRun.id)}</span>
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {viewingRun.status === "draft" && (
                  <Button
                    onClick={() => calculatePayrollMutation.mutate(viewingRunId)}
                    disabled={calculatePayrollMutation.isPending}
                    className="flex items-center gap-2"
                  >
                    <Calculator className="w-4 h-4" />
                    {calculatePayrollMutation.isPending ? tr("calculating") : tr("calculate")}
                  </Button>
                )}
                {(viewingRun.status === "calculated" || viewingRun.status === "pending_approval") && (
                  <>
                    {viewingRun.status === "calculated" && (
                      <Button
                        onClick={() => calculatePayrollMutation.mutate(viewingRunId)}
                        variant="outline"
                        disabled={calculatePayrollMutation.isPending}
                        className="flex items-center gap-2"
                      >
                        <Calculator className="w-4 h-4" />
                        {tr("recalculate")}
                      </Button>
                    )}
                    <Button
                      onClick={() => approvePayrollMutation.mutate(viewingRunId)}
                      disabled={approvePayrollMutation.isPending}
                      className="flex items-center gap-2 bg-success hover:bg-success"
                    >
                      <CheckCircle className="w-4 h-4" />
                      {approvePayrollMutation.isPending ? tr("approving") : tr("approve")}
                    </Button>
                  </>
                )}
                {viewingRun.status !== "draft" && (
                  <Button
                    variant="outline"
                    onClick={() => setRegisterRunId(viewingRunId)}
                    className="flex items-center gap-2"
                    data-testid="button-open-register"
                  >
                    <FileText className="w-4 h-4" />
                    {tr("register")}
                  </Button>
                )}
                {viewingRun.status === "approved" && (
                  <Button
                    variant="outline"
                    onClick={() => handleDownloadSIF(viewingRunId)}
                    className="flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    {tr("downloadSif")}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          {/* Summary cards */}
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
              <div className="rounded-lg border p-3">
                <div className="text-sm text-muted-foreground">{tr("totalBasic")}</div>
                <div className="text-lg font-semibold">
                  {formatCurrency(parseFloat(viewingRun.total_basic) || 0, "AED", locale)}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-sm text-muted-foreground">{tr("totalAllowances")}</div>
                <div className="text-lg font-semibold">
                  {formatCurrency(parseFloat(viewingRun.total_allowances) || 0, "AED", locale)}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-sm text-muted-foreground">{tr("totalDeductions")}</div>
                <div className="text-lg font-semibold text-destructive">
                  {formatCurrency(parseFloat(viewingRun.total_deductions) || 0, "AED", locale)}
                </div>
              </div>
              <div className="rounded-lg border p-3" data-testid="card-total-leave-deductions">
                <div className="text-sm text-muted-foreground">{tr("leaveDeductions")}</div>
                <div className="text-lg font-semibold text-destructive">
                  {formatCurrency(parseFloat(viewingRun.total_leave_deductions ?? "0") || 0, "AED", locale)}
                </div>
              </div>
              <div className="rounded-lg border p-3" data-testid="card-total-loan-deductions">
                <div className="text-sm text-muted-foreground">{tr("loanDeductions")}</div>
                <div className="text-lg font-semibold text-destructive">
                  {formatCurrency(parseFloat(viewingRun.total_loan_deductions ?? "0") || 0, "AED", locale)}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-sm text-muted-foreground">{tr("totalNetPay")}</div>
                <div className="text-lg font-semibold text-success">
                  {formatCurrency(parseFloat(viewingRun.total_net) || 0, "AED", locale)}
                </div>
              </div>
            </div>

            <Separator className="my-4" />

            {/* Payroll items table */}
            {isLoadingItems ? (
              <div className="text-center py-8 text-muted-foreground">
                {tr("loadingPayrollItems")}
              </div>
            ) : payrollItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {tr("noPayrollItemsYetClickCalculate")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("employee")}</TableHead>
                      <TableHead>{tr("department")}</TableHead>
                      <TableHead className="text-end">{tr("basic")}</TableHead>
                      <TableHead className="text-end">{tr("allowances")}</TableHead>
                      <TableHead className="text-end">{tr("overtime")}</TableHead>
                      <TableHead className="text-end">{tr("leaveShort")}</TableHead>
                      <TableHead className="text-end">{tr("loansShort")}</TableHead>
                      <TableHead className="text-end">{tr("deductions")}</TableHead>
                      <TableHead className="text-end">{tr("netSalary")}</TableHead>
                      <TableHead>{tr("status")}</TableHead>
                      <TableHead className="text-end">{tr("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payrollItems.map((item) => {
                      const allowances =
                        (parseFloat(item.housing_allowance) || 0) +
                        (parseFloat(item.transport_allowance) || 0) +
                        (parseFloat(item.other_allowance) || 0);
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            <div>
                              {item.employee_name}
                              {item.employee_number && (
                                <div className="text-xs text-muted-foreground">
                                  #{item.employee_number}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {item.department || "-"}
                          </TableCell>
                          <TableCell className="text-end">
                            {formatCurrency(parseFloat(item.basic_salary) || 0, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-end">
                            {formatCurrency(allowances, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-end">
                            {formatCurrency(parseFloat(item.overtime) || 0, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-end text-destructive" data-testid={`cell-leave-deduction-${item.id}`}>
                            {formatCurrency(parseFloat(item.leave_deduction ?? "0") || 0, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-end text-destructive" data-testid={`cell-loan-deduction-${item.id}`}>
                            {formatCurrency(parseFloat(item.loan_deduction ?? "0") || 0, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-end text-destructive">
                            {formatCurrency(parseFloat(item.deductions) || 0, "AED", locale)}
                          </TableCell>
                          <TableCell className="text-end font-semibold">
                            {formatCurrency(parseFloat(item.net_salary) || 0, "AED", locale)}
                          </TableCell>
                          <TableCell>{getStatusBadge(item.status)}</TableCell>
                          <TableCell className="text-end">
                            {viewingRun.status !== "draft" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDownloadPayslip(viewingRun.id, item.id)}
                                title={tr("payslip")}
                                data-testid={`button-payslip-${item.id}`}
                              >
                                <FileText className="w-4 h-4" />
                              </Button>
                            )}
                            {viewingRun.status !== "approved" && viewingRun.status !== "pending_approval" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEditItem(item)}
                                title={tr("editOvertimeDeductions")}
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
              <DialogTitle>{tr("editPayrollItem")}</DialogTitle>
              <DialogDescription>{tr("adjustOvertimeAndDeductionsForThis")}</DialogDescription>
            </DialogHeader>

            <Form {...payrollItemForm}>
              <form
                onSubmit={payrollItemForm.handleSubmit(handleItemEditSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={payrollItemForm.control}
                  name="overtime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("overtimeAed")}</FormLabel>
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
                      <FormLabel>{tr("deductionsAed")}</FormLabel>
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
                      <FormLabel>{tr("deductionNotes")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={tr("reasonForDeduction")}
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditItemDialogOpen(false)}
                  >
                    {tr("cancel")}
                  </Button>
                  <Button type="submit" disabled={updatePayrollItemMutation.isPending}>
                    {updatePayrollItemMutation.isPending ? tr("saving") : tr("save")}
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
            {tr("payrollWps")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {tr("manageEmployeePayrollWpsComplianceAnd")}
          </p>
        </div>
      </div>

      <Tabs defaultValue="employees" className="space-y-4">
        <TabsList>
          <TabsTrigger value="employees" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            {tr("employees2")}
          </TabsTrigger>
          <TabsTrigger value="payroll-runs" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            {tr("payrollRuns")}
          </TabsTrigger>
          <TabsTrigger value="gratuity" className="flex items-center gap-2">
            <Calculator className="w-4 h-4" />
            {tr("gratuityCalculator")}
          </TabsTrigger>
          <TabsTrigger value="leave" className="flex items-center gap-2" data-testid="tab-payroll-leave">
            {tr("tabLeave")}
          </TabsTrigger>
          <TabsTrigger value="loans" className="flex items-center gap-2" data-testid="tab-payroll-loans">
            {tr("tabLoans")}
          </TabsTrigger>
          <TabsTrigger value="settlement" className="flex items-center gap-2" data-testid="tab-payroll-settlement">
            {tr("tabSettlement")}
          </TabsTrigger>
        </TabsList>

        {/* ─── Employees Tab ────────────────────────────── */}
        <TabsContent value="employees">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{tr("employees2")}</CardTitle>
                  <CardDescription>
                    {tr.plural("employeesRegistered", employees.length)}
                  </CardDescription>
                </div>
                <Button onClick={handleOpenCreateEmployee} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  {tr("addEmployee")}
                </Button>
              </div>
              <div className="mt-4">
                <Input
                  placeholder={tr("searchEmployeesByNameNumberOr")}
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  className="max-w-sm"
                />
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingEmployees ? (
                <div className="text-center py-8 text-muted-foreground">
                  {tr("loadingEmployees")}
                </div>
              ) : filteredEmployees.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {employeeSearch
                    ? tr("noEmployeesMatchYourSearch")
                    : tr("noEmployeesYetAddYourFirst")}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr("name")}</TableHead>
                        <TableHead>{tr("employee2")}</TableHead>
                        <TableHead>{tr("department")}</TableHead>
                        <TableHead>{tr("designation")}</TableHead>
                        <TableHead className="text-end">{tr("totalSalary")}</TableHead>
                        <TableHead>{tr("status")}</TableHead>
                        <TableHead className="text-end">{tr("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEmployees.map((emp) => (
                        <TableRow key={emp.id}>
                          <TableCell className="font-medium">
                            <div>
                              {emp.full_name}
                              {emp.full_name_ar && (
                                <div className="text-xs text-muted-foreground">
                                  {emp.full_name_ar}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {emp.employee_number || "-"}
                          </TableCell>
                          <TableCell>{emp.department || "-"}</TableCell>
                          <TableCell>{emp.designation || "-"}</TableCell>
                          <TableCell className="text-end font-mono">
                            {formatCurrency(parseFloat(emp.total_salary) || 0, "AED", locale)}
                          </TableCell>
                          <TableCell>{getStatusBadge(emp.status)}</TableCell>
                          <TableCell className="text-end">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEditEmployee(emp)}
                                title={tr("edit")}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEmployeeToDelete(emp.id)}
                                title={tr("delete")}
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
                  <CardTitle>{tr("payrollRuns")}</CardTitle>
                  <CardDescription>
                    {tr.plural("payrollRunsCount", payrollRuns.length)}
                  </CardDescription>
                </div>
                <Button
                  onClick={() => setPayrollRunDialogOpen(true)}
                  className="flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {tr("newPayrollRun")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingRuns ? (
                <div className="text-center py-8 text-muted-foreground">
                  {tr("loadingPayrollRuns")}
                </div>
              ) : payrollRuns.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {tr("noPayrollRunsYetCreateYour")}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr("period")}</TableHead>
                        <TableHead className="text-end">{tr("employees2")}</TableHead>
                        <TableHead className="text-end">{tr("totalNet")}</TableHead>
                        <TableHead>{tr("status")}</TableHead>
                        <TableHead>{tr("created")}</TableHead>
                        <TableHead className="text-end">{tr("actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollRuns.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell className="font-medium">
                            {getMonths()[(run.period_month || 1) - 1]} {run.period_year}
                          </TableCell>
                          <TableCell className="text-end">{run.employee_count}</TableCell>
                          <TableCell className="text-end font-mono">
                            {formatCurrency(parseFloat(run.total_net) || 0, "AED", locale)}
                          </TableCell>
                          <TableCell>{getStatusBadge(run.status, run.id)}</TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {run.created_at
                              ? format(new Date(run.created_at), "MMM dd, yyyy")
                              : "-"}
                          </TableCell>
                          <TableCell className="text-end">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewingRunId(run.id)}
                                title={tr("viewDetails")}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              {run.status === "draft" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => calculatePayrollMutation.mutate(run.id)}
                                  disabled={calculatePayrollMutation.isPending}
                                  title={tr("calculate")}
                                >
                                  <Calculator className="w-4 h-4" />
                                </Button>
                              )}
                              {(run.status === "calculated" || run.status === "pending_approval") && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => approvePayrollMutation.mutate(run.id)}
                                  disabled={approvePayrollMutation.isPending}
                                  title={tr("approve")}
                                  className="text-success hover:text-success"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </Button>
                              )}
                              {run.status !== "draft" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setRegisterRunId(run.id)}
                                  title={tr("registerTitle")}
                                  data-testid={`button-register-${run.id}`}
                                >
                                  <FileText className="w-4 h-4" />
                                </Button>
                              )}
                              {run.status === "approved" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDownloadSIF(run.id)}
                                  title={tr("downloadSif")}
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
                  {tr("endOfServiceGratuity")}
                </CardTitle>
                <CardDescription>{tr("calculateGratuityPerUaeLaborLaw")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium">{tr("selectEmployee")}</label>
                  <Select
                    value={gratuityEmployeeId}
                    onValueChange={(v) => {
                      setGratuityEmployeeId(v);
                      setGratuityResult(null);
                    }}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder={tr("chooseAnEmployee")} />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.full_name} {emp.employee_number ? `(#${emp.employee_number})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium">{tr("terminationDateOptional")}</label>
                  <Input
                    type="date"
                    value={gratuityTerminationDate}
                    onChange={(e) => setGratuityTerminationDate(e.target.value)}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {tr("leaveEmptyToCalculateAsOf")}
                  </p>
                </div>

                <Button
                  onClick={handleCalculateGratuity}
                  disabled={calculateGratuityMutation.isPending || !gratuityEmployeeId}
                  className="w-full flex items-center gap-2"
                >
                  <Calculator className="w-4 h-4" />
                  {calculateGratuityMutation.isPending
                    ? tr("calculating")
                    : tr("calculateGratuity")}
                </Button>
              </CardContent>
            </Card>

            {gratuityResult && (
              <Card>
                <CardHeader>
                  <CardTitle>{tr("gratuityBreakdown")}</CardTitle>
                  <CardDescription>
                    {tr("for", { employeeName: gratuityResult.employeeName })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {gratuityResult.note ? (
                    <div className="rounded-lg border border-warning/30 bg-warning-subtle p-4 text-sm text-warning-subtle-foreground">
                      {gratuityResult.note}
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="text-muted-foreground">{tr("joinDate")}</div>
                        <div className="font-medium">
                          {gratuityResult.joinDate
                            ? format(new Date(gratuityResult.joinDate), "MMM dd, yyyy")
                            : "-"}
                        </div>

                        <div className="text-muted-foreground">{tr("terminationDate")}</div>
                        <div className="font-medium">
                          {format(new Date(gratuityResult.terminationDate), "MMM dd, yyyy")}
                        </div>

                        <div className="text-muted-foreground">{tr("yearsOfService")}</div>
                        <div className="font-medium">
                          {tr("years", { yearsOfService: gratuityResult.yearsOfService })}
                        </div>

                        <div className="text-muted-foreground">{tr("basicSalary")}</div>
                        <div className="font-medium">
                          {formatCurrency(gratuityResult.basicSalary, "AED", locale)}
                        </div>

                        <div className="text-muted-foreground">{tr("dailyWageBasic30")}</div>
                        <div className="font-medium">
                          {formatCurrency(gratuityResult.dailyWage, "AED", locale)}
                        </div>
                      </div>

                      <Separator />

                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="text-muted-foreground">
                          {tr("first5YearsYrsX21", {
                            firstFiveYears: gratuityResult.firstFiveYears,
                          })}
                        </div>
                        <div className="font-medium">
                          {formatCurrency(gratuityResult.firstFiveYearsGratuity, "AED", locale)}
                        </div>

                        <div className="text-muted-foreground">
                          {tr("after5YearsYrsX30", {
                            remainingYears: gratuityResult.remainingYears,
                          })}
                        </div>
                        <div className="font-medium">
                          {formatCurrency(gratuityResult.remainingYearsGratuity, "AED", locale)}
                        </div>
                      </div>

                      <Separator />

                      <div className="grid grid-cols-2 gap-2">
                        <div className="text-lg font-semibold">{tr("totalGratuity")}</div>
                        <div className="text-lg font-bold text-success">
                          {formatCurrency(gratuityResult.totalGratuity, "AED", locale)}
                        </div>
                      </div>

                      {gratuityResult.isCapped && (
                        <div className="rounded-lg border border-warning/30 bg-warning-subtle p-3 text-xs text-warning-subtle-foreground">
                          {tr("gratuityCappedAt2YearsTotal", {
                            formatCurrency: formatCurrency(
                              gratuityResult.maxGratuity || 0,
                              "AED",
                              locale
                            ),
                            formatCurrency2: formatCurrency(
                              gratuityResult.uncappedGratuity || 0,
                              "AED",
                              locale
                            ),
                          })}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ─── Leave, loans and final settlement (Phase 8 D2) ── */}
        <TabsContent value="leave">
          {companyId && <LeaveTab companyId={companyId} employees={employees} canWrite={canWriteHr} />}
        </TabsContent>
        <TabsContent value="loans">
          {companyId && <LoansTab companyId={companyId} employees={employees} canWrite={canWriteHr} />}
        </TabsContent>
        <TabsContent value="settlement">
          {companyId && <FinalSettlementTab companyId={companyId} employees={employees} canWrite={canWriteHr} />}
        </TabsContent>
      </Tabs>

      <PayrollRegisterDialog runId={registerRunId} onClose={() => setRegisterRunId(null)} />

      {/* ─── Employee Create/Edit Dialog ──────────────── */}
      <Dialog open={employeeDialogOpen} onOpenChange={setEmployeeDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEmployee ? tr("editEmployee") : tr("addEmployee")}</DialogTitle>
            <DialogDescription>
              {editingEmployee ? tr("updateEmployeeDetails") : tr("addANewEmployeeToPayroll")}
            </DialogDescription>
          </DialogHeader>

          <Form {...employeeForm}>
            <form onSubmit={employeeForm.handleSubmit(handleEmployeeSubmit)} className="space-y-4">
              {/* Personal Information */}
              <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {tr("personalInformation")}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={employeeForm.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("fullName")}</FormLabel>
                      <FormControl>
                        <Input placeholder={tr("fullName2")} {...field} />
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
                      <FormLabel>{tr("fullNameArabic")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="الاسم الكامل"
                          dir="rtl"
                          {...field}
                          value={field.value || ""}
                        />
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
                      <FormLabel>{tr("employeeNumber")}</FormLabel>
                      <FormControl>
                        <Input placeholder="EMP-001" {...field} value={field.value || ""} />
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
                      <FormLabel>{tr("nationality")}</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., UAE" {...field} value={field.value || ""} />
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
                      <FormLabel>{tr("joinDate")}</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Work Information */}
              <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-2">
                {tr("workInformation")}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={employeeForm.control}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("department")}</FormLabel>
                      <FormControl>
                        <Input placeholder={tr("eGFinance")} {...field} value={field.value || ""} />
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
                      <FormLabel>{tr("designation")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={tr("eGAccountant")}
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Identity Documents */}
              <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-2">
                {tr("identityDocuments")}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={employeeForm.control}
                  name="passportNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("passportNumber")}</FormLabel>
                      <FormControl>
                        <Input placeholder={tr("passport")} {...field} value={field.value || ""} />
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
                      <FormLabel>{tr("visaNumber")}</FormLabel>
                      <FormControl>
                        <Input placeholder="Visa #" {...field} value={field.value || ""} />
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
                      <FormLabel>{tr("laborCardNumber")}</FormLabel>
                      <FormControl>
                        <Input placeholder={tr("laborCard")} {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Banking Details */}
              <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-2">
                {tr("bankingDetails")}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={employeeForm.control}
                  name="bankName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("bankName")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={tr("eGEmiratesNbd")}
                          {...field}
                          value={field.value || ""}
                        />
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
                      <FormLabel>{tr("accountNumber")}</FormLabel>
                      <FormControl>
                        <Input placeholder={tr("account")} {...field} value={field.value || ""} />
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
                        <Input placeholder="AE..." {...field} value={field.value || ""} />
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
                      <FormLabel>{tr("routingCode")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={tr("bankRoutingCode")}
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Salary */}
              <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-2">
                {tr("salaryDetailsAed")}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={employeeForm.control}
                  name="basicSalary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tr("basicSalary2")}</FormLabel>
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
                      <FormLabel>{tr("housingAllowance")}</FormLabel>
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
                      <FormLabel>{tr("transportAllowance")}</FormLabel>
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
                      <FormLabel>{tr("otherAllowance")}</FormLabel>
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
                    <FormLabel>{tr("status")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tr("selectStatus")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">{tr("active")}</SelectItem>
                        <SelectItem value="inactive">{tr("inactive")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEmployeeDialogOpen(false)}
                >
                  {tr("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={createEmployeeMutation.isPending || updateEmployeeMutation.isPending}
                >
                  {createEmployeeMutation.isPending || updateEmployeeMutation.isPending
                    ? tr("saving")
                    : editingEmployee
                      ? tr("saveChanges")
                      : tr("addEmployee")}
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
            <DialogTitle>{tr("newPayrollRun")}</DialogTitle>
            <DialogDescription>{tr("createANewPayrollRunFor")}</DialogDescription>
          </DialogHeader>

          <Form {...payrollRunForm}>
            <form
              onSubmit={payrollRunForm.handleSubmit(handlePayrollRunSubmit)}
              className="space-y-4"
            >
              <FormField
                control={payrollRunForm.control}
                name="periodMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr("month")}</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(parseInt(v))}
                      value={String(field.value)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tr("selectMonth")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {getMonths().map((month, index) => (
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
                    <FormLabel>{tr("year")}</FormLabel>
                    <FormControl>
                      <Input type="number" min="2020" max="2099" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPayrollRunDialogOpen(false)}
                >
                  {tr("cancel")}
                </Button>
                <Button type="submit" disabled={createPayrollRunMutation.isPending}>
                  {createPayrollRunMutation.isPending ? tr("creating") : tr("createRun")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!employeeToDelete}
        onOpenChange={(open) => {
          if (!open) setEmployeeToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("deleteEmployee")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr("thisWillPermanentlyRemoveThisEmployee")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (employeeToDelete) {
                  deleteEmployeeMutation.mutate(employeeToDelete);
                  setEmployeeToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tr("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
