import { formatAedText } from "@/lib/format";
import { localizeFirmText } from "@shared/server-copy";
import { T } from "@/components/layout/T";
import { useTranslation, translateNow, formatMessage } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/page-header";
import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Upload,
  FileText,
  ReceiptIcon,
  CheckCircle2,
  XCircle,
  Play,
  RefreshCw,
  Building2,
  Loader2,
  CheckSquare,
  Square,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { SERVER_ERROR_NAMESPACES, serverErrorCopy } from "@/lib/validation-messages";
import type { Company } from "@shared/schema";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { StaleDataNotice } from "@/components/ui/stale-data-notice";
import { queryReadState } from "@/lib/queryReadState";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientWithStats extends Company {
  invoiceCount: number;
  outstandingAr: number;
}

interface OcrFileItem {
  id: string;
  file: File;
  companyId: string;
  preview?: string;
  status: "pending" | "processing" | "success" | "error";
  receiptId?: string;
  error?: string;
}

interface VatQueueEntry {
  companyId: string;
  companyName: string;
  trn: string;
  period: string;
  totalSales: number;
  totalPurchases: number;
  vatPayable: number;
  status: string;
}

interface BulkInvoiceResult {
  companyId: string;
  companyName: string;
  success: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  code?: string;
}

interface PeriodCloseStatus {
  companyId: string;
  companyName: string;
  period: string;
  checks: {
    trialBalanceOk: boolean;
    bankRecDone: boolean;
    allReceiptsPosted: boolean;
    vatPrepared: boolean;
  };
  issues: string[];
  readyToClose: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAed(n: number) {
  return formatAedText(n);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function VatStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: t["firmOps.bulkVatDraft"], cls: "bg-muted text-foreground border-border" },
    pending_review: {
      label: t["firmOps.bulkVatPendingReview"],
      cls: "bg-info-subtle text-info border-info/30",
    },
    submitted: {
      label: t["firmOps.bulkVatSubmitted"],
      cls: "bg-warning-subtle text-warning border-warning/30",
    },
    filed: {
      label: t["firmOps.bulkVatFiled"],
      cls: "bg-success-subtle text-success border-success/30",
    },
    none: {
      label: t["firmOps.bulkVatNotStarted"],
      cls: "bg-muted text-muted-foreground border-border",
    },
  };
  const { label, cls } = map[status] ?? map.draft;
  return <Badge className={cls}>{label}</Badge>;
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />
      )}
      <span className={ok ? "text-success" : "text-destructive"}>{label}</span>
    </div>
  );
}

// ─── Tab 1: Batch OCR ─────────────────────────────────────────────────────────

