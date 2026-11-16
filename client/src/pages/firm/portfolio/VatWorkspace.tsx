// ClientPortfolio module (W5-D split of ClientPortfolio.tsx; no behaviour change).
import { T } from "@/components/layout/T";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Plus,
  BookOpen,
  Upload,
  Calculator,
  CheckCircle2,
  FileText,
  RefreshCw,
  Copy,
  ScanLine,
  Check,
  XCircle,
  Trash2,
  Download,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  evaluateAmountExpression,
  parseVatPasteRows,
  vat201CopyGroups,
  vatEmirates,
  vatRowCategories,
  vatRowCategoryLabel,
  type VatRowCategory,
} from "@/lib/vat-workpaper-grid";
import { format } from "date-fns";
import { POSTABLE_VAT_CATEGORIES } from "./types";
import type {
  BookkeeperClient,
  BookkeeperDashboard,
  ClientWithStats,
  VatWorkpaperAttachment,
  VatWorkpaperDetail,
  VatWorkpaperRow,
  VatWorkpaperSummary,
} from "./types";
import {
  copyText,
  formatAed,
  formatDateShort,
  formatDays,
  formatPeriod,
  hasClientService,
  inputDate,
  readEvidenceText,
  readFileAsBase64,
  todayInput,
} from "./helpers";

