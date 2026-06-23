import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";
import { Link } from "wouter";
import { AlertTriangle, BookOpen, Check, Download, Loader2, Plus, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  parseVatPasteRows,
  vatEmirates,
  vatRowCategories,
  vatRowCategoryLabel,
  type VatRowCategory,
} from "@/lib/vat-workpaper-grid";

interface VatWorkpaperSummary {
  id: string;
  companyId: string;
  companyName?: string | null;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: string;
  generatedVatReturnId: string | null;
  totalsSnapshot: Record<string, number>;
  updatedAt: string;
}

interface VatWorkpaperRow {
  id: string;
  rowCategory: VatRowCategory;
  vat201Box: string;
  invoiceNumber: string | null;
  documentDate: string | null;
  counterpartyName: string | null;
  counterpartyTrn: string | null;
  emirate: string | null;
  taxableAmount: number;
  vatAmount: number;
  adjustmentAmount: number;
  grossAmount: number;
  status: "draft" | "approved" | "excluded";
  sourceMethod: "manual" | "ocr" | "import" | "generated";
  notes: string | null;
  auditReason: string | null;
}

interface VatWorkpaperDetail {
  workpaper: VatWorkpaperSummary;
  company: { id: string; name: string; trnVatNumber: string | null } | null;
  rows: VatWorkpaperRow[];
  totals: Record<string, number>;
}

interface VatWorkpaperPanelProps {
  companyId: string | null | undefined;
  canGenerateVatReturn: boolean;
  defaultPeriodStart: Date;
  defaultPeriodEnd: Date;
  defaultEmirate?: string | null;
  onVatReturnGenerated?: () => void;
}

const STANDARD_VAT_CATEGORIES = new Set<VatRowCategory>([
  "standard_sale",
  "tourist_refund",
  "reverse_charge_output",
  "import",
  "import_adjustment",
  "standard_expense",
  "reverse_charge_input",
]);

function inputDate(value: string | Date | null | undefined) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return format(parsed, "yyyy-MM-dd");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  try {
    return format(parseISO(String(value)), "dd MMM yyyy");
  } catch {
    return "-";
  }
}

