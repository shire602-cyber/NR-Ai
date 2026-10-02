import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
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
} from "lucide-react";
import { apiUrl } from "@/lib/api";
import FilingEvidencePanel from "@/components/compliance/FilingEvidencePanel";
import RecordFilingDialog from "@/components/compliance/RecordFilingDialog";
import AmendButton from "@/components/compliance/AmendButton";
import { useComplianceText } from "@/lib/i18n-compliance";
import {
  CtAdjustmentsEditor,
  CtComputationSummary,
  CtDraftEditor,
  CtReliefSwitch,
  ReliefOutcomeLine,
} from "@/components/compliance/CtAdjustments";
import {
  adjustmentsAreValid,
  localComputation,
  localReliefOffer,
  rowsToAdjustments,
  type AdjustmentRow,
  type CtBridgeAdjustment,
  type CtComputationResult,
} from "@/lib/ct-form";
import { messages as pageMessages } from "./CorporateTax.i18n";

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
  /** Written by the server's compute step (Phase 9): the add-backs and deductions, the election, and the bridge. */
  adjustments?: CtBridgeAdjustment[];
  sbrElected?: boolean;
  computation?: CtComputationResult;
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
  smallBusinessRelief?: boolean;
  status: string;
  filedAt: string | null;
  workpaper: CorporateTaxWorkpaper | null;
  notes: string | null;
  createdAt: string;
  /** Filing with evidence (Phase 4). */
  isAmendment?: boolean;
  amendsReturnId?: string | null;
  filing?: { id: string; referenceNumber: string; filedAt: string } | null;
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

const statusBadge = (status: string) => {
  switch (status) {
    case "filed":
      return (
        <Badge variant="default" className="bg-info hover:bg-info">
          <CheckCircle2 className="w-3 h-3 me-1" />
          {pageMessages.t("filed")}
        </Badge>
      );
    case "paid":
      return (
        <Badge variant="default" className="bg-success hover:bg-success">
          <Banknote className="w-3 h-3 me-1" />
          {pageMessages.t("paid")}
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          <Clock className="w-3 h-3 me-1" />
          {pageMessages.t("draft")}
        </Badge>
      );
  }
};

const CT_EXEMPTION_THRESHOLD = 375000;
const CT_TAX_RATE = 0.09;

const defaultWorkpaperRows = (): CorporateTaxWorkpaperRow[] => [
  { id: "revenue", label: pageMessages.t("revenue"), type: "revenue", amount: 0 },
  { id: "cogs", label: "COGS", type: "expense", amount: 0 },
  { id: "rent", label: pageMessages.t("rent"), type: "expense", amount: 0 },
  { id: "transport", label: pageMessages.t("transport"), type: "expense", amount: 0 },
  { id: "utility", label: pageMessages.t("utilityBill"), type: "expense", amount: 0 },
  { id: "telephone", label: pageMessages.t("telephone"), type: "expense", amount: 0 },
  { id: "license", label: pageMessages.t("license"), type: "expense", amount: 0 },
  { id: "bank-charges", label: pageMessages.t("bankServiceCharges"), type: "expense", amount: 0 },
  {
    id: "professional-fees",
    label: pageMessages.t("professionalFees"),
    type: "expense",
    amount: 0,
  },
  { id: "food", label: pageMessages.t("food"), type: "expense", amount: 0 },
  { id: "office-expenses", label: pageMessages.t("officeExpenses"), type: "expense", amount: 0 },
];

const moneyInputValue = (amount: number) => (amount === 0 ? "" : String(amount));

const parseMoneyInput = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100) / 100) : 0;
};

