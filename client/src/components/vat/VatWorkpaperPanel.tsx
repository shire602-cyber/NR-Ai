import { useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { useTranslation, translateNow, formatMessage } from "@/lib/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";
import { Link } from "wouter";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

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
import { T } from "@/components/layout/T";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api";
import { Money } from "@/components/ui/money";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { resolveSelectedId } from "@/lib/selection";
import {
  evaluateAmountExpression,
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
  journalEntryId: string | null;
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

const POSTABLE_LEDGER_CATEGORIES = new Set<VatRowCategory>([
  "standard_sale",
  "zero_rated_sale",
  "exempt_sale",
  "standard_expense",
  "reverse_charge_input",
  "import",
]);

function canPostVatWorkpaperRow(row: VatWorkpaperRow) {
  return (
    row.sourceMethod === "manual" &&
    row.status !== "excluded" &&
    !row.journalEntryId &&
    POSTABLE_LEDGER_CATEGORIES.has(row.rowCategory)
  );
}

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
  const parsed = evaluateAmountExpression(value as string | number | null | undefined);
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
  const { t } = useTranslation();
  const { toast } = useToast();
  const [pickedWorkpaperId, setSelectedWorkpaperId] = useState<string | null>(null);
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
  const workpapers = useMemo(
    () => workpapersQuery.data?.workpapers ?? [],
    [workpapersQuery.data?.workpapers]
  );
  // Default to the first workpaper whenever nothing (or a stale id) is picked.
  const selectedWorkpaperId = resolveSelectedId(pickedWorkpaperId, workpapers);

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
      toast({ title: translateNow("toasts.vatWorkpaperReady") });
    },
    onError: (error: any) =>
      toast({
        variant: "destructive",
        title: translateNow("toasts.couldNotCreateVatWorkpaper"),
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
    taxableAmount: toMoney(rowForm.taxableAmount),
    vatAmount: toMoney(rowForm.vatAmount),
    grossAmount: toMoney(rowForm.grossAmount),
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
        title: translateNow("toasts.couldNotAddVatRow"),
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
      toast({
        title: formatMessage(translateNow("toasts.draftRowsApproved"), { updated: result.updated }),
      });
    },
    onError: (error: any) =>
      toast({
        variant: "destructive",
        title: translateNow("toasts.couldNotApproveDraftRows"),
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
        title:
          result.created > 0
            ? formatMessage(translateNow("toasts.rowsPulledFromBooks"), { created: result.created })
            : translateNow("toasts.booksUpToDate"),
        description:
          result.created > 0
            ? translateNow("toasts.reviewDraftRowsBeforeVat")
            : translateNow("toasts.everyDocumentOnWorkpaper"),
      });
    },
    onError: (error: any) =>
      toast({
        variant: "destructive",
        title: translateNow("toasts.couldNotPullFromBooks"),
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
      toast({
        title: formatMessage(translateNow("toasts.vatRowsImported"), { created: result.created }),
      });
    },
    onError: (error: any) =>
      toast({
        variant: "destructive",
        title: translateNow("toasts.couldNotImportPastedRows"),
        description: error?.message,
      }),
  });

  const postRowMutation = useMutation({
    mutationFn: (rowId: string) => {
      if (!selectedWorkpaperId) throw new Error("Create or select a VAT workpaper first");
      return apiRequest(
        "POST",
        `/api/companies/${companyId}/vat-workpapers/${selectedWorkpaperId}/rows/${rowId}/post`
      );
    },
    onSuccess: () => {
      invalidateWorkpapers();
      toast({ title: translateNow("toasts.vatRowPostedToLedger") });
    },
    onError: (error: any) =>
      toast({
        variant: "destructive",
        title: translateNow("toasts.couldNotPostVatRow"),
        description: error?.message,
      }),
  });

  const deleteRowMutation = useMutation({
    mutationFn: (rowId: string) => {
      if (!selectedWorkpaperId) throw new Error("Create or select a VAT workpaper first");
      return apiRequest(
        "DELETE",
        `/api/companies/${companyId}/vat-workpapers/${selectedWorkpaperId}/rows/${rowId}`
      );
    },
    onSuccess: () => {
      invalidateWorkpapers();
      toast({ title: translateNow("toasts.vatRowRemoved") });
    },
    onError: (error: any) =>
      toast({
        variant: "destructive",
        title: translateNow("toasts.couldNotRemoveVatRow"),
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
        title: translateNow("toasts.vatReturnGenerated"),
        description: translateNow("toasts.theVat201DraftNowUsesApproved"),
      });
    },
    onError: (error: any) =>
      toast({
        variant: "destructive",
        title: translateNow("toasts.couldNotGenerateVatReturn"),
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
        title: translateNow("toasts.couldNotExportVatWorkpaper"),
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
    const taxableAmount = toMoney(value);
    const vatAmount = defaultVatFor(rowForm.rowCategory, taxableAmount);
    setRowForm((form) => ({
      ...form,
      taxableAmount: value,
      vatAmount: String(vatAmount || ""),
      grossAmount: String(toMoney(taxableAmount + vatAmount) || ""),
    }));
  };

  const updateRowVatAmount = (value: string) => {
    const taxableAmount = toMoney(rowForm.taxableAmount);
    const vatAmount = toMoney(value);
    setRowForm((form) => ({
      ...form,
      vatAmount: value,
      grossAmount: String(toMoney(taxableAmount + vatAmount) || ""),
    }));
  };

  const updateRowCategory = (rowCategory: VatRowCategory) => {
    const taxableAmount = toMoney(rowForm.taxableAmount);
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
            <CardTitle>
              <T k="components.vwTitle" />
            </CardTitle>
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
              <BookOpen className="w-4 h-4 me-2" />
              {pullFromBooksMutation.isPending
                ? t["components.vatWorkpaperPulling"]
                : t["components.vatWorkpaperPull"]}
            </Button>
            <Button
              variant="outline"
              onClick={() => void downloadWorkbook()}
              disabled={!selectedWorkpaperId || exporting}
              data-testid="button-export-vat-workpaper"
            >
              <Download className="w-4 h-4 me-2" />
              {exporting ? "Exporting..." : "Excel"}
            </Button>
            {canGenerateVatReturn ? (
              <Button
                onClick={() => generateReturnMutation.mutate()}
                disabled={!selectedWorkpaperId || generateReturnMutation.isPending}
                data-testid="button-generate-return-from-workpaper"
              >
                {generateReturnMutation.isPending ? (
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 me-2" />
                )}
                Generate VAT return
              </Button>
            ) : (
              <Button asChild data-testid="link-workpaper-add-trn">
                <Link href="/company-profile">
                  <AlertTriangle className="w-4 h-4 me-2" />
                  <T k="components.vwAddTrn" />
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
              <Label htmlFor="vatWorkpaperPeriodStart">
                <T k="components.vwPeriodStart" />
              </Label>
              <DatePicker
                id="vatWorkpaperPeriodStart"
                value={periodStart}
                onChange={(value) => setPeriodStart(value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vatWorkpaperPeriodEnd">
                <T k="components.vwPeriodEnd" />
              </Label>
              <DatePicker
                id="vatWorkpaperPeriodEnd"
                value={periodEnd}
                onChange={(value) => setPeriodEnd(value)}
              />
            </div>
            <div className="space-y-1">
              <Label>
                <T k="components.vwWorkpaper" />
              </Label>
              <Select value={selectedWorkpaperId ?? ""} onValueChange={setSelectedWorkpaperId}>
                <SelectTrigger data-testid="select-vat-workpaper">
                  <SelectValue
                    placeholder={
                      workpapers.length
                        ? t["components.vatWorkpaperSelect"]
                        : t["components.vatWorkpaperNone"]
                    }
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
              <Plus className="w-4 h-4 me-2" />
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
              title={t["components.vatWorkpaperRefresh"]}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">
              <T k="components.vwApprovedRows" />
            </p>
            <p className="text-lg font-semibold">{approvedRows.length}</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">
              <T k="components.vwDraftRows" />
            </p>
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
                  <T k="components.vwApprove" />
                </Button>
              )}
            </div>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">
              <T k="components.vwOutputAmount" />
            </p>
            <p className="text-lg font-semibold" data-testid="vat-workpaper-total-sales">
              <Money amount={outputAmount} />
            </p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">
              <T k="components.vwInputAmount" />
            </p>
            <p className="text-lg font-semibold">
              <Money amount={inputAmount} />
            </p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">
              <T k="components.vwNetVat" />
            </p>
            <p
              className={`text-lg font-semibold ${payableVat >= 0 ? "text-foreground" : "text-positive"}`}
              data-testid="vat-workpaper-net-vat"
            >
              <Money amount={Math.abs(payableVat)} />
            </p>
            <p className="text-xs text-muted-foreground">
              <T k="components.vwOutputShort" /> <Money amount={outputVat} /> ·{" "}
              <T k="components.vwInputShort" /> <Money amount={inputVat} />
            </p>
          </div>
        </div>

        <div className="rounded-md border">
          <div className="border-b bg-muted/30 px-3 py-2">
            <p className="font-medium">
              <T k="components.vwEntryGrid" />
            </p>
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
                  <TableHead className="min-w-44">
                    <T k="components.vwColCategory" />
                  </TableHead>
                  <TableHead className="min-w-32">
                    <T k="components.vwColEmirate" />
                  </TableHead>
                  <TableHead data-numeric className="min-w-32">
                    <T k="components.vwColAmount" />
                  </TableHead>
                  <TableHead data-numeric className="min-w-32">
                    VAT
                  </TableHead>
                  <TableHead data-numeric className="min-w-32">
                    <T k="components.vwColGross" />
                  </TableHead>
                  <TableHead className="min-w-28">
                    <T k="components.vwColStatus" />
                  </TableHead>
                  <TableHead data-numeric className="w-12">
                    <T k="components.vwColAction" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-background">
                  <TableCell>
                    <DatePicker
                      className="h-8 min-w-32"
                      value={rowForm.documentDate}
                      onChange={(value) => setRowForm((form) => ({ ...form, documentDate: value }))}
                      data-testid="input-vat-row-document-date"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-52"
                      placeholder={t["components.vatWorkpaperCounterparty"]}
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
                      className="h-8 min-w-28 text-end"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={rowForm.taxableAmount}
                      onChange={(event) => updateRowAmount(event.target.value)}
                      data-testid="input-vat-row-taxable-amount"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-28 text-end"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={rowForm.vatAmount}
                      onChange={(event) => updateRowVatAmount(event.target.value)}
                      data-testid="input-vat-row-vat-amount"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 min-w-28 text-end"
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
                  <TableCell data-numeric>
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
                      <T k="components.vwLoading" />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      <T k="components.vatWorkpaperEmpty" />
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
                      <TableCell data-numeric>
                        <Money amount={Number(row.taxableAmount ?? 0)} />
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={Number(row.vatAmount ?? 0)} />
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={Number(row.grossAmount ?? 0)} />
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
                      <TableCell data-numeric>
                        <div className="flex items-center justify-end gap-1.5">
                          {row.journalEntryId ? (
                            <Badge variant="outline">posted</Badge>
                          ) : canPostVatWorkpaperRow(row) ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2"
                              disabled={postRowMutation.isPending}
                              onClick={() => postRowMutation.mutate(row.id)}
                              data-testid={`button-post-vat-workpaper-row-${row.id}`}
                            >
                              Post
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={deleteRowMutation.isPending}
                            aria-label={`Remove VAT row ${row.invoiceNumber || row.id}`}
                            title={t["components.vatWorkpaperRemoveRow"]}
                            onClick={() => {
                              const label = row.invoiceNumber
                                ? `VAT row ${row.invoiceNumber}`
                                : "this VAT row";
                              if (
                                window.confirm(
                                  `Remove ${label}? This will recalculate the VAT workpaper and reverse any linked journal entry.`
                                )
                              ) {
                                deleteRowMutation.mutate(row.id);
                              }
                            }}
                            data-testid={`button-delete-vat-workpaper-row-${row.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
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
            <Label htmlFor="vatWorkpaperPaste">
              <T k="components.vwPasteFromExcel" />
            </Label>
            <Textarea
              id="vatWorkpaperPaste"
              value={pastedRows}
              onChange={(event) => setPastedRows(event.target.value)}
              className="min-h-28 tabular-nums text-xs"
              placeholder={
                "Date\tVendor\tSr. Number\tAmount\n06/12/2025\tABDUL LATIF BROTHERS STORE\t23319\t31030"
              }
              data-testid="textarea-vat-workpaper-paste"
            />
          </div>
          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <div>
              <p className="text-xs text-muted-foreground">
                <T k="components.vwDefaultPastedCategory" />
              </p>
              <p className="text-sm font-medium">{vatRowCategoryLabel(rowForm.rowCategory)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                <T k="components.vwPreviewRows" />
              </p>
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
              <T k="components.vwImportPastedRows" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
