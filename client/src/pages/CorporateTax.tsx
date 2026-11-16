import { T } from "@/components/layout/T";
import { useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { formatDate as formatDisplayDate, formatDateRange } from "@/lib/format-date";
import {
  FileCheck,
  Calculator,
  Loader2,
  Eye,
  CheckCircle2,
  Clock,
  Banknote,
  Trash2,
  Plus,
  RotateCcw,
  Download,
  BookOpen,
  AlertTriangle,
  ShieldCheck,
  Users,
  ClipboardCheck,
  Send,
  FilePen,
} from "lucide-react";
import { apiUrl } from "@/lib/api";

const ctTr = (locale: string, en: string, ar: string) => (locale === "ar" ? ar : en);

type CorporateTaxWorkpaperRowType = "revenue" | "expense";

interface CorporateTaxWorkpaperRow {
  id: string;
  label: string;
  type: CorporateTaxWorkpaperRowType;
  amount: number;
  notes?: string;
}

interface CorporateTaxWorkpaper {
  source: "manual_workpaper" | "journal_calculation";
  rows: CorporateTaxWorkpaperRow[];
  totalRevenue: number;
  totalExpenses: number;
  profitOrLoss: number;
  preparedAt: string;
}

interface CorporateTaxReturn {
  id: string;
  companyId: string;
  taxPeriodStart: string;
  taxPeriodEnd: string;
  totalRevenue: number;
  totalExpenses: number;
  totalDeductions: number;
  taxableIncome: number;
  exemptionThreshold: number;
  taxRate: number;
  taxPayable: number;
  status: string;
  filedAt: string | null;
  filedBy?: string | null;
  reviewedBy?: string | null;
  preparedBy?: string | null;
  amendmentNumber?: number;
  amendsReturnId?: string | null;
  provisionEntryId?: string | null;
  filingDeadline?: string;
  /** S1 (R12-12): estimate until reviewed; filing_ready once reviewed; filed after filing. */
  figureStatus?: "estimate" | "filing_ready" | "filed" | "superseded";
  workpaper: CorporateTaxWorkpaper | null;
  notes: string | null;
  createdAt: string;
}

interface CalculationResult {
  periodStart: string;
  periodEnd: string;
  totalRevenue: number;
  totalExpenses: number;
  grossProfit: number;
  totalDeductions: number;
  taxableIncome: number;
  exemptionThreshold: number;
  taxableAmount: number;
  taxRate: number;
  taxPayable: number;
  journalEntriesProcessed: number;
}

/** S1 (R12-12): a computed CT figure is an estimate until the return is reviewed or filed. */
function FigureBadge({ status }: { status?: string }) {
  if (status === "filing_ready") {
    return (
      <Badge variant="outline" data-testid="badge-ct-filing-ready">
        <T k="corporateTax.figureFilingReady" />
      </Badge>
    );
  }
  if (status === "filed") {
    return (
      <Badge variant="outline" data-testid="badge-ct-filed">
        <T k="corporateTax.figureFiled" />
      </Badge>
    );
  }
  if (status === "superseded") return null;
  return (
    <Badge variant="secondary" data-testid="badge-ct-estimate">
      <T k="corporateTax.figureEstimate" />
    </Badge>
  );
}

const statusBadge = (status: string) => {
  switch (status) {
    case "filed":
      return (
        <Badge variant="default" className="bg-info hover:bg-info">
          <CheckCircle2 className="w-3 h-3 me-1" />
          <T k="pages.filed" />
        </Badge>
      );
    case "paid":
      return (
        <Badge variant="default" className="bg-success hover:bg-success">
          <Banknote className="w-3 h-3 me-1" />
          <T k="corporateTax.statusPaid" />
        </Badge>
      );
    case "computed":
      return (
        <Badge variant="secondary">
          <Calculator className="w-3 h-3 me-1" />
          <T k="corporateTax.statusComputed" />
        </Badge>
      );
    case "reviewed":
      return (
        <Badge variant="outline">
          <ClipboardCheck className="w-3 h-3 me-1" />
          <T k="corporateTax.statusReviewed" />
        </Badge>
      );
    case "amended":
      return (
        <Badge variant="outline">
          <FilePen className="w-3 h-3 me-1" />
          <T k="corporateTax.statusAmended" />
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          <Clock className="w-3 h-3 me-1" />
          <T k="pages.draft" />
        </Badge>
      );
  }
};

const CT_EXEMPTION_THRESHOLD = 375000;
const CT_TAX_RATE = 0.09;

const defaultWorkpaperRows = (locale: string): CorporateTaxWorkpaperRow[] => [
  { id: "revenue", label: ctTr(locale, "Revenue", "الإيرادات"), type: "revenue", amount: 0 },
  { id: "cogs", label: ctTr(locale, "COGS", "تكلفة البضاعة المباعة"), type: "expense", amount: 0 },
  { id: "rent", label: ctTr(locale, "Rent", "الإيجار"), type: "expense", amount: 0 },
  { id: "transport", label: ctTr(locale, "Transport", "النقل"), type: "expense", amount: 0 },
  {
    id: "utility",
    label: ctTr(locale, "Utility bill", "فواتير المرافق"),
    type: "expense",
    amount: 0,
  },
  { id: "telephone", label: ctTr(locale, "Telephone", "الهاتف"), type: "expense", amount: 0 },
  { id: "license", label: ctTr(locale, "License", "الرخص"), type: "expense", amount: 0 },
  {
    id: "bank-charges",
    label: ctTr(locale, "Bank service charges", "الرسوم البنكية"),
    type: "expense",
    amount: 0,
  },
  {
    id: "professional-fees",
    label: ctTr(locale, "Professional fees", "الأتعاب المهنية"),
    type: "expense",
    amount: 0,
  },
  { id: "food", label: ctTr(locale, "Food", "الطعام"), type: "expense", amount: 0 },
  {
    id: "office-expenses",
    label: ctTr(locale, "Office expenses", "مصروفات المكتب"),
    type: "expense",
    amount: 0,
  },
];

const moneyInputValue = (amount: number) => (amount === 0 ? "" : String(amount));

const parseMoneyInput = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100) / 100) : 0;
};