export function VatWorkspacePanel({
  dashboard,
  clients,
  onOpenWorkspace,
}: {
  dashboard?: BookkeeperDashboard;
  clients: ClientWithStats[];
  onOpenWorkspace: (companyId: string) => void;
}) {
  const { data } = useQuery<{ workpapers: VatWorkpaperSummary[] }>({
    queryKey: ["/api/firm/vat-workpapers"],
  });
  const workpapers = data?.workpapers ?? [];
  const draftCount = workpapers.filter(
    (workpaper) => workpaper.status === "draft" || workpaper.status === "in_review"
  ).length;
  const dueClients = (dashboard?.clients ?? [])
    .filter((client) => hasClientService(client, "vat") && client.vat.status !== "filed")
    .sort((a, b) => (a.vat.daysTilDue ?? 99999) - (b.vat.daysTilDue ?? 99999))
    .slice(0, 6);
  const recentWorkpapers = workpapers.slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="w-4 h-4 text-primary" />
              <T k="pages.vatSubmissionWorkspace" />
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              VAT-only workpapers for invoice rows, OCR drafts, evidence, and copy-ready VAT 201
              figures.
            </p>
          </div>
          <Badge variant="outline">{draftCount} draft/review workpapers</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              <T k="pages.vatQueue2" />
            </p>
            <span className="text-xs text-muted-foreground">
              {dashboard?.summary.vatDue28Days ?? 0} due in 28d
            </span>
          </div>
          {dueClients.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              <T k="pages.noVatQueueItemsNeedAction" />
            </div>
          ) : (
            dueClients.map((client) => (
              <div
                key={client.companyId}
                className="rounded-md border p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{client.companyName}</p>
                  <p className="text-xs text-muted-foreground">
                    {client.vat.cohortLabel} ·{" "}
                    {formatPeriod(client.vat.periodStart, client.vat.periodEnd)} ·{" "}
                    {formatDays(client.vat.daysTilDue)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenWorkspace(client.companyId)}
                >
                  <T k="pages.workspace" />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              <T k="pages.recentWorkpapers" />
            </p>
            <span className="text-xs text-muted-foreground">{workpapers.length} total</span>
          </div>
          {recentWorkpapers.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No VAT workpapers yet. Open a client from the VAT queue to create one.
            </div>
          ) : (
            recentWorkpapers.map((workpaper) => (
              <div
                key={workpaper.id}
                className="rounded-md border p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{workpaper.companyName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatPeriod(workpaper.periodStart, workpaper.periodEnd)} · {workpaper.status}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenWorkspace(workpaper.companyId)}
                >
                  Open
                </Button>
              </div>
            ))
          )}
          {clients.length > 0 && dueClients.length === 0 && (
            <Button size="sm" variant="outline" onClick={() => onOpenWorkspace(clients[0].id)}>
              <T k="pages.createForFirstClient" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function VatWorkspaceDialog({
  client,
  ops,
  open,
  onOpenChange,
}: {
  client: ClientWithStats | undefined;
  ops: BookkeeperClient | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [selectedWorkpaperId, setSelectedWorkpaperId] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceInputKey, setEvidenceInputKey] = useState(0);
  const [workspaceTab, setWorkspaceTab] = useState("grid");
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [rowForm, setRowForm] = useState({
    rowCategory: "standard_sale" as VatRowCategory,
    vat201Box: "box1bDubaiAmount",
    invoiceNumber: "",
    documentDate: todayInput(),
    counterpartyName: "",
    counterpartyTrn: "",
    emirate: client?.emirate ?? "dubai",
    taxableAmount: "",
    vatAmount: "",
    adjustmentAmount: "",
    grossAmount: "",
    notes: "",
    auditReason: "",
    status: "approved" as VatWorkpaperRow["status"],
    sourceMethod: "manual" as VatWorkpaperRow["sourceMethod"],
  });
  const [pastedVatRows, setPastedVatRows] = useState("");

  useEffect(() => {
    if (!open || !client) return;
    setPeriodStart(
      inputDate(ops?.vat.periodStart) ||
        format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd")
    );
    setPeriodEnd(
      inputDate(ops?.vat.periodEnd) ||
        format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), "yyyy-MM-dd")
    );
    setDueDate(inputDate(ops?.vat.dueDate));
    setRowForm((form) => ({ ...form, emirate: client.emirate ?? "dubai" }));
  }, [client, open, ops?.vat.dueDate, ops?.vat.periodEnd, ops?.vat.periodStart]);

  const workpapersQuery = useQuery<{ workpapers: VatWorkpaperSummary[] }>({
    queryKey: ["/api/firm/vat-workpapers", client?.id],
    queryFn: () => apiRequest("GET", `/api/firm/vat-workpapers?companyId=${client?.id}`),
    enabled: open && !!client,
  });
  const workpapers = workpapersQuery.data?.workpapers ?? [];

  useEffect(() => {
    if (!open) return;
    if (!selectedWorkpaperId && workpapers.length > 0) setSelectedWorkpaperId(workpapers[0].id);
    if (
      selectedWorkpaperId &&
      workpapers.length > 0 &&
      !workpapers.some((workpaper) => workpaper.id === selectedWorkpaperId)
    ) {
      setSelectedWorkpaperId(workpapers[0].id);
    }
  }, [open, selectedWorkpaperId, workpapers]);

  const detailQuery = useQuery<VatWorkpaperDetail>({
    queryKey: ["/api/firm/vat-workpapers/detail", selectedWorkpaperId],
    queryFn: () => apiRequest("GET", `/api/firm/vat-workpapers/${selectedWorkpaperId}`),
    enabled: open && !!selectedWorkpaperId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/firm/vat-workpapers", {
        companyId: client?.id,
        periodStart,
        periodEnd,
        dueDate: dueDate || null,
      }),
    onSuccess: (workpaper: VatWorkpaperSummary) => {
      setSelectedWorkpaperId(workpaper.id);
      queryClient.invalidateQueries({ queryKey: ["/api/firm/vat-workpapers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/firm/vat-workpapers", client?.id] });
      toast({ title: "VAT workpaper ready" });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: "Could not create VAT workpaper",
        description: e?.message,
      }),
  });

  const invalidateWorkspace = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/firm/vat-workpapers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/firm/vat-workpapers", client?.id] });
    queryClient.invalidateQueries({
      queryKey: ["/api/firm/vat-workpapers/detail", selectedWorkpaperId],
    });
  };

  // The amount fields double as a calculator: typing e.g. "7800+1850" resolves to
  // 9650 on blur. Only rewrite when the value actually contains an expression so
  // plain numbers and half-typed entries are left alone.
  const normalizeAmountField = (
    field: "taxableAmount" | "vatAmount" | "grossAmount" | "adjustmentAmount"
  ) =>
    setRowForm((form) => {
      const value = String((form as Record<string, unknown>)[field] ?? "");
      if (!/\d\s*[+\-*/]/.test(value)) return form;
      const computed = evaluateAmountExpression(value);
      if (!Number.isFinite(computed) || computed === 0) return form;
      return { ...form, [field]: String(computed) };
    });

  const rowPayload = (overrides?: Partial<Pick<VatWorkpaperRow, "status" | "sourceMethod">>) => ({
    rowCategory: rowForm.rowCategory,
    vat201Box: rowForm.rowCategory === "manual_adjustment" ? rowForm.vat201Box : undefined,
    invoiceNumber: rowForm.invoiceNumber || null,
    documentDate: rowForm.documentDate || null,
    counterpartyName: rowForm.counterpartyName || null,
    counterpartyTrn: rowForm.counterpartyTrn || null,
    emirate: rowForm.emirate || null,
    taxableAmount: evaluateAmountExpression(rowForm.taxableAmount),
    vatAmount: evaluateAmountExpression(rowForm.vatAmount),
    adjustmentAmount: evaluateAmountExpression(rowForm.adjustmentAmount),
    grossAmount: evaluateAmountExpression(rowForm.grossAmount),
    status: overrides?.status ?? rowForm.status,
    sourceMethod: overrides?.sourceMethod ?? rowForm.sourceMethod,
    notes: rowForm.notes || null,
    auditReason: rowForm.auditReason || null,
  });

  const resetRowForm = () => {
    setEditingRowId(null);
    setRowForm((form) => ({
      ...form,
      status: "approved",
      sourceMethod: "manual",
      invoiceNumber: "",
      documentDate: todayInput(),
      counterpartyName: "",
      counterpartyTrn: "",
      taxableAmount: "",
      vatAmount: "",
      adjustmentAmount: "",
      grossAmount: "",
      notes: "",
      auditReason: "",
    }));
  };

  const editVatRow = (row: VatWorkpaperRow) => {
    setEditingRowId(row.id);
    setWorkspaceTab("grid");
    setRowForm({
      rowCategory: row.rowCategory,
      vat201Box: row.vat201Box || "box1bDubaiAmount",
      invoiceNumber: row.invoiceNumber ?? "",
      documentDate: inputDate(row.documentDate),
      counterpartyName: row.counterpartyName ?? "",
      counterpartyTrn: row.counterpartyTrn ?? "",
      emirate: row.emirate ?? client?.emirate ?? "dubai",
      taxableAmount: String(row.taxableAmount ?? ""),
      vatAmount: String(row.vatAmount ?? ""),
      adjustmentAmount: String(row.adjustmentAmount ?? ""),
      grossAmount: String(row.grossAmount ?? ""),
      notes: row.notes ?? "",
      auditReason: row.auditReason ?? "",
      status: row.status,
      sourceMethod: row.sourceMethod,
    });
  };

  const addRowMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows`,
        rowPayload({
          status: "approved",
          sourceMethod: "manual",
        })
      ),
    onSuccess: () => {
      invalidateWorkspace();
      resetRowForm();
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not add VAT row", description: e?.message }),
  });

  const saveRowMutation = useMutation({
    mutationFn: () => {
      if (!editingRowId) throw new Error("Choose a VAT row to update first");
      return apiRequest(
        "PATCH",
        `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows/${editingRowId}`,
        rowPayload()
      );
    },
    onSuccess: () => {
      invalidateWorkspace();
      resetRowForm();
      toast({ title: "VAT row updated" });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not update VAT row", description: e?.message }),
  });

  const pastePreviewRows = useMemo(
    () => parseVatPasteRows(pastedVatRows, rowForm.emirate),
    [pastedVatRows, rowForm.emirate]
  );

  const importRowsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedWorkpaperId) throw new Error("Create or select a VAT workpaper first");
      const rowsToImport = parseVatPasteRows(pastedVatRows, rowForm.emirate);
      if (rowsToImport.length === 0) throw new Error("Paste at least one VAT row");
      for (const row of rowsToImport) {
        await apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows`, row);
      }
      return rowsToImport.length;
    },
    onSuccess: (count: number) => {
      invalidateWorkspace();
      setPastedVatRows("");
      toast({
        title: "VAT rows imported",
        description: `${count} row${count === 1 ? "" : "s"} added as approved import rows.`,
      });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: "Could not import VAT rows",
        description: e?.message,
      }),
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const uploadedEvidence = evidenceFile
        ? {
            fileDataBase64: await readFileAsBase64(evidenceFile),
            extractedText: await readEvidenceText(evidenceFile),
          }
        : null;

      return apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/scan`, {
        attachment: {
          fileName:
            evidenceFile?.name ||
            (rowForm.invoiceNumber ? `${rowForm.invoiceNumber}.scan` : "vat-evidence.scan"),
          mimeType: evidenceFile?.type || "application/octet-stream",
          fileDataBase64: uploadedEvidence?.fileDataBase64,
          extractedText: rowForm.notes || uploadedEvidence?.extractedText || null,
          extractionJson: {
            source: evidenceFile ? "uploaded_evidence" : "manual_ocr_review",
            originalSize: evidenceFile?.size,
            originalLastModified: evidenceFile
              ? new Date(evidenceFile.lastModified).toISOString()
              : undefined,
          },
        },
        draftRow: rowPayload({
          status: "draft",
          sourceMethod: "ocr",
        }),
      });
    },
    onSuccess: () => {
      invalidateWorkspace();
      resetRowForm();
      setEvidenceFile(null);
      setEvidenceInputKey((key) => key + 1);
      toast({ title: "OCR draft row logged for review" });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not log OCR draft", description: e?.message }),
  });

  const updateRowMutation = useMutation({
    mutationFn: ({ rowId, status }: { rowId: string; status: "approved" | "excluded" }) =>
      apiRequest("PATCH", `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows/${rowId}`, {
        status,
      }),
    onSuccess: invalidateWorkspace,
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not update VAT row", description: e?.message }),
  });

  const deleteRowMutation = useMutation({
    mutationFn: (rowId: string) =>
      apiRequest("DELETE", `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows/${rowId}`),
    onSuccess: (_data, rowId) => {
      invalidateWorkspace();
      if (editingRowId === rowId) resetRowForm();
      toast({ title: "VAT row deleted" });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not delete VAT row", description: e?.message }),
  });

  const postRowMutation = useMutation({
    mutationFn: (rowId: string) =>
      apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows/${rowId}/post`),
    onSuccess: () => {
      invalidateWorkspace();
      toast({
        title: "Posted to ledger",
        description: "This entry now shows in the journal, P&L and balance sheet.",
      });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not post to ledger", description: e?.message }),
  });

  const recalculateMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/recalculate`),
    onSuccess: invalidateWorkspace,
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: "Could not recalculate VAT workpaper",
        description: e?.message,
      }),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/generate-return`),
    onSuccess: () => {
      invalidateWorkspace();
      toast({
        title: "VAT return generated for review",
        description: "No FTA submission was performed.",
      });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: "Could not generate VAT return",
        description: e?.message,
      }),
  });

  const detail = detailQuery.data;
  const rows = detail?.rows ?? [];
  const totals = detail?.totals ?? detail?.workpaper.totalsSnapshot ?? {};
  const draftRows = rows.filter((row) => row.status === "draft");
  const approvedRows = rows.filter((row) => row.status === "approved");
  const excludedRows = rows.filter((row) => row.status === "excluded");
  const sourceBackedRows = approvedRows.filter(
    (row) => row.sourceMethod !== "manual" || row.invoiceNumber || row.counterpartyName
  );
  const outputVat = Number(totals.box8TotalVat ?? 0);
  const inputVat = Number(totals.box11TotalVat ?? 0);
  const payableVat = Number(totals.box14PayableTax ?? 0);
  const attachments = detail?.attachments ?? [];
  const selectedSummary = workpapers.find((workpaper) => workpaper.id === selectedWorkpaperId);

  const downloadAttachment = async (attachment: VatWorkpaperAttachment) => {
    if (!selectedWorkpaperId || !attachment.filePath) {
      toast({
        variant: "destructive",
        title: "Evidence file is not downloadable",
        description: "This evidence record was logged before file storage was enabled.",
      });
      return;
    }

    try {
      const response = await fetch(
        apiUrl(
          `/api/firm/vat-workpapers/${selectedWorkpaperId}/attachments/${attachment.id}/download`
        ),
        {
          credentials: "include",
        }
      );
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Could not download evidence",
        description: error?.message,
      });
    }
  };

  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const approveAllDraftsMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/rows/bulk-status`, {
        to: "approved",
      }),
    onSuccess: (result: { updated: number }) => {
      invalidateWorkspace();
      toast({
        title:
          result.updated > 0 ? `${result.updated} draft rows approved` : "No draft rows to approve",
        description:
          result.updated > 0
            ? "Totals recalculated — approved rows now flow into the VAT 201."
            : undefined,
      });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Bulk approve failed", description: e?.message }),
  });

  const pullFromBooksMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/pull-from-books`),
    onSuccess: (result: { created: number }) => {
      invalidateWorkspace();
      toast({
        title:
          result.created > 0
            ? `${result.created} draft rows pulled from books`
            : "Books already up to date",
        description:
          result.created > 0
            ? "Issued invoices and posted receipts for the period are in as drafts — review and approve."
            : "Every document in this period is already on the workpaper.",
      });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: "Could not pull from books",
        description: e?.message,
      }),
  });

  const importFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const fileDataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("Could not read the file"));
        reader.readAsDataURL(file);
      });
      return apiRequest("POST", `/api/firm/vat-workpapers/${selectedWorkpaperId}/import-file`, {
        fileName: file.name,
        fileDataBase64,
        defaultEmirate: rowForm.emirate,
      });
    },
    onSuccess: (result: { created: number }) => {
      invalidateWorkspace();
      toast({ title: `${result.created} rows imported from Excel` });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: "Could not import workbook",
        description: e?.message,
      }),
  });

  const downloadTemplate = async () => {
    try {
      const response = await fetch(apiUrl("/api/firm/vat-workpapers/template"), {
        credentials: "include",
      });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "muhasib-vat-workpaper-template.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Could not download template",
        description: error?.message,
      });
    }
  };

  const [exportingWorkbook, setExportingWorkbook] = useState(false);
  const downloadWorkbook = async () => {
    if (!selectedWorkpaperId) return;
    setExportingWorkbook(true);
    try {
      const response = await fetch(
        apiUrl(`/api/firm/vat-workpapers/${selectedWorkpaperId}/export`),
        {
          credentials: "include",
        }
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
      toast({
        title: "Workpaper exported",
        description: "Excel copy saved — grid plus copy-ready VAT 201 sheet.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Could not export workpaper",
        description: error?.message,
      });
    } finally {
      setExportingWorkbook(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-[96vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client?.name ?? "VAT Submission Workspace"}</DialogTitle>
          <DialogDescription>
            Bookkeeper VAT workbook for invoice entry, scanned evidence, draft OCR review, VAT 201
            totals, and copy-paste FTA filing figures. No FTA submission happens here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div className="grid gap-1">
                <Label>
                  <T k="pages.periodStart2" />
                </Label>
                <Input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label>
                  <T k="pages.periodEnd2" />
                </Label>
                <Input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label>
                  <T k="pages.dueDate2" />
                </Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label>
                  <T k="pages.workpaper" />
                </Label>
                <Select value={selectedWorkpaperId ?? ""} onValueChange={setSelectedWorkpaperId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select workpaper" />
                  </SelectTrigger>
                  <SelectContent>
                    {workpapers.map((workpaper) => (
                      <SelectItem key={workpaper.id} value={workpaper.id}>
                        {formatPeriod(workpaper.periodStart, workpaper.periodEnd)} ·{" "}
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
                disabled={!client || !periodStart || !periodEnd || createMutation.isPending}
              >
                <Plus className="w-4 h-4 mr-2" />
                Create/Open
              </Button>
              <Button
                variant="outline"
                onClick={() => recalculateMutation.mutate()}
                disabled={!selectedWorkpaperId || recalculateMutation.isPending}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                onClick={() => void downloadWorkbook()}
                disabled={!selectedWorkpaperId || exportingWorkbook}
                data-testid="button-export-workpaper"
              >
                <Download className="w-4 h-4 mr-2" />
                {exportingWorkbook ? "Exporting…" : "Excel"}
              </Button>
              <Button
                variant="outline"
                onClick={() => pullFromBooksMutation.mutate()}
                disabled={!selectedWorkpaperId || pullFromBooksMutation.isPending}
                data-testid="button-pull-from-books"
              >
                <BookOpen className="w-4 h-4 mr-2" />
                {pullFromBooksMutation.isPending ? "Pulling…" : "Pull from books"}
              </Button>
            </div>
          </div>

          {selectedSummary || detail ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">
                    <T k="pages.status" />
                  </p>
                  <p className="font-semibold">
                    {detail?.workpaper.status ?? selectedSummary?.status}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">
                    <T k="pages.approvedRows" />
                  </p>
                  <p className="font-semibold">{approvedRows.length}</p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Draft / excluded</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">
                      {draftRows.length} / {excludedRows.length}
                    </p>
                    {draftRows.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => approveAllDraftsMutation.mutate()}
                        disabled={approveAllDraftsMutation.isPending}
                        data-testid="button-approve-all-drafts"
                      >
                        <Check className="w-3 h-3 mr-1" />
                        <T k="pages.approveAll" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">
                    <T k="pages.evidenceBacked" />
                  </p>
                  <p className="font-semibold">{sourceBackedRows.length}</p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Output / input VAT</p>
                  <p className="font-semibold">
                    {formatAed(outputVat)} / {formatAed(inputVat)}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">
                    <T k="pages.netPayable" />
                  </p>
                  <p className="font-semibold">{formatAed(payableVat)}</p>
                </div>
              </div>

              <Tabs value={workspaceTab} onValueChange={setWorkspaceTab} className="space-y-4">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="grid">
                    <T k="pages.entryGrid" />
                  </TabsTrigger>
                  <TabsTrigger value="drafts">
                    <T k="pages.ocrDrafts" />
                  </TabsTrigger>
                  <TabsTrigger value="return">VAT 201 Review</TabsTrigger>
                  <TabsTrigger value="evidence">
                    <T k="pages.evidence" />
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="grid" className="space-y-4 mt-0">
                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.7fr)] gap-4">
                    <div className="rounded-md border overflow-hidden">
                      <div className="flex flex-col gap-2 border-b bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium">
                            <T k="pages.invoiceAndBillEntryGrid" />
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Edit rows, approve drafts, exclude mistakes, then review totals in VAT
                            201 Review.
                          </p>
                        </div>
                        <Badge variant="outline">
                          {rows.length} row{rows.length === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="min-w-28">
                                <T k="pages.source" />
                              </TableHead>
                              <TableHead className="min-w-36">
                                <T k="pages.invoice" />
                              </TableHead>
                              <TableHead className="min-w-36">Date</TableHead>
                              <TableHead className="min-w-56">Customer / vendor</TableHead>
                              <TableHead className="min-w-36">TRN</TableHead>
                              <TableHead className="min-w-40">
                                <T k="pages.category" />
                              </TableHead>
                              <TableHead className="min-w-32">
                                <T k="pages.emirate" />
                              </TableHead>
                              <TableHead className="min-w-28 text-right">
                                <T k="pages.taxable" />
                              </TableHead>
                              <TableHead className="min-w-28 text-right">VAT</TableHead>
                              <TableHead className="min-w-28 text-right">
                                <T k="pages.gross" />
                              </TableHead>
                              <TableHead className="min-w-32">
                                <T k="pages.status" />
                              </TableHead>
                              <TableHead className="min-w-36 text-right sticky right-0 bg-background z-20 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">
                                <T k="pages.actions" />
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow className="bg-background">
                              <TableCell>
                                <Badge variant={editingRowId ? "secondary" : "outline"}>
                                  {editingRowId ? "editing" : "new row"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Input
                                  className="h-8 min-w-32"
                                  placeholder="INV-1001"
                                  value={rowForm.invoiceNumber}
                                  onChange={(e) =>
                                    setRowForm((form) => ({
                                      ...form,
                                      invoiceNumber: e.target.value,
                                    }))
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  className="h-8 min-w-32"
                                  type="date"
                                  value={rowForm.documentDate}
                                  onChange={(e) =>
                                    setRowForm((form) => ({
                                      ...form,
                                      documentDate: e.target.value,
                                    }))
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  className="h-8 min-w-48"
                                  placeholder="Customer / vendor"
                                  value={rowForm.counterpartyName}
                                  onChange={(e) =>
                                    setRowForm((form) => ({
                                      ...form,
                                      counterpartyName: e.target.value,
                                    }))
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  className="h-8 min-w-32"
                                  placeholder="TRN"
                                  value={rowForm.counterpartyTrn}
                                  onChange={(e) =>
                                    setRowForm((form) => ({
                                      ...form,
                                      counterpartyTrn: e.target.value,
                                    }))
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={rowForm.rowCategory}
                                  onValueChange={(value) =>
                                    setRowForm((form) => ({
                                      ...form,
                                      rowCategory: value as VatRowCategory,
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-8 min-w-40">
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
                                  onValueChange={(value) =>
                                    setRowForm((form) => ({ ...form, emirate: value }))
                                  }
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
                                  className="h-8 min-w-24 text-right"
                                  placeholder="0.00"
                                  value={rowForm.taxableAmount}
                                  onChange={(e) =>
                                    setRowForm((form) => ({
                                      ...form,
                                      taxableAmount: e.target.value,
                                    }))
                                  }
                                  onBlur={() => normalizeAmountField("taxableAmount")}
                                  title="Tip: you can type a sum like 7800+1850"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  className="h-8 min-w-24 text-right"
                                  placeholder="0.00"
                                  value={rowForm.vatAmount}
                                  onChange={(e) =>
                                    setRowForm((form) => ({ ...form, vatAmount: e.target.value }))
                                  }
                                  onBlur={() => normalizeAmountField("vatAmount")}
                                  title="Tip: you can type a sum like 7800+1850"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  className="h-8 min-w-24 text-right"
                                  placeholder="0.00"
                                  value={rowForm.grossAmount}
                                  onChange={(e) =>
                                    setRowForm((form) => ({ ...form, grossAmount: e.target.value }))
                                  }
                                  onBlur={() => normalizeAmountField("grossAmount")}
                                  title="Tip: you can type a sum like 7800+1850"
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={rowForm.status}
                                  onValueChange={(value) =>
                                    setRowForm((form) => ({
                                      ...form,
                                      status: value as VatWorkpaperRow["status"],
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-8 min-w-28">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="approved">
                                      <T k="pages.approved" />
                                    </SelectItem>
                                    <SelectItem value="draft">
                                      <T k="pages.draft" />
                                    </SelectItem>
                                    <SelectItem value="excluded">
                                      <T k="pages.excluded" />
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell className="text-right sticky right-0 bg-background z-10 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]">
                                <div className="flex justify-end gap-1">
                                  {editingRowId ? (
                                    <Button
                                      size="sm"
                                      onClick={() => saveRowMutation.mutate()}
                                      disabled={!selectedWorkpaperId || saveRowMutation.isPending}
                                    >
                                      Save
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      onClick={() => addRowMutation.mutate()}
                                      disabled={!selectedWorkpaperId || addRowMutation.isPending}
                                    >
                                      Add
                                    </Button>
                                  )}
                                  <Button size="sm" variant="outline" onClick={resetRowForm}>
                                    <T k="pages.clear" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                            {rows.length === 0 ? (
                              <TableRow>
                                <TableCell
                                  colSpan={12}
                                  className="text-sm text-muted-foreground text-center py-8"
                                >
                                  No VAT rows yet. Add invoice lines manually, paste rows from
                                  Excel, or upload evidence as OCR drafts.
                                </TableCell>
                              </TableRow>
                            ) : (
                              rows.map((row) => (
                                <TableRow
                                  key={row.id}
                                  className={editingRowId === row.id ? "bg-primary/5" : undefined}
                                >
                                  <TableCell>
                                    <Badge
                                      variant={row.sourceMethod === "ocr" ? "secondary" : "outline"}
                                    >
                                      {row.sourceMethod}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <p className="font-medium">{row.invoiceNumber || "—"}</p>
                                    <p className="text-xs text-muted-foreground">{row.vat201Box}</p>
                                  </TableCell>
                                  <TableCell>{formatDateShort(row.documentDate)}</TableCell>
                                  <TableCell>
                                    <p className="max-w-56 truncate">
                                      {row.counterpartyName || "—"}
                                    </p>
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {row.counterpartyTrn || "—"}
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    {vatRowCategoryLabel(row.rowCategory)}
                                  </TableCell>
                                  <TableCell className="text-sm">{row.emirate || "—"}</TableCell>
                                  <TableCell className="text-right">
                                    {formatAed(Number(row.taxableAmount ?? 0))}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatAed(Number(row.vatAmount ?? 0))}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatAed(Number(row.grossAmount ?? 0))}
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
                                  <TableCell
                                    className={`text-right sticky right-0 z-10 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)] ${
                                      editingRowId === row.id ? "bg-primary/5" : "bg-background"
                                    }`}
                                  >
                                    <div className="flex justify-end gap-1">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => editVatRow(row)}
                                      >
                                        Edit
                                      </Button>
                                      {row.journalEntryId ? (
                                        <Badge
                                          variant="outline"
                                          className="gap-1 text-success border-success/40"
                                          title="Posted to the general ledger"
                                        >
                                          <CheckCircle2 className="w-3.5 h-3.5" />
                                          <T k="pages.posted" />
                                        </Badge>
                                      ) : row.sourceMethod === "manual" &&
                                        POSTABLE_VAT_CATEGORIES.includes(row.rowCategory) ? (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          title="Post this sale to the ledger so it shows in the journal, P&L and balance sheet"
                                          disabled={postRowMutation.isPending}
                                          onClick={() => postRowMutation.mutate(row.id)}
                                        >
                                          Post
                                        </Button>
                                      ) : null}
                                      {row.status === "draft" ? (
                                        <>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            aria-label={`Approve ${row.invoiceNumber || "draft VAT row"}`}
                                            title="Approve draft VAT row"
                                            onClick={() =>
                                              updateRowMutation.mutate({
                                                rowId: row.id,
                                                status: "approved",
                                              })
                                            }
                                          >
                                            <Check className="w-3.5 h-3.5" />
                                            <span className="sr-only">
                                              <T k="pages.approveDraftRow" />
                                            </span>
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            aria-label={`Exclude ${row.invoiceNumber || "draft VAT row"}`}
                                            title="Exclude draft VAT row"
                                            onClick={() =>
                                              updateRowMutation.mutate({
                                                rowId: row.id,
                                                status: "excluded",
                                              })
                                            }
                                          >
                                            <XCircle className="w-3.5 h-3.5" />
                                            <span className="sr-only">
                                              <T k="pages.excludeDraftRow" />
                                            </span>
                                          </Button>
                                        </>
                                      ) : (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() =>
                                            updateRowMutation.mutate({
                                              rowId: row.id,
                                              status:
                                                row.status === "approved" ? "excluded" : "approved",
                                            })
                                          }
                                        >
                                          {row.status === "approved" ? "Exclude" : "Approve"}
                                        </Button>
                                      )}
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-destructive hover:text-destructive"
                                        aria-label={`Delete ${row.invoiceNumber || "VAT row"}`}
                                        title="Delete this row"
                                        disabled={deleteRowMutation.isPending}
                                        onClick={() => {
                                          if (
                                            window.confirm(
                                              "Delete this VAT row? This removes it and any attached evidence and updates the totals."
                                            )
                                          ) {
                                            deleteRowMutation.mutate(row.id);
                                          }
                                        }}
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span className="sr-only">
                                          <T k="pages.deleteRow" />
                                        </span>
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

                    <div className="space-y-4">
                      <div className="rounded-md border p-3 space-y-3">
                        <div>
                          <p className="font-medium">
                            <T k="pages.rowNotesAndOverrideReason" />
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Manual adjustments must explain the audit reason before they can be
                            saved.
                          </p>
                        </div>
                        {rowForm.rowCategory === "manual_adjustment" && (
                          <Input
                            placeholder="VAT 201 box, e.g. box9ExpensesVat"
                            value={rowForm.vat201Box}
                            onChange={(e) =>
                              setRowForm((form) => ({ ...form, vat201Box: e.target.value }))
                            }
                          />
                        )}
                        <Input
                          placeholder="Adjustment amount"
                          value={rowForm.adjustmentAmount}
                          onChange={(e) =>
                            setRowForm((form) => ({ ...form, adjustmentAmount: e.target.value }))
                          }
                          onBlur={() => normalizeAmountField("adjustmentAmount")}
                          title="Tip: you can type a sum like 7800+1850"
                        />
                        <Textarea
                          placeholder="Notes / OCR text"
                          value={rowForm.notes}
                          onChange={(e) =>
                            setRowForm((form) => ({ ...form, notes: e.target.value }))
                          }
                          className="min-h-24"
                        />
                        <Textarea
                          placeholder="Audit reason for overrides or manual adjustments"
                          value={rowForm.auditReason}
                          onChange={(e) =>
                            setRowForm((form) => ({ ...form, auditReason: e.target.value }))
                          }
                          className="min-h-20"
                        />
                      </div>

                      <div className="rounded-md border p-3 space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-medium">
                              <T k="pages.pasteRowsFromExcel" />
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Headers are supported: category, invoice number, date,
                              customer/vendor, TRN, emirate, taxable amount, VAT amount, gross
                              amount, notes.
                            </p>
                          </div>
                          <Badge variant="outline">{pastePreviewRows.length} parsed</Badge>
                        </div>
                        <Textarea
                          value={pastedVatRows}
                          onChange={(e) => setPastedVatRows(e.target.value)}
                          placeholder={
                            "category\tinvoice number\tdate\tcustomer/vendor\tTRN\temirate\ttaxable amount\tVAT amount\tgross amount\tnotes\nstandard_expense\tBILL-1001\t2026-05-18\tSupplier LLC\t100123456700003\tdubai\t1000\t50\t1050\tMay receipt"
                          }
                          className="min-h-36 font-mono text-xs"
                          data-testid="textarea-vat-paste-rows"
                        />
                        {pastePreviewRows.length > 0 && (
                          <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                            Preview:{" "}
                            {pastePreviewRows
                              .slice(0, 3)
                              .map(
                                (row) =>
                                  `${row.invoiceNumber || "No invoice"} ${formatAed(row.taxableAmount)} + VAT ${formatAed(row.vatAmount)}`
                              )
                              .join(" · ")}
                            {pastePreviewRows.length > 3
                              ? ` · +${pastePreviewRows.length - 3} more`
                              : ""}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => importRowsMutation.mutate()}
                            disabled={
                              !selectedWorkpaperId ||
                              pastePreviewRows.length === 0 ||
                              importRowsMutation.isPending
                            }
                          >
                            <Upload className="w-4 h-4 mr-2" />
                            <T k="pages.addPastedRows" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void downloadTemplate()}
                            data-testid="button-vat-template"
                          >
                            <Download className="w-4 h-4 mr-2" />
                            <T k="pages.excelTemplate" />
                          </Button>
                          <input
                            ref={importFileInputRef}
                            type="file"
                            accept=".xlsx"
                            className="hidden"
                            data-testid="input-vat-import-file"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) importFileMutation.mutate(file);
                              e.target.value = "";
                            }}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => importFileInputRef.current?.click()}
                            disabled={!selectedWorkpaperId || importFileMutation.isPending}
                            data-testid="button-vat-import-file"
                          >
                            <Upload className="w-4 h-4 mr-2" />
                            {importFileMutation.isPending ? "Importing…" : "Import .xlsx"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="drafts" className="space-y-4 mt-0">
                  <div className="grid grid-cols-1 xl:grid-cols-[0.8fr_1.2fr] gap-4">
                    <div className="rounded-md border p-3 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            <T k="pages.uploadInvoiceOrReceiptEvidence" />
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Uploaded files create draft OCR rows. They do not count until approved.
                          </p>
                        </div>
                        {evidenceFile ? (
                          <Badge variant="secondary">
                            {(evidenceFile.size / 1024).toFixed(1)} KB
                          </Badge>
                        ) : null}
                      </div>
                      <Input
                        key={evidenceInputKey}
                        id="vat-evidence-upload"
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.json,application/pdf,image/png,image/jpeg,image/webp,text/plain,text/csv,application/json"
                        onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)}
                        data-testid="input-vat-evidence-upload"
                      />
                      {evidenceFile ? (
                        <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
                          <span className="truncate">{evidenceFile.name}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEvidenceFile(null);
                              setEvidenceInputKey((key) => key + 1);
                            }}
                          >
                            <T k="pages.remove" />
                          </Button>
                        </div>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => scanMutation.mutate()}
                        disabled={!selectedWorkpaperId || scanMutation.isPending}
                      >
                        <ScanLine className="w-4 h-4 mr-2" />
                        <T k="pages.logOcrDraft" />
                      </Button>
                    </div>

                    <div className="rounded-md border overflow-hidden">
                      <div className="border-b bg-muted/30 px-3 py-2">
                        <p className="font-medium">
                          <T k="pages.draftReviewQueue" />
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Approve only after the bookkeeper has checked the scanned values against
                          evidence.
                        </p>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <T k="pages.invoice" />
                            </TableHead>
                            <TableHead>
                              <T k="pages.counterparty" />
                            </TableHead>
                            <TableHead>
                              <T k="pages.category" />
                            </TableHead>
                            <TableHead className="text-right">VAT</TableHead>
                            <TableHead className="text-right">
                              <T k="pages.review" />
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {draftRows.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={5}
                                className="text-sm text-muted-foreground text-center py-8"
                              >
                                <T k="pages.noOcrDraftsWaitingForReview" />
                              </TableCell>
                            </TableRow>
                          ) : (
                            draftRows.map((row) => (
                              <TableRow key={row.id}>
                                <TableCell>{row.invoiceNumber || "—"}</TableCell>
                                <TableCell>{row.counterpartyName || "—"}</TableCell>
                                <TableCell>{vatRowCategoryLabel(row.rowCategory)}</TableCell>
                                <TableCell className="text-right">
                                  {formatAed(Number(row.vatAmount ?? 0))}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => editVatRow(row)}
                                    >
                                      Edit
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        updateRowMutation.mutate({
                                          rowId: row.id,
                                          status: "approved",
                                        })
                                      }
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() =>
                                        updateRowMutation.mutate({
                                          rowId: row.id,
                                          status: "excluded",
                                        })
                                      }
                                    >
                                      <XCircle className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-destructive hover:text-destructive"
                                      aria-label={`Delete ${row.invoiceNumber || "draft VAT row"}`}
                                      title="Delete this draft row"
                                      disabled={deleteRowMutation.isPending}
                                      onClick={() => {
                                        if (
                                          window.confirm(
                                            "Delete this draft row? This removes it and any attached evidence."
                                          )
                                        ) {
                                          deleteRowMutation.mutate(row.id);
                                        }
                                      }}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
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
                </TabsContent>

                <TabsContent value="return" className="space-y-4 mt-0">
                  <div className="rounded-md border p-3 space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium">FTA VAT 201 copy fields</p>
                        <p className="text-xs text-muted-foreground">
                          Approved rows are aggregated below. Copy each value into the FTA portal
                          manually; this does not submit to FTA.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => recalculateMutation.mutate()}
                          disabled={!selectedWorkpaperId || recalculateMutation.isPending}
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          <T k="pages.recalculate" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => generateMutation.mutate()}
                          disabled={!selectedWorkpaperId || generateMutation.isPending}
                        >
                          <FileText className="w-4 h-4 mr-2" />
                          <T k="pages.generateReturn" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                      {vat201CopyGroups.map((group) => (
                        <div key={group.title} className="rounded-md border bg-background p-3">
                          <p className="text-sm font-semibold mb-2">{group.title}</p>
                          <div className="grid gap-2">
                            {group.fields.map(([key, label]) => {
                              const value = Number(totals[key] ?? 0).toFixed(2);
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => copyText(value)}
                                  className="rounded-md border p-2 text-left hover:bg-muted/50 transition-colors"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs text-muted-foreground">{label}</span>
                                    <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                                  </div>
                                  <p className="font-semibold mt-1">{value}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="evidence" className="space-y-4 mt-0">
                  <div className="rounded-md border p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          <T k="pages.evidenceFiles" />
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Uploaded invoices and receipts stay linked to VAT rows for refund support
                          and later review.
                        </p>
                      </div>
                      <Badge variant="outline">
                        {attachments.length} file{attachments.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    {attachments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        <T k="pages.noInvoiceEvidenceUploadedYet" />
                      </p>
                    ) : (
                      <div className="grid gap-2">
                        {attachments.map((attachment) => (
                          <div
                            key={attachment.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{attachment.fileName}</p>
                              <p className="text-xs text-muted-foreground">
                                {attachment.mimeType || "file"} ·{" "}
                                {formatDateShort(attachment.createdAt)}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void downloadAttachment(attachment)}
                              disabled={!attachment.filePath}
                            >
                              <T k="pages.download" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              Create a VAT workpaper to start entering VAT rows and reviewing OCR drafts.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <T k="pages.close" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
