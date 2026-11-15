import { useMemo, useState } from "react";
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

const statusBadge = (status: string) => {
  switch (status) {
    case "filed":
      return (
        <Badge variant="default" className="bg-blue-500 hover:bg-blue-600">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Filed
        </Badge>
      );
    case "paid":
      return (
        <Badge variant="default" className="bg-green-500 hover:bg-green-600">
          <Banknote className="w-3 h-3 mr-1" />
          Paid
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          <Clock className="w-3 h-3 mr-1" />
          Draft
        </Badge>
      );
  }
};

const CT_EXEMPTION_THRESHOLD = 375000;
const CT_TAX_RATE = 0.09;

const defaultWorkpaperRows = (): CorporateTaxWorkpaperRow[] => [
  { id: "revenue", label: "Revenue", type: "revenue", amount: 0 },
  { id: "cogs", label: "COGS", type: "expense", amount: 0 },
  { id: "rent", label: "Rent", type: "expense", amount: 0 },
  { id: "transport", label: "Transport", type: "expense", amount: 0 },
  { id: "utility", label: "Utility bill", type: "expense", amount: 0 },
  { id: "telephone", label: "Telephone", type: "expense", amount: 0 },
  { id: "license", label: "License", type: "expense", amount: 0 },
  { id: "bank-charges", label: "Bank service charges", type: "expense", amount: 0 },
  { id: "professional-fees", label: "Professional fees", type: "expense", amount: 0 },
  { id: "food", label: "Food", type: "expense", amount: 0 },
  { id: "office-expenses", label: "Office expenses", type: "expense", amount: 0 },
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
    defaultWorkpaperRows()
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
      const taxableIncome =
        adjustedCalculation.totalRevenue - adjustedCalculation.totalExpenses - deductions;
      const taxableAmount = Math.max(0, taxableIncome - adjustedCalculation.exemptionThreshold);
      const taxPayable = Math.round(taxableAmount * adjustedCalculation.taxRate * 100) / 100;
      const workpaper: CorporateTaxWorkpaper = {
        source: hasManualWorkpaper ? "manual_workpaper" : "journal_calculation",
        rows: workpaperRows.filter((row) => row.amount > 0 || row.notes?.trim()),
        totalRevenue: adjustedCalculation.totalRevenue,
        totalExpenses: adjustedCalculation.totalExpenses,
        profitOrLoss: adjustedCalculation.totalRevenue - adjustedCalculation.totalExpenses,
        preparedAt: new Date().toISOString(),
      };

      return apiRequest("POST", `/api/companies/${companyId}/corporate-tax/returns`, {
        taxPeriodStart: new Date(periodStart).toISOString(),
        taxPeriodEnd: new Date(periodEnd).toISOString(),
        totalRevenue: adjustedCalculation.totalRevenue,
        totalExpenses: adjustedCalculation.totalExpenses,
        totalDeductions: deductions,
        taxableIncome: Math.round(taxableIncome * 100) / 100,
        exemptionThreshold: adjustedCalculation.exemptionThreshold,
        taxRate: adjustedCalculation.taxRate,
        taxPayable,
        status: "draft",
        workpaper,
        notes: notes || null,
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
      setWorkpaperRows(defaultWorkpaperRows());
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Save Failed",
        description: error?.message || "Failed to save draft",
      });
    },
  });

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/corporate-tax/returns/${id}`, {
        status,
        ...(status === "filed" ? { filedAt: new Date().toISOString() } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "corporate-tax", "returns"],
      });
      toast({ title: "Status Updated", description: "Tax return status has been updated." });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: error?.message || "Failed to update status",
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("PATCH", `/api/corporate-tax/returns/${id}`, { status: "void" }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "corporate-tax", "returns"],
      });
      toast({ title: "Return Removed", description: "Corporate tax return has been removed." });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: error?.message || "Failed to remove return",
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
        label: type === "revenue" ? "Other revenue" : "Other expense",
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
        <p className="text-muted-foreground">No company found. Please set up your company first.</p>
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
              {(t as any).corporateTax || "Corporate Tax (9%)"}
            </h1>
            <p className="text-muted-foreground mt-1">
              UAE Corporate Tax &mdash; 9% on taxable income above AED 375,000
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pre-submission Profit / Loss Workpaper</CardTitle>
          <CardDescription>
            Enter revenue and expense lines exactly like the Excel schedule used before filing.
            These rows support the draft return and do not mark anything as submitted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="workpaperPeriodStart">Period Start</Label>
              <Input
                id="workpaperPeriodStart"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workpaperPeriodEnd">Period End</Label>
              <Input
                id="workpaperPeriodEnd"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => addWorkpaperRow("revenue")}>
                <Plus className="w-4 h-4 mr-2" /> Revenue row
              </Button>
              <Button type="button" variant="outline" onClick={() => addWorkpaperRow("expense")}>
                <Plus className="w-4 h-4 mr-2" /> Expense row
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setWorkpaperRows(defaultWorkpaperRows())}
              >
                <RotateCcw className="w-4 h-4 mr-2" /> Reset
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[260px] text-base font-bold">
                    Year {new Date(periodEnd || periodStart).getFullYear() || currentYear}
                  </TableHead>
                  <TableHead className="min-w-[180px] text-right text-base font-bold">
                    Expense
                  </TableHead>
                  <TableHead className="min-w-[180px] text-right text-base font-bold">
                    Revenue
                  </TableHead>
                  <TableHead className="min-w-[220px]">Notes</TableHead>
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
                          className="text-right"
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
                          className="text-right"
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
                        placeholder="Evidence or adjustment note"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {workpaperRows.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeWorkpaperRow(row.id)}
                          aria-label={`Remove ${row.label}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40">
                  <TableCell className="font-bold">Totals</TableCell>
                  <TableCell className="text-right font-bold text-red-600">
                    {formatCurrency(workpaperTotals.totalExpenses, "AED", locale)}
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {formatCurrency(workpaperTotals.totalRevenue, "AED", locale)}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
                <TableRow>
                  <TableCell className="font-bold">PROFIT / LOSS (Revenue - Expense)</TableCell>
                  <TableCell />
                  <TableCell
                    className={`text-right font-bold ${workpaperTotals.profitOrLoss < 0 ? "text-red-600" : "text-green-700"}`}
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

          <p className="text-xs text-muted-foreground">
            This is a corporate tax support schedule. It creates a draft return only; it does not
            submit to the FTA and it does not post accounting entries.
          </p>
        </CardContent>
      </Card>

      {/* Calculator Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            Tax Calculator
          </CardTitle>
          <CardDescription>
            Calculate corporate tax from your journal entries for a given period
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Period Selector */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="periodStart">Period Start</Label>
              <Input
                id="periodStart"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="periodEnd">Period End</Label>
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
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Calculating...
                </>
              ) : (
                <>
                  <Calculator className="w-4 h-4 mr-2" /> Calculate
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
                    Income Summary
                  </h3>
                  <div className="flex justify-between">
                    <span>Total Revenue</span>
                    <span className="font-medium">
                      {formatCurrency(adjustedCalculation.totalRevenue, "AED", locale)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Expenses</span>
                    <span className="font-medium text-red-600">
                      ({formatCurrency(adjustedCalculation.totalExpenses, "AED", locale)})
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="font-semibold">Gross Profit</span>
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
                    Tax Calculation
                  </h3>
                  <div className="flex justify-between items-center">
                    <span>Deductions</span>
                    <Input
                      type="number"
                      className="w-40 text-right"
                      value={deductions}
                      onChange={(e) => setDeductions(parseFloat(e.target.value) || 0)}
                      min={0}
                      step={100}
                    />
                  </div>
                  <div className="flex justify-between">
                    <span>Taxable Income</span>
                    <span className="font-medium">
                      {formatCurrency(adjustedCalculation.taxableIncome, "AED", locale)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Exemption Threshold</span>
                    <span>
                      {formatCurrency(adjustedCalculation.exemptionThreshold, "AED", locale)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Taxable Amount (above threshold)</span>
                    <span className="font-medium">
                      {formatCurrency(adjustedCalculation.taxableAmount, "AED", locale)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Tax Rate</span>
                    <span>9%</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-lg font-bold">Tax Payable</span>
                    <span className="text-lg font-bold text-primary">
                      {formatCurrency(adjustedCalculation.taxPayable, "AED", locale)}
                    </span>
                  </div>
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
                    placeholder="Add any notes for this tax return..."
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
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...
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

      {/* Returns Table */}
      <Card>
        <CardHeader>
          <CardTitle>Tax Returns</CardTitle>
          <CardDescription>Saved corporate tax returns and their filing status</CardDescription>
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
              <p>No corporate tax returns yet.</p>
              <p className="text-sm">Use the calculator above to generate your first return.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Taxable Income</TableHead>
                    <TableHead className="text-right">Tax Payable</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
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
                        <TableCell className="text-right">
                          {formatCurrency(taxReturn.totalRevenue, "AED", locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(taxReturn.taxableIncome, "AED", locale)}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(taxReturn.taxPayable, "AED", locale)}
                        </TableCell>
                        <TableCell>{statusBadge(taxReturn.status)}</TableCell>
                        <TableCell className="text-right">
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
                              title="Download Excel workpaper"
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
                                title="Pull workpaper from books"
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
                                  onClick={() =>
                                    updateStatusMutation.mutate({
                                      id: taxReturn.id,
                                      status: "filed",
                                    })
                                  }
                                  disabled={updateStatusMutation.isPending}
                                  title="Mark as Filed"
                                >
                                  <CheckCircle2 className="w-4 h-4 text-blue-500" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => deleteMutation.mutate(taxReturn.id)}
                                  disabled={deleteMutation.isPending}
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              </>
                            )}
                            {taxReturn.status === "filed" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  updateStatusMutation.mutate({ id: taxReturn.id, status: "paid" })
                                }
                                disabled={updateStatusMutation.isPending}
                                title="Mark as Paid"
                              >
                                <Banknote className="w-4 h-4 text-green-500" />
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
            <DialogTitle>Corporate Tax Return Details</DialogTitle>
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
                <span className="text-muted-foreground">Total Revenue</span>
                <span className="text-right font-medium">
                  {formatCurrency(viewReturn.totalRevenue, "AED", locale)}
                </span>

                <span className="text-muted-foreground">Total Expenses</span>
                <span className="text-right font-medium">
                  {formatCurrency(viewReturn.totalExpenses, "AED", locale)}
                </span>

                <span className="text-muted-foreground">Deductions</span>
                <span className="text-right font-medium">
                  {formatCurrency(viewReturn.totalDeductions, "AED", locale)}
                </span>

                <span className="text-muted-foreground">Taxable Income</span>
                <span className="text-right font-medium">
                  {formatCurrency(viewReturn.taxableIncome, "AED", locale)}
                </span>

                <span className="text-muted-foreground">Exemption Threshold</span>
                <span className="text-right">
                  {formatCurrency(viewReturn.exemptionThreshold, "AED", locale)}
                </span>

                <span className="text-muted-foreground">Tax Rate</span>
                <span className="text-right">{(viewReturn.taxRate * 100).toFixed(0)}%</span>

                <span className="font-semibold border-t pt-2">Tax Payable</span>
                <span className="text-right font-bold text-primary border-t pt-2">
                  {formatCurrency(viewReturn.taxPayable, "AED", locale)}
                </span>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <span className="text-muted-foreground">Status:</span>
                {statusBadge(viewReturn.status)}
              </div>

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
                          <TableHead className="text-right">Expense</TableHead>
                          <TableHead className="text-right">Revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {viewReturn.workpaper.rows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>{row.label}</TableCell>
                            <TableCell className="text-right">
                              {row.type === "expense"
                                ? formatCurrency(row.amount, "AED", locale)
                                : "-"}
                            </TableCell>
                            <TableCell className="text-right">
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
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
