import { DatePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { PiggyBank } from "lucide-react";
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
import { dateFnsOptions } from "@/lib/date-locale";
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
import { useTranslation, translateNow } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { Money } from "@/components/ui/money";
import {
  budgetAccountOptions,
  planMonths,
  signedLineTotals,
  summariseBudget,
  type PlanMonth,
} from "@/lib/budget-summary";
import { isControlAccount } from "@shared/control-accounts";
import { accountDisplayName } from "@/lib/account-name";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { fiscalYearContaining } from "@/lib/fiscal-year";

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

interface LedgerAccount {
  id: string;
  code: string;
  nameEn?: string | null;
  nameAr?: string | null;
  type: string;
  isActive?: boolean | null;
  isVatAccount?: boolean | null;
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
  accountType: string | null;
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
  /** Year-months the plan covers; `months` of each line holds only these columns. */
  periods?: string[];
  varianceLines: VarianceLine[];
}

// ─── Schemas ─────────────────────────────────────────────

const budgetFormSchema = z
  .object({
    name: z.string().min(1, "forms.errors.budgetNameRequired"),
    fiscalYear: z.coerce.number().int().min(2000).max(2100),
    startDate: z.string().min(1, "forms.errors.startDateRequired"),
    endDate: z.string().min(1, "forms.errors.endDateRequired"),
    notes: z.string().optional().nullable(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    path: ["endDate"],
    message: "forms.errors.endDateBeforeStart",
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
    { path: ["endDate"], message: "forms.errors.budgetMax12Months" }
  );

type BudgetFormData = z.infer<typeof budgetFormSchema>;

const budgetLineFormSchema = z.object({
  // E2 (J3-r2): the account decides the actuals and whether the line is income or expense.
  accountId: z.string().min(1, "forms.errors.accountRequired"),
  category: z.string().min(1, "forms.errors.categoryRequired"),
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

/** A plan date as YYYY-MM-DD in local time (the API may send a timestamp). */
function isoDay(v: string | null | undefined): string {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : format(d, "yyyy-MM-dd");
}

export default function Budgets() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { company, companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const fyStartMonth = (company as { fiscalYearStartMonth?: number } | null | undefined)
    ?.fiscalYearStartMonth;

  const [activeTab, setActiveTab] = useState("budgets");
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetPlan | null>(null);
  const [selectedBudget, setSelectedBudget] = useState<BudgetPlan | null>(null);
  const [addLineDialogOpen, setAddLineDialogOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<BudgetLine | null>(null);
  const [budgetToDelete, setBudgetToDelete] = useState<string | null>(null);
  const [lineToDelete, setLineToDelete] = useState<string | null>(null);
  // E2 (J4-r2): a viewer is not offered writes the server refuses (403).
  const { gate } = useCompanyPermission();

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

  // E2 (J3-r2): every line budgets one P&L account (not a control account), so actuals come
  // from the ledger and income is never added to expenses.
  const { data: accounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: [`/api/companies/${companyId}/accounts`],
    enabled: !!companyId,
  });
  const accountOptions = budgetAccountOptions(accounts, (a) => isControlAccount(a));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const lineAccountType = (line: { account_id?: string | null }) =>
    line.account_id ? (accountById.get(line.account_id)?.type ?? null) : null;

  // E2 (J3-r2): the months the selected plan covers (a Sep-Nov plan has three columns).
  const selectedPlanMonths: PlanMonth[] = selectedBudget
    ? planMonths(isoDay(selectedBudget.start_date), isoDay(selectedBudget.end_date))
    : [];
  const varianceMonths: PlanMonth[] = varianceData?.periods?.length
    ? planMonths(
        `${varianceData.periods[0]}-01`,
        `${varianceData.periods[varianceData.periods.length - 1]}-01`
      )
    : selectedPlanMonths;
  const planMonthLabel = (m: PlanMonth) =>
    format(new Date(m.year, m.month - 1, 1), "MMM yyyy", dateFnsOptions(locale));

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
      accountId: "",
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
        title: translateNow("toasts.budgetCreated"),
        description: translateNow("toasts.theBudgetPlanHasBeenCreatedSuccessfully"),
      });
      setBudgetDialogOpen(false);
      budgetForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const updateBudgetMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BudgetFormData> }) =>
      apiRequest("PATCH", `/api/budget-plans/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({
        title: translateNow("toasts.budgetUpdated"),
        description: translateNow("toasts.theBudgetPlanHasBeenUpdated"),
      });
      setBudgetDialogOpen(false);
      setEditingBudget(null);
      budgetForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const deleteBudgetMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/budget-plans/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({
        title: translateNow("toasts.budgetDeleted"),
        description: translateNow("toasts.theBudgetPlanHasBeenDeleted"),
      });
      if (selectedBudget) setSelectedBudget(null);
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const approveBudgetMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/budget-plans/${id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({
        title: translateNow("toasts.budgetApproved"),
        description: translateNow("toasts.theBudgetHasBeenApproved"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
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
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
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
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
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
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
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
      toast({
        title: translateNow("toasts.error"),
        description: (error as Error).message,
        variant: "destructive",
      });
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
      toast({
        title: translateNow("toasts.lineAdded"),
        description: translateNow("toasts.budgetLineHasBeenAdded"),
      });
      setAddLineDialogOpen(false);
      setEditingLine(null);
      lineForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
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
      toast({
        title: translateNow("toasts.lineUpdated"),
        description: translateNow("toasts.budgetLineHasBeenUpdated"),
      });
      setAddLineDialogOpen(false);
      setEditingLine(null);
      lineForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/budget-lines/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/budget-plans/${selectedBudget?.id}/lines`],
      });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/budget-plans`] });
      toast({
        title: translateNow("toasts.lineDeleted"),
        description: translateNow("toasts.budgetLineHasBeenRemoved"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  // ─── Handlers ───────────────────────────────────────────

  const handleOpenCreateBudget = () => {
    setEditingBudget(null);
    // X4 (J3): default to the company's fiscal year (fiscalYearStartMonth), not Jan-Dec.
    const fy = fiscalYearContaining(fyStartMonth);
    budgetForm.reset({
      name: "",
      fiscalYear: fy.fiscalYear,
      startDate: fy.start,
      endDate: fy.end,
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
      accountId: "",
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
      accountId: line.account_id ?? "",
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

  // Plain-text status for the page header (X4/J3: the badge element printed "[object Object]").
  const statusLabel = (status: string | null | undefined): string => {
    switch (status) {
      case "draft":
        return t["pages.draft"];
      case "approved":
        return t["pages.approved"];
      case "closed":
        return t["pages.closed"];
      default:
        return status ?? "";
    }
  };

  const getVarianceColor = (variance: number) => {
    if (variance > 0) return "text-success";
    if (variance < 0) return "text-destructive";
    return "";
  };

  // E2 (J3-r2): income and expenses are totalled separately; net = income - expenses.
  const lineTotals = useCallback(
    () => signedLineTotals(budgetLines, lineAccountType),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [budgetLines, accounts]
  );

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

  /** Row actions shared by the table and the phone cards. */
  const budgetActions = (budget: BudgetPlan) => (
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
          <DropdownMenuItem onSelect={() => downloadBudgetExport(budget, "xlsx")}>
            <FileSpreadsheet aria-hidden />
            {tr(locale, "Export Excel", "تصدير Excel")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => downloadBudgetExport(budget, "csv")}>
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
            data-testid={`button-approve-budget-${budget.id}`}
            {...gate("documents.approve")}
          />
          <RowActionButton
            icon={Edit}
            label={tr(locale, "Edit", "تعديل")}
            onClick={() => handleOpenEditBudget(budget)}
            {...gate("documents.write")}
          />
        </>
      )}
    </RowActions>
  );

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
            ? `${tr(locale, "FY", "السنة المالية")} ${selectedBudget.fiscal_year} · ${statusLabel(selectedBudget.status)}`
            : tr(locale, "Plan, track, and analyze your budgets", "خطط موازناتك وتابعها وحللها")
        }
        actions={
          !selectedBudget ? (
            <Button
              onClick={handleOpenCreateBudget}
              data-testid="button-new-budget"
              {...gate("documents.write")}
            >
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
                <EmptyState
                  icon={PiggyBank}
                  title={t["pages.noBudgetPlansYetCreateYourFirstBudgetToGetStarte"]}
                  testId="budgets-empty"
                />
              ) : (
                <>
                  {/* Below 768px: stacked row-cards (line 1 name + total, line 2 year/period + status, actions). */}
                  <ul className="divide-hairline md:hidden" data-testid="mobile-budget-list">
                    {budgetPlans.map((budget) => (
                      <li
                        key={budget.id}
                        className="flex cursor-pointer items-start gap-2 py-3 first:pt-0 last:pb-0"
                        onClick={() => handleSelectBudget(budget)}
                      >
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <p dir="auto" className="min-w-0 truncate text-sm font-medium">
                              {budget.name}
                            </p>
                            <Money
                              amount={parseFloat(budget.total_budget || "0")}
                              currency={"AED"}
                              className="shrink-0 text-sm font-semibold"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <p className="min-w-0 truncate text-caption text-muted-foreground">
                              {budget.fiscal_year}
                              {" · "}
                              {budget.start_date
                                ? format(
                                    new Date(budget.start_date),
                                    "MMM yyyy",
                                    dateFnsOptions(locale)
                                  )
                                : "-"}
                              {" - "}
                              {budget.end_date
                                ? format(
                                    new Date(budget.end_date),
                                    "MMM yyyy",
                                    dateFnsOptions(locale)
                                  )
                                : "-"}
                            </p>
                            {getStatusBadge(budget.status)}
                          </div>
                        </div>
                        <div className="-me-2 -mt-1" onClick={(e) => e.stopPropagation()}>
                          {budgetActions(budget)}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="hidden overflow-x-auto md:block">
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
                                ? format(
                                    new Date(budget.start_date),
                                    "MMM yyyy",
                                    dateFnsOptions(locale)
                                  )
                                : "-"}
                              {" - "}
                              {budget.end_date
                                ? format(
                                    new Date(budget.end_date),
                                    "MMM yyyy",
                                    dateFnsOptions(locale)
                                  )
                                : "-"}
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
                                {budgetActions(budget)}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
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
                      <Button
                        onClick={handleOpenAddLine}
                        className="flex items-center gap-2"
                        data-testid="button-add-budget-line"
                        {...gate("documents.write")}
                      >
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
                  <EmptyState
                    size="sm"
                    title={t["pages.noBudgetLinesYetAddCategoriesAndMonthlyAllocatio"]}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky start-0 bg-background z-10 min-w-[160px]">
                            <T k="pages.category" />
                          </TableHead>
                          {selectedPlanMonths.map((m) => (
                            <TableHead data-numeric key={m.key} className=" min-w-[90px]">
                              {planMonthLabel(m)}
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
                                <div className="text-xs text-muted-foreground">
                                  {line.account_id && accountById.get(line.account_id)
                                    ? `${accountById.get(line.account_id)!.code} · ${accountDisplayName(accountById.get(line.account_id), locale)}`
                                    : t["forms.budget.noAccount"]}
                                </div>
                                {line.description && (
                                  <div className="text-xs text-muted-foreground">
                                    {line.description}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            {selectedPlanMonths.map(({ key, column }) => (
                              <TableCell data-numeric key={key} className=" text-sm">
                                <Money
                                  amount={parseFloat((line as any)[column] || "0")}
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
                                title={t["hr.delete"]}
                                {...gate("documents.write")}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals (E2/J3-r2): income, expenses and net, never income + expenses */}
                        {(
                          [
                            ["income", t["forms.budget.totalIncome"]],
                            ["expense", t["forms.budget.totalExpenses"]],
                            ["net", t["forms.budget.netTotal"]],
                          ] as const
                        ).map(([group, label]) => {
                          const totals = lineTotals()[group];
                          return (
                            <TableRow
                              key={group}
                              className="bg-muted/50 font-bold"
                              data-testid={`budget-total-${group}`}
                            >
                              <TableCell className="sticky start-0 bg-muted/50 z-10">
                                {label}
                              </TableCell>
                              {selectedPlanMonths.map(({ key, column }) => (
                                <TableCell data-numeric key={key} className=" text-sm">
                                  <Money amount={totals[column]} currency={"AED"} />
                                </TableCell>
                              ))}
                              <TableCell data-numeric className=" text-sm">
                                <Money amount={totals.annual} currency={"AED"} />
                              </TableCell>
                              <TableCell />
                            </TableRow>
                          );
                        })}
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
                    {t["budgets.noVarianceDataAvailableAdd"]}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky start-0 bg-background z-10 min-w-[160px]">
                            <T k="pages.category" />
                          </TableHead>
                          {varianceMonths.map((pm) => (
                            <TableHead key={pm.key} className="text-center min-w-[200px]">
                              <div>{planMonthLabel(pm)}</div>
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
                            {varianceMonths.map(({ key, column }) => {
                              // E2 (J3-r2): the report holds only the plan's months.
                              const m = line.months[column] ?? {
                                budget: 0,
                                actual: 0,
                                variance: 0,
                                variancePercent: 0,
                              };
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

                {/* Variance Summary (X4/J3): income, expense and net are totalled separately */}
                {varianceData && varianceData.varianceLines.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                    {(() => {
                      const summary = summariseBudget(varianceData.varianceLines);
                      const groups = [
                        { key: "income", title: t["budgets.summaryIncome"], g: summary.income },
                        { key: "expense", title: t["budgets.summaryExpense"], g: summary.expense },
                        { key: "net", title: t["budgets.summaryNet"], g: summary.net },
                      ];
                      return groups.map(({ key, title, g }) => (
                        <Card key={key} data-testid={`budget-summary-${key}`}>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium">{title}</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-1 text-sm">
                            <div className="flex justify-between gap-2">
                              <span className="text-muted-foreground">
                                <T k="pages.budget" />
                              </span>
                              <Money amount={g.budget} currency={"AED"} />
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-muted-foreground">
                                <T k="pages.actual" />
                              </span>
                              <Money amount={g.actual} currency={"AED"} />
                            </div>
                            <div
                              className={`flex items-center justify-between gap-2 font-semibold ${getVarianceColor(g.variance)}`}
                            >
                              <span className="flex items-center gap-1">
                                {g.variance >= 0 ? (
                                  <TrendingUp className="w-4 h-4" aria-hidden />
                                ) : (
                                  <TrendingDown className="w-4 h-4" aria-hidden />
                                )}
                                {g.variance >= 0
                                  ? t["budgets.favourable"]
                                  : t["budgets.unfavourable"]}
                              </span>
                              <Money amount={Math.abs(g.variance)} currency={"AED"} />
                            </div>
                          </CardContent>
                        </Card>
                      ));
                    })()}
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
                          <DatePicker
                            value={field.value ?? ""}
                            onChange={field.onChange}
                            data-testid="input-budget-start-date"
                          />
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
                          <DatePicker
                            value={field.value ?? ""}
                            onChange={field.onChange}
                            data-testid="input-budget-end-date"
                          />
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
                    name="accountId"
                    render={({ field }) => (
                      <FormItem className={formSpanFull}>
                        <FormLabel required>{t["forms.budget.account"]}</FormLabel>
                        <Select
                          onValueChange={(v) => {
                            field.onChange(v);
                            const acc = accountById.get(v);
                            if (acc?.type === "income" && !lineForm.getValues("category")) {
                              lineForm.setValue("category", "Revenue");
                            }
                          }}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-budget-line-account">
                              <SelectValue placeholder={t["forms.journal.selectAccount"]} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {accountOptions.map((acc) => (
                              <SelectItem key={acc.id} value={acc.id}>
                                <span className="me-2 inline-block tabular-nums text-muted-foreground">
                                  {acc.code}
                                </span>
                                {accountDisplayName(acc, locale)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>{t["forms.budget.accountHelp"]}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                  <div className="mobile-keep-cols grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {(selectedPlanMonths.length
                      ? selectedPlanMonths.map((pm) => ({
                          key: pm.key,
                          column: pm.column,
                          label: planMonthLabel(pm),
                        }))
                      : MONTH_KEYS.map((column, idx) => ({
                          key: column,
                          column,
                          label: monthLabel(idx),
                        }))
                    ).map((pm) => (
                      <FormField
                        key={pm.key}
                        control={lineForm.control}
                        name={pm.column}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className={lineLabelClass}>{pm.label}</FormLabel>
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
              {t["budgets.thisWillPermanentlyDeleteThis"]}
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
              {t["budgets.thisWillPermanentlyDeleteThis2"]}
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