export default function CorporateTax() {
  const tr = pageMessages.useT();

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
      toast({ variant: "destructive", title: tr("downloadFailed"), description: error?.message });
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
        title: tr("workpaperRowsPulledFromBooks", { value: result?.rows ?? 0 }),
        description: tr("oneRowPerIncomeExpenseAccount"),
      });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: tr("couldNotPullFromBooks"),
        description: e?.message,
      }),
  });
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();

  // Calculator state
  const currentYear = new Date().getFullYear();
  const [periodStart, setPeriodStart] = useState(`${currentYear}-01-01`);
  const [periodEnd, setPeriodEnd] = useState(`${currentYear}-12-31`);
  const [adjRows, setAdjRows] = useState<AdjustmentRow[]>([]);
  const [sbrElected, setSbrElected] = useState(false);
  const [calculation, setCalculation] = useState<CalculationResult | null>(null);
  const [notes, setNotes] = useState("");
  const [workpaperRows, setWorkpaperRows] = useState<CorporateTaxWorkpaperRow[]>(() =>
    defaultWorkpaperRows()
  );

  // Detail dialog
  const [viewReturn, setViewReturn] = useState<CorporateTaxReturn | null>(null);
  const { c: cc } = useComplianceText();
  const [filingReturn, setFilingReturn] = useState<CorporateTaxReturn | null>(null);
  const [openAfterRefresh, setOpenAfterRefresh] = useState<string | null>(null);
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
    const comp = localComputation({
      totalRevenue,
      totalExpenses,
      rows: adjRows,
      elected: sbrElected,
      taxPeriodEnd: periodEnd,
    });
    const { taxableIncome, taxableAmount, taxPayable } = comp;

    return {
      periodStart: calculation?.periodStart ?? new Date(periodStart).toISOString(),
      periodEnd: calculation?.periodEnd ?? new Date(periodEnd).toISOString(),
      totalRevenue,
      totalExpenses,
      grossProfit: totalRevenue - totalExpenses,
      totalDeductions: comp.totalDeductions,
      computation: comp,
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
        title: tr("calculationComplete"),
        description: tr("processedJournalEntries", {
          journalEntriesProcessed: data.journalEntriesProcessed,
        }),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("calculationFailed"),
        description: error?.message || tr("failedToCalculateCorporateTax"),
      });
    },
  });

  // Save as draft mutation
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (!adjustedCalculation) throw new Error("No corporate tax workpaper to save");
      const comp = adjustedCalculation.computation;
      const adjustments = rowsToAdjustments(adjRows);
      const workpaper: CorporateTaxWorkpaper = {
        source: hasManualWorkpaper ? "manual_workpaper" : "journal_calculation",
        rows: workpaperRows.filter((row) => row.amount > 0 || row.notes?.trim()),
        totalRevenue: adjustedCalculation.totalRevenue,
        totalExpenses: adjustedCalculation.totalExpenses,
        profitOrLoss: adjustedCalculation.totalRevenue - adjustedCalculation.totalExpenses,
        preparedAt: new Date().toISOString(),
      };

      const created = await apiRequest(
        "POST",
        `/api/companies/${companyId}/corporate-tax/returns`,
        {
          taxPeriodStart: new Date(periodStart).toISOString(),
          taxPeriodEnd: new Date(periodEnd).toISOString(),
          totalRevenue: adjustedCalculation.totalRevenue,
          totalExpenses: adjustedCalculation.totalExpenses,
          totalDeductions: 0,
          taxableIncome: comp.taxableIncome,
          exemptionThreshold: adjustedCalculation.exemptionThreshold,
          taxRate: adjustedCalculation.taxRate,
          taxPayable: comp.taxPayable,
          status: "draft",
          workpaper,
          notes: notes || null,
        }
      );
      // The server is the source of truth: it validates the lines, checks earlier periods for the relief,
      // and stores the computation with the return.
      return apiRequest("POST", `/api/corporate-tax/returns/${created.id}/compute`, {
        adjustments,
        smallBusinessReliefElected: sbrElected,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "corporate-tax", "returns"],
      });
      toast({
        title: tr("draftSaved"),
        description: tr("corporateTaxReturnSavedAsDraft"),
      });
      setCalculation(null);
      setNotes("");
      setAdjRows([]);
      setSbrElected(false);
      setWorkpaperRows(defaultWorkpaperRows());
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("saveFailed"),
        description: error?.message || tr("failedToSaveDraft"),
      });
    },
  });

  const returnsListKey = ["/api/companies", companyId, "corporate-tax", "returns"];

  // Keep the open detail in step with the refreshed list, and open a freshly created amendment.
  useEffect(() => {
    if (!taxReturns) return;
    if (openAfterRefresh) {
      const found = taxReturns.find((r) => r.id === openAfterRefresh);
      if (found) {
        setOpenAfterRefresh(null);
        setViewReturn(found);
        setViewDialogOpen(true);
        return;
      }
    }
    setViewReturn((current) =>
      current ? (taxReturns.find((r) => r.id === current.id) ?? current) : current
    );
  }, [taxReturns, openAfterRefresh]);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("PATCH", `/api/corporate-tax/returns/${id}`, { status: "void" }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "corporate-tax", "returns"],
      });
      toast({ title: tr("returnRemoved"), description: tr("corporateTaxReturnHasBeenRemoved") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("deleteFailed"),
        description: error?.message || tr("failedToRemoveReturn"),
      });
    },
  });

  const updateWorkpaperRow = (id: string, patch: Partial<CorporateTaxWorkpaperRow>) => {
    setWorkpaperRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addWorkpaperRow = (type: CorporateTaxWorkpaperRowType) => {
    setWorkpaperRows((rows) => [
      ...rows,
      {
        id: `${type}-${Date.now()}`,
        label: type === "revenue" ? tr("otherRevenue") : tr("otherExpense"),
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
        <p className="text-muted-foreground">{tr("noCompanyFoundPleaseSetUp")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <FileCheck className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {(t as any).corporateTax || tr("corporateTax9")}
            </h1>
            <p className="text-muted-foreground mt-1">{tr("uaeCorporateTax9OnTaxable")}</p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tr("preSubmissionProfitLossWorkpaper")}</CardTitle>
          <CardDescription>{tr("enterRevenueAndExpenseLinesExactly")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="workpaperPeriodStart">{tr("periodStart")}</Label>
              <Input
                id="workpaperPeriodStart"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workpaperPeriodEnd">{tr("periodEnd")}</Label>
              <Input
                id="workpaperPeriodEnd"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => addWorkpaperRow("revenue")}>
                <Plus className="w-4 h-4 me-2" /> {tr("revenueRow")}
              </Button>
              <Button type="button" variant="outline" onClick={() => addWorkpaperRow("expense")}>
                <Plus className="w-4 h-4 me-2" /> {tr("expenseRow")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setWorkpaperRows(defaultWorkpaperRows())}
              >
                <RotateCcw className="w-4 h-4 me-2" /> {tr("reset")}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[260px] text-base font-bold">
                    {tr("year")} {new Date(periodEnd || periodStart).getFullYear() || currentYear}
                  </TableHead>
                  <TableHead className="min-w-[180px] text-end text-base font-bold">
                    {tr("expense")}
                  </TableHead>
                  <TableHead className="min-w-[180px] text-end text-base font-bold">
                    {tr("revenue")}
                  </TableHead>
                  <TableHead className="min-w-[220px]">{tr("notes")}</TableHead>
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
                        placeholder={tr("evidenceOrAdjustmentNote")}
                      />
                    </TableCell>
                    <TableCell className="text-end">
                      {workpaperRows.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeWorkpaperRow(row.id)}
                          aria-label={tr("remove", { label: row.label })}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40">
                  <TableCell className="font-bold">{tr("totals")}</TableCell>
                  <TableCell className="text-end font-bold text-destructive">
                    {formatCurrency(workpaperTotals.totalExpenses, "AED", locale)}
                  </TableCell>
                  <TableCell className="text-end font-bold">
                    {formatCurrency(workpaperTotals.totalRevenue, "AED", locale)}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
                <TableRow>
                  <TableCell className="font-bold">{tr("profitLossRevenueExpense")}</TableCell>
                  <TableCell />
                  <TableCell
                    className={`text-end font-bold ${workpaperTotals.profitOrLoss < 0 ? "text-destructive" : "text-success"}`}
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

          <p className="text-xs text-muted-foreground">{tr("thisIsACorporateTaxSupport")}</p>
        </CardContent>
      </Card>

      {/* Calculator Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            {tr("taxCalculator")}
          </CardTitle>
          <CardDescription>{tr("calculateCorporateTaxFromYourJournal")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Period Selector */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="periodStart">{tr("periodStart")}</Label>
              <Input
                id="periodStart"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="periodEnd">{tr("periodEnd")}</Label>
              <Input
                id="periodEnd"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
            <Button
              onClick={() => calculateMutation.mutate()}
              disabled={calculateMutation.isPending || !periodStart || !periodEnd}
              className="w-full md:w-auto"
            >
              {calculateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 me-2 animate-spin" /> {tr("calculating")}
                </>
              ) : (
                <>
                  <Calculator className="w-4 h-4 me-2" /> {tr("calculate")}
                </>
              )}
            </Button>
          </div>

          {/* Calculation Results */}
          {adjustedCalculation && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border p-4 space-y-3">
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
                    {tr("incomeSummary")}
                  </h3>
                  <div className="flex justify-between">
                    <span>{tr("totalRevenue")}</span>
                    <span className="font-medium">
                      {formatCurrency(adjustedCalculation.totalRevenue, "AED", locale)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{tr("totalExpenses")}</span>
                    <span className="font-medium text-destructive">
                      ({formatCurrency(adjustedCalculation.totalExpenses, "AED", locale)})
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="font-semibold">{tr("grossProfit")}</span>
                    <span className="font-semibold">
                      {formatCurrency(
                        adjustedCalculation.totalRevenue - adjustedCalculation.totalExpenses,
                        "AED",
                        locale
                      )}
                    </span>
                  </div>
                </div>

                <div className="rounded-lg border p-4 space-y-3">
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
                    {tr("taxCalculation")}
                  </h3>
                  <div className="flex justify-between">
                    <span>{tr("addBacksNet")}</span>
                    <span className="font-medium">
                      {formatCurrency(
                        adjustedCalculation.computation.totalAddBacks -
                          adjustedCalculation.computation.totalDeductions,
                        "AED",
                        locale
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{tr("taxableIncome")}</span>
                    <span className="font-medium">
                      {formatCurrency(adjustedCalculation.taxableIncome, "AED", locale)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>{tr("exemptionThreshold")}</span>
                    <span>
                      {formatCurrency(adjustedCalculation.exemptionThreshold, "AED", locale)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{tr("taxableAmountAboveThreshold")}</span>
                    <span className="font-medium">
                      {formatCurrency(adjustedCalculation.taxableAmount, "AED", locale)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>{tr("taxRate")}</span>
                    <span>9%</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-lg font-bold">{tr("taxPayable")}</span>
                    <span className="text-lg font-bold text-primary">
                      {formatCurrency(adjustedCalculation.taxPayable, "AED", locale)}
                    </span>
                  </div>
                </div>
              </div>

              <CtReliefSwitch
                offer={localReliefOffer(adjustedCalculation.totalRevenue, periodEnd)}
                elected={sbrElected}
                onChange={setSbrElected}
                revenue={adjustedCalculation.totalRevenue}
                localOffer
              />
              <CtAdjustmentsEditor rows={adjRows} onChange={setAdjRows} />
              <CtComputationSummary
                computation={adjustedCalculation.computation}
                adjustments={rowsToAdjustments(adjRows)}
              />

              <div className="text-xs text-muted-foreground">
                {calculation
                  ? tr("basedOnPostedJournalEntriesIn", {
                      journalEntriesProcessed: adjustedCalculation.journalEntriesProcessed,
                    })
                  : tr("basedOnTheManualCorporateTax")}
              </div>

              {/* Notes and Save */}
              <div className="space-y-3 pt-2 border-t">
                <div className="space-y-2">
                  <Label htmlFor="notes">{tr("notesOptional")}</Label>
                  <Textarea
                    id="notes"
                    placeholder={tr("addAnyNotesForThisTax")}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>
                <Button
                  onClick={() => saveDraftMutation.mutate()}
                  disabled={saveDraftMutation.isPending || !adjustmentsAreValid(adjRows)}
                >
                  {saveDraftMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 me-2 animate-spin" /> {tr("saving")}
                    </>
                  ) : (
                    tr("saveAsDraft")
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Returns Table */}
      <Card>
        <CardHeader>
          <CardTitle>{tr("taxReturns")}</CardTitle>
          <CardDescription>{tr("savedCorporateTaxReturnsAndTheir")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingReturns ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !taxReturns || taxReturns.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileCheck className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{tr("noCorporateTaxReturnsYet")}</p>
              <p className="text-sm">{tr("useTheCalculatorAboveToGenerate")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("period")}</TableHead>
                    <TableHead className="text-end">{tr("revenue")}</TableHead>
                    <TableHead className="text-end">{tr("taxableIncome")}</TableHead>
                    <TableHead className="text-end">{tr("taxPayable")}</TableHead>
                    <TableHead>{tr("status")}</TableHead>
                    <TableHead className="text-end">{tr("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taxReturns
                    .filter((r) => r.status !== "void")
                    .map((taxReturn) => (
                      <TableRow key={taxReturn.id}>
                        <TableCell className="font-medium">
                          {format(new Date(taxReturn.taxPeriodStart), "dd MMM yyyy")} &mdash;{" "}
                          {format(new Date(taxReturn.taxPeriodEnd), "dd MMM yyyy")}
                        </TableCell>
                        <TableCell className="text-end">
                          {formatCurrency(taxReturn.totalRevenue, "AED", locale)}
                        </TableCell>
                        <TableCell className="text-end">
                          {formatCurrency(taxReturn.taxableIncome, "AED", locale)}
                        </TableCell>
                        <TableCell className="text-end font-semibold">
                          {formatCurrency(taxReturn.taxPayable, "AED", locale)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            {statusBadge(taxReturn.status)}
                            {taxReturn.isAmendment && (
                              <Badge variant="outline">{cc.amendmentBadge}</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-end">
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
                              title={tr("downloadExcelWorkpaper")}
                              data-testid={`button-ct-export-${taxReturn.id}`}
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                            {taxReturn.status === "draft" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => pullFromBooksMutation.mutate(taxReturn.id)}
                                disabled={pullFromBooksMutation.isPending}
                                title={tr("pullWorkpaperFromBooks")}
                                data-testid={`button-ct-pull-${taxReturn.id}`}
                              >
                                <BookOpen className="w-4 h-4" />
                              </Button>
                            )}
                            {taxReturn.status === "draft" && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setFilingReturn(taxReturn)}
                                  title={cc.recordFiling}
                                  data-testid={`button-ct-record-filing-${taxReturn.id}`}
                                >
                                  <CheckCircle2 className="w-4 h-4 text-info" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => deleteMutation.mutate(taxReturn.id)}
                                  disabled={deleteMutation.isPending}
                                  title={tr("delete")}
                                >
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              </>
                            )}
                            {(taxReturn.status === "filed" || taxReturn.status === "paid") && (
                              <AmendButton
                                kind="corporate_tax"
                                returnId={taxReturn.id}
                                invalidateKeys={[returnsListKey]}
                                onCreated={setOpenAfterRefresh}
                              />
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>{tr("corporateTaxReturnDetails")}</DialogTitle>
            <DialogDescription>
              {viewReturn && (
                <>
                  {tr("period2", {
                    format: format(new Date(viewReturn.taxPeriodStart), "dd MMM yyyy"),
                    format2: format(new Date(viewReturn.taxPeriodEnd), "dd MMM yyyy"),
                  })}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {viewReturn && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <span className="text-muted-foreground">{tr("totalRevenue")}</span>
                <span className="text-end font-medium">
                  {formatCurrency(viewReturn.totalRevenue, "AED", locale)}
                </span>

                <span className="text-muted-foreground">{tr("totalExpenses")}</span>
                <span className="text-end font-medium">
                  {formatCurrency(viewReturn.totalExpenses, "AED", locale)}
                </span>

                <span className="text-muted-foreground">{tr("deductions")}</span>
                <span className="text-end font-medium">
                  {formatCurrency(
                    viewReturn.workpaper?.computation?.totalDeductions ??
                      viewReturn.totalDeductions,
                    "AED",
                    locale
                  )}
                </span>

                <span className="text-muted-foreground">{tr("addBacks")}</span>
                <span className="text-end font-medium">
                  {formatCurrency(
                    viewReturn.workpaper?.computation?.totalAddBacks ?? 0,
                    "AED",
                    locale
                  )}
                </span>

                <span className="text-muted-foreground">{tr("taxableIncome")}</span>
                <span className="text-end font-medium">
                  {formatCurrency(viewReturn.taxableIncome, "AED", locale)}
                </span>

                <span className="text-muted-foreground">{tr("exemptionThreshold")}</span>
                <span className="text-end">
                  {formatCurrency(viewReturn.exemptionThreshold, "AED", locale)}
                </span>

                <span className="text-muted-foreground">{tr("taxRate")}</span>
                <span className="text-end">{(viewReturn.taxRate * 100).toFixed(0)}%</span>

                <span className="font-semibold border-t pt-2">{tr("taxPayable")}</span>
                <span className="text-end font-bold text-primary border-t pt-2">
                  {formatCurrency(viewReturn.taxPayable, "AED", locale)}
                </span>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <span className="text-muted-foreground">{tr("status2")}</span>
                {statusBadge(viewReturn.status)}
              </div>

              <p className="text-sm" data-testid="ct-view-relief">
                <ReliefOutcomeLine
                  computation={
                    viewReturn.workpaper?.computation ?? {
                      smallBusinessRelief: {
                        elected: viewReturn.smallBusinessRelief === true,
                        eligible: viewReturn.smallBusinessRelief === true,
                        applied: viewReturn.smallBusinessRelief === true,
                        revenueCap: 3_000_000,
                      },
                    }
                  }
                />
              </p>

              {viewReturn.workpaper?.computation ? (
                <CtComputationSummary
                  computation={viewReturn.workpaper.computation}
                  adjustments={viewReturn.workpaper.adjustments}
                />
              ) : null}

              {viewReturn.filedAt && (
                <div className="text-muted-foreground text-xs">
                  {tr("filedOn", {
                    format: format(new Date(viewReturn.filedAt), "dd MMM yyyy, HH:mm"),
                  })}
                </div>
              )}

              {viewReturn.notes && (
                <div className="pt-2 border-t">
                  <span className="text-muted-foreground text-xs">{tr("notes2")}</span>
                  <p className="mt-1">{viewReturn.notes}</p>
                </div>
              )}

              {viewReturn.workpaper?.rows?.length ? (
                <div className="pt-2 border-t">
                  <span className="text-muted-foreground text-xs">{tr("supportingWorkpaper")}</span>
                  <div className="mt-2 max-h-56 overflow-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{tr("line")}</TableHead>
                          <TableHead className="text-end">{tr("expense")}</TableHead>
                          <TableHead className="text-end">{tr("revenue")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {viewReturn.workpaper.rows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>{row.label}</TableCell>
                            <TableCell className="text-end">
                              {row.type === "expense"
                                ? formatCurrency(row.amount, "AED", locale)
                                : "-"}
                            </TableCell>
                            <TableCell className="text-end">
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
          {viewReturn && (
            <CtDraftEditor
              returnId={viewReturn.id}
              isDraft={viewReturn.status === "draft"}
              totalRevenue={viewReturn.totalRevenue}
              storedAdjustments={viewReturn.workpaper?.adjustments}
              storedElected={
                viewReturn.workpaper?.sbrElected ?? viewReturn.smallBusinessRelief === true
              }
              invalidateKeys={[returnsListKey]}
            />
          )}
          {viewReturn && companyId && (
            <FilingEvidencePanel
              kind="corporate_tax"
              returnId={viewReturn.id}
              companyId={companyId}
              returnStatus={viewReturn.status}
              periodEnd={viewReturn.taxPeriodEnd}
              listKeys={[returnsListKey]}
              onOpenReturn={setOpenAfterRefresh}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              {cc.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {filingReturn && (
        <RecordFilingDialog
          open
          onOpenChange={(open) => !open && setFilingReturn(null)}
          kind="corporate_tax"
          returnId={filingReturn.id}
          periodEnd={filingReturn.taxPeriodEnd.slice(0, 10)}
          invalidateKeys={[returnsListKey]}
        />
      )}
    </div>
  );
}