function BatchOCRTab({ clients }: { clients: ClientWithStats[] }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [items, setItems] = useState<OcrFileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
      const newItems: OcrFileItem[] = arr.map((file) => ({
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        file,
        companyId: clients[0]?.id ?? "",
        status: "pending",
      }));
      setItems((prev) => [...prev, ...newItems]);
    },
    [clients]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const setCompanyForItem = (id: string, companyId: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, companyId } : i)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const [isProcessing, setIsProcessing] = useState(false);

  const processAll = async () => {
    const pendingItems = items.filter((i) => i.status === "pending");
    if (!pendingItems.length) return;
    if (pendingItems.some((i) => !i.companyId)) {
      toast({ variant: "destructive", title: t["bulkOperations.selectAClientForEach"] });
      return;
    }

    setIsProcessing(true);
    setItems((prev) =>
      prev.map((i) => (i.status === "pending" ? { ...i, status: "processing" } : i))
    );

    for (const item of pendingItems) {
      try {
        const imageData = await fileToBase64(item.file);
        const result = await apiRequest("POST", "/api/firm/bulk/ocr", {
          items: [{ companyId: item.companyId, imageData, filename: item.file.name }],
        });
        const r = result.results?.[0];
        if (r?.success) {
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id ? { ...i, status: "success", receiptId: r.receiptId } : i
            )
          );
        } else {
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id ? { ...i, status: "error", error: r?.error ?? "OCR failed" } : i
            )
          );
        }
      } catch (err: any) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, status: "error", error: err?.message ?? t["bulkOperations.requestFailed"] }
              : i
          )
        );
      }
    }
    setIsProcessing(false);
  };

  const successCount = items.filter((i) => i.status === "success").length;
  const errorCount = items.filter((i) => i.status === "error").length;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">
          <T k="pages.batchOcrProcessing" />
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {t["bulkOperations.uploadMultipleReceiptImagesAnd"]}
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="font-medium">
          <T k="pages.dropReceiptImagesHereOrClickToBrowse" />
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {t["bulkOperations.jpegPngWebpMultipleFiles"]}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {/* Items list */}
      {items.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {formatMessage(t["firmOps.bulkFilesQueued"], { count: items.length })}
                {successCount > 0 && (
                  <span className="ms-2 text-success text-sm font-normal">
                    · {formatMessage(t["firmOps.bulkFilesDone"], { count: successCount })}
                  </span>
                )}
                {errorCount > 0 && (
                  <span className="ms-2 text-destructive text-sm font-normal">
                    · {formatMessage(t["firmOps.bulkFilesFailed"], { count: errorCount })}
                  </span>
                )}
              </CardTitle>
              <Button
                onClick={processAll}
                disabled={isProcessing || items.every((i) => i.status !== "pending")}
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 me-2" />
                )}
                {t["firmOps.bulkProcessAll"]}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t["firmOps.bulkColFile"]}</TableHead>
                    <TableHead>
                      <T k="pages.client" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.status" />
                    </TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium text-sm max-w-[200px] truncate">
                        {item.file.name}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={item.companyId}
                          onValueChange={(v) => setCompanyForItem(item.id, v)}
                          disabled={item.status !== "pending"}
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue placeholder={t["bulkOperations.selectClient"]} />
                          </SelectTrigger>
                          <SelectContent>
                            {clients.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {item.status === "pending" && (
                          <Badge variant="outline">
                            <T k="pages.pending" />
                          </Badge>
                        )}
                        {item.status === "processing" && (
                          <Badge className="bg-info-subtle text-info">
                            <Loader2 className="w-3 h-3 me-1 animate-spin" />
                            <T k="pages.processing" />
                          </Badge>
                        )}
                        {item.status === "success" && (
                          <Badge className="bg-success-subtle text-success">
                            <CheckCircle2 className="w-3 h-3 me-1" />
                            {t["firmOps.bulkDone"]}
                          </Badge>
                        )}
                        {item.status === "error" && (
                          <Badge variant="destructive" title={item.error}>
                            <XCircle className="w-3 h-3 me-1" />
                            <T k="pages.failed" />
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {item.status === "pending" && (
                          <Button variant="ghost" size="sm" onClick={() => removeItem(item.id)}>
                            ×
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Tab 2: VAT Filing Queue ──────────────────────────────────────────────────

function VatQueueTab({ clients: _clients }: { clients: ClientWithStats[] }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [queue, setQueue] = useState<VatQueueEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const prepareAll = async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest("POST", "/api/firm/bulk/vat-queue", {});
      setQueue(data);
      toast({
        title: formatMessage(translateNow("toasts.preparedVatQueueForClientS"), {
          count: data.length,
        }),
      });
    } catch {
      toast({ variant: "destructive", title: t["bulkOperations.failedToPrepareVatQueue"] });
    } finally {
      setIsLoading(false);
    }
  };

  const totalVatPayable = queue.reduce((s, e) => s + e.vatPayable, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            <T k="pages.vatFilingQueue" />
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {t["bulkOperations.reviewVatPeriodDataAcross"]}
          </p>
        </div>
        <Button onClick={prepareAll} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="w-4 h-4 me-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 me-2" />
          )}
          {t["firmOps.bulkPrepareAll"]}
        </Button>
      </div>

      {queue.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">
                  <T k="pages.clientsInQueue" />
                </p>
                <p className="text-2xl font-bold mt-1">{queue.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">
                  <T k="pages.totalVatPayable" />
                </p>
                <p className="text-2xl font-bold mt-1">{formatAed(totalVatPayable)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">
                  <T k="pages.readyToFile" />
                </p>
                <p className="text-2xl font-bold mt-1">
                  {queue.filter((e) => e.status === "submitted" || e.status === "filed").length}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T k="pages.company" />
                      </TableHead>
                      <TableHead>TRN</TableHead>
                      <TableHead>
                        <T k="pages.period" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="pages.sales" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="pages.purchases" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="pages.vatPayable" />
                      </TableHead>
                      <TableHead>
                        <T k="pages.status" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queue.map((entry) => (
                      <TableRow key={entry.companyId}>
                        <TableCell className="font-medium">{entry.companyName}</TableCell>
                        <TableCell className="text-muted-foreground tabular-nums text-sm">
                          {entry.trn}
                        </TableCell>
                        <TableCell>{entry.period}</TableCell>
                        <TableCell data-numeric>{formatAed(entry.totalSales)}</TableCell>
                        <TableCell data-numeric>{formatAed(entry.totalPurchases)}</TableCell>
                        <TableCell data-numeric className=" font-semibold">
                          {formatAed(entry.vatPayable)}
                        </TableCell>
                        <TableCell>
                          <VatStatusBadge status={entry.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {queue.length === 0 && !isLoading && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">{t["firmOps.bulkPrepareHint"]}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Tab 3: Bulk Invoicing ────────────────────────────────────────────────────

function BulkInvoicingTab({ clients }: { clients: ClientWithStats[] }) {
  const { locale, t } = useTranslation(SERVER_ERROR_NAMESPACES);
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [serviceDescription, setServiceDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [vatRate, setVatRate] = useState("0.05");
  const [results, setResults] = useState<BulkInvoiceResult[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const toggleAll = () => {
    if (selectedIds.size === clients.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(clients.map((c) => c.id)));
    }
  };

  const toggleClient = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const numAmount = parseFloat(amount) || 0;
  const parsedVatRate = parseFloat(vatRate);
  const numVatRate = Number.isFinite(parsedVatRate) ? parsedVatRate : 0.05;
  const vatAmount = parseFloat((numAmount * numVatRate).toFixed(2));
  const total = numAmount + vatAmount;

  const generate = async () => {
    if (!serviceDescription.trim()) {
      toast({ variant: "destructive", title: t["bulkOperations.enterAServiceDescription"] });
      return;
    }
    if (numAmount <= 0) {
      toast({ variant: "destructive", title: t["bulkOperations.enterAValidAmount"] });
      return;
    }
    if (selectedIds.size === 0) {
      toast({ variant: "destructive", title: t["bulkOperations.selectAtLeastOneClient"] });
      return;
    }

    setIsGenerating(true);
    try {
      const data = await apiRequest("POST", "/api/firm/bulk/invoices", {
        companyIds: Array.from(selectedIds),
        serviceDescription: serviceDescription.trim(),
        amount: numAmount,
        vatRate: numVatRate,
      });
      setResults(data.results ?? []);
      const success = (data.results ?? []).filter((r: BulkInvoiceResult) => r.success).length;
      toast({ title: formatMessage(translateNow("toasts.generatedInvoiceS"), { success }) });
    } catch {
      toast({ variant: "destructive", title: t["bulkOperations.failedToGenerateInvoices"] });
    } finally {
      setIsGenerating(false);
    }
  };

  const allSelected = clients.length > 0 && selectedIds.size === clients.length;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">
          <T k="pages.bulkInvoicing" />
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {t["bulkOperations.generateNraServiceInvoicesTo"]}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Left: form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <T k="pages.invoiceDetails" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>
                <T k="pages.serviceDescription" />
              </Label>
              <Input
                className="mt-1"
                placeholder={t["firmOps.bulkServicePlaceholder"]}
                value={serviceDescription}
                onChange={(e) => setServiceDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t["firmOps.bulkAmountExcl"]}</Label>
                <Input
                  className="mt-1"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="1500"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div>
                <Label>
                  <T k="pages.vatRate" />
                </Label>
                <Select value={vatRate} onValueChange={setVatRate}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.05">{t["firmOps.bulkVat5"]}</SelectItem>
                    <SelectItem value="0">{t["firmOps.bulkVat0"]}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {numAmount > 0 && (
              <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    <T k="pages.subtotal" />
                  </span>
                  <span>{formatAed(numAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    VAT ({(numVatRate * 100).toFixed(0)}%)
                  </span>
                  <span>{formatAed(vatAmount)}</span>
                </div>
                <div className="flex justify-between font-semibold border-t pt-1">
                  <span>
                    <T k="pages.totalPerInvoice" />
                  </span>
                  <span>{formatAed(total)}</span>
                </div>
                {selectedIds.size > 0 && (
                  <div className="flex justify-between text-primary font-semibold pt-1">
                    <span>
                      {formatMessage(t["firmOps.bulkTotalClients"], { count: selectedIds.size })}
                    </span>
                    <span>{formatAed(total * selectedIds.size)}</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: client selector */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                <T k="pages.selectClients" />
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={toggleAll}>
                {allSelected ? (
                  <CheckSquare className="w-4 h-4 me-1" />
                ) : (
                  <Square className="w-4 h-4 me-1" />
                )}
                {allSelected ? t["bulkOperations.deselectAll"] : t["pageLabels.selectAll"]}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="max-h-64 overflow-y-auto space-y-1 pe-2">
            {clients.map((client) => (
              <div
                key={client.id}
                className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${
                  selectedIds.has(client.id) ? "bg-primary/10" : "hover:bg-muted/50"
                }`}
                onClick={() => toggleClient(client.id)}
              >
                {selectedIds.has(client.id) ? (
                  <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-sm">{client.name}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={generate} disabled={isGenerating || selectedIds.size === 0}>
          {isGenerating ? (
            <Loader2 className="w-4 h-4 me-2 animate-spin" />
          ) : (
            <Play className="w-4 h-4 me-2" />
          )}
          {selectedIds.size > 0
            ? formatMessage(t["firmOps.bulkGenerate"], { count: selectedIds.size })
            : t["firmOps.bulkGenerateEmpty"]}
        </Button>
      </div>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <T k="pages.results" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <T k="pages.company" />
                  </TableHead>
                  <TableHead>{t["firmOps.bulkInvoiceNumber"]}</TableHead>
                  <TableHead>
                    <T k="pages.status" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={r.companyId}>
                    <TableCell className="font-medium">{r.companyName}</TableCell>
                    <TableCell className="tabular-nums text-sm">{r.invoiceNumber ?? "—"}</TableCell>
                    <TableCell>
                      {r.success ? (
                        <Badge className="bg-success-subtle text-success">
                          <CheckCircle2 className="w-3 h-3 me-1" />
                          <T k="pages.created" />
                        </Badge>
                      ) : (
                        <Badge
                          variant="destructive"
                          title={
                            (r.code && serverErrorCopy(locale, r.code)) ||
                            t["bulkOperations.failedToGenerateInvoices"]
                          }
                        >
                          <XCircle className="w-3 h-3 me-1" />
                          <T k="pages.failed" />
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Tab 4: Period Close ──────────────────────────────────────────────────────

function PeriodCloseTab({ clients }: { clients: ClientWithStats[] }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(clients.map((c) => c.id)));
  const [statuses, setStatuses] = useState<PeriodCloseStatus[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  const toggleClient = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runCheck = async () => {
    if (selectedIds.size === 0) {
      toast({ variant: "destructive", title: t["bulkOperations.selectAtLeastOneClient"] });
      return;
    }
    setIsChecking(true);
    try {
      const data = await apiRequest("POST", "/api/firm/bulk/period-close", {
        companyIds: Array.from(selectedIds),
        period,
      });
      setStatuses(data);
      const readyCount = data.filter((s: PeriodCloseStatus) => s.readyToClose).length;
      toast({
        title: formatMessage(translateNow("toasts.clientsReadyToClose"), {
          readyCount,
          count: data.length,
        }),
      });
    } catch {
      toast({ variant: "destructive", title: t["bulkOperations.periodCloseCheckFailed"] });
    } finally {
      setIsChecking(false);
    }
  };

  const quarterOptions = (() => {
    const now = new Date();
    const opts: string[] = [];
    for (let y = now.getFullYear(); y >= now.getFullYear() - 1; y--) {
      for (let q = 4; q >= 1; q--) {
        opts.push(`Q${q} ${y}`);
      }
    }
    return opts;
  })();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">
          <T k="pages.periodEndClose" />
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {t["bulkOperations.runAPreCloseChecklist"]}
        </p>
      </div>

      <div className="flex items-end gap-4">
        <div>
          <Label>
            <T k="pages.period" />
          </Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="mt-1 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {quarterOptions.map((q) => (
                <SelectItem key={q} value={q}>
                  {q}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={runCheck} disabled={isChecking || selectedIds.size === 0}>
          {isChecking ? (
            <Loader2 className="w-4 h-4 me-2 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4 me-2" />
          )}
          {t["firmOps.bulkRunChecklist"]}
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Client selector */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {formatMessage(t["firmOps.bulkClientsCount"], {
                  selected: selectedIds.size,
                  total: clients.length,
                })}
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelectedIds(
                    selectedIds.size === clients.length
                      ? new Set()
                      : new Set(clients.map((c) => c.id))
                  )
                }
              >
                {selectedIds.size === clients.length
                  ? t["bulkOperations.deselectAll"]
                  : t["pageLabels.selectAll"]}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="max-h-64 overflow-y-auto space-y-1">
            {clients.map((client) => (
              <div
                key={client.id}
                className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${
                  selectedIds.has(client.id) ? "bg-primary/10" : "hover:bg-muted/50"
                }`}
                onClick={() => toggleClient(client.id)}
              >
                {selectedIds.has(client.id) ? (
                  <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-sm">{client.name}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Status summary */}
        {statuses.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                <T k="pages.summary" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  <T k="pages.readyToClose" />
                </span>
                <span className="font-semibold text-success">
                  {statuses.filter((s) => s.readyToClose).length}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  <T k="pages.issuesFound" />
                </span>
                <span className="font-semibold text-warning">
                  {statuses.filter((s) => !s.readyToClose).length}
                </span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Results */}
      {statuses.length > 0 && (
        <div className="space-y-3">
          {statuses.map((s) => (
            <Card
              key={s.companyId}
              className={s.readyToClose ? "border-success/30" : "border-warning/30"}
            >
              <CardContent className="pt-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold">{s.companyName}</p>
                    <p className="text-sm text-muted-foreground">{s.period}</p>
                  </div>
                  {s.readyToClose ? (
                    <Badge className="bg-success-subtle text-success">
                      <T k="pages.ready" />
                    </Badge>
                  ) : (
                    <Badge className="bg-warning-subtle text-warning">
                      {formatMessage(t["firmOps.bulkIssuesCount"], { count: s.issues.length })}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <CheckItem
                    ok={s.checks.trialBalanceOk}
                    label={t["reportCenter.trialBalanceShort"]}
                  />
                  <CheckItem ok={s.checks.bankRecDone} label={t["marketing.bankTitle"]} />
                  <CheckItem
                    ok={s.checks.allReceiptsPosted}
                    label={t["bulkOperations.allReceiptsPosted"]}
                  />
                  <CheckItem
                    ok={s.checks.vatPrepared}
                    label={t["bulkOperations.vatReturnPrepared"]}
                  />
                </div>
                {s.issues.length > 0 && (
                  <div className="mt-3 bg-warning-subtle border border-warning/30 rounded p-2">
                    {s.issues.map((issue, i) => (
                      <p key={i} className="text-xs text-warning">
                        · {localizeFirmText(issue, t)}
                      </p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {statuses.length === 0 && !isChecking && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">{t["firmOps.bulkCloseHint"]}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BulkOperations() {
  const { t } = useTranslation();
  const clientsQuery = useQuery<ClientWithStats[]>({
    queryKey: ["/api/firm/clients"],
  });
  const clientsState = queryReadState(clientsQuery);

  if (clientsState === "pending") {
    return (
      <div className="flex items-center justify-center h-64" data-testid="bulk-clients-loading">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // The tabs seed their client selection from this list, so they mount only once it has loaded.
  if (clientsState === "error") {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow={t["firm.eyebrowFirm"]} title={t["bulkOperations.bulkOperations"]} />
        <LoadErrorState
          error={clientsQuery.error}
          onRetry={() => void clientsQuery.refetch()}
          testId="bulk-clients-error"
        />
      </div>
    );
  }
  const clients = clientsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t["firm.eyebrowFirm"]}
        title={t["bulkOperations.bulkOperations"]}
        description={t["bulkOperations.batchActionsAcrossAllManaged"]}
      />

      {clientsState === "stale" && (
        <StaleDataNotice onRetry={() => void clientsQuery.refetch()} testId="bulk-clients-stale" />
      )}

      <Tabs defaultValue="ocr">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="ocr">
              <ReceiptIcon className="w-4 h-4 me-2" />
              <T k="pages.batchOcr" />
            </TabsTrigger>
            <TabsTrigger value="vat">
              <FileText className="w-4 h-4 me-2" />
              <T k="pages.vatQueue" />
            </TabsTrigger>
            <TabsTrigger value="invoices">
              <Building2 className="w-4 h-4 me-2" />
              <T k="pages.invoicing" />
            </TabsTrigger>
            <TabsTrigger value="close">
              <CheckCircle2 className="w-4 h-4 me-2" />
              <T k="pages.periodClose" />
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="ocr" className="mt-6">
          <BatchOCRTab clients={clients} />
        </TabsContent>
        <TabsContent value="vat" className="mt-6">
          <VatQueueTab clients={clients} />
        </TabsContent>
        <TabsContent value="invoices" className="mt-6">
          <BulkInvoicingTab clients={clients} />
        </TabsContent>
        <TabsContent value="close" className="mt-6">
          <PeriodCloseTab clients={clients} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