export default function CorporateTax() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();

  const downloadBlob = async (url: string, fallbackName: string) => {
    try {
      const response = await fetch(apiUrl(url), { credentials: "include" });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Download failed", description: error?.message });
    }
  };

  const pullFromBooksMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/corporate-tax/returns/${id}/pull-from-books`),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/companies/${companyId}/corporate-tax/returns`],
      });
      toast({
        title: `${result?.rows ?? 0} workpaper rows pulled from books`,
        description: "One row per income/expense account with its posted net for the period.",
      });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: "Could not pull from books",
        description: e?.message,
      }),
  });
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();

  // Calculator state
  const currentYear = new Date().getFullYear();
  const [periodStart, setPeriodStart] = useState(`${currentYear}-01-01`);
  const [periodEnd, setPeriodEnd] = useState(`${currentYear}-12-31`);
  const [deductions, setDeductions] = useState(0);
  const [calculation, setCalculation] = useState<CalculationResult | null>(null);
  const [notes, setNotes] = useState("");
  const [workpaperRows, setWorkpaperRows] = useState<CorporateTaxWorkpaperRow[]>(() =>
    defaultWorkpaperRows(locale)
  );

  // Detail dialog
  const [viewReturn, setViewReturn] = useState<CorporateTaxReturn | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);

  // Fetch existing returns
  const { data: taxReturns, isLoading: isLoadingReturns } = useQuery<CorporateTaxReturn[]>({
    queryKey: ["/api/companies", companyId, "corporate-tax", "returns"],
    enabled: !!companyId,
  });

  const workpaperTotals = useMemo(() => {
    const totalRevenue = workpaperRows
      .filter((row) => row.type === "revenue")
      .reduce((sum, row) => sum + row.amount, 0);
    const totalExpenses = workpaperRows
      .filter((row) => row.type === "expense")
      .reduce((sum, row) => sum + row.amount, 0);
    return {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      profitOrLoss: Math.round((totalRevenue - totalExpenses) * 100) / 100,
    };
  }, [workpaperRows]);

  const hasManualWorkpaper = workpaperRows.some((row) => row.amount > 0 || row.notes?.trim());

  const adjustedCalculation = (() => {
    if (!calculation && !hasManualWorkpaper) return null;
    const totalRevenue = hasManualWorkpaper
      ? workpaperTotals.totalRevenue
      : (calculation?.totalRevenue ?? 0);
    const totalExpenses = hasManualWorkpaper
      ? workpaperTotals.totalExpenses
      : (calculation?.totalExpenses ?? 0);
    const exemptionThreshold = calculation?.exemptionThreshold ?? CT_EXEMPTION_THRESHOLD;
    const taxRate = calculation?.taxRate ?? CT_TAX_RATE;
    const taxableIncome = totalRevenue - totalExpenses - deductions;
    const taxableAmount = Math.max(0, taxableIncome - exemptionThreshold);
    const taxPayable = Math.round(taxableAmount * taxRate * 100) / 100;

    return {
      periodStart: calculation?.periodStart ?? new Date(periodStart).toISOString(),
      periodEnd: calculation?.periodEnd ?? new Date(periodEnd).toISOString(),
      totalRevenue,
      totalExpenses,
      grossProfit: totalRevenue - totalExpenses,
      totalDeductions: deductions,
      taxableIncome,
      exemptionThreshold,
      taxableAmount,
      taxRate,
      taxPayable,
      journalEntriesProcessed: calculation?.journalEntriesProcessed ?? 0,
    };
  })();

  // Calculate mutation
  const calculateMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "GET",
        `/api/companies/${companyId}/corporate-tax/calculate?periodStart=${periodStart}&periodEnd=${periodEnd}`
      ),
    onSuccess: (data: CalculationResult) => {
      setCalculation(data);
      toast({
        title: "Calculation Complete",
        description: `Processed ${data.journalEntriesProcessed} journal entries.`,
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Calculation Failed",
        description: error?.message || "Failed to calculate corporate tax",
      });
    },
  });

  // Save as draft mutation
  const saveDraftMutation = useMutation({
    mutationFn: () => {
      if (!adjustedCalculation) throw new Error("No corporate tax workpaper to save");
      const workpaper: CorporateTaxWorkpaper = {
        source: hasManualWorkpaper ? "manual_workpaper" : "journal_calculation",
        rows: workpaperRows.filter((row) => row.amount > 0 || row.notes?.trim()),
        totalRevenue: adjustedCalculation.totalRevenue,
        totalExpenses: adjustedCalculation.totalExpenses,
        profitOrLoss: adjustedCalculation.totalRevenue - adjustedCalculation.totalExpenses,
        preparedAt: new Date().toISOString(),
      };

      // R08-09: the server computes taxable income, rate and liability.
      return apiRequest("POST", `/api/companies/${companyId}/corporate-tax/returns`, {
        taxPeriodStart: periodStart,
        taxPeriodEnd: periodEnd,
        totalRevenue: adjustedCalculation.totalRevenue,
        totalExpenses: adjustedCalculation.totalExpenses,
        totalDeductions: deductions,
        workpaper: { source: workpaper.source, rows: workpaper.rows },
        ...(notes ? { notes } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "corporate-tax", "returns"],
      });
      toast({
        title: "Draft Saved",
        description: "Corporate tax return saved as draft.",
      });
      setCalculation(null);
      setNotes("");
      setDeductions(0);
      setWorkpaperRows(defaultWorkpaperRows(locale));
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Save Failed",
        description: error?.message || "Failed to save draft",
      });
    },
  });

  // Lifecycle transitions (R08-04): computed -> reviewed -> filed -> paid; void; amend.
  const invalidateReturns = () =>
    queryClient.invalidateQueries({
      queryKey: ["/api/companies", companyId, "corporate-tax", "returns"],
    });
  const transitionMutation = useMutation({
    mutationFn: ({
      id,
      to,
      postProvision,
    }: {
      id: string;
      to: "computed" | "reviewed" | "filed" | "paid" | "void";
      postProvision?: boolean;
    }) =>
      apiRequest("POST", `/api/corporate-tax/returns/${id}/transition`, {
        to,
        ...(postProvision ? { postProvision: true } : {}),
      }),
    onSuccess: () => {
      invalidateReturns();
      toast({ title: t["corporateTax.statusUpdated"] });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t["corporateTax.statusUpdateFailed"],
        description: error?.message,
      });
    },
  });
  const amendMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/corporate-tax/returns/${id}/amend`, {
        reason: t["corporateTax.amendDefaultReason"],
      }),
    onSuccess: () => {
      invalidateReturns();
      toast({ title: t["corporateTax.amendmentCreated"] });
    },
    onError: (error: Error) =>
      toast({
        variant: "destructive",
        title: t["corporateTax.statusUpdateFailed"],
        description: error?.message,
      }),
  });
  const [postProvision, setPostProvision] = useState(true);

  const updateWorkpaperRow = (id: string, patch: Partial<CorporateTaxWorkpaperRow>) => {
    setWorkpaperRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addWorkpaperRow = (type: CorporateTaxWorkpaperRowType) => {
    setWorkpaperRows((rows) => [
      ...rows,
      {
        id: `${type}-${Date.now()}`,
        label: type === "revenue" ? t["corporateTax.otherRevenue"] : t["corporateTax.otherExpense"],
        type,
        amount: 0,
      },
    ]);
  };

  const removeWorkpaperRow = (id: string) => {
    setWorkpaperRows((rows) => rows.filter((row) => row.id !== id));
  };

  if (isLoadingCompany) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">
          <T k="pageLabels.noCompanyFoundPleaseSetUpYourCompanyFirst" />
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Compliance"
        title={(t as any).corporateTax || "Corporate Tax (9%)"}
        description={t["corporateTax.pageSubtitle"]}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t["corporateTax.workpaperTitle"]}</CardTitle>
          <CardDescription>{t["corporateTax.workpaperDescription"]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="workpaperPeriodStart">
                <T k="pages.periodStart" />
              </Label>
              <DatePicker id="workpaperPeriodStart" value={periodStart} onChange={setPeriodStart} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workpaperPeriodEnd">
                <T k="pages.periodEnd" />
              </Label>
              <DatePicker id="workpaperPeriodEnd" value={periodEnd} onChange={setPeriodEnd} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => addWorkpaperRow("revenue")}>
                <Plus className="w-4 h-4 me-2" />
                <T k="pageLabels.revenueRow" />
              </Button>
              <Button type="button" variant="outline" onClick={() => addWorkpaperRow("expense")}>
                <Plus className="w-4 h-4 me-2" />
                <T k="pageLabels.expenseRow" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setWorkpaperRows(defaultWorkpaperRows(locale))}
              >
                <RotateCcw className="w-4 h-4 me-2" /> <T k="pages.reset" />
              </Button>
            </div>
          </div>

          {/* Below 768px: each worksheet line is a stacked card (description, amount, note, remove). */}
          <div className="space-y-3 md:hidden" data-testid="mobile-workpaper-list">
            {workpaperRows.map((row) => (
              <div key={row.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={row.label}
                    onChange={(e) => updateWorkpaperRow(row.id, { label: e.target.value })}
                    className="font-medium"
                    aria-label={`${ctTr(locale, "Workpaper line description", "وصف بند ورقة العمل")}: ${row.label}`}
                  />
                  {workpaperRows.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => removeWorkpaperRow(row.id)}
                      aria-label={`${ctTr(locale, "Remove", "إزالة")} ${row.label}`}
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground" aria-hidden />
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-caption text-muted-foreground">
                    {row.type === "expense" ? <T k="pages.expense" /> : <T k="pages.revenue" />}
                  </span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={moneyInputValue(row.amount)}
                    onChange={(e) =>
                      updateWorkpaperRow(row.id, { amount: parseMoneyInput(e.target.value) })
                    }
                    aria-label={`${row.label} ${ctTr(locale, "amount", "المبلغ")}`}
                    className="text-end"
                    placeholder="0.00"
                  />
                </div>
                <Input
                  value={row.notes ?? ""}
                  onChange={(e) => updateWorkpaperRow(row.id, { notes: e.target.value })}
                  placeholder={ctTr(
                    locale,
                    "Evidence or adjustment note",
                    "ملاحظة الدليل أو التسوية"
                  )}
                  aria-label={`${row.label} ${ctTr(locale, "note", "ملاحظة")}`}
                />
              </div>
            ))}
            <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold">
                  <T k="pages.totals" />
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  <T k="pages.expense" />
                </span>
                <Money amount={workpaperTotals.totalExpenses} currency={"AED"} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  <T k="pages.revenue" />
                </span>
                <Money amount={workpaperTotals.totalRevenue} currency={"AED"} />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border-strong pt-1 font-semibold">
                <span>{t["corporateTax.workpaperProfitLoss"]}</span>
                <span
                  className={workpaperTotals.profitOrLoss < 0 ? "text-negative" : "text-foreground"}
                >
                  {workpaperTotals.profitOrLoss < 0
                    ? `(${formatCurrency(Math.abs(workpaperTotals.profitOrLoss), "AED", locale)})`
                    : formatCurrency(workpaperTotals.profitOrLoss, "AED", locale)}
                </span>
              </div>
            </div>
          </div>

          <div className="hidden overflow-x-auto rounded-md border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[260px] text-base font-bold">
                    {formatMessage(t["corporateTax.workpaperYear"], {
                      year: new Date(periodEnd || periodStart).getFullYear() || currentYear,
                    })}
                  </TableHead>
                  <TableHead data-numeric className="min-w-[180px] text-base font-bold">
                    <T k="pages.expense" />
                  </TableHead>
                  <TableHead data-numeric className="min-w-[180px] text-base font-bold">
                    <T k="pages.revenue" />
                  </TableHead>
                  <TableHead className="min-w-[220px]">
                    <T k="pages.notes" />
                  </TableHead>
                  <TableHead className="w-[56px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {workpaperRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Input
                        value={row.label}
                        onChange={(e) => updateWorkpaperRow(row.id, { label: e.target.value })}
                        className="font-medium"
                        aria-label={`${ctTr(locale, "Workpaper line description", "وصف بند ورقة العمل")}: ${row.label}`}
                      />
                    </TableCell>
                    <TableCell>
                      {row.type === "expense" ? (
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={moneyInputValue(row.amount)}
                          onChange={(e) =>
                            updateWorkpaperRow(row.id, { amount: parseMoneyInput(e.target.value) })
                          }
                          aria-label={`${row.label} ${ctTr(locale, "amount", "المبلغ")}`}
                          className="text-end"
                          placeholder="0.00"
                        />
                      ) : (
                        <div className="h-10 rounded-md border bg-muted/30" />
                      )}
                    </TableCell>
                    <TableCell>
                      {row.type === "revenue" ? (
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={moneyInputValue(row.amount)}
                          onChange={(e) =>
                            updateWorkpaperRow(row.id, { amount: parseMoneyInput(e.target.value) })
                          }
                          aria-label={`${row.label} ${ctTr(locale, "amount", "المبلغ")}`}
                          className="text-end"
                          placeholder="0.00"
                        />
                      ) : (
                        <div className="h-10 rounded-md border bg-muted/30" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.notes ?? ""}
                        onChange={(e) => updateWorkpaperRow(row.id, { notes: e.target.value })}
                        placeholder={ctTr(
                          locale,
                          "Evidence or adjustment note",
                          "ملاحظة الدليل أو التسوية"
                        )}
                        aria-label={`${row.label} ${ctTr(locale, "note", "ملاحظة")}`}
                      />
                    </TableCell>
                    <TableCell data-numeric>
                      {workpaperRows.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeWorkpaperRow(row.id)}
                          aria-label={`${ctTr(locale, "Remove", "إزالة")} ${row.label}`}
                        >
                          <Trash2 className="w-4 h-4 text-muted-foreground" aria-hidden />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40">
                  <TableCell className="font-bold">
                    <T k="pages.totals" />
                  </TableCell>
                  <TableCell data-numeric className="font-semibold">
                    <Money amount={workpaperTotals.totalExpenses} currency={"AED"} />
                  </TableCell>
                  <TableCell data-numeric className=" font-bold">
                    <Money amount={workpaperTotals.totalRevenue} currency={"AED"} />
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
                <TableRow>
                  <TableCell className="font-bold">
                    {t["corporateTax.workpaperProfitLoss"]}
                  </TableCell>
                  <TableCell />
                  <TableCell
                    data-numeric
                    className={`font-semibold ${workpaperTotals.profitOrLoss < 0 ? "text-negative" : "text-foreground"}`}
                  >
                    {workpaperTotals.profitOrLoss < 0
                      ? `(${formatCurrency(Math.abs(workpaperTotals.profitOrLoss), "AED", locale)})`
                      : formatCurrency(workpaperTotals.profitOrLoss, "AED", locale)}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">{t["corporateTax.workpaperDisclaimer"]}</p>
        </CardContent>
      </Card>

      {/* Calculator Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            <T k="pageLabels.taxCalculator" />
          </CardTitle>
          <CardDescription>{t["corporateTax.calculatorDescription"]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Period Selector */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="periodStart">
                <T k="pages.periodStart" />
              </Label>
              <DatePicker id="periodStart" value={periodStart} onChange={setPeriodStart} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="periodEnd">
                <T k="pages.periodEnd" />
              </Label>
              <DatePicker id="periodEnd" value={periodEnd} onChange={setPeriodEnd} />
            </div>
            <Button
              onClick={() => calculateMutation.mutate()}
              disabled={calculateMutation.isPending || !periodStart || !periodEnd}
              className="w-full md:w-auto md:justify-self-end"
            >
              {calculateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  <T k="pageLabels.calculating" />
                </>
              ) : (
                <>
                  <Calculator className="w-4 h-4 me-2" />
                  <T k="hr.calculate" />
                </>
              )}
            </Button>
          </div>

          {/* Calculation Results */}
          {adjustedCalculation && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border p-4 space-y-3">
                  <h3 className="font-semibold text-sm text-muted-foreground">
                    <T k="pageLabels.incomeSummary" />
                  </h3>
                  <div className="flex justify-between">
                    <span>
                      <T k="pages.totalRevenue" />
                    </span>
                    <span className="font-medium">
                      <Money amount={adjustedCalculation.totalRevenue} currency={"AED"} />
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>
                      <T k="pages.totalExpenses" />
                    </span>
                    <span className="font-medium">
                      ({formatCurrency(adjustedCalculation.totalExpenses, "AED", locale)})
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="font-semibold">
                      <T k="pageLabels.grossProfit" />
                    </span>
                    <span className="font-semibold">
                      <Money
                        amount={
                          adjustedCalculation.totalRevenue - adjustedCalculation.totalExpenses
                        }
                        currency={"AED"}
                      />
                    </span>
                  </div>
                </div>

                <div className="rounded-lg border p-4 space-y-3">
                  <h3 className="font-semibold text-sm text-muted-foreground">
                    <T k="pageLabels.taxCalculation" />
                  </h3>
                  <div className="flex justify-between items-center">
                    <span>
                      <T k="pages.deductions" />
                    </span>
                    <Input
                      type="number"
                      className="w-40 text-end"
                      value={deductions}
                      onChange={(e) => setDeductions(parseFloat(e.target.value) || 0)}
                      min={0}
                      step={100}
                    />
                  </div>
                  <div className="flex justify-between">
                    <span>
                      <T k="pages.taxableIncome" />
                    </span>
                    <span className="font-medium">
                      <Money amount={adjustedCalculation.taxableIncome} currency={"AED"} />
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>
                      <T k="pages.exemptionThreshold" />
                    </span>
                    <span>
                      <Money amount={adjustedCalculation.exemptionThreshold} currency={"AED"} />
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Taxable Amount (above threshold)</span>
                    <span className="font-medium">
                      <Money amount={adjustedCalculation.taxableAmount} currency={"AED"} />
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>
                      <T k="pages.taxRate" />
                    </span>
                    <span>9%</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-lg font-bold">
                      <T k="pages.taxPayable" /> <FigureBadge status="estimate" />
                    </span>
                    <span className="text-lg font-bold text-primary">
                      <Money amount={adjustedCalculation.taxPayable} currency={"AED"} />
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <T k="corporateTax.figureEstimateHint" />
                  </p>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                {calculation
                  ? `Based on ${adjustedCalculation.journalEntriesProcessed} posted journal entries in the selected period.`
                  : "Based on the manual corporate tax workpaper rows above."}
              </div>

              {/* Notes and Save */}
              <div className="space-y-3 pt-2 border-t">
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes (optional)</Label>
                  <Textarea
                    id="notes"
                    placeholder={t["corporateTax.addAnyNotesForThis"]}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>
                <Button
                  onClick={() => saveDraftMutation.mutate()}
                  disabled={saveDraftMutation.isPending}
                >
                  {saveDraftMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 me-2 animate-spin" />
                      <T k="pageLabels.saving" />
                    </>
                  ) : (
                    "Save as Draft"
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CtCompliancePanel companyId={companyId} />

      {/* Returns Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            <T k="pageLabels.taxReturns" />
          </CardTitle>
          <CardDescription>
            <T k="pageLabels.savedCorporateTaxReturnsAndTheirFilingStatus" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-3 text-sm">
            <p className="text-muted-foreground">{t["corporateTax.lifecycleHelp"]}</p>
            <label className="flex items-center gap-2">
              <Switch checked={postProvision} onCheckedChange={setPostProvision} />
              {t["corporateTax.postProvisionOnFiling"]}
            </label>
          </div>
          {isLoadingReturns ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !taxReturns || taxReturns.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileCheck className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>
                <T k="pageLabels.noCorporateTaxReturnsYet" />
              </p>
              <p className="text-sm">
                <T k="pageLabels.useTheCalculatorAboveToGenerateYourFirstReturn" />
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="pages.period" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pages.revenue" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pages.taxableIncome" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pages.taxPayable" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.status" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="pages.actions" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taxReturns
                    .filter((r) => r.status !== "void")
                    .map((taxReturn) => (
                      <TableRow key={taxReturn.id}>
                        <TableCell className="font-medium" data-nowrap>
                          {formatDateRange(
                            taxReturn.taxPeriodStart,
                            taxReturn.taxPeriodEnd,
                            locale
                          )}
                        </TableCell>
                        <TableCell data-numeric>
                          <Money amount={taxReturn.totalRevenue} currency={"AED"} />
                        </TableCell>
                        <TableCell data-numeric>
                          <Money amount={taxReturn.taxableIncome} currency={"AED"} />
                        </TableCell>
                        <TableCell data-numeric className=" font-semibold">
                          <Money amount={taxReturn.taxPayable} currency={"AED"} />
                          <div>
                            <FigureBadge status={taxReturn.figureStatus} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {statusBadge(taxReturn.status)}
                            {taxReturn.filingDeadline && (
                              <span className="text-xs text-muted-foreground">
                                {t["corporateTax.dueBy"]}{" "}
                                {formatDisplayDate(taxReturn.filingDeadline, locale)}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell data-numeric>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setViewReturn(taxReturn);
                                setViewDialogOpen(true);
                              }}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                void downloadBlob(
                                  `/api/corporate-tax/returns/${taxReturn.id}/export`,
                                  "ct-workpaper.xlsx"
                                )
                              }
                              title={t["corporateTax.downloadExcelWorkpaper"]}
                              data-testid={`button-ct-export-${taxReturn.id}`}
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                            {(taxReturn.status === "draft" || taxReturn.status === "computed") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => pullFromBooksMutation.mutate(taxReturn.id)}
                                disabled={pullFromBooksMutation.isPending}
                                title={t["corporateTax.pullFromBooks"]}
                                data-testid={`button-ct-pull-${taxReturn.id}`}
                              >
                                <BookOpen className="w-4 h-4" />
                              </Button>
                            )}
                            {taxReturn.status === "draft" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  transitionMutation.mutate({ id: taxReturn.id, to: "computed" })
                                }
                                disabled={transitionMutation.isPending}
                                title={t["corporateTax.markComputed"]}
                                data-testid={`button-ct-compute-${taxReturn.id}`}
                              >
                                <Calculator className="w-4 h-4" />
                              </Button>
                            )}
                            {taxReturn.status === "computed" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  transitionMutation.mutate({ id: taxReturn.id, to: "reviewed" })
                                }
                                disabled={transitionMutation.isPending}
                                title={t["corporateTax.markReviewed"]}
                                data-testid={`button-ct-review-${taxReturn.id}`}
                              >
                                <ClipboardCheck className="w-4 h-4 text-muted-foreground" />
                              </Button>
                            )}
                            {taxReturn.status === "reviewed" && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    transitionMutation.mutate({
                                      id: taxReturn.id,
                                      to: "filed",
                                      postProvision,
                                    })
                                  }
                                  disabled={transitionMutation.isPending}
                                  title={t["corporateTax.markFiled"]}
                                  data-testid={`button-ct-file-${taxReturn.id}`}
                                >
                                  <Send className="w-4 h-4 text-muted-foreground" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    transitionMutation.mutate({ id: taxReturn.id, to: "computed" })
                                  }
                                  disabled={transitionMutation.isPending}
                                  title={t["corporateTax.sendBack"]}
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                            {(taxReturn.status === "draft" || taxReturn.status === "computed") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  transitionMutation.mutate({ id: taxReturn.id, to: "void" })
                                }
                                disabled={transitionMutation.isPending}
                                title={t["corporateTax.voidReturn"]}
                              >
                                <Trash2 className="w-4 h-4 text-muted-foreground" aria-hidden />
                              </Button>
                            )}
                            {taxReturn.status === "filed" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  transitionMutation.mutate({ id: taxReturn.id, to: "paid" })
                                }
                                disabled={transitionMutation.isPending}
                                title={t["corporateTax.markPaid"]}
                              >
                                <Banknote className="w-4 h-4 text-muted-foreground" aria-hidden />
                              </Button>
                            )}
                            {(taxReturn.status === "filed" || taxReturn.status === "paid") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => amendMutation.mutate(taxReturn.id)}
                                disabled={amendMutation.isPending}
                                title={t["corporateTax.amend"]}
                                data-testid={`button-ct-amend-${taxReturn.id}`}
                              >
                                <FilePen className="w-4 h-4" />
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

      {/* View Detail Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.corporateTaxReturnDetails" />
            </DialogTitle>
            <DialogDescription>
              {viewReturn && (
                <>
                  Period: {format(new Date(viewReturn.taxPeriodStart), "dd MMM yyyy")} &mdash;{" "}
                  {format(new Date(viewReturn.taxPeriodEnd), "dd MMM yyyy")}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {viewReturn && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <span className="text-muted-foreground">
                  <T k="pages.totalRevenue" />
                </span>
                <span className="text-end font-medium">
                  <Money amount={viewReturn.totalRevenue} currency={"AED"} />
                </span>

                <span className="text-muted-foreground">
                  <T k="pages.totalExpenses" />
                </span>
                <span className="text-end font-medium">
                  <Money amount={viewReturn.totalExpenses} currency={"AED"} />
                </span>

                <span className="text-muted-foreground">
                  <T k="pages.deductions" />
                </span>
                <span className="text-end font-medium">
                  <Money amount={viewReturn.totalDeductions} currency={"AED"} />
                </span>

                <span className="text-muted-foreground">
                  <T k="pages.taxableIncome" />
                </span>
                <span className="text-end font-medium">
                  <Money amount={viewReturn.taxableIncome} currency={"AED"} />
                </span>

                <span className="text-muted-foreground">
                  <T k="pages.exemptionThreshold" />
                </span>
                <span className="text-end">
                  <Money amount={viewReturn.exemptionThreshold} currency={"AED"} />
                </span>

                <span className="text-muted-foreground">
                  <T k="pages.taxRate" />
                </span>
                <span className="text-end">{(viewReturn.taxRate * 100).toFixed(0)}%</span>

                <span className="font-semibold border-t pt-2">
                  <T k="pages.taxPayable" /> <FigureBadge status={viewReturn.figureStatus} />
                </span>
                <span className="text-end font-bold text-primary border-t pt-2">
                  <Money amount={viewReturn.taxPayable} currency={"AED"} />
                </span>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <span className="text-muted-foreground">Status:</span>
                {statusBadge(viewReturn.status)}
              </div>

              {viewReturn.filingDeadline && (
                <div className="text-muted-foreground text-xs">
                  {t["corporateTax.dueBy"]} {formatDisplayDate(viewReturn.filingDeadline, locale)}
                  {viewReturn.amendmentNumber
                    ? ` · ${t["corporateTax.amendmentLabel"]} ${viewReturn.amendmentNumber}`
                    : ""}
                </div>
              )}
              {viewReturn.filedAt && (
                <div className="text-muted-foreground text-xs">
                  Filed on: {format(new Date(viewReturn.filedAt), "dd MMM yyyy, HH:mm")}
                </div>
              )}

              {viewReturn.notes && (
                <div className="pt-2 border-t">
                  <span className="text-muted-foreground text-xs">Notes:</span>
                  <p className="mt-1">{viewReturn.notes}</p>
                </div>
              )}

              {viewReturn.workpaper?.rows?.length ? (
                <div className="pt-2 border-t">
                  <span className="text-muted-foreground text-xs">Supporting workpaper:</span>
                  <div className="mt-2 max-h-56 overflow-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Line</TableHead>
                          <TableHead data-numeric>
                            <T k="pages.expense" />
                          </TableHead>
                          <TableHead data-numeric>
                            <T k="pages.revenue" />
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {viewReturn.workpaper.rows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>{row.label}</TableCell>
                            <TableCell data-numeric>
                              {row.type === "expense"
                                ? formatCurrency(row.amount, "AED", locale)
                                : "-"}
                            </TableCell>
                            <TableCell data-numeric>
                              {row.type === "revenue"
                                ? formatCurrency(row.amount, "AED", locale)
                                : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              <T k="pages.close" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export interface CtProfile {
  isQfzp: boolean;
  freeZone: string | null;
  mneGroupRevenue: number | null;
  tradeLicenceExpiry: string | null;
  exciseRegistered: boolean;
  einvoicingRevenueBand: "ge_50m" | "lt_50m" | null;
  adviserConfirmedAt: string | null;
  adviserName: string | null;
  adviserReviewPending: boolean;
}

interface RelatedParty {
  id: string;
  name: string;
  relationship: "related_party" | "connected_person";
  jurisdiction: string | null;
  transactionValue: number;
}

/**
 * CT profile (QFZP, compliance settings), adviser confirmation and the
 * related-party register (W4-A: R08-15, R08-17, R08-21).
 */
export function CtCompliancePanel({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const profileKey = [`/api/companies/${companyId}/corporate-tax/profile`];
  const partiesKey = [`/api/companies/${companyId}/corporate-tax/related-parties`];
  const { data: profile } = useQuery<CtProfile>({ queryKey: profileKey });
  const { data: parties = [] } = useQuery<RelatedParty[]>({ queryKey: partiesKey });
  const [adviserName, setAdviserName] = useState("");
  const [partyName, setPartyName] = useState("");
  const [partyValue, setPartyValue] = useState("");
  const [partyKind, setPartyKind] = useState<RelatedParty["relationship"]>("related_party");

  const onError = (e: Error) =>
    toast({ variant: "destructive", title: t["corporateTax.saveFailed"], description: e.message });

  const saveProfile = useMutation({
    mutationFn: (patch: Partial<CtProfile>) =>
      apiRequest("PUT", `/api/companies/${companyId}/corporate-tax/profile`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKey });
      toast({ title: t["corporateTax.profileSaved"] });
    },
    onError,
  });

  const confirmAdviser = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/corporate-tax/profile/adviser-confirmation`, {
        adviserName,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKey });
      setAdviserName("");
      toast({ title: t["corporateTax.adviserConfirmed"] });
    },
    onError,
  });

  const addParty = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/corporate-tax/related-parties`, {
        name: partyName,
        relationship: partyKind,
        transactionValue: Number(partyValue) || 0,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: partiesKey });
      setPartyName("");
      setPartyValue("");
    },
    onError,
  });

  const removeParty = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/companies/${companyId}/corporate-tax/related-parties/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: partiesKey }),
    onError,
  });

  const total = parties
    .filter((p) => p.relationship === "related_party")
    .reduce((s, p) => s + p.transactionValue, 0);

  return (
    <Card data-testid="ct-compliance-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" />
          {t["corporateTax.profileTitle"]}
        </CardTitle>
        <CardDescription>{t["corporateTax.profileDescription"]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {profile?.adviserReviewPending !== false ? (
          <div
            className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
            data-testid="ct-adviser-review-pending"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 text-warning shrink-0" />
            <div className="space-y-2 flex-1">
              <p className="font-medium">{t["corporateTax.adviserPendingTitle"]}</p>
              <p className="text-muted-foreground">{t["corporateTax.adviserPendingBody"]}</p>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="max-w-xs"
                  value={adviserName}
                  onChange={(e) => setAdviserName(e.target.value)}
                  placeholder={t["corporateTax.adviserNamePlaceholder"]}
                  aria-label={t["corporateTax.adviserNamePlaceholder"]}
                />
                <Button
                  size="sm"
                  onClick={() => confirmAdviser.mutate()}
                  disabled={adviserName.trim().length < 2 || confirmAdviser.isPending}
                >
                  {t["corporateTax.recordAdviserConfirmation"]}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Badge variant="success">
            {t["corporateTax.adviserConfirmedBy"]} {profile.adviserName}
          </Badge>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="ct-qfzp">{t["corporateTax.qfzpLabel"]}</Label>
              <p className="text-xs text-muted-foreground">{t["corporateTax.qfzpHelp"]}</p>
            </div>
            <Switch
              id="ct-qfzp"
              checked={profile?.isQfzp === true}
              onCheckedChange={(checked) => saveProfile.mutate({ isQfzp: checked })}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="ct-excise">{t["corporateTax.exciseLabel"]}</Label>
              <p className="text-xs text-muted-foreground">{t["corporateTax.exciseHelp"]}</p>
            </div>
            <Switch
              id="ct-excise"
              checked={profile?.exciseRegistered === true}
              onCheckedChange={(checked) => saveProfile.mutate({ exciseRegistered: checked })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ct-licence">{t["corporateTax.tradeLicenceExpiry"]}</Label>
            <DatePicker
              id="ct-licence"
              value={profile?.tradeLicenceExpiry ?? ""}
              onChange={(v) =>
                v !== (profile?.tradeLicenceExpiry ?? "") &&
                saveProfile.mutate({ tradeLicenceExpiry: v || null })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ct-band">{t["corporateTax.einvoicingBand"]}</Label>
            <select
              id="ct-band"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={profile?.einvoicingRevenueBand ?? ""}
              onChange={(e) =>
                saveProfile.mutate({
                  einvoicingRevenueBand: (e.target.value ||
                    null) as CtProfile["einvoicingRevenueBand"],
                })
              }
            >
              <option value="">{t["corporateTax.einvoicingBandAuto"]}</option>
              <option value="ge_50m">{t["corporateTax.einvoicingBandLarge"]}</option>
              <option value="lt_50m">{t["corporateTax.einvoicingBandSmall"]}</option>
            </select>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium flex items-center gap-2">
              <Users className="w-4 h-4" /> {t["corporateTax.relatedPartiesTitle"]}
            </h3>
            <span className="text-sm text-muted-foreground">
              {t["corporateTax.relatedPartiesTotal"]} <Money amount={total} currency={"AED"} />
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{t["corporateTax.relatedPartiesHelp"]}</p>
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              placeholder={t["corporateTax.partyName"]}
              aria-label={t["corporateTax.partyName"]}
            />
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={partyKind}
              onChange={(e) => setPartyKind(e.target.value as RelatedParty["relationship"])}
              aria-label={t["corporateTax.partyRelationship"]}
            >
              <option value="related_party">{t["corporateTax.relatedParty"]}</option>
              <option value="connected_person">{t["corporateTax.connectedPerson"]}</option>
            </select>
            <Input
              className="max-w-[180px]"
              type="number"
              min={0}
              value={partyValue}
              onChange={(e) => setPartyValue(e.target.value)}
              placeholder={t["corporateTax.partyValue"]}
              aria-label={t["corporateTax.partyValue"]}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => addParty.mutate()}
              disabled={!partyName.trim() || addParty.isPending}
            >
              {t["corporateTax.addParty"]}
            </Button>
          </div>
          {parties.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {parties.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-3 py-2">
                  <span>
                    {p.name}{" "}
                    <span className="text-muted-foreground">
                      (
                      {p.relationship === "related_party"
                        ? t["corporateTax.relatedParty"]
                        : t["corporateTax.connectedPerson"]}
                      )
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Money amount={p.transactionValue} currency={"AED"} />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeParty.mutate(p.id)}
                      aria-label={t["corporateTax.removeParty"]}
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground" aria-hidden />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