function toMoney(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function defaultVatFor(category: VatRowCategory, amount: number) {
  return STANDARD_VAT_CATEGORIES.has(category) ? toMoney(amount * 0.05) : 0;
}

function normalizeEmirateValue(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return vatEmirates.some((emirate) => emirate.value === normalized) ? normalized : "dubai";
}

function hasPasteCategoryColumn(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  return /\b(category|vat category|source category|type)\b/i.test(firstLine);
}

export default function VatWorkpaperPanel({
  companyId,
  canGenerateVatReturn,
  defaultPeriodStart,
  defaultPeriodEnd,
  defaultEmirate,
  onVatReturnGenerated,
}: VatWorkpaperPanelProps) {
  const { toast } = useToast();
  const [selectedWorkpaperId, setSelectedWorkpaperId] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState(inputDate(defaultPeriodStart));
  const [periodEnd, setPeriodEnd] = useState(inputDate(defaultPeriodEnd));
  const [pastedRows, setPastedRows] = useState("");
  const [rowForm, setRowForm] = useState({
    rowCategory: "standard_sale" as VatRowCategory,
    documentDate: "",
    counterpartyName: "",
    counterpartyTrn: "",
    invoiceNumber: "",
    emirate: normalizeEmirateValue(defaultEmirate),
    taxableAmount: "",
    vatAmount: "",
    grossAmount: "",
    notes: "",
  });

  const dueDate = useMemo(() => {
    if (!periodEnd) return "";
    const parsed = new Date(periodEnd);
    if (Number.isNaN(parsed.getTime())) return "";
    return inputDate(addDays(parsed, 28));
  }, [periodEnd]);

  const workpapersQuery = useQuery<{ workpapers: VatWorkpaperSummary[] }>({
    queryKey: ["/api/companies", companyId, "vat-workpapers"],
    enabled: !!companyId,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/vat-workpapers`),
  });
  const workpapers = workpapersQuery.data?.workpapers ?? [];

  useEffect(() => {
    if (!selectedWorkpaperId && workpapers.length > 0) {
      setSelectedWorkpaperId(workpapers[0].id);
    } else if (
      selectedWorkpaperId &&
      workpapers.length > 0 &&
      !workpapers.some((workpaper) => workpaper.id === selectedWorkpaperId)
    ) {
      setSelectedWorkpaperId(workpapers[0].id);
    }
  }, [selectedWorkpaperId, workpapers]);

  const detailQuery = useQuery<VatWorkpaperDetail>({
    queryKey: ["/api/companies", companyId, "vat-workpapers", selectedWorkpaperId],
    enabled: !!companyId && !!selectedWorkpaperId,
    queryFn: () =>
      apiRequest("GET", `/api/companies/${companyId}/vat-workpapers/${selectedWorkpaperId}`),
  });

  const invalidateWorkpapers = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vat-workpapers"] });
    queryClient.invalidateQueries({
      queryKey: ["/api/companies", companyId, "vat-workpapers", selectedWorkpaperId],
    });
  };

  const resetRowForm = () => {
    setRowForm((form) => ({
      ...form,
      documentDate: "",
      counterpartyName: "",
      counterpartyTrn: "",
      invoiceNumber: "",
      taxableAmount: "",
      vatAmount: "",
      grossAmount: "",
      notes: "",
    }));
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const existing = workpapers.find(
        (workpaper) =>
          inputDate(workpaper.periodStart) === periodStart &&
          inputDate(workpaper.periodEnd) === periodEnd
      );
      if (existing) return existing;
      return apiRequest("POST", `/api/companies/${companyId}/vat-workpapers`, {
        periodStart,
        periodEnd,
        dueDate: dueDate || null,
      });
    },
    onSuccess: (workpaper: VatWorkpaperSummary) => {
      setSelectedWorkpaperId(workpaper.id);
      invalidateWorkpapers();
      toast({ title: "VAT workpaper ready" });
    },
    onError: (error: any) =>
      toast({
        variant: "destructive",
        title: "Could not create VAT workpaper",
        description: error?.message,
      }),
  });

  const rowPayload = () => ({
    rowCategory: rowForm.rowCategory,
    documentDate: rowForm.documentDate || null,
    counterpartyName: rowForm.counterpartyName || null,
    counterpartyTrn: rowForm.counterpartyTrn || null,
    invoiceNumber: rowForm.invoiceNumber || null,
    emirate: rowForm.emirate || null,
    taxableAmount: Number(rowForm.taxableAmount || 0),
    vatAmount: Number(rowForm.vatAmount || 0),
    grossAmount: Number(rowForm.grossAmount || 0),
    status: "approved",
    sourceMethod: "manual",
    notes: rowForm.notes || null,
    auditReason: null,
  });

  const addRowMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        `/api/companies/${companyId}/vat-workpapers/${selectedWorkpaperId}/rows`,
        rowPayload()
      ),
    onSuccess: () => {
      invalidateWorkpapers();
      resetRowForm();
    },
    onError: (error: any) =>
      toast({
        variant: "destructive",
        title: "Could not add VAT row",
        description: error?.message,
      }),
  });

  const approveAllMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        `/api/companies/${companyId}/vat-workpapers/${selectedWorkpaperId}/rows/bulk-status`,
        { to: "approved" }
      ),
    onSuccess: (result: { updated: number }) => {
      invalidateWorkpapers();
      toast({ title: `${result.updated} draft rows approved` });
    },
    onError: (error: any) =>
      toast({
        variant: "destructive",
        title: "Could not approve draft rows",
        description: error?.message,
      }),
  });

  const pullFromBooksMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        `/api/companies/${companyId}/vat-workpapers/${selectedWorkpaperId}/pull-from-books`
      ),
    onSuccess: (result: { created: number }) => {
      invalidateWorkpapers();
      toast({
        title: result.created > 0 ? `${result.created} rows pulled from books` : "Books up to date",
        description:
          result.created > 0
            ? "Review and approve draft invoice/receipt rows before generating the VAT return."
            : "Every document in this period is already on the workpaper.",
      });
    },
    onError: (error: any) =>
      toast({
        variant: "destructive",
        title: "Could not pull from books",
        description: error?.message,
      }),
  });

  const pastePreviewRows = useMemo(() => {
    if (!pastedRows.trim()) return [];
    const hasCategory = hasPasteCategoryColumn(pastedRows);
    return parseVatPasteRows(pastedRows, rowForm.emirate).map((row) => {
      const rowCategory = hasCategory ? row.rowCategory : rowForm.rowCategory;
      const taxableAmount = toMoney(row.taxableAmount);
      const vatAmount = row.vatAmount
        ? toMoney(row.vatAmount)
        : defaultVatFor(rowCategory, taxableAmount);
      return {
        ...row,
        rowCategory,
        emirate: normalizeEmirateValue(row.emirate || rowForm.emirate),
        taxableAmount,
        vatAmount,
        grossAmount: row.grossAmount || toMoney(taxableAmount + vatAmount),
      };
    });
  }, [pastedRows, rowForm.emirate, rowForm.rowCategory]);

  const importRowsMutation = useMutation({
    mutationFn: () => {
      if (!selectedWorkpaperId) throw new Error("Create or select a VAT workpaper first");
      if (pastePreviewRows.length === 0) throw new Error("Paste at least one VAT row");
      return apiRequest(
        "POST",
        `/api/companies/${companyId}/vat-workpapers/${selectedWorkpaperId}/rows/bulk`,
        { rows: pastePreviewRows }
      );
    },
    onSuccess: (result: { created: number }) => {
      invalidateWorkpapers();
      setPastedRows("");
      toast({ title: `${result.created} VAT rows imported` });
    },
    onError: (error: any) =>
      toast({
        variant: "destructive",
        title: "Could not import pasted rows",
        description: error?.message,
      }),
  });

  const generateReturnMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        `/api/companies/${companyId}/vat-workpapers/${selectedWorkpaperId}/generate-return`
      ),
    onSuccess: () => {
      invalidateWorkpapers();
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vat-returns"] });
      onVatReturnGenerated?.();
      toast({
        title: "VAT return generated",
        description: "The VAT 201 draft now uses approved workpaper row totals.",
      });
    },
    onError: (error: any) =>
      toast({
        variant: "destructive",
        title: "Could not generate VAT return",
        description: error?.message,
      }),
  });

  const [exporting, setExporting] = useState(false);
  const downloadWorkbook = async () => {
    if (!companyId || !selectedWorkpaperId) return;
    setExporting(true);
    try {
      const response = await fetch(
        apiUrl(`/api/companies/${companyId}/vat-workpapers/${selectedWorkpaperId}/export`),
        { credentials: "include" }
      );
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "vat-workpaper.xlsx";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Could not export VAT workpaper",
        description: error?.message,
      });
    } finally {
      setExporting(false);
    }
  };

  const detail = detailQuery.data;
  const rows = detail?.rows ?? [];
  const draftRows = rows.filter((row) => row.status === "draft");
  const approvedRows = rows.filter((row) => row.status === "approved");
  const totals = detail?.totals ?? detail?.workpaper.totalsSnapshot ?? {};
  const outputVat = Number(totals.box8TotalVat ?? 0);
  const inputVat = Number(totals.box13RecoverableTax ?? totals.box11TotalVat ?? 0);
  const payableVat = Number(totals.box14PayableTax ?? 0);
  const outputAmount = Number(totals.box8TotalAmount ?? 0);
  const inputAmount = Number(totals.box11TotalAmount ?? 0);

  const updateRowAmount = (value: string) => {
    const taxableAmount = Number(value || 0);
    const vatAmount = defaultVatFor(rowForm.rowCategory, taxableAmount);
    setRowForm((form) => ({
      ...form,
      taxableAmount: value,
      vatAmount: String(vatAmount || ""),
      grossAmount: String(toMoney(taxableAmount + vatAmount) || ""),
    }));
  };

  const updateRowVatAmount = (value: string) => {
    const taxableAmount = Number(rowForm.taxableAmount || 0);
    const vatAmount = Number(value || 0);
    setRowForm((form) => ({
      ...form,
      vatAmount: value,
      grossAmount: String(toMoney(taxableAmount + vatAmount) || ""),
    }));
  };

  const updateRowCategory = (rowCategory: VatRowCategory) => {
    const taxableAmount = Number(rowForm.taxableAmount || 0);
    const vatAmount = defaultVatFor(rowCategory, taxableAmount);
    setRowForm((form) => ({
      ...form,
      rowCategory,
      vatAmount: String(vatAmount || ""),
      grossAmount: String(toMoney(taxableAmount + vatAmount) || ""),
    }));
  };

  return (
    <Card data-testid="vat-workpaper-panel">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>VAT evidence workpaper</CardTitle>
            <CardDescription>
              Excel-like area for the VAT return. Record each invoice, bill, receipt, refund, or
              import line with date, party, document number, category, and amount; approved rows
              total into the VAT 201 boxes.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => pullFromBooksMutation.mutate()}
              disabled={!selectedWorkpaperId || pullFromBooksMutation.isPending}
              data-testid="button-pull-vat-workpaper-from-books"
            >
              <BookOpen className="w-4 h-4 mr-2" />
              {pullFromBooksMutation.isPending ? "Pulling..." : "Pull from books"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void downloadWorkbook()}
              disabled={!selectedWorkpaperId || exporting}
              data-testid="button-export-vat-workpaper"
            >
              <Download className="w-4 h-4 mr-2" />
              {exporting ? "Exporting..." : "Excel"}
            </Button>
            {canGenerateVatReturn ? (
              <Button
                onClick={() => generateReturnMutation.mutate()}
                disabled={!selectedWorkpaperId || generateReturnMutation.isPending}
                data-testid="button-generate-return-from-workpaper"
              >
                {generateReturnMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 mr-2" />
                )}
                Generate VAT return
              </Button>
            ) : (
              <Button asChild data-testid="link-workpaper-add-trn">
                <Link href="/company-profile">
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  Add TRN
                </Link>
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="vatWorkpaperPeriodStart">Period start</Label>
              <Input
                id="vatWorkpaperPeriodStart"
                type="date"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vatWorkpaperPeriodEnd">Period end</Label>
              <Input
                id="vatWorkpaperPeriodEnd"
                type="date"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Workpaper</Label>
              <Select value={selectedWorkpaperId ?? ""} onValueChange={setSelectedWorkpaperId}>
                <SelectTrigger data-testid="select-vat-workpaper">
                  <SelectValue
                    placeholder={workpapers.length ? "Select workpaper" : "No workpaper"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {workpapers.map((workpaper) => (
                    <SelectItem key={workpaper.id} value={workpaper.id}>
                      {formatDate(workpaper.periodStart)} - {formatDate(workpaper.periodEnd)} ·{" "}
                      {workpaper.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!companyId || !periodStart || !periodEnd || createMutation.isPending}
              data-testid="button-create-vat-workpaper"
            >
              <Plus className="w-4 h-4 mr-2" />
              {createMutation.isPending ? "Opening..." : "Create/Open"}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                queryClient.invalidateQueries({
                  queryKey: ["/api/companies", companyId, "vat-workpapers", selectedWorkpaperId],
                })
              }
              disabled={!selectedWorkpaperId}
              title="Refresh workpaper"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Approved rows</p>
            <p className="text-lg font-semibold">{approvedRows.length}</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Draft rows</p>
            <div className="flex items-center justify-between gap-2">
              <p className="text-lg font-semibold">{draftRows.length}</p>
              {draftRows.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => approveAllMutation.mutate()}
                  disabled={approveAllMutation.isPending}
                  data-testid="button-approve-vat-workpaper-drafts"
                >
                  Approve
                </Button>
              )}
            </div>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Output amount</p>
            <p className="text-lg font-semibold" data-testid="vat-workpaper-total-sales">
              {formatCurrency(outputAmount)}
            </p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Input amount</p>
            <p className="text-lg font-semibold">{formatCurrency(inputAmount)}</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Net VAT</p>
            <p
              className={`text-lg font-semibold ${payableVat >= 0 ? "text-red-600" : "text-green-600"}`}
              data-testid="vat-workpaper-net-vat"
            >
              {formatCurrency(Math.abs(payableVat))}
            </p>
            <p className="text-xs text-muted-foreground">
              Output {formatCurrency(outputVat)} / input {formatCurrency(inputVat)}
            </p>
          </div>
        </div>

        <div className="rounded-md border">
          <div className="border-b bg-muted/30 px-3 py-2">
            <p className="font-medium">Entry grid</p>
            <p className="text-xs text-muted-foreground">
              Add rows manually or paste rows from Excel. Approved rows are included in VAT 201
              totals; draft rows wait for review.
            </p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-36">Date</TableHead>
                  <TableHead className="min-w-56">Customer / vendor</TableHead>
                  <TableHead className="min-w-36">Sr. / invoice no.</TableHead>
                  <TableHead className="min-w-44">VAT category</TableHead>
                  <TableHead className="min-w-32">Emirate</TableHead>
                  <TableHead className="min-w-32 text-right">Amount</TableHead>
                  <TableHead className="min-w-32 text-right">VAT</TableHead>
                  <TableHead className="min-w-32 text-right">Gross</TableHead>
                  <TableHead className="min-w-28">Status</TableHead>
                  <TableHead className="min-w-28 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-background">
                  <TableCell>
                    <Input
                      type="date"
                      className="h-8 min-w-32"
                      value={rowForm.documentDate}
                      onChange={(event) =>
                        setRowForm((form) => ({ ...form, documentDate: event.target.value }))
                      }
                      data-testid="input-vat-row-document-date"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-52"
                      placeholder="Customer or vendor"
                      value={rowForm.counterpartyName}
                      onChange={(event) =>
                        setRowForm((form) => ({ ...form, counterpartyName: event.target.value }))
                      }
                      data-testid="input-vat-row-counterparty"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-32"
                      placeholder="INV-1001"
                      value={rowForm.invoiceNumber}
                      onChange={(event) =>
                        setRowForm((form) => ({ ...form, invoiceNumber: event.target.value }))
                      }
                      data-testid="input-vat-row-invoice-number"
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={rowForm.rowCategory}
                      onValueChange={(value) => updateRowCategory(value as VatRowCategory)}
                    >
                      <SelectTrigger className="h-8 min-w-40" data-testid="select-vat-row-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {vatRowCategories.map((category) => (
                          <SelectItem key={category.value} value={category.value}>
                            {category.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={rowForm.emirate}
                      onValueChange={(value) => setRowForm((form) => ({ ...form, emirate: value }))}
                    >
                      <SelectTrigger className="h-8 min-w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {vatEmirates.map((emirate) => (
                          <SelectItem key={emirate.value} value={emirate.value}>
                            {emirate.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-28 text-right"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={rowForm.taxableAmount}
                      onChange={(event) => updateRowAmount(event.target.value)}
                      data-testid="input-vat-row-taxable-amount"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-28 text-right"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={rowForm.vatAmount}
                      onChange={(event) => updateRowVatAmount(event.target.value)}
                      data-testid="input-vat-row-vat-amount"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-28 text-right"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={rowForm.grossAmount}
                      onChange={(event) =>
                        setRowForm((form) => ({ ...form, grossAmount: event.target.value }))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant="default">approved</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      onClick={() => addRowMutation.mutate()}
                      disabled={!selectedWorkpaperId || addRowMutation.isPending}
                      data-testid="button-add-vat-workpaper-row"
                    >
                      Add
                    </Button>
                  </TableCell>
                </TableRow>
                {detailQuery.isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Loading VAT workpaper...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No rows yet. Create a workpaper, add the first row, paste from Excel, or pull
                      issued invoices and posted receipts from books.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{formatDate(row.documentDate)}</TableCell>
                      <TableCell>
                        <p className="max-w-56 truncate">{row.counterpartyName || "-"}</p>
                        {row.counterpartyTrn && (
                          <p className="text-xs text-muted-foreground">{row.counterpartyTrn}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{row.invoiceNumber || "-"}</p>
                        <p className="text-xs text-muted-foreground">{row.vat201Box}</p>
                      </TableCell>
                      <TableCell>{vatRowCategoryLabel(row.rowCategory)}</TableCell>
                      <TableCell>{row.emirate || "-"}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(row.taxableAmount ?? 0))}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(row.vatAmount ?? 0))}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(row.grossAmount ?? 0))}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.status === "approved"
                              ? "default"
                              : row.status === "excluded"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline">{row.sourceMethod}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-2">
            <Label htmlFor="vatWorkpaperPaste">Paste from Excel</Label>
            <Textarea
              id="vatWorkpaperPaste"
              value={pastedRows}
              onChange={(event) => setPastedRows(event.target.value)}
              className="min-h-28 font-mono text-xs"
              placeholder={
                "Date\tVendor\tSr. Number\tAmount\n06/12/2025\tABDUL LATIF BROTHERS STORE\t23319\t31030"
              }
              data-testid="textarea-vat-workpaper-paste"
            />
          </div>
          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <div>
              <p className="text-xs text-muted-foreground">Default pasted-row category</p>
              <p className="text-sm font-medium">{vatRowCategoryLabel(rowForm.rowCategory)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Preview rows</p>
              <p className="text-lg font-semibold">{pastePreviewRows.length}</p>
            </div>
            <Button
              className="w-full"
              onClick={() => importRowsMutation.mutate()}
              disabled={
                !selectedWorkpaperId ||
                pastePreviewRows.length === 0 ||
                importRowsMutation.isPending
              }
              data-testid="button-import-vat-workpaper-paste"
            >
              Import pasted rows
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
