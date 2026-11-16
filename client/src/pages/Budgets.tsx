import { T } from "@/components/layout/T";
import { monthName } from "@/pages/payroll/shared";
import {
  FormActions,
  FormErrorSummary,
  FormGrid,
  FormSection,
  FormTotals,
  formSpanFull,
  lineLabelClass,
} from "@/components/ui/form-layout";
import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { format } from "date-fns";
import {
  Wallet,
  Plus,
  Edit,
  Trash2,
  CheckCircle,
  FileSpreadsheet,
  BarChart3,
  ArrowLeft,
  Copy,
  Download,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
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
  FormDescription,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { Money } from "@/components/ui/money";

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
  version?: number;
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

const budgetFormSchema = z
  .object({
    name: z.string().min(1, "Budget name is required"),
    fiscalYear: z.coerce.number().int().min(2000).max(2100),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    notes: z.string().optional().nullable(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    path: ["endDate"],
    message: "End date must be on or after the start date",
  })
  .refine(
    (v) => {
      if (!v.startDate || !v.endDate || v.endDate < v.startDate) return true;
      const months =
        (Number(v.endDate.slice(0, 4)) - Number(v.startDate.slice(0, 4))) * 12 +
        (Number(v.endDate.slice(5, 7)) - Number(v.startDate.slice(5, 7))) +
        1;
      return months <= 12;
    },
    { path: ["endDate"], message: "A budget plan covers at most 12 months" }
  );

type BudgetFormData = z.infer<typeof budgetFormSchema>;

const budgetLineFormSchema = z.object({
  category: z.string().min(1, "Category is required"),
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

const MONTH_KEYS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const BUDGET_CATEGORIES = [
  "Revenue",
  "Cost of Goods Sold",
  "Salaries & Wages",
  "Rent & Utilities",
  "Marketing",
  "Travel & Entertainment",
  "Office Supplies",
  "Professional Services",
  "Insurance",
  "Depreciation",
  "Technology",
  "Miscellaneous",
  "Other",
];

// ─── Component ───────────────────────────────────────────

const tr = (locale: string, en: string, ar: string) => (locale === "ar" ? ar : en);

export default function Budgets() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();

  const [activeTab, setActiveTab] = useState("budgets");
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
    enabled: !!selectedBudget?.id && activeTab === "variance",
  });

  // ─── Forms ──────────────────────────────────────────────

  const monthLabel = (idx: number) => monthName(idx + 1, locale);

  const budgetForm = useForm<BudgetFormData>({
    resolver: zodResolver(budgetFormSchema),
    defaultValues: {
      name: "",
      fiscalYear: new Date().getFullYear(),
      startDate: "",
      endDate: "",
      notes: "",
    },
  });

  const lineForm = useForm<BudgetLineFormData>({
    resolver: zodResolver(budgetLineFormSchema),
    defaultValues: {
      category: "",
      description: "",
      jan: 0,
      feb: 0,
      mar: 0,
      apr: 0,
      may: 0,
      jun: 0,
      jul: 0,
      aug: 0,
      sep: 0,
      oct: 0,
      nov: 0,
      dec: 0,
    },
  });

  // ─── Mutations ──────────────────────────────────────────

  const createBudgetMutation = useMutation({
    mutationFn: (data: BudgetFormData) =>
      apiRequest("POST", `/api/companies/${companyId}/budget-plans`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({
        title: "Budget Created",
        description: "The budget plan has been created successfully.",
      });
      setBudgetDialogOpen(false);
      budgetForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
    },
  });

  const updateBudgetMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BudgetFormData> }) =>
      apiRequest("PATCH", `/api/budget-plans/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({ title: "Budget Updated", description: "The budget plan has been updated." });
      setBudgetDialogOpen(false);
      setEditingBudget(null);
      budgetForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
    },
  });

  const deleteBudgetMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/budget-plans/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({ title: "Budget Deleted", description: "The budget plan has been deleted." });
      if (selectedBudget) setSelectedBudget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
    },
  });

  const approveBudgetMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/budget-plans/${id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({ title: "Budget Approved", description: "The budget has been approved." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
    },
  });

  const refreshBudgets = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });

  const newVersionMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/budget-plans/${id}/new-version`, {}),
    onSuccess: () => {
      refreshBudgets();
      toast({
        title: tr(locale, "New draft version created", "تم إنشاء نسخة مسودة جديدة"),
        description: tr(
          locale,
          "Edit the draft, then have a different approver approve it.",
          "عدّل المسودة ثم اطلب اعتمادها من معتمد آخر."
        ),
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
    },
  });

  const copyBudgetMutation = useMutation({
    mutationFn: ({ id, fiscalYear }: { id: string; fiscalYear: number }) =>
      apiRequest("POST", `/api/budget-plans/${id}/copy`, { fiscalYear }),
    onSuccess: () => {
      refreshBudgets();
      toast({
        title: tr(locale, "Budget copied", "تم نسخ الموازنة"),
        description: tr(
          locale,
          "A draft for the next year was created.",
          "تم إنشاء مسودة للسنة التالية."
        ),
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
    },
  });

  const importLinesMutation = useMutation({
    mutationFn: ({ id, csv }: { id: string; csv: string }) =>
      apiRequest("POST", `/api/budget-plans/${id}/import`, { csv }),
    onSuccess: (result: { imported: number }) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/budget-plans/${selectedBudget?.id}/lines`],
      });
      refreshBudgets();
      toast({
        title: tr(locale, "Import complete", "اكتمل الاستيراد"),
        description: `${result.imported} ${tr(locale, "lines imported", "سطر تم استيراده")}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
    },
  });

  const downloadBudgetExport = async (budget: BudgetPlan, format: "xlsx" | "csv") => {
    try {
      const response = await fetch(
        apiUrl(`/api/budget-plans/${budget.id}/export?format=${format}`),
        {
          headers: getAuthHeaders(),
        }
      );
      if (!response.ok) throw new Error((await response.json())?.message || "Export failed");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `budget-${budget.name}-v${budget.version ?? 1}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    }
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file || !selectedBudget) return;
    importLinesMutation.mutate({ id: selectedBudget.id, csv: await file.text() });
  };

  const addLineMutation = useMutation({
    mutationFn: (data: BudgetLineFormData) =>
      apiRequest("POST", `/api/budget-plans/${selectedBudget?.id}/lines`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/budget-plans/${selectedBudget?.id}/lines`],
      });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({ title: "Line Added", description: "Budget line has been added." });
      setAddLineDialogOpen(false);
      setEditingLine(null);
      lineForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
    },
  });

  const updateLineMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BudgetLineFormData> }) =>
      apiRequest("PATCH", `/api/budget-lines/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/budget-plans/${selectedBudget?.id}/lines`],
      });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({ title: "Line Updated", description: "Budget line has been updated." });
      setAddLineDialogOpen(false);
      setEditingLine(null);
      lineForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/budget-lines/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/budget-plans/${selectedBudget?.id}/lines`],
      });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({ title: "Line Deleted", description: "Budget line has been removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
    },
  });

  // ─── Handlers ───────────────────────────────────────────

  const handleOpenCreateBudget = () => {
    setEditingBudget(null);
    const year = new Date().getFullYear();
    budgetForm.reset({
      name: "",
      fiscalYear: year,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      notes: "",
    });
    setBudgetDialogOpen(true);
  };

  const handleOpenEditBudget = (budget: BudgetPlan) => {
    setEditingBudget(budget);
    budgetForm.reset({
      name: budget.name,
      fiscalYear: budget.fiscal_year,
      startDate: budget.start_date ? format(new Date(budget.start_date), "yyyy-MM-dd") : "",
      endDate: budget.end_date ? format(new Date(budget.end_date), "yyyy-MM-dd") : "",
      notes: budget.notes || "",
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
    setActiveTab("detail");
  };

  const handleBackToBudgets = () => {
    setSelectedBudget(null);
    setActiveTab("budgets");
  };

  const handleOpenAddLine = () => {
    setEditingLine(null);
    lineForm.reset({
      category: "",
      description: "",
      jan: 0,
      feb: 0,
      mar: 0,
      apr: 0,
      may: 0,
      jun: 0,
      jul: 0,
      aug: 0,
      sep: 0,
      oct: 0,
      nov: 0,
      dec: 0,
    });
    setAddLineDialogOpen(true);
  };

  const handleOpenEditLine = (line: BudgetLine) => {
    setEditingLine(line);
    lineForm.reset({
      category: line.category,
      description: line.description || "",
      jan: parseFloat(line.jan || "0"),
      feb: parseFloat(line.feb || "0"),
      mar: parseFloat(line.mar || "0"),
      apr: parseFloat(line.apr || "0"),
      may: parseFloat(line.may || "0"),
      jun: parseFloat(line.jun || "0"),
      jul: parseFloat(line.jul || "0"),
      aug: parseFloat(line.aug || "0"),
      sep: parseFloat(line.sep || "0"),
      oct: parseFloat(line.oct || "0"),
      nov: parseFloat(line.nov || "0"),
      dec: parseFloat(line.dec || "0"),
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
      case "draft":
        return (
          <Badge variant="secondary">
            <T k="pages.draft" />
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-success-subtle text-success-subtle-foreground hover:bg-success-subtle">
            <T k="pages.approved" />
          </Badge>
        );
      case "closed":
        return (
          <Badge className="bg-muted text-foreground hover:bg-muted">
            <T k="pages.closed" />
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getVarianceColor = (variance: number) => {
    if (variance > 0) return "text-success";
    if (variance < 0) return "text-destructive";
    return "";
  };

  // Compute totals row for budget lines
  const lineTotals = useCallback(() => {
    const totals: Record<string, number> = {};
    MONTH_KEYS.forEach((key) => {
      totals[key] = 0;
    });
    totals.annual = 0;

    budgetLines.forEach((line) => {
      MONTH_KEYS.forEach((key) => {
        totals[key] += parseFloat((line as any)[key] || "0");
      });
      totals.annual += parseFloat(line.annual_total || "0");
    });

    return totals;
  }, [budgetLines]);

  // ─── Loading State ─────────────────────────────────────

  if (isLoadingCompany) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">{t.loading || "Loading..."}</div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">
          <T k="pages.pleaseCreateACompanyFirst" />
        </div>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {selectedBudget && (
        <Button
          variant="ghost"
          size="sm"
          className="-ms-2 -mb-2 text-muted-foreground"
          onClick={handleBackToBudgets}
        >
          <ArrowLeft className="h-4 w-4 me-1 rtl:-scale-x-100" aria-hidden />
          {tr(locale, "Back to budgets", "العودة إلى الموازنات")}
        </Button>
      )}
      <PageHeader
        eyebrow="Accounting"
        title={selectedBudget ? selectedBudget.name : tr(locale, "Budgets", "الموازنات")}
        description={
          selectedBudget
            ? `${tr(locale, "FY", "السنة المالية")} ${selectedBudget.fiscal_year} · ${getStatusBadge(selectedBudget.status).props.children}`
            : tr(locale, "Plan, track, and analyze your budgets", "خطط موازناتك وتابعها وحللها")
        }
        actions={
          !selectedBudget ? (
            <Button onClick={handleOpenCreateBudget}>
              <Plus className="h-4 w-4 me-2" aria-hidden />
              <T k="pages.newBudget" />
            </Button>
          ) : undefined
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className={selectedBudget ? undefined : "hidden"}>
          <TabsTrigger value="budgets">
            <Wallet aria-hidden />
            <T k="pages.budgets" />
          </TabsTrigger>
          {selectedBudget && (
            <>
              <TabsTrigger value="detail">
                <FileSpreadsheet aria-hidden />
                <T k="pages.budgetDetail" />
              </TabsTrigger>
              <TabsTrigger value="variance">
                <BarChart3 aria-hidden />
                <T k="pages.variance" />
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* ─── Budgets List Tab ──────────────────────────── */}
        <TabsContent value="budgets">
          <Card>
            <CardHeader>
              <CardTitle>
                <T k="pages.budgetPlans" />
              </CardTitle>
              <CardDescription>
                {budgetPlans.length}{" "}
                {budgetPlans.length === 1
                  ? tr(locale, "budget plan", "خطة موازنة")
                  : tr(locale, "budget plans", "خطط موازنة")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingBudgets ? (
                <div className="text-center py-8 text-muted-foreground">
                  {t.loading || "Loading..."}
                </div>
              ) : budgetPlans.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <T k="pages.noBudgetPlansYetCreateYourFirstBudgetToGetStarte" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr(locale, "Name", "الاسم")}</TableHead>
                        <TableHead>{tr(locale, "Year", "السنة")}</TableHead>
                        <TableHead>
                          <T k="pages.period" />
                        </TableHead>
                        <TableHead>
                          <T k="pages.status" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="pages.totalBudget" />
                        </TableHead>
                        <TableHead data-numeric>{t.actions || "Actions"}</TableHead>
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
                            {budget.start_date
                              ? format(new Date(budget.start_date), "MMM yyyy")
                              : "-"}
                            {" - "}
                            {budget.end_date ? format(new Date(budget.end_date), "MMM yyyy") : "-"}
                          </TableCell>
                          <TableCell>{getStatusBadge(budget.status)}</TableCell>
                          <TableCell data-numeric>
                            <Money
                              amount={parseFloat(budget.total_budget || "0")}
                              currency={"AED"}
                            />
                          </TableCell>
                          <TableCell data-numeric>
                            <div onClick={(e) => e.stopPropagation()}>
                              <RowActions
                                menu={
                                  <>
                                    {budget.status !== "draft" && (
                                      <DropdownMenuItem
                                        onSelect={() => newVersionMutation.mutate(budget.id)}
                                        data-testid={`button-new-version-${budget.id}`}
                                      >
                                        <Plus aria-hidden />
                                        {tr(locale, "New version", "نسخة جديدة")}
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem
                                      onSelect={() =>
                                        copyBudgetMutation.mutate({
                                          id: budget.id,
                                          fiscalYear: budget.fiscal_year + 1,
                                        })
                                      }
                                    >
                                      <Copy aria-hidden />
                                      {tr(locale, "Copy to next year", "نسخ إلى السنة التالية")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() => downloadBudgetExport(budget, "xlsx")}
                                    >
                                      <FileSpreadsheet aria-hidden />
                                      {tr(locale, "Export Excel", "تصدير Excel")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() => downloadBudgetExport(budget, "csv")}
                                    >
                                      <Download aria-hidden />
                                      {tr(locale, "Export CSV", "تصدير CSV")}
                                    </DropdownMenuItem>
                                    {budget.status === "draft" && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          className="text-destructive focus:text-destructive"
                                          onSelect={() => setBudgetToDelete(budget.id)}
                                        >
                                          <Trash2 aria-hidden />
                                          {tr(locale, "Delete", "حذف")}
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                  </>
                                }
                              >
                                {budget.status === "draft" && (
                                  <>
                                    <RowActionButton
                                      icon={CheckCircle}
                                      label={tr(locale, "Approve", "اعتماد")}
                                      onClick={() => approveBudgetMutation.mutate(budget.id)}
                                    />
                                    <RowActionButton
                                      icon={Edit}
                                      label={tr(locale, "Edit", "تعديل")}
                                      onClick={() => handleOpenEditBudget(budget)}
                                    />
                                  </>
                                )}
                              </RowActions>
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
                      <T k="pages.monthlyBudgetAllocationByCategoryClickARowToEdit" />
                    </CardDescription>
                  </div>
                  {selectedBudget.status === "draft" ? (
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-accent cursor-pointer">
                        {tr(locale, "Import CSV", "استيراد CSV")}
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          className="sr-only"
                          data-testid="input-import-budget"
                          onChange={(e) => {
                            void handleImportFile(e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <Button onClick={handleOpenAddLine} className="flex items-center gap-2">
                        <Plus className="w-4 h-4" />
                        <T k="pages.addLine" />
                      </Button>
                    </div>
                  ) : (
                    <Badge variant="secondary" data-testid="badge-budget-frozen">
                      {tr(
                        locale,
                        "Locked after approval. Create a new version to change it.",
                        "مقفلة بعد الاعتماد. أنشئ نسخة جديدة لتعديلها."
                      )}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingLines ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t.loading || "Loading..."}
                  </div>
                ) : budgetLines.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <T k="pages.noBudgetLinesYetAddCategoriesAndMonthlyAllocatio" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky start-0 bg-background z-10 min-w-[160px]">
                            <T k="pages.category" />
                          </TableHead>
                          {MONTH_LABELS.map((label) => (
                            <TableHead data-numeric key={label} className=" min-w-[90px]">
                              {label}
                            </TableHead>
                          ))}
                          <TableHead data-numeric className=" min-w-[110px] font-bold">
                            <T k="pages.annualTotal" />
                          </TableHead>
                          <TableHead data-numeric className=" min-w-[80px]">
                            {t.actions || "Actions"}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {budgetLines.map((line) => (
                          <TableRow
                            key={line.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => handleOpenEditLine(line)}
                          >
                            <TableCell className="sticky start-0 bg-background z-10 font-medium">
                              <div>
                                {line.category}
                                {line.description && (
                                  <div className="text-xs text-muted-foreground">
                                    {line.description}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            {MONTH_KEYS.map((key) => (
                              <TableCell data-numeric key={key} className=" text-sm">
                                <Money
                                  amount={parseFloat((line as any)[key] || "0")}
                                  currency={"AED"}
                                />
                              </TableCell>
                            ))}
                            <TableCell data-numeric className=" font-bold text-sm">
                              <Money
                                amount={parseFloat(line.annual_total || "0")}
                                currency={"AED"}
                              />
                            </TableCell>
                            <TableCell data-numeric onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setLineToDelete(line.id)}
                                title="Delete"
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="bg-muted/50 font-bold">
                          <TableCell className="sticky start-0 bg-muted/50 z-10">
                            <T k="pages.total" />
                          </TableCell>
                          {MONTH_KEYS.map((key) => (
                            <TableCell data-numeric key={key} className=" text-sm">
                              <Money amount={lineTotals()[key]} currency={"AED"} />
                            </TableCell>
                          ))}
                          <TableCell data-numeric className=" text-sm">
                            <Money amount={lineTotals().annual} currency={"AED"} />
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
                  Comparing budgeted amounts against actual journal entries. Green = under budget,
                  Red = over budget.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingVariance ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t.loading || "Loading..."}
                  </div>
                ) : !varianceData || varianceData.varianceLines.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No variance data available. Add budget lines with account links to compare
                    against actuals.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky start-0 bg-background z-10 min-w-[160px]">
                            <T k="pages.category" />
                          </TableHead>
                          {MONTH_LABELS.map((label) => (
                            <TableHead key={label} className="text-center min-w-[200px]">
                              <div>{label}</div>
                              <div className="flex text-xs text-muted-foreground mt-1">
                                <span className="flex-1 text-end pe-1">
                                  <T k="pages.budget" />
                                </span>
                                <span className="flex-1 text-end pe-1">
                                  <T k="pages.actual" />
                                </span>
                                <span className="flex-1 text-end">Var</span>
                              </div>
                            </TableHead>
                          ))}
                          <TableHead className="text-center min-w-[200px]">
                            <div>
                              <T k="pages.annual" />
                            </div>
                            <div className="flex text-xs text-muted-foreground mt-1">
                              <span className="flex-1 text-end pe-1">
                                <T k="pages.budget" />
                              </span>
                              <span className="flex-1 text-end pe-1">
                                <T k="pages.actual" />
                              </span>
                              <span className="flex-1 text-end">Var %</span>
                            </div>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {varianceData.varianceLines.map((line) => (
                          <TableRow key={line.id}>
                            <TableCell className="sticky start-0 bg-background z-10 font-medium">
                              <div>
                                {line.category}
                                {line.description && (
                                  <div className="text-xs text-muted-foreground">
                                    {line.description}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            {MONTH_KEYS.map((key) => {
                              const m = line.months[key];
                              return (
                                <TableCell data-numeric key={key}>
                                  <div className="flex text-xs tabular-nums">
                                    <span className="flex-1 text-end pe-1">
                                      {m.budget.toFixed(0)}
                                    </span>
                                    <span className="flex-1 text-end pe-1">
                                      {m.actual.toFixed(0)}
                                    </span>
                                    <span
                                      className={`flex-1 text-end font-semibold ${getVarianceColor(m.variance)}`}
                                    >
                                      {m.variance >= 0 ? "+" : ""}
                                      {m.variance.toFixed(0)}
                                    </span>
                                  </div>
                                </TableCell>
                              );
                            })}
                            <TableCell data-numeric>
                              <div className="flex text-xs tabular-nums">
                                <span className="flex-1 text-end pe-1">
                                  {line.totals.budget.toFixed(0)}
                                </span>
                                <span className="flex-1 text-end pe-1">
                                  {line.totals.actual.toFixed(0)}
                                </span>
                                <span
                                  className={`flex-1 text-end font-bold ${getVarianceColor(line.totals.variance)}`}
                                >
                                  {line.totals.variancePercent >= 0 ? "+" : ""}
                                  {line.totals.variancePercent.toFixed(1)}%
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
                        <CardTitle className="text-sm font-medium">
                          <T k="pages.totalBudget" />
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          <Money
                            amount={varianceData.varianceLines.reduce(
                              (s, l) => s + l.totals.budget,
                              0
                            )}
                            currency={"AED"}
                          />
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">
                          <T k="pages.totalActual" />
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          <Money
                            amount={varianceData.varianceLines.reduce(
                              (s, l) => s + l.totals.actual,
                              0
                            )}
                            currency={"AED"}
                          />
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">
                          <T k="pages.totalVariance" />
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {(() => {
                          const totalVar = varianceData.varianceLines.reduce(
                            (s, l) => s + l.totals.variance,
                            0
                          );
                          return (
                            <div
                              className={`text-2xl font-bold flex items-center gap-2 ${getVarianceColor(totalVar)}`}
                            >
                              {totalVar >= 0 ? (
                                <TrendingUp className="w-5 h-5" />
                              ) : (
                                <TrendingDown className="w-5 h-5" />
                              )}
                              <Money amount={Math.abs(totalVar)} currency={"AED"} />
                              <span className="text-sm font-normal">
                                {totalVar >= 0 ? "under budget" : "over budget"}
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
        <DialogContent size="md" data-testid="dialog-budget-form">
          <DialogHeader>
            <DialogTitle>
              {editingBudget ? t["forms.budget.editTitle"] : t["forms.budget.newTitle"]}
            </DialogTitle>
            <DialogDescription>
              {editingBudget ? t["forms.budget.editDesc"] : t["forms.budget.newDesc"]}
            </DialogDescription>
          </DialogHeader>

          <Form {...budgetForm}>
            <form
              onSubmit={budgetForm.handleSubmit(handleBudgetSubmit)}
              noValidate
              className="space-y-6"
            >
              <FormErrorSummary />
              <FormSection title={t["forms.section.plan"]}>
                <FormGrid>
                  <FormField
                    control={budgetForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem className={formSpanFull}>
                        <FormLabel required>{t["forms.budget.name"]}</FormLabel>
                        <FormControl>
                          <Input
                            dir="auto"
                            placeholder={t["forms.budget.namePlaceholder"]}
                            {...field}
                          />
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
                        <FormLabel required>{t["forms.budget.fiscalYear"]}</FormLabel>
                        <FormControl>
                          <Input type="number" min="2000" max="2100" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={budgetForm.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t["forms.budget.startDate"]}</FormLabel>
                        <FormControl>
                          <Input type="date" dir="ltr" {...field} />
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
                        <FormLabel required>{t["forms.budget.endDate"]}</FormLabel>
                        <FormControl>
                          <Input type="date" dir="ltr" {...field} />
                        </FormControl>
                        <FormDescription>{t["forms.budget.periodHelp"]}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={budgetForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem className={formSpanFull}>
                        <FormLabel>
                          <T k="pages.notes" />
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            dir="auto"
                            rows={2}
                            placeholder={t["forms.budget.notesPlaceholder"]}
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGrid>
              </FormSection>

              <FormActions sticky>
                <Button type="button" variant="outline" onClick={() => setBudgetDialogOpen(false)}>
                  {t.cancel}
                </Button>
                <Button
                  type="submit"
                  className="sm:min-w-32"
                  disabled={createBudgetMutation.isPending || updateBudgetMutation.isPending}
                >
                  {createBudgetMutation.isPending || updateBudgetMutation.isPending
                    ? t["forms.saving"]
                    : editingBudget
                      ? t.save
                      : t["forms.budget.create"]}
                </Button>
              </FormActions>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Budget Line Add/Edit Dialog ───────────────── */}
      <Dialog open={addLineDialogOpen} onOpenChange={setAddLineDialogOpen}>
        <DialogContent size="lg" data-testid="dialog-budget-line-form">
          <DialogHeader>
            <DialogTitle>
              {editingLine ? t["forms.budget.editLineTitle"] : t["forms.budget.addLineTitle"]}
            </DialogTitle>
            <DialogDescription>
              {editingLine ? t["forms.budget.editLineDesc"] : t["forms.budget.addLineDesc"]}
            </DialogDescription>
          </DialogHeader>

          <Form {...lineForm}>
            <form
              onSubmit={lineForm.handleSubmit(handleLineSubmit)}
              noValidate
              className="space-y-6"
            >
              <FormErrorSummary />
              <FormSection title={t["forms.section.details"]}>
                <FormGrid>
                  <FormField
                    control={lineForm.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t["forms.claim.category"]}</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t["screens.selectCategory"]} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {BUDGET_CATEGORIES.map((cat) => (
                              <SelectItem key={cat} value={cat}>
                                {t[`forms.budget.cat.${cat}`] || cat}
                              </SelectItem>
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
                        <FormLabel>
                          <T k="pages.description" />
                        </FormLabel>
                        <FormControl>
                          <Input
                            dir="auto"
                            placeholder={t["forms.optional"]}
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGrid>
              </FormSection>
              <FormSection title={t["forms.budget.monthly"]}>
                <div className="rounded-lg bg-surface-sunken/60 p-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {MONTH_KEYS.map((key, idx) => (
                      <FormField
                        key={key}
                        control={lineForm.control}
                        name={key}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className={lineLabelClass}>{monthLabel(idx)}</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" min="0" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  <FormTotals
                    rows={[]}
                    total={{
                      label: t["forms.budget.annualTotal"],
                      value: <Money amount={computedAnnualTotal} currency={"AED"} />,
                    }}
                  />
                </div>
              </FormSection>

              <FormActions sticky>
                <Button type="button" variant="outline" onClick={() => setAddLineDialogOpen(false)}>
                  {t.cancel}
                </Button>
                <Button
                  type="submit"
                  className="sm:min-w-32"
                  disabled={addLineMutation.isPending || updateLineMutation.isPending}
                >
                  {addLineMutation.isPending || updateLineMutation.isPending
                    ? t["forms.saving"]
                    : editingLine
                      ? t.save
                      : t["forms.budget.addLine"]}
                </Button>
              </FormActions>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!budgetToDelete}
        onOpenChange={(open) => {
          if (!open) setBudgetToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T k="pages.deleteBudgetPlan" />
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this budget plan and all its lines. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <T k="pages.cancel" />
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (budgetToDelete) {
                  deleteBudgetMutation.mutate(budgetToDelete);
                  setBudgetToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <T k="pages.delete" />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!lineToDelete}
        onOpenChange={(open) => {
          if (!open) setLineToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T k="pages.deleteBudgetLine" />
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this budget line. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <T k="pages.cancel" />
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (lineToDelete) {
                  deleteLineMutation.mutate(lineToDelete);
                  setLineToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <T k="pages.delete" />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
